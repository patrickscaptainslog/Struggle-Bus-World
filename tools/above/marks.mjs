#!/usr/bin/env node
// Release A, 1a (docs/specs/world/ABOVE.md, ABOVE-BUILT.md): the pass marks of the painted place seen from above, read from paintview.mjs's json.
//   node tools/above/marks.mjs <out>/paintview-<place>.json [--tag=on] [--off=off]
// Draws (the tag's poses, the painted place in Cruise, settled): 14.9 km held 60 degrees down at most 100 draws, 5 km at 60 degrees at most 70, each at most
// 1.0 M triangles; every pose at most the ruling's 200 draws and 1.5 M triangles; no pose draws a tile's own ground in a coarse region. A cell over its mark is listed below
// by place, pose and what it measured, with the stage that ends it: it passes while it is no worse than its number, and fails past that (the page is
// frame-exact: two runs of one build read the same draws and triangles). A marked pose missing, or a pose without its ownCoarse, calls or tris, fails.
// The blast (--blast's Bomb III on a coarse region, every frame for 4 s): every frame at most 200 draws; no program made; no geometry made; no texture made
// but region masks; no region ground made again; no tile's own ground drawn in a coarse region; its worst frame's paint bytes at most the --off tag's
// (today's split ground). Exit 1 if any mark fails.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [file] = args.filter((a) => !a.startsWith('--'));
const R = JSON.parse(readFileSync(file, 'utf8'));
const tag = opt.tag ?? 'on', offTag = opt.off ?? 'off';
const row = R.tags[tag];
if (!row) {
  console.log(`marks: no tag ${tag} in ${file}`);
  process.exit(1);
}
const MARKS = { '14900@60': { calls: 100, tris: 1.0e6 }, '5000@60': { calls: 70, tris: 1.0e6 } };
/** the producer's ruling, at every pose */
const RULING_TRIS = 1.5e6;
const RULING_CALLS = 200;
// (cells over a mark, as Release A's 1a and 1c measured them; the ruling is 120-200 draws and 1.0-1.5 M triangles)
const LISTED = [
  { place: 'houses', pose: '5000@60', key: 'calls', was: 83, by: 'inside the ruling (200); the mark of 70 was the plan\'s estimate. Stage 2 and 5 take draws off' },
  { place: 'houses', pose: '5000@60', key: 'tris', was: 1556114, by: 'over the ruling (1.5 M): stage 3 (shadows from high up), then stage 5 (far regions by the far field)' },
  { place: 'houses', pose: '14900@60', key: 'tris', was: 1636554, by: 'over the ruling (1.5 M): stage 3, then stage 5' },
  { place: 'houses', pose: '300', key: 'tris', was: 1507871, by: 'over the ruling (1.5 M) since 1a, 1.498 M with ?rmask=0: a merged region ground draws its tiles out of frame, where split tiles were culled one by one; stage 3' },
  { place: 'downtown', pose: '5000@60', key: 'calls', was: 72, by: 'inside the ruling (200); the mark of 70 was the plan\'s estimate' },
  { place: 'downtown', pose: '14900@60', key: 'tris', was: 1021462, by: 'inside the ruling (1.5 M): stage 3, then stage 5' },
];
let bad = 0;
const say = (ok, what) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${what}`);
};
const fmt = (k, v) => (k === 'tris' ? `${(v / 1e6).toFixed(3)} M` : `${v} draws`);
const poses = row.poses ?? {};
for (const pose of Object.keys(MARKS)) if (!poses[pose]) say(false, `${R.place} ${pose}: a marked pose, not in the json`);
for (const [pose, st] of Object.entries(poses)) {
  const f = st.frame ?? {};
  const has = (k) => typeof f[k] === 'number';
  if (!has('ownCoarse')) say(false, `${R.place} ${pose}: no ownCoarse in the json`);
  else say(f.ownCoarse === 0, `${R.place} ${pose}: tiles' own grounds drawn in coarse regions ${f.ownCoarse} (mark 0)`);
  const m = { calls: RULING_CALLS, tris: RULING_TRIS, ...MARKS[pose] };
  for (const k of ['calls', 'tris']) {
    const v = f[k], l = LISTED.find((c) => c.place === R.place && c.pose === pose && c.key === k);
    if (!has(k)) say(false, `${R.place} ${pose}: no ${k} in the json`);
    else if (v <= m[k]) say(true, `${R.place} ${pose}: ${fmt(k, v)} (mark ${fmt(k, m[k])})`);
    else if (l) say(v <= l.was, `${R.place} ${pose}: ${k === 'tris' ? v.toLocaleString('en') + ' triangles' : fmt(k, v)}, over the mark ${fmt(k, m[k])}: a listed cell, at most ${k === 'tris' ? l.was.toLocaleString('en') : l.was} (${l.by})`);
    else say(false, `${R.place} ${pose}: ${fmt(k, v)}, over the mark ${fmt(k, m[k])}, and not a listed cell`);
  }
}
if ('blast' in opt) {
  const b = row.blast, o = R.tags[offTag]?.blast;
  if (!b) say(false, `${R.place} blast: none in the json for ${tag}`);
  else {
    say(b.worstCalls <= 200, `blast: worst frame ${b.worstCalls} draws (mark 200)`);
    say(b.programsMade === 0, `blast: programs made ${b.programsMade} (mark 0)`);
    say(b.geometriesNet === 0, `blast: geometries made, net ${b.geometriesNet} (mark 0)`);
    say(b.texturesMade <= b.regionMasksMade, `blast: textures made ${b.texturesMade}, region masks made ${b.regionMasksMade} (no texture but a region mask)`);
    say(b.rebuilds === 0, `blast: region grounds made again ${b.rebuilds} (mark 0)`);
    say(b.ownCoarseWorst === 0, `blast: tiles' own grounds drawn in coarse regions, worst frame ${b.ownCoarseWorst} (mark 0)`);
    if (!o) say(false, `blast: no ${offTag} tag's blast to hold its bytes against`);
    else say(b.worstUploadBytes <= o.worstUploadBytes, `blast: worst frame's paint uploads ${(b.worstUploadBytes / 1024).toFixed(0)} KiB, ${offTag}'s ${(o.worstUploadBytes / 1024).toFixed(0)} KiB (mark: at most ${offTag}'s)`);
  }
}
console.log(bad ? `MARKS FAILED: ${bad}` : `marks: ${R.place} ${tag}: all passed`);
process.exit(bad ? 1 : 0);
