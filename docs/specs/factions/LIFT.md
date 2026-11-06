# The Lift: the first look at the stages

Step 6's first slice (FACTIONS.md section 5, "the fantasy proof"). What the producer approved: "a first look at the stages: Rainbow's colours and the Lift, where houses float and you fly under them, in one neighbourhood behind a link, with stills for your phone." Rainbow's stage 4 is FACTIONS.md section 2's "4 · Liftoff": every painted house jumps and doesn't come down. FACTIONS.md had each on its own rainbow geyser; after the producer's notes on the stills (below) nothing holds them up: they float over a lake of paint, riding a swell across the neighbourhood like boats on water, at heights all their own.

This page says what the slice is, how to try it, what's built and where, what it costs on the one GPU we have, what the review, the outside look and the producer found and what came of it, and what's left for the whole of step 6.

## The producer's three notes (2026-11-06)

In the producer's words, on the stills: "Just concerning the raised houses: let's have more fun with it 1) no pillars below holding houses up, I just want them to float 2) the houses sort of bob up and down like they're on water, 3) the houses are not all equal height off the ground - I want it to look more dynamic. Other than that it looks great!" Everything else stayed: the lake, the drips, the wave out from the park, the slow motion, the hold rule, the colours, the low shot.

1. **They float.** The geysers are gone: their draw, their 600 instances, their program and its warm-up, the splash ring. They never were in the flight's field. Nothing joins a house to the ground. The bellies, lit from the jet before, now catch the lake's light: a net of caustics in the paint below's colours (the house's hue a step on, its trim where two lines cross) wandering over them as the water moves, brighter the nearer the water (a low house glows, a high flyer is a darker shape against the sky). The drips stay, one every 4 m of edge (3 m was 9k of the undersides' 11k triangles). The lake's rings run out from under each house's centre, pushed out as it comes down and drawn in as it rises.
2. **They ride a swell.** Two long swells cross the neighbourhood, the same way in every city: 200 m long every 9 s (22 m/s, from the north west of the map, weight 0.62) and 130 m every 6.8 s (19 m/s, from the south west, 0.38). Each house heaves with the swell under its centre, a little late (up to 0.9 s, by a hash: neighbours ride it slightly out of step), by 3 m at the crest for a small house and 1.4 m for a big building (+-15 % by a hash); it pitches and rolls with the water's slope (85 % of it), about 2 degrees on average and never past 4.9, with a wobble of its own (0.7 degrees); and it drifts by 0.45 m on a period of its own (11-17 s), so it never looks mechanical. The lake shows the same swell: lighter on its crests, with a broken line of foam along them, so the eye ties house and water. The house turns about its belly's middle; its roof's patterns and leaves are taken back to where they rest on it, so they ride the house and don't swim over it. The swell takes a house over between 0.8 and 2.4 s after its launch, as the bob did.
3. **Their heights are their own.** By a hash, 12 % low (9-16 m: a house to fly over or weave round, too low to pass under), most in the middle (34-62 m), 12 % high flyers (72-94 m); big buildings keep to the lower half of the middle and never fly high; no roof over 105 m above its ground. Then, as the wave places them out from the park: never two touching neighbours within 6 m of each other (Alamo Square: 0 of 471 touching pairs; the closest are 6.00 m apart), and a low house stays low only with room over it: every house within 24 m floats high enough (its lowest belly 22 m over the low house's top, its domes allowed 6 m, less 2 m for each metre past 6 m off, the flight's own count of a belly beside it), or the low one goes to the middle. The low ones are placed first, so their neighbours rise round them. On Alamo Square: 46 low (12 %), 287 in the middle, 67 high flyers (17 %); **75 % leave room for a 30 m pass** under them (their lowest belly with the swell, the drift and the lean at 38 m or more), up from 62 % with the hash alone and from 77 % before the notes.

## Try it

Preview of `feat/factions` (it works once the branch is pushed):

**https://struggle-bus-world-git-feat-factions-patricks-projects-9ff6e721.vercel.app/?lift&lifted**

| Link (add to the preview's address) | What you get |
|---|---|
| `?lift&lifted` | Alamo Square staged at level 3, Rainbow, for this session only, then lifted as a wave out from the park. Start here. |
| `?lift` | The real path: three Rainbow breaths take a house to level 3, the fourth lifts it and its painted neighbours. |
| `?lift&lifted&slowmo=0` | The same with no slow motion at the lift-off, to compare (decision 13). |
| `?lift&lifted&hood=Fillmore District` | Another neighbourhood, by its name in `hoods.bin`. |

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
- **Flight and aim** (`src/world/LiftField.ts`, hooks in `src/world/City.ts`). A floating house is a deck: under it the floor is the ground, over it its roof, both where the swell has it now (its centre's heave, exactly the shader's, with the lean's reach, 0.085 times its reach from its centre, and 0.5 m of look ahead either side; in its launch's first 1.5 s the whole slab of its overshoot and the swell's reach). The aim sees the house as drawn, its lean included (within 5 cm of the GPU's turned house). A low floating house, too low to pass under, is a wall from the ground to its roof, as a grounded house is: the flight goes over it or round it. A breath from below passes under a house, one from above lands on its drawn roof. Anything under a house's middle sees it from below, and the flight's underside counts the bellies within 24 m (16 m before the heights spread: a belly 36 m under the bus is now counted over it as its cell comes in), so a bus pulled up under one house is let down under a lower one ahead, never put on its roof through it. Which side of a house the bus is on is decided by its middle while the bus is still 6 m past its half length off it, and kept as it comes in. The bus's body is kept out of the bellies. Grounded neighbours keep their chimneys and parapets in the floor.
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

**The outside look** (an art director's first look at the stills): "a rainbow town on candy-striped stilts", not yet "houses riding geysers". The 250 m views were the best frames; the low pass, the fly-under itself, was the weakest: a dark slab overhead and a forest of posts. Its three changes, all made (the geysers have since gone, on the producer's first note, above):

1. **Geysers that read as water**: one round, tapered jet per house with a foam mushroom under the belly, a spiral rushing up, a splash ring at the foot, and rest heights spread so rows break up.
2. **The underside lit**: a gold halo and caustics round each jet, drips off the edges, the lens kept 9 m under the bellies.
3. **One lake per lifted block**, flooding yards and streets, with rings out from each jet. The 1 km still now frames the neighbourhood mid-frame.

Its other notes, not done: the seven-colour halo, the park lifting as an island, the jets' long shadows across the lake at golden hour, and the lifted roofs looking poorer than level 3's (their gardens are shed: that's the triangle budget). It also noted that at golden hour the lit grey city turns peach and competes with paint's oranges; that comes from step 5's golden sky, not this slice.

## Shortcuts and calls, surfaced

- **Two calls for the producer.** The 30 m pass: after the notes 75 % of Alamo Square's houses leave room for it (77 % before them, 87 % before the first spread; `lift-check`'s line is 55 %). Climbing over the layer: pulling up under the houses keeps the bus under them; to get on top you fly out first. With the high flyers it now climbs far under them (to about 50 m in `lift-check`'s pulls).
- **A known risk: the flight's jolts.** Beside a floating house at the height of its middle, as the bus sinks or climbs past it, the flight decides to go under or over it near enough that its ceiling or floor comes in one step: in `lift-check`, 7 of 68 runs have a step over 3 m in one 1/120 s step, the largest 7.9 m (a let down). None of them is in a house. The same runs over the grounded city have none. Keeping the side the bus chose while it was far (6 m past its half length) took them from 14 m; the real fix is the flight looking ahead along its heading for a belly at its height, a change to `Flight.ts` (shared with the Golden Gate) not made here.
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

## What's left for the whole of step 6

Step 6 is "the fantasy proof" (FACTIONS.md sections 4 and 5, 12 agent-days): Rainbow's stages 1-4 in one area on the producer's phone, plus a still of each faction at stage 4 from the street and from a kilometre up. This slice is its stage 4 for Rainbow, by hand. Still to come:

- **Bring this slice to the floor**: the noon 250 m view under 1.5 M triangles, the climb's frame spikes found and gone, the flight's jolts gone (a look ahead along the heading), then a real A15 and iOS Safari (step 2, the slowest phone).
- **The rest of Rainbow's stage 4**: the seven-colour halo snapping off to 250 m at the heart, the park lifting as an island, splash on the bus, lifted roofs that look richer than level 3, and its own sound on the beat clock (step 3).
- **Stages 1-3 in the same area**, on the areas' squares and their clock (step 4, `feat/recess`): stage 1's mark drawing itself round in five seconds, stage 2's daisies and popcorn trees, stage 3's rivers running downhill with bunting and onion domes, and stage 4 coming from a square reaching 4 instead of per-building hits.
- **The other four factions at stage 4**, as stills from the street and from 1 km: Atlantis, the Elderwood, Hyperglow and Inferno, so their looks are judged before they're built (only Rainbow lifts today).
- **Open nits**: the petals' global palette, the squash seams, the one-frame lag, the 9-building cell, the twin during a region swap.
- **The producer's eye**, on the phone, on the slow motion and on the two calls above.

## Checks

- `node tools/factions/lift-check.mjs [--gpu]`: the motion and the swell, the heights on real data in three cities (the bands, touching neighbours apart, the 30 m share), the pick, the field's identity, and the real `Flight` at 120 Hz on Alamo Square with every house up and riding the swell: under the Painted Ladies at the floor and at a held 20 m, over the layer, in from the edge, a pull up under the layer, a low floating house from four sides, four dives and four pull ups through the layer, and 40 straight runs in from outside the neighbourhood, none with the bus's body in a drawn house; the steps over 3 m reported. With `--gpu`, the motion's GLSL on the GPU against the TypeScript. `LIFT_TRACE=<a run's tag>` prints one run's trace.
- `node tools/factions/lift-stills.mjs`: the ten stills (five views, noon and golden hour) with their draws and triangles.
