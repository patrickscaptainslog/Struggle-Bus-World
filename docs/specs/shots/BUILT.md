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

**The Comet** (`3baf3d3`, `src/game/Comet.ts`; the page's in `bad1288`).
- **When.** A tap while a gear drives the bus at 225 m/s or more (`Flight.turbo.speed`): Nonstop engaged, Jet, Turbo 1-3, on the street and on the Moon. School Zone, Cruise and Express never fire one.
- **Where.** Along the aim's flat way (the nose, turned by a look), as far as the bus flies from the tap to 1.5 s after the impact, at most 1.9 km (`config.city.loadRadiusHigh`). The breath's stall is in it: the drive's spool and the breath's 0.85, stepped as Flight and TurboDrive step them. The probe's passes come within 0.01 s of the plan's own.
- **In view.** By the lens the player sees, moved on by the bus's travel to the impact, it must land at least 5 % of the height above the bus (`config.comet.above`). Where it doesn't it moves out 20 m at a time, and where it never does within 1.9 km the tap is the classic shot.
- **The flight.** 0.6 s after the 0.09 s inhale, whatever its length, on an arc topping 6 % of its chord. A building standing into the arc takes it on its face, on an 8 m march. One less than 0.5 s of the bus's travel ahead of it at the impact is lobbed over instead: the arc tops out higher, up to 30 % of the chord.
- **The splat.** A tap's barf at the landing: `blastRadiusFor(drop)`, `life.blast` with the whole circle, one level a building, no ribbon from the mouth and no hit-stop. Over water it's a miss with its refund. A landing whose tile isn't in at the tap is planned 0.2 s before the impact (`BarfOpts.late`).
- **What glints** with a gear at speed is the Comet's landing. The aim's own pick runs on under it, so where the Comet stops applying, the tap is exactly the classic one.
- **The seam.** `Comet.ts` chooses the tap's shot in one place (`chooseShot`), with the Lob's slot: when both apply, the farther landing wins. Recess's `Comet.clamp`, and a captain's Comet, are in `HOOKS.md`.

**Its looks** (`bad1288`, `src/fx/CometFx.ts`, `src/audio/cometSfx.ts`). Each part is in the faction's own paint rows.
- **The streak.** A white-hot head and a tail of motes along each frame's stretch of the arc (`Particles.comet`, as the homing shot's), 400 a Comet. Rainbow's tail is six bands side by side, Atlantis's a foam helix, the Elderwood's leaves falling off it, Hyperglow's a zigzag, Inferno's embers rising.
- **The impact.** The flash and the bloom's notes on time; no kick or hit-stop that far off.
- **The pillar.** 200 m of paint light standing on where it landed, up in 0.35 s and stippled away over 2.5 s, with a crown of spray at its top. Rainbow's is a hexagonal prism of six bands under a crown of stars; Atlantis's a foam helix opening into a sea geyser that rains back; the Elderwood's a vine spiralling up into blossom; Hyperglow's a zigzag bolt re-rolled 20 times a second; Inferno's a licking flame column flecked with obsidian.
- **The lens.** The bus within 40 m of its axis, under its top, gets 8 to 14 drops on the glass, which run down and fade in 0.5 s.
- **The late boom.** When the sound of the landing would reach the bus (the distance over 343 m/s plus the bus flying into it): a crack over a rumble, and the camera's kick. A whoosh off the mouth at the launch.
- **Lighter.** The full show plays on the first Comet in 20 s, and while Streak's seam (`cometFx.streakOn`) says a streak is on. The rest get a 120 m pillar for 1.2 s, half the motes, no drops and a softer boom.
- **The cost.** The pillars are one InstancedMesh (576 triangles each, up to four) and the drops another, made at boot and warmed (`registerWarm('comet')`). A pillar's faction, hue and shape are numbers per instance into constant tables in its one program, so one program each covers all five factions. The streak and the crown are the particles' own program. Two draws at most while they show.

**The Moon** (`1495faa`). `CraterPaint.aim` moves a shot onto the crater that glints, as before, but a Comet keeps its 0.6 s flight and its arc there, where every other shot lobs for up to 2.6 s. The crater at the landing glints by itself, since it reads the aim point. `CometFx` slides with the Moon's map, and the boom there is a thump through the ground. `src/moon` is in neither account's list: this is the shots' Moon side.

**Where this departs from the plan.**
- The landing is the middle of a stretch of its way 0.12 s of the bus's travel either side, anchored to the map, where the plan held what glints while the landing stayed near it. A held glint made 30 and 60 fps land 40-190 m apart, so the plan's own 2 m gate failed; anchored, they land within 2 m. What glints changes at most every 0.24 s.
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

## How to fly it

The branch's preview: `https://struggle-bus-world-git-feat-shots-patricks-projects-9ff6e721.vercel.app/`
- `?crew`: the faction button. Tap the crest, pick a faction, splat. Then drop `?crew` from the link: the button stays. `?crew=off` takes it away on that phone, and the bus paints as Rainbow again.
- `?crew&life`: the same with the living city. One tap on a park or a busy street paints the people and cars inside the circle. A tap on one car or a ferry paints the block round it too.
- `?mega`: MEGA as it was, to compare.
- Step 2, the Hose: hold a finger still on the city, high over the bus and away from it, for a bit under half a second. It pours where you hold, and a drag sweeps it. Hold on the sky and it throws as far as it reaches that way. Watch the bus's belly band drain and listen to the hiss climb. A quick tap there still splats. With `?crew`, try it in each faction's colours.
- Step 3, the Comet: flick up twice from Cruise for Nonstop, or on to Jet and Turbo, and tap high on the screen, off the bus. A streak flies ahead and lands where you'll be in a second and a half or so, a pillar of paint light goes up there, and you fly through its spray; the boom comes a beat later. The first in 20 s is the full show, the next ones lighter. With `?crew`, try each faction's.

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

- **The margin against the pass** (the plan's risk 3). The in-view rule, 5 % of the height over the bus by the lens moved on, moves the landing out past the 1.5 s at Jet's floor: 2.40 s in the probe, 2.60-2.76 s on the page. At Nonstop's floor 1.87 s in the probe, 1.42-1.63 s on the page. It's `config.comet.above`: the producer trades the two on the phone.
- **No Comet in turbo from about 300 m up.** At 300 m Turbo 1-3 find no landing 5 % over the bus within 1.9 km, so the tap there is the classic shot, which lands under the bus and out of the frame. The plan worked out 1.1-1.4 km by hand; at speed the chase lens sits low behind the bus, with the horizon only about 10-15 % of the height over it. Ways on, the producer's: a smaller margin; a reach that grows with the height, since the city loads 950 m further ahead up high; the Lob's step answering taps up there.
- **The page's lens and the probe's differ.** At each impact on the page the landing sat 7-12 % over the bus; the probe's lens had it 6-8 %. The probe drives the real CameraRig and TurboLens, but not in the page's order to the frame.
- **Downtown, a Comet on a tower's face paints few buildings:** 11 at Nonstop (the gate is 20; today's tap there paints 6 to 22).
- **Over water** the Comet's a miss with its refund: no pillar and no boom. Water is the Torpedo's later.
- **What glints changes at most every 0.24 s** at speed (the stretches the landing snaps to), where a strobe would be every frame.
- **Not flown** on `?life`, `?moon` (the Moon's side is built, not flown), in Recess, on an A15 or on the producer's phone. The boom wasn't listened to. `controls.mjs` has no `comet` mode yet.

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
