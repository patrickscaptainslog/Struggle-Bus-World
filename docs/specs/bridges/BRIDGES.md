# Bridges in every city

How the Bay Bridge stops being wrong today, and how every city we add gets its bridges from data. It builds on `audit-props.md` and `audit-new-city.md` in this folder.

**Status.** Steps 1 and 2 are done on `fix/bridge-data`: both hand-built bridges stand on their map positions. "What shipped" has the build's numbers, and each step says where the build differs from its plan. On `feat/decks`, not merged: step 3 is done, and step 4 is done for San Francisco, re-baked (data version `osm8`); Amsterdam's and London's step 4 waits for their segment row groups, a download not yet approved. Steps 5 and 6 are not started. The rest of this file is the design as written on `cceefb8`, so its "today" and its line numbers are that commit's.

**How to read the numbers.** Every number was computed by a script in `shots/local/bridges/design/` or read from a file named beside it, unless it says INFERRED. A Python prototype of the deck builder (`spines.py`, `heights.py` there) ran on the cached Overture data and the baked cities. Nothing in the design was rendered, flown or baked; "What shipped" and the review sections after it were. Triangle counts are counts, not frame times. `shots/local/` is not in git: those scripts and frames are on the laptop that made them.

**Reviewed.** A separate pass recomputed the numbers and attacked the design, with its scripts in `shots/local/bridges/redteam/` (s1-s14). Its corrections are made in place below, and "What the review changed" lists the ones that change the plan.

## The decisions

1. **Fix the Bay Bridge first, with seven numbers.** Take its points and deck heights from data. No re-bake. Done.
2. **Fix the Golden Gate second.** It needs the same change, and the producer must look at the new opening. Done; the look is still to come.
3. **Decks come from OSM's own bridge ways**, already in the cache. They need no download.
4. **Streets need one small download**, the `between` ranges. Do this before decks, so deck ends land on road.
5. **Size decides what is drawn.** Most bridges are ground with road paint on them, with no mesh.
6. **A hero may set its style, never its position.** It names an OSM id. Ten `HIDDEN` rows and two whole tables go.
7. **No level of detail.** All of San Francisco's decks and piers are 19,858 triangles.
8. **The gate adds fifteen checks to `tools/bake/qa.py`.** Eleven read what we have today: nine of them fail on today's San Francisco, and four of those read the Bay Bridge and the Golden Gate directly. Four read the new decks. `tools/bridgecheck.mjs` measures what the real mesher drew.
9. **The picture gate is one contact sheet per city, 27 frames at most**, picked from the data, that flies along each big span. About 4.5 minutes of machine time and one look.

## What the review changed

Almost all the hard numbers survived an independent recompute. The design did not survive unchanged.

| Found | Change |
|---|---|
| `heights.py` `solve()` queried its `STRtree` with no predicate, so 153 of 958 San Francisco deck ends counted as shared with any deck whose bounding box held them | Use a true 4 m test. 68 profiles move over 10 m. The rule's numbers below are the fixed ones |
| Deleting `landmarks[].points` stops the opening (`main.ts:116`), and removing `lat`, `lon` and `height` crashes the bake (`bake.py:2590`) | They leave `sf.json` only. The bake writes them into `city.json` from the resolved hero |
| The Golden Gate's bridge ways have a 107.5 m hole at the North Anchor, and the rule dropped the deck to 53.8 and 28.4 m there | A join rule across support rows, and `deckContinuity` |
| "Free ends land at 0.8 m" conflicts with "LiDAR wins": 162 of 337 San Francisco free ends read over 3 m above the DEM, 109 with no building near. With no LiDAR, viaducts would dip to the ground at every chain break | A free end lands only on a kept way. With none it keeps its height and is reported |
| W1 and W7 match none of the anchorage rules, because they are lines with no area | A hero row may name end ids |
| No S deck was on the tour in any city, and no M deck in San Francisco, though S is 91 % of Amsterdam's decks | The tour takes both |
| Torensluis drew as one 10.5 m strip over 29 % of its 1,251 m² polygon. 34 % of Amsterdam's wet bridge area stayed water. 59 arch or humpback decks had no mesh. 40 of 157 canal crossings kept a dry bar | S decks fill their polygon, arch and humpback are never S, and M and L decks carve the canal under them |
| `streetFigure` failed correct cities: 10-25 % of 1 km sub-frames in San Francisco and Amsterdam, and thin maps such as Amsterdam's main roads alone at 72.8 % | It compares with the full map of the same frame |
| The gate passes a city with no tags: strip height and `bridge:structure` from San Francisco's rows and every XL becomes L with no towers, and no check has anything to read | Checks print NOT READ, and long spans with no tower are listed on the sheet |
| The gate reads `bridges.bin`, so a sign error in `bridgeMesher.ts` passes both gates, and the iPhone photo's bug lived in TypeScript | `tools/bridgecheck.mjs` measures what the real mesher outputs |
| `towerOffDeck` at half width + 30 m passes a tower with both legs clear of the deck | The limit is half the deck's width |
| `deckFreeEnd` mixed deck top and underside. `tallNothing` failed Coit, which is drawn | Both fixed |

Also now in the design: a LiDAR spike filter, clearance, burial and slope checks, frame edges, default piers that land on roads, rail in the road checks, ways that aren't open, deck names on the street sign, and the single-tower cable case. Not solved: the chase camera under decks, listed under "What could still be wrong".

## What the measuring changed

**The straight box was never the fault.** The seven real Bay Bridge points lie within 0.31 m of one straight line, bearing 40.34 degrees. The Golden Gate's four lie within 0.4 m of one. The typed points zigzag; the bridges do not. With the real points, the existing straight deck passes through every tower, and the existing posts cover 100 % of both decks between the anchors (today 22.4 % and 30.8 %; 97.6 and 98.3 % with today's stubs) with no change to how posts are laid. What the deck does need is a height profile.

**Decks do not have to wait for a fresh extract.** `audit-new-city.md` says they should, because the bake's flags cover whole merged segments. But the infrastructure theme holds each OSM bridge way as its own row, cut at the real bridge's ends, with its tags and way id. All 36 road runs over water in San Francisco (9,261 m) lie within 12 m of such a way, as do 92 of 93 in Amsterdam and the one in London. What needs the extract is the street map: decks alone lift Amsterdam's largest street piece from 13.4 % to 53.1 %, and only the dropped ways bring it to 92.8 %.

**San Francisco's real gap is much wider than the audit's 17.8 %.** That figure credited the hand-built decks with the four ways they stand in for. By geometry, only 782 of 9,276 m of road way over water lies under a drawn deck, so 91.6 % has none. The gate uses the geometric number. Of the 67.96 km of road on real bridges, 1.21 km lies under a drawn deck.

**Tagging looks different by deck than by row.** The brief's 5-26 % counts rows. When a deck inherits the tag from its `man_made=bridge` polygon, 7 % of San Francisco's decks are tagged, 80 % of Amsterdam's and 5 % of London's. The default rule still has to carry San Francisco and London.

## 1. Bridges from data, in any city

### What goes in

All of it is in the cached infrastructure theme, in every city.

| Inside each city's frame | San Francisco | Amsterdam | London |
|---|---|---|---|
| Bridge ways with `highway` or `railway`, km clipped to the frame | 853 (84.92 km) | 309 (8.59 km) | 25 (1.09 km) |
| Of those, road | 62.84 km | 2.63 km | 0.17 km |
| `man_made=bridge` polygons | 87 (93 with viaduct and movable rows) | 124 | 3 |
| Rows tagged `bridge:support` | 111 | 8 | 0 |
| Towers, after clustering a tower's rows | 8 | 0 | 0 |

### Building one deck

1. **Chain.** Join ways end to end where exactly two of the same use, level and name meet (`shapely.line_merge`).
2. **Merge.** Longest chain first. A chain merges into a deck when at least 70 % of its length runs beside it, within 30 degrees, with no more than 6 m between their edges. A second pass merges decks that came out side by side.
3. **Width.** Track the left and right edges along the deck. A way's own width is its `width` tag, else `lanes` x 3.6 + 1 m, else the class width from `OSM_DEFAULTS` in `osm.py`.
4. **Stack.** Ways within 6 m of the centre on different levels are one double deck: one ribbon, 12 m thick.
5. **Recentre.** The centre is the middle of the two edges, smoothed over 190 m. This matters because the longest chain can be a sidewalk that jogs around the towers. On the Golden Gate that reference line runs 14.5-14.9 m off the towers, and recentring brings it to 5.1-6.8 m. On the Bay Bridge it goes from 1.4-1.5 m to 0.2-0.3 m. An XL deck is then pulled through its tower centres.
6. **Inherit.** A deck takes `bridge:structure` from the polygon holding most of it.
7. **Join.** Two decks of one bridge join across a gap of up to 120 m when a `bridge_support` row touches both, or when they share a name and line up within 10 degrees. The Golden Gate's North Anchor, `w1560010149`, fills a 107.5 m hole in its ways this way.
8. **Filter.** `highway=construction`, `disused` and `abandoned` ways get no deck (11 in San Francisco). Tram-only S decks are skipped, because the ground draws no tram.
9. **Clip.** Decks stop at the frame edge, and an end there is open, not free. `sample_ground` returns no data outside the frame: today it reads as water at height 0, which counted 5,205 m as water and put decks 82.8 m into the hill at z 7,660.

Result, before Join and Filter: 853 ways become 479 decks in San Francisco (58.59 km, 5.17 km of it outside the frame), 309 become 163 in Amsterdam (3.81 km), and 25 become 19 in London (0.67 km).

| Check against OSM's polygon | Ways merged | Deck width | Polygon's mean width |
|---|---|---|---|
| Golden Gate | 8 (lanes and both sidewalks) | 26.3 m | 27.9 m |
| Bay Bridge west | 7 (upper and lower deck, flagged stacked) | 22.3 m | 21.8 m |

### Height profile

Where LiDAR reads the deck, LiDAR wins: the median first return in an 8 m window every 32 m, after a spike filter. A sample over 6 m from the median of its five neighbours is dropped, and nothing within 20 m of a tower is read (6.2 % of neighbouring samples exceed a 15 % grade, and the Golden Gate jumps 147 m at a tower). Everywhere else, and in every city without LiDAR, this rule sets the top of the deck:

