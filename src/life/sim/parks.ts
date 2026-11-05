import { fnv1a, mix, unit } from '../hash';
import { Col, Kind, ROW } from '../kinds';
import type { RegionGraph } from '../../world/lifeData';

// People (LIVING.md, "People"), in the parks: the producer, 2026-11-05, "let's just remove people, or, if anything, let's include them in parks like mission Dolores
// park where it can be a field day any day of the week in the afternoon, people lying on blankets etc. But they need to appear more pixelated and noticeable, more fun".
// A picnic is a group on a blanket on the grass of a park: the graphs' PARK areas (CONTRACT.md section 1.2) over the host's 2 m sampling of the ground classes, GRASS
// cells only, so never on a path, a court or a playground. Each 6 m block of park grass may hold one; a park's blocks are a tile's slots, and a slot's group comes on a
// day by its hash, every one at a weekend and half of them on a weekday, arriving after 11:00 local and staying one to four hours, home by 19:30. Worker-safe and pure:
// a group is a function of the tile's ground, the park, its slot, the local day and utcMs, so every player sees the same one. Never saved: `picnic:` lives only while
// it's near (CONTRACT.md section 3).

/** A tile's ground as the host sampled it: its corner (m), its cells' side (m) and count a side, which are grass, and the ground's height there. */
export interface LawnTile {
  tx: number;
  tz: number;
  x0: number;
  z0: number;
  cell: number;
  n: number;
  grass: Uint8Array;
  h: Float32Array;
  /** its grass cells */
  count: number;
}

/** The host's sampling: 2 m cells, the ground classes' own, 128 a side of a 256 m tile. */
export const LAWN_CELL = 2;
/** A group's block (cells a side: 6 m, room for its blanket at its scale turned any way), slots a square metre of park grass (about half of them out at the busiest:
 *  a blanket every 11 m or so, toward the producer's picture of Dolores at its peak, everywhere), the most a tile, and its scale over the model (pools.ts: a third
 *  over that again, "more pixelated and noticeable") */
export const PICNIC_BLOCK = 3;
const BLOCK = PICNIC_BLOCK, DENSITY = 0.016, MOST = 300, PICNIC_SCALE = 1.35;
/** The day: a slot's group comes this share of weekdays (every one at a weekend), arrives from ARRIVE for ARRIVE_SPAN, stays STAY to STAY + STAY_SPAN, leaves by HOME
 *  (local, s from midnight); and grows in and out over FADE (s). */
const WEEKDAY = 0.5, ARRIVE = 11 * 3600, ARRIVE_SPAN = 5.5 * 3600, STAY = 3600, STAY_SPAN = 3 * 3600, HOME = 19.5 * 3600, FADE = 20;
const PARK = 2;

/** A tile's park grass as blocks of PICNIC_BLOCK cells a side: each block's corner cell (i, j) packed j * n + i, every cell of it grass in a park. */
export function parkBlocks(t: LawnTile, graphs: RegionGraph[]): Uint32Array {
  const n = t.n, park = new Uint8Array(n * n), x1 = t.x0 + n * t.cell, z1 = t.z0 + n * t.cell;
  for (const G of graphs) {
    const A = G.areas;
    for (let a = 0; a < A.n; a++) {
      if (A.kind[a] !== PARK) continue;
      for (let tr = A.tri[a]; tr < A.tri[a + 1]; tr++) {
        const o = tr * 9, ax = A.xyz[o], az = A.xyz[o + 2], bx = A.xyz[o + 3], bz = A.xyz[o + 5], cx = A.xyz[o + 6], cz = A.xyz[o + 8];
        if (Math.max(ax, bx, cx) < t.x0 || Math.min(ax, bx, cx) > x1 || Math.max(az, bz, cz) < t.z0 || Math.min(az, bz, cz) > z1) continue;
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - t.x0) / t.cell)), i1 = Math.min(n - 1, Math.floor((Math.max(ax, bx, cx) - t.x0) / t.cell));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - t.z0) / t.cell)), j1 = Math.min(n - 1, Math.floor((Math.max(az, bz, cz) - t.z0) / t.cell));
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const px = t.x0 + (i + 0.5) * t.cell, pz = t.z0 + (j + 0.5) * t.cell;
            const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
            if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) park[j * n + i] = 1;
          }
      }
    }
  }
  const out: number[] = [];
  for (let j = 0; j + BLOCK <= n; j += BLOCK)
    for (let i = 0; i + BLOCK <= n; i += BLOCK) {
      let ok = true;
      for (let dj = 0; dj < BLOCK && ok; dj++) for (let di = 0; di < BLOCK && ok; di++) ok = park[(j + dj) * n + i + di] === 1 && t.grass[(j + dj) * n + i + di] === 1;
      if (ok) out.push(j * n + i);
    }
  return Uint32Array.from(out);
}

/** The ground's height at (x, z) in the tile, between its cells' middles. */
function heightAt(t: LawnTile, x: number, z: number): number {
  const fx = Math.min(t.n - 1.001, Math.max(0, (x - t.x0) / t.cell - 0.5)), fz = Math.min(t.n - 1.001, Math.max(0, (z - t.z0) / t.cell - 0.5));
  const i = Math.floor(fx), j = Math.floor(fz), ax = fx - i, az = fz - j, n = t.n, h = t.h;
  return (h[j * n + i] * (1 - ax) + h[j * n + i + 1] * ax) * (1 - az) + (h[(j + 1) * n + i] * (1 - ax) + h[(j + 1) * n + i + 1] * ax) * az;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Who's on a blanket (the small pool's model, pools.ts): its slots' bits, 1 to 3 sitting round it, 8 lying on it, 16 a basket, 32 an umbrella over it. One to four
 * people, two the likeliest.
 */
