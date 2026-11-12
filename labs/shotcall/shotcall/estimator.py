"""Where is this shot going? Bayesian inference of the ball's state from the frames seen so far.

Nine unknowns: position and velocity at the first frame used, backspin, sidespin and the drag
coefficient. Three more per camera for what its calibration may have got wrong (a pixel offset each
way and the focal length). The frames give pixel positions and apparent sizes with the detector's
own error bars; the priors say where the shooter stands, how threes are launched, and that shooters
aim at the rim. A damped Gauss-Newton fit finds the most probable state and the curvature there
gives a Gaussian posterior, which is carried along the flight to the rim plane and through the
learned rim model to a probability.
"""
import numpy as np
from .court import BALL_R, CD0
from .physics import flight, crossing_features, spin_vector, velocity
from .camera import project, W, H, PAN_BIAS, F_BIAS
from .shots import SPIN_MEAN, SPIN_SD, SIDE_SD, CD_SD, solve_aim
from .tracks import N_PRE, NF, changepoint, speed_up

NP_ = 9
STEP = np.array([1e-3] * 6 + [0.05, 0.05, 1e-3])        # finite-difference steps
HUBER = 2.5
OBS = ("u", "v", "logr", "la", "lb", "lc", "sr", "pan", "tilt", "f")
NEVER = np.array([-3.0, 0, 0.8, 8.0, 0, 0, 0])          # stand-in crossing for a ball that never gets up to the rim


def _huber(r, hub, n_prior):
    """Square-root IRLS weights and the Huber cost of residuals r (B,R). The last n_prior are priors
    and stay Gaussian. hub (B,) is each shot's threshold."""
    a, h = np.abs(r[:, :-n_prior]), hub[:, None]
    sw = np.ones_like(r)
    sw[:, :-n_prior] = np.sqrt(np.minimum(1.0, h / np.maximum(a, 1e-9)))
    return sw, np.where(a <= h, a * a, 2 * h * a - h * h).sum(1) + (r[:, -n_prior:] ** 2).sum(1)


def residuals(th, nu, obs, steps, pri):
    """th (B,Q,9) states, nu (B,C,3) calibration errors -> whitened residuals (B,Q,R), the virtual
    crossing (B,Q,7), and each camera's predicted pixel offsets from the image centre."""
    B, Q, _ = th.shape
    fl = th.reshape(B * Q, NP_)
    n_store = int(steps.max()) + 1
    pos, _, pc, vc = flight(fl[:, :3], fl[:, 3:6], spin_vector(fl[:, 3:6], fl[:, 6], fl[:, 7]), fl[:, 8], n_store=n_store)
    feat = crossing_features(pc, vc, fl[:, 6], fl[:, 7]).reshape(B, Q, 7)
    feat = np.where(np.isnan(feat[..., :1]), NEVER, feat)
    Pf = pos.reshape(B, Q, n_store, 3)[np.arange(B)[:, None, None], np.arange(Q)[None, :, None], steps[:, None, :]]
    res, uv = [], []
    for c, o in enumerate(obs):
        uh, vh, zc = project(Pf, o["pos"], o["pan"], o["tilt"], o["f"])
        bu, bv, bf = (nu[:, c, i][:, None, None] for i in range(3))
        du, dv = uh - W / 2, vh - H / 2
        ex, ey = o["u"] - uh + bf * du - bu, o["v"] - vh + bf * dv - bv
        w3 = (o["logr"] - np.log(np.maximum(o["f"] * BALL_R / zc, 1e-3)) + bf) / o["sr"]
        res += [np.where(o["wt"] > 0, w * o["wt"], 0.0) for w in (o["la"] * ex + o["lb"] * ey, o["lc"] * ey, w3)]
        uv.append((du[:, 0], dv[:, 0]))
    d = th[..., :2] - pri["xy"][:, None]
    el = np.arctan2(th[..., 5], np.hypot(th[..., 3], th[..., 4]))
    k = pri["kappa"][:, None]
    pr = np.stack([d[..., 0] / pri["sd_xy"], d[..., 1] / pri["sd_xy"], (th[..., 2] - pri["mu_z"]) / pri["sd_z"],
                   (el - pri["mu_el"]) / pri["sd_el"], (feat[..., 0] - pri["a0"]) / (k * pri["sd_a"]), feat[..., 1] / (k * pri["sd_b"]),
                   (th[..., 6] - SPIN_MEAN) / SPIN_SD, th[..., 7] / SIDE_SD, (th[..., 8] - CD0) / CD_SD], -1)
    prn = np.concatenate([nu[:, c] / o["sdn"] for c, o in enumerate(obs)], 1)
    return np.concatenate(res + [pr, np.broadcast_to(prn[:, None], (B, Q, prn.shape[1]))], -1), feat, uv


