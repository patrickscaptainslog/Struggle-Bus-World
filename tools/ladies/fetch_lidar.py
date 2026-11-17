# The LiDAR scan for one neighbourhood: USGS 3DEP CA_SanFrancisco_1_B23 (public domain), every EPT node over a box of the game's local frame,
# at full depth, with a download cap. Then a 0.5 m surface (first returns: roofs and tree crowns), the ground (class 2), and the canopy mask.
import sys, os, json, numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bake'))
os.environ.setdefault('SB_LIDAR_CACHE', os.path.join(os.environ.get('SB_LADIES', 'shots/tmp/ladies'), 'lidar'))
import lidar
from pyproj import Transformer
OUT = os.environ.get('SB_LADIES', 'shots/tmp/ladies')
PROJ = '+proj=tmerc +lat_0=37.7749 +lon_0=-122.4194 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'
X0, Z0, X1, Z1 = [float(v) for v in sys.argv[1:5]]
CAP = float(sys.argv[5]) * 1e6
PLAN = '--plan' in sys.argv
to_wm = Transformer.from_crs(PROJ, 'EPSG:3857', always_xy=True)
xs = np.array([X0, X1, X0, X1]); zs = np.array([Z0, Z0, Z1, Z1])
ex, ny = to_wm.transform(xs, -zs)
box = (ex.min() - 3, ny.min() - 3, ex.max() + 3, ny.max() + 3)
ept = lidar.Ept(json.load(open(os.path.join(os.path.dirname(lidar.__file__), 'cities', 'sf.json')))['lidar']['ept'])
hit = lambda r: not (r[2] < box[0] or r[0] > box[2] or r[3] < box[1] or r[1] > box[3])
nodes = ept.walk(hit, 30)
pts = sum(nodes.values())
print(f'box {X1-X0:.0f} x {Z1-Z0:.0f} m: {len(nodes)} nodes, {pts/1e6:.1f} M points, max depth {max(int(k.split("-")[0]) for k in nodes)}')
if PLAN:
    sys.exit(0)
if pts * 3.5 > CAP:
    sys.exit(f'about {pts*3.5/1e6:.0f} MB at 3.5 bytes a point: over the cap of {CAP/1e6:.0f} MB')
ept.fetch(list(nodes))
# local frame rasters
from_wm = Transformer.from_crs('EPSG:3857', PROJ, always_xy=True)
RES = 0.5
W, H = int((X1 - X0) / RES), int((Z1 - Z0) / RES)
top = np.full((H, W), -1e9, np.float32); low = np.full((H, W), 1e9, np.float32); gnd = np.full((H, W), 1e9, np.float32); n1 = np.zeros((H, W), np.int32)
import laspy
for k in nodes:
    las = laspy.read(ept.path(k))
    cls = np.asarray(las.classification); keep = ~np.isin(cls, (7, 18))
    try: keep &= ~np.asarray(las.withheld, dtype=bool)
    except Exception: pass
    x, y, z = np.asarray(las.x)[keep], np.asarray(las.y)[keep], np.asarray(las.z)[keep]
    rn, nr, c = np.asarray(las.return_number)[keep], np.asarray(las.number_of_returns)[keep], cls[keep]
    e, n = from_wm.transform(x, y)
    lx, lz = e, -np.asarray(n)
    i = np.floor((lx - X0) / RES).astype(np.int64); j = np.floor((lz - Z0) / RES).astype(np.int64)
    ok = (i >= 0) & (i < W) & (j >= 0) & (j < H)
    i, j, z, rn, nr, c = i[ok], j[ok], z[ok], rn[ok], nr[ok], c[ok]
    f = rn <= 1
    np.maximum.at(top, (j[f], i[f]), z[f]); np.add.at(n1, (j[f], i[f]), 1)
    l = rn >= nr
    np.minimum.at(low, (j[l], i[l]), z[l])
    g = c == 2
    np.minimum.at(gnd, (j[g], i[g]), z[g])
np.savez_compressed(f'{OUT}/lidar_{int(X0)}_{int(Z0)}_{int(X1)}_{int(Z1)}.npz', top=top, low=low, gnd=gnd, n1=n1, x0=X0, z0=Z0, res=RES)
print('cells with a first return', int((n1 > 0).sum()), 'of', W * H, '; ground cells', int((gnd < 1e8).sum()), '; bytes downloaded', ept.bytes)
