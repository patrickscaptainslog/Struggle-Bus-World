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
(up to ~520 m), push up = dive / surge, release = hold altitude. 3D pixel art in
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
`?px=240|295|390|590` (frame width in game pixels; default 390), `?tune` (tuner).
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
`python tools/bake/bake.py sf && python tools/bake/pack.py sf`. LiDAR (`tools/bake/lidar.py`) downloads itself (~1.4 GB, cached under
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
| `feat/controls` | main merged in, review fixed, QA'd on the GPU (MAIN vs NEXT), ready to merge (desktop session, 2026-10-30); never run on a real phone | tilt-to-fly default on phones (`Tilt.ts`, fused attitude, recenter), touch fallback, keyboard + Esc, hold-to-charge + turbo in `Input.ts` (the INPUT CONTRACT), turbo gears G0-G3 (G2/G3 locked behind `config.turbo.worldTravel`), turbo FX + audio, `src/ui/Hud.ts`, `tools/controls.mjs`, `tools/jet.mjs` (frame pacing, attributed), `tools/boom.mjs` (hero frames) | merge before supersplat (its DECISIONS "Controls QA" and "outside judge, round 1" have the numbers); first real-phone pass on the HTTPS preview |
| `feat/supersplat` | main merged in (controls, look, landmarks, facade), pre-review fixed, QA'd on the GPU (MAIN vs NEXT), ready to merge (desktop session, 2026-10-30); never run on a real phone | hold-to-charge (10 s) on controls' gesture, mega blast on early release, firehose (~4 s), 60 s cooldown, `SuperSplat.ts`/`SuperFx.ts`/`SuperMeter.ts`/`superSfx.ts`, the summoning circle (`PixelPipeline.setHeroCircle`), `Blast.super` for the stage engine, the warm-up kit (`render/warmup.ts`, from perf/load), `tools/supersplat.mjs` | merge next (the outside judge's round 1 is fixed: first pour max 17.5 ms; a re-judge is pending), then perf/load (see "Merging perf/load" below); its DECISIONS "Super splat, outside judge round 1" has the numbers; first real-phone pass: the pour from 250 m on an A15, the meter clear of the home indicator |
| `feat/hybrid` | built from `docs/specs/hybrid-controls.md`, QA'd on the GPU (MAIN vs NEXT), review's four defects fixed (2026-10-30); never run on a real phone | the producer's hybrid: TURBO, the tilt toggle, MEGA, thumb + tilt arbitration (`Hybrid.ts`), `hudLayout.ts`, the first run (`Coach.ts`), no card, `tools/controls-sim/s_hybrid.ts`, `s_layout.ts` | the real-iPhone list at the end of its DECISIONS "Hybrid controls" (back swipe first); the producer's call: `config.tilt.defaultOn` |
| `merge/perf` | polish/perf, perf/load and the optimization deep dive in one merge, QA'd on the GPU (MAIN vs NEXT), merge review's five findings fixed, not yet judged (desktop session, 2026-10-30); never run on a real phone | one RGBA16UI G-buffer, the typed mesher, sun-pass casters, depth-only sun pass, first draws on a byte budget, unseen swaps that only commit, the warm-up from the top of main.ts, primed streaming, the opening on the wall clock and a tap to skip it, a first touch with no stall, context loss | merge next (its DECISIONS "iPhone performance" has the numbers, MAIN bd660ba vs NEXT, and what was dropped); first real-phone pass below |
| `feat/stages` | empty (just created from main) | — | build the stage engine per `docs/specs/STAGES.md` (its "Producer decisions" section) |
| `merge/osm` | feat/osm (local c17bc4a; `origin/feat/osm` is 13 commits behind it, never use it) + main f64a142, QA'd on the GPU (MAIN vs NEXT), merge review's four findings fixed, the outside judge's round 1 answered (2026-10-31; a re-judge is pending); never run on a real phone or a live Vercel deploy | the OpenStreetMap city in main's game: real footprints, mapped roofs (`roofGeom.ts`), streets and names on the signs, ground classes, evidence trees, the 'osm' id scheme, ODbL credit + MAP DATA, London and Amsterdam, LOD 1 rings, `tools/sweep.mjs`, `framecost.mjs`, `osm-paint.mjs`, `osm-play.mjs` | merge next (its DECISIONS "OpenStreetMap in main's game" has the numbers, the merge review's at its end; "OpenStreetMap, outside judge round 1" what the judge found: the "fin" is Market Street, `tools/sightline.mjs` shows it to anyone); the producer's call on the hillside views over budget; the distant-city study builds on it |

`feat/controls` and `feat/supersplat` share an INPUT CONTRACT (`onTap`,
`onChargeStart`, `onChargeEnd(heldSeconds, cancelled)`, `state.chargeHeld`,
`onTurbo(dir)`, `state.turboHeld`, `input.mode`): see their DECISIONS/ARCHITECTURE
notes when merging.

### Suggested order
1. Merge facade -> landmarks (+ wire the 3 new props) -> look -> controls -> supersplat -> perf,
   with a quick GPU screenshot check after each (`node tools/shots.mjs`), publishing a
   Vercel deploy as you go. (All in main but `merge/perf`, the last of them.)
2. Merge `merge/osm` (the OpenStreetMap city); the distant-city study (far.bin, horizon.bin, the far field) builds on it.
3. Build the stage engine (`feat/stages`), then MAGIC-SPEC's effects in its three
   workstreams (WS-1 light + music, WS-2 ribbons/pillars/birds/fireworks/waterfalls, WS-3
   growth kit + director + Wonders), Super Rainbow's five stages first.
4. World travel (`docs/specs/WORLD-TRAVEL.md`).

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

## Rules that keep it beautiful and fast
- Materials write a palette ramp + light + fog + glow through `sbWrite`; never free RGB
  in the 3D scene; no brown, ever. Camera and shadow map stay snapped (no shimmer).
- Budget: iPhone A15 >= 30 fps, recent iPhones 60. Today ~120-200 draws, ~1.0-1.5M
  triangles; no per-building draw calls; one texture upload per texture per frame; no
  allocations in hot paths. Report before/after numbers for anything that renders.
- Frames don't change without saying so: `node tools/shots.mjs <url> <dir> --det` on two builds and
  `python -I tools/shotdiff.py <dirA> <dirB>` is frame-exact from run to run (0 pixels, MAIN vs MAIN).
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
2. Hybrid tilt + thumb (feat/hybrid, the producer's revision of tilt by default). Tilt needs a real
   HTTPS deploy (Vercel from this repo); the claude.ai preview blocks motion sensors.
3. Hold-to-charge super splat (feat/supersplat).
4. Turbo modes and manual world travel: fly SF -> Tokyo across the Pacific with turbo gears
   (~5 min at G3 ~30 km/s); needs a world mode between cities (ocean, coastlines, curvature,
   day/night), Tokyo from OSM/Overture, floating origin. A design pass is producing
   `WORLD-TRAVEL.md`. Then: every city, many players (static tiles on a CDN, shared paint
   via per-region Durable Objects, OSM/GERS ids).
5. Use OpenStreetMap as much as possible for quality (done on `merge/osm`; ODbL: attribution in game +
   DATA_LICENSE.md for the tiles).
6. It felt laggy and low-res: we raised the frame to 390 px and tightened springs; the perf
   pass is `merge/perf`. Measure real fps on the producer's iPhone.

## Known issues worth knowing
- A 3x `page.screenshot` costs a frame or more on any build: don't trace frame times beside one.
- Capture tools pass `&nohud`: `tools/controls.mjs ... firstrun` and `opening` are the first-visit runs (the cues, the chip,
  TURBO armed under the deck, the sheet, sensors that never answer). `?fixeddt` makes game time run ~3x real time: a "hold"
  in `run:` game seconds is a shorter real press, and a real press past 450 ms is what makes a thumb.
- A one-handed reach to TURBO swings the bus until the finger lands, and with a settle it recovers less of a carve than no guard
  would (37 vs 47 degrees, ideal 67): it stops the wrong-way turn. Only a phone can say if that trade is right.
- A phone relaxed more than ~2 s after a moved lift gets a counter-carve until RECENTER or a thumb hold (spec section 12).
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
- The far skyline beyond the streaming radius is flat boxes; with fog off it shows. (The far field is a separate study's:
  polish/perf's far chunks stayed out of the merge.)
- Saved paint keys, on OpenStreetMap data (`city.json` `"ids": "osm"`): `strugglebus.paint.v3` (buildings), `strugglebus.ground.v4:<tx>,<tz>`
  (ground), other cities `paint.v3:<slug>` and `ground.v4.<slug>:`; `strugglebus.landmarks.v1` (landmark props, by name: `lm:sutro`,
  `lm:transamerica`, `lm:coit`, `lm:ferry`; independent of any bake) stays as it is. v2 of the buildings and v3 of the ground are skipped
  on purpose: a build before `"ids"` wrote them whatever the data was. An OSM load drops that city's `paint.v1` / `v2` and `ground.v2` / `v3`
  (never applied; a landmark's name key moves to its own store).
- Three wrong heights in SF's final data are patched in the client, not fixed (`towerStyles.ts`, SF only): the bridges' OSM / LiDAR stand-ins and
  the Alamo Square hut are `HIDDEN`, Fort Point loses its upper tiers (`BRIDGE_TIERS`). The next SF bake should fix them at the source: no
  LiDAR rooftops under a bridge, none from a tree crown on a small footprint. See DECISIONS "OpenStreetMap in main's game".
