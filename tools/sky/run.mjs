#!/usr/bin/env node
// The live sky's checks that need no browser, on the game's real modules: node tools/sky/run.mjs <check.ts> [args...]. Bundles tools/sky/<check.ts> with rolldown, as
// tools/feel-sim does (the game's modules as @src/...), into shots/tmp/sky-run/, and runs it. Exit 1 on a failure.
//   firstpaint.ts [--write] [--html=<file>]   index.html's first paint against the page colour the game writes (LiveSky.page), by the Sun's height, setting and rising
//   brown.ts                                  no byte of a row the street draws is brown or taupe at any height of the Sun (skycheck's own test), nor any
//                                             swatch the gate writes, whatever the tables
//   lamps.ts                                  lamps.bin waits for the city and for a Sun low enough that the lamps light soon, holding no copy of far.bin's
//                                             heights meanwhile
//   tuner.ts                                  the tuner has no sky.live row, and no saved value turns it
//   ../factions/colours.ts [--all]            the factions' walls apart in every table, under four kinds of sight (tools/factions/colours.ts)
import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [scn, ...rest] = process.argv.slice(2);
if (!scn) throw new Error('usage: node tools/sky/run.mjs <check.ts> [args...]');
const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const out = path(`../../shots/tmp/sky-run/${scn.replace(/\W/g, '_')}`);
mkdirSync(out, { recursive: true });
const bundle = await rolldown({ input: path(scn), platform: 'node', external: ['typescript'], resolve: { alias: { '@src': path('../../src') } }, logLevel: 'silent' });
await bundle.write({ dir: out, format: 'esm', entryFileNames: 'main.mjs' });
await bundle.close();
const r = spawnSync(process.execPath, [`${out}/main.mjs`, ...rest], { stdio: 'inherit', env: { ...process.env, SB_ROOT: process.env.SB_ROOT ?? path('../..') } });
process.exit(r.status ?? 1);
