#!/usr/bin/env node
// Every palette row a Moon page draws with is a row its tables write (review five's 34: a row no table names keeps the black makePaletteTexture starts it with,
// and a pal() of it is (0,0,0)). node tools/moon/rows-check.mjs, in Node, from the repo's root.
//   read     every Ramp the Moon's own code names (src/moon/*.ts), the resolve's space sky (GLSL_SPACE in skyResolve.ts) and the stars (SkyDraw.ts)
//   written  what ?moonland and ?moon write: the day's rows, SPACE_ROWS and MOON_ROWS (moonBoot.ts's moonPalette, the flight's takeFrame)
// Exit 1 if a row read is written by none of them.
import { readdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) { return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx); } });
const { Ramp, dayRows } = await import('../../src/render/palette.ts');
const { SPACE_ROWS } = await import('../../src/sky/SkyTable.ts');

// (MOON_ROWS by its source: moonBoot.ts brings the whole Moon with it, and its rows are SPACE_ROWS and the three it names)
const boot = readFileSync('src/moon/moonBoot.ts', 'utf8'), at = boot.indexOf('export const MOON_ROWS');
const moonRows = [...boot.slice(at, boot.indexOf('};', at)).matchAll(/\[Ramp\.([A-Z_0-9]+)\]/g)].map((m) => Ramp[m[1]]);
const written = new Set([...Object.keys(dayRows), ...Object.keys(SPACE_ROWS)].map(Number).concat(moonRows));

const read = new Map();
const scan = (file, text) => {
  for (const m of text.matchAll(/Ramp\.([A-Z_0-9]+)/g)) {
    const row = Ramp[m[1]];
    if (row === undefined) continue;
    if (!read.has(row)) read.set(row, { name: m[1], where: new Set() });
    read.get(row).where.add(file);
  }
};
for (const f of readdirSync('src/moon').filter((f) => f.endsWith('.ts'))) scan(`src/moon/${f}`, readFileSync(`src/moon/${f}`, 'utf8'));
const res = readFileSync('src/render/skyResolve.ts', 'utf8'), s0 = res.indexOf('export const GLSL_SPACE = '), s1 = res.indexOf('`;', s0);
if (s0 < 0 || s1 < 0) {
  console.log('FAIL  GLSL_SPACE not found in skyResolve.ts');
  process.exit(1);
}
scan('skyResolve.ts GLSL_SPACE', res.slice(s0, s1));
const draw = readFileSync('src/sky/SkyDraw.ts', 'utf8');
scan('SkyDraw.ts', [...draw.matchAll(/\$\{Ramp\.[A-Z_0-9]+\}/g)].map((m) => m[0]).join('\n'));

const missing = [...read].filter(([row]) => !written.has(row)).map(([row, r]) => ({ row, name: r.name, where: [...r.where] }));
const ok = !missing.length && read.size > 0;
console.log(`${ok ? 'pass' : 'FAIL'}  every row a Moon page reads, a table writes: ${read.size} rows read, ${written.size} written`, JSON.stringify(missing));
process.exit(ok ? 0 : 1);
