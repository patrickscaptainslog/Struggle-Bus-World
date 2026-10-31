#!/usr/bin/env python3
"""The far raster: one small image of a whole baked city, built from the tiles the game already streams.

From a street 2 km away every building is a tile; past that the game has nothing to draw it with. This raster says what is on top of
every 16 m cell, so the far ground can draw it: nothing is rebaked, and any city with region bundles gets one (no city names below).

No light in it, and nothing keyed to a time of day: the sun is real, so the client lights every cell live. What is stored is what the
near shaders call `lo`, the offset they add to sbLight. Mixed cells keep their brightness: every 2 m texel is taken to a luma at REF_LIGHT
on its own ramp, the cell's mean goes back to a `lo` on the cell's ramp. (REF_LIGHT only equalises ramps: the offset comes out the same
at any light, the ramps being near linear.)

far16.bin, gzip of (little-endian; reader: src/world/tiles.ts parseFarRaster):
  char[4] 'SBR1', u32 W, u32 H,
  f32 a, b, c, d, e, f   world x, z of cell (i, j): x = a*i + b*j + c, z = d*i + e*j + f (cell corners; a tile of the planet tree later)
  u16 bodyId (0 Earth), u16 cellM,
  then six planes of W*H bytes, j rows of i:
  class     Ground in src/world/tiles.ts (0-10), 11 ROOF, 12 TREE, 13 ICE, 14 ROCK_BARE, 255 none
  tone      roofs' or ground's lo around its class: lo = CLASS_LO[class] + (tone / 255 - 0.5) * TONE_K
  height    top of the building above ground in 2 m steps, 0 none, 255 = 508 m or more (for boxes and the low-sun sweep)
  paint     0 (the game's own, later)
  wall      wall share of a grazing view, 0-255 = 0-1: min(1, mean height / cell)
  wallTone  walls' lo: lo = WALL_LO + (wallTone / 255 - 0.5) * TONE_K, one value per 64 m block (the client reads it per far vertex)
tone, wall and wallTone are stored coarser than a byte (TONE_Q, WALL_Q): what a far pixel shows is filtered, and the bits below that are
only bytes to download.
('SBR1' is also the region bundles' magic: nothing reads one as the other, they are different files.)

usage: python -I tools/bake/farmap.py <slug> [--cell 16] [--report out.json] [--png dir]
"""
import argparse
import gzip
import json
import os
import re
import struct
import time

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

MAGIC = b'SBR1'
TONE_K = 0.8  # the span of lo a tone byte covers (src/world/farMaterial.ts)
REF_LIGHT = 0.7  # the light level ramps are equalised at
ROOF_SHARE = 0.5  # a cell is ROOF when footprints cover this much of it
TREE_SHARE = 0.5  # ...TREE when crowns cover this much
HEIGHT_STEP = 2.0
TONE_Q = 6  # tone bytes per stored level: an eighth of a ramp step (a step of light is 1 / 7, TONE_K / 255 a byte)
WALL_Q = 8  # wall bytes per stored level: 32 levels
WALL_BLOCK = 4  # cells per wallTone block

PAVED, GRASS, WATER, SIDEWALK, PLAZA, PATH, SAND, RAIL, FOREST, YARD, ROCK, ROOF, TREE = range(13)
NONE = 255
CLASS_NAMES = ['PAVED', 'GRASS', 'WATER', 'SIDEWALK', 'PLAZA', 'PATH', 'SAND', 'RAIL', 'FOREST', 'YARD', 'ROCK', 'ROOF', 'TREE']
# class -> ramp, lo: terrainMaterial.ts's table, plus ROOF (the mean of buildingMaterial's roof rule) and TREE (trees.ts).
# Same table in src/world/farMaterial.ts.
CLASSES = [
    ('GREY', -0.1), ('GREEN_GREY', 0.02), ('WATER', 0.0), ('GREY_LIGHT', -0.04), ('GREY_LIGHT', 0.03), ('GREY_LIGHT', 0.0),
    ('SKY_WARM', -0.1), ('ROOF_DARK', -0.04), ('GREEN_GREY', -0.1), ('GREEN_GREY', 0.0), ('GREY', 0.06),
    ('GREY_LIGHT', -0.12), ('GREEN_GREY', -0.06),
]
WALL_LO = -0.09  # the centre of the walls' lo
# share of a flat wall that is window (buildingMaterial's `cover`, front and side walls taken together), per Arch
COVER = np.array([0.07, 0.3, 0.3, 0.27, 0.5, 0.15, 0.15, 0.05, 0.27])
# a tree's crown radius at scale 1 (m), by kind: the reach of trees.ts's lobes, 3/4 of it for area
CROWN_R = np.array([4.35, 9.6, 4.2]) * 0.75


