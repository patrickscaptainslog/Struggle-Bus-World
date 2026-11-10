# Shots: the hooks for life and Recess

Hold to aim is built on `feat/shots` (step 2 of the first account's list). This file is the one interface the shot code offers the second account, so lock-on for boats and planes (`src/life/`) and the bus-to-bus duel (`src/recess/`) can be built without editing the shot code. If something here is missing, ask in `docs/TODO.md` and the first account adds it.

It all lives in `src/game/Hold.ts`. `main.ts` makes one `Holds` and hands it nowhere yet: add one line where your boot runs, `life.holds(holds)` or whatever suits, in `main.ts`'s life or Recess block. That line is yours to add (main.ts's life and Recess lines are yours, the shot and flight lines ours). `window.__game.holds` is the same object (`window.__qa` is the tools' settings, which the game reads).

## Since the second account's review of fd6d413

What changed in the hook (feat/shots `0eb3e61`, `70bc61b`, `74d01fe`; BUILT.md, "The second account's review of fd6d413"):
- **A homing shot leads from its launch (M80).** Give `holds.fire` a `vel(out)`, the target's velocity, for anything that moves: the shot leaves at where the two meet if both hold their lines, and before the white steers at that meeting. Fired from inside its white window it flies straight from its first frame, so without `vel` it flies at where the target was and misses anything moving (at 420 m/s and a white of 0.7 s, inside 294 m). With it, a target that holds its line is hit, as long as `hitRadius` covers a frame of the target's travel at 30 fps (its speed / 30: 9 m for a plane at 250 m/s, where the default 6 m missed 1 or 2 of 8; `hitRadius` below) and it's reached inside `maxTime` (8 s, 3.4 km at 420 m/s), and a hard turn or a flick in the white still beats it. A captain's shot at the player takes `vel: (out) => holds.busVel(out)`, new beside `holds.bus`.
- **`target` is asked first (m81).** `fire` calls `target` (and `vel`) before it spends anything; one that throws refuses the shot: `fire` returns null, the belly is untouched, `holds.stats.errors` counts it, and the player's shot (`belly`) coughs; a captain's is refused silently.
- **A target never there ends as `lost` (m82)**, false at the launch and on the first frame, after the same beat as one that goes. It flew on along the bus's heading for `maxTime`.
- **A lock's shot refills as after a tap (m83)**, 1.6 s from empty, a shot that took a hold mid-pour too, where it took the Hose's 3 s.
- **A release tells the one that had the hold (n80).** `holds.release(name)` calls its `lost`, as a claim does, so releasing the Hose's hold stops its pour. A handler releasing its own hold hears its own `lost`.
- `window.__game.holds` and `window.__game.hoseState()`, not `window.__qa` (m80). A tap while the Hose pours now coughs (m84).

## What a hold is

A finger that lands off the bus's lane (where a drag looks) and stays within 12 px for 350 ms (`inputTune.aimHoldMs`) becomes a hold. The hold begins 70 ms later (`inputTune.aimLagMs`), on a frame after one that saw it, so it begins at about 0.42-0.45 s: a lift that reaches the page late is still the tap its own time says. A still finger lifted before its hold began is a tap, and a finger that moved first looks, as before. The lane and the flicks are untouched. While a hold is down nobody steers, so the bus flies straight; a second thumb landing in the lane still flies.

The `Hold` object (one, filled in place every frame; keep the reference if you like):

| Field | What it is |
|---|---|
| `id` | a serial, new each hold |
| `down` | true while the finger is on the glass; false in `end` |
| `x`, `y`, `x0`, `y0` | where the finger is now and where it landed, CSS px of the canvas, +y down |
| `dragX`, `dragY` | how far it has moved since it landed (CSS px, +y down) |
| `held`, `aimed` | seconds since it landed, and since its hold began (wall clock, like a thumb): `aimed` is about `held` - 0.42 |
| `ray` | the ray under the finger: `ox, oy, oz` the camera, `dx, dy, dz` a unit direction (world m) |
| `hit`, `point` | where that ray first meets the city (a roof, a tree, the ground, the water) within 6 km of the camera, when `hit` |
| `range` | metres from the bus to `point` (Infinity without a hit) |
| `owner` | the name of the handler that has it, or null |

Helpers on `Holds`: `rayAt(sx, sy, out)` gives the ray under any screen point; `screenOf(worldPoint, out)` gives a world point's screen point (CSS px) and says whether it's on the screen, which is what the 48 px pick needs; `landing(ray, out, reach?)` marches a ray onto the city; `inSight(worldPoint)` says nothing of the city stands between the camera and it ("until ... a building hides it"); `bus(out)` is the player's bus now, for a captain's aim and the incoming marker, and `busVel(out)` its velocity, for a captain's shot's `vel`. None of them allocate.

## Taking a hold

Add a handler. Every method is optional.

```ts
const off = holds.add({
  name: 'lock',
  start(h) { /* true: it's mine */ },
  move(h, dt) { /* every frame while the finger is down */ },
  lost(h) { /* it was mine, and another handler took it */ },
  end(h, cancelled) { /* the finger lifted */ },
  tap() { /* a tap is about to splat: true takes it */ },
}, { watch: false });
```

- **`start`** is asked once, the moment the hold begins, in the order handlers were added. The first to return true has it and nobody after is asked. The Hose is added with `{ last: true }`, so it's always asked last: a hold you don't take pours.
- **`move`** runs every frame for whoever has the hold. With `{ watch: true }` it runs for you on every hold, whoever has it: a lock that waits for a plane to come under the finger.
- **`holds.claim(name)`** takes the hold under way. The one that had it gets `lost`, so the Hose stops pouring the moment you claim. `holds.release(name)` lets it go to nobody (the finger stays down and nothing pours): the one named, if it has the hold, gets `lost` too, as on a claim, so a release of the Hose's hold stops its pour (the review of fd6d413, n80). Releasing your own hold, expect your own `lost`.
- **`end`** goes to whoever has the hold, and to every `{ watch: true }` handler. A watcher that doesn't have it sees `h.owner` naming someone else: reset what you kept for `h.id`, and don't fire. `cancelled` means the touch was lost, three fingers came down, or the page lost focus: don't fire on it.
- **A handler that throws** doesn't stop the game. Every call into a handler, and every homing shot's `target`, `vel` and callbacks, is caught: a handler's error is printed on the console once per handler (`Holds: handler 'name' threw`), a shot's every time (`Holds: a homing shot threw`), `holds.stats.errors` counts them all, and the Hose, the splats and the frame go on. A shot whose callback throws ends there. `fire` calls `target` (and `vel`) first, before anything is spent: one that throws there refuses the shot, `fire` returns null and the belly is untouched; the player's shot coughs, a captain's says nothing (m81).
- **`tap`** is asked before every tap splats (in the order added). Return true and nothing splats: fire your own shot instead. That's how "the lock holds 4 s, so your next taps go to the same target" is built.

Example, a lock on a ferry (the pick is yours; the numbers are SHOTS.md's):

```ts
let locked: string | null = null, lockUntil = 0;
holds.add({
  name: 'boat-lock',
  start(h) {
    const boat = life.pickNear(h.x, h.y, 48, holds);   // yours: nearest mover within 48 px (holds.screenOf)
    if (!boat || boat.range > 1500) return false;     // not a boat in reach: the Hose has it
    locked = boat.key;
    return true;                                       // the Hose never pours
  },
  move(h) { if (h.aimed >= 0.55) life.glintLock(locked); },
  end(h, cancelled) {
    if (cancelled || !locked) return;
    fireAt(locked, h.aimed >= 0.55 ? 1 : 0.3);         // a lift before the clack homes weakly
    lockUntil = performance.now() + 4000;
  },
  tap() { return !!locked && performance.now() < lockUntil && (fireAt(locked, 1), true); },
});
```

A plane that comes under a resting finger mid-pour (the Hose has been pouring, so the belly is part drained: the lock's shot takes what's left, below):

```ts
holds.add({
  name: 'plane-lock',
  move(h) { if (h.owner !== 'plane-lock' && life.planeNear(h.x, h.y, 48, holds)) holds.claim('plane-lock'); },
  end(h, cancelled) { if (h.owner === 'plane-lock' && !cancelled) fireAtPlane(); },   // a watcher hears every hold's end
}, { watch: true });
```

## Firing a homing shot

`holds.fire(opts)` launches a blob that steers at a moving target. Its flight is ours; who it's aimed at, and what a hit does, are yours.

| Option | What it is |
|---|---|
| `target(out)` | required. Write where the target is now into `out` and return true; false: it's gone, and the shot flies on a beat and ends as a miss (`lost`). One false at the launch and on the shot's first frame, never there, ends the same way (m82). Called at the launch and every frame |
| `vel(out)` | the target's velocity now, world m/s, into `out`. Give it for anything that moves (a boat on its lane, a rival's flight, the player's bus for a captain): the shot's first heading goes at where the two meet if both hold their lines, and before the white it steers at that meeting. Without it the shot learns the velocity from `target`'s frames, and one fired from inside its white window (closer than `speed` x `white`: 294 m at 420 m/s and 0.7 s) flies at where the target was and misses anything moving (the review of fd6d413, M80). Called after each `target` that returns true |
| `speed` | m/s along its path. A boat at 1.5 km: about 500. A plane 12 km out: 3,000 or more to arrive in under 4 s |
| `turn` | the most it turns, rad/s. The lower, the easier to beat before the white |
| `white` | its last seconds (time to go = distance / speed): it goes white-hot and stops steering. SHOTS.md: 0.7, 0.45 at a full charge |
| `hitRadius` | metres, default 6. The hit test is the frame's target against the shot's path that frame, so a target moving fast misses by up to a frame of its travel: give at least its speed / 30, the floor's frame at 30 fps (a plane at 250 m/s: 9) |
| `maxTime` | seconds before it ends as a miss, default 8 |
| `from`, `dir` | where it leaves from (default the bus's mouth) and its first heading (default at the target: where it meets it with `vel`, where it is without) |
| `faction`, `hue` | whose colours it flies in (default the player's) and which of the six |
| `belly` | it spends the belly: whatever is in it, as long as that's at least the Hose's 12 % (`hoseTune.minTank`), and the belly refills as after a tap (1.6 s from empty, a lock that took a pour too: m83). So a lock that took a hold mid-pour still fires (SHOTS.md: "Nothing is wasted"). Under 12 %, or with a breath under way, `fire` returns null and the bus coughs. Default true when `from` is unset (the player's shot), false otherwise (a captain's) |
| `whistle` | a whistle rises over its last second (for the shot at the player's bus) |
| `size` | the blob's size x |
| `onHit(at, shot)` | it reached the target. Paint, possess, whatever a hit does |
| `onWhite(shot)` | it went white-hot |
| `onMiss(at, shot, why)` | `dodged` (it passed the target in the white), `lost`, `ground` (it flew into the city), `time` |

It returns a `HomingShot` (`id`, `pos`, `dir`, `t`, `ttg`, `white`, `done`, `cancel()`), or null. `holds.shots` lists those in flight: the incoming marker reads it. At most four of the player's (`belly`) fly at once, and eight of everyone else's, each count its own; a player's shot refused for that coughs too (`holds.stats.refused`).

It leaves led, at where it meets the target (with `vel`). Before the white it leads the target (`vel`'s, or else its velocity learnt from its frames, smoothed), turning at most `turn`; a break before the white is followed, so too early fails, as SHOTS.md has it. In the white it flies straight, so a hard turn or a flick then beats it, and a target that holds its line is hit, with `hitRadius` at least its speed / 30 and within `maxTime` (`s_hold --review`: the review's table, 150 to 800 m, every cell, and a plane lock at 3,000 m/s and 9 m on a plane at 250 m/s, 3 to 12 km, at eight launch phases, at 30 and 60 fps). A dodge is the target moving out of `hitRadius` of a straight line; how far a flick lunges the bus is the flight's, and comes with the rival lock (not built).

Example, the player's lock on a rival bus, and a captain's shot back:

```ts
holds.fire({
  target: (out) => rival.alive && (out.copy(rival.pos), true),
  vel: (out) => out.copy(rival.vel),                   // yours: the rival's velocity, world m/s
  speed: 420, turn: 2.2, white: charged ? 0.45 : 0.7, hitRadius: Math.max(7, rival.vel.length() / 30), faction: crew.faction,   // a frame of its travel at 30 fps
  onHit: () => recess.possess(rival),
  onMiss: (_at, _s, why) => { if (why === 'dodged') recess.keepLock(rival, 2); },
});
holds.fire({
  from: captain.mouth, faction: captain.faction, belly: false, whistle: true,
  target: (out) => (holds.bus(out), true),            // the player's bus
  vel: (out) => holds.busVel(out),                     // and its velocity
  speed: 380, turn: 1.8, white: 0.7,
  onHit: () => recess.hitPlayer(captain),
});
```

## The Hose, which takes what you don't

A hold nobody takes is the Hose's (`src/game/Hose.ts`). It pours 40 m blasts under the finger from the bus's mouth on a lob (on the sky, or on the city past its 1,500 m reach, it pours as far as it reaches that way; from more than 1,500 m over the ground it coughs), a 3 s tank out of the belly the tap uses, refilling in 3 s once it stops. Every impact calls `life.blast` like a tap's, with `Blast.super` of kind `'hose'`, so movers in its circles are painted. A pour raises each building at most one level. `window.__game.hoseState()` says what it's doing. A tap while it pours doesn't splat, and the bus coughs (`hose.tapWhilePouring()`, which main.ts asks before anything splats).

## The Comet (step 3)

A tap while a gear drives the bus at 225 m/s or more (Nonstop engaged, Jet, Turbo 1-3) is a Comet (`src/game/Comet.ts`): it flies ahead on an arc through the sky and lands 34 m beside where the bus will be 1.5 s after the impact, in view, at most 1.9 km out. Its blast is a tap's, so `life.blast` hears it with its whole circle as it hears a tap: life needs nothing new. `window.__game.comet` is the Comet, `cometState()` says what a tap would fire now.

- **A Comet takes the place of the aim's mover.** While one applies, what glints is its landing, and `aimer.life`'s mover (a car, a ferry, a plane, a captain's bus) is dropped for that frame (`life.glint(null)`): a tap there is the Comet, never a shot at the mover. Its blast still paints every mover in its circle through `life.blast`. So in Recess, where the ride forces the player's real `TurboDrive` into Nonstop or Jet (`feat/recess`'s `recessBoot.ts`), every tap becomes a Comet 0.5 to 1.3 km out, often past the fence, and a tap at a captain stops working. That's the next item's to settle.
- **`comet.clamp`** is Recess's: `comet.clamp = (p, kind) => { ...; return true }` gets the landing's point on the bus's line (`p.x`, `p.z`, world m) before anything is picked there, and `kind`, whose landing it is: `'comet'`, `'lob'` (the Lob asks it the same way, below) or `'cloud'` (the Cloudburst, not built). A Comet lands up to 50 m off that point, to a side; a Lob on the building nearest it. Move it inside the 750 m fence in place, or return false for no Comet (the tap is the classic shot, and the aim's mover, a captain too, is the aim's again). Null, the default, is the city's whole map. **The ask (the review of step 3, 2):** during a match, Recess sets `comet.clamp = () => false`, so a tap in a forced gear stays a tap at what glints, a captain included, and sets it back to null when the match ends. The clamp is asked when a landing is planned, once a stretch: a Comet already glinting when it's set holds for its stretch, 0.24 s at most, or half a second if a press latched it. A Comet in a match, inside the fence, is the producer's to ask for later.
- **A captain's Comet**: its own `new Comet(city, splatter)` for each captain (a Comet holds its landing, its side and its odometer from frame to frame), with `lens` left null (no in-view rule: that's the player's screen). Call `comet.track(captainFlight)` every frame, and `plan(captainFlight, fx, fz, out, gameTime)` when it would fire, with the captain's own `Flight` (a gear at speed in its `turbo.speed`) and its way flat (`fx`, `fz`). It returns a `CometPlan` (where it leaves and lands, the building, its arc, its flight time) or null. Fire it with `splatter.barf(p.x, p.z, tapOpts(comet.shotOf(p), captainFlight.y))` and `cometFx.launch(...)` for its streak, or ask here for a one-line helper.
- **The Lob** has taken `comet.lob`'s slot: it's `aimer.lob` now, below.
- **`cometFx.streakOn`** is Streak's seam (step 5): while it returns true every Comet plays the full show.

## The Bomb (step 4)

With `&bomb` on the link, the flying thumb held still on the bus itself charges a Bomb (`src/game/Bomb.ts`): Bomb II shows at 0.69 s and Bomb III at 1.29, and the lift lets it go as MEGA's breath where the tap would land (at Nonstop and faster, where the Comet would), 1.4 or 1.8 times the tap's circle, each building in it jumping two or three stages, never past 3, and never asking the Lift. A lift before II is the tap. `holds.bomb` is its side for life and Recess (`src/game/Hold.ts`: a do-nothing one until main.ts sets it, and without `&bomb` every call does nothing). `window.__game.bomb` is the Bomb, `bombState()` says what it's doing.

- **`holds.bomb.gift(3)`**, after being hit: the next still hold on the bus is a Bomb III at 0.42 s (`aimHoldMs` and `aimLagMs`), one time, whatever the belly holds, aimed while it charges as a full belly's would be (where the tap or the Comet would land). `gift(2)` is a Bomb II. A second gift before the hold keeps the higher.
- **`holds.bomb.bank(0.1)`**, a caught drop: each 0.1 brings the next charge's tiers 0.12 s sooner (`config.bomb.bankGain`, 1.2 s for a bank of 1), never before the riser's 0.35 s; the bank is spent by the next Bomb let go.
- **`holds.bomb.charge`** (0 to 1, 1 at III) and **`holds.bomb.tier`** (0 none, 1 charging, 2, 3), read any frame.
- **`holds.bomb.watch({ tier(t), release(r), cancel(), tap() })`**, every method optional, returns its remover: `tier` as each shows (1 the charge began), `release({ tier, x, z, r, arrive, id })` when one is let go (where it lands in world m, its circle, the game time it lands on the Splatter's clock, its `SuperTag`'s id), `cancel` for a fizzle (moved off, three fingers, a lost touch, a hand-over, another thumb's tap), the belly kept, and `tap` for a charge lifted before II, which is the tap (its own breath follows): a watcher that heard `tier(1)` hears one of `release`, `cancel` or `tap` after it.
- **Its blast** carries `Blast.super` `{ kind: 'bomb', charge: 0.5 or 1, id }` and `Blast.jump` (2 or 3), so `life.blast` hears it with its whole circle as it hears a tap's; movers in it take one level, as the contract says. A Bomb at Comet range carries `Blast.comet` too.
- **The ask for Recess** (the producer's fourth call): `areas.hit(…, { superId, jump, cap: 3 })` on `feat/recess`. The aimed square jumps at once, past the 5 s wait, never past 3; a rival's square takes one hit; the grey squares in the circle spill at stage 1. It can read the release from `watch` or the blast's `super.kind === 'bomb'`.

## The Lob

A tap with the bus's body as you see it more than 25 degrees up throws the breath off the nose into the distance (`src/game/Lob.ts`): it climbs at the body's angle (at most 70: a tap past it is a Lob at 70), lands 1.6 km x sin 2θ along the aim's flat way, 1.03-1.6 km, on the nearest building there, in view as the Comet must be, and a dotted ring shows where. Its blast is a tap's, so `life.blast` hears it with its whole circle as it hears a tap: life needs nothing new, and its weather stays clear. `window.__game.lob` is the Lob, `lobState()` says what a tap would throw now.

- **A Lob takes the place of the aim's mover**, as a Comet does: while one is planned what glints is its landing, and `aimer.life`'s mover is dropped for that frame. Its blast carries `Blast.comet` (its plan, with `kind: 'lob'` and `angle`).
- **Where it applies with a Comet** (Nonstop and faster, the nose up), the farther landing wins (`chooseShot` in `Comet.ts`), every frame and at the tap. It never weighs against today's shot.
- **`comet.clamp`** is asked for a Lob's landing too, with `kind` `'lob'`: false means no Lob (the tap is today's, or the Comet's where that applies).
- **The ask for Recess**: during a match, `comet.clamp = () => false` (the standing ask above) keeps a nose-up tap the classic shot at what glints, a captain included. A clamp that tells the kinds apart can keep the Comet out and let a Lob land inside the fence (`kind === 'lob'`, moving `p` in): the producer's to ask for. A captain throws no Lob: `aimer.lob` is the player's.
- **Locks first**: `holds.tap()` is still asked before a tap fires, so a lock life or Recess holds takes a nose-up tap as it takes any other.
- **A Bomb never lobs**: while one charges (`aimer.bombing`) no Lob is planned, and its shot is the Comet's or the tap's.
- **Never on Curb's street**: while the bus rolls there (`aimer.street` set, main.ts, per frame) no Lob is planned or latched, nose up or not: the tap is Curb's drive-by at the front that glints, as it is with no Lob.
- **The ask for life** (the Lob's world review, 5; read from the code, not run): people are sampled on the lawns within `LAWN_REACH`, 700 m of the bus (`src/life/Life.ts`), and a Lob comes down 1.03-1.6 km off, so a park it lands on likely has nobody on its blankets to paint, and they come in grey as the bus nears. The ask: a reach that takes in a planned Lob's landing, as `CraterPaint.update`'s `far` does the Moon's craters. `aimer.lobPlan` (x, z) is where it will come down while one is planned, and the blast's `Blast.comet.kind === 'lob'` says one has.

## Sonic Boom and the Waterfall (the extras)

Both are behind their links, `&boom` and `&falls` (`docs/specs/shots/BUILT.md`, "The extras"). Neither needs anything new from life to work: each paints through `life.blast` as a tap does.

- **Sonic Boom** (`src/game/Boom.ts`): the flick into Turbo 3 stands a hoop a second ahead of the bus; as the bus nears it (0.25 s of flight before it threads it, about 0.75 s after the flick) the ring's blast is barfed, landing where the bus will be once the hoop has slammed onto it and its band blooms, about 1.5 km on from Jet's floor (more from higher up). Its blast carries `Blast.super` `{ kind: 'boom', charge: 1, id, inner }`: `life.blast` hears its whole circle, centre and radius as a tap's, and `inner` is the radius of its hole (0.75 of its radius), where no building or ground is painted. `window.__game.boom` is the Boom, `boomState()` says what it did last.
- **The Waterfall** (`src/fx/Falls.ts`): a tower hit 40 m up or more runs with paint, and as the runs reach the street a pool lands round its foot (the footprint's radius + 10 m, one hue, the tower's). The pool calls `life.blast(x, groundY, z, r, hue, { kind: 'falls', charge: 0, id }, arrive, faction)` on its own, after the tap's blast that struck the tower. `window.__game.falls` is the Waterfall, its `stats` its counts.
- **The ask for life (`SuperTag.inner`)**: when `superTag.inner` is set, leave the movers within `inner` of the blast's centre alone, so a ring paints only the cars, people and boats under its band. Without it the whole disc's movers are painted, the hole's too. A pool's movers are all of its circle's, as now. Optional, life's call: cars driving through a pool for 20 s after it lands take its paint.
- **The ask for Recess (the producer's fifth call)**: `areas.hit` takes no square from a blast whose `super.kind` is `'boom'` or `'falls'`: the ring and the pool paint but take no ground in a match. A tap that struck the tower is a tap, its one hit on its square, as always. Until `areas.hit` honours it, `&boom` is off under `?recess` (main.ts: `boom.on = boomOn && !params.has('recess')`), so no ring can take a square every 10 s: drop that guard in the same commit that lands the ask. A pool reaches `life.blast` alone, never the Splatter's impact: if `areas.hit` hears only the Splatter's blasts, a pool needs no guard. The white's gate ("Not here yet") must swallow the flick before `TurboDrive.rung`, or the ring fires under it.

## The Torpedo (life's, with one line in the shot code's block)

SHOTS.md, "The shots": a shot that comes down on open water runs along the surface at the nearest boat. It's life's (`src/life/Torpedo.ts`), and it needed one hook in the shot code, the smallest there is, for the first account to review:

```ts
// main.ts, the Splatter's fx, `miss:` (the block was one expression; it's now three statements, the first two as they were)
miss: (pos, hue, comet) => {
  if (comet) cometFx.miss(pos, hue, comet, simTime, cometBus.set(flight.x, flight.y, flight.z), busVel());
  else particles.splash(pos, hue, 0.6);
  life?.torpedo(pos, hue);
},
```

Nothing in `src/game` changed. Life's own block in main.ts gives it what it draws with, once: `life.torpedoOn({ faction, dealHue, bus, water, splash, fling })`: the Splatter's faction and `dealHue`, `holds.bus`, water by the Splatter's own test (`city.groundAt(x, z) < config.splat.missWaterY`), and the particles' `splash` and `fling`.

- **What it does.** From where the breath came down it picks the nearest ferry or sailboat within 300 m (`torpedoTune.reach`) that it has clear water to (land looked for every 20 m of the way; a ferry at its pier is still had, within 60 m of it), and runs at it at 130 m/s, homing on the boat as it moves, 5 s at the most: spray at its head every 0.07 s and a wake behind it, a ribbon in the marks' pool that fades in 1.6 s. There, the boat is painted as a locked shot paints it (`life.torpedoHit`: a fresh boat takes the hue at level 1 and the hue is dealt on, a painted one goes up a level), with a crown, and its wake runs in the one colour, twice as wide, for 30 s. With no boat in reach it skips twice on the way it was thrown (from the bus to where it came down), 70 m then 45, a blob flung and a crown at each landing, and stops short of a shore. A run that land cuts off fizzes there.
- **How many.** Four at once at the most, and no two within 0.35 s (`torpedoTune.max`, `gap`), so the Hose poured on the water sends about three a second, not one a blob.
- **The miss carries no faction**, so a torpedo paints as the Splatter's faction now (`splatter.faction`), the player's. Nothing in `src/recess` calls the Splatter, so a captain's paint never reaches `miss` and the player's torpedo in a match is the player's; that's to be seen on the release candidate, where life and Recess first meet. One for the first account to know if `miss` ever gains callers.
- **The refund stays.** The Splatter still gives back half the belly on a water miss (`config.splat.missRefund`), whether or not the torpedo then finds a boat. SHOTS.md has water "stop being a miss": taking the refund back when a boat is hit is the shot code's, so the first account's call, or the producer's. Life can say so: `life.torpedoes.qa.hits` counts them, and a callback is a line if it's wanted.
- **The Comet's water miss** keeps its own splash and soft boom (`cometFx.miss`), and the torpedo runs from under it.
- **Checked** in Node on a hand-made snapshot, `node --no-warnings tools/life/torpedo.mjs` (9 rows): the run and its hit, the skips, the shore, a ferry at its pier, a car never picked, the gap and the cap, a run cut off by land, the wake's show and a plane's ribbon. Not flown in a browser on this branch yet: `window.__game.life.torpedoes` is the thing, its `qa` its counts.

## Parade (life's; nothing in the shot code)

SHOTS.md, "The shots": cars painted from the street honk and fall in behind the bus, up to six. All of it is life's (`src/life/Parade.ts`; `docs/specs/earth/LIFE.md`, "Parade"), and nothing of yours changed: it hears of a paint landing from life's own `land`, and of the bus on the street from `life.curbRoll`, which your Curb flight already calls each frame. Three things are yours to pick up:

- **The lens.** The line is behind the bus, where the street's camera sits: the first car's middle is about 15 m behind the bus's, the sixth's about 55 m (six semis, 150 m). `life.parade.count` is the cars in the line, the leaping ones too. A lens that stands back a little for each, or a look behind that finds them, is yours; nothing asks for it yet.
- **The honk** is a stand-in on your kit, `src/life/paradeSfx.ts` (`paradeHonk(kit, t, place, seed)`: two square reeds a third apart through a bandpass, a step up a five-note scale by the place in the line; a seventh car one low sour note). main.ts's life block plays it from `life.paradeOn({ honk })`. Re-voice it or take it into `src/audio`: it's one line there.
- **In a match** nothing: Curb is off there (`off: ... params.has('recess')`), so the Parade never leads.

Checked in Node, `node --expose-gc --no-warnings tools/life/parade.mjs` (10 rows).
## The duel, as built on these (the second account's, `feat/recess`, 2026-11-09)

`src/recess/Duel.ts` is Recess's side of the hold, as `src/life/Lock.ts` is life's. Nothing in the shot code changed for it. What it leans on, so a change here doesn't break it quietly:

- **`white` is read live.** A captain's shot is fired with `white: 0` and the duel sets `white` on the options it passed, each frame, once the shot's time to go is under its window (a level's, in real seconds whatever the bus closes at). `stepShot` reads `o.white` each frame today: keep that, or give `HomingOpts` a `white(shot)` callback and the duel moves to it.
- **The dodge is the duel's, by rule, until the flight's own lands** ("Not here yet", below). In the white a flick (`controls.flickGate`, so no gear hears it) or a hard turn (the steering thumb's stretch changed by 0.6 since the shot went white; 0.3 for a match's first) slides the shot's target off its line over a quarter second, and the hook's own `dodged` miss follows. The flick's show is `Duel.frame` moving the bus: 40 m on for a flick up, 24 m back and 6 m up for a flick down. When the flight has its own lunge and brake-hop, the duel drops its move and keeps the rule.
- **Captains' shots are the hook's**: `from` the captain, `belly: false`, `whistle: true`, `maxTime: 6`, the player's bus as `target` and `holds.busVel` as `vel`. Never more than one a captain, so the cap of eight is far off.
- **The player's lock** is a handler named `recess-lock` (not a watcher: a rival is never taken mid-pour). It reads `h.held` (the finger's whole time down) for its clack at 0.55 s and its full charge at 1 s, and fires with `belly: true` at the lift: 420 m/s, 2.2 rad/s, 0.7 s white (a full charge 1.2 times as fast, 1.5 times the size, 0.45 s white; a lift before the clack 0.8 of the speed and 0.3 of the turn). `tap()` sends the next 4 s of taps at the same captain.
- **Borrowed sounds, yours to voice**: the lock's clack is `audio.bombTier(2)` and the full charge `audio.bombTier(3)`; "a captain has you" is `audio.homingWhistle(seconds)` at its glint. Both are passed in from main.ts's Recess lines (`clack`, `tone`), so a sound of their own is a one-line swap.
- **In a match the Comet and the Lob are off**: main.ts's `comet.clamp = () => !recess.playing` never asks the `kind`, so the Lob's kind is covered with the Comet's (your ask). A tap in any gear or nose is a tap at what glints, and a tap at a rival bus is a splash for show (85 m of paint on its square, no ride): only a locked shot possesses.
- **Your street signs draw over a captain and its ring** (`tools/recess/screen.mjs`'s `duel-lock.png`: WEBSTER ST over a captain at the clack). In a match a sign within a tag's box could fade or stand back: yours to pick.
- **A rival dead ahead is in the bus's lane**, where a hold flies and can't lock (`Input.inLookZone` false). The kickoff puts both captains about 10 degrees off the nose and well above the lane, so it rarely bites; if the phone says it does, the fix is the lane's (a still finger on a tagged bus aims even there), so yours.

The brain's side (`src/recess/recess.ts`): `Recess.duel` on makes a captain's breath at the player's bus only said (`'aim'`, which the duel answers with the shot); `aimedHit(from, to)` lands a shot that arrived, at the next step, by the rules a breath lands by; `lunge(id)` is a captain's dodge; `recessTune.firstLock` (3.6 s) and `firstGap` (4 s) keep the first contact to the easiest captain.

## Swerve (the second account's stand-in, `feat/swerve`, 2026-11-10)

The producer approved the handling of `docs/specs/flight/SWERVE.md` on 2026-11-10 ("Let's build everything but the gods for now") while the first account was out. So the producer can fly it, it's built as a stand-in behind `?swerve`, in `src/swerve/`, laid over the flight from outside. `Flight.ts`, `CameraRig.ts`, `Turbo.ts` and `Controls.ts` are untouched. It's yours to take into the flight properly, and to drop when you have.

What it reaches of yours, so a change doesn't break it quietly:

- **`Flight.turbo.yaw`, `.speed`, `.rate`**, after `controls.preFlight` has written them and before the flight's steps: the hard turn and the swoop multiply `yaw`; a skid scales `speed` and raises `rate` to 6 while it slides; the long swipe's brake raises `rate` until the speed is Cruise's.
- **`Flight.speedScale`**, lowered while a skid slides with no gear in (`SuperSplat.update` puts it back to 1 each frame, after the flight's steps, as it always did).
- **`Flight.heading`**, written as a skid grips: over 0.3 s the slip goes into it. And `Flight.speed`, held up to 20 m/s in a slide. `Flight.fullness` set to 0 by the wave.
- **`config.flight.bungeeHz` and `config.camera.yawHz`**, raised in the hard part of the stick and put back to what they were when it's out of it. A tuner's change to either is taken as the new base.
- **`TurboDrive.rung(-1, flight)`**, called until the gear and the level are 0, for the long swipe (so its events fire, a rung each).

What it asks of your files, each marked `?swerve` where it stands:

| Where | What |
|---|---|
| `main.ts`, the boot | `swerveMod` beside `recessMod`; `bootSwerve({...})` before life's lock; `controls.flickGate` wrapped, so the long swipe's own lift is no flick |
| `main.ts`, the frame | `swerve?.pre(dt, st, off)` before the flight's steps and `swerve?.post(dt)` after them |
| `main.ts`, the bus's pose | `swerve?.pose(pose)` after `controls.pose` (the stop arm on the brake: `mouth` 0.13, since the arm goes with the door); the `eul.set` line takes `swerve.pitch`, `swerve.slip` and `swerve.roll` |
| `main.ts`, the look and the aim | `rig.setLook(st.look.on && !swerve?.swiped, ...)`; `aimer.lookYaw = rig.aimYaw + (swerve?.slip ?? 0)` |
| `Input.ts` | `inLookZone` is public: the long swipe starts off the lane. Its own pointer listeners sit on the canvas beside yours, passive, and touch no state of yours |

What a proper build would do that this can't: the slip as the flight's own field, so the Comet, the Lob, the Hose and the speed lines follow the nose or the way as each should (today only a tap's aim does); the swipe read in `Input` with the other gestures; a stop arm pose of its own; the camera looking into a turn; real sounds for the squeal, the grip's hiss and the brake's clunk (`src/swerve/swerveSfx.ts` are stand-ins on the kit).

Its checks: `tools/swerve/` (`s_turns.ts` and `s_city.ts` under `tools/feel-sim/run.mjs`, `s_swipe.ts` under `tools/controls-sim/run.mjs`, `smoke.mjs` in a browser). SWERVE.md, section 7, says what each row holds.

## Not here yet

- The flick's lunge and brake-hop in the white, and the white never shifting a gear (SHOTS.md, "Dodging"): the flight's, so the first account's, and the duel's dodge waits on it. Until then a dodge is a hard turn.
- The HOLD TO LOCK hint for the first boat in reach is in, life's (`Lock.ts`, through `controls.hud.toast`, once a page). In a match the duel says its own after the first dodge (`Duel.ts`).
