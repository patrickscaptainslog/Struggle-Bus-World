#!/usr/bin/env node
// ?recess on screen, at a fixed step in software graphics: node tools/recess/screen.mjs <out dir>. BASE is the page (http://localhost:4179/). A short match
// (&recesslen=80), Learner captains, so one match shows every row. The phone and the GPU are the producer's and the first account's.
//   kickoff   while the first bell rings, both captains ahead inside 10 degrees of the nose about 500 m off, the camera high behind the bus (kickoff.png)
//   findable  the lens about 40 degrees, pulled back with a rival near; both captains tagged; the fence up; ribbons behind captains 1.4 times bigger
//   up        the page boots into the match: two captains' buses in the scene, in their colours, over the arena, the player on its edge, no Golden Gate opening
//   programs  nothing compiles after the warm-up: the programs at the first frame are the programs 200 frames on
//   paint     the captains paint the real city where their blasts land, saved as theirs and so drawn in their own colours (factions' step 5), and their squares count
//             (paint's owner is Rainbow's in PaintState until factions' step 1 teaches it others)
//   duel      the first duel (SHOTS.md, "The duel"): the easiest captain has the player, its line of beads runs to the bus and its tag flashes; its shot flies,
//             goes white and FLICK! is said; one flick in the white dodges it, DODGED!, inside the match's first 10 s (duel-aim.png, duel-shot.png)
//   splash    only an aimed shot possesses: a real tap whose splat lands by a captain is a splash for show, and the captain flies on its own
//   lock      a still hold on a captain, off the bus's lane: the ring of bubbles closes, shut at the clack and doubled at the full charge (duel-lock.png);
//             the lift's shot homes, and it rides the captain (Possessed) or the captain dodged (tried three times)
//   marker    a captain's shot from behind the player, off the screen: the white chevron at the frame's bottom points back at it
//   possessed the player ridden: the real gear goes to Nonstop, a flick down only wheezes, full right still turns the bus, its hiccups paint the hitter's, on grey
//   hit       Inferno's breath lands through the brain's step: flung, the bus's yellow flooded crimson, and drained back after the ride
//   fence     past the edge flying out, the bus bounces back in, pointing in; &hit=jet's forced gear is Jet
//   gods      each camp's god standing at its heart from the bell, its heart painted; one toppled by hits at the heart, said, and the heart the attacker's
//   bell      at the last bell the brain stops and the camera climbs to 1,500 m over the arena: the painted map, and the score in order (scoreboard.png)
//   freezes   captains paint and nothing freezes: 90 frames on, the game's clock and the match's ran every step (M22)
//   agrees    each building in a captain's colour stands in one of its squares in the brain (M43); the player's own hits froze 2 s at most, the match's clock on (M23)
//   edges     a captain behind the player: its chevron points down, under the clock and over the thumb, its name level (M46); the clock's row under the words' (M61)
//   rings     each god's ring round its heart: whole when the next hit counts, closing again from a hit; a tap on your own god too soon says so (M47)
//   B21       a stand-in saved city in the paint stores' own keys is the same after a match, nothing was saved for it, and the next match starts with none painted
//   hooks     the shots' (HOOKS.md): no Comet in a match, back at the bell; a Bomb's breath on grey jumps its square to 3 and spills the grey round it at 1
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
  const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
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
  await open('&recess&recesslen=80&bots=learner');
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
  // ---- the first duel: the easiest captain's lock at about 3.6 s, its shot, the white, one flick, DODGED! inside 10 s ----
  const fd = { beads: 0, flashed: false, said: [], flew: false, white: false, took: null, at: {} };
  for (let k = 0; k < 190; k++) {
    await frames(1);
    const s = await page.evaluate(() => {
      const g = window.__game, R = window.__recess, D = R.duel, inc = D.incoming[0], id = [1, 2].find((i) => D.aimedBy(i)) ?? 0, line = id ? g.scene.getObjectByName(`RecessLine${id}`) : null;
      const tag = id ? [...document.querySelectorAll('[data-hud=recess-tag]')][id - 1] : null;
      return { t: +R.sim.t.toFixed(2), first: { ...D.first }, aimer: id, beads: line?.visible ? line.count : 0, dim: tag?.style.opacity === '0.25', flying: !!inc?.shot && !inc.shot.done, white: !!inc?.shot && !inc.shot.done && !!inc.shot.white, said: R.said ?? '' };
    });
    if (s.beads > 0 && !fd.beads) await page.screenshot({ path: join(dir, 'duel-aim.png') });
    if (s.flying && !fd.flew) await page.screenshot({ path: join(dir, 'duel-shot.png') });
    fd.beads = Math.max(fd.beads, s.beads);
    fd.flashed ||= s.dim;
    fd.flew ||= s.flying;
    if (s.said && !fd.said.includes(s.said)) fd.said.push(s.said);
    // (one flick, on the first frame that sees the shot white: what a player told FLICK! does)
    if (s.white && fd.took === null) {
      fd.white = true;
      fd.took = await page.evaluate(() => window.__game.controls.flickGate(1));
    }
    fd.at = { ...s.first, simT: s.t };
    if (s.first.ended >= 0) break;
  }
  await frames(4);
  fd.counts = await page.evaluate(() => { const c = window.__recess.counts; return { dodged: c.dodged ?? 0, flickDodge: c.flickDodge ?? 0, hit: c.hit ?? 0 }; });
  fd.said.push(await page.evaluate(() => window.__recess.said ?? ''));
  row('duel: the first shot at the player is told (the line of beads, the flashing tag, FLICK!), and one flick in its white dodges it inside the first 10 s',
    fd.beads >= 8 && fd.flashed && fd.flew && fd.white && fd.took === true && fd.at.how === 'dodged' && fd.at.ended > 0 && fd.at.ended <= 10 && fd.counts.dodged === 1 && fd.said.some((x) => x.includes('FLICK')) && fd.said.some((x) => x.includes('DODGED')), fd);
  // ---- M46 and M61: a captain behind the player, 400 m off: its chevron at the bottom of its frame pointing down, its name level; the clock under the words ----
  // (pinned again every few frames from where the captain is now, so the chase camera has swung round behind the bus when it's read)
  for (let k = 0; k < 8; k++) {
    await page.evaluate(() => {
      const R = window.__recess, b = R.sim.buses[1], x = R.cx + b.x + 280, z = R.cz + b.z + 280;
      window.__qa.pin = { x, y: window.__game.flight.y, z, heading: Math.atan2(x - R.cx - b.x, -(z - R.cz - b.z)) };
    });
    await frames(4, { pin: await page.evaluate(() => window.__qa.pin) });
  }
  const edge = await page.evaluate(() => {
    const R = window.__recess, el = [...document.querySelectorAll('[data-hud=recess-tag]')][0], H = window.innerHeight, rc = el.getBoundingClientRect(), arrow = el.children[0], rot = /rotate\(([-\d.]+)rad\)/.exec(arrow.style.transform);
    const clock = document.querySelector('[data-hud=recess]').getBoundingClientRect().top;
    return { shown: el.style.display !== 'none', midY: Math.round(rc.top + rc.height / 2), H, frameTop: 150, frameBottom: Math.round(H * 0.74), arrowRad: rot ? +(+rot[1]).toFixed(2) : null, nameTurned: /rotate/.test(el.style.transform), clockTop: Math.round(clock), wordsEnd: 10 + 54 + 44, said: R.said };
  });
  await page.evaluate(() => delete window.__qa.pin);
  row('edges: a captain behind points down from the frame\'s bottom, over the thumb and under the clock, its name level; the clock under the words', edge.shown && edge.midY <= edge.frameBottom + 12 && edge.midY >= edge.H * 0.5 && edge.arrowRad !== null && Math.abs(Math.abs(edge.arrowRad) - Math.PI) < 0.7 && !edge.nameTurned && edge.clockTop >= edge.wordsEnd, edge);
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
  // ---- splash: only an aimed shot possesses. Behind captain 1, far enough back that the tap's splat lands where it will be: a splash for show, and no ride ----
  let splash = null;
  for (let k = 0, back = 150; k < 4 && !(splash?.splashes > 0); k++) {
    for (let j = 0; j < 3; j++) {
      await page.evaluate((back) => {
        const R = window.__recess, b = R.sim.buses[1], hg = b.heading + Math.PI / 2;
        window.__qa.pin = { x: R.cx + b.x - Math.sin(hg) * back, y: R.ys?.[1] ?? 80, z: R.cz + b.z + Math.cos(hg) * back, heading: hg };
      }, back);
      await frames(3, { pin: await page.evaluate(() => window.__qa.pin) });
      // (how far past the captain the aim stands, along its way: it should lead it by about a second of its flying)
      const off = await page.evaluate(() => {
        const g = window.__game, R = window.__recess, b = R.sim.buses[1], f = g.flight;
        g.aimer.refresh(f);
        return { past: (g.aimer.aim.x - R.cx - b.x) * Math.cos(b.heading) + (g.aimer.aim.z - R.cz - b.z) * Math.sin(b.heading), lead: b.speed * 0.9 };
      });
      back = Math.max(20, Math.min(600, back + off.past - off.lead));
    }
    const before = await page.evaluate(() => ({ splashes: window.__recess.counts.splash ?? 0, glint: window.__game.aimer.mover?.key ?? null }));
    await page.evaluate(() => { window.__game.flight.barfT = -1; window.__game.flight.fullness = 1; window.__game.tapSplat(); });
    await frames(30, { pin: await page.evaluate(() => window.__qa.pin) });
    splash = await page.evaluate((b) => { const R = window.__recess, c = R.sim.buses[1]; return { glint: b.glint, splashes: (R.counts.splash ?? 0) - b.splashes, ridden: c.state === 'ride' && c.by === 0, state: c.state, picks: R.duel.qa.picks, fired: R.duel.qa.fired }; }, before);
    splash.back = Math.round(back);
  }
  await page.evaluate(() => delete window.__qa.pin);
  row('splash: a tap that lands by a captain is a splash for show: no glint on it, no shot, no ride', !!splash && splash.splashes >= 1 && !splash.ridden && splash.fired === 0 && !/^recess:/.test(splash.glint ?? ''), splash);
  // ---- lock: a still hold on captain 1, drawn up and to the left of the bus, off its lane: the ring closes, clacks and doubles; the lift's shot homes ----
  let lock = null;
  for (let k = 0; k < 3 && !lock?.ok; k++) {
    const pinBy = () => page.evaluate(() => {
      const R = window.__recess, b = R.sim.buses[1], hg = b.heading + Math.PI / 2, fx = Math.sin(hg), fz = -Math.cos(hg);
      return (window.__qa.pin = { x: R.cx + b.x - fx * 230 - fz * 70, y: (R.ys?.[1] ?? 80) - 10, z: R.cz + b.z - fz * 230 + fx * 70, heading: hg });
    });
    for (let j = 0; j < 6; j++) await frames(4, { pin: await pinBy() });
    const at = await page.evaluate(() => {
      const g = window.__game, R = window.__recess, S = R.sim, p = g.scene.getObjectByName('RecessCaptain1').position.clone().project(g.camera), x = (p.x * 0.5 + 0.5) * innerWidth, y = (0.5 - p.y * 0.5) * innerHeight;
      // (the row is the lock's: the captain free to be locked, the belly full, and no earlier pair's rule in the way)
      S.pairs.clear();
      if (S.buses[1].state !== 'free') S.buses[1].state = 'free';
      g.flight.barfT = -1;
      g.flight.fullness = 1;
      return { x: Math.round(x), y: Math.round(y), ahead: p.z < 1, look: g.input.inLookZone(x, y), fired0: R.duel.qa.fired, hits0: R.duel.qa.hits, dodged0: R.counts.theyDodged ?? 0 };
    });
    // (a touch, since a mouse's left button always flies (Input.pointerDown) and never aims; and the page's clock stepped with the frames, since the hold's times
    // are the wall's and a frame of software graphics takes most of a second: the clack and the full charge would land on one frame)
    await page.evaluate(() => { const real = performance.now.bind(performance); window.__clock = { real, t: real() }; performance.now = () => window.__clock.t; });
    const tick = () => page.evaluate(() => (window.__clock.t += 66.667));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    const seen = { locked: -1, clackRing: 0, fullRing: 0, clacked: false, charged: false, owner: '', aimAt: -1 };
    for (let j = 0; j < 22 && !seen.charged; j++) {
      await tick();
      await frames(1, { pin: await pinBy() });
      const s = await page.evaluate(() => { const g = window.__game, D = window.__recess.duel, ring = g.scene.getObjectByName('RecessLock'); return { locked: D.locked, clacked: D.clacked, charged: D.charged, ring: ring.visible ? ring.count : 0, aim: g.input.state.aim.on, owner: g.holds.stats.lastOwner }; });
      seen.locked = Math.max(seen.locked, s.locked);
      seen.owner = s.owner;
      if (s.aim && seen.aimAt < 0) seen.aimAt = j;
      if (s.clacked && !seen.clacked) {
        seen.clacked = true;
        seen.clackRing = s.ring;
        await page.screenshot({ path: join(dir, 'duel-lock.png') });
      }
      if (s.charged) {
        seen.charged = true;
        seen.fullRing = s.ring;
      }
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    for (let j = 0; j < 2; j++) {
      await tick();
      await frames(1, { pin: await pinBy() });
    }
    const fired = await page.evaluate((a) => window.__recess.duel.qa.fired - a.fired0, at);
    await page.evaluate(() => { delete window.__qa.pin; performance.now = window.__clock.real; });
    await frames(45);
    const end = await page.evaluate((a) => { const R = window.__recess, c = R.sim.buses[1], q = R.duel.qa; return { hits: q.hits - a.hits0, misses: q.misses, why: q.why, theyDodged: (R.counts.theyDodged ?? 0) - a.dodged0, rode: c.state === 'ride' && c.by === 0, state: c.state }; }, at);
    lock = { at, ...seen, fired, ...end };
    lock.ok = at.look && seen.locked === 1 && seen.clacked && seen.clackRing === 14 && seen.charged && seen.fullRing === 28 && fired === 1 && (end.rode || end.theyDodged >= 1);
  }
  row('lock: a still hold on a captain closes the ring, shut at the clack and doubled at the full charge; the lift\'s shot rides it, or it dodged', !!lock?.ok, lock);
  // ---- marker: captain 2 behind the player fires: its shot is off the screen, and the white chevron at the frame's bottom points back at it ----
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => {
      const R = window.__recess, b = R.sim.buses[2], hg = b.heading + Math.PI / 2;
      window.__qa.pin = { x: R.cx + b.x + Math.sin(hg) * 320, y: R.ys?.[2] ?? 80, z: R.cz + b.z - Math.cos(hg) * 320, heading: hg };
    });
    await frames(4, { pin: await page.evaluate(() => window.__qa.pin) });
  }
  await page.evaluate(() => window.__recess.duel.captainFire(2));
  await frames(2, { pin: await page.evaluate(() => window.__qa.pin) });
  const marker = await page.evaluate(() => {
    const R = window.__recess, D = R.duel, inc = D.incoming.find((x) => x.shot && !x.shot.done), el = [...document.querySelectorAll('[data-hud=recess-tag]')].pop(), H = window.innerHeight, rc = el.getBoundingClientRect(), rot = /rotate\(([-\d.]+)rad\)/.exec(el.children[0].style.transform);
    const got = { flying: !!inc, from: inc?.from ?? 0, shown: el.style.display !== 'none', midY: Math.round(rc.top + rc.height / 2), H, arrowRad: rot ? +(+rot[1]).toFixed(2) : null, capFired: D.qa.capFired, refused: D.qa.capRefused };
    // (the row is the marker's: the shot is called off, so the rows after it start from a bus that wasn't hit)
    inc?.shot.cancel();
    return got;
  });
  await page.screenshot({ path: join(dir, 'duel-marker.png') });
  await page.evaluate(() => delete window.__qa.pin);
  await frames(2);
  row('marker: a captain\'s shot from behind, off the screen, is the white chevron at the frame\'s bottom, pointing back', marker.flying && marker.from === 2 && marker.shown && marker.midY >= marker.H * 0.5 && marker.arrowRad !== null && Math.abs(Math.abs(marker.arrowRad) - Math.PI) < 0.9, marker);
  // ---- possessed: the player ridden by Inferno ----
  // (Inferno's breath, white-hot and on the player, landing on the next step: the hit through the brain's own events, as a captain's lands)
  // (the bus's own yellow: what its colours drain back to)
  const ramp0 = await page.evaluate(() => window.__recess.busRamp.filter((r) => r === 14).length);
  await page.evaluate(() => {
    const S = window.__recess.sim, me = S.buses[0];
    me.state = 'free';
    // (on the next step where the bus will be then, and a fresh pair: an earlier hit may have it at Nonstop already, and Inferno may have ridden it twice)
    S.pairs.clear();
    const nx = me.x + Math.cos(me.heading) * me.speed * S.dt, nz = me.z + Math.sin(me.heading) * me.speed * S.dt;
    S.breaths.push({ id: 9999, from: 2, target: 0, x: nx, z: nz, tx: nx, tz: nz, vx: 0, vz: 0, arrive: S.t + S.dt * 0.5, born: S.t - 1, white: true });
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
  // ---- M23 and M43: the city's paint agrees with the brain: each building a captain's colour owns stands in a square of that faction's ----
  const agree = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, A = R.sim.areas, P = g.city.paint;
    // (M43, as each blast landed: the buildings a captain's blast painted, its faction's within its circle and bloomed as it landed, stand in its own square)
    let took = 0, inSquare = 0;
    const off = (g.splatter?.t ?? R.now) - R.now;
    for (const p of R.painted.filter((q) => q.at < R.now - 1.5))
      for (const n of g.city.buildingsWithin(p.x, p.z, p.r + 25)) {
        const r = P.get(n.ref.index);
        if (r.level < 0.5 || r.faction !== p.faction || Math.abs(r.bloomTime - off - p.at) > 1.2) continue;
        took++;
        const k = (((Math.floor((n.ref.cx - R.cx) / 128) & 0xffff) << 16) | (Math.floor((n.ref.cz - R.cz) / 128) & 0xffff)) >>> 0;
        if (k === p.key) inSquare++;
      }
    let painted = 0, agrees = 0;
    for (const { ref } of g.city.buildingsWithin(R.cx, R.cz, 900)) {
      const r = P.get(ref.index);
      if (r.level < 0.5 || (r.faction !== 2 && r.faction !== 5)) continue;
      painted++;
      if (A.get(ref.cx - R.cx, ref.cz - R.cz)?.faction === r.faction) agrees++;
    }
    return { took, inSquare, landedShare: took ? +(inSquare / took).toFixed(3) : 0, painted, agrees, endShare: painted ? +(agrees / painted).toFixed(3) : 0, frozenS: +R.frozen.toFixed(3), lagS: +R.lag.toFixed(3) };
  });
  // (the end state is printed too: a square a rival later took or knocked grey keeps the old paint its new owner's blast didn't reach)
  row('paint agrees: every building a captain\'s blast paints is in its own square; the player\'s hits froze at most 2 s, the match\'s clock on through them', agree.took > 20 && agree.landedShare >= 0.97 && agree.frozenS <= 2 && Math.abs(agree.lagS - agree.frozenS) < 0.2, agree);
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
    // (the duel's own door: a captain's shot that reached the bus lands at the next step, as Duel.ts hands it over)
    S.aimedHit(1, 0);
  });
  const jet0 = await page.evaluate(() => ({ ...window.__recess.counts }));
  await frames(20);
  const jet = await page.evaluate((c0) => {
    const R = window.__recess, d = {};
    for (const k of ['hit', 'miss', 'bounce', 'sparkle', 'fire']) d[k] = (R.counts[k] ?? 0) - (c0[k] ?? 0);
    return { state: R.sim.buses[0].state, gear: window.__game.controls.turbo.gear, phase: R.phase, simT: +R.sim.t.toFixed(1), ...d };
  }, jet0);
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
  // ---- M47: the gods' rings: whole round a god whose next hit counts; a hit starts one closing again; your own god tapped too soon says so ----
  const ring0 = await page.evaluate(() => window.__recess.rings.map((r) => ({ shown: r.visible, count: r.count })));
  const ringHit = await page.evaluate(() => {
    const R = window.__recess, A = R.sim.areas, k = A.realm.heart(2), ix = (k >>> 16) << 16 >> 16, iz = (k & 0xffff) << 16 >> 16;
    A.hit((ix + 0.5) * 128, (iz + 0.5) * 128, 2, R.sim.t);
    const mine = A.realm.heart(0), mx = (((mine >>> 16) << 16 >> 16) + 0.5) * 128, mz = ((((mine & 0xffff) << 16) >> 16) + 0.5) * 128, g = window.__game;
    A.all.get(mine).last = R.sim.t;
    R.playerPaint(R.cx + mx, R.cz + mz, g.clock());
    return { owner: A.all.get(mine).faction };
  });
  await frames(3);
  const ring1 = await page.evaluate(() => ({ rings: window.__recess.rings.map((r) => ({ shown: r.visible, count: r.count })), said: window.__recess.said, tooSoon: window.__recess.counts.tooSoon ?? 0 }));
  row('rings: a whole ring round each god whose next hit counts; a hit starts its ring closing again; your own god tapped too soon says so', ring0.every((r) => r.shown && r.count === 40) && ring1.rings[2].count < 8 && ring1.rings[1].count === 40 && ring1.tooSoon === 1,
    { ring0: ring0.map((r) => r.count), ring1: ring1.rings.map((r) => r.count), tooSoon: ring1.tooSoon, said: ring1.said, ...ringHit });
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
  // ---- HOOKS.md: no Comet while the match is on; a Bomb III on a grey square jumps it to 3 at once and spills the grey squares its circle reaches ----
  const bomb = await page.evaluate(() => {
    const R = window.__recess, A = R.sim.areas, g = window.__game;
    // (a grey square inside the arena, with its neighbours grey too)
    let at = null;
    for (let r = 200; r < 640 && !at; r += 64)
      for (let k = 0; k < 24 && !at; k++) {
        const x = Math.cos(k / 3.82) * r, z = Math.sin(k / 3.82) * r, kx = Math.floor(x / 128), kz = Math.floor(z / 128);
        let grey = true;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) grey &&= !(A.get((kx + dx + 0.5) * 128, (kz + dz + 0.5) * 128)?.faction);
        if (grey) at = { x: (kx + 0.5) * 128, z: (kz + 0.5) * 128 };
      }
    if (!at) return { at: null };
    R.playerPaint(R.cx + at.x, R.cz + at.z, g.clock(), { jump: 3, superId: 99001, r: 150 });
    return { at, clampPlaying: g.comet.clamp ? g.comet.clamp({ x: 0, z: 0 }) : null };
  });
  await frames(3);
  const bombAfter = await page.evaluate((at) => {
    if (!at) return null;
    const A = window.__recess.sim.areas, s = A.get(at.x, at.z), n = A.get(at.x + 128, at.z);
    return { stage: s?.stage ?? 0, faction: s?.faction ?? 0, neighbour: n ? [n.faction, n.stage] : null, bombs: window.__recess.counts.bomb ?? 0 };
  }, bomb.at);
  // ---- the bell ----
  for (let k = 0; k < 44 && (await page.evaluate(() => window.__recess.phase)) !== 'over'; k++) await frames(30);
  await frames(75);
  const bell = await page.evaluate(() => {
    const g = window.__game, R = window.__recess, c = g.camera.position;
    return { phase: R.phase, simT: +R.sim.t.toFixed(1), camAGL: Math.round(c.y - g.city.groundAt(R.cx, R.cz)), camFromMiddle: Math.round(Math.hypot(c.x - R.cx, c.z - R.cz)), score: R.sim.score().filter((_, i) => [1, 2, 5].includes(i)), hud: document.querySelector('[data-hud=recess]')?.childElementCount ?? 0 };
  });
  await page.screenshot({ path: join(dir, 'scoreboard.png') });
  const clampOver = await page.evaluate(() => (window.__game.comet.clamp ? window.__game.comet.clamp({ x: 0, z: 0 }) : null));
  row('hooks: no Comet while the match is on, back at the bell; a Bomb III on grey jumps its square to 3 and spills the grey round it at 1', bomb.clampPlaying === false && clampOver === true && bombAfter?.stage === 3 && bombAfter.faction === 1 && bombAfter.neighbour?.[0] === 1 && bombAfter.neighbour?.[1] === 1,
    { clampPlaying: bomb.clampPlaying, clampOver, at: bomb.at, ...bombAfter });
  row('bell: the brain stops, the camera at 1,500 m over the arena, the score up', bell.phase === 'over' && bell.simT <= 80.1 && Math.abs(bell.camAGL - 1500) < 60 && bell.camFromMiddle < 700 && bell.hud === 1, bell);
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
