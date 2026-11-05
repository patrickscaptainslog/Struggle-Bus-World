# LIFE: the movers

Life's own spec, the second account's (`CONTRACT.md`, the line between it and the world, holds over this; `LIVING.md` is the plan). What life does inside: its worker, what it sends back, how movers are drawn, how they take paint. Changes here need no cycle with the first account, unless they touch what `CONTRACT.md` says.

**State.** Stage 1 started 2026-11-05 on `feat/life`, cut from `feat/earth` at 03d3181. First: the mover system and planes. Facts are marked as `LIVING.md` marks them.

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
| `api/planes.ts` | The relay: the planes in a box round the bus, cached at the edge for 10-15 s (`LIVING.md`, "No server becomes one small relay") |

## The worker

A module worker, as `CONTRACT.md` section 2 says: `postMessage` and transfer lists only.

- **In:** `init` (the place's `PlaceInit`, the data version), then `tick` at 10 Hz: `utcMs`, the bus's place on the map (x, y, z) and its height over the ground, the radius to fill (by height: 2 km at street level, out to the horizon higher up), and the live planes when the relay's answer is new (as rows in a transferred buffer).
- **Out:** a snapshot: a `Float32Array` of rows, transferred, and the host sends it back with the next `tick` to be filled again (two buffers in flight at most, nothing allocated per message).
- **A row** is 16 floats: the mover's key hash (u32 bits), kind, x, y, z at the snapshot's `utcMs`, vx, vy, vz (m/s), heading, pitch, bank (rad), size scale, flags (grey, painted, live, a speck from the start), and two spare. The host carries a mover on between snapshots by its velocity, so a 10 Hz worker draws at 30 or 60 fps with no step.
- **Keys** are `CONTRACT.md` section 3's. The worker hashes them for the row (FNV-1a), and keeps the strings for the movers in reach, so the host can ask for a key by its hash when a breath lands.

## How movers are drawn

Three pools, one draw each in the scene pass, one geometry each holding every kind in its pool: each vertex says which kind it belongs to, and the vertex shader folds away what isn't the instance's (scale 0). So cars and boats share the middle pool's one draw, ships and planes the large pool's. A pool's model is a few dozen triangles a kind, made for pixel art at 6 to 40 px. Under 6 px the same model, which reads as a few pixels anyway; under 2 px a speck, one point in the specks' draw (`LIVING.md` rule 4: never a draw for something under two pixels). Painted movers keep a 1 px floor to orbit (`CONTRACT.md` 1.4).

Per instance: its matrix, its ramp (the grey world's rows, or `HUE_RAMPS[hue]` painted), its level (1 to 3), a glint (the aim's, a step up, as on buildings) and a surface id. Each pool's material ends in `sbWrite`, flags 1.0 (outlined); specks and marks 0.5. All of them are registered with the warm-up (`registerWarm('life', ...)`), so nothing compiles in flight.

The pools are made at their largest at boot (`CONTRACT.md` section 2: people 4,096, middle 2,048, large 512, specks 16,384) and drawn with `count` set to what's live, one `addUpdateRange` upload a pool a frame.

**Marks** (`CONTRACT.md` O6): one draw of ribbons, contrails in the sky, wakes on the water, tracks on the roads, drawn from the painted mover's record and its path, on the paint ramps with a depth offset and no shadow, fading with age so the player's own hits stay the loudest.

## Planes

**Live**, through the relay: the game asks `/api/planes?lat=&lon=&r=` (a box round the bus, in nautical miles as adsb.lol takes it) every 10 s while the street or the flight is over Earth. The relay asks adsb.lol's `v2/point` and keeps the answer at the edge for 10 s (`Cache-Control: s-maxage=10`), so a thousand players over one city make one request upstream. What it passes on, per aircraft: hex, flight, type, lat, lon, `alt_geom` (else `alt_baro`), ground speed, track, vertical rate, category, and whether it's on the ground. Only airline flights are named (`LIVING.md` rule 7: a call sign of three letters and a number); the rest go anonymous. A live plane is carried on from its report by its speed and track, up to 30 s, then dropped if no report has come.

**Scripted**, when the relay is down or not deployed (a page on localhost, the tools): flights on great circles over the place at cruise heights, a few an hour, deterministic by place and UTC minute, no airport needed. Once the world's `airports.bin` is in (`CONTRACT.md` O11), approaches and departures on each airport's real runways replace most of them. Nothing on the screen says which a plane is.

**From the street** at 15 km and under, an airliner is about 70 m and makes 6 px at about 13 km on the portrait lens (`CONTRACT.md` 1.4's arithmetic), so most planes in a San Francisco sky are specks and the ones on approach to SFO models.

## Paint on a mover

`CONTRACT.md` section 3: the aim asks `life.aim(...)` each frame; a mover nearer the line of fire than the building target takes the glint and the shot; `life.hit(key, color, utcMs, arrive)` at fire time takes effect at the impact. A fresh mover takes the blast's hue at level 1, a painted one goes up a level. The record is the key, the hue and level, `until` and the namespace that placed it, in IndexedDB (O14), 2,000 records and 256 KB at most, the soonest `until` first out; under `?t=`, `?rate=` or `?fixeddt`, a test store of its own.

## The tests

`CONTRACT.md` section 7's W6 and L1 to L7, in `tools/life/`, each printing what it measured and exiting 1 on a failure.
