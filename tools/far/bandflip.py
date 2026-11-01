#!/usr/bin/env python3
# Crawl by screen band over a tools/altitude.mjs --seq burst: for each pair of frames 1/30 s apart, the share of game pixels in a band that change after the best
# whole-pixel shift of that band (the camera's own motion explains the rest).
#   python -I tools/far/bandflip.py <prefix> [n=5] [bands, e.g. 195-265,265-375,375-648]
# Reads <prefix>-0.png .. <prefix>-n.png. Prints the mean per band, in percent: `city`, the flips on the city's own pixels (tools/far/land.py), is the figure SPIKE.md
# section 6's gate reads; `all` counts sky and water too, which dilutes the crawl (a Sunset band of 195-265 is half sky and sea). The bands are SPIKE.md's, plus 240-300,
# where the far city actually starts at the game's poses: the first band's own top half is mostly not city.
import os
import sys
from importlib.machinery import SourceFileLoader

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sh = SourceFileLoader('sh', os.path.join(HERE, '..', 'shimmer.py')).load_module()
land = SourceFileLoader('land', os.path.join(HERE, 'land.py')).load_module()

BANDS = [(195, 265), (240, 300), (265, 375), (375, 648)]
M = 3


def key(a):
    return (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]


def flips(pre, n=5, bands=BANDS):
    """{'y0-y1': {'city': flips on city pixels, 'all': flips on every pixel, 'share': city's share of the band}}, percent, each with its own best shift."""
    px = [sh.game_px(f'{pre}-{i}.png', 3) for i in range(n + 1)]
    frames = [key(p) for p in px]
    out = {}
    for y0, y1 in bands:
        every, city, share = [], [], []
        for i in range(n):
            A, B = frames[i], frames[i + 1]
            h, w = min(A.shape[0], B.shape[0]), min(A.shape[1], B.shape[1])
            a = A[y0:min(y1, h - M), M:w - M]
            m = land.city(px[i])[y0:min(y1, h - M), M:w - M]
            best = best_city = 1.0
            for sy in range(-M, M + 1):
                for sx in range(-M, M + 1):
                    d = a != B[y0 + sy:min(y1, h - M) + sy, M + sx:w - M + sx]
                    best = min(best, float(d.mean()))
                    if m.any():
                        best_city = min(best_city, float(d[m].mean()))
            every.append(best * 100)
            city.append(best_city * 100)
            share.append(float(m.mean()) * 100)
        out[f'{y0}-{y1}'] = {'city': round(float(np.mean(city)), 2), 'all': round(float(np.mean(every)), 2), 'share': round(float(np.mean(share)), 1)}
    return out


if __name__ == '__main__':
    pre = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    bands = [tuple(int(v) for v in b.split('-')) for b in sys.argv[3].split(',')] if len(sys.argv) > 3 else BANDS
    res = flips(pre, n, bands)
    print(pre.replace('\\', '/').split('/')[-2] + ': ' + '  '.join(f"{k} city {v['city']:.2f}% (all {v['all']:.2f}%, {v['share']:.0f}% city)" for k, v in res.items()))
