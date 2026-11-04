# Review: feat/moonfree and feat/earth

The first account, 2026-11-04, on `feat/earth` at 4bfd4d7 (which holds `feat/moonfree` at a794fb6). Four Opus reviewers read the code by area (the controls and the merge of `feat/thumbs`, the Moon's slide, the trip and its ladder, Earth's page and the joins), and a second Opus tried to refute each finding. Then the real-time checks the cloud can't run, on this laptop's GPU.

**Verdict.** Neither branch goes to `main` until the two blockers and the majors are fixed and reviewed again. The minors can follow. Most of the work is sound: the reviewers list a great deal checked clean, and the real-GPU numbers are good.

## Blockers

1. **The plain page gains the old launch** (`src/main.ts:358`, `1265`). With no flag, a 3.2 s pull at the 15 km ceiling fades to black and jumps to `?moonland`, into the old automatic climb to 13,000 km and the button there. That is the cut the producer rejected ("I don't want the screen to skip jump into outer space"), and it breaks `BRIEF.md`'s own rule that the plain page doesn't change. EARTHFLIGHT.md's as-built note keeps it on purpose, but that's an engineer's call against two of the producer's rulings. `tools/sky/flag-off.mjs` can't see it: it checks fetches and shader text at load, not a strain at the ceiling. Fix: no `Launch` on the plain page.
2. **Home from the Moon, the street never gets its thumb back** (`src/main.ts:1600`, `?earth&resume`). On the resumed page `streetHands = hands()` reads the flight's handlers, so at the hand-down a tap breathes in the flight's unseen world, a flick steps the trip's rung, and three fingers open the flight's tuner, for the rest of the session. `tools/earth/swap.mjs` never taps or flicks after the street takes the bus. Fix: on that path `streetHands = groundHands`, and a tap and a flick in the swap test.

## Majors

| Area | Where | What a player sees | Fix |
|---|---|---|---|
| Controls | `src/main.ts:1540`, `Input.ts:823` | Looking up past about 20 degrees pushes the bus off the bottom of the screen, its lane goes with it, and no new touch can fly until the look lets go. A regression from `feat/thumbs`, on the street too | Keep the lane on the screen (`y` at most `H - r`), or a fixed lane while the bus is off it |
| Slide | `src/world/GroundPaint.ts:405` | `?moon`: open-ground paint made after a slide comes back 131 km away on the next visit, can overwrite older paint, and orphans storage keys | Save by a key that doesn't depend on the frame (as `CraterPaint` saves strokes by latitude), or move the storage entries at a slide |
| Slide | `src/moon/Landing.ts:241` | `?moonland`: flying above 16 km now remakes the world every 70 km, and each remake deletes the open-ground paint near the bus for good | Keep ground paint across `place()`, or don't re-place on a high pass |
| Slide | `src/moon/moonBoot.ts:173`, `MoonSky.ts:116` | A session that starts at night lit by Earth never gets its day: the sunlit side is shaded as night, lit from Earth, and goes black past Earth's limb | Choose the light source by place at the bus, not once per session |
| Trip | `src/sky/TripView.ts:306` | After TO THE MOON? from free flight, the bus model tumbles 85-110 degrees a frame for up to 4 s. New on `feat/earth`: `trip-fuzz.mjs 30 2` reports a worst bus turn of 344 against 14 on `feat/moonfree` | The roof and carve basis degenerates when a launch from a steep climb leaves the nose near the view's top: guard it, and make the fuzz fail on it |
| Trip | `src/sky/MoonTrip.ts:1036` | At the Moon, after a dive the speed stays capped by the height law even level or climbing: back up to TO PLANET EARTH? takes 6.6 minutes at 4.95 km/s while the label says Rainbow Warp. Over Earth the same moves take 66 s | Do what Earth's leg does: level or climbing, the gear's speed (`want2`) |
| Earth | `src/main.ts:1643`, `moonrun.ts:383` | While the flight boots behind the street, the street's taps and flicks go to the flight, and if the boot fails (a flaky network) they never come back | Don't install the flight's hands under `earth`, or put the street's back before the first `await` |
| Earth | `src/sky/moonrun.ts:391` | `?earth`: the street's wind and foghorn go silent for the session once the flight boots | Don't set the street's volumes from the flight's boot |
| Earth | `src/sky/moonrun.ts:186` | The page change drops `?city` and `?hour`: `?earth&city=london` comes home to San Francisco's street with London as the trip's home, so the street never takes the bus | Keep `city` and `hour` across the change, or save the city in the trip |

