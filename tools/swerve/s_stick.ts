// The longer stick on a phone's glass (docs/specs/flight/SWERVE.md, section 2; B101 of the review of 018c5d8): Input's stickParts on a 393 px glass with the
// real Flight and TurboDrive, ?swerve's handling on, on a flat world, no browser: node tools/feel-sim/run.mjs ../swerve/s_stick.ts
//   smooth    ours (swerveTune.rule 0): for every landing from x = 60 to 333 and both sides, a thumb held 70 px sideways, level, for 3 s turns within 3 % of today's
//             (the handling off) in every gear wherever that side has 108 px of room or more. Each landing's stick parts at 70 px are worked out, and each
//             different one is flown in every gear
//   reach     ours: from every one of those landings, both sides, the hard turn all in and the skid are in reach (the travel each needs fits the room)
//   squeeze   the stand-in's (rule 1), printed as the review's probe printed it (sb-checks' p_flat.log, parts A and B): where the parts are at ten landings,
//             and the 70 px thumb's turn with room to spare and with 99 px of room. Its part A is held to the stand-in's own numbers
//   squeeze, Turbo 3  ours, stage 2: the real Swerve.pre's gain a px of thumb at 100 and 60 px of room no more than the whole stick's (Input's hardTop),
//             hardTop 1 with 148 px of room or more, and with swerveTune.squeezeCap 0 stage 1's steeper squeeze
// Prints each, and exits 1 if a row fails.
import { config } from '../feel-sim/lib';
import { Flight } from '@src/game/Flight';
import { TurboDrive } from '@src/game/Turbo';
import { stickParts, stickScale } from '@src/game/Input';
import { swerveTune as T } from '@src/game/Swerve';

const flat = { obstacleAt: () => 20, groundAt: () => 10 };
const DEG = Math.PI / 180, W = 393;
const r1 = (v: number) => +v.toFixed(1);
// (Input.applyStretch and softSat, with inputTune's knee and leash, as tools/swerve/s_turns.ts has them)
const KNEE = 0.72, LEASH = 2.2;
function stickOf(dx: number): number {
  const F = config.flight, px = F.stretchPx;
  const d = Math.min(Math.abs(dx), LEASH * px);
  if (d <= F.deadZonePx) return 0;
  const s0 = (d - F.deadZonePx) / px, r = 1 - KNEE, s = s0 <= KNEE ? s0 : KNEE + r * Math.tanh((s0 - KNEE) / r);
  return Math.sign(dx) * s;
}
const GEARS: Array<[string, number]> = [['Cruise', 0], ['Express', 1], ['Nonstop', 2], ['Jet', 3], ['Turbo 1', 4], ['Turbo 2', 5], ['Turbo 3', 6]];
/** The room a thumb landing at x has to its left and its right, to where the glass reads it. */
const roomOf = (x: number, side: -1 | 1) => (side < 0 ? x : W - x) - T.inset;

/** A bus settled in a gear, the handling on or off; then `secs` s with the thumb held `dx` px sideways and `room` px of room that way. Returns the turn (rad). */
function turn(rungs: number, on: boolean, dx: number, room: number, secs: number, dt = 1 / 60) {
  const f = new Flight();
  f.y = 26.5;
  f.glideSpeed = 0;
  f.swerve.on = on;
  const drive = new TurboDrive([-1e9, -1e9, 1e9, 1e9]);
  drive.edgeless = true;
  const parts = { hard: 0, skid: -Infinity };
  const frame = (thumb: boolean) => {
    drive.update(dt, f);
    if (thumb) stickParts(Math.abs(dx), room, parts);
    for (let i = 0; i < 2; i++) f.step(dt / 2, { sx: thumb ? stickOf(dx) : 0, sy: 0, dragging: thumb, hard: thumb ? parts.hard : 0, skid: thumb ? parts.skid : -Infinity }, flat);
  };
  for (let i = 0; i < rungs; i++) drive.rung(1, f);
  for (let k = 0; k < 90 / dt; k++) {
    frame(false);
    if (k * dt > 4 && (rungs === 0 || drive.engaged) && Math.abs(f.speed - (f.turbo.speed || f.speed)) < 0.5 && Math.abs(f.vy) < 0.2) break;
  }
  const h0 = f.heading;
  for (let k = 0; k < secs / dt; k++) frame(true);
  return f.heading - h0;
}
/** Where a part begins, in px of real travel: the least travel whose place on the stick's own scale reaches `want`. */
const at = (want: number, room: number) => {
  let x = 0;
  while (x < 400 && stickScale(x, room) < want - 1e-9) x += 0.25;
  return x;
};

