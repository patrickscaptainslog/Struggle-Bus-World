#!/usr/bin/env node
// The neighbourhoods' file read by the shipped loader (src/world/hoods.ts, bundled with rolldown as graph-check.mjs bundles
// lifeData.ts), for docs/specs/factions/C18.md: each city's hoods.bin through loadHoods (fetch stubbed with the file's
// bytes, so the gzip path runs too), the table's invariants the areas lean on, and its digest, which tools/bake/hoodcheck.py
// prints for the Python reading of the same file: the two must match. Then the parser on broken copies, each of which must
// come back null and never throw. Exits 1 on any failure.
//
//   node tools/world/hoods-check.mjs [slug ...] [--dir=DIR]    (default: every city with "hoods" in its city.json)
//     --dir  one city's folder (a copy, to try a broken file)
import { rolldown } from 'rolldown';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const cities = args.length ? args : readdirSync(`${root}/public/city`).filter((c) => existsSync(`${root}/public/city/${c}/city.json`));

const out = `${here}.out`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/hoods-entry.ts`, `export * from '${root.replace(/\\/g, '/')}/src/world/hoods.ts';`);
const bundle = await rolldown({ input: `${out}/hoods-entry.ts`, platform: 'node', logLevel: 'warn' });
await bundle.write({ dir: out, format: 'esm', entryFileNames: 'hoods.mjs' });
await bundle.close();
const { loadHoods, parseHoods, HOODS_VERSION } = await import(pathToFileURL(`${out}/hoods.mjs`).href);

let failed = 0;
function report(name, value, limit, ok) {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${value}  (${limit})`);
}
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

for (const slug of cities) {
  const dir = resolve(flags.dir && cities.length === 1 ? flags.dir : `${root}/public/city/${slug}`);
  const man = JSON.parse(readFileSync(`${dir}/city.json`, 'utf8'));
  if (!man.hoods) {
    if (args.length) report(`${slug}: city.json "hoods"`, 'none', 'there', false);
    continue;
  }
  const gz = readFileSync(`${dir}/hoods.bin`);
  console.log(`hoods-check ${slug}: ${dir}, hoods.bin ${gz.length} B`);
  const fetchWas = globalThis.fetch;
  let asked = '';
  globalThis.fetch = async (url) => ((asked = String(url)), new Response(gz));
  const t = await loadHoods(`./city/${slug}`, man.hoods, '?v=check');
  globalThis.fetch = fetchWas;
  report(`${slug}: loadHoods`, t ? `${t.names.length} neighbourhoods, ${asked}` : 'null', `version ${HOODS_VERSION}, the file read`, !!t);
  if (!t) continue;
  const keys = t.squares.flat();
  report(`${slug}: squares`, keys.length, `city.json's ${man.hoods.squares}`, keys.length === man.hoods.squares);
  report(`${slug}: squares in two`, keys.length - new Set(keys).size, '0', keys.length === new Set(keys).size);
  const of = new Map();
  t.squares.forEach((s, n) => s.forEach((k) => of.set(k, n)));
  const off = t.hearts.filter((h, n) => of.get(h) !== n).length;
  report(`${slug}: hearts off their own squares`, off, '0', off === 0);
  const tagged = [...t.tagged];
  report(`${slug}: tagged squares`, tagged.length, `city.json's ${man.hoods.tagged}`, tagged.length === man.hoods.tagged && tagged.every((k) => of.has(k)));
  report(`${slug}: godless`, t.godless.filter(Boolean).length, `city.json's ${man.hoods.godless}`, t.godless.filter(Boolean).length === man.hoods.godless);
  report(`${slug}: counts line up`, `${t.names.length} names, ${t.hearts.length} hearts, ${t.squares.length} lists, ${t.godless.length} flags`,
    `${man.hoods.count} each`, [t.names.length, t.hearts.length, t.squares.length, t.godless.length].every((n) => n === man.hoods.count));
  const canon = JSON.stringify([t.names, t.hearts, t.squares.map((s) => [...s].sort((a, b) => a - b)), tagged.sort((a, b) => a - b), t.godless]);
  console.log(`      table digest ${createHash('sha256').update(canon, 'utf8').digest('hex')} (hoodcheck.py prints the Python reading's)`);

  // broken copies: each must be null, never a throw
  const raw = new Uint8Array(gunzipSync(gz));
  const count = new DataView(raw.buffer, raw.byteOffset).getUint32(20, true);
  const bad = [
    ['cut short', raw.slice(0, raw.length >> 1)],
    ['no header', raw.slice(0, 10)],
    ['magic', (() => { const b = raw.slice(); b[3] = 0x58; return b; })()],
    ['version 2', (() => { const b = raw.slice(); b[4] = 2; return b; })()],
    ['a count past its bytes', (() => { const b = raw.slice(); new DataView(b.buffer).setUint32(20, count + 1000, true); return b; })()],
    ['a heart off its squares', (() => { const b = raw.slice(); new DataView(b.buffer).setUint32(24, 0x7fff7fff, true); return b; })()],
    ['a square past the neighbourhoods', (() => {
      const b = raw.slice(), dv = new DataView(b.buffer), w = dv.getUint16(16, true), h = dv.getUint16(18, true);
      const gridAt = (24 + 5 * count + 3) & ~3;
      for (let c = 0; c < w * h; c++) if (dv.getUint16(gridAt + 2 * c, true)) { dv.setUint16(gridAt + 2 * c, count + 5, true); break; }
      return b;
    })()],
  ];
  for (const [name, b] of bad) {
    let got, threw = '';
    try {
      got = parseHoods(ab(b));
    } catch (e) {
      threw = String(e);
    }
    report(`${slug}: broken, ${name}`, threw ? `threw ${threw}` : got === null ? 'null' : 'a table', 'null', !threw && got === null);
  }
}
console.log(failed ? `FAIL: ${failed} failed` : 'PASS');
process.exit(failed ? 1 : 0);
