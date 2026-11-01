#!/usr/bin/env python3
# Crops of one game-pixel box from several shots, side by side, scaled up.
#   python -I tools/far/zoom.py <out.png> <x0> <y0> <x1> <y1> <scale> <shot.png> [shot.png ...]
# (x, y in game pixels of a 393 x 852 @3x shot; a shot already in game pixels is taken as it is.)
import sys

import numpy as np
from PIL import Image

out = sys.argv[1]
x0, y0, x1, y1, s = (int(v) for v in sys.argv[2:7])
cells = []
for p in sys.argv[7:]:
    a = np.asarray(Image.open(p).convert('RGB'))
    if a.shape[1] > 500:
        a = a[1::3, 1::3]
    c = Image.fromarray(a[y0:y1, x0:x1]).resize(((x1 - x0) * s, (y1 - y0) * s), Image.NEAREST)
    cells.append(np.asarray(c))
    cells.append(np.full((cells[-1].shape[0], 6, 3), 255, np.uint8))
Image.fromarray(np.concatenate(cells[:-1], axis=1)).save(out)
print(out)
