#!/usr/bin/env node
// The one link, ?show, flown as the producer will fly it (docs/specs/factions/LIFT.md, "Taking the block"; SWERVE.md, "The one link"): the handling, the
// rival buses, the faction button for the page, life, the shots, Inferno's floating block and the Earth flight all on, no &hoodstart, no &skipintro. Every
// thumb is a real touch (CDP): under ?swerve the stick is the handling's, and the tool never sets the QA stick. The bus is pinned (__qa.pin) only to stand
// it where a tap's glint is on a house it means to hit; the tap itself is a real one. Each leg on a fresh page (the faction button's pick is the tab's):
//   producer  the opening under the Golden Gate and how far the start is from the block; the camera's one glance toward the block's light as the opening
//             hands over; a real flick to Nonstop and a real thumb steering at the heart; the block waking ahead of the bus; then real taps on a square of
//             the block, one each 2.6 s from its ready time: the paint is the bus's (Rainbow), and the square parries inside its 5 s, cracks, falls, wilts
//             and flips by the rules (liftRules' hit, wrapped to log its hitter and outcome); the same on the heart until it flips, and the block's light
//             relit in the taker's colours; no page error, no program after the warm-up, the draws and triangles all the way (and the sun pass's share)
//   crew      the faction button with real taps: Atlantis picked, a tap off the block and one on a square are Atlantis's (paint and hitter); Inferno
//             picked, the hits on Inferno's block are the owner's and nothing cracks
//   rivals    four rival buses put painting the block's squares round the bus, 24 s: no square's record changes, nothing lifts (decision (d)); then the
//             faction button set to one of their crews and the same again
//   far       the far Lob from 5 km up onto a square (counted once, its ring on the square), the Comet at Turbo 3 through the sky piece (a hit on the heart),
//             then a Sonic Boom's ring barfed on a ready square (no square taken: the producer's fifth call)
// Prints pass or FAIL a line; writes <out>/take-show-<leg>.json; exit 1 on any failure.
//
//   node tools/factions/take-show.mjs <url> <outDir> [--leg=producer|crew|rivals|far] [--q=<query>]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserOptions } from '../browser.mjs';
import { flick, flickTo } from '../flick.mjs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => (a.includes('=') ? [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a.slice(2), true])));
const base = pos[0] ?? 'http://127.0.0.1:4179/';
const out = resolve(pos[1] ?? 'shots/tmp/take-show');
mkdirSync(out, { recursive: true });
const Q = opt.q ?? '?show';
const LEG = opt.leg ?? 'producer';
const RB = 1, ATL = 2, INF = 5;

