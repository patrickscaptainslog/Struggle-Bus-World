#!/usr/bin/env python3
"""City bake: footprints + DEM -> compact binary tiles for the phone.

City-agnostic: everything city-specific lives in tools/bake/cities/<slug>.json.

Inputs (per city config):
  structures  GeoParquet of building footprints (EPSG:4326) with HEIGHT,
              OCC_CLS, PRIM_OCC, BUILD_ID (FEMA/ORNL USA Structures schema).
              Swap-in point for DataSF footprints when that host is reachable.
  dem         USGS 3DEP 1 m DEM GeoTIFFs (any CRS).

Outputs (public/city/<slug>/):
  city.json        manifest (tiles, neighborhoods, landmarks, start pose)
  b_<tx>_<tz>.bin  buildings in a 256 m tile (footprint rings, heights, style)
  t_<tx>_<tz>.bin  terrain heights (4 m), ground class, obstacle tops (8 m), trees
  far.bin          skyline LOD (tall buildings as boxes) + 32 m terrain for the
                   whole city, so distant hills and towers loom through the fog

Binary layouts are documented in src/world/tiles.ts (the reader). Keep in sync.

usage: python3 -I tools/bake/bake.py sf [--bbox=lon0,lat0,lon1,lat1] [--out=dirname]
"""
import json
import math
import os
import struct
import sys
import time
from collections import defaultdict

import numpy as np
import geopandas as gpd
import shapely
from shapely.geometry import Polygon, MultiPolygon, box
from shapely.strtree import STRtree
from shapely import affinity
from pyproj import Transformer
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TILE = 256.0
TERRAIN_N = 65           # samples per terrain tile edge (4 m)
TERRAIN_CELL = TILE / (TERRAIN_N - 1)
OBST_N = 32              # obstacle cells per tile edge (8 m)
DEM_RES = 2.0            # resampled DEM resolution in the local frame (m)
FAR_CELL = 32.0

ARCH = {'generic': 0, 'victorian': 1, 'flats': 2, 'commercial': 3, 'tower': 4, 'stucco': 5, 'marina': 6, 'shed': 7, 'civic': 8}

GROUND_PAVED, GROUND_GRASS, GROUND_WATER, GROUND_SIDEWALK = 0, 1, 2, 3
CLASS_N = 128            # ground-class texels per tile edge (2 m)


def log(*a):
    print(f'[{time.strftime("%H:%M:%S")}]', *a, flush=True)


def hash32(*vals):
    h = 2166136261
    for v in vals:
        for b in struct.pack('<q', int(v)):
            h ^= b
            h = (h * 16777619) & 0xFFFFFFFF
    return h


