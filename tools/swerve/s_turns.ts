// The handling's numbers and its rules (docs/specs/flight/SWERVE.md, "Solid before it's flown"): the real Flight, TurboDrive and CameraRig with ?swerve's
// handling on (Flight.swerve, src/game/Swerve.ts), on a flat world, no browser: node tools/feel-sim/run.mjs ../swerve/s_turns.ts
// The thumb is a place on the glass (px from where it landed), put through the stick's own curve (Input.applyStretch's, copied below: its dead zone, its knee, its
// leash) and the stick's own parts (Input's stickParts, with room to spare), and each frame goes as main.ts's does: the gears, the flight's steps at 120 Hz.
//   table    half a turn in every gear: today's (the stand-in off, the thumb at the leash), hard (120 px), and the skid (the leash, held till the nose is round,
//            then let go); its time and its width, at 30 and at 60 frames a second, the two within 3 % of each other
//   squeeze  a thumb that lands near a side of the glass, by the stand-in's rule (swerveTune.rule 1; tools/swerve/s_stick.ts holds ours): the hard part and
//            the skid squeeze into the room it has, in order, the skid within reach of the edge
//   smooth   the same thumb inside 78 px, level, flies the same line with it on as with it off, in every gear, to the last bit
//   skid     the slip never over its cap; grip within 0.4 s of easing off; never under 20 m/s (or what it began at); the gear never changed; with a gear in,
//            over by itself in under 2 s, and with none held as long as the thumb is; a thumb that twitches out and back doesn't start one; a skid at Nonstop
//            scrubs the flight's speed and never the gear's own, so the Comet stays on (the review of 018c5d8, m101); the street taking the bus mid-skid
//            leaves nothing of it, the hard part's stiff camera included, and grips it; and a skid goes the thumb's way, whatever else turns the bus (the
//            review of 47d7d97)
//   quick    stage 2's quick turn: a quarter and a half turn, hard and in a skid, in every gear at 30 and 60 fps: from Jet up the skid's quarter turn in
//            1.15 s, its half in 2 s (Turbo 3's under 1 km wide), the hard half turn on one law (1.5 s x (v / 26.4)^0.2, within 5 %), Cruise and Express
//            within 0.05 s of stage 1's; the slip's soft end (no lurch in the nose's rate); over the speed of sound a skid stays over 0.95 of it (no second
//            boom); after the grip the gear has 95 % of its speed back within 1.2 s
//   swoop    up, over and down at Cruise, Express, Jet, Turbo 1 and Turbo 3: how long the reversal takes with it and without; the turn never over three times
//            its flat rate; in Turbo 1 and 3 round in 3.3 s
//   brake    the long swipe's brake: at Cruise's speed from every gear in under 0.8 s
//   camera   the bus stays in the frame through a hard turn, a skid and its grip, in every gear
// Prints each, and exits 1 if a row fails.
import { config, makeCam } from '../feel-sim/lib';
import { Flight } from '@src/game/Flight';
import { TurboDrive } from '@src/game/Turbo';
import { cometOn } from '@src/game/Comet';
import { stickParts, stickScale } from '@src/game/Input';
import { swerveTune as T, type Swerve } from '@src/game/Swerve';

const flat = { obstacleAt: () => 20, groundAt: () => 10 };
const DEG = Math.PI / 180;
const r1 = (v: number) => +v.toFixed(1), r2 = (v: number) => +v.toFixed(2);
// (Input.applyStretch and softSat, with inputTune's knee and leash)
const KNEE = 0.72, LEASH = 2.2;
function stickOf(dx: number, dy: number): { sx: number; sy: number } {
  const F = config.flight, px = F.stretchPx;
  let d = Math.hypot(dx, dy);
  const max = LEASH * px;
  if (d > max) {
    dx *= max / d;
    dy *= max / d;
    d = max;
  }
  if (d <= F.deadZonePx) return { sx: 0, sy: 0 };
  const s0 = (d - F.deadZonePx) / px, r = 1 - KNEE, s = s0 <= KNEE ? s0 : KNEE + r * Math.tanh((s0 - KNEE) / r);
  return { sx: (dx / d) * s, sy: (-dy / d) * s };
}

const GEARS: Array<[string, number]> = [['Cruise', 0], ['Express', 1], ['Nonstop', 2], ['Jet', 3], ['Turbo 1', 4], ['Turbo 2', 5], ['Turbo 3', 6]];

