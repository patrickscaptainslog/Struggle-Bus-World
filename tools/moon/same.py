#!/usr/bin/env python
# The ray-drawn Moon and the mesh, the same moment, the same pose: python -I tools/moon/same.py <dir>. Reads same-ray.png and same-mesh.png (tools/moon/land.mjs --same): the horizon's row, column by column, against each other, and the tone below it.
import sys, os
import numpy as np
from PIL import Image

d = sys.argv[1]
a = np.asarray(Image.open(os.path.join(d, 'same-ray.png')).convert('L'), dtype=float)
b = np.asarray(Image.open(os.path.join(d, 'same-mesh.png')).convert('L'), dtype=float)
H, W = a.shape

def horizon(im):
    # the first row from the top, in each column, with ground in it for 6 rows running: the sky here is under 40 of 255, and stars are one pixel
    rows = []
    for x in range(100, W, 7):
        c = im[:, x] > 42
        hit = -1
        for y in range(40, H - 8):
            if c[y:y + 6].all():
                hit = y
                break
        rows.append(hit)
    return np.array(rows)

ha, hb = horizon(a), horizon(b)
ok = (ha > 0) & (hb > 0)
off = (hb - ha)[ok]
print(f'horizon: ray row {np.median(ha[ok]):.0f}, mesh row {np.median(hb[ok]):.0f}, mesh less ray: mean {off.mean():.2f}, worst {off.min()} to {off.max()} px, over {ok.sum()} columns')
top = int(np.median(ha[ok])) + 8
ra, rb = a[top:], b[top:]
print(f'ground: ray mean {ra.mean():.1f}, mesh mean {rb.mean():.1f} of 255; by thirds down the frame:', ' / '.join(f'{ra[i * ra.shape[0] // 3:(i + 1) * ra.shape[0] // 3].mean():.1f} vs {rb[i * ra.shape[0] // 3:(i + 1) * ra.shape[0] // 3].mean():.1f}' for i in range(3)))
print(f'pixels that differ by more than 24 of 255: {(np.abs(ra - rb) > 24).mean() * 100:.1f} %')
# how far the picture has moved between the two, by phase correlation, a strip at a time down the frame: what a dissolve would show as a ghost
for k in range(3):
    h0 = top + k * (H - top) // 3
    p = a[h0:h0 + (H - top) // 3, :].copy()
    q = b[h0:h0 + (H - top) // 3, :].copy()
    F = np.fft.fft2(p - p.mean()) * np.conj(np.fft.fft2(q - q.mean()))
    c = np.fft.ifft2(F / (np.abs(F) + 1e-6)).real
    y, x = np.unravel_index(np.argmax(c), c.shape)
    y = y - c.shape[0] if y > c.shape[0] / 2 else y
    x = x - c.shape[1] if x > c.shape[1] / 2 else x
    print(f'strip {k}: mesh is ({x}, {y}) px off the ray-drawn Moon, peak {c.max():.3f}')
