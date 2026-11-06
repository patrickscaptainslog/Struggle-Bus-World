# Recess on screen: the GPU match, the review and the heal (feat/recess, ab6c67c to bced508)

The first account, 2026-11-06, for the second account. Three parts: a whole three-minute Recess played twice on the laptop's GPU with real touches, as the hand-in asked; a code review of `feat/recess` ab6c67c to bced508 (802fec6, bced508) and the cf6687f merge, read against `docs/specs/factions/FACTIONS.md` and the branch's `BUILT.md`, "Recess on screen"; and the studio's middle rule for the heal, which the earlier review ([recess-2026-11-06.md](recess-2026-11-06.md), its M1) said was owed before the producer is asked. Then a second, adversarial reading of all three. Only what the second reading held is below, with its numbers where they differ. Every file:line is at bced508. New findings carry on the earlier review's numbers, from 21.

**Verdict.** One blocker, small to fix, and it's for `main`, not for the phone test: playing `?recess` paints over the player's saved San Francisco, and starts from it (B21). On the GPU the demo runs clean: both matches ran to the bell with real touches, with no page error, and nothing compiled after the warm-up. But it isn't ready for `main`. Seven majors:
- every captain ground breath freezes the game, so 10 to 14 s of each three-minute match is frozen clock (M22);
- what the city shows as painted and what the brain counts disagree, and missed breaths crack and heal gods with nothing on screen (M23);
- the rooftop sprouts take the frame to 50 ms by the bell, at 3 to 5 M triangles against the 1.0 to 1.5 M budget (M24);
- the match's words get lost, and YOU ARE WANTED can never show (M25);
- the Crown goes to a faction that isn't leading the scoreboard (M26);
- the heal, as it plays now (M27, waiting on the producer);
- captains' breaths at the player can still miss with no hop (M28, the earlier review's M2).

Fourteen minors and seven nits. The view from 1,500 m at the bell never shows the player's own heart (m29). For the heal the studio's pick is **"seal two"**: heals wait for the god's five-second ring the way cracks do, and an owner's heal mends two cracks. It is the producer's question, at the end of this file and in `docs/TODO.md`.

## How it ran

- **The GPU match.** The laptop's Intel UHD 620, headless Edge 156.0.4314.58, ANGLE D3D11. The canvas was 1179 x 2556 at dpr 3, which is 393 x 852 game pixels at 3x, with touch. It ran one browser at a time, behind the laptop's memory gate and lock.
- **The review and the heal study** ran in Node only: no browser and no GPU.
- **The second reading** was Node only too. It made its own passes over the GPU matches' logs: frames, hops, the view's geometry, and the Crown replayed from the hits. It also reran the review's `defend` and `tally` scripts, and the heal study's scripts on their seeds and on fresh ones.
- **The first account's scripts, logs and frames** are on the laptop, outside the repo.
- Nothing was committed on `feat/recess`, and it was never changed: its worktree is clean at bced508.

## What ran

| Run | What it printed |
|---|---|
| `npx tsc -p tsconfig.main.json --noEmit` | exit 0 in 27.3 s, nothing printed |
| `npx vite build` of bced508 | exit 0, vite 8.3.5, 146 modules in 2.65 s. `main-B31DY4wR.js` 1,006.28 kB (316.51 kB gzip), `recessBoot-B4pmakch.js` 32.53 kB (12.52 kB gzip). The usual warnings: chunks over 500 kB, and `configLoader __dirname` |
| `node tools/iosfloor.mjs` on that build | "iOS 15.0 parses every chunk". Its 6 `.at(` hits in `recessBoot` are Beat's own `this.at` |
| `vite build` of an exported ab6c67c tree | exit 0. Recess's code is only in `recessBoot-*.js`, behind a dynamic import |
| `node --no-warnings tools/factions/check.mjs` | 16 of 16 pass |
| `node --no-warnings tools/recess/duels.mjs 3000` | 19 of 19 pass in 46 s: 8.1 M steps, 0 steering faults, 0 glint faults, 0 bullying. Rides a minute: Learner 1.02, Rival 1.37, Veteran 1.53 |
| `node --no-warnings tools/factions/owner-check.mjs`, on the merge | 44 pass, "all passed" |
| `tools/shots.mjs --det --q=sky=off`, bced508 against main 058217c, then `tools/shotdiff.py` | ceiling, fidi, grey, high, opening, painted, soma and swap: all "identical (1179 x 2556)" |
| `tools/warmcheck.mjs` on `?recess&bots=rival` | Ready in 11,321 ms. The warm-up compiled 36 programs and 35 draws in 8,456 ms, and 0 programs after it, with 37 draw keys. The only first draw after the warm-up was the upscale at frame 1, which the tool expects. Two 100 ms frames in the climb |
| The review's own Node scripts: `raid`, `tally`, `frame`, `blobs`, `defend` | below, under the findings they back. The second reading's reruns of `defend` and `tally` printed the same |

