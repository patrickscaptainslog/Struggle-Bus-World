#!/usr/bin/env python3
"""Grade a roof rule against the LiDAR (the answer key). Usage: python3 grade.py rule.py [--split train|test|all] [--show N]

A rule is a Python file defining predict(part, parts) -> (shape, dir_byte, rise_m). `part` is one row of dataset.pkl without
its answer: ring (N x 2 world metres, +x east, +z south, CCW as the game stores it), front (index of the street edge
ring[front] -> ring[front+1], 255 none), front2 (a corner's second street edge, 255 none), arch (0 GENERIC 1 VICTORIAN 2
FLATS 3 COMMERCIAL 4 TOWER 5 STUCCO 6 MARINA 7 SHED 8 CIVIC), floors, baseY, groundY, roofY (the roof's height, m:
in the grader the median of the true roof, as a bake has it), tier (0 a building's base part), seed (0-255, stable
random), area (m^2), building (parts of one building share it), neighbours (indices into `parts` of parts touching
this one). `parts` is the list of all parts (also without answers). shape is roofs.py's numbering (FLAT 1, GABLED 2,
HIPPED 3, PYRAMIDAL 4, SKILLION 5, GAMBREL 9, MANSARD 10, HALF_HIPPED 11, SALTBOX 12). dir_byte is the way the main
face looks (roofs.frame: angle = dir/256 turns, D = (cos, sin)); for a gable the ridge runs across D.

The score: the mean over parts of the clipped squared error (m^2, clipped at 1.5 m) between the predicted roof and
the LiDAR first returns over the part (trees and other parts' cells left out). The roof's height is not the rule's
question (a bake has it from LiDAR, OSM heights or floors): every roof, flat included, is set at the height that best
fits (the median of the LiDAR less the predicted shape), so the score is the shape, its direction and its rise. skill = (flat - rule) / (flat - oracle):
0 is drawing every roof flat, 1 is as good as fitting the LiDAR itself.
"""
import sys, pickle, importlib.util, numpy as np, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from roofs import surface, loss, FLAT, NONE
HERE = os.path.dirname(os.path.abspath(__file__))
rows = pickle.load(open(os.path.join(os.environ.get('SB_LADIES', os.path.join(HERE, '..', '..', 'shots', 'tmp', 'ladies')), 'dataset.pkl'), 'rb'))
args = sys.argv[1:]
split = args[args.index('--split') + 1] if '--split' in args else 'train'
show = int(args[args.index('--show') + 1]) if '--show' in args else 0
spec = importlib.util.spec_from_file_location('rule', args[0]); rule = importlib.util.module_from_spec(spec); spec.loader.exec_module(rule)
HIDE = ('cells', 'oracle')
parts = [{k: v for k, v in r.items() if k not in HIDE} for r in rows]
# the split: by place (the west of the box trains, the east is held out), so a rule can't learn single houses
def in_split(r):
    cx = r['ring'][:, 0].mean()
    return split == 'all' or (split == 'train') == (cx < -1180)
def geo_mean(shape, ring, d, R):
    a, b = ring.min(0), ring.max(0)
    xs, zs = np.meshgrid(np.linspace(a[0], b[0], 24), np.linspace(a[1], b[1], 24))
    import shapely
    m = shapely.contains_xy(shapely.Polygon(ring), xs, zs)
    if m.sum() < 3: return 0.5 * R
    return float(surface(shape, ring, d, xs[m], zs[m], R).mean())
L, F, O, n, worst = 0.0, 0.0, 0.0, 0, []
conf = {}
for i, r in enumerate(rows):
    if not in_split(r): continue
    xs, zs, z = r['cells']
    shape, d, R = rule.predict(parts[i], parts)
    shape, d, R = int(shape), int(d) % 256, float(max(0.0, R))
    if shape in (NONE, FLAT) or R < 0.3: shape, R = FLAT, 0.0
    g = surface(shape, r['ring'], d, xs, zs, R)
    l = loss(z - np.median(z - g) - g)
    lf = loss(z - np.median(z))
    o = r['oracle']; lo = min(o['loss'], lf)
    L += l; F += lf; O += lo; n += 1
    key = ('pitched' if o['shape'] != FLAT else 'flat', 'pitched' if shape != FLAT else 'flat'); conf[key] = conf.get(key, 0) + 1
    worst.append((l - lo, i, shape, d, R, o['shape'], o['dir'], o['R']))
L, F, O = L / n, F / n, O / n
print(f'split {split}: {n} parts  rule {L:.4f}  flat {F:.4f}  oracle {O:.4f}  skill {(F - L) / (F - O):.3f}')
print('truth/predicted:', {f'{a}/{b}': v for (a, b), v in sorted(conf.items())})
for w in sorted(worst, reverse=True)[:show]:
    print('  part %d: +%.3f  predicted shape %d dir %d R %.1f   LiDAR shape %d dir %d R %.1f' % (w[1], w[0], w[2], w[3], w[4], w[5], w[6], w[7]))
