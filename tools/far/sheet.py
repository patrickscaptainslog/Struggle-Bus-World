#!/usr/bin/env python3
# A contact sheet of shots, one game-pixel row band of each, for reading a flight by eye.
#   python -I tools/far/sheet.py <out.png> <y0> <y1> <cols> <shot.png> [shot.png ...]
import sys

import numpy as np
from PIL import Image

out = sys.argv[1]
y0, y1, cols = (int(v) for v in sys.argv[2:5])
cells = []
for p in sys.argv[5:]:
    a = np.asarray(Image.open(p).convert('RGB'))
    if a.shape[1] > 500:
        a = a[1::3, 1::3]
    cells.append(a[y0:y1])
h, w = cells[0].shape[:2]
rows = (len(cells) + cols - 1) // cols
sheet = np.full((rows * (h + 4), cols * (w + 4), 3), 255, np.uint8)
for k, c in enumerate(cells):
    y, x = k // cols * (h + 4), k % cols * (w + 4)
    sheet[y:y + h, x:x + w] = c
Image.fromarray(sheet).save(out)
print(out, sheet.shape[1], sheet.shape[0])
