# Shots: what's built

`docs/specs/shots/SHOTS.md` (on `feat/earth`) is the plan the producer approved on 2026-11-06. This file says what of it stands on `feat/shots`, how to fly it, and what's left. The first account's list, steps 1 to 3.

## Step 1: MEGA off, the faction button, the bigger splat

**MEGA off.** No MEGA button, no charge meter, no charge from any press: the HUD's, Space, or a still finger on the screen. A press held any length is a tap when it lifts, and the HOLD cue never comes. `&mega` on a link wakes all of it as it was, the gesture sim's rows included.
- `Input.megaOn` (`src/game/Input.ts`) gates the charge, and `Controls` sets it, with `Hud.megaOn` and the coach's lesson, from `&mega`.
- `src/game/SuperSplat.ts` stays whole, asleep. Its pouring code, the firehose section (`startFirehose`, `stepHose`, `hoseAim`, `impactNow`, `impact`), with `Splatter.barf`'s `hose` and `bands`, is where the Hose starts from. The mega blast's look is what each faction's Bomb III takes.

**The faction button, on links with `?crew`.** The player's faction crest sits at the top left, 44 px, under the notch. It's clear of the canvas's edge band, and far from the bus's lane. A tap opens all five crests in a row under it, the player's rimmed in bus yellow. A tap on one switches at once, and the faction's name shows for a moment. A tap anywhere else closes the row.
- New paint is the new faction's, and paint already down keeps its owner (a later hit by another faction takes it, as the stores have done since factions step 1).
- `src/game/crew.ts` is the player's faction's one source. `main.ts` sets the street's `Splatter.faction` from it, and with it `?moon`'s craters and open ground, and the breath's particles. The flight (`sky/moonrun.ts`) sets `MoonPaint.faction`. `&paintas` sets its own page's start; a tap on the crest after it is the newer choice, and wins.
- A page on a phone that has seen `?crew` keeps the button there for good, with the last choice (`localStorage` `strugglebus.crew.v1`). Without `?crew` ever seen, nothing changes.
- `crew.locked` is Recess's hook ("In Recess, it works only between matches"). Set, the crest dims, and a tap on it says AFTER THE MATCH.
- The crests are drawn in each faction's own palette rows (`src/ui/crest.ts`): Rainbow's arc, Atlantis's trident over waves, the Elderwood's pine, Hyperglow's bolt, Inferno's flame.

**The bigger splat.** `config.splat.blastRadius` goes from 60 to 85, so a tap from the rooftops paints every building inside 85 m, and from higher up the circle grows as before (twice as wide at 300 m). The building cap now grows with the blast's area: 140 at 85 m (it was 40 at 60 m), up to 240 from high up. Each tap still climbs one level.
- Every blast but a mover's own hit calls `life.blast` with its whole circle, centred on the ground under the impact, so a hit on a tower's roof takes the street at its foot.
- What a circle holds, round 60 random buildings each (median / 90th percentile / most): Alamo Square 57 / 82 / 90 at 85 m, the Sunset 63 / 71 / 75, downtown 30 / 68 / 80. At 60 m the 90th percentile was already 42-43 against a cap of 40. From 300 m up (170 m) the Sunset's 90th percentile is 273 against the 240 cap, so the very highest taps over dense housing still leave a few houses grey.

What it costs, on this laptop's GPU (an Intel UHD 620), in one build, today's numbers against step 1's. Eight blocks round Alamo Square, each tapped three times, the bus held at 160 m:

| | 60 m, 40 a tap | 85 m, step 1 |
|---|---|---|
| Buildings painted | 159 | 242 |
| Draws in the painted view | 108 | 109 |
| Triangles in the painted view | 1.10 M | 1.33 M |
| Of them, the rooftop gardens | 481 K, 24 draws | 712 K, 24 draws |
| The buildings' saved paint | 3.1 KB | 4.8 KB |
| The ground's saved tiles | 8, 43.9 KB | 9, 35.0 KB |

The draws hold. The triangles go up by the gardens alone, and that is where the 1.5 M ceiling is closest: eight blocks at level 3 came to 1.33 M. The gardens' budget (`feat/gardens`) is the answer to that, and this step doesn't touch `src/world/props/sprouts.ts`. On the Moon's paint store (`tools/moon/paint-check.mjs hours`, an hour at Jet) the pictures go from about 9,600 to 14,600, and 14.7 to 18.5 MB of the 64 MB budget.

## Step 2: hold to aim, the hook, the Hose

**Hold to aim** (`968017b`, `src/game/Input.ts`). A finger landing off the lane, where a drag looks, that stays within 12 px for 350 ms aims (`inputTune.aimHoldMs`). Lifted sooner with nobody flying, it's a tap: the ruling's 0.3 s, with 0.3 to 0.35 s counting as one. A finger that moves first still looks. The lane and the flicks are untouched.
- From then until it lifts it's the aim. `Input.state.aim` follows the finger, a drag never moves the view, and the lift is the release (`onAimStart`, `onAimEnd`), never a tap or a flick. Since the review's fixes the aim begins 70 ms after the 350 ms (`inputTune.aimLagMs`), and a still finger lifted before it began is a tap (below).
- Only one finger aims at a time. Two fingers landing together stay a two-finger tap.
- Nobody steers while it aims, so the bus flies straight. A thumb landing in the lane beside it still flies.
- Off on the Moon and in the flight, which have no Hose (`Input.aimOn`, carried with their hands).
- The first run's hint gets a fourth line, HOLD HIGH UP TO AIM. A save that saw the hint before that line gets the line alone, once (`TAUGHT.aim`).

**The hook** (`6b5ad0e`, `src/game/Hold.ts`, written up in `HOOKS.md`).
- A hold gives the screen point, its ray and where that ray meets the city, how long it has lasted, the drag and the release.
- Handlers can take a hold at its start or partway through, and can take the next taps. A hold nobody takes goes to the Hose.
- `Holds.fire` is the homing shot. It leads a moving target with a turn limit and a speed, and goes white-hot and stops steering in its last `white` seconds. The player's shot spends the belly; a captain's needs none and can whistle.

**The Hose** (`4519a4b`, `src/game/Hose.ts`, built from SuperSplat's firehose, which stays asleep). A hold on the city that nobody takes pours 40 m blasts under the finger, and a drag sweeps them.
- A blast lands each time the stream has moved 0.45 of its radius, or every 0.3 s while it stays put, at most 10 a second.
- Every blast calls `life.blast` as a tap does, tagged kind `'hose'`. One pour raises each building at most one level (`BarfOpts.pour`).
- One belly with the tap: a full tank pours 3 s, draining only while the stream flows. Once the pour ends, it refills in 3 s from empty (`Flight.rechargeSeconds`).
- A hold with under 0.12 of a tank coughs and pours nothing. A pour that runs dry sputters and coughs steam, and that hold pours no more.
- The tank reads on the bus, with no new button. The belly band drains, the bus rises as it lightens, the hiss and drone climb in pitch as it empties, the stream thins over its last 0.35 s, and the refill ends on the belly's ready chime.
- The stream lobs from the mouth onto a point that eases after the finger. The bus slows to 0.72 at Cruise and Express (a gear drives through), rears and shudders.
- It pours in the faction's colours: the breath's palette and the hitter's paint.

**Fixes after looking on the GPU** (`6d685e0`).
- A hold is armed by the first frame that sees a still finger past 350 ms and starts on a later frame, as the MEGA press was. A lift queued behind one slow frame is still a tap. The page's first touch has a 220 ms long task, and there a CDP tap read as a 0.18 s pour. (The review's fixes take this further: `40c28bb`.)
- The homing shot's blob got bigger: a white core and a longer tail. At 500 m it had been a dotted thread.

**The checks** (on `6d685e0`).
- `tsc` clean at each commit. `vite build` exit 0, and `iosfloor` says "iOS 15.0 parses every chunk".
- Gesture sim 826 of 826 (332 rows), layout sim 300 of 300, hold sim (`tools/controls-sim/s_hold.ts`) 31 of 31.
- `owner-check`: its first run failed one row, the Moon's pictures by the journal, which this step doesn't touch. The rerun passed every row.

The flight on this laptop's GPU (Intel UHD 620): real CDP touches on the real page, Western Addition from the rooftops, Inferno and Rainbow, each a fresh page. Its frames and numbers are kept on the laptop, outside the repo.
- The hint showed its four lines.
- A still hold off the lane poured a lobbed stream in the faction's colours, onto the point under the finger. The tank ran dry at 3.03 s and 3.00 s, with 11 impacts each.
- The pour raised 28 (Inferno) and 35 (Rainbow) buildings, none of them more than one level.
- Programs stayed at 35 before and after. Draws peaked at 142 and triangles at 0.98 M, while it poured and after. Median frame was 26-32 ms, and median work 5-8 ms with the pour or without.
- A homing shot at a point 420 m ahead, crossing at 20 m/s, went white at 0.90 s and 0.92 s, and hit at 1.56 s and 1.57 s.
- A tap off the lane after all that splatted, with no pour.
- Two 404s turned up in the console on both pages. I didn't find which files they were.

## Step 3: the probe and the Comet

This step's plan was written on the laptop from SHOTS.md, outside the repo; where this departs from it, it says so below.

