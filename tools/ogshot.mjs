#!/usr/bin/env node
// The link preview's picture (og:image), made from the build: a real frame of the game, 1200 x 630, no HUD, the one a person would tap in a chat.
//   node tools/ogshot.mjs <url> <outdir> [--only=4,5,6] [--nopaint] [--nomark]
// Three candidates, each the bus seen from its side, near, with a San Francisco landmark behind it, over a grey city with one bloom of paint, at golden
// hour (t=2026-11-07T00:22:00Z, the clock standing):
//   4. downtown and the Transamerica Pyramid from Alamo Square's row, 5. the Golden Gate's towers from the Marina, 6. Coit Tower from North Beach.
// (1-3 were round 3's: the outside look took 1, Alamo Square's, and asked for the bus a third of the frame's width, the dark park cut, less paint;
// 2's bus sat orange among the gardens' orange domes; 3 read as noise. A candidate is a new number, as the repo's picture is.)
// The chase camera is behind and over the bus, and from there at chat size the bus was a speck seen from above (r3's outside look: 25 x 45 px of
// 1200 x 630). So each pose places the lens itself through the QA hook a tool sets and a page never does (window.__qa.camAt: a place over the ground
// looking at another, and its field of view): `d` m back from the bus along the view's bearing V, `rise` m over it, looking at the bus `lift` m up, the
// bus pinned (__qa.pin) at `up` m over the ground heading V + 115 degrees (its side, and a little of its front, to the lens).
// Each: a 600 x 315 CSS viewport at deviceScaleFactor 2, ?px=168 (pixel scale 3, the phone's), &fixeddt. The pose is held until the city has settled and
// shot grey first (og-<n>-grey.png), then the `paint` buildings nearest a point `ahead` m out along V are painted to level 2 (no gardens' domes and
// crowns: they took yellow and orange round the bus at level 3) in four hues, red, green, blue and violet (not yellow or orange, the bus's), saved
// through the game's own store and the page reloaded (paint comes back as a player's does), and shot again (og-<n>.png). Every shot is taken with
// the exhaust puffs out (their slots' births to 1e9, Particles.ts's K_PUFF 4), again with the bus hidden (og-<n>-nobus.png: the bus's own pixels are
// where the two differ), and again with the landmark's own objects hidden (og-<n>-nomark.png: what of it shows is where those two differ).
// og-<n>-150.png is og-<n>.png as a chat shows it, 150 px wide, scaled by the browser.
// Checks, each candidate (exit 1 names the pose and the check). Every bound was set before this version's frames were seen (r3's review):
//   the PNG is 1200 x 630; the bus is at least 25 % of the frame's width; the bus is seen from its side (its own heading, read on the page, 50-130
//   degrees off the view's bearing) from no more than 20 degrees over it (the lens's real place against the bus's); each of the landmark's points
//   shows: over the box round its column, from its foot to its top and 12 px either side, at least 40 rows (5 px at 150 px wide) where the frame
//   and the frame with the landmark hidden differ, so a landmark hidden behind something, or out of the frame, fails; the bloom (pixels changed
//   from the grey frame and a paint step's hue, within 15 degrees of one of palette.ts's paint steps other than yellow's, at HSV saturation over
//   0.4) is 20-45 % of the city's pixels (those under the sky: in each column of the grey frame, from its first step of more than 24 down), so at
//   least half the city is left grey; yellow (hue 35-65 degrees, saturation 0.45 or more) off the bus is at most 2 % of the frame; at 150 px wide
//   (8 x 8 px boxes, each counted as the bus's when half its pixels are) the bus is at least 16 px wide, at least 25 % of its boxes yellow (its
//   windows' row, its black stripes and its shade take most of the rest), and stands off what's behind it (its boxes' mean colour at least 60
//   apart, in RGB, from the same boxes with the bus hidden); nothing of the HUD is visible; no page error.
// The best of the three is the one that passes most checks, then the one whose bus stands off most at 150 px: ogshot.json's `best`, the one the repo's
// public/og-<n>.png is made from. Exit 0 when the best passes every check (the others' failures are printed, and are why they lost). --nopaint skips
// the paint and --nomark hides the landmarks in every shot, so the bloom's and the landmark's checks can be seen to fail.
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
// bloom's `paint` buildings `ahead` m out, the landmark's points (lat, lon, m over its ground) and its objects (`hide`: the scene's objects named so,
// or 'bridge': those carrying a bridge's shape, Bridges.ts)
const POSES = [
  { n: 4, name: "downtown from Alamo Square's row", landmark: 'the Transamerica Pyramid and downtown', lat: 37.7768, lon: -122.4316, up: 24, V: 58, d: 26, rise: 3, lift: 2, hfov: 42, ahead: 220, paint: 260,
    hide: 'Transamerica', marks: [['the Transamerica Pyramid', 37.7952, -122.4028, 260]] },
  { n: 5, name: 'the Golden Gate from the Marina', landmark: "the Golden Gate's towers", lat: 37.8035, lon: -122.4375, up: 30, V: 272, d: 30, rise: 3, lift: 2, hfov: 36, ahead: 200, paint: 160,
    hide: 'bridge', marks: [['the south tower', 37.8105, -122.4777, 227], ['the north tower', 37.8262, -122.4786, 227]] },
  { n: 6, name: 'Coit Tower from North Beach', landmark: 'Coit Tower on Telegraph Hill', lat: 37.8008, lon: -122.4122, up: 26, V: 76, d: 26, rise: 3, lift: 2, hfov: 42, ahead: 200, paint: 220,
    hide: 'CoitTower', marks: [['Coit Tower', 37.8024, -122.4058, 64]] },
].filter((p) => !opt.only || opt.only.split(',').map(Number).includes(p.n));
const Q = '&skipintro&nohud&t=2026-11-07T00:22:00Z&rate=0&fixeddt=0.0333333&px=168';
const LEVEL = 2, HUES = [0, 3, 4, 5], SIDE = 115;
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
    // (the landmark's own objects shown or hidden: --nomark hides them in every shot)
    const marks = (on) =>
      page.evaluate(({ hide, on }) => {
        const g = window.__game;
        let k = 0;
        g.scene.traverse((o) => {
          if (!(hide === 'bridge' ? o.userData?.bridge : o.name === hide)) return;
          o.userData.ogShown ??= o.visible;
          o.visible = on && o.userData.ogShown;
          k++;
        });
        g.renderAgain();
        return k;
      }, { hide: p.hide, on: !!on && !opt.nomark });
    /** the bus pinned and the lens placed, held until what's around is in, then frozen: the canvas with the bus, again without it, and again with the
     *  bus but not the landmark */
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
      const found = await marks(true);
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
        // (each point's foot, on the city's ground, and its top `h` over it)
        const pts = marks.map(([name, la, lo, h]) => {
          const x = s.x + (lo - lon0) * mlon, z = s.z - (la - lat0) * M, y0 = g.city.groundAt(x, z);
          return { name, ndc: proj(x, y0 + h, z), foot: proj(x, y0, z) };
        });
        const f = g.flight, lens = cam.position;
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
        return { bus: proj(f.x, f.y, f.z), busPose: { x: f.x, y: f.y, z: f.z, heading: f.heading }, lens: { x: lens.x, y: lens.y, z: lens.z }, marks: pts, shown };
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
      await marks(false);
      await frames(2);
      const nomark = await page.locator('canvas#game').screenshot({ path: file.replace('.png', '-nomark.png') });
      await marks(true);
      return { at, qa, found, shot, bare, img: readPng(shot), bareImg: readPng(bare), markImg: readPng(nomark) };
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
    const { w, h, px } = T.img, bp = T.bareImg.px, gp = grey.img.px, mp = T.markImg.px;
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
    // ---- the city's pixels: in each column of the grey frame, from its first step down out of the sky
    const city = new Uint8Array(w * h);
    let cityPx = 0;
    for (let x = 0; x < w; x++) {
      let y = 1;
      while (y < h && dist(gp, (y * w + x) * 4, gp, ((y - 1) * w + x) * 4) <= 24) y++;
      for (; y < h; y++) if (!mask[y * w + x]) (city[y * w + x] = 1), cityPx++;
    }
    // ---- the bloom: changed from the grey frame, and paint; and yellow off the bus
    let bloom = 0, yellowOff = 0;
    for (let i = 0; i < w * h; i++) {
      if (mask[i]) continue;
      if (isYellow(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) yellowOff++;
      if (city[i] && dist(px, i * 4, gp, i * 4) > 24 && isPaint(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) bloom++;
    }
    // ---- the landmark: each point's column, its foot to its top and 12 px either side, the rows where the frame and the frame without it differ
    const shows = T.at.marks.map((m) => {
      const mx = ((m.ndc[0] + 1) / 2) * w, top = ((1 - m.ndc[1]) / 2) * h, foot = ((1 - m.foot[1]) / 2) * h;
      const inFront = m.ndc[2] < 1 && m.foot[2] < 1;
      let rows = 0;
      if (inFront)
        for (let y = Math.max(0, Math.floor(top)); y <= Math.min(h - 1, Math.ceil(foot)); y++) {
          let n = 0;
          for (let x = Math.max(0, Math.floor(mx - 12)); x <= Math.min(w - 1, Math.ceil(mx + 12)); x++) if (dist(px, (y * w + x) * 4, mp, (y * w + x) * 4) > 24) n++;
          if (n >= 2) rows++;
        }
      return { name: m.name, x: Math.round(mx), top: Math.round(top), foot: Math.round(foot), rows };
    });
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
    // ---- the side (the bus's own heading, as the page has it: radians from north, east positive), and how far over the bus the lens really is
    const bp0 = T.at.busPose, L = T.at.lens;
    const off = Math.round(((((bp0.heading * 180) / Math.PI - p.V) % 360) + 360) % 360), side = Math.min(Math.abs(off - 90), Math.abs(off - 270));
    const down = (Math.atan2(L.y - bp0.y, Math.hypot(L.x - bp0.x, L.z - bp0.z)) * 180) / Math.PI;
    const r = {
      n: p.n, pose: p.name, landmark: p.landmark, file, size: [w, h], kb: Math.round(T.shot.length / 1024), painted, view: { V: p.V, heading: H, d: p.d, rise: p.rise, hfov: p.hfov },
      busNdc: T.at.bus, busW, busShare: Math.round((busW / w) * 1000) / 1000, sideOff: Math.round(side), downDeg: Math.round(down * 10) / 10, marks: T.at.marks, shows, hidden: T.found,
      cityShare: Math.round((cityPx / (w * h)) * 1000) / 1000, bloomShare: Math.round((bloom / Math.max(1, cityPx)) * 1000) / 1000, yellowOff: Math.round((yellowOff / (w * h)) * 1000) / 1000, chat, hud: T.at.shown, errors,
    };
    const checks = [
      [w === 1200 && h === 630, `the PNG is ${w} x ${h}`],
      [busW >= 0.25 * w, `the bus is ${busW} px wide, ${(r.busShare * 100).toFixed(1)} % of the frame (25 % or more)`],
      [side <= 40 && down <= 20, `the bus seen from its side: its heading ${off} degrees off the view's bearing (50-130), the lens ${r.downDeg} degrees over it (20 or less)`],
      [T.found > 0 && shows.every((m) => m.rows >= 40), `${p.landmark} shows: ${shows.map((m) => `${m.name} ${m.rows} rows differ from the frame without it (40), at x ${m.x}, rows ${m.top}-${m.foot}`).join('; ')} (${T.found} objects hidden for it)`],
      [r.bloomShare >= 0.2 && r.bloomShare <= 0.45, `the bloom in ${(r.bloomShare * 100).toFixed(1)} % of the city's pixels (20-45 %: painted and changed from the grey frame's; the city ${(r.cityShare * 100).toFixed(1)} % of the frame, the sky the rest)`],
      [r.yellowOff <= 0.02, `yellow off the bus in ${(r.yellowOff * 100).toFixed(1)} % of the frame (2 % or less)`],
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
    console.log(`${p.n} ${p.name}: ${r.kb} KB, ${painted.painted} painted within ${painted.radius} m, the bus ${busW} px (${chat.busPx} at 150), the bloom ${(r.bloomShare * 100).toFixed(1)} % of the city, ${r.passed} of ${checks.length} checks`);
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
