#!/usr/bin/env node
// The factions' colours from the game itself (docs/specs/factions/FACTIONS.md, step 5): one painted block per faction under each of the live sky's seven
// tables, as a contact sheet, a row a table and a column a faction.
//   node tools/factions/stills.mjs <url> <out dir> [--factions=rainbow,atlantis,elderwood,hyperglow,inferno] [--skies=noon,day,morning,golden,sunset,dawn,blue] [--have]
// Each frame is tools/shots.mjs's painted view (Alamo Square's Painted Ladies, seven breaths down Steiner Street; --det, so a frame comes out the same on
// any run) with &paintas=<faction>, the sky's clock standing where the Sun is at that table's keyframe over San Francisco on 2026-11-06: noon at its
// highest (36 degrees: the noon table holds from 35), the day's 22 degrees setting, morning's 16 rising, golden 7 and sunset 1.5 setting, dawn's 1 rising,
// the blue hour's -5 (the times from NOAA's solar formulas, good to about a hundredth of a degree; each frame's page says the height it drew).
// Then skycheck's frame tests on every frame (tools/skycheck.mjs), against the palette the page holds at that moment: off the palette, a row no table
// names, brown or taupe, and the one rule's numbers (the world's peak chroma, a colour of more than 8 px off paint and the bus, against paint's median,
// the six hues' rows and the factions'), with how much of the frame's paint is the faction's own rows. --have: the frames are in <out dir> already.
// Writes <out dir>/<sky>-<faction>.png, sheet.png (tools/sky/sheet.py, each frame at one pixel a game pixel) and stills.json. Exit 1 if a frame is off
// the palette, on a row no table names, or brown.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';
import { isBrown, lch } from '../sky/oklch.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [url, out] = pos;
if (!out) throw new Error('usage: stills.mjs <url> <out dir> [--factions=] [--skies=] [--have]');
const HERE = dirname(fileURLToPath(import.meta.url));
/** a Python with Pillow, for the sheet (SB_PYTHON: the laptop's venv) */
const PYTHON = process.env.SB_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const factions = (opt.factions ?? 'rainbow,atlantis,elderwood,hyperglow,inferno').split(',');
const SKY_KEYS = { noon: [35, 'peak'], day: [22, 'set'], morning: [16, 'rise'], golden: [7, 'set'], sunset: [1.5, 'set'], dawn: [1, 'rise'], blue: [-5, 'set'] };
const skies = (opt.skies ?? Object.keys(SKY_KEYS).join(',')).split(',');
/** San Francisco's origin (public/city/sf/city.json), the place the live sky takes its Sun from */
const LAT = 37.7749, LON = -122.4194;
const DAY0 = Date.UTC(2026, 10, 6, 8, 0, 0); // local midnight, 2026-11-06 (UTC-8)
/** the rows: the six hues' and the factions' are paint (palette.ts's HUE_RAMPS, FACTION_RAMPS), the bus's its own */
const HUES = [8, 9, 10, 11, 12, 13];
const FACTION_ROWS = [24, 25, 26, 27, 28, 29, 30, 31];
const PAINT = new Set([...HUES, ...FACTION_ROWS]);
const HERO = new Set([14, 15]);
const STEPS = 8;
const MIN_PEAK = 8;

// ---- the Sun's true height over the origin (NOAA's solar calculator), and when it crosses a height
const rad = Math.PI / 180;
function sunEl(ms) {
  const T = (ms / 86400000 + 2440587.5 - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
  const om = 125.04 - 1934.136 * T;
  const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad));
  const y = Math.tan((eps * rad) / 2) ** 2;
  const eot = (4 / rad) * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
  const minutes = (((ms / 60000) % 1440) + 1440) % 1440;
  const ha = ((((minutes + eot + 4 * LON) % 1440) + 1440) % 1440) / 4 - 180;
  const cz = Math.sin(LAT * rad) * Math.sin(decl) + Math.cos(LAT * rad) * Math.cos(decl) * Math.cos(ha * rad);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cz))) / rad;
}
function momentOf(sky) {
  const [h, way] = SKY_KEYS[sky];
  // (by the minute over the local day, then by bisection on the crossing)
  let best = DAY0, top = -90;
  for (let m = 0; m < 1440; m++) {
    const el = sunEl(DAY0 + m * 60000);
    if (el > top) [top, best] = [el, DAY0 + m * 60000];
  }
  if (way === 'peak') return best;
  let lo = way === 'rise' ? DAY0 : best, hi = way === 'rise' ? best : DAY0 + 86400000;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2, above = sunEl(mid) > h;
    if ((way === 'rise') === above) hi = mid;
    else lo = mid;
  }
  return Math.round((lo + hi) / 2 / 1000) * 1000;
}

// ---- a frame's game pixels, as tools/skycheck.mjs reads them (the middle of each 3 x 3 block of a 3x frame)
function gamePixels(path) {
  const b = readFileSync(path);
  let o = 8, w = 0, h = 0, ch = 0;
  const idat = [];
  while (o < b.length) {
    const n = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8);
    if (t === 'IHDR') {
      w = b.readUInt32BE(o + 8);
      h = b.readUInt32BE(o + 12);
      ch = { 2: 3, 6: 4 }[b[o + 17]];
      if (b[o + 16] !== 8 || !ch || b[o + 20]) throw new Error(`${path}: only 8-bit, non-interlaced RGB(A)`);
    } else if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n));
    o += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const cur = new Uint8Array(stride);
  let prev = new Uint8Array(stride);
  const step = w > 500 ? 3 : 1;
  const px = new Int32Array(Math.ceil(w / step) * Math.ceil(h / step));
  let k = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, up = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = up;
      else if (f === 3) p = (a + up) >> 1;
      else if (f === 4) {
        const e = a + up - c, pa = Math.abs(e - a), pb = Math.abs(e - up), pc = Math.abs(e - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      cur[x] = (raw[s + x] + p) & 255;
    }
    if (y % step === (step === 3 ? 1 : 0)) for (let x = step === 3 ? 1 : 0; x < w; x += step, k++) px[k] = (cur[x * ch] << 16) | (cur[x * ch + 1] << 8) | cur[x * ch + 2];
    prev.set(cur);
  }
  return px.subarray(0, k);
}

