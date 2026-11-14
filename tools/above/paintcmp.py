#!/usr/bin/env python3
# Release A, 1a: two tags' frames of tools/above/paintview.mjs compared, pose by pose, in game pixels (the 3 x 3 blocks of the 393 x 852 @3x viewport).
#   python -I tools/above/paintcmp.py <dir> <place> <tag a> <tag b> [--tol=paint|moon] [--look=<dir>]
# For each pose both frames have: the game pixels that differ (any channel), the largest 8-connected cluster of them, how many lie outside the painted area's box
# (every saturated pixel of either frame: paint is the only saturated thing, the bus aside, which is in both) grown by a game pixel, and each ramp's count of
# saturated pixels (by hue, twelve bins of 30 degrees) on both sides. --tol=paint (the default) passes a pose with at most 0.05 % of its pixels differing,
# no cluster over 4, none outside the box (--cluster=, --outside= set those two), each ramp within 1 % (or 4 pixels); --tol=moon only the ramps, within 2 % (a formerly split tile's map is its
# region's: ABOVE.md 1a). --look=<dir>: <place>-<pose>.png, the two frames side by side at twice the game pixels (a left, b right), and
# <place>-<pose>-diff.png, a dimmed with the differing pixels white. --floor=<tag c>: a pixel where b differs from c (b's page shot twice: the noise floor)
# isn't counted; --floora=<tag c2> the same for a against its own repeat c2. With --tol=paint a pose fails if its floor leaves out more than 0.05 % of the
# frame (noise that big would hide what the change does under it). --nobus: nor one inside the bus's box on either frame grown by 8 game pixels (paintview's json has it: the bus and its
# exhaust's particles, which take Math.random after three's own draws for every object made, and the two pages make different objects). Each pose prints
# what these left out. Exit 1 if a pose fails or either side lacks a frame.
import json
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

pos = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = dict((a[2:].split('=') + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
d, place, ta, tb = pos
tol = opt.get('tol', 'paint')
# (the largest cluster and the pixels outside the box a pose may have: --cluster=, --outside=; the same page shot twice is the noise floor to set them by)
most_cluster, most_outside = int(opt.get('cluster', 4)), int(opt.get('outside', 0))
look = opt.get('look')
floor, floora = opt.get('floor'), opt.get('floora')
buses = {}
if 'nobus' in opt:
    J = json.load(open(os.path.join(d, f'paintview-{place}.json')))
    for t in (ta, tb):
        for p, st in J['tags'][t]['poses'].items():
            if st.get('bus'):
                buses.setdefault(p, []).append(st['bus'])
if look:
    os.makedirs(look, exist_ok=True)
poses = sorted({f[len(place) + 1:].rsplit('-', 1)[0] for f in os.listdir(d) if f.startswith(place + '-') and f.endswith('.png')}, key=lambda p: (p.count('@'), -1 if p.startswith('roofs') else float(p.split('@')[0])))


def game(path):
    a = np.asarray(Image.open(path).convert('RGB'))
    return a[1::3, 1::3].astype(np.int32)


def sat(a):
    mx, mn = a.max(axis=2), a.min(axis=2)
    s = (mx - mn) / np.maximum(mx, 1)
    return (s > 0.35) & (mx > 40)


def hue(a):
    r, g, b = a[..., 0] / 255.0, a[..., 1] / 255.0, a[..., 2] / 255.0
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    c = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / c) % 6, np.where(mx == g, (b - r) / c + 2, (r - g) / c + 4))
    return (h * 60).astype(np.int32) // 30 % 12


