#!/usr/bin/env node
// The loading page (index.html's #sb-load: the title and a pixel bus over the page's colour until the game's first frame).
//   node tools/loadpage.mjs --art [index.html]          the markup, read as text: exit 1 names what's wrong
//   node tools/loadpage.mjs --print                      the title's two paths as pixelFont.ts's glyph rows make them (to paste)
//   node tools/loadpage.mjs <url> <outdir> [--ref <url>] a real page: exit 1 names the leg that failed
// --art: #sb-load once, right after the canvas; its title's paths exactly those FONT_LARGE's rows give "STRUGGLE BUS" outlined in ink on all eight
// neighbours (PixelCanvas.textOutlined) with a pixel's margin; every fill a hex in palette.ts; nothing in the block or its CSS that asks for a file
// (url(, <img, @font-face, @import, src=); no CSS a Safari 15 lacks in its rules; every inline script parses, with nothing newer than Safari 15 in
// it; and the head script, run with a stub page, adds noload for moonrun, moon, moonland and resume and not for a plain link or ?earth.
// <url>: under CDP's network throttle (400 kbit/s, 300 ms), a fresh profile, the phone's viewport: #sb-load laid out and visible within 1,000 ms of
// navigation start; while it shows, a screenshot of the page (not the canvas) is the page's own colour round it, not black, and the canvas is
// visibility: hidden. Then the throttle comes off (only the first frame is left to wait for, and at 400 kbit/s the game's script alone is 20 s):
// at the end of every animation frame #sb-load is there exactly while html.drawn isn't, and the canvas hidden exactly as long; the frame that sets
// drawn drew into the canvas. No request is made by #sb-load's markup, and no image or font is asked for before the first frame but the two icons.
// A second page under CDP's prefers-reduced-motion: reduce finds the bus's animation-name none. ?moon&site=TYCHO, ?moonland and ?moonrun: never
// visible. --ref: the first frame's time (the first draw into the canvas after window.__game is up), three loads each of <url> and the ref,
// unthrottled, alternating: the median may be at most 10 % + 100 ms over the ref's (the page changes no script but one line on the first frame,
// so this is the noise's allowance: an ESTIMATE).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

// ---- the art

/** "STRUGGLE BUS" in FONT_LARGE, outlined: { w, h, ink: [[x, y]], white: [[x, y]] }, read off pixelFont.ts as text */
function title(text = 'STRUGGLE BUS') {
  const src = readFileSync(join(root, 'src/fx/pixelFont.ts'), 'utf8');
  const large = src.slice(src.indexOf('export const FONT_LARGE'), src.indexOf('export const FONT_SMALL'));
  const head = /defineFont\((\d+),\s*(\d+)/.exec(large);
  const height = Number(head[1]), spacing = Number(head[2]);
  const glyph = (ch) => {
    const key = ch === ' ' ? "' '" : /[A-Z]/.test(ch) ? ch : `'${ch}'`;
    const m = new RegExp(`\\n\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*'([.# ]+)'`).exec(large);
    if (!m) throw new Error(`pixelFont.ts: no FONT_LARGE glyph for '${ch}'`);
    const rows = m[1].trim().split(/\s+/);
    if (rows.length !== height) throw new Error(`pixelFont.ts: '${ch}' has ${rows.length} rows`);
    return rows;
  };
  const cols = [];
  let first = true;
  for (const ch of text) {
    if (!first) for (let s = 0; s < spacing; s++) cols.push(null);
    first = false;
    const rows = glyph(ch);
    for (let x = 0; x < rows[0].length; x++) cols.push(rows.map((r) => r[x] === '#'));
  }
  const w = cols.length + 2, h = height + 2;
  const on = (x, y) => x >= 1 && y >= 1 && x - 1 < cols.length && y - 1 < height && !!cols[x - 1]?.[y - 1];
  const ink = [], white = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (on(x, y)) white.push([x, y]);
      else {
        let near = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near ||= on(x + dx, y + dy);
        if (near) ink.push([x, y]);
      }
    }
  return { w, h, ink, white };
}

