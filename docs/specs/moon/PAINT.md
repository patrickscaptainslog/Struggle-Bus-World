# Painting the Moon: `?moon`

Craters are the buildings of the Moon. A tap fires at what glints, the breath lobs over in a clean arc at one-sixth gravity, and a hit takes the crater up a level. The code is `src/moon/CraterPaint.ts` (what's painted, the pick, a hit, what's saved), `PaintClip.ts` (what it looks like on the ground), `RimBloom.ts` (what grows on it). `Aim.ts`, `Splat.ts`, `GroundPaint.ts` and the props run as they do on a street; all this does is move a shot onto a crater and pick up the blast when it lands. See GROUND.md for the place itself.

## A hit

1. **Glint.** `CraterPaint.pick`, every frame a breath is loaded, scores the list of craters around the bus against the street's aim point: how near the aim, and how near the size that reads from here (`pref`, about 1/7 of the distance). It has no opinion about paint, as the street's aim has none, except that a finished crater is no target: a player who turns back for a bowl means it. Leaning off painted bowls, or toward them, changes nothing in straight flight, because what limits levels there is the bus outrunning its aim between breaths: 18 taps a minute, first level 3 at tap 7 or 8, either way. It's sticky: another crater has to be clearly better to take the glint, and a press or a lifted thumb latches it for `aimLatch`, as Aim's latch does. The list comes from the worker (`craterList` in `gen.ts`), a box ahead of the bus that widens with height; the pick is a scan of a typed array, a few thousand numbers. The rim is drawn by `moonGlint` in the ground's shaders, by the crater's own squash and wobble.
2. **Breath.** `CraterPaint.aim` moves the shot onto the crater: the middle of the bowl, or the aim point if that's well inside a big one. Flight time is `0.5 + d / 340` s, at most 2.6, and the ribbon flies a parabola over its chord (`arc` on `Particles.geyser`, 0 on the street). Up high the aim tips down from 20 to 36 degrees, the breath widens with the throw, and it reaches as far as the ground does.
3. **Land.** `Splatter.barf` runs as ever with two new options: `tag` comes back on the Blast, and `shape` changes the blast before its ground is drawn. On a crater hit that takes away the pinwheel, because the grey between the bowls is the contrast: only its spatter flies out over the rim. Over 150 m of radius it draws no ground at all (a mask a tile would be thousands of tiles). `CraterPaint.impact` takes the crater and its neighbours (at most 14, within 40 m of its rim, each dealt the next hue) up a level, sizes the wave to the crater, and paints the boulders in reach.
4. **Levels.** 1 floods the bowl, up from where it landed. 2 crowns the rim: a band of rainbow teeth that runs round both ways. 3 throws rainbow rays over the ground and turns the bowl to a pinwheel from the middle out. A neighbour stops at 2: rays are for a direct hit, or the ground under a few blasts is nothing but rays. A super's mega takes its crater up two.
5. **Open ground** takes the street's pinwheel, in GroundPaint's masks as before, and stays on the far windows as a lumpy disc (`stroke`).

## Paint on the windows

`PaintClip`: four layers of one RGBA8 array, 1024 x 1024 each, 1, 8, 64 and 512 m a texel, around the view. A crater's shape can be said in a line of GLSL (`rimDist` is the stamp's own squash and wobble, or a named crater's four harmonics), so what's kept is the list and the GPU draws it, a quad a mark. A bowl 20 m across and one 100 km across are the same quad. There's no mask on any tile and no tile split out of a coarse region, and near and far ground read the same layers (`moonClip`, which reads the finest window that holds the place and that a pixel's size can read).

- A write keeps the most coverage (`blendEquationAlpha` MAX) and takes the hues, so a soft edge doesn't bite a hole in what's under it.
- A texel holds two hues and which of them, as MoonPaint's map does: sectors meet on as smooth a contour as paint's edge. Two marks that meet have no such ramp, coverage is full either side, so when the four texels under a pixel don't share a pair of hues, each says its own and the hue with the most of the four weights wins (`moonSaid`). That's the filtered contour between two floods; going by the strongest texel it was a stair of texels 20 pixels wide near the lens.
- Marks go on biggest first. When one changes, every mark it touches goes on again under a scissor, in that order: a few instanced quads a frame while a level lands, and nothing after that. A window that moves redraws the marks on it.
- Each frame costs four texel reads a ground pixel, most of them; a painted pixel pays four more and three noises.

## Bloom

`RimBloom` lays the roof props round a rim (`RoofSprouts.place`, laid out by its caller, in the world). Level 1: crystals and flowers, out of the first paint to reach the rim. Level 2: a garden, with trees. Level 3: golden domes and spires by turns, the whole way round, with rainbow bunting strung between them. Crystals are a ninth sprout type that exists only under `?moon`. Everything's hashed from the crater's id, so it's the same garden every time, and everything springs up on the props' own curve as the paint reaches it.

