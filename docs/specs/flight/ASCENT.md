# ASCENT: height, from the rooftops toward the Moon

The producer, 2026-11-01: raise the bus's height limit, mainly to fly with and paint airplanes, and keep in mind that it will fly to the Moon.

**State.** On `feat/ascent`. The ceiling is 15 km, over the airliners. Nothing here has run on a phone. The planes themselves are held, with streets and the rest of that list.

## The one idea

Every rate is a function of the height over the nearest surface, in `src/game/Ascent.ts`. That file knows no latitude, no flat ground and no city, and it takes no state.

| Function | What it does | Why |
|---|---|---|
| `heightRate(h)` | The yoke's climb and dive, x `h / 520` past 520 m | The view pulls back at one steady pace at any height. This is the law that reaches the Moon |
| `heightSpeed(h)` | The thumb's speeds and G1, x the square root of that. G2 and G3 are already set for their height | The ground keeps moving, and the thumb's range covers an airliner at the airliner's height: 72-269 m/s at 3 km, 144-537 m/s at 12 km |
| `mapReach(h)`, `floorPastMap(d)` | The map's edge gives way 4 m per metre of height, up to 8 km past it | Out there nothing has collision, so the same slope is a floor, and the bus comes down over the map |
| `nearPlane(h, base)` | 1.5 m to 800 m, 60 m by about 10 km | Depth where the ground is. At 1.5 m a 24-bit depth gives 23 m at 24 km and the East Bay stripes against the water |
| `fadeEnd(h, base, room)` | The far fade reaches as far along the ground at any height, and no further than the land does | "The far plane is one function of height" (SKY section 2) |
| `pitchAdd(h, base)` | The view looks down as far as the fade's line has dropped, past 3 km | The ground keeps the frame. It stops 3 degrees short of losing the horizon, so an airliner at the bus's height stays in frame |

Below `scaleHeight` each of these is exactly 1 or the old constant. With `?ceiling=520`, `shots --det` compares frames with any older build.

**Numbers on the laptop, this build.** Full pull from the rooftops: 520 m in 12 s, 3 km in 36 s, 12 km in 55 s, the ceiling in 60 s. A dive from 15 km to 400 m: 43 s. Draws fall with height: 58 at 12 km, 46 held at 15 km, against 189 at 520 m.

## How this carries on to the Moon

**The climb.** `heightRate` is a rate proportional to height, so height grows exponentially with time at a held pull. It takes the same time to go from 1 km to 10 km as from 10,000 km to 100,000 km. At 0.077 per second (40 m/s at 520 m), rooftops to 384,400 km is 176 s at full pull. Counting height from the nearest surface, the rate falls again on the way in: halfway is 192,000 km, 14,800 km/s at its peak, and rooftop to Moon takes about 5.5 minutes on one law, landing included, with no gear in between. SKY section 9 asked for 5 minutes at 1,300 km/s, which leaves the braking curve unsolved. This solves it.

**What stands in the way, in order.**

1. `config.flight.ceiling`. The soft ceiling is a number, not a limit of the model. A rocket gear (or G2 and G3, which already lift `Flight.turbo.ceiling`) raises it.
2. The flat world. `Flight.y` is metres in a double, good to micrometres at the Moon, but the render frame is flat and float32. Past about 50 km the bus needs SKY section 2's `Observer`: true position in doubles, bodies as ray-sphere tests in the resolve's sky branch.
3. The land. Past `horizon.bin` there is only the water plane. Far-field day 3's surround raster lifts `reachMax` and the fade's cap for a city, and the planet tile tree (SPIKE band 5) ends them.
4. The sky. It doesn't darken with height yet. SKY's `Body.air` and `uFog.w` are the place, and `fadeEnd` is already the function they should scale.
5. Height means the nearest surface. `Flight.height` reads Earth's ground. Past `rebaseBody` it reads the Moon's.

**Rules for what comes next.** Height comes through `Ascent.ts`, never a new constant in a caller. No `y >` test on a fixed altitude: a band is a function of height. Nothing here reads latitude. Nothing stores an elevation. The near plane may move: don't draw inside it (the bus is 270 m from the lens up there) and don't depend on `EXT_clip_control`.

## Left on purpose

- **Paint from up high.** A breath from 6 km falls for a long time and paints nothing: no far surface takes paint yet. Planes will need their own aim.
- **Speed matching.** The thumb covers an airliner's speed, but holding it there is on the player. Worth a small assist when planes exist.
- **Near regions up high.** They still stream under the bus, out of frame above about 4 km. It costs no more than a ceiling flight does today, so it stays until a phone says otherwise.
- **The East Bay's pale flats.** `horizon.bin`'s low land is one pale ramp, and from 6 km it reads as a sheet of ice. Day 3 replaces it.