let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(26)} ${typeof o === 'string' ? o : JSON.stringify(o)}`);
};
const rule = T.rule;

// ---------------------------------------------------------------- ours: smooth is today's
T.rule = 0;
{
  // (every landing and side with 108 px of room or more, by its stick parts at 70 px: the different ones, and how many landings each stands for)
  const kinds = new Map<string, { hard: number; skid: number; room: number; n: number }>();
  const parts = { hard: 0, skid: 0 };
  let landings = 0;
  for (let x = 60; x <= 333; x++)
    for (const side of [-1, 1] as const) {
      const room = roomOf(x, side);
      if (room < 108) continue;
      landings++;
      stickParts(70, room, parts);
      const key = `${parts.hard}|${parts.skid}`;
      const k = kinds.get(key);
      if (k) k.n++;
      else kinds.set(key, { hard: parts.hard, skid: parts.skid, room, n: 1 });
    }
  for (const [name, rungs] of GEARS) {
    const today = turn(rungs, false, 70, Infinity, 3);
    let worst = 0, worstAt = '';
    for (const k of kinds.values()) {
      const d = Math.abs(turn(rungs, true, 70, k.room, 3) - today) / Math.abs(today);
      if (d >= worst) [worst, worstAt] = [d, `room ${k.room}`];
    }
    row(worst <= 0.03, `smooth at 70 px, ${name}`, { landingsSides: landings, kindsOfStick: kinds.size, today: `${r1(today / DEG)} deg in 3 s`, worstApart: `${r1(worst * 100)} %`, at: worstAt });
  }
}

// ---------------------------------------------------------------- ours: in reach
{
  let n = 0, short = 0, first = '', tightest = Infinity, tightAt = '';
  for (let x = 60; x <= 333; x++)
    for (const side of [-1, 1] as const) {
      const room = roomOf(x, side), full = at(T.hardFull, room), skid = at(T.skidFrom, room);
      n++;
      if (full > room || skid > room) {
        short++;
        if (!first) first = `x=${x} ${side < 0 ? 'left' : 'right'}: room ${room}, hard all in at ${full}, the skid at ${skid}`;
      }
      if (room - skid < tightest) [tightest, tightAt] = [room - skid, `x=${x} ${side < 0 ? 'left' : 'right'}`];
    }
  row(short === 0, 'the hard turn and the skid', { landingsSides: n, outOfReach: short, tightestPxToSpare: tightest, at: tightAt, first });
}
{
  // (where ours puts the parts at the review's ten landings: hard begins / all in / the skid, in px of real travel)
  const out: string[] = [];
  for (const x of [90, 120, 150, 162, 196, 231, 250, 280, 300, 320]) {
    const L = roomOf(x, -1), R = roomOf(x, 1);
    out.push(`x=${x}: left room ${L}: ${at(T.hardFrom, L)}/${at(T.hardFull, L)}/${at(T.skidFrom, L)}   right room ${R}: ${at(T.hardFrom, R)}/${at(T.hardFull, R)}/${at(T.skidFrom, R)}`);
  }
  console.log(`ours, px of real travel where hard begins / is all in / the skid, to the LEFT and to the RIGHT\n  ${out.join('\n  ')}`);
}

// ---------------------------------------------------------------- the stand-in's squeeze
T.rule = 1;
{
  // (part A of the review's probe, and the stand-in's own numbers for it: its squeeze is rule 1 to the last px)
  const theirs: Record<number, string> = {
    90: '52/68/72 78/120/138', 120: '52/82/96 78/120/138', 150: '70/112/126 78/120/138', 162: '78/120/138 78/120/138', 196: '78/120/138 78/120/138',
    231: '78/120/138 78/120/138', 250: '78/120/138 63/105/119', 280: '78/120/138 52/75/89', 300: '78/120/138 52/68/72', 320: '78/120/138 52/68/72',
  };
  const out: string[] = [];
  let same = true;
  for (const x of [90, 120, 150, 162, 196, 231, 250, 280, 300, 320]) {
    const L = roomOf(x, -1), R = roomOf(x, 1);
    const l = `${at(T.hardFrom, L)}/${at(T.hardFull, L)}/${at(T.skidFrom, L)}`, r = `${at(T.hardFrom, R)}/${at(T.hardFull, R)}/${at(T.skidFrom, R)}`;
    if (`${l} ${r}` !== theirs[x]) same = false;
    out.push(`x=${x}: left room ${L}: ${l}   right room ${R}: ${r}`);
  }
  let squeezed = 0, n = 0;
  for (let x = 60; x <= 333; x++) {
    n++;
    if (roomOf(x, -1) < T.skidFrom + T.squeezeSkid || roomOf(x, 1) < T.skidFrom + T.squeezeSkid) squeezed++;
  }
  console.log(`A. the stand-in's rule: px of real travel where hard begins / is all in / the skid, to the LEFT and to the RIGHT\n  ${out.join('\n  ')}`);
  console.log(`  landings from x=60 to 333 with one side squeezed: ${squeezed} of ${n} (${Math.round((100 * squeezed) / n)} %)`);
  row(same, 'the stand-in\'s squeeze', 'part A as the stand-in had it');
}
{
  console.log('B. the stand-in\'s rule: a thumb held 70 px sideways, level, 3 s: turned with the handling on (room to spare | 99 px of room) against today');
  for (const [name, rungs] of GEARS) {
    const today = turn(rungs, false, 70, Infinity, 3), spare = turn(rungs, true, 70, Infinity, 3), tight = turn(rungs, true, 70, 99, 3);
    console.log(`  ${name.padEnd(8)} room Infinity: turned ${r1(spare / DEG)} deg against ${r1(today / DEG)} today | room 99: turned ${r1(tight / DEG)} deg against ${r1(today / DEG)} today`);
  }
}
T.rule = rule;

