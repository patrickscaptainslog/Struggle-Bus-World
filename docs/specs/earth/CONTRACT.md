# CONTRACT: the world and life

The line between the two accounts' work on the living Earth (`LIVING.md`, "Who does what"). The world is the first account's, on `feat/world`. Life is the second account's, on `feat/life`. Both branch from `feat/earth`, and nothing on either is built before both have signed this.

**State.** 0.3, 2026-11-05. Drafted by the first account (0.1, 0.2), signed by the second with section 9 answered: twelve picks taken as drafted, O2 and O3 taken on by the second account, and four changes marked Proposed (O6, O9, O14, L1), which hold once the first account marks them Agreed (section 8).

**Marks.** Every rule is one of three. **Agreed**: already binding, because the producer approved it (`LIVING.md`, `CLAUDE.md`) or the code already works that way. **Proposed**: this draft's pick, which the second account takes or changes. **Open**: no pick yet (section 9). Facts are marked as `LIVING.md` marks them: MEASURED (read or run here on 2026-11-04, file and line given; lines move), SOURCE (a page or a doc, not rechecked today), ESTIMATE (arithmetic, with its assumption).

This says only what crosses between the two sides. How life works inside (its worker's messages, tick rate and buffers, its snapshot rows, its saved record) is the second account's, in life's own spec (`docs/specs/earth/LIFE.md`, the second account's to write), and changes there need no cycle here.

## 0. Who owns what

| | The world (first account) | Life (second account) |
|---|---|---|
| Data | The bake's graph output, `public/city/<slug>/g_*.bin` and `routes.bin`, `public/earth/lanes.bin` and `airports.bin`, the planet layer | Life's paint store; the planes' relay (`api/`), its keys in Vercel's environment |
| Code | `src/world/lifeData.ts`: the types, the parsers, `PlaceInit` and `makePlaceFrame` below, worker-safe (no three.js, no DOM). City's region events. `weatherAt` until weather has an owner | `src/life/*`: the movers, the worker, the pools and their materials, how movers meet paint. Life's lines in `src/main.ts` and `src/sky/moonrun.ts` (section 6) |
| Tests | Section 7, W1-W5, in `tools/world/` | Section 7, W6 and L1-L7, in `tools/life/` |
| Shared | Neither changes the other's files. `src/render/palette.ts` rows are claimed by name. `Aim.ts`, `Splat.ts` and `GroundPaint.ts` change only as section 3 and O5-O6 say, by life, reviewed by the world | |

Agreed: each reviews the other's every stage, and the first account runs the real-time checks on the laptop's GPU and the floor phone for both (`LIVING.md`).

## 1. What a tile gives life

### 1.1 The place, its frame and its units

Facts (MEASURED, `public/city/sf/city.json`, `src/world/tiles.ts`, `src/game/geo.ts`):
- A city is one flat map: a transverse Mercator about `manifest.origin` (city.json `proj`), +X grid east, +Y up, +Z grid south (z is minus the northing, `geo.ts` 1-3), in metres. Grid east isn't true east away from the central meridian: `WorldFrame.axesAt` (41-55) takes the grid convergence for it. San Francisco: origin 37.7749, -122.4194; tiles 256 m; terrain 65 x 65 heights at 4 m; the ground class raster 128 x 128 at 2 m; regions of 4 x 4 tiles (1,024 m), 195 of them; bounds x -8,704 to 5,632, z -9,984 to 7,680.
- Y is metres above sea level on the map's vertical datum: NAVD88 in San Francisco (`docs/ARCHITECTURE.md`, "World conventions"); an any-city bake from GLO-30 is on EGM2008. Open water stands at `WATER_Y = -0.6` on every map.
- Ground classes: PAVED 0, GRASS 1, WATER 2, SIDEWALK 3, PLAZA 4 (pedestrian areas, squares and piers), PATH 5, SAND 6, RAIL 7, FOREST 8, YARD 9, ROCK 10, in the low 4 bits (the top bits are a lamp's pool under the held hour).
- The frame's maths exists: `geo.ts` (`latLonToLocal`, `localToLatLon`) and `src/sky/WorldFrame.ts` (`geodeticToFix`, `fixToGeodetic` in km, `axesAt`). `EarthLanding.ts` (~76-79, `fixOf`) turns a map's Y straight into height over the ellipsoid, with no geoid.

**The geoid** (Proposed). h (over the WGS84 ellipsoid) = H (over sea level) + N (the geoid's height over the ellipsoid). So y = hEll - N. In San Francisco N is about -32 m (ESTIMATE, EGM96 from memory, to compute), so with N taken as 0, as today, an ADS-B plane on SFO's runway (H about 4 m, hEll about -28 m) is drawn 32 m under it, in the Bay. O9's grid is a gate before any plane is drawn under about 1 km, and stage 1 has live planes.

**Units** (Proposed, both sides):

| Quantity | Unit and sense |
|---|---|
| A place on a map | m; +X grid east, +Y up over the map's `vdatum`, +Z grid south; Float32 within a map |
| A place in the flight's loop | Earth-fixed m, WorldFrame's axes (its km x 1000): a Float64 origin and Float32 offsets from it |
| Which of the two | Which loop has the bus, not a height: the street's (to 15 km going up, from 14 km coming down, `EarthLanding`) gives map metres; the flight's gives Earth-fixed, the low flight off every map included (E4, `place(null)`) |
| Heading | On a map, rad from +X toward +Z (as the wind's `toward`), grid, not true: a true bearing turns through `axes`. In Earth-fixed, a unit vector |
| Speed, climb | m/s; climb positive up. The graph's `speed` alone is km/h, as mapped |
| Time | UTC ms everywhere, `utcMs` and `until` alike |
| Heights from sources | `elevM` is metres over sea level (OurAirports gives feet x 0.3048). ADS-B: `alt_geom`, feet over the ellipsoid, x 0.3048 is hEll. Without it, `alt_baro` (pressure altitude, hundreds of metres off without the local QNH) is taken as H, and a plane under 1 km near an airport rides that runway's glide path instead |

**The frame** (Proposed). Life never does this maths itself. It gets plain data, which crosses to its worker, and builds the functions there:

```ts
// src/world/lifeData.ts (the world's). Plain data: it posts to a worker as it is.
export interface PlaceInit {
  slug: string;                 // 'sf'
  origin: [number, number];     // degrees, manifest.origin
  proj: string;                 // city.json "proj"
  vdatum: 'NAVD88' | 'EGM2008' | 'EGM96';
  tz: string | null;            // IANA zone, city.json "tz" (feat/clock); null until that's merged
  dataV: string;                // the data version on every URL (index.html's __sbDataV)
  geoid: number;                // N at the origin, m (0 until O9)
}
// Worker-safe, pure, Float64 in and out, no allocation per call.
export interface PlaceFrame extends Readonly<PlaceInit> {
  toLocal(lat: number, lon: number, hEll: number, o: Float64Array): void; // -> x, y, z (m), y over sea level
  toGeo(x: number, y: number, z: number, o: Float64Array): void;          // -> lat, lon (deg), hEll (m)
  toFix(x: number, y: number, z: number, o: Float64Array): void;          // -> Earth-fixed, m
  axes(x: number, z: number, o: Float64Array): void;                      // 9 numbers: the map's axes there in Earth-fixed, by rows, convergence in
}
export function makePlaceFrame(init: PlaceInit): PlaceFrame;
```

These are the functions the flight's join uses, the geoid added, so life and the flight agree to the centimetre.

### 1.2 The graphs

Facts:
- The baked tiles carry no road class and no direction. `SBT2` holds named centrelines only, ranked 0 street or 1 path or plaza (`tiles.ts`, ~250), and the bake drops bridges, tunnels, indoor and covered ways and anything off level 0 (`tools/bake/osm.py`, `segments()`, ~353-368). So the graphs are new bake output (MEASURED).
- San Francisco's cached Overture extract (2026-10-21.0, in the bake's cache, not in git) has 57,111 segments, 20 of them `subtype` water: the Bay's ferry routes by name, "Vallejo - San Francisco Ferry Building" among them, whole past the extract's box (that one runs to 38.10 N; the box stops at 37.868). Its 13 columns (id, subtype, class, subclass, geometry, name, osm_id, datasets, width, level_max, road_flags, rail_flags, surface) have no `access_restrictions`, `speed_limits` or `connectors`, so direction, speed and junctions need a new extract: a download, the producer's OK first (MEASURED; O12, section 9's downloads).
- Only San Francisco's two hand-made bridges have a `deck` in city.json `landmarks`, one [x, z, y] polyline each (MEASURED). The Bay Bridge is double-decked and runs through the Yerba Buena Island tunnel.

Files (Proposed). Separate files, not new sections in `r_*.bin`, so the page with no flag fetches nothing new (`src/sky/flag.ts`: "flag off is the law") and life streams on its own radius without touching City's:

| File | Holds | Coordinates |
|---|---|---|
| `public/city/<slug>/g_<rx>_<rz>.bin`, magic `SBG1`, one per region, the grid of `r_<rx>_<rz>.bin` | Roads, footways, plazas, parks, beaches, marinas' berths, terminals' and aprons' outlines, taxiways and runways inside the region | Decimetres (i16) from the region's origin; heights i16 decimetres over the region's f32 base, because an absolute i16 stops at 3,276.7 m and La Paz is 3,640 m (`VERDICT.md` names the clip) |
| `public/city/<slug>/routes.bin`, `SBR1`, one per city | Ferry routes whole, ferry and cruise terminals, marinas, airports with runways: what's longer than a region, or needed whole | Int32 at 1e-7 degree (OSM's own step, about 1 cm); the parser also gives map metres |
| `public/earth/lanes.bin`, `SBL1`, the planet (on R2 from stage 2) | Ports and the ocean lanes between them, from the World Bank's density raster (`LIVING.md`; a download, section 9) | Int32 at 1e-7 degree |
| `public/earth/airports.bin`, `SBA1` | Every airport with scheduled flights, for planes off the maps and the scripted fallback (O11) | Int32 at 1e-7 degree |