| Rule | Value |
|---|---|
| Over water | 1.5 m + 4.5 % of the crossing's water length, 1.5-80 m. Gaps up to 120 m still count as one crossing |
| Over land | The ground, smoothed, plus 5.5 m per level. Level is the infrastructure `level` column. Its source isn't settled: no row keeps `layer`, and OSM's `level` tag disagrees with it on 10 of 25 San Francisco rows and 17 of 57 in Amsterdam |
| Coming down | Never falls faster than 3 % (road), 2 % (rail) or 6 % (foot) |
| A free end | Lands on the ground, 0.8 m above it, at up to 6 %, 3.5 % or 10 %, only where a kept road or path meets it within 12 m. With none it's an open end, usually a broken chain: it keeps its height and is reported. An end inside a building's footprint is a terminal, as with the Transbay Bus Ramp |
| A shared end | Meets the other deck's height. Shared means within 4 m, measured |
| Under it | Never lower than 1 m over a building standing under it. Not in the prototype; added because Amsterdam's rail arches read 7-9 m and the rule gave 4-9 m |

I tested the rule without LiDAR on San Francisco and compared it with LiDAR afterwards, on 1,489 samples that read a deck. With the 4 m shared-end test, median error is 3.3 m, 66 % within 5 m and 87 % within 10 m (`shots/local/bridges/redteam/s9_solvefix.txt`). The first run, with the bug, read 4.1 m, 58 % and 82 %. The per-class figures were not re-run. The 90th percentile over water fell from 47.9 to 26.3 m.

The rule puts the Bay Bridge at 73 m (LiDAR 65-80 m) and the Golden Gate at 74 m (LiDAR 75-79 m), but that is selective. The Bay Bridge's east span reads 79.1 m against LiDAR's 55.2 m, and error by span is +0.3, -3.4, +24.5 and +25.0 m. A city with no LiDAR gets a big span to within about 25 m, San Francisco is the only city tested, and whether 4.5 % was tuned on those two spans isn't known. It gives 2.6 m for a 25 m canal crossing and 5.4 m for the Serpentine Bridge's 86 m. Those two are formula values, not measured against the real bridges.

### Supports, towers, cables

- **Piers.** Rows of class `bridge_support` draw as what they are: polygons as an oriented box from the ground or water to the deck's underside, lines as a 3 m thick box, points as a column. `pier` polygons a deck crosses stay as they bake today, at 2.5 m, as the base.
- **Default piers.** Where a deck has no real support within two spacings: every 45 m over land and 90 m over water on L, every 30 m over land on M from 40 m long, with two columns on decks 14 m wide or more. A pier moves up to 15 m along the deck to clear a kept road or a building, and is skipped if it can't: 239 of 1,104 San Francisco land piers hit a road cell, 20 a building, and 4 of 8 in London a building.
- **Towers.** Rows with `bridge:support=pylon`, or `man_made=tower` with `tower:type=bridge`, cluster within 45 m into one tower. Its top is the highest `height` tag. A tower with no height tag is ignored and reported. The Golden Gate's towers come with 22 `building:part`s each, so real stepped legs are in the data.
- **Cables.** Drawn when `bridge:structure` is `suspension`, `self-anchored_suspension` or `cable-stayed`, or when a tower stands over a deck of 150 m or more. Cables run tower to tower along the deck, and down to an anchorage where the data has one (`building=anchorage`, `bridge:support=abutment`, or a support of 500 m² or more). With no anchorage, a side span ends 0.35 of the main span past the last tower. An anchorage between two towers, like the Bay Bridge's W4, splits the cable. A deck with one tower, like the east span, or a `cable-stayed` tag, draws a fan from the tower to the deck on both sides, 0.35 of the deck's length each way.

### What gets drawn, by size

The first row that matches wins. "Nothing under it" means no road or rail meets the deck away from its ends.

| Class | Test | Drawn | San Francisco | Amsterdam | London |
|---|---|---|---|---|---|
| **XL** signature | 150 m or more, and a tower standing 15 m over the deck within 45 m, or a suspension or cable-stayed tag with a tower. A tag with no tower (3 land decks in San Francisco) is L | Deck, towers, cables, suspenders, anchorages | 7 decks, 13.56 km | 0 | 0 |
| **L** long deck, elevated motorway, viaduct | 150 m or more | Deck and piers | 61, 31.18 km | 1, 0.43 km | 1, 0.18 km |
| **S** ground bridge | Low over water with nothing under it (rule height under 4 m: water length under 55 m); or a foot way under 4 m high with nothing under it; or under 20 m long with nothing under it. Tagged `arch` or `humpback` is never S | **No mesh.** Road, path or rail paint on the ground | 249, 3.72 km | 148, 2.81 km, before the arch rule | 14, 0.22 km |
| **M** overpass | Everything else | A thin deck, piers from 40 m | 162, 10.13 km | 14, 0.57 km, before the arch rule | 4, 0.27 km |

So 52 % of San Francisco's decks and 74 % of London's need no mesh. Amsterdam's 91 % falls to about 55 % once its 59 arch and humpback decks (1.01 km) become M, at INFERRED under 3,000 triangles. Those humps are the look of the city.

**How S works.** `OSM.ground_raster()` writes roads, then water over them (`osm.py:611-623`), which is why canal bridges vanish. A step after it paints each S deck back, PAVED, PATH or RAIL by use, and fills the deck's `man_made=bridge` polygon when it has one, not a strip down its centre.

**S is unproven.** The ground mesh is 8 m (16 m coarse), and 55 of Amsterdam's 148 S decks are under 8 m wide, 37 under 4 m. In a flat city the pier path (`bake.py:1616-1621`) does nothing, because water is carved later at about `bake.py:2062`. Paint itself does count as land for `SHORE_REACH` in `tiles.ts`. If thin S decks fail on the tour, the fallback is a flat strip mesh 0.8 m over the water at two triangles a segment, a few hundred triangles in Amsterdam.

**Water under a deck.** An M or L deck over a canal line with dry baked ground under it, 9 of Amsterdam's 13 M crossings, carves the line's width under the deck, so the canal doesn't keep a solid bar. `clear_water` must become relative to the water's height: it is absolute today, and all three test cities sit at sea level.

**Street names.** `street_lines` reads only ground segments, so 24 of Amsterdam's 286 named streets, such as Prinsensluis, can never be signed. Deck names go in as well.

**With no structure tag, size decides.** The tag only changes the look:

| Tag | Effect |
|---|---|
| none, `beam` | The class's default |
| `truss` | Two side beams on L and M |
| `arch`, `humpback` | A curved underside on L and M, a higher middle on M |
| `suspension`, `self-anchored_suspension`, `cable-stayed` | XL at 150 m or more |

## 2. Heroes: style yes, position never

**The rule.** A hero row names an OSM id and a style. Geometry comes from the data. A row may not hold a coordinate, and a position it cannot find fails the bake.

```json
{ "kind": "ggb", "osm": "r21407754", "style": "golden-gate", "ramp": "BRIDGE_ORANGE" }
{ "kind": "baybridge", "osm": "w1011568818", "style": "bay-west", "ends": ["w1136339258", "w1136339259"], "cableEnd": "w236373807" }
```

The bake finds the decks that overlap that element, then their towers and anchorages. Style means leg shape, bracing, ramp and truss detail. `lat`, `lon`, `height`, `points` and `note` leave `sf.json`. The bake writes the same fields into `city.json` from the resolved element, so `main.ts:116`, `main.ts:223-229` and `bake.py:2590` keep their inputs. A row may name ids for ends the generic rules can't find, because W1 and W7 are lines tagged `bridge:support=pier` with no area. An id is still not a coordinate: it's only a pointer into the data.

| | Bay Bridge west | Golden Gate |
|---|---|---|
| OSM element | `w1011568818`, suspension | `r21407754`, suspension. Approaches `w1560010161`, `w1560010166`, `r21407755`. The last is 107.5 m from `r21407754` and touches it only through the North Anchor, `w1560010149` |
| Towers | W2-W6: `w432712476`, `w432712477`, `w432712478`, `w432712479`, height 160 | Pylons `w1329971884`, `w1330832681`, legs height 225 |
| Anchorages | W1 `w1136339258`, W4 `w236374789`, W7 `w1136339259`. The cables' west end is `w236373807`, not W1: see step 1 | `w1560010167`, `w1560010149` |
| Moves by | Up to 186.6 m (W5) | 358 m north, 414.1 m at the north anchorage |
| Deck | Same line as the road to 2.33 m, stacked | Reaches Marin. Today's stops 307.6 m short |
| Deck height | Rises 46 to 79 to 55 m, was flat at 59 | 60 to 77 to 75 m, was flat at 67.8 |
| Also fixed | Through 4 Rincon Hill buildings: gone. Bare piers: towers now stand on them | Towers leave Fort Point's land for their real piers. Both legs on the deck |
| Style keeps | X bracing, grey, double deck | Art-deco legs from OSM's parts, `BRIDGE_ORANGE` |

### The opening

`src/main.ts:119-124` computes the gap and the start from the two towers, so it moves with them. The code does not change: `city.json` still holds `points`, written from the hero.

| | Today | From data, heading 95 | **From data, heading 100** |
|---|---|---|---|
| Gap | (-5123.5, -4070.9) | (-5158.2, -4427.6) | (-5158.2, -4427.6) |
| Start | (-5761.1, -4126.7) | (-5795.8, -4483.4) | (-5788.5, -4538.8) |
| First land past the gap | About 4,000 m, (-1139, -3722) | 5,150 m, (-28, -3979) | 4,150 m, (-1071, -3707) |

Keeping heading 95 would put the city off the right shoulder and land 1,150 m later. **Set `start.heading_deg` to 100.** It keeps today's first land, near the same point. A heading is a camera choice, not a position, so the rule allows it.

- The whole approach is over water, and the bus passes 85 m from the tower as before. The tower now rises from the strait, not from grass at Fort Point.
- The deck's underside rises from 59.4 m to about 67 m, so the climb lock and `openingLow` keep working.
- `tools/altitude.mjs:206` tests `r.y < 57`, the old underside, and needs the new number.
- The first shot changes, so the producer must look at it. This is the one thing in steps 1 to 2 that needs a judgement.

### Tables that can go

They exist only because props disagree with data. Once the bake stops making stand-ins, and heroes come from data:

| Table | Today | After | Which code goes |
|---|---|---|---|
| `HIDDEN` | 13 rows | 3: Ferry Building, Coit Tower, Alamo Square hut | The 10 bridge rows |
| `BRIDGE_TIERS` | 1 id | **Deleted** | `trimBridgeTiers`, its call at `regionLoader.ts:290` |
| `FAR_STAND_INS` | 11 tiles | **Deleted** | `maskedForGood`, `City.ts:492-497` |
| `clearStandInGround` | Function | **Deleted** | Its call at `regionLoader.ts:305`. Nothing stands in water any more |
| `clearStandInCells` | Function (far raster, `spike/farfield`) | **Deleted** | Its call in `City.landFar`. The raster's rebuilt tiles hold no stand-ins |
| `bridgeObstacles` | Function | **Deleted** | Posts come from the data |
| `landmarks[].points` | 2 rows | **Leaves `sf.json`**, written to `city.json` by the bake | `bake.py:1389-1391` goes. `bake.py:2590-2593` reads the resolved hero |

Steps 1 and 2 grew three of these on the way: `HIDDEN` has 24 rows, `BRIDGE_TIERS` 4 ids and `FAR_STAND_INS` 13 tiles on `fix/bridge-data`. They go the same way.

The same rule then covers the other heroes. `HERO_PROPS` and `ICONS` hold typed lat/lon today, and that is how the Millennium Tower's icon missed by 3.1 m. Key icons by OSM id through `hash32`, the stable-id hash, so a miss can't happen. Ids: Sutro `r3829019`, Transamerica `w24222973`, Coit `w28824850`, Ferry Building `w558731934`, 181 Fremont `w445566153`, Millennium Tower `w72963089`, Salesforce Tower `w431972186`. Sutro's legs move to the data too: turned 39.8 degrees they are a position error of 19.8 m. If the producer prefers the trident from downtown, that is a recorded exception in `sf.json` with its reason.

## 3. Budget and pipeline

### Where it runs

A new file, `tools/bake/bridges.py`, is called four times from `bake.py`:

| Where in `bake.py` | Call | Does |
|---|---|---|
| After the pier block, `:1621` | `plan(osm)` | Chains, decks, towers, supports, footprints. Marks the buildings it claims |
| Before `Massing(...)`, `:1760` | `read_lidar()`, `blank_lidar()` | Reads deck tops, then sets the four raster dicts to `NODATA` under deck footprints plus 6 m |
| After `ground_raster()`, `:2060` | `profile()`, `paint_ground()` | Heights, classes, S paint, DEM, no trees under low decks |
| Beside far.bin, `:2582` | `write()` | `bridges.bin` |

- `blank_lidar` is the source fix. It ends all three kinds of stand-in: LiDAR-only boxes, tiers on Fort Point and Pier 26, and roofs raised to deck height. The `keep_out` branch at `bake.py:1389-1391` goes with it.
- `OSM.buildings()` skips class `bridge_structure` (6 rows in San Francisco). `plan` claims buildings under a tower, such as `w1330832666` and `w1330586852`, and passes their parts to the tower.
- `OSM.segments()` keeps dropping real bridge ways from the ground, correctly. Step 4 makes it drop only the flagged range.

### Format

One new boot file, `public/city/<slug>/bridges.bin`, magic `SBD1`. The formats `SBR1`, `SBB3`, `SBT2` and `SBF1` do not change.

| Record | Fields |
|---|---|
| Deck | u32 id, u16 vertices, u8 class, u8 flags (stacked, use, ramp), then per vertex: f32 x, f32 z, i16 top (dm), u8 left, u8 right (0.5 m) |
| Support | f32 x, z, yaw, u8 half length, half width, i16 bottom, top, u8 kind |
| Tower | f32 x, z, yaw, i16 top, u8 leg offset, u8 style, parts for stepped legs |

| Decks only, packed by the prototype | San Francisco | Amsterdam | London |
|---|---|---|---|
| Raw | 18,500 B | 668 B | 296 B |
| Gzip | 14,434 B | 558 B | 276 B |

Supports and towers add a few KB (INFERRED). `pack.py:80` adds the name to its gzip list. A city with no file gets no bridges: the fetch fails as it does for `horizon.bin`.

### Where it meshes

In the city worker, like the buildings: a new `src/world/bridgeMesher.ts` with no three.js, the way `heightGrid` is written. `City.loadBridges()` runs beside `loadFar()`, loads once and never unloads. The first frame already waits for `farP` (`main.ts:889-901`), so it waits for both, and the Golden Gate is there for the opening. It uses `makeRampMaterial({ vertexRamp: true })` as the bridges do today, so no new shader compiles. `tools/warmcheck.mjs` must still read 0 programs.

Baking triangles instead would be larger, and would need a re-bake for every style change.

### Budget

Meshes are grouped by 4 km chunk, the same size as the far-field verdict's band 2. Each chunk is one draw in the scene and one in the sun pass, culled by three as usual.

| | Today (SF) | San Francisco | Amsterdam | London |
|---|---|---|---|---|
| Decks and piers, triangles | 3,888 with the kits | 19,858 | 370 | 212 |
| Hero kits | in that figure | About 4,900 (GG 2,016, Bay 1,872 counted from the code; east span INFERRED 1,000) | 0 | 0 |
| Worst 1 km region | | 2,572 | 256 | 182 |
| Worst 4 km chunk | | 7,038 | 282 | 182 |
| Worst 5 x 5 km | | 9,270 | 370 | 212 |
| Chunks holding a deck | | 13 | 4 | 2 |
| Draws | 2, and 2 in the sun pass | INFERRED 3-6, and 1-3 in the sun pass | Up to 4 | Up to 2 |

- About 25,000 triangles for the whole city is 1.7-2.5 % of the 1.0-1.5M budget. Doubled for the sun pass and all in view, it is at most 5 %.
- Any one 5 km view holds far less: 9,270 plus one hero's kit, about 26,000 with the sun pass, under 3 % of the budget.
- Hillside views are already over budget at 1.70-1.73M (`HANDOFF.md:162`), and this adds at most about 1.5 % to them. That stays the producer's call.
- Those worst views run 231 draws at most. Six more is 3 %. A city with a lot of viaduct just fills more chunks.

### Level of detail

**None.** A far version in the prototype (4 m simplification, no undersides, every third pier) cuts San Francisco from 19,858 to 7,772 triangles. That saves 12,000 triangles, about 1 % of the budget, for a whole extra system. Decks already cost 6 or 8 triangles per segment.

### Collision

Posts stay, so `obstacleAt` and `overheadAt` do not change. `Flight.ts` did, for the two heroes: see "What the branch's review changed". The worker generates them from the same records and hands them to `City.addObstacles`.

| Field | Rule |
|---|---|
| Spacing | 12 m along every XL, L and M deck |
| `r` | Half the deck's width + 6 m |
| `top` | Deck top + 1.5 m (XL: the cable height + 5 m, as today) |
| `under` | Deck top - thickness - 1 m, so the bus can still fly under |
| Towers, anchorages | Solid, `under: -Infinity`, r 30 as today |

San Francisco goes from 466 cable posts to 4,686. The worst 64 m cell holds 38, so the flight does at most 29 × 4 × 38 = 4,408 circle tests a frame at 30 fps, which is negligible. S decks are ground and need no post.

**Chase camera.** `CameraRig` reads no obstacle and sits about 63 m above the bus. Under a deck the bus can be hidden. Only the opening is guarded. New decks over streets widen this. It's not measured or flown yet on an L deck, so step 5 flies under one and looks. The same flight takes the Golden Gate's westbound square passes at floor level, stations 600, 800 and 900: the camera sits inside the deck at y 70 for 62 frames, the lower chord's top fills 46-77 % of the frame and the bus is hidden (`shots/local/bridges/fix/review-code/gg-pass-1.png`, `gg-pass-4.png`). MAIN does the same on its own line. Along under a deck the camera stands over it and the bus is hidden for the whole stretch (`shots/local/bridges/fix/fly/cap/under-bay2-010.png`).

### Paint

The producer, 2026-11-04: "also to note for the live build: currently the bridges (bay and golden gate) cant be painted which i think is a mistake." That overrules the old brief (`DECISIONS.md` "Paintable landmarks"): decks and towers take paint, in the landmarks' own language, and every bridge the kit builds takes it the same way. `DECISIONS.md` "The bridges take paint" has the numbers.

