"""Roof rule "expected": each part gets the roof with the lowest expected loss, flat unless a pitched roof is expected to gain.

How it decides, for each part:
1. p = how likely the part is pitched, from a few plain things a footprint and its context show (a logistic model
   fitted on the Alamo Square train split's LiDAR, each pitched part weighted by what fitting it gains, so p is
   the chance of a roof worth drawing, not of any slope at all):
     tall (16-20 m, under six floors: an attic over the eaves), low (under 11 m: one- and two-storey boxes are flat),
     a plain outline (no bay jogs or light wells: its outline no longer than its bounding box's), standing free
     (one neighbour or none), and how many parts within 30 m have plain outlines (a street of plain gabled houses
     or of jagged flats).
2. Each candidate roof c has a calibrated gain over flat as its rise R grows: on a part that is pitched,
   a1 R - a2 R^2 (it fits the slope, then overshoots it); on a flat one, -b R^2 (pure cost). So the expected gain is
   p (a1 R - a2 R^2) - (1 - p) b R^2, best at R* = p a1 / (2 (p a2 + (1 - p) b)), where it is (p a1)^2 / (4 (...)) > 0.
   The candidates are a gable with its ridge back from the street, one along it, a skillion falling to the back, a
   saltbox and a hipped roof, each in two classes of footprint (house-wide, under 10.5 m across, or wider), with
   a1, a2, b fitted on the train split. The candidate with the largest expected gain wins; under 0.3 m of rise the
   grader draws it flat, so a part that is probably flat stays flat.
What the calibration found: the street's way (3 in 4 gables run back from it) is not sure enough to pay for a wrong
face, and skillions fall every way, so on every footprint class the hipped roof wins: it partly fits a gable either
way, a hip and a saltbox, and costs least on a flat roof. So the rule draws a hipped roof whose rise grows with p,
from nothing (flat) at p under about 0.2 to about 1.6 m at p 0.8 (1.1 m on a wider footprint).
On the train split: skill 0.148. Refitted within the train split, five folds by place, x and z: about 0.126. What
helped most: weighting each pitched part by its gain (0.10 to 0.12), and the share of plain outlines within 30 m
(0.117 to 0.126). Caution: a city whose footprints are all simplified boxes reads as "plain" everywhere, and p rises.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, shapely
from roofs import FLAT, GABLED, HIPPED, SKILLION, SALTBOX, dirs_of, frame

# p: logistic weights, fitted on the train split (gain-weighted), rounded
B0, TALL, PLAIN, LOW, FREE, PLAIN_NEAR = -1.96, 1.71, 0.95, -1.07, 0.45, 0.97
# candidates: (shape, quarter turns of D from the street's inward normal), and (a1, a2, b) per footprint class
# (house-wide, wider), fitted on the train split as least squares over R up to 4 m
CANDS = {
    'hipped':              (HIPPED, 0,   (0.143, 0.033, 0.044), (0.080, 0.024, 0.044)),
    'gable, ridge back':   (GABLED, 1,   (0.138, 0.032, 0.044), (0.039, 0.018, 0.051)),
    'gable, ridge along':  (GABLED, 0,   (0.044, 0.027, 0.051), (0.060, 0.022, 0.049)),
    'skillion to back':    (SKILLION, 0, (0.029, 0.021, 0.042), (-0.019, 0.007, 0.045)),
    'saltbox, ridge back': (SALTBOX, 3,  (0.113, 0.031, 0.046), (0.043, 0.020, 0.051)),
}
WIDE = 10.5          # m across: wider than a San Francisco lot (25-30 ft) is a different population
_ctx = {}

def outline_ratio(ring):
    """The outline's length over its minimum bounding rectangle's: 1 for a plain box, more for bays and light wells."""
    e = np.roll(ring, -1, 0) - ring
    return float(np.hypot(e[:, 0], e[:, 1]).sum() / shapely.Polygon(ring).minimum_rotated_rectangle.length)

def _context(parts):
    key = id(parts)
    if key not in _ctx:
        _ctx.clear()
        C = np.array([p['ring'].mean(0) for p in parts])
        plain = np.array([outline_ratio(np.asarray(p['ring'], float)) < 1.005 for p in parts])
        _ctx[key] = (C, plain)
    return _ctx[key]

def street_dir(part):
    """dirs_of's direction nearest the street edge's inward normal (dirs_of's first when the part has no street edge)."""
    ring, f = np.asarray(part['ring'], float), part['front']
    ds = dirs_of(ring)
    if f == 255 or f >= len(ring): return ds[0]
    a, b = ring[f], ring[(f + 1) % len(ring)]
    n = np.array([a[1] - b[1], b[0] - a[0]])
    if np.dot(ring.mean(0) - (a + b) / 2, n) < 0: n = -n
    nb = int(round(np.arctan2(n[1], n[0]) / (2 * np.pi) * 256)) % 256
    return min(ds, key=lambda d: min((d - nb) % 256, (nb - d) % 256))

def p_pitched(part, parts):
    C, plain = _context(parts)
    ring = np.asarray(part['ring'], float)
    c = ring.mean(0)
    d = np.hypot(*(C - c).T)
    near = (d < 30) & (d > 0.1)
    h = part['roofY'] - part['groundY']
    z = (B0 + TALL * (16 <= h < 20 and part['floors'] < 6) + LOW * (h < 11)
         + PLAIN * (outline_ratio(ring) < 1.005) + FREE * (len(part['neighbours']) <= 1)
         + PLAIN_NEAR * (plain[near].mean() if near.any() else 0.5))
    return 1 / (1 + np.exp(-z))

def predict(part, parts):
    p = p_pitched(part, parts)
    d0 = street_dir(part)
    c, Sv, D, s0, s1, t0, t1 = frame(np.asarray(part['ring'], float), d0)
    wide = min(t1 - t0, s1 - s0) > WIDE
    best = (0.0, FLAT, 0, 0.0)
    for shape, k, house, wider in CANDS.values():
        if k and part['front'] == 255: continue               # a direction needs a street to be read from
        a1, a2, b = wider if wide else house
        if a1 <= 0: continue
        den = 2 * (p * a2 + (1 - p) * b)
        R = p * a1 / den
        gain = p * a1 * R / 2                                  # the expected gain at R*
        if gain > best[0]: best = (gain, shape, (d0 + 64 * k) % 256, R)
    _, shape, d, R = best
    if R < 0.3: return FLAT, 0, 0.0
    return shape, d, R
