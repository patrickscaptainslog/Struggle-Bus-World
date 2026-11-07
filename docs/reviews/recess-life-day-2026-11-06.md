# Recess and life, the second account's day (feat/recess bced508 to 1f3901f, feat/life b6383f4 to b65af07)

The first account, 2026-11-06, for the second account. Four reports on the day you handed in ("Evening report: the second account (2026-11-06)" in `docs/TODO.md`): a code review of `feat/recess` bced508 to 1f3901f, a code review of `feat/life` b6383f4 to b65af07 (the diff from the factions merge, db0319a, on), and a GPU check of each on the laptop. Then a second, adversarial reading of all four: each finding opened at its file:line and tried against the code, the reviews' Node models rerun where they could be, and every GPU number read again from its logs. Only what held is below, corrected where a number or a claim was off. Lines are at 1f3901f for Recess and b65af07 for life. Recess's numbers carry on from [recess-screen-2026-11-06.md](recess-screen-2026-11-06.md) (its m42), so from 43; life's from [life-fixes-2026-11-06.md](life-fixes-2026-11-06.md), so from B2, M12, m19 and n16.

**Verdict.** No blocker on `feat/recess`, and on the GPU it plays clean: two whole matches ran to the bell with real touches, with no page error, nothing compiled after the warm-up, none of 306 captain blasts freezing the screen, and the saved city byte for byte the same after each. B21 is fixed. It isn't ready for `main`. Six majors:
- captains' paint still lands on squares the brain gives someone else, because a 69 m blast is wider than the 128 m square that's checked (M43);
- every captain blast sprays a jet out of your own bus, and their sparkles and blobs come out in Rainbow's colours (M44);
- a captain defends its god once per danger, so in 100 modelled matches 74 of 107 cracked captain gods were still cracked at the bell (M45);
- the edge chevrons point the wrong way for a rival behind or above you (M46);
- nothing shows a god's five-second ring, so a person can't play seal two (M47);
- every match word is drawn over the clock and the score (M61, new, seen on the GPU).

On `feat/life` the parks from 9 am hold, and `life.blast` works where it's called. Curb's road side isn't ready for the first account's Curb flight: the bus rides inside the car it paces (B2), the look picks a junction 220 to 600 m on rather than the one ahead (M12), and at a dead end it neither slows nor stops asking the worker, every frame (M13). Two majors are for the merge with `feat/shots`: movers drawn in Rainbow's colours (M14, already asked for in `docs/TODO.md`), and a park at its peak taken in two or three taps (M15).

## How it ran

- **The code reviews** ran in Node only: no browser, no GPU. The life review built nothing but ran `tsc` (exit 0). The Recess review ran neither `tsc` nor a build.
- **The GPU checks** used the laptop's Intel UHD 620 in headless Edge 156, 1179 x 2556 at dpr 3 (393 x 852 game pixels at 3x), with real CDP touches, one browser at a time behind the laptop's lock and memory gate. Other runs kept the laptop busy (CPU median 65 %, up to 100 %; free memory down to 17 MB), so frame times are pessimistic. Draws and triangles are reliable.
- **The second reading** ran in Node only: no browser, no build. Nothing was committed, and neither branch was touched.
- **The scripts, logs and frames** are on the laptop, outside the repo, under `sb-checks/recess-day-2026-11-06/` and `sb-checks/life-review-2026-11-06/`.

## What ran

| Run | What it printed |
|---|---|
| Recess review: `tools/factions/check.mjs`, `tools/recess/duels.mjs 3000` | 17 of 17; 19 of 19 in 45 s |
| Life review: `blast.mjs`, `curb.mjs`, `determinism.mjs`, `alloc.mjs`, `tsc` | 4 of 4, 8 of 8, 26 of 26, all pass, exit 0. Its own runs on San Francisco's roads and cars are under the findings they back |
| Recess GPU: `vite build` of 1f3901f, `iosfloor` | exit 0; "iOS 15.0 parses every chunk" |
| Life GPU: `vite build` of b65af07, `iosfloor`, `blast.mjs` | exit 0; "iOS 15.0 parses every chunk"; 4 of 4 |
| Second reading: `check.mjs` on 1f3901f's code | 17 of 17, seal two's rows among them |
| Second reading: `duels.mjs 3000` | 19 of 19 in 52 s |
| Second reading: the Recess review's `defend`, `kick`, `fence` and `chevron` scripts | their numbers, to the digit (under M45, M43, m52, n51, m49 and M46) |
| Second reading: the scoreboard's lens, with three's projection | Rainbow's heart off screen at 24°, all three hearts on at 42° (m54) |
| Second reading: `git merge-tree` | `feat/life` with f07a16e: `main.ts`, two hunks; with `feat/shots` 139989c: `main.ts`. `feat/recess` with `feat/gears`: `CameraRig.ts`; with `feat/shots`: `main.ts`; with `feat/gardens`: clean |
| Second reading: the GPU runs' summaries and raw logs | every number in "What the GPU showed", read again |

