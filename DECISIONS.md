# Decisions log

Rule #1 is beauty. Where the brief was silent (or the environment forced a
call), this is what we chose and why.

## Producer-approved feel (from the kickoff Q&A — "agree with everything")
- **Struggle, then release.** A full belly makes the bus sag, wheeze and wallow;
  barfing is relief: recoil up + a speed boost that fades over ~2.6 s.
- **Floating bungee controls.** Touch anywhere; the stretch from the touch-down
  point steers (sideways = carve/bank, up = surge, down = hover; down is now
  the yoke's climb, see Altitude). The bus sits above the thumb zone.
  Tap = splat; a second finger tap while steering also splats.
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

## Altitude (producer: "I want the bus to go up, high enough to view everything")
- **Yoke on the same thumb.** Pull the thumb down = pull back = climb (up to
  40 m/s, easing the speed toward 15 m/s: it trades speed for height). Push up
  = nose down: above the rooftops it dives (48 m/s, flaring out at 16 m/s² so
  it never digs into the roofs) while surging; at the rooftops it surges as
  before. Release = hold the chosen altitude with a gentle two-tone bob. The
  coast after a release is aimed (y + vy / 2·holdGain) so the critically
  damped hold never bounces back. A 14% vertical dead band keeps sideways
  carving from climbing. The old "pull down to hover" is gone.
- **The automatic floor is untouched.** Released at the bottom the bus runs
  the classic model (look-ahead, early rise, hang time, tower avoidance, the
  hard floor). A held altitude only ever adds height on top of it; a dive
  that reaches the floor hands back to it; a bridge deck overhead lowers the
  ceiling, so a climb under the Golden Gate stops under the deck.
- **Soft ceiling at 520 m ASL** (Sutro Tower tops out ~555 m): the climb
  fades over the last 150 m and sputters (lurch, stall, lurch); `strain`
  feeds the wheeze, exhaust puffs and the audio (struggle bus).
- **Vista camera**, blended by the height above the (smoothed) rooftop floor,
  25 → 400 m: pulls back 175 → 270 m, widens 24° → 38°, rises 31° → 44°
  above the bus, but moves the look point ahead so the view pitch stays at
  30° (and, while the blend is still rising, never so steep that the
  horizon leaves the top of the frame: 3° of sky): the horizon and the sky
  stay in the top of the frame, never a top-down map. The bus grows to 1.55x so the hero still reads (~22 px).
  A dead band on the blend keeps the lens from breathing with rooftops.
- **Marine layer.** The fog is a layer with a top (175 m ASL over the ocean,
  the west and the Golden Gate, 120 m over the bay, a 25 m ground haze over
  the sunny east side that Twin Peaks shelters) with soft billows. Seen from
  above, the fog of every surface is the ray's exact path length inside the
  soft-topped layer (closed-form average of the profile) + clear-air haze;
  the resolve pass lights the top of the fog sea where the view ray enters
  it (billow normals from the same height function, low sun: bright tops,
  cool lee, a warm glow toward the sun) and continues it past the far plane
  to the horizon. Street level is untouched: the layer view fades in only
  once the camera is 110–260 m above the layer top (below that it is exactly
  the old fog), and paint still thins it: painted neighborhoods burn holes
  in the fog sea.
- **East clear, west the sea.** A layer top at roof height made the east a
  patchy dither soup; kept low there, the east reads clearly in haze with the
  downtown towers ghosting against the bay fog, while the west is an opaque
  sea with the peaks as islands.
- From high up the fog changes slowly across the screen, so the fixed fog
  handover band (and the shadow window's edge fade) dithered wide areas: up
  high the band narrows to the fog's own screen gradient, and the shadow
  edge fade widens until it counts as "flat" (a clean band, no dots).
  Windows shrink below ~2 game pixels up there and alias into moire (and
  leave no flat wall pixel, so every wall dithered): from the layer view
  they melt into a slightly darker wall tone, building by building.
- **Streaming at altitude.** The load circle moves up to 950 m ahead of the
  bus, under the view, and widens 1.5 → 1.9 km; detail is judged by
  distance from the lens (and its fov), so up high every region is coarse;
  detailed regions the view rose above are re-meshed coarse (hysteresis).
  **Coarse regions draw as one building mesh + one ground mesh** (merged in
  the worker; one 512² class texture, an 8 m grid; far ground doesn't cast):
  that keeps the ceiling at ~140 draws instead of ~430. Arrived tiles are
  adopted a few per frame (no hitch storm when climbing fast). Tiles buried
  in solid fog seen from above are hidden.
- **Shadows up high**: the window widens to 1000 m, centers on the ground
  under the view (a window centered on a bus 500 m up would land a kilometer
  away) and softens to 0.8; trees switch LOD by 3D distance from the lens.
- **Dragon breath from altitude** flies along a ray 27° below the heading
  from the bus, cast against rooftops/terrain, so it lands mid-screen where
  the player is looking. Near the rooftops that ray lands under the nose and
  the classic range wins, so low shots are exactly as before (0.42 s); past
  the classic range the projectile flies on at 300 m/s (~3.5 s from the
  ceiling). The bus's height above the impact goes to the splatter (`drop`).
- Audio: wind and a thin-air whistle rise with height; above the layer the
  foghorns come up from under it (darker, centered, a little more often).

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
