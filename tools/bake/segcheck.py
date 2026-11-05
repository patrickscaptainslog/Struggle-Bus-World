#!/usr/bin/env python3
"""OSM.segments() on a made-up extract: a street, path or rail segment that a bridge, tunnel or level takes off the
ground only in part keeps its stretches at grade, each a line of its own with its stretch's name, and nothing a rule
takes off comes back (BRIDGES.md step 4). No data and no network: the rows are written to a temporary cache in metres
(a flat projection), so every length is exact. An extract written before the ranges were kept still leaves such a
segment out whole.

usage: python3 -I tools/bake/segcheck.py [osm.py]     (default: the one beside it; one from before step 4 fails)
"""
import importlib.util
import json
import os
import sys
import tempfile

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import shapely
from shapely.geometry import LineString, Point

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
TOL = 1e-6   # m
OFF = {'is_bridge', 'is_tunnel', 'is_indoor', 'is_covered', 'is_under_construction'}


class Flat:
    """to_local for OSM(): lon and lat read as metres east and north."""
    def transform(self, x, y):
        return x, y


def case(what, xy, want, sub='road', cls='residential', scl=None, road=None, rail=None, level=None, names=None, named=None):
    """want: the stretches expected at grade, (from, to) in metres along the line, or None for the line itself untouched.
    names: Overture's name rules; named: the name every stretch should carry (default the row's own)."""
    return dict(what=what, xy=xy, want=want, sub=sub, cls=cls, scl=scl, road=road, rail=rail, level=level, names=names, named=named)


def flag(v, a, z):
    return {'values': v if isinstance(v, list) else [v], 'between': None if a is None else [a, z]}


def common(v, a, z):
    return {'variant': 'common', 'language': None, 'value': v, 'between': [a, z]}


CASES = [
    case('a bridge in the middle', [(0, 0), (100, 0)], [(0, 40), (60, 100)], road=[flag('is_bridge', 0.4, 0.6)]),
    case('three ranges, two overlapping, cuts between vertices', [(0, 0), (50, 0), (100, 0), (150, 0), (200, 0)],
         [(0, 20), (100, 160), (180, 200)], cls='secondary',
         road=[flag('is_bridge', 0.1, 0.3), flag('is_covered', 0.25, 0.5), flag(['is_tunnel', 'is_link'], 0.8, 0.9)]),
    case('a tunnel with no range: all of it', [(0, 0), (80, 0)], [], cls='primary', road=[flag('is_tunnel', None, None)]),
    case('a bridge from end to end', [(0, 0), (80, 0)], [], cls='motorway', road=[flag('is_bridge', 0.0, 1.0)]),
    case('a level of 0 beside one that is not', [(0, 0), (100, 0)], [(0, 50)], cls='tertiary',
         level=[{'value': 0, 'between': [0.0, 0.5]}, {'value': -1, 'between': [0.5, 1.0]}]),
    case('a level off the ground at one end', [(0, 0), (100, 0)], [(0, 70)], cls='motorway',
         level=[{'value': 1, 'between': [0.7, 1.0]}]),
    case('a stretch at grade under the shortest', [(0, 0), (100, 0)], [], road=[flag('is_bridge', 0.005, 1.0)]),
    case('a stretch at grade just over it', [(0, 0), (100, 0)], [(0, 2)], road=[flag('is_bridge', 0.02, 1.0)]),
    case('a cut 2 cm past a vertex is made at it', [(0, 0), (30, 0), (30, 40)], [(0, 30)], cls='primary',
         road=[flag('is_tunnel', 30.02 / 70, 1.0)]),
    case('nothing off the ground', [(0, 0), (50, 0)], None),
    case('a flag that leaves it on the ground', [(0, 0), (50, 0)], None, cls='primary', road=[flag('is_link', 0.2, 0.4)]),
    case('rail onto a bridge', [(0, 0), (100, 0)], [(0, 50)], sub='rail', cls='standard_gauge',
         rail=[flag(['is_bridge', 'is_passenger'], 0.5, 1.0)]),
    case('a sidewalk under cover at one end', [(0, 0), (100, 0)], [(30, 100)], cls='footway', scl='sidewalk',
         road=[flag('is_covered', 0.0, 0.3)]),
    case('a range out of order: all of it', [(0, 0), (100, 0)], [], road=[flag('is_bridge', 0.6, 0.4)]),
    case('a loop', [(0, 0), (50, 0), (50, 50), (0, 50), (0, 0)], [(0, 50), (100, 200)], cls='service',
         road=[flag('is_bridge', 0.25, 0.5)]),
    case('the stretches at grade of a tunnel take their own names', [(0, 0), (100, 0)], [(0, 30), (80, 100)], cls='primary',
         road=[flag('is_tunnel', 0.3, 0.8)],
         names=[common('Hill Road', 0.0, 0.3), common('Hill Tunnel', 0.3, 0.8),
                {'variant': 'alternate', 'language': None, 'value': 'Old Hill Road', 'between': [0.0, 1.0]},
                {'variant': 'common', 'language': 'fr', 'value': 'Route de la Colline', 'between': [0.8, 1.0]},
                common('Hill Road', 0.8, 1.0)], named='Hill Road'),
]


def primary(k):
    c = CASES[k]
    return 'Hill Tunnel' if c['names'] else f'Case {k} Street'


