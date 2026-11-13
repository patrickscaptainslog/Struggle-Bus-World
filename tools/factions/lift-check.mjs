#!/usr/bin/env node
// The Lift's checks under Node (docs/specs/factions/LIFT.md): the shipped motion, heights, neighbourhood pick and obstacle field (src/world/liftGlsl.ts,
// LiftField.ts), bundled with rolldown as tools/world/hoods-check.mjs bundles hoods.ts, on the real data: hoods.bin through loadHoods and the
// neighbourhood's region bundles through the worker's own loadRegion. Then the real Flight (src/game/Flight.ts) at 120 Hz on Alamo Square with
// every house up and riding the swell: under the Painted Ladies at the floor and at 20 m, over the layer, in from the edge, a pull up and a
// dive through the layer, at a low floating house, a scan of straight runs through the layer, and the field's identity. With --gpu, the motion's
// GLSL runs on this machine's GPU (playwright's chromium, WebGL2, a float target) against the TypeScript at 4,096 points.
// Prints pass or FAIL a line with its numbers, exits 1 on any failure.
//
//   node tools/factions/lift-check.mjs [--gpu]
//   LIFT_TRACE=<a run's tag, e.g. 'i 90/50' is `90/50`, f2's `f20`> prints that run's trace, its steps over 3 m and the houses round them
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
  const o = [0, 0, 0, 0];
  const H = 45, sb = 0.37;
  L.liftAt(-0.01, 100, H, sb, -1200, -80, 3, o);
  report('before the crouch', `dy ${o[0]} sq ${o[1]}`, '0, 0', o[0] === 0 && o[1] === 0);
  let lo = 0, hi = -1, slo = 1, shi = 0;
  for (let t = 0; t < LIFT.crouch; t += 1 / 240) {
    L.liftAt(t, 100, H, sb, -1200, -80, 3, o);
    lo = Math.min(lo, o[0]);
    hi = Math.max(hi, o[0]);
    slo = Math.min(slo, 1 + o[1]);
    shi = Math.max(shi, 1 + o[1]);
  }
  report('the crouch', `dy ${f2(lo)}..${f2(hi)}, sy ${slo.toFixed(3)}..${shi.toFixed(3)}`, 'dy in [-0.35, 0], sy in [0.84, 1]', lo >= -0.3501 && hi <= 0 && slo >= 0.8399 && shi <= 1);
  // the overshoot, without the swell (it fades in after; checked apart)
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
  // settled within 2 % of H plus the swell's reach from u = 1 s; the heave the swell under its centre's; the lean never past tiltMax, and a
  // few degrees; no step faster than the launch, none after the overshoot over 5 cm in 1/120 s
  let worstSettle = 0, worstHeave = 0, worstStep = 0, worstLate = 0, worstLean = 0, leanSum = 0, leanN = 0, heaveMax = 0;
  const sw = [0, 0, 0], o4 = [0, 0, 0, 0];
  for (const h of [15, 25, 45, 50, 90])
    for (const s of [0, 0.13, 0.5, 0.77, 0.999])
      for (const [cx, cz, hv] of [[-1200, -80, 3.4], [-900, 150, 1.3], [40, 9000, 2.2]]) {
        let prev = null;
        for (let t = 0; t < 14; t += 1 / 120) {
          const now = 1000 + t;
          L.liftAt(t, now, h, s, cx, cz, hv, o4);
          const u = t - LIFT.crouch;
          const reach = hv + LIFT.drift;
          if (u >= 1.0) worstSettle = Math.max(worstSettle, (Math.abs(o4[0] - h) - reach) / h);
          if (u >= 3) {
            // (its heave less its own drift is the swell under its centre, a little late)
            const sf = s * 5.31;
            L.swellAt(cx, cz, now - LIFT.lag * (sf - Math.floor(sf)), sw);
            worstHeave = Math.max(worstHeave, Math.abs(o4[0] - h - hv * sw[0]));
            heaveMax = Math.max(heaveMax, Math.abs(o4[0] - h));
            const lean = Math.hypot(o4[2], o4[3]);
            worstLean = Math.max(worstLean, lean);
            leanSum += lean;
            leanN++;
          }
          if (prev !== null) {
            const st = Math.abs(o4[0] - prev);
            worstStep = Math.max(worstStep, st / ((1.1 * LIFT.k * (h + LIFT.sink)) / 120));
            if (u > 1.5) worstLate = Math.max(worstLate, st);
          }
          prev = o4[0];
        }
      }
  const deg = (x) => ((Math.atan(x) * 180) / Math.PI).toFixed(2);
  report('settled from u = 1 s', `${(worstSettle * 100).toFixed(2)} % of H past the swell's reach`, '<= 2 %', worstSettle <= 0.02);
  report('the heave is the swell under it', `${f2(worstHeave)} m at most off it, past its own drift (${LIFT.drift} m); ${f2(heaveMax)} m at most off its rest`, `<= drift + 0.01, off its rest <= heave + drift`, worstHeave <= LIFT.drift + 0.01 && heaveMax <= 3.4 + LIFT.drift + 1e-6);
  report('the lean', `${deg(worstLean)} degrees at most, ${deg(leanSum / leanN)} on average`, `<= ${deg(LIFT.tiltMax)} (tiltMax)`, worstLean <= LIFT.tiltMax + 1e-9);
  report('fastest 1/120 s step', `${worstStep.toFixed(3)} of 1.1 k (H + sink) / 120`, '<= 1', worstStep <= 1);
  report('steps once settled (u > 1.5 s)', `${f2(worstLate)} m at most`, '<= 0.05 m', worstLate <= 0.05);
  // the swell across the neighbourhood: a block or two long, several seconds a period
  for (const w of L.SWELLS) report(`a swell`, `${w.len} m long, every ${w.period} s, at ${(w.len / w.period).toFixed(1)} m/s, weight ${w.weight}`, 'a block or two, several seconds', w.len >= 100 && w.len <= 260 && w.period >= 5 && w.period <= 12);
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
      let top = -Infinity, bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity, rad = 0;
      for (let k = i; k < j; k++) {
        top = Math.max(top, partTop(b, t.kinds, k));
        if (b.tier[k] !== 0) continue;
        for (let v = b.vertStart[k]; v < b.vertStart[k + 1]; v++) {
          bx0 = Math.min(bx0, b.xz[v * 2]);
          bx1 = Math.max(bx1, b.xz[v * 2]);
          bz0 = Math.min(bz0, b.xz[v * 2 + 1]);
          bz1 = Math.max(bz1, b.xz[v * 2 + 1]);
          rad = Math.max(rad, Math.hypot(b.xz[v * 2] - cx, b.xz[v * 2 + 1] - cz));
        }
      }
      const key = L.squareKey(Math.floor(cx / S), Math.floor(cz / S));
      refs.push({ index: b.index[i], b, kinds: t.kinds, local: i, parts: j - i, cx, cz, rad, area: Math.abs(area) / 2, baseY: b.groundY[i], roofY: top, x0: bx0, z0: bz0, x1: bx1, z1: bz1, inHood: sq.has(key) && !tagged.has(key) && b.index[i] < man.buildingCount, partTop });
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
/** within g m: footprints' bounds (Lift.nearPlaced: LIFT_NEAR, and 3 for touching) */
const within = (a, b, g) => a !== b && b.x0 - g <= a.x1 && b.x1 + g >= a.x0 && b.z0 - g <= a.z1 && b.z1 + g >= a.z0;
const touching = (a, b) => within(a, b, 3);
const reachOf = (r) => L.liftReach(L.liftHeave(r.area, r.roofY - r.baseY, r.index), r.rad);
/** The wave's rests, as Lift.ts schedules them: out from the heart, each placed among its near neighbours already up (liftPlace). */
function rests(lift) {
  const H = new Map();
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / 64)},${Math.floor(z / 64)}`;
  for (const r of lift) {
    const k = key(r.cx, r.cz);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(r);
  }
  // (the low ones first, then the rest, each pass out from the heart: Lift.ts's wave)
  const low = (r) => L.liftLow(L.liftRest(r.area, r.roofY - r.baseY, r.index), reachOf(r));
  for (const r of [...lift.filter(low), ...lift.filter((r) => !low(r))]) {
    const near = [];
    const gx = Math.floor(r.cx / 64), gz = Math.floor(r.cz / 64);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (const o of grid.get(`${gx + dx},${gz + dz}`) ?? [])
          if (H.has(o.index) && within(r, o, L.LIFT_NEAR))
            near.push({ H: H.get(o.index), height: o.roofY - o.baseY, reach: reachOf(o), dist: Math.hypot(Math.max(o.x0 - r.x1, 0, r.x0 - o.x1), Math.max(o.z0 - r.z1, 0, r.z0 - o.z1)), touching: touching(r, o) });
    H.set(r.index, L.liftPlace(L.liftRest(r.area, r.roofY - r.baseY, r.index), r.roofY - r.baseY, reachOf(r), near));
  }
  return H;
}
const data = {};
for (const slug of ['sf', 'amsterdam', 'london']) {
  const { man, T } = cities[slug];
  const n = L.pickHood(T, null, man);
  const d = (data[slug] = await hoodData(slug, man, T, n, slug === 'sf' ? 200 : 0));
  const hx = (L.squareIx(d.heart) + 0.5) * L.SQUARE, hz = (L.squareIz(d.heart) + 0.5) * L.SQUARE;
  const lift = d.refs.filter((r) => r.inHood).sort((a, b) => Math.hypot(a.cx - hx, a.cz - hz) - Math.hypot(b.cx - hx, b.cz - hz)).slice(0, LIFT.cap);
  const R = (d.rests = rests(lift));
  const Hs = lift.map((r) => R.get(r.index));
  const hgt = (r) => r.roofY - r.baseY;
  const tops = lift.map((r, i) => hgt(r) + Hs[i]);
  const badH = Hs.filter((h) => !(h >= LIFT.hMin && h <= LIFT.hMax)).length;
  const badTop = lift.filter((r, i) => tops[i] > Math.max(LIFT.topMax, hgt(r) + LIFT.hMin) + 1e-6).length;
  const big = lift.map((r, i) => [r, Hs[i]]).filter(([r]) => r.area > 800).map(([, h]) => h);
  const lowest = lift.map((r, i) => Hs[i] - reachOf(r));
  const pass30 = lowest.filter((u) => u - 8 >= 30).length;
  const low = lowest.filter((u) => u < L.LIFT_PASS).length;
  const high = Hs.filter((h) => h >= LIFT.highMin).length;
  // touching neighbours alike
  let pairs = 0, alike = 0, closest = Infinity;
  for (let a = 0; a < lift.length; a++)
    for (let b = a + 1; b < lift.length; b++) {
      if (!touching(lift[a], lift[b])) continue;
      pairs++;
      const dh = Math.abs(Hs[a] - Hs[b]);
      closest = Math.min(closest, dh);
      if (dh < LIFT.apart - 1e-6) alike++;
    }
  const name = T.names[n];
  report(`${slug} ${name}: houses`, `${lift.length} lifted of ${d.refs.filter((r) => r.inHood).length} liftable`, `<= ${LIFT.cap}`, lift.length > 0 && lift.length <= LIFT.cap);
  report(`${slug}: H`, `${f2(Math.min(...Hs))}..${f2(Math.max(...Hs))} m, median ${f2(q(Hs, 0.5))}, quartiles ${f2(q(Hs, 0.25))} and ${f2(q(Hs, 0.75))}; tops median ${f2(q(tops, 0.5))} max ${f2(Math.max(...tops))}`, `H in [${LIFT.hMin}, ${LIFT.hMax}], top <= max(${LIFT.topMax}, roof + ${LIFT.hMin})`, badH === 0 && badTop === 0);
  report(`${slug}: low, middle, high flyers`, `${low} too low to pass under (${((low / lift.length) * 100).toFixed(0)} %), ${lift.length - low - high} in the middle, ${high} high flyers (${((high / lift.length) * 100).toFixed(0)} %); big ones (over 800 m2, ${big.length}) median ${big.length ? f2(q(big, 0.5)) : '-'}`, slug === 'sf' ? 'a few low, most middle, a few high (each under 25 %)' : 'reported (denser rows push more up round their low ones)', low > 0 && high > 0 && (slug !== 'sf' || (low < lift.length * 0.25 && high < lift.length * 0.25)));
  report(`${slug}: touching neighbours alike`, `${alike} of ${pairs} pairs under ${LIFT.apart} m apart; closest ${f2(closest)} m`, slug === 'sf' ? '<= 2 % of pairs' : 'reported', slug !== 'sf' || alike <= pairs * 0.02);
  report(`${slug}: a 30 m pass under`, `${pass30} of ${lift.length} (${((pass30 / lift.length) * 100).toFixed(0)} %): the lowest belly the swell, the drift and the lean bring it to 38 m or more over its ground`, slug === 'sf' ? '>= 55 %' : 'reported', slug !== 'sf' || pass30 / lift.length >= 0.55);
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
  const houses = {
    state: new Uint8Array(N), H: new Float32Array(N), margin: new Float32Array(N), tiltM: new Float32Array(N), solid: new Uint8Array(N), base: new Float32Array(N), t0: new Float32Array(N),
    extra: new Float32Array(N), seed: new Float32Array(N), heave: new Float32Array(N), cx: new Float32Array(N), cz: new Float32Array(N), rad: new Float32Array(N), now: 0, tmp: [0, 0, 0, 0],
  };
  houses.dyNow = (i) => {
    if (!houses.state[i]) return 0;
    L.liftAt(houses.now - houses.t0[i], houses.now, houses.H[i], houses.seed[i], houses.cx[i], houses.cz[i], houses.heave[i], houses.tmp);
    return houses.tmp[0];
  };
  houses.dyAt = (i, x, z) => {
    if (!houses.state[i]) return 0;
    const dy = houses.dyNow(i);
    return dy + (x - houses.cx[i]) * houses.tmp[2] + (z - houses.cz[i]) * houses.tmp[3];
  };
  const [x0, z0, x1, z1] = d.rect;
  const c = ts / man.obstN;
  const field = new L.LiftField(Math.floor((x0 - 60) / c) * c, Math.floor((z0 - 60) / c) * c, x1 + 60, z1 + 60, c, world, houses);
  const lifted = d.refs.filter((r) => r.inHood);
  for (const r of lifted) {
    const i = r.index, hg = r.roofY - r.baseY;
    // (the wave's rests where it lifts them, its hash's past its 600)
    houses.H[i] = d.rests.get(i) ?? L.liftRest(r.area, hg, i);
    houses.seed[i] = L.liftSeed(i, 2);
    houses.heave[i] = L.liftHeave(r.area, hg, i);
    houses.margin[i] = L.liftReach(houses.heave[i], r.rad);
    houses.tiltM[i] = L.liftTiltReach(r.rad);
    houses.solid[i] = houses.H[i] - houses.margin[i] < L.LIFT_PASS ? 1 : 0;
    houses.cx[i] = r.cx;
    houses.cz[i] = r.cz;
    houses.rad[i] = r.rad;
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
      if (w.py !== undefined) w.bstep = Math.max(w.bstep ?? 0, Math.abs(f.y - w.py));
      w.py = f.y;
      return true;
    });
    const w = r.worst;
    report('a. under the Ladies at the floor', `${r.under} of ${r.steps} steps under a house; least room to a belly ${f2(w.gap)} m`, 'under some, room >= 0', r.under > 0 && w.gap >= 0);
    // (under a belly the floor is its underside's less 12 m, and the bellies differ by tens of metres and ride the swell: the bus at the floor
    // weaves down under a low one and climbs back under a higher one, on the floor's own spring, never kicked. The floor's steps are reported)
    report('a. no bounce up under them', `vy at most ${f2(w.vy)} m/s; over the ground's 3.5 m by ${f2(w.low)}; the bus's largest step ${f2(w.bstep)} m (the floor's ${f2(w.step)} m)`, "vy <= 8 (the floor spring's climb), >= 0; the bus's step reported", w.vy <= 8 && w.low >= 0);
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
      // (the roofs under it: the high flyers over it are a deck it may be under, the layer isn't flat)
      const t = field.query(f.x, f.z, f.y, baked(f.x, f.z), true);
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
  // the exact tests' world: is the bus's body (its point, nose and tail, 5.1 m tall) in a house as it is drawn now (its footprint grown 1 m, from
  // its belly to its roof where the swell and the lean have them)
  const hgrid = new Map();
  for (const r of lifted) {
    const k = `${Math.floor(r.cx / 64)},${Math.floor(r.cz / 64)}`;
    if (!hgrid.has(k)) hgrid.set(k, []);
    hgrid.get(k).push(r);
  }
  const inFoot = (r, x, z, grow) => {
    for (let k = r.local; k < r.local + r.parts; k++) if (r.b.tier[k] === 0 && ring(r.b, k, x, z) <= grow) return true;
    return false;
  };
  const clips = (f) => {
    let n = 0, which = null;
    // (the body lies along the nose: under ?swerve a skid's slip turns it off the way the bus goes, Flight.heading)
    const nose = f.heading + (f.swerve?.on ? f.swerve.slip : 0);
    for (const o of [0, -6, 6]) {
      const x = f.x + Math.sin(nose) * o, z = f.z - Math.cos(nose) * o;
      const gx = Math.floor(x / 64), gz = Math.floor(z / 64);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          for (const r of hgrid.get(`${gx + dx},${gz + dz}`) ?? []) {
            if ((houses.state[r.index] !== 2 && houses.state[r.index] !== 3) || x < r.x0 - 1 || x > r.x1 + 1 || z < r.z0 - 1 || z > r.z1 + 1 || !inFoot(r, x, z, 1)) continue;
            const dy = houses.dyAt(r.index, x, z);
            if (f.y + 5.1 > r.baseY + dy && f.y < Math.max(r.roofY, houses.extra[r.index]) + dy) {
              n++;
              which = r;
              if (process.env.LIFT_TRACE) console.log(`    clip ${r.index} at o ${o} (${x.toFixed(1)}, ${z.toFixed(1)}) belly ${(r.baseY + dy).toFixed(2)} top ${(Math.max(r.roofY, houses.extra[r.index]) + dy).toFixed(2)} bus ${f.y.toFixed(2)} H ${houses.H[r.index].toFixed(1)} solid ${houses.solid[r.index]} over ${W.overheadAt(f.x, f.z, f.y).toFixed(2)} overAtPt ${W.overheadAt(x, z, f.y).toFixed(2)} bbox ${r.x0.toFixed(1)}..${r.x1.toFixed(1)} ${r.z0.toFixed(1)}..${r.z1.toFixed(1)}`);
            }
          }
    }
    return { n, which };
  };
  /** every run's steps over 3 m (a let down or a lift in one 1/120 s step), for the one line that reports them */
  const jolts = { runs: 0, of: 0, worst: 0, at: null, up: 0, down: 0, worstGHI: 0 };
  let jRuns = 0, jOf = 0;
  const jolt = (name, r) => {
    jolts.of++;
    if (name.startsWith('j ')) {
      jOf++;
      if (r.step > 3) jRuns++;
    } else jolts.worstGHI = Math.max(jolts.worstGHI, r.step);
    if (r.step > 3) jolts.runs++;
    if (r.step > jolts.worst) [jolts.worst, jolts.at] = [r.step, { run: name, ...r.stepAt }];
    jolts.up = Math.max(jolts.up, r.up);
    jolts.down = Math.max(jolts.down, r.down);
  };
  /** one run: from (x, z) at y over the ground on `heading`, held or released, `secs` at 120 Hz, the stick's sy by time; what it met */
  function run(x, z, heading, y0, hold, secs, sy = () => 0, tag = '', clock0 = 20, watch = null, sx = () => 0) {
    const f = new L.Flight();
    f.x = x;
    f.z = z;
    f.heading = heading;
    f.y = groundAt(x, z) + y0;
    houses.now = clock0;
    // (a start inside a floating house is the scan's, not the flight's: back 10 m at a time until it is clear)
    for (let k = 0; k < 20 && clips(f).n; k++) {
      f.x -= Math.sin(heading) * 10;
      f.z += Math.cos(heading) * 10;
    }
    if (hold) f.holdY = f.targetY = f.y;
    let clip = 0, step = 0, up = 0, down = 0, vy = -Infinity, prevY = f.y, first = null, stepAt = null;
    for (let s = 0; s < secs * 120; s++) {
      houses.now = clock0 + s / 120;
      const st = sy(s / 120), sxt = sx(s / 120);
      f.step(1 / 120, { sx: sxt, sy: st, dragging: st !== 0 || sxt !== 0 }, W);
      if (process.env.LIFT_TRACE && process.env.LIFT_TRACE === tag && s % 6 === 0) {
        const g = groundAt(f.x, f.z), c0 = clips(f);
        console.log(`  t ${(s / 120).toFixed(2)} x ${f.x.toFixed(1)} z ${f.z.toFixed(1)} y+ ${(f.y - g).toFixed(1)} vy ${f.vy.toFixed(1)} floor+ ${(f.floorY - g).toFixed(1)} over+ ${(W.overheadAt(f.x, f.z, f.y) - g).toFixed(1)} obst+ ${(W.obstacleAt(f.x, f.z, f.y) - g).toFixed(1)} hard+ ${(W.hardAt(f.x, f.z, f.y) - g).toFixed(1)} clip ${c0.n ? c0.which.index : '-'}`);
      }
      if (process.env.LIFT_TRACE && process.env.LIFT_TRACE === tag && Math.abs(f.y - prevY) > 3) {
        console.log(`  JUMP t ${(s / 120).toFixed(3)} from ${prevY.toFixed(2)} to ${f.y.toFixed(2)} over ${W.overheadAt(f.x, f.z, prevY).toFixed(2)} hard ${W.hardAt(f.x, f.z, prevY).toFixed(2)}`);
        for (const r of lifted) {
          if (Math.hypot(Math.max(r.x0 - f.x, 0, f.x - r.x1), Math.max(r.z0 - f.z, 0, f.z - r.z1)) > 26) continue;
          const dy = houses.dyNow(r.index);
          console.log(`    near ${r.index} dist ${Math.hypot(Math.max(r.x0 - f.x, 0, f.x - r.x1), Math.max(r.z0 - f.z, 0, f.z - r.z1)).toFixed(1)} belly ${(r.baseY + dy).toFixed(1)} top ${(r.roofY + dy).toFixed(1)} solid ${houses.solid[r.index]}`);
        }
      }
      // (the first half second is the start's: the flight puts the bus on its floor)
      if (s < 60) {
        prevY = f.y;
        continue;
      }
      if (Math.abs(f.y - prevY) > step) stepAt = { t: +(s / 120).toFixed(2), x: +f.x.toFixed(1), z: +f.z.toFixed(1), from: +prevY.toFixed(1), to: +f.y.toFixed(1) };
      step = Math.max(step, Math.abs(f.y - prevY));
      up = Math.max(up, f.y - prevY);
      down = Math.max(down, prevY - f.y);
      vy = Math.max(vy, f.vy);
      prevY = f.y;
      watch?.(f);
      const c = clips(f);
      if (c.n) {
        clip++;
        first ??= { t: +(s / 120).toFixed(2), x: +f.x.toFixed(1), z: +f.z.toFixed(1), y: +f.y.toFixed(1), house: c.which.index };
      }
    }
    return { f, clip, step, up, down, vy, first, stepAt };
  }
  // g. a low floating house, an obstacle: the five low ones nearest the heart, each flown at from four sides 150 m out, held at its belly's
  // height plus 4 m (into its walls): over it or round it, never into it, no step up past 3 m
  {
    const [hx, hz] = [(L.squareIx(d.heart) + 0.5) * L.SQUARE, (L.squareIz(d.heart) + 0.5) * L.SQUARE];
    const lows = lifted.filter((r) => houses.solid[r.index]).sort((a, b) => Math.hypot(a.cx - hx, a.cz - hz) - Math.hypot(b.cx - hx, b.cz - hz)).slice(0, 5);
    let runs = 0, clipRuns = 0, clipSteps = 0, over = 0, round = 0, worstStep = 0, firstClip = null;
    let stepAt = null;
    for (const r of lows)
      for (const hd of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const fx = Math.sin(hd), fz = -Math.cos(hd), x = r.cx - fx * 150, z = r.cz - fz * 150;
        let overIt = false, near = Infinity;
        const res = run(x, z, hd, r.baseY + houses.H[r.index] + 4 - groundAt(x, z), true, 9, () => 0, `g${r.index}/${Math.round((hd * 180) / Math.PI)}`, 20, (f) => {
          if (inFoot(r, f.x, f.z, 1) && f.y > Math.max(r.roofY, houses.extra[r.index]) + houses.dyAt(r.index, f.x, f.z)) overIt = true;
          near = Math.min(near, Math.hypot(Math.max(r.x0 - f.x, 0, f.x - r.x1), Math.max(r.z0 - f.z, 0, f.z - r.z1)));
        });
        runs++;
        if (res.clip) {
          clipRuns++;
          firstClip ??= { house: r.index, heading: Math.round((hd * 180) / Math.PI), ...res.first };
        }
        clipSteps += res.clip;
        jolt(`g ${r.index} ${Math.round((hd * 180) / Math.PI)}`, res);
        if (res.step > worstStep) stepAt = { house: r.index, heading: Math.round((hd * 180) / Math.PI), ...res.stepAt };
        worstStep = Math.max(worstStep, res.step);
        if (overIt) over++;
        else if (near > 0) round++;
      }
    report('g. at a low floating house', `${lows.length} houses (rests ${lows.map((r) => f2(houses.H[r.index])).join(', ')} m), ${runs} runs: ${over} over it, ${round} round it, ${clipRuns} runs into it (${clipSteps} steps)${firstClip ? ` first ${JSON.stringify(firstClip)}` : ''}; largest step ${f2(worstStep)} m`, 'never into it', clipRuns === 0);
  }
  // h. a dive through the bobbing layer: from 130 m over the Ladies' street, held, then the stick pushed for 6 s
  {
    let clip = 0, step = 0, end = [];
    for (const c0 of [0, 3, 6, 20]) {
      const r = run(sx0, sz0, 0, 130, true, 9, (t) => (t >= 1 ? 1 : 0), `h${c0}`, c0);
      jolt(`h ${c0}`, r);
      clip += r.clip;
      step = Math.max(step, r.step);
      end.push(f2(r.f.y - groundAt(r.f.x, r.f.z)));
    }
    report('h. a dive through the layer', `4 dives (the swell at four moments): ${clip} steps in a drawn house; largest step ${f2(step)} m; ended ${end.join(', ')} m over the ground`, 'never in one', clip === 0);
  }
  // f2. the pull up, through the exact test
  {
    let clip = 0, step = 0, end = [], first = null;
    for (const c0 of [0, 3, 6, 20]) {
      const r = run(sx0, sz0, 0, 24, true, 10, (t) => (t >= 3 ? -1 : 0), `f2${c0}`, c0);
      jolt(`f2 ${c0}`, r);
      clip += r.clip;
      first ??= r.first;
      step = Math.max(step, r.step);
      end.push(f2(r.f.y - groundAt(r.f.x, r.f.z)));
    }
    report('f2. the pull up, exactly', `4 pulls (the swell at four moments): ${clip} steps in a drawn house${first ? ` first ${JSON.stringify(first)}` : ''}; largest step ${f2(step)} m; ended ${end.join(', ')} m over the ground`, 'never in one', clip === 0);
  }
  // i. a scan through the layer (and the same with every house down, for the flight's own steps and climbs over a grounded city): from 450 m out (outside the neighbourhood), eight headings in at the heart and on, held at 12, 22, 34 and 50 m, 18 s each; and released at 30 m
  for (const up of [true, false]) {
    for (const r of lifted) houses.state[r.index] = up ? 2 : 0;
    const [hx, hz] = [(L.squareIx(d.heart) + 0.5) * L.SQUARE, (L.squareIz(d.heart) + 0.5) * L.SQUARE];
    let runs = 0, clipRuns = 0, clipSteps = 0, step = 0, vy = -Infinity, firsts = [], stepRun = null;
    for (let a = 0; a < 8; a++) {
      const hd = (a / 8) * Math.PI * 2, fx = Math.sin(hd), fz = -Math.cos(hd);
      for (const [y0, hold] of [[12, true], [22, true], [34, true], [50, true], [30, false]]) {
        const r = run(hx - fx * 450, hz - fz * 450, hd, y0, hold, 18, () => 0, `${a * 45}/${y0}`);
        runs++;
        clipSteps += r.clip;
        if (r.clip) {
          clipRuns++;
          if (firsts.length < 3) firsts.push({ heading: a * 45, y0, hold, ...r.first });
        }
        if (up) jolt(`i ${a * 45} ${y0}${hold ? '' : ' released'}`, r);
        if (r.step > step) stepRun = { heading: a * 45, y0, hold, ...r.stepAt };
        step = Math.max(step, r.step);
        vy = Math.max(vy, r.vy);
      }
    }
    report(up ? 'i. a scan through the layer' : 'i0. the same scan, every house down', `${runs} runs, ${clipRuns} with a step in a drawn house (${clipSteps} steps)${firsts.length ? ` first ${JSON.stringify(firsts)}` : ''}; largest step ${f2(step)} m (${JSON.stringify(stepRun)}); vy at most ${f2(vy)} m/s (from 0.5 s on)`, up ? 'never in one' : 'reported', !up || clipRuns === 0);
    for (const r of lifted) houses.state[r.index] = 2;
  }
  // j. a weave beside the floating houses at the height of their walls, as a thumb flies it (the fly-through's 11.2 m lift in one frame beside a
  // low one, the review's 7.85 m let-down beside one that passes over): the twelve low ones and the twelve others nearest the heart, passed from
  // 400 m out on four headings (into the layer from outside it, as the scan does) 4 and 12 m off their bounds, held at their walls' middle, the
  // stick swinging the bus in and out every 2.4 s
  {
    const [hx, hz] = [(L.squareIx(d.heart) + 0.5) * L.SQUARE, (L.squareIz(d.heart) + 0.5) * L.SQUARE];
    const near = (a, b) => Math.hypot(a.cx - hx, a.cz - hz) - Math.hypot(b.cx - hx, b.cz - hz);
    const pick = [...lifted.filter((r) => houses.solid[r.index]).sort(near).slice(0, 12), ...lifted.filter((r) => !houses.solid[r.index]).sort(near).slice(0, 12)];
    let runs = 0, clipRuns = 0, clipSteps = 0, up = 0, down = 0, over3 = 0, firstClip = null, worst = null;
    for (const r of pick)
      for (const hd of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
        for (const side of [4, 12]) {
          const fx = Math.sin(hd), fz = -Math.cos(hd), half = Math.abs(fx) > 0.5 ? (r.z1 - r.z0) / 2 : (r.x1 - r.x0) / 2;
          const lat = half + side + 2.5, x = r.cx - fx * 400 - fz * lat, z = r.cz - fz * 400 + fx * lat;
          const mid = r.baseY + houses.H[r.index] + (r.roofY - r.baseY) / 2;
          const res = run(x, z, hd, mid - groundAt(x, z), true, 17, () => 0, `j${r.index}/${Math.round((hd * 180) / Math.PI)}/${side}`, 20 + runs * 0.37, null, (t) => 0.55 * Math.sin((t * Math.PI * 2) / 2.4));
          runs++;
          if (res.clip) {
            clipRuns++;
            firstClip ??= { house: r.index, heading: Math.round((hd * 180) / Math.PI), side, ...res.first };
          }
          clipSteps += res.clip;
          jolt(`j ${r.index} ${Math.round((hd * 180) / Math.PI)} ${side}`, res);
          if (process.env.LIFT_JLIST && (res.clip || res.step > 3)) console.log(`  j ${r.index} solid ${houses.solid[r.index]} hd ${Math.round((hd * 180) / Math.PI)} side ${side} held+ ${f2(mid - groundAt(x, z))} clip ${res.clip} first ${JSON.stringify(res.first)} up ${f2(res.up)} down ${f2(res.down)} at ${JSON.stringify(res.stepAt)}`);
          if (res.step > 3) over3++;
          if (!worst || res.step > worst.step) worst = { step: +res.step.toFixed(2), house: r.index, solid: houses.solid[r.index], heading: Math.round((hd * 180) / Math.PI), side, ...res.stepAt };
          up = Math.max(up, res.up);
          down = Math.max(down, res.down);
        }
    // (a known risk, LIFT.md: inside the layer at the height of its walls, a house to go over beside one to go under with no room between them,
    // the 2.5D flight has no height to be at. Before the fixes of the review's let-down the same runs had 9 into one and 25 over 3 m)
    report("j. a weave beside them at their walls' height", `${runs} runs past ${pick.length} houses: ${clipRuns} into one (${clipSteps} steps)${firstClip ? ` first ${JSON.stringify(firstClip)}` : ''}; ${over3} with a step over 3 m; largest step up ${f2(up)} m, down ${f2(down)} m (${JSON.stringify(worst)})`, 'reported: a known risk (never into one is the aim)', true);
  }
  // (the review's let-down: beside a floating house at the height of its middle, a house heaving past the bus's height turned to go under while
  // its counted belly was already under the bus, 7.85 m in one step in g. LiftField.side now turns it only while that can't happen: g, h, f2
  // and i hold under 3 m. j's are the layer's known risk, reported with it)
  report("the flight's jolts, g h f2 i", `${jolts.runs - jRuns} of ${jolts.of - jOf} runs have a step over 3 m in 1/120 s; the largest ${f2(jolts.worstGHI)} m`, '<= 3 m (it was 7.85, 7 runs)', jolts.worstGHI <= 3);
  report("the flight's jolts, all", `${jolts.runs} of ${jolts.of} runs (g, h, f2, i, j) have a step over 3 m in 1/120 s; the largest ${f2(jolts.worst)} m (${JSON.stringify(jolts.at)}); up at most ${f2(jolts.up)} m, down ${f2(jolts.down)} m`, 'reported: j is a known risk', true);

  // ---------------------------------------------------------------- 4t. --take: the real Flight under a square that falls, and one that cracks
  // (LIFT.md, "Taking it: the looks"). The square of Alamo Square with the most floating houses; the Lift's own holds (fallBlocked, crackBlocked)
  // with the bus's real half length (8 m) and a chase lens 14 m behind it and 5 m up; its fall's order out from the square's middle; a crack's
  // sink with its `solid` and look ahead as the Lift has them. Flown in from four sides at a held 20 and 60 m, at Cruise, Express and Nonstop's
  // speeds, at 20 and 60 frames a second: never a step with the bus's body in a drawn house, and at 20 fps no step over 1.5 m a frame
  if (process.argv.includes('--take')) {
    const bySq = new Map();
    for (const r of lifted) {
      const k = L.squareKey(Math.floor(r.cx / L.SQUARE), Math.floor(r.cz / L.SQUARE));
      if (!bySq.has(k)) bySq.set(k, []);
      bySq.get(k).push(r);
    }
    const [sqKey, sqRefs] = [...bySq].sort((a, b) => b[1].length - a[1].length)[0];
    const scx = (L.squareIx(sqKey) + 0.5) * L.SQUARE, scz = (L.squareIz(sqKey) + 0.5) * L.SQUARE;
    const inSq = new Uint8Array(N);
    const byIndex = new Map(sqRefs.map((r) => [r.index, r]));
    for (const r of sqRefs) inSq[r.index] = 1;
    const fallT = new Float64Array(N);
    const take = { crack: 0, lx: 0, lz: 0 };
    houses.look = new Float32Array(N);
    // (the Lift's motion: its square's crack and list, a falling house's seconds into its fall)
    houses.dyNow = (i) => {
      const st = houses.state[i];
      if (!st) return 0;
      const q = inSq[i];
      L.liftAt(houses.now - houses.t0[i], houses.now, houses.H[i], houses.seed[i], houses.cx[i], houses.cz[i], houses.heave[i], houses.tmp, st === 3 ? houses.now - fallT[i] : -1, q ? take.crack : 0, q ? take.lx : 0, q ? take.lz : 0);
      return houses.tmp[0];
    };
    const topOf = (r) => Math.max(r.roofY + 6, houses.extra[r.index]) + houses.H[r.index] * 1.14 + houses.margin[r.index];
    const SPEEDS = [['Cruise', 0], ['Express', L.config.flight.surgeSpeed], ['Nonstop', L.config.turbo.nonstopSpeed]];
    const SIDES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    /** one run: in from `side` toward the square's middle (or `at`), held at y0 over the ground; at `hitAt` m from it the square's hit lands */
    // (turn, --swerve: the handling on (Flight.swerve.on) and a thumb out to one side from `lead` m before the hit's line: { kind: 'hard' (124 px, held),
    // 'skid' (172 px, held till the nose is half round, then lifted), dir +1 right or -1 left }. Input's own parts with the glass's room to spare:
    // hard (px - 78) / 42, skid px - 138; the stick's sx as Input.applyStretch gives it, tools/swerve/s_turns.ts's stickOf)
    const stickOf = (dx) => {
      const F = L.config.flight, px = F.stretchPx, d = Math.min(Math.abs(dx), 2.2 * px);
      if (d <= F.deadZonePx) return 0;
      const s0 = (d - F.deadZonePx) / px, r = 1 - 0.72;
      return Math.sign(dx) * (s0 <= 0.72 ? s0 : 0.72 + r * Math.tanh((s0 - 0.72) / r));
    };
    // (win, --swerve: the take's own window [from, to] (game s from the run's start), from the hit to a second after the last of its houses landed or
    // its crack's sink has gone; the run with no hit is counted over the take's. A held hard turn circles in the layer for the whole run, the layer's own
    // known risk (j.), and two circling paths a fall's floor apart drift apart after it: one run "sent" the bus into a house 12 s after the last landing)
    function takeRun(mode, side, y0, speed, fps, at = [scx, scz], turn = null, win = null) {
      for (const r of lifted) {
        houses.state[r.index] = 2;
        houses.t0[r.index] = -20;
        houses.solid[r.index] = houses.H[r.index] - houses.margin[r.index] < L.LIFT_PASS ? 1 : 0;
      }
      houses.look.fill(0);
      take.crack = 0;
      take.lx = take.lz = 0;
      // (the field's sides, over or under each house, are remembered for 0.4 s of the game clock: every run starts at the same clock, so a run
      // and its base would inherit the run before's)
      field.sides = field.sideT = null;
      const dt = 1 / fps, f = new L.Flight();
      f.swerve.on = !!turn;
      // (heading h flies along (sin h, -cos h), Flight's)
      f.heading = side;
      const back = 120 + speed * 1.2;
      f.x = at[0] - Math.sin(side) * back;
      f.z = at[1] + Math.cos(side) * back;
      f.y = groundAt(f.x, f.z) + y0;
      f.holdY = f.targetY = f.y;
      if (speed) {
        f.speed = speed;
        f.turbo.speed = speed;
        f.turbo.rate = 4;
      }
      houses.now = 20;
      const queue = new Map();
      let hit = -1, sinkWait = false, lookUntil = -1, clip = 0, first = null, step = 0, stepAt = null, held = 0, started = 0, landed = 0, prevY = f.y, n = 0;
      let clipSq = 0, firstSq = null, stepSq = 0, stepSqAt = null, clipWin = 0, winFirst = null, w0 = Infinity, w1 = -Infinity;
      // (--swerve: the thumb's state, the most slip (rad), and at the most slip the angle (rad) of the step's travel off the heading and off the nose)
      let thumb = false, letGo = false, slip = 0, offHead = 0, offNose = 0, h0 = side;
      const secs = (back + 260) / Math.max(30, speed) + 6;
      for (let s = 0; s * dt < secs; s++) {
        houses.now = 20 + s * dt;
        const now = houses.now;
        if (!turn) f.step(dt, { sx: 0, sy: 0, dragging: false }, W);
        else {
          const px0 = f.x, pz0 = f.z;
          if (!thumb && !letGo && (at[0] - f.x) * Math.sin(f.heading) + (at[1] - f.z) * -Math.cos(f.heading) < 40 + turn.lead) [thumb, h0] = [true, f.heading];
          const nose = f.heading + f.swerve.slip;
          if (thumb && turn.kind === 'skid' && Math.abs(nose - h0) >= Math.PI) [thumb, letGo] = [false, true];
          const px = turn.kind === 'skid' ? 172 : 124;
          // (in steps of at most 1/120 s, as main.ts steps the flight: the hard part's stiffer bungee in one 1/20 s step ran the heading away, to 10^76
          // degrees in 8 s, the bus pinned in place, and every row "sent" it into a house it was only spinning in)
          const sub = Math.max(1, Math.ceil(dt * 120 - 1e-9));
          for (let q = 0; q < sub; q++) f.step(dt / sub, thumb ? { sx: turn.dir * stickOf(px), sy: 0, dragging: true, hard: Math.min(1, Math.max(0, (px - 78) / 42)), skid: px - 138, side: turn.dir, frame: dt } : { sx: 0, sy: 0, dragging: false, frame: dt }, W);
          const mx = f.x - px0, mz = f.z - pz0, ml = Math.hypot(mx, mz);
          if (ml > 1e-6 && Math.abs(f.swerve.slip) > slip) {
            slip = Math.abs(f.swerve.slip);
            const tr = Math.atan2(mx, -mz), w = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
            offHead = w(tr - f.heading);
            offNose = w(tr - f.heading - f.swerve.slip);
          }
        }
        // (the Lift's hold reads the bus's way and its ground speed, as main.ts hands them over (liftBus.fx, lift.busSpeed): the way it goes, not its nose)
        const fx = Math.sin(f.heading), fz = -Math.cos(f.heading), sp = f.speed;
        const cam = [f.x - fx * 14, f.y + 5, f.z - fz * 14];
        // the hit: as the bus comes within 40 m of passing the middle abeam (a crack's impact, or the fall's: the strings cut from the
        // middle); none on the same run flown with no hit, the base it is held to
        if (mode !== 'none' && hit < 0 && (at[0] - f.x) * fx + (at[1] - f.z) * fz < 40) {
          hit = now;
          w0 = now - 20;
          if (mode === 'fall') {
            for (const r of sqRefs) queue.set(r.index, now + Math.hypot(r.cx - scx, r.cz - scz) / L.LIFT_FALL.front + L.LIFT_FALL.jitter * L.liftSeed(r.index, 5));
          } else {
            sinkWait = true;
            const a = Math.atan2(scz - f.z, scx - f.x);
            take.lx = Math.cos(a);
            take.lz = Math.sin(a);
          }
        }
        if (sinkWait) {
          let h = false;
          for (const r of sqRefs) {
            if (houses.state[r.index] !== 2) continue;
            if (L.crackBlocked(r.x0, r.z0, r.x1, r.z1, r.baseY + houses.dyNow(r.index), topOf(r), L.crackSinkOf(houses.H[r.index]), houses.margin[r.index], f.x, f.y, f.z, fx, fz, 8, sp, cam[0], cam[1], cam[2])) {
              h = true;
              break;
            }
          }
          if (h) held++;
          else {
            sinkWait = false;
            take.crack = now;
            lookUntil = now + 2;
            w1 = Math.max(w1, now - 20 + 3);
            for (const r of sqRefs) houses.solid[r.index] = L.liftLow(houses.H[r.index] - L.crackSinkOf(houses.H[r.index]), houses.margin[r.index]) ? 1 : 0;
          }
        }
        for (const r of sqRefs) houses.look[r.index] = now < lookUntil ? 10 * dt : 0;
        for (const [i, t] of queue) {
          const r = byIndex.get(i);
          if (houses.state[i] === 3) {
            if (now - fallT[i] >= L.fallEnds(houses.H[i])) {
              houses.state[i] = 0;
              field.reach(r.x0, r.z0, r.x1, r.z1);
              queue.delete(i);
              landed++;
              w1 = Math.max(w1, now - 20 + 1);
            }
            continue;
          }
          if (now < t) continue;
          if (L.fallBlocked(r.x0, r.z0, r.x1, r.z1, topOf(r), houses.margin[r.index], f.x, f.y, f.z, fx, fz, 8, sp, cam[0], cam[1], cam[2], L.takeLead(houses.H[r.index]))) {
            held++;
            continue;
          }
          houses.state[i] = 3;
          fallT[i] = now;
          started++;
        }
        if (s * dt < 0.5) {
          prevY = f.y;
          continue;
        }
        n++;
        const c = clips(f);
        // (over the square or within 40 m of it, where its houses fall or sink)
        const near = Math.max(Math.abs(f.x - scx), Math.abs(f.z - scz)) < L.SQUARE / 2 + 40, dyf = Math.abs(f.y - prevY);
        const where = { t: +(now - 20).toFixed(2), from: +prevY.toFixed(1), to: +f.y.toFixed(1) };
        if (dyf > step) [step, stepAt] = [dyf, where];
        if (near && dyf > stepSq) [stepSq, stepSqAt] = [dyf, where];
        prevY = f.y;
        if (c.n && !inSq[c.which.index] && now - 20 >= (win ? win[0] : w0) && now - 20 <= (win ? win[1] : w1)) {
          clipWin++;
          winFirst ??= { t: +(now - 20).toFixed(2), x: +f.x.toFixed(1), z: +f.z.toFixed(1), y: +f.y.toFixed(1), house: c.which.index, state: houses.state[c.which.index] };
        }
        if (c.n) {
          const w = { t: +(now - 20).toFixed(2), x: +f.x.toFixed(1), z: +f.z.toFixed(1), y: +f.y.toFixed(1), house: c.which.index, state: houses.state[c.which.index] };
          clip++;
          first ??= w;
          if (inSq[c.which.index]) {
            clipSq++;
            firstSq ??= w;
          }
        }
      }
      // (a crack still sinking at the run's end: its window to the end)
      if (w0 < Infinity && w1 < w0) w1 = Infinity;
      return { clip, first, step, stepAt, clipSq, firstSq, stepSq, stepSqAt, clipWin, winFirst, win: [w0, w1], held, started, landed, hit: hit >= 0, sunk: take.crack > 0, steps: n, slip, offHead, offNose, turned: Math.abs(Math.atan2(Math.sin(f.heading - side), Math.cos(f.heading - side))) };
    }
    // (each run is held to the same run flown with no hit: the flight in the layer at a held 60 m has its own known steps, j. above. What
    // counts is what the take adds on its square's houses: a step in one of them the base hasn't, and over the square or within 40 m of it a
    // step at 20 fps over 1.5 m and larger than the base's largest there. A run whose path the take changed into another square's floating
    // house fails too, its steps reported apart: the review of the take found one passed (5 steps in a neighbour's house and a 6.43 m step,
    // the same run with no hit 0 and 2.46 m), and design C12 asks for none. A larger step away from the square with the body in no house is
    // reported: there the layer's own let-downs at a held 60 m pass 1.5 m with no hit at all (j.), and a take that moves the falls by a frame
    // moves them by a metre either way)
    const sum = (mode, at, turn = null) => {
      const o = { slip: 0, offHead: 0, offNose: 0, turned: Infinity, runs: 0, added: 0, first: null, clip: 0, baseClip: 0, step20: 0, at20: null, base20: 0, over: 0, held: 0, started: 0, landed: 0, nohit: 0, sunk: 0, later: 0, laterFirst: null, away: 0, awayFirst: null, awayStep: 0 };
      for (const side of SIDES)
        for (const y0 of [20, 60])
          for (const [name, speed] of SPEEDS) {
            if (speed > 200 && y0 < 60) continue;
            for (const fps of [20, 60]) {
              const tn = turn && { ...turn, lead: turn.kind === 'skid' ? 60 + speed * 0.4 : 40 + speed * 0.6 };
              const r = takeRun(mode, side, y0, speed, fps, at, tn), b = takeRun('none', side, y0, speed, fps, at, tn, tn ? r.win : null);
              if (r.slip > o.slip) [o.slip, o.offHead, o.offNose] = [r.slip, r.offHead, r.offNose];
              o.turned = Math.min(o.turned, r.turned);
              const tag = { side: Math.round((side * 180) / Math.PI), y0, gear: name, fps };
              o.runs++;
              o.clip += r.clipSq;
              o.baseClip += b.clipSq;
              if (r.clipSq > b.clipSq) {
                o.added++;
                o.first ??= { ...tag, steps: r.clipSq, base: b.clipSq, ...r.firstSq };
              }
              // (a run the take sent into another square's floating house: the take's too, its steps reported apart)
              // (--swerve: counted in the take's window, the whole run's reported)
              const sent = tn ? r.clipWin > b.clipWin : r.clip - r.clipSq > b.clip - b.clipSq;
              if (tn && r.clip - r.clipSq > b.clip - b.clipSq) {
                o.later++;
                o.laterFirst ??= { ...tag, steps: r.clip - r.clipSq, base: b.clip - b.clipSq, ...r.first, win: r.win.map((v) => +v.toFixed(2)) };
              }
              if (sent) {
                o.away++;
                o.awayFirst ??= tn ? { ...tag, steps: r.clipWin, base: b.clipWin, ...r.winFirst, win: r.win.map((v) => +v.toFixed(2)) } : { ...tag, steps: r.clip - r.clipSq, base: b.clip - b.clipSq, ...r.first, step: +r.step.toFixed(2), baseStep: +b.step.toFixed(2) };
              }
              if (fps === 20) {
                if (r.stepSq > 1.5 && r.stepSq > b.stepSq + 0.01) {
                  o.over++;
                  if (r.stepSq - b.stepSq > o.step20 - o.base20) [o.step20, o.base20, o.at20] = [r.stepSq, b.stepSq, { ...tag, ...r.stepSqAt }];
                }
                if (r.step > 1.5 && r.step > b.step + 0.01) {
                  o.awayStep++;
                  o.awayStepAt ??= { ...tag, step: +r.step.toFixed(2), baseStep: +b.step.toFixed(2), ...r.stepAt };
                }
              }
              o.held += r.held;
              o.started += r.started;
              o.landed += r.landed;
              if (!r.hit) o.nohit++;
              if (r.sunk) o.sunk++;
            }
          }
      return o;
    };
    const a = sum('fall');
    report(`t1. under a falling square (${sqRefs.length} houses, its middle ${f2(scx)}, ${f2(scz)})`, `${a.runs} runs: ${a.added} where the fall adds steps with the body in one of its houses${a.first ? ` first ${JSON.stringify(a.first)}` : ''} (${a.clip} such steps, ${a.baseClip} in the same runs with no hit); ${a.started} falls started, ${a.landed} landed, ${a.held} frames held; ${a.nohit} runs never hit`, 'none added; falls started and landed; every run hit', a.added === 0 && a.started > 0 && a.landed === a.started && a.nohit === 0);
    report('t1. its steps at 20 fps', `${a.over} runs with a step over 1.5 m a frame by the square larger than the same run's with no hit${a.at20 ? `, the most ${f2(a.step20)} m against ${f2(a.base20)} (${JSON.stringify(a.at20)})` : ''}`, 'none', a.over === 0);
    // (b) under the square's lowest house the flight passes under, as the crack lands
    const pass = sqRefs.filter((r) => !houses.solid[r.index]), clear = (r) => houses.H[r.index] - houses.margin[r.index];
    const low = (pass.length ? pass : sqRefs).slice().sort((p, q) => clear(p) - clear(q))[0];
    const b = sum('crack', [low.cx, low.cz]);
    report(`t2. under its lowest passable house (${low.index}, rest ${f2(houses.H[low.index])} m) as the crack lands`, `${b.runs} runs: ${b.added} where the crack adds steps with the body in one of its houses${b.first ? ` first ${JSON.stringify(b.first)}` : ''} (${b.clip} such steps, ${b.baseClip} with no hit); ${b.sunk} sank, ${b.held} frames held; ${b.nohit} runs never hit`, 'none added; sinks happen; every run hit', b.added === 0 && b.sunk > 0 && b.nohit === 0);
    for (const [k, o] of [['t1', a], ['t2', b]])
      report(`${k}. away from the square, on a path the take changed`, `${o.away} runs with more steps in another square's floating house${o.awayFirst ? ` first ${JSON.stringify(o.awayFirst)}` : ''}; ${o.awayStep} with a larger step over 1.5 m at 20 fps anywhere${o.awayStepAt ? ` first ${JSON.stringify(o.awayStepAt)}` : ''}`, "none in a house; the steps reported (the layer's known risk, j.)", o.away === 0);
    report('t2. its steps at 20 fps', `${b.over} runs with a step over 1.5 m a frame by the square larger than the same run's with no hit${b.at20 ? `, the most ${f2(b.step20)} m against ${f2(b.base20)} (${JSON.stringify(b.at20)})` : ''}`, 'none', b.over === 0);
    // ---- --swerve: the same runs with the handling on (?swerve, the one link's), the thumb out to a side as the bus comes to the hit's line: a skid's
    // half turn (the nose round 180 degrees, then let go) and a hard turn held, right and left. The Lift's holds read the bus's way and its ground speed
    // (main.ts), and in a skid the bus goes its way, not its nose's: the step's travel along the heading, off the nose by the slip. Never a step with the
    // body (along the nose) in a drawn house the same run with no hit hasn't
    if (process.argv.includes('--swerve'))
      for (const kind of ['skid', 'hard'])
        for (const dir of [1, -1]) {
          const tag = `${kind} ${dir > 0 ? 'right' : 'left'}`;
          for (const [k, mode, at] of [['t1s', 'fall', undefined], ['t2s', 'crack', [low.cx, low.cz]]]) {
            const o = sum(mode, at, { kind, dir });
            report(`${k}. ${mode === 'fall' ? 'under the falling square' : 'under its lowest passable house as the crack lands'}, the handling on, a ${tag}`, `${o.runs} runs: ${o.added} where the take adds steps with the body in one of its houses${o.first ? ` first ${JSON.stringify(o.first)}` : ''} (${o.clip}, ${o.baseClip} with no hit); ${o.away} sent into another square's house while the take moves${o.awayFirst ? ` first ${JSON.stringify(o.awayFirst)}` : ''} (${o.later} with more such steps over the whole run, reported${o.laterFirst ? ` first ${JSON.stringify(o.laterFirst)}` : ''}); ${o.over} with a larger step by the square over 1.5 m at 20 fps${o.at20 ? ` the most ${f2(o.step20)} m against ${f2(o.base20)} (${JSON.stringify(o.at20)})` : ''}; ${mode === 'fall' ? `${o.started} falls started, ${o.landed} landed` : `${o.sunk} sank`}, ${o.held} frames held; ${o.nohit} never hit; the least turn ${f2((o.turned * 180) / Math.PI)} degrees`,
              'none added, none sent, no larger step; every run hit', o.added === 0 && o.away === 0 && o.over === 0 && o.nohit === 0 && (mode === 'fall' ? o.started > 0 && o.landed === o.started : o.sunk > 0));
            if (kind === 'skid' && k === 't1s')
              report(`t1s. in the ${tag}, the bus goes its way, not its nose's`, `at the most slip, ${f2((o.slip * 180) / Math.PI)} degrees: the step's travel ${f2((o.offHead * 180) / Math.PI)} degrees off the heading (what the hold reads), ${f2((o.offNose * 180) / Math.PI)} off the nose`, 'a slip over 30 degrees; the travel within 2 of the heading, the slip off the nose within 2', o.slip > (30 * Math.PI) / 180 && o.offHead < (2 * Math.PI) / 180 && Math.abs(o.offNose - o.slip) < (2 * Math.PI) / 180);
          }
        }
  }
}

