# WORLD-TRAVEL: SF to Tokyo by hand, then every city

Technical director's design for world travel, the layer that the turbo gears
(`config.turbo`, branch feat/controls) are waiting on. Date 2026-10-23.
Status: proposal. Nothing in the repo was edited and no browser was run.

**Producer ask:** "The struggle bus able to fly from SF to Tokyo across the
Pacific, but have to do it manually, using some sort of turbo modes." Later:
every city in the world, with potentially huge numbers of players.

**Read for this:** docs/ARCHITECTURE.md, DECISIONS.md, docs/specs/COMMON.md,
src/render/{PixelPipeline,materials,palette}.ts, src/world/{buildingMaterial,
GroundPaint,PaintState,City,tiles}.ts, src/world/props/*, src/fx/Particles.ts,
src/audio/AudioEngine.ts, src/game/{Splat,geo}.ts, src/main.ts, feat/controls
(src/game/Turbo.ts, src/fx/Turbo.ts, config.turbo), feat/osm (tools/bake/
overture.py, DATA_LICENSE.md), design/MAGIC-SPEC.md, and the shots in
shots/merge1, shots/merge2 and shots/v6/regress.

**Measured for this:** the great-circle geometry, the sun along the route, the
Overture height coverage in two central-Tokyo row groups (live S3 reads, 2.5 s),
the global Overture building count from the cached footers, and whether each
data host is reachable from this machine (curl HEAD). Everything else is an
estimate and is labelled as one.

---

## TL;DR: the calls

1. **Where the truth lives.** The world's true coordinates are WGS84, held in
   float64 on the CPU. The GPU only ever sees a flat local frame within about
   50 km of a floating origin. City content is baked in **UTM zone frames**
   (6° zones, meters) on a global region grid. While you are in a city, the
   origin sits on that city and never moves, so city code never sees a rebase.
   Out in the open the origin follows the bus. A move inside a zone is a pure
   translation. Crossing a zone boundary adds one yaw rotation, carried by a
   new `pipeline.rebase()` so the snapped pixel grid and dither phase don't
   jump.
2. **Curvature is one line in each vertex shader**, applied relative to the
   camera: `y -= r² / 2R_eff`. Flight physics and the baked tiles stay flat.
   The planet comes out as a paraboloid that matches the sphere's horizon to
   first order. One knob exaggerates it: I recommend R/3 at 20 km and up,
   because the real curve is only 2-5 px in our 390-px frame.
3. **Most of what you see between cities is drawn in the resolve pass.** A
   pixel with no geometry whose view ray hits the planet is shaded
   analytically as ocean or flat far land. Real relief near you comes from an
   8-ring geometry clipmap, drawn over land only. The marine layer's fog sea
   (`seaShade`) becomes the planet's cloud deck. Flying G3 over the ocean costs
   about 30-40 draws, far fewer than the city's 120-200.
4. **The sun is real**: UTC plus position, from an ephemeris on the CPU. On the
   real late-October route the sun never climbs above about 33°, so the whole
   crossing is in raking Hopper light. Leave SF at 5 pm and you land in Tokyo
   at 9 am the next day. Leave just after midnight and you fly out of the
   stars and catch the sun setting beside Mt. Fuji, just right of the nose.
5. **The LOD ladder runs L0 (street) to L5 (orbit).** Three data tiers:
   - hand-tuned hero cities, pre-baked;
   - on-demand bakes for a destination you pick, since a 5-minute crossing
     hides a multi-minute bake;
   - later, one global batch bake. 2.53 B Overture buildings comes to about
     0.4-2 TB of tiles and an estimated tens to hundreds of dollars of compute.
   Anywhere not baked yet is uncharted, and uncharted is a fog bank. The
   opening already does this.
6. **Tokyo's footprints are complete, but its heights are not.** Overture (OSM)
   has the footprints. Measured today, only **12-16 % of central-Tokyo
   buildings carry a height or floor count**. PLATEAU (Japan's 3D city models)
   would fill that, but its hosts **return 403 from this machine**, so it has
   to be fetched elsewhere. Copernicus GLO-30 **is reachable**. It is a surface
   model (roofs and trees are in it), useful for Fuji and the Kanto plain and
   as a height hint for big buildings.
7. **Navigation stays diegetic and manual.** No autopilot. The cues:
   - a green highway sign in the sky ("TOKYO 7,412 KM · 4 MIN →");
   - a dotted rainbow great-circle thread drawn on the cloud deck;
   - the bus's one eye glancing toward where it wants to go.
8. **The ocean is a 5-minute beat sheet**, not a void. You can paint clouds,
   container ships and whale spouts. There are rainbow currents to ride, storm
   cells to dodge, a typhoon eye to thread, and the date line ("TOMORROW").
   Wildlife and weather are real for the date. No icebergs: this route has
   none in October.
9. **Turbo energy is earned by painting.** G3 burns it, and the ocean's objects
   refill it. An empty tank drops you into "struggle mode" at G2 speed. It is
   never a fail state.
10. **Server.** Tiles are immutable files on R2 behind the CDN. Paint lives in
    **cells, one Durable Object per 8 km UTM square**, using WebSocket
    hibernation. The shooter computes a blast and the server validates and
    orders it. State is written behind as per-region blobs, never one row per
    building. The paint key is a **64-bit hash of the GERS id**.
11. **What to build first in this repo:**
    - WorldFrame, Nav and Sky as pure TS, with an offline sim;
    - the pipeline's `rebase()` plus a planet branch, behind a flag;
    - the curve chunk, defaulting to 0;
    - a planet bake for the Pacific corridor;
    - `dev/world.html`.
    That is about **6-8 engineer-weeks to "fly from SF to an empty, beautiful
    Japan"**. A grey Tokyo comes about 6-10 ew after that.

---

## 0. Baseline: what the code assumes today

- **One city, one flat frame.** The bake projects with
  `+proj=tmerc +lat_0 +lon_0 +k=1` about the city origin (`src/game/geo.ts`).
  Positions are f32 world meters, with +X east, +Z south and Y as NAVD88
  height. SF: 140,961 buildings, 2,404 tiles of 256 m, 196 regions of 1 km,
  19.7 MB (about 140 B per building).
- **Camera.** near 1.5 m, far 30 km, 24-bit depth (`UnsignedIntType`). The
  pixel snap rounds the camera's position along its own right/up axes in
  world space. The dither origin is `round(px) & 3`, and the shadow camera
  snaps to its texel grid the same way. Both depend on absolute world
  coordinates, so **any shift of the world origin moves the lattice phase**.
- **Everything is hard-coded to SF in world meters**: `sbLayerTop`, its CPU
  mirror `layerTopBase()`, the `buriedTile` culling, the paint-fog rect
  (`uPaintFogRect`), and the map-edge homing in main.ts (about lines 506-513).
- **Paint.** `PaintState` is an RGBA32F texture, 1024 texels wide, one texel per
  building in the city, with localStorage keyed by stable id.
  `GroundPaint` keeps one RGBA8 mask per terrain tile, with localStorage keyed
  by tile `tx,tz`, so the key depends on the city's frame. On feat/osm the
  stable ids become FNV-1a of OSM ids (u32), in stores paint.v2 / ground.v3.
- **Turbo (feat/controls).** G0 surge 112 m/s, G1 450 m/s above 150 m, G2
  4.5 km/s above 2 km, G3 30 km/s above 10 km. G2 and G3 are locked behind
  `worldTravel: false`. `edgeFade` slows any gear back to surge speed near the
  map edge, so the homing can turn the bus round.
- **Fog** is off by default since 78a2c74 (`?fog` turns it back on). The frame
  is 390 px wide (a3ecbc3). The look in v6/regress and merge1/merge2:
  battleship-grey city, dark navy water, bright saturated paint.
- **Palette**: 20 ramps in use out of `RAMP_COUNT = 32`, so there are 12 free
  rows for new ramps.

---

## 1. Coordinates and precision

### 1.1 Truth vs render

| Layer | Representation | Precision |
|---|---|---|
| Truth (CPU, JS doubles) | WGS84 geodetic (lat, lon) + **orthometric height** (≈ MSL, EGM2008); ECEF only for great-circle math | float64: sub-mm anywhere |
| Content frames (bake) | **UTM zone** (6° bands, EPSG 326xx/327xx), meters; tiles 256 m / regions 1 km on the zone's easting/northing grid; tile vertices i16 decimeters relative to tile origin (as today) | exact projection, scale 0.9996-1.0010 (invisible) |
| Render frame (GPU) | flat meters relative to a **floating origin**, +Y up; same axes as today | f32, kept within 50 km of the origin |

The geoid undulation is ignored (-32 m at SF, +37 m at Tokyo). Nothing in the
game compares ellipsoidal heights. Every height source is MSL-like: NAVD88
(USGS), EGM2008 (Copernicus) and T.P. (Japan).

f32 resolution (ulp) against distance from the origin:

| distance | 10 km | 50 km | 250 km | 1,000 km | 8,000 km |
|---|---|---|---|---|---|
| ulp | 1.0 mm | 3.9 mm | 1.6 cm | 6.3 cm | **0.5 m** |

Near the bus one game pixel is about 0.3 m, and anything moving 0.1 px jitters.
That gives a hard rule: **no render-frame coordinate more than about 50 km from
the origin.** A single ECEF scene would put vertices at 6.4e6 m with a 0.5 m
ulp, which is why we don't do that.

### 1.2 Frames, the floating origin and rebases

`src/game/WorldFrame.ts` (new, pure TS) owns:

- `zone`: the current UTM zone, plus `origin` (easting, northing) in float64;
- geodetic ↔ zone ↔ render conversions;
- `rebase(dx, dz, yaw)` events.

**Rules:**

1. **City mode.** If the bus is within a loaded city's detail radius (25 km of
   its origin), the render origin is pinned to the city origin and never
   moves. City code (GroundPaint, PaintState, the paint-fog rect, the blast
   ring uniforms, tree fields, obstacles) runs exactly as it does today in
   that city's coordinates. **Cities never see a rebase.**
2. **Travel mode.** When the bus is more than 20 km from the origin, translate
   the origin to the bus. At G3 (500 m per frame) that is roughly once every
   40 frames. Translation only, inside a zone.
3. **Zone switch.** Crossing into a new zone (every 6° of longitude, about
   470 km at 45° N) applies a yaw (the difference in grid convergence:
   γ ≈ Δλ·sin φ, about 4° at 45°) plus a translation. `Flight.heading += Δγ`.
4. **Arrival.** Within 60 km of a destination city's origin, rebase onto it
   (it is in the same zone or the next one), then load its coarse regions.
   Steps 1-4 mean **the city always loads after the last rebase and unloads
   before the first one**. During the hand-over, the metro layer bridges the
   gap (§3); it is rebase-aware and uses simple materials.

**What must implement `rebase(dx, dz, yaw)`** (anything holding render-frame
positions across frames):

- `Flight`: x, z, heading, the look-ahead state.
- `CameraRig`: spring states, focus.
- `pipeline`: see below.
- `Particles`: shift `particles.object.position`. It already carries the snap
  compensation; add the cumulative rebase delta.
- Turbo FX: the contrail buffer (rewrite it), the speed-line phase uniform.
- `Aimer`: latched points.
- `Splatter`: in-flight projectiles (pending blasts, misses).
- The drop shadow; the travel content (clouds, ships, whales: their instance
  buffers, or a per-layer group offset); the nav thread.

Each is a few lines. The offline sim (§9) checks each one.

**`PixelPipeline.rebase()` keeps the pixel lattice continuous.** Snapping uses
`px = (cam.pos · right) / s`. A rigid transform p' = R(p - T) applied to the
world *and* the camera keeps the image identical, but it shifts the lattice
phase by T·right/s. So add a lattice offset L to the snap,
`px = ((cam.pos - L) · right) / s`, and on rebase set `L' = R(L - T)`. Then px
is bit-identical before and after. The shadow camera's texel snap needs the
same offset. This is the only renderer change that rebasing forces.

**Rule: world-anchored noise uses its content's own frame.** Many shaders hash
world positions: ground-paint warp, glitter, billows, cloud lumps. Ocean and
sky noise in travel mode must use `localPos + uNoiseOrigin`, where
`uNoiseOrigin = origin mod P` (P = the noise period, e.g. 8,192 m), computed
in float64 on the CPU. Seamless, no precision loss, and it doesn't shift on a
rebase.

### 1.3 Flight on a round planet

`Flight` keeps flying in the flat frame, unchanged. A straight line in a frame
that is re-anchored under the bus, with no yaw added by translation rebases,
traces very nearly a great circle. In UTM it deviates by less than 1 % over a
zone. So **flying straight is great-circle navigation**, and the true heading
drifts on its own: SF→Tokyo starts at 303° and ends at 234°, exactly as an
airliner's does. The compass cue (§5) is
`bearing(busLatLon, dest) - trueHeading(bus)`, computed in float64 each frame.

In travel mode the automatic floor is `World.groundAt(x, z)`: planet DEM
heights over land, 0 over the ocean, plus ship and island posts when you fly
low. The obstacle grid exists only inside cities, as today.

Feat/controls already owns the gear floors (`alt1-3`). Two additions for travel:

- `edgeFade` and the map-edge homing are off in world mode;
- the breath's projectile inherits the bus's velocity when launched under turbo.
  At G3 it would otherwise be launched at 850 m/s from a bus doing 30 km/s.
  Owner: splat/controls.

### 1.4 Curvature: a camera-relative drop

```glsl
// GLSL_CURVE (new, materials.ts; render owner): every scene vertex shader, after world position, before projection
uniform vec3 uCurve;          // x = snapped camera x, y = snapped camera z, z = 1 / (2 R_eff)  (z = 0: off, today's look)
vec3 sbCurve(vec3 wp) { vec2 d = wp.xz - uCurve.xy; wp.y -= dot(d, d) * uCurve.z; return wp; }
```

- **Why relative to the camera, not to the city.** Near the camera the drop
  vanishes: 0.007 m at the bus 300 m away, 0.08 m at 1 km. Flat physics, the
  flat obstacle grid and the flat tiles therefore agree with what is drawn
  wherever the bus can touch anything. Far away it is the planet: 7.8 m at
  10 km, 31 m at 20 km, 2 km at 160 km. Bending relative to the city origin
  instead would sink the city's edges under a bus that physics thinks is flat.
- **Why a paraboloid is good enough.** For a camera at height h, the ray that
  just grazes a paraboloid of radius R dips by α = atan(√(2h/R)), the
  sphere's dip to first order, and the horizon lies at r = √(2hR). Both match
  the sphere. Out to 800 km the error is r⁴/24R³ ≈ 66 m on a 50 km drop.
- **Where it applies.** Every material's vertex stage: buildings, terrain,
  trees, sprouts, landmarks, signs, particles (centers), travel content, the
  clipmap. The bus is near, so it doesn't need it. The shadow pass uses
  `MeshDepthMaterial` and doesn't bend; its window is at most 1.6 km, so the
  error is at most 0.2 m, and above 2 km shadows are off anyway (§2.6).
- **The analytic planet in the resolve uses the same paraboloid**, so geometry
  and the analytic ocean meet exactly: no seam, no z-fight.

**How visible the real curve is** (the horizon frown, measured from its center
to the frame edge):

| lens | 10 km | 30 km | 50 km |
|---|---|---|---|
| vista today (38° hfov, pitch 22°) | ≈ 2 px | ≈ 3.5 px | ≈ 4.5 px |
| G3 lens (50° hfov, pitch ~10°) | ≈ 2.5 px | ≈ 4 px | ≈ 5.5 px |
| G3 lens, R_eff = R/3 | ≈ 4.5 px | ≈ 7 px | ≈ 9.5 px |
| G3 lens, R_eff = R/6 | ≈ 6.5 px | ≈ 10.5 px | ≈ 13.5 px |

The real Earth looks flat from an airliner, and it would look flat here too. The
curve reads mostly from the **limb**: a bright band of haze that hugs the curved
horizon (§2.2).

**Recommendation:** `config.world.curve` with R_eff = R/k, where k = 1 below
2 km, easing to 3 at 20 km and 4 at 50 km. The world stays believable but
visibly round, and the limb sells it.

Cost of exaggerating: the horizon comes in by √k (at 20 km, 505 km → 290 km).
At G3, something that rises over the horizon then reaches you in about 10 s
instead of 17 s. This is a producer decision (§11).

### 1.5 Depth, near and far

Precision at distance d is about d² / (near · 2²⁴) and hardly depends on far.

- **Far** = max(30 km, 1.25 × the horizon distance), up to 1,500 km. City
  precision doesn't change.
- **Near** = clamp(h_cam / 1,500, 1.5 m, 20 m). The nearest thing is the bus,
  175-270 m away. At 10 km altitude a near of 6.7 m gives about 0.8 km of
  depth precision at 300 km.
- Beyond geometry there's no depth to fight over. The ocean and far land are
  analytic in the resolve (§2.1), so an island 300 km away is geometry over a
  "sky" pixel, never over an ocean triangle.

---

## 2. What is rendered between cities

### 2.1 The planet layer

**Ocean: analytic, zero draws.**

- **Hit test.** In the resolve's sky branch (`z >= 0.99999`), the ray from
  `uCamPos` is tested against the paraboloid (`uCurve`). A miss is sky; a hit
  is surface.
- **Land or sea.** At the hit point, the surface sample is the planet atlas
  (land/sea mask, coast signed distance, land class, hillshade, urban
  density), read through a per-frame affine map from frame xz to atlas uv.
  The CPU computes that map in float64 for the atlas tiles in view.
- **Ocean look.** The WATER ramp (or a new OPEN_SEA ramp, §2.5), with:
  - sun glitter from world-anchored hashed facets (§1.2 rule);
  - a whitecap dither in wind (from the weather map);
  - shallow shelves a step lighter (bathymetry from the AWS Terrain Tiles);
  - a 1-2 px foam line where the coast distance crosses 0.
- **Strobing at speed.** At G3, ocean features stream past at 10-25 px per
  frame, so glitter cells must be larger than the motion per frame, or
  stretched along it like streaks (`speedK` from TurboDrive). Otherwise they
  wagon-wheel. This is a named risk, and it must be checked with frame
  sequences (`tools/shimmer.py`).

**Land relief: an 8-ring geometry clipmap, land only.**

- **Shape.** Each ring is a 64 × 64 grid. Ring 0 has 60 m cells (±2 km);
  ring 7 has 7.7 km cells (±250 km). Each ring is snapped to its own cell size
  in the zone frame, so vertices never swim, which matters for pixel art.
- **Shading.** The vertex shader reads heights from the atlas: RG8 with a
  manual bilinear of 4 `texelFetch`, because iOS Safari doesn't
  linear-filter float or 16-bit textures. It outputs ramp, light and fog, and
  `sbWrite` with flags 0.5 (outlines off up there).
- **Budget.** Rings over open ocean are skipped (CPU test against the atlas's
  land fraction). That's ≤ 8 draws and ≤ 65k triangles.
- **Cities.** Inside a city the clipmap sits 2 m under the city terrain and
  loses the depth test. This is the same trick as today's 64 m far ground
  "hidden under loaded tiles".

**Planet data**, baked once and versioned, quadtree tiles of 256², z0-z11
(about 40-75 m per texel at z11, depending on the tiling scheme). Sources:

| Data | Source | Notes |
|---|---|---|
| DEM | Copernicus GLO-90 / GLO-30 | **reachable** (s3 copernicus-dem-30m / -90m) |
| Bathymetry | AWS Terrain Tiles (terrarium) | **reachable**; already a pyramid |
| Land class | ESA WorldCover 10 m | **reachable** (s3 esa-worldcover) |
| Coastline, lakes, rivers | Overture base `land` / `water` (OSM coastline) | reachable |
| Urban density, night glow | Counted from Overture buildings | reachable |

Each texel's channels: height, class, coast SDF, density. The North Pacific
corridor plus Japan plus California at z0-z9 is about 30-80 MB (estimate).
The whole planet at z0-z11 is a few GB.

### 2.2 Atmosphere, sky, stars

- **Haze.** `sbFog` becomes the optical depth of an exponential atmosphere
  along the ray, in closed form, with scale height H (stylized to 3-5 km so
  that haze reads at our distances). Rays that graze the planet build up the
  most optical depth, which gives a **bright limb** hugging the curved
  horizon (step 6-7 of FOG/LIMB) for free. Above 2 km in travel mode this
  replaces the SF marine-layer branch. The marine layer becomes the cloud deck
  (§2.4).
- **Sky gradient against altitude.** The zenith deepens through FOG, to a new
  NIGHT_SKY ramp's mid steps at 20 km, to its dark steps at 40 km and up.
  The calm-mode horizon line (`skyL -= uCalm…`) already exists; we extend it.
- **Stars.** The roughly 600 brightest stars from the Yale Bright Star Catalog
  (public domain), projected on the CPU by sidereal time and latitude: real
  constellations. One `Points` draw, 1 game px each, GLOW_WHITE steps 5-7 by
  magnitude, with a twinkle of ±1 step on a slow Bayer phase. They fade in
  when the sun is below -6°, and above 25 km even by day (stylized: "you
  reached space"). Moon: one pixel-art disc sprite with the real phase (a
  simple ephemeris).
- **Constraint check.** Everything is ramps and steps, fog is the existing
  handover band, and dither is in screen space under `calm`. Nothing is free
  RGB.

### 2.3 Sun, day and night, time zones

`src/game/Sky.ts`: the NOAA solar position algorithm (about 0.01°, a few µs)
from UTC and the bus's lat/lon, giving `uSunDir` in the render frame (rotated
by grid convergence). It also provides sidereal time and moon phase.

The real route, measured for this doc (departing Fri 23 Oct 2026, 17:00 PDT,
at G3):

| along | t | where | sun elev / azimuth | bus heading | sun relative |
|---|---|---|---|---|---|
| 0 km | 0 s | SF (16:06 solar) | 14° / 243° | 303° | 61° ahead-left |
| 2,069 km | 69 s | 46.0° N 145.0° W | 22° / 222° | 288° | left |
| 4,675 km | 156 s | **date line**, 48.2° N | 30° / 186° (local noon) | 262° | left |
| 7,447 km | 248 s | 39.8° N 147.5° E | 33° / 148° | 239° | 92° left |
| 8,275 km | 276 s | Tokyo, 09:05 JST Sat | 32° / 138° | 234° | behind-left |

- **Late-October sun stays low the whole way.** The route peaks at 48.7° N
  and the sun is at declination -12°, so the sun never climbs above about 33°.
  **The whole crossing has raking light**, the very condition DECISIONS says
  makes low-res 3D readable.
- **You overtake the sun.** At 48° N the Earth's surface moves at 310 m/s;
  G3 is about 95 times faster. Local solar time runs *backwards* by 6.5 h over
  4.6 min, and the sun swings visibly across the sky (about 0.35° per second).
  This is a free time-lapse.
- **Departure at 00:45 PDT** (07:45 UTC): a night crossing under real stars,
  with the western sky brightening ahead as you chase the terminator. You
  arrive at Tokyo at **sunset**, sun at 0.4° / 255°. Tokyo→Fuji is bearing
  247° and the final heading is 234°, so **Fuji stands silhouetted about 13°
  right of the nose, with the sun setting just beside it**. That is a set
  piece, and the real ephemeris gives it to us.

**Recommendation:**

- The real sun, driven by UTC, as the end state. A shared world needs one
  truth: if it is night in Tokyo, it is night for everyone there.
- Inside a "light window", elevations above 35° are compressed toward 35°
  (noon never goes flat).
- Night gets a real art pass. Nights are blue hour, never black: a moonlit key
  light, the WINDOW ramp glowing in lit windows, paint glowing more (the glow
  pipeline already exists, and MAGIC-SPEC's beacons turn into lighthouses).
- **Until night art exists** (Phase W1-W2): the session picks a departure
  solar time inside the golden band, and solar time then follows longitude
  flown (`t_solar = t0 + Δlon/15 h`). With no other players, this is
  indistinguishable from the real thing.

**Time zones.** The sky sign shows local civil time when it changes. At sea it
uses **nautical time zones** (UTC + round(lon/15)), which is the real rule at
sea. Over land it uses the destination's IANA zone from city.json (Intl API).
No global timezone raster is needed. The date line gets its own event (§6).

### 2.4 Clouds and weather: yes, they are the stage

**The marine layer becomes the cloud deck.** `sbLayerTop(xz)` today is SF
geography in game meters. Make it `deckTop(xz) = weatherTop(uv) + billows`,
where `weatherTop` comes from a small global weather texture:

- 0.25° cells;
- channels: deck top m, coverage, cell type, convective potential;
- R8 × 4 at 1440 × 720, 4 MB;
- one upload when the day's weather changes.

SF keeps its hand-authored layer inside a blend radius. `seaShade()` already
lights a billowed deck top from above, with warm sunward billows and a cool
lee, and carries it past the far plane to the horizon. The
**Californian stratocumulus sheet** really does run 1,000+ km off the coast,
so leaving SF over the fog sea and flying out over its open and closed cells
is both true and nearly free.

**Cumulus and cumulonimbus are instanced geometry.** One lobe template, the way
`trees.ts` builds every species, with lumps, paint pop and sway in the vertex
shader. One `InstancedMesh` per cloud class (cumulus, towering, anvil): 3
draws, about 50-150k triangles in view. Each cloud has a paint slot in its
instance attributes, so it can be painted (§6).

**Weather source**, in order of effort:

1. A deterministic **per-day seed**, so every player sees the same storms that
   day ("did you see the storm over the Aleutians?"), driven by a monthly
   climatology: the North Pacific storm track, the subtropical highs.
2. **Real data** later. NOAA GFS 0.25° (public domain, s3 noaa-gfs-bdp-pds,
   **reachable**, every 6 h) gives cloud cover, precipitation and 250 hPa
   winds: the **real jet stream**. The Himawari-9 and GOES-18 mirrors are also
   reachable, if we ever want today's cloud imagery over the Pacific.

**Cloud shadows** on the ocean are analytic. The resolve samples the weather
coverage toward the sun at the hit point, so no shadow pass is needed.

### 2.5 Palette additions (render owner; 12 free rows)

Proposed ramps, art-directed later. Each is 8 steps, warm hues shadow to
rose/violet, and none is brown.

| Ramp | Purpose |
|---|---|
| NIGHT_SKY | high-altitude zenith and night: violet-black → indigo → deep blue |
| OPEN_SEA | open ocean distinct from the bay's WATER: blue-grey, glitter on top steps |
| LIMB | atmosphere rim: cool grey → pale cyan-white (or reuse FOG upper steps) |
| CLOUD | cool white with lilac shadow (FOG may suffice: test first) |
| DRY_LAND | far deserts and stubble seen from altitude: straw lights, lilac-grey shadows (never ochre-brown) |
| TWILIGHT | the terminator band and sunset limb: rose → amber |

### 2.6 Budget at G3 over the ocean (iPhone A15, 30 fps floor)

| Item | Draws | Tris | CPU per frame |
|---|---|---|---|
| bus + drop shadow | ~12 | ~20k | as today |
| particles, contrail, speed lines, vapor (feat/controls) | ~4 | small | as today |
| clipmap (land only; 0 over open sea) | 0-8 | ≤ 65k | ring snap: µs |
| clouds (3 classes) | 3 | 50-150k | spawns only |
| ships, whales, sky sign, nav thread, stars | ~6 | < 30k | spawns only |
| ocean, sky, limb, cloud deck, cloud shadows | 0 (resolve) | — | — |
| shadow pass | **off above 2 km** (`shadowStrength = 0` skips it) | — | — |
| **total** | **~30-40** | **~0.15-0.3M** | **~1.5-2.5 ms** (vs 3-5 ms in the city) |

The resolve grows by about 30-50 ALU per sky pixel: the ray hit, 2-3 atlas
fetches, a weather fetch, glitter. At 394 × 849 that is within budget.
**Uploads:** at most one atlas tile per frame (`uploadRect`), the weather map
once a day, and one dirty rectangle of sky paint (§6) per frame. That satisfies
"one upload per texture per frame".

---

## 3. LOD from orbit to street, and streaming

### 3.1 The ladder

| LOD | When | What | Source |
|---|---|---|---|
| **L5 orbit** | G3, 10-50 km up; view 300-800 km | analytic ocean and far land, limb, cloud deck, clipmap rings 4-7; cities as **urban-density glow** (night lights from building counts); hero silhouettes (Fuji, Skytree) | planet tiles |
| **L4 metro** | G2, 2-10 km; city 20-200 km away | **metro far tile per ~40 km cell**: one instanced box per building ≥ 20 m, plus density-extruded blocks for mid-rise fabric; landmarks; painted districts as glowing patches and MAGIC-SPEC beacons | new global bake product (today's `far.bin`, generalized) |
| **L3 coarse** | G1 or < 2 km; 1-20 km | today's coarse regions: one building mesh + one ground mesh per 1 km region, 8 m grid | region bins |
| **L2/L1 detail** | G0; < 1-2 km | today's LOD 0 tiles, trees, sprouts, ground paint | region bins |

**Speed limit by data.** Region streaming engages only below G2 speed or below
2 km. At 4.5 km/s you'd need 4-5 new coarse regions every second per km of
swath, far beyond worker meshing and network. So **the gears brake you over
big cities**: L4/L5 is what G2 sees, and you arrive by shifting down. This is
diegetic: the bus can't warp through Tokyo.

### 3.2 Pre-baked vs on-demand: three tiers

1. **Hero cities, pre-baked and hand-QA'd.** SF, Tokyo, then about 20 more
   (NYC, London, Paris, Amsterdam (already on feat/osm), Rome, Rio, Sydney...).
   LiDAR or PLATEAU where it exists, authored landmarks, an opening move, local
   fog and sound identity.
2. **Destination bake on demand.** Picking a destination on the departure
   signpost (§5) starts its bake. **The 4-5 minute crossing is the loading
   screen.** SF's Overture extract took about 2 minutes for ten feature types,
   and an OSM-only bake has no LiDAR step. A bake service reads **pre-partitioned
   Overture** (a one-time ~0.5 TB re-partition per release, by UTM zone and
   8 km cell, into R2) and fans out one container job per region (2-5k
   buildings each, seconds per job). Results go to R2, and the client polls the
   manifest. Bake once, serve forever.
3. **Global batch bake** (end state). 2.53 B buildings (from the cached
   footers), at about 140 B per building plus terrain, is **0.4-2 TB per bake**:
   about $6-30 a month on R2, with egress free. Compute is roughly 2.5 M to
   25 M core-seconds, i.e. **an estimated $30-350 on spot capacity**. Measure
   the real number in W0. After that, re-bake only the regions whose GERS ids
   changed in each monthly Overture release.

**Uncharted = fog bank.** Fly at G1 somewhere with no bake yet and the region is
a fog bank, the same device as the SF opening, which already doubles as the
loading screen. It thins away as tiles arrive. This is honest, beautiful, and
never a hard pop.

### 3.3 Bake pipeline changes (tools/bake owner)

- **Bake in UTM zone frames** (`+proj=utm +zone=N`), with tiles and regions on
  the zone's global grid. Key: `{zone}{N|S}/{rx}_{rz}`, the same key in CDN
  paths and in the paint server.
  - `city.json.origin` becomes the floating-origin anchor only.
  - Do this together with the feat/osm switch to `paint.v2` / `ground.v3`, so
    saved paint is only invalidated once.
  - A metro on a zone boundary bakes entirely in its home zone, extended
    ≤ 1° past the boundary (k ≤ 1.0012).
- **SBB4**: the stable id becomes 64 bits, xxhash64 of the **GERS id**
  (Overture's `id`), replacing the u32 FNV of the OSM id. At 10k buildings per
  region a u32 collides somewhere in about 1 % of regions; a u64 never does.
  The full GERS list goes in a sidecar per region, for server-side migration.
- **New products:**
  - `metro/{zone}/{cell40}.bin` (the L4 layer);
  - the `planet/{layer}/{z}/{x}/{y}.bin` pyramid;
  - a global `cities.json` (name, lat/lon, zone, tier, bake state, name:en,
    IANA zone).
- **Heights ladder for cities without LiDAR** (Tokyo and most of the world):
  1. LiDAR / PLATEAU measured height;
  2. OSM `height`;
  3. OSM `building:levels` × 3.2 + 1;
  4. building parts;
  5. Copernicus DSM minus an opened DTM (a median over the footprint; only
     for footprints ≥ about 2,000 m², and only for towers older than about
     2015);
  6. neighbours' median within the block;
  7. class and district prior (GHS-BUILT-H 100 m average building height if
     reachable: not checked).
  Record the source per building, as feat/osm already does.

### 3.4 Approach schedule (Tokyo, from the east)

| Distance | Gear (typical) | Request | Bytes (est.) |
|---|---|---|---|
| on destination pick (8,275 km) | G0-G1 in SF | trigger the destination bake (tier 2) or check that tier 1 is present; planet corridor tiles z5-z8 | ~5-15 MB over the first minute |
| 600 km | G3 | metro L4 cells along the final 200 km; Fuji / Skytree hero silhouettes | ~1-3 MB |
| 150 km | G3→G2 | planet z9-z11 for Kanto; the city's `city.json`, `far.bin`, `horizon.bin` | ~2 MB |
| 60 km | G2 | **rebase onto Tokyo's origin** | — |
| 40 km | G2→G1 | coarse regions in a corridor ahead (the existing streamer at 950 m lead + 1.9 km radius) | 100-200 KB per region |
| 5 km | G1→G0 | detailed regions (the existing hysteresis) | as SF today |

At G1 (450 m/s), with a 1.9 km load circle, about 1-2 new 1 km regions enter
every second: 0.2-0.4 MB/s (2-3 Mbit/s). That's fine on 4G. Coarse adoption
stays budgeted at a few tiles per frame, as today.

---

## 4. The arrival: Tokyo

### 4.1 The data, measured

Overture 2026-10-21.0, buildings theme, two central row groups read live:

| Row group (bbox) | Buildings | OSM share | with `height` | with `height` or `num_floors` | has_parts | roof_shape | tagged ≥ 100 m | height median / p90 / max |
|---|---|---|---|---|---|---|---|---|
| 139.69-139.71 E, 35.63-35.71 N (Shinjuku/Shibuya) | 33,083 | 97.6 % | 2,978 | **4,064 (12.3 %)** | 107 | 83 | 42 | 17.2 / 38.8 / 229.7 m |
| 139.76-139.79 E, 35.63-35.72 N (Marunouchi/Chuo/Tokyo Bay) | 36,163 | 98.2 % | 621 | **5,923 (16.4 %)** | 77 | 334 | 75 | 21.4 / 113 / 220 m |

- **Footprints.** Japan's OSM footprints are effectively complete: 98 % of
  these are OSM, and the rest are Microsoft ML footprints plus one research
  dataset. Japan as a whole is about 72 M buildings; Kanto about 12 M,
  counting only row groups that lie wholly inside it.
- **Heights.** Mostly missing for ordinary buildings, but the towers that
  define the skyline are tagged. The heights ladder (§3.3) gives a
  **B-grade grey Tokyo today**: right towers, plausible fabric.
- **PLATEAU** (MLIT Project PLATEAU) has LOD1/LOD2 CityGML for the 23 wards,
  with a measured height per building, under CC BY 4.0-compatible terms
  ("出典：国土交通省 Project PLATEAU"). It would make Tokyo **A-grade**, the
  way LiDAR made SF. **geospatial.jp, mlit.go.jp and the PLATEAU CMS assets
  host all return 403 through this machine's proxy.** We need a machine with
  access, or an allowlist entry. Conflation: keep the OSM footprints (so the
  GERS ids stay valid for shared paint) and transfer PLATEAU heights by
  footprint overlap (IoU ≥ 0.5). PLATEAU-only buildings get ids derived from
  their gml:id.
- **Copernicus GLO-30** (reachable) is a DSM from 2011-2015 TanDEM-X data, so
  roofs and trees are in it.
  - Fuji and the Kanto relief come straight from it.
  - Tokyo's own ground needs a DTM: a morphological opening (about 150 m
    window) plus smoothing, since central Tokyo's relief is only the
    20-40 m Yamanote terraces.
  - Its building signal is a hint for large footprints only.
  - GSI's 5 m DEM would be better but was not checked.
- **License stack:** ODbL (OSM via Overture), Copernicus DEM attribution,
  ESA WorldCover CC BY 4.0, PLATEAU attribution. All of it goes into the
  existing `DATA_LICENSE.md` pattern and the opening credit.

### 4.2 The geometry of the arrival

The great circle comes in from the northeast on a heading of 234°. It crosses
the coast over the Kashima-nada shore of Ibaraki, about 80 km out: the track
passes 61 km from Choshi and 18 km from Haneda. Then it runs across the Kanto
plain and past Lake Kasumigaura. **Tokyo Skytree (634 m, Sumida) is the first
hero on the line.** **Mt. Fuji (3,776 m) sits 90 km beyond Tokyo, bearing 247°,
about 13° right of the nose.** From 10 km up, its cap clears the real horizon
at about 576 km (357 km for the bus's horizon plus 219 km for the peak's).
With the recommended curve it clears at about 420 km.

### 4.3 Beat sheet (by distance; tunable)

| Distance | Beat |
|---|---|
| 576 km (real R; ~420 km with the curve) | Fuji's white cap pops over the horizon, just right of the nose. The music begins its arrival modulation (§4.5). The sky sign: "TOKYO 500 KM". |
| 300 km | Japan's coast rises on the planet layer. The sign: "TOKYO EXIT 150 KM". A shift-down cue: the bus's eye goes wide. |
| 150 km | You drop G3→G2: a **re-entry** beat. A rainbow plasma sheath of pixel flames, built from the contrail and vapor-cone kit in src/fx/Turbo.ts, and the sonic boom played in reverse. |
| 80 km | Coastline over Kashima-nada, the surf line, rice-paddy grids on the clipmap. Metro boxes of the Kanto sprawl rise; at night, a sea of urban glow. |
| 40 km | G2→G1, 1-2 km up. Lake Kasumigaura on the right; Skytree's needle ahead. Coarse regions stream in. Anything not baked yet is fog bank. |
| 10 km | Over the Sumida. Skytree slides past. The first painted districts (shared paint) glow as beacons. |
| 3 km | **Thread the Rainbow Bridge**: a dotted rainbow guide runs from Skytree down the Sumida to the bay and under the bridge. It is the bookend to threading the Golden Gate in the opening. The bridge's name is a gift: it is the arrival's first paint target. Then up past Tokyo Tower to Shibuya and Shinjuku. |

### 4.4 Landmarks to build (props owner; existing kits)

| Landmark | Notes |
|---|---|
| **Tokyo Tower** | red and white lattice, 333 m. Sutro's `LATTICE` + `BANDS` patterns already exist. |
| **Skytree** | 634 m tapered lattice with two observation rings. |
| **Rainbow Bridge** | suspension bridge. Bridges.ts already builds the GGB from real tower coordinates. |
| **Fuji** | terrain, not a prop: a 30 m DEM cone with a snow ramp above about 2,500 m in October (snow comes in mid-to-late October; the real date decides). It appears as an L5 silhouette prop until the clipmap reaches it. |
| Shibuya Crossing | ground-class authoring: zebra bands in the ground texture. |
| Shinjuku skyscrapers | from data. |

### 4.5 Tokyo identity (no new colors)

- **Light.** A late-October morning is often *aki-bare* (clear autumn air),
  and Fuji is most visible on cold mornings.
- **The grey city.** Tokyo's grey is white tile and concrete, not battleship
  grey: favour the GREY_LIGHT and WHITE ramps, ROOF_DARK for kawara tile, and
  WINDOW glow. City identity comes from which ramps get used, never from new
  colors.
- **Sound** (synthesized, AudioEngine): railway crossing bells (*fumikiri*),
  station chimes, crows, a temple bell; the canon progression modulates into
  a yo-scale pentatonic voicing on arrival.
- **Signs.** Neighbourhood and street names come from Overture `names`
  (`name:en`, or romanized). A pixel kanji/kana font (e.g. the 8×8 Misaki
  font; license still to be confirmed) would make the street sign gorgeous
  ("渋谷 SHIBUYA").

---

## 5. Navigation, manual and diegetic

The COMMON brief says "no HUD". Feat/controls added a minimal turbo and splat
HUD for touch mode (`?nohud` hides it). Navigation should honour the original
spirit.

1. **The departure signpost.** Above 2 km (G2 unlocked), a ring of green
   highway signs fans out around the bus: "TOKYO 8,275 →", "NEW YORK 4,130 →",
   "AMSTERDAM 8,800 →"... each at its real initial great-circle bearing.
   **Turning toward a sign and holding it for about 1 s picks the
   destination** (it flips like a split-flap board). That is all of the UI.
   It reuses the `StreetSigns` pixel font and sign mesh.
2. **The sky sign.** Every 30 s, or whenever you are more than 15° off the
   great-circle bearing, a sign hangs ahead in the sky for 2 s, placed in
   camera space with `snapCompensation` like the bus:
   "TOKYO 7,412 KM · 4 MIN · 9:02 AM SAT". Its arrow points along
   `bearing - heading`. ETA = distance / the current ground speed.
3. **The golden thread.** A dotted rainbow line of the remaining great circle,
   drawn as points on the cloud deck or ocean ahead: about 200 CPU-sampled dots
   in one `Points` draw, through the curve chunk. It rises off the horizon
   toward the destination, so following it is following the great circle.
   It fades when you're on course and brightens when you're lost.
4. **The eye.** The bus's one headlight-eye glances toward the destination when
   you're off course: a squint in that direction plus a little head-tilt of the
   bus. With sound off and nothing on screen, the bus still tells you where it
   wants to go.
5. **The rest.**
   - The compass math is plain float64 (WorldFrame).
   - No autopilot and no snap-to-route.
   - Real headwinds can drift you (§6), and the player corrects for them.
   - A tuner toggle shows a small compass ribbon for accessibility (off by
     default).

---

## 6. The 5-minute crossing: why it's fun, not empty

**Design principles:**

- Something to steer toward every 10-20 s.
- Altitude is a choice: **low and lively vs. high and fast**.
- Everything real for the day and route, so the world stays the real world.
- Every interaction is the core verb, painting, which also refuels the turbo
  (§7).

**Beat sheet at G3, departing SF at 17:00** (spawns are seeded per day):

| t | km | Beat |
|---|---|---|
| 0:00 | 0 | Leave SF at G1 over your own painted districts, then climb. The departure signpost. |
| 0:15 | 40 | **The Farallones**, 35 km off track. October is peak humpback and blue-whale season in the Gulf of the Farallones (real). Whale spouts and a breach. The first refuel. |
| 0:30 | 100-900 | G3 engages at 10 km over the **stratocumulus sheet** (the fog sea, continued). Cloud cells to paint with the firehose: rainbow stripes km long. Container ships in the SF/Oakland → Asia lane. |
| 1:10 | 2,100 | **Rainbow current**: a visible river of streaks; ride it for speed with no burn. The real jet stream, 10-12 km at 35-45° N, blows *against* you westbound: you see headwind streaks, and the choice is to duck under them or skim above. |
| 1:50 | 3,300 | The **storm track**: an Aleutian-low comma cloud. Cumulonimbus towers with lightning (glow flashes). Near-misses charge you; a direct hit stuns (drops a gear, sheds charge). On days the seed or GFS has one, a **typhoon** with an eye you can thread: the calm, clear well inside is a feat. |
| 2:36 | 4,675 | **The date line.** The sky flips a "page": a sweep of the TWILIGHT ramp across the sky, a chime, and the sign "WELCOME TO TOMORROW · SAT 24 OCT". |
| 2:50-3:40 | 5,100-6,600 | **Detour bait**: the Aleutian volcano arc sits 380-600 km north of the line, past the 10 km horizon but over the 30 km one. Climb and you see the snow cones on the right horizon. Bend north for volcano plumes (updraft boosts) and paintable lighthouses; the route is 1-3 % longer. |
| 4:00 | 7,600 | Kuril volcanoes and Hokkaido's Erimo cape on the right (395-485 km). Fuji pops over the horizon ahead. |
| 4:20-4:36 | 7,800-8,275 | The arrival (§4.3). |

**The content catalog:**

| Thing | Real basis | How it's drawn | Interaction | Reward |
|---|---|---|---|---|
| Cloud deck | Pacific stratocumulus, the storm track | resolve (`seaShade` generalized) | **firehose sweep** paints stripes into a sky-paint texture (2048² at 100 m, a clipmap around the bus, RGBA8, one dirty rect per frame) | +1 charge/s while painting |
| Cumulus / Cb | the convection climatology, or GFS | instanced lobes (3 draws) | breath paints a cloud: bloom; L2 = sunlit rainbow cloud; L3 = a **cloud palace** (MAGIC-SPEC's crowns on a cloud) | +6 / +10 / +15 |
| Container ships | the great-circle lanes between about 50 port pairs | instanced hull + container-stack block (each container a different hue on bloom) | paint: the stacks bloom into a rainbow of boxes (instant brand art) | +12 |
| Whales | seasonal hotspots (Farallones in October), random mid-ocean | instanced bodies; spouts = Particles | paint the **spout**, never the whale: a rainbow geyser sprays back, plus whale song (synthesized) | +10 |
| Rainbow currents | stylized; westbound headwind = the real jet (GFS 250 hPa when wired) | streaks (feat/controls speed lines) + a resolve band | fly aligned | +30 % speed, 0 burn |
| Storm cells | the storm track; typhoons (Western Pacific season runs into October) | instanced towers + glow flashes | dodge; near-miss | +15; a hit stuns |
| Volcanoes | Aleutians, Kurils | clipmap + plume puffs | updraft | +altitude, +speed |
| Albatross flocks | Laysan albatross range the North Pacific | instanced birds, a few px | fly through: they scatter (MAGIC-SPEC's murmuration kit) | joy |
| Ghost buses | other players crossing now (§8) | instanced, with contrail | **draft** behind a contrail | +15 % speed |
| Icebergs | **none on this route in October** | — | kept for the North Atlantic ("Iceberg Alley" off Newfoundland, April-June) and Antarctic routes, seasonally correct | — |

**Music** has a crossing arc: departure theme, open ocean (sparse, wide),
storm (percussive), date-line chime, arrival modulation. Every splat still
advances the canon, so painting clouds plays the crossing.

---

## 7. The turbo energy economy

**Why:** it ties the travel layer to the core verb, painting. Without it the
ocean is a separate game, and with it the ocean's objects mean something.

**Rainbow charge, 0-100**, shown diegetically:

- the belly band shows the splat;
- the **exhaust** shows the charge: a rainbow plume at full charge, grey puffs
  when low;
- the bus's struggle (`strain`, the wheeze) rises as charge falls.

The touch HUD's turbo lever can show it as a fill.

| Earn | Charge |
|---|---|
| each bloom (fresh) | +0.5 |
| each escalation | +1 |
| super-splat firehose (full) | +20 |
| ocean objects | §6 table: +6 … +15 |
| firehose over the cloud deck | +1/s |
| rainbow current, drafting | no burn |

| Spend | Burn |
|---|---|
| G0, G1 | free (city gears) |
| G2 | 0.15 / s |
| G3 | 1.0 / s at 10 km, ×0.8 at 30 km (thin air), with speed ×1.25 at 30 km |

**What the numbers give:**

- A full tank is about 100 s of G3, about 3,000 km.
- The crossing needs about 276 charge, so you **must refuel about twice
  mid-ocean**. A good crossing paints 8-12 things and arrives with charge to
  spare.
- Filling up in SF takes 2-3 minutes of painting (about 12 blasts at 15
  blooms each, plus escalations).
- **The loop: dolphin flight.** Climbing is fast and cheap, but the fuel is
  low down. So you dive to the cloud tops, ships and whales to refuel, then
  climb to cruise.
- **Empty tank = "struggle mode", not a fail.** G3 decays to G2 speed, and the
  bus sputters, backfires and wheezes: it is the struggle bus. G2 is free
  while empty, but Tokyo is then about 30 min away. **Any paint brings G3
  back.**
- **First crossing:** start with a full tank and a guaranteed whale and ship
  in the first minute (onboarding).
- **Knobs:** `config.turbo.charge*`, every rate in the tuner. The offline sim
  (§9) plays 100 seeded crossings to tune the expected arrival charge.

---

## 8. Server side for many players

```
 phone ──HTTPS──▶ Cloudflare CDN ──▶ R2   (immutable, content-hashed)
   │                                   w/{bake}/{zone}/{rx}_{rz}.bin   region tiles (SBB4/SBT)
   │                                   metro/{bake}/{zone}/{cell40}.bin
   │                                   planet/{ver}/{layer}/{z}/{x}/{y}.bin
   │                                   paint/{zone}/{cell8}@{hour}.bin  hourly paint snapshots
   │
   ├──HTTPS──▶ Worker  api/manifest, api/cities, api/bake (enqueue), auth
   │
   └──WSS────▶ Durable Object  Cell(zone, cell8)        authoritative paint + low-altitude presence
               Durable Object  Sky(level-5 cell, ~1,000 km)  presence above 2 km (ocean lanes)
                     │  write-behind (30-60 s): SQLite rows = one blob per 1 km region
                     └─ hourly: snapshot blob → R2 (CDN-cacheable cold loads)
```

**Static data.** Every file is immutable under a content hash, so the CDN TTL
is forever and only the small manifests are short-lived. R2 has no egress
fees. A million players streaming cities costs bandwidth Cloudflare doesn't
bill as egress, plus storage of about $15 per TB per month. Verify current
pricing before committing.

**Paint cells**: one Durable Object per 8 km × 8 km square of the UTM grid (64
regions). Tokyo's 23 wards are about 10-14 cells; SF is 4-6. DOs exist only
where someone has painted.

**Protocol**, binary over hibernating WebSockets:

- `hello {player, pos}` → the cell sends the paint deltas since the client's
  hourly snapshot, then live deltas.
- `blast {seq, spec, targets[], hues[], levels[], groundTiles[]}` from the
  shooter.
  - `spec` is today's `BlastSpec`, already "a flat number array when saved".
  - `targets` are 64-bit GERS hashes.
- `pos {x, y, z, heading, gear}` at 4 Hz; the DO relays to the nearest 30.

**Authority: the shooter computes, the server validates and orders.** Splatter
already picks targets, deals hues and escalates on the client. The shooter
sends the result. The DO checks it:

- a plausible position against the shooter's recent `pos` track;
- the belly recharge and super-splat cooldown timing;
- the targets lie within `blastRadiusFor(drop)` + `smallRad` of the impact;
- rate limits.

Then it assigns a sequence number, applies the result and broadcasts it. Two
blasts on the same building within a tick resolve by sequence: the later one
escalates. Your own blast always looks right instantly, and nobody else's ever
flips. Hardening later, if abuse appears: the DO fetches the region bin itself
and recomputes picks with the same TS modules (`blastLayout`, the picking
code). That needs blastLayout's texel decisions to use LUTs and integer hashes
rather than `Math.sin/exp`, which can differ between V8 and JavaScriptCore.
`SHAPE_LUT` is already most of the way there.

**Ground paint.** The DO keeps each tile's settled mask, the same RLE format as
`encodeMask` today, rasters every accepted blast once (about 1-3 ms in JS,
with the slicing), and broadcasts the spec. Clients raster live blasts
locally. Snapshots make tiles converge on load. This is the existing
"settled result, not the history" decision, moved server-side.

**Cost model** (100k concurrent players, one blast per 2 s each = 50k blasts/s;
rough, using public list prices; verify before committing):

| Item | How it's billed | Cost |
|---|---|---|
| incoming blasts | WS messages, billed at 20:1 under hibernation | ~$30/day |
| presence | 4 Hz pos is ~400k messages/s, ~$260/day; 2 Hz with dead reckoning and only while moving | ~$130/day |
| DO duration | a busy cell never sleeps: 0.125 GB × 86,400 s ≈ $0.135 per cell-day; ~5,000 busy cells | ~$675/day |
| storage writes | **the trap** (see below) | tens of $/day with blobs |
| **total** | | **~$0.8-1k/day ≈ $0.25-0.30 per concurrent player per month** |

Storage writes are the trap. One row per building at about 1M rows/s would be
about $86k a day. **Write-behind per-region blobs every 30-60 s** is about
20k dirty regions a minute, about $30 a day. The design rule: **the DO's
memory is the state; storage is a checkpoint.**

**Hot spots.** A viral cell, say thousands of players at Shibuya:

- broadcasts are batched at 10 Hz;
- presence is capped at the nearest 30 ghosts;
- relay DOs fan out to about 500 sockets each;
- a cell can split 2×2 into 4 km children under load, the parent keeping a
  routing table.

**Ids.** Paint is keyed by `(regionKey, gers64)`. Each monthly Overture release
ships a GERS changelog. A migration job moves paint across splits (both
children inherit) and merges (the max level wins) before the new bake goes
live. Clients' old localStorage is migrated by the same table, published as a
small file.

**Clock.** `uTime` and `bloomTime` stay session-relative f32. Never put epoch
time in a shader: f32 resolution at 86,400 s is 8 ms, already a stutter. A
remote blast blooms at `now + arrivalDelay` on receipt, so no clock sync is
needed for visuals.

**Identity and abuse.** Anonymous device keys first, accounts optional.
Painting is additive, so the real grief vector is **saturation**: a bot, or
simply a popular city, painting everything until no grey is left, which kills
the core loop there. Proposal:

- **Weathering.** Shared L1 paint fades back to grey over about 3 days unless
  re-hit, L2 over about 7 and L3 over about 30. The Grey is the antagonist,
  and it creeps back.
- **A personal layer.** Your own paint stays forever in your view (today's
  localStorage, kept), rendered over the shared layer.

This is a producer decision (§11).

---

## 9. Phased plan

Estimates are engineer-weeks (ew) for one senior engineer, beauty QA included,
assuming the shot tools and the offline sim. Tracks marked ∥ run in parallel
with each other.

| Phase | Deliverable | Effort | Key risks |
|---|---|---|---|
| **W0 Spikes** (1-2 wks) | WorldFrame precision sim (8,000 km, every rebase hook); planet resolve prototype on `dev/world.html` (ocean, limb, curvature at 2 / 10 / 30 / 50 km, screenshots); Tokyo 3×3 km bake from Overture + Copernicus with the heights ladder; producer decisions §11 | 3-4 ew | none blocking; this phase exists to retire risk |
| **W1 "Leave SF"** | `?world`: G2/G3 unlocked, edge homing off. Planet layer v1 (analytic ocean + land, clipmap, coast SDF), corridor planet bake, `GLSL_CURVE`, adaptive near/far, `pipeline.rebase`, Sky.ts sun (session golden band), stars, limb, SF unloads at 40 km. You can fly to an empty, beautiful Japan. | 6-8 ew | rebase pops; strobing glitter at G3; resolve cost on A15 |
| **W2 The crossing** ∥ | departure signpost, sky sign, golden thread, the eye, ETA, the date line, nautical time; cloud deck from the weather map; instanced clouds, ships, whales; rainbow currents; storms; charge economy v1; crossing music arc; per-day seed | 6-8 ew | monotony; tuning (offline sim) |
| **W3 Tokyo** ∥ | UTM zone bake + SBB4 + GERS ids (with feat/osm); Tokyo bake (B-grade, PLATEAU → A-grade when obtained); Skytree, Tokyo Tower, Rainbow Bridge, Fuji; metro L4 layer; the arrival beat sheet; Tokyo light, sound, signs; the fog-bank-for-uncharted | 6-10 ew | PLATEAU access; heights quality; landmark beauty |
| **W4 Every city** | Overture re-partition in R2; on-demand bake service (containers); global planet pyramid; global metro layer; `cities.json`; tier-1 hero list; automated beauty sampling (shots of 200 random cities, flagged by heuristics); real night art; real-UTC sun | 8-12 ew + compute | data quirks worldwide; QA can't scale (hence the tiers) |
| **W5 Many players** | Workers + DOs (Cell, Sky), protocol, snapshots, presence and ghosts, drafting, weathering, GERS migration, load test (10k simulated clients), abuse limits | 8-12 ew | cost of storage writes (blobs); hot cells; saturation |

**Totals.**

- **First playable SF→Tokyo (grey Tokyo, solo): W0-W3, about 21-30 ew**, or
  about 8-10 calendar weeks on three tracks (render/world, game/content,
  bake/data).
- **Everything: about 40-55 ew.**

### What to build first in this repo, in order

None of this is done yet. Each step is safe on its own and keeps today's look
until its flag turns on.

1. **`src/game/WorldFrame.ts`** (game glue; pure TS):
   - WGS84 ↔ UTM (Krüger series; geo.ts already has Snyder's tmerc series) ↔ render
     frame;
   - great-circle distance, bearing and interpolation;
   - the rebase event bus;
   - unit checks in node: round-trips < 1 mm, bearings against the numbers in
     §2.3.
   About 1 ew.
2. **`tools/world-sim/`** (in the pattern of `tools/feel-sim`): flies the real
   `Flight` + `TurboDrive` + `WorldFrame` from SF to Tokyo at 30/60/120 fps.
   - Asserts: path length within 1 % of the great circle when flown straight;
     no position jump across a rebase (< 1 mm); heading continuous across zone
     switches; ETA accurate.
   - Later it also plays the charge economy.
   About 1 ew.
3. **`src/game/Nav.ts` + `src/game/Sky.ts`**: destination, bearing, ETA,
   nautical time, the date-line event; NOAA sun, sidereal time, moon phase,
   writing `globals.uSunDir` in world mode. About 1 ew.
4. **Render owner (shared files):**
   - `pipeline.rebase(R, T)` with the lattice offset (plus the shadow camera);
   - adaptive near/far;
   - the resolve's planet branch behind `uPlanet` (0 = today's pixels
     exactly): paraboloid hit, ocean, limb, NIGHT_SKY zenith;
   - `GLSL_CURVE` with `uCurve.z = 0` by default;
   - the new ramps.
   Every other owner then adds `sbCurve()` to their vertex shaders. About
   2-3 ew.
5. **`tools/bake/planet.py`** (bake owner): GLO-90 + Terrain Tiles bathymetry
   + WorldCover + Overture land/water → `public/planet/` for the corridor
   (California, the North Pacific, Japan) at z0-z9, in RG8/R8 tiles. About
   1.5 ew.
6. **`src/world/planet/`** (new module): the atlas streamer (one tile upload
   per frame) and the clipmap. About 1.5 ew.
7. **`dev/world.html`** + main.ts glue behind `?world&dest=tokyo`:
   - unlock G2/G3 (`config.turbo.worldTravel`);
   - disable `edgeFade` and the edge homing;
   - unload SF beyond 40 km;
   - the sky sign through `StreetSigns`;
   - QA hooks: `__qa.teleport(lat, lon, alt)`, `__game.nav()`.
   - Shots at 2/10/30/50 km and of the date line, through `tools/shot.mjs`
     when the machine is free.
   About 1 ew.

Total: **about 9-10 ew of which 6-8 is the critical path**. The result: fly
SF→Tokyo over a real, curved, lit planet to an empty Japan. Tokyo (W3) and the
crossing content (W2) then go in parallel.

---

## 10. Risks register

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| One-frame pops at rebase (lattice, shadows, particles, trails, noise) | high / high | the lattice offset; `uNoiseOrigin`; every hook in world-sim; frame-diff across rebases (`tools/shimmer.py`) |
| Ocean glitter and cloud detail strobing at 10-25 px/frame at G3 | high / medium | cells larger than per-frame motion; motion-stretched streaks; calm mode; frame-sequence QA |
| Four empty minutes | medium / high | §6 beat density; per-day seeds; offline pacing stats (time between interactables ≤ 20 s at p90) |
| Heights missing worldwide (Tokyo: 84-88 % untagged) | certain / medium | the heights ladder; PLATEAU for Tokyo; hero tier |
| PLATEAU unreachable here (403) | certain / medium | fetch on another machine or get an allowlist entry; B-grade Tokyo meanwhile |
| A15 cost: resolve planet branch, clipmap vertex texture fetch, memory (atlases ~20-30 MB) | medium / high | shadows off above 2 km; land-only rings; budgets in §2.6; perf captures on a real phone (SwiftShader is not a perf oracle) |
| iOS texture limits (no linear float or 16-bit) | certain / low | RG8 heights with manual bilinear; R8 classes |
| On-demand bake latency or failure | medium / medium | the crossing hides it; fog-bank fallback; retry with backoff (the existing LOD backoff) |
| Zone-seam mismatch in rural areas (~0.1-1 m) | low / low | metros bake in one home zone; seams only in the countryside |
| Server write costs | high if naive / high | per-region blobs, write-behind, memory as state |
| Saturation of shared paint | high / high | weathering + personal layer (producer call) |
| Licensing (ODbL share-alike, PLATEAU, Copernicus, WorldCover attribution) | certain / low | DATA_LICENSE.md pattern; opening credit; the tuner |
| Scope ("every city") swamps beauty (rule #1) | high / high | three tiers; only tier-1 gets hand QA; uncharted is fog, never ugly |
| Night art is a big art task | certain / medium | session golden band until W4; night is blue hour, never black |

---

## 11. Producer decisions needed

1. **Curvature.** Real (≈ 2-5 px of horizon curve) or exaggerated (R/3-R/4 at
   20 km+, ≈ 7-10 px)? I recommend exaggerated, mildly.
2. **Sun.** A session golden band now, real UTC later (recommended)? Or real
   UTC from W1, which means night art first?
3. **Charge economy.** Yes, with "struggle mode" at G2 when empty
   (recommended)? Or free gears?
4. **Shared paint permanence.** Weathering plus a personal layer
   (recommended), or permanent?
5. **A HUD exception for navigation.** Diegetic sign, thread and eye only
   (recommended), with the compass ribbon as an accessibility toggle?
6. **PLATEAU.** Who can fetch it (it is blocked here), and are we comfortable
   with its attribution in the opening credit?
7. **Hero city list after Tokyo**, and whether Amsterdam (already baked on
   feat/osm) joins as the second destination for the Atlantic or Europe
   route (icebergs live there).
8. **Real-time weather (GFS) and real jet-stream headwinds.** Ship them as
   "the world is the real world today", or keep the weather stylized and
   seeded?

---

## Appendix A: numbers

- **SF → Tokyo great circle:** 8,275 km. Initial bearing 303.4°, final 234.4°,
  maximum latitude 48.7° N. Crosses the date line at 48.2° N, 4,675 km out.
- **Nearest land off the track:**

  | Place | Off track | Along the route |
  |---|---|---|
  | Farallones | 35 km | at 41 km |
  | Point Reyes | 18 km | at 41 km |
  | Cape Mendocino | 157 km | — |
  | Adak (Aleutians) | 379 km | — |
  | Hokkaido Erimo | 395 km | — |
  | Shikotan / Iturup (Kurils) | 418 / 485 km | — |
  | Choshi | 61 km | at 8,192 km |
  | Haneda | 18 km | — |
  | Mt. Fuji | 90 km beyond Tokyo | — |

- **Crossing time:** G3 (30 km/s) 276 s; G2 (4.5 km/s) 30.6 min; G1
  (450 m/s) 5.1 h.
- **Distance per frame at G3:** 500 m at 60 fps, 1 km at 30 fps; 250 m per
  flight substep (1/120 s).
- **Horizon distance and dip** (real R):

  | Altitude | Horizon | Dip |
  |---|---|---|
  | 150 m | 44 km | 0.39° |
  | 2 km | 160 km | 1.44° |
  | 10 km | 357 km | 3.21° |
  | 20 km | 505 km | 4.53° |
  | 30 km | 619 km | 5.55° |
  | 50 km | 800 km | 7.15° |

- **Overture 2026-10-21.0 buildings:** 2,533,842,612 in 512 files and 84,224
  row groups. Japan about 72 M, Kanto about 12 M, Bay Area about 1.9 M
  (counting only row groups wholly inside each box).
- **SF today:** 140,961 buildings, 19.7 MB, about 140 B per building.

## Appendix B: data sources, checked from this machine on 2026-10-23

| Source | Use | Reachable | License |
|---|---|---|---|
| Overture Maps 2026-10-21.0 (s3 overturemaps-us-west-2) | buildings, streets, land, water, names, GERS ids | **yes** (used) | ODbL 1.0 (OSM) / CDLA / CC BY per source |
| Copernicus GLO-30 / GLO-90 (s3 copernicus-dem-30m / -90m) | DEM (a DSM), Fuji, Kanto | **yes** (HTTP 200) | free with attribution (DLR / Airbus, Copernicus) |
| ESA WorldCover 10 m v200 (s3 esa-worldcover) | land class for the planet layer | **yes** | CC BY 4.0 |
| AWS Terrain Tiles (elevation-tiles-prod, terrarium) | global DEM + bathymetry pyramid | **yes** | open, with a source attribution list |
| NOAA GFS 0.25° (s3 noaa-gfs-bdp-pds) | real clouds, precipitation, jet stream | **yes** | public domain |
| NOAA Himawari-9 / GOES-18 mirrors | real cloud imagery (optional) | **yes** | NOAA open data (check JMA terms for Himawari) |
| USGS 3DEP DEM + LiDAR | US hero cities | yes (in use) | public domain |
| PLATEAU (geospatial.jp, mlit.go.jp, PLATEAU CMS assets) | Tokyo heights, LOD2 | **no: 403 at the proxy** | CC BY 4.0-compatible, attribution |
| Yale Bright Star Catalog | stars | not checked (tiny; can be vendored) | public domain |
| GHS-BUILT-H (JRC) | height prior worldwide | not checked | CC BY 4.0 |
| GSI DEM 5 m (Japan) | Tokyo terrain | not checked | GSI terms, attribution |
