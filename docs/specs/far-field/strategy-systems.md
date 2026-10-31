# One stack for Earth, the ice and the Moon

Far-field strategy from the planet-scale systems angle. 2026-10-30.

Nothing in any repo was changed. No browser, build or bake ran. My tests were short idle-priority CPU jobs on the real baked SF data, plus about 13 MB of small ranged reads of real ice and lunar data.

**Labels.**
- **[M]** measured: by the audits (named) or by my tests, which are offline simulations on real data.
- **[S]** from a source, with its link. Constants in our own repo are [S repo].
- **[E]** estimate, with the inputs next to it.

**No number below has run on a phone.** Fetch counts are measured. Time on an A15 is not.

**Web limit.** The shared web search budget ran out before I started, so I could only fetch pages I could name. Section 16 lists what that left open.

---

## 0. The answer

**Is relying on procedural generation the right move?** No, not for anything you can see from altitude. But procedural generation is not what is causing the blobs. From altitude, 48-72 % of the frame is real footprint-and-height massing and about 2 % is procedural geometry [E, audit-bands]. The far field is not generated. It is missing, because the game throws away real data it already has. So the fix is to stop discarding data, not to generate better. Procedural generation keeps exactly one job: inventing detail below the resolution of the data, such as windows up close or small lunar craters.

**The follow-up is right, and it is worse than the shots show.** From the ceiling, 85-89 % of the buildings in the view are drawn in no form [M, audit-bands]. The game's own load rule, simulated on the real data, shows an empty grey plain where the city should be: bare land fills 60-66 % of the pixels past 3 km [M, mine].

**What to do.** Stop treating a city as a file with a backdrop around it. Build one tile tree per body. Every place on Earth or the Moon has a tile at every level, and a city is only a place where the tree goes deeper. Nothing is ever absent, because a tile's parent stays loaded until its children are ready. Past 2-3 km, one shader draws everything from the same three layers: relief, surface and built height. Ice and the Moon use the same path with an empty built layer.

**Why I believe it.** I ran SF, Ross Island and the Moon's Theophilus crater through one renderer on real data, with only the data and a body record changing.

| | Today's rule | This stack |
|---|---|---|
| Every SF building in the far layer | 1.09 % of buildings, 310 KB [M, audit] | All 169,503: 1.1 MB, or 3.2 MB with the finest level [M] |
| Far triangles | 205,650-210,090 [M, audit] | At most 1,536 [E: 128 tiles at 12 triangles] |
| Texture fetches for the far band at the ceiling | none | 0.7-1.0 M a frame [M] |
| A level swap, all at once, no dither | a whole region pops | Moves local tone on 0.33-0.58 % of far pixels [M] |

**What it costs.** About 0.9-1.4 TB for the whole of Earth plus the Moon, $13-20 a month on R2 [E]. One planet bake is about $150-550 [E]. There is no on-demand bake service and no per-city work.

**What is not proven.** I have not seen it run on a phone, and the far pass gives up Apple's hidden-surface removal. I tested the look on one city, one ice site and one crater, with a few tuned numbers. The hand-over from real meshes to the raster is not measured at all. Section 14 is a 2-3 day phone test that settles the first of these.

---

## 1. The evidence

Everything here was made for this report. Scripts and outputs are in `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/systems/`.

**Look at these three first:**
- `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/systems/presidio-today-vs-stack.png`: the Presidio ceiling view, today's rule on the left, this stack on the right.
- `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/systems/sunset-east-ceiling-strip2.png`: the Sunset far strip, today on top, the stack below.
- `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/systems/scene-three.png`: SF, Ross Island and Theophilus through one renderer.

These are CPU previews through the real palette. They have no windows, outlines or dither. They show what the data can carry. They are not final art.

They also answer an audit gap. The audit had no fog-off capture of the worst view, and these are the first pictures of it [M, audit-bands section 8].

### What the frame looks like

Ceiling pose, 393 x 852, feat/osm data, the game's own load rule [M].

| | Sunset looking east | Presidio looking south |
|---|---|---|
| Pixels past 3 km | 44,081 | 46,416 |
| Share of the frame | 13.2 % | 13.9 % |
| Bare land there today, counted by what each ray hit | 26,439 px, 60 % | 30,367 px, 66 % |
| Of those pixels, loaded tiles and far boxes today | 3,892 px, 9 % | 11,748 px, 25 % |
| Top 4 colours in rows 212-265, today → stack | 89.9 % → 50.6 % | 97.9 % → 64.5 % |
| Top 4 colours in rows 265-318, today → stack | 91.4 % → 64.7 % | 89.8 % → 65.8 % |
| Distinct colours in rows 212-265, today → stack | 12 → 28 | 12 → 28 |

My bare-land shares are 7.9 % and 9.1 % of the frame. The audit's are 7.4 % and 6.7 % from its own ray march, so treat the two as agreeing to within about 2.5 points.

The strip that carries the defect is only 13-14 % of the frame. That is the key engineering fact: the far band can never cost more than its pixels.

### What every building costs

The `built` layer for all 169,503 SF buildings, in 256-texel tiles, in deflate-raw, the format a phone decodes natively [M]. Each texel holds height (2 m steps under 100 m), three bits of roof tone, and street, walk or rail.

| Level | Texel | Tiles | Total | KB per tile: median / p95 / max |
|---|---|---|---|---|
| 13 | 4.4 m | 154 | 2,099 KB | 13.2 / 29.0 / 32.1 |
| 12 | 8.8 m | 47 | 782 KB | 14.4 / 39.6 / 41.5 |
| 11 | 17.6 m | 15 | 249 KB | 18.3 / 40.3 / 45.5 |
| 10 | 35.2 m | 4 | 71 KB | 13.6 / 34.3 / 37.4 |
| 9 | 70.4 m | 1 | 18 KB | 17.5 |
| **All** | | **221** | **3.2 MB, 19.0 B per building** | |
| **12 and coarser** | | **67** | **1.1 MB, 6.6 B per building** | |