## Minors

- `?earth`'s street says LOCKED: WORLD TRAVEL COMING past Turbo 3, where the way on is the climb (`main.ts:1715`): `quietTop` is set for the Moon only.
- A new `busZone` object every frame in both loops (`main.ts:1540`, `moonrun.ts:624`); per-frame arrays in `EarthLanding.over` (`EarthLanding.ts:79`).
- `tools/controls.mjs`' `lookZone` row passes because its point is inside the lane; the `lookZone` tunable is dead on the street; most of `s_gesture.ts` still tests the left 42 %.
- With no `busZone` the rule falls back to the left 42 % (mirrored by SWAP), and `promote()` reads the lane at lift time (`Input.ts:826`).
- `Landing.at` isn't moved by low slides, so a later descent from over 140 km measures from a stale middle (`Landing.ts:212`).
- `uSlide` wraps at the second slide in one direction, not the fourth, so stones, paint edges and garden grain pop at 262 km (`moonBoot.ts:401`).
- `RoofSprouts.slide` leaves the old cells' batches visible with zeroed instances: extra draws at every slide (`sprouts.ts:979`).
- TO THE MOON? pressed in free flight drops the speed to 0.112 km/s for a moment (`MoonTrip.ts:555`).
- A swap that fails retries every frame with a full-canvas JPEG each time, and the trip then reaches a Moon with orbit splats and flick-up climbing (`moonrun.ts:453`, `456`).
- Space and MEGA press handlers stay the street's while the flight has the bus (`main.ts:1648`).
- `?earth&hour=blue`: the flight's boot paints the day's palette over the blue hour (`moonrun.ts:265`).

Not counted: a lone stroke outside the lane uses the easy flick rule over about three quarters of the screen now (`Input.ts:582`). `DECISIONS.md` says it's meant; nobody has counted the false shifts it may cause. The lane's width is the producer's design, not a bug.

## On a real GPU

This laptop, an Intel UHD 620, Edge with hardware GL, 393 x 852 at 3x, real time. A laptop, not a phone: read these as "no hitch in the code", and as a floor for what an A15 will show worse.

| Check | Result |
|---|---|
| `?earth` street, cruising, the flight booted behind it | 16.7 ms median, 17.4 ms worst over 10 s. The flight came up 6.8 s after the first region, and no program compiled after that |
| The climb from 7 km through the 15 km hand-over, Turbo 3, full pull, real speed | 10 s to the hand-over. Around it: 16.7 ms median, one 50 ms frame |
| Level at 15.8 km in Turbo 3 afterwards | Three long frames (567, 134 and 667 ms) about 2.5 minutes in on the first run. A second run of 260 s on the same path had no frame over 60 ms and no long task, so this didn't reproduce. The street's 25 regions stay loaded the whole way, 220 km out (508 geometries, 134 textures, 101 MB of heap): worth a look for the phone's memory |
| The plain Earth low down (`?moonland`, 177 m over the Sacramento Valley) | 16.7 ms median, 17.5 ms worst over 15 s: the breakup over the whole lower screen costs nothing here |
| The Moon low in Turbo 3 for 5 minutes (`?moon&site=TYCHO`) | Two slides, at 90 s and 237 s, 130.6 km each: 17.2 ms worst within 3 s of either, so the slide doesn't show in frame time. One 583 ms frame at 70 s, not at a slide, and not rerun. Textures and geometries fell as old ground went |
| `tools/sky/flag-off.mjs` | Pass: no flight requests or strings, 31 programs |
| `tools/warmcheck.mjs ?earth` | 4 programs compiled after the street's warm-up, all at load (10.7 s), with 83 and 69 ms long tasks. None in flight |
| `tools/warmcheck.mjs`, plain page | 0 programs after warm-up. One 217 ms frame in the blasts on the first of three runs, none in the other two, and none in three runs of `main`'s build: noise, as far as three runs can say |

## Not checked

The hand-down from the flight to the street at real speed; memory over a whole Moon lap; a lap at Stratos; the slide in the flight's low band by hand; night as it looks; the trip on the A15, which nothing has run on. The reviewers list what else they didn't read: tools/moon/slide.mjs, flicks.mjs and the Earth tools weren't run by them, and the root cause of the bus's tumble isn't traced to a line.
