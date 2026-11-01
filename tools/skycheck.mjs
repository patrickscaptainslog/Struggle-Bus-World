#!/usr/bin/env node
// SKY.md section 8's hard fails, no judge, read off real frames.
//   node tools/skycheck.mjs <url> <today's url> <out dir> [--views=opening,grey,painted,fidi,ceiling,amsterdam,london] [--q=hour=blue] [--have]
// Shoots each view with tools/shots.mjs --det --seq on both builds, the sky's flag on <url> only (--have: the frames are already in <out dir>/sky and /today), reads the live
// palette off the game, then for each frame, at game pixels:
//   off palette    a colour on no named row of the live palette (the check reads what the page really holds, as SKY.md 4 says)
//   unnamed row    a colour only a row the table doesn't name holds (such a row stays black)
//   brown, taupe   art's gate (research-art.md): OKLCH hue 35-100, L < 0.60 and C > 0.03, or L < 0.72 and 0.02 < C < 0.09
//   world chroma   the peak chroma off paint and the bus (a colour with more than 8 px), over 0.75 of paint's median. A frame with under MIN_PAINT px of paint has only the bus's
//                  band, not a median: there the table's own paint median stands in, steps 2-5 of the six rows
//   paint cap      paint on steps 6-7 outside a glint. A frame can't see glow: a glint is rare, so past GLINTS of the paint's px, and past GLINT_PX, it isn't one
//   shimmer        tools/shimmer.py over the five pairs of a view's burst, the mean, worse than today's on the same pose. The sky's rows count as one colour on both builds (its --flat):
//                  a sky holds still on the screen, and one with bands would pull a band's fit off the world in front of it, which is no crawl of anybody's
// Exit 1 on any hard fail. <out dir>/skycheck.json holds the numbers.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [url, today, out] = pos;
if (!out) throw new Error('usage: skycheck.mjs <url> <today url> <out dir> [--views=] [--q=] [--have]');
const views = (opt.views ?? 'opening,grey,painted,fidi,ceiling,amsterdam,london').split(',');
const q = opt.q ?? 'hour=blue';
const HERE = dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.SB_PYTHON ?? (existsSync('C:/Users/Utku/sb-venv/Scripts/python.exe') ? 'C:/Users/Utku/sb-venv/Scripts/python.exe' : 'python3');

const PAINT = new Set([8, 9, 10, 11, 12, 13]);
const HERO = new Set([14, 15]);
/** SKY_WARM, NIGHT_SKY, TWILIGHT, SKY_LOW; today's sky is FOG and SKY_WARM. */
const SKY_ROWS = [3, 32, 37, 45];
const TODAY_SKY = [2, 3];
const STEPS = 8;
const CHROMA_RATIO = 0.75;
/** Game px of paint a frame needs for a median of its own (the bus's band is a few hundred). */
const MIN_PAINT = 1500;
/** The share of a frame's paint that may sit on steps 6-7 and still be glints, and the px that always may: the bus's own band runs up there, and it's all the paint a grey frame has. */
const GLINTS = 0.001;
const GLINT_PX = 100;
/** A colour's px before it counts as the world's peak: a stray pixel of a halo isn't a colour of the frame. */
const MIN_PEAK = 8;

function shoot(base, dir, extra) {
  const a = [join(HERE, 'shots.mjs'), base, dir, '--det', '--seq', `--views=${views.join(',')}`, ...extra];
  const r = spawnSync(process.execPath, a, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`shots.mjs failed on ${base}`);
}