// ------------------------------------------------------------------ 5. --gpu: the motion's GLSL on this machine's GPU against the TypeScript
if (process.argv.includes('--gpu')) {
  const { chromium } = await import('playwright-core');
  const { browserOptions } = await import(pathToFileURL(`${root}/tools/browser.mjs`).href);
  // 4,096 samples: every phase (before the crouch, the crouch, the launch, the overshoot, the swell), five heights, three heaves, centres a few
  // km apart, points of the house off its centre (dx, dz) and up it (hgt) for the lean; and the take's motion on them (mode 2)
  const N = 4096, inp = new Float32Array(N * 4 * 4);
  const rnd = (k, s) => {
    const x = Math.sin(k * 12.9898 + s * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let k = 0; k < N; k++) {
    const t = -0.2 + 14 * rnd(k, 1), now = 300 + 900 * rnd(k, 2), H = [9, 15, 38, 62, 94][k % 5], sb = rnd(k, 3);
    const cx = -3000 + 6000 * rnd(k, 4), cz = -3000 + 6000 * rnd(k, 5), hv = 1.2 + 2.4 * rnd(k, 6);
    const dx = -12 + 24 * rnd(k, 7), dz = -12 + 24 * rnd(k, 8), gy = 20 + 80 * rnd(k, 9), hg = 14 * rnd(k, 10);
    inp.set([t, now, H, sb], k * 4);
    inp.set([cx, cz, hv, dx], (N + k) * 4);
    inp.set([dz, gy, hg, 0], (2 * N + k) * 4);
    // (the take's, mode 2: a fall 0 to 2.6 s in or none, a crack 0 to 3 s old, a heal 0 to 2.5 s old or none, the list's way; one in eight a flinch)
    const fl = rnd(k, 11) < 0.5 ? -1 : 2.6 * rnd(k, 12), r = rnd(k, 13), ck = r < 0.3 ? 0 : r < 0.7 ? now - 3 * rnd(k, 14) : -(now - 2.5 * rnd(k, 14)), la = 6.2832 * rnd(k, 15);
    inp.set([fl, ck, Math.cos(la), Math.sin(la)], (3 * N + k) * 4);
  }
  const fs = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform float uTime;
${L.GLSL_LIFT}
uniform highp sampler2D tIn;
uniform int uMode;
out vec4 o;
void main() {
  int k = int(gl_FragCoord.x) + int(gl_FragCoord.y) * 64;
  vec4 a = texelFetch(tIn, ivec2(k, 0), 0), b = texelFetch(tIn, ivec2(k, 1), 0), c = texelFetch(tIn, ivec2(k, 2), 0), d = texelFetch(tIn, ivec2(k, 3), 0);
  vec4 lf = a.x < 0.0 ? vec4(0.0) : sbLiftAt(a.x, a.y, a.z, a.w, b.xy, b.z);
  if (uMode == 0) { o = lf; return; }
  if (uMode == 2) { o = a.x < 0.0 ? vec4(0.0) : sbLiftAt(max(a.x, 0.31), a.y, k % 8 == 0 ? -1.0 : a.z, a.w, b.xy, b.z, d.x, d.y, d.zw); return; }
  vec4 T2 = vec4(b.x, c.y, b.y, b.z);
  vec3 p = sbLiftMove(vec3(b.x + b.w, c.y + c.z, b.y + c.x), c.y, lf, T2);
  o = vec4(p - vec3(b.x, 0.0, b.y), 0.0);
}`;
  const browser = await chromium.launch(browserOptions([]));
  const page = await browser.newPage();
  const res = await page.evaluate(
    ({ fs, inp, N }) => {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl2');
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) return { error: 'no WebGL2 float target' };
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, '#version 300 es\nvoid main() { vec2 p = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 4.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }'));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return { error: gl.getProgramInfoLog(pr) };
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, 4, 0, gl.RGBA, gl.FLOAT, new Float32Array(inp));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const rt = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, rt);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, 64, 0, gl.RGBA, gl.FLOAT, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
      gl.viewport(0, 0, 64, 64);
      gl.useProgram(pr);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(pr, 'tIn'), 0);
      const out = [];
      for (const mode of [0, 1, 2]) {
        gl.uniform1i(gl.getUniformLocation(pr, 'uMode'), mode);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const px = new Float32Array(64 * 64 * 4);
        gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.FLOAT, px);
        out.push(Array.from(px));
      }
      return { out, renderer: gl.getParameter(gl.RENDERER) };
    },
    { fs, inp: Array.from(inp), N },
  );
  await browser.close();
  if (res.error) report('GLSL on the GPU', res.error, 'compiles and runs', false);
  else {
    const o = [0, 0, 0, 0];
    let dDy = 0, dSq = 0, dLean = 0, dAim = 0, at = null;
    for (let k = 0; k < N; k++) {
      const [t, now, H, sb] = inp.subarray(k * 4, k * 4 + 4), [cx, cz, hv, dx] = inp.subarray((N + k) * 4, (N + k) * 4 + 4), [dz, gy, hg] = inp.subarray((2 * N + k) * 4, (2 * N + k) * 4 + 3);
      L.liftAt(t, now, H, sb, cx, cz, hv, o);
      const g = res.out[0].slice(k * 4, k * 4 + 4), m = res.out[1].slice(k * 4, k * 4 + 4);
      if (Math.abs(g[0] - o[0]) > dDy) [dDy, at] = [Math.abs(g[0] - o[0]), { t: +t.toFixed(3), H }];
      dSq = Math.max(dSq, Math.abs(g[1] - o[1]));
      dLean = Math.max(dLean, Math.abs(g[2] - o[2]), Math.abs(g[3] - o[3]));
      // (the aim's linear lean, Lift.dyAt: a point dx, dz off the centre is dx * lean x + dz * lean z higher; the drawn turns it about the belly's middle)
      const aimY = gy + hg * (1 + o[1]) + o[0] + dx * o[2] + dz * o[3];
      dAim = Math.max(dAim, Math.abs(m[1] - aimY));
    }
    report('GLSL on the GPU', `${res.renderer}: ${N} samples, dy within ${(dDy * 1000).toFixed(2)} mm (worst at ${JSON.stringify(at)}), the stretch within ${dSq.toExponential(1)}, the lean within ${dLean.toExponential(1)}`, 'dy <= 5 mm, the lean <= 1e-4', dDy <= 0.005 && dLean <= 1e-4);
    // (mode 2, the take's motion: the fall, the crack's sink, jolt and list, the heal, the flinch, against liftAt with the same)
    let tDy = 0, tSq = 0, tLean = 0, tAt = null;
    for (let k = 0; k < N; k++) {
      const [t, now, H, sb] = inp.subarray(k * 4, k * 4 + 4), [cx, cz, hv] = inp.subarray((N + k) * 4, (N + k) * 4 + 3), [fl, ck, lx, lz] = inp.subarray((3 * N + k) * 4, (3 * N + k) * 4 + 4);
      if (t < 0) continue;
      L.liftAt(Math.max(t, 0.31), now, k % 8 === 0 ? -1 : H, sb, cx, cz, hv, o, fl, ck, lx, lz);
      const g = res.out[2].slice(k * 4, k * 4 + 4);
      if (Math.abs(g[0] - o[0]) > tDy) [tDy, tAt] = [Math.abs(g[0] - o[0]), { t: +t.toFixed(3), H, fl: +fl.toFixed(3), ck: +(ck - now).toFixed(3) }];
      tSq = Math.max(tSq, Math.abs(g[1] - o[1]));
      tLean = Math.max(tLean, Math.abs(g[2] - o[2]), Math.abs(g[3] - o[3]));
    }
    report('the motion of the take on the GPU', `the fall, the crack, the heal, the flinch: dy within ${(tDy * 1000).toFixed(2)} mm (worst at ${JSON.stringify(tAt)}), the stretch within ${tSq.toExponential(1)}, the lean within ${tLean.toExponential(1)}`, 'dy <= 5 mm, the stretch <= 1e-3, the lean <= 1e-4', tDy <= 0.005 && tSq <= 1e-3 && tLean <= 1e-4);
    report('the aim against the drawn', `a point up to 12 m off the centre and 14 m up it: the CPU's height within ${f2(dAim * 100)} cm of the GPU's turned house`, '<= 25 cm (inside the lean\'s margin, liftTiltReach)', dAim <= 0.25);
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
