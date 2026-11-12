"""Film every shot with every camera, frame by frame, and run the detector on what was filmed."""
import numpy as np
import torch
from .court import BALL_R
from .physics import flight, rk4_step
from .camera import FPS, EXPOSURE, W, H, project, pose, estimated_pose, axes
from .render import S, render, look_params, random_rotations, occluder_params
from .detector import predict

N_PRE, N_POST = 6, 90               # frames kept before and after the release
NF = N_PRE + N_POST
BATCH = 256


def kinematics(s, rng):
    """Ball centre and velocity at each frame. t = 0 is the release, which falls between two frames.
    Before it the hand pushes the ball up to speed over the last tenth of a second."""
    n = len(s["p0"])
    t = rng.uniform(0, 1 / FPS, n)[:, None] + (np.arange(NF) - N_PRE)[None] / FPS
    p1, v1 = rk4_step(s["p0"], s["v0"], s["w"], s["cd"], t[:, N_PRE:N_PRE + 1])
    pos, vel, *_ = flight(p1, v1, s["w"], s["cd"], n_store=N_POST, with_vel=True)
    tp = t[:, :N_PRE]
    push = np.maximum(tp, -0.1)
    P, V = np.empty((n, NF, 3)), np.empty((n, NF, 3))
    P[:, N_PRE:], V[:, N_PRE:] = pos, vel
    P[:, :N_PRE] = s["p0"][:, None] + s["v0"][:, None] * (push + 4.25 * push**2 + 0.15 * np.minimum(tp + 0.1, 0))[..., None]
    V[:, :N_PRE] = s["v0"][:, None] * np.maximum(0.15, 1 + 8.5 * tp)[..., None]
    return t, P, V


def _rodrigues(ax, ang):
    x, y, z = ax[..., 0], ax[..., 1], ax[..., 2]
    c, s, C = np.cos(ang), np.sin(ang), 1 - np.cos(ang)
    return np.stack([c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s,
                     z * x * C - y * s, z * y * C + x * s, c + z * z * C], -1).reshape(ang.shape + (3, 3))


