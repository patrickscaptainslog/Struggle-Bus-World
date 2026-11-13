#!/usr/bin/env node
// Offline controls harness (no browser): bundles a scenario with rolldown and runs it in node against the
// REAL game modules (Input, Shifter, Turbo, Flight, City...). Results land in shots/controls/sim/<name>.json
// (SB_OUT moves them), a summary on stdout.
//   node tools/controls-sim/run.mjs <scenario.ts> [args...]
// Scenarios:
//   s_gesture.ts  the gesture table (docs/specs/flight/THUMBS.md) through the real Input, Shifter and TurboDrive with
//                 synthetic pointer / key events: the first thumb alone, the second thumb, flicks, the ladder, rung by
//                 rung, up and down, the gate, the lone strokes, one thumb on either side, what a flick down leaves behind, the bands, the left zone, two thumbs in any order, MEGA and its adopted thumb, three
//                 fingers, a lost pointer, the keyboard and the mouse
//   s_layout.ts   layoutHud against its tables, and its rules in every layout
//   s_turbo.ts    the ladder on the real baked city: every rung up and back down (speed, altitude, camera), LOCKED, the
//                 map's edge at every rung, steering authority vs speed; turbo's levels, up and down the nose; a gear
//                 taken back; Express against a held surge; the hop through the rungs; turbo over Rainbow Warp
import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const [scn, ...rest] = process.argv.slice(2);
const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const here = path('.');
// (SB_SRC=<src dir>: another source tree, as tools/feel-sim/run.mjs)
const SRC = process.env.SB_SRC ?? path('../../src');
const out = `${here}/.out/${scn.replace(/\W/g, '_')}`;
mkdirSync(out, { recursive: true });
const bundle = await rolldown({
  input: `${here}/${scn}`,
  platform: 'node',
  resolve: { alias: { '@src': SRC, '@loop': path('../feel-sim/loop.ts') } },
  logLevel: 'silent',
});
await bundle.write({ dir: out, format: 'esm', entryFileNames: 'main.mjs' });
const r = spawnSync(process.execPath, [`${out}/main.mjs`, ...rest], { stdio: 'inherit', env: { ...process.env, SB_DATA: process.env.SB_DATA ?? path('../../public/city/sf') } });
process.exit(r.status ?? 1);
