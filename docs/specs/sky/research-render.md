# Building the live sky in this renderer

Render research for the sky build, 2026-10-31, against `merge/osm` at `bc3106b`. Line numbers are that commit's; another agent is committing on the branch, so they may drift.

**Labels.** [M] I ran it (scripts in §12). [S] from a source, linked. [E] estimate, with the assumption stated. A file:line with no label is code I read at that commit.

**What ran.** CPU only: palette arithmetic, the game's own light and shadow formulas ported to Python, a low-precision ephemeris for 2026, and real captures re-coloured pixel by pixel. No browser, no GPU, no phone, no repo edits. One download, 116 KB, to measure a file size; nothing over 50 MB was needed. Every frame-time statement here is a count, not a measurement.

**Mock frames, in this folder:** `mock-palette-grades.png` (six tables on four real captures), `mock-palette-tables.png` (the tables), `mock-night.png` (night by light against night by table, then windows, glow, beam, sky), `mock-moon-sizes.png` (Moon and Earth at real pixel sizes). The tables are test art, not proposed art.

---

## 0. The answer in twelve lines

1. **One palette table re-lights every city.** Every pixel of the world, sky, bus and particles is one texel of one 1,536-byte texture. Swapping that table on four real captures gave believable dusk, blue hour, night and storm with paint untouched and no brown [M].
2. **Split two jobs.** The table says how dark it is and what colour the air is. `uLight` stays in the middle of the ramps day and night and only says where the light comes from. That is day-for-night filming, and it is why paint stays vivid with no shader change.
3. **A global night filter is the wrong tool.** A blue night multiply puts 5 steps in the brown box and leaves paint as little as 32 % of its chroma [M]. The grade must be per row, with the paint rows left alone.
4. **Three sun vectors, not one:** a held shading vector (`uSunDir`, so materials don't change), a held true key for the sun pass, and a continuous true sun for the sky.
5. **Never move the shadow camera every frame.** The texel snap only holds while the direction is constant. A moving sun slides the lattice over the world, 2.3 street texels a second at 8 km from the origin, and flips 13.6 % of shadow-edge pixels per frame in a CPU mock [M]. Hold the sun and tick it.
6. **Noon: stay honest.** Disc, shadows, sunrise, glitter are all true. Only the wall-shading vector has a soft knee (true 75° shades as 41°). WORLD-TRAVEL's "compress elevation" would make a 75° shadow 5.3 times too long [M].
7. **Night is the main look, not an edge case.** San Francisco has the sun below -6° for 45 % of all hours, and on 73 % of days by 20:00 local [M].
8. **Night also pays for itself.** No key light means no sun pass: 42-74 draws and 217-484k triangles back (DECISIONS:2369-2370).
9. **The sky band costs no draws by day.** Sun, Moon and clouds live in the resolve's sky branch. Stars are one Points draw at sky depth, read back by that branch, so clouds and the Moon cover them.
10. **Weather needs no new pass.** Cloud shadows in the resolve, rain as one line draw, fog through the existing marine-layer code once its San Francisco shape is gated.
11. **The sky test is already wrong.** `z >= 0.99999` turns geometry into sky at 25.0 km, not at the 30 km far plane, and the spike's `?farfade` would cut the city at 29 km with fog at 0.75 [M]. Fix it first; the Moon flight needs the same fix.
12. **Budget:** +1 to +3 draws, about +4-8 % of resolve texture fetches in the sky, +5 % for cloud shadows when they are on, 3-4 small new programs on top of 27, about 200 KB of code and data [E].

**The brief and the specs, checked:**

| Claim | Where | Result |
|---|---|---|
| The Moon is about 5 game px from the ground | Sky brief | 5 px on the ceiling lens, **8.4 px on the street lens** [M] |
| Top of frame about 6° at street level, 14.7° at the ceiling | Sky brief, research | Confirmed [M], and **2.2° in slow flight** |
| "Shadows are a real-time sun pass, so the sun can move" | Sky brief | True for direction only. It crawls if moved every frame, clips below 10.5° and renders from under the ground at night (§2) |
| Far-field tone must not bake cast shadows | Sky brief, VERDICT §10 | Not enough: **it must not bake N·L either** (§9). SPIKE:63 bakes the fixed sun |
| 384,400 km can't live in the render frame; bodies by ray-sphere in the sky branch | Sky brief | Confirmed; float32 is enough [M]. Small bodies are better as snapped pixel sprites (§4.3) |
| Night art is the biggest new work | Sky brief | Less than feared: a table does the base look. Windows at distance are the real work (§3.3) |
| About 600 stars | WORLD-TRAVEL:364 | About 2 in the street band [M]. Too few |
| Moon as a phase sprite | WORLD-TRAVEL:369 | Superseded by the sky brief; the sprite idea returns only as pixel snapping |
| Compress elevations above 35° | WORLD-TRAVEL:411-412 | Rejected: false shadows (§2.5) |

---

## 1. Colour, from `sbWrite` to the screen

### 1.1 The path

| Stage | What happens | Where |
|---|---|---|
| Material | Writes ramp index, light 0..1, fog, glow, view normal, surface id, flags. Never RGB | `sbWrite`, `materials.ts:231-235` |
| G-buffer | One RGBA16UI target, 8 bytes a pixel, no blending, no filtering | `PixelPipeline.ts:272-281` |
| Glow | Half res. Each pixel: palette step 6 of its ramp x glow x (1 - fog), 2x2 box, then two 5-tap blurs at x1.35 each | `:723-760`, `:575-584` |
| Resolve | Depth decides sky or surface. Surface: outlines, atmospheric mix, dither, fog handover, halo, drop shadow, beam, flash. Output is `pal(ramp, step)` | `:912-1176`, `pal()` at `:822-824` |
| Upscale | Nearest, shifted by the snap's sub-pixel remainder; alpha 0 (plain sky) takes the unshifted texel | `:1179-1200` |
| Canvas | Bytes go out as they are: `outputColorSpace` is linear, the palette is `NoColorSpace` | `:142`, `palette.ts:123` |

There is no tone map, gamma, blend or LUT anywhere in that chain. Every colour in the game frame comes from one 8 x 48 RGBA8 texture (`palette.ts:89`, `:102-126`, held at `PixelPipeline.ts:43`, passed to the resolve at `:162` and the glow at `:193`).

### 1.2 Can a grade be a table? Yes

**The proof.** I read four real captures back into (ramp, step): SF street, SF 250 m, SF ceiling, London. 100.00 % of pixels index exactly [M], and only 3 of the 192 colours are shared by two (ramp, step) pairs [M]. So a re-coloured frame is exactly what the resolve would write from that G-buffer under a new table. `mock-palette-grades.png` has six tables on those four frames [M]:

| Table | World mean L, street frame | Paint mean L | Paint mean chroma | Brown steps | Pixels with L < 0.20 |
|---|---|---|---|---|---|
| day (today) | 0.59 | 0.65 | 0.16 | 0 outside paint | 0.02 % |
| golden | 0.59 | 0.65 | 0.16 | 0 | 0.02 % |
| dusk | 0.48 | 0.65 | 0.16 | 0 | 0.02 % |
| blue hour | 0.43 | 0.65 | 0.16 | 0 | 0 % |
| night | 0.34 | 0.65 | 0.16 | 0 | 0.02 % |
| storm | 0.47 | 0.65 | 0.16 | 0 | 0.24 % |

The brown test also passes at nine fractions of every fade between neighbouring tables [M]. My eye on the sheet: blue hour and night are the strongest frames in the sheet, and paint reads as lit from inside. Storm reads at once. Golden is the weak one: the whole ground goes salmon, because the capture's ground sits on its day steps. Golden needs the low-sun `uLight` as well as the table.

**How to build it.**

- Keep one texture. The CPU holds keyframe tables and blends the neighbours in RGB, keyed by sun height and cloud cover, at most 2 Hz, only when a byte changes. Upload with `src/render/upload.ts`'s `uploadRect` or `needsUpdate`: under 1.5 KB. That is the same idea as Mark Ferrari's Living Worlds, where indexed art lets palette fading carry the day ([Gilman](https://iangilman.substack.com/p/next-living-worlds)) [S], and BlendShift's fading between palette colours ([80.lv](https://80.lv/articles/color-cycling-from-the-90s-returns-with-html5)) [S].
- **No shader change, no new program, no warm-up cost** for the table itself.
- Do not crossfade two tables with a dither in the resolve. A Bayer blend of the whole frame would sit on every flat wall all day, which is what the `flatLight` test exists to stop (`PixelPipeline.ts:1023-1036`). A shader `mix()` of two tables costs a fetch per pixel to save a 1.5 KB upload.
- Grade per row. Grey-world rows move; rows 8-13 (paint), 14-15 (bus), 16 and 18 stay as they are. A global filter fails on the numbers [M]:

| Filter | Steps in the brown box | Paint chroma left at steps 2-5 |
|---|---|---|
| night multiply (0.30, 0.35, 0.55) | 5 | 32-85 % |
| dusk multiply (0.75, 0.55, 0.60) | 9 | 55-91 % |
| flat x0.45 | 13 | 52-53 % |

**A rule has to change in words.** `palette.ts:3-6` says nothing on screen is ever a colour not listed, and that mixing is by dithering, never averaging. A blended table averages entries over time. Each frame still shows only 192 colours, but they are this minute's. So the palette check in SPIKE §5 must read the live table (expose it as `__game.sky.palette`), and every pair of keyframes must pass the brown test offline. Today's palette itself trips SPIKE's brown box on three steps (ORANGE 3, YELLOW 2, BUS_YELLOW 2) [M]; that rule is written for new ramps, so keep it that way.

### 1.3 What ignores which path

| Thing | Reads the table? | Follows `uLight`? | Where | What it needs |
|---|---|---|---|---|
| World surfaces | yes | yes | `sbLight`, `materials.ts:155-161` | Nothing |
| Sky | yes (FOG, SKY_WARM literals) | no: its own function | `PixelPipeline.ts:936-951` | A sky row and shape uniforms (§4) |
| Bus | yes, its own rows | **no**: held against `REF_LIGHT`, follows sun direction and shadows only | `BusModel.ts:176`, `:341-357` | Leave rows 14-15 alone. It stays the brightest thing on screen |
| Particles, super FX, turbo FX | yes | **no**: absolute steps | `Particles.ts:636`, `SuperFx.ts:247`, `Turbo.ts:271, 354, 406, 457` | Nothing. Grey puffs follow the table, paint stays paint |
| Glow halo | yes, directly | no | `:735`, `haloTint` `:900-910` | Nothing. It follows the table for free |
| Paint on buildings | yes | **yes**, compressed: `0.2 + light * 0.52` | `buildingMaterial.ts:731, 833` | Fine if `uLight` stays mid-range (§1.4) |
| Paint on the ground | yes | **yes**, with a 0.28 floor | `terrainMaterial.ts:92-94` | Same; `uGroundTone.x` is live if it needs a lift |
| Stained glass | yes | **no**: absolute 0.62-0.72 | `buildingMaterial.ts:824` | Already night-proof. Raise `uGlassGlow` at night: it is a live getter (`:55`) |
| Tree paint | yes | yes, snapped to bands | `trees.ts:440-453` | Nothing |
| Landmark paint | yes | mixed: `lp.mode > 1.5` is absolute | `landmarks.ts:334-336`, `landmarkPaint.ts:252, 286, 341` | Nothing |
| Rooftop gardens | yes | yes | `sprouts.ts:370` | Nothing |
| Street signs | yes | partly | `StreetSign.ts:851, 864, 876, 931` | SIGN_GREEN stays readable in every table |
| Flash, drop shadow, beam | yes | no | `:957`, `:1138-1141`, `:1151-1168` | §1.5 |
| HUD, super meter, settings | **no**: DOM canvases, colours from the source hex table | no | `palette.ts:92-96`, `Hud.ts:715`, `pixelUi.ts:85`, `SuperMeter.ts:66` | Correct as it is: UI must not change with the weather |
| Page background | **no**: fixed `#808a94` | no | `index.html:10, 33` | A 4 s grey flash on a night load. Set `theme-color` and body background from the table once it is known |

### 1.4 Paint stays vivid at night

Do not crush `uLight` at night. Keep ambient and sky bounce where they are and let the table do the darkening. Then a painted wall at night has light 0.42-0.62 before the compression, which lands on steps 2.9-3.6 [E, the formula at `buildingMaterial.ts:833`]. Those are the highest-chroma steps of most hues: peak chroma sits at step 3-5 in all six [M]. So paint needs no night code at all.

If a moonless night reads dim, the fallback is still palette only: re-index the hue rows upward, for example [1, 2, 3, 4, 5, 6, 7, 7], using only their own eight colours. Watch the aim glint if you do: it is a one-step lift (`config.ts:376`), and a table that repeats a colour swallows it.

### 1.5 Traps in this path

- **`kMatch` hard-codes the FOG row:** `0.3955 + 0.071 k` at `PixelPipeline.ts:1066` is today's FOG luma exactly [M]. Grading FOG breaks the value-matched fog band. Pass base and slope as uniforms from the table.
- **SAND borrows SKY_WARM** (`terrainMaterial.ts:70`), so beaches would turn with the sunset sky. Give it the row VERDICT §8 already asks for.
- **The beam's warm core is SKY_WARM steps 6-7** (`:1159`, `:1165`). Keep those two steps warm in every table.
- **Sky and fog share FOG.** In space the sky must be black while the haze stays bright. Give the sky its own row now: claim row 32, filled identically to FOG on the ground, so frames stay byte-identical.
- **`uFlash` paints the whole sky white at any strength** (`:957`). Lightning needs a lift instead (§5).

---

## 2. The sun as a variable

### 2.1 Everything that assumes the fixed sun

`uSunDir` readers, all of them: `main.ts:69` (write); `materials.ts:156`; `PixelPipeline.ts:169, 439, 517, 535, 854-860, 869-885`; `buildingMaterial.ts:225, 715, 723, 814`; `terrainMaterial.ts:79`; `BusModel.ts:349`; `Particles.ts:465`; `StreetSign.ts:876`.

| Assumption | Where | With a moving sun | Fix |
|---|---|---|---|
| The sun comes from config | `main.ts:66-70`, run every frame at `:974` | Overwrites anything Sky writes | Sky writes `config.light`, or `?sky` bypasses it. Note `config.ts:56` says WSW; 2.75 rad is compass 292.5°, WNW [M] |
| N·L has no horizon | `sbLight`, `materials.ts:156` | At -10° the west wall is still step 6.3 [M] | Key strength goes to 0 in Sky, no shader change |
| Copies of N·L | `buildingMaterial.ts:723`, `BusModel.ts:349-356`, `StreetSign.ts:876`, `Particles.ts:465-466, 584` | Follow the uniform | Nothing |
| Reflections ignore key strength | `sunR` `buildingMaterial.ts:715-716`, glint `:814-815, 828`, water `terrainMaterial.ts:79` | A glint from a sun below the horizon | Scale by `uLight.x / 0.52` in those three places |
| Sun camera sits 1,400 m along the ray | `PixelPipeline.ts:456` | Under the ground at night: renders casters from below | Skip the pass below the horizon |
| Sun pass near 1, far 3,000 | `:448-449` | Clips the window's own casters from 10.5° at street level; the ceiling window already clips at today's 25.2° [M] | Distance by elevation, §2.3 |
| Bias 0.0009 of the depth range | `materials.ts:147` | Means 2.7 m only because the range is 3,000 m | A uniform in metres |
| `sc.up` flips at `sun.y > 0.99` | `:458` | The texel lattice turns in one frame at about 82°, in the tropics | Pick up from the azimuth; with the knee the shading vector never gets there, but the key does |
| Cull sweep floors `sun.y` at 0.1 | `:517`, `:536` | Below 5.74° the swept box is short: 0.52 of the true sweep at 3°, 0.17 at 1° [M]. Real casters get culled | Floor at 0.02 |
| Vista shadow window | `config.ts:41-48`, `main.ts:1122-1129` | Works. Texel 0.78 m | Add a Sky factor on `shadowStrength` |
| Drop shadow is straight down | `main.ts:1230`, `PixelPipeline.ts:1113-1142` | Not a sun shadow, and DECISIONS:1429 says why | Keep it. It is a height cue, at every hour |
| Facade sky banding | `buildingMaterial.ts:716` | Glass keeps a day sky at night; the table covers most of it | `uGlassBands` is a live getter (`:57`): fade it |
| `skyMirror` mirrors the resolve | `:225`, `:687` | Must see the same vector and shape as the sky | Keep one `GLSL_SKY_LIGHT`, pass it the same uniforms |
| `GLSL_SKY_LIGHT` base 0.9 | `materials.ts:113` | A bright day sky at any hour, and `sunNear` is not gated by height. At -10° the sky toward the set sun is still step 6.9 [M] | `uSkyShape` uniform |
| `skyWarm` | `PixelPipeline.ts:855-861` | Warm band toward the sun's azimuth at every elevation: warmS is 1.00 at the horizon at 75° and at -10° [M]. `normalize` of zero at the zenith, reached at Lagos and Singapore (89.9° and 89.7° [M]) | Gate by sun height; guard the normalize |
| `seaShade` | `:867-889` | Bright fog sea at night, same zero normalize | Scale by key; the table does the rest |
| Fog top is SF | `sbLayerTop`, `materials.ts:72-84`, mirror `:88-99` | SF's east, north and bay in game metres apply in any city | §5 |
| Open water has no sun at all | `makeWaterMaterial`, `terrainMaterial.ts:194-216`; only the tile water does (`:79`) | Shore and bay disagree under a low sun | One shared glitter chunk, §4.6 |
| Warmth in the ramps | GREY top steps `#8d8f91 #b3aca2`, `palette.ts:60`; STONE `:84` | Warm light sits in the top steps, so it follows the lit side by itself | Table rows |
| "It is still afternoon" | Crown glass, `buildingMaterial.ts:315`; crown glow `:289, 309, 316` | Crowns should wake at dusk | `uCrownGlow` is a live getter (`:54`) |
| The clock reads ten to five | `landmarks.ts:321-328` | A landmark that disagrees with the sun | One uniform for real local time |
| Baked tone | None today: no sun or shading in `tools/bake` [M, grep] | The spike would add it, §9 | §9 |
| Sunbreak's premise | MAGIC-SPEC:553-554, spec only, not built | "The unpainted city stays under flat overcast" is false on a clear day and at night | Producer rule, below |

**Sunbreak needs a new sentence.** MAGIC #7 and STAGES bloom both assume grey overcast against painted sun. With live weather I suggest: overcast keeps the spec; a clear day keeps the pool as extra warm steps inside the table's day rows; at night the pool is paint's own spill through `uSunbreak` on ambient, since a moonlit `ndl * sh` term is too small to see [E]. It is a one-line change to a spec that isn't built yet, but it is the producer's call.

### 2.2 The five elevations

Today's `uLight`, unchanged: what the code does as written [M]. Steps run 0-7. "Spread" is the difference between the brightest and darkest wall, in steps.

| Sun | Roof | Sunward wall | Far walls | Street | Spread | 12 m house | 30 m wall | 260 m tower | Sun pass | Sky |
|---|---|---|---|---|---|---|---|---|---|---|
| **75°** | 7.0, clipped | 3.8 | 2.9 | 6.6 | **0.87** | 3 m | 8 m | 70 m | Fine, window 538 m long on the ground | Warm band at the horizon, wrong |
| **35°** | 5.9 | 5.7 | 2.9 | 5.2 | 2.76 | 17 m | 43 m | 371 m | Fine | Warm band, wrong |
| today 25.2° | 5.3 | 6.0 | 2.9 | 4.6 | 3.04 | 26 m | 64 m | 553 m | Fine at street level | Right |
| **5°** | 4.1 | 6.3 | 2.9 | 3.4 | 3.35 | 137 m | 343 m | 2,972 m | Near and far both clip; casters past 1,404 m sunward are lost | Right, should be redder |
| **0°** | 3.8 | 6.3 | 2.9 | 3.1 | 3.36 | none: ground has no sun | | | Ray level with the ground; window hits only ±260 m of height | Warm, disc absent |
| **-10°** | 3.8 | **6.3, lit by a set sun** | 2.9 | 3.1 | 3.31 | garbage | | | Camera 243 m under the ground, casters seen from below | Still bright, still warm |

What to read from it. Above 35° the walls lose their shape: 0.87 steps at 75°, under one band, which is DECISIONS:36's "melt into one grey", and roofs and streets clip at the top of the ramp. Below 5° the ground term is nearly gone, 0.3 steps at 5° [M], so all the drama is on walls and on what stands in shadow. Below 0° the code has no idea the sun has set.

### 2.3 Shadows at a low sun

**The 520 m window is not the problem.** It is a square across the rays, so on the ground it stretches along the sun's azimuth: 1,221 m at 25.2°, 5,966 m at 5°, 29.8 km at 1° [M]. The real limit is depth. `updateShadow` puts the camera 1,400 m out with near 1 and far 3,000, so casters more than 1,399 m toward the sun are clipped [M]. A 260 m tower's 2,972 m shadow at 5° therefore stops short.

Texels stretch the same way: 2.9 m on the ground along the azimuth at 5° on the street window, 9 m on the ceiling window [M]. That direction is the length of the shadow. The long sides are resolved across the azimuth at 0.25 m, so they stay crisp and only the tip goes coarse. A lucky geometry.

**Recommended rules** [E]:

| Sun or key | Sun pass |
|---|---|
| ≥ 12° | As today |
| 3-12° | Camera distance `clamp(0.55 * ext / tan(el) + 300, 1400, 6000)`, far `2 * D + 600`, bias a uniform in metres, floor of the cull sweep 0.02. Expect the sun pass to draw more at golden hour; cap D if it costs |
| 0.5-3° | Fade `shadowStrength` to 0 with the key strength. A 326 m tower would throw 6-18 km; no window reaches it. (The polar exception is the height sweep in VERDICT §7, not this pass) |
| Below 0.5° | `shadowStrength = 0`: `updateShadow` returns at `:435-438` and the pass is skipped. The warm-up already binds the map first (`:674-678`), so a night boot should be safe; check it with `warmcheck` |

Acne: one texel's depth slope on flat ground reaches the 2.7 m bias at 5° on the street window and at about 16° on the ceiling window [M]. On the street window it should be harmless: at 5° the ground's sun term is 0.3 steps [M], so a speckle rarely crosses a ramp step [E]. On the ceiling window the term is still about 1 step at 16°, so scale the bias with that slope there.

**Moonlight through the same pass.** `Sky` picks the key:

| Sun | Key vector | `uLight.x` | Shadows | Table |
|---|---|---|---|---|
| ≥ 28° | sun, knee on `uSunDir` | 0.46 | yes | noon |
| 6-28° | sun | 0.52 | yes | day (today's bytes) |
| 0.5-6° | sun | 0.52 → 0.30 | fading under 3° | golden |
| -6 to 0.5° | afterglow: sun's azimuth, held at +8°, no shadows | 0.30 → 0.06 | no | dusk |
| -12 to -6° | Moon if up, else afterglow | 0.22 x illumination, floor 0.04 | Moon only | blue hour |
| below -12° | Moon if up, else afterglow | 0.22 x illumination, floor 0.04 | Moon only | night |

(Starting numbers [E]; ambient stays 0.30, or 0.28 at noon, and bounce 0.24.) Cross the vector over only while `shadowStrength` is 0, so a shadow never swings. The real ratio is no guide: full Moon is about 430,000 times fainter than the Sun, from magnitudes -12.74 and -26.83 ([Wikipedia](https://en.wikipedia.org/wiki/Apparent_magnitude)) [S].

In San Francisco in 2026 the Moon is above 8° and over 25 % lit for 41 % of dark hours, and below the horizon for 50 % [M]. **So half of all night play has no key light at all, and the moonless look must stand on its own.**

### 2.4 Slowly moving shadows and the texel snap

The snap at `:461-467` rounds the light camera's position to multiples of a texel along `right` and `up`, which come from the sun's direction. It stops the window's movement from crawling. It does nothing for a turning sun, for two reasons:

1. The lattice is anchored at the world origin, so a turning sun swings it like a lever: 0.14 street texels a second at 500 m from the origin, 2.3 at 8 km, 14 at 50 km, the floating origin's limit [M].
2. There is no filtering: depth is `NearestFilter` (`:231-232`), so an edge moves by whole texels.

A CPU port of that lattice and compare (boxes on flat ground, 0.17 m ground pixels, 30 fps) [M]:

| Sun | Distance from origin | Sun moves every frame: edge pixels flipping per frame | One tick after 20 s held |
|---|---|---|---|
| 25.2° | 0 | 0.12 % | 34 % of edges, 0.14 % of pixels |
| 25.2° | 3 km | 3.6 % | 56 % of edges, 0.90 % of pixels |
| 25.2° | 8 km | **13.6 %** | 27 % of edges, 0.14 % of pixels |
| 25.2° | 50 km | **46 %** | 57 % of edges, 0.40 % of pixels |
| 5° | 8 km | 22 % | 125 % of edge count, 0.71 % of pixels |

Each row has its own random scene, so compare percentages, not counts. The point is the left column: a sun that moves every frame boils at any real city position. The true motion is far slower than that boil: a 30 m wall's tip moves 3 game px a minute at 25°, 8 at 15°, 71 at 5° [M].

**The rule.**

1. `uKeyDir` and `uSunDir` change only at a tick. Between ticks the lattice is frozen and shadows cannot crawl.
2. The sky's own sun vector is separate and continuous, so the disc doesn't hop.
3. Tick when the tip of a 30 m wall would have moved 2 game px (0.34 m at the bus): about 40 s at 25°, 15 s at 15°, 7 s at 10°, 1.7 s at 5° [M from the speeds above], with a floor of 1 s. That satisfies MAGIC's "move at least 2 game px or not at all" (`MAGIC-SPEC.md:119`) and "no full-surface change faster than 2 Hz" (`:123`).
4. Fire the tick on a frame where the camera moved at least 3 game px, so the whole frame is resampling anyway. At a held altitude ("perfectly still", DECISIONS:67-73) wait up to 60 s, or for the next turn.
5. Near sunset this becomes a feature: shadows visibly creep at 1-2 px a second.

Fallback if ticks read as pops on the phone: keep the sun moving but anchor the snap to a point near the bus instead of the world origin, re-anchored every few hundred metres. That is the 0.12 % row, a steady thin sparkle instead of a rare pop. Both are a few lines; A/B them behind a flag.

**A bonus.** With the direction held and casters static, the map is world-fixed, so it need not re-render every frame. Re-rendering every 2nd-4th frame while the window moves under about 16 texels would save most of a pass that costs 1.9-2.5 ms on the UHD 620 (DECISIONS:1572) [E]. Force a render on blast frames (hops and pops move casters) and during fast yaw (`cullCasters` culls by view). Untested, and not needed for the sky, but it is the cheapest budget in this report.

### 2.5 The noon problem

**The tension.** DECISIONS:36-37 rejects flat light. WORLD-TRAVEL:411-412 compresses elevations above 35°. The producer asked for accuracy. How often it bites [M]:

| Place | Daylight with sun ≥ 28° | ≥ 35° | ≥ 50° | Highest |
|---|---|---|---|---|
| London | 40 % | 29 % | 11 % | 61.9° |
| San Francisco | 54 % | 40 % | 21 % | 75.7° |
| Tokyo | 57 % | 42 % | 22 % | 77.7° |
| Lagos, Singapore | 67 % | 59 % | 40-41 % | 89.7-89.9° |
| Reykjavik | 29 % | 18 % | 0 % | 49.3° |

**Reject WORLD-TRAVEL's rule.** It moves the sun. Held at 35°, a true 75° sun draws a shadow 5.3 times too long (1.43 h against 0.27 h) [M], and the disc sits up to 40° from the real one. Anyone can check that against the street outside, for more than half of the day in the tropics.

**Recommend: the true sun for everything a player can check, and a knee on one vector.**

- True: disc, sunrise and sunset, shadow direction and length, water glitter, stars, Moon.
- `uSunDir`, the vector materials shade with, keeps the azimuth and takes a soft knee on elevation: unchanged to 28°, approaching 42° at the zenith. Materials don't change at all.
- Add a noon table: cleaner, cooler top steps and a deeper shade step, so high sun has its own look (hard, short, graphic) instead of being a failed afternoon.
- Say it in the credits line: "Sun, Moon and shadows are real. Walls are shaded for readability at midday."

| True sun | Shades as | Wall spread before → after | Roof light before → after |
|---|---|---|---|
| 90° | 42.0° | 0.00 → 2.50 steps | 1.00 → 0.89 |
| 75° | 41.4° | 0.87 → 2.52 | 1.00 → 0.88 |
| 60° | 39.2° | 1.68 → 2.61 | 0.99 → 0.87 |
| 52° | 37.2° | 2.07 → 2.68 | 0.95 → 0.85 |
| 35° | 31.2° | 2.76 → 2.88 | 0.84 → 0.81 |
| ≤ 28° | same | same | same |

All [M] with today's `uLight`, before the small noon cut above. A wall facing away from the true sun also faces away from the knee vector, because the azimuth is the same, so light and shadow never disagree on which side is lit.

Near the zenith the true azimuth swings 180° in minutes. Slew-limit the shading azimuth (about 40° an hour [E]) so walls don't flip. On a body with no air, turn the knee off: research-polar-lunar §5.2 is right that the Moon's noon needs no special case.

---

## 3. Night

### 3.1 Why it matters more than the brief says

San Francisco, 2026, share of all hours [M]: sun ≥ 35° 20 %, 6-35° 25 %, 0-6° 4.5 %, civil twilight 4.5 %, nautical 4.6 %, darker 41 %. By local clock (a year-round mean offset of UTC-7.5) the sun is below -6° on 46 % of days at 19:00, 73 % at 20:00, 100 % at 21:00. An after-work player sees night most of the year, and the late-afternoon look the game was built on (`config.ts:56`) is about a quarter of all hours.

### 3.2 Why blue hour and not black

`mock-night.png` columns B and C, real frames [M]. B is night by light alone: every step scaled to 35 % in its own ramp, a gentle cut. (B also dims the bus, which the real game would not do.)

| | Colours in the frame | Pixels with L < 0.25 | Mean L |
|---|---|---|---|
| A day | 115 / 103 | 0.4 / 0.2 % | 0.60 / 0.63 |
| B light only | **54 / 50** | 3.3 / 5.3 % | 0.40 / 0.42 |
| C blue-hour table | 110 / 99 | 0.2 / 0.2 % | 0.50 / 0.52 |

By eye, B is the worst frame in the set: the grey goes murky, the ground drops out, and paint loses its shine and starts to read as brick. C keeps every shape and paint looks lit.

The reasons, in order:

1. Light alone throws half the palette away; the ramps' bottom steps are near-black and close together.
2. Outlines need room: a silhouette is two steps down (`:1039`), and at step 1 there is nowhere to go.
3. Paint reads as light only against mid values.
4. The game's promise is a real city you recognise.
5. A black frame on a phone reads as broken.

WORLD-TRAVEL:413 says blue hour, never black; these are the numbers for it.

### 3.3 Lit windows

**Where they go.** Two paths, both already holding a per-window id: houses at `buildingMaterial.ts:826-829` (`cell` from `windows()`, `:204-215`) and towers at `:390-394`, which already has `hh < 0.06` dark and `hh > 0.955` lit panes.

**Which windows glow.** One stable threshold per window, never a timer:

```glsl
// unpainted glass, after its day light
float want = home ? uLitHome : uLitWork;          // two uniforms from local civil time, day of week
if (h21(cell + vec2(bIdx * 0.13, 5.0)) < want) { ramp = WINDOW_LIT; light = 0.55 + 0.3 * h21(cell + 11.0); glow = uWinGlow; }
```

As `want` falls, windows go out one at a time and stay out, which is the small realistic detail, and it costs nothing per frame. The data:

- `cell` and `bIdx`: every building has them.
- `arch`: home for VICTORIAN, FLATS, STUCCO, MARINA, GENERIC; work for COMMERCIAL, CIVIC and tower families. The bake sets arch from OSM `building=*` through `occ` (`bake.py:1688-1689`, `:2192-2205`). One flaw: anything over 38 m is `tower` whatever its use.
- Local civil time needs a `tz` in city.json (`CityManifest`, `tiles.ts:36-56`, has none); WORLD-TRAVEL:423 already plans it.
- The occupancy curves are my guess until checked [E].

**One new row, WINDOW_LIT** (row 38): rose → peach → cream, so dim windows go rose and never brown. My mock ramp passes the brown test [M]. Keep its top steps less saturated than paint: art's rule is that paint alone is saturated. Offices can use GLOW_WHITE's cooler steps.

**The distance problem, and the mock's clearest warning.** In `mock-night.png` column D I lit 2 x 3 px blocks by hash. Near rows of houses read beautifully as evening streets. The distant tower turned into **a block of white TV static**. Single lit pixels in a random pattern are exactly what ARCHITECTURE:105 warns about, and the far LOD removes windows anyway (`flatW`, `:514`, `:569`). So:

| Size at the building | Windows | Rule |
|---|---|---|
| ≥ 2 x 3 px | Real panes, per `cell` | As above |
| Ribbon (`mppB > 0.6`) | Whole floors lit or dark | `cell.x` is already 0 there (`:211`) |
| Towers, past the pane gate | Lit lines through the existing `rhythm()` (`:248-255`) | Never closer than 4 px apart, doubling with distance |
| Flat (`mppB > 1.15`) | One tone per face: a face is lit or not, by hash of building and normal, with `cover * want` as the chance | No per-pixel pattern at all. Tone is stable; a mosaic of dim warm faces reads as a far city |

Run `tools/shimmer.py` on this before anyone falls in love with it. At the very far end some twinkle is honest, since real city lights twinkle, but the spike's far band must decide it, not this code (§9).

### 3.4 Street lights from data any city has

The client has the 2 m class texture for every city and, on OSM bakes, named street centrelines (`tiles.ts:194-200`, `:257-284`). OSM's own lamp data is large but patchy: 6.8 M `highway=street_lamp` nodes and 15.6 M `lit=*` objects worldwide ([taginfo](https://taginfo.openstreetmap.org/api/4/tag/stats?key=highway&value=street_lamp), [lit](https://taginfo.openstreetmap.org/api/4/key/stats?key=lit)) [S]. That is too uneven to be the base, though it could be an upgrade.

**Recommend pools in the terrain shader, no bake:**

- A hashed lattice of 28-30 m cells, one lamp per cell at a jittered spot.
- A pool up to about 11 m, drawn only on PAVED, SIDEWALK, PLAZA and PATH.
- Pools lift the ground a step or two.
- Because the class mask shapes them, they trace the real street plan: from the ceiling they read as strings of light along every road.
- One uniform `uLamp` turns them on with a per-lamp threshold, so they come on in waves around sun -2°.
- +12 ALU on ground pixels, zero by day behind a uniform branch [E].

Optional later: real lamp heads as one shared Points draw along the centrelines near the bus.

**Far away:** street cells in the far raster get one lit step; §9 keeps that path open. For a metro-scale brightness, NASA's Black Marble nightlights are measured, with VIIRS day/night band data at 750 m under NASA's open science policy ([Earthdata](https://www.earthdata.nasa.gov/data/projects/black-marble)) [S]. That page warns that Suomi NPP delivery ends on 2 Nov 2026, two days from now, and to plan for NOAA-20 and -21. It would suit the planet layer better than WORLD-TRAVEL's counted-buildings glow (`WORLD-TRAVEL.md:346`).

### 3.5 Headlights

`config.camera.headBeam*` (`config.ts:156-159`) is already light, not geometry: the resolve lifts grey ramps one or two steps inside a screen wedge (`PixelPipeline.ts:1143-1168`), with no draw. At night:

- Lengthen it (42 → about 90 m) and raise the step gain, since a night table's steps sit closer together. The constant 2.6 at `:1163` becomes a uniform.
- That is all it needs.

**Tried and rejected:** making the wedge read the day table, so the beam "reveals the daytime city". In `mock-night.png` it looks like a pasted triangle of another picture, even in the kindest column. Stay inside the night table.

### 3.6 Glow cost

The glow pipeline is three half-res passes every frame whatever is on screen, so **more glow costs nothing** except the halo branch's small tint loop near bright clusters. What matters is the gate: `hAmt > 0.11` (`:1077`). The exact kernel gives [M]:

| Emitter | Peak hAmt at glow 1 | Glow needed to cross the gate |
|---|---|---|
| 1 px window | 0.023 | never (4.7) |
| 1 x 2 px | 0.044 | never (2.5) |
| 2 x 3 px | 0.125 | 0.88 |
| 4 x 6 px storefront | 0.445 | 0.25 |
| 8 x 8 px | 0.992 | 0.11 |

So single windows don't bloom and leave no dust. A wall of windows starts to glow at about 30 % lit at one 1 x 2 window per 3 x 4 px cell [M]. **The trap is the far city:** 8 % of pixels lit at random at glow 1 pushes 84 % of the area over the gate [M], a boiling halo over everything. Rule: `share x glow ≤ 0.06` on far surfaces [M, from that run].

Painted stained glass (`uGlassGlow`, `uGlassGlow3`) and crowns (`uCrownGlow`) are live getters: raising them at dusk is one assignment and no compile. MAGIC's budget still applies: resting surfaces ≤ 0.55 (`MAGIC-SPEC.md:83-86`).

---

## 4. The sky band

### 4.1 What the frame can hold

From `CameraRig.ts` and `config.ts` [M]:

| Pose | Lens | Top of frame | Horizon, from top | px per degree | Sun / Moon |
|---|---|---|---|---|---|
| Slow | 24° | **2.2°** | 4.9 % | 16.1 | 8.6 / 8.4 px |
| Cruise | 24° | 5.9° | 13.0 % | 16.1 | 8.6 / 8.4 px |
| Surge | 24° | 10.4° | 22.2 % | 16.1 | 8.6 / 8.4 px |
| G1 | 29° | 14.4° | 26.2 % | 13.3 | 7.1 / 6.9 px |
| Ceiling | 38° | 14.7° | 22.9 % | 10.0 | 5.3 / 5.2 px |
| `openingLow` | 24° | 23.5° | 47.6 % | 16.1 | 8.6 / 8.4 px |

**Two corrections to the brief.** The Moon is about 8 px on the street lens, not 5; 5 is the ceiling lens. And slow flight has only 2.2° of sky, not 6.

`mock-moon-sizes.png` [M]: at 8 px a crescent, half and gibbous all read clearly. At 5 px the phase still reads but a full Moon looks like a donut. Maria start to read at 11-14 px. So I suggest a size floor of **11 px** (1.3x true on the street lens, 2.1x on the ceiling lens), with position and phase exact, as the brief says.

### 4.2 Order in the sky branch

Back to front, all in `:935-960`, all writing alpha 0:

1. Base gradient, from `uSkyRow` and `uSkyShape`.
2. Milky Way.
3. Stars, read from the G-buffer.
4. Sun disc.
5. Moon (it covers the Sun, so a solar eclipse needs no special code).
6. Clouds, high to low.
7. Horizon haze.
8. Existing halo and flash, which are the only things that set alpha 1.

### 4.3 Holding still

ARCHITECTURE:133-137's rule: plain sky writes alpha 0 and the upscale takes the unshifted texel, or the sky saws by a pixel with the snap's remainder. Four consequences:

- **Everything celestial is alpha 0.** Written with alpha 1 it would ride the sub-pixel shift and jitter against its own sky.
- **Dither with `dsk` only** (`:921`, screen-anchored), never `d`.
- **Sun and Moon snap to whole pixels on the CPU.** A disc computed per pixel from `dir` changes shape by a pixel as the view yaws: a round edge shimmers. After `snap()`, project the body with `snapCam`, round the centre to a whole buffer pixel, and pass (cx, cy, r). The shader tests the integer offset from that centre, so the shape is a stable sprite that hops by whole pixels. Per sky pixel that is a 3-ALU circle test instead of a ray-sphere. Sphere shading runs only inside the disc, from the offset.
- **Past about 40 px apparent size, switch to the real ray-sphere test.** Float32 is fine for it: limb error 0.0016 px at the Moon's distance with the plain quadratic, effectively 0 with a cross product of unit vectors [M]. CPU doubles compute the position; the shader only sees direction and angular radius.

### 4.4 The bodies and stars

**Sun.** Core GLOW_WHITE 7, one ring of SKY_WARM 7, with the TWILIGHT row when low. Draw it at refracted elevation so the game's sunset is the real moment: NOAA uses 0.833° at the horizon ([NOAA](https://gml.noaa.gov/grad/solcalc/calcdetails.html)) [S]. For glare across silhouettes, `light += uGlare * pow(dot(dir, sun), 64)` in the surface path, about +3 ALU, off (a uniform branch) unless the sun is near the frame.

**Moon.** Normal from the offset, N·L against the true sun gives the phase; albedo from a 128 x 64 R8 map (8 KB); the dark side sits one step above the sky as earthshine. Earth from the Moon is the same code at about 31 px on the street lens [M]. The same sky-branch code also carries the fixed views from orbit and from the Moon the brief asks for.

**Stars.** Not in the resolve, not after it:

- One `THREE.Points` in the scene pass, vertex = direction, `gl_Position = proj * mat3(view) * dir` with `z = w`, writing ramp and magnitude through `sbWrite` with glow 0.
- Depth test hides them behind geometry for free.
- `z = 1` keeps the pixel in the sky branch, which reads the star byte from `tG` (+1 fetch) and draws it only if no cloud or Moon covers it.
- Alpha stays 0. Drawing after the resolve would need a mask against clouds that the target cannot give.
- A body rotation matrix in the uniform makes them work from any body.

How many exist in that band [M], from star counts per magnitude ([Wikipedia](https://en.wikipedia.org/wiki/Apparent_magnitude)) [S], assuming a uniform sky:

| View | Area | m < 4 | m < 5 | m < 6.5 |
|---|---|---|---|---|
| Street cruise | 141 sq deg | 1.8 | 5.5 | 31 |
| Ceiling | 552 | 6.9 | 21 | 122 |
| Look-up, 38° lens, pitch 5 | 1,141 | 14 | 44 | 252 |
| Look-up, 50° lens, pitch -10 | 2,403 | 30 | 93 | 530 |

A real inner-city sky stops near magnitude 4 ([Bortle 8-9](https://en.wikipedia.org/wiki/Bortle_scale)) [S], which is two stars in the street band. **So star positions can be exact, but star count must be stylised**: all of the roughly 9,100 stars to magnitude 6.5, about 36 KB [E: 4 bytes each], as if the city switched off its lights. Fade in by magnitude as the sun drops: only the brightest during civil twilight, sixth magnitude by astronomical dusk ([Wikipedia](https://en.wikipedia.org/wiki/Twilight)) [S]. Column E of `mock-night.png` shows up to 60 random dots in the band: lovely, but not true of any city. Producer's call; I would take it. Constellations can't be recognised in a 24° x 6° strip [E], so they belong to the look-up (§6): one LineSegments draw of about 700 segments [E], on only then.

**Milky Way.** Analytic: `exp` of the distance from the galactic plane times the tiling noise, one or two steps of the sky row, off when the Moon is up. About +10 ALU at night [E].

### 4.5 Clouds at three heights

Ray-plane tests in the sky branch at about 1.5, 4.5 and 9 km, each sampling one tiling R8 noise (64², 4 KB, generated at boot) with a threshold from the live cover. One extra fetch toward the sun when it is low gives lit edges and warm undersides.

Foreshortening comes free. A 5 km cell on the low deck at 3° elevation is about 160 x 9 px [E], the long streaks real decks show. Cells drop under 2 px below about 1.5° [E], so fade into the horizon band there, and keep VERDICT's "cells never under 2 px".

Drift is slow, about 0.5 px a second [E]. Keep band edges hard with a narrow dither, or `dsk` slides through them. Cloud rows come from the table: CLOUD (row 35) lit, a shade row beside it. MAGIC's `uSkyWarm[32]` azimuth LUT (`MAGIC-SPEC.md:576-578`) still fits: `warmS = max(sunTerm, lut)`, and at night it becomes paint-lit cloud over a painted district.

### 4.6 Glitter

A shared chunk for both water paths (`terrainMaterial.ts:79`, `:194-216`):

- Hashed world cells of at least 2 px.
- Re-hashed at 12 fps (`MAGIC-SPEC.md:120`).
- Lit only where the facet reflects the key to the camera.
- Width from live wind; the cell scales with `fwidth`.
- SKY_WARM when the key is a low sun.

It reads `uKeyDir`'s real direction, so **the Moon's road on the bay appears even when the Moon is off screen**: the chase frame looks 0-43° below level, so any Moon at 3-43° elevation can land its glitter in frame [M, depression angles], given a heading close to its azimuth and water in view. In San Francisco that elevation holds for 33 % of dark hours [M], while the Moon itself is in the cruise frame's height range for only 9.5 % of the time it is up [M]. This is the brief's "the beauty must land on the ground", in one chunk. It replaces today's dash hash, which VERDICT says flips up to 4.5 % of pixels at random.

---

## 5. Weather on the ground

Everything here is uniforms and small branches, off when clear. The drivers are a handful of numbers, whatever the feed: cover low, mid and high; sun attenuation; visibility; wind; precipitation type and rate; wetness; storm flag.

**Cloud shadows, no pass.** In the resolve, before `rampStep`:

```glsl
if (uCloudK > 0.0) { vec2 c = (P.xz + uCloudOff) * uCloudScale;   // P as at :1012, the sun offset from cloud height
  light -= uCloudK * smoothstep(th - 0.02, th + 0.02, texture(tNoise, c).r); }
```

Reconstructing P already happens twice in that function; share it. It darkens through light, not through a ramp lookup, so the flat-light test still rounds it and a flat wall gets a crisp contour instead of a dither. +1 fetch on every surface pixel, +5 % of resolve fetches [M from counts, §8], only in broken cloud. Under full overcast use `shadowStrength` and `uLight.x` instead; there are no shapes to draw. Skip `heroRamp`. Doing it in the resolve avoids touching and re-linking every material; the cost is that the texel is per pixel on everything.

**Rain.** One `LineSegments` draw, 300-1,600 lines; at GL's default width a line is one game pixel wide. All motion in the vertex shader: a box wrapped around the camera, `mod()` of seed + fall + wind - camera, so no CPU per frame and no uploads. Fill is 0.5-4.8 % of the frame [M], with no `discard`, which matters on a tile GPU (VERDICT §4). Depth-tested against the city, written through `sbWrite` with flags 0.5. MDN only documents that width limits are implementation-dependent ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/lineWidth)) [S]; a default width of 1 is what is wanted here. Topology is part of the warm key (ARCHITECTURE:210-212); `warmup.ts:166` already handles `LS`.

**Snow.** One `Points` draw, about 900, 1-2 px, slow, swaying. For snow lying on the ground: in the resolve, up-facing grey pixels take WHITE when `uSnow` is on, +8 ALU then [E].

**Wet streets.** In the terrain shader, on paved classes, under `uWet`: darker asphalt plus the same sky fresnel the water class uses at `:79`. For the iconic part, in the resolve on wet ground pixels, sample `tGlow` a little up the screen: painted walls and lit windows smear down the street as vertical reflections. 2 fetches on those pixels only. Puddles are low-frequency noise raising `uWet` locally to a mirror.

**Puddle sparkle.** Hashed cells of about 1.5 m in the same branch, re-hashed at 6 Hz, near field only, cells never under 2 px.

**Fog from live visibility.** Koschmieder: V = 3.912 / β ([Wikipedia](https://en.wikipedia.org/wiki/Visibility)) [S]. Today's `density` 0.00125 is exactly 3.1 km of visibility [M]:

| Visibility | `uFog.x` | Fog at 500 m | At 2 km |
|---|---|---|---|
| 16 km | 0.00024 | 0.12 | 0.39 |
| 10 km | 0.00039 | 0.18 | 0.54 |
| 3.1 km | 0.00125 | 0.47 | 0.92 |
| 1 km | 0.0039 | 0.86 | 1.00 |

(Before the height factor `0.35 + 0.65 hf` at `materials.ts:175`, about 0.74 at chase height [E].) Three cautions:

- Applied literally, an ordinary 16 km day has 39 % fog at 2 km, which brings back what the producer removed. Treat 10 km and up as clear; I expect reported visibility to top out about there [E, see the weather report], and fog is then real fog.
- Clamp the low end near 900 m so the bus's surroundings stay playable [E].
- `sbLayerTop` must lose its SF geography for other cities. Gate it the way `isSfOrigin` already gates SF's icons (`City.ts:450`, DECISIONS:1392-1395): one uniform, `uFogLayer` from live cloud base, billows kept, and `layerTopBase` follows.

`config.fog.enabled` (`main.ts:72-81`) becomes the weather's output, not a switch. No program changes: it is all uniforms. `kMatch` needs the fix in §1.5 first, or the fog band jumps.

**Lightning.** `pipeline.flash()` exists (`:336-341`). Add a strength where the sky lifts steps instead of going white (`:957`). The bolt is a short polyline in the same sky-lines draw as the constellations; the storm table gives the frame. Cap at three flashes a second ([WCAG 2.3.1](https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html)) [S], as `firehoseFlashes` already does (`config.ts:495`).

**Wind.** Trees sway in code only when painted (`trees.ts:243-256`), and the comment at `:244` and `MAGIC-SPEC.md:81-82` make "grey never moves" law. So wind can scale painted sway (`uTreeShape.y`), glitter width, cloud drift, rain slant and a `uWind` term on puffs and drops in `Particles`. **Grey trees moving in a real storm would break that law: producer's call.** I would keep the law; a painted tree tossing in a grey still city is a better picture.

---

## 6. The camera

### 6.1 What the player can see today

In San Francisco in 2026, share of Moon-up time with the Moon under the top of the frame [M]: cruise 9.5 %, surge 17 %, ceiling 24 %. Sun, share of daylight: 8.9 %, 16 %, 22 %. And it must also be within 12-19° of the heading. So on most evenings the Moon is not in the picture.

The rig's own rules bound the answer. "Only the yoke moves the lens" and "a rotation can't be snapped" (DECISIONS:67-73, `CameraRig.ts:125-135`): any pitch change resamples the whole frame, so a move must be a brief event, then still. MAGIC:121 gives the camera to polish/look.

### 6.2 The options

| Way | Top of frame | Moon-up time in reach [M] | Bus on screen | Fights tilt or hybrid? | Verdict |
|---|---|---|---|---|---|
| Today: cruise, surge, ceiling | 5.9 / 10.4 / 14.7° | 9.5 / 17 / 24 % | yes | no | Keep. Put the beauty on the ground (§4.6) |
| **Gentle pitch-up at rest:** +10° after 6 s with no stick and no tap, any input cancels | 16° street, 25° ceiling | 26 % / 45 % | yes | No: tilt in its dead zone counts as rest | **Yes.** Ease over 1.5 s, then hold still. Aim glint is off screen meanwhile, so rest must mean rest |
| **Pull at the ceiling:** the yoke has nothing left to do, so pulling lifts the view as the bus strains | up to 42° at +27° | 71 % | yes, to +27.3° | No: the same pull, on either input, and `flight.strain` already says when | **Yes, the best one.** The struggle bus straining at the Moon it can't reach is the turbo-flight story, and it teaches where the Moon is |
| **Sky moment at sunset:** reuse `rig.openingLow` (`CameraRig.ts:41, 90-97`) as a soft 8 s beat, hands off, sun within ±40° of the heading, once a sunset | 23.5°, horizon at 48 % | 42 % | yes, silhouetted against the sky | No: it runs hands off and any input ends it | **Yes, with a limit.** That path was built over the bay. A low camera in a dense city needs clearance: only over water, low rise or from height |
| **Hold the phone up:** past `awayFrom` (58°) tilt already lets go of the stick (`Tilt.ts:246-247`, `config.ts:284-285`), so that pose is free | 40-55° with lens 50 | 69-85 % | no, past about +19° | No, by construction | **Yes, as a hidden delight.** Tilt players only. Pitch only: compass is a further iOS step |
| **Sky chip:** a contextual HUD button for an event (full moonrise, eclipse), hold to look | as above | as above | clutched flat: it is a reach (`ARCHITECTURE.md:662`), the bus flies straight | No, reaches already clutch | **Later.** One chip, only for events. "No HUD" is a rule, and this bends it |
| Second finger, two fingers, three fingers | | | | **Yes:** these are splat, splat and tuner (`hybrid-controls.md:191-194`) | No |
| Swipe | | | | **Yes:** a swipe is a drag (`:196`) | No |

The bus sits 60 % down, so the view can lift 18.7° at cruise and 27.3° at the ceiling before it leaves the frame [M]. A wider lens during the look adds sky: 38° lens at pitch 5 tops out at 31.7°, 50° at pitch -10 at 55.3° [M]. A Moon above 55° needs the bus out of frame; that is a photo, not play.

**Build:** one `rig.skyLift` (degrees, eased) added to the look target at `CameraRig.ts:120` and to `p` at `:132`, with a `rig.skyLens` beside `turboFov`. One value, three triggers. A look-up frame is also cheaper, not dearer: sky pixels cost a seventh of near-surface pixels in fetches (§8).

On the Moon flight itself the camera aims along the path, the Moon is ahead, and none of this is needed.

---

## 7. Beyond the atmosphere

What must not be hard-wired, so the climb and the Moon work later. "Now" is what to do in the sky build; none of it is flight code.

| Thing | Today | Why it breaks | Now |
|---|---|---|---|
| **Sky test** | `z >= 0.99999`, `PixelPipeline.ts:935, 980` | Not "no geometry" but a distance: with near 1.5, 1/d = 1/150,000 + 1/far. Sky starts at **25.0 km** today, 29.0 at far 36 km, 57 at 92 km, 136 km at WORLD-TRAVEL's 1,500 km [M] | Test the clear itself: flags byte 0 in `sbAux(p).a`, which is independent of near and far. Stars then set a sky flag value. Failing that, `z >= 1 - 2^-24` reaches 99.9 % of far at 30 km and 94 % at 1,500 km [M] |
| **Far plane** | Literal 30,000 at `:145`; `clearFarFull` 20,000 | Earth's horizon is 92 km from the ceiling, the Moon's 48 km (research-polar-lunar §5.1) | One function of height. No other literal |
| **Depth precision** | 24-bit (`:269`, three maps it to `DEPTH_COMPONENT24`) | Step d²/(n x 2²⁴): 25 m at 25 km with near 1.5, 739 m at 136 km [M] | WORLD-TRAVEL §1.5's adaptive near. Three r186 has `reversedDepthBuffer` behind `EXT_clip_control`; a survey shows it on iOS ([web3dsurvey](https://web3dsurvey.com/webgl/extensions/EXT_clip_control)) but I found no Apple statement [S]. Don't depend on it |
| **"Up" is +Y** | `dir.y` in `sbSkyLight`, `seaShade`, `layerView` (`:928`), the fog hack at `:1006` | Fails in orbit and after a rebase | A `uUp` uniform now, +Y for the whole city game |
| **Elevation as an input** | `sunElevation` | No meaning from orbit or on another body | Sky takes UTC and an observer on a body and returns **vectors**. Height comes from `dot(up, sun)`, never stored |
| **Sky colour** | `RAMP_FOG` literal at `:951` | Sky must go black while haze stays bright | `uSkyRow`, row 32, §1.5 |
| **Sea plane** | 60 km square at y = -0.6, `City.ts:498-499` | Floods the Moon; has an edge from height | `Body.sea`, nullable |
| **Far fade** | Unconditional, `materials.ts:176` | The black band on the Moon (VERDICT §6) | `uFog.w` is unused (`:129`): make it an air factor, 1 on Earth, 0 with no air |
| **Fog constants** | `heightFalloff` 120 m, `uGroundRef`, layer tops in `config.fog` | All flat-world heights; WORLD-TRAVEL §2.2 swaps them above 2 km | Move to a `Body` air record; numbers unchanged |
| **Palette rows** | 32-37 reserved, 38-47 spare (`palette.ts:39-43`) | VERDICT §8 asks for about 8 more, I add WINDOW_LIT: 10 spares gone | `RAMP_COUNT` 64 costs 512 B [M, arithmetic]. The ramp byte holds 255. Every keyframe table must name every row |
| **Key light** | One vector, one pass | Earthshine is a second, weak light | Second light is ambient tint only, not a second pass: the table's job |
| **Sun pass literals** | 1,400, 3,000 | §2.3 | Function of elevation and window |
| **Gravity, sound** | `uLand.x` 34 (`Particles.ts:119, 464`) | Moon arcs (research-polar-lunar §5.5) | Already a uniform: read it from `Body` |
| **Knee, table set** | new | The Moon's noon must be true, and its sky has no blue | Both belong to `Body` |
| **`config.turbo` gates, ceiling** | `config.ts:194, 292` | Not render, but the look-up (§6) keys on them | Read through one accessor |

**Bodies in the sky branch.** At most three at once: Sun, Moon, Earth. Sort by distance on the CPU, nearest wins, so eclipses and Earth occulting the Moon need no logic. The Moon a player sees is then literally the one they can fly to: same position, same phase, same shader.

---

## 8. Budget

Baseline: 27 programs, 42-74 sun-pass draws plus 42-66 G-buffer draws, 0.59-1.1 M triangles at the pinned spots (DECISIONS:2369-2381). I count resolve fetches from the code: a surface pixel inside the outline fade makes 21, past it 13, a sky pixel 3 [M, by reading; compilers may merge some]. A street frame averages 16.5 fetches a pixel (13 % sky, 60 % near), a ceiling-like frame 14.3 (23 % sky, 45 % near) [E on those shares]. Percentages below are of resolve fetches, as a proxy; I could not get the resolve's share of an A15 frame.

| Feature | Draws | Triangles | GPU vs today [E unless noted] | Code | Data | New program? |
|---|---|---|---|---|---|---|
| Ephemeris and `Sky` | 0 | 0 | CPU, ≤ 2 Hz, unmeasured | 116,424 B min, 46,692 B gz [M] (+10 % of main.js, DECISIONS:1583) + ~8 KB | 0 | No |
| Palette tables | 0 | 0 | One ≤ 1.5 KB upload at ≤ 2 Hz | ~1 KB | 1-4 KB | **No** |
| Three vectors, knee, tick | 0 | 0 | None | ~1 KB | 0 | No; adds uniforms to `GLSL_COMMON` |
| Sun pass held between ticks | 0 to -½ pass | | Up to -1.9 ms on UHD 620 | 0.3 KB | 0 | No |
| Low-sun pass range | +0-30 in sun pass, golden hour only | Up | Up at golden hour | 0.3 KB | 0 | No |
| **Night, no key** | **-42 to -74** | **-217k to -484k** [M, DECISIONS:2369-2370] | -1.9 to -2.5 ms on UHD 620 | 0 | 0 | No |
| Sun disc, glare | 0 | 0 | +3 ALU on sky and near-sun surfaces | 0.3 KB | 0 | Resolve only |
| Moon, Earth | 0 | 0 | 3 ALU per sky pixel; ~20 ALU + 1 fetch inside ~90 px | 0.5 KB | 8 KB | Resolve only |
| Stars | **+1**, night only | 0 (9,100 points) | +1 fetch on sky: +0.8-1.6 % [M] | 0.5 KB | 36 KB | **Yes** (Points) |
| Constellations, bolts | +1, only when shown | 0 | Tiny | 0.3 KB | 3 KB | **Yes** (lines) |
| Milky Way | 0 | 0 | +10 ALU on sky at night | 0.2 KB | 0 | Resolve only |
| Clouds, 3 layers + sun + Moon | 0 | 0 | +5 fetches on sky: **+3.9-8 %** [M] | 1.5 KB | 4 KB, made at boot | Resolve only |
| Cloud shadows | 0 | 0 | +1 fetch on surfaces: **+5.3 %** [M], broken cloud only | 0.3 KB | shared | Resolve only |
| Rain | **+1**, when raining | 0 (≤ 1,600 lines) | 0.5-4.8 % fill [M] | 0.5 KB | 25-50 KB VBO, zero on the wire | **Yes** (lines) |
| Snow | **+1**, when snowing | 0 (~900 points) | 0.4 % fill [M] | 0.3 KB | 14 KB VBO | **Yes** (Points) |
| Wet streets, puddles | 0 | 0 | +15 ALU ground; 2 fetches on wet pixels | 0.5 KB | 0 | Terrain and resolve grow |
| Fog from visibility | 0 | 0 | Same as `?fog` | 0.2 KB | 0 | No |
| Lightning | 0 (+1 with a bolt) | 0 | None | 0.2 KB | 0 | No |
| Wind | 0 | 0 | Nothing | 0.1 KB | 0 | No |
| Lit windows | 0 | 0 | +20-30 ALU on window pixels only | 0.8 KB | One palette row | Building grows: ~3 % more source on the program that takes 4 s on ANGLE (ARCHITECTURE:191) |
| Street pools | 0 | 0 | +12 ALU on ground at night | 0.3 KB | 0 | Terrain grows |
| Headlight, glow at night | 0 | 0 | None | 0.1 KB | 0 | No |
| Glitter | 0 | 0 | +10 ALU on water | 0.4 KB | 0 | Water and terrain grow |
| Look-up | 0 | 0 | Cheaper: sky at 45 % of frame gives 11.3 + 2.3 fetches a pixel, under today's 16.5 [M] | 0.3 KB | 0 | No |

**Sums.** Clear day: +0 draws, +3.9-8 % fetches with clouds. Rainy day: +1 draw, +9-13 % in broken cloud. Moonless night: -41 to -73 draws (the pass goes, stars come). Moonlit night: +1 (the sun pass stays). Worst case, a broken-cloud storm with stars, rain and bolts: +3. Triangles never rise except at golden hour. That leaves the 120-200 draw and 1.0-1.5 M triangle budget where it is, and the spike's far field keeps its own line.

**Warm-up.** New programs: stars, rain, snow and sky lines, 3-4 small ones on 27, each registered with `registerWarm('sky', ...)` from the same factory the game uses, and each kind (`P`, `LS`) drawn for real into the G-buffer. Rain and sky lines could share one program with a define off. Everything else grows an existing program. `warmcheck` must still report 0.

**Allocation.** Writes in place, no objects per frame. astronomy-engine returns new objects per call, so call it at ≤ 2 Hz outside the frame path or in a worker [E, I did not run it].

---

## 9. What the distant-city spike must honour

SPIKE.md is close. A few words now save a redo. Line numbers are SPIKE.md's.

| Line | It says | Must become |
|---|---|---|
| 61 | Planes `class`, `tone`, `height`, `reserved` | Keep, and name `reserved` as paint, with a new fifth plane or spare bits for wall share (below) |
| **63** | **Tone goes "through the game's own light table at the fixed sun"** | **Store pre-light offsets only:** the same `lo` the near shaders use, so the client runs `sbLight` with the live uniforms. Light baked into tone is wrong at every other hour, even with no cast shadows |
| 65 | Oblique tone mixes roof and wall by share | Store the wall share and the wall `lo`, not a lit mix. A wall's brightness depends on which way it faces the sun, so the mix moves through the day |
| 69 | Stub `body.json` has `sun: {alt, az}` | The body stub takes vectors from Sky, even if fixed for capture. Never store elevation |
| 80 | `?farmap` writes through the existing `sbWrite` | Good: that is what makes the table reach the far band. Keep every far pixel as ramp plus step. Any far sibling ramps get a row in every keyframe table |
| 81 | Far boxes: "walls one step darker", "no sun-pass membership" | Light walls with `sbLight` on real normals. The far material is a `makeRampMaterial` (`City.ts:191-208`), so it already lights correctly: don't hard-code a darker wall. No sun-pass membership is fine |
| **83** | **`?farfade`: fade to 34 km, far 36 km** | **Fix the sky test first.** With `z >= 0.99999`, geometry past 29.03 km is sky, where fog is only 0.75, so the fade never finishes and the city ends in a hard cut [M] |
| 85 | `?body=`, sky ramp from the body | Route through `uSkyRow`, the shared row, not a second path |
| 110 | Hold-still swap test at one sun | Run it at sun 75°, 25°, 5°, and at night on the night table. Calibrate tone there too: "one calibration against an in-game frame" (VERDICT §5) is good for one sun only |
| 136 | Thresholds on the swap | Same gates at each light |
| §5-7 | Captures at the fixed sun | Add `?sky=<ISO time>` as soon as Sky exists, so captures are deterministic and any hour can be judged |

**Rules for the far material, whichever renderer wins:**

1. **No baked light, no baked shadow.** It already bakes no cast shadow; extend that to N·L.
2. **A night path from day one.** It needs `class` (roads glow, roofs don't), `height` and cell hash, and a way to write `glow`, with `share x glow ≤ 0.06` [M, §3.6]. Boxes need a per-face lit bit and a per-chunk seed in the instance data, or at night "one tone per block" becomes glowing slabs. No per-pixel window pattern at this range.
3. **Water through the same glitter chunk,** so the bay doesn't change character at the band edge.
4. **Cast shadows on the far band come from the height sweep** (VERDICT §5), in a worker, on the sun's tick: keep the `height` plane on the client. The urgency is lower than it looks for buildings. At 5° the ground's sun term is only 0.3 steps [M], so the near/far seam shrinks as the sun drops. Hills are what need it: a 280 m ridge at 5° throws 3.2 km [M, h / tan].
5. **Keep the haze dial driven from outside** (`Body.air` and live visibility), never a constant in the far shader.
6. **Nothing keyed to a time of day in the bake.** Lamp data, if ever baked, is a mask, not a brightness.
7. **Mock with night in mind.** One night frame of the far band belongs in the spike's pass list: "at night, is the far city a city or static?" A clear win for the far field at noon can still fail here.

VERDICT §9 row 8 still lists "real sun with night art" as later, while §10 item 9 decides it. §10 wins; the spike is built after the decision.

---

## 10. Order of work

1. **Harness first:** `?sky` off by default with byte-identical frames (`shots --det`), `?sky=<ISO time>&wx=<preset>`, `__game.sky`. The judge needs a frozen hour and weather. Sky test fix behind it.
2. **Table, key, tick:** `Sky`, three vectors, the keyframe tables, shadow fade. One producer look at a real evening on the phone. This alone gives dusk, blue hour and a moving sun.
3. **Night:** windows by distance, street pools, headlight, glow. Beauty judge round.
4. **Sky band:** Sun, Moon, stars, glitter, gradient. Fixed views from orbit and from the Moon here, as the brief says.
5. **Weather:** cloud layers and shadows, rain, snow, wet, fog from visibility, gate the SF fog shape. Beauty judge round.
6. **Camera:** `skyLift`, ceiling pull, rest, sunset beat, in that order of value. Controls need a phone.

Steps 2-3 carry most of the beauty per day of work. Steps 1 and 2 touch only uniforms, the table and the sun pass; step 3 is the first that grows the building shader.

---

## 11. What I could not confirm

- **Nothing ran in the game, on a GPU or on a phone.** ALU counts are hand estimates. Fetch counts are from reading GLSL; compilers merge. The resolve's share of an A15 frame is unknown.
- **The mocks re-colour fixed captures.** They keep the capture's sun, shadows and light; they cannot show a real low sun. Their tables are test art. They prove the table mechanism, not final beauty. Windows and beam are CPU paint-overs, and column B dims the bus when the game would not.
- **The crawl mock** uses boxes on flat ground with a separate random scene per row, a 61 m patch, and no camera motion. Its percentages are a guide. Whether a tick reads as a pop on a phone is unknown, as is whether the `shimmer.py` number agrees. I did not run the game's shimmer tools.
- **My eye** is the only judge of the mocks here. No outside judge has seen them.
- **The sun-pass hold** (§2.4) is reasoned, not tried. `cullCasters` and moving casters are the risks.
- **Lines on iPhone:** one-pixel lines through WebKit, ANGLE and Metal into an RGBA16UI target are assumed, not proven. MDN does not settle it.
- **`EXT_clip_control` on iOS:** a third-party survey only. Nothing here depends on it.
- **astronomy-engine:** I measured its size only and did not run it. Call time, allocation and the `RotationAxis` question from the brief are left to the astronomy report.
- **Sky ephemeris numbers** come from low-precision formulas, about 0.3° on the Moon: fine for shares of time, not for an alignment.
- **Occupancy curves and all `uLight` keyframes** are my starting guesses.
- **Star catalogue size** assumes 4 bytes a star; constellation data's licence is not checked here.
- **METAR's visibility ceiling** is from memory; the weather report owns it.
- **`rig.openingLow` over a dense city:** I reasoned the clearance problem, I did not test it.
- **Black Marble:** the page gives 750 m for the sensor band, not per product, and I did not check its licence beyond "open science policy", nor the NOAA-20 product's fitness.
- **Ferrari's method:** sources confirm indexed art, palette fading and BlendShift. I found no account of how his time-of-day palettes are structured, so "the same idea" means the mechanism only.

---

## 12. Scripts and sources

Scripts, in `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/sky-render-scripts/`, all run with `sb-venv` Python `-I`, no GPU:

| Script | What it does |
|---|---|
| `palette_io.py` | Reads ramps straight from `palette.ts`; OKLCH and SPIKE's brown test |
| `t1_palette.py` | Chroma by step, brown, global filters, FOG luma fit, shared colours |
| `t2_light.py` | `sbLight`, sky functions, shadow lengths, sun-pass geometry, knee, tip speed |
| `t3_index.py` | Reads real captures back into (ramp, step) |
| `t4_grade.py` | Grade tables, `mock-palette-grades.png`, `mock-palette-tables.png` |
| `t5_camera_sky.py`, `t9_extra.py` | Camera poses, sun and Moon over 2026, stars per view, resolve fetch counts |
| `t6_depth_glow.py` | Sky-test distance, float32 limb error, exact glow kernel, fog, fill |
| `t7_crawl.py` | Port of the shadow lattice under a moving sun (3 minutes of CPU) |
| `t8_night.py` | `mock-night.png`, `mock-moon-sizes.png` |

Size check: `astronomy.browser.min.js` 2.1.19 from unpkg, saved in its own folder under `scratchpad/sky/astronomy-engine-size/`, measured only, not run.

External sources are linked where they are used. Taginfo counts were read from the API on 2026-10-31.
