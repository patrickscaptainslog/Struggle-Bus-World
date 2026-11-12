# Downloads for the wild test places: the list to say yes to

Written 2026-11-12, beside `WILD.md`. **Nothing here has been fetched. Nothing is fetched before the producer says yes, group by group.**

- Seven groups, in the order the stages need them. **The first ask is group 1 alone**, together with the go-ahead for Yosemite (`WILD.md`, section 12, call 1). Each later group is asked for by itself when its stage comes.
- Only data the checkers passed: public domain, CC0, CC BY, or open terms that allow a commercial public product. Nothing non-commercial. Nothing CC BY-SA.
- **One share-alike flag:** the OpenStreetMap-family cut-outs in groups 4, 6 and 7 are ODbL (share-alike on the database). They and everything baked from them (the tree-free mask, rivers, waterfalls, village blocks) stay in their own file family and never mix into the terrain or land files. They get a licence review before they ship.

**The marks.**
- **MEASURED**: a researcher listed or HEAD-requested the file and a second checker measured it again. Sizes matched to the byte.
- **MEASURED once**: one person measured it, in this list's revision, and nobody has repeated it yet.
- **SOURCE**: a page says so.
- **ESTIMATE**: ours, with what it rests on.

**"Whole" and "window".** Whole is the full file, and is the most a download can be. A window is only the wanted part, read out of the file by byte range. Range reads were MEASURED to work on WorldCover, ETH, Meta, GLO-30, GLAD and the Swiss rasters. Window sizes are ESTIMATES.

**The land past each box.** The world's 30 m model comes in one-degree tiles. The tile over each box ends inside the distance the game draws from the ceiling, and a ring that ends at a tile's edge is drawn as sea. So each place also takes the tiles next to its own (rows 1.6, 3.7, 3.8, 6.12, 7.11 and 7.12).

**How long.** Downloads from Amazon's storage were once measured where the bakes run at 28 to 92 KB/s (SOURCE: `LIVING.md`). The hours below are ESTIMATES from that one measure. Other hosts may be faster or slower.

| Group | For | Whole files | With windows (ESTIMATE) | Hours at that rate (ESTIMATE) |
|---|---|---|---|---|
| 1. Yosemite: the first look | Stages 1 and 2 | 973,247,949 B (973 MB) | about 655 MB | 3 to 10 |
| 2. The rule's tests | Stage 2 | 505,976,519 B (506 MB) plus two small queries | about 55 to 65 MB | under 1 with windows; 1.5 to 5 whole |
| 3. Yosemite's walls up close | Stage 4 | 1,935,639,206 B (1.94 GB) | about 1.71 GB | 5 to 17 with windows; 6 to 19 whole |
| 4. Yosemite's forest counts, roads, rivers and falls | Stages 5 and 6 | 833,984,453 B (834 MB) plus one cut-out and one query | about 30 to 85 MB | under 1 with windows; 2.5 to 8 whole |
| 5. The world's leaf-type map | Stage 7, once for the world | 1,037,889,222 B (1.04 GB) | the same | 3 to 10 |
| 6. The Jungfrau region | Stage 7 | about 2.39 GB plus one cut-out | about 1.45 GB | 4 to 14 with windows; 7 to 24 whole |
| 7. Milford Sound | Stage 8 (a small part in stage 4) | 1,365,442,714 B (1.37 GB) plus one cut-out | about 1.0 GB | 3 to 10 with windows; 4 to 14 whole |
| **All seven** | | **about 9.0 GB** (sum of MEASURED sizes) | **about 6.0 GB** | |

Disk space is checked before each group.

**The studio's pick: yes to group 1 now**, with the go-ahead for Yosemite. Group 2 is asked for at stage 1's flight.

---

## Group 1. Yosemite: the first look

For stage 1 (the Valley on the phone) and stage 2 (the right kinds of trees).