For scale, today's far.bin is 310 KB and holds 1.09 % of the buildings, and the same city's regions are 25.5 MB [M, audit-bands]. This was measured on a flat 4.4 m lattice, not a true S2 one, and it has no canopy channel.

### What the far band costs per pixel

Count of texture fetches a shader would make, using a max-mip march capped at the tile edge. Far pixels only [M].

| View | Far pixels | Mean per pixel | p95 | Max | Per frame |
|---|---|---|---|---|---|
| SF Sunset, ceiling | 42,791 | 17.4 | 32 | 68 | 0.74 M |
| SF Presidio, ceiling, with the hills ring | 44,262 | 21.4 | 36 | 81 | 0.95 M |
| SF, 250 m | 11,380 | 28.1 | 48 | 101 | 0.32 M |
| SF street, downtown | 1,664 | 29.1 | 52 | 72 | 0.05 M |
| SF street, Sunset | 597 | 22.1 | 39 | 66 | 0.01 M |
| Ross Island, ceiling | 18,497 | 15.8 | 28 | 68 | 0.29 M |
| Theophilus, ceiling | 33,759 | 23.9 | 40 | 75 | 0.81 M |
| SF at 2 km, wide lens, everything far | 200,016 | 16.4 | 25 | 43 | **3.29 M** |
| Moon at 5 km, wide lens, everything far | 203,116 | 22.2 | 39 | 133 | **4.51 M** |

The worst case is about 135 M fetches a second at 30 fps [E, arithmetic]. Street level costs almost nothing, because near buildings hide the far band.

### Does it pop or crawl?

My first version failed this. Choosing roof or wall per pixel at 1.5 buildings per pixel gave salt-and-pepper noise (`C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/systems/sunset-east-ceiling-strip.png`). The fix is a bake rule: each level stores the mean brightness of the level below, put back on the block's commonest ramp. Ranges are the two views [M]. "Px" is the share of far pixels whose ramp changed or whose step moved by 2 or more. "Local" is the share whose 5 x 5 average moved by more than a ramp step.

| | Point-shaded | Tone baked upward | 4.4 m raster everywhere, standing in for real meshes |
|---|---|---|---|
| Level swap with no dither, px | 12.7-13.4 % | **9.1-11.5 %** | n/a |
| Level swap with no dither, local | 1.3-1.8 % | **0.33-0.58 %** | n/a |
| 10 m of flight, px | 18.4-20.9 % | **11.7-13.5 %** | 24.2-26.3 % |
| 10 m of flight, local | 2.5-5.3 % | **0.25-0.55 %** | 2.2-2.4 % |

Two readings:
- A worst-case level swap changes no more pixels than a third of a second of flight at cruise, 30 m/s [S repo: src/config.ts, via research-priorart].
- The far band crawls about half as much as real geometry would at that range.

**One cost showed up.** Fading near contrast toward the far tone lifted the top-4 share in rows 424-477 of the Presidio view from 57.4 % to 71.7 %. That fade needs tuning.

### Three worlds, one path

`scene.py` has one march, one shade and one finish, and no test of place. The inputs that differ are the rasters and the body record. Cover is data: where a world has none, the array is zero.