All little-endian and gzipped like the tiles (`src/world/gunzip.ts` inflates them in a worker). The byte layout is the world's, written beside the parser as `tiles.ts` does for the tiles. What life codes against is the parsed shape. Every offset array is n + 1 starts, counted in the unit its comment names:

```ts
export const GRAPH_VERSION = 1;
export const enum Kind { ROAD = 1, FOOT, RAIL, FERRY, WATER, TAXI, RUNWAY }
export const enum RoadClass { MOTORWAY = 1, TRUNK, PRIMARY, SECONDARY, TERTIARY, RESIDENTIAL, UNCLASSIFIED, LIVING, SERVICE, TRACK, UNKNOWN }
export const enum FootClass { FOOTWAY = 1, SIDEWALK, CROSSING, PATH, STEPS, CYCLEWAY, PEDESTRIAN }
export const enum Dir { BOTH = 0, FORWARD = 1, BACKWARD = 2 }   // FORWARD: from a to b only
export const EdgeFlag = { BRIDGE: 1, TUNNEL: 2, UNDRAWN: 4, LINK: 8, ROUNDABOUT: 16, SEASONAL: 32 } as const;
export const NodeFlag = { PORTAL: 1, SIGNAL: 2, STOP: 4 } as const;   // PORTAL: the same id is in the next region
export const enum AreaKind { PLAZA = 1, PARK, BEACH, MARINA, FERRY_TERMINAL, CRUISE_TERMINAL, APRON, OPEN_WATER }
export const enum ShipKind { CONTAINER = 0, BULK, TANKER, CAR_CARRIER, CRUISE }   // 5 kinds, traffic's and ports' order

export interface RegionGraph {
  version: number; rx: number; rz: number;
  /** map metres; y is what a mover stands on there: the ground, a deck or a quay (never the drawn mesh) */
  nodes: { n: number; id: Uint32Array; xyz: Float32Array; flags: Uint8Array };
  edges: { n: number; id: Uint32Array; a: Uint32Array; b: Uint32Array; kind: Uint8Array; cls: Uint8Array; dir: Uint8Array;
           lanes: Uint8Array /* lanes in each direction it can be driven: on a one-way, all of them; 0 unknown */;
           speed: Uint8Array /* km/h, 0 unknown */; level: Int8Array /* OSM `layer`, else Overture's level_rules, 0 where neither says: it tells the decks apart */;
           flags: Uint16Array; shape: Uint32Array /* starts into pts, in points (3 floats each) */ };
  pts: Float32Array;                  // x, y, z of the edges' inner points
  areas: { n: number; id: Uint32Array; kind: Uint8Array; name: Uint16Array /* into names, 0xffff none */;
           tri: Uint32Array /* starts into xyz, in triangles (9 floats each) */; xyz: Float32Array /* with heights */ };
  names: string[];
}
export interface CityRoutes {
  version: number;
  /** seasonal: OSM's `seasonal=*` on the route (or its `opening_hours`), never from the name */
  ferries: Array<{ id: number; key: string /* 'w31772645' */; name: string; from: number; to: number /* terminal ids */; seasonal: boolean; lengthM: number; lat: Float64Array; lon: Float64Array }>;
  terminals: Array<{ id: number; key: string; kind: 'ferry' | 'cruise'; name: string; lat: number; lon: number; berthM: number }>;
  marinas: Array<{ id: number; key: string; name: string; lat: number; lon: number; berths: number /* mapped, else estimated from the area */ }>;
  airports: Array<{ id: number; icao: string; iata: string; lat: number; lon: number; elevM: number /* over sea level */;
                    runways: Array<{ name: string /* '28L' */; lat: [number, number]; lon: [number, number]; widthM: number }> }>;
}
export interface OceanLanes {
  version: number;
  ports: Array<{ id: number; key: string /* UN/LOCODE 'USOAK' */; name: string; lat: number; lon: number; kinds: number /* bits by ShipKind */ }>;
  /** vertices at most 50 km apart, great circles between them; traffic[kind * 2 + d]: ships a day by ShipKind, d 0 from a to b, 1 back, from the raster */
  lanes: Array<{ id: number; key: string; a: number; b: number /* port ids */; lat: Float64Array; lon: Float64Array; traffic: Float32Array /* 10 */ }>;
}
```

