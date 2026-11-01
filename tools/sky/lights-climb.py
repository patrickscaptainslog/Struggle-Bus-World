# Reads lights-climb.mjs's frames: lamp pixels per frame, and how many of a frame's stayed lit in the next. python -I lights-climb.py <dir>
import json
import sys

import numpy as np
from PIL import Image

d = sys.argv[1]
log = json.load(open(f'{d}/log.json'))
prev = None
rows = []
for i, l in enumerate(log):
    a = np.asarray(Image.open(f'{d}/f{i:04d}.png').convert('RGB')).astype(int)
    # lamp pixels: warm and bright, against the dark ground
    m = (a[..., 0] > 150) & (a[..., 0] - a[..., 2] > 25)
    n = int(m.sum())
    kept = int((m & prev).sum()) if prev is not None else n
    # within a pixel: a light that moved by one pixel between two frames isn't a pop
    if prev is not None:
        g = prev.copy()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            g |= np.roll(np.roll(prev, dx, 1), dy, 0)
        near = int((m & g).sum())
    else:
        near = n
    rows.append((l['clock'], l['h'], n, kept, near))
    prev = m
print('clock     km   lamps  same px  within 1 px')
last = None
for k, (c, h, n, kept, near) in enumerate(rows):
    jump = '' if last is None or last == 0 else f'{(n / last - 1) * 100:+6.1f}%'
    print(f'{c:6.2f} {h:6d} {n:6d} {kept / max(n, 1) * 100:6.1f}% {near / max(n, 1) * 100:6.1f}%  {jump}')
    last = n
