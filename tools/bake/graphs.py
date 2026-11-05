#!/usr/bin/env python3
"""Life's graphs for a baked city (docs/specs/earth/CONTRACT.md 1.2 and 1.3; the plan is docs/specs/earth/GRAPHS.md),
from an archive of Overture's raw row groups (tools/bake/fetch_archive.py) and the city's own baked tiles, which it reads
and never changes.

Writes, beside the tiles in public/city/<slug>/ (or --out):
  g_<rx>_<rz>.bin   one for every cell inside the bounds with anything in it (C1), listed in city.json's life.regions, 'SBG1'
  routes.bin        'SBC1' (C7): the ferry routes that touch the map, whole; their terminals; the map's marinas; airports
  gkeys.bin         'SBK1': every id and its source key, for W2, in tools/world/data/<slug>/ (the repo, not the site)
  checks.json.gz    beside it, for W1: the rules' places and the land along the ferries past the map (C3)
  city.json         gains "life" (the files' versions and the bake's counts), "vdatum", "geoid" and "geoidSpread"
The byte layouts are written once, in src/world/lifeData.ts, which reads them.

How it streams (one process under about 1 GB, at below-normal priority, one thread for Arrow and OpenBLAS):
  1 read     only the row groups whose bbox statistics touch the map, BATCH rows at a time, only the columns it needs.
             Each segment is cut into pieces (at its connectors, where a rule's range starts or ends, at region lines
             and at the map's bounds) and each piece is appended to its region's spill file in .cache/<slug>/graph/.
             Areas the same way, clipped to their regions. Decks and tunnels are kept whole: they're few
  2 global   keys and ids, pieces numbered along their ways, portals, signals and stops, the decks' and tunnels' heights
  3 regions  one region's spill and the tiles around it, nothing else: heights, shapes draped, areas cut, its file
  4 routes.bin, gkeys.bin, city.json

usage: python -I tools/bake/graphs.py <slug> <archive dir> [--region=rx,rz] [--out=DIR] [--keep]
  --region  only that region's pieces and areas (a trial: its ids differ from a whole bake's); city.json untouched
  --out     where the files go (default public/city/<slug>/)
  --keep    keep the spill files
"""
import os
import sys

os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')  # the thread pools under numpy reserve ~470 MB of commit otherwise
os.environ.setdefault('OMP_NUM_THREADS', '1')

import csv
import glob
import gzip
import heapq
import json
import math
import pickle
import shutil
import struct
import time
from collections import OrderedDict, defaultdict

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
import shapely
from pyproj import Geod, Transformer

pa.set_cpu_count(1)
pa.set_io_thread_count(1)
pa.set_memory_pool(pa.system_memory_pool())

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BATCH = 4096
CAP_MB = float(os.environ.get('SB_GRAPHS_CAP_MB', 950))   # a pass stops past this, working set or private bytes
WATER_Y = -0.6                 # src/world/tiles.ts
GRAPH_VERSION = (1, 2)         # major, minor: 1.1 sets NO_CARS (C6), 1.2 has the lakes as OPEN_WATER at the grid's height (C8)
ROUTES_VERSION = (1, 0)
KEYS_VERSION = (1, 0)
KEY_KINDS = ('node', 'edge', 'area', 'ferry', 'terminal', 'marina', 'airport')   # gkeys.bin's kind byte

# CONTRACT.md 1.2
KIND = {'ROAD': 1, 'FOOT': 2, 'RAIL': 3, 'FERRY': 4, 'WATER': 5, 'TAXI': 6, 'RUNWAY': 7}
KIND_NAME = {v: k for k, v in KIND.items()}
ROAD_CLASS = {'motorway': 1, 'trunk': 2, 'primary': 3, 'secondary': 4, 'tertiary': 5, 'residential': 6, 'unclassified': 7,
              'living_street': 8, 'service': 9, 'track': 10, 'unknown': 11}
FOOT_CLASS = {'FOOTWAY': 1, 'SIDEWALK': 2, 'CROSSING': 3, 'PATH': 4, 'STEPS': 5, 'CYCLEWAY': 6, 'PEDESTRIAN': 7}
FOOT_OF = {'footway': 'FOOTWAY', 'path': 'PATH', 'bridleway': 'PATH', 'steps': 'STEPS', 'cycleway': 'CYCLEWAY',
           'pedestrian': 'PEDESTRIAN'}
DIR_BOTH, DIR_FORWARD, DIR_BACKWARD = 0, 1, 2
BRIDGE, TUNNEL, UNDRAWN, LINK, ROUNDABOUT, SEASONAL, NO_CARS = 1, 2, 4, 8, 16, 32, 64   # ROUNDABOUT, SEASONAL: no source, never set
PORTAL, SIGNAL, STOP = 1, 2, 4
AREA = {'PLAZA': 1, 'PARK': 2, 'BEACH': 3, 'MARINA': 4, 'FERRY_TERMINAL': 5, 'CRUISE_TERMINAL': 6, 'APRON': 7, 'OPEN_WATER': 8}
AREA_NAME = {v: k for k, v in AREA.items()}

# what the ground bake leaves out (osm.py, segments()): the same judgement, made on the whole segment
GROUND_SKIPS = {'is_bridge', 'is_tunnel', 'is_indoor', 'is_covered', 'is_under_construction'}
LEFT_OUT = {'is_indoor', 'is_under_construction', 'is_abandoned'}   # as the bridges spec leaves them out
CAR_MODES = {'vehicle', 'motor_vehicle', 'car'}
SNAP_M = 0.5                   # a range's end this close to a connector is the connector
MERGE_M = 0.01                 # cuts closer than this are one
DM_M = 0.1                     # cuts with no connector this close would share a key (C4: a place in whole dm): one
SIMPLIFY_M = 0.25              # plan tolerance, osm.py's footprints'
DRAPE_STEP, DRAPE_TOL = 4.0, 0.4   # every 4 m along a land edge within 0.4 m of the grid (the contract's 0.5 less dm steps)
GRID_M = 4.0                   # the terrain grid's step: tiles' 65 heights over 256 m
AREA_CELL, AREA_TOL = 64.0, 0.4   # areas: a TIN of the 4 m grid from a 64 m lattice, within 0.4 m at the grid's points
WATER_SIMPLIFY = 0.9           # OPEN_WATER's staircase, under half a 2 m texel
LAKE_M = 2.0                   # a WATER texel the grid holds higher than this is a lake, not the sea (sea())
SIGNAL_M = 0.5
DRAWN_REACH_M = 22.0           # a deck City draws, from its line: the Golden Gate's half, 13.5 m, and OSM's sidewalks 9-22 m out (C2)
DRAWN_COS = math.cos(math.radians(30))   # heading along it, not across
CHECK_LAND_M = 300.0           # W1's land along the ferries past the map (C3), each side of the routes
FOLLOW_M = 15.0                # a sidewalk on a bridge rides its carriageway's deck this close, at one level
FOOT_END_M = 2 * DRAWN_REACH_M  # a foot on the ground this far inside a drawn deck's ends is a ramp's beside it, not the deck's own
STAIR_CHAIN_M = 100.0          # steps from a deck's foot, this long or less, are the stair up to it (stair_chains())
STAIR = 3                      # the grade class of a stair to a deck (decks.py STAIR_MAX)
STOP_ALONG_M, STOP_NEAR_M = 15.0, 3.0
TERMINAL_M = 150.0             # a route's end to its terminal
BERTH_DEFAULT_M = 60.0         # ESTIMATE: a ferry slip
BERTH_AREA_M2 = 450.0          # Schoonmaker Point's 161 berths in 72,396 m2: an ESTIMATE everywhere else
AIRPORT_KM = 50.0
FEET = 0.3048
MPH = 1.609344

# id ranges a kind (u32), FNV-1a of the source key, probed in key order (bake.py's IdAlloc)
ID_RANGES = {'node': (0, 1 << 30), 'edge': (1 << 30, 1 << 30), 'area': (1 << 31, 1 << 29),
             'ferry': ((1 << 31) + (1 << 29), 1 << 26), 'terminal': ((1 << 31) + (1 << 29) + (1 << 26), 1 << 26),
             'marina': ((1 << 31) + (1 << 29) + (2 << 26), 1 << 26), 'airport': ((1 << 31) + (1 << 29) + (3 << 26), 1 << 26)}


def log(*a):
    print(*a, flush=True)


def load_module(name):
    import importlib.util
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location('sb_' + name, os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ------------------------------------------------------------------ memory, priority

def mem():
    """(working set, its peak, private bytes, their peak), MB."""
    if os.name != 'nt':
        import resource
        r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
        return (r, r, r, r)
    import ctypes
    from ctypes import wintypes as wt

    class PMC(ctypes.Structure):
        _fields_ = [('cb', wt.DWORD), ('PageFaultCount', wt.DWORD)] + [(n, ctypes.c_size_t) for n in (
            'PeakWorkingSetSize', 'WorkingSetSize', 'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage',
            'QuotaPeakNonPagedPoolUsage', 'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage')]
    c = PMC()
    c.cb = ctypes.sizeof(PMC)
    k = ctypes.windll.kernel32
    k.GetCurrentProcess.restype = ctypes.c_void_p
    ps = ctypes.windll.psapi
    ps.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), wt.DWORD]
    ps.GetProcessMemoryInfo(k.GetCurrentProcess(), ctypes.byref(c), c.cb)
    m = float(1 << 20)
    return (c.WorkingSetSize / m, c.PeakWorkingSetSize / m, c.PagefileUsage / m, c.PeakPagefileUsage / m)


def guard(where):
    ws, _, pb, _ = mem()
    if ws > CAP_MB or pb > CAP_MB:
        raise SystemExit(f'graphs: {where}: {ws:.0f} MB working set, {pb:.0f} MB private, over {CAP_MB} MB: stopped')


