#!/usr/bin/env python3
"""LiDAR rooftops for the city bake: USGS 3DEP point clouds (Entwine Point Tile).

City-agnostic: the dataset comes from the city config,
  "lidar": {"ept": "https://.../ept.json", "fine": [[lon0, lat0, lon1, lat1], ...], ...}
and the bake (tools/bake/bake.py) says where it needs heights.

Rasters in the bake's local frame (+X east, +Z south, meters), at two resolutions:
  fine    1 m, around tall footprints and inside the "fine" boxes (downtown):
          octree nodes down to fineDepth (~9 pts/m^2 in SF), drives tiered massing
  coarse  2 m, every 128 m chunk that holds a building: nodes down to
          coarseDepth (~2 pts/m^2), corrects every building's height
and two statistics per cell (absolute elevation, the DEM's vertical datum:
3DEP EPT keeps NAVD88):
  top     the highest first return: rooftops, parapets, crowns, edges (and tree
          crowns): outlines and tiers come from it
  low     the lowest last return: a pulse that gets through a tree crown ends on
          the roof (or the ground) under it, so a house under a tree reads as
          the house; where top and low disagree by meters, something leafy is
          in the way and the bake keeps a small house's own height. Only below
          tower heights: glass towers scatter multipath ghost points into and
          under themselves, so downtown the lowest return means nothing
Kept points: building class (6) when the dataset classifies buildings (both
statistics), else first returns (top) / last returns (low); noise (7, 18) and
withheld points never count. The bake subtracts its own DEM to get height
above ground.

Only the octree nodes that touch the requested chunks are fetched. Everything
is cached under $SB_LIDAR_CACHE (default tools/bake/.cache/lidar):
  <dataset>/ept.json, <dataset>/h/<key>.json   hierarchy
  <dataset>/d/<key>.laz                         point data (never re-downloaded)
  <slug>_<fine|coarse>_<hash>.npz               rasters for one request (top + low)
Every download is logged (nodes, points, bytes, seconds).

usage (the bake calls plan_chunks + build_rasters itself, and adds tall_chunks to the 1 m plan once
the 2 m raster and its DEM are in; these just run the footprint plan ahead):
  python3 -I tools/bake/lidar.py sf --plan      # what a bake would fetch (nodes, points, MB)
  python3 -I tools/bake/lidar.py sf --fetch     # fetch + rasterize into the cache
"""
import hashlib
import json
import math
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('SB_LIDAR_CACHE', os.path.join(HERE, '.cache', 'lidar'))
CHUNK = 128.0            # m: raster chunk edge in the local frame
NODATA = -32768          # int16 decimeters
NOISE = (7, 18)          # ASPRS low / high noise
BUILDING = 6
WM_R = 6378137.0


def _log(*a):
    print(f'[{time.strftime("%H:%M:%S")}] lidar:', *a, flush=True)


def _get(url, dst, retries=4):
    """Download url to dst atomically (cached: an existing dst is reused)."""
    if os.path.exists(dst):
        return os.path.getsize(dst), False
    tmp = dst + '.part'
    for k in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r, open(tmp, 'wb') as f:
                want = int(r.headers.get('Content-Length') or -1)
                got = 0
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
                    got += len(b)
            if want >= 0 and got != want:
                raise IOError(f'short read {got}/{want}')
            os.replace(tmp, dst)
            return os.path.getsize(dst), True
        except Exception as e:  # noqa: BLE001 (network: retry with backoff)
            if k == retries - 1:
                raise RuntimeError(f'{url}: {e}') from e
            time.sleep(1.5 * (k + 1))
    return 0, False