- **A landmark, by key.** `paintBridge(city, key, obj, name)` in `Bridges.ts` makes a bridge the kit built a landmark through `paintLandmark` (`landmarkPaint.ts`): the Golden Gate is `lm:ggb`, the Bay Bridge `lm:baybridge`, saved in the landmark store like the others and never renamed. They're registered after the Ferry Building, so the four older landmarks keep their slots, seeds and saved paint (the call order fixes each one's texel, its `stableId` and its pattern seed).
- **What a breath lands on.** Every kit part is a box, and each part says what it is (`Part`: concrete, steel, deck, road, cable). The solid boxes rasterise into 2 m cells of merged spans, bottom to top. Seen from a height `fromY`, a breath lands on the highest top whose bottom is at or under `fromY`. From over a deck it lands on the deck, and from under it on what's below. A cable or a suspender isn't a surface, so a breath never stops on air or on a 1.8 m line. `surfaceAt`, `buildingAt`, `buildingAbove`, `nearestBuilding`, `roofAtPart` and `landmarkSurfaceAt` all take `fromY`, and the Aimer, `Splatter.barf` (`from`), the firehose and the signs' sightlines pass it. Without `fromY`, everything is seen from above, as it was. A landmark that stands wholly above the bus where a shot would land (`lmOverhead`) is no target, so nothing glints from under a deck. The ring is the deck's line, as wide as whatever stands at each station (76 and 106 points).
- **The levels.** At level 1 the paint runs out along the bridge from where the breath hit (`LandmarkLook.run`, 520 m/s), and a 1.6 m swell rides its front instead of a pop. The deck, towers and cables take the hue, and the concrete takes white trim. At level 2 come vines up the towers and piers, both rails planted, and a garden hanging down the truss. Level 3 is a rainbow road (six lanes), Hundertwasser bands up the towers and along the deck, cables in six hues, golden crowns on every tower top (and on the Bay's anchorage), and bunting along every main cable on the cable's own curve. The accents are the last vertices of the bridge's two meshes, so they cost nothing until level 3. Sparkles follow the deck and climb the towers.
- **At night** a painted bridge's lights take its hues, a different hue on each light down the deck, as the run passes. That's the spans' own draw (`Lamps.ts`, `SPAN`) reading the bridge's texel and its hit, so it costs no extra draw and nothing per frame.
- **Cost.** One program for every bridge at every level, in the warm-up. Grey, it writes exactly what the vertex-ramp material wrote, so `shots --det` with `?sky=off` is 0 pixels against `main`. No draw is added: the bridges were already two meshes each.
- **Scale.** A bridge step 5 builds from data gets this by building with `Kit` and calling `paintBridge`. Its slot comes from `City`'s 32 reserved slots. A city with more than 26 paintable bridges and landmarks needs a bigger reserve, or a slot per span.
- S bridges still paint as ground.

### Data version

`window.__sbDataV` in `index.html`: `fix/bridge-data` ships steps 1 and 2 as one, `osm1` to `osm2`. After that push, `osm3` goes in the same commit as the next change under `public/city/`, a `relandmark.py` run included: `vercel.json` keeps those files for a day plus a week stale, so a change on `osm2` stays invisible on a phone that played `osm2` (`tools/redeploy.mjs` proves it, 0 of 14 regions reach it). Then one bump for step 4 and one for step 5. `tools/redeploy.mjs` gains a check that `bridges.bin` reached the new deploy.

### The far field

- **`VERDICT.md`'s row "Bridges: Real spans from OSM ways" is this design.** The far-field plan owes nothing more on bridges.
- **Decks are not a band.** Like the props today (`audit-bands.md:60`, "Always on"), they load at boot and draw at every range, so nothing about them streams or pops.
- **`FAR_STAND_INS` goes.** `DECISIONS.md:2341` left that to the far-field study. It goes earlier, because the boxes stop being baked. far.bin's format doesn't change.
- **The spike's raster must be rebuilt after step 5.** It reads the tiles, so it inherits stand-ins until then. Deck footprints should stay out of its height raster, and they will, because decks aren't in the tiles. Steps 1 and 2 change no tile, so `far16.bin` needs no rebuild for them, but it never sees `HIDDEN`: the stand-ins the near city hides still stand in it, and only `FAR_STAND_INS`' tiles are masked.
- **Thin decks are the risk.** At 5 km one pixel is about 10 m (VERDICT), so the Golden Gate's 26 m is 2.6 px, but a 4.6 m M deck is sub-pixel well before that. If `tools/shimmer.py` shows them crawling, drop M from the mesh's far index range: one draw range and no new system.
- **Timing.** Step 5's re-bake changes far.bin's content, so it must not land during spike captures.
- **The sky.** `SKY.md:183` wants lamp pixels along every span's deck and on each tower top. `bridges.bin` holds what that needs: deck vertices with heights, and tower tops. Decks use live light through the normal material, with nothing baked.

## 4. The bake gate

Each check goes in `qa.py`, in the existing `checks` list and with `QA_DEFAULTS` keys. FAIL needs the value over its limit and the count over its floor, as now. No check reads a coordinate or a city name. Three rules for how they run:

- They read the bake, `bridges.bin` and the extract, so they must run **before** `qa.py:140`'s early return for `"worldcover": false`, which skips the whole QA.
- A city config may raise a floor, but not loosen a limit.
- The prototype scripts ran them on all three cities in under 35 s.

Bold means the check fails today.

| Check | Fails when | San Francisco | Amsterdam | London | With this design |
|---|---|---|---|---|---|
| `heroOffData` | A hero's anchor is over 15 m from its OSM element, or the id is gone | **414.1 m** Golden Gate, **186.6 m** Bay Bridge | No heroes | No heroes | 0, by construction |
| `towerOffDeck` | A tower's centre is over half the deck's width from the deck's centre, so the deck misses the space between its legs | **87.9 m** against 12, **72.0 m** against 13.5, and W3 and the Golden Gate's south tower now fail too | None | None | 0 on XL heroes |
| `deckNoCollision` | Over 2 % of a deck's area has no post | **77.6 %**, **69.2 %** | No decks | No decks | 0 %, 100 % covered on both data lines |
| `deckFreeEnd` | A deck's end with no other deck or building within 12 m has its top over 3 m above the ground. A kept way within 12 m doesn't let it off: it is why the end should land | **60.7 m**, **31.7 m** | No decks | No decks | 0.8 m by rule on a kept way. An open end is reported |
| `waterRoadNoDeck` | Over 5 % of real bridge road over water has no deck or ground bridge, and at least 50 m | **91.6 %** (8,494 m) | **100 %** (1,796 m) | **100 %** (84 m) | 0 / 3.7 % / 0 % of the audit's runs |
| `bridgeNoDeck` | Over 5 % of all real bridge road has no deck, and at least 100 m | **98.2 %** of 67.96 km | **100 %** of 2.63 km | **100 %** of 0.17 km | 0, by construction |
| `bareSupports` | A real support stands in the water with nothing on it | **7** of 8 | 0 of 0 | 0 of 0 | 0 once the east span's tower is drawn |
| `standIns` | More than 3 baked buildings of 12 m or more stand mostly on a deck with their top within 15 m of it or above | **23** (10 OSM, 3 USA Structures, 10 LiDAR) | 0 | 0 | INFERRED 2 or fewer, not re-baked |
| `tallNothing` | A tower or mast of 50 m or more in the data has nothing drawn. Hero rows count as drawn, so their ids go in at step 3 | 0 (Coit Tower is a hero) | 0 | 0 | 0 |
| `streetFigure` | The largest street piece drawn is under 90 % of the largest piece the full map gives in the same frame | 0.96 (94.4 of 98.4) | **0.14** (13.4 of 92.8) | 0.99 (97.2 of 98.4) | 1.0 |
| `atGradeLoss` | Road surface lost on land, on no bridge, is over 0.5 % of road kept | **1.55 %** | **3.31 %** | **0.64 %** | INFERRED about 0 |

**What each one means in plain words.**

- A support is a `bridge_support` row, or a `pier` row an L or XL deck stands over, of 50 m² or more with water on at least 5 of 8 sides. Those 7 are W2, W3 and W5's piers, the centre anchorage, both Golden Gate pylons and the east span's tower.
- `tallNothing` at 30 m instead of 50 m reads 3 / 2 / 0, and the extra hits are small communication masts, so 50 m it is. A mast with no height tag can't be judged, and is reported.
- `standIns` needs the 12 m floor. Without it Amsterdam's 11 small rail arches are flagged, and they are real.
- `streetFigure` is relative because a thin map, or a city a river really does split, is correct and has no business failing. Both sides of the ratio come from the same map.
- `waterRoadNoDeck` and `bridgeNoDeck` count rail as well as road, and skip ways that aren't open.
- Limits for `streetFigure` and `atGradeLoss` come from the audit's values. The rest come from the audit's own "none" line (15 m), or from what a player can see.

**Checks for the new decks.** These have nothing to read until step 5. The values are the prototype's.

| Check | Fails when | San Francisco | Amsterdam | London |
|---|---|---|---|---|
| `deckContinuity` | Two decks of one bridge (touching polygons, a shared support, or one name within 120 m) miss by over 3 m in plan or 1.5 m in height | 107.5 m at the Golden Gate's North Anchor, before the join rule | Not measured | Not measured |
| `deckClearance` | Two crossing decks stand under 4.5 m apart | 5 of 21 crossings, one at 0.0 m (Central Freeway, levels 2 and 3, at (1108, 658)) | 0 | 0 |
| `deckBuried` | Over 5 % of a meshed deck runs over 0.5 m under the ground, away from a tunnel | 0.9 km on 27 decks: 25.5 m on the Marin approach, 5.5 m on 20th Street. The deepest are the frame-edge error | 0 | 0 |
| `deckSlope` | A road deck's grade between samples is over 8 %, after the spike filter | Not measured | Not measured | Not measured |

**A check with nothing to read says so.** It prints NOT READ, never a pass, and the contact sheet's caption lists them. Spans of 1 km or more with no tower and no structure tag are listed too, and the tour always takes them. That is the thin-data case: strip height and `bridge:structure` from San Francisco's rows and all 7 XL become plain L with no towers, and no check fires, because a bridge the map doesn't describe can't be measured against it.

**`tools/bridgecheck.mjs`.** It runs the real `bridgeMesher.ts` in Node over `bridges.bin` (the mesher has no three.js) and measures the vertices it returns: every tower's legs straddle a deck, every deck vertex lies on its record, and every top faces up. It runs on every bake and on any change to the mesher. Today's bug lived in `Bridges.ts`, where `qa.py` never looks, and a check on the plan can't see a mistake in the drawing.

**The gate's blind spot.** Almost every check compares us with OSM, the same rows the decks came from, so a bridge OSM has wrong comes out wrong and passes. WorldCover from the far-field downloads can give an independent read of water and land under a deck later. Until then the sheet and the phone are the only independent looks.

**Report only, never fails.** Buildings inside a data deck's slab read 52 / 21 / 4, mostly stand-ins, real skyways between buildings and low decks. Typed decks read 4 for the Bay Bridge (the audit's four) and 1 for the Golden Gate. `heroOffData` already catches a typed deck, so this stays a line in the report.

**What would have caught today's bridges.** `heroOffData` needs only the typed points and an OSM id, so it alone stops a wrong hero at the bake. `towerOffDeck`, `deckNoCollision` and `deckFreeEnd` read the deck as the prop draws it, so until step 5 `qa.py` has to re-code that chord in Python. After step 5 the mesher draws it, and `tools/bridgecheck.mjs` reads the result.

## 5. The picture gate

The earlier checks looked only at fixed poses. The bridge frames were low over the water and nothing flew along a span. So the tool picks what to photograph from each city's data, and flies along the spans.

**The list.** `tools/bake/tour.py <slug>` writes `tools/bake/.cache/qa/<name>/tour.json` from the bake and the extract, with no city in the code.

| Subject | Picked as | Frames each |
|---|---|---|
| Bridges | Every XL up to 3, then the longest others, five at most, none within 1,200 m of another | XL: 4. Along the span at a quarter and at three quarters (20 m over the deck, heading along it), beside it (350 m off, at deck height), under it. Others: 2, along and beside |
| Small bridges | The two widest S decks and the longest M deck | 1, from 40 m |
| Tallest towers | Top 3 by height above ground, buildings and towers together, 300 m apart | 1, from 300 m at half its height |
| Largest parks | Top 3 open areas, as `qa.py` already lists them | 1, from 220 m |
| Biggest stations | Top 2 `train_station` or `transportation` footprints, else `subway_station` rows | 1, from 120 m |

