# EARTHFLIGHT: the whole Earth, flown freely

The plan for the producer's ask of 2026-11-04, written by the second account before any of it was built. Their words are in `CLAUDE.md`, "The Moon trip". The first picks are marked, and the producer can overrule any of them on the phone. Each stage is pushed when it passes its checks, with the preview link and what to try.

> "I want to be able to freely way way higher than what I'm playing in this preview, fly high enough to essentially be a satellite and I don't want the screen to "skip jump" into outer space, I just want to free fly straight and then when I'm high enough I want the "to the moon" button to appear"

> "Put in very rudimentary temporary rendering of earth for now, to fill in later with more detail. The thing is: I really really want to be able to fly around freely earth, low, or high or satellite high in orbit, and if I go high enough the "to the moon?" Button will appear."

## What it is

- **One flight on Earth, no cut.** From the San Francisco street the bus climbs straight up past the street's 15 km ceiling, with nothing cutting in, and on up through satellite height. Anywhere over the Earth it flies freely, low, high or in orbit, with the street's yoke and gears. Very high up, TO THE MOON? comes up. Flown back down over San Francisco, it's the street again.
- **A temporary Earth.** Away from a city's map the ground is space's Earth map, `public/sky/earth.bin`: 2048 × 1024 for the whole world, about 20 km a texel, land and sea, four land classes, a tone and the night's lights, under the real Sun. Nothing on it is built yet: no buildings, no heights, and nothing to paint (first pick, below). Detail comes later from open data, and replaces this without redoing the flight.
- **One seam, in the dark.** Earth's page and the Moon's (`?moonland`) stay two pages: `FREEFLIGHT.md` already rules that a phone must not hold two worlds at once, and `boot()` holds one world per page. In the long dark between them, after the moon boost, the page changes over with the last frame held on screen: about a second where the stars stand still. The producer took that ("Ok", 2026-11-04).

## What it's built from

All of it exists for the Moon, and this is the same three joins on the other body.

| The Moon has | Where | Earth gets |
|---|---|---|
| A free leg under the orbit: yoke, the street's gears, the arrival's brake (`MoonTrip` leg `fall`, `rung`, `lawFall`) | `src/sky/MoonTrip.ts` | The same leg over Earth, at any height from the ground to 13,000 km |
| The ground drawn by a ray test from orbit, with the mesh dissolving in under 120 km and the low game taking the bus at 14 km | `src/moon/Landing.ts`, `src/render/skyResolve.ts` (`spaceMoon`) | `spaceEarth` drawn down to the ground, and the street's far field dissolving in over a city, the street taking the bus at 14 km |
| One page for the flight and its low game, the flight the pump (`bootLanding`, `LandWorld`, `frameAt`) | `src/main.ts`, `src/sky/moonrun.ts` | The street's page with the flight booted behind it (`?earth`) |
| The trip's legs, the view, the label, the eggs | `MoonTrip.ts`, `TripView.ts`, `moonrun.ts`, `EasterEgg.ts` | As they are, with the free leg in place of the hold over home |

The street's side: `config.flight.ceiling` 15 km (`docs/specs/flight/ASCENT.md`), the city's map in transverse Mercator about `manifest.origin` (`src/game/geo.ts`, which has only `latLonToLocal`: the inverse is to write), the far field `far16.bin` and `horizon.bin` round it.

## The shape

