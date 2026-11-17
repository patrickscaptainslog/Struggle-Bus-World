"""Roof rule "geom": hand-written geometric rules, the roof guessed from the footprint and its street context alone.

What the LiDAR of Alamo Square taught (train split):
- Which way a pitched roof faces is close to unguessable from a footprint: of the skillions on a street about half
  slope to the back and the rest to the street or a side, nothing in the footprint says which, and a wrong face costs
  more than a flat roof. So the rule never bets on a skillion's direction. It draws a low HIPPED roof, which every gable, hip and saltbox partly fits whichever way it runs, and
  which costs little on a flat one. The one exception: a part on a street at least half again as deep as it is
  wide gets a gable with its end to the street and the ridge running back, the way three in four SF gables run.
- How likely a part is to be pitched shows in a few plain things: tall (eaves over the street), small, simple (few
  corners), standing free (one neighbour or none), not a block of flats or a shed, and higher than the roofs around it.
  These add up to a score; the score sets the rise, 0.45 m at 0 and 0.4 m more a point, flat under 0.3 m; towers
  (six floors or 20 m) stay flat. The weights were fitted on the train split's LiDAR, then rounded.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from roofs import FLAT, GABLED, HIPPED, dirs_of, frame

FLATS, SHED = 2, 7
_cache = {}

def _centroids(parts):
    key = id(parts)
    if key not in _cache:
        _cache.clear()
        _cache[key] = (np.array([p['ring'].mean(0) for p in parts]), np.array([p['roofY'] for p in parts]))
    return _cache[key]

def _front_dir(part):
    """Byte of the way the street edge looks out (dirs_of's main axis when the part has no street edge)."""
    ring, f = part['ring'], part['front']
    if f == 255 or f >= len(ring): return dirs_of(ring)[0]
    a, b = ring[f], ring[(f + 1) % len(ring)]
    e = b - a; n = np.array([-e[1], e[0]])
    if np.dot(ring.mean(0) - (a + b) / 2, n) > 0: n = -n
    return int(round(np.arctan2(n[1], n[0]) / (2 * np.pi) * 256)) % 256

def _min_width(ring):
    """The footprint's narrow side: the least extent over its edge directions."""
    e = np.roll(ring, -1, 0) - ring
    best = np.inf
    for v in e[np.hypot(e[:, 0], e[:, 1]) > 0.5]:
        n = np.array([-v[1], v[0]]) / np.hypot(*v)
        t = ring @ n; best = min(best, t.max() - t.min())
    return best

def score(part, parts):
    """How pitched a part looks, in points (a point is what 2 m more height is worth)."""
    C, RY = _centroids(parts)
    c = part['ring'].mean(0)
    d = np.hypot(*(C - c).T)
    near = (d < 30) & (d > 0.01)
    dh = part['roofY'] - np.median(RY[near]) if near.any() else 0.0
    h = part['roofY'] - part['groundY']
    s = np.clip((h - 13) / 2, -2, 2.5)                                  # taller: an attic over the eaves
    s -= 0.9 * np.clip(np.log(part['area'] / 180), -1.5, 1.5)           # smaller: houses, not blocks
    s -= 1.35 * np.clip(np.log(len(part['ring']) / 8), -1, 1.5)         # simpler: few corners
    s += 1.3 * (len(part['neighbours']) <= 1)                            # standing free
    s -= 0.75 * (part['arch'] == FLATS) + 2.0 * (part['arch'] == SHED)
    s += 0.4 * np.clip(dh / 2, -1.5, 2)                                 # over the roofs around it
    s += 0.75 * (6 <= _min_width(part['ring']) <= 10)                   # a house's width (a 25-30 ft lot)
    return s - 0.65

def predict(part, parts):
    if part['floors'] >= 6 or part['roofY'] - part['groundY'] > 20: return FLAT, 0, 0.0   # towers are flat
    R = min(2.0, 0.45 + 0.4 * score(part, parts))   # the surer, the steeper; under 0.3 m it stays flat
    if R < 0.3: return FLAT, 0, 0.0
    d = _front_dir(part)
    if part['front'] != 255:
        c, Sv, D, s0, s1, t0, t1 = frame(part['ring'], d)
        if t1 - t0 >= 1.5 * (s1 - s0):            # a deep lot: the gable end faces the street, the ridge runs back
            return GABLED, (d + 64) % 256, R
    return HIPPED, d, R
