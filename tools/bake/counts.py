#!/usr/bin/env python3
"""Counts of a baked city from its tiles (the 'SBB3' source byte, roof shapes, parts) + its manifest stats.

usage: python3 -I tools/bake/counts.py public/city/sf [--json=out.json]
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from citydata import City  # noqa: E402

FOOT = ['OpenStreetMap', 'Overture (other)', 'USA Structures', 'LiDAR only']
HGT = ['default by class', 'LiDAR', 'OSM height', 'OSM levels', 'USA Structures', 'neighbours']
ROOF = ['untagged', 'flat', 'gabled', 'hipped', 'pyramidal', 'skillion', 'dome', 'onion', 'round', 'gambrel', 'mansard', 'half-hipped', 'saltbox', 'cone']


def main():
    path = sys.argv[1]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[2:] if a.startswith('--'))
    c = City(path)
    foot, hgt, roof, massing = collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter()
    nb = nrec = trees = streets = 0
    names = set()
    for t in c.building_tiles():
        nrec += t['count']
        for i in range(t['count']):
            roof[ROOF[t['roofShape'][i]] if t['roofShape'][i] < len(ROOF) else '?'] += 1
            if i and t['index'][i] == t['index'][i - 1]:
                continue
            nb += 1
            s = int(t['source'][i])
            foot[FOOT[s & 7] if (s & 7) < len(FOOT) else '?'] += 1
            hgt[HGT[(s >> 3) & 7] if ((s >> 3) & 7) < len(HGT) else '?'] += 1
            massing['OSM building parts' if s & 64 else 'LiDAR tiers' if s & 128 else 'one prism (+ courtyard pieces)'] += 1
    for t in c.terrain_tiles():
        trees += len(t['trees'])
        streets += len(t['streets'])
        names |= set(t['names'])
    out = {'buildings': nb, 'records': nrec, 'footprints': dict(foot), 'heights': dict(hgt), 'massing': dict(massing),
           'roofShapes (records)': dict(roof), 'trees': trees, 'streetLines': streets, 'streetNames': len(names),
           'manifestStats': c.manifest.get('stats'), 'sizeMB': round(sum(os.path.getsize(os.path.join(path, f)) for f in os.listdir(path)) / 1e6, 2)}
    print(json.dumps(out, indent=1))
    if flags.get('json'):
        json.dump(out, open(flags['json'], 'w'), indent=1)


if __name__ == '__main__':
    main()