| # | File | Source | URL | Size | How measured | Licence | What it is for |
|---|---|---|---|---|---|---|---|
| 1.1 | `USGS_13_n38w120.tif` | US Geological Survey, 3DEP 1/3 arc-second (about 10 m, bare ground) | https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n38w120/USGS_13_n38w120.tif | 451,129,925 B | MEASURED, HEAD. Taken whole: it is barely compressed, so a window saves little | US public domain. Credit "U.S. Geological Survey" and say what was changed | The ground for the Valley, the grove and all the land around them, from one source with no seam |
| 1.2 | `ETH_GlobalCanopyHeight_10m_2020_N36W120_Map.tif` | ETH Zurich, Global Canopy Height 2020 (10 m) | https://libdrive.ethz.ch/index.php/s/cO8or7iOe5dT2Rt/download?path=%2F3deg_cogs&files=ETH_GlobalCanopyHeight_10m_2020_N36W120_Map.tif | 217,841,624 B whole; about 25 MB as a window of the tile's one degree (ESTIMATE) | MEASURED, HEAD; a range request answered | CC BY 4.0. Cite Lang et al. 2023 | How tall the trees are; forest against scrub; the far forest's tone |
| 1.3 | `ESA_WorldCover_10m_2021_v200_N36W120_Map.tif` | ESA WorldCover 2021 (10 m) | https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N36W120_Map.tif | 115,482,414 B whole; about 13 MB as a window (ESTIMATE) | MEASURED, HEAD; range reads work | CC BY 4.0. "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium" | Where forest, grass, bare ground, snow and water are |
| 1.4 | `Ecoregions2017.zip` | RESOLVE Ecoregions 2017 | https://storage.googleapis.com/teow2016/Ecoregions2017.zip | 149,248,653 B | MEASURED, HEAD | CC BY 4.0 on the provider's own page. Cite Dinerstein et al. 2017 | The world's natural regions: the key that picks the tree kit. Fetched once, for every place after |
| 1.5 | `hartmann-moosdorf_2012.zip` (GLiM rock types, 0.5 degree grid) | PANGAEA, served from the Alfred Wegener Institute's archive | https://epic.awi.de/id/eprint/31092/1/hartmann-moosdorf_2012.zip (where the "Download dataset" link on https://doi.pangaea.de/10.1594/PANGAEA.788537 leads) | 38,670 B | MEASURED once, HEAD. The page says 37.8 kB | CC BY 3.0 | Granite country or limestone country, from a world table. Its cells are about 55 km wide, so it is a fallback and a tone, not a map of single walls |
| 1.6 | `Copernicus_DSM_COG_10_N38_00_W120_00_DEM.tif` | Copernicus DEM GLO-30 (the world's 30 m model) | https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N38_00_W120_00_DEM/Copernicus_DSM_COG_10_N38_00_W120_00_DEM.tif | 39,506,663 B whole; about 10 MB as a window of its south edge (ESTIMATE) | MEASURED once, HEAD; range reads work on this bucket | The Copernicus DEM licence: free, no share-alike. Its notice and no-liability sentence must ship | The land north of 38 N, 24 km from the Valley. File 1.1 ends there, and without this the ceiling view shows sea |

**Group 1 total: 973,247,949 B for files 1.1 to 1.6 whole (sum of MEASURED sizes). About 655 MB if 1.2, 1.3 and 1.6 are read as windows (ESTIMATE).**

---

## Group 2. The rule's tests

For stage 2: the forest-against-scrub test at Mount Tamalpais and Muir Woods, the first measure of how much of a wall the world's 30 m model made up, the answer key, and the plant-record checks.

| # | File | Source | URL | Size | How measured | Licence | What it is for |
|---|---|---|---|---|---|---|---|
| 2.1 | `ETH_GlobalCanopyHeight_10m_2020_N36W123_Map.tif`, a window over Tamalpais and Muir Woods | ETH Zurich | the pattern of 1.2, with `N36W123` | 280,186,365 B whole; window about 1 MB (ESTIMATE) | MEASURED, HEAD | CC BY 4.0 | The 10 m height map on the test window |
| 2.2 | `0230102033.tif`, the same window. Never shipped | Meta and WRI canopy height v2 (1 m) | https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/0230102033.tif | 109,561,571 B whole; window 2 to 8 MB (ESTIMATE) | MEASURED, bucket listing; range reads work | CC BY 4.0. "Meta and World Resources Institute (WRI) - 2026"; "Source imagery for CHM © 2016 Vantor" | The 1 m height map on the same window |
| 2.3 | `2020_40N_130W.tif`, the same window | GLAD Forest height 2020 (30 m), University of Maryland | https://gladxfer.umd.edu/users/Potapov/GLCLUC2020/Forest_height_2020/2020_40N_130W.tif | 73,133,489 B whole; window 1 to 3 MB (ESTIMATE) | MEASURED, HEAD; range reads work | CC BY. Cite Potapov et al. 2022 | A third opinion. One study found it the best of three in short plants |
| 2.4 | `Copernicus_DSM_COG_10_N37_00_W120_00_DEM.tif` | Copernicus DEM GLO-30 | https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N37_00_W120_00_DEM/Copernicus_DSM_COG_10_N37_00_W120_00_DEM.tif | 41,541,372 B | MEASURED, HEAD | The Copernicus DEM licence: free, no share-alike. Its notice and no-liability sentence must ship | The world's 30 m model over Yosemite itself: the test of how wrong it is on walls. It covers the same one degree as file 1.1, so it adds no land past it |
| 2.5 | That tile's edit, fill and water masks (`..._EDM.tif`, `..._FLM.tif`, `..._WBM.tif`) and its small fill-source file (`..._SRC.kml`) | the same bucket, the tile's auxiliary folder (SOURCE: the bucket listing; the exact paths are read from the listing) | https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N37_00_W120_00_DEM/ | 745,305 + 739,373 + 69,044 = 1,553,722 B, plus 35 to 82 kB | MEASURED, bucket listing | as 2.4 | They say how much of each wall the model filled in from elsewhere |
| 2.6 | The park's vegetation map, the state's copy (CDFW ds200), by a box query. Never shipped | California Department of Fish and Wildlife | https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds200_fpu/FeatureServer/0 | Not measurable. 3,037 polygons touch the Valley box. Under 10 MB (ESTIMATE) | MEASURED count query | CC BY (data.gov's record) | The answer key the tree rule is scored against |
| 2.7 | Counts of open plant records, CC0 and CC BY only | GBIF search service | https://api.gbif.org/v1/occurrence/search with `license=CC0_1_0&license=CC_BY_4_0` | A few hundred small answers, under 1 MB (ESTIMATE) | not measurable; no account needed for counts | CC0 or CC BY 4.0 per record. The filter drops every non-commercial record | Checks that each kit's trees are really recorded there, and places the sequoia grove |

**Group 2 total: 505,976,519 B if files 2.1 to 2.5 are taken whole (MEASURED sum), plus 2.6 and 2.7. About 55 to 65 MB with windows (ESTIMATE).**

---

## Group 3. Yosemite's walls up close

For stage 4. Asked for after stage 1 has flown, because stage 1 shows how far the 10 m ground already carries a wall.

| # | File | Source | URL | Size | How measured | Licence | What it is for |
|---|---|---|---|---|---|---|---|
| 3.1 | `USGS_1M_11_x26y418_CA_YosemiteNP_2019_D19.tif` | US Geological Survey, 3DEP 1 m, the 2019 Yosemite lidar survey | https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/CA_YosemiteNP_2019_D19/TIFF/ plus the file name | 291,737,564 B | MEASURED, bucket listing | US public domain | El Capitan (its summit is in this tile, MEASURED) |
| 3.2 | `..._x26y419_...` | the same | the same folder | 269,979,982 B | MEASURED | the same | The rim north of El Capitan (tile choice ESTIMATE from coordinates) |
| 3.3 | `..._x27y418_...` | the same | the same folder | 277,283,802 B | MEASURED | the same | Glacier Point and the south rim (tile choice ESTIMATE from coordinates) |
| 3.4 | `..._x27y419_...` | the same | the same folder | 284,799,987 B | MEASURED | the same | Half Dome and Yosemite Falls (ESTIMATE from coordinates) |
| 3.5 | `..._x28y418_...` | the same | the same folder | 276,919,705 B | MEASURED | the same | The Merced's upper canyon, Vernal and Nevada falls (ESTIMATE) |
| 3.6 | `..._x28y419_...` | the same | the same folder | 281,219,993 B | MEASURED | the same | Clouds Rest and Tenaya Canyon (ESTIMATE) |
| 3.7 | `Copernicus_DSM_COG_10_{TILE}_DEM.tif` for `N37_00_W121_00`, `N38_00_W121_00`, `N37_00_W119_00`, `N38_00_W119_00` | Copernicus DEM GLO-30 | the pattern of 1.6 | 45,213,310 + 42,882,578 + 39,450,870 + 38,553,765 = 166,100,523 B whole; about 20 MB as windows of the edges nearest the Valley (ESTIMATE) | MEASURED once, HEAD | as 1.6 | The land west of 120 W and east of 119 W, for the wider ring the surround draws |
| 3.8 | `ESA_WorldCover_10m_2021_v200_N36W123_Map.tif`, a window west of 120 W | ESA WorldCover | the pattern of 1.3 | 87,597,650 B whole; window about 5 MB (ESTIMATE) | MEASURED once, HEAD | CC BY 4.0 | Forest, grass and water for that western strip. The Bay Area's held copy stops at 121.4 W |

**Group 3 total: 1,681,941,033 B for the six lidar tiles (MEASURED sum); 1,935,639,206 B with 3.7 and 3.8 whole. About 1.71 GB with windows (ESTIMATE).**

A smaller choice, if the producer prefers: tiles 3.1, 3.3 and 3.4 alone are 853,821,353 B (MEASURED sum). They should hold El Capitan, Glacier Point, Half Dome and Yosemite Falls; only 3.1's cover is confirmed.

---

## Group 4. Yosemite's forest counts, roads, rivers and falls

For stage 5 (the forest at its true size, the grove) and stage 6 (waterfalls).

| # | File | Source | URL | Size | How measured | Licence | What it is for |
|---|---|---|---|---|---|---|---|
| 4.1 | `0230103033.tif`, windows on the Valley floor. Never shipped | Meta and WRI canopy height v2 (1 m) | https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/0230103033.tif | 378,161,518 B whole; windows about 5 MB (ESTIMATE) | MEASURED, bucket listing | CC BY 4.0, credits as 2.2 | Counts real crowns a hectare, to set each mix's crown spacing |
| 4.2 | `0230103211.tif`, a window on the Mariposa Grove. Optional. Never shipped | the same | the same pattern | 455,822,935 B whole; window 2 to 8 MB (ESTIMATE) | MEASURED, bucket listing | the same | Measures how far off the 10 m map is on giants |
| 4.3 | A cut-out of the Yosemite region (37-38 N, 119-120 W) from three type folders: water (rivers, lakes, waterfall points), road segments, building footprints. Read as row-group pieces, the way the Bay Area's was | Overture release 2026-10-21.0, the release the Bay Area's archive holds | https://overturemaps-us-west-2.s3.amazonaws.com/release/2026-10-21.0/ then `theme=base/type=water/`, `theme=transportation/type=segment/`, `theme=buildings/type=building/` | The whole folders are 28,818,195,515 B (32 files), 72,471,701,936 B (128 files) and 276,943,764,116 B (512 files). The cut is about 15 to 60 MB (ESTIMATE from the Bay Area's measured pieces of 2 to 5 MB each). **The run stops and asks if the cut passes 100 MB** | Folders MEASURED once, bucket listing. The cut cannot be measured before it is read | **ODbL: credit, and share-alike on the database. Its own file family, with everything baked from it** | Keeps trees off roads and rivers; finds the falls; the village as blocks. Overture's schema lists a waterfall class (SOURCE: docs.overturemaps.org/schema/reference/base/types/water_class); whether this release carries the points is checked on this cut |
| 4.4 | The world's waterfalls: place, name, height | Wikidata query | https://query.wikidata.org | Not measurable. 14,166 falls with a place, 1,054 with a height (MEASURED counts). 1 to 2 MB (ESTIMATE) | count queries | CC0 | Where every waterfall on Earth goes, and how tall. Fetched once |

**Group 4 total: 833,984,453 B if 4.1 and 4.2 are taken whole (MEASURED sum), plus 4.3 and 4.4. About 30 to 85 MB with windows and the cut-out (ESTIMATE).**

**The three cut-outs, early.** Overture deletes a release about 60 days after it is out, so release 2026-10-21.0 is gone by about 2026-12-20 (ESTIMATE), and 2026-12-16 is a breaking release (SOURCE: `LIVING.md`). Stage 5 will likely start after that. The studio's pick: OK rows 4.3, 6.11 and 7.10 together at stage 1's flight, so all three places are cut from the release the Bay Area uses. Otherwise each is cut from whatever release is current when its group is OK'd.

---

## Group 5. The world's leaf-type map

For stage 7 on. Yosemite and Milford do not need it; the Alps do (larch, beech).

| # | File | Source | URL | Size | How measured | Licence | What it is for |
|---|---|---|---|---|---|---|---|
| 5.1 | `PROBAV_LC100_global_v3.0.1_2019-nrt_Forest-Type-layer_EPSG-4326.tif` | Copernicus Global Land Cover 100 m, 2019, on Zenodo | https://zenodo.org/records/3939050/files/PROBAV_LC100_global_v3.0.1_2019-nrt_Forest-Type-layer_EPSG-4326.tif | 1,037,889,222 B | MEASURED, HEAD and Zenodo's file list. Range reads are unproven on that host, so plan on the whole file | CC BY 4.0 on the record. Credit Copernicus Global Land Service | Needle or broad leaf, evergreen or not, for the whole world. Fetched once |

**Group 5 total: 1,037,889,222 B (MEASURED).**

---

## Group 6. The Jungfrau region

For stage 7.

| # | File | Source | URL | Size | How measured | Licence | What it is for |
|---|---|---|---|---|---|---|---|
| 6.1 | swissALTI3D 2 m, 1,092 one-kilometre tiles, the newest year of each | swisstopo | https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items?bbox=7.80,46.38,8.15,46.72 | 1,239.2 MB, known to 0.1 MB: the byte count was not kept | MEASURED: every tile HEAD-requested, by two people | "Open use. Must provide the source": commercial use allowed, not share-alike. "© swisstopo". Custom terms: a short review before it ships | The walls and ridges, real at 2 m |
| 6.2 | `Copernicus_DSM_COG_10_N46_00_E007_00_DEM.tif` and `..._N46_00_E008_00_DEM.tif` | Copernicus DEM GLO-30 | the pattern of 2.4 | 41,776,750 + 42,038,015 = 83,814,765 B | MEASURED, HEAD | as 2.4 | The base around the box, from 46 N to 47 N |
| 6.3 | Those two tiles' masks and fill-source files | the same bucket | as 2.5 | 1,179,282 + 1,270,598 + 66,568 and 1,309,949 + 1,528,473 + 58,669 = 5,413,539 B, plus 35 to 82 kB each | MEASURED, bucket listing | as 2.4 | How much of the Eiger's face the 30 m model made up |
| 6.4 | `ESA_WorldCover_10m_2021_v200_N45E006_Map.tif` | ESA WorldCover | the pattern of 1.3 | 106,497,465 B whole; window about 1.4 MB (ESTIMATE) | MEASURED, HEAD; range reads work | CC BY 4.0 | Forest, grass, rock, ice |
| 6.5 | `ETH_GlobalCanopyHeight_10m_2020_N45E006_Map.tif` | ETH Zurich | the pattern of 1.2 | 407,025,206 B whole; window about 5 MB (ESTIMATE) | MEASURED, HEAD; range reads work | CC BY 4.0 | How tall |
| 6.6 | Upper timberline map. Never shipped | Swiss Federal Office for the Environment | https://data.geo.admin.ch/ch.bafu.wald-obere_waldgrenze/wald-obere_waldgrenze/wald-obere_waldgrenze_2056.tif | 2,906,986 B | MEASURED, HEAD | Open use | Answer key for the measured tree line |
| 6.7 | Areas of silver fir. Never shipped | the same | https://data.geo.admin.ch/ch.bafu.wald-tannenareale/wald-tannenareale/wald-tannenareale_2056.gpkg | 638,976 B | MEASURED, HEAD | Open use | Answer key for where fir belongs |
| 6.8 | Forest mix rate. Never shipped | Swiss forest inventory | https://data.geo.admin.ch/ch.bafu.landesforstinventar-waldmischungsgrad/landesforstinventar-waldmischungsgrad/landesforstinventar-waldmischungsgrad_2056.tif | 170,912,760 B whole; window about 4 MB (ESTIMATE) | MEASURED, HEAD | One checker read "Open use. Must provide the source" in its own record; another saw only "proprietary" in the catalogue. Answer key only | Answer key for needle against broad leaf |
| 6.9 | `inventory_sgi2016_r2020.zip` | GLAMOS, Swiss Glacier Inventory 2016 | https://doi.glamos.ch/data/inventory/inventory_sgi2016_r2020.zip | 9,787,779 B | MEASURED, HEAD | CC BY 4.0. Cite Linsbauer et al. 2021 | Answer key for the ice and its rubble stripes |
| 6.10 | `1202212112.tif`, windows at Lauterbrunnen. Optional. Never shipped | Meta and WRI canopy height v2 | the pattern of 2.2 | 189,228,980 B whole; windows about 5 MB (ESTIMATE) | MEASURED, bucket listing | CC BY 4.0, credits as 2.2 | Counts real crowns in spruce and beech |
| 6.11 | A cut-out of the box from the same three type folders as 4.3 | Overture release 2026-10-21.0 | as 4.3 | About 15 to 60 MB (ESTIMATE, as 4.3). The run stops and asks past 100 MB | as 4.3 | **ODbL: credit, and share-alike on the database. Its own file family, with everything baked from it** | Villages as blocks; the falls; trees kept off roads |
| 6.12 | `Copernicus_DSM_COG_10_{TILE}_DEM.tif` for `N47_00_E007_00`, `N47_00_E008_00`, `N45_00_E007_00`, `N45_00_E008_00` | Copernicus DEM GLO-30 | the pattern of 1.6 | 42,939,950 + 41,746,914 + 42,594,792 + 43,016,696 = 170,298,352 B whole; about 15 MB as windows of the edges nearest the box (ESTIMATE) | MEASURED once, HEAD | as 1.6 | The land north of 47 N and south of 46 N. Tiles 6.2 end there |

**Group 6 total: 1,239.2 MB for 6.1, plus 957,295,828 B for 6.2 to 6.9 and 6.12 whole (sum of MEASURED sizes): about 2.20 GB. About 2.39 GB with 6.10 whole. Plus 6.11. About 1.45 GB with windows and the cut-out (ESTIMATE).**

---

## Group 7. Milford Sound

For stage 8. One small part is wanted early, in stage 4: the strip test that says whether the 8 m ground beats the world's 30 m model on Mitre Peak.

| # | File | Source | URL | Size | How measured | Licence | What it is for |
|---|---|---|---|---|---|---|---|
| 7.1 | NZ 8 m model, sheets `CA08`, `CA09`, `CB08`, `CB09` | LINZ (made by Geographx from 20 m contour lines) | https://nz-elevation.s3.ap-southeast-2.amazonaws.com/new-zealand/new-zealand-contour/dem_8m/2193/ plus `CA08.tiff` and so on | 14,814,896 + 29,814,280 + 31,909,882 + 31,884,189 = 108,423,247 B | MEASURED, bucket listing | CC BY 4.0. "Sourced from the LINZ Data Service and licensed for reuse under CC BY 4.0" | The ground for the whole box |
| 7.2 | Sheet `CB07`, only if the widened south-west corner needs it | the same | the same folder | 20,728,106 B | MEASURED, bucket listing | the same | A strip by Sutherland Falls |
| 7.3 | Southland lidar 1 m ground model, tiles `CB08_10000_0104`, `0105`, `0204`, `0205`, `0304`, `0305` and `CB09_10000_0201`, `0301`, `0302` | LINZ for Environment Southland | https://nz-elevation.s3.ap-southeast-2.amazonaws.com/southland/southland_2020-2023/dem_1m/2193/ plus the tile name and `.tiff` | 321,440,637 B | MEASURED, bucket listing | CC BY 4.0. Name LINZ, Aerial Surveys and Environment Southland | 1 m ground at the fiord's head, Bowen Falls, the road, both tunnel portals. It does not reach Mitre Peak or Stirling Falls |
| 7.4 | Southland lidar 1 m surface model, the same nine tiles | the same | the same path with `dsm_1m` | 342,795,933 B | MEASURED, bucket listing | the same | With 7.3, the true canopy height. It measures how far the radar in the world's 30 m model sinks into forest: a rule for the whole world, not just this place |
| 7.5 | `Copernicus_DSM_COG_10_S45_00_E167_00_DEM.tif` and `..._S45_00_E168_00_DEM.tif` | Copernicus DEM GLO-30 | the pattern of 2.4 | 12,478,395 + 41,392,956 = 53,871,351 B | MEASURED, HEAD | as 2.4 | The base around the box, north of 45 S; the strip test |
| 7.6 | Those two tiles' masks and fill-source files | the same bucket | as 2.5 | 537,506 + 612,015 + 95,373 and 1,286,118 + 1,384,900 + 122,633 = 4,038,545 B, plus 35 to 82 kB each | MEASURED, bucket listing | as 2.4 | How much of the fiord's walls the 30 m model made up |
| 7.7 | `ESA_WorldCover_10m_2021_v200_S45E165_Map.tif` and `..._S45E168_Map.tif` | ESA WorldCover | the pattern of 1.3 | 3,942,930 + 39,085,211 = 43,028,141 B | MEASURED, HEAD | CC BY 4.0 | Forest, rock, ice, sea |
| 7.8 | `ETH_GlobalCanopyHeight_10m_2020_S45E165_Map.tif` and `..._S45E168_Map.tif` | ETH Zurich | the pattern of 1.2 | 16,467,214 + 177,113,903 = 193,581,117 B whole. The fiord is in the first. The second holds only the land east of 168 E (Mt Tūtoko is at 168.0125 E, MEASURED): a window of about 5 MB (ESTIMATE) | MEASURED, HEAD | CC BY 4.0 | How tall; the forest line |
| 7.9 | `3131013321.tif`, windows. Optional. Never shipped | Meta and WRI canopy height v2 | the pattern of 2.2 | 150,554,309 B whole; windows about 5 MB (ESTIMATE) | MEASURED, bucket listing | CC BY 4.0, credits as 2.2 | Counts real crowns in beech forest |
| 7.10 | A cut-out of the box from the same three type folders as 4.3 | Overture release 2026-10-21.0 | as 4.3 | About 15 to 60 MB (ESTIMATE, as 4.3). The run stops and asks past 100 MB | as 4.3 | **ODbL: credit, and share-alike on the database. Its own file family, with everything baked from it** | The falls and rivers; the village and the road |
| 7.11 | `Copernicus_DSM_COG_10_S46_00_E167_00_DEM.tif` and `..._S46_00_E168_00_DEM.tif` | Copernicus DEM GLO-30 | the pattern of 1.6 | 42,090,589 + 42,552,698 = 84,643,287 B whole; about 20 MB as windows of their north edges (ESTIMATE) | MEASURED once, HEAD | as 1.6 | The land south of 45 S, 18 km from the box. Tiles 7.5 end there. West of 167 E the next tile does not exist: it is open sea (MEASURED once, the bucket answers "not found") |
| 7.12 | `ESA_WorldCover_10m_2021_v200_S48E165_Map.tif` and `..._S48E168_Map.tif`, windows | ESA WorldCover | the pattern of 1.3 | 13,008,940 + 29,329,101 = 42,338,041 B whole; windows about 4 MB (ESTIMATE) | MEASURED once, HEAD | CC BY 4.0 | Forest, rock and sea for that southern strip |

**Group 7 total: 1,214,888,405 B for 7.1 to 7.8, 7.11 and 7.12 whole (sum of MEASURED sizes); 1,365,442,714 B with 7.9 whole; plus 7.10. About 1.0 GB with windows and the cut-out (ESTIMATE). Without the surface model (7.4) it is 342,795,933 B less, but the surface model is the piece that teaches a world rule.**

**The early part, for stage 4's strip test:** sheets `CA08` and `CB08` (Mitre Peak sits near their shared edge, ESTIMATE from coordinates), GLO-30 tile `S45_00_E167_00` with its masks, and the lidar ground tile `CB08_10000_0104` (28,912,173 B, MEASURED). That is 89,360,240 B (MEASURED sum).

---

## Not on this list, and why

- **Forbidden (non-commercial or no passing on):** FABDEM; the California Forest Observatory; ESA CCI land cover; NZ EcoSat Forests, Potential Vegetation and the Vegetative Cover Map; NZ Basic Ecosystems; NIWA's sea-floor grid; the Swiss land use statistics; every CC BY-NC plant record, which is all of iNaturalist.
- **Share-alike, flagged loudly:** NZ's new 10 m land cover is CC BY-SA 4.0. It is not used and would need a review before it could ship. OpenStreetMap scrub tags were proposed as an input to the forest-or-scrub decision; that could pull share-alike into the land layer, so they are dropped from the rule.
- **Licence not stated or unclear:** the park service's own copy of the vegetation map and its meadow map; RGI glacier outlines; Mapterhorn's mosaic; the NZ ice polygons.
- **Needs an account only the producer can make:** NZ's land cover database, LINZ chart depths and waterfall points, LANDFIRE's small clip. None is needed.
- **Too big for what it buys:** LANDFIRE's whole files (3.8 to 9.2 GB each); the US Forest Service's TreeMap (4.5 GB by its page, not measurable); the Yosemite lidar point cloud (about 110 GB); swissTLM3D (2.9 GB).
- **Held for later, priced in `WILD.md` section 9.3:** the Matterhorn's ground (about 558 MB, MEASURED, plus a window for the Italian side); the 1 m ground of the Tuolumne and Merced groves (380,736,782 B, MEASURED).

## What happens after a yes

- Each file is fetched once, to the studio's data archive outside the repo, and its size is checked against the bytes above.
- Windows are tried first where range reads were measured to work. If a window fails, the whole file is the fallback and its size is already on this list.
- Nothing outside the group is fetched. A file that turns out to be needed and is not on this list is a new ask. An Overture cut-out that passes 100 MB stops and is a new ask too.
- Each source's credit line goes into the game's data licence file in the same commit as anything baked from it.

## A flag

One checker ran 41 point-height queries and one profile query against the US and Swiss survey services to measure El Capitan's and the Eiger's faces. They are answers from a query service, not files. Whether they count as downloads is the producer's call (`WILD.md`, section 12, call 4).
