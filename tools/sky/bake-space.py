# The sky's data, cut down for the game (MOONSHOT.md section 7, SKY.md section 3). Output goes to public/sky/, gzipped, and is only ever fetched under ?moonrun.
#   earth.bin  2048 x 1024: class, tone in 16 levels, night lights in 8 levels, as three planes (Blue Marble and Black Marble; class and tone only, never its colours)
#   moon.bin   1024 x 512: tone in 8 levels (CGI Moon Kit)
#   stars.bin  Yale BSC5 to V 6.5, epoch 2030, plus the few fainter stars the figures end on
#   lines.bin  the western figures as u16 pairs into stars.bin (Stellarium `western`, CC BY-SA: NOT cleared for main, SKY.md decision 4)
#
#   C:/Users/Utku/sb-venv/Scripts/python.exe -I -X utf8 tools/sky/bake-space.py [<data dir>]
#
# <data dir> holds earth/, moonkit/, bsc5/, stellarium-skycultures/ (default: sbw-main's shots/local/sky/work/data, read only). The figures name Hipparcos numbers and Yale has
# none, so tools/sky/line-stars.json holds the crosswalk: built once from HYG v4.1, which isn't in that folder (SKY's earlier work left it in a scratchpad). Pass --hyg=<csv.gz>
# to build it again. Numbers only: each figure star's HIP, its Yale HR and where it stands.
import gzip, io, json, math, os, struct, sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'sky')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
opts = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--'))
DATA = args[0] if args else 'C:/Users/Utku/sbw-main/shots/local/sky/work/data'
EPOCH = 2030.0
VMAX = 6.5


def gz(b):
    # (mtime 0: the same input bakes the same bytes)
    s = io.BytesIO()
    with gzip.GzipFile(fileobj=s, mode='wb', compresslevel=9, mtime=0) as f:
        f.write(b)
    return s.getvalue()


def write(name, raw):
    z = gz(raw)
    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(z)
    print(f'{name}: {len(raw)} raw, {len(z)} gzip')


