#!/usr/bin/env python3
# Which game pixels of a frame are the city: neither sea nor sky. At some poses half of a far band of rows is sky and water, which can't crawl or swap, so a figure
# over the whole band reads low. Water is told by the palette, not by how blue a colour is: b - r > 22 keeps the sea's sparkle step (#a3adb7), which flips all the
# time, as city, and throws away GREY's #404b57, a wall. Sky is what is brighter than any far surface gets (luma over 190).
import os
import re

import numpy as np

_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
_text = open(os.path.join(_ROOT, 'src', 'render', 'palette.ts'), encoding='utf8').read()
_ramps = dict(re.findall(r"\[Ramp\.(\w+)\]:\s*\[([^\]]+)\]", _text))
WATER = np.array(sorted(int(h, 16) for h in re.findall(r'#([0-9a-fA-F]{6})', _ramps['WATER'])))
LUMA = np.array([0.299, 0.587, 0.114])


def water(a):
    """a: game pixels, h x w x 3. True on the water's ramp."""
    a = a.astype(np.int64)
    return np.isin((a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2], WATER)


def city(a):
    """True where a pixel is neither water nor sky."""
    return ~(water(a) | (a @ LUMA > 190))
