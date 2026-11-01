#!/usr/bin/env python3
# Exact image diff of two tools/shots.mjs --det folders.
#   python -I tools/shotdiff.py <dirA> <dirB> [outDir]
# For every PNG in both: pixels that differ at all (any channel), in device
# pixels and in game pixels (3 x 3 blocks on the 393 x 852 @3x viewport), the
# changed pixels' bounding box, and a <name>-diff.png (A dimmed, changed pixels
# white) in outDir when any differ. Exit 1 if a pair differs. A pair that differs also says its largest visible pop: tools/far/swapstat.py's
# biggest connected area whose local mean moved half a ramp step or more (the camera has to be the same for that to mean anything).
import os
import sys
from importlib.machinery import SourceFileLoader

import numpy as np
from PIL import Image

swap = SourceFileLoader('swapstat', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'far', 'swapstat.py')).load_module()

a_dir, b_dir = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else b_dir
os.makedirs(out, exist_ok=True)
names = sorted(f for f in os.listdir(a_dir) if f.endswith('.png') and not f.endswith('-diff.png') and os.path.exists(os.path.join(b_dir, f)))
bad = 0
for n in names:
    a = np.asarray(Image.open(os.path.join(a_dir, n)).convert('RGB')).astype(np.int16)
    b = np.asarray(Image.open(os.path.join(b_dir, n)).convert('RGB')).astype(np.int16)
    if a.shape != b.shape:
        print(f'{n}: sizes differ {a.shape} {b.shape}')
        bad += 1
        continue
    d = (a != b).any(axis=2)
    c = int(d.sum())
    h, w = d.shape
    g = d[: h // 3 * 3, : w // 3 * 3].reshape(h // 3, 3, w // 3, 3).any(axis=(1, 3))
    gp = int(g.sum())
    if c == 0:
        print(f'{n}: identical ({w} x {h})')
        continue
    bad += 1
    ys, xs = np.nonzero(d)
    print(f'{n}: {c} device px differ ({c / d.size * 100:.4f}%), {gp} game px of {g.size}; box x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()}; largest change {int(np.abs(a - b).max())}; largest pop {swap.largest_pop(swap.game(os.path.join(a_dir, n)), swap.game(os.path.join(b_dir, n)))} game px')
    dim = (a * 0.35).astype(np.uint8)
    dim[d] = (255, 255, 255)
    Image.fromarray(dim).save(os.path.join(out, n.replace('.png', '-diff.png')))
sys.exit(1 if bad else 0)
