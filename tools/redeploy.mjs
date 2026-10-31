#!/usr/bin/env node
// A returning player across a deploy: a phone that played yesterday's build opens today's on the same URLs, yesterday's
// /city/ files still in its HTTP cache. A re-bake keeps the file names and vercel.json caches them, so only a new data version
// (window.__sbDataV in index.html) reaches that phone: without one, the new game runs on the old city, old and new tiles mixed.
//   node tools/redeploy.mjs <oldBuildDir> <newBuildDir> [port=4178]
// A local server sends vercel.json's own headers (html revalidates, as Vercel serves it). One browser context plays the old
// build, the server switches to the new build on the same URLs, and the same context comes back. Every file of the city the
// game asked for must have reached the new server, and the game must hold the new build's city.json. Exit 1 if not.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { browserOptions } from './browser.mjs';

const [oldDir, newDir, port = '4178'] = process.argv.slice(2);
if (!oldDir || !newDir) throw new Error('usage: node tools/redeploy.mjs <oldBuildDir> <newBuildDir> [port]');
const rules = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).headers.map((h) => [new RegExp(`^${h.source}$`), h.headers]);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let root = oldDir;
const reached = new Set();
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  let file = normalize(join(root, decodeURIComponent(path)));
  if (path.endsWith('/')) file = join(file, 'index.html');
  reached.add(path);
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  const head = { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': 'public, max-age=0, must-revalidate' };
  for (const [re, headers] of rules) if (re.test(path)) for (const h of headers) head[h.key] = h.value;
  res.writeHead(200, head);
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(Number(port), '127.0.0.1', r));

const url = `http://127.0.0.1:${port}/?lat=37.77605&lon=-122.4345&heading=90&skipintro&nohud&controls=touch`;
const browser = await chromium.launch(browserOptions([]));
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const visit = async () => {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text().slice(0, 200)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await page.waitForFunction(() => !window.__game.city.busy, null, { timeout: 60000 });
  return { page, errors };
};

// yesterday
const first = await visit();
await first.page.close();
// the deploy
root = newDir;
reached.clear();
const { page, errors } = await visit();
const game = await page.evaluate(() => {
  const c = window.__game.city, m = c.manifest;
  return { ids: m.ids ?? null, buildingCount: m.buildingCount, regions: m.regions.length, scheme: c.paint.scheme, asked: [...c.regionsRequested] };
});
await browser.close();
server.close();

const want = JSON.parse(readFileSync(join(newDir, 'city/sf/city.json'), 'utf8'));
const old = JSON.parse(readFileSync(join(oldDir, 'city/sf/city.json'), 'utf8'));
const stale = game.asked.filter((k) => !reached.has(`/city/sf/r_${k.replace(',', '_')}.bin`));
const checks = [
  ['city.json reached the new deploy', reached.has('/city/sf/city.json')],
  ['far.bin reached the new deploy', reached.has('/city/sf/far.bin')],
  [`every region the game asked for reached it (${game.asked.length - stale.length} of ${game.asked.length})`, stale.length === 0],
  [`the game holds the new city.json (${game.buildingCount} buildings of ${want.buildingCount}, was ${old.buildingCount}; ids ${game.ids})`, game.buildingCount === want.buildingCount && game.regions === want.regions.length && game.ids === (want.ids ?? null)],
  [`no errors (${errors.length})`, errors.length === 0],
];
for (const [what, ok] of checks) console.log(ok ? 'ok  ' : 'FAIL', what);
for (const e of errors.slice(0, 6)) console.log('    ', e);
process.exit(checks.every((c) => c[1]) ? 0 : 1);
