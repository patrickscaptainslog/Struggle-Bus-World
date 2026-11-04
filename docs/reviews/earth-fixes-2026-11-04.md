# Review again: the fixes for the blockers and majors (feat/earth, 4badd9b to 1d2fe01)

The first account, 2026-11-04, on `feat/earth` at 1d2fe01: the fixes in 4badd9b and 92e7a15, with the second account's own account of them (`DECISIONS.md`, "The first account's review, its blockers and majors fixed") read against the code. The first review is [moonfree-earth-2026-11-04.md](moonfree-earth-2026-11-04.md).

**Verdict.** Nine of the eleven hold. The other two, M2/M3 (the Moon's open-ground paint kept by place) and M8 (the street's sound), each brought a new problem, three of them in the paint. Nothing goes to `main` until those are fixed and looked at again. The minors from the first review are still to do, after these.

## The eleven

| | What it was | Now | How I know |
|---|---|---|---|
| B1 | The plain page gains the old launch | Holds | `Launch.ts`, its tool and every use are gone (`git grep`, none left); `flag-off` below |
| B2 | Home from the Moon, the street never gets its thumb back | Holds | `groundHands` is taken at `main.ts:1027`, after the street's hands are on and before the resumed flight's go on at 1030; `swap.mjs` below |
| M1 | Looking up takes the bus's lane off the screen | Holds | `Input.inLookZone` keeps the lane's middle at least its half width from the sides and the bottom; the controls sim's two new rows |
| M2, M3 | The Moon's open-ground paint by tile of a map that slides, and a new map wipes it | Holds for where the paint comes back, with three new problems: P1 to P3 below | `keep.mjs` below; `paint-heavy.mjs` below |
| M4 | A night lit by Earth never gets its day | Holds | `MoonSky.slide` chooses again with `place()`'s own thresholds (the Sun under 0.02, Earth over 0.05) and sets `sunFix` and the worker's light with it; `light.mjs` below. The fade as it looks: not looked at |
| M5 | The bus tumbles after TO THE MOON? from free flight | Holds | `trip-fuzz.mjs 30 2`, the review's seed: the bus's worst turn 12.4 degrees a frame (it was 344); four seeds of 120, 0 failures, worst 18.5 |
| M6 | At the Moon after a dive the speed stays the law's | Holds | `moon-exit-check`: a dive to 50 km braked to 5.3 km/s, back up to the button in 66 s at 30 km/s |
| M7 | The street's taps and flicks go to the flight while it boots | Holds | `moonrun.ts:386-419` takes the street's four hands, sets the flight's, and puts the street's back with no `await` between; the flight's go to the join (`EarthLanding.hands`) |
| M8 | The street's wind and foghorn go silent once the flight boots | Holds on the street; P4 below in space | `moonrun.ts:396` |
| M9 | The page change drops `?city` and `?hour` | Holds | `SWAP_KEEP` |

## New

