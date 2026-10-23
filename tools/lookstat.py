#!/usr/bin/env python3
# Shimmer by region on a frame pair exactly 1/30 s apart (tools/look.mjs --seq):
#   python3 -I tools/lookstat.py <prefix>        (reads <prefix>-seq-0.png, <prefix>-seq-1.png)
# Reduces both to game pixels and removes the camera's motion with the best integer shift per
# horizontal band (as tools/shimmer.py), then reports the share of pixels that still changed:
#   all       every pixel
#   sky       plain sky / fully fogged: FOG or SKY_WARM ramp pixels with no other ramp within 3 px
#   fogband   the handover: pixels within 2 px of a FOG / non-FOG boundary (above the hero)
#   trees     GREEN_GREY ramp pixels (crowns and lawns)
#   top15     the top 15% of rows (where the sky band sits at the floor)
# and the same after block matching (12x12 game-px blocks, each with its own best shift within
# +-4 px): what local motion (parallax) can't explain either, i.e. dither churn and crawl; and
# 'vis', the block-matched changes that are visible: a luma step over 0.04 (half a ramp step; a
# hue-only flip between two ramps of the same value doesn't count).
import sys
from importlib.machinery import SourceFileLoader
import numpy as np

sh = SourceFileLoader('sh', __file__.replace('lookstat.py', 'shimmer.py')).load_module()

def hexes(*xs):
    return [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in xs]

FOG = hexes('#5d6873', '#6e7984', '#808a94', '#939ca5', '#a7aeb5', '#bbc1c6', '#cfd3d6', '#e2e4e5',
            '#7d8791', '#919aa1', '#a6abae', '#bbbbb9', '#cfcbc3', '#dfd8cc', '#ece3d4', '#f7eedf')
GREEN = hexes('#141a1a', '#1d2625', '#283331', '#36423f', '#47534f', '#5a6762', '#717d76', '#8f978d')

def key(X):
    return (X[..., 0] << 16) | (X[..., 1] << 8) | X[..., 2]

def member(K, cols):
    ks = np.array([(r << 16) | (g << 8) | b for r, g, b in cols])
    return np.isin(K, ks)

def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out

def main(pre, bands=8, m=4):
    A = sh.game_px(f'{pre}-seq-0.png')
    B = sh.game_px(f'{pre}-seq-1.png')
    h = min(A.shape[0], B.shape[0]); w = min(A.shape[1], B.shape[1])
    KA, KB = key(A[:h, :w]), key(B[:h, :w])
    res = np.zeros((h, w), bool)
    valid = np.zeros((h, w), bool)
    bh = h // bands
    for i in range(bands):
        y0, y1 = i * bh, (i + 1) * bh if i < bands - 1 else h
        ya0, ya1 = max(y0, m), min(y1, h - m)
        best = None
        for sy in range(-m, m + 1):
            for sx in range(-m, m + 1):
                c = (KA[ya0:ya1, m:w - m] != KB[ya0 + sy:ya1 + sy, m + sx:w - m + sx]).mean()
                if best is None or c < best[0]:
                    best = (c, sx, sy)
        _, sx, sy = best
        res[ya0:ya1, m:w - m] = KA[ya0:ya1, m:w - m] != KB[ya0 + sy:ya1 + sy, m + sx:w - m + sx]
        valid[ya0:ya1, m:w - m] = True
    # block-matched residual
    resb = np.zeros((h, w), bool)
    resv = np.zeros((h, w), bool)
    validb = np.zeros((h, w), bool)
    LA = (A[:h, :w] @ np.array([0.299, 0.587, 0.114])) / 255.0
    LB = (B[:h, :w] @ np.array([0.299, 0.587, 0.114])) / 255.0
    bs = 12
    for y0 in range(m, h - m - bs + 1, bs):
        for x0 in range(m, w - m - bs + 1, bs):
            a = KA[y0:y0 + bs, x0:x0 + bs]
            best = None
            for sy in range(-m, m + 1):
                for sx in range(-m, m + 1):
                    d = a != KB[y0 + sy:y0 + sy + bs, x0 + sx:x0 + sx + bs]
                    c = d.sum()
                    if best is None or c < best[0]:
                        best = (c, d, sx, sy)
            resb[y0:y0 + bs, x0:x0 + bs] = best[1]
            _, _, sx, sy = best
            resv[y0:y0 + bs, x0:x0 + bs] = np.abs(LA[y0:y0 + bs, x0:x0 + bs] - LB[y0 + sy:y0 + sy + bs, x0 + sx:x0 + sx + bs]) > 0.04
            validb[y0:y0 + bs, x0:x0 + bs] = True
    fog = member(KA, FOG)
    other = ~fog
    sky = fog & ~dilate(other, 3)
    # the handover edge, above the hero (the bus sits at ~60%: skip the lower 45%)
    band = dilate(fog, 2) & dilate(other, 2)
    band[int(h * 0.55):, :] = False
    trees = member(KA, GREEN)
    top = np.zeros((h, w), bool)
    top[: int(h * 0.15), :] = True
    out = {}
    for name, msk in [('all', valid), ('sky', sky & valid), ('fogband', band & valid), ('trees', trees & valid), ('top15', top & valid)]:
        n = int(msk.sum())
        mb = msk & validb
        out[name] = (round(100.0 * float(res[msk].mean()), 2) if n else None, round(100.0 * float(resb[mb].mean()), 2) if mb.sum() else None,
                     round(100.0 * float(resv[mb].mean()), 2) if mb.sum() else None, n)
    print(pre + ':  region band-shift% / block-matched% / visible% (pixels)')
    print('   ' + '  '.join(f'{k} {v[0]} / {v[1]} / {v[2]} ({v[3]})' for k, v in out.items()))
    return out

if __name__ == '__main__':
    for p in sys.argv[1:]:
        main(p)
