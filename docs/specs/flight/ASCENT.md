# ASCENT: height, from the rooftops toward the Moon

The producer, 2026-11-01: raise the bus's height limit, mainly to fly with and paint airplanes, and keep in mind that it will fly to the Moon. Same day: climb speed must not grow with height. Fast climbs are the turbo modes' job, and that work is for later.

**State.** On `feat/ascent`. The ceiling is 15 km, over the airliners. Nothing here has run on a phone. The planes themselves are held, with streets and the rest of that list.

## What changed

The ceiling is a number, `config.flight.ceiling`. Everything else height changes is a function of the height over the nearest surface, in `src/game/Ascent.ts`. That file knows no latitude, no flat ground and no city, and it takes no state.

| Function | What it does | Why |
|---|---|---|
| `mapReach(h)`, `floorPastMap(d)` | The map's edge gives way 4 m per metre of height, up to 8 km past it | Out there nothing has collision, so the same slope is a floor, and the bus comes down over the map |
| `nearPlane(h, base)` | 1.5 m to 800 m, 60 m by about 10 km | Depth where the ground is. At 1.5 m a 24-bit depth gives 23 m at 24 km and the East Bay stripes against the water |
| `fadeEnd(h, base, room)` | The far fade reaches as far along the ground at any height, and no further than the land does | "The far plane is one function of height" (SKY section 2) |
| `pitchAdd(h, base)` | The view looks down as far as the fade's line has dropped, past 3 km | The ground keeps the frame. It stops 3 degrees short of losing the horizon, so something at the bus's height stays in frame |

Below 800 m the lens functions are the old constants. `?ceiling=520` puts the old ceiling back, so `shots --det` compares frames with any older build.

## Climbing

The climb and dive rates are the old ones, at any height: 40 m/s at full pull, about 80 m/s in G1, so 15 km is about 6 minutes in plain flight and about 3 in G1. Speeds don't change with height either. Going faster up there is the turbo gears' job: `climb2` and `climb3` (700 and 3,000 m/s) already exist behind `config.turbo.worldTravel`. How the gears carry the bus up is a later decision, and nothing here assumes one.

## What stands between this and the Moon

1. **The ceiling.** A number, and G2 and G3 already lift `Flight.turbo.ceiling` past it.
2. **A round world.** Nothing in the game is round yet. Each city is its own flat map, projected around its own origin, and `src/game/geo.ts` uses the Earth's real shape only to put a latitude on that map. The round designs are all on paper: SKY's one Sun, Earth and Moon model, WORLD-TRAVEL section 1.4's camera-relative curvature, and VERDICT band 5's cube-sphere tile tree per body. `Flight.y` is metres in a double, good to micrometres at the Moon, but the render frame is flat and float32, so past about 50 km the bus needs SKY section 2's `Observer`, with bodies as ray-sphere tests in the resolve's sky branch.
3. **The land.** Past `horizon.bin` there is only the water plane. Far-field day 3's surround raster lifts `reachMax` and the fade's cap for a city, and the planet tile tree ends them.
4. **The sky.** It doesn't darken with height yet. SKY's `Body.air` and `uFog.w` are the place, and `fadeEnd` is already the function they should scale.

**Rules for what comes next.** Height comes through `Ascent.ts`, never a new constant in a caller. No `y >` test on a fixed altitude. Nothing here reads latitude, and nothing stores an elevation. The near plane may move: don't draw inside it (the bus is 270 m from the lens up there) and don't depend on `EXT_clip_control`.

## Left on purpose

- **Paint from up high.** A breath from 6 km falls for a long time and paints nothing: no far surface takes paint yet. Planes will need their own aim.
- **Near regions up high.** They still stream under the bus, out of frame above about 4 km. It costs no more than a ceiling flight does today, so it stays until a phone says otherwise.
- **The East Bay's pale flats.** `horizon.bin`'s low land is one pale ramp, and from 6 km it reads as a sheet of ice. Day 3 replaces it.