Not run: `tools/recess/screen.mjs` on the GPU (its syntax only, `node --check`), Piñata, Bubbled, `&newcomer` on screen, and sound.

## The GPU match

**How it was played.**
- **The page.** `?recess&bots=<level>&t=2026-11-07T21:00:00Z` (a 1 pm sky) from the build above, served by `tools/sky/serve-dist.mjs`.
- **The touches.** Real CDP touches. The thumb lands in the bus's lane at (196, 770) and steers by its x position. To tap or flick it lifts, strokes once at (110, 300), and lands again. A tap is 60 ms; a flick is 74 px in 85 ms, as `tools/flick.mjs` makes one.
- **The driver's plan.** It alternates 15 s toward the nearest captain with 15 s toward a rival heart, goes home when its own god is cracked, and turns in near the circle's edge.
- **The driver's taps.** It taps a glinting captain at once, and a heart when the glint is on its square. It flicks at a white-hot breath after a seeded 0.12 to 0.32 s, plus about 30 ms of its own latency. It flicks up to Express at the first bell, down once in each ride, and back up after.
- **One thumb at a time.** CDP can't lift one finger while it holds another down.
- **The matches.** One match against Rivals (seed 1) and one against Veterans (seed 2). Two more runs found the frame's cost: a census (seed 3) and a sprouts test (seed 4).

**What it cost.** Frames are rAF intervals from bell to bell, with the screenshot frames left out. The second reading cut the screenshot windows more narrowly and got 5,659 and 5,503 frames, with the same median and percentiles.

| | Rival | Veteran |
|---|---|---|
| Frames | 5,521 | 5,367 |
| Median / 95th / 99th / worst | 33.3 / 66.6 / 66.8 / 166.9 ms | 33.4 / 50.3 / 66.8 / 166.7 ms |
| Over 34 ms / 50 ms / 100 ms | 1,811 / 835 / 6 | 1,856 / 713 / 9 |
| 15 s medians | 16.7, 16.7, 33.3, 33.3, 33.4, 33.3, then about 50 from 90 s on | the same shape |
| CPU work a frame (`perf.frame`), median / 95th | 6.6 / 14.3 ms | 6.9 / 13.6 ms |
| Draws in play, median / 95th / max | 152 / 182 / 202 | 147 / 176 / 200 |
| Triangles in play, median / 95th / max | 1.86 / 3.52 / 3.91 M | 1.93 / 3.27 / 3.54 M |
| Triangles, first 15 s → last 15 s | 0.87 → 3.6 M | 0.84 → 3.20 M |
| Scoreboard: draws, triangles, frame median | 225, 4.02 M, 66.6 ms | 234, 3.64 M, 50.1 ms |
| Programs: at the warm-up, after it | 36, 0 | 36, 0 |
| Page errors, console errors, warnings | 0, 0, 0 | 0, 0, 0 |
| Pointer down / up | 197 / 197 | 247 / 247 |

- **The GPU is the limit**, not the CPU.
- **The match clock fell behind the wall clock.** Its 180 s took 203.1 s and 198.9 s of wall time. Of that, 9.0 s and 7.1 s are the 50 ms frame cap. The other 14.1 s and 11.7 s are frames where the game's clock stood still: 385 and 298 frozen frames, holding 13.5 s and 10.3 s. Those are hit-stops: the player's own taps, 86 and 66 captain ground breaths, and the rides (M22).
- **The cost is RoofSprouts** (`src/world/props/sprouts.ts`), the base game's rooftop growths at paint levels 2 and 3. In the census run they went from 0 to 4.04 M scene triangles, in 69 meshes. At the bell the arena's 2,781 buildings were 753 at level 0, 537 at level 1, 345 at level 2 and 1,146 at level 3.
- **Hiding the sprouts** on the sprouts run's scoreboard took the frame from 221 draws, 4,659,910 triangles and 83.3 ms (median) to 159 draws, 997,416 triangles and 16.7 ms. Shown again, it was 221 draws and 83.2 ms.
- **During play** no hide test ran, so there the link is a correlation: from 120 s on, sprouts are 3.1 to 3.8 M of the scene's triangles. `renderer.info` counts every instance, including sprouts the vertex shader culls by distance, but the scoreboard's 83 → 16.7 ms shows the cost is real on this GPU.
- **The captains.** Each captain is 1 draw and 3,568 triangles. Each blob (16 meshes of 80 triangles) is a draw of its own, and up to 3 were seen at once. So Recess's own buses and blobs add up to 5 draws and about 11 K triangles, the player's bus aside.
- **Long tasks** after the warm-up: 316 ms and 389 ms in the ready phase, then a few of 51 to 67 ms in play.

