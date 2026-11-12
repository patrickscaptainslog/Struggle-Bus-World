"""The ball detector: a small CNN that reads one crop and says where the ball's centre is to a
fraction of a pixel, how big it is, how sure it is of both, and whether a hand still has it."""
import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from .render import render, random_params


def _cb(i, o, k, s):
    return nn.Sequential(nn.Conv2d(i, o, k, s, k // 2, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class BallNet(nn.Module):
    """Encoder to 1/16, one step back up to a 16x16 heatmap whose soft-argmax is the centre, so the
    answer moves smoothly with the ball. A small head adds the size and the uncertainty (a full 2x2
    precision matrix, because blur makes the error longer along the motion). Whether a hand still
    has the ball is read by a branch of its own: sharing layers with the centre does not work, the
    centre's gradients are some thirty times larger and take the shared features for themselves."""

    def __init__(self):
        super().__init__()
        self.c1, self.c2, self.c3 = _cb(3, 12, 5, 2), _cb(12, 24, 3, 2), _cb(24, 24, 3, 1)
        self.c4, self.c5, self.c6 = _cb(24, 40, 3, 2), _cb(40, 40, 3, 1), _cb(40, 40, 3, 1)
        self.m1, self.m2 = _cb(64, 24, 1, 1), _cb(24, 24, 3, 1)
        self.hm = nn.Conv2d(24, 1, 1)
        self.head = nn.Sequential(nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 7))
        self.hand = nn.Sequential(_cb(3, 12, 5, 2), _cb(12, 24, 3, 2), _cb(24, 32, 3, 2), _cb(32, 32, 3, 1))
        self.hand_out = nn.Sequential(nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 1))
        g = torch.arange(16).float() * 4 - 31.5
        self.register_buffer("gx", g.repeat(16))
        self.register_buffer("gy", g.repeat_interleave(16))

    def forward(self, x):
        x = (x - 0.4) / 0.25
        f3 = self.c3(self.c2(self.c1(x)))
        f6 = self.c6(self.c5(self.c4(f3)))
        m = self.m2(self.m1(torch.cat([F.interpolate(f6, scale_factor=2, mode="bilinear", align_corners=False), f3], 1)))
        pr = torch.softmax(self.hm(m).flatten(1), 1)
        o = self.head(torch.cat([(m.flatten(2) * pr[:, None]).sum(2), f6.mean((2, 3))], 1))
        g = self.hand(x)
        return dict(cx=(pr * self.gx).sum(1) + o[:, 0], cy=(pr * self.gy).sum(1) + o[:, 1], logr=math.log(15) + o[:, 2],
                    la=o[:, 3].clamp(-3, 4), lb=o[:, 4], lc=o[:, 5].clamp(-3, 4), ls=o[:, 6].clamp(-3, 3) - 3,
                    hand=self.hand_out(torch.cat([g.amax((2, 3)), g.mean((2, 3))], 1))[:, 0])


NU = 4.0        # the detector's errors have heavy tails (a hand, an arm across the ball): Student-t, not Gaussian


def loss_fn(o, p, w_nll):
    """Huber on the centre and the size, cross-entropy on the hand, and a Student-t likelihood for
    the error bars. The error bars learn from the errors but do not steer them (detached), and the
    t keeps one bad crop from swamping a batch: with a Gaussian here the gradient of a single
    occluded ball is hundreds of times everything else, clipping scales the whole step down to
    make room for it, and the hand never gets learned."""
    ex, ey, er = o["cx"] - p["cx"], o["cy"] - p["cy"], o["logr"] - torch.log(p["r"])
    dx, dy, dr = ex.detach(), ey.detach(), er.detach()
    w1, w2 = torch.exp(o["la"]) * dx + o["lb"] * dy, torch.exp(o["lc"]) * dy
    nll = (0.5 * (NU + 2) * torch.log1p((w1 * w1 + w2 * w2) / NU) - o["la"] - o["lc"]
           + 0.5 * (NU + 1) * torch.log1p((dr / torch.exp(o["ls"])) ** 2 / NU) + o["ls"])
    z = torch.zeros_like(ex)
    return (w_nll * nll.mean() + 3 * F.smooth_l1_loss(ex, z, beta=0.3) + 3 * F.smooth_l1_loss(ey, z, beta=0.3)
            + 30 * F.smooth_l1_loss(er, z, beta=0.05) + 3 * F.binary_cross_entropy_with_logits(o["hand"], p["in_hand"]))


