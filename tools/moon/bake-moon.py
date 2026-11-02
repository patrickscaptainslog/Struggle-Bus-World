#!/usr/bin/env python3
# Cuts the Moon's data down to what ?moon loads (public/moon): the whole relief, the one real height window, the named places. It generates nothing: src/moon/gen.ts is the one
# generator, and this only packs what it reads.
#   C:/Users/Utku/sb-venv/Scripts/python.exe -I -X utf8 tools/moon/bake-moon.py [data dir] [out dir]
#
# relief.bin    'SBMH', u16 w, u16 h, f32 quant (m), then i16 h[w*h] as differences along each row (the first of a row from the row above it), gzip. Height in m over the 1737.4 km sphere is
#               value * quant. Longitude -180 at the left, row 0 at the north pole, texel centres. Moon Kit's file reads (v - 20000) / 2 m: fitted against the LOLA window, rms 124 m over its 7.6 km texels.
# theophilus.bin  'SBMW', u16 w, u16 h, f32 quant (m), f32 lat0, lon0 (first texel's centre, degrees), f32 dlat, dlon (per texel), then i16 as above, gzip. The LOLA 118 m window with its
#               north-south track streaks smoothed away, then every second sample: the streaks run along the tracks, so the cut is across them.
# places.json   [name, type, lat, lon, km, azimuth?], the 150 landmarks. The azimuth (degrees from north) of the long straight ones is read off the gazetteer's bounding box and the Moon's map by eye.
# names.json    [name, lat, lon, km], every other named crater in the IAU gazetteer, for its sign: nothing is shaped from these, the relief has them.
import csv
import gzip
import json
import struct
import sys
from pathlib import Path

import numpy as np
import rasterio
from scipy.ndimage import gaussian_filter

DATA = Path(sys.argv[1] if len(sys.argv) > 1 else 'C:/Users/Utku/sbw-main/shots/local/moondata')
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parents[2] / 'public' / 'moon')
OUT.mkdir(parents=True, exist_ok=True)

AZ = {
    'ALPINE VALLEY': 54,
    'RHEITA VALLEY': 335,
    'HADLEY RILLE': 15,
    'ARIADAEUS RILLE': 100,
    'HYGINUS RILLE': 125,
    "SCHROTER'S VALLEY": 300,
    'STRAIGHT WALL': 352,
    'STRAIGHT RANGE': 90,
}


def packed(a, q):
    """i16 differences along each row, the first of a row against the row above."""
    v = np.round(a / q).astype(np.int32)
    d = v.copy()
    d[:, 1:] = v[:, 1:] - v[:, :-1]
    d[1:, 0] = v[1:, 0] - v[:-1, 0]
    assert d.min() >= -32768 and d.max() <= 32767
    return d.astype('<i2').tobytes()


def write(name, head, body):
    raw = head + body
    gz = gzip.compress(raw, 9, mtime=0)
    (OUT / name).write_bytes(gz)
    print(f'{name}: {len(raw):,} B raw, {len(gz):,} B gzip')


with rasterio.open(DATA / 'relief-moonkit-ldem4' / 'ldem_4_uint.tif') as f:
    ldem = (f.read(1).astype(np.float32) - 20000) * 0.5
Q = 2.0
print('relief', ldem.shape, ldem.min(), ldem.max())
write('relief.bin', b'SBMH' + struct.pack('<HHf', ldem.shape[1], ldem.shape[0], Q), packed(ldem, Q))

lola = np.load(DATA / 'window-theophilus-lola118' / 'theophilus_lola118.npy').astype(np.float32) * 0.5
meta = json.loads((DATA / 'window-theophilus-lola118' / 'theophilus_lola118.json').read_text())
# (the streaks are a cut across the tracks, east-west: a long sigma that way, a short one along them)
smooth = gaussian_filter(lola, sigma=(1.0, 3.0), mode='nearest')
half = smooth[::2, ::2]
Qw = 1.0
head = b'SBMW' + struct.pack('<HHfffff', half.shape[1], half.shape[0], Qw, meta['lat_of_first_row_centre'], meta['lon_of_first_col_centre'], 2 * meta['lat_step_deg'], 2 * meta['lon_step_deg'])
print('window', half.shape, half.min(), half.max())
write('theophilus.bin', head, packed(half, Qw))

land = json.loads((DATA / 'landmarks.json').read_text(encoding='utf8'))['landmarks']
rows = []
for e in land:
    row = [e['name'], e['type'], round(e['lat'], 4), round(e['lon'], 4), round(e['diameter_km'], 2)]
    if e['name'] in AZ:
        row.append(AZ[e['name']])
    rows.append(row)
txt = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))
(OUT / 'places.json').write_text(txt, encoding='utf8')
print('places.json', len(rows), 'places,', len(txt.encode('utf8')), 'B')

have = {e['name'] for e in land}
names = []
with open(DATA / 'gazetteer-moon.csv', encoding='utf8', newline='') as f:
    for r in csv.DictReader(f):
        name = r['name'].upper()
        if 'Crater' in r['type'] and name not in have and float(r['diameter_km']) >= 1:
            names.append([name, round(float(r['lat']), 2), round(float(r['lon']), 2), round(float(r['diameter_km']), 1)])
txt = json.dumps(names, ensure_ascii=False, separators=(',', ':'))
(OUT / 'names.json').write_text(txt, encoding='utf8')
print('names.json', len(names), 'names,', len(txt.encode('utf8')), 'B,', len(gzip.compress(txt.encode('utf8'), 9)), 'B gzip')
