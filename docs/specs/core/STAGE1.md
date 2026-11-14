# Stage 1, the core release: what was built (feat/core)

The first stage of `docs/specs/core/CORE.md` (sections 3.5, 3.6 and 5, on the docs branch): what a new player and a returning player meet before any goal is added. A loading page where there was a flat colour, a link that shows a picture when it is shared, a return visit that starts over the paint you left, a frame counter that tells the truth, and the default shots. No goal, no score, nothing new to press.

Nothing here is live. The branch is pushed up to c2a00c4; round 3 (below) waits for the studio lead's push. Going live waits on the second account's reviews and on the producer's calls 4, 5 and m92 (below).

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
| 6d1c787 | the link picture: the bus a speck, no bridge in the Golden Gate's | `tools/ogshot.mjs` places the lens by `__qa.camAt` beside the bus, with a landmark and one bloom, and checks the bus at 150 px wide; `public/og-2.png` replaces `og-1.png`. Its checks could not fail on the landmark or the side, and counted the sky in the bloom: replaced below |
| 8dc786a | controls-boom read 115-205 draws at one pose: the sky ran on the real clock, and the sun pass keeps every caster with the sun just up | the rows that judge draws pin the sky at the worst minute measured and fly each page three times (`SB_REPS`). It said the Waterfall's two pools were the repetition's find: wrong, they were this round's (below) |

### Round 3, after its review and its outside look

The review found one blocker, two majors and five minors; the outside look at the round's frames found four majors on the return start and the link picture. Each that held is fixed here, in its own commit; the rest are below, with why.

| Commit | Finding | What changed |
|---|---|---|
| f13c986 | **controls-falls red, this round's.** Two pools for one pour in 5 of 18 runs with the first-draw cap (009dd7b), none in 18 without it. The case's first touch, a tap in the lane over the Financial District, sometimes hit a tower over 40 m and poured, and its pool landed in the measured tap's window when that opened before it landed (8.4 s pour, 9.7 s pool, the window at 9.55 and 9.6 s in the two failing runs of 18 recorded). The cap only changed how fast the frames ran, and so when the window opened. The second pool is the game's right answer to a real tap | the case waits on the game clock until that first touch's runs are done, records what it hit, and fails a row if a run is still going as the window opens. The game is not changed |
| 873e2e1 | a ghost (a swap's mesh drawn unseen before its commit) could wait its first-draw turn and be committed first, uploading in view; and nothing measured the queue | a ghost never waits; `City.firstsWaiting` says how many do, and `returnvisit --budget` prints it under the fog and after |
| d20796f | **the outside look:** a return start's camera came in 140 m through the towers round the paint, and stood inside a painted spire under the fog (downtown) | no opening pull on a return start: the lens starts at the chase. `returnvisit --budget` checks the lens is never under the roofs where it stands under the fog |
| 9a6f2c5 | the arpeggio's second note could still be made in the impact frame (it was kept only 5 ms past the lead) | notes queued in the frame that blooms wait for the next update |
| 669fa50 | controls-boom passed at 200 draws, the bound, and nothing showed why | the boom and falls rows print the worst frame's draws split three ways: the sun pass, first draws, the rest. At 07:15 the worst is the sun pass (69-86 of up to 201), not first draws (0-6): still red in 2 of 12 runs, src/render's (below) |
| 4e431fb | flight5's look case never checked that its flick landed in the look zone (a flick is a gear anywhere) | each M90 case checks `Input.inLookZone` at the flick's point just before it |
| 1df2a26, 033d823 | opening-same left out the fog's stills wherever the base's own two runs differed, the stills the first-draw cap acts in; the bites row wrote over its stills. Then the base itself was found to flicker at 30 s: one lit spot far off, 17 pixels, on in some of its runs | every still is compared: where the base's runs differ the new run must equal one of them, up to two more base runs taken while it equals none; only the trace still exits 3; the bites row has its own folder |
| 7d020be | **the link picture's checks passed a picture with its bridge cut out, and a city as painted as the rejected one; the outside look:** the bus a third of the frame, the dark park cut, less paint; the Golden Gate's bus orange among orange domes; the third reads as noise | three new places, the bus near and side on; the landmark's check reads pixels (its column against the same frame with its own objects hidden), the side and the lens's height are read on the page, the bloom is counted over the city alone (20-45 %), yellow off the bus 2 % at most, paint at level 2 in four hues (no yellow, no orange). `public/og-6.png` (Coit Tower from North Beach) replaces `og-2.png` |

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

Pass: 30 fps through the opening, the return start and the paint run; every `hit` under 33 ms; `max` at most 200 draws and 1.5 M triangles; `load 1` at ten minutes and after the return. `max` counts from the fog's end. On the laptop a return start's frames, the fog's included, now draw at most 151-169 (round 3); before the first-draw cap they drew up to 385.

## What ran at the head, round 3

Every row ran through the studio's gate runner, each browser row and build alone under the one GPU lock; a row's exit decides. These ran on the head's build (main chunk `main-DH5UPV0V.js`: the round's last game change, 9a6f2c5, and every commit after it change no chunk; the last build, with og-6.png in it, gave the same name), unless the row says otherwise.