let failed = 0;
const log = [];
const R = { q: Q, leg: LEG, log };
function report(name, value, limit, ok) {
  if (!ok) failed++;
  log.push({ name, value, limit, ok });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${value}  (${limit})`);
}

const browser = await chromium.launch({ ...browserOptions([]) });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
let errors = 0;
page.on('pageerror', (e) => {
  errors++;
  console.log('[pageerror]', e.message);
});
page.on('console', (m) => {
  if (m.type() !== 'error' || m.text().startsWith('Failed to load resource')) return;
  errors++;
  console.log('[console error]', m.text().slice(0, 1500));
});
await page.addInitScript(() => {
  const W = (window.__tk = { programs: [] });
  const cp = WebGL2RenderingContext.prototype.createProgram, ss = WebGL2RenderingContext.prototype.shaderSource;
  WebGL2RenderingContext.prototype.shaderSource = function (sh, src) {
    if (window.__tkLate) (W.late ??= []).push(src.split(String.fromCharCode(10)).filter((l) => /^#define|^uniform|^\/\/ ?SB|^#include/.test(l.trim())).slice(0, 60).join(' | ').slice(0, 1600));
    return ss.call(this, sh, src);
  };
  WebGL2RenderingContext.prototype.createProgram = function () {
    W.programs.push(Math.round(performance.now()));
    // (after the warm-up: who asked, by the chunks on its stack)
    if (window.__tkLate) (W.stacks ??= []).push((new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 14).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < '));
    (W.phases ??= []).push(`${window.__ts?.phase ?? 'boot'} (game ${window.__game?.clock ? window.__game.clock().toFixed(2) : '-'} s)`);
    return cp.call(this);
  };
});
await page.goto(base + Q, { waitUntil: 'load' });
await page.waitForFunction(() => {
  const g = window.__game, w = g?.warm;
  return !!g && !!w?.report && !w.running && w.report.programs >= g.pipeline.renderer.info.programs.length;
}, null, { timeout: 240000, polling: 100 });
const warmDoneAt = await page.evaluate(() => ((window.__tkLate = true), Math.round(window.__game.warm?.doneAt || performance.now())));
const cdp = await page.context().newCDPSession(page);
const wait = (fn, arg, timeout = 240000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const clock = () => page.evaluate(() => window.__game.clock());
const until = async (t) => wait((t) => window.__game.clock() >= t, t);
const after = async (dt) => until((await clock()) + dt);
const state = () => page.evaluate(() => window.__game.lift.takeState());
const sq = async (k) => (await state()).find((s) => s.key === k);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id = 1]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
/** a real tap: a still touch of 60 ms at (x, y), off the bus's lane (the look's side of the glass: a still lift there is a tap) */
const tap = async (x = 300, y = 260, id = 7) => {
  await touch('touchStart', [[x, y, id]]);
  await page.waitForTimeout(60);
  await touch('touchEnd', []);
};
/** a real tap on a HUD element by its data-hud (its centre) */
const tapHud = async (key) => {
  const r = await page.evaluate((k) => {
    const e = document.querySelector(`[data-hud="${k}"]`);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return b.width > 0 && getComputedStyle(e).display !== 'none' ? [b.x + b.width / 2, b.y + b.height / 2] : null;
  }, key);
  if (r) await tap(r[0], r[1], 8);
  return r;
};

// the sampler: each frame the draws and triangles (Perf's whole frame) into the phase's most, a phase named by the tool, with the sun pass's share of that
// frame and its draws by who drew them (the nearest named object up the scene graph, else the top-level object's place); the rules' hits logged with their
// hitter and outcome (TakeRules.hit wrapped), and the blasts the Lift was told of (Lift.landed wrapped: faction, tag, where)
await page.evaluate(() => {
  const g = window.__game, p = g.perf, L = g.lift, S = (window.__ts = { phase: 'warm', max: {}, hits: [], landed: [], glance: [] });
  const pl = g.pipeline, r = pl.renderer, info = r.info.render;
  const F = { sunCalls: 0, sunTris: 0, inSun: false, by: new Map() };
  const label = (o) => {
    let n = o;
    while (n && !n.name && n.parent && !n.parent.isScene) n = n.parent;
    if (n?.name) return n.name;
    const top = n ?? o;
    return `${top.type}#${top.parent ? top.parent.children.indexOf(top) : -1}`;
  };
  const od = pl.drawSun.bind(pl);
  pl.drawSun = (scene, cam) => {
    const c0 = info.calls, t0 = info.triangles;
    F.inSun = true;
    od(scene, cam);
    F.inSun = false;
    F.sunCalls += info.calls - c0;
    F.sunTris += info.triangles - t0;
  };
  const orb = r.renderBufferDirect.bind(r);
  r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
    const k = `${F.inSun ? 'sun' : 'view'} ${label(object)}`;
    F.by.set(k, (F.by.get(k) ?? 0) + 1);
    return orb(camera, scene, geometry, material, object, group);
  };
  const of = p.frame.bind(p);
  p.frame = (dt, work) => {
    of(dt, work);
    const m = (S.max[S.phase] ??= { calls: 0, tris: 0, frames: 0 });
    if (p.calls > m.calls) {
      m.at = [+g.clock().toFixed(2), Math.round(g.flight.x - L.heart[0]), Math.round(g.flight.y), Math.round(g.flight.z - L.heart[1]), +g.flight.heading.toFixed(2)];
      m.sun = [F.sunCalls, F.sunTris];
      m.by = [...F.by].sort((a, b) => b[1] - a[1]).slice(0, 24);
    }
    F.sunCalls = F.sunTris = 0;
    F.by.clear();
    m.calls = Math.max(m.calls, p.calls);
    m.tris = Math.max(m.tris, p.tris);
    m.frames++;
    // (the glance: the rig's yaw from the game, and how far the view's way is off the heart's, degrees)
    if (g.rig.glance !== null || S.glance.length && S.glance[S.glance.length - 1][1] !== null) {
      const d = g.camera.getWorldDirection(new g.camera.position.constructor()), hx = L.heart[0] - g.camera.position.x, hz = L.heart[1] - g.camera.position.z;
      const off = Math.atan2(d.x * hz - d.z * hx, d.x * hx + d.z * hz);
      S.glance.push([+g.clock().toFixed(2), g.rig.glance === null ? null : +((g.rig.glance * 180) / Math.PI).toFixed(1), +((Math.abs(off) * 180) / Math.PI).toFixed(1)]);
    }
  };
  const oh = L.rules.hit.bind(L.rules);
  L.rules.hit = (x, z, faction, t, o) => {
    const h = oh(x, z, faction, t, o);
    S.hits.push({ t: +t.toFixed(2), x: Math.round(x), z: Math.round(z), faction, outcome: h ? h.outcome : null, key: h ? h.area.key : null, stage: h ? h.area.stage : null });
    return h;
  };
  const ol = L.landed.bind(L);
  L.landed = (b) => {
    // (the tag is the blast's own, Splat's b.tag: the rivals' { rivals: 'quiet' | 'loud' }, else none)
    S.landed.push({ t: +b.t.toFixed(2), faction: b.spec.faction ?? null, tag: b.tag === undefined ? 'none' : b.tag?.rivals ?? 'other', x: Math.round(b.pos.x), z: Math.round(b.pos.z), via: b.via ?? 0 });
    return ol(b);
  };
});
const phase = (p) => page.evaluate((p) => (window.__ts.phase = p), p);
const hitsSince = (t) => page.evaluate((t) => window.__ts.hits.filter((h) => h.t >= t), t);

/** in the page: is the next tap aimed at square `S` (key, x, z, houses)? Its glint on one of its houses, or, for a square with none (a park heart), no glint
 *  and the breath's landing (aimNow) inside it; and the line of fire off the sky piece (`sky` true: through it, which counts on the heart; null: either) */
const AIMED = ([S, sky]) => {
  const g = window.__game, gl = g.glintNow(), a = g.aimNow();
  g.forceReady();
  if (sky !== null && g.aimer.skyAimed !== sky) return false;
  if (sky === true) return true;
  if (S.houses.length) return !!gl && S.houses.includes(gl.index);
  return !gl && Math.abs(a.x - S.x) < 60 && Math.abs(a.z - S.z) < 60;
};
/** stands the bus (pinned) where the next tap is aimed at square `S` (AIMED): from 25 to 110 m over its highest house's drawn top (its ground for none),
 *  60 to 320 m back, from four sides: the pose, or null */
async function aimAt(S, sky = false) {
  const tgt = await page.evaluate((S) => {
    const g = window.__game, L = g.lift, i = S.houses.slice().sort((a, b) => L.H[b] - L.H[a])[0], r = i === undefined ? null : L.refs.get(i);
    if (!r) return { x: S.x, z: S.z, top: g.city.groundAt(S.x, S.z) };
    return { x: r.cx, z: r.cz, top: r.roofY + L.dy(i) };
  }, S);
  for (const d of sky ? [300, 600, 1200] : [140, 220, 320, 90, 60])
    for (const up of sky ? [20, 80, 200] : [25, 60, 110])
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        // (heading a flies along (sin a, -cos a): the bus d m back from the target the other way; through the piece: over its top)
        const top = sky ? await page.evaluate(() => { const b = window.__game.lift.sky?.boxes; let y = -Infinity; if (b) for (let k = 0; k + 5 < b.length; k += 6) y = Math.max(y, b[k + 4]); return y; }) : tgt.top;
        // (the piece gone between the ask and the pose: no pose through it)
        if (!Number.isFinite(top)) return null;
        const pin = { x: tgt.x - Math.sin(a) * d, z: tgt.z + Math.cos(a) * d, y: top + up, heading: a, speed: 0 };
        await page.evaluate((p) => ((window.__qa = window.__qa ?? {}), (window.__qa.pin = p), window.__game.forceReady()), pin);
        await after(0.3);
        if (await page.evaluate(AIMED, [S, sky])) return pin;
      }
  return null;
}
/** a real tap with the bus aimed at square `S` (re-aimed if it left it): the shot ({t, land, target}) or null */
async function tapOn(S, sky = false) {
  if (!(await page.evaluate(AIMED, [S, sky])) && !(await aimAt(S, sky))) return null;
  await page.evaluate(() => window.__game.forceReady());
  const t0 = await clock();
  await tap();
  await wait((t) => (window.__game.lastShot()?.t ?? -1) >= t, t0 - 0.001, 5000).catch(() => {});
  const s = await page.evaluate(() => window.__game.lastShot());
  if (!s || s.t < t0 - 0.001) return null;
  await until(s.t + s.travel + 0.15);
  return { t: s.t, land: s.t + s.travel, target: s.target?.index ?? null, comet: s.comet?.kind ?? (s.comet ? 'comet' : null) };
}
/** the start of every leg after the producer's: the opening let run, then the bus pinned 700 m south of the heart, 200 m up, and a knock on a staged
 *  square (the Lift's own QA hit, before the wave: it wakes the block and counts for nothing), the squares let settle */
