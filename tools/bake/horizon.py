#!/usr/bin/env python3
"""Horizon terrain: the hills around the city (Marin Headlands, East Bay hills,
San Bruno Mountain) from the USGS 3DEP 1/3 arc-second DEM, read remotely from
the COG's overviews. Rendered as fogged silhouettes far beyond the city tiles.

horizon.bin: magic 'SBH1', u32 W, u32 H, f32 minX, f32 minZ, f32 cell, i16 h[W*H] (decimeters; <= 0 is water)

usage: CURL_CA_BUNDLE=... python3 -I tools/bake/horizon.py sf
"""
import json
import math
import os
import struct
import sys

import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CELL = 128.0
DEM = '/vsicurl/https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n38w123/USGS_13_n38w123.tif'


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else 'sf'
    os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json')))
    lat0, lon0 = cfg['origin']
    proj = f'+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'
    half = 32000.0
    minX, maxX = -half, half
    minZ, maxZ = -half, half
    W = int((maxX - minX) / CELL)
    H = int((maxZ - minZ) / CELL)
    dst = np.full((H, W), np.nan, dtype=np.float32)
    with rasterio.open(DEM) as src:
        reproject(source=rasterio.band(src, 1), destination=dst, src_transform=src.transform, src_crs=src.crs,
                  src_nodata=src.nodata, dst_transform=from_origin(minX, -minZ, CELL, CELL), dst_crs=proj,
                  dst_nodata=np.nan, resampling=Resampling.average, num_threads=2,
                  src_overview=2)
    h = np.where(np.isnan(dst), 0.0, dst)
    h = np.clip(np.round(h * 10), -32000, 32000).astype(np.int16)
    out = os.path.join(ROOT, 'public', 'city', slug, 'horizon.bin')
    with open(out, 'wb') as f:
        f.write(struct.pack('<4sIIfff', b'SBH1', W, H, minX, minZ, CELL))
        f.write(h.tobytes())
    print('horizon', W, H, os.path.getsize(out), 'bytes; max', float(np.nanmax(dst)))


if __name__ == '__main__':
    main()
