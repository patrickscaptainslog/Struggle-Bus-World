# The before/after against the scan: roofs (the error of the drawn roof over each part's LiDAR returns) and trees (the share of the scan's canopy the
# game's crowns cover, and the share of the game's crowns over no canopy). Usage: python3 score.py <city dir after>   (before: the orig_city copy)
import sys, pickle, numpy as np
from load import *
from roofs import surface, loss, FLAT, NONE
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bake'))
from citydata import City
AFTER = sys.argv[1]
R = rasters()
rows = pickle.load(open(f'{S}/dataset.pkl', 'rb'))
d = pickle.load(open(f'{S}/fits.pkl', 'rb'))
# the after's roofs, read back from the rewritten files
c = City(AFTER)
T = c.manifest['tileSize']
near = {(tx, tz) for tx in range(int(np.floor(BOX[0] / T)), int(np.floor(BOX[2] / T)) + 1) for tz in range(int(np.floor(BOX[1] / T)), int(np.floor(BOX[3] / T)) + 1)}
after = {}
for t in c.building_tiles(near):
    tx, tz = int(np.floor(t['originX'] / T + 1e-6)), int(np.floor(t['originZ'] / T + 1e-6))
    for i in range(t['count']):
        after[(tx, tz, i)] = (int(t['roofShape'][i]), int(t['roofDir'][i]), float(t['roofH'][i]), float(t['roofY'][i]))
def roof_err(shape, dd, Rr, y, xs, zs, z, ring):
    g = surface(shape, ring, dd, xs, zs, Rr) if shape not in (NONE, FLAT) and Rr > 0.3 else 0 * xs
    return loss(z - y - g)
B, A, n, nb, na = 0.0, 0.0, 0, 0, 0
for r in rows:
    p = d['P'][r['id']]
    xs, zs, z = r['cells']
    b = roof_err(int(p['roofShape']), int(p['roofDir']), float(p['roofH']), float(p['roofY']), xs, zs, z, r['ring'])
    sh, dd, Rr, y = after[(p['tile'][0], p['tile'][1], p['i'])]
    a = roof_err(sh, dd, Rr, y, xs, zs, z, r['ring'])
    B += b; A += a; n += 1
    nb += int(p['roofShape']) > FLAT and float(p['roofH']) > 0.3; na += sh > FLAT and Rr > 0.3
print(f'roofs: {n} parts; mapped pitched roofs before {nb}, after {na}; mean roof error (clipped square, m^2) before {B/n:.3f}, after {A/n:.3f}')
print(f'       as a root-mean-square: before {np.sqrt(B/n):.2f} m, after {np.sqrt(A/n):.2f} m')
# trees
veg = np.load(f'{S}/veg.npy') if os.path.exists(f'{S}/veg.npy') else None
def crowns(city):
    out = []
    for t in City(city).terrain_tiles(near):
        for (x, z, y, s, k) in t['trees']:
            if BOX[0] + 6 <= x < BOX[2] - 6 and BOX[1] + 6 <= z < BOX[3] - 6:
                sc = s if k == 0 else 0.78 + 0.5 * (max(0.3, s) - 0.75)
                ext = 4.35 if k == 0 else 9.3 if k == 1 else 3.9
                out.append((x, z, ext * sc))
    return out
def cover(trees):
    M = np.zeros(R['top'].shape, bool)
    jj, ii = np.indices(M.shape)
    for (x, z, r) in trees:
        i, j = int((x - R['x0']) / R['res']), int((z - R['z0']) / R['res']); k = int(r / R['res']) + 1
        j0, j1, i0, i1 = max(0, j - k), min(M.shape[0], j + k + 1), max(0, i - k), min(M.shape[1], i + k + 1)
        sub = (ii[j0:j1, i0:i1] - i) ** 2 + (jj[j0:j1, i0:i1] - j) ** 2 <= (r / R['res']) ** 2
        M[j0:j1, i0:i1] |= sub
    return M
if veg is not None:
    m = np.zeros(veg.shape, bool); pad = int(6 / R['res']); m[pad:-pad, pad:-pad] = True
    v = veg & m
    for name, city in (('before', CITY), ('after', AFTER)):
        tr = crowns(city); C = cover(tr) & m
        print(f'trees {name}: {len(tr)} trees; scan canopy covered {100 * (C & v).sum() / v.sum():.0f} %; crowns over no canopy {100 * (C & ~v).sum() / max(1, C.sum()):.0f} %')
