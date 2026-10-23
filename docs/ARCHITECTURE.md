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
| Super splat | `src/game/SuperSplat.ts`, `src/fx/SuperFx.ts`, `src/ui/SuperMeter.ts`, `src/audio/superSfx.ts`, `src/audio/superAudioCheck.ts` | hold to charge, mega blast, firehose, cooldown (see below) |

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

## The super splat (hold to charge)
`src/game/SuperSplat.ts` (`SuperSplat`), phases `ready -> charging -> (mega
| firehose) -> cooldown -> ready`. Gameplay numbers in `config.splat`
(`holdThreshold`, `superCharge` 10 s, `superMin`, `superCooldown` 60 s,
`mega*`, `chargeSlow`, `chargeCreep`, `firehose*`, `superSpent`), look
numbers in the tuner groups `SuperSplat`, `SuperFx`, `SuperAudio`.
- **Input contract** (shared with feat/controls, which owns the gesture side):
  `Input.onTap()` = a quick tap; `onChargeStart()` when a press has lasted
  `config.splat.holdThreshold` without turning into a steer; `state.chargeHeld`
  = seconds held (0 when not); `onChargeEnd(heldSeconds, cancelled)`
  (cancelled = slid into a steer or lost focus); a hold shorter than the
  threshold is a tap; `onTurbo(dir)` / `state.turboHeld` (feat/controls);
  `input.mode: 'tilt' | 'touch' | 'keyboard'`. main.ts wires
  `onChargeStart -> superSplat.chargeStart(input.state.chargeHeld)`,
  `onChargeEnd -> superSplat.chargeEnd(held, cancelled)`; taps are ignored
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
  `Flight.speedScale` is the super's (charge weight, recoil, limp).
- **Mega blast** = the tap's breath path (`host.mega` -> `breatheNow(shot,
  { radius, width, hitStop })`): `Splatter.barf` takes `radius` and
  `hitStop`, the jet `width` (`Particles.geyser({ width })`).
- **Firehose**: one `Particles.geyser` with `live` (`GeyserLive`: target,
  travel, rate, mutated every frame: each particle flies to where the stream
  lands then), `width`, `taper`. `firehoseRate` times a second the newest aim
  sample whose flight has landed (a 96-entry history: the paint follows the
  visible stream, ~1 blast in flight, well inside GroundPaint's 4 live
  slots) gets `splatter.barf(x, z, { radius, travel, drop, target:
  buildingAt, y, exact, hose: true })`; `Blast.hose` impacts go to
  `superSplat.impact(b)` from main's impact callback (lighter particles, a
  shake, at most `firehoseFlashes` flashes/s, a bell, the street sign when
  the neighborhood changes); `SplatFx.bloom(..., flags)` (`BLOOM_HOSE` fewer
  sparkles, `BLOOM_REPOP` no garden regrow). The finale is a `stream: true`
  barf (full impact fx, `firehoseFinaleHitStop`).
- **Look**: `src/fx/SuperFx.ts` (one Points draw, only while alive: motes
  spiralling into the live mouth, a static arc pool lit by `arcs`, sparks, a
  halo); `BusPose.charge / spent / pulse` (optional) drive `BusModel`'s
  `uFx5.yzw` (band racing to white-hot, the body glowing with the heartbeat,
  dim when spent).
- **Sound**: `src/audio/superSfx.ts` via `AudioEngine.superChargeStart /
  superChargeStop / superMega / superFirehose / superHoseHit / superFizzle /
  superReady` (`SoundGraph.superFx`); `heartInterval(charge)` is shared with
  the bus's throb.
- **UI**: `src/ui/SuperMeter.ts`, `mount(hud.slot('super'))` (feat/controls'
  Hud); `mount()` alone builds a temporary fixed container top-right.
- QA: `__game.superSplat(chargeSeconds)` (a scripted hold; >= superCharge =
  the firehose; returns the release time, -1 = "not yet"),
  `superState()`, `superSkip(s)` (the cooldown clock), `superSplatter`
  (`.chargeStart(heldSoFar)`), `superMeter`, `superAudioCheck()`.
  `node tools/feel-sim/run.mjs s_super.ts` (offline: charge, mega, cancel,
  firehose counts and cost), `s_hold.ts` (the gesture on synthetic events),
  `node tools/supersplat.mjs <url> <out> [charge sweep alt mega cooldown
  audio base] [--base=<url>]`.

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