def film(s, cams, net, bank, rng, gen, keep=(0, 0), log=print):
    """Returns per camera and frame what the detector measured, the truth beside it, and the camera
    pose a calibration would report. keep = (lo, hi) also returns the crops of those shots."""
    n = len(s["p0"])
    t, P, V = kinematics(s, rng)
    t_end = np.where(np.isnan(s["tc"]), 1.2, s["tc"] - 0.10)        # stop before the rim and net get in the picture
    names = ("u", "v", "logr", "la", "lb", "lc", "sr", "hand", "ok", "u_true", "v_true", "r_true", "pan", "tilt", "f", "blur", "cu", "cv")
    out = {k: np.zeros((len(cams), n, NF)) for k in names}
    out.update(t=t, P=P, V=V)
    crops = np.zeros((len(cams), keep[1] - keep[0], NF, 3, S, S), np.uint8)
    T = lambda a: torch.as_tensor(np.asarray(a), dtype=torch.float32)
    for ci, cam in enumerate(cams):
        pan, tilt, f = pose(cam, t)
        u, v, zc = project(P, cam["pos"], pan, tilt, f)
        r = f * BALL_R / zc
        h = EXPOSURE / 2
        ua, va, _ = project(P - V * h, cam["pos"], *pose(cam, t - h))
        ub, vb, _ = project(P + V * h, cam["pos"], *pose(cam, t + h))
        ok = (t <= t_end[:, None]) & (u > 40) & (u < W - 40) & (v > 40) & (v < H - 40)
        cu, cv = np.round(u + np.clip(rng.normal(0, 2.5, u.shape), -6, 6)), np.round(v + np.clip(rng.normal(0, 2.5, u.shape), -6, 6))
        hang = (np.arctan2(vb - va, ub - ua)[:, N_PRE] + np.pi + rng.normal(0, 0.4, n))[:, None] + rng.normal(0, 0.05, t.shape)
        aang = hang + rng.normal(0, 0.6, (n, 1))
        gap = np.where(t < 0, rng.uniform(-0.12, 0.02, (n, 1)) * r, np.where(t < 0.1, 45 * t * t, 0.45 + 8 * (t - 0.1)) * f / zc)
        fwd, right, up = axes(pan, tilt)
        wv = s["w"][:, None]
        wn = np.linalg.norm(s["w"], axis=1)[:, None]
        ax = np.stack([(wv * right).sum(-1), -(wv * up).sum(-1), -(wv * fwd).sum(-1)], -1) / wn[..., None]
        R = _rodrigues(ax, wn * t) @ random_rotations(n, gen).numpy()[:, None]
        lp = look_params(n, gen)
        base = rng.integers(0, 1 << 20, (n, 2))
        ox = cu - S // 2 - f * (pan - pan[:, N_PRE:N_PRE + 1]) + base[:, :1]
        oy = cv - S // 2 + f * (tilt - tilt[:, N_PRE:N_PRE + 1]) + base[:, 1:]
        si, fi = np.nonzero(ok)
        m = len(si)
        g = lambda a: T(a[si, fi])
        p = {k: lp[k][si] for k in ("light", "amb", "dif", "ball", "seam", "skin", "psf", "noise", "gain", "front")}
        p.update(cx=g(u - cu + 0.5), cy=g(v - cv + 0.5), r=g(r), bx=g(ub - ua), by=g(vb - va), R=T(R[si, fi]),
                 hand_on=g((t < 0.12).astype(float)), gap=g(gap), hb=g(np.clip(1 - t / 0.08, 0, 1)), hdx=g(np.cos(hang)), hdy=g(np.sin(hang)),
                 adx=g(np.cos(aang)), ady=g(np.sin(aang)), bg=(lp["bg"] % len(bank))[si],
                 ox=torch.as_tensor(np.round(ox[si, fi]).astype(np.int64)), oy=torch.as_tensor(np.round(oy[si, fi]).astype(np.int64)))
        p.update(occluder_params(m, p["r"], 0.02, gen))
        res = {k: np.zeros(m) for k in ("cx", "cy", "logr", "la", "lb", "lc", "sr", "hand")}
        for a in range(0, m, BATCH):
            x = render({k: q[a:a + BATCH] for k, q in p.items()}, bank, gen=gen)
            for k, q in predict(net, x).items():
                res[k][a:a + BATCH] = q
            sel = np.nonzero((si[a:a + BATCH] >= keep[0]) & (si[a:a + BATCH] < keep[1]))[0]
            if len(sel):
                crops[ci, si[a:a + BATCH][sel] - keep[0], fi[a:a + BATCH][sel]] = (x[sel] * 255).round().byte().numpy()
            if a % (BATCH * 160) == 0:
                log(f"  camera {'AB'[ci]}: {a}/{m} frames")
        o = out
        o["ok"][ci] = ok
        o["u"][ci][si, fi], o["v"][ci][si, fi] = cu[si, fi] - 0.5 + res["cx"], cv[si, fi] - 0.5 + res["cy"]
        for k in ("logr", "la", "lb", "lc", "sr", "hand"):
            o[k][ci][si, fi] = res[k]
        o["u_true"][ci], o["v_true"][ci], o["r_true"][ci], o["blur"][ci] = u, v, r, np.hypot(ub - ua, vb - va)
        o["cu"][ci], o["cv"][ci] = cu, cv
        o["pan"][ci], o["tilt"][ci], o["f"][ci] = estimated_pose(cam, t, rng)
    out["ok"] = out["ok"] > 0.5
    return out, crops


