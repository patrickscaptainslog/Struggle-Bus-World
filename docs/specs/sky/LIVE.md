# LIVE: the real sky, live

The producer, 2026-11-04: "Can we first, before we move onto this next big session, put in blue hour live and make the time of day change with realtime time of day, while also putting in the stars?" On 2026-11-01, after flying `?hour=blue`: "simply AMAZING... way way better than what i was hoping for."

**What it is.** `SKY.md`'s S2, the moving sun, and the street's half of S5: stars, planets and the Moon. It's the default on `feat/clock`, so merging this branch to `main` puts it live. `SKY.md` is the design; this file says what's decided and what differs.

## Decided

The producer can overrule any of these on the phone.

1. **The real sky over the city, now.** The real Sun and Moon at the city's origin at the real UTC time. A player anywhere sees San Francisco's sky as it is there. `?t=<ISO time>` sets the moment for tests and `?rate=<x>` speeds the clock.
2. **Night keeps the blue hour's look.** `SKY.md` §5 already draws night with the blue table ("Night colour: Dim | Blue hour table"). From dusk to dawn the lamps and windows are on by the city's clock and the stars are out. There's no black night.
3. **The Moon comes with the stars.** It's the same model, and a night sky without the real Moon is wrong half of every night. The 15 px floor is in `SKY.md` §4.5.
4. **On by default on this branch.** `?sky=off` and `config.sky.live` give today's day exactly: `shots --det` with `?sky=off` shows 0 pixels changed against `main`. `?hour=blue` stays the held hour.
5. **Weather stays off**, so every sky is clear. **No constellations**: they're S6, and `lines.bin` is CC BY-SA, not for `main` unreviewed.

## Port, don't rewrite

`src/sky/SkyModel.ts`, `Series.ts`, `series.gen.js`, `series.gen.d.ts`, `SkyClock.ts`, `public/sky/stars.bin` and `public/sky/moon.bin` come from `origin/feat/earth` byte for byte, so that branch merges cleanly later: `git -C <worktree> show origin/feat/earth:<path> > <path>`. Not `lines.bin` and not `tools/sky/line-stars.json`. Their credits go in `public/sky/DATA_LICENSE.md`: the Yale Bright Star Catalogue and NASA SVS's CGI Moon Kit.

## The stages

**A. The clock and the Sun.** The ephemeris (ported), `?t=`, `?rate=`, `__game.sky`; the Sun's light vector from its real position, the tick, the noon knee, the disc, the gradient and refraction (`SKY.md` §4, §4.1, §4.3); the sun pass by height from §4.2's table. Only the pass: S4's sweep isn't in this job, so under 3° the shadows fade out. Then §4's list of traps.

