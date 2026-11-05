# Review three: P1 to P4 fixed (feat/earth, c05b501 to 688c9de)

The first account, 2026-11-04, on `feat/earth` at 688c9de: the fixes for the second review's P1 to P4 ([earth-fixes-2026-11-04.md](earth-fixes-2026-11-04.md)), read against the code and against `DECISIONS.md`'s "The second review, P1 to P4 fixed". `src/` hasn't changed since (a028744 is the contract). This is the reading half: two reviewers read the diff, a skeptic tried to refute each finding, and Node ran the real `GroundPaint.ts`. The probes are in [tools/moon/review3/](../../tools/moon/review3/README.md), which says which shows what. Browser runs on a real GPU follow once the laptop is quiet ("Still to run").

**Verdict.** P3 and P4 hold. P1 and P2 hold for what they asked: 200 breaths over one place all come back after a reload, in one pass. But the pictures that did it bring a blocker and four majors: two lose paint (M1, M3) and two stop the frame (M2, M4). Nothing goes to `main` until they're fixed and looked at again. Both reviewers found the blocker on their own.

## The four

| | What it was | Now | How I know |
|---|---|---|---|
| P1 | A cell kept 32 blasts, so a much-painted place lost its oldest | Holds as asked, but the cap moved the loss elsewhere: M1 | `keep.mjs`'s heavy row is 18 pictures, far under the cap; `review3/geo/i-roundtrip.mjs`, 200 breaths on 16 tiles read back on the same map: 41,113 texels painted both ways, 0 lost, 100 % the same hue |
| P2 | After a reload the paint came back blast by blast | Holds | `pictureInto` copies a tile's paint at attach in one pass; nothing is replayed |
| P3 | `geoAt`'s walk missed cells at a tile's east or west end | Holds away from the poles | `review3/keys-check.mjs`, each point's key against the walk, in the rows that matter: the narrow last column, negative rows, the rows where the clamp starts and those at each pole, spans of 359.999, 360 and 400 from five starts round the date line. It prints FAIL, 6 of 3,132 not walked: five are column 1440 (below); one is the exact pole, lat 90 keyed to row 18000, which is never walked, within 2.6 cm of the pole: harmless |
| P4 | The street's wind played on in space | Holds | `hushGround` eases the wind and the foghorn's duck to 0; on `?earth&resume` the graph starts silent and only the street schedules the foghorn; on the Moon's ground the ambience bus is 0 for the whole page. The fade is continuous: no click, -20 dB at 0.58 s. By ear: not checked |

## New

**B1 (blocker). Near either pole, one breath stops the page and wipes the Moon's paint.** `boxOf` (`GroundPaint.ts:1033`) opens a box to every longitude as soon as any corner is past 89 degrees, whether or not the pole is in it. Past 88.85 degrees `geoLonW` (75) floors every row's column at 0.25 degrees: 1,441 columns (78). `eachPic` walks them all (1052), and `fold` makes every picture it walks (909), each a 64 KB array and a 16,384-texel loop. MEASURED (`review3/pole-cost.mjs`, `geo/a-counts.mjs`): one breath on Shackleton's floor (-89.67, in `places.json`, with its own page and sign) walks 96,547 pictures; at 89.5, 146,982; at 89.05, 276,672 and 32 s of fold alone; at 89.99, 5,764. With storage (`review3/pole-roundtrip.mjs`): 20 blasts at 30 degrees saved, one blast at Shackleton, a reload. The blast took 119 s, and the 30-degree paint came back as 0 of 13,339 texels, the Shackleton blast as 35 of 2,809. The save evicts down to 600 by age, each eviction a scan of the whole map: oldest first, then the breath's own early pictures. On a phone, Safari will likely kill the page first. Flying near a pole with anything kept anywhere also costs each tile 1.6-26 ms in `geoNear`'s walk. In the zone: Peary (88.63 N, 79 km across) and, in `names.json`, Hinshelwood (89.41), Spudis (-89.51), Marvin (-89.13) and Whipple (89.14).
- The column floor fails on its own too: at the pole, where every longitude is needed anyway, it still makes 4,323 pictures, each 0.33 m wide. So: wider columns near the pole (or a polar grid of its own), every longitude only when the pole is inside the box, and a picture made only where a texel lands.
- Careful with the box: `boxOf` takes latitude from the four corners only, and a straight edge's latitude peaks mid-edge, by reach² / (2 x the distance to the pole). Today the 89-degree clamp keeps that under 1.4 m (`review3/reach.mjs`, the largest reach, 292 m, at 88.99), inside `prepare`'s 4 m pad. Without the clamp it's about 14 m at 89.9, and P3's miss comes back. Bound each edge's nearest approach to the pole, or pad by that sagitta.
- Done: `pole-roundtrip.mjs` keeps every texel at each place, and the pole's breath folds in about the ms it takes at 60 degrees (5 ms at 88.9 here). `walk-check.mjs` bounds the pictures a box walks and has boxes near and over each pole.

