#!/usr/bin/env python3
"""Download a city's large raw inputs that are not committed to the repo.

usage: python3 -I tools/bake/fetch_inputs.py sf

Saves into tools/bake/.data/ (git-ignored) under the file names the city config uses,
where bake.py's data_path() finds them. Small inputs (the SF slice of FEMA/ORNL USA
Structures, public domain) are committed in tools/bake/data/. LiDAR (lidar.py) and the
1/3 arc-second DEM (read over HTTP) fetch themselves.
"""
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

# USGS 3DEP 1 m DEM, 2023 SF lidar project (public domain), by config file name
SOURCES = {
    'sf': {
        f'USGS_1M_10_{t}.tif': f'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/CA_SanFrancisco_B23/TIFF/USGS_1M_10_{t}_CA_SanFrancisco_B23.tif'
        for t in ('x54y418', 'x54y419', 'x55y418', 'x55y419')
    },
}


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else 'sf'
    out = os.path.join(HERE, '.data')
    os.makedirs(out, exist_ok=True)
    for name, url in SOURCES.get(slug, {}).items():
        dst = os.path.join(out, name)
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            print('have', name)
            continue
        print('fetch', url)
        urllib.request.urlretrieve(url, dst + '.part')
        os.replace(dst + '.part', dst)
    print('done ->', out)


if __name__ == '__main__':
    main()
