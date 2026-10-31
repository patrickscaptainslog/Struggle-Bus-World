#!/usr/bin/env python3
# Two tools/shots.mjs --det folders: did each view fly the same path? A long run can wander (one region late, the camera 0.2 m off:
# seen once in twelve views): that is a speckle over the whole frame in shotdiff, not a change. Prints the views to run again.
#   python -I tools/far/statcheck.py <dirA> <dirB>     (exit 1 if a view's camera differs)
import json
import sys

a, b = (json.load(open(d + '/stats.json')) for d in sys.argv[1:3])
bad = [k for k in a if k in b and (a[k]['cam'] != b[k]['cam'] or a[k]['regions'] != b[k]['regions'])]
for k in bad:
    print(f"{k}: camera or streaming differs: y {a[k]['y']} / {b[k]['y']}, regions {a[k]['regions']} / {b[k]['regions']}")
print('same flight' if not bad else 'run these again: ' + ','.join(bad))
sys.exit(1 if bad else 0)
