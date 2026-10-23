#!/usr/bin/env node
// OpenStreetMap QA from the real game (index.html), iPhone 15 portrait viewport, one browser.
//   node tools/osm-shots.mjs [baseUrl] [outDir] [shot,shot,...] [--tag=name] [--sf=<slug>] [--ams=<slug>]
//        [--timeout=<ms>] [--w=393 --h=852 --dpr=3]
// Defaults: baseUrl http://127.0.0.1:5173/ (npm run dev; or a static build), outDir shots/osm, shots
// "ladies". --sf / --ams name the city folders (public/city/<slug>) the SF and Amsterdam shots load (sf,
// amsterdam). The browser comes from tools/browser.mjs (the installed Chrome / Edge with the real GPU here,
// the pinned Chromium + SwiftShader in the cloud: everything waits on the game clock, so both work).
// shots (each a fresh page):
//   ladies      chase camera over Alamo Square, looking east at the Painted Ladies (Steiner St)
//   northbeach  North Beach / Telegraph Hill, looking at Coit Tower's hill
//   fidi        the Financial District from the chase camera
//   embarcadero the Embarcadero piers from the bay side
//   altitude    a climb to ~300 m over the Mission (the street plan, parks, the coastline)
//   ocean       a climb over the Sunset toward Ocean Beach and Golden Gate Park
//   blast       a breath at the Painted Ladies: the frame after the impact with the sign up
//               (logs the sign's text: it must be a real street name)
//   amsterdam   the Amsterdam city (no LiDAR, no DEM): the Jordaan's canals from the chase camera
//   amsalt      the Amsterdam city from ~200 m
//   opening     SF's real opening (no skipintro): the ODbL credit on screen; logs when it came and went
//   amsopening  the same for the Amsterdam city
// Writes <outDir>/<shot><tag>.png and <outDir>/osm-shots<tag>.json (renderer stats per shot, sign text,
// credit timing). Exit code 1 if a shot is unknown, the page throws, or the credit misbehaves.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const argv = process.argv.slice(2);
const args = argv.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.join('=') || '1'];
  }),
);
const [baseArg = 'http://127.0.0.1:5173/', out = 'shots/osm', list = 'ladies'] = args;
const base = baseArg.endsWith('/') || baseArg.includes('?') ? baseArg : baseArg + '/';
const tag = flags.tag ? `-${flags.tag}` : '';
const SF = flags.sf ?? 'sf';
const AMS = flags.ams ?? 'amsterdam';
const TIMEOUT = Number(flags.timeout ?? 400000);
const VIEW = { viewport: { width: Number(flags.w ?? 393), height: Number(flags.h ?? 852) }, deviceScaleFactor: Number(flags.dpr ?? 3), hasTouch: true, isMobile: true };
mkdirSync(out, { recursive: true });

/** query string for a city ('sf' is the game's default: no ?city=) */
const city = (slug, q) => (slug === 'sf' ? `?${q}` : `?city=${encodeURIComponent(slug)}&${q}`);

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const report = {};
let failed = false;

