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
- The sun pass is depth only (the pipeline locks the color mask; shadows read
  the depth texture) and draws casters, not the detailed meshes: a detailed
  building tile casts through its proxy (`meshCasterTile`: positions only,
  one quad per wall, no undersides, nothing shorter than `CASTER_MIN_H`,
  which the shadow bias swallows anyway), on SHADOW_LAYER only, while its
  detailed mesh is on layer 0 only. Something with a cheaper stand-in should
  do the same (trees and rooftop gardens have depth twins). New mesher
  geometry must make its vertices through `Builder.vert()` and its walls
  and boxes through `wall()` / `prism()` / `quadF()` so the caster mode can
  thin it; a part the sun should not see goes in as a `quadF` facing down
  or a prism under `CASTER_MIN_H`. Mark a caster
  `userData.sunCull = true` (it needs a bounding sphere) and the sun pass
  skips it when its shadow, swept down the sun ray, can't reach the view.
- Prewarm: `main.ts` renders one frame with everything forced visible under
  the opening fog, so every program links before play. Anything that first
  appears mid-play (a new effect, a new material, a new instanced kind) must
  already be in the scene graph then (hidden is fine) or it compiles at its
  first use: a hitch exactly when it should feel best.
- Index buffers are Uint16 below 65535 vertices (0xFFFF is WebGL2's
  primitive restart index), Uint32 above.
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
  that walks tiles for rendering must handle both. A region going to full
  detail swaps a tile at a time (the merged mesh's `drawRange` drops each
  tile as its detailed mesh lands, in the merged order: `mergedEnds`), its
  ground last; tiles are adopted under a per-frame budget (`ADOPT_MIN`
  items, then while under `ADOPT_MS` and `ADOPT_BYTES` of new geometry:
  three uploads a mesh the first frame it is drawn).
- Streamed geometry keeps no JS copy after upload (`dropAfterUpload` in
  City): never read a building or ground mesh's attribute arrays back, and
  give any new streamed mesh its bounds before its first render (the worker
  sends them: `TileResult.sphere`). A restored GL context reloads every
  region (`City.reloadAll`).
- Far terrain is chunked (4 x 4 regions, box culled through
  `userData.viewBox`, all-water quads dropped) and a chunk hides once every
  region with land in it has its own ground in (`City.refreshFarChunk`); the
  horizon hills are 16 km chunks. Above `FAR_WHOLE_ABOVE` m of view height
  both draw as one mesh each instead (most chunks would be in view). A tile marked with
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
- **stableIds** key saved paint. Footprint buildings keep the rank of their
  source footprint (LiDAR work happens after ranking); row lots merged back into
  one building keep one lot's id and retire the others. Buildings only a LiDAR
  bake has get ids >= 2^30 derived from what they are (split pieces: parent id
  and rank; LiDAR-only towers: a hash of their position), so re-bakes agree.
  `node tools/check-stable-ids.mjs <old city dir> <new city dir>` checks a
  re-bake (also LiDAR bake against LiDAR bake).

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
`Splatter.barf(x, z, opts?: { drop?: number }): number` launches a projectile
(returns the game-clock impact time). `drop` = meters the bus is above the
impact; the radius is `blastRadiusFor(drop)` = `config.splat.blastRadius` x
(1 + (dropGain300 - 1) x drop / 300), so about x2 from 300 m up. Callers that
pass nothing get the base blast. `Splatter.radius(drop)` answers the same for
UI or camera code.

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
(`__qa.held` turns true); `__qa.topDown = { lat, lon, height }` looks straight
down; `__game.barfAtLatLon(lat, lon, drop?)` returns the impact time;
`__game.paintedNear(lat, lon, r)`; `__game.seedGround(n, lat, lon, spread)`
paints n saved blasts at once (a long session). `tools/blast.mjs` drives all of
it (perf, seq, top, reload, escalate, tap, drop, layouts, row, deal, heavy).

Dev pages: `dev/<module>.html` using `dev/harness.ts` (real pipeline + grey test
blocks + turntable camera). Screenshot with
`node tools/shot.mjs "http://127.0.0.1:5173/dev/<page>.html?dist=60&elev=30" shots/tmp/x.png`.
The dev server: `npx vite --port 5173 --strictPort --host 127.0.0.1`
(start it in the background if `curl -s 127.0.0.1:5173` fails).
Headless Chromium uses SwiftShader: correct but slow; don't judge perf by it.
