#!/usr/bin/env python3
# How far off is the far band from what replaces it, class by class? Reads hold-still swaps (tools/shots.mjs hold-<pose>) and the same frames with
# ?fardebug, where the far ground writes its class as a ramp and the boxes write 11 (roof) and 15 (wall).
#   python -I tools/far/calib.py <runDir> <debugDir> <pose> [pose ...]
# For every class, over the pixels of the area that swapped: mean luma before, after, and the lo that would close the gap (a ramp step, 1/7 of light,
# is about 24 units of luma). Prints a table per pose and all poses together.
import json
import os
import re
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
NAMES = ['PAVED', 'GRASS', 'WATER', 'SIDEWALK', 'PLAZA', 'PATH', 'SAND', 'RAIL', 'FOREST', 'YARD', 'ROCK', 'ROOF', 'TREE', 'ICE', 'ROCK_BARE', 'WALL']
text = open(os.path.join(ROOT, 'src', 'render', 'palette.ts'), encoding='utf8').read()
idx = {m.group(1): int(m.group(2)) for m in re.finditer(r'^\s+(\w+):\s*(\d+),', text, re.M)}
ramps = {idx[n]: re.findall(r'#([0-9a-fA-F]{6})', b) for n, b in re.findall(r"\[Ramp\.(\w+)\]:\s*\[([^\]]+)\]", text) if n in idx}
code = {}
STEP = 4  # light 0.6 rounds to step 4
for c in range(16):
    if c in ramps:
        code.setdefault(int(ramps[c][STEP], 16), c)


def game(p):
    a = np.asarray(Image.open(p).convert('RGB')).astype(np.int64)
    return a[1::3, 1::3]


def luma(a):
    return a @ np.array([0.299, 0.587, 0.114])


run, dbg = sys.argv[1:3]
total = {}
for pose in sys.argv[3:]:
    a = game(f'{run}/hold-{pose}-day-0.png')
    b = game(f'{run}/hold-{pose}-day-1.png')
    d = game(f'{dbg}/hold-{pose}-day-0.png')
    k = (d[..., 0] << 16) | (d[..., 1] << 8) | d[..., 2]
    # the area that swapped: anything near a pixel that changed, rows of the far band
    changed = (a != b).any(axis=2)
    area = ndimage.binary_dilation(ndimage.uniform_filter(changed.astype(float), size=9) > 0.08, iterations=2)
    area[:195] = False
    area[420:] = False
    Ya, Yb = luma(a), luma(b)
    rows = []
    for key, c in sorted(code.items(), key=lambda kv: kv[1]):
        m = area & (k == key)
        n = int(m.sum())
        if n < 30:
            continue
        rows.append((NAMES[c], n, Ya[m].mean(), Yb[m].mean()))
        t = total.setdefault(NAMES[c], [0, 0.0, 0.0])
        t[0] += n
        t[1] += Ya[m].sum()
        t[2] += Yb[m].sum()
    print(pose, f'area {int(area.sum())} px')
    for name, n, ya, yb in rows:
        print(f'  {name:10s} {n:6d} px  before {ya:6.1f}  after {yb:6.1f}  gap {yb - ya:+6.1f}  lo {(yb - ya) / 24 / 7:+.3f}')
print('all')
for name, (n, sa, sb) in total.items():
    print(f'  {name:10s} {n:6d} px  before {sa / n:6.1f}  after {sb / n:6.1f}  gap {(sb - sa) / n:+6.1f}  lo {(sb - sa) / n / 24 / 7:+.3f}')
