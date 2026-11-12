"""Two cameras: the main game camera, which pans and zooms with the play, and a fixed second angle."""
import numpy as np

W, H, FPS = 1920, 1080, 60
EXPOSURE = 1 / 150
CAM_A = np.array([-12.73, -24.6, 9.5])      # centre court, up in the stands on the near side
CAM_B = np.array([10.0, -14.0, 9.0])        # high behind the near corner of the baseline
PAN_BIAS, PAN_JITTER, F_BIAS = np.deg2rad(0.012), np.deg2rad(0.004), 0.0015   # how well a frame is calibrated


def axes(pan, tilt):
    cp, sp, ct, st = np.cos(pan), np.sin(pan), np.cos(tilt), np.sin(tilt)
    return (np.stack([ct * cp, ct * sp, -st], -1), np.stack([sp, -cp, 0 * sp], -1), np.stack([st * cp, st * sp, ct], -1))


def project(P, pos, pan, tilt, f):
    """World points to pixels (u right, v down) and depth along the lens axis."""
    fwd, right, up = axes(pan, tilt)
    X = P - pos
    zc = (X * fwd).sum(-1)
    return W / 2 + f * (X * right).sum(-1) / zc, H / 2 - f * (X * up).sum(-1) / zc, zc


def sample_cameras(feet, rng):
    """One operator per shot for camera A; camera B never moves."""
    n = len(feet)
    look = np.zeros((n, 3))
    look[:, :2] = 0.45 * feet + rng.normal(0, 1.0, (n, 2))
    look[:, 2] = 2.8 + rng.normal(0, 0.4, n)
    drift = np.zeros((n, 3))
    drift[:, :2] = -feet / np.linalg.norm(feet, axis=1, keepdims=True) * rng.uniform(0, 1.2, (n, 1))
    a = dict(pos=CAM_A, look=look, drift=drift, f0=W / 2 / np.tan(np.deg2rad(rng.uniform(26, 36, n)) / 2),
             zoom=rng.normal(0, 0.02, n))
    b = dict(pos=CAM_B, look=np.tile([-3.5, -1.0, 3.2], (n, 1)), drift=np.zeros((n, 3)),
             f0=np.full(n, W / 2 / np.tan(np.deg2rad(46) / 2)), zoom=np.zeros(n))
    for c in (a, b):
        c["bias"] = np.stack([rng.normal(0, PAN_BIAS, n), rng.normal(0, PAN_BIAS, n), rng.normal(0, F_BIAS, n)], 1)
    return [a, b]


def pose(cam, t):
    """True pan, tilt and focal length at times t (N,F)."""
    d = cam["look"][:, None] + cam["drift"][:, None] * t[..., None] - cam["pos"]
    return np.arctan2(d[..., 1], d[..., 0]), np.arctan2(-d[..., 2], np.hypot(d[..., 0], d[..., 1])), \
        cam["f0"][:, None] * (1 + cam["zoom"][:, None] * t)


def estimated_pose(cam, t, rng):
    """What court registration would hand us: the true pose, a little off, a little shaky."""
    pan, tilt, f = pose(cam, t)
    b = cam["bias"]
    return (pan + b[:, :1] + rng.normal(0, PAN_JITTER, t.shape), tilt + b[:, 1:2] + rng.normal(0, PAN_JITTER, t.shape),
            f * (1 + b[:, 2:3]))
