# ASCENT: height, from the rooftops toward the Moon

The producer, 2026-11-01: raise the bus's height limit, mainly to fly with and paint airplanes, and keep in mind that it will fly to the Moon. Same day: climb speed must not grow with height. Fast climbs are the turbo modes' job: that is `docs/specs/flight/NOSE.md`.

**State.** The ceiling is 15 km, over the airliners. `main` has had it since 84e77c3. The fixes after that (the land's jitter, the ground past the map, the fade in force) are on `feat/ascent`, and their final build is main-DLFNkuoE.js. Nothing here has run on a phone. The planes themselves are held, with streets and the rest of that list.

## What changed

The ceiling is a number, `config.flight.ceiling`. Everything else height changes is a function of the height over the nearest surface, in `src/game/Ascent.ts`. That file knows no latitude, no flat ground and no city, and it takes no state.

| Function | What it does | Why |
|---|---|---|
| `mapReach(h)`, `floorPastMap(d)` | The map's edge gives way 4 m per metre of height, up to 8 km past it | Out there only the ground has collision, so the same slope is a floor, and the bus comes down over the map. That ground is `horizon.bin`'s mesh (`City.groundAt`), so a dive for home rides over the hills. A city with no `horizon.bin` keeps the slope alone |
| `nearPlane(h, base)` | 1.5 m to 800 m, 60 m by about 10 km | Depth where the ground is. At 1.5 m a 24-bit depth gives 23 m at 24 km and the East Bay stripes against the water |
| `fadeEnd(h, base, room)` | The far fade reaches as far along the ground at any height, and no further than the land does | "The far plane is one function of height" (SKY section 2) |
| `pitchAdd(h, base)` | The view looks down as far as the fade's line has dropped, past 3 km | The ground keeps the frame. It stops 3 degrees short of losing the horizon, so something at the bus's height stays in frame |
| `snapReach(h, base)` | The pixel grid's depth limit stands at 5 km to 800 m, then grows with the height | The grid snaps at the ground under the screen's center, 22 km away at 12 km up, and the upscale's sub-pixel shift is exact only at that depth. Short of it the land jumps back and forth |

Below 800 m the lens functions are the old constants. `?ceiling=520` puts the old ceiling back, so `shots --det` compares frames with any older build.

## Climbing

The plain climb is the old one, at any height: 40 m/s at full pull, so 15 km is about 6 minutes on the yoke alone. Speeds don't change with height either. A fast climb is a gear pointed up: with a gear or the boost on the pull, the speed goes where the nose points, up to 85 degrees (`docs/specs/flight/NOSE.md`), and Jet climbs at 448 m/s, 15 km in about 36 s. Nothing grows with height: height only says when a gear can engage. `stratosClimb` and `warpClimb` (700 and 3,000 m/s) still lift the bus to those gears' heights behind `config.turbo.worldTravel`.

Measured on `feat/ascent`'s final build, the bus placed by hand and the real stick, the same at 520 m, 1.5, 3, 6, 12 and 15 km: full pull 40 m/s, cruise 26.4 m/s, surge 98.6 m/s, full turn about 1.4 rad/s. At 15 km the pull gives 0, because that is the ceiling. The dive and the gears' climb are NOSE's numbers now: a full push is 98 m/s down, Jet 448 m/s up or down.

## What it costs

Draws and triangles of the whole frame on the final build, the most of 12 frames in a hold, on this laptop. No frame rate here: nothing has been timed at height, and never on a phone.

| Height | Draws, triangles: over Duboce, heading 60 | Over the Sunset, heading 62, downtown ahead | Near plane | View pitch |
|---|---|---|---|---|
| 520 m | 153, 1,068,749 | 178, 1,398,379 | 1.5 m | 22 degrees |
| 1.5 km | 52, 721,296 | 70, 979,659 | 4.5 m | 22 degrees |
| 3 km | 49, 658,283 | 72, 1,021,153 | 14.5 m | 22 degrees |
| 6 km | 47, 576,745 | 72, 942,718 | 34.6 m | 26.9 degrees |
| 12 km | 32, 395,433 | 62, 666,847 | 60 m | 33.9 degrees |
| 15 km | 21, 284,503 | 48, 496,543 | 60 m | 33.9 degrees |

At both spots every height over the old ceiling costs fewer draws and triangles than the old ceiling does, 650 m, 800 m and 1 km included (148, 1,281,078 is the most, over the Sunset at 650 m). These are two spots, not a sweep. No new shader program appears at any of these heights.

## What stands between this and the Moon

1. **The ceiling.** A number. Rainbow Warp already lifts `Flight.turbo.ceiling` past it, to 16 km over the ground. Stratos's stays under it, at 3.2 km, so `Flight.step` ignores that one.
2. **A round world.** Nothing in the game is round yet. Each city is its own flat map, projected around its own origin, and `src/game/geo.ts` uses the Earth's real shape only to put a latitude on that map. The round designs are all on paper: SKY's one Sun, Earth and Moon model, WORLD-TRAVEL section 1.4's camera-relative curvature, and VERDICT band 5's cube-sphere tile tree per body. `Flight.y` is metres in a double, good to micrometres at the Moon, but the render frame is flat and float32, so past about 50 km the bus needs SKY section 2's `Observer`, with bodies as ray-sphere tests in the resolve's sky branch.
3. **The land.** Past `horizon.bin` there is only the water plane. Far-field day 3's surround raster lifts `reachMax` and the fade's cap for a city, and the planet tile tree ends them.
4. **The sky.** It doesn't darken with height yet. SKY's `Body.air` and `uFog.w` are the place, and `fadeEnd` is already the function they should scale.

**Rules for what comes next.** Height comes through `Ascent.ts`, never a new constant in a caller. No `y >` test on a fixed altitude. Nothing here reads latitude, and nothing stores an elevation. The near plane may move: don't draw inside it (the bus is 270 m from the lens up there) and don't depend on `EXT_clip_control`.

## Left on purpose

- **Paint from up high.** A breath falls for a long time, and above about 3.2 km it lands out of frame. It still paints the near regions ahead of the bus, and only those: no far surface takes paint yet. Its flash, hit-stop and camera kick still go off, with nothing on screen to explain them. Gating those would change any off-frame landing at low height too, so that is the producer's call. Planes will need their own aim.
- **Near regions up high.** They still stream under the bus, and they leave the frame at about 12 km. It costs no more than a ceiling flight does today, so it stays until a phone says otherwise.
- **The East Bay's pale flats.** `horizon.bin`'s low land is one pale ramp, and from 1.5 km up it reads as a sheet of ice. Day 3 replaces it.
- **The map's edge from up high.** The far raster stops at the map's bounds and `horizon.bin`'s flat greens go on. Main shows the same edge from its old ceiling, but from 3 km up, looking south, it is a ruler-straight line across the frame. Day 3 replaces it. At the edge itself the two surfaces disagree by up to 75 m, so `groundAt` steps there; the floor eases it, and no pop has shown.
- **The far plane's cut against the sky.** Up high it sits 20 to 30 degrees below the horizontal, and the sky under it isn't the fog's colour. In most headings that is one palette step. Toward the sun it is a cream block over half the sky with a straight bottom. The fix is in the resolve's sky branch, gated by height, and it belongs with the sky slice.
- **Small cities.** London's and Amsterdam's maps are 2 to 3 km across with no `horizon.bin`, so from 3 km up the map is under the bottom of the frame and the frame is sea.
- **A raster that lands late.** If `far16.bin` lands after the bus has passed 3 km, the view tilts in one frame, up to 4.5 degrees near 7.5 km, as the fade goes from 20 to 34 km. That takes a raster at least 75 s late at full pull, about 9 s after the shift into Jet on a full pull. With the raster missing altogether the fade reaches 20 km along the ground from any height, and from 12 km that ends in palette bands.
- **`?fog`.** `uFog.z` stays at `farFull`, 2,600 m, so above about 3 km the frame is the bus on blank fog. Fog is off by default. When it comes back, `farFull` needs the same height term as `fadeEnd`.
