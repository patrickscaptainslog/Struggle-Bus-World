#!/usr/bin/env python3
"""A deck's height where nothing measured it: the bridges spec's rule (docs/specs/bridges/BRIDGES.md, "Height profile").
Written once, for life's graphs now (tools/bake/graphs.py) and for bridges step 5 later, so the two agree by construction.

The rule, on a deck's samples (every 4 m or less along it, joined where the deck's pieces meet):
  over water   1.5 m + 4.5 % of the crossing's water length, 1.5 to 80 m, over the water's surface: the sea's datum, 0,
               or a lake's own height (a footbridge in Golden Gate Park stood 66 m under its lake from 0);
               land gaps up to 120 m stay one crossing
  over land    the ground, smoothed, plus 5.5 m a level (a deck with no level is level 1)
  stacked      over water too, 5.5 m a level over level 1, so a lower deck stays under the top
  coming down  never faster than 3 % (road), 2 % (rail) or 6 % (foot)
  a free end   on the ground where a kept road or path meets it, coming up at 6 %, 3.5 % or 10 %
  crossing     a deck over another structure's lower one 5.5 m a level over it, one under a higher one as far under
               (Stacked: San Francisco's level-2 footbridge over a level-1 road came down to its steps under it)
  fixed        heights the deck must take: a deck City draws (C2), a sidewalk riding its carriageway; the rule runs
               on from them
  the ground   never under it on land: a ramp from a free end at a hill's foot ran 79 m into the hill
Not here: LiDAR (none on these decks tonight), and "never lower than 1 m over a building under it".
Tunnels, under(): never over the ground, and 5.5 m a level under it away from their ends, going down at a road's or a
railway's end grade, or a stair's on foot.

  from decks import profile, Stacked
  placed = Stacked()                                   # structures lowest level first
  lo, hi = placed.bounds(xs, zs, level)
  y = profile(ground, water, level, grade, links, anchors, lo, hi, base, fixed)
  placed.add(xs, zs, level, y)
"""
import heapq

import numpy as np

LEVEL_M = 5.5                      # a level's rise
WATER_BASE, WATER_K, WATER_MAX = 1.5, 0.045, 80.0
GAP_M = 120.0                      # land between two waters that still counts as one crossing
SMOOTH_M = 16.0                    # the ground's smoothing, each way
GRADE_DOWN = (0.03, 0.02, 0.06)    # by grade class: 0 road, 1 rail, 2 foot
GRADE_END = (0.06, 0.035, 0.10)
# a tunnel's or covered way's way down from an end: a road's and a railway's as a free end's, a footway's a stair's. At
# 10 % the Embarcadero Center's covered sidewalks, between the street and stairs up to its podium at 16.6 m, stood
# 2.5 m over the street 100 m from the stairs
GRADE_STAIR = (0.06, 0.035, 0.5)


def water_rise(length):
    return min(WATER_MAX, max(WATER_BASE, WATER_BASE + WATER_K * length))


