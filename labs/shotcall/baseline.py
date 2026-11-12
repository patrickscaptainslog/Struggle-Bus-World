"""Why not just train a network on the tracks? An end-to-end baseline.

A GRU reads what the estimator reads from the main camera, already turned into angles with the
camera's calibration (where the ball is relative to the rim, how fast that changes, how big it
looks), plus who is shooting from where, and is trained to say make or miss at every frame. It is
told the release frame exactly, which the estimator is not. Both are scored on the same held-out
shots, filmed by a detector whose errors are exactly Gaussian (shotcall.tracks.film_ideal), so
neither is helped or hurt by pictures.

    python baseline.py        # about ten minutes; writes results/baseline.json
"""
import json
import os
import time
import numpy as np
import torch
import torch.nn as nn
from shotcall.court import RIM_Z, BALL_R
from shotcall.shots import sample_shots, fit_prior, prior_prob
from shotcall.camera import sample_cameras, axes, PAN_JITTER, W, H
from shotcall.tracks import film_ideal, inflate, N_PRE
from shotcall.estimator import call_shots, learn_priors
from shotcall.models import RimModel
from report import auc, brier

N_TRAIN, N_TEST, EPOCHS = (4000, 400, 2) if os.environ.get("SHOTCALL_SMALL") else (60000, 2000, 10)
K_LIST = [2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 24, 30, 36, 45, 54, 63, 72]


def features(tr, cam, shots, p0):
    """Per frame after the release: the ball's direction from the camera relative to the rim's
    (milliradians), its change since the last frame, its apparent size against a ball at the rim,
    whether the frame is usable, and the time; then the shooter's spot, skill and prior."""
    pan, tilt, f = tr["pan"][0], tr["tilt"][0], tr["f"][0]
    fwd, right, up = axes(pan, tilt)
    ray = fwd + ((tr["u"][0] - W / 2) / f)[..., None] * right - ((tr["v"][0] - H / 2) / f)[..., None] * up
    hoop = np.array([0, 0, RIM_Z]) - cam["pos"]
    az = np.arctan2(ray[..., 1], ray[..., 0]) - np.arctan2(hoop[1], hoop[0])
    el = np.arctan2(ray[..., 2], np.hypot(ray[..., 0], ray[..., 1])) - np.arctan2(hoop[2], np.hypot(hoop[0], hoop[1]))
    size = tr["logr"][0] - np.log(f * BALL_R / np.linalg.norm(hoop))
    ok = tr["ok"][0].astype(float)
    back = lambda a: np.diff(a, axis=1, prepend=a[:, :1])          # change since the last frame: nothing from the future
    x = np.stack([az * 100, el * 100, back(az) * 1000, back(el) * 1000, size * 10, ok], -1)[:, N_PRE:]
    x = x * ok[:, N_PRE:, None]
    n, F = x.shape[:2]
    stat = np.stack([shots["feet"][:, 0] / 5, shots["feet"][:, 1] / 5, np.log(shots["kappa"]) * 3, np.log(p0 / (1 - p0))], 1)
    tt = np.broadcast_to(np.arange(F)[None, :, None] / 60.0, (n, F, 1))
    return torch.as_tensor(np.concatenate([x, tt, np.broadcast_to(stat[:, None], (n, F, 4))], -1), dtype=torch.float32), \
        torch.as_tensor(ok[:, N_PRE:], dtype=torch.float32)


class Net(nn.Module):
    def __init__(self, d, h=128):
        super().__init__()
        self.inp = nn.Sequential(nn.Linear(d, h), nn.SiLU())
        self.gru = nn.GRU(h, h, num_layers=2, batch_first=True)
        self.out = nn.Linear(h, 1)

    def forward(self, x):
        return self.out(self.gru(self.inp(x))[0])[..., 0]


