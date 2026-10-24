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
    the CPU by `layerTopBase()`) and the fog ceiling of tall distant shapes
    (`uFogStand`: anything ~50-160 m above the city's low ground, `City.lowGround()`
    (the far grid's 5th-percentile land height, ~sea level in SF), gets at most `config.fog.standFog`
    out to ~5 km, so towers and hilltops stand out of the low fog while
    everything low, the streaming edge included, is buried as before):
    materials get it for free; the resolve pass lights the fog sea's top.
    Fog and the marine layer are off by default (`config.fog.enabled`; `?fog`
    brings them back): then `sbFog` is only a far fade (`clearFarFull`) and
    the fog ceiling is off with it. Never hand-roll fog, and don't multiply it below ~0.7 for far objects (the
    handover band sits at 0.62-0.68).
  - `glow` 0..1 → emissive; glowing pixels bloom a dithered halo.
  - `flags`: 1.0 normal (gets outlines), 0.5 = no outline (particles, cards).
  - Outlines: a silhouette pixel is two steps darker, except a one-pixel
    feature with background on both sides (a cable, a pole), which keeps its
    own color. `Ramp.BUS_YELLOW` / `Ramp.BUS_BLACK` belong to the bus alone:
    the resolve gives their silhouette a plum ink edge (the hero separates
    from every paint hue). Don't use them elsewhere.
  - The hero's headlight is light, not geometry: `pipeline.setHeroBeam(eye,
    tip, halfNear, halfFar, strength)` each frame (after `snap()`), and the
    resolve lifts what lies beyond the bus inside that wedge one or two steps
    up its own ramp, a warm core at the lens and a warm glint on the nose's
    ink edge over the lens. It lights only the grey world's ramps (GREY,
    GREY_LIGHT, GREEN_GREY, WINDOW, ROOF_DARK, and the unpainted towers' GLASS,
    STONE, GRANITE): never paint, glow or halos.
  - The hero's drop shadow is light too: `pipeline.setHeroShadow(x, z,
    underY, fx, fz, halfLength, halfWidth, steps)` each frame (after
    `snap()`), and the resolve draws whatever faces up below `underY` inside
    that oval `steps` darker in its own ramp (paint included; the open bay
    too: the bay plane writes no outline flag, so the test also takes the
    WATER ramp). No decal.
  - Flat-light test: a pixel dithers only if a neighbor's light byte sits on
    a real gradient (1.5 bytes up to the dither window, 72.86 x
    `ditherWidth`); a whole-step jump (a crisp band edge) rounds. Materials
    that want crisp bands (tree crowns) snap their light to a step.
- Every scene material must write both outputs (`gColor`, `gAux`).
- Objects that cast sun shadows: `obj.layers.enable(SHADOW_LAYER)`.
  The bus and particles must NOT cast (the bus has its own drop shadow).
- Pixel budget: the portrait framebuffer is 390 game pixels wide
  (`config.render.pixelWidth`; `?px=240` the old 5x look). At gameplay
  camera distance (~155 m, 24° horizontal FOV, 24° above the bus at cruise: the
  horizon ~13% from the top, the bus ~60% down) one game pixel ≈ 0.17 m at the
  bus and ≈ 0.4–0.6 m at mid-distance. Details smaller than ~2 game pixels
  disappear or shimmer — design silhouettes and big color shapes, not
  greebles. Avoid single-pixel-wide high-contrast stripes (they crawl).
  Up high (vista camera: 270 m, 38°) a game pixel is ≈ 0.6 m at the bus and
  1–2.5 m on the city below: everything there is the coarse (LOD 1) mesh.
  Building facades follow this by themselves (see Tower facades): their
  detail drops out by its size on screen, per building.
- Altitude: the camera can sit 700 m above the ground; the far plane is
  30 km. `pipeline.setHfov()`, `shadowFocus/shadowScale/shadowStrength/
  shadowEdge` and `calm` are driven by the game per frame (keep the shadow
  window centered on the ground under the view, never on a high bus).
- Snapping up high: with the vista on, the game sets `pipeline.focus` to the
  ground under the screen center and `steadySnap`, calls `pipeline.snap()`
  before `render()`, and moves near objects (the bus, its drop shadow's
  center, its particles) by `pipeline.snapCompensation(pos)` so they stay where they
  belong although the grid snapped at the city's depth. Anything new that
  sits near the bus and must not jitter up high needs the same.
- `pipeline.calm` (0..1): surfaces round to their ramp step instead of the
  ordered dither, the fog handover is a hard contour, and the fog sea dithers
  in screen space. Materials don't change; it is all in the resolve. At every
  height the sky dithers in screen space and is written with alpha 0, which
  the upscale reads as "plain sky: don't apply the snap's sub-pixel shift"
  (the sky only turns with the view, so it holds perfectly still); surfaces
  also round instead of dithering as their fog rises (`config.render.ditherHaze*`),
  and at street level the fog handover is value-matched (each surface turns
  into the FOG step nearest its own luminance, then flattens into a
  silhouette) through a band as narrow as the fog's own gradient
  (`config.render.fogBandMin` at street level). A silhouette standing out of
  the fog must run `config.render.fogSliver` of the frame's height (10 px of
  852) or it is buried with the fog (no chips floating in the sky band).
- **Pipeline invariant (resolve -> upscale):** the resolve's alpha is 0 on
  plain sky and 1 everywhere else, and the upscale takes the unshifted texel
  where both it and the shifted one are plain sky. Whatever replaces the
  upscale (e.g. CSS canvas scaling in polish/perf) must keep the sky off the
  snap's sub-pixel shift, or the sky saws by a pixel with the remainder.
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
  There is no brown in the palette and there never will be. New ramps are
  appended at the end and referenced by name (never by number: the G-buffer
  stores ramp/255 and the resolve fetches palette row = ramp, nothing baked
  holds a ramp id). `RAMP_COUNT` is 48 rows (an 8x48 RGBA8 texture, 1.5 KB):
  0-19 core; 20-23 world materials (GLASS, STONE, GRANITE: tower facades;
  BRIDGE_ORANGE: painted bridge steel, the Golden Gate); 24-31 reserved for the
  faction ramps (MAGENTA 24, CYAN 25, AQUA 26, PEARL 27, MOSS 28, BIOLUME 29,
  FAE_VIOLET 30, SILVERBARK 31: docs/specs/STAGES.md 3.4 rule 7); 32-37 for
  world travel (NIGHT_SKY 32, OPEN_SEA 33, LIMB 34, CLOUD 35, DRY_LAND 36,
  TWILIGHT 37: WORLD-TRAVEL.md 2.5); 38-47 spare. Claim a reserved row by
  adding its name at that number.

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
  dither back). The sky function itself has one copy: `GLSL_SKY_LIGHT`
  (`sbSkyLight(dir, sunDir, calm)` in materials.ts), which the resolve's
  `skyLight()` and the facades' `skyMirror()` both call at the same calm; the
  `sl` / `gAF` mix is still mirrored by hand. The aim glint on a
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
  Coit and the Ferry are paintable landmarks (`HERO_PROPS[].paint`: their
  `lm:` key and sign name, one `paintLandmark` each in main.ts; their hidden
  lots stay out of the refs); the spire has no `paint` entry: it is bound to its
  tower's texel with `bindLandmarkPaint(spire, ref, { ride: true })` (it paints
  and glints with the tower; its shader skips the pop, SpireRide owns it), never
  a landmark of its own. See Paintable landmarks. (polish/look's `BRIDGE_ORANGE` is row 23,
  after GLASS / STONE / GRANITE; see the palette's row map under Rendering.)
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
- The street sign (`SplatFx.primary` -> `showSign` in main.ts) never stands over
  the blast: it is queued on the game clock until the wave has reached the
  blast's edge (+ `signTune.showDelay`), then placed on open ground past the
  blast's far side as the camera sees it, off the flight line
  (`signTune.besideOut/besideSide`; then beside the blast, then farther past;
  never inside it), scaled (`StreetSignOptions.scale`) so a font pixel stays
  >= `signTune.minFontPx` game pixels, at its true depth (`depthBias` 1 m, on
  from the start: what stands in front of it covers it). A spot whose pole is
  seen to its foot wins; else `StreetSignOptions.pole` lifts the blade clear
  of the roofs in front (up to `signTune.poleLiftMax`); both bottom corners of
  the blade (`signBladeWidth(text)`) must clear them too. Never on water
  (`City.groundClassAt`: the tile's 2 m ground class). No spot in frame:
  `showSign` returns false and the pending sign asks again 0.8 s later
  (twice); then the primary's front only if it lies outside the blast
  (+4 m), else no sign. The whole blade must sit inside the frame, and its
  bottom edge must be seen over its whole sightline (`bladeSeen`: five
  points across it, every 6 m to 90% of the way, against `City.roofAt` and
  `City.landmarkSurfaceAt`, the real footprints; the obstacle grid stands
  ~10 m proud of a facade): a tower or landmark past the pole test's 60 m
  hid half a blade. Run only on a spot that passed every other test. A
  landmark primary is the bloom itself and reaches past the blast: no
  blade may overlap its projected box, and its fallback is its apron along
  the edge facing the bus (`City.edgeToward`), as far toward an end as the
  frame allows (off its box if it can, else at least off its middle).
  One sign per name: while a sign with this name stands, a new blast flips it
  if it is in view and outside the new blast; if the new bloom reaches its
  spot, `StreetSigns.retire(pos)` sinks it and the sign stands anew.
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
  `roofAtPart` and `surfaceAt` follow `heightAt` (the pyramid's slope; between
  Sutro's legs whatever stands there; `landmarkSurfaceAt` is the landmark part alone);
  `isLandmark(ref)`, `landmarkRefs()`. The ref carries the area-index fields
  (`x0 z0 x1 z1 rad q`) like a baked one. Landmark refs are never unloaded.
- **Saved paint**: a landmark's key is its name (`LANDMARK_KEY_PREFIX` `'lm:'` +
  name, enforced by `addLandmarkBuilding`), saved in a store of its own,
  `strugglebus.landmarks.v1` (`:<slug>` for other cities; `landmarkStoreKey`),
  never among the buildings' ids in `strugglebus.paint.v1`. So no key can
  collide with a stable id in any building store (rank ids now, OSM ids on
  feat/osm), and a re-bake that renumbers buildings and drops their store keeps
  the landmarks' paint. `PaintState(count, slug)` loads both; `register` and `set`
  route by key type (a string is a landmark); `resetAll` clears both. (Pre-merge
  branch builds saved `lm:` keys in v1: the constructor moves them over once.)
  Never rename a key (`'lm:sutro'`, `'lm:transamerica'`, `'lm:coit'`, `'lm:ferry'`).
- **Every spatial index goes through `City.indexRef(ref)`**: the centroid hash
  and the area index (`areaCells`), which every gameplay query reads (pick,
  blast wave, line of fire, `buildingAt` / `roofAt`). An index added later must
  be filled there too (one line).
- **Area queries with landmarks**: `buildingAt` and `buildingAbove` rank a
  landmark by its own surface at the point (`ownTop`: -Infinity where nothing of
  it stands), not its top, so baked buildings inside a hull (the transmitter
  building between Sutro's legs) win where their roof is higher, and nothing of
  Sutro is in the line of fire between its legs. `roofAtPart` (where a shot on it
  lands) falls back to the obstacle surface there (a roof, a crown, the ground),
  never Sutro's base height under a roof. The facade's prop stamp
  (`City.stampProp`) skips landmark refs: a landmark's one-record tile is its
  hull at its top, which would raise an invisible wall over the whole Ferry hall
  (78.5 m) and Coit's base (155.7 m); its real surface is its `PropBox`es in the
  grid and `landmarkSurfaceAt` in `surfaceAt`.
- **The material**: `LandmarkKit.build(look?)` gives each landmark its own
  material (own uniforms, one shared program); its shader calls
  `lmVertex(position, aPat)` (paint texel, the buildings' pop scaled by
  `config.bloom.landmarkPop`, wobble) and `lmPaint(ramp, lo, type, aPat, y,
  worldPos, n, mpp)` before `sbWrite`. A prop outside the kit spreads
  `landmarkPaintUniforms(look)` into its uniforms and includes
  `GLSL_LM_PAINT_VS` / `GLSL_LM_PAINT_FS`. `bindLandmarkPaint(object, ref, { ride? })`
  binds a prop to any building's texel (181 Fremont's spire to its tower);
  `ride` (`uLmBox.w`) = something on the CPU moves it with its building's pop
  and wobble (SpireRide), so `lmVertex` skips its own: it never pops twice.
  `uLmBase` (the bound building's ground) starts the glint's sweep.
- **The glint** follows the buildings' contract (`buildingMaterial.ts`):
  `lmPaint` returns `glint = uGlint.x + uGlint.y * sweep`, the sweep timed from
  `uTargetT` and measured up from `uLmBase`, and the shader adds it to the final
  light after the painted mapping (a full ramp step, `glintLift` 0.13); a prop
  bound to a tower sweeps in step with it.
- **Plain trim** (pattern 0) paints white (gilt at level 3) on walls only; a
  plain up-facing surface is a roof and takes the hue at level 1 (turf from
  level 2), as the buildings' roofs do.
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
  The aim (`Aimer`, polish/feel's): the altitude ray hits landmark surfaces
  (`surfaceAt`); the pick finds a landmark through the area index; in
  `Aimer.occlude` a landmark target's chord ends at most `F_CLEAR` under the bus
  (`ey = min(roofAtPart + 0.5, y0 - F_CLEAR)`: its surface at the aim point can be
  100+ m above the bus) and the landmark itself may take the shot on its own
  face (`ref === target` is skipped only for baked buildings), the face found
  where its own surface (`landmarkSurfaceAt`) rises over the chord, not at its
  hull edge; for a landmark target the march runs on through the last
  `wallSkip` m before the landing (its face at the hull's edge, when the aim
  point is near its base), where only that face stops it. So the classic shot
  slams into the pyramid's face at the bus's height instead of landing high up
  its slope; a landmark standing in front of another target takes the shot as
  any wall does. `landmarkHit` starts the splash for a hit
  within 2 m of the hull (`edgeDistance`: a wall hit on a hull-edge face, the
  Ferry's front, lands 0.6 m outside it).
- The facade's heroes (`HERO_PROPS`, SF origin only): Coit Tower (`lm:coit`) and
  the Ferry Building (`lm:ferry`) get one `paintLandmark` each in main.ts's
  `heroLandmarks` loop, their key and sign name from the table's `paint` entry
  (their `k.build()` already has the paint; `k.build(look)` would add accents).
  181 Fremont's spire is no landmark: SpireRide binds it to its tower and
  `bindLandmarkPaint(spire, tower, { ride: true })` paints it with the tower.
- QA: `tools/landmarks.mjs <url> <out> [probe] [seq] [altitude] [sutro] [reload]
  [near] [views] [perf] [heroes] [collide] [spirepop]` (heroes: Coit / Ferry
  registered and picked, the spire bound to its tower's texel with `ride`;
  collide: obstacle grid + surface along the Ferry hall / nave / wing and across
  Coit's base, and a low flight down the hall's axis, on any build; spirepop:
  181 Fremont's pop from a fixed telephoto, on any build); `tools/facade-shots.mjs
  --only=hero-coit,hero-ferry,hero-transamerica,hero-181fremont --paint`;
  `SB_BLAST_START` / `SB_BLAST_AT` run `tools/blast.mjs` at a landmark;
  `tools/landmark-dev-shots.mjs` + `dev/landmarks.html` (one landmark, its texel
  from query params: level, hue, t, keep, hit, target; needs the vite dev server:
  dev pages aren't in the static build). The tools launch through `tools/browser.mjs`.
- Merging feat/supersplat: the `bloom` callback gains `flags`; keep
  `if (landmarkBloom(ref, hue, level)) return;` first and give the firehose
  (`flags & BLOOM_HOSE`) a lighter sparkle count per slice (it blooms a landmark
  many times a second).
- Merging feat/osm: keep `PaintState(count, slug)` and the landmark store as is
  (its own key, untouched by the v1 -> v2 building-store drop; only the building
  store's key changes); `City`: `new PaintState(manifest.buildingCount +
  LANDMARK_SLOTS, manifest.slug)`. A hit landmark signs its own name: use
  `(city.isLandmark(ref) ? null : city.streetNameAt(gx, gz)) ?? city.neighborhoodName(ref.hood)`.
  Check the OSM bake keeps the Transamerica, Sutro and HIDDEN hero footprints
  low or hidden (`landmarks[].clearRadius / clearHeight`).

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