class Ept:
    """One EPT dataset: hierarchy walk + cached node downloads."""

    def __init__(self, url, log=_log):
        self.url = url.rsplit('/', 1)[0]
        self.name = self.url.rstrip('/').rsplit('/', 1)[-1]
        self.dir = os.path.join(CACHE, self.name)
        self.log = log
        os.makedirs(os.path.join(self.dir, 'h'), exist_ok=True)
        os.makedirs(os.path.join(self.dir, 'd'), exist_ok=True)
        _get(f'{self.url}/ept.json', os.path.join(self.dir, 'ept.json'))
        self.meta = json.load(open(os.path.join(self.dir, 'ept.json')))
        assert self.meta['srs'].get('horizontal') == '3857', 'only web-mercator EPT is supported'
        assert self.meta['dataType'] == 'laszip'
        self.bounds = self.meta['bounds']
        self.size = self.bounds[3] - self.bounds[0]
        self.hier = {}
        self._load_hier('0-0-0-0')
        self.bytes = 0
        self.fetched = 0
        if not any(f.endswith('.laz') for f in os.listdir(os.path.join(self.dir, 'd'))):
            # (a worktree without SB_LIDAR_CACHE gets its own empty cache next to the script)
            log(f'WARNING: no cached point data in {self.dir}: a full city fetch is ~1.4 GB. '
                'Set SB_LIDAR_CACHE to an existing cache to reuse it.')

    def _load_hier(self, key):
        p = os.path.join(self.dir, 'h', f'{key}.json')
        _get(f'{self.url}/ept-hierarchy/{key}.json', p)
        self.hier.update(json.load(open(p)))

    def node_rect(self, key):
        d, x, y, _ = (int(v) for v in key.split('-'))
        s = self.size / (1 << d)
        return (self.bounds[0] + x * s, self.bounds[1] + y * s, self.bounds[0] + (x + 1) * s, self.bounds[1] + (y + 1) * s)

    def walk(self, hit, max_depth):
        """Keys (with point counts) of nodes down to max_depth whose 2D rect satisfies hit(rect).
        Breadth-first, so the sub-hierarchy files of one depth load in parallel."""
        out = {}
        level = ['0-0-0-0']
        while level:
            level = [k for k in level if int(k.split('-')[0]) <= max_depth and k in self.hier and hit(self.node_rect(k))]
            sub = [k for k in level if self.hier[k] == -1]
            if sub:
                with ThreadPoolExecutor(8) as ex:
                    paths = list(ex.map(lambda k: (_get(f'{self.url}/ept-hierarchy/{k}.json', os.path.join(self.dir, 'h', f'{k}.json')), k)[1], sub))
                for k in paths:
                    self.hier.update(json.load(open(os.path.join(self.dir, 'h', f'{k}.json'))))
            nxt = []
            for key in level:
                n = self.hier.get(key, 0)
                if n > 0:
                    out[key] = n
                d, x, y, z = (int(v) for v in key.split('-'))
                for dx in (0, 1):
                    for dy in (0, 1):
                        for dz in (0, 1):
                            ck = f'{d + 1}-{2 * x + dx}-{2 * y + dy}-{2 * z + dz}'
                            if ck in self.hier:
                                nxt.append(ck)
            level = nxt
        return out

    def path(self, key):
        return os.path.join(self.dir, 'd', f'{key}.laz')

    def fetch(self, keys, workers=8):
        t0 = time.time()
        todo = [k for k in keys if not os.path.exists(self.path(k))]
        got = 0

        def one(k):
            return _get(f'{self.url}/ept-data/{k}.laz', self.path(k))

        with ThreadPoolExecutor(workers) as ex:
            for i, (nb, fresh) in enumerate(ex.map(one, todo)):
                if fresh:
                    got += nb
                    self.fetched += 1
                if i % 200 == 199:
                    self.log(f'  fetched {i + 1}/{len(todo)} nodes, {got / 1e6:.0f} MB')
        self.bytes += got
        cached = sum(os.path.getsize(self.path(k)) for k in keys)
        self.log(f'fetch: {len(keys)} nodes ({len(todo)} new, {got / 1e6:.1f} MB downloaded in {time.time() - t0:.0f} s; {cached / 1e6:.1f} MB on disk for this set)')
        return got