**B. The tables and the night.** Clear tables for noon, day (today's bytes), morning, golden, sunset, dawn, blue (S1's) and night (blue's, by decision 2), every row named, blended in OKLCH by the short arc with the clamp (§4). Windows by the city's clock: a `tz` in each `city.json` (an IANA zone, read with `Intl`). Lamps coming on in waves near -2° to -4° (§4.4). The boot colour in the inline script, so a night load isn't a grey screen (§4, "First paint").

**C. Stars, planets and the Moon from the street.** Stars as one `Points` draw, with tiers, twinkle faded by altitude, and planets (§4.6). The Moon sphere with its phase, earthshine and the 15 px floor, and moonlight as the key when it's up (§4.5). The lift at the ceiling pull (`skyLift`, §4.15), so the sky can be seen without the two-thumb look, which isn't live yet.

## Gates, at every stage

- `npx tsc -p tsconfig.main.json --noEmit`, `npm run build`, `node tools/iosfloor.mjs <build>`.
- `shots --det` with `?sky=off`: 0 pixels changed against `main`'s build.
- `tools/warmcheck.mjs`: 0 programs after the warm-up, with the sky on and with it off. `tools/allocs.mjs` flat.
- `tools/skycheck.mjs`: 0 brown, 0 off the palette, the paint cap held.
- Frames of San Francisco at seven moments with `?t=`: noon, golden hour, sunset, blue hour, midnight with the Moon up, a moonless night, dawn. Taken at Alamo Square, the opening and the 15 km ceiling.
- Frame time on this laptop's real GPU at those moments.

**Done when** the producer has flown the branch's preview at noon, dusk and night (links with `&t=`) and says it goes live.

## Known

- The two-thumb look isn't live, so from the street the stars sit near the horizon, and from high up and with the ceiling's lift they fill more of the frame. Once `feat/thumbs` is live, a look up shows the rest.
- Hot spots: `skyResolve.ts`, `PixelPipeline.ts`, `main.ts`, `config.ts` and the palette rows have all changed on `feat/moonfree` and `feat/earth` too. Keep the changes small, and in new files where that's possible. `feat/earth` merges `main` after this lands.
- Budget: `SKY.md` §6. Nothing compiles in flight and nothing allocates per frame. Draws: stars +1, the Moon 0 (it's drawn in the resolve).

## Stage A, built

On `feat/clock`: `38cf6b8` the port, `0b4f2b3` the live sky, `6f55511` and `9a1d44c` after it. All of it is `src/sky/LiveSky.ts` plus small edits; with `?sky=off` the page is today's to the byte.

- **The flag.** `src/sky/flag.ts`: `skyLive` (on unless `?sky=off`, `config.sky.live` off at load, or `?hour=blue`), `skyOn` (what compiles the hour's GLSL: the held hour or the live sky), `hourUp()` (the hour is up now: always under `?hour=blue`, from sunset to sunrise under the live sky). What read `heldHour && config.sky.X` at run time reads `hourUp() && config.sky.X`; what built things with the flag reads `skyOn`.
- **The model.** `LiveSky` holds an Observer at the city's origin (`WorldFrame.ts`, ported too: `axesAt`, `geodeticToFix`, no grid convergence at a transverse Mercator's origin), placed when `city.json` lands, and runs `SkyModel.frame()` every frame. `tools/sky/fixtures.mjs` (ported) passes all five Horizons fixtures, worst 0.0031 degrees.
- **Four vectors, three built.** `uSkySunDir` every frame, true plus refraction (Saemundsson's, 34 arcmin where the Sun sits on the horizon, times the air's density at the eye): the disc and the day sky's glow. `pipeline.keyDir`, true, on the tick: the sun pass. `uSunDir`, the key with the knee (`knee()`, render's table to 0.1 degree) and an azimuth slewed to `config.sky.slew` 40 degrees an hour. `uGlitterDir` is S5's.
- **The tick.** A `config.sky.tickWall` 30 m wall's shadow tip moving `tickPx` 2 game px at the bus, at most once a real second, on a frame where the view moved `tickMove` 3 px; held still it waits `tickHold` 60 s at 20 degrees and up, none by 10. The light (`uLight`) moves on the tick too.
- **The light.** SKY.md 4's key table, setting and rising rows crossed over three hours round solar noon and midnight by the hour angle. From 0.5 degrees down the key is the afterglow at the Sun's azimuth held at `keyHeight` +8, with research-render's .30 to .06 over dusk and .04 by -12. That is darker than S1's held .20: S1's hour sits near -2 degrees on this curve. Stage B can retune.
- **The pass.** It looks down the true key, from `clamp(0.55 ext / tan(el) + 300, 1400, 6000)` up the ray with far `2D + 600` and the bias 2.7 m of that range (`uShadowBias`). Its up is north, so 82 degrees never turns the lattice, and the cull floor is 0.02. `passK()`: today's strength from 12 degrees, street only under it (gone by vista 0.35), fading 3 to 0.5, none under.
- **The disc.** GLOW_WHITE 7, one ring of SKY_WARM 7, or TWILIGHT once the hour is up (the day table doesn't name TWILIGHT: stage B's tables all must). It's a circle test in the resolve's sky branch around a pixel's centre, projected with the snapped camera (`sunDisc()` in `skyResolve.ts`), at true size: 8.7 px at the street. It shows down to the horizon's dip at the eye's height.
- **The gradient.** The day's sky function reads `uSkySunDir`, so its glow sits on the disc and moves every frame. Its warm band toward the azimuth is a low sun's (`uSkyWarm.x`: full to 25 degrees, gone by 45, faded under the horizon by -6). Under the hour the bands bend toward the real Sun's azimuth, fading by -18 (`uSkyWarm.y`). Nothing else in the bands changed.
- **The tables, for now.** The day keeps today's bytes. At sunset (true centre -50 arcmin) the held hour comes up whole, its table, lights, lamps and windows, and it goes down at sunrise: a hard swap, stage B's blend.
- **Traps.** `skyWarm` and `seaShade` are gated by the Sun's height and guarded at the zenith. `sunR`, glint and glitter already scaled by key strength (S1, now under the live sky too). `kMatch` reads the live table's FOG (S1). The landmark clock (the Ferry Building's) reads `uClockHands`: the city's time from a `tz` in `city.json` when there is one (stage B adds it; `Intl`, once a sky minute), else mean solar time at the origin's longitude.

**Checks run** (this laptop's UHD 620, Edge). `tsc` clean. `npm run build` clean, main chunk 399.3 KB gzip by Vite's count (main's build 380.8 KB by `gzip -c`, this one 394.1 KB the same way). `iosfloor` parses every chunk, the same `.at` hits as main. `shots --det --q=sky=off` against `C:/Users/Utku/sb-build`: 8 of 8 views identical. With `?sky=off` all 55 shader sources match main's to the byte and the 18 requests are the same. `warmcheck`: 0 programs after the warm-up by day, at night, with `?sky=off` and through a dawn at `?rate=60` (that one, and `allocs`, on the build before `9a1d44c`); 32 programs on (the lamps' +1), 31 off; first draws after it only the upscale. `allocs`: 2.92 MB/s off, 3.06 day, 3.31 golden (its streaming), 2.76 night, nothing of the sky's in any top 14. `skycheck` at blue hour (`t=2026-11-05T01:30:00Z`): S1's result, FiDi's shimmer the one fail (12.77 % against 12.27 %). At noon its six fails are of three kinds:
- Amsterdam and London read off the palette, because it is night there and the check reads San Francisco's palette.
- The opening's shimmer is a misread: `shimmer.py` took the noon frame's block as 6 px. Pinned to 3 (`SB_PX_SCALE=3`) it's 1.39 % against today's 1.65 %.
- Two are the day table under a new light, stage B's: the Golden Gate's BRIDGE_ORANGE step 4 at 0.847 of paint's median, and 2,439 paint px over step 5.45 with the day's paint unclamped.

**Not done in A.**
- The bands' height term: below the true horizon at 12-15 km, still S1's wedges (HANDOFF; with far-field day 3).
- The Sun's glare across silhouettes, and the Belt of Venus.
- `uFog.w` and the far plane by height.
- The noon table and every other table, the boot colour, `city.tz`, windows by the clock, lamp waves (stage B).
- No phone has run it, and no frame times were taken.

## Stage B, built

On `feat/clock`: `e6e6fd9` the tables and the night, `fda183b` the cities' zones and the first paint, `0c5c205` the day keyframe's cap.

- **The tables.** `src/sky/SkyTables.ts`, written by `tools/sky/tables.py` from art's own `make_palette` (`states.py`) and S1's rules, as BLUE_TABLE was: noon, morning, golden, sunset, dawn, every one of BLUE_TABLE's 39 rows named. The day is today's bytes plus `DAY_EXTRA` (the rows it never named, and BRIDGE_ORANGE and LIT under the cap: today's bridge failed the one rule in golden hour's blend). Night is BLUE_TABLE. Where art has no row: from its kin, between the day's row and blue's as far as the table's city is toward blue. World rows stop at 0.74 of the table's paint median (worst 0.746 in the tables). The bands' tables turn the sun side's bands from 2.9 degrees up toward the far horizon, there by 14: the resolve's sky is one field that meets there, and art's dawn didn't, which drew a seam up the sky.
- **The blend.** `TableBlend` (`SkyTable.ts`): setting noon 35, day 22, golden 7, sunset 1.5, blue -5; rising noon 35, morning 16, dawn 1, blue -5; crossed by the light's hour-angle weight. OKLCH by the short arc (a grey takes the other's hue), then the clamp: a swatch the brown gate would fail drops to chroma 0.016. Paint and the bus are exempt. It writes the palette when the Sun has moved 0.05 degrees or a switch moved, nothing allocated, and `uFogLuma` from the bytes.
- **The hour as a weight.** `hourK()` in `flag.ts`: 0 at sunset's 1.5 degrees, 1 at blue hour's -5. What read `hourUp()` as a switch (glow, far fit, far ground, far boxes, beam) reads `byHour(day, hour, switch)`. The sky's method hands over by a dither (`uSkySun.w`) in the middle fifth of day to golden and morning to dawn, about 3 degrees; the haze follows (`uSkyHaze` is now light and weight). Paint stays under 5.45 at every hour.
- **Windows** by the city's clock: `config.sky.litShare` times `LIT_CLOCK` (the evening's share by local hour, homes and offices as one: one threshold per window) times `hourK`. Each `city.json` and bake config names its IANA `tz` (`America/Los_Angeles`, `Europe/Amsterdam`, `Europe/London`), the bake copies it, `Intl` reads it once a sky minute. SKY.md said tz-lookup at bake; a config field is one line per city and needs no package. `__sbDataV` is `osm3`.
- **Lamps** in waves: the share from 0 at -2 degrees to 1 at -4, a lamp on when `0.8 x its 300 m block's hash + 0.2 x its own` is under it, so blocks wake at their own times. Pools and the spans' lights go with it.
- **The light at night**, retuned as stage A allowed: from -4 down it holds S1's .34 / .20 / .20 (decision 2: night keeps the blue hour's look); research-render's curve to .04 is gone. Stage C's Moon key goes on top.
- **First paint.** The inline script reads a copy of city.json as it lands (any city), takes the Sun's height from boot_sun's 319 B model, and sets `body` and `theme-color`: today's grey at 3 degrees and up, `#5a4f9c` (blue hour's horizon) to -1, `#394295` below. Not with `?sky=off`; `?hour=blue` is night.

**Checks run** (UHD 620, Edge, build `C:/Users/Utku/sb-build-clock`). `tsc` clean. `npm run build` clean, main chunk 406.65 KB gzip by Vite (stage A 399.3). `iosfloor` parses every chunk, 19 `.at` hits, as main's build. `shots --det --q=sky=off` against main's build: 8 of 8 identical, on the last build and on the first. `warmcheck`: 32 programs on, 0 after the warm-up, by day, at night (`t=...04:00Z`) and through a dusk at `rate=60`; 31 off, 0 after; the upscale at frame 1 the only first draw; one frame over 100 ms after ready in the dusk run (117 ms, blasts) and one in the off run (150 ms, landmarks), none in the day run. `allocs`: 3.00 MB/s off, 3.15 noon, 2.99 dusk at `rate=60`, 2.77 night, nothing of the sky's in any top 14. Boot colour, read off `body` 1.5 s in: noon grey, sunset `#5a4f9c`, night `#394295`, `?sky=off` grey, `?hour=blue` and London's night `#394295`, London's noon grey.

`skycheck`, 7 views at 7 moments with `&rate=0` (golden on the last build, the rest on `e6e6fd9`'s, where the day keyframe has no weight): **0 brown or taupe, 0 on an unnamed row and paint on steps 6-7 within the glints, everywhere; 0 off the palette in San Francisco; world peak 0.742-0.746 of paint's median at noon, golden, sunset, dawn and morning, 0.73-0.742 at blue and night.** Its fails:
- Amsterdam and London off the palette at noon, sunset, golden, dawn and morning: the check reads San Francisco's palette and their sky is elsewhere. Read with their own (`--q=city=...`): 0 off at noon and at dawn.
- FiDi's shimmer at blue and night, 12.97 and 12.78 against 12.27: S1's.
- The opening's shimmer at low sun, `SB_PX_SCALE=3`: morning 2.02, golden 1.73, sunset 1.66 against today's 1.62 (noon 1.44, dawn 1.35, blue 1.42, night 1.43 pass; unpinned, noon, dawn and morning misread at 24-31 %). By screen band the morning's extra is the bridge's shadow on the water by the bus, the pass under a rising sun ahead; golden's and sunset's a little everywhere low in the frame. That's the light, not the tables.

**Not done in B.**
- `uLitHome` and `uLitWork`: one window share by local time.
- The weather tables, the air axis, the Belt of Venus, the bands' height term.
- No phone, no frame times, no frames at Alamo Square or of the lamps' wave in motion; dawn's sky by eye only on the opening.

## Stage C, built

On `feat/clock`: `9ffbf1f` the port (`stars.bin`, `moon.bin` from `origin/feat/earth`, same blob ids, and `public/sky/DATA_LICENSE.md`), `ca11684` the stars, planets and Moon, `5436dfd` the frames tool. Almost all of it is `src/sky/StreetSky.ts`; the resolve's part is two GLSL pieces in `skyResolve.ts` under the flag. With `?sky=off` nothing of it compiles or loads.

- **Stars.** One `THREE.Points` into the G-buffer, flags 0, at the far plane with no depth write: the resolve reads its pixels as sky (+1 fetch, the same texel as the flags), so the bus, the city and the far field cover a star by depth and the Moon covers it in the resolve. `stars.bin`'s 8,404 stars sorted by V at load; feat/earth's five tiers (GLOW_WHITE, LAMP for V < 2.2 and warm); a cross of 4 points at 4 steps under the star for V < 2.5 (92 stars). A star shows where it outshines the sky behind it (luma + 0.04), so near a bright horizon band the dim ones are gone, not dark holes.
- **The limit**, SKY.md 4.6: by the Sun, -2 degrees -1.5, -5 V 1, -10 V 4, -14 all; by the eye's height 5.0 at the street, 5.5 at 520 m, 6.5 from 10 km; less 1.5 x lit with the Moon up; extinction 0.05 a unit of air in the vertex shader. The draw range is the limit; under -2 degrees the draw is off (no daytime draw). `dark` (built cover) is not in.
- **Twinkle** in the vertex shader: chance `min(0.25, 0.05 X^1.75 exp(-h / 8 km))` of a step up or down per 12 fps tick of the game clock, by an integer hash of the star; gone from 10 to 15 degrees up and above 30 km; planets a tenth. Not judged in motion yet.
- **Planets.** Mercury, Venus, Mars, Jupiter, Saturn from the bundle's own Keplerian `planetHelio` (it was in `series.gen.js` already; read through a namespace import, so the port stays byte for byte), geocentric by the Sun's place, once a sky minute into the first 25 vertices (an update range, not the whole buffer). Magnitudes from the old Almanac phase laws; Mars on LAMP. Their limit is the stars' + 2.5 and opens at -2 degrees.
- **The Moon.** A disc test in the resolve's sky branch after the Sun's (so it covers the Sun and the stars), centred on a pixel like the Sun's, the normal from the disc's axes (the lens's right squared to the Moon, up, back), lit where it faces the Sun, its tone from `moon.bin` box-filtered to 256 x 128 through `moonRot`: phase, tilt and maria are the real ones. Lunar-Lambert as feat/earth's with the lit base raised from .35 to .45 (the 15 px disc read dull). Radius by `moonDrawnKm` with the 15 px floor (15.0-15.4 px in every frame); refraction as the Sun's; down below the horizon's dip. Earthshine `1.2 x sqrt(Earth lit from the Moon) x hourK` steps on the dark side, which shows only where it outshines the sky: by day the dark side is sky. A day Moon is pale (its levels pulled toward step 4). Eclipse: Earth's shadow on the disc from `SkyState.shadow`, the penumbra's inner third 3 steps down, the umbra on TWILIGHT, step 3 at the core to 7 at the rim. Seen at the ceiling on 2026-03-03T12:40Z (partial): violet with a rose rim.
- **Moonlight.** `moonKey = smooth(8, 12, el) x smooth(.25, .35, lit) x (1 - smooth(-4, 0.5, sun)) x (1 - 0.9 umbra)`. On the tick, the shading vector goes that far over to the Moon's (with the knee) and the key's strength is the night's .20 x (1 + moonKey x k), `k = min(1.5, 0.22 lit / max(sin el, 0.15))`. A tick is due when the weight has moved 0.02. Only where the sun pass is off, so no shadow swings; the Moon casts none (no moon pass at night: it would add the pass's draws to the cheapest hours).
- **The lift.** `rig.skyLift`: pulling at the ceiling (`flight.strain` over 0.3 and the bus over half of `config.flight.ceiling`, so a deck's ceiling doesn't count) tips the view up toward `config.sky.liftPull` 27 degrees at `liftRate` 1.6/s, a rotation after the look, exact once it arrives; never past half the lens less 6 degrees, so the bus stays in the frame (at the ceiling's wide lens that's the full 27). It's off without the live sky.

**Moments** (for San Francisco's origin, by the ported model; `tools/sky/clock-frames.mjs` holds them): noon `2026-11-05T20:05Z` (36.3), golden `2026-11-06T00:30Z` (5.9, setting), sunset `01:04Z` (-0.3), blue `01:35Z` (-6.2), moonless midnight `08:00Z` (the Moon -46), dawn `14:28Z` (-3.2, a 7 % crescent 24 degrees up). Midnight with the Moon up: `2026-11-30T08:00Z`, 13 degrees up in the east, 59 % lit. The Moon is new on the 9th; from the 17th to the 29th it's up at midnight but over the top of every frame (at the ceiling with the lift the top is about 32 degrees), so the 30th is the first such midnight a frame can show.
- **Gated later**, `aac6d92`: the lift only over `config.sky.liftFrom` 5 km. skycheck's ceiling poses fly into `?ceiling=520`, pull, let go and shoot a second later, which caught the view tipping back down: shimmer 5.0-5.4 % at the ceiling and 5.5-7.0 % at Amsterdam and London against today's 3.72, 5.27 and 4.52. Gated, those views read 2.86, 4.08 and 3.03.

**Checks run** (UHD 620, Edge, build `C:/Users/Utku/sb-build-clock`; main's in `C:/Users/Utku/sb-build`). `tsc` clean. `npm run build` clean, main chunk 412.74 KB gzip by Vite (stage B 406.65), 407,277 B by `gzip -c` against main's 380,751. `iosfloor` parses every chunk, 19 `.at` hits. `shots --det --q=sky=off` against main's build: 8 of 8 identical, on `ca11684`'s build and again on the last. `warmcheck`: 33 programs on (the stars' +1), 0 after the warm-up, by night (`t=2026-11-30T08:00Z`), by day, and through a dusk at `rate=60`; 31 off, 0 after; the upscale at frame 1 the only first draw; no frame or long task over 100 ms after ready in any run. The night and off runs again on the last build: the same. `allocs`: 2.90 MB/s at the Moon's midnight (the last build too), 2.85 moonless, 3.22 noon, 2.95 off; nothing of StreetSky's in any top 14 (once, at the Moon's midnight, `SkyModel.frame`'s minute step at 62 KB/s: stage A's series evaluation, once a sky minute).

`skycheck` with `&rate=0`, the last build: **0 brown or taupe, 0 on an unnamed row, 0 off the palette in San Francisco, world peak 0.73-0.743 of paint's median, at the Moon's midnight, a moonless midnight, blue hour and noon.** Its fails, all stage A's or B's: FiDi's shimmer at the three night moments (12.69, 12.56, 12.98 against 12.27); Amsterdam and London off the palette at both midnights and at noon (8 AM and 4 AM there: the check reads San Francisco's palette); noon's opening shimmer 23.9 % unpinned, 1.54 % against 1.62 with `SB_PX_SCALE=3`.

**Frames.** `node tools/sky/clock-frames.mjs <url> <dir>`, run once on `ca11684`'s build (the planets' arms and the lift's gate came after; neither shows in those frames), 21 frames and `sheet.png`, looked at. The street holds 6 stars at a moonless midnight at Alamo Square (SKY.md: about 5); the ceiling with the lift 3,609 vertices at the Moon's midnight, 8,797 moonless (all but the extinct); the Moon at 15.0-15.4 px, a 59 % gibbous lit from below with its maria, earthshine faint on the dark side; Mars warm. Also by hand: the dawn crescent (7 %) at the ceiling, earthshine a step over the twilight and the lit limb two pixels; a 12 % day crescent, a pale arc on the grey day sky, its dark side sky; the partial eclipse of 2026-03-03T12:40Z. Frame time, wall ms off `__stats` (`frameMs`, 60 fps is 16.67): Alamo 21.2 noon, 22.1 golden, 19.4 sunset, 20.4 blue, 16.7 the Moon's midnight, 20.6 moonless, 19.1 dawn; the opening 19.9 at noon, 16.6-16.7 at every other moment; the ceiling 16.65-16.68 at all seven. Alamo's draws 63-135, the ceiling's 11-14.

**Not done in C.**
- `dark`, the limit's lift where built cover is low; the Milky Way; the Moon's road on the bay (`uGlitterDir`); Moon shadows (no moon pass); the Moon covering the Sun's disc in a solar eclipse (the dark side is sky by day).
- The lift's other triggers (rest, the sunset beat, a raised phone) and the sky's signs.
- Twinkle not judged in motion; skycheck's bursts don't hold a star long enough to read it.
- Midnight with the Moon up can't be framed from the street this month: it's over the top of every street frame. The frames show it from the ceiling.
- No phone has run any of it, and the fps above is this laptop's.
