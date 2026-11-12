# WILD: the wild test places

Yosemite, Milford Sound and the Swiss Alps. Written 2026-11-12. This is the plan the studio builds from. It sits beside `LIVING.md` and follows the Bay Area's surround (far field days 3-5, `docs/specs/far-field/SURROUND.md`).

Nothing here is built. No data file has been downloaded. Every download is still the producer's to OK, group by group (`DOWNLOADS-WILD.md` is the list to say yes to).

**How to read the numbers.** Every number carries one of three marks.
- **MEASURED**: a researcher listed or HEAD-requested it, and a second checker measured it again. The URL is given. **MEASURED once** means one person measured it and nobody has repeated it yet.
- **SOURCE**: a page says so. The URL is given.
- **ESTIMATE**: ours. It says what it rests on.

Six research reports, six independent checks of them, three competing designs, three judges and two critics stand behind this plan. Where a check found a report wrong, the check wins here. Answering the critics took a few header-only requests and listings (section 11 names them). No data file was fetched. The reports, the checks and the three designs are the studio's working files and are not in this repo; every number here carries its own source.

Section 14 explains the words this plan leans on (kit, ramp, shell and so on).

---

## 0. In one minute

- **The wish.** Places like Yosemite should look real, with the trees that really grow there. The same for New Zealand and the Swiss Alps.
- **The answer.** Three test places: Yosemite, the Jungfrau region of the Swiss Alps, and Milford Sound. In each, the ground, the walls and the trees come from open data alone, by rules that take no place's name. The tree rule is first tested in stage 2. Any other place on Earth gets a rougher "plain" forest until its own trees are written (section 4.5).
- **The order.** Yosemite first, all the way: a first flight over the Valley, then its own trees, then the walls up close, the forest at its true size, the sequoia grove, and paint on El Capitan. Then the Jungfrau region. Then Milford Sound.
- **The time, said plainly.** We told the producer "two to three weeks" for three places. That was wrong. The honest count is **about 62 to 88 agent-days** (ESTIMATE, section 9), in eight stages. An agent-day is one AI worker's day of work. Several are done in one day, so the calendar is shorter than the count: **about two to three months for all three places, and about two to three weeks to Yosemite with its own trees** (ESTIMATE, section 9.1; it is set mostly by one producer flight a stage). Each stage ends on the producer's phone. The producer can stop after any stage, and section 9.1 says what is in hand at each stop.
- **What the first flights will not be.** Stage 1's cliffs have the right shape but may look soft up close. The sharp ground is asked for only after that flight, and the studio expects to need it. Stage 1's trees are San Francisco's. At top speed the bus crosses the Valley; it cannot fly along it. Every place takes paint from the first stage, but until stage 6 paint on a sheer face is a stretched patch, and painted forest is not seen from far off.
- **The downloads.** About 9.0 GB if every file is taken whole, about 6.0 GB if parts of files can be read (MEASURED sizes; the part-file figures are ESTIMATES). They come in seven groups. The first is six files, 973 MB: US ground heights, the world's ground heights for the land just north of them, tree heights, a land map, a world map of natural regions and a small world rock table.
- **One licence flag.** Roads, rivers, waterfall points and village footprints (download groups 4, 6 and 7) are OpenStreetMap-family data. Their licence is share-alike on the database (ODbL). They stay in their own file family, as every city's do, and get a licence review before they ship. Nothing else here is share-alike.
- **What it waits on, and what waits for it.** Stage 1 builds on the new handling, which is not merged yet. Stage 4 builds on the Bay Area's surround, which is not built yet. Agents and the weekly token budget are shared, so wild work slows whatever else is queued. Which work waits is the producer's call (section 12).
- **What it needs from the producer.** Now, one yes: start Yosemite and fetch the first download group. Then a flight per stage, an eye on one page of colour swatches, and an iPhone 13 in hand by stage 2, because nothing in this game has ever been measured on the floor phone.

---

## 1. The producer's words, and what was promised

The producer, 2026-11-11: "one thing i am hella worried about: i want places like yosemite national park to look realistic. i want the trees associated with that area to be the trees that are real to that region, same for new zealand or the swiss alps. how difficult would this be to implement".

What the studio answered that day:
- It is very doable.
- Where trees stand, and how tall, comes from satellite maps.
- What kind they are comes from a world map of natural regions, a needle-leaf against broad-leaf map, and the height of the ground.
- Each region gets a "tree kit". About 30 to 40 tree shapes cover the world.
- Near trees are real trees. Far forest is a textured canopy.
- Sheer walls get finer free terrain.
- Forests take paint.
- "Two to three weeks of work for three test places, on top of the terrain layer."

Asked "Add Yosemite, Milford Sound and the Swiss Alps as the plan's wild test places?", the producer said (2026-11-12): "Yes, add them".

**What holds and what does not.**
- Everything in that answer holds, except the time.
- The time was wrong. The terrain layer it stood on does not exist yet. The walls, the flight among walls and paint on walls are most of the work. Every researcher and every checker said so. Section 9 has the honest count, and call 1 in section 12 puts it to the producer.
- "Yes, add them" adds the places to the plan. It is not a yes to any download.

**The rules this plan is held to** (the rulebook is `CLAUDE.md`):
- Painting is the whole point. Every place takes paint, forests and walls too.
- Paint is the only saturated thing. There is no brown. Everything else comes from the palette's muted ramps. Art's working test for brown: hue 30-85, lightness under 0.62, chroma over 0.025.
- It has to scale to the whole world. A table keyed by world-wide data is fine. A special case keyed by a place's name is not.
- The floor is an iPhone 13 (A15) at 30 fps: 393 x 852 game pixels, 120-200 draws, 1.0-1.5 M triangles, nothing compiles in flight.
- Only data whose licence allows a commercial public product.
- The repo is public.

---

## 2. The three places

Pixel sizes below are for the portrait lens, 1.07 mrad a game pixel (SOURCE: `docs/specs/earth/CONTRACT.md`). They are ESTIMATES from that lens and from map coordinates.

### 2.1 The boxes

| Place | Box | Size | Notes |
|---|---|---|---|
| **Yosemite, the region** | 37-38 N, 119-120 W | one whole 10 m terrain tile | Everything below sits inside it. The tile ends 24 km north of the Valley's box and 26 km west of it (ESTIMATE from the coordinates). Past those edges the land comes from the world's model (see under this table) |
| **Yosemite Valley** (the first map) | 37.69-37.78 N, 119.70-119.48 W | 19.4 x 10 km (ESTIMATE, from the box's coordinates) | Tunnel View to Clouds Rest: El Capitan, Half Dome, Yosemite Falls, Glacier Point, the meadows. A checker found this box's edges cut the Merced gorge and Tenaya Canyon. That stops mattering because the land past it comes from the same tile |
| **Yosemite, the fine ground** (stage 4) | about 37.646-37.83 N, 119.724-119.38 W | about 30 x 20 km | The footprint of six 1 m lidar tiles. The first tile's bounds are MEASURED; the rest is an ESTIMATE from the 10 km tile grid |
| **The Mariposa Grove** (stage 5) | 37.49-37.53 N, 119.62-119.57 W | 4.4 x 4.5 km | Over 500 mature giant sequoias (SOURCE: nps.gov/yose/planyourvisit/sequoias.htm). It stands on the 10 m ground |
| **The Jungfrau region** | 7.80-8.15 E, 46.38-46.72 N | about 38 x 27 km, about 1,013 km² (ESTIMATE) | The Eiger, Mönch and Jungfrau, Lauterbrunnen, Grindelwald, Wengen, Mürren, the whole Aletsch glacier. Its top is the Finsteraarhorn, 4,274 m (SOURCE: en.wikipedia.org/wiki/Finsteraarhorn). All of it is inside Switzerland, so one terrain source covers it |
| **Milford Sound** | 44.84-44.54 S, 167.68-168.10 E | about 33 x 33 km (ESTIMATE) | The fiord from the open sea to its head, Mitre Peak, Stirling and Bowen Falls, the Cleddau valley, both ends of the Homer Tunnel, Mt Tūtoko, Pembroke Glacier. Widened on purpose: the research box clipped Sutherland Falls and Lake Quill by under a kilometre |
| **The Bay Area's test window** | 37.86-37.96 N, 122.65-122.50 W | 147 km² | Mount Tamalpais and Muir Woods. Not a new place: it is where the tree rule is proven first, on data the studio mostly holds already |

**The land past each box.** From the ceiling the game draws land to about 60 km from a map's middle: the bus may fly 8 km past the map and the view fades out 34 km beyond it (SOURCE: the surround plan, `docs/specs/far-field/SURROUND.md`). The world's 30 m model comes in one-degree tiles, and the tile over each box ends inside that reach: at 38 N for Yosemite, at 47 N for the Jungfrau box (46 N sits right at the limit), at 45 S for Milford, 18 km south of its box (ESTIMATES from the coordinates). A ring that ends at a tile's edge is drawn as sea. That is a live bug north of San Francisco today. So each place also takes the world-model tiles next to its own: one in stage 1 and four more in stage 4 for Yosemite, four for the Jungfrau box, two for Milford (sizes MEASURED once, section 8.1). West of Milford the next tile does not exist: it is open sea (MEASURED once: the bucket answers "not found").

Why the Jungfrau region and not Zermatt: the Matterhorn's south face is in Italy, where the Swiss 2 m terrain stops (MEASURED: no Swiss tile at Cervinia). The Matterhorn is a later fourth place.

### 2.2 Yosemite

**The picture.** The bus comes over the west rim and the ground falls away. Ahead is a flat floor, dark with forest, between two pale walls that stand straight up. On the left, El Capitan: a pale blade with a sharp front edge. On the right, a white thread of water down the wall. At the far end, a dome cut in half. The floor is in shadow and the walls are lit.

From Tunnel View, El Capitan is about 4 km away and about 210 px tall. Half Dome is about 13 km away and about 100 px tall. So the first picture is drawn almost wholly by the far ground.

| From | What a player sees |
|---|---|
| **Near** (tree-top height on the Valley floor) | Incense-cedar columns and tall open pines on bare trunks. Black oak domes at the meadow's edge. Low dark live oaks on the sunny talus under the north wall. Firs under the shady south wall. A pale meadow with the river through it. The wall fills the sky above the crowns. The trees are small against it: a 40 m pine is about 125 px tall at 300 m, and the wall behind it is 900 m |
| **At 300 m** | Every crown is its own shape out to about a kilometre: spires, columns, domes. Past that the forest is a dark canopy with hard edges at the meadows. El Capitan's face has joints and dark water streaks, and its rim is a crisp line. A waterfall drops free of the wall with mist at its foot. In the grove, about five giant sequoias a hectare stand over the firs, known by pale trunks 6 to 8 m wide |
| **From the ceiling** | A pale slot about 100 px wide and 11 km long in a dark forested plateau. East of it, bare pale granite country with dark forest only in the hollows, thinning out near 3,200 m. The walls' shadows lie across the floor. Painted ground and painted forest show as colour from up here |

### 2.3 The Swiss Alps: the Jungfrau region

**The picture.** The bus comes over a grass ridge and the Eiger's north face is there: a dark hollow wall about 1,800 m high, striped white where snow lies on its ledges. Beside it the Mönch and the Jungfrau, white. Below, pale pasture, dark spruce spires, and small villages on shelves above a trench. Over the next ridge the ground drops 400 m sheer into Lauterbrunnen, with white threads of water down the walls.

From Kleine Scheidegg the face is about 500 px tall: it more than fills the upper screen.

| From | What a player sees |
|---|---|
| **Near** | Spruce: dark, narrow, pointed, and shorter toward the tree line. Beech domes, maples and ash low in the valley. Smooth alder scrub in stripes down the avalanche chutes. Pale pasture between: half the slopes are open grass. Above the last trees, grass, then scree, then ice |
| **At 300 m** | The Eiger's face with its ice fields and ledges as white bands on dark rock. Lauterbrunnen's lip, a straight drop, a village on the shelf above it. Falls. Larch and stone pine near the tree line on the Aletsch side |
| **From the ceiling** | The Aletsch glacier: a white river about 90 px wide and 23 km long, curving, with dark stripes of rubble down its middle. Dark forest in the valleys, pale grass above, white on top. The lakes at their own heights |

### 2.4 Milford Sound

**The picture.** The bus comes in from the open sea, low. The fiord's mouth is a gap in a wall of mountains. Inside, the water is a dark mirror. The walls go straight into it with no beach. Forest hangs on them from the waterline to a hard level line 800 to 1,000 m up. Above the line is pale grey rock, and above that snow and a small glacier. One pyramid, Mitre Peak, stands almost 1,700 m out of the water (sources give 1,683 to 1,695 m). Two white falls drop into the sea.

Mitre Peak from the head of the fiord, where the wharf and the airstrip are, is about 7 km away and about 220 px tall: a quarter of the screen. Low on the water 3 km from it, it is about 480 px: more than half the screen (ESTIMATES from the airstrip's and the peak's map coordinates).

| From | What a player sees |
|---|---|
| **Near** (low on the water, or in the Cleddau valley) | Silver beech in fine layered sprays down to the tide line. Rimu standing above the canopy with drooping tops. Rounded kāmahi and rātā crowns on the walls. Tree ferns at the forest's edge in the valley. Wet dark rock. The water mirrors the walls |
| **At 300 m** | Three bands, bottom to top: dark water, dark forest, pale rock and snow. Pale vertical strips where forest has slid off. Hanging valleys with a lip, and a fall from the lip. Ice on Mt Tūtoko, and on Pembroke Glacier right above the outer fiord |
| **From the ceiling** | A dark branching blade of water cut into pale snowy mountains, with a dark green lining |

---

## 3. What the first version leaves out

"The first version" is the three places as they stand when stage 8 is done. Said plainly, so nobody is surprised.

**Everywhere**
- **Overhangs.** A height grid cannot overhang. El Capitan's roofs are not drawn.
- **Seasons.** Summer crowns all year. No autumn colour, no winter snow down to the valleys, no straw meadows by the date.
- **Larch gold, beech copper, black oak gold, rātā's crimson flowers, turquoise glacier lakes.** They are brown or saturated in life, and only paint is saturated. Larch gold does **not** come back with paint: paint is a faction's colour, not gold.
- **Every real tree's true position.** Trees are grown to the real mix, height and density. Single positions are invented, except where a tree is mapped.
- **The right trees everywhere else.** Five regions get a named kit here. Any other place gets a plain kit by its biome: believable, not correct. About 65 more named kits cover the world, and they are not in this plan's count (section 4.3).
- **Weather.** It is on hold. So Milford has no rain-day waterfalls and no mist. That is what many people remember of it.
- **Waterfalls by the month.** They always run. The real Yosemite Falls runs about November to July (SOURCE: nps.gov/yose/planyourvisit/waterfalls.htm).
- **Villages as buildings.** Yosemite Village, Milford's village and the Swiss villages are plain blocks and tone. Chalets come with the any-city work.
- **Cable cars, railways, cars, boats, people.** On hold with moving things, or part of the living Earth plan.

**Yosemite**
- Fires after 2020. The canopy map is from 2020. The 2022 Washburn Fire inside the Mariposa Grove is not in it.
- The Tuolumne and Merced groves get sequoias only if open plant records there pass the rule. They may come out as plain forest.
- Ponderosa and Jeffrey pine share one shape. They are hard to tell apart in life. Gray pine and sugar pine get their own (section 4.6).
- At Jet you fly over the Valley, not along it. Jet's turning circle is about 2.6 km and the Valley is about 1.6 km wide (ESTIMATE from today's turn numbers; the new handling will change them).

