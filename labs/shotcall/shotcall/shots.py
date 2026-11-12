"""Three-point attempts: where they come from, how they are aimed, and how they miss."""
import numpy as np
from .court import G, RIM_Z, ARC_R, CORNER_Y, CD0
from .physics import flight, crossing_features, simulate_outcome, velocity, spin_vector

A_TARGET = 0.03                     # shooters aim a little past the centre of the rim
SIG_SPEED, SIG_AZ = 0.0134, 0.0159  # release speed (relative) and direction (rad) errors, tuned to ~36 %
SPIN_MEAN, SPIN_SD, SIDE_SD, CD_SD = 15.5, 2.2, 1.0, 0.01
FEET_SD = 0.12                      # how well the shooter's feet are found on the floor


def solve_aim(p0, el, w_back, w_side, cd, iters=7):
    """Release speed and direction that put the ball on A_TARGET for a given launch angle."""
    dist = np.linalg.norm(p0[:, :2], axis=1)
    az = np.arctan2(-p0[:, 1], -p0[:, 0])
    s = 1.04 * np.sqrt(G * dist**2 / (2 * np.cos(el) ** 2 * (dist * np.tan(el) - (RIM_Z - p0[:, 2]))))
    for _ in range(iters):
        v0 = velocity(s, el, az)
        _, _, pc, vc = flight(p0, v0, spin_vector(v0, w_back, w_side), cd)
        f = crossing_features(pc, vc, w_back, w_side)
        s = np.where(np.isnan(f[:, 0]), s * 1.03, s * (1 - (f[:, 0] - A_TARGET) / (1.9 * dist)))
        az = az - np.nan_to_num(f[:, 1]) / dist
    return s, az


def sample_shots(n, rng, spread=1.0):
    """n attempts. spread > 1 widens the misses, to teach the rim model the whole neighbourhood."""
    corner = rng.random(n) < 0.22
    phi = rng.uniform(-1.15, 1.15, n)
    d = np.minimum(ARC_R + 0.2 + rng.exponential(0.3, n), 9.5)
    feet = np.stack([-d * np.cos(phi), d * np.sin(phi)], 1)
    side = rng.choice([-1.0, 1.0], n)
    feet = np.where(corner[:, None], np.stack([rng.uniform(-2.4, 0.9, n),
                                               side * (CORNER_Y + rng.uniform(0.2, 0.65, n))], 1), feet)
    to_hoop = -feet / np.linalg.norm(feet, axis=1, keepdims=True)
    p0 = np.zeros((n, 3))
    p0[:, :2] = feet + 0.25 * to_hoop + rng.normal(0, 0.10, (n, 2))
    p0[:, 2] = np.clip(rng.normal(2.60, 0.15, n), 2.2, 3.0)
    el = np.clip(rng.normal(np.deg2rad(49), np.deg2rad(3.5), n), np.deg2rad(40), np.deg2rad(60))
    w_back = np.clip(rng.normal(SPIN_MEAN, SPIN_SD, n), 4, None)
    w_side = rng.normal(0, SIDE_SD, n)
    cd = rng.normal(CD0, CD_SD, n)
    kappa = np.exp(rng.normal(0, 0.16, n))          # this shooter on this shot: 1 is average, lower is better
    s, az = solve_aim(p0, el, w_back, w_side, cd)
    s = s * (1 + spread * kappa * SIG_SPEED * rng.normal(size=n))
    az = az + spread * kappa * SIG_AZ * rng.normal(size=n)
    v0 = velocity(s, el, az)
    w = spin_vector(v0, w_back, w_side)
    _, tc, pc, vc = flight(p0, v0, w, cd)
    made, contacts = simulate_outcome(p0, v0, w, cd, rng)
    return dict(feet=feet + rng.normal(0, FEET_SD, (n, 2)), p0=p0, v0=v0, w=w, cd=cd, kappa=kappa,
                w_back=w_back, w_side=w_side, corner=corner, tc=tc, made=made, contacts=contacts,
                feat=crossing_features(pc, vc, w_back, w_side))


def fit_prior(shots, iters=25):
    """What is known before the ball leaves the hand: a logistic model on shooter and distance."""
    X = prior_design(shots)
    y = shots["made"].astype(float)
    beta = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ beta))
        beta += np.linalg.solve((X * (p * (1 - p))[:, None]).T @ X + 1e-6 * np.eye(X.shape[1]), X.T @ (y - p))
    return beta


def prior_design(shots):
    d = np.linalg.norm(shots["feet"], axis=1)
    lk = np.log(shots["kappa"])
    return np.stack([np.ones_like(d), lk, lk**2, d - 7.6, shots["corner"].astype(float)], 1)


def prior_prob(shots, beta):
    return 1 / (1 + np.exp(-prior_design(shots) @ beta))
