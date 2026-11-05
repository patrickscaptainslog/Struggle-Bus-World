// index.html's first paint against the colour the game gives the page (LiveSky.page, SkyTable.ts pageRgb), by the Sun's height, setting and rising, off the
// real TableBlend. No browser: node tools/sky/run.mjs firstpaint.ts [--write] [--html=<file>]
//   --write   the boot's rows (`var P = ..., B = ...;` in index.html) written from the real tables, then the check. Run it after any change to SkyTable.ts,
//             SkyTables.ts or tools/sky/tables.py: until it's run this check fails on the new tables, so the two can't drift apart unseen.
//   --html    another index.html (the old one, say)
// The boot script runs as index.html holds it, in a sandbox:
//   1. its colour by the Sun's height and hour angle (__sbBoot.sky) against the game's, from 80 to -20 degrees in 0.01 steps, setting (3 h past noon) and rising
//      (3 h before), and in 0.05 steps across the hour angles where the two cross over (noon and midnight)
//   2. the whole script at real moments (?t=, ?lat=&lon=): San Francisco, London and Amsterdam every 20 minutes for a year from 2026-11-05, against SkyModel's
//      Sun, LiveSky's hour angle and the tables. A moment past TOL passes only where the game's Sun is within NEAR degrees of the bands' handover, which the
//      boot's small model (0.03 degrees at worst) can put a moment early or late
//   3. it's plain ES5: TypeScript prints it the same at ES5 as at ESNext. And its size
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';
import ts from 'typescript';
import { RAMP_COUNT, RAMP_STEPS } from '@src/render/palette';
import { pageRgb, settingShare, TableBlend } from '@src/sky/SkyTable';
import { series } from '@src/sky/series.gen.js';
import { EARTH, SkyModel, SkyState } from '@src/sky/SkyModel';
import { axesAt, geodeticToFix } from '@src/sky/WorldFrame';

/** The most a channel may be off (of 255). */
const TOL = 3;
/** The most a channel may be off where the boot mixes the two chains (of 255). */
const MIX = 10;
/** A row's fit: the most a knot's straight line is off the table between knots (of 255). */
const FIT = 1.5;
/** degrees from the handover a real moment may disagree by */
const NEAR = 0.05;
const DEG = Math.PI / 180;

const args = process.argv.slice(2);
const ROOT = process.env.SB_ROOT ?? '.';
const htmlArg = args.find((a) => a.startsWith('--html='));
const HTML = htmlArg ? htmlArg.slice(7) : join(ROOT, 'index.html');
const write = args.includes('--write');

const T = new TableBlend();
const data = new Uint8Array(RAMP_COUNT * RAMP_STEPS * 4);
/** The game's page colour at the Sun's height h (deg) and setting share w, or the row `f` gives (0 FOG 2, 1 SKY_LOW 3) whatever the bands. */
function game(h: number, w: number, f = -1): number {
  T.place(h, w);
  T.write(data, true);
  return pageRgb(data, f < 0 ? T.bands >= 0.5 : f === 1);
}
const bandsAt = (h: number, w: number) => (T.place(h, w), T.bands);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const chan = (a: number, b: number) => Math.max(Math.abs((a >> 16) - (b >> 16)), Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)), Math.abs((a & 255) - (b & 255)));
/** heights from 80 to -20 in steps of 1 / n degree, exactly */
const heights = (n: number) => Array.from({ length: 100 * n + 1 }, (_, k) => (80 * n - k) / n);

let fails = 0;
const fail = (s: string) => {
  fails++;
  console.log(`FAIL  ${s}`);
};

