# NOSE: the speed goes where the nose points

The producer, 2026-11-01: "I need a way to point upwards, and turn on turbo - which I currently can't do. While we're at it, I want to be able to fly essentially straight down, now I can only fly down at an angle."

**State.** On `feat/nose`, off main bf7df01. Nothing here has run on a phone: the numbers below are this laptop's fixed-step flights, and the feel is the phone's to judge.

## The rule

Flight used to move the bus forward at `speed` and move `y` on a separate `vy`, so a gear or the boost only ever flattened the path: full pull in Jet was 450 forward and 80 up, 10 degrees.

Now there is a path. On any dive, and on a pull with a gear or the boost, `speed` is the speed along the path and `Flight.nose` is its angle. `vy` is `speed * sin(nose)`, and what that leaves goes over the ground (`Flight.ground`). The nose follows the stick at `noseRate`: that is the only lag, so nothing lurches forward on the way.

- **The stick sets the angle.** `noseUp * pull^noseCurve` up, `noseDown * push^noseCurve` down.
- **Getting on and off moves nothing.** On: `speed` becomes the length of the velocity the bus really has, `nose` its angle. Off: `speed` is what is going over the ground. Letting go arcs the bus level with its speed kept, and past 2 degrees the classic hold takes over.
- **A limit turns the nose.** The flare and the ceiling cap `vy`, and the rest of the speed goes forward, so the bottom of a dive is a swoop and the top of a climb a level-off. The capped `vy` writes the nose back, so the nose is always the way the bus is really going, and when the limit lifts it comes back at its own pace.
- **A floor can arrive all at once.** A carve toward a tower, or a gear's floor on a shift up low, lands a floor on a steep dive. The cap turns the speed forward on that step, and only then does the path hand over, so none of the speed goes with it.
- **The flare** is `max(diveFlare, speed / diveFlareT)`: 16 m/s² at 48 m/s as ever, and a pull-out takes about 3 s at any speed. It starts about 1.5 x the speed above the floor: 148 m at 98 m/s, 672 m at 450.
- **The ceiling's** soft band is `max(ceilingSoft, speed * ceilingSoftT)`. It reads the speed, not `vy`: a band that shrank with the capped `vy` would let go of it. A deck overhead lowers the ceiling the same way, and that limit wins over the flare.
- **The plain pull doesn't change.** No gear and no boost, it runs the old climb branch: 40 m/s up, 13 forward, at any height. Skimming, the hold, the surge at the floor and the bob are the old code too. Only the dive changes.
- **The boost let go with the stick still pulled** flies the plain pull's own path, 42 m/s at 72 degrees, so it lands on the plain climb's numbers with nothing jumping.
- **Height decides nothing here.** It only says when a gear can engage, as before. A fast climb is a gear pointed up.

## What the bus and the view do

`Flight.pitch` shows the real path up to `pitchMax`, 80 degrees: all of it on the path, and on the plain pull as hard as the stick is held, so a light pull looks as it always did. Skimming roofs and hills keeps the old gentle pitch. The breath's rear-up keeps its envelope and starts from where the bus is, up to `pitchMax`: a breath on a plain full pull moves the bus about 8 degrees, and doesn't flop it level.

A dive tips the view over the bus: from `diveFrom` degrees of nose down, up to a camera `diveElevation` above the bus and a view pitched `divePitch` down, easing at `diveRate`. It is yoke-driven, and it arrives at exactly 0: released and settled, the rig is what it was. The place the bus is heading for stands about 62 to 65 % down the frame, under the bus at about 57 %, above the thumb. The climb keeps the old camera: the ground falling away is the picture.

`Flight.velocity()` is the true velocity: speed lines, the boom's hoop and vapor ring, the breath's and sparks' launch. HUD mph, the boom, `speedK`, the wheels and the audio read the along-path speed: going up at 450 m/s reads as that. The altitude look-ahead keeps `speed`, because a swoop turns all of it forward. Steering scales with `speed`, the bank's carve and the steering round towers with `ground`.

## The numbers

Measured in the game with the real stick, full belly, at a fixed step:

| Stick | Up (m/s) | Forward (m/s) | Path (deg) | Bus's pitch (deg) |
|---|---|---|---|---|
| Full pull | 40 | 13.2 | 72 | 72 |
| Full pull, Express | 111.6 | 9.8 | 85 | 80 |
| Full pull, turbo on, Cruise | 145 | 12.7 | 85 | 80 |
| Full pull, Jet | 448 | 39 | 85 | 80 |
| Full push | -98.2 | 8.6 | -85 | -80 |
| Full push, Express | -111.6 | 9.8 | -85 | -80 |
| Full push, turbo on, Cruise | -145 | 12.7 | -85 | -80 |
| Full push, Jet | -448 | 39 | -85 | -80 |

The stick at a quarter, a half and three quarters of its travel gives 6, 27 and 54 degrees, both ways.

Jet from the street on full pull: engaged within 3 s, 14,900 m 35.8 s after the shift, stopped at 15,000.0 m about 38 s after it, no overshoot, then 450 m/s forward. A full dive in plain flight from 3 km takes about 31 s. Jet from 12 km takes about 28 s, flares from about 670 m over its 150 m floor and comes out level at 450 m/s.

## What's tunable

All on the tuner (`?tune`), under flight and camera, read live:

- `flight.noseUp`, `noseDown` (85), `noseCurve` (1.3), `noseRate` (2.6)
- `flight.diveFlareT` (3), `ceilingSoftT` (1.5), `pitchMax` (80)
- `camera.diveFrom` (30), `diveElevation` (78), `divePitch` (72), `diveRate` (1.5)

## Left on purpose

- **The breath doesn't follow the nose.** It still flies 20 degrees below the heading, so in a steep dive the glint and the landing are off the top of the frame. Aiming down the path is a new rule, the producer's.
- **Going straight up or down the bus is end-on.** At full dive the lens looks down the bus's length and the hero shows its tail, about 12 px of a 240 px frame, against 33 in a hold at height. It reads, and a bigger hero would be a new rule too.
- **A gear with a height holds the city's level of detail, and so does any speed past the surge.** Dive in Jet and the blocks at the bottom stay coarse until the gear comes out, as they do on any low run in it. Express holds nothing: it is the surge.
- **Under a deck** the chase camera still stands over it and hides the bus (BRIDGES, step 5).
- **A floor landing on a dive turns the velocity in one frame.** The fall stops at once and the speed goes forward. The position doesn't jump and the bus's pitch eases, as it always did at a floor step. If it reads badly on the phone, the fix is a limit on how fast a cap may turn the nose.
- **The phone's questions.** Whether 2.6 per s feels right on a thumb, whether 85 degrees comes on too soon, and how far the view may tip are for the tuner on the phone.