def inflate(path):
    data = open(path, 'rb').read()
    return gzip.decompress(data) if data[:2] == b'\x1f\x8b' else data


def palette():
    """Every ramp's luma per step, from the game's own table."""
    text = open(os.path.join(ROOT, 'src', 'render', 'palette.ts'), encoding='utf8').read()
    out = {}
    for name, body in re.findall(r"\[Ramp\.(\w+)\]:\s*\[([^\]]+)\]", text):
        hexes = re.findall(r'#([0-9a-fA-F]{6})', body)
        rgb = np.array([[int(h[i:i + 2], 16) for i in (0, 2, 4)] for h in hexes], float) / 255
        out[name] = rgb @ np.array([0.299, 0.587, 0.114])
    return out


class Luma:
    """lo <-> luma at REF_LIGHT, per class's ramp."""
    LO0, LO1, N = -0.8, 0.5, 512

    def __init__(self):
        pal = palette()
        self.los = np.linspace(self.LO0, self.LO1, self.N)
        steps = np.clip((REF_LIGHT + self.los) * 7, 0, 7)
        self.names = sorted({r for r, _ in CLASSES})
        self.lut = np.array([np.interp(steps, np.arange(8), pal[n]) for n in self.names])
        self.ramp = np.array([self.names.index(r) for r, _ in CLASSES])
        self.lo = np.array([lo for _, lo in CLASSES])

    def luma(self, ramp, lo):
        i = np.clip(np.rint((lo - self.LO0) / (self.LO1 - self.LO0) * (self.N - 1)).astype(np.int32), 0, self.N - 1)
        return self.lut[ramp, i]

    def to_lo(self, ramp, y):
        """The lo that gives luma y on this ramp (one ramp index)."""
        return np.interp(y, self.lut[ramp], self.los)


def parse_buildings(b):
    magic = bytes(b[:4])
    if magic not in (b'SBB1', b'SBB2', b'SBB3'):
        raise SystemExit(f'bad building tile {magic}')
    v3, v2 = magic == b'SBB3', magic != b'SBB1'
    count, verts, ox, oz = struct.unpack_from('<IIff', b, 4)
    o = 24

    def take(dtype, n):
        nonlocal o
        a = np.frombuffer(b, dtype, n, o)
        o += a.nbytes
        return a

    take('<u4', count)  # index
    take('<u4', count)  # stableId
    vstart = take('<u4', count + 1)
    base = take('<f4', count)
    roof = take('<f4', count)
    ground = take('<f4', count) if v2 else base
    if v3:
        take('<u4', count)  # facadeColor
        take('<u4', count)  # roofColor
    roofh = take('<u2', count) / 10 if v3 else np.zeros(count)
    arch = take('u1', count)
    take('u1', count)  # floors
    take('u1', count)  # front
    take('u1', count)  # front2
    take('u1', count)  # hood
    seed = take('u1', count)
    if v2:
        take('u1', count)  # tier
        take('u1', count)  # taper
    shape = take('u1', count) if v3 else np.zeros(count, np.uint8)
    if v3:
        take('u1', count)  # roofDir
        take('u1', count)  # facadeMat
        take('u1', count)  # roofMat
    source = take('u1', count) if v3 else np.zeros(count, np.uint8)
    o += (4 - o % 4) % 4
    vx = take('<i2', verts)
    vz = take('<i2', verts)
    return {'vstart': vstart.astype(np.int64), 'top': roof + roofh, 'ground': ground, 'arch': arch, 'seed': seed, 'shape': shape, 'source': source,
            'x': ox + vx / 10.0, 'z': oz + vz / 10.0}


def parse_terrain(b, class_n):
    magic = bytes(b[:4])
    if magic not in (b'SBT1', b'SBT2'):
        raise SystemExit(f'bad terrain tile {magic}')
    n, obst_n = struct.unpack_from('<HH', b, 12)
    ox, oz = struct.unpack_from('<ff', b, 20)
    o = 28 + n * n * 2 + n * n
    o += (4 - o % 4) % 4
    o += obst_n * obst_n * 2
    tree_count = struct.unpack_from('<H', b, o)[0]
    o += 4
    t = np.frombuffer(b, np.dtype([('x', '<i2'), ('z', '<i2'), ('y', '<i2'), ('size', 'u1'), ('kind', 'u1')]), tree_count, o)
    o += tree_count * 8
    o += (4 - o % 4) % 4
    cls = np.frombuffer(b, 'u1', class_n * class_n, o).reshape(class_n, class_n)
    return {'cls': cls, 'trees': t, 'ox': ox, 'oz': oz}


