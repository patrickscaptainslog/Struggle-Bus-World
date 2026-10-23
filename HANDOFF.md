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

## Branches (GitHub: patrickscaptainslog/Struggle-Bus-World)
| Branch | State | Notes |
|---|---|---|
| `main` | integrated + published (preview v6) | blast, altitude, LiDAR towers, feel polish, 390 px, fog off |
| `feat/facade` | in flight (cloud) | tower facade families, bases/crowns, distance LOD, Coit / Ferry Building / 181 Fremont props, painted towers |
| `fix/landmarks` | in flight (cloud) | landmark props become paintable buildings (Transamerica, Sutro); facade's new props adopt it with one call each |
| `polish/look` | in flight (cloud) | camera sky band, sign placement, hero silhouette, GGB orange, water, tree shimmer; a fixer is finishing review issues |
| `feat/controls` | in flight (cloud) | tilt-to-fly default on phones (touch fallback), turbo gears G0-G3 (G2/G3 locked until world travel), `src/ui/Hud.ts` |
| `feat/supersplat` | in flight (cloud) | hold-to-charge (10 s) -> firehose (~4 s) -> 60 s cooldown, `SuperMeter.ts` |
| `feat/osm` | PAUSED (WIP commit) | OpenStreetMap via Overture Maps: real footprints, parts, roofs, streets/parks/water, names, OSM-based ids, Amsterdam test city. Resume here. |
| `polish/perf` | PAUSED (WIP commit) | shadow caster proxy, prewarm, far-terrain culling, streaming, party walls. Resume here. |

`feat/controls` and `feat/supersplat` share an INPUT CONTRACT (`onTap`,
`onChargeStart`, `onChargeEnd(heldSeconds, cancelled)`, `state.chargeHeld`,
`onTurbo(dir)`, `state.turboHeld`, `input.mode`): see their DECISIONS/ARCHITECTURE
notes when merging.

## Who owns what (avoid two sessions fighting)
- Until the cloud session says the in-flight branches are merged, it alone merges into
  `main` and pushes `main`. Work on your own branch (e.g. `local/<topic>`) and push it;
  say in its first commit what it is for.
- Safe to take over now on this machine: `feat/osm` and `polish/perf` (paused, nobody
  else touches them). Merge `main` into them first.
- Fast, GPU-backed visual QA of any branch is always welcome: write results to
  `shots/local/...` and a short markdown report next to them.

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
  (ground). feat/osm bumps building paint to v2 (ids change).
