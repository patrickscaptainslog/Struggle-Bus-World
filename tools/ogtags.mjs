#!/usr/bin/env node
// The link preview's tags in a build: what a crawler reads when the link is shared (Messages, Slack, X).
//   node tools/ogtags.mjs <build dir>      (exit 1 names each tag or file that's wrong)
// The built index.html has each tag below exactly once, with exactly this value; og:image and twitter:image are absolute on the live site (crawlers
// don't resolve a relative one) and name the same og-<n>.png; that file is in the build, its PNG header says 1200 x 630, it is 600 KB at most (a
// warning over 300: messaging apps drop big preview pictures, an ESTIMATE), and it's the build's only og-<n>.png (a new picture is a new number, the
// old file deleted in the same commit: crawlers keep a picture by its URL). rel="icon" names a file the build has.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pngSize } from './png.mjs';

const dir = process.argv[2] ?? '../sb-build';
const LIVE = 'https://struggle-bus-world.vercel.app/';
const TAGS = [
  ['name', 'description', 'Fly a yellow school bus over the real San Francisco and paint it. One thumb, in Safari, nothing to install.'],
  ['property', 'og:type', 'website'],
  ['property', 'og:site_name', 'Struggle Bus World'],
  ['property', 'og:title', 'Struggle Bus World'],
  ['property', 'og:description', 'Fly a yellow school bus over the real San Francisco and paint it.'],
  ['property', 'og:url', LIVE],
  ['property', 'og:image', null],
  ['property', 'og:image:width', '1200'],
  ['property', 'og:image:height', '630'],
  ['property', 'og:image:alt', 'A yellow school bus flies low over North Beach rooftops painted in bright colours, Coit Tower and downtown San Francisco behind it at golden hour'],
  ['name', 'twitter:card', 'summary_large_image'],
  ['name', 'twitter:image', null],
];

const html = readFileSync(join(dir, 'index.html'), 'utf8');
const bad = [];
const ok = [];
const metas = [...html.matchAll(/<meta\s+([^>]*?)\/?>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
const value = (attr, key) => metas.filter((m) => m[attr] === key).map((m) => m.content);
let image = null;
for (const [attr, key, want] of TAGS) {
  const got = value(attr, key);
  if (got.length !== 1) bad.push(`${key}: ${got.length} tags, not 1`);
  else if (want !== null && got[0] !== want) bad.push(`${key}: "${got[0]}", not "${want}"`);
  else if (want === null) {
    const m = /^https:\/\/struggle-bus-world\.vercel\.app\/(og-\d+\.png)$/.exec(got[0]);
    if (!m) bad.push(`${key}: "${got[0]}" is not an og-<n>.png on ${LIVE}`);
    else if (image && image !== m[1]) bad.push(`${key}: names ${m[1]}, og:image ${image}`);
    else image = m[1];
  }
}
if (!bad.length) ok.push(`all ${TAGS.length} tags, each once, as they must read`);
if (image) {
  const f = join(dir, image);
  if (!existsSync(f)) bad.push(`${image} is not in the build`);
  else {
    const kb = statSync(f).size / 1024;
    const { w, h } = pngSize(readFileSync(f));
    if (w !== 1200 || h !== 630) bad.push(`${image} is ${w} x ${h}, not 1200 x 630`);
    if (kb > 600) bad.push(`${image} is ${Math.round(kb)} KB, over 600`);
    else if (kb > 300) console.log(`warning: ${image} is ${Math.round(kb)} KB, over 300`);
    if (w === 1200 && h === 630 && kb <= 600) ok.push(`${image} in the build, 1200 x 630, ${Math.round(kb)} KB`);
  }
  const others = readdirSync(dir).filter((n) => /^og-\d+\.png$/.test(n) && n !== image);
  if (others.length) bad.push(`old pictures still in the build: ${others.join(', ')}`);
}
const icon = /<link rel="icon" href="\.?\/?([^"]+)"/.exec(html);
if (!icon) bad.push('no rel="icon"');
else if (!existsSync(join(dir, icon[1]))) bad.push(`rel="icon" names ${icon[1]}, not in the build`);
else ok.push(`rel="icon" names ${icon[1]}, in the build`);
for (const o of ok) console.log(`ok   ${o}`);
for (const b of bad) console.log(`FAIL ${b}`);
console.log(bad.length ? `ogtags: ${bad.length} failed` : 'ogtags: the tags and the picture pass');
process.exit(bad.length ? 1 : 0);
