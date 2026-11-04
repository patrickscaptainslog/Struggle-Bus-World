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