**What happened, Rival** (seed 1).
- **Rides (14).** The player rode a captain 4 times (Atlantis 2, Inferno 2), the captains rode the player 5 times (Inferno 3, Atlantis 2), and the captains rode each other 5 times.
- **Taps.** 64 taps. 12 breaths at captains resolved: 4 hits and 8 misses. 13 taps had a captain under the aim.
- **WANTED** came twice, Inferno at 19.97 s and Atlantis at 162.43 s, both for captain-on-captain rides. Neither was shown: each came under the NO BRAKES said at 18.5 s and at 160.33 s (M25).
- **Gods: 3 cracks, 3 heals, none fell.**
  - Atlantis's god was cracked at 50.0 s and healed at 52.6 s, and Inferno's at 79.2 s and healed at 82.0 s.
  - The crack at 104.7 s was the player's breath at Atlantis's captain. Atlantis hopped, and the breath landed on Inferno's heart: a crack with nothing painted there (M23). Inferno healed it at 163.3 s.
  - The words showed 2 of the 3 cracks; the one at 79.2 s came under NO BRAKES.
- **The bell:** Rainbow 76, Atlantis 91, Inferno 57, "THE BELL! / ATLANTIS WINS".
- **Out of the circle.** BACK TO RECESS 5 times. The bus left the 750 m circle in 3 of the 5 rides, out to 826, 1,098 and 1,129 m.

**What happened, Veteran** (seed 2).
- **Rides (9).** The player rode Atlantis once, the captains rode the player 6 times (3 each), and the captains rode each other twice.
- **Taps.** 63 taps, 8 at a captain. No WANTED.
- **Gods: 3 cracks, 3 heals, none fell.**
  - The player cracked Atlantis's god at 20.6 s. A missed breath at a bus cracked it again at 27.2 s. That was 2 of 5, not 2 of 3: Inferno held the Crown then, by 18 to 17 on the Crown's count. The words for 27.2 s came under the NO BRAKES said at 25.3 s.
  - Atlantis healed both cracks, at 36.3 s and 38.0 s, 1.7 s apart. By 36.3 s the Crown had moved to Atlantis while its god had 2 cracks, with no word on screen (M25).
  - A missed breath at a bus cracked Inferno's god at 101.9 s. Inferno healed it at 138.4 s by a breath at the player that missed with no hop: Inferno healed its own god by missing the player.
- **The bell:** Rainbow 73, Atlantis 88, Inferno 60, "ATLANTIS WINS".
- **Out of the circle.** BACK TO RECESS 7 times. The bus left the circle in 4 of the 6 rides, out to 907, 1,028, 1,009 and 1,008 m.

**Possessed and the hop.**
- **Possessed.** Nonstop in every ridden sample. The 5 flicks down in the Rival match's rides showed NO BRAKES and changed nothing.
- **Hops.** White-hot breaths at the player: 19 and 39. Hops: 12 and 24. After a hop, Rival: 4 hit, 4 missed, 4 bounced. Veteran: 19 bounced, 3 or 4 hit and 1 or 2 missed, by how breaths are matched to flicks.
- **Timed against the breath's arrival:**
  - Every hop 140 ms or more before arrival escaped (5 of 5, over three runs).
  - Every hop 86 to 116 ms before arrival was hit (3 of 3).
  - Four "escapes" 2 to 67 ms before arrival can't be the hop's: it had moved at most 8 of its 30 m, inside the 14 m radius. They are the lead's misses (M28).
  - So the usable window is about the first 0.19 to 0.21 s of the 0.33 s white-hot (m31).

**The view from 1,500 m at the bell** (the same in every run).
- **The camera** is 1,500 m over the arena's ground, 525 m south of its middle, looking down at 70.7°, with a lens 24.24° across (49.69° vertical, aspect 0.464).
- **What it covers.** 815 m wide at its top edge, 683 m across the middle and 588 m at its bottom edge: 53.8 % of the arena's circle. By area, 75.7 % of the circle's inner half (the inner half of the radius) is on screen.
- **The hearts.** Atlantis's and Inferno's, 373 m from the middle, are on screen. Rainbow's, 452 m east of it, is off screen in every run. Turned 90° to look along the east-west line, the same lens has all three hearts.
- **On the scoreboard** the MEGA button stays up.
- `BUILT.md`'s "about 640 m" is right.

**The frames.** The first account's frames are each run's 17 stills, 1179 x 2556, from before the bell to its end, with contact sheets for the producer, each still labelled with the match clock and the score. They are on the laptop, not in the repo. The still before the bell is grey fog: the page was still loading.

## Findings

### Blocker

