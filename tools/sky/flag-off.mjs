#!/usr/bin/env node
// With no ?moonrun the game must not change: node tools/sky/flag-off.mjs. Loads the plain page from BASE and reads what could give the flight away: requests to /sky/ or the moonrun chunk, the words of the space
// branch in the resolve, the flight's strings in the main chunk, page errors. A running page and the source diff, not a frame-by-frame diff.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4179/';
const DIST = process.env.DIST ?? '../sb-build';
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
let bad = 0, requests = 0, flight = 0;
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => {
    bad++;
    console.log('  [pageerror]', e.message);
  });
  page.on('request', (r) => {
    requests++;
    // (the street's own night sky, since main's 6b494b7: its stars and its Moon, StreetSky.load, once the city is in at night. Anything else under /sky/ is the flight's)
    if (/\/sky\/(stars|moon)\.bin/.test(r.url())) return;
    if (/\/sky\/|moonrun/.test(r.url())) {
      flight++;
      console.log('  flight request:', r.url());
    }
  });
  await page.goto(`${BASE}?fps`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.pipeline, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  const got = await page.evaluate(() => {
    const p = window.__game.pipeline, fs = p.resolveMaterial.fragmentShader;
    // (the street's own sky since main's 6b494b7, the live Sun's disc and the Moon from the street: not the flight's)
    const STREET_SKY = ['uSkySunDisc', 'uMoonDisc', 'uMoonView', 'uSkyMoonSun', 'uSkyMoonRot', 'uMoonShadow', 'uSkyMoonLod', 'tSkyMoon'];
    return { spaceSky: fs.includes('spaceSky'), spaceUniforms: Object.keys(p.resolveMaterial.uniforms).filter((k) => /Earth|Moon|SunDisc|Space/.test(k) && !STREET_SKY.includes(k)).length, programs: p.renderer.info.programs.length, hudTurbo: !!document.querySelector('[data-hud="turbo"]'), label: !!document.querySelector('[data-hud="trip-label"]'), launch: !!document.querySelector('[data-hud="launch"]') };
  });
  const main = readdirSync(join(DIST, 'assets')).find((f) => /^main-.*\.js$/.test(f));
  const text = readFileSync(join(DIST, 'assets', main), 'utf8');
  // (and no way off the page to the flight's: the old launch at the ceiling, a fade and a page change to ?moonland, was a cut the producer rejected. The first account's review, 2026-11-04)
  const strings = ['THE LONG DARK', 'homeCruise', 'uToRender', 'SWITCH_KM', 'moonland&launch'].filter((s) => text.includes(s));
  console.log(JSON.stringify({ requests, flightRequests: flight, ...got, main, flightStringsInMain: strings, pageErrors: bad }));
  if (flight || got.spaceSky || got.spaceUniforms || got.label || got.launch || strings.length) bad++;
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