class Frame:
    """The bake's local frame (transverse mercator at the city origin, z = -northing)."""

    def __init__(self, proj, minX, minZ, maxX, maxZ):
        from pyproj import Transformer
        self.proj = proj
        self.minX, self.minZ, self.maxX, self.maxZ = minX, minZ, maxX, maxZ
        self.to_wm = Transformer.from_crs(proj, 'EPSG:3857', always_xy=True)
        self.from_wm = Transformer.from_crs('EPSG:3857', proj, always_xy=True)

    def chunk_rect_wm(self, cx, cz):
        """Web-mercator bbox of a local chunk (with a little slack)."""
        x0, z0 = cx * CHUNK - 2, cz * CHUNK - 2
        xs = np.array([x0, x0 + CHUNK + 4, x0, x0 + CHUNK + 4])
        zs = np.array([z0, z0, z0 + CHUNK + 4, z0 + CHUNK + 4])
        ex, ny = self.to_wm.transform(xs, -zs)
        return (float(ex.min()), float(ny.min()), float(ex.max()), float(ny.max()))

    def affine_from_wm(self, rect):
        """Least-squares affine wm -> local (x, z) over a node rect (sub-cm over a few hundred m)."""
        x0, y0, x1, y1 = rect
        gx, gy = np.meshgrid(np.linspace(x0, x1, 4), np.linspace(y0, y1, 4))
        gx, gy = gx.ravel(), gy.ravel()
        e, n = self.from_wm.transform(gx, gy)
        A = np.c_[gx - x0, gy - y0, np.ones_like(gx)]
        cx, *_ = np.linalg.lstsq(A, e, rcond=None)
        cz, *_ = np.linalg.lstsq(A, -np.asarray(n), rcond=None)
        return x0, y0, cx, cz


def _read_points(path, building_class):
    """x, y, z of the kept points + masks: top (first returns) and low (last returns)."""
    import laspy
    las = laspy.read(path)
    cls = np.asarray(las.classification)
    keep = ~np.isin(cls, NOISE)
    try:
        keep &= ~np.asarray(las.withheld, dtype=bool)
    except Exception:  # noqa: BLE001 (older point formats)
        pass
    if building_class:
        keep &= cls == BUILDING
        top = low = np.ones(int(keep.sum()), bool)
    else:
        rn, nr = np.asarray(las.return_number)[keep], np.asarray(las.number_of_returns)[keep]
        top, low = rn <= 1, rn >= nr
        keep_any = top | low
        top, low = top[keep_any], low[keep_any]
        keep[np.nonzero(keep)[0][~keep_any]] = False
    return np.asarray(las.x)[keep], np.asarray(las.y)[keep], np.asarray(las.z)[keep], top, low


def _bin_max(chunks, res, xs, zs, vals):
    """Fold points into per-chunk max rasters (int16 dm). chunks: {(cx, cz): array} (only those keys are filled)."""
    n = int(round(CHUNK / res))
    ix = np.floor(xs / res).astype(np.int64)
    iz = np.floor(zs / res).astype(np.int64)
    ccx = np.floor_divide(ix, n)
    ccz = np.floor_divide(iz, n)
    q = np.clip(np.round(vals * 10), -32000, 32000).astype(np.int16)
    key = (ccx + 4096) * 8192 + (ccz + 4096)
    order = np.lexsort((q, key))
    key, ix, iz, q, ccx, ccz = key[order], ix[order], iz[order], q[order], ccx[order], ccz[order]
    starts = np.r_[0, np.nonzero(key[1:] != key[:-1])[0] + 1, len(key)]
    for a, b in zip(starts[:-1], starts[1:]):
        if a == b:
            continue
        k = (int(ccx[a]), int(ccz[a]))
        arr = chunks.get(k)
        if arr is None:
            continue
        lx = ix[a:b] - k[0] * n
        lz = iz[a:b] - k[1] * n
        cell = lz * n + lx
        # q ascending within the chunk is not enough for duplicates: take the last of each cell run
        o2 = np.lexsort((q[a:b], cell))
        cell, qq = cell[o2], q[a:b][o2]
        last = np.r_[cell[1:] != cell[:-1], True]
        flat = arr.reshape(-1)
        flat[cell[last]] = np.maximum(flat[cell[last]], qq[last])


