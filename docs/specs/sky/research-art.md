# Sky art direction, and the first look at it

Art research for the live sky, 2026-10-31, against `merge/osm` at `bc3106b`. No tracked file changed. No browser, no GPU, no phone. The only downloads were star data (2 MB) and a Moon map (139 KB).

**Labels.** [M] MEASURED: I ran it. [S] FROM A SOURCE: linked. [E] ESTIMATE: my arithmetic or my eye, with the assumption stated. A file:line with no label is code I read at that commit.

**Start here:** `mocks/sky-states.png` on a phone, then `mocks/alamo-bluehour.png`, `mocks/orion-lookup.png` and `mocks/alamo-dawn-avenue.png`.

**Every image here is a recoloured real frame, not game output.** Nothing has run in the game, and nothing has been seen moving.

---

## 0. The answer

1. **It can be absolutely beautiful, and the city data does most of the work.** Thirteen skies now sit on one real Alamo Square frame. The best are blue hour over the painted block, Orion over downtown, and the sun coming up at the end of Grove St [E, my eye; the producer decides].
2. **A palette table is necessary but not enough.** A table gives one colour per (ramp, step). On the Alamo frame, 25-48 % of land pixels end up in colours that no table can reach, even one fitted to that exact frame [M]. Those pixels are what make it read as light rather than tint. They come from long shadows and from sources of light. At a 1.4° sun, 93 % of the land is in shadow; today's fixed sun leaves 7 % [M].
3. **The art rule in one line: the sky may colour the grey, but paint stays the only saturated thing, and paint keeps the day.** Measured on all 21 frames in the set: the world's strongest colour never passes 0.71 of paint's median chroma, and brown is 0.00 % of pixels [M].
4. **At night, the street data is the look.** One lit pixel per lamp, placed from the street centrelines every OpenStreetMap tile already carries, draws the whole grid as a string of pearls. No hand work, any city [M, 21,198 lamps in the 11 x 10 km study window].
5. **Moon: exact position and phase, 15 px floor.** True size is 8.4 px on the street lens and 5.2 px at the ceiling [M]. Below 8 px a crescent disappears [M, `moon-scale.png`]. True size overtakes a 15 px floor about 252,000 km into the flight, so the Moon never shrinks [E].
6. **Stars need a look-up, and it pays off.** The normal street frame shows 0-6° of sky, where almost no stars survive. But a 24° lens makes constellations huge: Orion takes most of the frame width over downtown [M]. Stars and lines belong to the slow moment when the bus stops and looks up.
7. **Two things block the best shots.** The 11-20 km far fade erases the real East Bay ridge, which sits about 10 game px above the frame's faded horizon [M], so no Moon can rise behind it. And the sun pass reaches about 520 m, while a 20 m building at a 1.4° sun throws an 820 m shadow [E, arithmetic]. Dusk and dawn need VERDICT's far height-sweep shadows, or they will look tinted.
8. **Cross-fade palettes in OKLCH, not OKLab or sRGB.** Thirteen clean keyframes still pass through taupe on the way between them: 15 bad swatches in OKLab, 16 in sRGB, 7 in OKLCH (with 4 more pairs tested), and those 7 are all one tree ramp [M].

---

## 1. How the mock-ups were made

The brief asked for a frame re-lit by a new palette, not a filter. A palette alone cannot move a shadow, so I went one step further and rebuilt each frame's G-buffer on the CPU from the game's own data, then re-lit it in the game's own light equation.

| Step | What happens | Result |
|---|---|---|
| Read the frame | Each game pixel back to (ramp, step) | 100.0000 % of pixels on palette in all six frames tested; 3 of 192 colours are shared by two ramps [M] |
| Rebuild the geometry | Parse `public/city/sf/r_*.bin` (172,180 building parts, 48,381 street segments, 120,545 trees) into a 2 m height grid, take the camera from the capture's stats and `CameraRig.ts`, ray cast every pixel | Position, normal, depth, building id per pixel [M]. Parses in 12 s, 13-43 s per frame |
| Check it | Compare with the real frame | Sky agreement 96.7-99.5 % on seven frames. On the one frame I searched (Alamo, 50 poses) the rig's formula pose was already the best fit; the others use that formula unsearched. The rebuilt shading lands within 1 ramp step of the real frame on 82 % (Alamo) and 74 % (FiDi) of grey pixels [M] |
| Re-light | `l = a + b·sky + k·ndl·shadow`, the game's `sbLight`. The new step is the old step plus the change in light, so facade detail, outlines and windows survive | New shadows traced up to 5.2 km [M] |
| Paint the frame | Per-state palette rows, the real sky, real stars, a real Moon, lamps, windows, weather | Every output pixel is a (ramp, step) in that state's table: 100-141 colours per frame [M] |

**Real:** every shape; sun, Moon and star positions for the stated date and place; phase; shadow direction and length; lamp positions (a rule on real centrelines); fog height against real buildings; the East Bay skyline, from the game's own `horizon.bin`.
**Invented:** which windows are lit, cloud shapes, all weather on the dates shown, far-shore lights, every palette colour.

**A camera tilt is exact.** A camera turned about its own centre is a homography with no parallax, so the look-up mocks are the real frame in a true tilted pose. New rows at the top are sky [M].

