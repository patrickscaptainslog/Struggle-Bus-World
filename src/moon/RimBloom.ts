import { SPROUT, type RoofSprouts, type SproutItem } from '../world/props/sprouts';
import { mix32 } from './craters';
import type { Rec } from './CraterPaint';

// What a painted rim grows, which is what buildings blooming is to the street: the props the roofs grow, laid round a crater instead of on a roof. Level 1 a ring of crystals and flowers. Level 2 a garden, thick with
// them, and trees. Level 3 Hundertwasser on the Moon: golden domes, spires, and rainbow bunting strung the whole way round. All of it hashed from the crater's id, so it's the same garden every time.
//
// Only rims near the bus stand: a garden is a few hundred instances, and it needs a ground that knows the rim to a metre. Everything else about a painted crater is on the paint windows, at any distance.

/** Rims stand this far from the bus (m); they go a little further out. A crater's own size adds to this. */
const NEAR = 1500;
const FAR = 2100;
/** A rim this wide stands on whatever ground there is: most of it is past the tiles whatever the bus does. */
const BIG = 150;
/** Elements standing at once, whatever's been painted. */
const MAX_ITEMS = 5000;

export interface RimDeps {
  sprouts: RoofSprouts;
  /** The ground at a place, and whether it's the ground to the metre or the far field's. */
  groundAt: (x: number, z: number) => number;
  tileAt: (x: number, z: number) => boolean;
}

/** A place on a crater's rim: `ang` round it, `q` of the way out, as the stamp has it. */
function rimPoint(r: Rec, ang: number, q: number, o: { x: number; z: number }) {
  if (r.kind !== 0) {
    let s = 1;
    const w = r.wob;
    if (w) s += w[0] * Math.cos(3 * ang) + w[1] * Math.sin(3 * ang) + w[2] * Math.cos(5 * ang) + w[3] * Math.sin(5 * ang);
    const rr = (r.r * q) / s;
    o.x = r.x + Math.cos(ang - r.turn) * rr;
    o.z = r.z - Math.sin(ang - r.turn) * rr;
    return;
  }
  const th = r.a * Math.PI, sq = 1 + 0.16 * (r.b - 0.5), ct = Math.cos(th), st = Math.sin(th);
  const c = r.c, w = r.r > 14 ? 1 + 0.05 * Math.cos(c * 40) * Math.cos(3 * ang) + 0.05 * Math.sin(c * 40) * Math.sin(3 * ang) + 0.03 * Math.cos(c * 91) * Math.cos(5 * ang) + 0.03 * Math.sin(c * 91) * Math.sin(5 * ang) : 1;
  const u = (Math.cos(ang) * r.r * q * w) / sq, v = Math.sin(ang) * r.r * q * w * sq;
  o.x = r.x + u * ct - v * st;
  o.z = r.z + u * st + v * ct;
}

/** How big a thing grows on this rim: slowly with the crater, or a big one's flowers are houses and a small one's are specks. */
const scaleOf = (r: number) => Math.min(14, Math.max(1, 1.5 * Math.sqrt(r / 22)));

const p = { x: 0, z: 0 };

