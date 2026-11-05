#!/usr/bin/env node
// W6 (CONTRACT.md section 7): with no ?life the page is the page with no life in the build at all. node tools/life/flag-off.mjs <build> <build without life>
//   The second is the same commit built with SB_NO_LIFE=1 (vite.config.ts), so the world's own changes don't trip it. Each is served here, on its own port.
//   plain, earth  the plain page and ?earth, at a fixed step: the same requests (a file's hash in its name aside) and the same programs, by their shaders' sources;
//                 and neither build fetches anything of life's
//   chunk         life's files (lifeBoot, lifeWorker) are in the build with life, no page above asked for one, and the build without life never names them
//   shared        L2's parse: no SharedArrayBuffer or Atomics in the build
// Exit 1 if any fails.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const [withLife, noLife] = process.argv.slice(2);
if (!withLife || !noLife) {
  console.log('usage: node tools/life/flag-off.mjs <build> <build without life>');
  process.exit(2);
}
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(72)} ${JSON.stringify(got)}`);
};
const serve = (dir, port) => {
  const p = spawn(process.execPath, [join(import.meta.dirname, '../sky/serve-dist.mjs'), dir, String(port)], { stdio: 'ignore' });
  return { port, stop: () => p.kill() };
};
const servers = [serve(withLife, 4195), serve(noLife, 4196)];
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch(browserOptions(['--enable-webgl']));
// (a built file's name without its hash: main-Ck3x9a.js is main.js)
const unhash = (f) => f.replace(/-[A-Za-z0-9_-]{6,12}(\.[a-z]+)$/, '$1');
const strip = (u) => {
  const url = new URL(u);
  return unhash(url.pathname) + url.search;
};
// (life's own files, its chunk and its worker's, named for it)
const lifeOnly = readdirSync(join(withLife, 'assets')).filter((f) => /^life/.test(f)).map(unhash);
const look = async (port, q) => {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => (window.__qa = { holdFrames: 4, held: false }));
  const page = await ctx.newPage(), asked = new Set(), errors = [];
  let last = Date.now();
  page.on('request', (r) => {
    asked.add(strip(r.url()));
    last = Date.now();
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const frames = async (n) => {
    await page.evaluate((k) => (window.__qa = { ...window.__qa, holdFrames: k, held: false }), n);
    await page.waitForFunction(() => window.__qa?.held === true, null, { timeout: 600000, polling: 50 });
  };
  await page.goto(`http://localhost:${port}/?nohud&skipintro&fixeddt=0.033333&t=2026-11-05T17:30:00Z&lat=37.7955&lon=-122.3937${q}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => !!window.__game?.city && window.__qa?.held === true, null, { timeout: 600000, polling: 500 });
  for (let i = 0; i < 4; i++) await frames(15);
  // (held, the page asks for nothing more of its own once what it queued is in: then the requests are read)
  while (Date.now() - last < 6000) await new Promise((r) => setTimeout(r, 1000));
  const programs = await page.evaluate(() => {
    const r = window.__game.pipeline.renderer, gl = r.getContext();
    const hash = (s) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
      return h.toString(36);
    };
    return r.info.programs.map((p) => hash(gl.getAttachedShaders(p.program).map((s) => gl.getShaderSource(s)).join('\n'))).sort();
  });
  await ctx.close();
  return { asked: [...asked].sort(), programs, errors };
};
try {
  for (const [name, q] of [['plain', ''], ['earth', '&earth']]) {
    const a = await look(4195, q), b = await look(4196, q);
    const onlyA = a.asked.filter((u) => !b.asked.includes(u)), onlyB = b.asked.filter((u) => !a.asked.includes(u));
    const life = [...a.asked, ...b.asked].filter((u) => /api\/planes/.test(u) || lifeOnly.includes(u.split('?')[0].split('/').pop()));
    row(`${name}: the same requests, none of them life's`, !onlyA.length && !onlyB.length && !life.length, { requests: a.asked.length, onlyWithLife: onlyA.slice(0, 8), onlyWithout: onlyB.slice(0, 8), life });
    const same = a.programs.length === b.programs.length && a.programs.every((p, i) => p === b.programs[i]);
    row(`${name}: the same programs, by their shaders' sources`, same, { withLife: a.programs.length, without: b.programs.length, differ: a.programs.filter((p) => !b.programs.includes(p)).length });
    row(`${name}: no page errors`, !a.errors.length && !b.errors.length, [...a.errors, ...b.errors].slice(0, 4));
  }
  // (the bundler may still write a dead import's chunk: what matters is that nothing in the build without life names it)
  const named = readdirSync(join(noLife, 'assets')).filter((f) => /\.js$/.test(f) && !/^life/.test(f) && /lifeBoot-|lifeWorker-/.test(readFileSync(join(noLife, 'assets', f), 'utf8')));
  row("chunk: life's files are in the build, no page asked for one, and the build without life names none", lifeOnly.length >= 2 && !named.length, { lifeOnly, namedBy: named });
  // (L2's parse: the page isn't cross-origin isolated, so no shared memory, CONTRACT.md section 2)
  const shared = readdirSync(join(withLife, 'assets')).filter((f) => /\.js$/.test(f) && /\bSharedArrayBuffer\b|\bAtomics\./.test(readFileSync(join(withLife, 'assets', f), 'utf8')));
  row('shared memory: no SharedArrayBuffer or Atomics anywhere in the build', !shared.length, { files: shared });
} catch (e) {
  bad++;
  console.log('FAIL ', e.message);
} finally {
  await browser.close();
  for (const s of servers) s.stop();
}
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
