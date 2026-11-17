# Shared loading: the LiDAR rasters and the city's parts and trees in the box.
import sys, os, numpy as np, shapely
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bake'))
from citydata import City
from scipy import ndimage
S = os.environ.get('SB_LADIES', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'shots', 'tmp', 'ladies'))
CITY = S + '/orig_city'   # the bake as it was: apply.py writes the worktree's copy

def rasters():
    d = np.load(f'{S}/lidar_-1600_-560_-760_280.npz')
    top, low, gnd = d['top'].astype(np.float64), d['low'].astype(np.float64), d['gnd'].astype(np.float64)
    top[top < -1e8] = np.nan; low[low > 1e8] = np.nan
    g = gnd.copy(); g[g > 1e8] = np.nan
    # fill the ground under buildings: nearest known ground, then smooth
    idx = ndimage.distance_transform_edt(np.isnan(g), return_distances=False, return_indices=True)
    gf = g[tuple(idx)]
    gf = ndimage.median_filter(gf, 9)
    t = top.copy(); ti = ndimage.distance_transform_edt(np.isnan(t), return_distances=False, return_indices=True); t = t[tuple(ti)]
    l = low.copy(); li = ndimage.distance_transform_edt(np.isnan(l), return_distances=False, return_indices=True); l = l[tuple(li)]
    return dict(top=t, low=l, gnd=gf, x0=float(d['x0']), z0=float(d['z0']), res=float(d['res']))

BOX = (-1600, -560, -760, 280)

def parts(box=BOX, pad=0):
    c = City(CITY)
    T = c.manifest['tileSize']
    near = {(tx, tz) for tx in range(int(np.floor(box[0] / T)), int(np.floor(box[2] / T)) + 1) for tz in range(int(np.floor(box[1] / T)), int(np.floor(box[3] / T)) + 1)}
    out = []
    for t in c.building_tiles(near):
        tx, tz = int(np.floor(t['originX'] / T + 1e-6)), int(np.floor(t['originZ'] / T + 1e-6))
        for i in range(t['count']):
            s, e = int(t['vertStart'][i]), int(t['vertStart'][i + 1])
            ring = t['xz'][s:e]
            cx, cz = ring.mean(0)
            if not (box[0] + pad <= cx <= box[2] - pad and box[1] + pad <= cz <= box[3] - pad):
                continue
            out.append(dict(tile=(tx, tz), i=i, ring=ring, **{k: t[k][i] for k in ('index', 'stableId', 'baseY', 'roofY', 'groundY', 'roofH', 'arch', 'floors', 'front', 'front2', 'hood', 'seed', 'tier', 'taper', 'roofShape', 'roofDir', 'facadeMat', 'roofMat', 'source')}))
    return out

def terrain(box=BOX):
    c = City(CITY)
    T = c.manifest['tileSize']
    near = {(tx, tz) for tx in range(int(np.floor(box[0] / T)), int(np.floor(box[2] / T)) + 1) for tz in range(int(np.floor(box[1] / T)), int(np.floor(box[3] / T)) + 1)}
    return list(c.terrain_tiles(near))

def cells_in(ring, R, shrink=0.0):
    """LiDAR cell centres inside the ring (shrunk), as (xs, zs, ii, jj)."""
    p = shapely.Polygon(ring)
    if not p.is_valid: p = shapely.make_valid(p)
    if shrink: p = p.buffer(-shrink)
    if p.is_empty: return None
    x0, z0, res = R['x0'], R['z0'], R['res']
    a, b, c, d = p.bounds
    i0, i1 = max(0, int((a - x0) / res)), min(R['top'].shape[1] - 1, int((c - x0) / res) + 1)
    j0, j1 = max(0, int((b - z0) / res)), min(R['top'].shape[0] - 1, int((d - z0) / res) + 1)
    if i1 < i0 or j1 < j0: return None
    ii, jj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1))
    xs, zs = x0 + (ii + 0.5) * res, z0 + (jj + 0.5) * res
    m = shapely.contains_xy(p, xs, zs)
    return xs[m], zs[m], ii[m], jj[m]