**M1 (major). The cap of 600 pictures goes in 1 to 7 minutes of painting.** `GEO_PICS = 600` (60), evicted by age at each save (1076). The comment's "about 14 km2" is the pictures' area; the paint in them is about 1.4 km2 (`geo/l-area.mjs`). And `fold` makes the pictures it walks but doesn't paint (866), with a newer time than real paint, so real paint goes first: they take a tenth to a third of the cap, more with big blasts (`empties.mjs`). MEASURED (`geo/d-cap.mjs`, a breath every 2.6 s, the gauge's own rate, flying straight on): at Express low the first breath's splash leaves the store after 156 breaths, 6.8 minutes; at Jet or Turbo 3 after 68, 2.9 minutes; from 600 m after 24, 1 minute. A full MEGA from high up spends 115 slots alone (`geo/j-mega.mjs`). The crater bowls stay (`CraterPaint` keeps them by crater, uncapped), but the splash and rays round them go, sometimes cut along a straight line where one picture went before its neighbour. That's P1's loss again, a few minutes later, and the producer's ruling is "i need to be able to paint the moon. thats the whole point of the game."
- Not making empty pictures is a plain fix, and part of B1's and M4's.
- The store: meet the ruling, the paint stays. Propose it in `DECISIONS.md` sized in hours of painting, by bytes rather than by count. IndexedDB has the room, but it's async: the pictures must be loaded before tiles attach at boot, and a save on page hide needs a plan, since a synchronous `setItem` is what `persist()` relies on. If anything would still lose paint within an evening, ask the producer first.
- Done: `d-cap.mjs` run for an hour of painting as play paints, then a reload, and all of it is there.

**M2 (major). A MEGA from high up stops the picture for a quarter of a second.** `land()` runs `fold` whole on the frame of impact (718), against the file's own header (28: "Nothing is ever redrawn synchronously at an impact"). It draws the blast again on two scratch tiles a tile, then loops every texel of every picture with a template-string key and a Map lookup per texel (924). A MEGA opens about 115 pictures, so about 67 close mid-fold through `writeGeo`: `encodeMask`, `JSON.stringify`, a synchronous `setItem`. MEASURED (`geo/j-mega.mjs`, `geo/b-cost.mjs`, Node on this laptop): a full MEGA from 600 m (r 468) 215-296 ms over two probes; a breath from 600 m 35-45 ms; at the street's drop 4-12 ms. Not timed: a firehose from high up (r 135), by those about 20 ms a blast, 12 a second for 4 s. The hit-stop counts frames, so this comes on top of it. Numeric scratch keys halve the loop (a replica: 162-180 ms down to 84-90).
- Drawn straight from the prepared blast and spread over the frames after (the live tiles already show the paint), it costs nothing at the impact. But then a tile that attaches before the fold is done gets neither path: replay the blast on it, or fold that tile's pictures first. Slide pending blasts with the map, finish pending folds in `persist()`, and take the close-writes out of the fold too.
- Done: `j-mega.mjs`'s MEGA under a few ms at the impact, and a test that streams a tile in between the impact and the fold's end still sees the paint.

**M3 (major). At the cap, a MEGA can throw.** When `fold` opens an old picture past `geoOpen`'s 48, `geoPic`'s close loop writes the oldest open dirty one (876-877). That write's eviction (1076) spares only the picture it writes, so it can evict the one being opened. Then `pic.t = now` (946) finds nothing and throws out of `land()`. It needs the store near the cap (about 596 pictures), the oldest kept picture in the MEGA's box at the walk position opened just as a dirty picture closes, and the MEGA painting it. `review3/geo/g-crash.mjs` paints 151 breaths, then tries MEGA placements: the 24th throws, `TypeError: Cannot set properties of undefined (setting 't')` at 946. `Splat.update` has already taken the blast off its list, so the ring, the impact, the hit-stop and the crater levels never happen, and the rest of the MEGA is never kept. Rare a MEGA, not rare over many sessions. With no throw it still loses paint: an old picture in the MEGA's box can be evicted mid-walk, and its saved paint is deleted while the MEGA paints over it.
- The guard goes in `evictGeo`: spare the picture being opened, better every picture open or touched by this fold. A lookup that only tolerates `undefined` stops the throw but drops what the MEGA painted into the orphaned buffer.
- Done: `g-crash.mjs` doesn't throw, and every picture the MEGA reaches keeps its old paint after a reload.

