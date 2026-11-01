#!/usr/bin/env python3
# Buildings in the ceiling wedge drawn in no form: SPIKE.md section 6, by construction from the raster against the footprint list.
#   python -I tools/far/absent.py <slug> <x> <z> <heading deg> <hfov deg> <stream x> <stream z> [loadR=1900]      (one JSON line)
# Wedge: every building whose centre is inside the lens's horizontal angle, however far (the frame's whole width). Today (A): a building is drawn if its
# region is inside the load radius of the stream centre (the regions' rectangles, as City.request tests them: an estimate, the frame's real list
# moves with streaming) or it is one of far.bin's boxes. With the raster (B): if any roofed cell is under its centre (the height plane, stamped from
# every footprint: it is in the tone), and it has a box if that cell is ROOF (a footprint over half the cell).
import gzip
import json
import math
import os
import struct
import sys
from importlib.machinery import SourceFileLoader

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
fm = SourceFileLoader('farmap', os.path.join(ROOT, 'tools', 'bake', 'farmap.py')).load_module()

slug = sys.argv[1]
cx, cz, heading, hfov, sx, sz = (float(v) for v in sys.argv[2:8])
load_r = float(sys.argv[8]) if len(sys.argv) > 8 else 1900.0
src = os.path.join(ROOT, 'public', 'city', slug)
man = json.load(open(os.path.join(src, 'city.json'), encoding='utf8'))
class_n, ts = man['classN'], man['tileSize']
R = ts * man.get('regionSize', 4)

xs, zs, idx = [], [], []
for data, tx, tz, b_off, b_len, t_off, t_len in fm.regions(src):
    if not b_len:
        continue
    b = fm.parse_buildings(memoryview(data)[b_off:b_off + b_len])
    s = b['vstart']
    n = len(s) - 1
    # (a building's ground tier: the first record of its index in the tile)
    first = np.ones(n, bool)
    first[1:] = b['index'][1:] != b['index'][:-1]
    for r in np.nonzero(first)[0].tolist():
        xs.append(float(b['x'][s[r]:s[r + 1]].mean()))
        zs.append(float(b['z'][s[r]:s[r + 1]].mean()))
        idx.append(int(b['index'][r]))
xs, zs = np.array(xs), np.array(zs)
idx = np.array(idx)

h = math.radians(heading)
fx, fz = math.sin(h), -math.cos(h)
dx, dz = xs - cx, zs - cz
d = np.hypot(dx, dz)
wedge = (dx * fx + dz * fz) / np.maximum(d, 1) > math.cos(math.radians(hfov / 2))

raw = gzip.decompress(open(os.path.join(src, 'far16.bin'), 'rb').read())
W, H = struct.unpack_from('<II', raw, 4)
a, _, c, _, e, f = struct.unpack_from('<6f', raw, 12)
cls = np.frombuffer(raw, 'u1', W * H, 40).reshape(H, W)
height = np.frombuffer(raw, 'u1', W * H, 40 + 2 * W * H).reshape(H, W)
ii = np.clip(((xs - c) / a).astype(int), 0, W - 1)
jj = np.clip(((zs - f) / e).astype(int), 0, H - 1)
# (a building's centre can sit on a cell its footprint barely touches: any cell of the 3 x 3 around it counts as it being stamped)
pad = np.pad(height, 1)
near = np.zeros(len(xs), bool)
for dy in (-1, 0, 1):
    for dxx in (-1, 0, 1):
        near |= pad[jj + 1 + dy, ii + 1 + dxx] > 0
boxed = (cls[jj, ii] == 11) & (height[jj, ii] > 0)

far = gzip.decompress(open(os.path.join(src, 'far.bin'), 'rb').read()) if open(os.path.join(src, 'far.bin'), 'rb').read(2) == b'\x1f\x8b' else open(os.path.join(src, 'far.bin'), 'rb').read()
n_box = struct.unpack_from('<I', far, 4)[0]
tall = np.isin(idx, np.frombuffer(far, '<u4', n_box, 28 + n_box * 28))
# region rectangles within loadR of the stream centre
rx0 = np.floor(xs / R) * R + R / 2
rz0 = np.floor(zs / R) * R + R / 2
gapx = np.maximum(np.abs(sx - rx0) - R / 2, 0)
gapz = np.maximum(np.abs(sz - rz0) - R / 2, 0)
loaded = np.hypot(gapx, gapz) < load_r

n = int(wedge.sum())
print(json.dumps({
    'wedge_buildings': n,
    'A_absent': int((wedge & ~loaded & ~tall).sum()),
    'A_absent_pct': round(float((wedge & ~loaded & ~tall).sum()) / max(1, n) * 100, 1),
    'B_absent': int((wedge & ~near).sum()),
    'B_past_edge': int((wedge & ~loaded).sum()),
    'B_past_edge_with_a_box': int((wedge & ~loaded & (boxed | tall)).sum()),
    'B_past_edge_tone_only': int((wedge & ~loaded & ~(boxed | tall)).sum()),
}))
