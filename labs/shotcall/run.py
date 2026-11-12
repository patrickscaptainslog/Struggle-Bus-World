"""The experiment, stage by stage. Each stage reads the one before from the cache and writes its own.

    python run.py world rim detector tracks infer      # about 25 minutes on four CPU cores
    python report.py                                   # tables, figures, results/results.json

SHOTCALL_SMALL=1 runs a toy-sized version in about a minute, to check that it all still stands up.
"""
import os
import pickle
import sys
import time
import numpy as np
import torch
from shotcall.shots import sample_shots, fit_prior, prior_prob
from shotcall.models import RimModel
from shotcall.render import make_bank
from shotcall import detector
from shotcall.camera import sample_cameras, PAN_JITTER
from shotcall.tracks import film, inflate, NF
from shotcall.estimator import call_shots, learn_priors, first_frame

SMALL = bool(os.environ.get("SHOTCALL_SMALL"))
CACHE = os.environ.get("SHOTCALL_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")) + ("-small" if SMALL else "")
N_RIM, N_VAL, N_EVAL, DET_STEPS = (20000, 4000, 240, 150) if SMALL else (300000, 30000, 4000, 2000)
K_LIST = [2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 24, 30, 36, 45, 54, 63, 72]      # frames after the release
CONFIGS = {"one": [0], "two": [0, 1]}                                        # which cameras the caller may use
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.0f}s]", *a, flush=True)


def save(name, obj):
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, name + ".pkl"), "wb") as f:
        pickle.dump(obj, f, protocol=4)


def load(name):
    with open(os.path.join(CACHE, name + ".pkl"), "rb") as f:
        return pickle.load(f)


def world():
    """Shots to learn the rim from (half of them wilder than life), and the shots to be called."""
    rng = np.random.default_rng(11)
    nat, wide, val = sample_shots(N_RIM // 2, rng), sample_shots(N_RIM // 2, rng, spread=2.5), sample_shots(N_VAL, rng)
    ev = sample_shots(N_EVAL, np.random.default_rng(12))
    f, k = nat["feat"], nat["kappa"]
    ok = ~np.isnan(f[:, 0])
    a0 = float(np.mean(f[ok, 0]))
    stats = dict(a0=a0, sd_a=float(np.std((f[ok, 0] - a0) / k[ok])), sd_b=float(np.std(f[ok, 1] / k[ok])), beta=fit_prior(nat),
                 make_rate=float(nat["made"].mean()), swish_share=float(np.mean(nat["contacts"][nat["made"]] == 0)),
                 flight_s=float(np.nanmean(nat["tc"])), entry_deg=float(np.rad2deg(np.nanmean(f[:, 2]))),
                 speed=float(np.linalg.norm(nat["v0"], axis=1).mean()), sd_long=float(np.nanstd(f[:, 0])), sd_wide=float(np.nanstd(f[:, 1])))
    log("world:", {k_: (round(v, 4) if isinstance(v, float) else "...") for k_, v in stats.items()})
    save("world", dict(nat=nat, wide=wide, val=val, ev=ev, stats=stats))


def rim():
    """Teach the rim model, and see how well the rim itself can be called with the arrival known exactly."""
    w = load("world")
    feat = np.concatenate([w["nat"]["feat"], w["wide"]["feat"]])
    made = np.concatenate([w["nat"]["made"], w["wide"]["made"]])
    m = RimModel().fit(feat, made, log)
    p, y = m.predict(w["val"]["feat"]), w["val"]["made"]
    pc = np.clip(p, 1e-4, 1 - 1e-4)
    st = dict(val_logloss=float(-np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc))), val_brier=float(np.mean((p - y) ** 2)),
              val_acc=float(np.mean((p > 0.5) == y)), base_brier=float(y.mean() * (1 - y.mean())))
    log("rim:", st)
    save("rim", dict(model=m.state(), stats=st))


def det():
    bank = make_bank(24 if not SMALL else 8, seed=0)
    net = detector.train(bank, DET_STEPS, log=log)
    st = detector.validate(net, bank)
    log("detector:", {k: round(v, 3) for k, v in st.items()})
    save("detector", dict(net=net.state_dict(), stats=st))