def jacobian(th, nu, obs, steps, pri):
    """Residuals and their derivatives: by finite differences for the nine physical unknowns (ten
    flights), in closed form for the calibration errors (no flight at all)."""
    r, f, uv = residuals(th[:, None] + np.concatenate([np.zeros((1, NP_)), np.diag(STEP)])[None], nu, obs, steps, pri)
    B, _, R = r.shape
    C, F = len(obs), steps.shape[1]
    Jn = np.zeros((B, R, 3 * C))
    for c, o in enumerate(obs):
        wt, la, lb, lc, sr = (o[q][:, 0] for q in ("wt", "la", "lb", "lc", "sr"))
        du, dv = uv[c]
        a = 3 * F * c
        Jn[:, a:a + F, 3 * c], Jn[:, a:a + F, 3 * c + 1], Jn[:, a:a + F, 3 * c + 2] = -la * wt, -lb * wt, (la * du + lb * dv) * wt
        Jn[:, a + F:a + 2 * F, 3 * c + 1], Jn[:, a + F:a + 2 * F, 3 * c + 2] = -lc * wt, lc * dv * wt
        Jn[:, a + 2 * F:a + 3 * F, 3 * c + 2] = wt / sr
        for i in range(3):
            Jn[:, R - 3 * C + 3 * c + i, 3 * c + i] = 1 / o["sdn"][:, i]
    J = np.concatenate([(r[:, 1:] - r[:, :1]).transpose(0, 2, 1) / STEP, Jn], 2)
    return J, r[:, 0], f[:, 0], (f[:, 1:] - f[:, :1]).transpose(0, 2, 1) / STEP


def fit(th, nu, obs, steps, pri, cold):
    """Levenberg-Marquardt for a whole batch of shots at once, Huber-robust by reweighting. A shot
    fitted for the first time (cold) takes three plain least-squares steps first, to get near.
    Returns the state, the calibration errors, the state's covariance (calibration marginalised),
    the crossing, the crossing's sensitivity to the state, and the cost."""
    B, C = len(th), len(obs)
    n_prior, M = NP_ + 3 * C, NP_ + 3 * C
    lam = np.full(B, 1e-3)
    for it in range(8 if cold.any() else 4):
        hub = np.where(cold & (it < 3), 1e9, HUBER)
        J, r, _, _ = jacobian(th, nu, obs, steps, pri)
        sw, cost = _huber(r, hub, n_prior)
        J = J * sw[:, :, None]
        A, g = np.einsum("bri,brj->bij", J, J), np.einsum("bri,br->bi", J, r * sw)
        D = np.eye(M) * np.diagonal(A, axis1=1, axis2=2)[:, None, :]
        done = np.zeros(B, bool)
        for _ in range(3):
            x = np.linalg.solve(A + lam[:, None, None] * D, -g[..., None])[..., 0]
            tn, nn = th + x[:, :NP_], nu + x[:, NP_:].reshape(B, C, 3)
            ok = (_huber(residuals(tn[:, None], nn, obs, steps, pri)[0][:, 0], hub, n_prior)[1] < cost) & ~done
            th, nu = np.where(ok[:, None], tn, th), np.where(ok[:, None, None], nn, nu)
            lam = np.where(ok, lam / 3, np.where(done, lam, lam * 5))
            done |= ok
            if done.all():
                break
    J, r, feat, Jf = jacobian(th, nu, obs, steps, pri)
    sw, cost = _huber(r, np.full(B, HUBER), n_prior)
    J = J * sw[:, :, None]
    return th, nu, np.linalg.inv(np.einsum("bri,brj->bij", J, J))[:, :NP_, :NP_], feat, Jf, cost


def outcome(feat, cf, rim, z, widen=1.0):
    """The chance of a make: draw ways of arriving from the posterior (mean feat, covariance cf, both
    in the seven numbers of the crossing), ask the rim model about each, average. z are standard
    normal draws (B,S,7); widen stretches the posterior, for the calibration in report.py."""
    L = np.linalg.cholesky(cf + 1e-10 * np.eye(7))
    fs = feat[:, None] + widen * np.einsum("bij,bsj->bsi", L, z)
    return rim.predict(fs.reshape(-1, 7)).reshape(z.shape[:2]).mean(1)


def first_frame(tr, now):
    """(jd, js): the frame the release is seen at, judged at `now`, and the first frame to fit from.
    That is one frame back, where the ball was probably free too, but never a frame camera A missed."""
    ok = tr["ok"][0]
    if "grow" not in tr:
        tr["grow"] = speed_up(tr)
    jd = np.where(ok[:, :now + 1].any(1), changepoint(tr["hand"][0], ok, now, tr["grow"]), NF)
    return jd, np.maximum(jd - 1, ok.argmax(1))


