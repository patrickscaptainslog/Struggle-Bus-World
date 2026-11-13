#!/usr/bin/env node
// The bus wears its crew (game/crewBus.ts): the one link, ?show, with real taps on the faction button (the crest, then a swatch), as the producer switches.
//   check (the default): from Rainbow through Atlantis, the Elderwood, Hyperglow and Inferno and back to Rainbow, then Atlantis again. After each switch the
//     bus's body read from its own `ramp` attribute (every part that was yellow at the start now the crew's row, as the rivals' table has it, and none left
//     yellow but Rainbow's) and the paint's faction (the splatter's), each the crew's; the first switch caught half way (part old, part new: no pop); the
//     super's ready chime once a switch; any rival bus drawn wearing its own crew's row, the same table; then two hits on the Atlantis bus (rivalsBoot's
//     hurtMe, as the swerve warm row does it), an Inferno one and a Rainbow one: the hitter's colours flood the body, and after the drain it is Atlantis's
//     again. No program made after the warm-up, no page error.
//   --look=<dir>: the stills, no verdict. Each crew's bus held over the Mission at 12:30 from the chase camera (the phone's whole screen) and from close; a
//     rival bus of the bus's crew alongside; two frames in the middle of a switch.
// Prints pass or FAIL a line; writes <out>/crew-bus.json; exit 1 on any failure (the stills: exit 0 once they are written).
//
//   node tools/factions/crew-bus.mjs <url> <outDir> [--q=<query>] [--look=<dir>]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserOptions } from '../browser.mjs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => (a.includes('=') ? [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a.slice(2), true])));
const base = pos[0] ?? 'http://127.0.0.1:4179/';
const out = resolve(pos[1] ?? 'shots/tmp/crew-bus');
mkdirSync(out, { recursive: true });
const Q = opt.q ?? '?show&skipintro&t=2026-11-13T20:30:00Z';
const LOOK = opt.look ? resolve(opt.look) : null;
if (LOOK) mkdirSync(LOOK, { recursive: true });
/** the crews by number, their swatch's key, and their bus's body row (palette.ts: BUS_YELLOW 14, TEAL 26, MOSS 28, MAGENTA 24, CRIMSON 30; rivalsBoot's BODY) */
const KEY = { 1: 'rainbow', 2: 'atlantis', 3: 'elderwood', 4: 'hyperglow', 5: 'inferno' };
const BODY = { 1: 14, 2: 26, 3: 28, 4: 24, 5: 30 };
const YELLOW = 14;