class _Union:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, a):
        p = self.p
        while p[a] != a:
            p[a] = p[p[a]]
            a = p[a]
        return a

    def join(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.p[max(a, b)] = min(a, b)


def profile(ground, water, level, grade, links, anchors, floor=None, cap=None, base=None, fixed=None):
    """Heights (m) for n samples of one deck component.
    ground: n floats, the ground's height there (any value where water); water: n bools; level: n ints (Overture's
    level_rules, 0 none); grade: n ints, the grade class (0 road, 1 rail, 2 foot); links: (i, j, metres) between
    neighbouring samples; anchors: {i: height}, the ends that stand on the ground. floor, cap: n floats or None, the
    heights another structure crossing here leaves it (stacked(), below): over a lower deck at least 5.5 m a level
    up, under a higher one as far down; they win over the rule, but not over an anchor. base: n floats or None, the
    water's surface under each water sample (0 the sea, a lake's height), a crossing over its highest. fixed: {i:
    height} or None, heights the deck takes (a drawn deck's top): the rule comes down from them, never moves them, and
    an anchor still wins. On land the deck is never under the ground. Returns n floats."""
    n = len(ground)
    ground = np.asarray(ground, float)
    water = np.asarray(water, bool)
    lv = np.maximum(np.asarray(level, int), 1)
    fixed = fixed or {}
    pinned = np.zeros(n, bool)
    for i in fixed:
        pinned[i] = True
    nb = [[] for _ in range(n)]
    for i, j, d in links:
        nb[i].append((j, d))
        nb[j].append((i, d))
    # crossings: water samples joined along the deck, and across land runs of GAP_M or less between two waters
    u = _Union(n)
    for i, j, d in links:
        if water[i] and water[j]:
            u.join(i, j)
    land = _Union(n)
    for i, j, d in links:
        if not water[i] and not water[j]:
            land.join(i, j)
    run_len, run_wet = {}, {}
    for i, j, d in links:
        if not water[i] and not water[j]:
            r = land.find(i)
            run_len[r] = run_len.get(r, 0.0) + d
        elif water[i] != water[j]:
            dry, wet = (i, j) if not water[i] else (j, i)
            run_wet.setdefault(land.find(dry), set()).add(wet)
    for r, wets in run_wet.items():
        if run_len.get(r, 0.0) <= GAP_M and len(wets) > 1:
            w = sorted(wets)
            for k in w[1:]:
                u.join(w[0], k)
    wet_len = {}
    for i, j, d in links:
        share = (0.5 if water[i] else 0.0) + (0.5 if water[j] else 0.0)
        if share:
            r = u.find(i if water[i] else j)
            wet_len[r] = wet_len.get(r, 0.0) + d * share
    wet_base = {}
    if base is not None:
        for i in np.nonzero(water)[0]:
            r = u.find(int(i))
            wet_base[r] = max(wet_base.get(r, -np.inf), float(base[i]))
    # the ground, smoothed along the deck: a mean over the samples within SMOOTH_M by the deck's own links
    g = ground.copy()
    if (~water).any():
        sm = np.empty(n)
        for i in range(n):
            if water[i]:
                sm[i] = g[i]
                continue
            seen = {i: 0.0}
            todo = [(0.0, i)]
            acc, cnt = 0.0, 0
            while todo:
                d0, a = heapq.heappop(todo)
                if d0 > seen.get(a, 1e18):
                    continue
                if not water[a]:
                    acc += g[a]
                    cnt += 1
                for b, d in nb[a]:
                    nd = d0 + d
                    if nd <= SMOOTH_M and nd < seen.get(b, 1e18):
                        seen[b] = nd
                        heapq.heappush(todo, (nd, b))
            sm[i] = acc / cnt if cnt else g[i]
        g = sm
    h = np.empty(n)
    for i in range(n):
        if water[i]:
            r = u.find(i)
            h[i] = wet_base.get(r, 0.0) + water_rise(wet_len.get(r, 0.0)) + LEVEL_M * (lv[i] - 1)
        else:
            h[i] = g[i] + LEVEL_M * lv[i]
    for i, y in fixed.items():
        h[i] = y
    # coming down no faster than the grade: every sample at least its neighbour's height less the grade times the way
    down = np.array([GRADE_DOWN[c] for c in grade]) if n else np.zeros(0)
    todo = [(-h[i], i) for i in range(n)]
    heapq.heapify(todo)
    while todo:
        nh, a = heapq.heappop(todo)
        if -nh < h[a] - 1e-9:
            continue
        for b, d in nb[a]:
            c = h[a] - min(down[a], down[b]) * d
            if c > h[b] + 1e-9 and not pinned[b]:
                h[b] = c
                heapq.heappush(todo, (-c, b))
    # free ends on the ground, the deck coming up from them no steeper than the end's grade
    if anchors:
        up = np.array([GRADE_END[c] for c in grade])
        ramp = np.full(n, np.inf)
        todo = []
        for i, y in anchors.items():
            ramp[i] = y
            todo.append((y, i))
        heapq.heapify(todo)
        while todo:
            c0, a = heapq.heappop(todo)
            if c0 > ramp[a] + 1e-9:
                continue
            for b, d in nb[a]:
                c = ramp[a] + min(up[a], up[b]) * d
                if c < ramp[b] - 1e-9:
                    ramp[b] = c
                    heapq.heappush(todo, (c, b))
        h = np.where(pinned, h, np.minimum(h, ramp))
    if floor is not None:
        h = np.where(pinned, h, np.maximum(h, floor))
    if cap is not None:
        h = np.where(pinned, h, np.minimum(h, cap))
    # never under the ground on land: a ramp's grade from a free end at a hill's foot, or a cap, would put it inside
    h = np.where(water | pinned, h, np.maximum(h, ground))
    for i, y in (anchors or {}).items():
        h[i] = y
    return h


def under(ground, level, grade, links, anchors):
    """The highest a tunnel's samples may stand: never over the ground (the sea's or a lake's bed where wet), and
    LEVEL_M a level under it (a covered way at level 0: at it) away from the ends it stands on, going down from each at
    GRADE_STAIR (6 %, 3.5 %, or a stair's 50 % on foot). An end over the ground (a deck's free end at a portal: Yerba
    Buena Island's east one) comes down from its own height at that grade, not off a cliff. A straight line between two
    portals ran 48 m over the Bay. anchors: {i: height}. Returns n floats."""
    n = len(ground)
    ground = np.asarray(ground, float)
    depth = LEVEL_M * np.maximum(0, -np.asarray(level, int))
    up = np.array([GRADE_STAIR[c] for c in grade]) if n else np.zeros(0)
    nb = [[] for _ in range(n)]
    for i, j, d in links:
        nb[i].append((j, d))
        nb[j].append((i, d))
    # how far down it can be at each sample: the end grade times the way from the nearest end, at most its depth
    reach = np.full(n, np.inf)
    todo = []
    for i in anchors:
        reach[i] = 0.0
        todo.append((0.0, i))
    heapq.heapify(todo)
    while todo:
        c0, a = heapq.heappop(todo)
        if c0 > reach[a] + 1e-9:
            continue
        for b, d in nb[a]:
            c = reach[a] + min(up[a], up[b]) * d
            if c < reach[b] - 1e-9:
                reach[b] = c
                heapq.heappush(todo, (c, b))
    # coming down from each end's own height at the end grade
    ramp = np.full(n, -np.inf)
    todo = []
    for i, y in anchors.items():
        ramp[i] = y
        todo.append((-y, i))
    heapq.heapify(todo)
    while todo:
        c0, a = heapq.heappop(todo)
        if -c0 < ramp[a] - 1e-9:
            continue
        for b, d in nb[a]:
            c = ramp[a] - min(up[a], up[b]) * d
            if c > ramp[b] + 1e-9:
                ramp[b] = c
                heapq.heappush(todo, (-c, b))
    return np.maximum(ground - np.minimum(depth, reach), ramp)


class Stacked:
    """The decks placed so far, so a deck crossing another keeps their levels apart: placed lowest level first, each
    sample within REACH_M in plan of another structure's deck takes a floor over a lower one and a cap under a higher
    one, LEVEL_M a level (at least one level, so a level-0 bridge and a level-1 one stay apart too)."""
    REACH_M = 3.0

    def __init__(self):
        self.cells = {}

    def bounds(self, xs, zs, levels):
        n = len(xs)
        lo = np.full(n, -np.inf)
        hi = np.full(n, np.inf)
        R = self.REACH_M
        for i in range(n):
            cx, cz = int(np.floor(xs[i] / R)), int(np.floor(zs[i] / R))
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for x, z, lv, y in self.cells.get((cx + dx, cz + dz), ()):
                        if (x - xs[i]) ** 2 + (z - zs[i]) ** 2 > R * R or lv == levels[i]:
                            continue
                        gap = LEVEL_M * max(1, abs(max(levels[i], 1) - max(lv, 1)))
                        if lv < levels[i]:
                            lo[i] = max(lo[i], y + gap)
                        else:
                            hi[i] = min(hi[i], y - gap)
        return (None if np.isinf(lo).all() else lo), (None if np.isinf(hi).all() else hi)

    def add(self, xs, zs, levels, ys):
        R = self.REACH_M
        for x, z, lv, y in zip(xs, zs, levels, ys):
            self.cells.setdefault((int(np.floor(x / R)), int(np.floor(z / R))), []).append((float(x), float(z), int(lv), float(y)))


def along(ys, links, anchors, n):
    """A tunnel's heights: straight between the ends it stands on, by the way along it. ys: {i: height} for the
    anchors; with one anchor every sample takes it; with several, each sample the anchors' heights weighted by the
    inverse of their distance along the tunnel (on a plain tunnel with two ends, a straight line)."""
    nb = [[] for _ in range(n)]
    for i, j, d in links:
        nb[i].append((j, d))
        nb[j].append((i, d))
    num = np.zeros(n)
    den = np.zeros(n)
    exact = {}
    for a, y in sorted(anchors.items()):
        dist = np.full(n, np.inf)
        dist[a] = 0.0
        todo = [(0.0, a)]
        while todo:
            d0, p = heapq.heappop(todo)
            if d0 > dist[p]:
                continue
            for q, d in nb[p]:
                if d0 + d < dist[q]:
                    dist[q] = d0 + d
                    heapq.heappush(todo, (d0 + d, q))
        ok = np.isfinite(dist)
        z = ok & (dist < 1e-6)
        for i in np.nonzero(z)[0]:
            exact[int(i)] = y
        w = np.where(ok & ~z, 1.0 / np.maximum(dist, 1e-6), 0.0)
        num += w * y
        den += w
    out = np.where(den > 0, num / np.maximum(den, 1e-300), np.nan)
    for i, y in exact.items():
        out[i] = y
    return out
