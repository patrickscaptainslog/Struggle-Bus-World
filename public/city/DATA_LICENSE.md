# Data license: the baked city tiles

The files under `public/city/<slug>/` (`city.json`, `r_*.bin`, `far.bin`, `horizon.bin`)
are a **derivative database** of OpenStreetMap and are made available under the
**Open Database License (ODbL) 1.0**: https://opendatacommons.org/licenses/odbl/1-0/

Any rights in individual contents of the database are licensed under the
Database Contents License: https://opendatacommons.org/licenses/dbcl/1-0/

**© OpenStreetMap contributors, Overture Maps Foundation.**
OpenStreetMap: https://www.openstreetmap.org/copyright

## Sources

| Data | Source | License |
|---|---|---|
| Building footprints, building parts, heights / levels, roof shapes, roof heights and directions, facade and roof colours and materials, building ids (the stable-id key) | OpenStreetMap, via Overture Maps (`buildings` theme, release 2026-10-21.0) | ODbL 1.0 |
| A few footprints OpenStreetMap lacks (San Francisco: ~1.8k) | Overture Maps (Microsoft ML Building Footprints, Esri Community Maps) | ODbL 1.0 / CC BY 4.0 (Overture's terms) |
| Streets, footways, sidewalks, rail, street names | OpenStreetMap, via Overture Maps (`transportation` theme) | ODbL 1.0 |
| Land use, land cover, parks, woods, sand, rock, water bodies, coastline, piers, trees | OpenStreetMap (land cover: ESA WorldCover), via Overture Maps (`base` theme) | ODbL 1.0 (ESA WorldCover: CC BY 4.0) |
| Neighbourhood names and areas | OpenStreetMap, via Overture Maps (`divisions` theme) | ODbL 1.0 |
| Fallback footprints where OSM has none, occupancy hints (San Francisco) | FEMA / ORNL USA Structures | public domain |
| Terrain (San Francisco) | USGS 3DEP 1 m DEM and 1/3 arc-second DEM | public domain |
| Rooftop heights, tower tiers, outlines (San Francisco) | USGS 3DEP lidar point cloud CA_SanFrancisco_1_B23 (2023) | public domain |

The derivative database is produced by `tools/bake/overture.py` (extracts),
`tools/bake/osm.py` + `tools/bake/bake.py` (conflation, massing, rasterization)
and `tools/bake/pack.py` (region bundles). The binary layouts are documented in
`src/world/tiles.ts`; `tools/bake/citydata.py` reads them back. Anyone may
rebuild, read and redistribute these tiles under the ODbL: keep this notice and
the attribution, share derived databases under the ODbL, and keep them open.

The game shows the attribution while its opening plays and lists it in the tuner.
