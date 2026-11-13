#!/usr/bin/env node
// The link preview's picture (og:image), made from the build: a real frame of the game, 1200 x 630, no HUD, the one a person would tap in a chat.
//   node tools/ogshot.mjs <url> <outdir> [--only=1,2,3] [--nopaint]
// Three candidates, each the bus seen from its side, near, with a San Francisco landmark behind it, over a grey city with one bloom of paint, at golden
// hour (t=2026-11-07T00:22:00Z, the clock standing):
//   1. Alamo Square's row with downtown behind, 2. the Golden Gate's towers from the Marina, 3. downtown from Dolores Park.
// The chase camera is behind and over the bus, and from there at chat size the bus was a speck seen from above (r3's outside look: 25 x 45 px of
// 1200 x 630). So each pose places the lens itself through the QA hook a tool sets and a page never does (window.__qa.camAt: a place over the ground
// looking at another, and its field of view): `d` m back from the bus along the view's bearing V, `rise` m over it, looking at the bus `lift` m up, the
// bus pinned (__qa.pin) at `up` m over the ground heading V + 115 degrees (its side, and a little of its front, to the lens).
// Each: a 600 x 315 CSS viewport at deviceScaleFactor 2, ?px=168 (pixel scale 3, the phone's), &fixeddt. The pose is held until the city has settled and
// shot grey first (og-<n>-grey.png), then the `n` buildings nearest a point `ahead` m out along V are painted to level 3 in the five hues but yellow
// (the bus is the yellow thing in the frame), saved through the game's own store and the page reloaded (the gardens come back as a player's do), and shot
// again (og-<n>.png). Every shot is taken with the exhaust puffs out (their slots' births to 1e9, Particles.ts's K_PUFF) and again with the bus hidden
// (the bus's own pixels are where the two differ). og-<n>-150.png is og-<n>.png as a chat shows it, 150 px wide, scaled by the browser.
// Checks, each candidate (exit 1 names the pose and the check):
//   the PNG is 1200 x 630; the bus is at least 12 % of the frame's width; the bus is seen from its side (its heading 50-130 degrees off the view's
//   bearing) from no more than 20 degrees over it; the landmark's points project inside the frame, in front of the lens (that nothing hides them is
//   not checked); the bloom (pixels changed from the grey frame and a paint step's hue, within 15 degrees of one of palette.ts's paint steps other
//   than yellow's, at HSV saturation over 0.4) is 25-50 % of the frame; at 150 px wide (8 x 8 px boxes, each counted as the bus's when half its
//   pixels are) the bus is at least 16 px wide, at least 25 % of its boxes yellow (hue 35-65 degrees, saturation 0.45 or more: its windows' row,
//   its black stripes and its shade take most of the rest, r3's frames read 26-38 %), and stands off what's
//   behind it (its boxes' mean colour at least 60 apart, in RGB, from the same boxes with the bus hidden); nothing of the HUD is visible; no page error.
// The best of the three is the one that passes most checks, then the one whose bus stands off most at 150 px: ogshot.json's `best`, the one the repo's
// public/og-<n>.png is made from. Exit 0 when the best passes every check (the others' failures are printed, and are why they lost); --nopaint skips
// the paint, so the bloom's check can be seen to fail.
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