## feat/recess

### What became of the earlier reviews' findings

- **B21 is fixed.** `main.ts:163-172` opens the match's paint stores as `sf~recess`, which no id scheme is registered for, so the buildings' and the ground's stores read and write nothing. The landmarks' store keys by slug alone and writes one empty key (n56). On the GPU, all 8 saved keys came through each match byte for byte.
- **M22 is fixed for what it asked.** Captains' paint passes `hitStop: 0` and the `QUIET` tag (`recessBoot.ts:597`). The brain runs on the real clock through a freeze (`:347-348`). A hit on or by you freezes the screen only until 2 s are counted (`:603`). Your own breaths still freeze uncapped (m55), and quiet blasts still put up signs (m50).
- **M23 is half fixed.** The check on the landing square is right; the blast is bigger than the square (M43). The earlier m39 is half fixed too (m53).
- **The hooks do nothing without `?recess`.** `matchFov` and `matchPull` stay 0, and `recess` and `flickGate` stay null.
- **The heal is seal two** (`areas.ts:221`, `:264`), and `check.mjs` asserts it.

### Major

**M43. Captains' paint reaches past the one square the brain checks.**
- *What a player sees.* Your Rainbow buildings next to a captain's square turn teal or crimson and go up a level. From 1,500 m at the bell, the map's borders disagree with the score.
- *Evidence.* `events()` paints a ground breath only if its landing square came out the shooter's (`recessBoot.ts:519`). But `paint()` (`:597`) lets the splat size the blast by the drop (`Splat.ts:240`): 69 m round from a captain's 45 m. A hiccup is 42 m (`:523`) and a heart blast 90 m (`:586`). The squares are 128 m, so every captain breath crosses into its neighbours. The brain's ground breath takes only its landing square (`recess.ts:459`).
- The second reading reran the review's model over 40 matches: 65.9 % of captain breaths reach a square the brain says is someone else's. 13.5 % of their paint lands on others' squares, and 8.8 % on grey that the brain leaves grey.
- `screen.mjs`'s row, "every building in a captain's colour is in or beside one of its squares" (`screen.mjs:163`), passes this by its "beside".
- *Fix.* Keep the blast inside the squares that came out the shooter's, or size it to the square. Test "in", not "beside".

**M44. Every captain blast sprays a jet out of your own bus, and their sparkles are Rainbow's.**
- *What a player sees.* A stream of paint leaves your bus's mouth toward a captain's blast wherever it lands, as if you'd fired. Since the factions merge, the captains' splashes, sparkles and flung blobs are in Rainbow's colours over teal or crimson buildings.
- *The jet.* `paint()` doesn't pass `stream`, so `barf` calls the geyser for every captain, hiccup and heart blast (`Splat.ts:328`). The geyser sets `jet` (`main.ts:637`), and `main.ts:1636` fires it from `mouthWorld`, your bus. It did this at bced508 too.
- *The colours.* Since 228587c dropped `solo`, a captain's blast takes your splatter's next hue (`Splat.ts:254`, and moves it on, `:282`). The particles have one palette, Rainbow's (`Particles.ts:703`), so the blast's splash, burst, blobs (`main.ts:663-670`) and sparkles (`:692`) are Rainbow's.
- This is from the code. The stills looked at don't show it either way.
- *Fix.* `stream: true` for the match's paint, and a palette by the blast's faction for its particles.

