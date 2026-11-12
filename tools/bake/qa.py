#!/usr/bin/env python3
"""Plausibility QA of an OSM city bake: its trees, water and sand against ESA WorldCover 10 m (2021).

bake.py runs it at the end of every OSM bake (its arrays freed first); standalone it checks any baked
city dir, a --out test bake or an older bake made before it existed:

  python3 -I tools/bake/qa.py <slug> [--dir=public/city/<name>] [--crops=8]

What it compares (on the city frame, cut into 128 m cells; WorldCover on the bake's frame at 4 m):
  trees   every baked tree is matched to OSM's mapped trees (the extract) or is procedural (park / woods
          trees: kinds 1-2, street trees: kind 0). A procedural park / woods tree is "unsupported" when no
          WorldCover tree pixel (tree cover or mangroves) lies within 'support' m of it; a cell holding
          'openCellTrees' or more of them is "trees on open land" (a park polygon planted over its lawns,
          marsh or beach). A park / wood / open-space cell WorldCover sees as wooded but the bake left bare
          is "missing trees"; WorldCover woods over OSM scrub / heath are reported, not failed (the bake
          trusts OSM there: osm.TREE_SHRUB). Street trees along frontages are reported, not checked:
          WorldCover's 10 m pixels miss most single street trees (no tree pixel within 20 m of 42 % of
          San Francisco's mapped street trees, 12 % of London's), so the report sets the procedural ones'
          share beside the mapped street trees' share.
  water   the baked water share of a cell (pier decks over WorldCover water count as water) against
          WorldCover's permanent water (80); a difference of 'waterDiff' or more is a disagreement
          (a tidal marsh drawn as grass, a coastline or a lake OSM lacks, a lake that isn't there).
  sand    baked sand where WorldCover sees neither bare ground (60) nor water, and WorldCover bare
          ground where the bake has grass or woods.
  bridges the fifteen checks of docs/specs/bridges/BRIDGES.md section 4 (bridge_checks()): the heroes against the
          map, what's drawn against the map's bridges, the street figure; bridges.py plans the map's decks. Each
          value carries its unit (m, a share, a count, a ratio); a check with nothing to read prints NOT READ.
          They run first, before the WorldCover reference (a city baked without it gets them too), and fail a
          bake only once QA_DEFAULTS 'bridgeGate' is 'fail' (step 6), a check over its limit or one that failed
          to read: until then they are reported.
Writes:
  city.json stats.qa                         the summary (pass, the failed checks, counts, the parks)
  tools/bake/.cache/qa/<name>/report.md      the checks, the worst disagreements with lat / lon and a
                                             reason, the largest parks / open spaces with their numbers
  tools/bake/.cache/qa/<name>/park_<k>.png   top-down crops of them: WorldCover (left), the bake (right):
                                             ground classes, buildings, every tree by source, the
                                             WorldCover tree outline
  tools/bake/.cache/qa/<name>/cells.png      the frame with every flagged cell
Exit status: 0 PASS, 3 FAIL (a threshold exceeded; bake.py exits 3 too unless --qa=warn) with a loud
'!!! QA FAIL' block on stdout. Thresholds: QA_DEFAULTS (FAIL when a share exceeds its ...Max and the
count behind it reaches 'minFlagged' cells / 'minUnsupported' trees: a small --bbox test bake's few
cells don't fail on one lagoon); a city config's "qa": {...} sets them, but a limit, a floor or how
strictly a check measures (TIGHTER) only tighter and to a finite number, and how the city is cut up into
cells (FIXED) not at all: a refused one is ignored, logged and listed in the report. Calibration (2026-10
test bakes, five frames in San Francisco and London): the old "trees in every park" rule scored
unsupported 2-39 % (FAIL in three: the Crissy Field frame 39 % with 19 of 65 cells on open land), the
evidence rule <= 0.11 % and 0 cells; water and sand on all of San Francisco 0.06 % and 0.10 %.
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

QA_DEFAULTS = {
    'cell': 128.0,           # m: the comparison cells
    'wcRes': 4.0,            # m: WorldCover on the frame (nearest), the baked classes sampled at the same grid
    'support': 20.0,         # m: a procedural tree is supported when a WorldCover tree pixel lies this close (square reach)
    'unsupportedMax': 0.05,  # FAIL: share of the procedural park / woods trees without that support (street trees: reported)
    'openCellTrees': 8,      # a cell is "trees on open land" with this many unsupported park / woods trees (~5 / ha)...
    'openCellsMax': 0.01,    # FAIL: ...in more than this share of the land cells
    'waterDiff': 0.5,        # a cell disagrees on water when the baked and WorldCover water shares differ this much
    'waterCellsMax': 0.02,   # FAIL: share of all cells
    'sandDiff': 0.4,         # a cell disagrees on sand at this share (see the module doc)
    'sandCellsMax': 0.02,    # FAIL: share of the land cells
    'woodCover': 0.6,        # "missing trees": WorldCover tree cover of at least this in a cell mostly grass / woods...
    'woodPerHa': 8.0,        # ...that has fewer trees than this per ha of land
    'woodCellsMax': 0.10,    # FAIL: share of such wooded green cells
    'minFlagged': 5,         # ...and a cell check fails only with at least this many flagged cells
    'minUnsupported': 50,    # ...and "unsupported" only with at least this many trees (small test bakes: a handful of cells)
    'worst': 30,             # disagreements listed in the report
    'crops': 8,              # parks / open spaces cropped
    'cropMax': 2400.0,       # m: the longest side of a crop (bigger parks: their middle)
    # bridges (docs/specs/bridges/BRIDGES.md section 4, bridge_checks()): reported on every bake; they fail one only once
    # this is 'fail' (step 6). A check is over when its value passes its limit and its count reaches its floor
    'bridgeGate': 'report',
    'heroOffDataMax': 15.0,       # m: a hero row's typed point from the centre of the OSM row it names (or the id is gone)
    'towerOffDeckMax': 1.0,       # x half the drawn deck's width: a drawn tower's centre from the deck's centre line
    'deckNoCollisionMax': 0.02,   # share of a drawn deck's area no collision post covers
    'deckFreeEndMax': 3.0,        # m: a drawn deck's end from the ground, either way with a kept way within 12 m, over without (no deck or building within 12 m)
    'waterRoadNoDeckMax': 0.05,   # share of the real bridge road and rail over water with no deck or ground bridge...
    'waterRoadNoDeckMinM': 50.0,  # ...and at least this many m of it
    'bridgeNoDeckMax': 0.05,      # share of all the real bridge road and rail with no deck or ground bridge...
    'bridgeNoDeckMinM': 100.0,    # ...and at least this many m of it
    'bareSupportsMax': 0,         # real supports standing in the water with nothing drawn on them
    'standInsMax': 3,             # baked buildings of 12 m or more standing mostly on a deck, their top within 15 m of it or over
    'tallNothingMax': 0,          # towers and masts in the data of tallNothingHeight or more with nothing drawn
    'tallNothingHeight': 50.0,    # m
    'streetFigureMin': 0.9,       # ratio: the largest street piece drawn, to the largest the full map gives in the frame
    'atGradeLossMax': 0.005,      # share of the road kept: a bridge-flagged way's road surface lost on land, on no bridge (bridges only)
    'deckContinuityMax': 3.0,     # m: two decks of one bridge miss by this in plan (or 1.5 m in height)
    'deckClearanceMin': 4.5,      # m between two crossing decks
    'deckBuriedMax': 0.05,        # share of a meshed deck over 0.5 m under the ground, away from a tunnel
    'deckSlopeMax': 0.08,         # a road deck's grade between samples, after the spike filter
}
# The limits and floors a city config's "qa" may only tighten, and the same for the keys that say how strictly a check
# measures (a reach, the share that flags a cell, the cover that makes one wooded, trees per ha): -1 lower is tighter, +1
# higher is (a value floor, trees per ha, or the gate set to fail). FIXED: how the city is cut up to be measured (the
# cells, WorldCover's grid), which no direction makes stricter: a config can't set them. The rest are the report's
# lengths: the config sets them.
TIGHTER = {'unsupportedMax': -1, 'openCellsMax': -1, 'waterCellsMax': -1, 'sandCellsMax': -1, 'woodCellsMax': -1, 'minFlagged': -1,
           'minUnsupported': -1, 'support': -1, 'openCellTrees': -1, 'waterDiff': -1, 'sandDiff': -1, 'woodCover': -1, 'woodPerHa': +1,
           'bridgeGate': +1, 'heroOffDataMax': -1, 'towerOffDeckMax': -1, 'deckNoCollisionMax': -1, 'deckFreeEndMax': -1,
           'waterRoadNoDeckMax': -1, 'waterRoadNoDeckMinM': -1, 'bridgeNoDeckMax': -1, 'bridgeNoDeckMinM': -1, 'bareSupportsMax': -1,
           'standInsMax': -1, 'tallNothingMax': -1, 'tallNothingHeight': -1, 'streetFigureMin': +1, 'atGradeLossMax': -1,
           'deckContinuityMax': -1, 'deckClearanceMin': +1, 'deckBuriedMax': -1, 'deckSlopeMax': -1}
FIXED = ('cell', 'wcRes')
GATE = ('report', 'fail')

# ground classes (src/world/tiles.ts Ground; osm.py)
PAVED, GRASS, WATER, SIDEWALK, PLAZA, PATH, SAND, RAIL, FOREST, YARD, ROCK = range(11)
CLASS_NAME = ['road', 'grass', 'water', 'sidewalk', 'plaza', 'path', 'sand', 'rail', 'forest', 'yard', 'rock']
# WorldCover classes and its legend colours
WC_NAME = {0: 'no data', 10: 'tree cover', 20: 'shrubland', 30: 'grassland', 40: 'cropland', 50: 'built-up', 60: 'bare / sparse',
           70: 'snow / ice', 80: 'water', 90: 'herbaceous wetland', 95: 'mangroves', 100: 'moss / lichen'}
WC_RGB = {0: (1, 1, 1), 10: (0.0, 0.39, 0.0), 20: (1.0, 0.73, 0.13), 30: (1.0, 1.0, 0.30), 40: (0.94, 0.59, 1.0), 50: (0.98, 0.0, 0.0),
          60: (0.71, 0.71, 0.71), 70: (0.94, 0.94, 0.94), 80: (0.0, 0.39, 0.78), 90: (0.0, 0.59, 0.63), 95: (0.0, 0.81, 0.46), 100: (0.98, 0.90, 0.63)}
# the parks / open spaces the report crops: OSM land use and land (natural=*) classes (Overture's)
LU_OPEN = {'park', 'garden', 'cemetery', 'grave_yard', 'nature_reserve', 'national_park', 'zoo', 'golf_course', 'recreation_ground',
           'common', 'village_green', 'grass', 'meadow', 'dog_park', 'campground'}
LAND_OPEN = {'wood', 'forest', 'grassland', 'heath', 'scrub', 'wetland', 'beach', 'sand', 'dune', 'meadow', 'grass'}
SRC_RGB = {'mapped': (0.16, 0.38, 0.85), 'park': (0.05, 0.30, 0.10), 'street': (0.85, 0.40, 0.05)}


def _log(*a):
    print(f'[{time.strftime("%H:%M:%S")}] qa:', *a, flush=True)


def share(mask, b):
    """per b x b block: the share of True (a bool mask whose shape is a multiple of b)"""
    h, w = mask.shape
    return mask.reshape(h // b, b, w // b, b).mean(axis=(1, 3), dtype=np.float32)


def top_classes(vals, names):
    """'grass 60%, road 20%': the (up to 3) main classes of an array (names: a list or a dict by code)"""
    v, c = np.unique(vals, return_counts=True)
    order = np.argsort(-c)
    nm = (lambda q: names[q] if q < len(names) else str(q)) if isinstance(names, list) else (lambda q: names.get(q, str(q)))
    return ', '.join(f'{nm(int(v[k]))} {c[k] / vals.size * 100:.0f}%' for k in order[:3] if c[k] / vals.size >= 0.05)


def load_city(city):
    """(cls uint8 [H, W] at the class texel (2 m), trees float [n, 3] x, z, kind, the terrain's heights float32 at its
    vertices every `cell` m from the frame's corner, cell) inside the frame"""
    m = city.manifest
    minX, minZ, maxX, maxZ = m['bounds']
    n = city.classN
    res = m['tileSize'] / n
    W, H = int(round((maxX - minX) / res)), int(round((maxZ - minZ) / res))
    cls = np.full((H, W), WATER, np.uint8)  # (bake.py writes no terrain tile for an all-water tile)
    N = m.get('terrainN', 65)
    cell = m['tileSize'] / (N - 1)
    Wc, Hc = int(round((maxX - minX) / cell)), int(round((maxZ - minZ) / cell))
    hgt = np.zeros((Hc + 1, Wc + 1), np.float32)  # (and such a tile is water at 0)
    trees = []
    for t in city.terrain_tiles():
        j0, i0 = int(round((t['originX'] - minX) / res)), int(round((t['originZ'] - minZ) / res))
        if 0 <= i0 <= H - n and 0 <= j0 <= W - n:  # (tiles outside the frame hold edge buildings' records only)
            cls[i0:i0 + n, j0:j0 + n] = t['cls']
        a0, b0 = int(round((t['originX'] - minX) / cell)), int(round((t['originZ'] - minZ) / cell))
        if 0 <= b0 <= Hc - (N - 1) and 0 <= a0 <= Wc - (N - 1):
            hgt[b0:b0 + N, a0:a0 + N] = t['heights']
        trees += [(x, z, k) for x, z, y, s, k in t['trees'] if minX <= x < maxX and minZ <= z < maxZ]
    return cls, res, np.array(trees, np.float64).reshape(-1, 3), hgt, cell


def thresholds(over, log=_log):
    """QA_DEFAULTS with a city config's "qa": a limit, a floor or how strictly a check measures (TIGHTER) only where the
    config tightens it, and only to a finite number, and never how the city is cut up (FIXED). A refused one keeps its
    default, is logged and is listed in the report: [(key, the config's value, the default)]."""
    Q = dict(QA_DEFAULTS)
    refused = []
    for k, v in over.items():
        if k in FIXED:
            refused.append((k, v, Q[k]))
            log(f'the config\'s "qa" can\'t set how the city is cut up to be measured: {k} {v!r} ignored, {Q[k]!r} stands')
            continue
        if k in TIGHTER and k in Q:
            if k == 'bridgeGate':
                looser = v not in GATE or GATE.index(v) < GATE.index(Q[k])
            else:
                # (a finite real number only: json.load reads NaN, and every comparison with it is false, so it never read
                # as looser and no check could be over again; Infinity is no limit either, and true is an int to Python. An
                # int too large for a float, which json.load reads too, raises in isfinite: refused with them)
                try:
                    finite = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                except OverflowError:
                    finite = False
                looser = not finite or (v - Q[k]) * TIGHTER[k] < 0
            if looser:
                refused.append((k, v, Q[k]))
                log(f'the config\'s "qa" can tighten a limit, never loosen one: {k} {v!r} ignored, {Q[k]!r} stands')
                continue
        Q[k] = v
    return Q, refused


UNIT = {'m': ' m', 'm2': ' m²', 'share': '%', 'count': '', 'ratio': '', 'grade': '%'}


def fmt(v, unit):
    """a check's value with its unit: m and m² as they are, a share or a grade in %, a count, a ratio"""
    if v is None:
        return 'NOT READ'
    if v == float('inf'):
        return 'an id is gone'
    if unit in ('share', 'grade'):
        return f'{v * 100:.2f}%'
    if unit == 'count':
        return f'{int(round(v)):,}'
    if unit == 'ratio':
        return f'{v:.3f}'
    return f'{v:,.2f}{UNIT[unit]}'


def largest_piece(m):
    """(pieces, the largest piece's share of the mask) of a bool mask, 8-connected"""
    from scipy import ndimage
    try:
        lab, n = ndimage.label(m, structure=np.ones((3, 3), bool), output=np.uint16)
    except RuntimeError:  # (more pieces than 16 bits hold)
        lab, n = ndimage.label(m, structure=np.ones((3, 3), bool))
    if not n:
        return 0, 0.0
    sz = np.zeros(n + 1, np.int64)
    for r0 in range(0, lab.shape[0], 512):  # (bincount casts to 64 bits: a block at a time)
        sz += np.bincount(lab[r0:r0 + 512].ravel(), minlength=n + 1)
    del lab
    return int(n), float(sz[1:].max() / max(1, sz[1:].sum()))


def bridge_checks(cfg, city, osm, ground, Q, ll2xz, lonlat, city_dir, log=_log):
    """The fifteen bridge checks of BRIDGES.md section 4 on the baked city: [{key, what, value, unit, limit, count, floor,
    over, read, why, detail, rows}]. Until step 5 the decks drawn are the heroes' (city.json's landmark rows with a deck,
    as Bridges.ts's kits draw them), and the decks of the map are bridges.py's plan. A check with nothing to read (no hero,
    no drawn deck, no bridges.bin yet), or one that fails to read, is NOT READ: value None, never a pass. No check reads a
    coordinate or a city name of its own."""
    import traceback
    import shapely
    from shapely.geometry import LineString, Point
    from shapely.strtree import STRtree
    from scipy.spatial import cKDTree
    import rasterio
    from rasterio.features import rasterize
    import bridges as B
    import osm as O
    man = city.manifest
    minX, minZ, maxX, maxZ = man['bounds']
    out = []

    def check(key, what, unit, limit, floor=1, count_unit='count', lower=False, per=None):
        # (per: a limit that is a multiple of what each thing read has, until it's read: towerOffDeck's, half its deck's width)
        rec = {'key': key, 'what': what, 'unit': unit, 'limit': limit, 'floor': floor, 'countUnit': count_unit, 'lower': lower, 'per': per,
               'value': None, 'count': None, 'over': False, 'read': False, 'failed': False, 'why': '', 'detail': '', 'rows': []}
        out.append(rec)
        return rec

    def done(rec, value, count, detail='', rows=()):
        over = value < rec['limit'] if rec['lower'] else value > rec['limit']
        rec.update(value=float(value), count=count, detail=detail, rows=list(rows), read=True, over=bool(over and count >= rec['floor']))

    def where(x, z):
        la, lo = lonlat(x, z)
        return f'{la:.5f}, {lo:.5f}'

    # ---------------------------------------------------------------- the fifteen, made before anything is read: when
    # what they all read fails, every one is NOT READ and says why, and the QA goes on
    lim = lambda k: Q[k]  # noqa: E731
    c_hero = check('heroOffData', "a hero row's typed point from the OSM row it names", 'm', lim('heroOffDataMax'))
    c_tower = check('towerOffDeck', "a drawn tower's centre from its drawn deck's centre line", 'm', lim('towerOffDeckMax'), per="half its deck's width")
    c_posts = check('deckNoCollision', "a drawn deck's area under no collision post", 'share', lim('deckNoCollisionMax'))
    c_end = check('deckFreeEnd', "a drawn deck's end from the ground, over or under where a kept way meets it, over where none does (no other deck or building by it)",
                  'm', lim('deckFreeEndMax'))
    c_water = check('waterRoadNoDeck', 'real bridge road and rail over water with no deck or ground bridge', 'share', lim('waterRoadNoDeckMax'),
                    lim('waterRoadNoDeckMinM'), 'm')
    c_bridge = check('bridgeNoDeck', 'real bridge road and rail with no deck or ground bridge', 'share', lim('bridgeNoDeckMax'), lim('bridgeNoDeckMinM'), 'm')
    c_bare = check('bareSupports', 'real supports in the water with nothing drawn on them', 'count', lim('bareSupportsMax'))
    c_stand = check('standIns', 'baked buildings of 12 m or more standing mostly on a deck, their top within 15 m of it or over', 'count', lim('standInsMax'))
    c_tall = check('tallNothing', f'towers and masts of {Q["tallNothingHeight"]:.0f} m or more in the data with nothing drawn', 'count', lim('tallNothingMax'))
    c_fig = check('streetFigure', 'the largest street piece drawn, to the largest the full map gives', 'ratio', lim('streetFigureMin'), lower=True)
    c_loss = check('atGradeLoss', "a bridge-flagged way's road surface lost on land, on no bridge, of the road kept", 'share', lim('atGradeLossMax'), 0, 'm2')
    c_decks = [check(key, what, 'm' if k in ('deckContinuityMax', 'deckClearanceMin') else 'share' if k == 'deckBuriedMax' else 'grade', lim(k),
                     lower=k == 'deckClearanceMin')
               for key, what, k in (('deckContinuity', 'two decks of one bridge miss each other (plan or height)', 'deckContinuityMax'),
                                    ('deckClearance', 'two crossing decks stand under this far apart', 'deckClearanceMin'),
                                    ('deckBuried', "a meshed deck's length over 0.5 m under the ground, away from a tunnel", 'deckBuriedMax'),
                                    ('deckSlope', "a road deck's steepest grade between samples", 'deckSlopeMax'))]
    nothing = {'classes': {c: (0, 0.0) for c in B.CLASSES}, 'openSpans': [], 'skipped': 0, 'heroes': {}}

    def failed(e, what):
        for rec in out:
            if not rec['read']:
                rec.update(failed=True, why=f'failed to read: {e!r}'[:240])
        log(f'bridges: {what} failed: ' + traceback.format_exc().strip().splitlines()[-1])

    # ---------------------------------------------------------------- what they read
    try:
        kept = osm.segments()
        di, gi = osm.read('infrastructure')
        idx = {B.osm_ref(v): i for i, v in enumerate(di['osm_id'])} if di is not None else {}
        itags = [B.tags_of(t) for t in di['tags']] if di is not None else []
        pids = {lm['kind']: lm.get('pointIds') for lm in cfg.get('landmarks', [])}
        drawn = []  # the decks drawn today: the heroes' kits, along their rows' deck lists
        for lm in man.get('landmarks', []):
            if lm.get('deck') and lm['kind'] in B.HERO_KIT and len(lm['deck']) >= 2:
                xyz = np.array(lm['deck'], float)
                ids = pids.get(lm['kind'])
                pts = [tuple(p) for p in lm.get('points', [])]
                tw = [p for p, oid in zip(pts, ids or ()) if oid in idx and B.is_tower(itags[idx[oid]])] if ids and len(ids) == len(pts) else None
                drawn.append({'kind': lm['kind'], 'line': LineString(xyz[:, :2]), 'xyz': xyz, 'half': B.HERO_KIT[lm['kind']]['half'], 'points': pts,
                              'ids': ids, 'towers': tw, 'supports': lm.get('supports', [])})
        foot = [h['line'].buffer(h['half'], cap_style='flat') for h in drawn]
        feet = shapely.unary_union(foot) if foot else None
        if feet is not None:
            shapely.prepare(feet)
        plan = B.plan(osm, ground, kept, B.hero_rows(man), log=lambda m: log('bridges: ' + m))
        decks = plan['decks']
        meshed = [d for d in decks if d['cls'] != 'S' and not d['skip']]
        ways = [w for w in plan['ways'] if w['use'] in ('road', 'rail')]
    except Exception as e:  # noqa: BLE001 (it never stops the QA: a bridges.py that throws on a city's data reports, in report mode too)
        failed(e, 'what the checks read (the extract, bridges.py\'s plan)')
        return out, nothing
    bbin = os.path.join(city_dir, 'bridges.bin')

    def guarded(rec, fn):
        try:
            fn(rec)
        except Exception as e:  # noqa: BLE001 (a check that can't be read says so; it never stops the QA)
            rec.update(read=False, value=None, failed=True, why=f'failed to read: {e!r}'[:240])
            log(f'{rec["key"]}: ' + traceback.format_exc().strip().splitlines()[-1])

    # ---------------------------------------------------------------- the heroes, against the map
    def hero_off(rec):
        rows = [lm for lm in cfg.get('landmarks', []) if lm.get('points')]
        if not rows:
            return rec.update(why='no hero row with typed points in the config')
        bad = [lm['kind'] for lm in rows if len(lm.get('pointIds') or ()) != len(lm['points'])]
        if bad:
            return rec.update(why='no OSM id for each typed point (pointIds): ' + ', '.join(bad))
        res = []
        for lm in rows:
            for k, ((la, lo), oid) in enumerate(zip(lm['points'], lm['pointIds'])):
                p = Point(ll2xz(lo, la))
                i = idx.get(oid)
                res.append((float('inf') if i is None else float(shapely.distance(shapely.centroid(gi[i]), p)), lm['kind'], k, oid, p))
        nover = sum(1 for r in res if r[0] > rec['limit'])
        done(rec, max(r[0] for r in res), nover, f'{len(res)} typed points in {len(rows)} hero rows, from the centre of the row each names',
             [f'{kd} point {k} {oid} at {where(p.x, p.y)}: ' + (f'{v:.2f} m' if v != float('inf') else 'gone from the extract')
              for v, kd, k, oid, p in sorted(res, key=lambda r: -r[0])])

    def tower_off(rec):
        if not drawn:
            return rec.update(why='no drawn deck (a hero row with a deck)')
        if any(h['towers'] is None for h in drawn):
            return rec.update(why='a drawn deck whose hero row has no OSM id for each typed point: its towers are unknown')
        res = [(h['line'].distance(Point(p)) / (h['half'] * Q['towerOffDeckMax']), h['line'].distance(Point(p)), h['half'] * Q['towerOffDeckMax'], h['kind'], p)
               for h in drawn for p in h['towers']]
        if not res:
            return rec.update(why='no drawn tower stands on a drawn deck')
        worst = max(res)
        rec['limit'] = worst[2]  # (each tower's own: half its deck's width)
        done(rec, worst[1], sum(1 for r in res if r[0] > 1), f'{len(res)} drawn towers; the limit is half the deck\'s width under each',
             [f'{kd} tower at {where(*p)}: {d:.2f} m from the deck\'s centre, half its width {lim:.1f} m' for _, d, lim, kd, p in sorted(res, reverse=True)])

    def no_collision(rec):
        if not drawn:
            return rec.update(why='no drawn deck (a hero row with a deck)')
        res = []
        for h in drawn:
            xyz = h['xyz']
            seg = np.hypot(*np.diff(xyz[:, :2], axis=0).T)
            st = np.r_[0.0, np.cumsum(seg)]
            L = float(st[-1])
            # (the posts as Bridges.ts deckPosts lays them: every 12 m or less, half the width + 6 m round; the towers' r 30)
            n = int(math.ceil(L / 12))
            sk = np.arange(n + 1) / n * L
            posts = np.column_stack([np.interp(sk, st, xyz[:, 0]), np.interp(sk, st, xyz[:, 1])])
            # (the deck's area on a 1 m grid in its own frame: along its line, across its width)
            s, p, t = B.frames_along(h['line'], 1.0)
            o = np.arange(-h['half'] + 0.5, h['half'], 1.0)
            nrm = np.column_stack([-t[:, 1], t[:, 0]])
            g = (p[:, None, :] + nrm[:, None, :] * o[None, :, None]).reshape(-1, 2)
            cov = cKDTree(posts).query(g)[0] <= h['half'] + 6.0
            if h['towers']:
                cov |= cKDTree(np.array(h['towers'])).query(g)[0] <= 30.0
            res.append((1.0 - float(cov.mean()), h['kind'], len(g), len(posts)))
        done(rec, max(r[0] for r in res), sum(1 for r in res if r[0] > rec['limit']), f'{len(res)} drawn decks on a 1 m grid',
             [f'{kd}: {v * 100:.3f}% of {n:,} grid points under no post ({m} deck posts)' for v, kd, n, m in res])

    def free_end(rec):
        if not drawn:
            return rec.update(why='no drawn deck (a hero row with a deck)')
        kt = STRtree([q[0] for q in kept]) if kept else None
        res = []
        for h in drawn:
            for e in (h['xyz'][0], h['xyz'][-1]):
                p = Point(e[:2])
                way = kt is not None and len(kt.query(p, predicate='dwithin', distance=12.0)) > 0
                deck = any(o['line'].distance(p) <= 12.0 for o in drawn if o is not h)
                bld = bool(ground.in_building([e[:2]], reach=12.0)[0])
                gy = float(ground.at([e[:2]])[0][0])
                # (a kept way within 12 m is why an end should land, not a pass, and landing is both ways: its top is measured
                # from the ground over or under, as one sunk under its road at grade breaks the road as one over it does. An
                # open end only over: under the ground, the ground covers it, and how much of a deck runs buried is
                # deckBuried's, from step 5. Only an end another deck or a building takes over isn't, nor one off the frame,
                # its ground unknown)
                d = None if deck or bld or not math.isfinite(gy) else e[2] - gy
                res.append((None if d is None else abs(d) if way else d, d, h['kind'], e, gy, way, deck, bld))
        free = [r for r in res if r[0] is not None]
        done(rec, max([r[0] for r in free], default=0.0), sum(1 for r in free if r[0] > rec['limit']),
             f'{len(free)} of {len(res)} drawn deck ends measured, {sum(1 for r in free if r[5])} of them where a kept way meets them and they should land, over or under',
             [f'{kd} end at {where(*e[:2])}: top {e[2]:.1f} m, ground {gy:.1f} m' + (f', {abs(d):.1f} m {"over" if d >= 0 else "under"} it, ' + ('a kept way within 12 m: it should land' if w else 'free')
              if d is not None else ': ' + (', '.join(n for n, b in (('a deck', dk), ('a building', b_)) if b) + ' within 12 m' if dk or b_ else 'off the frame'))
              for _, d, kd, e, gy, w, dk, b_ in res])

    # ---------------------------------------------------------------- the map's bridges, against what's drawn
    def samples():
        pts, wt, wi = [], [], []
        for k, w in enumerate(ways):
            L = w['line'].length
            n = max(1, int(math.ceil(L / 2.0)))
            pts.append(shapely.get_coordinates(shapely.line_interpolate_point(w['line'], (np.arange(n) + 0.5) * L / n)))
            wt.append(np.full(n, L / n))
            wi.append(np.full(n, k))
        p, wt, wi = np.vstack(pts), np.concatenate(wt), np.concatenate(wi)
        ok = ground.inside(p)
        p, wt, wi = p[ok], wt[ok], wi[ok]
        cov = shapely.contains_xy(feet, p[:, 0], p[:, 1]) if feet is not None else np.zeros(len(p), bool)
        return p, wt, ground.at(p)[1], cov, wi

    def water_road(rec):
        if not ways:
            return rec.update(why='no bridge road or rail in the frame')
        p, wt, wet, cov, wi = samples()
        tot = float(wt[wet].sum())
        if tot <= 0:
            return rec.update(why='no bridge road or rail over the baked water')
        m = wet & ~cov
        un = float(wt[m].sum())
        # (by name: each named bridge's metres over water with no deck, and where its longest way is)
        by = {}
        for k in np.unique(wi[m]):
            w = ways[int(k)]
            r = by.setdefault(w['name'] or '(unnamed)', [0.0, 0.0, None])
            r[0] += float(wt[m & (wi == k)].sum())
            if w['line'].length > r[1]:
                r[1], r[2] = w['line'].length, w['line'].interpolate(0.5, normalized=True)
        done(rec, un / tot, un, f'{un:,.0f} of {tot:,.0f} m of real bridge road and rail over water under no deck or ground bridge',
             [f'{nm}: {v:,.0f} m, at {where(c.x, c.y)}' for nm, (v, _, c) in sorted(by.items(), key=lambda q: -q[1][0])])

    def bridge_no_deck(rec):
        if not ways:
            return rec.update(why='no bridge road or rail in the frame')
        p, wt, wet, cov, wi = samples()
        tot = float(wt.sum())
        un = float(wt[~cov].sum())
        done(rec, un / tot, un, f'{un:,.0f} of {tot:,.0f} m of real bridge road and rail in the frame under no deck or ground bridge')

    def bare_supports(rec):
        sups = [s for s in plan['supports'] if s['area'] >= 50 and s['g'].geom_type in ('Polygon', 'MultiPolygon')]
        if not sups:
            return rec.update(why='no bridge support or pier of 50 m² or more in the frame')
        big = [d for d in decks if d['cls'] in ('L', 'XL')]
        bt = STRtree([d['line'] for d in big]) if big else None
        cand = []
        for s in sups:
            c = shapely.centroid(s['g'])
            r = math.sqrt(s['area'] / math.pi) + 8
            ring = [(c.x + dx * r, c.y + dz * r) for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1), (.7, .7), (-.7, -.7), (.7, -.7), (-.7, .7))]
            if int(ground.at(ring)[1].sum()) < 5:
                continue  # (not standing in the water)
            if s['kind'] == 'pier':
                # (a harbour pier is no support: only one an L or XL deck stands high over)
                if bt is None or not any(big[j]['line'].distance(c) <= 8 and big[j]['y'][int(np.argmin(np.hypot(*(big[j]['xz'] - [c.x, c.y]).T)))] >= 8
                                         for j in bt.query(c, predicate='dwithin', distance=8)):
                    continue
            cand.append((s['area'], c, s))
        one = []
        for a, c, s in sorted(cand, key=lambda q: -q[0]):
            if all(c.distance(q[1]) > 40 for q in one):
                one.append((a, c, s))
        bare = []
        for a, c, s in one:
            on = any(math.hypot(c.x - p[0], c.y - p[1]) <= 30 for h in drawn for p in h['points'])
            on = on or (feet is not None and feet.contains(c))
            on = on or any(math.hypot(c.x - b[0], c.y - b[1]) <= math.hypot(b[2], b[3]) / 2 + 5 for h in drawn for b in h['supports'])
            if not on:
                bare.append((a, c, s))
        done(rec, len(bare), len(bare), f'{len(one)} real supports stand in the water; {len(bare)} with nothing drawn on them',
             [f'{s["osm"]} {s["name"] or s["tags"].get("ref") or ""} ({s["kind"]}, {a:,.0f} m²) at {where(c.x, c.y)}' for a, c, s in bare])

    def stand_ins(rec):
        if not meshed:
            return rec.update(why='no meshed deck in the map')
        polys = [shapely.buffer(d['line'], max(1.5, d['width'] / 2), cap_style='flat') for d in meshed]
        dt = STRtree(polys)
        T_ = man['tileSize']
        near = set()
        for q in polys:
            x0, z0, x1, z1 = q.bounds
            near |= {(tx, tz) for tx in range(int((x0 - 40) // T_), int((x1 + 40) // T_) + 1) for tz in range(int((z0 - 40) // T_), int((z1 + 40) // T_) + 1)}
        found = {}
        for t in city.building_tiles(near):
            vs, xz = t['vertStart'], t['xz']
            for i in range(t['count']):
                top, grd = float(t['roofY'][i]), float(t['groundY'][i])
                if top - grd < 12 or vs[i + 1] - vs[i] < 3:
                    continue
                q = shapely.make_valid(shapely.Polygon(xz[vs[i]:vs[i + 1]]))
                hit = dt.query(q, predicate='intersects')
                if not len(hit) or q.area <= 0:
                    continue
                ov, j = max((shapely.intersection(q, polys[j]).area / q.area, j) for j in hit)
                c = shapely.get_coordinates(shapely.centroid(q))[0]
                d = meshed[j]
                deck = float(d['y'][int(np.argmin(np.hypot(*(d['xz'] - c).T)))])
                if ov >= 0.5 and top >= deck - 15:
                    sid = int(t['stableId'][i])
                    if sid not in found or found[sid][0] < top:
                        found[sid] = (top, grd, deck, c, int(t['source'][i]) & 7, d['name'])
        src = lambda k: ('OSM', 'Overture', 'USA Structures', 'LiDAR')[k] if k < 4 else str(k)  # noqa: E731 (bake.py's sources)
        by = {}
        for v in found.values():
            by[src(v[4])] = by.get(src(v[4]), 0) + 1
        done(rec, len(found), len(found), f'{len(found)} buildings' + (f' ({", ".join(f"{n} {k}" for k, n in sorted(by.items()))})' if by else '') + f' on {len(meshed)} meshed decks of the map, '
             'their tops by the rule (no LiDAR until step 5)',
             [f'{src(s_)} at {where(*c)}: top {top:.1f} m, ground {g:.1f} m, the deck {dk:.1f} m ({nm or "unnamed"})'
              for top, g, dk, c, s_, nm in sorted(found.values(), key=lambda v: -v[0])])

    def tall_nothing(rec):
        if di is None:
            return rec.update(why='no infrastructure theme in the extract')
        TALL = {'tower', 'mast', 'chimney', 'flagpole', 'water_tower', 'lighthouse', 'crane'}
        cand, blind = [], 0
        for i, row in enumerate(di.itertuples(index=False)):
            t = itags[i]
            if row.subtype == 'bridge' or not (t.get('man_made') in TALL or row.subtype in ('tower', 'communication') or t.get('tower:type')):
                continue
            h = row.height
            if h is None or h != h:
                blind += 1
                continue
            if h >= Q['tallNothingHeight']:
                cand.append((float(h), B.osm_ref(row.osm_id), row.name or '', row.klass, shapely.get_coordinates(shapely.centroid(gi[i]))[0]))
        hero_ids = {oid for lm in cfg.get('landmarks', []) for oid in (lm.get('pointIds') or ())}
        lms = [(l['x'], l['z']) for l in man.get('landmarks', [])]
        near = set()
        for c in cand:
            near |= city.tiles_around(c[4][0], c[4][1], 40)
        parts = []
        for t in city.building_tiles(near):
            vs, xz = t['vertStart'], t['xz']
            parts += [(shapely.Polygon(xz[vs[i]:vs[i + 1]]), float(t['roofY'][i]) - float(t['groundY'][i])) for i in range(t['count']) if vs[i + 1] - vs[i] >= 3]
        pt = STRtree([q for q, _ in parts]) if parts else None
        missing = []
        for h, oid, nm, kl, p in cand:
            ok = oid in hero_ids or any(math.hypot(p[0] - x, p[1] - z) < 30 for x, z in lms)
            best = max((parts[j][1] for j in pt.query(Point(p), predicate='dwithin', distance=15.0)), default=0.0) if pt is not None else 0.0
            if not ok and best < 0.7 * h:
                missing.append((h, oid, nm, kl, p, best))
        done(rec, len(missing), len(missing), f'{len(cand)} towers and masts of {Q["tallNothingHeight"]:.0f} m or more in the data; {blind} with no height can\'t be judged',
             [f'{oid} {nm or "(unnamed)"} ({kl}, {h:.0f} m) at {where(*p)}: the tallest drawn within 15 m {b:.1f} m' for h, oid, nm, kl, p, b in missing])

    # ---------------------------------------------------------------- the street map: drawn, and what the full map gives
    def streets(rec_fig, rec_loss):
        H, W = ground.cls.shape
        aff = rasterio.Affine(ground.res, 0, minX, 0, ground.res, minZ)

        def rast(shapes):
            shapes = [(q, 1) for q in shapes if q is not None and not q.is_empty]
            return rasterize(shapes, out_shape=(H, W), transform=aff, fill=0, dtype=np.uint8).view(bool) if shapes else np.zeros((H, W), bool)
        VEH = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service', 'unknown'}
        kv = [q for q in kept if q[1] == PAVED and q[4] in VEH]
        if not kv:
            for r in (rec_fig, rec_loss):
                r.update(why='no street drawn in the frame')
            return
        K = rast(shapely.buffer(np.array([q[0] for q in kv], dtype=object), np.array([q[2] for q in kv]) / 2, cap_style='flat'))
        nK = int(K.sum())
        # (every vehicular segment, sized as OSM.segments() sizes it; the ones it leaves out, in whole or in part)
        d, g = osm.read('segment', O.SEGMENT_COLUMNS)
        P = osm.P
        full, flagged = [], []
        for i, row in enumerate(d.itertuples(index=False)):
            cl = O.sv(row.klass) or 'unknown'
            if O.sv(row.subtype) != 'road' or cl not in VEH or g[i] is None or g[i].geom_type != 'LineString':
                continue
            fl = set(O.sv(row.road_flags).split(',')) | set(O.sv(row.rail_flags).split(','))
            lv = row.level_max
            if not (fl & O.OFF_GROUND or (lv is not None and lv == lv and int(lv) != 0)) or fl & {'is_tunnel', 'is_indoor'}:
                continue
            w = O.num(row.width)
            if w is None or w < 2.0:
                sub = O.sv(row.subclass)
                w = P['linkWidth'] if sub == 'link' else P['serviceWidth'][sub] if cl == 'service' and sub in P['serviceWidth'] else P['roadWidth'].get(cl, P['roadWidth']['unknown'])
            full.append((g[i], w))
            if 'is_bridge' in fl:
                flagged.append((g[i], w))
        del d, g
        # atGradeLoss: the bridge-flagged road the bake leaves out, on land and on no real bridge (6 m of a bridge way, 2 m of its polygon)
        D = rast(shapely.buffer(np.array([q[0] for q in flagged], dtype=object), np.array([q[1] for q in flagged]) / 2, cap_style='flat')) if flagged else np.zeros((H, W), bool)
        D[K] = False
        br = [gi[i] for i, row in enumerate(di.itertuples(index=False)) if row.subtype == 'bridge' and row.klass in ('bridge', 'viaduct', 'movable')] if di is not None else []
        if br:
            ba = np.array(br, dtype=object)
            R = rast(shapely.buffer(ba, np.where(shapely.get_type_id(ba) == 1, 6.0, 2.0)))
            D[R] = False
            del R
        D[ground.cls == WATER] = False
        lost = int(D.sum())
        del D
        a = ground.res ** 2
        done(rec_loss, lost / max(1, nK), lost * a, f'{lost * a / 1e4:,.2f} ha lost of {nK * a / 1e4:,.2f} ha of road kept')
        # streetFigure: the largest piece of the road the bake drew, to the largest the full map gives in the same frame
        K &= ground.cls == PAVED
        n0, s0 = largest_piece(K)
        F = rast(shapely.buffer(np.array([q[0] for q in full], dtype=object), np.array([q[1] for q in full]) / 2, cap_style='flat')) if full else np.zeros((H, W), bool)
        F |= K
        del K
        n1, s1 = largest_piece(F)
        del F
        done(rec_fig, s0 / max(1e-9, s1), 1, f'drawn: {n0:,} pieces, the largest {s0 * 100:.1f}% of the road; the full map: {n1:,} pieces, the largest {s1 * 100:.1f}%')

    # ---------------------------------------------------------------- the decks as baked: bridges.bin, step 5's
    def baked_decks(rec):
        rec.update(why='reads the decks as baked, bridges.bin: ' + ('no reader for it yet' if os.path.exists(bbin) else 'none in the city dir until step 5'))

    for rec, fn in ((c_hero, hero_off), (c_tower, tower_off), (c_posts, no_collision), (c_end, free_end), (c_water, water_road),
                    (c_bridge, bridge_no_deck), (c_bare, bare_supports), (c_stand, stand_ins), (c_tall, tall_nothing)):
        guarded(rec, fn)
    try:
        streets(c_fig, c_loss)
    except Exception as e:  # noqa: BLE001
        for r in (c_fig, c_loss):
            if not r['read']:
                r.update(failed=True, why=f'failed to read: {e!r}'[:240])
        log('streets: ' + traceback.format_exc().strip().splitlines()[-1])
    for rec in c_decks:
        guarded(rec, baked_decks)
    try:
        spans = [(round(d['length']), d['name'] or '(unnamed)', where(*d['xz'][len(d['xz']) // 2])) for d in B.open_spans(decks)]
        classes = {c: (sum(1 for d in decks if d['cls'] == c and not d['skip']), round(sum(d['length'] for d in decks if d['cls'] == c and not d['skip']) / 1000, 2))
                   for c in B.CLASSES}
        return out, {'classes': classes, 'openSpans': spans, 'skipped': sum(1 for d in decks if d['skip']),
                     'heroes': {h: sorted({i for d in decks if d['hero'] == h for i in d['ids']}) for h in {d['hero'] for d in decks if d['hero']}}}
    except Exception:  # noqa: BLE001 (the plan's summary, for the report: the checks stand without it)
        log('bridges: the plan\'s summary failed: ' + traceback.format_exc().strip().splitlines()[-1])
        return out, nothing


def open_spaces(osm, frame, n):
    """the n largest parks and open spaces in the frame (OSM land use and land, LU_OPEN / LAND_OPEN), the same place mapped
    twice once: [{name, class, geom}] (the report's crops, and tour.py's)"""
    import shapely
    import osm as O
    cand = []
    for typ, classes in (('land_use', LU_OPEN), ('land', LAND_OPEN)):
        dd, gg = osm.read(typ)
        if dd is None:
            continue
        for i, row in enumerate(dd.itertuples(index=False)):
            if row.klass not in classes or gg[i] is None or gg[i].geom_type not in ('Polygon', 'MultiPolygon'):
                continue
            try:
                g = shapely.make_valid(gg[i]).intersection(frame)
            except shapely.errors.GEOSException:
                continue
            if g.is_empty or g.area < 1e4:
                continue
            nm = O.sv(getattr(row, 'name', None)) or f'{row.klass} (unnamed)'
            cand.append((g.area, nm, row.klass, g))
    cand.sort(key=lambda c: -c[0])
    parks = []
    for a, nm, kl, g in cand:
        if len(parks) >= n:
            break
        if any(g.intersection(p['geom']).area / max(1.0, g.union(p['geom']).area) >= 0.6 for p in parks):
            continue  # (the same place mapped twice)
        parks.append({'name': nm, 'class': kl, 'geom': g})
    return parks


def run(slug, city_dir, log=_log, crops=None):
    """The QA of the baked city in city_dir (config tools/bake/cities/<slug>.json). True = PASS."""
    from pyproj import Transformer
    from scipy import ndimage
    from scipy.spatial import cKDTree
    import shapely
    from shapely.geometry import box
    from citydata import City
    import bridges as B
    import osm as O
    import worldcover as WCm

    t0 = time.time()
    name = os.path.basename(os.path.normpath(city_dir))
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json')))
    Q, refused = thresholds(cfg.get('qa', {}), log)
    if crops is not None:
        Q['crops'] = crops
    out = os.path.join(HERE, '.cache', 'qa', name)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.png') or f == 'report.md':
            os.remove(os.path.join(out, f))
    city = City(city_dir)
    man = city.manifest
    proj = man['proj']
    minX, minZ, maxX, maxZ = man['bounds']
    to_local = Transformer.from_crs('EPSG:4326', proj, always_xy=True)
    inv = Transformer.from_crs(proj, 'EPSG:4326', always_xy=True)

    def lonlat(x, z):
        lo, la = inv.transform(x, -z)
        return float(la), float(lo)

    def ll2xz(lon, lat):
        e, n = to_local.transform(lon, lat)
        return float(e), -float(n)

    cls, res2, T, hgt, cell = load_city(city)
    osm = O.OSM(cfg, slug, to_local, lambda *a: None)
    osm.set_frame(minX, minZ, maxX, maxZ)
    # ---------------------------------------------------------------- bridges (they read the bake, the extract and the config,
    # not WorldCover: a city baked without it gets them too)
    bridge, bplan = bridge_checks(cfg, city, osm, B.Ground(man['bounds'], cls, res2, hgt, cell, city), Q, ll2xz, lonlat, city_dir, log)
    del hgt
    bfailed = [c['key'] for c in bridge if gate_fails(c, Q['bridgeGate'])]
    for c in bridge:
        log(bridge_line(c, Q['bridgeGate']))
    if cfg.get('worldcover', True) is False:
        log('the rest skipped: the config bakes without WorldCover ("worldcover": false), the reference of the QA')
        summary = {'pass': not bfailed, 'failed': bfailed, 'bridgeGate': Q['bridgeGate'], 'bridges': bridge_summary(bridge),
                   'report': os.path.relpath(os.path.join(out, 'report.md'), ROOT).replace('\\', '/')}
        with open(os.path.join(out, 'report.md'), 'w', encoding='utf-8') as f:
            f.write('\n'.join([f'# Bake QA: {name} ({man.get("name", slug)}): bridges only', '', 'The config bakes without WorldCover, the '
                               'reference of the other checks.', ''] + bridge_section(bridge, bplan, Q, refused)))
        mp = os.path.join(city_dir, 'city.json')
        m2 = json.load(open(mp))
        m2.setdefault('stats', {})['qa'] = summary
        with open(mp, 'w') as f:
            json.dump(m2, f)
        return not bfailed
    # mapped (OSM natural=tree / tree_row) or procedural: the baked position is the mapped one to the decimetre
    mapped = np.array([(x, z) for x, z, k, s in osm.trees()], np.float64).reshape(-1, 2)
    src = np.where(T[:, 2] == 0, 2, 1).astype(np.int8)  # 0 mapped, 1 park / woods, 2 street
    if len(mapped) and len(T):
        d, _ = cKDTree(mapped).query(T[:, :2])
        src[d < 0.2] = 0

    # WorldCover on the frame at wcRes; the baked classes sampled on the same grid
    r = float(Q['wcRes'])
    step = int(round(r / res2))
    W4, H4 = int(round((maxX - minX) / r)), int(round((maxZ - minZ) / r))
    wc = WCm.local_grid(slug, proj, minX, minZ, W4, H4, r, extra_bounds=[tuple(cfg['bbox'])], log=log)
    cls4 = cls[::step, ::step][:H4, :W4]
    k = int(round(Q['support'] / r))
    wtree = WCm.tree_mask(wc)  # (tree cover + mangroves)
    sup = ndimage.maximum_filter(wtree.astype(np.uint8), size=2 * k + 1) > 0

    def at4(x, z):
        return (np.clip(((z - minZ) / r).astype(int), 0, H4 - 1), np.clip(((x - minX) / r).astype(int), 0, W4 - 1))
    ti, tj = at4(T[:, 0], T[:, 1])
    tsup = sup[ti, tj] if len(T) else np.zeros(0, bool)

    # ---------------------------------------------------------------- cells
    b = int(round(Q['cell'] / r))
    ny, nx = H4 // b, W4 // b
    cell_ha = Q['cell'] ** 2 / 1e4
    wc_ok = wc != 0
    w_wc = share(wc == WCm.WATER, b)
    w_b = share((cls4 == WATER) | ((cls4 == PLAZA) & (wc == WCm.WATER)), b)  # (a pier deck over the water is water)
    land_b = 1.0 - share(cls4 == WATER, b)
    wc_land = share(wc_ok & (wc != WCm.WATER), b)
    wct = share(wtree, b) / np.maximum(wc_land, 1e-6)  # WorldCover tree cover of the land
    # what the map lets WorldCover plant (osm.tree_codes: parks, woods, open space; not scrub / heath, pitches, beaches...)
    codes = osm.tree_raster(H4, W4, minX, minZ, r)
    allow = share(np.isin(codes, (O.TREE_PARK, O.TREE_WOODS, O.TREE_OPEN)), b)
    shrub = share(codes == O.TREE_SHRUB, b)
    del codes
    green = share(np.isin(cls4, (GRASS, FOREST)), b) / np.maximum(land_b, 1e-6)
    sand_b = share(cls4 == SAND, b)
    bare_wc = share(wc == WCm.BARE, b)
    gr_abs = share(np.isin(cls4, (GRASS, FOREST)), b)
    del wc_ok
    ci = np.clip((T[:, 1] - minZ) // Q['cell'], 0, ny - 1).astype(int) if len(T) else np.zeros(0, int)
    cj = np.clip((T[:, 0] - minX) // Q['cell'], 0, nx - 1).astype(int) if len(T) else np.zeros(0, int)
    cid = ci * nx + cj

    def per_cell(m):
        return np.bincount(cid[m], minlength=ny * nx).reshape(ny, nx)
    n_all = per_cell(np.ones(len(T), bool))
    # the checks weigh the procedural park / woods trees; street trees along frontages are reported beside the
    # mapped street trees (WorldCover's 10 m pixels miss most single street trees, mapped or not)
    proc = src == 1
    unsup = proc & ~tsup
    n_uns = per_cell(unsup)
    street = src == 2
    mstreet = (src == 0) & (T[:, 2] == 0) if len(T) else np.zeros(0, bool)
    land_cells = land_b >= 0.2
    flags = []

    def cell_desc(i, j):
        s4 = (slice(i * b, (i + 1) * b), slice(j * b, (j + 1) * b))
        return f'bake: {top_classes(cls4[s4], CLASS_NAME)}; WorldCover: {top_classes(wc[s4], WC_NAME)}'

    # trees on open land
    for i, j in zip(*np.nonzero(land_cells & (n_uns >= Q['openCellTrees']))):
        flags.append(('trees on open land', float(n_uns[i, j]), i, j,
                      f'{n_uns[i, j]} procedural park / woods trees with no '
                      f'WorldCover tree cover within {Q["support"]:.0f} m; WorldCover tree cover {wct[i, j] * 100:.0f}% of the land; '
                      + cell_desc(i, j)))
    # missing trees: a park / wood WorldCover sees wooded, left bare
    wooded = land_cells & (green >= 0.6) & (wct >= Q['woodCover']) & (land_b * cell_ha >= 0.5) & (allow >= 0.5)
    # (not a failure: WorldCover's tree class over OSM's scrub / heath, its shrub-as-tree confusion, left unplanted)
    shrub_wc = land_cells & (green >= 0.6) & (wct >= Q['woodCover']) & (shrub >= 0.5)
    per_ha = n_all / np.maximum(land_b * cell_ha, 1e-6)
    for i, j in zip(*np.nonzero(wooded & (per_ha < Q['woodPerHa']))):
        flags.append(('missing trees', float(wct[i, j] * land_b[i, j] * cell_ha * 70 - n_all[i, j]), i, j,
                      f'WorldCover tree cover {wct[i, j] * 100:.0f}% on grass / woods ({green[i, j] * 100:.0f}% of the land) but '
                      f'{n_all[i, j]} trees ({per_ha[i, j]:.1f} / ha); ' + cell_desc(i, j)))
    # water
    dw = w_b - w_wc
    for i, j in zip(*np.nonzero(np.abs(dw) >= Q['waterDiff'])):
        what = ('land in the bake where WorldCover sees water (a tidal marsh or flat, a lake or a channel OSM draws as land?)'
                if dw[i, j] < 0 else 'water in the bake where WorldCover sees land (a missing land polygon, a coastline, fill?)')
        flags.append(('water', float(abs(dw[i, j]) * cell_ha), i, j,
                      f'{what}: baked water {w_b[i, j] * 100:.0f}%, WorldCover water {w_wc[i, j] * 100:.0f}%; ' + cell_desc(i, j)))
    # sand
    s1 = land_cells & (sand_b >= Q['sandDiff']) & (bare_wc + w_wc < 0.1)
    s2 = land_cells & (bare_wc >= Q['sandDiff']) & (gr_abs >= Q['sandDiff']) & (sand_b < 0.1)
    for i, j in zip(*np.nonzero(s1 | s2)):
        what = (f'sand in the bake ({sand_b[i, j] * 100:.0f}%) where WorldCover sees neither bare ground nor water'
                if s1[i, j] else f'WorldCover sees bare ground / sand ({bare_wc[i, j] * 100:.0f}%) where the bake has grass or woods')
        flags.append(('sand', float(max(sand_b[i, j], bare_wc[i, j]) * cell_ha), i, j, what + '; ' + cell_desc(i, j)))

    kinds = ('trees on open land', 'missing trees', 'water', 'sand')
    nflag = {kd: sum(1 for f in flags if f[0] == kd) for kd in kinds}
    nland = int(land_cells.sum())
    nproc = int(proc.sum())
    # (key, what, share, max share, detail, count, min count): a FAIL needs both over
    mc, mt = int(Q['minFlagged']), int(Q['minUnsupported'])
    checks = [
        ('unsupported', 'procedural park / woods trees with no WorldCover tree cover within %.0f m' % Q['support'],
         int(unsup.sum()) / max(1, nproc), Q['unsupportedMax'], f'{int(unsup.sum()):,} of {nproc:,}', int(unsup.sum()), mt),
        ('openCells', f'land cells with trees on open land (>= {Q["openCellTrees"]} unsupported park / woods trees)',
         nflag['trees on open land'] / max(1, nland), Q['openCellsMax'], f'{nflag["trees on open land"]} of {nland:,}', nflag['trees on open land'], mc),
        ('woodCells', f'wooded park / wood cells (WorldCover >= {Q["woodCover"] * 100:.0f}%) with < {Q["woodPerHa"]:.0f} trees / ha',
         nflag['missing trees'] / max(1, int(wooded.sum())), Q['woodCellsMax'], f'{nflag["missing trees"]} of {int(wooded.sum()):,}', nflag['missing trees'], mc),
        ('waterCells', f'cells whose baked water differs from WorldCover water by >= {Q["waterDiff"] * 100:.0f}% of the cell',
         nflag['water'] / max(1, ny * nx), Q['waterCellsMax'], f'{nflag["water"]} of {ny * nx:,}', nflag['water'], mc),
        ('sandCells', 'land cells whose sand disagrees with WorldCover bare ground',
         nflag['sand'] / max(1, nland), Q['sandCellsMax'], f'{nflag["sand"]} of {nland:,}', nflag['sand'], mc),
    ]
    failed = [c[0] for c in checks if c[2] > c[3] and c[5] >= c[6]] + bfailed
    ok = not failed

    # ---------------------------------------------------------------- trees overall
    land4 = cls4 != WATER
    tre4 = wtree
    sup4 = sup[:ny * b, :nx * b]
    ha_tree = float((land4 & sup4).sum()) * r * r / 1e4
    ha_open = float((land4 & ~sup4).sum()) * r * r / 1e4
    nsrc = {kd: int((src == v).sum()) for kd, v in (('mapped', 0), ('park', 1), ('street', 2))}
    tree_stats = {
        **nsrc,
        'wcTreeCover': round(float((land4 & tre4).sum()) / max(1, int(land4.sum())), 4),
        'perHaNearWcTrees': round(float((proc & tsup).sum()) / max(ha_tree, 1e-6), 2),
        'perHaOpen': round(float(unsup.sum()) / max(ha_open, 1e-6), 2),
        'unsupportedPark': int(unsup.sum()), 'unsupportedStreet': int((street & ~tsup).sum()),
        # (reported, not checked: the procedural street trees' unsupported share beside the mapped street trees')
        'streetUnsupported': round(float((street & ~tsup).sum()) / max(1, int(street.sum())), 4),
        'mappedStreet': int(mstreet.sum()),
        'mappedStreetUnsupported': round(float((mstreet & ~tsup).sum()) / max(1, int(mstreet.sum())), 4),
        'scrubWoodedCells': int(shrub_wc.sum()),
    }
    del land4, tre4, sup4
    scrub_cells = sorted(zip(*np.nonzero(shrub_wc)), key=lambda c: -wct[c])
    scrub_ex = [(*lonlat(minX + (j + 0.5) * Q['cell'], minZ + (i + 0.5) * Q['cell']), float(wct[i, j])) for i, j in scrub_cells[:5]]

    # ---------------------------------------------------------------- parks / open spaces
    parks = open_spaces(osm, box(minX, minZ, maxX, maxZ), Q['crops'])
    from rasterio.features import rasterize
    import rasterio
    for p in parks:
        g = p['geom']
        x0, z0, x1, z1 = g.bounds
        j0, i0 = max(0, int((x0 - minX) // r)), max(0, int((z0 - minZ) // r))
        j1, i1 = min(W4, int((x1 - minX) // r) + 1), min(H4, int((z1 - minZ) // r) + 1)
        pm = rasterize([(g, 1)], out_shape=(i1 - i0, j1 - j0), transform=rasterio.Affine(r, 0, minX + j0 * r, 0, r, minZ + i0 * r),
                       fill=0, dtype=np.uint8) > 0
        wcw = wc[i0:i1, j0:j1]
        supw = sup[i0:i1, j0:j1]
        landw = pm & (wcw != WCm.WATER)
        inside = np.zeros(len(T), bool)
        bb = (T[:, 0] >= x0) & (T[:, 0] <= x1) & (T[:, 1] >= z0) & (T[:, 1] <= z1) if len(T) else inside
        shapely.prepare(g)
        inside[bb] = shapely.contains_xy(g, T[bb, 0], T[bb, 1])
        ha = float(pm.sum()) * r * r / 1e4
        ha_o = float((pm & ~supw).sum()) * r * r / 1e4
        n_o = int((inside & proc & ~tsup).sum())
        p.update(ha=round(ha, 1), wcTree=round(float((landw & WCm.tree_mask(wcw)).sum()) / max(1, int(landw.sum())), 3),
                 mapped=int((inside & (src == 0)).sum()), park=int((inside & (src == 1)).sum()), street=int((inside & (src == 2)).sum()),
                 haOpen=round(ha_o, 1), procOpen=n_o)
        p['trees'] = p['mapped'] + p['park'] + p['street']
        p['perHa'] = round(p['trees'] / max(ha, 1e-6), 1)
        p['perHaOpen'] = round(n_o / ha_o, 1) if ha_o > 0.05 else 0.0
        la, lo = lonlat(*g.representative_point().coords[0])
        p['lat'], p['lon'] = round(la, 5), round(lo, 5)

    # ---------------------------------------------------------------- crops + overview
    try:
        draw_crops(city, parks, cls, res2, wc, r, T, src, minX, minZ, maxX, maxZ, Q, out)
        draw_cells(cls, res2, flags, scrub_cells, Q, minX, minZ, maxX, maxZ, out)
    except Exception as e:  # noqa: BLE001 (the numbers stand without the pictures)
        log(f'crops failed: {e!r}')

    # ---------------------------------------------------------------- report + stats
    flags.sort(key=lambda f: -f[1])
    worst = []
    for kd, score, i, j, why in flags[:int(Q['worst'])]:
        la, lo = lonlat(minX + (j + 0.5) * Q['cell'], minZ + (i + 0.5) * Q['cell'])
        worst.append((kd, la, lo, score, why))
    summary = {
        'pass': ok, 'failed': failed, 'cells': ny * nx, 'landCells': nland,
        'checks': {c[0]: {'value': round(c[2], 4), 'max': c[3], 'count': c[5], 'min': c[6]} for c in checks},
        'flags': nflag, 'trees': tree_stats, 'scrubWoodedExamples': [[round(la, 5), round(lo, 5)] for la, lo, w in scrub_ex],
        'parks': [{k: p[k] for k in ('name', 'ha', 'wcTree', 'trees', 'mapped', 'park', 'street', 'perHa', 'haOpen', 'procOpen', 'perHaOpen')}
                  for p in parks],
        'bridgeGate': Q['bridgeGate'], 'bridges': bridge_summary(bridge),
        'report': os.path.relpath(os.path.join(out, 'report.md'), ROOT).replace('\\', '/'),
    }
    write_report(out, name, slug, man, Q, checks, ok, tree_stats, worst, parks, ny, nx, len(T), nproc, scrub_ex, bridge_section(bridge, bplan, Q, refused))
    mp = os.path.join(city_dir, 'city.json')
    m2 = json.load(open(mp))
    m2.setdefault('stats', {})['qa'] = summary
    with open(mp, 'w') as f:
        json.dump(m2, f)
    verdict = 'PASS' if ok else 'FAIL'
    lines = [f'{"FAIL" if c[0] in failed else "ok"}: {c[1]}: {c[2] * 100:.2f}% ({c[4]}), max {c[3] * 100:.1f}% (and >= {c[6]})'
             + ('  <-- FAIL' if c[0] in failed else '') for c in checks] + [bridge_line(c, Q['bridgeGate']) for c in bridge if c['key'] in failed]
    bsum = (f'; bridges ({Q["bridgeGate"]}): {sum(1 for c in bridge if c["over"])} of {len(bridge)} over their limits, '
            f'{sum(1 for c in bridge if not c["read"])} NOT READ')
    if ok:
        log('PASS (' + '; '.join(f'{c[0]} {c[2] * 100:.2f}%' + (f' ({c[5]}, under the minimum {c[6]})' if c[2] > c[3] else '') for c in checks)
            + f'{bsum}) in {time.time() - t0:.0f} s; ' + summary['report'])
    else:
        bar = '!' * 78
        print('\n'.join(['', bar, f'!!! QA FAIL: {name} ({slug}): ' + ', '.join(failed), *[f'!!! {s}' for s in lines],
                         f'!!! report: {summary["report"]}', bar, '']), flush=True)
    return ok


def draw_crops(city, parks, cls, res2, wc, r, T, src, minX, minZ, maxX, maxZ, Q, out):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    import worldcover as WCm
    from plot import CLASS_RGB
    if not parks:
        return
    T_ = city.manifest['tileSize']
    wins = []
    for p in parks:
        x0, z0, x1, z1 = p['geom'].bounds
        x0, z0, x1, z1 = max(minX, x0 - 60), max(minZ, z0 - 60), min(maxX, x1 + 60), min(maxZ, z1 + 60)
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        hw, hh = min((x1 - x0) / 2, Q['cropMax'] / 2), min((z1 - z0) / 2, Q['cropMax'] / 2)
        wins.append((cx - hw, cz - hh, cx + hw, cz + hh))
    near = {(tx, tz) for x0, z0, x1, z1 in wins for tx in range(int(x0 // T_), int(x1 // T_) + 1) for tz in range(int(z0 // T_), int(z1 // T_) + 1)}
    rings = []
    for t in city.building_tiles(near):
        vs, xz = t['vertStart'], t['xz']
        rings += [xz[vs[i]:vs[i + 1]] for i in range(t['count']) if t['tier'][i] == 0]
    rc = np.array([q.mean(axis=0) for q in rings]) if rings else np.zeros((0, 2))
    lut = np.ones((256, 3))
    for kc, v in CLASS_RGB.items():
        lut[kc] = v
    wlut = np.ones((256, 3))
    for kc, v in WC_RGB.items():
        wlut[kc] = v
    for n, (p, (x0, z0, x1, z1)) in enumerate(zip(parks, wins), 1):
        span = max(x1 - x0, z1 - z0)
        w_in = 6.5
        h_in = float(np.clip(w_in * (z1 - z0) / max(1.0, x1 - x0), 2.5, 9.0))
        fig, axs = plt.subplots(1, 2, figsize=(2 * w_in + 0.6, h_in + 1.0), dpi=150)
        ext = (x0, x1, z1, z0)
        # left: WorldCover + every tree (black)
        j0, i0 = int((x0 - minX) // r), int((z0 - minZ) // r)
        wcw = wc[i0:int(np.ceil((z1 - minZ) / r)), j0:int(np.ceil((x1 - minX) / r))]
        axs[0].imshow(wlut[wcw], extent=(minX + j0 * r, minX + (j0 + wcw.shape[1]) * r, minZ + (i0 + wcw.shape[0]) * r, minZ + i0 * r),
                      interpolation='nearest')
        # right: the baked ground classes (2 m), buildings, trees by source, the WorldCover tree outline
        a0, b0 = int((x0 - minX) // res2), int((z0 - minZ) // res2)
        a1, b1 = int(np.ceil((x1 - minX) / res2)), int(np.ceil((z1 - minZ) / res2))
        axs[1].imshow(lut[cls[b0:b1, a0:a1]], extent=(minX + a0 * res2, minX + a1 * res2, minZ + b1 * res2, minZ + b0 * res2), interpolation='nearest')
        sel = (rc[:, 0] > x0 - 80) & (rc[:, 0] < x1 + 80) & (rc[:, 1] > z0 - 80) & (rc[:, 1] < z1 + 80) if len(rc) else np.zeros(0, bool)
        if sel.any():
            axs[1].add_collection(PolyCollection([rings[k] for k in np.nonzero(sel)[0]], facecolors=(0.42, 0.36, 0.48), edgecolors='none'))
        tw = WCm.tree_mask(wcw).astype(float)
        xs = minX + (j0 + np.arange(wcw.shape[1]) + 0.5) * r
        zs = minZ + (i0 + np.arange(wcw.shape[0]) + 0.5) * r
        if tw.any() and not tw.all():
            axs[1].contour(xs, zs, tw, levels=[0.5], colors=[(0.55, 1.0, 0.2)], linewidths=0.6)
        m = (T[:, 0] >= x0) & (T[:, 0] < x1) & (T[:, 1] >= z0) & (T[:, 1] < z1) if len(T) else np.zeros(0, bool)
        ms = float(np.clip(5.0 * 700.0 / span, 0.4, 7.0))
        axs[0].scatter(T[m, 0], T[m, 1], s=ms * 0.6, c='k', marker='o', linewidths=0)
        for kd, v in (('park', 1), ('street', 2), ('mapped', 0)):
            mm = m & (src == v)
            axs[1].scatter(T[mm, 0], T[mm, 1], s=ms, c=[SRC_RGB[kd]], marker='o', linewidths=0, label=f'{kd} {int(mm.sum())}')
        for ax in axs:
            for gp in (list(p['geom'].geoms) if p['geom'].geom_type == 'MultiPolygon' else [p['geom']]):
                if gp.geom_type == 'Polygon':
                    c = np.asarray(gp.exterior.coords)
                    ax.plot(c[:, 0], c[:, 1], color=(0.9, 0.0, 0.7), lw=0.8, ls='--')
            ax.set_xlim(x0, x1)
            ax.set_ylim(z1, z0)
            ax.set_aspect('equal')
            ax.set_xticks([])
            ax.set_yticks([])
        axs[0].set_title('ESA WorldCover 2021 + every baked tree', fontsize=8)
        axs[1].set_title(f'the bake (lime: WorldCover tree cover)', fontsize=8)
        crop = ' (its middle)' if span >= Q['cropMax'] - 1 else ''
        fig.suptitle(f'{p["name"]} ({p["class"]}){crop}: {p["ha"]:.0f} ha, WorldCover tree cover {p["wcTree"] * 100:.0f}%; {p["trees"]} trees '
                     f'({p["mapped"]} mapped, {p["park"]} park, {p["street"]} street) = {p["perHa"]:.1f} / ha; on WorldCover-open land '
                     f'({p["haOpen"]:.0f} ha): {p["procOpen"]} procedural ({p["perHaOpen"]:.1f} / ha)', fontsize=8)
        hs = [plt.Line2D([], [], marker='s', ls='', mfc=CLASS_RGB[kc], mec='k', mew=0.2, ms=5, label=CLASS_NAME[kc]) for kc in CLASS_RGB]
        hs += [plt.Line2D([], [], marker='o', ls='', mfc=SRC_RGB[kd], mec='none', ms=4, label=f'{kd} tree') for kd in SRC_RGB]
        hw_ = [plt.Line2D([], [], marker='s', ls='', mfc=WC_RGB[kc], mec='k', mew=0.2, ms=5, label=WC_NAME[kc]) for kc in (10, 20, 30, 40, 50, 60, 80, 90)]
        fig.legend(handles=hw_ + hs, loc='lower center', ncol=11, fontsize=5.5, frameon=False)
        slugn = ''.join(ch if ch.isalnum() else '-' for ch in p['name'].lower()).strip('-')[:40]
        p['png'] = f'park_{n}_{slugn}.png'
        fig.savefig(os.path.join(out, p['png']), bbox_inches='tight')
        plt.close(fig)


def draw_cells(cls, res2, flags, scrub_cells, Q, minX, minZ, maxX, maxZ, out):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle
    from plot import CLASS_RGB
    lut = np.ones((256, 3))
    for kc, v in CLASS_RGB.items():
        lut[kc] = v
    s = max(1, int(round(8.0 / res2)))
    img = lut[cls[::s, ::s]]
    w = float(np.clip((maxX - minX) / 800.0, 6, 16))
    fig, ax = plt.subplots(figsize=(w, w * (maxZ - minZ) / (maxX - minX) + 0.6), dpi=130)
    ax.imshow(img, extent=(minX, maxX, maxZ, minZ), interpolation='nearest')
    col = {'trees on open land': (0.9, 0.1, 0.1), 'missing trees': (0.1, 0.6, 0.1), 'water': (0.1, 0.3, 0.95), 'sand': (0.95, 0.6, 0.0)}
    c = Q['cell']
    for i, j in scrub_cells:
        ax.add_patch(Rectangle((minX + j * c, minZ + i * c), c, c, fill=False, ec=(0.6, 0.3, 0.8), lw=0.6, ls=':'))
    for kd, score, i, j, why in flags:
        ax.add_patch(Rectangle((minX + j * c, minZ + i * c), c, c, fill=False, ec=col[kd], lw=1.0))
    ax.set_xlim(minX, maxX)
    ax.set_ylim(maxZ, minZ)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])
    hs = [plt.Line2D([], [], marker='s', ls='', mfc='none', mec=v, ms=7, label=f'{kd} ({sum(1 for f in flags if f[0] == kd)})') for kd, v in col.items()]
    hs.append(plt.Line2D([], [], marker='s', ls='', mfc='none', mec=(0.6, 0.3, 0.8), ms=7, label=f'info: WorldCover woods over OSM scrub / heath ({len(scrub_cells)})'))
    ax.legend(handles=hs, loc='lower left', fontsize=7)
    ax.set_title('QA: flagged 128 m cells on the baked ground', fontsize=9)
    fig.savefig(os.path.join(out, 'cells.png'), bbox_inches='tight')
    plt.close(fig)


def limit_text(c):
    """'<= 15.00 m (and >= 50 m)': a bridge check's limit and its floor ("<= 1 x half its deck's width" for one that is a
    multiple of what each thing it reads has, until it's read)"""
    if c.get('per') and not c['read']:
        return ('>= ' if c['lower'] else '<= ') + f'{c["limit"]:g} x {c["per"]}'
    t = ('>= ' if c['lower'] else '<= ') + fmt(c['limit'], c['unit'])
    if c['floor'] and (c['countUnit'] != 'count' or c['floor'] > 1):
        t += f' (and >= {fmt(c["floor"], c["countUnit"])})'
    return t


def gate_fails(c, gate):
    """a bridge check fails the bake only once the gate is 'fail': when it's over its limit, or failed to read (what it
    reads threw, as for every check when bridges.py breaks on a city's data: as a pass it would pass that city). One with
    nothing to read yet, no hero or no bridges.bin, doesn't. The record's flag says which, never the words of its why"""
    return gate == 'fail' and (c['over'] or c['failed'])


def bridge_line(c, gate):
    """one bridge check for the log"""
    if not c['read']:
        return f'bridges: {c["key"]}: NOT READ ({c["why"]})' + (': FAIL' if gate_fails(c, gate) else '')
    v = fmt(c['value'], c['unit']) + (f' ({fmt(c["count"], c["countUnit"])})' if c['countUnit'] != 'count' else '')
    state = ('FAIL' if gate == 'fail' else 'OVER (reported, not failed)') if c['over'] else 'ok'
    return f'bridges: {c["key"]} {v}, limit {limit_text(c)}: {state}; {c["what"]}' + (f'; {c["detail"]}' if c['detail'] else '')


def bridge_summary(bridge):
    """the bridge checks for city.json stats.qa, short: the game reads that file on every boot, and the units, limits,
    reasons and rows are the report's (an id gone is value None with gone: true)"""
    def num(v):
        return None if v is None or not math.isfinite(v) else round(v, 4)
    return {c['key']: {'value': num(c['value']), 'over': c['over'], 'read': c['read'], **({'gone': True} if c['value'] == float('inf') else {})}
            for c in bridge}


def bridge_section(bridge, bplan, Q, refused):
    """the report's bridge checks (BRIDGES.md section 4) and what bridges.py's plan made of the map"""
    gate = Q['bridgeGate']
    L = ['## Bridges', '',
         f'The fifteen checks of `docs/specs/bridges/BRIDGES.md` section 4, '
         + ('**failing the bake** when over.' if gate == 'fail' else 'reported, **never failing the bake** (`"bridgeGate": "report"`) until step 6 sets them to fail.')
         + ' A check is over when its value passes its limit and its count reaches its floor. NOT READ: nothing to read yet, never a pass; one '
         'that failed to read fails the bake once the gate is fail. Until '
         'step 5 the decks drawn are the heroes\' kits (city.json landmark rows with a deck) and the decks of the map are `tools/bake/bridges.py`\'s plan, '
         'its tops by the rule with no LiDAR.', '', '| check | value | limit | | what |', '|---|---|---|---|---|']
    for c in bridge:
        v = fmt(c['value'], c['unit']) + (f' ({fmt(c["count"], c["countUnit"])})' if c['read'] and c['countUnit'] != 'count' else '')
        st = '**FAIL**' if gate_fails(c, gate) else 'NOT READ' if not c['read'] else '**over**' if c['over'] else 'ok'
        L.append(f'| `{c["key"]}` | {v} | {limit_text(c)} | {st} | {c["what"]}' + (f': {c["detail"]}' if c['detail'] else '')
                 + (f' ({c["why"]})' if not c['read'] else '') + ' |')
    if refused:
        L += ['', 'The config\'s `"qa"` tried to loosen these, or to set how the city is cut up, which it may not; the defaults stand: '
              + ', '.join(f'`{k}` {v!r} (default {d!r})' for k, v, d in refused) + '.']
    cl = bplan['classes']
    L += ['', f'**The map\'s decks** (bridges.py): ' + ', '.join(f'{c} {n} ({km:.2f} km)' for c, (n, km) in cl.items())
          + f'; {bplan["skipped"]} tram-only S decks skipped. The heroes draw: '
          + ('; '.join(f'{h} its ways {", ".join(ids)}' for h, ids in sorted(bplan['heroes'].items())) or 'none') + '.', '',
          '**Spans of 1 km or more with no tower and no structure tag** (the thin-data case no check can measure; the tour takes the longest): '
          + ('; '.join(f'{nm} {n:,} m at {ll}' for n, nm, ll in bplan['openSpans']) or 'none') + '.']
    for c in bridge:
        if c['rows']:
            L += ['', f'### `{c["key"]}`', ''] + [f'- {r}' for r in c['rows'][:int(Q['worst'])]]
            if len(c['rows']) > Q['worst']:
                L.append(f'- ... and {len(c["rows"]) - int(Q["worst"])} more')
    return L + ['']


def write_report(out, name, slug, man, Q, checks, ok, ts, worst, parks, ny, nx, ntrees, nproc, scrub_ex=(), bridge_lines=()):
    minX, minZ, maxX, maxZ = man['bounds']
    L = [f'# Bake QA: {name} ({man.get("name", slug)}): **{"PASS" if ok else "FAIL"}**', '',
         f'Written {time.strftime("%Y-%m-%d %H:%M")} by `tools/bake/qa.py` against ESA WorldCover 10 m (2021). Frame '
         f'{(maxX - minX) / 1000:.2f} x {(maxZ - minZ) / 1000:.2f} km, {ny * nx:,} cells of {Q["cell"]:.0f} m; {man.get("buildingCount", 0):,} buildings.',
         '', '| check | value | threshold | |', '|---|---|---|---|']
    for key, what, v, mx, detail, n, mn in checks:
        verdict = 'ok' if v <= mx else '**FAIL**' if n >= mn else f'ok (over the share, under the minimum of {mn})'
        L.append(f'| {what} | {v * 100:.2f}% ({detail}) | <= {mx * 100:.1f}% (or < {mn}) | {verdict} |')
    L += [''] + list(bridge_lines)
    L += ['', '## Trees', '',
          f'{ntrees:,} trees: {ts["mapped"]:,} mapped (OSM natural=tree / tree_row), {ts["park"]:,} procedural park / woods trees, '
          f'{ts["street"]:,} procedural street trees. WorldCover tree cover: {ts["wcTreeCover"] * 100:.1f}% of the land. Procedural park / '
          f'woods trees: {ts["perHaNearWcTrees"]:.1f} / ha of the land within {Q["support"]:.0f} m of WorldCover tree cover, '
          f'{ts["perHaOpen"]:.2f} / ha of the rest ({ts["unsupportedPark"]:,} unsupported).', '',
          "Street trees (reported, not checked: WorldCover's 10 m pixels miss most single street trees): "
          f'{ts["streetUnsupported"] * 100:.1f}% of the {ts["street"]:,} procedural ones along frontages have no WorldCover tree pixel '
          f'within {Q["support"]:.0f} m, against {ts["mappedStreetUnsupported"] * 100:.1f}% of the {ts["mappedStreet"]:,} mapped street trees.', '',
          f'WorldCover sees woods (>= {Q["woodCover"] * 100:.0f}% tree cover) over OSM scrub / heath in {ts["scrubWoodedCells"]:,} cells, left '
          'without procedural trees (not a failure: the WorldCover tree class takes in tall dense shrubs; the OSM scrub tag wins)'
          + (': ' + '; '.join(f'{la:.5f}, {lo:.5f} ({w * 100:.0f}%)' for la, lo, w in scrub_ex) if scrub_ex else '') + '.', '',
          '## How to read this', '',
          '- **trees on open land**: procedural trees standing where WorldCover sees no tree cover within the support reach: a '
          'park polygon planted over its lawns, marsh or beach. Unsupported OSM-woods trees (woods are strong evidence of their '
          "own) count too; a few are fine, a cluster is the old bug. Street trees along frontages don't count (see Trees).",
          '- **missing trees**: WorldCover sees a wood over a park / woods / open-space cell (not scrub, heath, pitches...) '
          'the bake left (almost) bare: the evidence gate '
          'too strict, a polygon classed open space over a real wood, or WorldCover misregistered.',
          '- **water**: the baked water vs WorldCover permanent water. Land where WorldCover sees water is usually a tidal marsh, '
          'a flat or a lagoon OSM maps as wetland (drawn as grass), or a pier / fill area; water where WorldCover sees land is '
          'a land polygon the extract lacks (the sea comes from the coastline), worth a look.',
          '- **scrub / heath** (info, dotted purple on the cell map): WorldCover sees woods where OSM maps scrub or heath. '
          'The bake trusts OSM there (the WorldCover tree class takes in tall dense shrubs: dense coastal scrub reads as '
          'tree cover); a wood mapped inside the scrub still gets its trees. Worth a look at the imagery when a city has a '
          'lot of it.',
          '- **sand**: baked sand where WorldCover sees vegetation or buildings (a beach polygon that moved), or WorldCover bare '
          'ground where the bake has grass (an unmapped beach, dunes, a dirt field, a construction site).',
          '- The crops: left WorldCover (green = tree cover, yellow = grassland, red = built-up, grey = bare, blue = water) with '
          'every baked tree in black: black dots on yellow / grey / blue are trees on open land. Right: the bake (ground '
          'classes, buildings, trees: blue mapped, dark green procedural park / woods, orange procedural street), the lime '
          'outline is WorldCover tree cover, the dashed magenta line the park.', '',
          '![flagged cells](cells.png)', '', f'## Worst disagreements (top {len(worst)})', '',
          '| # | kind | lat, lon | score | reason |', '|---|---|---|---|---|']
    for n, (kd, la, lo, score, why) in enumerate(worst, 1):
        L.append(f'| {n} | {kd} | {la:.5f}, {lo:.5f} | {score:.1f} | {why} |')
    if not worst:
        L.append('| | none | | | |')
    L += ['', '(score: trees for "trees on open land", the expected trees missing for "missing trees", ha for water / sand)', '',
          f'## The largest parks and open spaces ({len(parks)})', '',
          '| park | lat, lon | ha | WorldCover trees | trees (mapped / park / street) | per ha | WorldCover-open land: ha, procedural trees, per ha |',
          '|---|---|---|---|---|---|---|']
    for p in parks:
        L.append(f'| {p["name"]} ({p["class"]}) | {p["lat"]}, {p["lon"]} | {p["ha"]:.1f} | {p["wcTree"] * 100:.0f}% | {p["trees"]} '
                 f'({p["mapped"]} / {p["park"]} / {p["street"]}) | {p["perHa"]:.1f} | {p["haOpen"]:.1f}, {p["procOpen"]}, {p["perHaOpen"]:.1f} |')
    L.append('')
    for p in parks:
        if p.get('png'):
            L += [f'### {p["name"]}', '', f'![{p["name"]}]({p["png"]})', '']
    L += ['## Thresholds', '', 'Defaults in `tools/bake/qa.py` QA_DEFAULTS; the city config\'s `"qa": {...}` sets them, a limit, a floor or how strictly '
          'a check measures only tighter, the cells not at all:', '',
          '```', json.dumps({k: Q[k] for k in QA_DEFAULTS}, indent=1), '```', '']
    with open(os.path.join(out, 'report.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(L))


def main():
    sys.stdout.reconfigure(errors='backslashreplace')
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    slug = args[0] if args else 'sf'
    d = flags.get('dir') or os.path.join(ROOT, 'public', 'city', slug)
    ok = run(slug, d, crops=int(flags['crops']) if flags.get('crops') else None)
    sys.exit(0 if ok else 3)


if __name__ == '__main__':
    main()
