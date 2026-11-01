#!/usr/bin/env python3
# Two frames side by side, one game-pixel box, scaled up: A | B.
#   python -I tools/far/ab.py <out.png> <x0> <y0> <x1> <y1> <scale> <a.png> <b.png> [more.png ...]    (stacked, not beside, with --stack first)
import sys

import numpy as np
from PIL import Image

args = sys.argv[1:]
stack = args[0] == '--stack'
if stack:
    args = args[1:]
out = args[0]
x0, y0, x1, y1, s = (int(v) for v in args[1:6])
cells = []
for p in args[6:]:
    a = np.asarray(Image.open(p).convert('RGB'))
    if a.shape[1] > 500:
        a = a[1::3, 1::3]
    cells.append(np.asarray(Image.fromarray(a[y0:y1, x0:x1]).resize(((x1 - x0) * s, (y1 - y0) * s), Image.NEAREST)))
gap = np.full((6, cells[0].shape[1], 3) if stack else (cells[0].shape[0], 6, 3), 255, np.uint8)
parts = []
for c in cells:
    parts += [c, gap]
Image.fromarray(np.concatenate(parts[:-1], axis=0 if stack else 1)).save(out)
print(out)
