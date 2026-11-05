#!/usr/bin/env node
// Life from the flight's loop (CONTRACT.md section 6, O4), at a fixed step on ?earth&life: node tools/life/sky.mjs <out dir>. BASE is the page.
//   street    life is up on the street: planes in its snapshots, every one painted, so each is drawn from any height (a painted mover keeps 1 px to orbit)
//   handover  a full pull up through 15 km: on the frame the flight takes the bus, each plane is where the frames before it said it would be on the screen
//   flight    the flight's loop draws them, from its own scene
//   home      back down under 14 km, the street's loop has them again
//   orbit     up again and on to 300 km: specks only, each a pixel of its paint
//   programs  L6 through it all: what the street's warm-up compiled is all life draws with, in either loop
// Exit 1 if any fails. The stick and the climb are climb.mjs's.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'shots/tmp/life-sky';
const BASE = process.env.BASE ?? 'http://localhost:4179/';
const T = process.env.T ?? '2026-11-05T18:22:20Z';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl', '--autoplay-policy=no-user-gesture-required']));
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(76)} ${JSON.stringify(got)}`);
};
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.goto(`${BASE}?earth&life&lat=37.7700&lon=-122.4300&heading=45&skipintro&t=${T}&fixeddt=0.033333`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__game && window.__game.city.loadedRegionCount() > 0, null, { timeout: 300000, polling: 500 });
  const frames = async (n, stick = { sx: 0, sy: 0 }, pin = null) => {
    await page.evaluate(([k, s, p]) => (window.__qa = { holdFrames: k, held: false, ...s, pin: p }), [n, stick, pin]);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 600000, polling: 50 });
  };
  // ---- street: the flight behind the street, life's planes in, every one painted
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await frames(10);
    up = await page.evaluate(() => window.__space?.moon?.trip?.leg === 'street' && (window.__game.life?.qa.snaps ?? 0) > 2);
  }
  const painted = await page.evaluate(() => {
    const l = window.__game.life;
    let n = 0;
    for (const key of l.keys.values()) {
      l.hit(key, n % 6, l.utc, 0);
      n++;
    }
    return n;
  });
  await frames(6);
  // (each noted mover on the screen, in game pixels, by its key's hash: the pipeline's camera is both loops' lens)
  const screen = () =>
    page.evaluate(() => {
      const g = window.__game, l = g.life, cam = g.camera, d = l.drawn, n = l.qa.drawn, W = innerWidth, H = innerHeight;
      const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements, at = {};
      for (let i = 0; i < n; i++) {
        const x = d[i * 4 + 1], y = d[i * 4 + 2], z = d[i * 4 + 3];
        const vx = v[0] * x + v[4] * y + v[8] * z + v[12], vy = v[1] * x + v[5] * y + v[9] * z + v[13], vz = v[2] * x + v[6] * y + v[10] * z + v[14];
        const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12], cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13], cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
        if (cw <= 0) continue;
        at[d[i * 4]] = [((cx / cw) * 0.5 + 0.5) * W, (0.5 - (cy / cw) * 0.5) * H];
      }
      const t = window.__space.moon.trip;
      return { leg: t.leg, km: +(g.flight.height / 1000).toFixed(2), flightKm: +t.hGround.toFixed(1), sky: l.qa.sky, rows: l.qa.rows, models: l.qa.models, specks: l.qa.specks, marks: l.qa.marks, drawn: n, home: l.pools.group.parent === g.scene, programs: g.pipeline.renderer.info.programs.length, at };
    });
  const s0 = await screen();
  row('street: life is up under ?earth, its planes painted, the street drawing them', up && painted > 0 && !s0.sky && s0.home && s0.drawn > 0, { painted, ...s0, at: Object.keys(s0.at).length });
  // ---- handover: Turbo 3 from 7 km, a full pull, a frame at a time through 15 km
  const at = await page.evaluate(() => ({ x: window.__game.flight.x, z: window.__game.flight.z, heading: window.__game.flight.heading }));
  await frames(2, { sx: 0, sy: 0 }, { ...at, y: 7000 });
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 3; i++) g.controls.turbo.shift(1, g.flight);
    for (let i = 0; i < 3; i++) g.controls.turbo.rung(1, g.flight);
  });
  const pull = { sx: 0, sy: -1 };
  let s = await screen();
  // (in tens to 14.4 km: a full pull in Turbo 3 climbs 0.3 km in ten frames, and the hand-over at 15 km must come a frame at a time)
  for (let n = 0; n < 4000 && s.leg === 'street' && s.km < 14.4; n += 10) {
    await frames(10, pull);
    s = await screen();
  }
  // (the flight's first frame is the first one life is drawn from the flight's loop; the frame before it is the hand-over's, which the street draws and then hands up, the
  // lens changed after it was drawn, so it's read neither way)
  const seen = [];
  let k = -1;
  for (let i = 0; i < 150 && (k < 0 || seen.length < k + 3); i++) {
    await frames(1, pull);
    seen.push(await screen());
    if (k < 0 && seen[seen.length - 1].sky) k = seen.length - 1;
  }
  await page.screenshot({ path: join(dir, 'handover.png') });
  // (each plane on the flight's first frame against where the street's last two whole frames had it going, two frames on: the bus climbs at 900 m/s, so a plane moves a few
  // pixels a frame either way)
  const miss = [], byMover = [];
  if (k >= 3)
    for (const h of Object.keys(seen[k].at)) {
      const a = seen[k - 3].at[h], b = seen[k - 2].at[h], c = seen[k].at[h];
      if (!a || !b || !c) continue;
      const m = Math.hypot(c[0] - (b[0] + 2 * (b[0] - a[0])), c[1] - (b[1] + 2 * (b[1] - a[1])));
      // (and the same guess made between the street's own frames just before, three frames earlier: what a mover's own motion on the screen misses by, a ferry
      // below the climbing bus far more than a plane far off. A jump is what the hand-over misses by past that)
      const a0 = seen[k - 6]?.at[h], b0 = seen[k - 5]?.at[h], c0 = seen[k - 3]?.at[h];
      const base = a0 && b0 && c0 ? Math.hypot(c0[0] - (b0[0] + 2 * (b0[0] - a0[0])), c0[1] - (b0[1] + 2 * (b0[1] - a0[1]))) : 0;
      miss.push(Math.max(0, m - base));
      byMover.push([h, m, base, Math.hypot(b[0] - a[0], b[1] - a[1])]);
    }
  miss.sort((x, y) => x - y);
  // (the three that jump most past their own motion's miss, by key, with that miss and how far each moved a frame on the screen before)
  byMover.sort((x, y) => y[1] - y[2] - (x[1] - x[2]));
  const named = await page.evaluate((w) => w.map(([h, m, b, v]) => ({ key: String(window.__game.life.keys.get(Number(h)) ?? h), missPx: +m.toFixed(2), streetPx: +b.toFixed(2), movesPx: +v.toFixed(2) })), byMover);
  // (planes, against the limit; and the movers on the ground, ferries a dozen km off among them, printed: they jump at the hand-over where the street's own frames
  // don't, an open finding in LIFE.md, "From the flight's loop")
  const planes = named.filter((m) => m.key.startsWith('plane:')), ground = named.filter((m) => !m.key.startsWith('plane:'));
  const jumpOf = (m) => Math.max(0, m.missPx - m.streetPx), planeJumps = planes.map(jumpOf).sort((x, y) => x - y);
  const worstThree = planes.slice(0, 3), groundWorst = ground.slice(0, 3);
  const worst = miss.length ? +miss[miss.length - 1].toFixed(2) : null, med = miss.length ? +miss[miss.length >> 1].toFixed(2) : null;
  const before = k >= 2 ? seen[k - 2] : null, after = k >= 0 ? seen[k] : null;
  row('handover: the flight takes the bus, and draws the planes the street did', k >= 2 && !before.sky && after.sky && !after.home && after.drawn > 0 && Math.abs(after.drawn - before.drawn) <= 2, { flightFrom: k, before: before && { ...before, at: undefined }, after: after && { ...after, at: undefined } });
  const pWorst = planeJumps.length ? +planeJumps[planeJumps.length - 1].toFixed(2) : null, pMed = planeJumps.length ? +planeJumps[planeJumps.length >> 1].toFixed(2) : null;
  row("handover: no plane jumps on the screen, past what the same guess misses by on the street's own frames before (px)", planeJumps.length >= 3 && pWorst < 6 && pMed < 3, { planes: planeJumps.length, median: pMed, worst: pWorst, worstThree });
  console.log(`      handover, on the ground (open): ${ground.length} movers, all of them with planes ${miss.length}, median ${med} px, worst ${worst} px:`, JSON.stringify(groundWorst));
  // ---- flight: on up, the flight's own calls between frames, as climb.mjs flies it
  const fly = (secs, yoke, until) =>
    page.evaluate(
      ([secs, yoke, until]) => {
        const m = window.__space.moon, stop = until ? new Function('t', `return ${until}`) : () => false;
        let i = 0;
        for (; i < secs * 30 && !stop(m.trip); i++) {
          m.trip.step(1 / 30, 0, yoke);
          m.view.update(1 / 30, m.trip, 0, 0, false, 0);
        }
        return i / 30;
      },
      [secs, yoke, until ?? ''],
    );
  await fly(30, -1, 't.hGround > 40');
  await frames(6);
  const f40 = await screen();
  await page.screenshot({ path: join(dir, 'flight-40km.png') });
  // (and as a player sees them out of Turbo 3, whose own speed lines a speck or a contrail can't be told from (the first account's GPU review, M1): down to Cruise, a
  // second of frames for the lines to go, a frame, and back up to Turbo 3 for the rest)
  const gears = (up, n) => page.evaluate(([up, n]) => {
    const m = window.__space.moon;
    for (let i = 0; i < n; i++) {
      if (up) m.trip.tap();
      else m.trip.shiftDown();
      m.trip.step(1 / 30, 0, 0);
      m.view.update(1 / 30, m.trip, 0, 0, false, 0);
    }
  }, [up, n]);
  await gears(false, 6);
  await frames(30);
  await page.screenshot({ path: join(dir, 'flight-40km-cruise.png') });
  await gears(true, 6);
  row('flight: at 40 km the flight draws them and their contrails, from its own scene', f40.leg === 'wait' && f40.flightKm > 39 && f40.sky && !f40.home && f40.drawn > 0 && f40.marks > 0, { ...f40, at: undefined });
  // ---- home: back down over the city, the street takes the bus and its planes
  await fly(300, 1, 't.hGround < 14.1');
  let d = await screen();
  for (let i = 0; i < 40 && d.leg !== 'street'; i++) {
    await page.evaluate(() => {
      const m = window.__space.moon;
      m.trip.step(1 / 30, 0, 1);
      m.view.update(1 / 30, m.trip, 0, 0, false, 0);
    });
    await frames(1);
    d = await screen();
  }
  await frames(10);
  d = await screen();
  await page.screenshot({ path: join(dir, 'home.png') });
  row("home: under 14 km the street has the bus, and life's planes are the street's again", d.leg === 'street' && !d.sky && d.home && d.drawn > 0, { ...d, at: undefined });
  // ---- orbit: up again through 15 km, and on to 300 km
  s = await screen();
  for (let n = 0; n < 2000 && s.leg === 'street'; n += 10) {
    await frames(10, pull);
    s = await screen();
  }
  await fly(900, -1, 't.hGround > 300');
  await frames(6);
  const f300 = await screen();
  await page.screenshot({ path: join(dir, 'flight-300km.png') });
  await gears(false, 6);
  await frames(30);
  await page.screenshot({ path: join(dir, 'flight-300km-cruise.png') });
  row('orbit: at 300 km the flight draws them as specks only, each a pixel of its paint', f300.flightKm > 299 && f300.sky && f300.specks > 0 && f300.models === 0, { ...f300, at: undefined });
  // (L6 through the hand-over: life's draws in the flight's scene are the programs the street's warm-up made)
  row('programs: nothing compiled from the street up through the hand-over, home and on to orbit', f300.programs === s0.programs, { street: s0.programs, orbit: f300.programs });
} catch (e) {
  bad++;
  console.log('FAIL ', e.message);
} finally {
  row('no page errors', !errors.length, errors.slice(0, 5));
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