export const LookBit = { SIT_A: 1, SIT_B: 2, SIT_C: 4, LIE: 8, BASKET: 16, UMBRELLA: 32 } as const;
export const PEOPLE_BITS = 15;
function lookOf(h: number): number {
  const u = unit(mix(h, 20)), many = u < 0.15 ? 1 : u < 0.55 ? 2 : u < 0.85 ? 3 : 4, v = unit(mix(h, 21)) < 0.5;
  let m = many === 1 ? (v ? 8 : 1) : many === 2 ? (v ? 1 | 8 : 1 | 2) : many === 3 ? (v ? 1 | 2 | 8 : 1 | 2 | 4) : 15;
  if (unit(mix(h, 22)) < 0.5) m |= 16;
  if (unit(mix(h, 23)) < 0.12) m |= 32;
  return m;
}

/**
 * The picnics of tile `t` (its park grass `blocks`) within `reach` of (bx, bz) at utcMs, `tzMin` the place's offset from UTC (min), as rows from `at` in `out`.
 * Returns the next free row, at most `max`. `keys`, if given, is told each row's key.
 */
export function picnicsOn(t: LawnTile, blocks: Uint32Array, utcMs: number, tzMin: number, bx: number, bz: number, reach: number, out: Float32Array, at: number, max: number,
  keys?: (hash: number, key: string) => void): number {
  const N = blocks.length;
  if (!N) return at;
  const side = t.n * t.cell, cx = t.x0 + side / 2, cz = t.z0 + side / 2, far = reach + side * 0.71;
  if ((cx - bx) * (cx - bx) + (cz - bz) * (cz - bz) > far * far) return at;
  const local = utcMs / 1000 + tzMin * 60, day = Math.floor(local / 86400), sec = local - day * 86400;
  if (sec < ARRIVE || sec > HOME) return at;
  // (1970-01-01 was a Thursday: Saturday and Sunday are 2 and 3)
  const wd = ((day % 7) + 7) % 7, weekend = wd === 2 || wd === 3;
  const u32 = new Uint32Array(out.buffer, out.byteOffset, out.length), r2 = reach * reach, area = BLOCK * t.cell * BLOCK * t.cell;
  const slots = Math.min(MOST, N, Math.round(N * area * DENSITY)), seed = mix(fnv1a(`picnic:${t.tx},${t.tz}`), day);
  // (each slot its own block: a stride through them coprime to their count, from a hashed start)
  let stride = 1 + (mix(seed, 1) % Math.max(1, N - 1));
  while (gcd(stride, N) !== 1) stride++;
  const start = mix(seed, 2) % N;
  for (let s = 0; s < slots && at < max; s++) {
    const h = mix(seed, s, 3);
    if (!weekend && unit(h) >= WEEKDAY) continue;
    const t0 = ARRIVE + unit(mix(h, 4)) * ARRIVE_SPAN, t1 = Math.min(HOME, t0 + STAY + unit(mix(h, 5)) * STAY_SPAN);
    if (sec < t0 || sec > t1) continue;
    const b = blocks[(start + s * stride) % N], bi = b % t.n, bj = (b - bi) / t.n;
    const x = t.x0 + (bi + BLOCK / 2) * t.cell + (unit(mix(h, 6)) - 0.5) * 0.6, z = t.z0 + (bj + BLOCK / 2) * t.cell + (unit(mix(h, 7)) - 0.5) * 0.6;
    if ((x - bx) * (x - bx) + (z - bz) * (z - bz) > r2) continue;
    const heading = unit(mix(h, 8)) * Math.PI * 2, fx = Math.cos(heading), fz = Math.sin(heading);
    // (lying on the slope: its pitch along its way and its roll across it, from the ground a metre either side; Dolores is a hillside)
    const y = heightAt(t, x, z), along = (heightAt(t, x + fx, z + fz) - heightAt(t, x - fx, z - fz)) / 2, across = (heightAt(t, x - fz, z + fx) - heightAt(t, x + fz, z - fx)) / 2;
    const o = at * ROW, key = `picnic:${t.tx},${t.tz}:${s}:${day}`, kh = fnv1a(key);
    u32[o + Col.KEY] = kh;
    out[o + Col.KIND] = Kind.PICNIC;
    out[o + Col.X] = x;
    out[o + Col.Y] = y;
    out[o + Col.Z] = z;
    out[o + Col.VX] = 0;
    out[o + Col.VY] = 0;
    out[o + Col.VZ] = 0;
    out[o + Col.HEADING] = heading;
    out[o + Col.PITCH] = Math.atan(along);
    out[o + Col.BANK] = -Math.atan(across);
    out[o + Col.SCALE] = Math.max(0.05, Math.min(1, (sec - t0) / FADE, (t1 - sec) / FADE)) * PICNIC_SCALE * (0.92 + 0.16 * unit(mix(h, 9)));
    out[o + Col.FLAGS] = 0;
    out[o + Col.UNTIL] = t1 - sec;
    out[o + Col.LOOK] = lookOf(h);
    keys?.(kh, key);
    at++;
  }
  return at;
}
