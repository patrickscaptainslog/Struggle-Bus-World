# Hand-placed props against the real data

Every hand-typed position and height in San Francisco's game data, checked against Overture 2026-10-21.0 (OSM tags kept), the baked city in `public/city/sf`, and the cached USGS LiDAR rasters. Positions are game metres (x, z). "Ours" is what the game draws. "Real" is what the data says.

Nothing was rendered or flown for this audit. What a player sees is worked out from the geometry, the code, and two existing screenshots.

**Since this audit.** It reads `cceefb8`, and it stands as a record of that commit. Its findings on the Bay Bridge and the Golden Gate are fixed on `fix/bridge-data`: `BRIDGES.md`, in this folder, has what shipped. The other props are its step 6.

## What matters most

- **The Golden Gate has the Bay Bridge's fault, and it is in the opening.** Its deck runs 15.2 m beside the south tower and 72.0 m beside the north tower, because the north anchorage was typed 78 m off the real line. The tower legs miss the deck, and the suspender rows drop past its edge.
- **The bus can fly through both decks.** Collision follows the cables, not the deck: 77.6 % of the Bay Bridge deck's area and 69.2 % of the Golden Gate's have no collision.
- **The Golden Gate stands 358 m south of the real one.** Its span length is right (1,280.2 m against 1,280.6 m), so a shift fixes most of it, but the opening's start pose is computed from the same points and moves with them.
- **The real Bay Bridge is still half there.** Nine boxes the LiDAR raised, up to 64.6 m tall, stand along the real road with no `HIDDEN` row, some on land and some on Yerba Buena. The bake's keep-out follows the hand-typed line, so it missed them.
- **Everything else is close.** Sutro, the Transamerica, Coit, the spire and 14 of 15 facade icons match the data within 15 m or sit inside the right footprint. One small miss has a visible effect: the Millennium Tower icon lands 3.1 m outside its tower, so it never applies.

Severity is about what a player sees:

| Severity | Meaning |
|---|---|
| blocker | Anyone who goes there sees the landmark is built wrong |
| major | Visible flying near or past it |
| minor | Visible to someone comparing with the real place, or a small error |
| none | Within 15 m of the data |

## Findings, worst first

| # | Item | Severity | Worst number |
|---|---|---|---|
| 1 | Bay Bridge: deck, towers and cables on different lines | blocker | Tower 87.9 m off our deck |
| 2 | Golden Gate: deck misses its own north tower | blocker | Tower 72.0 m off our deck |
| 3 | Collision does not cover either deck | major | 77.6 % of the deck has none |
| 4 | Golden Gate: whole prop south of the real bridge | major | 358 m |
| 5 | Bay Bridge: west end through Rincon Hill, stops in the air | major | Through 4 buildings, 20.7 m up |
| 6 | Golden Gate: north end stops in the air | major | 307.6 m short of the real deck's end |
| 7 | Stand-ins along the real Bay Bridge road, not hidden | major | 9 boxes, up to 64.6 m |
| 8 | Bay Bridge: tower spacing | minor | Side span 504 m, real 379 m |
| 9 | Bay Bridge: flat deck and tall anchorage | minor | Deck 20.4 m low at W4 |
| 10 | Bay Bridge: east end into Yerba Buena | minor | 13.0-15.9 m at the portals |
| 11 | Real piers left bare in the water | minor | 81.7-186.6 m from our towers |
| 12 | Ferry Building: clock tower and hall | minor | Tower 20.7 m off, hall 15.8 m wider |
| 13 | Millennium Tower icon misses its tower | minor | 3.1 m outside the footprint |
| 14 | Sutro Tower: legs turned | minor | 39.8 degrees, feet 19.8 m off |
| 15 | San Francisco coordinates running in other cities | minor | 366 Amsterdam buildings |
| - | Everything in "Checked and fine" below | none | Within 15 m |

### 1. Bay Bridge: deck, towers and cables on different lines (blocker)

This is what the iPhone photo shows. `makeBayBridgeWest` draws the deck as one straight box between the first and last points, and hangs towers and cables on the seven typed points. The points zigzag, so the two come apart.