**M4 (major). A painted region coming back stops a frame for 42-83 ms.** This is the cost DECISIONS left for the laptop, and it's the CPU, not the GPU: each tile's upload is one 64 KB `texSubImage2D`. `City.swapRegion` attaches a region's 16 tiles in one frame (`City.ts` ~1435-1459), and each painted tile runs `pictureInto`'s 16,384 texels with a cos, two `%` and a new string per texel (984). MEASURED (`geo/b-cost.mjs`, Node): 2.6 ms a tile at the equator (max 5.2), 3.8 near a pole (max 8.1), so 42-83 ms a region, against the A15 floor's 33 ms a frame, every couple of seconds at Jet over painted ground. The lookup line is a quarter to a third of it; the bilinear places and the copy are the rest. M1's empty pictures make it worse: each makes its tile's `hasSaved` true, which gives the tile its own terrain mesh and a 64 KB mask for nothing.
- Look the picture up once a row, key it by number, and spread a region's tiles over frames. If they're spread, keep a tile on its coarse ground until its paint is in, so the paint never pops in.
- Done: attach within a few ms a frame in `b-cost.mjs`, then the GPU run below.

**Smaller.**
- `geoCols` (78) counts a column of no width in rows past 88.85 degrees, where 360 / 0.25 is a whole number: `fold` paints and saves column 1440, which nothing reads. `Math.ceil(360 / w)`.
- The store: 600 pictures by count, not bytes. Coded, a picture is about 1.5 K for a breath, 5.8 K under heavy painting and 43.7 K at worst (`geo/e-sizes.mjs`), so the cap can pass Safari's 5 MB a site, which the street and the crater levels share. When it's full, San Francisco's tiles are what the street evicts, and `CraterPaint`'s save fails quietly (`geo/f-quota-small.mjs`). A long tail today; M1's store should take a byte budget.
- `writeGeo` marks a picture saved (1073) before its `setItem` tries: a failed save is never tried again.
- `useGeo` folds every blast of the first build's lists at boot, one after another, and drops each list before its pictures are saved: only devices that ran that build's preview, likely the producer's phone, and one killed partway loses those.
- `saveGeo` walks the whole picture map every frame once the timer has run out (741), even with nothing to save.
- `fold`'s scratch pool keeps two 64 KB tiles for each tile of the biggest blast so far, for the rest of the session: 5.5 MB after one MEGA.
- The tests: `keep.mjs`'s heavy row proves P1 and P2 on one grid and one map; nothing paints past the cap, fills the store, breathes near a pole or times `fold` and `pictureInto`. `walk-check.mjs` counts misses, never how much a walk visits, and has no map near the south pole (nothing south of -42.5) or in either polar zone: B1 passes it, and is why it takes 35 s. `climb.mjs`'s new wind rows read a real-time `AudioParam` against fixed-step frames: they can only fail falsely, but they should wait on the audio clock.

## Checks I ran

On this laptop, reading 688c9de, nothing built.
- Node, the repo's: `walk-check.mjs` pass (8,000 boxes, 480,000 points, 0 missed, 35 s); `trip-fuzz` four seeds of 120, 0 failures; `earth-check` 12 of 12, `moon-exit-check` 10 of 10, `route-check`, `approach-check`, `view-check`, `resume-check` all pass.
- Node, the probes in `tools/moon/review3/`, against the real `GroundPaint.ts`: walks and fold times by latitude, the pole round trip with storage, the cap by gear, the coded sizes, the store at 5 M and 1.3 M, the MEGA's throw (run again from the repo: the same `TypeError`), the key check (FAIL, 6 of 3,132, as P3's row says), the empty pictures by latitude and radius. A 200-breath round trip on a map 30 km off moves 1.3-2.4 % of the painted texels by a texel at an edge, and 6-9 % change hue where two hues meet: the same one-texel shift, inside the shader's warp of 1.5 texels.

## Still to run, on a quiet laptop

The bridges build is using this laptop's GPU and memory now. These run when it's done, and their numbers go in here:
- What DECISIONS asked: a painted region streaming in at Jet on `?moon&site=TYCHO&fps`, in real time on the GPU, each frame's `attach` time and the longest frame, against unpainted ground (M4).
- A full MEGA from 600 m and a breath at the street's drop: the longest task after each (M2).
- The second review's long frames again, quiet: the late link on `?moonland` first, five minutes low at Turbo 3, and the plain page's climb.
- `climb.mjs` three times, for its wind rows' margin.

## For the second account

In this order, since one change runs through three of them:
1. `fold` makes a picture only where a texel lands, and M3's guard. That's part of B1, M1 and M4.
2. B1: the columns near the pole and the box, with `geoCols` and the box's latitude bound.
3. M2's fold, then M4's attach.
4. M1's store, sized in hours of painting.
5. The smaller ones here, then both reviews' minors.

The Moon's paint has to stay: that's the producer's ruling, and the tests should say so in minutes of play, not in breaths.