class Rand:
    """Deterministic per-building RNG (stable across bakes)."""

    def __init__(self, seed):
        self.s = (seed & 0xFFFFFFFF) or 1

    def next(self):
        self.s ^= (self.s << 13) & 0xFFFFFFFF
        self.s ^= self.s >> 17
        self.s ^= (self.s << 5) & 0xFFFFFFFF
        return self.s / 4294967296.0


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    slug = args[0] if args else 'sf'
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json')))
    if 'bbox' in flags:
        cfg['bbox'] = [float(v) for v in flags['bbox'].split(',')]
    out_dir = os.path.join(ROOT, 'public', 'city', flags.get('out', slug))
    os.makedirs(out_dir, exist_ok=True)
    lat0, lon0 = cfg['origin']
    proj = f'+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'
    to_local = Transformer.from_crs('EPSG:4326', proj, always_xy=True)

    def ll2xz(lon, lat):
        e, n = to_local.transform(lon, lat)
        return e, -n

    lon_a, lat_a, lon_b, lat_b = cfg['bbox']
    xs, zs = zip(*[ll2xz(lo, la) for lo in (lon_a, lon_b) for la in (lat_a, lat_b)])
    minX, maxX = math.floor(min(xs) / TILE) * TILE, math.ceil(max(xs) / TILE) * TILE
    minZ, maxZ = math.floor(min(zs) / TILE) * TILE, math.ceil(max(zs) / TILE) * TILE
    log('city frame', minX, minZ, maxX, maxZ)

    # ---------------------------------------------------------------- DEM
    W = int((maxX - minX) / DEM_RES)
    H = int((maxZ - minZ) / DEM_RES)
    dem = np.full((H, W), np.nan, dtype=np.float32)
    # local frame raster: row 0 = minZ (north edge, since z = -northing), x right
    dst_transform = from_origin(minX, -minZ, DEM_RES, DEM_RES)  # in proj coords (northing = -z)
    for path in cfg['dem']:
        with rasterio.open(path) as src:
            tmp = np.full((H, W), np.nan, dtype=np.float32)
            reproject(source=rasterio.band(src, 1), destination=tmp, src_transform=src.transform, src_crs=src.crs,
                      src_nodata=src.nodata, dst_transform=dst_transform, dst_crs=proj, dst_nodata=np.nan,
                      resampling=Resampling.bilinear)
            m = ~np.isnan(tmp)
            dem[m] = tmp[m]
            log('dem', os.path.basename(path), int(m.sum()))
    nodata = np.isnan(dem)
    log('dem nodata fraction', float(nodata.mean()))
    # water = nodata; give it sea level, and smooth the coast a bit
    dem_filled = np.where(nodata, 0.0, dem).astype(np.float32)

    def dem_at(x, z):
        """bilinear sample of the local DEM at arrays x, z"""
        fx = (np.asarray(x) - minX) / DEM_RES - 0.5
        fz = (np.asarray(z) - minZ) / DEM_RES - 0.5
        fx = np.clip(fx, 0, W - 1.001)
        fz = np.clip(fz, 0, H - 1.001)
        ix = np.floor(fx).astype(int)
        iz = np.floor(fz).astype(int)
        tx = fx - ix
        tz = fz - iz
        a = dem_filled[iz, ix]
        b = dem_filled[iz, ix + 1]
        c = dem_filled[iz + 1, ix]
        d = dem_filled[iz + 1, ix + 1]
        return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz

    # ---------------------------------------------------------- structures
    df = gpd.read_parquet(cfg['structures'])
    if 'FIPS' in df.columns and cfg.get('fips'):
        df = df[df['FIPS'] == cfg['fips']]
    df = df.cx[lon_a:lon_b, lat_a:lat_b]
    df = df.to_crs(proj)
    log('structures', len(df))

    polys, attrs = [], []
    for row in df.itertuples(index=False):
        g = row.geometry
        if g is None or g.is_empty:
            continue
        parts = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
        for k, p in enumerate(parts):
            if p.area < 12:
                continue
            # flip northing -> z (south positive)
            ext = np.asarray(p.exterior.coords)
            ext[:, 1] = -ext[:, 1]
            q = Polygon(ext)
            if not q.is_valid:
                q = q.buffer(0)
                if isinstance(q, MultiPolygon):
                    q = max(q.geoms, key=lambda a: a.area)
            q = shapely.simplify(q, 0.25, preserve_topology=True)
            if q.is_empty or q.area < 12:
                continue
            h = float(row.HEIGHT) if row.HEIGHT == row.HEIGHT and row.HEIGHT is not None else float('nan')
            polys.append(q)
            attrs.append({
                'id': int(row.BUILD_ID) * 4 + k,
                'occ': str(row.OCC_CLS or ''),
                'prim': str(row.PRIM_OCC or ''),
                'h': h,
            })
    log('polygons', len(polys))

    # fill missing heights from neighbors (median within 40 m), else occupancy default
    cent = np.array([[p.centroid.x, p.centroid.y] for p in polys])
    hs = np.array([a['h'] for a in attrs])
    from scipy.spatial import cKDTree
    known = ~np.isnan(hs) & (hs > 2.0)
    kt = cKDTree(cent[known])
    for i in np.where(~known)[0]:
        idx = kt.query_ball_point(cent[i], 40.0)
        if idx:
            hs[i] = float(np.median(hs[known][idx]))
        else:
            hs[i] = 7.5 if attrs[i]['occ'] == 'Residential' else 6.0
        attrs[i]['h'] = max(3.0, min(hs[i], 14.0) if polys[i].area < 400 else hs[i])
    for i in np.where(known)[0]:
        attrs[i]['h'] = float(hs[i])

    # -------------------------------------------------- blocks (street walls)
    log('closing blocks')
    tree_all = STRtree(polys)
    closed = shapely.unary_union([p.buffer(9.0, join_style='mitre', mitre_limit=2.0) for p in polys])
    closed = closed.buffer(-9.0, join_style='mitre', mitre_limit=2.0)
    block_geoms = list(closed.geoms) if isinstance(closed, MultiPolygon) else [closed]
    block_rings = [shapely.LineString(b.exterior.coords) for b in block_geoms if not b.is_empty]
    ring_tree = STRtree(block_rings)
    log('blocks', len(block_rings))

    def frontage_edges(p):
        """edges of polygon p that lie on a block's street wall, longest first"""
        c = np.asarray(p.exterior.coords)[:-1]
        n = len(c)
        mids = [(c[i] + c[(i + 1) % n]) * 0.5 for i in range(n)]
        pts = shapely.points(np.array(mids))
        near = ring_tree.query_nearest(pts, max_distance=3.0, return_distance=True)
        on = set(int(i) for i in near[0][0])
        edges = []
        for i in range(n):
            a, b = c[i], c[(i + 1) % n]
            L = float(np.hypot(*(b - a)))
            if i in on and L >= 4.0:
                edges.append((L, i))
        edges.sort(reverse=True)
        return [i for _, i in edges]

    # ------------------------------------------------------- split rows into lots
    LOT_WIDTHS = [6.1, 7.0, 7.6, 7.6, 7.6, 7.6, 8.2, 8.5, 9.1, 10.0, 7.6, 7.3]

    def ring_ccw(p):
        p = shapely.geometry.polygon.orient(p, sign=1.0)
        return p

    def split_row(p, a, seed):
        """Cut a merged row of attached houses into lots along its street frontages."""
        p = ring_ccw(p)
        c = np.asarray(p.exterior.coords)[:-1]
        n = len(c)
        fronts = frontage_edges(p)
        if not fronts:
            return [(p, None)]
        rnd = Rand(seed)
        lots = []
        taken = None
        depth_max = 26.0
        for ei in fronts[:3]:
            A, B = c[ei], c[(ei + 1) % n]
            e = B - A
            L = float(np.hypot(*e))
            if L < 9.0:
                continue
            u = e / L
            # inward normal for a CCW ring in (x, z): rotate edge by +90 deg -> (-uz, ux)
            # (shapely orient(sign=1) gives CCW in a y-up frame; our z is flipped, so test it)
            nrm = np.array([-u[1], u[0]])
            probe = shapely.Point(*(A + u * L * 0.5 + nrm * 1.0))
            if not p.contains(probe):
                nrm = -nrm
            t = 0.0
            widths = []
            while t < L - 0.5:
                w = LOT_WIDTHS[int(rnd.next() * len(LOT_WIDTHS))]
                if rnd.next() < 0.08:
                    w *= 2.0  # an occasional double lot (apartment flats)
                if L - (t + w) < 4.5:
                    w = L - t
                widths.append((t, min(L, t + w)))
                t += w
            for (t0, t1) in widths:
                q0 = A + u * t0
                q1 = A + u * t1
                quad = Polygon([q0, q1, q1 + nrm * depth_max, q0 + nrm * depth_max])
                try:
                    piece = p.intersection(quad)
                    if taken is not None:
                        piece = shapely.make_valid(piece).difference(taken)
                except shapely.errors.GEOSException:
                    continue
                if piece.is_empty:
                    continue
                if isinstance(piece, MultiPolygon) or piece.geom_type == 'GeometryCollection':
                    cands = [g for g in getattr(piece, 'geoms', []) if g.geom_type == 'Polygon']
                    if not cands:
                        continue
                    piece = max(cands, key=lambda g: g.area)
                if piece.area < 20:
                    continue
                piece = shapely.make_valid(piece)
                if piece.geom_type != 'Polygon':
                    continue
                lots.append((piece, ei))
                try:
                    taken = piece if taken is None else shapely.make_valid(taken.union(piece))
                except shapely.errors.GEOSException:
                    taken = shapely.make_valid(shapely.unary_union([taken.buffer(0), piece.buffer(0)]))
        if not lots:
            return [(p, None)]
        try:
            rest = p.difference(taken)
        except shapely.errors.GEOSException:
            rest = shapely.make_valid(p).difference(shapely.make_valid(taken).buffer(0))
        if not rest.is_empty:
            rparts = list(rest.geoms) if hasattr(rest, 'geoms') else [rest]
            for r in rparts:
                if r.geom_type != 'Polygon':
                    continue
                if r.area >= 45:
                    lots.append((r, None))
                else:
                    # glue small leftovers onto the lot they touch most
                    best, bi = 0, -1
                    for li, (lp, _) in enumerate(lots):
                        s = lp.buffer(0.3).intersection(r).area
                        if s > best:
                            best, bi = s, li
                    if bi >= 0:
                        try:
                            merged = shapely.make_valid(lots[bi][0]).union(shapely.make_valid(r).buffer(0.05)).buffer(-0.05)
                        except shapely.errors.GEOSException:
                            continue
                        if merged.geom_type == 'Polygon':
                            lots[bi] = (merged, lots[bi][1])
        return lots

    def district_style(x, z):
        lon, lat = to_local.transform(x, -z, direction='INVERSE')
        for d in cfg.get('districts', []):
            if d['lon'][0] <= lon <= d['lon'][1] and d['lat'][0] <= lat <= d['lat'][1]:
                return d['style']
        return 'victorian'

    hood_ll = cfg.get('neighborhoods', [])
    hood_xz = np.array([ll2xz(lo, la) for _, la, lo in hood_ll]) if hood_ll else np.zeros((0, 2))
    hood_tree = cKDTree(hood_xz) if len(hood_xz) else None

    log('splitting rows into lots')
    # Merged rows can carry a block-wide height (e.g. a whole Victorian block at 23 m).
    # Prefer the median of nearby small, single-house footprints for big merged rows.
    areas = np.array([p.area for p in polys])
    small = (areas < 400) & np.array([a['occ'] == 'Residential' for a in attrs]) & ~np.isnan(hs) & (hs > 3)
    small_tree = cKDTree(cent[small]) if small.any() else None
    small_h = hs[small]
    buildings = []  # dicts
    for i, (p, a) in enumerate(zip(polys, attrs)):
        h = a['h']
        occ = a['occ']
        residentialish = occ in ('Residential', 'Unclassified', '')
        if residentialish and p.area > 1200 and small_tree is not None:
            idx = small_tree.query_ball_point(cent[i], 160.0)
            if len(idx) >= 4:
                h = min(h, float(np.median(small_h[idx])) * 1.08)
        can_split = residentialish and h < 30.0 and p.area > 150.0
        pieces = split_row(p, a, a['id']) if can_split else [(ring_ccw(p), None)]
        rnd = Rand(hash32(a['id'], 7))
        for k, (q, fe) in enumerate(pieces):
            q = ring_ccw(q)
            q = shapely.simplify(q, 0.2, preserve_topology=True)
            if q.is_empty or q.geom_type != 'Polygon' or q.area < 15:
                continue
            hh = h
            if len(pieces) > 1:
                hh = h * (0.86 + 0.28 * rnd.next())
                if rnd.next() < 0.12:
                    hh *= 0.78  # the odd two-story among three-story neighbors
            buildings.append({'poly': q, 'h': max(3.0, hh), 'occ': occ, 'prim': a['prim'],
                              'stable': (a['id'] * 64 + k) & 0xFFFFFFFF, 'front_edge_hint': fe})
    log('buildings after split', len(buildings))

    # ---------------------------------------------------------- classify + ground
    log('classifying')
    for b in buildings:
        p = b['poly']
        c = np.asarray(p.exterior.coords)[:-1]
        gy = dem_at(c[:, 0], c[:, 1])
        cy = float(dem_at([p.centroid.x], [p.centroid.y])[0])
        gmin = float(min(gy.min(), cy))
        gmean = float((gy.mean() + cy) * 0.5)
        b['baseY'] = gmin - 0.4
        b['roofY'] = gmean + b['h']
        fronts = frontage_edges(p)
        b['front'] = fronts[0] if fronts else 255
        b['front2'] = 255
        if len(fronts) > 1:
            # second frontage only if roughly perpendicular (a corner house)
            e0 = c[(fronts[0] + 1) % len(c)] - c[fronts[0]]
            e1 = c[(fronts[1] + 1) % len(c)] - c[fronts[1]]
            cosang = abs(np.dot(e0, e1)) / (np.linalg.norm(e0) * np.linalg.norm(e1) + 1e-9)
            if cosang < 0.4:
                b['front2'] = fronts[1]
        # frontage width
        if b['front'] != 255:
            a0 = c[b['front']]
            a1 = c[(b['front'] + 1) % len(c)]
            fw = float(np.hypot(*(a1 - a0)))
        else:
            mrr = p.minimum_rotated_rectangle
            cc = np.asarray(mrr.exterior.coords)
            fw = float(min(np.hypot(*(cc[1] - cc[0])), np.hypot(*(cc[2] - cc[1]))))
        h = b['h']
        occ = b['occ']
        style = district_style(p.centroid.x, p.centroid.y)
        if h >= 38:
            arch = 'tower'
        elif occ in ('Commercial', 'Industrial') and h >= 5:
            arch = 'commercial'
        elif occ in ('Government', 'Assembly', 'Education'):
            arch = 'civic' if h >= 9 else 'commercial'
        elif h < 4.2 or p.area < 30:
            arch = 'shed'
        elif h >= 17 or fw > 14 or p.area > 900:
            arch = 'flats'
        else:
            arch = style if style in ('stucco', 'marina') else 'victorian'
        b['arch'] = ARCH[arch]
        floor_h = 3.6 if arch == 'victorian' else (3.1 if arch in ('stucco', 'marina') else 3.3)
        b['floors'] = int(max(1, min(250, round(h / floor_h))))
        if hood_tree is not None:
            b['hood'] = int(hood_tree.query([p.centroid.x, p.centroid.y])[1])
        else:
            b['hood'] = 0
        b['seed'] = hash32(b['stable']) & 0xFF

    # stable dense index: sort by tile then by stable id
    for b in buildings:
        b['tx'] = int(math.floor(b['poly'].centroid.x / TILE))
        b['tz'] = int(math.floor(b['poly'].centroid.y / TILE))
    buildings.sort(key=lambda b: (b['tz'], b['tx'], b['stable']))
    for i, b in enumerate(buildings):
        b['index'] = i

    # ----------------------------------------------------------- ground class
    log('ground classes + trees')
    cov = np.zeros((H, W), dtype=bool)
    shapes = [(b['poly'], 1) for b in buildings]
    from rasterio.features import rasterize
    # rasterize in local frame: transform maps (col,row) -> (x, z) via proj coords; use z directly
    local_transform = rasterio.Affine(DEM_RES, 0, minX, 0, DEM_RES, minZ)
    cov = rasterize(shapes, out_shape=(H, W), transform=local_transform, fill=0, dtype=np.uint8).astype(bool)
    dist = ndimage.distance_transform_edt(~cov) * DEM_RES
    water = nodata | (dem_filled < 0.3)
    water = ndimage.binary_opening(water, iterations=2)
    grass = (dist > 17.0) & ~water
    grass = ndimage.binary_opening(grass, iterations=2)
    ground = np.zeros((H, W), dtype=np.uint8)
    # sidewalks: a 3.5 m band in front of buildings that isn't grass or water
    ground[(dist > 0) & (dist <= 3.6)] = GROUND_SIDEWALK
    ground[cov] = GROUND_SIDEWALK
    ground[grass] = GROUND_GRASS
    ground[water] = GROUND_WATER

    def ground_at(x, z):
        ix = np.clip(((np.asarray(x) - minX) / DEM_RES).astype(int), 0, W - 1)
        iz = np.clip(((np.asarray(z) - minZ) / DEM_RES).astype(int), 0, H - 1)
        return ground[iz, ix], dist[iz, ix]

    # trees: park trees on a jittered grid in grass, street trees along frontages
    trees = []
    rng = np.random.default_rng(1234)
    gx = np.arange(minX + 5, maxX, 11.0)
    gz = np.arange(minZ + 5, maxZ, 11.0)
    GX, GZ = np.meshgrid(gx, gz)
    GX = GX + rng.uniform(-4.5, 4.5, GX.shape)
    GZ = GZ + rng.uniform(-4.5, 4.5, GZ.shape)
    cls, dd = ground_at(GX.ravel(), GZ.ravel())
    keep = (cls == GROUND_GRASS) & (dd > 20) & (rng.uniform(size=cls.shape) < 0.55)
    for x, z in zip(GX.ravel()[keep], GZ.ravel()[keep]):
        kind = 2 if rng.uniform() < 0.18 else 1
        trees.append((float(x), float(z), 0.75 + 0.7 * rng.uniform(), kind))
    for b in buildings:
        if b['front'] == 255 or b['arch'] not in (ARCH['victorian'], ARCH['flats'], ARCH['stucco'], ARCH['marina']):
            continue
        rr = Rand(hash32(b['stable'], 99))
        if rr.next() > 0.3:
            continue
        p = b['poly']
        c = np.asarray(p.exterior.coords)[:-1]
        i0 = b['front']
        A, B = c[i0], c[(i0 + 1) % len(c)]
        e = B - A
        L = float(np.hypot(*e))
        if L < 3:
            continue
        u = e / L
        nrm = np.array([-u[1], u[0]])
        mid = A + u * L * (0.3 + 0.4 * rr.next())
        if p.contains(shapely.Point(*(mid + nrm * 0.8))):
            nrm = -nrm
        pt = mid + nrm * 3.2
        cl, dd1 = ground_at([pt[0]], [pt[1]])
        if cl[0] == GROUND_PAVED and dd1[0] > 2.0:
            trees.append((float(pt[0]), float(pt[1]), 0.55 + 0.35 * rr.next(), 0))
    log('trees', len(trees))

    # ------------------------------------------------------------ tile output
    tiles = defaultdict(list)
    for b in buildings:
        tiles[(b['tx'], b['tz'])].append(b)
    tree_tiles = defaultdict(list)
    for t in trees:
        tree_tiles[(int(math.floor(t[0] / TILE)), int(math.floor(t[1] / TILE)))].append(t)

    manifest_tiles = []
    for old in os.listdir(out_dir):
        if old.endswith('.bin'):
            os.remove(os.path.join(out_dir, old))
    total_bytes = 0
    all_tiles = set(tiles.keys()) | set(tree_tiles.keys())
    # terrain tiles cover every tile in the frame that has any land (or buildings/trees)
    for tz in range(int(minZ // TILE), int(maxZ // TILE)):
        for tx in range(int(minX // TILE), int(maxX // TILE)):
            x0, z0 = tx * TILE, tz * TILE
            sx = x0 + np.arange(TERRAIN_N) * TERRAIN_CELL
            sz = z0 + np.arange(TERRAIN_N) * TERRAIN_CELL
            SX, SZ = np.meshgrid(sx, sz)
            cl, _ = ground_at(SX.ravel(), SZ.ravel())
            if (tx, tz) not in all_tiles and np.all(cl == GROUND_WATER):
                continue
            all_tiles.add((tx, tz))
    for (tx, tz) in sorted(all_tiles, key=lambda t: (t[1], t[0])):
        x0, z0 = tx * TILE, tz * TILE
        bl = tiles.get((tx, tz), [])
        # --- buildings
        if bl:
            rings = []
            for b in bl:
                c = np.asarray(b['poly'].exterior.coords)[:-1]
                rings.append(np.round((c - [x0, z0]) * 10).astype(np.int16))
            vstart = np.zeros(len(bl) + 1, dtype=np.uint32)
            for i, r in enumerate(rings):
                vstart[i + 1] = vstart[i] + len(r)
            vx = np.concatenate([r[:, 0] for r in rings]).astype(np.int16)
            vz = np.concatenate([r[:, 1] for r in rings]).astype(np.int16)
            hdr = struct.pack('<4sIIffI', b'SBB1', len(bl), int(vstart[-1]), x0, z0, 0)
            body = b''.join([
                np.array([b['index'] for b in bl], dtype=np.uint32).tobytes(),
                np.array([b['stable'] for b in bl], dtype=np.uint32).tobytes(),
                vstart.tobytes(),
                np.array([b['baseY'] for b in bl], dtype=np.float32).tobytes(),
                np.array([b['roofY'] for b in bl], dtype=np.float32).tobytes(),
            ])
            u8 = b''.join([
                np.array([b['arch'] for b in bl], dtype=np.uint8).tobytes(),
                np.array([b['floors'] for b in bl], dtype=np.uint8).tobytes(),
                np.array([min(255, b['front']) for b in bl], dtype=np.uint8).tobytes(),
                np.array([min(255, b['front2']) for b in bl], dtype=np.uint8).tobytes(),
                np.array([b['hood'] for b in bl], dtype=np.uint8).tobytes(),
                np.array([b['seed'] for b in bl], dtype=np.uint8).tobytes(),
            ])
            pad = (-len(u8)) % 4
            data = hdr + body + u8 + b'\0' * pad + vx.tobytes() + vz.tobytes()
            with open(os.path.join(out_dir, f'b_{tx}_{tz}.bin'), 'wb') as f:
                f.write(data)
            total_bytes += len(data)
        # --- terrain
        sx = x0 + np.arange(TERRAIN_N) * TERRAIN_CELL
        sz = z0 + np.arange(TERRAIN_N) * TERRAIN_CELL
        SX, SZ = np.meshgrid(sx, sz)
        hgt = dem_at(SX.ravel(), SZ.ravel())
        cl, _ = ground_at(SX.ravel(), SZ.ravel())
        hq = np.clip(np.round(hgt * 10), -32000, 32000).astype(np.int16)
        # obstacles: max(roof, ground) per 8 m cell
        obst = np.zeros((OBST_N, OBST_N), dtype=np.float32)
        oc = TILE / OBST_N
        ox = x0 + (np.arange(OBST_N) + 0.5) * oc
        oz = z0 + (np.arange(OBST_N) + 0.5) * oc
        OX, OZ = np.meshgrid(ox, oz)
        # ground max over each cell (sample 3x3)
        gmax = np.full(OX.shape, -1e9, dtype=np.float32)
        for dx in (-0.4, 0, 0.4):
            for dz in (-0.4, 0, 0.4):
                gmax = np.maximum(gmax, dem_at((OX + dx * oc).ravel(), (OZ + dz * oc).ravel()).reshape(OX.shape))
        obst = gmax
        tl = trees_here = tree_tiles.get((tx, tz), [])
        hdr = struct.pack('<4siiHHfff', b'SBT1', tx, tz, TERRAIN_N, OBST_N, TERRAIN_CELL, x0, z0)
        tbytes = hq.tobytes() + cl.astype(np.uint8).tobytes()
        tbytes += b'\0' * ((-(len(hdr) + len(tbytes))) % 4)
        obst_off = len(hdr) + len(tbytes)
        # rasterize buildings in this and neighboring tiles into obstacle cells
        neigh = []
        for ddx in (-1, 0, 1):
            for ddz in (-1, 0, 1):
                neigh += tiles.get((tx + ddx, tz + ddz), [])
        if neigh:
            otr = rasterio.Affine(oc, 0, x0, 0, oc, z0)
            order = sorted(neigh, key=lambda b: b['roofY'])
            roof = rasterize([(b['poly'].buffer(3.0), float(b['roofY'])) for b in order], out_shape=(OBST_N, OBST_N),
                             transform=otr, fill=-1e9, dtype=np.float32, merge_alg=rasterio.enums.MergeAlg.replace)
            obst = np.maximum(obst, roof)
        oq = np.clip(np.round(obst * 10), -32000, 32000).astype(np.int16)
        tbytes2 = oq.tobytes()
        tb = struct.pack('<HH', len(tl), 0)
        tr = b''
        for (x, z, s, k) in tl:
            y = float(dem_at([x], [z])[0])
            tr += struct.pack('<hhhBB', int(round((x - x0) * 10)), int(round((z - z0) * 10)), int(round(y * 10)), int(min(255, s * 100)), k)
        # 2 m ground-class texture (texel centers)
        cx = x0 + (np.arange(CLASS_N) + 0.5) * (TILE / CLASS_N)
        cz = z0 + (np.arange(CLASS_N) + 0.5) * (TILE / CLASS_N)
        CX, CZ = np.meshgrid(cx, cz)
        ccl, _ = ground_at(CX.ravel(), CZ.ravel())
        tr += b'\0' * ((-(len(hdr) + len(tbytes) + len(tbytes2) + len(tb) + len(tr))) % 4)
        data = hdr + tbytes + tbytes2 + tb + tr + ccl.astype(np.uint8).tobytes()
        with open(os.path.join(out_dir, f't_{tx}_{tz}.bin'), 'wb') as f:
            f.write(data)
        total_bytes += len(data)
        manifest_tiles.append([tx, tz, len(bl)])

    # ------------------------------------------------------------------- far
    log('far LOD')
    tall = [b for b in buildings if b['h'] >= 16.0]
    fw = int((maxX - minX) / FAR_CELL) + 1
    fh = int((maxZ - minZ) / FAR_CELL) + 1
    fxs = minX + np.arange(fw) * FAR_CELL
    fzs = minZ + np.arange(fh) * FAR_CELL
    FX, FZ = np.meshgrid(fxs, fzs)
    fhgt = dem_at(FX.ravel(), FZ.ravel())
    fcl, _ = ground_at(FX.ravel(), FZ.ravel())
    fbs = []
    for b in tall:
        mrr = b['poly'].minimum_rotated_rectangle
        cc = np.asarray(mrr.exterior.coords)[:4]
        e0 = cc[1] - cc[0]
        e1 = cc[2] - cc[1]
        cx, cz = cc.mean(axis=0)
        yaw = math.atan2(e0[1], e0[0])
        fbs.append((cx, cz, np.hypot(*e0) / 2, np.hypot(*e1) / 2, yaw, b['baseY'], b['roofY'], b['index']))
    hdr = struct.pack('<4sIIIfff', b'SBF1', len(fbs), fw, fh, minX, minZ, FAR_CELL)
    body = np.array([f[:7] for f in fbs], dtype=np.float32).tobytes() + np.array([f[7] for f in fbs], dtype=np.uint32).tobytes()
    body += np.clip(np.round(fhgt * 10), -32000, 32000).astype(np.int16).tobytes() + fcl.astype(np.uint8).tobytes()
    with open(os.path.join(out_dir, 'far.bin'), 'wb') as f:
        f.write(hdr + body)
    total_bytes += len(hdr) + len(body)

    # -------------------------------------------------------------- manifest
    sx, sz = ll2xz(cfg['start']['lon'], cfg['start']['lat'])
    lms = []
    for lm in cfg.get('landmarks', []):
        x, z = ll2xz(lm['lon'], lm['lat'])
        lms.append({'kind': lm['kind'], 'x': x, 'z': z, 'y': float(dem_at([x], [z])[0]), 'height': lm['height']})
    manifest = {
        'name': cfg['name'], 'slug': slug, 'origin': cfg['origin'], 'proj': proj,
        'tileSize': TILE, 'terrainN': TERRAIN_N, 'obstN': OBST_N, 'classN': CLASS_N,
        'bounds': [minX, minZ, maxX, maxZ],
        'buildingCount': len(buildings),
        'tiles': manifest_tiles,
        'neighborhoods': [{'name': n, 'x': float(x), 'z': float(z)} for (n, _, _), (x, z) in zip(hood_ll, hood_xz)],
        'landmarks': lms,
        'start': {'x': sx, 'z': sz, 'heading': math.radians(cfg['start']['heading_deg'])},
        'source': 'FEMA/ORNL USA Structures (public domain) + USGS 3DEP 1 m DEM (public domain); rows split into ~25 ft lots',
    }
    with open(os.path.join(out_dir, 'city.json'), 'w') as f:
        json.dump(manifest, f)
    log(f'done: {len(buildings)} buildings, {len(manifest_tiles)} tiles, {total_bytes/1e6:.1f} MB raw')


if __name__ == '__main__':
    main()
