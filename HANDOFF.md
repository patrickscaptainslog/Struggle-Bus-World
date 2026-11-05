# Struggle Bus — handoff (read this first)

You are picking up a game in progress. A cloud Claude Code session built everything
so far and is still finishing a few in-flight branches (see "Who owns what"). This
file is the state of the world on 2026-10-23 and the backlog the producer asked for.

Read next, in order: `README.md` (play + develop), `docs/ARCHITECTURE.md` (how it
works, file ownership), `DECISIONS.md` (every call we made, with numbers),
`docs/specs/COMMON.md` (the creative brief). Do not skim the rendering rules.

## The game in one paragraph
A wheezing yellow school bus flies over real San Francisco (OpenStreetMap footprints,
roofs, streets and names, USGS LiDAR heights) and blasts rainbow "dragon breath". A tap fires a
projectile at the glinting building ahead; the blast blooms every building within
~60 m in a radial wave, paints streets/parks/trees, and repeat hits escalate L1 bloom
-> L2 rooftop gardens -> L3 Hundertwasser. Thumb/keyboard "yoke": pull down = climb
(up to 15 km, over the airliners: `docs/specs/flight/ASCENT.md`), push up = dive / surge, release = hold altitude. 3D pixel art in
three.js: an indexed-colour G-buffer, palette ramps only, camera snapped to the pixel
grid. Phones first (iPhone Safari portrait). Fog is OFF by default for now (`?fog`).

