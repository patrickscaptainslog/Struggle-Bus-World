# Life's fixes, re-reviewed and run on the GPU (feat/life, 4694f33 to b6383f4)

The first account, 2026-11-06, for the second account. A re-review of the fixes to [life-cars-2026-11-05.md](life-cars-2026-11-05.md) (base 92b4884), on San Francisco's data, and the GPU runs the hand-in asked for: L3's triangles by `qa.tris`, and the ferries' berths and wakes from the air. Every file:line below is at b6383f4. The new findings carry on that review's numbers: majors from M8, minors from m14, nits from n13.

**Verdict.** No blocker. M3 holds, and so do the fixed minors m5 to m7 and n7 in San Francisco. The aim no longer hands the nose's shot to a car down the road, the cars round the bus don't change with which regions are loaded, the picnics fill round the bus, and nothing passed life's budget in the five ordinary views on the GPU. But it isn't ready for main. M1 isn't held: ferries still pass through one another, most of all at the Ferry Building, the first place the report sends the producer, and one line's berth lands on the Ferry Plaza (M8). Three more majors are new: since M2's births both bridges have lost most of their cars, each carriageway empty for its far half (M9); B1's last part, the glint still jumping from a building to a vehicle, is wider than the re-review measured, though rarer (M10); and culling drops a painted mover's contrail or wake when the mover leaves the view, which the GPU frames show (M11). M4, M5 and M6 are each partly held, and Dolores with every picnic painted is 2.1 times life's 80 K triangles on the GPU. Five minors, three nits.

## How it ran

- **Three readings.** A re-review in Node on San Francisco's real files through life's own modules (`sb-checks/handins-2026-11-06/life-rereview/` on the laptop). The GPU runs on the laptop's Intel UHD 620 through headless Edge (`life-gpu/`). Then a second reading of both, with scripts of its own and no browser (`life-verify/`). Only what the second reading held is below, at its severity and with its numbers where they differ. The old code for before-and-after runs was a `git show 92b4884` export.
- **The GPU runs** went one browser at a time behind the laptop's memory gate and lock: 10 browser jobs, each started with 1,011-2,094 MB free and 3,200-3,901 MB free commit, all exiting 0, every browser and the server closed afterwards.
- The aim runs in Node use a stand-in City: the bake's obstacle grid and the real footprints, but no landmarks, trees or the phone's roof details, and no turbo widening of the lens.
- Nothing was committed on `feat/life`. Its worktree is still clean at b6383f4.

## The branch's own checks

| Run | What it printed |
|---|---|
| `node --no-warnings tools/life/determinism.mjs` | all pass, 26 rows. Ferries `bothAtRest 0, brushMinutes 1, closestM 9.2`; cars inside another 0.8 % (50 of 6,183); `heavyOffTheKerbLane 1` of 1,640 |
| `node --expose-gc --no-warnings tools/life/alloc.mjs` | all pass, the aim rows included: a 5 m miss at 90 m is taken and a 30 m one isn't, a 12 m miss at 300 m isn't, the nose ray returns null |
| `npx tsc -p tsconfig.main.json --noEmit` | exit 0, nothing printed |
| `npx vite build`, then `node tools/iosfloor.mjs` | "✓ built in 1.71s": main chunk 1,043.90 kB (329.70 kB gzip), life's worker 31.63 kB, life's boot 32.27 kB. "iOS 15.0 parses every chunk" |

Not run: smoke, paint and flag-off in the browser (the GPU runs used their own scripts), sky, `check.mjs` and `vectors.mjs` (WebKit), and L3, which still has no tool: `tools/life/budget.mjs` doesn't exist at b6383f4.

## The earlier findings

