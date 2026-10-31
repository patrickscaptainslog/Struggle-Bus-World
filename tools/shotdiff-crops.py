#!/usr/bin/env python3
# Where two shots differ: side-by-side crops around the changed pixels.
#   python -I tools/shotdiff-crops.py <dirA> <dirB> <name.png> <out.png> [--pad=30] [--scale=3] [--max=12]
# Clusters the changed pixels (game pixel blocks closer than the pad join), and writes a
# contact sheet: A | B | changed pixels white, one row per cluster, biggest first.
import sys

import numpy as np
from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opts = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
a_dir, b_dir, name, out = args
pad = int(opts.get('pad', 30))
scale = int(opts.get('scale', 3))
limit = int(opts.get('max', 12))
a = np.asarray(Image.open(f'{a_dir}/{name}').convert('RGB'))
b = np.asarray(Image.open(f'{b_dir}/{name}').convert('RGB'))
d = (a != b).any(axis=2)
ys, xs = np.nonzero(d)
print(f'{name}: {len(ys)} px differ')
boxes = []
for x, y in zip(xs.tolist(), ys.tolist()):
    for bx in boxes:
        if bx[0] - pad <= x <= bx[2] + pad and bx[1] - pad <= y <= bx[3] + pad:
            bx[0], bx[1], bx[2], bx[3], bx[4] = min(bx[0], x), min(bx[1], y), max(bx[2], x), max(bx[3], y), bx[4] + 1
            break
    else:
        boxes.append([x, y, x, y, 1])
boxes.sort(key=lambda q: -q[4])
print(len(boxes), 'clusters:', [tuple(q) for q in boxes[:limit]])
rows = []
for bx in boxes[:limit]:
    x0, y0 = max(0, bx[0] - pad), max(0, bx[1] - pad)
    x1, y1 = min(a.shape[1], bx[2] + pad + 1), min(a.shape[0], bx[3] + pad + 1)
    ca, cb = a[y0:y1, x0:x1], b[y0:y1, x0:x1]
    cd = (ca * 0.35).astype(np.uint8)
    cd[d[y0:y1, x0:x1]] = (255, 255, 255)
    gap = np.full((ca.shape[0], 6, 3), 255, np.uint8)
    rows.append(np.concatenate([ca, gap, cb, gap, cd], axis=1))
if rows:
    w = max(r.shape[1] for r in rows)
    rows = [np.concatenate([r, np.zeros((r.shape[0], w - r.shape[1], 3), np.uint8)], axis=1) for r in rows]
    sep = np.full((6, w, 3), 255, np.uint8)
    sheet = np.concatenate([x for r in rows for x in (r, sep)], axis=0)
    img = Image.fromarray(sheet)
    img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    img.save(out)
    print('wrote', out, img.size)
