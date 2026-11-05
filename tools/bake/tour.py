#!/usr/bin/env python3
"""The picture gate's list (docs/specs/bridges/BRIDGES.md section 5): what to photograph in a baked city and from where,
picked from its data, with no city in the code. tools/tour.mjs takes the photos into one contact sheet.

  python3 -I tools/bake/tour.py <slug> [--dir=public/city/<name>]

writes tools/bake/.cache/qa/<name>/tour.json (qa.py leaves it there): the frames, 27 at most, each the bus's pose
(lat, lon, y m, heading degrees), the camera it's seen with, what it looks at (name, OSM id, lat, lon) and its marks,
points of the subject in the bake's frame that tools/tour.mjs finds in the shot:

  bridges          every XL up to 3, then the others, longest first, a span of 1 km or more with no tower and no structure
                   tag before the rest (the thin-data case: the sheet lists every one), five bridges at most, none within
                   1,200 m of another. An XL takes 4 frames: along the span at a quarter and at three quarters (20 m over
                   the deck, heading along it), beside it (350 m off its tower nearest the middle, or the middle with
                   none, the low camera: the water or ground to the tower's top in the frame, the tower 5 degrees off
                   the heading so the bus doesn't stand where the deck meets it) and under it (the middle of its
                   longest stretch between the towers and supports under it, along it, the low camera under the deck).
                   The others take 2: along and beside (350 m off the middle, from where the deck falls mid-frame)
  small bridges    the two widest S decks and the longest M deck: 1 each, from 40 m
  tallest towers   the top 3 by height over their ground, buildings and towers together, 300 m apart, none on a big
                   deck: 1 each, from 300 m, from where its middle falls mid-frame
  largest parks    the top 3 open spaces, as qa.py lists them: 1 each, from 220 m up
  biggest stations the top 2 train_station or transportation footprints, else station rows: 1 each, from 120 m

The cameras are the game's (CAMERAS): the chase camera, the player's, sits 63 m over the bus and looks down 19 degrees,
so a subject at the bus's height falls into the frame's top quarter, and a bus under a deck has its camera over it; the
opening's low camera (CameraRig.openingLow), 17 m over the bus and looking level, is the one that sees a span from the
side and from under it. A side of a bridge is the one with the lower ground under the camera.

The decks are bridges.py's plan (its tops by the rule: until step 5 the frames along a deck fly over the drawn one by the
rule's margin, not the LiDAR's).
"""
import json
import math
import os
import sys
import time

import numpy as np

sys.dont_write_bytecode = True  # (no __pycache__ in tools/bake)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

MAX_FRAMES = 27
BRIDGES = 5          # bridges at most
XL_MAX = 3
APART = 1200.0       # m between two bridges' middles
TOWER_APART = 300.0  # m between two towers
TOWER_FROM = 300.0   # m: a tower is seen from this far, at half its height
TOWER_MIN = 25.0     # m over the ground: a tower candidate
OVER_DECK = 20.0     # m over the deck, flying along it
BESIDE = 350.0       # m off a deck's middle (an XL's tower)
BESIDE_TURN = 5.0    # degrees an XL's tower is seen off the bus's heading: the low camera puts the bus where the deck meets it
UNDER_CAM = 18.0     # m: the low camera this far under a deck's top (a 12 m double deck's underside, and 6 m)
UNDER_FLOOR = 8.0    # m: the bus no lower than this over what's under the deck
SMALL_FROM = 40.0    # m from a small bridge
PARK_UP = 220.0      # m over a park
STATION_FROM = 120.0 # m from a station
STATION_CLASSES = ('train_station', 'transportation')
# The game's cameras for a bus held at cruise (tour.mjs holds it; its speed runs up to cruise), as src/config.ts camera
# and src/game/CameraRig.ts set them: (m behind the bus, degrees up from it, m ahead of it it looks at, m over it it looks
# at). 'chase' the player's (distance, elevationCruise, lookAhead, 4 m under); 'low' the opening's (openingLow: 150 m at
# 6.5 degrees, three look-aheads, 10 m over). tour.mjs records where each camera stood: a change there shows in the marks.
CAMERAS = {'chase': (155.0, 24.0, 55.0, -4.0), 'low': (150.0, 6.5, 165.0, 10.0)}


