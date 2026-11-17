# Alamo Square, all out (an experiment)

The producer, 2026-11-17, after seeing worldcraft.gg's whole-world Minecraft build ("program learning": many agents tune one set of rules against many real places, with graders): "Can we use this technique/strategy to build our world easier/better?", then "Can you be more ambitious and try is on more than just roofs? What if you go all out on a specific neighbourgood? I just want a to see a dramatic before/after comparison."

`exp/ladies`, cut from `feat/sf` 30d0925. An experiment: nothing here is for main until the producer and the studio say so.

## What it is

One neighbourhood, Alamo Square and the blocks round it (840 x 840 m of the map's frame, x -1600 to -760, z -560 to 280: 1,115 building parts), rebuilt from the USGS 3DEP LiDAR scan of San Francisco (2023, public domain), which the bake already reads for heights. The scan is the answer key: what the game draws is graded against it, cell by cell.

- **Roofs.** Every part's roof is fitted to the scan's first returns: each shape the game can draw (`roofGeom.ts`: flat, gabled, hipped, pyramid, skillion, half-hipped, saltbox, gambrel, mansard), each way it can face (the footprint's own edges), its eave and its rise, by trimmed least squares; the best that beats a flat roof clearly wins. A roof the scan calls flat is drawn flat. One it calls neither (twin ridges, a front gable on a flat back: nothing one part draws) keeps the bake's procedural gable.
- **Trees.** Every crown the scan sees outside the buildings (canopy over 3 m, opened by 1.5 m so a pole or a truck isn't one), split at its peaks, at its own height and width: a street tree up to 13 m, a eucalyptus or pine over, a cypress where it is tall and narrow.
- **The rules.** The part of worldcraft's method that scales: rules that guess a roof from the footprint and its street alone, no scan, learned on the west half of the box and graded on the east half they never saw. A city with no LiDAR gets these.

## How it is run

`tools/ladies/` (Python 3 with numpy, scipy, shapely, laspy, pyproj; `SB_LADIES` is the work folder, `shots/tmp/ladies` by default):

```bash
python3 tools/ladies/fetch_lidar.py -1600 -560 -760 280 600   # the scan for the box (382 MB of the EPT, cached), its 0.5 m rasters
mkdir -p shots/tmp/ladies/orig_city && cp public/city/sf/city.json shots/tmp/ladies/orig_city/ \
  && for r in r_-2_-1 r_-1_-1 r_-2_0 r_-1_0; do git show feat/sf:public/city/sf/$r.bin > shots/tmp/ladies/orig_city/$r.bin; done
python3 tools/ladies/fit.py          # every part's roof fitted (fits.pkl)
python3 tools/ladies/trees.py        # the crowns (trees.pkl)
python3 tools/ladies/dataset.py      # the answer key for the rules (dataset.pkl)
python3 tools/ladies/apply.py public/city/sf                 # the four regions rewritten: the LiDAR roofs and trees
python3 tools/ladies/grade.py <rule>.py [--split test]       # a rule's score against the scan
node tools/ladies/shots.mjs <url> <outdir>                    # the four posed views
```

## What ran

`score.py` against the scan, over the box (1,111 parts graded; trees 6 m inside its edge):

| | Today (`feat/sf`) | Rebuilt |
|---|---|---|
| Trees | 395 | 2,574 |
| The scan's canopy (over 3 m, outside buildings) under a game crown | 9 % | 82 % |
| Game crowns over no canopy | 56 % | 24 % |
| Pitched roofs | 8 | 302 |
| Roof error (root mean square, each residual capped at 1.5 m) | 0.66 m | 0.56 m |

The fit, before the limits that went in after the first shots: 339 pitched, some of them a taller neighbour's wall read as a roof (a 22 m mansard, 13 m lean-tos). Now a pitched fit must explain the part's returns to 0.8 m^2 (mean capped square), rise at most 9 m, a face at most 50 degrees (a lean-to's 24). 810 parts fit flat; 357 of those fit it to 0.12 m^2 and are drawn flat (the bake's procedural front gable off); the rest (twin ridges, an M roof, a gable on a flat back) keep the bake's roof.

Trees: 2,719 crowns found in the box, 2,574 planted (6 m inside its edge); heights 5.4 / 9.7 / 15.8 m (10th / 50th / 90th percentile), crown radii 1.6 / 3.1 / 5.3 m. The game's crowns are wider for their height than the scan's, so a tree's size is the mean (geometric) of the size its height asks and the size its width asks. Kinds: 2,148 street trees, 467 eucalyptus or pine, 303 cypress, in the 25 tiles round the box (with the trees outside the box).

The frames (`tools/ladies/shots.mjs`, the machine's Chromium, no GPU: each frame several minutes; draws and triangles from the game's own counter, `perf.snapshot()`):

| View | Today: draws, triangles | Rebuilt |
|---|---|---|
| postcard (the Ladies from the park) | 136, 942,079 | 177, 950,434 |
| rooftops (170 m up, south-west of the park) | 191, 1,007,137 | 193, 1,034,068 |
| overhead (300 m, east of the park) | 151, 1,111,967 | 192, 1,164,661 |
| postcard, painted | 138, 935,938 | 185, 997,450 |
| overhead, painted | 153, 1,113,135 | 199, 1,203,407 |

About 40 more draws over the box, near the top of the 120-200 budget. Not the trees' count: trees are one instanced draw a tile (`Props.ts`), and every one of the 25 tiles had trees before. Most likely the new pitched roofs (302 where there were 8), whose cost in draws the mesher and the renderer know: the first account's to read. Not measured on an A15.

Not checked: a flight through the box end to end (the frames are fixed poses); the obstacle grid (raised where a ridge rose, roof + 3 m as the bake) against the bus at speed; Safari.