def regions(src):
    for name in sorted(os.listdir(src)):
        if not (name.startswith('r_') and name.endswith('.bin')):
            continue
        data = inflate(os.path.join(src, name))
        if data[:4] != MAGIC:
            raise SystemExit(f'{name}: not a region bundle')
        count = struct.unpack_from('<I', data, 4)[0]
        for i in range(count):
            yield (data, *struct.unpack_from('<iiIIII', data, 8 + i * 24))


def roof_lo(seed, shape):
    """buildingMaterial: the roof's lo, its patches' mean. A shaped roof is its slopes."""
    tone = (np.modf(seed * 0.61803)[0] - 0.5) * 0.12
    kind = np.modf(seed * 0.4141)[0]
    flat = np.where(kind < 0.55, -0.06, np.where(kind < 0.8, -0.34, 0.0)) + tone
    return np.where(shape >= 2, -0.36 + tone * 0.5, flat)


def wall_lo(seed, arch):
    """buildingMaterial: a far wall's lo, the windows gone into its flat tone."""
    tone = (np.modf(seed * 0.61803)[0] - 0.5) * 0.12
    return tone - 0.3 * COVER[np.minimum(arch & 15, len(COVER) - 1)]


def tree_scale(kind, size):
    s = np.maximum(0.3, size)
    return np.where(kind == 0, s, 0.78 + 0.5 * (s - 0.75))


def quant(a, q):
    """Bytes around 128 on a coarser grid (128, the zero, stays exact)."""
    return np.clip(128 + np.rint((a.astype(np.float32) - 128) / q) * q, 0, 255).astype(np.uint8)


