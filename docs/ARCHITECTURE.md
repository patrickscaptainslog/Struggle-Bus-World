# Struggle Bus — architecture and module contracts

Phase 1: solo, no server. One bus, one faction (Rainbow), real San Francisco.
Rule #1 is beauty: if something can't be made beautiful yet, cut it. Where the
brief is silent, pick the more beautiful option and log it in `DECISIONS.md`.

## Stack
Vite + TypeScript + three.js (WebGL2). No runtime asset files except baked
city tiles: every model is built procedurally, every sound is synthesized.
The build's floor is iOS 15.0, the first Safari with WebGL2: `build.target` is
`safari15`, workers included. A script that doesn't parse shows nothing at all
(no error, `boot().catch` never runs, the page stays fog-grey), so
`node tools/iosfloor.mjs <build>` must pass: it parses every chunk, fails on what
a target can't lower (a regex lookbehind) and lists APIs newer than 15.0 to read.

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
  per-vertex ramps via `setVertexRamp()` / `vertexRamp: true`, `rampAbove` for a
  height contour chosen per pixel across cells too big for a vertex to choose,
  `glow`, custom `vertexChunk` for animation, `noOutline`, `fogMul`).
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
  - `flags`: 1.0 normal (gets outlines), 0.5 = no outline (particles, cards). Never 0: the clear is 0, and that byte is
    the resolve's sky test (what nothing wrote is sky, at any distance). `uSkyCut` keeps the old depth test's 25 km as well, so
    frames don't change, until the far fade's `pipeline.setFar()` takes it away. From there the resolve's sliver burial reads the same flag: a neighbor with no fog is a surface if something wrote it, so hill rows over an unfogged tower's top stand (`stands()`). With the old cut in place it tells the sky by fog 0, as it always did.
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
- Every scene material ends in `sbWrite`. The G-buffer is one RGBA16UI target: eight
  bytes packed by `sbWrite` (one output: ANGLE on D3D11 compiles a second pixel shader
  per program at the first draw into a target with a second output, seconds of serial
  compiling), read through `GLSL_G_READ` (`sbColor`, `sbAux`, `sbLightAt`, `sbFogAt`).
  Nothing blends or filters it, and no other material may write it (a float output
  into an integer target is a dropped draw). The sun pass's own depth shaders are fine:
  its target is R8, its color mask locked off.
- A material (or an object kind) made after boot registers a warm-up source,
  or its program compiles in flight, for up to seconds (see Shader warm-up).
- Objects that cast sun shadows: `obj.layers.enable(SHADOW_LAYER)`.
  The bus and particles must NOT cast (the bus has its own drop shadow).
- The sun pass is depth only (`PixelPipeline.drawSun` locks the color mask, for the
  real pass and the warm-up alike; shadows read the depth texture) and draws
  casters, not the detailed meshes: a detailed
  building tile casts through its proxy (`meshCasterTile`: positions only,
  one quad per wall, no undersides: the same surfaces in fewer triangles, every
  shape still casts; a house's walls and roof on its ring to within 1 m, see "LOD 1
  rings"), on SHADOW_LAYER only, while its detailed mesh is on layer
  0 only. Something with a cheaper stand-in should do the same (trees and
  rooftop gardens have depth twins). New mesher geometry must make its vertices
  through `Builder.vert()` and its walls and boxes through `wall()` / `prism()` /
  `quadF()` so the caster mode can thin it. Mark a caster
  `userData.sunCull = true` (it needs a bounding sphere) and the sun pass
  skips it when its shadow, swept down the sun ray, can't reach the view.
- Index buffers are Uint16 below 65535 vertices (0xFFFF is WebGL2's
  primitive restart index), Uint32 above.
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
- **Streaming spreads its GL work and never shows half a swap.** three uploads a
  mesh at its first draw, so what a frame adopts is what it uploads, and what
  sits beside the bus would all upload at once the moment the view turned to it.
  So `City.firstDraw` draws every new mesh the frame after its adoption, in view
  or not, and adoption has a byte budget: `ADOPT_MIN` items, then while under
  `ADOPT_MS`, and never past `ADOPT_BYTES` (3 MB a frame; `ADOPT_BYTES_EAGER`, 16 MB,
  while `eager`: the opening, a restored context) unless one tile is more. A region
  going to full detail prepares tile by tile (`prep` items: `prepTile` makes the
  detailed mesh, its caster and the 4 m ground, and gives them that first draw
  unseen: `City.ghost`, every fragment failing the depth test); `swapRegion` then
  only commits, in one frame. Going coarse is one item (a merged mesh is 1-4 MB).
  While `detailHold` (a turbo gear) prep and swap items wait. One region unloads a
  frame. A mesh with a dropped-array or a new layout goes through
  `buildingMesh()` / `casterMesh()` / `groundMesh()`.
- Streamed geometry keeps no JS copy after upload (`dropAfterUpload` in
  City): never read a building or ground mesh's attribute arrays back, and
  give any new streamed mesh its bounds before its first render (the worker
  sends them: `TileResult.sphere`, computed as three does, so culling draws what it
  drew). A restored GL context reloads every region (`City.reloadAll`).
- The scene, `city.root` and every `TreeField` have `matrixAutoUpdate` off: a parent
  that recomposes forces its whole subtree. Only what moves updates; a static object
  placed at a transform calls `updateMatrix()` / `updateMatrixWorld()` once. The
  pipeline updates the graph once per frame (three would at each of its two renders).
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
  holds a ramp id). `RAMP_COUNT` is 64 rows (an 8x64 RGBA8 texture, 2 KB):
  0-19 core; 20-23 world materials (GLASS, STONE, GRANITE: tower facades;
  BRIDGE_ORANGE: painted bridge steel, the Golden Gate); 24-31 reserved for the
  faction ramps (MAGENTA 24, CYAN 25, AQUA 26, PEARL 27, MOSS 28, BIOLUME 29,
  FAE_VIOLET 30, SILVERBARK 31: docs/specs/STAGES.md 3.4 rule 7); 32-46 the sky's
  and world travel's, named in `Ramp` (SKY.md 4, Rows: nothing in the day's frames
  reads them); 47 up spare. Claim a reserved row by adding its name at that number.

## Shader warm-up (READ THIS before adding a material or a new kind of object)
`src/render/warmup.ts`. On a cold visit the GPU program cache is empty, and
on Windows (ANGLE on D3D11) each program compiles on the CPU, the building's
for ~4 s; compiled at its first draw it freezes presentation. So nothing may
compile in flight: at boot every program compiles, in parallel
(`KHR_parallel_shader_compile`, a few at a time so the browser's own raster
still gets compile slots; the longest first in half the lanes, the shortest in
the others), then draws once into the target it really draws into (G-buffer,
sun map, glow / resolve targets; never the canvas). The first frame waits for
it, for far.bin and horizon.bin, and for far16.bin's short grace ("The far raster";
the page shows its fog-grey background meanwhile); the
opening starts with that first frame. Every synchronous GL query the warm-up
makes (link status, uniform tables) waits behind a fence round trip, so the
main thread never blocks on the GPU process.

What it warms:
- **The live scene** (`warm.add(scene)` once boot has built it, again after
  far.bin): each object the way the pipeline draws it: its own material on
  the camera's layers; on `SHADOW_LAYER` the sun pass's override material, or
  its own when `allowOverride = false` (tree, sprout casters).
- **The post passes** (`PixelPipeline.warmObjects()`).
- **Registered sources**: `registerWarm(name, () => objects)`.

A warm draw has to be the real draw, not only the real program: a Metal render
pipeline is keyed by the program and the target's format, the color write mask,
blending and the topology class, and each new key builds at its first draw. So the
sun's proxies go through `drawSun` (mask locked off), and each picks its own program
at its draw (`needsUpdate` in `onBeforeRender`): three picks a material's program
again only on some changes, a normal attribute isn't one, so on the shared override
the position-only casters' program would compile and never draw.