async function toBlock() {
  await wait(() => !window.__game.controls.opening, null, 120000);
  // (the Golden Gate's gate opens on the bus's way along: until then the gears are locked and the rivals wait (rivalsBoot's frame, off))
  await wait(() => !window.__game.controls.gearsLocked, null, 60000);
  // (and the bridge's low shot let go: a real flick to Nonstop and 8 s on, past 1.5 km from the bridge, so a bus stood on any heading isn't under its
  // gate again (main.ts: openingBridge stays until the low shot has gone and the bus is past it), then back to Cruise)
  await after(3);
  // (a flick that didn't take says what the page was doing, then goes again once)
  await flickTo(page, cdp, 2).catch(async (e) => {
    R.flickMiss = await page.evaluate(() => ({ gear: window.__game.controls.turbo.name, locked: window.__game.controls.gearsLocked, opening: window.__game.controls.opening, t: window.__game.clock(), input: { ...window.__game.input.state, aim: null, bomb: null } }));
    console.log('a flick to Nonstop did not take:', String(e).slice(0, 120), JSON.stringify(R.flickMiss));
    await after(2);
    await flickTo(page, cdp, 2);
  });
  await after(8);
  await wait(() => window.__game.rig.openingLow === 0, null, 30000);
  await flickTo(page, cdp, 0);
  await page.evaluate(() => {
    const g = window.__game, L = g.lift;
    window.__qa = { pin: { x: L.heart[0], z: L.heart[1] + 700, y: g.city.groundAt(L.heart[0], L.heart[1] + 700) + 200, heading: 0, speed: 0 } };
  });
  await wait(() => window.__game.lift.staged, null, 120000);
  await page.evaluate(() => {
    const g = window.__game, L = g.lift, r = L.stagedRects;
    if (L.waveAt < 0) L.qaHit((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, 1, 0);
  });
  await wait(() => window.__game.lift.waveAt > 0, null, 30000);
  await wait(() => window.__game.lift.takeState().filter((s) => !s.heart && s.houses.length >= 3 && s.readyAt <= window.__game.lift.now).length >= 3, null, 120000);
}
const readySquares = async () => {
  const [st, t] = [await state(), await page.evaluate(() => window.__game.lift.now)];
  return st.filter((s) => !s.heart && s.houses.length >= 3 && s.readyAt <= t);
};
/** each square's record: owner, stage, cracks, houses up and falling, its houses' session paint (its last change is left out: a seeded square's first
 *  ready time comes in as its houses settle) */
const records = async () => (await state()).map((s) => [s.key, s.owner, s.stage, s.cracks, s.up, s.falling, s.paint.map((p) => p.join(':')).join(',')].join('/'));

try {
  if (LEG === 'producer') await producer();
  else if (LEG === 'crew') await crewLeg();
  else if (LEG === 'rivals') await rivalsLeg();
  else if (LEG === 'far') await farLeg();
  else report('the leg', LEG, 'producer, crew, rivals or far', false);
} catch (e) {
  report(`the ${LEG} leg ran to its end`, String(e?.stack ?? e).slice(0, 600), 'no error', false);
}

const late = await page.evaluate((t) => window.__tk.programs.map((p, k) => [p, window.__tk.phases[k]]).filter(([p]) => p > t), warmDoneAt);
const atHit = await page.evaluate(() => window.__ts.hits.map((h) => [h.t, h.outcome]));
report('programs made after the warm-up', `${late.length}${late.length ? ` (${late.map(([p, ph]) => `${ph} at ${((p - warmDoneAt) / 1000).toFixed(1)} s past the warm-up`).join(', ')})` : ''}`, '0', late.length === 0);
R.late = late.map(([p, ph]) => [p - warmDoneAt, ph]);
R.lateSrc = await page.evaluate(() => window.__tk.late ?? []);
R.lateStacks = await page.evaluate(() => window.__tk.stacks ?? []);
R.hitsAt = atHit;
report('page and console errors', String(errors), '0', errors === 0);
const ts = await page.evaluate(() => window.__ts);
const draws = Object.entries(ts.max).filter(([k]) => k !== 'warm');
report('draws and triangles through the leg, the most in each phase', draws.map(([k, m]) => `${k} ${m.calls} / ${(m.tris / 1e6).toFixed(2)} M (the sun pass ${m.sun ? `${m.sun[0]} / ${(m.sun[1] / 1e6).toFixed(2)} M` : '-'} of that frame; the most draws at ${JSON.stringify(m.at)}: game s, the bus off the heart x, its y, off z, heading)`).join('; '), 'at most 200 draws and 1.5 M triangles', draws.every(([, m]) => m.calls <= 200 && m.tris <= 1.5e6));
Object.assign(R, { hits: ts.hits, landed: ts.landed.slice(-200), glance: ts.glance, max: ts.max });
await browser.close();
writeFileSync(`${out}/take-show-${LEG}.json`, JSON.stringify(R, null, 1));
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

// ---------------------------------------------------------------- the producer's flight
async function producer() {
  const where = () => page.evaluate(() => {
    const g = window.__game, L = g.lift, f = g.flight, r = L.stagedRects;
    let dh = Infinity;
    for (let k = 0; k < r.length; k += 4) dh = Math.min(dh, Math.hypot(Math.max(r[k] - f.x, 0, f.x - r[k + 2]), Math.max(r[k + 1] - f.z, 0, f.z - r[k + 3])));
    const hx = L.heart[0] - f.x, hz = L.heart[1] - f.z;
    let off = Math.atan2(hx, -hz) - f.heading;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    return { t: +g.clock().toFixed(2), dh: dh === Infinity ? null : Math.round(dh), heart: Math.round(Math.hypot(hx, hz)), h: Math.round(f.y - (L.heartY || g.city.groundAt(L.heart[0], L.heart[1]))), off: Math.round((off * 180) / Math.PI), speed: Math.round(f.ground), gear: g.controls.turbo.name, waveAt: +L.waveAt.toFixed(2), slip: +(((g.flight.swerve?.slip ?? 0) * 180) / Math.PI).toFixed(1) };
  });
  await phase('opening');
  const w0 = await where();
  R.start = w0;
  report('the start: under the Golden Gate, far from the block, its wave not begun', `${w0.heart} m from the heart, ${w0.h} m over its ground, the heart ${w0.off} degrees off the heading, the wave at ${w0.waveAt}`, 'over 3 km; not begun (-1)', w0.heart > 3000 && w0.waveAt < 0);
  const fac = await page.evaluate(() => [window.__game.splatter.faction, !!window.__rivals, window.__game.flight.swerve.on, !!window.__game.lift?.beam]);
  report('the page: the bus Rainbow\'s, the rivals out, the handling on, the block\'s light up', fac.join(', '), '1, true, true, true', fac[0] === RB && fac[1] && fac[2] && fac[3]);
  // (the opening with nobody touching: the glance, as the gate opens, and its end)
  await wait(() => !window.__game.controls.opening, null, 120000);
  const openEnd = await clock();
  await wait(() => window.__ts.glance.length > 0 && window.__ts.glance[window.__ts.glance.length - 1][1] === null, null, 30000).catch(() => {});
  const gl = await page.evaluate(() => window.__ts.glance);
  const on = gl.filter((s) => s[1] !== null);
  if (on.length) {
    const most = on.reduce((m, s) => (Math.abs(s[1]) > Math.abs(m[1]) ? s : m));
    report('the camera\'s one glance toward the block\'s light as the opening hands over', `from ${on[0][0]} s to ${on[on.length - 1][0]} s (the opening ended at ${openEnd.toFixed(2)}): at most ${most[1]} degrees, the view ${on[0][2]} degrees off the heart at its start and ${Math.min(...on.map((s) => s[2]))} at the least; one glance: ${gl.filter((s, k) => s[1] !== null && (k === 0 || gl[k - 1][1] === null)).length}`,
      'one, about 2.1 s, the view within 10 degrees of the heart at its most', gl.filter((s, k) => s[1] !== null && (k === 0 || gl[k - 1][1] === null)).length === 1 && Math.min(...on.map((s) => s[2])) < 10 && on[on.length - 1][0] - on[0][0] > 1.5);
  } else report('the camera\'s one glance toward the block\'s light as the opening hands over', `none seen by ${(await clock()).toFixed(2)} s (the opening ended at ${openEnd.toFixed(2)})`, 'one', false);
  // (the gate opens on the bus's way along, not on the clock: wait for the gears)
  await wait(() => !window.__game.controls.gearsLocked, null, 60000);
  await phase('to-the-block');
  await flickTo(page, cdp, 2);
  const g2 = await page.evaluate(() => window.__game.controls.turbo.name);
  report('a real flick up twice: Nonstop', g2, 'NONSTOP', g2 === 'NONSTOP');
  // (the thumb down in the lane under the bus, and which way a 40 px stroke right turns the bus)
  const X0 = 196, Y0 = 720;
  await touch('touchStart', [[X0, Y0]]);
  for (let i = 1; i <= 4; i++) {
    await page.waitForTimeout(20);
    await touch('touchMove', [[X0 + i * 10, Y0]]);
  }
  const h0 = await page.evaluate(() => window.__game.flight.heading);
  await after(0.6);
  const turn = Math.sign((await page.evaluate(() => window.__game.flight.heading)) - h0) || 1;
  let wave = null, most = { slip: 0, hard: 0 };
  const t0 = await clock();
  while (wave === null && (await clock()) < t0 + 90) {
    // (the thumb's way to the heart: at most 70 px, inside the smooth part of the handling's stick (hard from 78 px))
    const e = await page.evaluate(() => {
      const g = window.__game, L = g.lift, f = g.flight;
      const e = Math.atan2(L.heart[0] - f.x, -(L.heart[1] - f.z)) - f.heading;
      return Math.atan2(Math.sin(e), Math.cos(e));
    });
    await touch('touchMove', [[X0 + Math.max(-70, Math.min(70, 140 * e * turn)), Y0]]);
    const w = await where();
    most.slip = Math.max(most.slip, Math.abs(w.slip));
    most.hard = Math.max(most.hard, await page.evaluate(() => window.__swerve?.core?.hard ?? 0));
    if (w.waveAt > 0) wave = w;
    await page.waitForTimeout(60);
  }
  await touch('touchEnd', []);
  R.wave = wave;
  report('the block wakes ahead of the bus flown to it at Nonstop by a real thumb', wave ? `at ${wave.t} s: ${wave.dh} m from the block, ${wave.h} m over the heart's ground, the heart ${wave.off} degrees off the heading and ${wave.heart} m off, ${wave.speed} m/s in ${wave.gear}; the stick's most: slip ${most.slip} degrees, hard ${most.hard.toFixed(2)}` : 'no wave in 90 s',
    'a wave, the bus not in the block yet (over 0 m from it)', !!wave && wave.dh !== null && wave.dh > 0);
  if (!wave) return;
  // (a real flick down to Cruise: the producer comes in to paint)
  await flickTo(page, cdp, 0);
  await wait(() => window.__game.lift.takeState().filter((s) => !s.heart && s.houses.length >= 3 && s.readyAt <= window.__game.lift.now).length >= 3, null, 120000);
  await phase('fight');
  // ---- a real tap off the block: the bus's paint
  {
    const off = await page.evaluate(() => {
      const g = window.__game, L = g.lift;
      for (const [ox, oz] of [[0, 900], [900, 0], [0, -900], [-900, 0]]) {
        const x = L.heart[0] + ox, z = L.heart[1] + oz;
        if (!L.refuses(x, z, 0)) return { x, z };
      }
      return null;
    });
    let shot = null;
    if (off)
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        await page.evaluate(([p, a]) => {
          const g = window.__game;
          window.__qa = { pin: { x: p.x, z: p.z, y: g.city.groundAt(p.x, p.z) + 40, heading: a, speed: 0 } };
        }, [off, a]);
        await after(0.5);
        const ok = await page.evaluate(() => {
          const g = window.__game, gl = g.glintNow();
          return !!gl && !g.lift.refuses(gl.cx, gl.cz, 0);
        });
        if (!ok) continue;
        await page.evaluate(() => window.__game.forceReady());
        const t = await clock();
        await tap();
        await wait((t) => (window.__game.lastShot()?.t ?? -1) >= t, t - 0.001, 5000).catch(() => {});
        const s = await page.evaluate(() => window.__game.lastShot());
        if (s?.target) {
          await until(s.t + s.travel + 0.6);
          shot = { i: s.target.index, p: await page.evaluate((i) => window.__game.city.paint.get(i), s.target.index) };
          break;
        }
      }
    report('a real tap off the block paints Rainbow\'s', shot ? `building ${shot.i}: faction ${shot.p.faction} level ${Math.round(shot.p.level)}` : 'no pose with a glint off the block', 'faction 1', shot?.p.faction === RB);
  }
  // ---- real taps on a square of the block, one each 2.6 s from its ready time (a breath and its recharge), until it flips
  const C = (await readySquares()).sort((a, b) => b.houses.length - a.houses.length)[0];
  await cadence(C, RB, 'a square');
  // ---- the heart, the same way, and the block's light
  const H = (await state()).find((s) => s.heart);
  const fac0 = await page.evaluate(() => window.__game.lift.beam.mesh.material.uniforms.uBeamFac.value);
  await wait(() => window.__game.lift.takeState().find((s) => s.heart).readyAt <= window.__game.lift.now, null, 60000).catch(() => {});
  // (the heart's line of fire may cross its sky piece: that counts on the heart too)
  await phase('heart');
  const hr = await cadence(H, RB, 'the heart', null);
  await after(0.5);
  const fac1 = await page.evaluate(() => window.__game.lift.beam.mesh.material.uniforms.uBeamFac.value);
  report('the block\'s light relit in the taker\'s colours as the heart flips', `the light's faction ${fac0} -> ${fac1}; the heart's owner ${hr?.owner}`, `${INF} -> ${RB}; ${RB}`, fac0 === INF && fac1 === RB && hr?.owner === RB);
  await page.evaluate(() => (window.__qa = null));
}