Today's data picks these (`shots/local/bridges/design/d11_tour.txt`, `d8_refine.txt`):

| | San Francisco | Amsterdam | London |
|---|---|---|---|
| Bridges | Bay east, Bay west, Golden Gate, Southern Embarcadero Freeway, Route 80 | Rail viaduct 435 m, a 70 m footbridge, Huidenstraat 27 m | A 180 m footbridge, a 44 m road bridge |
| Towers | Salesforce Tower, Sutro Tower, 555 California | Westertoren, Havengebouw, one unnamed | London Hilton, Basil Spence Tower, Queen's Tower |
| Parks | Presidio 608.2 ha, Golden Gate Park 406.6 ha, Lake Merced 246.1 ha | Frederik Hendrikplantsoen 1.0 ha and two smaller | Hyde Park 139.0 ha, Kensington Gardens 110.1 ha, Buckingham Palace Garden 5.6 ha |
| Stations | Salesforce Transit Center, Powell Street Station | Rokin | Paddington, Paddington Elizabeth line |

Three things the data showed. Bridges must rank XL first, or the Golden Gate falls out of a plain top three by length. Towers must rank by height above ground, or a hilltop house beats 555 California. And the Transamerica Pyramid is missing because the bake caps it for its prop, so heroes join the list at step 6.

**The photos.** `tools/tour.mjs <baseUrl> <slug>` takes them with the existing `?city=&lat=&lon=&heading=&skipintro&nohud` URL, holding the bus as `tools/sweep.mjs` does. It writes one contact sheet to `shots/local/tour/<slug>/sheet.png`, each frame captioned with its name, OSM id, lat and lon.

**The cost.** About 10 s a frame: `shots/local/merge-osm/verify-final/log.txt` shows 7 such shots at 7-13 s each, 69 s in all, on this laptop.

| | San Francisco | Amsterdam | London |
|---|---|---|---|
| Frames | 27 | 16 | 15 |
| Machine time (INFERRED from that rate) | 4.5 minutes | About 2.5 minutes | About 2.5 minutes |
| A person | One look at one sheet | Same | Same |

**How it is used.** One look, by the producer or the outside judge, once. Run it on a new city's first bake, on a re-bake that changes `bridges.bin`, and on a change to `bridgeMesher.ts`. It has no pass or fail and no second round. The phone remains the real test.

**The cameras, as built on `feat/decks`.** The game's chase camera sits 63 m over the bus and looks down 19 degrees, so a subject at the bus's height falls into the frame's top quarter, a tall tower's top leaves the frame from half its height, and under a deck the camera rides over it. So an XL's "beside" and "under" frames use the opening's low camera (`CameraRig.openingLow`: 17 m over the bus, looking level): beside faces the tower nearest the middle from 350 m, the water or ground to its top in the frame, and under takes the middle of the longest stretch between the towers and supports under the deck, the camera under it. The other "beside" frames and the towers keep the chase camera, from the height that puts the subject's middle mid-frame. Each frame holds the bus where the list puts it: the step 3 tool held it wherever it had flown to since the load, about 45 m on along its heading. `tour-run.json` records where each camera stood and where the list's marks fell in the frame.

## 6. The steps

| # | Step | Agent-days | Player sees | Download | Re-bake |
|---|---|---|---|---|---|
| 1 | **Done.** Bay Bridge from data | 0.5 | Towers and cables stand on the deck, on the real piers. The deck climbs to 79 m and can't be flown through | No | No |
| 2 | **Done, the producer's look to come.** Golden Gate from data, new opening | 1, plus one producer look | The bridge moves 358 m north into the strait and reaches Marin. The first shot changes | No | No |
| 3 | Gate in report mode, tour tool, hero ids added to `sf.json` | 1.5 | Nothing | No | No |
| 4 | Streets back: `between` | 1.5 | West Carriage Drive, the Singel and the James Lick Freeway's at-grade stretches return. Streets stop ending for no reason | **Yes**, segment theme | Yes, 3 cities |
| 5 | Decks for every city, stand-ins gone, `tools/bridgecheck.mjs` | 4 | Amsterdam's canals are crossed. SF's freeways are whole. The Bay Bridge east span appears | No | Yes, 3 cities |
| 6 | Heroes by OSM id, tables deleted, gate set to FAIL | 1 | The Millennium Tower gets its glass crown. Otherwise nothing should move | No | No |
| | **Total** | **9.5** | | | |

**Why streets come before decks.** They are not a technical dependency, since decks work from the cache. But a deck's free end must land on a road. If it lands in one of the gaps, the first look at decks would show the old bug at every ramp.

### Step 1: the Bay Bridge, in detail

**Done on `fix/bridge-data`.** The plan below stands as written. The build differs from it here:

- **One deck list, not `tops`.** The row holds `deck` (lat, lon and top per vertex) and `supports`. `makeBayBridgeWest(pts, deck, supports)` and `bridgeObstacles('baybridge', pts, deck, supports)` both read it through one `Deck`, so the mesh, the local heights and the collision can't disagree. `tools/bake/landmarkrows.py` is the one reading of those rows, the bake's and `relandmark.py`'s.
- **The deck doesn't start at W1.** That end stood 35.9 m over the ground (ground 9.9, top 45.8). The list starts 140 m past W1 on the two carriageways' middle, in the hill 14 m past the end of the two kept on-ramps (segments 50920, 50933), and falls 6 % from the cable end. It has 12 vertices and is 3,381.8 m long. W1 is its fourth vertex, top 37.5, 8.3 m under the LiDAR on purpose. Its block stays on its row.
- **Three plain blocks** under the land stretch, not in the plan and with no OSM row: 22 x 4.6 m at stations 228, 274 and 318, clear of the drawn roads. The last 100 m to the cable end stays open, over a real building and Spear Street.
- **Tops the LiDAR read differently from the table:** the cable end is 54.5 (56.9 was the stand-in's top), W7 54.6 from a one-sided fit, and the stub's end 53.5, 0.6 m over the ground.
- **Stand-ins went further than the plan.** Box 3 turned and shrank to 12 m, because the table's box would have hidden a small real building. Three rows on Yerba Buena's east viaduct went here, not at step 5. Each `BRIDGE_TIERS` id also needs a clearing row, or the grid keeps the LiDAR's deck, and the Torpedo Assembly Building joined the two ids planned. `Hidden` gained `trees`, for the Yerba Buena trees that stood through the east stub. `FAR_STAND_INS` gained tiles (19, -17) and (20, -17).
- **Bracing:** at W3 and W5 two levels would have met at 156 m, so the levels are shares of what the deck leaves.
- **Cables cast no shadow.** Each hero is two meshes, one more draw when in view.
- **Small real losses:** the viaduct's second box is a real OSM kiosk (`w1034263381`, 498 m²) whose only height was the LiDAR's, and Pier 26's real 3 m roof step goes with its false tier.

**It does not need a re-bake.** It needs eight points, eight heights and five stand-ins dealt with.

| Point | OSM id | Lat, lon | Game (x, z) | Deck top (m) |
|---|---|---|---|---|
| W1 | `w1136339258` | 37.786357, -122.390535 | (2542.6, -1272.1) | 45.8 |
| Cable end | `w236373807` | Read at build | (2724.3, -1488.8) | 56.9, the stand-in's baked top there |
| W2 | `w432712476` | 37.790753, -122.385823 | (2957.5, -1760.1) | 64.8 |
| W3 | `w432712477` | 37.795588, -122.380648 | (3413.1, -2296.9) | 78.3 |
| W4 | `w236374789` | 37.79819, -122.37786 | (3658.5, -2585.8) | 79.4 |
| W5 | `w432712478` | 37.800787, -122.37508 | (3903.3, -2874.2) | 78.5 |
| W6 | `w432712479` | 37.805622, -122.3699 | (4359.2, -3411.1) | 65.4 |
| W7 | `w1136339259` | 37.808202, -122.367136 | (4602.4, -3697.5) | 55 (INFERRED between 63.9 and 53.6 either side) |

Deck tops are the median LiDAR return in six windows either side of each point, so the tower isn't read.

**The cable end.** `w236373807` is an unlabelled `bridge_support` row 357 m from W2, and W6-W7 is 376 m, so it sits where the west side span should end. `ref=W1` is 640.5 m from W2. So the cables land on `w236373807`, a block stands there, and the deck runs on to W1. The bridge's published side span is 1,160 ft, about 354 m, from memory: check that before building on it.

1. `tools/bake/cities/sf.json`: replace `points` under `baybridge`, add `tops`.
2. `tools/bake/bake.py:2592-2593`: copy `tops` into the record, so the next bake keeps them.
3. New `tools/bake/relandmark.py <slug>`: rewrites only the `landmarks` and `start` blocks of `public/city/<slug>/city.json` from the config. ARCHITECTURE line 537 says never to hand-merge that folder; this is generated, by the same logic as `bake.py:2587-2594`, in its own commit.
4. `src/world/Bridges.ts`, `makeBayBridgeWest(pts, tops)`:
   - The deck becomes seven `Kit.beam` spans between the points, sloped to `tops`, plus the 60 m stub into Yerba Buena. At W7 the ground is 41.3 m and it reaches 53 m at the stub's end, so it lands at the portal.
   - No stub past W1. A block from the ground (10 m) to the deck stands at W1.
   - The bracing levels and the cable ends and sag read the local top, not `deckY`.
5. `bridgeObstacles('baybridge', pts, tops)`: `deckY` becomes the local top, `under` the top less 11 m. Posts then cover 100 % of the deck (measured with these points).
6. `src/main.ts:227-229`: pass `lm.tops` to both.
7. `src/world/towerStyles.ts`: the deck now runs through five baked boxes the old line missed.

   ```ts
   { name: 'Bay Bridge road box 1', cx: 2646, cz: -1392, ax: 1, az: 0, halfL: 22, halfW: 22, maxTop: 60, clears: true },
   { name: 'Bay Bridge road box 2', cx: 2668, cz: -1419, ax: 1, az: 0, halfL: 24, halfW: 24, maxTop: 60, clears: true },
   { name: 'Bay Bridge road box 3', cx: 2726, cz: -1495, ax: 1, az: 0, halfL: 14, halfW: 14, maxTop: 60, clears: true },
   ```

   These three catch only `3406300252`, `3458810168` and `2743602643`; I checked what else stands in each box. Add `1129736284` and `95053790` to `BRIDGE_TIERS`: both are real buildings wearing the deck as upper tiers.
8. `index.html:22`: `osm1` to `osm2`.

Left for step 5: the four boxes on Yerba Buena's east viaduct, which the west span doesn't touch, and three far boxes in tile (10, -6). That tile also holds real boxes, so it can't be masked. Their tops match the deck's height, so past the streaming radius they read as piers.

Check it with `npx tsc -p tsconfig.main.json --noEmit`, `node tools/warmcheck.mjs`, `baybridge,baybridgealt` from `tools/osm-shots.mjs` on both builds, a flight along the whole span at deck height, a straight run at the deck to prove it stops the bus, and the same view on the phone as the iPhone photo.

### Step 2: the Golden Gate

**Done on `fix/bridge-data`; the producer's look at the new first shot is still to come.** The plan below stands as written. The build differs from it here:

- **The deck list:** 16 vertices, 2,736.7 m, on the two carriageways' middle, not the 10-vertex table below. Its worst bend is 8.9 degrees. Tops moved where the LiDAR read them on the ways: the south end 57.3 (was 62), both towers 75.5 (were 75 and 76).
- **Five Marin bents have no OSM row.** The data has nothing for the 325 m past the North Anchor, so "positions come from data" and "no stretch may float" could not both hold. The deck doesn't float: the bents stand about 50 m apart on its line, stations 2467 to 2672, clear of the two paths. `sf.json`'s note says so. Step 5's default piers replace them, and dropping them is one edit.
- **Pylons N1 and N2 have no block of their own.** Their rows sit at the two ends of the North Anchor's row, so its block carries them. That leaves 7 support blocks and 2 anchorage blocks.
- **Cables** come in from 16 m to 14 m off the line, and the side spans gain suspenders, so they land on the deck, not beside it.
- **The opening needed code the plan didn't list.** Only one data tile lies on the new line, and it ends just past the deck, so the floor sank the bus to 5.3 m and it climbed at 30 m/s right under the deck. `config.camera.openingGlide` holds the floor at 24.5 m until the gate, through the turbo gears' floor. The dip to 5.4 m on MAIN was never authored: the floor reads 18 m of "unknown rooftops" where the data has no tile. Bus and camera pass 43.2 and 26.2 m under the deck (MAIN 53.5 and 36.5).
- **`tools/altitude.mjs`'s mark** is 66 m, the new underside's height.
- **Flight changed**, which the plan said it wouldn't: see "What the branch's review changed".

The same change, with these points: south anchorage (-5103.8, -3832.5), towers (-5150.4, -4343.0) and (-5267.8, -5618.2), north anchorage (-5304.8, -6015.7). The deck is now a polyline, because the south approach curves:

| Deck vertex (x, z) | Top (m) | From |
|---|---|---|
| (-5041.5, -3675.4) | 62 | LiDAR 62.1 |
| (-5082.1, -3741.5) | 60 | LiDAR 59.6 |
| (-5103.8, -3832.5) | 62 | LiDAR 61.9 |
| (-5119.4, -4003.0) | 66.5 | LiDAR 66.5 |
| (-5150.4, -4343.0) | 75 | LiDAR 74.9, 34 m south |
| Mid-span (-5209.1, -4980.6) | 77 | INFERRED, between 77.2 and 76.9 |
| (-5267.8, -5618.2) | 76 | LiDAR 76.3, 33 m south |
| (-5304.8, -6015.7) | 75 | INFERRED, no LiDAR here |
| (-5327.2, -6245.6) | 75 | INFERRED |
| (-5398.3, -6376.0) | 74.5 | Ground 73.9 |

Set `start.heading_deg` to 100, patch `start` with `relandmark.py`, and update `tools/altitude.mjs:206`. `bridgeObstacles` must lay posts along the whole polyline: it runs 550.6 m past the anchorages, 20.1 % of 2,743 m, where it lays none today. The `HIDDEN` rows stay until step 5. `BRIDGE_TIERS` stays too: the real deck passes over Fort Point, so its upper tiers are still false.

### Step 3: the gate, in report mode

Add the fifteen checks behind a `QA_DEFAULTS` switch that reports them without failing, so the bakes in steps 4 and 5 still finish and the five existing checks still fail a bake as they do now. Add `osm` ids to the hero rows beside the typed points, so `heroOffData` can read the gap. The values above then print on every bake. Add `tools/bake/tour.py` and `tools/tour.mjs`.

**Done on `feat/decks`, no re-bake.** The build differs from the plan here:

- **The switch** is `"bridgeGate": "report"`; step 6 sets `"fail"`. Each value has its own unit (m, a share, a count, a ratio), a check with nothing to read prints NOT READ with why, and a city config's `"qa"` may tighten a limit or floor but never loosen one (`TIGHTER` in `qa.py`; a looser value is ignored, logged and listed in the report), and sets one only to a finite number: a `NaN`, which `json.load` reads and every comparison with is false, was taken as no looser and left its check unable ever to be over. The same goes for the values that say how strictly today's five checks measure (the reach that supports a tree, the share that flags a cell, the cover that makes one wooded, trees per ha), and the cells and WorldCover's grid can't be set at all (`FIXED`). The checks run before the WorldCover early return, and when what they all read fails (the extract, `bridges.py`'s plan) each is NOT READ and says why, and the QA goes on. Once step 6 sets the gate to fail, a check that failed to read fails the bake, where it passed as NOT READ, so a city whose `bridges.py` throws passed all fifteen; one with nothing to read yet (no hero, no `bridges.bin`) doesn't. `city.json`, read on every boot, keeps only each check's value and whether it was read and is over; the rest is the report's. `tools/bake/qacheck.py` checks these rules.
- **The hero rows** hold `pointIds`, one OSM id per typed point in the order of `points` (11 ids). The rows' `deck` and `points` are untouched and `landmarkrows.py` doesn't copy the ids, so `city.json` doesn't change.
- **Until step 5 the decks drawn are the two kits**, read from `city.json` with `Bridges.ts`'s sizes (`bridges.HERO_KIT`), and the map's decks are `tools/bake/bridges.py`'s plan, its tops by the rule with no LiDAR. The four deck checks read `bridges.bin` and print NOT READ until it exists.
- **`bridges.py` is the planning core only**: no LiDAR, no clearance over buildings, no supports, no mesh. Against the prototype it has the true 4 m shared-end test, a free end landing only where a kept way meets it (else open, kept at its height and counted), arch and humpback never S, a suspension tag with no tower L, the join across a support row (the Golden Gate's North Anchor, 107.8 m) and by one name, and the clip at the frame edge. Three things the prototype didn't need: the join by name only across a hole shorter than either deck with no street of the deck's own use at grade along it (two short bridges of one street are two), the reference line's sideways jogs smoothed over 40 m before recentring (without it the sidewalk round the Golden Gate's legs left the centre line 5-7 m off at each tower, and pulling it through them folded it back on itself, turns of up to 163 degrees; with it the towers sit 3 m off before the pull and the worst turn after it is 13 degrees), and a tower further than half the deck's width from it doesn't pull it (the east span's single pylon stands 26 m off the 31 m deck it was planned with). The two heroes' decks are marked with their way ids (`hero`), for step 5 to skip.
- **Classes on the bake cache's extracts**: San Francisco 4 XL, 58 L, 166 M, 249 S (the plan's 7 / 61 / 162 / 249). The XL are the two heroes and the east span, cut in two pieces by the frame edge (988 and 544 m, its one tower); of the three suspension-tagged decks with no tower, two are L (624 and 272 m on Yerba Buena) and the Marin approach joined the Golden Gate. Amsterdam 0 / 1 / 72 / 87, and 2 tram-only S decks skipped. London 0 / 1 / 6 / 12. On this branch's refreshed San Francisco extract, with step 4's streets, 4 / 58 / 161 / 254, and the meshed decks' open ends fall from 157 to 14.
- **Today's San Francisco** (the live bake, the bake cache's extract): `heroOffData` 0.01 m, `towerOffDeck` 0.00 m against 13.5, `deckNoCollision` 0.00 %, `deckFreeEnd` 2.74 m (the Presidio end), `waterRoadNoDeck` 20.65 % (1,981 of 9,592 m, rail counted; the east span's 806 m the most), `bridgeNoDeck` 82.31 % (54,936 of 66,746 m), `bareSupports` 1 of 8 (the east span's tower), `standIns` 25 (10 LiDAR, 11 OSM, 4 USA Structures: 22 along the Bay Bridge, Yerba Buena and the Golden Gate, the towers baked as buildings and LiDAR boxes, the kind `HIDDEN` masks at runtime and step 5's `blank_lidar` ends at the source; 3 under the Southern Embarcadero Freeway), `tallNothing` 1, `streetFigure` 0.960, `atGradeLoss` 1.55 % (34.65 ha), and the four deck checks NOT READ. Amsterdam and London print the audit's street figures and at-grade losses to the decimal (0.144 and 3.32 %, 0.987 and 0.64 %).
- **`tallNothing` reads 1 on today's San Francisco: Coit Tower**, a hero in `towerStyles.ts` that `qa.py` can't see. It goes when step 6 keys the heroes by OSM id.

### Step 4: streets

- `overture.py`'s `flatten` keeps the ranges of `road_flags`, `rail_flags` and `level_rules`. Today it keeps only their values.
- `OSM.segments()` cuts each line with `shapely.ops.substring` and drops only the flagged range. Tunnel-flagged London lanes come back the same way.
- Run `overture.py <slug> --types=segment --refresh` for each city. That is 8, 3 and 11 row groups (`footers/segment.json`). The cache's file times show about a minute per city (INFERRED; network speed varies).
- Run it before release 2026-10-21.0 is deleted, about 2026-12-20, 60 days after it came out (VERDICT risk 8).
- Then re-bake all three. The last San Francisco bake took about 14 minutes by `bake-sf2.log`, a log the review could not find, so treat that as unverified. It thrashes this laptop, so run it when nothing else is timing.

**Done on `feat/decks` for San Francisco, re-baked, data version `osm8`** (feat/world has used `osm4` to `osm7`; step 5 takes `osm9`, so feat/world's next bump is `osm10`). Amsterdam and London wait for their 3 and 11 segment row groups (about 44 MB, INFERRED), a download not yet approved; until then their extracts have no ranges and `segments()` leaves such a segment out whole, as before. The build differs from the plan here:

- **No download for San Francisco.** Its 8 row groups are in the Bay archive with the ranges intact. `overture.py` is feat/world's file taken whole (so the later merge is a few lines), and `--raw=<dir>` reads a local copy of the row groups, checking each file's SHA-256 and size against the archive's `manifest.json` (exit 5 on a missing, unlisted or changed file). It wrote the branch's own copy of the bake cache's Overture extract; the shared one is untouched. `flatten` keeps `road_flag_rules`, `rail_flag_rules`, `level_rules` and `name_rules` beside the old columns, which stay as they were.
- **A range is a fraction of the length on the ellipsoid**, not of raw degrees: every San Francisco range end lies within 6 mm of a vertex on WGS84 and within 7 mm in the bake's projection, where raw degrees put them 0.33 m off at the median and up to 169 m. So `segments()` cuts the projected line with `shapely.ops.substring`, at the vertex when a cut is within 5 cm of one, and leaves out a stretch at grade under 1 m (9 of 1,441, 7.2 m in all).
- **A stretch takes its own name** from `name_rules`: a segment's main name is often its bridge's or tunnel's, and 2,071 m would have been signed "Golden Gate Bridge" on Presidio Parkway or "Baker-Barry Tunnel" on Bunker Road.
- **Only what was left out comes back.** A segment whose top level is 0 stays whole, as it was drawn before the ranges, a stretch under level 0 and all. Every one of the 47,609 pieces drawn before is drawn unchanged and in the same order. `tools/bake/segcheck.py` holds the cases.
- **The ground reads only its columns** of the extract: feat/world's connectors, access restrictions and speed limits are 19 MB of San Francisco's 36 MB segment table. `segments()` alone peaks at 162 MB over a fresh process's baseline, against 160 MB on main's extract.
- **San Francisco's numbers.** 49,007 street, path and rail pieces for the ground, 1,398 of them stretches at grade of 851 segments a bridge, tunnel or level takes off the ground in part: 164.6 km, of it 61.5 km rail (53.4 km light rail; about 19 km lies off road surface, so only that shows as rail), 59.1 km paved (35.2 km motorway: the James Lick Freeway on the ground goes from 3,984 to 11,815 m, its stretches at grade from Candlestick to about 17th Street), 37.3 km of paths, 6.5 km of sidewalks and 0.3 km of plazas. 785 segments stay out whole, 767 of them off the ground end to end. Street names 2,744 (2,727 before: 17 come back, none goes). Lamps 52,072 (50,785).
- **The QA on the re-bake**, PASS with the bridge gate in report, against today's: `atGradeLoss` falls from 1.55 % (34.65 ha) to 0.07 % (1.61 ha of 2,284.36 ha of road kept), `deckFreeEnd` from 2.74 m to 0.00 m (the Golden Gate's Presidio end meets a restored way), `waterRoadNoDeck` from 20.65 % to 19.52 % (the same 1,981 m with no deck, of 10,147 m), `standIns` from 25 to 16 (2 LiDAR, 10 OSM, 4 USA Structures, on 223 meshed decks of the plan where there were 228: the 8 LiDAR stand-ins on the Bay Bridge's line are gone) and `streetFigure` from 0.960 to 0.953; `bridgeNoDeck`, `bareSupports` and `tallNothing` read as before, and the four deck checks NOT READ.
- **What a player sees, for the producer's one look.** The surfaces of every road class come back where only part of a way is a bridge or tunnel, not just the freeways (the rest of the streets job stays held). The restored roads change more ground than their own surface: 73.2 ha of ground pixels change class (25.2 ha yard, 13.7 ha grass and 3.0 ha forest become paved), and the street-block rule (`osm.py` `ground_raster`, a block of mostly non-residential buildings is a paved lot) re-cuts the blocks along them, so 8.13 ha of paved becomes yard: a grey corridor in Bayview at 37.725, -122.397 is yard now, the class of a block with no buildings (park trees grow only on grass and forest, and street trees only 3 m off a house's front, so it gets none but at its edges). The grey strips in the bay under the Bay Bridge's W1, W2, W3, W5 and W6 (0.65 ha) are water now: they were the ground under 8 LiDAR stand-ins the bake no longer makes (its keep-out reads the step 1-2 hero lines), boxes `HIDDEN` already masked. With the sky off (`shots.mjs --det`, against main's build): in the opening's first shot 70 game pixels of 334,836 change, specks of 6 game pixels at most along the far shores, in the far field, and Presidio Parkway's restored lanes don't show in it; the gameplay camera's grey shot differs in 37.3 % of its pixels, the park trees in its foreground, each where it stood, with another kind and size ("The trees"), the city beyond them main's. `streetFigure` falls from 0.960 to 0.953: freeway stretches at grade that meet nothing until step 5's decks.
- **The trees.** The park trees' kinds and sizes were each kept tree's next draws from one stream, so the restored roads gave every park south of the frame's north edge new kinds and sizes (17,778 kinds and 59,281 sizes changed where the ground is main's, and the grey shot 32.4 % of its pixels). `bake.py` now draws each place's kind and size with it: every park tree's kind and size changes once against main, from the same mix, and from here a re-bake changes trees only where its ground changes. San Francisco was re-baked a second time for it. Against the first re-bake only the park trees' kinds and sizes differ, 24,679 kinds and 82,039 sizes of the 83,175, each now its own place's draws (a replay of the seeded draws), and with them the far raster's tree cells: against main 10,856 of its 989,184 cells change class, where the first re-bake changed 10,772. 350 fewer trees in all.
- **The bake's memory.** The re-bake peaked at 2,635 MB private, where the same bake with all the extract's columns read peaked at 3,277 MB (a sampler on its process tree every 10 s); the laptop's free memory still fell to 16 MB with the other work on it. The second peaked at 2,635 MB private again (2,030 MB working set) and took 13 minutes, free memory at 564 MB and free commit at 1,589 MB at their lowest. Main's own bake has no recorded peak; `segments()` alone costs what it does on main's extract.

