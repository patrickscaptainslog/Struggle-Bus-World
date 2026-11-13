#!/usr/bin/env node
// The link preview's picture (og:image), made from the build: a real frame of the game, 1200 x 630, no HUD.
//   node tools/ogshot.mjs <url> <outdir> [--only=1,2,3]
// Three candidates, each the bus in the chase camera low over San Francisco at golden hour (t=2026-11-07T00:22:00Z, the clock standing), its roofs
// ahead painted in the six hues to level 3, gardens and crowns:
//   1. the Marina toward the Golden Gate, 2. Alamo Square toward downtown, 3. Dolores Park toward downtown.
// Each: a 600 x 315 CSS viewport at deviceScaleFactor 2, ?px=168 (pixel scale 3, the phone's: PixelPipeline.resize's rule, landscape's 1.25),
// &fixeddt. The 600 buildings nearest a point 250 m ahead of the pose are painted to level 3, colours i % 6, saved through the game's own store and the
// page reloaded, so the gardens come back as a player's do (tools/gardens/budget.mjs's way). The bus is held at the pose 40 m over the ground until the
// city has settled, let go for 2 s of flight, frozen (__qa.holdFrames = 0) and the canvas shot to <outdir>/og-<n>.png.
// Exit 0 only when for each: the PNG is 1200 x 630; the bus projects inside the middle 60 % of the frame; at least 10 % of the pixels (an ESTIMATE
// threshold) are within 15 degrees of hue of one of palette.ts's paint steps other than yellow's (the bus is yellow), at HSV saturation over 0.4, so
// the paint is there (by hue: the light shades the steps); and nothing of the HUD is visible in the page. Exit 1 names the pose and the test.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserOptions } from './browser.mjs';
import { readPng } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [url = 'http://127.0.0.1:4173/', out = 'shots/tmp/og'] = pos;
mkdirSync(out, { recursive: true });

const POSES = [
  { n: 1, name: 'the Marina toward the Golden Gate', lat: 37.803, lon: -122.44, heading: 300 },
  { n: 2, name: 'Alamo Square toward downtown', lat: 37.7762, lon: -122.4346, heading: 70 },
  { n: 3, name: 'Dolores Park toward downtown', lat: 37.7596, lon: -122.4269, heading: 20 },
].filter((p) => !opt.only || opt.only.split(',').map(Number).includes(p.n));
const Q = '&skipintro&nohud&t=2026-11-07T00:22:00Z&rate=0&fixeddt=0.0333333&px=168';
const PAINT = 600, AHEAD = 250, LEVEL = 3, UP = 40, FLY = 60;

