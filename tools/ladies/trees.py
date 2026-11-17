# Trees from the LiDAR canopy: every crown the scan sees outside the buildings, at its height and width.
import pickle, numpy as np, shapely
from scipy import ndimage
from load import *

def building_mask(P, R, buf=0.8):
    M = np.zeros(R['top'].shape, bool)
    for p in P:
        poly = shapely.Polygon(p['ring']).buffer(buf)
        c = cells_in(np.array(poly.exterior.coords), R, 0.0)
        if c is None: continue
        M[c[3], c[2]] = True
    return M

def detect(R, B, minh=3.0, rough=0.4):
    res = R['res']
    chm = R['top'] - R['gnd']
    veg = (chm > minh) & ~B
    # (a crown, not a wall, a pole or a parked truck: open it by a 1.5 m disc)
    veg = ndimage.binary_opening(veg, structure=np.ones((3, 3), bool), iterations=1)
    sm = ndimage.gaussian_filter(np.where(veg, chm, 0), 1.6)
    # local maxima with a window that grows with height (a tall crown is wide)
    mx5 = ndimage.maximum_filter(sm, size=7)
    mx9 = ndimage.maximum_filter(sm, size=13)
    peak = veg & (sm >= minh) & (((sm >= mx5) & (sm < 10)) | ((sm >= mx9) & (sm >= 10)))
    lab, n = ndimage.label(peak)
    cen = ndimage.center_of_mass(peak, lab, range(1, n + 1))
    markers = np.zeros(chm.shape, np.int32)
    for k, (j, i) in enumerate(cen):
        markers[int(round(j)), int(round(i))] = k + 1
    # every canopy cell to its nearest peak, within its component
    _, idx = ndimage.distance_transform_edt(markers == 0, return_indices=True)
    own = markers[idx[0], idx[1]]
    comp, _ = ndimage.label(veg)
    own[~veg] = 0
    # (a cell whose nearest peak is in another crown component stays unassigned)
    pj, pi = np.nonzero(markers)
    pk = markers[pj, pi]
    comp_of = np.zeros(n + 1, np.int32); comp_of[pk] = comp[pj, pi]
    own[comp_of[own] != comp] = 0
    area = ndimage.sum(np.ones_like(chm), own, range(1, n + 1)) * res * res
    cy = ndimage.mean(np.indices(chm.shape)[0], own, range(1, n + 1))
    cx = ndimage.mean(np.indices(chm.shape)[1], own, range(1, n + 1))
    h = ndimage.maximum(chm, own, range(1, n + 1))
    out = []
    for k in range(n):
        if not area[k] or area[k] < 4.0: continue
        x = R['x0'] + (cx[k] + 0.5) * res; z = R['z0'] + (cy[k] + 0.5) * res
        out.append(dict(x=float(x), z=float(z), h=float(h[k]), r=float(np.sqrt(area[k] / np.pi)), area=float(area[k])))
    return out, veg

if __name__ == '__main__':
    R = rasters(); P = parts()
    B = building_mask(P, R)
    T, veg = detect(R, B)
    print('crowns', len(T), 'canopy %.1f ha of %.1f ha' % (veg.sum() * 0.25 / 1e4, veg.size * 0.25 / 1e4))
    h = np.array([t['h'] for t in T]); r = np.array([t['r'] for t in T])
    print('height p10/50/90', np.percentile(h, [10, 50, 90]).round(1), 'radius p10/50/90', np.percentile(r, [10, 50, 90]).round(1))
    old = [t for tt in terrain() for t in tt['trees'] if BOX[0] <= t[0] < BOX[2] and BOX[1] <= t[1] < BOX[3]]
    chm = R['top'] - R['gnd']
    hits = 0
    for (x, z, y, s, k) in old:
        i, j = int((x - R['x0']) / 0.5), int((z - R['z0']) / 0.5)
        hits += veg[max(0, j - 4):j + 5, max(0, i - 4):i + 5].any()
    print('trees in the game today', len(old), 'of which over LiDAR canopy (2 m)', hits, 'kinds', np.bincount([o[4] for o in old]))
    pickle.dump(dict(T=T), open(f'{S}/trees.pkl', 'wb'))
    np.save(f'{S}/veg.npy', veg); np.save(f'{S}/bmask.npy', B)
