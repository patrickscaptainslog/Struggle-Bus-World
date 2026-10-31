# Antarctica and the Moon: data, frames, light, tiles

Research for the far-field question. Date 2026-10-30 (Overpass stamps read 2026-10-31 UTC). Nothing in any repo was changed. No browser, build, bake or heavy job was run. All reads were HEAD requests, small ranged reads and short catalogue queries, about 50 MB in total [E].

**Labels.**
- **[M] measured:** read from this machine: a HEAD, a ranged read, a catalogue query, a local PROJ call, or this repo.
- **[S] from a source:** an external fact, with its link. Licence and history facts are all [S].
- **[E] estimate:** my arithmetic, with the assumption stated. Geometry calculated from an exact formula also carries [E], because the inputs are rounded.

**Limits on this report.** The shared web search budget ran out near the end, so three questions stayed open (section 12). Several facts come from search excerpts of pages I could not open. Those are marked "excerpt". Scripts and raw sample outputs are in `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/polar-scripts/`.

---

## 0. Bottom line

1. **Neither place has a data blocker. The two differ in how close to the bus real data lasts.** Using "one texel is at most 2 game pixels" from the ceiling pose [E from the audit's pixel table]:

   | Data | Texel | Good from about | Covers |
   |---|---|---|---|
   | REMA 2 m | 2 m | 0.5 km | Antarctica, whole mosaic, heavy to serve |
   | REMA 32 m | 32 m | 10 km | Antarctica, practical planet layer |
   | Kaguya images | 10 m | 3 km | Moon, 70°N-70°S |
   | Kaguya USGS DTM | 17-33 m | 5-10 km | Moon, 70°N-70°S |
   | SLDEM2015 | 59 m | 20 km | Moon, 60°N-60°S |
   | LOLA | 118 m | 40 km | Moon, global |

   Antarctica has real relief right up to the bus. The Moon does not: closer than about 3-10 km its global data turns soft, and at the ceiling that is most of the frame, because 10 km sits at row 28 % [S: audit]. Seeded craters would add detail on top of real relief there. They would not replace it. So the answer to the producer holds in both places: everything you see from altitude can be real, and procedural detail belongs below the data, never in place of it.

2. **Web Mercator and the UTM plan cannot carry these places. One cube-sphere grid can.**
   - All of Antarctica south of 60°S sits on one S2 face, with the pole at the face centre and texel size varying only 1.22× across it [E].
   - All six Apollo sites sit on one face of the same grid on the Moon [E].
   - WORLD-TRAVEL's frames and keys need replacing. Its floating origin and curve chunk do not.

3. **The land-class layer has to change, and the audit's open question about imagery is settled.** WorldCover has nothing south of 60°S [M]. Antarctica's class layer can be BedMachine's 500 m mask plus ADD rock outcrops. Antarctic imagery exists in five forms (section 1.3). The free 10 m one is Copernicus's quarterly mosaic, which has items at McMurdo and Rothera [M].

4. **The South Pole has no building geometry in OSM or Overture.** OSM holds six nodes within 0.1° of the pole and no ways [M]. Amundsen-Scott must be hand-built or left as a sign. McMurdo is fine: 367 OSM buildings in a box around it, against 1,417 south of 60°S in total [M].

5. **Ice reads from relief and low sun. The Moon reads from albedo and relief. Neither can use imagery as it comes.**
   - On the Ross Ice Shelf, red-band contrast over a 2.6 km window is 0.9 % [M], so imagery adds almost nothing there.
   - In mare and highland samples it is 12-24 %, and mare is about a third of highland brightness [M].
   - The sharpest images have shadows in the pixels, from whatever sun they were taken under. Under a moving sun those shadows point the wrong way, so the tone layer must be albedo-like or high-passed (section 4.2).

6. **Both places need terrain shadows out to the horizon.**
   - The sun is at 1.7-25.9° at McMurdo today [E].
   - Erebus at 1.7° casts a 128 km shadow, and a 3 km lunar rim at 1.5° casts 115 km [E].
   - The 520-1,604 m shadow window cannot reach those. WORLD-TRAVEL's "shadows off above 2 km" would remove the picture itself in these two places.

7. **The Moon rules out any strategy that needs haze.** From the ceiling the lunar horizon is 48 km away [E], past today's 30 km far plane [S: audit]. The 20 km fade would become a black band before the horizon [S: audit].

8. **Planet tiles are small.** Measured on real terrain, a 256² height tile costs:
   - 1-22 KB on flat ice
   - up to 89 KB in the mountains
   - 12-58 KB on the Moon

   A pyramid down to 32 m is about 2-5 GB for Antarctica and about 25 GB for the Moon [E]. That is more than 100 times smaller than the audit's 1.3-6.1 TB at city-tile quality, and confirms that city tiles must not be used for open land.

9. **Licences allow this**, with credit lines. The exceptions are COMA (a commercial enquiry, no stated licence), BAS's mosaic (no terms found) and Chang'e-2 (terms not found). Section 9 has the table.

10. **What you paint is craters, ice fronts, rock islands and stations, not buildings.** The Moon offers about 1.3 M catalogued craters and 9,003 named features [S]. Antarctica offers 37,893 gazetteer names for 19,803 features [S]. A short no-paint list covers memorials, the Erebus crash site, wildlife and historic sites (section 6).

---

## 1. Antarctica: what data exists

### 1.1 Elevation

| Product | Grid | Coverage | Format as served | Size | Notes |
|---|---|---|---|---|---|
| **REMA mosaics v2.0** | 2 m (50 km tiles), 10 m and 32 m (100 km tiles) [S](https://www.pgc.umn.edu/data/rema/) | 98 % of the continent, to roughly 88°S [S](https://www.pgc.umn.edu/guides/stereo-derived-elevation-models/pgc-dem-products-arcticdem-rema-and-earthdem/). Catalogue bbox ends at -89.08° [M](https://pgc-opendata-dems.s3.us-west-2.amazonaws.com/rema.json) | COG, float32, LZW, predictor 3, 512² blocks, overviews 2/4/8 [M] | 32 m tile 22.5-38.7 MB (2 tiles) [M] | S3 holds only 2, 10 and 32 m [M] |
| **REMA 100 m, 500 m, 1 km** | Full-domain mosaics [S](https://www.pgc.umn.edu/data/rema/) | As above. A `filled_cop30` version fills the hole south of 88°S with GLO-30 [S](https://www.pgc.umn.edu/guides/stereo-derived-elevation-models/pgc-dem-products-arcticdem-rema-and-earthdem/) | tar.gz on PGC HTTP [M](https://data.pgc.umn.edu/elev/dem/setsm/REMA/mosaic/latest/100m/) | Filled: 5.91 GB, 346.6 MB, 102.6 MB [M] | Only the reduced products are filled [S] |
| **BedMachine Antarctica v4** | 500 m [S](https://nsidc.org/sites/default/files/documents/user-guide/nsidc-0756-v004-userguide.pdf) | To 90°S [S] | One NetCDF-4 file, EPSG:3031 [S] | Not read | Bed, surface, thickness, geoid and a mask. Needs a free Earthdata login (section 8) |
| **Bedmap3** | 500 m [S](https://eprints.whiterose.ac.uk/224358/1/s41597-025-04672-y.pdf) | Antarctica | UK Polar Data Centre | Not read | Licence of the grid files not confirmed |
| **Copernicus GLO-30** | 1″ in latitude. Longitude spacing 3″ at 70-80°, 5″ at 80-85°, 10″ at 85-90° [S](https://dataspace.copernicus.eu/sites/default/files/media/files/2024-06/geo1988-copernicusdem-spe-002_producthandbook_i5.0.pdf) | Every 1° band from S80 to S90 has all 360 tiles; 7,042 tiles S61-S90 [M](https://copernicus-dem-30m.s3.amazonaws.com/tileList.txt) | COG, 1°×1° tiles [M] | S90E000 3.15 MB, S78E166 6.74 MB [M] | TanDEM-X X-band, 2011-2015 [S](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM). The handbook treats Greenland and Antarctica separately because radar penetrates snow and ice [S] |

Three things follow for a bake.

- **REMA heights are ellipsoidal** [S](https://www.pgc.umn.edu/guides/stereo-derived-elevation-models/pgc-dem-products-arcticdem-rema-and-earthdem/). The sea-level surface reads -53.5 m on fast ice in McMurdo Sound and -47.7 m in Winter Quarters Bay [M, single samples at the 256 m overview]. Rothera Point reads +13.9 m and Palmer +17.8 m [M], close to their mapped heights [S](https://en.wikipedia.org/wiki/Rothera_Research_Station). So the offset varies by about 50 m around the continent [E]. WORLD-TRAVEL §1.1 ignores the geoid. That fails here: without a correction McMurdo's coast sits 50 m below the water plane. BedMachine carries a `geoid` field for this [S].
- **The pole hole is real but harmless.** Copernicus reads 2,834.6-2,835.8 m on its last row at the pole and 2,739.6-2,741.9 m at 89°S [M], matching OSM's 2,835 m tag [M]. REMA reads 2,636.5 m at 88°S [M, ellipsoidal].
- **A hero site can use REMA 2 m directly.** It is finer than the 4 m grid city tiles store today [S: audit]. REMA is a surface model, so buildings are in it. That may even help: 78 % of McMurdo's sampled buildings have no height or floor tag [M: audit], and a 2 m surface model minus the ice could fill them [E, untested].

### 1.2 Land class, coast and rock

| Source | What it gives | Status |
|---|---|---|
| **ESA WorldCover v200** | Nothing south of 60°S. Listing keys that start `S6` returns only `S60W027` and `S60W030`. HEAD on S63W060 and S78E165 is 404 [M] | The audit found the same (2,651 tiles, southern edge 60°S). One third-party catalogue says 90°N-90°S, which the bucket contradicts |
| **BedMachine `mask`** | 0 ocean, 1 ice-free land, 2 grounded ice, 3 floating ice, 4 Lake Vostok, at 500 m [S](https://nsidc.org/sites/default/files/documents/user-guide/nsidc-0756-v004-userguide.pdf) | The closest replacement for a class raster |
| **ADD (SCAR Antarctic Digital Database)** | Coastline, rock outcrop, contours and more, as GeoPackage or Shapefile [S](https://scar.org/?p=1308). Rock outcrop is at v7.11 (2025), CC BY 4.0 [S](https://data-search.nerc.ac.uk/geonetwork/srv/api/records/815525ca-cefe-4fbf-9224-3ee784e7de4e) | Resolution varies by area: most mountains from 1:250,000 mapping [S](https://media.npolar.no/download/quantarctica/Quantarctica3/Basemap/ADD_General.txt) |
| **Rock area** | About 21,745 km², 0.18 ± 0.05 % of the continent, mapped north of 82°40′S [S](https://tc.copernicus.org/articles/10/1665/2016/) | Rock is rare and reads like islands |
| **Blue ice** | 234,549 km², 1.67 % [S](https://gcess.bnu.edu.cn/kycg1/2014/86978.html). AntarcticaLC2000 gives snow and firn 97.807 %, blue ice 1.656 % [S](https://modis.gsfc.nasa.gov/sci_team/pubs/abstract_new.php?id=25043) | Whether AntarcticaLC2000 (a 30 m map) can be downloaded was not confirmed |
| **OSM convention** | Land south of 60°S counts as glacier by default. Ice-free land is what gets mapped, as bare rock or scree. The coastline runs at the calving line. Sea ice is not mapped [S](https://wiki.openstreetmap.org/wiki/Antarctica/Tagging) | This settles an audit question: the ice sheet is not mapped as glacier, on purpose. A bake must default to ICE here, not YARD |

### 1.3 Imagery, and where it stops

The audit recorded that no Antarctic image source had been found. There are five.

| Product | Grid | Reach | Access | Licence | Comment |
|---|---|---|---|---|---|
| **Copernicus Sentinel-2 quarterly mosaics** | 10 m, B02/B03/B04/B08 plus an observation count [M](https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-global-mosaics) | Items at McMurdo and Rothera. Tile footprints reach -83.685°, none intersect south of 84°S. McMurdo's 12 most recent items run 2022 Q4 to 2026 Q3, with no Q2 (polar night) [M] | COG in `s3://eodata`, needs a free CDSE account. Items are about 702 MB per 100 km tile [M] | Sentinel data legal notice, linked from the collection [M]; not opened | First-quartile compositing per pixel [S]. Quality over snow not checked, and I could not open the rasters here |
| **LIMA** | 15 m, Landsat 7 pan-sharpened, released around 2009 [S](https://data.pgc.umn.edu/sat/prod/lima/cirref/CIRREF_x-1950000y-0600000.htm) | To 82.5°S. A centre-filled version uses MOA [S](https://lima.usgs.gov/access.php) | PGC HTTP, no login, range reads work [M](https://data.pgc.umn.edu/sat/prod/lima/). 654 uncompressed TIFFs in `rgb1x`, each 10,000² at 15 m, 150 km square, EPSG:3031 [M]. About 196 GB per variant [E] | Public domain, credit appreciated [S](https://lima.usgs.gov/access.php) | The `rgb30x` file reads as 15 m, so the suffix is not a resolution [M]. I read it as a brightness stretch [E, unconfirmed] |
| **MOA2014** (MODIS) | 125 m and 750 m, 48,333 × 41,779 cells, 16-bit [S](https://nsidc.org/sites/default/files/nsidc-0730-v001-userguide.pdf) | To the pole, with low quality weights there because all views are far off-nadir [S] | Earthdata login, 401 here [M]. About 8.7 GB [S] | Citation required [S](https://nsidc.org/data/nsidc-0730) | Its `hp1` band is high-passed surface morphology [S], which is almost exactly what a tone channel for ice needs |
| **COMA** | 15 m, 400,000² cells, EPSG:3031, built from 2013-2021 Landsat 8, ASTER and MODIS [S](https://imagico.de/services//coma.php) | Whole continent. Ice-free areas high-res to 85.15°S [S] | By enquiry | No stated terms or price [S] | The best-looking candidate, and commercial |
| **BAS Sentinel-2 mosaic 2024-25** | 10 m, EPSG:3031 [S](https://tiles.arcgis.com/tiles/tPxy1hrFDhJfZ0Mf/arcgis/rest/services/S2_mosaic_2425_BAT_RGBAlpha_EPSG_3031/MapServer) | British Antarctic Territory sector only | ArcGIS tiles, export off [S] | Copyright BAS, no terms found | Useful as a visual reference for Palmer and Rothera |

**Where optical coverage stops:**

| Latitude | What ends there | Label |
|---|---|---|
| 82.5°S | LIMA | [S](https://lima.usgs.gov/access.php) |
| 82.66-82.7°S | Regular Landsat nadir rows | [M] 2,772 scenes touch 82.7-83°S; limit 82.66° [S](https://imagico.de/services//coma.php) |
| 82.84°S | Sentinel-2 scenes. 26,543 touch 82.8-82.9°S, none touch south of 82.9°S | [M] Earth Search, 2026-10-30 |
| 84.53°S | Landsat 8/9 off-nadir. 755 scenes touch 84-84.5°S, 5 touch 84.5-85°S, none further south. Off-nadir angle about 14-15° | [M] USGS LandsatLook STAC |
| 85.15°S | COMA's high-res ice-free coverage (ASTER) | [S](https://imagico.de/services//coma.php) |
| 88°S | REMA stereo | [S](https://www.pgc.umn.edu/guides/stereo-derived-elevation-models/pgc-dem-products-arcticdem-rema-and-earthdem/) |
| 90°S | Only MOA and GLO-30 reach it | [S], [M] |

The hole south of 84.53°S is about 1.16 M km², 8 % of the continent. South of 82.84°S it is about 2.0 M km², 14 % [E: circular cap, 111.2 km per degree]. Almost all of it is plateau snow, where imagery carries nearly no signal anyway (section 1.4). The real loss is the southern Transantarctic Mountains. Mount Howe, at 87°22′S, is apparently the southernmost mountain [S](https://en.wikipedia.org/wiki/Mount_Howe). REMA relief covers those to 88°S.

**Clouds matter on the Peninsula.** Sentinel-2 over Palmer has 210 scenes from 2024 to 2026: none under 10 % cloud, 2 under 20 %, 27 under 50 %. McMurdo has 388, with 5 under 5 % [M]. Scene cloud flags are unreliable over snow [E, my judgement, not checked], so treat this as a warning and not a census. It argues for composites over single scenes.

ESA also ran an Antarctic Sentinel-2B campaign: 3,000 cloud-free products in a 2023 mosaic, repeated each austral summer [S](https://sentinels.copernicus.eu/-/copernicus-sentinel-2-pieces-together-mosaic-of-antarctica). Its download location was not found. Antarctica was not in the original plan [S](https://imagico.de/blog/?p=4970).

### 1.4 What ice looks like in the data

Sentinel-2 red band, raw digital numbers [M]. The absolute reflectance scale depends on a product offset I did not resolve, so read these as relative contrast only.

| Window | Grid | Mean | Std | Std / mean |
|---|---|---|---|---|
| Ross Ice Shelf | 10 m | 9,749 | 91 | 0.9 % |
| Ross Ice Shelf | 160 m | 9,729 | 126 | 1.3 % |
| McMurdo / Ross Island | 10 m | 7,895 | 116 | 1.5 % |
| McMurdo / Ross Island | 160 m | 7,944 | 634 | 8.0 % |
| Dry Valleys | 10 m | 8,006 | 2,200 | 27 % |
| Dry Valleys | 160 m | 6,435 | 2,398 | 37 % |

Albedo is nearly flat over ice, so the ramp stays on one step. Relief under a low sun has to make the picture, which makes height the primary layer and imagery a secondary one. Imagery earns its bytes only at the coast, in rock and on blue ice. Even there, a summer scene carries low-sun mountain shadows, so the baked-shadow rule in section 4.2 applies: rock should get its tone from class and its shading from the height layer.

Ice surface relief is small too. A 256 × 32 m window is 2.4 m high on the Ross Ice Shelf and 6.3 m at Dome C [M]. Shading it needs better than 1 m height steps, or the flat ice will terrace. The tile sizes in section 7 bracket this with 1 m and 0.1 m.

### 1.5 Places

OSM counts are `way["building"]` from Overpass, 2026-10-31 [M]. Overture's total of 1,405 south of 60°S is the audit's measurement. The two agree to 1 %.

| Place | Facts | OSM buildings | What is there for the game |
|---|---|---|---|
| **McMurdo** 77.85°S 166.67°E | 10 m elevation. About 1,000 people in summer, 153 in winter. More than 85 buildings by one count, more than 100 by another [S](https://en.wikipedia.org/wiki/McMurdo_Station) | **367** in a box that includes Scott Base. Overture sample 296, all OSM, 22 % with a height or floor tag, 89 % of road segments unpaved or gravel [M: audit] | A small real town: Crary lab, Chapel of the Snows, Winter Quarters Bay, Discovery Hut, Hut Point, Scott Base 3 km away, snow runways on the shelf [S]. The best Antarctic hero city |
| **Amundsen-Scott** 90°S | 2,835 m. About 150 in summer, 49 in winter. Elevated station dedicated 2008, 80,000 ft², 3,658 m skiway, IceCube, South Pole Telescope [S](https://en.wikipedia.org/wiki/Amundsen%E2%80%93Scott_South_Pole_Station) | **0**. Six nodes within 0.1°: South Pole, Polheim, Ceremonial Southpole, Jack F. Paulus Skiway, IceCube, the station [M] | Hand-built or a sign. The most symbolic spot on the continent has no data |
| **Palmer** 64.77°S 64.05°W | Anvers Island, Gamage Point, supplied by ship, no airstrip. 44 in summer, 13 in winter (2017 figures) [S](https://en.wikipedia.org/wiki/Palmer_Station) | **55** | Peninsula scenery: glaciers to the sea. Cloudy (section 1.3) |
| **Rothera** 67.57°S 68.13°W | Adelaide Island, 16 m, 900 m crushed-rock runway, hangar, wharf. Up to 160 in summer, about 27 in winter [S](https://en.wikipedia.org/wiki/Rothera_Research_Station) | **14** | A runway on a point, with mountains behind |
| **Dry Valleys** about 77.5°S 162°E [E] | About 4,500 km², the largest ice-free region. Victoria, Wright and Taylor valleys. Lake Vanda, Don Juan Pond, Blood Falls, the Onyx River. Katabatic winds and a snow shadow keep it dry [S](https://en.wikipedia.org/wiki/McMurdo_Dry_Valleys) | None measured | The only large land surface. Blood Falls is iron-oxide red; keep it rose-violet, per the no-brown rule. WorldCover's absence hurts most here, so use ADD rock |
| **Mount Erebus** 77.53°S 167.15°E | 3,792 m. A persistent lava lake, ice towers at fumaroles. Air New Zealand 901 crashed there in 1979, killing all 257 [S](https://en.wikipedia.org/wiki/Mount_Erebus) | n/a | Above the ±3,200 m height clamp [S: audit]. The crash site is a protected area (section 6) |

Other data for this layer:
- OSM has 407 `place` nodes south of 60°S [M].
- The SCAR Composite Gazetteer holds 37,893 names for 19,803 features [S](https://en.wikipedia.org/wiki/Composite_Gazetteer_of_Antarctica). Older counts differ [S](https://docs.ropensci.org/antanym/articles/antanym.html). Its licence is reported as CC BY by a secondary source. Getting the full file needs a login at AADC [S](https://public.data.npolar.no/quantarctica/Quantarctica/Basemap/Miscellaneous/1st_ReadMe_SCAR_PlaceNames_SCAR%20Composite%20Gazetteer.htm).

### 1.6 Sea ice

The planet layer's ocean needs a moving edge here.
- 2026 minimum: 2.58 M km² on 26 February [S](https://nsidc.org/news-analyses/news-stories/antarctic-sea-ice-extent-arrives-near-average-minimum).
- 2026 maximum: 17.59 M km² on 14 September [S](https://science.nasa.gov/earth/earth-observatory/antarctic-sea-ice-grows-to-its-2026-maximum/?rand=6382).

That sevenfold swing is larger than the continent itself. A small daily polar concentration raster, one R8 texture, would do it [E]. Bremen's AMSR2 product was not checked because the search budget ended. NSIDC's extents use the usual 15 % concentration threshold [S].

### 1.7 Suggested recipe

| Layer | Use | Fallback past its limit |
|---|---|---|
| Height, far | REMA 100 m and 32 m, corrected to a geoid | `filled_cop30` south of 88°S |
| Height, hero sites | REMA 2 m and 10 m | None needed |
| Class | BedMachine mask, ADD rock, OSM rock and scree, default ICE | Same |
| Tone | Ice: MOA `hp1` (already high-passed), or nothing on flat ice. Coast and rock: class from ADD and BedMachine, with Copernicus 10 m or LIMA 15 m used high-passed for detail | South of 84.5°S: relief only |
| Coast | ADD or OSM (calving line) | Same |
| Sea ice | Daily raster | Monthly climatology |
| Names | Gazetteer, OSM places | Same |

---

## 2. Poles, projections and tile schemes

### 2.1 Polar projections

Definitions and scale factors below are [M], from the local PROJ database and `get_factors`.

| Latitude | EPSG:3031 (true at 71°S) | UPS South, EPSG:32761 (k = 0.994 at the pole) |
|---|---|---|
| 60°S | 1.04255 | 1.0653 |
| 64.77°S (Palmer) | 1.02146 | 1.04375 |
| 71°S | 1.00000 | 1.02183 |
| 77.85°S (McMurdo) | 0.98379 | 1.00526 |
| 80°S | 0.98021 | 1.00161 |
| 85°S | 0.97462 | 0.99589 |
| 89.9°S | 0.97277 | 0.99400 |

- UPS is the companion to UTM south of 80°S and north of 84°N [S](https://en.wikipedia.org/wiki/Universal_polar_stereographic_coordinate_system).
- EPSG:3031 is what the sources are in: REMA, BedMachine, MOA and LIMA all use it [S, M].
- So EPSG:3031 is the right **input** frame for an Antarctic bake. It covers one hemisphere, so it cannot be the global tile frame.

### 2.2 Why UTM fails, precisely

The usual reason, distortion, is wrong. UTM's scale stays at 0.9996 near the pole [M], and Sentinel-2 itself keeps UTM tiles past the 80°S limit: scene `S2B_58CEP` reaches 82.84°S in zone 58 [M]. It fails structurally.

1. **By convention it stops at 80°S and 84°N** [S](https://en.wikipedia.org/wiki/Universal_Transverse_Mercator_coordinate_system). The planned keys `{zone}{N|S}/{rx}_{rz}` have no home for the pole.
2. **Zones pinch.** The convergence at a zone edge stays near 3° all the way down [M: 2.93° at McMurdo, 3.0° at 89.5°S]. Each crossing is therefore a yaw of about 6° [S: audit], while zone width falls to 141 km at McMurdo and 12 km at 89°S. At G3 that is a crossing every 4.7 s, then every 0.4 s [S: audit].
3. **All 60 zones meet at one point.** A 500 km view from the pole would need every zone at once.
4. **It does not exist on the Moon.** USGS defined a lunar version: 45 transverse Mercator strips 8° wide, split at the equator into 90 zones, plus two polar stereographic zones [S](https://data.usgs.gov/datacatalog/data/USGS:667b1061d34e6151c9d6bcc7), [S](https://pubs.usgs.gov/publication/tm11E1). That is a second scheme to carry.

Web Mercator fails harder. It stops at 85.05° [S](https://learn.microsoft.com/en-us/bingmaps/articles/bing-maps-tile-system), and its scale at McMurdo is 4.75× [E], so a nominal 76 m z11 texel becomes 16 m on the ground. WORLD-TRAVEL's AWS Terrain Tiles are in this projection [S: audit].

McMurdo is **inside** UTM's range, in zone 58 (EPSG:32758) [M]. The UTM gap starts 240 km south of it [E]. Audit-limits §4.4 reads as if McMurdo were in the gap. The gap does hold the South Pole and most of the plateau.

### 2.3 Candidate global grids

| Scheme | Cells | At the poles | Area variation | Fit for GPU tile textures |
|---|---|---|---|---|
| **S2** (cube, quadratic projection) | 6 faces, 4-way quadtree, Hilbert order. Levels to 30 [S](https://s2geometry.io/devguide/s2cell_hierarchy) | No singularity: the polar cells extend to ±35.26° at their vertices [S](https://pkg.go.dev/github.com/logician/geo/s2), so a pole is the centre of a face | Area ratio 2.08 [S](https://raw.githubusercontent.com/google/s2geometry/master/src/s2/s2coords.h); my recomputation gives 2.084 [M] | Good. Square tiles, simple to subdivide, one code path for any sphere |
| **Equal-angle cube** (S2's tangent option) | Same | Same | Area ratio 1.414 [S], at about 3× the coordinate cost [S] | Better texels, cost only at bake or CPU. A fair alternative to the quadratic form |
| **HEALPix** | 12 base rhombi, equal area, 4-way nesting [S](https://arxiv.org/pdf/astro-ph/0409513) | Four base cells meet at each pole [E: geometry of 12 bases] | Equal area | Poor. Diamond cells, and shape changes between polar caps and equator [S] |
| **rHEALPix** | Equal area, with square polar caps [E: from memory of Gibb's design, not confirmed here] | Clean | Equal area, good for statistics [S](https://agile-giss.copernicus.org/articles/3/41/2022/) | Middling. Cited as pure Python [S](https://discourse.pangeo.io/t/discrete-global-grid-systems-dggs-use-with-pangeo/2274), so nothing ready for a browser |
| **ISEA / DGGRID** | Hexagons on an icosahedron, aperture 3, 4 or 7 [S](https://archive.linux.duke.edu/cran/web/packages/hexify/refman/hexify.html) | Clean | Strong equal-area property [S](https://agile-giss.copernicus.org/articles/3/41/2022/) | Poor for raster tiles: hexagons do not map to rectangular textures [E] |
| **H3** | Hexagons, only approximately nested [S](https://discourse.pangeo.io/t/discrete-global-grid-systems-dggs-use-with-pangeo/2274) | Clean | Large variation [S](https://agile-giss.copernicus.org/articles/3/41/2022/) | Poor. Better as an index than a raster [S] |
| **Geographic** (lat/lon quadtree) | 2 root tiles | Singular: a whole tile row collapses to a point | Unbounded | Poor at the poles |

**S2 in numbers.**
- Cell statistics are published per level [S](https://s2geometry.io/resources/s2cell_statistics). At level 20 they give 46.41-97.30 m², a ratio of 2.10 [M from that table].
- Over Antarctica the numbers are much better than the global ones. South of 60°S the relative cell area runs 1.78-2.64, a ratio of 1.48, or 1.22× in linear texel size. South of 77.85°S the linear figure is 1.17× [E, computed on a 1200² grid].
- The whole continent sits on one face with no seam through it [E: all of it lies within 30° of the face centre].
- On the Moon, face 0 is centred on the sub-Earth point, so the near side's centre and all six Apollo sites share one face. The poles are two more faces [E: from the cube geometry, assuming the same axes as on Earth].

### 2.4 What shipped engines and globes do

| System | Scheme | What happens at the poles | Label |
|---|---|---|---|
| **Cesium 3D Tiles** | S2 bounding-volume extension, marked complete, usable with implicit tiling, recommended for global tilesets | Built for this. Pole-specific rules not stated in what I read | [S](https://github.com/CesiumGS/3d-tiles/blob/main/extensions/3DTILES_bounding_volume_S2/README.md) |
| **CesiumJS terrain** | Default geographic scheme, 2 × 1 root tiles | Lat/lon maps directly to tile axes | [S](https://cesium.com/learn/cesiumjs/ref-doc/GeographicTilingScheme.html) |
| **Bing tile system** | Web Mercator quadkeys, latitude clipped at 85.05112878° to avoid the singularity | No data past the clip | [S](https://learn.microsoft.com/en-us/bingmaps/articles/bing-maps-tile-system) |
| **Microsoft Flight Simulator** | Users report warped terrain and grids over Antarctica since 2020. A December 2025 thread is titled as a drawing bug south of the 85th parallel, and a May 2025 thread reports unplayable frame rates over the poles | Still reported in late 2025. The link to its tile scheme is user theory, not official | [S](https://forums.flightsimulator.com/t/ever-tried-flying-over-antarctica-things-get-weird-down-there/261835), [S](https://forums.flightsimulator.com/tag/antarctica/143) |
| **X-Plane** | 1° × 1° DSF tiles named by corner | A forum reply says old global scenery stopped at 74°N and 64°S and calls the pole a singularity. Old and unconfirmed | [S](https://developer.x-plane.com/article/dsf-file-format-specification/), [S](https://www.avsim.com/forums/topic/387700-flying-over-the-north-south-poles/) |
| **Kerbal Space Program** | PQS (procedural quad sphere). KSP2 keeps a floating origin | Pole handling not found | [S, excerpt](https://forum.kerbalspaceprogram.com/topic/205930-developer-insights-12-%E2%80%93-planet-tech) |
| **SpaceEngine** | Cube-sphere, one quadtree per face, ships a tool converting cylindrical textures to cube faces | No pole problem by construction | [S](https://spaceengine.org/manual/making-addons/planet-textures/) |
| **Outerra** | Six quadtrees on a spherical cube | Same | [S, forum](https://forum.outerra.com/index.php?topic=81.0) |
| **MapLibre globe** | Web Mercator tiles on a sphere | Changelog lists fixes for holes at the poles with terrain. An earlier study saw poor rendering near the poles | [S](https://data.safetycli.com/changelogs/maplibre), [S](https://developmentseed.org/blog/2024-12-19-casei-globe/) |
| **Pokémon GO, Ingress** | S2 cells at levels 14 and 17, per community research. Niantic has not confirmed it | A phone game keyed by S2 at world scale | [S, community](https://community.wayfarer.nianticlabs.com/t/no-stops-for-2-s17-cells-containing-valid-wayspots/110366) |
| **Moon Trek, LOLA, GLD100** | Three separate pyramids: equirectangular plus north and south polar | The planetary-science norm, and it means three pyramids | [S](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon), [S](https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_GLD100) |

The pattern: systems built on Mercator or lat/lon quadtrees carry a pole problem for years. Systems built on a cube don't have one.

### 2.5 What the planet layer should do

**Use one cube-sphere grid per body.** S2 is the obvious choice because it comes with a specification, published statistics and a 3D Tiles extension. The equal-angle form is worth a bench test because Earth's texels vary less, and that cost is paid only at bake time and on the CPU.

- **Disk paths:** `{body}/{layer}/{face}/{level}/{i}_{j}.bin`. A body id replaces the zone.
- **Server cells:** one S2 cell per paint room. Level 10 is 9 km on Earth, about WORLD-TRAVEL's 8 km square [E]. The same token works on the Moon.
- **Input frames stay native:** EPSG:3031 for Antarctica, equirectangular and polar stereographic for the Moon. Only the output grid is shared.
- **City frames stay as they are.** The audit found the local tmerc fine for any city outside the last degree of latitude. Amundsen-Scott is the one exception and takes a local stereographic frame.

**Texel size by S2 level with 256² tiles** [E, from average cell area]:

| Level | Earth tile edge | Earth texel | Moon tile edge | Moon texel |
|---|---|---|---|---|
| 6 | 144 km | 563 m | 39 km | 154 m |
| 7 | 72 km | 281 m | 20 km | 77 m |
| 8 | 36 km | 141 m | 9.8 km | 38 m |
| 9 | 18 km | 70 m | 4.9 km | 19 m |
| 10 | 9 km | 35 m | 2.5 km | 9.6 m |
| 11 | 4.5 km | 18 m | 1.2 km | 4.8 m |
| 12 | 2.3 km | 8.8 m | 0.6 km | 2.4 m |

**A risk to flag.** WORLD-TRAVEL's clipmap snaps each ring to one lattice in the zone frame so vertices never swim. A cube has six lattices, and they meet with 90° rotations at face edges. Either accept one small vertex change at seams, or use a per-tile quadtree, which costs more draws than the clipmap's 8 [E]. This needs a spike. It doesn't affect Antarctica or the Moon's near side away from seams.

### 2.6 The render frame at a pole

Keep float64 truth, and hold it as Earth-centred XYZ rather than lat/lon. The local frame is a tangent plane at the floating origin, moved by a rotation along the path. Then the pole is an ordinary place.

Three things stay singular only if written with lat/lon, and each is easy to avoid:
- **Headings.** Keep a direction vector. A true heading is undefined exactly at the pole.
- **Sun direction.** Compute it as a vector in Earth-fixed axes, then rotate it into the frame.
- **`geo.ts`.** Its error of 631 m at 1.1 km from the pole [S: audit] goes away.

The extraction side has one trap left: bbox filters cannot express a polar cap, and a box crossing the antimeridian matches almost nothing [S: audit].

---

## 3. The polar sun

Calculated with a low-precision solar formula, sun treated as up when above -0.83° [E, good to about a day]. The South Pole results agree with the source: one sunrise near the September equinox, one sunset near the March equinox [S](https://en.wikipedia.org/wiki/Amundsen%E2%80%93Scott_South_Pole_Station).

| Site | Sun never sets | Sun never rises | No civil twilight | No astronomical twilight | Sun today, 30 Oct | 21 Dec | 21 Jun |
|---|---|---|---|---|---|---|---|
| Palmer 64.8°S | Never | Never | Never | Never | -11.5 to 39.2° | -1.8 to 48.7° | -48.7 to 1.8° |
| Rothera 67.6°S | Nov 30-Jan 12, 44 d | Jun 14-27, 14 d | Never | Never | -8.7 to 36.4° | 1.0 to 45.8° | -45.9 to -1.0° |
| McMurdo 77.9°S | Oct 23-Feb 18, 119 d | Apr 25-Aug 18, 116 d | May 13-Jul 31, 80 d | Never | **1.7 to 25.9°** | 11.3 to 35.6° | -35.6 to -11.3° |
| Vostok 78.5°S | Oct 21-Feb 20, 123 d | Apr 23-Aug 20, 120 d | May 10-Aug 2, 85 d | Never | 2.4 to 25.3° | 11.9 to 35.0° | -35.0 to -11.9° |
| South Pole | Sep 21-Mar 21, 182 d | Mar 23-Sep 19, 181 d | Apr 6-Sep 6, 154 d | May 12-Jul 31, 81 d | **13.7 to 14.0°** | 23.4° | -23.4° |

**What this means for the look.**

- **Polar summer is the game's favourite light for months on end.** DECISIONS rejects flat light because it makes "low-res 3D melt into one grey". At the South Pole the sun can never exceed 23.4° [E]. At McMurdo it stays under 36°. WORLD-TRAVEL's rule compressing elevations above 35° is almost never needed there.
- **The sun circles rather than arcs.** At the pole it moves 15° of azimuth per hour at constant height [E]. Over a 10-minute session that is 2.5°, invisible as motion, so the shadow lattice is no concern. Across sessions, shadows point any way at all, so nothing may be baked to one sun.
- **Shadows get long fast.** Length is 4× height at 14°, 11× at 5°, and 34× at 1.7° [E]. At 1.7° a 200 m hill throws 6.7 km and Erebus throws 128 km [E].
  - The 520-1,604 m shadow window covers buildings only.
  - `City.ts:581` gives far ground no shadows [S: audit].
  - WORLD-TRAVEL switches shadows off above 2 km.
  - The rule "keep all shadows" therefore needs height-field shadows from data here. Section 5.2 gives a way, shared with the Moon.
- **Half the year is dark.**
  - The real sun gives the South Pole 181 days below the horizon, and 81 days without even astronomical twilight [E].
  - WORLD-TRAVEL's end state is one real sun for everyone, with nights as blue hour. Here that means months of night art carried by paint, windows, moon and aurora.
  - That is a good stage for glowing paint, and it can't ship before the night art exists.
- **The interim "session golden band" breaks.** It advances solar time with longitude flown (§2.3). Near a pole a short loop sweeps all longitudes, so the sun would spin [S: audit]. Near the pole, pick the sun from the date and let UTC alone drive azimuth.
- **A simple interim rule:** south of about 60°S, use the real latitude with a fixed summer day of year, so a session always has sun and a player can still see a real low arc [E, a design suggestion].
- **Today's real state is good for screenshots.** McMurdo's midnight sun began about 23 October, and the South Pole's sun sits at 14° all day. At the ceiling lens the top of the frame is about 14.7° above level [E], so a sunward shot at the pole puts the sun at the very top of the frame.

Sea ice, whiteout and ice-crystal halos are extra stages I did not research.

---

## 4. The Moon: what data exists

### 4.1 Elevation

| Product | Grid | Coverage | As served | Size | Licence |
|---|---|---|---|---|---|
| **LOLA 118 m** (USGS) | 256 ppd, 118.45 m, int16 × 0.5 m [M], [S](https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m) | Global | **Uncompressed TIFF, 92,160 × 46,080, one strip per row, no overviews** [M]. 302 redirect to S3 bucket `asc-pds-services`, range reads work [M] | 8,494,203,833 B [M] | Public domain, cite authors [S] |
| **LOLA GDR** (MIT) | 4, 16, 64, 128, 256, 512 ppd cylindrical [M](https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/) | Global | Raw IMG, 512 ppd in 16 tiles | 2.12 GB per 512 ppd tile, about 34 GB total [M] | Not stated there |
| **LOLA polar stereo** | 60 m to 60°, 30 m to 75°, 20 m to 80°, 10 m to 85°, 5 m to 87.5° [M](https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/) | Each pole | Raw IMG, each file about 1.85 GB, also 120 m and coarser | 5 m to 87.5°: 1,840,545,792 B [M] | Not stated there |
| **LOLA south pole 5 m mosaic** | 5 m, 87-90°S, 97 fields [S](https://pgda.gsfc.nasa.gov/products/81) | South pole | GeoTIFF: height, hillshade, slope, count | 3.3 GB height, 820 MB hillshade [S] | Cite Barker et al. 2021 [S]. Near the pole only about 10 % of 5 m pixels hold real returns; the rest is interpolated [S](https://seal.ae.gatech.edu/sites/default/files/2022-10/SIW22-23.pdf) |
| **SLDEM2015** (LOLA + Kaguya) | 512 ppd, 59.2 m [M] | 60°N-60°S [S](https://astrogeology.usgs.gov/search/map/moon_lro_lola_selene_kaguya_tc_dem_merge_60n60s_59m) | Uncompressed TIFF 184,320 × 61,440 int16 [M]. Under `mosaic/LolaKaguya_Topo/` | 22,650,225,603 B [M] | Public domain, cite authors, credit NASA LOLA and JAXA [S] |
| **USGS Kaguya TC DTMs v2** | 7-37 m [S](https://stac.astrogeology.usgs.gov/docs/data/moon/kaguyatc_dtms/). Sampled items 17.5, 19.4, 32.9 m [M] | 70°N-70°S; south polar set too | COG, DEFLATE, 512² blocks, float32, with orthoimages at 8.5-10.5 m and hillshades [M] | 155,925 items in the main v2 collection, 118,379 equirectangular, 19,646 south polar [M] | **CC0-1.0** [M]. Cite USGS and credit JAXA [S] |
| **SLDEM2013** (JAXA) | 4096 ppd, about 7.4 m [S](https://darts.isas.jaxa.jp/en/datasets/sln-l-tc-5-sldem2013-v1.0), [excerpt](https://darts.isas.jaxa.jp/missions/kaguya/faq.html) | Stated as whole Moon | PDS3 by 1° tiles | Not stated | ISAS data policy (section 9) |
| **LROC WAC GLD100** | 100 m grid, effective about 300 m [S](https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_GLD100) | 79°S-79°N, 98.2 % | Quadrangles and polar maps | Not listed | No licence stated, citations required [S] |
| **Chang'e-2 CE2TMap2015** | **Public pair: 7 m image plus 20 m DEM.** A 7 m DEM was reported in the original study but is described as not public [S, excerpts](https://www.mdpi.com/2072-4292/12/3/526), [S](https://www.researchgate.net/publication/325414313_Lunar_Global_High-precision_Terrain_Reconstruction_Based_on_Chang'e-2_Stereo_Images) | Global | Portal `moon.bao.ac.cn` answers 200 [M] but is a script app I could not read | Not found | Terms not found. Free download reported since April 2018 [S](https://en.wikipedia.org/wiki/Chang%27e_2). A 2014 abstract gives -2.8 m mean, 116 m std against the LRO WAC DEM [S](https://meetingorganizer.copernicus.org/EPSC2014/EPSC2014-344.pdf) |

The brief's "Chang'e-2 7 m global DEM" should be treated as a 7 m **image** and a 20 m DEM, unless someone confirms otherwise on the portal.

Kaguya v2 caveats:
- Adjacent DTMs differ by 2-5 m on average, and some carry large blunders [S](https://stac.astrogeology.usgs.gov/docs/data/moon/kaguyatc_dtms/).
- A mosaic of 156,000 strips is a real bake job, with rejection and feathering. It is the one heavy step in the lunar plan.
- USGS keeps `asc-pds-services` and `astrogeo-ard` on S3 [M], so a cloud bake next to the data is natural.

### 4.2 Images

| Product | Grid | Coverage | As served | Size | Licence |
|---|---|---|---|---|---|
| **LROC WAC global morphology mosaic** | 100 m, uint8 [M]. Incidence generally 55-75° [S](https://astrogeology.usgs.gov/search/map/moon_lro_lroc_wac_global_morphology_mosaic_100m) | Global | Uncompressed TIFF, 109,164 × 54,582, one strip per row [M] | 5,959,263,751 B [M] | Public domain, cite authors [S] |
| **LROC WAC Hapke normalised colour** | 400 m at the equator, 7 bands 321-689 nm, 8 tiles [S](https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_HAPKE) | 70°N-70°S | Tiles, plus an 8-bit RGB composite | Not listed | Citation required, no licence stated [S] |
| **LROC NAC** | 0.5 m per pixel [S](https://www.lroc.asu.edu/assets/LROC_instrument_overview-5b07a1035bc2625c486e7f3d5777034224aa9b6ea887b61fcfd962f863c675f9.pdf), regional mosaics 0.5-0.55 m [S](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_MAREFRIGLOA) | Targeted, not global. Share of the Moon not found | Per-region products | Varies | Not found |
| **Kaguya TC orthoimages** (USGS) | 8.5-10.5 m in sampled items [M] | With the DTMs | COG, float32, overviews [M] | Per item | CC0-1.0 [M] |
| **Clementine UV-VIS 750 nm** | 118 m, uint8 [M] | Global | Uncompressed TIFF, 92,160 × 46,080 [M] | 4,247,470,869 B [M] | Not read: my guess at the page URL was a 404 |
| **Moon Trek** | WMTS pyramid over WAC at 303 ppd. Level 0 is 2 × 1 tiles of 256², top of the listing level 8. A sample tile is 49,475 B JPEG [M](https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml) | Equirectangular, north pole, south pole [S](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon) | Open, range OK | Per tile | No terms stated [S]. Fine for preview, not a bake source |

USGS's published "mosaics" are not COGs. Reading a 256² window from the LOLA or WAC TIFF takes one HTTP range per row. A bake should fetch them whole once, in the cloud, and tile from there.

**The baked-shadow trap.** Lunar images are mostly taken for relief, so shadows are in the pixels. The WAC morphology mosaic has incidence angles of 55-75° [S](https://astrogeology.usgs.gov/search/map/moon_lro_lroc_wac_global_morphology_mosaic_100m). Put that in a tone channel under a real, moving sun and a crater would be lit from the east in the image and from the west by the renderer. The audit raised the same problem for stored hillshade. Three ways out:

- **Use an albedo-like base.** WAC Hapke at 400 m is photometrically normalised and is a median of about 40 months of looks [S](https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_HAPKE). Clementine 750 nm was taken at high sun [E, from memory, not confirmed here], and at 118 m it is sharper, though older.
- **Keep only what is finer than the height data.** High-pass WAC at 100 m and Kaguya at 10 m below the DEM's scale. At 1-2 pixels a small shadow reads as texture, and its direction cannot be seen.
- **Let the two cross over with sun height.** At high sun the renderer leans on albedo, at low sun on height shading.

This is a bake rule, not a shader problem. It costs no extra bytes.

### 4.3 Catalogues

| Dataset | Content | Access | Note |
|---|---|---|---|
| **Robbins crater database** | About 1.3 M craters, roughly complete above 1-2 km [S](https://astrogeology.usgs.gov/search/map/moon_crater_database_v1_robbins) | 93 MB [S]. Catalogue page 200, direct download host `astropedia` timed out here [M] | Stable ids per crater, with position and size: the Moon's building list |
| **IAU names** | 9,003 approved names [S](https://planetarynames.wr.usgs.gov/Page/MOON1TO1MATLAS) | `MOON_nomenclature_center_pts.zip`, 23,845,070 B [M](https://planetarynames.wr.usgs.gov/GIS_Downloads) | The street-sign layer |
| **Unified Geologic Map 1:5M** | 43 or 48 units, sources differ [S](https://skyandtelescope.org/astronomy-news/new-incredibly-detailed-geologic-map-moon/) | GIS zip about 224 MB, marked CC0 with "please cite" [S](https://astrogeology.usgs.gov/search/map/unified_geologic_map_of_the_moon_1_5m_2020) | The Moon's land-class map: mare, highland and crater materials |
| **LROC anthropogenic objects** | Soft landers, rovers, payloads, impact craters; IAU Moon 2000 coordinates. Updated 2026-08-14 [S](https://data.lroc.im-ldi.com/lroc/view_rdr/SHAPEFILE_ANTHROPOGENIC_OBJECTS) | 1.50 MB zip [S] | The authoritative landing-site list. Cite Wagner et al. 2017 |

**Landing sites**, from a secondary list [S](https://en.wikipedia.org/wiki/List_of_artificial_objects_on_the_Moon). Use the LROC file for real coordinates.

| Site | Latitude, longitude | Site | Latitude, longitude |
|---|---|---|---|
| Apollo 11 | 0°40′N 23°28′E | Chang'e 3 | 44°07′N 19°31′W |
| Apollo 12 | 3°01′S 23°25′W | Chang'e 4 (far side) | 45°27′S 177°35′E |
| Apollo 14 | 3°39′S 17°28′W | Chang'e 5 | 43°03′N 51°55′W |
| Apollo 15 | 26°08′N 3°38′E | Chang'e 6 (far side) | 41°38′S 153°59′W |
| Apollo 16 | 8°58′S 15°30′E | Chandrayaan-3 | 69°22′S 32°19′E |
| Apollo 17 | 20°11′N 30°46′E | SLIM | 13°19′S 25°15′E |
| Luna 17 with Lunokhod 1 | 38°17′N 35°00′W | Blue Ghost M1 | 18°34′N 61°49′E |
| Luna 21 with Lunokhod 2 | 25°51′N 30°27′E | IM-2 Athena | 84°47′S 29°12′E |

That list gives IM-1 Odysseus as 84°54′S 12°54′E, while its own page gives 80°08′S 1°26′E [S](https://en.wikipedia.org/wiki/IM-1). This is the reason to take positions from LROC's file and not from a secondary list. The list counts 40 major soft landings in total [S].

### 4.4 Mission status, late 2026

- LRO is still working. Its sixth extended mission runs October 2025 to September 2028 [S](https://www.hou.usra.edu/meetings/leag2025/pdf/5073.pdf). Its budget position for 2026 was not found.
- Artemis II flew around the Moon and splashed down on 10 April 2026 [S](https://www.nasa.gov/blogs/missions/2026/04/10/artemis-ii-flight-day-10-re-entry-live-updates/).
- Griffin-1 is reported as no earlier than November 2026, from weak sources [S, excerpt](https://en.wikipedia.org/wiki/Griffin_Mission_One). Blue Ghost 2, IM-3 and Blue Moon Mark 1 are reported slipped to 2027 [S, excerpt](https://en.wikipedia.org/wiki/Commercial_Lunar_Payload_Services).
- Chang'e-7 missed its August 2026 window and now points to 2027 [S](https://scientificamerican.com/article/china-delays-ambitious-change-7-moon-mission-until-2027).

The site list will grow, so it belongs in a data file.

### 4.5 Reference frame and radius

- **Radius:** a sphere of 1,737.4 km is the mapping reference [S](https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m). The Moon's own radii are 1,738.1 km equatorial and 1,736.0 km polar [S](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html). Heights are relative to the sphere, so there is no sea level and no geoid step.
- **Frame:** LRO adopted Mean Earth/Polar Axis for all products, and it is the mapping standard [S, excerpt](https://arxiv.org/pdf/2409.10043). Its difference from the Principal Axes frame is under 1 km at the surface [E: about 875 m from rotation angles of about 68″ and 79″ quoted in a search excerpt]. Since all listed products use Mean Earth, no conversion is needed.
- **CRS:** the Kaguya COGs report `Moon (2015) - Sphere / Ocentric` [M]. USGS names it IAU 2015:30100 [S, excerpt](https://psdi.astrogeology.usgs.gov/moon/standards/data_standards/).
- **Tooling:** PROJ handles lunar-to-lunar transforms but refuses Moon-to-Earth pairs [M: audit], so the bake needs its own CRS branch. Trek reports `EPSG::104903` [M].

### 4.6 Suggested recipe

| Layer | Far | Middle | Near |
|---|---|---|---|
| Height | LOLA 118 m, polar sets | SLDEM2015 59 m to ±60°; LOLA polar 20-60 m | Kaguya v2 mosaic 17-33 m. Hero sites: NAC-derived DTMs, not checked here |
| Tone | Albedo-like: WAC Hapke 400 m or Clementine 118 m | Add high-passed WAC 100 m | Add high-passed Kaguya 10 m; NAC 0.5 m at hero sites |
| Class | Unified Geologic Map | Same | Same |
| Nearest 3-10 km | | | Seeded craters and boulders from known size statistics, placed deterministically, added on top of the real relief |
| Names | IAU, LROC objects | Same | Same |

---

## 5. How the Moon behaves on screen

### 5.1 Geometry

Exact formulas, R = 1,737.4 km and 6,371 km [E].

| Camera height | Moon horizon | Earth horizon |
|---|---|---|
| 2 m | 2.6 km | 5.0 km |
| 83 m (street pose) | 17.0 km | 32.5 km |
| 308 m (250 m pose) | 32.7 km | 62.6 km |
| **666 m (ceiling pose)** | **48.1 km** | 92.1 km |
| 2 km | 83.4 km | 159.6 km |
| 10 km | 186.7 km | 357.1 km |
| 30 km | 324.3 km | 619.0 km |

| Ground distance | 1 km | 3 km | 5 km | 10 km | 20 km | 48 km |
|---|---|---|---|---|---|---|
| Moon drop | 0.3 m | 2.6 m | 7.2 m | 28.8 m | 115 m | 663 m |
| Earth drop | 0.1 m | 0.7 m | 2.0 m | 7.8 m | 31 m | 181 m |

- From the ceiling, the ground is 663 m below tangent at the lunar horizon, nearly the camera's whole height. A flat frame cannot draw it.
- WORLD-TRAVEL's curve chunk handles this with R as a parameter [S: audit], and the far plane must grow past 48 km at the ceiling.
- The horizon frown, from frame centre to edge at the 38° lens, is 0.9 px at the ceiling, 3.5 px at 10 km and 7.7 px at 50 km, against 0.5, 1.8 and 4.0 px on Earth [E]. The Moon needs little or no exaggeration.
- Game pixel at 48 km slant range is 85 m at the 38° lens [E]. So LOLA's 118 m is 1.4 px at the lunar horizon, a good match.

### 5.2 Light

- **No air means no haze, and a black sky.** No aerial perspective exists, so distance reads through size and shadow only. The audit's rule stands: a strategy that needs haze is not a world strategy. Far craters stay as crisp as near ones, and in a 390 px frame that is an advantage.
- **Hard shadows.** There is no sky fill. The only fill is light bounced from nearby ground and earthshine. Shadow ramps should end near-black and stay readable by staying large.
- **The sun moves slowly.** 0.51° per hour; the terminator crawls at 15.4 km/h at the equator [E, from the 29.53-day period [S](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html)]. G0 surge is 112 m/s, 403 km/h [S: repo], so the bus outruns sunset 26 times over. Raking light is a place you fly to, and it stays put for a whole session.
- **High sun flattens relief.** Near local noon shadows vanish, and albedo (mare, rays) takes over. Near the terminator relief takes over. That crossfade is physically right and needs no special case.
- **Polar light.** The Moon's axis tilts only about 1.5° to the ecliptic [S: audit], so the sun skims the horizon at the poles. Shackleton rim sites are lit about 94 % of a lunar year, with no truly perpetual sunlight [S](https://www.lroc.asu.edu/images/271).
- **Shadow length:** at 1.5°, 38× height. A 3 km rim throws 115 km [E].

**Height-field shadows, shared with Antarctica.** A sweep along the sun direction across a 256² height tile touches 65,536 texels, roughly 0.3-1 ms in a worker [E, not benchmarked]. Sun azimuth moves 15° per hour in Antarctica and 0.5° per hour on the Moon, so a tile needs recomputing rarely. Output is one extra byte per texel of light. Sampling a coarser level for distant ridges reaches the horizon. Baking horizon angles in 8 directions instead would cost 8 B per texel raw, more than the height itself [E], so a client-side sweep looks better. This needs a spike on an A15.

### 5.3 Earth in the sky

- Earth is about 1.9° wide (1.8-2.0°), four times the Moon's apparent size from Earth [S](https://en.wikipedia.org/wiki/Earth_phase). At the 38° lens that is about 20 px; at the 50° lens about 15 px [E]. The sun's disc is about 5.5 px [E]. This is big enough to draw, with the real phase and palette ramps.
- Earth hangs nearly fixed in the sky, wandering on an oval about 18° across [S]. It can't be seen at all from the far side [S]. Its phases run opposite to the Moon's as seen from Earth [S].
- **Where it fits in the frame.** The ceiling camera's top row is about 14.7° above level [E]. At Apollo 11 Earth is about 66° up [E: 23.5° from the sub-Earth point], out of frame unless the camera tilts up. Earth only rises into the normal frame within about 15° of the limb: Mare Smythii, Mare Marginis, Orientale's edge, and the poles [E]. An Earthrise is therefore a real destination.
- **Earthshine.** A full Earth is about 43-50 times brighter than a full Moon seen from Earth [S](https://bigthink.com/?p=151561), [S](https://skyandtelescope.org/astronomy-news/how-to-view-earthshine-082720141/). On the near-side night it gives a dim blue fill, which suits a low ramp step. The far-side night is truly dark. There the bus's headlight and glowing paint are the only light, which would look striking.
- **Today:** the Moon is about 19.6 days into its cycle, about 76 % lit and waning, by mean synodic arithmetic [E], so Earth seen from the Moon is about 24 % lit.
- **Ephemeris.** `astronomy-engine` (MIT) runs in the browser and offers `Libration`, `GeoMoon`, `SunPosition` and `RotationAxis` [S](https://raw.githubusercontent.com/cosinekitty/astronomy/master/source/js/README.md). Whether `RotationAxis` applies to the Moon was not confirmed. WORLD-TRAVEL's NOAA formula is Earth-only.

### 5.4 Regolith and the opposition surge

- **Albedo.** Global 0.12, mare about 0.07, highlands about 0.16 [S](https://arxiv.org/pdf/2103.13721). The WAC 8-bit sample gives mare 28.6, highlands 77-90 and Aristarchus 125 [M]. So mare and highlands need roughly a 1:3 spread in the tone channel, across several ramp steps.
- **Rays** come from bright highland-rich ejecta on darker mare [S](https://pubs.usgs.gov/publication/70028235). Tycho's window has a standard deviation of 60 on a mean of 82, 73 % [M]: the highest contrast sampled anywhere in this report.
- **Opposition surge.** Brightness rises more than 40 % between phase angles of 4° and 0°, slightly more in blue [S](https://ntrs.nasa.gov/citations/19990098019). The cause is debated between shadow hiding and coherent backscatter, probably both [S](https://psr.it.helsinki.fi/els/articles/51/article.pdf).
- **In the game this is cheap and beautiful.** A glow of about 41 px radius around the point directly opposite the sun [E: 4° at 10.3 px per degree]. When the sun is behind the camera, it surrounds the bus's own shadow. In the resolve: if the angle between view ray and anti-sun direction is under 4°, step the ramp up by one or two. No texture, one dot product.

### 5.5 What changes in the renderer

The audit lists most of this. Its additions and confirmations:
- **Sky:** NIGHT_SKY ramp always. The bright-horizon value structure inverts.
- **Far fade:** replace with a clean curved horizon.
- **Palette:** regolith as neutral ramps with warmth confined to top steps and violet shadows, so it never reads brown. Colour differences (the 7-band Hapke data shows blue and red mare [E, from general knowledge of the product]) can steer which ramp a mare uses, staying off brown.
- **Particles:** scale gravity. Today's 34 m/s² [S: audit] scaled by 1.62/9.81 gives about 5.6 m/s² [E], and paint arcs slow down sixfold.
- **Sound:** no sonic boom [S: audit]. Sound in vacuum is an art decision, not a physics one.

---

## 6. What a player paints

The audit's fix applies: generalise "building" into "target", anything with a stable id and a footprint. WORLD-TRAVEL's rule is to paint the spout, never the whale.

### The Moon

| Target | Count | Id | Verb |
|---|---|---|---|
| **Craters over 1-2 km** | About 1.3 M [S] | Robbins id | Level 1 fills the bowl. Level 2 crowns the rim. Level 3 throws rainbow rays across the regolith, a Tycho of your own |
| **Named features** | 9,003 [S] | IAU name | The street sign: "MARE TRANQUILLITATIS". Stage anchors, in place of parks and plazas |
| **Maria** | The large dark plains | IAU name | Districts. The firehose's sky-paint clipmap suits them |
| **Rilles and wrinkle ridges** | Named ones | IAU name | Paint runs along Hadley Rille like a river, slowly |
| **Permanently shadowed floors** | At the poles | Geometry | Paint glows in the only true dark on the Moon, and stays lit |
| **Small craters** | Seeded | Hash | Instant satisfaction under the data limit |

**A global goal that needs no new tech.** WORLD-TRAVEL already draws the Moon as a sprite with the real phase. It would be about 5 px at the 38° lens [E], too small for detail, but its tint can show how much of the real Moon players have painted. Players in SF look up and see the shared Moon slowly turn colour.

**The landers are not paint targets.** See below.

### Antarctica

| Target | Count | Note |
|---|---|---|
| **Station buildings** | 1,417 OSM ways [M] | McMurdo's 367 is a proper small city |
| **Peaks, ridges, cliffs, glaciers** | 19,803 features [S] | McMurdo's sample alone has 8 peaks, 6 ridges, 6 cliffs, 5 glaciers [M: audit] |
| **Ice-shelf fronts** | Thousands of km [E] | A long white wall above the sea, a natural firehose stripe |
| **Rock islands** | 0.18 % of the area [S] | Dry Valleys as a stage |
| **Icebergs and sea-ice floes** | Seasonal | WORLD-TRAVEL already reserves these for Antarctic routes |
| **The snow itself** | 14 M km² [S: audit] | Needs the paint clipmap: 160 painted tiles would equal the city's whole draw budget [S: audit] |

Paint reads at its strongest here. White ground has no competing colour, and at 14° sun every stripe gets long violet shadows on the shelf.

### No-paint list

Keep this as baked data, reviewed by a person. It is a tone decision, not a legal one.

| Place | Why | Treatment |
|---|---|---|
| **Lewis Bay, Erebus** | Crash site of TE-901, 257 dead [S](https://en.wikipedia.org/wiki/Mount_Erebus). Antarctic Specially Protected Area 156, with visits allowed to the memorial cross to pay respects [S](https://www.env.go.jp/nature/nankyoku/kankyohogo/database/jyouyaku/aspa/aspa_pdf_en/156.pdf) | No paint, no blast, no target |
| **Apollo sites and other landers** | NASA's 2011 guidance sets keep-out zones: 75 m at Apollo 11, about 200-225 m at Apollo 17 [S](https://www.nasaspaceflight.com/2011/09/protecting-apollo-sites-future-visiting-vehicles-nasa-evaluation/). A later US law makes them binding on NASA-related missions [S](https://www.space.com/one-small-step-space-heritage-act.html) | Use those radii in the game. The only permanently grey circles on a painted Moon, with a sign. That restraint would read as respect, and it is a beautiful image |
| **Fallen Astronaut, Hadley** | Memorial with 14 names, placed in 1971 [S](https://en.wikipedia.org/wiki/Fallen_Astronaut) | Inside Apollo 15's circle |
| **Historic huts** | Discovery Hut is a monument [S](https://en.wikipedia.org/wiki/McMurdo_Station). Scott's other huts were not checked | No paint; a sign |
| **Wildlife** | WORLD-TRAVEL's whale rule | Penguin colonies stay unpainted. Paint the ice around them |

---

## 7. Tile sizes

### Method

- **Samples:** real terrain at the audit's texel sizes, read as small windows. 256² for REMA, Kaguya and Sentinel-2. 128² for LOLA, SLDEM and WAC, scaled ×4, which reads slightly high. Moon strip TIFFs took one range per row.
- **Height encoding:** quantised to a step, 2-D delta predictor (left + up - upleft), zigzag to 16 bits, then zlib level 9. Brotli on a CDN would do somewhat better [E].
- **Tone encoding:** plain deflate of 8 or 32 levels, and delta deflate of 8 bits.
- **Bias:** tone windows use a per-window 1-99 % stretch, an upper bound. A continent-wide stretch would leave flat ice at nearly nothing [E].
- **Not included:** tile headers, the mip overhead (add about 33 %), and any denoising.
- **Why 1 m and 0.1 m:** the game stores decimetres today [S: audit]. 1 m is cheap but terraces flat ice. The right step for ice is in between. 0.25 m is a reasonable guess [E].

### Measured height tile sizes, KB per 256² tile [M]

**Antarctica, REMA v2.0.** Each cell is 1 m step / 0.1 m step.

| Window | 32 m texel | 64 m | 128 m | 256 m |
|---|---|---|---|---|
| Ross Ice Shelf | 1.3 / 10.6 | 3.2 / 14.6 | 5.3 / 19.5 | 6.8 / 22.2 |
| Dome C plateau | 1.6 / 11.6 | 2.0 / 10.7 | 2.8 / 11.1 | 5.8 / 13.2 |
| Plateau at 87°S | 5.7 / 17.7 | 6.5 / 16.5 | 9.3 / 16.7 | 12.2 / 22.3 |
| Rothera | 1.2 / 2.3 | 4.6 / 8.0 | 15.2 / 23.3 | 30.4 / 41.8 |
| McMurdo, Ross Island | 7.7 / 16.8 | 7.2 / 15.6 | 6.6 / 18.1 | 23.0 / 40.8 |
| Transantarctics 84°S | 12.7 / 26.9 | 20.6 / 44.1 | 34.6 / 64.8 | 52.9 / 84.0 |
| Palmer, Anvers | 22.9 / 46.5 | 30.1 / 54.9 | 37.8 / 64.4 | 28.4 / 44.5 |
| Dry Valleys | 22.2 / 48.7 | 33.9 / 65.3 | 48.9 / 81.9 | 59.0 / 89.3 |
| **Blend, 90 % flat ice, 10 % rough [E]** | **3.9 / 14.8** | **5.4 / 16.3** | **8.1 / 19.2** | **11.3 / 23.3** |

**Moon, heights.**

| Window | LOLA 118 m: 1 m / 0.5 m | SLDEM 59 m: about 1 m / native | Kaguya v2: 1 m / 0.1 m |
|---|---|---|---|
| Apollo 11 mare | 29.2 / 34.8 | 35.8 / 45.2 | 14.9 / 29.8 (33 m) |
| Tycho | 48.6 / 58.2 | 48.3 / 58.3 | 12.9 / 25.0 (17.5 m) |
| Central highlands | 33.0 / 39.9 | 37.3 / 46.9 | 12.3 / 20.9 (19.4 m) |
| Aristarchus | 39.6 / 47.7 | 39.6 / 49.2 | not sampled |
| Far-side highlands | 32.4 / 38.5 | 35.8 / 45.2 | not sampled |
| **Mean** | **36.6 / 43.8** | **39.4 / 49.0** | **13.4 / 25.2** |

The 118 m altimetry grid costs more per tile than 33 m stereo. Its bytes are mostly noise between laser tracks. Denoising LOLA before quantising should cut this [E]. SLDEM's native step appears to be 0.5 m [E, from ranges].

**Tone tiles.**

| Source | 8 bit delta | 32 levels | 8 levels |
|---|---|---|---|
| WAC 100 m, five windows | 41-67, mean 53 | 7-31, mean 21 | 5-16, mean 9.5 |
| Kaguya ortho, 8.5-10.5 m | 56-61 | 30-32 | 13-14 |
| Sentinel-2 red, Ross Ice Shelf, 10-160 m, stretched | 51-87 | 27-41 | 11-25 |
| Sentinel-2 red, Dry Valleys, 10-160 m, stretched | 45-60 | 16-29 | 6-14 |

### Totals by level [E]

Areas: Antarctica 14.2 M km² [S: audit], Moon 37.93 M km² [E: sphere]. Sizes use the tables above. Rows finer than 32 m reuse 32 m per-tile sizes, so treat them as rough. On the Moon the data runs out below about 8 m except at hero sites.

| Texel | Tile edge | S2 level, Earth / Moon | Antarctica tiles | Height 1 m / 0.1 m | Moon tiles | Height | Tone 8 levels |
|---|---|---|---|---|---|---|---|
| 256 m | 65.5 km | about 7 / 5-6 | 3,306 | 0.04 / 0.08 GB | 8,831 | 0.33 GB | 0.09 GB |
| 128 m | 32.8 km | 8 / 6-7 | 13,225 | 0.11 / 0.26 GB | 35,325 | 1.32 GB | 0.34 GB |
| 64 m | 16.4 km | 9 / 7 | 52,899 | 0.29 / 0.88 GB | 141,300 | 5.7 GB | 1.37 GB |
| 32 m | 8.2 km | 10 / 8 | 211,596 | 0.85 / 3.2 GB | 565,201 | 7.7 GB | 7.8 GB |
| 16 m | 4.1 km | 11 / 9 | 846,386 | 3.4 / 12.8 GB | 2.26 M | 31 GB | 31 GB |
| 4 m | 1.0 km | 13 / 11 | 13.5 M | 54 / 205 GB | 36.2 M | 495 GB | 499 GB |

**A practical product.**
- **Antarctica to 32 m:** height 4.4 GB at 0.1 m, about 1.3 GB at 1 m. Tone about 0.6 GB (1 KB on flat ice, 10 KB on 10 % rough tiles). Total about 2-5 GB, plus a few hero cities.
- **Moon to 32 m:** height 15 GB, tone 10 GB, about 25 GB. At WORLD-TRAVEL's R2 estimate of about $15 per TB a month, that is under $0.50 a month.

Compare the audit's 1.3-2.3 TB and 3.5-6.1 TB at city-tile quality, which are 4 m grids with city classes. This is more than 100 times smaller. The planet layer doesn't need that density anywhere players can't reach at low altitude.

**On the phone.**
- A clipmap of 8 rings of 256² with height, tone and light is about 1.6 MB of texture [E: 3 B per texel].
- One lunar ceiling view to 48 km spans about 760 km² of ground [E: a 38° sector]. With tiles by distance that is about 15-30 tiles, 1-2 MB to download [E].
- Streaming at G1 is a few KB per second [E].

These fit WORLD-TRAVEL's budgets. No frame of these worlds holds per-building draws at all.

### What resolution each distance can use

Pixel sizes from the audit's ceiling table. Pixels per texel [E]:

| Data | 1 km | 5 km | 20 km | 48 km |
|---|---|---|---|---|
| Pixel across, 38° lens | 2.06 m | 8.56 m | 32.9 m | 85 m |
| LOLA 118 m | 57 | 14 | 3.6 | 1.4 |
| SLDEM 59 m | 29 | 6.9 | 1.8 | 0.7 |
| Kaguya 33 m | 16 | 3.9 | 1.0 | 0.4 |
| Kaguya image 10 m | 4.9 | 1.2 | 0.3 | 0.1 |
| NAC 0.5 m | 0.2 | under 0.1 | | |

---

## 8. Reachability from this machine

Tested 2026-10-30 with curl HEAD, or as noted. Proxy issues reported in WORLD-TRAVEL did not appear for these hosts.

| Host | Result [M] | Use |
|---|---|---|
| `pgc-opendata-dems.s3.us-west-2.amazonaws.com` | 200, ranges, COG reads worked | REMA 2, 10, 32 m |
| `data.pgc.umn.edu` | 200, listing, ranges | REMA 100 m, 500 m, 1 km; LIMA; Quantarctica files |
| `stac.pgc.umn.edu` | 405 on HEAD: alive, POST expected | PGC STAC |
| `copernicus-dem-30m`, `-90m` S3 | 200, ranges | GLO-30, GLO-90 |
| `esa-worldcover` S3 | 404 south of 60°S, listing works | Absent for polar work |
| `lima.usgs.gov` | 200 | LIMA tools |
| `add.data.bas.ac.uk` | Redirects to `add.scar.org`, 200 | ADD |
| `data.bas.ac.uk` | 200 | ADD downloads |
| `media.npolar.no` | 200 | Quantarctica copy |
| `nsidc.org` | 200 | Dataset pages |
| `daacdata.apps.nsidc.org` | **401**, needs Earthdata login | MOA, likely BedMachine |
| `n5eil01u.ecs.nsidc.org` | **Connection failed** | Old NSIDC host |
| `overpass-api.de` | curl **406**; WebFetch worked; **429** after a burst | OSM counts |
| `planet.openstreetmap.org` | 200 | OSM planet |
| `earth-search.aws.element84.com` | 200, POST works | Sentinel-2 catalogue |
| `sentinel-cogs` S3 | COG reads worked | Sentinel-2 scenes |
| `landsatlook.usgs.gov/stac-server` | 200, POST works | Landsat catalogue |
| `stac.dataspace.copernicus.eu` | 405 on HEAD, POST works | CDSE mosaics |
| `sh.dataspace.copernicus.eu` | 503 on HEAD | Sentinel Hub |
| `planetarymaps.usgs.gov` | 302 to `asc-pds-services` S3, 200, ranges | LOLA, SLDEM, WAC, Clementine |
| `astrogeology.usgs.gov` | 200 | Astropedia pages |
| `astropedia.astrogeology.usgs.gov` | **Timed out** | Direct Robbins download |
| `stac.astrogeology.usgs.gov` | 200, POST works | Kaguya DTM catalogue |
| `astrogeo-ard` S3 | 200, COG reads worked | Kaguya DTMs and orthos |
| `planetarynames.wr.usgs.gov`, `asc-planetarynames-data` S3 | 200, ranges | IAU names |
| `trek.nasa.gov` | 200, ranges | Moon Trek |
| `imbrium.mit.edu` | 200, listing | LOLA GDR, SLDEM2015 |
| `pgda.gsfc.nasa.gov` | 200 | LOLA 5 m |
| `pds-geosciences.wustl.edu` | **TLS chain error in this curl**, likely local | PDS copies |
| `lroc.im-ldi.com`, `lroc.sese.asu.edu`, `pds.lroc.im-ldi.com`, `quickmap.lroc.im-ldi.com`, `wms.lroc.asu.edu` | 200 | LROC |
| `data.darts.isas.jaxa.jp`, `darts.isas.jaxa.jp` | 200 | Kaguya |
| `moon.bao.ac.cn`, `clpds.bao.ac.cn` | 200, script-only page | Chang'e |
| `clep.org.cn` | **TLS name mismatch** | Chang'e |
| `www.usgs.gov` | 403 through WebFetch on the EROS LIMA page | Docs only |
| `www.mdpi.com` | 403 through WebFetch | Papers |

---

## 9. Licences

| Data | Terms | Credit or condition | Risk for a commercial game |
|---|---|---|---|
| REMA | CC BY 4.0 on the registry and STAC [S](https://registry.opendata.aws/pgc-rema/), [M]. Publicly available without restrictions after the 2023 agreement [S](https://www.pgc.umn.edu/guides/commercial-imagery/eocl-license-pgc-faq/) | Cite the mosaics. Note that DEMs come from Maxar imagery via PGC [S, excerpt](https://www.pgc.umn.edu/guides/stereo-derived-elevation-models/stereo-usage-guidelines) | Low. PGC's FAQ does not address commercial use directly, but CC BY does. OpenTopography's 2 m limit is its own rule [S](https://www.pgc.umn.edu/data/rema/) |
| REMA `filled_cop30` | As above plus Copernicus | Both credits | Low |
| BedMachine, MOA | NSIDC: citation is a condition of use [S](https://nsidc.org/sites/default/files/documents/user-guide/nsidc-0756-v004-userguide.pdf) | Cite | Low. Terms beyond citation not read |
| Copernicus GLO-30 | Free with attribution [S: WORLD-TRAVEL] | Copernicus, DLR, Airbus | Low |
| ADD | CC BY 4.0 [S](https://data-search.nerc.ac.uk/geonetwork/srv/api/records/815525ca-cefe-4fbf-9224-3ee784e7de4e) | "SCAR Antarctic Digital Database" | Low |
| LIMA, Landsat | Public domain [S](https://lima.usgs.gov/access.php) | Appreciated | None |
| Sentinel-2 and mosaics | Sentinel legal notice, not opened [M: link](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice) | Copernicus credit | Low, read it first |
| COMA | No stated terms [S](https://imagico.de/services//coma.php) | By contract | Paid |
| BAS Sentinel-2 mosaic | Copyright BAS, no terms [S] | Unknown | Do not use without asking |
| OSM, Overture | ODbL and per-source [S: WORLD-TRAVEL] | Existing `DATA_LICENSE.md` pattern | Known |
| SCAR Gazetteer | Reported CC BY [S, secondary](https://docs.ropensci.org/antanym/articles/antanym.html) | Cite | Confirm |
| LOLA, SLDEM2015, WAC mosaic (USGS) | Public domain, please cite [S](https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m) | NASA LOLA, JAXA, LROC team | None |
| USGS Kaguya DTMs and orthos | CC0-1.0 [M], cite USGS, credit JAXA [S](https://stac.astrogeology.usgs.gov/docs/data/moon/kaguyatc_dtms/) | As stated | None |
| JAXA Kaguya via DARTS | Commercial use allowed in principle. CC BY 4.0-compatible, credit "ISAS/JAXA", state modifications [S](https://www.isas.jaxa.jp/en/researchers/data-policy/). No procedure needed except HDTV images [S](https://darts.isas.jaxa.jp/missions/kaguya/faq.html) | Acknowledge TC team and archive [S](https://darts.isas.jaxa.jp/en/datasets/sln-l-tc-5-sldem2013-v1.0) | Low. One JAXA site, Virtual Planet, asks for formal procedures [S, excerpt](https://vp.darts.isas.jaxa.jp/index_en.html), so use DARTS |
| LROC products via `data.lroc` | No licence stated. Citations required [S](https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_HAPKE) | Cite | Medium, confirm for anything not on USGS |
| LOLA 5 m (PGDA) | No licence stated, cite Barker 2021 [S](https://pgda.gsfc.nasa.gov/products/81) | Cite | Low |
| Unified Geologic Map | CC0, please cite [S](https://astrogeology.usgs.gov/search/map/unified_geologic_map_of_the_moon_1_5m_2020) | Cite | None |
| Robbins, IAU names | US government hosted. Terms not read | Cite | Low, confirm |
| Moon Trek | No terms stated [S](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon) | Unknown | Preview only |
| Chang'e-2 | Not found | Unknown | Do not use until read |

The existing `osm:tools/bake/bake.py:2608` credit line says any DEM is USGS 3DEP [S: audit]. That must change before any of this ships.

---

## 10. What this asks of a far-field strategy

The top defect is that most of the city vanishes past the streaming radius and pops in as you approach. Antarctica and the Moon have no city blocks, but they test the same mechanism, more strictly. A strategy that fixes SF should pass these checks without changes, in every city and body.

1. **An always-present pyramid, not a load radius.** Every place has a tile at some level, on a cube grid, keyed by body. Nothing is ever absent, which is what removes pop-in. On the Moon a 48 km view must be filled from the first frame.
2. **Band edges must be invisible without fog.** Crossing from a coarse tile to a finer one must change less than a pixel or two of silhouette, using height morphing and matched tone. The Moon is the proof case: it has no haze to bury a seam.
3. **Three channels, not one.** Height with a per-tile base, a tone channel holding ramp and step, a class channel. These apply to a block-scale city tile as much as a crater. Antarctica uses mostly height. The Moon uses all three. Tone must carry no baked shadows, or it fights the real sun.
4. **Terrain shadows from height, at any distance.** "Keep all shadows" can only hold at altitude if far terrain computes its own light. This also gives cities their hills' shadows.
5. **Gate on nothing but the data.** No height gate, no class gate. Antarctica's class layer and the Moon's are different datasets with the same channel.
6. **Procedural detail only below data resolution.** Seeded craters over the Moon's nearest 3-10 km, windows and roof clutter in cities, sastrugi on ice. It never replaces real data, and it fades out where the data's texel falls to about 2 px.
7. **A `Body` record** (from the audit), with these additions: geoid or reference surface, optional sea level, cube grid, sun model that returns a vector, earthshine, and a no-paint list.
8. **A per-layer source table** by region. REMA in Antarctica, LOLA on the Moon, a bare-earth DEM in cities, each with its own credit line.
9. **Test poses at the extremes.** Add three to the audit's list: McMurdo at midnight sun, the South Pole from 10 km, and the Apollo 11 site at the terminator from the ceiling.

---

## 11. Corrections to earlier documents

| Document | Claim | Finding |
|---|---|---|
| audit-limits §4.4 | McMurdo "is inside" the UTM gap | McMurdo is in UTM zone 58. The gap starts at 80°S [M] |
| audit-limits §8 | No satellite image source for Antarctica | Five exist (section 1.3) |
| audit-limits §8 | Copernicus longitude spacing not confirmed | Handbook Table 3 settles it: 1×, 1.5×, 2×, 3×, 5×, 10× by latitude band [S] |
| audit-limits §8 | How much ice OSM maps as glacier | By convention, none needs mapping: land south of 60°S counts as glacier [S] |
| audit-limits §4.16 | 1.3-2.3 TB and 3.5-6.1 TB | True for 4 m city tiles. A planet pyramid to 32 m is 2-5 GB and about 25 GB [E] |
| audit-limits §6 | "Moon: the WAC mosaic" as the appearance layer | Its shadows are baked in at 55-75° incidence [S]. Use an albedo-like base, with WAC as high-passed detail (section 4.2) |
| WORLD-TRAVEL §1.1 | Geoid undulation can be ignored | Not with REMA: about 50 m at McMurdo [M]. Fine for MSL-like sources |
| WORLD-TRAVEL §1.2 | UTM zones everywhere | Works numerically past 80°S, but the zone scheme itself fails near the pole (section 2.2) |
| WORLD-TRAVEL §2.1 | Bathymetry from Terrain Tiles, class from WorldCover | Both fail in Antarctica: EPSG:3857 and 60°S limits |
| WORLD-TRAVEL §2.6 | Shadows off above 2 km | Removes the main relief cue at the poles and on the Moon |
| WORLD-TRAVEL §3.2 | Uncharted is a fog bank | Cannot exist on the Moon [S: audit]. With an always-present pyramid it isn't needed |
| WORLD-TRAVEL Appendix B | No polar sources | REMA, BedMachine, ADD, MOA, LIMA and lunar sources should join it |
| Brief | Chang'e-2 7 m global DEM | Publicly a 7 m image and a 20 m DEM, per excerpts |
| Brief, general belief | USGS global mosaics are ready to stream | Uncompressed strips, no overviews, no COG [M] |

---

## 12. Not confirmed

**Stopped by the search budget:**
- Whether AntarcticaLC2000's 30 m land cover can be downloaded, and under what terms.
- Bremen AMSR2 sea-ice product licence and access.
- Whether a Kaguya TC global mosaic exists at USGS. Its name appeared in a list on an error page; I did not locate the file.

**Could not open or read:**
- Copernicus mosaic rasters (`s3://eodata` needs an account), so quality over snow is unseen, and I can't say whether tiles past 82.84°S hold data.
- `moon.bao.ac.cn` is a script app, so Chang'e-2 registration, terms and sizes are unconfirmed.
- MDPI's paper page returned 403. The statement that the 7 m DEM is not public comes from a search excerpt.
- BedMachine's and MOA's file-level access: 401 without a login.
- ESA's own Antarctic mosaic download location.

**Weak or conflicting:**
- Griffin-1's date comes from weak sources.
- Pokémon GO's use of S2 is community knowledge, not confirmed by Niantic.
- MSFS's polar problems have no official explanation in anything I read, and its tie to the Bing tile system is inferred.
- X-Plane's 74°N/64°S claim is an old forum post.
- rHEALPix's square-cap design is from memory. The study I read covered its equal-area property.
- Clementine's high-sun geometry is from memory. Its USGS page was not reached.
- The Principal Axes offset of 875 m is my arithmetic from excerpted angles.
- Lunar mare colour differences and the LIMA suffix meaning are my reading.
- `RotationAxis` for the Moon in `astronomy-engine` is unconfirmed.
- Overture's `snow` land-cover polygons reach 80.55°S [M: audit], though the layer is said to derive from WorldCover [S](https://docs.overturemaps.org/blog/2024/05/16/land-cover/). Unexplained, as in the audit.

**Not attempted:**
- Any render, shader or A15 test. Everything about budgets, sweeps and tones is an estimate.
- NAC-derived hero DTMs at Apollo sites.
- LROC NAC share of the Moon covered.
- Scene-level cloud flag reliability on snow.
- The Arctic: Longyearbyen, Greenland and north polar data were out of scope, though the grid and sun sections apply there too.
- Sample limits: 8 Antarctic windows and 5 lunar windows are not a census. Totals assume 90 % flat ice, a figure I chose from the 1.8 % combined rock and blue-ice share and mountain extent [E].