| Scene | Real data | Levels | Added below the data |
|---|---|---|---|
| Presidio, SF | feat/osm footprints, heights, classes | 4.4 m to 128 m | Nothing |
| Ross Island, sun 14° | REMA 32, 64 and 128 m ([source](https://registry.opendata.aws/pgc-rema/)) | 16 m to 128 m | Nothing. Tone is high-passed real relief |
| Theophilus, sun 9° | LOLA 118 m, SLDEM 59 m, WAC 100 m ([LOLA](https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m), [SLDEM](https://astrogeology.usgs.gov/search/map/moon_lro_lola_selene_kaguya_tc_dem_merge_60n60s_59m), [WAC](https://astrogeology.usgs.gov/search/map/moon_lro_lroc_wac_global_morphology_mosaic_100m)) | 7.4 m to 118 m | Seeded craters under 59 m |

**Limits of this test.**
- The near band is a 4.4 m raster, not real meshes.
- The ice class map is a stand-in rule (slope and height) for BedMachine and ADD, and the 53.4 m sea offset is one sample.
- Three ramps (ICE, REGOLITH, NIGHT) are my placeholders.
- Which tone source each scene used was my choice. In the real bake a contrast test makes it.
- SF's tone holds cast shadows under today's fixed sun. A moving sun needs them in the light layer.

---

## 2. The design on one page

**Seven rules.**

1. **One tree.** Each body is a cube of quadtrees. A tile key is (body, level, cell). Nothing in the stack knows what a city is.
2. **Nothing is ever absent.** There is no load radius. A tile's parent stays resident, and the parent draws until its children are ready. Unreal, Asobo and Cesium all do this ([Cesium](https://cesium.com/learn/cesium-native/ref-doc/selection-algorithm-details.html), [Asobo deck](https://www.asobostudio.com/files/inline-images/Designing_Terrain_System_Fuentes_Lionel.pdf)).
3. **Detail is chosen by pixels.** A level may be used while its texel is at most 1.6 game pixels. A building keeps its height at a level only if it is at least 2 px tall at that level's range. Otherwise it stays as tone.
4. **Each level is baked from the one below, through the ramps.** Mean brightness, commonest ramp, then the step on that ramp with that brightness. Hue is never averaged, so nothing can go brown.
5. **Layers split along licence and update boundaries.** One tile family can never contaminate another, and each refreshes on its own clock.
6. **One far renderer.** Tile boxes and a height-field march, from 2-3 km to orbit, for hills, blocks, forest, ice and craters alike.
7. **Procedural generation lives in one function, `synthChild`.** When the camera wants a tile deeper than the data goes, the worker makes it from its parent, the cell key and the class. It is deterministic, so all players see the same crater. The rest of the engine sees a normal tile.

**Any special case is a defect, so all difference is data.** Three tables hold it:

```
Body    earth: radius 6371008, reference EGM2008, sea 0, value 15-90 km, sky FOG, ambient .30, sun .52, bounce .24, ndlPow 1
        moon:  radius 1737400, reference sphere,  sea none, value none,  sky NIGHT, ambient .05, sun .95, bounce 0, ndlPow .55

Class   one enum for all bodies: OCEAN, WATER, ICE, ROCK, BARE, CROP, GRASS, TREE, BUILT, REGOLITH ...
        each row: candidate ramps, light offset, how far slope shading is calmed, detail rule for synthChild

Source  rows of (body, layer, region, levels, input, vertical datum, filter). Ice and the Moon are rows, not branches
        earth surface.class  south of 60°  → BedMachine mask, ADD rock, default ICE
        moon  relief         whole body    → LOLA 118 m, SLDEM 59 m, Kaguya DTM
```

The Body values above are the ones the preview used, apart from the datum and sea fields. `ndlPow` is a stand-in for regolith's non-Lambert brightness at low sun.

---

## 3. Tile scheme and frames

### Tiles

**S2 cube-sphere addressing, one per body, 256-texel tiles.** All of Antarctica sits on one face with texels varying only 1.22 times, and all six Apollo sites share one face [E, research-polar-lunar]. S2's ids follow six linked Hilbert curves, so close ids are close on the ground ([source](https://s2geometry.io/devguide/s2cell_hierarchy.html)). That gives file order and spatial order for free. Its global area ratio is 2.08 ([source](https://raw.githubusercontent.com/google/s2geometry/master/src/s2/s2coords.h)), about 1.44 times in texel size. Selection by pixels absorbs that.

| Level | Earth tile | Earth texel | Moon tile | Moon texel | What ends here |
|---|---:|---:|---:|---:|---|
| 3 | 1,153 km | 4.5 km | 314 km | 1.2 km | |
| 6 | 144 km | 563 m | 39 km | 153 m | **Archive and bake unit.** LOLA 118 m ends about here on the Moon |
| 8 | 36 km | 141 m | 9.8 km | 38 m | SLDEM 59 m |
| 9 | 18 km | 70 m | 4.9 km | 19 m | Kaguya DTM 17-33 m |
| 10 | 9.0 km | 35 m | 2.5 km | 9.6 m | **GLO-30 and REMA 32 m.** Kaguya images. Paint rooms |
| 11 | 4.5 km | 18 m | 1.2 km | 4.8 m | |
| 12 | 2.3 km | 8.8 m | 0.6 km | 2.4 m | **10 m imagery and land class** |
| 13 | 1.1 km | 4.4 m | 0.3 km | 1.2 m | **`built`. Objects, the same size as today's 1 km regions** |

Sizes are [E, average cell area]. Data limits are from research-polar-lunar and research-earth.

**Sparse by data.** A parent's header has a child mask and a uniform flag. Open ocean has no files. The tree stops where the data stops, and `synthChild` carries on from there.

**Why not a clipmap.** WORLD-TRAVEL's rings need one vertex lattice, and a cube has six that meet rotated. Research-polar-lunar flagged this as a risk needing a spike. Tile boxes never read a neighbour, so face seams need no code at all, and their texels are locked to the world, which is what pixel art wants.

**Why not Mercator or UTM.** Web Mercator stops at 85.05° ([source](https://learn.microsoft.com/en-us/bingmaps/articles/bing-maps-tile-system)). UTM zones pinch to 12 km at 89°S and do not exist on the Moon [E and S, research-polar-lunar]. Flight Simulator's Mercator quadtree is the warning: its deck accepts the polar stretch, and players report broken polar terrain ([community](https://forums.flightsimulator.com/t/ever-tried-flying-over-antarctica-things-get-weird-down-there/261835)).

### Frames

| Frame | Holds | Note |
|---|---|---|
| Truth | Body-fixed XYZ in float64, on the CPU | No lat/lon, so no pole or date-line problem |
| Tile | Local tangent frame at the tile's centre | Small numbers on any body |
| Render | Tangent frame at a floating origin, f32, within about 50 km | WORLD-TRAVEL section 1 stands |

- **One rebase rule everywhere.** The origin moves when the bus is more than 20 km from it. Fly around a city and it never moves. That is the same rule, not a city mode.
- **A rebase is a rotation plus a translation**, through WORLD-TRAVEL's `pipeline.rebase`. There are no zones, so no 6° yaw every 12 km at 89°S.
- **Curvature is geometry.** The CPU places each tile in float64 and the worker subtracts each texel's sag, so no vertex-shader chunk is needed. `sbCurve` survives only as an optional exaggeration.
- **Headings and the sun are vectors.** Then the pole is an ordinary place.
- **Heights** are a per-tile base plus a 16-bit offset. The ±3,200 m clip and the 3,276.7 m tree crash [M, audit-limits] cannot happen.
- **Migration.** Version one places far tiles into today's city frame through `geo.ts`, so City.ts and everything near it is untouched.

---

## 4. Layers

| Layer | Per texel | Levels on Earth | Licence family | Refresh |
|---|---|---|---|---|
| `relief` | Height: 16 bits, per-tile base and step | 0-10 everywhere, deeper where open DTMs exist | Independent | Rarely |
| `surface` | Class, tone, canopy height | 0-12 | Independent | Yearly |
| `built` | Height, material, street | 9-13, only where footprints exist | ODbL | Monthly or quarterly |
| `objects` | Vector: buildings, trees, obstacles, names, spans, targets | 13, with spans and targets at 10 | ODbL | With `built` |
| `paint` | Hue, level, coverage | 12 and up | Ours | Live |
| `light` | 8-bit light | Any | Made on the phone, no bytes | When the sun moves |
| `night`, later | Glow | 7 | Open | Yearly |

### Sources by place

| Layer | Earth | South of 60° | Moon |
|---|---|---|---|
| `relief` | [GLO-30](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM), [Mapterhorn](https://mapterhorn.com/) inputs, [GEBCO](https://www.gebco.net/data-products/gridded-bathymetry-data) | [REMA](https://www.pgc.umn.edu/data/rema/) to a geoid, filled to the pole | LOLA, SLDEM, [Kaguya DTM](https://stac.astrogeology.usgs.gov/docs/data/moon/kaguyatc_dtms/) |
| Class | [WorldCover](https://docs.terrascope.be/DataProducts/WorldCover/WorldCover.html) | [BedMachine](https://nsidc.org/sites/default/files/documents/user-guide/nsidc-0756-v004-userguide.pdf) mask, [ADD rock](https://data-search.nerc.ac.uk/geonetwork/srv/api/records/815525ca-cefe-4fbf-9224-3ee784e7de4e), default ICE | [Unified Geologic Map](https://astrogeology.usgs.gov/search/map/unified_geologic_map_of_the_moon_1_5m_2020) |
| Tone | [WorldCover composite](https://registry.opendata.aws/esa-worldcover-vito-composites/), later [CDSE mosaics](https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-global-mosaics) | High-passed relief or [MOA](https://nsidc.org/sites/default/files/nsidc-0730-v001-userguide.pdf) hp1; [LIMA](https://lima.usgs.gov/access.php) on rock | [WAC Hapke](https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_HAPKE) base, high-passed WAC and Kaguya detail |
| Canopy | [Meta canopy height](https://registry.opendata.aws/dataforgood-fb-forests/) | none | none |
| `built` | Overture, heights ladder | Overture | none, 0 bytes |
| Targets | Buildings, named places | Stations, gazetteer features | [Robbins craters](https://astrogeology.usgs.gov/search/map/moon_crater_database_v1_robbins), [IAU names](https://planetarynames.wr.usgs.gov/Page/MOON1TO1MATLAS) |

**Three rules that keep this clean.**

- **Class first, tone second.** Class picks the ramp and measurement picks the step. Google Maps' 2020 colour update is the closest shipped precedent ([source](https://blog.google/products/maps/more-detailed-colorful-map/)). Natural colour contains brown, so RGB is never used directly [M, research-earth previews].
- **Roof tone comes down from the same imagery.** Each building's roof step is its measured mean tone, stored in `objects`. Near roofs then match the far raster by construction, and the audit's "0 % of pixels show a measured colour" ends. Flight Simulator's trees sample the aerial under them for the same reason ([deck](https://www.asobostudio.com/files/inline-images/Designing_Terrain_System_Fuentes_Lionel.pdf)).
- **Bare earth without OSM.** GLO-30 includes roofs and trees ([source](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)). The bake flattens them using WorldCover's built and tree classes, not Overture footprints, so `relief` stays outside ODbL.

**Bridges.** A height field cannot do overhangs. Overture segments carry `is_bridge`, `is_tunnel` and `level_rules`, and the bake already reads them only to drop those segments [S repo: osm.py:363-364, overture.py:58]. `objects` adds a `spans` list, drawn as thin ribbons in one instanced draw. That is every bridge in the world, replacing SF's two hand-built ones. Hero props become rows of data, with no `isSfOrigin`.

---

## 5. The far renderer

**Three steps.**

1. **Worker.** Decode each layer's tile with `DecompressionStream('deflate-raw')`, which is in the [standard](https://compression.spec.whatwg.org/) and [baseline since May 2023](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream). Compose top height = relief + built + canopy - sag. Build its max mips. Sweep the sun across it for light. Upload to fixed texture arrays, one tile a frame.
2. **Main thread.** Pick tiles by pixels, write a fixed instance buffer, and make one instanced draw of a 12-triangle box per tile. No per-frame allocation.
3. **Fragment shader.** Start where the ray enters the box. Walk the max mips to the first hit. On a miss, discard, and the next box catches that ray. On a hit, write ramp and step through `sbWrite`, and write depth.

**Why boxes and a march.**
- **Cost follows pixels, not buildings.** Lagos costs the same as an ice sheet.
- **No palette risk.** Ramp is an integer fetch, so the interpolated-ramp bug [M, audit-bands] cannot occur.
- **It removes four systems.** Far ground, far boxes, horizon mesh and water plane become one draw.
- **Maximum mipmaps are published and cheap to build** ([Tevs et al.](https://tevs.eu/project_i3d08.html)). This design is untested on a phone in this form.

**The Apple warning.** `discard` and `gl_FragDepth` switch off hidden-surface removal for those fragments, and Apple says to draw such objects after opaque ones ([retired OpenGL ES guide](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/Performance/Performance.html)). So the order is near opaque meshes first, with their HSR intact, then tile boxes front to back, then far props. Cost stays bounded because box pixels are bounded. This is the first thing the proof must measure.

**If the march fails on a phone, the data survives.** The worker can mesh the same raster into merged per-tile roofs and walls. That needs no re-bake.

**Selection.** The rule is texel at most 1.6 px, with parents resident and a fixed pool of 128 array slots. Speed biases toward coarser levels at G2 and G3, where tiles stream past faster than detail reads.

**The near radius becomes a quality knob.** Today it is a cliff. With the raster behind it, the near set can shrink to fit the triangle budget or an older phone. That is also the answer to feat/osm pushing the ceiling over budget: 763-912k loaded triangles [M, audit-bands] could fall by about half if only forward tiles within about 2.5 km stay as meshes [E].

**Hand-over, near to far.** Tile by tile, with a Bayer screen-door over about 0.3 s, which is standard for LOD cross-fades ([Unity](https://docs.unity3d.com/6/Documentation/Manual/class-LODGroup.html)). This is the least tested part of the design. My near band is a raster, so a real mesh against the raster has never been compared.

**Light and "keep all shadows".** The worker sweeps relief, built and canopy once per tile, so every block and hill casts in the far band, where nothing casts today.
- A parent's shadow passes down to its children, which is how a 3 km lunar rim casts 115 km [E, research-polar-lunar].
- The Theophilus preview does exactly this.
- Near geometry can sample the same layer to receive far ridges' shadows.
- Today's fixed sun needs one sweep per tile. A real sun needs slow staggered re-sweeps. Research-polar-lunar guesses 0.3-1 ms per tile on a worker [E, not benchmarked].

---

## 6. Band by band, street to orbit

Ranges are at the ceiling lens. They slide with the lens, because selection is by pixels.

| Band | Drawn | From | Real | Procedural, and why | Phone | Bytes |
|---|---|---|---|---|---|---|
| **Street to 0.7 km** | LOD 0 meshes, trees, ground | `objects`, `relief`, `surface`, fine class | Footprints, heights, streets, roof tone | Windows, trims, roof clutter: no data exists | As today: 120-180 draws, about 1.1-1.4 M tris including the sun pass [M, audit] | About 60-80 KB per region once the DEM moves to `relief` [E: audit's 41 % DEM share] |
| **0.7 to 2-3 km** | LOD 1 meshes, contrast easing toward far tone | Same | Same | Windows fade by pixel size | Falls with the near knob | Same file |
| **2-3 to 6 km** | March at levels 13-12: every block, street gaps, walls of 1-2 px, cast shadows | `built`, `surface`, `relief`, `light` | All massing, tone, shadows | None | One shared draw. Up to about 1 M fetches | 13-14 KB `built`, 18-24 KB `surface` per tile [M] |
| **6 to 25 km** | March at levels 11-10: blocks as tone, buildings 2 px or taller as height | Same | All. Low-rise lives in tone | None | Same draw, 0.6 px walls | 14-18 KB `built`, 18-24 KB `surface`, 11-35 KB `relief` [M] |
| **25 km to horizon** | Levels 9-7: relief, class, tone, towers over about 125 m | `relief`, `surface` | All | None | Same draw | About 40 KB per tile [E] |
| **High flight, 2-10 km up** | All far, levels 12-6 | Same | All | None | 3.3-4.5 M fetches, no near band [M] | 5 Mbit/s at G2 over land [E] |
| **Orbit, 10-50 km up** | Levels 6-3, ocean in the resolve, cloud deck | Same, plus weather | All land | Clouds until GFS is wired | Same draw | 11 Mbit/s at G3 over land, about 0 over sea [E] |

**Totals for the ceiling view [E].**
- Forward wedge 1.4 MB, all-round 4.0 MB. Today's is 2.6-4.1 MB plus 0.5 MB [M, audit].
- 128 tiles of GPU data are about 56 MB, against 210-434 MB of vertices to keep one city meshed [E, audit-bands].
- 2-3 draws at most for the far world.
- First picture: a few coarse ancestors, about 200 KB, soft for a moment and then refining. The sharp forward view is the 1.4 MB above, against today's 0.5 MB boot plus the regions [E].

**Against the budget.** Removing about 205-210k far triangles frees about 18 % of a 1.15 M frame [M, audit-bands]. The far stack adds no per-building draws and no per-frame allocation.

---

## 7. Place by place

Sizes are per 256-texel tile unless stated. Other cities come first, because that is the defect's real test.

| Place | Layers with bytes | What you see from the ceiling | Procedural |
|---|---|---|---|
| **Dense city** | All | Every block, parks, hills, skyline, tone from real roofs. Previewed on SF | Windows only, near |
| **Farmland** | `relief`, `surface`, sparse `built` | Real field patterns at 10 m, ramp chosen between green and straw by imagery, class edges inked one step darker, roads, farmhouses as single texels. A 32-colour real sample is at `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/earth-tmp/probe/central_valley_farms_idx32.png` | Crop rows below 10 m |
| **Desert** | `relief`, `surface` | Dune and wadi relief from the sun sweep, tone normalised per class so the Sahara uses its whole ramp. Fixed thresholds flattened it to 1-2 steps [M, research-earth]. Sand needs its own ramp, not the sky's [M, audit-limits] | Ripples below data |
| **Forest** | `relief`, `surface` with canopy | Canopy height makes real lumpy relief and edges, so a forest is shaped, not painted. Costliest land at 3.98 bpp in the Amazon [M, research-earth] | Near tree shapes |
| **Ocean** | None on 71 % of Earth [E, from land share] | Analytic in the resolve, as WORLD-TRAVEL plans. Coasts are real tiles with depth from GEBCO | Glitter |
| **Ice sheet** | `relief`, thin `surface` | Mountains by low sun. Flat ice has 0.9 % contrast [M, research-polar-lunar], so tone falls back to high-passed relief, automatically. See the Ross Island preview. 2-5 GB in all [E] | Sastrugi below data |
| **Lunar highlands** | `relief`, `surface` | Real relief, hard long shadows, no haze, black sky, curved horizon at 48 km. See Theophilus. About 25 GB [E] | Seeded craters inside the nearest 3-10 km [E, research-polar-lunar] |

### Every other city

- **The gate is footprints, never height.** The far layer draws what is there, so Gulu and Ikeja fill in the same way. Today's 20 m gate keeps 0 % and 0.08 % of them [M, audit-limits].
- **Heights fall through a ladder and are reported.** Tags, then [Microsoft](https://github.com/microsoft/GlobalMLBuildingFootprints), [Google 2.5D](https://sites.research.google/gr/open-buildings/temporal/), [3D-GloBFP](https://zenodo.org/records/15487037), [GHS-BUILT-H](https://developers.google.com/earth-engine/datasets/catalog/JRC_GHSL_P2023A_GHS_BUILT_H), then neighbours. An error of 5-10 m is about a pixel at 5 km [E, research-earth], which is why this works at distance.
- **No city is an island.** London and Amsterdam stop being islands in a 60 km sea, because the tree has land everywhere.
- **No tiers and no uncharted fog.** With no object tile yet, the 4.4 m raster still draws a recognisable city down to low altitude.
- **Height is the honest weak point outside rich cities.** Procedural heights are the part of the producer's worry that stays true. The stack reports the share of invented heights per cell.

---

## 8. How painted buildings read at distance

Today paint stops at the streaming edge: `far.bin` carries paint indices and City.ts never reads them [M, audit-bands].

**Paint becomes a layer in the same tree.** Each texel holds hue, level and coverage, at 8.8 m and up. After the ray hits, the shader asks the paint layer, so roofs and walls in the far band carry colour.

**Hue is never averaged.** Parents take the commonest hue plus coverage. Below a pixel, coverage becomes a fixed screen-door of pure hue, so distant paint stays clean and never muddies.

**How big it stays** [E: 120 m blast, 38° lens]:

| Range | One blast | One 8 m house |
|---|---:|---:|
| 3 km | 23 px | 1.5 px |
| 5 km | 14 px | 1 px |
| 10 km | 7 px | Screen-door fleck |
| 20 km | 3 px | Merged with its block |
| 40 km | 2 px | Merged with its block |

**The picture.** The far city is deliberately quiet, so paint is the only saturated thing in it. A painted block is a rainbow fleck on a grey city. A painted district is a patch you can navigate by. MAGIC-SPEC's beacons sit on top, with their 3 px floor, at no new draws [S repo].

**Cost.** Only tiles with paint take a slot, and there are no extra draws. That also retires ground paint's one draw per tile and its 160-tile cap [M, audit-limits], which an ice sheet would hit at once.

**Data flow.** The shooter has the footprints, so it writes its own paint texels. Solo play keeps them in IndexedDB. Later the Durable Object stores the same run-length tiles, as WORLD-TRAVEL already plans for ground paint. Paint is keyed by cell, so it never migrates when GERS ids change.

**Targets, not buildings.** Anything with a stable id and a footprint can be painted: buildings, peaks, ice fronts, craters. The Moon's 1.3 M catalogued craters [S](https://astrogeology.usgs.gov/search/map/moon_crater_database_v1_robbins) work with no new code. Research-polar-lunar's no-paint list ships as baked data.

---

## 9. The bake

**One program, one job per level 6 cell, one source table.** About 7,200 cells' worth of land area, and I assume about 9,300 cells touch any land [E: 38 % of 24,576]. The global batch replaces the on-demand bake service, because at these costs a service is not worth building.

For each cell:
1. Read each source window. Partition by cell polygon, never by lon/lat box, which fails at the pole and date line [M, audit-limits].
2. Warp to the cell's lattice, datum to the Body's reference.
3. `surface`: class by mode, tone normalised, canopy.
4. `relief`: flatten built and tree classes, set water levels per water body.
5. `built`: rasterise footprints with the heights ladder, streets, the 2 px rule.
6. `objects`: today's region bins, with roof tone added and the DEM removed.
7. Pyramid upward, write archives, write a QA record.

### Beauty with no human

| Rule | What it stops |
|---|---|
| Class picks ramp, tone picks step | Brown, wrong hues |
| Tone rank-normalised per class across overlapping cells | Flat Sahara, tile seams |
| If measured tone is near flat, fill from high-passed relief | Featureless ice |
| Tone low-passed or high-passed around the relief scale | Baked shadows fighting the real sun. WAC has 55-75° incidence ([source](https://astrogeology.usgs.gov/search/map/moon_lro_lroc_wac_global_morphology_mosaic_100m)) |
| Class edges one step darker | Coasts, parks and fields dissolving. [Stamen](https://stamen.com/watercolor-process-3dd5135861fe/) is the precedent |
| Relief light from the sweep, low sun where possible | Flat melted land |
| Value compression by depth, from the Body record | Noise at the horizon, without needing haze |
| Near contrast eases toward far tone | Band edges |

**QA with no human, per cell.** The bake renders a few poses with a CPU path like `scene.py` and scores them. Gates:
- top-4 colour share under about 70 % in far rows
- each class uses at least 4 steps
- no ramp outside the class table
- local-tone pop under 1 % on a level swap
- share of invented heights recorded

A failing cell falls back to a safer tone source and is listed. The gates are my proposal and only tested on SF. Automatic QA catching ugliness is unproven.

### Cost

| Item | Number |
|---|---|
| Far stack compute | About 1,150 core-hours, $100-200 with transfer [E, research-earth] |
| Near objects | 2.5-25 M core-seconds, $30-350 [E, WORLD-TRAVEL] |
| **One planet bake** | **About $150-550 [E]** |
| Machine | Rented, close to the data. Reads here were 28-92 KB/s [M, research-earth] |

---

## 10. Storage, CDN and updates

| Stored | Size |
|---|---|
| `surface` + `relief` at 10 m and 30 m | 0.63-0.80 TB [E, research-earth] |
| `built` | 48 GB at SF's ratio, 144 GB if dispersed fabric costs 3 times as much [E, from M] |
| Antarctica, Moon | 2-5 GB, about 25 GB [E, research-polar-lunar] |
| **Far stack** | **0.71-0.97 TB [E]** |
| `objects` | 160-380 GB [E, research-earth] |
| **All** | **0.87-1.35 TB, $13-20 a month** at [$0.015 per GB-month](https://developers.cloudflare.com/r2/pricing/) [E] |
| Bake inputs kept for reproducibility | About 350 GB, $5 a month [E] |

**Archives, not tile files.** One object per tile would be about 92 M uploads, $415 at [$4.50 per million](https://developers.cloudflare.com/r2/pricing/), on every full bake [E]. One [PMTiles v3](https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md) archive per level 6 cell and layer is about 37,000 uploads, $0.17 [E], mean 36 MB. PMTiles has Hilbert-clustered data and a 16 KiB root directory. Inside each cell, z/x/y mean level and S2 i/j, and tiles are typed as unknown.

**Serving.**
- R2 with a custom domain goes through Cloudflare's cache ([source](https://developers.cloudflare.com/r2/buckets/public-buckets/)). `r2.dev` is rate-limited and for development only.
- `.bin` is cached by default, and JSON is not ([source](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)). So manifests use `.bin` too.
- Range requests are served from cached objects, and the size limit applies to the whole file ([source](https://developers.cloudflare.com/cache/reference/range-requests/)). The limit is 512 MB below Enterprise ([source](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)). So archives split at 256 MB into their four children. A 12 M-building metro would otherwise exceed it [E].
- R2 egress is free ([source](https://developers.cloudflare.com/r2/pricing/)).
- **No Worker on the hot path.** Protomaps' pattern routes tiles through one, at [$0.30 per million requests beyond the included 10 M](https://docs.protomaps.com/deploy/cloudflare). A million daily players at 300 tiles each would be about $90 a day if each tile hit a Worker [E].
- R2 misses can take 500 ms or more ([source](https://docs.protomaps.com/deploy/cloudflare)). The parent rule hides that, because a slow tile just means a coarser tile a moment longer.

**Updates.**
- Paths are `{body}/{layer}/{release}/{cell}.bin`, immutable and cached forever.
- A `releases.bin` of about 10 KB maps level 4 cells to releases [E]. Rollback changes one pointer.
- `built` and `objects` share a release id, so near and far always agree.
- A monthly rebake touches only cells whose GERS ids changed. Unchanged tiles keep their hash.
- `surface` yearly, `relief` rarely, the Moon almost never. `paint` is live.

**Dates to plan around.** Overture keeps releases at most 60 days, so a bake must archive its inputs ([source](https://docs.overturemaps.org/release-calendar/)). 2026-12-16 is a reserved major release with breaking changes (same source).

---

## 11. Licences

Layer boundaries are licence boundaries. That is the point of rule 5.

| File | Holds | Treat as | Duty |
|---|---|---|---|
| `built`, `objects` | Overture | ODbL Derivative Database | Keep notice, offer tiles and method, no DRM, no EULA limits on extraction ([ODbL 4.6-4.8](https://opendatacommons.org/licenses/odbl/1-0/)). Plain public archives meet this |
| `surface` | WorldCover, composite, canopy | Independent, CC BY 4.0 | Credit and state changes. **Stays independent only if no OSM is burned in** ([guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline)) |
| `surface` from CDSE | Sentinel mosaics | Copernicus notice | "Contains modified Copernicus Sentinel data" ([notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice)) |
| `relief` | GLO-30 and others | Independent | Art. 6(b) notice and the Art. 6(c) liability sentence ([licence](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf)) |
| Ice, Moon | REMA, ADD, LIMA, LOLA, SLDEM, WAC, Kaguya, geologic map | CC BY, public domain or CC0 | Credits per research-polar-lunar section 9 |
| Game code and art | Ours | Attribution only | [Credit on a splash, credits page or menu](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) |

**Never in any tile:** Google, Bing or Mapbox imagery, whose terms bar baking ([Google](https://cloud.google.com/maps-platform/terms), [Mapbox](https://www.mapbox.com/legal/product-terms), [Bing](https://www.bingmapsportal.com/terms)), or FABDEM, GlobalBuildingAtlas and EOX's newer mosaics, which are non-commercial or sold ([FABDEM](https://www.fathom.global/product/global-terrain-data-fabdem/), [GBA](https://raw.githubusercontent.com/zhu-xlab/GlobalBuildingAtlas/main/README.md), [EOX](https://cloudless.eox.at/documentation/license)).

**Open questions for counsel or a short email.**
- Does paint rasterised from footprints stay ours?
- CDSE: are the mosaics Sentinel data, as I read them?
- PGC on REMA commercial use.
- Six Japanese DEM sources inside Mapterhorn. Exclude them until checked [M, research-earth].

This is not legal advice.

---

## 12. What changes in WORLD-TRAVEL

| Plan | Verdict | Change |
|---|---|---|
| float64 truth, floating origin, lattice-preserving rebase | Keep | Add rotation to every move |
| UTM content frames and zone keys | Replace | S2 cells, tile frames |
| Eight-ring geometry clipmap | Replace | Tile boxes |
| `GLSL_CURVE` in every vertex shader | Mostly drop | Sag per texel, tiles placed in float64 |
| Height, class, coast SDF, density atlas | Replace | `relief`, `surface`, `built`, `light` |
| L3 "1-20 km" against a 1.9 km streamer | Removes the contradiction | Bands 3-5 of section 6 |
| L4: boxes of 20 m or more plus density blocks | Replace | Every footprint, the 2 px rule |
| Three bake tiers and an on-demand service | Replace | One global batch |
| "Uncharted is a fog bank" | Drop | Nothing is uncharted |
| "Planet z0-z11 is a few GB" | Wrong | 0.7-1.0 TB at 10 m [E] |
| Shadows off above 2 km | Replace | Sweep light costs no pass |
| Analytic ocean, cloud deck, sun, server, charge economy, crossing | Keep | Paint rooms become level 10 cells, Stage cells level 16 [E on size] |

**Checklists.** Against audit-limits section 7 and research-polar-lunar section 10:

| Requirement | How it is met |
|---|---|
| Gate on footprints, never height | 2 px rule on real footprints |
| Keep what the bake knows | All classes, streets, paint reach the far band |
| Need no haze | Moon preview. Value compression is optional |
| Every frame has a surround | The tree is global |
| Report invented data | Per-cell QA record |
| Water level per water body | In `relief` |
| Base height per tile | Yes |
| `Body` record | Section 2 |
| Generated configs, parallel bake | No configs: one job per cell |
| Real test set | The audit's nine, as they stand: Denver, Chicago, La Paz, Dhaka, Lagos, Gulu, Longyearbyen, McMurdo, Apollo 11 |
| Always-present pyramid, no load radius | Rule 2 |
| Band edges invisible without fog | Measured in simulation only |
| Tone holds no baked shadows | Bake rule, to be proven at planet scale |
| Terrain shadows at any distance | Sweep |
| Procedural only below data | Rule 7 |

---

## 13. What this does not fix

- **The mid-field's surface.** Outlines end at 520 m, house windows at about 650 m, trees vanish past 1.5 km [M, audit-bands]. Those are renderer constants. The stack gives measured roof tone there and nothing more.
- **Main's wrong ground.** That is fixed by merging feat/osm. This stack assumes feat/osm data.
- **Night, weather, sound, signs in Bengali.** These are real work on their own.
- **City identity.** No rule-based bake will make Tokyo feel like Tokyo. Body and class tables can vary by climate, but a colour script per hero city stays human work, and that is fine.

---

## 14. Smallest proof, then order of work

**The offline part is done.** The render, stability and cost tests in section 1 took one evening on a laptop at idle priority.

**The proof that decides it takes 2-3 days and needs a real iPhone 13.**

Build `dev/farband.html`. No planet bake is needed: cut SF's `built` from the existing bins into the 66 tiles of levels 12-10, and keep today's near band. Add the ice and lunar windows I already fetched (13 MB, in `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/farfield/systems/windows/`). The shader must have no test of place.

| Test | Pass | If it fails |
|---|---|---|
| Sunset and Presidio ceiling, far band on against off | At most 3 ms added | Mesh the raster in the worker, no re-bake |
| 2 km and lunar all-far frames | At most 8 ms added | Coarser levels at altitude, then the mesh fallback |
| Five minutes of flight | No thermal drop under 30 fps | Lower the far resolution |
| 60 s descent from the ceiling to the street over the Sunset | No region appears. No frame changes more than the cruise baseline. Producer's eye agrees | Tune the hand-over. If mesh against raster still shows, the design needs rework |
| Same page on ice and Moon | Runs with only data and Body changing | The "one stack" claim is false as built |

Thresholds are my proposal against a 33 ms frame. Note the on-off difference is the measure, because I could not confirm a GPU timer on iOS.

### Order after that

| Step | Delivers | Effort [E] |
|---|---|---|
| 1. Far band for real | Tile tree, streamer, boxes, sweep, tone rule, paint layer, for the level 6 cells around the Bay. Replaces far.bin, horizon.bin and the water plane. **Fixes the producer's defect, Berkeley included** | 4-5 ew |
| 2. Test set | The planet bake on one cell each of the audit's nine places, no hand tuning | 3-4 ew |
| 3. World frame | Body-fixed truth, rebase, Body record, fly out of SF | 3-4 ew |
| 4. Global bake and CDN | Whole planet, archives, releases, credits | 2-3 ew plus compute |
| 5. Moon and Antarctica | Source rows, ramps, sun models, targets, no-paint list | 1-2 ew |

That is about 13-18 engineer-weeks to a planet, excluding server, crossing content and night art.

---

## 15. What would kill it

1. **The far pass is too slow on an A15.** It gives up hidden-surface removal and runs an unusual shader. Fallback: mesh the raster.
2. **The mesh-to-raster seam shows.** Two renderers meet at 2-3 km, and this is unmeasured.
3. **The far band shimmers in motion.** It crawls half as much as real geometry in simulation, but 12-14 % of far pixels still move per 10 m, on a game with no temporal smoothing.
4. **Automatic beauty fails at scale.** Tested on three sites with hand-picked numbers. Tone seams, cloud leftovers, DSM lumps or bad heights could make whole regions ugly with no human watching.
5. **iOS limits.** 56 MB of arrays, uploads of a tile a frame, and shader compile are all unmeasured on Safari.
6. **The planet bake is more work than it looks.** Region-parallel baking is a rewrite, and SF alone takes about 30 minutes [S repo, via audit-limits].
7. **Near code resists the frame change.** City code assumes flat, absolute coordinates. Step 3 could cost more than estimated, and STAGES' 128 m cells move to S2.
8. **Height-field limits.** Overhangs, thin bridges and arches need the `spans` layer, which is untested.
9. **Licence surprise.** Most likely the CDSE reading or paint under ODbL. Each has a fallback, so this slows the plan and does not stop it.

---

## 16. Not confirmed

**Could not reach, because the web search budget had gone.**
- I recall Dick, Krüger and Westermann's 2009 work on GPU ray-casting terrain per bounding box as the closest precedent. I could not open it, so it is from memory and carries no weight here.
- Apple's current Metal page returned no body text. The HSR rule above comes from a retired OpenGL ES guide. Apple GPUs may differ today.
- Web3DSurvey's 2048 array layers on iOS comes through [research-priorart](https://web3dsurvey.com/webgl2/parameters/MAX_ARRAY_TEXTURE_LAYERS). I did not recheck it.

**Not measured.**
- Any time on a phone. I have no sourced A15 figure for dependent integer fetches.
- iOS Safari memory limits for texture arrays.
- Whether Safari caches range responses. Assume not, and keep a RAM cache.
- Whether iOS exposes GPU timers.
- Whether a miss on a whole archive fetches all of it. Cloudflare's page says only that the first origin request omits `Range`.
- `built` bytes outside SF. I assumed up to 3 times SF's ratio for dispersed fabric. Lagos and Gulu are untested.
- A true S2 lattice. All SF numbers use a flat one.
- Canopy bytes, and any surface raster run through this path. The previews use class and seeds in SF. Real Sentinel tone was not drawn.
- The hand-over from real meshes.
- Moving-sun cost.

**Weak inputs.** Effort figures are guesses. The land-cell count (38 %) is a guess. Surface and relief sizes carry research-earth's ±30 %, and some were measured on small samples.

**Independence.** Sibling folders `art/` and `lean/` appeared during this work. I did not open them.