// ---- the rows, from the tables (--write)
if (write) {
  // the bands' handover on each chain: where they leave 0 and reach 1, falling (bisected: none at 80 degrees, all of them at -20)
  const edge = (w: number, level: number) => {
    let hi = 80, lo = -20;
    for (let i = 0; i < 60; i++) {
      const m = (hi + lo) / 2;
      if (level === 0 ? bandsAt(m, w) > 0 : bandsAt(m, w) >= 1) lo = m;
      else hi = m;
    }
    return +((hi + lo) / 2).toFixed(3);
  };
  const B = [edge(1, 0), edge(1, 1), edge(0, 0), edge(0, 1)];
  // (FOG 2 shows down to the lower chain's handover, SKY_LOW 3 up to the upper one's: each row only where some setting share shows it, and half a degree past)
  const half = (a: number, b: number) => (a + b) / 2;
  const fogLow = Math.min(half(B[0], B[1]), half(B[2], B[3])) - 0.5, lowTop = Math.max(half(B[0], B[1]), half(B[2], B[3])) + 0.5;
  const fit = (w: number, f: number, top: number, bottom: number): Array<number | string> => {
    const hs: number[] = [], cs: number[] = [];
    for (let k = Math.round(top * 20); k >= Math.round(bottom * 20); k--) {
      hs.push(k / 20);
      cs.push(game(k / 20, w, f));
    }
    const knots = [0, hs.length - 1];
    for (;;) {
      let worst = FIT, at = -1;
      for (let s = 0; s + 1 < knots.length; s++) {
        const a = knots[s], b = knots[s + 1];
        for (let i = a + 1; i < b; i++) {
          const u = (i - a) / (b - a);
          let e = 0;
          for (const sh of [16, 8, 0]) {
            const ca = (cs[a] >> sh) & 255, cb = (cs[b] >> sh) & 255;
            e = Math.max(e, Math.abs(ca + (cb - ca) * u - ((cs[i] >> sh) & 255)));
          }
          if (e > worst) {
            worst = e;
            at = i;
          }
        }
      }
      if (at < 0) break;
      knots.push(at);
      knots.sort((x, y) => x - y);
    }
    // (a knot with the same colour as the next at the top, or the last at the bottom, says nothing: the boot holds a row's ends)
    while (knots.length > 2 && cs[knots[0]] === cs[knots[1]]) knots.shift();
    while (knots.length > 2 && cs[knots[knots.length - 1]] === cs[knots[knots.length - 2]]) knots.pop();
    return knots.flatMap((i) => [hs[i], cs[i].toString(16).padStart(6, '0')]);
  };
  const P = [fit(1, 0, 80, fogLow), fit(0, 0, 80, fogLow), fit(1, 1, lowTop, -20), fit(0, 1, lowTop, -20)];
  const line = `var P = ${JSON.stringify(P).replace(/"/g, "'").replace(/,/g, ', ')}, B = [${B.join(', ')}];`;
  const html = readFileSync(HTML, 'utf8');
  const re = /var P = \[.*\], B = \[.*?\];/;
  if (!re.test(html)) throw new Error(`${HTML}: no line "var P = [...], B = [...];" to write`);
  writeFileSync(HTML, html.replace(re, line));
  console.log(`wrote ${HTML}: ${P.map((p) => p.length / 2).join(' + ')} knots, B ${B.join(', ')}`);
}

// ---- the boot script, in a sandbox
const html = readFileSync(HTML, 'utf8');
const src = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
if (!src) throw new Error(`${HTML}: no inline boot script`);
const painted: { c: string | null } = { c: null };
const meta = { setAttribute: (k: string, v: string) => void (k === 'content' && (painted.c = v)) };
const ctx: Record<string, unknown> = {
  URLSearchParams,
  location: { search: '' },
  localStorage: { getItem: () => null, setItem() {} },
  fetch: () => new Promise(() => {}),
  document: { head: { appendChild: (x: unknown) => x }, createElement: () => ({ textContent: '' }), querySelector: (q: string) => (q === 'meta[name=theme-color]' ? meta : null), documentElement: { className: '', dataset: {} } },
};
ctx.window = ctx;
createContext(ctx);
const boot = new Script(src);
/** The script run for a page's query: the colour it paints the page, the day's grey if none. */
const run = (search: string): string => {
  painted.c = null;
  ctx.__sbPage = ctx.__sbBoot = undefined;
  (ctx.location as { search: string }).search = search;
  boot.runInContext(ctx);
  return painted.c ?? '#808a94';
};
run('?t=2026-11-05T00:00:00Z');
const sky = (ctx.__sbBoot as { sky?: (e: number, H: number) => string } | undefined)?.sky;

