#!/usr/bin/env node
// The Lift's checks under Node (docs/specs/factions/LIFT.md): the shipped motion, heights, neighbourhood pick and obstacle field (src/world/liftGlsl.ts,
// LiftField.ts), bundled with rolldown as tools/world/hoods-check.mjs bundles hoods.ts, on the real data: hoods.bin through loadHoods and the
// neighbourhood's region bundles through the worker's own loadRegion. Then the real Flight (src/game/Flight.ts) at 120 Hz on Alamo Square with
// every house up and bobbing: under the Painted Ladies at the floor and at 30 m, over the layer, in from the edge, and the field's identity.
// Prints pass or FAIL a line with its numbers, exits 1 on any failure.
//
//   node tools/factions/lift-check.mjs
import { rolldown } from 'rolldown';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const R = root.replace(/\\/g, '/');
const out = `${here}.out`;
mkdirSync(out, { recursive: true });
writeFileSync(
  `${out}/lift-entry.ts`,
  [
    `export * from '${R}/src/world/liftGlsl.ts';`,
    `export * from '${R}/src/world/LiftField.ts';`,
    `export * from '${R}/src/world/hoods.ts';`,
    `export { loadRegion } from '${R}/src/world/regionLoader.ts';`,
    `export { eaveY, RoofBuild } from '${R}/src/world/roofGeom.ts';`,
    `export { Flight } from '${R}/src/game/Flight.ts';`,
    `export { config } from '${R}/src/config.ts';`,
    `export { latLonToLocal } from '${R}/src/game/geo.ts';`,
  ].join('\n'),
);
const bundle = await rolldown({ input: `${out}/lift-entry.ts`, platform: 'node', logLevel: 'silent', external: [/^three/] });
await bundle.write({ dir: out, format: 'esm', entryFileNames: 'lift.mjs' });
await bundle.close();
const L = await import(pathToFileURL(`${out}/lift.mjs`).href);
const { LIFT } = L;

