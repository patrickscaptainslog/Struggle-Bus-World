# The Lift: the first look at the stages

Step 6's first slice (FACTIONS.md section 5, "the fantasy proof"). What the producer approved: "a first look at the stages: Rainbow's colours and the Lift, where houses float and you fly under them, in one neighbourhood behind a link, with stills for your phone." Rainbow's stage 4 is FACTIONS.md section 2's "4 · Liftoff": every painted house jumps and doesn't come down. FACTIONS.md had each on its own rainbow geyser; after the producer's notes on the stills (below) nothing holds them up: they float over a lake of paint, riding a swell across the neighbourhood like boats on water, at heights all their own.

This page says what the slice is, how to try it, what's built and where, what it costs on the one GPU we have, what the review, the outside look and the producer found and what came of it, and what's left for the whole of step 6.

## The producer's three notes (2026-11-06)

In the producer's words, on the stills: "Just concerning the raised houses: let's have more fun with it 1) no pillars below holding houses up, I just want them to float 2) the houses sort of bob up and down like they're on water, 3) the houses are not all equal height off the ground - I want it to look more dynamic. Other than that it looks great!" Everything else stayed: the lake, the drips, the wave out from the park, the slow motion, the hold rule, the colours, the low shot.

1. **They float.** The geysers are gone: their draw, their 600 instances, their program and its warm-up, the splash ring. They never were in the flight's field. Nothing joins a house to the ground. The bellies, lit from the jet before, now catch the lake's light: a net of caustics in the paint below's colours (the house's hue a step on, its trim where two lines cross) wandering over them as the water moves, brighter the nearer the water (a low house glows, a high flyer is a darker shape against the sky). The drips stay, one every 4 m of edge (3 m was 9k of the undersides' 11k triangles). The lake's rings run out from under each house's centre, pushed out as it comes down and drawn in as it rises.
2. **They ride a swell.** Two long swells cross the neighbourhood, the same way in every city: 200 m long every 9 s (22 m/s, from the north west of the map, weight 0.62) and 130 m every 6.8 s (19 m/s, from the south west, 0.38). Each house heaves with the swell under its centre, a little late (up to 0.9 s, by a hash: neighbours ride it slightly out of step), by 3 m at the crest for a small house and 1.4 m for a big building (+-15 % by a hash); it pitches and rolls with the water's slope (85 % of it), about 2 degrees on average and never past 4.9, with a wobble of its own (0.7 degrees); and it drifts by 0.45 m on a period of its own (11-17 s), so it never looks mechanical. The lake shows the same swell: lighter on its crests, with a broken line of foam along them, so the eye ties house and water. The house turns about its belly's middle; its roof's patterns and leaves are taken back to where they rest on it, so they ride the house and don't swim over it. The swell takes a house over between 0.8 and 2.4 s after its launch, as the bob did.
3. **Their heights are their own.** By a hash, 12 % low (9-16 m: a house to fly over or weave round, too low to pass under), most in the middle (34-62 m), 12 % high flyers (72-94 m); big buildings keep to the lower half of the middle and never fly high; no roof over 105 m above its ground. Then, as the wave places them out from the park: never two touching neighbours within 6 m of each other on Alamo Square (0 of 471 touching pairs; the closest are 6.00 m apart). In denser rows it's mostly, not always: Amsterdam's pick has 9 of 1,129 touching pairs closer (the closest 2.95 m), London's 63 of 1,666 (2.66 m), where the room over the low houses wins, and a low house stays low only with room over it: every house within 24 m floats high enough (its lowest belly 22 m over the low house's top, its domes allowed 6 m, less 2 m for each metre past 6 m off, the flight's own count of a belly beside it), or the low one goes to the middle. The low ones are placed first, so their neighbours rise round them. On Alamo Square: 46 low (12 %), 287 in the middle, 67 high flyers (17 %); **75 % leave room for a 30 m pass** under them (their lowest belly with the swell, the drift and the lean at 38 m or more), up from 62 % with the hash alone and from 77 % before the notes.

## Try it

Preview of `feat/factions` (it works once the branch is pushed):

**https://struggle-bus-world-git-feat-factions-patricks-projects-9ff6e721.vercel.app/?lift&lifted**

| Link (add to the preview's address) | What you get |
|---|---|
| `?lift&lifted` | Alamo Square staged at level 3, Rainbow, for this session only, then lifted as a wave out from the park. Start here. |
| `?lift` | The real path: three Rainbow breaths take a house to level 3, the fourth lifts it and its painted neighbours. |
| `?lift&lifted&slowmo=0` | The same with no slow motion at the lift-off, to compare (decision 13). |
| `?lift&lifted&hood=Fillmore District` | Another neighbourhood, by its name in `hoods.bin`. |
| `?lift&lifted=atlantis` (`elderwood`, `hyperglow`, `inferno`) | The same neighbourhood in another faction's stage 4: its lake, its undersides and its sky piece ("Stage 4 in the other factions", below). |

What to try, in order:

1. Open `?lift&lifted` and wait for the fog to clear. The bus starts at the neighbourhood's edge on the sun's side, facing in. Watch the wave go out from the park.
2. Fly in low, at about the height of a three-storey house, and keep going under the houses. The camera drops to a long, flat shot. Look up: the bellies catch the lake's light in a moving net, paint drips off their edges, and the lake ripples out in rings from under each house. The low ones you go over or round.
3. Pull up under a house. The bus stays under the layer (as under the Golden Gate's deck). To get on top, fly out from under first, then climb.
4. Climb to about 250 m and turn back: the whole neighbourhood floats over its lake, the swell running through it from the west.
5. Open `?lift` alone, breathe on one house four times, and feel the slow motion at the jump. Then the same with `&slowmo=0`. Keep it or let it go is the one question this slice puts to you.

`&lat=&lon=` and `&heading=` still override the start. There's no Golden Gate opening under `?lift`.

## What it is

- **Where the lift lives.** In memory only (`src/world/Lift.ts`): never in the paint texel and never in a store. The GPU computes each house's motion from its crouch start, rest height and seed in `tLift`, a texture laid out like `uPaint`; the CPU runs the same function (`src/world/liftGlsl.ts`) for the flight and the aim. A reload brings every house down. `&lifted`'s paint is `PaintState.stage`, session only, and kept across a tile streaming back in; a real hit afterwards saves as it always has, a level-3 record, never a lift.
- **The motion.** A 0.30 s crouch (35 cm down, a 16 % squash), a launch at 3.2 times its height a second with a 16 % stretch, a 13 % overshoot at 0.57 s, settled in about a second, then the swell forever (the producer's note 2, above). Rest heights 9 to 94 m by a hash and its neighbours (note 3). `tLift` holds two texels a house: its crouch start, rest and seed; and, `uLiftRows` rows down, its centre, ground and heave.
- **Slow motion**, at stage 4 only (decisions 12 and 13): a tap's or MEGA's lift-off at 0.35x for 0.9 s of wall clock, the wave's front reaching the bus at 0.30x for 1.2 s, none again within 8 s. The firehose's lifts take none.
- **What's drawn.**
  - The house moves in its own vertex shader, every part (`src/world/buildingMaterial.ts`).
  - Its roof's dome or spire, bunting and turf ride with it; its small growth (tufts, bushes, trees, planters) bursts off as petals at the jump, which is the triangle bound (`src/world/props/sprouts.ts`).
  - One draw for the undersides: lit from below by the lake, a net of caustics in its colours, thin paint drips off the edges (`src/world/liftDraw.ts`). Nothing else: no geysers, nothing under a house.
  - The lake, in the terrain's shader (`src/world/terrainMaterial.ts`): it floods 12 m past each floating house on the neighbourhood's squares, so a lifted block is one lake, yards and streets with it, rings rippling out from under each house as it heaves, and the swell on it.
  - The floating shadows, through a twin of each building mesh on the sun's layer with a lift-aware depth material: no draw added, because a tile under the neighbourhood makes no caster proxy.
  - Landmarks, bridges, decks, tagged squares and parks never lift. Only Rainbow on Rainbow lifts; other factions' level-3 houses re-pop as before.
- **Flight and aim** (`src/world/LiftField.ts`, hooks in `src/world/City.ts`). A floating house is a deck: under it the floor is the ground, over it its roof, both where the swell has it now (its centre's heave, exactly the shader's, with the lean's reach, 0.085 times its reach from its centre, and 0.5 m of look ahead either side; in its launch's first 1.5 s the whole slab of its overshoot and the swell's reach). The aim sees the house as drawn, its lean included (within 5 cm of the GPU's turned house), and so does a breath landing on its roof (`City.roofAtPart`, `buildingAt`). A low floating house, too low to pass under, is a wall from the ground to its roof, as a grounded house is: the flight goes over it or round it. A breath from below passes under a house, one from above lands on its drawn roof. Anything under a house's middle sees it from below, and the flight's underside counts the bellies within 24 m (16 m before the heights spread: a belly 36 m under the bus is now counted over it as its cell comes in), so a bus pulled up under one house is let down under a lower one ahead, never put on its roof through it. Which side of a house the bus is on (under or over it) is decided by its middle as the house comes into the underside's 24 m, and kept as the bus comes in; the bus may still turn to go over it until it is 6 m past its half length off it, and under it only while every cell of the house still counts its belly over the bus, so turning never lets the bus down in one step (`LiftField.side`). The bus's body is kept out of the bellies. Grounded neighbours keep their chimneys and parapets in the floor.
- **The hold.** A house never jumps into the bus or the camera: it holds its crouch, up to 3 s, only while it would rise into something over its roof; one beside it rises past.
- **The camera** (`src/game/CameraRig.ts`). Under the houses it drops to the Golden Gate's low shot, made longer and flatter (120 m back at 3 degrees), with the lens kept 9 m under the bellies and clear of a house beside it. The look stays on there (under the Golden Gate it's off), so the controls' ruling holds: a landing near the bus flies, one anywhere else looks.
- **Triggers** (`src/game/Splat.ts`). A lifting or lifted house's paint is never rewritten. A breath of another faction on a staged house saves nothing. One blast can't schedule past the 600-house cap.
- **Flag off**, nothing is fetched (the Lift is its own chunk, `hoods.bin` isn't asked for), no shader source differs by a byte, and every query is the code it was. `src/render/warmup.ts` compiles the Lift's programs before play.

## The numbers

All measured on the development laptop's Intel UHD 620 in a desktop browser at 1179 x 2556. **None of it is a phone's**: nothing here has run on an A15, on an iPhone or on Safari.

**Stills after the producer's three notes** (draws / triangles; the floor is 120-200 draws and 1.0-1.5 M triangles). The geysers' draw and their 28-29k triangles are gone, and the undersides went from 11.1k triangles to 8.8k (a drip every 4 m):

| View | Noon | Golden hour |
|---|---|---|
| Under the Painted Ladies | 99 / 0.99 M | 121 / 1.17 M |
| Low pass at 30 m | 117 / 1.02 M | 131 / 1.15 M |
| Mid-wave | 137 / 1.18 M (70 up) | 155 / 1.21 M (18 up) |
| 250 m | 186 / **1.50 M** (1,100 over the floor); another 250 m frame, held a few seconds on, 193 / 1.53 M | 117 / 0.84 M |
| 1 km | 94 / 1.31 M | 80 / 0.74 M |

The noon 250 m view is still at the floor's edge, not under it: the geysers' triangles came back, but the uneven heights show more of the floating houses from there (fewer hide behind their neighbours). The shed gardens (about 220k, estimated) and the full-mesh shadow twins (about 52k) are still most of what's left.

**Before the notes, after the fixes** (the same views):

| View | Noon | Golden hour |
|---|---|---|
| Under the Painted Ladies | 93 / 0.92 M | 120 / 1.18 M |
| Low pass at 30 m | 116 / 1.02 M | 130 / 1.15 M |
| Mid-wave (about 19 houses up) | 136 / 1.18 M | 153 / 1.19 M |
| 250 m | 187 / **1.54 M**, over the floor | 116 / 0.86 M |
| 1 km | 95 / 1.34 M | 81 / 0.77 M |

**After the notes, flown at real time** (the same path, back to back with the build before the notes, noon): median frame 16.8 ms either way, p95 50 ms either way, worst 100 ms (183 ms before); 118 draws and 1.02 M triangles median (119 and 1.02 M before); 0 frames with the bus in a house, the least room to a drawn belly 8.8 m (6.0 before), no program compiled in flight, no page errors. An earlier pair of runs the same hour had the lifted median at 33 ms with flag off at 16.7: the laptop's state, not the build (the build before the notes measured the same way, in-page, was no faster: 21-26 ms a frame against 21-26).

The noon 250 m view is the one over the floor (1.52 M before the look's fixes; cutting the geysers from 8 sides to 6 brought it down from 1.56 M). Most of what's left is the shed gardens (about 220k, estimated) and the full-mesh shadow twins (about 52k more in the sun pass over the neighbourhood's 9 tiles). Before the gardens were staged already shed, 400 level-3 gardens made the frame before the wave 2.06 M triangles.

**Flying the same path at real time with real touches** (about 33 s, noon, before the look's fixes):

| Mode | Mean fps | Frame ms p50 / p95 / p99 | Frames over 50 ms | Draws median / max | Triangles median / max |
|---|---|---|---|---|---|
| Flag off | 49.6 | 16.7 / 33.5 / 33.6 | 1 | 99 / 149 | 694k / 892k |
| `?lift`, nothing up | 46.4 | 16.7 / 33.5 / 33.6 | 1 | 105 / 155 | 839k / 1.02 M |
| `?lift&lifted` | 39.7 | 16.8 / 33.7 / 66.7 | 29 | 123 / 171 | 1.04 M / 1.24 M |

After the fixes, `?lift&lifted` on the same path: mean 37.9 fps (flag off 51.3), 59 frames over 50 ms, but the bus now spends 461 frames under the houses instead of 114. `?lift` with nothing lifted already costs about 6 draws and 145k triangles.

**Other checks that ran:**

- `npx tsc -p tsconfig.main.json --noEmit`: clean at every commit.
- `node tools/iosfloor.mjs <build>`: "iOS 15.0 parses every chunk". The Lift chunk is 26.85 kB.
- `node tools/factions/lift-check.mjs --gpu` after the notes: 53 lines, all passed (it was 41 before them), the GLSL on this GPU agreeing with the TypeScript (below). `tools/world/hoods-check.mjs` and `tools/factions/owner-check.mjs` weren't run again after the notes.
- Flag off against the base build (c73f3bd), `tools/shots.mjs --det`, all 8 views, sky off and golden hour, after the notes: all 16 frames identical, and `stats.json` byte-identical.
- `tools/warmcheck.mjs` on `?lift&lifted&skipintro` after the notes: 38 programs (the geysers' is gone), 0 created after the warm-up.
- `node tools/iosfloor.mjs` after the notes: "iOS 15.0 parses every chunk". The Lift chunk is 23.9 kB.
- Fly-under after the fixes: 0 frames inside a house, 0 over a roof, least room from the bus's point to a drawn belly 6.07 m (the bus's roof is 5.1 m up), largest step up under a belly 0.11 m. No programs compiled, no page errors. After the notes: 0 frames inside a house, least room 8.8 m, largest step up under a belly 0.59 m.
- Hit to lift (`?lift`, scripted breaths, not real taps): three breaths took the house to level 3, the fourth lifted 20 houses. Slow motion was 900 ms of wall clock for 460 ms of game time. With `&slowmo=0` there was none.
- Brown: 0.00 % of pixels in all ten stills.

**After the review of the notes** (head 570ff7d, the same laptop): `tsc` clean; `lift-check` 55 lines, all passed, and `--gpu` 57, all passed (dy within 4.45 mm, the lean within 7.0e-6, the aim within 5.00 cm); "iOS 15.0 parses every chunk", the Lift chunk 24.6 kB; flag off against c73f3bd, all 16 `--det` frames identical and `stats.json` byte-identical; `warmcheck` on `?lift&lifted`, 38 programs, 0 after the warm-up, no frame over 100 ms after ready; the stills' draws and triangles as above (noon 250 m still 186 / 1.50 M). The fly-through (the same path and touches as after the notes): 0 frames in a house, least room from the bus's roof to a belly 1.68 m, 2 steps over 3 m (let-downs of 3.65 and 5.03 m; 3 before, up to 4.48 m), no program compiled, no page errors; 131 draws and 1.05 M triangles median, 178 and 1.23 M at most; the frame median was 33 ms over the whole run (16.8 ms after the notes; earlier tonight one build gave 33 ms and then 16.8 ms on this path an hour apart), and with no flag-off run beside it this run says nothing about the build's cost.

**A regression not found yet.** Under `?lift&lifted`, the climb now has frames of 100 ms or more that the first build didn't: 6 on the head build (11 before a tile fix), against 0-1 on the first Lift build and 0 flag off. There are no main-thread long tasks, so it looks like GPU time. The cause isn't known.

## What the review and the look found, and what came of it

**The GPU check** found one real flight bug: flying under the layer and pulling up, the bus went up through a lower floating house onto its roof in one frame, a 36 m jump, at the same spot on both runs. Fixed: a floating house counts as a deck to anything under its middle, and the bus is let down under a lower belly before it gets there. `lift-check.mjs` now has that case.

**The code review** found no blocker, three majors, six minors and some nits.

| Finding | What came of it |
|---|---|
| The look was dead under the houses (the low shot scaled it to zero) | Fixed: the look stays on in the Lift's low shot. The controls' ruling is unchanged. |
| A staged house hit before the wave dropped to the ground and relaunched | Fixed: the wave never reschedules a house that's already up. |
| The firehose took the hit's slow motion | Fixed: the firehose takes none. |
| The floor sat up to 5.9 m under grounded neighbours' chimneys | Fixed. |
| Cells at a tile's west and north edges went stale | Fixed: a tile's arrival clears two cells on every side. |
| Staged paint was lost when a tile streamed back in | Fixed. |
| Another faction's breath could save a level-3 record on a staged house; one blast could pass the 600 cap | Fixed. Still open: the petals and sparkles take the `&paintas` faction's colours, because the particle palette is global. |
| A hand-lifted house's top stayed at its shed trees' height | Fixed. |
| GPU buffers leaked in the sprouts, and three allocations ran every frame | Fixed. |
| Nits: an empty object per building with the flag off, `textureSize` before the lake's bounds test, the hold ignoring the overshoot | Fixed. |
| Nits: sub-metre squash seams at launch, the CPU's lift one frame behind the GPU, one Amsterdam cell with 9 buildings (over the 8-pair limit), the shadow twin during a region swap's prep | Not changed. |

**The review of the three notes** (d4f62d4..58df5ab) found no blocker, one major, five minors and four nits.

| Finding | What came of it |
|---|---|
| Major: beside a floating house at the height of its middle, 10-25 m off, the bus was let down up to 7.85 m in one 1/120 s step (`lift-check`: 7 of 68 runs over 3 m). The side was decided again by the house's middle every step out there; a house heaving past the bus's height turned to under with its counted belly already under the bus | Fixed in `LiftField.side`: decided as the house comes into the underside's 24 m and kept; the bus may turn to go over it until 6 m off, and under it only while every cell of it still counts its belly over the bus. Those runs now: 0 of 68 over 3 m, the largest 2.20 m. What's left is the risk below |
| The wave's first frame: `nearPlaced` for 400 houses through `City.buildingsWithin`, 56-73 ms | Fixed, and more was found: in that same frame `stage()` took 38-54 ms (six `buildingsWithin` a house for its hue, then its garden). Both read the Lift's own 32 m index of its houses now, and `&lifted` stages 50 houses a frame out from the heart; the wave waits for the last. Worst `Lift.frame` 24 ms, the wave's own 13 ms (84-99 ms in one frame before, on this laptop). The 399 houses' rests, lows and hues are the same, house by house |
| A breath's landing (`City.roofAtPart`, `buildingAt`) added the centre's lift only, up to about 0.7 m off a leaning roof | Fixed: the drawn lift at the point, its lean in it (`LiftHooks.dyAt`). At the probe's points the lean is up to 1.0 m |
| "Touching neighbours 6 m apart" holds on Alamo Square only | This page says so now (note 3, above) |
| The camera's lens clamp and the low shot's line-of-sight test don't see the low floating houses | Not changed: in the review's 48 poses no lens was ever inside one, and the low shot is what the producer liked. A code gap, not a seen one |
| Nit: the second texel upload's result was ignored | Fixed: either refused, the whole texture goes up. Its stale comment is fixed |
| Nits: the normals aren't leant (the light doesn't change as a house rocks), and the per-house arrays are sized to all 164k texels (about 9 MB) | Not changed. Leaning the normals is a cheap way to make the swell read from 250 m: a look change for the producer's eye, not a fix |

**The outside look** (an art director's first look at the stills): "a rainbow town on candy-striped stilts", not yet "houses riding geysers". The 250 m views were the best frames; the low pass, the fly-under itself, was the weakest: a dark slab overhead and a forest of posts. Its three changes, all made (the geysers have since gone, on the producer's first note, above):

1. **Geysers that read as water**: one round, tapered jet per house with a foam mushroom under the belly, a spiral rushing up, a splash ring at the foot, and rest heights spread so rows break up.
2. **The underside lit**: a gold halo and caustics round each jet, drips off the edges, the lens kept 9 m under the bellies.
3. **One lake per lifted block**, flooding yards and streets, with rings out from each jet. The 1 km still now frames the neighbourhood mid-frame.

Its other notes, not done: the seven-colour halo, the park lifting as an island, the jets' long shadows across the lake at golden hour, and the lifted roofs looking poorer than level 3's (their gardens are shed: that's the triangle budget). It also noted that at golden hour the lit grey city turns peach and competes with paint's oranges; that comes from step 5's golden sky, not this slice.

## Shortcuts and calls, surfaced

- **Two calls for the producer.** The 30 m pass: after the notes 75 % of Alamo Square's houses leave room for it (77 % before them, 87 % before the first spread; `lift-check`'s line is 55 %). Climbing over the layer: pulling up under the houses keeps the bus under them; to get on top you fly out first. With the high flyers it now climbs far under them (to about 50 m in `lift-check`'s pulls).
- **A known risk: flying inside the layer at its walls' height.** The review's let-down is gone (above), but `lift-check`'s new weave (`j.`: 24 houses near the heart, passed 4 and 12 m off on four headings, held at their walls' middle, the stick swinging the bus in and out) shows the class it belonged to: 26 of 192 runs have a step over 3 m (up to 14 m up or down in one 1/120 s step) and 8 runs put the bus's body in a drawn house (270 steps in all). The build before these fixes did the same on the same runs: 25 over 3 m, 9 into a house. It happens where a house the bus must go over stands beside one it must go under with no room for the bus between them: the 2.5D flight (one floor, one ceiling) has no height to be at, and the hard floor wins. At real time with real touches on the fly-through's path (21-55 m), 0 frames in a house and two let-downs of 3.7 and 5.0 m beside the low houses. Two things tried and dropped, each worse in `j.`: a floor ramp beside the walls, and a "room over it" rule. The real fix is the flight steering round what it can't go over or under, a look ahead along its heading in `Flight.ts` (shared with the Golden Gate). Another design answer is for the houses to make way, nudged aside or up by the bus like boats bumped on water: the producer's call.
- **The low houses are walls.** A house too low to pass under (12 % on Alamo Square) is an obstacle from the ground up, and its neighbours rise round it to leave the bus room over it, so a low house sits in a ring of tall flyers. In denser rows (Amsterdam's and London's picks) that pushes 28-30 % of the houses into the high band.
- **Memory**, with the flag on only: the Lift's per-house arrays and the second texel a house are about 9 MB more on the CPU and 2.6 MB more on the GPU for San Francisco's 164k texels.
- **The open question:** keep the lift-off's slow motion, or let it go. Its feel on a phone is unjudged.
- A floating house sheds its garden's small growth as petals: the alternative is about a million triangles in Alamo Square alone. `&lifted` stages the gardens already shed.
- Per-building lifts stand in for the squares' stage 4: no five-second wait (the areas' clock, `feat/recess`), and Rainbow on Rainbow only. The areas will call `lift.start(ref, t)` when a square reaches 4.
- `&lifted` doesn't stage the streets (ground paint saves): the lake under the houses is the ground paint.
- The sound is borrowed from existing calls.
- Parks stay on the ground, the other four factions don't lift, and there's no stage-1 mark yet (it's the areas' five-second wait made visible).
- The far field past the loaded regions still draws the neighbourhood on the ground.
- A floating house's shadow has no domes in it (its twin draws the mesh's collapsed growth as it is).
- The stills tool (`tools/factions/lift-stills.mjs`) runs on the game clock in real time, not as `--det` views, and has no palette tests.

## What wasn't checked

- An A15 at 30 fps, Safari on iOS (it reads float textures in a vertex shader here), and any phone at all.
- How the swell, the wave and the slow motion feel. Stills can't show it: four frames 2.25 s apart from the street show the houses heaving and leaning, but from 250 m the few metres don't show in a still.
- The motion's GLSL against the TypeScript was checked on this laptop's GPU through Edge (`lift-check --gpu`: 4,096 samples, dy within 4.5 mm, the lean within 1e-5, the aim's linear lean within 5 cm of the turned house), not on an A15.
- The hold rule as a scripted check, and a lift made by real taps.
- The frame spikes in the climb (above).

## Stage 4 in the other factions

FACTIONS.md section 4: "a still of each faction at stage 4 from the street and from a kilometre up. You judge all five looks before they're built." These are those stills' looks, built far enough to judge from a still and a short loop, behind `&lifted=<faction>`. The producer's ruling on the Lift holds in every faction: nothing joins a floating house to the ground (FACTIONS.md's anchor chains, root stilts, hydraulic legs and glowing chains are all out); the houses float, ride the swell and keep their uneven heights, the same motion, heights and flight as Rainbow's; and each faction keeps its lake.

### Try it

| Link (add to the preview's address) | What you get |
|---|---|
| `?lift&lifted=atlantis` | Alamo Square in Atlantis's colours, lifted over the sea, the Sky Sea over the park |
| `?lift&lifted=elderwood` | The Elderwood: over its marsh, the Sky Wood |
| `?lift&lifted=hyperglow` | Hyperglow: over its black mirror, the Skyway, the houses snapping round on the beat |
| `?lift&lifted=inferno` | Inferno: over its lake of fire, the Hellmouth |
| `?lift&lifted` | Rainbow, as it was, to compare |

`&hood=` still picks another neighbourhood: the pieces are placed from its own squares and streets. The bus paints as the link's faction (its breath and petals too), unless `&paintas` says otherwise. The sky piece forms in the first five seconds after the wave starts, so wait for the wave. After the merge, feat/shots' `?crew` button can drive the same key.

### What each is

All four sit over the neighbourhood's heart square (hoods.bin), 220 m over its ground (FACTIONS.md's sky marks, 200-250 m), each one draw and one program, made only on its own link and warmed at boot (`src/world/liftSky.ts`). Everything is placed from the neighbourhood's data: its squares, its streets (the tiles' OpenStreetMap centrelines) and its houses (a fall or a column stands on a street clear of them and rises straight up through the floating houses' layer, 125 m, before it bends; an island floats over the layer under it), so any city with a `hoods.bin` gets its own. Each is built a part a frame (an island, a fall, a column) from the frame after staging: the Sky Wood's longest part is 5-9 ms once the page is warm, up to about 30 ms on a page's first build (the numbers, below). They form after the wave (`uSkyT0`), move in their vertex shaders, and take no paint and stop nothing: the bus flies through them.

- **Atlantis, the Sky Sea.** A lens of ocean 0.62 of the neighbourhood across (180-380 m; 370 on Alamo Square), 48 m thick: from under it a ceiling of teal sea, the sun's shafts fanning out from its middle and bands of light running out with the swell, schools of fish turning in it, foam at its rim; on top waves running across it, their crests bent by a second set, foam broken in streaks along them, glints, and deep indigo toward the rim, where you look into it. Five waterspouts pour up into it from the streets round the heart: a skirt of foam on the street, a rope of water straight up through the floating houses, and over them a funnel flaring out as it bends in to meet the Sea, spraying there, the water running up in streaks. Two whales, 60 m long, take turns: the first plunges out of the belly three seconds after the Sea has formed, the other breaches out of the top at 13.6 s, each every 13 s after. The lake under the houses is the sea come ashore: deep teal, the sun's net on its floor, foam on the swell and the rings, a foam shore. The undersides drip water and catch the net.
- **The Elderwood, the Sky Wood.** Seven islands of earth over the squares farthest apart (the heart's 72 m across its radius, the others 32-48), at 180-235 m and never lower than the layer under them allows: mesas of silver-lilac rock (never brown) stepping in at ledges of strata down to a craggy base, lime root veins glowing in it, moss turf, one to three old trees each (silver bark, moss crowns with violet blossom, gold lantern fruit), a ring of standing stones whose glyphs glow lime, and long thin glowing roots hanging below, swaying, stopping 3 m over the layer. They rise into place in turn after the wave, growing out of small as they come, let their roots down, and then breathe. The lake is a lotus marsh: dark moss water, glowing roots running through it, lily pads with violet flowers, fireflies, a silver stone shore. The houses trail glowing roots (the drips, 4.5 times longer, never more than 35 % of the way down) and their bellies catch the roots' light.
- **Hyperglow, Overdrive.** The Skyway: the neighbourhood's real streets copied 220 m up in lanes of light, 16 m across with three lanes a way, magenta edges with glowing sides 3 m deep, pulses of light running both ways along them, its paths in thin magenta, a ring of light at every junction. It snaps out from the heart 70 m a beat, each lane flashing white as the front passes, and on every beat after a pulse of white runs out from the heart along every lane. The floating houses turn in sharp snaps on the same beats: 45 degrees (a big building 90) once every 8 beats of 0.5 s, each on its own beat, counted from its own lift, with a lock-click past it and back and a white-hot flash of its walls, where the turn can't cut a neighbour at its height, floating or on the ground (`Lift.turns`; 0 draws: the house's own shader, from tLift's spare channel, its walls' light turning with it). The lake is a black mirror under a cyan grid, square ripples snapping out from under each house and magenta pulses running out along the grid. The bellies are a chrome circuit: cyan lines, a magenta pad in each square, a white pulse running out on the beat; the drips beads of cyan light.
- **Inferno, the Hellmouth.** Four columns of molten lava rise from the lake at street points round the heart, flaring on the street, straight up through the floating houses and twisting in over them, and the black sun swells out of where they meet, 120 m across: black glass with a violet sheen at its limb and cracks of crimson fire throbbing on a slow heartbeat, its corona an eclipse's (a thin gold rim, tongues of flame licking out of it, crimson halos stepping down into a dither). Then the columns pour up into it and are gone (FACTIONS.md's "fuses into a black sun"), by 6.4 s. Embers rise from the lake. Over the neighbourhood a black-violet ceiling of smoke, lit red from under it toward its middle, its edge breaking up into the sky: it faces down only, so from the street the sky is black-violet and from a kilometre it isn't in the way. The lake is fire in FACTIONS.md's colours, crimson and black glass, gold only in the brightest flame: floes of black glass drifting with the swell, molten scarlet in the cracks between, gold in the brightest, crimson rings throbbing out from under the houses. The bellies are black glass lit crimson from below, the drips molten scarlet.

### The numbers

Measured on the development laptop's Intel UHD 620 in a desktop browser at 1179 x 2556 (`lift-stills.mjs`, head d22efd5, after the review's and the look's fixes). **None of it is a phone's.** Draws / triangles, then the frame time over the 90 frames before the still (median / 95th, ms); the sky piece's own triangles in the first column.

| Faction (piece's triangles) | Street, noon | Street, golden hour | 1 km, noon | 1 km, golden hour |
|---|---|---|---|---|
| Rainbow (none) | 142 / 1.18 M, 33.2 / 50.0 | **217** / 1.42 M, 33.3 / 50.1 | 103 / 1.27 M, 33.3 / 33.6 | 79 / 0.73 M, 16.7 / 33.5 |
| Atlantis (6.4k) | 143 / 1.19 M, 16.7 / 33.6 | **218** / 1.43 M, 16.8 / 50.0 | 92 / 1.27 M, 33.1 / 33.5 | 80 / 0.74 M, 16.7 / 33.5 |
| The Elderwood (16.0k) | 143 / 1.20 M, 33.3 / 33.5 | **218** / 1.44 M, 16.8 / 50.0 | 92 / 1.28 M, 33.2 / 33.5 | 80 / 0.75 M, 16.7 / 33.5 |
| Hyperglow (0.4k) | 143 / 1.18 M, 16.7 / 50.0 | **218** / 1.42 M, 16.7 / 33.5 | 92 / 1.26 M, 33.3 / 33.5 | 80 / 0.74 M, 16.7 / 33.4 |
| Inferno (4.9k) | 143 / 1.19 M, 16.7 / 33.4 | **218** / 1.43 M, 16.7 / 49.7 | 92 / 1.26 M, 32.9 / 33.4 | 80 / 0.74 M, 16.7 / 33.4 |

Each piece is one draw and one program; the lakes and undersides add none. **The golden-hour street view is over the floor's 200 draws in every faction, Rainbow's included** (217-218): it's that view's (the lamps and the low sun's city), not the pieces'. Every other view is inside 120-200 draws and 1.0-1.5 M triangles, or under them. The frame times on this laptop wander between 16.7 and 33 ms from page to page whatever the faction, so they don't rank the pieces. The Skyway is light on Alamo Square because its streets are: about 100 segments of the tiles' centrelines cross its 17 squares (SF's long blocks); a denser city gets more lanes.

The stills and the loops: `C:/Users/Utku/sb-checks/factions/stage4/stills/` on the laptop (`<faction>-<sky>-lift-street.png`, `-1k.png`, `<faction>-motion.gif`, `sheet.png`).

Checks on d22efd5 (`sb-checks/factions/stage4/gates.txt`, `gate.sh all`, every row exit 0): `tsc` clean; the build and "iOS 15.0 parses every chunk" (the Lift chunk 64.9 kB, from 24.6 at e0f1dde); flag off against e0f1dde's build, `shots.mjs --det`'s 8 views sky off and golden hour, all 18 files byte-identical ("9 files ... 0 differ" twice); `warmcheck` with no flag and on `?lift&lifted` for each of the five, 0 programs after the warm-up (35 with no flag, 38 Rainbow's, 39 each other faction's: its piece); `lift-check --gpu` all passed; the controls and feel sims, `lift-check`, `owner-check` and `hoods-check` against e0f1dde's outputs: "53 files (7 with numbers masked, 1 of them on its noisy lines only), 0 differ" (six outputs that differ between two runs of the same code compared with their numbers masked, owner-check's only on its four noisy lines); `clear` (the falls, columns, islands and turns against the floating houses, above): "all clear". The stills tool took all 20 stills and 5 loops with no page error and no shader error. The sky piece's longest part in a frame, on each still's page (its first build there): 1.4-3.3 ms the Skyway, 5.2-7.4 the Hellmouth, 5.8-19.2 the Sky Sea, 9.3-30 the Sky Wood.

### Stand-ins and what's not built

- **Hyperglow's turns are drawn only.** The flight and the aim see each house unturned: a 45-degree turn moves a corner up to about 0.3 of its length off where the flight thinks it is. The full one turns LiftField's houses with them (about half a day).
- **The bus flies through every piece**: the Sea, the islands, the Skyway, the sun, the falls and the columns. Nothing in the sky stops it or lets it land; whether it should (a sea to dive into, an island to land on) is a design question for when they're built.
- **The set pieces cast no shadow and take no paint.** Painting is the whole point: whether the Sea, the islands, the Skyway and the sun take paint is a design question for later (a rival's sky piece painted over?).
- **No sound.** Atlantis's "inside it the sound goes underwater" isn't built; the wave's sounds are Rainbow's borrowed calls.
- **The whale is a low spindle with fins, the trees blobs on tapered trunks, the corona one flat square facing the eye.** Each reads at a still's distance; close up they're simple.
- **Only the link's faction.** A real square reaching stage 4 (the areas, feat/recess) picks its owner's look; here the whole neighbourhood is one faction, and only one sky piece exists on a page.
- The lake and the undersides of a mixed neighbourhood already draw each house's own faction (they read the owner from the paint), but the sky piece is the link's.

### What the review and the look found, and what came of it

The review of e6c90a1..8324b0f found one blocker, three majors, six minors and two nits; the outside look (an art director's eye on the stills, frames only) asked for changes to each look and raised a new call. Each was checked against the code and the frames first. What held is fixed in the commits after 8324b0f; what's the producer's is in the calls below.

| Finding | What came of it |
|---|---|
| **Blocker.** Inferno's lava columns ran through floating houses (two houses, by 6.6 and 2.2 m, 9 s into the wave), one Atlantis fall by 2.1 m: a column's foot was kept clear of houses only as a score, and a column swung 18 m and leaned 40 m in through the layer | Held. Fixed: a fall or a column now rises **straight up through the floating houses' layer** (to 125 m over its foot's ground: the highest roof, 105 m, plus the jump's overshoot and a margin) and only bends, twists or sways over it. Its foot must be clear of every house by its radius, its ripple, a house's lean and a margin (11 m for a fall, 12.3 for a column), or it isn't placed (open ground like a park is tried before that). `clear` (a new gate) checks each piece's own centrelines against every floating house's box at 3, 5, 7, 9 and 15 s into the wave: on the final build no cut at any of the five moments, all 5 falls and 4 columns placed; the nearest a riser comes to a floating house's box, past its own reach and 4 m of lean, is 1.8 m (Inferno's) and 2.4 m (Atlantis's) |
| **Major.** Building the sky piece stalled one frame up to 280 ms (the Sky Wood), 57 ms (the Hellmouth), 41 ms (the Sky Sea) | Held. Fixed: a blob no longer makes an icosahedron of its own, a street point's clearance is taken once, open ground is only searched when the streets don't do, and the piece is built in a frame of its own, not on top of staging's last 50 houses or the wave. The build now: in 6-8 parts (the Skyway 1), the longest part of the real build 3.4 ms (the Skyway), 4.0 (the Hellmouth), 6.7 (the Sky Sea) and 33.5 ms (the Sky Wood, its first build on the page: 13.7 ms on an earlier run of the same code, and 5-9 ms in three rebuilds after it, so the 33.5 is the page's first, cold run, not the work) |
| **Major.** Hyperglow's houses spun instead of snapping: the turn count ran from the session's clock, and the swell's take-over scaled the whole count, so a house lifted at 60 s spun 720 degrees as it rose | Held. Fixed: a house's turns count from its own lift (the first of its beats once the swell has it), whole snaps from there; and the Skyway snaps out and pulses on the same game-clock beats the houses snap on |
| **Major.** More long frames in the climb with the four factions (4-7 of 100-184 ms against Rainbow's 1) | Didn't hold as the pieces' cost: the gate run on 8324b0f that was still going when this began had Rainbow at 4 such frames (3 in its climb) and the four at 3-10, with no long task on the CPU over 100 ms in any of them. They're this laptop's GPU in the climb, faction or not. On the final build: 0 programs after the warm-up in all six (35, 38, 39 each), and frames over 100 ms after ready: Rainbow 5 (2 in the climb), Atlantis 0, the Elderwood 1, Hyperglow 2, Inferno 3, with no long task on the CPU |
| The Elderwood's islands rose up through the floating houses (they started 140 m low) | Held. Fixed: each rises into place from at most 40 m below, growing out of small as it comes, and never lower than the layer under it; its roots only grow down once it's in place |
| The Elderwood's roots could reach floating roofs over a square higher than the heart | Held (and the rock too, over a hill). Fixed: each island floats over its own ground's highest under its rim plus the layer, and each root stops 3 m over that. `clear` puts every rock and root point, through the rise and at rest, at least 30.9 m over the nearest floating roof (with its domes) under it |
| Hyperglow's turns ignored grounded buildings (one of 35 swept into one) | Held. Fixed: a house doesn't turn where its sweep meets a grounded neighbour from its base to its roof, or any building the Lift doesn't lift. `clear`: 31 houses turning, none sweeping a building at its height, at any of the five moments |
| Inferno's drips could touch the lake under a low house in the swell's trough | Plausible, so fixed: the other four factions' drips never hang more than 35 % of the way to the ground (the Elderwood's roots did already). Rainbow's are as they were |
| The GIFs played at about twice real speed, and 4 frames a second missed most of Hyperglow's 0.09 s snaps | Held. Fixed: each frame plays for the game time it stands for; the loops run from half a second into the wave to 12 s, so the pieces forming are in them; Hyperglow's at 8 frames a second, and its houses' walls flash on the snap |
| The sims gate masked every number in owner-check's log, and skipped the exit files | Held. Fixed: owner-check's numbers are masked only on its four noisy lines (its two cost lines, a time stamp, one random draw), every other line must match to the digit, and the exit files are compared too |
| Nit: the bus flies through the Sea, the sun, the columns and the islands; it wasn't in the stand-ins | Added to them (below) |
| Nits: `HYPER_BEAT` copied `LIFT_TURN.beat`; the lake's faction test by number; the Inferno lake's "9 hashes" is 27; the street lens's comments said 170 and 240 m | Fixed (the lake's cost is 27 hashes a pixel; the comments say about 200 m) |
| For the producer: Inferno's lake was mostly orange, Rainbow's orange | Taken to FACTIONS.md's own colours for Inferno, "crimson and wine ... gold only in the brightest flame": the lake's fire, the columns, the undersides' glow and drips are molten scarlet now, gold only in the brightest cracks, no orange. Say if you want the orange back |

**The outside look**, what held and what came of it:

- **Atlantis's falls read as table legs under a tray.** Held: five thin tubes leaning in under a disc. They're waterspouts now: a skirt of foam on the street, a rope of water straight up through the houses, and over them a funnel flaring out as it bends in to the Sea, spraying where it meets it.
- **The Sea read as a flat two-tone pool, its belly like the houses' bellies.** Held: the top's one foam band was a single 175 m wave. The top now runs with short waves whose crests a second set bends, foam broken in streaks along them and glints, going deep indigo toward its rim; the belly has the sun's shafts fanning out from its middle and bands of light running out, not the bellies' net. The whales' turns are set so the first plunges out of the belly three seconds after the Sea has formed (7-11 s into the wave: in the loop and the street still), and the other breaches out of the top at 13.6 s, each every 13 s after.
- **The Sky Wood's islands read as turnips with claws, its rune stones as white boxes, and from 1 km it read as a park.** Held. The islands are mesas now, their sides stepping in at ledges of strata down to a craggy base; the roots long, thin and glowing; the stones tall standing stones tapering to a broken top with glyphs cut in big strokes; the crowns carry violet blossom in patches and gold lanterns big enough to read from the climb.
- **The Skyway read as a selection box from 1 km.** Held: the magenta fence round the neighbourhood's edge did it. The fence is gone; the lanes have glowing sides 3 m deep, the junctions are rings, and on every beat a pulse runs out from the heart along every lane.
- **Hyperglow's bellies read as stickers, and the snaps barely showed.** Held. The bellies are a chrome circuit now, cyan lines, a magenta pad in each square, a white pulse running out on the beat, and in the loop (8 frames a second now) the bellies' and the lanes' pulses mark every beat; a house's walls flash white-hot as it snaps, though in the frames looked at no flash was caught (one house in eight snaps on a beat, for a quarter second).
- **Inferno's sun read as a spiked sea mine.** Held: a ring of 90 triangle spikes. It's an eclipse now: one square facing the eye behind the sun, a thin gold rim, tongues of flame licking out of it, crimson halos stepping down into a dither.
- **Inferno's columns read as a lander's legs.** Held, and FACTIONS.md has them fuse into the sun: they now rise (0-2.4 s), the sun swells out of where they meet, and they pour up into it and are gone by 6.4 s. The call is still yours (call 2).
- **Rainbow is the plainest of the five.** Held: its halo isn't built (in "What's left"). Not changed here.
- **The wall colours: Atlantis's, the Elderwood's and Inferno's houses are flat single-colour slabs; coral, gold, pearl, violet and lime never show.** Held for Atlantis and the Elderwood (Inferno's keep a dark wave), but it's step 5's colours (`tools/factions/colours.ts`, the houses' paint), not this stage's: call 8, not changed here.
- The call it raised on the pieces' height is call 5 below.

### The producer's calls, with our pick

1. **Atlantis's falls rise from the streets to the Sea, not from houses.** They are FACTIONS.md's "the canals pour upward", rise straight up clear of every house, and now read as waterspouts, not legs. Our pick: keep them.
2. **Inferno's columns now fuse into the sun and are gone by 6.4 s**, as FACTIONS.md has it (the outside look's pick too: kept, they read as a lander's legs holding the sun up). Before the review they stayed, feeding it. Our pick: let them fuse, as built. Keeping them is a one-line change.
3. **The black-violet sky is a ceiling of smoke over the neighbourhood**, not the live sky's own tables turning black-violet. Our pick: the ceiling, which leaves the sky everywhere else as it is. The outside look's note: it shows from the street and at 250 m only as a dark sky round the sun, and not at all from a kilometre (it faces down only). If the sky going black-violet should read from a kilometre too, the ceiling would need a top: say so.
4. **The Elderwood's houses trail roots that never reach the ground.** FACTIONS.md's root stilts are out by the ruling; hanging roots keep the faction's idea under the houses. Our pick: keep them.
5. **The pieces' height.** At 250 m on the climb a piece at 220 m swallows the chase view: the Sea fills half the frame with the bus on it like a pool, the Sky Wood's canopy hides the bus (the outside look). Raise them to about 300 m (FACTIONS.md's sky marks say 200-250), or keep 220 and let the bus fly into them on purpose (which wants them to take the bus: a sea to dive through, an island to land on). Our pick: keep 220 for now and decide with call 7's flying in: a piece the bus can't touch shouldn't block its view, so if they stay untouchable, 300 m.
6. **Hyperglow's turns made exact for the flight**, about half a day. Our pick: yes, once the look is liked.
7. **A set piece per neighbourhood or per square.** FACTIONS.md section 1 moves the sky marks to the heart, one per neighbourhood; these are built that way. Our pick: keep one per neighbourhood.
8. **The houses' own colours in three factions** (the outside look): Atlantis's and the Elderwood's floating houses read as flat single-colour slabs, where Rainbow's and Hyperglow's keep their wave pattern, and their accents (coral, gold, pearl, violet, lime) don't show. That's step 5's colours, not this stage's. Our pick: give each faction's wave a second ramp of its own in step 5's table, a small change, before the producer's final look.

## What's left for the whole of step 6

Step 6 is "the fantasy proof" (FACTIONS.md sections 4 and 5, 12 agent-days): Rainbow's stages 1-4 in one area on the producer's phone, plus a still of each faction at stage 4 from the street and from a kilometre up. This slice is its stage 4 for Rainbow, by hand. Still to come:

- **Bring this slice to the floor**: the noon 250 m view under 1.5 M triangles, the climb's frame spikes found and gone, the flight steering round what it can't pass inside the layer (`lift-check`'s `j.`, a look ahead along the heading), then a real A15 and iOS Safari (step 2, the slowest phone).
- **The rest of Rainbow's stage 4**: the seven-colour halo snapping off to 250 m at the heart, the park lifting as an island, splash on the bus, lifted roofs that look richer than level 3, and its own sound on the beat clock (step 3).
- **Stages 1-3 in the same area**, on the areas' squares and their clock (step 4, `feat/recess`): stage 1's mark drawing itself round in five seconds, stage 2's daisies and popcorn trees, stage 3's rivers running downhill with bunting and onion domes, and stage 4 coming from a square reaching 4 instead of per-building hits.
- **The other four factions at stage 4**: their looks are up for the producer's eye ("Stage 4 in the other factions", above), after the review's and the outside look's fixes. Once judged, each needs what its stand-ins list: Hyperglow's turns in the flight, the pieces' shadows and paint and whether the bus can touch them (calls 5 and 6), their sounds, Rainbow's own halo, and the houses' own wave colours in Atlantis and the Elderwood (call 8, step 5's table).
- **Open nits**: the petals' global palette, the squash seams, the one-frame lag, the 9-building cell, the twin during a region swap.
- **The producer's eye**, on the phone, on the slow motion and on the two calls above.

## Checks

- `node tools/factions/lift-check.mjs [--gpu]`: the motion and the swell, the heights on real data in three cities (the bands, touching neighbours apart, the 30 m share), the pick, the field's identity, and the real `Flight` at 120 Hz on Alamo Square with every house up and riding the swell: under the Painted Ladies at the floor and at a held 20 m, over the layer, in from the edge, a pull up under the layer, a low floating house from four sides, four dives and four pull ups through the layer, and 40 straight runs in from outside the neighbourhood, none with the bus's body in a drawn house and none with a step over 3 m; and 192 weaves beside 24 houses at their walls' height (`j.`), reported, the known risk above. With `--gpu`, the motion's GLSL on the GPU against the TypeScript. `LIFT_TRACE=<a run's tag>` prints one run's trace.
- `node tools/factions/lift-stills.mjs <url> <out> [--factions=rainbow,atlantis,elderwood,hyperglow,inferno] [--views=under,low,mid,street,250,1k,gif] [--skies=noon,golden]`: the stills (`<faction>-<sky>-lift-<view>.png`) with their draws, triangles and frame times, and `gif` a faction's motion (`<faction>-motion.gif`, from half a second into the wave to 12 s, a frame each 0.25 s of game time, Hyperglow's each 0.125 s, at one pixel a game pixel, played in real time). Exit 1 on a failed view or a shader error.