**The rule: anything that makes a material, or an object of a new kind, after
boot registers a warm source**, at module load (`registerWarm('trees', ...)` at
the end of the file) or in the constructor that owns the materials
(`RoofSprouts`). The source returns one object of each kind exactly as the real
code makes it, through the same functions: the same material function (same
defines, side), the same object class (`Mesh` / `InstancedMesh`, with or
without `instanceColor`, `Points`), the same geometry layout (attribute names,
array types, item sizes, normalization: ANGLE compiles a vertex variant per
layout, e.g. the building's Int8 normals and Uint8 `aMeta`) and the same layers.
Uniform values and geometry contents don't matter: the warm-up draws a
one-triangle proxy with that program key and layout. Build the source with the
helper the real code uses (`buildingMesh()`, `groundMesh()`, `farGridMesh()`,
`makeSkylineMaterial()` in City.ts; `TreeField`; the sprouts' `Batch`;
`LandmarkKit`; the bridges' `Kit`) so it can't go stale silently. Today:
`city` (a building tile, a tile's ground, far terrain, horizon, skyline, and with the far field on the raster's far ground, boxes and tower skyline),
`trees` (both levels of detail and the casters), `roof sprouts` (every
element type and its caster), `landmarks` (plain and with accents), `bridges`, and with the held hour `lamps`.
- A source registered after the warm-up finished still warms (in the
  background, before its first draw only if there is time): register early.
- The warm-up never disposes its materials, so the programs stay alive: a
  material made later from the same code reuses its program.
- No `onBeforeCompile` / `customProgramCacheKey` unless the source makes the
  same key; `SkinnedMesh` / `BatchedMesh` aren't proxied (it warns).
- **Check it**: `node tools/warmcheck.mjs <url> out.json` (cold load, the
  opening, a climb, three blasts on one building for the sign and the level 2
  and 3 gardens, the landmarks from altitude) must report
  `programsAfterWarmup: 0`, no frame or long task over 100 ms after ready, and in
  `firstDrawsAfterWarmup` only the upscale onto the canvas (frame 1: nothing warmed
  may reach the canvas). `__game.warm.report` holds the counts and timings.

Boot order (main.ts): index.html's inline script starts city.json, far.bin
and horizon.bin before the game's script loads (`bootFetch` hands them over), each
with the data's version in its URL (`__sbDataV`, see "Re-baking a city"). far16.bin
it leaves for `City.loadFar` to start, once those two are in ("The far raster").
`boot()` starts with `pipeline.checkTargets()`: GL only logs a target the device
refuses, and the game would run on under a black frame, so the G-buffer and the sun
map are asked for their status first, while the GPU process has nothing to do (the
query is synchronous: 0.1-0.4 ms there, up to 35 ms behind the warm-up), and a
refusal is one line on the fog-grey page through `boot().catch`.
`city.prime()` posts the opening's whole want-list at once (up to 10 regions in
flight while `city.eager`, i.e. until the first ready frame; 2 after). Only what
the opening shows is built before the first frame (the bus, the Golden Gate);
the other landmarks go to the `later` queue (built while the warm-up waits,
else one per frame early in the opening; ready waits for them). The opening's
4.2 s run on the wall clock from the first frame on screen (the 15% hold until
the first region lands stays), with each step capped at 0.25 s: real time down
to 4 fps, but a tab switch or a long stall moves the reveal 6% at most. It holds
with the game (`held`: iOS's motion sheet, a restored context still covered). Once
it has been seen through on a device (`strugglebus.opening.v1`), a tap skips it:
the same reveal in ~0.7 s, and that tap doesn't splat (`input.onTap`; a toast says
so until the tap, and never after one landed in the grey). `later`'s first item makes and closes an AudioContext: Chromium's audio
backend starts with the first one, 120-180 ms on the main thread, and that must
not be the first touch.

**The data credit** (`src/ui/Credits.ts`, ODbL): one small note on every load, from the frame the first region is in, ~6 s
on its own clock: not the opening's, so a tap past the opening or `?skipintro` shows it the same. Pixel art like everything
on screen: `HUD_SMALL` in palette colors with an ink outline, 2 CSS px per UI pixel, on whole CSS pixels, stepped in and out
like the HUD's chrome; two lines on a phone (`splitLines`), one on a wide window, more when a longer credit needs them
(`creditLines`: none of it runs off the screen), laid out again when the window turns. `uiText` sets it for the bitmap fonts,
the settings page too: capitals, no accents, (C). A credit with a letter those fonts lack (Japanese, Cyrillic, an Ø) goes up in
the system face instead: a licence credit can't lose a letter. Never a permanent HUD;
settings' MAP DATA (a phone's top-right button, Esc on a desktop) and the tuner list every credit in `city.json`
(`attribution`, then `credits`) at any time. `?nohud` (a capture) shows none.