let failed = 0;
function report(name, value, limit, ok) {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${value}  (${limit})`);
}
const f2 = (x) => (typeof x === 'number' ? x.toFixed(2) : x);
const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

// ------------------------------------------------------------------ 1. the motion
{
  const o = [0, 0];
  const H = 45, sb = 0.37;
  L.liftAt(-0.01, 100, H, sb, o);
  report('before the crouch', `dy ${o[0]} sq ${o[1]}`, '0, 0', o[0] === 0 && o[1] === 0);
  let lo = 0, hi = -1, slo = 1, shi = 0;
  for (let t = 0; t < LIFT.crouch; t += 1 / 240) {
    L.liftAt(t, 100, H, sb, o);
    lo = Math.min(lo, o[0]);
    hi = Math.max(hi, o[0]);
    slo = Math.min(slo, 1 + o[1]);
    shi = Math.max(shi, 1 + o[1]);
  }
  report('the crouch', `dy ${f2(lo)}..${f2(hi)}, sy ${slo.toFixed(3)}..${shi.toFixed(3)}`, 'dy in [-0.35, 0], sy in [0.84, 1]', lo >= -0.3501 && hi <= 0 && slo >= 0.8399 && shi <= 1);
  // the overshoot, without the bob (amplitude 0: a seed's bob is checked apart)
  let peak = -Infinity, at = 0;
  const noBob = (t, h) => {
    const u = t - LIFT.crouch, e = Math.exp(-LIFT.k * u);
    return (h + LIFT.sink) * (1 - e * Math.cos(LIFT.w * u)) - LIFT.sink;
  };
  for (const h of [15, 30, 45, 50]) {
    peak = -Infinity;
    for (let t = LIFT.crouch; t < LIFT.crouch + 2; t += 1 / 2000) {
      const y = noBob(t, h);
      if (y > peak) [peak, at] = [y, t - LIFT.crouch];
    }
    report(`overshoot at H ${h}`, `${(peak / h).toFixed(4)} H at u ${at.toFixed(3)} s`, '1.13 +- 0.01 H at 0.571 +- 0.01 s', Math.abs(peak / h - 1.13) <= 0.01 && Math.abs(at - 0.571) <= 0.01);
  }
  // settled within 2 % of H plus the bob from u = 1 s; the bob within 1.3 amp; no step faster than the launch, none after the overshoot over 5 cm
  let worstSettle = 0, worstBob = 0, worstStep = 0, worstLate = 0;
  for (const h of [15, 25, 45, 50])
    for (const s of [0, 0.13, 0.5, 0.77, 0.999]) {
      const amp = L.liftAmp(h, s);
      let prev = null;
      for (let t = 0; t < 12; t += 1 / 120) {
        const now = 1000 + t;
        L.liftAt(t, now, h, s, o);
        const u = t - LIFT.crouch;
        if (u >= 1.0) worstSettle = Math.max(worstSettle, (Math.abs(o[0] - h) - 1.3 * amp) / h);
        if (u >= 3) worstBob = Math.max(worstBob, Math.abs(o[0] - h) / amp);
        if (prev !== null) {
          const st = Math.abs(o[0] - prev);
          worstStep = Math.max(worstStep, st / ((1.1 * LIFT.k * (h + LIFT.sink)) / 120));
          if (u > 1.5) worstLate = Math.max(worstLate, st);
        }
        prev = o[0];
      }
    }
  report('settled from u = 1 s', `${(worstSettle * 100).toFixed(2)} % of H past the bob`, '<= 2 %', worstSettle <= 0.02);
  report('the bob', `${worstBob.toFixed(3)} amp at most`, '<= 1.3 amp', worstBob <= 1.3);
  report('fastest 1/120 s step', `${worstStep.toFixed(3)} of 1.1 k (H + sink) / 120`, '<= 1', worstStep <= 1);
  report('steps once settled (u > 1.5 s)', `${f2(worstLate)} m at most`, '<= 0.05 m', worstLate <= 0.05);
  // the slow motion's game time
  const game = (p) => {
    let g = 0;
    for (let t = 0; t < p[1] + p[2] + p[3]; t += 1e-4) g += L.slowAt(t, ...p) * 1e-4;
    return g;
  };
  const gh = game(L.SLOW_HIT), gw = game(L.SLOW_WAVE);
  report('a hit\'s slow motion', `${gh.toFixed(3)} s of game time in ${(L.SLOW_HIT[1] + L.SLOW_HIT[2] + L.SLOW_HIT[3]).toFixed(2)} s`, '0.462', Math.abs(gh - 0.462) < 0.002);
  report('the wave\'s slow motion', `${gw.toFixed(3)} s of game time in ${(L.SLOW_WAVE[1] + L.SLOW_WAVE[2] + L.SLOW_WAVE[3]).toFixed(2)} s`, '0.570', Math.abs(gw - 0.57) < 0.002);
}

// ------------------------------------------------------------------ the data
async function city(slug) {
  const dir = `${root}/public/city/${slug}`;
  const man = JSON.parse(readFileSync(`${dir}/city.json`, 'utf8'));
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x/');
    const p = `${root}/public${u.pathname}`;
    return existsSync(p) ? new Response(readFileSync(p)) : new Response(null, { status: 404 });
  };
  const T = await L.loadHoods(`/city/${slug}`, man.hoods);
  return { man, T };
}

/** The hood's buildings and tiles, through the worker's own loader (LOD 0). */
async function hoodData(slug, man, T, n, pad = 200) {
  const S = L.SQUARE;
  const sq = new Set(T.squares[n]);
  const tagged = new Set(T.tagged);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const k of sq) {
    x0 = Math.min(x0, L.squareIx(k) * S);
    z0 = Math.min(z0, L.squareIz(k) * S);
    x1 = Math.max(x1, (L.squareIx(k) + 1) * S);
    z1 = Math.max(z1, (L.squareIz(k) + 1) * S);
  }
  const RS = man.regionSize * man.tileSize;
  const tiles = new Map();
  for (let rz = Math.floor((z0 - pad) / RS); rz <= Math.floor((z1 + pad) / RS); rz++)
    for (let rx = Math.floor((x0 - pad) / RS); rx <= Math.floor((x1 + pad) / RS); rx++) {
      if (!existsSync(`${root}/public/city/${slug}/r_${rx}_${rz}.bin`)) continue;
      const res = await L.loadRegion({ type: 'region', id: 1, url: `http://x/city/${slug}/r_${rx}_${rz}.bin`, classN: man.classN, lod: 0, sf: slug === 'sf', tileSize: man.tileSize });
      if (res.error) continue;
      for (const t of res.tiles) tiles.set(`${t.tx},${t.tz}`, t);
    }
  const refs = [];
  const partTop = (b, kinds, k) => (kinds[k] !== L.RoofBuild.FLAT ? L.eaveY(b.baseY[k], b.roofY[k], b.tier[k]) + b.roofH[k] : b.roofY[k]);
  for (const t of tiles.values()) {
    const b = t.building;
    if (!b) continue;
    for (let i = 0; i < b.count; ) {
      let j = i + 1;
      while (j < b.count && b.index[j] === b.index[i]) j++;
      const s = b.vertStart[i], e = b.vertStart[i + 1];
      let cx = 0, cz = 0, area = 0;
      for (let k = s; k < e; k++) {
        cx += b.xz[k * 2];
        cz += b.xz[k * 2 + 1];
        const k2 = k + 1 < e ? k + 1 : s;
        area += b.xz[k * 2] * b.xz[k2 * 2 + 1] - b.xz[k2 * 2] * b.xz[k * 2 + 1];
      }
      cx /= e - s;
      cz /= e - s;
      let top = -Infinity, bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
      for (let k = i; k < j; k++) {
        top = Math.max(top, partTop(b, t.kinds, k));
        if (b.tier[k] !== 0) continue;
        for (let v = b.vertStart[k]; v < b.vertStart[k + 1]; v++) {
          bx0 = Math.min(bx0, b.xz[v * 2]);
          bx1 = Math.max(bx1, b.xz[v * 2]);
          bz0 = Math.min(bz0, b.xz[v * 2 + 1]);
          bz1 = Math.max(bz1, b.xz[v * 2 + 1]);
        }
      }
      const key = L.squareKey(Math.floor(cx / S), Math.floor(cz / S));
      refs.push({ index: b.index[i], b, kinds: t.kinds, local: i, parts: j - i, cx, cz, area: Math.abs(area) / 2, baseY: b.groundY[i], roofY: top, x0: bx0, z0: bz0, x1: bx1, z1: bz1, inHood: sq.has(key) && !tagged.has(key) && b.index[i] < man.buildingCount, partTop });
      i = j;
    }
  }
  return { sq, rect: [x0, z0, x1, z1], tiles, refs, heart: T.hearts[n] };
}

