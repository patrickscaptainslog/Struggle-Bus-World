#!/usr/bin/env node
// Five minutes on the plain link by real touches (CDP), on the page's own clock: does every shot the game fires come from a touch that meant it?
//   node tools/flight5.mjs <url> <outdir>      exit 1 names each shot that came from nowhere, and each check that failed
// A first visit (a fresh profile, &t=2026-11-07T00:22:00Z&rate=0): the opening through the Golden Gate untouched; then, each part an intent with its
// window on the game clock (from its first touch to 0.5 s past its last): steering in the lane (none); a still finger high up for 3 s with nothing
// else down (none); a still second finger high for 3 s while the lane thumb steers (none); drags high up, looks (none); flicks up through Express,
// Nonstop and Jet and back, a tap at each gear (a tap, or the Comet from Nonstop up); a pull past 25 degrees and one tap (a Lob); taps mashed every
// 0.3 s for 3 s once it has levelled (taps, no Lob); School Zone and taps there; a quick look down (none); M90's two cases: a Lob's lift, a flick 0.5 s
// after it, a tap at 1.2 s (a plain splat, not a Lob), the flick in the lane under the bus (a steering stroke: M90's own, c34034d and a1ecc30), then in
// the look zone (r3: its landing ran the latch on and nothing gave it back); then steering and a tap every 10 s until five minutes have passed since the
// gate.
// Checks: every entry of __game.shots() (src/main.ts: { t, kind, bodyDeg, angleDeg }, the Hose's pours as kind 'hose') inside an intent of its kind; no
// Lob with the bus's body under config.lob.from (25 degrees) as it fired but in the pull's own intent (that tap throws the body as the thumb lifted); no
// Hose pour (nothing here is a drag held to aim); and __stats.hitMs read after a tap. On a build with no shot log, the Hose's own count
// (hoseState().stats.pours) still says whether it poured, and the missing log fails; M90's cases read __game.lastShot(), so they are judged on any build,
// and each flick is checked to be a gear (turbo.gear one up), or the case isn't the case.
//   SB_F5=m90 [SB_F5_REPS=3]   past the gate, only M90's two cases, each SB_F5_REPS times: exit 1 if any isn't a gear and a plain splat (fa91865's build:
//                               the lane's case Lobs; c2a00c4's: the look zone's)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';
import { flick, flickTo } from './flick.mjs';

const [url = 'http://127.0.0.1:4173/', out = 'shots/tmp/flight5'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const MINUTES = Number(process.env.SB_FLIGHT_MIN ?? 5);
const ONLY = process.env.SB_F5 ?? '';
const REPS = Number(process.env.SB_F5_REPS ?? 1);
const LOB_FROM = 25; // config.lob.from

const browser = await chromium.launch(browserOptions([]));
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => (errors.push(e.message), console.log('[pageerror]', e.message)));
const cdp = await ctx.newCDPSession(page);
const wait = (ms) => page.waitForTimeout(ms);
const clock = () => page.evaluate(() => window.__game.clock());
const fails = [];
const ok = (c, m) => (c ? console.log(`ok: ${m}`) : (fails.push(m), console.log(`FAIL: ${m}`)));
const m90 = [];

// ---- touches: each finger by id; points are CSS px
const down = {};
const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: Object.entries(down).map(([id, [x, y]]) => ({ x, y, id: Number(id), radiusX: 4, radiusY: 4, force: 1 })) });
const press = async (id, x, y) => ((down[id] = [x, y]), send('touchStart'));
const move = async (id, x, y) => ((down[id] = [x, y]), send('touchMove'));
const lift = async (id) => (delete down[id], send('touchEnd'));
const tap = async (x = 300, y = 300) => {
  await press(7, x, y);
  await wait(70);
  await lift(7);
};
/** under the bus, in its lane (Input.busZone), where a thumb steers */
const lane = async () => {
  const z = await page.evaluate(() => window.__game.input.busZone);
  return z ? [Math.round(z.x), Math.round(Math.min(z.y + 70, 800))] : [196, 700];
};

// ---- intents
const intents = [];
async function intent(name, kinds, fn) {
  const from = await clock();
  await fn();
  intents.push({ name, kinds, from, to: (await clock()) + 0.5 });
}
const ready = () => page.evaluate(() => window.__game.forceReady());
const hose = () => page.evaluate(() => window.__game.hoseState?.().stats.pours ?? 0);
const steer = async (ms) => {
  const [x, y] = await lane();
  await press(1, x, y);
  const n = Math.max(1, Math.round(ms / 100));
  for (let i = 0; i < n; i++) {
    await wait(100);
    await move(1, x + Math.round(40 * Math.sin((i / n) * Math.PI * 2)), y);
  }
  await lift(1);
};

