# Write the fitted roofs and the LiDAR trees into the city's region files (in place of the baked ones, in the box).
import sys, gzip, struct, pickle, os, numpy as np
from load import *
from roofs import *
DST = sys.argv[1]
FLAT_OK = 0.12     # a roof the LiDAR calls flat this well (mean clipped square residual, m^2) is drawn flat; a worse flat
                   # fit (twin gables, an M roof: nothing the game draws) keeps the procedural Victorian front gable
d = pickle.load(open(f'{S}/fits.pkl', 'rb')); P, fits = d['P'], d['fits']
T = pickle.load(open(f'{S}/trees.pkl', 'rb'))['T']
# --rule <file>: the roofs a learned rule gives instead (no LiDAR read: what any city would get), the baked trees kept
RULE = sys.argv[sys.argv.index('--rule') + 1] if '--rule' in sys.argv else None
if RULE:
    import importlib.util, shapely
    spec = importlib.util.spec_from_file_location('rule', RULE); rule = importlib.util.module_from_spec(spec); spec.loader.exec_module(rule)
    rows = pickle.load(open(f'{S}/dataset.pkl', 'rb'))
    by = {r['id']: k for k, r in enumerate(rows)}
    parts_ = [{k: v for k, v in r.items() if k not in ('cells', 'oracle')} for r in rows]
    def geo_mean(shape, ring, dd, Rr):
        a, b = ring.min(0), ring.max(0)
        xs, zs = np.meshgrid(np.linspace(a[0], b[0], 24), np.linspace(a[1], b[1], 24))
        m = shapely.contains_xy(shapely.Polygon(ring), xs, zs)
        return float(surface(shape, ring, dd, xs[m], zs[m], Rr).mean()) if m.sum() >= 3 else 0.5 * Rr
    fits = [None] * len(P)
    for k in range(len(P)):
        if k not in by: continue
        sh, dd, Rr = rule.predict(parts_[by[k]], parts_)
        sh, dd, Rr = int(sh), int(dd) % 256, float(max(0.0, Rr))
        if sh in (NONE, FLAT) or Rr < 0.3:
            fits[k] = None   # (a rule's flat leaves the bake's roof as it was: procedural gables and all)
        else:
            fits[k] = dict(shape=sh, dir=dd, e=float(P[k]['roofY'] - geo_mean(sh, P[k]['ring'], dd, Rr)), R=Rr, loss=0.0)
    T = None
TS = 256.0
edits = {}
for p, f in zip(P, fits):
    if f is None: continue
    if f['shape'] == FLAT:
        if f['loss'] > FLAT_OK or p['roofShape'] != NONE: continue
        e = dict(shape=FLAT, dir=p['roofDir'], roofY=p['roofY'], R=0.0)
    else:
        e = dict(shape=f['shape'], dir=f['dir'], roofY=f['e'], R=f['R'])
    edits.setdefault(p['tile'], []).append((p['i'], e, p))

def kind_size(t):
    """The game's tree for a crown: its kind, and its size from the crown's height and its width together (the game's crowns are wider
    for their height than the scan's: sized by height alone they shut the streets; by width alone they're bushes)."""
    h, r = t['h'], t['r']
    if h > 11.0 and r < 0.2 * h:
        k, top, ext = 2, 18.3 * 1.06, 3.9          # cypress: a dark flame
    elif h > 13.0:
        k, top, ext = 1, 21.3 * 1.06, 9.3          # eucalyptus or Monterey pine
    else:
        k, top, ext = 0, 9.0 * 1.06, 4.35          # a street or garden tree
    sc = np.sqrt((h / top) * (r / ext))            # the model's scale: its top over the scan's, its reach over the crown's
    s = sc if k == 0 else 0.75 + (sc - 0.78) / 0.5
    return k, float(np.clip(s, 0.32, 2.4))

def terrain_y(tt, x, z):
    n, cell = tt['n'], tt['cell']
    fx, fz = (x - tt['originX']) / cell, (z - tt['originZ']) / cell
    i, j = int(np.clip(np.floor(fx), 0, n - 2)), int(np.clip(np.floor(fz), 0, n - 2))
    u, v = fx - i, fz - j
    H = tt['heights']
    return (H[j, i] * (1 - u) + H[j, i + 1] * u) * (1 - v) + (H[j + 1, i] * (1 - u) + H[j + 1, i + 1] * u) * v

MARGIN = 6.0
def in_box(x, z, m=MARGIN):
    return BOX[0] + m <= x < BOX[2] - m and BOX[1] + m <= z < BOX[3] - m

def edit_buildings(buf, tile):
    b = bytearray(buf)
    c = struct.unpack_from('<I', b, 4)[0]
    o_roofY = 24 + 4 * c * 4 + 4
    o_roofH = 24 + 4 * c * 2 + 4 * (c + 1) + 4 * c * 5
    o_shape = o_roofH + 2 * c + 8 * c
    o_dir = o_shape + c
    n = 0
    for i, e, p in edits.get(tile, []):
        struct.pack_into('<f', b, o_roofY + 4 * i, e['roofY'])
        struct.pack_into('<H', b, o_roofH + 2 * i, int(round(min(6553, e['R'] * 10))))
        b[o_shape + i] = int(e['shape']); b[o_dir + i] = int(e['dir']) % 256
        n += 1
    return bytes(b), n