// ------------------------------------------------------------------ 3. the pick
const cities = {};
for (const slug of ['sf', 'amsterdam', 'london']) cities[slug] = await city(slug);
{
  const { man, T } = cities.sf;
  const a = L.pickHood(T, null, man);
  report('default hood (sf)', T.names[a], 'Alamo Square', T.names[a] === 'Alamo Square');
  for (const w of ['alamo square', 'ALAMO-SQUARE', 'Alamo_Square']) report(`&hood=${w}`, T.names[L.pickHood(T, w, man)], 'Alamo Square', T.names[L.pickHood(T, w, man)] === 'Alamo Square');
  const slash = T.names.findIndex((x) => x.includes('/'));
  if (slash >= 0) {
    const part = T.names[slash].split('/')[1];
    report(`&hood= one part of "${T.names[slash]}"`, T.names[L.pickHood(T, part, man)], T.names[slash], L.pickHood(T, part, man) === slash);
  } else report('an "A / B" name', 'none in sf', 'skipped', true);
  // the fallback: San Francisco with no Alamo Square, and the other cities as they come
  const noAlamo = { ...T, names: T.names.map((x) => (x === 'Alamo Square' ? 'Somewhere Else' : x)) };
  const fb = L.pickHood(noAlamo, null, man);
  report('fallback (sf, no Alamo Square)', T.names[fb], 'Fillmore District', T.names[fb] === 'Fillmore District');
  for (const [slug, want] of [['amsterdam', 'Frederik Hendrikbuurt'], ['london', 'Paddington']]) {
    const c = cities[slug];
    const n = L.pickHood(c.T, null, c.man);
    report(`fallback (${slug})`, `${c.T.names[n]} (${L.hoodDensity(c.T, n, c.man).toFixed(1)} buildings a square)`, want, c.T.names[n] === want);
  }
}

