"""Turn the cached experiment into numbers, figures and the data the showcase page plays back.

    python report.py        # writes results/results.json and results/*.png, and showcase.json in the cache

Everything is scored on the second half of the filmed shots. The first half is where the detector's
error bars, the priors and the calibration were fitted, so nothing here has seen its own test.
"""
import base64
import io
import json
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import Circle, Ellipse
from PIL import Image
import run
from shotcall.court import RIM_R, ROD_R
from shotcall.models import RimModel
from shotcall.estimator import outcome
from shotcall.tracks import N_PRE, NF
from shotcall.camera import FPS

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
INK, INK2, MUTED, GRID, AXIS, SURF = "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7", "#fcfcfb"
COL = {"one": "#2a78d6", "two": "#eb6834"}
NAME = {"one": "One camera", "two": "Two cameras"}
GREYS = LinearSegmentedColormap.from_list("greys", [SURF, GRID, AXIS, MUTED, INK2])      # neutral, so the two series colours read on top
SURE = 0.90                                 # a call is a probability at least this far from the fence
WIDEN = np.array([1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5, 3.0])
CROP_KS = (-1, 1, 2, 4, 8, 15, 30, 54)      # frames after the release shown in the film strips


def auc(y, p):
    r = pd.Series(p).rank().to_numpy()
    n1 = y.sum()
    return float((r[y > 0.5].sum() - n1 * (n1 + 1) / 2) / (n1 * (len(y) - n1)))


def brier(y, p):
    return float(np.mean((p - y) ** 2))


def logloss(y, p):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def widen(o, p0, y, cal, rim, seed=7):
    """The calibration step. With one camera the fit grows too sure of itself as the flight goes on,
    because the detector's small errors run together from frame to frame and the fit takes them
    for independent. So the posterior at the rim is stretched by one factor per moment: the factor
    that makes the outcomes of the calibration shots most likely (pooled with the moments either
    side, to steady it). Makes and misses are all it uses. Returns the calibrated probabilities
    (K,n) and the factors (K,)."""
    K, n = o["p"].shape
    loss = np.zeros((K, len(WIDEN)))
    draws = lambda k, m: np.random.default_rng(seed + k).normal(size=(m, 200, 7))
    for k in range(K):
        s = o["seen"][k] & cal
        z = draws(k, int(o["seen"][k].sum()))[cal[o["seen"][k]]]
        for j, wd in enumerate(WIDEN):
            q = np.clip(outcome(o["feat"][k][s], o["cf"][k][s], rim, z, wd), 1e-4, 1 - 1e-4)
            loss[k, j] = -np.sum(y[s] * np.log(q) + (1 - y[s]) * np.log(1 - q))
    pooled = loss.copy()
    pooled[1:] += loss[:-1]
    pooled[:-1] += loss[1:]
    fac = WIDEN[pooled.argmin(1)]
    p = np.broadcast_to(p0, (K, n)).copy()
    for k in range(K):
        s = o["seen"][k]
        p[k, s] = outcome(o["feat"][k][s], o["cf"][k][s], rim, draws(k, int(s.sum())), fac[k])
    return p, fac


def style(ax, xlabel=None, title=None, grid="y"):
    ax.set_facecolor(SURF)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(AXIS)
    if grid:
        ax.grid(True, axis=grid, color=GRID, linewidth=1)
    ax.set_axisbelow(True)
    ax.tick_params(colors=MUTED, length=0, labelsize=9)
    if xlabel:
        ax.set_xlabel(xlabel, color=INK2, fontsize=10)
    if title:
        ax.set_title(title, color=INK, fontsize=11, loc="left", fontweight="bold", pad=10)


def line(ax, x, yv, c, label, band=None, fmt="{:.2f}"):
    ax.plot(x, yv, color=c, lw=2, solid_capstyle="round", solid_joinstyle="round", label=label)
    if band is not None:
        ax.fill_between(x, band[0], band[1], color=c, alpha=0.10, lw=0)
    ax.plot(x[-1], yv[-1], "o", color=c, ms=8, mec=SURF, mew=2)
    ax.annotate(fmt.format(yv[-1]), (x[-1], yv[-1]), xytext=(8, 0), textcoords="offset points", va="center", color=INK2, fontsize=9)


