#!/usr/bin/env node
// A far disc is what it was: node tools/sky/moon-far-same.mjs <out dir> [--base=http://localhost:4180/] [--t=2026-11-25T04:00:00Z]
// The same views from two builds, the second one with the ground landed, compared pixel by pixel. BASE is this build; --base the one to hold it to. Prints the pixels that differ, and how far from the frame's Moon they are.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const dir = args.find((a) => !a.startsWith('--'));
const NEW = process.env.BASE ?? 'http://localhost:4179/', OLD = opt('base', 'http://localhost:4180/'), t = opt('t', '2026-11-25T04:00:00Z');
mkdirSync(dir, { recursive: true });
const VIEWS = ['view=mid&f=0.5&look=moon', 'view=mid&f=0.9&look=moon', 'view=moon&km=60000', 'view=moon&km=30000', 'view=moon&km=20000', 'view=moon&km=13000', 'view=moon&km=9000', 'view=moon&km=7000', 'view=moon&km=5000'];

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const shot = async (base, q) => {
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await page.goto(`${base}?moonrun&t=${t}&${q}&fixeddt=0.0166`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__game.moon.draw.ground?.ready !== false, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const px = await page.evaluate(() => {
    const c = window.__game.pipeline.renderer.domElement, s = document.createElement('canvas');
    const r = window.__game.pipeline;
    r.render(window.__game.scene);
    s.width = c.width;
    s.height = c.height;
    const x = s.getContext('2d');
    x.drawImage(c, 0, 0);
    return { w: c.width, h: c.height, data: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
  });
  const png = await page.screenshot();
  await page.close();
  return { ...px, png };
};
try {
  console.log('view'.padEnd(28), 'px on the Moon differ of', 'share');
  for (const q of VIEWS) {
    const a = await shot(NEW, q), b = await shot(OLD, q);
    let diff = 0, lit = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const sky = b.data[i] < 40 && b.data[i + 1] < 40 && b.data[i + 2] < 90;
      if (!sky) lit++;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) diff++;
    }
    console.log(q.padEnd(28), String(diff).padStart(8), String(lit).padStart(8), `${((diff / Math.max(lit, 1)) * 100).toFixed(2)} %`);
    writeFileSync(join(dir, `${q.replace(/[=&.]/g, '_')}-new.png`), a.png);
    writeFileSync(join(dir, `${q.replace(/[=&.]/g, '_')}-old.png`), b.png);
  }
} finally {
  await browser.close();
}
