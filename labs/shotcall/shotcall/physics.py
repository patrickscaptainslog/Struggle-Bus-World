"""Ball flight (gravity, drag, Magnus) and the rim, backboard and flange contacts that decide a shot."""
import numpy as np
from .court import (G, BALL_R, KD, KM, RIM_Z, ROD_R, RIM_R, BOARD_X, BOARD_HALF_W, BOARD_Z0, BOARD_Z1,
                    FLANGE_HALF_W, E_RIM, E_BOARD, MU)

DT_MAX, DT_MIN = 1 / 60, 2.5e-4


def accel(v, w, cd):
    """v, w: (N,3) velocity and spin; cd: (N,) drag coefficient."""
    k = (KD * cd * np.sqrt((v * v).sum(-1)))[..., None]
    a = np.empty_like(v)
    a[..., 0] = KM * (w[..., 1] * v[..., 2] - w[..., 2] * v[..., 1])
    a[..., 1] = KM * (w[..., 2] * v[..., 0] - w[..., 0] * v[..., 2])
    a[..., 2] = KM * (w[..., 0] * v[..., 1] - w[..., 1] * v[..., 0]) - G
    a -= k * v
    return a


def velocity(speed, el, az):
    return np.stack([speed * np.cos(el) * np.cos(az), speed * np.cos(el) * np.sin(az), speed * np.sin(el)], -1)


def spin_vector(v, w_back, w_side):
    """Backspin about the horizontal axis across the flight, sidespin about the vertical."""
    h = v[..., :2] / np.maximum(np.linalg.norm(v[..., :2], axis=-1, keepdims=True), 1e-9)
    return np.stack([w_back * h[..., 1], -w_back * h[..., 0], w_side * np.ones_like(w_back)], -1)


def rk4_step(p, v, w, cd, dt):
    """One step of the flight; dt a number or an (N,1) column."""
    k1 = accel(v, w, cd)
    k2 = accel(v + 0.5 * dt * k1, w, cd)
    k3 = accel(v + 0.5 * dt * k2, w, cd)
    k4 = accel(v + dt * k3, w, cd)
    return p + dt * v + (dt * dt / 6) * (k1 + k2 + k3), v + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4)


def flight(p0, v0, w, cd, n_store=1, dt=1 / 60, n_max=170, with_vel=False):
    """RK4 free flight.

    Returns the positions (and with_vel, the velocities) at t = i*dt for i < n_store, and when, where and how fast the ball comes
    down through the rim plane with nothing in its way (the virtual crossing): NaN if it never does.
    """
    n = p0.shape[0]
    p, v = p0.astype(float).copy(), v0.astype(float).copy()
    pos = np.empty((n, n_store, 3))
    pos[:, 0] = p
    vel = np.empty((n, n_store, 3)) if with_vel else None
    if with_vel:
        vel[:, 0] = v
    tc, pc, vc = np.full(n, np.nan), np.full((n, 3), np.nan), np.full((n, 3), np.nan)
    found = np.zeros(n, bool)
    for i in range(1, n_max + 1):
        pn, vn = rk4_step(p, v, w, cd, dt)
        hit = ~found & (p[:, 2] >= RIM_Z) & (pn[:, 2] < RIM_Z)
        if hit.any():
            a = (vn[hit] - v[hit]) / dt
            vz = v[hit, 2]
            tau = (vz + np.sqrt(vz * vz - 2 * a[:, 2] * (p[hit, 2] - RIM_Z))) / -a[:, 2]
            pc[hit] = p[hit] + v[hit] * tau[:, None] + 0.5 * a * tau[:, None] ** 2
            vc[hit] = v[hit] + a * tau[:, None]
            tc[hit] = (i - 1) * dt + tau
            found |= hit
        p, v = pn, vn
        if i < n_store:
            pos[:, i] = p
            if with_vel:
                vel[:, i] = v
        elif (found | (p[:, 2] < 1.0)).all():
            break
    return (pos, vel, tc, pc, vc) if with_vel else (pos, tc, pc, vc)


def crossing_features(pc, vc, w_back, w_side):
    """The virtual crossing in the shot's own frame: [long(+)/short, left(+)/right, entry angle,
    speed, approach azimuth, backspin, sidespin]. Metres, radians, rad/s."""
    hs = np.maximum(np.hypot(vc[..., 0], vc[..., 1]), 1e-9)
    hx, hy = vc[..., 0] / hs, vc[..., 1] / hs
    return np.stack([pc[..., 0] * hx + pc[..., 1] * hy, -pc[..., 0] * hy + pc[..., 1] * hx,
                     np.arctan2(-vc[..., 2], hs), np.sqrt((vc * vc).sum(-1)), np.arctan2(hy, hx),
                     w_back * np.ones_like(hs), w_side * np.ones_like(hs)], -1)