def film_ideal(s, cams, rng, sd_px=0.3, sd_logr=0.03, lag=1):
    """The same shots and cameras with no pictures: a detector whose errors are exactly Gaussian and
    that sees the release `lag` frames late. For testing the estimator against a known answer, and
    for experiments too big to render."""
    n = len(s["p0"])
    t, P, V = kinematics(s, rng)
    t_end = np.where(np.isnan(s["tc"]), 1.2, s["tc"] - 0.10)
    names = ("u", "v", "logr", "la", "lb", "lc", "sr", "hand", "ok", "u_true", "v_true", "r_true", "pan", "tilt", "f")
    out = {k: np.zeros((len(cams), n, NF)) for k in names}
    out.update(t=t, P=P, V=V)
    for ci, cam in enumerate(cams):
        pan, tilt, f = pose(cam, t)
        u, v, zc = project(P, cam["pos"], pan, tilt, f)
        o = {k: out[k][ci] for k in names}
        o["ok"][:] = (t <= t_end[:, None]) & (u > 40) & (u < W - 40) & (v > 40) & (v < H - 40)
        o["u_true"][:], o["v_true"][:], o["r_true"][:] = u, v, f * BALL_R / zc
        o["u"][:], o["v"][:] = u + rng.normal(0, sd_px, u.shape), v + rng.normal(0, sd_px, u.shape)
        o["logr"][:] = np.log(f * BALL_R / zc) + rng.normal(0, sd_logr, u.shape)
        o["la"][:], o["lc"][:], o["sr"][:] = 1 / sd_px, 1 / sd_px, sd_logr
        o["hand"][:] = (t < lag / FPS).astype(float)
        o["pan"][:], o["tilt"][:], o["f"][:] = estimated_pose(cam, t, rng)
    out["ok"] = out["ok"] > 0.5
    return out


def speed_up(tr, c=0):
    """Log of how much the ball's speed across the picture grew over the last frame, with the
    camera's own motion taken out. While a hand pushes the ball it gains speed every frame; once it
    is free it does not. NaN where a frame is missing."""
    x = tr["u"][c] - tr["f"][c] * (tr["pan"][c] - tr["pan"][c][:, :1])
    y = tr["v"][c] + tr["f"][c] * (tr["tilt"][c] - tr["tilt"][c][:, :1])
    d = np.maximum(np.hypot(np.diff(x, axis=1), np.diff(y, axis=1)), 0.3)
    ok = tr["ok"][c][:, 2:] & tr["ok"][c][:, 1:-1] & tr["ok"][c][:, :-2] & (d[:, 1:] > 2) & (d[:, :-1] > 2)     # too slow in the picture says nothing
    r = np.full(x.shape, np.nan)
    r[:, 2:] = np.where(ok, np.log(d[:, 1:] / d[:, :-1]), np.nan)
    return r


def changepoint(hand, ok, now, grow=None):
    """The most likely frame at which the hand let go, judged only from the frames up to `now`.
    Two clues per frame: what the detector says about the hand, and (grow, from speed_up) whether
    the ball is still gaining speed. One odd frame cannot move it. Returns now + 1 while the ball
    still looks held."""
    h = np.clip(hand[:, :now + 1], 0.02, 0.98)
    held, free = np.where(ok[:, :now + 1], np.log(h), 0.0), np.where(ok[:, :now + 1], np.log(1 - h), 0.0)
    if grow is not None:
        g = grow[:, :now + 1]
        k = ~np.isnan(g)
        g = np.where(k, g, 0.0)
        held += np.where(k, -0.5 * np.minimum(((g - 0.30) / 0.25) ** 2, 9) - np.log(0.25), 0.0)
        free += np.where(k, -0.5 * np.minimum(((g + 0.015) / 0.06) ** 2, 25) - np.log(0.06), 0.0)      # may overrule a hand misread
    z = np.zeros((len(h), 1))
    held, free = np.concatenate([z, np.cumsum(held, 1)], 1), np.concatenate([z, np.cumsum(free, 1)], 1)
    return np.argmax(held + free[:, -1:] - free, 1)


def inflate(la, lb, lc, scale, extra_sd):
    """Rescale a detector covariance by scale^2 and add an isotropic sd, in the same Cholesky form."""
    a, b, d = la * la, la * lb, lb * lb + lc * lc              # precision
    det = np.maximum(a * d - b * b, 1e-12)
    sxx, sxy, syy = scale**2 * d / det + extra_sd**2, -scale**2 * b / det, scale**2 * a / det + extra_sd**2
    det = sxx * syy - sxy * sxy
    a, b, d = syy / det, -sxy / det, sxx / det
    la = np.sqrt(a)
    return la, b / la, np.sqrt(np.maximum(d - (b / la) ** 2, 1e-12))
