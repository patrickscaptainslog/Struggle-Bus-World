# Stage 1, the core release: what was built (feat/core)

The first stage of `docs/specs/core/CORE.md` (sections 3.5, 3.6 and 5, on the docs branch): what a new player and a returning player meet before any goal is added. A loading page where there was a flat colour, a link that shows a picture when it is shared, a return visit that starts over the paint you left, a frame counter that tells the truth, and the default shots. No goal, no score, nothing new to press.

Nothing here is pushed or live. Going live waits on the second account's reviews and on the producer's calls 4, 5 and m92 (below).

## The base: 4f33648, and why not the shots' newer head

`feat/core` is cut at `feat/shots` 4f33648, a fast-forward from main (main is its ancestor: no merge commit, no conflict). It carries main plus the default shots: the 85 m tap, the Comet at Nonstop and faster, the Lob with its latch fix, School Zone, MEGA off, everything else behind its flag.

`feat/shots` has moved since, to 98fca30 (the Lob from any height and the Comet dead ahead). That head's own table has a row red on the frame budget and calls still open for the producer, and the rule for this cut is to take the shots only where their full run passed. So the core is cut at 4f33648, and the far shots merge in later, on their own review.

By `git merge-tree`, the base merges cleanly with rc/1 and with feat/handling, and has three conflicts with feat/factions 33192b3 (`src/main.ts`, `src/world/buildingMaterial.ts`, `src/world/props/sprouts.ts`). Past the base, feat/core's own lines meet rc/1's and feat/handling's at one spot: see "The start block", below.

## What was built

| Commit | What |
|---|---|
| 4bf9b40 | The loading page: the title STRUGGLE BUS and a pixel bus, in palette colours, until the first frame. The canvas stays hidden until it has drawn once, so an undrawn canvas can't show black (only Safari can show that it did). Not on the Moon's pages or `?resume`, which have their own |
| 516b127 | `tools/ogshot.mjs`: the link preview's picture, made from the build (three candidates, 1200 x 630, no HUD) |
| e833661 | The link-preview tags (`og:` and `twitter:`), `public/og-1.png`, `rel="icon"`, `tools/ogtags.mjs` |
| c83315a | The return record: where the bus was when it last breathed a shot that bloomed a building, and where that shot landed (P). Written only after the paint's own save went through, never on the Moon, `?recess`, `?swerve` or `?lift&lifted` (`src/game/Return.ts`, `src/world/PaintState.ts`) |
| 642074b | The return start: a return visit starts over that paint, held still under the fog, lifted over the roofs, never at a bridge; on a Golden Gate return the skip tap jumps the bus past the gate (`tools/returnvisit.mjs`, `tools/openingsame.mjs`) |
| 5ce730e | `?fps`: `hit` (the worst frame after a shot's impact), the draws' and triangles' `max`, `first` (the tap on the link to the first frame) and `load` (this tab's loads) |
| 8db160b | A log of every shot for the checks (`window.__game.shots()`, `tools/flight5.mjs`) |
| a4ec81b | The Hose waits for `?hose` (call 4, the studio's pick) |

### After the build's review and the outside look

| Commit | Finding | What changed |
|---|---|---|
| 818b09b | `?fps`'s `hit` never measured a Comet, a Lob or a far Bomb (their plans have no hit-stop) | `perf.hit()` is called from the Splatter's `impact` hook for every shot but the Hose's light impacts. `returnvisit --budget` now fires a Comet at Nonstop onto a tower on a fresh page and needs `hitMs` over 0 |
| d962bdb | `load` read 2, and `first` minutes in, on pages that make two meters (`?moonland`, `?earth`) | both counted once a page |
| a0c5cd5 | `max` held the fog's and the load's frames | the peaks start again at the first ready frame, past the fog |
| 40363cf | an error at boot left the loading page's bus bobbing over the error line | the loader goes before the error is written |
| 78252da | the skip tap's jump also ran on `?earth` | not on `?earth`, whose opening stays as it was |
| 31c02c6 | a return start from a record made high up (a Comet or a Lob from 400 m) put the paint below the frame's bottom edge (`returnvisit --high`: P at 115 % of the frame's height) | the hold keeps the bus no higher than `returnTune.over` (60 m, an ESTIMATE) over the paint's roof |
| 550b485 | og-shot's paint check could not fail: a grey city at golden hour already passed it | each pose is shot grey first; the painted frame's paint share must rise 15 points over it. `--nopaint` shows it failing. Candidate 1 renamed for what it shows |
| 9fa289a | controls-firstrun had no pass line | its first-run leg reports the gate on the next visit and takes `SB_Q`; the row needs 3 hint lines on the plain link, 4 with `&hose`, the cues in order, and the next visit at the Golden Gate |