def fig_earliness(R, path):
    fig, axs = plt.subplots(1, 2, figsize=(11, 4.3), facecolor=SURF)
    t = np.array(R["t_ms"])
    for ax, key, title in ((axs[0], "auc", "Telling makes from misses (AUC, higher is better)"),
                           (axs[1], "brier", "Error of the probability (Brier score, lower is better)")):
        style(ax, "Time since the ball left the hand (ms)", title)
        ax.plot(t, R["curves"]["prior"][key], color=MUTED, lw=2, label="Before the release: shooter and spot only")
        for c in ("one", "two"):
            line(ax, t, R["curves"][c][key], COL[c], NAME[c], R["curves"][c][key + "_ci"], fmt="{:.3f}")
        ax.axhline(R["oracle"][key], color=AXIS, lw=1)
        ax.annotate("arrival at the rim known exactly", (t[0], R["oracle"][key]), xytext=(0, 4 if key == "auc" else -11), textcoords="offset points",
                    color=MUTED, fontsize=8)
        ax.set_xlim(0, t[-1] * 1.11)
    axs[0].legend(frameon=False, fontsize=9, labelcolor=INK2, loc="lower right", bbox_to_anchor=(0.93, 0.10))
    fig.tight_layout()
    fig.savefig(path, dpi=110, facecolor=SURF)
    plt.close(fig)


def fig_calls(R, path):
    fig, axs = plt.subplots(1, 2, figsize=(11, 4.0), facecolor=SURF)
    t = np.array(R["t_ms"])
    for ax, key, title in ((axs[0], "misses_caught", f"Share of all misses already called (model under {100 - int(SURE * 100)} %)"),
                           (axs[1], "makes_caught", f"Share of all makes already called (model over {int(SURE * 100)} %)")):
        style(ax, "Time since the ball left the hand (ms)", title)
        for c in ("one", "two"):
            line(ax, t, 100 * np.array(R["calls"][c][key]), COL[c], NAME[c], fmt="{:.0f} %")
        ax.set_ylim(0, 100)
        ax.set_xlim(0, t[-1] * 1.1)
        ax.yaxis.set_major_formatter(lambda v, _: f"{v:.0f} %")
    axs[0].legend(frameon=False, fontsize=9, labelcolor=INK2, loc="upper left")
    fig.tight_layout()
    fig.savefig(path, dpi=110, facecolor=SURF)
    plt.close(fig)


def fig_reliability(R, path):
    fig, axs = plt.subplots(1, 2, figsize=(9, 4.4), facecolor=SURF)
    for ax, c in zip(axs, ("one", "two")):
        style(ax, "What the model said", f"{NAME[c]}: said versus happened", grid="both")
        ax.plot([0, 1], [0, 1], color=AXIS, lw=1)
        for key, col, lab in (("phys", MUTED, "As fitted"), ("calibrated", COL[c], "After the calibration")):
            r = R["reliability"][c][key]
            ax.plot(r["said"], r["happened"], "-o", color=col, lw=2, ms=7, mec=SURF, mew=2, label=f"{lab} (gap {100 * r['ece']:.1f} pts)")
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.set_aspect("equal")
        ax.set_ylabel("What happened", color=INK2, fontsize=10)
        ax.legend(frameon=False, fontsize=9, labelcolor=INK2, loc="upper left")
    fig.tight_layout()
    fig.savefig(path, dpi=110, facecolor=SURF)
    plt.close(fig)