**B21. Playing `?recess` paints over the player's saved San Francisco, and starts from it.**
- *What a player sees.* After one match, the normal game shows Alamo Square, the Lower Haight and Hayes Valley in Atlantis blue and Inferno red. Their own Rainbow paint there is painted over and raised a level, and it stays that way. The other way round: a returning player starts Recess with their old paint, which the brain doesn't count.
- *Evidence.* The captains, the hiccups and the heart blasts all paint through the player's own `splatter.barf` (`main.ts` 1108-1112).
  - With `solo`, every building in reach takes the captain's hue and goes up a level (`Splat.ts:307`), written as `faction` (`Splat.ts:416`).
  - `PaintState` is built with the city's slug, and `set` writes the saved store with `saveTimer = 0.8` (`PaintState.ts` 217-231). `GroundPaint` saves its tiles the same way.
  - Nothing under `?recess` turns that off: there's no Recess guard in `PaintState` or `GroundPaint`, and `?lat` and `skipintro` don't stop saves.
- *Scope.* Storage is per origin, so on the branch's preview link only that origin's save changes. It must be fixed before `main`, not before the phone test.
- *Fix.* Under `?recess`, paint in memory only (load nothing, save nothing), or give it a store of its own. `screen.mjs` runs in a fresh browser context, so it can't see this: a row that paints, reloads and reads the store would.

### Major

**M22. Every captain ground breath freezes the whole game, and kicks and flashes the screen, wherever it lands.**
- *What a player sees.* A stutter and a camera kick every couple of seconds, from blasts up to 1.5 km away. On the GPU it shows in the clock: 13.5 s and 10.3 s of each three-minute match were frozen frames (above).
- *Evidence.*
  - `paint()` passes `hitStop: 0` only when `size !== 1` (`recessBoot.ts:387`). A captain's breath is size 1, so it gets `hitStopFrames: 4`, which is 4/60 s: two frames at 30 fps.
  - On impact `main.ts` sets `dt = 0` (1287-1289), and adds `rig.kick`, `pipeline.flash` and impact audio (599-604).
  - It also moves the single blast-ring uniform (`Splat.ts:418`) away from the player's own blast.
  - The rate: 28.7 ground breaths a minute in the Rival match and 22 in the Veteran one. With the default captains (a Rival and a Learner), `tally` counts 34.3 a minute.
- *Fix.* `hitStop: 0` for captains' paint, and no kick or flash for blasts the player didn't fire.

**M23. The city's paint disagrees with the brain.** This breaks "a hit costs time, never paint", and the painted map as the scoreboard (FACTIONS.md §4).
- **Hiccups.** The brain claims grey only (`spill`), but the screen blasts the hitter's hue over any building. With the default captains, 19.9 of 29 hiccups a minute land on owned ground (`tally`). In the GPU matches, 28 to 59 hiccups a match landed on a rival faction's square, 15 to 25 of them the player's. A ridden player sees their own Rainbow buildings turn red, and B21 saves them that way.
- **Captain hits the brain leaves with the owner** (a parry, a crack, a down): the screen repaints the square in the captain's colour. That was 6.0 a minute with the default captains, and 3.7 to 6.7 in the GPU matches.
- **Misses.** A breath that misses its bus counts as a ground hit in the brain (`recess.ts:449-453`). But `events()` paints nothing for `miss` or `paint` (`recessBoot.ts` 308-312, ground fires only). These misses land where the fights are, on hearts: in the four GPU matches, 4 god cracks and 1 heal came from missed breaths, with nothing on screen.
- **The firehose** calls `splatter.barf` directly, bypassing `breathe()`, so it counts nothing in the brain.
- **MEGA.** A player's MEGA counts as one square (`playerPaint` has no super or spill), but paints about 19 squares' worth.
- From 1,500 m, the map and the score tell different stories.
- **Sprouts.** The on-screen repaint also feeds the level-3 count behind M24.

**M24. The rooftop sprouts take the frame far past the budget.**
- *What a player sees, on this laptop.* 60 fps for the first 30 s, 30 from 30 to 90 s, then 20 to the bell, and the scoreboard at 50 to 83 ms a frame.
- *Evidence.* Triangles pass 1.5 M a third of the way in. They are 3 to 4.7 M at the bell, with 221 to 234 draws on the scoreboard, against `CLAUDE.md`'s 120 to 200 draws and 1.0 to 1.5 M triangles. The cause is above: RoofSprouts at levels 2 and 3, 4.04 M scene triangles at the bell, and hiding them takes the scoreboard from 83.3 ms to 16.7 ms.
- *Whose.* The growths are the base game's (`sprouts.ts`). Recess just paints more in three minutes than the solo city usually does, so a painted solo city will meet the same wall.
- *Fix.* The studio's to choose: cap what the sprouts draw by distance or count, in the base game. Whether the game lowers detail by device wasn't checked, so the counts may not carry over to a phone as they are.

