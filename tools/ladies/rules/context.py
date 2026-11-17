"""Roof rule "context": a part's roof guessed from its footprint and the parts it touches.

What the LiDAR of Alamo Square taught (train split, west half):
- Which pitched roof a part has, and which way it faces, is close to unguessable from footprints: of the pitched
  row houses, about a third slope to the back, a third are gables with the ridge running back from the street and the
  rest saltboxes, hips and side skillions, and nothing in the footprint picks one out. What a footprint and its
  neighbours do tell, weakly, is how likely a roof is to be pitched at all. So the rule draws one low hedge roof whose
  rise grows with that likelihood, and stays flat where it is unlikely.
- The hedge: on a row-house lot (a street edge, narrow along the street and deep) a gable with the ridge running back,
  the gable end to the street, as three in four San Francisco gables run; anywhere else a hip, which every gable,
  hip and saltbox partly fits whichever way it runs.
- The likelihood, as a rise in metres (a linear score fitted on the LiDAR's exact score, cross-validated in strips):
  taller parts carry attics (+0.19 m a metre of height); a roof higher than every roof it touches is more often a
  pitched one; standing free (no neighbour, +0.55) or at a row's end (one neighbour, +0.36) is likelier than mid-row;
  blocks of flats (arch FLATS), footprints with many corners (light wells, notches) and big footprints are flatter.
  Towers (over 20 m or six floors) stay flat. Under 0.3 m the grader draws it flat anyway.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from roofs import FLAT, GABLED, HIPPED, dirs_of, frame

FLATS = 2

def street_dir(part):
    """Byte of the way the street edge looks out (dirs_of's main axis when the part has no street edge)."""
    ring, f = part['ring'], part['front']
    if f == 255 or f >= len(ring): return None
    a, b = ring[f], ring[(f + 1) % len(ring)]
    e = b - a; n = np.array([-e[1], e[0]])
    if np.dot(ring.mean(0) - (a + b) / 2, n) > 0: n = -n
    return int(round(np.arctan2(n[1], n[0]) / (2 * np.pi) * 256)) % 256

def rise(part, parts):
    """The hedge's rise, m: how likely a pitched roof is, from the part and the parts it touches."""
    h = part['roofY'] - part['groundY']
    nb = part['neighbours']
    above = float(np.clip(part['roofY'] - max(parts[j]['roofY'] for j in nb), -5, 5)) if nb else 0.0
    return (1.396 + 0.164 * h                         # taller: an attic over the eaves
            + 0.421 * max(0.0, h - 16)                # and over 16 m (four storeys) most roofs are pitched
            + 0.018 * above                           # over every roof it touches
            + 0.515 * (len(nb) == 0)                  # standing free
            + 0.346 * (len(nb) == 1)                  # the end of a row
            - 0.536 * (part['arch'] == FLATS)         # blocks of flats
            - 0.553 * np.log(len(part['ring']))       # many corners: light wells, notches
            - 0.359 * np.log(max(part['area'], 1.0))) # big footprints

def predict(part, parts):
    if part['floors'] >= 6 or part['roofY'] - part['groundY'] > 20: return FLAT, 0, 0.0   # towers are flat
    R = min(rise(part, parts), 3.0)
    if R < 0.3: return FLAT, 0, 0.0
    fd = street_dir(part)
    d0 = fd if fd is not None else dirs_of(part['ring'])[0]
    if fd is not None:
        c, Sv, D, s0, s1, t0, t1 = frame(part['ring'], d0)
        width, depth = s1 - s0, t1 - t0               # along the street, and back from it
        if width < 10.5 and depth > 1.6 * width:      # a row-house lot: the gable end to the street
            return GABLED, (d0 + 64) % 256, R
    return HIPPED, d0, R