| Piece (OSM ref) | Ours | Real | Apart (m) | Off our deck centre (m) |
|---|---|---|---|---|
| W1 Rincon | (2369.5, -1321.1) | (2542.6, -1272.1) | 179.9 | 0.0 (deck end) |
| W2 tower | (2871.4, -1787.5) | (2957.5, -1760.1) | 90.3 | 43.2 |
| W3 tower | (3311.7, -2287.1) | (3413.1, -2296.9) | 102.0 | 18.8 |
| W4 anchorage | (3690.2, -2620.2) | (3658.5, -2585.8) | 46.8 | 64.2 |
| W5 tower | (4060.0, -2975.6) | (3903.3, -2874.2) | 186.6 | 87.9 |
| W6 tower | (4438.4, -3430.9) | (4359.2, -3411.1) | 81.7 | 49.1 |
| W7 Yerba Buena | (4728.8, -3808.4) | (4602.4, -3697.5) | 168.1 | 0.0 (deck end) |

- Real positions are polygon centroids. The earlier 84-188 m figure used vertex means, which is why these differ by a few metres.
- Only W3 touches the deck. The centre of the nearest leg of each other tower clears the deck's edge: W2 by 17.2 m, W6 by 23.1 m, W5 by 61.9 m.
- The anchorage stands beside the deck with 26.2 m of water between them, although the cables are tied to it.
- The deck's bearing is 3.2 degrees off the real line (43.49 against 40.33).
- Our deck crosses the shore at (2735.6, -1707.1). The real road crosses at (2828.0, -1604.6), 138 m away.

### 2. Golden Gate: deck misses its own north tower (blocker)

New: this was not in the notes. The fault is one typed point. The north anchorage is 78.2 m left of the real line, so the straight deck swings west of both towers.

| Piece | Ours | Real | Apart (m) | Off our deck centre (m) |
|---|---|---|---|---|
| South anchorage | (-5086.4, -3644.3) | (-5103.8, -3832.5) | 188.9 | 0.0 (deck end) |
| South tower | (-5116.1, -3986.2) | (-5150.4, -4343.0) | 358.4 | 15.2 |
| North tower | (-5227.2, -5261.6) | (-5267.8, -5618.2) | 358.9 | 72.0 |
| North anchorage | (-5344.9, -5603.5) | (-5304.8, -6015.7) | 414.1 | 0.0 (deck end) |

- At the south tower, the opening's tower, the legs stand -0.8 and +31.2 m from the deck centre. The west leg comes up through the roadway. The east leg stands clear of the deck.
- At the north tower the centre of the nearest leg clears the deck's edge by 42.5 m.
- `gg-north-MAIN.png` and `gg-south-MAIN.png` in `shots/local/merge-osm/verify-final/bridges/` show both: the deck running past the tower in open water, and one suspender row landing mid-deck while the other falls past the edge.

### 3. Collision does not cover either deck (major)

**The bus can fly through the Bay Bridge deck.** `bridgeObstacles` lays its posts along the typed points, so it matches the cables and towers. It does not match the deck.

| Measure | Bay Bridge | Golden Gate |
|---|---|---|
| Deck area with no post over it | 77.6 % | 69.2 % |
| Square crossings of the deck that meet no post | 58.3 % (2,072 m) | 52.2 % (1,076 m) |
| Longest run with no post on any crossing | 1,584 m | 1,032 m |
| Cable posts wholly off the drawn deck | 172 of 296 | 85 of 170 |

- Example: at 2,000 m along the Bay deck, a level flight at y = 53 meets no post on the deck strip. The nearest post is 50 m from the deck centre (top 65.3 m).
- A climb from under the deck is not stopped either. `overheadAt` only reads the same posts, so the ceiling under the deck exists only where a post happens to be.
- The reverse also holds: the post line is solid at deck height where only a cable is drawn, so the bus lifts over an invisible deck beside the real one.
- The Golden Gate's north anchorage block (y -4 to 59, in the water) has no solid post. Its cable posts apply only from y = 57 up, so the bus passes through the block below that.
- Tower posts (r 30 against legs at 14-16 m) and the Bay anchorage post (r 40 against a block corner at 39.7 m) match what is drawn.
- Whether the look-ahead lifts the bus in time on a given pass was read from `Flight.ts`, not flown. The geometry above is measured.