/** Everything this crater grows, at its level. `at(l)`: when level l landed. */
function lay(r: Rec, groundAt: (x: number, z: number) => number, at: (l: number) => number): SproutItem[] {
  let h = r.key;
  const R = () => (h = mix32(h + 1)) / 4294967296;
  const out: SproutItem[] = [];
  const s = scaleOf(r.r), P = 2 * Math.PI * r.r;
  const stand = (type: number, ang: number, q: number, size: number, tall: number, hue: number, amp: number, start: number, sink = 0.05) => {
    rimPoint(r, ang, q, p);
    const y = groundAt(p.x, p.z) - sink * size;
    out.push({ type, x: p.x, y, z: p.z, rot: R() * 6.283, sx: size, sy: size * tall, sz: size, hue: ((hue % 6) + 6) % 6, amp, start });
  };
  // the ripple round the rim from where it came down: everything waits for the paint to get there
  const when = (ang: number, l: number) => {
    const d = Math.abs(((ang - r.seed + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / Math.PI;
    return at(l) + r.T * (l === 1 ? 0.75 : 0.3 + 0.6 * d) + 0.2 * R();
  };
  // level 1: crystals and flowers, out of the first paint to reach the rim
  const n1 = Math.min(64, Math.max(6, Math.round(P / (6.5 * s))));
  for (let i = 0; i < n1; i++) {
    const ang = ((i + 0.7 * R()) / n1) * Math.PI * 2, q = 0.985 + 0.1 * R();
    if (R() < 0.62) stand(SPROUT.CRYSTAL, ang, q, s * (0.4 + 0.5 * R()), 0.8 + 0.5 * R(), r.hue + Math.floor(R() * 3), 0, when(ang, 1));
    else stand(SPROUT.TUFT, ang, q, s * (0.75 + 0.5 * R()), 0.85 + 0.35 * R(), r.hue + 1 + Math.floor(R() * 4), 0.1, when(ang, 1));
  }
  if (r.level >= 2) {
    const n2 = Math.min(110, Math.max(8, Math.round(P / (4.2 * s))));
    for (let i = 0; i < n2; i++) {
      const ang = ((i + 0.8 * R()) / n2) * Math.PI * 2, q = 0.97 + 0.17 * R(), u = R();
      if (u < 0.3) stand(SPROUT.CRYSTAL, ang, q, s * (0.7 + 0.8 * R()), 0.9 + 0.5 * R(), r.hue + i, 0, when(ang, 2));
      else if (u < 0.62) stand(SPROUT.BUSH, ang, q, s * (0.6 + 0.5 * R()), 0.85 + 0.3 * R(), r.hue + i, 0.13, when(ang, 2));
      else if (u < 0.82) stand(SPROUT.TREE, ang, q, s * (0.6 + 0.45 * R()), 0.9 + 0.25 * R(), r.hue + i, 0.2, when(ang, 2));
      else stand(SPROUT.TUFT, ang, q, s * (1 + 0.5 * R()), 1, r.hue + i, 0.1, when(ang, 2));
    }
  }
  if (r.level >= 3) {
    // the crown of it: domes and spires by turns, the whole way round, with bunting between
    const n3 = Math.min(18, Math.max(6, 2 * Math.round(P / (34 * s) / 2)));
    const spire = s * 0.9, top = 6.9 * spire;
    let x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0;
    for (let i = 0; i <= n3; i++) {
      const ang = (i / n3) * Math.PI * 2 + r.seed, t = when(ang, 3) + 0.15;
      rimPoint(r, ang, 1.02, p);
      const gy = groundAt(p.x, p.z);
      x1 = p.x;
      y1 = gy + top;
      z1 = p.z;
      if (i < n3) {
        if (i % 2 === 0) out.push({ type: SPROUT.DOME, x: p.x, y: gy - 0.2 * s, z: p.z, rot: R() * 6.283, sx: s * 1.15, sy: s * 1.15, sz: s * 1.15, hue: (r.hue + i) % 6, amp: 0.05, start: t });
        out.push({ type: SPROUT.SPIRE, x: p.x + (i % 2 === 0 ? 2.6 * s : 0), y: gy - 0.1 * s, z: p.z, rot: 0, sx: spire, sy: spire, sz: spire, hue: (r.hue + i + 1) % 6, amp: 0.08, start: t });
      }
      if (i > 0) {
        const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz), nf = Math.min(22, Math.max(5, Math.round(len / (1.5 * s)))), sag = 0.06 * len + 0.3 * s;
        for (let k = 0; k < nf; k++) {
          const u = (k + 0.5) / nf;
          out.push({ type: SPROUT.FLAG, x: x0 + dx * u, y: y0 + dy * u - 4 * sag * u * (1 - u), z: z0 + dz * u, rot: 0, sx: len / nf, sy: Math.min(2.2 * s, 1.1 * s + len * 0.02), sz: 1, hue: (r.hue + k) % 6, amp: 0.18, start: t + 0.5 + k * 0.03, dir: [dx, dy - 4 * sag * (1 - 2 * u), dz] });
        }
      }
      x0 = x1;
      y0 = y1;
      z0 = z1;
    }
  }
  return out;
}

interface Standing {
  rec: Rec;
  n: number;
  /** when it went up */
  at: number;
}

export class RimBloom {
  private readonly standing = new Map<number, Standing>();
  private items = 0;
  private timer = 0;
  private now = 0;

  constructor(private readonly d: RimDeps) {}

  /** A rim's garden stands, or stands again at a new level: what it had stands at once. */
  private stand(rec: Rec, now = this.now) {
    const items = lay(rec, this.d.groundAt, (l) => (l >= rec.level ? rec.t0 : -100));
    const old = this.standing.get(rec.order);
    this.items += items.length - (old?.n ?? 0);
    this.d.sprouts.place(rec.order, items);
    this.standing.set(rec.order, { rec, n: items.length, at: now });
  }

  /** A level landed on a rim: it blooms if the bus is near enough to see it, and sync finds it otherwise. */
  hit(rec: Rec, bx: number, bz: number) {
    if (Math.hypot(rec.x - bx, rec.z - bz) - rec.r < NEAR && (rec.r >= BIG || this.d.tileAt(rec.x, rec.z))) this.stand(rec);
    else this.drop(rec.order);
  }

  private drop(k: number) {
    const s = this.standing.get(k);
    if (!s) return;
    this.d.sprouts.unplace(k);
    this.items -= s.n;
    this.standing.delete(k);
  }

  /** Every so often: rims in reach stand, those left behind go. `near` lists the painted craters around the bus. */
  sync(dt: number, now: number, bx: number, bz: number, near: () => Rec[]) {
    this.now = now;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    for (const [k, s] of this.standing) {
      const d = Math.hypot(s.rec.x - bx, s.rec.z - bz) - s.rec.r;
      if (d >= FAR) this.drop(k);
      // (a big rim went up on the far field's ground: as the bus comes along it, it settles on the tiles)
      else if (s.rec.r >= BIG && Math.abs(d) < 700 && now > s.at + 5) this.stand(s.rec, now);
    }
    if (this.items >= MAX_ITEMS) return;
    let added = 0;
    for (const r of near()) {
      if (this.standing.has(r.order) || Math.hypot(r.x - bx, r.z - bz) - r.r > NEAR) continue;
      // (a small rim needs its tile: the far field has the ground to 30 m)
      if (r.r < BIG && !this.d.tileAt(r.x, r.z)) continue;
      this.stand(r, now);
      if (++added >= 3 || this.items >= MAX_ITEMS) break;
    }
  }

  /** QA: elements standing. */
  get count(): number {
    return this.items;
  }
}
