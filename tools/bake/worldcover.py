#!/usr/bin/env python3
"""ESA WorldCover 10 m (v200, 2021) for the city bake: land cover every city on Earth gets for free.

The bake's evidence for trees (and the QA report's for trees, water and sand). Public, anonymous
S3 bucket of 3 x 3 degree cloud-optimized GeoTIFFs (EPSG:4326, 1/12000 degree pixels, ~10 m),
named after their south-west corner:

  https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N36W123_Map.tif

Only the city's window is read (HTTP range reads of the COG blocks through GDAL's /vsicurl);
bboxes spanning tiles are mosaicked on the global pixel grid (exact integer offsets). Tiles that
don't exist are open sea (WorldCover has a tile for every 3 x 3 degree cell with land): filled
with water. The crop is cached as tools/bake/.cache/worldcover/<slug>.tif (deflate GeoTIFF), grown
when a bake needs more than it holds.

Classes (uint8, 0 = no data): 10 tree cover, 20 shrubland, 30 grassland, 40 cropland, 50 built-up,
60 bare / sparse vegetation, 70 snow and ice, 80 permanent water bodies, 90 herbaceous wetland,
95 mangroves, 100 moss and lichen.

  ensure(slug, bounds)                            the cached crop covering lon/lat bounds (fetched / grown on demand)
  local_grid(slug, proj, minX, minZ, W, H, res)   classes on a local frame's grid (row 0 = minZ), nearest neighbour
  fraction(mask, cells)                           local fraction of a mask (0..200) over a square window
  tree_mask(wc)                                   WorldCover's trees: tree cover (10) and mangroves (95)

overture.py fetches the crop with the city's extracts; bake.py (trees) and qa.py (the plausibility report) read it.

License: CC BY 4.0. (c) ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data
(2021) processed by ESA WorldCover consortium.

usage: python3 -I tools/bake/worldcover.py <slug> [--refresh]    (fetch / refresh the city's crop by hand)
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('SB_WORLDCOVER_CACHE', os.path.join(HERE, '.cache', 'worldcover'))
URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif'
PX = 12000            # pixels per degree (the global grid every tile sits on)
TILE_DEG = 3
PAD = 0.003           # degrees fetched around what a bake asks for (filters at the frame edge)

TREE, SHRUB, GRASS, CROP, BUILT, BARE, SNOW, WATER, WETLAND, MANGROVE, MOSS = 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100
NAMES = {0: 'no data', 10: 'tree cover', 20: 'shrubland', 30: 'grassland', 40: 'cropland', 50: 'built-up', 60: 'bare / sparse',
         70: 'snow / ice', 80: 'water', 90: 'herbaceous wetland', 95: 'mangroves', 100: 'moss / lichen'}
ATTRIBUTION = ('© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by '
               'ESA WorldCover consortium')
GDAL_ENV = {'CPL_VSIL_CURL_ALLOWED_EXTENSIONS': '.tif', 'GDAL_DISABLE_READDIR_ON_OPEN': 'EMPTY_DIR',
            'GDAL_HTTP_MAX_RETRY': '4', 'GDAL_HTTP_RETRY_DELAY': '2', 'VSI_CACHE': 'TRUE'}


def tile_name(lat, lon):
    """'N36W123' for the tile whose south-west corner is (lat, lon) (multiples of 3)."""
    return f'{"N" if lat >= 0 else "S"}{abs(lat):02d}{"E" if lon >= 0 else "W"}{abs(lon):03d}'


def tiles_for(w, s, e, n):
    """[(name, lat0, lon0)] of every tile the bounds touch."""
    out = []
    for lat in range(int(math.floor(s / TILE_DEG)) * TILE_DEG, int(math.ceil(n / TILE_DEG)) * TILE_DEG, TILE_DEG):
        for lon in range(int(math.floor(w / TILE_DEG)) * TILE_DEG, int(math.ceil(e / TILE_DEG)) * TILE_DEG, TILE_DEG):
            out.append((tile_name(lat, lon), lat, lon))
    return out


def _exists(url):
    """True if the tile exists, False if it doesn't (404: open sea); network trouble raises. (The bucket is
    listable, so S3 answers 404 for a missing tile: a 403 is a proxy or a policy, never "sea".)"""
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=30) as r:
                return r.status == 200
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False
            err = e
        except (urllib.error.URLError, TimeoutError, OSError) as e:  # noqa: PERF203
            err = e
        time.sleep(2 * (k + 1))
    raise SystemExit(f'worldcover: {url}: {err} (network?)')


def _pixels(w, s, e, n):
    """Global pixel bounds (c0, r0, c1, r1) covering lon/lat bounds (row 0 = 90 N, col 0 = 180 W)."""
    return (int(math.floor((w + 180.0) * PX)), int(math.floor((90.0 - n) * PX)),
            int(math.ceil((e + 180.0) * PX)), int(math.ceil((90.0 - s) * PX)))


def _read(c0, r0, c1, r1, log):
    """uint8 classes for global pixels [r0, r1) x [c0, c1), mosaicked from the tiles."""
    import rasterio
    from rasterio.windows import Window
    out = np.zeros((r1 - r0, c1 - c0), np.uint8)
    w, n = c0 / PX - 180.0, 90.0 - r0 / PX
    e, s = c1 / PX - 180.0, 90.0 - r1 / PX
    with rasterio.Env(**GDAL_ENV):
        for name, lat, lon in tiles_for(w, s, e, n):
            tc0, tr0 = (lon + 180) * PX, (90 - (lat + TILE_DEG)) * PX   # the tile's global pixel origin
            a0, b0 = max(c0, tc0), max(r0, tr0)
            a1, b1 = min(c1, tc0 + TILE_DEG * PX), min(r1, tr0 + TILE_DEG * PX)
            if a1 <= a0 or b1 <= b0:
                continue
            url = URL.format(tile=name)
            if not _exists(url):
                out[b0 - r0:b1 - r0, a0 - c0:a1 - c0] = WATER
                log(f'worldcover: no tile {name} (open sea): water')
                continue
            t0 = time.time()
            for k in range(4):
                try:
                    with rasterio.open('/vsicurl/' + url) as src:
                        out[b0 - r0:b1 - r0, a0 - c0:a1 - c0] = src.read(1, window=Window(a0 - tc0, b0 - tr0, a1 - a0, b1 - b0))
                    break
                except rasterio.errors.RasterioIOError as ex:
                    if k == 3:
                        raise SystemExit(f'worldcover: {url}: {ex}')
                    log(f'worldcover: {name}: {ex}; retrying')
                    time.sleep(3 * (k + 1))
            log(f'worldcover: {name} window {a1 - a0} x {b1 - b0} px in {time.time() - t0:.1f} s')
    return out


def ensure(slug, bounds_list, log=print, refresh=False):
    """Path of the city's cached crop covering every (w, s, e, n) in bounds_list (+ PAD); fetched or grown
    (re-read over the union with what the cache held) when it doesn't."""
    import rasterio
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'{slug}.tif')
    want = [_pixels(w - PAD, s - PAD, e + PAD, n + PAD) for w, s, e, n in bounds_list]
    c0, r0 = min(p[0] for p in want), min(p[1] for p in want)
    c1, r1 = max(p[2] for p in want), max(p[3] for p in want)
    if os.path.exists(path) and not refresh:
        with rasterio.open(path) as src:
            b = src.bounds  # (the crop sits on the global grid: its bounds are whole pixels)
            h = (round((b.left + 180.0) * PX), round((90.0 - b.top) * PX), round((b.right + 180.0) * PX), round((90.0 - b.bottom) * PX))
        if h[0] <= c0 and h[1] <= r0 and h[2] >= c1 and h[3] >= r1:
            return path
        c0, r0, c1, r1 = min(c0, h[0]), min(r0, h[1]), max(c1, h[2]), max(r1, h[3])
        log('worldcover: the cached crop is too small for this bake: growing it')
    t0 = time.time()
    a = _read(c0, r0, c1, r1, log)
    prof = {'driver': 'GTiff', 'dtype': 'uint8', 'count': 1, 'width': a.shape[1], 'height': a.shape[0], 'nodata': 0,
            'crs': 'EPSG:4326', 'transform': rasterio.Affine(1.0 / PX, 0, c0 / PX - 180.0, 0, -1.0 / PX, 90.0 - r0 / PX),
            'compress': 'deflate', 'tiled': True, 'blockxsize': 256, 'blockysize': 256}
    with rasterio.open(path + '.part.tif', 'w', **prof) as dst:
        dst.write(a, 1)
        dst.update_tags(source=URL.format(tile='<tile>'), license='CC BY 4.0', attribution=ATTRIBUTION)
    os.replace(path + '.part.tif', path)
    v, c = np.unique(a, return_counts=True)
    log(f'worldcover: {a.shape[1]} x {a.shape[0]} px -> {path} in {time.time() - t0:.0f} s; '
        + ', '.join(f'{NAMES.get(int(k), k)} {n / a.size * 100:.0f}%' for k, n in zip(v, c) if n / a.size >= 0.005))
    return path