def earth():
    E = np.asarray(Image.open(f'{DATA}/earth/land_shallow_topo_2048.jpg').convert('RGB'), np.float32) / 255
    h, w = E.shape[:2]
    r, g, b = E[..., 0], E[..., 1], E[..., 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    # (earth/globe.py's classes: what the mocks were judged on)
    ocean = (b > r * 1.05) & (b > g * 0.98) & (lum < 0.5)
    ice = (lum > 0.72) & (np.abs(r - b) < 0.12)
    green = (~ocean) & (~ice) & (g >= r * 0.98)
    cls = np.where(ocean, 0, np.where(ice, 3, np.where(green, 1, 2))).astype(np.uint8)
    tone = np.clip(np.round(np.clip((lum - 0.08) / 0.5, 0, 1) * 15), 0, 15).astype(np.uint8)
    # the sea carries no tone, but a texel of sea beside land takes its land's: the shader filters tone across the coast, and a coast must not darken
    land = ~ocean
    t = np.where(land, tone.astype(np.float32), 0)
    n = land.astype(np.float32)
    ts, ns = np.zeros_like(t), np.zeros_like(n)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        ts += np.roll(np.roll(t, dy, 0), dx, 1)
        ns += np.roll(np.roll(n, dy, 0), dx, 1)
    tone2 = np.where(land, tone, np.where(ns > 0, np.round(ts / np.maximum(ns, 1)), 0)).astype(np.uint8)
    L = Image.open(f'{DATA}/earth/BlackMarble_2016_01deg.jpg').convert('L').resize((w, h), Image.BOX)
    a = np.asarray(L, np.float32)
    q = np.clip((a / 255) ** 0.5 * 7 + 0.5, 0, 7).astype(np.uint8)
    q = np.where(a < 18, 0, q).astype(np.uint8)
    print('earth share sea, green, dry, ice', [round(float((cls == k).mean()), 3) for k in range(4)], 'lit', round(float((q > 0).mean()), 3))
    print('  class', len(gz(cls.tobytes())), 'tone', len(gz(tone2.tobytes())), 'lights', len(gz(q.tobytes())))
    write('earth.bin', struct.pack('<HH', w, h) + cls.tobytes() + tone2.tobytes() + q.tobytes())


def moon():
    # (the Kit's 2K map, area filtered: 4 x the width of the disc it has to fill)
    m = Image.open(f'{DATA}/moonkit/lroc_color_poles_2k.tif').convert('L').resize((1024, 512), Image.BOX)
    a = np.asarray(m, np.float32) / 255
    LO, HI = 0.2511, 0.7595  # (research-astro.md 7: the map's albedo range, 2-98 %)
    t = np.clip((a - LO) / (HI - LO), 0, 1)
    q = np.clip(np.round(t * 7), 0, 7).astype(np.uint8)
    write('moon.bin', struct.pack('<HH', 1024, 512) + q.tobytes())


def load_bsc():
    out = []
    with gzip.open(f'{DATA}/bsc5/bsc5.dat.gz', 'rt', encoding='latin1') as f:
        for l in f:
            if len(l) < 150:
                continue
            c = lambda a, b: l[a - 1:b].strip()
            if not c(76, 77):
                continue  # (novae and things that aren't stars)
            try:
                ra = (float(c(76, 77)) + float(c(78, 79)) / 60 + float(c(80, 83)) / 3600) * 15
                dec = (-1 if c(84, 84) == '-' else 1) * (float(c(85, 86)) + float(c(87, 88)) / 60 + float(c(89, 90)) / 3600)
                v = float(c(103, 107))
            except ValueError:
                continue
            num = lambda s, d: float(s) if s not in ('', '+', '-') else d
            out.append(dict(hr=int(c(1, 4)), ra=ra, dec=dec, v=v, bv=num(c(110, 114), float('nan')), pmra=num(c(149, 154), 0.0), pmde=num(c(155, 160), 0.0)))
    return out


def crosswalk():
    """[hip, hr, ra, dec, v] of every star a western figure names. hr 0: Yale doesn't have it."""
    path = os.path.join(HERE, 'line-stars.json')
    if 'hyg' not in opts:
        return json.load(open(path))
    J = json.load(open(f'{DATA}/stellarium-skycultures/western__index.json', encoding='utf8'))
    want = sorted({s for c in J['constellations'] for l in c['lines'] for s in l if isinstance(s, int)})  # ('thin' is a line style)
    rows = {}
    import csv
    with gzip.open(opts['hyg'], 'rt', encoding='latin1') as f:
        for r in csv.DictReader(f):
            if r['hip'] and int(r['hip']) in set(want) and int(r['hip']) not in rows:
                rows[int(r['hip'])] = [int(r['hip']), int(r['hr'] or 0), round(float(r['ra']) * 15, 5), round(float(r['dec']), 5), float(r['mag'])]
    missing = [h for h in want if h not in rows]
    print('crosswalk', len(want), 'stars, not in HYG:', missing)
    out = [rows[h] for h in want if h in rows]
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    return out


def color_class(bv):
    if not (bv == bv):
        return 3
    edges = (-0.1, 0.1, 0.3, 0.55, 0.8, 1.1, 1.5)
    k = 0
    while k < len(edges) and bv >= edges[k]:
        k += 1
    return k


def stars():
    J = json.load(open(f'{DATA}/stellarium-skycultures/western__index.json', encoding='utf8'))
    walk = {r[0]: r for r in crosswalk()}
    bsc = load_bsc()
    by_hr = {s['hr']: s for s in bsc}
    keep = [s for s in bsc if s['v'] <= VMAX]
    print('Yale to V', VMAX, len(keep), 'stars, of', len(bsc))
    ids = {id(s) for s in keep}
    extra = 0
    hip_star = {}
    for hip, row in walk.items():
        hr, ra, dec, v = row[1:]
        s = by_hr.get(hr)
        if s is None:
            s = dict(hr=0, ra=ra, dec=dec, v=v, bv=float('nan'), pmra=0.0, pmde=0.0)
            extra += 1
        if id(s) not in ids:
            ids.add(id(s))
            keep.append(s)
        hip_star[hip] = s
    print('figures add', len(keep) - len([s for s in bsc if s['v'] <= VMAX]), 'fainter stars,', extra, 'of them not in Yale')
    # sorted by declination: a delta and a varint, then RA in two planes, then one byte of 5 bits of magnitude and 3 of colour (research-astro.md 5: 0.0055 degrees)
    dt = EPOCH - 2000
    rows = []
    for s in keep:
        cd = max(0.05, math.cos(math.radians(s['dec'])))
        ra = (s['ra'] + s['pmra'] * dt / 3600 / cd) % 360
        dec = s['dec'] + s['pmde'] * dt / 3600
        rows.append((round((dec + 90) / 180 * 65535), round(ra / 360 * 65536) & 0xffff, (max(0, min(31, round((s['v'] + 1.5) / 8 * 31))) << 3) | color_class(s['bv']), id(s)))
    rows.sort(key=lambda r: (r[0], r[1]))
    index = {r[3]: i for i, r in enumerate(rows)}
    dd = bytearray()
    prev = 0
    for r in rows:
        d = r[0] - prev
        prev = r[0]
        while d >= 128:
            dd.append((d & 127) | 128)
            d >>= 7
        dd.append(d)
    raw = struct.pack('<I', len(rows)) + bytes(dd) + bytes(r[1] >> 8 for r in rows) + bytes(r[1] & 255 for r in rows) + bytes(r[2] for r in rows)
    write('stars.bin', raw)
    seg = []
    for c in J['constellations']:
        for l in c['lines']:
            l = [s for s in l if isinstance(s, int)]
            for a, b in zip(l, l[1:]):
                if a in hip_star and b in hip_star:
                    seg += [index[id(hip_star[a])], index[id(hip_star[b])]]
    print('figures', len(J['constellations']), 'segments', len(seg) // 2)
    write('lines.bin', struct.pack('<I', len(seg)) + np.array(seg, np.uint16).tobytes())


os.makedirs(OUT, exist_ok=True)
earth()
moon()
stars()
