#!/usr/bin/env node
// ?recess on screen, at a fixed step in software graphics: node tools/recess/screen.mjs <out dir>. BASE is the page (http://localhost:4179/). A short match
// (&recesslen=30), Learner captains, so one match shows every row. The phone and the GPU are the producer's and the first account's.
//   kickoff   while the first bell rings, both captains ahead inside 10 degrees of the nose about 500 m off, the camera high behind the bus (kickoff.png)
//   findable  the lens about 40 degrees, pulled back with a rival near; both captains tagged; the fence up; ribbons behind captains 1.4 times bigger
//   up        the page boots into the match: two captains' buses in the scene, in their colours, over the arena, the player on its edge, no Golden Gate opening
//   programs  nothing compiles after the warm-up: the programs at the first frame are the programs 200 frames on
//   paint     the captains paint the real city where their blasts land, saved as theirs and so drawn in their own colours (factions' step 5), and their squares count
//             (paint's owner is Rainbow's in PaintState until factions' step 1 teaches it others)
//   gotcha    the player behind a captain, its glint on it: a real tap's breath at it rides it (Possessed), or it hops out (tried three times)
//   possessed the player ridden: the real gear goes to Nonstop, a flick down only wheezes, full right still turns the bus, its hiccups paint the hitter's, on grey
//   hit       Inferno's breath lands through the brain's step: flung, the bus's yellow flooded crimson, and drained back after the ride
//   fence     past the edge flying out, the bus bounces back in, pointing in; &hit=jet's forced gear is Jet
//   gods      each camp's god standing at its heart from the bell, its heart painted; one toppled by hits at the heart, said, and the heart the attacker's
//   bell      at the last bell the brain stops and the camera climbs to 1,500 m over the arena: the painted map, and the score in order (scoreboard.png)
//   freezes   captains paint and nothing freezes: 90 frames on, the game's clock and the match's ran every step (M22)
//   agrees    each building in a captain's colour stands in or beside one of its squares in the brain; the player's own hits froze 2 s at most, the match's clock on (M23)
//   B21       a stand-in saved city in the paint stores' own keys is the same after a match, nothing was saved for it, and the next match starts with none painted
//   flag off  the same page without ?recess has no match and no captains
// A row passes or fails on the numbers printed with it; exit 1 if any fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const dir = process.argv[2] ?? 'shots/tmp/recess-screen';
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
  const frames = async (n, extra = {}) => {
    await page.evaluate(([k, x]) => (window.__qa = { ...x, holdFrames: k, held: false }), [n, extra]);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 900000, polling: 50 });
  };
  const open = async (q) => {
    await page.goto(`${BASE}?fixeddt=0.066667&t=2026-11-07T21:00:00Z${q}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 900000, polling: 500 });
  };
  // (B21: the player's saved city, a stand-in for it in the stores' own keys, on this origin before the match)
  await page.goto(`${BASE}?fixeddt=0.066667`, { waitUntil: 'commit', timeout: 180000 });
  const SAVED = { 'strugglebus.paint.v3': '{"9":[1,2,3]}', 'strugglebus.paint.v1': '{"9":[1,2,3]}', 'strugglebus.landmarks.v1': '{"lm:coit":[1,2,2]}', 'strugglebus.ground.v4:0,0': 'saved', 'strugglebus.ground.v2:0,0': 'saved' };
  await page.evaluate((S) => { for (const [k, v] of Object.entries(S)) localStorage.setItem(k, v); }, SAVED);
  const paintKeys = () => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^strugglebus\.(paint|ground|landmarks)/.test(k)) o[k] = localStorage.getItem(k); } return o; });
  await open('&recess&recesslen=30&bots=learner');
  // (the captains' paint where it landed: the buildings within 25 m of each of their blasts that have landed, painted, and how many are its faction's)
  const landed = (faction) => page.evaluate((h) => {
    const g = window.__game, R = window.__recess, P = g.city.paint, pts = R.painted.filter((p) => p.at < R.now - 1.5 && (h === undefined || p.faction === h));
    let near = 0, same = 0;
    for (const p of pts)
      for (const n of g.city.buildingsWithin(p.x, p.z, 25)) {
        const r = P.get(n.ref.index);
        if (r.level < 0.5) continue;
        near++;
        if (r.faction === p.faction) same++;
      }
    return { blasts: pts.length, near, same, share: near ? +(same / near).toFixed(2) : 0 };
  }, faction);
  const programs0 = await page.evaluate(() => window.__game.pipeline.renderer.info.programs.length);
  // ---- kickoff: while the first bell rings, both captains ahead inside 10 degrees of the nose about 500 m off, and the camera high behind the bus ----
  const kick = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, f = g.flight, fx = Math.sin(f.heading), fz = -Math.cos(f.heading), c = g.camera.position;
    const caps = [1, 2].map((i) => { const b = R.sim.buses[i], dx = R.cx + b.x - f.x, dz = R.cz + b.z - f.z, d = Math.hypot(dx, dz); return { d: Math.round(d), offDeg: +((Math.acos((dx * fx + dz * fz) / d) * 180) / Math.PI).toFixed(1) }; });
    return { phase: R.phase, caps, camAboveBus: Math.round(c.y - f.y), camBehind: Math.round(-((c.x - f.x) * fx + (c.z - f.z) * fz)) };
  });
  await page.screenshot({ path: join(dir, 'kickoff.png') });
  row('kickoff: both captains ahead, inside 10 degrees of the nose and about 500 m off; the camera high behind the bus', kick.phase === 'ready' && kick.caps.every((c) => c.offDeg < 10 && c.d > 400 && c.d < 600) && kick.camAboveBus > 100 && kick.camBehind > 150, kick);
  // ---- up ----
  await frames(45);
  const up = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, f = g.flight;
    const caps = [1, 2].map((i) => g.scene.getObjectByName(`RecessCaptain${i}`)).filter(Boolean);
    const at = caps.map((c) => ({ r: Math.round(Math.hypot(c.position.x - R.cx, c.position.z - R.cz)), agl: Math.round(c.position.y - g.city.groundAt(c.position.x, c.position.z)), shown: c.visible }));
    return { phase: R.phase, captains: caps.length, at, playerR: Math.round(Math.hypot(f.x - R.cx, f.z - R.cz)), simT: +R.sim.t.toFixed(1), camps: R.sim.areas.realm.count };
  });
  const find = await page.evaluate(() => {
    const g = window.__game, R = window.__recess;
    return { matchFov: +g.rig.matchFov.toFixed(1), hfov: +g.rig.hfov.toFixed(1), pull: +g.rig.matchPull.toFixed(1), tags: [...document.querySelectorAll('[data-hud=recess-tag]')].filter((e) => e.style.display !== 'none').length, fence: g.scene.getObjectByName('RecessFence')?.count ?? 0, ribbons: g.scene.children.filter((o) => o.name === 'RecessRibbon').length, captainScale: +g.scene.getObjectByName('RecessCaptain1').children[0].scale.x.toFixed(2) };
  });
  row('findable: the lens wider (about 40 degrees), pulled back with a rival near, both captains tagged, the fence up, ribbons behind bigger captains', find.hfov > 38 && find.hfov < 46 && find.pull > 10 && find.tags >= 2 && find.fence > 900 && find.ribbons === 2 && find.captainScale > 2.2, find);
  row('up: the match, two captains over the arena, the player on its edge', up.phase === 'play' && up.captains === 2 && up.at.every((c) => c.r < 900 && c.agl > 20 && c.shown) && up.playerR < 800 && up.camps === 3, up);
  await page.screenshot({ path: join(dir, 'match.png') });
  // ---- M22: the captains paint without freezing anything: 90 frames on, the game's clock ran every frame's step, and the match's with it ----
  const c0 = await page.evaluate(() => ({ game: window.__game.clock(), sim: window.__recess.sim.t, paints: window.__recess.counts.paint ?? 0, frozen: window.__recess.frozen, lag: window.__recess.lag }));
  await frames(90);
  const c1 = await page.evaluate(() => ({ game: window.__game.clock(), sim: window.__recess.sim.t, paints: window.__recess.counts.paint ?? 0, frozen: window.__recess.frozen, lag: window.__recess.lag }));
  const ran = { game: +(c1.game - c0.game).toFixed(3), match: +(c1.sim - c0.sim).toFixed(3), want: +(90 * 0.066667).toFixed(3), captainPaints: c1.paints - c0.paints, frozenS: c1.frozen };
  // (what the game's clock lost in the window, against what the player's own hits in it may cost: two frames each at most; none, and it lost nothing)
  const frozeHere = +(c1.lag - c0.lag).toFixed(3), playerHits = Math.round((c1.frozen - c0.frozen) / (5 / 60)), mayLose = playerHits * 2 * 0.066667;
  row('freezes: captains paint and freeze nothing; only hits on the player do, and the match\'s clock runs all 90 frames through them', ran.captainPaints > 0 && frozeHere <= mayLose + 1e-3 && Math.abs(ran.match - ran.want) < 0.1, { ...ran, frozeHere, playerHits });
  // ---- gotcha: behind captain 1, nose on it ----
  let gotcha = null;
  for (let k = 0; k < 3 && !gotcha?.rode; k++) {
    await page.evaluate(() => {
      const R = window.__recess, b = R.sim.buses[1], hg = b.heading + Math.PI / 2;
      window.__qa.pin = { x: R.cx + b.x - Math.sin(hg) * 170, y: R.ys?.[1] ?? 80, z: R.cz + b.z + Math.cos(hg) * 170, heading: hg };
    });
    await frames(3, { pin: await page.evaluate(() => window.__qa.pin) });
    const before = await page.evaluate(() => ({ lock: window.__recess.sim.buses[0].lock, glint: window.__game.aimer.mover?.key ?? null }));
    await page.evaluate(() => { delete window.__qa.pin; window.__game.flight.barfT = -1; window.__game.flight.fullness = 1; window.__game.tapSplat(); });
    await frames(30);
    gotcha = await page.evaluate((b) => ({ ...b, fired: window.__recess.counts.fire ?? 0, hits: window.__recess.counts.hit ?? 0, hops: window.__recess.counts.hop ?? 0, misses: window.__recess.counts.miss ?? 0, rode: window.__recess.sim.buses[1].state === 'ride' || window.__recess.sim.buses[1].state === 'shield' }), before);
  }
  row('gotcha: the glint on a captain, a real tap rides it', !!gotcha && gotcha.glint === 'recess:1' && gotcha.rode, gotcha);
  // ---- possessed: the player ridden by Inferno ----
  // (Inferno's breath, white-hot and on the player, landing on the next step: the hit through the brain's own events, as a captain's lands)
  // (the bus's own yellow: what its colours drain back to)
  const ramp0 = await page.evaluate(() => window.__recess.busRamp.filter((r) => r === 14).length);
  await page.evaluate(() => {
    const S = window.__recess.sim, me = S.buses[0];
    me.state = 'free';
    S.breaths.push({ id: 9999, from: 2, target: 0, x: me.x, z: me.z, tx: me.x, tz: me.z, vx: 0, vz: 0, arrive: S.t + 0.04, born: S.t - 1, white: true });
  });
  await frames(3);
  const p0 = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, S = R.sim, a = g.scene.getObjectByName('BusRoot').getObjectByName('StruggleBus').geometry.getAttribute('ramp');
    let crimson = 0;
    for (let i = 0; i < a.count; i++) if (a.getX(i) === 30) crimson++;
    return { state: S.buses[0].state, gear: g.controls.turbo.gear, flung: R.counts.flung ?? 0, crimson };
  });
  await frames(9);
  const p1 = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, took = g.controls.flickGate(-1);
    return { state: R.sim.buses[0].state, gear: g.controls.turbo.gear, took, h0: g.flight.heading };
  });
  await frames(20, { sx: 1, sy: 0 });
  const p2 = await page.evaluate(() => ({ gear: window.__game.controls.turbo.gear, h1: window.__game.flight.heading, hiccups: window.__recess.counts.hiccup ?? 0 }));
  await frames(70);
  const p3 = { state: await page.evaluate(() => window.__recess.sim.buses[0].state), hiccups: await page.evaluate(() => window.__recess.counts.hiccup ?? 0), inferno: await landed(5) };
  const turned = Math.abs(Math.atan2(Math.sin(p2.h1 - p1.h0), Math.cos(p2.h1 - p1.h0)));
  const drained = await page.evaluate(() => { const a = window.__game.scene.getObjectByName('BusRoot').getObjectByName('StruggleBus').geometry.getAttribute('ramp'); let y = 0; for (let i = 0; i < a.count; i++) if (a.getX(i) === 14) y++; return y; });
  row('hit, made loud: flung (the roll and the throw), its yellow flooded with Inferno\'s crimson, and after the ride drained back to its own', p0.flung >= 1 && p0.crimson > 0 && drained === ramp0, { flung: p0.flung, crimson: p0.crimson, yellowBefore: ramp0, yellowAfter: drained });
  row('possessed: Nonstop, a flick down only wheezes, full right still turns, the hiccups paint the hitter\'s on grey where they land', p0.state === 'ride' && p1.took && p1.gear === 2 && p2.gear === 2 && turned > 0.1 && p3.hiccups >= 8 && p3.inferno.blasts >= 4 && p3.inferno.share >= 0.6,
    { p0, gear: p1.gear, took: p1.took, turnedRad: +turned.toFixed(2), ...p3 });
  await page.screenshot({ path: join(dir, 'possessed.png') });
  // ---- paint: the captains' own hues on the city, in the arena, and in the score ----
  const paint = { atlantis: await landed(2), all: await landed(), score: await page.evaluate(() => window.__recess.sim.score().filter((_, i) => [1, 2, 5].includes(i))), paints: await page.evaluate(() => window.__recess.counts.paint ?? 0) };
  row('paint: where a captain\'s blast lands the buildings are saved as its faction\'s, drawn in its colours, and its squares score', paint.atlantis.blasts > 0 && paint.all.share >= 0.6 && paint.score[1] > 0 && paint.score[2] > 0, paint);
  // ---- M23: the city's paint agrees with the brain: each building a captain's colour owns stands in or beside a square of that faction's ----
  const agree = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, A = R.sim.areas, P = g.city.paint;
    let painted = 0, agrees = 0;
    for (const { ref } of g.city.buildingsWithin(R.cx, R.cz, 900)) {
      const r = P.get(ref.index);
      if (r.level < 0.5 || (r.faction !== 2 && r.faction !== 5)) continue;
      painted++;
      let ok = false;
      for (let dz = -1; dz <= 1 && !ok; dz++) for (let dx = -1; dx <= 1 && !ok; dx++) ok = A.get(ref.cx - R.cx + dx * 128, ref.cz - R.cz + dz * 128)?.faction === r.faction;
      if (ok) agrees++;
    }
    return { painted, agrees, share: painted ? +(agrees / painted).toFixed(3) : 0, frozenS: +R.frozen.toFixed(3), lagS: +R.lag.toFixed(3) };
  });
  row('paint agrees: every building in a captain\'s colour is in or beside one of its squares; the player\'s hits froze at most 2 s, the match\'s clock on through them', agree.painted > 0 && agree.share >= 0.97 && agree.frozenS <= 2 && Math.abs(agree.lagS - agree.frozenS) < 0.2, agree);
  // ---- the fence: the bus put just past the edge, flying out: it's bounced back in, pointing in ----
  await page.evaluate(() => { const R = window.__recess, g = window.__game; window.__qa.pin = { x: R.cx + 760, y: g.flight.y, z: R.cz, heading: Math.PI / 2 }; });
  await frames(1, { pin: await page.evaluate(() => window.__qa.pin) });
  await page.evaluate(() => delete window.__qa.pin);
  await frames(2);
  const fence = await page.evaluate(() => { const R = window.__recess, f = window.__game.flight; return { r: Math.round(Math.hypot(f.x - R.cx, f.z - R.cz)), headingIn: +(Math.sin(f.heading) * -1).toFixed(2), bounces: R.counts.bounce ?? 0 }; });
  row('fence: past the edge flying out, the bus bounces back inside, pointing in', fence.bounces >= 1 && fence.r <= 750 && fence.headingIn > 0.5, fence);
  // ---- &hit=jet: the forced gear the other way, on Atlantis's hit ----
  await page.evaluate(() => {
    const R = window.__recess, S = R.sim, me = S.buses[0];
    R.hitGear = 3;
    me.state = 'free';
    // (a fresh pair: Atlantis may already have ridden the player twice in two minutes, when the pair rule turns a third away)
    S.pairs.clear();
    S.breaths.push({ id: 9998, from: 1, target: 0, x: me.x, z: me.z, tx: me.x, tz: me.z, vx: 0, vz: 0, arrive: S.t + 0.04, born: S.t - 1, white: true });
  });
  await frames(20);
  const jet = await page.evaluate(() => ({ state: window.__recess.sim.buses[0].state, gear: window.__game.controls.turbo.gear }));
  row('&hit=jet: the forced gear is Jet', jet.state === 'ride' && jet.gear === 3, jet);
  await page.evaluate(() => (window.__recess.hitGear = 2));
  // ---- the gods: each camp's standing at its heart from the start, painted there; one toppled by five hits at the heart, said, its heart the attacker's ----
  const gods = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, A = R.sim.areas, realm = A.realm, P = g.city.paint, out = [];
    for (let n = 0; n < realm.count; n++) {
      const k = realm.heart(n), a = A.all.get(k), ix = (k >>> 16) << 16 >> 16, iz = (k & 0xffff) << 16 >> 16, x = R.cx + (ix + 0.5) * 128, z = R.cz + (iz + 0.5) * 128;
      let painted = 0;
      for (const b of g.city.buildingsWithin(x, z, 60)) if (P.get(b.ref.index).level > 0.5) painted++;
      out.push({ n, faction: a?.faction, stage: a?.stage, painted });
    }
    return out;
  });
  const fell = await page.evaluate(() => {
    const R = window.__recess, A = R.sim.areas, k = A.realm.heart(1), ix = (k >>> 16) << 16 >> 16, iz = (k & 0xffff) << 16 >> 16, x = (ix + 0.5) * 128, z = (iz + 0.5) * 128;
    const outs = [];
    for (let i = 0; i < 9 && A.all.get(k).stage === 5; i++) outs.push(A.hit(x, z, 1, R.sim.t + 5.01 * (i + 1)).outcome);
    return outs;
  });
  await frames(6);
  const fall = await page.evaluate(() => ({ topples: window.__recess.counts.topple ?? 0, heart: (() => { const A = window.__recess.sim.areas, a = A.all.get(A.realm.heart(1)); return { faction: a.faction, stage: a.stage }; })() }));
  row('gods: each camp\'s standing at its heart from the bell, painted there; five hits topple one, said, the heart the attacker\'s', gods.every((h) => h.stage === 5 && h.painted > 0) && fell.at(-1) === 'topple' && fall.topples === 1 && fall.heart.faction === 1 && fall.heart.stage === 1,
    { gods, fell, ...fall });
  // ---- the bell ----
  for (let k = 0; k < 20 && (await page.evaluate(() => window.__recess.phase)) !== 'over'; k++) await frames(30);
  await frames(75);
  const bell = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, c = g.camera.position;
    return { phase: R.phase, simT: +R.sim.t.toFixed(1), camAGL: Math.round(c.y - g.city.groundAt(R.cx, R.cz)), camFromMiddle: Math.round(Math.hypot(c.x - R.cx, c.z - R.cz)), score: R.sim.score().filter((_, i) => [1, 2, 5].includes(i)), hud: document.querySelector('[data-hud=recess]')?.childElementCount ?? 0 };
  });
  await page.screenshot({ path: join(dir, 'scoreboard.png') });
  row('bell: the brain stops, the camera at 1,500 m over the arena, the score up', bell.phase === 'over' && bell.simT <= 30.1 && Math.abs(bell.camAGL - 1500) < 60 && bell.camFromMiddle < 700 && bell.hud === 1, bell);
  const programs1 = await page.evaluate(() => window.__game.pipeline.renderer.info.programs.length);
  row('programs: nothing compiled after the warm-up, the whole match on', programs1 === programs0, { atFirst: programs0, atTheEnd: programs1 });
  // ---- B21: the player's saved city untouched by the match, and nothing of it, nor of the match, loaded by the next one ----
  const after = await paintKeys();
  await open('&recess&recesslen=30&bots=learner');
  const again = await page.evaluate(() => { const P = window.__game.city.paint, n = P.data.length >> 2; let k = 0; for (let i = 0; i < n; i++) if (P.get(i).level > 0.5) k++; return { painted: k, phase: window.__recess.phase }; });
  const same = JSON.stringify(after) === JSON.stringify(SAVED) || Object.entries(SAVED).every(([k, v]) => after[k] === v) && Object.keys(after).every((k) => k in SAVED || k.includes('~recess'));
  row('B21: the saved city\'s paint the same after a match, nothing saved for it, and the next match starts with none painted', same && Object.keys(after).filter((k) => !(k in SAVED)).every((k) => k.includes('~recess')) && again.painted === 0 && again.phase === 'ready',
    { saved: Object.keys(SAVED).length, after: Object.keys(after), nextStarts: again });
  // ---- flag off ----
  await open('&lat=37.7745&lon=-122.43');
  const off = await page.evaluate(() => ({ recess: !!window.__recess, captains: [1, 2].filter((i) => window.__game.scene.getObjectByName(`RecessCaptain${i}`)).length, hud: !!document.querySelector('[data-hud=recess]') }));
  row('flag off: no match, no captains, no clock', !off.recess && off.captains === 0 && !off.hud, off);
  row('no page errors', errors.length === 0, errors.slice(0, 5));
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