def _log(*a):
    print(f'[{time.strftime("%H:%M:%S")}] tour:', *a, flush=True)


def heading_to(fx, fz):
    """compass degrees of a direction in the bake's frame (x east, z south): Flight's heading"""
    return math.degrees(math.atan2(fx, -fz)) % 360.0


def deck_at(d, f):
    """(x, z, top, unit direction over 80 m) a share f of the way along a planned deck"""
    return deck_at_s(d, f * d['length'])


def deck_at_s(d, s):
    """deck_at, s m along it"""
    k = int(np.argmin(np.abs(d['ss'] - s)))
    a, b = d['line'].interpolate(max(0.0, s - 40.0)), d['line'].interpolate(min(d['length'], s + 40.0))
    t = np.array([b.x - a.x, b.y - a.y])
    return float(d['xz'][k, 0]), float(d['xz'][k, 1]), float(d['y'][k]), t / max(1e-6, float(np.hypot(*t)))


def cam_offset(cam):
    """(m up, m back) of a camera over and behind the bus"""
    dist, el = CAMERAS[cam][:2]
    return dist * math.sin(math.radians(el)), dist * math.cos(math.radians(el))


def centred(cam, y, ahead):
    """the bus's height that puts a point `ahead` m in front of it, at height y, in the middle of the frame"""
    dist, el, la, ly = CAMERAS[cam]
    up, back = cam_offset(cam)
    return y - up + (back + ahead) * (up - ly) / (back + la)


