#!/usr/bin/env node
// The planes' relay, in Node, on a recorded-shape answer (no network): node --no-warnings tools/life/relay-check.mjs
//   units     feet, knots and feet a minute into metres and seconds; alt_geom before alt_baro; "ground" is on the ground
//   names     an airline's call sign passes, a private aircraft's doesn't (LIVING.md rule 7)
//   box       the box snaps to a quarter degree and 10 nm, and a bad one is refused
//   handler   the edge function's answer, with adsb.lol's fetch stood in for: its shape and cache header, and no planes when upstream fails
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { slim, box } = await import('../../src/life/relay.ts');
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(64)} ${JSON.stringify(got)}`);
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const airliner = { hex: 'a1b2c3', flight: 'UAL837  ', lat: 37.6, lon: -122.4, alt_baro: 34000, alt_geom: 35000, gs: 480, track: 290, geom_rate: -1200, category: 'A5', seen_pos: 1.5 };
const cessna = { hex: 'abcdef', flight: 'N123AB', lat: 37.7, lon: -122.3, alt_baro: 2500, gs: 100, track: 10, baro_rate: 500, category: 'A1' };
const parked = { hex: '0a0b0c', flight: 'SWA123', lat: 37.62, lon: -122.38, alt_baro: 'ground', gs: 0, track: 0 };
{
  const a = slim(airliner), c = slim(cessna), p = slim(parked);
  row('units: metres and seconds, geometric height first, the ground', near(a.alt, 35000 * 0.3048) && near(a.gs, 480 * 0.514444) && near(a.vr, -1200 * 0.00508) && near(c.alt, 2500 * 0.3048) && c.small && !a.small && p.ground && p.alt === 0, { a, c, p });
  row('names: the airline flight named, the private one not', a.flight === 'UAL837' && c.flight === undefined, { a: a.flight, c: c.flight ?? null });
  row('no position, no plane', slim({ hex: 'x', alt_baro: 1000 }) === null, null);
}
row('box: snapped, and a bad one refused', JSON.stringify(box(37.7749, -122.4194, 37)) === JSON.stringify({ lat: 37.75, lon: -122.5, r: 40 }) && box(NaN, 0, 40) === null && box(91, 0, 40) === null, box(37.7749, -122.4194, 37));
{
  const { default: handler } = await import('../../api/planes.ts');
  const real = globalThis.fetch;
  let asked = '';
  globalThis.fetch = async (u) => {
    asked = String(u);
    return new Response(JSON.stringify({ now: 1700000000000, ac: [airliner, cessna, { hex: 'nopos' }] }), { status: 200 });
  };
  const r = await handler(new Request('https://x/api/planes?lat=37.7749&lon=-122.4194&r=60'));
  const j = await r.json();
  globalThis.fetch = async () => {
    throw new Error('down');
  };
  const down = await (await handler(new Request('https://x/api/planes?lat=37.7&lon=-122.4&r=60'))).json();
  globalThis.fetch = real;
  const bad400 = (await handler(new Request('https://x/api/planes?lat=abc'))).status;
  row('handler: upstream asked once per box, slimmed, cached 10 s; down gives no planes', asked.endsWith('/v2/point/37.75/-122.5/60') && j.ac.length === 2 && r.headers.get('cache-control').includes('s-maxage=10') && down.ac.length === 0 && bad400 === 400, { asked, planes: j.ac.length, cache: r.headers.get('cache-control'), down: down.ac.length, bad400 });
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
