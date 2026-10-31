# Prior art: how shipped products make distance beautiful at world scale

Research for the far-field question. Date 2026-10-30. Nothing in any repo was changed. No browser, build or bake was run.

**How numbers and facts are labelled**
- **[S]** FROM A SOURCE, with the link beside it. Weak sources are marked: vendor claim, secondary, community, reverse-engineered.
- **[E]** ESTIMATE: my arithmetic, with the assumption stated.
- **[M]** MEASURED: taken from this project's two audits, `audit-bands.md` and `audit-limits.md` in this folder.

**The main primary source.** Asobo's GDC 2022 deck, [Designing the Terrain System of Flight Simulator](https://www.asobostudio.com/files/inline-images/Designing_Terrain_System_Fuentes_Lionel.pdf), is too large for the fetch tool. I pulled its slide text with ranged reads of its small objects: 2.8 MB of 17.8 MB, images skipped, PDF not stored. The text is at `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/priorart-scripts/asobo-deck-text.txt`. "Deck" below means this text. I saw no slide images and no speaker notes. Section 10 lists every source I could not reach.

---

## 1. Bottom line

1. **Every world-scale product leans on generated content harder than we do.** Flight Simulator 2024 lists 1.5 billion generated buildings, nearly 3 trillion generated trees and 40,000 generated airports, against about 150 hand-built airports [S](https://gamesbeat.com/the-metaverse-didnt-die-it-moved-inside-microsoft-flight-simulator-2024-jorg-neumann-interview/). Photogrammetry covered about 400 cities at launch, and Blackshark's CEO estimated about 20 % of buildings may be wrong [S](https://finance.yahoo.com/news/meet-startup-helped-microsoft-build-194331994.html). Procedural generation is not what separates us from the products that look good.

2. **Flight Simulator is our mirror image.** Its geometry is mostly inferred and its ground colour is photographed. Ours is the reverse: real massing fills 48-72 % of the frame in the chase and ceiling shots, and 0 % of pixels show a measured colour [M]. Far away, geometry falls below one pixel and only colour is left. So their world gets richer with altitude and ours empties out.

3. **Every distant view I could document has the same four parts:** a height field or coarse mass, a per-texel colour raster, some value compression (atmosphere or a colour ramp), and a few hero silhouettes. Past a certain range, ordinary buildings stop being objects and become part of the raster. We have the first at 64 m, one ramp of the second, none of the third before about 12.5 km, and 20 m boxes for the fourth [M].

4. **The top defect has known fixes.** Our pop-in comes from a streaming radius with almost nothing behind it. Unreal's HLOD exists to stand in for unloaded cells [S](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine). Asobo draws each tile with the best data on hand, borrowing a parent's texture when needed [S](https://www.asobostudio.com/files/inline-images/Designing_Terrain_System_Fuentes_Lionel.pdf). Cesium renders the parent until the children are ready [S](https://cesium.com/learn/cesium-native/ref-doc/selection-algorithm-details.html). All three choose detail by size on screen. Cesium hit our exact bug in 2016: zoomed out over Chicago, no building passed the test, and a height rule did not help. The proposed fix was to rasterise small buildings into an imagery tile [S](https://github.com/CesiumGS/cesium/issues/4043).

5. **No visible pop-in depends on colour matching between levels, as much as on distance.** Asobo has each tree sample the aerial photo under it. The deck's summary: "Trees fade out naturally to the aerial!" Star Citizen went the other way and removed its global colour textures so the same ground material shows from orbit, and reports fewer pop-ins [S, community wiki](https://starcitizen.tools/CitizenCon_2019_-_Terra_Firmer). For us the rule is simple: bake each level from the level below it, through our own ramps.

6. **Real imagery belongs in the bake as evidence, never as pixels.** The closest precedent is Google Maps in 2020: computer vision finds natural features in satellite imagery, each feature gets a colour range, and density picks the shade, across more than 100 million km² of land [S](https://blog.google/products/maps/more-detailed-colorful-map/). In our terms, class picks the ramp and measured brightness or density picks the step. Our low resolution makes this cheap: 10 m imagery matches one game pixel at about 5.9 km from the ceiling [E, from the audit's pixel table]. Infinite Flight ships 15 m/px imagery on iPhone in a 202 MB app [S](https://apps.apple.com/app/id471341991).

7. **The recipe travels if it avoids Mercator and does not need haze.** The raster needs footprints, classes and imagery, and none of those depends on height tags, which is what empties the far layer in Lagos and Gulu [M]. Asobo's deck concedes Mercator stretches at the poles, and players report broken polar terrain [S, community](https://forums.flightsimulator.com/t/ever-tried-flying-over-antarctica-things-get-weird-down-there/261835). Antarctica has a public-domain 15 m mosaic [S](https://developers.google.com/earth-engine/datasets/catalog/USGS_LIMA_MOSAIC), which answers an open item in `audit-limits.md`. The Moon has a global mosaic plus a laser altimeter grid, and needs no haze [S](https://svs.gsfc.nasa.gov/4720).

8. **Stylised games offer principles and few hard facts.** Firewatch, Sable and Journey are citable on colour by depth, fading lines and distance-safe sparkle. I found no primary technical source on the far field of Breath of the Wild, Tears of the Kingdom or Genshin Impact. Written work on 3D pixel art is thin [S](https://upcommons.upc.edu/handle/2117/416925), and I found nothing on pixel art at 20 km. That part is new ground, so it needs prototypes more than precedent.

---

## 2. What the distant view is made of

| Product | Real data | Invented or inferred | What the distance is actually made of | One-line lesson |
|---|---|---|---|---|
| Flight Simulator | Aerial photos, DEM, vector data, some photogrammetry | Buildings inferred from photos; facades, trees, some ground colour | DEM mesh with aerial drape; tree imposters; ray-marched mountain shadows | Colour is real, so generated buildings get away with it |
| Google Earth | Oblique aerial photos, satellite imagery | Little by design | One tree of textured meshes, coarser with distance | Coarse level is a downsample of the fine one |
| Apple Maps | Aerial capture, land cover from imagery | Landmark models; 3D only in hero cities | Flyover mesh in some places; a designed flat map elsewhere | A hero tier over a universal tier, with automatic fallback |
| Mapbox Standard | OSM and other vector data | Facades, styling | Flat polygons, then extrusions fading in by zoom | Gate by size on screen, fade in, use fog to cap tiles |
| Cesium | Imagery, terrain, OSM buildings | Heights from floor counts | Imagery on terrain; HLOD tiles | Parent stays until children arrive |
| Google Maps (2020) | Satellite imagery | Colour ranges per feature | Classed flat colour with density shading | Closest match to a palette-locked far field |
| Infinite Flight (iPhone) | 15 m/px global imagery | Airports, scenery | Imagery on terrain | 15 m imagery is enough on a phone |
| Spider-Man 2 | None: authored city | All of it | Simplified building shells, always present | Automate the far level; 4-byte far vertices |
| GTA V | None: authored city | All of it | One low-poly textured mesh per large area; point lights | One draw for square kilometres of city |
| Breath of the Wild | None | All of it | Not documented in anything I found | No primary source found |
| Firewatch | None (photo reference) | All of it | Grey albedo coloured by light, fog and grading; depth colour bands | Colour can come from light and depth |
| Sable | None | All of it | Flat shading, fog per biome, lines that fade | Fade the lines to hide arrival |
| Journey | None | All of it | Dunes, sparkle tuned at mip level | Design distance sparkle on purpose |
| A Short Hike | None | All of it | Low-res 3D with soft outlines | Low resolution leaves room for imagination |
| Townscaper | None | Rule-placed tiles | No far field | Near-field only |
| Pokémon GO | OSM | Colours and biomes by tag | Undocumented | Tags alone carry a global game at close range |
| Monument Valley | None | All of it | Dioramas, no far field | Colour script per scene |
| KSP 1 and 2 | None (fictional bodies) | All of it | Static textured mesh far, PQS near | Values must be stable per position |
| Elite Dangerous | Star catalogues | Almost everything else | Sphere and normal map, then flat patches with baked lighting | Fine levels inherit from coarse levels |
| No Man's Sky | None | All from seed | Generated continuously | Does not apply to a real world |
| Star Citizen | None | Climate data drives materials | Ground materials at every range | Same material near and far ends pop-in |
| Outerra | Elevation | Fractal detail | Real relief refined procedurally | Real shape, invented fine detail |
| SpaceEngine | Star catalogues, probe maps | Procedural surfaces | Real maps plus detail by colour and slope | The Moon recipe |
| Google Moon, Cesium Moon | Orbiter mosaics and altimetry | Nothing by design | Mosaic on DEM | Airless worlds need no haze |

---

## 3. World-scale products

### 3.1 Microsoft Flight Simulator and Blackshark.ai

**Real data.**
- Bing aerial imagery, 2+ PB, plus DEM, OSM and other vector data [S, deck].
- 510.1 M km², 2+ million cities and ~37,000 airports frame the problem [S, deck].
- Photogrammetry exists only in a limited number of places [S, deck]: about 400 cities at launch [S](https://finance.yahoo.com/news/meet-startup-helped-microsoft-build-194331994.html), and more than 500 by one third-party guide to the 2024 sim [S, unverified](https://flyawaysimulation.com/ask/answers/msfs-2024-photogrammetry-cities-areas/).
- More than 100,000 km² of countryside has elevation from photogrammetry [S](https://gamesbeat.com/the-metaverse-didnt-die-it-moved-inside-microsoft-flight-simulator-2024-jorg-neumann-interview/).

**Inferred from real data.**
- 1.5 billion buildings. Machine learning finds outlines in 2D imagery. Height comes from GIS data where it exists, otherwise from shadows, rooftop features and typical local heights [S](https://finance.yahoo.com/news/meet-startup-helped-microsoft-build-194331994.html).
- The whole planet runs in about 72 hours on hundreds of virtual machines [S](https://www.thresholdx.net/news/blkmfs).
- Tree masks are precomputed in Azure with machine learning [S, deck].

**Invented.**
- Facades are added from location and context, never measured [S](https://www.thresholdx.net/news/blkmfs).
- Tree species come from biome rules. Detail maps and grass are synthetic [S, deck].
- Ground colour itself is sometimes invented. Where aerials are missing or poor, the slides list `SynthesizedAerialTex` and `BlendedAerial`, driven by land class, altitude, slope and tree presence [S, deck]. A marker named `DataLayerLC30Full` suggests a 30 m land-class layer, though the deck does not say so.

**The share of each.** Blackshark's CTO said 99.8 % of the planet's buildings, vegetation and infrastructure had no 3D form before this work [S, vendor claim](https://www.thresholdx.net/news/blkmfs). I found no published pixel share. My reading [E]: by object count the world is generated, and by pixels seen from altitude it is photographed.

**What the distance is made of.**
- An area is either a TIN mesh or a DEM with aerials [S, deck].
- Tiles form a quadtree in Mercator. Requested detail depends on estimated tile screen size and measured bandwidth. Each tile draws with the best data available and can use a parent's aerial texture. Skirts hide cracks [S, deck].
- Mountain shadows come from a top-down heightmap, ray-marched over 300 x 300 km [S, deck].
- Trees are 3D imposters: one draw per species per tile, one vertex per tree. One slide counts 23 M generated, 6.3 M in the frustum. Halton sampling keeps them uniform at any density, and density is set at draw time [S, deck].
- The deck does not say how far buildings draw. Community guides treat it as the Object LOD setting [S, community](https://flyawaysimulation.com/ask/answers/msfs-2024-lod-settings/). My inference: past that range the photo carries the buildings, roofs and shadows included.

**Lessons for us.**
- Never leave a hole. Keep the coarse level resident and draw it until the finer one arrives.
- Keep class data apart from colour data. Asobo stores surface type, biome and flags in an R8 texture array, and keeps enums in BC2's uncompressed alpha because block compression would damage them [S, deck]. Our ramp indices have the same constraint.
- Make near objects inherit the far layer's colour, so they fade into it.
- Trees as one vertex each transfer directly. A 1-3 px tree at 2 km is a coloured point, and a low-discrepancy order lets us thin by changing the draw count alone [E].
- Heightmap ray-marching for far shadows suits a low pixel count. We have 334,836 pixels against 8.3 M at 4K, 24.8 times fewer [E, arithmetic]. This could answer the "keep all shadows" rule past the shadow window, though nothing has been measured.

**Does not transfer.**
- Photos as final pixels: they break palette lock.
- 2+ PB of source data, about 3.9 MB per km² of Earth [E, arithmetic], and a 2020 client that could cache up to half a terabyte [S](https://gamesbeat.com/the-metaverse-didnt-die-it-moved-inside-microsoft-flight-simulator-2024-jorg-neumann-interview/).
- TIN photogrammetry. It has baked light, which the deck lists as a data problem, and it has no per-building identity. Blackshark's CEO makes the same argument [S](https://finance.yahoo.com/news/meet-startup-helped-microsoft-build-194331994.html). Our core verb paints buildings, so we need the semantic route.
- The Mercator quadtree. The deck accepts the polar stretch because most source data uses it. Community threads report terrain failing past about 85° and broken polar crossings [S, community](https://forums.flightsimulator.com/t/north-pole-bug/329343); I found no official statement.

**Blackshark's product form.** SYNTH3D pairs a 30 m terrain model and 50 cm ground texture with about 1.4 billion generated buildings [S, secondary, read only through search summaries](https://www.nasdaq.com/press-release/maxar-launches-high-performance-synth3d-digital-twin-for-metaverse-simulation-and). The recipe is footprints plus class plus generated facades on real ground imagery. Apart from the imagery, that is our recipe.

### 3.2 Google Earth and Photorealistic 3D Tiles

**Real data.** Oblique aerial photography at about 45° [S, secondary](https://www.neowin.net/news/google-maps-to-add-full-3d-models-to-some-cities), delivered as a seamless textured mesh for about 2,500 cities in 49 countries [S](https://mapsplatform.google.com/resources/blog/create-immersive-3d-map-experiences-photorealistic-3d-tiles/).

**Invented.** Nothing by design that I could document. A Cesium forum user suspects a clean-up pass [S, community](https://community.cesium.com/t/experts-how-to-make-this-view-in-cesiumjs/22443).

**What the distance is made of.** Reverse engineers describe one octree in which each node holds a mesh and a texture [S, reverse-engineered](https://github.com/retroplasma/earth-reverse-engineering). In 3D Tiles terms, each tile has a geometric error in metres, and clients project that to pixels to decide whether to refine [S](https://raw.githubusercontent.com/CesiumGS/3d-tiles/main/specification/README.adoc). With REPLACE refinement, children take the parent's place; with ADD, they draw on top of it [S, same].

So a city at 20 km should be a coarse textured skin in which buildings exist only as picture and lumps. That is my inference: I could not view one, and I found no official description of that range. Outside 3D coverage I found only anecdotes of terrain plus flat imagery [S, community](https://steamcommunity.com/app/348250/discussions/0/1742230617609707197).

**Lesson.** A coarse node is a downsample of its children, so swapping levels changes detail and keeps colour. This is why good HLOD does not read as pop-in. The ADD mode is also a useful idea: base raster everywhere, tall buildings added on top.

**Does not transfer.** Google's policies restrict pre-fetching and caching, restrict extraction and offline use, bar image analysis, and bar 3D objects derived from the tiles [S](https://developers.google.com/maps/documentation/tile/policies). So we cannot bake from it. It also has no building identity to paint.

### 3.3 Apple Maps

**Real data.** Low-flying aircraft with angled cameras, technology from the C3 acquisition, covering more than 350 places in 31 countries [S, Wikipedia](https://en.wikipedia.org/wiki/Flyover_(Apple_Maps)). The same page reports AI-assisted capture announced in 2026; I did not check that further.

**Invented or authored.** The 3D city experience adds detailed landmark models and elevated roads [S, secondary](https://www.phonearena.com/news/apple-maps-detailed-city-experience_id149330). I could not confirm they are hand-modelled. Justin O'Beirne's analysis argues Apple extracts vegetation and shapes from imagery, while buildings may be traced by a vendor. He flags the vendor point as unconfirmed, and the data covered about 3 % of US land after four years [S](https://www.justinobeirne.com/new-apple-maps).

**What the distance is made of.** A designed flat map is the base. The 3D experience needs an A12 or later, and where it is missing the map falls back to flat automatically [S](https://developer.apple.com/videos/play/wwdc2022-10035).

**Lesson.** Tiers with automatic fallback, in which the universal tier must look good on its own. This matches WORLD-TRAVEL's three tiers, with one change: the base tier has to carry the beauty, not just exist.

**Does not transfer.** City-by-city capture. Four years for 3 % of US land is the opposite of the producer's scale rule.

### 3.4 Mapbox Standard and vector maps

**Real data.** Vector tiles. Large buildings appear at zoom 13, and all buildings by zoom 16; land use starts at zoom 5 [S](https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/).

**Invented.** Styling. Landmarks are high-fidelity models with styled windows, walls, roofs and entrance lights, alongside global coverage of ordinary buildings [S](https://docs.mapbox.com/map-styles/reference/standard/), and they are added over time [S, secondary](https://www.geoweeknews.com/?p=40943). A separate toggle controls building facades [S](https://docs.mapbox.com/map-styles/standard/api/). The docs do not say how facades are generated.

**What the distance is made of.** Flat polygons, with 3D buildings that fade in as they come into view [S](https://www.mapbox.com/blog/mapbox-style-updates-more-flexible-configurations-for-the-3d-basemap). Mapbox states plainly that fog cuts the number of distant tiles loaded [S](https://docs.mapbox.com/style-spec/reference/fog/).

**Lessons.**
- Gate buildings by size. Zoom is a proxy for pixels on screen, and "large first" is a footprint test.
- At low zoom a city is land use plus roads. Overture's 353 M transportation segments [M] could fill that role for us.
- Fade in, but with our Bayer dither: alpha is not available to us. Screen-space dither is a standard way to do LOD cross-fades [S](https://docs.unity3d.com/6/Documentation/Manual/class-LODGroup.html).

**Does not transfer.** Fog as a budget tool. Our fog is off, and the Moon has none.

### 3.5 Cesium

**Real data.** Sentinel-2 cloudless imagery down to 10 m [S](https://cesium.com/platform/cesium-ion/content/sentinel-2-imagery/) and OSM Buildings, over 350 million [S](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/).

**Invented.** Missing heights at 3 m per level, with a minimum of one level [S, same].

**What the distance is made of.** Imagery on terrain with HLOD tiles on top. If selected descendants are still loading and none drew last frame, the parent renders instead. `forbidHoles` trades extra loading for no empty areas. Fog culling drops far tiles [S](https://cesium.com/learn/cesium-native/ref-doc/selection-algorithm-details.html). The default `maximumScreenSpaceError` was 16 px [S](https://cesium.com/downloads/cesiumjs/releases/1.41/Build/Documentation/Cesium3DTileset.html). On a 1179-wide phone that is about 5 game pixels [E]. We would want 1-2.

**Issue 4043 is our defect from 2016.** Additive refinement showed no buildings over Chicago from far away. Lowering the error threshold pulled in nearly everything instead. A height test failed for top-down views, and footprint tuning swung between too many and too few. The proposal: keep tall buildings as geometry and rasterise the rest into an imagery tile, with an optional normal map [S](https://github.com/CesiumGS/cesium/issues/4043). This was a discussion, and I did not check whether it shipped.

**Screen-error budget for us [E].** The 3D Tiles spec gives no formula [S](https://raw.githubusercontent.com/CesiumGS/3d-tiles/main/specification/README.adoc), so I used plain perspective projection. One game pixel at the 38° lens is 5.3 m at 3 km, 8.8 m at 5 km, 17.5 m at 10 km and 35 m at 20 km of slant range. These match the slant-range table in `audit-limits.md`. They are the geometric error each level may carry at a budget of 1 px.

**Does not transfer.** One draw or more per tile. Cesium's tile counts do not fit 120-200 draws, so far tiles must merge into array textures and shared meshes.

### 3.6 Google Maps, 2020 colour update

**Real data.** Satellite imagery, for more than 98 % of the world's population [S](https://blog.google/products/maps/more-detailed-colorful-map/).

**Invented.** The colours. Computer vision identifies arid, icy, forested and mountainous land, each feature gets a range on the HSV model, and density sets the shade, so dense forest is dark green and patchy shrubland lighter [S, same].

**What the distance is made of.** Flat classed colour with density shading, across 220 countries and territories and more than 100 M km² of land [S, same]. A review found inconsistencies, such as parts of the Sahara left grey [S, secondary](https://tagteam.harvard.edu/hub_feeds/3382/feed_items/2754626).

**Lesson.** This is the closest shipped precedent for a palette-locked far field: class chooses a range, measurement chooses the position inside it. It also explains why nearest-colour posterising is the wrong approach (section 6.7).

**Does not transfer.** HSV freedom. We have ramps. Its top-down flat view also never meets our grazing angle.

### 3.7 Phone flight sims and browser renderers

**Infinite Flight** on iPhone offers global imagery at 15 m/px and a growing set of 3D airports, in a 202.2 MB app that needs a network connection [S](https://apps.apple.com/app/id471341991). I found nothing on how tiles stream. A 2021 reviewer felt the missing 3D buildings hurt immersion [S, secondary](https://fselite.net/content/fselite-original-first-look-at-infinite-flight/).
- **Lesson:** 15 m imagery is shipping on phones, and it equals one game pixel at about 9 km from our ceiling [E].

**Streets GL** is an open-source WebGL2 OSM renderer with terrain LODs and aerial perspective. It recommends a modern discrete GPU [S](https://github.com/strandedkitty/streets-gl).
- **Lesson:** full per-building OSM rendering in a browser is possible, but not on our phone budget. I could not confirm how far it draws buildings.

### 3.8 City games and engine HLOD

**Spider-Man 2.** Insomniac replaced hand-built distant LODs with automated generation, because the city doubled in size and needed more levels [S](https://gdcvault.com/play/1034403/Applied-Mesh-Analysis-Automating-Distant). The rest comes from one Chinese summary of the talk [S, secondary](https://www.gcores.com/articles/183848):
- About 2,057 building tiles.
- A distant LOD used past about 145 m.
- Vertices of 4 bytes, holding a 10-bit compressed position and no normals or UVs. Lighting is computed per triangle.
- Pipeline: decimate, remesh a conservative target, decimate again, flatten faces, remove inner shells, patch cracks.

The first game's IG-Impostors were 3D because flat billboards could not represent the city at the wanted quality [S, secondary, a LinkedIn listing of the paper](https://aq.linkedin.com/in/agentxray).

**Lesson for us.** Far vertices can be tiny. The audit's whole-city LOD 1 at 51 bytes per vertex is about 210 MB on main and 434 MB on feat/osm [E, from the audit]. At 4 bytes that becomes 16.5-34 MB, or 33-68 MB with a 4-byte attribute block for ids [E]. WebGL2 has the packed type (`INT_2_10_10_10_REV`) [S](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer). Triangle count is still the limit: 2.19-4.77 M for the whole city [M]. So this helps residency, and block merging is still needed for the frame budget.

**GTA V.** The Vinewood Hills, several square kilometres, draw as one low-poly mesh in one draw call of about 2,500 triangles, where the close version takes thousands of draws. Distant lights are tiny batched quads with a 32 x 32 texture. Planes get reduced LOD and still show pop-in, and PC has a separate high-detail streaming option for flying [S](http://www.adriancourreges.com/blog/2015/11/02/gta-v-graphics-study-part-2).
- **Lesson:** one draw per large area is the proven shape. Distant lights as points suit night and paint beacons. Flight is the hardest case for city games too.

**Unreal HLOD.** Actors in a grid cell collapse into one proxy mesh and material to stand in for unloaded cells, with instancing, merged and simplified layer types, and parent layers [S](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine).
- **Lesson:** this is the textbook form of what City.ts lacks, a resident proxy per cell.

**Does not transfer.** Licensed mesh tools, ray-traced BVHs and hand-tuned far meshes. Rockstar's meshes were probably tuned by artists [S, the article's inference]. We have 2.53 B buildings [M], so ours must be automatic, and block-level rather than per-building.

---

## 4. Stylised worlds

**Firewatch.**
- **Real:** reference only. **Invented:** everything.
- **Distance:** Campo Santo says most rocks have grey diffuse, and colour comes from lighting, fog and a colour-correction pass, with two fog systems blended by an interpolation manager [S](https://blog.camposanto.com/post/102893584324/i-asked-twitter-if-anyone-had-questions-about-the). Coverage of Jane Ng's talk describes bold colours in distinct layers that build depth [S, secondary](https://www.thumbsticks.com/gdc-2015-the-art-of-firewatch). A third-party implementer reports the talk described colour ramps mapped to depth, with opacity in the ramp's alpha; he says his code is a guess [S, secondary](https://halisavakis.com/my-take-on-shaders-firewatch-multi-colored-fog/).
- **Lesson:** a grey world does not need coloured albedo. Our battleship-grey city can pick up colour by depth band and light. The ramp idea fits us as a depth-to-ramp remap.
- **Does not transfer:** continuous blending. Its vistas are also composed by hand.

**Sable.**
- **Distance:** distant fog was key to mid-to-long readability and is tuned per biome. Outlines fade with distance, which adds perspective and hides objects arriving. Before that, pop-in was ugly enough to count as a real problem [S](https://www.gamedeveloper.com/marketing/how-shedworks-refined-the-art-of-sable-in-pursuit-of-readability).
- **Lesson:** a line that fades is the cheapest pop-in cover. We lose outlines at 286-520 m view depth, so at the ceiling the city has none [M]. A far-band edge drawn from depth breaks at 1-2 px could restore street lines.
- **Does not transfer:** a sparse desert hides far less than a dense city needs.

**Journey.**
- **Distance:** John Edwards' GDC talk covered sharpened mipmaps, anisotropic masking and glitter specular [S, secondary](https://polycount.com/discussion/comment/2620359). Alan Zucconi's reconstruction describes rare, bright glitter and mip handling for temporal coherence [S, secondary](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-1/).
- **Lesson:** distance sparkle needs design at the mip level. Our water dash hash is point-sampled and flips up to 4.5 % of pixels at random [M].
- **Does not transfer:** specular maths. We need a prefiltered step, or world-anchored cells larger than a pixel.

**A Short Hike.**
- **Distance:** the developer wanted to find how few pixels can still make a readable, attractive world, and says low resolution makes the world feel lush and leaves room for the imagination. He used flat shading, no anti-aliasing and a soft outline [S](https://blog.playstation.com/2021/08/05/crafting-a-tiny-open-world-a-look-behind-the-scenes-at-the-creation-of-a-short-hike/). Summaries of his GDC talk say the palette was sampled from autumn photos of the Canadian Shield [S, secondary](https://podwise.ai/episodes/1459231).
- **Lesson:** our resolution is an asset. A pixel of tone can stand for a building, so we do not have to draw the building. Sampling ramps from photographs is a legitimate way to build them.
- **Does not transfer:** it is a tiny island. I found nothing on its far field.

**Townscaper.**
- **Real:** player input only. **Invented:** an irregular quad grid, corner tiles, Wave Function Collapse selection, about 500 tiles for a re-skin [S](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making).
- **Distance:** no LOD system described, and detail can get cluttered when zoomed out [S, same].
- **Lesson:** rule-driven tiles give charm up close and nothing in the far field.

**Pokémon GO.**
- **Real:** OSM base map since about December 2017 [S](https://birthday20.openstreetmap.org/timeline/2017-niantic-switches-to-openstreetmap-as-the-base-map-for-pokemon-go), never announced by Niantic [S, secondary](https://cinemablend.com/games/1737020/why-pokemon-gos-map-now-looks-different). OSM data reportedly influences biomes [S, community](https://pokemongohub.net/post/breaking-news/game-map-updated-new-openstreetmap-data-december-2017/).
- **Lesson:** a global game can run on tag-driven colour alone. Its pitch and radius are narrow, though, and I could not confirm how far it draws.

**Monument Valley.**
- **Real:** none. Ken Wong describes printing every screen as a colour script, and a shader system that applies colour directly in place of true lighting [S](https://www.creativebloq.com/computer-arts/making-monument-valley-71412213).
- **Lesson:** a colour script for each city, chosen from ramps. WORLD-TRAVEL's Tokyo identity is the same idea.
- **Does not transfer:** every level is a hand-composed diorama.

**Alto's Odyssey** (phone-first, added because it fits). Backgrounds use a more muted colour scheme and move at a different rate [S, secondary](https://www.dice.com/career-advice/altos-odyssey-winning-mobile-game).
- **Lesson:** paint and the bus can stay saturated because everything far stays quiet. That separation already gives blast7 its impact.

**Breath of the Wild and Tears of the Kingdom.**
- Community reverse engineering shows a terrain index with per-area `.hght` and `.mate` files, optional water and grass files, multiple LODs, a max height of 800 and a world scale of 500 [S, community](https://zeldamods.org/wiki/TSCB). I could not confirm what `.mate` stores per texel.
- One blog article cites up to 9 material mask layers per frame, with each material behaving differently at distance, via a video [S, secondary](https://www.gamedeveloper.com/art/level-of-detail-as-artistic-codec).
- No primary source on far LOD. I will not attribute techniques to these games from memory.

**Genshin Impact.** The one talk I confirmed, by miHoYo's technical director at Unity Tech Week 2020, concerns the move to console [S, fan wiki](https://mihoyo.fandom.com/wiki/China_Unity_Tech_Week_2020). I found nothing on its far field.

**Pixel-art 3D.**
- t3ssel8r has no written source I could reach. The nearest is a product listing that describes low-res rendering with sampling and snapping to reduce pixel creep [S, secondary](https://www.fab.com/listings/816f34f2-1a2e-4910-b3dd-009b5da0873b).
- A 2024 thesis calls public documentation thin and scattered [S](https://upcommons.upc.edu/handle/2117/416925).
- Pixelat3D uses priority maps for texture LOD and post-process outlines, per its abstract, which does not address distant scenery [S](https://sol.sbc.org.br/index.php/sbgames/article/view/45414).
- Lucas Pope's Obra Dinn devlog is the known reference on dither stability under camera motion [S, secondary](https://simonwillison.net/2017/Nov/23/return-of-the-obra-dinn/). I could not open the original.
- **Lesson:** the camera snap and stable dither we already have are at the state of the art. The far field is where we go beyond it.

**Painterly by data: Stamen Watercolor.** OSM features become masks, are wobbled by thresholded Perlin noise, and are applied to hand-painted textures with darkened edges. Raster-space styling was chosen because cost does not rise in dense areas and output is deterministic, so tiles stitch [S](https://stamen.com/watercolor-process-3dd5135861fe/).
- **Lesson:** this is the best precedent for beauty from plain vector data at every zoom. A raster bake gives us cost independent of building count.

**Painterly by AI: Isometric NYC (2026).** A fine-tuned image model turned orthographic renders into about 40,000 pixel-art tiles for one city. Water and trees were the hardest problems, automated review failed, and much of the map was checked by hand [S](https://cannoneyed.com/projects/isometric-nyc).
- **Does not transfer:** manual review per city, and its input was Google's 3D Tiles, which we cannot derive from under the policy in 3.2. It is also not palette-locked or real-time. I did not view it. The coverage suggests a pixel-art city seen from altitude can work when each tile carries real tonal detail.

---

## 5. Real and planet-scale worlds

**Kerbal Space Program 1 and 2.**
- **KSP 1:** PQS terrain close up and a static textured mesh from far away [S, community](https://forum.kerbalspaceprogram.com/topic/50471-12-real-solar-system-v120-dec-8/page/85). Height and colour come from maps. Biome maps are indexed PNGs with no blending between regions [S, community](https://forum.kerbalspaceprogram.com/topic/147252-how-to-biome-maps).
- **KSP 2:** per excerpts of the dev diary, planet mesh data comes from compute shaders, and each vertex carries height, slope and cavity for procedural texturing, values that must stay stable for a given position [S, search excerpt only](https://forum.kerbalspaceprogram.com/topic/205930-developer-insights-12-%E2%80%93-planet-tech). The official site no longer resolves, and the forum refused my fetches.
- **Lesson:** indexed maps must stay unblended, as ours must. Stable per-position values prevent shimmer across LODs.
- **Does not transfer:** compute shaders are not in WebGL2. The far/near split into two representations is the handover we want to avoid.

**Elite Dangerous.**
- **Real:** about 150,000-160,000 stars from catalogues, as sources differ [S](https://www.space.com/31366-elite-dangerous-stellar-forge-interview.html) [S](https://perthobservatory.com.au/game-reviews/elite-dangerous), and a hand-made top-down galaxy distribution [S](https://80.lv/articles/generating-the-universe-in-elite-dangerous/). The in-game scale is about 400 billion systems [S](https://www.elitedangerous.com/explore).
- **Invented:** nearly everything else, with each level passing parameters down to the next.
- **Distance:** spheres with normal maps, then flat patches with generated normal, height and texture data, with per-patch lighting that approximates shadows, then real-time shadows near the surface [S, same 80.lv article].
- **Lesson:** per-patch baked lighting is a precedent for baked far shadows. Inheriting parameters makes coarse and fine agree by construction.
- **Does not transfer:** a real city has no generator to inherit from. The same agreement comes from baking upward.

**No Man's Sky.** Everything comes from generation, running continuously from voxels through polygonisation, texturing and population [S](https://gdcvault.com/play/1024265/Continuous-World-Generation-in-No). Players report pop when flying faster than detail streams in [S, community](https://steamcommunity.com/app/275850/discussions/4/350542145693874593).
- **Lesson:** even a pure generator pops at speed. It offers no route to the real world.

**Star Citizen.** Planet Tech v4 replaced pre-baked colour textures with climate data. Global textures went away, so ground texture shows from orbit, with smoother LOD transitions and less texture memory [S, community wiki of a CitizenCon talk](https://starcitizen.tools/CitizenCon_2019_-_Terra_Firmer). Later versions add data maps such as geology and soil [S, community](https://starcitizen.tools/Planet_Tech_v5).
- **Lesson:** a far-only colour map is itself a source of pop. It is the opposite move to Flight Simulator, and both reach the same goal: one colour source at every range.
- **Does not transfer:** its budgets, and planets invented to suit the system.

**Outerra.** Real elevation refined by fractal algorithms to about centimetre scale [S](https://gamedeveloper.com/business/-i-outerra-i-a-seamless-planet-rendering-engine). Alpha-era coverage gives 90 m elevation, 1 km oceans and about 12 GB in total, and a developer post warned the engine was unsuited to GIS use [S, read only through search summaries](https://www.moddb.com/engines/outerra/news/outerra-engine-progress). These figures are old.
- **Lesson:** real shape plus invented fine detail is an honest split for terrain.

**SpaceEngine.** Known objects come from catalogues and probe maps, and everything else is procedural [S](https://spaceengine.org/?p=127). Real bodies look blurry where their maps run out [S, community](https://steamcommunity.com/app/314650/discussions/0/1639787494972532766). The fix: decouple geometry from textures and pick detail materials by surface colour and slope [S](https://spaceengine.org/news/blog190611/).
- **Lesson:** this is the recipe for the Moon. A real global map, with detail chosen from what that map says at each point.

**The Moon.**
- **Google Moon (2009):** terrain from Kaguya and no LRO imagery at launch [S](https://scoop.co.nz/stories/SC0907/S00037.htm), a Clementine mosaic as a base layer [S](https://www.lpod.org/wiki/July_16,_2021), and later LRO close-ups at landing sites [S](https://www.lpod.org/wiki/July_23,_2009).
- **Cesium Moon Terrain (2024):** about 59 m terrain at mid latitudes, LROC WAC imagery at 100 m, and finer polar data down to 5 m [S](https://cesium.com/platform/cesium-ion/content/cesium-moon-terrain).
- **NASA's CGI Moon Kit:** colour from a Hapke-normalised WAC mosaic of over 100,000 images, tuned for looks, with displacement at 4, 16 and 64 pixels per degree [S](https://svs.gsfc.nasa.gov/4720). That is about 7.6 km, 1.9 km and 474 m per pixel [E, radius 1,737.4 km].
- **Audit:** 14.5 GB for a global 118 m DEM plus a 100 m mosaic [M].
- **Lesson:** a normalised mosaic should carry little baked shading, which suits a moving sun. I did not confirm this in LROC's own documents. No haze is needed, and terrain shadows become the relief cue.
- **Limit:** 100 m per texel is about 3 game pixels at 20 km and 19 at 3 km [E]. Low flight needs SpaceEngine's approach, plus real craters from the catalogue in `audit-limits.md`.

**Antarctica.** LIMA is a 15 m, public-domain, virtually cloudless Landsat 7 mosaic with scenes from 1999-2002 [S](https://developers.google.com/earth-engine/datasets/catalog/USGS_LIMA_MOSAIC). Landsat does not reach the Pole, so the area south of about 82.5°S is filled from MOA [S](https://svs.gsfc.nasa.gov/3588). One source puts the boundary at 83°S. The centre-filled display product is 240 m as a whole, and the MOA data was colour-balanced to match [S](https://publicdatasets.data.npolar.no/quantarctica/Quantarctica/Basemap/Imagery/1st_ReadMe_Landsat%20Image%20Mosaic%20Of%20Antarctica%20(LIMA).htm). REMA covers height [S, via the audit](https://registry.opendata.aws/pgc-rema/).
- **Lesson:** Antarctica gets an appearance layer from a dedicated source, in polar stereographic. Infinite Flight recently added polar elevation [S](https://apps.apple.com/app/id471341991), so polar data is reaching phones.

---

## 6. Techniques

### Rules a palette-locked game must follow

These rules drive most verdicts below. They are my analysis, supported where cited.

1. **Ramp indices cannot be averaged.** Bilinear filtering, mean mipmaps and block compression all invent ramps that were never there. Our code already shows this: the interpolated `ramp` input makes far shores pass through FOG and SKY_WARM [M].
2. **The step is a number.** It can be filtered and compressed, then quantised in `sbWrite`.
3. **So class and tone are stored apart.** Asobo keeps enums out of compressed channels [S, deck].
4. **No TAA or MSAA.** Aliasing has to be solved in the bake or by filtered values.
5. **Sub-pixel world patterns crawl.** At the ceiling a pixel at 5 km covers 8.6 x 63 m [M]. Anything finer than that, sampled by point, will shimmer as the camera moves.

| Technique | Who ships it | Phone and WebGL2 reality | Verdict for us |
|---|---|---|---|
| Draped classed raster | Google Maps, Mapbox land use, MSFS `LandClass` | Fine. Array textures have 2048 layers on iOS [S](https://web3dsurvey.com/webgl2/parameters/MAX_ARRAY_TEXTURE_LAYERS) | **Yes.** Base of the far field |
| Colour map plus detail noise | MSFS detail maps, SpaceEngine soil materials, Elite | Cheap per pixel | **Yes, with prefiltered detail** |
| HLOD | Every product here | One proxy per cell fits 120-200 draws | **Yes.** Fixes the top defect |
| Block massing | Glander and Döllner, cartography | Bake cost only | **Yes** for roughly 3-6 km |
| Octahedral impostors per object | MSFS trees, Fortnite | Frame blending needs colour interpolation | **No** per building. Points instead |
| Skyline strip or 3D skybox | Source engine | Trivial | **Maybe** past 16 km; fails on fast lateral moves |
| Geometry clipmap | Research, WORLD-TRAVEL's plan | Works, ground only | **Yes** for ground, never for buildings |
| Virtual texturing with feedback | Rage, large open worlds | WebGL2 has no sparse textures (not confirmed in the spec) | **Not needed.** Arrays and rings suffice |
| Posterising by nearest colour | Nothing I found | Easy | **No.** Class first, then step |
| Atmospheric perspective | Almost all | Fine | **Yes** as a ramp remap, never required |

### 6.1 Draped classed rasters

We already have the data: `far.bin` stores all 11 classes at 32 m, and the mesh keeps one bit of them [M]. Unused classes are the cheapest gain available.

iOS supports what this needs, by crowd-sourced stats: `MAX_TEXTURE_SIZE` of 16384 on 98.65 % of reports [S](https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE), ASTC on 99.98 % [S](https://web3dsurvey.com/webgl2/extensions/WEBGL_compressed_texture_astc), and anisotropic filtering on 99.98 % [S](https://web3dsurvey.com/webgl2/extensions/EXT_texture_filter_anisotropic). So phone limits are not the blocker.

Ground texels by resolution, at 2 bytes per texel (class plus step) [E]:

| Texel | KB per km², raw | SF frame (253 km²), raw | All land (149 M km²), raw |
|---|---|---|---|
| 8 m | 31 | 7.9 MB | 4.7 TB |
| 16 m | 7.8 | 2.0 MB | 1.2 TB |
| 32 m | 2.0 | 0.5 MB | 0.3 TB |

Compression will cut these. For scale, SF's regions are 19-25 MB on the wire [M], and Flight Simulator's source imagery is about 13 MB per km² of land [E, if all 2 PB covered land].

### 6.2 Colour map plus detail noise

Asobo uses near, mid and far detail maps for dirt, asphalt and grass, detected at runtime [S, deck]. SpaceEngine picks detail from colour and slope [S](https://spaceengine.org/news/blog190611/).

For us, detail means a per-class tone pattern. It must exist at a scale of at least 2 px per band, or be stored as filtered tone. Our roof camouflage patches are a warning: 9 x 7 m hash cells round to hard step edges [M]. Choosing pattern scale by distance is the pixel-art version of near, mid and far.

### 6.3 HLOD and block massing

3D Tiles defines the framework [S](https://docs.ogc.org/cs/22-025r4/22-025r4.html). Glander and Döllner define the city-specific method: split the city into cells along the road network and merge each cell's buildings into abstract blocks, keeping roads, landmarks and open space [S, abstract via search](https://publishup.uni-potsdam.de/opus4-ubp/files/6201/glander_diss.pdf). They reuse cartographic visual language so people can read the result as a map [S, same].

Baking far levels offline from a game's own assets is ordinary practice. Skyrim's community tools generate terrain and object LOD that way, with separate texture and mesh steps [S, community](https://dragonbornsfate.moddinglinked.com/lod.html).

This matches the audit's advice that L4 should merge every footprint per block with streets left open. Density-extruded blocks fail by comparison: they keep neither streets nor real footprints.

The test is the road network. Streets narrower than building height already vanish at the ceiling [M], so the massing must leave streets wider than they are, in tone if not in geometry. I have no source that tests this at 390 px.

### 6.4 Impostors and octahedral impostors

Ryan Brucks' octahedral impostors are the method behind Fortnite's trees and Asobo's tree imposters [S, secondary](https://80.lv/articles/impostor-baker-for-ue4/). The original post did not load for me. Insomniac found flat impostors too weak for a city [S, secondary](https://aq.linkedin.com/in/agentxray). Sillion, Drettakis and Bodelet (1997) split a scene into a local 3D model plus impostors of distant scenery that combine textures with some geometry for parallax [S, abstract only](https://diglib.eg.org/handle/10.2312/8378).

For us:
- **Per-building impostors are pointless.** At the far band a building is 1-2 px, and there are 1.5-1.9 buildings per pixel [M].
- **Per-frame blending is not allowed.** Interpolated colours break palette lock.
- **A textured depth mesh per large cell is viable** but is just HLOD by another name.
- **Keep from MSFS:** one vertex per tree.

### 6.5 Skyline strips

At the ceiling, everything past 10 km shares 43 rows and everything past 20 km shares 22 rows [M]. The Source engine's 3D skybox renders distant scenery as a separate 1/16-scale scene [S](https://developer.valvesoftware.com/wiki/3D_Skybox).

A cached strip works only while parallax stays below a pixel. One pixel at 10 km is about 17 m. A sideways move at cruise, 30 m/s (`src/config.ts:167`), shifts that point one pixel in about 0.6 s, so a refresh every 15 frames at 30 fps would hold. At G1, 450 m/s, the shift is about one pixel per frame, so the cache saves nothing [E]. The strip is useful only at low speed, or for silhouettes well past 20 km. I found no primary source that describes a skyline strip for cities.

### 6.6 Clipmaps and virtual texturing on phones

**Clipmaps** nest grids around the viewer. The GPU Gems chapter gives 6L + 5 draws per frame, or 3L + 2 with instancing, for L levels: 53 or 26 draws at L = 8 [E, formula]. Vertex texture fetch was the main bottleneck on 2005 hardware, and a morph over the outer n/10 of each ring avoids popping [S](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry). WORLD-TRAVEL's ≤ 8 draws requires one draw per ring, which is a different layout from that chapter. CDLOD reaches a similar result with per-vertex morphing on a quadtree of regular grids [S](https://github.com/CarsF/CDLOD).

Clipmaps carry height and raster rings well. They cannot carry buildings. Three 2048² rings of class plus step at 8, 16 and 32 m come to about 25 MB of GPU memory and reach ±32 km [E]. One upload per texture per frame fits the project rule.

A warning on anisotropy: at the ceiling a far pixel is 7 times longer than wide at 5 km [M]. Distance-only LOD therefore gives too much along-view detail and aliases. Filter the step channel anisotropically, and take the class from a mode mip chosen by along-view size. This is untested.

**Virtual texturing.** van Waveren's paper describes the software page-table approach [S](https://www.quaddicted.com/webarchive/mrelusive.com_20170131/publications/papers/Software-Virtual-Textures.pdf), and a Chalmers thesis did it in WebGL [S](https://www.cse.chalmers.se/~uffe/xjobb/Virtual_Texturing_with_WebGL.pdf). I believe WebGL2 has no sparse textures, but I did not confirm that against the spec. We do not need VT for a raster this coarse. Rings or array textures are simpler. Index data has one advantage: without filtering it needs no page gutters.

**A per-pixel alternative, untested.** Store a 10-16 m height raster and ray-march it in the far ground's fragment shader for the 3-10 km band. Cost follows pixels, the property Stamen wanted and MSFS's far shadows use. The worst-case far strip is 22,000-25,000 px [M]; at 32 steps that is about 800,000 fetches per frame [E]. It would give block silhouettes and street gaps from one resident texture, with no meshes or pop. It needs measuring on a phone before anyone relies on it.

### 6.7 Posterising imagery into a fixed palette

I found no shipped game doing this at world scale. The precedent is Google's method (3.6), and the two ways to do it differ a lot:

| | Nearest palette colour on the photo | Class first, then step from measurement |
|---|---|---|
| Hue | Whatever is nearest; bare earth can land on a wrong ramp | From class, so the no-brown rule holds by construction |
| Noise | Cars, roofs and shadows become random hue flips | Noise can only move tone within one ramp |
| Baked shadows | Become dark ramps | Become darker steps, which read as city |
| Tile seams | Hue jumps | Tone jumps, removable per class |
| Missing imagery | Fails | Falls back to class with a density-driven step |

Recommended order, as a proposal to test:
1. Bake class from our own vector data and WorldCover.
2. Bake step from our own renderer: roofs, streets, cast shadows from our sun.
3. Add imagery only as a signal for step within a class, histogram-matched per class and per city so each ramp's full range gets used.

Asobo's marker list shows what this involves at world scale: colour reference, colour mean and TIN colour-correction layers, plus image quality evaluation [S, deck]. Ours is simpler, since a composite such as ESA's 10 m product is CC BY 4.0 [S](https://esa-worldcover.org/en/data-access) and should already be harmonised, though I did not verify how far. EOX's newer mosaics are non-commercial or sold [S](https://eox.at/2019/02/sentinel-2-cloudless-2018/). Both facts come from `audit-limits.md`.

Moving sun: imagery shadows are fixed. Asobo lists them as a data problem. If WORLD-TRAVEL's real sun ships, step from imagery should be low-pass filtered, and cast shadows should come from height.

### 6.8 Atmospheric and colour perspective

Cartographers do this on purpose. Swiss-style relief imitates atmospheric scattering, raising contrast with altitude and adding greenish or bluish tones to low ground [S](https://mail.colororacle.org/berniejenny/pdf/2006_JennyHurni_SwissStyleShading.pdf). This is tied to height as well as distance, which suits a camera looking down.

Patterson and Jenny's cross-blended hypsometric tints vary lowland colour by environment, so arid lowlands lose their green [S](https://cartographicperspectives.org/index.php/journal/article/view/cp69-patterson-jenny). A free raster exists at Natural Earth [S, same], and one package names four palettes: arid, cold humid, polar and warm humid [S](https://rdrr.io/cran/tidyterra/man/scale_cross_blended.html). That is a ready rule for choosing far ramps worldwide, polar included.

For us this becomes a ramp remap by depth band, dithered at band edges. It should enhance the far field and must never be needed to hide it. The audit's rule holds: a strategy that needs haze is no world strategy. The Moon inverts it: no remap, hard shadows.

### 6.9 Painterly far-field tricks

Tricks with evidence behind them:
- **Keep contrast for what matters.** Paint and the bus stay saturated while the far field stays quiet (Alto, blast7).
- **Value layers.** A few distinct bands read as depth (Firewatch).
- **Fading lines** (Sable).
- **Edges from masks.** Stamen's darkened edges come cheap from a raster. In ours, a darker step along a class boundary would draw coastlines and park edges.
- **Hero silhouettes.** Every product keeps some, and we need a rule to pick them. A pixel-height test does it for any city: draw geometry when height reaches 2 px at that range, about 32 m at 10 km and 62 m at 20 km from the ceiling [E, from the audit's table].

---

## 7. Lessons that transfer, ranked

1. **Keep a coarse version of everything resident.** Unreal, Asobo and Cesium all do. Replace the radius with a size-on-screen test.
2. **Draw the parent until the child is ready.** Holes are never acceptable.
3. **Bake each level from the one below, through our own ramps.** Colours then match by construction, and pop-in falls without any extra distance tuning.
4. **Past about 6 km, put ordinary buildings into the ground raster.** Asobo gets this free from photos. We have to bake it: roofs, street gaps, shadows.
5. **Store class and tone apart.** Class from a mode mip, tone filtered, quantise last.
6. **Gate geometry by pixels, never by a fixed height.** This fixes Lagos and Gulu along with SF.
7. **Add measured signal to tone,** using density first and imagery where it helps. This is where the far field stops looking like blobs. The far views I could document carry tonal variation at pixel scale, from photos or density. Ours has 4 colours covering 49-78 % of a band [M].
8. **Use small far vertices and one draw per large cell.** Spider-Man 2 and GTA V show both.
9. **Draw trees as coloured points,** thinned by draw count.
10. **Keep depth bands as ramp remaps.**
11. **Show paint at distance.** `far.bin` carries paint indices that nothing reads [M]. GTA's far lights and MSFS's `EarthLightsMarker` show far layers carrying gameplay-relevant state. Paint should be a separate far layer, since it changes and the bake does not.
12. **Use a sphere-safe grid.** Avoid Mercator for anything that must reach the poles.

---

## 8. Lessons that do not transfer

| Idea | Why it fails for us |
|---|---|
| Photos as final pixels | Breaks palette lock; baked shadows and clouds; colour varies between scenes |
| Photogrammetry meshes | No building identity, so no paint; baked light; only a few hundred cities |
| Google imagery or meshes as bake input | Google's policy bars derivation and image analysis. I did not check Bing's terms |
| Petabyte streaming with disk caches | Phone browser, and no cloud compute per client |
| Octahedral impostors per building | Sub-2-pixel targets; frame blending interpolates colour |
| Fog as the hiding place | Our fog is off, and the Moon has none. The current streaming edge already relies on absent fog [M] |
| TAA, MSAA, continuous alpha fades | Pixel-locked; use dither and prefiltering |
| Hand-composed vistas | BotW, Firewatch, Journey and Monument Valley are art-directed per view. We need rules for 2.53 B buildings |
| Seed-based generators | Elite, NMS and Star Citizen invent their worlds. A real city has no generator |
| Compute-shader terrain | KSP 2 and Star Citizen rely on it; WebGL2 has no compute |
| Hand-built landmarks as the far plan | Works for a hero tier only (Apple, Mapbox) |
| AI tile generation at world scale | Isometric NYC needed manual review for one city, and it failed on water and trees |
| Mercator quadtrees | The poles fail, and the producer named Antarctica |
| Mapbox-style flat maps as the whole answer | We fly at a grazing angle, so flat raster alone fails at about 3-6 km where 10 m walls are still 1-2 px [M] |

---

## 9. What this means for the top defect

The audit's pixel table at the ceiling, the hardest case, with what prior art places in each band:

| Range from camera | One game pixel, across [M] | 10 m wall [M] | What prior art places here |
|---|---|---|---|
| Under about 3 km | 1.3-5.3 m | 5.6-1.9 px | Real objects, as today |
| About 3-6 km | 5.3-10 m | 1.9-1 px | Merged block mass with streets open, roofs from raster |
| About 6-16 km | 10-26 m [E, interpolated] | Under 1 px | Draped raster on terrain; tall buildings added as geometry |
| About 16 km to horizon | Over 26 m | None | Value-compressed silhouette band |

**From the ceiling.** Each band is resident, so nothing is missing. When the bus descends, a finer band replaces a coarser one whose colour was baked from it, so tone stays put and only detail changes. A dithered fade covers the swap. The 37,702 absent buildings in the Sunset view [M] would be present as tone in the raster and as blocks in the 3-6 km band.

**In every other city.** Each input is global or derivable: 2.53 B footprints [M], WorldCover classes to 60°S [M], 10 m composites [M], Overture roads [M]. No band depends on height tags, except the block heights in the 3-6 km band, where the audit's height ladder and raster sources apply. A city of huts still draws every footprint as tone. Antarctica swaps in LIMA and REMA. The Moon swaps in WAC and LOLA.

**Prototype order, all unmeasured:**
1. Use the classes already in `far.bin`, and fix the interpolated ramp. Cost: nearly zero.
2. Bake an SF ground raster from our own G-buffer at 8-16 m, including roofs and shadows.
3. Add trees as points.
4. Try block massing with 4-byte vertices against the height-field ray-march, on a real iPhone, and keep whichever holds 30 fps.

**The acceptance test.** Fly from the ceiling to street level over the Sunset and over Gulu. No region should appear, and no area should change hue.

---

## 10. What I could not confirm

**Sources I could not read.**
- KSP 2 dev diaries: the official site no longer resolves, the forum returned 403 and the Wayback Machine is blocked. I saw only search excerpts.
- Obra Dinn's TIGSource devlog (403), Campo Santo's sky-shader post (403), Sillion 1997 (saved as a binary PDF, not opened, to stay inside the usage budget), Glander's dissertation (over the size limit), the Semmo 2012 level-of-abstraction paper (403), Maxar and Business Wire pages for SYNTH3D.
- GDC talks: only abstracts for Spider-Man 2, Firewatch, Journey, Sable, No Man's Sky, Ghost of Tsushima and A Short Hike. Spider-Man 2's numbers come from one Chinese summary.
- Ryan Brucks' octahedral impostor post returned no body text.
- t3ssel8r: I found no written material of his own.

**Facts not established.**
- How far Flight Simulator draws buildings, and whether photos carry them past that range. That is my inference.
- Anything Asobo-authored on the 2024 terrain. The deck is from 2022.
- Polar failures in Flight Simulator rest on community reports.
- What a city looks like at 20 km in Google Earth, Apple Maps or Mapbox. No browser was allowed, so those descriptions are inferred from data structures.
- Whether Apple's landmarks are hand-modelled, and how Mapbox generates facades.
- Whether Cesium shipped the rasterise-small-buildings idea from issue 4043.
- The far-field technique of Breath of the Wild, Tears of the Kingdom and Genshin Impact. Anything said elsewhere about those is unsourced.
- Pokémon GO's renderer and draw distance.
- Whether WebGL2 lacks sparse textures, from the spec itself.
- Whether Hapke normalisation removes baked shading, from LROC's documents.
- Star Citizen facts come from a community wiki summary of a talk. The two climate layers are likely temperature and humidity, and the wiki does not state it outright.
- SYNTH3D and Outerra numbers come through search summaries of pages I could not open, and Outerra's date from about 2012-2014.

**Limits of the numbers.**
- iOS capability figures are crowd-sourced reports, not Apple specs. A15 memory headroom was not measured.
- Every band boundary, memory figure and fetch count in sections 6 and 9 is an estimate. None has run on a phone.
- The proposals in 6.6 and 6.7 are untested, and no shipped game I found uses them.

---

## 11. Worth reading in full

1. [Asobo's GDC 2022 terrain deck](https://www.asobostudio.com/files/inline-images/Designing_Terrain_System_Fuentes_Lionel.pdf): the best public account of a world-scale far field.
2. [Cesium issue 4043](https://github.com/CesiumGS/cesium/issues/4043): our defect, argued out by people who shipped a fix.
3. [cesium-native's selection algorithm](https://cesium.com/learn/cesium-native/ref-doc/selection-algorithm-details.html): the rules for no holes.
4. [Google's 2020 colour post](https://blog.google/products/maps/more-detailed-colorful-map/): the closest model for class-then-tone.
5. [Stamen's watercolor process](https://stamen.com/watercolor-process-3dd5135861fe/): beauty from plain vector data in raster space.
6. [GTA V graphics study, part 2](http://www.adriancourreges.com/blog/2015/11/02/gta-v-graphics-study-part-2): what a far city costs in draws.
7. [Campo Santo on Firewatch's colour](https://blog.camposanto.com/post/102893584324/i-asked-twitter-if-anyone-had-questions-about-the): how a grey world gets its colour.
