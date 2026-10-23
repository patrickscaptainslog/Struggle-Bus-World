# Struggle Bus — architecture and module contracts

Phase 1: solo, no server. One bus, one faction (Rainbow), real San Francisco.
Rule #1 is beauty: if something can't be made beautiful yet, cut it. Where the
brief is silent, pick the more beautiful option and log it in `DECISIONS.md`.

## Stack
Vite + TypeScript + three.js (WebGL2). No runtime asset files except baked
city tiles: every model is built procedurally, every sound is synthesized.

## World conventions
- Units: meters, seconds, radians.
- Axes: +X east, +Y up (meters above sea level, NAVD88), +Z south.
  Ground elevation comes from the USGS 1 m DEM; buildings sit on it.
- Object forward is **-Z** (three.js `lookAt` convention). The bus model faces -Z.
- City origin per city config (SF: 37.7749, -122.4194).

## Rendering contract (READ THIS before writing any material)
The scene is rendered at low resolution into a G-buffer and resolved to the
locked palette by `src/render/PixelPipeline.ts`. **Materials never output RGB.**
They output a ramp index + light level + fog + glow through the GLSL chunks in
`src/render/materials.ts`:

- `makeRampMaterial(opts)` — standard toon material (supports `InstancedMesh`,
  per-vertex ramps via `setVertexRamp()` / `vertexRamp: true`, `glow`, custom
  `vertexChunk` for animation, `noOutline`, `fogMul`).
- Custom shaders: `glslVersion: THREE.GLSL3`, include `GLSL_COMMON` in both
  stages and `GLSL_OUT` in the fragment stage, spread `globals` into
  `uniforms`, and finish with
  `sbWrite(ramp, light, fog, glow, viewNormal, surfaceId, flags)`.
  - `ramp`: integer ramp id from `src/render/palette.ts` (`Ramp.*`, `HUE_RAMPS`).
  - `light` 0..1 → ramp step (0 darkest, 1 lightest). Use `sbLight()`.
  - `fog` 0..1 → use `sbFog(worldPos)`. It includes the marine layer seen
    from above (`uFogLayer*`, `sbLayerTop()` in `GLSL_LAYER_TOP`, mirrored on
    the CPU by `layerTopBase()`): materials get it for free; the resolve pass
    lights the fog sea's top. Never hand-roll fog.
  - `glow` 0..1 → emissive; glowing pixels bloom a dithered halo.
  - `flags`: 1.0 normal (gets outlines), 0.5 = no outline (particles, cards).
- Every scene material must write both outputs (`gColor`, `gAux`).
- Objects that cast sun shadows: `obj.layers.enable(SHADOW_LAYER)`.
  The bus and particles must NOT cast (the bus has its own drop shadow).
- Pixel budget: the portrait framebuffer is ~240 game pixels wide. At gameplay
  camera distance (~175 m, 24° horizontal FOV) one game pixel ≈ 0.3 m at the
  bus and ≈ 0.6–1 m at mid-distance. Details smaller than ~2 game pixels
  disappear or shimmer — design silhouettes and big color shapes, not
  greebles. Avoid single-pixel-wide high-contrast stripes (they crawl).
  Up high (vista camera: 270 m, 38°) a game pixel is ≈ 1 m at the bus and
  2–4 m on the city below: everything there is the coarse (LOD 1) mesh.
- Altitude: the camera can sit 700 m above the ground; the far plane is
  30 km. `pipeline.setHfov()`, `shadowFocus/shadowScale/shadowStrength/
  shadowEdge` and `calm` are driven by the game per frame (keep the shadow
  window centered on the ground under the view, never on a high bus).
- Snapping up high: with the vista on, the game sets `pipeline.focus` to the
  ground under the screen center and `steadySnap`, calls `pipeline.snap()`
  before `render()`, and moves near objects (the bus, its drop shadow, its
  particles) by `pipeline.snapCompensation(pos)` so they stay where they
  belong although the grid snapped at the city's depth. Anything new that
  sits near the bus and must not jitter up high needs the same.
- `pipeline.calm` (0..1): surfaces round to their ramp step instead of the
  ordered dither, the fog handover is a hard contour, and the sky / fog sea
  dither in screen space. Materials don't change; it is all in the resolve.
- Coarse regions are drawn as ONE building mesh + ONE ground mesh per 1 km
  region (`City.regionMeshes`); detailed regions keep per-tile meshes. Code
  that walks tiles for rendering must handle both. A tile marked with
  `City.setOwnGround(tx, tz)` keeps its own ground mesh inside a coarse
  region (the merged ground skips it).
