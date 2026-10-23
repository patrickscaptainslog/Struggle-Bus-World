#!/usr/bin/env python3
# (game_px() / main() reduce a 3x-DPR screenshot to game pixels; usage: shimmer.py a.png b.png [diff.png])
# Shimmer check on two frames 1/30 s apart: reduce to game pixels, find the best integer
# shift per horizontal band (camera translation), report what the shift can't explain.
import os
import sys
import numpy as np
from PIL import Image

def block_size(dx):
    # device px per game px: the block size whose boundaries carry the neighbor differences (the smallest
    # of the best, so a multiple of it doesn't win). The 390 px frame on a 393x852 @3x viewport is 3; the
    # old 240 px frame was 5. SB_PX_SCALE=<n> overrides.
    env = os.environ.get('SB_PX_SCALE')
    if env:
        return int(env)
    tot = dx.sum() + 1e-9
    score = {S: max(dx[k::S].sum() for k in range(S)) * S / tot for S in range(2, 9)}
    best = max(score.values())
    if best < 1.5:
        return 3
    return min(S for S, v in score.items() if v >= 0.85 * best)

def game_px(path, S=None):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.int32)
    # find the pixel-grid phase: block boundaries have the largest neighbor differences
    dx = np.abs(np.diff(a, axis=1)).sum(axis=(0, 2))
    dy = np.abs(np.diff(a, axis=0)).sum(axis=(1, 2))
    if S is None:
        S = block_size(dx)
    ox = int(np.argmax([dx[k::S].sum() for k in range(S)]))
    oy = int(np.argmax([dy[k::S].sum() for k in range(S)]))
    # boundary between col ox and ox+1 -> block starts at ox+1; sample block centers
    cx = (ox + 1 + S // 2) % S
    cy = (oy + 1 + S // 2) % S
    g = a[cy::S, cx::S]
    return g

def main(pa, pb, out=None, bands=8):
    A = game_px(pa)
    B = game_px(pb)
    h = min(A.shape[0], B.shape[0]); w = min(A.shape[1], B.shape[1])
    A = A[:h, :w]; B = B[:h, :w]
    key = lambda X: (X[..., 0] << 16) | (X[..., 1] << 8) | X[..., 2]
    KA, KB = key(A), key(B)
    raw = (KA != KB).mean()
    res = np.zeros((h, w), bool)
    rep = []
    bh = h // bands
    m = 4
    for i in range(bands):
        y0, y1 = i * bh, (i + 1) * bh if i < bands - 1 else h
        best = None
        for sy in range(-m, m + 1):
            for sx in range(-m, m + 1):
                ya0, ya1 = max(y0, m), min(y1, h - m)
                a = KA[ya0:ya1, m:w - m]
                b = KB[ya0 + sy:ya1 + sy, m + sx:w - m + sx]
                c = (a != b).mean()
                if best is None or c < best[0]:
                    best = (c, sx, sy)
        c, sx, sy = best
        ya0, ya1 = max(y0, m), min(y1, h - m)
        res[ya0:ya1, m:w - m] = KA[ya0:ya1, m:w - m] != KB[ya0 + sy:ya1 + sy, m + sx:w - m + sx]
        rep.append((y0, y1, sx, sy, round(float(c) * 100, 2)))
    print(f'{pa}: game px {w}x{h}  raw changed {raw*100:.1f}%  residual after per-band shift {res.mean()*100:.2f}%')
    for r in rep:
        print('   band y %3d-%3d shift (%2d,%2d) residual %5.2f%%' % r)
    if out:
        vis = (A * 0.35).astype(np.uint8)
        vis[res] = [255, 0, 255]
        Image.fromarray(vis).resize((w * 3, h * 3), Image.NEAREST).save(out)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