**The probe** (`34e4293`, `tools/controls-sim/s_shots.ts`). A tap at every rung and pose over the real baked city, through the real Flight, TurboDrive, TurboLens, CameraRig, Aimer and Splatter, at 1/60 and 1/30 s: 122 rows. The rungs are School Zone, Cruise, Express, Nonstop, Jet and Turbo 1-3, and Jet and Turbo 1-3 at 16 km. The poses are level over the Western Addition (Alamo Square, east) at the rung's floor (the roofs, Nonstop's 60 m, 150 m from Jet up), at 300, 1,500 and 6,000 m; the floor downtown (Market from Van Ness); over water (north from Fort Mason); the nose 30 and 75 degrees up; a 45 degree dive tapped at 800 m.
- It taps through `tools/feel-sim/loop.ts`, which gains the drive and takes main.ts's own barf (`Aim.tapOpts`), so a Node tap is the page's. The lens projects as the page's does at 393 x 852 (`PixelPipeline`'s `lensFov`).
- A row says what the tap fired, when it landed, where (from the tap, ahead of the bus at the impact, on what), its screen point at the tap and at the impact (in frame, how far above the bus, clear of the HUD's top band), when the bus passes it, the radius, the buildings painted and any raised two, and whether its tile was in.
- `tools/controls-sim/shots-baseline.json` is today's shot, run on c09e415 with only the probe's refactors in. Once the Comet is in, every row that isn't a Comet must be the baseline's.

What today's shot does, at 60 fps (the plan worked these out by hand; the probe measured them):

| | Lands from the tap | Ahead of the bus at the impact | Passed after the impact | On the screen at the impact |
|---|---|---|---|---|
| Nonstop, at 50 m | 214 m | 112 m | 0.54 s | 5 % under the bus |
| Jet, at 154 m | 441 m | 166 m | 0.40 s | 24 % under it |
| Turbo 3, at 149 m | 468 m | 86 m | 0.10 s | 36 % under it |
| Turbo 3, at 300 m | 898 m | 86 m | 0.11 s | out of the frame, under it |
| Turbo 3, at 6 km | 1,563 m | 4,678 m behind, 7.1 s after the tap | | |
| Turbo 3, at 16 km | 1,563 m | 15,043 m behind, 18.6 s after the tap | | |

So in a gear today's shot lands 0.1-0.5 s ahead, under the bus, where the thumb is. The plan had Jet's at 140 m; the aim's ray 20 degrees down from 154 m reaches the ground at 423 m.

**The Comet** (`3baf3d3`, `src/game/Comet.ts`; the page's in `bad1288`; after the review, the GPU check and the outside look, `ad28f3f` and `ac32971`, below).
- **When.** A tap while a gear drives the bus at 225 m/s or more (`Flight.turbo.speed`): Nonstop engaged, Jet, Turbo 1-3, on the street and on the Moon. School Zone, Cruise and Express never fire one.
- **Where.** Along the aim's flat way (the nose, turned by a look), as far as the bus flies from the tap to 1.5 s after the impact, at most 1.9 km (`config.city.loadRadiusHigh`). The breath's stall is in it: the drive's spool and the breath's 0.85, stepped as Flight and TurboDrive step them. The probe's passes come within 0.01 s of the plan's own. It lands 34 m off the bus's line (`config.comet.side`), the side swapping with each Comet: on a building within 12 m of there whose landing, as `Splatter.barf` lands on it, is within the drops' 50 m of the line, else the other side's, else the line's, else on the ground this side.
- **In view.** By the lens the player sees, moved on by the bus's travel to the impact (a climb in it, a descent not: a gear's floor levels the bus out), it must land at least 5 % of the height above the bus (`config.comet.above`), tested where it comes down, its side and what it's on. Where it doesn't it moves out a stretch at a time, and where it never does within 1.9 km the tap is the classic shot. Where the ground hides it from the lens by more than 4 m (a ridge), a building on the ridge takes it, when that's still 0.5 s of travel ahead at the impact; else it stays, and its pillar stands over the ridge.
- **The flight.** 0.6 s after the 0.09 s inhale, whatever its length, on an arc through the sky topping 17 % of its chord, lowered toward 6 % where its top would leave the frame (by the lens moved on to its flight's middle, `config.comet.apexTop`). A building standing into the arc takes it on its face, on an 8 m march. One less than 0.5 s of the bus's travel ahead of it at the impact is lobbed over instead: the arc tops out higher, up to 30 % of the chord. The ground standing into it is lobbed over too, and where even 30 % doesn't clear it, it lands on the hillside.
- **The splat.** A tap's barf at the landing: `blastRadiusFor(drop)`, `life.blast` with the whole circle, one level a building, no ribbon from the mouth and no hit-stop. Over water it's a miss with its refund. A landing whose tile isn't in at the tap is planned 0.2 s before the impact (`BarfOpts.late`), with what's loaded then, its height included, and its streak bends there (`SplatFx.late`).
- **What glints** with a gear at speed is the Comet's landing, held: the middle of a stretch of its way 0.12 s of the gear's travel either side, the stretches counted along the bus's own travel (`Comet.track`, an odometer), the landing kept for its stretch while it shows, and taken back to a nearer stretch that shows now, as a fresh plan would. A press, or the steering thumb lifting, latches it for 0.5 s, as the aim latches its own. The aim's own pick runs on under it, so where the Comet stops applying, the tap is exactly the classic one. Where it applies it takes the place of `?life`'s mover too (`HOOKS.md`).
- **The seam.** `Comet.ts` chooses the tap's shot in one place (`chooseShot`), with the Lob's slot: when both apply, the farther landing wins. Recess's `Comet.clamp`, and a captain's Comet, are in `HOOKS.md`.

**Its looks** (`bad1288`, `src/fx/CometFx.ts`, `src/audio/cometSfx.ts`). Each part is in the faction's own paint rows.
- **The streak.** A white-hot head and a tail of motes along each frame's stretch of the arc (`Particles.comet`, as the homing shot's), 400 a Comet. Rainbow's tail is six bands side by side, Atlantis's a foam helix, the Elderwood's leaves falling off it, Hyperglow's a zigzag, Inferno's embers rising.
- **The impact.** A white-hot core held 3 rendered frames, as wide as the landing is far (34 m there) and short of the bus on the screen, the rest of the frame as it was (`PixelPipeline.flash` with a strength under 0); a ring of 64 motes of its paint racing out over the roofs to the blast's edge in half a second; the bloom's notes on time; no kick or hit-stop that far off.
- **The pillar.** 200 m of paint light standing on where it landed, up in 0.12 s and stippled away over 2.5 s, with a crown of spray at its top. Its bands stream up it with edges broken by a coarse dither, each paint row at its own light step, under a third of a surface's fog. Rainbow's is a hexagonal prism of six bands under a crown of stars; Atlantis's a teal helix, deep and bright, with foam streaming up it, opening into a sea geyser that rains back; the Elderwood's a vine spiralling up into gold and violet blossom; Hyperglow's a neon zigzag bolt re-rolled 20 times a second; Inferno's gold tongues licking up through crimson, a few obsidian flecks in it. None is ever under 6 game px across. Its wall dithers away nearer the lens than 110 m, gone by 35, so the bus flying past it is never lost in its dots.
- **The lens.** The bus within 50 m of its axis, under its top, gets 8 to 14 lobed splats of its paint on the glass, each at its row's own light, which run down and fade in 0.5 s.
- **Into the water** it's a miss with its refund: a splash of its paint and foam thrown up to about 70 m and a soft boom when its sound reaches the bus, and the full show it took is still to come.
- **The late boom.** When the sound of the landing would reach the bus (the distance over 343 m/s plus the bus flying into it): a crack over a rumble, and the camera's kick. A whoosh off the mouth at the launch.
- **Lighter.** The full show plays on the first Comet in 20 s, and while Streak's seam (`cometFx.streakOn`) says a streak is on. The rest get a 120 m pillar for 1.2 s, half the motes, no drops and a softer boom.
- **The cost.** The pillars are one InstancedMesh (576 triangles each, up to four) and the drops another, made at boot and warmed (`registerWarm('comet')`). A pillar's faction, hue and shape are numbers per instance into constant tables in its one program, so one program each covers all five factions. The streak and the crown are the particles' own program. Two draws at most while they show.

**The Moon** (`1495faa`). `CraterPaint.aim` moves a shot onto the crater that glints, as before, but a Comet keeps its 0.6 s flight and its arc there, where every other shot lobs for up to 2.6 s. The crater at the landing glints by itself, since it reads the aim point. `CometFx` slides with the Moon's map, and the boom there is a thump through the ground. `src/moon` is in neither account's list: this is the shots' Moon side.

**Where this departs from the plan.**
- The landing is the middle of a stretch of its way 0.12 s of the gear's travel either side, counted along the bus's travel and held for the stretch, where the plan held what glints while the landing stayed near it. A held glint made 30 and 60 fps land 40-190 m apart, so the plan's own 2 m gate failed; held by stretches, they land within 2 m. The first build anchored the stretches to the map's origin along the heading, which a turn swept through (the review's 3).
- A wall less than 0.5 s ahead at the impact is lobbed over, where the plan let any wall take it. The plan's downtown gate wants the wall 0.5 s ahead.
- The probe's gate takes a wall 0.5 s ahead anywhere at the floor, not only downtown: from the Western Addition, Turbo 1-3 reach the Civic Center's towers.
- `controls.mjs` has no `comet` mode. The GPU flight is a scratch script, kept on the laptop with its frames, as step 2's was.
- Not flown on `?life` or `?moon`.

**The checks** (on `b18be07`; the first GPU round on `dc88168`'s build, the second on `b18be07`'s).
- `tsc` clean at each commit. `vite build` exit 0, and `iosfloor` says "iOS 15.0 parses every chunk", on both builds.
- The gesture sim 860 of 860 (349 rows), turbo 37 of 37, hold 41 of 41 (28 rows), layout 300 of 300: what the merges' check had.
- The probe, 122 rows in 182 s, exit 1: 32 of its 364 checks fail, all the in-view rule's and the gates' own numbers (below). Every row that isn't a Comet lands where the baseline's did (82 rows, within 0.5 m and 0.02 s); School Zone, Cruise and Express never fire one; every Comet lands 0.70 s after the tap (0.72 over water), 30 and 60 fps within 2 m; over water it's a miss with its refund (the belly back at 0.5); the dive's is ahead and in frame; no building rose two levels anywhere. The aim's frame, the Comet's plan in it, took 0.04 ms (median) to 0.15 ms in Node.

The Comet in the probe, at 60 fps (the pass is when the bus passes the landing, after the impact):

| | Lands from the tap | Ahead at the impact | Passed after | Above the bus at the impact | Painted |
|---|---|---|---|---|---|
| Nonstop, the floor | 551 m | 399 m | 1.87 s | 6.8 % | 82 |
| Jet, the floor | 1,337 m | 1,034 m | 2.40 s | 7.3 % | 31 |
| Turbo 1, the floor | 1,395 m, a wall | 1,001 m | 1.80 s | 7.5 % | 28 |
| Turbo 3, the floor | 1,537 m, a wall | 931 m | 1.11 s | 10.8 % | 20 |
| Jet, 300 m | 1,548 m | 1,245 m | 2.87 s | 6.4 % | 25 |
| Turbo 1-3, 300 m | no Comet: the classic shot | | | | |
| Nonstop, downtown | 404 m, a wall | 252 m | 1.20 s | 14.7 % | 11 |
| Turbo 3, downtown | 1,795 m | 1,188 m | 1.41 s | 9.4 % | 37 |
| Turbo 3, over water | 1,785 m, a miss | 1,165 m | 1.38 s | 7.7 % | 0 |

What fails: at the floor the in-view rule moves Nonstop's landing out to a 1.87 s pass and Jet's to 2.40 s, and downtown Jet's to 2.11 s (the gate is 1.3-1.7 s: the plan's risk 3, the margin against the pass); at 300 m Turbo 1-3 find nothing 5 % over the bus within 1.9 km, so the tap there is the classic shot, which lands under the bus and out of the frame; downtown a Nonstop Comet on a tower's face paints 11 buildings (the gate is 20; today's tap there paints 6 to 22).

On this laptop's GPU (Intel UHD 620), the built page, one browser at a time under the lock. Frames and logs are kept on the laptop, outside the repo.
- `warmcheck --comet`: 38 programs at ready (36 before: the pillars and the drops), none after the warm-up. At Jet the full show's Comet boomed and put 11 drops on the lens as the bus flew through its pillar; the lighter one boomed and put none.
- `warmcheck --crew --comet`, all five factions, a full and a lighter Comet each: 38 at ready, none after, in all three runs. In the first two, two factions' Comets came down with no pillar and no boom: the check let the bus fly on at Jet while the city settled after its jump back, out over the bay, where a Comet is a miss (the second run's rows say so: ground 0, no tile, 3.4-5.7 km east). With the bus held at its spot until the city settles, the third run: all ten Comets landed on the city with a pillar and a boom, and the three full shows (Atlantis, Hyperglow, Rainbow, the first in 20 s each) put 12, 10 and 14 drops on the lens. That run had four frames of 233-817 ms in Hyperglow's and Inferno's phases, which hold the jump back of 4 km and the city streaming in as well as the Comets; no program was made in them, and the flights' Comets had no frame over 100 ms.
- The flights, with real CDP taps and real flicks (`tools/flick.mjs`), golden hour: east from Ocean Beach in Atlantis (a plain tap at Cruise, then Nonstop twice and Jet), Turbo 3 in Inferno from Lands End, and north over the bay at Jet in Inferno.
  - Nonstop, the first: the full show, its boom, 9 drops as the bus flew through, 90 buildings painted; it landed 487 m out, passed 1.60 s after its impact. Nonstop, the next: the lighter show, 453 m, 1.44 s. Jet: 1,489 m, 2.76 s. Turbo 3, the first: the full show, 12 drops, 165 buildings, 1,687 m, 1.32 s; the next, 1,712 m, 1.34 s. Over the bay at Jet: a miss, no pillar and no boom, as planned (water is the Torpedo's later).
  - On the page's own lens, at the frame of each impact, the landing sat 11.8 % (Nonstop, the first), 9.6 % (the next), 7.7 % (Jet) and 6.9 % (Turbo 3) of the height above the bus. The probe's lens put them lower: its camera isn't the page's to the pixel.
  - 0 programs made after the start in any flight; 0 page errors; the console's two 404s are `/favicon.ico`.
  - A Comet's frames against a plain tap's at Cruise: the tap's work 8.4 ms median, 44.1 ms at most, 143 draws at most, 0.93 M triangles, 3,430 particles. Nonstop's lighter Comet: 4.1 ms, 28.3 ms at most, 129 draws, 0.93 M, 3,115 particles, the frame 23.2 ms median and 47.8 at most. Turbo 3's: 2.3 ms, 18 ms, 79 draws, 0.67 M, 3,349 particles. The frames of each impact: 59 to 127 draws, 0.67 to 0.90 M triangles. No frame over 100 ms outside the screenshots.
- `shots.mjs --det` with the sky off, this build against the merge's (c09e415's): all eight views identical, as they should be: none fires a Comet.

