#!/usr/bin/env python3
"""Bridges from the map (docs/specs/bridges/BRIDGES.md section 1): the planning core.

Every OSM bridge way of the infrastructure theme is its own row, cut at the real bridge's ends, with its tags and way id.
plan() turns them into decks, the steps of "Building one deck":

  chain     ways joined end to end where exactly two of one use, level and (roads) name meet (shapely's line_merge)
  merge     longest chain first: a chain that runs beside a deck (70 % of it, within 30 degrees, edges 6 m apart at most)
            is part of it; a second pass merges decks that came out side by side
  width     the deck's left and right edges, from each way's own width (its width tag, else lanes x 3.6 + 1 m, else
            the bake's class width)
  stack     ways within 6 m of the centre on different levels: one double deck
  recentre  the centre line the middle of the two edges, smoothed over 190 m (the longest chain can be a sidewalk)
  inherit   bridge:structure from the man_made=bridge polygon holding most of the deck
  join      two decks of one bridge across a gap of up to 120 m: a bridge_support row touches both ends, or they share
            a name and line up within 10 degrees with no street of their own on the ground between them
  filter    highway=construction, disused and abandoned ways get no deck; a tram-only S deck is skipped (the ground
            draws no tram)
  clip      a deck stops at the frame edge, and that end is open (outside the frame the ground isn't known)

then profile() gives each deck its height by the rule of "Height profile" (no LiDAR here: step 5 reads the deck tops
where it has them) and its class by "What gets drawn, by size": XL, L, M or S. A free end lands on the ground only where a
kept way (the bake's own street, path or rail) meets it within 12 m; an end shared with another deck (within 4 m,
measured) meets its height; an end inside a building is a terminal; any other end is open, keeps its height and is
reported. An XL deck is pulled through its towers' centres. The decks a hero's kit draws (a city config's landmark row
with a deck: Bridges.ts) are marked as that hero's, so step 5's builder skips them by their way ids.

Read only: the extract (osm.OSM), the ground (a Ground: the baked tiles for qa.py and tour.py, the bake's own rasters at
step 5) and the streets the bake draws. Nothing is meshed or written: bridges.bin is step 5's.

  python3 -I tools/bake/bridges.py <slug> [--dir=public/city/<name>] [--list]

prints the decks by class, the towers, the hero decks and the open ends (--list: every deck).
"""
import json
import math
import os
import sys
import time

import numpy as np
import shapely
from shapely.geometry import LineString, MultiLineString, Point, box
from shapely.ops import substring
from shapely.strtree import STRtree

sys.dont_write_bytecode = True  # (no __pycache__ in tools/bake)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

ROAD = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary',
        'tertiary_link', 'residential', 'unclassified', 'living_street', 'service', 'busway', 'road'}
