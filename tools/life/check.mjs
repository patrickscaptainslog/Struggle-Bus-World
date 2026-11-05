#!/usr/bin/env node
// L1's check page in Chromium (CONTRACT.md section 7): life-check.html, the page the producer opens on the iPhone for WebKit's leg, opened here, so the page itself is
// checked to say MATCHES where the engine is V8's own. node tools/life/check.mjs; BASE is the built site. Exit 1 if it doesn't match.
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4179/';
const browser = await chromium.launch(browserOptions([]));
let bad = 0;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(new URL('life-check.html', BASE).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__lifeCheck, null, { timeout: 120000 });
  const got = await page.evaluate(() => ({ ...window.__lifeCheck, verdict: document.getElementById('verdict').textContent }));
  const ok = got.ok && !errors.length;
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  the check page in Chromium says it matches V8's vectors`.padEnd(78), JSON.stringify({ ...got, errors }));
} catch (e) {
  bad++;
  console.log('FAIL ', e.message);
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