**M45. A captain defends its god once per danger.**
- *What a player sees.* Raid a captain's god and nobody comes back to it.
- *Evidence.* `captain.ts:97-105` rolls once when a danger starts and defends for 4 to 7 s. A cracked god stays a danger until it's healed (`captain.ts:167`), so a captain whose first defence doesn't heal never goes home again.
- The second reading reran the review's `defend` over 100 matches. Of 107 cracked captain gods, 31 were healed and 74 were still cracked at the bell. Captains spent 1.4 % of their cracked time defending. With bced508's roll every step on the same code: 145 cracked, 122 healed, 98.8 %.
- The GPU matches agree. 3 of the 4 captain gods ended the match cracked, and their three heals came 24 s, 31 s and 69 s after the god was first cracked.
- `BUILT.md:61`'s "Learners 40 %, Rivals 70 %, Veterans 95 %" holds neither way.
- *Fix.* Roll once a danger, but a captain that rolled "defend" stays until the danger is over, or rolls again each time its 4 to 7 s run out.

**M46. The edge chevrons point the wrong way up and down.**
- *What a player sees.* A captain behind you shows at the bottom edge, under your thumb, pointing up. One above shows at y 43 of 852, under the status bar, upside down. Names at the side edges read sideways. The white chevron for a breath coming at you does the same.
- *Evidence.* `recessBoot.ts:764` uses `atan2(-y, x)` where `Tag.show`'s angle (up positive) needs `atan2(y, x)`, and `:898` turns the whole tag, name included. The review's check with three's own projection gives the bottom edge pointing up and the top edge upside down; left and right are right.
- *On the GPU.* 5 of 159 off-screen frames (6 of 157 under `&hit=jet`) had a chevron at the bottom edge pointing away from its captain.
- *Fix.* `atan2(y, x)`, turn only the arrow, and keep the name level and clear of the status bar.

**M47. Nothing on screen shows a god's ring, so a person can't play seal two.**
- *What a player sees.* An owner's tap before the ring closes is an encore, with nothing to say so. A guard and a captain sealing two cracks say nothing. HEALED shows only for your own god, at the lowest rank (`recessBoot.ts:575`). The god itself isn't drawn yet (`:9`).
- *Why it's major.* Seal two makes timing the ring the whole of defending (`areas.ts:221`). In the heal study a defender who taps without timing the ring lost 48 % of one-on-one sieges, against 19 % for one who times it. So the approved "one defender holds off one equal raider about four times in five" needs the ring on screen.
- *Fix.* Draw the ring on the heart, and a word for an encore and a seal.

**M61. Every match word is drawn over the clock and the score.** New, from the GPU's stills.
- *What a player sees.* The words' first line lands on the clock row, and both are unreadable: "2:59 DRN40DIAG40NGI 40+" at the kickoff. NO BRAKES / ATLANTIS HAS YOUR BUS lands on the HUD's own NO BRAKES NONSTOP row. A match says 55 to 64 words.
- *Evidence.* Recess's row is at the safe area's top plus 64 px (`recessBoot.ts:710`). The toast's slot is at T + 54 (`hudLayout.ts:77`), with T 10 px when there's no inset, so 64 px too. On a phone with a 62 px inset they come 5 px apart, still overlapping (layout arithmetic, not seen on a phone). It was the same at bced508.
- *Fix.* Move one of the two rows.

### Minor

