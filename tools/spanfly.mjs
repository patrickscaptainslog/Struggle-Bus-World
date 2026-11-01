#!/usr/bin/env node
// A hand-built bridge flown on a real build. Its stations come from the deck polyline in that build's city.json, so they follow the data.
//   node tools/spanfly.mjs <baseUrl> <outDir> <bay|gg>
// Frames, 393x852 at 3x, no HUD, the bus held as tools/sweep.mjs holds it: each end, each tower or anchorage and each mid-span from 20 m
// over the deck, heading along it; at the quarter points one 350 m off each side at deck height and one under the deck (those three on
// the opening's low camera). <outDir>/sheet.png holds them all, captioned.
// Then the real flight on the real posts, under window.__qa: at five stations the bus flies square at the deck at deck height, and once
// level under it. <outDir>/collision.json is the log. Exit 1 if the bus ever enters the deck's box, or the run under the deck is lifted.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { browserOptions } from './browser.mjs';

/** points: the row's structural points, in its order; solid: those with a tower or an anchorage on them */
const BRIDGES = {
  bay: { kind: 'baybridge', half: 12, thick: 10, points: ['cable end', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'], solid: [1, 2, 3, 4, 5] },
  gg: { kind: 'ggb', half: 13.5, thick: 8, points: ['south anchorage', 'south tower', 'north tower', 'north anchorage'], solid: [1, 2] },
};
const [baseArg, out, which] = process.argv.slice(2);
const B = BRIDGES[which];
if (!baseArg || !out || !B) throw new Error('usage: node tools/spanfly.mjs <baseUrl> <outDir> <bay|gg>');
const base = baseArg.endsWith('/') ? baseArg : baseArg + '/';
mkdirSync(out, { recursive: true });

const man = await (await fetch(`${base}city/sf/city.json`)).json();
const row = man.landmarks.find((l) => l.kind === B.kind);
if (!row?.deck) throw new Error(`no deck polyline for ${B.kind} in ${base}city/sf/city.json`);
const V = row.deck;
const S = [0];
for (let i = 1; i < V.length; i++) S.push(S[i - 1] + Math.hypot(V[i][0] - V[i - 1][0], V[i][1] - V[i - 1][1]));
const L = S[S.length - 1];
/** the deck at a station: x, z, top, unit along, unit across */
function at(s) {
  let i = 0;
  while (i + 2 < V.length && s > S[i + 1]) i++;
  const [ax, az, at] = V[i], [bx, bz, bt] = V[i + 1];
  const n = S[i + 1] - S[i], t = Math.min(1, Math.max(0, (s - S[i]) / n));
  const ux = (bx - ax) / n, uz = (bz - az) / n;
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, top: at + (bt - at) * t, ux, uz, nx: -uz, nz: ux };
}
/** the station nearest (x, z), and the distance across the deck from it */
function near(x, z) {
  let best = { d: Infinity, s: 0, across: 0 };
  for (let i = 0; i + 1 < V.length; i++) {
    const c = at((S[i] + S[i + 1]) / 2);
    const along = Math.min(S[i + 1] - S[i], Math.max(0, (x - V[i][0]) * c.ux + (z - V[i][1]) * c.uz));
    const px = V[i][0] + c.ux * along, pz = V[i][1] + c.uz * along;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, s: S[i] + along, across: (x - px) * c.nx + (z - pz) * c.nz };
  }
  return best;
}
const heading = (dx, dz) => Math.atan2(dx, -dz);
const pointS = row.points.map(([x, z]) => near(x, z).s);

