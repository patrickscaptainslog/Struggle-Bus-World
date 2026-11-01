#!/usr/bin/env python3
# Crawl in a turn: bandflip's measure with a wider search, a turn moves the frame sideways by more than a few pixels between frames. For each
# pair of frames 1/30 s apart, per slab of `step` rows, the share of game pixels that change after that slab's best whole-pixel shift; the mean per
# SPIKE.md band, and the worst slab.
#   python -I tools/far/panflip.py <prefix> [n=5] [step=20] [mx=24] [my=3]
import sys
from importlib.machinery import SourceFileLoader

import numpy as np

sh = SourceFileLoader('sh', __file__.replace('far\\panflip.py', 'shimmer.py').replace('far/panflip.py', 'shimmer.py')).load_module()

pre = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
step = int(sys.argv[3]) if len(sys.argv) > 3 else 20
MX = int(sys.argv[4]) if len(sys.argv) > 4 else 24
MY = int(sys.argv[5]) if len(sys.argv) > 5 else 3
BANDS = [(195, 265), (265, 375), (375, 648)]


def key(a):
    return (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]


frames = [key(sh.game_px(f'{pre}-{i}.png', 3)) for i in range(n + 1)]
h, w = frames[0].shape
rows = list(range(195, 648, step))
table = np.zeros((n, len(rows)))
shifts = np.zeros((n, len(rows)), int)
for f in range(n):
    A, B = frames[f], frames[f + 1]
    for k, y in enumerate(rows):
        a = A[y:y + step, MX:w - MX]
        best, bx = 1.0, 0
        for sy in range(-MY, MY + 1):
            for sx in range(-MX, MX + 1):
                b = B[y + sy:y + step + sy, MX + sx:w - MX + sx]
                m = float((a != b).mean())
                if m < best:
                    best, bx = m, sx
        table[f, k] = best * 100
        shifts[f, k] = bx
col = table.mean(axis=0)
out = []
for y0, y1 in BANDS:
    sel = [k for k, y in enumerate(rows) if y0 <= y < y1]
    out.append(f'{y0}-{y1} {col[sel].mean():.2f}%')
print(pre.replace('\\', '/').split('/')[-2] + ': ' + '  '.join(out) + f'  worst slab {col.max():.2f}% at {rows[int(col.argmax())]}; shift {int(np.median(np.abs(shifts)))} px a frame')
print('   ' + ' '.join(f'{y}:{v:.1f}' for y, v in zip(rows, col)))