// the paint steps by hue: palette.ts's RED, ORANGE, GREEN, BLUE and VIOLET ramps, each step over 0.4 saturation
const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, mx ? d / mx : 0];
};
const pal = readFileSync(join(root, 'src/render/palette.ts'), 'utf8');
const hues = [];
for (const ramp of ['RED', 'ORANGE', 'GREEN', 'BLUE', 'VIOLET']) {
  const m = new RegExp(`\\[Ramp\\.${ramp}\\]:\\s*\\[([^\\]]*)\\]`).exec(pal);
  if (!m) throw new Error(`palette.ts: no ${ramp} ramp`);
  for (const hex of m[1].match(/#[0-9a-f]{6}/gi)) {
    const [h, s] = hsv(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
    if (s > 0.4) hues.push(h);
  }
}
const isPaint = (r, g, b) => {
  const [h, s] = hsv(r, g, b);
  if (s <= 0.4) return false;
  for (const p of hues) if (Math.min(Math.abs(h - p), 360 - Math.abs(h - p)) <= 15) return true;
  return false;
};

const browser = await chromium.launch(browserOptions([]));
const failed = [];
const results = [];
try {
  for (const p of POSES) {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 315 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // (the pose the boot gave the bus, before its first step)
    await page.addInitScript(() => {
      const look = () => {
        const f = window.__game?.flight;
        if (f) window.__sbStart = { x: f.x, z: f.z, heading: f.heading };
        else requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    const link = `${url}?lat=${p.lat}&lon=${p.lon}&heading=${p.heading}${Q}`;
    const settle = () =>
      page.evaluate(
        () =>
          new Promise((res, rej) => {
            const g = window.__game, t0 = performance.now();
            let quiet = 0;
            const tick = () => {
              quiet = !g.city.busy && g.city.ground.queued === 0 ? quiet + 1 : 0;
              if (quiet >= 30) res(null);
              else if (performance.now() - t0 > 200000) rej(new Error('the city never settled'));
              else requestAnimationFrame(tick);
            };
            tick();
          }),
      );
    const ready = async () => {
      await page.waitForFunction(() => window.__shotReady === true && !!window.__sbStart, null, { timeout: 240000, polling: 200 });
      await settle();
    };
    await page.goto(link, { waitUntil: 'load' });
    await ready();
    const painted = await page.evaluate(
      ({ n, ahead, level }) => {
        const g = window.__game, c = g.city, s = window.__sbStart;
        const x = s.x + Math.sin(s.heading) * ahead, z = s.z - Math.cos(s.heading) * ahead;
        const pick = c.buildingsNear(x, z, 1500, []).sort((a, b) => a.d - b.d).slice(0, n);
        pick.forEach((b, i) => c.paint.set(b.ref.index, { faction: 1, color: i % 6, level, bloomTime: -100 }));
        c.paint.persist();
        return { painted: pick.length, radius: Math.round(pick.length ? pick[pick.length - 1].d : 0) };
      },
      { n: PAINT, ahead: AHEAD, level: LEVEL },
    );
    await page.reload({ waitUntil: 'load' });
    await ready();
    // held at the pose, over the ground, until what's around it is in; then 2 s of flight, and the frame frozen
    await page.evaluate((up) => {
      const g = window.__game, s = window.__sbStart;
      window.__qa = { pin: { x: s.x, y: g.city.groundAt(s.x, s.z) + up, z: s.z, heading: s.heading } };
    }, UP);
    await page.evaluate(() => new Promise((res) => { let k = 90; requestAnimationFrame(function f() { if (--k > 0) requestAnimationFrame(f); else res(null); }); }));
    await settle();
    await page.evaluate((k) => (window.__qa = { holdFrames: k, held: false }), FLY);
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 120000, polling: 50 });
    const at = await page.evaluate(() => {
      const g = window.__game, f = g.flight, v = g.camera.position.clone().set(f.x, f.y, f.z).project(g.camera);
      // anything of the page but the canvas that shows: the HUD's root, its toasts, the credit, the tuner
      const shown = [];
      for (const e of document.body.querySelectorAll('*')) {
        if (e.id === 'game' || e.tagName === 'SCRIPT' || e.closest('svg')) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
        let el = e, on = true;
        while (el && el !== document.body && on) {
          const st = getComputedStyle(el);
          on = st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0;
          el = el.parentElement;
        }
        if (on && (e.textContent.trim() || e.tagName === 'CANVAS' || e.tagName === 'IMG' || getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)')) shown.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className : ''}`);
      }
      return { ndc: [v.x, v.y, v.z], bus: { x: f.x, y: f.y, z: f.z }, shown, scale: g.pipeline.info?.scale ?? null };
    });
    const file = join(out, `og-${p.n}.png`);
    const shot = await page.locator('canvas#game').screenshot({ path: file });
    const { w, h, px } = readPng(shot);
    let paint = 0;
    for (let i = 0; i < w * h; i++) if (isPaint(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) paint++;
    const share = paint / (w * h);
    const r = { n: p.n, pose: p.name, file, size: [w, h], kb: Math.round(shot.length / 1024), painted, busNdc: at.ndc.map((v) => Math.round(v * 1000) / 1000), paintShare: Math.round(share * 1000) / 1000, hud: at.shown, scale: at.scale, errors };
    results.push(r);
    const bad = (why) => {
      failed.push(`${p.n} (${p.name}): ${why}`);
      console.log(`FAIL ${p.n} (${p.name}): ${why}`);
    };
    if (w !== 1200 || h !== 630) bad(`the PNG is ${w} x ${h}, not 1200 x 630`);
    if (!(Math.abs(at.ndc[0]) <= 0.6 && Math.abs(at.ndc[1]) <= 0.6 && at.ndc[2] < 1)) bad(`the bus projects at ${r.busNdc.slice(0, 2).join(', ')} (NDC), outside the middle 60 %`);
    if (share < 0.1) bad(`paint in ${(share * 100).toFixed(1)} % of the pixels, under 10 %`);
    if (at.shown.length) bad(`the HUD shows: ${at.shown.slice(0, 6).join(', ')}`);
    if (errors.length) bad(`page error: ${errors[0]}`);
    console.log(`${p.n} ${p.name}: ${w} x ${h}, ${r.kb} KB, ${painted.painted} painted within ${painted.radius} m, the bus at ${r.busNdc.slice(0, 2).join(', ')}, paint ${(share * 100).toFixed(1)} %, pixel scale ${at.scale}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, 'ogshot.json'), JSON.stringify({ url, results, failed }, null, 1));
console.log(failed.length ? `ogshot: ${failed.length} failed` : `ogshot: ${results.length} candidates pass`);
process.exit(failed.length ? 1 : 0);
