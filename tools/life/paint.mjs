#!/usr/bin/env node
// A mover takes paint (CONTRACT.md section 3; L5), at a fixed step on the street under ?life: node tools/life/paint.mjs <out dir>. BASE is the page.
//   aim       a ray straight at a plane finds it, and the aim's answer is where it will be when the breath gets there
//   hit       a breath's hit takes at its impact, not before: grey until then, then the breath's hue at level 1; a second hit goes up a level and keeps the hue
//   contrail  the painted plane streams a ribbon of its paint behind it (O6)
//   tap       the bus put behind a plane with its nose on it: a real tap's breath paints it, and nothing under it
//   kept      the page again at the same moment: the plane is still painted, from the test store, and the real store has nothing
//   people    the bus low behind someone on the sidewalk with its aim on them: they glint, a real tap paints them, and none of it is kept (walk:);
//             painted, they stop where the paint found them and dance (LIVING.md: "stop, look up, wave, dance"), while the worker walks their row on
//   cars      the same with a car on the road: it glints, a tap paints it, none of it kept (car:); painted, it bounces and lays rainbow tyre tracks
// Frames as a player sees them (the first account's GPU review, M1): each glint once the camera has followed the bus, the dance and the car once the spray is gone, the
// plane's streak three seconds after its hit, the bus following it.
// Exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv[2] ?? 'shots/tmp/life-paint';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(76)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => (window.__qa = { holdFrames: 4, held: false }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 300)));
  const frames = async (n) => {
    await page.evaluate((k) => (window.__qa = { ...window.__qa, holdFrames: k, held: false }), n);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 600000, polling: 50 });
  };
  // (a moment a scripted plane crosses the city at 5.8 km, so the bus can be put behind it over the map: a breath has no aim past the map's reach, where the bus can't be)
  const T = '2026-11-05T18:22:20Z';
  const url = `${BASE}?life&nohud&skipintro&fixeddt=0.033333&t=${T}&lat=37.7955&lon=-122.3937`;
  const open = async (first) => {
    if (first) await page.goto(url, { waitUntil: 'load', timeout: 180000 });
    else await page.reload({ waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 600000, polling: 500 });
    await frames(40);
  };
  await open(true);
  // (a mover on the ground, kind 3 a person and 5 a car, where one is now)
  const now = (key) => page.evaluate((k) => {
    const l = window.__game.life, s = l.snap, rows = s.rows, dt = (l.utc - s.f64[0]) / 1000;
    for (let i = 0; i < s.u32[2]; i++) if (l.keys.get(s.rowsU32[i * 16]) === k) { const o = i * 16; return { x: rows[o + 2] + rows[o + 5] * dt, y: rows[o + 3], z: rows[o + 4] + rows[o + 7] * dt }; }
    return null;
  }, key);
  /**
   * The bus 45 m over one of `kind` near it, put back along its own line of fire from their middle (`mid` m up), so the line runs through them, as a player low over a
   * street aims at someone or something on it. The aim takes one on the line of fire alone, and not behind a building: the nearest dozen are tried, each from four
   * sides. Once it glints, the pin is held a second for the camera to follow the bus, as a player sees it (the first account's GPU review, M1), then put again on
   * them, and a frame of it taken. Returns the key and how many tries it took, or null.
   */
  const aimAt = async (kind, mid, shot) => {
    const near = await page.evaluate((kind) => {
      const g = window.__game, l = g.life, s = l.snap, rows = s.rows, n = s.u32[2], dt = (l.utc - s.f64[0]) / 1000, f = g.flight, out = [];
      for (let i = 0; i < n; i++) {
        const o = i * 16, key = l.keys.get(s.rowsU32[o]);
        if (key && rows[o + 1] === kind && !l.painted.has(s.rowsU32[o])) out.push({ key, d: Math.hypot(rows[o + 2] + rows[o + 5] * dt - f.x, rows[o + 4] + rows[o + 7] * dt - f.z) });
      }
      return out.sort((a, b) => a.d - b.d).slice(0, 12);
    }, kind);
    const own = await page.evaluate(() => window.__game.flight.heading);
    // (the line of fire for the pose, from the bus to the aim point, and the bus put back along it from their middle: twice)
    const put = async (key, heading) => {
      const ux = Math.sin(heading), uz = -Math.cos(heading);
      let at = await now(key);
      if (!at) return false;
      let pin = { x: at.x - ux * 60, y: at.y + 45, z: at.z - uz * 60, heading, nose: 0 };
      for (let k = 0; k < 2; k++) {
        await page.evaluate((p) => (window.__qa.pin = p), pin);
        await frames(2);
        const r = await page.evaluate(() => { const g = window.__game, f = g.flight, a = g.aimer.aim; return { dx: a.x - f.x, dy: a.y - f.y, dz: a.z - f.z }; });
        at = (await now(key)) ?? at;
        const L = Math.hypot(r.dx, r.dy, r.dz), down = -r.dy / L;
        if (down < 0.05) break;
        const along = (pin.y - (at.y + mid)) / down;
        pin = { ...pin, x: at.x - (r.dx / L) * along, z: at.z - (r.dz / L) * along };
      }
      await page.evaluate((p) => (window.__qa.pin = p), pin);
      await frames(2);
      return (await page.evaluate(() => window.__game.life.glintKey)) === key;
    };
    let tries = 0;
    for (const t of near.flatMap((p) => [0, 1, 2, 3].map((q) => ({ ...p, heading: own + (q * Math.PI) / 2 })))) {
      tries++;
      if (!(await put(t.key, t.heading))) continue;
      await frames(30);
      if (!(await put(t.key, t.heading))) continue;
      await page.screenshot({ path: join(dir, shot) });
      return { key: t.key, heading: t.heading, near: near.length, tries };
    }
    return { key: null, near: near.length, tries };
  };
  const testStore = (prefix) => page.evaluate((prefix) => new Promise((ok) => {
    const r = indexedDB.open('strugglebus.life.test.v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('paint', { keyPath: 'key' });
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('paint')) return ok(0);
      const q = db.transaction('paint').objectStore('paint').getAll();
      q.onsuccess = () => ok(q.result.filter((x) => String(x.key).startsWith(prefix)).length);
      q.onerror = () => ok(-1);
    };
    r.onerror = () => ok(-2);
  }), prefix);
  {
    // (people: they glint, a real tap paints them, and painted they come alive: drawn where the paint found them while their row walks on, hopping, arms up on the
    // up-beat; a frame at a time, past a whole hop, and a frame of it once the breath's spray has gone)
    const a = await aimAt(3, 0.9, 'person-glint.png');
    let got = null;
    if (a.key) {
      await page.evaluate(() => window.__game.tapSplat());
      await frames(60);
      got = await page.evaluate((key) => ({ key, painted: window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null }), a.key);
      const seen = [];
      for (let f = 0; f < 24; f++) {
        await frames(1);
        seen.push(await page.evaluate((key) => {
          const l = window.__game.life, D = l.danced;
          return { dancers: l.qa.dancers, mine: D[0] === l.keyHash(key), x: D[1], y: D[2], z: D[3], pose: D[4] };
        }, a.key));
      }
      const walked = await now(a.key), mine = seen.filter((v) => v.mine && v.dancers > 0), xs = mine.map((v) => v.x), ys = mine.map((v) => v.y), zs = mine.map((v) => v.z);
      const spread = (v) => (v.length ? Math.max(...v) - Math.min(...v) : 0);
      got.dance = {
        frames: mine.length,
        held: +Math.max(spread(xs), spread(zs)).toFixed(3),
        rowWalked: mine.length && walked ? +Math.hypot(walked.x - xs[0], walked.z - zs[0]).toFixed(2) : null,
        hop: +spread(ys).toFixed(2),
        poses: [...new Set(mine.map((v) => v.pose))].sort(),
      };
      await frames(60);
      await page.screenshot({ path: join(dir, 'person-dance.png') });
    }
    await page.evaluate(() => delete window.__qa.pin);
    await frames(10);
    // (walk: is "only while it's near", CONTRACT.md section 3: none in the test store)
    const walkKept = await testStore('walk:');
    row('people: the bus low behind one, its aim on them: they glint, a real tap paints them, none of it kept', !!got?.painted && got.painted.level >= 1 && walkKept === 0, { people: a.near, tries: a.tries, key: got?.key, painted: got?.painted, walkKept });
    const dn = got?.dance;
    row('people: painted, they stop where the paint found them as their row walks on, and dance, a hop with their arms up on its up-beat', !!dn && dn.frames >= 20 && dn.held < 0.01 && dn.rowWalked > 0.2 && dn.hop > 0.15 && dn.poses.length === 2, dn);
  }
  {
    // (cars: the same, on the road. Painted, a car bounces as it drives, squashed as it lands, and lays two tyre tracks flat on the road behind it, each stretch its own
    // hue; a frame of it three seconds on, the pin following it. Its paint isn't kept: car:, "only while it's near")
    const a = await aimAt(5, 0.8, 'car-glint.png');
    let got = null;
    if (a.key) {
      await page.evaluate(() => window.__game.tapSplat());
      await frames(45);
      got = await page.evaluate((key) => ({ key, painted: window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null }), a.key);
      const seen = [];
      for (let f = 0; f < 24; f++) {
        await frames(1);
        seen.push(await page.evaluate((key) => { const l = window.__game.life, B = l.bounced; return { mine: B[0] === l.keyHash(key) && l.qa.bouncers > 0, y: B[2], sy: B[4] }; }, a.key));
      }
      const mine = seen.filter((v) => v.mine), ys = mine.map((v) => v.y), sys = mine.map((v) => v.sy);
      // (its tracks: the first marks, the only car painted, two ribbons; each flat, its two edges at one height, over the road there; and their stretches' hues)
      const tr = await page.evaluate((key) => {
        const g = window.__game, l = g.life, K = l.pools.marks, P = 12, hues = new Set();
        let flat = 0, worstOver = 0;
        for (let r = 0; r < 2; r++)
          for (let j = 0; j < P; j++) {
            const v = (r * P + j) * 2;
            flat = Math.max(flat, Math.abs(K.pos[v * 3 + 1] - K.pos[v * 3 + 4]));
            worstOver = Math.max(worstOver, Math.abs(K.pos[v * 3 + 1] - g.city.groundAt(K.pos[v * 3], K.pos[v * 3 + 2])));
            if (j > 0) hues.add(K.ramp[v]);
          }
        return { tracks: l.qa.tracks, marks: l.qa.marks, hues: hues.size, edgesM: +flat.toFixed(3), overRoadM: +worstOver.toFixed(2), painted: l.painted.get(l.keyHash(key)) ?? null };
      }, a.key);
      got.bounce = { frames: mine.length, hop: +(ys.length ? Math.max(...ys) - Math.min(...ys) : 0).toFixed(2), squash: +(sys.length ? Math.min(...sys) : 1).toFixed(2), ...tr };
      // (three seconds on, the bus following it as a player chases it, the spray gone: the bounce and the tracks as seen)
      for (let k = 0; k < 9; k++) {
        const at = await now(a.key);
        if (!at) break;
        const ux = Math.sin(a.heading), uz = -Math.cos(a.heading);
        await page.evaluate((p) => (window.__qa.pin = p), { x: at.x - ux * 50, y: at.y + 30, z: at.z - uz * 50, heading: a.heading, nose: 0 });
        await frames(10);
      }
      await page.screenshot({ path: join(dir, 'car-painted.png') });
    }
    await page.evaluate(() => delete window.__qa.pin);
    await frames(10);
    const carKept = await testStore('car:');
    row('cars: the bus low behind one, its aim on it: it glints, a real tap paints it, none of it kept', !!got?.painted && got.painted.level >= 1 && carKept === 0, { cars: a.near, tries: a.tries, key: got?.key, painted: got?.painted, carKept });
    const b = got?.bounce;
    row('cars: painted, it bounces, squashed as it lands, and lays two rainbow tyre tracks flat on the road', !!b && b.frames >= 20 && b.hop > 0.15 && b.squash < 0.9 && b.tracks >= 1 && b.marks >= 2 && b.hues >= 4 && b.edgesM < 0.01 && b.overRoadM < 1, b);
  }
  // (a plane in the snapshot (kinds 1 and 2: people are 3, cars 5), the farthest from the map's middle, so the nearest is left grey for the tap: its key, where it is now, its velocity)
  const plane = () => page.evaluate(() => {
    const l = window.__game.life, s = l.snap, rows = s.rows, u32 = s.rowsU32, n = s.u32[2], dt = (l.utc - s.f64[0]) / 1000;
    let best = null;
    for (let i = 0; i < n; i++) {
      const o = i * 16, key = l.keys.get(u32[o]);
      if (!key || rows[o + 1] > 2) continue;
      const p = { key, x: rows[o + 2] + rows[o + 5] * dt, y: rows[o + 3] + rows[o + 6] * dt, z: rows[o + 4] + rows[o + 7] * dt, vx: rows[o + 5], vy: rows[o + 6], vz: rows[o + 7], size: rows[o + 11] };
      if (!best || Math.hypot(p.x, p.z) > Math.hypot(best.x, best.z)) best = p;
    }
    return best;
  });
  const p = await plane();
  row('a plane in the sky with its key', !!p, p);
  {
    // (a ray from 2 km behind it, straight at where it is, the breath 2 s on the way)
    const got = await page.evaluate((p) => {
      const l = window.__game.life, sp = Math.hypot(p.vx, p.vz) || 1, ox = p.x - (p.vx / sp) * 2000, oz = p.z - (p.vz / sp) * 2000;
      const t = l.aim(ox, p.y, oz, p.x - ox, 0, p.z - oz, 30, 2);
      return t ? { key: t.key, x: Math.round(t.x), y: Math.round(t.y), z: Math.round(t.z), arrive: +(t.arrive - window.__game.clock()).toFixed(2) } : null;
    }, p);
    const ahead = got ? Math.hypot(got.x - p.x, got.z - p.z) : -1;
    row('aim: a ray at it finds it, where it will be when the breath arrives', !!got && got.key === p.key && got.arrive > 0.5 && ahead > 50, { ...got, ahead: Math.round(ahead) });
  }
  {
    const r = await page.evaluate((key) => {
      const l = window.__game.life, g = window.__game, now = g.clock();
      const fresh = l.hit(key, 2, window.__game.life.utc, now + 1);
      return { fresh, before: l.painted.has(window.__game.life.keyHash(key)) };
    }, p.key);
    await frames(40);
    const after = await page.evaluate((key) => window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, p.key);
    const again = await page.evaluate((key) => window.__game.life.hit(key, 5, window.__game.life.utc, window.__game.clock() + 0.2), p.key);
    await frames(20);
    const twice = await page.evaluate((key) => window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, p.key);
    row('hit: grey until the impact, then its hue at level 1; again, level 2 and the same hue', r.fresh && !r.before && after?.hue === 2 && after.level === 1 && !again && twice?.hue === 2 && twice.level === 2, { ...r, after, again, twice });
  }
  {
    // (O6: the painted plane's ribbon, the only one: its paint's ramp, solid at the plane and its far end the oldest, laid back along the plane's path)
    const k = await page.evaluate((key) => {
      const l = window.__game.life, K = l.pools.marks, g = window.__game, s = l.snap, h = l.keyHash(key);
      let behind = null;
      for (let i = 0; i < s.u32[2]; i++)
        if (s.rowsU32[i * 16] === h) {
          const o = i * 16;
          // (its far end against its near one, along the plane's way: a far plane's ribbon is drawn nearer the lens, which keeps that sign)
          const e = 22 * 3, tx = (K.pos[e] + K.pos[e + 3]) / 2, tz = (K.pos[e + 2] + K.pos[e + 5]) / 2, sx = (K.pos[0] + K.pos[3]) / 2, sz = (K.pos[2] + K.pos[5]) / 2;
          behind = Math.round((tx - sx) * s.rows[o + 5] + (tz - sz) * s.rows[o + 7]);
        }
      return { marks: l.qa.marks, ramp: K.ramp[0], want: g.HUE_RAMPS[l.painted.get(h)?.hue ?? 0], age0: K.age[0], ageEnd: K.age[23], behind };
    }, p.key);
    row('contrail: the painted plane streams its paint behind it, solid at the plane, the far end the oldest', k.marks === 1 && k.ramp === k.want && k.age0 === 0 && k.ageEnd === 1 && k.behind < 0, k);
  }
  {
    // (the bus 1.5 km behind another plane, at its height, nose along its track: a real tap)
    const q = await plane();
    const others = await page.evaluate(() => {
      const l = window.__game.life, s = l.snap, out = [];
      for (let i = 0; i < s.u32[2]; i++) out.push(l.keys.get(s.rowsU32[i * 16]));
      return out;
    });
    // (the unpainted plane nearest the map's middle, people and cars left out)
    const target = await page.evaluate((keys) => {
      const l = window.__game.life, s = l.snap, rows = s.rows, dt = (l.utc - s.f64[0]) / 1000;
      let best = null;
      for (let i = 0; i < s.u32[2]; i++) {
        const o = i * 16, key = l.keys.get(s.rowsU32[o]);
        if (!key || rows[o + 1] > 2 || l.painted.has(s.rowsU32[o])) continue;
        const p = { key, x: rows[o + 2] + rows[o + 5] * dt, y: rows[o + 3], z: rows[o + 4] + rows[o + 7] * dt, vx: rows[o + 5], vz: rows[o + 7] };
        if (!best || Math.hypot(p.x, p.z) < Math.hypot(best.x, best.z)) best = p;
      }
      return best;
    }, others);
    let tapped = null;
    if (target) {
      // (held level behind it, as a player flying after a plane holds the nose on it: let go, the bus here noses down and slows while the plane draws away at 170 m/s)
      tapped = await page.evaluate((t) => {
        const sp = Math.hypot(t.vx, t.vz) || 1, ux = t.vx / sp, uz = t.vz / sp;
        const pin = { x: t.x - ux * 600, y: t.y, z: t.z - uz * 600, heading: Math.atan2(ux, -uz), nose: 0 };
        window.__qa.pin = pin;
        return { at: [Math.round(pin.x), Math.round(pin.y), Math.round(pin.z)], key: t.key };
      }, target);
      await frames(2);
      const glint = await page.evaluate(() => window.__game.life.glintKey);
      await page.evaluate(() => window.__game.tapSplat());
      await page.evaluate(() => delete window.__qa.pin);
      await frames(90);
      const got = await page.evaluate((key) => ({ painted: window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, hits: window.__game.life.qa.hits }), target.key);
      tapped = { ...tapped, glint, ...got };
      // (its streak as a player chasing it sees it: the bus held 600 m behind it at its height for three seconds, the contrail growing, then a frame)
      for (let k = 0; k < 9; k++) {
        await page.evaluate((key) => {
          const l = window.__game.life, s = l.snap, rows = s.rows, dt = (l.utc - s.f64[0]) / 1000, h = l.keyHash(key);
          for (let i = 0; i < s.u32[2]; i++)
            if (s.rowsU32[i * 16] === h) {
              const o = i * 16, vx = rows[o + 5], vz = rows[o + 7], sp = Math.hypot(vx, vz) || 1, ux = vx / sp, uz = vz / sp;
              window.__qa.pin = { x: rows[o + 2] + vx * dt - ux * 600, y: rows[o + 3], z: rows[o + 4] + vz * dt - uz * 600, heading: Math.atan2(ux, -uz), nose: 0 };
            }
        }, target.key);
        await frames(10);
      }
      await page.screenshot({ path: join(dir, 'plane-streak.png') });
      await page.evaluate(() => delete window.__qa.pin);
    }
    row('tap: the bus behind a plane, nose on it: the plane glints, and a real tap paints it', !!tapped && tapped.glint === tapped.key && !!tapped.painted && tapped.painted.level >= 1, tapped);
  }
  await page.screenshot({ path: join(dir, 'painted.png') });
  await frames(30);
  await open(false);
  await frames(30);
  const kept = await page.evaluate((key) => ({ painted: window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null }), p.key);
  const real = await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('strugglebus.life.v1');
    r.onupgradeneeded = () => r.result.createObjectStore('paint', { keyPath: 'key' });
    r.onsuccess = () => {
      const q = r.result.transaction('paint').objectStore('paint').count();
      q.onsuccess = () => ok(q.result);
      q.onerror = () => ok(-1);
    };
    r.onerror = () => ok(-2);
  }));
  row('kept: the page again, the plane still painted, from the test store; the real store empty', kept.painted?.hue === 2 && real === 0, { ...kept, realStore: real });
} catch (e) {
  bad++;
  console.log('FAIL ', e.message);
} finally {
  row('no page errors', !errors.length, errors.slice(0, 5));
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