| Row | Exit | Printed |
|---|---|---|
| tsc | 0 | nothing |
| build | 0 | the build Vercel runs |
| iosfloor | 0 | "iOS 15.0 parses every chunk" |
| lob, lob-street, shots-lob | 0 | "lob checks: all 1268 passed", "all 24 passed", "all 90 passed" |
| hold-review, hold-late | 0 | "review checks: all 80 passed", "late lift checks: all 4 passed" |
| controls-falls | 0 | three runs a faction, the sky at 07:15 PST: 9 of 9 "it poured, its drops and its pool (62 drops, 1 pool)", "nothing poured before its tap still running" in all 9 (the first touch poured in 5); the worst frame 104-112 draws, the sun pass 56-58 of them |
| controls-boom | **1** | western-addition-150 182-201 draws over 12 runs, **201 in two** (the sun pass 82 and 83, first draws 5, the rest 113-114, 1.32 M); -300 122-135; downtown-150 54-69. The same pose read 201 at c2a00c4: the sun pass at a low sun, src/render's |
| budget-return | 0 | every return-start frame from the first drawn one to 5 s past the fog: downtown the most 151 draws (under the fog), 0.698 M; the Marina 154, 0.840 M; up to 360 and 452 meshes waiting their first draw under the fog, 0 after; "the lens never under the roofs where it stands under the fog (0 frames)" both; 20 s of flight at most 129 and 179; the Comet's `hit` 82.5 ms |
| budget-return-c2a | 0 | the same tool fails c2a00c4's build, as it must: downtown 385 draws at 0 s, the Marina 302. Its lens check read 0 frames there too |
| det-skyoff | 0 | "det-cmp: 8 of 8 views pass" (the first visit, sky off, as the base's) |
| opening-same | 0 | the base against itself differed at 0.5, 1, 2 and 30 s; every leg equal at every still to one of the base's runs, the fog's included; the trace equal to the last bit for 30 s |
| opening-same-bites | 0 | with `&nohud` on the new run, (i) "differ at 0.5, 1, 2, 4.2, 8, 30 s", as it must |
| returnvisit | 0 | "returnvisit: all passed" (P at 35.7 % of the frame's height after the fog) |
| return-high | 0 | "P projects at 25-65 % of the frame's height (53.7 %)" |
| warm-return | 0 | "warmcheck: passed": no program after the warm-up on a return start |
| flight5-m90 | 0 | three of each M90 case: the lane's flicks "landed in the lane (Input.inLookZone false)", the look's at (40, 560) "in the look zone (true)", each a gear and a plain splat |
| og-shot | 0 | "best: 6 (Coit Tower from North Beach), 10 of 10 checks, the bus 47 px at 150 and 145 apart"; 4 (Alamo Square) 9 of 10, the Transamerica Pyramid 24 rows of the 40; 5 (the Golden Gate) 8 of 10, its towers 21 and 12 rows, the bloom 19.3 % of the city |
| og-shot-nopaint | 0 | candidate 6 with no paint: "the bloom in 0.4 % of the city's pixels (20-45 %)", exit 1 as it must |
| og-shot-nomark | 0 | candidate 6 with Coit Tower hidden: "Coit Tower 0 rows differ from the frame without it (40)", exit 1 as it must |
| ogtags | 0 | "all 12 tags, each once", "og-6.png in the build, 1200 x 630, 52 KB" |

Probes this round, outside the repo, each a row of the same runner: the Waterfall's first touch recorded on the round's first build (30 runs, two with two pools, both with the first touch's run going as the window opened); opening-same against c2a00c4's build (exit 3: the base's own 30 s flicker) and against the build without the first-draw cap (exit 0); the oscillators made per frame round four Comets on the round's first build and on the head's (18-20 in the impact frame, then 15-16); the look's downtown return session flown again on the head.

## What ran at c2a00c4, the first round's last build

Every row ran through the studio's gate runner (each browser row and build waits for the one GPU lock); a row's exit decides. This table is the first round's, kept as it was; the head's is above. These ran on c2a00c4's build (its main chunk `main-CxCr-598.js`; a rebuild of the last code commit, 9fa289a, gives the same name, so the two comments reworded in a0c5cd5 after the rows changed nothing built), unless the row says otherwise:

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

- **The whole table on the head's build.** The rows above ran on it; these ran on this round's first build (main-BqeLn1fl.js, the same game but for the four game changes above) or on c2a00c4's, and not again: controls-bomb (0), flight5 whole (0; its M90 cases ran again alone), warm-plain (0), returnvisit-on-R, loadpage, loadpage-on-R, controls-firstrun and -hose, controls-lob, controls-lob-noon, hint, misfire, misfire-30, misfire-60, budget, budget-bomb, det-golden, warm-comet, warm-crew-lob, warm-crew-bomb, warm-extras, warm-curb, warm-hose, controls-curb, s-boom, s-falls, s-shots-known. In c2a00c4's first whole table 47 of 49 rows exited 0 (flight5 and controls-boom the two: flight5's M90 case was a game fault, fixed in round 3; controls-boom still reads 201 at its pose in some runs, above). The table runs again before the push.
- **The phone.** Sound, the art, how the return start and the skip's jump feel, the A15 (the measuring pass), Safari 15 on a device (only the parse is checked), and the link picture in Messages (preview links sit behind a sign-in, so that waits until live).
- **The black canvas.** Chrome shows the page's colour under an undrawn canvas, so no row can prove the hidden canvas fixes it; only Safari can. It is hidden either way.
- **A return start's pixels against c2a00c4's.** Two runs of one build differ by 0.4-0.6 M pixels there (the start's pose comes from a real tap at wall time), so they can't be compared; the first visit's can, and are equal.
- **The lens check's bite.** `returnvisit --budget`'s "the lens never under the roofs" read 0 frames on c2a00c4's build too: its two starts aren't the downtown start the outside look saw. The look's own session was flown again on the head and its frames looked at: the lens at the chase under the fog, nothing near it, but its record (from real taps) is not the look's, so not the same pose.
- **A boot that throws.** The loader's removal on an error was read, not run.

## The producer's calls, with the studio's pick

The first three block going live.

- **Call 4, the Hose.** Off by default, `?hose` to try it (built, the studio's pick), or on with the resting thumb fixed (design (b), above, 1.25 agent-days more). Hose off also turns off hold to aim. Without the Hose it does nothing.
- **m92, the Lob's one-time hint (TAP TO LOB IT / INTO THE RING).** Keep (the studio's pick) or drop. It is a fourth one-time hint beyond the three the shots approved. Drop is a tenth of a day: its toast out of `Coach.ts` and `Controls.ts`, the ring and its pillar kept.
- **Call 5.** Stage 1 goes live, MEGA off, before the first test round. The producer merges, or names who does.
- **Call 6.** The iPhone 13 for the measuring pass.
- **The cost.** ESTIMATE 7.5 agent-days with the Hose off, past CORE's 4 to 6, after the review added the return start's hold, the skip's jump, the save check and checks that can fail. Nothing was cut to fit.
- **The link picture: one of three.** Each is the bus near and side on, about a third of the picture's width, over a grey city with one bloom of paint, at golden hour. In plain words:
  6. *Coit Tower from North Beach.* Painted roofs round the bus, the grey city behind, Coit Tower on its hill and downtown's towers at the right. Every check passes. It is in the build now.
  5. *The Golden Gate from the Marina.* The most San Francisco of the three, and the greyest city round the paint, but the bridge's towers show over 12-21 rows of the 630 (2-3 px at chat size) where its check asks 40: its landmark check fails, and its bloom is 19 % of the city, under the 20 asked.
  4. *Downtown from Alamo Square's row.* The look's pick of the old three, made again as it asked: the bus bigger, the dark park gone. The most paint (44 % of the city), and the Transamerica Pyramid barely shows behind the towers.
  At 150 px wide the bus reads as a yellow school bus in all three (47-49 px wide). None says San Francisco to someone who doesn't know the city. **Studio's pick: 6, the one in the build.** Look at it in a real chat once it's live.
- **The return start says nothing about "this is yours".** The outside look: the paint reads, "where I left off" does not. No new button or text is needed for one beat: the building the record names could glint once as the fog clears, as the aim's target does. **Studio's pick: that glint, about 0.25 agent-day (ESTIMATE), in the next stage**; or nothing until stage 2's goal gives the return a reason.
- **The return start's fog.** The look saw no fog in the frames taken under it: on a return start the fog bank is too thin to see, so the tiles landing round the bus can show. **Studio's pick: leave it for stage 1**, and look on the phone.
- **The loading page.** The words STRUGGLE BUS and the little bus, which bobs; the rainbow under it is its trail, not a progress bar. The look: crisp at every size, but the flat grey reads as a placeholder on a wide screen. A first-time player's page stays as it is unless you say so. **Studio's pick: keep it for stage 1**, and a sky gradient behind it later (a small change).
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
- Messaging apps' limits on the picture's size (og-6.png is 52 KB; 300 KB is the target).
- The salmon disc under the bus in the return's frames is the bus's exhaust puffs, lit by the low sun, as on the base (round 3): meant, not unknown.
- The laptop's Comet impact frame: `hit` 75.9 and 74.1 ms at c2a00c4, 81-83 ms in round 3's runs on a shared laptop (the arpeggio's nodes spread out of it, the hook's median 17 -> 10 ms). A laptop's integrated GPU says little about an A15, but it is over 33 ms, and the measuring pass's step 4 is where it is decided.
- controls-boom reads 182-201 draws at 07:15 PST over western-addition-150's 12 runs, the bound itself: no margin on the laptop at a low sun. The worst frame's split (round 3) puts 69-86 of them in the sun pass and 0-6 in first draws; 2 of 12 runs read 201, so the row is red at the head. The sun pass at a low sun is src/render's.
- What the outside look took for a rainbow trail running ahead of the bus downtown, standing up as a pillar over the bay, is most likely a long pier the setup's shots painted, seen end on (read from the frames, not checked by a run). The Marina roof that turns flat lilac in one frame is most likely the aim's glint on the building ahead (the base's). Neither changed.

## The start block, and the other branches' boots

The return start's block sits right after `?heading` in `main.ts`'s boot. rc/1 and feat/handling put their `?recess` and `?swerve` boots at the same spot, and Recess sets `lat` and `skipintro` only after it, so their merge will conflict there. Until the second account says otherwise, the return reads the link flags `recess` and `swerve` itself and makes no start and writes no record under them. When those branches merge, put their boots before the return block, or name the one flag that means "not the saved city", and the return reads that instead.

When life's lock-on or Recess come to main, `input.aimOn` (the Hose's flag now) becomes `!moon && (hoseOn || lifeOn || recessOn)`: their holds need the aim.