**P1 (major). A cell keeps 32 blasts, so a place a player paints a lot loses most of it on the next visit.** `GroundPaint.ts:59`: `GEO_PER_CELL = 32`, the oldest dropped, in cells of 0.02 degrees, about 600 m. A breath is 60 m across at the street's drop, so 32 of them hardly cover one cell once. Before this fix the tile's mask kept everything drawn on it, however many blasts it took. MEASURED (`paint-heavy.mjs`, at a fixed step on this laptop's GPU, `?moon&site=TYCHO`): 96 breaths over a 330 by 210 m patch and 10 big blasts round it; all 96 fell in one cell, which kept its newest 32; after a reload 89 % of the painted ground came back and 11 % was gone, the patch's oldest rows. Painting the same crater floor for a few minutes is how a player who likes the Moon plays it. Paint that disappears is the one thing the game can't do (`CLAUDE.md`: "i need to be able to paint the moon. thats the whole point of the game"). What to keep is the second account's call; one way that keeps everything: the list for the newest blasts, as now, and each cell's older paint folded into a small raster of its own in latitude and longitude that a tile resamples when it comes in. Or blasts stored compactly in IndexedDB, with no small cap. Either way the test is P1's: paint 200 breaths over one place, reload, and all of it is there.

**P2 (major). After a reload or a new map the paint comes back blast by blast, over seconds.** Every kept blast that reaches a tile is a replay job, `work()` starts one job a frame (`start`, then `return`), and the rows share 1,500 texels a frame. MEASURED on the same page: 42 kept blasts made 183 replays; 28 % of the paint was back after 120 frames, 55 % after 240, 85 % after 480, all of it after 540: 9 s at 60 fps, 18 s at 30. It cost no frame time here (17-18.5 ms a frame throughout, the display's own). Before, a tile's saved mask came back at once. P1's limit is all that keeps it this short: a place with ten full cells would take minutes. Whatever P1 does should bring a tile's paint back in a frame or two, the replays only for the newest blasts.

**P3 (minor, but it cuts paint). `geoAt` misses cells at one end of a tile's longitudes.** `GroundPaint.ts:926-928` walks columns of `lon / w`, but `geoCellOf` keys cells by `(lon + 180) / w`, and the two grids line up only where 180 is a whole number of `w`. Where they don't, the walk skips up to half a cell, about 300 m, at the east or the west end of the padded span, so a blast whose middle is there isn't drawn again on that tile when it comes in: its paint stops at the tile's edge in a straight line. Only blasts that reach more than about 100 m past their middle can be hit: a breath from high up, a MEGA. How far it reaches depends on the row: at Tycho the rows the test painted in miss at most 38 to 115 m, which is why its own check (each painted tile's blasts by their reach, against what `geoAt` returns) found 0 of 189 missing; two rows north, at 42.5 degrees south, it's 264 to 269 m. A replica of the walk in Node, 2,000 tiles at each of six latitudes from the equator to 75 degrees: 2.3-3.0 % of the places a blast can sit in a tile's padded span are missed, on about half of the tiles. Walk the cells in their own grid instead: per row, `j` from `Math.floor((lo0 + 180) / w)` to `Math.floor((lo1 + 180) / w)`, each taken round 360 with the row's own column count, so the date line still works.

**P4 (major). The street's wind plays on in space.** With M8's fix the flight's boot leaves the street's volumes alone, as it should on the street. But nothing quiets the wind and the foghorn when the flight takes the bus: `main.ts:1631`'s `hushGround()` quiets the engine and the hum only (`SoundGraph.ts:304`). The wind's level is set by the street's frame, and that stops at the hand-over, so the wind stays at its last level, the loudest it gets, a Turbo 3 climb at 15 km, all the way up to the long dark. MEASURED on `?earth` in real time, the street's sound engine read through `__game.audio`: on the street at 7 km, the ambience bus at 0.6 and the wind's rumble at 0.055 and its howls at 0.10 and 0.25; at the hand-up in Turbo 3 at 15 km, the rumble 0.31, the rush 0.08, the howls 1.50 and 0.50; 8 s later, the flight flying the bus, the rumble 0.31, the howls 1.54 and 0.49, the ambience bus still 0.6. The flight's own comment says why it shouldn't: "no wind (there's no air)". Quiet the ambience at the hand-up and give it back at the hand-down, eased as `hushGround` eases.

**Smaller.**
- `main.ts:1266`: a comment left with no code under it, "(straining at the top of the sky: ...)", where the launch's line was.
- `MoonTrip.ts:235`: `rungUp`'s doc comment is left over `g5Room`'s.
- `moonBoot.ts:171`: the light's ease runs on `performance.now()`, so with `fixeddt` it eases by the wall clock, not the game's: a tool at a fixed step sees a different fade than a player. The game's own clock would make the two the same.
- `GroundPaint.ts:846`: a blast's direction, the way it was stretched along the flight, is kept in the axes of the map it landed on and drawn again in the axes of the map it comes back on: a few degrees off after a slide, more near a pole. Mostly unseen.
- `GroundPaint.ts:867`: each blast writes its cell's whole list to storage, up to about 5 KB a `setItem`, on the frame it lands. Fine here; on an A15 it's worth folding into the save timer the tiles already use.

## Checks I ran

On this laptop, a real GPU (Intel UHD 620), on a build of 1d2fe01.

- Types with `main.ts`, the build, `iosfloor`: pass, every chunk parses on iOS 15.
- Node: `trip-fuzz` on the review's seed (`30 2`): 0 failures, view worst 3.5 degrees a frame, bus 12.4; four seeds of 120: 0 failures each, bus worst 18.5; `moon-exit-check` 3 of 3, `earth-check` all pass, `route-check`, `approach-check`, `view-check`, `resume-check` all pass.
- `paint-heavy.mjs` (new, mine; scratch, not in the repo): P1, P2 and P3's numbers above.
- The repo's tools in a browser: `keep.mjs` 5 of 5; `light.mjs` 3 of 3; `tools/earth/swap.mjs` all pass, home on the street a flick down stepping its own ladder and a tap breathing nothing in the flight (it needs `python3` with Pillow: on Windows the store's `python3` has none); `flag-off`: no launch, 0 flight requests, none of the flight's strings in the main chunk, 0 page errors.
- Real time, as the first review's: `?earth` cruising at 7 km, 601 frames at a median of 16.7 ms, the worst 17.4; the climb from 7 km to the hand-over at 15 km in Turbo 3, 10.1 s, the 4 s round the hand-over at most 50 ms a frame; the Moon low at Turbo 3 for five minutes, two slides, the frames round them at most 83 and 17 ms; `warmcheck` on `?earth`, the same 4 programs after the warm-up as in the first review (the flight's, as it boots behind the street), and none on the plain page.
- The same runs had long frames the first review's didn't: 11 over 100 ms in the Moon's five minutes (one of 1,184 ms), one of 367 ms with a program linked 2.7 s after `?moonland` said it was ready, and on the plain page one of 1,133 ms in its climb. The sky build was running its own checks on this laptop at the time: the page took 15.1 s to be ready where it took 10.7 in the first run. None of them sits at a slide or a hand-over, and the plain page's can't be these fixes, which only took code off that page. So I read them as the machine, and they get run again on a quiet laptop before anything goes to `main`, the late link on `?moonland` first.

## Not checked

M4's fade as it looks on a phone. M8 by ear. M7 with a flight boot that fails. Nothing on an A15.

## The producer's rulings since the first review, for the second account's list

- **Home from the Moon comes down wherever the player aims** (2026-11-04: "I want someone to return to earth and land wherever on earth they aim at and fly into"). Today the trip home flies itself back to 300 km over the page's city. It's in `CLAUDE.md`, "The Moon trip", and in TODO.
- **The living Earth is approved** (`docs/specs/earth/LIVING.md`), with the producer's additions: cargo ships simulated on the real lanes and painted, ferries simulated everywhere, weather noted for way later. Life is the second account's, on `feat/life`, after `CONTRACT.md`, which the first account drafts.
- **How every call is made:** "you are a world class game design studio - and at building this game and making decisions through that lens - strive to build an extraordinary, beautiful, engaging game at all times" (`CLAUDE.md`, "The game").