// ------------------------------------------------------------------ 2. the heights on real data
const data = {};
for (const slug of ['sf', 'amsterdam', 'london']) {
  const { man, T } = cities[slug];
  const n = L.pickHood(T, null, man);
  const d = (data[slug] = await hoodData(slug, man, T, n, slug === 'sf' ? 200 : 0));
  const hx = (L.squareIx(d.heart) + 0.5) * L.SQUARE, hz = (L.squareIz(d.heart) + 0.5) * L.SQUARE;
  const lift = d.refs.filter((r) => r.inHood).sort((a, b) => Math.hypot(a.cx - hx, a.cz - hz) - Math.hypot(b.cx - hx, b.cz - hz)).slice(0, LIFT.cap);
  const Hs = lift.map((r) => L.liftRest(r.area, r.roofY - r.baseY, r.index));
  const tops = lift.map((r, i) => r.roofY - r.baseY + Hs[i]);
  const badH = Hs.filter((h) => !(h >= 15 && h <= 50)).length;
  const badTop = lift.filter((r, i) => tops[i] > Math.max(75, r.roofY - r.baseY + 15) + 1e-6).length;
  const small = lift.map((r, i) => [r, Hs[i]]).filter(([r]) => r.area < 200).map(([, h]) => h);
  const big = lift.map((r, i) => [r, Hs[i]]).filter(([r]) => r.area > 800).map(([, h]) => h);
  const pass30 = lift.filter((r, i) => Hs[i] - (1.3 * L.liftAmp(Hs[i], L.liftSeed(r.index, 2)) + 0.3) - 8 >= 30).length;
  const name = T.names[n];
  report(`${slug} ${name}: houses`, `${lift.length} lifted of ${d.refs.filter((r) => r.inHood).length} liftable`, `<= ${LIFT.cap}`, lift.length > 0 && lift.length <= LIFT.cap);
  report(`${slug}: H`, `${f2(Math.min(...Hs))}..${f2(Math.max(...Hs))} m, median ${f2(q(Hs, 0.5))}; tops median ${f2(q(tops, 0.5))} max ${f2(Math.max(...tops))}`, 'H in [15, 50], top <= max(75, roof + 15)', badH === 0 && badTop === 0);
  report(`${slug}: small high, big low`, `median ${small.length ? f2(q(small, 0.5)) : '-'} (under 200 m2, ${small.length}) vs ${big.length ? f2(q(big, 0.5)) : '-'} (over 800 m2, ${big.length})`, 'small above big', !small.length || !big.length || q(small, 0.5) > q(big, 0.5));
  report(`${slug}: a 30 m pass under`, `${pass30} of ${lift.length} (${((pass30 / lift.length) * 100).toFixed(0)} %)`, slug === 'sf' ? '>= 75 % (87 % before the heights spread wider for the outside look)' : 'reported', slug !== 'sf' || pass30 / lift.length >= 0.75);
}

