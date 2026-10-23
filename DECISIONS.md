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

## Altitude (producer: "I want the bus to go up, high enough to view everything")
- **Yoke on the same thumb.** Pull the thumb down = pull back = climb (up to
  40 m/s, easing the speed toward 15 m/s: it trades speed for height). Push up
  = nose down: above the rooftops it dives (48 m/s, flaring out at 16 m/s² so
  it never digs into the roofs) while surging; at the rooftops it surges as
  before. Release = hold the chosen altitude with a gentle two-tone bob. The
  coast after a release is aimed (y + vy / 2·holdGain) so the critically
  damped hold never bounces back. A 14% vertical dead band keeps sideways
  carving from climbing, and above the rooftops from diving too (at the
  rooftops any push still surges). The old "pull down to hover" is gone.
- **The automatic floor is untouched.** Released at the bottom the bus runs
  the classic model (look-ahead, early rise, hang time, tower avoidance, the
  hard floor). A held altitude only ever adds height on top of it; a dive
  that reaches the floor hands back to it; a bridge deck overhead lowers the
  ceiling, so a climb under the Golden Gate stops under the deck.
- **Soft ceiling at 520 m ASL** (Sutro Tower tops out ~555 m): the climb
  fades over the last 150 m and sputters (lurch, stall, lurch); `strain`
  feeds the wheeze, exhaust puffs and the audio (struggle bus).
- **Vista camera**, blended by the height above the broad ground (terrain
  averaged over ±220 m and slowly smoothed, never roofs), 25 → 400 m: pulls
  back 175 → 270 m, widens 24° → 38°, rises 31° → 40° above the bus, and the
  view pitch is set outright at 22° (never steeper than leaves 3° of sky
  while the blend is still rising): the horizon and a band of sky stay at
  the top of the frame, never a top-down map. The bus grows to 1.55x so the
  hero still reads (~22 px).
