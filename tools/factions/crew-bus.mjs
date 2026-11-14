#!/usr/bin/env node
// The bus wears its crew (game/crewBus.ts): the one link, ?show, with real taps on the faction button (the crest, then a swatch), as the producer switches.
//   check (the default): from Rainbow through Atlantis, the Elderwood, Hyperglow and Inferno and back to Rainbow, then Atlantis again. After each switch the
//     bus's body read from its own `ramp` attribute (every part that was yellow at the start now the crew's row, as the rivals' table has it, and none left
//     yellow but Rainbow's) and the paint's faction (the splatter's), each the crew's; the first switch caught half way (part old, part new: no pop); the
//     super's ready chime once a switch; the rival buses, held alongside, each wearing its own crew's row, the same table (none read is a fail); then three
//     hits on the Atlantis bus (rivalsBoot's hurtMe): an Inferno one and a Rainbow one made between frames (a shell's path, as the swerve warm row does it),
//     and an Inferno one made inside the rivals' frame (a ram's path: from sim.step): the hitter's colours flood the body with no frame showing yellow on
//     it but the Rainbow hitter's own, and after the drain it is Atlantis's again; then a switch made while the bus isn't framed (as above 15 km, where the
//     flight's own bus has the frame): its first frame back shows the new crew whole. No program made after the warm-up, no page error.
//     The gauge (bus/gauge.ts): the held rival buses' gauges each their crew's run; then through Atlantis, the Elderwood, Hyperglow, Inferno, Rainbow and
//     Atlantis again, the bus pinned with the rivals sent home: the band's and the bar's rows and lifts in the bus's own attributes and the charge's rows,
//     each the crew's run (Rainbow's: the six hues, no lift, as built), and the colours read from the page's own frame (its resolved picture, at the 24
//     slices from the close camera on its left side, the 6 cells from the chase camera behind) at empty, half and full: each the stop's row or its empty
//     row (90 %), lit back to front (at half the rear lit, the front not). Then on each crew, held through __qa.busFx: the full wave and the sparkle over
//     24 reads (each stop's steady steps move, and a sparkle climbs over them); a super's charge at 0.3 and 0.8 (a crew's band keeps its run's rows at step
//     6 or under, and at 0.8 the white-hot is GLOW_WHITE beside them; Rainbow's said, not judged); spent at half (the lit rear a step darker).
//   --look=<dir>: the stills, no verdict. Each crew's bus held over the Mission at 12:30 from the chase camera (the phone's whole screen) and from close; a
//     rival bus of the bus's crew alongside; two frames in the middle of a switch.
//   --look=<dir> --gauge: the gauge's stills instead: each crew's bus from the chase camera with the gauge empty, half and full over the grey city, close
//     at half and under a super's charge at 0.3 and 0.8, and spent at half from behind; the full wave on every crew, close; two frames in the middle of a
//     switch at a phone's size; an Inferno rival ahead of the Atlantis bus; then each crew over its own paint (its shots where the chase camera sees the
//     ground behind the bus).
// Prints pass or FAIL a line; writes <out>/crew-bus.json; exit 1 on any failure (the stills: exit 0 once they are written).
//
//   node tools/factions/crew-bus.mjs <url> <outDir> [--q=<query>] [--look=<dir>]
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
/** each crew's gauge run, rear to front: [row, lift in steps, empty row (0: its own)] (a copy of bus/gauge.ts's table, which the page's reads are held against) */
const RUNS = {
  1: [[8, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0]],
  2: [[26, -2], [26, -2], [26, -1], [26, -1], [26, 2], [26, 2]],
  3: [[28, -1], [28, -1], [28, 2], [28, 2], [10, 1, 28], [10, 2, 28]],
  4: [[29, -2], [25, 0], [29, -1], [25, 1], [29, 0], [25, 2]],
  5: [[31, 1], [9, -1], [9, 0], [9, 1], [10, 1], [10, 2]],
};
/** a stop's empty row: its own empty row, or its row */
const darkOf = (s) => s[2] || s[0];
/** the glow a stop races at under a charge (gauge.ts's topOf; Rainbow's 1) */
const topOf = (f, s) => (f === 1 ? 1 : +((Math.min(6, 4 + s[1] + 1) + 0.2) / 7).toFixed(3));
const GLOW_WHITE = 16;
/** the palette (render/palette.ts, read as text): each colour's rows and steps, to name what a pixel of the page shows */
const PAL = (() => {
  const src = readFileSync(resolve('src/render/palette.ts'), 'utf8');
  const at = src.indexOf('export const Ramp = {'), block = src.slice(at, src.indexOf('};', at));
  const num = Object.fromEntries([...block.matchAll(/^\s+([A-Z_]+): (\d+),/gm)].map((m) => [m[1], +m[2]]));
  const by = {};
  for (const m of src.matchAll(/\[Ramp\.([A-Z_]+)\]: \[([^\]]+)\]/g)) [...m[2].matchAll(/'#([0-9a-f]{6})'/g)].forEach((h, k) => (by[h[1]] ??= []).push([num[m[1]], k]));
  return by;
})();

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
  // (the gauge's parts are left out of the count: they were never yellow, and their rows are the gauge's checks')
  const ua0 = g.scene.getObjectByName('BusRoot').children[0].geometry.getAttribute('uv');
  window.__cbRead = () => {
    const ra = busRa(), h = {};
    for (let i = 0; i < ra.count; i++) {
      if (Math.round(ua0.getX(i)) === 9) continue;
      const v = ra.getX(i);
      h[v] = (h[v] ?? 0) + 1;
    }
    const R = window.__rivals;
    return { hist: h, faction: g.splatter.faction, look: g.crewBus ? g.crewBus.qa() : null, out: R ? R.out : null, flung: R ? R.counts.flung ?? 0 : null, t: g.clock(), chimes: window.__cbChimes ?? 0 };
  };
  // (the body's parts: the vertices yellow now, at the start, Rainbow's)
  {
    const ra = busRa(), body = [];
    for (let i = 0; i < ra.count; i++) if (ra.getX(i) === 14) body.push(i);
    window.__cbBody = body;
  }
  // (the chime a switch plays: the super's ready, counted)
  const a = g.audio, sr = a.superReady.bind(a);
  a.superReady = () => {
    window.__cbChimes = (window.__cbChimes ?? 0) + 1;
    sr();
  };
  // (a bus's gauge as its attributes hold it: by stop (a part's uv.y x 6; PART.BAND is 9), the row and the lift in steps, and any stop whose parts disagree)
  window.__cbGaugeOf = (mesh) => {
    const geo = mesh.geometry, ua = geo.getAttribute('uv'), ra = geo.getAttribute('ramp'), la = geo.getAttribute('lightOffset'), ga = geo.getAttribute('glow'), rows = [], lifts = [], darks = [], mixed = new Set();
    for (let i = 0; i < ua.count; i++) {
      if (Math.round(ua.getX(i)) !== 9) continue;
      const st = Math.min(5, Math.floor(ua.getY(i) * 6)), r = ra.getX(i), l = Math.round((la.getX(i) + 0.5) * 7 * 100) / 100, d = ga.getX(i);
      if (rows[st] === undefined) {
        rows[st] = r;
        lifts[st] = l;
        darks[st] = d;
      } else if (rows[st] !== r || lifts[st] !== l || darks[st] !== d) mixed.add(st);
    }
    return { rows, lifts, darks, mixed: [...mixed] };
  };
  // (the gauge's 30 places on the player's bus, in its mesh's space: each slice's left face and each bar cell's back face, a third down from the top)
  {
    const geo = busRa() && g.scene.getObjectByName('BusRoot').children[0].geometry, ua = geo.getAttribute('uv'), pa = geo.getAttribute('position'), box = new Map();
    for (let i = 0; i < ua.count; i++) {
      if (Math.round(ua.getX(i)) !== 9) continue;
      const k = Math.round(ua.getY(i) * 1e4), b = box.get(k) ?? { par: ua.getY(i), lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
      for (let c = 0; c < 3; c++) {
        b.lo[c] = Math.min(b.lo[c], pa.getComponent(i, c));
        b.hi[c] = Math.max(b.hi[c], pa.getComponent(i, c));
      }
      box.set(k, b);
    }
    window.__cbPts = [...box.values()].sort((p, q) => p.par - q.par).map((b) => {
      const bar = b.hi[2] - b.lo[2] < 0.2, y = b.hi[1] - (b.hi[1] - b.lo[1]) / 3;
      return { bar, par: b.par, stop: Math.min(5, Math.floor(b.par * 6)), p: bar ? [(b.lo[0] + b.hi[0]) / 2, y, b.hi[2] + 0.01] : [b.lo[0] - 0.01, y, (b.lo[2] + b.hi[2]) / 2] };
    });
  }
  // (the colours the page drew there: its resolved frame (the picture before it is scaled to the screen), 3 x 3 game pixels round each place, as hex)
  window.__cbPixels = () => {
    const P = g.pipeline, rt = P.resolved, W = rt.width, H = rt.height, px = new Uint8Array(W * H * 4);
    P.renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    const mesh = g.scene.getObjectByName('BusRoot').children[0], v = new g.camera.position.constructor();
    return window.__cbPts.map((q) => {
      v.set(q.p[0], q.p[1], q.p[2]).applyMatrix4(mesh.matrixWorld).project(P.snapCam);
      const ix = Math.floor((v.x * 0.5 + 0.5) * W), iy = Math.floor((v.y * 0.5 + 0.5) * H), hex = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = ix + dx, y = iy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const o = (y * W + x) * 4;
          hex.push([px[o], px[o + 1], px[o + 2]].map((c) => c.toString(16).padStart(2, '0')).join(''));
        }
      return { bar: q.bar, par: q.par, stop: q.stop, at: [ix, iy], hex };
    });
  };
});
const read = () => page.evaluate(() => window.__cbRead());
/** a gauge read from attributes against a crew's run: its rows, its lifts, no stop of mixed parts */
const gaugeIs = (gq, f) => gq.mixed.length === 0 && RUNS[f].every(([r, l, d = 0], k) => gq.rows[k] === r && Math.abs(gq.lifts[k] - l) < 0.01 && (gq.darks?.[k] ?? 0) === d);
const runSays = (rows, lifts, darks) => rows.map((r, k) => `${r}${lifts[k] ? (lifts[k] > 0 ? '+' : '') + lifts[k] : ''}${darks?.[k] ? `/${darks[k]}` : ''}`).join(' ');
const gaugeSays = (gq, f) => `${runSays(gq.rows, gq.lifts, gq.darks)}${gq.mixed.length ? ` (stops ${gq.mixed} mixed)` : ''} against ${runSays(RUNS[f].map((s) => s[0]), RUNS[f].map((s) => s[1]), RUNS[f].map((s) => s[2] ?? 0))}`;
/** a colour's rows and steps: the palette's own, or (the live sky's table of the hour shifts a colour a little: ORANGE's #dc5235 drawn #dd5043) the nearest
 *  palette colour within 20 of it, as RGB distance; null past that */
