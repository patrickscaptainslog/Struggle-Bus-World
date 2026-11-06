# Factions: what's built, steps 3, 4 and 7

*The second account, the night of 2026-11-05, on `feat/recess` cut from `main` 058217c. All of it is logic in Node: nothing draws, nothing plays, and nothing in the game calls it yet. The plan is [FACTIONS.md](FACTIONS.md); the area rules underneath are [STAGES.md](../STAGES.md) section 1, where FACTIONS.md and its decisions change them. Nothing here hangs on decisions 27 or 28.*

## Step 3, the beat: `src/factions/beat.ts`

- `Beat`: 84 a minute (decision 14), four to a bar, on the game's clock, so a pause stops it. `next(t)`, `next(t, 4)` for a bar's downbeat, `crossed(t0, t1)` for the beats a tick passes, `setBpm` that keeps the count, and `sync`/`toAudio` for the music's AudioContext. Two bars are 5.71 s: Possessed's "about six seconds".
- `Slots`: STAGES.md's city-wide cap. At most two changes start in any second, each on a beat, the rest on the next beats with room, never more than a bar late. At 84 a beat is 0.71 s, so any second holds two beats, and the cap comes to one change a beat. Past a bar, a full house still starts on that last beat.

## Step 4, the areas: `src/factions/areas.ts`

- **What an area is** goes through one switch, `Partition` (decision 28). `squares` is the only one built: 128 m, world-aligned, the key two 16-bit halves. The test runs the same rules over a stand-in partition of 384 m blocks.
- **Stages 1 to 4.** Stage 5, the god, stays out until decision 27 (`areaTune.top`).
- **Owner's hits:** an owner's ready hit is up; one while cooling, or at the top, is an encore.
- **Rival's hits:** a rival's ready hit is down, and at stage 1 it's the flip. One while cooling is a parry.
- **The wait:** five seconds between changes, whoever makes them.
- **Stage 4 takes two rival hits** (`hitsToDrop`). The first cracks it, and **an owner's hit heals the crack** (decision 16).
  - *My reading of "a hit on stage 4 or 5 restarts the five-second wait":* a crack and a heal each start the five seconds again, so a cracked area can't be knocked off at once, and a healed one can't be cracked again at once.
  - An owner's encores don't restart it. Otherwise an owner tapping away would keep a stage 4 safe forever.
- **Spills and Possessed's hiccups** claim grey at stage 1, ready at once, and never touch owned ground.
- **A super counts once an area.**
- **Every change lands on its beat**, through `Slots`.
- **Solo, nothing decays** (STAGES.md 1.3).
- **The save:** `strugglebus.areas.v1:<slug>`, 16 bytes an area, as STAGES.md 1.5 has it. The crack is the stage byte's top bit. A save it can't read changes nothing.
- **Not yet:**
  - the host: the tiles, the buildings' levels, `tArea`, the claim line and the debounced writes;
  - old saves seeded from painted buildings, which waits on step 1's owner on the paint.

## Step 7, Recess's brain: `src/recess/recess.ts`, `captain.ts`

**The arena.** A 1.5 km circle at a fixed step. There are three gears in the arena: Cruise, Express and Nonstop. The yaw is `config.flight.maxYawRate` at 30 m/s, falling as the square root of the speed, so it is never nothing.

**The lock.** A rival within 600 m and within 0.18 rad of the nose glints. The lock holds a little wider once it's on. A captain's breath goes at a bus only a full second after its glint. The sim enforces that whatever the brain says: earlier, the breath goes to the ground.

**The breath.**
- It leads the locked bus as it curves after it.
- In its last third of a second it goes white-hot and stops curving.
- A flick then hops the bus 30 m sideways. A flick there is a hop, not a gear, so no new gesture.
- A breath that hits no bus paints where it lands.

**What a hit does,** by the link's switch (`mode`):

- **Possessed** (decision 2; decision 3, Nonstop in the arena):
  - The bus jumps to Nonstop, and a flick down wheezes NO BRAKES.
  - The driver keeps the steering.
  - It hiccups the hitter's paint on each of the next eight beats.
  - Ridden out, the hitter glints for it from 1.2 km for 8 s, and its super is back.
- **Piñata:** six drops of the victim's paint, a tenth of a MEGA each for the hitter who flies through them. The ride is the burst, and the stop arm follows at once.
- **Bubbled:** three seconds still, popping as the hitter's paint. It's the one mode where the driver loses the steering: the plan's "it stops flight". It is the fallback, so the steering check leaves its three seconds out.

**The rules round a ride.**
- **The stop arm:** every ride ends with four seconds of it. Nobody can lock it, and its mouth is shut.
- **No ganging up:** only the ridden bus's own crew can lock it, and their breath washes the ride off.
- **A pair a third time:** the same pair a third time in two minutes bounces off.
- **WANTED:** three rides given without being ridden back, and a bus glints for every rival from 1.2 km.
- **The new player** (decision 18): rival breaths burst as sparkles until `firstWonder()`. Once, a captain gives them a one-bar ride, as the lesson.

**At the arena's edge** the bus is turned home *on top of* its own steering, never instead of it.

**The captains** have the player's hands and see what a player's screen shows: Learner, Rival and Veteran, by reaction, dodging, aim, hunting and wobble. They hunt or paint, rerolled every few seconds, and go after their avenger's mark first.

**Not here:**
- the open city's rules (Jet, the raider flung 2 km, the Crown);
- the Hearts at stage 5 (decision 27), and the bells and the scoreboard's camera;
- a teammate in Recess, which is one bus a side (the wash is built and tested on its own);
- all the drawing.

## The checks

- `node --no-warnings tools/factions/check.mjs`: the beat, the slots, the areas, the switch and the save, 11 rows.
- `node --no-warnings tools/recess/duels.mjs [3000]`:
  - every rule above one at a time, on scripted buses;
  - then 3,000 duels, in about 20 s here: a player's stand-in against one captain, or Recess's two, every mode, new players among them.
- **The duels fail when:**
  - anyone's turn isn't what their hands asked for;
  - a breath goes at a bus that wasn't glinting, or a captain's goes before its second;
  - a bus is ganged up on, given a third ride by one pair, ridden in its stop arm, or piled on;
  - a new player is ridden but for the one lesson;
  - a ride slows below Nonstop;
  - a hiccup changes owned ground;
  - a match doesn't replay from its seed.
- **They also check** that a Veteran rides the player more often than a Rival, and a Rival than a Learner.
