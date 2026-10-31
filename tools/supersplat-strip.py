"""Frame strips for the super splat QA (tools/supersplat.mjs output).
  python3 -I tools/supersplat-strip.py <dir> <out.png> <frame.png[=label]> ...
Each frame (1179 x 2556) is scaled to 1/3 (one game pixel = one strip pixel), cropped to `--crop=y0,y1` (fractions of
the height, default the whole frame), labelled, and laid side by side; meter clips (small images) are scaled up 3x.
"""
import sys

from PIL import Image, ImageDraw

d, out = sys.argv[1], sys.argv[2]
crop = (0.0, 1.0)
items = []
for a in sys.argv[3:]:
    if a.startswith('--crop='):
        y0, y1 = a[7:].split(',')
        crop = (float(y0), float(y1))
        continue
    name, _, label = a.partition('=')
    items.append((name, label or name.rsplit('.', 1)[0]))

tiles = []
for name, label in items:
    im = Image.open(f'{d}/{name}').convert('RGB')
    w, h = im.size
    if h > 1000:
        im = im.crop((0, int(h * crop[0]), w, int(h * crop[1])))
        im = im.resize((im.size[0] // 3, im.size[1] // 3), Image.NEAREST)
    else:
        im = im.resize((im.size[0] * 3 // 3, im.size[1] * 3 // 3), Image.NEAREST)
    tiles.append((im, label))

pad, top = 6, 18
W = sum(t.size[0] for t, _ in tiles) + pad * (len(tiles) + 1)
H = max(t.size[1] for t, _ in tiles) + top + pad
sheet = Image.new('RGB', (W, H), (15, 19, 26))
draw = ImageDraw.Draw(sheet)
x = pad
for t, label in tiles:
    sheet.paste(t, (x, top))
    draw.text((x + 2, 3), label, fill=(255, 251, 232))
    x += t.size[0] + pad
sheet.save(out)
print(out, sheet.size)