interface Bus {
  f: Flight;
  drive: TurboDrive;
  sw: Swerve | null;
  t: number;
  /** One frame with the thumb at (dx, dy) px from its landing; null: lifted. */
  frame(dt: number, thumb: [number, number] | null): void;
}
/** A bus in a gear, settled at its speed and height, the handling on or off. */
function bus(rungs: number, on: boolean, dt: number): Bus {
  const f = new Flight();
  f.y = 26.5;
  f.glideSpeed = 0;
  f.swerve.on = on;
  const drive = new TurboDrive([-1e9, -1e9, 1e9, 1e9]);
  drive.edgeless = true;
  const sw = on ? f.swerve : null;
  const parts = { hard: 0, skid: -Infinity };
  const b: Bus = {
    f, drive, sw, t: 0,
    frame(h, thumb) {
      const st = thumb ? stickOf(thumb[0], thumb[1]) : { sx: 0, sy: 0 };
      drive.update(h, f);
      if (thumb) stickParts(Math.abs(thumb[0]), Infinity, parts);
      const n = Math.max(1, Math.ceil(h / (1 / 120)));
      for (let i = 0; i < n; i++) f.step(h / n, { sx: st.sx, sy: st.sy, dragging: !!thumb, hard: thumb ? parts.hard : 0, skid: thumb ? parts.skid : -Infinity }, flat);
      b.t += h;
    },
  };
  for (let i = 0; i < rungs; i++) drive.rung(1, f);
  // (up to its height and its speed: a gear lifts, engages and spools)
  for (let k = 0; k < 90 / dt; k++) {
    b.frame(dt, null);
    if (k * dt > 4 && (rungs === 0 || drive.engaged) && Math.abs(f.speed - (f.turbo.speed || f.speed)) < 0.5 && Math.abs(f.vy) < 0.2) break;
  }
  b.t = 0;
  return b;
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(30)} ${typeof o === 'string' ? o : JSON.stringify(o)}`);
};

// ---------------------------------------------------------------- the table
/** Half a turn to the right: the thumb at `px` until the bus's way is round. kind 'skid': at the leash till the nose is round, then lifted. */
function halfTurn(rungs: number, kind: 'today' | 'hard' | 'skid', dt: number) {
  const b = bus(rungs, kind !== 'today', dt), f = b.f, h0 = f.heading, x0 = f.x, z0 = f.z, v0 = f.speed;
  const px = kind === 'hard' ? 124 : 172, rx = Math.cos(h0), rz = Math.sin(h0);
  let wide = 0, noseAt = NaN, least = v0, slip = 0, let_go = false, gear = b.drive.gear + b.drive.level, sameGear = true;
  while (b.t < 60) {
    const nose = f.heading + (b.sw?.slip ?? 0) - h0;
    if (kind === 'skid' && !let_go && nose >= Math.PI) let_go = true;
    if (Number.isNaN(noseAt) && nose >= Math.PI) noseAt = b.t;
    b.frame(dt, let_go ? null : [px, 0]);
    wide = Math.max(wide, (f.x - x0) * rx + (f.z - z0) * rz);
    least = Math.min(least, f.speed);
    slip = Math.max(slip, Math.abs(b.sw?.slip ?? 0));
    if (b.drive.gear + b.drive.level !== gear) sameGear = false;
    if (f.heading - h0 >= Math.PI - (kind === 'skid' ? 2 * DEG : 0) && !(b.sw?.skidding ?? false)) break;
  }
  return { t: b.t, wide, speed: v0, least, noseAt, slip: slip / DEG, sameGear };
}
console.log('half a turn at the thumb\'s limit, by gear: seconds, and metres wide');
for (const [name, rungs] of GEARS) {
  const out: Record<string, unknown> = {};
  let ok = true;
  for (const kind of ['today', 'hard', 'skid'] as const) {
    const a = halfTurn(rungs, kind, 1 / 60), c = halfTurn(rungs, kind, 1 / 30);
    const dT = Math.abs(a.t - c.t) / a.t, dW = Math.abs(a.wide - c.wide) / a.wide;
    // (a frame is 0.033 s: under a second and a half that alone is over 3 %, so the time may differ by a frame)
    if (dT > 0.03 && Math.abs(a.t - c.t) > 1 / 30 + 1e-9) ok = false;
    if (dW > 0.03) ok = false;
    if (!a.sameGear || !c.sameGear) ok = false;
    out[kind] = `${r2(a.t)} s, ${a.wide < 100 ? r1(a.wide) : Math.round(a.wide)} m` + (kind === 'skid' ? ` (nose round at ${r2(a.noseAt)} s, slowest ${Math.round(a.least)} of ${Math.round(a.speed)} m/s)` : '') + ` [30 fps: ${r2(c.t)} s, ${c.wide < 100 ? r1(c.wide) : Math.round(c.wide)} m]`;
  }
  row(ok, name, out);
}

// ---------------------------------------------------------------- the quick turn (stage 2: SWERVE.md section 2, "The quick turn in turbo")
/** A turn of `ang` to the right: hard (124 px), or the skid (the leash till the nose is round, then let go); done when the bus's way is round and the skid
 *  over. Its time, how wide it went, the slowest speed, and how long after it the speed was 95 % of what it began at. */
function quickTurn(rungs: number, kind: 'hard' | 'skid', ang: number, dt: number) {
  const b = bus(rungs, true, dt), f = b.f, sw = b.sw!, h0 = f.heading, x0 = f.x, z0 = f.z, v0 = f.speed, rx = Math.cos(h0), rz = Math.sin(h0);
  const px = kind === 'hard' ? 124 : 172, gear = b.drive.gear + b.drive.level;
  let wide = 0, least = v0, letGo = false, done = NaN, back = NaN, booms = 0, skidAt = NaN, gripAt = NaN, sameGear = true;
  b.drive.onEvent = (ev) => {
    if (ev === 'boom' && !Number.isNaN(skidAt)) booms++;
  };
  sw.onEvent = (ev) => {
    if (ev === 'skid') skidAt = b.t;
    if (ev === 'grip') gripAt = b.t;
  };
  while (b.t < 30) {
    if (kind === 'skid' && !letGo && f.heading + sw.slip - h0 >= ang) letGo = true;
    b.frame(dt, !Number.isNaN(done) || letGo ? null : [px, 0]);
    wide = Math.max(wide, (f.x - x0) * rx + (f.z - z0) * rz);
    least = Math.min(least, f.speed);
    if (b.drive.gear + b.drive.level !== gear) sameGear = false;
    if (Number.isNaN(done) && f.heading - h0 >= ang - (kind === 'skid' ? 2 * DEG : 0) && !sw.skidding) done = b.t;
    if (!Number.isNaN(done) && Number.isNaN(back) && f.speed >= 0.95 * v0) back = b.t;
    if (!Number.isNaN(done) && (!Number.isNaN(back) || b.t > done + 8)) break;
  }
  return { t: done, wide, v0, least, sameGear, booms, back: back - done, gripAt };
}
{
  // (stage 1's, 302e6de, for Cruise and Express, where the quick turn changes only by the slip's soft end: hard 90 and 180, skid 90 and 180, seconds)
  const STAGE1: Record<string, number[]> = { Cruise: [0.78, 1.5, 0.85, 1.35], Express: [1.03, 2.02, 0.87, 1.57] };
  const law = (v: number) => 1.5 * Math.pow(v / 26.4, 0.2);
  const hard180: number[] = [];
  for (const [name, rungs] of GEARS) {
    const out: Record<string, string> = {};
    let ok = true;
    const at60: number[] = [];
    for (const kind of ['hard', 'skid'] as const)
      for (const ang of [Math.PI / 2, Math.PI]) {
        const a = quickTurn(rungs, kind, ang, 1 / 60), c = quickTurn(rungs, kind, ang, 1 / 30);
        at60.push(a.t);
        if (!(Math.abs(a.t - c.t) / a.t <= 0.03 || Math.abs(a.t - c.t) <= 1 / 30 + 1e-9)) ok = false;
        if (!a.sameGear || !c.sameGear || Number.isNaN(a.t)) ok = false;
        const deg = ang > 2 ? 180 : 90;
        let mark = '';
        if (kind === 'hard' && deg === 180) {
          hard180.push(a.t);
          const lw = law(a.v0);
          if (Math.abs(a.t / lw - 1) > 0.05) ok = false;
          mark = ` (the law ${r2(lw)} s)`;
        }
        if (rungs >= 3 && kind === 'skid') {
          if (deg === 90 && a.t > 1.15) ok = false;
          if (deg === 180 && a.t > 2.0) ok = false;
          if (deg === 180 && rungs === 6 && a.wide > 1000) ok = false;
        }
        out[`${kind} ${deg}`] = `${r2(a.t)} s, ${a.wide < 100 ? r1(a.wide) : Math.round(a.wide)} m wide, slowest ${Math.round(a.least)} of ${Math.round(a.v0)} m/s${mark} [30 fps: ${r2(c.t)} s]`;
      }
    const s1 = STAGE1[name];
    if (s1) {
      for (let i = 0; i < 4; i++) if (Math.abs(at60[i] - s1[i]) > 0.05) ok = false;
      out['stage 1'] = s1.join(', ');
    }
    row(ok, `quick, ${name}`, out);
  }
  // (the hard half turn along the ladder: each gear's a little longer than the one below, never much: at most 20 % longer for each doubling of the speed
  // between them (the law's is 15 %; today's stick takes 2.2 times longer). Cruise to Express is more than two doublings, so it's taken per doubling)
  let rising = true;
  const v = GEARS.map(([, rungs]) => bus(rungs, true, 1 / 60).f.speed);
  const perDoubling = hard180.slice(1).map((t, i) => Math.pow(t / hard180[i], 1 / Math.log2(v[i + 1] / v[i])));
  for (let i = 1; i < hard180.length; i++) if (!(hard180[i] > hard180[i - 1] && perDoubling[i - 1] <= 1.2)) rising = false;
  row(rising, 'quick, one law', { hard180: hard180.map(r2), longerPerDoubling: perDoubling.map(r2) });
}
{
  // (the slip eases into its cap: through a held skid at Cruise and at Turbo 3, after its first 0.1 s (the snap of the nose is the skid's own start), no
  // frame's change of the nose's rate over 0.15 rad/s at 60 fps, its grip included; and at Cruise, with no gear to end it, the slip comes within 1 deg of
  // its cap)
  const out: Record<string, unknown> = {};
  let ok = true;
  for (const [name, rungs] of [GEARS[0], GEARS[6]]) {
    const b = bus(rungs, true, 1 / 60), f = b.f, sw = b.sw!;
    let last = f.heading + sw.slip, lastRate = NaN, worst = 0, slideT = 0, slipEnd = 0, gripped = false;
    for (let k = 0; k < (rungs === 0 ? 2.5 : 2.2) * 60; k++) {
      b.frame(1 / 60, [172, 0]);
      const nose = f.heading + sw.slip, rate = (nose - last) * 60;
      last = nose;
      if (sw.sliding) slideT += 1 / 60;
      const inIt = sw.skidding && slideT > 0.1 && !gripped;
      if (inIt && !Number.isNaN(lastRate)) worst = Math.max(worst, Math.abs(rate - lastRate));
      if (sw.skidding && !sw.sliding) gripped = true;
      lastRate = inIt ? rate : NaN;
      if (sw.sliding) slipEnd = Math.abs(sw.slip);
    }
    if (worst > 0.15) ok = false;
    if (rungs === 0 && Math.abs(slipEnd / DEG - T.slipMax) > 1) ok = false;
    out[name] = { noseRateStepAtMost: r2(worst), slipAtTheEndDeg: r1(slipEnd / DEG) };
  }
  row(ok, 'skid, the soft cap', out);
}
{
  // (a skid's half turn over the speed of sound never takes the bus back under 0.95 of it: no second boom on the way back up, and the gear is the gear)
  const out: Record<string, unknown> = {};
  let ok = true;
  for (const [name, rungs] of [GEARS[3], GEARS[4]]) {
    const a = quickTurn(rungs, 'skid', Math.PI, 1 / 60);
    if (a.least < 0.95 * 343 - 1e-6 || a.booms > 0 || !a.sameGear) ok = false;
    out[name] = { slowest: r1(a.least), of: Math.round(a.v0), boomsAfterTheSkid: a.booms };
  }
  row(ok, 'skid, the speed of sound', out);
}
{
  // (and after the grip the gear pulls the speed back as it does today: 95 % of it within 1.2 s of the turn's end, the grip's catch over, Nonstop to
  // Turbo 3; the grip itself began T.grip before that)
  const out: Record<string, number> = {};
  let ok = true;
  for (const [name, rungs] of GEARS.slice(2)) {
    const a = quickTurn(rungs, 'skid', Math.PI, 1 / 60);
    if (!(a.back <= 1.2)) ok = false;
    out[name] = r2(a.back);
  }
  row(ok, 'skid, the gear pulls back', out);
}

// ---------------------------------------------------------------- one thumb out of a skid (stage 2: SWERVE.md section 4)
/** A skid to the right with a full belly, the thumb at the leash until `until` says, then `end`: 'lift' (let go), 'ease' (back to 110 px, three frames, then
 *  let go) or 'hold' (held on, the slide's own time ends it). The events, the belly just after the grip, and a tap's aim a frame after it against the nose
 *  the bus is drawn with then (deg): main.ts aims along the bus's way turned by the view's look and the slip (Aim.point, lookYaw), and draws the nose at the
 *  way plus the slip, so through the catch the tap goes where the nose points. How far the nose turns on through the catch is printed (the bus's own turn
 *  dying away), not marked. */
function oneThumb(rungs: number, end: 'lift' | 'ease' | 'hold', until: (b: Bus) => boolean, dt = 1 / 60) {
  const b = bus(rungs, true, dt), f = b.f, sw = b.sw!;
  f.fullness = 1;
  let events = '', noseAtGrip = NaN, belly = NaN, aimOff = NaN, drift = 0, ended = false, k = 0;
  sw.onEvent = (ev, self) => {
    events += `${ev}${self ? '*' : ''} `;
    // (the boot spends the belly on a wave: so does this)
    if (ev === 'wave') f.fullness = 0;
  };
  while (b.t < 8) {
    if (!ended && sw.sliding && until(b)) ended = true;
    let thumb: [number, number] | null = [172, 0];
    if (ended && end !== 'hold') thumb = end === 'ease' && k++ < 3 ? [110, 0] : null;
    if (end === 'hold' && !Number.isNaN(noseAtGrip)) thumb = null;
    const was = sw.sliding;
    b.frame(dt, thumb);
    const nose = f.heading + sw.slip;
    if (was && !sw.sliding) {
      noseAtGrip = nose;
      belly = f.fullness;
    } else if (!Number.isNaN(noseAtGrip)) {
      if (Number.isNaN(aimOff)) {
        // (Aim.point: the bus's way, f.fx and f.fz, turned by lookYaw, here the slip alone, no look)
        const c = Math.cos(sw.slip), s = Math.sin(sw.slip), ax = f.fx * c - f.fz * s, az = f.fz * c + f.fx * s;
        aimOff = Math.abs(wrap(Math.atan2(ax, -az) - nose));
      }
      if (sw.skidding) drift = Math.max(drift, Math.abs(wrap(nose - noseAtGrip)));
    }
    if (!Number.isNaN(noseAtGrip) && !sw.skidding) break;
  }
  return { events: events.trim(), belly: r2(belly), tapOffTheNoseDeg: r2(aimOff / DEG), noseTurnsOnDeg: r1(drift / DEG), gripped: !Number.isNaN(noseAtGrip) };
}
{
  // (Cruise: a skid of 0.6 s then let go. The hiss, no wave, the belly kept, and a tap a frame later down the nose)
  const a = oneThumb(0, 'lift', (b) => b.t >= 0.6);
  row(a.gripped && a.events === 'skid grip' && a.belly === 1 && a.tapOffTheNoseDeg <= 2, 'one thumb, let go', a);
  // (the same, eased back to 110 px first: the thumb chose the grip, and the belly goes off the outside)
  const e = oneThumb(0, 'ease', (b) => b.t >= 0.6);
  row(e.gripped && e.events === 'skid grip wave' && e.belly <= 0.05, 'one thumb, eased back', e);
  // (Express, held past the slide's 1.5 s: it grips by itself and keeps the belly; with liftWave 1, stage 1's, it throws it)
  const h = oneThumb(1, 'hold', () => false);
  const lw = T.liftWave;
  T.liftWave = 1;
  const h1 = oneThumb(1, 'hold', () => false);
  T.liftWave = lw;
  row(h.gripped && h.events === 'skid grip*' && h.belly === 1 && h1.events === 'skid grip* wave*' && h1.belly <= 0.05, 'one thumb, time up', { liftWave0: h, liftWave1: h1 });
  // (Jet and Turbo 3: held till the nose is round, then lifted, or the slide's time first; the belly kept, a tap down the nose)
  const out: Record<string, unknown> = {};
  let ok = true;
  for (const [name, rungs] of [GEARS[3], GEARS[6]]) {
    let h0 = NaN;
    const r = oneThumb(rungs, 'lift', (b) => {
      if (Number.isNaN(h0)) h0 = b.f.heading;
      return b.f.heading + b.sw!.slip - h0 >= Math.PI;
    });
    if (!(r.gripped && /^skid grip\*?$/.test(r.events) && r.belly === 1 && r.tapOffTheNoseDeg <= 2)) ok = false;
    out[name] = r;
  }
  row(ok, 'one thumb, turbo half turn', out);
}

// ---------------------------------------------------------------- a thumb short of room
{
  // (by the room from the landing to the side: where the hard part begins, where it is all in, and where the skid's line is, in px of real travel; with room to
  // spare they are the stick's own, and short of it they squeeze in, in that order, the skid always within reach of the edge; the stand-in's rule)
  const out: string[] = [];
  let ok = true;
  const rule = T.rule;
  T.rule = 1;
  const squeeze = stickScale;
  for (const room of [200, 148, 130, 110, 95, 80, 70]) {
    const at = (want: number) => {
      let x = 0;
      while (x < room + 40 && squeeze(x, room) < want - 1e-9) x += 0.25;
      return x;
    };
    const from = at(T.hardFrom), full = at(T.hardFull), skid = at(T.skidFrom);
    let mono = true;
    for (let x = 0.5; x <= room; x += 0.5) if (squeeze(x, room) < squeeze(x - 0.5, room)) mono = false;
    const good = mono && from < full && full < skid && skid <= Math.max(room, 72) && from >= T.squeezeSmooth - 1e-6 && (room < T.skidFrom + T.squeezeSkid || (from === T.hardFrom && skid === T.skidFrom));
    if (!good) ok = false;
    out.push(`${room} px of room: hard from ${Math.round(from)}, all in at ${Math.round(full)}, the skid at ${Math.round(skid)}${good ? '' : ' (!)'}`);
  }
  T.rule = rule;
  row(ok, 'a thumb near a side', out);
}

// ---------------------------------------------------------------- smooth is today's
{
  // (a weave, a held carve and a lift, all inside hardFrom sideways, level: no pull or push past the yoke's dead band)
  const thumbAt = (t: number): [number, number] | null => (t < 3 ? [T.hardFrom * Math.sin(t * 2.1), 8 * Math.sin(t * 3.3)] : t < 5 ? [-T.hardFrom, 0] : t < 5.5 ? null : [T.hardFrom * 0.6, -6]);
  for (const [name, rungs] of GEARS) {
    const a = bus(rungs, false, 1 / 60), b = bus(rungs, true, 1 / 60);
    let worst = 0;
    for (let k = 0; k < 8 * 60; k++) {
      a.frame(1 / 60, thumbAt(a.t));
      b.frame(1 / 60, thumbAt(b.t));
      worst = Math.max(worst, Math.abs(a.f.x - b.f.x), Math.abs(a.f.z - b.f.z), Math.abs(a.f.y - b.f.y), Math.abs(a.f.heading - b.f.heading), Math.abs(a.f.speed - b.f.speed), Math.abs(a.f.bank - b.f.bank));
    }
    row(worst === 0, `smooth, ${name}`, { apartAtMost: worst });
  }
}

// ---------------------------------------------------------------- the skid
for (const [name, rungs] of GEARS) {
  for (const dt of [1 / 60, 1 / 30]) {
    const b = bus(rungs, true, dt), f = b.f, sw = b.sw!, cap = T.slipMax * DEG, v0 = f.speed, gear = b.drive.gear + b.drive.level;
    let slip = 0, least = v0, sameGear = true, began = NaN, ended = NaN, events = '', gripAt = NaN, back = NaN;
    sw.onEvent = (ev, self) => {
      events += `${ev}${self ? '*' : ''} `;
      if (ev === 'grip') gripAt = b.t;
    };
    // (how long after its grip the speed is the gear's again, within 3 %)
    const watch = () => {
      if (!Number.isNaN(gripAt) && Number.isNaN(back) && f.speed >= v0 * 0.97) back = b.t - gripAt;
    };
    // (the thumb out for 5 s: with a gear in it's over by itself, with none it's held; then eased back to the hard part)
    for (let k = 0; k < 5 / dt; k++) {
      b.frame(dt, [172, 0]);
      if (sw.sliding && Number.isNaN(began)) began = b.t;
      if (!sw.sliding && !Number.isNaN(began) && Number.isNaN(ended)) ended = b.t;
      slip = Math.max(slip, Math.abs(sw.slip));
      least = Math.min(least, f.speed);
      if (b.drive.gear + b.drive.level !== gear) sameGear = false;
      watch();
    }
    const heldToEnd = sw.sliding, easedAt = b.t;
    let gripped = NaN;
    for (let k = 0; k < 1.5 / dt; k++) {
      b.frame(dt, [100, 0]);
      if (!sw.skidding && Number.isNaN(gripped)) gripped = b.t - easedAt;
      slip = Math.max(slip, Math.abs(sw.slip));
      least = Math.min(least, f.speed);
      watch();
    }
    for (let k = 0; k < 12 / dt; k++) {
      b.frame(dt, null);
      watch();
    }
    const floor = Math.min(T.floor, v0);
    const ok = slip <= cap + 1e-9 && least >= floor - 1e-6 && sameGear && began <= 0.2 && (rungs === 0 ? heldToEnd && gripped <= 0.4 : ended - began < 2 && !heldToEnd) && !Number.isNaN(back);
    row(ok, `skid, ${name}, ${Math.round(1 / dt)} fps`, { began: r2(began), slidFor: rungs === 0 ? 'held' : r2(ended - began), slipAtMostDeg: r1(slip / DEG), slowest: `${r1(least)} of ${r1(v0)} m/s`, gripAfterEasing: rungs === 0 ? r2(gripped) : 'by itself', speedBackAfterGrip: r2(back), events: events.trim() });
  }
}
{
  // (a twitch: out past the skid's line and back inside its hold starts nothing)
  const b = bus(1, true, 1 / 60), sw = b.sw!;
  let any = false;
  for (let k = 0; k < 4; k++) b.frame(1 / 60, [172, 0]);
  for (let k = 0; k < 60; k++) {
    b.frame(1 / 60, [60, 0]);
    any ||= sw.skidding;
  }
  row(!any, 'skid, a twitch', { started: any, heldFor: r2(4 / 60), needs: T.skidHold });
}
{
  // (a skid held at Nonstop, its whole slide: the flight's speed falls, the gear's own (Flight.turbo.speed) stays what the gear drives, and the Comet with it)
  const b = bus(2, true, 1 / 30), f = b.f, sw = b.sw!, gearSpeed = f.turbo.speed;
  let slid = 0, slowest = f.speed, gearMoved = 0, cometOff = 0;
  for (let k = 0; k < 60; k++) {
    b.frame(1 / 30, [172, 0]);
    if (sw.sliding) slid++;
    slowest = Math.min(slowest, f.speed);
    gearMoved = Math.max(gearMoved, Math.abs(f.turbo.speed - gearSpeed));
    if (!cometOn(f)) cometOff++;
  }
  row(slid > 20 && slowest < gearSpeed * 0.9 && gearMoved === 0 && cometOff === 0, 'skid, Nonstop: the gear kept', { framesSliding: slid, slowest: r1(slowest), gear: gearSpeed, gearMovedBy: gearMoved, framesCometOff: cometOff });
}
{
  // (a hard turn into a skid, and the street takes the bus mid-slide (Flight.ride, Curb): none of it is left, the camera's spring is today's, and the slide
  // gripped, so its squeal stops (the boot stops it on 'grip'), with no wave)
  const b = bus(0, true, 1 / 30), f = b.f, sw = b.sw!;
  let events = '';
  sw.onEvent = (ev) => (events += `${ev} `);
  for (let k = 0; k < 15; k++) b.frame(1 / 30, [172, 0]);
  const sliding = sw.sliding;
  f.ride(1 / 30, { x: f.x, y: 12, z: f.z, heading: f.heading, speed: 9 }, 0, flat);
  row(sliding && !sw.skidding && sw.hard === 0 && sw.gain === 1 && sw.slip === 0 && events.trim() === 'skid grip', 'skid, the street takes the bus', { slidingBefore: sliding, skidding: sw.skidding, hard: sw.hard, gain: sw.gain, events: events.trim() });
}
{
  // (past the map's edge main.ts adds its homing to sx: a thumb held out right past the skid's line while that pulls sx to the left skids right, and holds)
  const b = bus(0, true, 1 / 30), f = b.f, sw = b.sw!, parts = { hard: 0, skid: -Infinity };
  stickParts(172, Infinity, parts);
  const st = stickOf(172, 0), sx = st.sx - 1.2;
  let dirs = '', slid = 0;
  sw.onEvent = (ev) => (dirs += `${ev}${ev === 'skid' ? (sw.dir > 0 ? ' right' : ' left') : ''} `);
  for (let k = 0; k < 30; k++) {
    b.drive.update(1 / 30, f);
    for (let i = 0; i < 4; i++) f.step(1 / 120, { sx, sy: 0, dragging: true, hard: parts.hard, skid: parts.skid, side: 1 }, flat);
    if (sw.sliding) slid++;
  }
  row(dirs.trim() === 'skid right' && slid >= 25, "skid, homed past the map's edge", { sx: r2(sx), events: dirs.trim(), framesSliding: slid });
}

// ---------------------------------------------------------------- the swoop
for (const [name, rungs] of [GEARS[0], GEARS[1], GEARS[3], GEARS[4], GEARS[6]]) {
  const out: Record<string, unknown> = {};
  let worstGain = 0, roundWith = NaN;
  for (const on of [false, true]) {
    // (one arc: straight down for `up` s, then down and across until the bus has come round, then pushed till it's level)
    const b = bus(rungs, on, 1 / 60), f = b.f, h0 = f.heading, y0 = f.y;
    const up = rungs === 0 ? 0.9 : 1.1;
    let round = NaN, top = 0;
    while (b.t < 40) {
      const flatRate = Math.abs(f.yawRate);
      const thumb: [number, number] = b.t < up ? [0, 150] : Number.isNaN(round) ? [124, 110] : [0, -150];
      b.frame(1 / 60, thumb);
      top = Math.max(top, f.y - y0);
      if (Number.isNaN(round) && Math.abs(f.heading - h0) >= Math.PI) round = b.t;
      if (!Number.isNaN(round) && b.t > round + 0.3 && f.nose <= 0.05 && f.vy >= -1) break;
      void flatRate;
    }
    out[on ? 'with' : 'today'] = `round at ${r2(round)} s, ${Math.round(top)} m up, done at ${r2(b.t)} s`;
    if (on) roundWith = round;
  }
  // (the turn against its flat rate: the same stick level and at the steepest nose, the stand-in on)
  for (const steep of [false, true]) {
    const b = bus(rungs, true, 1 / 60), f = b.f;
    for (let k = 0; k < 150; k++) b.frame(1 / 60, steep ? [0, 170] : null);
    let w = 0;
    for (let k = 0; k < 40; k++) {
      b.frame(1 / 60, steep ? [124, 118] : [124, 0]);
      w = Math.max(w, Math.abs(f.yawRate) / Math.max(1e-6, Math.abs(f.turbo.yaw)));
    }
    if (steep) worstGain = w / (out.flat as number);
    else out.flat = w;
  }
  delete out.flat;
  // (in Turbo 1 to 3, on the quick turn's hard part: nearly a 180 in about 3 s, "swerve up, then dive down, and then essentially almost do a 180")
  row(worstGain <= T.swoopMax * 1.6 && (rungs < 4 || roundWith <= 3.3), `swoop, ${name}`, out);
}

// ---------------------------------------------------------------- the long swipe's brake
for (const [name, rungs] of GEARS.slice(1)) {
  const b = bus(rungs, true, 1 / 60), f = b.f, v0 = f.speed, y0 = f.y;
  // (every rung at once, with the gears' brake for it, as the boot's swipe asks)
  b.drive.toCruise(f, T.brakeFor);
  let at = NaN;
  for (let k = 0; k < 3 * 60; k++) {
    b.frame(1 / 60, null);
    if (Number.isNaN(at) && f.speed <= config.flight.cruiseSpeed * 1.15) at = b.t;
  }
  row(at <= 0.8 && b.drive.gear === 0 && b.drive.below === 0, `brake, from ${name}`, { from: Math.round(v0), atCruiseIn: r2(at), speedAfter3s: r1(f.speed), heightKept: r1(f.y - y0) });
}

// ---------------------------------------------------------------- the camera
for (const [name, rungs] of GEARS) {
  const out: Record<string, unknown> = {};
  let ok = true;
  for (const kind of ['today', 'hard', 'skid'] as const) {
    const b = bus(rungs, kind !== 'today', 1 / 60), f = b.f, c = makeCam();
    for (let k = 0; k < 240; k++) {
      b.frame(1 / 60, null);
      c.update(f, 1 / 60);
    }
    let off = 0, low = 1, high = 0;
    // (4 s of it, and for the skid the thumb then comes in to the hard part: its grip is in the picture too)
    for (let k = 0; k < 6 * 60; k++) {
      b.frame(1 / 60, kind === 'skid' ? (b.t < 2.5 ? [172, 0] : [110, 0]) : [kind === 'hard' ? 124 : 172, 0]);
      c.update(f, 1 / 60);
      const p = c.project(f.x, f.y, f.z);
      off = Math.max(off, Math.abs(p.x - 0.5));
      low = Math.min(low, p.y);
      high = Math.max(high, p.y);
    }
    if (kind !== 'today' && (off > 0.42 || low < 0.05 || high > 0.95)) ok = false;
    out[kind] = `${r2(off)} of the width off the middle, ${r2(low)}-${r2(high)} down the frame`;
  }
  row(ok, `camera, ${name}`, out);
}

console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
