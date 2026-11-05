# LIFE: the movers

Life's own spec, the second account's (`CONTRACT.md`, the line between it and the world, holds over this; `LIVING.md` is the plan). What life does inside: its worker, what it sends back, how movers are drawn, how they take paint. Changes here need no cycle with the first account, unless they touch what `CONTRACT.md` says.

**State.** Stage 1 started 2026-11-05 on `feat/life`, cut from `feat/earth` at 03d3181, `feat/earth` merged in again at 303718e. Built that night: the mover system (the pools, the specks, the worker, the level of detail), planes live through the relay and scripted when it's down, paint on a mover from a tap or a super's blast, contrails, the flight's loop over 15 km, and the tests below. Next: ferries, sailboats and ships once the world's graphs and lanes are in (`CONTRACT.md` section 1), and airports' approaches once `airports.bin` is. Facts are marked as `LIVING.md` marks them.

## The parts

| File | What |
|---|---|
| `src/life/lifeBoot.ts` | `bootLife(ctx)`: under `?life` only, never rejects into the boot. Makes the pools, the worker and the planes' feed, and returns the `Life` of `CONTRACT.md` section 6 |
| `src/life/Life.ts` | The host: once a frame it carries every mover on from the last snapshot, picks each one's level of detail, fills the pools, answers the aim |
| `src/life/lifeWorker.ts` | The simulation: every mover near the bus, as a function of the place, its data and `utcMs` (section 5 of the contract), into a snapshot |
| `src/life/kinds.ts` | The kinds of mover: their size, pool, shape and speeds. Worker-safe |
| `src/life/sim/*.ts` | One simulation a kind: `planes.ts` first. Worker-safe, pure: no `Date.now`, `performance.now` or `Math.random` |
| `src/life/pools.ts` | Three instanced pools (small, middle, large), the specks, the marks, and their one material each |
| `src/life/paint.ts` | A mover's paint: its record and the store (IndexedDB, `CONTRACT.md` O14) |
| `src/life/weather.ts` | `Weather` and `CLEAR` (`CONTRACT.md` section 4): the worker is handed CLEAR and every simulation takes it |
| `src/life/relay.ts`, `api/planes.ts` | The relay: the planes in a box round the bus, cached at the edge for 10 s (`LIVING.md`, "No server becomes one small relay"); `relay.ts` is its pure reading of adsb.lol, which Node checks |
| `life-check.html`, `src/life/check.ts`, `checkVectors.json` | L1's WebKit leg: a page of its own the producer opens on the iPhone (below) |

## The worker

A module worker, as `CONTRACT.md` section 2 says: `postMessage` and transfer lists only.

- **In:** `init` (the place's slug and origin, the relay's address or none, the weather), then `tick` at 10 Hz of the page's clock: `utcMs`, the bus's place on the map (x, y, z) and in degrees (for the relay), and the radius to fill: 80 km from the street, the horizon from the flight. The worker asks the relay itself, every 10 s.
- **Out:** a snapshot, transferred, which the host sends back with a later `tick` to be filled again: the same two buffers all night (`smoke.mjs` counts them). What a snapshot's arrival makes is its views over the new buffer, about 1.2 KB at 10 Hz (`alloc.mjs` prints it): a transfer arrives as a new `ArrayBuffer`, and with no shared memory there's no other way to read one.
- **A row** is 16 floats: the mover's key hash (u32 bits), kind, x, y, z at the snapshot's `utcMs`, vx, vy, vz (m/s), heading, pitch, bank (rad), size scale, flags (live), the seconds its paint would last from then (`until`), and two spare. The host carries a mover on between snapshots by its velocity, so a 10 Hz worker draws at 30 or 60 fps with no step.
- **Keys** are `CONTRACT.md` section 3's. The worker hashes them for the row (FNV-1a), and keeps the strings for the movers in reach, so the host can ask for a key by its hash when a breath lands.

## How movers are drawn

Three pools, one draw each in the scene pass, one geometry each holding every kind in its pool: each vertex says which kind it belongs to, and the vertex shader folds away what isn't the instance's (scale 0). So cars and boats share the middle pool's one draw, ships and planes the large pool's. A pool's model is a few dozen triangles a kind, made for pixel art at 6 to 40 px. Under 6 px the same model, which reads as a few pixels anyway; under 2 px a speck, one point in the specks' draw (`LIVING.md` rule 4: never a draw for something under two pixels). Painted movers keep a 1 px floor to orbit (`CONTRACT.md` 1.4).

