#!/usr/bin/env node
// A mover takes paint (CONTRACT.md section 3; L5), at a fixed step on the street under ?life: node tools/life/paint.mjs <out dir>. BASE is the page.
//   aim       a ray straight at a plane finds it, and the aim's answer is where it will be when the breath gets there
//   hit       a breath's hit takes at its impact, not before: grey until then, then the breath's hue at level 1; a second hit goes up a level and keeps the hue
//   contrail  the painted plane streams a ribbon of its paint behind it (O6)
//   tap       the bus put behind a plane with its nose on it: a real tap's breath paints it, and nothing under it
//   0930      Dolores at 09:30 on a Friday: a few picnics out, the parks awake from 9 am, and one takes paint from a real tap
//   C15       five movers painted one by each faction read back their own through a reload, and a record kept before factions, naming none, reads back Rainbow's
//   kept      the page again at the same moment: the plane is still painted, from the test store, and the real store has nothing
//   picnics   in Mission Dolores Park on a Saturday afternoon, the bus low behind a group with its aim on it: it glints, a real tap paints it, none of it is kept
//             (picnic:); painted, its people get up and dance (LIVING.md: "stop, look up, wave, dance")
//   cars      the same with a car on the road: it glints, a tap paints it, none of it kept (car:); painted, it bounces and lays rainbow tyre tracks; flown along
//             its street at 15, 45 and 150 m, a building the line of fire lands on keeps the shot
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
  // (and Mission Dolores Park on a Saturday at 15:00, for its picnics)
  const park = `${BASE}?life&nohud&skipintro&fixeddt=0.033333&t=2026-11-07T23:00:00Z&lat=37.7605&lon=-122.4262`;
  const open = async (first, at = url) => {
    if (first) await page.goto(at, { waitUntil: 'load', timeout: 180000 });
    else await page.reload({ waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 600000, polling: 500 });
    await frames(40);
  };
  await open(true, park);
  // (a mover on the ground, kind 8 a picnic and 5 a car, where one is now)
  const now = (key) => page.evaluate((k) => {
    const l = window.__game.life, s = l.snap, rows = s.rows, dt = (l.utc - s.f64[0]) / 1000;
    for (let i = 0; i < s.u32[2]; i++) if (l.keys.get(s.rowsU32[i * 16]) === k) { const o = i * 16; return { x: rows[o + 2] + rows[o + 5] * dt, y: rows[o + 3], z: rows[o + 4] + rows[o + 7] * dt, vx: rows[o + 5], vz: rows[o + 7] }; }
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
    // (picnics: one glints, a real tap paints it, and painted it comes alive: its people up off the blanket, each hopping where they sat or lay, arms up on the
    // up-beat; a frame at a time, past a whole hop, and a frame of it once the breath's spray has gone. Its grass and its park come in a tile at a time first)
    for (let i = 0; i < 12; i++) {
      if ((await page.evaluate(() => { const s = window.__game.life.snap; let k = 0; for (let i = 0; i < s.u32[2]; i++) if (s.rows[i * 16 + 1] === 8) k++; return k; })) >= 30) break;
      await frames(30);
    }
    const a = await aimAt(8, 0.5, 'picnic-glint.png');
    let got = null;
    if (a.key) {
      await page.evaluate(() => window.__game.tapSplat());
      await frames(60);
      got = await page.evaluate((key) => ({ key, painted: window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null }), a.key);
      const seen = [];
      for (let f = 0; f < 24; f++) {
        await frames(1);
        seen.push(await page.evaluate((key) => {
          const l = window.__game.life, D = l.danced, s = l.snap, h = l.keyHash(key);
          let look = -1;
          for (let i = 0; i < s.u32[2]; i++) if (s.rowsU32[i * 16] === h) look = s.rows[i * 16 + 14];
          return { dancers: l.qa.dancers, mine: D[0] === h, y: D[2], pose: D[4], look };
        }, a.key));
      }
      // (its people: the look's four low bits, each one a dancer)
      const mine = seen.filter((v) => v.mine && v.dancers > 0), ys = mine.map((v) => v.y), people = [1, 2, 4, 8].filter((b) => (seen[0]?.look ?? 0) & b).length;
      got.dance = { frames: mine.length, people, dancers: Math.min(...seen.map((v) => v.dancers)), hop: +(ys.length ? Math.max(...ys) - Math.min(...ys) : 0).toFixed(2), poses: [...new Set(mine.map((v) => v.pose))].sort() };
      await frames(60);
      await page.screenshot({ path: join(dir, 'picnic-dance.png') });
    }
    await page.evaluate(() => delete window.__qa.pin);
    await frames(10);
    // (picnic: is "only while it's near", CONTRACT.md section 3: none in the test store)
    const picnicKept = await testStore('picnic:');
    row('picnics: the bus low behind one, its aim on it: it glints, a real tap paints it, none of it kept', !!got?.painted && got.painted.level >= 1 && picnicKept === 0, { picnics: a.near, tries: a.tries, key: got?.key, painted: got?.painted, picnicKept });
    const dn = got?.dance;
    row('picnics: painted, its people get up and dance, every one of them, a hop with their arms up on its up-beat', !!dn && dn.frames >= 20 && dn.people >= 1 && dn.dancers >= dn.people && dn.hop > 0.15 && dn.poses.length === 2, dn);
  }
  {
    // (the parks wake up from 9 am: Dolores on a Friday at 09:30 has a few groups out, and one of them takes paint as at the afternoon's peak)
    await open(true, `${BASE}?life&nohud&skipintro&fixeddt=0.033333&t=2026-11-06T17:30:00Z&lat=37.7605&lon=-122.4262`);
    let out = 0;
    for (let i = 0; i < 12; i++) {
      out = await page.evaluate(() => { const s = window.__game.life.snap; let k = 0; for (let i = 0; i < s.u32[2]; i++) if (s.rows[i * 16 + 1] === 8) k++; return k; });
      if (out >= 1) break;
      await frames(30);
    }
    const a = await aimAt(8, 0.5, 'picnic-0930.png');
    let painted = null;
    if (a.key) {
      await page.evaluate(() => window.__game.tapSplat());
      await frames(60);
      painted = await page.evaluate((key) => window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, a.key);
    }
    await page.evaluate(() => delete window.__qa.pin);
    row('picnics at 09:30 on a Friday: a few groups out, one glints, and a real tap paints it', out > 0 && !!painted && painted.level >= 1, { groups: out, tries: a.tries, key: a.key, painted });
  }
  // (the rest at the Ferry Building on a Thursday morning)
  await open(true);
  {
    // (cars: the same, on the road. Painted, a car bounces as it drives, squashed as it lands, and lays two tyre tracks flat on the road behind it, each stretch its own
    // hue; a frame of it three seconds on, the pin following it. Its paint isn't kept: car:, "only while it's near")
    const a = await aimAt(5, 0.8, 'car-glint.png');
    let got = null, beside = null;
    if (a.key) {
      // (the producer couldn't hit a car: the line of fire had to pass within its half size. The bus put 5 m to one side of where it glinted, its line of fire with it,
      // two frames: the car still glints, the aim's cone has it)
      beside = await page.evaluate((key) => {
        const f = window.__game.flight, p = { ...window.__qa.pin }, ux = Math.sin(p.heading), uz = -Math.cos(p.heading);
        window.__qa.pin = { ...p, x: p.x - uz * 5, z: p.z + ux * 5 };
        return { key, was: window.__game.life.glintKey, dx: +(-uz * 5).toFixed(2), dz: +(ux * 5).toFixed(2), busY: Math.round(f.y) };
      }, a.key);
      await frames(2);
      Object.assign(beside, await page.evaluate(() => {
        const m = window.__game.aimer.mover;
        return { now: window.__game.life.glintKey, missM: m ? +m.miss.toFixed(2) : null, halfM: m ? +m.half.toFixed(2) : null };
      }));
      // (back on it for the tap)
      await page.evaluate(([dx, dz]) => { const p = window.__qa.pin; window.__qa.pin = { ...p, x: p.x - dx, z: p.z - dz }; }, [beside.dx, beside.dz]);
      await frames(2);
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
      // (three seconds on, the bus following it as a player chases it, far enough back that the bus doesn't hide it, the spray gone: the bounce and the tracks as seen)
      for (let k = 0; k < 9; k++) {
        const at = await now(a.key);
        if (!at) break;
        // (behind it along its own way, which turns with the road)
        const v = Math.hypot(at.vx, at.vz) || 1, ux = at.vx / v, uz = at.vz / v;
        await page.evaluate((p) => (window.__qa.pin = p), { x: at.x - ux * 110, y: at.y + 32, z: at.z - uz * 110, heading: Math.atan2(ux, -uz), nose: 0 });
        await frames(10);
      }
      await page.screenshot({ path: join(dir, 'car-painted.png') });
    }
    await page.evaluate(() => delete window.__qa.pin);
    await frames(10);
    const carKept = await testStore('car:');
    row('cars: the bus low behind one, its aim on it: it glints, a real tap paints it, none of it kept', !!got?.painted && got.painted.level >= 1 && carKept === 0, { cars: a.near, tries: a.tries, key: got?.key, painted: got?.painted, carKept });
    // (the same car, or another the line now passes nearer: the aim's cone takes the one nearest its line)
    row('cars: the bus put 5 m to one side, its line of fire missing the car: a car still glints, in the aim\'s cone', !!beside && (beside.now === beside.key || (/^car:/.test(beside.now ?? '') && beside.missM <= 5 + beside.halfM)), beside);
    const b = got?.bounce;
    row('cars: painted, it bounces, squashed as it lands, and lays two rainbow tyre tracks flat on the road', !!b && b.frames >= 20 && b.hop > 0.15 && b.squash < 0.9 && b.tracks >= 1 && b.marks >= 2 && b.hues >= 4 && b.edgesM < 0.01 && b.overRoadM < 1, b);
  }
  {
    // (B1, the first account's life review: aimed at a house by a busy street, the car beside it took the shot, and along the nose a car 1.7 km down the road. The bus
    // flown level along the street the nearest car is on, at 15, 45 and 150 m, 40 frames each, its aim wherever the game puts it: on the frames the line of fire lands
    // on a building (a few at least, or the row hasn't tried it), nothing on the ground glints but what the line runs right over; and nothing on the ground glints past the line's end)
    const street = await page.evaluate(() => {
      const g = window.__game, l = g.life, s = l.snap, rows = s.rows, f = g.flight;
      let best = null;
      for (let i = 0; i < s.u32[2]; i++) {
        const o = i * 16, k = rows[o + 1], v = Math.hypot(rows[o + 5], rows[o + 7]);
        if ((k !== 5 && k !== 9) || v < 3) continue;
        const d = Math.hypot(rows[o + 2] - f.x, rows[o + 4] - f.z);
        if (!best || d < best.d) best = { d, x: rows[o + 2], y: rows[o + 3], z: rows[o + 4], ux: rows[o + 5] / v, uz: rows[o + 7] / v };
      }
      return best;
    });
    const seen = {};
    if (street)
      for (const h of [15, 45, 150]) {
        const heading = Math.atan2(street.ux, -street.uz);
        let onRoof = 0, stolen = 0, past = 0, groundGlints = 0;
        for (let k = 0; k < 40; k++) {
          const back = 120 - k * 3;
          await page.evaluate((p) => (window.__qa.pin = p), { x: street.x - street.ux * back, y: street.y + h, z: street.z - street.uz * back, heading, nose: 0 });
          await frames(1);
          const r = await page.evaluate(() => {
            const a = window.__game.aimer, m = a.mover, f = window.__game.flight, aim = a.aim;
            const L = Math.hypot(aim.x - f.x, aim.y - f.y, aim.z - f.z), md = m ? Math.hypot(m.x - f.x, m.y - f.y, m.z - f.z) : 0;
            return { roof: a.landsOnBuilding(), ground: !!m && m.onLine, over: !!m && m.miss <= m.half, past: !!m && m.onLine && md > L + 60 };
          });
          if (r.ground) groundGlints++;
          if (r.roof) onRoof++;
          if (r.roof && r.ground && !r.over) stolen++;
          if (r.past) past++;
        }
        seen[h] = { onRoof, stolen, past, groundGlints };
      }
    await page.evaluate(() => delete window.__qa.pin);
    await frames(4);
    const ok = !!street && Object.values(seen).every((v) => v.stolen === 0 && v.past === 0) && Object.values(seen).reduce((n, v) => n + v.onRoof, 0) >= 3;
    row("aim: flown along a busy street at 15, 45 and 150 m, a building the line lands on keeps the shot, and nothing on the ground past the line's end", ok, seen);
  }

  {
    // (a ferry: the bus 40 m up behind the nearest one underway, nose along its way, as a player chasing it holds; tried from 150, 250 and 400 m back. It glints, a
    // real tap paints it, and painted it lays a wake on the water behind it in every hue; its paint is kept, by vessel. A frame of it six seconds on, following it)
    const ferry = () => page.evaluate(() => {
      const g = window.__game, l = g.life, s = l.snap, rows = s.rows, dt = (l.utc - s.f64[0]) / 1000;
      let best = null;
      for (let i = 0; i < s.u32[2]; i++) {
        const o = i * 16, key = l.keys.get(s.rowsU32[o]), v = Math.hypot(rows[o + 5], rows[o + 7]);
        if (!key || rows[o + 1] !== 6 || v < 3) continue;
        const f = { key, x: rows[o + 2] + rows[o + 5] * dt, z: rows[o + 4] + rows[o + 7] * dt, ux: rows[o + 5] / v, uz: rows[o + 7] / v, d: Math.hypot(rows[o + 2] - g.flight.x, rows[o + 4] - g.flight.z) };
        if (!best || f.d < best.d) best = f;
      }
      return best;
    });
    const f = await ferry();
    let got = null;
    if (f)
      for (const back of [150, 250, 400]) {
        const at = await now(f.key);
        if (!at) break;
        const heading = Math.atan2(f.ux, -f.uz);
        await page.evaluate((p) => (window.__qa.pin = p), { x: at.x - f.ux * back, y: 40, z: at.z - f.uz * back, heading, nose: 0 });
        await frames(30);
        if ((await page.evaluate(() => window.__game.life.glintKey)) !== f.key) continue;
        await page.screenshot({ path: join(dir, 'ferry-glint.png') });
        await page.evaluate(() => window.__game.tapSplat());
        for (let k = 0; k < 18; k++) {
          const a = await now(f.key);
          if (a) await page.evaluate((p) => (window.__qa.pin = p), { x: a.x - f.ux * back, y: 40, z: a.z - f.uz * back, heading, nose: 0 });
          await frames(10);
        }
        await page.screenshot({ path: join(dir, 'ferry-wake.png') });
        got = await page.evaluate((key) => {
          const l = window.__game.life, K = l.pools.marks, hues = new Set();
          for (let j = 1; j < 12; j++) hues.add(K.ramp[j * 2]);
          return { key, back: 0, painted: l.painted.get(l.keyHash(key)) ?? null, marks: l.qa.marks, hues: hues.size, flat: +Math.abs(K.pos[1] - K.pos[4]).toFixed(3) };
        }, f.key);
        got.back = back;
        break;
      }
    await page.evaluate(() => delete window.__qa.pin);
    await frames(10);
    const kept = await testStore('ferry:');
    row('ferries: the bus behind one underway: it glints, a real tap paints it, kept by vessel; painted, it lays a wake flat on the water in every hue', !!got?.painted && got.painted.level >= 1 && kept >= 1 && got.marks >= 1 && got.hues >= 4 && got.flat < 0.01, { ...got, kept });
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
      const fresh = l.hit(key, 2, window.__game.life.utc, now + 1, 1);
      return { fresh, before: l.painted.has(window.__game.life.keyHash(key)) };
    }, p.key);
    await frames(40);
    const after = await page.evaluate((key) => window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, p.key);
    const again = await page.evaluate((key) => window.__game.life.hit(key, 5, window.__game.life.utc, window.__game.clock() + 0.2, 1), p.key);
    await frames(20);
    const twice = await page.evaluate((key) => window.__game.life.painted.get(window.__game.life.keyHash(key)) ?? null, p.key);
    row('hit: grey until the impact, then its hue at level 1; again, level 2 and the same hue', r.fresh && !r.before && after?.hue === 2 && after.level === 1 && !again && twice?.hue === 2 && twice.level === 2, { ...r, after, again, twice });
  }
  {
    // (O6: the painted plane's ribbon, the first (planes are the first rows; a painted ferry's wake and a car's tracks after it): its paint's ramp, solid at the plane and its far end the oldest, laid back along the plane's path)
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
    row('contrail: the painted plane streams its paint behind it, solid at the plane, the far end the oldest', k.marks >= 1 && k.ramp === k.want && k.age0 === 0 && k.ageEnd === 1 && k.behind < 0, k);
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
  // (C15: five kept movers painted one by each faction, and a record kept before factions, naming none, written to the test store as it was)
  const five = await page.evaluate(() => {
    const l = window.__game.life, out = [];
    for (const key of l.keys.values()) {
      if (out.length >= 5) break;
      if (!/^(ferry|plane|sail):/.test(key) || l.painted.has(l.keyHash(key))) continue;
      out.push(key);
    }
    out.forEach((key, i) => l.hit(key, (i + 1) % 6, l.utc, window.__game.clock() + 0.1, i + 1));
    return out;
  });
  await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('strugglebus.life.test.v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('paint', { keyPath: 'key' });
    r.onsuccess = () => {
      const tx = r.result.transaction('paint', 'readwrite');
      tx.objectStore('paint').put({ key: 'ferry:before-factions:0:20261107', hue: 3, level: 2, until: 9e15, ns: 'sf' });
      tx.oncomplete = () => ok(true);
      tx.onerror = () => ok(false);
    };
    r.onerror = () => ok(false);
  }));
  await frames(30);
  await open(false);
  await frames(30);
  const owners = await page.evaluate((keys) => {
    const l = window.__game.life, got = (k) => l.painted.get(l.keyHash(k)) ?? null;
    return { five: keys.map((k) => got(k)?.faction ?? null), old: got('ferry:before-factions:0:20261107') };
  }, five);
  row('C15: five movers painted by each faction read back their own after a reload; a record naming none reads back Rainbow\'s, as it was',
    five.length === 5 && owners.five.every((f, i) => f === i + 1) && owners.old?.faction === 1 && owners.old.hue === 3 && owners.old.level === 2, { keys: five.length, ...owners });
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
