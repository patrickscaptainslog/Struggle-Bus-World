#!/usr/bin/env python3
# Is every game pixel of a shot on the palette, is any of it brown, how much of a band is bare far land?
#   python -I tools/far/pal.py <shot.png> [shot.png ...]
# Palette: src/render/palette.ts, read as the game ships it. A colour two ramps share counts for both, so the ramp shares are upper bounds.
# Brown (SPIKE.md): a step with OKLCH hue 30-85, L < 0.62, C > 0.025, outside the paint ramps.
# Bare far land: game pixels on GREY_LIGHT in rows 195-330 (SPIKE.md section 5), which was all the far ground's one ramp when that metric
# was written. Roofs are on GREY_LIGHT too, so with ?farmap it counts city as well: `plain` is the honest half, the one-tone runs no city has
# (pixels on GREY_LIGHT whose whole 7 x 3 neighbourhood is the same colour).
import os
import re
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
PAINT = {'RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'VIOLET', 'BUS_YELLOW', 'BRIDGE_ORANGE'}


def oklch(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
    lms = np.cbrt(c @ M.T)
    M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])
    lab = lms @ M2.T
    return lab[..., 0], np.hypot(lab[..., 1], lab[..., 2]), np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360


text = open(os.path.join(ROOT, 'src', 'render', 'palette.ts'), encoding='utf8').read()
ramps = {n: re.findall(r'#([0-9a-fA-F]{6})', b) for n, b in re.findall(r"\[Ramp\.(\w+)\]:\s*\[([^\]]+)\]", text)}
colour = {}
for n, hexes in ramps.items():
    for s, h in enumerate(hexes):
        colour.setdefault(int(h, 16), []).append((n, s))
keys = np.array(sorted(colour))
arr = np.array([[k >> 16, (k >> 8) & 255, k & 255] for k in keys], float)
L, C, H = oklch(arr)
brown_key = {int(k) for k, l, c, h in zip(keys, L, C, H) if 30 <= h <= 85 and l < 0.62 and c > 0.025 and any(n not in PAINT for n, _ in colour[int(k)])}
grey_light = {int(h, 16) for h in ramps['GREY_LIGHT']}

for path in sys.argv[1:]:
    a = np.asarray(Image.open(path).convert('RGB'))[1::3, 1::3].astype(np.int64)
    k = (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]
    on = np.isin(k, keys)
    brown = np.isin(k, np.array(sorted(brown_key))) if brown_key else np.zeros_like(on)
    band = k[195:330]
    gl = np.isin(band, np.array(sorted(grey_light)))
    h, w = k.shape
    same = np.ones_like(band, bool)
    pad = np.pad(band, ((1, 1), (3, 3)), mode='edge')
    for dy in range(-1, 2):
        for dx in range(-3, 4):
            same &= pad[1 + dy:1 + dy + band.shape[0], 3 + dx:3 + dx + band.shape[1]] == band
    print(f"{path.replace(chr(92), '/').split('spike-far/')[-1]}: {on.mean() * 100:.3f}% on palette, {int((~on).sum())} off; brown {int(brown.sum())} px"
          f"{' on ' + ','.join(sorted({'#%06x' % int(v) for v in np.unique(k[brown])})) if brown.any() else ''};"
          f" GREY_LIGHT rows 195-330 {int(gl.sum())} px ({gl.sum() / k.size * 100:.2f}% of the frame), plain {int((gl & same).sum())} px ({(gl & same).sum() / k.size * 100:.2f}%)")