Per instance: its matrix, its ramp (the grey world's rows, or `HUE_RAMPS[hue]` painted), its level (1 to 3), a glint (the aim's, a step up, as on buildings) and a surface id. At night, when the windows light (the live sky's and the held hour's `uLit`), a grey speck is its plane's lights: a beacon on the lamps' ramp an eighth of every 1.2 s, each its own phase from its key; a painted one keeps its paint. Each pool's material ends in `sbWrite`, flags 1.0 (outlined); specks and marks 0.5. All of them are registered with the warm-up (`registerWarm('life', ...)`), so nothing compiles in flight.

The pools are made at their largest at boot (`CONTRACT.md` section 2: people 4,096, middle 2,048, large 512, specks 16,384) and drawn with `count` set to what's live, one upload of the live range an attribute a frame, its range object reused (three's `addUpdateRange` makes one a call).

**Marks** (`CONTRACT.md` O6): one draw of ribbons, 8,192 vertices, 12 points a ribbon. A painted plane's contrail runs back along its path from its tail for as long as it has flown since the hit, 40 s of it at most, turned to the lens, a pixel wider a level up (2, 3, 4 px, and 8 m at the least), on its paint's ramp; at level 3 it runs through the hues. It fades as paint can in an indexed G-buffer, its pixels dropping out by a 4 x 4 ordered dither toward the old end, its first third solid, so the newest paint is the loudest. Flags 0.5, no shadow, fog cut as a painted speck's. Wakes and tracks are the same ribbons laid on the graph's heights, with a depth offset over the water or road, when the boats and cars come.

