#!/usr/bin/env python3
"""A contact sheet of tools/controls.mjs states/*.png: python tools/hud-sheet.py <states dir> <out.png>"""
import glob
import os
import sys

from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(src, '*.png')))
cell_w, cell_h, cols = 330, 300, 6
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cell_w, rows * cell_h), (24, 28, 34))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB')
    k = min((cell_w - 20) / im.width, (cell_h - 40) / im.height, 1.5)
    im = im.resize((int(im.width * k), int(im.height * k)), Image.NEAREST)
    x, y = (i % cols) * cell_w + 10, (i // cols) * cell_h + 10
    sheet.paste(im, (x, y))
    d.text((x, y + cell_h - 30), os.path.basename(f)[:-4], fill=(255, 255, 255))
sheet.save(out)
print(out, sheet.size, len(files))