await page.goto(`${url}?t=2026-11-07T00:22:00Z&rate=0`, { waitUntil: 'domcontentloaded', timeout: 400000 });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 400000, polling: 100 });
const hasLog = await page.evaluate(() => typeof window.__game.shots === 'function');
await page.waitForFunction(() => !window.__game.controls.gearsLocked && !window.__game.controls.opening, null, { timeout: 120000, polling: 50 });
const t0 = Date.now();
console.log(`past the gate at game ${(await clock()).toFixed(1)} s; the shot log ${hasLog ? 'is there' : 'is not on this build'}`);
const pours0 = await hose();
if (ONLY === 'm90') {
  for (let i = 0; i < REPS; i++) for (const where of ['lane', 'look']) await m90Case(where);
  await browser.close();
  writeFileSync(`${out}/flight5-m90.json`, JSON.stringify({ m90, fails }, null, 1));
  console.log(fails.length ? `FLIGHT5 M90 FAILED ${fails.length}:\n  ${fails.join('\n  ')}` : 'flight5 m90: all passed');
  process.exit(fails.length ? 1 : 0);
}

await intent('steering in the lane', [], () => steer(6000));
let p = await hose();
await intent('a still finger high up, 3 s, nothing else down', [], async () => {
  await press(2, 196, 200);
  await wait(3000);
  await lift(2);
});
ok((await hose()) === p, `a still finger high up for 3 s pours nothing (${(await hose()) - p} pours)`);
p = await hose();
await intent('a still second finger high, 3 s, the lane thumb steering', [], async () => {
  const [x, y] = await lane();
  await press(1, x, y);
  await wait(150);
  await press(2, 300, 200);
  for (let i = 0; i < 30; i++) {
    await wait(100);
    await move(1, x + Math.round(30 * Math.sin(i / 5)), y);
  }
  await lift(2);
  await lift(1);
});
ok((await hose()) === p, `a still second finger high while the lane thumb steers pours nothing (${(await hose()) - p} pours)`);
await intent('drags high up (looks)', [], async () => {
  for (const dx of [-90, 90]) {
    await press(3, 196, 260);
    for (let i = 1; i <= 8; i++) {
      await wait(40);
      await move(3, 196 + (dx * i) / 8, 260);
    }
    await wait(300);
    await lift(3);
    await wait(400);
  }
});
// the gears up and back, a tap at each (a tap, the Comet from Nonstop up)
for (const g of [1, 2, 3, 2, 1, 0]) {
  await flickTo(page, cdp, g);
  await ready();
  await wait(300);
  await intent(`a tap at gear ${g}`, ['tap', 'comet'], () => tap());
  await wait(1200);
  if (g === 1 && !intents.some((it) => it.name === 'a tap at gear 2')) {
    await wait(800);
    const hit = await page.evaluate(() => window.__stats?.hitMs);
    ok(typeof hit === 'number', `__stats.hitMs read after a tap (${hit})`);
  }
}
// a pull past 25 degrees, the steering thumb lifted, a tap 0.1 s later: a Lob
async function pull() {
  await press(1, 196, 690);
  for (let i = 1; i <= 6; i++) {
    await wait(25);
    await move(1, 196, 690 + i * 10);
  }
  let body = 0;
  for (let i = 0; i < 40 && body < LOB_FROM + 5; i++) {
    await wait(50);
    body = await page.evaluate(() => (window.__game.flight.pitch * 180) / Math.PI);
  }
  await lift(1);
  return body;
}
// M90's case by real touches: a Lob's lift, a flick 0.5 s after it, a tap at 1.2 s: a plain splat, not a Lob. lane: the flick lands in the lane under
// the bus (lane(), so it follows the bus), a steering stroke; look: at (40, 560), in the look zone, a press with nobody flying and a flick's lift.
// tools/flick.mjs's own point, (70, 560), is on the lane's edge to a third of a pixel (r3's diagnosis): it was either, by the bus's x
async function m90Case(where) {
  await flickTo(page, cdp, 0);
  await ready();
  await wait(300);
  const last = () => page.evaluate(() => {
    const s = window.__game.lastShot();
    return s ? { t: s.t, kind: s.comet?.kind === 'lob' ? 'lob' : s.comet ? 'comet' : 'tap' } : null;
  });
  const before = hasLog ? await page.evaluate(() => window.__game.shots().length) : 0;
  const was = await last();
  const c = { where };
  await intent(`M90's case (${where}): the lift, a flick at 0.5 s, a tap at 1.2 s`, ['tap', 'comet'], async () => {
    const pt = where === 'lane' ? await lane() : [40, 560];
    const gear = await page.evaluate(() => window.__game.controls.turbo.gear);
    c.body = +(await pull()).toFixed(1);
    const at = Date.now();
    await wait(Math.max(0, 500 - (Date.now() - at)));
    await flick(cdp, 1, { x: pt[0], y: pt[1] });
    c.flickAt = pt;
    await wait(Math.max(0, 1200 - (Date.now() - at)));
    c.gear = (await page.evaluate(() => window.__game.controls.turbo.gear)) - gear;
    c.bodyTap = +(await page.evaluate(() => (window.__game.flight.pitch * 180) / Math.PI)).toFixed(1);
    await tap();
  });
  await wait(1500);
  const now = await last();
  c.shot = now && (!was || now.t !== was.t) ? now.kind : 'none';
  if (hasLog) c.shots = await page.evaluate((n) => window.__game.shots().slice(n), before);
  m90.push(c);
  console.log(`M90's case (${where}): ${JSON.stringify(c)}`);
  ok(c.gear === 1, `M90's case (${where}): the flick at (${c.flickAt}) was a gear (${c.gear >= 0 ? '+' : ''}${c.gear})`);
  ok(c.shot === 'tap' || c.shot === 'comet', `M90's case (${where}): a plain splat, not a Lob (${c.shot}; the body ${c.body} at the lift, ${c.bodyTap} before the tap${c.shots ? `; logged ${JSON.stringify(c.shots)}` : ''})`);
}
await ready();
await wait(300);
let lobBody = 0;
await intent('a pull past 25 degrees and one tap (a Lob)', ['lob', 'comet', 'tap'], async () => {
  lobBody = await pull();
  await wait(100);
  await tap();
});
const lobbed = hasLog ? await page.evaluate(() => window.__game.shots().filter((s) => s.kind === 'lob').length) : 0;
console.log(`the pull: the body ${lobBody.toFixed(1)} degrees at the lift; Lobs logged ${lobbed}`);
await wait(1700);
await intent('taps mashed every 0.3 s for 3 s, level', ['tap', 'comet'], async () => {
  for (let i = 0; i < 10; i++) {
    await tap();
    await wait(230);
  }
});
// School Zone, taps there, and up out of it
await flickTo(page, cdp, 0);
await flick(cdp, -1);
await page.waitForFunction(() => window.__game.controls.turbo.below > 0, null, { timeout: 20000, polling: 50 }).catch(() => console.log('School Zone did not come'));
await wait(1500);
for (let i = 0; i < 2; i++) {
  await ready();
  await wait(300);
  await intent('a tap in School Zone', ['tap', 'comet'], () => tap());
  await wait(1500);
}
await flick(cdp, 1);
await wait(1500);
await intent('a quick look down', [], async () => {
  await press(3, 196, 250);
  for (let i = 1; i <= 4; i++) {
    await wait(20);
    await move(3, 196, 250 + i * 50);
  }
  await lift(3);
});
await wait(1500);
for (let i = 0; i < REPS; i++) for (const where of ['lane', 'look']) await m90Case(where);
await flickTo(page, cdp, 0);
// steering and a tap every 10 s, to five minutes past the gate
while (Date.now() - t0 < MINUTES * 60000) {
  await intent('steering', [], () => steer(7000));
  await ready();
  await wait(300);
  await intent('a tap while flying on', ['tap', 'comet'], () => tap());
  await wait(2000);
}
const pours = (await hose()) - pours0;
const shots = hasLog ? await page.evaluate(() => window.__game.shots()) : null;
await page.screenshot({ path: `${out}/end.png` });
await browser.close();

