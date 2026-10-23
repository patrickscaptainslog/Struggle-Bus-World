#!/usr/bin/env python3
# Diff the A/B pairs from tools/ab-shots.mjs.
#   python3 -I tools/ab-diff.py <outDir> <view>... [--crop=x0,y0,x1,y1] [--scale=N]
# For each view prints the share of pixels that differ and writes
# <view>-ab.png: A | B | difference (changed pixels white on a dark copy of A),
# optionally cropped (screenshot pixels) and enlarged (nearest neighbor).
import sys
import numpy as np
from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opts = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
out, views = args[0], args[1:]
crop = tuple(int(v) for v in opts['crop'].split(',')) if 'crop' in opts else None
scale = int(opts.get('scale', '1'))
suffix = opts.get('suffix', '')
for v in views:
    a = np.asarray(Image.open(f'{out}/{v}-A.png').convert('RGB')).astype(np.int16)
    b = np.asarray(Image.open(f'{out}/{v}-B.png').convert('RGB')).astype(np.int16)
    d = np.abs(a - b).max(axis=2) > 8
    share = d.mean() * 100
    if crop:
        x0, y0, x1, y1 = crop
        a, b, d = a[y0:y1, x0:x1], b[y0:y1, x0:x1], d[y0:y1, x0:x1]
    cshare = d.mean() * 100
    dim = (a * 0.35).astype(np.uint8)
    dim[d] = (255, 255, 255)
    gap = np.full((a.shape[0], 6, 3), 255, np.uint8)
    row = np.concatenate([a.astype(np.uint8), gap, b.astype(np.uint8), gap, dim], axis=1)
    img = Image.fromarray(row)
    if scale > 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    name = f'{out}/{v}-ab{suffix}.png'
    img.save(name)
    print(f'{v}: {share:.3f}% of pixels differ' + (f', {cshare:.3f}% in the crop' if crop else '') + f' -> {name}')