- The second build (`b18be07`'s, the pillar in its paint's colour and wider), on the same laptop: `warmcheck --comet` 38 programs at ready, none after, the full show's Comet 10 drops. The flights again, east in Atlantis and Turbo 3 in Inferno: Nonstop's passes 1.63 and 1.42 s, Jet's 2.60 s, Turbo 3's 1.49 and 1.50 s; 0 programs made after the start, 0 page errors.
- Stills at 1179 x 2556 of the first Comet over the Western Addition in Atlantis, stepped two frames at a time, and of Turbo 3's in Inferno, with a GIF of the first, are kept on the laptop. The streak is a glittering column from the bus up to where it lands, and there's a burst there. Then a 200 m helix of teal and pearl rises over the block it painted, and the bus flies into it. At Turbo 3 the landing is 1.1-1.3 km ahead, just over the bus on the screen, and its pillar is a thin flame there.

## Step 4: the Bomb

This step's plan was written on the laptop from SHOTS.md, outside the repo, with the producer's five calls taken as picked: MEGA's look in the faction's colours now and the five set pieces later; a still lift on the bus before II is a tap; 1.8 times the tap's circle from any height; in Recess only the aimed square jumps (an ask, below); the riser and the landing ring. All of it is behind `&bomb` on the link: without it no frame, sim row or `--det` view changes.

