// A hit's throw over the real city (B100 and m102 of the review of 018c5d8): the real City, Flight and TurboDrive with ?swerve's handling on, the player's bus
// thrown by Flight.shove as src/rivals/rivalsBoot.ts's hurtMe throws it (and its short throw's hop, hitFx's), no browser:
//   node tools/feel-sim/run.mjs ../swerve/s_throw.ts [throw|base|hard] [per=4] [eager]
//   throw   the acceptance: 48 throws of each kind (a shell's 70 m, a smash's 170, a wreck's 675, a head-on's 1,350; Cruise to Jet; from roof height over the
//           Financial District, Nob Hill and SoMa, four poses a gear each): on no frame is the bus's underside through a roof, a wall or a tree as drawn (the
//           route check's measure), none is lifted more than 12 m in a frame, and every throw ends inside the map. And a head-on blows the bus back: as the
//           throw ends the bus is behind where it was hit, by at least half the throw (the gear then pulls it on again)
//   base    the same poses with no throw (prints only): which frames are inside a surface, and for each whether the flight's own obstacle field had it
//   hard    the review's hard turns with a pull or a push, today's stick, 16 poses a place (prints only), read the same way
// `eager`: the map streamed every frame along the way the bus is really going (the probe streamed every third frame along the heading).
import { busClearance, ll, makeGame, manifest, newCity, pump, truth } from '../feel-sim/lib';
import { TurboDrive } from '@src/game/Turbo';
import { rivalTune } from '@src/rivals/rivals';

const what = process.argv[2] ?? 'throw', PER = +(process.argv[3] ?? 4), EAGER = process.argv.includes('eager');
const r1 = (v: number) => +v.toFixed(1);
let seed = 23;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const city = await newCity();
const PLACES: Array<[string, number, number]> = [['fidi', 37.7925, -122.401], ['nob hill', 37.7925, -122.4135], ['soma', 37.7785, -122.4056]];
const GEAR = ['Cruise', 'Express', 'Nonstop', 'Jet'];
const B = manifest.bounds as number[];
// (Input.applyStretch's curve, as tools/swerve/s_turns.ts has it)
const KNEE = 0.72, LEASH = 2.2;
function stickOf(dx: number, dy: number) {
  const px = 78;
  let d = Math.hypot(dx, dy);
  const max = LEASH * px;
  if (d > max) [dx, dy, d] = [(dx * max) / d, (dy * max) / d, max];
  if (d <= 5) return { sx: 0, sy: 0 };
  const s0 = (d - 5) / px, r = 1 - KNEE, s = s0 <= KNEE ? s0 : KNEE + r * Math.tanh((s0 - KNEE) / r);
  return { sx: (dx / d) * s, sy: (-dy / d) * s };
}
function game() {
  const drive = new TurboDrive([-1e9, -1e9, 1e9, 1e9]);
  drive.edgeless = true;
  const g = makeGame(city, drive);
  g.flight.swerve.on = true;
  return { g, drive, f: g.flight };
}
async function settle(G: ReturnType<typeof game>, px: number, pz: number, heading: number, rungs: number, dt: number) {
  const f = G.f;
  f.x = px;
  f.z = pz;
  f.heading = heading;
  f.glideSpeed = 0;
  await pump(city, f.x, f.z);
  f.y = city.obstacleAt(f.x, f.z) + 8;
  for (let i = 0; i < rungs; i++) G.drive.rung(1, f);
  for (let k = 0; k < 20 / dt && (k * dt < 3 || (rungs > 0 && !G.drive.engaged) || Math.abs(f.speed - (f.turbo.speed || f.speed)) > 1); k++) {
    G.g.frame(dt, { sx: 0, sy: 0, dragging: false });
    if (k % 6 === 0) await pump(city, f.x, f.z, f.height, f.fx, f.fz);
  }
}
/** A frame inside a surface: how deep, and whether the flight's own obstacle field (what it steers its floor by) had what's drawn there. */
function inside(f: { x: number; y: number; z: number; heading: number }, c: number) {
  const fx = Math.sin(f.heading), fz = -Math.cos(f.heading);
  let seen = true;
  for (const a of [-9, 0, 9])
    for (const b of [-2, 0, 2]) {
      const x = f.x + fx * a - fz * b, z = f.z + fz * a + fx * b, drawn = truth(city, x, z), known = city.obstacleAt(x, z, f.y);
      if (drawn > f.y - 2.5 && known < drawn - 0.5) seen = false;
    }
  return { c, seen };
}
const tally = () => ({ runs: 0, frames: 0, clip: 0, clipRuns: 0, lowest: Infinity, lifted: 0, liftMost: 0, out: 0, back: Infinity, unseen: 0, first: '' });
type Tally = ReturnType<typeof tally>;
function note(T: Tally, where: string, f: { x: number; y: number; z: number; heading: number }, c: number) {
  T.frames++;
  T.lowest = Math.min(T.lowest, c);
  if (c >= 0) return false;
  T.clip++;
  const i = inside(f, c);
  if (!i.seen) T.unseen++;
  if (!T.first) T.first = `${where}, ${r1(c)} m, the flight's field ${i.seen ? 'had' : 'lacked'} it`;
  return true;
}

