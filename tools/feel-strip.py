"""Compose feel.mjs frames.
  python3 -I tools/feel-strip.py <dir> <frame.png> ...         -> <dir>/strip.png (center crops side by side)
  python3 -I tools/feel-strip.py <dir> --diff <a.png> <b.png> [c.png] -> <dir>/glint.png (+ changed-pixel count)
"""
import json
import sys

from PIL import Image, ImageChops, ImageDraw

d = sys.argv[1]
args = sys.argv[2:]


def crop(im):
    w, h = im.size
    # the bus and the roofs ahead of it: the middle of the portrait frame
    return im.crop((int(w * 0.06), int(h * 0.2), int(w * 0.94), int(h * 0.72)))


if args and args[0] == '--diff':
    names = args[1:]
    ims = [Image.open(f'{d}/{n}').convert('RGB') for n in names]
    diff = ImageChops.difference(ims[0], ims[1]).convert('L').point(lambda v: 255 if v > 8 else 0)
    bbox = diff.getbbox()
    changed = sum(1 for v in diff.getdata() if v)
    # one device pixel = 1/3 CSS px; a game pixel is ~4.9 device px across
    print(json.dumps({'changedDevicePx': changed, 'changedGamePxApprox': round(changed / 24), 'bbox': bbox}))
    if bbox:
        x0, y0, x1, y1 = bbox
        pad = 60
        box = (max(0, x0 - pad), max(0, y0 - pad), min(ims[0].size[0], x1 + pad), min(ims[0].size[1], y1 + pad))
        tiles = [im.crop(box) for im in ims] + [diff.convert('RGB').crop(box)]
        tw, th = tiles[0].size
        sheet = Image.new('RGB', (tw * len(tiles) + 8 * (len(tiles) - 1), th), (20, 20, 24))
        for i, t in enumerate(tiles):
            sheet.paste(t, (i * (tw + 8), 0))
        sheet.save(f'{d}/glint.png')
    sys.exit(0)

tiles = [crop(Image.open(f'{d}/{n}').convert('RGB')) for n in args]
scale = 0.42
tiles = [t.resize((int(t.size[0] * scale), int(t.size[1] * scale)), Image.NEAREST) for t in tiles]
tw, th = tiles[0].size
cols = 4
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw + (cols - 1) * 6, rows * (th + 22) - 4), (20, 20, 24))
dr = ImageDraw.Draw(sheet)
for i, (t, n) in enumerate(zip(tiles, args)):
    x, y = (i % cols) * (tw + 6), (i // cols) * (th + 22)
    sheet.paste(t, (x, y + 18))
    dr.text((x + 4, y + 3), n.replace('strip-', '').replace('.png', ''), fill=(230, 230, 230))
sheet.save(f'{d}/strip.png')
print('strip', f'{d}/strip.png', sheet.size)