- **m48. Being hit in turbo keeps turbo.** `shift()` never touches turbo's `level` (`Turbo.ts:208-235`), and the ride forces the gear through it (`recessBoot.ts:476-480`). Hit at Turbo 3, you ride "Nonstop" at up to 450 m/s, twice its speed; under `&hit=jet` you stay in Turbo 3. The bell's loop (`:613`) leaves turbo latched. Once `feat/gears` merges, the same loop leaves a School Zone hover on, as `docs/TODO.md` warns. *Fix:* through `rung()` or `arrive()`.
- **m49. The fence and the captains' first heights come from before any ground loads.** `bootRecess` (`main.ts:1195`) runs with no wait after the far ground starts loading (`:295`), so `groundAt` is 0. The fence is laid once (`recessBoot.ts:226`, `:855`) with its rows 35, 85 and 135 m over the sea. Rerun on San Francisco's far ground: the ground under the ring is 15 to 68 m, 124 of the 1,011 bubbles are underground, and the bottom row's median is 3.8 m over the ground. The captains start 45 m over the sea (`:221`), where the ground is 48 and 61 m high, and rise out of it in the kickoff's first second. *Fix:* lay the fence, and the captains' heights, once the far ground is in.
- **m50. Quiet blasts still put up street signs, with the sign's sound.** Only the impact's own sign is behind `quiet` (`main.ts:675`). A building's bloom queues one through `primary` (`:697`). On the GPU, in a run where you never tapped, 12 signs popped, HICKORY ST among them 2.85 s after the bell.
- **m52. Your first duel is with the Rival, not the easiest captain.** The kickoff hunts the nearest rival (`captain.ts:72-75`, `:121-131`): the other captain at 168 m, against you at 507 m. Rerun with the default seeds: Atlantis, the Rival, locks Inferno at 1.1 s and rides it at 2.8 s, first breathes at you at 5.2 s, and rides you at 6.17 s (the model never flicks). SHOTS.md: "The easiest captain locks you at about 4 s and fires at about 5 s". *Fix:* the kickoff's hunt is for you, the Learner first.
- **m53. In the stop arm your taps don't paint, but they still score.** `blocks()` makes them a flash in the air (`recessBoot.ts:295`), but `playerPaint` (`:282-285`) still counts them, called first (`main.ts:965-967`). A captain can't breathe there at all (`recess.ts:410`). That's the earlier m39, half done. SHOTS.md arms a Bomb III on your first hold after a ride, inside those 4 s of shield, so this will swallow it when the Bomb lands.
- **m54. At the bell the lens goes back to the street's 24°** (`recessBoot.ts:429`). That's why the earlier m29 can't see your heart. Kept at 42°, all three hearts are on screen (the second reading's projection: Rainbow's at 0.72 of the half width). The wider lens also judges the city's detail at 55 % of its distance (`main.ts:1616`, the game's rule for any wider lens). Nobody has looked at what that does to the painted map from 1,500 m.
- **m55. Your own breaths still freeze the screen, uncapped** (it was the review's n55). The 2 s cap covers only `flash()` (`recessBoot.ts:603`). Every tap of yours, at the city, at a captain, or turned into a flash, freezes 4/60 s (`config.ts:606`, `main.ts:1376-1378`). On the GPU those were 59 and 60 of each match's 70 and 69 freezes. A match had 8.3 and 8.1 s of frozen frames, of which hits on or by you were 1.3 and 0.8 s. During your freeze the captains fly on, since the brain runs on the real clock. The counter counts 5/60 a hit (`:58`) where 4/60 freezes, and `BUILT.md:186` and SHOTS.md say 5 frames. SHOTS.md's "at most 2 s a match in all" reads either way: say which you meant.

### Nit

- **n51.** A tag builds a new canvas each time its distance changes (`recessBoot.ts:888-896`): 14.6 a second on average, 59 in the worst second (rerun). The cost wasn't measured.
- **n56.** The fix for B21 writes one key, `strugglebus.landmarks.v1:sf~recess` = "{}" (seen on the GPU). With `?life` too, boats' and planes' kept paint goes into life's one store as `sf~recess`, and `restore()` reads every record whatever its namespace (`Life.ts:175` on this branch), so the normal page shows it. Cars' and picnics' paint is the session's (`Life.ts:299`), so the review's "paint on cars" was wrong there.
- **n57.** A ride still going at the bell stays on. `player()` runs after `bell()` in the same frame (`recessBoot.ts:365` after `:363`) and shifts back up to Express. The flood never drains, with no ride's end to start it, and the beat's roll holds a tilt. It happened in one GPU match, ridden at the bell; the gear after the bell wasn't logged.
- **n58.** `BUILT.md:190` points to "The neighbourhood layer" for seal two, whose `:45` (and `:16-17`) still say an owner's hit heals at once. `:61`'s defend shares (M45) and `:186`'s 5-frame freeze (m55) are stale too.
- **n59.** BOING! is rank 1 (`recessBoot.ts:503`), so any word still up hides it. It was hidden at one of the GPU's bounces, and it has no sound. That's part of the open M25.
- **n60.** `screen.mjs`'s jet row sets `hitGear = 3` by hand (`screen.mjs:174`) instead of loading `&hit=jet`; the GPU run did load the link, and it works. `counts.bounce` mixes the fence's bounces with the brain's breath bounces (`recessBoot.ts:502`, `:513`). Merges: `CameraRig.ts` conflicts with `feat/gears` on the `dist` line, and `main.ts` with `feat/shots`. `feat/gardens` merges clean.

## feat/life

### Blocker, for the Curb flight

Nothing live reaches Curb until the first account's flight calls it.

**B2. The bus rides inside the car it paces.**
- *What a player will see.* The bus parked inside the car it's meant to cruise beside, on almost every street.
- *Evidence.* The bus takes `laneOff(net, w, -1)` (`sim/curb.ts:42`, `:126`), the kerb lane buses and trucks drive (`cars.ts:141-145`). On a one-lane way that's every car's lane. `Curb.ts:158` accepts a car at no distance to the side, and `:163` closes the gap along the lane to 0.
- The life review's runs on San Francisco's roads: 728 of 761 landings, 93.7 % of the road map's length, are one lane each way. At Thursday 17:30, over 25 landings of 30 s each, the bus was inside another vehicle on 51 % of frames, and 24 of the 26 cars it painted were in its own lane.
- `curb.mjs`'s test car sits 3.2 m to the left (`curb.mjs:170-172`), which on such a street is the oncoming lane.
- SHOTS.md:244 says "the bus picks the lane beside a car itself"; `sim/curb.ts:8` reads that as keeping the kerb.
- *Fix.* Pace with a side gap: ride half a lane to the kerb side of a car in its own lane, or pace only cars in another lane. And a test car in the bus's own lane.

### Major

- **M12. The look picks a turn 220 to 600 m on, never the one ahead** (for the Curb flight). The look is read only when the next 600 m stretch is asked for, 220 m before the current one ends (`Curb.ts:204-208`), and `land()` asks with none (`:75`). So the first 600 m after landing go straight at every junction. The life review: over 80 landings looking 90° right, the bus went straight at all 77 right turns within 200 m, and the first turn came 601 m in. *Fix:* pick each junction's way as it comes into reach, from the look then.
- **M13. At a dead end the bus neither slows nor stops asking** (for the Curb flight). `ended` is set only on an empty answer (`Curb.ts:101`). An ask from 8 m short of a dead end returns the way's last point, adds nothing (`:119`), and asks again on the next frame. The life review: over 8 dead ends the bus never slowed and stopped dead in one frame, still reporting 6 to 7.2 m/s, after 1,261 to 1,702 asks, each a 1.4 ms search of the worker's 20,944 ways. *Fix:* an answer that adds nothing past the end is the end.
- **M14. Movers keep their faction but draw in Rainbow's colours** (known; for the merge). Every draw is `HUE_RAMPS[paint.hue]` (`Life.ts:414`, `:460`, `:670`, `:733`). `feat/life` has factions' step 1 (7065fbe) but not step 5's `factionLook.ts`. After `feat/shots` merges, an Inferno tap turns the houses Inferno's and the cars and blankets inside its circle Rainbow's. The first account asked for this in `docs/TODO.md`.
- **M15. One tap takes a park at its peak** (medium sure; for the merge). f07a16e passes the blast's radius, 85 m at the roofs (n16). On the GPU a 66 m tap at Dolores at 16:30 held 43 picnics; the life review's Node model puts 138 blankets in an 85 m one. So two or three taps reach life's 400-dancer cap, past which painted blankets draw empty (the earlier m15, still open). Dolores fully painted was 170 K triangles, 2.1 times life's budget, in the earlier GPU run. *Fix:* the cap and the dancers' cost, before the merge.

### Minor

- **m19. A tap on a bridge deck paints the boats under it.** With f07a16e the circle sits on the deck (`blastFloor`), and the column reaches 250 m below it (`Life.ts:71`, `:847`). The life review: a blast on a 77 m deck painted a sailboat and a ferry on the water. A tap on the water left the deck's car grey, which is right. Whether the deck should stop the blast is the studio's call. `CONTRACT.md:238` still lists only mega, super and hose blasts, and doesn't say `y` is the floor.
- **m20. The early afternoon thinned.** The same groups now arrive from 8:30 to 16:30 (`parks.ts:37-39`), so 2 pm has a quarter fewer than before and 3 pm a sixth fewer (the second reading's arithmetic on the curve; the review's lawn: Saturday 15:00, 156 to 132). The peak is about as high, but at 16:30. `parks.ts:36`'s "the same afternoon peak" and `LIFE.md:55`'s "156" at 15:00 are stale. *Fix:* add the morning groups on top of the old ones.
- **m21. Gaps in Curb's interface for the flight.** The heading is the current 4 m segment's (`Curb.ts:201`), so it snaps at corners: in the life review's 37.5 km of rolling, 82 jumps over 30°, the worst 142°. An empty answer means "no street" and also "the roads aren't in yet" (`lifeWorker.ts:309-312`), and `Curb.ts:89-91` calls both FIND A STREET. A roll of 0 s gives the landing point to arc to: say so in `LIFE.md`. The joins between stretches are clean.
- **m22. `life.blast` ignores the super's tag** (`Life.ts:839`; for the merge). At `feat/shots` 139989c every Hose impact calls it, about a dozen a second, so a car in the stream goes from level 1 to 3 in a quarter second. A pour raises a building one level at most.

### Nit

- **n16.** `Life.ts:834` says "`r` across", but `r` is a radius (`:849`). f07a16e passes the blast's radius, 85 m. SHOTS.md:57 says the splat "grows from 60 m to 85 m across", and the 60 was a radius (`config.splat.blastRadius`), so only a radius grows: the first account's step 1 reads it that way. `blast.mjs` tests r = 42.5 (`blast.mjs:79`), a quarter of the area. Fix the comment and the test; the first account will fix "across" in SHOTS.md and `CLAUDE.md`.
- **n17.** `parks.ts:9` says arrivals start at 9:00; the code starts them at 8:30 (`:37`).
- **n18.** `hit()` rescans the snapshot for each mover (`Life.ts:895`): 0.55 ms for an 85 m tap on a full snapshot, by the life review. Fine as it is.

### What holds

C15 is built as agreed: the faction kept only when it isn't Rainbow's, read back through `ownerOf`, taken over at level 3. The circle is flat on the map, a mover takes one level a blast, nothing runs without `?life`, and Curb idle costs one 19 KB buffer.

## What the GPU showed

### Recess, 1f3901f

- **Two whole matches** (`?recess&bots=rival` and `?recess`):
  - 0 page or console errors. 38 programs at the warm-up, 0 after. One warning, an X4000 on `f_hueStep` in the particles' shader: that's factions' step 5 (7c8c13b), the first account's, and every path through it returns.
  - Frame intervals, median / 95th / worst: 50.2 / 83.6 / 3,950 ms and 66.5 / 100 / 1,217 ms, screenshot frames cut. The 15 s medians climb from 33 to 83 ms.
  - Draws, median / 95th / most: 181 / 210 / 231 and 180 / 211 / 232 (bced508's matches: 152 / 182 / 202). Triangles 2.27 / 3.43 / 3.68 M and 2.19 / 3.71 / 3.98 M. At the bell, 234 draws and 3.69 M, and 229 and 4.04 M. The rooftop sprouts still drive the triangles, the earlier M24, which `feat/gardens` answers.
  - The 180 s took 255 s and 267 s of wall time, all of the gap in frames over the 50 ms cap.
  - Freezes: none of 149 and 157 captain blasts froze. The match's own count ended at 0.92 and 0.75 s, and the clock ran through every freeze (m55 for the rest).
  - The saved city: the normal page painted 72 of 82 buildings at the arena's middle, and after each match the 8 saved keys were byte for byte the same and read back 72 of 82 (n56 for the key added).
- **The frame's cost**, at 7 poses with the brain held:
  - The fence is 1 draw and 20,220 triangles, and the ribbons 2 draws and 160 triangles. Neither had a cost that showed past the 2 to 3 ms between repeats.
  - The wider lens with its pull-back: +20 draws and +0.12 M triangles on average, about 0.1 ms. Late in a match, +13 and +16 draws.
  - At the same geometry, mean frames: bced508 17.15 ms (at the 60 fps cap), 0432dfc 21.93 ms, 1f3901f 24.73 ms. That's three rounds each of bced508 and 1f3901f and two of 0432dfc, with draws and triangles the same within 2 draws at one pose. So most of the slowdown came with the factions merge, but the rounds spread by up to 5 ms and there was no GPU timer: likely, not proven.
- **The kickoff:** the camera starts 170 m over the bus with both captains in frame and tagged in 63 of 63 frames, and swoops to 84 m in 2 s with both tagged in 53 of 53. The city was loaded from the first frame. At 510 m the captains are a few pixels and the tags do the work; the two tags overlap as the captains close.
- **Chevrons:** shown in 159 of 159 and 157 of 157 off-screen frames, with 5 and 6 pointing away (M46).
- **Being hit:**
  - The freeze was 2 frames (82 and 74 ms), and the flood covered the bus in 0.42 s. One barrel roll took the up vector to -0.995, and the fling threw the bus 39 m up (at Jet 48 m, to 153 m over the ground).
  - Nonstop held in 121 of 121 ride frames, and Jet in 134 of 135; a flick down only says NO BRAKES. The drain took 0.52 and 0.66 s.
  - The forced gear stays after the ride until you flick down, and at Jet the bus bounced off the fence mid-ride. Should a ride hand back the gear it took? That's a call for the phone.
- **The fence:** bounces at Nonstop, Express and Jet, the heading turned 107° to 180°. The flight never passed 749.6 m from the middle, but at Jet the bus was drawn up to 10 m outside for a frame.

### Life, b65af07

- **The parks over Dolores, Friday.** Groups in the park from 120 m up (in the snapshot): 08:55 1 (3), 09:00 1 (3), 09:30 13 (15), noon 53 (64), 3 pm 88 (108). At 60 times speed from 08:10, the first came between 08:39 and 08:44, it was still one at 09:00, and there were four at 09:05. Every blanket was grey, and none was off the grass.
  - From 35 m: 117 to 137 draws and 0.95 to 1.08 M triangles. Life took 4 draws, none in the sun's pass, and 7 K to 33 K triangles. Frame medians were 16.8 to 24.5 ms, GPU 16.5 to 23.9 ms.
  - From 120 m: at most 139 draws, 1.12 M triangles, and 25.4 ms of GPU.
  - Hitches: one 128 ms frame at 08:55, and at 3 pm six frames over 34 ms (the worst 55 ms) while picnics loaded. 38 programs from the warm-up to the end of every page.
  - For the producer's phone: one group in Dolores at nine, and four by five past. If "a few groups from 9 am" means more than that, start them a little earlier.
- **Taps on this branch.** A tap still paints only the mover it's aimed at: `life.blast` runs for a super alone (`main.ts:566`), as planned until `feat/shots` merges.
  - Embarcadero car: 21 movers inside its 66 m circle, 1 painted. A building by the street: 1 car inside, none painted. A ferry at its berth: painted 0 to 1. Dolores at 16:30: 43 inside, 1 painted, then the same one 1 to 2.
  - Through the super's QA hook, `life.blast` painted 15 of the 15 inside its 101.8 m, one level each.
  - Frames: on the street a median of 16.7 ms, the worst 29 to 41 ms. At Dolores 23 to 26 ms, GPU-bound, and its impact frames took 50 to 68 ms, 33 to 53 ms of it CPU, cause not found. A page's first touch cost one 246 ms frame on the street and one of 325 ms at Dolores, untraced.
- **The hand-off.** Merging f07a16e conflicts twice in `main.ts`. Its `life.blast` call passes 7 arguments, so the merge must add `ownerOf(b.spec.faction)`, or movers paint Rainbow's; `tsc` catches it.

## Left out

- **"NOW GET THEM BACK is gone."** SHOTS.md's ding-ding and STOP ARM OUT replaced it.
- **"INFERNO's tag sits on the MEGA button."** True in the still, but MEGA goes with `feat/shots`.
- **"Nothing to arc to"** (m21). A roll of 0 s gives it.
- **"A tap paints only the mover it aimed at,"** from the life GPU check. That's the plan until `feat/shots` merges, not a fault of `feat/life`.
- **"The look never picks the turn"** (M12). It does, 220 to 600 m on.
- **The cost of a tag's new canvas** (n51). Unmeasured, so it's a nit.

## Not checked

- No phone, no A15, no Safari or JavaScriptCore. The frame times are a shared laptop's headless Edge, with no GPU timer.
- Not run on the GPU: Piñata, Bubbled, `&newcomer`, sound (there's none to hear), a merged build of either branch, f07a16e with life, a ferry under way, and life's share of the GPU (no run with life hidden).
- Nobody ran `tsc` on 1f3901f. The GPU build ran `vite` and `iosfloor` only.
- M43's and M45's numbers are Node models of the brain, not the real buildings. M44's jet is from the code, not seen in a still. M61 on a phone is layout arithmetic.
- B2's, M12's, M13's, M15's, m19's, m21's and n18's numbers are the life review's Node runs, not rerun here. Curb hasn't run in a browser, since its flight isn't built.