**M25. The match's words get lost, and YOU ARE WANTED never shows.**
- **WANTED.** A WANTED earned by a ride on or by the player can never show. The same step's GOTCHA or NO BRAKES (rank 3) hides it (rank 2). Both WANTEDs in the Rival match, captain-on-captain ones, were hidden by NO BRAKES too.
- **Cracks.** NO BRAKES hid 1 of 3 cracks' words in each match (79.2 s in the Rival match, 27.2 s in the Veteran one).
- **The Crown.** A cracked god's "N OF 5" becomes "N OF 3" silently when its faction takes the Crown (Veteran, 36.3 s).
- *Fix.* A queue, or a second line, for words that matter, so nothing ranked is dropped.

**M26. The Crown's leader isn't Recess's scoreboard leader.**
- *Evidence.* `leader()` counts every square, outside the circle too, and counts a god as 4. Recess's score counts only the circle, and a god as 40.
- In the census match the Crown was on Rainbow, third with 77, so its god needed only 3 hits, while Inferno won with 82. Rainbow had 10 points outside the circle, from the player's taps: `playerPaint` has no inside check.
- Each match had 6 to 18 owned squares outside the circle, from the player's taps and the hiccups.
- *Fix.* The Crown reads Recess's own score, and the player's taps outside the circle count for nothing, as the captains' do.

**M27. The heal (the earlier review's M1), as it plays now.**
- `areas.ts:207` and `:211` are unchanged: a heal still lands while the area is cooling.
- **In Recess against bots** this no longer makes a god unbreakable, because the captains chase the raider instead of healing. The real game shows the as-built heal: heals 2.5 s and 2.8 s after a crack, and two heals 1.7 s apart.
- **How often a god falls.** The review's `raid.mjs` raider orbits a heart at 180 m and taps it every 1.6 s. It toppled a captain's god in 100 of 100 matches at every level, at medians of 53 to 71 s, and Veteran was no harder than Learner. The heal study's whole matches have gods falling in 83 % of matches (86 % under the pick). The GPU matches' driver, which raids half the time, toppled none in 4.
- **The rule's flaw is still there** for a human defender who stays and heals. The pick is below; it needs the producer's word, and then the captains changed to heal on the ring.

**M28. The breath's lead is unchanged** (`recess.ts:434`, `lead = left + dt`; the earlier review's M2).
- A free captain never flies Nonstop: `captain.ts` picks only Cruise or Express, and a captain is at Nonstop only while ridden, when it can't be locked. So the player's taps aren't hit by this. All 19 of the player's misses in the GPU matches followed a captain's hop.
- The captains' breaths at the player do miss this way: 4 of 45 captain misses had no hop. That breaks "what glints is what your tap hits", for the captains.
- The fix is the earlier review's.

### Minor

- **m29. The view at the bell** sees 683 m of the 1.5 km arena, 53.8 % of the circle, and the player's own heart is never in it. Turning the camera 90° to look along the east-west line puts all three hearts on screen with the same lens. The MEGA button stays up over the scoreboard.
- **m30. The player's real bus leaves the circle in most Possessed rides,** out to 1.0 to 1.13 km: 3 of 5 rides in the Rival match and 4 of 6 in the Veteran one. The other rides stayed within 491 to 648 m. BACK TO RECESS needs 787.5 m. This is the earlier review's m4, now on the real flight.
- **m31. The hop's window** is about the first 0.19 to 0.21 s of the 0.33 s white-hot on the real flight (above), the earlier review's m9. One for the phone to judge.
- **m32. A captain's lock on the player** shows only as a toast at the lowest rank (`recessBoot.ts:329`). Any more important word hides it, and the captain's bus doesn't flash the player's colour, as §3 says it should ("glints, and flashes your colour as a warning").
- **m33. Defend is rolled every step.** `captain.ts:84` rolls `S.defend` on every 30 Hz step. So the levels' 0.4, 0.7 and 0.95 become 98.5 %, 99.2 % and 99.4 % of the time, within at most 0.30 s (`defend`, rerun the same). `BUILT.md`'s "Learners 40 %, Rivals 70 %, Veterans 95 %" doesn't hold.
- **m34. The player isn't held to the arena's gears.** Jet and the turbo levels work in Recess, crossing the circle in 3.3 s. Possessed brings a player at Jet down to Nonstop (`T.gear > want` in `player()`). Decision 3 says Nonstop in the arena.
- **m35. The brain is flat.** It locks and hits the player at any height, on x and z only. `b.speed = f.speed` (`recessBoot.ts:268`) is the speed along the path, not `f.ground`, so a captain's lead overshoots a player who is climbing or diving.
- **m36. Without the flag, the page preloads 3 more files** (palette, Ascent, BusModel) than before: 9 preload links against 6. Main shrinks by about the same bytes. No Recess code is in them.
- **m37. Garbage every frame,** at least 246 to 340 B (`frame.mjs`, about 20 µs a frame in all):
  - `sim.buses.map` and a new hands object each step (`recessBoot.ts` ~240);
  - `Captain.think`'s new `Hands` and its `.some` closure (`captain.ts:67`, `:69`);
  - `drawHud`'s `score()` closure and array, and its row strings.
