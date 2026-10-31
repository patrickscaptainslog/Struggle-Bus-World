# Global Earth data for Struggle Bus World

Researched 2026-10-30. This covers what global data exists, what each licence allows a commercial game to do, and what a whole-planet bake would cost.

**Labels.** [M] means measured from this machine today. [S] means taken from the linked source. [E] means my estimate, with the inputs shown.

**Terms.** Licences are paraphrased, with clause numbers so they can be checked. This is research, not legal advice. Have counsel read the originals before relying on them.

**Gap.** The shared WebSearch budget ran out partway through. After that I could only fetch pages I already knew about, so §14 lists what stayed unconfirmed.

---

## 1. The short answer

1. **The data does not force a procedural far field.** Everything needed to draw every block from the ceiling is open, global and bakeable: 10 m imagery, 30 m terrain, 2.53 B footprints and all the streets. The audit found the blobs come from the bake throwing real data away. far.bin stores all 11 land classes and the mesh keeps one bit of them, and the far building layer keeps 1-2 % of buildings ([audit](./audit-limits.md), lines 18 and 106). The producer has the symptom right, but the remedy is to bake the open data we already have, not to buy imagery.

2. **Two free 10 m colour sources allow exactly what we need.**
   - **ESA WorldCover composites** (2020 and 2021): CC BY 4.0, 9.18 TB [M], on an anonymous bucket on the same host the bake already uses.
   - **Copernicus Sentinel-2 Global Mosaics**: quarterly from 2020 through 2026 Q3 [M], 17.70 TB per quarter [M]. The Copernicus legal notice allows distribution, adaptation and combination, with a credit.

3. **Every premium imagery source is closed to baking.** Google, Bing and Mapbox forbid it in writing. Esri, Vantor (formerly Maxar) and Planet are contract products. EOX sells a commercial licence for about €6,000-10,000 per annual mosaic, which the free sources make unnecessary.

4. **No 3D tile service can be baked or stored.** Google Photorealistic 3D Tiles forbids storage, offline use and deriving content. Cesium ion forbids offline copies outside its Clips route. Cesium OSM Buildings is only OSM data we already hold.

5. **Height is the real gap, and it is regional.** Only 8.1 % of Overture's 2.53 B buildings carry a height: 67 % in the USA and Canada, 29 % in northwest Europe, 0.0 % in South Asia and Africa [M, §7]. Google's 2.5D Temporal dataset covers almost exactly the 0 % regions under CC BY 4.0. China, Russia and the Middle East need coarser sources.

6. **Block-level massing is tiny.** A height raster of every SF building at 8 m is 268 KB [M], smaller than today's far.bin at about 300 KB [M], which also holds the far ground. At SF and London ratios the whole planet's 2.53 B buildings come to about 4-13 GB at 8 m, or likely 4-8 GB as block outlines [E]. Per-building meshes would be 160-380 GB [E].

7. **The whole planet is cheap.** Land surface at 10 m with 30 m height and global massing is about 0.65-0.85 TB [E], or $10-13 a month on R2 at its published rate [S]. A full bake is about 1,150 core-hours, or $100-200 including transfer and reruns [E]. It needs a rented machine, because timed reads from S3 managed only 28-92 KB/s here today [M].

8. **ODbL does not touch the game's code or art.** It covers the databases. Keep non-OSM rasters in separate files and they stay outside share-alike. Never merge non-commercial or restricted data into OSM-derived tiles (§9).

9. **Antarctica and the Moon are easy.** REMA and LIMA cover Antarctica, and LOLA and LROC WAC cover the Moon. They are open and small, and the Moon's source files are 14.5 GB [M].

10. **One deadline to plan around.** Overture keeps each release for at most 60 days [S]. A bake must archive its own inputs, or it cannot reproduce itself or answer an ODbL request.

---

## 2. What the top defect needs from the data

The producer's complaint is that from high above San Francisco the blocks are not rendered until you approach them.

**How much resolution the far field needs** [E: 390 px across a 38-50° view]:

| Distance | One game pixel across the view | Enough to fill it |
|---|---|---|
| 3 km | 5-7 m | 8 m massing plus 10 m tone |
| 5 km | 9-11 m | 10 m |
| 10 km | 17-22 m | 10 m |
| 20 km | 34-45 m | 30 m |

Along the view direction the footprint stretches further at grazing angles, so these figures are conservative.

**A 10 m raster is enough past about 5 km.** No expensive imagery is needed for the 20 km view. Below 5 km the blocks need real relief, and that comes from footprints rather than imagery.

**What I looked at.** A 10 km window of one clear Sentinel-2 scene, reduced to 32 colours with a 3x3 majority filter, still shows the Sunset and Richmond street grids and the Golden Gate Bridge ([preview](./earth-tmp/probe/san_francisco_idx32.png)).

Two things follow from those previews:
- Natural colour contains brown, as the Marin hills do, so RGB cannot be used directly. Use the imagery for tone only and let land class choose the ramp. That keeps the palette rule.
- Single scenes are not enough. The Lagos scene is rated 1.35 % cloud, yet the sampled window is visibly full of clouds ([preview](./earth-tmp/probe/lagos_idx32.png)). Composites are required.

**How the same holds in every other city.** Each input is global:

| Band | Input | Global? |
|---|---|---|
| Near tiles | Overture footprints and streets | Yes, 2.53 B buildings [M] |
| 2-6 km massing | The same footprints, merged per block | Yes |
| 3-20 km tone and class | Sentinel-2 composite, WorldCover | Yes, to 60°S; polar sources in §6 |
| Terrain | Copernicus GLO-30 | Yes |
| Height of massing | Regional, see §7 | Filled by rasters where tags are missing |

Because the far bands are derived from the same footprints as the near tiles, a near tile replaces its own mass instead of appearing from nothing. That is a design property the data allows. I have not tested it.

I measured massing size only for SF and London (§11). A dense informal city like Lagos has not been measured.

---

## 3. Surface appearance

"Bake and serve" means a commercial game may restyle the data, bake it into its own tiles and serve those from its own CDN.

