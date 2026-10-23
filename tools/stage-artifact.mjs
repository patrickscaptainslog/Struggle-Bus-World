#!/usr/bin/env node
// Stage a built dist/ for publishing as a claude.ai artifact preview:
//   node tools/stage-artifact.mjs <outDir>
// - page body only (the host adds its own doctype/head/body skeleton)
// - binary city files renamed .bin -> .wasm (the host has no generic binary
//   type; .wasm is served byte-exact as application/wasm) and the manifest's
//   binExt set so the client asks for the right names
// - writes files.json: the published-path -> source map for the publish call
import { cpSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: node tools/stage-artifact.mjs <outDir>');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('dist', out, { recursive: true });

const html = readFileSync(join(out, 'index.html'), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Struggle Bus</title>';
const styles = [...html.matchAll(/<style>[\s\S]*?<\/style>/g)].map((m) => m[0]).join('\n');
const scripts = [...html.matchAll(/<script[^>]*type="module"[^>]*><\/script>/g)].map((m) => m[0]).join('\n');
const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1].replace(/<script[\s\S]*?<\/script>/g, '').trim() ?? '<canvas id="game"></canvas>';
writeFileSync(join(out, 'artifact.html'), `${title}\n${styles}\n${body}\n${scripts}\n`);
rmSync(join(out, 'index.html'));

const files = {};
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    let rel = relative(out, p);
    if (rel === 'artifact.html' || rel === 'files.json' || rel.startsWith('icon-') || rel.endsWith('.webmanifest')) continue;
    if (rel.endsWith('.bin')) {
      const to = p.slice(0, -4) + '.wasm';
      renameSync(p, to);
      rel = rel.slice(0, -4) + '.wasm';
    }
    files[rel] = rel;
  }
}
walk(out);
for (const man of Object.keys(files).filter((k) => k.endsWith('city.json'))) {
  const m = JSON.parse(readFileSync(join(out, man), 'utf8'));
  m.binExt = '.wasm';
  writeFileSync(join(out, man), JSON.stringify(m));
}
writeFileSync(join(out, 'files.json'), JSON.stringify(Object.keys(files).map((path) => ({ path }))));
console.log(Object.keys(files).length, 'files staged in', out);