**From the flight's loop** (`CONTRACT.md` O4). Over 15 km the flight has the frame, and its own scene and render frame: the bus at the origin, a unit a metre, its axes in J2000 from Earth's centre. `moonrun.ts` hands life the bus Earth fixed with the render axes in that frame (`frameSky(dt, utcMs, ob)`), and the pools move into the flight's scene while it has the bus, back into the street's when the street has it. Each row is put Earth fixed once a snapshot, exactly (the map's projection, then the ellipsoid), and carried on by its velocity there; none is drawn behind the Earth (the line from the bus passes inside the ellipsoid); past 25 km a mover is drawn nearer the lens on its own line of sight, its size cut to match, since the flight draws to 30 km. A plane at the hand-over is where the frames before said it would be (`sky.mjs`). Off the map's sky, from about 400 km out, the projection is past what it's good for, and the planet's own sky is a later stage.

## What today's tiles have, before the graphs

The plan's step 5, "until the first account's graphs come, read what today's tiles have": San Francisco's tiles as they ship (MEASURED 2026-11-05, every `r_*.bin` read with the game's own `parseTerrainTile`): 2,433 tiles; a 2 m ground class each, SIDEWALK 27.3 %, PAVED 20.5 %, GRASS 18.7 %, YARD 14.7 %, WATER 10.3 %, FOREST 4.9 %, PATH 1.7 %, SAND 0.7 %, PLAZA 0.5 %, ROCK 0.5 %, RAIL 0.1 %; 28,161 named centerlines (2,727 names), 1,974 km of streets and 137 km of paths and plazas, each clipped to its tile with 2 m to spare; 120,545 trees; the 8 m obstacle grid (roofs plus 3 m); heights every 4 m.

What that gives life: people, who are never saved (`walk:`, CONTRACT.md section 3), can walk the SIDEWALK, PLAZA and PATH cells round the bus from these alone. What it doesn't: a street's direction, its lanes and speed, a join from one tile's piece to the next (only the name and the ends), and no ferry route, terminal, marina or airport. So cars wait for the graphs' edges (one-way, connectors, `NO_CARS`), and every boat and ship for `routes.bin` and the lanes (GRAPHS.md, CONTRACT.md 0.6).

## People

`src/life/sim/people.ts`, on today's tiles. With the bus under 1,500 m the host samples the tile nearest it in 700 m that it hasn't yet, 8 rows of its 4 m cells a frame through the world's own `groundClassAt` and `groundAt` (the walkable cells, sidewalk, plaza and path, and the ground's height in each), and hands the tile to the worker, its two arrays transferred; tiles past 1.6 km are dropped. The worker fills people within 800 m (2 px on the portrait lens): a tile's walkable cells over 24, 32 at most; each from a hashed walkable cell, along one of eight ways, walks the run of walkable cells there, ten each way at most, there and back at 0.9 to 1.5 m/s, all day, a closed form of the clock, keyed `walk:<tile>:<slot>:<UTC day>`. Its height is the cells' between their middles. Drawn from the small pool, three boxes facing the way it walks, a speck under 2 px. Painted it keeps its paint for the session only, no contrail and no beacon at night. What they'll do painted (stop, look up, wave, follow the bus) comes with the graphs' plazas and parks, and so do cars.

## Planes

**Live**, through the relay: the game asks `/api/planes?lat=&lon=&r=` (a box round the bus, in nautical miles as adsb.lol takes it) every 10 s while the street or the flight is over Earth. The relay asks adsb.lol's `v2/point` and keeps the answer at the edge for 10 s (`Cache-Control: s-maxage=10`), so a thousand players over one city make one request upstream. What it passes on, per aircraft: hex, flight, type, lat, lon, `alt_geom` (else `alt_baro`), ground speed, track, vertical rate, category, and whether it's on the ground. Only airline flights are named (`LIVING.md` rule 7: a call sign of three letters and a number); the rest go anonymous. A live plane is carried on from its report by its speed and track, up to 30 s, then dropped if no report has come.

**Scripted**, when the relay is down or not deployed (a page on localhost, a pinned or stepped clock, the tools): flights straight across a disc of 150 km round the place, at cruise (9.5-12 km, 60 %) or a middle height (3-7 km), two slots a UTC minute flown seven times in ten, deterministic by place and minute, no airport needed: 22 to 39 up at once over San Francisco across a day, 30 on average (`determinism.mjs`). Few cross the city itself (one in an hour over its middle on the 5th's evening): approaches and departures on each airport's real runways come with `airports.bin` (`CONTRACT.md` O11) and fill the city's sky. Nothing on the screen says which a plane is.

**From the street** at 15 km and under, an airliner is about 70 m and makes 6 px at about 13 km on the portrait lens (`CONTRACT.md` 1.4's arithmetic), so most planes in a San Francisco sky are specks and the ones on approach to SFO models.

## Paint on a mover

`CONTRACT.md` section 3: the aim asks `life.aim(...)` each frame, along the aim's ray and then the nose's (2.5 km, so a plane flown alongside can be painted); a mover nearer than the building target takes the glint and the shot, and the press latches it as a building is; `life.hit(key, color, utcMs, arrive)` at fire time takes effect at the impact. A MEGA, a hose's every impact and its closer paint every mover in reach of the blast (`life.blast`). A fresh mover takes the blast's hue at level 1, a painted one goes up a level, to 3. The record is the key, the hue and level, `until` and the namespace that placed it, in IndexedDB (O14), 2,000 records and 256 KB at most, the soonest `until` first out; under `?t=`, `?rate=` or `?fixeddt`, a test store of its own. A breath on its way when the flight takes the bus lands at once.

## The tests

`CONTRACT.md` section 7's, in `tools/life/`, each printing what it measured and exiting 1 on a failure. Browser tools take `BASE`, a built copy served.

| Tool | Where | What |
|---|---|---|
| `determinism.mjs` | Node | L1's Node leg: the same place and moment twice, the same bytes; 3,600 steps of a second end where an hour's jump does; two places differ; the sky over the place across a day; L7, CLEAR and no weather the same |
| `vectors.mjs`, `life-check.html`, `check.mjs` | Node, the iPhone, Chromium | L1's other legs: `vectors.mjs` writes the scripted sky at 16 places and moments from V8; the page works it out again in whatever engine opens it and says on the screen whether it matches within 1 cm, and `check.mjs` opens it in Chromium. The producer opens `life-check.html` on the preview, on the iPhone: Safari's engine is WebKit's leg |
| `relay-check.mjs` | Node | The relay's reading of adsb.lol, its box, its cache header, and a down upstream giving no planes |
| `alloc.mjs` | Node, `--expose-gc` | L4: `frame()`, `frameSky()` and `aim()` 10,000 times each after a warm-up grow the heap by under 64 KB; what V8 boxes of doubles meanwhile, and what a snapshot's arrival makes, printed beside it |
| `smoke.mjs` | browser | Life stands up on the street; a plane carried on between snapshots; L6's cloud leg, no program compiled 300 frames on; L2, the same two buffers out and back; no life without the flag |
| `paint.mjs` | browser | L5: a plane found by the aim where it will be; a hit at its impact, a second a level up; its contrail; a real tap from behind a plane over the city; kept across a reload in the test store, the real store untouched |
| `sky.mjs` | browser | O4: up through 15 km with every plane painted, none jumps on the screen when the flight takes the bus; the flight draws them and their contrails; back down, the street's again; at 300 km specks only |
| `flag-off.mjs` | browser | W6: the plain page and `?earth` with `?life` off against the same commit built with `SB_NO_LIFE=1`: the same requests and the same programs by their shaders' sources; life's files never asked for; no shared memory in the build |

Not yet: L3, the busiest view's draws and triangles, waits for the boats and cars; L5's ferry, 5,000 hits and another place's keys wait for the ferries and a second place; L6's laptop leg, `warmcheck.mjs` with `?life`.
