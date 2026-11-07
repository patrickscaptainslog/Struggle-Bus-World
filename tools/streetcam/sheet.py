"""The street camera preview's contact sheet: tools/streetcam/shots.mjs's stills in a grid, a row a street, noon and golden hour
through both lenses across, each labelled.
    python -I tools/streetcam/sheet.py <dir with stills.json> [out.png]
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

d = Path(sys.argv[1])
out = Path(sys.argv[2]) if len(sys.argv) > 2 else d / 'sheet.png'
meta = json.loads((d / 'stills.json').read_text())
streets = [s['name'] for s in meta['streets']]
cols = [(h['name'], lens) for h in meta['hours'] for lens in ('chase', 'wide')]
W, H, PAD, HEAD, SIDE = 393, 852, 8, 26, 120
sheet = Image.new('RGB', (SIDE + len(cols) * (W + PAD) + PAD, HEAD + len(streets) * (H + PAD) + PAD), (20, 20, 24))
dr = ImageDraw.Draw(sheet)
for j, (hour, lens) in enumerate(cols):
    dr.text((SIDE + PAD + j * (W + PAD), 8), f'{hour}, {lens} lens', fill=(235, 235, 235))
for i, name in enumerate(streets):
    s = next(x for x in meta['streets'] if x['name'] == name)
    y = HEAD + PAD + i * (H + PAD)
    dr.text((8, y + 8), name, fill=(235, 235, 235))
    dr.text((8, y + 24), f"{s['lat']:.5f}", fill=(170, 170, 170))
    dr.text((8, y + 38), f"{s['lon']:.5f}", fill=(170, 170, 170))
    dr.text((8, y + 52), f"heading {s['heading']:.0f}", fill=(170, 170, 170))
    dr.text((8, y + 66), f"grade {s['grade'] * 100:.0f} %", fill=(170, 170, 170))
    for j, (hour, lens) in enumerate(cols):
        f = d / f'{name}-{hour}-{lens}.png'
        if f.exists():
            sheet.paste(Image.open(f).convert('RGB').resize((W, H)), (SIDE + PAD + j * (W + PAD), y))
sheet.save(out)
# (and a half-size one, light enough for a phone)
sheet.resize((sheet.width // 2, sheet.height // 2), Image.NEAREST).save(out.with_name(out.stem + '-half.png'))
print(out, sheet.size)
