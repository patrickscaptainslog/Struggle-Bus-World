"""The learned piece that sits after the physics: what the rim does with a ball that arrives a
given way."""
import numpy as np
import torch
import torch.nn as nn


def _mlp(i, h, depth):
    layers, d = [], i
    for _ in range(depth):
        layers += [nn.Linear(d, h), nn.SiLU()]
        d = h
    return nn.Sequential(*layers, nn.Linear(d, 1))


def _train(net, X, y, epochs, batch, lr, wd, seed, log=None):
    g = torch.Generator().manual_seed(seed)
    opt = torch.optim.AdamW(net.parameters(), lr, weight_decay=wd)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, lr, total_steps=epochs * ((len(X) + batch - 1) // batch), pct_start=0.1)
    for ep in range(epochs):
        tot = 0.0
        for idx in torch.randperm(len(X), generator=g).split(batch):
            loss = nn.functional.binary_cross_entropy_with_logits(net(X[idx])[:, 0], y[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item() * len(idx)
        if log and (ep % 5 == 0 or ep == epochs - 1):
            log(f"  epoch {ep:3d}  loss {tot / len(X):.4f}")


class RimModel:
    """P(make | how the ball arrives): an MLP on the seven numbers of the virtual crossing.
    The court is mirror-symmetric, so every arrival is first flipped to come from the same side."""

    def __init__(self):
        torch.manual_seed(0)
        self.net = _mlp(7, 192, 3)
        self.mu, self.sd = np.zeros(7), np.ones(7)

    @staticmethod
    def canon(f):
        f = np.array(f, dtype=float)
        flip = f[:, 4] < 0
        f[flip, 1], f[flip, 4], f[flip, 6] = -f[flip, 1], -f[flip, 4], -f[flip, 6]
        return f

    def _x(self, f):
        return torch.as_tensor((self.canon(f) - self.mu) / self.sd, dtype=torch.float32)

    def fit(self, feat, made, log=None):
        ok = ~np.isnan(feat[:, 0])
        c = self.canon(feat[ok])
        self.mu, self.sd = c.mean(0), c.std(0) * np.array([0.5, 0.5, 1, 1, 1, 1, 1])     # finer on the two that matter most
        _train(self.net, self._x(feat[ok]), torch.as_tensor(made[ok], dtype=torch.float32), 30, 2048, 2e-3, 1e-5, 0, log)
        return self

    @torch.no_grad()
    def predict(self, feat):
        ok = ~np.isnan(feat[:, 0]) & (np.abs(feat[:, 0]) < 1.5) & (np.abs(feat[:, 1]) < 1.0)
        p = np.zeros(len(feat))
        for a in range(0, len(feat), 1 << 18):
            sl = slice(a, a + (1 << 18))
            if ok[sl].any():
                p[sl][ok[sl]] = torch.sigmoid(self.net(self._x(feat[sl][ok[sl]]))[:, 0]).numpy()
        return p

    def state(self):
        return dict(net=self.net.state_dict(), mu=self.mu, sd=self.sd)

    def load(self, st):
        self.net.load_state_dict(st["net"])
        self.mu, self.sd = st["mu"], st["sd"]
        return self