/** real taps on square `S` each 2.6 s from its ready time until it is `taker`'s (16 at most): each one's outcome by the rules, the hitter, the gaps */
async function cadence(S, taker, name, sky = false) {
  const seq = [], counted = [];
  let T = Math.max(await clock(), (await page.evaluate(() => window.__game.clock() - window.__game.lift.now)) + S.readyAt - 1.0), s = S, misses = 0;
  const pin0 = await aimAt(S, sky === null && !S.houses.length ? true : sky);
  if (!pin0) {
    report(`${name}: a pose with the next tap aimed at it`, `none (square ${S.key}, ${S.houses.length} houses, ${S.up} up)`, 'one', false);
    return null;
  }
  for (let k = 0; k < 16; k++) {
    await until(T);
    // (a houseless heart: through its sky piece while it stands, then at its ground)
    const shot = await tapOn(s, !s.houses.length && sky === null ? ((await page.evaluate(() => !!window.__game.lift.sky)) ? true : false) : sky);
    if (!shot) {
      misses++;
      seq.push('miss');
    } else {
      const h = (await hitsSince(shot.t)).filter((x) => x.key === S.key);
      seq.push(h.length ? `${h.map((x) => `${x.outcome}${x.faction === taker ? '' : `(by ${x.faction})`}`).join('+')}@${(shot.land - (await page.evaluate(() => window.__game.clock() - window.__game.lift.now))).toFixed(1)}` : `none(target ${shot.target})`);
      if (h.some((x) => x.outcome !== 'parry' && x.outcome !== null)) counted.push(shot.land);
    }
    s = await sq(S.key);
    if (s.owner === taker) break;
    T += 2.6;
  }
  const gaps = counted.slice(1).map((t, k) => t - counted[k]);
  const outs = seq.map((x) => x.split('@')[0]);
  const want = S.stage === 4 ? ['crack', 'down', 'down', 'down', 'flip'] : null;
  const cOuts = outs.filter((o) => o !== 'parry' && o !== 'miss' && !o.startsWith('none'));
  report(`${name}: real taps each 2.6 s from its ready time to the flip, by the rules (Rainbow\'s hits, a parry inside each 5 s)`, `${seq.join(' ')}: ${seq.length} taps, ${counted.length} counted, ${outs.filter((o) => o === 'parry').length} parried, ${misses} with no glint; owner ${s.owner} stage ${s.stage}; counted ${gaps.map((g) => g.toFixed(1)).join(', ')} s apart`,
    `owner ${taker}; ${want ? want.join(', ') : 'the rules\' outcomes'}; every counted 5 s or more after the last; no other hitter`,
    s.owner === taker && gaps.every((g) => g >= 4.99) && !seq.some((x) => x.includes('(by')) && (!want || cOuts.join() === want.join()));
  // (a tap with no pose found is the tool's: reported, as is a tap that counted on another square)
  if (misses) console.log(`  (${name}: ${misses} taps found no pose aimed at it)`);
  if (!s.houses.length) return s;
  // (behind the flip's front, 120 m/s from the hit: 1.6 s covers the square)
  await after(1.6);
  const tex = await page.evaluate((hs) => [...new Set(hs.map((i) => { const r = window.__game.city.paint.get(i); return `${r.faction}/${Math.round(r.level)}`; }))], s.houses);
  report(`${name}: its houses' paint after the flip is the taker\'s`, tex.join(', '), `${taker}/1`, tex.length === 1 && tex[0] === `${taker}/1`);
  return s;
}