### 4. Golden Gate: whole prop south of the real bridge (major)

- Both towers sit 358 m south of the real ones and on the real line (1.4 and 7.7 m to the right of the line through the real towers). Our bearing is 2.3 degrees off (352.48 against 354.74).
- Our south tower stands on land at Fort Point (ground 5.2 m, grass), 17.4 m from the real Pylon S1 pair. The real tower stands in the strait.
- Our north tower stands in the channel. The real one stands at the Marin shore.
- The south end runs 65.6 m past the real approach's end and lands 83.2 m from the real road, which curves east there.
- The two Golden Gate rows in `HIDDEN` and `FAR_STAND_INS` exist because the real towers' boxes stand apart from the prop (`towerStyles.ts:238`).

### 5. Bay Bridge: west end through Rincon Hill, stops in the air (major)

The deck runs 592 m over city streets on a line 138-167 m from the real one, then stops.

| Building the deck passes through | Top in the bake (m above sea level) | OSM height (m above ground) |
|---|---|---|
| 399 Fremont | 157.5 | 134 |
| 388 Beale | 72.0 | 75 |
| Hills Brothers Building | 55.0 | 56 |
| Sailors' Union of the Pacific (roof clipped) | 50.1 | 54 |

The deck's underside is at 48 m. It ends at (2328.2, -1277.6), 20.7 m above the sidewalk, 214.5 m from W1 and 41.4 m from the nearest motorway link. Nothing connects it to the freeway, and the real approach is not drawn by anything (`OSM.segments()` drops bridge ways, as already established).

### 6. Golden Gate: north end stops in the air (major)

The deck's tip is at (-5350.2, -5643.2), over shore rock at 7.1 m, so its top is 60.7 m above the ground. The hillside reaches deck level about 100 m further on. The real deck runs on for 307.6 m to the North Anchor. Our anchorage block stands in the water instead, 414.1 m from the real one.

### 7. Stand-ins along the real Bay Bridge road, not hidden (major)

The same fault `HIDDEN` and `BRIDGE_TIERS` patch elsewhere. These tops are the real deck's height: the LiDAR read the deck as rooftops. All are `TOWER` boxes, so they draw with tower facades.

| Where | Top (m) | Footprint | What it is |
|---|---|---|---|
| (2647.3, -1392.0) | 54.4 | 378 m², LiDAR only | On the real road line |
| (2667.0, -1415.7) | 53.2 | 653 m², LiDAR only | On the real road line |
| (2685.2, -1452.2) | 54.2 | Tier of 1,200 m² from 14.2 to 51.2 m | On an OSM footprint (height 20) |
| (2728.6, -1494.6) | 56.9 | 189 m², USA Structures | On the real road line |
| (2812.1, -1580.5), tier of Pier 26 | 57.9 | Tier of 1,242 m² from 17.9 to 57.9 m | Same case as Fort Point, stable id 95053790 |
| (4992.5, -4143.8) | 64.6 | 9,924 m², LiDAR only | Yerba Buena east viaduct |
| (5098.5, -4241.5) | 55.6 | 497 m², OSM | Yerba Buena, 22.5 m from a real road way's end |
| (5133.6, -4329.7) | 59.1 | 957 m², LiDAR only | Yerba Buena |
| (5293.5, -4423.5), tier of the Torpedo Assembly Building | 56.8 | Tier of 1,232 m² from 13.8 to 56.8 m | Same case as Fort Point, stable id 1237605929 |

- Why they survive: the bake's keep-out is a 20 m buffer around the typed points (`bake.py:1389-1391`). These nine sit 111.2-835.0 m from that line. Even the LiDAR-only boxes `HIDDEN` does catch sit 29.7-84.7 m from it.
- Four of these also stand in `far.bin` in tiles `FAR_STAND_INS` does not mask: (2724.5, -1494.5), (4998.8, -4158.8, 214 by 67 m), (5098.5, -4241.5), (5137.0, -4331.5).
- A wider scan near all bridge-flagged major roads found 47 buildings 12 m or more over OSM's height, or with no OSM footprint. Many are real towers whose OSM height is only the podium. I checked the ones above part by part and did not sort the rest, so treat the 47 as a lead, not a count.

### 8. Bay Bridge: tower spacing (minor)