// ---- the checks
ok(pours === 0, `no Hose pour in five minutes with no drag held to aim (${pours} pours)`);
ok(hasLog, `the shot log is there (__game.shots)`);
if (shots) {
  const stray = [];
  for (const s of shots) {
    // (windows overlap: each runs 0.5 s past its last touch, and a tap can come 0.3 s after steering ends. A shot passes in any of its kind)
    const at = intents.filter((it) => s.t >= it.from - 0.05 && s.t <= it.to);
    if (!at.some((it) => it.kinds.includes(s.kind))) stray.push(`${s.kind} at ${s.t.toFixed(2)} s (body ${s.bodyDeg}) ${at.length ? `in ${at.map((it) => `"${it.name}"`).join(', ')}, which mean ${at.map((it) => it.kinds.join('/') || 'no shot').join(', ')}` : 'in no intent'}`);
  }
  ok(stray.length === 0, `every shot inside an intent of its kind (${shots.length} shots${stray.length ? '; ' + stray.join('; ') : ''})`);
  const pulls = intents.filter((it) => it.kinds.includes('lob'));
  const low = shots.filter((s) => s.kind === 'lob' && s.bodyDeg < LOB_FROM && !pulls.some((it) => s.t >= it.from - 0.05 && s.t <= it.to));
  ok(low.length === 0, `no Lob with the bus under ${LOB_FROM} degrees but the pull's (${low.length}${low.length ? ': ' + low.map((s) => `${s.t.toFixed(2)} s, the body ${s.bodyDeg}, thrown at ${s.angleDeg}`).join('; ') : ''})`);
  ok(shots.some((s) => s.kind === 'lob'), `the pull threw a Lob (${shots.filter((s) => s.kind === 'lob').length} Lobs)`);
  const kinds = {};
  for (const s of shots) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
  console.log(`shots by kind: ${JSON.stringify(kinds)}; ${intents.length} intents over ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
ok(errors.length === 0, `no page error (${errors.length}${errors.length ? ': ' + errors[0] : ''})`);
writeFileSync(`${out}/flight5.json`, JSON.stringify({ intents, shots, pours, m90, fails }, null, 1));
console.log(fails.length ? `FLIGHT5 FAILED ${fails.length}:\n  ${fails.join('\n  ')}` : 'flight5: all passed');
process.exit(fails.length ? 1 : 0);