| Finding | State | What ran |
|---|---|---|
| **B1**, the aim gives the shot to a vehicle | Partly held. The rest is M10 | The nose ray no longer takes cars (`Aim.ts:335`, `Life.ts:775`): the first review's stub street now glints a building from 20 to 120 m up, where it glinted cars 400 to 1,700 m ahead. On real geometry the vehicles that still take a shot are 12 to 55 m from the aim point (median 333 to 409 m at 92b4884). The cone is in pixels (`Life.ts:790`). A car close ahead can still be hit: flying 15 m up along busy streets, a vehicle glints on 69 to 75 % of the frames where the ray ends in the street (80 streets an area). Still there, by reading: the nose ray takes ferries and sailboats up to 1.25 × 2,500 m ahead (`Life.ts:781`), because boats aren't on-line kinds |
| **M1**, ferries inside one another | Not held. See M8 | Held parts: hulls at rest inside each other 11 s a day, at most 2.8 m deep; each of the Ferry Building's two terminals sails every line at its own minute past the half hour (15 first sailings across 19 lines); round trip = vessels × headway, so no convoys (m8 held) |
| **M2**, one vehicle in seven inside another | Partly held. The rest is M9 and m14 | 16 of 3,043 drawn inside another (0.5 %), from 458 (15.1 %). Births at real starts: 94.3 % at junctions, 0.4 % at two-edge nodes. Cars within 700 m are the same with 2.1 km or 3.5 km of regions loaded, at 8 places including both ends and the middle of each bridge. One exception: at the Bay Bridge's San Francisco end and both Golden Gate ends, 1 to 5 deck cars 0.7 to 1.2 km out exist only when fewer regions are loaded, born mid-deck where the next region's road isn't loaded. So "none born at portals" holds only when the far side is loaded |
| **M3**, the ferry key breaks the contract | Held | Keys read `ferry:w661726811:0:20261105` all day and take the next day after the last crossing. Over 54 h at 15 s steps: 52 key changes, none while the ferry was under way, none back to an old key; `until` never ends before the vessel's last move and is at most 150 min after it. All 65 sailboat keys on a Saturday at 14:00 match C16. C16 is Agreed in `CONTRACT.md` 0.11 |
| **M4**, picnics fill behind the bus first | Partly held | In Golden Gate Park on Saturday at 15:00 the tiles 0 to 300 m from the bus get 429 of 429. But 357 of the 800 allowed are behind the bus where the lens can't see them, and straight ahead past 400 m only 18 of the 326 due are drawn (6 %); between 500 and 1,000 m 0 of 1,314. Tiles pop in or out whole at full size. The meadow ahead is still bare from a little way off, which is M4's own complaint |
| **M5**, life's triangles | Partly held | Culling (`Life.ts:443-448`), `PICNICS_MOST` 800, `DANCERS_MOST` 400 and `qa.tris` are in, and `qa.tris` matches the per-instance count exactly. Unpainted, life is 1.9 K to 60 K on the GPU, inside 80 K. With every picnic at Dolores painted it is 170,244, 2.1 times 80 K (the GPU numbers below). L3's tool still doesn't exist. The culling broke the marks (M11) |
| **M6**, the wake is a straight bar | Partly held | On the GPU the wake lies on the boat's own path: from 16 s on every point is on the stern's recorded path (0.00 m off), the ferry's bowing 1.94 m where its path bows 2.35 m, the sailboat's 3.29 m where its path bows 3.32 m. But it holds at most 11 steps, about 132 m behind a ferry and 44 m behind a sailboat, not the Agreed O6's "its route from where it was painted"; `LIFE.md:43` still says "40 s of it at most". The ferry wake row (`paint.mjs:296-305`) still reads ribbon 0 without checking whose it is, so nothing checks that the wake follows the path. The culling drops it (M11) |
| **M7**, no buses on Market Street | Open | Rightly waits on C14, which waits on the producer's OK for the download. On the GPU, Market's car-free blocks from the Ferry Building to 10th Street had 0 to 1 vehicles per 100 m |

**The minors and nits called fixed**