// ---- the frames
const shots = [];
const over = (name, s, dir) => {
  const p = at(s);
  shots.push({ name, x: p.x, z: p.z, y: p.top + 20, heading: heading(p.ux * dir, p.uz * dir), low: 0 });
};
over('west end', 60, -1);
over('east end', L - 60, 1);
// (70 m short of a tower: held on it the bus stands in its bracing, and the tower is the frame's subject)
for (const i of B.solid) over(B.points[i], pointS[i] - 70, 1);
const marks = [0, ...pointS, L];
for (let i = 0; i + 1 < marks.length; i++) {
  if (marks[i + 1] - marks[i] < 150) continue;
  over(`mid ${i ? B.points[i - 1] : 'west end'}-${B.points[i] ?? 'east end'}`, (marks[i] + marks[i + 1]) / 2, 1);
}
for (const q of [0.25, 0.5, 0.75]) {
  const p = at(L * q);
  for (const side of [-1, 1]) {
    shots.push({ name: `${q * 4}/4 ${side < 0 ? 'west' : 'east'} side`, x: p.x + p.nx * side * 350, z: p.z + p.nz * side * 350, y: p.top, heading: heading(-p.nx * side, -p.nz * side), low: 1 });
  }
  shots.push({ name: `${q * 4}/4 under`, x: p.x, z: p.z, y: p.top - B.thick - 15, heading: heading(p.nx, p.nz), low: 1 });
}