def train(bank, steps=1500, batch=256, seed=0, log=print):
    """Fresh crops every step, so there is nothing to memorise."""
    torch.manual_seed(seed)
    gen = torch.Generator().manual_seed(seed)
    net = BallNet()
    opt = torch.optim.AdamW(net.parameters(), 3e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=steps, pct_start=0.1)
    for i in range(steps):
        p = random_params(batch, gen, len(bank))
        loss = loss_fn(net(render(p, bank, gen=gen)), p, min(1.0, i / 200))
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_([q for k, q in net.named_parameters() if not k.startswith("hand")], 10.0)
        nn.utils.clip_grad_norm_([q for k, q in net.named_parameters() if k.startswith("hand")], 10.0)
        opt.step()
        sched.step()
        if i % 100 == 0 or i == steps - 1:
            log(f"  detector step {i:5d}  loss {loss.item():.3f}")
    return net.eval()


@torch.no_grad()
def predict(net, x):
    """Crop tensors in, numpy dict out: centre (px from the crop centre), log radius, the precision
    Cholesky factor (la, lb, lc), the sd of log radius, and P(in hand)."""
    o = net(x)
    return dict(cx=o["cx"].numpy(), cy=o["cy"].numpy(), logr=o["logr"].numpy(), la=torch.exp(o["la"]).numpy(), lb=o["lb"].numpy(),
                lc=torch.exp(o["lc"]).numpy(), sr=torch.exp(o["ls"]).numpy(), hand=torch.sigmoid(o["hand"]).numpy())


def validate(net, bank, n=8192, seed=123):
    """Errors on crops it has never seen, and whether its own error bars are honest."""
    import numpy as np
    gen = torch.Generator().manual_seed(seed)
    out = {}
    p = random_params(n, gen, len(bank))
    o = predict(net, render(p, bank, gen=gen))
    ex, ey = o["cx"] - p["cx"].numpy(), o["cy"] - p["cy"].numpy()
    er = o["logr"] - np.log(p["r"].numpy())
    chi = (o["la"] * ex + o["lb"] * ey) ** 2 + (o["lc"] * ey) ** 2
    free = (p["hand_on"].numpy() == 0) & (p["occ_on"].numpy() == 0)
    hand = p["in_hand"].numpy() > 0.5
    err = np.hypot(ex, ey)
    out.update(rms_px=float(np.sqrt(np.mean(err**2))), median_px=float(np.median(err)), rms_px_clear=float(np.sqrt(np.mean(err[free] ** 2))),
               median_px_clear=float(np.median(err[free])), p95_px_clear=float(np.quantile(err[free], 0.95)),
               rms_px_in_hand=float(np.sqrt(np.mean(err[hand] ** 2))), rms_px_occluded=float(np.sqrt(np.mean(err[p["occ_on"].numpy() > 0] ** 2))),
               size_err_pct_clear=float(100 * np.sqrt(np.mean(er[free] ** 2))), chi2_per_dof=float(np.mean(chi) / 2),
               chi2_per_dof_clear=float(np.mean(chi[free]) / 2), size_chi2=float(np.mean((er / o["sr"]) ** 2)),
               hand_acc=float(np.mean((o["hand"] > 0.5) == hand)), hand_base_rate=float(max(hand.mean(), 1 - hand.mean())),
               hand_acc_clear_gap=float(np.mean(((o["hand"] > 0.5) == hand)[hand | (p["hand_on"].numpy() == 0) | (p["gap"].numpy() > 3)])),
               hand_p_held=float(o["hand"][hand].mean()), hand_p_let_go=float(o["hand"][~hand & (p["hand_on"].numpy() > 0)].mean()),
               hand_p_no_hand=float(o["hand"][p["hand_on"].numpy() == 0].mean()), n=n)
    return out
