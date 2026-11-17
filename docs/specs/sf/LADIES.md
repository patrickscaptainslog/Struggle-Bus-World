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

(numbers below)