def _rim_axes(ax, R, title):
    g = R["rim_map"]
    style(ax, "Short  <  where the ball comes down through the rim's plane (cm)  >  long", title, grid=None)
    im = ax.imshow(np.array(g["p"]).T, origin="lower", extent=[100 * g["a"][0], 100 * g["a"][-1], 100 * g["b"][0], 100 * g["b"][-1]],
                   cmap=GREYS, vmin=0, vmax=1, aspect="equal", interpolation="bilinear")
    ax.add_patch(Circle((0, 0), 100 * (RIM_R - ROD_R), fill=False, ec=INK, lw=1))
    ax.set_ylabel("Right  <  (cm)  >  left", color=INK2, fontsize=10)
    return im


def fig_rim(R, ex, path):
    fig, axs = plt.subplots(1, 2, figsize=(11, 4.6), facecolor=SURF)
    im = _rim_axes(axs[0], R, "What the rim does: chance of a make by where the ball arrives")
    cb = fig.colorbar(im, ax=axs[0], fraction=0.035, pad=0.02)
    cb.outline.set_visible(False)
    cb.ax.tick_params(colors=MUTED, length=0, labelsize=8)
    _rim_axes(axs[1], R, f"One shot ({ex['label']}): where the model thinks it is going")
    for c in ("one", "two"):
        for step in ex["steps"]:
            s = step[c]
            if s is None or step["k"] not in (4, 15, 36, 72):
                continue
            val, vec = np.linalg.eigh(np.array(s["cov"]))
            axs[1].add_patch(Ellipse((100 * s["mu"][0], 100 * s["mu"][1]), 400 * np.sqrt(val[1]), 400 * np.sqrt(val[0]),
                                     angle=np.rad2deg(np.arctan2(vec[1, 1], vec[0, 1])), fill=False, ec=COL[c], lw=2))
        axs[1].plot([], [], color=COL[c], lw=2, label=f"{NAME[c]}: 95 % region at 4, 15, 36 and 72 frames")
    axs[1].plot(100 * ex["truth"][0], 100 * ex["truth"][1], "o", color=INK, ms=8, mec=SURF, mew=2, label="Where it really went")
    axs[1].set_xlim(-50, 50)
    axs[1].set_ylim(-40, 40)
    axs[1].legend(frameon=False, fontsize=8, labelcolor=INK2, loc="upper left")
    fig.tight_layout()
    fig.savefig(path, dpi=110, facecolor=SURF)
    plt.close(fig)


def fig_crops(crops, tr, base, rows, path):
    """What the detector is given, and where it put the centre."""
    cols = list(range(N_PRE - 2, N_PRE + 4)) + [N_PRE + 8, N_PRE + 16, N_PRE + 30, N_PRE + 50]
    fig, axs = plt.subplots(len(rows), len(cols), figsize=(11, 1.25 * len(rows) + 0.3), facecolor=SURF)
    axs = np.atleast_2d(axs)
    for r, j in enumerate(rows):
        for q, f in enumerate(cols):
            ax = axs[r, q]
            ax.imshow(crops[0, j, f].transpose(1, 2, 0), interpolation="nearest")
            if tr["ok"][0][base + j, f]:
                ax.plot(tr["u"][0][base + j, f] - tr["cu"][0][base + j, f] + 32, tr["v"][0][base + j, f] - tr["cv"][0][base + j, f] + 32, "+", color="white", ms=7, mew=1)
            ax.set_xticks([])
            ax.set_yticks([])
            for s in ax.spines.values():
                s.set_visible(False)
            if r == 0:
                ax.set_title(f"{1000 * tr['t'][base + j, f]:+.0f} ms", color=INK2, fontsize=8)
    fig.tight_layout(pad=0.4)
    fig.savefig(path, dpi=110, facecolor=SURF)
    plt.close(fig)


def jpeg(a):
    b = io.BytesIO()
    Image.fromarray(a.transpose(1, 2, 0)).save(b, "JPEG", quality=82)
    return base64.b64encode(b.getvalue()).decode()


