# Struggle Bus — handoff (read this first)

You are picking up a game in progress. A cloud Claude Code session built everything
so far and is still finishing a few in-flight branches (see "Who owns what"). This
file is the state of the world on 2026-10-23 and the backlog the producer asked for.

Read next, in order: `README.md` (play + develop), `docs/ARCHITECTURE.md` (how it
works, file ownership), `DECISIONS.md` (every call we made, with numbers),
`docs/specs/COMMON.md` (the creative brief). Do not skim the rendering rules.

## The game in one paragraph
A wheezing yellow school bus flies over real San Francisco (USGS LiDAR + FEMA/ORNL
footprints, OpenStreetMap coming) and blasts rainbow "dragon breath". A tap fires a
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
Python 3.12: `pip install geopandas pyogrio pyarrow rasterio pyproj scipy shapely laspy[lazrs]`.
Inputs: the SF slice of FEMA/ORNL USA Structures is committed in `tools/bake/data/`;
`python tools/bake/fetch_inputs.py sf` downloads the USGS 1 m DEM tiles into
`tools/bake/.data/` (bake.py's `data_path()` finds both; the configs keep the cloud's
absolute paths). LiDAR (`tools/bake/lidar.py`) downloads itself (~1.4 GB, cached under
`tools/bake/.cache/lidar`). Then `python tools/bake/bake.py sf && python tools/bake/pack.py sf`
(~15 min). Never change stable building ids casually: saved paint is keyed by them.

## Branches (GitHub: patrickscaptainslog/Struggle-Bus-World) — state when the cloud session stopped (2026-10-23 20:40 UTC)
The cloud session has STOPPED all its work. Every branch below is pushed; unfinished
work is in a final "WIP: paused ..." commit. **This desktop session now owns everything,
including merging into `main`.** None of the branches below has been merged yet.

| Branch | State | What's in it | Next step |
|---|---|---|---|
| `main` | preview v6 | blast, altitude/yoke, LiDAR towers, feel polish, 390 px frame, fog off, snappier springs, design docs | the base for everything |
| `feat/facade` | built, NOT reviewed (12 commits) | facade families + style table + icon overrides (`src/world/towerStyles.ts`), bases/crowns, facade LOD by size on screen, painted towers (L2 hanging gardens, L3 bands), Coit Tower, Ferry Building, 181 Fremont spire (`props/landmarks.ts`), `tools/facade-shots.mjs` | review it (shots), fix, merge FIRST |
| `fix/landmarks` | main merged in, review fixed, ready to merge (desktop session, 2026-10-23) | `City.addLandmarkBuilding`, paint reserve + its own name-keyed store, landmark paint (flood/L1-L3), glint, Transamerica + Sutro + Coit Tower + the Ferry Building paintable, 181 Fremont's spire paints with its tower | merge into main (its DECISIONS "Merged with main" has the numbers) |
| `polish/look` | reviewed (failed), fixes ~done (30 commits, main already merged in) | sky band, sign beside the blast, hero ink edge + headlight, drop shadow, puffs, GGB International Orange, water, tree crowns, `tools/look.mjs` + `lookstat.py` | re-check the review issues in `docs/reviews/polish-look-review.json` (tree-crown shimmer, sky/tree churn at 120 m, drop shadow on paint, L3 sign overlap, headlight vs bloom, fog fragments, top-edge stripe), then merge |
| `feat/controls` | built, NOT reviewed (15 commits) | tilt-to-fly default on phones (`Tilt.ts`, fused attitude, recenter), touch fallback, keyboard, hold-to-charge + turbo in `Input.ts` (the INPUT CONTRACT), turbo gears G0-G3 (G2/G3 locked behind `config.turbo.worldTravel`), turbo FX + audio, `src/ui/Hud.ts`, `tools/controls.mjs` | review, merge before supersplat |
| `feat/supersplat` | built, mid-QA (8 commits) | hold-to-charge (10 s), mega blast on early release, firehose (~4 s), 60 s cooldown, `SuperSplat.ts`/`SuperFx.ts`/`SuperMeter.ts`/`superSfx.ts`, `tools/supersplat.mjs` | finish QA, merge after controls: controls' gesture replaces supersplat's minimal hold; mount SuperMeter in `hud.slot('super')` |
| `polish/perf` | paused mid-task (12 commits) | sun-pass caster proxy, 8 m wall columns, hidden party walls, depth-only sun pass, culled far chunks, budgeted streaming, prewarm, `tools/perf-pass.mjs` | finish + measure, merge after the above |
| `feat/stages` | empty (just created from main) | — | build the stage engine per `docs/specs/STAGES.md` (its "Producer decisions" section) |
| `feat/osm` | paused mid-task (WIP) | Overture/OSM extract (`tools/bake/overture.py`, `osm.py`, `citydata.py`), conflation draft in `bake.py`, Amsterdam config, `src/ui/Credits.ts` | resume; needs the bake inputs (see "City data pipeline") |

`feat/controls` and `feat/supersplat` share an INPUT CONTRACT (`onTap`,
`onChargeStart`, `onChargeEnd(heldSeconds, cancelled)`, `state.chargeHeld`,
`onTurbo(dir)`, `state.turboHeld`, `input.mode`): see their DECISIONS/ARCHITECTURE
notes when merging.

### Suggested order
1. Merge facade -> landmarks (+ wire the 3 new props) -> look -> controls -> supersplat -> perf,
   with a quick GPU screenshot check after each (`node tools/shots.mjs`), publishing a
   Vercel deploy as you go.
2. Build the stage engine (`feat/stages`), then MAGIC-SPEC's effects in its three
   workstreams (WS-1 light + music, WS-2 ribbons/pillars/birds/fireworks/waterfalls, WS-3
   growth kit + director + Wonders), Super Rainbow's five stages first.
3. Resume `feat/osm`, then world travel (`docs/specs/WORLD-TRAVEL.md`).

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
2. Tilt to fly as the default on phones; touch optional (feat/controls). Tilt needs a real
   HTTPS deploy (Vercel from this repo); the claude.ai preview blocks motion sensors.
3. Hold-to-charge super splat (feat/supersplat).
4. Turbo modes and manual world travel: fly SF -> Tokyo across the Pacific with turbo gears
   (~5 min at G3 ~30 km/s); needs a world mode between cities (ocean, coastlines, curvature,
   day/night), Tokyo from OSM/Overture, floating origin. A design pass is producing
   `WORLD-TRAVEL.md`. Then: every city, many players (static tiles on a CDN, shared paint
   via per-region Durable Objects, OSM/GERS ids).
5. Use OpenStreetMap as much as possible for quality (feat/osm; ODbL: attribution in game +
   DATA_LICENSE.md for the tiles).
6. It felt laggy and low-res: we raised the frame to 390 px and tightened springs; the perf
   pass (polish/perf) is paused. Measure real fps here and on the producer's iPhone.

## Known issues worth knowing
- `shots.mjs` stats sometimes come back null at 390 px (the perf snapshot timing); the
  screenshots are still valid.
- The far skyline beyond the streaming radius is flat boxes; with fog off it shows.
- Saved paint keys: `strugglebus.paint.v1` (buildings), `strugglebus.ground.v2:<tx>,<tz>`
  (ground), `strugglebus.landmarks.v1` (landmark props, by name: `lm:sutro`,
  `lm:transamerica`, `lm:coit`, `lm:ferry`; independent of any bake). feat/osm bumps
  building paint to v2 (ids change); the landmark store stays as it is.