def tracks():
    w, d = load("world"), load("detector")
    net = detector.BallNet()
    net.load_state_dict(d["net"])
    net.eval()
    rng, gen = np.random.default_rng(13), torch.Generator().manual_seed(13)
    cams = sample_cameras(w["ev"]["feet"], rng)
    tr, crops = film(w["ev"], cams, net, make_bank(24 if not SMALL else 8, seed=0), rng, gen, keep=(N_EVAL // 2, N_EVAL // 2 + 40), log=log)
    save("tracks", dict(tr=tr, cams=cams, crops=crops))                         # crops of the first test shots only


def infer():
    """Calibrate the detector's error bars and the priors on the first half of the shots, then call
    every shot at every time with one camera and with two."""
    w, t = load("world"), load("tracks")
    tr, cams, ev = t["tr"], t["cams"], w["ev"]
    n = len(ev["p0"])
    cal = np.arange(n) < n // 2
    scale = {}
    for c in range(len(cams)):
        g = tr["ok"][c] & (tr["t"] > 0.03) & cal[:, None]
        ex, ey = (tr["u"][c] - tr["u_true"][c])[g], (tr["v"][c] - tr["v_true"][c])[g]
        chi = (tr["la"][c][g] * ex + tr["lb"][c][g] * ey) ** 2 + (tr["lc"][c][g] * ey) ** 2
        er = (tr["logr"][c] - np.log(np.maximum(tr["r_true"][c], 1e-6)))[g]
        s_xy, s_r = float(np.sqrt(np.mean(np.minimum(chi, 25)) / 2)), float(np.sqrt(np.mean(np.minimum((er / tr["sr"][c][g]) ** 2, 12))))
        scale["AB"[c]] = dict(s_xy=s_xy, s_r=s_r, rms_px=float(np.sqrt(np.mean(ex**2 + ey**2))), median_px=float(np.median(np.hypot(ex, ey))),
                              p95_px=float(np.quantile(np.hypot(ex, ey), 0.95)), size_err_pct=float(100 * np.sqrt(np.mean(er**2))),
                              radius_px=float(np.mean(tr["r_true"][c][g])), blur_px=float(np.mean(tr["blur"][c][g])))
        tr["la"][c], tr["lb"][c], tr["lc"][c] = inflate(np.maximum(tr["la"][c], 1e-3), tr["lb"][c], np.maximum(tr["lc"][c], 1e-3), s_xy, PAN_JITTER * tr["f"][c])
        tr["sr"][c] = np.maximum(tr["sr"][c], 1e-3) * s_r
    log("detector on the filmed shots:", scale)
    jd = first_frame(tr, NF - 1)[0]
    ar = np.arange(n)
    hyper = learn_priors(tr, ev, w["stats"], cal)
    st = w["stats"]
    lag = tr["t"][ar, np.minimum(jd, NF - 1)]
    log("priors:", {k: round(v, 4) for k, v in hyper.items()})
    log(f"release seen {np.mean(lag) * 1000:.0f} ms after it happens on average; frame-exact {np.mean(jd == 6):.2f}, one late {np.mean(jd == 7):.2f}, "
        f"two or more late {np.mean(jd > 7):.2f}, early {np.mean(jd < 6):.2f}")
    m = RimModel().load(load("rim")["model"])
    out = dict(hyper=hyper, scale=scale, release=dict(mean_lag_ms=float(np.mean(lag) * 1000), exact=float(np.mean(jd == 6)), late1=float(np.mean(jd == 7)),
                                                    late2=float(np.mean(jd > 7)), early=float(np.mean(jd < 6))), k_list=K_LIST)
    for name, ids in CONFIGS.items():
        log(f"calling with camera(s) {[('AB'[i]) for i in ids]}")
        out[name] = call_shots(tr, ev, cams, ids, m, hyper, K_LIST, np.random.default_rng(14), log)
    out["p0"] = prior_prob(ev, st["beta"])
    out["oracle"] = m.predict(ev["feat"])
    save("infer", out)


STAGES = dict(world=world, rim=rim, detector=det, tracks=tracks, infer=infer)

if __name__ == "__main__":
    torch.set_num_threads(int(os.environ.get("SHOTCALL_THREADS", 4)))
    for s in sys.argv[1:] or list(STAGES):
        log(f"== {s}")
        STAGES[s]()
    log("done")