// ---- one page, one browser
const browser = await chromium.launch(browserOptions([]));
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
let failed = false;
page.on('pageerror', (e) => {
  failed = true;
  console.log('[pageerror]', e.message);
});
const [lat0, lon0] = man.origin;
const lat = lat0 - shots[0].z / 110990, lon = lon0 + shots[0].x / (111320 * Math.cos((lat * Math.PI) / 180));
await page.goto(`${base}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&heading=0&skipintro&nohud`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 400000 });
const run = (cond, maxS) =>
  page.evaluate(
    ([c, m]) =>
      new Promise((res) => {
        const g = window.__game;
        const f = new Function('g', `return (${c})`);
        const t0 = g.clock();
        const tick = () => (g.clock() - t0 >= m || f(g) ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    [cond, maxS],
  );
// (held, the posts stand aside: the bus would ride up over a cable's post instead of the height asked for)
await page.evaluate(() => {
  const g = window.__game, f = g.flight, hold = (window.__hold = { on: true, x: f.x, z: f.z, y: f.y, heading: f.heading, low: 0 });
  window.__posts = g.city.posts;
  g.city.posts = new Map();
  const tick = () => {
    if (hold.on) {
      f.x = hold.x;
      f.z = hold.z;
      f.y = hold.y;
      f.vy = 0;
      f.heading = hold.heading;
      g.rig.openingLow = hold.low;
    }
    requestAnimationFrame(tick);
  };
  tick();
});
const pose = async (p) => {
  await page.evaluate((h) => Object.assign(window.__hold, h), p);
  await run('false', 2.5);
  await run('!g.city.busy', 12);
  await run('false', 0.5);
};
const files = [];
for (const [i, s] of shots.entries()) {
  await pose(s);
  const file = `${String(i).padStart(2, '0')}-${s.name.replace(/\W+/g, '-')}.png`;
  await page.screenshot({ path: `${out}/${file}` });
  files.push([file, s.name]);
  console.log(s.name, `(${s.x.toFixed(0)}, ${s.z.toFixed(0)}) y ${s.y.toFixed(0)}`);
}

// ---- the contact sheet, laid out by the browser
const W = 300, H = 650, COLS = 8;
const cells = files.map(([f, n]) => `<figure><img src="${f}"><figcaption>${n}</figcaption></figure>`).join('');
writeFileSync(`${out}/sheet.html`, `<!doctype html><style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${COLS},${W}px)}figure{margin:0}img{width:${W}px;height:${H}px;display:block}figcaption{color:#fff;font:15px/24px sans-serif;height:24px;padding-left:6px;white-space:nowrap;overflow:hidden}</style>${cells}`);
const sheet = await browser.newPage({ viewport: { width: W * COLS, height: (H + 24) * Math.ceil(files.length / COLS) } });
await sheet.goto(pathToFileURL(`${out}/sheet.html`).href, { waitUntil: 'load' });
await sheet.screenshot({ path: `${out}/sheet.png` });
await sheet.close();

// ---- the real flight
await page.evaluate(() => {
  const g = window.__game;
  g.city.posts = window.__posts;
  window.__hold.low = 0;
});
/** Fly across the deck at station s from 140 m out, at y, to 60 m past it: every frame's position. */
async function cross(s, y, side) {
  const p = at(s);
  await pose({ x: p.x - p.nx * side * 140, z: p.z - p.nz * side * 140, y, heading: heading(p.nx * side, p.nz * side) });
  return page.evaluate(
    ([y0]) =>
      new Promise((res) => {
        const g = window.__game, f = g.flight, rows = [];
        window.__hold.on = false;
        f.holdY = y0;
        f.vy = 0;
        f.speed = g.config.flight.cruiseSpeed;
        window.__qa = { sx: 0, sy: 0 };
        const x0 = f.x, z0 = f.z;
        const tick = () => {
          rows.push([f.x, f.y, f.z]);
          if (Math.hypot(f.x - x0, f.z - z0) < 200) return requestAnimationFrame(tick);
          window.__qa = null;
          f.holdY = -Infinity;
          window.__hold.on = true;
          res(rows);
        };
        tick();
      }),
    [y],
  );
}
/** The stretch of a run over or under the deck's width: [y, local top] of every frame there. */
const onDeck = (rows) => rows.map(([x, y, z]) => ({ y, ...near(x, z) })).filter((r) => r.d <= B.half).map((r) => [r.y, at(r.s).top]);
const log = [];
// five stations, each clear of a tower or anchorage's solid post
const stations = [0.05, 0.3, 0.46, 0.62, 0.8].map((q) => {
  let s = L * q;
  while (pointS.some((p, i) => B.solid.includes(i) && Math.abs(p - s) < 80)) s += 40;
  return s;
});
for (const [i, s] of stations.entries()) {
  const y0 = at(s).top - 3;
  const rows = await cross(s, y0, i % 2 ? 1 : -1);
  const deck = onDeck(rows);
  const inBox = deck.filter(([y, top]) => y <= top && y >= top - B.thick).length;
  const clear = Math.min(...deck.map(([y, top]) => y - top));
  const r = { run: `square at the deck, station ${s.toFixed(0)}`, y0: +y0.toFixed(1), frames: rows.length, framesOverDeck: deck.length, framesInBox: inBox, lowestOverTop: +clear.toFixed(1), maxY: +Math.max(...rows.map((q) => q[1])).toFixed(1), rows };
  log.push(r);
  if (inBox || !deck.length) failed = true;
  console.log(r.run, `from y ${r.y0}:`, inBox ? `IN THE BOX ${inBox} frames` : `never in the box, ${deck.length} frames over it, at least ${r.lowestOverTop} m over the top`);
}
{
  const s = (pointS[1] + pointS[2]) / 2;
  const under = at(s).top - B.thick - 1, y0 = under - 12;
  const rows = await cross(s, y0, 1);
  const deck = onDeck(rows);
  const ys = rows.map((q) => q[1]);
  const lift = Math.max(...ys) - y0;
  const r = { run: `level under the deck, station ${s.toFixed(0)}`, y0: +y0.toFixed(1), under: +under.toFixed(1), frames: rows.length, framesUnderDeck: deck.length, maxLift: +lift.toFixed(1), minDrop: +(y0 - Math.min(...ys)).toFixed(1), rows };
  log.push(r);
  if (!deck.length || lift > 3 || deck.some(([y]) => y >= under)) failed = true;
  console.log(r.run, `at y ${r.y0} (underside ${under.toFixed(1)}):`, `${deck.length} frames under it, most lift ${r.maxLift} m`);
}
writeFileSync(`${out}/collision.json`, JSON.stringify(log));
await browser.close();
console.log(failed ? 'FAILED' : 'ok', `${files.length} frames, sheet at ${out}/sheet.png`);
process.exit(failed ? 1 : 0);
