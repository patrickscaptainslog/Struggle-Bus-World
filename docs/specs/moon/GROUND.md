# The Moon's ground: `?moon`

(Coming down to it from orbit, on one page, is `?moonland`: LAND.md. What's below is true of both, but that one's sky is the true one, its far field has ten levels, and the ground's bake has a true Sun over each block.)

The Moon as a place the real game loads. Generated, not baked: real in its big shapes and named places, invented below that. Everything is behind `?moon` (`src/sky/flag.ts`, `moonLow`); the code is `src/moon/`, a chunk and a worker of their own. `boot()` in `main.ts` runs as ever, on a city with no files.

Entry: `?moon` starts on the floor of Theophilus, north of its central peaks. `?moon&site=<landmark>` (any of the 150 in `public/moon/places.json`: `TYCHO`, `apollo 11`, part of a name will do, then any of the 1,533 craters in `names.json`: `ptolemaeus`) and `?moon&lat=&lon=` start anywhere on the Moon. A name the Moon doesn't have says so (NO PLACE CALLED) and starts at Theophilus. A map is 256 km square around where it starts, with the game's own edge homing. `?t=<date>` is the true sky (below). `?earth=1` draws Earth at its true size under the held sky.

- **Where the bus lands.** A named crater or basin starts on its lit floor, at most 64 km from the map's middle (Orientale is 930 km across). A crewed site starts 550 m outside its line, nose at it, or the first minute is taps that don't stick. Everywhere but the start picked by hand at Theophilus and the crewed sites, `MoonGen.findLit` then looks once, at boot, in the worker: the nearest ground within 9 km where the Sun is on the lens's ground, the bus's and on along the view, and the ground isn't hemming the view in. A raster at 30 m: at 100 m it can't see what a range's ridges throw, and it said yes to places the game had in shadow. Not by night under `?t=`.
- **The first look.** The page is black from its first paint, with a line of text (the place's name), and Safari's bars are black with it. `covered`, the same hold a lost context uses, keeps the game at dt 0 with the canvas at opacity 0 until the ground near the bus is in, 12 s at most, then the picture comes up out of the black. So nothing sees a coarse tile, and nothing sees fog-grey before a black sky.

## How it fits the game

City reads a manifest and regions. Here `moonBoot.ts` makes the manifest, and `City` takes a `CityMoon` in place of a folder: regions come from `moonWorker.ts` as `TileResult`s, with heights in floats and a map in place of the 2 m class texture. Flight, the obstacle field, GroundPaint, Splat, Aim, signs and Turbo are unchanged, and CameraRig but for its floor (below). The only numbers changed at boot are the camera's height over the bus, the sun, and `avoidTallerThan` (`startMoon`).

- **World frame.** Azimuthal equidistant around the map's centre (`map.ts`): +X east, +Z south. Y is height over the 1737.4 km sphere less a datum, the lowest ground near the map less 2 km, so no height is ever under anything the game treats as water or a floor. `config.flight.ceiling` is 15 km over the ground it starts on.
- **The curve.** Only clip positions are rolled onto the sphere, around the lens (`moonCurve` in `moonMaterial.ts`). Everything that asks where a pixel is (paint, the tile, the sun's map) reads the flat map. The horizon is what's left: it ends clean against black, no fade.
- **The lens** has a floor: `CameraRig.floorAt`, 4 m over the ground under it, set only here. In 4,500 frames of ordinary flight it was never needed. A start with a hill behind the bus had the lens inside the hill, looking out through the back of the ground at the stars.
- **The generator** is `gen.ts`, one piece of TS, no three.js, deterministic from a position and a seed. `MoonGen.raster` stacks relief (bicubic), named places (`shape`), the real LOLA window, hills, then craters. Two rasters over the same ground agree wherever they meet. It runs in the worker and under Node (`tools/moon/run.mjs look.ts` draws it with no game in the way).
- **No straight lines on the ground.** The ground is drawn by its slope and the ramp has eight steps, so anything with a grid in its slope comes up as plates under a low Sun. Two did. Hills are gradient noise, because value noise has no slope at all along every plane of its lattice. And LOLA's tracks are stripes, so `destripe` in `bake-moon.py` takes a thin wedge round the east-west wave vector out of the window's spectrum, under 12 km: a round crater has next to nothing in there, where a blur took the craters too. A wedge wider than 6 degrees starts to ghost north and south of the peaks.
- **Near:** detailed regions at 2 m a texel with a 4 m mesh, coarse regions at 4 m with an 8 m mesh. A level of detail brings its own heights and map (`prepTile`, `swapRegion`).
- **Far:** eight clip levels, 4 m to 512 m a texel, 1024 x 1024 each, around the lens (`MoonFar.ts`, `FarStore` in `gen.ts`). One patch mesh, instanced, one draw. A level's window moves by blocks of the next level up, so every hole is a whole number of blocks. A pixel reads the finest level its size on the ground allows. The worker keeps every second texel, for the long shadows. Far ground sinks 24 m under loaded tiles rather than being cut, so a tile's edge never shows sky through a crack.
- **Light** is baked, because the Sun is held. `sweepSun` walks from the Sun's side and leaves, at each texel, the highest line of sunlight the ground upstream lets through. Its signed distance from the ground goes in a byte, by its root, so a filtered read gives a clean contour at any size, as a font's distance field does. Near map: slope x, slope z, tone, that byte. Far map: baked light, that byte. Out of the Sun the light byte says what a sunlit wall throws back on that slope instead (`fillByte`), the same fill the near ground works out, or the lee of a mountain is a flat black hole. From the triangle's own slope it showed the triangles. Ground casts nothing in the sun pass; only the bus and rocks do. The bus learns it is in shadow from the tile's map (`sunAt`), and its light drops.
- **The top of the ramp** is a long ease (`moonShoulder`): as it was up to 0.72, then slowly to 1. Before that a whole sunlit wall of fresh ground, Shackleton, Aristarchus, was one flat white with its stones as black static. A stone's shadow is lighter on bright ground for the same reason. Seas took a step up, `LIT_TONE0` and `1` and the `MARE` row: flat mare sat on the ramp's third step of eight, next to black. A judgement from frames: nothing here has run on a phone.
- **The sky** is the space code, `render/skyResolve.ts` and `sky/SkyDraw.ts`, driven by `MoonSky.ts`. Palette rows `REGOLITH` and `MARE`, and a black `NIGHT_SKY`, are written only under `?moon`.

## The sky is held, and that is a decision to read

By default this is not the real sky at Theophilus, in three ways:

1. **The Sun is held** at 20 degrees, 80 degrees off the first heading, so the first impression always has long shadows. Ahead of the view on purpose: the eye reads a bowl lit from the top of a picture as a bowl, and lit from behind the camera it reads as a dome.
2. **Earth is held too**, 10.5 degrees up. That goes past the brief, which asked for a held Sun and the real Earth. The true Earth stands 62 degrees up at Theophilus, and the chase camera's frame ends 16 to 20 degrees up, so the true one is never seen. What is held is one real moment, 2026-08-05 15:20 UTC, turned rigidly: stars, Sun and Earth keep their true places against each other and Earth shows that moment's real face and phase, 45 % lit. It is the sky of a real place near the limb.
3. **Earth is drawn 1.7 times too big.** At 1.9 degrees it is a 20 px marble on the high lens. `?earth=1` is the true size.

`?t=<date>` drops all three: the true sky over the bus at that date, the ground's light baked for that Sun. If the Sun is down, the ground is lit by Earth, or by nothing on the far side. On the far side Earth is never shown, held or true.

## Listing craters

For what comes next: craters are the buildings of the Moon, so paint needs to find them. In the game, `__game.moon`, and `moon` in `main.ts`:

```ts
moon.cratersNear(x, z, radius, minD = 40): CraterHit[]   // map metres; largest first; allocates, so per hit, not per frame
// { id, name?, x, z, r, age }  r is the rim's radius (m); age 0 fresh, 1 plain, 2 old, 3 ghost
moon.crater(id): Crater | null                           // an invented crater back from its id
```

- Every crater whose rim comes within `radius` of the point, and every crater the point is inside: over Theophilus you always get `p40`.
- An invented crater's `id` is `L.i.j.k`: its octave and its cell of a grid through the whole Moon. It holds on any map, on any device, for ever: save paint under it. `craterById` needs nothing but the id.
- A named crater's `id` is `p<place id>`, an index into `places.json`, with its `name`. Names over 20 km are shaped by `MoonGen.shape`; smaller ones are stamped like invented ones.
- With no allocation, for a loop over a box: `eachCrater(frame, albedo, seed, L, x0, z0, x1, z1, fn)` in `craters.ts`, one octave at a time. `octaveD(L)` is the octave's largest diameter, 5 km halving to about 20 m. The object it hands you is reused.
- Worker and main thread agree because both hash the same cells from the same albedo. `SEED` in `moonBoot.ts` is the one Moon's.
- Painting them is PAINT.md.

## Budget

Laptop, UHD 620, headless Edge. No timing here, and nothing has run on a phone or in Safari.

| View | Draws | Triangles |
|---|---|---|
| Street | 26-39 | 0.54-0.67 M |
| 300 m | 36-51 | 0.72-0.83 M |
| 3 km | 14-20 | 0.42-0.62 M |
| 12 km | 9 | 0.26 M |
| Worst in a full flight (climb) | 52 | 0.88 M |
| Worst in a full flight (dive from 5 km, looking down) | 33 | 1.05 M |

Whole frame, sun pass and post included. The line is 120-200 draws and 1.0-1.5 M triangles.

On the wire, as `tools/moon/wire.mjs` reads what the page asks for: 1.71 MB of Moon data (`relief.bin` 1,467,883 B, `theophilus.bin` 222,209 B, `names.json` 20,563 B, `places.json` 2,703 B). The sky's `earth.bin`, `moon.bin`, `stars.bin` and `lines.bin`, 434 KB, as `?moonrun` fetches. Code 444 KB, of which `moonBoot` 26.8 KB and `moonWorker` 10.9 KB are the Moon's own. 2.59 MB in all.

GPU memory for the far field about 18 MB; the worker holds about 17 MB for it, and each block it makes costs a raster briefly.

Flag off, against main 034672f: 62 shader sources, 0 bytes differ, 31 programs. Three more script requests than main, the same code split into chunks by the dynamic imports.

## Left on purpose

- A blast on open ground shows as sharp as GroundPaint can on loaded tiles only. From above it's a lumpy disc on the paint windows (PAINT.md).
- Rocks aren't obstacles: nothing out here stands over the bus's 9 m.
- The far field draws all 400 patches, in view or not. Culling by frustum would save a third of its triangles.
- A lost GL context reloads the page.
- `?moon` and `?moonrun` don't join. `?moonland` is the two on one page: LAND.md.
- In the true sky the Sun's direction is the map centre's, held for the whole map; only the disc and Earth move with the bus.
- Line stamps (valleys, the Straight Wall) use azimuths read by eye (`AZ` in `tools/moon/bake-moon.py`). Rupes Altai is left to the relief.

## Tools

All under `tools/moon/`. `bake-moon.py` packs the data. `run.mjs <scenario.ts>` runs a scenario under Node: `look.ts` pictures a raster, `places.ts` lists peaks and craters, `nans.ts` checks a map for anything not a number. `shots.mjs` takes frames at set poses. `fly.mjs` flies the real stick at a fixed step. `dbg.mjs` boots, runs an expression in the page, and dumps the state. `hand.mjs` holds one browser open and takes commands (`hand.sh '<body>'`): real touches through CDP, so you can look at a frame and choose what to do next. `pops.py` reads a run of frames a fixed step apart for anything that appears at once. `wire.mjs` is the bytes. `tools/warmcheck.mjs <url> <out> --low` is the warm-up check under `?moon`.