/** pixels as an SVG path of one-row runs: M x y h n v1 h -n z */
function runs(px) {
  const set = new Set(px.map(([x, y]) => `${x},${y}`));
  const ys = [...new Set(px.map(([, y]) => y))].sort((a, b) => a - b);
  let d = '';
  for (const y of ys) {
    const xs = px.filter((p) => p[1] === y).map((p) => p[0]).sort((a, b) => a - b);
    for (let i = 0; i < xs.length; ) {
      let n = 1;
      while (set.has(`${xs[i] + n},${y}`)) n++;
      d += `M${xs[i]} ${y}h${n}v1h-${n}z`;
      i += n;
    }
  }
  return d;
}

function art(file) {
  const html = readFileSync(file, 'utf8');
  const bad = [];
  const n = html.split('id="sb-load"').length - 1;
  if (n !== 1) bad.push(`#sb-load ${n} times, not once`);
  const at = html.indexOf('<div id="sb-load"');
  const canvas = html.indexOf('<canvas id="game"></canvas>');
  if (at < 0 || canvas < 0 || html.slice(canvas + '<canvas id="game"></canvas>'.length, at).trim() !== '') bad.push('#sb-load is not right after <canvas id="game">');
  const block = at < 0 ? '' : html.slice(at, html.indexOf('</div>', at) + 6);
  const t = title();
  const svgT = /<svg class="t" viewBox="0 0 (\d+) (\d+)"[^>]*>(.*?)<\/svg>/s.exec(block);
  if (!svgT) bad.push('no title svg (class "t")');
  else {
    if (Number(svgT[1]) !== t.w || Number(svgT[2]) !== t.h) bad.push(`title viewBox ${svgT[1]} x ${svgT[2]}, the glyphs make ${t.w} x ${t.h}`);
    const paths = [...svgT[3].matchAll(/<path fill="(#[0-9a-f]{6})" d="([^"]*)"\/>/g)].map((m) => [m[1], m[2]]);
    const want = [['#0b0e13', runs(t.ink)], ['#ffffff', runs(t.white)]];
    if (paths.length !== 2 || paths.some((p, i) => p[0] !== want[i][0] || p[1] !== want[i][1])) bad.push("the title's paths are not pixelFont.ts's glyph rows outlined (node tools/loadpage.mjs --print)");
  }
  const pal = new Set([...readFileSync(join(root, 'src/render/palette.ts'), 'utf8').matchAll(/'(#[0-9a-f]{6})'/gi)].map((m) => m[1].toLowerCase()));
  for (const m of block.matchAll(/fill="([^"]*)"/g)) if (!pal.has(m[1].toLowerCase())) bad.push(`fill ${m[1]} is not a palette.ts step`);
  const css = [...html.matchAll(/^.*#sb-load.*$|^.*sb-bob.*$|^.*canvas#game \{ visibility.*$/gm)].map((m) => m[0]).join('\n');
  for (const s of ['url(', '<img', '@font-face', '@import', 'src=']) {
    if (block.includes(s)) bad.push(`#sb-load's markup has ${s}`);
    if (css.includes(s)) bad.push(`#sb-load's CSS has ${s}`);
  }
  // (Safari 15.0 lacks these: :has 15.4, container queries 16, cascade layers 15.4, color-mix 16.2, the small and dynamic viewport units 15.4)
  for (const s of [/:has\(/, /@container/, /@layer/, /color-mix\(/, /\d(dvh|svh|lvh)\b/]) if (s.test(css)) bad.push(`#sb-load's CSS has ${s.source}, which Safari 15 lacks`);
  if (!/html:not\(\.noload\):not\(\.drawn\) canvas#game \{ visibility: hidden; \}/.test(html)) bad.push('the canvas is not hidden until drawn');
  // every inline script: parses, and nothing Safari 15 can't parse (iosfloor.mjs reads the build's chunks, not the page)
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  scripts.forEach((s, i) => {
    const sf = ts.createSourceFile(`inline${i}.js`, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (sf.parseDiagnostics.length) bad.push(`inline script ${i} doesn't parse: ${sf.parseDiagnostics[0].messageText}`);
    const walk = (k) => {
      if (k.kind === ts.SyntaxKind.ClassStaticBlockDeclaration) bad.push(`inline script ${i}: class static block (Safari 16.4)`);
      if (k.kind === ts.SyntaxKind.RegularExpressionLiteral && /\(\?<[=!]/.test(k.getText())) bad.push(`inline script ${i}: regex lookbehind (Safari 16.4)`);
      if (k.kind === ts.SyntaxKind.Identifier && k.getText() === 'structuredClone') bad.push(`inline script ${i}: structuredClone (Safari 15.4)`);
      ts.forEachChild(k, walk);
    };
    walk(sf);
  });
  // the head script, run on a stub page: which links get noload
  const headScript = scripts[0] ?? '';
  for (const [q, want] of [['?moonrun', true], ['?moon&site=TYCHO', true], ['?moonland', true], ['?earth&resume', true], ['?resume', true], ['', false], ['?earth', false], ['?lat=37.78&lon=-122.42', false]]) {
    const cls = new Set();
    const el = () => ({ content: '', setAttribute() {}, textContent: '' });
    const docEl = { dataset: {}, classList: { add: (c) => cls.add(c), contains: (c) => cls.has(c) } };
    Object.defineProperty(docEl, 'className', { get: () => [...cls].join(' '), set: (v) => { cls.clear(); for (const c of String(v).split(/\s+/)) if (c) cls.add(c); } });
    const never = { then: () => never, catch: () => never };
    const win = { location: { search: q }, URLSearchParams, document: { documentElement: docEl, querySelector: el, createElement: el, head: { appendChild() {} } }, localStorage: { getItem: () => null, setItem() {} }, fetch: () => never, Math, Number, Date, JSON, parseInt, isFinite, NaN };
    win.window = win;
    try {
      vm.runInNewContext(headScript, win, { timeout: 1000 });
    } catch (e) {
      bad.push(`the head script threw on '${q}': ${e.message}`);
    }
    if (cls.has('noload') !== want) bad.push(`'${q || 'a plain link'}' ${want ? "doesn't get" : 'gets'} noload`);
  }
  return bad;
}

if (args[0] === '--print') {
  const t = title();
  console.log(`viewBox 0 0 ${t.w} ${t.h}\n#0b0e13 ${runs(t.ink)}\n#ffffff ${runs(t.white)}`);
  process.exit(0);
}
if (args[0] === '--art') {
  const bad = art(args[1] ?? join(root, 'index.html'));
  for (const b of bad) console.log(`FAIL ${b}`);
  console.log(bad.length ? `loadpage --art: ${bad.length} failed` : 'loadpage --art: the markup, its title, its colours, its CSS, its scripts and noload all pass');
  process.exit(bad.length ? 1 : 0);
}

// ---- a real page

const { chromium } = await import('playwright-core');
const { browserOptions } = await import('./browser.mjs');
const { readPng } = await import('./png.mjs');
const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--ref');
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null;
const [url = 'http://127.0.0.1:4173/', out = 'shots/tmp/loadpage'] = pos;
mkdirSync(out, { recursive: true });
const failed = [];
const fail = (leg, why) => {
  failed.push(`${leg}: ${why}`);
  console.log(`FAIL ${leg}: ${why}`);
};
const pass = (leg, what) => console.log(`ok   ${leg}: ${what}`);
const link = (q) => url + (url.includes('?') ? '&' : '?') + q.replace(/^\?/, '');

/** watches the loader from the document's start: when it was first laid out and visible, and the end of every animation frame */
const watch = () => {
  const W = (window.__lpw = { shownAt: null, ends: [], draws: 0, drawsSeen: 0, firstDraw: null, bad: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  const shown = () => {
    const e = document.getElementById('sb-load');
    if (!e) return false;
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility === 'visible';
  };
  const poll = () => {
    if (W.shownAt === null && shown()) W.shownAt = performance.now();
    W.everShown ||= shown();
    if (performance.now() < 120000) raf(poll);
  };
  raf(poll);
  // (draws into the canvas itself, not a render target)
  const P = WebGL2RenderingContext.prototype;
  let toCanvas = true;
  const bf = P.bindFramebuffer;
  P.bindFramebuffer = function (t, fb) { if (t !== this.READ_FRAMEBUFFER) toCanvas = fb === null; return bf.call(this, t, fb); };
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
    const f = P[name];
    P[name] = function (...a) { if (toCanvas) W.draws++; return f.apply(this, a); };
  }
  window.requestAnimationFrame = (cb) => raf((t) => {
    const d0 = W.draws;
    try {
      cb(t);
    } finally {
      const c = document.getElementById('game');
      const end = { t: performance.now(), load: !!document.getElementById('sb-load'), drawn: document.documentElement.classList.contains('drawn'), hidden: !!c && getComputedStyle(c).visibility === 'hidden', drew: W.draws > d0, game: !!window.__game };
      if (end.drew && end.game && W.firstDraw === null) W.firstDraw = end.t;
      const last = W.ends[W.ends.length - 1];
      // (every change of state, and the frame that set drawn)
      if (!last || last.load !== end.load || last.drawn !== end.drawn || last.hidden !== end.hidden) W.ends.push(end);
      if (end.load === end.drawn || end.hidden === end.drawn) W.bad++;
    }
  });
};

const browser = await chromium.launch(browserOptions([]));
const phone = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true };
try {
  // 1. throttled, a fresh profile
  {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(watch);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: (400 * 1000) / 8, uploadThroughput: (400 * 1000) / 8 });
    const reqs = [];
    let firstFrameWall = Infinity;
    cdp.on('Network.requestWillBeSent', (e) => reqs.push({ url: e.request.url, type: e.type, initiator: e.initiator, at: Date.now() }));
    await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
    await page.waitForFunction(() => window.__lpw?.shownAt !== null, null, { timeout: 10000, polling: 20 }).catch(() => {});
    // (the page comes in a packet at a time at this rate: the rest of the loader's markup may be a moment behind its first lines)
    await page.waitForFunction(() => !!document.querySelector('#sb-load .b') || document.documentElement.classList.contains('drawn'), null, { timeout: 10000, polling: 20 }).catch(() => {});
    const s = await page.evaluate(() => {
      const c = document.getElementById('game'), b = document.querySelector('#sb-load .b');
      return { shownAt: window.__lpw.shownAt, drawn: document.documentElement.classList.contains('drawn'), hidden: !!c && getComputedStyle(c).visibility === 'hidden', bg: getComputedStyle(document.body).backgroundColor, anim: b ? getComputedStyle(b).animationName : null };
    });
    if (s.shownAt === null) fail('shown', '#sb-load never laid out and visible in 10 s');
    else if (s.shownAt > 1000) fail('shown', `#sb-load visible at ${Math.round(s.shownAt)} ms, past 1,000`);
    else pass('shown', `#sb-load laid out and visible at ${Math.round(s.shownAt)} ms of navigation start, under 400 kbit/s and 300 ms`);
    if (s.anim !== 'sb-bob') fail('bob', `the bus's animation is '${s.anim}', not sb-bob`);
    if (s.drawn) fail('colour', 'the first frame came before the loader could be looked at');
    else {
      if (!s.hidden) fail('hidden', 'the canvas is not visibility: hidden before the first frame');
      else pass('hidden', 'the canvas is visibility: hidden before the first frame');
      // (CDP's own capture: Playwright's waits for the page's fonts, which wait for the game's script at this rate)
      const shot = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
      writeFileSync(join(out, 'loading.png'), shot);
      const { w, h, px } = readPng(shot);
      const bg = s.bg.match(/\d+/g).map(Number);
      // the page round the loader: the top quarter and the bottom quarter of the screen, every pixel
      let off = 0, black = 0, n = 0;
      for (let y = 0; y < h; y++) {
        if (y > h * 0.25 && y < h * 0.75) continue;
        for (let x = 0; x < w; x++, n++) {
          const i = (y * w + x) * 4;
          if (Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2])) > 2) off++;
          if (px[i] + px[i + 1] + px[i + 2] < 24) black++;
        }
      }
      if (off || black) fail('colour', `round the loader ${off} of ${n} pixels are not the page's ${s.bg} (${black} black)`);
      else pass('colour', `round the loader every pixel (${n}) is the page's own ${s.bg}`);
    }
    // the loader's own lines in the page as served: no request may come from them
    const served = await (await fetch(url)).text();
    const a = served.slice(0, served.indexOf('<div id="sb-load"')).split('\n').length - 1;
    const b = served.slice(0, served.indexOf('</div>', served.indexOf('<div id="sb-load"'))).split('\n').length - 1;
    // the rest is only the first frame: the throttle comes off
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.waitForFunction(() => document.documentElement.classList.contains('drawn') || (!!window.__game && window.__game.clock() > 0.5), null, { timeout: 300000, polling: 50 });
    firstFrameWall = Date.now();
    await page.waitForFunction(() => window.__game && window.__game.clock() > 0.5, null, { timeout: 120000, polling: 50 });
    const w = await page.evaluate(() => ({ ends: window.__lpw.ends, bad: window.__lpw.bad, load: !!document.getElementById('sb-load') }));
    writeFileSync(join(out, 'frames.json'), JSON.stringify(w, null, 1));
    const set = w.ends.findIndex((e) => e.drawn);
    if (w.bad) fail('same frame', `${w.bad} animation frames ended with the loader and html.drawn out of step (frames.json)`);
    else if (set < 0) fail('same frame', 'no animation frame set html.drawn');
    else if (!w.ends[set].drew) fail('same frame', 'the frame that set html.drawn drew nothing into the canvas');
    else if (w.ends.slice(0, set).some((e) => !e.load) || w.ends.slice(set).some((e) => e.load)) fail('same frame', 'the loader was gone before the first frame, or back after it');
    else if (w.load) fail('same frame', '#sb-load still in the DOM with the game clock past 0.5 s');
    else pass('same frame', `#sb-load in the DOM until the first frame and gone at the end of it, with html.drawn set and the canvas shown in the same frame (${w.ends.length} state changes, none out of step)`);
    const fromIt = reqs.filter((r) => r.initiator?.type === 'parser' && r.initiator.url?.replace(/\/$/, '') === url.replace(/\/$/, '') && r.initiator.lineNumber >= a && r.initiator.lineNumber <= b);
    const art = reqs.filter((r) => r.at < firstFrameWall && (r.type === 'Image' || r.type === 'Font') && !/\/icon-\d+\.png(\?|$)/.test(r.url));
    if (fromIt.length) fail('requests', `#sb-load's lines asked for ${fromIt.map((r) => r.url).join(', ')}`);
    else if (art.length) fail('requests', `before the first frame: ${art.map((r) => `${r.type} ${r.url}`).join(', ')}`);
    else pass('requests', `${reqs.length} requests, none from #sb-load's lines (${a + 1}-${b + 1}), no image or font before the first frame but the icons`);
    if (errors.length) fail('errors', errors.join(' | '));
    await ctx.close();
  }
  // 2. reduced motion
  {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const anim = await page.evaluate(() => { const b = document.querySelector('#sb-load .b'); return b ? getComputedStyle(b).animationName : null; });
    if (anim !== 'none') fail('reduced motion', `the bus's animation-name is '${anim}', not none`);
    else pass('reduced motion', "under prefers-reduced-motion: reduce the bus's animation-name is none");
    await ctx.close();
  }
  // 3. the pages with their own wait
  for (const q of ['moon&site=TYCHO', 'moonland', 'moonrun']) {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    await page.addInitScript(watch);
    await page.goto(link(q), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(6000);
    const ever = await page.evaluate(() => !!window.__lpw.everShown);
    if (ever) fail(`?${q}`, '#sb-load was visible');
    else pass(`?${q}`, '#sb-load never visible in its first 6 s');
    await ctx.close();
  }
  // 4. the first frame's time against the ref
  if (ref) {
    const times = { new: [], ref: [] };
    for (let i = 0; i < 3; i++)
      for (const [k, u] of [['ref', ref], ['new', url]]) {
        const ctx = await browser.newContext(phone);
        const page = await ctx.newPage();
        await page.addInitScript(watch);
        await page.goto(u, { waitUntil: 'commit', timeout: 120000 });
        await page.waitForFunction(() => window.__lpw.firstDraw !== null, null, { timeout: 300000, polling: 50 });
        times[k].push(Math.round(await page.evaluate(() => window.__lpw.firstDraw)));
        await ctx.close();
      }
    const med = (a) => [...a].sort((x, y) => x - y)[1];
    const allow = Math.round(med(times.ref) * 1.1 + 100);
    const line = `first frame ${times.new.join(', ')} ms (median ${med(times.new)}), the ref ${times.ref.join(', ')} ms (median ${med(times.ref)}), allowed ${allow}`;
    if (med(times.new) > allow) fail('first frame', line);
    else pass('first frame', line);
  }
} finally {
  await browser.close();
}
console.log(failed.length ? `loadpage: ${failed.length} failed` : 'loadpage: every leg passed');
process.exit(failed.length ? 1 : 0);