// ---- 1. by the Sun's height: setting, rising, and across the crossings
if (!sky) fail(`${HTML}'s boot has no colour by the Sun's height (__sbBoot.sky)`);
else {
  const sweep = (name: string, Hs: number[], hs: number[], tol = TOL) => {
    let worst = -1, at = '', n = 0, bad = 0, edge = 0;
    for (const H of Hs)
      for (const h of hs) {
        const w = settingShare(H), b = parseInt(sky(h, H).slice(1), 16), g = game(h, w);
        let d = chan(b, g);
        n++;
        // (on the handover itself, the bands at 0.5 to a float's last bit, either row is the game's a hair either side)
        if (d > TOL && (chan(b, game(h + 1e-9, w)) <= TOL || chan(b, game(h - 1e-9, w)) <= TOL)) {
          edge++;
          d = 0;
        }
        if (d > tol) bad++;
        if (d > worst) {
          worst = d;
          at = `${h.toFixed(2)} deg, hour angle ${H} h: boot ${hex(b)}, game ${hex(g)}`;
        }
      }
    const ok = worst <= tol;
    if (!ok) fails++;
    console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${n} heights, worst ${worst} of 255 at ${at}${bad ? `; ${bad} past ${tol}` : ''}${edge ? `; ${edge} on the bands' handover to the last bit` : ''}`);
  };
  sweep('setting, 80 to -20 degrees by 0.01', [3], heights(100));
  sweep('rising, 80 to -20 degrees by 0.01', [-3], heights(100));
  const cross: number[] = [];
  for (let k = -6; k <= 6; k++) cross.push(k / 4, 12 - k / 4, -12 + k / 4);
  // (between the two chains the boot mixes them in sRGB where the game mixes them in OKLCH, so here it's held to MIX: a Sun under 16 degrees at noon is a city north
  // of about 50 degrees in winter, London and Amsterdam, whose real moments below are held to TOL; at midnight our cities' Sun is under -14, where the chains are one)
  sweep(`the crossings, the hour angle -1.5 to 1.5 and 10.5 to 13.5 h by 0.25, the heights by 0.05, within ${MIX}`, cross, heights(20), MIX);
}

// ---- 2. real moments, the whole script
{
  const CITIES: Array<[string, number, number]> = [['San Francisco', 37.7749, -122.4194], ['London', 51.5073, -0.1657], ['Amsterdam', 52.3752, 4.8822]];
  const model = new SkyModel(series), st = new SkyState();
  const t0 = Date.parse('2026-11-05T00:00:00Z'), STEP = 20 * 60000, N = (365 * 24 * 60) / 20;
  for (const [name, lat, lon] of CITIES) {
    const ob = { body: EARTH, free: false, pos: geodeticToFix(lat, lon, 0, new Float64Array(3)), axes: axesAt(lat, lon, 0, new Float64Array(9)) };
    let worst = -1, at = '', bad = 0, near = 0;
    for (let i = 0; i < N; i++) {
      const ms = t0 + i * STEP;
      const b = parseInt(run(`?t=${ms}&lat=${lat}&lon=${lon}`).slice(1), 16);
      model.frame(ms, ob, st);
      // (as LiveSky.update and LiveSky.setting read them)
      const s = st.sun, h = Math.asin(Math.max(-1, Math.min(1, s[1]))) / DEG, p = lat * DEG;
      const w = settingShare(Math.atan2(-s[0], s[1] * Math.cos(p) + s[2] * Math.sin(p)) / DEG / 15);
      const g = game(h, w), d = chan(b, g);
      if (d <= TOL) continue;
      if (chan(b, game(h + NEAR, w)) <= TOL || chan(b, game(h - NEAR, w)) <= TOL) {
        near++;
        continue;
      }
      bad++;
      if (d > worst) {
        worst = d;
        at = `${new Date(ms).toISOString().slice(0, 16)}, the Sun ${h.toFixed(2)} deg, ${w > 0.5 ? 'setting' : 'rising'}: boot ${hex(b)}, game ${hex(g)}`;
      }
    }
    if (bad) fails++;
    console.log(`${bad ? 'FAIL' : 'pass'}  ${name}, every 20 minutes for a year (${N} moments): ${bad ? `${bad} past ${TOL}, worst ${worst} at ${at}` : `all within ${TOL}`}${near ? `; ${near} within ${NEAR} degrees of the bands' handover, where the boot's Sun model can be early or late` : ''}`);
  }
}

// ---- 3. plain ES5, and its size
{
  const print = (target: ts.ScriptTarget) => ts.transpileModule(src, { compilerOptions: { target, removeComments: true }, reportDiagnostics: false }).outputText;
  const es5 = print(ts.ScriptTarget.ES5) === print(ts.ScriptTarget.ESNext);
  if (!es5) fails++;
  const bytes = Buffer.byteLength(src), code = Buffer.byteLength(print(ts.ScriptTarget.ESNext));
  console.log(`${es5 ? 'pass' : 'FAIL'}  the boot script ${es5 ? 'is' : "isn't"} plain ES5: ${bytes} bytes, ${code} without its comments`);
}

console.log(fails ? `${fails} failed` : 'the first paint is the game\'s');
process.exit(fails ? 1 : 0);