- **m38. Atlantis's hue 4 and Inferno's hue 0 are also hues Rainbow deals.** From 1,500 m, Rainbow's red reads as Inferno's. This waits on step 5's colours.
- **m39. The player's taps still paint and count in their own stop arm and bubble** (`playerPaint` doesn't check state), but a captain's mouth is shut in both (`recess.ts:403`). It should be one rule for both.
- **m40. `screen.mjs`'s possessed row can't catch M23.** It asks for the hiccups to paint red on at least 60 % of nearby buildings. That passes with or without a fix, as long as most hiccups land on grey.
- **m41. Same-step ties at a heart always go to the captains.** The player's ground hits are applied after `sim.step()`. (The earlier review's n20, now on screen; it matters to the heal, below.)
- **m42. `&newcomer` keeps the new player's shield all match.** `firstWonder` is never called in Recess.

### Nit

- `Controls.ts:175`: the opening gate's doc comment now sits on `flickGate`, and `gearsLocked` has lost its doc.
- The bell's words say "1 MINUTES", and lengths that aren't whole minutes are rounded.
- Breaths in flight at the bell hang frozen over the scoreboard. Their queued paint still lands after the bell, unscored.
- A ground breath's square in the brain is where the breath ends, 7.0 to 14.0 m past `tx`. The screen paints at `tx`.
- The 16 blobs are separate meshes, so 1 to 13 draws. An InstancedMesh would make it one.
- `watchHearts` has a dead `void R`.
- The default captain seeds are fixed (`0x5eed`, `+101`), so every match's bots start the same way.

### The earlier review's findings

- **M1 (the heal)** is M27 above.
- **M2 (the lead)** is M28 above.
- **M3 (a save erased)** can't happen under `?recess`, which never saves areas (there's no save call in `recessBoot.ts`). It is still open in `areas.ts`.
- **m4 (the arena's edge)** is m30, and **m9 (the hop's window)** is m31.

## What holds

- **Possessed** goes to Nonstop, the steering is never taken, and a flick down shows NO BRAKES. That held on the GPU in every ridden sample.
- **The hop** goes sideways in the flight's own frame: forward is (sin h, −cos h).
- **The render order at the bell.** The camera is set after `rig.update` and before the render (rig at 1441, Recess at 1572, render at 1678).
- **The links** `&recess=`, `&bots=`, `&recesslen=` and `&newcomer` parse as `BUILT.md` says.
- **The captains' buses** each have their own geometry (BusModel builds one per instance), so recolouring them doesn't touch the player's bus.
- **The gods** are set at each camp's home from the bell.
- **Nothing changes without the flag.** Recess is only in `recessBoot-*.js`, and the 8 deterministic views are pixel for pixel main's. The one change is the file split (m36).

## The heal (decision 16)

**The question.** As approved, "an owner's hit heals a crack". As built, the heal lands on any owner hit, even while the god is cooling (`areas.ts:205-209`, the god branch of `hit()`, and `:211` for the Lift). So a defender who stays and heals holds a god for ever. The earlier review's ready heal, where a heal waits for the five-second ring as a crack does, lets one raider topple a defended god about half the time in three minutes. The studio owed a middle rule run through the same sieges.

**The rules run**, each a change to `areas.ts:205-209`:
- **As built** (`:207`): `if (own) out = a.cracks > 0 ? 'heal' : 'encore';`
- **Ready heal:** `if (own) out = a.cracks > 0 && ready ? 'heal' : 'encore';`
- **Seal two (the pick).** Heals wait for the ring like cracks. When it closes, the next hit counts, whoever it comes from: a raider's hit cracks the god; the owner's seals two cracks (or the one, if only one is there), or on a whole god starts the ring again (a new `guard` outcome).
  ```ts
  // godTune.seals: 2 (cracks an owner's ready hit seals on a god)
  if (own) out = !ready ? 'encore' : a.cracks > 0 ? 'heal' : 'guard';          // :207
  // apply(): case 'guard': a.hits++; a.last = t; this.onChange?.(a); return t;
  //          a heal: a.cracks -= Math.min(a.stage === godTune.stage ? godTune.seals : 1, a.cracks)
  ```
- **Long ring.** The same, but a heal seals one crack, and after a heal the ring takes 10 s to close instead of 5.
- **Quiet three.** An owner's hit heals at any time, as now, but only once no raider has hit the god for 3 s.