/** The palette the page holds at a moment, and the Sun's height it drew it for. */
async function livePalette(query) {
  const browser = await chromium.launch(browserOptions([]));
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.goto(`${url}?${query}&skipintro&nohud`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.pipeline?.palette, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ data: Array.from(window.__game.pipeline.palette.image.data), sunEl: window.__game.sky?.sunEl ?? null }));
  await browser.close();
  return r;
}

function indexPalette(data) {
  const named = new Map(), unnamed = new Set();
  for (let r = 0; r < data.length / 4 / STEPS; r++) {
    let any = false;
    for (let s = 0; s < STEPS; s++) {
      const i = (r * STEPS + s) * 4;
      if (data[i] || data[i + 1] || data[i + 2]) any = true;
    }
    for (let s = 0; s < STEPS; s++) {
      const i = (r * STEPS + s) * 4, c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      if (!any) unnamed.add(c);
      else if (named.has(c)) named.get(c).push([r, s]);
      else named.set(c, [[r, s]]);
    }
  }
  return { named, unnamed };
}

function checkFrame(path, { named, unnamed }) {
  const px = gamePixels(path);
  const hist = new Map();
  for (let i = 0; i < px.length; i++) hist.set(px[i], (hist.get(px[i]) ?? 0) + 1);
  let off = 0, noRow = 0, brown = 0, paintPx = 0, own = 0, peak = 0, peakAt = '';
  const paint = [];
  for (const [c, n] of hist) {
    const on = named.get(c);
    if (!on) {
      if (unnamed.has(c)) noRow += n;
      else off += n;
      continue;
    }
    if (isBrown(c)) brown += n;
    const C = lch(c)[1];
    if (on.every(([r]) => PAINT.has(r))) {
      paintPx += n;
      paint.push([C, n]);
      if (on.some(([r]) => FACTION_ROWS.includes(r))) own += n;
    } else if (!on.some(([r]) => PAINT.has(r) || HERO.has(r)) && n > MIN_PEAK && C > peak) {
      peak = C;
      peakAt = `row ${on[0][0]} step ${on[0][1]}`;
    }
  }
  paint.sort((a, b) => a[0] - b[0]);
  let at = 0, med = 0;
  for (const [C, n] of paint) if ((at += n) * 2 >= paintPx) {
    med = C;
    break;
  }
  return { offPalette: off, unnamedRow: noRow, brown, paintPx, factionRowsPx: own, paintMedian: +med.toFixed(4), worldPeak: +peak.toFixed(4), worldPeakAt: peakAt, ratio: med ? +(peak / med).toFixed(3) : null };
}

mkdirSync(out, { recursive: true });
const report = { url, frames: {} };
let fails = 0;
for (const sky of skies) {
  const t = new Date(momentOf(sky)).toISOString().replace('.000', '');
  const q = `t=${t}&rate=0`;
  const pal = await livePalette(q);
  const index = indexPalette(pal.data);
  console.log(`${sky}: ${t}, the Sun ${sunEl(Date.parse(t)).toFixed(2)} degrees by NOAA, ${pal.sunEl?.toFixed(2)} by the page`);
  for (const f of factions) {
    const name = `${sky}-${f}`, file = join(out, `${name}.png`);
    if (!('have' in opt)) {
      const tmp = join(out, '_shot');
      const r = spawnSync(process.execPath, [join(HERE, '..', 'shots.mjs'), url, tmp, '--det', '--views=painted', `--q=${q}&paintas=${f}`], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error(`shots.mjs failed on ${name}`);
      copyFileSync(join(tmp, 'painted.png'), file);
    }
    const c = checkFrame(file, index);
    const bad = [];
    if (c.offPalette) bad.push(`${c.offPalette} px off the palette`);
    if (c.unnamedRow) bad.push(`${c.unnamedRow} px on a row the table doesn't name`);
    if (c.brown) bad.push(`${c.brown} px brown or taupe`);
    fails += bad.length;
    report.frames[name] = { t, sunEl: pal.sunEl, ...c, fails: bad };
    console.log(`  ${f}: paint ${c.paintPx} px, ${c.factionRowsPx} on the factions' rows; world ${c.worldPeak} (${c.worldPeakAt}) / paint ${c.paintMedian} = ${c.ratio}; off ${c.offPalette}, unnamed ${c.unnamedRow}, brown ${c.brown}${bad.length ? `\n    FAIL: ${bad.join('; ')}` : ''}`);
  }
}
writeFileSync(join(out, 'stills.json'), JSON.stringify(report, null, 2));
const files = skies.flatMap((s) => factions.map((f) => join(out, `${s}-${f}.png`)));
const r = spawnSync(PYTHON, ['-I', join(HERE, '..', 'sky', 'sheet.py'), join(out, 'sheet.png'), `--cols=${factions.length}`, '--w=393', ...files], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('sheet.py failed');
console.log(`${join(out, 'sheet.png')}: ${skies.length} rows (${skies.join(', ')}) by ${factions.length} (${factions.join(', ')})`);
console.log(fails ? `${fails} hard fails` : 'no frame off the palette, on an unnamed row, or brown');
process.exit(fails ? 1 : 0);