def below_normal():
    if os.name == 'nt':
        import ctypes
        k = ctypes.windll.kernel32
        k.GetCurrentProcess.restype = ctypes.c_void_p
        k.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        k.SetPriorityClass(k.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL_PRIORITY_CLASS
    else:
        os.nice(5)


# ------------------------------------------------------------------ keys and ids

def fnv(s):
    h = 2166136261
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def alloc(kind, keys):
    """{key: id} for one kind: FNV-1a of the key into the kind's range, a collision probing to the next free id, in key
    order over the whole city. Returns (ids, collisions)."""
    lo, n = ID_RANGES[kind]
    used = set()
    out = {}
    coll = 0
    for k in sorted(keys):
        h = fnv(k) % n
        while lo + h in used:
            h = (h + 1) % n
            coll += 1
        used.add(lo + h)
        out[k] = lo + h
    return out, coll


def osm_key(sources, prefixes='wnr'):
    """The OSM element a row came from, without its @version, else None. Only the row's own sources (property '')."""
    for s in sources or []:
        if s and s.get('dataset') == 'OpenStreetMap' and not s.get('property') and s.get('record_id') \
                and s['record_id'][0] in prefixes:
            return s['record_id'].split('@', 1)[0]
    return None


def dm_key(way, x, z):
    """A node with no connector of its own, a portal, a cut where a range ends or at the bounds (C4, 0.6): its way and its
    own place in whole decimetres of the map."""
    return f'{way}@{int(round(x * 10))},{int(round(z * 10))}'


# ------------------------------------------------------------------ the archive

def release_dir(archive):
    rels = sorted(d for d in os.listdir(os.path.join(archive, 'overture')) if os.path.isdir(os.path.join(archive, 'overture', d)))
    if not rels:
        raise SystemExit(f'graphs: no Overture release in {archive}/overture')
    return os.path.join(archive, 'overture', rels[-1])


def rg_touching(path, box):
    md = pq.ParquetFile(path).metadata
    out = []
    for i in range(md.num_row_groups):
        rg = md.row_group(i)
        st = {}
        for j in range(rg.num_columns):
            c = rg.column(j)
            if c.path_in_schema in ('bbox.xmin', 'bbox.xmax', 'bbox.ymin', 'bbox.ymax') and c.statistics is not None \
                    and c.statistics.has_min_max:
                st[c.path_in_schema] = c.statistics
        if len(st) < 4 or (st['bbox.xmin'].min <= box[2] and st['bbox.xmax'].max >= box[0]
                           and st['bbox.ymin'].min <= box[3] and st['bbox.ymax'].max >= box[1]):
            out.append(i)
    return out


def batches(rel, typ, box, cols, stats=None, keep=None):
    """Rows of one Overture type whose bbox touches box (lon0, lat0, lon1, lat1), as filtered RecordBatches of at most
    BATCH rows. keep: an extra mask over a batch (a function of it), e.g. a class filter, applied before the decode."""
    files = sorted(glob.glob(os.path.join(rel, 'raw', typ, '*.parquet')))
    touched = 0
    for f in files:
        rgs = rg_touching(f, box)
        if not rgs:
            continue
        touched += len(rgs)
        pf = pq.ParquetFile(f)
        for b in pf.iter_batches(batch_size=BATCH, row_groups=rgs, columns=cols, use_threads=False):
            bb = b.column('bbox')
            m = pc.and_(pc.and_(pc.greater_equal(bb.field('xmax'), box[0]), pc.less_equal(bb.field('xmin'), box[2])),
                        pc.and_(pc.greater_equal(bb.field('ymax'), box[1]), pc.less_equal(bb.field('ymin'), box[3])))
            if keep is not None:
                m = pc.and_(m, keep(b))
            if not pc.any(m).as_py():
                continue
            yield b.filter(m)
            guard(f'reading {typ}')
    if stats is not None:
        stats.setdefault('rowGroups', {})[typ] = [touched, len(files)]


def primary(names_col):
    """names.primary of a batch's names column (a struct with only that field read, or the whole names)."""
    return names_col.field('primary').to_pylist()


# ------------------------------------------------------------------ the city's tiles

class Tiles:
    """The baked terrain, read from the packed r_<rx>_<rz>.bin regions as tiles.ts reads them, a few regions at a time.
    height(): bilinear over a tile's n x n grid as City.ts tileGround; cls(): the 2 m class raster's low 4 bits."""

    def __init__(self, city_dir, man, keep=12):
        self.dir = city_dir
        self.T = float(man['tileSize'])
        self.n = int(man['terrainN'])
        self.N = int(man.get('classN', 128))
        self.rs = int(man.get('regionSize', 4))
        self.have = {(t[0], t[1]) for t in man['tiles']}
        self.cache = OrderedDict()
        self.keep = keep

    def _region(self, rx, rz):
        key = (rx, rz)
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        out = {}
        p = os.path.join(self.dir, f'r_{rx}_{rz}.bin')
        if os.path.exists(p):
            buf = open(p, 'rb').read()
            if buf[:2] == b'\x1f\x8b':
                buf = gzip.decompress(buf)
            cnt = struct.unpack_from('<I', buf, 4)[0]
            for i in range(cnt):
                tx, tz, bo, bl, to, tl = struct.unpack_from('<iiIIII', buf, 8 + i * 24)
                if tl:
                    out[(tx, tz)] = self._terrain(buf, to)
        self.cache[key] = out
        while len(self.cache) > self.keep:
            self.cache.popitem(last=False)
        return out

    def _terrain(self, buf, o0):
        tx, tz, n, obstN, cell, ox, oz = struct.unpack_from('<iiHHfff', buf, o0 + 4)
        o = o0 + 28
        h = (np.frombuffer(buf, '<i2', n * n, o).astype(np.float32) / np.float32(10)).reshape(n, n)
        o += n * n * 2 + n * n
        o += (-(o - o0)) % 4
        o += obstN * obstN * 2
        tc = struct.unpack_from('<H', buf, o)[0]
        o += 4 + tc * 8
        o += (-(o - o0)) % 4
        cls = (np.frombuffer(buf, 'u1', self.N * self.N, o) & 15).reshape(self.N, self.N).copy()
        return (h.astype(np.float64), cls, float(ox), float(oz), float(cell), n)

    def tile(self, tx, tz):
        if (tx, tz) not in self.have:
            return None
        return self._region(tx // self.rs, tz // self.rs).get((tx, tz))

    def tile_of(self, x, z):
        """The tile a point reads: floor of its place, or the one west or north of it when it sits on that tile's edge
        and floor's has none (the map's east and south bounds)."""
        T = self.T
        tx, tz = math.floor(x / T), math.floor(z / T)
        if (tx, tz) in self.have:
            return tx, tz
        ex, ez = x == tx * T, z == tz * T
        cands = []
        if ex:
            cands.append((tx - 1, tz))
        if ez:
            cands.append((tx, tz - 1))
        if ex and ez:
            cands.append((tx - 1, tz - 1))
        for c in cands:
            if c in self.have:
                return c
        return None

    def sample(self, xs, zs):
        """(heights, classes) at points: nan and 255 where no tile."""
        xs = np.atleast_1d(np.asarray(xs, float))
        zs = np.atleast_1d(np.asarray(zs, float))
        h = np.full(xs.shape, np.nan)
        c = np.full(xs.shape, 255, np.uint8)
        if not len(xs):
            return h, c
        T = self.T
        tx = np.floor(xs / T).astype(np.int64)
        tz = np.floor(zs / T).astype(np.int64)
        if (tx == tx[0]).all() and (tz == tz[0]).all():
            groups = [((int(tx[0]), int(tz[0])), np.arange(len(xs)))]
        else:
            code = (tx + (1 << 20)) * (1 << 21) + (tz + (1 << 20))
            uk, inv = np.unique(code, return_inverse=True)
            inv = inv.reshape(-1)
            groups = [((int(u // (1 << 21)) - (1 << 20), int(u % (1 << 21)) - (1 << 20)), np.nonzero(inv == g)[0])
                      for g, u in enumerate(uk)]
        keys = {}
        for k, sel in groups:
            if k in self.have:
                keys.setdefault(k, []).extend(sel.tolist())
                continue
            edge = sel[(xs[sel] == k[0] * T) | (zs[sel] == k[1] * T)]   # only a point on the tile's west or north edge reads a neighbour
            for i in edge:
                k2 = self.tile_of(float(xs[i]), float(zs[i]))
                if k2 is not None:
                    keys.setdefault(k2, []).append(int(i))
        for k, idx in keys.items():
            t = self.tile(*k)
            if t is None:
                continue
            hh, cls, ox, oz, cell, n = t
            ii = np.array(idx)
            fx = np.clip((xs[ii] - ox) / cell, 0, n - 1.001)
            fz = np.clip((zs[ii] - oz) / cell, 0, n - 1.001)
            ix = np.floor(fx).astype(np.int64)
            iz = np.floor(fz).astype(np.int64)
            ax, az = fx - ix, fz - iz
            a, b = hh[iz, ix], hh[iz, ix + 1]
            cc, d = hh[iz + 1, ix], hh[iz + 1, ix + 1]
            h[ii] = (a * (1 - ax) + b * ax) * (1 - az) + (cc * (1 - ax) + d * ax) * az
            N = self.N
            ci = np.clip(np.floor((xs[ii] - ox) / T * N).astype(np.int64), 0, N - 1)
            cj = np.clip(np.floor((zs[ii] - oz) / T * N).astype(np.int64), 0, N - 1)
            c[ii] = cls[cj, ci]
        return h, c


# ------------------------------------------------------------------ geometry

def cumlen(xz):
    d = np.hypot(np.diff(xz[:, 0]), np.diff(xz[:, 1]))
    return np.concatenate([[0.0], np.cumsum(d)])


def point_at(xz, s, t):
    i = int(np.clip(np.searchsorted(s, t, side='right') - 1, 0, len(s) - 2))
    L = s[i + 1] - s[i]
    f = (t - s[i]) / L if L > 0 else 0.0
    return xz[i] + f * (xz[i + 1] - xz[i])


def sub_line(xz, s, t0, t1, p0, p1):
    inner = xz[(s > t0 + 1e-6) & (s < t1 - 1e-6)]
    return np.vstack([p0[None, :], inner, p1[None, :]])


def axis_cuts(xz, s, axis, step=None, values=()):
    """(t, value) where the line crosses x (axis 0) or z (axis 1) at a multiple of step, or at one of values."""
    a = xz[:, axis]
    a0, a1 = a[:-1], a[1:]
    lo, hi = np.minimum(a0, a1), np.maximum(a0, a1)
    hits = []
    if step:
        k0 = np.ceil(lo / step)
        k1 = np.floor(hi / step)
        for i in np.nonzero(k1 >= k0)[0]:
            for k in range(int(k0[i]), int(k1[i]) + 1):
                hits.append((int(i), k * step))
    for v in values:
        for i in np.nonzero((lo <= v) & (hi >= v))[0]:
            hits.append((int(i), float(v)))
    out = []
    for i, v in hits:
        if a1[i] == a0[i]:
            out.append((s[i], v))
            out.append((s[i + 1], v))
        else:
            f = (v - a0[i]) / (a1[i] - a0[i])
            out.append((s[i] + f * (s[i + 1] - s[i]), v))
    return out


def simplify_line(xz, tol):
    if len(xz) <= 2:
        return xz
    g = shapely.simplify(shapely.LineString(xz), tol, preserve_topology=False)
    c = np.asarray(g.coords)
    if len(c) < 2:
        return xz[[0, -1]]
    c[0], c[-1] = xz[0], xz[-1]
    return c


def simplify3(p, tol_xz, tol_y):
    """Douglas-Peucker on (x, z, y) points: kept wherever the chord misses one by tol_xz in plan or tol_y in height."""
    n = len(p)
    if n <= 2:
        return p
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    todo = [(0, n - 1)]
    while todo:
        i, j = todo.pop()
        if j <= i + 1:
            continue
        a, b = p[i], p[j]
        ab = b[:2] - a[:2]
        L2 = float(ab @ ab)
        q = p[i + 1:j]
        t = np.clip(((q[:, :2] - a[:2]) @ ab) / L2, 0, 1) if L2 > 0 else np.zeros(len(q))
        foot = a[:2] + t[:, None] * ab
        dxz = np.hypot(q[:, 0] - foot[:, 0], q[:, 1] - foot[:, 1])
        dy = np.abs(q[:, 2] - (a[2] + t * (b[2] - a[2])))
        e = np.maximum(dxz / tol_xz, dy / tol_y)
        k = int(np.argmax(e))
        if e[k] > 1:
            m = i + 1 + k
            keep[m] = True
            todo.append((i, m))
            todo.append((m, j))
    return p[keep]


def drape(xz, tiles):
    """A land edge's points with heights from the grid: the plan's points, and more wherever the straight line between
    two misses the grid by over DRAPE_TOL at any sample: every metre, and wherever it crosses one of the grid's lines,
    where the bilinear grid bends (4 m steps hid a 0.88 m miss over a bump, 2 m steps one of 0.84 m across a bend;
    between samples a metre apart the grid can't bulge more than a few centimetres). Returns (m, 3) x, z, y, heights as a
    mover stands there (stand()): never under the sea, WATER_Y with no tile."""
    ts, si = [], []
    TX = tiles.T / tiles.N
    for i in range(len(xz) - 1):
        p, q = xz[i], xz[i + 1]
        d = math.hypot(q[0] - p[0], q[1] - p[1])
        k = max(1, math.ceil(d))
        t = [np.arange(1, k + 1) / k]
        for a in (0, 1):
            if q[a] != p[a]:
                lo, hi = sorted((p[a], q[a]))
                g = np.arange(math.floor(lo / GRID_M) + 1, math.ceil(hi / GRID_M)) * GRID_M
                t.append((g - p[a]) / (q[a] - p[a]))
                # either side of a texel line, where stand() can step between the sea's surface and a grid under it
                tx = np.arange(math.floor(lo / TX) + 1, math.ceil(hi / TX)) * TX
                tt = (tx - p[a]) / (q[a] - p[a])
                t.extend([tt, tt - 0.06 / max(d, 1e-9), tt + 0.06 / max(d, 1e-9)])   # 6 cm: past the file's dm rounding
        t = np.unique(np.concatenate(t))
        t = t[t <= 1.0]   # (a texel line within 6 cm of the end); t = 1, the next plan point, stays last
        t = t[(t > 1e-9)]
        ts.append(t)
        si.append(np.full(len(t), i))
    t = np.concatenate(ts)
    si = np.concatenate(si)
    seg = np.diff(xz, axis=0)
    S = np.vstack([xz[:1], xz[si] + t[:, None] * seg[si]])
    vi = np.concatenate([[0], np.cumsum([len(x) for x in ts])])   # each plan point's index among the samples
    h, c = tiles.sample(S[:, 0], S[:, 1])
    h = stand(h, c)
    keep = np.zeros(len(S), bool)
    keep[vi] = True
    todo = [(int(vi[i]), int(vi[i + 1])) for i in range(len(seg))]
    while todo:
        i, j = todo.pop()
        if j <= i + 1:
            continue
        L = math.hypot(S[j, 0] - S[i, 0], S[j, 1] - S[i, 1])   # samples between two kept ones lie on one plan segment
        f = np.hypot(S[i + 1:j, 0] - S[i, 0], S[i + 1:j, 1] - S[i, 1]) / L if L > 0 else np.zeros(j - i - 1)
        e = np.abs(h[i] + f * (h[j] - h[i]) - h[i + 1:j])
        m = int(np.argmax(e))
        if e[m] > DRAPE_TOL:
            m += i + 1
            keep[m] = True
            todo.append((i, m))
            todo.append((m, j))
    return np.column_stack([S[keep], h[keep]])


# ------------------------------------------------------------------ rules on a segment

def covers(between, f):
    return between is None or (between[0] - 1e-9 <= f <= between[1] + 1e-9)


def range_ends(rules):
    out = []
    for r in rules or []:
        b = r.get('between') if r else None
        if b:
            out.extend(b)
    return out


def oneway_rule(r):
    """'forward' or 'backward' when this access rule makes a way one-way for cars, else None."""
    if not r or r.get('access_type') != 'denied':
        return None
    w = r.get('when') or {}
    hd = w.get('heading')
    if hd not in ('forward', 'backward'):
        return None
    if any(w.get(k) for k in ('during', 'using', 'recognized', 'vehicle')):
        return None
    mode = w.get('mode')
    if mode and not (set(mode) & CAR_MODES):
        return None
    return hd


def closed_rule(r):
    """True when this rule closes the way to motor vehicles both ways, at all times: denied, with no heading, time, use,
    recognition or vehicle condition, and no mode or a car's (a weight or height limit is a vehicle condition)."""
    if not r or r.get('access_type') != 'denied':
        return False
    w = r.get('when') or {}
    if w.get('heading') or any(w.get(k) for k in ('during', 'using', 'recognized', 'vehicle')):
        return False
    mode = w.get('mode')
    return not mode or bool(set(mode) & CAR_MODES)


def lets_cars_in(r):
    """True when this rule allows cars on some terms: allowed or designated, with no mode or a car's. A bus's or a taxi's
    alone doesn't (C6: Market Street's car-free blocks allow buses)."""
    if not r or r.get('access_type') not in ('allowed', 'designated'):
        return False
    mode = (r.get('when') or {}).get('mode')
    return not mode or bool(set(mode) & CAR_MODES)


def no_cars(rules, f):
    """C6's NO_CARS at a piece's middle f (pieces are cut at every access rule's range): a rule covering it closes it to
    motor vehicles, and none covering it lets cars in."""
    rs = [r for r in rules or [] if r and covers(r.get('between'), f)]
    return any(closed_rule(r) for r in rs) and not any(lets_cars_in(r) for r in rs)


def on_structure(level, tags):
    """Whether an area stands on a roof, a deck or a bridge rather than the ground: OSM's level tag when it has one
    (Mission Creek Park says 0 under a layer of 1), else location=roof or bridge=*, else Overture's level (OSM's
    layer) over 0."""
    t = dict(tags or [])
    lv = t.get('level')
    if lv is not None:
        try:
            return float(str(lv).split(';')[0]) > 0
        except ValueError:
            pass
    if t.get('location') in ('roof', 'rooftop') or t.get('bridge') not in (None, 'no'):
        return True
    return (level or 0) > 0


def speed_at(rules, f):
    best = None
    for r in rules or []:
        if not r or not covers(r.get('between'), f):
            continue
        ms = r.get('max_speed')
        if not ms or ms.get('value') is None:
            continue
        if best is None or (best.get('when') and not r.get('when')):
            best = r
    if best is None:
        return 0
    ms = best['max_speed']
    v = float(ms['value']) * (MPH if (ms.get('unit') or 'km/h') == 'mph' else 1.0)
    return int(min(255, max(0, round(v))))


# ------------------------------------------------------------------ the spill

class Spill:
    def __init__(self, d, prefix):
        self.d = d
        self.prefix = prefix
        self.buf = defaultdict(list)
        self.n = defaultdict(int)

    def path(self, r):
        return os.path.join(self.d, f'{self.prefix}_{r[0]}_{r[1]}.pkl')

    def add(self, r, rec):
        b = self.buf[r]
        b.append(rec)
        self.n[r] += 1
        if len(b) >= 2000:
            self.flush(r)

    def flush(self, r=None):
        for k in ([r] if r is not None else list(self.buf)):
            b = self.buf.get(k)
            if b:
                with open(self.path(k), 'ab') as f:
                    pickle.dump(b, f, protocol=pickle.HIGHEST_PROTOCOL)
                self.buf[k] = []

    def read(self, r):
        p = self.path(r)
        if not os.path.exists(p):
            return
        with open(p, 'rb') as f:
            while True:
                try:
                    chunk = pickle.load(f)
                except EOFError:
                    return
                yield from chunk


# ------------------------------------------------------------------ the bake

class Bake:
    def __init__(self, slug, archive, out=None, region=None, keep=False):
        self.slug = slug
        self.archive = archive
        self.rel = release_dir(archive)
        self.city = os.path.join(ROOT, 'public', 'city', slug)
        self.out = out or self.city
        self.only = region
        self.keep = keep
        self.man = json.load(open(os.path.join(self.city, 'city.json'), encoding='utf-8'))
        cfg_p = os.path.join(HERE, 'cities', slug + '.json')
        self.cfg = json.load(open(cfg_p, encoding='utf-8')) if os.path.exists(cfg_p) else {}
        m = self.man
        self.R = float(m['tileSize']) * int(m.get('regionSize', 4))
        self.bounds = [float(v) for v in m['bounds']]
        self.tile_regions = {(r[0], r[1]) for r in m['regions']}
        # C1: a graph file in every cell inside the bounds with anything in it, the open water with no City tile included
        bx0, bz0, bx1, bz1 = self.bounds
        self.regions = {(rx, rz) for rx in range(math.floor(bx0 / self.R), math.ceil(bx1 / self.R))
                        for rz in range(math.floor(bz0 / self.R), math.ceil(bz1 / self.R))}
        self.fwd = Transformer.from_crs('EPSG:4326', m['proj'], always_xy=True)
        self.inv = Transformer.from_crs(m['proj'], 'EPSG:4326', always_xy=True)
        x0, z0, x1, z1 = self.bounds
        gx, gz = np.meshgrid(np.linspace(x0, x1, 41), np.linspace(z0, z1, 41))
        lon, lat = self.inv.transform(gx.ravel(), -gz.ravel())
        pad = 0.0005
        self.box = (float(lon.min()) - pad, float(lat.min()) - pad, float(lon.max()) + pad, float(lat.max()) + pad)
        self.tiles = Tiles(self.city, m)
        self.decks = load_module('decks')
        self.cache = os.path.join(HERE, '.cache', slug, 'graph')
        self.stats = {'read': {}, 'dropped': defaultdict(int), 'rules': defaultdict(int)}
        # decks City draws (C2): today the landmark rows' [x, z, y] lines, the deck's top; bridges.bin's from step 5
        self.drawn_decks = [np.array(lm['deck'], float) for lm in m.get('landmarks', []) if lm.get('deck')]
        self.t0 = time.time()

    def xz(self, lon, lat):
        e, n = self.fwd.transform(np.asarray(lon, float), np.asarray(lat, float))
        return np.column_stack([np.asarray(e, float), -np.asarray(n, float)])

    def tf(self, c):
        e, n = self.fwd.transform(c[:, 0], c[:, 1])
        return np.column_stack([np.asarray(e, float), -np.asarray(n, float)])

    def lonlat(self, x, z):
        lon, lat = self.inv.transform(np.asarray(x, float), -np.asarray(z, float))
        return np.asarray(lon, float), np.asarray(lat, float)

    def inside(self, x, z, eps=0.0):
        x0, z0, x1, z1 = self.bounds
        return x0 - eps <= x <= x1 + eps and z0 - eps <= z <= z1 + eps

    def region_of(self, x, z):
        return (math.floor(x / self.R), math.floor(z / self.R))

    def note(self, what):
        ws, pws, pb, ppb = mem()
        log(f'  [{time.time() - self.t0:6.1f} s] {what}: working set {ws:.0f} MB (peak {pws:.0f}), private {pb:.0f} MB (peak {ppb:.0f})')

    # ---------------------------------------------------------- pass 1: connectors

    def read_connectors(self):
        ids, keys, xs, zs = [], [], [], []
        osm = 0
        for b in batches(self.rel, 'connector', self.box, ['id', 'sources', 'geometry', 'bbox'], self.stats['read']):
            g = shapely.from_wkb(b.column('geometry').to_numpy(zero_copy_only=False))
            c = shapely.get_coordinates(g)
            p = self.xz(c[:, 0], c[:, 1])
            gid = b.column('id').to_pylist()
            src = b.column('sources').to_pylist()
            for i in range(len(gid)):
                x, z = p[i]
                if not self.inside(x, z, 1.0):
                    continue
                k = osm_key(src[i], 'n')
                if k:
                    osm += 1
                ids.append(gid[i])
                keys.append(k or gid[i])
                xs.append(x)
                zs.append(z)
        self.con = {g: i for i, g in enumerate(ids)}
        self.con_key = keys
        self.con_xz = np.column_stack([xs, zs]) if xs else np.zeros((0, 2))
        self.stats['read']['connectors'] = [len(ids), osm]
        self.note(f'connectors: {len(ids)} in the map, {osm} name an OSM node')

    # ---------------------------------------------------------- pass 1: segments

    def read_segments(self):
        os.makedirs(self.cache, exist_ok=True)
        for f in glob.glob(os.path.join(self.cache, '*.pkl')):
            os.remove(f)
        self.spill = Spill(self.cache, 'e')
        self.checks = {'oneway': [], 'onewayConflicts': 0, 'noCars': []}
        self.special = []   # decks and tunnels, whole: (pid, region, rec)
        self.ferry_rows = {}  # the ferry routes that touch the map, whole: key -> [(gers, name, lonlat, end connector ids)]
        self.pid = 0
        cols = ['id', 'names.primary', 'sources', 'subtype', 'class', 'subclass', 'road_flags', 'rail_flags', 'level_rules',
                'connectors', 'access_restrictions', 'speed_limits', 'geometry', 'bbox']
        st = self.stats['rules']
        km = defaultdict(float)
        segs = defaultdict(int)
        for b in batches(self.rel, 'segment', self.box, cols, self.stats['read']):
            g = shapely.from_wkb(b.column('geometry').to_numpy(zero_copy_only=False))
            gid = b.column('id').to_pylist()
            names = primary(b.column('names'))
            src = b.column('sources').to_pylist()
            sub = b.column('subtype').to_pylist()
            cls = b.column('class').to_pylist()
            scl = b.column('subclass').to_pylist()
            rf = b.column('road_flags').to_pylist()
            lf = b.column('rail_flags').to_pylist()
            lv = b.column('level_rules').to_pylist()
            cn = b.column('connectors').to_pylist()
            ac = b.column('access_restrictions').to_pylist()
            sp = b.column('speed_limits').to_pylist()
            for i in range(len(gid)):
                line = g[i]
                if line is None or line.geom_type != 'LineString':
                    continue
                ll = np.asarray(line.coords)[:, :2]
                xz = self.xz(ll[:, 0], ll[:, 1])
                keep = np.concatenate([[True], np.hypot(*np.diff(xz, axis=0).T) > 1e-6])
                if keep.sum() < 2:
                    continue
                ll, xz = ll[keep], xz[keep]
                row = dict(id=gid[i], name=names[i], sources=src[i], subtype=sub[i], cls=cls[i], subclass=scl[i],
                           road_flags=rf[i], rail_flags=lf[i], level_rules=lv[i], connectors=cn[i], access=ac[i], speed=sp[i])
                n = self.cut(row, xz, km)
                if n:
                    segs[row['subtype'] or '?'] += 1
                if self.touched and row['subtype'] == 'water':
                    # routes.bin has every route that touches the map, whole, even one whose pieces here are all
                    # in cells with no tile (C1)
                    k = osm_key(row['sources'], 'w') or row['id']
                    ends = [c['connector_id'] for c in (row['connectors'] or []) if c and c.get('at') in (0.0, 1.0)]
                    self.ferry_rows.setdefault(k, []).append((row['id'], row['name'], ll, ends))
        self.spill.flush()
        self.stats['segments'] = dict(segs)
        self.stats['kmInside'] = {k: round(float(v) / 1000, 1) for k, v in sorted(km.items())}
        self.note(f'segments: {sum(segs.values())} touch the map ({dict(segs)}), {self.pid} pieces')

    def ways_of(self, row):
        """[(way key, (lo, hi) or None)] of the segment's own OSM ways."""
        out = []
        for s in row['sources'] or []:
            if s and s.get('dataset') == 'OpenStreetMap' and not s.get('property') and (s.get('record_id') or '').startswith('w'):
                out.append((s['record_id'].split('@', 1)[0], s.get('between')))
        return out

    def way_at(self, ways, f, after=True):
        best = None
        for k, b in ways:
            if covers(b, f):
                if b is None:
                    return k
                if after and abs(b[0] - f) < 1e-9:
                    return k
                best = best or k
        return best

    def cut(self, row, xz, km):
        """Cut one segment into pieces and spill them. Returns how many pieces were kept; self.touched says whether any
        piece lay inside the map's bounds, kept or not."""
        self.touched = False
        st = self.stats['rules']
        sub = row['subtype']
        cl = row['cls'] or 'unknown'
        scl = row['subclass']
        if sub == 'road':
            if cl in ROAD_CLASS:
                kind, kc, grade = KIND['ROAD'], ROAD_CLASS[cl], 0
            elif cl == 'footway' or cl in FOOT_OF:
                f = 'SIDEWALK' if (cl == 'footway' and scl == 'sidewalk') else 'CROSSING' if (cl == 'footway' and scl == 'crosswalk') \
                    else FOOT_OF.get(cl, 'FOOTWAY')
                kind, kc, grade = KIND['FOOT'], FOOT_CLASS[f], 2
            else:
                self.stats['rules'][f'class {cl}, taken as unknown'] += 1
                kind, kc, grade = KIND['ROAD'], ROAD_CLASS['unknown'], 0
        elif sub == 'rail':
            kind, kc, grade = KIND['RAIL'], 0, 1
        elif sub == 'water':
            kind, kc, grade = KIND['FERRY'], 0, 0
        else:
            self.stats['dropped'][f'subtype {sub}'] += 1
            return 0
        s = cumlen(xz)
        L = float(s[-1])
        if L <= 0:
            return 0
        flag_rules = [(v, r.get('between')) for fl in (row['road_flags'], row['rail_flags']) for r in (fl or []) if r
                      for v in (r.get('values') or [])]
        lvl_rules = [(int(r['value']), r.get('between')) for r in (row['level_rules'] or []) if r and r.get('value') is not None]
        ow_rules = [(oneway_rule(r), r.get('between')) for r in (row['access'] or []) if oneway_rule(r)]
        ways = self.ways_of(row)
        seg_skip = bool({v for v, _ in flag_rules} & GROUND_SKIPS) or (bool(lvl_rules) and max(v for v, _ in lvl_rules) != 0)
        # the cuts: (t, priority, kind, info)
        cuts = [(0.0, 4, 'e', None), (L, 4, 'e', None)]
        for c in row['connectors'] or []:
            if not c or c.get('connector_id') not in self.con:
                continue
            ci = self.con[c['connector_id']]
            t = float(c.get('at') or 0.0) * L
            j = int(np.argmin(np.abs(s - t)))
            if abs(s[j] - t) < 3.0 and np.hypot(*(xz[j] - self.con_xz[ci])) < 0.1:
                t = float(s[j])
            cuts.append((t, 0, 'c', ci))
        for axis in (0, 1):
            for t, v in axis_cuts(xz, s, axis, step=self.R):
                cuts.append((t, 1, 'l', (axis, v)))
            x0, z0, x1, z1 = self.bounds
            for t, v in axis_cuts(xz, s, axis, values=(x0, x1) if axis == 0 else (z0, z1)):
                cuts.append((t, 2, 'b', (axis, v)))
        rng = set()
        for _, b in flag_rules + lvl_rules + ow_rules:
            if b:
                rng.update(b)
        for b in range_ends(row['speed']) + range_ends(row['access']) + [v for _, bb in ways if bb for v in bb]:
            rng.add(b)
        for f in rng:
            if 1e-9 < f < 1 - 1e-9:
                cuts.append((f * L, 3, 'r', None))
        cuts.sort(key=lambda c: (c[0], c[1]))
        merged = []
        for c in cuts:
            if merged and (c[0] - merged[-1][0] < MERGE_M or (c[0] - merged[-1][0] < DM_M and "c" not in (c[2], merged[-1][2]))):
                if c[1] < merged[-1][1]:
                    merged[-1] = c
                continue
            merged.append(c)
        # a range's end within SNAP_M of a connector, with no line or bound between them, is the connector
        cs = merged
        out = []
        for k, c in enumerate(cs):
            if c[2] == 'r':
                snap = False
                for d in (-1, 1):
                    m = k + d
                    while 0 <= m < len(cs) and abs(cs[m][0] - c[0]) < SNAP_M:
                        if cs[m][2] in ('l', 'b'):
                            break
                        if cs[m][2] == 'c':
                            snap = True
                            break
                        m += d
                    if snap:
                        break
                if snap:
                    continue
            out.append(c)
        cs = out
        # the nodes at the cuts
        nodes = []
        for t, pr, ty, info in cs:
            f = t / L
            way = self.way_at(ways, f) or row['id']
            if ty == 'c':
                p = self.con_xz[info]
                nodes.append((self.con_key[info], p, True))
            elif ty == 'l':
                axis, v = info
                p = point_at(xz, s, t).copy()
                p[axis] = v
                nodes.append((dm_key(way, p[0], p[1]), p, False))
            else:
                p = point_at(xz, s, t).copy()
                if ty == 'b':
                    p[info[0]] = info[1]
                nodes.append((dm_key(way, p[0], p[1]), p, False))
        kept = 0
        kept_t = []
        self.touched = False
        for k in range(len(cs) - 1):
            ta, tb = cs[k][0], cs[k + 1][0]
            if tb - ta < MERGE_M:
                continue
            mid = point_at(xz, s, 0.5 * (ta + tb))
            if not self.inside(mid[0], mid[1]):
                continue
            self.touched = True
            reg = self.region_of(mid[0], mid[1])
            fm = 0.5 * (ta + tb) / L
            flags_here = {v for v, b in flag_rules if covers(b, fm)}
            if flags_here & LEFT_OUT:
                self.stats['dropped']['indoor, building or abandoned'] += 1
                continue
            if self.only and reg != self.only:
                continue
            flags = 0
            if 'is_bridge' in flags_here:
                flags |= BRIDGE
            if flags_here & {'is_tunnel', 'is_covered'}:
                flags |= TUNNEL
            if 'is_link' in flags_here or scl == 'link':
                flags |= LINK
            level = 0
            for v, b in lvl_rules:
                if covers(b, fm):
                    level = v
            d = DIR_BOTH
            if kind in (KIND['ROAD'], KIND['RAIL']):
                for hd, b in ow_rules:
                    if covers(b, fm):
                        d = DIR_FORWARD if hd == 'backward' else DIR_BACKWARD
            speed = speed_at(row['speed'], fm) if kind == KIND['ROAD'] else 0
            closed = kind == KIND['ROAD'] and no_cars(row['access'], fm)
            if closed:
                flags |= NO_CARS
                st['NO_CARS pieces (C6)'] += 1
            # the piece's way: the one with most of its length
            way, best = None, 0.0
            for wk, b in ways:
                lo, hi = (0.0, 1.0) if b is None else b
                ov = min(hi, tb / L) - max(lo, ta / L)
                if ov > best + 1e-12:
                    way, best = wk, ov
            a, b_ = nodes[k], nodes[k + 1]
            shape = sub_line(xz, s, ta, tb, a[1], b_[1])
            shape = simplify_line(shape, SIMPLIFY_M)
            deck = kind in (KIND['ROAD'], KIND['FOOT'], KIND['RAIL']) and (flags & BRIDGE or level > 0)
            tunnel = not deck and kind != KIND['FERRY'] and bool(flags & TUNNEL)
            if seg_skip and not (flags & TUNNEL) and kind != KIND['FERRY'] and not (deck and self.on_drawn_deck(shape)):
                flags |= UNDRAWN
            hc = 'ferry' if kind == KIND['FERRY'] else 'deck' if deck else 'tunnel' if tunnel else 'ground'
            rec = (self.pid, kind, kc, d, speed, level, flags, a[0], b_[0], shape, way or row['id'], way is not None, grade,
                   hc, a[2], b_[2], closed)
            self.pid += 1
            self.spill.add(reg, rec)
            if hc in ('deck', 'tunnel'):
                self.special.append((reg, rec))
            kept += 1
            kept_t.append((ta, tb))
            Lp = tb - ta
            if kind == KIND['ROAD']:
                km[cl] += Lp
            elif kind == KIND['FOOT']:
                km['foot:' + cl] += Lp
            else:
                km[KIND_NAME[kind].lower()] += Lp
            if flags & UNDRAWN:
                km['undrawn:' + (cl if kind == KIND['ROAD'] else KIND_NAME[kind].lower())] += Lp
        if kept:
            for v, b in flag_rules:
                st[f'flag {v}'] += 1
                if b:
                    st[f'flag {v} (part)'] += 1
            st['level'] += len(lvl_rules)
            st['level (part)'] += sum(1 for _, b in lvl_rules if b)
            st['oneway'] += len(ow_rules)
            st['oneway (part)'] += sum(1 for _, b in ow_rules if b)
            if any(closed_rule(r) for r in (row['access'] or [])) and kind == KIND['ROAD']:
                st['segments with a rule closing cars out'] += 1
            if row['speed']:
                st['speed segments'] += 1
                st['speed rules'] += len(row['speed'])
            if ways:
                st[f'ways {min(len(ways), 2)}'] += 1
            else:
                st['ways 0'] += 1
        # W1's checks (graph-check.mjs): each one-way and car-closing rule at its range's middle, on the segment's own
        # line, so W1 reads direction and NO_CARS against the rules, not against the bake's own counts
        if kept_t and kind in (KIND['ROAD'], KIND['RAIL']):
            def at(f):
                t = f * L
                if not any(ta - 1e-9 <= t <= tb + 1e-9 for ta, tb in kept_t):
                    return None
                p = point_at(xz, s, t)
                if not self.inside(p[0], p[1]):
                    return None
                i = int(np.clip(np.searchsorted(s, t, side='right') - 1, 0, len(s) - 2))
                u = (xz[i + 1] - xz[i]) / max(float(s[i + 1] - s[i]), 1e-9)
                return [round(float(p[0]), 2), round(float(p[1]), 2), round(float(u[0]), 4), round(float(u[1]), 4)]
            for hd, b in ow_rules:
                f = 0.5 * (b[0] + b[1]) if b else 0.5
                q = at(f)
                if q is None:
                    continue
                if len({h for h, bb in ow_rules if covers(bb, f)}) > 1:
                    self.checks['onewayConflicts'] += 1   # two headings over one place: the bake takes the last
                    continue
                sg = 1 if hd == 'backward' else -1      # 'backward' denied: travel along the line
                lv = next((v for v, bb in reversed(lvl_rules) if covers(bb, f)), 0)   # as the pieces take it
                self.checks['oneway'].append([q[0], q[1], sg * q[2], sg * q[3], kind, lv])
            if kind == KIND['ROAD']:
                for r in row['access'] or []:
                    if closed_rule(r):
                        b = r.get('between')
                        f = 0.5 * (b[0] + b[1]) if b else 0.5
                        q = at(f)
                        if q is not None and no_cars(row['access'], f):
                            lv = next((v for v, bb in reversed(lvl_rules) if covers(bb, f)), 0)
                            self.checks['noCars'].append(q[:2] + [lv])
        return kept

    def drawn_at(self, xs, zs, ux, uz, reach=DRAWN_REACH_M):
        """For points heading (ux, uz): (index of the deck City draws they run along, or -1; that deck's top there). Along
        one: within reach of its line, between its two ends, heading within 30 degrees of it (C2); ux None: any
        heading."""
        n = len(xs)
        hit = np.full(n, -1)
        top = np.zeros(n)
        best = np.full(n, np.inf)
        P = np.column_stack([xs, zs])
        for k, d in enumerate(self.drawn_decks):
            a, b = d[:-1, :2], d[1:, :2]
            ab = b - a
            L = np.maximum(np.hypot(ab[:, 0], ab[:, 1]), 1e-9)
            tr = ((P[:, None, :] - a[None]) * ab[None]).sum(2) / (L * L)[None]      # (n, segments)
            t = np.clip(tr, 0, 1)
            q = a[None] + t[..., None] * ab[None]
            dist = np.hypot(q[..., 0] - P[:, None, 0], q[..., 1] - P[:, None, 1])
            j = np.argmin(dist, axis=1)
            dj = dist[np.arange(n), j]
            tj = tr[np.arange(n), j]
            ext = ((j == 0) & (tj < 0)) | ((j == len(ab) - 1) & (tj > 1))
            cos = np.ones(n) if ux is None else np.abs(ux * ab[j, 0] / L[j] + uz * ab[j, 1] / L[j])
            ok = (dj <= reach) & ~ext & (cos >= DRAWN_COS) & (dj < best)
            tc = np.clip(tj, 0, 1)
            y = d[j, 2] + tc * (d[j + 1, 2] - d[j, 2])
            hit = np.where(ok, k, hit)
            top = np.where(ok, y, top)
            best = np.where(ok, dj, best)
        return hit, top

    def drawn_piece(self, shape, reach=DRAWN_REACH_M):
        """The deck City draws that most of a piece runs along (drawn_at), or -1."""
        if not self.drawn_decks or len(shape) < 2:
            return -1
        seg = np.diff(shape, axis=0)
        L = np.hypot(seg[:, 0], seg[:, 1])
        ok = L > 1e-6
        if not ok.any():
            return -1
        mid = 0.5 * (shape[:-1] + shape[1:])[ok]
        hit, _ = self.drawn_at(mid[:, 0], mid[:, 1], seg[ok, 0] / L[ok], seg[ok, 1] / L[ok], reach=reach)
        for k in range(len(self.drawn_decks)):
            if float(L[ok][hit == k].sum()) >= 0.5 * float(L[ok].sum()):
                return k
        return -1

    def on_drawn_deck(self, shape):
        """Whether most of a piece runs along a deck City draws: then it isn't UNDRAWN, and it takes the deck's top."""
        return self.drawn_piece(shape) >= 0

    # ---------------------------------------------------------- pass 1: the base types

    def read_infrastructure(self):
        """Bay-wide: ferry terminals and piers (the routes' ends, the berths). In the map: signals, stops, pier and
        terminal polygons."""
        want = pa.array(['traffic_signals', 'stop', 'pier', 'ferry_terminal'])
        bay = self.archive_box()
        self.signals, self.stops = [], []
        self.terminals_src = []
        self.piers = []
        self.area_rows = []
        cols = ['id', 'names.primary', 'sources', 'subtype', 'class', 'source_tags', 'geometry', 'bbox']
        for b in batches(self.rel, 'infrastructure', bay, cols, self.stats['read'], keep=lambda b: pc.is_in(b.column('class'), want)):
            g = shapely.from_wkb(b.column('geometry').to_numpy(zero_copy_only=False))
            cls = b.column('class').to_pylist()
            sub = b.column('subtype').to_pylist()
            gid = b.column('id').to_pylist()
            names = primary(b.column('names'))
            src = b.column('sources').to_pylist()
            tags = b.column('source_tags').to_pylist()
            for i in range(len(gid)):
                geom = g[i]
                if geom is None:
                    continue
                k = osm_key(src[i]) or gid[i]
                if cls[i] in ('traffic_signals', 'stop') and geom.geom_type == 'Point':
                    p = self.xz([geom.x], [geom.y])[0]
                    if self.inside(p[0], p[1], 20):
                        if cls[i] == 'traffic_signals':
                            self.signals.append(p)
                        else:
                            dr = dict(tags[i] or []).get('direction') if tags[i] else None
                            self.stops.append((p, dr))
                elif cls[i] == 'ferry_terminal':
                    self.terminals_src.append((k, names[i] or '', geom))
                    if geom.geom_type in ('Polygon', 'MultiPolygon'):
                        self.area_rows.append((k, AREA['FERRY_TERMINAL'], names[i] or '', geom))
                elif cls[i] == 'pier' and sub[i] == 'pier' and geom.geom_type in ('Polygon', 'MultiPolygon'):
                    self.piers.append((k, geom))
                    self.area_rows.append((k, AREA['PLAZA'], names[i] or '', geom))
        self.stats['read']['infrastructure'] = {'signals': len(self.signals), 'stops': len(self.stops),
                                                'terminals (Bay)': len(self.terminals_src), 'piers (Bay)': len(self.piers)}
        self.note(f'infrastructure: {len(self.signals)} signals, {len(self.stops)} stops, {len(self.terminals_src)} terminals and {len(self.piers)} pier polygons')

    def archive_box(self):
        """The archive's own box (lon0, lat0, lon1, lat1), where terminals, piers and the routes' far ends are read (a
        route's far end lies off the map): the city config's archiveBox, else the extract's record in the archive
        (overture/<release>/<extract>/extract.json, which fetch_archive.py writes), else the map's own box. Any city's
        archive gives its own: none falls back to the Bay's."""
        if getattr(self, '_abox', None):
            return self._abox
        bb = self.cfg.get('archiveBox')
        if not bb:
            for p in sorted(glob.glob(os.path.join(self.rel, '*', 'extract.json'))):
                bb = json.load(open(p, encoding='utf-8')).get('bbox')
                if bb:
                    break
        if not bb:
            log("  ! the archive has no extract record: terminals and the routes' ends are read in the map's box only")
            bb = self.box
        bb = tuple(float(v) for v in bb)
        if not (bb[0] <= self.box[0] and bb[1] <= self.box[1] and bb[2] >= self.box[2] and bb[3] >= self.box[3]):
            raise SystemExit(f'graphs: the map\'s box {self.box} isn\'t inside the archive\'s {bb}')
        self._abox = bb
        return bb

    def read_areas(self):
        """Parks, plazas, beaches and marinas from land use and land, in the map."""
        uses = {('park', 'park'): 'PARK', ('park', 'dog_park'): 'PARK', ('park', 'village_green'): 'PARK',
                ('pedestrian', 'pedestrian'): 'PLAZA', ('pedestrian', 'plaza'): 'PLAZA', ('recreation', 'marina'): 'MARINA'}
        self.marinas_src = []
        self.checks['onStructure'] = []
        for typ, table in (('land_use', uses), ('land', {('sand', 'beach'): 'BEACH'})):
            want = pa.array(sorted({c for _, c in table}))
            cols = ['id', 'names.primary', 'sources', 'subtype', 'class', 'source_tags', 'geometry', 'bbox'] + (
                ['level'] if typ == 'land_use' else [])
            for b in batches(self.rel, typ, self.box, cols, self.stats['read'], keep=lambda b: pc.is_in(b.column('class'), want)):
                g = shapely.from_wkb(b.column('geometry').to_numpy(zero_copy_only=False))
                cls = b.column('class').to_pylist()
                sub = b.column('subtype').to_pylist()
                gid = b.column('id').to_pylist()
                names = primary(b.column('names'))
                src = b.column('sources').to_pylist()
                tags = b.column('source_tags').to_pylist()
                lvl = b.column('level').to_pylist() if typ == 'land_use' else [None] * len(gid)
                for i in range(len(gid)):
                    kind = table.get((sub[i], cls[i]))
                    geom = g[i]
                    if not kind or geom is None or geom.geom_type not in ('Polygon', 'MultiPolygon'):
                        continue
                    k = osm_key(src[i]) or gid[i]
                    if on_structure(lvl[i], tags[i]):
                        # a roof garden or a deck: no height for it until the buildings come (item 1), and the
                        # street under it is the wrong place (Salesforce Park, 21 m up, stood at street level)
                        self.stats['dropped'][f'{kind} on a structure'] += 1
                        self.checks['onStructure'].append(k)
                        continue
                    self.area_rows.append((k, AREA[kind], names[i] or '', geom))
                    if kind == 'MARINA':
                        cap = dict(tags[i] or []).get('capacity') if tags[i] else None
                        self.marinas_src.append((k, names[i] or '', geom, cap))
        self.note(f'areas: {len(self.area_rows)} polygons read')

    def spill_areas(self):
        """Every area, projected, clipped to the map and to each region it touches."""
        self.aspill = Spill(self.cache, 'a')
        x0, z0, x1, z1 = self.bounds
        mapbox = shapely.box(x0, z0, x1, z1)
        counts = defaultdict(int)
        ha = defaultdict(float)
        for k, kind, name, geom in self.area_rows:
            if not shapely.intersects(geom, shapely.box(*self.box)):
                continue
            p = shapely.transform(geom, self.tf)
            p = shapely.make_valid(p)
            p = shapely.intersection(p, mapbox)
            if p.is_empty or p.area < 1.0:
                continue
            counts[AREA_NAME[kind]] += 1
            ha[AREA_NAME[kind]] += p.area / 1e4
            bx0, bz0, bx1, bz1 = p.bounds
            for rx in range(math.floor(bx0 / self.R), math.floor(bx1 / self.R) + 1):
                for rz in range(math.floor(bz0 / self.R), math.floor(bz1 / self.R) + 1):
                    if (rx, rz) not in self.regions or (self.only and (rx, rz) != self.only):
                        continue
                    q = shapely.intersection(p, shapely.box(rx * self.R, rz * self.R, (rx + 1) * self.R, (rz + 1) * self.R))
                    if q.is_empty or q.area < 0.5:
                        continue
                    self.aspill.add((rx, rz), (k, kind, name, shapely.to_wkb(q)))
        self.aspill.flush()
        self.stats['areas'] = {k: [counts[k], round(ha[k], 1)] for k in sorted(counts)}
        self.note(f'areas in the map: {dict(counts)}')

    # ---------------------------------------------------------- pass 2: global

    def global_pass(self):
        regs = sorted(self.regions if not self.only else {self.only})
        node_reg = defaultdict(set)
        node_bits = defaultdict(int)
        node_xz = {}
        node_con = set()
        by_way = defaultdict(list)
        bits = {'ground': 1, 'deck': 2, 'tunnel': 4, 'ferry': 8}
        clash = defaultdict(set)
        stop_best = {}
        stops = np.array([p for p, _ in self.stops]) if self.stops else np.zeros((0, 2))
        # for ground_onto_decks(): every ground piece at each node, its steps apart, and the ground foot pieces that
        # might be on a deck: steps anywhere, and any between two nodes a deck meets
        deck_keys = {k for _, rec in self.special if rec[13] == 'deck' for k in (rec[7], rec[8])}
        gcount, gsteps, cand = defaultdict(int), defaultdict(int), []
        for r in regs:
            lines, recs = [], []
            for rec in self.spill.read(r):
                pid, kind = rec[0], rec[1]
                ak, bk, shape = rec[7], rec[8], rec[9]
                if rec[13] == 'ground':
                    steps = kind == KIND['FOOT'] and rec[2] == FOOT_CLASS['STEPS']
                    for key in (ak, bk):
                        gcount[key] += 1
                        gsteps[key] += steps
                    if kind == KIND['FOOT'] and (steps or (ak in deck_keys and bk in deck_keys)):
                        cand.append((r, rec))
                for key, p, con in ((ak, shape[0], rec[14]), (bk, shape[-1], rec[15])):
                    node_reg[key].add(r)
                    node_bits[key] |= bits[rec[13]]
                    q = node_xz.get(key)
                    if q is None:
                        node_xz[key] = p
                    elif abs(q[0] - p[0]) > 0.01 or abs(q[1] - p[1]) > 0.01:
                        clash[key].add((round(p[0], 2), round(p[1], 2)))
                        clash[key].add((round(q[0], 2), round(q[1], 2)))
                    if con:
                        node_con.add(key)
                by_way[rec[10]].append((pid, ak, bk, float(cumlen(shape)[-1])))
                if len(stops) and kind in (KIND['ROAD'],):
                    lines.append(shape)
                    recs.append(rec)
            if lines and len(stops):
                self.match_stops(r, lines, recs, stops, stop_best)
            guard('global pass')
        self.node_reg, self.node_bits, self.node_xz = node_reg, node_bits, node_xz
        self.ground_onto_decks(cand, gcount, gsteps, deck_keys)
        del cand, gcount, gsteps, deck_keys
        forms = defaultdict(int)
        for k in node_reg:
            if k[0] == 'n' and '@' not in k:
                forms['connector, OSM node'] += 1
            elif '@' not in k:
                forms['connector, GERS id'] += 1
            else:
                forms['way and place (C4)'] += 1
        self.stats['nodeKeys'] = dict(forms)
        if clash:
            log(f'  ! {len(clash)} node keys name two places over 1 cm apart: {sorted(clash)[:5]}')
        self.stats['otherKeyClashes'] = len(clash)
        # pieces numbered along their ways (a closed way from its smallest node key); no way: the segment's GERS id
        self.edge_key = {}
        for way, ps in by_way.items():
            for k, pid in enumerate(self.along_way(ps)):
                self.edge_key[pid] = f'{way}#{k}'
        # flags
        self.node_flags = defaultdict(int)
        for k, rs in node_reg.items():
            if len(rs) > 1:
                self.node_flags[k] |= PORTAL
        if self.signals and node_con:
            from scipy.spatial import cKDTree
            con = sorted(node_con)
            tree = cKDTree(np.array(self.signals))
            d, _ = tree.query(np.array([node_xz[k] for k in con]), k=1, distance_upper_bound=SIGNAL_M)
            for k, dd in zip(con, d):
                if np.isfinite(dd):
                    self.node_flags[k] |= SIGNAL
        nstop = 0
        for si, (dist, key) in stop_best.items():
            if key and key in node_con:
                self.node_flags[key] |= STOP
                nstop += 1
        self.stats['nodeFlags'] = {'portal': sum(1 for v in self.node_flags.values() if v & PORTAL),
                                   'signal': sum(1 for v in self.node_flags.values() if v & SIGNAL),
                                   'stop': sum(1 for v in self.node_flags.values() if v & STOP),
                                   'stop signs placed': nstop, 'stop signs': len(self.stops)}
        self.note(f'global: {len(node_reg)} nodes, {len(self.edge_key)} edges, {len(by_way)} ways; flags {self.stats["nodeFlags"]}')
        self.special_heights()
        # ids
        nodes, n_c = alloc('node', node_reg.keys())
        edges, e_c = alloc('edge', self.edge_key.values())
        self.node_id, self.edge_id = nodes, edges
        self.stats['idCollisions'] = {'node': n_c, 'edge': e_c}

    def along_way(self, ps):
        """pids of one way's pieces in order along it: from a node no piece leads into (the smallest key first), else
        the smallest key; at a fork the smaller next key."""
        out_of = defaultdict(list)
        indeg = defaultdict(int)
        for pid, a, b, L in ps:
            out_of[a].append((b, L, pid))
            indeg[b] += 1
        for v in out_of.values():
            v.sort()
        left = {pid for pid, _, _, _ in ps}
        order = []
        while left:
            starts = sorted(a for a, v in out_of.items() if any(p in left for _, _, p in v) and indeg[a] == 0)
            if not starts:
                starts = sorted(a for a, v in out_of.items() if any(p in left for _, _, p in v))
            node = starts[0]
            while True:
                nxt = next(((b, pid) for b, _, pid in out_of.get(node, []) if pid in left), None)
                if nxt is None:
                    break
                b, pid = nxt
                left.discard(pid)
                order.append(pid)
                indeg[b] -= 1
                node = b
        return order

    def match_stops(self, r, lines, recs, stops, best):
        """A stop sign's junction: the end of the road piece it stands on (within STOP_NEAR_M) that it faces, if that
        end is within STOP_ALONG_M along the piece."""
        x0, z0 = r[0] * self.R - STOP_NEAR_M, r[1] * self.R - STOP_NEAR_M
        x1, z1 = (r[0] + 1) * self.R + STOP_NEAR_M, (r[1] + 1) * self.R + STOP_NEAR_M
        sel = np.nonzero((stops[:, 0] >= x0) & (stops[:, 0] <= x1) & (stops[:, 1] >= z0) & (stops[:, 1] <= z1))[0]
        if not len(sel):
            return
        geoms = np.array([shapely.LineString(l) for l in lines], dtype=object)
        tree = shapely.STRtree(geoms)
        pts = shapely.points(stops[sel])
        pi, li = tree.query(pts, predicate='dwithin', distance=STOP_NEAR_M)
        for a, l in zip(pi, li):
            si = int(sel[a])
            line = geoms[l]
            d = line.distance(pts[a])
            t = line.project(pts[a])
            Lp = line.length
            rec = recs[l]
            dr = self.stops[si][1]
            if dr == 'forward':
                cand = [(Lp - t, rec[8], rec[15])]
            elif dr == 'backward':
                cand = [(t, rec[7], rec[14])]
            else:
                cand = sorted([(t, rec[7], rec[14]), (Lp - t, rec[8], rec[15])])
            along, key, con = cand[0]
            if along > STOP_ALONG_M or not con:
                key = None
            prev = best.get(si)
            if prev is None or d < prev[0]:
                best[si] = (d, key)

    def ground_onto_decks(self, cand, gcount, gsteps, deck_keys):
        """Ground foot pieces a deck holds up, found before the decks' heights ("Where the ground wins", 1):
        - between two feet: a foot piece whose two ends are each a footway deck's foot and nothing else on the ground,
          running beside a road deck at their level for its whole length (FOLLOW_M, heading with it), is on that
          bridge. OSM ends a sidewalk's bridge pieces where it goes on untagged across the bridge: on w28715669, over a
          primary road in a trench, its east sidewalk's walkers dropped 8.1 m to the road under it for 20 m and climbed
          10.2 m back up. The piece is made a deck piece of theirs, BRIDGE at their level, and rides the road with them.
        - a stair: steps from a deck's foot where only steps meet it, STAIR_CHAIN_M or less to where they meet the
          ground, kept for component(): where the deck is held up over that foot, the stair takes the climb and the
          foot stands at the deck's height (a footway's last 0.9 m climbed 10.2 m from stairs lying flat on a trench's
          floor to a bridge's sidewalk).
        gcount, gsteps: ground pieces at each node key, and of them steps. Fills self.promoted (pid: the piece as a deck
        piece, for build_region) and self.stair_chains (a foot's key: its stair)."""
        self.promoted, self.stair_chains = {}, {}
        deck_at = defaultdict(list)
        roads = defaultdict(list)   # road decks' segments, by FOLLOW_M cell of anything within FOLLOW_M of them
        for _, rec in self.special:
            if rec[13] != 'deck':
                continue
            deck_at[rec[7]].append(rec)
            deck_at[rec[8]].append(rec)
            if rec[12] == 0:
                for p, q in zip(rec[9][:-1], rec[9][1:]):
                    for cx in range(math.floor((min(p[0], q[0]) - FOLLOW_M) / FOLLOW_M), math.floor((max(p[0], q[0]) + FOLLOW_M) / FOLLOW_M) + 1):
                        for cz in range(math.floor((min(p[1], q[1]) - FOLLOW_M) / FOLLOW_M), math.floor((max(p[1], q[1]) + FOLLOW_M) / FOLLOW_M) + 1):
                            roads[(cx, cz)].append((float(p[0]), float(p[1]), float(q[0]), float(q[1]), max(rec[5], 1)))

        def beside(shape, lv):
            for p, q in zip(shape[:-1], shape[1:]):
                d = float(np.hypot(*(q - p)))
                if d < 1e-9:
                    continue
                ux, uz = (q - p) / d
                k = max(1, int(math.ceil(d / DRAPE_STEP)))
                for j in range(k + 1):
                    x, z = p + (j / k) * (q - p)
                    ok = False
                    for ax, az, bx, bz, l2 in roads.get((math.floor(x / FOLLOW_M), math.floor(z / FOLLOW_M)), ()):
                        vx, vz = bx - ax, bz - az
                        L = math.hypot(vx, vz)
                        if l2 != lv or L < 1e-9 or abs((vx * ux + vz * uz) / L) < DRAWN_COS:
                            continue
                        t = min(1.0, max(0.0, ((x - ax) * vx + (z - az) * vz) / (L * L)))
                        if math.hypot(ax + t * vx - x, az + t * vz - z) <= FOLLOW_M:
                            ok = True
                            break
                    if not ok:
                        return False
            return True
        bits = self.node_bits
        steps_at = defaultdict(list)
        for r, rec in cand:
            ak, bk = rec[7], rec[8]
            if rec[2] == FOOT_CLASS['STEPS']:
                steps_at[ak].append(rec)
                steps_at[bk].append(rec)
                continue
            ends = (deck_at[ak], deck_at[bk])
            if ak == bk or any(gcount[k] != 1 or bits[k] & 12 for k in (ak, bk)) or any(d[12] != 2 for e in ends for d in e):
                continue
            lv = max(d[5] for e in ends for d in e)
            if not beside(rec[9], max(lv, 1)):
                continue
            new = rec[:5] + (lv, rec[6] | BRIDGE | (0 if self.on_drawn_deck(rec[9]) else UNDRAWN)) + rec[7:13] + ('deck',) + rec[14:]
            self.promoted[rec[0]] = new
            self.special.append((r, new))
            for k in (ak, bk):
                bits[k] = (bits[k] & ~1) | 2
                gcount[k] -= 1
            self.stats['rules']['ground foot pieces on a bridge between its feet'] += 1
        # the stairs: from each foot only steps meet, along steps through nodes only steps meet, to where something
        # else on the ground meets them (the stair's foot, on the ground) or they end; never onto another deck
        claimed = set()
        far_keys = []
        for F in sorted(k for k in deck_keys if gsteps[k] and gcount[k] == gsteps[k] and bits[k] & 1 and not bits[k] & 12):
            dist, todo, pieces, far, ok = {F: 0.0}, [(0.0, F)], {}, {}, True
            while todo and ok:
                d0, k = heapq.heappop(todo)
                if d0 > dist[k] + 1e-9:
                    continue
                if k != F and (k in deck_keys or bits[k] & 12):
                    ok = False   # onto another deck, a tunnel or a ferry: not a plain stair
                    break
                if k != F and gcount[k] != gsteps[k]:
                    far[k] = d0   # the stair's foot, where the ground goes on
                    continue
                for rec in steps_at[k]:
                    if rec[0] in pieces:
                        continue
                    if rec[0] in claimed:
                        ok = False
                        break
                    pieces[rec[0]] = rec
                    o = rec[8] if rec[7] == k else rec[7]
                    nd = d0 + float(cumlen(rec[9])[-1])
                    if nd > STAIR_CHAIN_M:
                        ok = False
                        break
                    if nd < dist.get(o, math.inf):
                        dist[o] = nd
                        heapq.heappush(todo, (nd, o))
            if ok and pieces:
                claimed.update(pieces)
                self.stair_chains[F] = {'pieces': list(pieces.values()), 'far': far, 'cap': math.inf}
                far_keys.extend((F, k, d) for k, d in far.items())
        if far_keys:
            # how high the stair can climb: from each of its feet on the ground at STAIR_MAX along it
            xz = np.array([self.node_xz[k] for _, k, _ in far_keys])
            g, c = self.tiles.sample(xz[:, 0], xz[:, 1])
            st = stand(g, c)
            for (F, k, d), y in zip(far_keys, st):
                ch = self.stair_chains[F]
                ch['cap'] = min(ch['cap'], float(y) + self.decks.STAIR_MAX * d)
        self.stairs_up = []
        self.note(f'ground onto decks: {len(self.promoted)} foot pieces between a bridge\'s feet, {len(self.stair_chains)} '
                  f'stairs from a deck\'s foot ({sum(len(c["pieces"]) for c in self.stair_chains.values())} pieces)')

    def special_heights(self):
        """Decks: the bridges spec's profile on each joined chain of deck pieces (decks.py). Tunnels: straight between
        the ends they stand on. Fills self.deck_y (node key: y), self.inner (pid: inner points x, z, y) and self.held (the
        nodes where a ground way meets a drawn deck mid-span: they stand on the deck)."""
        self.deck_y, self.inner, self.held = {}, {}, set()
        # each drawn deck's two ends: the line across it there, its direction into the deck (C2's "between its ends")
        self.drawn_ends = []
        for d in self.drawn_decks:
            for e, f in ((d[0, :2], d[1, :2]), (d[-1, :2], d[-2, :2])):
                u = (f - e) / max(float(np.hypot(*(f - e))), 1e-9)
                self.drawn_ends.append((e.copy(), u))
        for which in ('deck', 'tunnel'):
            recs = [rec for _, rec in self.special if rec[13] == which]
            if not recs:
                continue
            par = {}

            def find(a):
                while par.setdefault(a, a) != a:
                    par[a] = par[par[a]]
                    a = par[a]
                return a
            for rec in recs:
                ra, rb = find(rec[7]), find(rec[8])
                if ra != rb:
                    par[max(ra, rb)] = min(ra, rb)
            comps = defaultdict(list)
            for rec in recs:
                comps[find(rec[7])].append(rec)
            # the lowest structures first, so one crossing over another is placed against it (decks.Stacked); at one
            # level a structure with a road first, so a sidewalk beside it can ride its deck (FOLLOW_M)
            self.stacked = self.decks.Stacked()
            self.follow = defaultdict(list)
            if which == 'deck':
                self.drawn_level = [1] * len(self.drawn_decks)   # each drawn deck's top: the highest level along it
                for rec in recs:
                    k = self.drawn_piece(rec[9])
                    if k >= 0:
                        self.drawn_level[k] = max(self.drawn_level[k], max(rec[5], 1))
            done = []
            for comp in sorted(comps.values(), key=lambda c: (max(r[5] for r in c), min(r[12] for r in c),
                                                             min(min(r[7], r[8]) for r in c))):
                done.append(self.component(which, comp))
            if which == 'deck':
                self.ride(done)
                self.place_stairs()
            del done
            guard(which)
        self.note(f'decks and tunnels: {sum(1 for _, r in self.special if r[13] == "deck")} deck pieces, '
                  f'{sum(1 for _, r in self.special if r[13] == "tunnel")} tunnel pieces')

    def component(self, which, comp):
        xs, zs, lvl, grade = [], [], [], []
        node_s = {}
        links = []
        piece_s = {}

        def sample(x, z, lv, gr):
            xs.append(x)
            zs.append(z)
            lvl.append(lv)
            grade.append(gr)
            return len(xs) - 1
        for rec in comp:
            shape, lv, gr = rec[9], rec[5], rec[12]
            ids = []
            for key, p in ((rec[7], shape[0]), (rec[8], shape[-1])):
                if key not in node_s:
                    node_s[key] = sample(p[0], p[1], lv, gr)
            ids.append(node_s[rec[7]])
            for i in range(len(shape) - 1):
                p, q = shape[i], shape[i + 1]
                d = float(np.hypot(*(q - p)))
                k = max(1, int(math.ceil(d / DRAPE_STEP)))
                ts = [j / k for j in range(1, k)]
                if which == 'deck':
                    # a sample where it crosses a drawn deck's end, just inside it: it takes the top up to the end, and a
                    # foot past the end comes down past it (the Golden Gate's south end stood 1.2 m off its top 2 m in)
                    for e, u in self.drawn_ends:
                        ap, aq = float((p - e) @ u), float((q - e) @ u)
                        if ap * aq < 0:
                            t = ap / (ap - aq)
                            if float(np.hypot(*(p + t * (q - p) - e))) <= 2 * DRAWN_REACH_M:
                                ts.append(min(1 - 1e-6, max(1e-6, t + (0.01 if aq > 0 else -0.01) / max(d, 1e-9))))
                    ts.sort()
                for t in ts:
                    ids.append(sample(p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), lv, gr))
                if i < len(shape) - 2:
                    ids.append(sample(q[0], q[1], lv, gr))
            ids.append(node_s[rec[8]])
            for a, b in zip(ids[:-1], ids[1:]):
                links.append((a, b, float(math.hypot(xs[a] - xs[b], zs[a] - zs[b]))))
            piece_s[rec[0]] = ids
        g, c = self.tiles.sample(xs, zs)
        water = np.isnan(g) | (c == 2)
        ground = np.where(np.isnan(g), WATER_Y, g)
        base = np.where(sea(g, c), 0.0, ground)   # the water's surface under a deck: the sea's datum, else a lake's grid
        anchors = {}
        for key, i in node_s.items():
            b = self.node_bits.get(key, 0)
            if b & 1:
                anchors[i] = float(stand(g[i:i + 1], c[i:i + 1])[0])
        # each sample's headings: its pieces' segments either side of it. A node is in several pieces, and with one
        # heading a sample (the last piece's, a central difference) a crossing's stood for a road's at the node they
        # share, and a sidewalk rode a road beside it by it
        X, Z = np.array(xs), np.array(zs)
        heads = defaultdict(list)   # sample -> [(ux, uz, grade, by a foot)]
        foots = {i for key, i in node_s.items() if self.node_bits.get(key, 0) & 1}   # where ground ways meet it
        for rec in comp:
            ids = piece_s[rec[0]]
            s = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(X[ids]), np.diff(Z[ids])))])
            # a road's samples within a sample's step of its foot are its climb to the ground there, the ground's (Where
            # the ground wins, 1): no carriageway to ride
            near = ((s < DRAPE_STEP) & (ids[0] in foots)) | ((s[-1] - s < DRAPE_STEP) & (ids[-1] in foots))
            for k, (a, b) in enumerate(zip(ids[:-1], ids[1:])):
                dx, dz = X[b] - X[a], Z[b] - Z[a]
                L = math.hypot(dx, dz)
                if L > 1e-9:
                    heads[a].append((dx / L, dz / L, rec[12], bool(near[k])))
                    heads[b].append((dx / L, dz / L, rec[12], bool(near[k + 1])))
        if which == 'deck':
            # (a tunnel's end on this deck takes the deck's height: tunnels come after)
            lv = np.maximum(np.array(lvl), 1)
            fixed = {}
            hit = np.full(len(xs), -1)
            if self.drawn_decks:
                # C2: a piece that runs along a deck City draws (most of its length, on_drawn_deck) takes its top at
                # every sample between the deck's ends within twice the reach (OSM's sidewalks run 9-25 m off the
                # Golden Gate's line); a lower level 5.5 m a level under the top level along it, and never under the
                # ground: it isn't drawn
                # a piece whose foot (its structure's end, on the ground) stands beside the deck well inside its ends
                # isn't on it: a ramp down to the street beside the Bay Bridge's anchorage was pinned 27 m over its own
                # foot. A foot by a drawn deck's end is where the deck meets the ground: the Golden Gate's south
                # roadway, its foot 0.4 m inside the drawn deck's end, was taken for a ramp and stood 6 m over the top
                meets = defaultdict(int)   # pieces of this structure at each node: a junction mid-span, or a foot
                for rec in comp:
                    meets[rec[7]] += 1
                    meets[rec[8]] += 1
                along = np.full(len(xs), -1)
                for rec in comp:
                    k = self.drawn_piece(rec[9], 2 * DRAWN_REACH_M)
                    if k >= 0:
                        for key, p in ((rec[7], rec[9][0]), (rec[8], rec[9][-1])):
                            if self.node_bits.get(key, 0) & 1 and meets[key] == 1:
                                dist, s, length = self.drawn_along(p[0], p[1], k)
                                if dist <= 2 * DRAWN_REACH_M and FOOT_END_M < s < length - FOOT_END_M:
                                    k = -1
                    along[piece_s[rec[0]]] = np.maximum(along[piece_s[rec[0]]], k)
                h2, top = self.drawn_at(X, Z, None, None, reach=2 * DRAWN_REACH_M)
                hit = np.where((along >= 0) & (h2 == along), h2, -1)
                for i in np.nonzero(hit >= 0)[0]:
                    y = float(top[i] - self.decks.LEVEL_M * (self.drawn_level[hit[i]] - lv[i]))
                    if lv[i] < self.drawn_level[hit[i]] and not water[i]:
                        y = max(y, float(ground[i]))
                    fixed[int(i)] = y
                # a ground way meeting a drawn deck mid-span (two pieces of it go on through the node) meets it on the
                # deck: the deck isn't pulled down to the ground there, and the way climbs to it at its end. The Golden
                # Gate's east path dived 23 m to a footway at the north tower and back up within 8 m
                for key, i in node_s.items():
                    if i in anchors and meets[key] >= 2 and hit[i] >= 0:
                        del anchors[i]
                        self.held.add(key)
                        self.stats['rules']['ground ways held on a drawn deck mid-span'] += 1
            # a sidewalk or path beside a road's deck at one level rides it, as it does on the bridge: profiled apart,
            # the Golden Gate's walkers stood up to 41 m under its cars
            mine = defaultdict(list)   # this structure's own roads on a drawn deck: its sidewalks off it ride them too
            for i, y in fixed.items():
                for u, v, gr, nf in heads[i]:
                    if gr == 0 and not nf and i not in anchors:
                        mine[(math.floor(xs[i] / FOLLOW_M), math.floor(zs[i] / FOLLOW_M))].append((xs[i], zs[i], int(lv[i]), y, u, v))
            for i in range(len(xs)):
                if grade[i] != 2 or i in fixed:
                    continue
                by = self.carriageway(xs[i], zs[i], int(lv[i]), heads[i], (self.follow, mine))
                if by is not None:
                    fixed[i] = by if water[i] else max(by, float(ground[i]))   # riding, but never under the ground
            lo, hi = self.stacked.bounds(xs, zs, lvl)
            y = self.climb_stairs(node_s, links, anchors, lambda a: self.decks.profile(
                ground, water, lvl, grade, links, a, lo, hi, base=base, fixed=fixed))
            self.stacked.add(xs, zs, lvl, y)
            for i, hs in heads.items():
                for u, v, gr, nf in hs:
                    if gr == 0 and not nf and i not in anchors:   # a road's foot is the ground's: no carriageway to ride
                        self.follow[(math.floor(xs[i] / FOLLOW_M), math.floor(zs[i] / FOLLOW_M))].append(
                            (xs[i], zs[i], int(lv[i]), float(y[i]), u, v))
            self.stats['rules']['deck samples on a drawn deck (C2)'] += int(sum(1 for i in fixed if self.drawn_decks and hit[i] >= 0))
            self.stats['rules']['deck samples riding a road deck'] += int(sum(1 for i in fixed if not (self.drawn_decks and hit[i] >= 0)))
            S = {'which': which, 'xs': X, 'zs': Z, 'lvl': lvl, 'lv': lv, 'grade': np.array(grade), 'links': links,
                 'anchors': anchors, 'lo': lo, 'hi': hi, 'base': base, 'fixed': fixed, 'ground': ground, 'water': water,
                 'heads': heads, 'y': y, 'node_s': node_s, 'piece_s': piece_s, 'drawn': hit >= 0}
            self.place(S)
            return S
        else:
            for key, i in node_s.items():
                b = self.node_bits.get(key, 0)
                if (b & 2) and key in self.deck_y:
                    anchors[i] = self.deck_y[key]
            if not anchors:
                deg = defaultdict(int)
                for a, b, _ in links:
                    deg[a] += 1
                    deg[b] += 1
                for key, i in node_s.items():
                    if deg[i] <= 1:
                        anchors[i] = float(ground[i])
            if not anchors:
                anchors = {next(iter(node_s.values())): float(ground[next(iter(node_s.values()))])}
            y = self.decks.along(None, links, anchors, len(xs))
            y = np.where(np.isnan(y), ground, y)
            # never over the ground, and deeper by its level away from its ends (decks.under)
            cap = self.decks.under(ground, lvl, grade, links, anchors)
            free = np.ones(len(xs), bool)
            free[list(anchors)] = False
            y = np.where(free, np.minimum(y, cap), y)
            self.place({'which': which, 'xs': X, 'zs': Z, 'y': y, 'node_s': node_s, 'piece_s': piece_s})
            return None

    def place(self, S):
        """A structure's heights into self.deck_y (its nodes but those on the ground, and those a drawn deck holds) and
        self.inner (each piece's inner points: a deck's lifted where its line runs under the ground, then simplified)."""
        y, X, Z = S['y'], S['xs'], S['zs']
        for key, i in S['node_s'].items():
            if not (self.node_bits.get(key, 0) & 1) or key in self.held:
                self.deck_y[key] = float(y[i])
        for pid, ids in S['piece_s'].items():
            p = np.column_stack([X[ids], Z[ids], y[ids]])
            if S['which'] == 'deck':
                p = self.lift(p, S['drawn'][ids])
            p = simplify3(p, 0.1, 0.15 if S['which'] == 'deck' else 0.25)   # a drawn deck is checked to 0.3 m
            self.inner[pid] = p[1:-1]

    def lift(self, p, drawn):
        """A deck's line never runs under the ground or a lake between its samples either: they're up to 4 m apart and
        the grid bulges between them (a road deck on a crest stood 0.66 m under it). Every metre and at each of the
        grid's lines between two samples, as drape() samples, a point where the line runs under, at the ground's height.
        Not between two samples a drawn deck holds (C2): City draws it there. p: (n, 3) x, z, y; drawn: n bools."""
        if len(p) < 2:
            return p
        ts, si = [], []
        for i in range(len(p) - 1):
            if drawn[i] and drawn[i + 1]:
                continue
            a, b = p[i], p[i + 1]
            d = math.hypot(b[0] - a[0], b[1] - a[1])
            k = max(1, math.ceil(d))
            t = [np.arange(1, k) / k]
            for ax in (0, 1):
                if b[ax] != a[ax]:
                    lo, hi = sorted((a[ax], b[ax]))
                    t.append((np.arange(math.floor(lo / GRID_M) + 1, math.ceil(hi / GRID_M)) * GRID_M - a[ax]) / (b[ax] - a[ax]))
            t = np.unique(np.concatenate(t))
            t = t[(t > 1e-6) & (t < 1 - 1e-6)]
            ts.append(t)
            si.append(np.full(len(t), i))
        if not ts or not sum(len(t) for t in ts):
            return p
        t, si = np.concatenate(ts), np.concatenate(si)
        S = p[si, :2] + t[:, None] * (p[si + 1, :2] - p[si, :2])
        yc = p[si, 2] + t * (p[si + 1, 2] - p[si, 2])
        g, c = self.tiles.sample(S[:, 0], S[:, 1])
        up = ~sea(g, c) & (g > yc + 0.05)
        if not up.any():
            return p
        self.stats['rules']['deck points lifted to the ground between samples'] += int(up.sum())
        key = np.concatenate([np.arange(len(p), dtype=float), si[up] + t[up]])
        q = np.vstack([p, np.column_stack([S[up], g[up]])])
        return q[np.argsort(key, kind='stable')]

    def ride(self, done):
        """Sidewalks ride their carriageway (FOLLOW_M), against every road deck as it was placed: a sidewalk beside a
        road of its own structure that no drawn deck holds, or of one placed after it, was profiled apart (the Golden
        Gate's south path stood 4 to 6 m under its roadway). A structure with such a sample is profiled again with
        them riding, never under the ground, and its roads and rails where they stand; the anchors still win."""
        roads = defaultdict(list)
        for S in done:
            if S is None:
                continue
            for i, hs in S['heads'].items():
                for u, v, gr, nf in hs:
                    if gr == 0 and not nf and i not in S['anchors']:
                        roads[(math.floor(S['xs'][i] / FOLLOW_M), math.floor(S['zs'][i] / FOLLOW_M))].append(
                            (S['xs'][i], S['zs'][i], int(S['lv'][i]), float(S['y'][i]), u, v))
        again = samples = 0
        for S in done:
            if S is None or not (S['grade'] == 2).any():
                continue
            new = {}
            for i in np.nonzero(S['grade'] == 2)[0]:
                i = int(i)
                if S['drawn'][i] or i in S['anchors']:
                    continue
                by = self.carriageway(S['xs'][i], S['zs'][i], int(S['lv'][i]), S['heads'][i], (roads,))
                if by is not None:
                    new[i] = by if S['water'][i] else max(by, float(S['ground'][i]))
            if not new or all(abs(v - S['y'][i]) <= 0.05 for i, v in new.items()):
                continue
            # the drawn deck's samples as the first pass fixed them, every sidewalk sample by its nearest road now, and
            # the structure's roads and rails where they stand
            fixed = {i: v for i, v in S['fixed'].items() if S['drawn'][i]}
            fixed.update(new)
            for i in np.nonzero(S['grade'] != 2)[0]:
                fixed.setdefault(int(i), float(S['y'][i]))
            S['y'] = self.climb_stairs(S['node_s'], S['links'], S['anchors'], lambda a: self.decks.profile(
                S['ground'], S['water'], S['lvl'], S['grade'], S['links'], a, S['lo'], S['hi'], base=S['base'], fixed=fixed))
            self.place(S)
            again += 1
            samples += len(new)
        self.stats['rules']['structures profiled again with their sidewalks riding'] += again
        self.stats['rules']['sidewalk samples riding in that pass'] += samples
        self.note(f'decks: {again} structures profiled again, {samples} sidewalk samples riding their carriageway')

    def climb_stairs(self, node_s, links, anchors, prof):
        """A deck's heights, prof(anchors), with its stairs taking the climb where it's held up over a foot: a foot a
        stair meets (ground_onto_decks), left on the ground under a deck that riding or a drawn top holds up, was a
        wall in the deck's last step. It stands at the deck's height instead, as high as its stair can climb
        (STAIR_MAX from where the stair meets the ground), and place_stairs() runs the stair down from it. anchors is
        changed in place, so a second profile (ride()) keeps it."""
        y = prof(anchors)
        ups = []
        for key, i in node_s.items():
            if key in self.stair_chains and i in anchors:
                for a, b, d in links:
                    if i in (a, b) and y[b if a == i else a] - y[i] > max(1.0, 0.5 * d):
                        ups.append((key, i))
                        break
        if not ups:
            return y
        for key, i in ups:
            del anchors[i]
        y = prof(anchors)
        capped = [(key, i) for key, i in ups if y[i] > self.stair_chains[key]['cap']]
        for key, i in capped:
            anchors[i] = self.stair_chains[key]['cap']
        if capped:
            y = prof(anchors)
        for key, i in ups:
            self.node_bits[key] &= ~1   # its only ground pieces are its stair's, a deck's from here
            if key not in self.stairs_up:
                self.stairs_up.append(key)
                self.stats['rules']['stairs taking the climb to a deck held up over its foot'] += 1
        self.stats['rules']['of them as high as the stair can climb, under the deck'] += len(capped)
        return y

    def place_stairs(self):
        """Each stair that takes the climb to its deck's foot (component()), once the deck stands where it ends: down
        from the foot's height at up to STAIR_MAX to its own feet on the ground, never under the ground and on it
        wherever it doesn't climb (decks.profile, grade class STAIR). Its pieces are deck pieces from here on, BRIDGE,
        and its nodes but its feet on the ground stand on it."""
        for F in self.stairs_up:
            ch = self.stair_chains[F]
            xs, zs, node_s, links, piece_s = [], [], {}, [], {}

            def sample(x, z):
                xs.append(float(x))
                zs.append(float(z))
                return len(xs) - 1
            for rec in ch['pieces']:
                shape = rec[9]
                for key, p in ((rec[7], shape[0]), (rec[8], shape[-1])):
                    if key not in node_s:
                        node_s[key] = sample(p[0], p[1])
                ids = [node_s[rec[7]]]
                for i in range(len(shape) - 1):
                    p, q = shape[i], shape[i + 1]
                    k = max(1, int(math.ceil(float(np.hypot(*(q - p))) / DRAPE_STEP)))
                    for j in range(1, k):
                        ids.append(sample(*(p + (j / k) * (q - p))))
                    if i < len(shape) - 2:
                        ids.append(sample(q[0], q[1]))
                ids.append(node_s[rec[8]])
                for a, b in zip(ids[:-1], ids[1:]):
                    links.append((a, b, float(math.hypot(xs[a] - xs[b], zs[a] - zs[b]))))
                piece_s[rec[0]] = ids
            g, c = self.tiles.sample(xs, zs)
            n = len(xs)
            water = np.isnan(g) | ((c & 15) == 2)
            ground = np.where(np.isnan(g), WATER_Y, g)
            anchors = {i: float(stand(g[i:i + 1], c[i:i + 1])[0]) for key, i in node_s.items() if key in ch['far']}
            if anchors:
                # one flight between the deck and the ground, straight by the way along it as a tunnel is (decks.along),
                # never under the ground: no steeper than STAIR_MAX, since the foot is no higher than that lets it
                anchors[node_s[F]] = self.deck_y[F]
                y = self.decks.along(None, links, anchors, n)
                y = np.where(np.isnan(y), ground, y)
                y = np.where(water, y, np.maximum(y, ground))
            else:
                # stairs that end with nothing at their foot: down from the deck at up to STAIR_MAX to the ground
                y = self.decks.profile(ground, water, [0] * n, [STAIR] * n, links, {},
                                       base=np.where(sea(g, c), 0.0, ground), fixed={node_s[F]: self.deck_y[F]})
            for key in node_s:
                if key != F and key not in ch['far']:
                    self.node_bits[key] = (self.node_bits[key] & ~1) | 2   # on the stair now
                elif key in ch['far']:
                    self.node_bits[key] |= 2   # a stair's foot: on the ground, where a deck meets it
            self.place({'which': 'deck', 'xs': np.array(xs), 'zs': np.array(zs), 'y': y, 'node_s': node_s,
                        'piece_s': piece_s, 'drawn': np.zeros(n, bool)})
            for rec in ch['pieces']:
                flags = rec[6] | BRIDGE | (0 if self.on_drawn_deck(rec[9]) else UNDRAWN)
                self.promoted[rec[0]] = rec[:6] + (flags,) + rec[7:12] + (STAIR, 'deck') + rec[14:]
            self.stats['rules']['stair pieces on a deck, climbing to it'] += len(ch['pieces'])

    def carriageway(self, x, z, lv, heads, indexes):
        """The height of the road deck a sidewalk sample rides (FOLLOW_M): the nearest road sample at its level within
        FOLLOW_M whose piece heads within 30 degrees of one of the sample's own foot pieces, else None. indexes: grids
        of (x, z, level, y, ux, uz) by FOLLOW_M cell, a road sample once for each of its pieces."""
        fh = [(u, v) for u, v, gr, _ in heads if gr == 2]
        best, by = FOLLOW_M, None
        cx, cz = math.floor(x / FOLLOW_M), math.floor(z / FOLLOW_M)
        for ix in indexes:
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for x2, z2, l2, y2, vx, vz in ix.get((cx + dx, cz + dz), ()):
                        d = math.hypot(x2 - x, z2 - z)
                        if d < best and l2 == lv and any(abs(vx * u + vz * v) >= DRAWN_COS for u, v in fh):
                            best, by = d, y2
        return by

    def drawn_along(self, x, z, k):
        """Where a point stands by the deck City draws k: (its distance from the line, the way along it from its first
        point to there, unclipped, the line's length)."""
        d = self.drawn_decks[k][:, :2]
        ab = d[1:] - d[:-1]
        L = np.maximum(np.hypot(ab[:, 0], ab[:, 1]), 1e-9)
        tr = ((x - d[:-1, 0]) * ab[:, 0] + (z - d[:-1, 1]) * ab[:, 1]) / (L * L)
        t = np.clip(tr, 0, 1)
        dist = np.hypot(d[:-1, 0] + t * ab[:, 0] - x, d[:-1, 1] + t * ab[:, 1] - z)
        j = int(np.argmin(dist))
        cum = np.concatenate([[0.0], np.cumsum(L)])
        f = tr[j] if j in (0, len(L) - 1) else t[j]   # past an end on the first or last segment: outside it
        return float(dist[j]), float(cum[j] + f * L[j]), float(cum[-1])

    # ---------------------------------------------------------- pass 3: regions

    def region_pass(self):
        regs = sorted(self.regions if not self.only else {self.only})
        self.files = {}
        self.area_keys = {}
        self.water_parts = defaultdict(int)
        self.region_data = {}
        # area ids need every area's key first: one read of the area spills
        keys = set()
        for r in regs:
            for k, kind, name, wkb in self.aspill.read(r):
                keys.add(k)
        for r in regs:
            if self.water_mask(r)[0].any():
                keys.add(f'water@{r[0]},{r[1]}')
        self.lakes()
        keys.update(self.lake_key.values())
        self.area_id, a_c = alloc('area', keys)
        self.stats['idCollisions']['area'] = a_c
        counts = defaultdict(int)
        tri_total = 0
        worst = (0, None)
        for r in regs:
            buf, c = self.build_region(r)
            path = os.path.join(self.out, f'g_{r[0]}_{r[1]}.bin')
            if not c.get('nodes') and not any(k.startswith('areas ') for k in c):
                if os.path.exists(path):
                    os.remove(path)   # a cell with nothing in it has no file (C1)
                continue
            for k, v in c.items():
                counts[k] += v
            tri_total += c.get('triangles', 0)
            gz = gzip.compress(buf, compresslevel=9, mtime=0)
            self.files[r] = (len(buf), len(gz))
            with open(path, 'wb') as f:
                f.write(gz)
            if len(gz) > worst[0]:
                worst = (len(gz), r)
            guard(f'region {r}')
        sizes = sorted(v[1] for v in self.files.values())
        self.stats['files'] = {'regions': len(sizes), 'noTile': sum(1 for r in self.files if r not in self.tile_regions),
                               'gzBytes': sum(sizes), 'rawBytes': sum(v[0] for v in self.files.values()),
                               'median': sizes[len(sizes) // 2] if sizes else 0, 'largest': [worst[0], list(worst[1]) if worst[1] else None]}
        self.stats['counts'] = dict(counts)
        self.note(f'regions: {len(sizes)} files, {sum(sizes) / 1e6:.2f} MB gzipped, largest {worst[0] / 1024:.1f} KB at {worst[1]}')

    def water_mask(self, r, lakes=False):
        """The region's sea at 2 m (sea()): the class raster's WATER texels the grid holds at LAKE_M or under, at their
        centres, and the whole of any tile slot with no tile, inside the map's bounds. lakes: its lakes instead (C8), the
        WATER texels the grid holds higher, where the city draws them on the ground. (mask[z, x], origin)"""
        T = self.tiles.T
        N = self.tiles.N
        rs = self.tiles.rs
        k = int(round(self.R / (T / N)))
        m = np.zeros((k, k), bool)
        x0, z0, x1, z1 = self.bounds
        for j in range(rs):
            for i in range(rs):
                tx, tz = r[0] * rs + i, r[1] * rs + j
                tx0, tz0 = tx * T, tz * T
                if tx0 + T <= x0 or tx0 >= x1 or tz0 + T <= z0 or tz0 >= z1:
                    continue
                t = self.tiles.tile(tx, tz)
                sl = (slice(j * N, (j + 1) * N), slice(i * N, (i + 1) * N))
                if t is None:
                    m[sl] = not lakes
                else:
                    hh, cls, _, _, cell, n = t
                    f = (np.arange(N) + 0.5) * (T / N) / cell        # texel centres in grid steps
                    f0 = np.minimum(np.floor(f).astype(np.int64), n - 2)
                    a = f - f0
                    rows = hh[f0, :] * (1 - a)[:, None] + hh[f0 + 1, :] * a[:, None]
                    H = rows[:, f0] * (1 - a)[None, :] + rows[:, f0 + 1] * a[None, :]
                    m[sl] = (cls == 2) & ((H > LAKE_M) if lakes else (H <= LAKE_M))
        return m, (r[0] * self.R, r[1] * self.R)

    def lake_labels(self, r):
        """The region's lakes, each 4-connected run of lake texels labelled (water_mask, lakes): (labels[z, x], 0 none;
        how many; origin)."""
        from scipy.ndimage import label
        m, o = self.water_mask(r, lakes=True)
        if not m.any():
            return None, 0, o
        lab, n = label(m)   # scipy's default structure is the cross: 4-connected, as the sea's polygons are
        return lab, n, o

    def lakes(self):
        """Every lake on the map as one area (C8): a lake's runs in each region are joined across the region lines, and
        the lake keys on its first texel's centre, the northernmost row's westernmost, in whole decimetres of the map
        (`lake@-41234,51230`): nothing names it. Each region's part of it is cut to that region with the one id, as any
        area across a line is. Fills self.lake_key ((rx, rz, label): key) and the stats."""
        regs = sorted(self.regions if not self.only else {self.only})
        par = {}

        def find(a):
            while par.setdefault(a, a) != a:
                par[a] = par[par[a]]
                a = par[a]
            return a
        first, edges, texels = {}, {}, {}
        K = None
        for r in regs:
            lab, n, _ = self.lake_labels(r)
            if not n:
                continue
            K = lab.shape[0]
            idx = np.flatnonzero(lab)
            lo = np.full(n + 1, lab.size, np.int64)
            np.minimum.at(lo, lab.ravel()[idx], idx)
            cnt = np.bincount(lab.ravel()[idx], minlength=n + 1)
            for l in range(1, n + 1):
                row, col = divmod(int(lo[l]), K)
                first[(r[0], r[1], l)] = (r[1] * K + row, r[0] * K + col)   # global texel row (z), column (x)
                texels[(r[0], r[1], l)] = int(cnt[l])
                find((r[0], r[1], l))
            edges[r] = (lab[:, 0].copy(), lab[:, -1].copy(), lab[0, :].copy(), lab[-1, :].copy())   # west, east, north, south
            guard('lakes')
        for (rx, rz), (w, e, nn, s) in edges.items():
            for nb, mine, theirs in (((rx + 1, rz), e, 0), ((rx, rz + 1), s, 2)):
                if nb not in edges:
                    continue
                other = edges[nb][theirs]
                for a, b in zip(mine[(mine > 0) & (other > 0)], other[(mine > 0) & (other > 0)]):
                    ra, rb = find((rx, rz, int(a))), find((nb[0], nb[1], int(b)))
                    if ra != rb:
                        par[max(ra, rb)] = min(ra, rb)
        comp_first, comp_texels, comp_parts = {}, defaultdict(int), defaultdict(int)
        for k, f in first.items():
            c = find(k)
            comp_first[c] = min(comp_first.get(c, f), f)
            comp_texels[c] += texels[k]
            comp_parts[c] += 1
        step = self.R / K if K else 0.0
        key_of = {c: f'lake@{int(round(((f[1] + 0.5) * step) * 10))},{int(round(((f[0] + 0.5) * step) * 10))}' for c, f in comp_first.items()}
        self.lake_key = {k: key_of[find(k)] for k in first}
        sizes = sorted(comp_texels.values(), reverse=True)
        self.stats['lakes'] = {'lakes': len(comp_first), 'parts': len(first), 'texels': int(sum(sizes)),
                               'acrossRegions': sum(1 for v in comp_parts.values() if v > 1), 'largestTexels': sizes[:3]}
        self.note(f'lakes (C8): {len(comp_first)} lakes in {len(first)} regional parts, {sum(sizes)} texels, the largest {sizes[:3]}')

    def lake_rows(self, r):
        """The region's parts of its lakes as areas (C8): OPEN_WATER polygons from the lake texels (as the sea's are from
        its, simplified under half a texel), cut on the region's TIN as any area is, so a lake stands at the grid's
        height, where the city draws it."""
        lab, n, (ox, oz) = self.lake_labels(r)
        if not n:
            return []
        from rasterio.features import shapes
        from affine import Affine
        from shapely.geometry import shape as geo_shape
        step = self.R / lab.shape[0]
        tr = Affine(step, 0, ox, 0, step, oz)
        polys = defaultdict(list)   # by lake: one lake's runs here that join only through another region are one area
        for gj, v in shapes(lab.astype(np.int32), mask=lab > 0, connectivity=4, transform=tr):
            p = shapely.simplify(geo_shape(gj), WATER_SIMPLIFY, preserve_topology=True)
            if not p.is_empty:
                polys[self.lake_key[(r[0], r[1], int(v))]].append(p)
        return [(k, AREA['OPEN_WATER'], '', shapely.union_all(ps)) for k, ps in sorted(polys.items())]

    def build_region(self, r):
        recs = [self.promoted.get(rec[0], rec) for rec in self.spill.read(r)]   # ground pieces a deck holds up as deck pieces
        recs.sort(key=lambda rec: self.edge_id[self.edge_key[rec[0]]])
        keys = sorted({k for rec in recs for k in (rec[7], rec[8])}, key=lambda k: self.node_id[k])
        idx = {k: i for i, k in enumerate(keys)}
        nn = len(keys)
        nxz = np.array([self.node_xz[k] for k in keys]) if nn else np.zeros((0, 2))
        ny = np.zeros(nn)
        bits = np.array([self.node_bits[k] for k in keys], int) if nn else np.zeros(0, int)
        if nn:
            g, c = self.tiles.sample(nxz[:, 0], nxz[:, 1])
            st = stand(g, c)
            sw = sea(g, c)
            for i, k in enumerate(keys):
                b = bits[i]
                if b & 1 and k not in self.held:
                    ny[i] = st[i]
                elif b & 2 or b & 4 or b & 1:
                    # (a ground way's end the deck it meets mid-span holds: held, below)
                    ny[i] = self.deck_y.get(k, WATER_Y if np.isnan(g[i]) else g[i])
                else:
                    # on water: the sea's surface, a lake's own height (C8: the grid, where the city draws it), and
                    # never under the sea's surface off it (a ferry's berth on a quay's grid at the Bay's -1.1)
                    ny[i] = WATER_Y if sw[i] else max(float(g[i]), WATER_Y)
        nflags = np.array([self.node_flags.get(k, 0) for k in keys], np.uint8)
        pts = []
        shape_start = [0]
        E = {k: [] for k in ('id', 'a', 'b', 'kind', 'cls', 'dir', 'lanes', 'speed', 'level', 'flags')}
        cnt = defaultdict(int)
        for rec in recs:
            pid, kind, kc, d, speed, level, flags, ak, bk, shape, way, isway, grade, hc = rec[:14]
            if hc in ('deck', 'tunnel'):
                inner = self.inner.get(pid, np.zeros((0, 3)))
            elif hc == 'ground':
                p = drape(shape, self.tiles)
                inner = p[1:-1]
            else:
                inner = shape[1:-1]
                if len(inner):
                    g, c = self.tiles.sample(inner[:, 0], inner[:, 1])
                    # a ferry on a lake at its height (C8), on a pier at the pier's, and never under the sea's surface:
                    # off the water texels into Pier 41 the grid holds the Bay's -1.1, and the Sausalito ferry sank to it
                    y = np.where(sea(g, c), WATER_Y, np.maximum(g, WATER_Y))
                    inner = np.column_stack([inner, y])
                else:
                    inner = np.zeros((0, 3))
            pts.append(inner)
            shape_start.append(shape_start[-1] + len(inner))
            E['id'].append(self.edge_id[self.edge_key[pid]])
            E['a'].append(idx[ak])
            E['b'].append(idx[bk])
            E['kind'].append(kind)
            E['cls'].append(kc)
            E['dir'].append(d)
            E['lanes'].append(0)
            E['speed'].append(speed)
            E['level'].append(max(-128, min(127, level)))
            E['flags'].append(flags)
            cnt[f'edges {KIND_NAME[kind]}'] += 1
        P = np.vstack(pts) if pts and sum(len(p) for p in pts) else np.zeros((0, 3))
        # areas
        A = {'id': [], 'kind': [], 'name': [], 'tri': [0]}
        verts = []
        tris = []
        names = []
        name_ix = {}
        nv = 0
        rows = [(k, kind, name, shapely.from_wkb(wkb)) for k, kind, name, wkb in self.aspill.read(r)]
        rows = [row for row in rows if not row[3].is_empty] + self.lake_rows(r)
        if rows:
            grid = self.region_grid(r)
            extra = None
            for _ in range(6):
                tin, dl = self.region_tin(grid, [row[3] for row in rows], extra)
                cut, miss = [], []
                for row in rows:
                    tl, m = self.tin_area(row[3], tin, dl, grid)
                    cut.append(tl)
                    miss.extend(m)
                if not miss:
                    break
                extra = np.unique(np.vstack([tin, np.array(miss)]), axis=0)
            cnt['area misses left'] += len(miss)
            for (k, kind, name, poly), tl in zip(rows, cut):
                if not tl:
                    continue
                v, t = self.index_tris(tl, flat=None)
                self.add_area(A, verts, tris, names, name_ix, self.area_id[k], kind, name, v, t, nv)
                nv += len(v)
                cnt[f'areas {AREA_NAME[kind]}'] += 1
                if k.startswith('lake@'):
                    cnt['lake parts'] += 1
        m, (ox, oz) = self.water_mask(r)
        if m.any():
            tl = self.water_triangles(m, ox, oz)
            if tl:
                v, t = self.index_tris(tl, flat=WATER_Y)
                self.add_area(A, verts, tris, names, name_ix, self.area_id[f'water@{r[0]},{r[1]}'], AREA['OPEN_WATER'], '', v, t, nv)
                nv += len(v)
                cnt['areas OPEN_WATER'] += 1
        V = np.vstack(verts) if verts else np.zeros((0, 3))
        Tr = np.vstack(tris) if tris else np.zeros((0, 3), np.int64)
        cnt['nodes'] += nn
        cnt['points'] += len(P)
        cnt['triangles'] += len(Tr)
        buf = self.encode(r, keys, nxz, ny, nflags, E, shape_start, P, A, V, Tr, names)
        return buf, cnt

    def add_area(self, A, verts, tris, names, name_ix, aid, kind, name, v, t, base):
        A['id'].append(aid)
        A['kind'].append(kind)
        if name:
            name = name.encode('utf-8')[:255].decode('utf-8', 'ignore')
            if name not in name_ix:
                name_ix[name] = len(names)
                names.append(name)
            A['name'].append(name_ix[name])
        else:
            A['name'].append(0xFFFF)
        verts.append(v)
        tris.append(t + base)
        A['tri'].append(A['tri'][-1] + len(t))

    def index_tris(self, tl, flat):
        """Triangles [(3, 2) arrays] as shared vertices (x, z, y) and index triples; y from the grid, or flat."""
        T = np.array(tl)                     # (t, 3, 2)
        q = np.round(T.reshape(-1, 2) * 10).astype(np.int64)
        uq, inv = np.unique(q, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        xz = uq.astype(float) / 10
        if flat is None:
            y = self.surface(xz[:, 0], xz[:, 1])
        else:
            y = np.full(len(xz), flat)
        tri = inv.reshape(-1, 3)
        ok = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])
        tri = tri[ok]
        # each triangle from its smallest vertex, its winding kept, and the triangles in that vertex's order: the
        # indices then climb, which gzip takes far better than the triangulation's own order
        r = np.argmin(tri, axis=1)
        tri = np.stack([tri[np.arange(len(tri)), (r + k) % 3] for k in range(3)], axis=1)
        tri = tri[np.lexsort((tri[:, 2], tri[:, 1], tri[:, 0]))]
        return np.column_stack([xz, y]), tri

    def region_grid(self, r):
        """The region's 4 m grid: points (n, n) x and z, and what stands there: the baked heights, never under the sea's
        surface (stand(), as a node), nan where no tile."""
        n = int(round(self.R / 4.0)) + 1
        gx, gz = np.meshgrid(r[0] * self.R + 4.0 * np.arange(n), r[1] * self.R + 4.0 * np.arange(n))
        gh, gc = self.tiles.sample(gx.ravel(), gz.ravel())
        gh = np.where(np.isnan(gh), np.nan, stand(gh, gc))
        return gx, gz, gh.reshape(n, n)

    def surface(self, xs, zs):
        """What an area's vertex stands on, as a node does (stand()): the grid, never under the sea's surface, WATER_Y
        where no tile is (a lake: the grid, where the city draws it). A pier's edge took WATER_Y on texels the pier's
        raised grid holds at 2 m or under, and its plaza sloped 3 m into the water. OPEN_WATER is flat apart."""
        g, c = self.tiles.sample(xs, zs)
        return stand(g, c)

    def region_tin(self, grid, polys, extra=None):
        """One terrain TIN for the region's areas: the grid's points under them (and one step round them) inserted
        greedily, the worst in each triangle past AREA_TOL, from a 64 m lattice, until every one is within AREA_TOL.
        Returns (points (m, 3) x, z, y; the Delaunay)."""
        from scipy.ndimage import binary_dilation
        from scipy.spatial import Delaunay
        gx, gz, gh = grid
        n = gx.shape[0]
        u = shapely.union_all(polys)
        cov = shapely.intersects_xy(u, gx, gz)
        want = binary_dilation(cov, structure=np.ones((3, 3), bool)) & ~np.isnan(gh)
        G = np.column_stack([gx[want], gz[want], gh[want]])
        k = int(AREA_CELL / 4)
        sj, si = np.meshgrid(np.arange(0, n, k), np.arange(0, n, k), indexing='ij')
        sh = gh[sj, si]
        P = np.column_stack([gx[sj, si].ravel(), gz[sj, si].ravel(), np.where(np.isnan(sh), WATER_Y, sh).ravel()])
        if extra is not None and len(extra):
            P = np.unique(np.vstack([P, extra]), axis=0)
        D = Delaunay(P[:, :2])
        for _ in range(200):
            if not len(G):
                break
            s = D.find_simplex(G[:, :2])
            Tm = D.transform[s]
            b = np.einsum('ijk,ik->ij', Tm[:, :2, :], G[:, :2] - Tm[:, 2, :])
            bary = np.column_stack([b, 1 - b.sum(1)])
            err = np.abs((bary * P[D.simplices[s], 2]).sum(1) - G[:, 2])
            err[s < 0] = np.inf
            bad = np.nonzero(err > AREA_TOL)[0]
            if not len(bad):
                break
            o = bad[np.lexsort((-err[bad], s[bad]))]
            first = np.concatenate([[True], s[o][1:] != s[o][:-1]])
            P = np.vstack([P, G[o[first]]])
            D = Delaunay(P[:, :2])
        return P, D

    def tin_area(self, poly, P, D, grid):
        """The TIN's triangles inside one area, those across its edge cut to it. Returns (triangles [(3, 2)], the grid
        points that a cut piece misses by more than the contract's 0.5 m less the decimetres: they go into the TIN)."""
        tris = P[D.simplices][:, :, :2]
        tp = shapely.polygons(np.concatenate([tris, tris[:, :1]], axis=1))
        bx0, bz0, bx1, bz1 = poly.bounds
        cand = np.nonzero((tris[:, :, 0].max(1) >= bx0) & (tris[:, :, 0].min(1) <= bx1)
                          & (tris[:, :, 1].max(1) >= bz0) & (tris[:, :, 1].min(1) <= bz1))[0]
        shapely.prepare(poly)
        inside = shapely.within(tp[cand], poly)
        cross = shapely.intersects(tp[cand], poly) & ~inside
        out = [tris[i] for i in cand[inside]]
        pieces = []
        for i in cand[cross]:
            pieces.extend(triangulate(shapely.intersection(tp[i], poly)))
        out.extend(pieces)
        gx, gz, gh = grid
        x0, z0 = gx[0, 0], gz[0, 0]
        n = gx.shape[0]
        miss = []
        if pieces:
            # checked as the file holds them, at whole decimetres: rounding a piece's corner moved a grid point into it
            # across a pier's edge, 1.3 m off
            T = np.round(np.array(pieces) * 10) / 10
            vh = self.surface(T[:, :, 0].ravel(), T[:, :, 1].ravel()).reshape(-1, 3)
            for t in range(len(T)):
                i0 = max(0, int(math.floor((T[t, :, 0].min() - x0) / 4)))
                i1 = min(n - 1, int(math.ceil((T[t, :, 0].max() - x0) / 4)))
                j0 = max(0, int(math.floor((T[t, :, 1].min() - z0) / 4)))
                j1 = min(n - 1, int(math.ceil((T[t, :, 1].max() - z0) / 4)))
                px, pz, ph = gx[j0:j1 + 1, i0:i1 + 1].ravel(), gz[j0:j1 + 1, i0:i1 + 1].ravel(), gh[j0:j1 + 1, i0:i1 + 1].ravel()
                ok = ~np.isnan(ph)
                if not ok.any():
                    continue
                (ax, az), (bx, bz), (cx, cz) = T[t]
                det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
                if abs(det) < 1e-12:
                    continue
                l0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det
                l1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det
                l2 = 1 - l0 - l1
                ins = ok & (l0 >= -1e-9) & (l1 >= -1e-9) & (l2 >= -1e-9)
                e = np.abs(l0 * vh[t, 0] + l1 * vh[t, 1] + l2 * vh[t, 2] - ph)
                bad = ins & (e > 0.45)
                if bad.any():
                    miss.extend(np.column_stack([px[bad], pz[bad], ph[bad]]).tolist())
        return out, miss

    def water_triangles(self, m, ox, oz):
        from rasterio.features import shapes
        from affine import Affine
        from shapely.geometry import shape as geo_shape
        step = self.R / m.shape[0]
        tr = Affine(step, 0, ox, 0, step, oz)
        out = []
        for gj, v in shapes(m.astype(np.uint8), mask=m, connectivity=4, transform=tr):
            if not v:
                continue
            p = geo_shape(gj)
            p = shapely.simplify(p, WATER_SIMPLIFY, preserve_topology=True)
            if p.is_empty:
                continue
            out.extend(triangulate(p))
        return out

    def encode(self, r, keys, nxz, ny, nflags, E, shape_start, P, A, V, Tr, names):
        ox, oz = r[0] * self.R, r[1] * self.R
        ally = np.concatenate([ny, P[:, 2] if len(P) else [], V[:, 2] if len(V) else []])
        base = float(math.floor(ally.min())) if len(ally) else 0.0

        def dm(v, o, delta=False):
            q = np.round((np.asarray(v, float) - o) * 10).astype(np.int64)
            if len(q) and (q.min() < -32768 or q.max() > 32767):
                raise SystemExit(f'graphs: region {r}: a value past i16 decimetres ({q.min()}, {q.max()})')
            if delta:   # each less the one before, modulo 2^16: lossless, and gzip takes the small steps far better
                q = np.diff(q, prepend=0) & 0xFFFF
                return q.astype('<u2')
            return q.astype('<i2')

        def tri_deltas(t, wide):
            # a triangle's first vertex less the last triangle's first, its other two less its first, modulo the width
            t = np.asarray(t, np.int64).reshape(-1, 3)
            m = 0xFFFFFFFF if wide else 0xFFFF
            if not len(t):
                return np.zeros(0, '<u4' if wide else '<u2')
            d = np.column_stack([np.diff(t[:, 0], prepend=0), t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]]) & m
            return d.astype('<u4' if wide else '<u2').ravel()
        nn, ne, npt, na, nv, nt = len(keys), len(E['id']), len(P), len(A['id']), len(V), len(Tr)
        out = bytearray()
        out += b'SBG1' + struct.pack('<HHiif', GRAPH_VERSION[0], GRAPH_VERSION[1], r[0], r[1], base)
        out += struct.pack('<7I', nn, ne, npt, na, nv, nt, len(names))

        def put(a):
            out.extend(np.ascontiguousarray(a).tobytes())

        def pad():
            out.extend(b'\0' * ((-len(out)) % 4))
        put(np.array([self.node_id[k] for k in keys], '<u4'))
        put(dm(nxz[:, 0] if nn else [], ox)); put(dm(nxz[:, 1] if nn else [], oz)); put(dm(ny, base)); pad()
        put(nflags.astype('u1')); pad()
        wide = '<u4' if nn > 65535 else '<u2'
        put(np.array(E['id'], '<u4'))
        put(np.array(E['a'], wide)); pad(); put(np.array(E['b'], wide)); pad()
        for k in ('kind', 'cls', 'dir', 'lanes', 'speed'):
            put(np.array(E[k], 'u1'))
        put(np.array(E['level'], 'i1')); pad()
        put(np.array(E['flags'], '<u2')); pad()
        put(np.array(shape_start, '<u4'))
        put(dm(P[:, 0] if npt else [], ox, True)); put(dm(P[:, 1] if npt else [], oz, True)); put(dm(P[:, 2] if npt else [], base, True)); pad()
        put(np.array(A['id'], '<u4')); put(np.array(A['kind'], 'u1')); pad(); put(np.array(A['name'], '<u2')); pad()
        put(np.array(A['tri'], '<u4'))
        put(dm(V[:, 0] if nv else [], ox, True)); put(dm(V[:, 1] if nv else [], oz, True)); put(dm(V[:, 2] if nv else [], base, True)); pad()
        put(tri_deltas(Tr, nv > 65535)); pad()
        for s in names:
            b = s.encode('utf-8')
            out += struct.pack('<B', len(b)) + b
        return bytes(out)

    # ---------------------------------------------------------- pass 4: routes.bin, gkeys.bin, city.json

    def routes(self):
        geod = Geod(ellps='WGS84')
        # the routes whole, a way's segments chained end to end
        ferries = []
        need = set()
        for k, parts in self.ferry_rows.items():
            parts = sorted(parts, key=lambda p: p[0])
            chain = [parts[0][2]]
            rest = parts[1:]
            while rest:
                for j, p in enumerate(rest):
                    c = p[2]
                    if np.allclose(c[0], chain[-1][-1]):
                        chain.append(c[1:]); break
                    if np.allclose(c[-1], chain[0][0]):
                        chain.insert(0, c[:-1]); break
                else:
                    j = 0
                    chain.append(rest[0][2])
                rest.pop(j)
            ll = np.vstack(chain)
            name = next((p[1] for p in parts if p[1]), '') or ''
            ends = [c for p in parts for c in p[3]]
            ferries.append({'key': k, 'name': name, 'll': ll, 'ends': ends,
                            'lengthM': float(geod.line_length(ll[:, 0], ll[:, 1]))})
            need.update(ends)
        # terminals: the archive's ferry_terminal elements within TERMINAL_M of a route's end
        terms = []
        for k, name, geom in self.terminals_src:
            terms.append({'key': k, 'name': name, 'geom': geom, 'pt': geom.representative_point() if geom.geom_type != 'Point' else geom})
        piers = [(k, g) for k, g in self.piers]
        end_conn = self.end_connectors(need)
        used = {}
        for fe in ferries:
            for which, (lon, lat) in (('from', fe['ll'][0]), ('to', fe['ll'][-1])):
                best, bd = None, TERMINAL_M
                for t in terms:
                    d = self.geo_dist(lon, lat, t['geom'])
                    if d <= bd:
                        best, bd = t, d
                if best is None:
                    # no terminal: one of its own at the end, keyed by that end's node (its connector)
                    key = None
                    for cid in fe['ends']:
                        e = end_conn.get(cid)
                        if e and self.geo_dist(lon, lat, shapely.Point(e[1], e[2])) < 1.0:
                            key = e[0] or cid
                    key = key or f'{fe["key"]}@{which}'
                    best = next((t for t in terms if t['key'] == key), None)
                    if best is None:
                        best = {'key': key, 'name': '', 'geom': shapely.Point(lon, lat), 'pt': shapely.Point(lon, lat), 'own': True}
                        terms.append(best)
                fe[which] = best['key']
                used[best['key']] = best
        tlist = []
        for k in sorted(used):
            t = used[k]
            lon, lat = t['pt'].x, t['pt'].y
            berth = BERTH_DEFAULT_M
            for pk, pg in piers:
                bx0, by0, bx1, by1 = pg.bounds
                if lon < bx0 - 0.001 or lon > bx1 + 0.001 or lat < by0 - 0.001 or lat > by1 + 0.001:
                    continue
                if self.geo_dist(lon, lat, pg) <= 30.0:
                    p = shapely.transform(pg, self.tf)
                    rr = shapely.minimum_rotated_rectangle(p)
                    c = np.asarray(rr.exterior.coords)
                    side = max(np.hypot(*(c[1] - c[0])), np.hypot(*(c[2] - c[1])))
                    berth = max(berth if berth != BERTH_DEFAULT_M else 0.0, float(side))
            tlist.append({'key': k, 'kind': 0, 'name': t['name'], 'lat': lat, 'lon': lon, 'berthM': berth, 'own': t.get('own', False)})
        marinas = []
        x0, z0, x1, z1 = self.bounds
        for k, name, geom, cap in self.marinas_src:
            p = shapely.transform(geom, self.tf)
            c = p.representative_point()
            if not self.inside(c.x, c.y):
                continue
            try:
                berths = int(float(cap)) if cap else None
            except ValueError:
                berths = None
            mapped = berths is not None
            if berths is None:
                berths = int(round(p.area / BERTH_AREA_M2))
            lon, lat = self.lonlat([c.x], [c.y])
            marinas.append({'key': k, 'name': name, 'lat': float(lat[0]), 'lon': float(lon[0]), 'berths': min(65535, berths), 'mapped': mapped})
        marinas.sort(key=lambda m: m['key'])
        airports = self.airports()
        ids = {}
        ids['ferry'], c1 = alloc('ferry', [f['key'] for f in ferries])
        ids['terminal'], c2 = alloc('terminal', [t['key'] for t in tlist])
        ids['marina'], c3 = alloc('marina', [m['key'] for m in marinas])
        ids['airport'], c4 = alloc('airport', [a['icao'] for a in airports])
        self.route_ids = ids
        self.stats['idCollisions'].update({'ferry': c1, 'terminal': c2, 'marina': c3, 'airport': c4})

        def s8(v):
            b = (v or '').encode('utf-8')[:255]
            b = b.decode('utf-8', 'ignore').encode('utf-8')
            return struct.pack('<B', len(b)) + b

        def deg(v):
            return int(round(v * 1e7))
        out = bytearray(b'SBC1' + struct.pack('<HH', *ROUTES_VERSION))   # C7: 'SBR1' is the region bundles'
        ferries.sort(key=lambda f: f['key'])
        out += struct.pack('<I', len(ferries))
        for f in ferries:
            ll = f['ll']
            out += struct.pack('<I', ids['ferry'][f['key']]) + s8(f['key']) + s8(f['name'])
            out += struct.pack('<IIBfI', ids['terminal'][f['from']], ids['terminal'][f['to']], 0, f['lengthM'], len(ll))
            out += np.array([deg(v) for v in ll[:, 1]], '<i4').tobytes() + np.array([deg(v) for v in ll[:, 0]], '<i4').tobytes()
        out += struct.pack('<I', len(tlist))
        for t in tlist:
            out += struct.pack('<I', ids['terminal'][t['key']]) + s8(t['key']) + struct.pack('<B', t['kind']) + s8(t['name'])
            out += struct.pack('<iif', deg(t['lat']), deg(t['lon']), t['berthM'])
        out += struct.pack('<I', len(marinas))
        for m in marinas:
            out += struct.pack('<I', ids['marina'][m['key']]) + s8(m['key']) + s8(m['name'])
            out += struct.pack('<iiH', deg(m['lat']), deg(m['lon']), m['berths'])
        out += struct.pack('<I', len(airports))
        for a in airports:
            out += struct.pack('<I', ids['airport'][a['icao']]) + s8(a['icao']) + s8(a['iata'])
            out += struct.pack('<iifH', deg(a['lat']), deg(a['lon']), a['elevM'], len(a['runways']))
            for w in a['runways']:
                out += s8(w['name']) + struct.pack('<iiiif', deg(w['lat'][0]), deg(w['lat'][1]), deg(w['lon'][0]), deg(w['lon'][1]), w['widthM'])
        gz = gzip.compress(bytes(out), compresslevel=9, mtime=0)
        with open(os.path.join(self.out, 'routes.bin'), 'wb') as f:
            f.write(gz)
        self.stats['routes'] = {'ferries': len(ferries), 'terminals': len(tlist), 'terminalsMadeAtEnds': sum(1 for t in tlist if t['own']),
                                'marinas': len(marinas), 'marinaBerthsMapped': sum(1 for m in marinas if m['mapped']),
                                'airports': [a['icao'] for a in airports], 'bytes': [len(out), len(gz)]}
        self.route_rows = (ferries, tlist, marinas, airports)
        self.land_along(ferries)
        self.note(f'routes.bin: {len(ferries)} ferries, {len(tlist)} terminals, {len(marinas)} marinas, '
                  f'{len(airports)} airports; {len(gz) / 1024:.1f} KB gzipped')

    def geo_dist(self, lon, lat, geom):
        """Metres from a lon/lat to a geometry (lon/lat), on a local plane about the point."""
        k = math.cos(math.radians(lat))
        g = shapely.transform(geom, lambda c: np.column_stack([(c[:, 0] - lon) * 111320.0 * k, (c[:, 1] - lat) * 110574.0]))
        return float(shapely.distance(g, shapely.Point(0, 0)))

    def end_connectors(self, need):
        """{connector id: (OSM node key or None, lon, lat)} of the routes' end connectors, from the whole archive (most
        lie off the map)."""
        if not need:
            return {}
        want = pa.array(sorted(need))
        out = {}
        for b in batches(self.rel, 'connector', self.archive_box(), ['id', 'sources', 'geometry', 'bbox'], None,
                         keep=lambda b: pc.is_in(b.column('id'), want)):
            g = shapely.from_wkb(b.column('geometry').to_numpy(zero_copy_only=False))
            src = b.column('sources').to_pylist()
            gid = b.column('id').to_pylist()
            for i in range(len(g)):
                out[gid[i]] = (osm_key(src[i], 'n'), g[i].x, g[i].y)
        return out

    def airports(self):
        d = os.path.join(self.archive, 'ourairports')
        lat0, lon0 = self.man['origin']
        geod = Geod(ellps='WGS84')
        out = []
        with open(os.path.join(d, 'airports.csv'), encoding='utf-8', newline='') as f:
            for row in csv.DictReader(f):
                if row.get('scheduled_service') != 'yes' or row.get('type') not in ('large_airport', 'medium_airport', 'small_airport'):
                    continue
                try:
                    lat, lon = float(row['latitude_deg']), float(row['longitude_deg'])
                except ValueError:
                    continue
                if abs(lat - lat0) > 1 or abs(lon - lon0) > 1.5:
                    continue
                _, _, dist = geod.inv(lon0, lat0, lon, lat)
                if dist > AIRPORT_KM * 1000:
                    continue
                icao = row.get('icao_code') or row.get('gps_code') or row['ident']
                try:
                    elev = float(row['elevation_ft']) * FEET
                except ValueError:
                    elev = 0.0
                out.append({'icao': icao, 'ident': row['ident'], 'iata': row.get('iata_code') or '', 'lat': lat, 'lon': lon,
                            'elevM': elev, 'km': dist / 1000, 'runways': []})
        by = {a['ident']: a for a in out}
        with open(os.path.join(d, 'runways.csv'), encoding='utf-8', newline='') as f:
            for row in csv.DictReader(f):
                a = by.get(row.get('airport_ident'))
                if a is None or row.get('closed') == '1':
                    continue
                try:
                    la = [float(row['le_latitude_deg']), float(row['he_latitude_deg'])]
                    lo = [float(row['le_longitude_deg']), float(row['he_longitude_deg'])]
                except ValueError:
                    continue
                try:
                    w = float(row['width_ft']) * FEET
                except ValueError:
                    w = 0.0
                for name, i, j in ((row.get('le_ident'), 0, 1), (row.get('he_ident'), 1, 0)):
                    if name:
                        a['runways'].append({'name': name, 'lat': [la[i], la[j]], 'lon': [lo[i], lo[j]], 'widthM': w})
        for a in out:
            a['runways'].sort(key=lambda w: w['name'])
        out.sort(key=lambda a: a['icao'])
        return out

    def geoid(self):
        import rasterio
        p = os.path.join(self.archive, 'geoid', 'us_nga_egm96_15.tif')
        if not os.path.exists(p):
            return None
        x0, z0, x1, z1 = self.bounds
        gx, gz = np.meshgrid(np.linspace(x0, x1, 21), np.linspace(z0, z1, 21))
        lon, lat = self.lonlat(gx.ravel(), gz.ravel())
        lat0, lon0 = self.man['origin']
        with rasterio.open(p) as ds:
            T = ds.transform
            win_c0 = int(math.floor((~T * (min(lon.min(), lon0) - 1, 0))[0]))
            win_r0 = int(math.floor((~T * (0, max(lat.max(), lat0) + 1))[1]))
            win_c1 = int(math.ceil((~T * (max(lon.max(), lon0) + 1, 0))[0]))
            win_r1 = int(math.ceil((~T * (0, min(lat.min(), lat0) - 1))[1]))
            win = rasterio.windows.Window(win_c0, win_r0, win_c1 - win_c0 + 1, win_r1 - win_r0 + 1)
            a = ds.read(1, window=win).astype(float)
            Tw = ds.window_transform(win)

        def at(lo, la):
            c, r = ~Tw * (lo, la)
            c, r = c - 0.5, r - 0.5
            i, j = int(math.floor(c)), int(math.floor(r))
            fx, fy = c - i, r - j
            return (a[j, i] * (1 - fx) + a[j, i + 1] * fx) * (1 - fy) + (a[j + 1, i] * (1 - fx) + a[j + 1, i + 1] * fx) * fy
        n0 = at(lon0, lat0)
        ns = [at(lo, la) for lo, la in zip(lon, lat)]
        return round(float(n0), 2), round(float(min(ns)), 2), round(float(max(ns)), 2)

    def land_along(self, ferries):
        """C3 (0.6): Overture's land rows of class land (OSM's coastline) within CHECK_LAND_M of the ferry routes, for W1
        to check the routes past the map against, inside the archive's box. Polygons in map dm, simplified to 2 m."""
        if not ferries:
            self.checks['land'], self.checks['landBox'] = [], list(self.archive_box())
            return
        lines = [shapely.LineString(self.tf(np.asarray(f['ll'], float))) for f in ferries]
        corridor = shapely.union_all([shapely.buffer(l, CHECK_LAND_M) for l in lines])
        allll = np.vstack([np.asarray(f['ll'], float) for f in ferries])
        box = (float(allll[:, 0].min()) - 0.01, float(allll[:, 1].min()) - 0.01, float(allll[:, 0].max()) + 0.01,
               float(allll[:, 1].max()) + 0.01)
        # the coastline's land runs on up rivers and straits to the tidal limit (the Vallejo ferry's last kilometres up
        # the Mare Island Strait): Overture's water polygons there are water
        wet = []
        for b in batches(self.rel, 'water', box, ['id', 'geometry', 'bbox'], None):
            for geom in shapely.from_wkb(b.column('geometry').to_numpy(zero_copy_only=False)):
                if geom is not None and geom.geom_type in ('Polygon', 'MultiPolygon'):
                    w = shapely.intersection(shapely.make_valid(shapely.transform(geom, self.tf)), corridor)
                    if not w.is_empty:
                        wet.append(w)
        wet = shapely.union_all(wet) if wet else None
        polys = []
        for b in batches(self.rel, 'land', box, ['id', 'class', 'geometry', 'bbox'], None,
                         keep=lambda b: pc.equal(b.column('class'), 'land')):
            for geom in shapely.from_wkb(b.column('geometry').to_numpy(zero_copy_only=False)):
                if geom is None:
                    continue
                p = shapely.intersection(shapely.make_valid(shapely.transform(geom, self.tf)), corridor)
                if wet is not None and not p.is_empty:
                    p = shapely.difference(p, wet)
                p = shapely.simplify(p, 2.0, preserve_topology=True)
                for q in getattr(p, 'geoms', [p]):
                    if q.geom_type == 'Polygon' and not q.is_empty and q.area > 1.0:
                        polys.append([np.round(np.asarray(r.coords) * 10).astype(int).tolist()
                                      for r in [q.exterior] + list(q.interiors)])
        self.checks['land'] = polys
        self.checks['landBox'] = list(self.archive_box())
        self.note(f'land along the ferries (C3): {len(polys)} polygons within {CHECK_LAND_M:.0f} m of the routes')

    def write_checks(self):
        """W1's check file, beside gkeys.bin in tools/world/data/<slug>/ (the repo, not the site): the rules' places
        for direction and NO_CARS, and the land along the ferries past the map (C3)."""
        d = os.path.join(ROOT, 'tools', 'world', 'data', self.slug) if self.out == self.city else self.out
        os.makedirs(d, exist_ok=True)
        body = json.dumps({'version': 1, **self.checks}, separators=(',', ':')).encode('utf-8')
        with open(os.path.join(d, 'checks.json.gz'), 'wb') as f:
            f.write(gzip.compress(body, compresslevel=9, mtime=0))
        self.note(f'checks.json.gz: {len(self.checks["oneway"])} one-way rules, {len(self.checks["noCars"])} closing rules, '
                  f'{len(self.checks["land"])} land polygons')

    def write_keys(self):
        """gkeys.bin, for W2: 'SBK1', u16 version, u16 minor, u32 count, then by id: u32 id, u8 kind (KEY_KINDS),
        u8 length, utf-8 key. A key is unique within its kind; one OSM element can be two kinds (a marina's area and
        the marina)."""
        rows = []
        tables = [self.node_id, self.edge_id, self.area_id] + [self.route_ids[k] for k in KEY_KINDS[3:]]
        for kind, table in enumerate(tables):
            for k, i in table.items():
                rows.append((i, kind, k))
        rows.sort()
        out = bytearray(b'SBK1' + struct.pack('<HHI', *KEYS_VERSION, len(rows)))
        for i, kind, k in rows:
            b = k.encode('utf-8')
            out += struct.pack('<IBB', i, kind, len(b)) + b
        gz = gzip.compress(bytes(out), compresslevel=9, mtime=0)
        d = os.path.join(ROOT, 'tools', 'world', 'data', self.slug) if self.out == self.city else self.out
        os.makedirs(d, exist_ok=True)   # in the repo for W2, not on the site: the game never fetches it
        with open(os.path.join(d, 'gkeys.bin'), 'wb') as f:
            f.write(gz)
        self.stats['keys'] = {'count': len(rows), 'bytes': [len(out), len(gz)]}
        self.note(f'gkeys.bin: {len(rows)} keys, {len(gz) / 1024:.0f} KB gzipped')

    def write_city(self):
        g = self.geoid()
        m = json.load(open(os.path.join(self.city, 'city.json'), encoding='utf-8'))
        dem = ' '.join(self.cfg.get('dem') or [])
        m['vdatum'] = self.cfg.get('vdatum') or ('NAVD88' if 'USGS' in dem else 'EGM2008')
        if g:
            m['geoid'] = g[0]
            m['geoidSpread'] = [g[1], g[2]]
        st = self.stats
        m['life'] = {'graph': GRAPH_VERSION[0], 'routes': ROUTES_VERSION[0],
                     'regions': [[r[0], r[1], self.files[r][1]] for r in sorted(self.files)],   # C1: every cell with a file
                     'stats': {
            'edges': {k[6:]: v for k, v in st['counts'].items() if k.startswith('edges ')},
            'areas': {k[6:]: v for k, v in st['counts'].items() if k.startswith('areas ')},
            'nodes': st['counts'].get('nodes', 0), 'points': st['counts'].get('points', 0),
            'oneWay': {'rulesRead': st['rules'].get('oneway', 0), 'edges': st['oneWayEdges']},
            'noCars': {'segmentsWithARule': st['rules'].get('segments with a rule closing cars out', 0), 'edges': st['rules'].get('NO_CARS pieces (C6)', 0)},
            'nodeFlags': st['nodeFlags'], 'km': st['kmInside'], 'dropped': dict(st['dropped']),
            'files': st['files'], 'routes': st['routes'], 'lakes': st.get('lakes')}}
        path = os.path.join(self.out, 'city.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(m, f)
        self.note(f'city.json: vdatum {m["vdatum"]}, geoid {g}')

    def run(self):
        below_normal()
        log(f'graphs {self.slug}: bounds {self.bounds}, {len(self.regions)} regions, box {tuple(round(v, 4) for v in self.box)}'
            + (f', region {self.only} only' if self.only else ''))
        os.makedirs(self.out, exist_ok=True)
        self.read_connectors()
        self.read_segments()
        self.read_infrastructure()
        self.read_areas()
        self.spill_areas()
        del self.area_rows
        self.global_pass()
        self.region_pass()
        one = 0
        for r in sorted(self.regions if not self.only else {self.only}):
            for rec in self.spill.read(r):
                if rec[3] != DIR_BOTH:
                    one += 1
        self.stats['oneWayEdges'] = one
        self.routes()
        self.write_keys()
        self.write_checks()
        if not self.only:
            self.write_city()
        if not self.keep:
            shutil.rmtree(self.cache, ignore_errors=True)
        ws, pws, pb, ppb = mem()
        self.stats['memoryMB'] = {'peakWorkingSet': round(pws), 'peakPrivate': round(ppb)}
        self.stats['seconds'] = round(time.time() - self.t0, 1)
        self.report()

    def report(self):
        st = self.stats
        log('\nThe archive, as the bake read it:')
        log(f'  row groups touched {st["read"].get("rowGroups")}')
        log(f'  segments that keep a piece {st.get("segments")}; connectors {st["read"].get("connectors")}')
        log(f'  km inside the bounds {st.get("kmInside")}')
        log(f'  rules on kept segments {dict(sorted(st["rules"].items()))}')
        log(f'  areas (count, ha) {st.get("areas")}')
        log(f'  dropped {dict(st["dropped"])}')
        log(f"  node flags {st.get('nodeFlags')}; id collisions {st.get('idCollisions')}")
        log(f'  node keys by form {st.get("nodeKeys")}; other keys naming two places {st.get("otherKeyClashes")}')
        log(f'  one-way edges {st.get("oneWayEdges")}')
        log(f'  counts {st.get("counts")}')
        log(f'  files {st.get("files")}')
        log(f'  routes {st.get("routes")}')
        log(f'  keys {st.get("keys")}')
        log(f'  {st["seconds"]} s, peak working set {st["memoryMB"]["peakWorkingSet"]} MB, peak private {st["memoryMB"]["peakPrivate"]} MB')


def sea(g, c):
    """The sea and the Bay, at WATER_Y: no tile, or a WATER texel the grid holds at LAKE_M or under. A WATER texel
    higher up is a lake, which the city draws on the ground at the grid's height (San Francisco's stand 5 to 90 m up:
    Lake Merced, Golden Gate Park's), so it takes the grid as land does."""
    return np.isnan(g) | ((c == 2) & (g <= LAKE_M))


def stand(g, c):
    """What a mover on the ground stands on: the grid, never under the sea's surface where the class raster says sea
    (the plane City draws at WATER_Y covers the grid there), and WATER_Y with no tile. Footways out to a ferry's gate
    and onto docks stood 0.5 m under the drawn water."""
    g = np.asarray(g, float)
    return np.where(np.isnan(g), WATER_Y, np.where(sea(g, c), np.maximum(g, WATER_Y), g))


def triangulate(geom):
    """Triangles [(3, 2) arrays] covering a polygon or multipolygon, holes kept (constrained Delaunay)."""
    out = []
    parts = []
    if geom.geom_type == 'Polygon':
        parts = [geom]
    elif geom.geom_type in ('MultiPolygon', 'GeometryCollection'):
        parts = [g for g in geom.geoms if g.geom_type == 'Polygon']
        for g in geom.geoms:
            if g.geom_type == 'MultiPolygon':
                parts.extend(g.geoms)
    for p in parts:
        if p.is_empty or p.area < 1e-4:
            continue
        tc = shapely.constrained_delaunay_triangles(p)
        for t in tc.geoms:
            c = np.asarray(t.exterior.coords)[:3]
            if abs((c[1, 0] - c[0, 0]) * (c[2, 1] - c[0, 1]) - (c[2, 0] - c[0, 0]) * (c[1, 1] - c[0, 1])) > 1e-6:
                out.append(c)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    if len(args) < 2:
        raise SystemExit(__doc__)
    region = tuple(int(v) for v in flags['region'].split(',')) if flags.get('region') else None
    Bake(args[0], os.path.abspath(args[1]), out=os.path.abspath(flags['out']) if flags.get('out') else None, region=region,
         keep='keep' in flags).run()


if __name__ == '__main__':
    main()