### Step 5: decks

`tools/bake/bridges.py` with the 4 m shared-end test, `bridges.bin`, `src/world/bridgeMesher.ts`, `tools/bridgecheck.mjs`, `City.loadBridges()`, posts from data. The two heroes resolve here, so `Kit`, `makeGoldenGate` and `makeBayBridgeWest` retire, and `registerWarm('bridges', ...)` moves to the new mesh. Re-bake all three, run the tour once, fly under one L deck and the Golden Gate's passes listed under Chase camera, and the one judge round happens here. Fly the solid posts under a deck too, with the chase camera: a stick held through the turn-out can carry the bus into a block, and nothing stops it there (see "What the last review changed"). `tools/spanfly.mjs` should then count frames in the blocks, because its gate can't see this today. The likely fix is a sideways push out of a solid post's ring under a deck, the wall the bus doesn't have.

### Step 6: tables and FAIL

Delete what section 2 lists. Key `ICONS` and `HERO_PROPS` by OSM id. Update `DECISIONS.md` "Opening + landmarks", because the kits are gone by then, and `HANDOFF.md`'s known issues. Turn the gate to FAIL. If a check is still red, fix the cause; don't loosen the limit.

## What could still be wrong

- **Nothing past step 2 was seen.** Those look claims rest on geometry. The first real view of S bridges, M decks and the generic XL kit is the tour.
- **No phone has seen steps 1 and 2.** Every check above ran on this laptop's GPU, and no load or frame numbers were taken there.
- **The rule's heights** were tested only in San Francisco, and a big span with no LiDAR can be 25 m out. Other cities' `level` tagging may differ.
- **The chase camera under decks** is unsolved. The bus can be hidden there, and more decks over streets mean more places for it.
- **Flight under a deck is a judgement call nobody has felt yet.** The bus has no wall, so the branch steers it out from under a deck (see below). Only a thumb on the phone can say whether that swerve feels right. It can still leave the bus inside a solid block.
- **The red-team checks ran on the prototype's own code.** Where they use its spines and heights they aren't independent of it, and thinning a map at random is a crude stand-in for a thin city.
- **XL has one city's evidence.** Neither Amsterdam's nor London's frame holds a big span, and London's has no Thames. Tower Bridge's bascule towers are the first real test (INFERRED).
- **OSM's errors become ours.** I measured nothing against the world, only against OSM and LiDAR. A pinned release means a mapper's edit reaches us only when we re-extract, and then `heroOffData` catches a lost id.
- **`between` was not read.** The cache threw it away. Its column shape comes from Overture's schema as I know it, not from a file. The first step 4 run must check it.
- **The "after" numbers** for `standIns` and `atGradeLoss` are expectations. Only a bake can give them.
- **Draws in view** are a judgement from a 38 degree lens over a 14 km city, not a count.

## What shipped: steps 1 and 2

`fix/bridge-data`, data version `osm2` (MAIN is `osm1`), no re-bake: under `public/city/` only `landmarks` and `start` in `sf/city.json` changed. Every number here was read from the final build. Frames, logs and scripts are in `shots/local/bridges/fix/final/`.

| | Bay Bridge west | Golden Gate |
|---|---|---|
| Deck list | 12 vertices, 3,381.8 m | 16 vertices, 2,736.7 m |
| Towers and blocks against their OSM rows, limit 15 m | 0.01 m at worst | 0.01 m at worst |
| Tower centre to deck centre, limit 1 m | 0.00 m on all four | 0.02 and 0.01 m |
| Legs across at deck height | Centres ±13.0 and ±12.8 m, 6.5 m wide, deck edges ±12 | ±11.0 to ±21.0 m, deck edges ±13.5 |
| Posts | 283 deck, 11 solid, at most 11.99 m apart, r 18 | 230 deck, 15 solid, at most 11.95 m apart, r 19.5 |
| 1 m grid points in a post that spans the deck | 84,575 of 84,575 | 76,664 of 76,664 |
| Cable corners under the local top + 1 m | 0 of 4,032, the lowest 2.20 m over the top | 0 of 3,168, the lowest 2.11 m |
| Suspenders, cable boxes | 100, 112 | 82, 88 |
| Roofs over the underside | 0 of 5,957 samples | 0 of 4,830 |
| Obstacle cells over the underside | 268, all where the deck lands: stations 0-140, 3310-3380 | 79, all where the deck lands: stations 0-60, 2710-2730 |
| A real flight down the span from deck height | 7,230 frames, stations 170-3352, 0 in the deck's box, y 42.3-174.5 | 4,844 frames, stations 196-2328, 0 in the box, y 65.8-241.5 |
| `tools/spanfly.mjs` | Passes: 5 of 5 square runs and 10 of 10 along under it never in the box, the level run lifted 0 m | Passes: 5 of 5 and 6 of 6, lifted 0 m |
| Triangles, in two meshes | 3,528 | 3,300 |