Rims stand within 1.5 km of the bus, at most 5000 elements. Past that a crater is what's on the windows. A rim under 150 m waits for its tile, because the far field has the ground to 30 m. A bigger one goes up on what there is and settles on the tiles as the bus comes along it.

## Rocks, signs, sites

- **Boulders** (`hueAt`, `paintRockMesh`) take the hue across the wheel from the bowl they lie in, or they couldn't be seen; those thrown round a rim take the rainbow by which way they lie; those on open ground take the mask under them. It's worked out from the paint, so nothing about a rock is saved.
- **Signs.** `nameAt` is the smallest named place that holds a point: the 150, plus every other named crater in the gazetteer (`names.json`, 20.6 KB, nothing is shaped from it). `passing` raises a sign as the bus comes to a place, once in 70 s a name. It stays green (`plain`) and sinks. A blast there says the same name and flips it, so painting a named place says so. A crater with a name always signs; a blast inside a big name says it at most every 25 s (`signDue`), or everything in Theophilus says Theophilus every few seconds and stops being read.
- **Crewed landing sites** (Apollo 11, 12, 14, 15, 16, 17) stay unpainted: a circle 1.2 km in radius with a line round it, enforced where paint is read, so no flood, ray or blast can land there. No crater in one can be a target, and a blast in one leaves no mark, so nothing grows there either. `?site=` starts outside the line. A sign stands at the site as the bus comes within 2.6 km. Luna, Surveyor and the rest only have names.

## What's kept

On the device, by id, so it comes back on any map of the Moon:

| Key | What |
|---|---|
| `strugglebus.moon.craters.v1` | `[id, level, hue]` a crater. An invented id is its octave and cell (GROUND.md), a named one `p<place>` |
| `strugglebus.moon.strokes.v1` | The last 600 blasts on open ground, by latitude and longitude, for the far windows |
| `strugglebus.moon.low.v1` | Craters of 1 km radius or more, for the orbit: `[lat, lon, level, seed, km]`, at their true size or a 6 km dot. `MoonPaint.load` reads it |
| `strugglebus.ground.v2.moon_<lat>_<lon>:` | GroundPaint's masks, as on a street, a map at a time |

## One-sixth gravity

`startMoon` divides `fxTune.gravity` by 6 and every speed that goes up by the root of 6, and takes blob flight times up by the same: the same heights, as long again by 2.45. What the street snaps, here hangs. Fewer burst drops, or a fountain is a curtain in front of the bowl it filled, and a softer flash, because a flash on a black sky is a lot.

## Budget

Laptop, UHD 620, headless Edge. No timing here, and nothing has run on a phone or in Safari.

| View, levels 1 to 3 | Draws | Triangles |
|---|---|---|
| A 20 m crater, from the floor | 27-34 | 0.51 M |
| A 60 m crater, from 40 m up | 46 | 0.67-0.68 M |
| A 160 m crater, from 90 m up | 59 | 0.87-0.88 M |
| A 500 m crater, from 300 m up | 55-91 | 0.76-0.78 M |
| Worst in a minute of play | 74 | 1.06 M |

Whole frame, sun pass and post included. The line is 120-200 draws, 1.0-1.5 M triangles. A lot painted in one place is held by the 5000 elements. 30 programs at ready, none added in any flight: `paint.mjs` prints what's added.

- GPU: 16 MB for the four windows, and nothing per crater.
- On the wire: `names.json` 20.6 KB gzip. Code gzip: `moonBoot` 25.9 KB, was 12.4; `moonWorker` 10.4 KB, was 10.1.
- Flag off against main 034672f: 62 shader sources, 0 bytes differ, 31 programs. Their compile order varies from run to run. Two more script requests than main, the same code split by the dynamic imports.

## Left on purpose

- A crater's rim on the windows is the stamp's or the formula's, not the ground's. Theophilus is real heights, so its flood's edge is a few km off the true rim in places. A scan of the rim by the generator would fix it, a crater at a time.
- A big rim's garden is laid over the whole rim at one density. On a 100 km crater that's a flower every few km. It wants laying a stretch at a time around the bus.
- Nothing that grows is an obstacle: the bus flies through a dome.
- Far from the bus a garden is gone and the crater is colour only.
- The orbit doesn't know about crewed sites: the map's texel is 10.7 km and a site is 2.4 km across.
- `?moon` doesn't read what orbit painted; only this way round.

## Tools

`tools/moon/paint.mjs <out dir> --script=...` flies the real stick and taps. `three` the first three hits; `play` a player's session; `close --r=60` every step of three hits on a crater; `gallery` a crater of each size at each level; `named` Theophilus from straight above; `high` from 3 and 10 km; `sites` round the Moon; `apollo` a crewed site; `saved` a reload and another map; `steady` how steady the glint is; `super` the super splat; `soak` every gear; `orbit` the global map. `moon.paint.qaHit(id, clock, hue)` is a hit with no breath.
