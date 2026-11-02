#!/usr/bin/env python3
# What pops, from a run of frames a fixed step apart: pops.py <dir> [--top=6] [--block=24]. Frame to frame, the share of pixels that changed, block by block; flags a frame whose worst block moved far more than its neighbours in time did,
# which is something appearing rather than the ground sliding by. Writes pops-<frame>.png: the frame before, the frame, and where it changed.
import sys
from pathlib import Path

import numpy as np
from PIL import Image

args = sys.argv[1:]
opts = {a[2:].split('=')[0]: a.split('=')[1] for a in args if a.startswith('--')}
d = Path([a for a in args if not a.startswith('--')][0])
top = int(opts.get('top', 6))
B = int(opts.get('block', 24))
files = sorted(d.glob('f*.png'))
prev = None
rows = []
ims = {}
for f in files:
    a = np.asarray(Image.open(f).convert('L'), dtype=np.int16)
    # (the HUD corners don't count: they blink by themselves)
    a = a[110:800, 0:393]
    if prev is not None:
        dif = np.abs(a - prev) > 18
        h, w = dif.shape
        blocks = dif[:h // B * B, :w // B * B].reshape(h // B, B, w // B, B).mean(axis=(1, 3))
        rows.append((f.name, float(dif.mean()), float(blocks.max()), np.unravel_index(blocks.argmax(), blocks.shape)))
    prev = a
share = np.array([r[1] for r in rows])
worst = np.array([r[2] for r in rows])
print(f'{len(rows)} steps; share of pixels changed: median {np.median(share):.3f}, p95 {np.percentile(share, 95):.3f}, max {share.max():.3f}')
# a pop: this step's change far over the steps around it
k = 7
base = np.array([np.median(share[max(0, i - k):i + k + 1]) for i in range(len(share))])
score = share - base
order = np.argsort(-score)[:top]
for i in sorted(order):
    print(f'  {rows[i][0]}: changed {share[i]:.3f} against {base[i]:.3f} around it; worst block {worst[i]:.2f} at row {rows[i][3][0]}, col {rows[i][3][1]}')