**How it ran.**
- The heal study copied bced508's `areas`, `beat`, `neighbourhoods`, `recess` and `captain` into a scratch tree, with one switch for the rule. With the switch at "as built", the branch's `duels.mjs 300` printed the same lines as the branch, and `check.mjs` passed 16 of 16.
- **Flown sieges** use Recess's own flight, lock, glint, breath, flick, Possessed, stop arm and pair rule, with raiders and defenders flying passes over one heart: about 14 landed hits a minute at most.
- **Defenders' rides.** A defender splatted off its heart is away a median 11.6 s in Recess.
- **Captains** time the ring in 0 %, 50 % or 100 % of windows (Learner, Rival, Veteran). Defenders heal and hunt 15 % of the time, raiders hunt 10 %, and the Crown is off except in its own cells.
- **No flight** (table E): both sides hit the god itself, everyone timing the ring. That is the upper bound for when a god can be hit from anywhere.
- **Counts.** 100 sieges a cell in Recess (about ±5 points).
- **The second reading.** It reran the study's scripts on its seeds. Table A's three middle rows matched cell for cell, 27 of 27, and the cells it checked in tables E and F matched too. Then it tried fresh seeds, strategies that might break the pick, the tie order, and the Crown.

**A. Recess, 3 minutes, a 5-hit god, Rival against Rival.** Each cell is the share of sieges that fell, then the median time of those that fell; "2v1" is 2 raiders against 1 defender. The end rows are from the same scripts and seeds.

| rule | 1v0 | 2v0 | 3v0 | 1v1 | 2v1 | 3v1 | 1v2 | 2v2 | 3v2 |
|---|---|---|---|---|---|---|---|---|---|
| as built | 100% 0:40 | 100% 0:32 | 100% 0:28 | 3% 2:40 | 27% 1:53 | 62% 1:36 | 0% | 0% | 0% |
| ready heal | 100% 0:40 | 100% 0:32 | 100% 0:28 | 49% 1:55 | 99% 0:53 | 100% 0:39 | 3% 1:42 | 53% 1:30 | 89% 1:07 |
| **seal two** | 100% 0:40 | 100% 0:32 | 100% 0:28 | **19% 2:08** | **89% 1:04** | 100% 0:48 | 0% | 21% 1:42 | 55% 1:34 |
| long ring | 100% 0:40 | 100% 0:32 | 100% 0:28 | 32% 1:43 | 86% 1:20 | 100% 0:51 | 0% | 30% 1:56 | 54% 1:28 |
| quiet three | 100% 0:40 | 100% 0:32 | 100% 0:28 | 19% 1:49 | 89% 1:13 | 100% 0:54 | 0% | 26% 1:39 | 79% 1:28 |

**Fresh seeds** (1001 to 1100), share that fell:

| rule | 1v1 | 2v1 | 3v1 | 2v2 | 3v2 |
|---|---|---|---|---|---|
| seal two | 25% | 85% | 96% | 24% | 61% |
| quiet three | 19% | 89% | 100% | 25% | 73% |

The defender held 81 %, 75 % and 80 % of 1v1 sieges under seal two, on three seed sets. Median fall times move 20 to 40 s between seed sets.

**E. No flight, everyone timing the ring, one splat a minute a pair.** R5 is Recess with a 5-hit god, C9 the solo city (10 minutes) with a 9-hit god.

| rule | R5 1v1 | R5 2v1 | R5 3v1 | R5 1v2 | R5 2v2 | R5 3v2 | C9 1v1 | C9 2v1 | C9 2v2 | C9 3v2 |
|---|---|---|---|---|---|---|---|---|---|---|
| as built | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| ready heal | 85% 1:04 | 99% | 100% | 17% | 82% | 100% | 84% | 100% | 88% | 100% |
| **seal two** | 54% 1:15 | 95% 0:48 | 100% | 8% | 58% | 87% | 51% 4:54 | 100% | 34% | 88% |
| long ring | 80% | 99% | 100% | 13% | 68% | 93% | 86% | 100% | 74% | 100% |
| quiet three | 100% 0:27 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% |

**F. Whole Recess matches, the captains' brains as built** (Atlantis Rival, Inferno Learner, Crown on), 100 a row. Each cell is the share of matches in which a god fell.

| rule | player raids | player paints | player defends | player taps at home |
|---|---|---|---|---|
| as built | 83% | 0% | 0% | 1% |
| ready heal | 92% | 0% | 0% | 1% |
| seal two | 86% | 0% | 1% | 0% |
| long ring | 92% | 0% | 1% | 0% |
| quiet three | 84% | 0% | 0% | 1% |

The player's own god fell in 0 matches under every rule. As built, the captains don't heal on the ring, so Recess as played barely changes with the rule until they do.

