#!/usr/bin/env node
// The real bus over ?moon, painting: the real stick (window.__qa) and the real tap, at a fixed step, frames taken with the loop frozen.
//   node tools/moon/paint.mjs <out dir> [--script=one,two] [--dt=0.033333] [--q=site=TYCHO] [--keep]
// Each script is a flight in SCRIPTS below. A frame is 393 x 852 game pixels, one PNG pixel each. BASE is the page (http://localhost:4179/). --keep leaves what's saved on the device from one script to the next.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const out = pos[0] ?? 'shots/local/moonlow/paint/try';
const base = process.env.BASE ?? 'http://localhost:4179/';
const DT = Number(opt.dt ?? 1 / 30);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('404') && !m.text().includes('GPU stall')) errors.push(m.text().slice(0, 900));
});

const open = async (q = '') => {
  await page.goto(`${base}?moon&fixeddt=${DT.toFixed(6)}${opt.hud ? '' : '&nohud'}${opt.q ? '&' + opt.q : ''}${q ? '&' + q : ''}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await page.evaluate(() => {
    const g = window.__game, info = g.pipeline.renderer.info;
    window.__qa = { holdFrames: 0 };
    info.autoReset = false;
    const f = g.perf.frame.bind(g.perf);
    window.__stats = { calls: 0, triangles: 0 };
    g.perf.frame = (a, b) => {
      window.__stats = { calls: info.render.calls, triangles: info.render.triangles };
      info.reset();
      f(a, b);
    };
  });
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 120000 });
};
const run = async (secs) => {
  const n = Math.max(1, Math.round(secs / DT));
  await page.evaluate((k) => {
    window.__qa = { ...window.__qa, holdFrames: k, held: false };
  }, n);
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 600000 });
};
const stick = (sx, sy) => page.evaluate(([x, y]) => Object.assign(window.__qa, { sx: x, sy: y }), [sx, sy]);
const letGo = () => page.evaluate(() => {
  delete window.__qa.sx;
  delete window.__qa.sy;
});
const shift = (d) => page.evaluate((v) => window.__game.input.onTurbo(v), d);
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const state = () => page.evaluate(() => {
  const g = window.__game, f = g.flight, p = g.moon.paint, t = p.target, r = (x, k = 1) => +x.toFixed(k);
  return { t: r(g.clock(), 2), x: r(f.x, 0), z: r(f.z, 0), h: r(f.y - g.city.groundAt(f.x, f.z)), speed: r(f.speed), target: t ? { id: t.id, r: r(t.r), level: t.rec?.level ?? 0, name: t.name, x: r(t.x, 0), z: r(t.z, 0) } : null, list: p.listed, recs: p.recs.size, live: p.liveCount, ...window.__stats, sign: g.lastSign()?.text ?? null };
});
const log = [];
const note = async (tag) => {
  const s = await state();
  log.push({ tag, ...s });
  console.log(tag.padEnd(16), JSON.stringify(s));
  return s;
};
/** Fills the belly and taps, as the thumb does. */
const tap = () => page.evaluate(() => {
  const g = window.__game;
  g.flight.fullness = 1;
  g.tapSplat();
});
const fill = () => page.evaluate(() => (window.__game.flight.fullness = 1));
/** Waits, belly full, until a crater glints. */
const glint = async (secs = 6) => {
  await fill();
  for (let t = 0; t < secs; t += 0.2) {
    await run(0.2);
    if (await page.evaluate(() => !!window.__game.moon.paint.target)) return true;
  }
  return false;
};
/** A strip of frames: `every` s apart, `n` of them. */
const strip = async (tag, n, every) => {
  for (let i = 1; i <= n; i++) {
    await run(every);
    await note(`${tag}-${i}`);
    await shot(`${tag}-${String(i).padStart(2, '0')}`);
  }
};
/** Clear the device between scripts. */
const wipe = () => page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('strugglebus.moon') || k.startsWith('strugglebus.ground')) localStorage.removeItem(k);
});

const SCRIPTS = {
  /** The start: tap what glints three times, watching it land. */
  async three() {
    await open();
    await run(1);
    await glint();
    await note('glint');
    await shot('glint');
    for (let k = 1; k <= 3; k++) {
      await tap();
      await strip(`hit${k}`, 8, 0.4);
      await glint(2);
    }
    console.log(JSON.stringify(await page.evaluate(() => [...window.__game.moon.paint.recs.values()].slice(0, 20).map((r) => ({ id: r.id, r: r.r, level: r.level, hue: r.hue })))));
  },
  /** Turn round and look at what was painted, from height. */
  async back() {
    await open();
    await run(1);
    for (let k = 0; k < 5; k++) {
      await glint();
      await tap();
      await run(2.5);
    }
    await stick(0, -1);
    await strip('rise', 6, 1.5);
    await letGo();
    await shot('rise-end');
  },
};

const want = (opt.script ?? 'three').split(',');
try {
  for (const name of want) {
    console.log('----', name);
    await SCRIPTS[name]();
    if (!opt.keep) await wipe();
  }
} finally {
  writeFileSync(`${out}/paint.json`, JSON.stringify(log, null, 0));
  console.log('errors:', errors.length, errors.slice(0, 8));
  await browser.close();
}
process.exit(errors.length ? 1 : 0);