// ---------------------------------------------------------------- the faction button
async function crewLeg() {
  await wait(() => !window.__game.controls.opening, null, 120000);
  await after(2);
  const shown = await tapHud('crew');
  await after(0.4);
  const picker = await tapHud('crew-atlantis');
  await after(0.3);
  const f1 = await page.evaluate(() => window.__game.splatter.faction);
  report('the faction button: a real tap on the crest, then on Atlantis', `crest ${shown ? 'tapped' : 'not on screen'}, Atlantis ${picker ? 'tapped' : 'not on screen'}; the bus's faction ${f1}`, `${ATL}`, !!shown && !!picker && f1 === ATL);
  await toBlock();
  await phase('crew-fight');
  const sqs = await readySquares();
  const A = sqs[0];
  const s0 = await sq(A.key);
  const shot = await tapOn(A);
  const h = shot ? (await hitsSince(shot.t)).filter((x) => x.key === A.key) : [];
  const s1 = await sq(A.key);
  report('Atlantis\'s real tap on Inferno\'s square: the hitter Atlantis, a crack', shot ? `${h.map((x) => `${x.outcome} by ${x.faction}`).join(', ') || 'no hit'}; cracks ${s0.cracks} -> ${s1.cracks}` : 'no glint on it', `crack by ${ATL}`, h.length === 1 && h[0].faction === ATL && h[0].outcome === 'crack' && s1.cracks === s0.cracks + 1);
  // ---- Inferno picked: the owner's hits, nothing cracks
  await page.evaluate(() => (window.__qa = null));
  await tapHud('crew');
  await after(0.4);
  await tapHud('crew-inferno');
  await after(0.3);
  const f2 = await page.evaluate(() => window.__game.splatter.faction);
  report('the faction button: Inferno picked by real taps', `the bus's faction ${f2}`, `${INF}`, f2 === INF);
  const B = sqs.find((s) => s.key !== A.key) ?? A;
  const b0 = await sq(B.key);
  const outs = [];
  let T = await clock();
  for (let k = 0; k < 4; k++) {
    await until(T);
    const s = await tapOn(B);
    if (s) outs.push(...(await hitsSince(s.t)).filter((x) => x.key === B.key).map((x) => `${x.outcome} by ${x.faction}`));
    else outs.push('miss');
    T += k === 1 ? 5.5 : 2.6;
  }
  const b1 = await sq(B.key);
  report('Inferno\'s real taps on its own square: the owner\'s hits (encores or parries), nothing cracks', `${outs.join(', ')}; stage ${b0.stage} -> ${b1.stage}, cracks ${b0.cracks} -> ${b1.cracks}, owner ${b1.owner}`, `encore or parry by ${INF}; stage 4, cracks 0`, outs.length > 0 && outs.every((o) => /^(encore|parry) by 5$/.test(o)) && outs.some((o) => o.startsWith('encore')) && b1.cracks === 0 && b1.stage === b0.stage && b1.owner === INF);
  // ---- and a tap off the block is Inferno's paint
  await page.evaluate(() => (window.__qa = null));
}