let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(22)} ${JSON.stringify(o)}`);
};

if (what === 'throw' || what === 'base') {
  const R = rivalTune, dt = 1 / 30;
  const TIERS: Array<[string, number, number]> = [['shell', -1, R.soakThrow], ['smash', 1, 170], ['wreck', 2, 675], ['head-on', 3, 1350]];
  for (const [tname, tier, far0] of TIERS) {
    const T = tally();
    for (const [name, lat, lon] of PLACES) {
      const [x0, z0] = ll(lat, lon);
      for (let p = 0; p < PER; p++)
        for (const rungs of [0, 1, 2, 3]) {
          const px = x0 + (rand() - 0.5) * 700, pz = z0 + (rand() - 0.5) * 700, heading = rand() * Math.PI * 2, ang = rand() * Math.PI * 2;
          const G = game(), f = G.f;
          await settle(G, px, pz, heading, rungs, dt);
          // (rivalsBoot.hurtMe: thrown along the hit's line; a head-on's line is back the way the bus was going)
          const far = what === 'base' ? 0 : far0, air = R.air[Math.max(0, tier)];
          const ux = tier === 3 ? -f.fx : Math.sin(ang), uz = tier === 3 ? -f.fz : -Math.cos(ang), hx = f.x, hz = f.z;
          if (far > 0) f.shove(far, ux, uz, air, B);
          let y = f.y, t = 0, clip = false, e0 = 0, back = NaN;
          for (let k = 0; k < (air + 2) / dt; k++, t += dt) {
            G.g.frame(dt, { sx: 0, sy: 0, dragging: false });
            // (hitFx's hop, a short throw's: the flight carries it along the line)
            if (far > 0 && far <= 90 && t < air) {
              const kk = Math.min(1, (t + dt) / air), e = kk * kk * (3 - 2 * kk);
              f.y += 9 * (e - e0) * (kk < 0.5 ? 1 : -0.4);
              e0 = e;
            }
            if (EAGER || k % 3 === 0) await pump(city, f.x, f.z, f.height, EAGER ? (f.x - hx) / Math.max(1, Math.hypot(f.x - hx, f.z - hz)) : f.fx, EAGER ? (f.z - hz) / Math.max(1, Math.hypot(f.x - hx, f.z - hz)) : f.fz);
            if (note(T, `${name}, ${GEAR[rungs]}, ${t.toFixed(2)} s in`, f, busClearance(city, f))) clip = true;
            if (f.y - y > 12) {
              T.lifted++;
              T.liftMost = Math.max(T.liftMost, f.y - y);
            }
            y = f.y;
            if (far > 0 && Number.isNaN(back) && !f.shoving) back = ((f.x - hx) * ux + (f.z - hz) * uz) / far;
          }
          T.runs++;
          if (clip) T.clipRuns++;
          if (f.x < B[0] || f.z < B[1] || f.x > B[2] || f.z > B[3]) T.out++;
          // (how far back along the hit's line it ended, against how far it was thrown)
          if (tier === 3 && far > 0) T.back = Math.min(T.back, back);
        }
    }
    const o = { throws: T.runs, framesInside: T.clip, throwsWithOne: T.clipRuns, lowest: r1(T.lowest), framesTheFlightsFieldLacked: T.unseen, framesLiftedOver12m: T.lifted, mostInAFrame: r1(T.liftMost), endedOutsideTheMap: T.out, ...(tier === 3 && what === 'throw' ? { headOnBackAtLeast: `${Math.round(T.back * 100)} % of the throw` } : {}), first: T.first };
    if (what === 'base') console.log(`base, ${tname}'s poses, no throw: ${JSON.stringify(o)}`);
    else row(T.clip === 0 && T.lifted === 0 && T.out === 0 && (tier !== 3 || T.back >= 0.5), `throw, ${tname}`, o);
  }
}

if (what === 'hard') {
  // (the review's hard turns with a pull or a push, today's stick: the hard part off)
  const dt = 1 / 30;
  // (in the review's order, its level hard turn first as today's stick at the leash, so each pose is the review's)
  const THUMBS: Array<[string, [number, number]]> = [['hard, level', [172, 0]], ['hard, pulled', [124, 115]], ['hard, pushed', [124, -115]], ['skid, pulled', [150, 80]], ['skid, pushed', [150, -80]]];
  for (const [tname, th] of THUMBS) {
    const T = tally();
    for (const [name, lat, lon] of PLACES) {
      const [x0, z0] = ll(lat, lon);
      for (let p = 0; p < PER; p++) {
        const px = x0 + (rand() - 0.5) * 900, pz = z0 + (rand() - 0.5) * 900, heading = rand() * Math.PI * 2, rungs = p % 2, side = rand() < 0.5 ? -1 : 1, hold = 1 + rand() * 2;
        const G = game(), f = G.f;
        f.swerve.on = false;
        await settle(G, px, pz, heading, rungs, dt);
        let t = 0;
        for (let k = 0; k < (1 + 3 + 1.5) / dt; k++, t += dt) {
          G.g.frame(dt, t < 1 || t >= 1 + hold ? { sx: 0, sy: 0, dragging: false } : { ...stickOf(side * th[0], th[1]), dragging: true });
          if (EAGER || k % 4 === 0) await pump(city, f.x, f.z, f.height, f.fx, f.fz);
          note(T, `${name} pose ${p}, ${GEAR[rungs]}, ${t.toFixed(2)} s in`, f, busClearance(city, f));
        }
        T.runs++;
      }
    }
    console.log(`hard, ${tname}, today's stick: ${JSON.stringify({ poses: T.runs, framesInside: T.clip, lowest: r1(T.lowest), framesTheFlightsFieldLacked: T.unseen, first: T.first })}`);
  }
}

console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