bad = 0
for p in poses:
    fa, fb = os.path.join(d, f'{place}-{p}-{ta}.png'), os.path.join(d, f'{place}-{p}-{tb}.png')
    if not (os.path.exists(fa) and os.path.exists(fb)):
        print(f'FAIL  {place} {p}: MISSING {fa if not os.path.exists(fa) else fb}')
        bad += 1
        continue
    a, b = game(fa), game(fb)
    diff = (a != b).any(axis=2)
    left = []
    hc = None
    dropped = 0
    if floor or floora:
        nf = np.zeros_like(diff)
        for t, side in ((floor, b), (floora, a)):
            if not t:
                continue
            fc = os.path.join(d, f'{place}-{p}-{t}.png')
            if not os.path.exists(fc):
                left.append(f'no {t} frame for the noise floor')
                continue
            c = game(fc)
            if t == floor:
                hc = np.bincount(hue(c)[sat(c)], minlength=12)
            nf |= (side != c).any(axis=2)
        dropped = int((diff & nf).sum())
        left.append(f'{dropped} in the noise floor')
        diff &= ~nf
    for bx in buses.get(p, []):
        m = np.zeros_like(diff)
        m[max(0, int(bx['y0']) - 8):int(bx['y1']) + 9, max(0, int(bx['x0']) - 8):int(bx['x1']) + 9] = True
        left.append(f'{int((diff & m).sum())} on the bus')
        diff &= ~m
    n = int(diff.sum())
    lab, k = ndimage.label(diff, structure=np.ones((3, 3)))
    big = int(np.bincount(lab.ravel())[1:].max()) if k else 0
    sa, sb = sat(a), sat(b)
    both = sa | sb
    outside = 0
    if both.any():
        ys, xs = np.nonzero(both)
        box = np.zeros_like(diff)
        box[max(0, ys.min() - 1):ys.max() + 2, max(0, xs.min() - 1):xs.max() + 2] = True
        outside = int((diff & ~box).sum())
    else:
        outside = n
    ha, hb = np.bincount(hue(a)[sa], minlength=12), np.bincount(hue(b)[sb], minlength=12)
    rt = 0.02 if tol == 'moon' else 0.01
    ramps = [(int(x), int(y)) for x, y in zip(ha, hb) if x or y]
    # (with a noise floor, a ramp may differ as much as b's differs from the floor's, and 4 more)
    fl = [int(abs(y - z)) for y, z in zip(hb, hc) if True] if hc is not None else [0] * 12
    fl = [f for f, x, y in zip(fl, ha, hb) if x or y]
    ramp_ok = all(abs(x - y) <= max(rt * max(x, y), 4, f + 4) for (x, y), f in zip(ramps, fl))
    worst = max((abs(x - y) / max(x, y, 1) for x, y in ramps), default=0)
    share = n / diff.size
    floor_ok = dropped <= 0.0005 * diff.size
    ok = ramp_ok if tol == 'moon' else ramp_ok and share <= 0.0005 and big <= most_cluster and outside <= most_outside and floor_ok
    bad += not ok
    print(f"{'pass' if ok else 'FAIL'}  {place} {p:>6}: {n} game px differ ({100 * share:.3f} %), largest cluster {big}, {outside} outside the paint's box | saturated {int(sa.sum())} / {int(sb.sum())}, ramps {len(ramps)}, worst ramp {100 * worst:.2f} % | {ta} vs {tb}" + (f" (left out: {', '.join(left)})" if left else '') + ('' if floor_ok or tol == 'moon' else ' | the noise floor is over 0.05 % of the frame'))
    if look:
        A, B = (np.asarray(Image.open(f).convert('RGB'))[1::3, 1::3] for f in (fa, fb))
        two = np.concatenate([A, np.full((A.shape[0], 4, 3), 255, np.uint8), B], axis=1)
        Image.fromarray(two).resize((two.shape[1] * 2, two.shape[0] * 2), Image.NEAREST).save(os.path.join(look, f'{place}-{p}.png'))
        if n:
            dm = (A * 0.35).astype(np.uint8)
            dm[diff] = 255
            Image.fromarray(dm).save(os.path.join(look, f'{place}-{p}-diff.png'))
print(f'paintcmp {place}: {len(poses) - bad} of {len(poses)} poses pass' + (f', {bad} FAIL' if bad else ''))
sys.exit(1 if bad or not poses else 0)