// ---------------------------------------------------------------- the rival buses at the block
async function rivalsLeg() {
  const has = await page.evaluate(() => !!window.__rivals?.sim);
  report('the rival buses are out on ?show', String(has), 'true', has);
  if (!has) return;
  await toBlock();
  const sqs = await readySquares();
  /** the four nearest rivals, each painting a patch on a ready square of the block (their own cadence), the bus 250 m off the heart, 120 m up */
  const put = (fac) => page.evaluate(([cs, fac]) => {
    const g = window.__game, f = g.flight, L = g.lift, R = window.__rivals.sim, T = window.__rivals.tune;
    window.__qa = { pin: { x: L.heart[0] + 250, z: L.heart[1], y: g.city.groundAt(L.heart[0] + 250, L.heart[1]) + 120, heading: -Math.PI / 2, speed: 0 } };
    // (the city's buses as the page started them: the list has room for more than rivalTune.count, and those never start, faction 0)
    const live = R.list.filter((r) => r.faction > 0 && r.state !== 3).sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z));
    const used = live.filter((r) => fac === null || r.faction === fac).slice(0, 4);
    for (const r of R.list) if (!used.includes(r)) r.live = false;
    used.forEach((r, i) => {
      const c = cs[i % cs.length];
      Object.assign(r, { live: true, x: c[0] + 40, z: c[1] + 40, y: g.city.groundAt(c[0], c[1]) + 70, px: c[0] + 40, pz: c[1] + 40, py: g.city.groundAt(c[0], c[1]) + 70, state: 0, act: 0, cx: c[0], cz: c[1], tx: c[0], tz: c[1], actLeft: 90, tapIn: 0.4 + i * 0.6, legIn: 0, lingering: false, grudge: false, oneShot: false, ramIn: 0, mischiefIn: 1e9, soaked: 0 });
    });
    T.patch = 60;
    R.hunter = null;
    return used.map((r) => [r.id, r.faction]);
  }, [sqs.map((s) => [s.x, s.z]), fac]);
  for (const [tag, fac] of [['their crews', null], ['the bus\'s crew', 'pick']]) {
    let pick = fac;
    if (fac === 'pick') {
      // (the faction button, real taps, set to a crew some rival has: the crest's picker, by its key)
      const crewOf = await page.evaluate(() => window.__rivals.sim.list.find((r) => r.faction > 1)?.faction ?? 2);
      const key = ['rainbow', 'atlantis', 'elderwood', 'hyperglow', 'inferno'][crewOf - 1];
      await page.evaluate(() => (window.__qa = null));
      await tapHud('crew');
      await after(0.4);
      await tapHud(`crew-${key}`);
      await after(0.3);
      pick = await page.evaluate(() => window.__game.splatter.faction);
      if (pick !== crewOf) {
        report(`rivals of ${tag}: the faction button set to a rival crew`, `the bus's faction ${pick}, wanted ${crewOf}`, String(crewOf), false);
        continue;
      }
      // (the block's squares as they stood, every one at its ready time again)
      await page.evaluate(() => window.__game.lift.forceReady());
    }
    await phase(`rivals-${tag === 'their crews' ? 'others' : 'same'}`);
    const used = await put(fac === null ? null : pick);
    const r0 = await records(), t0 = await clock(), l0 = (await page.evaluate(() => window.__ts.landed.length)), up0 = await page.evaluate(() => window.__game.lift.stats.up);
    await after(24);
    const r1 = await records();
    const h = await hitsSince(t0);
    const landed = (await page.evaluate((n) => window.__ts.landed.slice(n), l0));
    const onBlock = await page.evaluate((ls) => ls.filter((b) => window.__game.lift.refuses(b.x, b.z, -1) || window.__game.lift.takeState().some((s) => Math.abs(s.x - b.x) < 64 && Math.abs(s.z - b.z) < 64)).length, landed);
    const changed = r1.filter((x, k) => x !== r0[k]);
    const up1 = await page.evaluate(() => window.__game.lift.stats.up);
    report(`rivals of ${tag} painting the block 24 s (${used.map(([id, f]) => `${id}:${f}`).join(' ')}; the bus ${pick ?? RB}): no square changes, no house up or down`, `${landed.length} blasts told the Lift (${onBlock} on the block; factions ${[...new Set(landed.map((b) => b.faction))].join(',')}, tags ${[...new Set(landed.map((b) => b.tag))].join(',')}); rules hits ${h.length}${h.length ? ` ${JSON.stringify(h.slice(0, 4))}` : ''}; records changed ${changed.length}${changed.length ? ` ${changed.slice(0, 3).join(' ')}` : ''}; houses up ${up0} -> ${up1}`,
      'blasts on the block; no rules hit; no record changed; none lifted', onBlock > 0 && h.length === 0 && changed.length === 0 && up1 === up0);
  }
}