| Item | State | Evidence |
|---|---|---|
| m1, cars appear and vanish | Partly | Births are at junctions now, but within 550 m 3.3 cars appear and 3.2 vanish each second, 2.7 of them at their life's end mid-street |
| m3, sailboats heel upwind | Partly | The masthead now leans 3.15 m downwind, by the bank's sign. The loop is still an ellipse with a dead-upwind leg, and its speed 0.52 to 1.48 × the set speed (one reading) |
| m4, buses in alleys | Mostly | Buses on service ways from 8.6 % to 0.9 % (Financial District) and 8.0 % to 0.0 % (Mission); secondary to service traffic 10.9:1 and 11.9:1 against 13.3:1. Buses are still 8.0 % and 4.5 % of vehicles on residential streets against a 1 % birth share: `cars.ts:233` penalises only a drop of two classes, where its own comment and `LIFE.md` say "a third as likely onto a smaller road" |
| m5, freeway exits | Held (one reading) | Exits take a median 6 % of traffic (1 to 10 %), from 32 % |
| m6, weekday rush at weekends | Held by reading (one reading) | The weekend curve picks by the birth's local day |
| m7, out after dark | Held in San Francisco | Saturday 7 November: 12 sailboats out at 16:55, 0 at 17:05, sunset 17:03 (`sun.ts` within 2.7 min of NOAA). It breaks after midnight elsewhere (m17) |
| m8, ferries in convoy | Held | Under M1 above |
| n4, one size for every truck | Partly | Trucks are sized by their look for the aim and the level of detail. Lamps and tracks still use the kind's numbers (`kinds.ts:48`): a semi's night speck sits 6.9 m ahead of its middle, where its nose is at 11.7 m |
| n7, `kept` read nowhere | Held (one reading) | |
| n8, the kept paint's clock | Partly | `restore()` keeps a hit that already landed, but `lifeBoot.ts:55` still parses `?t=` itself instead of taking the page's clock |

**Left open, as the hand-in says.** m2: `carsOn` alone takes a median 5.0 to 5.1 ms here (90th percentile 5.6 to 6.2) against 4.97 ms at 92b4884; the re-review measured 6.83 ms under more load. That is near the contract's 6 ms for the whole worker tick, not shown over, and nobody has measured the whole tick. m11 is cheap (a `try/finally` and an `onerror`): worth doing before main. m13 got worse (m16). m9: the key maps on both threads are never pruned, about 50 K entries an hour at the Financial District (the C17 reading). m10, m12, n1 (25 cars appear in a tenth of a second at the clock change), n2, n3, n5, n6 and n9 to n12 can wait.

## New findings

### Major

**M8. Ferries still pass through one another, the Ferry Building worst of all, and one line's berth is on the Ferry Plaza.**
- *What a player sees.* At the Ferry Building a moving ferry slides through berthed ones: from 07:15:28 to 07:15:55 the Sausalito ferry goes through the Tiburon, Larkspur and Treasure Island ferries at their berths, one after another, 13 to 16 m deep. Two of the Pier 41 line's ferries lie on the Ferry Plaza, and the Angel Island ferry lies half on a plaza at its berth.
- *Evidence.* Every second of a Thursday, two separate scripts: 188 events where a moving ferry goes through one at rest, 2,392 s a day, up to 24.6 m deep, 184 of them within 400 m of the Ferry Building. 152 head-on meetings mid-route of one line's two ferries, and 100 pass-throughs of two lines' ferries under way. Berths are spaced 40 × ceil(k/2) m along one axis (`boats.ts:51`, `:187`, `:251`); the Ferry Building has 7 lines, so the Pier 41 line's berth is 120 m out. Its second ferry's corner is in the Ferry Building's footprint 855 min a day, in a 19 m part of the building; both its ferries sit at -0.6 m under 3.4 m of plaza ground, so only their upper decks stand above the pavement (from the heights, no frame). The Angel Island ferry has 2 of its 5 hull points on a plaza for all 224 of its berth minutes. Ferries also crab sideways into their berths: 4.0 % of under-way samples head more than 10° off the way they move, worst 82.7°.
- *Why the branch's row passes.* `determinism.mjs:326` steps a minute at a time from midnight and every departure falls on a whole minute; of the 2,292 overlap-seconds, 1 is on a whole minute. `:332` skips any two ferries under way that move differently. So `LIFE.md:73`'s "one passes another at its berth for a minute" is the sampling.
- *On the GPU.* At 03:00, 06:20 and every second of the minute after 06:20, 0 of 26 ferries overlapped, which agrees with the sweep: no event falls in those windows. The 06:20 straight-down frame drew the Pier 41 pair, but it is too dark to tell land from water.
- *Fix.* Berths on water, checked against OPEN_WATER and the plazas; a lane or a hold so a ferry under way never enters a berthed one's hull or a sister vessel's; the heading eased with the motion; a determinism row at 1 s steps over the whole day, with ferries under way included.