def _nearest(P):
    """Nearest point of each obstacle to the ball centre: (point, obstacle radius, restitution)."""
    n = len(P)
    rho = np.hypot(P[:, 0], P[:, 1])
    ok = rho > 1e-9
    ux, uy = np.where(ok, P[:, 0] / np.maximum(rho, 1e-9), 1.0), np.where(ok, P[:, 1] / np.maximum(rho, 1e-9), 0.0)
    ring = np.stack([RIM_R * ux, RIM_R * uy, np.full(n, RIM_Z)], 1)
    board = np.stack([np.full(n, BOARD_X), np.clip(P[:, 1], -BOARD_HALF_W, BOARD_HALF_W),
                      np.clip(P[:, 2], BOARD_Z0, BOARD_Z1)], 1)
    flange = np.stack([np.clip(P[:, 0], RIM_R, BOARD_X), np.clip(P[:, 1], -FLANGE_HALF_W, FLANGE_HALF_W),
                       np.full(n, RIM_Z)], 1)
    return (ring, ROD_R, E_RIM), (board, 0.0, E_BOARD), (flange, 0.0, E_RIM)


def simulate_outcome(p0, v0, w0, cd, rng=None, t_max=4.5):
    """Fly every shot to its end. Returns (made, contacts).

    Steps shrink as the ball nears metal or glass (conservative advancement), and each contact is
    an impulse with restitution and Coulomb friction on a hollow sphere, so spin matters. With an
    rng, every contact gets a little random restitution and normal: a ball rattling on the rim is
    then a coin, as it is on a real one.
    """
    n = len(p0)
    p, v, w = p0.astype(float).copy(), v0.astype(float).copy(), w0.astype(float).copy()
    made, contacts, t = np.zeros(n, bool), np.zeros(n, int), np.zeros(n)
    idx = np.arange(n)
    while len(idx):
        P, V, W, C = p[idx], v[idx], w[idx], cd[idx]
        obs = _nearest(P)
        clr = np.min([np.sqrt(((P - q) ** 2).sum(1)) - r - BALL_R for q, r, _ in obs], 0)
        dt = np.clip((clr - 0.002) / np.maximum(np.sqrt((V * V).sum(1)), 1.0), DT_MIN, DT_MAX)[:, None]
        vm = V + 0.5 * dt * accel(V, W, C)
        Pn, Vn = P + dt * vm, V + dt * accel(vm, W, C)
        if (clr < 0.02).any():
            for q, r, e0 in _nearest(Pn):
                d = Pn - q
                dist = np.sqrt((d * d).sum(1))
                h = np.nonzero(BALL_R + r - dist > 0)[0]
                if not len(h):
                    continue
                nrm = d[h] / np.maximum(dist[h], 1e-9)[:, None]
                Pn[h] += (BALL_R + r - dist[h])[:, None] * nrm
                e = np.full(len(h), e0)
                if rng is not None:
                    nrm = nrm + 0.02 * rng.normal(size=nrm.shape)
                    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
                    e = np.clip(e + 0.04 * rng.normal(size=len(h)), 0.2, 0.9)
                vn = (Vn[h] * nrm).sum(1)
                a = vn < 0
                if not a.any():
                    continue
                h, nrm, vn, e = h[a], nrm[a], vn[a], np.where(vn[a] > -0.05, 0.0, e[a])
                u = Vn[h] - BALL_R * np.cross(W[h], nrm)          # velocity of the contact point
                ut = u - (u * nrm).sum(1)[:, None] * nrm
                utn = np.sqrt((ut * ut).sum(1))
                jn = -(1 + e) * vn
                jt = (np.minimum(MU * jn, 0.4 * utn) / np.maximum(utn, 1e-9))[:, None] * ut
                Vn[h] += jn[:, None] * nrm - jt
                W[h] += 1.5 / BALL_R * np.cross(nrm, jt)
                contacts[idx[h]] += 1
        through = (P[:, 2] >= RIM_Z) & (Pn[:, 2] < RIM_Z) & (np.hypot(Pn[:, 0], Pn[:, 1]) < RIM_R)
        t[idx] += dt[:, 0]
        made[idx[through]] = True
        p[idx], v[idx], w[idx] = Pn, Vn, W
        idx = idx[~(through | ((Pn[:, 2] < RIM_Z - 0.35) & (Vn[:, 2] < 0)) | (t[idx] > t_max))]
    return made, contacts