## Run it on this machine (Windows)
```
npm install
npm run dev            # http://localhost:5173   (add ?fps to see the frame rate)
npx tsc -p tsconfig.main.json --noEmit   # typecheck incl. src/main.ts
npx vite build         # dist/
```
URL params: `?lat=&lon=&heading=&skipintro`, `?openingshot`, `?fps`, `?fog`,
`?px=240|295|390|590` (frame width in game pixels; default 390), `?tune` (tuner), `?hour=blue` (the held blue hour, ARCHITECTURE "The held hour"; with `&fps` the phone's read-out).
QA hooks: `window.__game` (flight, city, splatter, input, audio, rig, camera, perf,
`tapSplat()`, `forceReady()`, `clock()`, `barfAtLatLon(lat, lon)`), `window.__qa`.

### QA tools use your GPU here
All capture tools (`tools/shots.mjs`, `shot.mjs`, `blast.mjs`, `altitude.mjs`,
`lidar-shots.mjs`, `perf-view.mjs`, `feel.mjs`, `audio-check.mjs`) launch the browser
through `tools/browser.mjs`: off the cloud machine they use the installed Chrome (Edge
on Windows) with hardware GL. Overrides: `SB_CHANNEL=chrome|msedge`,
`CHROME_PATH=<exe>`, `SB_GPU=0|1`, `SB_HEADED=1` (visible window, if headless GPU
rendering misbehaves). Build to a folder, serve it statically, point a tool at it:
```
npx vite build --outDir ../sb-build && npx http-server ../sb-build -p 4173   # or python -m http.server
node tools/shots.mjs http://127.0.0.1:4173/ shots/local/regress   # grey / painted / opening
```
Many tools still wait on the game clock (`__game.clock()`), which is right on any
machine. In the cloud SwiftShader ran ~1.5 fps; here it should be 20-60.

### City data pipeline (only if you rebuild the city)
Python 3.12 (`C:/Users/Utku/sb-venv` here): `pip install geopandas pyogrio pyarrow rasterio pyproj scipy shapely laspy[lazrs] matplotlib`.
`python tools/bake/overture.py sf` (OpenStreetMap through Overture, ESA WorldCover), `python tools/bake/fetch_inputs.py sf`
(the USGS 1 m DEM tiles, into `tools/bake/.data/`; the SF slice of USA Structures is committed in `tools/bake/data/`), then
`python tools/bake/bake.py sf && python tools/bake/pack.py sf`, and `python -I tools/bake/lamps.py sf` for the street lamps. LiDAR (`tools/bake/lidar.py`) downloads itself (~1.4 GB, cached under
`tools/bake/.cache/lidar`). The caches are gitignored and live in `C:/Users/Utku/Struggle-Bus-World/tools/bake/`: a worktree
points `SB_OVERTURE_CACHE`, `SB_WORLDCOVER_CACHE`, `SB_LIDAR_CACHE` and `SB_DATA` at them. A full SF bake thrashes this 8 GB
laptop. Never change stable building ids casually: saved paint is keyed by them (OSM ids: ARCHITECTURE "stableIds").
Bump `window.__sbDataV` in `index.html` with every re-bake: phones hold `/city/` files by URL (ARCHITECTURE "Re-baking a city", `tools/redeploy.mjs`).

## Branches (GitHub: patrickscaptainslog/Struggle-Bus-World) — state when the cloud session stopped (2026-10-23 20:40 UTC)
The cloud session has STOPPED all its work. Every branch below is pushed; unfinished
work is in a final "WIP: paused ..." commit. **This desktop session now owns everything,
including merging into `main`.** None of the branches below has been merged yet.

| Branch | State | What's in it | Next step |
|---|---|---|---|
| `main` | preview v6 | blast, altitude/yoke, LiDAR towers, feel polish, 390 px frame, fog off, snappier springs, design docs | the base for everything |
| `feat/facade` | built, NOT reviewed (12 commits) | facade families + style table + icon overrides (`src/world/towerStyles.ts`), bases/crowns, facade LOD by size on screen, painted towers (L2 hanging gardens, L3 bands), Coit Tower, Ferry Building, 181 Fremont spire (`props/landmarks.ts`), `tools/facade-shots.mjs` | review it (shots), fix, merge FIRST |
| `fix/landmarks` | main merged in, review fixed, ready to merge (desktop session, 2026-10-23) | `City.addLandmarkBuilding`, paint reserve + its own name-keyed store, landmark paint (flood/L1-L3), glint, Transamerica + Sutro + Coit Tower + the Ferry Building paintable, 181 Fremont's spire paints with its tower | merge into main (its DECISIONS "Merged with main" has the numbers) |
| `polish/look` | main merged in (facade + landmarks), review re-checked on the GPU and fixed; merge review's two findings fixed (a sign half hidden behind a far landmark, no drop shadow over the bay), ready to merge (desktop session, 2026-10-24) | sky band, sign beside the blast, hero ink edge + headlight, drop shadow, puffs, GGB International Orange (`BRIDGE_ORANGE` row 23; `RAMP_COUNT` 48), water, tree crowns, one sky function shared with the facades, `tools/look.mjs` + `lookstat.py` | merge into main (its DECISIONS "Look polish" has the 390 px numbers, MAIN vs the merge) |
| `feat/controls` | main merged in, review fixed, QA'd on the GPU (MAIN vs NEXT), ready to merge (desktop session, 2026-10-30); never run on a real phone | tilt-to-fly default on phones (`Tilt.ts`, fused attitude, recenter), touch fallback, keyboard + Esc, hold-to-charge + turbo in `Input.ts` (the INPUT CONTRACT), turbo gears (G0-G3 then; Express on `feat/thumbs` makes them G0-G4, the top two locked behind `config.turbo.worldTravel`), turbo FX + audio, `src/ui/Hud.ts`, `tools/controls.mjs`, `tools/jet.mjs` (frame pacing, attributed), `tools/boom.mjs` (hero frames) | merge before supersplat (its DECISIONS "Controls QA" and "outside judge, round 1" have the numbers); first real-phone pass on the HTTPS preview |
| `feat/supersplat` | main merged in (controls, look, landmarks, facade), pre-review fixed, QA'd on the GPU (MAIN vs NEXT), ready to merge (desktop session, 2026-10-30); never run on a real phone | hold-to-charge (10 s) on controls' gesture, mega blast on early release, firehose (~4 s), 60 s cooldown, `SuperSplat.ts`/`SuperFx.ts`/`SuperMeter.ts`/`superSfx.ts`, the summoning circle (`PixelPipeline.setHeroCircle`), `Blast.super` for the stage engine, the warm-up kit (`render/warmup.ts`, from perf/load), `tools/supersplat.mjs` | merge next (the outside judge's round 1 is fixed: first pour max 17.5 ms; a re-judge is pending), then perf/load (see "Merging perf/load" below); its DECISIONS "Super splat, outside judge round 1" has the numbers; first real-phone pass: the pour from 250 m on an A15, the meter clear of the home indicator |
| `feat/hybrid` | built from `docs/specs/hybrid-controls.md`, QA'd on the GPU (MAIN vs NEXT), review's four defects fixed (2026-10-30); never run on a real phone | the producer's hybrid: TURBO, the tilt toggle, MEGA, thumb + tilt arbitration (`Hybrid.ts`), `hudLayout.ts`, the first run (`Coach.ts`), no card, `tools/controls-sim/s_hybrid.ts`, `s_layout.ts` | the real-iPhone list at the end of its DECISIONS "Hybrid controls" (back swipe first); the producer's call: `config.tilt.defaultOn` |
| `merge/perf` | polish/perf, perf/load and the optimization deep dive in one merge, QA'd on the GPU (MAIN vs NEXT), merge review's five findings fixed, not yet judged (desktop session, 2026-10-30); never run on a real phone | one RGBA16UI G-buffer, the typed mesher, sun-pass casters, depth-only sun pass, first draws on a byte budget, unseen swaps that only commit, the warm-up from the top of main.ts, primed streaming, the opening on the wall clock and a tap to skip it, a first touch with no stall, context loss | merge next (its DECISIONS "iPhone performance" has the numbers, MAIN bd660ba vs NEXT, and what was dropped); first real-phone pass below |
| `feat/stages` | empty (just created from main) | — | build the stage engine per `docs/specs/STAGES.md` (its "Producer decisions" section) |
| `merge/osm` | feat/osm (local c17bc4a; `origin/feat/osm` is 13 commits behind it, never use it) + main f64a142, QA'd on the GPU (MAIN vs NEXT), merge review's four findings fixed, the outside judge's round 1 answered, the last review's findings fixed, merged into main 2026-10-31 (one judge round by the producer's rule); never run on a real phone | the OpenStreetMap city in main's game: real footprints, mapped roofs (`roofGeom.ts`), streets and names on the signs, ground classes, evidence trees, the 'osm' id scheme, ODbL credit + MAP DATA, London and Amsterdam, LOD 1 rings, `tools/sweep.mjs`, `framecost.mjs`, `osm-paint.mjs`, `osm-play.mjs` | done (its DECISIONS "OpenStreetMap in main's game" has the numbers, the merge review's at its end; "OpenStreetMap, outside judge round 1" what the judge found: the "fin" is Market Street, `tools/sightline.mjs` shows it to anyone); the producer's call on the hillside views over budget; the distant-city study builds on it |
| `fix/bridge-data` | built from `docs/specs/bridges/BRIDGES.md` steps 1 and 2 (desktop session, 2026-11-01), QA'd on the GPU (MAIN vs NEXT), two reviews' findings fixed, the outside judge's round answered, `osm2`; never run on a real phone | the Golden Gate and the Bay Bridge on OSM's rows, one deck list for mesh, heights and collision, `relandmark.py`, `tools/spanfly.mjs`, the opening at heading 100, flight under a deck | the phone link, the producer's look at the first shot and the turn-out under a deck, then merge; "Bridges: what's left" below |

| `feat/nose` | merged into main 2026-11-01 after the producer flew it on an iPhone 17 Pro ("INCREDIBLE"), no fps taken | the path: with a gear or the boost on the pull, and on any dive, the speed goes where the nose points, 85 degrees up and down; the bus shows it, the view tips over a dive (`docs/specs/flight/NOSE.md`, `tools/nose.mjs`, `tools/feel-sim/s_nose.ts`) | nothing; `?tune` still has noseRate, noseDown and the view's dive |
| `feat/thumbs` | built from `feat/nose` 08dd842, main 034672f merged in, QA'd offline and in the real page with real CDP multi-touch; reviewed, its blocker and majors fixed; flown by the producer on an iPhone 17 Pro ("New thumb controls work great! Very intuitive"), no fps taken. Express and turbo's new numbers came after that flight, and one thumb's flicks after those: QA'd the same way, reviewed with the merge of main, one major and two minors fixed, not on a phone (DECISIONS "Express", "One thumb", "One thumb: its review"). The left side's look came after the next flight, QA'd offline and in the real page, not on a phone (DECISIONS "The left side looks"). One flick a rung, Nonstop and the look's curve came after the one after that, QA'd the same way, not on a phone (DECISIONS "One flick, one rung"). Both reviewed together: no blocker, no major, two minors fixed (DECISIONS "One flick, one rung: its review"); not merged | the thumbs in `Input.ts`: a touch landing in the left 42 % of the width (`lookZone`, SWAP mirrors it) never flies; anywhere else the first flies; a thumb in the zone, alone or not, or any landing while one flies, looks, flicks and taps on its lift; two thumbs in any order, the one in the zone looks; a lone fresh stroke out of the zone flicks on the firm rule; `Shifter.ts`, what a flick means: one flick is one rung, at once, up or down, no double; the ladder is Cruise, Express, Nonstop, Jet, named in code and config, Stratos and Rainbow Warp behind `worldTravel`, and turbo's three levels latched over the top gear in reach (`config.turbo.levels`, `TurboDrive.rung`); a gear still lifting taken back; the look, an orbit laid over the finished pose in `CameraRig`, on a curve (`lookDegPerPx`, `lookFullPx`); the aim turning with it; the flick's pop; the first run's hint; TURBO, its tab and all of tilt gone (`docs/specs/flight/THUMBS.md`, `tools/controls.mjs`, `tools/controls-sim/s_gesture.ts`, `tools/feel-sim/s_look.ts`) | the phone with `?tune`, and a value saved on that phone's tuner beats a new default, so reset `lookDegPerPx` and `lookFollowHz` if they were ever moved: past the bridge (the opening's low shot has no look, so a left drag answers from about 17 s in), the left side alone and beside a flying thumb, in either order, and where the line belongs (`lookZone`); the look's new curve and `lookFollowHz` at 3; then the ladder rung by rung on each side, whether Nonstop's lift reads, and whether a run of flicks on the flying side drops some, now each is on the firm rule; a busy flight against the study's bar, under 1 false launch per 10 minutes and 80 % of flicks caught (`loneFlickPx` first; THUMBS, "One thumb"), and how often a quick glance on the left is a gear; how it sounds; the look's gearing and springs; whether the first run's hint should wait for the bridge (THUMBS, "Left on purpose"); then merge |
| `spike/farfield` | SPIKE days 1 and 2 with `main` 3297ab2 merged in; the look passed on the producer's phone, on by default, kill switches in (desktop session, 2026-11-01), QA'd on the GPU, reviewed with no findings, build main-jF7hrKss.js; not merged, and this build never ran on a real phone | the far raster (`far16.bin`), its boxes, the fade to 34 km, far16.bin no longer holding the first frame | the producer reads the report, merges and pushes |
| `feat/sky` | SKY.md slice S1 on `main` 4e24e3f (desktop session, 2026-11-01), all behind `?hour=blue`: flag off is 4e24e3f's frames, QA'd on the GPU, reviewed and the review's four findings fixed, the last pass on build main-bPdy7owl.js (DECISIONS "The held hour: the last pass"), merged into main 2026-11-01, still behind the flag, after the producer flew it on an iPhone 17 Pro ("simply AMAZING"), no fps taken | the whole game under one held blue hour: the blue table, 64 rows, the sky's bands, graded paint, the long headlight, lit windows by distance, `lamps.bin` and the lamps, their pools, the spans' lights, the far city's night path, the `?fps` read-out, `tools/skycheck.mjs`, `tools/bake/lamps.py` | the merge changed no pixel with the flag off, and `skycheck` still fails only FiDi's shimmer, which the producer has seen. Above 520 m the hour flies with no errors but isn't finished: below the true horizon the sky is flat colour with vertical wedges, solid orange on the sun side at 12-15 km (`skyBands` in `src/render/skyResolve.ts` has no height term), and low land past the map is a flat pale sheet. Those belong to S2 and far-field day 3. An A15's fps and compile time are still unknown |

`feat/controls` and `feat/supersplat` share an INPUT CONTRACT (`onTap`,
`onChargeStart`, `onChargeEnd(heldSeconds, cancelled)`, `state.chargeHeld`,
`onTurbo(dir)`, `state.turboHeld`, `input.mode`): see their DECISIONS/ARCHITECTURE
notes when merging. (`feat/thumbs` changes it: `onTurbo(dir, flew)` is a flick, `state.turboHeld` is gone with Shift's boost, and turbo is `TurboDrive.level`; ARCHITECTURE has the contract as it stands.)

### Suggested order
1. Merge facade -> landmarks (+ wire the 3 new props) -> look -> controls -> supersplat -> perf,
   with a quick GPU screenshot check after each (`node tools/shots.mjs`), publishing a
   Vercel deploy as you go. (All in main but `merge/perf`, the last of them.)
2. The distant-city proof (`docs/specs/far-field/SPIKE.md`, with its VERDICT.md and reports there): days 1 and 2 go live for SF with `spike/farfield`; days 3 to 5 (downloads, ridgelines, Ross, phones) are still to come. Then the live sky (`docs/specs/sky/SKY.md`).
3. Build the stage engine (`feat/stages`), then MAGIC-SPEC's effects in its three
   workstreams (WS-1 light + music, WS-2 ribbons/pillars/birds/fireworks/waterfalls, WS-3
   growth kit + director + Wonders), Super Rainbow's five stages first.
4. World travel (`docs/specs/WORLD-TRAVEL.md`).

### Bridges: what's left
`fix/bridge-data` is steps 1 and 2 of `docs/specs/bridges/BRIDGES.md`: both hand-built bridges on map data, `osm2`, built, reviewed and judged, never on a real phone. The producer's look at the new first shot and a thumb on the turn-out under a deck come first. Left, none of it started:
- **Step 3:** the bake gate in report mode (fifteen checks in `qa.py`), hero ids in `sf.json`, `tools/bake/tour.py` and `tools/tour.mjs`. No player change.
- **Step 4:** streets back: `overture.py` keeps `between`, one segment download per city, a re-bake of all three. Before release 2026-10-21.0 is deleted, about 2026-12-20.
- **Step 5:** decks for every city, the big one: `tools/bake/bridges.py`, `bridges.bin`, `bridgeMesher.ts`, `tools/bridgecheck.mjs`, posts from data, a re-bake of all three. The kits, the stand-ins and the bents' special case go, the east span appears, default piers fill the open stretches. Its flight list has the chase camera and the blocks under a deck. `far16.bin` is rebuilt after it.
- **Step 6:** heroes by OSM id, `HIDDEN`'s bridge rows, `BRIDGE_TIERS`, `FAR_STAND_INS`, `clearStandInGround` and `clearStandInCells` deleted, the gate turned to FAIL.
- Any change under `public/city/` after the `osm2` push, `relandmark.py` included, takes `osm3` in the same commit.

## Design docs (all in `docs/specs/`)
- `MAGIC-SPEC.md` — "wild paint": 14 effects, one visual language, escalation ladder, perf
  roll-up, build order, three workstreams with file ownership.
- `STAGES.md` — five stages per 128 m area per faction. **Producer decisions at the top
  override the rest:** +1 stage per separate blast (5 s climb cooldown), firehose +1 per area
  it lingers on; Wonders are tougher (stages 5 and 4 take two rival hits each, 7 to take a
  Wonder); Cloud Nine removed, **The Elderwood** (forest / elder / nymph sprites) added;
  Super Rainbow's Wonder is the **Wellspring** (220 m rainbow geyser), the Elderwood's is the
  **Elder Heartwood** (pending the producer's final OK on that swap).
- `WORLD-TRAVEL.md` — turbo SF -> Tokyo: floating origin + UTM frames, curvature in the vertex
  shader, analytic ocean in the resolve pass, city streaming, Tokyo from Overture, phased plan.
- `magic/concept-*.md` — the three art directors' raw concepts.
- `bridges/BRIDGES.md` — bridges in every city from data, six steps, with `audit-props.md` and `audit-new-city.md` beside it. Steps 1 and 2 are built.

## Rules that keep it beautiful and fast
- Materials write a palette ramp + light + fog + glow through `sbWrite`; never free RGB
  in the 3D scene; no brown, ever. Camera and shadow map stay snapped (no shimmer).
- Budget: iPhone A15 >= 30 fps, recent iPhones 60. Today ~120-200 draws, ~1.0-1.5M
  triangles; no per-building draw calls; one texture upload per texture per frame; no
  allocations in hot paths. Report before/after numbers for anything that renders.
- The sky's hard fails: `node tools/skycheck.mjs <url> <main's url> <dir>` (SKY.md section 8), on every slice.
- Frames don't change without saying so: `node tools/shots.mjs <url> <dir> --det` on two builds and
  `python -I tools/shotdiff.py <dirA> <dirB>` is frame-exact from run to run (0 pixels, MAIN vs MAIN), but for the views under "Known issues".
- Nothing compiles a shader in flight: a material or object kind made after boot registers a
  warm-up source (`registerWarm`, see ARCHITECTURE "Shader warm-up"); `node tools/warmcheck.mjs`
  must report 0 programs after the warm-up, and of first draws after it only the upscale onto the canvas.
- Every chunk parses on iOS 15.0, the first Safari with WebGL2: `build.target` is `safari15` and
  `node tools/iosfloor.mjs <build>` must pass. A script that doesn't parse shows nothing at all.
- Tunables live in `src/config.ts` (the in-game tuner reads them).
- Commit messages end with the session's attribution lines; never commit secrets.

## The producer's backlog (their words, in priority order as of today)
1. Painting must feel explosive and magical, not conservative: escalating stages per
   AREA (not just per building): each separate hit by your faction raises an area one
   stage, ~5 stages, culminating in "the most absolutely over the top extravagant display";
   every faction gets equivalent stages with its own theme (e.g. Team Super Rainbow).
   A design pass is producing `MAGIC-SPEC.md` (cloud scratchpad; will be committed to
   `docs/specs/`). Open questions to the producer: which factions at launch; does a
   firehose count as one hit or ~2.
2. Tilt is gone on `feat/thumbs`, the producer's call ("lets remove tilt steering completely - i dont like it"): two thumbs instead, `docs/specs/flight/THUMBS.md`.
3. Hold-to-charge super splat (feat/supersplat).
4. Turbo modes and manual world travel: fly SF -> Tokyo across the Pacific with turbo gears
   (~5 min in Rainbow Warp, ~30 km/s); needs a world mode between cities (ocean, coastlines, curvature,
   day/night), Tokyo from OSM/Overture, floating origin. A design pass is producing
   `WORLD-TRAVEL.md`. Then: every city, many players (static tiles on a CDN, shared paint
   via per-region Durable Objects, OSM/GERS ids).
5. Use OpenStreetMap as much as possible for quality (done on `merge/osm`; ODbL: attribution in game +
   DATA_LICENSE.md for the tiles).
6. It felt laggy and low-res: we raised the frame to 390 px and tightened springs; the perf
   pass is `merge/perf`. Measure real fps on the producer's iPhone.

## Known issues worth knowing
- `shots --det` isn't frame-exact on `sunset` and `downtown` any more, on main itself: two runs of main differ by 25,365 and 1,278 device px. A flag-off diff there reads as a difference; run those two views again before believing one.
- `tools/skycheck.mjs` holds one hard fail on `feat/sky`: shimmer at FiDi, 12.99 % against today's 12.27 %. The lights' own edges: DECISIONS "The held hour, its second part", and its review for the last 0.24. Its other poses and hard fails pass. Its today's URL has to be the main the branch was cut from: a main with another ceiling climbs to other frames and reads false fails, so on a branch give it the same build with the flag off.
- `shots --det` under `?hour=blue` is bimodal at Alamo too: one run in a few flew 0.014 m lower, a whole frame of sub-pixel. Flag on only, run it again before believing a diff.
- A 3x `page.screenshot` costs a frame or more on any build: don't trace frame times beside one.
- Capture tools pass `&nohud`: `tools/controls.mjs ... firstrun` and `opening` are the first-visit runs (the cues, a gear
  armed under the deck). `?fixeddt` makes game time run ~3x real time: a "hold" in `run:` game seconds is a shorter real
  press, and a real press past 450 ms is what makes a thumb.
- Over CDP a `touchEnd` lists the point that lifts, not the ones that stay; `tools/controls.mjs`'s `hand()` has it right.
- The look has met one thumb, the producer's, and no number came back: 1 degree per px, the springs and the flick rules are still guesses (`docs/specs/flight/THUMBS.md`). The flying thumb's flicks haven't met a thumb at all. A full look up by day is empty sky until SKY's S5.
- Never run on an iPhone, in the order that would hurt most: the RGBA16UI G-buffer (ES 3.0 color-renderable, Metal's
  RGBA16Uint too, but only a real A15 proves it; there is no two-target fallback, and a refusal now says so: one line on
  the fog-grey page, `boot().catch`), the first touch (the context in the gesture, sound ~100 ms later, a breath queued
  until then), a context lost in the background, iOS 15.0-16.3 (parses by `build.target` and `tools/iosfloor.mjs`, never
  yet by a real Safari: no WebKit on this machine; fflate through a dynamic import in a module worker).
- A first touch in a fresh desktop browser is bimodal, on any build: 13-670 ms in the gesture, all of it inside the browser's
  `new AudioContext` (later pages 16-28 ms). Holding the warm context open would need the iOS unlock reworked: see DECISIONS.
- Warm-up: ~4 s here before the first frame, the page fog-grey meanwhile; a phone slower than that sees grey longer. Nothing
  caps it (main's `render.warmWait` went with the merge: a frame before it finished would link in flight).
- Steady flight allocates ~3 MB/s (main 3.8; the deep dive hoped for 1-2): what is left is mostly three's render path.
- `Splatter` still allocates per hose impact (Scheduled objects, paint records: ~2,000 short-lived objects a second
  during the 4 s pour), the one known exception to the no-allocation rule: pool them if a phone shows GC hitches.
- `shots.mjs` stats sometimes come back null at 390 px (the perf snapshot timing); the
  screenshots are still valid.
- Over the triangle budget at altitude, mostly over hillsides: 9 of 352 `tools/sweep.mjs` views read over 1.5M, worst 1.70M (Bernal and Noe at 350 m; MAIN 2 of 352, worst 1.53M), and a pinned camera 1.73M at the Mission at 350 m, heading 225 (MAIN 1.60M, 1.93M before the merge review's first step). Samples: they move with what has streamed in. Draws: 4 of 352 over 200, 231 at most (MAIN 5, 234). 8 m wall columns and 1 m caster rings on houses took ~10 % off; what is left is the producer's call (DECISIONS "OpenStreetMap in main's game", merge review). GPU on the UHD 620: Excelsior ceiling 19.2-20.0 ms (main 16.0-16.6), Noe's 17.4 (16.5), so `tools/fps.mjs`'s 60 fps holds at its flat spots only. `tools/sweep.mjs`, `tools/framecost.mjs`.
- A camera on a straight street's axis lays the street on one screen line, the same line as the vertical of what stands at its foot: climbing off the Ferry Building, heading 235, Market Street reads like a light fin on the clock tower, on main too. Past the streaming radius its last ~50 game px are a pale hairline between far boxes (the far band's). `tools/sightline.mjs`.
- Street edges keep the 2 m class texture's stairs at a shallow angle to the grid (north of Market they run ~9 degrees off it): only water has the wider share (ARCHITECTURE "The shore is the class texture's"); a 2 m path wouldn't survive one.
- Between 100 m towers few taps raise a sign (FiDi 3 of 8: no pole clears them, and half a blade is no sign). A rooftop sign would be a new rule, the producer's.
- The Golden Gate and the Bay Bridge's west span stand on OSM's rows since `fix/bridge-data`, one deck list driving mesh, heights and collision, and the towers stand on the real piers (W2, W5, W6's pale shapes were never a data fault: the prop was off them). They are still SF's only two bridges, hand-built. What a player can still see on them: the Bay's west end runs into the hill with green corridor past it, because the real viaduct waits for decks; no road meets the Golden Gate's ends, the south one 2.7 m proud of the grass, because the bake drops that whole segment; the Bay's east span is absent; about 100 m of the Bay's land stretch and 90 m of the Golden Gate's south approach have no pier; the bus can't fly along either deck under the cables, it rides the cable line up (`docs/specs/bridges/BRIDGES.md`, "What shipped" and what follows it).
- Under a deck: the chase camera stands over it and the bus can be hidden, up to ~27 s along a 700 m span (an estimate from cruise speed); a stick held through the turn-out can carry the bus into a block, where nothing stops it; a bus leaving a deck inside a solid post's ring snaps to its top, 19 m in a frame at the North Anchor's block in real flight, more at a tower's ring; and the turn-out itself, a design choice, is unfelt. All on step 5's flight list.
- Far field (`spike/farfield`, "The far raster" in ARCHITECTURE): the East Bay and Marin past the raster's edge are the old horizon mesh, a flat green band until SPIKE's day 3. Largest pop, crawl at Sunset and Presidio, draws and triangles at Sunset are over SPIKE's targets, accepted on the producer's verdict (DECISIONS). The hillsides' worst views are over too and nobody has accepted those: Noe at 350 m, heading 135, 213 draws and 1.72 M triangles against main's 196 and 1.68 M. Three far boxes in tile (10, -6) stand a few metres over the Bay Bridge's lowered land stretch until BRIDGES step 5. `FIT_STREET` suits today's sun only. A `far16.bin` needs a rebuild after any re-bake (`tools/bake/farmap.py`).
- Saved paint keys, on OpenStreetMap data (`city.json` `"ids": "osm"`): `strugglebus.paint.v3` (buildings), `strugglebus.ground.v4:<tx>,<tz>`
  (ground), other cities `paint.v3:<slug>` and `ground.v4.<slug>:`; `strugglebus.landmarks.v1` (landmark props, by name: `lm:sutro`,
  `lm:transamerica`, `lm:coit`, `lm:ferry`; independent of any bake) stays as it is. v2 of the buildings and v3 of the ground are skipped
  on purpose: a build before `"ids"` wrote them whatever the data was. An OSM load drops that city's `paint.v1` / `v2` and `ground.v2` / `v3`
  (never applied; a landmark's name key moves to its own store).
- Three wrong heights in SF's final data are patched in the client, not fixed (`towerStyles.ts`, SF only): the bridges' OSM / LiDAR stand-ins and
  the Alamo Square hut are `HIDDEN`, Fort Point, a Rincon block, Pier 26 and the Torpedo Assembly Building lose their upper tiers (`BRIDGE_TIERS`). The next SF bake should fix them at the source: no
  LiDAR rooftops under a bridge, none from a tree crown on a small footprint. See DECISIONS "OpenStreetMap in main's game". Three far boxes in tile (10, -6) stand under the Bay's new deck top, not masked, because that tile also holds real boxes: step 5's.