**A lost GL context** (a GPU reset, memory pressure on iOS): `webglcontextlost`
stops the game and hides the canvas (the page's fog-grey shows); on
`webglcontextrestored` the warm-up runs again from the top (a new `WarmUp`, every
program compiled off the main thread), `City.reloadAll` drops every region (their
meshes have no JS copy) and they stream back eagerly with the game clock and the
opening standing (`covered`) until the city is in. `__game.loseContext()`, `restoreContext()`;
`node tools/contextloss.mjs <url> <dir>`.

## City data (bake -> tiles -> meshes)
`tools/bake/bake.py <slug>` turns footprints + DEM (+ an optional LiDAR point
cloud via `tools/bake/lidar.py`) into 256 m tiles; `tools/bake/pack.py` bundles
them into gzip'd 1 km regions. Layouts live in `src/world/tiles.ts`.
**The footprints, streets, land, water, trees and names are OpenStreetMap**:
`tools/bake/overture.py <slug>` extracts the city's bbox from the
Overture Maps GeoParquet release on S3 (row groups by their bbox statistics,
cached under `$SB_OVERTURE_CACHE`, default `tools/bake/.cache/overture`),
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
  parts only); a painted tower grows no setback gardens or onions on one (they'd
  hang inside it); `Group.top` (the flood / pop top) includes `roofH`. The roofs
  go through the typed Builder like every wall: `B.vert`, `quadF`, `triF`, so
  the caster proxy (`meshCasterTile`) casts them and the worker's `roofTops`
  sees them. How each part's roof is built (`roofKinds`, `RoofBuild`) is worked
  out once in the worker and travels with the tile (`TileResult.kinds`, the
  ref's `roofBuild`), so gameplay's heights and the mesh can't disagree. LOD 1
  builds the same roofs.
- **LOD 1 rings** (`ringKeep` in BuildingMesher): OpenStreetMap's footprints carry
  every jog of a parcel, 9.9 vertices a ring in SF against USA Structures' 5.7,
  and a coarse ring costs three triangles a vertex, twice with the sun pass. So
  LOD 1 keeps a ring to within `RING_EPS` (1.5 m, Douglas-Peucker round the ring,
  the front edges whole: the facade starts there). The nearest coarse wall stands
  500+ m from the lens (`DETAIL_RADIUS` x 0.8), a game pixel there is 0.6-0.75 m.
  A facade family keeps its ring: its columns land on the corners. Gameplay and LOD 0
  never see this. The caster proxy does the same for a house at `CASTER_RING_EPS`
  (1 m), walls and roof only: `meshBuilding` draws those on the kept ring and reads
  the whole ring (`whole`) for everything else. A rooftop box, a chimney or a gable
  stands from the ring's center and extent, so on another ring its shadow would fall
  where it doesn't stand (`feel-sim s_caster.ts` checks their corners in the proxy).
  Every shape still casts; a jog under 1 m leaves the outline of its shadow (1.3-4
  shadow texels: single game pixels along shadow edges). A tapering part keeps its ring.
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
  unmapped land), 10 ROCK (the top 4 bits are free: the held hour's lamp pools, "The held hour"; read a class with `& 15`). Streets are their centerlines buffered to their
  class width (`osm.OSM_DEFAULTS.roadWidth`), sidewalks 3.5 m beside streets
  that have them, the sea is what OSM's coastline land polygons leave out
  (where the DEM is low), blocks of mostly non-residential buildings are
  PAVED lots instead of yards; under buildings: SIDEWALK, as before.
  `terrainMaterial.ts` shades the new classes with existing ramps (palette
  unchanged); the far grid ('SBF1') carries the same codes (only WATER is read).
- **The shore is the class texture's.** The bakes lay water under the open plane (`WATER_Y`, -0.6 m; baked water -0.9 to -1.1)
  and the ground mesh is 8 m coarse, so within 16 m of land the mesh stands at `SHORE_FLOOR` at least, 0.3 m over the plane
  (`meshHeights(tile)` in tiles.ts, what `heightGrid` and `makeHeightGrid` are given, on any tile with a height under that, water
in it or not; gameplay reads the baked heights; SF's bridge stand-ins' ground goes back to water first, `clearStandInGround`). Past that
  the plane draws the water: it is the cheaper shader. The ground's water pixels are the plane's: `GLSL_WATER`
  (`sbWater(worldPos)`) is one function of the world position, the same bytes from both, flags and surface id included, so
  nothing shows where one hands over to the other, and a lake is the same water at its own height. Water takes no paint and no
  shockwave. On a shore (water among the four
  nearest texels, land too) the water's share of the 10 m square around the pixel decides, bilinear at its edges: the
  nearest texels turn a quay at a shallow angle to the 2 m grid into a staircase of 6 m runs and 2 m rises. The square's
  first moment (`side`) says it is a shore at all, water on one side of the pixel; a ring of pond or a footbridge has it on
  both, a share would erase it, and those keep the nearest texels (a strip under 3-4 m). Streets keep bilinear: a 2 m path
  wouldn't survive a share.
- Trees ('SBT1/2' records unchanged): OSM natural=tree points and tree rows
  (species -> kind: cypress / pine and eucalyptus / street tree, height ->
  size), then procedural trees **on evidence** (DECISIONS, Data: Trees;
  `bake.py` `TREES`, a config's `"trees"` overrides): park / woods trees on the
  11 m jittered grid with chance 0.85 x f, f = ESA WorldCover's tree cover in
  a 20 m window less the mapped trees' crowns, gated by what OSM's polygons say
  (`osm.tree_codes`: TREE_PARK parks / gardens / cemeteries from f 0.10,
  TREE_OPEN lawns / commons / meadows / grassland / wetland / golf / aerodromes
  from f 0.25, TREE_WOODS OSM woods at least f 0.6, TREE_SHRUB scrub / heath and
  TREE_NEVER pitches / playgrounds / fairways / beaches / rock / plazas /
  runways none; inside the green family the smallest polygon wins; Overture's
  coarse land cover (priority 0) lies under every OSM polygon and its barren
  says nothing, so only OSM's 'never' clears the woods and parks over it), on
  grass or forest ground away from buildings, slopes under 45 degrees; street
  trees as before: on 30 % of residential frontages' sidewalks where no mapped
  tree stands within 9 m (no WorldCover gate: its 10 m pixels miss most single
  street trees). The old path (no `"overture"`) keeps its grass rule, slope
  limit and `treeLatMax`.
- **ESA WorldCover 10 m** (v200, 2021, CC BY 4.0; `tools/bake/worldcover.py`):
  every city's land cover, read from the public S3 bucket's 3 x 3 degree COGs
  (`ESA_WorldCover_10m_2021_v200_<N|S><lat><E|W><lon>_Map.tif`, the tile's
  south-west corner) through GDAL /vsicurl: only the city's window (range
  reads of the COG blocks), bboxes spanning tiles mosaicked on the global
  1/12000 degree grid, a missing tile is open sea. The crop is cached as
  `tools/bake/.cache/worldcover/<slug>.tif` (`overture.py` fetches it with the
  extracts and exits 2 when it can't; `bake.py` checks it right after the city
  frame, before the DEM, and fails there; `bake.py` and `qa.py` grow it when a
  bake needs more) and resampled
  (nearest) onto the bake's local frame at 4 m (`local_grid`). Classes: 10 tree
  cover, 20 shrubland, 30 grassland, 40 cropland, 50 built-up, 60 bare /
  sparse, 70 snow / ice, 80 water, 90 herbaceous wetland, 95 mangroves (trees
  for the bake), 100 moss / lichen. `"worldcover": false` in a config bakes
  without it (procedural trees only in OSM woods). `city.json` names it in
  `source` and `credits.worldcover`; the tuner lists `credits` after the ODbL
  attribution.
- **Bake QA** (`tools/bake/qa.py`): `bake.py` runs it after every OSM bake
  (its arrays freed first; `--qa=0` skips, `--qa=warn` reports without
  failing), standalone `python3 -I tools/bake/qa.py <slug> --dir=public/city/<name>`
  checks any baked dir. Per 128 m cell it compares the bake with WorldCover:
  procedural park / woods trees with no WorldCover tree pixel within 20 m
  ("unsupported"; 8+ in a cell: "trees on open land"; street trees along
  frontages are reported beside the mapped street trees, not checked:
  WorldCover misses 42 % of SF's mapped ones), wooded park / woods /
  open-space cells
  left under 8 trees / ha ("missing trees"), the baked water share vs
  WorldCover water (80) ("water", >= 50 % of a cell apart), baked sand vs
  WorldCover bare ground ("sand"); WorldCover woods over OSM scrub / heath are
  listed as information. Thresholds: `qa.QA_DEFAULTS` (a config's `"qa"`
  overrides); a check whose share exceeds its max and whose count reaches
  `minFlagged` (5 cells) / `minUnsupported` (50 trees) is a FAIL: a
  `!!! QA FAIL` block and exit 3 (the
  bake's outputs are complete; `pack.py` packs them). Writes `city.json`
  `stats.qa` (pass, failed checks, values, tree counts by source, the largest
  parks) and `tools/bake/.cache/qa/<name>/`: `report.md` (the checks, the 30
  worst cells with lat / lon and a reason, the parks table), `cells.png` (the
  frame with every flagged cell) and `park_<k>_<name>.png` crops of the ~8
  largest parks / open spaces: left WorldCover with every baked tree as a
  black dot (dots on yellow grassland, grey bare ground or blue water are trees
  on open land), right the bake's ground classes, buildings and trees by source
  (blue mapped, dark green park, orange street) with WorldCover's tree cover
  outlined in lime. Read the table first (per park: WorldCover tree share,
  trees per ha, procedural trees on WorldCover-open land, which should be ~0),
  then the crops.
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
  clutter; a mapped roof on a bigger building lifts each cell to the drawn roof
  at its center and corners, `roofSurfaceY`: `roofTops` in the worker,
  `City.adoptTops` takes the larger of two numbers per cell; the bake's grid holds
  a mapped roof at 80 % of its rise), rooftop gardens / Hundertwasser crowns (`City.raiseRoof(rect,
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
- **stableIds** key saved paint. OSM bakes (`bake.py` `ID_RANGES`, `IdAlloc`):
  every id derives from its source record, never a rank: [0, 2^31) FNV-1a of
  the OSM id ('w123', 'r45'; a multipolygon's separate pieces 'r45#1'...),
  [2^31, 2^31 + 2^29) other Overture footprints (GERS id), [2^31 + 2^29,
  3 * 2^30) USA Structures fallback lots 'u<BUILD_ID>:<lot>' and pieces LiDAR
  splits off them, [3 * 2^30, 2^32) LiDAR-only towers (a hash of their 8 m-grid
  position, as before); a hash collision probes to the next free id of its
  range in key order. So a building keeps its id across re-bakes and other
  buildings coming or going never shift it: the key a shared-paint server can
  use. Which store a city opens follows its DATA, not the code (`idSchemeOf`:
  `city.json` `"ids": "osm"`): an OSM bake saves in `strugglebus.paint.v3` (SF;
  other cities `strugglebus.paint.v3:<slug>`) and `strugglebus.ground.v4:`
  (`strugglebus.ground.v4.<slug>:`), and drops that city's `paint.v1` / `v2` and
  `ground.v2` / `v3` on load, never applied (v2 / v3 are skipped on purpose: a
  build before `"ids"` wrote them whatever the data was). Only a landmark's name
  key means the same in any bake, so one left in a dropped store moves to the
  landmark store. An `"ids"` this code doesn't know keeps building and ground
  paint for the session only, and an old rank bake keeps `paint.v1` / `ground.v2`
  and never touches the new stores. Old (non-OSM) bakes: footprint
  buildings keep the rank of their source footprint; row lots merged back into
  one building keep one lot's id and retire the others; LiDAR-only ids >= 2^30.
  `node tools/check-stable-ids.mjs <old city dir> <new city dir>` checks a
  re-bake of either kind (it refuses to compare an OSM bake with an old one).

## The far raster (`docs/specs/far-field/SPIKE.md`)
One image of a whole city, `far16.bin`, baked from the tiles already in `public/city/<slug>/` by `tools/bake/farmap.py` (no city names, no
new sources; run it after a re-bake): class, tone, height, paint (empty), wall share, wall lo per 16 m cell, in an affine frame with a body
id. Reader: `parseFarRaster` in `tiles.ts`. There is no light in it, nothing keyed to a time of day: the sun is live. Tone is brightness, a
pre-light `lo` on one ramp, so filtering keeps it and a far pixel flipping between a roof and a street changes hue, not brightness; class
picks the ramp (mode mips: a mip is still a class, never a blend).
- **On, for any city whose `far16.bin` arrives.** Nothing here knows a city's name; SF is the only one released. The producer passed all of it together on the phone: the oblique raster, the boxes and the fade. The flags below name those parts. `config.far.on` (one line, not a tunable: no saved value can turn it) and `?nofar` turn all of it off: the file isn't asked for, the far plane stays at 30 km, and frames are the old path's but for the always-on ramp and horizon fixes (`flat` `vRamp`, the far mesh's water vertices on the land ramp, `rampAbove`). A tool that spells any of `?farmap`, `?farblocks`, `?farfade` gets exactly those. A city with no file draws what `?nofar` draws, with the raster's three programs warmed for nothing (they have to be, see below).
- **The first frame doesn't wait for it.** `__sbBoot.far16` is the one boot download handed out unstarted: `City.loadFar` starts it when far.bin and horizon.bin are in, because a low priority doesn't keep it off their bandwidth or the script's, not on HTTP/1.1 and not in every browser (started with them at 150 KB/s, the first frame came 5.8 s later). It gets `config.far.graceMs`, and as long as the warm-up holds the first frame anyway. In by then, it is part of the first frame. If not, that frame goes with the plain far ground, the 20 km fade and the 30 km far plane, and the raster goes in where it lands. `City.landFar` is one path for both, a step a tick: the boxes off to their worker, the textures one upload at a time, `farTowerLooks`, then `buildFar`, with what it replaces disposed that same frame, and `onFarRaster` moves the fade, the far plane and the water plane (`fitWater`). `registerWarm('city')` holds the raster's programs, so nothing compiles in flight. `__shotReady` waits for a late raster (`city.farLate`); `city.busy`, `city.eager` and the game don't. `farFade()` runs after the saved tuning, whenever it runs, so a saved `fog.clearFarFull` can't take it back.
- `?farmap`: the far mesh draws the raster (`farMaterial.ts`, `City.buildFar`), stands on true ground, sinks 40 m under loaded tiles (the
  mask's 255; `FAR_STAND_INS`' tiles hold 200, which hides their boxes and sinks nothing), and water beside land rises to the plane so the
  raster draws the shore. Its `lightOffset` attribute carries the walls' lo, per 64 m vertex.
- `?farmap=oblique`: and the walls a grazing camera sees, lit live, facing it, so the far city turns with the sun.
- `?farfade`: fade to 34 km (`config.fog.clearFarFull`), far plane 36 km, the sky by the clear flag alone, and a water plane sized to end inside the fade's full fog from anywhere in the frame (60 km without the flag).
- `?farblocks`: the height plane as boxes. `farBlocks.ts` merges equal runs of roof cells row by row, in `farWorker.ts`, one job at boot: tops in 4 m steps over sea
  level, so a box never lies on a hillside; only a ROOF cell makes one (a footprint over half of it; less than that a building is tone); no box crosses a 256 m
  tile, so `uMask` hides exactly what a tile replaces, and a chunk is a region, one draw, none at all once every tile it has boxes in is loaded. `City.farBlocksFrame`
  lands eight a frame (`busy` holds until they're in). A box is six triangles, its roof and the two walls that face the camera, mirrored per instance
  (`side: DoubleSide`). 16 bytes an instance, on an `InstancedBufferGeometry`, not an `InstancedMesh`, whose matrix would be 64. Past `far.blockSink` a box sinks,
  gone by `far.blockEnd`. No light in the data: each face is lit in the vertex stage by `sbLight`'s formula (a box stands past the shadow window, so no shadow sample) and
  written with `sbWrite`; the fragment stage only packs. Each wall has a lit bit and a wake byte, hashed from where it stands and the chunk's seed: `far.blockLit`
  is night's share, 0 until there is a night. Warm-up: `registerWarm('city')`, under the flag.
- `?farblocks` also puts far.bin's tall boxes on their towers' facade families: `far16.bin`'s tail holds `styleFor`'s inputs per box (stable id, arch, area, height, centre),
  `farTowerLooks` runs the mesher's own rule on them, `makeFarTowerMaterial` draws the family's ramp with its windows in the mean, glass mirroring the sky.
- `config.far.fit` scales the far band's fit to the tiles that replace it (`CLASS_FIT`, `FIT_ROOF`, `FIT_WALL`, `FIT_STREET`, `FAM_LO`), a pre-light lo per class, from `tools/far/calib.py` on
  hold-still swaps. The means alone flatten the band, so the boxes' and the streets' are set by contrast as well (`tools/far/swapstat.py`'s `swapped`, luma std over the rows that swapped): `FIT_STREET`
  takes the roofs' brightness out of the filtered tone between the boxes, parks left alone, and goes with them between `far.blockSink` and `far.blockEnd`. `?fardebug`: the far ground and the boxes write their class as a ramp, for that tool.
- `?loadr=<m>`: `config.city.loadRadiusHigh`, the streaming radius up high (1900).
- `?farnearest` (class with no mips), `?farbias=<n>` (the class map's mip bias), `?farchunk=<tiles>`, `?fartop=<m>`: tests. `config.far`: `toneK`, `wallK`, `classBias`, `fit`, `blockSink`, `blockEnd`, `blockLit`, `blockGlow`.
With `?nofar` none of it loads and no program is added. tools: `shots.mjs --q= --seq --pan --descent --set= --drop=` and its `hold-<pose>` views (the hold-still swap at four suns), `altitude.mjs --q= --ceiling --log-far`, `fps.mjs --q=`, `framecost.mjs --set=`, `warmcheck.mjs --late=`, `loadprofile.mjs --latency=`, `tools/far/` (`swapstat`, `calib`, `panflip`, `bandflip`, `land`, `seatop`, `rowflip`, `metrics`, `pal`, `absent`, `numbers`, `mergetime`, `sheet`, `ab`).

## The held hour (`?hour=blue`, `docs/specs/sky/SKY.md` slice S1)
The whole game under one held blue hour: no clock, nothing moves. `src/sky/flag.ts` reads the flag once, as the modules load. **Flag off is the law:** no new fetch, no new
program, no shader source that differs by a byte, so every line of GLSL the hour adds goes through `held()` or `heldOr()`, at the end of a line. Materials never ask at run time.
- **`config.sky`**, a section of the tuner only with the flag. The switches are kill switches, live: `table`, `key`, `rows`, `paint`, `beam`, `glow`, `far`, `windows`, `lamps`, `pools`, `bridges`,
  `farLights`. All of them off under `?hour=blue` draws main's frames, exactly. The numbers below them are the one hour held.
- **A table** (`src/sky/SkyTable.ts`, `BLUE_TABLE`): one colour per (ramp, step) for the whole frame. Every ramp runs dark to light, sky rows too. FOG is the haze there, its step 4 the
  far side's horizon; the sky takes SKY_LOW. `HeldHour.update()` writes it into the palette texture when a switch moves, and runs at the end of `updateSun()` every frame.
  The live sky blends eight (`TableBlend`; noon, morning, golden, sunset and dawn in `SkyTables.ts`, written by `tools/sky/tables.py`): by the Sun's height, setting and rising
  crossed by its hour angle, in OKLCH by the short arc with the brown clamp, into the palette when the Sun has moved 0.05 degrees. The hour comes up as a weight
  (`flag.ts` `hourK`, `byHour`): what read `hourUp()` as a switch reads its number lerped from the day's.
- **Light.** The afterglow: the sun's azimuth held at +8 degrees, `uLight` mid-range (a .34, b .20, k .20), the sun pass off, the table carrying the dark. `sunR`, the windows' glint and
  the water's swell take `uLight.x / 0.52`.
- **Sky** (`src/render/skyResolve.ts`): 16 bands in four rows of the live table (`uSkyRows`), by the clear flag. The far side at height a reads as the sun side at 8.2 + 8.2 sqrt(a + .5), so
  one height slides between the two with the azimuth: the bands bend toward the sun, and the rows hand over where their colours meet, with no seam. Alpha 0, dither `dsk`. `uSkyHaze` is what
  `GLSL_SKY_LIGHT` returns in its place, for both its users: the light the far fade ends on, and so the FOG step of the horizon.
- **Paint** is graded in the table, and the resolve holds paint rows at or under `uPaintCap` outside a glint: what glows at 0.6 or more, or isn't a surface. A halo lifts to the cap.
- **Beam.** `uBeamGain` is the old 2.6. Its reach and width go back to the day's with the vista: up high it lights nothing.
- **Far field.** All of it writes through `sbWrite` and reads `uLight`, so the table reaches it for free. What the hour adds: `config.sky.farFit` (the fit was made with a sun's shadows in it),
  `farGroundLo` (the plain far ground, with no raster), the horizon's hills on RIDGE, sand on SAND, and the night path below.
- **Windows** (`buildingMaterial.ts`, `uLit`, one held share: there is no clock). One stable threshold per window, a hash, never a timer. Form by distance: a real pane near, LIT row, steps 5-6 and a little
  glow (`uLitGlow`); on a ribbon (`mppB > uHouseRibbon`) `cell.x` is 0, so a whole floor wakes; on a tower past its family's own pane gate (`panes` in `towerFacade`, each the test that family's code opens its panes with) a run of a floor, 9 m a run, through `rhythm()` at least 4 px apart, never on paint (`gLit`); past
  `uHouseFlat` no pattern at all: a face is lit or not, by a hash of the building and the way it looks (`faceLit`), one dim FARGLOW tone. A glass tower wakes three panes together, an office: one by one a
  curtain wall is static. `glow` is 0 past the panes, so share x glow on far surfaces is 0.
- **Lamps** (`src/sky/Lamps.ts`, `lampData.ts`, `lampLoad.ts`, `lampWorker.ts`). `lamps.bin` (`tools/bake/lamps.py`; 'SBL1' in lampData's reader) holds where they stand, a rule on the bake's road list, every
  drivable class but `service`, named or not. `main.ts` asks for it behind far.bin, only with the flag: nothing waits for it, `__shotReady` does. A worker reads it, takes each lamp's height from far.bin's grid as
  the far mesh stands on it, and sorts the list by tile. One `Points` for the whole city, far band included, LAMP row, depth tested, 8 bytes a lamp, its `position` four i16 in the list's units (`gl_PointSize` is
  written first, on every path: on iOS a point's size is undefined otherwise). A lamp stands `lampHead` over the ground and `lampLift` per metre from the lens, because the far mesh's 64 m cells stand off its 32 m
  heights. Past `lampThin` a stable hash thins them with distance. No lamp has glow: a pixel is under the halo's gate at any glow, and thousands far off would only boil it. Nothing past the bake's bounds is
  in the file, so no far shore lights up. The hash in the shader is also what S2's wave will threshold (`lampShare`).
- **Pools** (`Lamps.stamp`, `City.poolFrame`). The top 4 bits of each byte of `tr.cls` are a lamp's pool; classes stop at 10, so every CPU reader of `cls` masks with 15 and terrain's `cls()` does too. `City.setPools`
  puts every loaded tile on a list when the lamps land, `addTile` puts each new one, and one tile a frame stamps: one path for a cold load and tiles already up. The bytes go up again on whichever texture draws
  them: the tile's own (16 KB, `needsUpdate`), or its square of a coarse region's (`uploadRect`). `busy` and `__shotReady` hold until the list is done; the cover and `ready` read `loading`, which leaves it out: a pool lifts a tile already drawn. In the terrain shader the four class fetches double as the pool's, bilinear,
  then cut, so its edge is a clean curve and not 2 m stairs: on PAVED, SIDEWALK, PLAZA and PATH one ring a step up its own ramp (`uLamp`), and LAMP step 2 at the lamp's feet. Paint lies over it. Pools fade with
  distance (`uLampFar`): a pool past that is a few texels on a pixel. With the flag off `pools` stays null and no byte is touched.
- **Spans.** `bridgeLights(kind, pts, deck, spacing)` in `Bridges.ts`, from the one deck list and the kit's sizes: both sides of the roadway at deck height just past its edge, so they show from over and under, and
  on each tower top, both legs. `Lamps.setBridges` makes them a second `Points`, there from the first frame: the opening needs them before lamps.bin lands.
- **The far city at night** (`farMaterial.ts`). All of it one dim tone, FARGLOW step 3, what a near face shows past the ribbons, so the near and far bands meet: a far box lights a wall by its lit bit and its wake
  byte (`sky.farBoxLit` over `far.blockLit`; the worker hashes them with the chunk's seed); the far skyline a face, by a hash of where it stands (`uFarFace`); the far ground a built cell, by class (ROOF), the wall
  plane (mean height / cell, clipped: the raster's height doesn't go to the GPU) and a hash of the cell (`uFarLit`). That cell doubles with distance by the frame's own derivative, so it never stands under a pixel.
  share x glow: 0.2 x 0.2 on the boxes, at most 0.2 x 0.25 on the ground, 0 on the skyline. The far band's streets are the lamps'.
- **`tools/skycheck.mjs`**: SKY.md section 8's hard fails read off real frames, against the palette the page really holds and today's frames of the same poses. `tools/shimmer.py --flat=` counts the sky's rows as
  one colour for it: a sky with bands holds still on the screen and pulled a band's fit off the world in front of it.
- **`?fps`** reads from a phone: fps, the worst frame of the last 300 (~5 s at 60 fps, ~10 s at 30), the resolve's link + first draw, and the hour. The two times are `WarmReport.resolveLinkMs` and
  `resolveDrawMs`, off the real warm-up, so no program is added: from the resolve's linkProgram to the round that finds it linked (behind a fence, so to within a round, and with the
  other lanes compiling beside it), or without `KHR_parallel_shader_compile` to the end of its first synchronous query, where that link blocks; then the GPU's time over the post passes' first
  draws, where a Metal render pipeline builds. A browser that caches programs reads low on a repeat load.

## Bridges (`src/world/Bridges.ts`, SF's two hand-built kits)
The Golden Gate and the Bay Bridge's west span are kits placed on map data: `docs/specs/bridges/BRIDGES.md` is the plan, and its
step 5 replaces both with decks from data in every city. A hero may set its style, never its position.
- **The row.** In `tools/bake/cities/<slug>.json`: `points` (towers and anchorages, from OSM rows by id), `deck` (lat, lon, top per
  vertex, end to end of the roadway: those points and the carriageways' middle between them, tops from the LiDAR) and `supports`
  (plain blocks under an approach: lat, lon, across, along). The row's `note` names the ids, and says where the map holds no row: the
  Golden Gate's five Marin bents and the Bay's three land blocks stand on the deck's own line. `tools/bake/landmarkrows.py` is the one
  reading of those rows, the bake's and `relandmark.py`'s, and `city.json` carries them as `landmarks[].points`, `deck` (x, z, top) and
  `supports` (x, z, across, along).
- **One deck list.** `class Deck` reads `deck`: `at(station)`, `stationOf(point)`, `topAt(point)`, `yawAt(station)`. `makeGoldenGate`,
  `makeBayBridgeWest` and `bridgeObstacles` all take `(pts, deck, supports)`, so the mesh, the bracing, the cables and suspenders and
  the collision can't disagree. Moving a bridge is a change to its row.
- **Posts.** A deck post every 12 m or less, as wide as the deck + 6 m (`top` over any cable, `under` the underside - 1 m, `hard` the
  roadway + 1.5 m). Towers, anchorages and blocks are solid (`under: -Infinity`). "Under a bridge deck" below says how flight reads them.
- **Two meshes.** Cables sit in their own kit, outside the sun pass: their shadow lay along the deck as a wide stepped smear.
  Suspenders still cast. So a hero in view is one more draw.
- **Checks.** `node tools/spanfly.mjs <url> <out> <bay|gg>` reads the deck from that build's `city.json`, so its stations follow the
  data: a contact sheet of every end, tower and mid-span, and real flights square at the deck, level under it, and along under it
  into each tower and anchorage. It fails if the bus ever enters the deck's box, is lifted, comes up through the deck or jumps. It
  doesn't count frames inside a block.
- **The far field.** `far16.bin` is baked from the tiles, not from these rows. A row's change needs no rebuild,
  and decks are not in it, but it never sees `HIDDEN`, so a stand-in the near city hides stands in it. `FAR_STAND_INS`' tiles hide its
  boxes, and `clearStandInCells` gives its cells the ground around them as the raster lands (SF only). Rebuild it after `BRIDGES.md`'s step 5 re-bake, which removes them at the source.

## Re-baking a city
- **Bump `window.__sbDataV` in index.html with every re-bake** (`osm1` -> `osm2`). It goes on every URL under `/city/`
  (`dataQuery()` in City.ts). A re-bake keeps the file names and `vercel.json` caches them for a day plus a week stale, so
  without a new version a phone that played the old city runs the new game on old data, and on new tiles only where it
  never flew. A new header can't reach what phones already hold; only a new URL does. `node tools/redeploy.mjs <old build>
  <new build>` plays that phone: vercel.json's own headers on a local server, one browser context across the deploy, exit
  1 unless every file of the city the game asked for reached the new deploy. (Not run against a live Vercel deployment yet.)
- A hero's row needs no re-bake: `python3 -I tools/bake/relandmark.py <slug>` rewrites only the `landmarks` and `start`
  blocks of `city.json` from the city's config, through the bake's own `tools/bake/landmarkrows.py` (its own commit, and a
  new `__sbDataV`).
- `public/city/<slug>/` is generated: never hand-merge it, re-bake it (its own commit). A re-bake needs the Overture
  extract (`python3 -I tools/bake/overture.py <slug>`, ~2 min, cached under `$SB_OVERTURE_CACHE`), the city's WorldCover
  crop (`$SB_WORLDCOVER_CACHE`) and, for SF, the LiDAR cache (`$SB_LIDAR_CACHE`: the USA Structures LiDAR plan is still built
  first, so its cached rasters hit, and only the chunks OSM adds are rasterized on top). A worktree without those caches
  points the three variables (and `SB_DATA`, the DEMs) at a checkout that has them. A full SF bake thrashes an 8 GB laptop;
  Amsterdam took 8 minutes, most of it the extract. A region format change only needs `pack.py` on the raw tiles in
  `tools/bake/.cache/<slug>/`.
- The keep-outs: footprints within a landmark's `clearRadius` are capped at 8 m, with no LiDAR, no parts, no roof shape.
  A prop that replaces a mapped building hides it through `HIDDEN` (`maxTop` is the whole building's top: OSM's Ferry
  Building is 8 parts and 70.5 m, not two rows of lots). `facadeMat`, `facadeColor`, `roofMat`, `roofColor` are in every
  tile for the painted world (glass, brick, stone...); nothing reads them yet.
- Gable-end walls are `quadF` / `triF`, not `wall()`: wall subdivision and `remapU` don't reach them (they're small).

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
- `HIDDEN` footprints (the Ferry Building's mapped massing, Coit Tower's stand-in box, what OSM and the LiDAR
  make of the bridges) aren't meshed and aren't building refs (`City.addTile` skips them by the same
  test as the mesher: centroid in the box, height under `maxTop`); a prop draws
  them. An entry with `clears` has no prop boxes: `City` rebuilds its cells of the obstacle grid (its stand-ins' heights go),
  and `FAR_STAND_INS` keeps far.bin's boxes in open-water tiles masked for good (`City.maskedForGood`, the skyline's own
  mask; far.bin and the far code don't change). `trimBridgeTiers` drops the upper tiers `BRIDGE_TIERS` names
  in the worker (Fort Point keeps its walls, not the arch the LiDAR read over them). All SF only (`RegionRequest.sf`). `HERO_PROPS` (Coit Tower, the Ferry Building, 181 Fremont's spire) are
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
| World / bake | `tools/bake/*`, `src/world/City*.ts`, `src/world/BuildingMesher.ts`, `src/world/roofGeom.ts`, `src/world/tiles.ts`, `src/world/PaintState.ts` | baked tiles → meshes, paint state, mapped roofs |
| Audio | `src/audio/AudioEngine.ts`, `src/audio/audioWorker.ts` | see `AudioEngine` |
| Bus model | `src/bus/BusModel.ts` | see `BusModel` |
| Particles | `src/fx/Particles.ts` | see `Particles` |
| Street signs | `src/fx/StreetSign.ts`, `src/fx/pixelFont.ts` | see `StreetSigns` |
| Input + tuner + perf + credit | `src/game/Input.ts`, `src/ui/Tuner.ts`, `src/ui/Perf.ts`, `src/ui/Credits.ts` | see below |
| Props + landmarks | `src/world/Props.ts`, `src/world/props/*` | trees, Sutro Tower, Transamerica, Coit Tower, the Ferry Building, roof sprouts; landmark paint (`props/landmarkPaint.ts`) |
| Tower facades | `src/world/towerStyles.ts`, `src/world/buildingMaterial.ts` | facade families, icons table, hero props table |
| Game glue | `src/main.ts`, `src/game/*` | flight, camera, splat, bloom, persistence |
| Ground paint | `src/world/GroundPaint.ts`, `src/game/blastLayout.ts` | per-tile splat masks, blast shape + hue layout, shockwave ring GLSL |
| Super splat | `src/game/SuperSplat.ts`, `src/fx/SuperFx.ts`, `src/ui/SuperMeter.ts`, `src/audio/superSfx.ts`, `src/audio/superAudioCheck.ts` | hold to charge, mega blast, firehose, cooldown (see below) |
| Controls | `src/game/Controls.ts`, `src/game/controlPrefs.ts`, `src/game/Tilt.ts`, `src/game/Hybrid.ts`, `src/game/Turbo.ts`, `src/fx/Turbo.ts`, `src/audio/turboVoice.ts`, `src/ui/Hud.ts`, `src/ui/hudLayout.ts`, `src/ui/Coach.ts`, `src/ui/pixelUi.ts` | scheme + permission, tilt stick, thumb / tilt arbitration, turbo gears, turbo FX / voice, the HUD, its layout, the first run |

## Controls: the hybrid (tilt + thumb), keyboard, turbo gears
`src/game/Controls.ts` owns the scheme and wires everything below. main.ts
makes five calls per frame, in this order: `controls.preFlight(dt)` right
after `input.update(dt)` (the turbo drive writes `Flight.turbo`),
`controls.pose(pose)` before `bus.update` (strain: wheeze, squint; wide-eyed
at speed), `controls.afterPose(bus.root)` after the bus's position /
rotation are set (the rattle), `controls.frame(dt, realDt)` right after
`bus.root.updateMatrixWorld(true)` (effects, voice, HUD), and
`controls.fx.object.position.copy(particles.object.position)` after the
vista snap compensation (the contrail stays with the bus up high).

**The rule** (`docs/specs/hybrid-controls.md` is the design, with its numbers): the phone flies the bus
until a thumb flies it, a tap splats, buttons do what they say. There are no control modes: one gesture model
(the floating bungee), one layout. The tilt switch decides one thing: may the phone steer when no thumb is.

**The input contract** (`src/game/Input.ts`):
- `onTap(): void` a tap: a normal dragon-breath splat. A still press up to `inputTune.stillTapMs` (450 ms) on the
  screen, a quick wandering one, a second finger while steering, or a MEGA tap. `state.thumb` never fires one.
- `onChargeStart(): void` MEGA or Space held `config.splat.holdThreshold` (0.3 s, confirmed on a second frame); a
  press on the screen NEVER charges. `state.chargeHeld` = seconds since the press while charging, else 0;
  `onChargeEnd(heldSeconds, cancelled)` on release (cancelled: pointercancel, a lost touch, focus lost). One press at
  a time (`pressHeld`: MEGA or Space); a second source while one is held taps.
- `onTurbo(dir: 1 | -1)` shift a gear; `state.turboHeld` the boost.
- `onPress()` a gesture landed (the aim's press latch, glint == hit).
- `mode: 'touch' | 'keyboard'`. Tilt running is `controls.tilt.active`, not a mode.
- `state.thumb` a committed bungee thumb. `state.dragging`: a thumb, keys, or a non-zero tilt stick.
  `state.stretch`: the arbitrated stick, the same semantics as ever: Flight, the opening's climb lock, the homing and
  `__qa.sx/sy` don't know who wrote it. The aim thaws on a thumb, keys or a QA stick, never on tilt:
  `aimer.update` gets `(qaStick || st.thumb || keys) && !input.pressHeld`.
- The arbitration is one site, `Input.update`: keys (no thumb) > `input.mix` while live > the bungee's own stretch `b`.
  With tilt off `state.stretch` is `b`, bit for bit (`s_hybrid` row 1).
- HUD hooks: `splatButton(down, cancelled?, eventTimeMs?)` (MEGA), `turboShift(dir)`, `turboHold(down)`, `hudBlip()` (any
  HUD press or lift), `reachDown()` / `reachUp()` (TURBO, the tab, the toggle), `adoptThumb(e, keepPress, x0, y0, t0)`
  (MEGA's or the chip's finger becomes the thumb; it notes the pose with `mix.land()`, since no canvas touch-down did),
  `adoptedMove/Up` (its events if capture didn't move), `wakeMix()`.
- The opening (`main.ts` with `Controls`): nothing but the sheet holds it. `controls.sheetUp` (iOS's motion sheet) stands the
  game and the opening at any time; `controls.gearsLocked` and `controls.opening`, set per frame, queue a shift until the bus clears the gate and
  drive the first run. "Gate cleared" is `!opening && !gearsLocked`, true at fog end in a city with no bridge.

**The mixer** (`src/game/Hybrid.ts`, `TiltMix`, no DOM, tuner group "Hybrid"): phases `live | thumb | settle`, one flag
per owner (`thumbHeld`, `reachHeld`). An uncommitted touch leaves tilt live, only the calm window runs (no speed term,
no prediction for 180 ms). A committed thumb, past 12 px or 450 ms, replaces tilt on both axes, fading it out over
160 ms. A primary that lands within 14 px of the side edge and stays still never clutches (a grip must not kill tilt).
TURBO, the tab and the toggle clutch too, remembering the pose ~0.45 s before the press (`TiltCore.pastG`): a reach
swings the phone before the finger lands; a boost stays clutched until the lift. MEGA never clutches. On the last owner's
lift: phone within 5 degrees of where it was, `handBack()` at once, continuously; moved, stick 0 until the hand settles
(`settle`), then `handBack()`. `handBack` moves `TiltCore.neutral`, the only zero, so tilt reads `(1 - f) * cap`, where
`cap` is what it handed over and `f` says "new hold" (time only counts for a thumb). Sensitivity never changes. A
master gain `g` eases everything in and out: `wake()` is the only thing that raises it (`Input.wakeMix`: tilt live,
settings closed, app back), `sleep()` (settings, hidden) and `turnOff()` (the toggle) drop it; `Controls.frame` stops the
tilt only when `offPending` and `g === 0`.

**Tilt** (`src/game/Tilt.ts`): `TiltCore` (no DOM; `feed(beta, gamma,
screenDeg, tSeconds)`, `update(tSeconds)`, `sx` / `sy`, `calibrate()`,
`recenter()`, `recenterStill()`, `sensitivity`; for the mixer `calm`, `autoHold`,
`gRate` / `gStill`, `pastG`, `anglesOf`, `stickFor`, `rebase`) and `TiltControl` (DOM:
`request()` must be called synchronously in a user gesture, `listen()`, `probe()` (a
quiet listen that ends at off and steers nothing), `stop()`, `status`: off | requesting |
waiting | calibrating | active | denied | blocked | unavailable). `denied` is an answer
from the sheet and is saved; `blocked` (requestPermission threw) is not, the next press
retries. Calibration and RECENTER wait for stillness (`config.tilt.settleRate`,
`settleHold`, capped by `settleMax`): those buttons are corner reaches.
Gravity only (alpha cancels), screen frame, swing split along the neutral
frame's horizontal axes, One-Euro + prediction, dead zone + expo, auto-
recenter. Tunables: `config.tilt`.

**Turbo** (`src/game/Turbo.ts`, `TurboDrive`): `shift(dir, flight)`,
`update(dt, flight, held)`, `gear`, `engaged`, `strain`, `speedK` (log
scale: 0 at the surge, 1 at G1), `boosting`, `edge`, `onEvent(ev, gear)`
with ev up | down | locked | engage | boom; `gearSpeed/gearAlt/gearClimb`,
`GEAR_NAMES`. It writes **`Flight.turbo`** before each step: `speed` (target,
0 = classic), `rate` (1/s, 0 = classic), `floor` (m ASL, a gear's floor the
bus rides like a roof), `ceiling` (0 = config.flight.ceiling), `yaw`
(steering authority). Flight's `lift` / `floorY` smoothing stay the
rooftop's. Tunables: `config.turbo` (`worldTravel` gates G2 / G3). Near the
map's edge what fades is a gear's speed over the ground, so a bus going
straight up keeps its gear.
**The path** (`docs/specs/flight/NOSE.md`): on any dive, and on a pull with a
gear or the boost, `Flight.speed` is the speed along the path, `Flight.nose`
its angle, and `Flight.ground` what goes over the ground; off the path
`ground` is `speed` and `nose` tracks the real path. Whatever means velocity
over the ground reads `ground` or `Flight.velocity(out)`; HUD mph, the boom,
`speedK` and the audio read `speed`. The flare and the ceiling cap `vy` and
turn the nose. `CameraRig` tips the view over a dive from `f.nose` (mode 3
only), in both of its branches, and comes back to exactly 0.
**CameraRig** turbo hooks: `turboPull` (m), `turboFov` (deg), `turboHero`
(x heroScale), `turboLead` / `turboLookLead` (m added to the follow / look
targets: cancel part of the springs' lag at turbo speeds); written by
`TurboLens` (`src/fx/Turbo.ts`), which also punches the fov.

**Under a bridge deck** (`City.overheadAt`: the bus is under a post with an open `under`) nothing lifts the bus: the floor
stops 8 m under the underside, the underside is a hard stop, the hard floor reads no post (`City.hardAt`, which over a
deck reads the roadway: the cable above it is the soft floor's), and `Flight.underDeck()` turns the bus for the clearer
side when something stands up to the deck dead ahead. A wall is what stands under a deck, or a solid post (`City.solidAt`);
past the deck's edge the air is open, and the floor climbs what is there. The bus has no wall of its own, so the turn is all
there is: a tower is steered around, never climbed, but a stick held through the turn can carry the bus into a block, and
nothing stops it there (`docs/specs/bridges/BRIDGES.md`, step 5's flight list).

While `Controls.tearing` (a gear selected, or braking out of one) main.ts sets
`City.detailHold`: no level-of-detail change, arrivals are coarse. Swaps to detail
prepare tile by tile (`prep` adopt items), the swap itself only commits. A shift up
under the opening's gate (`gearsLocked`) is queued and shown as `HudFrame.armed`.

**Turbo FX** (`src/fx/Turbo.ts`, `TurboFx`): the boom's rainbow hoop (one annulus,
one draw while it lasts; every effect really draws in the warm-up), contrail ribbon (one
interleaved dynamic buffer, one upload per frame), speed lines (instanced,
uniforms only), vapor cone; all `sbWrite` with flags 0.5 and ordered-dither
dissolves; events through the existing `Particles.puff/sparkles`; the
rattle (`applyRattle`). **Voice** (`src/audio/turboVoice.ts`) on
`AudioEngine.voiceKit()` (the sfx bus).

**HUD** (`src/ui/Hud.ts`): pixel canvases at 2 CSS px per UI px, palette colours only, redrawn on change only, with no
per-frame DOM writes while idle (`tools/jet.mjs --idle=1`). `src/ui/hudLayout.ts` is one pure function, `layoutHud(w, h,
insets, swap, compact)`, run on resize only. Hit wrappers catch touches and the visuals inside them are pointer-events
none; no hit rect reaches the 14 px band at the left and right edges, in any layout, swapped or not. Only toggle, TURBO,
the tab, MEGA, recenter, settings and the chip catch touches. TURBO: tap = next level, hold = boost, the level shown by
three chevrons. The tab (`gear-down`) exists with a gear or an armed shift. MEGA: tap = splat, hold = charge, slide =
the thumb (`adoptThumb`). `slot('super')` is a 68 x 86 box above MEGA (beside it turned) that docks on its face for the
cooldown (`setMega(phase)`, from main.ts per frame). TURBO and MEGA rest after 8 s with `PixelCanvas.punch` (a checker of
cleared pixels on the panels). `hitTouch` is the toggle's and the chip's tap (the chip's with `steer`: a short still tap only, a drag becomes the thumb). `onGesture` runs after it in the same `touchend`, and no other listener on those two may run it first. The callback runs inside `touchend`,
first thing, because iOS asks there. Top-right buttons fade after 6 s and a tap there wakes them; a desktop has no
buttons at all (Esc: `openSettings`). `setCredits(lines)` (settings' MAP DATA page, wrapped to the panel), `toast(lines, s)` (one slot, LOCKED clears it), `setSettings`,
`arrive()`, `setCue`, `turboCue`, `megaHoldCue`, `showChip`, `flyChip`. All HUD elements carry `data-sb-ui` (Input ignores
keys typed there) and `data-hud="..."` names for QA (`turbo`, `gear-down`, `mega`, `tilt-toggle`, `tilt-chip`, `cue`).

**The first run** (`src/ui/Coach.ts`, no DOM): one cue at a time, each ended by doing it, each shown once ever (`taught`
in the prefs). Off with `?nohud`, `?skipintro`, `?nocoach`; `?coach` keeps it under skipintro. Controls runs it per frame and
owns the chip. **Prefs** (`src/game/controlPrefs.ts`, `localStorage strugglebus.controls.v1`): `tilt?` (true / false /
absent = undecided), `taught?`, `swap?`, `chipIgnored?`, `sens`, `muted`, `keysShown`; an old `mode` is migrated on load.
`config.tilt.defaultOn` is the one switch between offering tilt (false) and assuming it.

QA: `window.__game.controls` (`snapshot()`: mode, tilt, turbo, flight,
camera, HUD, input), `tools/controls.mjs` (browser) and
`tools/controls-sim/` (offline: s_tilt, s_tune, s_perm, s_gesture, s_turbo, s_hybrid, s_layout).
The path: `tools/nose.mjs` (browser, the real stick, frames) and `tools/feel-sim/s_nose.ts` (offline, at any step).

## Height (`src/game/Ascent.ts`, `docs/specs/flight/ASCENT.md`)
What height changes is a function of the height over the nearest surface, in one file with no state, no latitude and no city. The climb and the speeds are not in it: they are the
same at any height, and going faster is the turbo gears' job. `mapReach` moves the homing (main.ts) and `TurboDrive.edgeRoom`; `floorPastMap` feeds `Flight.turbo.floor` past the map,
where only the ground has collision: there `City.groundAt` and the obstacle floor answer from horizon.bin's mesh, the tiles that stick out past the map included (a city with none: the tile, or the far grid's edge). `nearPlane` and `fadeEnd` set the depth range once a frame through `PixelPipeline.setDepthRange`, and `uFog.z`, with `City.landRoom` holding the fade inside
horizon.bin's frame up high. `fadeEnd` runs on the fade in force, `fog.clearFarFull`, on time, late or with no raster, and `CameraRig.fadeBase` takes the same number. `pitchAdd` tilts the vista lens, through `CameraRig.lensHeight`, which only the yoke moves. `snapReach` lets the pixel grid snap as deep as the ground under the screen's center lies. The soft ceiling is `config.flight.ceiling`, a number: `?ceiling=520`
puts the old one back (`shots --det` does, so its climbs stay comparable across builds; any other tool that means "the ceiling" should too). New height behaviour goes in `Ascent.ts`, never
as an altitude test in a caller.

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
  `strugglebus.ground.v4:<tx>,<tz>` on OpenStreetMap data (`groundStorePrefix`, see stableIds), decoded when the tile attaches; blasts that
  reach an unloaded tile wait on its entry and replay when it arrives.
  `GLSL_BLAST_RING` (shockwave on up-facing surfaces: terrain + roofs) and
  `GLSL_GROUND_PAINT` (terrain) with `blastUniforms`.
- The street sign's name (`signName` in main.ts, fixed when the sign is queued): a landmark signs its own
  name; a breath that came down on open ground, or with no building in reach (`queueSign(null, ...)`: nothing blooms, so
  `impact` queues it), names the spot (`City.streetNameAt`, OpenStreetMap's centerlines, else the neighbourhood there:
  `City.hoodAt`, the building's own, the nearest label); one that hit a building names the street in front of it, else its
  neighbourhood. `__game.lastSign()` says which (`from`).
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
  the blade (`signBladeWidth(text)`) must clear them too; where nothing takes less (a street between 20 m terraces: London,
  most of Europe), the shortest pole up to `signTune.poleLiftTall` stands by for the last look. Never on water
  (`City.groundClassAt`: the tile's 2 m ground class). No spot in frame:
  `showSign` returns false and the pending sign asks again 0.8 s later
  (twice); then the primary's front only if it lies outside the blast,
  (+4 m), then the last look's tall pole, else no sign. The whole blade must sit inside the frame, and its
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

## The super splat (hold to charge)
`src/game/SuperSplat.ts` (`SuperSplat`), phases `ready -> charging -> (mega
| firehose) -> cooldown -> ready`. Gameplay numbers in `config.splat`
(`holdThreshold`, `superCharge` 10 s, `superMin`, `superCooldown` 60 s,
`mega*`, `chargeSlow`, `chargeCreep`, `firehose*`, `superSpent`), look
numbers in the tuner groups `SuperSplat`, `SuperFx`, `SuperAudio`.
- **Input contract**: Input's (see "Controls"): MEGA and Space fire `onChargeStart()` past `config.splat.holdThreshold`, with
  `state.chargeHeld` set, then `onChargeEnd(heldSeconds, cancelled)`. main.ts wires
  them to `superSplat.chargeStart(input.state.chargeHeld)` and
  `superSplat.chargeEnd(held, cancelled)`, which calls `host.tap()` for a release
  under `superMin` and for the lift of a press told "not yet"; taps are ignored
  while `superSplat.hosing`.
- **Frame order** in main.ts: `superSplat.pose(pose, superPose)` before
  `bus.update` (the game's own pose stays the squash spring's state);
  `flight.pitch + superSplat.pitch`, `+ superSplat.shake` on the bus root,
  `rig.heroScale * superSplat.swell`; `superSplat.camera(cam, focus, dt)`
  after `rig.update`, before `applyKick` (a dolly: translation only);
  `superSplat.update(dt)` right before `splatter.update` (an impact due this
  frame lands before the paint upload); `superFx.update(dt, mouth, bus
  matrix)` after the jet; `superFx.object.position` = the particles' snap
  compensation; `superMeter.update(realDt, superSplat.view())` after render.
  `Flight.speedScale` is the super's (charge weight, recoil, limp), read only
  while `!Flight.driven`: a gear, the boost or a gear's brake are never braked.
- **Mega blast** = the tap's breath path (`host.mega` -> `breatheNow(shot,
  { radius, width, hitStop, tag })`): `Splatter.barf` takes `radius`,
  `hitStop` and `super`, the jet `width` (`Particles.geyser({ width })`). A
  full belly fires what glints (`Aimer.fire`), any other belly what is at the
  aim point (`Aimer.aimShot`): a wall in the line of fire stops both. A
  super's blast (mega, closer) caps its buildings by its area, up to
  `megaBuildingsCap`; taps and hose impacts by the radius, up to `maxBuildingsCap`.
- **Firehose**: one `Particles.geyser` with `live` (`GeyserLive`: target,
  travel, rate, mutated every frame: each particle flies to where the stream
  lands then), `width`, `taper`. `firehoseRate` times a second the newest aim
  sample whose flight has landed (a 96-entry history: the paint follows the
  visible stream, ~1 blast in flight, well inside GroundPaint's 4 live
  slots) gets `splatter.barf(x, z, { radius, travel, drop, target:
  buildingAt, y, exact, hose: true })`; `Blast.hose` impacts go to
  `superSplat.impact(b)` from main's impact callback (lighter particles, a
  shake, at most `firehoseFlashes` flashes/s, a bell, the street sign when
  the neighborhood changes, `host.sign` = main's `queueSign`); trees take only
  their first colour; `SplatFx.bloom(..., flags)` (`BLOOM_HOSE` fewer sparkles,
  `BLOOM_REPOP` no garden regrow). The finale is a `stream: true` barf (full
  impact fx, `firehoseFinaleHitStop`), once `Splatter.inFlight` is 0.
- **Ground under a pour**: `BarfOpts.bands` (`GroundBands {x, z, width, hue}`,
  one object per pour, hose impacts and closer): `LAYOUT_BANDS`, `bandHue(spec,
  x, z)` in `blastLayout.ts`, rainbow rings around where the pour first landed,
  a function of the ground point, so overlapping impacts agree. Roofs are dealt
  as ever. `ox`, `oz` are saved on the spec only for this layout.
- **Warm-up** (`src/render/warmup.ts`, perf/load's kit, `registerWarm`,
  `PixelPipeline implements WarmPipeline`): in `boot()` after `onResize()`, the
  post passes, `'roof sprouts'`, the signs and `superFx.object` compile in
  parallel and draw once into their real targets; the first frame waits for
  them. Anything new that first draws in flight belongs here
  (`__game.warm.report`). Measure in a FRESH browser: links are cached by a page.
- **The hold's hint**: `superHint()` in main.ts at the belly's refill,
  `superSplat.onLearned` ends it (`strugglebus.superhint.v1`).
- **`Blast.super`** (`SuperTag {kind: 'mega' | 'hose' | 'closer', charge, id}`,
  null for a tap): for the stage engine; a firehose's impacts and closer share
  the super's serial `id`.
- **Look**: `src/fx/SuperFx.ts` (one Points draw, only while alive: motes on
  six rainbow ribs down a funnel into the live mouth, `uFunA/B/C` from the bus
  matrix each frame, a static arc pool lit by `arcs`, sparks, a halo); the
  summoning circle is no object at all: `pipeline.setHeroCircle(charge, spin,
  halfLength, halfWidth)` paints a hue-ramp pinwheel in the resolve pass, on one
  plane through the wheels (each pixel's ray meets it: unbroken over any roof
  and street below, covered by what stands in front); `BusPose.charge / spent / pulse` (optional) drive `BusModel`'s
  `uFx5.yzw` (band racing to white-hot, the body glowing with the heartbeat,
  dim when spent).
- **Sound**: `src/audio/superSfx.ts` via `AudioEngine.superChargeStart /
  superChargeStop / superMega / superFirehose / superHoseHit / superFizzle /
  superReady` (`SoundGraph.superFx`); `heartInterval(charge)` is shared with
  the bus's throb.
- **UI**: `src/ui/SuperMeter.ts`, `mount(hud.slot('super'))` (176 x 86 CSS px,
  the meter 68 x 86 on its floor; `?nohud` hides it with the HUD). Hidden unless
  charging, pouring, cooling down, or 0.7 s into "ready".
- QA: `__game.superSplat(chargeSeconds)` (a scripted hold; >= superCharge =
  the firehose; returns the release time, -1 = "not yet"),
  `superState()`, `superSkip(s)` (the cooldown clock), `superSplatter`
  (`.chargeStart(heldSoFar)`), `superMeter`, `superAudioCheck()`.
  `node tools/feel-sim/run.mjs s_super.ts` (offline: charge, mega, cancel,
  firehose counts and cost), `tools/controls-sim/run.mjs s_gesture.ts` (the
  press), `node tools/supersplat.mjs <url> <out> [charge sweep alt mega
  cooldown jet first audio base] [--base=<url>]` (`&controls=touch`: tilt off, no chip).

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
  never among the buildings' ids. So no key can collide with a stable id in any
  building store (OSM ids in `paint.v3`, rank ids in `paint.v1`), and a re-bake that
  renumbers buildings and drops their store keeps the landmarks' paint. `PaintState(count, slug)` loads both; `register` and `set`
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

What is that line on screen? `node tools/sightline.mjs <url> <out>` holds a pose and asks the game: the G-buffer along a
street's axis (up-facing? which surface?), OSM's centerline over the frame, the lens moved 60 m each way (what stands keeps its
foot, what lies on the ground swings about the nadir), the buildings hidden. Its default is the Embarcadero pose of DECISIONS
"OpenStreetMap, outside judge round 1": a camera on a straight street's axis lays the street on the same screen line as the
vertical of whatever stands at its foot.

The sign's placement, per place: `node tools/signrate.mjs <url> <out> <tag> <city|sf> <lat> <lon> <heading>` (real taps along a flight, how many raised a sign).

OpenStreetMap QA: `node tools/osm-shots.mjs <url> <out> [shots]` (the checklist's places, a climb over them, the
credit's timing), `tools/osm-paint.mjs <url> <out> [stale paint landmarks credit cities]` (old saves on the device, reloads,
every landmark, the credit however the game starts, other cities' stores), `tools/osm-play.mjs <url> <out> [amsterdam ladies
london]` (three taps on a block, a mega blast, a firehose, a low hover, a reload), `tools/spanfly.mjs <url> <out> <bay|gg>` (a
hand-built bridge along its own deck list: a contact sheet of every station, and real flights at the deck, under it, and along under it into each tower and anchorage). Budget: `tools/sweep.mjs <url> <out.json>`
(the worst frame over a compass sweep, the bus held on the spot: the densest flats and the hillsides, at 30, 250, 350 and 500 m:
over a slope the view takes in far more roofs, and the worst views are there), `tools/framecost.mjs <url> "<query>" --alt=500`
(one frame by kind and pass, with GPU timers: compare builds interleaved, the laptop's heat moves fps), `node tools/feel-sim/run.mjs
s_mesh.ts` (offline: triangles per region at LOD 0, LOD 1 and the caster, ring sizes; `SB_DATA=<city dir>` for another bake;
`s_caster.ts`: every built roof and everything that stands on a building is in the caster proxy, where it stands). Deploys:
`tools/redeploy.mjs <old build> <new build>` (see "Re-baking a city").

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
