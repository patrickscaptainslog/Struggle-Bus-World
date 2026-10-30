#!/usr/bin/env node
// Offline controls harness (no browser): bundles a scenario with rolldown and runs it in node against the
// REAL game modules (Tilt, Input, Turbo, Flight, City...). Results land in shots/controls/sim/<name>.json,
// a summary on stdout.
//   node tools/controls-sim/run.mjs <scenario.ts> [args...]
// Scenarios:
//   s_tilt.ts     synthetic deviceorientation from a physical phone model: roll / pitch sweeps (portrait,
//                 landscape, pointing up, past upright), yaw invariance, jitter, latency, auto-recenter,
//                 orientation change, calibration; tilt -> Flight yaw / climb at the floor and at altitude
//   s_perm.ts     the permission flow with a mocked DeviceOrientationEvent.requestPermission (granted, denied,
//                 throws, granted-but-silent = the claude.ai preview), no-sensor timeout -> touch fallback
//   s_gesture.ts  tap vs hold vs drag vs swipe through Input with synthetic pointer / key events (touch mode,
//                 tilt mode, the HUD splat button, the keyboard): the disambiguation table
//   s_turbo.ts    gear shifts on the real baked city: G0 -> G1 -> G0 (speed, altitude, camera), LOCKED, boost,
//                 the map edge, steering authority vs speed
import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const [scn, ...rest] = process.argv.slice(2);
const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const here = path('.');
const SRC = path('../../src');
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