def build_rasters(cfg, frame, fine_chunks, coarse_chunks, log=_log, plan_only=False):
    """Fetch + rasterize. fine_chunks / coarse_chunks: sets of (cx, cz) 128 m chunk keys.

    Returns {'fine': {(cx, cz): int16[128, 128] dm}, 'coarse': {(cx, cz): int16[64, 64] dm},
    'fineLow': {...}, 'coarseLow': {...}, 'stats': {...}}: absolute elevation per cell (top: highest
    first return; low: lowest last return), NODATA where no kept point fell."""
    L = cfg['lidar']
    ept = Ept(L['ept'], log)
    fine_depth = int(L.get('fineDepth', 7))
    coarse_depth = int(L.get('coarseDepth', 6))
    building_class = bool(L.get('buildingClass', False))
    from shapely.geometry import box
    from shapely.strtree import STRtree

    def hitter(chunks):
        rects = [box(*frame.chunk_rect_wm(cx, cz)) for cx, cz in chunks]
        if not rects:
            return lambda r: False
        tree = STRtree(rects)
        return lambda r: len(tree.query(box(*r))) > 0

    t0 = time.time()
    coarse_nodes = ept.walk(hitter(coarse_chunks), coarse_depth) if coarse_chunks else {}
    fine_nodes = ept.walk(hitter(fine_chunks), fine_depth) if fine_chunks else {}
    allk = set(coarse_nodes) | set(fine_nodes)
    pts = sum(ept.hier[k] for k in allk)
    log(f'plan: coarse {len(coarse_chunks)} chunks <- {len(coarse_nodes)} nodes (depth <= {coarse_depth}), '
        f'fine {len(fine_chunks)} chunks <- {len(fine_nodes)} nodes (depth <= {fine_depth}); '
        f'{len(allk)} nodes, {pts / 1e6:.1f} M points, ~{pts * 9.1 / 1e6:.0f} MB laz; hierarchy walk {time.time() - t0:.0f} s')
    stats = {'nodes': len(allk), 'points': pts, 'coarseNodes': len(coarse_nodes), 'fineNodes': len(fine_nodes)}
    if plan_only:
        return {'fine': {}, 'coarse': {}, 'fineLow': {}, 'coarseLow': {}, 'stats': stats}

    out = {}
    for kind, chunks, nodes, res in (('coarse', coarse_chunks, coarse_nodes, 2.0), ('fine', fine_chunks, fine_nodes, 1.0)):
        if not chunks:
            out[kind] = out[kind + 'Low'] = {}
            continue
        h = hashlib.sha1(json.dumps([ept.url, sorted(chunks), sorted(nodes), res, building_class, frame.proj, 'top+low']).encode()).hexdigest()[:12]
        cpath = os.path.join(CACHE, f'{cfg.get("slug", "city")}_{kind}_{h}.npz')
        if os.path.exists(cpath):
            with np.load(cpath) as z:
                keys, data, low = z['keys'], z['data'], z['low']  # (read each member once: npz members decompress on access)
            out[kind] = {(int(a), int(b)): data[i] for i, (a, b) in enumerate(keys)}
            out[kind + 'Low'] = {(int(a), int(b)): low[i] for i, (a, b) in enumerate(keys)}
            log(f'{kind}: cached raster {os.path.basename(cpath)} ({len(keys)} chunks)')
            continue
        ept.fetch(sorted(nodes))
        n = int(round(CHUNK / res))
        rast = {k: np.full((n, n), NODATA, dtype=np.int16) for k in chunks}
        nlow = {k: np.full((n, n), NODATA, dtype=np.int16) for k in chunks}  # max of -z: the lowest last return
        t1 = time.time()
        kept = 0
        for i, key in enumerate(sorted(nodes)):
            try:
                x, y, z, top, low = _read_points(ept.path(key), building_class)
            except Exception as e:  # noqa: BLE001 (a truncated download from an older run: fetch it again)
                log(f'  {key}: unreadable ({e}), re-fetching')
                os.remove(ept.path(key))
                ept.fetch([key])
                x, y, z, top, low = _read_points(ept.path(key), building_class)
            if not len(x):
                continue
            rx0, ry0, ax, az = frame.affine_from_wm(ept.node_rect(key))
            dx, dy = x - rx0, y - ry0
            lx = ax[0] * dx + ax[1] * dy + ax[2]
            lz = az[0] * dx + az[1] * dy + az[2]
            if top.any():
                _bin_max(rast, res, lx[top], lz[top], z[top])
            if low.any():
                _bin_max(nlow, res, lx[low], lz[low], -z[low])
            kept += len(x)
            if i % 250 == 249:
                log(f'  {kind}: rasterized {i + 1}/{len(nodes)} nodes, {kept / 1e6:.1f} M points kept')
        for k, a in nlow.items():
            a[a != NODATA] *= -1
        log(f'{kind}: {len(nodes)} nodes, {kept / 1e6:.1f} M points kept, rasterized in {time.time() - t1:.0f} s')
        keys = np.array(sorted(rast.keys()), dtype=np.int32).reshape(-1, 2)
        stack = (lambda r: np.stack([r[tuple(k)] for k in keys]) if len(keys) else np.zeros((0, n, n), np.int16))
        np.savez_compressed(cpath, keys=keys, data=stack(rast), low=stack(nlow))
        out[kind] = rast
        out[kind + 'Low'] = nlow
    stats['downloadedBytes'] = ept.bytes
    stats['downloadedNodes'] = ept.fetched
    out['stats'] = stats
    log(f'total: {ept.fetched} nodes / {ept.bytes / 1e6:.1f} MB downloaded this run, {time.time() - t0:.0f} s')
    return out


