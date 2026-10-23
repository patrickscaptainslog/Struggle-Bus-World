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
  - `fog` 0..1 → use `sbFog(worldPos)`.
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
- Palette: 8-step ramps. Warm hues shadow toward rose/violet, never brown.
  There is no brown in the palette and there never will be.

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

Dev pages: `dev/<module>.html` using `dev/harness.ts` (real pipeline + grey test
blocks + turntable camera). Screenshot with
`node tools/shot.mjs "http://127.0.0.1:5173/dev/<page>.html?dist=60&elev=30" shots/tmp/x.png`.
The dev server: `npx vite --port 5173 --strictPort --host 127.0.0.1`
(start it in the background if `curl -s 127.0.0.1:5173` fails).
Headless Chromium uses SwiftShader: correct but slow; don't judge perf by it.