// ------------------------------------------------------------------ 4. the field and the real Flight, Alamo Square
{
  const { man } = cities.sf;
  const d = data.sf;
  const ts = man.tileSize;
  const tileAt = (x, z) => d.tiles.get(`${Math.floor(x / ts)},${Math.floor(z / ts)}`);
  const groundAt = (x, z) => {
    const t = tileAt(x, z)?.terrain;
    if (!t) return 0;
    const fx = Math.min(t.n - 1.001, Math.max(0, (x - t.originX) / t.cell)), fz = Math.min(t.n - 1.001, Math.max(0, (z - t.originZ) / t.cell));
    const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz, h = t.heights, n = t.n;
    return (h[iz * n + ix] * (1 - ax) + h[iz * n + ix + 1] * ax) * (1 - az) + (h[(iz + 1) * n + ix] * (1 - ax) + h[(iz + 1) * n + ix + 1] * ax) * az;
  };
  // the baked cells as the City adopts them (the bake's obst, the detailed roofs' tops)
  for (const t of d.tiles.values()) if (t.terrain && t.tops) for (let k = 0; k < t.terrain.obst.length; k++) t.terrain.obst[k] = Math.max(t.terrain.obst[k], t.tops[k]);
  const baked = (x, z) => {
    const t = tileAt(x, z)?.terrain;
    if (!t) return groundAt(x, z) + 18;
    const c = ts / t.obstN;
    return t.obst[Math.min(t.obstN - 1, Math.max(0, Math.floor((z - t.originZ) / c))) * t.obstN + Math.min(t.obstN - 1, Math.max(0, Math.floor((x - t.originX) / c)))];
  };
  const segDist = (ax, az, bx, bz, x, z) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    return Math.hypot(ax + dx * t - x, az + dz * t - z);
  };
  const ring = (b, k, x, z) => {
    const s = b.vertStart[k], e = b.vertStart[k + 1];
    let inside = false, dist = Infinity;
    for (let i = s, j = e - 1; i < e; j = i++) {
      const xi = b.xz[i * 2], zi = b.xz[i * 2 + 1], xj = b.xz[j * 2], zj = b.xz[j * 2 + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      dist = Math.min(dist, segDist(xj, zj, xi, zi, x, z));
    }
    return inside ? 0 : dist;
  };
  const world = {
    // (City.stampLift's rule, without the tree crowns: the check's baked cells have none either)
    stampLift(x, z, c, idx, top, o, max, rest) {
      let r = -Infinity;
      for (let sx = -1; sx <= 1; sx++) for (let sz = -1; sz <= 1; sz++) r = Math.max(r, groundAt(x + sx * 0.4 * c, z + sz * 0.4 * c));
      rest[0] = r;
      let n = 0;
      for (const ref of d.refs) {
        if (ref.x1 < x - 6 || ref.x0 > x + 6 || ref.z1 < z - 6 || ref.z0 > z + 6) continue;
        let y = -Infinity;
        for (let k = ref.local; k < ref.local + ref.parts; k++) {
          const py = ref.partTop(ref.b, ref.kinds, k);
          if (py <= y) continue;
          if (ring(ref.b, k, x, z) <= Math.max(py - ref.b.baseY[k] > 40 ? 6 : 3, c * 0.71)) y = py;
        }
        if (y === -Infinity) continue;
        if (n >= max) return -1;
        idx[o + n] = ref.index;
        top[o + n] = y;
        n++;
      }
      return n;
    },
  };
  const N = Math.max(...d.refs.map((r) => r.index)) + 1;
  const houses = { state: new Uint8Array(N), H: new Float32Array(N), margin: new Float32Array(N), base: new Float32Array(N), t0: new Float32Array(N), extra: new Float32Array(N), seed: new Float32Array(N), now: 0, tmp: [0, 0] };
  houses.dyNow = (i) => {
    if (!houses.state[i]) return 0;
    L.liftAt(houses.now - houses.t0[i], houses.now, houses.H[i], houses.seed[i], houses.tmp);
    return houses.tmp[0];
  };
  const [x0, z0, x1, z1] = d.rect;
  const c = ts / man.obstN;
  const field = new L.LiftField(Math.floor((x0 - 60) / c) * c, Math.floor((z0 - 60) / c) * c, x1 + 60, z1 + 60, c, world, houses);
  const lifted = d.refs.filter((r) => r.inHood);
  for (const r of lifted) {
    const i = r.index;
    houses.H[i] = L.liftRest(r.area, r.roofY - r.baseY, i);
    houses.seed[i] = L.liftSeed(i, 2);
    houses.margin[i] = 1.3 * L.liftAmp(houses.H[i], houses.seed[i]) + 0.3;
    houses.base[i] = r.baseY;
  }
  // e. identity: nothing up, the field is the bake at every cell
  let same = 0, cells = 0;
  for (let z = z0 - 56; z < z1 + 56; z += c)
    for (let x = x0 - 56; x < x1 + 56; x += c) {
      cells++;
      if (field.query(x, z, 50, baked(x, z), false) === baked(x, z) && field.under === Infinity) same++;
    }
  report('identity, nothing up', `${same} of ${cells} cells the bake's exactly`, 'all', same === cells);
  // ... and every cell rebuilt with all houses on the ground holds to the bake's own rule
  for (const r of lifted) field.reach(r.x0, r.z0, r.x1, r.z1);
  let near1 = 0, under3 = 0, n = 0, dense = 0, over1;
  for (let z = z0 + c / 2; z < z1; z += c)
    for (let x = x0 + c / 2; x < x1; x += c) {
      const v = field.rebuilt(x, z);
      if (Number.isNaN(v)) {
        dense++;
        continue;
      }
      n++;
      const b = baked(x, z);
      if (Math.abs(v - b) <= 1) near1++;
      else if (v > b) over1 = (over1 ?? 0) + 1;
      if (v < b - 3) {
        under3++;
        if (process.env.LIFT_DEBUG && under3 <= 12) {
          const tr = tileAt(x, z)?.terrain;
          const tt = tileAt(x, z);
          const ci = Math.floor((x - tr.originX) / c), cj = Math.floor((z - tr.originZ) / c);
          const raw = tt.tops ? tt.tops[cj * tr.obstN + ci] : NaN;
          console.log('  cell', x.toFixed(0), z.toFixed(0), 'baked', b.toFixed(1), 'rebuilt', v.toFixed(1), 'ground', groundAt(x, z).toFixed(1), 'tops', raw.toFixed(1), 'trees near', tr.trees.filter((t) => Math.hypot(t.x - x, t.z - z) < 12).length, 'refs near', d.refs.filter((r) => r.x0 - 8 < x && r.x1 + 8 > x && r.z0 - 8 < z && r.z1 + 8 > z).map((r) => r.index + ':' + r.roofY.toFixed(1) + ':' + r.z0.toFixed(0) + '..' + r.z1.toFixed(0)).join(' '));
        }
      }
    }
  // (the raw rebuild has no detailed roofs' chimneys and parapets, adoptTops: where a cell's tallest house stays down, the field keeps the bake's answer)
  report('the rebuild, all grounded (raw)', `${((near1 / n) * 100).toFixed(1)} % within 1 m of the bake, ${over1 ?? 0} over it, ${under3} over 3 m under it (${dense} left to the bake)`, 'reported', true);
  let eq = 0, m = 0;
  for (let z = z0 + c / 2; z < z1; z += c)
    for (let x = x0 + c / 2; x < x1; x += c) {
      m++;
      if (field.query(x, z, 50, baked(x, z), false) === baked(x, z)) eq++;
    }
  report('identity, all reached and all down', `${eq} of ${m} cells the bake's exactly`, 'all', eq === m);

  // every house up since long ago, bobbing on the game clock
  for (const r of lifted) {
    houses.state[r.index] = 2;
    houses.t0[r.index] = -20;
  }
  const W = {
    obstacleAt: (x, z, fromY) => field.query(x, z, fromY ?? Infinity, baked(x, z), false),
    hardAt: (x, z, fromY) => field.query(x, z, fromY, baked(x, z), false),
    overheadAt: (x, z, fromY) => field.overhead(x, z, fromY),
    groundAt,
  };
  const exactUnder = (x, z, y) => {
    field.query(x, z, y, 0, true);
    return field.under;
  };
  const exactTop = (x, z) => field.query(x, z, 1e9, baked(x, z), true);
  const [sx0, sz0] = L.latLonToLocal(37.7745, -122.43262, man.origin);
  function fly(name, y0, hold, secs, check) {
    const f = new L.Flight();
    f.x = sx0;
    f.z = sz0;
    f.heading = 0;
    f.y = groundAt(f.x, f.z) + y0;
    if (hold) {
      f.holdY = f.y;
      f.targetY = f.y;
    }
    houses.now = 0;
    let under = 0, steps = 0, worst = {};
    let prevFloor = NaN;
    for (let s = 0; s < secs * 120; s++) {
      houses.now = s / 120;
      f.step(1 / 120, { sx: 0, sy: 0, dragging: false }, W);
      steps++;
      const g = groundAt(f.x, f.z);
      const u = exactUnder(f.x, f.z, f.y);
      const r = check(f, g, u, prevFloor, worst);
      if (r) under++;
      prevFloor = f.floorY;
    }
    return { under, steps, worst, f };
  }
  // a. north along Steiner Street under the Painted Ladies, at the floor
  {
    const r = fly('floor', 10, false, 8, (f, g, u, pf, w) => {
      if (u === Infinity) return false;
      w.gap = Math.min(w.gap ?? Infinity, u - 1 - f.y);
      w.vy = Math.max(w.vy ?? -Infinity, f.vy);
      w.low = Math.min(w.low ?? Infinity, f.y - g - 3.5);
      if (!Number.isNaN(pf)) w.step = Math.max(w.step ?? 0, Math.abs(f.floorY - pf));
      return true;
    });
    const w = r.worst;
    report('a. under the Ladies at the floor', `${r.under} of ${r.steps} steps under a house; least room to a belly ${f2(w.gap)} m`, 'under some, room >= 0', r.under > 0 && w.gap >= 0);
    report('a. no bounce up under them', `vy at most ${f2(w.vy)} m/s; over the ground's 3.5 m by ${f2(w.low)}; floor steps ${f2(w.step)} m`, 'vy <= 2, >= 0, floor step <= 3', w.vy <= 2 && w.low >= 0 && (w.step ?? 0) <= 3);
  }
  // b. the same at a held 20 m (Steiner runs down 15 m: the hold is a height, not one over the ground). Under a belly lower than the hold's
  // room (the soft ceiling, 9 m under it with the body) it is let down under it and climbs back after, so the offsets are reported; it must
  // never put the body in a belly, never go under the ground's 3.5 m
  {
    const hold = (f, g, u, pf, w) => {
      w.lo = Math.min(w.lo ?? Infinity, f.y - f.holdY);
      w.hi = Math.max(w.hi ?? -Infinity, f.y - f.holdY);
      w.over = Math.min(w.over ?? Infinity, f.y - g);
      if (u === Infinity) return false;
      w.gap = Math.min(w.gap ?? Infinity, u - 5 - f.y);
      w.vy = Math.max(w.vy ?? -Infinity, f.vy);
      return true;
    };
    const r = fly('20 m', 20, true, 8, hold);
    const w = r.worst;
    for (const ref of d.refs) houses.state[ref.index] = 0;
    const base = fly('20 m, nothing up', 20, true, 8, hold);
    for (const ref of d.refs) if (ref.inHood) houses.state[ref.index] = 2;
    const bw = base.worst;
    report('b. a held 20 m under them', `${r.under} steps under; ${f2(w.lo)}..+${f2(w.hi)} m off the held height (nothing up: ${f2(bw.lo)}..+${f2(bw.hi)}), ${f2(w.over)} m over the ground at least, vy under a belly at most ${f2(w.vy)} m/s, the body's 5 m at least ${f2(w.gap)} m from a belly`, 'body clear, over the ground >= 3.5 (vy: the hold climbing back under a higher belly)', r.under > 0 && w.gap >= 0 && w.over >= 3.5);
  }
  // c. over the layer, from 90 m, released
  {
    const r = fly('over', 90, false, 10, (f, g, u, pf, w) => {
      if (f.y < 60 + g && u !== Infinity) w.dipped = (w.dipped ?? 0) + 1;
      const t = exactTop(f.x, f.z);
      field.query(f.x, f.z, 1e9, 0, false);
      if (houses.now > 6 && t > g + 20) w.room = Math.min(w.room ?? Infinity, f.y - t - 3.5);
      return false;
    });
    report('c. over the layer', `least room over a floating roof ${f2(r.worst.room)} m (after 6 s)`, '>= 0', (r.worst.room ?? 0) >= 0);
  }
  // d. in from the edge: from the hood's start pose (an afternoon sun from the west south west), at the floor, toward the heart: it goes under the layer, never over it
  {
    const sun = [Math.cos(-0.35) * -1, Math.sin(-0.35)];
    const st = L.hoodStart(d.sq, d.heart, sun[0], sun[1]);
    const f = new L.Flight();
    f.x = st.x;
    f.z = st.z;
    f.heading = st.heading;
    f.y = groundAt(f.x, f.z) + 12;
    let under = 0, over = 0, high = 0;
    for (let s = 0; s < 12 * 120; s++) {
      houses.now = s / 120;
      f.step(1 / 120, { sx: 0, sy: 0, dragging: false }, W);
      const u = exactUnder(f.x, f.z, f.y);
      if (u !== Infinity) {
        under++;
        high = Math.max(high, f.y - groundAt(f.x, f.z));
      }
      field.query(f.x, f.z, -1e9, 0, true);
      if (field.under !== Infinity && f.y > field.under) over++;
    }
    report('d. in from the edge', `${under} steps under a house, ${over} over or in one; at most ${f2(high)} m over the ground under them`, 'under some, never over', under > 0 && over === 0);
  }
  // f. a pull up under the layer (the GPU fly's find, 2026-11-06: held under one house, pulled up, the bus came to a lower one and the hard floor
  // put it on that one's roof in one frame, 36 m, through it). Along Steiner held at 24 m for 3 s, then the stick pulled for 7 s: no step up
  // past 3 m, never in a drawn house, the body (5 m tall, 12 long) never in a belly
  {
    const f = new L.Flight();
    f.x = sx0;
    f.z = sz0;
    f.heading = 0;
    f.y = groundAt(f.x, f.z) + 24;
    f.holdY = f.targetY = f.y;
    let jump = 0, inside = 0, belly = Infinity, under = 0, prevY = f.y, at = '';
    for (let s = 0; s < 10 * 120; s++) {
      houses.now = s / 120;
      const pull = s >= 3 * 120;
      f.step(1 / 120, { sx: 0, sy: pull ? -1 : 0, dragging: pull }, W);
      if (f.y - prevY > jump) {
        jump = f.y - prevY;
        at = `z ${f2(f.z)}`;
      }
      prevY = f.y;
      // (the bus's point, its nose and its tail: it is 12 m long)
      let u = Infinity;
      for (const o of [0, -6, 6]) {
        field.query(f.x, f.z + o, -1e9, 0, true);
        u = Math.min(u, field.under);
      }
      if (u !== Infinity) {
        const t = exactTop(f.x, f.z);
        if (f.y > u && f.y < t) inside++;
        if (f.y < u) {
          under++;
          belly = Math.min(belly, u - f.y - 5);
        }
      }
    }
    report('f. a pull up under the layer', `largest step up ${f2(jump)} m (${at}), ${inside} steps in a drawn house, ${under} under one with the body's 5 m at least ${f2(belly)} m from a belly`, 'step <= 3, never in one, body clear', jump <= 3 && inside === 0 && belly >= 0);
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