- Per-tile ground state (feat/blast's `GroundPaint`): attach in
  `City.makeTileTerrain` and detach in `City.dropTileTerrain` (the only two
  places a tile's own ground mesh is made and dropped), and mark every tile
  that has or gets ground paint with `setOwnGround` so it shows from altitude.
  Merging feat/blast: its `addTile` terrain lines (`tileUniforms()`,
  `makeTerrainMaterial(..., 0, gu)`, `attach`) move into `makeTileTerrain`,
  its `unloadRegion` `detach` into `dropTileTerrain`; its `Splat.barf` takes
  `opts.travel` (`tImpact = this.t + (opts?.travel ?? S.impactDelay)`), and
  main's geyser lambda keeps `travelTime: breathTravel ?? config.splat.impactDelay`.
- Palette: 8-step ramps. Warm hues shadow toward rose/violet, never brown.
  There is no brown in the palette and there never will be.

## City data (bake -> tiles -> meshes)
`tools/bake/bake.py <slug>` turns footprints + DEM (+ an optional LiDAR point
cloud via `tools/bake/lidar.py`) into 256 m tiles; `tools/bake/pack.py` bundles
them into gzip'd 1 km regions. Layouts live in `src/world/tiles.ts`.
**The footprints, streets, land, water, trees and names are OpenStreetMap**
(feat/osm): `tools/bake/overture.py <slug>` extracts the city's bbox from the
Overture Maps GeoParquet release on S3 (row groups by their bbox statistics,
cached under `$SB_OVERTURE_CACHE`, default `/tmp/claude-0/sbdata/overture/`),
`tools/bake/osm.py` reads the extracts (buildings, parts, ground raster, trees,
names) and `bake.py` conflates them (OSM first; USA Structures only where OSM
has no footprint; LiDAR heights where they agree). A city config with
`"overture": {...}` bakes the OSM formats below; without it the old path
(USA Structures, 'SBB2' / 'SBT1') is unchanged. The tiles are a derivative
database under the ODbL (`public/city/DATA_LICENSE.md`); `city.json` carries
`attribution` ("© OpenStreetMap contributors, Overture Maps Foundation"),
`license` and `stats` (counts per source, heights by source, roofs, trees).
QA without a browser: `tools/bake/citydata.py` reads a baked city in Python,
`tools/bake/plot.py` draws top-down comparisons (classes, lot lines, heights,
roof shapes, trees, street names) of any number of bakes side by side.
- **'SBB3' building tiles** (OSM bakes; 'SBB1'/'SBB2' still read): SBB2 plus
  `u32 facadeColor[]`, `u32 roofColor[]` (0xFFRRGGBB as mapped, 0 = none) and
  `u16 roofH[]` (dm) after `groundY`, and `u8 roofShape[]`, `u8 roofDir[]`,
  `u8 facadeMat[]`, `u8 roofMat[]`, `u8 source[]` after `taper`; then pad to 4
  from the tile start (SBB2's pad was the same, its offsets were aligned) and
  the rings. `roofShape` (`RoofShape` in tiles.ts: 0 untagged, 1 flat, 2 gabled,
  3 hipped, 4 pyramidal, 5 skillion, 6 dome, 7 onion, 8 round, 9 gambrel,
  10 mansard, 11 half-hipped, 12 saltbox, 13 cone): with a shape, **roofY is
  the eave** (top of the walls) and the roof rises `roofH` m above it; untagged
  and flat parts keep roofY = their top as before. `roofDir`: the way the main
  roof face looks (downhill), `atan2(dz, dx)` in the local frame, 256 = a full
  turn; the ridge runs across it (the bake always sets it for shaped roofs:
  OSM roof:direction, else the ridge along the footprint's long side, across
  with roof:orientation=across). `source`: bits 0-2 footprint (0 OSM, 1 other
  Overture, 2 USA Structures, 3 LiDAR only), bits 3-5 height (0 default,
  1 LiDAR, 2 OSM height, 3 OSM levels, 4 USA Structures, 5 neighbours), bit 6
  massing from OSM building parts, bit 7 LiDAR tiers. A building may hold
  several tier-0 records: OSM building parts on the ground (the biggest
  first), or pieces cut through a courtyard (flat-roofed). Consumers that
  assume "record `local` is the whole footprint" are wrong for those (City's
  `contains`, `edgeDistance` and bounds already walk every tier-0 record).
- **Shaped roofs in BuildingMesher** (`shapedRoof`, `roofPlanes`, `clipHalf`,
  `revolve`, appended at the end of the file): a part with `roofShape >= 2`
  and `roofH > 0.3` (not tapering) gets its roof built first, before the walls,
  so a footprint it can't roof (a planar roof over a footprint < 55 % of its
  rectangle) keeps its parapet and flat cap. Planar roofs are the lowest of a
  few planes in the roof frame (s along the ridge, t across, from `roofDir`):
  each face is the footprint clipped to where its plane is lowest
  (Sutherland-Hodgman, ear-clipped), Part.ROOF_SLOPE (Part.ROOF where flat:
  a mansard's top); where the roof meets an outer wall above the eave (gable
  ends, a skillion's high side) the wall continues up to it as FRONT / SIDE
  quads and triangles with the facade's u and v, so windows run on; domes,
  onions, cones and pyramids on non-rectangular footprints revolve the ring
  about its area centroid. With a built shape there is no parapet, no
  rooftop clutter and no procedural Victorian gable (that stays for untagged
  parts only); `Group.top` (the flood / pop top) includes `roofH`. LOD 1 builds
  the same roofs.
- **'SBT2' terrain tiles** (OSM bakes): SBT1, pad to 4, then the street-name
  section: `u8 hood[8*8]` (32 m cells: an index into `manifest.neighborhoods`,
  255 none), `u16 nameCount, u16 lineCount`, names `{u8 len, utf-8}` (as
  signed: 'Haight St'), pad to 2, lines `{u16 name, u8 rank (0 street,
  1 path/plaza), u8 n, i16 x, z dm from the tile origin * n}`. Parsed into
  `TerrainTile.streetNames / streets / hoodGrid`; `City.streetNameAt(x, z,
  maxDist = 45)` (nearest named street, paths only when no street is in
  reach) and `City.hoodAt(x, z)`. The region bundle ('SBR1') is unchanged.
- **Ground classes** (2 m class texture, `Ground` in tiles.ts): 0 PAVED,
  1 GRASS, 2 WATER, 3 SIDEWALK as before, and with OSM 4 PLAZA (pedestrian
  areas, squares, piers, hard pitches), 5 PATH (footways, cycleways, steps,
  tracks), 6 SAND, 7 RAIL, 8 FOREST, 9 YARD (block interiors: gardens,
  unmapped land), 10 ROCK. Streets are their centerlines buffered to their
  class width (`osm.OSM_DEFAULTS.roadWidth`), sidewalks 3.5 m beside streets
  that have them, the sea is what OSM's coastline land polygons leave out
  (where the DEM is low), blocks of mostly non-residential buildings are
  PAVED lots instead of yards; under buildings: SIDEWALK, as before.
  `terrainMaterial.ts` shades the new classes with existing ramps (palette
  unchanged); the far grid ('SBF1') carries the same codes (only WATER is read).
- Trees ('SBT1/2' records unchanged): OSM natural=tree points and tree rows
  (species -> kind: cypress / pine and eucalyptus / street tree, height ->
  size), procedural park trees only inside OSM parks, cemeteries, gardens and
  woods (none on pitches, fairways, playgrounds, or north of `treeLatMax`), and
  procedural street trees on sidewalks where no mapped tree stands within 9 m.
- **Buildings are groups of parts.** A building tile ('SBB2') holds one record
  per *part*: a plain building is one part; a LiDAR-tiered tower is several
  (podium, setbacks, tapering shaft, crown, rooftop boxes), consecutive, tier 0
  (the footprint) first, each standing on the top of the tier below. Parts of a
  building share its paint index (one paint texel), stableId, arch, seed and
  hood, and carry `groundY` (the building's true ground) so window rows line up
  across tiers, `tier`, and `taper` (the part's top ring is its base scaled).
  'SBB1' tiles still read (one part each).
- `City` exposes one `BuildingRef` per building (`local` = ground tier,
  `parts`, `top` = highest part; `roofY` = top of the whole tower):
  `buildingsNear`, `contains`, `frontOf` (ground tier) and `roofRect` (top tier)
  never see individual parts; `roofAtPart(ref, x, z)` is the roof of the part
  over a point (a podium, not the tower above it). The aim glint, pop, wobble
  and color flood work on the paint index / whole-building center, ground and
  top, so towers move and paint as one.
- The flight obstacle grid (`City.obstacleAt`) is baked per part (tall parts
  grown by half a cell diagonal), so it follows the real tiered heights; the far
  skyline has one box per building >= 20 m, a few per stepped tower >= 60 m.
  On the phone the grid then takes what the bake can't know: every tree crown
  as a dome over its reach (`treeCrown` in props/trees), the detailed mesh's
  roof details (every LOD 0 vertex lifts its cell; a single-part house lifts
  every cell within 3 m of it to its mesh top: gables, chimneys, parapets,
  clutter) and rooftop gardens / Hundertwasser crowns (`City.raiseRoof(rect,
  top)` with the height `RoofSprouts.set` returns). Anything new that stands on
  a roof and that the bus must not fly through goes through `raiseRoof`.
- **Footprint queries** (an area index: every ref in every 32 m cell its
  footprint bounds overlap; refs carry `x0 z0 x1 z1 rad`):
  `buildingAt(x, z)` = the footprint containing the point wherever in it
  (tallest of overlapping), `edgeDistance(ref, x, z)` = true distance to the
  footprint (0 inside), `nearestBuilding(x, z, r, minHeight)` = nearest by that
  distance, `buildingsWithin(x, z, r)`, `buildingAbove(x, z, y)` (line of fire),
  `landingOn(ref, x, z, inset)` (where a shot aimed at (x, z) lands on ref),
  `roofAt` (the part's roof under a point). Never test hits by centroid
  distance: big footprints reach 100+ m from their centroid.
  `buildingsNear` (centroid within r) stays for "what's around here" questions.
- **stableIds** key saved paint. OSM bakes (`bake.py` `ID_RANGES`, `IdAlloc`):
  every id derives from its source record, never a rank: [0, 2^31) FNV-1a of
  the OSM id ('w123', 'r45'; a multipolygon's separate pieces 'r45#1'...),
  [2^31, 2^31 + 2^29) other Overture footprints (GERS id), [2^31 + 2^29,
  3 * 2^30) USA Structures fallback lots 'u<BUILD_ID>:<lot>' and pieces LiDAR
  splits off them, [3 * 2^30, 2^32) LiDAR-only towers (a hash of their 8 m-grid
  position, as before); a hash collision probes to the next free id of its
  range in key order. So a building keeps its id across re-bakes and other
  buildings coming or going never shift it: the key a shared-paint server can
  use. The paint store is `strugglebus.paint.v2` (SF; other cities
  `strugglebus.paint.v2:<slug>`), the ground paint `strugglebus.ground.v3:`
  (other cities `strugglebus.ground.v3.<slug>:`): v1 / v2 saves keyed the old
  ids and are dropped on load, never applied. Old (non-OSM) bakes: footprint
  buildings keep the rank of their source footprint; row lots merged back into
  one building keep one lot's id and retire the others; LiDAR-only ids >= 2^30.
  `node tools/check-stable-ids.mjs <old city dir> <new city dir>` checks a
  re-bake of either kind (it refuses to compare an OSM bake with an old one).

## Merging feat/osm (notes for the other workstreams)
- **Data**: `public/city/sf/` is re-baked wholesale (its own commit); don't
  hand-merge it, take ours. Re-baking needs the Overture extract
  (`python3 -I tools/bake/overture.py sf`, ~2 min, cached under
  `$SB_OVERTURE_CACHE`) and the shared LiDAR cache
  (`SB_LIDAR_CACHE=/home/user/struggle-bus/tools/bake/.cache/lidar`): the
  USA Structures LiDAR plan is still built first, so its cached rasters hit,
  and only the chunks OSM adds are rasterized on top (their own cache files).
  A region format change (polish/perf) only needs `pack.py` re-run on the raw
  tiles in `tools/bake/.cache/sf/`.
- **feat/facade** (BuildingMesher facade / roof / crown features,
  buildingMaterial.ts, towerStyles.ts): our BuildingMesher diff is the roof
  path only: `RoofShape` import, `Group.top` + `roofH`, `shaped` / `builtShape`
  computed right after `flush` (before `parapet`), `gable` requires
  `roofShape === NONE`, the roof section starts `if (builtShape) {} else if
  (gable)`, clutter is skipped when `builtShape`, and the roof functions
  appended at the end. Facade features, crowns and parapets should skip parts
  with `builtShape` (a mapped roof: OSM parts' pyramids and domes, City Hall's
  dome), like they skip procedural gables. `BuildingTile.facadeMat` /
  `facadeColor` / `roofMat` / `roofColor` are there for tower styles and the
  painted world (glass, brick, stone...); buildingMaterial.ts is untouched.
- **fix/landmarks**: the keep-outs are unchanged (footprints within a
  landmark's `clearRadius` capped at 8 m, no LiDAR, no parts, no roof shape),
  but every stableId changed (OSM ids): ids a landmark prop takes must stay out
  of `ID_RANGES` (e.g. derive them from the OSM id of the landmark's footprint,
  Transamerica = 'w24222973', Coit Tower, Ferry Building), and paint for them
  saves in `strugglebus.paint.v2`.
- **polish/perf** (City.ts streaming, regionLoader / cityWorker, wall
  subdivision, shadow LOD): City.ts gains `streetNameAt` / `hoodAt` (after
  `neighborhoodName`) and passes `manifest.slug` to `PaintState` /
  `GroundPaint`; regionLoader is untouched (`TerrainTile.streets` /
  `streetNames` / `hoodGrid` are structured-cloned, not in the transfer
  list: a few KB per tile). Gable-end walls are `quadF` / `triF`, not `wall()`,
  so wall subdivision doesn't reach them (they're small). OSM bakes have more,
  smaller buildings (no lot splitting, but every shed): see the perf numbers in
  DECISIONS (Data).
- **polish/look** (water / sky / bridges): terrainMaterial.ts only gains the
  class branches; the coastline is now OSM's (water class), piers are PLAZA
  decks at 2.5 m; the water plane (-0.6 m) is unchanged.

## Tunables
Expose module constants via `registerTunables('Name', obj, ranges?)` from
`src/ui/tunables.ts`; read `obj.field` live every frame. Global feel numbers
live in `src/config.ts`.

## Module ownership (each owns only its files)
| Module | Files | API (consumed by `src/game/*`) |
|---|---|---|
| Core renderer | `src/render/*` | `PixelPipeline`, `materials`, `palette` |
| World / bake | `tools/bake/*`, `src/world/City*.ts`, `src/world/Buildings*.ts`, `src/world/Terrain.ts` | baked tiles → meshes, paint state |
| Audio | `src/audio/AudioEngine.ts` | see `AudioEngine` |
| Bus model | `src/bus/BusModel.ts` | see `BusModel` |
| Particles | `src/fx/Particles.ts` | see `Particles` |
| Street signs | `src/fx/StreetSign.ts`, `src/fx/pixelFont.ts` | see `StreetSigns` |
| Input + tuner + perf | `src/game/Input.ts`, `src/ui/Tuner.ts`, `src/ui/Perf.ts` | see below |
| Props + landmarks | `src/world/Props.ts` | trees, Sutro Tower, Transamerica, roof sprouts |
| Game glue | `src/main.ts`, `src/game/*` | flight, camera, splat, bloom, persistence |
| Ground paint | `src/world/GroundPaint.ts`, `src/game/blastLayout.ts` | per-tile splat masks, blast shape + hue layout, shockwave ring GLSL |

## The blast (dragon breath)
`Splatter.barf(x, z, opts?: BarfOpts): number` launches a projectile
(returns the game-clock impact time). `opts.drop` = meters the bus is above the
impact; the radius is `blastRadiusFor(drop)` = `config.splat.blastRadius` x
(1 + (dropGain300 - 1) x drop / 300), so about x2 from 300 m up. Callers that
pass nothing get the base blast. `Splatter.radius(drop)` answers the same for
UI or camera code. `opts.travel` = tap-to-impact time (default impactDelay),
`opts.target` = the building to hit (the one glinting; null = none; omitted =
`pick(x, z, pickRadius(drop))`), `opts.y` / `opts.exact` = a wall hit's height
and exact landing. It lands on a house at its centroid, on a big building at
(x, z) if that is on it, else on its footprint nearest (x, z), 4 m in
(`City.landingOn`, `config.splat.smallRad`), and centers the blast there. `splatter.lastMiss`: nothing
paintable in reach over open water (no flash, boom or hit-stop; `SplatFx.miss`
splashes at impact time; the caller refunds belly via `Flight.refund`).

**Aim** (`src/game/Aim.ts`, `Aimer`): `update(flight, t, dragging)` once per
frame (the ray, the sticky target, the lift latch, the line of fire) returns
the building that glints; `press()` latches it on a touch-down
(`Input.onPress`); `fire(flight)` is the `Shot` a tap fires (target, landing,
drop, flight time from launch). main.ts calls `fire` before `Flight.tryBarf`
and passes the shot to `barf` with `travel = inhale + shot.travel`; the
`geyser` fx waits out `config.splat.inhale` before the particles launch. The
glint uniforms: `uTarget` (index), `uTargetT` (when it became the target),
`uGlint`. Splat updates run before `city.update` (the paint upload), so the
impact frame shows the hit.

- `src/game/blastLayout.ts`: `BlastSpec` (everything a blast paints, a flat
  number array when saved), `arrival(d, r)` (shockwave timing), `layoutHue`
  (pinwheel / rings / spiral), seeded splat edge + spatter dots.
- `src/game/Splat.ts`: picks every building the blast reaches, deals the fresh
  ones the rainbow by angle around the impact (touching neighbors differ, never
  the ground's hue under them), escalates painted ones, writes the whole wave to
  the paint texture at impact, starts/lands the ground job, sets the ring
  uniforms, calls `SplatFx.impact(blast)` once and `bloom(...)` per building at
  its arrival time.
- `src/world/GroundPaint.ts` (owned by `City`, `city.ground`): one RGBA8 mask
  per terrain tile on the class grid, `begin` (at the tap) -> `work` (rows per
  frame) -> `land` (at impact, one upload per tile); `sample(x, z)` for CPU
  queries (trees). Saved per tile as its settled mask (`encodeMask` /
  `decodeMask`: 5-bit coverage + 3-bit hue, run-length, base64) under
  `strugglebus.ground.v2:<tx>,<tz>`, decoded when the tile attaches; blasts that
  reach an unloaded tile wait on its entry and replay when it arrives.
  `GLSL_BLAST_RING` (shockwave on up-facing surfaces: terrain + roofs) and
  `GLSL_GROUND_PAINT` (terrain) with `blastUniforms`.
- `PixelPipeline.flash(u, v, frames, strength)`: palette flash in the resolve
  pass. `CameraRig.kick(m)` + `applyKick(cam, realDt)`: translation-only kick
  (the pixel snap handles it).
- `src/render/upload.ts`: `uploadRect()` = one texSubImage2D of a DataTexture's
  dirty rectangle (PaintState, GroundPaint).

QA hooks: `?fixeddt=<s>` steps the game by a fixed dt per rendered frame;
`window.__qa.holdAt = <game time>` freezes on the first frame at/after it
(`__qa.held` turns true); `__qa.holdFrames = n` renders n more frames, then
freezes (steps through hit-stop frames, whose game time stands still);
`__game.glintNow()` = the building glinting (what a tap hits), `aimNow()`,
`lastShot()` (aim = impact point, travel = tap to impact, target, wall); `__qa.topDown = { lat, lon, height }` looks straight
down; `__game.barfAtLatLon(lat, lon, drop?)` returns the impact time;
`__game.paintedNear(lat, lon, r)`; `__game.seedGround(n, lat, lon, spread)`
paints n saved blasts at once (a long session). `tools/blast.mjs` drives all of
it (perf, seq, top, reload, escalate, tap, drop, layouts, row, deal, heavy).

Feel QA: `node tools/feel-sim/run.mjs <scenario>` runs the real game modules
offline against the baked city (aim, altitude taps, picks, misses, bank /
release / breath-turn on a flat world, real-city clipping vs the rendered
surfaces and climb acceleration, anticipation timing; at any dt; see its
header); `node tools/feel.mjs <baseUrl> <outDir> [strip] [glint] [taps]` checks
the same in the browser (the tap -> jet -> impact -> hit-stop frame strip, the
glint on/off, real taps at the floor and from altitude). The harness's
`loop.ts` replays main.ts's flight / aim / splat order: keep it in step.

Dev pages: `dev/<module>.html` using `dev/harness.ts` (real pipeline + grey test
blocks + turntable camera). Screenshot with
`node tools/shot.mjs "http://127.0.0.1:5173/dev/<page>.html?dist=60&elev=30" shots/tmp/x.png`.
The dev server: `npx vite --port 5173 --strictPort --host 127.0.0.1`
(start it in the background if `curl -s 127.0.0.1:5173` fails).
Headless Chromium uses SwiftShader: correct but slow; don't judge perf by it.
