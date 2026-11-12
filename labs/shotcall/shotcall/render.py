"""What the camera sees of the ball: a 64 px crop with shading, seams, motion blur, a hand, a crowd.

Everything a real broadcast frame does to a ball's outline is put in here on purpose, because the
detector is only as honest as the pictures it learns from.
"""
import math
import torch
import torch.nn.functional as F

S = 64
_c = torch.arange(S).float() - (S - 1) / 2
YY, XX = (g[None] for g in torch.meshgrid(_c, _c, indexing="ij"))


def make_bank(n=24, h=512, w=1024, seed=0):
    """Backgrounds: blotchy stands, heads and shirts, bright signs, and on some a pale floor with lines."""
    g = torch.Generator().manual_seed(seed)
    rnd = lambda *s: torch.rand(*s, generator=g)
    out = []
    for _ in range(n):
        img = (0.10 + 0.25 * rnd(1)) * (1 + 0.15 * torch.randn(3, 1, 1, generator=g)) * torch.ones(3, h, w)
        for sc, amp in ((96, .10), (32, .10), (12, .14), (5, .10)):
            f = 0.8 * torch.randn(1, 1, h // sc + 2, w // sc + 2, generator=g) + 0.45 * torch.randn(1, 3, h // sc + 2, w // sc + 2, generator=g)
            img += amp * F.interpolate(f, size=(h, w), mode="bicubic", align_corners=False)[0]
        fld = F.interpolate(torch.randn(1, 1, h // 10 + 2, w // 10 + 2, generator=g), size=(h, w), mode="bicubic")[0, 0]
        col = F.interpolate(rnd(1, 3, h // 10 + 2, w // 10 + 2), size=(h, w), mode="nearest")[0]
        blob = torch.sigmoid((fld - 0.7) * 8)
        img = img * (1 - blob) + blob * col * (0.35 + 0.6 * rnd(1))
        for _ in range(int(torch.randint(2, 7, (1,), generator=g))):
            x0, y0 = int(rnd(1) * (w - 200)), int(rnd(1) * (h - 60))
            ww, hh = int(60 + 140 * rnd(1)), int(14 + 36 * rnd(1))
            c = rnd(3)
            c = c / c.max() * (0.5 + 0.5 * rnd(1))
            stripes = (torch.sin(torch.arange(ww) * rnd(1) * 0.8) > 0).float() * 0.5 + 0.5
            img[:, y0:y0 + hh, x0:x0 + ww] = c[:, None, None] * stripes[None, None, :]
        if rnd(1) < 0.5:
            y1 = int(h * (0.55 + 0.3 * rnd(1)))
            img[:, y1:] = torch.tensor([0.78, 0.62, 0.42])[:, None, None] * (0.8 + 0.3 * rnd(1)) + 0.5 * (img[:, y1:] - img[:, y1:].mean())
            for _ in range(3):
                y2 = y1 + int(rnd(1) * (h - y1 - 6))
                img[:, y2:y2 + int(3 + 3 * rnd(1))] = 0.92
        out.append(img.clamp(0, 1))
    return (torch.stack(out) * 255).round().to(torch.uint8)


def _capsule(ax, ay, bx, by, rad):
    dx, dy = bx - ax, by - ay
    t = (((XX - ax) * dx + (YY - ay) * dy) / (dx * dx + dy * dy + 1e-6)).clamp(0, 1)
    return ((rad - torch.sqrt((XX - ax - t * dx) ** 2 + (YY - ay - t * dy) ** 2)) / 1.2 + 0.5).clamp(0, 1)


def render(p, bank, K=5, gen=None):
    """p: dict of per-crop tensors (see random_params). Returns (B,3,S,S) in [0,1]."""
    B = p["cx"].shape[0]
    v = lambda k: p[k].view(B, 1, 1)
    r = v("r")
    num, den, hand = torch.zeros(B, 3, S, S), torch.zeros(B, S, S), torch.zeros(B, S, S)
    lx, ly, lz = (p["light"][:, i].view(B, 1, 1) for i in range(3))
    for k in range(K):                                   # the shutter is open: K instants of it
        s = (k + 0.5) / K - 0.5
        xi, eta = (XX - v("cx") - s * v("bx")) / r, (YY - v("cy") - s * v("by")) / r
        rr = xi * xi + eta * eta
        cov = ((1 - torch.sqrt(rr)) * r / 1.2 + 0.5).clamp(0, 1)
        zeta = torch.sqrt((1 - rr).clamp(min=0))
        shade = v("amb") + v("dif") * (xi * lx + eta * ly + zeta * lz).clamp(min=0)
        no = torch.einsum("bji,bjhw->bihw", p["R"], torch.stack([xi, eta, zeta], 1)).abs()
        seam = torch.minimum(torch.minimum(no[:, 0], no[:, 1]), (no[:, 2] - 0.55).abs())
        num += (cov * shade * (1 - 0.65 * torch.exp(-(seam / v("seam")) ** 2)))[:, None] * p["ball"][:, :, None, None]
        den += cov
        hx, hy = v("cx") + s * v("hb") * v("bx"), v("cy") + s * v("hb") * v("by")
        px, py = hx + v("hdx") * (1.22 * r + v("gap")), hy + v("hdy") * (1.22 * r + v("gap"))     # the palm
        palm = _capsule(px - v("hdy") * 0.5 * r, py + v("hdx") * 0.5 * r, px + v("hdy") * 0.5 * r, py - v("hdx") * 0.5 * r, 0.22 * r)
        hand += torch.maximum(palm, _capsule(px, py, px + v("adx") * 3 * r, py + v("ady") * 3 * r, 0.26 * r))
    alpha, hand = (den / K)[:, None], (hand / K * v("hand_on"))[:, None]
    ar = torch.arange(S)
    rows, cols = (p["oy"][:, None] + ar) % bank.shape[2], (p["ox"][:, None] + ar) % bank.shape[3]
    bg = bank[p["bg"][:, None, None], :, rows[:, :, None], cols[:, None, :]].permute(0, 3, 1, 2).float() / 255
    bg = (bg * p["gain"][:, :, None, None]).clamp(0, 1)
    skin = p["skin"][:, :, None, None]
    behind = (bg * (1 - hand) + skin * hand) * (1 - alpha) + num / K
    front = (bg * (1 - alpha) + num / K) * (1 - hand) + skin * hand
    img = torch.where(p["front"].view(B, 1, 1, 1) > 0.5, front, behind)
    occ = (_capsule(v("occx") - v("ocdx") * 2 * r, v("occy") - v("ocdy") * 2 * r, v("occx") + v("ocdx") * 2 * r,
                    v("occy") + v("ocdy") * 2 * r, v("ocw") * r) * v("occ_on"))[:, None]
    img = img * (1 - occ) + p["occ_rgb"][:, :, None, None] * occ
    x = torch.arange(-2, 3).float()[None]
    kern = torch.exp(-x * x / (2 * p["psf"][:, None] ** 2))
    kern = (kern / kern.sum(1, keepdim=True)).repeat_interleave(3, 0)[:, None]             # (3B,1,5)
    img = F.pad(img.reshape(1, 3 * B, S, S), (2, 2, 2, 2), mode="replicate")
    img = F.conv2d(F.conv2d(img, kern[:, :, None, :], groups=3 * B), kern[:, :, :, None], groups=3 * B).reshape(B, 3, S, S)
    img = img + p["noise"].view(B, 1, 1, 1) * torch.randn(B, 3, S, S, generator=gen)
    y = 0.299 * img[:, 0] + 0.587 * img[:, 1] + 0.114 * img[:, 2]                        # 4:2:0, as broadcast is
    ch = torch.stack([img[:, 2] - y, img[:, 0] - y], 1)
    ch = F.interpolate(F.avg_pool2d(ch, 2), scale_factor=2, mode="nearest")
    rd, bl = y + ch[:, 1], y + ch[:, 0]
    return torch.stack([rd, (y - 0.299 * rd - 0.114 * bl) / 0.587, bl], 1).clamp(0, 1)


def look_params(n, gen):
    """The parts of a crop that belong to the shot, not the frame: light, ball colour, skin, PSF, noise."""
    rnd = lambda *s: torch.rand(*s, generator=gen)
    light = torch.stack([0.35 * torch.randn(n, generator=gen), -torch.ones(n), 0.3 + 0.6 * rnd(n)], 1)
    tone = 0.25 + 0.6 * rnd(n, 1)
    return dict(light=light / light.norm(dim=1, keepdim=True), amb=0.45 + 0.2 * rnd(n), dif=0.5 + 0.25 * rnd(n),
                ball=torch.tensor([0.80, 0.38, 0.14]) * (0.75 + 0.35 * rnd(n, 1)) * (1 + 0.08 * torch.randn(n, 3, generator=gen)),
                seam=0.05 + 0.04 * rnd(n), skin=tone * torch.tensor([1.0, 0.78, 0.62]) * (1 + 0.05 * torch.randn(n, 3, generator=gen)),
                psf=0.5 + 0.5 * rnd(n), noise=0.006 + 0.014 * rnd(n), gain=0.6 + 0.9 * rnd(n, 1) * torch.ones(n, 3),
                front=(rnd(n) < 0.5).float(), bg=torch.randint(0, 1 << 30, (n,), generator=gen))


def random_rotations(n, gen):
    q = torch.randn(n, 4, generator=gen)
    w, x, y, z = (q / q.norm(dim=1, keepdim=True)).unbind(1)
    return torch.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
                        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
                        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], 1).view(n, 3, 3)


def occluder_params(n, r, prob, gen):
    rnd = lambda *s: torch.rand(*s, generator=gen)
    a, b = 2 * math.pi * rnd(n), 2 * math.pi * rnd(n)
    off = (0.5 + 0.8 * rnd(n)) * r
    return dict(occ_on=(rnd(n) < prob).float(), occx=off * torch.cos(a), occy=off * torch.sin(a), ocdx=torch.cos(b),
                ocdy=torch.sin(b), ocw=0.2 + 0.25 * rnd(n), occ_rgb=rnd(n, 3) * (0.3 + 0.7 * rnd(n, 1)))


def random_params(n, gen, n_bank):
    """Independent crops for teaching the detector: every size, blur, hand and background the shots can show."""
    rnd = lambda *s: torch.rand(*s, generator=gen)
    p = look_params(n, gen)
    r = 8 + 18 * rnd(n)
    ang = 2 * math.pi * rnd(n)
    blur = 0.6 * r * rnd(n) ** 1.5
    state = rnd(n)                                     # <0.3 in the hand, <0.55 just let go, else long gone
    t = 0.085 * rnd(n)
    gap = torch.where(state < 0.3, (-0.12 + 0.14 * rnd(n)) * r, 45 * t * t * r / 0.11925)
    hang = ang + math.pi + 0.5 * torch.randn(n, generator=gen)
    aang = hang + 0.6 * torch.randn(n, generator=gen)
    p.update(cx=(2.5 * torch.randn(n, generator=gen)).clamp(-7, 7), cy=(2.5 * torch.randn(n, generator=gen)).clamp(-7, 7),
             r=r, bx=blur * torch.cos(ang), by=blur * torch.sin(ang), R=random_rotations(n, gen),
             hand_on=(state < 0.55).float(), in_hand=(state < 0.3).float(), gap=gap, hb=torch.where(state < 0.3, 1.0, 0.5 * rnd(n)),
             hdx=torch.cos(hang), hdy=torch.sin(hang), adx=torch.cos(aang), ady=torch.sin(aang),
             bg=p["bg"] % n_bank, ox=torch.randint(0, 1 << 20, (n,), generator=gen), oy=torch.randint(0, 1 << 20, (n,), generator=gen),
             **occluder_params(n, r, 0.06, gen))
    return p