let failed = 0;
const log = [];
const R = { q: Q, log };
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
  const W = (window.__cb = { programs: [] });
  const cp = WebGL2RenderingContext.prototype.createProgram;
  WebGL2RenderingContext.prototype.createProgram = function () {
    W.programs.push(performance.now());
    return cp.call(this);
  };
});
await page.goto(base + Q, { waitUntil: 'load' });
await page.waitForFunction(() => {
  const g = window.__game, w = g?.warm;
  return !!g && !!w?.report && !w.running && w.report.programs >= g.pipeline.renderer.info.programs.length;
}, null, { timeout: 240000, polling: 100 });
const warmDoneAt = await page.evaluate(() => window.__game.warm?.doneAt || performance.now());
const cdp = await page.context().newCDPSession(page);
const wait = (fn, arg, timeout = 60000, polling = 100) => page.waitForFunction(fn, arg, { timeout, polling });
const clock = () => page.evaluate(() => window.__game.clock());
const after = async (dt) => {
  const t = (await clock()) + dt;
  await wait((t) => window.__game.clock() >= t, t);
};
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id = 1]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
const tap = async (x, y, id = 8) => {
  await touch('touchStart', [[x, y, id]]);
  await page.waitForTimeout(60);
  await touch('touchEnd', []);
};
/** a real tap on a HUD element by its data-hud (its centre); its centre, or null if it isn't shown */
const tapHud = async (key) => {
  const r = await page.evaluate((k) => {
    const e = document.querySelector(`[data-hud="${k}"]`);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return b.width > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' ? [b.x + b.width / 2, b.y + b.height / 2] : null;
  }, key);
  if (r) await tap(r[0], r[1]);
  return r;
};
/** the faction button: the crest, then the crew's swatch, both real taps; true if both were there */
const pick = async (f) => {
  const a = await tapHud('crew');
  await page.waitForTimeout(250);
  const b = a ? await tapHud(`crew-${KEY[f]}`) : null;
  return !!(a && b);
};
// in the page: the player's bus's rows, counted (its BusRoot's one mesh), the paint's faction, the crew look's own report, and the rivals' state
await page.evaluate(() => {
  const g = window.__game;
  const busRa = () => g.scene.getObjectByName('BusRoot').children[0].geometry.getAttribute('ramp');
  window.__cbRead = () => {
    const ra = busRa(), h = {};
    for (let i = 0; i < ra.count; i++) {
      const v = ra.getX(i);
      h[v] = (h[v] ?? 0) + 1;
    }
    const R = window.__rivals;
    return { hist: h, faction: g.splatter.faction, look: g.crewBus ? g.crewBus.qa() : null, out: R ? R.out : null, flung: R ? R.counts.flung ?? 0 : null, t: g.clock(), chimes: window.__cbChimes ?? 0 };
  };
  // (the chime a switch plays: the super's ready, counted)
  const a = g.audio, sr = a.superReady.bind(a);
  a.superReady = () => {
    window.__cbChimes = (window.__cbChimes ?? 0) + 1;
    sr();
  };
});
const read = () => page.evaluate(() => window.__cbRead());
/** no rival's flood on the bus, nor a throw: what the body shows is its own */
const quiet = () => wait(() => {
  const s = window.__cbRead();
  return !s.out && !(s.look && s.look.flood);
}, null, 20000).catch(() => null);

await wait(() => {
  const e = document.querySelector('[data-hud="crew"]');
  return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none';
}, null, 120000).catch(() => null);
await after(1);
const s0 = await read();
const N = s0.hist[YELLOW] ?? 0;
R.start = s0;
console.log(`ready ${Math.round(warmDoneAt)} ms; the bus: ${N} parts of its body yellow, faction ${s0.faction}, crew look ${s0.look ? 'on' : 'none'}`);

