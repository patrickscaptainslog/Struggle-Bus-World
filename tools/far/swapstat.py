#!/usr/bin/env python3
# The hold-still swap, read: two frames from the same camera, before and after the tiles land (tools/shots.mjs hold-<pose>).
#   python -I tools/far/swapstat.py <before.png> <after.png> [--rows=195-375] [--map=out.png]
# SPIKE.md section 6: the share of far pixels that move by more than one ramp step after a 5 x 3 box (a ramp step is 24 units of luma, lean's
# number), and the largest connected changed area. strategy-art.md's "largest pop": the biggest connected area whose local mean value moves by
# half a step or more; its value jump, the mean change of OKLab lightness over the changed pixels. Far pixels: the rows given, sky left out
# (what is the same pale colour in both frames).
# `swapped`: the contrast across the swap, over the land of the rows that swapped: luma std before and after. Every number above can look fine while the band is flatter
# than the city that replaces it, and the grid snaps dark as the tiles land: the 5 x 3 box averages contrast away, and rows that didn't swap dilute the rest.
import os
import sys
from importlib.machinery import SourceFileLoader

import numpy as np
from PIL import Image
from scipy import ndimage

land = SourceFileLoader('land', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'land.py')).load_module()

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


def swapped(a, b):
    """The land of the rows that swapped (rows 195-520 with over 8 % of their pixels changed): how much moved, luma mean and std before and after."""
    changed = (a != b).any(axis=2)
    ys = np.nonzero(changed[195:520].mean(axis=1) > 0.08)[0] + 195
    if not len(ys):
        return None
    y0, y1 = int(ys.min()), int(ys.max())
    m = np.zeros_like(changed)
    m[y0:y1 + 1] = True
    m &= ~land.water(a)
    d = np.abs(boxed(luma(a)) - boxed(luma(b)))
    la, lb = luma(a)[m], luma(b)[m]
    return {
        'rows': [y0, y1],
        'land_px': int(m.sum()),
        'changed_pct': round(float(changed[m].mean() * 100), 1),
        'half_step_pct': round(float((d[m] >= STEP / 2).mean() * 100), 1),
        'over_one_step_pct': round(float((d[m] > STEP).mean() * 100), 1),
        'mean': [round(float(la.mean()), 1), round(float(lb.mean()), 1)],
        'std': [round(float(la.std()), 1), round(float(lb.std()), 1)],
    }


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
        'swapped': swapped(a, b),
    }


if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    opt = dict(x[2:].split('=', 1) for x in sys.argv[1:] if x.startswith('--'))
    y0, y1 = (int(v) for v in opt.get('rows', '195-375').split('-'))
    a, b = game(args[0]), game(args[1])
    s = stats(a, b, y0, y1)
    c = s.pop('swapped')
    print(f"{args[1].replace(chr(92), '/').split('/')[-1]}: {s}")
    if c:
        print(f"  land of the rows that swapped, {c['rows'][0]}-{c['rows'][1]}: luma std {c['std'][0]} -> {c['std'][1]}, mean {c['mean'][0]} -> {c['mean'][1]}; "
              f"{c['changed_pct']} % changed, {c['half_step_pct']} % by half a step or more, {c['over_one_step_pct']} % by over one, of {c['land_px']} px")
    if 'map' in opt:
        A, B = boxed(luma(a)), boxed(luma(b))
        m = np.abs(A - B)
        out = np.clip(a * 0.35, 0, 255).astype(np.uint8)
        out[m >= STEP / 2] = (255, 200, 0)
        out[m > STEP] = (255, 0, 80)
        Image.fromarray(out).resize((out.shape[1] * 2, out.shape[0] * 2), Image.NEAREST).save(opt['map'])