// ---------------------------------------------------------------- ours: the hard part squeezed is never steeper (stage 2, SWERVE.md section 3)
{
  // (the real Swerve.pre at Turbo 3 hands back the step's gain for each px of travel short of the skid's line, by Input's stickParts with the room it has;
  // the most it grows over a px, against the whole stick's with room to spare. squeezeCap 0 gives stage 1's: the whole gain in the squeezed part)
  const f = new Flight();
  f.swerve.on = true;
  f.speed = 899.5;
  const gainAt = (travel: number, room: number) => {
    const p = { hard: 0, skid: -Infinity, hardTop: 1 };
    stickParts(travel, room, p);
    f.swerve.pre(1 / 120, { sx: stickOf(travel), sy: 0, dragging: true, hard: p.hard, skid: Math.min(p.skid, -1), side: 1, hardTop: p.hardTop }, f, false);
    return { gain: f.swerve.gain, top: p.hardTop, past: p.skid >= 0 };
  };
  const steepest = (room: number) => {
    let most = 0, top = 1;
    for (let x = 0.05; x <= Math.min(room, 400); x += 0.05) {
      const a = gainAt(x - 0.05, room), b = gainAt(x, room);
      if (b.past) break;
      most = Math.max(most, b.gain - a.gain);
      top = b.top;
    }
    return { perPx: most / 0.05, top };
  };
  const cap = T.squeezeCap;
  const whole = steepest(Infinity), out: Record<string, unknown> = { wholeStick: `${+whole.perPx.toFixed(4)} a px` };
  let ok = whole.top === 1;
  for (const room of [100, 60]) {
    const s = steepest(room);
    if (s.perPx > whole.perPx * (1 + 1e-6)) ok = false;
    out[`room ${room}`] = `${+s.perPx.toFixed(4)} a px, top ${+s.top.toFixed(3)}`;
  }
  for (const room of [148, 200]) if (steepest(room).top !== 1) ok = false;
  T.squeezeCap = 0;
  const s1 = steepest(100);
  T.squeezeCap = cap;
  // (stage 1's squeeze at 100 px of room: the whole 3.45 over 16 px, about 42/16 times the whole stick's per px)
  if (!(s1.top === 1 && s1.perPx > whole.perPx * 2)) ok = false;
  out['squeezeCap 0, room 100'] = `${+s1.perPx.toFixed(4)} a px, top ${s1.top}`;
  row(ok, 'squeeze, Turbo 3', out);
}

console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
