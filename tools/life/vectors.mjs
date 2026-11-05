#!/usr/bin/env node
// L1's vectors (CONTRACT.md section 7): the scripted sky at a few places and moments, worked out here in V8, Chromium's engine, into src/life/checkVectors.json, which
// life-check.html runs again in whatever engine opens it (Safari's, on the producer's iPhone) and holds to within 1 cm. node --no-warnings tools/life/vectors.mjs
// Within 60 km of the bus: a row is 32-bit floats, and past 65,536 m their own step is over a centimetre.
import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { scriptedPlanes } = await import('../../src/life/sim/planes.ts');
const { ROW } = await import('../../src/life/kinds.ts');

const MOMENTS = ['2026-11-05T17:30:00Z', '2026-11-05T23:59:30Z', '2027-03-14T09:26:53Z', '2027-06-21T12:00:00Z'];
const PLACES = [['sf', 0, 0], ['sf', 30000, -20000], ['lagos', 0, 0], ['sydney', -15000, 8000]];
const out = new Float32Array(4096 * ROW), u32 = new Uint32Array(out.buffer);
const vectors = [];
for (const t of MOMENTS)
  for (const [place, bx, bz] of PLACES) {
    const utcMs = Date.parse(t), n = scriptedPlanes(place, utcMs, bx, bz, 60000, out, 0, 4096), rows = [];
    for (let i = 0; i < n; i++) {
      const o = i * ROW;
      rows.push([u32[o], ...[2, 3, 4, 5, 6, 7, 8].map((c) => out[o + c])]);
    }
    vectors.push({ place, utcMs, bx, bz, rows });
  }
writeFileSync(new URL('../../src/life/checkVectors.json', import.meta.url), JSON.stringify({ engine: `V8 ${process.versions.v8}`, made: new Date().toISOString().slice(0, 10), vectors }) + '\n');
console.log(`${vectors.length} vectors, ${vectors.reduce((s, v) => s + v.rows.length, 0)} planes`);