| Source | Coverage | Resolution | Latest | Size | Licence | Bake and serve? |
|---|---|---|---|---|---|---|
| **ESA WorldCover S2 RGBNIR composite** | Land, 60°S to 83°N [S](https://docs.terrascope.be/DataProducts/WorldCover/WorldCover.html) | 10 m, yearly median | 2021 (also 2020); not updated [S](https://registry.opendata.aws/esa-worldcover-vito-composites/) | 19,359 tiles, 9.18 TB [M] | CC BY 4.0: registry [S], and the licence tag inside the COG [M] | **Yes.** Credit and state changes |
| **CDSE Sentinel-2 Global Mosaics** | Global tiles [S](https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-global-mosaics); Antarctic tiles exist [M] | 10 m, B02 B03 B04 B08, first quartile over 3 months | 2026 Q3, created 2026-10-06 [M] | 29,586 products, 17.70 TB per quarter [M] | Copernicus [legal notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice), linked from the STAC record | **Yes.** Credit. Free account, quota below |
| Sentinel-2 L2A scenes | Land, about every 5 days; global L2A from Dec 2018 [S](https://registry.opendata.aws/sentinel-2-l2a-cogs/) | 10 m | Live | Archive size not confirmed | Copernicus legal notice | Yes, but clouds mean you must build your own composite |
| EOX Sentinel-2 cloudless 2016 | Global | 10 m | 2016 | Not stated | CC BY 4.0 [S](https://eox.at/2025/03/sentinel-2-cloudless-2024/) | Old. The WMTS is free only for non-commercial use, so there is no clean bulk route |
| EOX Sentinel-2 cloudless 2018-2025 | Global | 10 m | 2024 in the store; 2025 named in the licence text, no store entry seen | Not stated | CC BY-NC-SA 4.0, or paid EOX licence 1.2 [S](https://cloudless.eox.at/documentation/license) | Only with the paid licence, see below |
| Landsat Collection 2 | Global land | 30 m [S](https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC09_C02_T1_L2) | Live | Not confirmed | No limits on use or redistribution; credit asked [S](https://www.usgs.gov/faqs/are-there-any-restrictions-use-or-redistribution-landsat-data) | **Yes.** No ready mosaic. Bucket is requester-pays (anonymous 403 [M]) |
| NAIP | Continental US | Catalog 0.6 m, GSD 1 m [S](https://developers.google.com/earth-engine/datasets/catalog/USDA_NAIP_DOQQ) | 2023 in that catalog | Not confirmed | Public domain with credit [S](https://registry.opendata.aws/naip/) | **Yes**, but US only, so a hero-city upgrade at most |
| Planet basemaps | Global | Not confirmed | Contract | - | NICFI was non-commercial [S](https://assets.planet.com/docs/NICFI_User_Guide_EN.pdf); commercial terms are by contract | No public licence. Current text not read |
| Vantor (Maxar) Vivid | Global | 30 cm [S](https://vantor.com/product/vivid/mosaic/) | Quarterly updates | - | By contract [S](https://rap-docs.maxar.com/Vivid/Vivid_intro.htm) | No public licence. A reseller lists $12/km² [S](https://skywatch.com/?p=998031); that is $1.8 B for all land at list price [E] |
| Esri World Imagery | Global | Mixed | Live | - | Esri terms | **No.** Not for tile export; the export layer is for offline use in ArcGIS apps [S](https://goto.arcgis.com/maps/World_Imagery). Programmatic export of basemap tiles is barred, note 10 of [E300](https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf). The OSM tracing permission covers OSM only [S](https://wiki.openstreetmap.org/wiki/Esri) |
| Mapbox Satellite | Global | Mixed | Live | - | [Product Terms, 2026-10-20](https://www.mapbox.com/legal/product-terms) | **No.** §1.6 bars deriving or extracting (tracing only for non-commercial use or OSM). §1.10 bars redistribution. §2.8.1 caps on-device caching at 30 days and bars redistribution from a cache. §2.8.2 bars using the imagery to enhance any imagery |
| Bing imagery | Global | Mixed | Live; enterprise service ends 2028-06-30 [S](https://learn.microsoft.com/en-us/bingmaps/rest-services/directly-accessing-the-bing-maps-tiles) | - | [TOU, 2024-04-01](https://www.bingmapsportal.com/terms) | **No.** §2(c) bars derivative works, including server-side tile modification. §2(c)(iii) bars tracing. §5(n) bars copying or storing |
| Google imagery | Global | Mixed | Live | - | [GMP terms](https://cloud.google.com/maps-platform/terms), last modified 2026-08-26 | **No.** §3.2.3(a) bars storing or rehosting. (b) bars caching. (c) bars creating content from it, and training ML |

**Picking between the two free sources.**

| | WorldCover composite | CDSE mosaic |
|---|---|---|
| Licence clarity | Plain CC BY 4.0, written into each file [M] | Copernicus notice, via the STAC record |
| Access | Anonymous S3, `esa-worldcover-s2` | Free account, S3 keys |
| Freshness | 2020, 2021 only | Every quarter to 2026 Q3 |
| Clouds | Full-year median of cloud-free pixels [S](https://dataspace.copernicus.eu/news/2023-9-8-worldcover-cloudless-mosaics-available-copernicus-browser) | Three-month window; some gaps stay empty [S](https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-global-mosaics) |
| Antarctica | No, stops at 60°S | Tiles exist; Q3 is polar night there [E] |

Start with the WorldCover composite. It is the same licence and host the bake already uses, and it is the least risky first bake. Use CDSE mosaics later for freshness and high-latitude gaps.

**CDSE limits** [S](https://documentation.dataspace.copernicus.eu/Quotas.html): 12 TB per rolling 30 days, 4 connections, 20 MB/s each. Evading the quota with several accounts is not allowed [S](https://dataspace.copernicus.eu/terms-and-conditions). The RGB share of one quarter is about 13.3 TB [E: 3/4 of 17.70 TB], which is 1.1 months of free quota, or about 2 days of transfer at full speed.

**The one legal seam in CDSE.** Its terms call non-Sentinel portal content non-commercial [S](https://dataspace.copernicus.eu/terms-and-conditions). The mosaic's STAC record links the Sentinel legal notice and gives a Sentinel citation [S](https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-global-mosaics), so I read it as Sentinel data. A one-line email to CDSE support would settle it.

**The Copernicus notice** grants reproduction, distribution, communication to the public, and adaptation, modification and combination, with no non-commercial limit. Adapted data must carry the notice "Contains modified Copernicus Sentinel data [Year]" ([European Commission legal notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice)).

**The EOX commercial licence, read closely** ([legal text](https://cloudless.eox.at/license-legal), [deed](https://cloudless.eox.at/license-deed)):
- The deed allows integrating the imagery in your own product and remixing it, and it names interactive maps and shipped software as examples.
- §3(b)(1) bans direct redistribution, paid or free. §1(c) defines that as making the material available as-is, or anything with a similar economic effect or that substitutes for EOX's products.
- §3(b)(2) limits extraction from your product to what is strictly necessary.
- §2(a)(3) applies the same terms to adapted material.
- Nothing mentions games or baked tiles. A palette-reduced tile served to a game client is probably allowed, but only EOX can confirm it.
- Prices came from a search excerpt of the store: €6,000 for the 2024 mosaic, and €10,000 for the 8-bit global product. The live page loads them dynamically, so I could not read them directly.

---

## 4. 3D tile services

| Service | Caching | Restyling | Derivative works | Offline bake | Usable for this game? |
|---|---|---|---|---|---|
| **Google Photorealistic 3D Tiles** | Only as the client's `max-age` allows [S](https://developers.google.com/maps/documentation/tile/policies). The [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) (2026-10-28) have no Map Tiles section [M], so the §3.2.3(b) default stands | Not addressed. Attribution and logos may not be altered | Barred: §3.2.3(c) bars creating content from Google Maps Content. Your own 3D objects must not be traced or derived from the tiles [S](https://developers.google.com/maps/documentation/tile/policies) | Barred: offline use and geodata extraction are listed as prohibited [S](https://developers.google.com/maps/documentation/tile/policies) | **No.** Live streaming only, with Google attribution. §3.2.3(e) appears to bar use with a non-Google map, and the world here is OSM. A live shader restyle is not expressly barred, but it would still need a key, a billing account and photo meshes on an A15 |
| **Cesium ion global content** | Only per HTTP, or where the third party allows it [S](https://cesium.com/legal/third-party-terms/) | Not addressed for streamed data | Value-Added Clips may be distributed perpetually, subject to attribution and third-party terms (ToS §2.3) [S](https://cesium.com/legal/terms-of-service/) | §2.2.2 bars offline copies of Cesium Data Output, Clips aside. Output may not be used after the term ends (§2.2(b)) [S](https://cesium.com/legal/terms-of-service/) | **No**, except as a paid sales deal. Staff say Cesium World Terrain, Sentinel-2 and OSM Buildings can be licensed for offline use [S, forum](https://community.cesium.com/t/offline-data-for-cesium-unity/25505). Bing imagery cannot be used offline [S, forum](https://community.cesium.com/t/download-portions-of-the-world-and-load-them/19680). Selling ion inside a product needs an integration licence |
| **Cesium OSM Buildings** | As above | As above | ODbL data, about 350 M buildings; heights estimated at 3 m per level [S](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/) | By sales deal. The ToS has a Clips route, but forum posts conflict on what can be clipped | **Pointless.** It is OSM footprints with a default height, and Overture gives us 7 times as many |
| **Cesium's Google and Bing proxies** | Same as the source | - | Cesium's appendix adds that you may not create derivatives, or download tiles for storage or rehosting [S](https://cesium.com/legal/terms-for-google/). Copying or storing Bing content is barred [S](https://cesium.com/legal/terms-for-bing/) | Barred | **No** |
| **Esri's Google Photorealistic 3D Basemap** | - | - | Note 13: no extraction, external databases or derivative works; note 72: internal business use [S](https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf) | Barred | **No** |
| **Bing 3D** | - | - | - | - | I found no public Bing 3D tiles product. Any Bing content falls under the TOU in §3. **No** |

Baking any of these into palette tiles is out. Google's terms also bar using its content to train ML models (§3.2.3(c)(vii)), so a neural "style transfer" from Google tiles is out as well.

---

## 5. Land cover

| Dataset | Coverage | Resolution | Latest | Size | Licence | Bake and serve? |
|---|---|---|---|---|---|---|
| **ESA WorldCover v200** | Land, to 60°S [S](https://docs.terrascope.be/DataProducts/WorldCover/WorldCover.html) | 10 m, 11 classes | 2021 | 2,651 tiles, 124.0 GB [M] | CC BY 4.0 [S](https://zenodo.org/records/7254221) | **Yes.** Already used by the bake |
| **Copernicus LCM-10 (LCFM)** | Global 3x3° COGs | 10 m, 11 classes plus unclassifiable | 2020 V1 is the newest item I could see [M]; 2021-2025 expected later in 2026 [S](https://dataspace.copernicus.eu/node/2766) | Not summed | CLMS [data policy](https://land.copernicus.eu/en/data-policy), full, open and free. Terrascope's STAC says CC BY 4.0 [S](https://stac.terrascope.be/collections/lcfm-lcm-10) | **Yes.** Watch this one: it is the annual successor |
| Esri / Impact Observatory LULC | Global | 10 m, 9 classes | 2023, possibly 2024 [S](https://registry.opendata.aws/io-lulc/) | About 60 GB per year [S, 2021 record](https://www.esri.com/en-us/arcgis-marketplace/listing/products/43c1d2612d134cc19b7f95deef5469db) | CC BY 4.0 [S](https://www.esri.com/about/newsroom/announcements/esri-releases-latest-land-cover-map-with-updated-sentinel-2-satellite-data) | **Yes.** Fresher than WorldCover, fewer classes |
| Dynamic World | Global, per scene | 10 m, 9 classes with probabilities | Near real time | Not stated | CC BY 4.0 [S](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1) | Licence allows it, but it is delivered through Earth Engine, whose free tier is non-commercial [S](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL) |
| **Google Satellite Embedding (AlphaEarth)** | Land and shallow water; polar coverage limited [S](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL) | 10 m, 64 signed-byte values per pixel | 2017-2025 on GCS [S](https://developers.google.com/earth-engine/guides/aef_on_gcs_readme); the EE page and [AWS registry](https://registry.opendata.aws/aef-source/) give shorter ranges | About 90 TB per year raw [E: 1.4 trillion embeddings per year [S, secondary](https://www.theregister.com/2025/07/31/google_ai_maps_world) x 64 B] | CC BY 4.0, provider-pays as of July 2026 [S](https://developers.google.com/earth-engine/guides/aef_on_gcs_readme) | **Yes**, with attribution |
| Meta canopy height | Global | Sub-metre source, cited paper [S](https://registry.opendata.aws/dataforgood-fb-forests/) | Update "TBD" | Not stated | CC BY 4.0 [S](https://registry.opendata.aws/dataforgood-fb-forests/) | **Yes.** Could drive distant forest texture |

**AlphaEarth is the sleeper here.** Clustering its 64-value embeddings into 32-64 classes would give a cloud-free, annual, 10 m "what kind of place is this" map, much richer than 11 land classes. That is the difference between "farmland" and "this particular kind of farmland", which is what stops distant land reading as one colour. It is untested, and it adds 90 TB of input, so it belongs after the first bake.

---

## 6. Terrain, bathymetry, poles and the Moon

| Dataset | Coverage | Resolution | Latest | Size | Licence | Bake and serve? |
|---|---|---|---|---|---|---|
| **Copernicus GLO-30** | Global land. Armenia, Azerbaijan and Moldova opened in 2023_1 [S](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) | 30 m. A surface model, so roofs and trees are in it | 2024_1 at CDSE [S]; the AWS copy's files are dated 2022 [M] | About 0.7 TB [E: 25.2 MB per tile from 848 sampled tiles [M], x about 26,000 tiles] | [Free, open licence](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf), issued 2025-02-21: reproduction, distribution, public communication, adaptation (Art. 4) | **Yes.** Art. 6(b) sets the adapted-data notice. Art. 6(c) requires a set liability sentence in your legal notice. Art. 6(d) bars implying endorsement |
| **Copernicus GLO-90** | Global land | 90 m | Same | SF tile 2.4 MB [M] | Same rights in its own licence | **Yes** |
| **Mapterhorn** | Global at 30 m, finer in many countries [S](https://mapterhorn.com/) | z12 at 512 px; regional to z17 | Planet file dated 2026-09-11 [M] | Planet 355.6 GB [M]; all 459 files 9.93 TB [M] | Code BSD-3 [S]. 151 sources, nearly all CC BY, public domain or national open licences [M] | **Mostly.** A ready pyramid on a CDN. Six Japanese DEM sources sit under GSI terms and a Survey Act approval, which may not pass through to us [M]. Check those before copying Japan |
| AWS Terrain Tiles | Global, with bathymetry | Pyramid to about z15 | Community-driven updates [S](https://registry.opendata.aws/terrain-tiles/) | z10 tile 85 KB [M]; total not stated | Mixed; [attribution list](https://raw.githubusercontent.com/tilezen/joerd/master/docs/attribution.md). You must check each source | **Yes**, with a long credit. Superseded by Mapterhorn and GEBCO |
| NASADEM | 60°N-56°S [S](https://www.earthdata.nasa.gov/data/catalog/lpcloud-nasadem-hgt-001) | 30 m | V001, data from 2000 | About 104 GB, 14,520 granules [S] | Shared without restriction [S]. NASA data is CC0 by default [S](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance) | **Yes.** Older, and no Arctic |
| ALOS AW3D30 v4.1 | 19,051 tiles, excludes Antarctica and Japan [S](https://developers.google.com/earth-engine/datasets/catalog/JAXA_ALOS_AW3D30_V4_1) | 30 m | v4.1 | Not stated | Free under JAXA terms [S](https://www.eorc.jaxa.jp/ALOS/en/aw3d30/terms.htm) | **Not confirmed.** I could not read the policy page. Avoid; GLO-30 covers the need |
| FABDEM | Global bare earth | 30 m | V1-2 | Not confirmed | CC BY-NC-SA 4.0 or paid [S](https://www.fathom.global/product/global-terrain-data-fabdem/) | **No**, unless paid. FathomDEM v1.0 is also CC BY-NC-SA [S](https://zenodo.org/records/14511570) |
| **GEBCO_2026** | Global, ocean and land | 15 arc-seconds | 2026 | 4 GB zipped GeoTIFF, 7.2 GB unzipped [S](https://www.gebco.net/data-products/gridded-bathymetry-data) | Public domain with acknowledgement [S]. A [UNH record](https://scholars.unh.edu/ccom/1757) says CC BY 4.0, so assume attribution | **Yes.** Comes in ice-surface and sub-ice versions |
| **REMA v2 mosaics** | Antarctica | 2, 10, 32, 100, 500 m and 1 km [S](https://www.pgc.umn.edu/data/rema/) | v2.0 (2022) | Full mosaic set about 20 TB; we need only 32 m or 100 m | CC BY 4.0 on the [AWS registry](https://registry.opendata.aws/pgc-rema/); acknowledgement policy applies | **Probably yes.** PGC's own pages do not address commercial use, so confirm with pgc@umn.edu |
| **LIMA** (Antarctic imagery) | Antarctica, with a hole near the pole (82.5°S in a search summary; the catalog page does not give it) | 15 m pan-sharpened [S](https://developers.google.cn/earth-engine/datasets/catalog/USGS_LIMA_MOSAIC?hl=en) | Scenes from 1999-2002 [S] | Not confirmed | Public domain [S] | **Yes.** REMA and a single ICE class can cover the hole |
| **LROC WAC Moon mosaic** | Global Moon | 100 m, 8-bit | June 2013 | 5.96 GB [M] | Public domain, cite authors [S](https://astrogeology.usgs.gov/search/map/moon_lro_lroc_wac_global_morphology_mosaic_100m) | **Yes** |
| **LOLA Moon DEM** | Global Moon | 118 m | March 2014 | 8.49 GB [M] | I saw no licence on this file. The related SLDEM2015 is public domain [S](https://astrogeology.usgs.gov/search/map/moon_lro_lola_selene_kaguya_tc_dem_merge_60n60s_59m) | **Almost certainly yes** |

**Coverage trap.** WorldCover stops at 60°S [S](https://docs.terrascope.be/DataProducts/WorldCover/WorldCover.html), and Sentinel-2 has no useful Antarctic light in Q3 [E]. Antarctica needs its own sources: REMA for height, LIMA for tone, a single ICE class, and Q1 CDSE mosaics for the coast.

**The DSM problem.** GLO-30 includes roofs and trees, so city ground looks lumpy at low altitude. Only fee or non-commercial bare-earth products fix that globally. At far-field altitude it does not matter. In hero cities use national DTMs, which is what Mapterhorn already assembles.

---

## 7. Buildings

### Datasets

| Dataset | Count and coverage | Heights | Latest | Size | Licence | Bake and serve? |
|---|---|---|---|---|---|---|
| **Overture buildings** | 2,533,842,612 buildings, global [M] | `height` on 8.1 % [M] | 2026-10-21.0, schema 2.0.0 [S](https://docs.overturemaps.org/release-calendar/) | 276.9 GB, 512 files [M] | ODbL for the theme [S](https://docs.overturemaps.org/attribution/) | **Yes**, under ODbL |
| OpenStreetMap | 712.7 M objects tagged `building`, 2026-10-30 [M](https://taginfo.openstreetmap.org/api/4/key/stats?key=building) | See the table below | Live | Planet file path returned 404 [M]; Geofabrik reachable | ODbL | **Yes**, under ODbL |
| **Microsoft Global ML** | 1.4 B [S](https://github.com/microsoft/GlobalMLBuildingFootprints), 225 regions | Average height, 174 M in 2023 plus later additions [S] | Last changelog entry 2026-07-24 | Not summed | **CDLA Permissive 2.0 since 2026-03-11** [M](https://api.github.com/repos/microsoft/GlobalMLBuildingFootprints/commits?path=LICENSE) | **Yes.** No share-alike; include the licence text with shared data [S](https://cdla.dev/permissive-2-0/). Overture's page still lists this source as ODbL [S](https://docs.overturemaps.org/attribution/) |
| **Google Open Buildings v3** | 1.8 B in 58 M km²: Africa, South and Southeast Asia, Latin America, Caribbean [S](https://sites.research.google/gr/open-buildings/) | None | v3, May 2023 | Polygons 178 GB [S] | CC BY 4.0 or ODbL, your choice [S] | **Yes** |
| **Google 2.5D Temporal** | Same regions [S](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1) | Raster, 0-100 m | 2023 (annual 2016-2023) | Not stated | CC BY 4.0 or ODbL | **Yes.** 4 m effective resolution; downloadable from Cloud Storage [S] |
| GlobalBuildingAtlas | 2.75 B; 2.68 B LoD1 [S](https://essd.copernicus.org/articles/17/6647/2025/) | Best in class: RMSE 1.5-8.9 m by continent; 3 m rasters | 2025 | Not confirmed | **CC BY-NC 4.0** for polygons, LoD1 and heights; ODbL for the OSM and Microsoft part [S](https://raw.githubusercontent.com/zhu-xlab/GlobalBuildingAtlas/main/README.md) | **No.** Code is MIT with Commons Clause, also non-commercial |
| 3D-GloBFP | Global, per building, year 2020 | RMSE 1.9-14.6 m by region [S](https://essd.copernicus.org/articles/16/5357/2024/) | v2, 2025 | Not stated | CC BY 4.0 [S](https://zenodo.org/records/15487037) | **Yes.** Built on Microsoft footprints; weakest in Japan and Korea |
| GHS-BUILT-H R2023A | Global | 100 m, mean building height, 2018 [S](https://developers.google.com/earth-engine/datasets/catalog/JRC_GHSL_P2023A_GHS_BUILT_H) | R2023A | Not stated | Reuse allowed with acknowledgement [S] | **Yes.** Coarse, but it covers everywhere |
| WSF 3D | Global | 90 m [S](https://geoservice.dlr.de/web/maps/eoc:wsf3d) | 2023, data 2012-2019 | Not stated | CC BY 4.0 [S] | **Yes** |

**Overture's sources today** [S](https://docs.overturemaps.org/blog/2026/10/21/release-notes/): Google 898 M, OSM 707 M, Microsoft 689 M, Zenodo East Asia 212 M, Esri 15 M, IGN Spain 12 M, Vancouver 16 K. So 72 % of Overture's buildings are not from OSM [E: 1 - 707/2534]. The whole theme is still ODbL as distributed.

**National programmes, where I could confirm them:**

| Programme | What | Terms |
|---|---|---|
| USGS 3DEP | Lidar and DEMs, 1 m seamless production since mid-2025 | Free, no use restrictions [S](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) |
| 3DBAG (Netherlands) | LoD buildings | CC BY 4.0 [S](https://docs.3dbag.nl/en/copyright/) |
| PLATEAU (Japan) | LoD1/2 city models | PDL 1.0, compatible with CC BY 4.0; ODbL also allowed; local governments hold copyright on the 3D models [S](https://www.mlit.go.jp/plateau/site-policy/) |
| France, Germany, UK, Austria, Norway, Australia, Canada, New Zealand, others | Open DTMs | 151 sources in [Mapterhorn's list](https://download.mapterhorn.com/attribution.json) [M]: 21 under Licence Ouverte 2.0, 34 US public domain, about 55 CC BY variants, 12 Datenlizenz Deutschland |

### Height coverage by region [M]

Read from all 84,224 row-group footers of Overture 2026-10-21.0: the null counts of `height` and `num_floors`, grouped by row-group centre in hand-drawn boxes. A building can have both, so the columns overlap.

| Region | Buildings (M) | With `height` | With `num_floors` | What fills the gap |
|---|---:|---:|---:|---|
| India and South Asia | 496 | 0.0 % | 0.1 % | Google 2.5D |
| Sub-Saharan Africa | 333 | 0.0 % | 0.3 % | Google 2.5D |
| China and Mongolia | 283 | 0.5 % | 0.7 % | 3D-GloBFP, WSF 3D, GHS-BUILT-H |
| Southeast Asia | 223 | 0.0 % | 0.2 % | Google 2.5D |
| South America | 192 | 2.2 % | 1.5 % | Google 2.5D |
| Northwest Europe | 190 | 28.8 % | 6.4 % | Microsoft heights, 3DBAG, national models |
| USA and Canada | 184 | 67.3 % | 2.5 % | 3DEP |
| East Europe and west Russia | 123 | 0.9 % | 7.8 % | Floors, 3D-GloBFP, GHS-BUILT-H |
| Mexico, Central America, Caribbean | 111 | 0.4 % | 0.7 % | Google 2.5D |
| Middle East, Turkey, Iran | 100 | 0.1 % | 0.4 % | 3D-GloBFP, GHS-BUILT-H |
| North Africa and Sahel | 99 | 0.1 % | 0.6 % | Google 2.5D |
| Southern Europe | 72 | 7.5 % | 13.4 % | Floors, Microsoft, 3D-GloBFP |
| Japan, Korea, Taiwan | 42 | 6.9 % | 4.7 % | PLATEAU in Japan; 3D-GloBFP is weakest here |
| Nordics and Baltics | 39 | 3.3 % | 5.7 % | Floors, national models |
| Russia east, Central Asia | 21 | 0.1 % | 4.0 % | 3D-GloBFP, GHS-BUILT-H |
| Australia, NZ, Oceania | 17 | 48.3 % | 1.6 % | Tags |
| **World** | **2,534** | **8.1 %** | **2.0 %** | |

**City boxes** (±0.3-0.5° metro boxes, so they include suburbs), `height` then `num_floors`:

| `height` over 50 % | 10-50 % | Under 10 % |
|---|---|---|
| Los Angeles 96.7 / 0.7 | London 44.1 / 13.2 | Moscow 0.4 / 13.1 |
| New York 91.1 / 1.1 | Sao Paulo 29.6 / 0.3 | Seoul 5.8 / 9.4 |
| San Francisco 77.9 / 1.9 | Paris 17.6 / 5.3 | Dubai 0.5 / 4.5 |
| Sydney 67.4 / 3.4 | Amsterdam 13.9 / 2.9 | Shanghai 0.1 / 0.5 |
| Berlin 59.1 / 18.4 | Tokyo 11.6 / 10.8 | Beijing 0.1 / 1.0 |
| | | Delhi 0.0 / 0.2 |
| | | Lagos 0.1 / 0.1 |
| | | Jakarta 0.1 / 0.5 |

**Do not mix these with the audit's numbers.** This table counts any non-null Overture `height` over a metro. The audit counts OSM tags in small central samples, for example Amsterdam 87.9 % and London 3.8 % ([audit](./audit-limits.md), lines 40-42). Both are right for what they measure.

**How much height accuracy matters.** At 5 km one game pixel is about 10 m (§2), so an RMSE of 5-10 m is about one pixel of error at that range [E]. The far field does not need better than the open rasters give.

---

## 8. Streets, water, coastlines, night lights

| Dataset | Coverage | Resolution | Latest | Size | Licence | Bake and serve? |
|---|---|---|---|---|---|---|
| **Overture transportation** | Global: OSM 95.1 M km, TomTom 2.0 M km [S](https://docs.overturemaps.org/blog/2026/10/21/release-notes/) | Vector | 2026-10-21.0 | Segments 72.5 GB [M] | ODbL; credit TomTom too [S](https://docs.overturemaps.org/attribution/) | **Yes**, under ODbL |
| Microsoft RoadDetections | Worldwide, 54.2 M km [S](https://raw.githubusercontent.com/microsoft/RoadDetections/main/README.md) | Vector | - | World file 16.6 GB | ODbL | **Yes**, under ODbL |
| **Overture water and land** | Global: water 66.8 M, land 76.6 M features [S](https://docs.overturemaps.org/blog/2026/10/21/release-notes/) | Vector | 2026-10-21.0 | Water 28.8 GB [M] | ODbL plus other credits [S](https://docs.overturemaps.org/attribution/) | **Yes**, under ODbL |
| OSM land polygons | Global coastline | Vector | Regular updates | 928.6 MB [M] | ODbL [S](https://osmdata.openstreetmap.de/data/land-polygons.html) | **Yes**, under ODbL |
| Natural Earth | Global | 1:10 M to 1:110 M | - | 587 MB package [M] | Public domain [S](https://www.naturalearthdata.com/about/terms-of-use/) | **Yes.** No ODbL, good for orbit |
| JRC Global Surface Water | Global | 30 m | v1.4 | 30 MB per tile [M] | Free, no restriction of use, credit asked [S](https://developers.google.cn/earth-engine/datasets/catalog/JRC_GSW1_4_Metadata?hl=en) | **Yes.** A non-OSM water mask |
| HydroLAKES | 1.4 M lakes over 10 ha | Vector | v1.0 | 820 MB [M] | CC BY 4.0 [S](https://www.hydrosheds.org/products/hydrolakes) | **Yes** |
| HydroRIVERS | 8.5 M reaches | Vector | - | 544 MB [S](https://www.hydrosheds.org/products/hydrorivers) | Free for commercial use, HydroSHEDS terms [S] | **Yes** |
| **NASA Black Marble** (VNP46A4) | Global | 15 arc-seconds, about 500 m | Annual from 2012 [S](https://blackmarble.gsfc.nasa.gov/) | Not stated | Free and open. NASA default is CC0 [S](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance) | **Yes.** Real night glow. Site carried a funding-lapse banner, so check it is current |
| EOG VIIRS annual (V2.2) | Global | 15 arc-seconds | Latest year not stated | Not stated | "Many" products CC BY 4.0, check the one you use [S](https://eogdata.mines.edu/products/vnl/) | **Probably.** curl fails TLS verification here [M] |

---

## 9. ODbL: what falls on baked tiles and on the game

Sources: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), [OSMF FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ), and the OSMF guidelines linked below.

**On the game**
- **Share-alike reaches databases only.** Creating a Produced Work does not make the work a Derivative Database (ODbL 4.5). The game's code, shaders, art and screenshots stay ours.
- **Attribution.** Games may credit on a splash, in the game view, on a credits page or in a menu. The credit must name OpenStreetMap and make the ODbL clear, and a link to openstreetmap.org/copyright does that ([guidelines, adopted 2021-06-25](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)). Today's opening credit fits. If the first credit is short, the fuller detail must be reachable elsewhere.

**On the tiles**
- **Produced Work or Derivative Database?** A result meant for extracting the original data is a database. Otherwise it is a Produced Work ([guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline)). The FAQ says a self-run tile service is likely a Produced Work. Neither page mentions games or vector tiles.
- **Our tiles can be read back into footprints**, and `citydata.py` does so. So keep the conservative position `DATA_LICENSE.md` already takes: treat them as a Derivative Database.
- **The practical result is nearly the same either way.** A public Produced Work made from a Derivative Database still triggers 4.4 and 4.6, and recipients can ask for the data (FAQ §1.7.1).
- **What 4.6 asks.** Offer a machine-readable copy of the Derivative Database, or a file of changes, or the method used to make them. Online delivery must be free. Publishing the bake recipe and keeping tiles fetchable satisfies this.
- **No DRM.** 4.7 bars technical restrictions unless an unrestricted copy is offered in parallel. Do not encrypt tiles.
- **No extra terms.** 4.8 means a game EULA must not forbid extracting the ODbL tile data.

**On mixing data**
- **Non-OSM data stays free if it is independent.** Within a regional cut, each feature type must be all OSM or all non-OSM, and the sets must not reference each other. A database key or a join counts as a reference ([Collective Database guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline)).
- **Merging is the trap.** Merging a private list with OSM and deduplicating it creates a combined database, so the private data may fall under share-alike (same guideline). Mixing OSM and non-OSM data for one feature type triggers share-alike even across layers ([Horizontal Layers](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Horizontal_Map_Layers_-_Guideline)).
- **Bake transforms are not exempt.** Trivial Transformations covers OSM-only reformatting and simplification, and it stops as soon as another source is involved. It is also still a proposal ([guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Trivial_Transformations_-_Guideline)).
- **Country-sized swaps are allowed.** A Regional Cut lets a whole country use another source with no share-alike across the boundary, but it should be at least a country and must not cherry-pick ([guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Regional_Cuts_-_Guideline)).

**What this means file by file:**

| Product | Contains | Treat as | Obligation |
|---|---|---|---|
| Region tiles, metro tiles, massing rasters, block outlines | Overture buildings and streets, conflated heights | Derivative Database, ODbL | Keep the notice, publish method and tiles, no DRM, no EULA limits |
| Surface tone and class raster | Sentinel-2 and WorldCover only | Independent layer | Copernicus and CC BY credits. **Stays out of ODbL only if no OSM is burned in** |
| Terrain | Copernicus and others | Independent layer | Copernicus notices |
| Street and water overlays | Overture | ODbL | Keep as a separate file from the surface raster |
| Player paint keyed by building id | Our own data, joined by id | Probably independent; the guideline's phone-number example points that way, but keys count as references | **Ask counsel** |
| Game code and art | Software | Ours | Attribution only |

**Three rules that follow:**
1. Burning streets into the tone raster makes that raster ODbL. It is legal with CC BY and Copernicus inputs, but it spreads share-alike with no benefit. Keep streets in their own layer.
2. As I read their licences, heights from Google 2.5D, Microsoft, 3D-GloBFP or GHS can be merged into ODbL footprints, as long as they keep their credits.
3. **Never merge EOX, FABDEM, GlobalBuildingAtlas or any other NC or restricted data into an ODbL tile.** ODbL would need the merged data opened, and you do not have that right.

---

## 10. Reachability from this machine [M]

Tested with curl HEAD on 2026-10-30, about 18:30-19:30 PDT, with a 1-byte GET where a host refused HEAD. "Open" means an anonymous 200 on a real file or listing.

| Status | Hosts |
|---|---|
| **Open, data file confirmed** | `esa-worldcover`, `esa-worldcover-s2`, `copernicus-dem-30m`, `copernicus-dem-90m`, `e84-earth-search-sentinel-data`, `elevation-tiles-prod`, `download.mapterhorn.com`, `minedbuildings.z5.web.core.windows.net` (Microsoft), `storage.googleapis.com/open-buildings-data`, `storage.googleapis.com/global-surface-water`, `dataforgood-fb-data`, `planetarymaps.usgs.gov`, `naciscdn.org`, `data.hydrosheds.org`, `osmdata.openstreetmap.de`, `ladsweb.modaps.eosdis.nasa.gov` |
| **Open, listing or catalogue** | `overturemaps-us-west-2`, `usgs-lidar-public`, `pgc-opendata-dems`, `data.pgc.umn.edu`, `earth-search.aws.element84.com`, `stac.dataspace.copernicus.eu`, `catalogue.dataspace.copernicus.eu`, `landsatlook.usgs.gov`, `us-west-2.opendata.source.coop` (AlphaEarth, path-style URL) |
| **Open, site only** | `gebco.net`, `tiles.maps.eox.at`, `blackmarble.gsfc.nasa.gov`, `human-settlement.emergency.copernicus.eu`, `download.geofabrik.de`, `service.pdok.nl` (AHN), `geoservices.ign.fr`, `huggingface.co`, `www.mlit.go.jp/plateau`, `www.geospatial.jp` |
| **403 without a key or payer** | `eodata.dataspace.copernicus.eu` (needs CDSE keys), `usgs-landsat` and `naip-visualization` (requester pays), `data.3dbag.nl` root |
| **Failed or odd** | `jeodpp.jrc.ec.europa.eu` timed out; `eogdata.mines.edu` failed TLS verification in curl; `zenodo.org` 403 to curl (WebFetch read it); `mediatum.ub.tum.de` 429; `planetarycomputer.microsoft.com` 502 on the NAIP collection; `planet.openstreetmap.org/planet/planet-latest.osm.pbf` 404 (wrong path, host answers) |
| **Key required, by design** | `tile.googleapis.com` 404 without a key, `api.cesium.com` 401 without a token |

**Throughput was poor today:** three timed range reads gave 28 KB/s and 85 KB/s from eu-central-1 and 92 KB/s from us-west-2 [M]. Other workflows were running at the time, so this is not a baseline. Either way this machine cannot pull terabytes.

---

## 11. Storage and compute for the whole land surface

### Real compression, measured

**Method.** Six 1024 x 1024 windows of open Sentinel-2 scenes (SF, Central Valley, Lagos, Sahara, Amazon, Tokyo), quantised by median cut with no dither, then cleaned with a 3x3 majority filter. Bits per pixel (bpp) below are means over the six sites, using zstd-19 unless stated. Scripts are in §15.

| Scale | 16 colours | 32 colours | 64 colours | Same, no cleanup (32 colours) |
|---|---:|---:|---:|---:|
| About 10 m | 2.24 bpp | 2.94 | 3.55 | 3.96 |
| About 40 m | 1.97 | 2.61 | 3.28 | 3.65 |
| About 80 m | 1.66 | 2.25 | 2.87 | 3.22 |

- **Spread across sites** at 10 m and 32 colours, with Brotli-9: 2.09 (SF, half ocean) to 3.98 (Amazon).
- **PNG8 nearly matches zstd-19:** 2.19 bpp at 16 colours and 3.19 at 32, and browsers decode it natively.
- **The majority filter saves about a quarter** and removes pixel noise as well.
- **Tile size barely matters.** Cutting 1024² into sixteen 256² tiles cost only 1-2 % on the 10 m tone channel [M].
- **Tone-only floor.** Eight fixed luminance steps cost just 0.58 bpp [M], but fixed thresholds flattened the Sahara and Amazon to one or two steps. Real tone needs per-class steps, so use the 16-colour figure.
- **Do not dither in the raster.** Dither at render time, in screen space.

**Height** (1 m steps, 2D predictor, zstd-19):

| Terrain | 30 m | 90 m |
|---|---:|---:|
| SF hills | 1.35 bpp | 1.90 |
| Kansas (flat, but DSM speckle) | 1.57 | 2.12 |
| Sierra Nevada | 3.36 | 5.16 |
| Himalaya | 4.22 | 6.16 |

**Cross-checks from real global products** [M]:
- WorldCover map: 124.0 GB, or 0.74 bits per true-area 10 m land pixel, for 11 classes.
- WorldCover composite: 9.18 TB, or 54 bits per land pixel. That is the 16-bit reflectance we would throw away. Palette baking saves about 20:1.
- Mapterhorn z0-z12: 355.6 GB for global height, about 5 times my height estimate. It carries sub-metre precision, lossless WebP and Web Mercator oversampling, so treat my height figure as a floor.

### Storage [E]

**Inputs:** land 148.94 M km² [S](https://en.wikipedia.org/wiki/Earth), true-area pixels, a 4/3 pyramid, and a 2.6 bpp height at 30 m or 3.9 bpp at 100 m (means of the four terrains above). Surface at 30 m and 100 m is interpolated from the 40 m and 80 m rows. R2 at $0.015 per GB-month, with free egress [S](https://developers.cloudflare.com/r2/pricing/).

| Surface pixel | Pixels (base) | Surface, 16-32 colours | Height | Total | Per km² | R2 per month |
|---|---:|---:|---:|---:|---:|---:|
| **10 m** (height at 30 m) | 1.49 T | 556-730 GB | 72 GB | **0.63-0.80 TB** | 4.2-5.4 KB | $9-12 |
| **30 m** | 165 G | 57-75 GB | 72 GB | **128-146 GB** | 0.9-1.0 KB | about $2 |
| **100 m** | 14.9 G | 4.0-5.5 GB | 9.7 GB | **14-15 GB** | 0.1 KB | about $0.20 |

No global open DEM is finer than 30 m, so a 10 m surface sits over 30 m height.

**Error bars.** Allow ±30 %. Six sites is a small sample, single scenes are noisier than composites, and ice and desert will be well below the mean while tropical forest will be above it. These figures assume a true-area grid such as UTM plus polar stereographic. Web Mercator or plain lat-lon would add up to about twice as many pixels at high latitudes.

**Moon:** 3.79 G pixels at 100 m plus height at 118 m is about 3 GB with pyramid, assuming Earth-like bpp. The source files are 14.5 GB [M].

### 2.5 B buildings as block-level massing

**Measured on the cached Overture extracts** (one 8-bit height channel in 2 m steps, tallest building wins each cell, zstd-19, whole city as one raster):

| | San Francisco | London sample |
|---|---:|---:|
| Buildings | 172,952 | 9,179 |
| Mean / median footprint | 197 / 129 m² | 254 / 108 m² |
| Roofs as share of the bounding box | 13 % | 25 % |
| **8 m raster** | **268 KB, 1.55 B per building** | 16.2 KB, 1.77 B |
| **16 m raster** | **91 KB, 0.53 B** | 5.8 KB, 0.63 B |
| **32 m raster** | **27 KB, 0.15 B** | 1.7 KB, 0.18 B |
| Street-bounded blocks with buildings | 5,040 | 340 |
| Buildings per block, mean / median | 34.3 / 31 | 25.8 / 15 |
| Block outline vertices, mean / p90 (4 m buffer, 6 m simplify) | 31 / 47 | 25 / 45 |

For scale, SF's far.bin is 299-310 KB [M] and holds 1-2 % of buildings plus the far ground.

**Global extrapolation** [E: 2,533,842,612 buildings x the ratios above. The high end allows 3 times more per building for dispersed rural and informal fabric, which I did not measure]:

| Form | Global size | Smaller than per-building meshes by |
|---|---:|---:|
| Per-building mesh, today's 64-151 B per building ([audit](./audit-limits.md) line 332) | 160-380 GB | Baseline |
| Block outlines (50-250 M blocks at 60-85 B each) | 3-21 GB, likely 4-8 GB | Roughly 20-85 times, at the likely size |
| Height raster at 8 m | 4-13 GB | Roughly 10-100 times |
| Height raster at 16 m | 1.3-5 GB | Roughly 35-300 times |
| Height raster at 32 m | 0.4-1.4 GB | Roughly 100-1,000 times |

**Triangles.** A 31-vertex block extruded with a flat roof is about 90 triangles, so all of SF as blocks is about 450 K [E: 5,040 x 91]. That fits the 1.0-1.5 M budget before any distance reduction. Whether the raster or the outline form draws better on an A15 needs testing on a phone.

### Compute and cost [E]

**Measured single-thread rates on this laptop**, under load from other workflows:

| Step | Rate |
|---|---|
| Palette quantise | 0.22 s per Mpx |
| Majority filter (numpy) | 0.30 s per Mpx |
| zstd-19 | 0.50 s per Mpx |
| zstd-9 | 0.04 s per Mpx |
| Rasterising footprints | about 26,600 per second |
| Block outline unions | 214 per second |

**Assumptions:** 0.5 s per Mpx for read and warp, $0.02-0.05 per vCPU-hour, and $50-90 per TB to move results out of a cloud to R2. The last two are from memory and unconfirmed.

| Job | Input | Core-hours | Compute cost |
|---|---|---:|---:|
| 10 m surface | 9.18 TB composite | 840 | $17-42 |
| 30 m surface | Same | 93 | $2-5 |
| 100 m surface | Same | 8 | Under $1 |
| 30 m height | About 0.7 TB GLO-30 | 60 | $1-3 |
| Massing, 3 rasters | 277 GB buildings | 110 | $2-6 |
| Block labelling and outlines | Plus 72 GB segments | 150 | $3-8 |
| **Full stack: 10 m surface, height, massing, blocks** | About 10 TB | **about 1,150** | **$25-60** |

The 30 m and 100 m rows are alternatives to the 10 m row, not additions, because those levels come from the 10 m pyramid.

Moving 0.65-0.85 TB out to R2 adds about $30-75. Allowing for failed runs, budget **$100-200 all in**.

The World-Travel estimate of $30-350 for per-building tiles is the same order. The difference is in storage: tens of GB for the far building layer rather than 0.4-2 TB.

**Ongoing:** a yearly surface rebake costs about the same. Refreshing massing monthly with Overture costs under $20 a time, because only changed regions need work.

---

## 12. Recommended stack

| Layer | First choice | Upgrade later | Why |
|---|---|---|---|
| Surface tone | WorldCover 2021 composite | CDSE quarterly mosaics | Plain CC BY 4.0, anonymous, clean year median |
| Surface class (picks the ramp) | WorldCover 2021 | LCM-10 annuals, AlphaEarth clusters | Already in the bake |
| Terrain | GLO-30 | National DTMs, via Mapterhorn or direct | Global and clear licence |
| Ocean floor, ice | GEBCO_2026 | | 15 arc-seconds, public domain |
| Footprints | Overture | | Everything in one schema, stable GERS ids |
| Heights ladder | Tags, then Microsoft, then Google 2.5D, then 3D-GloBFP, then GHS-BUILT-H or WSF 3D, then neighbours | LiDAR, PLATEAU, 3DBAG in hero cities | Covers the 0 % regions |
| Streets and water | Overture, as separate layers | | Keeps the surface raster outside ODbL |
| Night | Black Marble | | Real lights, no licence burden |
| Antarctica | REMA 32-100 m, LIMA, ICE class | Q1 CDSE coast | WorldCover stops at 60°S |
| Moon | LOLA 118 m, LROC WAC 100 m | SLDEM2015 | Public data, tiny |

**Credits the game must carry.** Each needs a line in `DATA_LICENSE.md` and the tuner:
- OpenStreetMap and Overture, plus Overture's per-theme list, including TomTom for streets [S](https://docs.overturemaps.org/attribution/).
- The Copernicus Sentinel notice, with the year.
- The WorldCover consortium credit, which is embedded in each COG's tags [M].
- The GLO-30 notice of Art. 6(b) and the liability sentence of Art. 6(c) [S](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf). World-Travel lists the first but not the second.
- The CDLA Permissive 2.0 text, if we share Microsoft data outside Overture.
- CC BY credits for every other source used, and a note that the data was changed.

---

## 13. Corrections to WORLD-TRAVEL.md

| Where | It says | Now |
|---|---|---|
| Appendix B, §4.1, §10 | PLATEAU hosts return 403 here | `www.mlit.go.jp/plateau` and `www.geospatial.jp/ckan/dataset/plateau` both return 200 today [M]. I tested those pages, not the data files |
| §3.2 | Global bake is 0.4-2 TB | True per building. A block-level far layer is single to low double-digit GB [E] |
| §2.1 | Planet z0-z11 is "a few GB" | About 24 GB for surface plus height at 76 m [E, §11] |
| §2.1 | Bathymetry from AWS Terrain Tiles | GEBCO_2026 at 15 arc-seconds is a better, simpler source [S] |
| Appendix B | Overture licence varies by source | Overture documents the buildings, base and transportation themes as ODbL at theme level [S](https://docs.overturemaps.org/attribution/) |
| §3.3 step 7 | GHS-BUILT-H "not checked" | Open with acknowledgement [S]. The JRC FTP timed out here; try the GHSL site, which answers [M] |
| §3.3 | Heights ladder | Add Microsoft heights, Google 2.5D and 3D-GloBFP. Keep GlobalBuildingAtlas out, it is non-commercial |
| §3.2 | Re-bake on each monthly release | Archive inputs. Overture removes releases after 60 days, and 4.6 still applies [S](https://docs.overturemaps.org/release-calendar/) |
| Planet layer | Land class from WorldCover | Add polar sources. It stops at 60°S |
| Appendix B | Copernicus "free with attribution" | Also needs the Art. 6(c) liability sentence |

**Also in the calendar:** 2026-12-16 is reserved for an Overture major breaking-change release [S](https://docs.overturemaps.org/release-calendar/). Schedule bake-format work around it.

---

## 14. Not confirmed

- **EOX prices** came from a search excerpt, because the store page loads them dynamically. **The 2025 mosaic** is named in the licence text but I saw no store entry.
- **Planet's** current licence text was not read. NICFI's end date conflicts between sources.
- **Vantor** terms are contract-only. The $12/km² figure is a reseller's list price.
- **Esri's** Master Agreement was not read. I relied on E300 and the item page.
- **Cesium's** Appendix A was not read, so I do not know exactly which datasets Clips covers. Forum replies from different years conflict on partial downloads.
- **JAXA AW3D30** commercial terms: the policy page returned no text.
- **GEBCO_2026** licence: public domain on GEBCO's site, CC BY 4.0 on a third-party record.
- **REMA** commercial use: AWS lists CC BY 4.0, and PGC's own pages are silent.
- **LOLA 118 m**: the file exists, but I did not read its own licence record.
- **CDSE mosaics:** I read them as Sentinel data (§3). Confirm by email.
- **Google 2.5D** size and vertical error, **3D-GloBFP** building count and size, and the **GlobalBuildingAtlas** size were not found.
- **France, Germany, UK:** national terms come from Mapterhorn's list and the Mapzen list, not from the agencies. IGN's page returned no readable text. German LoD2 is state by state, and only a vendor blog summarised it.
- **National orthophoto programmes** were not surveyed. Several may be open at under 1 m, which is relevant for hero cities only.
- **GSHHG, ETH canopy height, Global Human Settlement totals and a global block count** were not checked, because the search budget had gone. The block count here is extrapolated from SF and London only.
- **GLO-30 total size** is a sample estimate, and its tile count of about 26,000 is from memory.
- **Spot and egress prices** in §11 are from memory.

---

## 15. Evidence

Everything is under `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/`.

| What | Path |
|---|---|
| Palette and height compression | `earth-scripts/compress_probe.py`, `earth-tmp/probe/compress_results.json`, `earth-tmp/probe-report.txt` |
| Previews (RGB and 32-colour) | `earth-tmp/probe/*.png` |
| Tone channel and tile penalty | `earth-scripts/tone_probe.py`, `earth-tmp/tone.json` |
| Overture height coverage | `earth-scripts/overture_heights.py`, `earth-scripts/overture_regions.py`, `earth-tmp/overture-regions.txt` |
| CDSE mosaic size | `earth-scripts/s2gm_total.py`, `earth-tmp/s2gm-total.out` |
| Bucket sizes | `earth-scripts/s3_total.py` |
| Block counts and massing rasters | `earth-scripts/block_probe.py`, `earth-tmp/block-sf.json`, `earth-tmp/block-london.json` |
| Reachability | `earth-scripts/urls.txt`, `earth-scripts/head_check.sh`, `earth-tmp/head-check.out` |
| Storage arithmetic | `earth-scripts/estimate.py` |
| Saved licence text | `earth-tmp/gmp-terms.txt`, `earth-tmp/gmp-service.txt`, `earth-tmp/mapbox-product-terms.txt`, `earth-tmp/copdem-licence.txt`, `earth-tmp/sentinel-notice.txt`, `earth-tmp/esri-e300.txt`, `earth-tmp/mapterhorn-licences.txt` |
