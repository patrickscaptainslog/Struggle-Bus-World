// The invented craters: the buildings of the Moon. Nothing is stored: a crater is a hash of where it is, so it is the same crater from any map, on any device, for ever.
//
// Each octave L has its own cubic grid through the whole Moon, in Moon-fixed metres. A cell holds one candidate at a hashed point, and a candidate counts when it lies within half a cell of the 1737.4 km
// sphere; it is then pushed out to the sphere. That is a plain Poisson process in a shell, so the density is the same everywhere: no seams, no faces, no pole, no sense of which way the grid runs. The cell's
// integers are the crater's id, and that is how a crater is found again (cratersNear below, what paint will ask).
//
// Diameters halve from octave to octave and the cells with them, so the count goes up four times an octave: N(>D) as D^-2, the slope of a surface saturated with craters. Maria take a third of what highlands do.

import { R_M, dirOf, latOf, linearAt, lonOf, mapOf, type MapFrame, type WholeMap } from './map';

/** Octaves: the largest diameter in each (m) is DMAX / 2^L. */
export const DMAX = 5000;
export const OCTAVES = 9;
/** A cell is this many of its octave's largest diameters across. */
const CELL_D = 1.5;
/** Most of the craters a cell can hold is one: this is the chance of it, on highlands by octave, and what a mare keeps of that. The big ones are rare: saturation is a small crater's state. */
const P_HIGH = [0.1, 0.13, 0.18, 0.27, 0.4, 0.55, 0.62, 0.62, 0.62, 0.62];
const P_MARE = 0.3;
/** The largest stamp reaches this many radii from the centre (its light ejecta). */
export const REACH = 3;

export const octaveD = (L: number) => DMAX / 2 ** L;
const octaveCell = (L: number) => CELL_D * octaveD(L);

/** The Moon's dark plains in the albedo map, 0..1: this much dark starts to count, and by this much it is all mare. */
const ALB_MARE_HI = 0.38;
const ALB_MARE_LO = 0.25;
export const mareOf = (alb: number) => {
  const t = Math.min(1, Math.max(0, (ALB_MARE_HI - alb) / (ALB_MARE_HI - ALB_MARE_LO)));
  return t * t * (3 - 2 * t);
};

/** Fresh and sharp, with bright ejecta; plain; old; a ghost, nearly filled in. */
export const enum Age {
  Fresh = 0,
  Plain = 1,
  Old = 2,
  Ghost = 3,
}

export function mix32(a: number): number {
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
  a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
  return (a ^ (a >>> 16)) >>> 0;
}

/** A crater, reused from call to call: copy what you keep. */
export interface Crater {
  /** its octave and its cell: the id */
  L: number;
  i: number;
  j: number;
  k: number;
  /** on the sphere, unit, Moon fixed */
  dx: number;
  dy: number;
  dz: number;
  /** on this map (m) */
  x: number;
  z: number;
  /** radius at the rim (m) */
  r: number;
  age: Age;
  /** 0..1, stable: what a stamp makes of it (its squash, its wobble) */
  a: number;
  b: number;
  c: number;
}

export const craterId = (c: Pick<Crater, 'L' | 'i' | 'j' | 'k'>) => `${c.L}.${c.i}.${c.j}.${c.k}`;

const tmpD = new Float64Array(3);
const tmpM = new Float64Array(2);
const corners = new Float64Array(3);

/**
 * Calls `fn` for every crater of octave L that may touch the box (map metres): the box is grown by what the octave's stamps can reach. A crater's fields hold until the next call. No allocation.
 * The sphere is walked like a height field over its largest axis there: two axes in cells, and on the third only the few cells near the sphere.
 */
export function eachCrater(f: MapFrame, alb: WholeMap, seed: number, L: number, x0: number, z0: number, x1: number, z1: number, fn: (c: Crater) => void): void {
  const cell = octaveCell(L);
  const reach = (REACH * octaveD(L)) / 2;
  const mx0 = x0 - reach, mz0 = z0 - reach, mx1 = x1 + reach, mz1 = z1 + reach;
  let lo0 = Infinity, lo1 = Infinity, lo2 = Infinity, hi0 = -Infinity, hi1 = -Infinity, hi2 = -Infinity;
  for (let k = 0; k < 9; k++) {
    const x = mx0 + ((mx1 - mx0) * (k % 3)) / 2, z = mz0 + ((mz1 - mz0) * ((k / 3) | 0)) / 2;
    dirOf(f, x, z, corners);
    const a = corners[0] * R_M, b = corners[1] * R_M, c = corners[2] * R_M;
    if (a < lo0) lo0 = a;
    if (a > hi0) hi0 = a;
    if (b < lo1) lo1 = b;
    if (b > hi1) hi1 = b;
    if (c < lo2) lo2 = c;
    if (c > hi2) hi2 = c;
  }
  dirOf(f, (mx0 + mx1) / 2, (mz0 + mz1) / 2, corners);
  const ax = Math.abs(corners[0]), ay = Math.abs(corners[1]), az = Math.abs(corners[2]);
  // (w is the largest axis there, a and b the other two)
  const w = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const pa = w === 0 ? 1 : 0, pb = w === 2 ? 1 : 2;
  const sign = corners[w] > 0 ? 1 : -1;
  const lo = [lo0, lo1, lo2], hi = [hi0, hi1, hi2];
  const a0 = Math.floor(lo[pa] / cell) - 1, a1 = Math.floor(hi[pa] / cell) + 1, b0 = Math.floor(lo[pb] / cell) - 1, b1 = Math.floor(hi[pb] / cell) + 1;
  const R2 = R_M * R_M;
  const c: Crater = { L, i: 0, j: 0, k: 0, dx: 0, dy: 0, dz: 0, x: 0, z: 0, r: 0, age: Age.Plain, a: 0, b: 0, c: 0 };
  const ids = [0, 0, 0];
  for (let ia = a0; ia <= a1; ia++)
    for (let ib = b0; ib <= b1; ib++) {
      const ca = (ia + 0.5) * cell, cb = (ib + 0.5) * cell, q = R2 - ca * ca - cb * cb;
      if (q <= 0) continue;
      const mid = Math.floor((sign * Math.sqrt(q)) / cell);
      for (let iw = mid - 3; iw <= mid + 3; iw++) {
        ids[pa] = ia;
        ids[pb] = ib;
        ids[w] = iw;
        if (roll(f, alb, seed, L, ids[0], ids[1], ids[2], mx0, mz0, mx1, mz1, c)) fn(c);
      }
    }
}

