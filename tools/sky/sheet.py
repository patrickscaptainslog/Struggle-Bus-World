#!/usr/bin/env python3
# A contact sheet of frames: sheet.py <out.png> [--cols=4] [--w=300] [--crop=x0,y0,x1,y1] [--zoom=3] <frame.png> ...
# Nearest neighbour only, so a game pixel stays a pixel.
import sys

from PIL import Image, ImageDraw

args = sys.argv[1:]
opts = {a[2:].split('=')[0]: a.split('=')[1] for a in args if a.startswith('--')}
files = [a for a in args if not a.startswith('--')]
out, files = files[0], files[1:]
cols = int(opts.get('cols', 4))
width = int(opts.get('w', 0))
zoom = int(opts.get('zoom', 1))
crop = tuple(int(v) for v in opts['crop'].split(',')) if 'crop' in opts else None
tiles = []
for f in files:
    im = Image.open(f).convert('RGB')
    if crop:
        im = im.crop(crop)
    if zoom > 1:
        im = im.resize((im.width * zoom, im.height * zoom), Image.NEAREST)
    if width and im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.NEAREST)
    d = ImageDraw.Draw(im)
    name = f.replace('\\', '/').split('/')[-1].rsplit('.', 1)[0]
    d.rectangle((0, im.height - 13, 7 * len(name) + 6, im.height), fill=(0, 0, 0))
    d.text((3, im.height - 12), name, fill=(255, 255, 255))
    tiles.append(im)
rows = [tiles[i:i + cols] for i in range(0, len(tiles), cols)]
W = max(sum(t.width + 4 for t in r) for r in rows)
H = sum(max(t.height for t in r) + 4 for r in rows)
sheet = Image.new('RGB', (W, H), (40, 40, 40))
y = 0
for r in rows:
    x = 0
    for t in r:
        sheet.paste(t, (x, y))
        x += t.width + 4
    y += max(t.height for t in r) + 4
sheet.save(out)
print(out, sheet.size)
