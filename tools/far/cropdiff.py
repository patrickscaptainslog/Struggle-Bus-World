#!/usr/bin/env python3
# Side-by-side crops of what changed between two shot folders: A | B | changed pixels, one row per name.
#   python -I tools/far/cropdiff.py <dirA> <dirB> <out.png> [name ...]   (default every PNG in both)
# Crops the changed pixels' bounding box (padded), in game pixels (3 x 3 blocks of the @3x shot), scaled by 3.
import os
import sys

import numpy as np
from PIL import Image

a_dir, b_dir, out = sys.argv[1:4]
names = sys.argv[4:] or sorted(f[:-4] for f in os.listdir(a_dir) if f.endswith('.png') and not f.endswith('-diff.png') and os.path.exists(os.path.join(b_dir, f)))
rows = []
for n in names:
    a = np.asarray(Image.open(os.path.join(a_dir, n + '.png')).convert('RGB'))[1::3, 1::3]
    b = np.asarray(Image.open(os.path.join(b_dir, n + '.png')).convert('RGB'))[1::3, 1::3]
    d = (a != b).any(axis=2)
    if not d.any():
        continue
    ys, xs = np.nonzero(d)
    x0, x1 = max(0, xs.min() - 12), min(a.shape[1], xs.max() + 13)
    y0, y1 = max(0, ys.min() - 12), min(a.shape[0], ys.max() + 13)
    x1 = min(x1, x0 + 200)
    mark = (a * 0.3).astype(np.uint8)
    mark[d] = (255, 255, 255)
    row = np.concatenate([a[y0:y1, x0:x1], np.full((y1 - y0, 3, 3), 255, np.uint8), b[y0:y1, x0:x1], np.full((y1 - y0, 3, 3), 255, np.uint8), mark[y0:y1, x0:x1]], axis=1)
    print(n, 'game box x', x0, x1, 'y', y0, y1, 'changed', int(d.sum()))
    rows.append(row)
w = max(r.shape[1] for r in rows)
rows = [np.pad(r, ((0, 6), (0, w - r.shape[1]), (0, 0))) for r in rows]
im = Image.fromarray(np.concatenate(rows, axis=0))
Image.fromarray(np.asarray(im)).resize((im.width * 3, im.height * 3), Image.NEAREST).save(out)
print(out, im.width * 3, im.height * 3)