/** The palette the page really holds: 8 steps a row, RGBA. */
async function livePalette(base, query) {
  const browser = await chromium.launch(browserOptions([]));
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.goto(`${base}?${query}skipintro&nohud`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.pipeline?.palette, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const data = await page.evaluate(() => Array.from(window.__game.pipeline.palette.image.data));
  await browser.close();
  return data;
}

/** An 8-bit, non-interlaced PNG's game pixels, as 0xRRGGBB: the middle of each 3 x 3 block of a 3x frame. */
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

const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** OKLCH of 0xRRGGBB: L, C, hue in degrees. */
function lch(c) {
  const r = lin(((c >> 16) & 255) / 255), g = lin(((c >> 8) & 255) / 255), b = lin((c & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
function isBrown(c) {
  const [L, C, h] = lch(c);
  return h > 35 && h < 100 && ((L < 0.6 && C > 0.03) || (L < 0.72 && C > 0.02 && C < 0.09));
}

function median(pairs) {
  // [value, count] pairs
  pairs.sort((a, b) => a[0] - b[0]);
  let n = 0;
  for (const p of pairs) n += p[1];
  let at = 0;
  for (const p of pairs) if ((at += p[1]) * 2 >= n) return p[0];
  return 0;
}

/** Every colour of the palette: 0xRRGGBB -> the (row, step)s that hold it. */
function indexPalette(data) {
  const named = new Map(), unnamed = new Set();
  const rows = data.length / 4 / STEPS;
  for (let r = 0; r < rows; r++) {
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

function checkFrame(path, { named, unnamed }, tableMedian) {
  const px = gamePixels(path);
  const hist = new Map();
  for (let i = 0; i < px.length; i++) hist.set(px[i], (hist.get(px[i]) ?? 0) + 1);
  let off = 0, noRow = 0, brown = 0, paintPx = 0, paintHigh = 0, peak = 0, peakAt = '';
  const paint = [];
  const firstOff = [];
  for (const [c, n] of hist) {
    const on = named.get(c);
    if (!on) {
      if (unnamed.has(c)) noRow += n;
      else {
        off += n;
        if (firstOff.length < 5) firstOff.push(`#${c.toString(16).padStart(6, '0')} x${n}`);
      }
      continue;
    }
    if (isBrown(c)) brown += n;
    const C = lch(c)[1];
    if (on.every(([r]) => PAINT.has(r))) {
      paintPx += n;
      paint.push([C, n]);
      if (Math.min(...on.map(([, s]) => s)) >= 6) paintHigh += n;
    } else if (!on.some(([r]) => PAINT.has(r) || HERO.has(r)) && n > MIN_PEAK && C > peak) {
      peak = C;
      peakAt = `row ${on[0][0]} step ${on[0][1]}`;
    }
  }
  const own = paintPx >= MIN_PAINT;
  const med = own ? median(paint) : tableMedian;
  return { colours: hist.size, offPalette: off, firstOff, unnamedRow: noRow, brown, paintPx, paintOnTop: paintHigh, worldPeak: +peak.toFixed(4), worldPeakAt: peakAt, paintMedian: +med.toFixed(4), medianFrom: own ? 'frame' : 'table', chromaRatio: +(peak / med).toFixed(3) };
}

/** The colours of a palette's rows, as shimmer.py's --flat takes them. */
function rowColours(data, rows) {
  const out = new Set();
  for (const r of rows)
    for (let s = 0; s < STEPS; s++) {
      const i = (r * STEPS + s) * 4;
      out.add(((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]).toString(16).padStart(6, '0'));
    }
  return `--flat=${[...out].join(',')}`;
}

function shimmer(dir, view, flat) {
  let sum = 0, n = 0;
  for (let i = 0; i < 5; i++) {
    const a = join(dir, `${view}-seq-${i}.png`), b = join(dir, `${view}-seq-${i + 1}.png`);
    if (!existsSync(a) || !existsSync(b)) continue;
    const r = spawnSync(PYTHON, ['-I', '-X', 'utf8', join(HERE, 'shimmer.py'), a, b, flat], { encoding: 'utf8' });
    const m = /residual after per-band shift ([0-9.]+)%/.exec(r.stdout ?? '');
    if (!m) throw new Error(`shimmer.py on ${a}: ${r.stderr}`);
    sum += Number(m[1]);
    n++;
  }
  return n ? sum / n : NaN;
}

const skyDir = join(out, 'sky'), todayDir = join(out, 'today');
if (!('have' in opt)) {
  shoot(url, skyDir, [`--q=${q}`]);
  shoot(today, todayDir, []);
}
const data = await livePalette(url, `${q}&`);
const pal = indexPalette(data);
const flatSky = rowColours(data, SKY_ROWS), flatToday = rowColours(await livePalette(today, ''), TODAY_SKY);
const tableChroma = [];
for (const r of PAINT) for (let s = 2; s <= 5; s++) {
  const i = (r * STEPS + s) * 4;
  tableChroma.push([lch((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])[1], 1]);
}
const tableMedian = median(tableChroma);

const report = {};
let fails = 0;
for (const v of views) {
  const f = checkFrame(join(skyDir, `${v}.png`), pal, tableMedian);
  f.shimmer = +shimmer(skyDir, v, flatSky).toFixed(2);
  f.shimmerToday = +shimmer(todayDir, v, flatToday).toFixed(2);
  const bad = [];
  if (f.offPalette) bad.push(`${f.offPalette} px off the palette (${f.firstOff.join(', ')})`);
  if (f.unnamedRow) bad.push(`${f.unnamedRow} px on a row the table doesn't name`);
  if (f.brown) bad.push(`${f.brown} px brown or taupe`);
  if (f.chromaRatio > CHROMA_RATIO) bad.push(`world chroma ${f.worldPeak} at ${f.worldPeakAt}, ${f.chromaRatio} of paint's median`);
  if (f.paintOnTop > GLINTS * f.paintPx && f.paintOnTop > GLINT_PX) bad.push(`${f.paintOnTop} of ${f.paintPx} paint px over step 5.45`);
  if (f.shimmer > f.shimmerToday) bad.push(`shimmer ${f.shimmer} %, today ${f.shimmerToday} %`);
  f.fails = bad;
  fails += bad.length;
  report[v] = f;
  console.log(`${v}: ${f.colours} colours, off ${f.offPalette}, unnamed ${f.unnamedRow}, brown ${f.brown}; world ${f.worldPeak} / paint ${f.paintMedian} (${f.medianFrom}) = ${f.chromaRatio}; paint ${f.paintPx} px, ${f.paintOnTop} on top; shimmer ${f.shimmer} % against today's ${f.shimmerToday} %${bad.length ? `\n  FAIL: ${bad.join('; ')}` : ''}`);
}
writeFileSync(join(out, 'skycheck.json'), JSON.stringify(report, null, 2));
console.log(fails ? `${fails} hard fails` : 'no hard fails');
process.exit(fails ? 1 : 0);