**M9. Long roads with no junction lose their cars, and both bridges lost most of their traffic.**
- *What a player sees.* Each carriageway of the Bay Bridge and the Golden Gate is empty for its far half.
- *Where.* Births happen only at a run's start (`cars.ts:246-270`) and cars live 45 to 90 s (`:37`). A start can't give more than one car every 2 s (`HEAD_MIN`, `:38`, `:269`).
- *Evidence.* Whole decks at 08:00, no thinning by distance: the Bay Bridge 1,837 cars at 92b4884 and 628 now (34 % left), the Golden Gate 1,539 and 640 (42 %). On the Bay Bridge one way has cars only from 0 to 1,500 m and the other from 1,250 to 2,750 m; on the Golden Gate the split is 0 to 1,250 m and 750 to 2,500 m. The westbound Bay Bridge has no births on any of its 7 deck ways. On the eastbound one `HEAD_MIN` binds, so even its first 1,750 m went from 459 cars to 329. On the made 4.3 km street, 5 keys in 10 minutes at rush hour, where there were 1,041. The GPU's Bay Bridge flight counted 205, then 47, then 25 cars in the snapshot.
- *Fix.* Births along a run every 45·v m or so, or a car's life measured by distance; a determinism row for cars along each bridge deck by the kilometre.

**M10. B1's last part: the glint still jumps from a building to a vehicle when the aim lands on a wall or a roof's grid cell.**
- *Where.* The aim ray ends on the bake's obstacle grid: 8 m cells, each roof grown 3 m (6 m for parts over 40 m) (`bake.py:2395`). `landsOnBuilding()` checks the footprints instead (`Aim.ts:350-354`), and the occluder puts the aim point 0.6 m outside a wall (`Aim.ts:239-242`), where no footprint is. So the building loses its claim, and a vehicle up to 60 m further along the line (`ON_LINE_PAST`, `Life.ts:26`, `:781`), or short of the aim point, takes the shot.
- *Evidence.* 17.6 to 21.7 % of the ground in 600 m squares is roof-high in the grid but in no footprint. `landsOnBuilding()` says "street" on 44 to 78 % of all frames that land on a building in the Mission and the Financial District, most wall hits included. With the real Aimer and LifeHost at the game's lens, over 80 streets an area, the share of building frames a vehicle took: Mission 6.0 % at 45 m up and 10.9 % at 150 m; Financial District 0.6 to 6.1 %; Outer Sunset 0.5 to 1.0 % on random lines. Flights with at least one steal in the Mission: 5 of 23 at 45 m, 11 of 32 at 150 m. (The re-review's 31 % and 76 % came from 24 streets an area and are too high.) At 92b4884 the same random lines gave 5.0-22.9 % (Mission), 0-9.6 % (Financial District) and 10.8-43.7 % (Sunset). Not every steal is past the aim point: in the Mission at 45 m, 25 of 34 were short of it, mostly buses and trucks. An example: the bus at (-266.2, 60.8, 1650.6) heading east 45 m up, the ray ends at (-144.0, 24.7, 1641.4) on building 65731's cell 5.7 m out from its footprint (grid 24.7 m, ground 15.3 m), and `car:1627967519:0:23658693` at (-128.6, 15.0, 1637.1) takes the glint for 4 frames running, 17.7 m past the aim point, the line missing its middle by 5.77 m against a half size of 2.96 m. The phone raises the grid further (tree crowns, roof details), so these are likely a floor.
- *On the GPU.* 74 of 74 real taps at buildings hit the building, but all four tap scripts kept a pose only when `landsOnBuilding()` was true (`b1.mjs:144`), so they can't speak to this. Their 6 skipped poses were all states where a building glinted while `landsOnBuilding()` was false: 4 at walls or edges, 2 in the street.
- *Fix.* Decide "lands on a building" from the grid: a wall, or the grid at the aim point at least `minTargetHeight` over the ground with the shown building within about 9 m. When the ray ends on a roof cell, let a ground mover stand only a few metres past the aim point. Add a row that tests this from the grid, not from the code's own predicate.

