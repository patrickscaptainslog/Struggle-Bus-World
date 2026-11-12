"""Is the estimator right, and does it know how right it is? Checked against a detector whose errors
are exactly Gaussian, where the answer is known. Run: python -m tests.test_estimator (from labs/shotcall)."""
import numpy as np
from shotcall.shots import sample_shots, fit_prior, prior_prob
from shotcall.camera import sample_cameras, PAN_JITTER
from shotcall.tracks import film_ideal, inflate
from shotcall.estimator import call_shots, learn_priors
from shotcall.models import RimModel


def main(n=1500, k_list=(2, 4, 8, 15, 30, 54, 72)):
    rng = np.random.default_rng(5)
    train = sample_shots(60000, rng)
    wide = sample_shots(60000, rng, spread=2.5)
    rim = RimModel().fit(np.concatenate([train["feat"], wide["feat"]]), np.concatenate([train["made"], wide["made"]]))
    f, k = train["feat"], train["kappa"]
    ok = ~np.isnan(f[:, 0])
    stats = dict(a0=float(f[ok, 0].mean()), sd_a=float(np.std((f[ok, 0] - f[ok, 0].mean()) / k[ok])), sd_b=float(np.std(f[ok, 1] / k[ok])))
    ev = sample_shots(n, rng)
    p0 = prior_prob(ev, fit_prior(train))
    cams = sample_cameras(ev["feet"], rng)
    tr = film_ideal(ev, cams, rng)
    for c in range(2):                                           # the calibration's own shake is part of the error bar
        tr["la"][c], tr["lb"][c], tr["lc"][c] = inflate(tr["la"][c], tr["lb"][c], tr["lc"][c], 1.0, PAN_JITTER * tr["f"][c])
    hyper = learn_priors(tr, ev, stats, np.ones(n, bool))
    y = ev["made"].astype(float)
    print(f"{n} shots, make rate {y.mean():.3f}; prior Brier {np.mean((p0 - y) ** 2):.4f}; rim model with the arrival known exactly: Brier {np.mean((rim.predict(ev['feat']) - y) ** 2):.4f}")
    worst = 0
    for name, ids in (("one camera", [0]), ("two cameras", [0, 1])):
        o = call_shots(tr, ev, cams, ids, rim, hyper, list(k_list), np.random.default_rng(6), log=lambda *a: None)
        print(name)
        print("  frames   seen   cost/res   sd long  sd wide (cm)   z2 long  z2 wide   Brier    in 0.2-0.8: predicted vs made")
        for ki, kk in enumerate(k_list):
            s = o["seen"][ki]
            e = o["feat"][ki][s, :2] - ev["feat"][s, :2]
            sd = np.sqrt(np.stack([o["cf"][ki][s, 0, 0], o["cf"][ki][s, 1, 1]], 1))
            z2 = np.mean((e / sd) ** 2, 0)                       # 1.0 if the error bars are honest
            p = np.where(s, o["p"][ki], p0)
            mid = (p > 0.2) & (p < 0.8)
            print(f"  {kk:5d}  {s.mean():5.2f}  {np.median(o['chi'][ki][s]):8.2f}  {100*np.median(sd[:,0]):8.1f} {100*np.median(sd[:,1]):8.1f}"
                  f"      {z2[0]:7.2f}  {z2[1]:7.2f}   {np.mean((p - y) ** 2):.4f}    {p[mid].mean():.3f} vs {y[mid].mean():.3f} ({mid.sum()})")
            if kk >= 4:
                worst = max(worst, abs(z2[0] - 1), abs(z2[1] - 1))
    assert worst < 0.35, f"posterior error bars off by {worst:.2f}"
    print("ok")


if __name__ == "__main__":
    main()