**The Crown's god** (the leader's god cut to 3 hits): no middle there.

| | seal two | long ring | quiet three | ready heal |
|---|---|---|---|---|
| Rival v Rival, 1v1 | 87% (81% on fresh seeds) | 83% | 67% | 86% |
| 2v1 | 99%, median 0:27 | 100% | 100% | |
| tapping player v 1 Rival | 24% | 24% | 35% | |
| person defending v 1 Rival | 98% | 99% | 97% | |

At a 4-hit god, seal two falls 43 % in 1v1 and 98 % in 2v1.

**Why seal two.**
- **It holds its shape when the hit rate changes.** How often a god can be hit isn't settled, because the god's hit shape isn't built yet. Recess 1v1 fell:
  - seal two: 19 % flown, 54 % with no flight;
  - long ring: 32 % and 80 %;
  - quiet three: 19 % and 100 %. With no flight a raider never leaves three quiet seconds, so every cell falls at the undefended speed.
- **A lone defender matters but isn't a wall.** One defender holds off one equal raider about four times in five. Two raiders take the god most of the time (85 to 89 %) in about a minute, twice the undefended 0:32, and three nearly always do.
- **No strategy breaks it in the model.**
  - A defender that taps every pass without timing the ring does worse: 1v1 falls 48 % against 19 %.
  - Raiders that never time do worse too: 9 % against 19 %.
  - Hunting the defender never pays, under any rule. Raising the raiders' hunting from 0.1 to 0.5 to 0.9 takes seal two's 1v1 from 19 to 3 to 1 %, and 2v1 from 89 to 62 to 32 %. That holds with a ridden bus unable to breathe too (19 → 15 %). So the plan's "splatting a bus wins a siege" doesn't hold in this model.
- **Long ring is decided by its tie rule.** Flipping same-step ties to the oldest breath takes its Veteran-against-Veteran cell from 11 to 16 % to 61 to 70 %.
- **Seal two keeps the five-second rhythm.** It adds no lull after a heal, and the save format stays as it is.

**What it costs, and what to know.**
- **Ties move seal two's team cells.** With ties flipped to the oldest breath, its 2v2 goes from 21 to 27 % to 37 to 45 %, and tapping player against 2 Rivals from 44 to 56 % to 67 to 75 %; its 1v1 doesn't move. In Recess on screen every same-step tie at a heart goes to the captains (m41), so the study's team cells are optimistic for the player.
- **At the Crown's 3-hit god** seal two is no harder than the ready heal (table above).
- **The approved words change in three places:** "ready" goes on the heal, a heal seals two, and a whole god's ready owner hit restarts the ring (the guard). At `godTune.seals` 1 it isn't the plain ready heal but the ready heal plus the guard.
- **Not yet run:** "one heal per wait per defender". As built, after an absence a defender heals two cracks 1.7 s apart (the Veteran match, 36.3 s and 38.0 s), which is exactly where that rule differs.
- **The Lift.** The stage-4 Lift's one crack has the same as-built heal (`:211`). The pick there would be `if (a.cracks > 0) out = ready ? 'heal' : 'encore';`. It wasn't simulated.
- **The captains.** As built they hunt raiders instead of healing, tap their own cracked god whether or not the ring is closed, and never guard. The pick needs them changed.

**For the producer** (plain words, in `docs/TODO.md`): "Today a defender who stays by their god and keeps tapping it mends every crack the moment it lands, so a defended god never falls. If mending waited for the god's five-second ring, the way cracking does, one raider would take a defended god about half the time in Recess's three minutes. Our pick: mending waits for the ring but mends two cracks at once. Then one defender holds off one equal raider about four times in five, two raiders usually take the god in about a minute, and three nearly always do. Shall we build that?"

## Not checked

- No phone, no A15, no Safari or JavaScriptCore. The frame times are this laptop's headless Edge, with no GPU timer: they are rAF intervals.
- The thumb is a script, playing one thumb at a time. Other jobs shared the laptop's CPU during the GPU runs.
- No hide test of the sprouts during play, only on the scoreboard.
- Whether the game lowers detail by device.
- One 2,483 ms gap at 171.7 s in the sprouts run, with no screenshot and no long task on the page's thread: its cause wasn't found, and the second reading didn't look at it.
- Not run on the GPU: Piñata, Bubbled, `&newcomer`, sound and `tools/recess/screen.mjs`.
- B21 is from the code, not from a reload in a browser.
- Two of the review's nits weren't rechecked by the second reading and are left out: the flash of the player's breath at a captain leading by the aim, and the hiccups' beat.
- Every siege number is a model, with the sim's ground breath landing 116 m ahead, not the real god's hit shape.
- The heal study's skill-gap cells, its city cells flown and its pace claim weren't rerun, so they're left out here. The heal study's other tables are with the first account's files.
