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
| `late` | in `end` only: true when it was a tap's, a hold begun with the Lob's ring up only because its lift reached the page late (its own time inside the 350 ms, within the tap slop). It ends cancelled, and `tap()` is asked in the same event, for the tap it was |

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
- **`end`** goes to whoever has the hold, and to every `{ watch: true }` handler. A watcher that doesn't have it sees `h.owner` naming someone else: reset what you kept for `h.id`, and don't fire. `cancelled` means the touch was lost, three fingers came down, or the page lost focus, or (`h.late`) the hold was a late tap's, which `tap()` hears next: don't fire on it.
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

A tap while a gear drives the bus at 225 m/s or more (Nonstop engaged, Jet, Turbo 1-3) is a Comet (`src/game/Comet.ts`): it flies ahead on an arc through the sky and lands on the bus's own line where the bus will be 1.5 s after the impact, in view, at least 1.9 km out and up high farther, to where the city is loaded (`shotReach`). From high up, where nothing in view takes it, it's the far Comet: it lands on that loaded edge and the view dips after it (`CometPlan.far`). Its blast is a tap's, so `life.blast` hears it with its whole circle as it hears a tap: life needs nothing new. `window.__game.comet` is the Comet, `cometState()` says what a tap would fire now.

- **A Comet takes the place of the aim's mover.** While one applies, what glints is its landing, and `aimer.life`'s mover (a car, a ferry, a plane, a captain's bus) is dropped for that frame (`life.glint(null)`): a tap there is the Comet, never a shot at the mover. Its blast still paints every mover in its circle through `life.blast`. So in Recess, where the ride forces the player's real `TurboDrive` into Nonstop or Jet (`feat/recess`'s `recessBoot.ts`), every tap becomes a Comet 0.5 to 1.3 km out, often past the fence, and a tap at a captain stops working. That's the next item's to settle.
- **`comet.clamp`** is Recess's: `comet.clamp = (p, kind) => { ...; return true }` gets the landing's point on the bus's line (`p.x`, `p.z`, world m) before anything is picked there, and `kind`, whose landing it is: `'comet'`, `'lob'` (the Lob asks it the same way, below) or `'cloud'` (the Cloudburst, not built). A Comet lands on that point (on a building whose landing is within 16 m of it, else the ground there); a Lob on the building nearest it. Under a clamp a Comet keeps `config.comet.reach` (1.9 km) and is never far. Move it inside the 750 m fence in place, or return false for no Comet (the tap is the classic shot, and the aim's mover, a captain too, is the aim's again). Null, the default, is the city's whole map. **The ask (the review of step 3, 2):** during a match, Recess sets `comet.clamp = () => false`, so a tap in a forced gear stays a tap at what glints, a captain included, and sets it back to null when the match ends. The clamp is asked when a landing is planned, once a stretch: a Comet already glinting when it's set holds for its stretch, 0.24 s at most, or half a second if a press latched it. A Comet in a match, inside the fence, is the producer's to ask for later.
- **A captain's Comet**: its own `new Comet(city, splatter)` for each captain (a Comet holds its landing, its side and its odometer from frame to frame), with `lens` left null (no in-view rule: that's the player's screen). With no lens it keeps `config.comet.reach` (1.9 km) and is never far: the city loads round the player's bus, not the captain's. Call `comet.track(captainFlight)` every frame, and `plan(captainFlight, fx, fz, out, gameTime)` when it would fire, with the captain's own `Flight` (a gear at speed in its `turbo.speed`) and its way flat (`fx`, `fz`). It returns a `CometPlan` (where it leaves and lands, the building, its arc, its flight time) or null. Fire it with `splatter.barf(p.x, p.z, tapOpts(comet.shotOf(p), captainFlight.y))` and `cometFx.launch(...)` for its streak, or ask here for a one-line helper.
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

A tap with the bus's body as you see it more than 25 degrees up throws the breath off the nose into the distance (`src/game/Lob.ts`): it climbs at the body's angle (at most 70: a tap past it is a Lob at 70), lands 1.6 km x sin 2θ along the aim's flat way, 1.03-1.6 km, on the nearest building there (a wall standing in its climb takes it on its face, 209 m out from Justin Herman Plaza in `s_lob`; one that wouldn't show moves out a stretch at a time, to 1.9 km), in view as the Comet must be, and a dotted ring shows where. From 1 km over the ground up (down to 700 m once a pull has had one), where nothing in view is near enough to take it, it's the far Lob: it lands where a throw from that height would, out to where the city is loaded (`shotReach`, about 2.75 km), at least 300 m past the bus at the impact, with a tap's circle from that height (`CometPlan.far`; the view dips after it, as after a far Comet). Never on the Moon. Under a clamp it lands where the clamp puts it. Its blast is a tap's, so `life.blast` hears it with its whole circle as it hears a tap: life needs nothing new, and its weather stays clear. `window.__game.lob` is the Lob, `lobState()` says what a tap would throw now.

- **A Lob takes the place of the aim's mover**, as a Comet does: while one is planned what glints is its landing, and `aimer.life`'s mover is dropped for that frame. Its blast carries `Blast.comet` (its plan, with `kind: 'lob'` and `angle`).
- **Where it applies with a Comet** (Nonstop and faster, the nose up), the Lob wins whenever one is planned (`config.lob.wins`; `chooseShot` in `Comet.ts`), every frame and at the tap. It never weighs against today's shot.
- **`comet.clamp`** is asked for a Lob's landing too, with `kind` `'lob'`: false means no Lob (the tap is today's, or the Comet's where that applies). It's asked when a landing is picked afresh, not while one is held: a Lob latched as the steering thumb lifts keeps its landing for 0.8 s (`config.lob.latch`), a press runs that on to 1.6 s from the lift at most (but not a press whose finger becomes a stroke, a flick's included), and one unlatched keeps it while the throw's stretch is the same. So a clamp set false as the thumb lifts still lets that Lob be thrown (a tap 0.37 s on, at Cruise and at Express, in the review's run). Set it before the pull, and no Lob is planned.
- **The ask for Recess**: during a match, `comet.clamp = () => false` (the standing ask above) keeps a nose-up tap the classic shot at what glints, a captain included. A clamp that tells the kinds apart can keep the Comet out and let a Lob land inside the fence (`kind === 'lob'`, moving `p` in): the producer's to ask for. A captain throws no Lob: `aimer.lob` is the player's.
- **Locks first**: `holds.tap()` is still asked before a tap fires, so a lock life or Recess holds takes a nose-up tap as it takes any other.
- **A Bomb never lobs**: while one charges (`aimer.bombing`) no Lob is planned, and no far Comet: its shot, its ring and what glints are a low Comet's or the tap's, and `aimer.life`'s mover is the aim's own, as before the far shots. `CometPlan.far` and `CometPlan.bow` (a Comet's sideways bow at its middle, a share of its chord) are new on the plan; `aimer.planned` is never a far one while a Bomb charges.
- **Never on Curb's street**: while the bus rolls there (`aimer.street` set, main.ts, per frame) no Lob is planned or latched, nose up or not: the tap is Curb's drive-by at the front that glints, as it is with no Lob.
- **The ask for life** (the Lob's world review, 5; read from the code, not run): people are sampled on the lawns within `LAWN_REACH`, 700 m of the bus (`src/life/Life.ts`), and a Lob comes down 1.03-1.6 km off (a wall in its climb nearer, 1.9 km at most; a far Lob from 1 km up out to about 2.75 km), so a park it lands on likely has nobody on its blankets to paint, and they come in grey as the bus nears. The ask: a reach that takes in a planned Lob's landing, as `CraterPaint.update`'s `far` does the Moon's craters. `aimer.lobPlan` (x, z) is where it will come down while one is planned, and the blast's `Blast.comet.kind === 'lob'` says one has.

## Sonic Boom and the Waterfall (the extras)

Both are behind their links, `&boom` and `&falls` (`docs/specs/shots/BUILT.md`, "The extras"). Neither needs anything new from life to work: each paints through `life.blast` as a tap does.

- **Sonic Boom** (`src/game/Boom.ts`): the flick into Turbo 3 stands a hoop a second ahead of the bus; as the bus nears it (0.25 s of flight before it threads it, about 0.75 s after the flick) the ring's blast is barfed, landing where the bus will be once the hoop has slammed onto it and its band blooms, about 1.5 km on from Jet's floor (more from higher up). Its blast carries `Blast.super` `{ kind: 'boom', charge: 1, id, inner }`: `life.blast` hears its whole circle, centre and radius as a tap's, and `inner` is the radius of its hole (0.75 of its radius), where no building or ground is painted. `window.__game.boom` is the Boom, `boomState()` says what it did last.
- **The Waterfall** (`src/fx/Falls.ts`): a tower hit 40 m up or more runs with paint, and as the runs reach the street a pool lands round its foot (the footprint's radius + 10 m, one hue, the tower's). The pool calls `life.blast(x, groundY, z, r, hue, { kind: 'falls', charge: 0, id }, arrive, faction)` on its own, after the tap's blast that struck the tower. While a Bomb's wide ground is still drawing, the pool's waits until that is due (`GroundPaint.wideDue`), so after a Bomb from high up its `arrive` can be later than the runs reaching the street: 2.5 s after a Bomb III from 600 m onto a 48 m tower lands. `window.__game.falls` is the Waterfall, its `stats` its counts.
- **The ask for life (`SuperTag.inner`)**: when `superTag.inner` is set, leave the movers within `inner` of the blast's centre alone, so a ring paints only the cars, people and boats under its band. Without it the whole disc's movers are painted, the hole's too. A pool's movers are all of its circle's, as now. Optional, life's call: cars driving through a pool for 20 s after it lands take its paint.
- **The ask for Recess (the producer's fifth call)**: `areas.hit` takes no square from a blast whose `super.kind` is `'boom'` or `'falls'`: the ring and the pool paint but take no ground in a match. A tap that struck the tower is a tap, its one hit on its square, as always. Until `areas.hit` honours it, `&boom` is off under `?recess` (main.ts: `boom.on = boomOn && !params.has('recess')`), so no ring can take a square every 10 s: drop that guard in the same commit that lands the ask. A pool reaches `life.blast` alone, never the Splatter's impact: if `areas.hit` hears only the Splatter's blasts, a pool needs no guard. The white's gate ("Not here yet") must swallow the flick before `TurboDrive.rung`, or the ring fires under it.

## Not here yet

- The flick's lunge and brake-hop in the white, and the white never shifting a gear (SHOTS.md, "Dodging"): the flight's, so the first account's, and the duel's dodge waits on it. Until then a dodge is a hard turn.
- The HOLD TO LOCK hint for the first boat in reach: one line from Recess or life through `controls.hud.toast`, once.