**The gesture** (`aeea7b3`, `src/game/Input.ts`). The flying thumb landing on the bus itself (`Input.busBox`: the bus's eight box corners through this frame's lens, 10 px more a side, at least 48 x 56 px, set by main.ts every frame) and held still charges, while it steers as any thumb does. Still is 12 px of the landing until Bomb II shows, then 28 (MEGA's slops). The charge begins 0.35 s in with a full belly, Bomb II shows at 0.69 s and Bomb III at 1.29, each 70 ms late on a frame, as hold to aim does, and a lift's own time picks its tier. A lift before II shows is the tap while the charge runs, and with none begun (the belly refilling) up to when II would have shown, past which it's nothing, as a resting thumb off the link; after it, the Bomb, at the tier that had shown by the lift's own time (II's and III's frames); held on, it stays III and never fires by itself. The cancels are fizzles that keep the belly: past the slop, three fingers, a lost touch or focus, a hand-over, another thumb's tap. Only the flying thumb charges, never while it could still be one of a two-finger tap, never a second thumb on the bus; another thumb's look or flick doesn't stop it, and a hold off the lane while it charges coughs (`Hose.bombing`), so the Hose can't drain the belly.

**The Bomb and its tell** (`62eb188`, `src/game/Bomb.ts`). At the charge's start MEGA's riser and hiss with an inhale on it; at II a clunk, the bus 6 % bigger on a stiff spring and a ring 1.4 times the tap's circle where it will land (`PixelPipeline.setBombRing`, drawn in the resolve as the hero circle is: no decal, draw or program); at III a deeper clunk and a bell, MEGA's heartbeat a beat at a time for as long as it's held, its motes, 12 % and the ring at 1.8 times, pulsing. No flight or camera number changes while it charges: the swell is the bus's scale alone. A cancel before II fades the riser out (`bombFade`); from II on it's the fizzle's power-down. Let go, it's MEGA's breath (main.ts's `breatheNow`): jet x1.5 or x2.4, hit-stop 6 or 9 frames when it lands in the frame (none below it), tagged `SuperTag { kind: 'bomb', charge, id }`, and the belly refills in 3 or 4.5 s. The hint, once (Coach's `TAUGHT.bomb`, 256: aim is 64 and feat/curb's curb 128): HOLD THE BUS STILL / LIFT TO BOMB after three taps, the first time a painted building (on the Moon, a crater) glints with a full belly under 300 m; a Bomb let go first teaches it.

**The landing** (`0d5e42e`, `2e16ad2`, `6af2e73`). At School Zone, Cruise and Express it lands where the tap would (the tap's own shot, `Aimer.fire`). At Nonstop and faster it lands where the Comet would, through `Comet.ts`'s seam (its plan and `chooseShot`, which `Aimer.fire` hands over): ahead, in view, with the Comet's full show every time (`CometFx.launch`'s `full`, which counts as the 20 s's full show) and no hit-stop that far off; its ring while it charges is on the Comet's plan of that frame (`Aimer.planned`). Where the tap is the classic shot, at Turbo 3 from 300 m (no Comet in turbo from about 300 m up, step 3's open call), so is the Bomb. A Bomb never goes to a mover off a floor (a plane glinting on `?life`) but to the building its ring showed (`Aimer.fire`'s `bomb`). A gift fires whatever the belly holds, and while it charges the aim runs as with a full belly (`Aimer.primed`), so its ring and landing are a full belly's. Each building in its circle jumps to `min(3, level + 2 or 3)` (`BarfOpts.jump`; a tap's stays one) and never asks the Lift (`Lift.aloft` only says whether a house is lifting, up or staged; one up already is out of it, as of a tap's). Its trees jump as many. Movers in its circle take one level, as `life.blast` always gives them. On the Moon's ground the craters take the jumps (`CraterPaint.impact`): the crater it hits climbs two or three levels at a blow, never past 3, each neighbour as many, never past its top of 2 (rays stay a direct hit's), all landing with the wave; craters don't hop.

**The stages and the pogo** (`6cf3a01`, `ab6bae5`; `src/world/pogo.ts`). Each stage a Bomb jumps a building is its own write and pop, the first with the wave as a tap's level, the next 0.4 s after the last (`config.bomb.stageGap`), written in bands 0.1 s ahead of their pops so the paint goes up at most once a band. Each pop starts with a hop under one uniform (`uBombPogo`: the last Bomb's circle, round all its buildings and their gardens, and its pops' bloom times, its first stages' included, to the last of any building's): `clamp(0.3 x height, 2, 6)` m up and down over 0.24 s, landing in the pop's squash, so a house climbs by hops, skin, garden, crown; towers over 40 m only squash. The rooftop gardens ride the hop: under `&bomb` a garden carries its building's index (`aLiftB`, as under `?lift`) and reads its paint. No new draw or program, and without `&bomb` no shader's source differs by a byte (`pogoed()`, as `liftGlsl`'s `lifted()`). A Bomb's stages share one sparkle budget, about 1,800 (`BLOOM_BOMB`). `blastCap(r, most)` is every blast's cap: a tap's 240 and a super's 480 as before, a Bomb's `min(2400, 140 x (r/85)^2)` (900 left hundreds grey from 600 m); Streak's wide tap can take it. A Bomb's hues are dealt with each building's touching neighbours from a grid of its plan, not the whole plan. A circle over 160 m has its ground drawn by its deadline, `groundDeadline(r)`, the wave reaching its rim (0.84-1.64 s after the impact), not by its impact: `GroundPaint.begin` takes it, and such a job draws its rows nearest first, each frame first what its wave reaches by the next frame and 16 m past, the rest spread to the deadline, so the wave never meets ground not drawn yet; drawn whole in flight a Bomb III from 300 m was a 24-37 ms frame in Node. A tile that comes in after the job is ordered (City splits a region's tiles out three a frame, from up high: most of a Bomb's on the page) joins it (`GroundPaint.widen`): its rows behind what's drawn are drawn at once with the dots drawn already, and the rest go into the order; a tile that goes and comes back keeps its dead entry, so no other tile's rows move. Its bands go up in each tile's one upload a frame. A tree standing on ground not drawn at the impact takes its paint as the wave reaches it (main.ts's `treesDue`). A newer blast's `begin` finishes a wide job still drawing, so paint stacks in order (one spike frame; only another's blast comes that soon).

**Its looks** (`ed3091a`). Bomb III is MEGA's built look while it charges, in the bus's faction's spray rows (`factionLook.ts`), as data and uniforms: its motes pulled in down the funnel (420 a second), its halo orbiting the bus (110) and its sparks (70); Bomb II is MEGA's floor, half the motes and no halo; charging before II, a fifth of them. `SuperFx.palette` carries the faction's spray, its shader taking a faction's rows at the step they read brightest without bleaching (Particles' table, now `FACTION_STEP`); the landing ring takes six rows from `uBombRows`. main.ts's `bombLook` sets both at the Bomb's start and on each faction switch; without `&bomb` neither changes. MEGA's arcs on the bus stay white, blue and violet: SuperSplat writes them every frame, and the Bomb doesn't use them. FACTIONS.md's five set pieces are the producer's later step.

**The hooks** are in `HOOKS.md`: `holds.bomb` (gift, bank, charge, tier, watch with its tier, release, cancel and tap), and the ask for Recess's squares.

Where this departs from the plan:
- The hint's bit is 256, not the plan's 128: feat/shots has aim at 64, and feat/curb, merging into feat/shots after this, has curb at 128. Streak's plan puts `TAUGHT.lock` at 256, which is the Bomb's now: lock needs 512.
- The cap and the ground's deadline are functions a tap can call too (`blastCap`, `groundDeadline`), for Streak.
- The ground's deadline is drawn nearest first and uploaded as it's drawn, the plan's pick worked out.
- On the Moon a Bomb's neighbours stop at the craters' own top of 2.
- The GPU check found the swell's spring unstable past about 40 fps when stepped once a frame (at 30 fps the bus went to -2,613 times its size at III): it's stepped at 1/120 s now (`eb4dbd4`).

**The checks** (on `a59942d`; the laptop's `sb-checks/shots/bomb/gates.txt` lists every one, and `gate.sh all` runs them):
- `tsc` clean at each commit. Without `&bomb`, every sim's output and log is byte for byte the base's (feat/shots `808a83a`, run in its own worktree): the gesture, layout, hold and turbo sims, the probe (but its aim's cost), the fifteen feel sims and owner-check, every exit the base's (the probe's 37 of 412, as step 3 says).
- The Bomb's own rows: the gesture sim's 34 of 34 (`gestures-bomb.json`), the hold sim's 29 of 29 (`holds-bomb.json`), `s_bomb` 205 of 205 (four places, three heights: every building at `min(3, before + jump)`, none past 3, stages 0.4 s apart, the cap cutting nothing, every wide ground down by its deadline with nothing drawn after its wave, the worst frame 1.4-6.0 ms in Node; `?lift` asks no house; the Moon's craters; the swell at 60, 30 and 20 fps), and the probe's (`s_shots.ts --bomb`) 266 of 266: at Nonstop, Jet and Turbo 3 at the floor and 300 m over the Western Addition and downtown, each Bomb on its tap's landing (0 m, the same 0.7 s), a Comet's where the tap's is, 1.4 and 1.8 times its radius, in frame, with no hit-stop; none of the taps raised two.
- `vite build` exit 0, `iosfloor` "iOS 15.0 parses every chunk".
- On this laptop's GPU: `warmcheck --crew --bomb` 38 programs at ready and none after, all 20 Bombs at their tier (Cruise II, III and a gift, and Jet's on the Comet's landing with its full show, in each faction); `controls.mjs bomb` 28 of 28 (Cruise, School Zone, Jet, `?life`, `?moon`: 90-200 buildings a Bomb III, none wrong or past 3, 69-99 draws and 0.52-0.68 M triangles at most through the stages and the pogo, 15 craters on the Moon, no program made); `budget.mjs --bomb` passed (a 281 m Bomb III over Alamo Square raised 274 to 3 at most 151 draws and 1.22 M triangles; the views with `&bomb`'s attribute 0.41-0.42 M garden triangles, the hold 1.0).

## What's left of step 4

The producer's calls first (the outside look put them there, with the studio's pick first):
- **The charge reads only by ear.** A thumb on the bus hides its swell and glow, and at Cruise the ring is mostly off the frame: a band under the hand at II, a thin line near the horizon at III. Only Jet reads. The outside look's pick: a corona 60-90 pt round the touch that snaps shut at II and doubles at III, the grey world one ramp step darker at III, pulsing with the heartbeat, and no swell. Or keep the ring for Jet only, or lift the camera while it charges (the plan ruled that out). Not built.
- **The release isn't a big hit.** The hit-stop lands 0.40-0.45 s after the lift, on a puff of breath; at Cruise a tap, a II and a III look alike for 1.3 s. The pick: no inhale, the impact within 0.2 s, a flash frame, the ring and a camera punch on the hit-stop, then a 1 s pull-back showing the whole circle. Not built: a camera move after every Bomb is the producer's to see first.
- **The hops don't read as jumps** from the chase camera (about 15-20 px over 0.3 s in School Zone). The pick: a stretch up, a squash on landing, 2-3 frames of hang, a splash at the base, a ripple outward by distance, and the new stage switched at the top of the hop. Not built.
- **A falloff**: +3 everywhere makes 180-270 buildings one even carpet; 3 at the centre, 2, then 1 at the rim would leave a crater to read from the air and keep crowns rare. The outside look's pick for extraordinary.
- **A Bomb on paint already at 3** jumps nothing: its houses re-pop, and now hop once with their re-pop (the pogo's window takes every pop of the Bomb's). What more it should do is the producer's.
- **The look's small ones**: motes one ramp step lighter than the paint under them, and the chunks kept off the bus, whose yellow gets lost among Rainbow's, the Elderwood's and Inferno's. Not built.

And the rest:
- **The producer's grip test**: where a resting thumb lands. The bus's box sinks low in School Zone and high up (the plan's table), and no thumb has held it on a phone.
- **The five set pieces** (FACTIONS.md: Big Bang, Great Wave, Wildgrowth, Strike, Meteor), the producer's first call's second half.
- **Recess**: the square's jump is the second account's (`HOOKS.md`'s ask). Another blast while a Bomb's ground is still drawing (a rival's, Recess's bots) finishes that ground first, in its own barf's frame: 5-16 ms in Node against 0.3-0.8 alone (the world review). The fix is to finish only the rows its circle overlaps; not built, and no Bomb has flown in Recess.
- **Bombing painted ground, the new colours run ahead of the wave**, 180-290 m at 0.5 s (the world review): rows drawn after the landing change old paint at once, where a tap's changes under its flash. Holding each such texel's over-paint until its wave comes is the fix; not built.
- **At Turbo 3 from 300 m** a Bomb, like the tap, is the classic shot, out of the frame under the bus (now with no hit-stop): step 3's open call on no Comet in turbo from about 300 m up.
- **The lift's frame from 600 m**: a Bomb III's barf there deals 1,000-1,800 buildings, 6-12 ms in Node on this laptop (the other jobs' load in it), against 21-27 ms before the fix from 300 m. Not measured on an A15; spreading the plan over the shot's flight is the next step if a phone stutters.
- MEGA's arcs on the bus stay white, blue and violet: say so with the stills if they read as part of the Bomb.
- Streak's `TAUGHT.lock` needs 512: 256 is the Bomb's.
- **Not checked**: movers' one level on the page (life's own tools), a plane glinting under a Bomb on the page (`?life`; the code's and the sims'), an A15, the producer's phone, a Bomb in Recess, the sound by ear.

## How to fly it

The branch's preview: `https://struggle-bus-world-git-feat-shots-patricks-projects-9ff6e721.vercel.app/`
- `?crew`: the faction button. Tap the crest, pick a faction, splat. Then drop `?crew` from the link: the button stays. `?crew=off` takes it away on that phone, and the bus paints as Rainbow again.
- `?crew&life`: the same with the living city. One tap on a park or a busy street paints the people and cars inside the circle. A tap on one car or a ferry paints the block round it too.
- `?mega`: MEGA as it was, to compare.
- Step 2, the Hose: hold a finger still on the city, high over the bus and away from it, for a bit under half a second. It pours where you hold, and a drag sweeps it. Hold on the sky and it throws as far as it reaches that way. Watch the bus's belly band drain and listen to the hiss climb. A quick tap there still splats. With `?crew`, try it in each faction's colours.
- Step 3, the Comet: flick up twice from Cruise for Nonstop, or on to Jet and Turbo, and tap high on the screen, off the bus. A streak climbs up through the sky and comes down beside where you'll be in a second and a half or so, a white-hot hit with a ring of paint over the roofs, a pillar of paint light goes up there, and you fly past it through its spray; the boom comes a beat later. The next one comes down on your other side. The first in 20 s is the full show, the next ones lighter. Steer while it glints: what glints steps along, it doesn't flicker. Tap one into the bay: a splash. With `?crew`, try each faction's pillar.
- Step 4, the Bomb, with `&bomb` on the link (`?crew&bomb` for the factions): put your flying thumb on the bus itself and hold it still. Under a second the riser starts and a ring shows where it'll land; a clunk, the bus swells and the ring grows (Bomb II); hold on and a bell, a heartbeat and the ring wider and pulsing (Bomb III). Lift to let it go: houses in the ring climb two or three levels in hops, skin, garden, crown. A quick lift is still a tap. Try it in Jet: it comes down where the Comet would, with the full show. And on `?moon&bomb`: the craters jump.

## What's left of step 1

- `life.blast` (the second account's, in `src/life/`) tests a sphere in 3D, so we pass it the ground under the impact, or the deck when the shot landed on a bridge's: boats and cars in the circle are inside it, and planes overhead aren't. A flat circle on the map, from the ground to the roofs, would say what's meant better, and it needs a rule for a deck: a tap into the water under the Golden Gate shouldn't paint the cars on top.
- `feat/shots` goes to `main` after `feat/gardens` (decision 20, the gardens' budget first): see the review below.
- Movers take a hue and a level but no faction (CONTRACT.md: faction 1). Another faction's tap paints them in Rainbow's colours until life takes the hitter's faction.
- The Lift lifts only Rainbow on Rainbow, as FACTIONS.md's first slice built it.
- Nothing here was measured on an A15, or on the producer's phone.

## What's left of step 2

- **A resting thumb off the lane now pours.** That's the ruling ("held still for 0.35 s, it aims"), but a thumb resting high on the screen used to do nothing, and now it empties the tank. A phone will say whether that bites.
- **Taps in the lane stay at 450 ms.** The ruling's 0.3 s tap applies off the lane, where a hold aims. In the lane, a still thumb past 450 ms steers at neutral, as before (the lane is untouched). Beside a flying thumb, a second thumb's tap is still 230 ms.
- **No hold to aim on a desktop.** The mouse flies, and its right button looks.
- **The aim begins at about 0.42 s, not 0.35.** The finger is judged still at 0.35 s as ruled, and the pour waits 70 ms more (`inputTune.aimLagMs`) for a lift that reaches the page late; until then a lift is a tap. A tunable: the phone decides whether it feels slow.
- **From more than 1.5 km over the ground the Hose coughs.** Nothing is in its reach. A tap still splats from there.
- **A lock's shot costs what's in the belly** (at least 12 %), and empties it. That's the studio's reading of "Nothing is wasted", taken so a lock that takes a pour can fire; the producer's to overrule.
- **A dry tank ends the hold.** A pour that runs dry stops for that hold, even if the tank refills while the finger stays down. Lift and hold again.
- **The Hose is new code, built from the firehose, not an extraction of it.** `SuperSplat.ts` stays whole and asleep, so the two share ideas, not a module.
- **The homing shot spends a breath.** The player's shot stalls the bus for the breath's second, as a tap does, but it has no jet: the blob is the jet.
- **Not built yet:** the flick's lunge in the white, the Bomb on a hold on the bus, and the HOLD TO LOCK hint. See `HOOKS.md`, "Not here yet".
- **The hook for the second account.** `docs/TODO.md` (on `feat/earth`) should say that the hook is on `feat/shots`, in `HOOKS.md`. Neither run wrote it there: it's off this branch.
- **Not measured** on an A15 or on the producer's phone. Not flown over Recess or `?life` on the GPU.

## What's left of step 3

The producer's calls first (the review of step 3 and the outside look both put them there):
- **The margin against the pass** (the plan's risk 3). The in-view rule, 5 % of the height over the bus by the lens moved on, moves the landing out past the 1.5 s at the floor: in the probe after the fixes Nonstop's pass is 1.84 s, Jet's 2.39, Turbo 1's 1.91 (its higher arc clears the wall the low one hit) and downtown Jet's 1.87; from 300 m Nonstop's lands 1.26 km ahead, about 5.6 s. It's `config.comet.above`: the producer trades the two on the phone. At 3 % the probe's pose gives Jet 2.14 s and Turbo 1 1.68 s; Nonstop stays at 1.85 s (the line 1.5 s ahead of it sits 2.6 % over the bus), and 300 m in turbo still has no Comet. The studio's pick: 3 %.
- **No Comet in turbo from about 300 m up.** At 300 m Turbo 1-3 find no landing 5 % over the bus within 1.9 km, so the tap there is the classic shot, which lands under the bus and out of the frame: the producer's note 2 fails exactly there (the review's 1). On the page's lens Turbo 1 at 300 m did get a Comet in all 6 of the GPU check's runs, Turbo 3 never. At speed the chase lens sits low behind the bus, with the horizon only about 10-15 % of the height over it. Ways on: a smaller margin; a reach that grows with the height, since the city loads 950 m further ahead up high; the Lob's step answering taps up there. The studio's pick: the reach growing with the height.
- **The faction's contrail** (SHOTS.md, "In turbo you get a contrail in your colour that only looks"): the gear trail is Rainbow's in every faction, the biggest saturated shape in turbo, and the streak lines up with it. The outside look asks to bring it forward; not built.
- **Two bigger ideas from the outside look:** leave the arc as a ribbon of paint you fly along, and show the late boom as a ring racing out at the speed of sound that hits the bus with the crack (on this laptop the camera's kick moved the skyline 2 game px at most: without sound the boom isn't felt).
- **Recess** (the review's 2): during a match the ride forces the real TurboDrive into Nonstop or Jet (`feat/recess`), so every tap would be a Comet 0.5-1.3 km out, often past the fence, and a tap at a captain would stop working, as a Comet takes the place of the aim's mover. `HOOKS.md` asks the second account to set `comet.clamp` to return false during a match. Not merged or flown here.

And the rest:
- **The page's lens and the probe's differ.** At each impact on the page the landing sat 7-12 % over the bus; the probe's lens had it 6-8 %, and the GPU check's Turbo 1 at 300 m is a Comet on the page and not in the probe. The probe drives the real CameraRig and TurboLens, but not in the page's order to the frame.
- **What glints while steering** changes about once a stretch, 4.2 a second; at full stick 3.5 a second at Nonstop, 6-6.5 at Jet and 5-6 at Turbo 3 in the probe (today's aim at those gears: 3.7, 5.3, 10), where the margin moves it on as the bus comes up to it.
- **At Turbo 3** the landing, 1.7-1.9 km out, is still close over the bus's column on the screen (34 m off is about 3 % of the width there, which the outside look found read best), and the streak's tail runs up out of the frame's top as the bus flies under where it climbed. The phone decides whether it wants more.
- **A ridge with nothing on it** keeps the landing behind it, hidden from the lens (52 m at Glen Park's Turbo 3 in the probe), its pillar standing over the ridge: a ridge's open ground would paint nothing.
- **Downtown, a Comet on a tower's face paints few buildings:** 10 at Nonstop (the gate is 20; today's tap there paints 6 to 22).
- **A big tap's frame.** The GPU check found a Comet's tap frame 10-45 ms of game work against a Cruise tap's 6-16 ms; its own classic tap from 300 m at Turbo 3 took 33.7 ms, and in Node a Comet's barf is 0.2-1.4 ms against a classic one's 0.2-0.6 ms with the same drop, so it's the frame of a big blast from high up, any tap's, not the Comet's own work. Not measured on an A15.
- **Not flown** on `?life` with the fixes, `?moon` (the Moon's side is built, not flown), in Recess, on an A15 or on the producer's phone. The boom wasn't listened to. `controls.mjs` has no `comet` mode yet.

## The review of step 4, and what it came to

Four checks of `a4909c2`: a review through input and play (its probes of the real Input, Flight, Aimer and Bomb), a review of the world and the frame (its probes against the real city, Splatter and GroundPaint, and a GPU run), an outside look at the frames by real touches, and `gate.sh all`. Each finding was read against the code first.

| | Finding | Holds? | What was done |
|---|---|---|---|
| Play 1 | A gift let go while the belly refills lands behind the bus at speed | Yes: the aim keeps no point or plan while it refills | `db3a3b0`: a gifted charge primes the aim (`Aimer.primed`). The review's probe: 188 m ahead at Nonstop and 418 at Jet, on `aimShot`'s point, where they were 128 and 279 m behind |
| Play 2 | A still rest on the bus while the belly refills is a tap however long, with the "not yet" | Yes | `db3a3b0`: with no charge begun, a tap only up to when II would have shown; the probe's 1.3 and 4 s rests do nothing |
| Play 3 | A pause on the bus before steering plays the riser and the power-down | Yes | `db3a3b0`: before II the riser fades; the power-down is II's and III's |
| Play 4 | The ring is hard to see; at Turbo 3 from 300 m a 9-frame hit-stop for a blast below the frame | The ring: the producer's (What's left). The hit-stop: yes | `db3a3b0`: a Bomb's hit-stop only for a landing in the frame |
| Play 5 | `watch()` never hears a charge that ends as a tap | Yes | `db3a3b0`: `BombWatch.tap`, in HOOKS.md |
| Play 6 | A plane glinting takes the whole Bomb, at one level | Yes, from the code | `db3a3b0`: a Bomb takes no mover off a floor, but the building its ring showed. Not flown on the page |
| Play 7 | At 30 fps a lift 670-700 ms in is a tap or a Bomb II by when it reaches the page | Yes: 17 of 116 | `db3a3b0`: the tier that had shown by the lift's own time. The probe: 0 of 116 |
| Play 8 | The charge ignores the bank and the gift | Yes | `db3a3b0` |
| World B | The ground leaves out tiles that come in after it starts, saves the holes, and a change of detail blanks another tile | Yes: on the page 0 % on 9 core tiles from 600 m | `0e24fa9`: a tile joining a wide ground is drawn as the rest (`widen`), a gone tile's entry stays. The review's probe and s_bomb: the late and the swapped tile as with every tile in |
| World M | Trees on a wide Bomb's outer rows stay grey | Yes: 1-52 % | `34a5eec`: each painted as its wave reaches it |
| World M | No pogo over a block at level 2; the rim's houses miss their hop | Yes | `0e24fa9`: every Bomb's pogo, to its last pop, round all its buildings. s_bomb: no hop missing, fresh, at 2 or half at 2 |
| World M | The cap of 900 leaves a grey rim from 600 m, and 61-65 from 300 m | Yes | `0e24fa9`: 2,400. s_bomb from 600 m: up to 1,804 painted, the cap cutting none |
| World M | The lift's frame is the spike (barf 21-27 ms from 300 m), and nothing times it | Yes: deal against the whole plan | `0e24fa9`: neighbours from a grid, the stages and queue kept without splicing; s_bomb times the lift's frame |
| World m | Over painted ground the new colours run ahead of the wave | Yes | Not changed (What's left) |
| World m | Up to 35 uploads a frame, 7 on a tile | Yes | `0e24fa9`: one a texture a frame; s_bomb counts them |
| World m | Another blast during a Bomb's ground costs 5-16 ms | Yes | Not changed (What's left) |
| World n | Gardens at the rim hop out of step; every garden reads paint | Yes | `0e24fa9`: the pogo's circle takes in every building and its gardens; a garden reads paint only inside it while its pops last |
| Look 1-3, 5 | The charge reads by ear only; the release isn't a big hit; the hops don't read; the motes and chunks | Yes, as seen | The producer's (What's left) |
| Look 4 | The hint never showed | No: the look's three taps came 1.8-2 s apart, inside the tap's 2.6 s refill, so its second never splatted and the hint wants three | Checked on the page with three that splat (below) |
| Gate | `controls-bomb`: ?life's Bomb III "charging 2", fired at III | The check's: read 150 ms before the lift on a loaded laptop | `ed3e5b0`: read 60 ms before, with when each tier showed |

**The checks after the fixes** (the laptop's `gate.sh all` at `ed3e5b0`'s tree, then the rows a duplicate run of it overlapped, and `controls-bomb` and `feel-bomb` again after their own fixes; `sb-checks/shots/bomb/gates.txt` gains the hint's row):
- `tsc` clean. Without `&bomb`, every sim's output and log is byte for byte the base's (feat/shots `808a83a`): the gesture, layout, hold and turbo sims, the probe (its exit 1 as the base's), the fifteen feel sims and owner-check: "NOTHING ELSE DIFFERS" in each.
- The Bomb's rows: the gesture sim's 36 of 36, the hold sim's 32 of 32, the probe's `--bomb` 266 of 266, `s_bomb` 385 of 385 (32 rows from the roofs to 600 m: every building at `min(3, before + jump)`, a hop for every stage a house of 40 m or less jumps, fresh, over a block at level 2 and one half at 2, the cap cutting none up to 1,804 painted, every wide ground down by its deadline with nothing met undrawn, one upload a texture a frame, a late tile and a swapped one as with every tile in; no frame over 8 ms, the lift's frame 8 ms at most, 12 from 600 m, where noe's Bomb III's was 8.9 ms with its barf 6.8). The review's probes again: the gift 188 and 418 m ahead; no lift that changes with when it reaches the page; a refilling rest of 1.3 or 4 s does nothing.
- `vite build` exit 0, `iosfloor` "iOS 15.0 parses every chunk".
- On this laptop's GPU: `--det` against the base's build, 8 of 8 views identical with the sky off and 8 of 8 at golden hour; `warmcheck` plain, `--hose` and `--comet` passed, `--crew --bomb` 38 programs at ready and none after, all 20 Bombs at their tier, none fizzled; `controls.mjs bomb` 38 of 38, with the new row from 600 m over Noe Valley (a 456 m Bomb III raised 1,569 buildings, none wrong, its ground 94.5 % painted in 0.8 of its circle, where the world review saw 0 %, and none of 103 trees on it grey) and every other Bomb's ground 94-96 % painted with no tree on it grey; II showed 675-692 ms and III 1,278-1,325 ms after the touch; at most 96 draws and 0.68 M triangles through the stages and the pogo, no program made after ready on any page; `budget.mjs --bomb` passed (274 raised to 3 at most 151 draws and 1.22 M triangles). The hint on a first run with `&coach`: three taps that splat, and HOLD THE BUS STILL / LIFT TO BOMB 2.5 s after the third, when a painted building glinted with a full belly.
- Not checked: an A15, the producer's phone, the sound by ear, a plane under a Bomb on `?life`, Recess, the stills by an outside eye after the fixes (they were taken: the laptop's `stills/` and the GIF).

## The review of step 3, and what it came to

Three checks of `b8db974`: the other run's code review (no blocker, two majors, four minors, four nits), a GPU check on this laptop's UHD 620 with real touches, and an outside look at the frames. Each finding was read against the code first.

| | Finding | Holds? | What was done |
|---|---|---|---|
| 1 | From about 300 m up, Turbo 1-3 fire no Comet | Yes, in the probe; on the page's lens Turbo 1 at 300 m did get one in all 6 of the GPU check's runs, Turbo 3 never | Not changed: the producer's (What's left) |
| 2 | Recess's forced gears make every tap a Comet past the fence, and a tap at a captain stops working | Yes, from the code (`feat/recess` isn't merged here; not run) | `HOOKS.md`: a Comet takes the place of the aim's mover, and the ask for the second account, `comet.clamp` returning false during a match |
| 3 | What glints changes 26, 21 and 16 times a second at full stick at Nonstop, Jet and Turbo 3 | Yes: the stretches were anchored to the map's origin along the heading, so a turn swept them past, with no hold and no latch | `ad28f3f`: counted along the bus's travel, the landing held for its stretch, latched on a press or the thumb's lift: 3.5, 6-6.5 and 5-6 at full stick in the probe's new rows (today's aim 3.7, 5.3, 10) |
| 4 | A late Comet keeps the far grid's height, so its splash and pillar stand inside the building it finds | Yes: `Splat.ts` kept `opts.y` for the late re-pick | `ac32971`: planned without it; the streak bends to where it comes down |
| 5 | The in-view rule ignores the ground: landings hidden behind ridges, arcs into hillsides | Yes | `ad28f3f`: the arc marched against the ground, lobbed over a hillside or landing on it; a ridge hiding it takes it on a building there. In the probe's new hill rows the arcs stay 1.2 m or more over the ground, and the one landing behind a ridge (52 m) is where the ridge has nothing to paint |
| 6 | The in-view prediction misses: water at Nonstop planned 6.2 %, 3.2 % at the impact | Yes, but the lens wasn't the miss: the margin was tested at the line's point on the far grid's 20 m, and it landed on the water | `ad28f3f`: tested where it comes down; the lens moved on by a climb only. Water at the impact: 5.7 % (Nonstop), 6.8 % (Jet), 7.7 % (Turbo 3) |
| 7 | The probe's "none raised two" can't fail; its 300 m gate has no upper bound | Yes | `0e92518`: paint at level 1 first; 1.3-3 s at 300 m |
| 8 | `Comet.plan` allocated a closure every frame | Yes | `ad28f3f`: methods |
| 9 | Frozen frames add motes at the streak's head | Yes | `ac32971`: a frame with no time adds none |
| 10 | `echo "$(date) ... exit $?"` logs date's 0 | Yes, in the laptop's scripts, outside the repo | This round's runners take `rc=$?` first |
| GPU | Comets into the bay are silent misses, each using up the full show's 20 s | Yes | `ac32971`: a splash of its paint and foam and a soft boom, and the full show given back |
| GPU | Turbo 1 at 300 m is a Comet on the page, not in the probe | Yes | Not changed: the lenses differ (What's left) |
| GPU | A Comet's tap frame costs more than a plain tap's (10-45 ms of game work against 6-16) | As measured, yes, but against a Cruise tap: the check's own classic tap from 300 m at Turbo 3 took 33.7 ms, and in Node a Comet's barf is 0.2-1.4 ms against a classic one's 0.2-0.6 with the same drop | Not changed: a big blast's frame from high up (What's left) |
| Look 1 | Off the bus's column: the streak reads as the trail continued, a pillar on it like a mast; arc it up through the sky | Yes: it landed within 4 % of the width of the bus every time, on a 6 % arc | `ad28f3f`: 34 m off the line, the side swapping; the arc 17 % of its chord, kept in frame. In the probe it lands 19-46 m off the line, its arc 15-22 % |
| Look 2 | One clear hit: a white frame blanked the bus; a ring; the pillar up faster; the bay dies | Yes | `ac32971`: a white-hot core held 3 frames, as wide as it's far and short of the bus, the frame round it as it was; a ring of paint over the roofs; the pillar up in 0.12 s; the bay's splash |
| Look 3 | Never lose the bus in the pillar; the lens drops read as pastel bubbles | Yes | `ac32971`: its near wall dithers away by distance from the lens; lobed splats at each row's own light |
| Look 4 | Each pillar its faction: Inferno a striped lighthouse, Atlantis a candy cane, the Elderwood a thin squiggle, Hyperglow pastel; pale bands wash out at 16:22 | Yes: every row lit at 0.72, the bands fixed in place | `ac32971`: each row at its own light step, bands streaming up with broken edges, a third of the fog, a least width of 6 game px, and the shapes above |
| Look 5 | The faction's contrail, the 5 % margin, no turbo Comet above about 300 m | The producer's | What's left |

**The checks after the fixes** (on `0e92518`).
- `tsc` clean at each commit. The gesture sim 860 of 860 (349 rows), turbo 37 of 37, hold 41 of 41 (28 rows), layout 300 of 300.
- The probe, 142 rows in 172 s, exit 1: 37 of its 412 checks fail, all the margin's and the gates' own numbers: at the floor the pass at Nonstop (1.84 s), Jet (2.39), Turbo 1 (1.91-1.92), Turbo 2 at 30 fps (1.71) and Jet downtown (1.87); at 300 m Nonstop's 5.6 s against the new 3 s bound, and Turbo 1-3 the classic shot; downtown Nonstop's wall paints 10. Every row that isn't a Comet lands where the baseline's did (82 rows); every Comet lands 0.70-0.73 s after the tap, 30 and 60 fps within 2 m (the dive and the climbs included); none raised two, on paint at level 1; the new rows pass (steering, the hills, 12-50 m off the line). The aim's frame, the Comet's plan in it, took 0.035 ms (median) to 0.066 ms in Node.
- `vite build` exit 0, `iosfloor` "iOS 15.0 parses every chunk".

On this laptop's GPU (Intel UHD 620), the built page (`0e92518`'s), one browser at a time under the lock. Frames and logs are kept on the laptop, outside the repo.
- `warmcheck --comet`: 38 programs at ready, none after the warm-up. The full show's Comet at Jet boomed, rose its pillar and put 13 drops on the lens; the lighter one boomed and put none. One frame over 100 ms after ready (183 ms), in the blasts' phase.
- `warmcheck` plain: 38 at ready, none after, no frame over 100 ms after ready. `--hose`: 38, none after; the tap splatted, the pour ran 3 s with 12 impacts and 41 blooms, ran dry and refilled, the homing shot was taken, fired, went white and hit; one frame of 217 ms, at the Hose's tap.
- `warmcheck --crew --comet`, all five factions: 38 at ready, none after; all ten Comets planned, fired, boomed and rose a pillar; drops 14 and 14 on Atlantis's and Hyperglow's full shows and 13 in Inferno's (its full one's pillar, flown through in the lighter one's phase), none on the rest. Twelve frames over 100 ms after ready: nine in the blasts' and factions' phases (to 683 ms), three in the Comets' (100 ms in Hyperglow's, 167 and 117 in Inferno's), which hold the jump back of 4 km and the city streaming in as well as the Comets. The last GPU check had none in the Comets' phases.
- `shots.mjs --det` against the merge's build (c09e415's), with the sky off and at golden hour: all eight views identical in both.
- The Comets by real touches and real flicks, golden hour pinned, each faction picked on the crest (a scratch script on the laptop): in all five factions a Comet at Nonstop (60 m) and one at Turbo 3 (150 m) over the city, and one at Nonstop into the bay. Every tap a Comet, landing 0.69 s after it. On the page's lens at the impact the landing sat 6.3-13.5 % over the bus, always in frame, but once 4.4 % (a press latched a landing that showed 4.0 %). Passed 1.16-2.21 s after the impact, the bus 17-43 m to its side. Every city Comet put drops on the lens, 8-14 (the last check had none where it landed 66-73 m off the line, or from 300 m); booms 0.53-1.0 s after the impact; 13-93 buildings painted. Pillars 0.4 s after the impact 299-467 x 58-88 game px at Nonstop and 144-174 x 28-34 at Turbo 3. The bay's: a miss, a splash and a soft boom, and the next Comet, 10 s later, played the full show. Frames: median 16.7-24.9 ms, the slowest 20.5-69.3 ms, but one of 364 ms 3.3 s after Elderwood's Turbo 3 impact with 11 ms of game work while the city streamed; at most 136 draws, 0.93 M triangles, 3,517 particles; the tap's frames 12.7-39.8 ms of game work (88.2 ms on the session's first Comet). No program made after the start, no page error, the console's two 404s, no request of the page's own over 400.
- What the stills show: the streak climbs out of the bus past the skyline, the hit is a white-hot spot beside and above the bus, not a white frame, with a ring of paint over the roofs, and the bus stays in view in front of its pillar as it passes. Inferno's pillar is a gold and crimson flame, Atlantis's a teal column with foam, Hyperglow's a neon magenta and cyan bolt, the Elderwood's a broad lime vine. At Turbo 3, 1.7-1.9 km out, the landing is still close over the bus's column on the screen, and the streak's tail runs up out of the frame's top as the bus flies under where it climbed.
- `tools/gardens/budget.mjs`: pass. The street, 250 m and 1 km: 140, 149 and 50 draws, 1.244, 1.240 and 0.688 M triangles, the gardens' own 0.409, 0.438 and 0.075 M; no pops in the flight or the snaps; 35 programs throughout.

## The review of step 2, and what it came to

The other run's review of `f07a16e..75ceea9` found no blocker, three majors, four minors and four nits, and the GPU check found one more. Each was read against the code first.

| | Finding | Holds? | What was done |
|---|---|---|---|
| 1 | A paused pour comes back with no stream | Yes: the stream's life was set when the pour opened | `a4047ab`: the stream lives while the Hose pours (`GeyserLive.open`), a new one each pour |
| 2 | A lock that takes a hold mid-pour can't fire | Yes: `fire` wanted a full belly | `a1a5d09`: it takes what's in the belly, at least 12 % |
| 3 | HOLD HIGH UP TO AIM often does nothing, silently | Yes: the sky and past the reach poured nothing | `a4047ab`: those pour as far as the reach goes that way; nothing in reach coughs |
| 4 | A press of 350 ms to the next frame does nothing | Yes | `40c28bb`: a still finger lifted before its aim began is a tap |
| GPU | A tap down 337 ms whose lift came 69 ms late poured | Yes: the guard covered one frame | `40c28bb`: the aim begins 70 ms past the hold |
| 5 | A handler that throws stops the frame | Yes | `a1a5d09`: every handler call and shot step is caught |
| 6 | A watcher never hears the hold end | Yes | `a1a5d09`: `end` goes to watchers too, who read `h.owner` |
| 7 | `warmcheck.mjs`'s `--hose` was uncommitted | No longer: `a33c1cd` had it | `fcc7ab3`: its homing target out of the houses |
| nit | `claim('hose')` after `release` skips the tank | Yes | `a4047ab`: a hold handed to the Hose asks the tank |
| nit | `Hose.owns` knows only the current pour | Yes | `a4047ab`: every pour's tag |
| nit | Captains and the player share the 8-shot cap; a refused shot is silent | Yes | `a1a5d09`: 4 for the player, 8 for the rest; a refused player's shot coughs |
| nit | Two still fingers lifted together: the second a hold released at once | Yes | `40c28bb`: a lift before the aim began is never an aim |
| hook | No getter for the player's bus, no "a building hides it" | Yes | `ab6dd9a`: `holds.bus`, `holds.inSight` |

Not changed: the per-frame cost (a hold's ray march, 0.06-0.18 ms here, and one closure and one small object a frame) is small next to the frame, and the Hose's impacts allocate through `Splatter.barf` as the asleep firehose did.

**The checks after the fixes** (on `fcc7ab3`): `tsc` clean at each commit. `vite build` exit 0, `iosfloor` "iOS 15.0 parses every chunk". The gesture sim 832 of 832 (335 rows), the layout sim 300 of 300, the hold sim 41 of 41 (28 rows), owner-check all passed. The hold sim's rows for the Hose's fixes landed with `a1a5d09`, so at `a4047ab` alone its old sky row fails.

On this laptop's GPU (Intel UHD 620), `fcc7ab3`'s build against `75ceea9`'s; frames and numbers are kept on the laptop, outside the repo.
- `shots.mjs --det`, sky off and at golden hour: all eight views identical between the builds (the fixes change nothing a still frame shows). The golden-hour views differ from the sky-off ones everywhere, so the setting took.
- `warmcheck --hose`: 35 programs at ready, none after the warm-up. The tap splatted, the pour ran 3.05 s with 10 impacts and ran dry, the tank refilled to 1. Its homing test shot flew and ended in the ground again, with its target 40 m over the roofs: a rise between, so that test still sees no hit (the flight below does).
- The flight in Inferno, real CDP touches, with the page's own down times. CDP's lifts reach the page 63-95 ms late. Down 172 and 293 ms splatted; 377 ms and longer poured (past 0.35 s by the page's clock, as ruled). None coughed.
- A hold on the sky poured, its stream landing at 1,470 m, the reach. City, then the sky, then the city again: the stream stayed open throughout, impacts went 2, 7, 13, and 0.5 s back on the city it still poured (`back-on-city-500ms`).
- The bus put 1.7 km up mid-pour for 2.6 s: the Hose stopped flowing, the stream stayed open, the tank held at 0.856 and the impacts at 2; put back, it flowed again within 0.7 s, impacts to 9, the stream there in the frame.
- A lock through the hook that claimed the pour at 0.6 s fired from 0.917 of a belly: white at 727 ms, hit at 1,522 ms, nothing refused. A tap after all that splatted. Programs 35 before and after.
- 3 s of plain flight: median frame 31 ms, draws 146 (157 most), triangles 0.88 M (0.98 M). 3 s of pouring: 27.9 ms, 144 (145), 0.86 M (0.86 M).
- The two console 404s are `/favicon.ico`, as the last check found.

Not checked: an A15, the producer's phone, Rainbow and the other factions on the GPU, Recess and `?life`.

## The review of step 1, and what it came to

The other run's review of `e0f1dde..3fbffc6` found no blocker, four majors, four minors and four nits. Each was read against the code first.

| | Finding | Holds? | What was done |
|---|---|---|---|
| 1 | The Moon's "tiles" row breaks at 85 m | No, not from the radius | Nothing changed (below) |
| 2 | A big blast's sparkles overrun the particles' 8,000 | Yes | `3a809d1`: a blast's buildings share one budget |
| 3 | The bigger splat lands before the gardens' budget (decision 20) | Yes, as an order | `feat/shots` goes to `main` after `feat/gardens` (below) |
| 4 | A tap at a car paints only that car | Yes | `f29c01f`: it paints the block round it |
| 5 | Once seen, `?crew` can't be turned off | Yes | `45ce62f`: `?crew=off` |
| 6 | The top left is a regrip for a right thumb | Yes | Not changed: it's where the approved plan puts it, a testers' button tapped now and then; the producer's call |
| 7 | `life.blast`'s centre ignores bridge decks | Yes | `f29c01f`: centred on the deck when the shot landed on one |
| 8 | Under `&mega`, MEGA is 42 % wider | Yes | Not changed: only `&mega` sees it, and the Hose sets its own radius when it's built |
| 9 | The open swatches sit in the toast's slot on 568 x 320 and iPads | Yes | Not changed: the row is open a moment, and a pick closes it as its toast comes |
| 10 | On a 320-wide screen the readout overlaps settings' touch area | Yes | Not changed: the readout takes no touches |
| 11 | A crest tap overrides `&paintas` | Yes | Not changed: the tap is the newer choice; this file's words now say so |
| 12 | warmcheck's crew spots are 155 m apart | Yes | `75475dd`: about 400 m apart |

**1, the tiles row.** The row times `GeoPaint.work` while a reloaded region's 16 tiles copy their paint out, and the copy is cut into rows with the clock read each row. Its data barely moves with the radius: 72 pictures at 60 m, 73 at 85 m. Its slowest frames are one copy row each, and Node's collector ran in none of them (`perf_hooks` gc entries). Across this run's three A/B sets, frames past 4.5 ms came 3 times in 22 runs at 85 m and 5 in 22 at 60 m, the worst at 60 m (33 ms). So it's the machine (another run's browser beside it), not the splat. It stays a single worst frame, as written.

**2, the sparkles.** `main.ts`'s bloom handler gives each building `14 + 8 x level` up to a 48-building blast, and fewer each past it, at least 5. A tap's sparkles in all, on the real city in Node (`p_fix.ts`), old against new: the Sunset from 300 m, 232 buildings, 5,104 / 6,960 / 8,816 against 1,160 / 1,392 / 1,856 at levels 1 / 2 / 3; at roof height, 79 buildings, 1,738-3,002 against 1,027-1,817. Two taps back to back come to at most 3,304. Blasts of 48 buildings or fewer are as they were.

**4 and 7, a mover's tap.** A tap at a mover on a floor, within `config.splat.moverFloor` (40 m) of the ground, the water, a bridge's deck or a roof under it (`Splatter.moverOnFloor`), is a tap's whole blast centred on it: the buildings and ground round it bloom, and `life.blast` paints it with every mover in the circle at the blast's hue. On a boat in open water it's never a miss: its circle paints the boats in it, and no water and no sign (`Blast.afloat`). A plane, higher, is still life's own hit alone. `life.blast`'s centre is the deck when the shot landed on one (an impact at or over a deck's underside, `City.overheadAt`), so a tap on the Golden Gate takes the deck's cars end to end. In Node: a mover's tap on Market at Van Ness bloomed 10 buildings, a plain tap there 14; off the Marina, no miss and `afloat`, where a plain tap misses; a car on Market and on the Golden Gate's deck (77 m) are on a floor, a plane 300 m up isn't; a tap on the deck is centred at 77.0 m, one into the water under it at 0.0, one on downtown's tallest roof (334 m) on the ground.

**3, the gardens' budget.** Nothing in `src/world/props/sprouts.ts` changes here: `feat/gardens` (ae95923) is that budget, and it merges into this branch cleanly. The flight that found it (Cruise over the Western Addition, twenty real taps, the median frame after them), on this laptop's GPU:

| | Triangles after | Most in flight | Draws after | Frame after |
|---|---|---|---|---|
| This branch, the fixes in | 1.73 M | 1.77 M | 152 | 50.4 ms |
| The same with `feat/gardens` merged in | 0.97 M | 1.04 M | 140 | 35.3 ms |

So this branch alone is over the 1.5 M ceiling at Cruise over painted blocks, and with the gardens' budget it's well under. It goes to `main` after `feat/gardens`, or with it, never before.

**The checks after the fixes** (on `75475dd`): `tsc` clean, `vite build` exit 0, `iosfloor` "iOS 15.0 parses every chunk". The gesture sim 752 of 752, the layout sim 295 of 295, owner-check all passed. The `--det` views, both skies, against step 1's build (3fbffc6): all eight identical. `warmcheck` on `?crew`, and on `?crew --crew` through all five: 35 programs, none after the warm-up; each faction's spot owned by that faction alone, at level 3. The one long task is still the page's first touch (220 ms at the first crest tap). The stills (from the street and from 250 m) paint the same buildings as step 1's, 44 and 170. The Moon's `paint-check` runs only timing rows that fail with another run's browser beside it; none of its code changed here.

## The Bomb and Curb together

`feat/shots` went to the Bomb (`feat/bomb` `7d67c14`, a fast-forward from `808a83a`), then merged Curb (`feat/curb` `6e2334d`, `docs/specs/shots/CURB.md`) at `644c40d`. Curb brings the second account's road side from `feat/life` `b65af07` (`src/life`), taken as committed. Both start from `feat/gears` `3a2b21f`.

**What conflicted, and how each was kept** (seven files, each with both sides' intent):
- `Flight.ts`: the Hose's belly (no refill while it pours, its 3 s refill after) moved into Curb's `breathClock()`, which `ride()` shares. Without that, the belly refilled on the street while the Hose poured.
- `Coach.ts`: `TAUGHT` holds aim 64, curb 128 and the Bomb 256, each on its own bit. Streak's lock takes 512 later, and the Lob 1024.
- `Controls.ts`: the Coach is made with MEGA's, the aim's and the Bomb's flags, and Curb's hint is off under `?nohud` and `?nocoach`.
- `Splat.ts`: `Blast` and `BarfOpts` carry the Comet's plan, the Bomb's jump and the moverBlock alongside Curb's `side`. The blast hands back the side next to the Comet and the jump.
- `main.ts`, five places:
  - The imports: `groundDeadline` with `LAYOUT_BANDS`, and `busShape`'s `D` as `BUS_DIM` for Curb's rear axle too.
  - Every blast but a plane's paints the movers in its circle, as the shots' 85 m does, now with its hitter's faction (life's C15).
  - Curb's drive-by sits in the tap's own barf (`Aim.tapOpts`) and widens it to `config.curb.byR` on the look's side.
  - `__game` keeps `particles` and `sprouts` and gains Curb's getter.
- `tools/controls.mjs` and `tools/warmcheck.mjs`: both the bomb and curb modes, and both header lines.

**Read where it merged clean:**
- `Aim.ts`: Curb's street front returns before the aim's own pick and the Comet, so the street has no Comet. Life's B1 fix sits in `pickMover`, under the Comet.
- `GroundPaint.ts`: Curb's `dab` lands as a small settled blast, never a wide one, next to the Bomb's deadline and `widen`.
- `config.ts`, the exhaust puff, the street sign's scale, and MEGA's charge, which stays off on the street.

After the merge, `4664190` fixed Curb's stills tool. Its wide lens had no `side`, which the kerb chase took in `0d72f38`, so the lens went to NaN. The run stood at its first wide still on `6e2334d`'s build just as on the merge's.

**The proof** (the laptop's `sb-checks/shots/integrate/`, `gates.txt` run by `gate.sh all`).

`tsc` is clean.

*The three-way rule.* Every Node sim, probe and check ran on four trees, 25 of them: the Bomb's gates.txt set, `s_curb`, and life's `curb.mjs` and `blast.mjs`. The trees were B0 `3a2b21f`, A `7d67c14`, C `6e2334d` and M, the merge. The rule, byte for byte:
- where A equals B0, M must equal C;
- where C equals B0, M must equal A;
- where both changed an output, M must be the clean three-way line merge of the two.

What varies between two runs of one tree is found from two runs of M and masked:
- the probe's aimMs and row times;
- `s_bomb`'s ms keys;
- feel-cost, feel-mesh's l0/l1 ms, feel-pick's pickUs and feel-super's timings;
- owner's cost line and row stamp;
- life-curb's msEach.

`s_bomb`'s wall-clock rows ("ms at most", "no frame over 8 ms") follow the laptop's load, not the code. A's ref failed 5 of 385 on them and M's runs 0, 5 and 2. Those rows are read apart, and any other failing row stands.

It printed `three-way: 74 of 74 outputs pass`:
- 40 unchanged by both;
- 10 the Bomb's change alone;
- 18 the Bomb's own sims, `s_hold`, the probe, `--bomb` and `s_bomb`, equal to A;
- 6 Curb's own, `s_curb`, `curb.mjs` and `blast.mjs`, equal to C.

No output was changed by both, so the rule's third case never came up. Curb changes none of the shared sims, as CURB.md says of `s_gesture` and `s_turbo`. Where the two meet on the street, the belly's clock in `ride()` among it, the proof is `s_curb` equal to C's byte for byte, and the GPU rows.

*`vite build` and `iosfloor`:* "iOS 15.0 parses every chunk".

*The `--det` views,* sky off and golden hour, against the builds of B0, A and C, by the same rule pixel for pixel: 8 of 8 pass each time. The Bomb changed `painted` and `swap`, about 1.21 M and 11.8 k pixels, Curb none. M is A's on those two and all four's on the rest.

*On this laptop's GPU:*
- `warmcheck` plain, `--hose`, `--comet` and `--crew --bomb`: 38 programs at ready and 0 after. All 20 Bombs at their tier.
- `warmcheck --curb` on the arterial with `?life`: 41 at ready, 0 after. It landed, its lane painted itself, and it got off by a pull.
- `controls.mjs bomb`: 38 of 38. Bomb IIIs raised 135-1,458 buildings at 93-128 draws and at most 1.03 M triangles.
- `controls.mjs zone curb`: zone 11 of 11, curb 15 of 15. Curb drew 95-143 draws and 0.94 M triangles at most on the street, painted two cars, and made 0 programs.
- `gardens/budget.mjs --bomb`: passes, with 35 programs throughout.
- The Bomb's hint: due 2.4 s after the third splat.
- Curb's stills (`curb-shots.mjs`, now fixed): exit 0. All 16 are on the street, the bus's middle 2.55-2.76 m over the road, at 87-121 draws.

The curb row runs on GEARS.md's residential street at 16:20 SF time. On the arterial, Curb's lane ends about 14 s in (by design), and the row rolls a minute: there it failed 4 of 15 on C's own build and on M's alike. With the real clock at 5 am no car came beside.

The first `gate.sh all` ran with the arterial row and passed 14 of 15, that row failing. The second passed 14 of 15 too, with the hint the one fail: its first tap read as a drag, the Bomb's own tool's first touch. A rerun of that row passed.

*Not checked:*
- the Hose poured on the street (it pours from its usual mouth, not CURB.md's window, which is still to build);
- a Bomb charged on the street;
- Curb's hint and the Bomb's sharing the toast;
- anything on an A15 or the producer's phone.

## The extras: Sonic Boom and Waterfall (feat/extras)

Two of SHOTS.md's three extras, built on `feat/extras` from `feat/shots` `fd6d413` with the plan written on the laptop (outside the repo) and the producer's calls taken as picked: the ring lands ahead and you fly through it; no hint for either; only the tower you hit runs; in Recess the ring and the pool paint but take no square (an ask, `HOOKS.md`). Belly Flop waits for Streak. Each is behind its own link, `&boom` and `&falls`, read as `&bomb` is: without them no frame, sim row or `--det` view changes, and no shader's source differs by a byte (`boomed()` and `fallsed()`, as `pogoed()`).

**Sonic Boom** (`7f28e8c`, `c2aaa26`, `f99016a`; `src/game/Boom.ts`). The flick into Turbo 3 (`Controls.onRung`, the last level's `'turbo'` event; a flick Recess's gate swallows never reaches it) breaks the barrier again: Mach 1's set piece and its N-wave (`Controls.crack`: the cone, the vapor ring in the faction's spray, the flash, the kick), and its hoop flies ahead and down from the nose and lands flat as the ring over the band's rooftops (`TurboFx.crack`; `plan.top`, the median of twelve roofs round the band + 4 m, at least 14 m over the ground), its band narrowing to the ring's and its six rows the faction's spray (`uHoopRows`), lingering half a second and tearing. The ring lands 0.3 s after the flick where the bus will be 1.3 s on from Jet's floor, 1/375 s more a metre higher, up to 2.25 s. It is 0.94 times the tap's circle from the height over it (120 m from 150 m over the ground, 213 m from 500), its band 0.75 to 1 of that: `Splatter.barf` with `BarfOpts.inner` paints only the buildings reaching into the band, one level each, dealt the rainbow by angle, capped by the band's area (`blastCap` on its equivalent radius); its ground is the band alone (`LAYOUT_RING`: GroundPaint's rows take an inner edge, the ground out to its full radius, ragged 0.08, eight short rays). The shockwave races out from the middle and the band blooms behind it 0.4-0.6 s after the landing, and as it does a crown of the band's hues goes up from it, 40 columns of three puffs (`Boom`'s `crown` hook in main.ts). The landing (`boomImpact`) flings its blobs from the band's inner edge, with half a tap's flash and kick (the crack had the big one), the splat's boom and the bells; no splash or fountain in the hole, no geyser, no hit-stop, no belly. At most once in 10 s; inside them the flick is today's. Over 500 m over the ground the crack alone (and the 10 s spent); over open water a ring of white spray and the 10 s unspent, as a Comet's miss keeps its full show. `life.blast` hears `SuperTag { kind: 'boom', charge: 1, id, inner }`. On the Moon's ground (`CraterPaint`) a crater wholly in the hole is out of it, the ring reaches its full radius, and the far windows show twelve strokes round the band where a blast's one would be a disc.

**Waterfall** (`003bf13`, `489b92d`, `8554592`; `src/world/falls.ts`, `src/fx/Falls.ts`, `src/audio/fallsSfx.ts`). A blast whose primary is over 40 m tall and that struck it 40 m up or more (a roof, a Comet on a face) pours: once a tower, a Bomb once, never a drive-by's, a mover's, a hose's, a ring's, a landmark's or a bridge's. The tower takes the next of four slots (`uFalls`: its index, the impact's height, its time, the speed): its 2 m columns, 55 % of them, run down its walls from the impact at 55-88 m/s (the flood's speed, up to 1.6 times), in its paint's hue a step brighter and their 2.5 m heads brighter still, over whatever paint it had, ahead of the flood into the grey, drying from the top 4-8 s after each point was wet. The building program finds a vertex's slot with four compares into a flat varying, so only those towers' pixels run the test. Drops fall off the footprint's sides onto setbacks or the street (main.ts's `landingY`), one per 1.25 m of fall up to 160, as far down as the runs are, a third splashing (`Particles.fling`, the spray's rows). As the fastest runs reach the street (0.45 s for 40 m, 2.3 s for 200) the pool lands: `ref.rad` + 10 m in the tower's hue, out to its rim, drawn while the runs fall and revealed outward from the walls at 6 m/s (`LAYOUT_POOL`, a slower reveal than any wave), over the tap's pinwheel, calling `life.blast` with `SuperTag { kind: 'falls' }`. A gurgling trickle runs with the runs, a quarter of the drops plop as they land, and the pool lands on a slap with four notes falling down the pentatonic.

**How to fly them** (on the branch's preview once it's pushed):
- `&boom` (`?crew&boom` for the factions): flick up to Jet, then three more for Turbo 1, 2 and 3, under 500 m. On the third the sky cracks, a rainbow hoop shoots ahead and slams down flat on the city, and a second later you fly over its middle as the ring of buildings blooms and its colours go up round you. Again inside 10 s it's a plain flick. Try it over the Western Addition, and over the bay for the spray.
- `&falls` (`?crew&falls`): tap the top of a tower downtown from Cruise or Express. Paint runs down its walls, drops fall off its edges, and a pool spreads round its foot as the runs reach the street.

**Its looks** in the faction's rows: the hoop and the vapor ring in its spray, the crown in the band's hues (the faction's spray), the runs in the tower's paint, the drops in the spray, the pool in the ground's rows. Stills at 1179 x 2556 in Rainbow, Atlantis and Inferno for the ring and Rainbow, Hyperglow and the Elderwood for the falls are in the laptop's `sb-checks/shots/extras/stills/`.

Where this departs from the plan:
- The ring lands 1.3 s ahead from Jet's floor, not 1.0: at 1.0 the GPU's stills had its band bloom at the frame's bottom edge as the bus crossed it, half out of the frame. At 1.3 it blooms in the lower half (s_boom: 0.66 of the height from 150 m, 0.75 from 490) and the bus crosses its crown half a second later.
- The hoop lies over the band's rooftops, not on the ground: downtown's towers buried it.
- The ring's ground reaches its full radius (a tap's reaches 0.8 of it, lobed by a quarter, which left a 30 m band broken), and the pool's too.
- The ring's ground is drawn in flight as a tap's, not by a Bomb's deadline: the deadline's first slice was 6.7-7.5 ms of a frame in Node from 500 m.
- The runs' columns are 2 m, 55 % running: 1.5 m and 62 % read as a faint shimmer from Cruise's chase.
- The crack plays from over 500 m too and spends the 10 s there.
- **Streak's lines are left out**, for Streak's builder: the plan's "Landing: ... Streak's faction voice up its chord" (the ring's landing) and "the voice's notes falling" (the pool's: here a pentatonic of four triangles stands in), and the table's "neither counts nor ends one" (the ring isn't a tap, and a pool isn't one either: Streak should count neither). Streak touches `Splat`, main, config, Controls and the tools in other hunks.
- **The Coach's bits**: aim 64, curb 128, the Bomb 256, Streak's lock 512 and the Lob 1024, so a later flop's hint, if it ever has one, is 2048, not the plan's 1024. Neither extra has a hint (the producer's third call).

**The checks** (on the branch's head, `e6a29ac` and the docs; `sb-checks/shots/extras/gates.txt` lists every one, `gate.sh all` runs them; what each printed):
- `tsc` clean at each commit (`npx tsc -p tsconfig.main.json --noEmit`, exit 0).
- **No link**: every sim, probe and check of fd6d413 (the gesture, layout, hold, turbo and curb sims, the probe and `--bomb`, the fifteen feel sims, `s_bomb`, owner-check, life's curb and blast tools: 26 rows, 74 outputs) run on the branch and compared byte for byte with fd6d413's own run in this worktree before the first change (`compare2.py`, the integration's masks): "compare2: 74 of 74 outputs equal the base". The first `gate.sh all` said 72 of 74: `s_bomb`'s `liftGc` (whether Node's collector ran in the lift's frame) was false in the base and true in the run, every other number the same; it is masked now beside its other timings. Every exit the base's (the probe's 1, `s_bomb`'s 1 on its wall-clock rows, as the integration's).
- `s_boom` 38 of 38 run alone twice (the Western Addition and downtown from 150 and 490 m: 40-46 buildings in the band raised by one, 80-88 from 490, none in the hole or past it, the band's ground painted 24 of 24 samples and the hole's none; the band blooming at 0.66 of the frame's height from 150 m and 0.75 from 490; the bus 0.7-5.6 m from the ring's middle at its nearest; the worst frame 1.5-7.5 ms, the flick's barf and the ground's slice in it). In the gate, on `e6a29ac`: 38 of 38, the measured rows' worst frames 0.3-5.7 ms.
- `s_falls` 126 of 126: 199 towers over 40 m within a kilometre of the Financial District (roofs over 40 m up at their middles), 2,301 buildings under; 20 towers each poured once with their drops and their pool (16 of 16 samples round the foot in its hue on most), none under 40 m, none hit again, none from a face 20 m up, a drive-by, a car, a plane or a hose.
- `vite build` exit 0; `iosfloor` "iOS 15.0 parses every chunk".
- The `--det` views against fd6d413's build, sky off and golden hour: 8 of 8 "identical (1179 x 2556)" each (on the build before `e6a29ac`, which changes only a ring's ground).
- `warmcheck`, each "no program made after the warm-up (0: [])", 38 programs at ready (41 on Curb's street): plain 3 of 3; `--crew --bomb` 24 of 24 (every Bomb at its tier in five factions); `--curb` 3 of 3; `?crew&boom&falls --crew --boom --falls` 15 of 15 (a ring from the flick into Turbo 3 and a tower's pour in each of the five factions; the Elderwood's first tower didn't pour, its second did).
- `controls.mjs boom` 27 of 27 (Rainbow, Atlantis, Inferno; the Western Addition and downtown): 15-25 buildings raised, none wrong, the bus 0-19 m from the ring's middle, at most 134 draws, 0.90 M triangles and 1,556 live particles, 38 programs at ready and 0 made after. `controls.mjs falls` 15 of 15 (Rainbow, Hyperglow, the Elderwood): a pour each (54-62 drops, its pool 16 of 16 round the tower that poured; the tap aimed at 13547 hit its neighbour 13541 twice), at most 88 draws, 0.43 M triangles and 3,690 particles, 0 programs made.
- `gardens/budget.mjs --bomb`: "pass: the gardens stay under 450000 triangles in every view, the hold at 0.9 or more, no pops in the flight or the snaps, the hold let out after it, no page errors".
- The first `gate.sh all`: 9 of 15 rows passed, and the six that didn't were fixed and rerun on their own: `sims` (the `liftGc` mask), `s-boom` (two rows' frames over 8 ms under the Lob's run, a frame with nothing but the flight in it at 21.9 ms; a row over 8 ms is flown again now), `warm-plain`, `warm-crew-bomb` and `warm-extras` (warmcheck's new reports were declared inside the phases' block, so every run stopped on a ReferenceError before its report; and the Elderwood's tower), `controls-falls` and `budget` (not started: 909 MB free on C: at that moment, gate.sh's floor 1,000). The reruns: `sims` exit 0, 74 of 74 (its run began on `2b61ece`, and `e6a29ac` landed during it); `warm-plain`, `warm-crew-bomb` and `warm-extras` exit 0; `controls-falls` and `budget` exit 0; then on `e6a29ac`'s build `build`, `s-boom`, `controls-boom` (27 of 27, at most 138 draws, 0.89 M triangles, 2,011 particles, 0 programs made) and `warm-extras` (15 of 15) exit 0. The `--det` views, `warm-plain`, `warm-crew-bomb`, `controls-falls` and `budget` ran on the build before `e6a29ac`.

**What's left**, the producer's calls first:
- **Downtown at Jet's floor the ring hides among towers taller than the bus**: a scatter of painted towers and a glimpse of the hoop. Over the Western Addition it reads at a glance. Landing the band on the towers' tops, or lifting the bus's view for a beat, would read downtown too; the producer's to pick.
- **The crown** reads faintly on the stills: its puffs rise about 15 m (the puffs' drag, by hand), a curtain under the bus rather than a wall it flies through. A wall of paint 60-100 m tall the bus crosses (a ring of streaks or a cylinder of drops) is the extraordinary one; not built.
- **The runs** read as lighter streaks over the tower's own new paint; on a grey tower they run ahead of the flood. A darker wet edge or a gloss line down each run would read harder.
- Streak's lines (above), and the Recess and life asks in `HOOKS.md`.
- Belly Flop, after Streak.
- **Not checked**: an A15, the producer's phone, the sounds by ear, a ring on the Moon's ground on the GPU (the code's and CraterPaint's; no Moon row), a ring or pool in Recess, movers in the hole on `?life`, and the Bomb pouring on the page (s_falls has taps only; `Falls.pours` takes a Bomb's).

## The gardens' budget (feat/gardens)

The shots paint more and faster, so the rooftop gardens have a triangle budget first. Before it, 1,146 level-3 roofs in a Recess match drew 4.04 M triangles of gardens alone.

**What it is.** The gardens (`src/world/props/sprouts.ts`) draw at most 450,000 triangles, the view and the sun pass together. That's the floor's 1.5 M less the city's own 0.8-1.0 M. Near the bus they're as rich as before. Each garden is drawn only where the view sees it or its shadow. Past 250-350 m the small growth gives way to a lighter far form. Over the line, every reach is held in a little each frame, the farthest gardens going first. They're let out again as soon as there's room. The design and the numbers are in `docs/specs/gardens/BUDGET.md`.

**How to check it.** Build, serve the build, then:

```bash
node tools/gardens/budget.mjs http://localhost:4179/ shots/tmp/gardens            # exit 0 is a pass
node tools/gardens/budget.mjs http://localhost:4179/ shots/tmp/gardens-lift "--q=&lift"
node tools/gardens/budget.mjs http://localhost:4179/ shots/tmp/gardens-exact --budget=1e9 --flight=0   # exactly what's seen, no hold
```

It paints the 1,200 buildings nearest Alamo Square to level 3, reloads, and holds the bus at the street, at 250 m and at 1 km. It fails when:
- any view's gardens pass 450,000 triangles (`--line`);
- the hold is under 0.9 in a view (`--minhold`), so the line can't be met just by pulling the reaches in;
- a 480-frame flight finds an element missing, a far form too near, or a shadow left out, the shadows of gardens off the screen included;
- the hold doesn't let out again back at the street after that flight;
- one of six snaps of the lens at the street (90, 270, 180 degrees and back, one render each) leaves anything missing;
- the page throws an error.

It needs a real GPU for its milliseconds. Its triangle counts and audits hold anywhere.