**M11. Culling drops a painted mover's contrail and wake along with it.**
- *What a player sees.* The rainbow contrail vanishes the moment its plane leaves the frame, and a wake is gone when you look back. `ferry-12s-top100.png` on the GPU is empty water: the ferry was just outside the 100 m view, so its wake wasn't drawn, though the wake was in view.
- *Where.* The `continue` at `Life.ts:447` runs before the marks are laid at `:488-492`. A wake also starts over once its boat moves more than 3 point-steps unseen (`:623`): 36 m for a ferry, 12 m for a sailboat, 6.6 m for a car's tracks (read, not flown).
- *Evidence.* A painted airliner's 8.8 km contrail: 1 ribbon with the plane in view, 0 with the lens on its trail 6 km behind. The ferry's wake and the contrail draw nothing for the 6 s the lens sees only them, and the wake then starts over and draws nothing for 1 to 1.5 s after the ferry is back in view, 20 m after 2 s, 100 m after 10 s.
- *Fix.* Lay and keep a painted mover's marks before the cull, cull the ribbon by its own bounds, and keep its points while the mover is out of view.

### Minor

**m14. Cars shrink to nothing behind the car ahead, and a near-invisible one can still take the shot.** M2's overlap is avoided by shrinking (`cars.ts:429`, down to 0.02 of a car's size). At rush hour 5.5 % of vehicles are drawn at under half size and 3.9 % at under 5 %; of full-grown vehicles within 250 m, 7.3 % under half and 5.6 % under 5 %; 11.1 to 11.9 % are below full size within 600 m, where it was 4.3 %. The branch's row leaves out those under 20 % (`determinism.mjs:230`). On the GPU, 4.8 % of vehicles on upper Market and 3.2 % in the Financial District are under a tenth of their size, mostly invisible, and `life.aim` takes the row nearest the line whatever its drawn size (`Life.ts:790-791`): of 10 taps at a car in `b1v2.mjs`, the one miss went to a car on the same line whose half size was 0.06 m. Fix: space cars by holding them back, not by shrinking; don't let a car under a few pixels take the shot. The producer should hear that cars shrink.

**m15. After 400 dancers, painted blankets go empty.** The people are cleared and none dance (`Life.ts:530-532`). Read, not run.

**m16. Tests that can't fail, or were loosened.** `paint.mjs`'s B1 row (`:247`, `:258`) uses the code's own predicate, so it can't fail (M10). The ferry row is blind to departures (M8). Loosened: `smoke.mjs:97` (cars drawn ≥ min(20, in view)), `:113` (ferries drawn > 0), `:142` (picnic models > 20); `determinism.mjs:215` (heavy vehicles off the kerb lane allowed up to heavy/500); `paint.mjs:216` now takes any car within 5 m plus its half size.

**m17. Sunset wraps past midnight.** `sun.ts:14` takes the time mod 24 h, so sunset reads 00:02 in Reykjavik on 19 June 2027, 00:47 in Fairbanks and 00:45 in Tromsø. `parks.ts:107` and `boats.ts:352` then end the day before it starts: no picnics or sailboats there all day, and polar days the same. San Francisco is fine; it breaks the any-city rule.

**m18. Cars on the bridge decks are hard to hit.** A landmark's surface counts as a building (`City.ts:2418`), so a car on the Golden Gate or the Bay Bridge is taken only when the line runs right over it. Read, not run. With M9 the decks have few cars and they're hard to hit.

### Nit

- **n13.** Dead code: `S[1]`, `S[2]`, `S[3]`, `X[1]`, `TURN` and `EASE` are written in `boats.ts:155-177` and never read; only `S[0]` is (`:236`).
- **n14.** `boats.ts:9-12`'s header still says ferries turn round at the berth and are keyed `ferry:<route>:<vessel>`.
- **n15.** Lines under 1 km would jump mid-route where the berth offset switches ends (`boats.ts:242-251`). San Francisco's shortest is 2.8 km.

## On the GPU

