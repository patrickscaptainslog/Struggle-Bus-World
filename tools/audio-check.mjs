#!/usr/bin/env node
// Offline audio check: opens dev/audio.html?auto=1 in headless Chromium, which
// renders the scripted 20 s session (fly, 4 splats with cascades, sign pops,
// ready/denied, foghorns) through an OfflineAudioContext build of the real
// AudioEngine graph, and reports peak, RMS per second, >0.99 samples, NaNs and
// isolated clicks.
//
// usage: node tools/audio-check.mjs [--url=http://127.0.0.1:5173/dev/audio.html]
//        [--seed=1] [--stems] [--wav=shots/tmp/audio-session.wav] [--shot=shots/tmp/audio.png]
//        [--json] [--bench] [--live] [--timeout=240000]
//        --live: realtime smoke test instead (unlock in a click, every pad, auto-fly, mute/unmute) [--stem="foghorn"] [--from=2.8 --to=4.8] (zoom the picture)
// exit 0 = pass (peak < 0.95, no NaN, nothing over 0.99), 1 = fail, 2 = page error
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const opt = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.join('=') || '1'];
  }),
);
const base = opt.url ?? 'http://127.0.0.1:5173/dev/audio.html';
const extra = ['from', 'to', 'clicks', 'stem'].filter((k) => opt[k]).map((k) => `&${k}=${opt[k]}`).join('');
const url = `${base}?auto=1&seed=${opt.seed ?? 1}${opt.stems ? '&stems=1' : ''}${extra}`;
const timeout = Number(opt.timeout ?? 240000);

const browser = await chromium.launch({
  ...browserOptions(['--enable-webgl']),
});
const page = await browser.newPage({ viewport: { width: Number(opt.w ?? 1100), height: Number(opt.h ?? 1500) }, deviceScaleFactor: 1 });
let threw = false;
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => {
  threw = true;
  console.log('[pageerror]', e.message);
});
if (opt.live) {
  // realtime smoke test: unlock inside a real click, play every pad, auto-fly, mute/unmute, hide/show
  await page.goto(base, { waitUntil: 'load', timeout });
  const st = () => page.evaluate(() => ({ ...window.__engine.debugState(), unlocked: window.__engine.unlocked, t: window.__engine.context ? window.__engine.context.currentTime : -1 }));
  console.log('before tap  ', JSON.stringify(await st()));
  await page.click('#start');
  await page.waitForTimeout(400);
  const a = await st();
  console.log('after tap   ', JSON.stringify(a));
  for (const label of ['SPLAT!', 'sign pop', 'denied', 'foghorn', 'ready', 'bloom note', 're-splat L3']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(label === 'SPLAT!' ? 1200 : 250);
  }
  await page.getByRole('button', { name: 'auto-fly 20 s' }).click();
  await page.waitForTimeout(3000);
  const b = await st();
  console.log('auto-fly 3s ', JSON.stringify(b));
  await page.getByRole('button', { name: 'mute', exact: true }).click();
  await page.waitForTimeout(900);
  console.log('muted       ', JSON.stringify(await st()));
  await page.getByRole('button', { name: 'unmute', exact: true }).click();
  await page.waitForTimeout(500);
  const c = await st();
  console.log('unmuted     ', JSON.stringify(c));
  const ok = a.unlocked && b.t > a.t + 2 && c.state === 'running' && !threw;
  console.log(ok ? 'LIVE PASS' : 'LIVE FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
}
await page.goto(url, { waitUntil: 'load', timeout });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout, polling: 250 });
const rep = await page.evaluate(() => window.__audioReport);
const stems = opt.stems ? await page.evaluate(() => window.__audioStems) : null;
const bench = opt.bench ? await page.evaluate(() => window.__bench()) : null;

if (opt.shot) {
  await page.locator('#viz').scrollIntoViewIfNeeded();
  await page.locator('#viz').screenshot({ path: opt.shot });
  console.log('saved', opt.shot);
}
if (opt.wav && rep && !rep.error) {
  const pcm = await page.evaluate(() => window.__audioPCM());
  const data = Buffer.from(pcm.b64, 'base64');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(pcm.channels, 22);
  h.writeUInt32LE(pcm.sampleRate, 24);
  h.writeUInt32LE(pcm.sampleRate * pcm.channels * 2, 28);
  h.writeUInt16LE(pcm.channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(opt.wav, Buffer.concat([h, data]));
  console.log('saved', opt.wav);
}
await browser.close();

if (!rep || rep.error) {
  console.log('render failed:', rep && rep.error);
  process.exit(2);
}
if (opt.json) console.log(JSON.stringify({ report: rep, stems, bench }, null, 1));
else {
  console.log(`audio-check  ${rep.seconds}s @ ${rep.sampleRate} Hz  (render ${rep.renderMs} ms)`);
  console.log(`  peak      ${rep.peak}  (${rep.peakDb} dBFS at ${rep.peakAt}s)`);
  console.log(`  >0.99     ${rep.over099}   >0.95 ${rep.over095}   NaN ${rep.nan}   DC ${rep.dc.join(' / ')}`);
  console.log(`  rms/s     ${rep.rmsDb.map((v) => String(v).padStart(6)).join('')}`);
  console.log(`  phone/s   ${rep.phoneRmsDb.map((v) => String(v).padStart(6)).join('')}   (300 Hz high-passed)`);
  console.log(`  voices    max ${rep.maxVoices} bell voices (pool 16)`);
  if (bench) console.log(`  cost      graph build ${bench.buildMs} ms; 20 s render: grey idle ${bench.idle20sMs} ms (${bench.idlePct}%), busy painted ${bench.busy20sMs} ms (${bench.busyPct}%) of one core here; biquad automationRate=${bench.kRate}`);
  console.log(`  clicks    ${rep.clicks.count}${rep.clicks.count ? '  worst: ' + rep.clicks.worst.slice(0, 6).map((c) => `${c.t}s x${c.ratio}`).join(', ') : ''}`);
  if (stems) {
    console.log('  stems (dBFS)            peak     rms   phone');
    for (const s of stems) console.log(`    ${s.name.padEnd(18)} ${String(s.peakDb).padStart(7)} ${String(s.rmsDb).padStart(7)} ${String(s.phoneRmsDb).padStart(7)}${s.nan ? '   NaN ' + s.nan : ''}`);
  }
  console.log(rep.pass ? 'PASS' : 'FAIL');
}
const stemsOk = !stems || stems.every((s) => s.nan === 0 && s.peakDb < 20 * Math.log10(0.95));
if (!stemsOk) console.log('STEMS FAIL (NaN or peak >= 0.95 in a stem)');
process.exit(threw ? 2 : rep.pass && stemsOk ? 0 : 1);