**The Jungfrau region**
- The Matterhorn. Crevasses and blue ice. Winter.
- The Eiger's north face is in shade most of the day under the real sun. It is designed to read in shade (section 7).

**Milford Sound**
- The sea floor. Depth hardly shows through dark water.
- Lidar-sharp rock on Mitre Peak and at Stirling Falls. Only an 8 m model made from contour lines exists there. Mitre Peak may ship softer than El Capitan (risk 3).
- Red beech, mountain beech and kauri. None grows in this box (section 4.4).

**On the way there, stage by stage, these shortcuts are taken and then removed.** Each is the producer's to accept (section 12).
- Stage 1's trees are stand-ins: today's four San Francisco shapes at data-driven heights.
- Stages 1 to 4 draw the forest at a third to a half of its real crown count, with wider crowns. Real counts and true sizes come in stage 5.
- Until stage 6, paint on a face steeper than about 65 degrees is a patch that stretches down the wall, and painted forest is not seen past about 1.5 km.

---

## 4. The rule that chooses trees, anywhere on Earth

### 4.1 The rule

It runs in the bake, cell by cell (about 10 m), on rasters only. No step knows a place's name. The inputs are the same anywhere on Earth. Each step has a fallback, so a place with less data still gets a forest.

| Step | Question | World data | Result | If the data is missing |
|---|---|---|---|---|
| 1 | Is anything woody here? | ESA WorldCover, 10 m | yes or no | - |
| 2 | **How tall is it?** | Canopy height: ETH's 10 m map everywhere | Scrub, open woodland or forest. **Height overrules everything after it** | WorldCover's own tree and shrub classes |
| 3 | Which natural region? | RESOLVE ecoregion id (846 regions). Where the map stops short of a coast, the nearest region within 10 km | A **kit**: the cast of trees that can grow here | The plain kit of the region's biome (section 4.5) |
| 4 | How high is the ground against this place's own tree line? | The terrain, and a tree line **measured from the data** | A **band** of the kit: low, middle, high, the scrub band, or no trees | The kit's written tree line |
| 5 | Is the local tree line high or low for this region? | The same measured tree line | Picks the wet-side or the dry-side cast inside one region | The usual cast |
| 6 | Needles or leaves? Evergreen or not? | Copernicus forest type, 100 m | Picks among the band's shapes | The band's usual mix |
| 7 | Sunny or shady, wet or dry, steep or flat? Which rock? | Slope, facing, wetness and ledges, all worked out from the terrain. The world rock-type grid is only a coarse hint: its cells are about 55 km wide (section 6.5) | A variant: the sunny-slope cast, the streamside cast, trees on ledges | The usual mix |
| 8 | Do plant records put a rare tree here? | GBIF records, CC0 and CC BY only | Switches on a shape the kit marks "only where recorded". Never adds one | The tree is left out |
| 9 | How big, and how many? | The canopy height again, and the tree cover | Each tree's height; the spacing between crowns | The shape's usual height |