**Triangles, draws and frame times.** A phone-sized page (393 × 852 game pixels at 3x, a 1179 × 2556 canvas) with `?life`, the clock running from `&t=`, the bus held while the city streamed in, 10 s recorded, then 6 s with life's drawing off. `qa.tris` is `window.__game.life.qa.tris`; a per-object count matched it on every frame, and with life hidden the renderer's total fell by exactly `qa.tris` (437,577 to 417,501 at the Embarcadero, 20,076). GPU times are the browser's GPU timer round the whole render, median / 95th percentile.

| View | Life's draws (main / shadow) | `qa.tris` median / max | What life drew | Whole frame | GPU ms, life on (hidden) | Frame interval ms | Life's CPU a frame |
|---|---|---|---|---|---|---|---|
| Embarcadero, Thu 17:30, 30 m up at Mission & Steuart | 5 / 0 | 20,076 / 20,544 | 74 cars, 10 trucks, 17 picnics, 5 ferries | 72 draws, 437.6 K | 12.8 / 13.3 (12.1) | 16.7 / 17.5 | 0.3 / 0.5 / 1.2 ms + ≤ 0.1 |
| Financial District, Thu 17:30, 45 m up | 5 / 0 | 10,092 / 10,872 | 45 cars, 7 trucks, 5 ferries, 2 picnics | 55, 322.6 K | 11.5 / 12.0 (11.8) | 16.7 / 17.7 | 0.4 / 0.6 / 1.4 ms + 0.1 |
| Dolores Park, Sat 21 Nov 16:30, 35 m up | 4 / 0 | 59,844 / 60,468 | 190 picnics of 232, 38 cars, 5 trucks | 122, 1.038 M (978 K hidden) | 19.8 / 21.0 (18.7) | 20.6 / 23.5 (19.0 hidden) | 1.4 / 1.8 / 5.6 ms + 0.3 |
| The bay, Sat, 300 m up off Aquatic Park | 3-4 / 0 | 2,412 (from another frame than the list: the list's own count is 2,388) | 6 ferries, 2 sailboats, 3 cars | 87, 504 K | 15.2 / 18.4 (11.8), one 754 ms stall | 16.6 / 18.5 | 0.2 + 0 |
| Bay Bridge, Thu 17:30, 95 m up beside the west span | 3 / 0 | 1,932 / 2,244 | 11 cars, 1 truck | 31, 234 K | 11.7 / 11.8 (11.5) | 16.7 / 17.2 | 0.1 + 0 |

- **Flown end to end.** The Embarcadero, Harrison to Pier 17 (1,993 m at 30 m/s): at most 81 draws and 407 K triangles, life's at most 17,940; GPU median 11.9 ms, max 18.1; worst frame 100 ms, 14 over 20 ms, 2 over 34 ms. The Bay Bridge's west span (2,733 m at 45 m/s): at most 64 draws and 286 K, life's at most 7,440; worst frame 66 ms, 5 over 20 ms, 1 over 34 ms.
- **Dolores with all 209 picnics painted** (through `life.hit`): 400 dancers, so the cap holds, and life reaches 170,244 triangles, 2.1 times 80 K; the frame is 122 draws and 1.148 M, GPU 19.1 ms against 14.6 with life hidden. So the parks line in C17's proposed change fails today.
- **The bay at 14:00:** 48 sailboats in the snapshot, 5 sailboats and 9 ferries drawn, 3,672 triangles, GPU 12.2 against 12.1 hidden. Repeated: hidden 11.9, on 12.9, hidden 11.8; the first run's extra 3.3 ms didn't come back and wasn't explained.
- **Against the contract.** Life used 3 to 5 of C17's six draws; the sixth, the marks, drew only in the wake runs. Nothing in the shadow pass (3 allowed). Unpainted, 1.9 K to 60 K triangles. Life's own CPU stayed inside 1.5 ms a frame but at Dolores, 1.7 ms median in the first run and 0.7 + 0.1 in the second: this laptop's CPU numbers varied about 2x between runs.
- **Against the game's 120-200 draws and 1.0-1.5 M triangles:** every view inside; Dolores at the low end (122, 1.04 M; 1.15 M painted), the rest 31-87 draws and 0.23-0.50 M. 60 fps (the vsync cap) everywhere but Dolores, where this GPU needs 19-20 ms with or without life.
- **Shader compiles:** none. 38 programs at the start and 38 at the end of every view.

**The ferries' berths from the air** (Thursday 5 November, 03:00 and 06:20, frame-stepped; each ferry a 40 × 10.4 m hull at its heading, counted from the sim and from what was drawn). Across the bay, 26 ferries, 0 pairs inside each other at both moments (6 under way at 06:20), and 0 at every second of the minute after 06:20.

| Terminal | 03:00: within 400 m / drawn in the 250 m view / overlapping | 06:20 |
|---|---|---|
| Ferry Building | 8 / 5 / 0 (neighbours 12-40 m apart) | 5 / 3 / 0 |
| Oyster Point | 4 / 4 / 0 (two pairs 12 m apart) | 3 / 3 / 0 |
| Larkspur | 2 / 2 / 0 | 2 / 2 / 0 |
| Vallejo | 2 / 2 / 0 | 1 / 1 / 0 |
| Alcatraz | the line's two at Pier 33, 12 m apart, 2 / 2 / 0; none at the island's dock | the same |
| Treasure Island | none: its two lie at the Ferry Building, 12 m apart | 1 at the island |

48 frames, from the bus 200 m up and straight down from 250 m and 150 m: side-by-side pairs with a visible gap. At Oyster Point and Vallejo the ferries sit in open water with no shore or slip drawn: those terminals are outside the city's map.

**Wakes from the air** (Saturday 7 November, 14:00). A ferry coming in to the Ferry Building from 569 m, and the sailboat turning hardest of the 51 out, each painted by a real tap from behind once it glinted. Both wakes lie on the water where the boat went (M6 above), in all six paint hues, flat, 0.15 m over the water: the ferry's grows to 130 m (12 points 12 m apart), 12 m wide at the stern spreading to 36 m; the sailboat's 42 m, 3 m spreading to 9 m. The sailboat from 100 m shows a curved rainbow trail. The ferry's wake disappears when the ferry leaves the view (M11).

**B1 with real taps** (a touch down and up in 60 ms, frame-stepped, Thursday 17:30, upper Market 3.2-4.1 km out, 73 vehicles). Aimed at a building: 74 of 74 taps hit the building over four scripts, none went to a vehicle, and no vehicle glinted before a tap; but see M10 for what the poses left out, and the line of fire never passed nearer than 11.9 m to a vehicle. Aimed at a vehicle about 85 m ahead from 30 m up: 19 of 20 hit it; the miss went to a shrunken car (m14).

## Noted with C16 and C17

`CONTRACT.md` 0.11 (section 10) agrees C16 as built and C17 with a change proposed back to the second account: `qa.tris` to count the marks, and L3 to hold 80 K at the parks' Saturday peak, grey and after a MEGA, as well as downtown. Its reading also left three things for life, each read or run once: on the night the clocks go back a ferry painted at its berth keeps its paint up to an hour short of its last crossing (22 keys seen past their expiry that night); live planes take the relay's UTC date, so every painted plane goes grey at UTC midnight, 4 pm in San Francisco in winter, where the contract wants the date the plane was first seen; and culling applies only within 0.9 of the camera's far distance, and not in the flight's loop.

## Not checked

- Nothing on a phone, and so nothing about the A15 floor: the frame times are this laptop's, in headless Edge.
- GPU memory, the worker's tick time and its memory, and L3's own tool, which doesn't exist.
- Painted cars or ferries in the budget views, so the sixth draw wasn't counted against the budget.
- The aim's near-under-the-line case on the GPU, and the wake's restart after looking away (from the code).
- Berths at any time but 03:00, 06:20 and the minute after; the ferry sweep covers one Thursday.
- The aim in Node had no trees, roof details or landmarks.
- Not rerun by the second reading: the made 4.3 km street, m18, m5, m6 and n7, and m3's speed numbers.
- No outside judge looked at the frames. Some poses are imperfect: the Embarcadero and Dolores views hold the bus over a roof, the Bay Bridge view puts it in a tower's portal, the Financial District frame is mostly towers, and the 03:00 and 06:20 frames are dark.
