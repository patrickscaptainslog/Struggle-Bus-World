#!/usr/bin/env python3
# The hold-still swap, read: two frames from the same camera, before and after the tiles land (tools/shots.mjs hold-<pose>).
#   python -I tools/far/swapstat.py <before.png> <after.png> [--rows=195-375] [--map=out.png]
# SPIKE.md section 6: the share of far pixels that move by more than one ramp step after a 5 x 3 box (a ramp step is 24 units of luma, lean's
# number), and the largest connected changed area. strategy-art.md's "largest pop": the biggest connected area whose local mean value moves by
# half a step or more; its value jump, the mean change of OKLab lightness over the changed pixels. Far pixels: the rows given, sky left out
# (what is the same pale colour in both frames).
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

STEP = 24.0


def game(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    return a[1::3, 1::3] if a.shape[1] > 500 else a


def luma(a):
    return a @ np.array([0.299, 0.587, 0.114])


def oklab_l(a):
    c = a / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
    lms = np.cbrt(c @ M.T)
    return lms @ np.array([0.2104542553, 0.7936177850, -0.0040720468])


def boxed(a):
    # 5 wide, 3 tall
    return ndimage.uniform_filter(a, size=(3, 5), mode='nearest')


def largest_pop(a, b):
    """Game px of the biggest connected area whose 5 x 3 mean moved by half a ramp step or more."""
    moved = np.abs(boxed(luma(a)) - boxed(luma(b))) >= STEP / 2
    lab, n = ndimage.label(moved)
    return int(np.bincount(lab.ravel())[1:].max()) if n else 0


def stats(a, b, y0, y1):
    A, B = boxed(luma(a)), boxed(luma(b))
    d = np.abs(A - B)[y0:y1]
    same = (a[y0:y1] == b[y0:y1]).all(axis=2)
    sky = same & (luma(a)[y0:y1] > 200)
    far = ~sky
    changed = (a[y0:y1] != b[y0:y1]).any(axis=2)
    moved = np.abs(A - B) >= STEP / 2
    lab, n = ndimage.label(moved)
    sizes = np.bincount(lab.ravel())[1:] if n else np.zeros(1, int)
    jump = np.abs(oklab_l(a) - oklab_l(b))
    return {
        'far_px': int(far.sum()),
        'changed_pct': round(float(changed[far].mean() * 100), 2),
        'over_one_step_pct': round(float((d[far] > STEP).mean() * 100), 2),
        'mean_luma_shift': round(float((B - A)[y0:y1][far].mean()), 2),
        'largest_pop_px': int(sizes.max()),
        'value_jump': round(float(jump[moved].mean()) if moved.any() else 0.0, 4),
    }


if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    opt = dict(x[2:].split('=', 1) for x in sys.argv[1:] if x.startswith('--'))
    y0, y1 = (int(v) for v in opt.get('rows', '195-375').split('-'))
    a, b = game(args[0]), game(args[1])
    s = stats(a, b, y0, y1)
    print(f"{args[1].replace(chr(92), '/').split('/')[-1]}: {s}")
    if 'map' in opt:
        A, B = boxed(luma(a)), boxed(luma(b))
        m = np.abs(A - B)
        out = np.clip(a * 0.35, 0, 255).astype(np.uint8)
        out[m >= STEP / 2] = (255, 200, 0)
        out[m > STEP] = (255, 0, 80)
        Image.fromarray(out).resize((out.shape[1] * 2, out.shape[0] * 2), Image.NEAREST).save(opt['map'])