const PAL_LIST = Object.keys(PAL).map((h) => [h, [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16))]);
const palOf = (h) => {
  if (PAL[h]) return PAL[h];
  const c = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
  let best = null, bd = 20;
  for (const [k, p] of PAL_LIST) {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    if (d < bd) [best, bd] = [k, d];
  }
  return best ? PAL[best] : null;
};
/** a place's pixels named: the row most of them are (a colour two rows share counts for both) and their mean step in it; null if none is a palette colour */
const named = (q) => {
  const n = {};
  for (const h of q.hex) for (const r of new Set((palOf(h) ?? []).map((e) => e[0]))) n[r] = (n[r] ?? 0) + 1;
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const row = +best[0], st = q.hex.flatMap((h) => (palOf(h) ?? []).filter((e) => e[0] === row).map((e) => e[1]));
  return { row, step: st.reduce((a, b) => a + b, 0) / st.length, of: best[1] };
};
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
  // (four rival buses held alongside, 24 and 48 m off each side, the bus pinned where it is, one of each crew but Rainbow (a rival not yet out has no crew):
  // each one's body row against its crew's in the table)
  const beside = await page.evaluate(() => {
    const Rv = window.__rivals, g = window.__game, f = g.flight;
    if (!Rv) return 0;
    window.__qa = { ...(window.__qa ?? {}), pin: { x: f.x, z: f.z, y: f.y, heading: 0, speed: 0 } };
    const list = Rv.sim.list.slice(0, 4), off = [24, -24, 48, -48];
    window.__cbBeside = true;
    const tick = () => {
      if (!window.__cbBeside) return;
      const p = window.__qa.pin;
      list.forEach((r, k) => {
        Object.assign(r, { live: true, faction: k + 2, soaked: 0, x: p.x + off[k], z: p.z, y: p.y, heading: 0, speed: 0, state: 0, act: 1, tx: p.x + off[k], tz: p.z - 1e7, mischiefIn: 1e9, ramIn: 0 });
        r.px = r.x;
        r.py = r.y;
        r.pz = r.z;
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return list.length;
  });
  if (beside) {
    await after(1.5);
    const riv = await page.evaluate(() => {
      const g = window.__game, Rv = window.__rivals, j = window.__cbBody[0], out = [];
      for (let k = 0; k < 4; k++) {
        const root = g.scene.getObjectByName(`Rival${k}`);
        if (!root?.visible) continue;
        const r = Rv.sim.list.find((x) => Math.hypot(x.x - root.position.x, x.z - root.position.z) < 1);
        if (!r || r.soaked) continue;
        out.push({ faction: r.faction, row: root.children[0].geometry.getAttribute('ramp').getX(j), gauge: window.__cbGaugeOf(root.children[0]) });
      }
      return out;
    });
    for (const r of riv) (R.rivals ??= []).push(r);
    report("rival buses wear their crew's gauge", riv.length ? riv.map((r) => `${KEY[r.faction]} ${gaugeSays(r.gauge, r.faction)}`).join('; ') : 'none read', "at least one, each its crew's run", riv.length > 0 && riv.every((r) => gaugeIs(r.gauge, r.faction)));
  }
  // (then the rivals sent home and the bus let go: no stray hit in what follows)
  await page.evaluate(() => {
    window.__cbBeside = false;
    for (const o of window.__rivals?.sim.list ?? []) o.live = false;
    if (window.__qa) delete window.__qa.pin;
  });
  const rv = R.rivals ?? [];
  report('rival buses wear the same table', rv.length ? `${rv.length} read: ${rv.map((r) => `${KEY[r.faction]} ${r.row}`).join(', ')}` : `none read (${beside} held alongside)`, "at least one, each its crew's row", rv.length > 0 && rv.every((r) => r.row === BODY[r.faction]));
  await after(1);
  // ---- the gauge: the bus pinned where it is, the rivals home, the close camera on its left side and back; each crew in turn from the one it's in (Atlantis)
  R.gauge = [];
  await page.evaluate(() => {
    const g = window.__game, f = g.flight;
    window.__qa = { ...(window.__qa ?? {}), pin: { x: f.x, z: f.z, y: f.y, heading: 0, speed: 0 } };
    // (no smoke puffs while the gauge is read: the exhaust's cross the bar's left cells from behind, the grey blob the first look saw. The particles
    // show and hide themselves each frame, so it's the puff that is held, and given back after)
    window.__cbPuff = g.particles.puff;
    g.particles.puff = () => {};
  });
  for (const [k, f] of [2, 3, 4, 5, 1, 2].entries()) {
    if (k > 0) await pick(f);
    // (the first: the chase camera settles behind the bus just pinned, which was flying a moment ago)
    await after(k === 0 ? 3 : 1);
    const st = await page.evaluate(() => window.__cbGaugeOf(window.__game.scene.getObjectByName('BusRoot').children[0]));
    const ch = await page.evaluate(() => window.__game.crewBus?.qa().gauge ?? null);
    report(`${KEY[f]}: the gauge's rows and lifts`, gaugeSays(st, f), "the crew's run", gaugeIs(st, f));
    report(`${KEY[f]}: the charge's rows and tops`, ch ? `${ch.charge.join(' ')}; tops ${ch.tops.join(' ')}` : 'no crew look', `${RUNS[f].map((s) => s[0]).join(' ')}; tops ${RUNS[f].map((s) => topOf(f, s)).join(' ')}`, !!ch && RUNS[f].every((s, j) => ch.charge[j] === s[0] && Math.abs(ch.tops[j] - topOf(f, s)) < 0.002));
    // (the slices from the close camera on the left side, the bar from the chase camera behind, as a player sees it; and the bus's charge or spent, held)
    const view = (F, on, fx = null) =>
      page.evaluate(([F, on, fx]) => {
        const g = window.__game, p = window.__qa.pin;
        p.fullness = F;
        window.__qa.camAt = on ? { x: p.x - 13, z: p.z + 20, h: p.y - g.city.groundAt(p.x - 13, p.z + 20) + 6, lookX: p.x, lookZ: p.z, lookH: p.y - g.city.groundAt(p.x, p.z) + 1 } : null;
        window.__qa.busFx = fx;
      }, [F, on, fx]);
    const sideReads = async () => (await page.evaluate(() => window.__cbPixels())).filter((q) => !q.bar).map((q) => ({ ...q, n: named(q) }));
    const reads = {};
    for (const F of [0, 0.5, 1]) {
      // (the chase camera first, given 2 s to come back behind the bus from the close one: 0.8 s left it to the left, the bar's left cells behind the bumper)
      await view(F, false);
      await after(2);
      const back = await page.evaluate(() => window.__cbPixels());
      await view(F, true);
      await after(0.8);
      const side = await page.evaluate(() => window.__cbPixels());
      reads[F] = side.map((q, j) => (q.bar ? back[j] : q)).map((q) => ({ ...q, n: named(q) }));
    }
    // (each place: its row the stop's, or its empty row's where it's unlit, at all three; then lit back to front: a lit place is in its stop's row and a
    // step or more over its empty self, or its empty self is its empty row's)
    const places = reads[0].length, want = Math.ceil(places * 0.9);
    const rowOk = [0, 0.5, 1].map((F) => reads[F].filter((q) => q.n && (q.n.row === RUNS[f][q.stop][0] || q.n.row === darkOf(RUNS[f][q.stop]))).length);
    const lit = (q, j) => {
      const e = reads[0][j].n;
      return !!(q.n && e && q.n.row === RUNS[f][q.stop][0] && (e.row !== q.n.row || q.n.step >= e.step + 0.9));
    };
    const full = reads[1].filter(lit).length;
    const rearN = reads[0.5].filter((q) => q.par < 0.45).length, rear = reads[0.5].filter((q, j) => q.par < 0.45 && lit(q, j)).length;
    const frontN = reads[0.5].filter((q) => q.par > 0.55).length, front = reads[0.5].filter((q, j) => q.par > 0.55 && q.n && !lit(q, j)).length;
    report(`${KEY[f]}: the page's colours, empty / half / full`, `${rowOk.join(' / ')} of ${places} places the stop's row`, `30 places, each ${want} or more`, places === 30 && rowOk.every((n) => n >= want));
    report(`${KEY[f]}: it fills back to front`, `full: ${full} of ${places} lit; half: ${rear} of ${rearN} at the rear lit, ${front} of ${frontN} at the front not`, '90 % of each', full >= want && rear >= Math.ceil(rearN * 0.9) && front >= Math.ceil(frontN * 0.9));
    if (k === 5) {
      R.gauge.push({ f, st, ch, reads });
      continue;
    }
    // (the full wave and the sparkle, the slices from the side: 24 reads a little over a sparkle's ninth of a second apart. Each stop: its steady steps
    // (under 6.6) span half a step or more over the reads, the wave; and some read of one of its places is at step 6.6 or more in its row, a sparkle over
    // its steady steps. Step 7 is the sparkle's alone on every stop)
    await view(1, true);
    await after(0.8);
    const waves = [];
    for (let r = 0; r < 24; r++) {
      waves.push(await sideReads());
      await after(0.12);
    }
    const byStop = [0, 1, 2, 3, 4, 5].map((s) => {
      const seen = waves.flatMap((w) => w.filter((q) => q.stop === s && q.n && q.n.row === RUNS[f][s][0]).map((q) => q.n.step));
      const steady = seen.filter((x) => x < 6.6);
      return { n: seen.length, lo: steady.length ? Math.min(...steady) : NaN, hi: steady.length ? Math.max(...steady) : NaN, sparkles: seen.filter((x) => x >= 6.6).length };
    });
    const waveOk = byStop.every((b) => b.n >= 24 && b.hi - b.lo >= 0.5), sparkleOk = byStop.every((b) => b.sparkles > 0 && b.lo < 6.6);
    report(`${KEY[f]}: the full wave and the sparkle, every stop`, byStop.map((b, s) => `${s}: ${b.lo.toFixed(1)}-${b.hi.toFixed(1)}, ${b.sparkles} sparkles of ${b.n}`).join('; '), 'each stop: steady steps over half a step apart, a sparkle at 6.6 or more', waveOk && sparkleOk);
    // (a super's charge, held at 0.3 and 0.8: on a crew's bus every place not white-hot is one of the run's rows at step 6.5 or less, and at 0.8 the
    // white-hot is GLOW_WHITE with some places still the crew's; Rainbow's runs to step 7 as it always did, read and said only)
    const charge = {};
    for (const c of [0.3, 0.8]) {
      await view(1, true, { charge: c });
      await after(0.8);
      const rs = [];
      for (let r = 0; r < 6; r++) {
        rs.push(...(await sideReads()));
        await after(0.1);
      }
      const nm = rs.filter((q) => q.n), white = nm.filter((q) => q.n.row === GLOW_WHITE), crew = nm.filter((q) => q.n.row !== GLOW_WHITE);
      const inRun = crew.filter((q) => RUNS[f].some((s) => s[0] === q.n.row)), over = crew.filter((q) => q.n.step > 6.5);
      charge[c] = { n: rs.length, named: nm.length, white: white.length, crew: crew.length, inRun: inRun.length, over: over.length, hi: crew.length ? Math.max(...crew.map((q) => q.n.step)) : NaN };
    }
    const cs = (c) => `at ${c}: ${charge[c].crew} of ${charge[c].n} the crew's (${charge[c].inRun} in its run, ${charge[c].over} over step 6.5, top ${charge[c].hi.toFixed(1)}), ${charge[c].white} white-hot`;
    if (f === 1) report('rainbow: the charge, as it always was (said, not judged)', `${cs(0.3)}; ${cs(0.8)}`, 'none', true);
    else
      report(
        `${KEY[f]}: the charge keeps the crew's colours under the white-hot`,
        `${cs(0.3)}; ${cs(0.8)}`,
        "every non-white place in the run at step 6.5 or less; at 0.3 no white-hot; at 0.8 some white-hot and a tenth or more still the crew's",
        [0.3, 0.8].every((c) => charge[c].named >= charge[c].n * 0.9 && charge[c].inRun === charge[c].crew && charge[c].over === 0) && charge[0.3].white === 0 && charge[0.8].white > 0 && charge[0.8].crew >= charge[0.8].n * 0.1,
      );
    // (spent, held: the half-full band's lit places at the rear a step or more darker than they were lit)
    await view(0.5, true, { spent: 1 });
    await after(0.8);
    const sp = await sideReads();
    const half = reads[0.5].filter((q) => !q.bar);
    const rearLit = half.map((q, j) => [q, sp[j]]).filter(([q]) => q.par < 0.45 && q.n);
    const dim = rearLit.filter(([q, s]) => s && s.n && (s.n.row !== q.n.row || s.n.step <= q.n.step - 0.9)).length;
    report(`${KEY[f]}: spent dims the lit band`, `${dim} of ${rearLit.length} lit places at the rear a step or more darker`, '90 %', rearLit.length > 0 && dim >= Math.ceil(rearLit.length * 0.9));
    await view(1, false);
    R.gauge.push({ f, st, ch, reads, waves: byStop, charge, spent: dim });
  }
  await page.evaluate(() => {
    delete window.__qa.pin;
    window.__qa.camAt = null;
    window.__game.particles.puff = window.__cbPuff;
  });
  await after(1);
  // (every frame CrewBus draws, what the body shows after it; and a hit made inside the rivals' frame, as sim.step's 'ram' makes one)
  const hooked = await page.evaluate(() => {
    const g = window.__game, cb = g.crewBus, Rv = window.__rivals;
    if (!cb || !Rv) return false;
    const ra = g.scene.getObjectByName('BusRoot').children[0].geometry.getAttribute('ramp'), body = window.__cbBody;
    const P = (window.__cbP = { rec: [], on: false, hit: 0, skip: false, first: null });
    const hist = () => {
      const h = {};
      for (const i of body) {
        const v = ra.getX(i);
        h[v] = (h[v] ?? 0) + 1;
      }
      return h;
    };
    const f0 = cb.frame.bind(cb);
    cb.frame = (t, r) => {
      if (P.skip) return;
      f0(t, r);
      if (P.first === true) P.first = hist();
      if (P.on) P.rec.push({ t: +t.toFixed(4), h: hist() });
    };
    const st = Rv.sim.step.bind(Rv.sim);
    Rv.sim.step = (...a) => {
      st(...a);
      if (P.hit) {
        const f = P.hit;
        P.hit = 0;
        Rv.hurtMe(1, 1, 0, 170, f);
      }
    };
    return true;
  });
  // (the hits, on the Atlantis bus: Inferno and Rainbow between frames, then Inferno inside the rivals' frame)
  for (const [hf, name, inFrame] of [[5, 'Inferno', false], [1, 'Rainbow', false], [5, "Inferno inside the rivals' frame", true]]) {
    await quiet();
    await after(0.3);
    const t0 = await clock();
    const ok = hooked && (await page.evaluate(([hf, inFrame]) => {
      const P = window.__cbP;
      P.rec = [];
      P.on = true;
      if (inFrame) P.hit = hf;
      else window.__rivals.hurtMe(1, 1, 0, 170, hf);
      return true;
    }, [hf, inFrame]));
    if (!ok) {
      report(`a hit by ${name}`, 'no rivals or no crew look on the page', 'both', false);
      continue;
    }
    const want = BODY[hf];
    const fl = await page.waitForFunction(([w, N]) => {
      const s = window.__cbRead();
      return (s.hist[w] ?? 0) >= N ? s : false;
    }, [want, N], { timeout: 4000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null);
    const rec = await page.evaluate(() => {
      const P = window.__cbP;
      P.on = false;
      return P.rec;
    });
    report(`a hit by ${name}: its colours flood the body`, fl ? `all ${N} parts row ${want} ${(fl.t - t0).toFixed(2)} s after` : 'not in 4 s', `all ${N} row ${want}`, !!fl);
    if (hf !== 1) {
      // (until the flood fills the body: no frame with yellow on it, the band a front ahead of the rivals' leaves)
      const upto = rec.findIndex((r) => (r.h[want] ?? 0) >= N);
      const seen = upto < 0 ? rec : rec.slice(0, upto + 1), yel = seen.filter((r) => (r.h[YELLOW] ?? 0) > 0);
      report(`a hit by ${name}: no yellow in its flood`, `${yel.length} of ${seen.length} frames with yellow, most at once ${Math.max(0, ...seen.map((r) => r.h[YELLOW] ?? 0))} of ${N}`, '0 frames, of more than 1', seen.length > 1 && yel.length === 0);
    }
    await quiet();
    await after(0.3);
    const s = await read(), b = body(s, 2);
    report(`a hit by ${name}: then the crew's again`, `${b.n} of ${N} parts row 26, ${b.yellow} yellow, ${(s.hist[30] ?? 0) - (s0.hist[30] ?? 0)} Inferno's (${(s.t - t0).toFixed(1)} s after the hit)`, `all ${N} row 26, none yellow`, b.ok && (s.hist[30] ?? 0) === (s0.hist[30] ?? 0));
  }
  // (a switch to the Elderwood while the bus isn't framed, as when the flight has the frame: its first frame back shows the Elderwood whole, not a sweep from Atlantis)
  if (hooked) {
    await quiet();
    await page.evaluate(() => (window.__cbP.skip = true));
    await page.waitForTimeout(500);
    const tapped = await pick(3);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.__cbP.first = true;
      window.__cbP.skip = false;
    });
    const first = await page.waitForFunction(() => (typeof window.__cbP.first === 'object' ? window.__cbP.first : false), null, { timeout: 5000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null);
    report('a switch while the bus is not framed: its first frame back', first ? `${first[28] ?? 0} of ${N} parts row 28, ${first[26] ?? 0} Atlantis's, ${first[YELLOW] ?? 0} yellow${tapped ? '' : ' (the button not tapped)'}` : 'no frame came back', `all ${N} row 28`, tapped && !!first && (first[28] ?? 0) === N);
  } else report('a switch while the bus is not framed', 'no crew look or rivals to hook', 'both', false);
  const late = await page.evaluate((t) => window.__cb.programs.filter((p) => p > t).length, warmDoneAt);
  report('no program made after the warm-up', late, '0', late === 0);
  report('no page error', errors, '0', errors === 0);
} else {
  // ---- the stills: the rivals sent home but one, the bus held over the Mission, heading north, 90 m over the ground
  // (city-local metres from lat/lon: warmcheck's in-page helper, which mirrors src/game/geo.ts)
  await page.evaluate(() => {
    const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2), E4 = E2 * E2, E6 = E4 * E2;
    const mer = (p) => A * ((1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256) * p - ((3 * E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024) * Math.sin(2 * p) + ((15 * E4) / 256 + (45 * E6) / 1024) * Math.sin(4 * p) - ((35 * E6) / 3072) * Math.sin(6 * p));
    window.__ll = (lat, lon) => {
      const o = window.__game.city.manifest.origin;
      const r = Math.PI / 180, phi = lat * r, s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
      const N = A / Math.sqrt(1 - E2 * s * s), T = t * t, C = EP2 * c * c, a = (lon - o[1]) * r * c, a2 = a * a;
      const x = N * (a + ((1 - T + C) * a2 * a) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a2 * a2 * a) / 120);
      const y = mer(phi) - mer(o[0] * r) + N * t * (a2 / 2 + ((5 - T + 9 * C + 4 * C * C) * a2 * a2) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a2 * a2 * a2) / 720);
      return [x, -y];
    };
  });
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
      window.__qa.camAt = on ? { x: p.x - 13, z: p.z + 20, h: p.y - g.city.groundAt(p.x - 13, p.z + 20) + 6, lookX: p.x, lookZ: p.z, lookH: p.y - g.city.groundAt(p.x, p.z) + 1 } : null;
    }, on);
  const still = async (name) => {
    const f = resolve(LOOK, `${name}.png`);
    await page.screenshot({ path: f });
    (R.stills ??= []).push(f);
    console.log('still', f);
  };
  /** the belly's fullness, held by the pin */
  const fill = (F) => page.evaluate((F) => (window.__qa.pin.fullness = F), F);
  /** the middle of a switch to `f`: the game held at a third and two thirds of its half second, each a still `<name>-a`, `-b` */
  const midSwitch = async (f, name) => {
    await pick(f);
    const at = await page.waitForFunction((f) => {
      const l = window.__game.crewBus?.qa();
      return l && Number.isFinite(l.at) && l.faction === f ? l.at : false;
    }, f, { timeout: 5000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null);
    if (at === null) return console.log('no switch began: no middle frames');
    for (const [k, s] of [[0.17, 'a'], [0.34, 'b']]) {
      await page.evaluate((t) => Object.assign(window.__qa, { holdAt: t, held: false }), at + k);
      await wait(() => window.__qa.held === true, null, 10000).catch(() => null);
      await page.waitForTimeout(300);
      R[`${name}-${s}`] = await read();
      await still(`${name}-${s}`);
    }
    await page.evaluate(() => {
      delete window.__qa.holdAt;
      window.__qa.held = false;
    });
  };
  if (opt.gauge) {
    // ---- the gauge's stills (look2): the chase camera as a player flies it, over the grey city first, then over the crew's own paint
    for (const f of [1, 2, 3, 4, 5]) {
      if (f !== 1) await pick(f);
      for (const [F, s] of [[0, 'empty'], [0.5, 'half'], [1, 'full']]) {
        await fill(F);
        await ready();
        await still(`${f}-${KEY[f]}-phone-${s}`);
      }
      await fill(0.5);
      await close(true);
      await after(0.6);
      await still(`${f}-${KEY[f]}-close-half`);
      // (a super's charge held at 0.3 and at 0.8, full and close; then spent, held, at half from behind)
      await fill(1);
      for (const c of [0.3, 0.8]) {
        await page.evaluate((c) => (window.__qa.busFx = { charge: c }), c);
        await after(0.8);
        await still(`${f}-${KEY[f]}-close-charge-${Math.round(c * 100)}`);
      }
      await close(false);
      await fill(0.5);
      await page.evaluate(() => (window.__qa.busFx = { spent: 1 }));
      await ready();
      await still(`${f}-${KEY[f]}-phone-spent-half`);
      await page.evaluate(() => (window.__qa.busFx = null));
    }
    // (the full wave and the sparkle, close, on every crew: two frames a quarter second apart)
    for (const f of [1, 2, 3, 4, 5]) {
      await pick(f);
      await fill(1);
      await close(true);
      await after(1);
      await still(`6-${KEY[f]}-wave-a-close`);
      await after(0.25);
      await still(`6-${KEY[f]}-wave-b-close`);
      await close(false);
    }
    // (two frames in the middle of a switch, Inferno to Atlantis, at a phone's size, the gauge half full)
    await fill(0.5);
    await after(1);
    await midSwitch(2, '7-switch-inferno-to-atlantis-phone');
    // (a rival of another crew, Inferno, ahead of the Atlantis bus: 30 m on and 5 m to the right, a little higher, the same way)
    await page.evaluate(() => {
      const Rv = window.__rivals, r = Rv?.sim.list.find((x) => x.faction === 5) ?? Rv?.sim.list[0];
      if (!r) return;
      window.__cbBeside = true;
      const tick = () => {
        if (!window.__cbBeside) return;
        const p = window.__qa.pin;
        Object.assign(r, { live: true, faction: 5, soaked: 0, x: p.x + 5, z: p.z - 30, y: p.y + 3, heading: 0, speed: 0, state: 0, act: 1, tx: p.x + 5, tz: p.z - 1e7, mischiefIn: 1e9, ramIn: 0 });
        r.px = r.x;
        r.py = r.y;
        r.pz = r.z;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await ready();
    await still('8-atlantis-behind-an-inferno-rival-phone');
    await page.evaluate(() => {
      window.__cbBeside = false;
      for (const o of window.__rivals?.sim.list ?? []) o.live = false;
    });
    // (over its own paint: each crew paints the blocks the chase camera sees behind the bus, round where its line through the bus meets the ground, with its
    // own shots, then the still at half)
    for (const f of [1, 2, 3, 4, 5]) {
      await pick(f);
      await after(1);
      await page.evaluate(() => {
        const g = window.__game, p = window.__qa.pin, c = g.camera.position, gy = g.city.groundAt(p.x, p.z), t = (gy - p.y) / Math.min(-1e-3, p.y - c.y);
        const hx = p.x + (p.x - c.x) * t, hz = p.z + (p.z - c.z) * t;
        for (let i = 0; i < 16; i++) g.splatter.barf(hx + ((i % 4) - 1.5) * 22, hz + (Math.floor(i / 4) - 1.5) * 24, { drop: 90 });
      });
      await after(3);
      await ready();
      await still(`9-${KEY[f]}-over-its-paint-phone-half`);
    }
  } else {
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
    window.__qa.camAt = { x: p.x + 12, z: p.z + 95, h: p.y - g.city.groundAt(p.x + 12, p.z + 95) + 14, lookX: p.x + 12, lookZ: p.z, lookH: p.y - g.city.groundAt(p.x + 12, p.z) + 1 };
  });
  await after(0.4);
  await still('6-inferno-beside-a-rival-close');
  // (where the two buses and the lens were for that still)
  R.beside = await page.evaluate(() => {
    const g = window.__game, b = g.scene.getObjectByName('BusRoot'), v = (o) => (o ? [o.position.x, o.position.y, o.position.z, o.visible].map((n) => (typeof n === 'number' ? +n.toFixed(1) : n)) : null);
    return { bus: v(b), rivals: [0, 1, 2, 3].map((k) => v(g.scene.getObjectByName(`Rival${k}`))), camera: v(g.camera), pin: window.__qa.pin, camAt: window.__qa.camAt };
  });
  console.log('beside:', JSON.stringify(R.beside));
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
}
writeFileSync(resolve(out, 'crew-bus.json'), JSON.stringify(R, null, 1));
await browser.close();
if (LOOK) process.exit(0);
console.log(failed ? `crew-bus: FAILED ${failed} of ${log.length}` : `crew-bus: passed ${log.length} of ${log.length}`);
process.exit(failed ? 1 : 0);
