#!/usr/bin/env python3
# Is the sea's far edge level? The top row of the sea in each eighth of the frame's width: the first row where over half the slab is on the water's ramp.
#   python -I tools/far/seatop.py <shot.png> [shot.png ...]
# A water plane that ends short of the far fade stops in a hard line, and at a heading not square to its edge the line slopes in stair-steps. Land in a slab reads as a lower row.
import os
import sys
from importlib.machinery import SourceFileLoader

import numpy as np
from PIL import Image

land = SourceFileLoader('land', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'land.py')).load_module()

for path in sys.argv[1:]:
    a = np.asarray(Image.open(path).convert('RGB'))[1::3, 1::3]
    w = land.water(a)
    tops = []
    for k in range(8):
        rows = np.nonzero(w[:, k * a.shape[1] // 8:(k + 1) * a.shape[1] // 8].mean(axis=1) > 0.5)[0]
        tops.append(int(rows[0]) if len(rows) else -1)
    print(path.replace(chr(92), '/').split('/')[-1], tops)