**Honest dates.** Every clear-sky state uses a date on which that sky really happens over that frame. A low-precision Sun and Moon I wrote for this were 9-20 minutes from [published full-Moon times](https://www.moontracks.com/fullmoonnames.html), about 0.1-0.2° [M]. Use `research-astro.md`'s tested model for anything final.

### Why a table alone looks tinted

`research-render.md` proves the table mechanism and says itself that its mocks cannot show a real low sun. These numbers put a size on that gap.

| State | Land pixels no table can reach [M] | Mean colour error of the best possible table, OKLab [M] |
|---|---|---|
| Blue hour | 24.9 % | 0.032 |
| Rain | 26.8 % | 0.034 |
| New moon | 27.9 % | 0.031 |
| Sunset | 31.9 % | 0.044 |
| Storm | 34.8 % | 0.039 |
| Golden hour | 37.2 % | 0.074 |
| Dawn | 38.2 % | 0.047 |
| Full moon | 38.9 % | 0.046 |
| Overcast | 41.9 % | 0.047 |
| Snow | 42.6 % | 0.062 |
| Noon | 44.0 % | 0.071 |
| Morning | 45.8 % | 0.075 |
| Fog | 48.0 % | 0.067 |

**Shadow share of the land** [M]: today's fixed sun at 25.2° 7.1 %, noon 8.5 %, morning 34.3 %, golden hour 38.7 %, dawn 84.0 %, sunset 93.2 %.

Today's fixed sun is at compass 292.5°, elevation 25.2° [M, from `config.ts`], which is why the frames feel like one long afternoon.

---

## 2. The masters: what to steal

Sourcing was uneven. Several primary pages refused the fetch. The last column says what I actually read.

| Master | Technique to steal | Where it goes in this game | What I read |
|---|---|---|---|
| **Mark Ferrari**, colour-cycled scenes | **Bake the night in and let the palette reveal it.** One picture, many palettes; rain overlays and lit windows sit in the same layer, hidden until their palette state. One picture ran nine palettes: three scenes at three times of day. | The window, lamp and paint systems are present at noon, in palette rows or masks that are simply dark. Nothing spawns at dusk. | [S] [Ferrari Q&A](https://www.effectgames.com/effect/article-Q_A_with_Mark_J_Ferrari.html). His talk is [on GDC Vault](https://www.gdcvault.com/play/1023586/8-Bit-8-Bitish-Graphics); I did not watch it |
| Ferrari | **Rain and snow: a contrasting dot on a trail matched to the background,** so the trail reads as transparent. Rain and snow never coexist, so they share palette rows. | My rain trail is the background's own ramp one step up, its head 2-3 steps up. No free colour, no alpha. | [S] same Q&A |
| Ferrari | **Ramp lengths and speeds must differ.** Uniform cycles look rigid and pulse. Ordered dither for smooth effects, random for chaos such as foam. Snow and rain gradients get no dither at all: solid straight-edged bands. | Vary rain layers. No dither inside weather gradients. Matches the game's flat-surface rule. | [S] same Q&A |
| Ferrari | **He can't see a transition between palettes until it runs.** | That warning is why I measured cross-fades, and they failed (§3.3). | [S] same Q&A |
| Ferrari | **Time of day came from an accident.** He kept sky and ground colours in the same palette slots across pictures, so a palette from another picture turned a day scene into a believable twilight. | Our ramps already do this: every city's pixel sits in a slot with a fixed meaning. | [S] [podcast page](https://tightshipdesign.com/prisma-pixels-publishing-mark-ferrari-podcast/), through a search excerpt only; the page would not load |
| **Living Worlds** (Huckaby's HTML5 engine) | Only pixels on animated palette entries are redrawn. BlendShift fades colours between cycle steps for smooth motion. 35 scenes at about 100 KB each. | Palette uploads cost almost nothing: 1.5 KB at most once a second or so [E]. | [S] [article](https://www.effectgames.com/effect/article-Old_School_Color_Cycling_with_HTML5.html), [repo](https://github.com/jhuckaby/canvascycle) |
| **Alto's Odyssey** | **Time and weather as mood, never as a menu.** Nobody chooses them; they arrive. Night also changes play: obstacles get harder to spot. Lunar cycles shift gradually. | No time slider in the game. Real time is the only clock. Let a night run feel different. | [S] [press kit](https://altosodyssey.com/press), [Road to the IGF](https://www.gamedeveloper.com/business/road-to-the-igf-team-alto-s-i-alto-s-odyssey-i-), [Cubed3 review](https://www.cubed3.com/games/reviews/playstation-4/the-alto-collection). How its lighting works: not found |
| **Sword & Sworcery** | **The real Moon changes what can happen.** The moon phase follows the device clock, some events only happen in certain phases, and a hidden place lets you skip a phase. | Moon-gated paint, full-Moon events, and a way in for players who can't wait a month. Exact design is the producer's. | [S] [Wikipedia](https://en.wikipedia.org/wiki/Superbrothers:_Sword_%26_Sworcery_EP). How its lighting is made: not found |
| **Hyper Light Drifter** | **Colour and silhouette first.** Readability at low resolution beats detail. Heavy, saturated colour on purpose, for an unreal feel. | The silhouette test in the beauty bar. Far towers in the mocks are clean shapes, not detail. | [S] [Unwinnable](https://unwinnable.com/2015/12/02/interview-with-alex-preston-the-creator-of-hyper-light-drifter/), [Automaton](https://automaton-media.com/articles/interviewsjp/20170525-47328/) as summarised by search. Gradient method: not found |
| **Eastward** | Could not source a technique. One forum guess says 3D lights over pixel art. | None taken. | [S] [Road to the IGF](https://www.gamedeveloper.com/disciplines/road-to-the-igf-pixpil-s-i-eastward-i-) has nothing on lighting. In-house Gii engine on MOAI, Ghibli named as an influence |
| **Sea of Stars** | **Light gets its own pass, and day/night is a game mechanic.** Plans named dynamic sprite lighting, normal maps, shadow casting and receiving. Some puzzles depend on time of day. | Our G-buffer already holds normals, which is why this game can do more than a sprite game. | [S] [Gematsu](https://www.gematsu.com/2020/03/sabotage-studio-announces-sea-of-stars-a-turn-based-rpg-prequel-story-to-the-messenger-for-consoles-and-pc), [Niche Gamer](https://nichegamer.com/2020/03/19/the-messenger-prequel-rpg-sea-of-stars-enters-kickstarter-launches-2020-for-pc/) by summary. 2020 plans; shipped state not confirmed |
| **Octopath HD-2D** | **Low-res art, modern light on top.** Point lights with shadows, volumetric light and fog, bloom, and tilt-shift depth of field for a diorama feel. | Light and fog yes. No depth blur: it breaks palette lock. | [S] [Wikipedia, HD-2D](https://en.wikipedia.org/wiki/HD-2D), citing the Unreal interview, which would not load |
| **Proteus** | **Night is where time moves.** Entering a place at night advances the season. | The look-up stop is the same bargain: stay still at night and the sky rewards you. | [S] [Wikipedia](https://en.wikipedia.org/wiki/Proteus_(video_game)). Details of its night sky: not found |
| **Journey** | **Glitter must be rare and very bright, and stable as the light moves.** Each grain is a tiny mirror with a fixed random direction, reflected against the light, so sparkles hold still instead of jumping. | Moon and sun path on water; wet streets; snow. A world-anchored hash, never a per-frame random. | [S] [Zucconi's breakdown](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-5/) of [Edwards' GDC talk](https://gdcvault.com/play/1017742/Sand-Rendering-in). The colour arc: no source found |
| **Firewatch** | **The sky sets the colour of the world, and fog colour comes from a gradient by distance.** The sky can fill half the screen and sets most outdoor colour. Colour script tied to story beats; layered depth. | One gradient per state for far haze, sharing the sky's rows, so far shapes melt into the sky behind them (the resolve already works this way). | [S] [Thumbsticks on the GDC talk](https://www.thumbsticks.com/gdc-2015-the-art-of-firewatch). Gradient fog only through [a third-party asset crediting the talk](https://hyphinett.itch.io/gradient-fog-for-unity). The Campo Santo blog refused the fetch |

**Physical facts behind the states.** Earth's shadow rises as a dark band in the east after sunset, with reddened backscatter above it making the pink of the Belt of Venus, and it blurs out as it climbs [S](https://atoptics.co.uk/blog/earth-shadow). Civil twilight ends at -6° and the brightest stars and planets can already be seen in it; nautical runs to -12°, astronomical to -18° [S](https://www.weather.gov/lmk/twilight-types). Street lamp photocells commonly switch on near 1.5 foot-candles, about 16 lux [S](https://www.riversideca.gov/utilities/sites/riversideca.gov.utilities/files/pdf/RPU%20Spec.%201-6.3.pdf). Moonlight looks blue because eyes shift toward blue in dim light; a calibrated camera reads it at about 4000 K, and blue is a convention painters and filmmakers lean on [S](https://www.premiumbeat.com/blog/why-color-grade-moonlight-blue/). Inner-city skies reach naked-eye magnitude 4.0-4.5 [S](https://en.wikipedia.org/wiki/Bortle_scale).

---

## 3. The sky states

### 3.1 Mood, light, shadow, paint

Triggers are [E] and meant to be tuned. Date and sun are [M]. Light values are in `sbLight`'s units: `a` ambient, `b` sky bounce, `k` key.

| State | Trigger | Mood | Key light | Shadow colour | What paint does |
|---|---|---|---|---|---|
| **Dawn**. Apr 8 2027 06:50 PDT, sun 0.7° | Sun -1 to 5°, rising | The city holds its breath, then the first line of gold | Low sun ahead, peach, `k` 0.46. The city is backlit | Cool violet `#31335a` | Rows at 98 % lightness. Stays deep until the sun clears the ridge |
| **Morning**. Apr 8 09:00, 25.8° | 5 to 35°, rising | Crisp, clean air, the day ahead | Cream, `k` 0.50 | Blue slate `#27314e` | Unchanged. Paint is at its truest |
| **Noon**. Apr 8 13:15, 59.6° | Over 35° | Bright, plain, playful | Near white. Shadows true, wall shading softened toward 41° | Neutral blue-grey `#2c3543` | Unchanged, as today |
| **Golden hour**. Mar 21 18:40 PDT, 7.7° | 10 to 4°, setting | The whole city is suddenly generous | Honey-rose, `k` 0.66 | Indigo `#2c2e4d` | **Paint's own hour.** Sunlit walls catch the light, capped so they never bleach |
| **Sunset**. Mar 21 19:13, 1.4° | 4 to -1°, setting | The last light leaves the streets and climbs the towers | Rose-gold, only on what stands tall | Deep violet `#272649` | Falls into dusk from the ground up, ground paint goes wine-red and glows |
| **Blue hour**. Feb 20 18:20 PST, -5.9° | -1 to -8° | **The hero state.** Windows and lamps wake, and paint is the brightest thing left | None. A low rose fill from the sunset side, `f` 0.2 | Navy `#131b45` | **Paint keeps the day.** Steps held 2.3-5.1, rows at 90 % lightness, 112 % chroma |
| **Moonlit**. Feb 21 20:00 PST, Moon 8° | Sun under -8°, Moon over 3° up, over 35 % lit | Quiet, silver, a little magical | Moon, cool, raking. `k` 1.5 to read at all | Blue-black `#0c1435` | Deeper: steps 1.8-4.5, rows at 84 %, 110 % chroma |
| **New moon**. Nov 9 2026 19:30 PST | Sun under -8°, otherwise | Deep, private, full of stars | None. Only what the city makes | Violet-black `#0a0d29` | Steps 1.8-4.6. Reads as lit from within |
| **Overcast**. Sun 30° (staged) | Cloud over 85 % | Soft, flat, Hopper at his calmest | None, broad and even, `a` 0.46 | Soft grey-violet `#3c3f4c` | **Pops hardest of all.** Chroma 112 %. Rainbow against pearl |
| **Rain**. Sun 4.6° (staged) | Rain over 0.2 mm/h | Cosy, wet, lamps on early | None | Wet slate `#1e283c` | Steps 2.8-5.4, 110 % chroma. Wet paint stays bright |
| **Storm**. Sun -4.5° (staged) | Heavy rain, or lightning | Bruised, thrilling, the bus wheezing into the wind | None, then a bolt | Storm navy `#151d34`, teal at the horizon | As rain. The flash lifts it, never whitens it |
| **Fog**. Sun 8.6° (staged) | Ground inside the deck | A sea of light with towers for islands | Warm low sun on the fog's top | Lilac `#343855` | Paint thins the fog above it, as `uPaintClearing` already does |
| **Snow**. Sun 11.9° (staged) | Snowfall, T under 0.5°C | Hushed, bright, a child's morning | None, soft | Blue-lilac `#2c3151` | **Stays bare.** Snow settles on what faces up, but not on paint. Chroma 114 % |

SF hasn't had significant snow since [Feb 5 1976](https://www.sfmta.com/blog/san-francisco-rare-winter-wonderland) [S]. The snow state is for the cities that do, shown on the frame we have.

### 3.2 What the palette does, ramp by ramp

Hex values are the actual rows [M]. The sky column shows the far side, except dawn, which faces the sun. All 13 states in full: `mocks/sky-palettes.json`; at a glance: `mocks/palettes.png`.

| State | City: shade, lit wall, key | Glass dark, bright | Trees | Water deep, light | Sky horizon, then 3 bands up |
|---|---|---|---|---|---|
| Dawn | `#31335a` `#988da4` `#f4ddc7` | `#282d55` `#a994a2` | `#293d59` `#767c82` | `#343e68` `#a899a8` | `#ff9f6c` `#fabe8f` |
| Morning | `#27314e` `#828c97` `#e4e2d8` | `#24334d` `#86a7c3` | `#253f3c` `#5d7c67` | `#2b4662` `#8cb0c9` | `#d6e2ea` `#cadbe9` |
| Noon | `#2c3543` `#8c939a` `#e2e2db` | `#293b4d` `#93b4cb` | `#2e4038` `#657961` | `#2f4b64` `#94b4ca` | `#dfe5ea` `#d5e0ea` |
| Golden | `#2c2e4d` `#bb828c` `#ffe4b0` | `#252a4a` `#c29394` | `#29404f` `#887d89` | `#313e68` `#a79da7` | `#c9b3b4` `#d4c1b7` |
| Sunset | `#272649` `#bc7b78` `#fdddb0` | `#272454` `#e5a1a8` | `#1d2b48` `#7b5c71` | `#1d2151` `#8b6295` | `#7a7199` `#a783a4` |
| Blue hour | `#131b45` `#475c97` `#afbbd9` | `#131b4c` `#4253a2` | `#132741` `#2d4d70` | `#101741` `#363f86` | `#5a4f93` `#404696` |
| Moonlit | `#0c1435` `#344e86` `#a7c1db` | `#0c1535` `#39578c` | `#0d2235` `#244c5c` | `#090f29` `#203062` | `#2f3f7c` `#24346b` |
| New moon | `#0a0d29` `#252f63` `#6673a6` | `#090d2a` `#243163` | `#0a192a` `#183446` | `#090d2b` `#252152` | `#4b3662` `#312859` |
| Overcast | `#3c3f4c` `#91959c` `#d7d8db` | `#323a47` `#98a1ac` | `#364440` `#667670` | `#3d4658` `#98a0ac` | `#d8dbe0` `#d3d7dd` |
| Rain | `#1e283c` `#65738a` `#bdc6d4` | `#202c40` `#7b8fac` | `#1e3a3f` `#486a6b` | `#1f2b3e` `#74849b` | `#7f8fa8` `#7787a0` |
| Storm | `#151d34` `#4d607a` `#aabfcd` | `#202c40` `#7b8fac` | `#1e3a3f` `#486a6b` | `#1f2b3e` `#74849b` | `#5d7f8c` `#4c6a7c` |
| Fog | `#343855` `#9896a6` `#f0e5d5` | `#323956` `#afadba` | `#334446` `#718279` | `#4b5372` `#b7b8c4` | `#e8e3df` `#e6e2e1` |
| Snow | `#2c3151` `#858ba9` `#dadce8` | `#2b3050` `#939ab7` | `#2b3a51` `#5e6f85` | `#394164` `#979cb8` | `#d4d6e6` `#cccee2` |

**The other rows.** Paint hue ramps keep their hue in every state; only lightness and chroma move, and any warm step that darkens below L 0.62 slides to rose (`#c13c15`, a burnt orange, failed the gate in my first night palette and this fixed it [M]). BUS_YELLOW stays the warmest thing in frame. New rows: LIT 38 (`#3a1f4a` plum up to `#fff7dc`, the same slot `research-render.md` picks), LAMP 39 (plum to peach), MOON 40, SNOW 41 (`#5a64a0` to white), RIDGE 43, plus reserved CLOUD 35, NIGHT_SKY 32, TWILIGHT 37. Rows 24-31 (factions) are not graded here.

**Sky is 16 bands in 4 rows, by altitude from the visible horizon:** far side FOG plus NIGHT_SKY, sun side SKY_WARM plus TWILIGHT, joined by a narrow dithered seam. Near the sun the sky's own bands are pulled toward their horizon colours, so the glow has no edge of its own. My first attempt, a separate glow, looked like a target [M, by eye].

### 3.3 Eight art rules

1. **Light moves, tables colour.** Shadow and shading come from a real direction; the table says what colour the air is.
2. **Paint out-shouts the world.** World peak chroma stays under 0.75 of paint's median. Measured worst 0.71, at blue hour [M].
3. **No brown, including taupe.** My first gate passed; a stricter test found dusty golden-hour swatches (`#ab887e`, `#928873`) it had missed, so I added a taupe test. It fails 0 of today's 192 colours and now passes all 13 states, and all 21 frames have 0.00 % brown pixels [M].
4. **Warm shadows go rose, then violet.** Every city gradient climbs indigo, violet, rose, peach, cream.
5. **Paint never bleaches.** The top two steps of a hue ramp are pale tints, kept for glints: cap 5.45.
6. **A light is a pixel.** Lamps, windows and stars are single pixels. Bloom is a dithered lift inside a ramp, as the resolve already does it.
7. **The sky's glow is the sky.** Bend the bands; never overlay.
8. **Only two things are stylised in the sky:** the Moon's size floor and how many stars survive. Position, phase, relative brightness and shadows stay true.

**Cross-fades, measured** [M]: 20 state pairs at 9 steps, tested for brown on every used row.

| Interpolate in | Bad swatches | Where |
|---|---|---|
| sRGB | 16 | Sky and trees |
| OKLab | 15 | Worst on navy to peach: night to dawn, on the warm sky rows |
| **OKLCH, short hue arc** (24 pairs) | **7** | All on the tree ramp's top steps, crossing khaki between green and peach. Every sky row is clean |

A straight line from navy to peach runs through the neutral middle, where taupe lives; the arc swings round through violet and rose instead. Tree highlights still need a fix: drop their chroma mid-fade or keep them cool. I have not tested that fix.

---

## 4. The mock-ups, judged hard

All in `mocks/`. Heroes are 1179 x 2556, the frame at 3x, 0.04-0.09 MB; the sheet is 1.67 MB [M]. Sources: `look-next/sign-L1-3.00.png` (Alamo), `det-final/fidi.png`, `det-final/ceiling.png`.

| Image | State, real date | What works | What is still weak |
|---|---|---|---|
| `sky-states.png` | 13 states plus today's frame and the ceiling | Reads at phone width. One city, thirteen moods, none a colour slider | New moon and full moon sit close together at thumbnail size. Fog buries the frame on purpose |
| `alamo-bluehour.png` | Feb 20 2027, 18:20 PST. Full Moon really 3° up, in frame | **The best frame.** The rainbow block burns against a dark blue city, pearl-strung streets, the real East Bay ridge | Ground paint is broad and flat. Lamp pools repeat as ovals near the camera |
| `alamo-sunset.png` | Mar 21 2027, 19:13 PDT. Sun 1.4° behind the camera, full Moon 1.9° ahead | Real long shadows, towers rose-gold, a real Moon in the anti-solar sky | The Ladies are already in Alamo Hill's shadow, so the hero block isn't sunlit. **Golden hour is paint's hour; sunset is the towers'.** Mid-field is a lot of one mauve |
| `alamo-fullmoon.png` | Feb 21 2027, 20:00 PST, camera tilted 6°. Moon 8.1° | The Moon in a real sky band, paint deeper, shadows raking toward the camera | **Not the silver city I wanted.** A Moon at 8° lights roofs weakly, and `k` is exaggerated to 1.5. Reads as a darker blue hour. A high Moon lights better but leaves the frame |
| `alamo-dawn-avenue.png` | Apr 8 2027, 06:50 PDT. Sun azimuth 80.97°, Grove St bearing 80.9° | **The sun comes up half-cut by the real ridge at the end of a real street.** A strong image | Backlit mid-city is flat lilac. Real rim light needs better normals than this rebuild has |
| `fidi-fog.png` | Fog staged; sun true for Jul 14 2027 | A bus over a fog sea with real towers as islands. Very strong and very easy | Billows are soft blobs. **The 74 m top is my pick** inside the game's 25-175 m layer. Karl's base at KSFO is near 1,100 ft (`research-weather.md`), so real fog often sits far higher: fog at street level is more often overcast than this picture |
| `fidi-rain.png` | Rain staged | Wet streets mirror lit windows, traced through real geometry. Whole real windows switch on, not fragments | Streaks barely show in a still. The trace is richer than `research-render.md`'s 2-fetch smear, so judge the cheap version before trusting this frame |
| `ceiling-night-bay.png` | Nov 9 2026, 19:30 PST, new moon | The **real Big Dipper bowl** at 3-9° over the Bay, street grid as pearls, a necklace of far-shore lights | The bus is small and the dark Bay is a big empty mass. Far-shore lights are random, not data. **No Moon glitter:** this camera faces north, where the Moon never goes, so the path on the water is unproven |
| `orion-lookup.png` | Dec 8 2026, 19:00 PST, new moon, tilted 10° | **The best sky.** Orion rising on its side over real downtown, and the sign in the game's voice | No such camera exists yet. Stars are kinder than a city sky. Lines may be a step too bright; Rigel is just out of frame |
| `moon-scale.png` | Feb 20 2027 sky | True, floor and 24 px side by side, phases at 5, 8, 15, 24 px, real LRO albedo | Lunar north uses celestial north, a tilt error of perhaps 25° [E]. `research-astro.md`'s axis fixes it |
| `moment-streetlights.png` | Blue hour | The city wakes with its lamps. Reads as a change | A still can't show the wave |
| `moment-moonrise.png` | Mar 21 2027, 19:01-19:07 PDT | Halo first, then a limb, then the disc clears the real ridge | Drawn ridge. In today's game that ridge is faded away |
| `palettes.png` | All | Every ramp in every state on one page | Test art. Hand-picked, tuned on one city |

**Checked by me and caught:** the Moon map was mirrored, with Mare Crisium on the wrong limb, until I tested the map's own dark and bright regions [M]. Cloud stipple, a ribbon window lit as one bar, window pieces spilling onto walls, street lamps as lava, bleached paint and a fence of dots on the far Bay were all drafts I fixed.

---

## 5. The moments

| Moment | Real example | Cheap fake? | Needs engineering? |
|---|---|---|---|
| **Streetlights come on** | Sun near -2 to -4° [E]; photocells near 16 lux [S](https://www.riversideca.gov/utilities/sites/riversideca.gov.utilities/files/pdf/RPU%20Spec.%201-6.3.pdf). Windows rise with them | **Yes.** Hash a per-block delay of 20-40 s, a wave outward from the darkest street. One audio cue | Small. Build a lamp mask per tile in the worker from `SBT2` street lines. About 16 KB per tile [E]. Any OSM city gets it |
| **Windows catch fire** | At golden hour, west-facing glass flashes | **Yes.** Reflect test against the sun in the facade shader, per window | No new data. Shown in the sheet's golden cell |
| **First star** | Usually a planet: the brightest stars and planets appear in civil twilight [S](https://www.weather.gov/lmk/twilight-types) | **Yes,** once planets exist. A sign, and a 3 s nudge of the camera upward if the bus is slow | Needs planets (`research-astro.md`) and the look-up camera. **Not mocked** |
| **Moon behind a real ridge** | Mar 21 2027: limb 19:01, half 19:03, clear 19:07 PDT over the East Bay [M] | **Free once the ridge exists:** the Moon draws in the sky branch, so depth hides it | **Blocked:** the real skyline stands 0.1-0.6° up from Alamo [M], but the far fade ends at 20 km. Needs VERDICT step 0, band 4, and for other cities the GLO-30 ring |
| **Sun down a street** | Sunrise at the end of Grove St, Apr 8 and near Sep 5. **49 long straight SF streets** have sunset dates over the next year: Hayes St Feb 28-Mar 1 and Oct 11-12, Geary Mar 8-9 and Oct 3-4, California St Mar 3-4 and Oct 8-9 [M] | **Free.** Real sun plus real streets does it by itself | Only the announcement: a small bake of street bearings gives each city a "henge calendar". A sign: SUN DOWN GROVE ST TOMORROW 6 50 AM |
| **Fog pours over a hill** | Karl over Twin Peaks | **Partly.** Move billow noise along the wind and tilt the top so it reads as a spill | **Yes, the hardest.** `sbLayerTop` is SF-only. True spill needs the deck to know terrain and wind: one low-res height field per city, about an agent-week [E]. **Not mocked** |
| **Rain arrives with a front** | A wall of grey in the sky band, first drops, wet spreading street by street | **Yes.** Dissolve a wet mask along the wind by world hash, over 60-90 s | **Partly.** Weather data is 3-hourly, so it can't place a front to the minute (`research-weather.md`); the timing is staged. **Not mocked** |
| **Moon path on water** | A low Moon over the Bay on Dec 23 2026, from the Bay Bridge pose | **Yes.** One dot product plus Journey's world-anchored glitter | Code written. **Never shown:** no frame I built looks at it |
| **Lightning** | Bolt, then a lift of the palette | **Yes.** `research-render.md` warns `uFlash` whitens the sky, so use a lift | Keep to at most 3 flashes a second and under 25 % of a 10° field [S](https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html) |
| **The city goes to sleep** | At 3 am only a few windows remain | **Yes.** Window odds follow local time | No |

---

## 6. Stars and constellations at 393 px

**Counts** [M]. A full frame covers 2.77 % of the sphere on the street lens and 6.24 % on the vista lens. Using 5,044 catalogue stars:

| Brighter than | Mean stars in a frame of pure sky, street lens | Vista lens |
|---|---|---|
| m 4 | 14 | 32 |
| m 5 | 45 | 100 |
| m 6 | 139 | 312 |

WORLD-TRAVEL's 600 stars are far too few, as `research-render.md` and `research-astro.md` also found. With real extinction the normal street band holds about one star, so **stars can't be a feature of the chase camera at street level. They are a reward for stopping or climbing.**

**How they should look.**

- **One pixel, no glow.** Noise comes from size and flicker, not count. 61 stars in `orion-lookup.png` read as calm [M].
- **Five tiers from magnitude:** m < 2.5 GLOW_WHITE 7 with a small dim cross (93 stars in the sky [M]), then steps 6, 5, 4, 3, 2. A cross is what makes the Dipper read at 3x.
- **Colour only on the brightest,** from B-V: top blue or rose steps. Betelgeuse rose, Rigel blue.
- **No twinkle except low down,** and only ±1 step on a slow Bayer phase. Anything else boils.
- **Positions and relative brightness exact. The cut-off is generous**, about 1.5 magnitudes past a real city sky [E], and it opens as you climb: roughly m 4.5 at street, 5.5 at the ceiling, everything at 10 km, the Milky Way above that, and no atmosphere at all in space [E]. **The climb buys you the sky.** Dark places get more stars for free, because the city dome comes from built cover.

**Lines and names.** Look at `orion-lookup.png`.

- **When:** only at night, clear sky, bus nearly stopped, in the look-up. Never at cruise.
- **How:** 1 px, dashed 3 on 1 off, stopping 3 px short of each star, GLOW_WHITE step 1. Stippled in over about 1.5 s, not faded.
- **Names:** one at a time, the figure nearest screen centre, `FONT_SMALL`, a few steps above the sky's own colour.
- **Clouds and the Moon cover them,** as they cover stars.

**In the game's voice: a highway blade with the real number.** The sign already exists, so give it the sky's distances.

```
MOON 238900 MI        BIG DIPPER            POLARIS
ORION NOT TODAY       NO U TURNS            KEEP RIGHT
```

The Moon number should be live. It moves by tens of thousands of miles through the month, so the sign changes daily and doubles as a tease for the turbo flight. Today it would read about 228,600 mi [E, low-precision].

**The look-up itself.** When the bus slows at night, the camera drifts up 6-12° over 2 s and the bus settles near the bottom of the frame, wheezing. `research-render.md` confirms the top of frame falls to 2.2° in slow flight [M there; 2.27° in my `alamo3` pose], which is exactly backwards for this: the slow pose tilts down today. Producer's call, because it touches the flight camera.

**Moon floor.** Recommended 15 px [E, my eye; `moon-scale.png`]. Position and phase stay exact. It holds through the lens change on climb, and true size overtakes it about 252,000 km into the flight on the 38° lens, 287,000 km if the flight widens to 50° [E, arithmetic]. Near a solar eclipse the floor should release, or a floor-sized Moon would wrongly swallow the Sun [E]. 24 px looks lovely and storybook: taste call.

---

## 7. The beauty bar

For one outside judge, one round, on the real phone. Show each frame beside today's frame of the same pose. Look for 3 seconds, then 30. Score each line 0-3.

| # | Test | 0 | 3 |
|---|---|---|---|
| 1 | **Light, not tint.** Did the light move, or did someone drag a slider? | Same shadows, new colour | You can tell where the light comes from and how low it is |
| 2 | **Squint.** At thumbnail size, is the state obvious? | Mush | Three clear value masses |
| 3 | **Paint is king.** What do you see first? | The sky or the grey city | The painted block |
| 4 | **The sky has a reason.** Would someone there recognise this sky? | Generic gradient | Real, and composed |
| 5 | **Depth.** Are there layers from bus to horizon? | Flat sheet | Near, mid, far, ridge, sky |
| 6 | **Pixel discipline.** | Noise, bands crawl | Clean bands, single-pixel lights, calm in motion |
| 7 | **The hero.** Is the bus found in under a second? | Lost | Instantly, in every state |
| 8 | **Voice.** Does it still feel wheezy and joyful? | Moody, solemn, realistic | Funny and lovely |
| 9 | **Turn-through.** Does a day pass without a jolt? | Pops, snaps | You stop noticing it change |
| 10 | **Would you send it to someone?** | No | You already have |

**Pass:** 22 of 30, with nothing at 0.

**Hard fails, measured, no judge needed.** Any brown or taupe pixel. World peak chroma over 0.75 of paint median. Paint above step 5.45 outside a glint. Any off-palette pixel. `tools/shimmer.py` worse than today's on the same pose. Any flash over the WCAG limit.

**Capture list.** Poses are today's (`look.mjs`, `tools/shots.mjs`). Dates are real for those poses. The sky build will need `?t=` and `?wx=` overrides.

| # | Pose | Date and time, local | Weather | Looking for |
|---|---|---|---|---|
| 1 | Alamo L1 sign: bus (-1209, 100, -160), heading 88 | 2027-03-21 18:40 PDT | clear | Golden hour, Ladies lit, windows flash |
| 2 | same | 2027-03-21 19:13 PDT | clear | Sunset, Moon 1.9° up |
| 3 | same | 2027-02-20 18:20 PST | clear | **Blue hour, the hero** |
| 4 | same | 2027-02-21 20:00 PST | clear | Full Moon, look-up 6° |
| 5 | same | 2027-04-08 06:50 PDT | clear | Sun at the end of Grove St |
| 6 | same | 2026-12-08 19:00 PST | clear | Orion, look-up 10° |
| 7 | same | 2027-04-08 13:15 PDT | clear | Noon stays the game |
| 8 | FiDi det pose: cam (1619, 178, -1874), heading 1 | 2027-07-14 19:40 PDT | fog | Towers as islands |
| 9 | same | 2027-01-20 16:50 PST | rain | Wet streets |
| 10 | Ceiling det pose: cam (1622, 694, -2017) | 2026-11-09 19:30 PST | clear | Dipper over the Bay |
| 11 | Amsterdam: `lat=52.3738&lon=4.8775&heading=75` | a clear evening, sun -6° | clear | **Any-city test.** No hand tuning |
| 12 | London, the pose of `merge-osm/paint3/london-park.png` | a clear night, new moon | overcast then clear | Any-city test, lamps from OSM alone |
| 13 | Time-lapse: pose 1, sun +12° to -10°, 20 s | | clear | Turn-through |
| 14 | Cruise 10 s at pose 3 | | clear | Crawl, shimmer on windows and lamps |

---

## 8. What this changes

| Where | It says | Finding |
|---|---|---|
| Sky brief | Moon about 5 px | 8.4 px street, 5.2 px ceiling [M], agreeing with `research-render.md` |
| WORLD-TRAVEL §2.2 | About 600 stars at 1 px, fading in below -6° | Too few [M]. The brightest should begin near -3° [E, from NWS], tiers in §6 |
| WORLD-TRAVEL §2.3 | Compress elevations toward 35° | I first copied this, then corrected noon: shadows true, wall shading softened, as `research-render.md` argues |
| WORLD-TRAVEL §2.3 | Nights are blue hour, never black | Keep it for moonlit nights. A new-moon night can go near-black in the sky, because lamps and windows carry the frame [E, `ceiling-night-bay.png`] |
| WORLD-TRAVEL §2.5 | Ramps 32-37 | Add LIT, LAMP, MOON, SNOW, RIDGE. Rows 38-47 hold them |
| VERDICT step 0 | Far fade to 21-34 km is a fix among others | Now also **a sky dependency**: it holds the ridge every moonrise needs [M] |
| Shadows | Sun pass, 520 m window, 1,600 m in vista | Dusk and dawn need the far height sweep. The mocks trace to 5.2 km. **Largest engineering risk to the beauty of dawn and dusk** [E] |

**Where I differ from `research-render.md`.**

1. **Table, yes; table alone, no.** It says a table gives the base look and the mocks prove the mechanism, and I agree. The numbers in §1 say the rest has to come from real light and sources. It reaches the same point on golden hour.
2. **Paint rows at deep night.** It says leave rows 8-13 alone, and its engine arithmetic gives painted walls near steps 2.9-3.6, close to my 1.8-4.6, so we mostly agree on steps. I also dim the rows to 84-90 % and raise chroma to 110 %. To my eye paint at full daylight value looks pasted onto a deep night; paint in its `mock-night.png` column E against mine in `alamo-fullmoon.png` shows the two. Taste call, and keeping rows untouched is the cheaper answer.
3. **Wet streets.** Its 2-fetch smear is what the phone can afford. My traced reflection is a target, not a plan.

**Art question this raises for sound and feel:** real time means many players will first see the game at night. `research-render.md` measures the sun below -6° for 45 % of SF hours. **Night is half the game,** so the night art is the first impression for half of all players, and it must ship with the sky, not after it.

---

## 9. For the producer

1. **Does blue hour over the painted block feel right?** That frame sets the whole direction.
2. **Moon floor: 15 px, or storybook 24?** See `moon-scale.png`.
3. **Night paint: deeper rows, or daylight rows?** Compare `alamo-fullmoon.png` with `mock-night.png` column E.
4. **Add a look-up camera when the bus slows at night?** Needed for stars and for any high Moon.
5. **The star cut-off: kinder than a real city sky?** I recommend yes, positions exact.
6. **Snow doesn't settle on paint?** I recommend yes. Paint is warm, and it's the game.
7. **Sign jokes:** do MOON 238900 MI / ORION NOT TODAY sound like this bus?

---

## 10. What I could not confirm

- **Nothing has run in the game, a browser or on a phone, and nothing has moved.** Windows, lamps, stars and rain may crawl or boil. Stills cannot say. Every cost here is an estimate.
- **The reconstruction is approximate.** Trees, props and the bus aren't in the height field, roofs are flat there, and shading is within 1 step on only 74-82 % of grey pixels [M]. Some shadow edges are off by a few pixels.
- **My ephemeris is low-precision,** 0.1-0.2° on the Moon. Dates are right; minutes may shift. Re-run them on `research-astro.md`'s model before capture.
- **Weather in all five weather states is staged.** Only the sun is true. Clouds are noise. Rain at night and fog at night were not mocked, and weather as a mix over time of day is unsolved.
- **Fog top of 74 m is an art pick.** The real deck is usually higher, so real days may bury the whole city or sit above it.
- **Far-shore lights, lit windows and lamp spacing are rules, not data.** 38 m is my guess; OSM `highway=street_lamp` nodes where mapped would be better.
- **Tuned on one city.** All palettes were tuned on SF frames. Amsterdam, London, Denver and Lagos are untested. Any-city claims are unproven until capture 11-12.
- **Sources not read:** Ferrari's GDC talk; the Firewatch talk and Campo Santo posts (403); the Unreal Octopath interview (403); Niche Gamer (403); Ferrari's podcast page (excerpt only). Lighting methods for Eastward, Hyper Light Drifter and Alto's Odyssey were not found. No source found for Journey's colour arc.
- **The Moon's tilt** in these mocks is approximate. The NASA map's licence and d3-celestial's data licence for shipping were not checked beyond the repo's BSD-3 notice; use the data `research-astro.md` recommends.
- **Faction ramps 24-31** are not graded, and the bus's own shader and particles were not re-lit.

**Files.** Mocks: `C:/Users/Utku/sbw-main/shots/local/sky/mocks/`. Scripts, in the session scratchpad and not in the repo: `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/sky-art-scripts/` (start at `s05_final.py`). Data: `.../scratchpad/sky/d3celestial-art/`, `.../scratchpad/sky/nasa-moon-art/`.
