#!/usr/bin/env python3
"""Rewrite only the `landmarks` and `start` blocks of public/city/<slug>/city.json from tools/bake/cities/<slug>.json, so a
hero's points and deck can change with no re-bake. The rows come from landmarkrows.py, as the bake's do. Every other key
keeps its value and its text.

usage: python3 -I tools/bake/relandmark.py sf
"""
import importlib.util
import json
import math
import os
import sys

from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def load_module(name):
    sys.dont_write_bytecode = True  # (no __pycache__ in tools/bake)
    spec = importlib.util.spec_from_file_location('sb_' + name, os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else 'sf'
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json'), encoding='utf8'))
    src = os.path.join(ROOT, 'public', 'city', slug)
    path = os.path.join(src, 'city.json')
    with open(path, encoding='utf8', newline='') as f:
        text = f.read()
    man = json.loads(text)
    # (the file stays json.dump's text: a patch shows as those two blocks and nothing else)
    if json.dumps(man) != text:
        raise SystemExit('relandmark: city.json is not what json.dump wrote: nothing changed')
    to_local = Transformer.from_crs('EPSG:4326', man['proj'], always_xy=True)

    def ll2xz(lon, lat):
        e, n = to_local.transform(lon, lat)
        return e, -n

    city = load_module('citydata').City(src)

    def ground(x, z):
        """the height the bake wrote for a row that hasn't moved (the DEM isn't read here), else the baked terrain under it"""
        for old in man['landmarks']:
            if math.hypot(old['x'] - x, old['z'] - z) < 0.01:
                return old['y']
        T = man['tileSize']
        for t in city.terrain_tiles({(math.floor(x / T), math.floor(z / T))}):
            i, j = round((x - t['originX']) / t['cell']), round((z - t['originZ']) / t['cell'])
            return round(float(t['heights'][j, i]), 1)
        return 0.0

    rows = load_module('landmarkrows')
    before = json.loads(text)
    man['landmarks'] = rows.landmark_rows(cfg, ll2xz, ground)
    man['start'] = rows.start_block(cfg, ll2xz)
    with open(path, 'w', encoding='utf8', newline='') as f:
        json.dump(man, f)
    changed = sorted(k for k in set(before) | set(man) if before.get(k) != man.get(k))
    print(f'{slug}: changed {changed or "nothing"}; every other key as it was')


if __name__ == '__main__':
    main()
