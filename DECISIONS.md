# Decisions log

Rule #1 is beauty. Where the brief was silent (or the environment forced a
call), this is what we chose and why.

## Producer-approved feel (from the kickoff Q&A — "agree with everything")
- **Struggle, then release.** A full belly makes the bus sag, wheeze and wallow;
  barfing is relief: recoil up + a speed boost that fades over ~2.6 s.
- **Floating bungee controls.** Touch anywhere; the stretch from the touch-down
  point steers (sideways = carve/bank, up = surge, down = hover). The bus sits
  above the thumb zone. Tap = splat; a second finger tap while steering also splats.
- **Two gears.** Released = dreamy cruise (30 m/s); full upward stretch = 112 m/s
  (~90 s across SF). Altitude auto-follows roofs 2–3 stories up, rises early
  over hills with hang time after crests, and soft-steers around towers that are
  much taller than the bus instead of yanking it up and over.
- **Dragon-breath splat** (producer's call, replacing the dive-bomb): the tap
  squashes the bus on the same frame, then it rears back (nose up, recoil slows
  it to half speed) and blasts a rainbow projectile forward out of its face. It
  explodes on the building ~60–105 m ahead (farther at speed, snapping to the
  nearest building, so aim is forgiving); first impact ~0.35 s after the tap;
  2 frames of hit-stop. The impact lands mid-screen, where the chase camera can
  see it (a straight-down barf was hidden by the bus's own body).
- **Aim cue without a HUD**: while a breath is loaded, the building in the line
  of fire glints with a slow sweep of light.
- **Smart spill + Painted Ladies fan.** The building under the shadow is always
  painted; paint spills only onto *unpainted* neighbors (so Phase 2 pixel art is
  never overwritten); the primary takes the next hue, neighbors take adjacent hues
  by side of the street.
- **Re-splat escalates**: level 1 full bloom → 2 rooftop garden → 3 Hundertwasser.
- **Telephoto vista camera** (24° horizontal FOV, 175 m back) that tilts toward a
  diorama when slow and levels toward the horizon when surging.
- **Late-afternoon sun through thin fog** instead of flat light: flat light makes
  low-res 3D melt into one grey. Painted neighborhoods thin the fog above them.
- **No HUD.** Belly glow = recharge. Place names appear on a diegetic street sign.

## Data
- **DataSF and the USGS elevation APIs are blocked by this environment's network
  policy.** We used sources that are reachable *and* license-clean (public domain):
  - Terrain: **USGS 3DEP 1 m DEM** (2023 SF lidar project), read straight from the
    USGS S3 bucket.
  - Buildings: **FEMA/ORNL USA Structures** (public domain, lidar-derived heights,
    occupancy types). No OpenStreetMap anywhere.
- USA Structures merges attached row houses into one polygon per row (sometimes a
  whole block). The bake **splits rows into ~25 ft (7.6 m) lots** along the
  street frontage (real SF lot width), with deterministic per-lot height jitter.
  The pipeline keeps a swap-in point for DataSF footprints + Assessor year-built
  once `data.sfgov.org` is allowed; that will replace the synthetic lot lines with
  real ones.
- Merged blocks sometimes carry a block-wide height (one Painted Ladies block came
  in at 23 m). For big merged residential polygons we use the median height of
  nearby single-house footprints instead.
- Building style comes from occupancy + size + district (Sunset/Parkside/Outer
  Richmond/Excelsior → stucco row houses; Marina → Mediterranean; everywhere else
  narrow residential → Victorian). Assessor year-built would be better; blocked.
- USA Structures has no addresses for SF, so the street sign shows the
  **neighborhood** name for now (hand-placed centroids for ~50 neighborhoods).
  Real street names/addresses come with DataSF EAS.
- Streets/sidewalks/parks are derived: sidewalk = 3.5 m band in front of
  buildings; park/lawn = ground more than 17 m from any building; water = DEM
  nodata / sea level.

## LiDAR rooftops (skyscrapers with their real shapes)
- The footprint data has one height per building, and downtown it is badly
  wrong: Salesforce Tower is simply missing, 555 California is 209 m instead of
  ~237, most towers read 50-80 % of their height, whole blocks share one number.
  The **USGS 3DEP point cloud** (CA_SanFrancisco_1_B23, 2023, Entwine Point Tile
  on the public S3 bucket, public domain) fixes that. Its vertical datum is the
  DEM's (ground returns match the 1 m DEM to 0.0 m median), so height above
  ground is a straight subtraction. It has no building class (only 1, 2, 7, 18),
  so we keep first returns minus noise.
- **Fetched only what the bake needs** (`tools/bake/lidar.py`, city-agnostic,
  driven by `"lidar"` in the city json): octree nodes to depth 6 (~2 pts/m²)
  under every 128 m chunk with a building -> a 2 m max-height raster city-wide;
  nodes to depth 7 (~9 pts/m²) around footprints >= 25 m and inside two downtown
  boxes (FiDi, Rincon, Union Square, SoMa, Mission Bay) -> 1 m. 4,099 nodes,
  153 M points, 1.36 GB, ~7.5 min, cached in `tools/bake/.cache/lidar/`
  (`$SB_LIDAR_CACHE`); rasters cache as 36 MB of npz. A re-bake re-downloads
  nothing; the bake now takes ~9-14 min instead of ~5 (the massing pass).
- **Every building's height** is now its median rooftop above its mean ground
  (138k of 141.5k corrected; 27.5k moved by more than 3 m; the median house got
  0.9 m taller: the FEMA heights ran ~14 % low). Median, not max: gables and
  parapets are drawn by the mesher, antennas and overhanging trees don't count.
  Footprints that read as bare ground keep their old height (demolished since,
  or misregistered).
- **Tiers** for anything >= 25 m (and >= 18 m downtown): the footprint's
  area-vs-height curve gets an optimal k-piece fit, each piece a flat step
  (setback, podium, crown, penthouse) or a ramp (a taper), smallest k within
  3.5 % of the LiDAR volume, at most 6 tiers / 12 parts (towers >= 40 m; mid-rises
  get at most 3 tiers within 7 %: their roof gardens and HVAC made melted-clay
  lumps). Outlines are polygonized from the height masks, opened 3 m (no
  slivers, antennas, parapet rings), simplified 1.2 m, edges within 14° of the
  building's grid squared up and raster-chamfered corners made square again,
  clipped to the tier below. 589 buildings got 1,680 parts.
- **Tapers are a per-part byte, not more steps**: with steps only, Salesforce
  Tower was a wedding cake; with a taper it is the obelisk. Only towers >= 60 m,
  runs >= 25 m, >= 20 % area loss, and a ramp that fits at least twice as well as
  a flat step (facade noise never tapers). A face leaning more than ~35° is
  drawn as a sloped roof, not a wall: a window grid on a crown read as noise.
- **Towers (>= 40 m) take their outline from the LiDAR** (footprints are rough,
  1-3 m offset envelopes; 555 California's serrated plan only exists in the
  point cloud): within 2.5 m of the footprint, never onto a neighbor, kept only
  when it agrees with the footprint (IoU >= 0.65); 354 of them. Lower buildings
  keep their clean footprint edges.
- **Towers missing from the footprints are added** from the 1 m raster
  (>= 20 m, >= 300 m², compact, not a deck or a ramp; thresholds rise until a
  tower fused to a transit-center deck separates): 10 citywide, Salesforce
  Tower and Park Tower among them.
- **Merged commercial blocks split** along LiDAR height jumps (>= 4 m) into
  compact pieces (222 blocks -> 573 buildings), so a splat paints one building
  of the block and the Painted Ladies fan works on them instead of one flat slab.
- **Paint identity**: every part of a building shares its paint texel and
  stableId (a splat blooms the whole tower, saved paint stays valid). Existing
  stableIds never move (all LiDAR work happens after the ranking; new pieces and
  towers get ids after the old range; `tools/check-stable-ids.mjs` verifies:
  141,156/141,156 kept, 361 added). The biggest piece of a split block keeps its id.
- **The color floods from the top of the whole tower** (not from each tier's
  roof), and the pop squashes about the tower's ground, so tiers never crack
  apart. Street furniture (stoops, bays, belt courses, gables, chimneys) only on
  tier 0; rooftop clutter only where a roof is open to the sky; no parapet where
  the tier above rises flush from the edge (it would z-fight).
- **Cost**: draw calls unchanged (the parts live in the same per-tile meshes);
  the FiDi chase view goes from ~636k to ~780k triangles (+23 %: 327 tiered
  towers in the five downtown regions cost ~126k), the Alamo Square regression
  view from 1.10M to 1.17M (houses got taller, so more walls get a second row of
  wobble quads). CPU work per frame is unchanged within SwiftShader noise.
  Data: public/city/sf 19.7 MB (was 19.2), largest region 198 KB, far.bin
  394 KB (boxes per part).
- **Landmark props are not doubled**: the footprints under Sutro Tower (94 m)
  and the Transamerica Pyramid (97 m) were extruded inside the props; within a
  landmark's `clearRadius` footprints are capped at 8 m and never LiDAR'd, and
  LiDAR-only detection keeps away from landmarks and bridge decks.

## Rendering
- **Indexed-color pipeline.** Materials output a ramp index + light level, never
  RGB; the resolve pass picks ramp steps with ordered dithering. Mixing is done
  by dithering, so overlapping paint *can't* go brown, and there is no brown in
  the palette. Warm hues shadow toward rose/violet.
- **Dither only on gradients.** Flat surfaces whose light sits on a step boundary
  snap instead of dithering (no checkerboard walls).
- **Fog = atmospheric perspective first**, then a narrow dithered handover to the
  fog ramp — no sprinkle of fog dots up close.
- Shimmer: camera translation snapped to the game-pixel grid at the focus depth,
  sub-pixel remainder applied at upscale; dither anchored to the snapped grid;
  telephoto lens to minimize parallax; shadow map snapped to its texel grid;
  outlines fade with distance.
- The bus does not cast a sun shadow (with a low sun it would land 40 m away);
  it casts a straight-down **drop shadow**, which is the aim reticle.
- City streaming: 1 km gzip region bundles (17 MB for all of SF), inflated and
  meshed in a worker; buildings are generated on the phone from compact
  footprints (far smaller than shipping meshes); far skyline = boxes for every
  building ≥16 m + a 64 m terrain grid, hidden under loaded tiles.

## Opening + landmarks
- **The opening is the brief's shot**: the bus glides out of a fog bank over the
  ocean west of the Golden Gate, threads the gap 85 m north of the south tower
  (so the tower fills the narrow portrait lens), passes under the deck on a low,
  level cinematic camera, then rises into the normal chase view over the bay.
  The fog bank doubles as the loading screen.
- Golden Gate Bridge and Bay Bridge (west span) are hand-built from real tower
  and anchorage coordinates; Sutro Tower and the Transamerica Pyramid are props.
  They stay grey (landmarks aren't paintable in Phase 1).
- The horizon (Marin Headlands, East Bay hills, San Bruno Mountain) comes from
  the USGS 3DEP 1/3 arc-second DEM, read remotely from the COG's overviews; the
  Marin Headlands near the bridge are baked at 2 m from the same DEM so the
  opening never shows low-poly hills up close.
- Trees: none on steep grassy hills (Twin Peaks, Bernal, the Headlands are bare).

## Logistics
- The GitHub connection can't create repositories (403), so the project lives in a
  local repo until `patrickscaptainslog/struggle-bus` exists.
- No deploy credentials in this environment: preview is published as a claude.ai
  artifact; the real Home Screen build deploys from the repo (Vercel).