FOOT = {'footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'track', 'corridor'}
NOT_OPEN = {'construction', 'disused', 'abandoned', 'razed', 'dismantled', 'proposed'}  # (highway= or railway=: no deck)
SUSP = {'suspension', 'self-anchored_suspension', 'cable-stayed'}
ARCH = {'arch', 'humpback'}                 # bridge:structure (or bridge=humpback): never S, their humps are the look
CLASSES = ('XL', 'L', 'M', 'S')

STEP = 10.0          # m: decks are sampled every STEP along their line
CHORD = 20.0         # m: a deck's direction where its line moves sideways, over twice this
MERGE_GAP = 6.0      # m: a chain merges into a deck with its edge this close...
MERGE_SHARE = 0.7    # ...along this share of its length...
MERGE_ANGLE = 30.0   # ...within this many degrees
STACK = 6.0          # m: a way on another level this close to the centre makes a double deck
RECENTRE = 190.0     # m: the window the centre line is smoothed over
JOIN_GAP = 120.0     # m: the widest gap two decks of one bridge join across
JOIN_ANGLE = 10.0    # degrees: two decks of one name line up this well to join
JOIN_TOUCH = 6.0     # m: a support row this close to both ends joins them
SHARED = 4.0         # m: an end this close to another deck shares it (a true distance)
LAND_REACH = 12.0    # m: a free end lands only where a kept way meets it this close
MIN_DECK = 1.0       # m: a clipped piece shorter than this is no deck
TOWER_CLUSTER = 45.0 # m: tower rows this close are one tower
TOWER_REACH = 45.0   # m: a tower this close to a deck stands on it...
TOWER_OVER = 15.0    # m: ...when it stands this far over its top
LONG = 150.0         # m: L and XL
SHORT = 20.0         # m: shorter with nothing under it: S
LOW = 4.0            # m: a low crossing (rule height over the water) or a low footbridge: S
OPEN_SPAN = 1000.0   # m: a span this long with no tower and no structure tag is listed (the thin-data case)
GRADE = {'road': 0.03, 'rail': 0.02, 'foot': 0.06}   # the steepest a deck's rule profile falls
GMAX = {'road': 0.06, 'rail': 0.035, 'foot': 0.10}   # the steepest a free end lands at
STOREY = 5.5                                         # m over the ground per OSM level, over land
LANDING = 0.8                                        # m: a free end's top over the ground
# The two heroes' kits (src/world/Bridges.ts GGB and BAY): half the deck's width and its thickness, as the kit draws them.
HERO_KIT = {'ggb': {'half': 13.5, 'thick': 8.0}, 'baybridge': {'half': 12.0, 'thick': 10.0}}
HERO_CLAIM = 0.5     # a deck this much of whose length runs on a hero's drawn deck (its width + 6 m) is that hero's


def _log(*a):
    print(f'[{time.strftime("%H:%M:%S")}] bridges:', *a, flush=True)


def tags_of(t):
    try:
        return json.loads(t) if isinstance(t, str) and t else {}
    except ValueError:
        return {}


def tag_num(v):
    """'12', '3.5 m', '7,5': a tag's leading number, else None"""
    try:
        f = float(str(v).split()[0].replace(',', '.'))
    except (TypeError, ValueError, IndexError):
        return None
    return f if f == f else None


def osm_ref(v):
    """'w123@4' -> 'w123'"""
    return str(v).split('@', 1)[0] if v is not None and v == v else ''


def use_of(t):
    h = t.get('highway')
    if h in FOOT:
        return 'foot'
    if h in ROAD:
        return 'road'
    if 'railway' in t and not h:
        return 'rail'
    return 'other'


def way_width(t, P):
    """the deck width a way asks for: its width tag, else lanes, else the bake's own class width (osm.OSM_DEFAULTS)"""
    w = tag_num(t.get('width')) or tag_num(t.get('est_width'))
    if w and w >= 1.0:
        return w
    h = t.get('highway')
    if h in FOOT:
        return P['pathWidth']
    if 'railway' in t and not h:
        return P['railWidth']
    ln = tag_num(t.get('lanes'))
    if ln:
        return ln * 3.6 + 1.0
    if h and h.endswith('_link'):
        return P['linkWidth']
    return P['roadWidth'].get((h or '').replace('_link', ''), P['roadWidth']['unknown'])


def is_tower(t):
    return t.get('bridge:support') == 'pylon' or (t.get('man_made') == 'tower' and t.get('tower:type') == 'bridge')


# ---------------------------------------------------------------------------------------------------------- what goes in
def load(osm):
    """(ways, polygons, supports) from the extract's infrastructure theme, inside the frame (osm.set_frame)"""
    d, g = osm.read('infrastructure')
    ways, polys, sups = [], [], []
    if d is None:
        return ways, polys, sups
    tid = shapely.get_type_id(g)
    for i, row in enumerate(d.itertuples(index=False)):
        if g[i] is None or g[i].is_empty:
            continue
        t = tags_of(row.tags)
        sub, kl = row.subtype, row.klass
        name = row.name if isinstance(row.name, str) else ''
        ref = osm_ref(row.osm_id)
        if sub == 'bridge' and kl in ('bridge', 'viaduct', 'movable'):
            if tid[i] == 1:
                u = use_of(t)
                if u == 'other' or t.get('highway') in NOT_OPEN or t.get('railway') in NOT_OPEN:
                    continue  # (not a road, path or railway, or not open: no deck)
                lv = row.level
                ways.append({'line': g[i], 'tags': t, 'use': u, 'w': way_width(t, osm.P), 'level': int(lv) if lv is not None and lv == lv else 1,
                             'name': name, 'osm': ref, 'tram': t.get('railway') == 'tram'})
            elif tid[i] in (3, 6):
                polys.append({'poly': g[i], 'tags': t, 'name': name, 'osm': ref, 'class': kl})
        elif (sub == 'bridge' and kl == 'bridge_support') or is_tower(t):
            h = row.height
            sups.append({'g': g[i], 'tags': t, 'h': float(h) if h is not None and h == h else None, 'name': name, 'osm': ref,
                         'kind': 'support', 'area': float(shapely.area(g[i]))})
        elif sub == 'pier' and tid[i] in (3, 6):
            sups.append({'g': g[i], 'tags': t, 'h': None, 'name': name, 'osm': ref, 'kind': 'pier', 'area': float(shapely.area(g[i]))})
    return ways, polys, sups


def towers(sups, ground=None):
    """tower rows (bridge:support=pylon, or a bridge's man_made=tower) clustered within TOWER_CLUSTER m: one per tower, its
    top the highest height tag (over its own ground) and its base that ground (the sea's 0 in the water, as a deck's;
    0 outside the frame or with no ground). A tower with no height is kept with top None: no class reads it, the report
    lists it."""
    from scipy.spatial import cKDTree
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    tw = [s for s in sups if s['kind'] == 'support' and is_tower(s['tags'])]
    if not tw:
        return []
    c = np.array([shapely.get_coordinates(shapely.centroid(s['g']))[0] for s in tw])
    pr = cKDTree(c).query_pairs(TOWER_CLUSTER, output_type='ndarray')
    gr = coo_matrix((np.ones(len(pr)), (pr[:, 0], pr[:, 1])), shape=(len(c), len(c)))
    _, lab = connected_components(gr, directed=False)
    out = []
    for k in np.unique(lab):
        m = np.flatnonzero(lab == k)
        hs = [tw[i]['h'] for i in m if tw[i]['h']]
        xz = c[m].mean(axis=0)
        g = float(ground.at([xz])[0][0]) if ground is not None else 0.0
        out.append({'xz': xz, 'top': max(hs) if hs else None, 'base': max(0.0, g) if g == g else 0.0, 'n': len(m), 'ids': [tw[i]['osm'] for i in m],
                    'ref': next((tw[i]['tags'].get('ref') for i in m if tw[i]['tags'].get('ref')), None)})
    return out


# ---------------------------------------------------------------------------------------------------- building one deck
def frames_along(line, step, chord=1.0):
    """stations every `step` m (both ends included), their points and unit tangents (over a chord of 2 x `chord` m: a
    longer one rides over a jog in the line, a sidewalk's round a tower's leg)"""
    L = line.length
    s = np.linspace(0, L, max(2, int(math.ceil(L / step)) + 1))
    p = shapely.get_coordinates(shapely.line_interpolate_point(line, s))
    t = shapely.get_coordinates(shapely.line_interpolate_point(line, np.minimum(s + chord, L))) - \
        shapely.get_coordinates(shapely.line_interpolate_point(line, np.maximum(s - chord, 0)))
    t /= np.maximum(np.hypot(t[:, 0], t[:, 1])[:, None], 1e-6)
    return s, p, t


def chains(ways):
    """ways joined end to end where exactly two of the same use, level and (roads) name meet; longest first"""
    groups = {}
    for w in ways:
        groups.setdefault((w['use'], w['level'], w['name'] if w['use'] == 'road' else ''), []).append(w)
    out = []
    for (use, level, name), ws in groups.items():
        merged = shapely.line_merge(MultiLineString([w['line'] for w in ws]))
        parts = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
        # (each way is in the one part its middle lies on)
        mids = shapely.line_interpolate_point(np.array([w['line'] for w in ws], dtype=object), 0.5, normalized=True)
        pt = STRtree(parts)
        mem = [[] for _ in parts]
        best = {}
        for j, k in zip(*pt.query(mids, predicate='dwithin', distance=0.5)):
            dd = parts[k].distance(mids[j])
            if j not in best or dd < best[j][0]:
                best[j] = (dd, k)
        for j, (_, k) in best.items():
            mem[k].append(ws[j])
        for ln, m in zip(parts, mem):
            out.append({'line': ln, 'use': use, 'level': level, 'name': name, 'ways': m,
                        'w': float(np.average([q['w'] for q in m], weights=[max(1.0, q['line'].length) for q in m])) if m else 6.0})
    return sorted(out, key=lambda c: -c['line'].length)


def _near(a, b, pad=60.0):
    return not (a[0] - pad > b[2] or a[2] + pad < b[0] or a[1] - pad > b[3] or a[3] + pad < b[1])


def _beside(d, p, t, lo, hi):
    """where samples p (tangents t, edges lo..hi m off them) run beside deck d: (stations on d, offsets lo, hi on d's
    normal, the edge gap, cos of the angle)"""
    ss = shapely.line_locate_point(d['line'], shapely.points(p))
    on = shapely.get_coordinates(shapely.line_interpolate_point(d['line'], ss))
    ta = shapely.get_coordinates(shapely.line_interpolate_point(d['line'], np.minimum(ss + 1, d['line'].length))) - on
    ta /= np.maximum(np.hypot(ta[:, 0], ta[:, 1])[:, None], 1e-6)
    cos = np.abs((ta * t).sum(axis=1))
    na = np.column_stack([-ta[:, 1], ta[:, 0]])
    n = np.column_stack([-t[:, 1], t[:, 0]])
    a, b = (((p + n * lo[:, None]) - on) * na).sum(axis=1), (((p + n * hi[:, None]) - on) * na).sum(axis=1)
    lo2, hi2 = np.minimum(a, b), np.maximum(a, b)
    al, ar = np.interp(ss, d['s'], d['left']), np.interp(ss, d['s'], d['right'])
    return ss, lo2, hi2, np.maximum(lo2 - ar, al - hi2), cos


def _widen(d, ss, lo, hi):
    order = np.argsort(ss)
    d['left'] = np.minimum(d['left'], np.interp(d['s'], ss[order], lo[order], left=np.inf, right=np.inf))
    d['right'] = np.maximum(d['right'], np.interp(d['s'], ss[order], hi[order], left=-np.inf, right=-np.inf))


def build(ways):
    """chains -> decks: merge (longest first), width, stack, then the second pass for decks side by side"""
    cos_max = math.cos(math.radians(MERGE_ANGLE))
    decks = []
    for c in chains(ways):
        s, p, t = frames_along(c['line'], STEP)
        bb = (p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max())
        best, bestn = None, 0.0
        for d in decks:
            if not _near(d['bounds'], bb):
                continue
            if d['use'] == 'foot' and c['use'] != 'foot' and d['line'].length < c['line'].length:
                continue  # (a road doesn't join a shorter sidewalk's deck)
            hw = np.full(len(s), c['w'] / 2)
            ss, lo, hi, gap, cos = _beside(d, p, t, -hw, hw)
            ok = (gap <= MERGE_GAP) & (cos >= cos_max)
            if ok.mean() >= MERGE_SHARE and ok.mean() > bestn:
                best, bestn = (d, ss, lo, hi), ok.mean()
        if best:
            d, ss, lo, hi = best
            _widen(d, ss, lo, hi)
            d['members'].append(c)
            d['levels'].add(c['level'])
            d['uses'].add(c['use'])
            if abs(np.median((lo + hi) / 2)) <= STACK and c['level'] not in d['coreLevels']:
                d['stacked'] = True
                d['coreLevels'].add(c['level'])
            continue
        decks.append({'line': c['line'], 's': s, 'left': np.full(len(s), -c['w'] / 2), 'right': np.full(len(s), c['w'] / 2), 'use': c['use'],
                      'uses': {c['use']}, 'levels': {c['level']}, 'coreLevels': {c['level']}, 'stacked': False, 'members': [c],
                      'name': c['name'], 'bounds': bb})
    # (two decks that came out side by side are one: each carriageway took its own sidewalk first)
    changed = True
    while changed:
        changed = False
        decks.sort(key=lambda q: -q['line'].length)
        for a in decks:
            if a.get('gone'):
                continue
            for b in decks:
                if a is b or b.get('gone') or b['line'].length > a['line'].length or not _near(a['bounds'], b['bounds']):
                    continue
                s_, p, t = frames_along(b['line'], STEP)
                ss, lo, hi, gap, cos = _beside(a, p, t, np.interp(s_, b['s'], b['left']), np.interp(s_, b['s'], b['right']))
                if ((gap <= MERGE_GAP) & (cos >= cos_max)).mean() >= MERGE_SHARE:
                    _widen(a, ss, lo, hi)
                    a['members'] += b['members']
                    a['levels'] |= b['levels']
                    a['uses'] |= b['uses']
                    a['stacked'] = a['stacked'] or b['stacked']
                    a['name'] = a['name'] or b['name']
                    b['gone'] = True
                    changed = True
        decks = [q for q in decks if not q.get('gone')]
    for d in decks:
        finish(d)
    return decks


def finish(d):
    """the derived fields of a deck after its line or members change"""
    d['width'] = float(np.mean(d['right'] - d['left']))
    d['length'] = float(d['line'].length)
    d['ways'] = [w for m in d['members'] for w in m['ways']]
    d['ids'] = sorted({w['osm'] for w in d['ways'] if w['osm']})
    # (the deck's key: its longest way's id, so a re-bake that keeps the way keeps the deck's id and its saved paint)
    lw = max(d['ways'], key=lambda w: w['line'].length) if d['ways'] else None
    d['osm'] = lw['osm'] if lw else ''
    d['bounds'] = d['line'].bounds
    if 'tags' not in d:
        tg = {}
        for w in d['ways']:
            for k in ('bridge:structure', 'bridge', 'bridge:name', 'bridge:movable'):
                if k in w['tags'] and k not in tg:
                    tg[k] = w['tags'][k]
        d['tags'] = tg


def smooth(v, k):
    """a moving average over 2k + 1 samples, the ends held"""
    pad = [(k, k)] + [(0, 0)] * (v.ndim - 1)
    w = np.ones(2 * k + 1) / (2 * k + 1)
    a = np.pad(v, pad, mode='edge')
    return np.stack([np.convolve(a[:, j], w, mode='valid') for j in range(v.shape[1])], axis=1) if v.ndim == 2 else np.convolve(a, w, mode='valid')


def recentre(d):
    """the centre line the middle of the two edges, smoothed over RECENTRE m; the edges measured from it. The edges are
    measured from the reference line with its sideways jogs smoothed over 2 x CHORD m first (only sideways: the ends stay
    where they are): where it jogs (a sidewalk round a tower's legs) the edges don't, so neither does the centre"""
    s, p, t = frames_along(d['line'], STEP, CHORD)
    n = np.column_stack([-t[:, 1], t[:, 0]])
    dev = ((p - smooth(p, int(round(CHORD / STEP)))) * n).sum(axis=1)
    lf, rt = np.interp(s, d['s'], d['left']) + dev, np.interp(s, d['s'], d['right']) + dev
    msm = smooth((lf + rt) / 2, int(round(RECENTRE / STEP / 2)))
    c = p + n * (msm - dev)[:, None]
    keep = np.r_[True, np.hypot(*np.diff(c, axis=0).T) > 0.01]
    c, lf, rt, msm = c[keep], lf[keep], rt[keep], msm[keep]
    if len(c) < 2:
        return
    d['line'] = LineString(c)
    d['s'] = np.r_[0.0, np.cumsum(np.hypot(*np.diff(c, axis=0).T))]
    d['left'], d['right'] = lf - msm, rt - msm
    finish(d)


def inherit(decks, polys):
    """a deck takes bridge:structure from the man_made=bridge polygon that holds most of it (over half)"""
    tagged = [q for q in polys if 'bridge:structure' in q['tags']]
    if not tagged:
        return
    pt = STRtree([q['poly'] for q in tagged])
    for d in decks:
        if d['tags'].get('bridge:structure'):
            continue
        best = 0.5
        for j in pt.query(d['line']):
            sh = tagged[j]['poly'].buffer(3).intersection(d['line']).length / max(1.0, d['length'])
            if sh > best:
                best = sh
                d['tags']['bridge:structure'] = tagged[j]['tags']['bridge:structure']


def _end(d, e):
    """(point, outward unit direction) of a deck's end e (0 start, 1 end)"""
    c = shapely.get_coordinates(d['line'])
    p = c[0] if e == 0 else c[-1]
    L = d['length']
    q = shapely.get_coordinates(shapely.line_interpolate_point(d['line'], min(10.0, L / 2) if e == 0 else max(0.0, L - 10.0)))[0]
    u = p - q
    return p, u / max(1e-6, float(np.hypot(*u)))


def _joined(a, ea, b, eb):
    """deck a's end ea and deck b's end eb joined by a straight gap: one deck"""
    ca, cb = shapely.get_coordinates(a['line']), shapely.get_coordinates(b['line'])
    sa, la, ra = a['s'], a['left'], a['right']
    if ea == 0:  # (a runs into the gap)
        ca, la, ra, sa = ca[::-1], la[::-1], ra[::-1], a['length'] - sa[::-1]
    sb, lb, rb = b['s'], b['left'], b['right']
    if eb == 1:  # (b runs out of it)
        cb, lb, rb, sb = cb[::-1], lb[::-1], rb[::-1], b['length'] - sb[::-1]
    gap = float(np.hypot(*(cb[0] - ca[-1])))
    line = LineString(np.vstack([ca, cb[1:]]) if gap < 0.01 else np.vstack([ca, cb]))
    # (edges across the gap: straight from one deck's to the other's)
    s = np.r_[sa, a['length'] + gap + sb]
    out = dict(a, line=line, s=s, left=np.r_[la, lb], right=np.r_[ra, rb], members=a['members'] + b['members'], levels=a['levels'] | b['levels'],
               uses=a['uses'] | b['uses'], coreLevels=a['coreLevels'] | b['coreLevels'], stacked=a['stacked'] or b['stacked'],
               name=a['name'] or b['name'], tags=dict(b['tags'], **a['tags']), joins=a.get('joins', []) + b.get('joins', []) + [round(gap, 1)])
    finish(out)
    return out


def join(decks, sups, kept=None):
    """Two decks of one bridge join across a gap of up to JOIN_GAP m: a bridge_support row within JOIN_TOUCH m of both ends
    (the Golden Gate's North Anchor), or one name, lined up within JOIN_ANGLE degrees, across a gap shorter than either
    deck and with no kept street of the decks' own use on the ground along it (two overpasses of one freeway with the
    road at grade between them stay two). Either way one deck carries on from the other (within 45 degrees). Only ends
    no other deck meets within SHARED m join. kept: the bake's ground segments (osm.segments())."""
    from scipy.spatial import cKDTree
    rows = [s['g'] for s in sups if s['kind'] == 'support']
    st = STRtree(rows) if rows else None
    kl = [q[0] for q in kept or ()]
    kt = STRtree(kl) if kl else None
    cos_max = math.cos(math.radians(JOIN_ANGLE))
    cos_loose = math.cos(math.radians(45.0))
    while True:
        lines = [d['line'] for d in decks]
        lt = STRtree(lines)
        ends = []
        for k, d in enumerate(decks):
            for e in (0, 1):
                p, u = _end(d, e)
                if not any(m != k and lines[m].distance(Point(p)) <= SHARED for m in lt.query(Point(p), predicate='dwithin', distance=SHARED)):
                    ends.append((k, e, p, u))
        if len(ends) < 2:
            return decks
        P = np.array([q[2] for q in ends])
        pairs = sorted(cKDTree(P).query_pairs(JOIN_GAP), key=lambda ij: float(np.hypot(*(P[ij[0]] - P[ij[1]]))))
        done = None
        for i, j in pairs:
            (ka, ea, pa, ua), (kb, eb, pb, ub) = ends[i], ends[j]
            a, b = decks[ka], decks[kb]
            if ka == kb or not (a['uses'] & b['uses']):
                continue
            gap = LineString([pa, pb]) if np.hypot(*(pb - pa)) > 0.01 else None
            v = (pb - pa) / gap.length if gap is not None else ua
            # (one deck carries on from the other: never two carriageways' ends side by side on one abutment)
            if float(ua @ -ub) < cos_loose or float(ua @ v) < cos_loose or float(-ub @ v) < cos_loose:
                continue
            by = None
            if st is not None:
                for r in st.query(Point(pa), predicate='dwithin', distance=JOIN_TOUCH):
                    if rows[r].distance(Point(pb)) <= JOIN_TOUCH:
                        by = 'support'
                        break
            # (by name only across a hole shorter than either deck: two short bridges of one street further apart are two)
            if by is None and a['name'] and a['name'] == b['name'] and gap is not None and gap.length < min(a['length'], b['length']):
                if float(ua @ v) >= cos_max and float(-ub @ v) >= cos_max:
                    along = 0.0
                    if kt is not None:
                        band = gap.buffer(4.0, cap_style='flat')
                        own = {'road': (0,), 'rail': (7,), 'foot': (3, 4, 5)}  # (osm ground kinds: PAVED, RAIL, SIDEWALK / PLAZA / PATH)
                        kinds = {k for u in a['uses'] for k in own.get(u, ())}
                        along = sum(kl[m].intersection(band).length for m in kt.query(band) if kept[m][1] in kinds)
                    if along < 0.5 * gap.length:
                        by = 'name'
            if by:
                done = (ka, ea, kb, eb, by)
                break
        if not done:
            return decks
        ka, ea, kb, eb, by = done
        nd = _joined(decks[ka], ea, decks[kb], eb)
        nd['joinedBy'] = decks[ka].get('joinedBy', []) + decks[kb].get('joinedBy', []) + [by]
        decks = [d for k, d in enumerate(decks) if k not in (ka, kb)] + [nd]


def clip(decks, frame):
    """a deck stops at the frame edge (each piece inside it is a deck of its own); that end is open"""
    out = []
    edge = frame.exterior
    for d in decks:
        d['edge'] = [False, False]
        if frame.contains(d['line']):
            out.append(d)
            continue
        part = d['line'].intersection(frame)
        for g in (part.geoms if hasattr(part, 'geoms') else [part]):
            if g.geom_type != 'LineString' or g.length < MIN_DECK:
                continue
            c = shapely.get_coordinates(g)
            s0 = d['line'].project(Point(c[0]))
            s = s0 + np.r_[0.0, np.cumsum(np.hypot(*np.diff(c, axis=0).T))]
            nd = dict(d, line=g, s=s - s0, left=np.interp(s, d['s'], d['left']), right=np.interp(s, d['s'], d['right']),
                      edge=[edge.distance(Point(c[0])) < 0.01, edge.distance(Point(c[-1])) < 0.01], clipped=True)
            finish(nd)
            out.append(nd)
    return out


# ------------------------------------------------------------------------------------------------------------ the ground
class Ground:
    """What a deck stands on, inside the frame: the terrain's heights (bilinear, as gameplay reads them, hgt: vertices
    every `cell` m from the frame's corner) and the 2 m ground classes (cls, row 0 = minZ; water is WATER). Outside the
    frame nothing is known. in_building(xz): an end inside a baked building's footprint (a terminal)."""
    WATER = 2

    def __init__(self, bounds, cls, res, hgt, cell, city=None):
        self.minX, self.minZ, self.maxX, self.maxZ = bounds
        self.cls, self.res, self.hgt, self.cell, self.city = cls, res, hgt, cell, city

    @classmethod
    def baked(cls_, city):
        """from a baked city dir (citydata.City): an all-water tile the bake didn't write is water at height 0"""
        m = city.manifest
        minX, minZ, maxX, maxZ = m['bounds']
        T, n, N = m['tileSize'], city.classN, m.get('terrainN', 65)
        res, cell = T / n, T / (N - 1)
        W, H = int(round((maxX - minX) / res)), int(round((maxZ - minZ) / res))
        Wc, Hc = int(round((maxX - minX) / cell)), int(round((maxZ - minZ) / cell))
        cls = np.full((H, W), cls_.WATER, np.uint8)
        hgt = np.zeros((Hc + 1, Wc + 1), np.float32)
        for t in city.terrain_tiles():
            j0, i0 = int(round((t['originX'] - minX) / res)), int(round((t['originZ'] - minZ) / res))
            if 0 <= i0 <= H - n and 0 <= j0 <= W - n:
                cls[i0:i0 + n, j0:j0 + n] = t['cls']
            a0, b0 = int(round((t['originX'] - minX) / cell)), int(round((t['originZ'] - minZ) / cell))
            if 0 <= b0 <= Hc - (N - 1) and 0 <= a0 <= Wc - (N - 1):
                hgt[b0:b0 + N, a0:a0 + N] = t['heights']
        return cls_((minX, minZ, maxX, maxZ), cls, res, hgt, cell, city)

    def inside(self, xz):
        xz = np.asarray(xz, float).reshape(-1, 2)
        return (xz[:, 0] >= self.minX) & (xz[:, 0] < self.maxX) & (xz[:, 1] >= self.minZ) & (xz[:, 1] < self.maxZ)

    def at(self, xz):
        """(height m, water bool) at points; outside the frame nan and False"""
        xz = np.asarray(xz, float).reshape(-1, 2)
        ok = self.inside(xz)
        Hc, Wc = self.hgt.shape
        fx = np.clip((xz[:, 0] - self.minX) / self.cell, 0, Wc - 1.001)
        fz = np.clip((xz[:, 1] - self.minZ) / self.cell, 0, Hc - 1.001)
        i, j = fx.astype(int), fz.astype(int)
        a, b = fx - i, fz - j
        h = self.hgt
        y = (h[j, i] * (1 - a) + h[j, i + 1] * a) * (1 - b) + (h[j + 1, i] * (1 - a) + h[j + 1, i + 1] * a) * b
        H, W = self.cls.shape
        ci = np.clip(((xz[:, 1] - self.minZ) / self.res).astype(int), 0, H - 1)
        cj = np.clip(((xz[:, 0] - self.minX) / self.res).astype(int), 0, W - 1)
        wet = (self.cls[ci, cj] == self.WATER) & ok
        return np.where(ok, y, np.nan), wet

    def in_building(self, xz, reach=0.0):
        """points inside a baked building's footprint, or within `reach` m of one"""
        xz = np.asarray(xz, float).reshape(-1, 2)
        out = np.zeros(len(xz), bool)
        if self.city is None or not len(xz):
            return out
        near = set()
        for x, z in xz:
            near |= self.city.tiles_around(x, z, 1.0 + reach)
        rings = []
        for t in self.city.building_tiles(near):
            vs, ring = t['vertStart'], t['xz']
            rings += [ring[vs[i]:vs[i + 1]] for i in range(t['count']) if vs[i + 1] - vs[i] >= 3]
        if not rings:
            return out
        polys = shapely.make_valid(shapely.polygons([shapely.linearrings(r) for r in rings]))
        bt = STRtree(polys)
        pi, _ = bt.query(shapely.points(xz), predicate='dwithin', distance=reach) if reach > 0 else bt.query(shapely.points(xz), predicate='intersects')
        out[np.unique(pi)] = True
        return out


# ---------------------------------------------------------------------------------------------------------- the heights
def clear_water(run):
    """the deck's top over a water crossing of `run` m: 2.6 m for a 25 m canal, 5.4 m for the Serpentine's 86 m, 80 m at most"""
    return float(np.clip(1.5 + 0.045 * run, 1.5, 80.0))


def water_run(w, step, bridge=JOIN_GAP):
    """the longest crossing of water along a deck (m): gaps under `bridge` m (a pier, a mole) are the same crossing"""
    e = np.flatnonzero(np.diff(np.r_[0, w.astype(int), 0]))
    if not len(e):
        return 0.0
    runs = [[int(a), int(b)] for a, b in zip(e[::2], e[1::2])]
    out = [runs[0]]
    for a, b in runs[1:]:
        if (a - out[-1][1]) * step < bridge:
            out[-1][1] = b
        else:
            out.append([a, b])
    return float(max(b - a for a, b in out) * step)


def envelope(y, s, g):
    """y lifted so that it never falls faster than grade g"""
    out = y.copy()
    for i in range(1, len(s)):
        out[i] = max(out[i], out[i - 1] - g * (s[i] - s[i - 1]))
    for i in range(len(s) - 2, -1, -1):
        out[i] = max(out[i], out[i + 1] - g * (s[i + 1] - s[i]))
    return out


def sample(decks, ground):
    for d in decks:
        s, p, t = frames_along(d['line'], STEP)
        g, wet = ground.at(p)
        g = np.where(np.isnan(g), 0.0, g)  # (clipped: only a deck's last metres can reach past the edge)
        d.update(ss=s, xz=p, tan=t, g=g, water=wet)
        d['mainUse'] = 'rail' if 'rail' in d['uses'] and 'road' not in d['uses'] else 'foot' if d['uses'] == {'foot'} else 'road'
        d['waterRun'] = water_run(wet, STEP)
        d['waterLen'] = float(wet.mean() * d['length'])


def target(d):
    """the rule's top before its ends: over water by the crossing's length, over land the ground plus a storey per level"""
    lv = max(1, max(d['levels'] or {1}))  # (a stack's top level is what shows)
    t = np.where(d['water'], clear_water(d['waterRun']), d['g'] + STOREY * lv)
    k = 7  # (a deck doesn't follow every curb: smoothed over 150 m)
    tt = np.convolve(np.r_[np.full(k, t[0]), t, np.full(k, t[-1])], np.ones(2 * k + 1) / (2 * k + 1), mode='valid')
    return np.maximum(t, tt) if d['waterRun'] else tt


def ends_of(decks, ground, kept):
    """each end's kind: 'shared' (another deck within SHARED m), 'edge' (the frame's), 'lands' (a kept way within
    LAND_REACH m: it comes down to the ground), 'terminal' (inside a building), else 'open' (it keeps its height)"""
    lines = [d['line'] for d in decks]
    lt = STRtree(lines)
    kt = STRtree([q[0] for q in kept]) if kept else None
    pts = []
    for k, d in enumerate(decks):
        c = shapely.get_coordinates(d['line'])
        d['near'] = [[], []]
        d['ends'] = ['open', 'open']
        for e, p in ((0, c[0]), (1, c[-1])):
            pt = Point(p)
            d['near'][e] = [m for m in lt.query(pt, predicate='dwithin', distance=SHARED) if m != k and lines[m].distance(pt) <= SHARED]
            if d['near'][e]:
                d['ends'][e] = 'shared'
            elif d.get('edge', [False, False])[e]:
                d['ends'][e] = 'edge'
            elif kt is not None and len(kt.query(pt, predicate='dwithin', distance=LAND_REACH)):
                d['ends'][e] = 'lands'
            else:
                pts.append((k, e, p))
    if pts:
        inb = ground.in_building(np.array([p for _, _, p in pts]))
        for (k, e, _), b in zip(pts, inb):
            if b:
                decks[k]['ends'][e] = 'terminal'


def solve(decks, rounds=4):
    """the rule's profile: shared ends meet the other deck's height, a landing end comes down to LANDING m over the ground
    at up to GMAX, open, edge and terminal ends keep their height; nothing falls faster than GRADE"""
    for d in decks:
        d['base'] = target(d)
        d['y'] = d['base'].copy()
    for r in range(rounds):
        for d in decks:
            g, gm = GRADE[d['mainUse']], GMAX[d['mainUse']]
            y = d['base'].copy()
            for e, idx in ((0, 0), (1, -1)):
                if d['ends'][e] == 'shared' and r > 0:
                    p = d['xz'][idx]
                    y[idx] = max(y[idx], max(decks[m]['y'][int(np.argmin(np.hypot(*(decks[m]['xz'] - p).T)))] for m in d['near'][e]))
            y = envelope(y, d['ss'], g)
            for e, idx in ((0, 0), (1, -1)):
                dist = np.abs(d['ss'] - d['ss'][idx])
                if d['ends'][e] == 'lands':
                    y = np.minimum(y, d['g'][idx] + LANDING + gm * dist)
                elif d['ends'][e] == 'shared' and r > 0:
                    p = d['xz'][idx]
                    y = np.minimum(y, max(decks[m]['y'][int(np.argmin(np.hypot(*(decks[m]['xz'] - p).T)))] for m in d['near'][e]) + gm * dist)
            d['y'] = y
    for d in decks:
        d['hAbove'] = d['y'] - np.maximum(d['g'], 0)


# ------------------------------------------------------------------------------------------------------------ the classes
def classify(d, tws, kept_tree):
    """XL, L, M or S by BRIDGES.md "What gets drawn, by size": the first row that matches"""
    L = d['length']
    # (a tower's height tag is over its own ground, a deck's top over the sea: on land the two differ by the ground)
    d['towers'] = [t for t in tws if t['top'] is not None and d['line'].distance(Point(t['xz'])) <= TOWER_REACH
                   and t.get('base', 0.0) + t['top'] >= d['y'].max() + TOWER_OVER]
    near = [t for t in tws if t['top'] is not None and d['line'].distance(Point(t['xz'])) <= TOWER_REACH]
    st = d['tags'].get('bridge:structure')
    # (something under it: a kept road or rail meets the deck away from its ends; a street that carries on from an end isn't)
    mid = substring(d['line'], 6.0, max(6.1, L - 6.0)) if L > 14 else None
    d['crosses'] = mid is not None and kept_tree is not None and len(kept_tree.query(mid, predicate='intersects')) > 0
    d['hMax'] = float(np.percentile(d['hAbove'], 90))
    arch = st in ARCH or d['tags'].get('bridge') == 'humpback'
    if L >= LONG and (d['towers'] or (st in SUSP and near)):
        return 'XL'
    if L >= LONG:
        return 'L'
    if not arch and not d['crosses']:
        if d['waterLen'] > 0 and clear_water(d['waterRun']) < LOW:
            return 'S'  # (a low crossing of a canal or a stream: ground)
        if d['uses'] == {'foot'} and d['hMax'] < LOW:
            return 'S'
        if L < SHORT:
            return 'S'
    return 'M'


def through_towers(d):
    """an XL deck pulled through its towers' centres: the shift at each tower, straight between them, tapering off over
    RECENTRE m past the outer ones. A tower further off than half the deck's width stands beside it (one pylon between
    two decks): it doesn't pull, and is kept in d['towersBeside']"""
    s, p, t = frames_along(d['line'], STEP / 2, CHORD)
    n = np.column_stack([-t[:, 1], t[:, 0]])
    at, d['towersBeside'] = [], []
    for tw in d['towers']:
        q = np.asarray(tw['xz'])
        st = d['line'].project(Point(q))
        on = np.array(d['line'].interpolate(st).coords[0])
        k = int(np.argmin(np.abs(s - st)))
        o = float((q - on) @ n[k])
        if abs(o) > d['width'] / 2:
            d['towersBeside'].append(tw)
        else:
            at.append((st, o))
    if not at:
        return
    at.sort()
    S, O = np.array([a for a, _ in at]), np.array([b for _, b in at])
    off = np.interp(s, S, O)
    off *= np.clip(1 - (S[0] - s) / RECENTRE, 0, 1) * np.clip(1 - (s - S[-1]) / RECENTRE, 0, 1)
    c = p + n * off[:, None]
    lf, rt = np.interp(s, d['s'], d['left']) - off, np.interp(s, d['s'], d['right']) - off
    f0 = d['ss'] / max(1e-6, d['length'])
    d['line'] = LineString(c)
    d['s'] = np.r_[0.0, np.cumsum(np.hypot(*np.diff(c, axis=0).T))]
    d['left'], d['right'] = lf, rt
    d['towerShift'] = float(np.abs(O).max())
    finish(d)
    # (the profile rides along: the same share of the way along the moved line)
    ss, xz, tan = frames_along(d['line'], STEP)
    f1 = ss / max(1e-6, d['length'])
    d.update(ss=ss, xz=xz, tan=tan, **{k: np.interp(f1, f0, d[k]) for k in ('g', 'y', 'base', 'hAbove')},
             water=np.interp(f1, f0, d['water'].astype(float)) >= 0.5)


def claim(decks, heroes):
    """the decks a hero's kit draws: over HERO_CLAIM of the deck's length on the hero's deck line (its half width + 6 m).
    heroes: [(kind, LineString of the drawn deck, half width)]"""
    zones = [(k, line.buffer(half + 6.0, cap_style='flat')) for k, line, half in heroes]
    for d in decks:
        d['hero'] = None
        for k, z in zones:
            if d['line'].intersection(z).length >= HERO_CLAIM * d['length']:
                d['hero'] = k
                break


def plan(osm, ground, kept, heroes=(), log=_log):
    """The decks of a city's frame (osm.frame): built, joined, filtered, clipped, profiled by the rule and classed.
    kept: the bake's ground segments (osm.segments(): [(line, kind, width, name, cls)]). heroes: see claim().
    Returns {'decks', 'towers', 'supports', 'polygons', 'ways'}; a deck's 'cls' is XL / L / M / S, 'skip' says why a deck
    gets nothing ('tram': a tram-only S deck), 'hero' names the kit that draws it."""
    t0 = time.time()
    ways, polys, sups = load(osm)
    if not ways:
        log('no bridge ways in the frame')
        return {'decks': [], 'towers': towers(sups, ground), 'supports': sups, 'polygons': polys, 'ways': ways}
    decks = build(ways)
    n0 = len(decks)
    for d in decks:
        recentre(d)
    inherit(decks, polys)
    decks = join(decks, sups, kept)
    nj = n0 - len(decks)
    decks = clip(decks, osm.frame)
    sample(decks, ground)
    ends_of(decks, ground, kept)
    solve(decks)
    tws = towers(sups, ground)
    kt = STRtree([q[0] for q in kept if q[1] in (0, 7)]) if kept else None  # (PAVED, RAIL: what passes under a deck)
    for d in decks:
        d['cls'] = classify(d, tws, kt)
        d['skip'] = 'tram' if d['cls'] == 'S' and d['ways'] and all(w['tram'] for w in d['ways']) else None
        if d['cls'] == 'XL':
            through_towers(d)
    claim(decks, heroes)
    by = {c: [d for d in decks if d['cls'] == c and not d['skip']] for c in CLASSES}
    log(f'{len(ways)} bridge ways -> {n0} decks, {nj} joins, {len(decks)} after the frame edge: ' +
        ', '.join(f'{c} {len(v)} ({sum(d["length"] for d in v) / 1000:.2f} km)' for c, v in by.items()) +
        f'; {sum(1 for d in decks if d["skip"])} tram-only S skipped; {len(tws)} towers; in {time.time() - t0:.0f} s')
    return {'decks': decks, 'towers': tws, 'supports': sups, 'polygons': polys, 'ways': ways}


def hero_rows(man):
    """[(kind, LineString, half width)] of a baked city.json's landmark rows that draw a deck (Bridges.ts's kits)"""
    out = []
    for lm in man.get('landmarks', []):
        if lm.get('deck') and lm['kind'] in HERO_KIT and len(lm['deck']) >= 2:
            out.append((lm['kind'], LineString([(x, z) for x, z, _ in lm['deck']]), HERO_KIT[lm['kind']]['half']))
    return out


def open_spans(decks):
    """spans of OPEN_SPAN m or more with no tower and no structure tag: the thin-data case the gate can't measure"""
    return [d for d in decks if d['length'] >= OPEN_SPAN and not d['towers'] and not d['tags'].get('bridge:structure')]


def main():
    from pyproj import Transformer
    from citydata import City
    import osm as O
    sys.stdout.reconfigure(errors='backslashreplace')
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    slug = args[0] if args else 'sf'
    city_dir = flags.get('dir') or os.path.join(ROOT, 'public', 'city', slug)
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json'), encoding='utf8'))
    city = City(city_dir)
    man = city.manifest
    osm = O.OSM(cfg, slug, Transformer.from_crs('EPSG:4326', man['proj'], always_xy=True), lambda *a: None)
    osm.set_frame(*man['bounds'])
    inv = Transformer.from_crs(man['proj'], 'EPSG:4326', always_xy=True)
    ground = Ground.baked(city)
    p = plan(osm, ground, osm.segments(), hero_rows(man))
    decks = p['decks']

    def ll(x, z):
        lo, la = inv.transform(x, -z)
        return f'{la:.5f}, {lo:.5f}'
    for c in CLASSES:
        v = [d for d in decks if d['cls'] == c]
        print(f'{c:2s} {len(v):4d} decks {sum(d["length"] for d in v) / 1000:6.2f} km, {sum(d["waterLen"] for d in v) / 1000:5.2f} km over water, '
              f'{sum(1 for d in v if d["skip"])} skipped')
    for d in sorted([d for d in decks if d['cls'] == 'XL'], key=lambda d: -d['length']):
        print(f'  XL {d["length"]:6.0f} m {d["width"]:4.1f} m wide, {len(d["towers"])} towers, {d["tags"].get("bridge:structure", "")}, '
              f'{d["name"] or "(unnamed)"}, hero {d["hero"]}, joins {d.get("joins", [])} {d.get("joinedBy", [])}')
    print('towers', [(t['ref'], t['top'], ll(*t['xz'])) for t in p['towers']])
    for k in sorted({d['hero'] for d in decks if d['hero']}):
        v = [d for d in decks if d['hero'] == k]
        print(f'hero {k}: {len(v)} decks {sum(d["length"] for d in v):.0f} m, ways {sorted({i for d in v for i in d["ids"]})}')
    ends = [(d, e) for d in decks for e in (0, 1) if d['cls'] != 'S']
    from collections import Counter
    print('meshed decks\' ends', dict(Counter(d['ends'][e] for d, e in ends)))
    print('open spans of 1 km or more with no tower and no structure tag', [(round(d['length']), d['name'], ll(*d['xz'][len(d['xz']) // 2])) for d in open_spans(decks)])
    if 'list' in flags:
        for d in sorted(decks, key=lambda d: -d['length']):
            print(f'  {d["cls"]:2s} {d["length"]:7.1f} m w {d["width"]:4.1f} {sorted(d["uses"])} lv {sorted(d["levels"])} top {d["y"].min():5.1f}-{d["y"].max():5.1f} '
                  f'water {d["waterLen"]:5.0f} ends {d["ends"]} {d["tags"].get("bridge:structure", "")} {d["name"]} {ll(*d["xz"][len(d["xz"]) // 2])}'
                  + (f' joins {d["joins"]} by {d["joinedBy"]}' if d.get('joins') else '') + (f' hero {d["hero"]}' if d['hero'] else ''))


if __name__ == '__main__':
    main()