What the world guarantees, and checks (W1, W4):
- Every edge's two nodes exist. A node where an edge leaves its region is a PORTAL, with the same id in the next region's file, so life can stitch regions (its key: 1.3).
- Direction is as mapped (Overture's access restrictions, OSM's `oneway`), and BOTH where nothing says.
- TUNNEL: drive it hidden, between portals that are drawn. UNDRAWN: a surface should be drawn there and isn't yet: 68 % of San Francisco's motorway surface (`docs/specs/bridges/audit-new-city.md`, item 3). An UNDRAWN edge stays in the graph, so routes go through it and nothing dead-ends at a gap, but life draws nothing on it until the world draws it and clears the flag (the freeway surfaces are the approved exception to the streets hold). A tunnel is never UNDRAWN for being a tunnel.
- A land node's y is within 0.5 m of the tile's own terrain grid there (`tiles.ts`, bilinear over the 65 x 65 heights), a water node's is `WATER_Y`, both computed in Node from the baked files. On a bridge or a viaduct, y is the deck's top from the graph's own data, in every city: OSM `bridge`, `layer` and the bake's deck profile, with `level` telling decks apart, so the Bay Bridge's eastbound lower deck sits under the westbound top. San Francisco's landmark `deck` polylines are only a check that the two agree.
- Every FERRY and WATER edge and every lane stays on water, except its last 150 m into a terminal, berth or port area, which ends on that area (piers are PLAZA). On a map: WATER in the class raster at 2 m. Past a map: against a real coastline (OSM's land polygons, a download, section 9), never `earth.bin`, whose 20 km texels make the Golden Gate (1.6 km) land. The water's surface is `WATER_Y` on every map today; when lakes get their own level (`VERDICT.md` step 4), each water area and edge carries it.
- Ports, terminals and airports are real places and may be named. Nothing names a person or a vessel (Agreed, `LIVING.md` rule 7).

### 1.3 Ids and versions

Proposed:
- An id is a u32 from FNV-1a of a source key, as the buildings' stable ids are (`tools/bake/bake.py`, `ID_RANGES`, `IdAlloc`, ~978-1006), each kind in its own range. A collision probes to the next free id in the range, in key order, so an id depends on every other key in that bake: a new way can take an old id without its own source changing. An id is unique within one city's bake only (every city's `IdAlloc` uses the same ranges), and is for indexing that bake's files. Nothing saved or shared keys on it: paint keys on the source keys (section 3), which every file carries as `key`.
- Source keys: the OSM way and its piece (`w31772645#2`, never the `@version`), else Overture's GERS id. A PORTAL node, which has no source of its own: its way's key and the region edge it sits on, in integer decimetres of the map (`w31772645@x-7168.0`, with the whole decimetres written). A port its UN/LOCODE, else the OSM or GERS id of its harbour area: never a position. An airport its ICAO code; a runway `KSFO:28L`; a lane its two ports' keys sorted, and a variant.
- Ids hold across bakes while their source holds. W2 checks every kept id is the same source key, lists every ferry route, lane, terminal and airport dropped, and every one whose slot inputs moved (a route's `lengthM` or a lane's `traffic` by more than 1 %): a re-bake that drops or moves one ends that mover's paint, and W2 says how many.
- Every file starts with its magic and a u16 version. city.json gains `"life": { "graph": 1, "routes": 1 }`. Files under `/city/` take `?v=` as every city URL does (`dataQuery`, `City.ts` ~156); `/earth/` gets a version of its own beside `__sbDataV` in `index.html`. Life handed a version it doesn't know runs without that part, and the page goes on.

### 1.4 In and out, from the street to orbit

| Where the bus is | The ground under it | What life gets | How life learns |
|---|---|---|---|
| Over a map, the street has the bus (to 15 km going up, from 14 km coming down: `EarthLanding`) | City's tiles, regions out to 1,500-1,900 m (`City.ts` ~399, `config.city.loadRadiusHigh`), the far field past them. From 11 km to 15 km the street's ground goes into the plain Earth (`earthJoin.ts`, `SKY_TOP` to `H_UP`) | Region graphs in its own radius, the city's routes whole, the lanes | Life fetches `g_*.bin` itself by region index (city.json `regions`). `world.onRegion` (section 6) says what City draws in each region: 0 nothing, 1 the far field (its 16 m raster), 2 coarse (8 m ground mesh), 3 detail (4 m; `City.ts` ~91). Life can hide or settle movers over a coarse region |
| Over a map, the flight has the bus (from 15 km) | The plain Earth, `spaceEarth`; `EARTHFLIGHT.md`'s far field over a city from 60 km down isn't built | Routes, lanes, airports | No region events: no map is drawn |
| Off every map, any height | `public/sky/earth.bin` today: 2048 x 1024, about 20 km a texel, a class byte, a tone in 16 levels and the night's lights, and no heights (`SkyDraw.ts` ~99-113, MEASURED). The planet layer once built: relief, surface and built on a cube-sphere tree, parent first (`VERDICT.md` step 5), the Bay Area first in stage 1 | Lanes, airports, `planet` queries | `planet.onTile` events, once the planet layer exists |
| The Moon's pages | | Nothing | Life isn't booted there |

```ts
export interface PlanetForLife {           // main thread, per query
  heightAt(lat: number, lon: number): number | null;  // m over sea level; null: not known (earth.bin has no heights)
  waterAt(lat: number, lon: number): boolean | null;  // what the drawn Earth shows there, not the coastline
  levelAt(lat: number, lon: number): number;           // the finest level resident there, 0: earth.bin only
  onTile(cb: (key: string, level: number, inOut: boolean) => void): () => void;
}
```

Life's worker needs no ground queries: every graph point carries its height, lanes are water by construction, and planes bring their own heights. **Near the shore over the plain Earth** (Proposed): where the drawn Earth isn't the street's ground (over 11 km on a map, the flight's loop anywhere) and `waterAt` says land, life draws no mover there, painted or grey, until a finer level is resident; its paint is kept. That's life's, through `waterAt`.

**From what height life shows.** Proposed: at every height on Earth's pages; life picks what draws by pixel size (`LIVING.md` rule 4). For scale (ESTIMATE: the portrait lens is 24 degrees over 393 game pixels, 1.07 mrad a pixel; the vista 38 degrees, 1.69, `config.ts` `hfovPortrait`, `hfovVista`): a person (1.7 m) is 2 px at about 800 m, a car (4.5 m) at 2.1 km, a sailboat (10 m) at 4.7 km, an airliner (70 m) at 20 km on the vista lens, a container ship (300 m) at 90 km. Past that a painted mover in the large pool keeps a floor of 1 px all the way to orbit, as the Moon keeps its floor, so the painted ships are specks of colour on a grey Pacific (`LIVING.md`, "The moments"). Grey ones go when they're under a pixel.

## 2. What life gives the renderer

Agreed (`LIVING.md`, `CLAUDE.md`): instanced pools, small (people), middle (cars, boats) and large (ships, planes), as `StreetSign` is one `InstancedMesh` (`src/fx/StreetSign.ts` ~303, ~343). Paint is the only saturated thing. Nothing compiles in flight. The floor is an A15 at 30 fps. How many draws is `LIVING.md`'s ESTIMATE, 3 (`LIVING.md` 58, "Targets ... ESTIMATE"), not a ruling; O1 is this draft's change to it.

**Budget** (Proposed). `LIVING.md`'s ESTIMATE was 3 draws, 80 K triangles, 1.5 ms a frame and 4 MB. Specks under 2 px are another primitive and contrails another material, so this draft asks for more draws (O1). The view it's held to: downtown at street level at rush hour, ferries out, a plane overhead.

| | Street's loop | Flight's loop |
|---|---|---|
| Scene-pass draws | 3, one a pool's models; 1 for all the specks; 1 for all the contrails (Proposed, O6: all the marks, contrails, wakes and tracks) | 1 for the specks, 1 for the contrails |
| Sun-pass draws | At most 3 (casters, as `StreetSign`'s shadow box) | None |
| Triangles | 80 K scene, 20 K sun | 10 K |
| Pools, at their largest (made so at boot) | people 4,096, middle 2,048, large 512, specks 16,384, contrail vertices 8,192 (ESTIMATE) | the same objects |
| Main thread, a frame | 1.5 ms in all: `life.aim`, carrying every mover on between snapshots, unpack, matrices, one upload a pool (`addUpdateRange` of the live range, `count` set) | 0.5 ms |
| Marks | Proposed (the second account, 0.3, O6): life's own marks draw, inside the 1.5 ms, where this was `GroundPaint` trail uploads at most 0.3 ms a frame; the shimmer texture (O7) one R8 256 x 256, 64 KB, written at most once a second | None |
| Worker | 6 ms a tick, off the main thread; its heap under 64 MB | the same worker |
| Memory | GPU 4 MB in all; snapshot buffers 1 MB each at most | |
| Files, gzipped | a `g_*.bin` 128 KB, a `routes.bin` 256 KB, `lanes.bin` 4 MB, `airports.bin` 1 MB (the iPhone 13 has 4 GB) | |

The street measured 161 draws and 1.17 M triangles at Alamo Square from the ceiling on the laptop (`VERDICT.md` §3), which isn't the view above, and comes before the far field's fixes and the planet layer add theirs. So the first account measures downtown at street level on `feat/earth` before stage 1, and again after the world's stage 1, and life's extra draws are checked against 120-200 on those. All targets until stage 1 measures them on the A15.

**The G-buffer** (Agreed, `ARCHITECTURE.md`, "Rendering contract"; `src/render/materials.ts`):
- Every material ends in `sbWrite(ramp, light, fog, glow, viewNormal, surfaceId, flags)`: GLSL3, `GLSL_COMMON` and `GLSL_OUT`, `globals` spread in, fog through `sbFog`, never an RGB colour.
- Ramps: grey life uses the grey world's rows (GREY, GREY_LIGHT, GREEN_GREY, WINDOW, ROOF_DARK, WHITE, INK, WATER; at night LIT and LAMP). Paint uses `HUE_RAMPS` (rows 8-13) and nothing else saturated. BUS_YELLOW and BUS_BLACK are the bus's alone. A new row is claimed by name in `palette.ts`: 47 and 50-63 are free (`palette.ts` ~115, MEASURED).
- `flags`: 1.0 for a model (it gets outlines), 0.5 for specks, wakes and contrails, never 0 (what nothing wrote is sky).
- `surfaceId` a hash per mover, so two touching cars keep a seam. Glow only for lights at night, paint's own effects and the aim's glint on a mover (section 3). The hero's beam and drop shadow are the resolve's, and life's draws obey the sky cut (`pipeline.cutSky`) as every material does.

**The warm-up** (Agreed rule, Proposed how). `registerWarm('life', ...)` (`warmup.ts` ~44) returns one object of each kind exactly as drawn: the same material functions and defines, `InstancedMesh` with the same attributes and layers, the specks' draw, the casters on `SHADOW_LAYER`. It's registered before boot's `warm.addSources()` (`main.ts` ~1023), so life's chunk is imported by then, under the flag. Under `?moon` and `?moonland` the warm-up runs only `city` and `roof sprouts` (`warmup.ts` ~277, `moonLow`), which is right: no life there. Life's draws in the flight's loop warm with the flight's own programs (`moonrun.ts`).

**No allocation per frame** (Agreed, the repo's rule). Life's `frame()` makes no object, array or closure. A message handler running at 10 Hz may get its event object, and nothing else: whatever a message carries often (counts, an origin, new keys) rides in the transferred buffer, never as a fresh array.

**The worker** (Proposed, what crosses; the rest is life's spec):
- A module worker, `new Worker(new URL('./lifeWorker.ts', import.meta.url), { type: 'module' })`, as `City.ts` (~563) and `Lamps.ts` (~101) make theirs, built `worker.format: 'es'` at `target: 'safari15'` (`vite.config.ts`), and parsed by `tools/iosfloor.mjs`.
- No `SharedArrayBuffer`, no `Atomics`. The page isn't cross-origin isolated: `vercel.json` sends no COOP or COEP header, only `Cache-Control` (MEASURED), and WebKit gives shared memory only to isolated pages, from Safari 15.2 (SOURCE). Turning isolation on would make every cross-origin fetch, the tiles on R2 included, send CORP or CORS headers: not worth it for this. Only `postMessage` with transfer lists.
- Not in Safari 15.0: `OffscreenCanvas`, `structuredClone` (`tools/iosfloor.mjs`, its GLOBALS). `fetch` and `Intl` with time zones are there.
- The worker fetches and parses `g_*.bin`, `routes.bin`, `lanes.bin` and `airports.bin` itself, with the world's parsers, and builds its frame with `makePlaceFrame(init)`: a `PlaceFrame` has methods and can't be posted.

## 3. How a mover takes paint

**Its key** (Proposed). Built from source keys (1.3) and the clock, never from the probed u32, so it holds across bakes and across maps, and is the same for every player on the same data:

| Kind | Key | Slot, day |
|---|---|---|
| Ferry | `ferry:<route key>:<vessel>:<service day>` | vessel: which of the route's boats, 0 to n-1, n from the route's length and the hour; service day: the local date at the route's first terminal, `YYYYMMDD` |
| Cargo ship | `ship:<from>-<to>:<slot>:<departure day>` | from and to: the voyage's origin and destination UN/LOCODEs (not a lane, so the key holds as it moves lane to lane); slot: the departure's index that day on that pair; departure day: UTC days since 1970 |
| Cruise ship | `cruise:<terminal key>:<call>:<arrival day>` | call: the call's index that day; arrival day: UTC days |
| Live plane | `plane:<FNV-1a of ICAO address + ':' + flight date>` | flight date: the UTC date it was first seen airborne, `YYYYMMDD`; the address itself is never stored |
| Scripted plane | `plane:s:<from ICAO>-<to ICAO>:<departure minute>` | UTC minutes since 1970 |
| Sailboat | `sail:<marina key>:<boat>:<day>` | boat: its berth slot; day: the local date |
| Car, person | `car:`, `walk:` | not saved (`LIVING.md`: "a simulated car or person only while it's near") |

Never a name, an MMSI or a registration (Agreed, rule 7). Like the landmarks' `lm:` (`PaintState.ts`, `LANDMARK_KEY_PREFIX`), it can't collide with a building's number.

**How the aim finds it** (Proposed; Agreed: a hit lands about 0.4 s after the tap, rule 3). Today the aim, its latch and `Shot.target` are all `BuildingRef` (`Aim.ts` ~29-43, ~250, ~302), and a blast with no building in reach over water is a miss: no flash, no hit-stop, a geyser and a belly refund (`Splat.ts` ~245-252, `main.ts` ~823). So, by life, in `Aim.ts` and `Splat.ts` (O5):

```ts
export interface MoverTarget {
  readonly mover: true;
  key: string;                              // section 3's key
  x: number; y: number; z: number;          // the impact point, map metres, where its path puts it at arrival
  arrive: number;                           // the game time (simTime, s) the breath lands
  pickR: number;                            // the radius it was picked at (m)
}
// Shot.target becomes BuildingRef | MoverTarget | null; fire() sets shot.y for a mover, so main.ts reads no roof for it.
// Splatter.barf takes opts.mover: no water miss, no refund, the flash and hit-stop of a hit.
```

- `Aimer.update` asks `life.aim(...)` every frame with the aim's ray (`config.splat.aimDown`), the bus's forward, the pick radius for its height (`Splat.ts` ~187, `pickRadius(drop)`) and the breath's flight time. Life answers with the mover nearest that line at the moment the breath arrives, or null. Past the aim's ray it may look along the bus's forward, so a plane flown alongside can be painted. A mover nearer the line of fire than the building target wins, and the press and latch (`Aim.ts` ~278) hold it as they hold a building.
- The glint: building glint lives in the city's material, so a mover's is a channel in life's pools: life lights the target's instance by its key.
- `life.hit(key, color, utcMs, arrive)` is called at fire time and takes effect at `arrive`, the impact's game time. Life decides the level (fresh: 1; painted: its own level + 1, at most 3) and returns `true` if a fresh mover took `color`, so `Splatter` advances `nextHue` (`Splat.ts` ~255) as it does for a fresh building.
- Area hits: `life.blast(x, y, z, r, hue, superTag, arrive)` for mega, super and hose blasts (`SuperSplat`, `opts.radius`, `opts.hose`, `main.ts` ~913-925): every mover in the radius at arrival takes paint as a building in it would. A mega over a regatta is the obvious move.
- **Hue and level** (Agreed, as buildings, `PaintState.ts`): faction 1 (Rainbow); colour 0-5, the index into `HUE_RAMPS`; level 1 bloom, 2 gardens, 3 Hundertwasser. A fresh mover takes the blast's hue, and a painted one keeps its colour and goes up a level (`Splat.ts` ~227-255). Paint by parts (a ship's stacks) is life's inside.

**What's saved** (Agreed, rule 8: paint travels with the thing for its journey). `until`, UTC ms, read against the real clock: a plane's landing, at most 24 h on; a cargo or cruise ship's arrival at its next port, from its voyage; a ferry's end of its service day, since it's keyed by its vessel and the next crossing repaints the lane (Agreed, `LIVING.md` 23, 42, 60); a sailboat's return to its marina. The record's shape and its storage key are life's.

**Limits** (Proposed; these cross, because the quota is shared):
- One store for every place, 2,000 records and 256 KB at most; past that, the soonest `until` goes first.
- Beside each key the store keeps the namespace that placed it: a city slug, or `earth` for lanes and planes. A key is dropped early only when its namespace's file is loaded on the current data version and lacks its source; loading San Francisco never drops Sydney's ferries. Every other key stays until its `until`.
- `until` is measured by `Date.now()`, never by a pinned or scaled `SkyClock`. Under `?t=`, `?rate=` or `?fixeddt` life uses a separate store, `strugglebus.life.test.v1`, so a test or a curious player never expires or purges the real one.
- WebKit's `localStorage` is about 5 MB an origin, shared with `PaintState` and `GroundPaint` (SOURCE), and `PaintState.persist` swallows a failed `setItem` (~263-269). When life's write fails, it keeps its paint for the session, evicts by the cap and tries once more, and never throws.
  Saves wait as `PaintState`'s do and flush on `pagehide` and `visibilitychange` (`PaintState.ts` ~175). Safari clears a site's script storage after 7 days of browsing without a visit, except for a Home Screen app (SOURCE, WebKit's 2020 tracking-prevention post): a ship 11 days out to Busan outlives an absent player's store, and so does their building paint.

## 4. The weather

Agreed: an input to life from the start, held at clear until weather comes, way later (`LIVING.md`, "Weather, way later"; on hold, `CLAUDE.md`).

```ts
export interface Weather {
  rain: number;   // 0..1
  snow: number;   // 0..1
  fog: number;    // 0..1, at the water
  cloud: number;  // 0..1
  /** null: no data, and life uses its own fair-weather breeze, so a clear day still sails */
  wind: { speed: number /* m/s */; toward: number /* rad on the map, grid: 0 toward +X, pi/2 toward +Z */ } | null;
}
export const CLEAR: Weather = { rain: 0, snow: 0, fog: 0, cloud: 0, wind: null };
export function weatherAt(lat: number, lon: number, utcMs: number): Weather; // CLEAR, until weather has an owner
```

Proposed: `weatherAt` sits in `lifeData.ts`, the world's, and returns `CLEAR`. A wind source in true bearings turns into grid through `PlaceFrame.axes`. Who builds the weather is decided when the producer lifts the hold. Life gives the same movers for `CLEAR` as for no weather at all (L7).

## 5. The clock and determinism

Agreed: life runs on the real local time, seeded by place and time, so every player sees the same ship in the same place.

Facts (MEASURED):
- `SkyClock` (`src/sky/SkyClock.ts` 11-19 on `feat/earth`): `?t=` sets the start (an ISO date or ms) and the clock runs on from it; `?rate=` runs it at a multiple; only `&rate=0` holds it. It runs on `performance.now()` from boot, which stops while an iPhone sleeps. On `feat/clock` (01469b0) the real clock reads `Date.now()` every frame when nothing pins it.
- On `feat/earth` the street's page makes no clock; the flight makes its own (`moonrun.ts` ~273), and its trip then runs on its own stepped time (`MoonTrip.ts` ~331, `ms0 + t * 1000`). On `feat/clock` the street makes one in `LiveSky`. Under `?t=` the clock follows the wall, not the game. On the cloud machine the game runs about 14 times slower than real time, so a frame-stepped test would see life move 14 times too far a frame.

Proposed:
- One clock per page, made once and handed to the street, the flight and life (O3): not Agreed until O3 is.
- Life never reads `Date.now`, `performance.now` or `Math.random` for what it simulates. The host passes `utcMs` in every call. The store's expiry alone reads `Date.now` (section 3).
- Under `?fixeddt` the clock steps with the frames: `start + frames * fixeddt * rate * 1000` (O2).
- Grey movers, ferries, ships and scripted planes are a function of the data version, the place's source keys, `utcMs` and the weather: the same within 1 cm across JavaScript engines for the same inputs, and byte for byte on one engine. Painted movers' behaviour (people that follow the bus, a regatta a painted bay starts, `LIVING.md` 26, 28) and live planes (the relay's cache window) are excluded: they're local to a player.
- Every choice comes from integer hashes (FNV-1a or a 32-bit mix) of source keys and a time bucket; floats only place things. `Math.sin` and the rest may differ in the last bit between JavaScriptCore and V8 (SOURCE: ECMA-262 leaves them "implementation-approximated"), so no branch hangs on one.
- The local hour comes from the place's IANA zone (city.json `tz` on `feat/clock`: "America/Los_Angeles" for San Francisco, MEASURED), through `Intl` in the worker, as a pure function of `utcMs`, cached by UTC minute, so a bucket or DST edge turns at the same `utcMs` for every player. Off a map, O8.
- "The same ship in the same place" holds within the players' clock skew: an 18-knot ship makes 9 m/s, so 30 s of skew is 280 m (ESTIMATE), until the sky's server offset comes (S2, `SkyClock.ts`'s comment).
- `dt` is 0 in a hit-stop (the game clock stands). Life may hold its movers for those frames and catch up after.

## 6. The hook

`LIVING.md` ("Hot spots") said `src/main.ts` gets one hook for life. Against the code it's several lines, listed here, all of them; the mover's branch of the breath lives in `Aim.ts` and `Splat.ts` (section 3), so `main.ts`'s breath path needs only the QA line. O15 asks whether "one hook" means this list. The world's changes stay in `City`, the tiles and the flight's ground. Whoever touches `main.ts` says so in `docs/TODO.md` first.

Proposed, `src/main.ts`:

```ts
// 1. the page's clock (O3): there's none in the street's boot today
const clock = new SkyClock(params);
// 2. boot(), once the City exists and before warm.addSources() (~1023), behind ?life. Never rejects into boot():
const life = lifeOn ? await import('./life/boot').then((m) => m.bootLife({ params, clock, world: worldForLife(city, manifest), scene, camera, pipeline, aimer, splatter })).catch(() => null) : null;
// 3. frame(now) (~1146), beside signs.update(dt, camera) (~1460):
life?.frame(dt, simTime, clock.now(), flight, camera);
// 4. tuner.onResetPaint (~856-861), beside moon?.paint.reset():
life?.resetPaint();
// 5. the QA object: life on it, for L5. 6. breatheNow (~888): lastShot's target written for a mover too (its key)
```

And `src/sky/moonrun.ts` (the second account's file): `life.frameSky` from the flight's loop (O4); `'life'` in `SWAP_KEEP` (~187), or the page swap drops `?life` and life never boots on the way home; and the clock on the next page resumes from the trip's saved ms (`trip.save()`), not from the URL's `?t=`, which `SWAP_KEEP` also carries.

```ts
import type { Observer } from '../sky/SkyModel';   // SkyModel.ts ~36
export interface Life {
  /** once a rendered frame, by the loop that has the bus: the street's */
  frame(dt: number, simTime: number, utcMs: number, bus: Flight, camera: THREE.Camera): void;
  /** the same, from the flight's loop while it has the bus (moonrun.ts; O4) */
  frameSky(dt: number, utcMs: number, ob: Observer): void;
  aim(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pickR: number, travel: number): MoverTarget | null;
  hit(key: string, color: number, utcMs: number, arrive: number): boolean;   // true: a fresh mover took the hue
  blast(x: number, y: number, z: number, r: number, hue: number, superTag: SuperTag | undefined, arrive: number): void;
  resetPaint(): void;
  /** the map under the bus changed: home landing somewhere else, E4's city edges */
  place(p: PlaceInit | null): void;
  /** only if an Earth map ever slides under the bus, as the Moon's does (main.ts slideMap) */
  slide(dx: number, dz: number): void;
}
export interface WorldForLife {     // the world's, main thread, per query, never per mover per frame
  readonly place: PlaceInit | null;
  url(file: 'routes' | 'lanes' | 'airports' | { rx: number; rz: number }): string | null;
  groundAt(x: number, z: number): number;              // City.ts ~1892: what's loaded, not a check (W1 isn't against it)
  groundClassAt(x: number, z: number): number | null;  // ~1911, the classes in 1.1
  surfaceAt(x: number, z: number): number;             // ~2132: roofs, trees, landmarks
  readonly waterY: number;                             // WATER_Y
  onRegion(cb: (rx: number, rz: number, drawn: 0 | 1 | 2 | 3) => void): () => void;
  readonly planet: PlanetForLife;
}
```

- **Boot.** On every Earth page, in either order: `?earth` boots the street first and the flight behind it; `?earth&resume` the flight first and the street behind (`EARTHFLIGHT.md`, E3). Life comes up with the street's boot and draws nothing until its first snapshot. A failed chunk fetch or a throw in `bootLife` gives `null`, and the street boots as it would with no flag.
- **Pause.** Life listens to `visibilitychange` and `pagehide` itself, as `PaintState` does: the worker stops ticking while the page is hidden, and the store flushes. No line in `main.ts`. **To the Moon and back.** The page changes in the long dark (`moonrun.ts` ~465). Life saves on `pagehide`; the Moon's pages have no life. Coming home boots it again with the trip's clock, so every ship is where the time says, `?t=` or not.
- **Home where the player aims.** The second account's (`docs/TODO.md`). Over the page's city the street takes the bus and life has its map; anywhere else `place(null)` and the planet. Another city's map on the page is E4's and any-city's, the world's, and reaches life as `place(init)`.
- **No flag, no change.** With no `?life` the page fetches nothing new and compiles nothing new (W6).

## 7. The tests at each edge

Each runs in Node or frame-stepped in a browser at 1x (`?fixeddt`, `__qa.holdFrames`), so it runs on the cloud machine too (`CLAUDE.md`, "On a cloud machine"), except where it says laptop. Each prints what it measured and exits 1 on a failure.

The world's (first account):
- **W1** `tools/world/graph-check.mjs <city>` (Node): every graph and routes file parses with the shipped parser; the invariants of 1.2, each counted, heights against the tiles' own terrain grids and `WATER_Y`, from the baked files; UNDRAWN length by class.
- **W2** `tools/world/graph-diff.mjs <old> <new>` (Node): the share of ids kept, by kind; every kept id the same source key; every ferry route, lane, terminal and airport dropped, and every one whose slot inputs moved (1.3).
- **W3** `tools/world/frame-check.mjs` (Node): `toLocal` and `toGeo` round trips within 1 cm out to 60 km from the origin; `toFix` equal to `geodeticToFix` x 1000; `axes` within 1e-6 rad of `WorldFrame.axesAt` with the grid convergence. (`EarthLanding.axesAt` is private to a class built from the trip; if its 10 m steps are the reference, they move into a pure exported function first.)
- **W4** `tools/world/lanes-check.mjs` (Node): every lane on the sea every 1 km against the coastline download, its last 150 m into a port's area exempt; until that download is in, only past 5 km from shore by `earth.bin`, and the run says so. On WATER every 10 m inside a map, terminal ends exempt. Every port reached; each lane's traffic within 10 % of the raster's (ESTIMATE target).
- **W5** `tools/world/regions.mjs` (browser, `?fixeddt`, a stub life): from the street to 15 km and back, every `onRegion` call in order, none twice, each level as City has it.

Life's (second account):
- **W6** is life's, `tools/life/flag-off.mjs`, new (`tools/sky/flag-off.mjs` loads only the plain page and looks for `/sky/` and moonrun): the build with `?life` off against the same commit built without life, on the plain page and on `?earth`: the same requests, the same programs. Against the same commit, so the world's own stage 1 changes don't trip it.
- **L1** `tools/life/determinism.mjs` (Node, then Chromium and WebKit through Playwright): one place and moment twice gives the same snapshot bytes on one engine; the same moment in Chromium and WebKit within 1 cm (Proposed, the second account, 0.3: Chromium in the cloud, WebKit on the laptop by the first account, since the cloud machine has only Chromium and Playwright's WebKit would be a download); 3,600 steps of a second end where one jump of an hour does, within 1 cm, for ships and ferries; two places differ.
- **L2** `tools/life/worker.mjs` (browser, fixed step): life's protocol as life's spec has it, every buffer back, nothing allocated per message; the build has no `SharedArrayBuffer` or `Atomics` (a parse, as `iosfloor` does).
- **L3** `tools/life/budget.mjs` (browser, `?fixeddt`): draws and triangles from `renderer.info` in the busiest view within section 2.
- **L4** `tools/life/alloc.mjs` (Node, `--expose-gc`): `frame()` 10,000 times after a warm-up grows the heap by under 64 KB.
- **L5** `tools/life/paint.mjs` (browser, fixed step, `?t=...&rate=0`, so the test store): a ferry painted through `__qa`; its key in the test store; after a reload at the same `?t=` still painted; a second past `until`, gone; another place's keys kept when this one loads; 5,000 hits keep the store under its cap; the real store untouched.
- **L6** The warm-up: the count of programs at boot equals the count after two minutes of fixed-step flight (cloud); `tools/warmcheck.mjs` with `?life` (laptop).
- **L7** The weather: `CLEAR` and no weather give the same snapshots.

Both: the milliseconds a frame in the busiest view, on the laptop's GPU and on the iPhone 13, taken by the first account; stage 1's gate (`LIVING.md`).

## 8. How this changes

- It's signed when each account adds its line below, in a commit on `feat/earth`.
- After that, either side proposes a change in a commit to this file whose message starts `CONTRACT:` and names the section, the change marked Proposed. It holds once the other side's commit marks it Agreed. Until then the old text holds and nothing is built on the new.
- A file's shape changes only with its version: the minor for something added that old readers can skip, the major for a break. The change log below says what changed and in which commit.

## 9. Open, for the second account before it signs

| | Question | This draft's pick |
|---|---|---|
| O1 | Draws: 5 in the scene pass and 3 in the sun pass, or `LIVING.md`'s 3 (specks folded into the models' draws) | 5 and 3. **Agreed** (the second account, 0.3): specks are points and marks another material, and folding them into the models would cost more vertex work than a draw each |
| O2 | The clock under `?fixeddt`: stepped inside `SkyClock` (the first account adds it on `feat/clock`), or a clock life's tests drive through `__qa` | Inside `SkyClock`. **Agreed**, and the second account adds it on `feat/earth` with main's merge, where the street's `LiveSky` and the flight's clock meet: `feat/clock` is live now, and the street's tools step it the same way |
| O3 | One `SkyClock` a page: today the flight makes its own (`moonrun.ts` ~273), the street on `feat/earth` none, and `feat/clock`'s street another | The page makes one, `bootMoonrun` takes it. **Agreed**, by the second account with the merge. The trip still runs on its own stepped time from that clock's start (`MoonTrip`, `ms0 + t * 1000`), which `?earth&resume` carries across the page change; life reads the page's clock |
| O4 | Life's second call, `frameSky`, in `moonrun.ts`: above 15 km the flight's loop has the frame. The flight is the second account's | Yes, said in `docs/TODO.md`. **Agreed** |
| O5 | The aim and the tap for movers: `MoverTarget` in `Aim.ts`, `opts.mover` in `Splat.ts`, by life, reviewed by the world | Yes. **Agreed** |
| O6 | Marks: wakes and tyre tracks through `GroundPaint`, with a trail call life adds; contrails as life's own draw. How marks fade, so a city doesn't fill with colour by itself (`LIVING.md`, "Risks"), is life's | Yes. **Proposed change** (the second account, 0.3): every mark is life's own draw, wakes on the water, tracks on the road's own heights and contrails in the sky, one scene draw, and none goes through `GroundPaint`. `GroundPaint` keeps every texel it holds (its tiles saved in `localStorage`, 160 at most, `MAX_TILES`) and nothing in it fades: a ferry's wake across the bay would spend the street's own store and stay painted for good, which is the saturation `LIVING.md` warns of. A mark is drawn from what's saved anyway, the painted mover's record and its path, which is a function of the clock (a ferry's wake is its route from where it was painted to where it is now, so the next crossing repaints the lane), faded by age, so nothing is saved for a mark. Section 2's budget loses its `GroundPaint` row, and the draws stay 5 and 3 |
| O7 | The far shimmer on roads and water (`LIVING.md`'s smallest band): the world's ground shaders read a small density texture life fills, or carry life's GLSL chunk | The texture, the world's shaders. **Agreed**: with no `?life` they read a 1 x 1 texture of nothing, so the programs are the same with the flag off (W6) |
| O8 | The local hour off a map: a time-zone index in the planet layer (timezone-boundary-builder), or the Sun's own hour | The index. **Agreed**, in stage 2 with its download; in stage 1 what life has off a map, ships on lanes and planes, keys on UTC, and anything that wants an hour there takes the Sun's |
| O9 | The geoid in `PlaceFrame` (an EGM96 grid), or 0 for now | 0 at stage 1's start; the grid before any plane is drawn under about 1 km. **Proposed change** (the second account, 0.3): no grid in the browser. N is one number a place, `PlaceInit.geoid`, written by the bake from the grid (a download, the producer's OK): across a city it changes by under a metre (ESTIMATE), well inside a plane's own drawn size. Off every map, planes are over 1 km bar the ones landing at a mapped airport, and those take that airport's city's N. A place with no N yet keeps 0, and life draws no plane under 1 km there |
| O10 | The Bay Area in stage 1: San Francisco's map grown, or several maps (Oakland, Marin). Keys from source keys hold either way | The world's call, by stage 1's first week. **Agreed** |
| O11 | The planet's airports: OurAirports (public domain) or Overture's aeroways (ODbL) | OurAirports, with ODbL runways where a map has them. **Agreed** |
| O12 | An Overture extract with `access_restrictions`, `speed_limits` and `connectors` | Yes, among stage 0's downloads. **Agreed** |
| O13 | The flag: `?life`, the default only on the producer's word, as `?earth` | Yes. **Agreed** |
| O14 | The store's caps (2,000 records, 256 KB) and the 7-day loss | As section 3. **Proposed change** (the second account, 0.3): the caps as drafted, but life's store is a database of its own in IndexedDB, as the Moon's open-ground paint is since 96ee034 (`src/world/GeoPaint.ts`: written a few records a frame, a journal in `localStorage` on hide), and `localStorage`'s 5 MB stays the street's and `PaintState`'s. Blocked IndexedDB (some private windows): paint kept for the session, as the Moon's is. The 7-day loss stands: it's every script-written store's |
| O15 | "One hook" (`LIVING.md`, "Hot spots") read as section 6's list, or one block, which would need the producer's word | The list. **Agreed** |
| O16 | "One cruise ship at Pier 27 on its real port calls" (`LIVING.md`, stage 1): nothing in the world's data has port calls, and no open source has them worldwide. Life simulates believable calls from terminals and lanes, by season; or the world names a schedule source as a download | Simulated, as the producer ruled for ferries ("very educated guess"); "real port calls" was the plan's wording, not theirs, and they're told so (2026-11-04). **Agreed** |

**Downloads** (none fetched; each is the producer's to OK with file, source and size first, `CLAUDE.md`; sizes aren't read yet, and each is read from its source's page before asking; each goes on `LIVING.md` stage 0's list beside Overture, GLO-30, WorldCover and GEBCO):

| File | Source | For | Licence and credit | Stage 1 can't start without it |
|---|---|---|---|---|
| Global Shipping Traffic Density, the commercial layer | World Bank data catalogue (IMF's AIS analysis) | `lanes.bin` | CC BY 4.0, credited in the game (one catalogue copy says "Copyright": check) | Yes: the cargo ships |
| `airports.csv`, `runways.csv` | OurAirports | `airports.bin`, the scripted planes | Public domain | Yes: the planes' fallback |
| Overture transportation with `access_restrictions`, `speed_limits`, `connectors`, the Bay Area | Overture, 2026-10-21.0 before it's deleted | The graphs (O12) | ODbL, credited | Yes: cars |
| OSM land polygons | osmdata.openstreetmap.de | W4's coastline | ODbL, credited | Yes for W4 past the maps |
| EGM96 15' grid | NGA | The geoid (O9) | Public domain | No: before planes under 1 km |
| timezone-boundary-builder, with oceans | its GitHub releases | The hour off a map (O8) | ODbL, credited | No: stage 2 |

## Signatures

- The first account: drafted 2026-11-04 (0.1, then 0.2 after a reading), for the second account to sign.
- The second account: signed 2026-11-05, with section 9 answered as marked there. O6, O9, O14 and L1 are changes, Proposed until the first account marks them Agreed; until then nothing is built on them, and the rest of life's stage 1 goes ahead on what's Agreed.

## Change log

- 0.1, 2026-11-04: the first draft, by the first account. Not committed.
- 0.3, 2026-11-05, the second account: signed. Section 9 answered; O2 and O3 the second account's, with main's merge; Proposed: O6 (every mark life's own draw, none through `GroundPaint`), O9 (N a number a place, from the bake), O14 (life's store in IndexedDB), L1 (WebKit's leg on the laptop).
- 0.2, 2026-11-04: after a reading of 0.1. Mover keys from source keys, with slots and days defined; ids unique per bake only, W2 checks source keys and slot inputs; a ferry's paint to the end of its vessel's day; the store drops a key only when its own place's data lacks it, expires by `Date.now`, and has a test store; a units table and `vdatum`, the geoid's sign; `PlaceInit` and `makePlaceFrame`; `MoverTarget`, `opts.mover`, `life.blast`, and every line life adds to `main.ts` and `moonrun.ts`, `bootLife` guarded; determinism within 1 cm across engines, painted movers and live planes excluded; TUNNEL and UNDRAWN apart, deck heights from the graph in every city; water ends at terminals exempt, a real coastline for W4; the worker's protocol, rows and record moved to life's spec; budget lines for aim, marks, the worker's heap, pool and file sizes; `onRegion`'s mesh steps corrected; the downloads table; O15 and O16.
