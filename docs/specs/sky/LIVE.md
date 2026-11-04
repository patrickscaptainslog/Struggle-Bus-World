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
