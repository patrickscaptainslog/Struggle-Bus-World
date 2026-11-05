#!/usr/bin/env node
// The live sky's frames (docs/specs/sky/LIVE.md, its gates): San Francisco at seven moments by ?t=, at three places, one contact sheet, and each frame's time on this
// machine's GPU (wall frame ms off window.__stats, which only means something on a real GPU).
//   node tools/sky/clock-frames.mjs <baseUrl> <outDir> [--moments=noon,golden,...] [--places=alamo,opening,ceiling] [--q=...]
// Moments (UTC, worked out for San Francisco's origin with src/sky/SkyModel.ts):
//   noon      2026-11-05T20:05Z  the Sun 36.3 degrees, near its transit
//   golden    2026-11-06T00:30Z  5.9 degrees, setting
//   sunset    2026-11-06T01:04Z  -0.3 degrees, the upper limb on the horizon
//   blue      2026-11-06T01:35Z  -6.2 degrees
//   moon      2026-11-30T08:00Z  local midnight, the Moon 13 degrees up in the east, 59 % lit (the first midnight with the Moon this low and this lit: it's new on the
//                                9th, and from the 17th to the 29th it's up at midnight but higher than the ceiling's lift can show)
//   moonless  2026-11-06T08:00Z  local midnight, the Moon 46 degrees under the horizon
//   dawn      2026-11-06T14:28Z  -3.2 degrees, rising, a 7 % crescent 24 degrees up in the east-southeast
//   occultation 2026-12-02T10:10Z  the Moon 12.5 degrees up at azimuth 101, 37 % lit, the Sun -57.8, and a magnitude 4.2 star 0.22 degrees from the Moon's centre, on
//                                its dark side, which the Moon must cover (docs/reviews/main-live-2026-11-05.md, m4). Not in the default list: --moments=occultation
// Places: alamo (Alamo Square, heading east, at the rooftops), opening (the Golden Gate opening), ceiling (Alamo Square, put at 14.9 km and pulled up into the
// 15 km ceiling, where the view lifts to the sky: SKY.md 4.15). The sky's clock stands at the moment (&rate=0).
// Writes <outDir>/<moment>-<place>.png, sheet.png and frames.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base = 'http://127.0.0.1:4173/', out = 'shots/local/clock-frames'] = pos;

const MOMENTS = {
  noon: '2026-11-05T20:05:00Z',
  golden: '2026-11-06T00:30:00Z',
  sunset: '2026-11-06T01:04:00Z',
  blue: '2026-11-06T01:35:00Z',
  moon: '2026-11-30T08:00:00Z',
  moonless: '2026-11-06T08:00:00Z',
  dawn: '2026-11-06T14:28:00Z',
};
// (asked for by name only, so the default sheet stays the seven it was)
const EXTRA = { occultation: '2026-12-02T10:10:00Z' };
const ALAMO = '?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud';
const PLACES = {
  alamo: { query: ALAMO },
  opening: { query: '?openingshot&nohud' },
  ceiling: { query: ALAMO, ceiling: true },
};
const moments = (opt.moments ?? Object.keys(MOMENTS).join(',')).split(',');
const places = (opt.places ?? Object.keys(PLACES).join(',')).split(',');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions([]));
const report = { base, frames: {} };

for (const m of moments)
  for (const pl of places) {
    const P = PLACES[pl], name = `${m}-${pl}`;
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
    page.on('console', (c) => c.type() === 'error' && !c.text().includes('404') && console.log(`[${name} console]`, c.text()));
    await page.goto(`${base}${P.query}&t=${MOMENTS[m] ?? EXTRA[m]}&rate=0${opt.q ? `&${opt.q}` : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
    if (!report.gpu)
      report.gpu = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : 'no webgl2';
      });
    // run frames until cond(g) holds or maxS of game time has passed
    const run = (cond, maxS) =>
      page.evaluate(
        ([c, s]) =>
          new Promise((res) => {
            const g = window.__game, f = new Function('g', `return (${c})`), t0 = g.clock();
            const tick = () => (g.clock() - t0 >= s || f(g) ? res() : requestAnimationFrame(tick));
            tick();
          }),
        [cond, maxS],
      );
    // (the stars' files land after the city)
    await run('!g.sky || !g.sky.street || g.sky.street.timing.readMs > 0', 20);
    if (P.ceiling) {
      // up to just under the ceiling at once, then a full pull into it: the climb's last metres, the strain, the lift
      await page.evaluate(() => {
        const f = window.__game.flight;
        f.y = 14900;
        f.vy = 0;
        window.__qa = { sx: 0, sy: -1 };
      });
      await run('g.flight.strain > 0.8 && g.rig.skyLift > 26', 40);
      await run('false', 2);
      await run('!g.city.busy', 30);
      await run('false', 2);
    } else {
      await run('false', P.query.includes('openingshot') ? 4.5 : 2);
      await run('!g.city.busy', 30);
      await run('false', 1);
    }
    await page.screenshot({ path: join(out, `${name}.png`) });
    // __stats is a one-second window: skip the one in progress, then three
    await page.waitForTimeout(1200);
    const stats = [];
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1050);
      stats.push(await page.evaluate(() => window.__stats));
    }
    const sky = await page.evaluate(() => {
      const k = window.__game.sky, s = k?.street, f = window.__game.flight;
      return k
        ? { utc: k.utc, sunEl: +k.sunEl.toFixed(2), stars: s.limit > -5 ? +s.limit.toFixed(2) : null, drawn: s.drawn, moonEl: +s.moonEl.toFixed(1), moonLit: +s.moonLit.toFixed(2), moonPx: +s.moonPx.toFixed(1), moonKey: +s.moonKey.toFixed(2), lift: +window.__game.rig.skyLift.toFixed(1), y: Math.round(f.y) }
        : null;
    });
    const avg = (k) => +(stats.reduce((a, s) => a + s[k], 0) / stats.length).toFixed(2);
    report.frames[name] = { sky, fps: avg('fps'), frameMs: avg('frameMs'), frameMaxMs: Math.max(...stats.map((s) => s.frameMaxMs)), workMs: avg('workMs'), calls: Math.max(...stats.map((s) => s.calls)), triangles: Math.max(...stats.map((s) => s.triangles)), programs: stats[2].programs };
    console.log(name, JSON.stringify(report.frames[name]));
    await page.close();
  }

// the contact sheet: a column a moment, a row a place, at a third of the device pixels (a game pixel each)
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const cell = (m, pl) => {
  const name = `${m}-${pl}`, f = report.frames[name];
  const src = `data:image/png;base64,${readFileSync(join(out, `${name}.png`)).toString('base64')}`;
  return `<figure><img src="${src}"><figcaption>${name}<br>${(MOMENTS[m] ?? EXTRA[m]).slice(5, 16).replace('T', ' ')}Z &middot; ${f.frameMs} ms</figcaption></figure>`;
};
await page.setContent(`<!doctype html><style>
  body { margin: 0; padding: 8px; background: #111; color: #ddd; font: 11px/1.3 system-ui, sans-serif; }
  .grid { display: grid; grid-template-columns: repeat(${moments.length}, 196px); gap: 6px; }
  figure { margin: 0; } img { width: 196px; height: 425px; display: block; image-rendering: pixelated; } figcaption { padding: 2px 0 4px; }
</style><div class="grid">${places.map((pl) => moments.map((m) => cell(m, pl)).join('')).join('')}</div>`);
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, 'sheet.png'), fullPage: true });
writeFileSync(join(out, 'frames.json'), JSON.stringify(report, null, 1));
console.log('gpu', report.gpu);
await browser.close();
