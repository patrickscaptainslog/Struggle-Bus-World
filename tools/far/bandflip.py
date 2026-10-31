#!/usr/bin/env python3
# Crawl by screen band over a tools/altitude.mjs --seq burst: for each pair of frames 1/30 s apart, the share of game pixels in a band
# that change after the best whole-pixel shift of that band (the camera's own motion explains the rest).
#   python -I tools/far/bandflip.py <prefix> [n=5] [bands, e.g. 195-265,265-375,375-648]
# Reads <prefix>-0.png .. <prefix>-n.png. Prints the mean per band, in percent. Bands are SPIKE.md section 6's.
import sys
from importlib.machinery import SourceFileLoader

import numpy as np

sh = SourceFileLoader('sh', __file__.replace('far\\bandflip.py', 'shimmer.py').replace('far/bandflip.py', 'shimmer.py')).load_module()

pre = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
bands = [tuple(int(v) for v in b.split('-')) for b in (sys.argv[3] if len(sys.argv) > 3 else '195-265,265-375,375-648').split(',')]
M = 3


def key(a):
    return (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]


frames = [key(sh.game_px(f'{pre}-{i}.png', 3)) for i in range(n + 1)]
out = {}
for y0, y1 in bands:
    vals = []
    for i in range(n):
        A, B = frames[i], frames[i + 1]
        h, w = min(A.shape[0], B.shape[0]), min(A.shape[1], B.shape[1])
        best = 1.0
        for sy in range(-M, M + 1):
            for sx in range(-M, M + 1):
                a = A[y0:min(y1, h - M), M:w - M]
                b = B[y0 + sy:min(y1, h - M) + sy, M + sx:w - M + sx]
                best = min(best, float((a != b).mean()))
        vals.append(best * 100)
    out[f'{y0}-{y1}'] = float(np.mean(vals))
print(pre.replace('\\', '/').split('/')[-2] + ': ' + '  '.join(f'{k} {v:.2f}%' for k, v in out.items()))