if (!LOOK) {
  report('the start: Rainbow, the body yellow', `faction ${s0.faction}, ${N} yellow parts`, 'faction 1, some yellow', s0.faction === 1 && N > 0);
  // (a body part is one of the N yellow at the start; what each crew's count must be: the start's count of its row, plus N, and no yellow left)
  const body = (s, f) => {
    const r = BODY[f], n = (s.hist[r] ?? 0) - (f === 1 ? 0 : s0.hist[r] ?? 0);
    return { n, yellow: s.hist[YELLOW] ?? 0, ok: f === 1 ? n === N : n === N && (s.hist[YELLOW] ?? 0) === 0 };
  };
  let chimes = s0.chimes;
  const order = [2, 3, 4, 5, 1, 2];
  for (let k = 0; k < order.length; k++) {
    const f = order[k];
    await quiet();
    const before = await read();
    const tapped = await pick(f);
    if (k === 0) {
      // (the first switch caught in the middle: part of the body Atlantis's, part still yellow)
      const mid = await page.waitForFunction((N) => {
        const s = window.__cbRead(), n = s.hist[26] ?? 0;
        return n > 0 && n < N ? s : s.look && s.look.sweep >= 1 ? { ...s, done: true } : false;
      }, N, { timeout: 5000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null);
      R.mid = mid;
      report('the switch floods in, not at once', mid ? (mid.done ? 'it was done before a frame showed it half way' : `at ${(mid.look?.sweep ?? 0).toFixed(2)} of the sweep ${mid.hist[26]} of ${N} parts Atlantis's, ${mid.hist[YELLOW] ?? 0} still yellow`) : 'no part changed in 5 s', 'a frame with some of each', !!mid && !mid.done);
    }
    await after(1);
    await quiet();
    const s = await read();
    const b = body(s, f);
    report(`${KEY[f]}: the faction button`, tapped ? 'the crest and its swatch tapped' : 'not shown', 'both shown', tapped);
    report(`${KEY[f]}: the paint's faction`, s.faction, f, s.faction === f);
    report(`${KEY[f]}: the bus's body`, `${b.n} of ${N} parts row ${BODY[f]}, ${b.yellow} yellow${s.flung !== before.flung ? ` (a stray hit came between: flung ${before.flung} to ${s.flung})` : ''}`, `all ${N} row ${BODY[f]}${f === 1 ? '' : ', none yellow'}`, b.ok);
    report(`${KEY[f]}: the chime`, s.chimes - chimes, '1', s.chimes - chimes === 1);
    chimes = s.chimes;
    // (any rival bus drawn: its body's row, at a part that is the body's on the player's, against its crew's in the same table)
    const riv = await page.evaluate(() => {
      const g = window.__game, Rv = window.__rivals, mine = g.scene.getObjectByName('BusRoot').children[0].geometry.getAttribute('ramp'), out = [];
      if (!Rv) return out;
      let j = -1;
      for (let i = 0; i < mine.count && j < 0; i++) if (mine.getX(i) === g.crewBus?.qa().ramp || mine.getX(i) === 14) j = i;
      for (let k = 0; k < 4; k++) {
        const root = g.scene.getObjectByName(`Rival${k}`);
        if (!root?.visible || j < 0) continue;
        const r = Rv.sim.list.find((x) => Math.hypot(x.x - root.position.x, x.z - root.position.z) < 1);
        if (!r || r.soaked) continue;
        out.push({ faction: r.faction, row: root.children[0].geometry.getAttribute('ramp').getX(j) });
      }
      return out;
    });
    for (const r of riv) (R.rivals ??= []).push(r);
  }
  const rv = R.rivals ?? [];
  report('rival buses wear the same table', rv.length ? rv.map((r) => `${KEY[r.faction]} ${r.row}`).join(', ') : 'none drawn near enough: not checked', 'each its crew\'s row', rv.every((r) => r.row === BODY[r.faction]));
  // (the hits, on the Atlantis bus: an Inferno one, then a Rainbow one)
  for (const [hf, name] of [[5, 'Inferno'], [1, 'Rainbow']]) {
    await quiet();
    const t0 = await clock();
    const ok = await page.evaluate((hf) => {
      if (!window.__rivals) return false;
      window.__rivals.hurtMe(1, 1, 0, 170, hf);
      return true;
    }, hf);
    if (!ok) {
      report(`a hit by ${name}`, 'no rivals on the page', 'rivals', false);
      continue;
    }
    const want = BODY[hf];
    const fl = await page.waitForFunction(([w, N]) => {
      const s = window.__cbRead();
      return (s.hist[w] ?? 0) >= N ? s : false;
    }, [want, N], { timeout: 4000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null);
    report(`a hit by ${name}: its colours flood the body`, fl ? `all ${N} parts row ${want} ${(fl.t - t0).toFixed(2)} s after` : 'not in 4 s', `all ${N} row ${want}`, !!fl);
    await quiet();
    await after(0.3);
    const s = await read(), b = body(s, 2);
    report(`a hit by ${name}: then the crew's again`, `${b.n} of ${N} parts row 26, ${b.yellow} yellow, ${(s.hist[30] ?? 0) - (s0.hist[30] ?? 0)} Inferno's (${(s.t - t0).toFixed(1)} s after the hit)`, `all ${N} row 26, none yellow`, b.ok && (s.hist[30] ?? 0) === (s0.hist[30] ?? 0));
  }
  const late = await page.evaluate((t) => window.__cb.programs.filter((p) => p > t).length, warmDoneAt);
  report('no program made after the warm-up', late, '0', late === 0);
  report('no page error', errors, '0', errors === 0);
} else {
  // ---- the stills: the rivals sent home but one, the bus held over the Mission, heading north, 90 m over the ground
  await page.evaluate(() => {
    for (const o of window.__rivals?.sim.list ?? []) o.live = false;
    const g = window.__game, [x, z] = window.__ll(37.7599, -122.4148);
    window.__qa = { pin: { x, z, y: g.city.groundAt(x, z) + 90, heading: 0, speed: 0 } };
  });
  const ready = async () => {
    await after(2.5);
    await wait(() => !window.__game.city.busy && window.__shotReady === true, null, 60000).catch(() => null);
    await after(0.3);
  };
  const close = (on) =>
    page.evaluate((on) => {
      const g = window.__game, p = window.__qa.pin;
      window.__qa.camAt = on ? { x: p.x - 9, z: p.z + 15, h: p.y - g.city.groundAt(p.x - 9, p.z + 15) + 4, lookX: p.x, lookZ: p.z, lookH: p.y - g.city.groundAt(p.x, p.z) + 1 } : null;
    }, on);
  const still = async (name) => {
    const f = resolve(LOOK, `${name}.png`);
    await page.screenshot({ path: f });
    (R.stills ??= []).push(f);
    console.log('still', f);
  };
  for (const f of [1, 2, 3, 4, 5]) {
    if (f !== 1) await pick(f);
    await ready();
    await still(`${f}-${KEY[f]}-phone`);
    await close(true);
    await after(0.4);
    await still(`${f}-${KEY[f]}-close`);
    await close(false);
  }
  // (a rival of the bus's crew, Inferno, held 24 m off its right side, the same way and height)
  await page.evaluate(() => {
    // (one already of that crew, so its tag says so: rivals are made of the crews other than the bus's at the start, Rainbow's)
    const Rv = window.__rivals, g = window.__game, r = Rv?.sim.list.find((x) => x.faction === g.splatter.faction) ?? Rv?.sim.list[0];
    if (!r) return;
    window.__cbBeside = true;
    const tick = () => {
      if (!window.__cbBeside) return;
      const p = window.__qa.pin;
      Object.assign(r, { live: true, faction: g.splatter.faction, soaked: 0, x: p.x + 24, z: p.z, y: p.y, heading: 0, speed: 0, state: 0, act: 1, tx: p.x + 24, tz: p.z - 1e7, mischiefIn: 1e9, ramIn: 0 });
      r.px = r.x;
      r.py = r.y;
      r.pz = r.z;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await ready();
  await still('6-inferno-beside-a-rival-phone');
  await page.evaluate(() => {
    const g = window.__game, p = window.__qa.pin;
    window.__qa.camAt = { x: p.x + 12, z: p.z + 30, h: p.y - g.city.groundAt(p.x + 12, p.z + 30) + 5, lookX: p.x + 12, lookZ: p.z, lookH: p.y - g.city.groundAt(p.x + 12, p.z) + 1 };
  });
  await after(0.4);
  await still('6-inferno-beside-a-rival-close');
  await page.evaluate(() => (window.__cbBeside = false));
  await close(true);
  await after(0.5);
  // (the middle of a switch, Inferno to Atlantis: the game held at a third and at two thirds of its half second)
  await pick(2);
  const at = await page.waitForFunction(() => {
    const l = window.__game.crewBus?.qa();
    return l && Number.isFinite(l.at) && l.faction === 2 ? l.at : false;
  }, null, { timeout: 5000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null);
  if (at !== null) {
    for (const [k, name] of [[0.17, 'a'], [0.34, 'b']]) {
      await page.evaluate((t) => Object.assign(window.__qa, { holdAt: t, held: false }), at + k);
      await wait(() => window.__qa.held === true, null, 10000).catch(() => null);
      await page.waitForTimeout(300);
      R[`hold${name}`] = await read();
      await still(`7-switch-inferno-to-atlantis-${name}-close`);
    }
    await page.evaluate(() => {
      delete window.__qa.holdAt;
      window.__qa.held = false;
    });
  } else console.log('no switch began: no middle frames');
}
writeFileSync(resolve(out, 'crew-bus.json'), JSON.stringify(R, null, 1));
await browser.close();
if (LOOK) process.exit(0);
console.log(failed ? `crew-bus: FAILED ${failed} of ${log.length}` : `crew-bus: passed ${log.length} of ${log.length}`);
process.exit(failed ? 1 : 0);