| Span | Ours (m) | Real (m) |
|---|---|---|
| W1 to W2 | 685.1 | 640.5 |
| W2 to W3 | 665.9 | 704.1 |
| W3 to W4 | 504.3 | 379.0 |
| W4 to W5 | 512.8 | 378.3 |
| W5 to W6 | 592.0 | 704.3 |
| W6 to W7 | 476.3 | 375.8 |
| Whole | 3,428.2 | 3,182.1 |

The real bridge is two equal 704 m spans with 379 m spans either side of the anchorage. Ours has no two spans alike, so the rhythm of the silhouette is gone. The Golden Gate's spacing, for comparison:

| Span | Ours (m) | Real (m) |
|---|---|---|
| South anchorage to south tower | 343.2 | 512.7 |
| Main span | 1,280.2 | 1,280.6 |
| North tower to north anchorage | 361.6 | 399.2 |
| Whole | 1,976.2 | 2,192.5 |

### 9. Bay Bridge: flat deck and tall anchorage (minor)

Our deck top is flat at 59 m. The real deck's top rises from 42.8 m at the Rincon end to 79.4 m at W4 (LiDAR, table below), so ours is 20.4 m low at the centre and up to 16 m high at the west end. Our anchorage rises 37 m above our deck (top 96 m). The real one rises about 10 m above the real deck.

### 10. Bay Bridge: east end into Yerba Buena (minor)

This end is nearly right. The deck reaches the island 13.0-15.9 m from the two real tunnel portals. It then runs 117-127 m further into the slope and goes under the ground 21.3 m right of the real line, at about the point the real structure polygon ends. There is no portal, and our last anchorage is underground (ground 89.1 m).

### 11. Real piers left bare in the water (minor)

Already in HANDOFF, which lists W2, W5 and W6. W3 has one too: all four baked piers stand at 2.5 m, empty, with our towers 81.7-186.6 m away in open water. This goes away when the towers move onto them.

### 12. Ferry Building: clock tower and hall (minor)

- The centre is right: 3.0 m from OSM's centroid.
- The clock tower is at (2258.9, -2264.3). OSM's is at (2271.9, -2280.4), 20.7 m away. Both are on the axis of lower Market Street (2.0 m and -0.2 m off it), so the view down Market is right.
- The hall is 72 m wide against OSM's 56.2 m, and turned 4.6 degrees from OSM's long edges (139.1 against 143.7), about 8 m at each end.
- 4,417 m² of the prop stands outside OSM's footprint, against 320 m² of OSM's footprint outside the prop.
- Heights match: cupola 71.5 m against OSM's dome at 70, hall 14.6 m against 16.1.

### 13. Millennium Tower icon misses its tower (minor)

The icon point (2064.6, -1729.5) is 3.1 m outside the Millennium Tower's footprint and inside the Millennium Lofts next door. That building is 46.9 m tall against `minTop` 150, so the icon never applies. The tower falls through to the hash, which gives it vertical fins and a mechanical crown instead of the glass and lit crown the table asks for. It is a 200 m tower on the skyline. The footprint's centroid, (2044.4, -1721.7), falls inside the baked tower and would fix it.

### 14. Sutro Tower: legs turned (minor)

Position and height are exact. The legs are the difference: OSM's stand at 60, 180 and 300 degrees, ours at 20, 140 and 260, so ours are turned 39.8 degrees and the feet are 19.8 m off. This looks deliberate: the code wants the trident to read from downtown, and seen from Salesforce Tower two of our legs sit 58 and 62 degrees either side with the third straight behind. The real legs do not line up that way. The comment says leg 0 points north-west, but it points east-south-east. OSM also maps all three masts at 298 m (ours 298, 289, 283) and five platforms (ours two).

### 15. San Francisco coordinates running in other cities (minor)

`district()` in `towerStyles.ts` is not gated by `sf`, so a building in Amsterdam or London gets a San Francisco district from its coordinates alone.

| City | Want a facade family | In an SF district by coordinates | Under 40 m, so a family only because of that |
|---|---|---|---|
| Amsterdam | 389 | 377 (mostly "SoMa") | 366 |
| London | 158 | 112 | 103 |