class Heights:
    """Height lookups over the rasters, for one footprint window at a time."""

    def __init__(self, rasters):
        self.rasters = rasters
        self.fine = rasters.get('fine', {})
        self.coarse = rasters.get('coarse', {})

    def window(self, bounds, fine=True, low=False):
        """(Z int16-dm array [rows=z, cols=x], x0, z0, res) covering bounds=(minx, minz, maxx, maxz), or None.

        Uses the 1 m raster when every chunk under the window has it (fine=True), else the 2 m one.
        low: the lowest-last-return statistic instead of the highest first return."""
        for kind, res in ((('fine', 1.0),) if fine else ()) + (('coarse', 2.0),):
            src = self.rasters.get(kind + ('Low' if low else ''), {})
            n = int(round(CHUNK / res))
            c0x, c0z = int(math.floor(bounds[0] / CHUNK)), int(math.floor(bounds[1] / CHUNK))
            c1x, c1z = int(math.floor(bounds[2] / CHUNK)), int(math.floor(bounds[3] / CHUNK))
            keys = [(cx, cz) for cz in range(c0z, c1z + 1) for cx in range(c0x, c1x + 1)]
            if not all(k in src for k in keys):
                continue
            big = np.empty(((c1z - c0z + 1) * n, (c1x - c0x + 1) * n), dtype=np.int16)
            for cx, cz in keys:
                big[(cz - c0z) * n:(cz - c0z + 1) * n, (cx - c0x) * n:(cx - c0x + 1) * n] = src[(cx, cz)]
            # crop to the bounds (cell-aligned)
            ox, oz = c0x * CHUNK, c0z * CHUNK
            i0 = max(0, int(math.floor((bounds[0] - ox) / res)))
            j0 = max(0, int(math.floor((bounds[1] - oz) / res)))
            i1 = min(big.shape[1], int(math.ceil((bounds[2] - ox) / res)))
            j1 = min(big.shape[0], int(math.ceil((bounds[3] - oz) / res)))
            return big[j0:j1, i0:i1], ox + i0 * res, oz + j0 * res, res
        return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    slug = args[0] if args else 'sf'
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json')))
    cfg['slug'] = slug
    if '--plan' not in sys.argv and '--fetch' not in sys.argv:
        print(__doc__)
        return
    # plan from the footprint data alone (no DEM): chunks with buildings, fine chunks around tall ones
    import geopandas as gpd
    lat0, lon0 = cfg['origin']
    proj = f'+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'
    df = gpd.read_parquet(cfg['structures'])
    if 'FIPS' in df.columns and cfg.get('fips'):
        df = df[df['FIPS'] == cfg['fips']]
    lon_a, lat_a, lon_b, lat_b = cfg['bbox']
    df = df.cx[lon_a:lon_b, lat_a:lat_b].to_crs(proj)
    frame = Frame(proj, 0, 0, 0, 0)
    fine, coarse = plan_chunks(cfg, df.geometry.values, df['HEIGHT'].astype(float).values, proj)
    build_rasters(cfg, frame, fine, coarse, plan_only='--plan' in sys.argv)