/** One cell of octave L: does it hold a crater, and is it in the box? The one place a crater is made: fills c. */
function roll(f: MapFrame, alb: WholeMap, seed: number, L: number, i: number, j: number, k: number, mx0: number, mz0: number, mx1: number, mz1: number, c: Crater): boolean {
  const cell = octaveCell(L), pHigh = P_HIGH[L];
  let h = mix32(seed ^ Math.imul(L + 1, 0x9e3779b1));
  h = mix32(h ^ Math.imul(i, 0x85ebca77));
  h = mix32(h ^ Math.imul(j, 0xc2b2ae3d));
  h = mix32(h ^ Math.imul(k, 0x27d4eb2f));
  const p = h / 4294967296;
  if (p >= pHigh) return false;
  h = mix32(h + 1);
  const px = (i + h / 4294967296) * cell;
  h = mix32(h + 1);
  const py = (j + h / 4294967296) * cell;
  h = mix32(h + 1);
  const pz = (k + h / 4294967296) * cell;
  const r = Math.sqrt(px * px + py * py + pz * pz);
  if (Math.abs(r - R_M) > cell / 2) return false;
  const dx = px / r, dy = py / r, dz = pz / r;
  mapOf(f, dx, dy, dz, tmpM);
  const x = tmpM[0], z = tmpM[1];
  if (x < mx0 || x > mx1 || z < mz0 || z > mz1) return false;
  tmpD[0] = dx;
  tmpD[1] = dy;
  tmpD[2] = dz;
  // (a mare keeps a third of them: the same craters, so a map's seas are the highlands' with some taken away)
  if (p >= pHigh * P_MARE) {
    const mare = mareOf(linearAt(alb, latOf(tmpD), lonOf(tmpD)));
    if (p >= pHigh * (1 + (P_MARE - 1) * mare)) return false;
  }
  h = mix32(h + 1);
  // a power law inside the octave too: the small end is the common one
  const u = h / 4294967296;
  c.r = (octaveD(L) / 2) * 2 ** -Math.sqrt(u);
  h = mix32(h + 1);
  const ag = h / 4294967296;
  c.age = ag < 0.07 ? Age.Fresh : ag < 0.34 ? Age.Plain : ag < 0.7 ? Age.Old : Age.Ghost;
  h = mix32(h + 1);
  c.a = h / 4294967296;
  h = mix32(h + 1);
  c.b = h / 4294967296;
  h = mix32(h + 1);
  c.c = h / 4294967296;
  c.L = L;
  c.i = i;
  c.j = j;
  c.k = k;
  c.dx = dx;
  c.dy = dy;
  c.dz = dz;
  c.x = x;
  c.z = z;
  return true;
}

/** A crater back from its id, on this map, from anywhere: null if no such crater. */
export function craterById(f: MapFrame, alb: WholeMap, seed: number, id: string): Crater | null {
  const [L, i, j, k] = id.split('.').map(Number);
  const c: Crater = { L, i, j, k, dx: 0, dy: 0, dz: 0, x: 0, z: 0, r: 0, age: Age.Plain, a: 0, b: 0, c: 0 };
  return roll(f, alb, seed, L, i, j, k, -Infinity, -Infinity, Infinity, Infinity, c) ? c : null;
}

export interface CraterHit {
  /** stable on any map: an octave and a cell, or `p<place id>` for a named crater */
  id: string;
  name?: string;
  x: number;
  z: number;
  /** radius at the rim (m) */
  r: number;
  age: Age;
}

/**
 * Every invented crater whose rim comes within `radius` of (x, z) on this map, largest first, down to `minD` metres across. For gameplay, not for a frame: it allocates. The named
 * ones come in with moonBoot's cratersNear, which is the one to call.
 */
export function cratersNear(f: MapFrame, alb: WholeMap, seed: number, x: number, z: number, radius: number, minD = 40): CraterHit[] {
  const out: CraterHit[] = [];
  for (let L = 0; L < OCTAVES && octaveD(L) >= minD; L++) {
    eachCrater(f, alb, seed, L, x - radius, z - radius, x + radius, z + radius, (c) => {
      if (c.r * 2 < minD) return;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d - c.r > radius) return;
      out.push({ id: craterId(c), x: c.x, z: c.z, r: c.r, age: c.age });
    });
  }
  return out.sort((a, b) => b.r - a.r);
}
