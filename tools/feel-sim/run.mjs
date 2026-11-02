#!/usr/bin/env node
// Offline feel harness: runs the REAL City / Flight / Splatter / Aimer / CameraRig code against the
// real baked city (public/city/sf), no browser, at any dt. Bundles a scenario with rolldown, runs it.
//   node tools/feel-sim/run.mjs <scenario.ts> [args...]
// Scenarios (results land in shots/feel/sim/new-<name>.json, a summary on stdout):
//   s_aim.ts [dt]      200 taps at the floor (cruise, surge, mid-turn lift-then-tap, second finger, slalom)
//                      in 8 neighborhoods: glint at the tap / at the lift vs the building that blooms
//   s_alt.ts           54 taps from 120 m, 250 m and the ceiling (straight, turning, lift-then-tap)
//   s_pick.ts          aim points inside footprints (area-weighted): is that building the one picked?
//   s_miss.ts          breaths into open water: no hit-stop, a splash at impact time, a belly refund
//   s_flight.ts        flat world: bank vs stick, release counter-roll, breath while turning, the
//                      release envelope through the chase camera, 30/60/120 fps
//   s_route.ts [dt] [filter] [--l3]  real-city flights: clipping through the RENDERED surfaces (mesh
//                      roofs, tree crowns, painted gardens), climb acceleration, hard-floor hits
//   s_breath.ts        anticipation timing at 30/60/120 fps, the jet's speed profile
//   s_nose.ts [dt]     the path on a flat world: TURBO on the pull, G1 to the ceiling, dives, releases, a deck, the map's edge
// SB_SRC=<src dir> runs it against another source tree (with SB_LOOP=<loop.ts> for its main.ts glue).
import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const [scn, ...rest] = process.argv.slice(2);
const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const here = path('.');
const SRC = process.env.SB_SRC ?? path('../../src');
const out = `${here}/.out/${scn.replace(/\W/g, '_')}`;
mkdirSync(out, { recursive: true });
const bundle = await rolldown({
  input: `${here}/${scn}`,
  platform: 'node',
  resolve: { alias: { '@src': SRC, '@loop': process.env.SB_LOOP ?? `${here}/loop.ts` } },
  logLevel: 'silent',
});
await bundle.write({ dir: out, format: 'esm', entryFileNames: 'main.mjs' });
const r = spawnSync(process.execPath, [`${out}/main.mjs`, ...rest], { stdio: 'inherit', env: { ...process.env, SB_MODE: process.env.SB_MODE ?? 'new', SB_DATA: process.env.SB_DATA ?? path('../../public/city/sf') } });
process.exit(r.status ?? 1);
