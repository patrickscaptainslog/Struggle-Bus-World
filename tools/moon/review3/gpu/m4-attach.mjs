// M4 on this laptop's GPU, in real time (the game's own clock: no fixed step, no held frames): a painted region coming back at Jet, against the same flight over ground never painted.
//   node tools/moon/review3/gpu/m4-attach.mjs <build dir> <port> [rounds, 2]
// Each round, painted: ?moon&site=TYCHO, a strip 8 km by 1 km, 5 to 13 km ahead of the bus on Tycho's floor, painted with 360 blasts straight into the ground (GroundPaint.blast, as
// __game.seedGround does: one in five from 300 m up), saved (persist), then the page again in the same context (the same start: the store is keyed by the page's start place, moon_<lat>_<lon>),
// and flown from the start through the strip at Jet with the stick let go: the strip is past the 1.5-2.8 km the boot loads, so its tiles stream in on the way.
// Baseline: the same page and flight in a new context, nothing painted. Prints, for each flight, one JSON line: frame times (median, p95, p99, max, frames over 33/50/100 ms), long tasks (count,
// longest), the wrapped calls (pictureInto, attach: count, median, max, most in one frame), the copies (pictureInto calls over 0.2 ms, which did the copy) and every frame over 50 ms with the copies in it.
import { sleep, serve, launch, open, now, window_ } from './common.mjs';

const [dist, port = '4191', roundsArg = '2'] = process.argv.slice(2);
if (!dist) throw new Error('usage: m4-attach.mjs <build dir> <port> [rounds]');
const BASE = `http://127.0.0.1:${port}/`, T = '2026-11-25T04:00:00Z', ROUNDS = Number(roundsArg);
const srv = await serve(dist, port);
const browser = await launch();
const ready = (page) => page.waitForFunction(() => window.__shotReady === true && !!window.__wrapped, null, { timeout: 300000, polling: 500 });

/** paint the strip, save it; returns the strip's ends by latitude and longitude, and what is kept */
async function paint(page) {
  const P = await page.evaluate(() => {
    const g = window.__game, f = g.flight, geo = g.city.ground.geo, ll = (x, z) => { const o = [0, 0]; geo.toLatLon(x, z, o); return o; };
    const at = (d) => [f.x + f.fx * d, f.z + f.fz * d];
    return { x: f.x, z: f.z, fx: f.fx, fz: f.fz, a: ll(...at(5000)), b: ll(...at(13000)), mid: ll(...at(9000)) };
  });
  let k = 0;
  for (let c = 0; c < 18; c++) {
    await page.evaluate(([P, k0]) => {
      const g = window.__game, S = g.config.splat, R = (d) => S.blastRadius * (1 + ((S.dropGain300 - 1) * Math.min(S.dropMax, d)) / 300);
      for (let k = k0; k < k0 + 20; k++) {
        // (45 along the 8 km, 8 across the 1 km, each a little off its grid point)
        const u = 5000 + (k % 45) * (8000 / 44) + ((k * 37) % 50) - 25, v = (Math.floor(k / 45) / 7 - 0.5) * 1000 + ((k * 53) % 40) - 20;
        const x = P.x + P.fx * u - P.fz * v, z = P.z + P.fz * u + P.fx * v, r = R(k % 5 ? 25 : 300);
        g.city.ground.blast({ x, z, r, hue: k % 6, seed: (k * 2654435761) >>> 0, layout: S.hueLayout, sectors: Math.max(1, Math.round(S.hueSectors)), ring: S.hueRing, twist: S.hueTwist, edge: S.groundRadius, ragged: S.groundRagged, rays: Math.round(S.groundRays), rayLen: S.rayLength, reach: S.spatterReach, dots: Math.round(S.spatterDots), blobs: Math.round(S.blobs) }, -100);
      }
    }, [P, k]);
    k += 20;
    await sleep(100);
  }
  await page.evaluate(() => window.__game.city.ground.persist());
  await sleep(2000);
  const kept = await page.evaluate(() => ({ pictures: window.__game.city.ground.geoCount, saved: Object.keys(localStorage).filter((k) => k.includes('gpic:')).length, chars: Object.entries(localStorage).reduce((s, [k, v]) => s + k.length + v.length, 0) }));
  return { ...P, blasts: k, kept };
}

/** from the start: turned to the strip's far end, Jet, stick let go, until 3 km past its far end */
async function flyIn(page, P) {
  const turn = await page.evaluate((P) => {
    const g = window.__game, f = g.flight, geo = g.city.ground.geo, a = [0, 0], b = [0, 0];
    geo.toXZ(P.a[0], P.a[1], a);
    geo.toXZ(P.b[0], P.b[1], b);
    f.heading = Math.atan2(b[0] - f.x, -(b[1] - f.z));
    window.__qa = { sx: 0, sy: 0 };
    for (let i = 0; i < 3; i++) g.controls.turbo.shift(1, g.flight);
    return { a, b, from: [f.x, f.z], heading: +((f.heading * 180) / Math.PI).toFixed(1), gear: g.controls.turbo.gear };
  }, P);
  const t0 = await now(page);
  const track = [];
  for (let i = 0; i < 200; i++) {
    await sleep(1000);
    const s = await page.evaluate((B) => {
      const f = window.__game.flight;
      return { t: performance.now(), v: Math.round(f.speed), h: Math.round(f.height), toFar: Math.round((B[0] - f.x) * f.fx + (B[1] - f.z) * f.fz), off: Math.round((B[0] - f.x) * -f.fz + (B[1] - f.z) * f.fx), copies: window.__calls.pictureInto.filter(([, d]) => d > 0.2).length };
    }, turn.b);
    if (i % 10 === 0) track.push({ s: Math.round((s.t - t0) / 1000), ...s, t: undefined });
    if (s.toFar < -3000) break;
  }
  const t1 = await now(page);
  return { turn, track, secs: Math.round((t1 - t0) / 1000), w: await window_(page, t0, t1), before: await window_(page, 0, t0) };
}

const out = (name, o) => console.log(JSON.stringify({ name, ...o }));
for (let round = 1; round <= ROUNDS; round++) {
  // ---- painted
  let P;
  {
    const { ctx, page, errors } = await open(browser, BASE, `?moon&site=TYCHO&skipintro&fps&t=${T}`);
    await ready(page);
    await sleep(3000);
    P = await paint(page);
    out(`round ${round} paint`, { blasts: P.blasts, kept: P.kept, strip: { a: P.a, b: P.b }, wrapMiss: await page.evaluate(() => window.__wrapMiss), errors });
    await page.close();
    const o = await open(browser, BASE, `?moon&site=TYCHO&skipintro&fps&t=${T}`, ctx);
    await ready(o.page);
    await sleep(1000);
    const r = await flyIn(o.page, P);
    out(`round ${round} painted flight`, { ...r, kept: await o.page.evaluate(() => window.__game.city.ground.geoCount), lt: await o.page.evaluate(() => window.__ltError ?? 'ok'), errors: o.errors });
    await ctx.close();
  }
  await sleep(3000);
  // ---- baseline: the same flight, nothing painted
  {
    const { ctx, page, errors } = await open(browser, BASE, `?moon&site=TYCHO&skipintro&fps&t=${T}`);
    await ready(page);
    await sleep(1000);
    const r = await flyIn(page, P);
    out(`round ${round} baseline flight`, { ...r, kept: await page.evaluate(() => window.__game.city.ground.geoCount), errors });
    await ctx.close();
  }
  await sleep(3000);
}
await browser.close();
srv.kill();
console.log('DONE');
