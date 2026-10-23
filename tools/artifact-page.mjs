#!/usr/bin/env node
// Turns dist/index.html into an artifact page body (the artifact host wraps the
// file in its own doctype/head/body skeleton), and prints the files map.
//   node tools/artifact-page.mjs  -> dist/artifact.html + dist/artifact-files.json
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Struggle Bus</title>';
const styles = [...html.matchAll(/<style>[\s\S]*?<\/style>/g)].map((m) => m[0]).join('\n');
const scripts = [...html.matchAll(/<script[^>]*type="module"[^>]*><\/script>/g)].map((m) => m[0]).join('\n');
const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*>/g)].map((m) => m[0]).join('\n');
const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1].replace(/<script[\s\S]*?<\/script>/g, '') ?? '<canvas id="game"></canvas>';
const page = `${title}\n${styles}\n${preloads}\n${body.trim()}\n${scripts}\n`;
writeFileSync(join(dist, 'artifact.html'), page);

const files = {};
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const rel = relative(dist, p);
      if (rel === 'index.html' || rel === 'artifact.html' || rel === 'artifact-files.json') continue;
      files[rel] = rel.endsWith('.bin') ? { from: p, contentType: 'application/octet-stream' } : p;
    }
  }
}
walk(dist);
writeFileSync(join(dist, 'artifact-files.json'), JSON.stringify(files, null, 1));
console.log(Object.keys(files).length, 'files');