The fog top in `materials.ts` (`sbLayerTop`, `layerTopBase`) has the same shape: its thresholds are San Francisco metres and it runs everywhere. Cities near their origin get SF's sunny east side. Amsterdam and London have no landmarks and no hand-placed props.

## Ends of both decks

Along is metres from the real south tower (Golden Gate) or W2 (Bay Bridge), along the line through the real towers.

| End | Deck stops at | Reaches land? | Under the tip | Past or short of the real end |
|---|---|---|---|---|
| Golden Gate south | (-5081.2, -3604.7), along -741.6 | Yes, on the Presidio bluff | Ground 56.3 m, 2.6 m below the deck | 65.6 m past the approach's end (-676.0), 83.2 m from the real road |
| Golden Gate north | (-5350.2, -5643.2), along 1,313.0 | Only at the tip, over shore rock | Ground 7.1 m, 51.8 m below the deck | 307.6 m short of the suspended deck's end (1,620.6), 366.8 m short of the anchorage centre, 738.7 m short of the Marin viaduct's end (2,051.7) |
| Bay west | (2328.2, -1277.6), along -775.1 | Yes, 592 m inland | Ground 27.3 m, 20.7 m below the deck | 134.6 m past W1 (-640.5) and 167.4 m to its left |
| Bay east | (4770.1, -3851.9), along 2,767.7 | Yes, under the island | Ground 102.0 m, deck buried | Passes the portals (2,522-2,531), under the ground at 2,647.7, tip 119.3 m past the structure's end (2,648.4) |

## Heights

Heights are metres above sea level unless marked. LiDAR is first return: the median over a 16 by 16 m or 40 by 40 m window for decks, the highest return within 20 m for tops.

| Thing | Ours | OSM tag | Baked | LiDAR | Verdict |
|---|---|---|---|---|---|
| Golden Gate south tower | 227, saddle to 233 | 225 | 227.1 | 231.9 | none |
| Golden Gate north tower | 227, saddle to 233 | 225 | 223.9 | 233.2 | none |
| Bay W2 tower | 160 | 160 | 144.0 | 146.3 | none (13.7 m) |
| Bay W3 tower | 160 | 160 | 156.6 | 170.9 (95th percentile 157.0, 159.5 within 8 m) | none |
| Bay W5 tower | 160 | 160 | 152.8 | 159.5 | none |
| Bay W6 tower | 160 | 160 | 142.4 | 148.0 | none |
| Bay anchorage | 96 | 67 | 89.4 | 91.3 | none on height, see item 9 |
| Sutro, above ground | 298 on 255.3 | 298, ele 254 | - | - | none |
| Transamerica, above ground | 260 | 260 | - | - | none |
| Coit, above ground | 64 on 91.7 | 64 | ground 91.6 | - | none |
| 181 Fremont roof | 231.1 | - | 231.1 | - | none |
| 181 Fremont spire tip | 248.6 | 247.6 (244.4 + ground 3.2) | - | - | none |
| Ferry clock tower, above ground | 71.5, mast 75.5 | Dome 70, mast 83.1 | 70.4 | - | none |

Real deck top, against our flat decks:

| Golden Gate (ours 67.8) | LiDAR (m) | Bay Bridge (ours 59) | LiDAR (m) |
|---|---|---|---|
| Over the South Anchorage | 62.1 | Rincon end (2470, -1204) | 42.8 |
| Pylon S1 | 66.2 | Near the shore (2702, -1469) | 53.2 |
| 34 m south of the south tower | 74.5 | W2 | 65.3 |
| 128 m north of the south tower | 77.2 | W3 | 78.4 |
| 97 m south of the north tower | 76.9 | W4 | 79.4 |
| 33 m south of the north tower | 75.7 | W5 | 78.4 |
|  |  | W6 | 65.3 |
|  |  | Past W6 (4401, -3460) | 63.0 |

The rasters do not cover the middle of any main span. The Golden Gate's deck is within 9.4 m wherever they do, so it is severity none on height.

## Checked and fine (severity none)

**Point props**