def tour(slug, city_dir, log=_log):
    from pyproj import Transformer
    import shapely
    import pyarrow.parquet as pq
    import pyarrow.compute as pc
    from shapely.geometry import Point, box
    from shapely.strtree import STRtree
    from citydata import City
    import bridges as B
    import osm as O
    import qa

    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json'), encoding='utf8'))
    city = City(city_dir)
    man = city.manifest
    minX, minZ, maxX, maxZ = man['bounds']
    to_local = Transformer.from_crs('EPSG:4326', man['proj'], always_xy=True)
    inv = Transformer.from_crs(man['proj'], 'EPSG:4326', always_xy=True)
    osm = O.OSM(cfg, slug, to_local, lambda *a: None)
    osm.set_frame(minX, minZ, maxX, maxZ)
    ground = B.Ground.baked(city)

    def gy(x, z):
        y = float(ground.at([(x, z)])[0][0])
        return 0.0 if y != y else max(0.0, y)

    frames = []

    def frame(subject, kind, name, oid, look, bus, y, heading, camera='chase', marks=()):
        lo, la = inv.transform(bus[0], -bus[1])
        llo, lla = inv.transform(look[0], -look[1])
        frames.append({'subject': subject, 'kind': kind, 'name': name or '(unnamed)', 'osm': oid or '', 'lat': round(float(la), 6), 'lon': round(float(lo), 6),
                       'y': round(float(y), 1), 'heading': round(heading, 1), 'camera': camera, 'xz': [round(float(bus[0]), 1), round(float(bus[1]), 1)],
                       'look': {'lat': round(float(lla), 6), 'lon': round(float(llo), 6)},
                       'marks': [[w, round(float(mx), 1), round(float(my), 1), round(float(mz), 1)] for w, mx, my, mz in marks]})

    # ---------------------------------------------------------------- bridges
    p = B.plan(osm, ground, osm.segments(), B.hero_rows(man), log=lambda m: log('bridges: ' + m))
    decks = [d for d in p['decks'] if not d['skip']]
    spans = B.open_spans(decks)
    picks, used = [], []

    def take(d):
        c = d['line'].interpolate(0.5, normalized=True)
        if any(c.distance(q) < APART for q in used):
            return False
        used.append(c)
        picks.append(d)
        return True
    for d in sorted([d for d in decks if d['cls'] == 'XL'], key=lambda d: -d['length']):
        if sum(1 for q in picks if q['cls'] == 'XL') < XL_MAX:
            take(d)
    rest = sorted([d for d in decks if d['cls'] in ('L', 'M')], key=lambda d: (not any(d is s for s in spans), -d['length']))
    for d in rest:
        if len(picks) >= BRIDGES:
            break
        take(d)
    for d in picks:
        nm = d['tags'].get('bridge:name') or d['name']
        tag = f'{d["cls"]} {d["length"]:,.0f} m'
        for f in ((0.25, 0.75) if d['cls'] == 'XL' else (0.5,)):
            x, z, top, t = deck_at(d, f)
            frame(f'{tag}, along at {f:.2f}', 'bridge', nm, d['osm'], (x, z), (x, z), top + OVER_DECK, heading_to(*t))
        # beside: an XL from the side with the low camera, its tower nearest the middle in the frame from the water (or
        # ground) to its top; the others with the chase camera from where the deck's middle falls mid-frame
        xl = d['cls'] == 'XL'
        cam = 'low' if xl else 'chase'
        up, back = cam_offset(cam)
        tower = min(d['towers'], key=lambda q: abs(d['line'].project(Point(q['xz'])) - d['length'] / 2)) if xl and d['towers'] else None
        x, z, top, t = deck_at_s(d, d['line'].project(Point(tower['xz']))) if tower else deck_at(d, 0.5)
        n = np.array([-t[1], t[0]])
        side = min((1.0, -1.0), key=lambda k: gy(x + n[0] * k * (BESIDE + back), z + n[1] * k * (BESIDE + back)))
        bx, bz = x + n[0] * side * BESIDE, z + n[1] * side * BESIDE
        marks = [('deck', x, top, z)]
        if tower:
            tx, tz = (float(v) for v in tower['xz'])
            marks += [('tower top', tx, tower['base'] + tower['top'], tz), ('tower foot', tx, tower['base'], tz)]
            y = centred(cam, tower['base'] + tower['top'] / 2, BESIDE)
        else:
            y = centred(cam, top, BESIDE)
        frame(f'{tag}, beside' + (' its tower' if tower else '') + f', {BESIDE:.0f} m off', 'bridge', nm, d['osm'], (x, z), (bx, bz),
              max(y, gy(bx, bz) + UNDER_FLOOR), (heading_to(x - bx, z - bz) + (BESIDE_TURN if xl else 0.0)) % 360.0, cam, marks)
        if xl:
            # under it: the middle of its longest stretch between the towers and supports under it (with fewer than two,
            # its ends too: not over an approach, not in an anchorage), heading along it, the low camera behind the bus
            # and under the deck too where the stretch has room for it
            up, back = cam_offset('low')
            under = [q['xz'] for q in d['towers']] + [shapely.get_coordinates(shapely.centroid(s['g']))[0] for s in p['supports']
                                                      if s['kind'] == 'support' and d['line'].distance(shapely.centroid(s['g'])) <= d['width'] / 2 + 10]
            cuts = sorted({round(d['line'].project(Point(q)), 1) for q in under})
            if len(cuts) < 2:
                cuts = sorted({0.0, d['length'], *cuts})
            a, b = max(zip(cuts, cuts[1:]), key=lambda q: q[1] - q[0])
            s = (a + b) / 2 if b - a < back + 40 else min(max((a + b) / 2, a + back + 20), b - 20)
            x, z, top, t = deck_at_s(d, s)
            g = gy(x, z)
            frame(f'{tag}, under it', 'bridge', nm, d['osm'], (x, z), (x, z), max(g + UNDER_FLOOR, min(g + (top - g) / 2, top - UNDER_CAM - up)),
                  heading_to(*t), 'low', [('deck', x, top, z)])
    # ---------------------------------------------------------------- small bridges: the two widest S, the longest M
    small = []
    for d in sorted([d for d in decks if d['cls'] == 'S'], key=lambda d: -d['width']):
        # (not the same place twice: a road's two carriageways are often its two widest S decks)
        if len(small) < 2 and all(d['line'].distance(q['line']) > TOWER_APART for q in small):
            small.append(d)
    small += sorted([d for d in decks if d['cls'] == 'M' and not any(d is q for q in picks)], key=lambda d: -d['length'])[:1]
    for d in small:
        x, z, top, t = deck_at(d, 0.5)
        n = np.array([-t[1], t[0]])
        bx, bz = x + n[0] * SMALL_FROM, z + n[1] * SMALL_FROM
        frame(f'{d["cls"]} {d["length"]:,.0f} m, {d["width"]:.1f} m wide, from {SMALL_FROM:.0f} m', 'small bridge', d['tags'].get('bridge:name') or d['name'],
              d['osm'], (x, z), (bx, bz), top + 10.0, heading_to(x - bx, z - bz))
    # ---------------------------------------------------------------- the tallest towers, by height over their ground
    cand = []
    for t in city.building_tiles():
        h = t['roofY'] - t['groundY']
        for i in np.flatnonzero(h >= TOWER_MIN):
            ring = t['xz'][t['vertStart'][i]:t['vertStart'][i + 1]]
            if len(ring):
                cand.append((float(h[i]), float(ring[:, 0].mean()), float(ring[:, 1].mean()), ''))
    di, gi = osm.read('infrastructure')
    if di is not None:
        for i, row in enumerate(di.itertuples(index=False)):
            if row.subtype == 'bridge' or row.height is None or row.height != row.height or row.height < TOWER_MIN or B.tags_of(row.tags).get('barrier'):
                continue
            c = shapely.get_coordinates(shapely.centroid(gi[i]))[0]
            cand.append((float(row.height), float(c[0]), float(c[1]), B.osm_ref(row.osm_id)))
    cand.sort(reverse=True)
    big = [d['line'] for d in decks if d['cls'] in ('L', 'XL')]
    bt = STRtree(big) if big else None
    tw = []
    for h, x, z, oid in cand:
        if any(math.hypot(x - q[1], z - q[2]) < TOWER_APART for q in tw):
            continue
        if bt is not None and len(bt.query(Point(x, z), predicate='dwithin', distance=40.0)):
            continue  # (a bridge's tower: the bridges' frames have it)
        tw.append((h, x, z, oid))
        if len(tw) == 3:
            break
    # (their names: the named building footprints under them)
    path = os.path.join(osm.dir, 'building.parquet')
    names = {}
    if tw and os.path.exists(path):
        tb = pq.read_table(path, columns=['name', 'osm_id', 'geometry'])
        tb = tb.filter(pc.is_valid(tb['name']))
        gb = osm.local(shapely.from_wkb(tb['geometry'].to_numpy(zero_copy_only=False)))
        st = STRtree(gb)
        nb, ob = tb['name'].to_pylist(), tb['osm_id'].to_pylist()
        for h, x, z, oid in tw:
            hit = st.query(Point(x, z), predicate='dwithin', distance=8.0)
            if len(hit):
                # (the largest named footprint under it: the tower, not a shop inside it)
                j = max(hit, key=lambda j: (gb[j].distance(Point(x, z)) < 0.5, gb[j].area))
                names[(x, z)] = (nb[j], B.osm_ref(ob[j]))
        del tb, gb, st
    for h, x, z, oid in tw:
        nm, ref = names.get((x, z), ('', oid))
        g = gy(x, z)
        # (from where its middle falls mid-frame: at half its height the chase camera's pitch cut a tall one's top off)
        frame(f'tower, {h:.0f} m over its ground, from {TOWER_FROM:.0f} m', 'tower', nm, ref or oid, (x, z), (x, z + TOWER_FROM),
              centred('chase', g + h / 2, TOWER_FROM), 0.0, marks=[('top', x, g + h, z), ('foot', x, g, z)])
    # ---------------------------------------------------------------- the largest parks
    for pk in qa.open_spaces(osm, box(minX, minZ, maxX, maxZ), 3):
        c = pk['geom'].representative_point()
        frame(f'park, {pk["geom"].area / 1e4:,.1f} ha, from {PARK_UP:.0f} m up', 'park', pk['name'], '', (c.x, c.y), (c.x, c.y + PARK_UP), gy(c.x, c.y) + PARK_UP, 0.0)
    # ---------------------------------------------------------------- the biggest stations
    st_ = []
    if os.path.exists(path):
        tb = pq.read_table(path, columns=['class', 'name', 'osm_id', 'geometry'])
        tb = tb.filter(pc.is_in(tb['class'], value_set=__import__('pyarrow').array(STATION_CLASSES)))
        if tb.num_rows:
            gb = osm.local(shapely.from_wkb(tb['geometry'].to_numpy(zero_copy_only=False)))
            keep = shapely.intersects(gb, box(minX, minZ, maxX, maxZ))
            for j in np.flatnonzero(keep):
                c = gb[j].centroid
                st_.append((float(gb[j].area), c.x, c.y, tb['name'][j].as_py() or '', B.osm_ref(tb['osm_id'][j].as_py())))
    if len(st_) < 2 and di is not None:
        for i, row in enumerate(di.itertuples(index=False)):
            if row.klass in ('station', 'railway_station', 'train_station', 'subway_station', 'halt'):
                c = gi[i].centroid
                st_.append((0.0, c.x, c.y, row.name or '', B.osm_ref(row.osm_id)))
    stations = []
    for a, x, z, nm, oid in sorted(st_, key=lambda q: -q[0]):
        if all(math.hypot(x - q[1], z - q[2]) > TOWER_APART for q in stations):
            stations.append((a, x, z, nm, oid))
        if len(stations) == 2:
            break
    for a, x, z, nm, oid in stations:
        frame(f'station' + (f', {a:,.0f} m²' if a else '') + f', from {STATION_FROM:.0f} m', 'station', nm, oid, (x, z), (x, z + STATION_FROM),
              gy(x, z) + 30.0, 0.0)
    open_ = []
    for d in spans:
        c = d['line'].interpolate(0.5, normalized=True)
        lo, la = inv.transform(c.x, -c.y)
        open_.append({'name': d['name'] or '(unnamed)', 'length': round(d['length']), 'osm': d['osm'], 'lat': round(float(la), 6), 'lon': round(float(lo), 6)})
    return {'slug': slug, 'name': os.path.basename(os.path.normpath(city_dir)), 'written': time.strftime('%Y-%m-%d %H:%M'), 'frames': frames[:MAX_FRAMES],
            'openSpans': open_, 'classes': {c: sum(1 for d in decks if d['cls'] == c) for c in B.CLASSES}}


def main():
    sys.stdout.reconfigure(errors='backslashreplace')
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    slug = args[0] if args else 'sf'
    d = flags.get('dir') or os.path.join(ROOT, 'public', 'city', slug)
    t = tour(slug, d)
    out = os.path.join(HERE, '.cache', 'qa', t['name'])
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'tour.json'), 'w', encoding='utf8') as f:
        json.dump(t, f, indent=1, ensure_ascii=False)
    for k, fr in enumerate(t['frames'], 1):
        print(f'{k:2d} {fr["kind"]:12s} {fr["name"][:34]:34s} {fr["osm"]:13s} {fr["subject"]}  bus {fr["lat"]:.5f}, {fr["lon"]:.5f} y {fr["y"]:.0f} heading {fr["heading"]:.0f}')
    print(f'{len(t["frames"])} frames; open spans {[(s["name"], s["length"]) for s in t["openSpans"]]}; {os.path.relpath(os.path.join(out, "tour.json"), ROOT)}')


if __name__ == '__main__':
    main()