// ---------------------------------------------------------------- the far shots on the block
async function farLeg() {
  const H = hand();
  await toBlock();
  const sqs = await readySquares();
  // ---- the Comet at Turbo 3 through the sky piece: real flicks to Turbo 3, the bus held where the Comet's line crosses the piece, a real tap
  await phase('far-comet');
  await page.evaluate(() => (window.__qa = null));
  // (the ladder past Jet is Jet's levels: Turbo 1 to 3 are gear 3 with level 1 to 3 (Turbo.ts), so flickTo's gear alone never reaches them)
  for (let k = 0; k < 9; k++) {
    const r = await page.evaluate(() => window.__game.controls.turbo.gear + window.__game.controls.turbo.level);
    if (r >= 6) break;
    await flick(cdp, 1);
    await page.waitForFunction((was) => window.__game.controls.turbo.gear + window.__game.controls.turbo.level !== was, r, { timeout: 15000, polling: 50 }).catch(() => {});
  }
  const t3 = await page.evaluate(() => window.__game.controls.turbo.name);
  report('real flicks up to Turbo 3', t3, 'TURBO 3', t3 === 'TURBO 3');
  await wait(() => !!window.__game.lift.sky && window.__game.lift.takeState().find((s) => s.heart).readyAt <= window.__game.lift.now, null, 60000).catch(() => {});
  const pose = await page.evaluate(() => {
    const L = window.__game.lift, b = L.sky?.boxes;
    if (!b) return null;
    let y1 = -Infinity;
    for (let k = 0; k + 5 < b.length; k += 6) y1 = Math.max(y1, b[k + 4]);
    return { hx: L.heart[0], hz: L.heart[1], y1 };
  });
  let aimed = null;
  if (pose)
    for (const d of [300, 600, 1200, 2400])
      for (const up of [20, 80, 200, 400]) {
        if (aimed) break;
        const pin = { x: pose.hx, y: pose.y1 + up, z: pose.hz + d, heading: 0 };
        await page.evaluate((p) => ((window.__qa = { pin: p }), window.__game.forceReady()), pin);
        await after(0.3);
        if (await page.evaluate(() => (window.__game.forceReady(), window.__game.aimer.skyAimed && !!window.__game.cometState().plan))) aimed = pin;
      }
  if (aimed) {
    const h0 = (await state()).find((s) => s.heart);
    const gear = await page.evaluate(() => window.__game.controls.turbo.name);
    const t0 = await clock();
    await tap();
    await wait((t) => (window.__game.lastShot()?.t ?? -1) >= t, t0 - 0.001, 5000).catch(() => {});
    const s = await page.evaluate(() => window.__game.lastShot());
    if (s) await until(s.t + s.travel + 0.6);
    const h1 = (await state()).find((x) => x.heart);
    const hits = s ? (await hitsSince(s.t)).filter((x) => x.key === h0.key) : [];
    const via = await page.evaluate((t) => window.__ts.landed.filter((b) => b.t >= t).map((b) => b.via), s?.t ?? 0);
    report('the Comet at Turbo 3 through the sky piece counts as a hit on the heart', `${gear}, held ${aimed.y - pose.y1} m over the piece's top and ${aimed.z - pose.hz} m out: a ${s?.comet ? s.comet.kind ?? 'comet' : 'splat'}, via ${via.join(',')}; the heart's ${hits.map((x) => `${x.outcome} by ${x.faction}`).join(', ') || 'no hit'}, cracks ${h0.cracks} -> ${h1.cracks}`,
      'a comet, via 1, a crack on the heart', !!s?.comet && hits.length === 1 && hits[0].outcome === 'crack' && h1.cracks === h0.cracks + 1);
  } else report('the Comet at Turbo 3 through the sky piece counts as a hit on the heart', pose ? 'no pose put the Comet\'s line through the piece (16 tried)' : 'no piece', 'a pose and a crack', false);
  // ---- the far Lob from 5 km: pinned 5 km over the ground, heading at a ready square from d back, a 2 s real pull, its plan read; tapped once it lands on the square
  let lob = null;
  await phase('far-lob');
  for (const S of sqs.slice(0, 2)) {
    if (lob) break;
    // (the far Lob's reach from 5 km is about 2.7 km ahead: from there each try moves the pin by how far its plan's landing missed the square's first house)
    const aimP = await page.evaluate((i) => { const r = window.__game.lift.refs.get(i); return [r.cx, r.cz]; }, S.houses[0]);
    let d = 2700, xo = 0;
    for (let k = 0; k < 4; k++) {
      const p = await page.evaluate(([x, z, d]) => {
        const g = window.__game;
        while (g.controls.turbo.gear > 0) g.controls.turbo.shift(-1, g.flight);
        const px = x, pz = z + d, y = g.city.groundAt(x, z) + 5000;
        window.__qa = { pin: { x: px, z: pz, y, heading: 0, speed: 0 } };
        Object.assign(g.flight, { x: px, z: pz, y, heading: 0, holdY: -Infinity, targetY: y, vy: 0, mode: 0 });
        return { x: px, z: pz, y };
      }, [aimP[0] + xo, aimP[1], d]);
      await after(0.5);
      await wait(() => !window.__game.city.busy, null, 60000).catch(() => {});
      await page.evaluate(() => {
        window.__qa = null;
        window.__game.forceReady();
      });
      await H.down(1, 196, 690);
      for (let i = 1; i <= 6; i++) {
        await page.waitForTimeout(25);
        await H.move(1, 196, 690 + i * 10);
      }
      await after(2);
      const plan = await page.evaluate(() => window.__game.lobState().plan);
      const inS = plan && plan.target !== null && S.houses.includes(plan.target);
      (R.lobTries ??= []).push({ square: S.key, d, plan: plan && Object.fromEntries(Object.entries(plan).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(1) : v])), body: await page.evaluate(() => +((window.__game.flight.pitch * 180) / Math.PI).toFixed(1)) });
      if (!inS) {
        await H.up(1);
        await after(0.5);
        if (plan) [d, xo] = [d - (plan.z - aimP[1]), xo + (aimP[0] - plan.x)];
        continue;
      }
      await page.evaluate(() => window.__game.forceReady());
      await H.up(1);
      await page.waitForTimeout(100);
      const t0 = await clock();
      await H.down(2, 300, 300);
      await page.waitForTimeout(60);
      await H.up(2);
      await wait((t) => (window.__game.lastShot()?.t ?? -1) >= t, t0 - 0.001, 5000).catch(() => {});
      const s = await page.evaluate(() => window.__game.lastShot());
      if (!s || s.t < t0 - 0.001) continue;
      await until(s.t + s.travel + 0.4);
      const ring = await page.evaluate(() => window.__game.lobState().ring);
      const h = (await hitsSince(s.t)).filter((x) => x.key === S.key);
      lob = { d: Math.round(d), square: S.key, kind: s.comet?.kind ?? (s.comet ? 'comet' : 'splat'), far: !!s.comet?.far, target: s.target?.index ?? null, ring: [Math.round(ring.x), Math.round(ring.z), Math.round(ring.r)], sq: [Math.round(S.x), Math.round(S.z)], hits: h };
      break;
    }
  }
  R.lob = lob;
  if (lob) {
    const ringOn = Math.abs(lob.ring[0] - lob.sq[0]) <= 64 && Math.abs(lob.ring[1] - lob.sq[1]) <= 64;
    report('the far Lob from 5 km onto a square: counted once, its ring on the square', `from ${lob.d} m back: a ${lob.far ? 'far ' : ''}${lob.kind}, target ${lob.target}; hits on the square ${lob.hits.map((x) => `${x.outcome} by ${x.faction}`).join(', ') || 'none'}; the ring at ${lob.ring[0]}, ${lob.ring[1]} (r ${lob.ring[2]}) against the square's middle ${lob.sq.join(', ')}`,
      'a far lob; one hit, not a parry; the ring inside the square', lob.kind === 'lob' && lob.far && lob.hits.length === 1 && lob.hits[0].outcome !== 'parry' && ringOn);
  } else report('the far Lob from 5 km onto a square: counted once, its ring on the square', 'no pose put the Lob\'s plan on a square (2 squares, 4 tries each)', 'one', false);
  await page.evaluate(() => (window.__qa = null));
  // ---- a Sonic Boom's ring on a ready square: the Splatter's own barf with Boom.ts's options and tag (Boom.barf), its hole over the square's middle. The
  // producer's fifth call (HOOKS.md): the ring paints but takes no ground, so no rules hit on any square
  await phase('far-boom');
  await page.evaluate(() => window.__game.lift.forceReady());
  const S = (await readySquares()).find((s) => !lob || s.key !== lob.square);
  if (S) {
    const t0 = await clock();
    await page.evaluate((S) => {
      const g = window.__game, y = g.city.groundAt(S.x, S.z);
      g.splatter.barf(S.x, S.z, { target: null, exact: true, y: y + 0.5, drop: 0, radius: 120, inner: 90, travel: 0.4, stream: true, hitStop: 0, super: { kind: 'boom', charge: 1, id: 1e6, inner: 90 } });
    }, S);
    await after(1.2);
    const h = await hitsSince(t0);
    const told = await page.evaluate((t) => window.__ts.landed.filter((b) => b.t >= t).length, t0);
    report('a Sonic Boom\'s ring on a ready square of the block takes no square', `its hole on square ${S.key}: ${told} blast told the Lift; rules hits ${h.length}${h.length ? ` ${JSON.stringify(h.slice(0, 3))}` : ''}`, 'told, no rules hit', told > 0 && h.length === 0);
  } else report('a Sonic Boom\'s ring on a ready square of the block takes no square', 'no ready square', 'one', false);
}

/** two thumbs by id (controls.mjs's hand): down, move, up */
function hand() {
  const pts = new Map();
  const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts].map(([id, [x, y]]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
  return {
    down: async (id, x, y) => (pts.set(id, [x, y]), send('touchStart')),
    move: async (id, x, y) => (pts.set(id, [x, y]), send('touchMove')),
    up: async (id) => {
      pts.delete(id);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...pts].map(([i, [x, y]]) => ({ x, y, id: i, radiusX: 8, radiusY: 8, force: 1 })) });
    },
  };
}