| Prop | Ours | Real | Apart (m) |
|---|---|---|---|
| Sutro Tower | (-2946.9, 2181.6) | (-2948.0, 2181.4) | 1.2 |
| Transamerica Pyramid | (1462.9, -2252.2) | (1463.3, -2249.5) | 2.7 |
| Coit Tower | (1196.0, -3046.8) | (1194.7, -3049.5) | 3.0 |
| 181 Fremont spire | (2112.9, -1650.7) | (2119.9, -1650.2), inside the footprint | 7.0 |
| Ferry Building centre | (2285.7, -2287.5) | (2286.5, -2290.4) | 3.0 |

The Transamerica prop is axis-aligned and OSM's footprint is turned 9.1 degrees, which moves the base corners by 5.9 m. That is probably also why the 8.6 m base box peeks out (DECISIONS puts it down to a wider footprint).

**Facade icons.** The test is whether the point falls in the right footprint and the baked building clears `minTop`. 14 of 15 pass.

| Icon | Ours | OSM footprint | Point to centroid (m) | OSM height | Baked height | minTop | Applies |
|---|---|---|---|---|---|---|---|
| Salesforce Tower | (1994.2, -1650.7) | Salesforce Tower | 14.7 | 326 | 329.9 | 250 | yes |
| 181 Fremont | (2131.6, -1643.0) | 181 Fremont Tower | 13.7 | 244.4 | 227.9 | 180 | yes |
| 555 California | (1382.9, -1909.2) | 555 California Street | 1.8 | 226 | 237.4 | 190 | yes |
| Millennium Tower | (2064.6, -1729.5) | Millennium Lofts (wrong) | 24.5 | 44 | 46.9 | 150 | **no** |
| One Embarcadero | (1735.1, -2184.5) | Embarcadero Center 1 | 12.0 | 173 | 174.6 | 130 | yes |
| Two Embarcadero | (1836.4, -2243.4) | Embarcadero Center 2 | 13.5 | 130 | 127.4 | 100 | yes |
| Three Embarcadero | (1950.9, -2255.6) | Embarcadero Center 3 | 15.1 | 130 | 127.8 | 100 | yes |
| Four Embarcadero | (2041.6, -2276.7) | Embarcadero Center 4 | 12.6 | 174 | 174.4 | 130 | yes |
| 345 California | (1669.1, -1964.7) | California Center | 1.5 | 212 | 189.7 | 150 | yes |
| 101 California | (1881.4, -2003.6) | 101 California | 14.2 | 183 | 188.9 | 150 | yes |
| One Rincon Hill | (2394.2, -1241.2) | One Rincon Hill | 3.0 | 195 (part) | 193.1 | 150 | yes |
| 50 Fremont | (1946.6, -1735.0) | 50 Fremont Center | 5.6 | 183 | 181.9 | 140 | yes |
| 44 Montgomery | (1553.8, -1659.5) | 44 Montgomery Street | 17.7 | 172 | 179.9 | 140 | yes |
| One Market | (2220.5, -2059.2) | One Market Plaza | 15.3 | 28 (podium) | 177.7 | 140 | yes |
| Hyatt Regency | (2078.6, -2164.6) | Hyatt Regency San Francisco | 6.5 | 83 | 83.4 | 50 | yes |

**`HIDDEN`.** The 13 rows hide 17 baked buildings. All 17 are the ones they are meant to hide, and nothing real was swallowed. Row centres are 0.1-4.6 m from their target, except rows spanning two boxes (W2 row 15.8 m, W6 row 18.2 m, W1 row 11.6 m), which sit between the boxes on purpose. The row names follow `sf.json`'s tower numbering, not OSM's: "W1" covers OSM W2, "W2" covers OSM W3, and "W3" covers a LiDAR box between W3 and W4.

**`BRIDGE_TIERS`.** Id 459630039 is Fort Point at (-5086.5, -3961.2). Its ground tier stops at 19.6 m and the four upper tiers (to 67.6 m) are the LiDAR's bridge.

**`FAR_STAND_INS`.** The 11 entries map to 11 different tiles, each holding 1-5 far boxes, all stand-ins except low real boxes that go with them: Fort Point and Pier 26's shed at 14.9 m. Past the streaming radius those are not seen.

**Everything else typed**

