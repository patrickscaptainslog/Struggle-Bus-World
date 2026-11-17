# Roof rule "tree": a small cost-sensitive decision tree, learned on the Alamo Square train split (west half) and hard-coded.
# Each leaf picks the one roof that gained most summed score over its parts (not the most common class): what survived
# cross-validation is a low hipped "hedge" whose rise grows where a pitched roof is likelier.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from roofs import dirs_of, HIPPED, FLAT

def reflex_corners(ring, min_edge=0.3):
    """Concave corners of the footprint (light wells, notches, bays' inner corners)."""
    x, z = ring[:, 0], ring[:, 1]
    sa = np.sign(np.sum(x * np.roll(z, -1) - np.roll(x, -1) * z))
    n, c = len(ring), 0
    for k in range(n):
        a, b, cc = ring[k - 1], ring[k], ring[(k + 1) % n]
        cr = (b[0] - a[0]) * (cc[1] - b[1]) - (b[1] - a[1]) * (cc[0] - b[0])
        if cr * sa < -1e-6 and np.hypot(cc[0] - b[0], cc[1] - b[1]) > min_edge: c += 1
    return c

def street_width(ring, front):
    """The footprint's extent along the street (its frontage), in the frame of dirs_of snapped to the street edge."""
    ds = dirs_of(ring)
    c = ring.mean(0)
    if front != 255:
        a, b = ring[front], ring[(front + 1) % len(ring)]
        n = np.array([a[1] - b[1], b[0] - a[0]])
        if np.dot(c - (a + b) / 2, n) < 0: n = -n
        nb = int(round(np.arctan2(n[1], n[0]) / (2 * np.pi) * 256)) % 256
        d0 = min(ds, key=lambda d: min((d - nb) % 256, (nb - d) % 256))
    else:
        d0 = max(ds, key=lambda d: np.ptp((ring - c) @ np.array([np.cos(d / 128 * np.pi), np.sin(d / 128 * np.pi)])))
    th = d0 / 256 * 2 * np.pi
    Sv = np.array([-np.sin(th), np.cos(th)])
    return float(np.ptp((ring - c) @ Sv))

def predict(part, parts):
    ring = np.asarray(part['ring'], float)
    wall = part['roofY'] - part['baseY']             # the roof's median over the base: a pitched roof lifts it
    rf = reflex_corners(ring)                        # notches: light wells and courts belong to flats
    width = street_width(ring, part['front'])        # frontage: a San Francisco row house is about 7.6 m (25 ft)
    plain, narrow = rf <= 3, width < 9.0
    if narrow and (wall >= 16.5 or (plain and wall >= 13.5)):
        R = 2.0                                      # the tall, narrow row house: the likeliest real roof
    elif wall >= 16.5: R = 1.0                       # tall and wide: mixed, hedge
    elif plain:
        if wall < 10.5: return FLAT, 0, 0.0          # low and plain: garages, sheds, one-storey shops
        R = 0.5
    elif width < 11 and rf <= 7: R = 0.3             # a narrow notched lot keeps a whisper of a roof
    elif width >= 22: R = 0.4                        # big footprints: big, mixed roofs
    else: return FLAT, 0, 0.0                        # mid-size blocks of flats, and much-notched lots
    return HIPPED, dirs_of(ring)[0], R