def bake(slug, cell):
    t0 = time.perf_counter()
    src = os.path.join(ROOT, 'public', 'city', slug)
    man = json.load(open(os.path.join(src, 'city.json'), encoding='utf8'))
    ts, class_n = man['tileSize'], man['classN']
    min_x, min_z, max_x, max_z = man['bounds']
    W, H = round((max_x - min_x) / cell), round((max_z - min_z) / cell)
    texel = ts / class_n
    per_cell = round(cell / texel)  # texels per cell edge
    cells_tile = class_n // per_cell
    if per_cell * cells_tile != class_n or cells_tile * cell != ts:
        raise SystemExit(f'cell {cell} m does not divide a {ts} m tile of {class_n} texels')

    # ---- every tile's ground and every record's numbers
    tiles = {}
    rec = {k: [] for k in ('top', 'ground', 'arch', 'seed', 'shape', 'source')}
    rings = []
    base = 0
    for data, tx, tz, b_off, b_len, t_off, t_len in regions(src):
        if t_len:
            tiles[(tx, tz)] = parse_terrain(memoryview(data)[t_off:t_off + t_len], class_n)
        if b_len:
            b = parse_buildings(memoryview(data)[b_off:b_off + b_len])
            for k in rec:
                rec[k].append(b[k])
            n = len(b['top'])
            rings.append((base, b['vstart'], b['x'], b['z']))
            base += n
    for k in rec:
        rec[k] = np.concatenate(rec[k]) if rec[k] else np.zeros(0)
    n_rec = base
    t_read = time.perf_counter() - t0

    # ---- rasterise: every tile a grid of record ids at the class texture's 2 m, the highest record on top
    ids = {k: Image.new('I', (class_n, class_n), 0) for k in tiles}
    draws = {k: ImageDraw.Draw(v) for k, v in ids.items()}
    tops = rec['top']
    order = np.argsort(tops, kind='stable')
    where = np.zeros(n_rec, np.int64)  # record -> its tile's entry in rings
    local = np.zeros(n_rec, np.int64)
    for e, (first, vstart, _, _) in enumerate(rings):
        where[first:first + len(vstart) - 1] = e
        local[first:first + len(vstart) - 1] = np.arange(len(vstart) - 1)
    for r in order.tolist():
        first, vstart, xs, zs = rings[where[r]]
        s, e = vstart[local[r]], vstart[local[r] + 1]
        if e - s < 3:
            continue
        x, z = xs[s:e], zs[s:e]
        x0, x1, z0, z1 = x.min(), x.max(), z.min(), z.max()
        for tz in range(int(z0 // ts), int(z1 // ts) + 1):
            for tx in range(int(x0 // ts), int(x1 // ts) + 1):
                d = draws.get((tx, tz))
                if d is None:
                    continue
                # (pixel centers are PIL's integer coordinates)
                xy = np.empty((e - s) * 2)
                xy[0::2] = (x - tx * ts) / texel - 0.5
                xy[1::2] = (z - tz * ts) / texel - 0.5
                d.polygon(xy.tolist(), fill=int(r + 1))
    del draws
    t_stamp = time.perf_counter() - t0

    id_grid = {k: np.asarray(im, np.int32) for k, im in ids.items()}
    del ids

    above = np.maximum(rec['top'] - rec['ground'], 0).astype(np.float32) if n_rec else np.zeros(0, np.float32)
    r_above = np.concatenate([[0], above]).astype(np.float32)
    r_lo = np.concatenate([[0], roof_lo(rec['seed'], rec['shape'])]) if n_rec else np.zeros(1)
    r_wall = np.concatenate([[0], wall_lo(rec['seed'], rec['arch'])]) if n_rec else np.zeros(1)
    r_src = np.concatenate([[0], (rec['source'].astype(np.int32) >> 3) & 7]) if n_rec else np.zeros(1, np.int32)

    # ---- the planes
    L = Luma()
    cls_p = np.full((H, W), NONE, np.uint8)
    tone_p = np.full((H, W), 128, np.uint8)
    height_p = np.zeros((H, W), np.uint8)
    wall_p = np.zeros((H, W), np.uint8)
    wtone_p = np.full((H, W), 128, np.uint8)
    built = 0
    defaulted = 0
    neighbours = 0
    tree_total = 0
    tone_ramp = {}

    def cells(a):
        return a.reshape(cells_tile, per_cell, cells_tile, per_cell)

    for (tx, tz), t in tiles.items():
        c = t['cls']
        g = id_grid[(tx, tz)]
        roofed = g > 0
        # crowns over what isn't roof
        crown = np.zeros((class_n, class_n), bool)
        tr = t['trees']
        if len(tr):
            tree_total += len(tr)
            im = Image.new('1', (class_n, class_n), 0)
            d = ImageDraw.Draw(im)
            kinds = np.minimum(tr['kind'], 2)
            rad = CROWN_R[kinds] * tree_scale(kinds, tr['size'] / 100.0) / texel
            px = (t['ox'] + tr['x'] / 10.0 - tx * ts) / texel - 0.5
            pz = (t['oz'] + tr['z'] / 10.0 - tz * ts) / texel - 0.5
            for x, z, r in zip(px.tolist(), pz.tolist(), rad.tolist()):
                d.ellipse((x - r, z - r, x + r, z + r), fill=1)
            crown = np.asarray(im, bool) & ~roofed & (c != WATER)
        # what is on top of every texel: its class, then roof, then crown
        kind = c.astype(np.int32).copy()
        kind[roofed] = ROOF
        kind[crown] = TREE
        los = L.lo[kind]
        los = np.where(roofed, r_lo[g], los)
        Y = L.luma(L.ramp[kind], los)
        water = kind == WATER
        Yc = cells((Y * ~water).astype(np.float32)).sum(axis=(1, 3))
        nc = cells(~water).sum(axis=(1, 3))
        ground_counts = np.stack([cells((c == v) & ~roofed).sum(axis=(1, 3)) for v in range(11)])
        mode = ground_counts.argmax(axis=0)
        share = per_cell * per_cell
        roof_s = cells(roofed).sum(axis=(1, 3)) / share
        tree_s = cells(crown).sum(axis=(1, 3)) / share
        out = mode.copy()
        out[(tree_s >= TREE_SHARE) & (mode != WATER)] = TREE
        out[roof_s >= ROOF_SHARE] = ROOF
        # brightness back onto the cell's own ramp, around its class
        res = np.zeros_like(Yc)
        for v in np.unique(out):
            if v == WATER:
                continue
            m = out == v
            y = Yc[m] / np.maximum(nc[m], 1)
            res[m] = L.to_lo(L.ramp[v], y) - L.lo[v]
        tone = quant(np.clip((res / TONE_K + 0.5) * 255, 0, 255), TONE_Q)
        tone[out == WATER] = 128
        # height, walls
        hg = r_above[g]
        top_h = cells(hg).max(axis=(1, 3))
        mean_h = cells(hg).mean(axis=(1, 3))
        hq = np.where(top_h > 0, np.clip(np.ceil(top_h / HEIGHT_STEP), 1, 255), 0).astype(np.uint8)
        wall = np.clip(np.rint(np.minimum(1, mean_h / cell) * 255 / WALL_Q) * WALL_Q, 0, 255).astype(np.uint8)
        covered = cells(roofed).sum(axis=(1, 3))
        wlo = cells((r_wall[g] * roofed).astype(np.float32)).sum(axis=(1, 3)) / np.maximum(covered, 1)
        wtone = np.where(covered > 0, np.clip(np.rint(((wlo - WALL_LO) / TONE_K + 0.5) * 255), 0, 255), 128).astype(np.uint8)
        # the QA line: where the cell's top came from
        flat = cells(hg).transpose(0, 2, 1, 3).reshape(cells_tile, cells_tile, -1)
        ids_flat = cells(g).transpose(0, 2, 1, 3).reshape(cells_tile, cells_tile, -1)
        best = np.take_along_axis(ids_flat, flat.argmax(axis=2)[:, :, None], axis=2)[:, :, 0]
        has = top_h > 0
        built += int(has.sum())
        defaulted += int((has & (r_src[best] == 0)).sum())
        neighbours += int((has & (r_src[best] == 5)).sum())

        cx, cz = round((tx * ts - min_x) / cell), round((tz * ts - min_z) / cell)
        if cx < 0 or cz < 0 or cx + cells_tile > W or cz + cells_tile > H:
            continue
        cls_p[cz:cz + cells_tile, cx:cx + cells_tile] = out
        tone_p[cz:cz + cells_tile, cx:cx + cells_tile] = tone
        height_p[cz:cz + cells_tile, cx:cx + cells_tile] = hq
        wall_p[cz:cz + cells_tile, cx:cx + cells_tile] = wall
        wtone_p[cz:cz + cells_tile, cx:cx + cells_tile] = wtone

    # ---- wallTone per block: the mean of the walls in it
    bh, bw = H // WALL_BLOCK * WALL_BLOCK, W // WALL_BLOCK * WALL_BLOCK
    built_cell = (wall_p > 0).astype(np.float32)
    def blocks(a):
        return a[:bh, :bw].reshape(bh // WALL_BLOCK, WALL_BLOCK, bw // WALL_BLOCK, WALL_BLOCK).sum(axis=(1, 3))
    wt = blocks((wtone_p.astype(np.float32) - 128) * built_cell) / np.maximum(blocks(built_cell), 1)
    wtone_p[:bh, :bw] = quant(128 + np.repeat(np.repeat(wt, WALL_BLOCK, axis=0), WALL_BLOCK, axis=1), TONE_Q)

    # ---- no tile here: far.bin's 32 m class
    far = inflate(os.path.join(src, 'far.bin'))
    n_box, fw, fh, fx, fz, fc = struct.unpack_from('<4xIIIfff', far, 0)
    o = 28 + n_box * 28 + n_box * 4 + fw * fh * 2
    far_cls = np.frombuffer(far, 'u1', fw * fh, o).reshape(fh, fw)
    jj, ii = np.nonzero(cls_p == NONE)
    fi = np.clip(np.rint((min_x + (ii + 0.5) * cell - fx) / fc).astype(np.int64), 0, fw - 1)
    fj = np.clip(np.rint((min_z + (jj + 0.5) * cell - fz) / fc).astype(np.int64), 0, fh - 1)
    cls_p[jj, ii] = far_cls[fj, fi]
    no_tile = len(jj)

    # ---- write
    planes = [cls_p, tone_p, height_p, np.zeros((H, W), np.uint8), wall_p, wtone_p]
    head = struct.pack('<4sIIffffffHH', MAGIC, W, H, cell, 0.0, min_x, 0.0, cell, min_z, 0, int(cell))
    name = f'far{int(cell)}.bin'
    blob = gzip.compress(head + b''.join(p.tobytes() for p in planes), compresslevel=9, mtime=0)
    with open(os.path.join(src, name), 'wb') as f:
        f.write(blob)
    wall_s = time.perf_counter() - t0

    # ---- what every city must report
    def gz(p):
        return len(gzip.compress(p.tobytes(), compresslevel=9, mtime=0))

    land = (cls_p != WATER) & (cls_p != NONE)
    hist = {}
    tones = {}
    for v in range(len(CLASS_NAMES)):
        m = cls_p == v
        hist[CLASS_NAMES[v]] = int(m.sum())
        if m.any():
            bins = np.bincount(tone_p[m] // 16, minlength=16)
            lo = L.lo[v] + (tone_p[m].astype(float) / 255 - 0.5) * TONE_K
            tones[CLASS_NAMES[v]] = {'lo_mean': round(float(lo.mean()), 4), 'lo_sd': round(float(lo.std()), 4), 'bins16': bins.tolist()}
    return {
        'slug': slug, 'cell': cell, 'W': W, 'H': H, 'records': n_rec, 'tiles': len(tiles), 'trees': tree_total,
        'cells_no_tile': no_tile,
        'seconds': {'read': round(t_read, 2), 'stamp': round(t_stamp - t_read, 2), 'total': round(wall_s, 2)},
        'bytes': {'file': len(blob), 'class': gz(cls_p), 'tone': gz(tone_p), 'height': gz(height_p), 'wall': gz(wall_p), 'wallTone': gz(wtone_p), 'path': name},
        'class_hist': hist, 'tone_by_class': tones,
        'land_cells': int(land.sum()), 'cells_with_building': built,
        'share_cells_with_building': round(built / max(1, int(land.sum())), 4),
        'share_height_default': round(defaulted / max(1, built), 4), 'share_height_neighbours': round(neighbours / max(1, built), 4),
    }, planes, L


# ---- a look at the planes: what each cell would be at REF_LIGHT, on the game's own ramps
def sheet(planes, L, out_dir, slug):
    cls_p, tone_p, height_p, _, wall_p, wtone_p = planes
    os.makedirs(out_dir, exist_ok=True)
    text = open(os.path.join(ROOT, 'src', 'render', 'palette.ts'), encoding='utf8').read()
    ramps = {n: re.findall(r'#([0-9a-fA-F]{6})', b) for n, b in re.findall(r"\[Ramp\.(\w+)\]:\s*\[([^\]]+)\]", text)}
    rgb = np.zeros((*cls_p.shape, 3), np.uint8)
    for v, (ramp, _) in enumerate(CLASSES):
        m = cls_p == v
        if not m.any():
            continue
        lo = L.lo[v] + (tone_p[m].astype(float) / 255 - 0.5) * TONE_K
        s = np.clip(np.rint((REF_LIGHT + lo) * 7), 0, 7).astype(int)
        table = np.array([[int(h[i:i + 2], 16) for i in (0, 2, 4)] for h in ramps[ramp]], np.uint8)
        rgb[m] = table[s]
    Image.fromarray(rgb).save(os.path.join(out_dir, f'plane-{slug}-class.png'))
    Image.fromarray(np.clip(height_p.astype(int) * 3, 0, 255).astype(np.uint8)).save(os.path.join(out_dir, f'plane-{slug}-height.png'))
    Image.fromarray(wall_p).save(os.path.join(out_dir, f'plane-{slug}-wall.png'))
    Image.fromarray(wtone_p).save(os.path.join(out_dir, f'plane-{slug}-walltone.png'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('slug')
    ap.add_argument('--cell', type=int, default=16)
    ap.add_argument('--report')
    ap.add_argument('--png')
    a = ap.parse_args()
    rep, planes, L = bake(a.slug, float(a.cell))
    if a.report:
        os.makedirs(os.path.dirname(a.report) or '.', exist_ok=True)
        json.dump(rep, open(a.report, 'w'), indent=1)
    if a.png:
        sheet(planes, L, a.png, a.slug)
    b = rep['bytes']
    print(f"{a.slug}: {rep['W']} x {rep['H']} at {a.cell} m, {rep['records']} records, {rep['seconds']['total']} s, {b['file'] / 1000:.0f} KB "
          f"(class {b['class'] / 1000:.0f}, tone {b['tone'] / 1000:.0f}, height {b['height'] / 1000:.0f}, wall {b['wall'] / 1000:.0f}, wallTone {b['wallTone'] / 1000:.0f}); "
          f"{rep['cells_with_building']} cells with a building, height default {rep['share_height_default'] * 100:.1f} %, neighbours {rep['share_height_neighbours'] * 100:.1f} %")


if __name__ == '__main__':
    main()
