#!/usr/bin/env node
// OpenStreetMap QA from the real game (index.html), iPhone 15 portrait viewport, one browser.
//   node tools/osm-shots.mjs <baseUrl> <outDir> <shot,shot,...> [--tag=name]
// shots (each a fresh page; SwiftShader ~1.5 fps: everything waits on the game clock):
//   ladies      chase camera over Alamo Square, looking east at the Painted Ladies (Steiner St)
//   northbeach  North Beach / Telegraph Hill, looking at Coit Tower's hill
//   fidi        the Financial District from the chase camera
//   embarcadero the Embarcadero piers from the bay side
//   altitude    a climb to ~300 m over the Mission (the street plan, parks, the coastline)
//   ocean       a climb over the Sunset toward Ocean Beach and Golden Gate Park
//   blast       a breath at the Painted Ladies: the frame after the impact with the sign up
//               (logs the sign's text: it must be a real street name)
//   amsterdam   ?city=amsterdam (no LiDAR, no DEM): the Jordaan's canals from the chase camera
//   amsalt      ?city=amsterdam from ~200 m
//   opening     the real opening (no skipintro) a few seconds in: the ODbL credit is on screen
// Writes <outDir>/<shot><tag>.png and <outDir>/osm-shots<tag>.json (renderer stats per shot, sign text).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [base = 'http://127.0.0.1:4951/', out = 'shots/osm', list = 'ladies'] = args;
const tag = flags.tag ? `-${flags.tag}` : '';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const report = {};

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 400000 });
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
  ladies: '?lat=37.77628&lon=-122.4352&heading=88&skipintro',
  northbeach: '?lat=37.7980&lon=-122.4140&heading=58&skipintro',
  fidi: '?lat=37.7905&lon=-122.4075&heading=80&skipintro',
  embarcadero: '?lat=37.7992&lon=-122.3890&heading=235&skipintro',
  amsterdam: '?city=amsterdam&lat=52.3738&lon=4.8775&heading=75&skipintro',
};
const CLIMB = {
  altitude: ['?lat=37.7560&lon=-122.4280&heading=20&skipintro', 300],
  ocean: ['?lat=37.7580&lon=-122.4700&heading=280&skipintro', 330],
  amsalt: ['?city=amsterdam&lat=52.3700&lon=4.8760&heading=40&skipintro', 200],
};

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
    const page = await open('?lat=37.77615&lon=-122.4340&heading=88&skipintro');
    await drift(page, 6);
    await runFor(page, 2);
    // the sign's text: wrap StreetSigns.show to log what main.ts chose
    await page.evaluate(() => {
      const g = window.__game;
      g.__signs = [];
      const city = g.city;
      const orig = city.streetNameAt.bind(city);
      city.streetNameAt = (x, z, d) => {
        const n = orig(x, z, d);
        g.__signs.push({ x, z, street: n });
        return n;
      };
    });
    const tImpact = await page.evaluate(() => window.__game.barfAtLatLon(37.77605, -122.43262));
    await runUntil(page, `g.clock() >= ${tImpact} + 0.9`, 6);
    await page.screenshot({ path: `${out}/blast${tag}.png` });
    report.blast = { signs: await page.evaluate(() => window.__game.__signs), stats: await stats(page) };
    console.log('sign', JSON.stringify(report.blast.signs));
    await page.close();
  } else if (name === 'opening') {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 400000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/opening${tag}.png` });
    report.opening = { credit: await page.evaluate(() => [...document.querySelectorAll('div[role=note]')].map((e) => e.textContent)) };
    console.log('credit', JSON.stringify(report.opening.credit));
    await page.close();
  } else {
    console.log('unknown shot', name);
    continue;
  }
  console.log(name, `${((Date.now() - t) / 1000).toFixed(0)} s`, JSON.stringify(report[name]));
}
writeFileSync(`${out}/osm-shots${tag}.json`, JSON.stringify(report, null, 1));
await browser.close();
