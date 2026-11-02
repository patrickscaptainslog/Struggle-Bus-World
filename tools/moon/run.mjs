#!/usr/bin/env node
// Runs a scenario against the real generator under Node: node tools/moon/run.mjs <scenario.ts> [args...]. Bundles it with rolldown, as tools/feel-sim does.
import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [scn, ...rest] = process.argv.slice(2);
const here = fileURLToPath(new URL('.', import.meta.url));
const out = `${here}.out/${scn.replace(/\W/g, '_')}`;
mkdirSync(out, { recursive: true });
const bundle = await rolldown({ input: `${here}${scn}`, platform: 'node', logLevel: 'warn' });
await bundle.write({ dir: out, format: 'esm', entryFileNames: 'out.mjs' });
await bundle.close();
const r = spawnSync(process.execPath, [`${out}/out.mjs`, ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
