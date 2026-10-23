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
  Building facades follow this by themselves (see Tower facades): their
  detail drops out by its size on screen, per building.
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
  clutter), rooftop gardens / Hundertwasser crowns (`City.raiseRoof(rect,
  top)` with the height `RoofSprouts.set` returns) and a painted tower's own
  setback gardens, trees and onion domes (`City.growTo(ref, level)`: every
  element the mesher recorded, see Tower facades). Anything new that stands on
  a roof and that the bus must not fly through goes through `raiseRoof`.
  A hand-built prop that replaces footprints owns their cells instead
  (`City.setPropObstacles(clear, boxes)`: inside `clear` each 8 m cell is
  rebuilt like the bake's, without the hidden lots: 3 x 3 ground max, the prop's
  boxes, the other buildings' parts, tree crowns; redone whenever a tile under
  `clear` arrives, before `onTile`, so its neighbors' buildings count).
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
- **stableIds** key saved paint. Footprint buildings keep the rank of their
  source footprint (LiDAR work happens after ranking); row lots merged back into
  one building keep one lot's id and retire the others. Buildings only a LiDAR
  bake has get ids >= 2^30 derived from what they are (split pieces: parent id
  and rank; LiDAR-only towers: a hash of their position), so re-bakes agree.
  `node tools/check-stable-ids.mjs <old city dir> <new city dir>` checks a
  re-bake (also LiDAR bake against LiDAR bake).

## Tower facades (`src/world/towerStyles.ts`, `buildingMaterial.ts`)
- The mesher picks a facade family per building (`styleFor`: icons table by
  lat/lon (SF only: `MeshOptions.sf` / `RegionRequest.sf`, from the manifest's
  origin), else height class x district x footprint x stable-id hash; outside
  the downtown districts blocks under 40 m keep the classic look) and roles
  per part (`partRoles`: penthouse box, crown part, podium family). It travels
  in bytes the vertex format already had: `aMeta.y` = arch | family << 4,
  `aMeta.w` flags bits 2-7 = penthouse, crown, crown type, variant, and
  `aBld2.y` = this part's top for family buildings (the front width only houses
  use). Family walls get u stretched to whole column modules (`Builder.remapU`,
  run on whatever vertices `wall()` / `slantWall()` emitted, so their
  subdivision can change freely); a tapering face keeps its u range.
- The shader decides detail per building and face, never per pixel: the size of
  a game pixel at the building (`vLodPx` = distance to its axis x `uPixelAngle`,
  set per draw from the camera and the render target in the material's
  `onBeforeRender`) times each face's foreshortening. Lines that must stay one
  game pixel wide use `fwidth` of the facade coordinates.
- Tower facades write light in whole ramp steps *after* the resolve's
  atmospheric perspective: `skyMirror()` / `gAF` mirror `skyLight()`, `sl`
  (`+ 0.04 * calm`: the game passes `pipeline.calm` as `uCalmF` through
  `setFacadeView(high, calm)`) and `light = mix(light, sl, smoothstep(0.08,
  0.66, fog) * 0.9)` of RESOLVE_FS. Seen from above the marine layer the resolve
  converges fogged pixels on the fog sea's lit top (`seaShade`), which isn't
  mirrored: those facade pixels write plain steps (`gAF = 0`) and dither like
  any material. **Change one, change the other** (a mismatch only brings the
  dither back); polish/look changes `skyLight()` (`0.9 - mix(0.25, 0.5, uCalm)
  * max(e, 0.0)`): copy it into `skyMirror()` when it merges. The aim glint on a
  tower facade is added in those whole steps (before `lightAtStep`).
- `uHigh` (0..1, `setFacadeView`; the marine-layer view's mix, computed whether
  or not fog is on) gives detail 1.5x the room and rhythm lines 2x the spacing
  up high. Never key it to `uFogLayer2.w` (0 without `?fog`).