Why this order:
- **Height first** fixes a mistake already measured. WorldCover calls Mount Tamalpais's chaparral summit 95.8 % tree (MEASURED, the surround plan). Its own validation report says it maps 29 % of the world's real shrubland as tree, 27 % in North America and 54 % in Europe (SOURCE: the WorldCover product validation report v2.0, re-read by a checker). A land-cover map cannot fix that: scrub and forest differ by height, and it never measures height. The region map cannot fix it either: it puts Tam's summit in a conifer-forest region (MEASURED by point query).
- **Region before leaf type** means a "needle-leaf that drops its needles" pixel in the Sierra can never become a larch. Larch is not in the Sierra's kit.
- **Size from the canopy map** means trees near the tree line come out short without anyone writing a rule for it.
- **The tree line as a climate signal** (step 5) splits the Alps with no Swiss-only input. The Alps are one region. The wet outer side ends in spruce near 1,800 m; the dry inner side ends in larch and stone pine near 2,300 m (SOURCE: the University of Zurich's Alpine course, geo.uzh.ch/microsite/alpecole, lessons 10 and 12). This step is the studio's own (ESTIMATE) and is scored against the Swiss timberline map.
- **Step 6 is off until stage 7.** The leaf-type map is fetched for the Alps. The Sierra's, the Bay's and Fiordland's kits do not need it: region and band already decide. So stage 2's grading at Tamalpais and in Yosemite tests steps 1 to 5 and 7 to 9, not step 6. Step 6 is first graded in the Jungfrau box, against the Swiss forest-mix map.

### 4.2 The numbers in the rule are starting values, and scripts grade them

The checkers found the research's thresholds unproven. So they are stated as guesses, and the pass marks are set before anything is run.

- **Forest or scrub.** Start: forest needs 8 m on the ETH map. That number is a guess. **The test**, at Mount Tamalpais and Muir Woods: at least 80 % of mapped chaparral must come out scrub, and at least 90 % of mapped redwood and Douglas-fir forest must come out forest. Three height maps are tried on the same window (ETH 10 m, Meta and WRI 1 m, GLAD 30 m) and the best one that is world-wide sets the bar. The score uses the OpenStreetMap scrub and wood polygons the studio already holds, as an answer key only. Then again on the chaparral of the Merced canyon, against the state's vegetation map.
- **The tree line.** Count only cells that carry plants at all, and take the highest band where tree cells still occur in number. (The research counted all ground. Bare rock, which is most of all three places, drags that far too low.) Check values, each from two sources:
  - Yosemite: upright trees to about 3,200 m, mats of whitebark pine to about 3,300-3,450 m (SOURCE: nps.gov/yose/learn/nature/whitebark-pine.htm; the US Forest Service's fire effects pages, fs.usda.gov/database/feis/plants/tree/pinalb).
  - Milford: 800-1,000 m (SOURCE: the Department of Conservation's Milford Road nature page, doc.govt.nz; teara.govt.nz on southern beech forest).
  - The Jungfrau box: about 1,800-2,000 m on the north side; about 2,000 m and up on the Aletsch side (SOURCE: the Zurich course above; wsl.ch/en/forest/forests-and-climate-change/at-the-top-the-forest-line). The 1,800-2,000 m is partly an ESTIMATE: grazing has lowered it.
- **Giants.** Height cannot find a sequoia. The Grizzly Giant is 63.7 m, and the sugar pines beside it are typically 53 to 61 m (SOURCE: conifers.org/pi/Pinus_lambertiana.php, which also gives the tallest ever measured, a dead tree, at 83 m). The 10 m canopy map is not shown to see above about 45 m. So step 8 is the switch: 551 usable records of giant sequoia sit in the Mariposa Grove box (MEASURED: api.gbif.org count, CC0 and CC BY only). Inside such cells the tallest few crowns a hectare become giants, and their height comes from the shape (55-85 m), not from the map. What marks a sequoia is its trunk, so the shape table carries trunk width as its own number. The same switch places coast redwoods at Muir Woods.
- **How many trees.** Real counts in Sierra forest run from about 25 to 740 a hectare with fire history (SOURCE: two forest studies, Collins et al. on Yosemite in 1911 and Knapp et al. 2013, as the checker cites them). So no kit holds a count. The count is the measured tree cover divided by one crown's area. A spruce 30 m tall with a 5.4 m crown at 80 % cover gives about 350 a hectare; a beech 25 m tall with an 11 m crown gives about 85 (ESTIMATE from those shapes).
- **Which layer wins when they disagree.** The layers are from different years, and Yosemite has burned in between. The newest layer wins.
- **Walls.** Today's bake plants no tree on a slope over 45 degrees. For wild places that rule goes: a tree stands wherever the canopy map has canopy. Milford's walls depend on it.

### 4.3 What a person writes by hand

Four things. None of them names a place.

1. **The kit table**, keyed by ecoregion id, band and variant (sections 4.4 and 4.5). Each row stores the plants it stands for, its sources and the date read. For the whole world it will be about 70 kits and 250-300 band rows: thousands of numbers, written over time (ESTIMATE; a checker showed the research's "1,500 cells" undercounts). This plan writes five named kits and the 14 plain ones. **The other 65 or so are not in its count.** Once the checks of section 4.7 exist, a kit is about half an agent-day to one agent-day, so about 35 to 65 agent-days for the world, written region by region as places open (ESTIMATE, from what the kits here took to source). About 13 more shapes come with them.
2. **The shapes** (section 4.6).
3. **The terrain source list**: "the finest open bare-ground model here is X". Keyed by where each model has data (section 6.2).
4. **The value steps and the rock looks** (section 7).

### 4.4 The kits for the three places and the Bay Area

Band limits are shares of the measured tree line. Heights come from the canopy map, held inside each shape's own range. Region ids are MEASURED by point queries on RESOLVE's service unless marked.

**Sierra Nevada forests** (region 366; MEASURED at the Mariposa Grove)

| Band | Cast | Sources |
|---|---|---|
| Foothill and canyon, below about 0.28 of the line (about 900 m) | Gray pine, blue oak, interior live oak. Chaparral (manzanita, ceanothus) where the height test says scrub | nps.gov/yose/learn/nature/plants.htm (the zones and their trees); added by the checker, who found this belt inside the region |
| Lower forest, to about 0.56 (about 1,800 m): the Valley floor | **Incense-cedar and black oak lead.** Ponderosa pine, sugar pine, white fir, Douglas-fir | The same NPS page; doi.org/10.1007/bf00045753 (incense-cedar has replaced ponderosa as the leading tree; one study, read only as a search summary, so the order of this cast is an ESTIMATE until the state's vegetation map scores it in stage 2); fs.usda.gov/database/feis/plants/tree/caldec and /quekel |
| Lower forest, sunny talus | Canyon live oak, bay laurel | yosemite.ca.us/library/trees_of_yosemite/life_zones.html; Muir's "The Yosemite" (two sources, both old) |
| Lower forest, shady slopes | White fir | The same two |
| Lower forest, by the river | Alder, cottonwood, willow | ESTIMATE from general knowledge; not sourced yet. The presence check must pass before it ships |
| Upper forest, to about 0.77 (about 2,450 m): the rims | Red fir, lodgepole pine. Jeffrey pine and Sierra juniper on bare granite | NPS plants page; fs.usda.gov/database/feis/plants/tree/abimag; conifers.org (its pages for Jeffrey pine and Sierra juniper) |
| High forest, to the line | Lodgepole pine, mountain hemlock, western white pine | NPS plants page; fs.usda.gov/database/feis/plants/tree/tsumer; research.fs.usda.gov/silvics/mountain-hemlock |
| The line and just above | Whitebark pine, upright and then as mats | nps.gov/yose/learn/nature/whitebark-pine.htm; feis pinalb |
| Only where recorded | Giant sequoia: 55-85 m, about five mature trees a hectare | nps.gov/yose/planyourvisit/sequoias.htm; npshistory.com/series/science/12/chap5.htm (5.3 mature trees a hectare); GBIF count 551 (MEASURED) |

**Alps conifer and mixed forests** (region 689; MEASURED at Lauterbrunnen and Männlichen)

| Band | Cast | Sources |
|---|---|---|
| Valley floors and low slopes | Beech, sycamore maple, ash. Much open pasture | geo.uzh.ch/microsite/alpecole lesson 12h (beech to about 1,600 m in the northern Alps). The maple, the ash and the pasture are a checker's own knowledge with no page behind them (ESTIMATE): the presence check must pass before this row ships |
| Middle | Beech with silver fir, then spruce with fir | The same lesson (fir's forest limit about 1,700 m) |
| High, where the measured tree line is low (the wet outer side) | Spruce to the line, with some larch. Trees 5-10 m at the line | Lesson 12h and 12i; lfi.ch elevation records (tree-line trees are 5-10 m) |
| High, where the measured tree line is high (the dry inner side) | Larch and Swiss stone pine | Lesson 12i (larch and stone pine forest 1,700-2,300 m); wsl.ch on the forest line and on stone pine |
| Avalanche tracks and wet north slopes | Green alder scrub | A 2020 study of Swiss subalpine shrubland (about 70 % of it is green alder; read as a search summary) |
| Dry ridges, only where recorded | Dwarf mountain pine | wsl.ch/gehoelze/Bergfoehre.pdf; treatment.plazi.org (the shrub form sits on limestone at the Alps' edge, not on the Aletsch side). The world rock grid is too coarse to find that limestone: one cell is wider than the whole box. So plant records switch this row on, as they do for sequoias. Whether open records hold enough dwarf pine here is not confirmed |
| Above the line | Alpenrose heath, grass, scree, ice | Lesson 12 |

**Fiordland temperate forests** (region 169; MEASURED in the Cleddau valley. The village itself falls in no region, so the 10 km rule of step 3 is needed)

| Band | Cast | Sources |
|---|---|---|
| Valley floors and low gentle slopes | Silver beech, with rimu standing above it. Kāmahi. Tree ferns at edges | The Department of Conservation's Milford Road and Milford Sound nature page (doc.govt.nz); nzpcn.org.nz/flora/species/dacrydium-cupressinum; teara.govt.nz (its conifers pages) |
| Walls, from the sea to the line | Silver beech with kāmahi and southern rātā, all growing shorter | The same DOC page; nzpcn.org.nz/flora/species/lophozonia-menziesii, /pterophylla-racemosa and /metrosideros-umbellata (rātā from 0 to about 1,000 m, kāmahi to 28 m) |
| The line, 800-1,000 m | Silver beech makes it | DOC; teara.govt.nz on southern beech forest; a 1973 forest study (scionresearch.com, Herbert) |
| Above | A band of low scrub, then tussock, rock, snow and ice | newzealandecology.org/nzje/2539 (one source, from the next range east: the band's depth is unsupported for this box) |
| Never in this box | Red beech, mountain beech: the whole box is west of the Main Divide. Kauri: it grows wild only north of about 38 S, about 750 km away | DOC (red beech is in the Eglinton, outside the box); teara.govt.nz (its conifers pages) |

**Northern California coastal forests** (region 359; MEASURED at Tamalpais and Muir Woods)

| Band | Cast | Sources |
|---|---|---|
| Wet canyon floors, only where recorded | Coast redwood, to about 79 m | nps.gov/muwo/learn/nature/treesandshrubs.htm; GBIF: Sequoia 136 records at Muir Woods (MEASURED once, by the researcher) |
| Slopes | Douglas-fir, tanoak, bay laurel, madrone, live oak | onetam.org peak-health pages; GBIF: tanoak 34 records (MEASURED once). Madrone is a checker's own knowledge (ESTIMATE): the presence check must pass |
| Where the height test says scrub | Manzanita and ceanothus lumps | GBIF at Tam's summit: manzanita 209 records, ceanothus 121 (MEASURED); onetam.org |

**California interior chaparral and woodlands** (region 423; the id comes from the designs and was not re-checked)

| Band | Cast | Sources |
|---|---|---|
| All | Scrub lumps. Live oak in the hollows | The region's own name and biome in RESOLVE. The cast is an ESTIMATE; the presence check must pass before it ships |

**Planted trees are a band like any other, keyed by region.** Today's four San Francisco shapes (street tree, eucalyptus, Monterey pine, cypress) become the "planted" band of the region San Francisco stands in, chosen where the land is built up. They are not the world's city kit: London must not get eucalyptus. A region with no planted band of its own uses its plain kit's dome as a street tree until one is written.

### 4.5 Fourteen plain kits, written first

So that any place on Earth gets a believable forest before its own kit exists, one plain kit is written for each of RESOLVE's 14 biomes, from the same shapes. A named kit then makes it right. These rows are ESTIMATES by design: believable, not correct.

| Biome | Plain kit, from the first version's shapes |
|---|---|
| Tropical and subtropical moist broadleaf forests | Tall domes and round domes, dense. (Palms and emergent giants wait for their shapes) |
| Tropical and subtropical dry broadleaf forests | Round domes, open |
| Tropical and subtropical coniferous forests | Open pines |
| Temperate broadleaf and mixed forests | Tall domes and round domes, with broad cones |
| Temperate conifer forests | Broad cones, dark spires, open pines |
| Boreal forests | Dark spires, thin poles, airy cones |
| Tropical and subtropical grasslands, savannas and shrublands | Scattered round domes, scrub lumps |
| Temperate grasslands, savannas and shrublands | Streamside ovals along water, little else |
| Flooded grasslands and savannas | Streamside ovals, scrub clumps |
| Montane grasslands and shrublands | Scrub lumps, mats |
| Tundra | Mats |
| Mediterranean forests, woodlands and scrub | Low dark domes, open pines, scrub lumps |
| Deserts and xeric shrublands | Sparse scrub lumps |
| Mangroves | Low dark domes at the water. (Stilt roots wait for their shape) |

### 4.6 The shapes

About 38 shapes cover the world (ESTIMATE). The three places and the Bay Area need 21 new ones on top of today's four.

| Family | New shapes | Stand for | Look taken from |
|---|---|---|---|
| Points | dark narrow spire; broad cone; thin pole; airy see-through cone | red fir, spruce, mountain hemlock; white fir, silver fir, Douglas-fir; lodgepole pine; larch | The Forest Service's fire effects pages; conifers.org |
| Columns | narrow column; dense dark column; tall column with a high crown; the giant | incense-cedar, juniper; Swiss stone pine; coast redwood; giant sequoia | conifers.org/cu/Calocedrus_decurrens.php and /cu/Sequoiadendron.php; waldwissen.net on stone pine |
| Open pines | tall open pine; flag-armed pine; sparse forked pine | ponderosa and Jeffrey pine; sugar pine, with a few very long level arms near its top; gray pine, thin, grey and forked. The last two were one shape with ponderosa until a critic said anyone who knows the Sierra tells them apart at a glance | conifers.org/pi/Pinus_ponderosa.php; fs.usda.gov/database/feis/plants/tree/pinlam; research.fs.usda.gov/silvics. Gray pine's look is an ESTIMATE from general knowledge, not sourced yet |
| Domes | tall dome; round dome; low dark dome; layered sprays; drooping emergent | black oak, beech; maple, ash, kāmahi, rātā; live oaks, bay; silver beech; rimu | feis quekel; nzpcn.org.nz species pages |
| Slender | streamside oval | alder, cottonwood, willow | ESTIMATE |
| Low | scrub lumps; tall scrub clump; mat | chaparral; green alder, subalpine scrub; whitebark and dwarf pine at the line | feis pinalb; eunis.eea.europa.eu/habitats/8151 |
| Fan (a second template) | tree fern | Fiordland's valley edges; the world's palms later | Te Papa's tree fern guide |

What a new shape really costs. It is not "one more row in a table", as the research had it. A checker read today's tree code (`src/world/props/trees.ts`) and found each shape needs:
- a crown row, a mass row and a trunk row, with trunk width as its own number;
- a shape number carried by each tree (today the shader picks the species by a hash, and the code allows three kinds);
- heights in metres (today's tallest tree is about 38 m; a sequoia is 55-85 m);
- a cone lobe for spires and a flat lens lobe (today's lobes are round);
- new crown outlines for the flight, so the bus skims an 80 m grove and not a 20 m ghost;
- the tables moved out of shader constants into a small texture;
- and, for fronds, a second "fan" template. Palms, tree ferns and cabbage trees cannot be drawn with lobes at all.

### 4.7 How the table is kept honest

Scripts decide pass or fail, with the marks set first.
- **Presence check.** Every tree a row names must have open plant records in that region and band. That catches a larch in the Sierra.
- **Coverage check.** The row's trees must cover most of the tree records there. That catches a Fiordland kit with no beech.
- **Answer keys**, for scoring only, never shipped: the state's copy of Yosemite's vegetation map; the Swiss timberline, silver fir and forest-mix maps; the lidar's real canopy heights at Milford.
- **Every colour** passes the brown test.

Two weaknesses to know:
- The CC0 and CC BY filter drops all of iNaturalist, which is non-commercial. What is left is older museum and survey data, and it is patchy. Where records are too thin, a row passes on its written source alone and says so.
- Yosemite's answer key is drawn from 1997 photos, before the Rim, Ferguson and Washburn fires. A right answer can score as wrong on a burned slope.

### 4.8 What the bake hands the phone

The bake folds the whole rule into small planes of a planet tile. The phone never hears about ecoregions, leaf types or tree lines.

| Plane | File family | What | Size |
|---|---|---|---|
| `TREE_SHARE` | surface | The share of each cell under woody plants, after the height test | 1 byte a cell |
| `CANOPY` | surface | Height in metres | 1 byte a cell |
| `KIT` | surface | A number that points at one mix: "60 % dark spire, 30 % thin pole, 10 % mat, crowns 5.7 m apart, no giants" | 1 byte a cell |
| `CLEAR` | **built** | Where trees may not stand: roads, buildings, rivers | 1 bit a cell |

- `CLEAR` comes from OpenStreetMap-family data, which is share-alike on the database (ODbL). So it lives in the `built` file family and never in `surface`. The same goes for baked rivers, waterfalls and village blocks (section 6.7). This is a binding rule, not a detail.
- The planes sit at tile level 12 (8.8 m cells, a tile 2.25 km wide) where a place is baked finely. Three byte planes are about 10 to 14 KB a square kilometre zipped (ESTIMATE).
- Placing every tree instead would be 150-250 KB a square kilometre, and about 13 TB for the planet (ESTIMATE). Growing is the only way that scales.
- Because every input the phone uses is a raster, the near trees and the far forest read the same thing the same way. That was a checker's condition for the far forest ever matching the near one.

**Two changes the Bay Area's surround takes before it is built.** Both are free today, and both are in `SURROUND.md` since 2026-11-12, with the water rule of section 6.3.
1. Its new container is named `SBT1`. That name is already inside today's near tiles (`src/world/tiles.ts`). Call the planet container something else, for example `SBP1`.
2. Its class table's TREE row should take its tone from `KIT` and `CANOPY`, not from a fixed number.

---

## 5. How forests are drawn and painted, from the rooftops to the ceiling

### 5.1 What today's trees do

Counted from the code (MEASURED by reading `trees.ts` and `main.ts`, checked):
- A tree is 48 triangles near, 23 more for its shadow, 11 far.
- Trees end at 0.9 to 1.6 km. One draw per 256 m tile.
- The bake plants about 70 crowns a hectare. Real forests want 3 to 8 times that.
- Every crown is carved per pixel and writes its own depth. Apple's chips handle that less well than plain triangles.
- At 400 trees a hectare today's code would spend about 1.5 M triangles on trees alone: the phone's whole budget.

### 5.2 The first look (stages 1 to 4)

Today's tree code, with four small changes, all of which the final forest keeps:
1. A shape number per tree, from the bake.
2. Heights in metres.
3. A cone lobe, so a fir is a spire and not a flame.
4. The flight's obstacle heights read the shape table.

Trees are baked, as in a city, at about 120 crowns a hectare with crowns drawn wide enough to close the canopy. Past the last tree, forest is a dark tone on the far ground, and the far ground under forest is lifted by the canopy height, so the forest does not drop 40 m where the trees end.

| The worst wild view, first look (ESTIMATE on today's measured triangle counts) | Triangles | Draws |
|---|---|---|
| Trees at 120 a hectare | about 450,000 | about 30 |
| Near ground | about 50,000 | about 25 |
| Far ground and the land past the map | about 190,000 | 2 |
| **A wild frame** | **about 0.7 M of 1.0-1.5 M** | **about 65-75 of 120-200** |

There are no buildings, which is what pays for the forest. At 200 a hectare the trees alone are about 750,000 triangles, so the density is a dial for the phone session.

This is a stand-in, and it is said so. Wide crowns make a wall look smaller than it is. Baked trees do not scale to the planet. Stage 5 replaces both.

### 5.3 The forest proper (stage 5 on): grown, not placed

**Trees are the ruler.** A wall's size is read from the trees at its foot. So trees are drawn at their measured height, their real crown width and their real count.

Wild trees are **grown on the phone** from a seed, in a worker, on a jittered grid, from the planes of section 4.8.
- A tree stands if a hash is under `TREE_SHARE` and `CLEAR` allows it. Its height is `CANOPY` with a hashed spread. Its shape comes from the mix.
- **It counts by the surface, not by the map.** A 70 degree wall has 2.9 times the surface of its map cell. A steep cell holds up to three trees down its fall line.
- Each tree is packed to 16 bytes, not today's 76. A 1.9 km circle of real forest is about 450,000 trees: 7 MB packed against 34 MB (ESTIMATE).
- At Jet about 68,000 trees a second come into range, under a millisecond a block (ESTIMATE).
- The worker also raises the flight's obstacle field to each crown's real height.
- Cities keep their baked trees. Mapped single trees stay fixed on top of the grown forest.
- A grown tree reads its paint from a grid kept by place, not from itself (section 5.6).

### 5.4 Four bands

Distances are really "pixels a crown". The table is for a 5 m conifer crown on the portrait lens. A 10 m dome doubles the distances (ESTIMATE).

| Band | A crown is | To about | What is drawn | Cost in the worst wild view (ESTIMATE) |
|---|---|---|---|---|
| **Real trees** | over 25 px | 190 m | The full tree: trunk, up to eight lobes, shadow, sway once painted. In 64 m blocks, so only near trees pay full price. About 80 triangles a tree | 120-270 k triangles, 20-32 draws |
| **One solid a tree** | 25 down to 5 px | 950 m | One carved shape on a two-triangle card: dome, cone or lens, in the same ramp and light steps | about 60 k triangles, 15-25 draws |
| **The canopy shell** | under and beyond both | from about 300 m out | No extra geometry. The ground itself is lifted to 0.6 of the canopy height where forest is closed, in the forest's deep tone, and drawn first. Crowns stand out of it. Between about 1.2 and 1.8 km it rises to the full canopy height while single trees drop out | 0 triangles, 0 draws |
| **Tone on relief** | under 5 px | the horizon and the ceiling | The far ground: lifted by the canopy, toned by the kit's value step, darker where the canopy is tall and closed | nothing extra |

Every hand-over is per tree, at a distance jittered by the tree's own seed. Trees change one at a time, scattered, never as a wall. Whole tiles never switch at speed.

**Why the shell.** It answers three faults the checkers found.
- *Overdraw.* In a dense valley the lower screen may be five to ten carved crowns deep. The shell is plain solid ground drawn first, so most crown layers behind it are thrown away early. Near blocks are drawn front to back for the rest.
- *Shadows vanishing at the first hand-over.* Near trees cast shadows; the solids do not. With the shell there is no lit floor left to miss them on. The far bands also darken the gaps between crowns by the sun's height.
- *Far crowns unproven.* The research drew far forest as "crown cells": every far pixel works out its own crown. A checker found they streak on steep walls and have no outline at grazing angles. They are not in the first version. They are a priced later option with their own phone test (section 9.3).

The shell is itself unproven. Its rise may read as a swell at speed, and a shell on a 60 degree wall needs care. That is why it is tested first, on a budget page, before anything is built on it.

### 5.5 Inside the A15's budget

| The worst wild view, forest proper (ESTIMATE; both winning designs' counts agree within these ranges) | Triangles | Draws |
|---|---|---|
| Terrain, meshed to an error budget | 80-250 k | 10-40 |
| Forest, all bands | 200-330 k | 40-60 |
| Falls, water, the bus, sky, effects | under 50 k | about 20-30 |
| **A wild view** | **about 300-600 k of 1.0-1.5 M** | **about 70-120 of 120-200** |

**Nothing here has run on an A15, or on any GPU. Every number is a count.** The real unknown is not triangles: it is the cost of carved crowns in layers. So the first forest work is a **budget page**: a made-up forest at 70, 200 and 400 trees a hectare, with and without the shell, opened on an iPhone 13 with the frame counter on. Its answer sets the band distances before anything is built on them.

Nothing compiles in flight: every band's material and both templates go into the warm-up.

### 5.6 Paint

- **Near, stages 1 to 4:** as today. Each baked tree carries its paint level and its faction, pops, floods down from the crown and sways. The ground takes paint as today. So a forest, a meadow and a talus slope all paint from day one.
- **Near, from stage 5: paint kept by place.** A grown tree is made again each time it comes into range, so it cannot hold its own paint. Stage 5 therefore brings the near level of the paint record: a grid at about one crown a cell (8 m), saved the way ground paint is saved. A tree does not own its paint; it reads the cell under it. Without this a painted forest would turn grey when the player flew away and came back. It also means a painted grove stays painted when the grower or the kits change. An 85 m splat paints about 900 trees at once at real counts (ESTIMATE).
- **The whole record** (stage 6) adds the coarser 32 m and 128 m levels, which is what lets far forest show paint.
- **Far:** the shell and the tone read the same raster. A coarse level keeps the **commonest hue and how much is painted**, never an average. Averaged hues are how brown gets in.
- **So a painted forest never changes colour as it recedes, only detail.** A painted 2 km² of Yosemite Valley is about 100 px across from the ceiling (ESTIMATE).
- **Walls** take paint through their own store (section 6.6). **Snow and ice** take ground paint as it is. **Water** takes none; a painted waterfall is a producer's call (section 12).
- This stands on the far-field plan's world paint raster (`docs/specs/far-field/VERDICT.md`, step 2), which is not built. If the wild work has to build it, that is 3-4 agent-days more (ESTIMATE).

---

## 6. Terrain and sheer walls

### 6.1 What the world's 30 m model does to them

The walls, measured by a checker on one line each (point and profile height queries to the US and Swiss survey services):
- **El Capitan.** Rim at 2,178 m, toe at about 1,309 m, over a run of 170-195 m: about 78 degrees. The top 484 m falls inside one 28 m step. At 30 m that is about six cells: from 300 m it is a smooth ramp of a few huge facets. It is fine from 5 km out.
- **The Eiger's north face.** 57-61 degrees, with stretches of 65-72. The 30 m model holds the slope and loses the ledges, the ridges and tens of metres of summit.
- **Mitre Peak.** About 59 degrees. Held, with a rounded top.
- **The game loses more than the data.** The surround draws its ring at 256 and 512 m between points. That turns El Capitan into a 41 to 74 degree slope.

So the 30 m world model holds the Eiger and Mitre Peak in the large and cannot hold El Capitan or Lauterbrunnen.

### 6.2 How fine, how far, and where it comes from

A wall reads when its rim and edges are within about 2 pixels of the truth (ESTIMATE of the rule).

| Bus to wall | Ground points needed | Where it comes from |
|---|---|---|
| 300 m | 1-2 m | Yosemite: 1 m lidar. Jungfrau: 2 m. Milford: 1 m at the fiord's head only |
| 1 km | 2-4 m | the same |
| 5 km | 10-20 m | 10 m in Yosemite, 8 m at Milford, 2 m thinned in Switzerland |
| 15 km and the ceiling | 30 m | the world's model |

**The source list** is a table keyed by coverage, not by place: the finest open bare-ground model at each point, the world's 30 m model everywhere else. Today it has four rows: the US survey's 3DEP in the United States, swissALTI3D in Switzerland, LINZ's models in New Zealand, Copernicus GLO-30 everywhere. It is the same kind of table as the building-heights ladder the far-field plan already has.

### 6.3 What is built, in two steps

**Step one: a wild place is a city with no buildings** (stages 1 to 3). Today's bake is city-agnostic: a place is one small file naming a box and its sources. Yosemite Valley is the size of San Francisco's map. So the first look needs no new tile format and no new streaming. Near tiles are today's 256 m tiles drawn at 8 m, fed by the 10 m model. On that mesh El Capitan stands at 77 to 86 degrees with a rim rounded over 10 to 16 m and no ledges (ESTIMATE). That is the bet stage 1 tests on the phone: does a wall like that already read as a wall at 300 m?

Fixed in step one, because the first flight needs them:
- **Heights past 3,276.7 m in the far formats.** Five formats store heights as 16-bit decimetres and clip there (`tiles.ts`, the far grid, the horizon). The Valley's own map tops out near 3,025 m (ESTIMATE from Clouds Rest's published height), so its near tiles are safe. But the land around it takes in Mt Hoffmann (3,307 m) and Mt Lyell (about 3,997 m). So the far grid and the horizon get a base and a step per file now. The far-field plan already lists this fix (`VERDICT.md`, step 4); it is counted once.
- **The horizon reads a second source past the tile's edge.** Today's horizon bake reads one terrain tile and draws everything past it as sea. For Yosemite it takes the world-model tile to the north as well (section 2.1).
- **The bake stops with an error** when a box breaks a height cap. It never clips quietly.
- **Water keeps its own height.** The surround plan sinks every water cell to 6 m below sea level. In the mountains that digs a pit under Tenaya Lake, the Merced, Lauterbrunnen's river and Lakes Thun and Brienz. Water is sunk only where it is at sea level.
- **Everything that assumes the ground is near sea level** gets a named half day: the ceiling (measured from the ground), the fog, the sea plane, the gears' floors. The game has only ever run near sea level.
- **Rock that reads as rock** (section 6.5).

**Step two: the place moves into the planet's tiles** (stage 4). It is written in the surround's planet tile container, so the planet layer later takes it over as its deeper levels with nothing thrown away.
- **Levels.** Levels 10 to 12 (35, 17.6 and 8.8 m cells) cover a whole place. Levels 13 and 14 (4.4 and 2.2 m) are kept for a tile **only where the finer source changes the ground by more than about a metre and a half** (ESTIMATE). Walls get them. Meadows, forest slopes and ice do not. So the data decides where the detail is, the same way everywhere, and a place is about 60 to 80 MB on the server, not 160 to 240 (ESTIMATE, to be measured in the bake).
- **Heights are stored with a base and a step per tile.** 4,274 m fits.
- **The mesh.** Built per tile in a worker to an error budget of about 1.5 px: many triangles on walls, few on floors, skirts between levels. The far ground is meshed the same way, not on a fixed grid. That is what draws Half Dome from 13 km.
- **A small streamer** for levels 12 to 14 in a local frame, parent first, chosen by pixels. It is the planet streamer without its globe addressing.
- **The game's 256 m tile is made on the phone from the planet tiles**, not baked as a second file. The flight, the obstacle field and ground paint all read it. Heights are plain numbers there, so the 3,276.7 m clip is gone by construction in the three near formats too. The same code later puts ground under the bus anywhere on Earth, which "home from the Moon lands where you aim" needs.
- **Room for rock, snow and ice** in the near ground's classes. Today it has four bits.
- A height grid at 2 to 4 m holds 85 to 89 degrees. Overhangs need rock pieces or cliff sheets, later.

**Why this split.** Two judges wanted game tiles made from planet tiles; one called it the least trusted piece on the path to the first low flight. Both are right. So the producer flies low over Yosemite three times on today's tiles before that piece is built, and the piece comes with a fallback: if it runs over, today's near files get a base and a step per tile instead.

### 6.4 Seams, and the ground under trees

- The world's 30 m model is a radar surface. It sits part of the way into the forest canopy. National ground models are bare ground. Where they meet under forest there is a step.
- Yosemite's seam is at the 10 m tile's edge, 24 km or more from the Valley, where the world model's neighbouring tiles begin. The Jungfrau and Milford boxes meet the world model at their own edges. Each seam gets a blend ring a kilometre or two wide. Datum offsets between sources are about a metre and unchecked.
- Near trees must stand on bare ground. Inside the three boxes the ground models are bare already.
- For the rest of the world, "the 30 m model minus the canopy height" digs too deep, by how far the radar sank in. **Milford's lidar pair measures that depth once** (surface model minus ground model is the true canopy). The rule then subtracts only that share, and never goes below the open ground beside the forest. So the three places calibrate a rule the rest of the world will use.
- **Measure first.** Each world-model tile comes with small masks of what was edited and filled, and a tiny file naming which model filled which part. They say how much of each wall is made up. They are the first thing read.

### 6.5 Making rock read as rock

- The ground shader mixes 55 % of flat-ground light into every pixel. On a shaded wall that lights it like a meadow. It fades out with steepness.
- Faces steeper than about 50 degrees take a world-anchored rock pattern from the side as well as from above, quantised to the palette last.
- Normals are taken over a narrower patch on walls, so rims stay crisp.
- **Three rock looks, keyed by the wall's own shape and wetness**, not by place: pale massive rock with dark vertical water streaks and few joints; grey banded rock with a ledge every few tens of metres; dark wet rock with plants on every ledge.
  - **Ledges come from the terrain.** Where the fine ground steps down a face in benches, the wall is banded. Where it is smooth, it is massive. The 2 m and 1 m ground can show this; the 10 m ground mostly cannot, so before stage 4 a wall takes its region's usual look.
  - **The world rock-type grid is only the fallback and the tone.** Its cells are about 55 km wide (SOURCE: its dataset page). It tells granite country from limestone country. It cannot split the Eiger's limestone from the Jungfrau's gneiss next door, and nothing in this plan asks it to.
- Snow lies on any ledge under about 55 degrees inside the snow class. That is what stripes the Eiger.
- **Valley shadows.** The Moon's code already sweeps the sun across a height raster in a worker. The same sweep over the relief gives Yosemite's dark floor under lit walls for no draws.

### 6.6 Paint on walls

- Ground paint is stored as seen from above, 2 m a cell. It works to about 60-65 degrees and smears from 70. On El Capitan one splat becomes a stripe 170 m wide and 900 m tall. The shockwave ring is not drawn at all on faces steeper than about 70 degrees (`src/world/GroundPaint.ts`).
- **First** (stage 3): the splat's reach is measured in three dimensions, as a ball. A shot at a wall paints a patch that stretches down the wall, not a stripe from the valley to the rim. This is a shortcut and is said so.
- **Then** (stage 6): steep tiles get two more paint masks seen from the sides, made only when such a tile is first painted (about 115 KB a painted wall tile, ESTIMATE), and the ring is drawn on steep faces.
- The Eiger's and Milford's mean slopes are under 62 degrees, so most of them take today's paint. Snow takes it perfectly.

### 6.7 Waterfalls

White water is the brightest unpainted thing in the frame. A fall is the cue that says "this wall is 700 m tall".

- Found by one world rule: a mapped waterfall point, or a river line crossing a drop in the relief. The drop is read from the terrain.
- **Points, in this order.** Wikidata first: it is CC0 and has 14,166 falls with a place and 1,054 with a height. Then OpenStreetMap's, which has 87,226 (MEASURED counts). Overture's water layer lists "waterfall" as a class (SOURCE: docs.overturemaps.org/schema/reference/base/types/water_class); whether the release in use carries the points is checked on the first extract.
- **Licence.** River lines, and any fall found from an OpenStreetMap point or line, are share-alike on the database (ODbL). So the baked rivers and falls live in the `built` file family with `CLEAR`, never in `surface` or `relief`. A fall known from Wikidata and the terrain alone could live anywhere; it goes in `built` too, so there is one rule. US river lines from the US survey are public domain and are a lead for later (section 11).
- Drawn as one white ribbon falling free of the face, with mist and a pool; a few hundred triangles each, all falls in one draw (ESTIMATE).
- They only work once the lip is real, so they come after the walls.
- The list, from the checkers: Yosemite Falls, Bridalveil, Ribbon, Sentinel, Vernal, Nevada, Horsetail; Staubbach and Lauterbrunnen's others; Bowen, Stirling and Sutherland.

### 6.8 What the flight needs

The place is judged in motion. Today's flight fails among walls in two ways.

1. **Over a wall, today the bus is lifted like an elevator.** At Jet it starts 725 m before a 1,000 m wall and peaks at about 1,650 m/s of climb (MEASURED by a simulation of the flight's floor, rerun by a checker). The research's fix, a fixed ramp, added 312 m/s of climb on top of full forward speed: 548 m/s at Jet. That breaks the ruling "speed and climb never grow", and the checker rejected it.
   **The design: the nose leads.** When the ground ahead is higher than the bus can clear, the bus pitches up, by as little as clears it, and up to the 85 degrees the nose already allows. Its speed stays the gear's speed and follows the nose, as the rulebook says. The turn into the climb is rounded: the simulation's corner jolted at 180-346 g.
   - At Cruise the bus climbs El Capitan's 900 m face nose-up in about 35 seconds, a few metres off the rock (ESTIMATE: 900 m at 26 m/s). That is a hero moment.
   - At Jet it must look about 2.2 to 3.4 km ahead, and up to 5 km at Turbo 3, so the pitch stays gentle (ESTIMATE from today's turn rates). On a 35 degree path a 1,000 m wall is met about 1.4 km out.
   - A small simulation proves the numbers before any phone does. How steep it feels right is a dial for the phone.
2. **Down into a valley, today the bus cannot go.** It sinks 9 m/s at most, at every speed. Off El Capitan's rim at Jet it sinks about 32 m while crossing the whole Valley.
   **The design:** the bus follows slopes down along the same nose-led path, up to about 35-40 degrees, where the ground ahead stays low for a few seconds. Crests keep their hang time. A cliff still needs a dive. Diving off Glacier Point is the best moment the place has, and it stays the player's.
3. **Also needed:**
   - a pyramid of "highest point in this square" over the relief, so "what is ahead" is a few reads for the climb, the camera and the shots;
   - a check along the whole line flown since the last frame, so a thin ridge is never passed through;
   - a camera that stays out of rock;
   - shots that land on the face they were aimed at when the wall is near;
   - the tower push standing aside for terrain, the 18 m "assume rooftops" pad coming off where nothing is built, and the gears working on a wild map.
4. **Two builds touch the flight.** The new handling (`feat/swerve`, `feat/handling`) changes the same file and the turn numbers. This work waits for that merge or builds on it.

---

## 7. Colour inside the rules

No brown: nothing with hue 30-85, lightness under 0.62 and chroma over 0.025. Paint is the only saturated thing: the ramps used here peak at chroma 0.016-0.042, paint at 0.16-0.21. (The world has one approved exception, the landmark ramp BRIDGE_ORANGE at 0.139. No wild place uses it.) The values below are MEASURED by a script over `src/render/palette.ts`. None of the ramps named has a brown step.

### 7.1 No new ramp in the first version

All three places are famous in black and white. Yosemite is pale granite over a black forest with a white thread of water. Milford is a dark wall standing in a dark mirror. The Eiger is a dark face striped with white ledges over pale pasture. None of them needs a new colour to be known. They need **shape, value, scale and white water**.

The research proposed three new ramps. The checkers found them weak.
- **A "conifer" blue-green.** At the chroma the rules allow, it differs from today's green-grey by less than the eye can tell. And the ramp already does the job: GREEN_GREY's dark steps are blue-green (hue 183-196) and its light steps yellow-green (hue 139-160). So a tree drawn darker is also drawn cooler. **Forests are told apart by value step and by crown shape, on the one ramp.**
- **A rose-grey sequoia bark.** The palette's own note says the old rose mid-steps of STONE "read pink" and were removed. **The sequoia's trunk goes on STONE as it is:** pale buff in the sun (lightness 0.76-0.85, hue 81-83, chroma under 0.02), cool violet-grey in shade. A sequoia is known by a trunk 6 to 8 m wide glowing pale among dark crowns, not by its hue.
- **A larch gold.** No. It is saturated, and its darker steps are brown.

### 7.2 The value ladders

Each place is a ladder of four values, dark to light. The ladder must hold in every frame. Steps are counted from 0, the darkest, to 7; the numbers in brackets are lightness. **A rung is told from the next by lightness, not by step number:** the same step number is a different lightness on each ramp.

| Place | Darkest | | | Lightest |
|---|---|---|---|---|
| **Yosemite** | Conifer forest: GREEN_GREY steps 1-3 (0.26-0.37) | Meadow: GREEN_GREY 6-7 (0.58-0.67), or SAND where dry | Granite: GREY_LIGHT 5-7 (0.70-0.87), streaks on its steps 2-3 | Falls and snow: WHITE 5-7 (0.91-1.00) |
| **Jungfrau** | Spruce: GREEN_GREY 1-3 (0.26-0.37); the face's rock in shade: GREY 1-4 (0.27-0.49); rubble stripes on the ice: GREY 3-5 (to 0.57) | Pasture: GREEN_GREY 6-7 (0.58-0.67) | Ledge snow in shade: WHITE 1-3 (0.59-0.77). It overlaps pasture in lightness. That is allowed because the two never touch: the snow lies on shaded rock, the pasture beside spruce | Ice and snow in sun: WHITE 5-7 (0.91-1.00) |
| **Milford** | Water seen from above: WATER 0-2 (0.21-0.29) | Forest: GREEN_GREY 3-5 (0.37-0.50); wet rock: GREY 2-4 | Rock above the line: GREY 5-6 (0.57-0.65) | Snow, ice, falls: WHITE 5-7 |

Value steps by tree, on GREEN_GREY: red fir and spruce darkest (0-3); live oak, stone pine and silver beech dark (1-4); pines, kāmahi, rātā and scrub middle (3-5); incense-cedar and beech lighter (4-6); black oak, alder and larch lightest (5-7), the larch carved see-through. Trunks: GREY; GREY_LIGHT for beech; STONE for sequoia and old pine.

**Milford's one danger** is dark forest on dark water. Three answers, all from data: the forest (0.37-0.50) sits at least 0.08 of lightness above the water seen from above (0.21-0.29); low over the fiord the water mirrors the sky and goes pale, so the forest is dark on bright; and steep cells that touch the sea get a thin band of pale wet rock at the tide line. The fiord's darkest water is chosen by a rule (water walled in by steep high ground), not by a place's name.

**The Eiger in shade** keeps its stripes: snow in shade sits at 0.59-0.77 and rock in shade at 0.27-0.49, at least 0.10 of lightness apart.

### 7.3 Things that are brown or saturated in life

| In life | In the game |
|---|---|
| Sequoia's cinnamon bark | STONE |
| Larch gold; beech copper; black oak gold | Not shown. If seasons are ever ruled in: pale, lifted, low-chroma leaves in autumn and bare silver-grey crowns in winter. Never gold |
| Late-summer straw meadow; snow tussock | SAND, which is pale and warm only above lightness 0.79 |
| Manzanita's red bark | GREY |
| Rātā's crimson flowers; turquoise glacier lakes | Not shown |
| Dark timber chalets | Charcoal, when chalets come |

### 7.4 How it is checked

- The palette check on every frame (`tools/far/pal.py`): palette 100 %, brown 0.
- **A value-ladder check**, new. In each hero pose a script measures the mean lightness of each thing on the ladder. Two tests, both on lightness and never on step numbers. The rungs must stand in the table's order. And every pair that touches in the picture (forest and meadow, rock and its ledge snow, forest and water, ice and its rubble) must be at least 0.08 of lightness apart (ESTIMATE of the bar; it is tuned on the swatch page). A script says pass or fail. The hero poses are pinned to coordinates in the hand-in of the stage that first draws them. Starting points (ESTIMATES from general knowledge): Tunnel View (about 37.716 N, 119.677 W) looking east; El Capitan's meadow at 300 m; Glacier Point (about 37.728 N, 119.574 W) looking at Half Dome; Kleine Scheidegg (about 46.585 N, 7.961 E) looking at the Eiger; Lauterbrunnen's floor looking up the valley; the head of the fiord looking at Mitre Peak; Dale Point (44.599 S, 167.819 E, MEASURED) looking in from the sea.
- **A swatch page** before any of it ships: each place's ladder as flat tiles and as a small drawn scene, with the measured numbers. It also shows the two things the studio did not pick, so the producer can overrule: a bolder blue-green for conifers, and a rose-grey bark.

---

## 8. The data

Only sources a checker passed. Sizes are bytes of the whole file. "Window" means reading only the box out of a file by byte range; range reads were MEASURED to work on WorldCover, ETH, Meta, GLO-30, GLAD and the Swiss rasters. Window sizes are ESTIMATES, and the whole-file size is the most a download can be.

`DOWNLOADS-WILD.md` holds the same files in the groups the producer says yes to.

### 8.1 What each thing is for

| Need | Source | Exact location | Size, and how measured | Licence, and the credit it asks for |
|---|---|---|---|---|
| The world's natural regions (picks the kit, once for the world) | RESOLVE Ecoregions 2017 | https://storage.googleapis.com/teow2016/Ecoregions2017.zip | 149,248,653 B, MEASURED (HEAD) | CC BY 4.0 on the provider's own page, ecoregions.appspot.com. Cite Dinerstein et al. 2017, BioScience, doi:10.1093/biosci/bix014 |
| The world's rock types (the rock look's fallback and tone; its cells are about 55 km wide) | GLiM, 0.5 degree grid: `hartmann-moosdorf_2012.zip` | https://epic.awi.de/id/eprint/31092/1/hartmann-moosdorf_2012.zip, which is where the "Download dataset" link on https://doi.pangaea.de/10.1594/PANGAEA.788537 leads | 38,670 B, MEASURED once (HEAD, following that link). The page says 37.8 kB | CC BY 3.0. Cite the dataset as its page asks |
| The world's leaf type (needle or broad, evergreen or not) | Copernicus Global Land Cover 100 m, 2019, Forest-Type layer | https://zenodo.org/records/3939050/files/PROBAV_LC100_global_v3.0.1_2019-nrt_Forest-Type-layer_EPSG-4326.tif | 1,037,889,222 B, MEASURED (HEAD). Range reads unproven on that host: plan on the whole file | CC BY 4.0 on the record. Credit Copernicus Global Land Service |
| Land class, 10 m (where woody plants, grass, rock, snow and water are) | ESA WorldCover 2021 v200 | https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{TILE}_Map.tif, tiles N36W120, N45E006, S45E165, S45E168. For the land past the boxes: N36W123 (west of 120 W) and S48E165, S48E168 (south of 45 S), as windows | 115,482,414 / 106,497,465 / 3,942,930 / 39,085,211 B, MEASURED (HEAD). The three for the land past the boxes: 87,597,650 / 13,008,940 / 29,329,101 B, MEASURED once (HEAD) | CC BY 4.0. "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium" |
| Canopy height, 10 m (forest or scrub; each tree's size) | ETH Global Canopy Height 2020 | https://libdrive.ethz.ch/index.php/s/cO8or7iOe5dT2Rt/download?path=%2F3deg_cogs&files=ETH_GlobalCanopyHeight_10m_2020_{TILE}_Map.tif, tiles N36W120, N36W123, N45E006, S45E165, S45E168 | 217,841,624 / 280,186,365 / 407,025,206 / 16,467,214 / 177,113,903 B, MEASURED (HEAD) | CC BY 4.0, "without restriction of use". Cite Lang, Jetz, Schindler and Wegner 2023 and the dataset, doi 10.3929/ethz-b-000609802 |
| Canopy height, 1 m, small windows only (grades the 10 m map; counts real crowns). Never shipped | Meta and WRI canopy height v2 | https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/{TILE}.tif, tiles 0230102033 (Tam and Muir), 0230103033 (the Valley), 0230103211 (the grove), 1202212112 (Lauterbrunnen), 3131013321 (Milford) | 109,561,571 / 378,161,518 / 455,822,935 / 189,228,980 / 150,554,309 B, MEASURED (bucket listing). Windows 2-8 MB each, ESTIMATE | CC BY 4.0. "Meta and World Resources Institute (WRI) - 2026" and "Source imagery for CHM © 2016 Vantor" |
| Forest height, 30 m, one window (a third opinion on forest or scrub) | GLAD Forest height 2020 | https://gladxfer.umd.edu/users/Potapov/GLCLUC2020/Forest_height_2020/2020_40N_130W.tif | 73,133,489 B, MEASURED (HEAD). Window 1-3 MB, ESTIMATE | CC BY. Cite Potapov et al. 2022, doi 10.3389/frsen.2022.856903 |
| The world's 30 m terrain over each box: the test of how wrong it is on walls, and the base around the Jungfrau and Milford boxes | Copernicus DEM GLO-30 | https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{TILE}_DEM/Copernicus_DSM_COG_10_{TILE}_DEM.tif, tiles N37_00_W120_00, N46_00_E007_00, N46_00_E008_00, S45_00_E167_00, S45_00_E168_00 | 41,541,372 / 41,776,750 / 42,038,015 / 12,478,395 / 41,392,956 B, MEASURED (HEAD) | as the next row |
| The same model for the land past each box (section 2.1), as windows where range reads allow | The same, the tiles next to those | The same pattern. Yosemite: N38_00_W120_00 (stage 1); N37_00_W121_00, N38_00_W121_00, N37_00_W119_00, N38_00_W119_00 (stage 4). Jungfrau: N47_00_E007_00, N47_00_E008_00, N45_00_E007_00, N45_00_E008_00. Milford: S46_00_E167_00, S46_00_E168_00 | 39,506,663 B; 45,213,310 / 42,882,578 / 39,450,870 / 38,553,765 B; 42,939,950 / 41,746,914 / 42,594,792 / 43,016,696 B; 42,090,589 / 42,552,698 B. All MEASURED once (HEAD), in this plan's revision | The Copernicus DEM licence: free, world-wide, no share-alike. It asks for this notice, word for word: "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved", plus its no-liability sentence. These duties pass on to anyone who takes the data from the public repo |
| What the 30 m model edited and filled on each wall | The same tiles' edit, fill and water masks, and the small file naming each fill's source | The same bucket, each tile's auxiliary folder | Masks 1,553,722 / 2,516,448 / 2,897,091 / 1,244,894 / 2,793,651 B a tile in the order above, MEASURED (listing). The source file is 35-82 kB a tile, MEASURED (listing) | As above |
| Yosemite's ground at 10 m, bare earth | USGS 3DEP 1/3 arc-second | https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n38w120/USGS_13_n38w120.tif | 451,129,925 B, MEASURED (HEAD). Taken whole: it is barely compressed | US public domain. Credit "U.S. Geological Survey", and say what was changed |
| Yosemite's walls at 1 m | USGS 3DEP 1 m, survey CA_YosemiteNP_2019_D19, six tiles x26y418, x26y419, x27y418, x27y419, x28y418, x28y419 | https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/CA_YosemiteNP_2019_D19/TIFF/USGS_1M_11_{TILE}_CA_YosemiteNP_2019_D19.tif | 1,681,941,033 B in all, MEASURED (listing) | US public domain, as above |
| Yosemite's answer key (scores the rule). Never shipped | The park's vegetation map, the state's copy (CDFW ds200), by a box query | https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds200_fpu/FeatureServer/0 | Not measurable. 3,037 polygons touch the Valley box, MEASURED (count query). Under 10 MB, ESTIMATE | CC BY (data.gov's record). Credit the California Department of Fish and Wildlife |
| Where "only where recorded" trees stand; the presence and coverage checks | GBIF plant records, CC0 and CC BY only, as counts from the search service | https://api.gbif.org/v1/occurrence/search with license=CC0_1_0 and license=CC_BY_4_0 | A few hundred small answers, under 1 MB, ESTIMATE. No account is needed for counts | CC0 or CC BY 4.0 per record. Cite GBIF with the date. A full download would need an account and gives a DOI to cite |
| The Jungfrau region's ground at 2 m | swisstopo swissALTI3D, 1,092 one-kilometre tiles, the newest year of each | https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items?bbox=7.80,46.38,8.15,46.72 | 1,239.2 MB, MEASURED (every tile HEAD-requested, twice). Known to 0.1 MB: the byte count was not kept | "Open use. Must provide the source": commercial use allowed, not share-alike. "© swisstopo" in the list of sources. Custom terms, not Creative Commons: a short review before it ships |
| The Swiss answer keys (tree line, fir, leaf type, ice). Never shipped | Upper timberline; silver fir areas; forest mix rate; Swiss Glacier Inventory 2016 | https://data.geo.admin.ch/ch.bafu.wald-obere_waldgrenze/wald-obere_waldgrenze/wald-obere_waldgrenze_2056.tif ; https://data.geo.admin.ch/ch.bafu.wald-tannenareale/wald-tannenareale/wald-tannenareale_2056.gpkg ; https://data.geo.admin.ch/ch.bafu.landesforstinventar-waldmischungsgrad/landesforstinventar-waldmischungsgrad/landesforstinventar-waldmischungsgrad_2056.tif ; https://doi.glamos.ch/data/inventory/inventory_sgi2016_r2020.zip | 2,906,986 / 638,976 / 170,912,760 / 9,787,779 B, MEASURED (HEAD). The mix map as a window is about 4 MB, ESTIMATE | Open use; open use; open use with the source given (author, title and link); CC BY 4.0, cite Linsbauer et al. 2021. The checkers disagree on the mix map: one read "Open use. Must provide the source" in its own record, another saw only the word "proprietary" in the catalogue. It is an answer key only |
| Milford's ground at 8 m, the whole box | LINZ NZ 8 m model, sheets CA08, CA09, CB08, CB09, and CB07 for the widened corner | https://nz-elevation.s3.ap-southeast-2.amazonaws.com/new-zealand/new-zealand-contour/dem_8m/2193/{SHEET}.tiff | 108,423,247 B for the four, 20,728,106 B for CB07, MEASURED (listing) | CC BY 4.0. "Sourced from the LINZ Data Service and licensed for reuse under CC BY 4.0" |
| Milford's ground at 1 m, the fiord's head, Bowen Falls, the road, the tunnel | Southland lidar ground model, tiles CB08_10000_0104, 0105, 0204, 0205, 0304, 0305 and CB09_10000_0201, 0301, 0302 | https://nz-elevation.s3.ap-southeast-2.amazonaws.com/southland/southland_2020-2023/dem_1m/2193/{TILE}.tiff | 321,440,637 B, MEASURED (listing) | CC BY 4.0. Name LINZ, Aerial Surveys and Environment Southland |
| Milford's true canopy height (measures how far the radar sinks into forest: a world rule) | Southland lidar surface model, the same nine tiles | The same path with dsm_1m | 342,795,933 B, MEASURED (listing) | CC BY 4.0, as above |
| Waterfall names and heights, world-wide | Wikidata query | https://query.wikidata.org | Not measurable. 1-2 MB, ESTIMATE | CC0 |
| Rivers, waterfall points, roads and building footprints for the three boxes (the falls, the `CLEAR` mask, villages as blocks) | Overture release 2026-10-21.0, the release the Bay Area's archive holds. Each box is cut out of three type folders as row-group pieces, the way the Bay Area's was | https://overturemaps-us-west-2.s3.amazonaws.com/release/2026-10-21.0/ then `theme=base/type=water/`, `theme=transportation/type=segment/` and `theme=buildings/type=building/` | The whole folders are 28,818,195,515 B (32 files), 72,471,701,936 B (128 files) and 276,943,764,116 B (512 files), MEASURED once (bucket listing). A box's cut cannot be measured before it is read. About 15 to 60 MB a box, ESTIMATE from the Bay Area's measured pieces of 2 to 5 MB each. **The run stops and asks if a box passes 100 MB** | **ODbL: credit, and share-alike on the database.** Everything made from it is kept in the `built` file family, never in `surface` or `relief` |

Already held, so not asked for again: the Bay Area's terrain, land class and OpenStreetMap layers, archived for the surround.

### 8.2 Left out, and why

| Data | Why not |
|---|---|
| FABDEM; the California Forest Observatory; NZ Basic Ecosystems; NIWA's sea-floor grid; every CC BY-NC plant record (all of iNaturalist) | Non-commercial. Forbidden |
| ESA CCI land cover | Its grant covers only education and science. Forbidden |
| NZ EcoSat Forests, Potential Vegetation, the Vegetative Cover Map | Their licence forbids passing on anything made from them. Forbidden |
| Swiss land use statistics | Commercial use needs the owner's permission |
| **NZ 10 m land cover 2023/24** | **CC BY-SA 4.0: share-alike. Not used. It would need a review before it could ship** |
| **OpenStreetMap scrub tags as an input to the forest-or-scrub decision** | **A share-alike risk: it could put the land-class layer under ODbL. Dropped from the rule. They only score the rule and never ship** |
| The park service's own copy of the vegetation map; its meadow map | No licence stated |
| LANDFIRE; USFS TreeMap | Fine by licence, but the small clip needs an email address and the whole files are 3.8 to 9.2 GB each; TreeMap's size could not be measured |
| The lidar point cloud | About 110 GB for the Valley |
| NZ land cover database (LCDB); LINZ chart depths and waterfall points | Each needs an account only the producer can make. The lidar pair does the job |
| RGI glacier outlines; Mapterhorn's mosaic; the NZ ice polygons | Licence unclear |
| swissBUILDINGS3D (148.8 MB for the box, MEASURED; open terms, not share-alike) | A Swiss-only source for villages. Overture does it for every place. Kept in mind for the licence review |
| swissTLM3D, the Swiss belts map, the Swiss canopy map | Optional keys, 143 MB to 2.9 GB |

### 8.3 Where the files live

- Downloads go to the studio's data archive, outside the repo.
- Baked wild tiles are about 60 to 80 MB a place (ESTIMATE). That is too much for the repo. They are served from Cloudflare R2, which the producer approved for the planet layer on 2026-11-04 (`LIVING.md`), from stage 4. Stages 1 to 3 are small enough to ship like a city (20-40 MB, ESTIMATE; the bake reports the bytes before anything is pushed).
- Every credit line above goes into the game's data licence file and the credits screen in the same commit as the baked files.

---

## 9. The stages

Each ends with a preview link the producer flies on a phone, and one or two things to look for. Each gets a code review from someone other than its builder before it merges. An agent-day is one AI worker's day of work. Agent-days are ESTIMATES, as the plans here use them.

**Before or beside it: the Bay Area's surround** (4.5 to 6.5 agent-days by its own plan, not counted here). It gives the planet tile container and the one class table. Stages 1 to 3 do not wait for it. Stage 4 does.

### 9.1 The eight stages

| # | Stage | The producer flies | Agent-days | Waits on |
|---|---|---|---|---|
| 1 | **Yosemite: the first look.** The Valley as a map with no buildings, on today's bake, from the 10 m ground. Rock that reads as rock. The nose-led climb, proven in a simulation first. The far formats' height fix. The horizon reading the world's model past the tile's edge. Water at its own height. The sea-level half day. Trees are stand-ins from today's four shapes, at heights from the canopy map | Start in the Valley. Fly at El Capitan and climb it nose-up. Tunnel View. Glacier Point. The ceiling. **Look for:** do the walls read as walls at 300 m? Expect the right shape with soft rims and no ledges: the studio expects to need stage 4's sharp ground | 6-8 | Download group 1. The new handling merged, or an agreement with it on the flight file. If neither, this stage waits |
| 2 | **Yosemite: the right kinds of trees, and the rule proven.** The kit table (the Sierra's kit, the two Bay kits, the 14 plain kits). The rule in the bake, without its leaf-type step, graded at Tamalpais and Muir Woods with the pass marks of section 4.2. Five Sierra shapes through the four small tree changes. Scrub by height. Trees on walls. Far forest as tone on lifted relief. The swatch page. The forest budget page, with the canopy shell on it | The same link: cedar columns, open pines, oak domes, fir cones, scrub on the hot slopes. "Is that Yosemite?" Then two pages: the swatches, and a made-up forest with the frame counter on an iPhone 13 | 6.5-9.5 | Stage 1 flown. Group 2. An iPhone 13 |
| 3 | **Yosemite: the walls from afar, and flying among them.** The far ground meshed to an error budget. The value-ladder check. Valley shadows from the sun sweep. Following slopes down. The highest-point pyramid, the swept check, the camera out of rock, shots that land on the face. The splat measured in 3D | Tunnel View: El Capitan and Half Dome in true outline, pale over dark, the floor in shadow at a low sun. Off the rim and down into the Valley without a dive. A Jet run at a wall. A splat on El Capitan | 7-10 | Stage 2. The new handling merged or frozen |
| 4 | **Yosemite: the walls up close.** The 1 m ground on steep tiles. The place moved into planet tiles: the streamer, the mesh, game tiles made on the phone. Rock streaks, joints and ledges from the side, by the wall's own shape. Crisp rims. The wider ring of land past the tile. Milford's half-day strip test runs here too, so its answer is known early | El Capitan's meadow at 300 m: the Nose's edge, ledges, streaks. Half Dome's face up close. Climb a wall a few metres off the rock | 6.5-9.5 | Stage 3. Group 3, and the small strip-test part of group 7. The surround's container, renamed. R2 opened |
| 5 | **Yosemite: the forest at its true size, and the grove.** The grower and its obstacles. The new tree template. The rest of the Sierra's shapes, the sugar and gray pines among them, and the giant. Real trees, one-solid trees and the shell, with per-tree hand-over. Real crown counts. The near paint grid, so a painted forest stays painted. The Mariposa Grove by plant records | The Valley floor at tree-top height: small trees, a huge wall. Skim the crowns. The rim: dark spires. The grove: giants on pale trunks. From 300 m: no line where trees stop. A link at the half-way mark shows the Valley floor grown, before the shell and the grove | 12-17.5 | Stage 4. The budget page's answer. Group 4 |
| 6 | **Yosemite: paint it.** The paint record's coarse levels. Side masks for walls and the ring on steep faces. Far forest and far walls showing paint. Waterfalls | Paint El Capitan's face. Paint a square kilometre of forest, climb to the ceiling and see it. Fly up Yosemite Falls | 8-11, and 3-4 more if the world paint raster is not there yet | Stage 5. The far-field plan's paint raster, or it is built here |
| 7 | **The Jungfrau region.** The box from 1,092 tiles. Ice, ledge snow, banded rock. The Alps' kit and four new shapes, with the leaf-type map. Every height the flight reads checked above 3,277 m. Villages as blocks and tone. The falls | Over the ridge at the Eiger. Down Lauterbrunnen between the walls. Down the Aletsch from the top. Paint the glacier | 7.5-11 | Stage 6. Groups 5 and 6. A short read of swisstopo's terms |
| 8 | **Milford Sound.** The bake from the 8 m sheets and the lidar. Forest on walls to the tide line, and the measured tree line. Fiordland's kit, two new shapes and the tree fern. The dark mirror. The radar-depth measure from the lidar pair | In from the sea past the mouth. Low to Mitre Peak. Under Stirling Falls. Down the Cleddau from the tunnel. Paint a wall of forest | 8-11.5 | Stage 6's wall paint. Group 7 |
| | **All eight** | | **about 62-88** (65-92 with the paint raster) | |

**What is in hand if the producer stops there** (agent-days from the start; ESTIMATE):

| Stop after | Agent-days | What the game keeps |
|---|---|---|
| Stage 1 | 6-8 | Yosemite Valley to fly and paint: true shape, soft cliffs, stand-in trees. The flight can climb a wall. The height fix every high place needs |
| Stage 2 | 12.5-17.5 | The Valley with its own kinds of trees. The tree rule, tested, and a plain forest for any place on Earth. The first numbers from an iPhone 13 |
| Stage 4 | 26-37 | Cliffs sharp up close. The flight at home among walls. The first place living in planet tiles, which the planet layer needs anyway |
| Stage 6 | 46-65.5 | Yosemite whole: forest at its true size, the sequoia grove, waterfalls, paint on El Capitan and paint seen from the ceiling |
| Stage 8 | 62-88 | All three places |

**Calendar time** (ESTIMATE). It cannot be known well. Two things set it.
- Agents here have been doing several agent-days in a day (SOURCE: `LIVING.md`, "Stages"). This plan counts on two to three, because other work runs beside it and there is one weekly token budget (ESTIMATE).
- Each stage waits for one producer flight. The studio's own unit is one visible win a week (SOURCE: `VERDICT.md`, section 9).

So: a first flight over Yosemite one to two weeks after the yes. Yosemite with its own trees in about two to three weeks, which is the nearest thing to what we first promised. Yosemite whole in about six to nine weeks. All three places in about two to three months: eight flights, nine with stage 5's half-way link. Faster flights shorten it; a late merge of the new handling or of the surround lengthens it.

**What waits for it.** This is new work on top of what is already queued: the new handling, the Bay Area's surround, the living Earth's first stage, the Moon's free flight. The wild stages stand on the first two (stage 1 on the handling, stage 4 on the surround), so those go first whatever is chosen. The rest share the same agents and budget, so each wild stage is a stage's worth of time taken from them. Which waits is call 3 in section 12.

### 9.2 Where the estimate comes from

- The terrain research counted 18-25.5 agent-days and its checker 19-27, plus 3-4 for waterfalls.
- The forest research counted 19-27 (22-31 with the paint raster), and its checker added 3-6 for what it missed.
- The kits, the data rule and the second and third places come on top.
- The three designs counted 59.5-84 (the one this plan builds on), 45-63 (judged optimistic) and 28-38.5 (it builds much less).
- This plan adds the first look, the grove and the phone-made tiles to the first of those, and takes the far "crown cells" out.
- About 12 to 16 of the days are planet-layer work that was owed anyway: the streamer, the mesh, the flight's pyramid, the paint raster, the sun sweep.

**There is no honest three-week version of "three places".** The nearest thing is stages 1 and 2: Yosemite Valley with its right kinds of trees, on today's tiles, with no paint on sheer walls. That is 12.5 to 17.5 agent-days, about two to three weeks on the calendar (ESTIMATE, section 9.1).

### 9.3 Priced extras, for the producer to pick after flying

| Extra | Buys | Agent-days (ESTIMATE) | Extra download |
|---|---|---|---|
| Crowns as a grain past a kilometre ("crown cells") | From 300 m up, forest keeps a grain of crowns out to about 4 km. Unproven on walls and at grazing angles: it gets its own phone test first | 4-5 | none |
| Seasons from the real date | Pale autumn, bare silver-grey winter, a snow line, falls by the month. Never gold. One swatch sitting first | 3-5 | none |
| The Matterhorn, a fourth place | Zermatt, with the Italian side from a second source | 3-4 | about 558 MB of Swiss 2 m ground (MEASURED), plus a window for the Italian side |
| Overhangs | Rock pieces and cliff sheets for El Capitan's roofs | 3-5 each | none |
| The Tuolumne and Merced groves on fine ground | Two more sequoia groves, if the records place them | 1-2 | 380,736,782 B (MEASURED) |
| Chalets | With the any-city work | not priced here | - |

---

## 10. Risks, biggest first

1. **The A15 has never measured this game.** Carved crowns in layers may cost far more than every count here says. The budget page in stage 2 is the guard, and the shell is the design's answer. If no iPhone 13 is in hand, every budget stays a guess, and a pass on a newer phone proves little.
2. **Does a wall from 10 m data read as a wall at 300 m?** Stage 1 answers it in 6 to 8 agent-days, before the 1.68 GB of lidar is asked for. The research says a wall wants 1 to 4 m there, so the studio expects to need the lidar.
3. **Mitre Peak has no lidar.** Its 8 m model is drawn from 20 m contour lines and is good to about 22 m sideways. Its maker says it suits map pictures only, not terrain analysis. That is a warning about accuracy, not a licence term: the licence is CC BY 4.0 and a checker read it in the collection's own record. It may look no better than the world's 30 m model. The strip test runs early, in stage 4. Milford's most famous shape may ship softer than El Capitan.
4. **The forest-or-scrub bar is a guess** until stage 2 runs. If no world-wide height map passes the marks, the rule needs the 1 m map near the bus, and downloads grow by 1 to 3 GB a place (ESTIMATE).
5. **The canopy shell is a design, not a test.** If it swells at speed or fails on walls, the far forest falls back to plain tone on lifted relief, which stage 2 already draws.
6. **The canopy map** goes blind above about 40-45 m, is from 2020, and its accuracy on shaded fiord walls is unknown.
7. **The tree line measured from data** may still sit wrong where rock rules the view. Each kit keeps a written fallback.
8. **Sequoias by plant records** follow where people walk. A grove nobody recorded gets none.
9. **Game tiles made on the phone** touch the flight, paint and the obstacle field. Not every caller of today's tiles has been read. Stage 4 starts with that reading, and has a fallback.
10. **The paint raster is not built**, and wall paint is new. Both sit on the path to stage 6, the stage that matters most.
11. **The flight** shares a file with the new handling, and its feel can only be judged on the phone.
12. **The wall sharpens as you approach.** On a cliff the swap from far mesh to near mesh can move the surface by metres. At Jet it may read as a pop.
13. **One ramp for every forest** may read as too even across a whole frame. The swatch page shows the bolder option.
14. **Data years differ**, and Yosemite burns. A slope can be forest in one layer and bare in another.
15. **The Merced River** may come out in pieces: it is 10 to 30 m wide and the land map's cells are 10 m. If so, a river line is a small extra download.
16. **Overture's clock.** Overture deletes a release about 60 days after it is out, and 2026-12-16 is a breaking release (SOURCE: `LIVING.md`). The Bay Area's archive holds release 2026-10-21.0, so that release is gone by about 2026-12-20 (ESTIMATE), before stage 5 is likely to start. The studio's pick is to cut all three boxes out of it early, in one ask (section 12, call 5). Otherwise each box is cut from whatever release is current when its group is OK'd, and the three places read different releases.
17. **Licences passed on.** The Copernicus notice and the ODbL file must travel with the public repo. swisstopo's terms are custom. Each deserves a short review before it ships. The credits screen grows by about ten lines.
18. **Downloads are slow where the bakes run.** Downloads from Amazon's storage were once measured there at 28 to 92 KB/s (SOURCE: `LIVING.md`). At that rate the first group takes 3 to 10 hours and the lidar 5 to 17 (ESTIMATE). Memory there is small, so bakes run in strips, one place at a time.
19. **Depth.** Walls 20 to 30 km off against a 1.5 m near plane: unmeasured.
20. **Eight stages, eight flights.** The producer's time is the real schedule.

---

## 11. Not confirmed

- **Any phone or GPU number.** Nothing has run.
- **Whether the iPhone 13 has been bought.** `LIVING.md` has it approved to buy.
- **Whether the US survey's 10 m and 1 m files can be read in parts.** It decides whether Yosemite's ground is 2.1 GB or well under 1 GB.
- **Every window size.** Whole-file sizes are measured; windows are estimates.
- **The sizes of** the state's vegetation-map query, the Overture and OpenStreetMap extracts, the Wikidata list and the GBIF answers.
- **The exact folder of the small fill-source file** beside each GLO-30 tile. It was seen in the bucket listing; its path is read from the listing when the group is fetched.
- **Whether sheet CB07 is needed** for Milford's widened corner. The four sheets' west edge at 44.84 S is about 167.69 E (ESTIMATE from one sheet's measured, tilted edge).
- **Where data stops inside each Milford lidar tile.**
- **How WorldCover classes** granite walls, shaded fiord walls, green alder, dwarf pine and larch pasture.
- **Region 423's id**, and which regions the Merced canyon's foothills fall in. Both are read from the regions file once it is held.
- **Whether open plant records hold enough sequoias** at the Tuolumne and Merced groves.
- **The streamside row of the Sierra kit** has no source yet.
- **The depth of Milford's scrub band**, the Jungfrau north side's tree line (partly an estimate) and mature heights for several Alpine trees (one source each).
- **The 10 m canopy map's size for the whole world**, for the planet bake later.
- **How today's ground paint binds to the ground it is drawn on**, and so how much of stage 4 is new.
- **The Copernicus licence's no-liability sentence**: the wording is taken from the licence document when the credits are written.
- **The 1 m canopy map's credit line.** One checker read "© 2016 Maxar" and another "© 2016 Vantor" (the same company under its new name). The wording is taken from the dataset's own page when the credits are written. That map is never shipped.
- **US river lines from the US survey (public domain)** as a non-share-alike choice beside OpenStreetMap: a lead, not checked.
- **Calendar time.** Section 9.1's weeks are a guess from two rates, not a schedule.
- **Whether today's baked tree paint outlives its tile being unloaded.** Not read. Stage 5's near paint grid covers grown trees either way.
- **What the world rock grid says in each box's cell.** Read once the table is held.
- **Whether Overture's release carries waterfall points**, and how big each box's cut is.
- **Whether open plant records hold enough dwarf pine** in the Jungfrau box to switch its row on.
- **The sizes measured in this revision** (the neighbouring world-model tiles, three land-class tiles, the rock table, Overture's folders) were measured once. They came from about twenty header-only requests and four bucket listings, plus two documentation pages. No data was read.
- **A flag for the producer.** One checker ran 41 point-height queries and one profile query against the US and Swiss survey services to measure the walls. They are answers from a query service, not files. Whether they count as downloads is call 4 in section 12.

---

## 12. The producer's calls, each with the studio's pick

Only the first four are asked now. The rest come when their stage does, so the producer never faces the whole list at once.

**Now**

1. **Start Yosemite, and fetch the first download group?** The work is about 62 to 88 agent-days for three places with paint: about two to three months, not the two to three weeks we said. The producer can stop after any stage. The first flight has stand-in trees and may have soft cliffs. The download is six files, 973 MB at most, each named with its source and size in `DOWNLOADS-WILD.md`, group 1. **Pick: yes.** Every later group is asked for by itself when its stage comes.
2. **The iPhone 13.** `LIVING.md` has it approved to buy. Whether it has been bought is not known here. **Pick: in hand before stage 2's budget page.** Every budget here rests on it.
3. **What waits.** The new handling and the Bay Area's surround go first either way: the wild stages stand on them. After those, wild work shares agents and the weekly budget with the living Earth's first stage and the Moon's free flight. **Pick: Yosemite's stages 1 and 2 run next, and the producer says which of the others waits for them.**
4. **Do height queries count as downloads?** A checker asked two survey services for 41 point heights and one profile, to measure the walls. **Pick: no, they are answers and not files. If the producer says they do count, none is made again without a yes.**

**At stage 1's flight**

5. **The open-map cut-outs, early.** Roads, rivers and footprints for all three boxes come from an Overture release that is deleted about 2026-12-20. **Pick: OK the three cuts in one ask** (about 15 to 60 MB a box, ESTIMATE; share-alike on the database; kept in their own file family). Download group 2 is asked for at the same flight.
6. **Climbing a wall.** The bus pitches up as far as the wall needs, up to the 85 degrees the nose allows, so at Cruise it can climb El Capitan's face; or it never climbs steeper than about 35 degrees. **Pick: up to 85, tuned on the phone.**
7. **A world table of tree kits, and a table of each country's best free terrain.** Are these "hand-made" under the scale rule? **Pick: allowed.** Both are keyed by world-wide data, neither names a place, and scripts check every row.

**At stage 2's flight**

8. **Forest colour.** One green-grey ramp, with forests told apart by value and shape; or a new, bolder blue-green for conifers. **Pick: the one ramp. See the swatch page first.**
9. **Sequoia bark.** The existing pale stone ramp; a new rose-grey; or plain grey. **Pick: stone.**
10. **Getting down.** The bus follows slopes down by itself up to about 35-40 degrees and cliffs need a dive; or it only ever dives. **Pick: slopes yes, cliffs by a dive.**
11. **Paint on sheer faces until stage 6** is a patch that stretches down the wall. **Pick: accept it for those stages.**

**Before stage 4**

12. **Where wild tiles are served from.** **Pick: Cloudflare R2, from stage 4.** It is already approved for the planet layer; the producer opens the account.

**Around stage 5**

13. **Real crown counts and true tree sizes**, from stage 5: three to eight times today's trees, each smaller. Until then, a third to a half of the real count with wider crowns. **Pick: yes to both.** True sizes are what make a wall look its size.
14. **Crowns as a grain past a kilometre**, and the other priced extras of section 9.3. **Pick: decide after flying stage 5.**

**Before stage 6**

15. **Waterfalls.** Always running, or dry by the real date. **Pick: always running.** And may a painted fall run in the painter's colour? **Pick: yes.** It would be the one water that takes paint.
16. **Seasons.** **Pick: none in the first version; summer crowns all year.** Larch gold never comes back as gold, with or without seasons, and paint gives a faction's colour.

**Before stage 7**

17. **The order after Yosemite.** The Jungfrau region, then Milford Sound; or Milford first. **Pick: the Jungfrau region, then Milford.** Milford's most famous shape rests on the weakest ground data, so it should not be the second impression; its test runs early so there is no surprise.
18. **Which Alps.** **Pick: the Jungfrau region now, the Matterhorn later.**
19. **Villages.** Plain blocks and tone at first, from Overture's footprints (share-alike on the database, kept in its own file like every city's). **Pick: yes.**
20. **Milford's box widened** to take in Sutherland Falls and Lake Quill. **Pick: yes.**
21. **Milford with no weather.** The rain waterfalls and the mist are what many people remember. **Pick: keep weather on hold; ship dry-day Milford with its three great falls.**
22. **Accounts.** None is needed. **Pick: skip the New Zealand and US services that want one.**

Two studio ideas for later, the producer's to like or not: a painted waterfall that runs in the painter's colour (call 15), and paint on a wall that slowly runs down it.

---

## 13. How this plan was chosen

Three designs were written from the same research: an art-first one, a systems-first one and a lean one. Three judges scored them. All three picked the art-first design. This plan is that design, with the pieces the judges named from the other two, and with the faults they found fixed. Two critics then read the plan, and it was revised.

**Kept from the art-first design:** trees at true size and count as the ruler; the value ladders and their script; the far ground built for the first picture from Tunnel View; no new ramp; the kit casts with the checkers' fixes; waterfalls as the brightest unpainted thing; the honest estimate.

**Taken from the lean design:** the first look on today's bake; the small first download; the density dial; water at its own height; the sea-level half day; the bake that stops at a height cap; the climb up to 85 degrees; the priced extras; two risks (Overture's clock, the river in pieces).

**Taken from the systems design:** the canopy shell before any far crowns; the 14 plain kits; the tree line as a climate signal; the `CLEAR` mask in the `built` family; game tiles made on the phone; the `KIT` plane as a number pointing at a mix; R2; the leaf-type file held until the Jungfrau stage; the pass marks set before the run; the container's new name.

**Where the judges disagreed, and what was decided:**
- *Game tiles made on the phone.* Two judges for; one called it the riskiest piece on the path to the first low flight. Decided: for, but only in stage 4, after three low flights on today's tiles, and with a fallback.
- *Far crowns.* Two judges: shell first, crown cells later with their own test. One: test both on the budget page. Decided: shell first. A fair test of crown cells means writing most of them, four or five days, before anything else flies.
- *The sequoia grove.* One judge moved it into Yosemite's trees stage; one noted its 1 m canopy tile is not needed early. Decided: the grove is in stage 5, placed by record counts that need no account; its 1 m window is optional.
- *The order of places.* The designs split. Decided: the Jungfrau region before Milford, with Milford's ground test run early (call 17).
- *Accounts.* One design asked for two. Decided: none.

**Where the checkers changed the research.** Each fix is in the section it belongs to. The ones that moved the plan most: nothing fits two to three weeks; height cannot find a sequoia; the 8 m forest bar is a guess; the bus cannot get down into a valley; a fixed climb ramp breaks a ruling; the height clip is in five formats; a new tree shape is not one table row; a blue-green ramp and a rose bark ramp are not worth adding; OpenStreetMap scrub tags are a share-alike risk.

**What the two critics changed.** Each point was checked against the research and the checks before it was taken.
- *Taken:* the land past each box, which the first draft did not have (the world-model tile over Yosemite ends where the 10 m tile ends); the coarse rock grid no longer picks ledges or dwarf pine; the value-ladder check counts lightness, not step numbers; grown trees get a paint grid in stage 5; baked rivers and falls go in the `built` family, and the Overture cut-outs are named; Mitre Peak's distance; sugar pine and gray pine get their own shapes; planted trees are keyed by region; the other 65 kits are priced; the weak marks are corrected; calendar time; what is in hand at each stop; the calls split by stage; one first question; the glossary.
- *Taken in part:* "say what this pushes back". The studio cannot know the producer's order for the rest of the queue, so it is put as a call with a pick (call 3). "Move paint kept by place into stage 5": only its near level moves; the coarse levels stay in stage 6, where far forest first shows paint.
- *Not taken:* the doubt that Overture carries waterfall points at all. The checker's doubt was about Overture's buildings download. Overture's own schema lists a waterfall class in its water layer. It is still checked on the first cut, and Wikidata comes first either way. And the critic's "four files, 934 MB" for the first ask: the land past the box adds a file, so it is six files and 973 MB.

---

## 14. Words this plan leans on

- **Agent-day.** One AI worker's day of work. Several are done in one calendar day.
- **Kit.** The cast of trees that can grow in one natural region, written as a table.
- **Plain kit.** A rough stand-in kit for a whole biome, used where no named kit exists yet.
- **Shape.** One drawable kind of tree: a spire, a dome, a column. Several real trees can share one.
- **Ramp.** One of the palette's fixed runs of eight tones, dark to light. Everything unpainted is drawn from them.
- **Value step, lightness.** How dark or light a tone is. Lightness runs from 0 (black) to 1 (white).
- **Canopy shell.** The ground lifted to the height of the tree tops and toned like forest, so far forest has a body without drawing far trees.
- **Planet tile.** One square of the world's tile tree. The planet layer and each wild place are stored in them.
- **Window.** Only the wanted part of a big file, read without fetching the whole file.
- **Splat.** The patch of paint one shot leaves.
- **R2.** Cloudflare's file storage, where big baked tiles are served from.
- **Share-alike.** A licence term: a database built from the data must be shared under the same licence. ODbL is one. CC BY and public domain are not.
- **GBIF.** The world's open store of plant and animal records: who saw which species where.
- **Lidar.** Ground measured by laser from a plane, a metre or finer.