def main():
    t0 = time.time()
    rng = np.random.default_rng(21)
    torch.manual_seed(21)
    shots = sample_shots(N_TRAIN + N_TEST, rng)
    te = np.arange(N_TRAIN + N_TEST) >= N_TRAIN
    cut = lambda d, m: {k: v[m] for k, v in d.items()}
    p0 = prior_prob(shots, fit_prior(cut(shots, ~te)))
    cams = sample_cameras(shots["feet"], rng)
    tr = film_ideal(shots, cams, rng)
    for c in range(2):
        tr["la"][c], tr["lb"][c], tr["lc"][c] = inflate(tr["la"][c], tr["lb"][c], tr["lc"][c], 1.0, PAN_JITTER * tr["f"][c])
    y = shots["made"].astype(float)
    X, M = features(tr, cams[0], shots, p0)
    Y = torch.as_tensor(y, dtype=torch.float32)
    print(f"[{time.time() - t0:5.0f}s] {N_TRAIN} training shots, {N_TEST} test shots, make rate {y.mean():.3f}", flush=True)

    net = Net(X.shape[-1])
    opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
    idx = torch.as_tensor(np.nonzero(~te)[0])
    steps = EPOCHS * ((len(idx) + 255) // 256)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 2e-3, total_steps=steps, pct_start=0.1)
    g = torch.Generator().manual_seed(0)
    for ep in range(EPOCHS):
        tot = 0.0
        for b in idx[torch.randperm(len(idx), generator=g)].split(256):
            loss = (nn.functional.binary_cross_entropy_with_logits(net(X[b]), Y[b, None].expand(-1, X.shape[1]), reduction="none") * M[b]).sum() / M[b].sum()
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
            sched.step()
            tot += loss.item() * len(b)
        print(f"[{time.time() - t0:5.0f}s] epoch {ep}  loss {tot / len(idx):.4f}", flush=True)
    with torch.no_grad():
        pg = torch.sigmoid(net.eval()(X[torch.as_tensor(np.nonzero(te)[0])])).numpy()

    train = cut(shots, ~te)
    wide = sample_shots(N_TRAIN, rng, spread=2.5)
    rim = RimModel().fit(np.concatenate([train["feat"], wide["feat"]]), np.concatenate([train["made"], wide["made"]]))
    f, k = train["feat"], train["kappa"]
    okf = ~np.isnan(f[:, 0])
    stats = dict(a0=float(f[okf, 0].mean()), sd_a=float(np.std((f[okf, 0] - f[okf, 0].mean()) / k[okf])), sd_b=float(np.std(f[okf, 1] / k[okf])))
    trt = {q: (v[:, te] if v.ndim == 3 and v.shape[0] == 2 else v[te]) for q, v in tr.items()}
    ev = cut(shots, te)
    cams_t = [dict(c, look=c["look"][te], drift=c["drift"][te], f0=c["f0"][te], zoom=c["zoom"][te], bias=c["bias"][te]) for c in cams]
    o = call_shots(trt, ev, cams_t, [0], rim, learn_priors(tr, shots, stats, ~te), K_LIST, np.random.default_rng(22), log=lambda *a: None)
    yt, pt = y[te], p0[te]
    out = dict(n_train=N_TRAIN, n_test=N_TEST, k_list=K_LIST, t_ms=[], prior=dict(auc=auc(yt, pt), brier=brier(yt, pt)), gru=dict(auc=[], brier=[]), physics=dict(auc=[], brier=[]))
    print("    ms    GRU: AUC  Brier    physics: AUC  Brier")
    for ki, kk in enumerate(K_LIST):
        last = np.minimum(kk - 1, np.maximum(M[torch.as_tensor(np.nonzero(te)[0])].numpy().sum(1).astype(int) - 1, 0))     # a track that has ended keeps its last word
        g_ = pg[np.arange(te.sum()), last]
        ph = np.where(o["seen"][ki], o["p"][ki], pt)
        out["t_ms"].append(float(1000 * trt["t"][:, N_PRE + kk - 1].mean()))
        for name, p in (("gru", g_), ("physics", ph)):
            out[name]["auc"].append(auc(yt, p))
            out[name]["brier"].append(brier(yt, p))
        print(f"  {out['t_ms'][-1]:5.0f}       {out['gru']['auc'][-1]:.3f}  {out['gru']['brier'][-1]:.4f}          {out['physics']['auc'][-1]:.3f}  {out['physics']['brier'][-1]:.4f}", flush=True)
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "baseline.json")
    if not os.environ.get("SHOTCALL_SMALL"):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump(json.loads(json.dumps(out), parse_float=lambda s: round(float(s), 4)), fh, indent=1)
    print(f"[{time.time() - t0:5.0f}s] done")


if __name__ == "__main__":
    main()
