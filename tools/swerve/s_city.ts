// The skid over the real city (docs/specs/flight/SWERVE.md, "Solid before it's flown"): the real City, Flight, TurboDrive, Aimer and Splatter with ?swerve's
// handling on (Flight.swerve), no browser: node tools/feel-sim/run.mjs ../swerve/s_city.ts [skids=1000]
//   skids    from `skids` poses over eight neighbourhoods (the towers of the Financial District and Nob Hill among them), in Cruise, Express, Nonstop and Jet:
//            1.5 s straight, a skid to a side for up to 2 s, let go at a moment of its own, 1.5 s on. On no frame is the bus's underside through a roof, a wall
//            or a tree as they're drawn (the route check's own measure, tools/feel-sim/s_route.ts), and it is thrown up by the floor no more often than the same
//            thumb throws it today, the handling off
//   wave     a skid at Cruise with a full belly, eased off: the wave lands beside the bus's way, off the outside of the slide, paints what stands there as a
//            tap does, and the belly is spent; one with the belly empty throws none
// Prints a row each, and exits 1 if one fails.
import { busClearance, config, ll, makeGame, newCity, pump } from '../feel-sim/lib';
import { TurboDrive } from '@src/game/Turbo';
import { stickParts } from '@src/game/Input';
import { swerveTune, wavePlace } from '@src/game/Swerve';