def write(root, ranged):
    """The cases as an Overture extract under root (overture.py's columns; the *_rules ones only when ranged)."""
    cols = {k: [] for k in ('id', 'subtype', 'class', 'subclass', 'geometry', 'name', 'width', 'level_max', 'road_flags',
                            'rail_flags', 'surface', 'road_flag_rules', 'rail_flag_rules', 'level_rules', 'name_rules')}
    for k, c in enumerate(CASES):
        cols['id'].append(f'case{k}')
        cols['subtype'].append(c['sub'])
        cols['class'].append(c['cls'])
        cols['subclass'].append(c['scl'])
        cols['geometry'].append(shapely.to_wkb(LineString([(x, y + 1000 * k) for x, y in c['xy']])))
        cols['name'].append(primary(k))
        cols['width'].append(None)
        cols['level_max'].append(max(r['value'] for r in c['level']) if c['level'] else None)
        for name in ('road', 'rail'):
            rules = c[name]
            cols[f'{name}_flags'].append(','.join(sorted({v for r in rules for v in r['values']})) if rules else None)
            cols[f'{name}_flag_rules'].append(json.dumps(rules) if rules else None)
        cols['surface'].append(None)
        cols['level_rules'].append(json.dumps(c['level']) if c['level'] else None)
        cols['name_rules'].append(json.dumps(c['names']) if c['names'] else None)
    types = {'width': pa.float64(), 'level_max': pa.int32(), 'geometry': pa.binary()}
    keep = [c for c in cols if ranged or not c.endswith('_rules')]
    t = pa.table({c: pa.array(cols[c], types.get(c, pa.string())) for c in keep})
    d = os.path.join(root, 'test', 'case')
    os.makedirs(d, exist_ok=True)
    pq.write_table(t, os.path.join(d, 'segment.parquet'))
    pq.write_table(pa.table({'id': pa.array([], pa.string()), 'geometry': pa.array([], pa.binary())}), os.path.join(d, 'building.parquet'))


def segments(m, root):
    m.CACHE = root
    return m.OSM({'overture': {'release': 'test'}}, 'case', Flat(), lambda s: None).segments()


def by_case(segs):
    out = {k: [] for k in range(len(CASES))}
    for e in segs:
        out[int(round(-np.asarray(e[0].coords)[0][1] / 1000))].append(e)
    return out


def spans_m(c):
    """The stretches a case's rules take off the ground, in metres: (from, to)."""
    L = LineString(c['xy']).length
    out = []
    for r in (c['road'] or []) + (c['rail'] or []):
        if OFF & set(r['values']):
            b = r['between']
            out.append((0.0, L) if not b or b[0] >= b[1] else (b[0] * L, b[1] * L))
    for r in c['level'] or []:
        if r['value'] != 0:
            b = r['between']
            out.append((0.0, L) if not b else (b[0] * L, b[1] * L))
    return out


def check(m, k, c, es):
    """What's wrong with case k's entries es: [] when right."""
    line = LineString([(x, -(y + 1000 * k)) for x, y in c['xy']])   # as OSM() projects it: z = -north
    why = []
    if c['want'] is None:
        if len(es) != 1 or shapely.to_wkb(es[0][0]) != shapely.to_wkb(line) or es[0][3] != primary(k):
            why.append(f'not the line itself, untouched ({len(es)} entries)')
        return why
    have = []
    for e in es:
        p = e[0]
        if p.geom_type != 'LineString':
            why.append(f'a {p.geom_type}, not a LineString')
            continue
        a = line.project(Point(p.coords[0]))
        have.append((a, a + p.length))
    have.sort()
    want = c['want']
    if len(have) != len(want) or any(abs(h[0] - w[0]) > TOL or abs(h[1] - w[1]) > TOL for h, w in zip(have, want)):
        why.append('at grade ' + (', '.join(f'{a:g}-{z:g}' for a, z in have) or 'nothing') + ' m, want ' +
                   (', '.join(f'{a:g}-{z:g}' for a, z in want) or 'nothing'))
    # nothing a rule takes off: every half metre of every piece, and its ends, outside each stretch
    for e in es:
        p = e[0]
        for t in np.append(np.arange(0.0, p.length, 0.5), p.length):
            s = line.project(p.interpolate(t))
            for a, z in spans_m(c):
                if a + TOL < s < z - TOL:
                    why.append(f'{s:.2f} m is inside the stretch {a:g}-{z:g} m taken off the ground')
    kind = m.RAIL if c['sub'] == 'rail' else m.SIDEWALK if c['scl'] == 'sidewalk' else m.PAVED
    named = '' if c['sub'] == 'rail' else c['named'] or primary(k)
    for e in es:
        if e[1] != kind:
            why.append(f'kind {e[1]}, want {kind}')
        if e[3] != named:
            why.append(f'named {e[3]!r}, want {named!r}')
    return why


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'osm.py')
    spec = importlib.util.spec_from_file_location('sb_osm_check', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    fails = 0
    with tempfile.TemporaryDirectory() as root:
        write(root, True)
        got = by_case(segments(m, root))
        for k, c in enumerate(CASES):
            why = check(m, k, c, got[k])
            fails += bool(why)
            print(('PASS ' if not why else 'FAIL ') + c['what'] + ('' if not why else ': ' + '; '.join(sorted(set(why))[:3])))
        # an extract written before the ranges were kept: the old rule, the whole segment left out
        root2 = os.path.join(root, 'old')
        write(root2, False)
        got = by_case(segments(m, root2))
        why = []
        for k, c in enumerate(CASES):
            flags = {v for r in (c['road'] or []) + (c['rail'] or []) for v in r['values']}
            off = bool(flags & OFF) or (bool(c['level']) and max(r['value'] for r in c['level']) != 0)
            n = len(got[k])
            if (off and n) or (not off and n != 1):
                why.append(f'{c["what"]}: {n} entries')
        fails += bool(why)
        print(('PASS ' if not why else 'FAIL ') + 'an extract with no ranges leaves a segment off the ground in part out whole' +
              ('' if not why else ': ' + '; '.join(why[:3])))
    print(f'{len(CASES) + 1 - fails} of {len(CASES) + 1} pass ({path})')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
