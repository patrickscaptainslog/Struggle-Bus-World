# The answer key for the roof rules: per part, what a rule may read (no LiDAR) and the LiDAR cells it is graded on.
import pickle, numpy as np, shapely
from load import *
from fit import owner_map
R = rasters(); P = parts()
own = owner_map(P, R)
d = pickle.load(open(f'{S}/fits.pkl', 'rb'))
rows = []
for k, (p, f) in enumerate(zip(P, d['fits'])):
    c = cells_in(p['ring'], R, 0.6)
    if c is None or f is None: continue
    xs, zs, ii, jj = c
    keep = (own[jj, ii] == k) & ((R['top'][jj, ii] - R['low'][jj, ii]) <= 1.5)
    if keep.sum() < 10: continue
    poly = shapely.Polygon(p['ring'])
    rows.append(dict(
        id=k, ring=p['ring'].astype(np.float64), front=int(p['front']), front2=int(p['front2']), arch=int(p['arch']), floors=int(p['floors']),
        baseY=float(p['baseY']), groundY=float(p['groundY']), roofY=float(p['roofY']), tier=int(p['tier']), seed=int(p['seed']),
        stableId=int(p['stableId']), building=int(p['index']), area=float(poly.area),
        mapped=dict(shape=int(p['roofShape']), dir=int(p['roofDir']), R=float(p['roofH'])),
        cells=(xs[keep], zs[keep], R['top'][jj[keep], ii[keep]]),
        oracle=dict(shape=f['shape'], dir=f['dir'], R=f['R'], e=f['e'], loss=f['loss'], flat=f['flat'])))
# neighbours: the parts touching each part (a rule may read its row)
polys = [shapely.Polygon(r['ring']).buffer(0.3) for r in rows]
tree = shapely.STRtree(polys)
for i, r in enumerate(rows):
    r['neighbours'] = [int(j) for j in tree.query(polys[i]) if j != i and polys[i].intersects(polys[j])]
pickle.dump(rows, open(f'{S}/dataset.pkl', 'wb'))
print('rows', len(rows))
