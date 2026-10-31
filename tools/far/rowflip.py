#!/usr/bin/env python3
# Crawl row by row, for two or more --seq bursts side by side: the share of game pixels that change between frames 1/30 s apart, per
# `step` rows, after the best whole-pixel shift of each slab of rows.
#   python -I tools/far/rowflip.py <y0> <y1> <step> <prefix> [prefix ...]
# And a heat map of the first prefix's flips: <prefix>-flips.png (white = flipped in many of the frames).
import sys
from importlib.machinery import SourceFileLoader

import numpy as np
from PIL import Image

sh = SourceFileLoader('sh', __file__.replace('far\\rowflip.py', 'shimmer.py').replace('far/rowflip.py', 'shimmer.py')).load_module()

y0, y1, step = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
M, N = 3, 5


def key(a):
    return (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]


table = []
for pre in sys.argv[4:]:
    fr = [key(sh.game_px(f'{pre}-{i}.png', 3)) for i in range(N + 1)]
    h, w = fr[0].shape
    flips = np.zeros((h, w), float)
    col = []
    for y in range(y0, y1, step):
        vals = []
        for i in range(N):
            a = fr[i][y:y + step, M:w - M]
            best, sel = 1.0, None
            for sy in range(-M, M + 1):
                for sx in range(-M, M + 1):
                    b = fr[i + 1][y + sy:y + step + sy, M + sx:w - M + sx]
                    if b.shape != a.shape:
                        continue
                    d = a != b
                    m = float(d.mean())
                    if m < best:
                        best, sel = m, d
            vals.append(best)
            flips[y:y + step, M:w - M] += sel
        col.append(np.mean(vals) * 100)
    table.append(col)
    img = np.clip(flips / N * 255 * 1.6, 0, 255).astype(np.uint8)
    Image.fromarray(img[y0:y1]).resize((w * 2, (y1 - y0) * 2), Image.NEAREST).save(pre + '-flips.png')
print('rows      ' + ' '.join(f'{p.replace(chr(92), "/").split("/")[-2][:9]:>9}' for p in sys.argv[4:]))
for k, y in enumerate(range(y0, y1, step)):
    print(f'{y:3d}-{y + step:3d}   ' + ' '.join(f'{t[k]:8.2f}%' for t in table))
