# Fit every part's roof to the LiDAR: the shape, direction, eave and rise that best explain its first returns.
import sys, json, pickle, numpy as np, shapely
from load import *
from roofs import *

def owner_map(P, R):
    """For each LiDAR cell, the part (index into P) whose roof is highest over it, else -1."""
    own = np.full(R['top'].shape, -1, np.int32); hi = np.full(R['top'].shape, -np.inf)
    for k, p in enumerate(P):
        c = cells_in(p['ring'], R, 0.0)
        if c is None: continue
        xs, zs, ii, jj = c
        top = p['roofY'] + p['roofH']
        w = top > hi[jj, ii]
        own[jj[w], ii[w]] = k; hi[jj[w], ii[w]] = top
    return own

MAX_RISE = 9.0       # m: no house roof in the scan's west of the city rises more; a taller fit is a neighbour's wall
MAX_PITCH = 1.2      # a face's rise over its run (about 50 degrees, a Queen Anne's): steeper is a step in the roofs, not a roof
MAX_SKILLION = 0.45  # a lean-to's rise over its whole width (about 24 degrees)
FIT_OK = 0.8         # a pitched fit worse than this (mean clipped square residual, m^2) explains too little to draw

def plausible(sh, d, p, Rr):
    c, Sv, D, s0, s1, t0, t1 = frame(p['ring'], d)
    W, L = t1 - t0, s1 - s0
    if Rr > MAX_RISE: return False
    if sh == SKILLION: return Rr <= MAX_SKILLION * W
    if sh == SALTBOX: return Rr <= MAX_PITCH * 0.38 * W
    return Rr <= MAX_PITCH * min(W, L) / 2 if sh in (HIPPED, PYRAMIDAL, MANSARD) else Rr <= MAX_PITCH * W / 2

def fit_part(p, R, own, k, gain=0.35, minR=0.9):
    c = cells_in(p['ring'], R, 0.6)
    if c is None or len(c[0]) < 10: return None
    xs, zs, ii, jj = c
    mine = own[jj, ii] == k
    veg = (R['top'][jj, ii] - R['low'][jj, ii]) > 1.5
    keep = mine & ~veg
    if keep.sum() < 10: return None
    xs, zs, z = xs[keep], zs[keep], R['top'][jj[keep], ii[keep]]
    e0, _, r0, m0 = robust_fit(np.zeros_like(z), z)
    best = dict(shape=FLAT, dir=int(p['roofDir']), e=float(e0), R=0.0, loss=loss(r0), n=int(len(z)))
    flat = best['loss']
    cands = []
    for d in dirs_of(p['ring']):
        if not rect_ok(p['ring'], d): continue
        for sh in SHAPES:
            if SYM[sh] == 2 and d >= 128 and (d - 128) in [x for x in dirs_of(p['ring'])]: continue
            if SYM[sh] == 1 and d != dirs_of(p['ring'])[0]: continue
            g = surface(sh, p['ring'], d, xs, zs)
            e, Rr, r, m = robust_fit(g, z)
            if Rr < minR or not plausible(sh, d, p, Rr): continue
            cands.append(dict(shape=sh, dir=d, e=float(e), R=float(Rr), loss=loss(r), n=int(len(z))))
    # simpler shapes first among near ties: a gable over a gambrel unless the gambrel is clearly better
    pen = {GABLED: 0, HIPPED: 0, SKILLION: 0.02, PYRAMIDAL: 0.02, HALF_HIPPED: 0.04, SALTBOX: 0.05, MANSARD: 0.05, GAMBREL: 0.06}
    if cands:
        c2 = min(cands, key=lambda c: c['loss'] + pen[c['shape']])
        if c2['loss'] < flat * (1 - gain) and flat - c2['loss'] > 0.08 and c2['loss'] <= FIT_OK:
            best = c2
    best['flat'] = flat
    return best

if __name__ == '__main__':
    R = rasters(); P = parts()
    own = owner_map(P, R)
    fits = []
    for k, p in enumerate(P):
        f = fit_part(p, R, own, k)
        fits.append(f)
    pickle.dump(dict(P=P, fits=fits), open(f'{S}/fits.pkl', 'wb'))
    from collections import Counter
    print('parts', len(P), 'fitted', sum(f is not None for f in fits))
    print(Counter(NAMES[f['shape']] for f in fits if f))
    print('before mapped', Counter(NAMES[p['roofShape']] for p in P))
    Rs = [f['R'] for f in fits if f and f['shape'] != FLAT]
    print('rise p10/50/90', np.percentile(Rs, [10, 50, 90]).round(2))
    lf = np.array([f['loss'] for f in fits if f]); l0 = np.array([f['flat'] for f in fits if f])
    print('mean loss flat %.3f  fitted %.3f' % (l0.mean(), lf.mean()))