// the bus's place (lat, lon, `up` m over the ground), the view's bearing V (degrees from north), the lens's `d`, `rise`, `lift` and field of view, the
// bloom's `n` buildings `ahead` m out, and the landmark's points (lat, lon, m over the sea)
const POSES = [
  { n: 1, name: "Alamo Square's row, downtown behind", landmark: 'the Painted Ladies and the downtown skyline', lat: 37.77615, lon: -122.4337, up: 22, V: 80, d: 32, rise: 4, lift: 0, hfov: 55, ahead: 160, paint: 900,
    marks: [['Salesforce Tower', 37.7897, -122.3969, 326], ['the Painted Ladies', 37.77615, -122.43295, 70]] },
  { n: 2, name: 'the Golden Gate from the Marina', landmark: "the Golden Gate's towers", lat: 37.8035, lon: -122.4375, up: 30, V: 272, d: 38, rise: 5, lift: 0, hfov: 45, ahead: 200, paint: 450,
    marks: [['the south tower', 37.8105, -122.4777, 227], ['the north tower', 37.8262, -122.4786, 227]] },
  { n: 3, name: 'downtown from Dolores Park', landmark: 'the downtown skyline', lat: 37.7612, lon: -122.4256, up: 30, V: 22, d: 36, rise: 5, lift: 0, hfov: 55, ahead: 160, paint: 700,
    marks: [['Salesforce Tower', 37.7897, -122.3969, 326], ['the Transamerica Pyramid', 37.7952, -122.4028, 260]] },
].filter((p) => !opt.only || opt.only.split(',').map(Number).includes(p.n));
const Q = '&skipintro&nohud&t=2026-11-07T00:22:00Z&rate=0&fixeddt=0.0333333&px=168';
const LEVEL = 3, HUES = [0, 1, 3, 4, 5], SIDE = 115;
const M_LAT = 111320, mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const rad = (d) => (d * Math.PI) / 180;

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
const isYellow = (r, g, b) => {
  const [h, s] = hsv(r, g, b);
  return h >= 35 && h <= 65 && s >= 0.45;
};
const dist = (px, i, qx, j) => Math.hypot(px[i] - qx[j], px[i + 1] - qx[j + 1], px[i + 2] - qx[j + 2]);

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
    const H = (p.V + SIDE + 360) % 360;
    const link = `${url}?lat=${p.lat}&lon=${p.lon}&heading=${H}${Q}`;
    // (the lens d m back along V and its look, in lat/lon for camAt and in world m from the bus for the checks: x east, z south, the bake's own frame
    // to well under a metre this near)
    const back = { e: -Math.sin(rad(p.V)) * p.d, n: -Math.cos(rad(p.V)) * p.d };
    const cam = { lat: p.lat + back.n / M_LAT, lon: p.lon + back.e / mLon(p.lat) };
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
    const frames = (k) => page.evaluate((k) => new Promise((res) => requestAnimationFrame(function f() { if (--k > 0) requestAnimationFrame(f); else res(null); })), k);
    /** the bus pinned and the lens placed, held until what's around is in, then frozen: the canvas with the bus, and again without it */
    const take = async (file) => {
      const qa = await page.evaluate(({ p, cam, back }) => {
        const g = window.__game, s = window.__sbStart, c = g.city;
        const gy = c.groundAt(s.x, s.z), busY = gy + p.up;
        const cx = s.x + back.e, cz = s.z - back.n, camGround = c.groundAt(cx, cz);
        const lookH = p.up + p.lift;
        window.__og = {
          pin: { x: s.x, y: busY, z: s.z, heading: s.heading },
          camAt: { lat: cam.lat, lon: cam.lon, h: busY + p.rise - camGround, lookLat: p.lat, lookLon: p.lon, lookH, hfov: p.hfov },
        };
        window.__qa = { ...window.__og };
        return { busY, camY: busY + p.rise, gy };
      }, { p, cam, back });
      await frames(90);
      await settle();
      await page.evaluate(() => (window.__qa = { ...window.__og, holdFrames: 4, held: false }));
      await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 120000, polling: 50 });
      const at = await page.evaluate(({ marks, lat0, lon0 }) => {
        const g = window.__game, s = window.__sbStart, cam = g.camera;
        // (the puffs out: Particles.ts's STRIDE 24 floats a slot, its birth at 3, its kind at 15, K_PUFF 4)
        const P = g.particles, d = P.data;
        for (let i = 0; i < P.cap; i++) if (d[i * 24 + 15] === 4 && d[i * 24 + 3] < 1e8) d[i * 24 + 3] = 1e9;
        P.buf.updateRanges.length = 0;
        P.buf.needsUpdate = true;
        g.renderAgain();
        const proj = (x, y, z) => {
          const v = cam.position.clone().set(x, y, z).project(cam);
          return [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000, Math.round(v.z * 10000) / 10000];
        };
        const M = 111320, mlon = 111320 * Math.cos((lat0 * Math.PI) / 180);
        const pts = marks.map(([name, la, lo, h]) => ({ name, ndc: proj(s.x + (lo - lon0) * mlon, h, s.z - (la - lat0) * M) }));
        const f = g.flight;
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
          if (on && (e.textContent.trim() || e.tagName === 'CANVAS' || e.tagName === 'IMG' || getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)')) shown.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}`);
        }
        return { bus: proj(f.x, f.y, f.z), busPose: { x: f.x, y: f.y, z: f.z, heading: f.heading }, marks: pts, shown };
      }, { marks: p.marks, lat0: p.lat, lon0: p.lon });
      await frames(2);
      const shot = await page.locator('canvas#game').screenshot({ path: file });
      await page.evaluate(() => {
        const g = window.__game, b = g.scene.getObjectByName('BusRoot');
        b.visible = false;
        g.renderAgain();
      });
      await frames(2);
      const bare = await page.locator('canvas#game').screenshot({ path: file.replace('.png', '-nobus.png') });
      await page.evaluate(() => {
        const g = window.__game;
        g.scene.getObjectByName('BusRoot').visible = true;
        g.renderAgain();
      });
      return { at, qa, shot, bare, img: readPng(shot), bareImg: readPng(bare) };
    };
    await page.goto(link, { waitUntil: 'load' });
    await ready();
    const grey = await take(join(out, `og-${p.n}-grey.png`));
    const painted = opt.nopaint ? { painted: 0, radius: 0 } : await page.evaluate(
      ({ n, ahead, V, level, hues }) => {
        const g = window.__game, c = g.city, s = window.__sbStart;
        const a = (V * Math.PI) / 180, x = s.x + Math.sin(a) * ahead, z = s.z - Math.cos(a) * ahead;
        const pick = c.buildingsNear(x, z, 1500, []).sort((a, b) => a.d - b.d).slice(0, n);
        pick.forEach((b, i) => c.paint.set(b.ref.index, { faction: 1, color: hues[i % hues.length], level, bloomTime: -100 }));
        c.paint.persist();
        return { painted: pick.length, radius: Math.round(pick.length ? pick[pick.length - 1].d : 0) };
      },
      { n: p.paint, ahead: p.ahead, V: p.V, level: LEVEL, hues: HUES },
    );
    await page.reload({ waitUntil: 'load' });
    await ready();
    const file = join(out, `og-${p.n}.png`);
    const T = await take(file);
    const { w, h, px } = T.img, bp = T.bareImg.px, gp = grey.img.px;
    // ---- the bus's own pixels: where the frame and the frame with the bus hidden differ, round where the bus projects (its shadow lands far off)
    const bx = ((T.at.bus[0] + 1) / 2) * w, by = ((1 - T.at.bus[1]) / 2) * h;
    const mask = new Uint8Array(w * h);
    let x0 = w, x1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (Math.abs(x - bx) > w * 0.3 || Math.abs(y - by) > h * 0.4) continue;
      if (dist(px, i * 4, bp, i * 4) > 24) {
        mask[i] = 1;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    }
    const busW = x1 >= x0 ? x1 - x0 + 1 : 0;
    // ---- the bloom: changed from the grey frame, and paint
    let bloom = 0;
    for (let i = 0; i < w * h; i++) if (!mask[i] && dist(px, i * 4, gp, i * 4) > 24 && isPaint(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) bloom++;
    // ---- at chat size: 8 x 8 boxes (1200 -> 150 px)
    const B = 8, cw = Math.floor(w / B), chh = Math.floor(h / B);
    const small = (src) => {
      const o = new Float64Array(cw * chh * 4);
      for (let cy = 0; cy < chh; cy++) for (let cx = 0; cx < cw; cx++) {
        let r = 0, g = 0, b = 0, m = 0;
        for (let y = cy * B; y < cy * B + B; y++) for (let x = cx * B; x < cx * B + B; x++) {
          const i = y * w + x;
          r += src[i * 4]; g += src[i * 4 + 1]; b += src[i * 4 + 2]; m += mask[i];
        }
        const k = (cy * cw + cx) * 4;
        o[k] = r / 64; o[k + 1] = g / 64; o[k + 2] = b / 64; o[k + 3] = m / 64;
      }
      return o;
    };
    const S = small(px), Sb = small(bp);
    let c0 = cw, c1 = -1, cells = 0, yellow = 0, apart = 0;
    for (let c = 0; c < cw * chh; c++) {
      if (S[c * 4 + 3] < 0.5) continue;
      const cx = c % cw;
      c0 = Math.min(c0, cx);
      c1 = Math.max(c1, cx);
      cells++;
      if (isYellow(S[c * 4], S[c * 4 + 1], S[c * 4 + 2])) yellow++;
      apart += dist(S, c * 4, Sb, c * 4);
    }
    const chat = { busPx: c1 >= c0 ? c1 - c0 + 1 : 0, cells, yellow: cells ? Math.round((yellow / cells) * 100) / 100 : 0, apart: cells ? Math.round(apart / cells) : 0 };
    // ---- the side, and how far over the bus the lens is
    const off = ((H - p.V) % 360 + 360) % 360, side = Math.min(Math.abs(off - 90), Math.abs(off - 270));
    const down = (Math.atan2(p.rise, p.d) * 180) / Math.PI;
    const r = {
      n: p.n, pose: p.name, landmark: p.landmark, file, size: [w, h], kb: Math.round(T.shot.length / 1024), painted, view: { V: p.V, heading: H, d: p.d, rise: p.rise, hfov: p.hfov },
      busNdc: T.at.bus, busW, busShare: Math.round((busW / w) * 1000) / 1000, sideOff: Math.round(side), downDeg: Math.round(down * 10) / 10, marks: T.at.marks,
      bloomShare: Math.round((bloom / (w * h)) * 1000) / 1000, chat, hud: T.at.shown, errors,
    };
    const checks = [
      [w === 1200 && h === 630, `the PNG is ${w} x ${h}`],
      [busW >= 0.12 * w, `the bus is ${busW} px wide, ${(r.busShare * 100).toFixed(1)} % of the frame (12 % or more)`],
      [side <= 40 && down <= 20, `the bus seen from its side: its heading ${off} degrees off the view's bearing (50-130), the lens ${r.downDeg} degrees over it (20 or less)`],
      [T.at.marks.every((m) => Math.abs(m.ndc[0]) <= 1 && Math.abs(m.ndc[1]) <= 1 && m.ndc[2] < 1), `${p.landmark} in the frame: ${T.at.marks.map((m) => `${m.name} at ${m.ndc[0]}, ${m.ndc[1]}`).join('; ')}`],
      [r.bloomShare >= 0.25 && r.bloomShare <= 0.5, `the bloom in ${(r.bloomShare * 100).toFixed(1)} % of the pixels (25-50 %: painted, and changed from the grey frame's, so only the points over the grey frame's count)`],
      [chat.busPx >= 16, `at 150 px wide the bus is ${chat.busPx} px wide (16 or more)`],
      [chat.yellow >= 0.25 && chat.apart >= 60, `at 150 px the bus reads yellow and stands off what's behind it: ${Math.round(chat.yellow * 100)} % of its ${chat.cells} boxes yellow (25 %), ${chat.apart} apart from the same boxes without it (60)`],
      [T.at.shown.length === 0, `no HUD (${T.at.shown.slice(0, 6).join(', ') || 'none'})`],
      [errors.length === 0, `no page error (${errors[0] ?? 'none'})`],
    ];
    r.passed = checks.filter(([c]) => c).length;
    r.checks = checks.map(([c, m]) => `${c ? 'ok' : 'FAIL'}: ${m}`);
    for (const [c, m] of checks) {
      console.log(`${c ? 'ok' : 'FAIL'} ${p.n} (${p.name}): ${m}`);
      if (!c) failed.push(`${p.n} (${p.name}): ${m}`);
    }
    // (as a chat shows it: the browser's own scaling to 150 px wide)
    const view = await browser.newPage({ viewport: { width: 150, height: 79 }, deviceScaleFactor: 1 });
    await view.setContent(`<body style="margin:0"><img id="i" style="width:150px;display:block" src="data:image/png;base64,${T.shot.toString('base64')}"></body>`);
    await view.waitForFunction(() => document.getElementById('i').complete);
    await view.locator('#i').screenshot({ path: join(out, `og-${p.n}-150.png`) });
    await view.close();
    results.push(r);
    console.log(`${p.n} ${p.name}: ${r.kb} KB, ${painted.painted} painted within ${painted.radius} m, the bus ${busW} px (${chat.busPx} at 150), the bloom ${(r.bloomShare * 100).toFixed(1)} %, ${r.passed} of ${checks.length} checks`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
const best = [...results].sort((a, b) => b.passed - a.passed || b.chat.apart * b.chat.busPx - a.chat.apart * a.chat.busPx)[0] ?? null;
writeFileSync(join(out, 'ogshot.json'), JSON.stringify({ url, best: best?.n ?? null, results, failed }, null, 1));
if (best) console.log(`best: ${best.n} (${best.pose}), ${best.passed} of ${best.checks.length} checks, the bus ${best.chat.busPx} px at 150 and ${best.chat.apart} apart`);
const bestOk = !!best && best.passed === best.checks.length;
console.log(bestOk ? `ogshot: the best passes every check (${failed.length} failed among the others)` : `ogshot: the best fails (${failed.length} failed)`);
process.exit(bestOk ? 0 : 1);
