# Top-down hillshades of a square of the box: the game's city today, the city after (both as their region files hold them: roofs and trees), and the
# LiDAR (the answer key). Usage: python3 render.py <city dir after> X0 Z0 X1 Z1 <out.png>
import sys, numpy as np
from PIL import Image, ImageDraw
from load import *
from roofs import *
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bake'))
from citydata import City
AFTER = sys.argv[1]
X0, Z0, X1, Z1 = [float(v) for v in sys.argv[2:6]]
out = sys.argv[6]
R = rasters()
res = R['res']
i0, i1 = int((X0 - R['x0']) / res), int((X1 - R['x0']) / res); j0, j1 = int((Z0 - R['z0']) / res), int((Z1 - R['z0']) / res)
truth = R['top'][j0:j1, i0:i1]; g = R['gnd'][j0:j1, i0:i1]
TS = 256.0
near = {(tx, tz) for tx in range(int(np.floor(X0 / TS)) - 1, int(np.floor(X1 / TS)) + 2) for tz in range(int(np.floor(Z0 / TS)) - 1, int(np.floor(Z1 / TS)) + 2)}
# (props/trees.ts: a crown's top and reach at size 1, by kind)
TOP = {0: 9.0 * 1.06, 1: 21.3 * 1.06, 2: 18.3 * 1.06}
EXT = {0: 4.35, 1: 9.3, 2: 3.9}

def model(city):
    H = g.copy()
    c = City(city)
    parts = []
    for t in c.building_tiles(near):
        for i in range(t['count']):
            s, e = int(t['vertStart'][i]), int(t['vertStart'][i + 1])
            parts.append((t['roofY'][i] + t['roofH'][i], t['xz'][s:e], int(t['roofShape'][i]), int(t['roofDir'][i]), float(t['roofH'][i]), float(t['roofY'][i])))
    for top, ring, sh, dd, Rr, y in sorted(parts, key=lambda p: p[0]):
        cc = cells_in(ring, R, 0.0)
        if cc is None: continue
        xs, zs, ii, jj = cc
        m = (ii >= i0) & (ii < i1) & (jj >= j0) & (jj < j1)
        if not m.any(): continue
        xs, zs, ii, jj = xs[m], zs[m], ii[m], jj[m]
        h = y + (surface(sh, ring, dd, xs, zs, Rr) if sh > FLAT and Rr > 0.3 else 0)
        H[jj - j0, ii - i0] = np.maximum(H[jj - j0, ii - i0], h)
    jj, ii = np.indices(H.shape)
    for t in c.terrain_tiles(near):
        for (x, z, y, s, k) in t['trees']:
            sc = s if k == 0 else 0.78 + 0.5 * (max(0.3, s) - 0.75)
            r, top = EXT[k] * sc, TOP[k] * sc
            ci, cj = (x - X0) / res, (z - Z0) / res
            if ci < -r / res or cj < -r / res or ci > H.shape[1] + r / res or cj > H.shape[0] + r / res: continue
            d2 = ((ii - ci) ** 2 + (jj - cj) ** 2) * res * res
            m = d2 < r * r
            if not m.any(): continue
            dome = y + top * (0.55 + 0.45 * np.sqrt(np.clip(1 - d2[m] / (r * r), 0, 1)))
            H[m] = np.maximum(H[m], dome)
    return H

def shade(H):
    gy, gx = np.gradient(H, res)
    az, alt = np.radians(315), np.radians(40)
    sl = np.arctan(np.hypot(gx, gy)); asp = np.arctan2(-gx, gy)
    return np.clip(np.sin(alt) * np.cos(sl) + np.cos(alt) * np.sin(sl) * np.cos(az - asp), 0, 1)

ims = []
for t, H in (('the game today', model(CITY)), ('after', model(AFTER)), ('the LiDAR scan', truth)):
    ims.append((t, Image.fromarray((shade(H) * 255).astype(np.uint8)).convert('RGB')))
W, Hh = ims[0][1].size
can = Image.new('RGB', (W * 3 + 8, Hh), (255, 255, 255))
for k, (t, im) in enumerate(ims): can.paste(im, (k * (W + 4), 0))
can = can.resize((can.width * 2, can.height * 2), Image.NEAREST)
dr = ImageDraw.Draw(can)
if os.environ.get('LABELS', '1') == '1':
    for k, (t, im) in enumerate(ims): dr.text((k * (W + 4) * 2 + 10, 8), t, fill=(200, 20, 20))
can.save(out); print('wrote', out, can.size)
