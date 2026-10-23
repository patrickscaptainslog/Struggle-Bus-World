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
  nearest building, so aim is forgiving); first impact ~0.4 s after the tap;
  4 frames of hit-stop (was 2; see Explosive blast). The impact lands
  mid-screen, where the chase camera can see it (a straight-down barf was
  hidden by the bus's own body).
- **Aim cue without a HUD**: while a breath is loaded, the building in the line
  of fire glints with a slow sweep of light.
- ~~Smart spill + Painted Ladies fan~~ (superseded by the explosive blast, below):
  the splat used to paint the target plus at most 4 *unpainted* neighbors one by
  one. Paint is still saved per building (smart persistence) and the blast's
  center still takes the next hue.
- **Re-splat escalates**: level 1 full bloom → 2 rooftop garden → 3 Hundertwasser.
- **Telephoto vista camera** (24° horizontal FOV, 175 m back) that tilts toward a
  diorama when slow and levels toward the horizon when surging.
- **Late-afternoon sun through thin fog** instead of flat light: flat light makes
  low-res 3D melt into one grey. Painted neighborhoods thin the fog above them.
- **No HUD.** Belly glow = recharge. Place names appear on a diegetic street sign.

## Explosive blast (producer: "too conservative, cover multiple buildings at once")
- **One real explosion.** Every building the blast reaches (its footprint, not
  its centroid: a big block half inside blooms too) blooms when the shockwave
  gets to it. Base radius **60 m** (the brief said ~55; at the Painted Ladies,
  where half the circle is Alamo Square park, 55 m reached exactly 15 houses, so
  we took a little margin), capped at 40 buildings (the cap scales with the
  radius). The shockwave leaves at 300 m/s and decelerates exponentially toward
  1.65 x the radius, so the near ring pops almost at once and the whole base
  blast lands in ~0.3 s: it reads as a blast, not a cascade.
- **Painted buildings escalate instead of being skipped** (L1 bloom, L2 rooftop
  garden, L3 Hundertwasser), keeping their hue. They stay painted while the wave
  travels to them (PaintState `keep` flag on the GPU texel; never saved), then
  re-pop.
- **Hue layout: pinwheel, by screenshots.** Pinwheel (12 rainbow sectors around
  the impact with a slight swirl), rings by distance, and a spiral of both were
  shot from the chase camera and from straight above (tools/blast.mjs layouts).
  Rings read as a 3-hue bullseye (a 60 m blast only holds ~3 rings); the spiral
  was noisy; the pinwheel shows all six hues from both views. Buildings take the
  pinwheel hue **shifted one step** and the ground paint sits **one ramp step
  deeper** than sunlit roofs, so a house never melts into the splat around it.
  Touching neighbors never share a hue (greedy pick of the nearest free hue).
- **The ground gets splattered** (streets, sidewalks, parks; trees standing in the
  paint bloom). A per-terrain-tile RGBA8 mask on the tile's own 2 m class grid,
  created only when paint lands there; the shader reads coverage bilinearly
  through a noise warp with a noise threshold (organic edges, a darker rim, wet
  highlights), hue from the strongest tap. The splat is a lumpy blob with
  splash rays; spatter dots beyond the edge, most of them made by flung paint
  blobs that land exactly on them. Persisted as the **blast list** (16 numbers
  per blast) under `strugglebus.ground.v1`, redrawn deterministically (seeded)
  as tiles stream in; capped at 1500 blasts (oldest wash away). The building
  paint key `strugglebus.paint.v1` is untouched.
- **Ground paint is drawn while the projectile flies** (a few rows per frame,
  hidden by a per-texel reveal time) and lands with one texSubImage2D per touched
  tile; already-painted ground changes hue only at impact, under the flash. The
  whole building wave is also written at impact (one upload, future bloom
  times), and PaintState now uploads its dirty rectangle in one call instead of
  one call per texel.
- **Impact drama:** a rainbow shockwave ring evaluated in the terrain and roof
  shaders (no extra draw calls; it dissolves into pixels, never alpha), a
  one-frame palette flash in the resolve pass (white-hot near the blast, two or
  three steps lighter elsewhere; never a free color), a camera kick that rings
  down in 0.25 s (translation along the camera's own up/right axes only, so the
  pixel-grid snap still holds: no shimmer), 4 hit-stop frames, a rainbow paint
  fountain, flung blobs on snappy high-gravity arcs, sparkle crowns on every
  bloom. Particle pool 6000 -> 8000.
- **Sound:** a deep boom (sub drop + phone-speaker body + rumble tail) layered
  under the wet splat; the blooms ring as ONE fast arpeggio of the next chord,
  capped at 6 notes 55 ms apart, so a 40-building blast stays musical.
- Painted tree crowns no longer tint their shadow side into the darkest warm
  steps (a whole orange cypress read brown); the tint stays mid-ramp.
- **Cost** (A/B against the pre-blast build c35a39d, 3 alternating runs each,
  CPU work per frame on the shared SwiftShader host, median / 90% trimmed
  mean): grey hover 3.1 / 3.1 ms (base 3.3 / 3.9), during a blast 3.4 / 3.8 ms
  (base 3.6 / 3.9), settled 3.5 / 3.7 ms (base 2.9 / 3.2), escalating blast
  3.6 / 3.9 ms (base 3.3 / 3.3); draw calls identical (140 / 147 / 148, no
  per-building draws); triangles +19k after an escalation (more rooftop
  gardens). The impact frame does ~0.5 ms of ground work (the raster runs
  during the flight) plus the particle burst. Offline audio check passes
  (peak 0.80, no clipping).
- **Known:** the first blast of a session compiles the street sign's shaders
  and the first escalation the rooftop-garden shaders (pre-existing hitch, now
  more visible because every blast escalates many buildings at once). Pre-warm
  them at boot (renderer.compile on hidden instances) in a follow-up.

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