const N = +(process.argv[2] ?? 1000);
const PLACES: Array<[string, number, number]> = [
  ['fidi', 37.7925, -122.401],
  ['nob hill', 37.7925, -122.4135],
  ['soma', 37.7785, -122.4056],
  ['mission', 37.7599, -122.4148],
  ['twin peaks', 37.7544, -122.4477],
  ['sunset', 37.755, -122.49],
  ['marina', 37.8015, -122.4368],
  ['castro', 37.7609, -122.435],
];
const manifestBounds = [-1e9, -1e9, 1e9, 1e9];
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const city = await newCity();
let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(26)} ${JSON.stringify(o)}`);
};

/** A game with the gears and, `on`, the flight's handling, as main.ts has them: the stick's parts go into the flight's steps. */
function game(on: boolean) {
  const drive = new TurboDrive(manifestBounds);
  drive.edgeless = true;
  const g = makeGame(city, drive);
  g.flight.swerve.on = on;
  const sw = on ? g.flight.swerve : null;
  const inp = { sx: 0, sy: 0, dragging: false, hard: 0, skid: -Infinity };
  const frame = (dt: number, dx: number | null) => {
    inp.dragging = dx !== null;
    inp.sx = dx === null ? 0 : Math.sign(dx) * 0.997;
    stickParts(Math.abs(dx ?? 0), Infinity, inp);
    g.frame(dt, inp);
  };
  return { g, drive, sw, frame };
}

// ---------------------------------------------------------------- skids
{
  const dt = 1 / 30, per = Math.ceil(N / PLACES.length);
  for (const [name, lat, lon] of PLACES) {
    const [x0, z0] = ll(lat, lon);
    const tally = { on: { frames: 0, clip: 0, min: Infinity, thrown: 0, skids: 0 }, off: { frames: 0, clip: 0, min: Infinity, thrown: 0, skids: 0 } };
    let worst = '';
    for (let p = 0; p < per; p++) {
      const px = x0 + (rand() - 0.5) * 900, pz = z0 + (rand() - 0.5) * 900, heading = rand() * Math.PI * 2, rungs = Math.floor(rand() * 4), side = rand() < 0.5 ? -1 : 1, letGo = 0.2 + rand() * 1.8;
      for (const on of [true, false]) {
        const G = game(on), f = G.g.flight, T = on ? tally.on : tally.off;
        f.x = px;
        f.z = pz;
        f.heading = heading;
        f.glideSpeed = 0;
        await pump(city, f.x, f.z);
        f.y = city.obstacleAt(f.x, f.z) + 8;
        for (let i = 0; i < rungs; i++) G.drive.rung(1, f);
        // (into its gear, turning nowhere: the map streams in under it as it goes)
        for (let k = 0; k < 20 / dt && (k * dt < 3 || (rungs > 0 && !G.drive.engaged) || Math.abs(f.speed - (f.turbo.speed || f.speed)) > 1); k++) {
          G.frame(dt, null);
          if (k % 6 === 0) await pump(city, f.x, f.z, f.height, f.fx, f.fz);
        }
        let y = f.y, t = 0;
        for (let k = 0; k < (1.5 + 2 + 1.5) / dt; k++, t += dt) {
          G.frame(dt, t < 1.5 ? null : t < 1.5 + letGo ? side * 172 : null);
          if (k % 4 === 0) await pump(city, f.x, f.z, f.height, f.fx, f.fz);
          const c = busClearance(city, f);
          T.frames++;
          if (c < T.min) T.min = c;
          if (c < 0) {
            T.clip++;
            if (on && !worst) worst = `${name} pose ${p}, ${['Cruise', 'Express', 'Nonstop', 'Jet'][rungs]}, ${t.toFixed(2)} s in, ${c.toFixed(1)} m`;
          }
          // (thrown: lifted more than 12 m in a frame, by the hard floor or a floor that came all at once)
          if (f.y - y > 12 + Math.max(0, f.vy) * dt) T.thrown++;
          y = f.y;
          if (G.sw?.sliding) T.skids++;
        }
      }
    }
    const a = tally.on, b = tally.off;
    row(a.clip <= b.clip && a.thrown <= b.thrown + 1 && a.skids > 0, `skids, ${name}`, { poses: per, withIt: { clipFrames: a.clip, lowest: +a.min.toFixed(1), thrown: a.thrown, framesSliding: a.skids }, today: { clipFrames: b.clip, lowest: +b.min.toFixed(1), thrown: b.thrown }, first: worst });
  }
}

// ---------------------------------------------------------------- the wave
for (const full of [true, false]) {
  const [x0, z0] = ll(37.7599, -122.4148);
  const G = game(true), f = G.g.flight, dt = 1 / 60;
  f.x = x0;
  f.z = z0;
  f.heading = 0;
  f.glideSpeed = 0;
  await pump(city, f.x, f.z);
  f.y = city.obstacleAt(f.x, f.z) + 8;
  for (let k = 0; k < 180; k++) G.frame(dt, null);
  if (!full) f.fullness = 0.2;
  let waves = 0, bellyAt = NaN;
  const at = { x: 0, z: 0 }, bus = { x: 0, z: 0, rx: 0, rz: 0 };
  G.sw!.onEvent = (ev) => {
    if (ev !== 'wave') return;
    waves++;
    // (as swerveBoot.ts throws it)
    wavePlace(f, G.sw!.dir, at);
    Object.assign(bus, { x: f.x, z: f.z, rx: Math.cos(f.heading), rz: Math.sin(f.heading) });
    G.g.splatter.barf(at.x, at.z, { drop: Math.max(0, f.y - city.groundAt(at.x, at.z)), travel: 0.3, stream: true, hitStop: 0, radius: swerveTune.waveRadius });
    f.fullness = 0;
    bellyAt = f.fullness;
  };
  const n0 = G.g.events.length;
  for (let k = 0; k < 0.8 / dt; k++) G.frame(dt, 172);
  // (eased back inside, three frames, then let go: since stage 2 a lift alone is a quiet grip, the belly kept for the tap down the nose, SWERVE.md section 4)
  for (let k = 0; k < 3; k++) G.frame(dt, 110);
  for (let k = 0; k < 1.5 / dt; k++) {
    G.frame(dt, null);
    await pump(city, f.x, f.z);
  }
  const hits = G.g.events.slice(n0).filter((e) => e.ev === 'impact') as Array<{ pos: number[]; count: number; r: number }>;
  const hit = hits[0];
  // (the slide turned right, so its outside is the bus's left: the blast's middle is on that side of its way)
  const offSide = hit ? (hit.pos[0] - bus.x) * bus.rx + (hit.pos[2] - bus.z) * bus.rz : NaN;
  if (full) row(waves === 1 && !!hit && hit.count > 0 && bellyAt === 0 && offSide < 0, 'wave, a full belly', { waves, buildingsPainted: hit?.count ?? 0, radius: hit?.r, offTheOutsideM: +(-offSide).toFixed(1), bellyAtTheWave: bellyAt });
  else row(waves === 0 && !hit, 'wave, the belly empty', { waves, impacts: hits.length });
}
void config;
console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
