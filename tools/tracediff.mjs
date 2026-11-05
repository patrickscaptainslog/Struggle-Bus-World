#!/usr/bin/env node
// The first frame two tools/shots.mjs --trace runs part at.
//   node tools/tracediff.mjs <a>-trace.json <b>-trace.json [--cols=x,y,z] [--context=3]
// Frames are lined up by the clock: each frame that moved it is a step, and the frames before it that didn't (the clock
// standing, a hit-stop) go with it. Steps are compared on the state they leave (what a standing frame shows depends on
// when the harness's evaluate landed, so those aren't); the first one that differs is printed with the standing frames
// before it and the arrivals in between, from both runs, and what differed in the standing frames' own state. Exit 1 if they part.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const load = (f) => JSON.parse(readFileSync(f, 'utf8'));
const A = load(pos[0]), B = load(pos[1]);
const I = Object.fromEntries(A.cols.map((k, i) => [k, i]));
// (the flight and what it flies on; not the wall clock, the frame number or the draws, which differ between any two runs)
const FLIGHT = ['x', 'y', 'z', 'heading', 'speed', 'vy', 'nose', 'mode', 'onPath', 'pathVy', 'vyYoke', 'yawRate', 'yawAcc', 'bank', 'pitch', 'floorY', 'floorRise', 'floorSmooth', 'holdY', 'targetY', 'groundUnder', 'obstacleUnder', 'groundBroad', 'lift', 'height', 'strain', 'glideSpeed', 'barfT', 'fullness', 'relief', 'speedScale', 'surge', 'tbFloor', 'tbSpeed', 'tbRate', 'tbCeiling', 'tbYaw'];
const cols = opt.cols ? opt.cols.split(',') : FLIGHT;
const ctx = Number(opt.context ?? 3);

function steps(T) {
  const out = [];
  let pre = [];
  for (const r of T.f) {
    if (r[I.dt] > 0) {
      out.push({ pre, r });
      pre = [];
    } else pre.push(r);
  }
  return out;
}
const same = (a, b) => cols.every((k) => a[I[k]] === b[I[k]]);
const diff = (a, b) => cols.filter((k) => a[I[k]] !== b[I[k]]).map((k) => `${k} ${a[I[k]]} | ${b[I[k]]}`);
const sa = steps(A), sb = steps(B);
const show = (T, s, i) => {
  const st = s[i];
  const from = i > 0 ? s[i - 1].r[I.n] : 0;
  const line = (r) => `  n ${r[I.n]} t ${(+r[I.t]).toFixed(4)} dt ${(+r[I.dt]).toFixed(4)} held ${r[I.held]} running ${r[I.running]} steps ${r[I.steps]} queries ${r[I.qn]} #${r[I.qh]} sx ${r[I.qaSx]} sy ${r[I.qaSy]} glide ${r[I.glideSpeed]} busy ${r[I.busy]} pending ${r[I.pending]} adopt ${r[I.adopt]} | y ${r[I.y]} z ${r[I.z]} speed ${r[I.speed]} vy ${r[I.vy]} nose ${r[I.nose]} mode ${r[I.mode]} onPath ${r[I.onPath]} holdY ${r[I.holdY]}`;
  for (const r of st.pre) console.log(line(r));
  console.log(line(st.r));
  for (const e of T.ev) if (e[0] >= from && e[0] <= st.r[I.n] && e[3] !== 'addTile') console.log(`    event after frame ${e[0]}: ${e.slice(3).join(' ')}`);
};
let at = -1, why = '';
for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
  if (!same(sa[i].r, sb[i].r)) {
    at = i;
    why = `after step ${i}: ${diff(sa[i].r, sb[i].r).join('; ')}`;
    const pa = sa[i].pre.length ? sa[i].pre[sa[i].pre.length - 1] : null;
    const pb = sb[i].pre.length ? sb[i].pre[sb[i].pre.length - 1] : null;
    why += `\n  standing frames before it: ${sa[i].pre.length} | ${sb[i].pre.length}`;
    if (pa && pb && !same(pa, pb)) why += `; the last one's state: ${diff(pa, pb).join('; ')}`;
    break;
  }
}
console.log(`${pos[0]}: ${sa.length} steps; ${pos[1]}: ${sb.length} steps`);
if (at < 0) {
  console.log(sa.length === sb.length ? 'the same flight at every step' : 'the same flight as far as both go');
  process.exit(sa.length === sb.length ? 0 : 1);
}
console.log(`they part at step ${at}, t ${(+sa[at].r[I.t]).toFixed(4)}: ${why}`);
for (const [name, T, s] of [['A', A, sa], ['B', B, sb]]) {
  console.log(`${name}:`);
  for (let i = Math.max(0, at - ctx); i <= Math.min(s.length - 1, at + 1); i++) {
    console.log(` step ${i}`);
    show(T, s, i);
  }
}
process.exit(1);
