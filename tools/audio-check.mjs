#!/usr/bin/env node
// Offline audio check: opens dev/audio.html?auto=1 in headless Chromium, which
// renders the scripted 20 s session (fly, 4 splats with cascades, sign pops,
// ready/denied, foghorns) through an OfflineAudioContext build of the real
// AudioEngine graph, and reports peak, RMS per second, >0.99 samples, NaNs and
// isolated clicks.
//
// usage: node tools/audio-check.mjs [--url=http://127.0.0.1:5173/dev/audio.html]
//        [--seed=1] [--stems] [--wav=shots/tmp/audio-session.wav] [--shot=shots/tmp/audio.png]
//        [--json] [--timeout=240000] [--stem="foghorn"] [--from=2.8 --to=4.8] (zoom the picture)
// exit 0 = pass (peak < 0.95, no NaN, nothing over 0.99), 1 = fail, 2 = page error
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

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
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'],
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
await page.goto(url, { waitUntil: 'load', timeout });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout, polling: 250 });
const rep = await page.evaluate(() => window.__audioReport);
const stems = opt.stems ? await page.evaluate(() => window.__audioStems) : null;

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
if (opt.json) console.log(JSON.stringify({ report: rep, stems }, null, 1));
else {
  console.log(`audio-check  ${rep.seconds}s @ ${rep.sampleRate} Hz  (render ${rep.renderMs} ms)`);
  console.log(`  peak      ${rep.peak}  (${rep.peakDb} dBFS at ${rep.peakAt}s)`);
  console.log(`  >0.99     ${rep.over099}   >0.95 ${rep.over095}   NaN ${rep.nan}   DC ${rep.dc.join(' / ')}`);
  console.log(`  rms/s     ${rep.rmsDb.map((v) => String(v).padStart(6)).join('')}`);
  console.log(`  phone/s   ${rep.phoneRmsDb.map((v) => String(v).padStart(6)).join('')}   (300 Hz high-passed)`);
  console.log(`  clicks    ${rep.clicks.count}${rep.clicks.count ? '  worst: ' + rep.clicks.worst.slice(0, 6).map((c) => `${c.t}s x${c.ratio}`).join(', ') : ''}`);
  if (stems) {
    console.log('  stems (dBFS)            peak     rms   phone');
    for (const s of stems) console.log(`    ${s.name.padEnd(18)} ${String(s.peakDb).padStart(7)} ${String(s.rmsDb).padStart(7)} ${String(s.phoneRmsDb).padStart(7)}`);
  }
  console.log(rep.pass ? 'PASS' : 'FAIL');
}
process.exit(threw ? 2 : rep.pass ? 0 : 1);