def tree_mask(wc):
    """bool: WorldCover's trees (tree cover and mangroves: both are woods)"""
    return (wc == TREE) | (wc == MANGROVE)


def frame_bounds(proj, minX, minZ, maxX, maxZ):
    """lon/lat bounds (w, s, e, n) of a local frame (+X east, +Z south, meters)."""
    from pyproj import Transformer
    inv = Transformer.from_crs(proj, 'EPSG:4326', always_xy=True)
    xs = np.concatenate([np.linspace(minX, maxX, 17), np.full(17, maxX), np.linspace(minX, maxX, 17), np.full(17, minX)])
    zs = np.concatenate([np.full(17, minZ), np.linspace(minZ, maxZ, 17), np.full(17, maxZ), np.linspace(minZ, maxZ, 17)])
    lon, lat = inv.transform(xs, -zs)
    return float(np.min(lon)), float(np.min(lat)), float(np.max(lon)), float(np.max(lat))


def local_grid(slug, proj, minX, minZ, W, H, res, extra_bounds=(), log=print):
    """uint8 [H, W] WorldCover classes on the bake's local grid (row 0 = minZ, cell (i, j) centred at
    (minX + (j + .5) res, minZ + (i + .5) res)), nearest neighbour from the cached crop."""
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import reproject, Resampling
    fb = frame_bounds(proj, minX, minZ, minX + W * res, minZ + H * res)
    path = ensure(slug, [fb] + list(extra_bounds), log=log)
    out = np.zeros((H, W), np.uint8)
    with rasterio.open(path) as src:
        reproject(source=rasterio.band(src, 1), destination=out, src_transform=src.transform, src_crs=src.crs, src_nodata=0,
                  dst_transform=from_origin(minX, -minZ, res, res), dst_crs=proj, dst_nodata=0, resampling=Resampling.nearest)
    return out


def fraction(mask, cells):
    """uint8 local fraction (0..200 = 0..100 %) of a bool mask over a cells x cells square around every cell."""
    from scipy import ndimage
    m = mask.astype(np.uint8)
    m *= 200
    out = ndimage.uniform_filter(m, size=int(cells), output=np.uint8, mode='nearest')
    del m
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    slug = args[0] if args else 'sf'
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json')))
    w, s, e, n = cfg['bbox']
    print(ensure(slug, [(w, s, e, n)], refresh='--refresh' in sys.argv))


if __name__ == '__main__':
    main()