def tall_chunks(coarse, dem_at, have, min_height=30.0, min_area=200.0):
    """Chunks of the 2 m raster, outside `have`, holding a roof this tall (smooth: tree crowns are
    rough) over at least min_area m^2, plus neighbors with that much tall LiDAR of any kind (the rest
    of those roofs). Towers whose footprints are missing or wrong (1550 Mission stands on lots that
    were houses) are invisible to a plan made from footprint heights: the bake fetches the 1 m raster
    here too."""
    from scipy import ndimage
    n = next(iter(coarse.values())).shape[0] if coarse else 64
    res = CHUNK / n
    cc = (np.arange(n) + 0.5) * res
    found, part = set(), set()
    for (cx, cz), a in coarse.items():
        if (cx, cz) in have:
            continue
        Z = np.where(a == NODATA, np.nan, a / 10.0)
        X, Zc = np.meshgrid(cx * CHUNK + cc, cz * CHUNK + cc)
        H = np.nan_to_num(Z - np.asarray(dem_at(X.ravel(), Zc.ravel())).reshape(Z.shape), nan=0.0)
        rough = ndimage.maximum_filter(H, size=3) - ndimage.minimum_filter(H, size=3)
        tall = ndimage.binary_opening((H >= min_height) & (rough < 2.0))
        if float(tall.sum()) * res * res >= min_area:
            found.add((cx, cz))
        elif float((H >= min_height).sum()) * res * res >= min_area:
            part.add((cx, cz))  # (tall but rough at 2 m: a crown of leaves, or the rest of a roof found next door)
    return found | {(cx + dx, cz + dz) for cx, cz in found for dx in (-1, 0, 1) for dz in (-1, 0, 1) if (cx + dx, cz + dz) in part}


def plan_chunks(cfg, geoms_ne, heights, proj):
    """Chunk sets for footprints given in (easting, northing) of proj: coarse = every chunk with a
    building, fine = chunks within ~16 m of a footprint >= fineMinHeight or inside a "fine" box."""
    from pyproj import Transformer
    L = cfg['lidar']
    tall_h = float(L.get('fineMinHeight', 25.0))
    to_local = Transformer.from_crs('EPSG:4326', proj, always_xy=True)
    boxes = []
    for lo0, la0, lo1, la1 in L.get('fine', []):
        xs, ns = to_local.transform([lo0, lo1, lo0, lo1], [la0, la0, la1, la1])
        boxes.append((min(xs), -max(ns), max(xs), -min(ns)))
    coarse, fine = set(), set()
    for g, h in zip(geoms_ne, heights):
        if g is None or g.is_empty:
            continue
        x0, n0, x1, n1 = g.bounds
        z0, z1 = -n1, -n0
        cx0, cx1 = int(math.floor(x0 / CHUNK)), int(math.floor(x1 / CHUNK))
        cz0, cz1 = int(math.floor(z0 / CHUNK)), int(math.floor(z1 / CHUNK))
        for cz in range(cz0, cz1 + 1):
            for cx in range(cx0, cx1 + 1):
                coarse.add((cx, cz))
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        inbox = any(b[0] <= mx <= b[2] and b[1] <= mz <= b[3] for b in boxes)
        if inbox or (h == h and h >= tall_h):
            pad = 16.0
            for cz in range(int(math.floor((z0 - pad) / CHUNK)), int(math.floor((z1 + pad) / CHUNK)) + 1):
                for cx in range(int(math.floor((x0 - pad) / CHUNK)), int(math.floor((x1 + pad) / CHUNK)) + 1):
                    fine.add((cx, cz))
    return fine, coarse


if __name__ == '__main__':
    main()
