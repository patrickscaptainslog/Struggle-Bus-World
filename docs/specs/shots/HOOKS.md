# Shots: the hooks for life and Recess

Hold to aim is built on `feat/shots` (step 2 of the first account's list). This file is the one interface the shot code offers the second account, so lock-on for boats and planes (`src/life/`) and the bus-to-bus duel (`src/recess/`) can be built without editing the shot code. If something here is missing, ask in `docs/TODO.md` and the first account adds it.

It all lives in `src/game/Hold.ts`. `main.ts` makes one `Holds` and hands it nowhere yet: add one line where your boot runs, `life.holds(holds)` or whatever suits, in `main.ts`'s life or Recess block. That line is yours to add (main.ts's life and Recess lines are yours, the shot and flight lines ours). `window.__qa.holds` is the same object.

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

Helpers on `Holds`: `rayAt(sx, sy, out)` gives the ray under any screen point; `screenOf(worldPoint, out)` gives a world point's screen point (CSS px) and says whether it's on the screen, which is what the 48 px pick needs; `landing(ray, out, reach?)` marches a ray onto the city; `inSight(worldPoint)` says nothing of the city stands between the camera and it ("until ... a building hides it"); `bus(out)` is the player's bus now, for a captain's aim and the incoming marker. None of them allocate.

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
- **`holds.claim(name)`** takes the hold under way. The one that had it gets `lost`, so the Hose stops pouring the moment you claim. `holds.release(name)` lets it go to nobody (the finger stays down and nothing pours).
- **`end`** goes to whoever has the hold, and to every `{ watch: true }` handler. A watcher that doesn't have it sees `h.owner` naming someone else: reset what you kept for `h.id`, and don't fire. `cancelled` means the touch was lost, three fingers came down, or the page lost focus: don't fire on it.
- **A handler that throws** doesn't stop the game. Every call into a handler, and every homing shot's `target` and callbacks, is caught: the error is printed on the console once per handler (`Holds: handler 'name' threw`), `holds.stats.errors` counts them, and the Hose, the splats and the frame go on. A shot whose callback throws ends there.
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
| `target(out)` | required. Write where the target is now into `out` and return true; false: it's gone, and the shot flies on a beat and ends as a miss (`lost`). Called every frame |
| `speed` | m/s along its path. A boat at 1.5 km: about 500. A plane 12 km out: 3,000 or more to arrive in under 4 s |
| `turn` | the most it turns, rad/s. The lower, the easier to beat before the white |
| `white` | its last seconds (time to go = distance / speed): it goes white-hot and stops steering. SHOTS.md: 0.7, 0.45 at a full charge |
| `hitRadius` | metres, default 6 |
| `maxTime` | seconds before it ends as a miss, default 8 |
| `from`, `dir` | where it leaves from (default the bus's mouth) and its first heading (default straight at the target) |
| `faction`, `hue` | whose colours it flies in (default the player's) and which of the six |
| `belly` | it spends the belly: whatever is in it, as long as that's at least the Hose's 12 % (`hoseTune.minTank`), and the belly refills as after a tap. So a lock that took a hold mid-pour still fires (SHOTS.md: "Nothing is wasted"). Under 12 %, or with a breath under way, `fire` returns null and the bus coughs. Default true when `from` is unset (the player's shot), false otherwise (a captain's) |
| `whistle` | a whistle rises over its last second (for the shot at the player's bus) |
| `size` | the blob's size x |
| `onHit(at, shot)` | it reached the target. Paint, possess, whatever a hit does |
| `onWhite(shot)` | it went white-hot |
| `onMiss(at, shot, why)` | `dodged` (it passed the target in the white), `lost`, `ground` (it flew into the city), `time` |

It returns a `HomingShot` (`id`, `pos`, `dir`, `t`, `ttg`, `white`, `done`, `cancel()`), or null. `holds.shots` lists those in flight: the incoming marker reads it. At most four of the player's (`belly`) fly at once, and eight of everyone else's, each count its own; a player's shot refused for that coughs too (`holds.stats.refused`).

Before the white it leads the target (its velocity, smoothed), turning at most `turn`; a break before the white is followed, so too early fails, as SHOTS.md has it. In the white it flies straight, so a hard turn or a flick then beats it. A dodge is the target moving out of `hitRadius` of a straight line; how far a flick lunges the bus is the flight's, and comes with the rival lock (not built).

Example, the player's lock on a rival bus, and a captain's shot back:

```ts
holds.fire({
  target: (out) => rival.alive && (out.copy(rival.pos), true),
  speed: 420, turn: 2.2, white: charged ? 0.45 : 0.7, hitRadius: 7, faction: crew.faction,
  onHit: () => recess.possess(rival),
  onMiss: (_at, _s, why) => { if (why === 'dodged') recess.keepLock(rival, 2); },
});
holds.fire({
  from: captain.mouth, faction: captain.faction, belly: false, whistle: true,
  target: (out) => (holds.bus(out), true),            // the player's bus
  speed: 380, turn: 1.8, white: 0.7,
  onHit: () => recess.hitPlayer(captain),
});
```

## The Hose, which takes what you don't

A hold nobody takes is the Hose's (`src/game/Hose.ts`). It pours 40 m blasts under the finger from the bus's mouth on a lob (on the sky, or on the city past its 1,500 m reach, it pours as far as it reaches that way; from more than 1,500 m over the ground it coughs), a 3 s tank out of the belly the tap uses, refilling in 3 s once it stops. Every impact calls `life.blast` like a tap's, with `Blast.super` of kind `'hose'`, so movers in its circles are painted. A pour raises each building at most one level. `window.__qa.hoseState()` says what it's doing.

## The Comet (step 3)

A tap while a gear drives the bus at 225 m/s or more (Nonstop engaged, Jet, Turbo 1-3) is a Comet (`src/game/Comet.ts`): it flies ahead on an arc through the sky and lands 34 m beside where the bus will be 1.5 s after the impact, in view, at most 1.9 km out. Its blast is a tap's, so `life.blast` hears it with its whole circle as it hears a tap: life needs nothing new. `window.__game.comet` is the Comet, `cometState()` says what a tap would fire now.

- **A Comet takes the place of the aim's mover.** While one applies, what glints is its landing, and `aimer.life`'s mover (a car, a ferry, a plane, a captain's bus) is dropped for that frame (`life.glint(null)`): a tap there is the Comet, never a shot at the mover. Its blast still paints every mover in its circle through `life.blast`. So in Recess, where the ride forces the player's real `TurboDrive` into Nonstop or Jet (`feat/recess`'s `recessBoot.ts`), every tap becomes a Comet 0.5 to 1.3 km out, often past the fence, and a tap at a captain stops working. That's the next item's to settle.
- **`comet.clamp`** is Recess's: `comet.clamp = (p) => { ...; return true }` gets the landing's point on the bus's line (`p.x`, `p.z`, world m) before anything is picked there; it lands up to 50 m off that point, to a side. Move it inside the 750 m fence in place, or return false for no Comet (the tap is the classic shot, and the aim's mover, a captain too, is the aim's again). Null, the default, is the city's whole map. **The ask (the review of step 3, 2):** during a match, Recess sets `comet.clamp = () => false`, so a tap in a forced gear stays a tap at what glints, a captain included, and sets it back to null when the match ends. The clamp is asked when a landing is planned, once a stretch: a Comet already glinting when it's set holds for its stretch, 0.24 s at most, or half a second if a press latched it. A Comet in a match, inside the fence, is the producer's to ask for later.
- **A captain's Comet**: its own `new Comet(city, splatter)` for each captain (a Comet holds its landing, its side and its odometer from frame to frame), with `lens` left null (no in-view rule: that's the player's screen). Call `comet.track(captainFlight)` every frame, and `plan(captainFlight, fx, fz, out, gameTime)` when it would fire, with the captain's own `Flight` (a gear at speed in its `turbo.speed`) and its way flat (`fx`, `fz`). It returns a `CometPlan` (where it leaves and lands, the building, its arc, its flight time) or null. Fire it with `splatter.barf(p.x, p.z, tapOpts(comet.shotOf(p), captainFlight.y))` and `cometFx.launch(...)` for its streak, or ask here for a one-line helper.
- **`comet.lob`** is the Lob's slot (step 7): when it returns a shot and the Comet applies too, the farther landing wins (`chooseShot`).
- **`cometFx.streakOn`** is Streak's seam (step 5): while it returns true every Comet plays the full show.

## The Bomb (step 4)

With `&bomb` on the link, the flying thumb held still on the bus itself charges a Bomb (`src/game/Bomb.ts`): Bomb II shows at 0.69 s and Bomb III at 1.29, and the lift lets it go as MEGA's breath where the tap would land (at Nonstop and faster, where the Comet would), 1.4 or 1.8 times the tap's circle, each building in it jumping two or three stages, never past 3, and never asking the Lift. A lift before II is the tap. `holds.bomb` is its side for life and Recess (`src/game/Hold.ts`: a do-nothing one until main.ts sets it, and without `&bomb` every call does nothing). `window.__game.bomb` is the Bomb, `bombState()` says what it's doing.

- **`holds.bomb.gift(3)`**, after being hit: the next still hold on the bus is a Bomb III at 0.42 s (`aimHoldMs` and `aimLagMs`), one time, whatever the belly holds, aimed while it charges as a full belly's would be (where the tap or the Comet would land). `gift(2)` is a Bomb II. A second gift before the hold keeps the higher.
- **`holds.bomb.bank(0.1)`**, a caught drop: each 0.1 brings the next charge's tiers 0.12 s sooner (`config.bomb.bankGain`, 1.2 s for a bank of 1), never before the riser's 0.35 s; the bank is spent by the next Bomb let go.
- **`holds.bomb.charge`** (0 to 1, 1 at III) and **`holds.bomb.tier`** (0 none, 1 charging, 2, 3), read any frame.
- **`holds.bomb.watch({ tier(t), release(r), cancel(), tap() })`**, every method optional, returns its remover: `tier` as each shows (1 the charge began), `release({ tier, x, z, r, arrive, id })` when one is let go (where it lands in world m, its circle, the game time it lands on the Splatter's clock, its `SuperTag`'s id), `cancel` for a fizzle (moved off, three fingers, a lost touch, a hand-over, another thumb's tap), the belly kept, and `tap` for a charge lifted before II, which is the tap (its own breath follows): a watcher that heard `tier(1)` hears one of `release`, `cancel` or `tap` after it.
- **Its blast** carries `Blast.super` `{ kind: 'bomb', charge: 0.5 or 1, id }` and `Blast.jump` (2 or 3), so `life.blast` hears it with its whole circle as it hears a tap's; movers in it take one level, as the contract says. A Bomb at Comet range carries `Blast.comet` too.
- **The ask for Recess** (the producer's fourth call): `areas.hit(…, { superId, jump, cap: 3 })` on `feat/recess`. The aimed square jumps at once, past the 5 s wait, never past 3; a rival's square takes one hit; the grey squares in the circle spill at stage 1. It can read the release from `watch` or the blast's `super.kind === 'bomb'`.

## Sonic Boom and the Waterfall (the extras)

Both are behind their links, `&boom` and `&falls` (`docs/specs/shots/BUILT.md`, "The extras"). Neither needs anything new from life to work: each paints through `life.blast` as a tap does.

- **Sonic Boom** (`src/game/Boom.ts`): the flick into Turbo 3 lands a ring of paint where the bus will be 1.3 s on (more from higher up). Its blast carries `Blast.super` `{ kind: 'boom', charge: 1, id, inner }`: `life.blast` hears its whole circle, centre and radius as a tap's, and `inner` is the radius of its hole (0.75 of its radius), where no building or ground is painted. `window.__game.boom` is the Boom, `boomState()` says what it did last.
- **The Waterfall** (`src/fx/Falls.ts`): a tower hit 40 m up or more runs with paint, and as the runs reach the street a pool lands round its foot (the footprint's radius + 10 m, one hue, the tower's). The pool calls `life.blast(x, groundY, z, r, hue, { kind: 'falls', charge: 0, id }, arrive, faction)` on its own, after the tap's blast that struck the tower. `window.__game.falls` is the Waterfall, its `stats` its counts.
- **The ask for life (`SuperTag.inner`)**: when `superTag.inner` is set, leave the movers within `inner` of the blast's centre alone, so a ring paints only the cars, people and boats under its band. Without it the whole disc's movers are painted, the hole's too. A pool's movers are all of its circle's, as now. Optional, life's call: cars driving through a pool for 20 s after it lands take its paint.
- **The ask for Recess (the producer's fifth call)**: `areas.hit` takes no square from a blast whose `super.kind` is `'boom'` or `'falls'`: the ring and the pool paint but take no ground in a match. A tap that struck the tower is a tap, its one hit on its square, as always.

## Not here yet

- The flick's lunge and brake-hop in the white, and the white never shifting a gear (SHOTS.md, "Dodging"): the flight's, so the first account's, and the duel's dodge waits on it. Until then a dodge is a hard turn.
- The HOLD TO LOCK hint for the first boat in reach: one line from Recess or life through `controls.hud.toast`, once.
