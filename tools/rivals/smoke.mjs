#!/usr/bin/env node
// The rival buses stand up in a browser and do what their Node rows say, a frame at a time at 1x: node tools/rivals/smoke.mjs [out=shots/tmp/rivals]
// A served build (BASE, default http://localhost:4179/). One ?swerve page over the Mission at a fixed step: the city's buses are out, a score of them, the
// nearest drawn and tagged, none of the player's crew, and after a minute of the player flying on they have each gone their own way; one put in front takes
// the shell on a tap, is thrown and soaked, and the player's paint lands where it comes down; one put across the nose in Express is smashed (the word, the
// beat, the throw); the player's bus hit is flooded, thrown and rolled, and flies on; one put nose to nose in Jet is the head-on (time slows, the white beat,
// the rings); &norivals has none of them; and nothing compiled on the way. Frames land in `out`. Prints a row each, exits 1 on a failure.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const OUT = process.argv[2] ?? 'shots/tmp/rivals', BASE = process.env.BASE ?? 'http://localhost:4179/';
const Q = 'skipintro&lat=37.7599&lon=-122.4148&heading=0&fixeddt=0.033333&t=2026-11-07T21:00:00Z';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0;
const row = (ok, name, o) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(24)} ${JSON.stringify(o)}`);
};
async function open(q) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => (window.__qa = { holdFrames: 4, held: false }));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`.slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console ${m.text()}`.slice(0, 300));
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`.slice(0, 200));
  });
  await page.goto(`${BASE}?${q}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 900000, polling: 500 });
  const frames = async (n) => {
    await page.evaluate((k) => (window.__qa = { ...window.__qa, holdFrames: k, held: false }), n);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 900000, polling: 50 });
  };
  const read = () =>
    page.evaluate(() => {
      const g = window.__game, f = g.flight, R = window.__rivals, t = g.controls.turbo;
      return {
        x: f.x, y: f.y, z: f.z, heading: f.heading, speed: f.speed, full: f.fullness, breathing: f.barfT >= 0, gear: t.gear + t.level,
        rivals: R ? { live: R.sim.live, counts: { ...R.counts }, out: R.out, rings: R.rings.length, slow: !!R.slowWith, list: R.sim.list.filter((r) => r.live).map((r) => ({ id: r.id, faction: r.faction, state: r.state, act: r.act, soaked: r.soaked, x: Math.round(r.x), z: Math.round(r.z), d: Math.round(Math.hypot(r.x - f.x, r.z - f.z)), y: Math.round(r.y) })) } : null,
        drawn: g.scene.children.filter((o) => /^Rival\d/.test(o.name) && o.visible).length, tags: [...document.querySelectorAll('[data-hud="recess-tag"]')].filter((e) => e.style.display !== 'none').length,
        programs: g.pipeline?.renderer?.info?.programs?.length ?? null,
      };
    });
  /** Put one rival `ahead` m up the player's way and `side` m to its right, on a trip `turn` rad off the player's heading at `speed`, and send the rest of the
   *  city's home: what the row strikes is the one it put there. */
  const put = (ahead, side, turn, speed) =>
    page.evaluate(([a, s, t, v]) => {
      const f = window.__game.flight, R = window.__rivals.sim, r = R.list.find((x) => x.live && x.state !== 3) ?? R.list[0];
      const fx = Math.sin(f.heading), fz = -Math.cos(f.heading), h = f.heading + t, x = f.x + fx * a - fz * s, z = f.z + fz * a + fx * s;
      for (const o of R.list) o.live = o === r;
      // (state 0 about its business, act 1 a trip: to a place far along its way, in a gear pinned to this speed, with no mind to start on anybody)
      Object.assign(r, { live: true, x, z, y: f.y, heading: h, speed: v, state: 0, act: 1, tripGear: 0, tx: x + Math.sin(h) * 1e7, tz: z - Math.cos(h) * 1e7, grudge: false, oneShot: false, bold: 0.9, ramIn: 0, skidLeft: 0, slip: 0, lift: 0, mischiefIn: 1e9 });
      r.px = r.x;
      r.pz = r.z;
      r.py = r.y;
      const T = window.__rivalTune;
      Object.assign(T, { weave: 0, dodge: 0 });
      T.speeds[0] = v;
      R.hunter = null;
      return r.id;
    }, [ahead, side, turn, speed]);
  return { ctx, page, errors, frames, read, put };
}

try {
  {
    const P = await open(`swerve&norivals&${Q}`);
    await P.frames(20);
    const a = await P.read();
    row(a.rivals === null && a.drawn === 0 && P.errors.length === 0, 'with &norivals', { rivals: a.rivals, drawn: a.drawn, errors: P.errors.slice(0, 3) });
    await P.ctx.close();
  }
  const P = await open(`swerve&${Q}`);
  await P.page.evaluate(() => (window.__rivalTune = window.__rivals.tune));
  await P.frames(45);
  const a = await P.read(), p0 = a.programs;
  await P.page.screenshot({ path: `${OUT}/in.png` });
  const within = (list, m) => list.filter((r) => r.d < m).length;
  row(a.rivals.live === 20 && a.drawn >= 1 && a.drawn <= 4 && a.tags >= 1 && a.tags === within(a.rivals.list, 2400 * (1 + a.speed / 300)) && !a.rivals.list.some((r) => r.faction === 1) && new Set(a.rivals.list.map((r) => r.faction)).size === 4, 'the city\'s buses are out', { live: a.rivals.live, drawn: a.drawn, tagged: a.tags, within1km: within(a.rivals.list, 1000), within2400m: within(a.rivals.list, 2400), nearestM: Math.min(...a.rivals.list.map((r) => r.d)), crews: [...new Set(a.rivals.list.map((r) => r.faction))].sort() });
  // ---- a minute of the player flying on, straight, at Express: they have gone their own ways, not the player's. (Their brain stepped by itself, the page's
  // own, with the player's bus as it would be: a minute of frames here is a quarter of an hour.)
  const b = await P.page.evaluate(() => {
    const R = window.__rivals, f = window.__game.flight, T = R.tune, mischief = T.mischief;
    const me = { x: f.x, y: f.y, z: f.z, heading: f.heading, nose: f.heading, speed: 112, faction: window.__game.splatter.faction, out: false };
    const was = new Map(R.sim.list.filter((r) => r.live).map((r) => [r.id, { x: r.x, z: r.z }]));
    T.mischief = 0;
    for (let k = 0; k < 1800; k++) {
      me.x += (Math.sin(me.heading) * 112) / 30;
      me.z -= (Math.cos(me.heading) * 112) / 30;
      R.sim.step(1 / 30, me, R.h.world);
    }
    T.mischief = mischief;
    // (the player's bus is where it was: the brain forgets where it last saw it, so its way back there is no ram)
    R.sim.mx = NaN;
    const fx = Math.sin(me.heading), fz = -Math.cos(me.heading);
    const list = R.sim.list.filter((r) => r.live).map((r) => ({ along: ((r.x - was.get(r.id).x) * fx + (r.z - was.get(r.id).z) * fz) / (112 * 60), went: Math.hypot(r.x - was.get(r.id).x, r.z - was.get(r.id).z), act: r.act }));
    return { live: R.sim.live, list, taps: R.counts.paint ?? 0 };
  });
  const along = b.list.map((r) => r.along).sort((p, q) => p - q);
  row(b.live === 20 && Math.abs(along[along.length >> 1]) < 0.3 && along[along.length - 1] < 0.9 && b.taps > 20, 'each its own way', { thePlayerFlewM: 112 * 60, ofThatEachWentThePlayersWay: { least: +along[0].toFixed(2), median: +along[along.length >> 1].toFixed(2), most: +along[along.length - 1].toFixed(2) }, wentOver600m: b.list.filter((r) => r.went > 600).length, painting: b.list.filter((r) => r.act === 0).length, onATrip: b.list.filter((r) => r.act === 1).length, tapsOfTheirOwn: b.taps });
  await P.frames(6);
  await P.page.screenshot({ path: `${OUT}/later.png` });
  // ---- the shell
  await P.page.evaluate(() => (window.__game.flight.fullness = 1));
  const id = await P.put(170, 6, 0, 16);
  await P.frames(3);
  await P.page.screenshot({ path: `${OUT}/ring.png` });
  const tapped = await P.page.evaluate(() => window.__rivals.tap());
  // (the shot is a breath: the belly goes with it, as a tap's does)
  await P.frames(4);
  const breath = (await P.read()).breathing;
  let s = null;
  for (let k = 0; k < 12; k++) {
    await P.frames(6);
    s = await P.read();
    if (s.rivals.counts.shellHit || s.rivals.counts.shellMiss) break;
  }
  await P.page.screenshot({ path: `${OUT}/shell.png` });
  const hit = s.rivals.list.find((r) => r.id === id);
  await P.frames(60);
  const landed = await P.read();
  await P.page.screenshot({ path: `${OUT}/soaked.png` });
  row(tapped && s.rivals.counts.shellHit === 1 && hit?.state === 3 && hit?.soaked === 1 && breath && landed.rivals.counts.land >= 1, 'the shell', { tapTaken: tapped, aBreath: breath, hit: s.rivals.counts.shellHit ?? 0, miss: s.rivals.counts.shellMiss ?? 0, thrown: hit?.state === 3, inMyColours: hit?.soaked === 1, cameDown: landed.rivals.counts.land ?? 0 });
  // ---- a smash: Express, into the side of one crossing
  await P.page.evaluate(() => {
    const g = window.__game;
    g.controls.turbo.rung(1, g.flight);
  });
  for (let k = 0; k < 20; k++) {
    await P.frames(10);
    if ((await P.read()).speed > 108) break;
  }
  const before = await P.read();
  const id2 = await P.put(190, -18, Math.PI / 2, 12);
  let r1 = null;
  for (let k = 0; k < 25; k++) {
    await P.frames(2);
    r1 = await P.read();
    if (r1.rivals.counts.ram1 || r1.rivals.counts.ram0 || r1.rivals.counts.ram2) break;
  }
  await P.page.screenshot({ path: `${OUT}/smash.png` });
  await P.frames(20);
  await P.page.screenshot({ path: `${OUT}/smash2.png` });
  const hit2 = r1.rivals.list.find((r) => r.id === id2);
  row(r1.rivals.counts.ram1 === 1 && hit2?.state === 3 && hit2?.soaked === 1 && !r1.rivals.out, 'a smash', { at: Math.round(before.speed), smashes: r1.rivals.counts.ram1 ?? 0, bumps: r1.rivals.counts.ram0 ?? 0, itIsThrown: hit2?.state === 3, thePlayerFliesOn: !r1.rivals.out });
  // ---- the player's bus, hit: flooded, thrown 170 m east and rolled, and its own again
  await P.frames(90);
  const h0 = await P.read();
  await P.page.evaluate(() => window.__rivals.hurtMe(1, 1, 0, 170, 2));
  await P.frames(12);
  const h1 = await P.read();
  await P.page.screenshot({ path: `${OUT}/hurt.png` });
  await P.frames(60);
  const h2 = await P.read();
  const east = h2.x - h0.x - (h2.speed * Math.sin(h0.heading) * 72) / 30;
  row(h1.rivals.out && !h2.rivals.out && east > 140 && east < 200, 'the player, hit', { outOfItFor: 'the throw', thrownEastM: Math.round(east), ofM: 170, flyingAgain: !h2.rivals.out });
  // ---- the head-on: Jet, and one coming the other way on the nose's line
  // (Jet at once, as the bus has it coming down from the sky: the climb to it is the gears' own check)
  await P.page.evaluate(() => {
    const g = window.__game, f = g.flight;
    g.controls.turbo.arrive(3);
    f.y = f.holdY = f.groundBroad + 165;
    f.speed = 450;
  });
  for (let k = 0; k < 20; k++) {
    await P.frames(10);
    const j = await P.read();
    if (j.gear === 3 && j.speed > 440) break;
  }
  const j0 = await P.read();
  await P.put(2600, 0, Math.PI, 450);
  let slowed = false, j1 = null;
  for (let k = 0; k < 80; k++) {
    await P.frames(2);
    j1 = await P.read();
    if (j1.rivals.slow && !slowed) {
      slowed = true;
      await P.page.screenshot({ path: `${OUT}/headon-coming.png` });
    }
    if (j1.rivals.counts.ram3 || j1.rivals.counts.ram2) break;
  }
  await P.page.screenshot({ path: `${OUT}/headon.png` });
  const ringsAt = j1.rivals.rings;
  await P.frames(45);
  await P.page.screenshot({ path: `${OUT}/headon-after.png` });
  await P.frames(60);
  const j2 = await P.read();
  await P.page.screenshot({ path: `${OUT}/headon-rings.png` });
  row(j0.gear === 3 && slowed && j1.rivals.counts.ram3 === 1 && ringsAt > 4 && j1.rivals.out && j2.rivals.rings < ringsAt, 'the head-on', { from: Math.round(j0.speed), timeSlowed: slowed, headOns: j1.rivals.counts.ram3 ?? 0, ringsToCome: ringsAt, ringsLeftLater: j2.rivals.rings, thePlayerThrown: j1.rivals.out });
  const end = await P.read();
  row(end.programs === p0 && P.errors.length === 0, 'nothing compiled', { programs: [p0, end.programs], errors: P.errors.slice(0, 4), counts: end.rivals.counts });
  await P.ctx.close();
} finally {
  await browser.close();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