### Round 3: the first whole table's open items

| Commit | Finding | What changed |
|---|---|---|
| 410222e | **A game fault.** A finger landing in the look zone (a look, a flick off the lane) 0.5 s after a pull's lift ran the Lob's latch on, nothing gave that back when it lifted, and a tap at 1.2 s threw the lift's 32 degrees with the bus level. M90's fix covered a steering stroke only. flight5's case flicked on the lane's edge to a third of a pixel, and its "no Lob under 25 degrees" read the thrown angle, so it could never fail | Input numbers its presses and fires `onUnpress` when a finger that pressed with nobody flying lifts as no tap; the Lob takes that press out of its latch and replays the rest. The shot log's `bodyDeg` is the live body, `angleDeg` the thrown angle. flight5 flies M90's case in the lane and in the look zone, each flick checked to be a gear; `SB_F5=m90` runs them alone. Three s_lob rows |
| aaa9da0 | opening-same compared no pixels: the exhaust puffs (Math.random) moved round the bus run to run. The "salmon disc" under the bus is one of them, lit by the low sun, as on BASE: meant | each still is drawn again with the puffs taken out, and those pixels compared |
| d82285f | the Comet's impact frame: the bloom's arpeggio made up to 40 Web Audio nodes in it | the notes after the first are queued and made when due; every voice starts at the same audio time |
| 009dd7b | a return start's first frames drew 229-392 times under the fog, each new mesh's first draw unculled; and `__stats` held the fog's peaks for a second after it | ten forced first draws a frame, the rest culled as normal till their turn; `peaksFrom` writes `__stats`. `returnvisit --budget` judges every frame from the first drawn one, downtown and in the Marina |
| 6d1c787 | the link picture: the bus a speck, no bridge in the Golden Gate's | `tools/ogshot.mjs` places the lens by `__qa.camAt` beside the bus, with a landmark and one bloom, and checks the bus at 150 px wide; `public/og-2.png` replaces `og-1.png` |
| 8dc786a | controls-boom read 115-205 draws at one pose: the sky ran on the real clock, and the sun pass keeps every caster with the sun just up | the rows that judge draws pin the sky at the worst minute measured and fly each page three times (`SB_REPS`). The repetition found the Waterfall's case making two pools in 4 of 9 runs (controls-falls fails on that, not on its draws): open |

## How to fly it

On the branch's preview link (`CLAUDE.md`, "Hand-in"). A new link is a new site to Safari, so it starts as a first visit.

1. Open it. A title and a little bus show at once, then the game.
2. The first visit is the opening you know. The first hint has three lines: HOLD HIGH UP TO AIM is gone with the Hose.
3. MEGA is gone. Tap: the bigger splat. Flick down from Cruise: School Zone. At Nonstop or faster a tap lands ahead, in view (the Comet). Nose up past 25 degrees and tap: the Lob arcs out, and its one-time hint shows (m92).
4. Rest a thumb high on the screen for a few seconds: nothing pours.
5. Before painting, close the tab and open the link again: the Golden Gate. Tap to skip: the fog goes and the bus is already past the bridge, free to climb.
6. Paint a few blocks. Close the tab. Open the link again: you start where the bus was when it painted, standing still in the fog. The fog lifts, TAP TO SKIP, and you can splat within five seconds. Try once after painting downtown among the towers, and once after a Comet from high up.
7. With `?fps`: a `hit` line after each shot, a `max` beside the draws, `first` and `load`.
8. After it's live: paste the plain link into Messages: a picture shows.
9. Don't open `?crew` on the live site on a phone you will hand to a tester: one visit keeps the faction button on that phone for good. `?crew=off` takes it away.

Flags: `?hose` wakes the Hose and hold to aim with it. `&noreturn` makes a tool's second load the Golden Gate's, not a return start.