- **Only the yoke moves the lens.** The blend follows the height while
  climbing or diving; holding an altitude latches it (it settles exactly, so
  the lens is perfectly still); skimming the floor sends it home. A lens
  that followed the rooftop floor changed fov and distance on most frames,
  and every change rescaled the snapped pixel grid: the whole frame swam.
  For the same reason the pitch up there is not taken from where the bus is
  (its bob would rock the frame, and a rotation can't be snapped).
- **Marine layer.** The fog is a layer with a top (175 m ASL over the ocean,
  the west and the Golden Gate, 120 m over the bay, a 25 m ground haze over
  the sunny east side that Twin Peaks shelters) with soft billows. Seen from
  above, the fog of every surface is the ray's exact path length inside the
  soft-topped layer (closed-form average of the profile) + clear-air haze;
  the resolve pass lights the top of the fog sea where the view ray enters
  it (billow normals from the same height function, low sun: bright tops,
  cool lee, a warm glow toward the sun) and continues it past the far plane
  to the horizon. Street level is untouched: the layer view fades in only
  once the camera is 110–260 m above the layer top *and* the vista is on
  (height above the ground, not above the sea: skimming Twin Peaks the
  camera is 380 m up, and the fog there must be the street-level Hopper fog
  exactly), and paint still thins it: painted neighborhoods burn holes in
  the fog sea.
- **See everything.** The clear air above the layer is thin (0.00012/m, full
  fog at 28 km): the skyline, the bridge towers and the hills read out to
  8–10 km. The sky above the horizon deepens upward and sits a step under
  the bright haze below it (a horizon line, not a fade), distant shapes above
  the sea stand a step darker than the haze (the hills on the horizon), and
  the fog sea's billows carry far before flattening into streaks.
- **East clear, west the sea.** A layer top at roof height made the east a
  patchy dither soup; kept low there, the east reads clearly in haze with the
  downtown towers ghosting against the bay fog, while the west is an opaque
  sea with the peaks as islands.
- **Calm pixels up high.** From up there every roof is a few pixels and the
  fog makes each one a gradient, so the ordered dither fired on most roofs
  (a checkerboard "dither soup") and boiled as the view moved. With the
  vista on, surfaces round to their ramp step (calm, flat bands), the fog
  handover is a clean contour, and the sky and the fog sea dither in screen
  space (they change only with the view's rotation, so a pattern anchored
  to the snapped grid would flip them at every snap step). The sky-to-sea
  blend past the far plane mixes light levels; a dither crossfade drew
  horizontal streaks across the sky. Windows shrink below ~2 game pixels up
  there and alias into moire: from the layer view they melt into a slightly
  darker wall tone, building by building.
- **Up high the city is what holds still.** The grid snaps at the depth of
  the ground under the screen center (not at the bus, whose 0.75 m snap
  step resampled every far roof on every frame), with its scale held in
  1/16-octave steps with hysteresis; the bus, its drop shadow and its
  particles are moved by the snap's remainder at their own depth so they
  stay put. What still changes from frame to frame is the edges of roofs as
  the bus flies forward (a dolly can't be snapped): measured on 1/30 s
  frame sequences, a third of the cruise view's change downtown and an
  eighth over the west, and no dither.
- **Streaming at altitude.** The load circle moves up to 950 m ahead of the
  bus, under the view, and widens 1.5 → 1.9 km; detail is judged by
  distance from the lens (and its fov), so up high every region is coarse;
  detailed regions the view rose above are re-meshed coarse (hysteresis).
  **Coarse regions draw as one building mesh + one ground mesh** (merged in
  the worker; one 512² class texture, an 8 m grid; far ground doesn't cast):
  that keeps the ceiling at ~140 draws instead of ~430. Arrived tiles are
  adopted a few per frame (no hitch storm when climbing fast). Tiles buried
  in solid fog seen from above are hidden.
- **Coarse ground and ground paint.** A coarse region's tile can still own
  its ground mesh (`City.setOwnGround`, on the region's 8 m grid so the
  seams match): ground paint lives per tile, so a painted tile is split out
  of the merged ground instead of vanishing from every view from altitude.
- **Shadows up high**: the window widens to 1600 m (~1.6 m texels, enough
  for the long low-sun shadows of row houses seen 1–2 km away; 2000 m cost
  0.66M shadow-pass triangles, too close to the budget), centers on the
  ground under the view 600 m ahead of the bus (a window centered on a bus
  500 m up would land a kilometer away) with a narrow edge fade (a wide fade
  sliding with the window boiled), and softens to 0.85; trees switch LOD by
  3D distance from the lens.
- **Dragon breath from altitude** flies along a ray 20° below the heading
  from the bus, cast against roofs, trees and terrain (never a landmark's
  collision post or a bridge deck), so it lands near the screen center where
  the player is looking. Near the rooftops that ray lands under the nose and
  the classic range wins, so low shots are exactly as before (0.42 s); past
  the classic range the projectile flies on at 850 m/s (~2 s from the
  ceiling). From up high a pixel is meters wide, so a long shot that would
  come down in a park or a wood snaps to the nearest roof within a reach
  that grows with the drop (aim stays forgiving; the glint shows it). The
  bus's height above the impact (`drop`) and the flight time (`travel`) go
  to the splatter.
- **The opening still threads the Gate.** The yoke can't climb until the
  bus is 230 m past the bridge (pulled from the first frame it used to
  climb over the bridge instead), and near the bridge the low cinematic
  camera stays low even while steering (it used to rise the moment the
  thumb touched, straight into the suspender cables).
- Streaming adopts arrived tiles all at once until the first ready frame
  (the loading fog hides it, and the first frames match the classic
  streaming), then a few per frame.
- Audio: wind and a thin-air whistle rise with height; above the layer the
  foghorns come up from under it (darker, centered, a little more often).
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
- **Hue layout: pinwheel, by screenshots.** Pinwheel (rainbow sectors around
  the impact with a slight swirl), rings by distance, and a spiral of both were
  shot from the chase camera and from straight above (tools/blast.mjs layouts).
  Rings read as a 3-hue bullseye (a 60 m blast only holds ~3 rings); the spiral
  was noisy; the pinwheel shows all six hues from both views.
- **One rainbow turn on the ground, the rainbow dealt to the buildings**
  (review fix). The first build used 12 sectors, so the rainbow went round
  twice: opposite sides of the impact shared a hue and the Painted Ladies row,
  a straight line through the impact, came out as two alternating hues (row
  76774-76783: 4,5,4,5,4,0,4,5,4,5; ~60% of a blast in two hues). Now the
  ground pinwheel is **6 sectors** (opposite sides complementary) and the
  fresh buildings are **dealt the rainbow in order of swirled angle** around
  the impact (`hueDeal` 1): every blast of six or more shows all six hues in
  near-equal shares, and the row reads as a rainbow (5,4,1,2,3,5,0,1,2,3).
  Dealing in equal contiguous wedges (`hueDeal` 2) put 2-3 neighbors of the
  row in one wedge, so it still stuttered; the old per-building layout hue is
  `hueDeal` 0. Touching neighbors never share a hue (nearest free hue, checked
  against every settled neighbor), and a house never takes the hue of the
  ground paint under it (no red house on red ground).
- **The ground gets splattered** (streets, sidewalks, parks; trees standing in the
  paint bloom). A per-terrain-tile RGBA8 mask on the tile's own 2 m class grid,
  created only when paint lands there; the shader reads coverage bilinearly
  through a noise warp with a noise threshold (organic edges, a darker rim, wet
  highlights), hue from the strongest tap. The splat is a lumpy, rayed blob
  (edge 0.8 x the radius, 13 splash rays; it was a 0.9 x disc with 9 that read
  as a carpet); spatter dots beyond the edge, most of them made by flung paint
  blobs that land exactly on them.
- **Ground paint sits below the walls** (review fix: after a few blasts the
  ground was a full-chroma carpet at the walls' own steps, so the houses lost
  figure/ground and the street plan disappeared). It now sits about two ramp
  steps below sunlit painted walls, never below the saturated middle in shadow;
  sidewalks a step lighter than the street; yellow and orange keep floors so
  they stay amber and vermillion (their deep steps are orange and brick: that
  would muddy); curbs and park-path edges stay grey through the paint, so the
  blocks still read. All live in config.splat (groundLight, groundSidewalk,
  groundCurb) through one shared uniform.
- **Ground persistence: the settled result, not the history** (review fix). The
  first build saved the blast list and redrew it blast by blast as tiles
  streamed in; with 150 saved blasts that meant 226 redraws queued when the bus
  was ready (seconds of bare ground) and a 171 ms impact frame (land() finished
  every queued redraw first). Now each painted tile is one localStorage entry,
  `strugglebus.ground.v2:<tx>,<tz>`: its mask as coverage (5 bits) + hue
  (3 bits) per texel, run-length coded, base64, 3-5 KB (10 KB for a tile hit a
  dozen times). It decodes in one pass (~0.13 ms) when the tile streams in, so
  saved paint shows with the tile; changed tiles save one per frame after a
  0.8 s debounce (encode ~0.14 ms), on tile unload and on pagehide. Blasts that
  reach a tile that isn't loaded wait on its entry (max 6) and draw when it
  arrives; a newer live blast puts them underneath instead of finishing them,
  so nothing is ever drawn synchronously at an impact. 160 tiles max (the
  longest-untouched wash away first, also when storage is full). Measured
  (tools/blast.mjs heavy): 150 seeded blasts = 17 tiles, 58 KB; after a reload
  0 jobs queued and the ground fully painted at the first frame; the impact
  frames right after match the 1-blast control. The prototype's
  `strugglebus.ground.v1` list never shipped and is dropped on load; the
  building paint key `strugglebus.paint.v1` is untouched.
- **Ground paint is drawn while the projectile flies** (a few rows per frame,
  hidden by a per-texel reveal time) and lands with one texSubImage2D per touched
  tile; already-painted ground changes hue only at impact, under the flash. Four
  reveal slots (two were enough for today's 1.6 s recharge, not for the longer
  altitude shots). The flight slices are kept thin: setting a blast up is a
  slice of its own and costs ~0.1 ms (the splat edge used to walk every ray for
  every edge sample: 1.6 ms cold), then 1500 texels per frame, more only if the
  blast would not be drawn by its impact at 30 fps. A boot warm-up of the
  rasterizer was tried and dropped: repeated cold starts showed no gain. The
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
- **Cost after the review fixes** (tools/blast.mjs perf, per-frame CPU work
  median, pre-blast c35a39d x3 / pre-fix 3ceb271 x2 / now x2, interleaved; the
  host's load was 5-9 for the baseline runs and 10-16 for these, which alone
  shows as +1 ms on the grey hover where no blast code runs): grey 3.6 / 4.4 /
  4.6 ms, blast 4.2 / 6.0 / 5.5, settled 3.9 / 5.2 / 4.7, escalation 4.0 / 5.3 /
  4.4, settled 4.0 / 4.6 / 4.3; flight frames (tap to impact) 4.1 / 8.9 /
  6.2. Draw calls unchanged (138-140 in a blast, 147-149 after an escalation:
  rooftop-garden batches are per cell, never per building). Acceptance at the
  Painted Ladies after the fixes: one tap blooms 15 buildings and 11 trees and
  paints 36% of the ground within 90 m (was 44%: the rayed splat), identical
  after a reload; a 300 m drop blooms 76 buildings and 44 trees.
- **Known:** the first blast of a session compiles the street sign's shaders
  and the first escalation the rooftop-garden shaders (pre-existing hitch, now
  more visible because every blast escalates many buildings at once). Pre-warm
  them at boot (renderer.compile on hidden instances) in a follow-up.
- **Merged with feat/altitude.** `barf(x, z, { drop, travel })`: the impact is
  `opts.travel` after the tap (the long shots from altitude), default
  impactDelay. Ground paint attaches in `City.makeTileTerrain` and detaches in
  `City.dropTileTerrain`. Coarse regions (everything seen from altitude) draw
  one merged ground mesh, so every tile a blast will reach is split out first
  (`GroundPaint.onTilesTouched` -> `City.setOwnGround`), and tiles with saved
  paint are split out when their region's ground is built: the paint shows from
  the ceiling too, at one draw per painted tile seen. The flash runs after the
  fog-sea pick in the resolve shader. Follow-up if a heavily painted city
  costs too many draws from altitude: a per-region mask atlas.

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