| Draws, triangles | MAIN | Branch |
|---|---|---|
| Opening, t 0.33 to 20 | 38-42, 249-262k | 26-29, 232-242k |
| `baybridgealt` | 59, 355,916 | 60, 356,992 |
| `ggbridge` | 45, 272,526 | 46, 274,038 |
| `fortpoint` | 52, 273,380 | 53, 274,892 |
| `baybridge` (not the same camera: the bus rides MAIN's posts at y 96, here y 13) | 37, 311,968 | 42, 320,238 |

- **The opening.** Heading 100, gap (-5158.2, -4427.7). The bus stays level at 24.5 m through the gate.
- **Gates on the final build.** `tsc` clean, `warmcheck` 27 programs and 0 after the warm-up, `iosfloor` parses every chunk, `altitude` opening y 24.4-28.1 on all 142 rows under the 66 m mark, `redeploy` `osm1` to `osm2` 14 of 14 regions, feel-sim's flight, route, alt and breath byte for byte as before.
- **Away from the bridges.** Five `osm-shots` poses through `shots.mjs`'s `--det` logic, 2.4-7.5 km from either deck: Alamo Square, Golden Gate Park, Twin Peaks and the climb over the Sunset are pixel-identical to MAIN. North Beach differs in 606 game pixels of 334,836, all of them the Bay Bridge on its horizon and Yerba Buena's stand-ins going. MAIN against itself reads 0.
- **Other cities.** `?city=amsterdam` and `?city=london` load with no page error and the same 404s as MAIN, `horizon.bin` and the favicon. Neither has a post.

## What the branch's review changed on top of steps 1 and 2

The two reviewers' findings on `fix/bridge-data`, as built. Step 2's deck table above is the first draft; `tools/bake/cities/sf.json` holds the row.

- **Golden Gate approaches.** The south end ran on the West Sidewalk (segment 23700). It now runs on the two carriageways' middle (segments 23706, 23699): 97 % of the deck to the anchorage lies on OSM's approach polygon (was 71 %), 5 % of the polygon has no deck (was 23 %). Sixteen vertices, the worst bend 8.9 degrees (was 18.2 and 23.0). Tops read on the carriageways. The Marin bents moved onto the new line, all on grass.
- **Bay Bridge land stretch.** Three plain blocks, 22 x 4.6 m, stations 228, 274 and 318 since the west end moved (88, 134 and 178 then), clear of the drawn roads. Its last 100 m stays open, over a real building and Spear Street, until step 5's default piers.
- **Flight under a deck.** The floor stops 8 m under the underside, the underside is a hard stop, the hard floor reads no post, and `Flight.underDeck()` turns the bus for the clearer side when something stands up to the deck ahead (only under a deck or in a solid post since the last review). `tools/spanfly.mjs` flies along under the deck into every tower and anchorage. Over a deck the hard floor reads the roadway + 1.5 m, `hard` on the post; the cable stays the soft floor's.
- **What's left.** A bus already inside a solid post's ring, under the deck, and turned out sideways still snaps to that post's top, up to 180 m, as any low bus entering a ring does on MAIN. Only a flight started there reached it: 3,444 runs with a thumb on the stick did not. Where the ground rises to within a few metres of the underside, at a deck's landing ends, the hard floor can still carry a bus started in that slot up through the deck, 25 m at most in one frame; a bus flying in from further along is turned out first. A tree's obstacle cell by the deck's edge can do the same. Two square crossings of 11,034 cable passes clip the cable for a frame during the softer rise (station 2040, within 1 m of its height); none did before.

## What the outside judge's round changed

Step 1's table above is the first draft for the land stretch too; `tools/bake/cities/sf.json` holds the row. Scripts and frames are in `shots/local/bridges/fix/f/`.

- **Bay Bridge west end.** It stopped 36 m over the ground at W1 (ground 9.9 m, top 45.8 m). The deck list now starts 140 m past W1 on the carriageways' middle, runs down the free-end rule's 6 % from the cable end, and ends in the hill 14 m past the end of the two kept on-ramps (segments 50920, 50933). W1's top is 37.5 m, 8.3 m under the LiDAR, on purpose. `BAY.w1` is its vertex.
- **Cables cast no shadow.** Each hero bridge is two meshes, one more draw when in view. Suspenders still cast.
- **Golden Gate underside.** Rose, not plum, on the lower chord's underside only. The flat band over the camera is 27 m of deck at 48 m/s, about 0.56 s, on MAIN as well, at t 14.1 to 14.4.
- **The opening's dip on MAIN was never authored.** The floor reads 18 m of "unknown rooftops" where the data has no tile and water where it has one, and the old line crossed tiles (-21, -16) and (-20, -16). DECISIONS calls the pass "low, level". The new line stays level at 24.5 m.
- **The Golden Gate's bend at the south anchorage is the map's.** The carriageways' middle bears 339.9 degrees 40 m south of the anchorage, 348.6 at it, 355.0 from 40 m north.

## What the last review changed

Offline sweeps in `shots/local/bridges/fix/review-fix/h/`, real flights and frames in `shots/local/bridges/fix/final/proof/`.

- **The swerve fired on anything past the deck.** `underDeck()` read a sample 25-75 m ahead as a wall whether or not it stood under a deck, so a roof or a hill past the edge turned a hands-off bus up to a U-turn, and at 1.6 rad/s against the stick's 1.35 no thumb could overrule it. It stopped when dead ahead was clear, which on a deck means along it. A sample is a wall now only if it is under a deck or inside a solid post (`City.solidAt`).

| Flights | Before | After |
|---|---|---|
| Hands-off floor crossings of the land stretches, turned over 0.5 rad (of 1,300) | 35 | 5, none on the Bay |
| The same, turned over 1 rad | 25 | 1 |
| The worst turn | 3.0 rad | 1.61 rad |
| Real build, due west under the Bay's land stretch, no stick | 1.10 rad | 0.16 rad |
| Real build, toward the Marin hillside, no stick | -1.95 rad, under the deck for 6 s | -0.33 rad, climbs the hill |
| Real build, the same with full right stick | Turns left until it leaves the deck | Turns right; the push meets the stick for about 1 s at the North Anchor's block, then the turn is the stick's |
| Stick sweep, through or in the box (of 3,549) | 0 and 0, the worst jump 24.3 m | 0 and 0, the worst jump 24.2 m |
| Square crossings in the box (of 4,416) | 0, the Golden Gate's worst jump 21.7 m | 0, its worst jump 19.2 m |
| Landing ends, through and in the box (of 5,616) | 3 and 1 | 2 and 0 |
| Ring sweep, through (of 52,000) | 18 | 26, the worst jump still 38.3 m |
| Cable clips (of 11,024 passes) | 2 | 2 |

  The post test is what keeps the ring sweep close: without it the Bay's jumps over 25 m read 463, with it 105 (87 before). The Bay's worst one-frame jump on a square crossing, 97.8 m before and after, and 153.8 m at its landing end, are the baked city's own roofs near Rincon Hill, off the deck.

- **Under a deck the bus can fly through solid blocks. Not fixed.** `hardAt` reads no post under a deck, so `underDeck()` is all that stands between the bus and a block, and it only turns. In the ring sweep 14,190 of 52,000 runs spend frames inside a structure's real mesh, 1,124 of them hands-off of 6,500. Tower legs and the portal strut stay clean; the rest are anchorages, blocks and bents. With hands off it takes a start over the land, or a few metres short of a block, too close for a look-ahead of 25 m: the only hands-off runs from over water, 51, start 4 m from the S1 block. Otherwise it takes a stick held through the turn-out. Before the hard floor changed, the bus was launched through the deck instead, so this is the better failure, and the camera is usually over the deck when it happens. It goes on step 5's flight list.

## What the review of steps 3 and 4 changed

- **The re-bake ships packed**: `pack.py`, `lamps.py` on the branch's extract and `farmap.py` after it, with the data version, in the bake's own commit; `check-stable-ids` passes. San Francisco was baked twice, the second time for the trees.
- **The tour** frames what it names (section 5, "The cameras"): the step 3 poses pass 0 of 11 framing checks through the game's own camera, these 11 of 11.
- **Memory**: the ground reads only its columns of the extract (step 4).
- **`qa.py`**: what the bridge checks all read can throw without stopping the QA; a config can't loosen today's five checks through how they measure; `city.json` keeps the checks short. **`osm.py`**: a segment whose top level is 0 stays whole. **`bridges.py`**: a tower's top is set against a deck's from the sea, not from its own ground.
- **Found on the way**: the park trees' kinds and sizes were drawn in sequence (step 4, "The trees").
- **Left as they are**: `deckNoCollision` re-codes `Bridges.ts`'s posts, so it can't fail on today's code; that is the design until step 5's `tools/bridgecheck.mjs` reads the real mesher. The heroes' `y` is the DEM's after a bake and the baked terrain's after `relandmark.py`, which reads no DEM; nothing at runtime reads it for a bridge. `tour.mjs` doesn't leave its browser running when the sheet throws: Playwright closes it as node exits (measured: 0 headless Edge processes left).

## Files

All in `shots/local/bridges/design/`, each script with its output beside it.

| File | What it holds |
|---|---|
| `spines.py`, `heights.py` | The prototype: decks and heights |
| `d1_tags` | Bridge tags in the three cities |
| `d2_build` | Decks, and how many water runs the ways reach |
| `d3_heights` | The rule against LiDAR |
| `d4_classes` | Classes, triangles, chunks, posts, packed size |
| `d5_gate`, `d8_refine`, `d9_through`, `d10_last` | Gate values, tour lists, deck slabs, recentring |
| `d6_heroes`, `d7_steps` | Both heroes, the opening, stand-ins, post coverage |
| `d11_tour` | The tour list by the final rule |