**Hose off also turns off hold to aim. Without the Hose it does nothing.** CORE.md named hold to aim as a stage-1 shot, so this is a cut, said out loud (call 4). Design (b), the Hose on with a resting thumb that pours nothing, is written down and not built: undo (a) by making `hoseOn` true (or reverting a4ec81b), then three guards as tunables: the pour starts on a 24 px drag from where the aim began; no pour from a hold begun while another thumb flew (`Hold.flying`); a tap mid-pour ends the pour and fires with what the belly holds, at least `hoseTune.minTank`. ESTIMATE 1.25 agent-days, with its four rows in `s_hold.ts --rest`.

### The measuring pass on an iPhone 13 (call 6)

On the link with `?fps`, Low Power Mode off. Close every tab; on a phone network open the link and note when the title shows, then read `first`. Under the Golden Gate read fps and `1%`. At Jet over the Financial District read `max`. At Nonstop over downtown tap three Comets into the towers and read `hit` after each. Paint five minutes; read `worst` and `1%`. At ten minutes read `load` and say how warm the phone is. Then paint a block downtown, close every tab, open the link again: read `first`, fps, `1%`, `hit` after one tap, `max` and `load`.

Pass: 30 fps through the opening, the return start and the paint run; every `hit` under 33 ms; `max` at most 200 draws and 1.5 M triangles; `load 1` at ten minutes and after the return. `max` counts from the fog's end; read it after five seconds of flight (the first seconds after a return start's fog drew 229 and 328 draws in two of the laptop's runs: UNKNOWN, below).

## What ran, by row, with what it printed

Every row ran through the studio's gate runner (each browser row and build waits for the one GPU lock); a row's exit decides. These ran on the final build (its main chunk `main-CxCr-598.js`; a rebuild of the last code commit, 9fa289a, gives the same name, so the two comments reworded in a0c5cd5 after the rows changed nothing built), unless the row says otherwise:

| Row | Exit | Printed |
|---|---|---|
| tsc | 0 | `npx tsc -p tsconfig.main.json --noEmit`: nothing |
| build | 0 | the build Vercel runs |
| iosfloor | 0 | "iOS 15.0 parses every chunk" |
| build-ref | 0 | "R holds 4f33648's build: main-Cs6n-uOa.js, all 553 files as the manifest" |
| return-rule | 0 | "return: all 76 passed (61 rule rows, each failing on the stub but 2 whose answer is the saved pose; 15 record rows)" |
| returnvisit | 0 | "returnvisit: all passed": (1) the record stored 6 ms after a save that went through; (2) the start over the paint, held 327 frames without moving, P at 35.7 % of the frame's height after the fog, a skip tap ended the fog in 596 ms with no splat, a second tap splatted 2.3 s after the first frame; (9) downtown 104.8 m over 85.3 m towers, P at 53.3 %; (11) the skip tap put the bus 240.0 m past the gap 11 ms after it, gears free in 39 ms; every other case passed |
| return-high | 0 | "high: P projects at 25-65 % of the frame's height (53.3 %, in frame true; the bus 104.8 m)". Before 31c02c6: 115.3 %, out of frame, exit 1 |
| warm-return | 0 | "warmcheck: passed": no program after the warm-up on a return start |
| budget-return | 0 | peak draws 132, triangles 657,622 over 20 s of flight; "a tap at NONSTOP is a Comet onto a building", "__stats.hitMs after the Comet's impact over 0 (74.1)"; the first 5 s after the fog 328 (printed, not a pass line) |
| og-shot | 0 | "ogshot: 3 candidates pass": paint 79.4 % (grey 32.9 %), 67.3 % (grey 45.2 %), 77.1 % (grey 53.1 %), each 1200 x 630 |
| og-shot-nopaint | 0 | the tool exited 1 with no paint, as it must: "paint 32.9 % (grey 32.9 %)". On the build before the height cap |
| controls-firstrun | 0 | "the first hint has 3 lines (3)", TAP, DRAG, none in order, "the next visit is the Golden Gate's: openingBridge set (true)". On the build before the height cap (its pages carry `&noreturn`) |
| controls-firstrun-hose | 0 | with `&hose`: "the first hint has 4 lines (4)", the rest as plain. The same build |
| det-skyoff | 0 | "det-cmp: 8 of 8 views pass" (the base's eight `--det` views, the sky off) |
| opening-same | 0 | "openingsame: all legs equal": a first visit's pose trace equal to the base's for 30 s, with `&hose` and the HUD, both without the HUD, and both plain with it |
| loadpage-art | 0 | "the markup, its title, its colours, its CSS, its scripts and noload all pass" |
| ogtags | 0 | "all 12 tags, each once", "og-1.png in the build, 1200 x 630, 119 KB" |
| hold-review, hold-late | 0 | "review checks: all 80 passed", "late lift checks: all 4 passed" |
| lob, lob-street, shots-lob | 0 | "lob checks: all 1231 passed", "all 24 passed", "all 90 passed" |
| s-boom, s-falls | 0 | "boom checks: all 199 passed (60 rows)", "falls checks: all 202 passed (70 rows)" |
| s-shots-known | 0 | "known4: FAILED 4 of 363, exactly the four known rows": Nonstop from 300 m lands 5.6 s ahead and downtown Nonstop's Comet on a face paints 10 buildings, each at 30 and 60 fps, as at the base; they wait for stage 3's Comet reach |

Rows run on earlier commits of this branch, not again on the final build:

| Row | On | Exit | Printed |
|---|---|---|---|
| loadpage | 4bf9b40 | 0 | visible at 579 ms under 400 kbit/s and 300 ms; every pixel round it the page's colour; the canvas hidden before the first frame; the loader gone in the first frame's task; reduced motion stops the bob; never visible on the Moon's pages |
| loadpage-on-R | 4f33648 | 0 | the same tool on the base failed with 5 failures, as it must |
| ogtags, on the base's build | 4f33648 | 1 | 13 failures, as it must |
| returnvisit-on-R | 642074b | 0 | the tool on the base failed 9 cases, as it must |
| warm-plain | a4ec81b | 0 | no program compiles after the warm-up |
| warm-hose | a4ec81b | 0 | with `?hose`: no program after the warm-up; the Hose poured |
| flight5 | a4ec81b | 0 | "flight5: all passed": 5.1 min, 54 intents, 30 shots (27 taps, 2 Comets, 1 Lob), 0 pours; M90's case one plain tap. On the base it failed, as it must ("a still finger high up for 3 s pours nothing (1 pours)") |
| hint, controls-lob, misfire | a4ec81b | 0 | the Bomb's hint in 20 s; every pull's tap a Lob; "every row threw its Lob (7)" |

## What did not run

- **The full gate on the final build.** These rows have never run on any feat/core build: warm-comet, warm-crew-lob, warm-crew-bomb, warm-extras, warm-curb, controls-lob-noon, controls-bomb, controls-boom, controls-falls, controls-curb, misfire-30, misfire-60, budget, budget-bomb and det-golden. The splat path (the return note at every first bloom, `persist()`'s new return) and the plain link's holds (the Hose off) run through them. They passed on the base, not on this code. They run before the push, with GPU time.
- **The phone.** Sound, the art, how the return start and the skip's jump feel, the A15 (the measuring pass), Safari 15 on a device (only the parse is checked), and the link picture in Messages (preview links sit behind a sign-in, so that waits until live).
- **The black canvas.** Chrome shows the page's colour under an undrawn canvas, so no row can prove the hidden canvas fixes it; only Safari can. It is hidden either way.
- **opening-same's pixels.** The base against itself differs round the bus at every still, so the first visit was compared by its pose trace (equal to the last bit for 30 s in all three legs), not its pixels.
- **A boot that throws.** The loader's removal on an error was read, not run.

## The producer's calls, with the studio's pick

The first three block going live.

- **Call 4, the Hose.** Off by default, `?hose` to try it (built, the studio's pick), or on with the resting thumb fixed (design (b), above, 1.25 agent-days more). Hose off also turns off hold to aim. Without the Hose it does nothing.
- **m92, the Lob's one-time hint (TAP TO LOB IT / INTO THE RING).** Keep (the studio's pick) or drop. It is a fourth one-time hint beyond the three the shots approved. Drop is a tenth of a day: its toast out of `Coach.ts` and `Controls.ts`, the ring and its pillar kept.
- **Call 5.** Stage 1 goes live, MEGA off, before the first test round. The producer merges, or names who does.
- **Call 6.** The iPhone 13 for the measuring pass.
- **The cost.** ESTIMATE 7.5 agent-days with the Hose off, past CORE's 4 to 6, after the review added the return start's hold, the skip's jump, the save check and checks that can fail. Nothing was cut to fit.
- **The link picture: one of three.** In plain words:
  1. *The Marina's roofs, the bay beyond.* Planned as "the Golden Gate", but the chase camera looks down and the bridge is too far off: it isn't in the picture. It is in the build now, until you pick.
  2. *Alamo Square toward downtown.* The grey real city behind, a painted band, roads to the bus. The outside look's pick.
  3. *Dolores Park toward downtown.* A dark lawn fills its lower left.
  In all three the bus is a speck at chat size (about 25 x 45 px of 1200 x 630), and the paint covers 67-79 % of the frame. **Studio's pick: 2 now, and then a closer camera for the picture, so the bus fills about an eighth of its height, and a path of paint with grey city round it, about 0.5 agent-day (ESTIMATE).** Putting 2 in is a one-file swap.
- **The loading page.** The words STRUGGLE BUS (the link's title says Struggle Bus World) and the little bus. **Studio's pick: keep it as it is for stage 1**; the bob is the only sign it's loading, so look at it on a slow network.
- **The return after a Golden Gate visit.** The skip tap jumps the bus past the bridge, out on the open bay, so the bridge goes by unseen. **Studio's pick: keep it**; a slight turn toward the city after the jump is a small change if you want buildings ahead sooner.

The studio's own calls, for the producer to overrule:
- The return start is the bus's own pose at its last shot that bloomed a building, held still under the fog, when the paint was 100 m or more ahead of it (`returnTune.ahead`, a change to the plan's rule: a tap from the roofs lands too near to frame); else 220 m back from the paint on the shot's heading (`returnTune.back`). Whether 220 m back reads right is the phone's to say.
- No higher than 60 m over the paint's roof (`returnTune.over`), so a Comet from high up still starts in view of its paint.
- No Golden Gate gate on a return start, and no start within 250 m of a bridge (`returnTune.bridgeClear`).
- `?earth` left out of the return start and of the skip's jump.
- The record only from paint that was saved, never under `?recess` or `?swerve`, and never for a landmark (its paint is kept under its name, the record holds numbers).
- A tap on the loading page doesn't skip the fog on a repeat visit (the canvas isn't hit while hidden). Kept: a tap before anything is on screen shouldn't skip a reveal the player hasn't seen. TAP TO SKIP comes with the first frame.

## UNKNOWN

- Whether main 34d55cf..058217c (288 commits, the showcase behind flags), the Lift's first slice (`feat/factions` to e0f1dde) and the gardens' budget (`feat/gardens` a1138f3) had the second account's review: no file in `docs/reviews` was found for them.
- Whether iOS keeps `sessionStorage` over its own tab reload, which `load` relies on (ESTIMATE: it does).
- How long a return start stands still in thick fog on a slow network: the fog waits for a region. Not measured.
- Whether coarse far-field tiles show after the skip's jump (up to about 870 m under 0.7 s of fog). The laptop's run printed the loaded region count steady at 9 over the 2 s after; the phone decides.
- Whether Safari's seven-day storage rule wipes the record with the paint (same origin: it should take both).
- Messaging apps' limits on the picture's size (it is 119 KB; 300 KB is the target).
- A small salmon disc on the ground under the bus in two of the return visit's frames (after the fog at the Marina, after the skip), not in the base's skip frame. Not identified.
- The return start's first five seconds after the fog drew 229 and 328 draws at their peak in two of the laptop's runs, over the 200 budget, while the city streams in round the bus; the 20 s after them peaked at 132, and a `?lat` start's first five seconds 103. Whether a phone sees the same, and whether the city's priming should finish under the fog, is open.
- The laptop's Comet impact frame: `hit` 75.9 and 74.1 ms in two runs. A laptop's integrated GPU says little about an A15, but it is over 33 ms, and the measuring pass's step 4 is where it is decided.

## The start block, and the other branches' boots

The return start's block sits right after `?heading` in `main.ts`'s boot. rc/1 and feat/handling put their `?recess` and `?swerve` boots at the same spot, and Recess sets `lat` and `skipintro` only after it, so their merge will conflict there. Until the second account says otherwise, the return reads the link flags `recess` and `swerve` itself and makes no start and writes no record under them. When those branches merge, put their boots before the return block, or name the one flag that means "not the saved city", and the return reads that instead.

When life's lock-on or Recess come to main, `input.aimOn` (the Hose's flag now) becomes `!moon && (hoseOn || lifeOn || recessOn)`: their holds need the aim.