async function newPage() {
  const page = await browser.newPage(VIEW);
  page.on('pageerror', (e) => {
    failed = true;
    console.log('[pageerror]', e.message);
  });
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  return page;
}
/** A dev server may reload the page once (Vite optimizing a dependency on the first visit): wait again. */
const reloaded = (e) => /context was destroyed|navigation/i.test(String(e?.message ?? e));
async function waitFor(page, fn) {
  for (let tries = 0; ; tries++) {
    try {
      return await page.waitForFunction(fn, null, { timeout: TIMEOUT });
    } catch (e) {
      if (tries >= 2 || !reloaded(e)) throw e;
      await page.waitForLoadState('load');
    }
  }
}
async function open(query) {
  const page = await newPage();
  await page.goto(base + query, { waitUntil: 'load' });
  await waitFor(page, () => window.__shotReady === true);
  return page;
}
const runFor = (page, s) =>
  page.evaluate(
    (sec) =>
      new Promise((res) => {
        const g = window.__game;
        const t0 = g.clock();
        const tick = () => (g.clock() - t0 >= sec ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    s,
  );
const runUntil = (page, cond, maxS) =>
  page.evaluate(
    ([c, m]) =>
      new Promise((res) => {
        const g = window.__game;
        const f = new Function('g', `return (${c})`);
        const t0 = g.clock();
        const tick = () => (f(g) || g.clock() - t0 >= m ? res(g.clock() - t0) : requestAnimationFrame(tick));
        tick();
      }),
    [cond, maxS],
  );
const drift = (page, v) => page.evaluate((s) => ((window.__qa = null), (window.__game.flight.glideSpeed = s)), v);
const qa = (page, v) => page.evaluate((x) => (window.__qa = x), v);
const stats = async (page) => {
  const s = [];
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(1300);
    s.push(await page.evaluate(() => window.__stats ?? window.__game.perf.snapshot()));
  }
  const ok = s.filter(Boolean);
  if (!ok.length) return null;
  return { calls: Math.max(...ok.map((x) => x.calls)), triangles: Math.max(...ok.map((x) => x.triangles)), workMs: +(ok.reduce((a, x) => a + x.workMs, 0) / ok.length).toFixed(2) };
};
const where = (page) => page.evaluate(() => ({ x: +window.__game.flight.x.toFixed(1), y: +window.__game.flight.y.toFixed(1), z: +window.__game.flight.z.toFixed(1) }));

const CHASE = {
  ladies: city(SF, 'lat=37.77628&lon=-122.4352&heading=88&skipintro'),
  northbeach: city(SF, 'lat=37.7980&lon=-122.4140&heading=58&skipintro'),
  fidi: city(SF, 'lat=37.7905&lon=-122.4075&heading=80&skipintro'),
  embarcadero: city(SF, 'lat=37.7992&lon=-122.3890&heading=235&skipintro'),
  amsterdam: city(AMS, 'lat=52.3738&lon=4.8775&heading=75&skipintro'),
};
const CLIMB = {
  altitude: [city(SF, 'lat=37.7560&lon=-122.4280&heading=20&skipintro'), 300],
  ocean: [city(SF, 'lat=37.7580&lon=-122.4700&heading=280&skipintro'), 330],
  amsalt: [city(AMS, 'lat=52.3700&lon=4.8760&heading=40&skipintro'), 200],
};
const OPENING = { opening: SF, amsopening: AMS };

/**
 * The real opening, no skipintro: the credit must come once the city is on screen (the first region in),
 * stay small, and be gone ~7 s later. Polls the page every 100 ms of the wall clock, records each event
 * on both clocks and judges on the game clock (the credit runs on it, capped by the wall clock on a slow
 * device), and shoots it at full opacity.
 */
async function opening(name, slug) {
  const page = await newPage();
  let t0 = Date.now();
  await page.goto(base + (slug === 'sf' ? '' : `?city=${encodeURIComponent(slug)}`), { waitUntil: 'load' });
  await waitFor(page, () => !!window.__game);
  // bootWallMs: wall-clock ms from navigation until the game existed; then each event's wall-clock ms
  // since the navigation (firstRegion, shown, full, gone) and the game clock (s) at it (clock.*)
  const fresh = () => ({ bootWallMs: Date.now() - t0, firstRegion: null, shown: null, full: null, gone: null, clock: {}, text: null, box: null, credits: 0 });
  let r = fresh();
  let shot = false;
  while (Date.now() - t0 < TIMEOUT) {
    let s;
    try {
      s = await page.evaluate(() => {
        const els = [...document.querySelectorAll('[data-sb-credit], div[role=note]')];
        const el = els[0];
        const b = el?.getBoundingClientRect();
        return {
          n: els.length,
          clock: window.__game ? window.__game.clock() : 0,
          loaded: !!window.__game && window.__game.city.loadedRegionCount() > 0,
          opacity: el ? Number(getComputedStyle(el).opacity) : -1,
          text: el?.textContent ?? null,
          box: b ? { w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(innerHeight - b.bottom), font: getComputedStyle(el).fontSize } : null,
        };
      });
    } catch (e) {
      if (!reloaded(e)) throw e;
      // the dev server reloaded the page: the opening starts over
      await page.waitForLoadState('load');
      await waitFor(page, () => !!window.__game);
      t0 = Date.now();
      r = fresh();
      shot = false;
      continue;
    }
    const t = Date.now() - t0;
    r.credits = Math.max(r.credits, s.n);
    const at = (k) => {
      r[k] = t;
      r.clock[k] = +s.clock.toFixed(2);
    };
    if (s.loaded && r.firstRegion === null) at('firstRegion');
    if (s.n && r.shown === null) at('shown');
    if (s.n) [r.text, r.box] = [s.text, s.box];
    if (s.opacity > 0.98 && r.full === null) at('full');
    if (s.opacity > 0.98 && !shot) {
      await page.screenshot({ path: `${out}/${name}${tag}.png` });
      shot = true;
    }
    if (r.shown !== null && !s.n) {
      at('gone');
      break;
    }
    if (r.shown === null && t > 60000) break; // no credit after a minute: give up (reported below)
    await page.waitForTimeout(100);
  }
  // the credit comes with the city (never before the first region), reaches full opacity, lasts ~7 s of
  // the game clock (gone by 8; a slow device's wall-clock cap may end it sooner on the game clock, but
  // never before 5 s on the wall), is gone within 8 s of the wall clock once at full opacity, and comes once
  const c = r.clock;
  const long = r.gone !== null && (c.gone - c.shown > 5 || r.gone - r.shown > 5000);
  r.ok = r.shown !== null && r.firstRegion !== null && c.shown >= c.firstRegion - 0.2 && r.full !== null && r.gone !== null && long && c.gone - c.shown < 8 && r.gone - r.full < 8000 && r.credits === 1;
  if (!r.ok) failed = true;
  await page.close();
  return r;
}

for (const name of list.split(',')) {
  const t = Date.now();
  if (CHASE[name]) {
    const page = await open(CHASE[name]);
    await drift(page, 19.2);
    await runFor(page, 3);
    await page.screenshot({ path: `${out}/${name}${tag}.png` });
    report[name] = { stats: await stats(page), at: await where(page) };
    await page.close();
  } else if (CLIMB[name]) {
    const [q, alt] = CLIMB[name];
    const page = await open(q);
    await qa(page, { sx: 0, sy: -1 });
    await runUntil(page, `g.flight.y + Math.max(0, g.flight.vy) / 1.7 >= ${alt} || g.flight.strain > 0.85`, 60);
    await qa(page, null);
    await runFor(page, 4);
    await page.screenshot({ path: `${out}/${name}${tag}.png` });
    report[name] = { stats: await stats(page), at: await where(page) };
    await page.close();
  } else if (name === 'blast') {
    const page = await open(city(SF, 'lat=37.77615&lon=-122.4340&heading=88&skipintro'));
    await drift(page, 6);
    await runFor(page, 2);
    const tImpact = await page.evaluate(() => window.__game.barfAtLatLon(37.77605, -122.43262));
    await runUntil(page, `g.clock() >= ${tImpact} + 0.9`, 6);
    await page.screenshot({ path: `${out}/blast${tag}.png` });
    // the sign main.ts raised: its text and what named it (street / hoodAt / building hood / nearest label)
    report.blast = { sign: await page.evaluate(() => window.__game.lastSign?.() ?? null), stats: await stats(page) };
    console.log('sign', JSON.stringify(report.blast.sign));
    await page.close();
  } else if (OPENING[name]) {
    report[name] = await opening(name, OPENING[name]);
    console.log('credit', JSON.stringify(report[name]));
  } else {
    console.log('unknown shot', name);
    failed = true;
    continue;
  }
  console.log(name, `${((Date.now() - t) / 1000).toFixed(0)} s`, JSON.stringify(report[name]));
}
writeFileSync(`${out}/osm-shots${tag}.json`, JSON.stringify(report, null, 1));
await browser.close();
process.exit(failed ? 1 : 0);