- **Heights over Earth.** Under 14 km over a city's map: the street (`boot()`). Everywhere else, and over a city from 15 km up: the flight's loop (`moonrun.ts`), drawing `spaceEarth` to the ground. Over a city between about 60 km and 14 km the flight's loop draws the street's far field over `spaceEarth` by a dither, as `Landing` does the Moon's mesh. At 14 km going down the street takes the bus; at 15 km going up the flight takes it back.
- **The Earth turns under the bus.** The flight flies in EQJ, which doesn't turn with the Earth. San Francisco goes by at 370 m/s in it. The free leg flies in Earth-fixed coordinates (position and heading kept fixed, turned into EQJ every frame by `SkyModel.earthFix`), so a bus at Cruise over a field stays over it. The hold over home, `wait`, already does this with `hc`. The legs out to the Moon stay in EQJ: at 13,000 km the turning is 1.4 km/s against the launch's 300.
- **Gears.** On the street the ladder is as it is. In the flight over Earth it's the Moon's: Cruise to Jet, then Stratos and Rainbow Warp (first pick), the street's readout. At Rainbow Warp a flick up climbs straight up at G4 (`rise`) to 13,000 km. Coming down, the arrival's brake (`lawFall`) brings a dive to Jet by 2 km, as it does at the Moon (first pick, and a second exception to "speed never grows with height": the producer's to say). The street takes the bus in Jet, or in its gear if that's under Jet, as `Landing` hands the Moon's low game its gear.
- **The button.** At 13,000 km the free leg holds level, and TO THE MOON? is up from there until the bus is back under 10,000 km (`VOYAGE.md`'s numbers). A tap on it launches from wherever the bus is: the route already starts from anywhere at that height, as it does from `high`.
- **Flags.** `?earth` on the street's page turns all of it on. Flag off is the law (`src/sky/flag.ts`): the plain page fetches nothing of space and compiles nothing of it, and `tools/sky/flag-off.mjs` proves it. Once the producer has flown it, they say whether it becomes the street's default.

## The stages

Each ends with checks run on the final build (the tools below), a push to `feat/earth`, and the producer's preview link: `https://struggle-bus-world-git-feat-earth-patricks-projects-9ff6e721.vercel.app/?earth&fps`, or for E1 `?moonland&fps`. The next stage starts at once unless the producer says wait (first pick: theirs to say).

### E1: the free leg over the plain Earth (in `?moonland`, no street yet). About 2 days

*Built 2026-11-04 (`DECISIONS.md`, "E1"). Its checks are `tools/sky/earth-check.mjs` in Node and `tools/earth/low.mjs` in the browser. Sound low over Earth, item 5, is left.*

1. **`MoonTrip`, leg `earth`:** the Moon's `fall` turned to Earth: Earth-fixed position and heading, the yoke (`YOKE`), the turn (`yaw`), `rung` and `rungV`, `lawFall` on Earth's height, a floor (first pick: 60 m over sea level everywhere, since `earth.bin` has no heights), a ceiling at `ALT5`. It replaces `wait`, `high` and `sink`: the trip starts in it 300 km over home, level, in Rainbow Warp, and comes home into it. `rise` stays, as the top gear's flick up. The egg is `earth`'s at the ceiling, by height with the 10,000 km rule. `qaGo`, `toMoon` and `launch` start from it. Keep `wait` as a word the tools can still say, or change every tool that says it (`route-check`, `approach-check`, `view-check`, `trip-fuzz`, `flicks.mjs`, `launch.mjs`).
2. **`TripView` over Earth:** the height rules by `hEarth` where the Moon's go by `hMoon - ground` (`LOW_AT`, `LOW_FROM`, `CITY`, `MOON_VISTA`), so low over the Earth the view is the street's and high up it's the vista. The nose and the climb as at the Moon.
3. **The ground, low down (`skyResolve.ts`, `spaceEarth`):** under about 150 km a breakup in Earth-fixed coordinates fades in, two or three octaves of value noise on the land's tone and the sea's step, palette ramps only, so speed reads low down. The sea a flat ramp with the Sun's glint as it has. No new saturated colour (`docs/specs/COMMON.md`). Check its cost: it runs on every ground pixel, the whole lower screen low down.
4. **The sky from inside the air:** today a ray that misses Earth is space, black, with the limb's glow. Under about 80 km the sky blends toward the street's daytime sky by height, the stars fading out under about 30 km, and at night stays dark (first pick: a height blend in the space branch; the observer's height is in `uEarthO.w` already, |o|² − 1 at unit radius, about 2h/R).
5. **Sound:** the street's wind and engine in Earth's air, under about 30 km; none above, as now. *Left for later in the build: the flight's sound engine is shared with the Moon's low game.*
6. **Taps over the plain Earth:** nothing to paint yet (first pick). *Built as the denied sound: the breath's aim is a ray test against the Moon.*
7. **The label:** the gear, speed and height as at the Moon; `LEG_NAMES` for the new leg (first pick: OVER EARTH).

Checks: `trip-fuzz` with players who dive anywhere, fly low for minutes, turn over the poles and climb to the button (0 failures on 4 seeds of 120); a drift check in Node (a bus at Cruise held 1 hour over a point stays within 1 m of it in Earth-fixed coordinates); `route-check`, `approach-check`, `view-check`; `flicks.mjs --trip` (the Moon's rows all still pass); a new `tools/earth/low.mjs` at a fixed step: from 300 km a held push to 200 m over the Pacific and over Kansas, 2 minutes low, the floor held, frames that show the ground moving; `smoke`, `iosfloor`, `npm run build`.

### E2: one page from the street up (`?earth`). About 3 days

*Built 2026-11-04 (`DECISIONS.md`, "E2"). Its check is `tools/earth/climb.mjs`, and the whole trip from the street and back is `tools/earth/trip.mjs`. Home is the street's map's origin. Item 5 as built: the old launch stays only on the page with no flag, where there's no flight behind the street.*

1. **`?earth`** in `flag.ts`, and `space()` true under it. The resolve's space branch gated at run time by a uniform, so on the street with the flag the sky is the street's until the flight says otherwise.
2. **Boot:** the street boots as it does now, with its own pump and its opening. Behind it, once its first frame is up, the flight's module boots (`bootMoonrun` with an Earth `land`), its programs warmed then. When the flight is ready the pump moves to the flight's loop, which calls the street's frame while the street has the bus (`landing.ground`, as `?moonland` does). Risk: the flight's 12 programs compiling behind a flying street. If that hitches on the phone, warm them in the street's own warm-up at boot instead, which costs boot time and nothing in flight (`CLAUDE.md`: nothing compiles in flight).
3. **`EarthLanding`** (`src/sky/EarthLanding.ts`), `Landing.ts`'s twin for a city, smaller: the street keeps its own world all the way up to the hand-over, so the flight never draws the street's meshes. The street's map is the city's transverse Mercator (`geo.ts`'s `localToLatLon`, `WorldFrame.ts`'s `fixToGeodetic`, both new); its render axes at a place are found by stepping 10 m along the map, so the grid's convergence can't be got the wrong way round. The street takes the bus at 14 km over the city and gives it back at 15, its heading, nose, speed and gear both ways, and the lens and the bus turned from one frame into the other.
4. **The street under `?earth`, as built:** the street's ground goes into the plain Earth as it climbs, and the two pictures are one picture at the hand-over. From 8 km to 11 km its sky turns space's (`uSpaceOn`, a dither: the space branch of the resolve is compiled in under the flag and kept off by it below that); from 11 km to 15 km the depth past which geometry turns to sky (`PixelPipeline.cutSky`) sweeps in from the far plane to 1.5 km past the lens, so the city goes into `spaceEarth` from the horizon in. The sky's uniforms over the street's lens are the flight's (`EarthLanding.over`, each street frame). The heights are in `src/sky/earthJoin.ts`, so with no flag the street's chunk holds nothing of the flight. The city's flat map isn't curved: it's gone into the plain Earth before the curve could show.
5. **The old launch goes:** `src/sky/Launch.ts`, the dark and the page change at the ceiling, and `?launch=`. `tools/moon/launch.mjs` becomes the climb's test.
6. **Home is the city the page is for.** `?home=` and MoonTrip's `lat`/`lon` from the manifest's origin.

Checks: `tools/earth/climb.mjs` at a fixed step: from the street a full pull to the ceiling and on, the change of loops at 15 km no bigger than an ordinary frame's change (measure it, as `tools/moon/slide-diff.py` does a join), on up to the button; and down again over San Francisco to the street, the same at 14 km. `flag-off.mjs` with no flag. `controls.mjs` thumbs at 1x on `?earth` (the same rows pass as without it). The E1 checks again. Frames of the climb for the producer.

### E3: the seam, in the dark. About 1 day

*Built 2026-11-04 on `feat/earthfree-e3` by a second session (`DECISIONS.md`, "The whole Earth, flown freely: E3"). The check is `tools/earth/swap.mjs`, from `?moonland&swap` rather than from the street, and `tools/sky/resume-check.mjs` in Node; the whole trip from the street, `tools/earth/trip.mjs`, came once E2 was in, and passes on the merged branch.*

1. **`MoonTrip.save()` and `MoonTrip.resume()`:** the leg, the clock, the position, the velocity, the heading, the gears, the boost, the trips so far, in `sessionStorage`.
2. **Out:** on Earth's page, a few seconds into `cruise` (the long dark: nothing but stars, the bus and its trail), take the frame (`toDataURL` right after a render), save the trip, and go to `?moonland&resume`; `index.html` shows the held frame until the flight's first one. The Moon's low game boots behind it as it does now, with the rest of the dark, three minutes or so, to do it in.
3. **Home:** the same from `homeCruise` to `?earth&resume`, where the boot order turns round: the flight first, from the resumed trip, and the street behind it, as `?moonland` boots the Moon's low game.
4. The sound is silent on the new page until the next touch (iOS's rule). Say so. *It is: a page the browser has just loaded may not start sound until it's touched, so after each change of pages the trip is silent until the player's next touch. Out there the only sound is a tap's breath, which is a touch.*

Checks: `tools/earth/trip.mjs`: from the street up, the button, the boost, the change of pages, the Moon's orbit, a landing, back to orbit, home, the change of pages back, and down to the street, with the held frame's change measured against the real one under it.

### E4: in and out of a city low down. About 1 to 2 days, after the producer has flown E2

The street turns the bus back at its map's edge (`mapReach`). Under `?earth` the edge hands the bus to the flight low over the plain Earth instead, and a bus flying in low from the plain Earth gets the city's far field dissolving in ahead of it and the street at the edge. Until this stage, a city is left and found from above.

## First picks, in one place

All taken by the producer, 2026-11-04: "Ok. It's a go", with Opus 5.5 at extra high for the first night.

| What | Pick |
|---|---|
| Gears over Earth's sky | the Moon's ladder, Cruise to Rainbow Warp; at the top a flick up climbs to the button |
| The brake coming down to Earth | the Moon's law, Jet by 2 km |
| The floor over the plain Earth | 60 m over sea level |
| The free leg's ceiling, where TO THE MOON? is up | 13,000 km, and gone under 10,000 |
| Taps over the plain Earth | the breath, and nothing painted |
| The flight's far field over a city | from 60 km down |
| The page change to and from the Moon | a few seconds into the long dark, the last frame held |
| The flag | `?earth`, the street's default only on the producer's word |
| The branch | `feat/earthfree`, cut from `feat/moonfree`, so the Moon's work can be reviewed and merged on its own. Renamed `feat/earth` on 2026-11-04: the preview's host name for `feat/earthfree` is 64 characters, one over what a name may be, so the link didn't exist |

## Risks

- **The phone.** Two loops on one page: memory (the flight's maps are about 10 MB of GPU), programs compiling behind the street, and `spaceEarth` with its breakup on most of the screen low down. Nothing has run on an A15; the producer's iPhone 17 Pro says only when it fails.
- **The street's shaders change under the flag.** With no flag they mustn't: `flag-off.mjs`, and the first account's review.
- **Earth's turning.** Anything in the free leg that slips into EQJ shows as the ground sliding at hundreds of m/s. The drift check is there for it.
- **The joins.** Every join on the Moon took fixes found only by flying it end to end at a fixed step. Plan for the same here.

## Left for later

Detail for the plain Earth: heights, a land cover a few hundred metres a texel, coastlines, from open data, around each city first and then everywhere. Each download the producer OKs first (`CLAUDE.md`). Places' names over Earth, as `MoonNames` has the Moon's. Paint on the plain Earth. The other cities (London, Amsterdam, Ross) as homes: their maps work as San Francisco's does, once E2 is in.

## Which model

The producer asked for an analysis (2026-11-04, lifting the old "No Haiku"). API prices per million tokens, from the `claude-api` reference cached 2026-10-06; how the producer's plan counts each against the weekly limit isn't visible from here, but a pricier model spends it faster.

| Model | Input | Cached input | Output | For this job |
|---|---|---|---|---|
| Haiku 5.5 | $0.10, $0.50 past 100K of prompt | | $0.50, $2.50 past 100K | Chores only: reading logs, finding code. These sessions run past 100K, so it's about 8 times cheaper than Opus there, not 40 |
| Sonnet 5.5 | $2 | $0.20 | $10 | The budget valve: the plainer stretches (test tools, docs, E3) if the limit runs short |
| Opus 5.5 | $4 | $0.20 | $20 | The pick, at high; xhigh for E2 |
| Fable 5.1 | $10 | $0.25 | $50 | Only if Opus can't get a join right: slower turns, and 2.5 times Opus for what it writes and thinks |

- **What the cost is.** A long session is mostly cached reading, and that's $0.20 to $0.25 on all three of Sonnet, Opus and Fable. What differs is what the model writes and thinks: there Sonnet is half Opus and Fable two and a half times.
- **What the job is.** The joins, Earth's turning and the shaders are where today's mistakes were (a view that jumped 78 degrees in a frame, a crater too small to see, an aim off the Moon after a pan), and each was found by a run of 15 to 20 minutes on this machine. A cheaper model that needs more fix-and-run rounds costs more in the end, in tokens and in the producer's flights. So the cost that counts is per finished stage, not per token.
- **Effort:** high on Opus 5.5 (its default is medium, which is too low for this), xhigh for E2, the street-to-space join. Max is for planning.
- **Fast mode** (`/fast`): about twice the cost a token for up to two and a half times the speed of writing. Not worth it here: the slow part is the cloud machine's software rendering, not the model.
- **A fresh session for each stage.** A long session re-reads its whole history at every step; this one did, and it's the biggest saving there is.

## How to work it

Fixed-step tools at 1x on the cloud machine (`CLAUDE.md`). Start a server with the longest background timeout, 7,200,000 ms; the default is 30 minutes, and a run dies with it. Never rebuild the served folder while a run is reading it. A tool that changes page holds the new page from its first frames (`addInitScript` with `window.__qa = { holdFrames }`), or the page runs on before the tool looks. Give each test touch its own finger id. `trip-fuzz` on four seeds is the earliest warning of a view that jumps: run it on every change to `MoonTrip` or `TripView`.
