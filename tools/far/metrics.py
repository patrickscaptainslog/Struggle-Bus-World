#!/usr/bin/env python3
# Is the far band a place or a blob? strategy-art.md's numbers on a real game frame, per band of land pixels:
#   python -I tools/far/metrics.py <shot.png> [bands, default 212-265,265-318,375-648]
# top4: the share of land pixels on the band's four commonest colours. pepper: the share of land pixels that differ from all four neighbours
# (sub-pixel noise: it crawls in motion). blob: the share of land pixels whose 9 x 9 window holds two colours or fewer. colours: how many.
# Land: not sky and not water, by palette (WATER, FOG and SKY_WARM's colours, read from src/render/palette.ts).
import os
import re
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
text = open(os.path.join(ROOT, 'src', 'render', 'palette.ts'), encoding='utf8').read()
ramps = {n: re.findall(r'#([0-9a-fA-F]{6})', b) for n, b in re.findall(r"\[Ramp\.(\w+)\]:\s*\[([^\]]+)\]", text)}
OFF = np.array(sorted({int(h, 16) for n in ('WATER', 'FOG', 'SKY_WARM') for h in ramps.get(n, [])}))


def game_key(path):
    a = np.asarray(Image.open(path).convert('RGB'))
    if a.shape[1] > 500:
        a = a[1::3, 1::3]
    a = a.astype(np.int64)
    return (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]


def band(k, y0, y1):
    land = ~np.isin(k, OFF)
    sel = land[y0:y1]
    if not sel.any():
        return None
    b = k[y0:y1]
    vals, counts = np.unique(b[sel], return_counts=True)
    top4 = np.sort(counts)[::-1][:4].sum() / counts.sum()
    # four neighbours
    p = np.pad(k, 1, mode='edge')
    diff = (p[1:-1, 1:-1] != p[:-2, 1:-1]) & (p[1:-1, 1:-1] != p[2:, 1:-1]) & (p[1:-1, 1:-1] != p[1:-1, :-2]) & (p[1:-1, 1:-1] != p[1:-1, 2:])
    pepper = diff[y0:y1][sel].mean()
    # 9 x 9 windows holding two colours or fewer
    h, w = k.shape
    idx = np.searchsorted(vals, b.clip(vals.min(), vals.max()))
    blob = np.zeros_like(sel)
    ys, xs = np.nonzero(sel)
    pick = np.linspace(0, len(ys) - 1, min(len(ys), 6000)).astype(int)  # (a sample: every window is slow in python)
    hits = 0
    for q in pick:
        y, x = ys[q] + y0, xs[q]
        win = k[max(0, y - 4):y + 5, max(0, x - 4):x + 5]
        if len(np.unique(win)) <= 2:
            hits += 1
    return {'land_px': int(sel.sum()), 'top4_pct': round(float(top4 * 100), 1), 'pepper_pct': round(float(pepper * 100), 2), 'blob_pct': round(float(hits / len(pick) * 100), 2), 'colours': len(vals)}


def report(path, bands=((212, 265), (265, 318), (375, 648))):
    k = game_key(path)
    return {f'{y0}-{y1}': band(k, y0, y1) for y0, y1 in bands}


if __name__ == '__main__':
    bands = [tuple(int(v) for v in b.split('-')) for b in (sys.argv[2] if len(sys.argv) > 2 else '212-265,265-318,375-648').split(',')]
    r = report(sys.argv[1], bands)
    print(sys.argv[1].replace(chr(92), '/').split('spike-far/')[-1])
    for k, v in r.items():
        print('  ', k, v)