def rnd(o, d=4):
    if isinstance(o, dict):
        return {k: rnd(v, d) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [rnd(v, d) for v in o]
    if isinstance(o, np.ndarray):
        return rnd(o.tolist(), d)
    if isinstance(o, (float, np.floating)):
        return None if np.isnan(o) else round(float(o), d)
    if isinstance(o, (np.integer, np.bool_)):
        return o.item()
    return o


def main():
    w, tk, inf, det, rimc = (run.load(k) for k in ("world", "tracks", "infer", "detector", "rim"))
    ev, tr = w["ev"], tk["tr"]
    n = len(ev["p0"])
    cal = np.arange(n) < n // 2
    te = ~cal
    y, p0, ks = ev["made"].astype(float), inf["p0"], np.array(inf["k_list"])
    K, yt = len(ks), ev["made"].astype(float)[te]
    t_all = tr["t"][:, N_PRE + ks - 1]                       # (n,K) seconds since the release at each call
    rim = RimModel().load(rimc["model"])
    P, fac = {"prior": np.broadcast_to(p0, (K, n))}, {}
    for c in run.CONFIGS:
        P[c + "_phys"] = np.where(inf[c]["seen"], inf[c]["p"], p0)
        P[c], fac[c] = widen(inf[c], p0, y, cal, rim)
    rng = np.random.default_rng(0)
    boot = rng.integers(0, te.sum(), (200, te.sum()))

    def curve(p, ci=False):
        p = p[:, te]
        out = dict(auc=[auc(yt, p[k]) for k in range(K)], brier=[brier(yt, p[k]) for k in range(K)], logloss=[logloss(yt, p[k]) for k in range(K)],
                   acc=[float(np.mean((p[k] > 0.5) == yt)) for k in range(K)])
        if ci:
            for key, fn in (("auc", auc), ("brier", brier)):
                b = np.array([[fn(yt[i], p[k][i]) for k in range(K)] for i in boot])
                out[key + "_ci"] = [np.quantile(b, 0.025, 0), np.quantile(b, 0.975, 0)]
        return out

    R = dict(meta=dict(n_test=int(te.sum()), n_cal=int(cal.sum()), fps=FPS, k_list=ks, sure=SURE, make_rate_test=float(yt.mean())),
             t_ms=1000 * t_all[te].mean(0), world={k: v for k, v in w["stats"].items() if k != "beta"},
             rim=rimc["stats"], detector=dict(crops=det["stats"], filmed=inf["scale"]), release=inf["release"], priors=inf["hyper"],
             curves={k: curve(v, k in run.CONFIGS) for k, v in P.items()}, widen=fac,
             oracle=dict(auc=auc(yt, inf["oracle"][te]), brier=brier(yt, inf["oracle"][te]), acc=float(np.mean((inf["oracle"][te] > 0.5) == yt))))

    R["calls"], R["lead"], R["reliability"] = {}, {}, {}
    tc = ev["tc"][te]
    for c in run.CONFIGS:
        p = P[c][:, te]
        mk, ms = p >= SURE, p <= 1 - SURE
        R["calls"][c] = dict(makes_caught=(mk & (yt > 0.5)).sum(1) / yt.sum(), misses_caught=(ms & (yt < 0.5)).sum(1) / (1 - yt).sum(),
                             make_right=(mk & (yt > 0.5)).sum(1) / np.maximum(mk.sum(1), 1), miss_right=(ms & (yt < 0.5)).sum(1) / np.maximum(ms.sum(1), 1),
                             called=(mk | ms).mean(1))
        dec = mk | ms
        first, any_ = dec.argmax(0), dec.any(0)
        ar = np.arange(te.sum())
        t_call = t_all[te][ar, first]
        said_make = p[first, ar] >= SURE
        right = said_make == (yt > 0.5)
        lead = tc - t_call

        def lead_stats(m):
            m = m & any_
            return dict(share=float(m.mean()), right=float(right[m].mean()) if m.any() else None,
                        call_ms=1000 * np.nanquantile(t_call[m], [0.25, 0.5, 0.75]) if m.any() else None,
                        lead_ms=1000 * np.nanquantile(lead[m], [0.25, 0.5, 0.75]) if m.any() else None)

        R["lead"][c] = dict(any=lead_stats(np.ones_like(any_)), miss=lead_stats(~said_make), make=lead_stats(said_make))
        mid = (ks >= 12) & (ks <= 54)
        R["reliability"][c] = {}
        for key, arr in (("phys", P[c + "_phys"]), ("calibrated", P[c])):
            q, yy = arr[mid][:, te].ravel(), np.broadcast_to(yt, (mid.sum(), te.sum())).ravel()
            b = np.minimum((q * 10).astype(int), 9)
            cnt = np.bincount(b, minlength=10)
            said, hap = np.bincount(b, q, 10) / np.maximum(cnt, 1), np.bincount(b, yy, 10) / np.maximum(cnt, 1)
            keep = cnt >= 30
            R["reliability"][c][key] = dict(said=said[keep], happened=hap[keep], count=cnt[keep], ece=float(np.sum(cnt * np.abs(said - hap)) / cnt.sum()))

    phi = np.arctan2(ev["feet"][:, 1], -ev["feet"][:, 0])
    zone = np.where(ev["corner"], np.where(ev["feet"][:, 1] < 0, 0, 1), np.where(np.abs(phi) > np.deg2rad(30), 2, 3))
    R["zones"] = dict(names=["Near corner (shot goes away from the camera)", "Far corner (shot comes toward the camera)", "Wing", "Top of the arc"], rows=[])
    for z in range(4):
        m = te & (zone == z)
        R["zones"]["rows"].append(dict(n=int(m.sum()), make_rate=float(y[m].mean()),
                                      **{c: dict(auc=[auc(y[m], P[c][k, m]) for k in range(K)], brier=[brier(y[m], P[c][k, m]) for k in range(K)]) for c in run.CONFIGS},
                                      prior_brier=brier(y[m], p0[m])))

    med = np.nanmedian(ev["feat"], 0)
    ga, gb = np.linspace(-0.5, 0.5, 51), np.linspace(-0.4, 0.4, 41)
    A, B = np.meshgrid(ga, gb, indexing="ij")
    grid = np.tile(med, (A.size, 1))
    grid[:, 0], grid[:, 1], grid[:, 4], grid[:, 6] = A.ravel(), B.ravel(), 0.0, 0.0
    R["rim_map"] = dict(a=ga, b=gb, p=np.round(rim.predict(grid).reshape(A.shape), 3), entry_deg=float(np.rad2deg(med[2])))

    # shots to play back: one of each kind among the first test shots, whose crops were kept
    base, nk = n // 2, tk["crops"].shape[1]
    f, mdl, cont = ev["feat"][base:base + nk], ev["made"][base:base + nk], ev["contacts"][base:base + nk]
    kinds = [("Swish", mdl & (cont == 0)), ("Off the rim and in", mdl & (cont > 0)), ("Short", ~mdl & (f[:, 0] < -0.15)), ("Long", ~mdl & (f[:, 0] > 0.2)),
             ("Wide", ~mdl & (np.abs(f[:, 1]) > 0.14) & (np.abs(f[:, 0]) < 0.12)), ("Rims out", ~mdl & (cont > 0) & (np.abs(f[:, 0]) < 0.14) & (np.abs(f[:, 1]) < 0.12)),
             ("Swish", mdl & (cont == 0)), ("Short", ~mdl & (f[:, 0] < -0.1))]
    picked, examples = [], []
    for label, m in kinds:
        cand = [j for j in np.nonzero(m)[0] if j not in picked and tr["ok"][0][base + j, N_PRE:N_PRE + 60].all() and tr["ok"][1][base + j, N_PRE:N_PRE + 60].all()]
        if not cand:
            continue
        j = cand[0]
        picked.append(j)
        i = base + j
        last = min(NF - 1, N_PRE + int(np.ceil(ev["tc"][i] * FPS)))
        fr = np.arange(N_PRE - 4, last + 1)
        steps = []
        for ki, k in enumerate(ks):
            st = dict(k=int(k), t_ms=1000 * t_all[i, ki])
            for c in run.CONFIGS:
                o = inf[c]
                st[c] = dict(p=P[c][ki, i], mu=o["feat"][ki, i, :2], cov=fac[c][ki] ** 2 * o["cf"][ki, i, :2, :2]) if o["seen"][ki, i] else None
            steps.append(st)
        examples.append(dict(label=label, made=bool(ev["made"][i]), corner=bool(ev["corner"][i]), feet=ev["feet"][i], prior=p0[i], tc_ms=1000 * ev["tc"][i],
                             truth=ev["feat"][i, :2], psi=ev["feat"][i, 4], t_ms=1000 * tr["t"][i, fr], path=np.round(tr["P"][i, fr], 3), steps=steps,
                             film=[dict(k=k, t_ms=1000 * tr["t"][i, N_PRE + k - 1], img=jpeg(tk["crops"][0, j, N_PRE + k - 1]),
                                        x=tr["u"][0][i, N_PRE + k - 1] - tr["cu"][0][i, N_PRE + k - 1] + 32, y=tr["v"][0][i, N_PRE + k - 1] - tr["cv"][0][i, N_PRE + k - 1] + 32,
                                        hand=tr["hand"][0][i, N_PRE + k - 1]) for k in CROP_KS]))
    os.makedirs(OUT, exist_ok=True)
    R = rnd(R)
    with open(os.path.join(OUT, "results.json"), "w") as fh:
        json.dump(R, fh, indent=1)
    with open(os.path.join(run.CACHE, "showcase.json"), "w") as fh:
        json.dump(dict(results=R, examples=rnd(examples)), fh)
    fig_earliness(R, os.path.join(OUT, "earliness.png"))
    fig_calls(R, os.path.join(OUT, "calls.png"))
    fig_reliability(R, os.path.join(OUT, "reliability.png"))
    fig_rim(R, rnd(examples[0]), os.path.join(OUT, "rim.png"))
    fig_crops(tk["crops"], tr, base, picked[:3], os.path.join(OUT, "film.png"))

    print(f"test shots {R['meta']['n_test']}, make rate {R['meta']['make_rate_test']:.3f}; rim known exactly: AUC {R['oracle']['auc']:.3f} Brier {R['oracle']['brier']:.4f}")
    print("   ms |  prior  | one camera: AUC  Brier  phys-Brier  misses makes called | two cameras: AUC  Brier  phys-Brier  misses makes called")
    for k in range(K):
        row = f"{R['t_ms'][k]:5.0f} | {R['curves']['prior']['brier'][k]:.4f} |"
        for c in run.CONFIGS:
            row += (f"      {R['curves'][c]['auc'][k]:.3f}  {R['curves'][c]['brier'][k]:.4f}  {R['curves'][c + '_phys']['brier'][k]:.4f}"
                    f"      {100 * R['calls'][c]['misses_caught'][k]:4.0f}% {100 * R['calls'][c]['makes_caught'][k]:4.0f}%        |")
        print(row)
    for c in run.CONFIGS:
        print(c, "first call:", json.dumps(R["lead"][c]))
        print(c, "calls right, by time: miss", R["calls"][c]["miss_right"], "make", R["calls"][c]["make_right"])
        print(c, "reliability gap: as fitted", R["reliability"][c]["phys"]["ece"], "calibrated", R["reliability"][c]["calibrated"]["ece"], "| widening by moment", R["widen"][c])
        r = R["reliability"][c]["calibrated"]
        print("   said", r["said"], "\n   happened", r["happened"])
    for name, row in zip(R["zones"]["names"], R["zones"]["rows"]):
        print(f"{name:45s} n={row['n']:4d} one-camera AUC at each time: {row['one']['auc'][5::3]}")
    print("examples:", [e["label"] for e in examples])


if __name__ == "__main__":
    main()
