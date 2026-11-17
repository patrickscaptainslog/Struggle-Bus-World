# The game's roof surfaces (a port of src/world/roofGeom.ts roofFrame + roofPlanes) and a LiDAR fit for each part.
import numpy as np
NONE, FLAT, GABLED, HIPPED, PYRAMIDAL, SKILLION, DOME, ONION, ROUND, GAMBREL, MANSARD, HALF_HIPPED, SALTBOX, CONE = range(14)
NAMES = 'NONE FLAT GABLED HIPPED PYRAMIDAL SKILLION DOME ONION ROUND GAMBREL MANSARD HALF_HIPPED SALTBOX CONE'.split()

def frame(ring, dir_byte):
    th = dir_byte / 256 * np.pi * 2
    D = np.array([np.cos(th), np.sin(th)]); Sv = np.array([-D[1], D[0]])
    c = ring.mean(0)
    r = ring - c
    ss, tt = r @ Sv, r @ D
    return c, Sv, D, ss.min(), ss.max(), tt.min(), tt.max()

def planes(shape, s0, s1, t0, t1, R=1.0):
    W, L = t1 - t0, s1 - s0
    kt = 2 * R / W
    P = []
    if shape == GABLED:
        P = [(0, kt, -kt * t0), (0, -kt, kt * t1)]
    elif shape == HIPPED:
        k = 2 * R / min(W, L); P = [(0, k, -k * t0), (0, -k, k * t1), (k, 0, -k * s0), (-k, 0, k * s1)]
    elif shape == PYRAMIDAL:
        kl = 2 * R / L; P = [(0, kt, -kt * t0), (0, -kt, kt * t1), (kl, 0, -kl * s0), (-kl, 0, kl * s1)]
    elif shape == SKILLION:
        k = R / W; P = [(0, -k, k * t1)]
    elif shape == HALF_HIPPED:
        kh = max(kt, 0.8 * R / L); P = [(0, kt, -kt * t0), (0, -kt, kt * t1), (kh, 0, 0.6 * R - kh * s0), (-kh, 0, 0.6 * R + kh * s1)]
    elif shape == SALTBOX:
        kf, kb = R / (0.62 * W), R / (0.38 * W); P = [(0, kf, -kf * t0), (0, -kb, kb * t1)]
    elif shape == GAMBREL:
        ks, kg = 0.75 * R / (0.18 * W), 0.25 * R / (0.32 * W); og = 0.75 * R - kg * 0.18 * W
        P = [(0, ks, -ks * t0), (0, -ks, ks * t1), (0, kg, og - kg * t0), (0, -kg, og + kg * t1)]
    elif shape == MANSARD:
        k = R / (0.18 * min(W, L)); P = [(0, k, -k * t0), (0, -k, k * t1), (k, 0, -k * s0), (-k, 0, k * s1), (0, 0, R)]
    return P

def surface(shape, ring, dir_byte, xs, zs, R=1.0):
    """Height above the eave of the roof of `shape` (rise R) at points xs, zs."""
    if shape in (NONE, FLAT): return np.zeros_like(xs)
    c, Sv, D, s0, s1, t0, t1 = frame(ring, dir_byte)
    s = (xs - c[0]) * Sv[0] + (zs - c[1]) * Sv[1]
    t = (xs - c[0]) * D[0] + (zs - c[1]) * D[1]
    h = np.full_like(xs, np.inf)
    for a, b, cc in planes(shape, s0, s1, t0, t1, R):
        h = np.minimum(h, a * s + b * t + cc)
    return np.clip(h, 0, R)

def rect_ok(ring, dir_byte):
    c, Sv, D, s0, s1, t0, t1 = frame(ring, dir_byte)
    x, z = ring[:, 0], ring[:, 1]
    area = abs(np.dot(x, np.roll(z, -1)) - np.dot(np.roll(x, -1), z)) / 2
    W, L = t1 - t0, s1 - s0
    return W >= 1 and L >= 1 and area / (W * L) >= 0.55

def dirs_of(ring):
    """Candidate face directions: the footprint's dominant edge orientation and its quarter turns (bytes)."""
    e = np.roll(ring, -1, 0) - ring
    ln = np.hypot(e[:, 0], e[:, 1])
    a = np.mod(np.arctan2(e[:, 1], e[:, 0]), np.pi / 2)
    # weighted circular mean of the orientation mod 90 degrees
    v = (ln * np.exp(4j * a)).sum()
    th = np.angle(v) / 4
    return sorted({int(round((th + k * np.pi / 2) / (2 * np.pi) * 256)) % 256 for k in range(4)})

SHAPES = (GABLED, HIPPED, PYRAMIDAL, SKILLION, HALF_HIPPED, MANSARD, GAMBREL, SALTBOX)
SYM = {GABLED: 2, HIPPED: 2, PYRAMIDAL: 2, HALF_HIPPED: 2, MANSARD: 1, GAMBREL: 2, SKILLION: 4, SALTBOX: 4}

def robust_fit(g, z, iters=4):
    """z ~ e + R g, trimmed least squares. Returns e, R, residuals (all points), inlier mask."""
    m = np.ones(len(z), bool)
    for _ in range(iters):
        A = np.column_stack([np.ones(m.sum()), g[m]])
        sol, *_ = np.linalg.lstsq(A, z[m], rcond=None)
        e, R = sol
        if R < 0:
            e, R = np.median(z[m]), 0.0
        r = z - (e + R * g)
        mad = np.median(np.abs(r[m])) * 1.4826 + 1e-6
        m2 = np.abs(r) < max(0.6, 2.5 * mad)
        if m2.sum() < 6 or (m2 == m).all(): m = m2 if m2.sum() >= 6 else m; break
        m = m2
    return e, R, z - (e + R * g), m

def loss(r):
    return float(np.mean(np.minimum(r * r, 2.25)))