- Painted towers' bushes, trees (`Part.GARDEN`) and onion domes (`Part.DOME`)
  are in the building mesh, every vertex on its element's anchor (offset in
  `aFacade.xy` + `aBld2.y`; flags bits 2-3 the level it needs, bit 4 a tree, not
  a bush): degenerate in the depth pass (no shadow), grown out in the vertex
  shader at their level. Their triangles come last in the index
  (`MeshArrays.solidIndexCount` splits them; `mergeMeshes` keeps every tile's
  growth after every tile's solids), and `City` draws `setDrawRange(0,
  solidIndexCount)` until a building of the tile grows (`growTo` opens the
  range of the tile's mesh or its coarse region's). The mesher also returns each
  element (`grown`, `GROWN_STRIDE` floats: building index, level, x, z, reach,
  grown top); `TileResult.grown` carries it past a coarse merge, and `growTo`
  raises the obstacle grid over it. main.ts's `growSprouts` calls `growTo` with
  RoofSprouts (blooms at L2+ and the saved-paint restore); a detailed re-mesh
  calls it again for the tile's painted buildings.
- `HIDDEN` footprints (the Ferry Building's lots, Coit Tower's stand-in box)
  aren't meshed and aren't building refs (`City.addTile` skips them by the same
  test as the mesher: centroid in the box, height under `maxTop`); a prop draws
  them. `HERO_PROPS` (Coit Tower, the Ferry Building, 181 Fremont's spire) are
  placed by `heroLandmarks(origin)` in `props/landmarks.ts`, with collision
  posts for their tall parts and their boxes for the obstacle grid
  (`setPropObstacles` over their `HIDDEN` box); only for the SF origin the
  tables are written for (`isSfOrigin`). The spire is a `SpireRide`: it binds to
  181 Fremont's ref when its tile arrives (`roofAtPart` under it) and mirrors the
  building shader's pop and wobble every frame; change one, change the other.
  When fix/landmarks merges: the Ferry and Coit become `addLandmarkBuilding`
  refs (their hidden lots stay out of the refs), and the spire takes
  `bindLandmarkPaint(spire, ref)` with the tower's ground as the pop origin (not
  an `lm:` key of its own). When polish/look merges: its `BRIDGE_ORANGE: 20`
  collides with `GLASS: 20`; renumber it 23 (`RAMP_COUNT` is 32).
- Houses: windows become one band per floor (ribbon) and then the wall's
  average tone by the same per-building pixel size (`config.facade.houseRibbon`
  / `houseFlat`); roofs are one ramp (GREY_LIGHT) with light offsets.
- QA: `node tools/facade-shots.mjs <url> <out> [--only=...] [--seq] [--paint] [--perf]`
  (chase, the vista after a real climb, hero telephotos of the icons, the
  Painted Ladies L1/L2/L3 row). Chase views park the bus while the city streams,
  then fly 2 s in fixed 1/30 s steps, so two builds line up; every grey hero is
  shot before any paint sequence; perf.json merges across `--only` runs.
  `python3 -I tools/seqstat.py <out>/<view>-seq 3` (shimmer.py finds the
  device px per game px itself: 3 for the 390 px frame on the 393 x 852 @3x
  viewport; `SB_PX_SCALE` overrides).

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
| Props + landmarks | `src/world/Props.ts`, `src/world/props/*` | trees, Sutro Tower, Transamerica, Coit Tower, the Ferry Building, roof sprouts; landmark paint (`props/landmarkPaint.ts`) |
| Tower facades | `src/world/towerStyles.ts`, `src/world/buildingMaterial.ts` | facade families, icons table, hero props table |
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

## Paintable landmarks (hand-built props)
A landmark prop (Transamerica, Sutro Tower, any `LandmarkKit` prop) is a
first-class paintable building: picked, bloomed by the wave, escalated,
glinted and saved like a baked one.

- **One call where the prop is placed**:
  `paintLandmark(city, 'lm:<name>', object, { name })` (`props/landmarkPaint.ts`).
  It takes the prop's base ring (convex hull in plan), its top and a 2 m height
  field of its real surface from its triangles, registers them with
  `City.addLandmarkBuilding`, and binds its materials to the paint texel.
  `name` is what the street sign says. Call it after positioning the object.
- `City.addLandmarkBuilding({ key, ring, baseY, roofY, arch?, name?, heightAt? })`
  makes a normal `BuildingRef`: paint index from the reserved range
  `[buildingCount, buildingCount + LANDMARK_SLOTS)` (PaintState is sized with
  the reserve), `stableId < 0`, its `tile` a one-record tile of its own (the
  ring), so `contains`, `frontOf`, `roofRect`, `buildingsNear` work unchanged;
  `roofAtPart` and `surfaceAt` follow `heightAt` (the pyramid's slope, the
  ground between Sutro's legs; `landmarkSurfaceAt` is the landmark part alone);
  `isLandmark(ref)`, `landmarkRefs()`. Paint is saved in
  `strugglebus.paint.v1` under the string key (`'lm:transamerica'`), which no
  baked stableId can collide with. Landmark refs are never unloaded.
- **Every spatial index goes through `City.indexRef(ref)`** (today the centroid
  hash). An index added later must be filled there too (one line).
- **The material**: `LandmarkKit.build(look?)` gives each landmark its own
  material (own uniforms, one shared program); its shader calls
  `lmVertex(position, aPat)` (paint texel, the buildings' pop scaled by
  `config.bloom.landmarkPop`, wobble) and `lmPaint(ramp, lo, type, aPat, y,
  worldPos, n, mpp)` before `sbWrite`. A prop outside the kit spreads
  `landmarkPaintUniforms(look)` into its uniforms and includes
  `GLSL_LM_PAINT_VS` / `GLSL_LM_PAINT_FS`. `bindLandmarkPaint(object, ref)`
  binds a prop to any building's texel (e.g. a spire to the tower it stands on).
- **The look** (`LandmarkLook`, local meters, all optional): `glowFrom` (lit
  accents above it; `blink` = rainbow beacon rings), `vines` (level-2 vines up
  to that fraction of the height), `planted` (vertical windowed walls in that
  band grow lush), `band` (level-3 band height), `paintBands` (the prop's own
  paint bands become a rainbow), `domes` / `bunting` (level-3 accents). Pattern
  ids the paint knows: 0 plain trim, 1 paint bands, 2 lattice, 3 window bands,
  others = walls; 20 / 21 are the accents (`LM_DOME`, `LM_FLAG`).
- **Level-3 accents cost nothing before level 3**: the kit appends them after
  the prop's geometry and `bindLandmarkPaint` sets the draw range in
  `onBeforeRender` from the texel's level (no extra draw call ever).
- The game: the impact callback calls `landmarkHit(city, pos, t)` (the splash
  starts where the breath hit); `bloom` uses `landmarkSparkles(ref)` and grows
  no rooftop sprouts on a landmark; saved landmark paint thins the fog at boot.
  The aim: the altitude ray hits landmark surfaces (`surfaceAt`); the classic
  short shot's chord is tested against them (a landmark face in the way takes
  the shot, `aim.lm`); `Splatter.barf` lands a landmark primary where the breath
  met it (`opts.y`, else `roofAtPart` at the aim point), never at its centroid.
- QA: `tools/landmarks.mjs` (game: probe, level sequences, altitude, Sutro,
  reload, near, views, perf), `tools/landmark-dev-shots.mjs` + `dev/landmarks.html`
  (one landmark, its texel from query params: level, hue, t, keep, hit, target).
- Merging polish/feel (area index, Aimer): `City.indexRef` gets
  `this.areaCells(ref, true);`, and the ref literal in `addLandmarkBuilding`
  gets `x0, z0, x1, z1, rad, q: 0` (all in scope there). Its Aimer and barf
  replace fix/landmarks' aim lines in main.ts and Splat.ts (its `landingOn` /
  `roofAtPart` already land a landmark on its surface); in `Aimer.occlude` a
  landmark target may take the shot on its own face:
  `if (!ref || (ref === target && !city.isLandmark(ref)) || ...) continue;` and,
  after `ey = city.roofAtPart(target, ex, ez) + 0.5;`,
  `if (city.isLandmark(target)) ey = Math.min(ey, this.y0 - F_CLEAR);`. The
  landmark glint in `GLSL_LM_PAINT_FS` then takes the buildings' new form
  (`uTargetT` / `uGlint` from `paintUniforms`, added to the light).
- Merging feat/facade (Coit Tower, the Ferry Building, 181 Fremont's spire): in
  main.ts's `heroLandmarks` loop, one line per prop:
  `paintLandmark(city, 'lm:' + h.object.name, h.object, { name: ... });`
  (their `k.build()` already gives them the paint; `k.build(look)` adds accents).
  The Ferry Building's hidden 8 m lots stay paintable under it and the prop's
  hull wins the pick as the tallest footprint there (at its ends only once the
  area index is in: the centroid hash searches 40 m around a point).

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
