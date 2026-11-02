#!/usr/bin/env python
# A contact sheet of a run of frames: python -I tools/moon/sheet.py <dir> <out.png> [--w=196] [--cols=6] [--only=substr,substr]
import sys, glob, os
from PIL import Image, ImageDraw

args = sys.argv[1:]
pos = [a for a in args if not a.startswith('--')]
opt = dict(a[2:].split('=', 1) for a in args if a.startswith('--') and '=' in a)
d, out = pos[0], pos[1]
w = int(opt.get('w', 196)); cols = int(opt.get('cols', 6))
only = opt.get('only', '').split(',') if opt.get('only') else None
files = sorted(glob.glob(os.path.join(d, '*.png')))
if only:
    files = [f for f in files if any(o in os.path.basename(f) for o in only)]
ims = [Image.open(f).convert('RGB') for f in files]
h = int(w * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (w + 4), rows * (h + 18)), (30, 30, 34))
dr = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = (i % cols) * (w + 4), (i // cols) * (h + 18)
    sheet.paste(im.resize((w, h), Image.NEAREST), (x, y + 16))
    dr.text((x + 2, y + 2), os.path.basename(f)[:-4], fill=(230, 230, 230))
sheet.save(out)
print(out, sheet.size)