def edit_terrain(buf, tile, new_top):
    tx, tz, n, obstN, cell, ox, oz = struct.unpack_from('<iiHHfff', buf, 4)
    o = 28 + n * n * 2 + n * n; o += (-o) % 4
    o_obst = o
    o += obstN * obstN * 2
    tc = struct.unpack_from('<H', buf, o)[0]
    tail = o + 4 + 8 * tc
    old = []
    for k in range(tc):
        x, z, y, s, kk = struct.unpack_from('<hhhBB', buf, o + 4 + 8 * k)
        old.append((x, z, y, s, kk))
    keep = [t for t in old if T is None or not in_box(ox + t[0] / 10, oz + t[1] / 10)]
    from citydata import parse_terrain
    tt = parse_terrain(buf)
    add = []
    for t in T or []:
        if not (ox <= t['x'] < ox + TS and oz <= t['z'] < oz + TS) or not in_box(t['x'], t['z']): continue
        k, s = kind_size(t)
        y = terrain_y(tt, t['x'], t['z'])
        add.append((int(round((t['x'] - ox) * 10)), int(round((t['z'] - oz) * 10)), int(round(y * 10)), int(round(s * 100)), k))
    trees = keep + add
    head = bytearray(buf[:o])
    # the obstacle grid: a raised ridge raises its 8 m cells (roof + 3 m, as the bake)
    ob = np.frombuffer(bytes(head[o_obst:o_obst + obstN * obstN * 2]), '<i2').reshape(obstN, obstN).copy()
    oc = TS / obstN
    for (x0, z0, x1, z1, top) in new_top:
        i0, i1 = int(np.floor((x0 - ox) / oc)), int(np.floor((x1 - ox) / oc))
        j0, j1 = int(np.floor((z0 - oz) / oc)), int(np.floor((z1 - oz) / oc))
        i0, j0, i1, j1 = max(0, i0), max(0, j0), min(obstN - 1, i1), min(obstN - 1, j1)
        if i1 < i0 or j1 < j0: continue
        ob[j0:j1 + 1, i0:i1 + 1] = np.maximum(ob[j0:j1 + 1, i0:i1 + 1], int(round((top + 3) * 10)))
    head[o_obst:o_obst + obstN * obstN * 2] = ob.astype('<i2').tobytes()
    body = struct.pack('<HH', len(trees), 0) + b''.join(struct.pack('<hhhBB', *t) for t in trees)
    return bytes(head) + body + buf[tail:], len(old), len(keep), len(add)

new_tops = []
for tile, es in edits.items():
    for i, e, p in es:
        top = e['roofY'] + e['R']
        if top > p['roofY'] + p['roofH'] + 0.05:
            a, b = p['ring'].min(0), p['ring'].max(0)
            new_tops.append((a[0], a[1], b[0], b[1], top))

regions = sorted({(int(np.floor(x / 1024)), int(np.floor(z / 1024))) for x in (BOX[0], BOX[2]) for z in (BOX[1], BOX[3])})
tot = dict(parts=0, old=0, kept=0, added=0)
for rx, rz in regions:
    fn = os.path.join(CITY, f'r_{rx}_{rz}.bin')
    raw = open(fn, 'rb').read()
    gz = raw[:2] == b'\x1f\x8b'
    buf = gzip.decompress(raw) if gz else raw
    cnt = struct.unpack_from('<I', buf, 4)[0]
    ents = [struct.unpack_from('<iiIIII', buf, 8 + i * 24) for i in range(cnt)]
    blobs = []
    for tx, tz, bo, bl, to, tl in ents:
        bb = buf[bo:bo + bl] if bl else b''
        tb = buf[to:to + tl] if tl else b''
        if bl:
            bb, n = edit_buildings(bb, (tx, tz)); tot['parts'] += n
        if tl:
            tb, a, k2, ad = edit_terrain(tb, (tx, tz), new_tops)
            tot['old'] += a; tot['kept'] += k2; tot['added'] += ad
        blobs.append((tx, tz, bb, tb))
    out = bytearray(buf[:8]) + bytearray(24 * cnt)
    for k, (tx, tz, bb, tb) in enumerate(blobs):
        while len(out) % 8: out += b'\0'
        bo = len(out); out += bb
        while len(out) % 8: out += b'\0'
        to = len(out); out += tb
        struct.pack_into('<iiIIII', out, 8 + k * 24, tx, tz, bo if bb else 0, len(bb), to if tb else 0, len(tb))
    data = gzip.compress(bytes(out), 9, mtime=0) if gz else bytes(out)
    open(os.path.join(DST, f'r_{rx}_{rz}.bin'), 'wb').write(data)
    print(f'r_{rx}_{rz}.bin', 'gz' if gz else 'raw', len(raw), '->', len(data))
print(tot, 'roof edits by shape', {NAMES[s]: sum(1 for es in edits.values() for _, e, _ in es if e['shape'] == s) for s in range(14) if any(e['shape'] == s for es in edits.values() for _, e, _ in es)})