def learn_priors(tr, shots, stats, cal):
    """Where the ball is, and how it is moving, at the first frame the caller will use: measured on
    the calibration shots, as it would be from a season of tracked games."""
    n = len(shots["p0"])
    js = first_frame(tr, NF - 1)[1]
    Pj, Vj = tr["P"][np.arange(n), js], tr["V"][np.arange(n), js]
    fwd = -shots["feet"] / np.linalg.norm(shots["feet"], axis=1, keepdims=True)
    d = (Pj[:, :2] - shots["feet"])[cal]
    along, across = (d * fwd[cal]).sum(1), d[:, 1] * fwd[cal, 0] - d[:, 0] * fwd[cal, 1]
    el = np.arctan2(Vj[cal, 2], np.hypot(Vj[cal, 0], Vj[cal, 1]))
    return dict(mu_fwd=float(along.mean()), sd_xy=float(np.sqrt(np.mean((along - along.mean()) ** 2 + across**2) / 2)),
                mu_z=float(Pj[cal, 2].mean()), sd_z=float(Pj[cal, 2].std()), mu_el=float(el.mean()), sd_el=float(el.std()),
                a0=stats["a0"], sd_a=stats["sd_a"], sd_b=stats["sd_b"])


def call_shots(tr, shots, cams, cam_ids, rim, hyper, k_list, rng, log=print):
    """Run the caller on every shot at each of k_list frames after the release, using only what had
    been filmed by then.

    Returns p (K,n), the posterior of the rim-plane crossing (mean feat and covariance cf: the first
    two of its seven numbers are long/short and left/right), and whether the release had been seen
    yet; before that p is NaN and the caller has only its prior to offer.
    """
    n = len(shots["p0"])
    fwd = -shots["feet"] / np.linalg.norm(shots["feet"], axis=1, keepdims=True)
    pri = dict(hyper, xy=shots["feet"] + hyper["mu_fwd"] * fwd, kappa=shots["kappa"])
    p_init = np.concatenate([pri["xy"], np.full((n, 1), hyper["mu_z"])], 1)
    el = np.full(n, hyper["mu_el"])
    s, az = solve_aim(p_init, el, np.full(n, SPIN_MEAN), np.zeros(n), np.full(n, CD0))
    th0 = np.concatenate([p_init, velocity(s, el, az), np.full((n, 1), SPIN_MEAN), np.zeros((n, 1)), np.full((n, 1), CD0)], 1)
    th, nu, js = th0.copy(), np.zeros((n, len(cam_ids), 3)), np.full(n, -1)
    K = len(k_list)
    out = dict(p=np.full((K, n), np.nan), cf=np.full((K, n, 7, 7), np.nan), feat=np.full((K, n, 7), np.nan),
               chi=np.full((K, n), np.nan), nfr=np.zeros((K, n)), seen=np.zeros((K, n), bool), jd=np.zeros((K, n), int))
    for ki, k in enumerate(k_list):
        now = N_PRE + k - 1
        jd, jn = first_frame(tr, now)
        out["jd"][ki] = jd
        cold = jn != js                                         # new, or the release moved: fit that shot afresh
        th[cold], nu[cold] = th0[cold], 0.0
        js = jn
        ia = np.nonzero((jd <= now) & (js <= now))[0]
        if not len(ia):
            continue
        fr = np.arange(js[ia].min(), now + 1)
        steps = np.clip(fr[None] - js[ia, None], 0, None)
        obs, nfr = [], 0
        for c in cam_ids:
            use = tr["ok"][c][ia][:, fr] & (fr[None] >= js[ia, None])
            o = {q: tr[q][c][ia][:, fr][:, None] for q in OBS}
            sb = PAN_BIAS * tr["f"][c][ia, N_PRE]
            o.update(wt=(use * np.where(fr[None] == js[ia, None], 1 / 1.5, 1.0))[:, None], pos=cams[c]["pos"],
                     sdn=np.stack([sb, sb, np.full(len(ia), F_BIAS)], 1))
            obs.append(o)
            nfr = nfr + use.sum(1)
        pa = {q: (v[ia] if isinstance(v, np.ndarray) else v) for q, v in pri.items()}
        th[ia], nu[ia], cov, feat, Jf, cost = fit(th[ia], nu[ia], obs, steps, pa, cold[ia])
        cf = np.einsum("bfi,bij,bgj->bfg", Jf, cov, Jf)             # the posterior carried to the rim plane
        out["p"][ki, ia], out["cf"][ki, ia] = outcome(feat, cf, rim, rng.normal(size=(len(ia), 200, 7))), cf
        out["feat"][ki, ia], out["chi"][ki, ia], out["nfr"][ki, ia], out["seen"][ki, ia] = feat, cost / (3 * nfr + NP_ + 3 * len(cam_ids)), nfr, True
        log(f"  frame {k:3d} after release: {len(ia)} shots, median cost per residual {np.median(cost / (3 * nfr + NP_ + 3 * len(cam_ids))):.2f}")
    return out