| Thing | Check | Result |
|---|---|---|
| Golden Gate main span | Length | 1,280.2 m against 1,280.6 m |
| Golden Gate deck width | Against OSM's bridge polygon | 27 m against 27.9 m mean, 29.1 m widest |
| Bay Bridge deck width | Against OSM's bridge polygon | 24 m against 21.8 m mean, 32.5 m widest |
| Coit, Ferry, spire `baseY` | Against the baked ground or roof | 91.7 / 91.6, 3.0 / 3.5, 231.1 / 231.1 |
| Market Street line in `district()` | Against Market St | 7-11 m off, 18.1 m at most |
| `x > 1300` and `x > 1750` in `district()` | Kearny and 2nd at Market | x 1405.5 and 1585.7. They only weight facade families, so no error shows |
| 51 neighbourhoods in `sf.json` | OSM names | 38 have an OSM twin, so their typed point is unused (worst gap 987 m, Outer Sunset). The 13 in use are region labels, not positions: Castro is 6 m from OSM's Castro District, Marina 99 m, Sea Cliff 243 m |
| 5 `districts` rectangles | OSM | No data counterpart. Still live: they pick stucco and marina houses (`bake.py:2205`) |
| `treeLatMax` | Code | Dead in an OSM bake, read only when there is no tree evidence |
| `start` lat, lon | Code | Overwritten by the opening in SF |
| Transamerica, Sutro posts | Against what is drawn | Pyramid post r 30, so its base corners stick out by up to 7.5 m. Sutro's r 45 encloses the feet at 29 m plus footings |

## What changes reach further than the prop

- **The opening moves with the Golden Gate.** `main.ts:119-124` computes the gap and the start pose from the two towers. Moving them 358 m north moves the first shot off Fort Point, so that shot needs a fresh look.
- **The stand-in rows stay needed.** The boxes `HIDDEN` hides would stand inside or through the moved props, so the rows stay until the bake stops making them.
- **The bake's keep-out is tied to the typed points.** It moves if they move, and a city with no typed bridge gets no keep-out at all.
- **Test poses follow the bridges.** `tools/osm-shots.mjs` has typed `baybridge` and `ggbridge` poses.
- **DECISIONS.md:1897 is out of date.** It says both bridges are built from real tower and anchorage coordinates.

## Limits of this audit

- No rendering, no flight. The two screenshots were taken before this audit and only confirm the Golden Gate geometry.
- Real positions are OSM's, through Overture, and carry OSM's own error, which I did not measure.
- What a player sees of the Bay Bridge rests on the geometry. I did not open the user's photo. `shots/local/bridges/bay-three-lines.png` agrees with these numbers.
- LiDAR first returns include traffic and railings, so deck heights may read a little high. LiDAR did not reach north of the Golden Gate's north tower.
- `district()` counts use my reading of `wantsFamily` and the baked heights, computed in Python. They were not run through the mesher.
- I broke one rule by mistake: an early read-only command started with `cd`. It changed nothing. No tracked file was touched.

## Where the numbers came from

All in `shots/local/bridges/`, which is not in git, each `.py` with its output in the matching `.txt`.

| File | What it holds |
|---|---|
| `audit_common.py`, `audit_baked.py`, `audit_geometry_lib.py` | Loaders, a Python reader for the baked regions and `far.bin`, the deck frame and posts as `Bridges.ts` computes them |
| `audit_geometry` | Both decks piece by piece, spacing, ends, ground, post coverage, buildings under the decks |
| `audit_bridges_baked` | Baked buildings and far boxes along both bridges, `FAR_STAND_INS` tiles |
| `audit_infra`, `audit_ways` | Infrastructure rows and motorway ways through both corridors |
| `audit_lidar` | Tower tops and deck heights from the rasters |
| `audit_props` | Sutro, Transamerica, heroes, parts, all 15 icons |
| `audit_misc` | Neighbourhoods, Market Street, Alamo hut, Fort Point, stand-in parts, Golden Gate north end, Millennium, Ferry frame, keep-out distances, leftover obstacle cells |
| `audit_final` | `HIDDEN` against the bake, level flights through the decks, Sutro legs, `district()` in other cities |
| `audit_last.txt`, `audit_viaducts.txt`, `audit_viaducts2.txt`, `audit_checks.txt` | Ground under each tower, the scan near bridge-flagged roads, stand-in parts along the land approach, spot checks of derived numbers |
