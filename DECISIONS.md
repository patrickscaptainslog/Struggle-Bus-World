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
  of fire glints (a full palette step lighter, with a band of light sweeping up
  it); it is exactly the building the tap hits (see Feel polish).
- ~~Smart spill + Painted Ladies fan~~ (superseded by the explosive blast, below):
  the splat used to paint the target plus at most 4 *unpainted* neighbors one by
  one. Paint is still saved per building (smart persistence) and the blast's
  center still takes the next hue.
- **Re-splat escalates**: level 1 full bloom → 2 rooftop garden → 3 Hundertwasser.
- **Telephoto vista camera** (24° horizontal FOV, 155 m back; was 175) that tilts toward a
  diorama when slow and levels toward the horizon when surging (see Look polish:
  it now always keeps a sky band and the horizon at the top of the frame).
- **Late-afternoon sun through thin fog** instead of flat light: flat light makes
  low-res 3D melt into one grey. Painted neighborhoods thin the fog above them.
- **No HUD.** Belly glow = recharge. Place names appear on a diegetic street sign.
  (Tilt and the turbo gears need a little: see "The HUD" below. It is gone
  whenever it isn't being used, and a desktop has none at all.)

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
  there and alias into moire: they melt into a slightly darker wall tone,
  building by building (since feat/facade at every height, by each
  building's on-screen pixel size: see Tower facades).
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
  from the bus, cast against roofs, trees, terrain and the landmarks' real
  surfaces (never a landmark's collision post or a bridge deck), so it lands
  near the screen center where
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

## Feel polish (producer: "phenomenally flawless flying and splatting physics")
Every number below is measured with the offline harness `tools/feel-sim` (the
real City / Flight / Splatter / Aimer / CameraRig code on the real baked city,
no browser; before = the pre-polish main.ts loop replayed on the same data) and
cross-checked in the browser with `tools/feel.mjs`.
- **One source of truth for the aim** (`src/game/Aim.ts`). The glint used to
  refresh every 0.1 s and the tap re-picked on its own, so the building that
  glinted was not the one hit on 21 of 200 floor taps and 17 of 54 taps from
  altitude, and when a one-thumb player lifted the thumb to tap (the bus
  straightens and slows under them) on 64 of 80. Now the target is picked every
  frame and the tap hands that very building to `Splatter.barf` (`target`):
  glint != hit on 0 of 200 floor taps (30, 60 and 120 fps) and 0 of 54 from
  120 m / 250 m / the ceiling. Lift-then-tap (the glint when the thumb lifted
  vs the hit): 3 of 80 at 60 and 120 fps, 8 at 30 fps, each a downtown tower
  stepping into the line of fire as the bus straightened (the glint moves to it
  before the tap, so what glints is still what's hit) or a shot into a park.
  - **Hold**: the target stays while the aim point is within 10 m (`aimHold`,
    more from high up) of it over the last 40 m of the line of fire
    (`aimHoldAlong`): at surge a building used to glint for one 0.1 s tick; a
    held one stays until the bus has closed 40 m on it. Glint changes per second
    while loaded, before / after: cruise 0.6-2.5 / 0.4-1.8, surge 1.8-3.7 /
    1.2-2.7; in hard turns the line of fire sweeps 100+ m/s across the roofs, so
    the glint follows it like a searchlight (2-8/s).
  - **Latch**: lifting the steering thumb (or touching down for a tap, `Input.
    onPress`) freezes the glinting building for 0.5 s (`aimLatch`: a 230 ms tap
    plus the thumb's trip back down), while it stays within the pick radius or a
    0.2 cone of the nose (from altitude the bungee settles a few degrees after
    the lift, 100 m at 1 km).
  - **Line of fire**: near the rooftops the breath is a straight blast from the
    mouth to its landing, so a building standing in between clearly above that
    path (1.5 m, `wallClear`; never one within 8 m of the landing, where the jet
    is as wide as a house) takes it on its wall face. A tower you fly at is hit,
    not flown through.
- **Pick by the footprint, not the centroid** (`City.buildingAt`,
  `edgeDistance`, `nearestBuilding`, an area index of every footprint's bounds
  in 32 m cells). Aim points inside footprints that picked something else or
  nothing: FiDi 26 %, SoMa 24 %, Mission Bay 35 %, Dogpatch 24 %, Alamo 3 % of
  roof area -> 0 everywhere; aimed dead-on into a tower > 40 m, FiDi missed 1,346
  of 4,564 -> 0. The snap (28 m, more from altitude) is the true distance to the
  nearest wall. A big building (any part more than 25 m from its centroid,
  `smallRad`) is hit right where you aimed if that is on it, else on its nearest
  edge 4 m in (`landInset`), never at a centroid 100 m away, and the blast
  centers there and reaches big footprints by their true edge distance (a block
  half inside blooms wherever its centroid is). A house is hit at its centroid
  and reached by its centroid less its half-size, exactly as the approved blast:
  the Painted Ladies tap still blooms the same 15 buildings (76 from 300 m) from
  the same impact point. Pick costs ~2 us in node.
- **A miss is a miss**: a breath into open water (nothing in reach, ground under
  0.8 m) used to splash red on the tap frame and then play a full impact with
  the previous hue and hit-stop on nothing. Now: no flash, no boom, no hit-stop;
  a splash of the next hue when the jet comes down; half the belly comes back
  (`missRefund`). A park or a beach still takes a ground blast (it paints).
- **The glint can be seen**: +0.06 light (half a ramp step flat walls snap away)
  and a 1.1 s sweep that rarely showed within a dwell -> +0.13 (a full step,
  also on painted buildings) and a sweep every 0.5 s that starts the moment the
  building becomes the target (`glintLift`, `glintSweep`, `glintRate`).
- **Anticipation**: the tap squashes the bus on the same frame (1.0 -> 0.8; it
  used to bottom out 6 frames later), it inhales for 0.09 s (`inhale`; the gulp
  reaches the mouth then), then the jet leaves; first impact still 0.42 s after
  the tap. The squash spring is substepped and its squash -> stretch switch is
  timed per substep: identical at 30, 60 and 120 fps (0.786 at 0.1 s, 0.941 at
  0.2 s; it was 0.80 / 1.01 at 30 and 0.83 / 0.93 at 60).
- **A blast, not a lob**: the jet's Hermite tangents came from a 95 m/s muzzle
  plus 70 % of the bus's speed and a 34 m/s drop at the end, so it left slowly,
  peaked mid-flight and braked to a stop over the roof (cruise 117 -> 282 -> 34
  m/s). They now come from its chord: 1.5x the mean speed out of the face along
  the nose (bent toward the target by at most 0.6 rad, `aimBend`), 0.8x at
  impact, monotonic (cruise 397 -> 245 -> 214 m/s, from 250 m 1,322 -> 818 ->
  712). Once the nose has swung more than ~66 degrees off the target the breath
  tapers off instead of curling across the screen.
- **The hit reads on the frozen frames**: the splat ran after the city's paint
  upload, so every bloom reached the GPU a frame late and the impact frame
  showed nothing. It runs first now, and the color flood starts 6 m down from
  the roof (`floodHead`): the impact frame (with the blast's flash) and the 4
  hit-stop frames already show the hit; the flood itself is unchanged. The
  blast's flash, kick and 4-frame hit-stop are kept as they are.
- **The bus plants itself to breathe**: steering used the stalled speed, so the
  recoil added 28 % turn authority, and a breath with the stick held whipped
  the bus 38 degrees before impact and 99 over the breath. Steering now uses the
  speed at the tap and halves until the impact, easing back over 0.2 s
  (`breathSteer`, `breathSteerEase`): 21 / 61 degrees. A tap, re-grab and carve
  the other way still reaches 0.8 rad/s in 0.28 s (0.12 before).
- **The release is visible**: the belly band stayed full for the whole breath
  and emptied in one frame; on the tap frame the full-belly sag vanished, a
  6.5 m step the climb spring met at 310 m/s^2 (the bus hopped 16 m/s and reared
  0.48 rad). The belly now drains over the breath (the "loaded" cues drop at the
  blast, the sag lifts as it pours out), the wallow still cuts on the tap, and
  the rear-up is an authored envelope (0.2 rad, `rearUp`; up in 0.1 s, settling
  from 0.6 s; its own lift adds nothing): pitch peak 0.48 -> 0.26, rise in the
  first 0.1 s 1.1 m -> 0, on-screen height of the bus (real chase camera)
  1.32x -> 1.22x at most. Pitch is floored at 24 m/s (a stalled bus no longer
  noses down hard).
- **Bank is proportional and bounded**: maxBank x tanh((lateral x 0.014 + yaw
  rate x 0.2) / maxBank), maxBank 0.70, damping 0.48 (the verifier's "tunedA").
  Steady bank at 10 / 30 / 60 / 100 % stick at cruise 0.23 / 0.62 / 0.62 / 0.62
  -> 0.08 / 0.24 / 0.42 / 0.58; surge 0.44 / 0.62 / 0.62 / 0.62 -> 0.12 / 0.32 /
  0.47 / 0.55; on the yoke's climb 0.15 / 0.46 / 0.62 / 0.62 -> 0.07 / 0.21 /
  0.34 / 0.46 and dive -> 0.12 / 0.32 / 0.46 / 0.54. Letting go after a full
  carve counter-rolls 25 % of the bank (was 60 %, a wrong-way lean), slalom peak
  0.96 -> 0.80. The full-belly wallow fades as the carve grows, so a nudge reads
  as a nudge.
- **Nothing to fly through**: the flight's obstacle grid (8 m cells) knew only
  the bake's flat roofs and one 16 m x size post per tree. Now each tree crown is
  a dome over its whole reach at its real height (`treeCrown`), every vertex of
  a detailed (LOD 0) tile mesh lifts its own cell and a single-part house lifts
  every cell within 3 m of it to its mesh top (gable ridges, chimneys,
  parapets, rooftop clutter on towers and podiums), and a rooftop garden or a
  Hundertwasser crown lifts its roof to its top (`RoofSprouts.set` returns it,
  `City.raiseRoof`). Measured against the rendered surfaces (the tile meshes
  rasterized at 1 m, crown domes, every garden element): frames with the bus's
  underside inside something, 19 routes x 3 speeds through hills, Twin Peaks,
  downtown, Buena Vista and Golden Gate Park: 93 -> 0 (min clearance -1.26 ->
  +1.53 m); 64 passes straight over level-3 roofs: 1,405 of 9,600 frames
  (min -7.8 m) -> 0 (min +3.4 m). The bus rides higher over a painted level-3
  block by about a dome.
- **No lurch at roof edges**: the floor's rises (a roof entering the 1.6 s
  look-ahead steps it by whole storeys) are eased at 1.2 Hz before the climb
  spring sees them (`climbSmoothHz`); falls stay immediate. Peak per-frame climb
  acceleration (m/s^2, cruise / half / surge): Western Addition hills 273 / 194 /
  1,096 -> 101 / 50 / 210, Twin Peaks 252 / 304 / 900 -> 83 / 150 / 479, Buena
  Vista 404 / 706 / 429 -> 120 / 260 / 180, downtown 59 / 2,944 / 1,775 -> 64 /
  778 / 812 (still the worst: an 80 m tower entering the look-ahead needs
  > 60 m/s^2 even planned perfectly). Lower rates (0.6, 0.9 Hz)
  start touching the hard floor at surge; 1.2 never does. The yoke's climb, dive
  and hold paths are untouched (they don't chase the floor spring).
- **Frame-rate independence**: flight, squash, aim and clearance results match
  at 30 / 60 / 120 fps (route clearances within 0.1 m, aim glint == hit at all
  three); only event times quantize to the frame (impact at 0.433 s at 30/60
  fps, 0.425 at 120).
- **Smaller fixes**: the drop shadow sits on the roof of the part under the bus
  (it was buried 2.5 m inside every roof, `top - 3`); saved paint thins the fog
  once per building per session (each tile reload bumped it again); painted
  trees come back after a reload at the level of the house beside them (the
  blast's ground persistence already restored them, at level 1); building paint
  is saved on pagehide / visibilitychange (the 0.8 s debounce runs in rAF, which
  stops when the app is hidden), ground paint on visibilitychange too; every
  lat/lon goes through one transverse-Mercator helper matching the bake
  (`src/game/geo.ts`; the old formula was 10-30 m off away from the origin,
  sub-millimeter now); the breath and the exhaust leave from this frame's bus
  matrix (one frame stale: 1.9 m at surge); a failed level-of-detail swap backs
  off 3 s doubling to 30 s (it re-requested every frame while offline).
- **In the browser** (`tools/feel.mjs`): 7 of 7 real taps through Input's tap
  path glint == hit and paint it (floor cruise, surge, a second-finger tap while
  turning that hit a wall, lift-then-tap, 120 m, 250 m, the ceiling), impacts at
  0.47-0.54 across and 0.51-0.60 down the screen; the strip
  (`shots/feel/strip.png`) shows the glint before the tap, the jet leaving at
  0.10 s, the palette flash on the impact frame and the jet slamming in on the
  4 hit-stop frames. Regression shots vs main (`shots/merge2/regress`): the same
  views; the drop shadow now lies on the ground under the bus over a park and
  on the water in the opening (it used to float at a guessed canopy height or
  15 m above the sea), and the painted shot differs by its random first hue.
- **Not changed (already fixed or out of scope)**: the blast replaced the smart
  spill and the per-neighbor streams (the spill parts of the old findings are
  moot); LiDAR stable ids are derived and checked (`check-stable-ids.mjs`), so
  the "paint keyed by rank, no epoch" finding is handled there; the old hit
  review's FOV punch, white uFlash and global splash/roofRadius changes were
  dropped by its own verifier (the blast's palette flash and kick cover the
  punch); the camera rig's dead `barfTilt` is polish/look's file.
- **Cost**: the aim runs every frame now (was every 0.1 s): 10-60 us per frame
  in node (the ray it shares with the old aim 3-50 us; the line-of-fire test
  only ring-tests buildings that could stand above the jet's path), pick ~2 us.
  The obstacle lifts run once per tile adoption (one pass over the tile mesh's
  vertices). In the browser (`tools/feel.mjs perf`, the same script against the
  pre-polish build and this one): Alamo Square floor 129 / 129 draws, 1,196,510
  / 1,196,510 triangles; at 250 m 198 / 197, 1.785M / 1.783M; FiDi floor 114 /
  114, 714.7k / 715.7k; FiDi 250 m 117 / 116, 820.5k / 820.5k. CPU work per
  frame 4.9 / 3.4, 3.8 / 4.3, 2.8 / 3.7, 2.5 / 2.9 ms (median of 11 frames on a
  SwiftShader host at load ~26: inside its noise).

## Super splat (producer: "hold to charge up splat ... an ungodly amount of rainbow splat, like a torrent, a firehose ... then an obviously shown cooldown")
- **Hold, don't tap.** A splat press held `holdThreshold` (0.3 s) charges,
  shorter is the normal tap. The gesture is controls' (Input's INPUT CONTRACT,
  "Tilt to fly" below): the SPLAT button in touch mode, the whole screen in
  tilt mode, Space on a keyboard; a still thumb on the canvas in touch mode
  steers, it never charges. Sliding off the button, a swipe, a lost pointer or
  a lost focus cancels: the charge fizzles out with a power-down, no cooldown.
- **Ten seconds to full** (`superCharge`), as the producer guessed. Released
  under 30 % (`superMin`) it is just a splat (no cooldown: a long-ish tap must
  not be punished). Released between 30 % and 100 %: a **mega blast**, the
  tap's own breath (inhale, rear-up, jet, blast) scaled by the charge: radius
  x1.6 -> x2.6 (`megaFloor`, `megaGain`; x1 at first: see "Outside judge" below),
  a jet 1.5x -> 2.4x wider, hit-stop 6 -> 9 frames, thunder under the boom,
  cooldown x the charge (30 s at 50 %). At
  100 % the **firehose** lets go on its own (holding on can't waste it).
- **The charge has to be felt with the sound off**, so it is on the bus, under
  it, around it and in the meter at once: rainbow energy motes spiral in from
  up to 115 m out (mostly from the city below) and land exactly in the mouth
  (computed against the live mouth on the GPU, so a moving bus still swallows
  them), up to ~950 a second; the belly band races through the rainbow, then
  flickers white-hot from 62 %; the whole body glows, throbbing with a
  heartbeat that races from 70 to 230 bpm (the same `heartInterval` drives the
  audio's lub-dub and the bus's throb); it swells 16 %, shudders, wheezes,
  its eye opens wide, steam puffs from the hatch; arcs crackle over the body
  from 18 % (a static pool of points re-rolled 21 times a second on the GPU),
  sparks fly off it from 25 %, a rainbow halo orbits it from 35 %; a rainbow
  pinwheel spins around its drop shadow, a summoning circle on the roofs and
  streets below (resolve pass, see "Merged with controls"); the camera creeps in 20 % (a dolly: translation only, the
  pixel snap holds); the charge weighs the bus down to 60 % speed (struggle,
  then release). Audio: a two-octave riser and hiss, the heartbeat, chord
  tones shimmering over the last stretch. The first build's motes were
  pastel (each hue's two lightest steps) and read as sprinkles; they are the
  hues' saturated middle steps now, with a white-hot heart on the big ones.
- **The firehose** pours for 4 s (`firehoseDuration`) along the breath's aim
  (Aim.ts; at the rooftops it reaches 1.7x the breath's range, `firehoseReach`,
  so a turn sweeps a wide arc; from up high it pours down along the aim ray,
  mid-screen). It is one geyser whose landing point moves (`GeyserLive`):
  every particle flies to where the stream was aimed when it left the mouth,
  so as the bus turns the torrent bends into a sweeping arc across the city.
  12 times a second (`firehoseRate`, at most one per frame) the point where
  the stream is coming down right now (a 96-entry history of aim points and
  their landing times: the paint follows the visible stream, not the aim)
  takes a full 45 m blast (`firehoseRadius`, growing with the drop like a
  tap's) through the normal Splatter: buildings bloom as the shockwave reaches
  them, the ground and the trees are splattered, painted buildings escalate a
  level per hit, at most every 0.4 s (`firehoseRepop`): L3 in about a second
  under the stream. A per-building busy time keeps a later impact off a
  building whose pop is still on its way (the plan reads levels at barf time:
  without it the second of two overlapping impacts re-dealt a fresh
  building's hue and flashed it grey). Impacts are timed to land as the
  stream does, so about one blast is in flight at a time (GroundPaint has 4
  live reveal slots). The bus is knocked back to 30 % of its speed and held
  at 40 % (recoil), rears 0.24 rad and shudders; every impact kicks the
  camera (translation only) and rings a bell climbing the chord over a
  roaring bed (a soft-clipped chord drone, rushing pink noise, a sub) that
  swells into a crescendo; the street sign pops when the stream sweeps into a
  new neighborhood; it ends in a 90 m finale blast with 8 hit-stop frames.
- **Flashes are capped at 3 a second** (`firehoseFlashes`): 12 palette
  flashes a second would strobe (photosensitivity guidance: no more than 3
  flashes a second).
- **From up high the stream pours 3x faster** than the breath's projectile
  (`firehoseSpeed`) and widens with the drop (`firehoseWidthDrop`): in the
  first build it flew 1.2 s from 250 m, so a turning bus left its landing off
  the edge of the screen, and a 20 m ribbon was a thread from 700 m away.
- **Cooldown 60 s** (`superCooldown`), shown three ways: the meter ring drains
  white, then refills dimly over the minute with the seconds left in the
  middle (white digits); for the first 4 s (`superSpent`) the bus is spent
  (dark smoke from the exhaust and the hatch, a heavy wheeze, a dim belly
  band and hatch, a droopy eye, nose down, limping back up from 40 % speed);
  when it is ready: a rising chime, a white pulse and pop of the meter, a
  rainbow halo and sparks around the bus. Holding during the cooldown: a
  damp-firework fizzle, the meter blinks red and shakes, a puff from the
  hatch; a tap still splats, and so does the lift of that held press (only
  the firehose blocks taps: the mouth is busy).
- **The meter** (`src/ui/SuperMeter.ts`) is the only UI the super has: a
  34 x 43 pixel canvas at 2x, palette colors, the pixel font (MEGA / HOSE under
  the ring, seconds in it), in the HUD's bottom-center slot. No HUD at rest: it
  shows only while charging, pouring or cooling down, and for 0.7 s of "ready"
  under the chime (hidden, it doesn't redraw). So there is no HOLD hint any
  more: the tutorial's job, if one is wanted. It redraws only when what it
  shows changes.
- **Particles stay in the existing pool** (8000): a hose impact throws a
  smaller splash and burst and every fifth spatter blob (~260 particles, a tap
  ~1100), bloom sparkles are fewer for hose blooms, the stream's rate is
  scaled so as many particles are alive however long it flies. The charge's
  motes, arcs and sparks are their own small pool (2400, one draw, drawn only
  while alive).
- **Nothing new persists** (the paint already does); the cooldown resets with
  a reload.

## Merged with controls: the super splat on the real gesture (MAIN d6fa4a6 vs NEXT)
- **Controls' gesture and INPUT CONTRACT won.** `Input.ts` is main's, whole; supersplat's minimal hold and
  `holdSlopPx` are gone, and so is the duplicate `config.splat.holdThreshold`. `tools/feel-sim/s_hold.ts` tested the
  deleted gesture (a still thumb on the canvas charges): retired, `tools/controls-sim/s_gesture.ts` covers the press
  (chargeStart at 317 ms in every scheme, cancelled on a slide, a blur, a pointercancel; run on NEXT, unchanged).
  main.ts's stop-gap `onChargeEnd` (a held press splats) is replaced by `superSplat.chargeEnd`.
- **No dead press.** The stop-gap's promise stays: under `superMin` a held press is a splat, and a press told "not
  yet" during the cooldown splats on its lift too (a slow tap mustn't go unanswered because a minute's cooldown is
  running). Checked through real Space presses: 0.6 s = a splat, no cooldown; 4.2 s = a mega, 25.4 s cooldown; 0.6 s in
  the cooldown = "not yet", then a splat.
- **A gear is never braked by the super.** `Flight.driven` (a gear or the boost is driving the speed, or a gear is
  still braking out): the charge's weight, the firehose's hold and the spent limp (`speedScale`) and the firehose's
  kick all stand aside. The charge is allowed at G1: the firehose at 450 m/s lays a rainbow stripe across the city, and
  that is the best thing a gear can do. `supersplat.mjs jet`: 441.8 -> 450 m/s all through the charge, the pour and the
  limp (scale 0.4 -> 1), 49 impacts; the shift down still brakes at the gear's own rate (204, 90, 49 m/s). Before this
  decision a charge at G1 would have been 450 -> 135 m/s. The classic bus is unchanged.
- **The sign goes through the same queue as a blast's** (`queueSign(ref, hue, cx, cz, r)`): beside the blast, after
  the wave, with its retries. The hose branch keeps `lastBlast` and `landmarkHit`, so the stream floods landmarks.
- **The summoning circle moved into the resolve pass**, beside the hero shadow it used to be (`setHeroCircle`, the
  shadow's `dropShadow` centre, axes and snap compensation): the old mesh is gone with look's shadow, and a new flat
  mesh would have floated over roof edges and cost a draw and a program (a stall risk at the first charge). Now it lies
  on whatever faces up below the bus, breaks over a parapet as the shadow does, costs no draw and no program, and the
  shadow stays in its middle. It is a hue ramp's own steps 5-6, stippled gaps: nothing new leaves the palette. (The
  first pass ran up to step 7 and went pastel at a full charge; the saturated steps read better.) Its spin is integrated
  now: `uTime * rate` lurched faster and faster as the rate climbed.
- **The first charge never stalls.** `SuperFx` is the only new material. Its Points are not visible until a charge, so
  like TurboFx it draws its (unlit) arc pool for its first 3 frames; `object` is ready for perf/load's
  `registerWarm('super fx', () => fx.object)`. `supersplat.mjs first`, real time: the first charge's worst frame gap
  17.1 ms, the second's 17.1 ms, no links.
- **`Blast.super = {kind, charge, id}`** (STAGES.md 4.5): mega, hose and closer tagged, the hose's impacts and closer
  sharing the super's serial, so the stage engine can count one hit per area per super and the swath's impacts.
- **The closer waits for the impacts in flight** (`Splatter.inFlight`): it read paint levels at barf time, took blocks
  the last impact was about to paint for grey and re-dealt their hue. L3 under the sweep 22 -> 27, 4.30 -> 4.37 s.
- **Trees take their first colour only from hose impacts** (`paintTrees(b, true)`): they ran through all three levels
  in a quarter second. Mega and closer still escalate them. One Vector3 and one hue array per bloom are gone too
  (taps gain).
- **The numbers** (393 x 852 at 3x, this laptop's GPU, fixed 1/30 s; `tools/supersplat.mjs`, `blast.mjs`):

  | Alamo / Ladies | work median / p90 ms | draws median (max) | triangles median (max) |
  |---|---|---|---|
  | MAIN cruise | 5.3 / 6.8 | 117 (119) | 1.15M (1.18M) |
  | NEXT cruise | 4.5 / 5.4 | 117 (119) | 1.15M (1.18M) |
  | MAIN tap | 5.0 / 6.2 | 115 (117) | 1.14M (1.15M) |
  | NEXT tap | 4.8 / 5.9 | 115 (117) | 1.15M (1.15M) |
  | NEXT firehose | 3.7 / 6.5 | 138 (149) | 1.24M (1.38M) |
  | NEXT after it | 2.2 / 2.8 | 138 (143) | 1.30M (1.33M) |

  `blast.mjs perf`, MAIN / NEXT: blast 4.4 / 4.5 ms, 148 / 148 draws; painted 3.1 / 2.8 ms. One upload per texture per
  frame all through the pour (`perTexMax` 1, no full uploads), points 10.4k at most (8000 pool + the super's). Real time,
  uncapped (60 Hz here): the pour from the rooftops p95 16.9 ms; from 250 m p95 33.5 ms, worst 83 ms, 29 of 251 frames
  over 33 ms. Firehose offline: 49 impacts, 12.3/s, one blast in flight, 91 buildings, L3 27, cooldown 57.7 s; mega at
  50 %: radius 90 m, cooldown 30.2 s; audio peak 0.81, nothing over 0.99.
- **Not this branch's, seen here:** the street sign's and the rooftop gardens' programs link on their first use, in
  flight: 170 ms at the first sign, ~300 ms at the first L2 and L3, on MAIN too (`blast.mjs perf`: 172 and 332 ms). A
  firehose reaches L2 within a second, so a player's first firehose has those two hitches until perf/load's warm-up lands
  (`registerWarm('roof sprouts', ...)` is there already). And 250 m over Alamo is 1.8M triangles and 200 draws at cruise
  on MAIN too, over the budget; the firehose adds 22 draws and ~100k triangles on top (`__stats`).
- **Merge review, confirmed findings** (reviewed 89663c5; all on this laptop's GPU, nothing yet on a real iPhone):
  - **A super's blast is capped by its area** (`config.splat.megaBuildingsCap` 480; mega and closer, not taps or hose
    impacts). The cap grew with r and stopped at 96 while the buildings in reach grow with r squared: the longer the
    charge, the more grey blocks inside a rainbow street grid. The cap now is `maxBuildings * (r / blastRadius)^2`, up to
    480. It lives in `barf` (a super's tag, not a hose) rather than a new `BarfOpts.cap`, so the closer, which had the
    same bug, needed no second copy. Buildings by centroid inside r, painted of them, before -> after: Outer Sunset 98 %,
    r 161: 96 of 192 -> 192 of 192; Alamo 98 %, r 159: 141 of 141 (it was 96 of 112 inside 0.9 r); full charge near Lower
    Haight from 283 m, r 298: 96 of 477 -> 473 of 473 (farthest painted 158 -> 298 m); Outer Sunset from 258 m, r 285: 479
    of 505; closer from 240 m, r 165: 183 of 183. Spots under the old cap stay as they were (Mission 72 of 72). The new
    cap bites only near the top of the climb: Outer Sunset from 371 m, r 343: 480 of 808, farthest 305 m, nearest first,
    so what stays grey is the rim, and the picture still reads as one disc.
    Cost: `barf` 28-45 ms and the release frame 38-53 ms (it was ~41 ms at the old cap), once per cooldown; `deal`'s
    O(n^2) stayed small enough to leave. Taps unchanged (`blast.mjs perf`: 148 draws; 7/7 glint == hit, 48/48 carves).
    Draws: up to 225 at 283 m, where cruise is already ~200 (see above); blooms add no draws by design, but this run has
    no A/B. Sparkles reach the 8000-point pool at these sizes. Paint survives a reload (109 buildings, 2575 ground samples).
  - **The reviewer's unexplained 180 ms frame ~3 s after release is the first street sign's link**: `info.programs` goes
    21 -> 23 on that very frame (176 ms). Not the cap; it costs 22 ms on a later page of the same browser.
  - **First firehose, corrected:** not "two hitches": see HANDOFF "Known issues" (gaps 333, 250, 250, 217, 150, 133 ms
    in a fresh browser, five programs). Not fixed here: perf/load's warm-up is the fix, and it conflicts in `main.ts`,
    `PixelPipeline.ts`, `City.ts` and DECISIONS, so it is merged after this and deployed with it. **Measure links in a
    fresh browser:** on a second page the same run shows nothing over 17 ms, because the links are cached.
  - **"No press is dead" now holds across the end of the cooldown:** a press told "not yet" that is still held when the
    cooldown ends splats on its lift. Real Space press, belly full: `lastShot` moves. (A belly still refilling gets the
    tap's denied sound, not silence.)
  - **A mega with a part-full belly stops at the wall** (`Aimer.aimShot`: the aim point, the pick, `occlude`, the same
    Shot as `fire()`): `update()` keeps no target while the belly refills, so that branch had skipped the rule that the
    jet never flies through a building. FiDi, belly 0.5: `wall: true`, target = the wall that glinted (16014), landing on
    its face, no longer ~46 m behind it.
## Super splat, outside judge round 1: the first pour, the floor, the hold (MAIN d6fa4a6 vs NEXT)
The judge failed the branch (`shots/local/judge-supersplat/round-1/REPORT.md`, untracked): every player's first firehose
hitched five times, and a hold under ~50 % was a tap with a lockout. All numbers: 393 x 852 at 3x, real Edge, this
laptop's UHD 620, a fresh browser per run.
- **The first pour's cost was the links after all.** The judge's "1.4 ms" timed `LINK_STATUS`, which three.js doesn't
  read first: a CPU profile and every GL call timed show `getProgramInfoLog` (three's first query, where the main
  thread waits for the link) at 939 ms over the pour, 400 ms of it in one frame. The rest of the gaps were ANGLE's
  draw-time compiles in the GPU process. Five programs: the gardens' batches and sun twins, the sign's blade and caster.
- **perf/load's warm-up is on this branch now, as a kit.** `src/render/warmup.ts` is that branch's file, byte for byte,
  with `PixelPipeline`'s warm section and `registerWarm('roof sprouts', ...)`, so its merge lands on top. Boot is NOT
  perf/load's: nothing else moved. `main.ts` warms the post passes, the gardens, the signs and `SuperFx` after
  `onResize()`, in parallel (`KHR_parallel_shader_compile`), and the first frame waits at most `render.warmWait` (6 s; it
  goes on in the background past that, and no phone waits forever on a compile). `SuperFx`'s own 3-frame warm-up is gone.
  Report here: 10 programs, 6 draw rounds, done in 1.55 s, during the city's download: cold load to ready 10.4-10.8 s vs
  10.1-10.6 s before (it hides under a 7.5 s first-frame compile perf/load still has to fix).
- **One fix to the kit:** `warmDraw` binds the sun's target first even with no sun proxy that round. A scene proxy drawn
  before the sun map's first use sampled a depth texture that didn't exist yet: GL dropped the draw (`INVALID_OPERATION:
  Mismatch between texture format and sampler type`, seen once in about ten boots). Port this to perf/load when merging.
- **Numbers, first firehose, rAF gaps ms p50 / p95 / p99 / max:** before 16.7 / 16.9 / 250 / 400 (5 gaps over 100);
  after, 8 fresh browsers: 16.7 / 16.8 / 16.9 / 17.5 at worst, no gap over 18, no long task, 0 programs linked in flight.
  A first tap: 3 gaps of 133-233 ms -> one, the first gesture's `audio.unlock()` (183 ms, HANDOFF known issue). Over
  never-painted ground ~860 m on (new sprout cells): max 17 ms. Later pours in the painted block: p95 17-33 ms, max 50, in
  the judge's range too (the same block, heavier with every pour on this iGPU; no long task, nothing to warm).
- **A mega has a floor.** `megaFloor` 1.6 at `superMin` (and `megaWidthFloor` 1.5, `megaHitStopFloor` 6, a harder kick),
  rising to the same x2.6 near a full charge. The judge's spot, 40 %: radius 74.9 -> 105.6 m, painted within 160 m of the
  aim 32 of 102 -> 53 of 102 (a tap: 34 of 139 by MAIN's aim at that spot); cooldown unchanged, 24 s, for an unmistakable
  blast. The cost of the bigger blast: `megaBuildingsCap` already scales with its area.
- **The hold is taught once.** Under a press nothing said it existed. `HOLD SPLAT TO CHARGE` (touch), `HOLD TO CHARGE`
  (tilt), `HOLD SPACE TO CHARGE` (keyboard), through `hud.toast`, when the belly first fills again after a splat: the
  player knows the tap by then. Once a session, until a mega or a firehose (`strugglebus.superhint.v1`, a per-viewer
  convenience in localStorage: lost, the line just shows again). Checked by real touches: shown 4.9 s in; no second
  line on the next refill; none after a reload once a mega was fired.
- **The motes are a funnel, not a cloud.** They read as confetti drifting across the screen. Now six ribs, one hue each,
  twist down a cone from the mouth along the nose, dipping toward the city (`funnelDip`, `funnelOpen`, `funnelTwist`,
  `funnelScatter`), computed in the vertex shader from the live mouth and axis as before, growing in far out and thinning
  as they rush in. Same one draw, no CPU per mote after its birth. The rate starts at 20 % of full (10 % read as nothing).
- **The summoning circle no longer splits.** On "whatever faces up" it broke in two across a roof and the street at its
  base, with the parallax between them. Each pixel's ray now meets one plane through the wheels (the drop shadow's
  underside y): one unbroken disc around the bus, covered by what stands in front of the plane, over any surface below
  it. It reads the same at street level and from 250 m. No draw, no program, the same palette steps.
- **The ground under a pour is one picture.** Twelve impacts a second, each its own pinwheel, was a 6-hue patchwork. A
  solid hue per impact, climbing the rainbow, was tried first: the bus crawls while it pours, so discs overlap
  nearly whole, and the ragged rims of the last few hues stayed a quilt. Now hue is a function of the ground point, not
  the impact (`LAYOUT_BANDS`, `bandHue`): rainbow rings around where the pour first landed, `firehoseBand` 17 m wide
  (grown with the drop like the blast), their edges wobbling with the world. Overlapping impacts agree by construction,
  the closer included, and a swept stream paints arcs of one rainbow. Roofs keep the dealt rainbow. Generic: no city data.
  `ox`, `oz` travel on the spec; older saved specs still read. Saved tiles are masks, so rings survive a reload (checked).
  `work` through the pour stays p95 5.2 ms, max 12 ms, 116-172 draws, at most 1.35M triangles, 10.4k points.
- **`f_sproutVertex`'s warning is gone** (`SproutV` fully initialized, one return: FXC warns on a struct's early return).
- Idle parity holds: 60 fps at all six `fps.mjs` spots, 124 / 135 / 164 and 112 / 143 / 72 draws, 1.20 / 1.23 / 1.40M and
  0.71 / 0.87 / 0.48M triangles, as before; 1 % lows 53-57. Strobe: 0 frames over 30 % near-white (max 20 % street, 26 % at 250 m).
  Bundle 1095 -> 1111 KB (1053 on MAIN); programs at ready 21 -> 26 (all were built in flight before).

## Tilt to fly, touch to fly, turbo gears (producer: "world class phone tilt to fly, on by default for phones"; "fly from SF to Tokyo across the Pacific, manually, using some sort of turbo modes")
- **Tilt is the default on phones; touch is the fallback and an option.** A
  desktop (fine pointer + hover) flies the keyboard + mouse bungee as before.
  On a phone the first touch is a pixel title card, "TILT TO FLY": its tap is
  the user gesture iOS needs for `DeviceOrientationEvent.requestPermission()`
  (called synchronously in `touchend`) and the moment the neutral pose is
  taken. Where no permission is needed the sensor is probed quietly first and
  only a phone that really sends motion gets the card. No sensor, a refusal,
  or no event within 1 s (`config.tilt.eventTimeout`; an iframe that refuses
  motion sensors, like the claude.ai preview) falls back to touch with no error
  (a "DRAG TO STEER / TAP TO SPLAT" hint), remembered for the session only
  (`sessionStorage strugglebus.notilt`), never as the player's choice; the
  player's own choice in settings or "USE TOUCH INSTEAD" persists
  (`localStorage strugglebus.controls.v1`: mode, sensitivity, sound).
  `?controls=tilt|touch|keyboard` forces a scheme.
- **Only gravity steers.** The fused attitude (gyro + accelerometer:
  `deviceorientation`) becomes a quaternion (W3C Z-X'-Y'' = three's 'ZXY')
  and gravity is read in the device frame through it. The compass angle
  cancels out exactly, so turning around, a magnetometer settling or yaw drift
  never steers (a full 360 degree turn while held: stick 0.000), and gravity
  is continuous where the Euler angles flip (beta through +-90 degrees, the
  phone pointing up: a sweep from 20 degrees back to 40 past upright has its
  gamma flip and a monotonic pitch, largest step 0.54 degrees per sample).
  It is read in the screen frame (screen.orientation.angle), relative to a
  neutral gravity, as the swing (shortest arc) from neutral to now split
  along the neutral frame's horizontal axes: the screen's right axis (pitch)
  and the horizontal axis through the screen (roll). That split is the same
  held flat, at 45 degrees or upright, in portrait and landscape (identical
  curves in all seven holds tested, no sign errors, cross-talk < 0.05). Turning
  the phone to landscape keeps screen-frame gravity, so the neutral stays put
  and an eased recenter follows 0.35 s after the screen turns.
- **Mapping: the thumb's exact stick.** Roll -> sx (right edge down = carve
  right), pitch -> sy (top edge toward you = pull back = climb; away = nose
  down: dive, and at the rooftops surge): it feeds Input.state.stretch, so
  Flight, the camera and the aim see exactly what a thumb would make and the
  feel tuning stays shared. Dead zones 1.4 / 2.2 degrees, expo 0.45 (fine near
  center), full authority at 30 / 26 degrees divided by the sensitivity
  (settings: 0.5 to 2 in 7 steps). Pitch starts at the yoke's 14 % dead band
  past its own dead zone (`yokeComp`), so a gentle tilt climbs gently instead
  of doing nothing for 7 degrees. Past 58 degrees from neutral the stick fades
  out (the phone is being turned or put down). Tilt -> flight (flat world,
  3 s): roll 5 / 15 / 30 degrees -> sx 0.07 / 0.32 / 1.0 -> 0.10 / 0.46 /
  1.44 rad/s; top toward you 5 / 15 / 26 -> climb 8 / 16 / 40 m/s; away 5 / 15
  / 26 -> dive 2 / 15 / 48 m/s up high, surge 35 / 53 / 99 m/s at the rooftops.
- **No lag, no jitter.** One-Euro filter per axis on the sample clock, its
  rate from raw sample to raw sample (the paper's difference against the
  filtered value reads a 0.05 degree lag at 60 Hz as 3 degrees/s, which broke
  both the prediction and the stillness test), then a prediction to the frame
  time from the filtered rate (the sample's age plus the filter's own lag,
  capped at 20 ms). Parameters from a sweep (tools/controls-sim/s_tune.ts):
  added latency vs the true angle at frame time 1 / 1.5 / 3 / 7.5 / 9.5 ms for
  0.5 / 1 / 1 (frame on the sample) / 2 / 0.25 Hz sweeps (one 60 Hz frame is
  16.7 ms; a plain one-pole at the rest cutoff would add 100 ms). At rest with
  0.15 degree sensor noise and a 0.4 degree 9 Hz tremor: raw 0.33 degree std
  -> 0.14, and 0 of 600 frames leave the dead zone; a held 12 degree carve
  through the same noise: sx 0.227 +- 0.005.
- **Calibration and recentering.** The neutral is the mean of the first
  0.18 s of samples after the card's tap. RECENTER (top-right button in tilt
  mode, and in settings) eases the neutral to the current pose over 0.25 s
  (never a jump). Auto-recenter: held still (smoothed drift under 4
  degrees/s for 1.4 s), posture offsets drift back with a 6 s time constant,
  pitch within 4.5 degrees and roll within 2.5 (the wider bands first tried
  walked the neutral away under a staircase of small held tilts). s_tilt: a
  4 degree sag (sy 0.16) is back to 0 after ~6 s; a held 6 degree climb stays
  at sy -0.22 for good, it is never "corrected"; a staircase of held
  -4 / -8 / -12 / -16 degrees reads -1 / -5 / -9 / -13: the neutral walks 3
  degrees and stops, and returning to 0 reads 0.8 (inside the dead zone); a
  15 degree carve held 10 s still carves at sx 0.31.
- **Splat input (the shared contract with feat/supersplat).** A tap splats
  (onTap); a press held `config.splat.holdThreshold` (0.3 s) without turning
  into a steer or swipe starts the super splat's charge (onChargeStart,
  state.chargeHeld = seconds since the press, onChargeEnd(held, cancelled);
  cancelled = slid off, pointercancel, a lost touch, focus lost). Tilt mode:
  the whole screen is the splat button, a vertical swipe (38 px within
  450 ms, mostly vertical) shifts a turbo gear, swipe up and keep the finger
  down boosts, a second finger while the first is held taps. Touch mode: the
  bungee is untouched (a still thumb past 230 ms steers at neutral, as ever;
  it never charges), a dedicated splat button in the thumb zone taps and
  holds, the second-finger tap stays. Keyboard: Space tap / hold, E / Q (and
  PageUp / PageDown) shift, Shift boosts. Presses are timed by their events'
  timestamps and a charge is confirmed on a second frame, so a release queued
  behind one slow frame is still a tap (found on SwiftShader, where a 90 ms
  tap spanned a 5 s frame and read as a hold). The full tap / hold / drag /
  swipe table (36 gestures, offline through the real Input):
  shots/controls/sim/gestures.json. Until the super splat lands a press held
  past the threshold still splats on release (`input.onChargeEnd` in main.ts,
  a stop-gap feat/supersplat replaces): no press is ever dead.
- **Turbo gears.** G0 is the classic flight (30 m/s released, 112 surging).
  G1 "Jet" 450 m/s needs 150 m above the ground: shifted up low, the gear's
  floor rises under the bus at 75 m/s (Flight rides it like a higher roof:
  the rooftop floor, the hard floor and `lift` are untouched) while it claws
  up at full surge, straining (wheeze, a squint, a rattle of a game pixel or
  two, backfires, a rising whine); at its height the gear bites (two backfire
  pops, a camera jolt, a fov punch) and spools up; passing Mach 1 it booms (a
  white-hot vapor cone with a rainbow rim, a ring of vapor and rainbow puffs,
  a palette flash, a jolt, the N-wave's two cracks and a rolling rumble), and
  a six-hue contrail and speed lines stream behind it. Measured on the real
  city at Alamo Square: shifted at 48 m, 138 m 1.6 s later, engaged, Mach 1
  1.0 s after that, 449 m/s 4 s after engaging, riding 150-165 m up. A
  downshift brakes (the spool and brake rates ease in over 0.35 s: no jolt):
  460 -> 210 m/s in 1 s, 94 in 2 s, 33 in 4 s, holding the altitude (the yoke
  dives back down). Holding the turbo boosts the gear x1.3 (G1: 571 m/s; G0: a
  full surge). Steering authority falls as (surge / speed)^0.55: turn radius
  18 m cruising, 132 m surging, 1.3 km at G1 (0.35 rad/s, a U-turn in 9 s);
  the yoke's climb and dive grow as (speed / surge)^0.5.
- **G2 "Stratos" (4.5 km/s, 2 km up) and G3 "Rainbow Warp" (30 km/s, 10 km
  up: SF -> Tokyo's 8,300 km in ~4.6 min) are implemented and LOCKED**
  behind `config.turbo.worldTravel = false`: shifting up past G1 answers
  "LOCKED: WORLD TRAVEL COMING" (a red banner with a shake, a clunk and two
  low buzzes). With the flag on (offline): G2 climbs to 2 km in 3.3 s, the
  soft ceiling rises with the gear, it cruises at 4,500 m/s, the camera stays
  above and behind the bus. The world beyond the map doesn't exist yet: the
  map-edge homing is unchanged, and near the edge a gear's speed fades back
  to the surge over the distance its brake needs, so the homing can turn the
  bus around (735 m past the edge at most at G1).
- **Camera with speed.** The follow spring's own lag already pulls the
  camera back ~2 x speed / (2 pi followHz) (77 m at 450 m/s): on top of it a
  25 m pull, a 5 degree wider lens and the bus 1.25x (it still reads), with
  40 % of the lag cancelled at G1 and all of it from G2 on (it was 900 m at
  4.5 km/s and, in a 700 m/s climb, dropped the camera under the bus). The
  lens follows the turbo speed eased and snaps exactly once close, so a held
  gear's lens is perfectly still (a breathing lens rescales the snapped pixel
  grid); the shift and the boom punch the fov on a damped spring. G1 at
  speed: camera 243 m from the bus (175 at cruise), 82 m above it, 29 degrees.
- **The HUD: the no-HUD rule still holds at rest.** Tilt needs a recenter and
  a settings panel, touch needs buttons for a hold and for gears; nothing else
  gets to stay. Flying tilt with nothing happening the screen is empty. Each
  thing earns its place:
  - settings + recenter (phones): fade out 6 s after the last touch or change
    of scheme; a tap in that corner only brings them back (faded out they
    catch the tap instead of splatting), the next one works;
  - a desktop has no buttons: Esc opens the settings, which are also its manual
    (the keys), and a first visit gets one toast with the keys;
  - the gear readout: while a gear lifts, for 2.5 s after it shifts or bites,
    while the boost is held, and that's all; holding G1 the contrail and the
    wind say it (it used to stay for as long as a gear was in);
  - LOCKED and toasts are moments; the prompt is the one modal, because iOS
    needs a tap to ask for motion;
  - the touch pad (SPLAT, TURBO lever) stays: touch is the fallback, and it is
    the only way to hold or shift there;
  - the credits line stays when set (attribution is a duty, not a choice).
  Everything is a pixel canvas in palette colors (the street sign's bitmap font
  + a few HUD glyphs, an ink outline on every glyph so it reads on a bright
  phone, dithered dimmers instead of alpha) and safe-area aware. The super
  splat's meter mounts into `hud.slot('super')` (176 x 86, its child centered
  on the floor; the meter is 68 x 86).
- **When tilt can't fly.** The reason decides the message. iOS refused: toast
  MOTION ACCESS OFF / DRAG TO STEER, the settings say MOTION DENIED: REOPEN
  SAFARI (it won't ask again until Safari restarts) and the TILT button stays,
  as a retry. No sensor, or silent past the 1 s timeout: DRAG TO STEER / TAP TO
  SPLAT, TILT is disabled, the settings say NO MOTION SENSOR HERE. Both last the
  session only (never saved as the player's choice); USE TOUCH INSTEAD is saved.
  iOS is only ever asked from the card's touchend: the settings' TILT button
  reopens the card rather than calling requestPermission from a pointerup
  (unverified on WebKit), and the motion request runs before the audio unlock,
  first thing in the gesture. Recent Chromium desktop builds expose
  requestPermission too, so such a device gets the card rather than the probe;
  tools/controls.mjs clears it on pages that mock nothing. Tilt needs HTTPS (or
  localhost): over http on the LAN phones fall back to touch.
- **Cost.** Turbo FX: 3 draws (contrail, speed lines, vapor cone), drawn only
  while visible; one buffer upload per frame for the contrail (96 samples x
  2 vertices x 9 floats), speed lines and the cone are uniforms only; no
  per-frame allocations (the HUD compares numbers, no string keys, and redraws
  its small canvases and writes styles only when what it shows changes). Tilt:
  ~1 us per sample, no allocation. The turbo voice attaches when the turbo first
  sounds and detaches after 2 s of silence: its 5 looping sources and 11 other
  nodes are no audio-thread cost in a session that never shifts.
- **Controls QA (2026-10-30, main e368d29 merged; Intel UHD 620 through Edge,
  iPhone 15 viewport, 390 px; `tools/controls.mjs`, `tools/fps.mjs`).**
  - MAIN vs NEXT at Alamo Square, 60 frames each, A B A B: draws 132 / 132 and
    132 / 131; triangles 1.237M / 1.237M and 1.237M / 1.258M; CPU work 5.5 / 6.2
    and 6.0 / 5.6 ms (the order moves it as much as the build does).
  - `fps.mjs` 8 s, alamo + fidi at street / 250 m / ceiling: MAIN and NEXT both
    60 median, the same draws (64-161) and triangles (0.43-1.2M) at every spot.
  - G1 at the jet, effects toggled on alternate frames: +0 to +4 draws (the
    median is the city's, 22 m on per frame), no measurable CPU work.
  - G1 flown in real time, west side -> downtown -> the bay: 58-60 fps, draws
    106-118 median, 143 max, triangles at most 1.26M, in budget. Frame times have
    p99 27-66 ms and spikes up to 76 ms (5 frames over 50 ms crossing downtown),
    CPU work spiking to 64 ms: chunks streaming in at 5x the surge speed. G0 on
    the same run: 60 fps, p99 21 ms, max 35. The budgeted streaming in polish/perf
    is the fix; not touched here.
  - `shots.mjs` grey / painted / opening: pixel diff MAIN vs NEXT 39 / 62 / 4.8 %,
    MAIN vs MAIN again 35 / 62 / 4.5 %: nothing but the run's own timing.
    `feel.mjs` taps 7/7 glint == hit on both.
  - In the real page: first gesture stalls 170-240 ms inside audio.unlock (the
    sound graph; on main too). `flows`: iOS refused / throwing / silent, settings
    retry, reload in the same tab, Android probe, fade and wake, keyboard + Esc
    all correct; both asks in a touchend. The first run caught a real bug: the
    click after the settings tap landed on the card it had just opened and
    dismissed it (the tap now swallows its click, and the card ignores clicks
    for its first 450 ms).
  - NOT measured: a real iPhone or Android phone. The iOS sheet, A15 fps at G0
    and G1, the feel of the tilt curve and the WebKit gesture rules are synthetic
    or reasoned here, and need the HTTPS preview.
- **Outside review of the controls (2026-10-30): what it caught, what changed.**
  Every capture tool passes `&nohud`, so nobody had looked at a first iPhone run.
  - **The opening waits for the card.** The TILT TO FLY card used to sit over the
    Golden Gate while the opening played behind it, so the first hero shot went by
    unseen. `Controls.holdOpening` holds the opening at dt = 0 (hit-stop's path)
    through the card, the iOS sheet and the sensor settling; `?skipintro` and
    `&nohud` pages never hold. The hold can't hang: refused, silent and
    one-stray-event sensors all let it go (`Tilt.ts` now times out `calibrating`
    too, which had no timeout), and the Android probe holds for at most ~1.2 s
    with no card. The card's touch controls hide with it and stay away behind the
    iOS sheet; the card and USE TOUCH INSTEAD sit either side of the waiting bus.
  - **A gear can't lift the bus over the deck.** The opening's lock only clamped
    the yoke; G1 raised the floor and took the low camera through the cables at
    337 m/s. A shift in the gate is now queued, not dropped, since the game itself
    says SWIPE UP FOR TURBO: the bus threads the deck at 48 m/s and y 5, the gate
    clears, and the queued swipe launches it. (No press is ever dead.) The toast
    over the opening says only TILT TO STEER; the turbo line comes at the gate,
    unless they already swiped.
  - **The press commits, on every source.** Aimer dropped its latch every frame
    while `dragging`, and tilt's dragging means the phone is banked, so the glint
    could swap under the finger. The same held for the SPLAT button and Space
    while something else steers (found following the fix, not in the review). The
    latch survives while tilt is flying or `input.pressHeld`; only touch's bungee
    thumb thaws it. Tilt carves: latch held 63/63 (was 0/48 banked), the glint at
    the press == hit 48/48; SPLAT button while steering 14/14. feel taps still 7/7.
    `adv latch`'s 2 "mismatches" at gamma -20 compare a sample from before the
    press lands (the loop keeps running until CDP's touch arrives), with the latch
    held 16/16 and the glint at the lift == hit 16/16.
  - **G0's boost is the classic rate.** It went through the gear spool, slower
    than not boosting: 60 / 80 m/s in 0.57 / 0.95 s, now 0.17 / 0.33 s (push alone
    0.20 / 0.45 s).
  - **A quick tilt tap forgives like a touch tap:** 26 px within 150 ms (16 and
    22 px wander were dead presses, now taps).
  - Measured after: fps.mjs 60 median at all 6 spots, 1% lows 47.6-56.5, draws
    75-186, triangles 0.49-1.52M (the same as MAIN; 1.52M at the Alamo ceiling is
    just over budget on both). shots.mjs 127 draws / 1.211M grey. G1 over the west
    side in real time: p99 33 ms, max 67-83 ms across runs (it was logged as 76 ms
    downtown); polish/perf's budgeted streaming still has to fix that, and G1 must
    be re-measured on an A15 after that merge.

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
  ground is a straight subtraction. It has no building class (only 1, 2, 7, 18).
- **Fetched only what the bake needs** (`tools/bake/lidar.py`, city-agnostic,
  driven by `"lidar"` in the city json): octree nodes to depth 6 (~2 pts/m²)
  under every 128 m chunk with a building -> 2 m rasters city-wide; nodes to
  depth 7 (~9 pts/m²) around footprints >= 25 m, inside two downtown boxes
  (FiDi, Rincon, Union Square, SoMa, Mission Bay), and wherever the 2 m raster
  sees a smooth roof >= 30 m the footprints don't explain, plus neighbors with
  as much tall LiDAR (`tall_chunks`: 69 chunks, 1550 Mission among them) -> 1 m.
  4,269 nodes, 1.42 GB (the review fixes added 170 nodes, 38 MB), cached in
  the shared `tools/bake/.cache/lidar/` (`$SB_LIDAR_CACHE`; a worktree without
  it warns before refetching). A re-bake downloads nothing.
- **Two statistics per cell**: the highest first return (`top`: roofs, crowns,
  outlines, tiers) and the lowest last return (`low`: a pulse that gets through
  a tree crown ends on the roof under it). Taking every first return made tree
  crowns into houses (Steiner St lots read 26 m, two Victorians rose as 7-storey
  towers over the Painted Ladies; 1,354 small residential lots >= 25 m). Now a
  small residential lot (< 400 m², < 40 m) whose top and low roofs disagree by
  > 4 m (or whose last returns reach the yard) keeps its footprint height, and
  one whose roof is no plane rises at most 6 m (18.5k / 185 lots). Small
  houses that grew > 15 m: 1,192 -> 276. Only for small houses and only
  below 40 m: glass towers scatter multipath ghost points under themselves, so
  downtown the lowest return reads as the street, and the rule collapsed Three
  Embarcadero to its podium when it ran everywhere.
- **Every building's height** is its median rooftop above its mean ground.
  Median, not max: gables and parapets are drawn by the mesher, antennas don't
  count. Footprints that read as bare ground keep their old height (demolished
  since, or misregistered).
- **Tower or mid-rise is decided by the top, not the median**
  (`Massing.top_level`: the highest level that still holds a floor plate of
  120 m² and 5 % of the footprint). On a podium the median is the podium, so
  One Rincon Hill, Millennium Tower, 345 California, Spear Tower, the Hilton and
  Three EC were treated as mid-rises and drawn at 21-64 m; now they stand at
  their 150-200 m.
- **Tiers** for anything whose top is >= 25 m (>= 18 m downtown): the area-vs-
  height curve gets an optimal k-piece fit, each piece a flat step or a ramp,
  smallest k within 3.5 % of the LiDAR volume (mid-rises: 3 tiers within 7 %).
  Pieces are polygonized from the height masks, opened 3 m, simplified 1.2 m,
  squared up within 14°, clipped to the piece below. A piece with the same
  outline as the one below is not dropped any more (that stopped Millennium's
  stack at 48 m): the piece below runs on up. No piece is capped below the
  level it was cut at. A sliver taller than 4x its width (< 8 m) is a fin and
  goes. The part budget (12) goes by volume: the smallest rooftop boxes go
  first, never a piece something stands on (a broad podium's HVAC starved the
  tower above it).
- **Tapers are a per-part byte, not more steps** (Salesforce Tower, 181
  Fremont), but only for a compact tower (area >= 90 % of its hull, minimum
  rectangle <= 1.6:1, >= 60 m), a run >= 40 m that is one shaft narrowing about
  its own axis (several mid-rises ending at staggered heights shrink the area
  curve just as smoothly), a ramp that beats a flat step 2x and the best 2-3
  flat steps by 0.6x (a stepped crown is steps), at most 30 % narrower. Slab
  towers grew hipped pyramid crowns with pale roof wedges before (Four EC, 555
  California's "bullet"). If the tier above doesn't sit on a taper's narrowed
  top, it wasn't a taper. Windows stay on tapered faces: at <= 30 % they read as
  Salesforce's grid, not as stripes.
- **Outlines from the LiDAR** for towers whose top is >= 40 m (within 2.5 m of
  the footprint, off neighbors, IoU >= 0.65); towers >= 120 m keep notched and
  chamfered corners (0.6 m simplify, no corner squaring, 48 vertices):
  Embarcadero Center's serrations as far as a 1 m grid resolves them.
- **Row lots under one roof merge back**: the lot splitter cuts merged
  residential footprints into ~8 m lots by street frontage; where the LiDAR
  shows one flat roof >= 20 m over adjacent lots of one source footprint (and
  that roof stands on those lots, not mostly beyond them), they become one
  building again with the biggest lot's id (492 lots -> 84 buildings): no
  more 30 m apartment blocks painting in 8 m stripes.
- **Slivers of a taller blob stay low**: a footprint whose LiDAR would make it
  taller than 4x its width while most of that tall blob lies outside it (a lot
  overlapping a tower the footprints lack, a misregistered sliver) keeps its
  height and drops out of the coverage mask, so the missing-tower pass claims
  the whole blob (outlines aren't trimmed off slivers); a sliver >= 60 % inside
  that tower's final outline then retires into it: hidden inside, it cost
  triangles and caught the splat meant for the tower (`Splatter.pick` also
  prefers the tallest of overlapping footprints now). sid 1357 was a 184 m²
  lot drawn as a 180 m needle beside an empty tower site; 1550 Mission and
  5th/Howard were 8 m-wide 100-125 m stripes.
- **Towers missing from the footprints are added** from the 1 m raster
  (>= 20 m, >= 300 m², compact, smooth unless >= 50 m; thresholds rise until a
  tower fused to a deck separates): 86 citywide (was 10). A cell counts as
  covered by a footprint (grown 2.5 m) only where that footprint's own top
  explains it (+10 m): a 126 m roof over a lot drawn at 9 m is nobody's. The
  "sliver of a mapped building" test only applies to thin blobs (< 14 m wide):
  next to One Rincon, whole towers were rejected as its offset roof. The bridge
  keep-out is the deck's width (20 m), not 60 m.
- **Merged commercial blocks split** along LiDAR height jumps (>= 4 m), but
  never a block with a tower in it: a tower's setbacks are height jumps too,
  and the split sliced towers into side-by-side stripes.
- **Paint identity**: every part of a building shares its paint texel and
  stableId (a splat blooms the whole tower, saved paint stays valid). Footprint
  buildings keep their rank ids; a merged building keeps one lot's id, the other
  lots' ids retire with them (their old footprint lies inside it). Buildings
  only a LiDAR bake has get ids >= 2^30 derived from what they are, never from
  a counter: split pieces 2^30 + parent * 64 + a hash of their 8 m-grid
  position, LiDAR-only towers 3 * 2^30 + the same hash. A threshold change no
  longer reshuffles every later id (two harness runs with shifted thresholds:
  106 LiDAR ids in both, none on another building). `tools/check-stable-ids.mjs` checks either
  kind of re-bake.
- **The color floods from the top of the whole tower** (not from each tier's
  roof), and the pop squashes about the tower's ground, so tiers never crack
  apart. Street furniture (stoops, bays, belt courses, gables, chimneys) only on
  tier 0; rooftop clutter only where a roof is open to the sky; no parapet where
  the tier above rises flush from the edge (it would z-fight).
- **Obstacles and the far skyline**: the 8 m obstacle grid takes every part at
  its own height, tall parts (> 40 m) grown 6 m (half a cell diagonal: a cell
  that only grazes a 300 m wall must hold it). The far skyline draws one box per
  building >= 20 m (up to its main mass), and a box per big setback (>= 15 % of
  the footprint, at most 4) only for towers >= 60 m: 2,641 boxes (main 2,270);
  per-part boxes for every building over 16 m had tripled it to 7k
  always-drawn boxes.
- **Cost** (paired runs against main, SwiftShader so workMs is noisy): FiDi
  chase view 130 vs 132 draw calls, 742k vs 636k triangles (+17 %; the first
  LiDAR bake was ~790k), workMs 2.8 / 3.2 vs 3.0 / 3.5; SoMa chase 759k (main
  653k), Rincon chase 632k (main 510k); the Alamo Square regression view
  1.12M vs 1.09M triangles (+3 %; the first LiDAR bake +7 % with tree-crown
  houses and 7k far boxes). Draw calls never change (parts live in the
  per-tile meshes). Data: public/city/sf 19.75 MB (main 19.73), largest region
  198 KB, far.bin 299 KB (main 288). Bake ~14 min.
- **Landmark props are not doubled**: within a landmark's `clearRadius`
  footprints are capped at 8 m and never LiDAR'd (Sutro, Transamerica), and
  LiDAR-only detection keeps away from landmarks and bridge decks.

## Tower facades (producer: "very disappointed with the details of the skyscrapers")
- **Six facade families instead of one window grid** (`src/world/towerStyles.ts`,
  chosen in the mesher, no re-bake): glass curtain wall (mullions, spandrels,
  calm sky-reflection bands, a few dark / lit panes, mechanical floors every 20
  floors), pre-war masonry (pale stone, paired punched windows, deco piers,
  rusticated arcade base, cornice and attic, round-headed top floors),
  1960s-70s horizontal bands, 1960s-70s vertical fins (they hide the glass when
  seen obliquely), dark granite with bright slots (555 California) and white
  precast with deep vertical slots (Embarcadero Center). A building is chosen by
  height class, district (FiDi, Union Square / Nob Hill, Civic Center, Rincon /
  Transbay, SoMa, Mission Bay, by Market Street), footprint (big slabs lean to
  bands) and a hash of its stable id; tower-on-podium blocks can wear an older
  podium family. Towers and commercial / civic blocks >= 16 m get one (TOWER
  >= 14 m), outside downtown only from 40 m: 795 buildings in SF.
- **Icons by lat/lon, not by id**: a small table (Salesforce, 181 Fremont, 555
  California, Millennium, Embarcadero Center 1-4, 345 and 101 California, One
  Rincon Hill, 50 Fremont, 44 Montgomery, One Market, the Hyatt) matched by the
  footprint that contains the point and a minimum height, so a re-bake that
  renumbers ids keeps them. Positions go through the bake's own tmerc
  (`llToLocal`, exact to centimeters), not the flat-earth scale `main.ts` uses
  for `?lat/?lon`.
- **Every tower has a base and a top**: two tall ground floors of storefront
  glass between piers over a dark entrance band (masonry: rusticated arcades);
  the top is a mechanical band (louvers, no windows), a cornice (masonry), a
  softly lit band (a quarter of the glass towers >= 60 m) or Salesforce's
  lattice. The aim glint lifts a tower facade in whole steps of its fogged
  ramp (+1, +1 more at the sweep), not by 0.13 of pre-fog light after it,
  which fog rounded away or dithered. LiDAR's small rooftop boxes are mechanical penthouses (solid,
  louvered); setbacks get a coping line. Rows count from the true ground on every
  tier; every wall is stretched to a whole number of column modules so corners
  land on piers and columns run straight up the tower; a tapering face keeps its
  columns (they converge with it: before, its u was scaled about the perimeter
  start, which slanted every column and drew Salesforce's diagonal moire).
- **No dither on a tower facade**: its light is chosen in whole ramp steps after
  the resolve's atmospheric perspective (mirrored in the building shader) and
  written so it lands exactly on them. Pattern contrast still compresses with
  fog, by whole steps.
- **Facade LOD by size on screen, per building and face** (never per pixel, so
  no line crosses a wall): the size of a game pixel at the building (its axis
  point nearest the camera, jittered +-12 % per building so no ring shows) and
  each face's foreshortening decide: columns while a module is >= 3 game px,
  floors while a floor is >= 4 px, then a flat wall tone. Far away a facade
  keeps its rhythm as one-pixel lines at 2x / 4x / 8x the module (>= 3-4 px
  apart, sparser as the pixels grow, none beyond 3 m per pixel or in heavy
  fog): slab lines and mechanical floors on glass, Salesforce's sunshades,
  ribbons on bands, slots on granite and precast, fins, window rows on stone.
  Up high (the marine-layer view) detail needs 1.5x the room and rhythm lines
  2x the spacing: the whole view drifts by sub-pixels with the bus's bob there,
  and every one-pixel line that hops a row counts as crawl. The guard follows
  the view's height (`uHigh`, the marine-layer view's mix), not the fog: after
  fog went off by default it had been reading `uFogLayer2.w`, which is 0 without
  `?fog`, so the vista ran without it. A face seen at a
  grazing angle past the near field keeps only its tone (its floors would be
  staircased diagonals), and rhythm lines also need 2.5 px on the face itself
  (`fwidth`; a guard for grazing faces). (The dotted pixels along Salesforce's
  crown edge in the hero shot are the resolve's dithered halo around its
  glowing LED screen, not facade lines.)
- **Hero details the data can't draw**: Salesforce Tower's open crown is the
  top 52 m of its tapered shaft: white fins (converging) and rings over a
  softly glowing LED screen; 181 Fremont is dark glass wrapped in diagonal
  bracing, with a spire prop on its top box; Coit Tower (fluted column, arched
  lookout, on Telegraph Hill) and the Ferry Building (arcades, nave, the 75 m
  clock tower on the axis of Market Street, a two-storey bay-side wing out to
  where the footprints end) are props. The footprints carried the Ferry
  Building as two rows of 8 m "Victorian" lots (the row splitter cut it) and
  Coit Tower as a 13 m "Victorian" box (stable id 132089) beside the prop's
  base (review: Coit was drawn twice). Both are hidden (`HIDDEN`, SF only): not
  meshed, not building refs (no glint, pick, paint or blast lands on what nobody
  can see; the props themselves are paintable landmarks since fix/landmarks
  merged: `lm:coit`, `lm:ferry`), and their 8 m cells of the obstacle grid are rebuilt as the bake
  builds one, without the lots (`City.setPropObstacles`): the highest ground of
  a 3 x 3 sample, the prop's boxes and the other buildings' parts (grown 3 m, 6
  m over 40 m), then the tree crowns. Before, the grid kept the lots: 5,690 of
  14,303 one-metre samples of the Ferry Building were more than 0.5 m under its
  roof (the bus could fly into the hall; now 117, at the boxes' corners), and
  13 of 184 samples well off it stood more than 6 m over the ground (lots
  nothing drew; now 0). At Coit the stand-in's 98.6 m cells are the hill again
  (90.3 m), its FLATS neighbor keeps its 89.4 m roof.
- **181 Fremont's spire rides its tower** (`SpireRide`): a painted building's
  pop squashes it about its ground (0.18 x 227.9 m = a 41 m drop) and it wobbles
  forever after, in the vertex shader; the spire prop mirrors that formula for
  its one point every frame (no allocation). It binds to the streamed tower and
  stands on `roofAtPart` under it, not on the table's 231.1 m.
- **Painted towers** escalate like the houses: L1 a stained-glass curtain wall,
  a rainbow ribbon of the tower's hue and its two neighbors spiralling up in
  straight diagonal bands about three floors tall (not per-pane confetti: panes
  are sub-pixel from the chase camera), lead lines on the slabs and mullions;
  stone, granite and concrete take the body hue, trims white on two of three
  towers and the complementary on the third, crowns turn gold and Salesforce's
  LED crown runs the rainbow. L2 hanging gardens: a planter band of flowers on
  every third floor (a one-pixel green line far away) and roof gardens with
  bushes along every open setback. L3 Hundertwasser on a skyscraper:
  floor-tall wavy bands through all six hues over walls and glass alike, vines
  and flowers spilling down under every setback, trees leaning out over the
  edges, golden onion domes on the crown's corners. Bushes, trees and domes
  are baked into the building mesh collapsed on their anchors (no draw call,
  no shadow, nothing drawn) and grow out in the vertex shader once the flood
  has passed them at their level. Their triangles come last in the tile's index
  and stay outside its draw range until a building of the tile grows them
  (`City.growTo`): the FiDi / Transbay region (1,-2) carries 18,512 growth
  triangles (12.5 % of its LoD 0 triangles, 55,536 vertices) that cost no vertex
  work in the G-buffer or the sun pass until then. Bounds grow 26 m (not 6)
  for meshes with growth (tips reach ~20 m over a tile's highest vertex).
  Every element is recorded in the mesher (center, reach, grown top with the
  growth's 12 % overshoot) and the obstacle grid rises over the ones a level
  reached (each element's reach grown by half an 8 m cell's diagonal, so a bush
  still lifts its cell): domes stand up to 25.7 m over their tower's top
  (RoofSprouts' raise stops at ~16.8 m), setback trees and bushes over setbacks
  nothing raised. In region (1,-2) painted to L3, 862 of its 1,117 elements
  stood over their cell before; after `growTo`, none.
- **L2 hanging gardens read on glass** (review: Salesforce and 181 Fremont at L2
  were 4.6 % / 5.9 % of pixels away from L1, against 24 % / 31 % from L2 to L3):
  every third floor a white planter rail under a band of green with flowers in
  the hues opposite the tower's (its stained-glass ribbon is the hue and its two
  neighbors, and a green line alone vanished into it); far away a two-pixel band,
  white under green, at least 5 px apart (doubled up to 8x, none beyond 3 m per
  pixel). Pixels changed from L1 to L2 in the hero tower crops: Salesforce 5.7
  -> 8.6 %, 181 Fremont 4.9 -> 5.6 % (L2 -> L3 stays ~29-30 %): it reads, but
  L2 is still the quietest step of the ladder (next: bushes on every crown
  ledge, so the silhouette changes too).
- **Masonry is not brown** (review): STONE's mid steps were near-neutral warm
  greys (L30-50, chroma 2.2-2.7, hue 333 / 4 / 60) that read taupe and rust next
  to the blue-grey city (#4a4649 alone was 3.0 % of the chase-fidi frame).
  Now only the top two steps (the sunlit stone) are buff; in shade it is a cool
  violet-grey (steps 0-5: chroma 3.5-4.5, hue 273-303). (A rose-grey version,
  chroma 5-6 and hue up to 333, read pink in the chase frame: in the grey city
  that says "painted".)
- **The icons stay singular, the grey city grey** (review; a producer call,
  easy to revert in `weights()` / `styleFor`): granite only 0.05 of FiDi towers
  >= 120 m and 0.03 of 40-120 m (was 0.2 / 0.1, next to 555 California), and
  outside the downtown districts blocks under 40 m keep the classic archetype
  look (the review's cream masonry block by Alamo Square was a 17 m civic
  building: civic blocks took masonry 3 times in 4). Family buildings in SF:
  1,100 -> 795 (masonry 578 -> 381, bands 319 -> 218, glass 149 -> 144, granite
  9 -> 7, fins 23, precast 22).
- **Measured after the review fixes** (`tools/facade-shots.mjs --perf --seq`,
  MAIN and this branch at the same frames: chase views now freeze the clock
  while the city streams; UHD 620, the machine loaded by a bake): shimmer
  (residual after per-band shift, 1/30 s apart, frames that moved) main ->
  facade: chase fidi 17.6 -> 15.4 %, soma 14.8 -> 10.8, rincon 19.6 -> 12.1,
  embarcadero 18.6 -> 14.1, alamo 17.4 -> 15.0, the vista at 250 m 12.9 -> 5.1;
  hero drift salesforce 9.4 -> 4.7, 181 Fremont 9.4 -> 5.5, 555 California 8.3
  -> 5.6, skyline 14.2 -> 6.0, Transamerica 16.3 -> 9.6, Millennium 21.6 -> 21.8
  (unchanged). Draw calls +3.7 per view on average over 18 views (the three
  props and their sun-pass draws), triangles +1.7 %. GPU time per frame
  (timer queries, medians of ~100 frames, two interleaved rounds) before ->
  after the fixes: chase fidi 13.6 / 12.9 -> 11.7 / 12.6 ms, soma 15.1 / 15.0
  -> 15.1 / 15.1, rincon 16.1 / 15.6 -> 15.4 / 15.2, the vista 15.3 / 14.9 ->
  14.2 / 13.7. Every capture is on the palette (0.00 % other colors).
- **SF only**: the icons table and `HIDDEN` are in SF local meters; the mesher
  and `City` apply them only when the manifest's origin is SF's (`isSfOrigin`,
  as `heroLandmarks` always did), so another city's buildings in those boxes
  stay.

## Rendering
- **Indexed-color pipeline.** Materials output a ramp index + light level, never
  RGB; the resolve pass picks ramp steps with ordered dithering. Mixing is done
  by dithering, so overlapping paint *can't* go brown, and there is no brown in
  the palette. Warm hues shadow toward rose/violet.
- **Dither only on gradients.** Flat surfaces whose light sits on a step boundary
  snap instead of dithering (no checkerboard walls).
- **Fog = atmospheric perspective first**, then a narrow dithered handover to the
  fog ramp — no sprinkle of fog dots up close. The handover is value-matched
  and tall far shapes stand out of the fog (see Look polish).
- Shimmer: camera translation snapped to the game-pixel grid at the focus depth,
  sub-pixel remainder applied at upscale; dither anchored to the snapped grid;
  telephoto lens to minimize parallax; shadow map snapped to its texel grid;
  outlines fade with distance.
- **Roofs on one ramp** (review: "the far field has more contrast than the
  foreground"): pale gravel, dark membrane and silver paint are light offsets
  on GREY_LIGHT (-0.06 / -0.34 / 0), sloped roofs -0.36, so the fog compresses
  the patchwork with distance instead of keeping ROOF_DARK next to GREY_LIGHT
  (about 90 luminance apart in every fog). Near roofs keep their tones (the
  verifier's re-fit offsets).
- **House windows LOD per building** (same review): one glass band per floor
  beyond 0.6 m per game pixel at the house (~550 m in the 24 degree chase lens on
  the 390 px frame; it was ~340 m on the old 240 px frame), the wall's average
  tone beyond 1.15 m (~1,060 m; was ~650 m), jittered per building; trim and
  belt courses go with the ribbons (they are sub-pixel by then). It replaces
  the vista-only per-pixel melt. Targets (255-300 m) keep their windows.
- **Painted Ladies are calm at levels 1-2** (review: "plaid confetti"): bays and
  gables take the body color, trim only on belts and cornices (no sub-pixel
  window frames), white trim on two of three houses, stained glass bright in
  itself with glow 0.12 (under the halo threshold: no dithered dust). Level 3
  keeps the riot (frames, neighboring-hue bays and gables, wavy bands, every
  window its own hue, glow 0.38), so escalation reads.
- The bus does not cast a sun shadow (with a low sun it would land 40 m away);
  it casts a straight-down **drop shadow** (it grounds the hero; since the
  dragon breath it is no longer the aim reticle, the glint is).
- City streaming: 1 km gzip region bundles (17 MB for all of SF), inflated and
  meshed in a worker; buildings are generated on the phone from compact
  footprints (far smaller than shipping meshes); far skyline = boxes for every
  building ≥16 m + a 64 m terrain grid, hidden under loaded tiles.

## iPhone performance (polish/perf)
- **The sun pass draws casters, not the detailed city.** It rasterizes into a
  1024² map of 0.5 x 1.2 m texels, and its depth bias (0.0009 of a 3 km range
  = 2.7 m along the ray, ~1.15 m of height at the 25° sun) already swallows
  the shadow of anything shorter. Every detailed tile now has a caster proxy
  (`meshCasterTile`): the same building code through a Builder in caster
  mode, positions only, one quad per wall, no undersides, and only parts
  taller than `CASTER_MIN_H` (1.2 m): walls, roofs, gables, bays, stoops,
  chimneys, tall rooftop boxes and water tanks stay; cornices, belt courses,
  bay and parapet caps and small vents go. The caster mode lives in the
  Builder, so new features in `meshBuilding` cast automatically. City-wide
  4.6M caster triangles against 17.7M for LOD 0 (-74 %). Detailed meshes stop
  casting (layer 0 only); coarse regions still cast with their own mesh (one
  quad per wall already).
- **Casters whose shadow can't reach the view are skipped** (`sunCull`):
  the caster's bounding box swept down the sun ray by twice its radius is
  tested against the view frustum cut at the far edge of the shadow window.
  Conservative (a shadow that can land in view keeps its caster), so shadows
  never pop; it drops the tiles beside the narrow portrait wedge.
- **The sun pass is depth only**: the color mask is locked off for the whole
  pass (also for the trees' and gardens' own depth shaders), and the unused
  color target is invalidated, so a tile-based GPU never stores 4 MB of it.
- **Walls: 8 m wobble columns, one for hidden party walls.** The wobble is a
  ~30 m wave, so an 8 m chord strays at most ~0.1 m from it (a third of a
  pixel at the bus); the roof polygon only has footprint corners, so fewer
  columns also hug the roof edge better under the wobble. A side wall with a
  neighbor's wall running the other way along it, whose roof is at least as
  high (within 1 m), gets one column but keeps two rows like its neighbors
  (no T-junction cracks at the corners under the wobble); walls rising above
  a lower neighbor (stepped hillside rows) keep their columns. LOD 0 city-wide
  17.7M -> 12.5M triangles (-30 %). The rows are unchanged.
- **Far terrain and horizon in culled chunks.** The far grid was one
  always-drawn mesh, 42 % of it under the bay. Now: all-water quads dropped,
  4 x 4-region chunks (4 km: seen from 250 m and the ceiling, 1 km chunks
  cost ~30 more draws than the old three meshes and 2 km ones ~20, which a
  phone pays in CPU), box-culled by the pipeline (`userData.viewBox`: a flat
  slab's bounding sphere reaches kilometers above it), each hidden once every
  region with land in it has its own ground in; the horizon hills in 16 km
  chunks. From high up most chunks are in view at once (+11-13 draws at
  250 m and the ceiling in paired runs), so above 80 m of view height (back
  below 60) the far terrain and the horizon draw as one water-free mesh
  each; the chunks are for the rooftops, where a few are in view. The skyline boxes stay
  one instanced draw (its vertex shader already drops boxes inside loaded
  tiles).
- **Prewarm under the opening fog.** One real frame with everything forced
  visible (rooftop gardens of every level in a cell far outside the city, a
  far tree canopy, the sign and its sun-pass boxes), so the programs that
  used to link at the first blast (sign + its instanced depth variant) and
  the first escalation (gardens + casters) link inside the fog. A compile
  alone would miss the sun pass's override variants. The sign's shadow boxes
  got their own depth material (the shared override switched programs
  between them and the buildings every frame). The prewarm frame is drawn
  while the opening's fog bank is the loading screen (~1.5 s in SwiftShader,
  a few hundred ms of shader compiles on a phone); a frame's dt is clamped
  at 0, because the first frame's timestamp predated the loop's start by the
  whole prewarm (the game started at -1.5 s with the bus flying backwards).
- **Streaming.** Bounds come from the worker (the main thread never walks a
  mesh's vertices); indices are Uint16 under 65535 vertices (0xFFFF is the
  primitive restart index); a region going to full detail swaps a tile at a
  time while its merged mesh's draw range shrinks behind them (no holes, no
  overlap, the ~20 MB upload spread over frames), its ground last; adoption
  stops for the frame after `ADOPT_BYTES` (3 MB) of new geometry (three
  uploads a mesh the first frame it's drawn); a coarse region's ground is
  concatenated with typed copies instead of per-vertex pushes; streamed
  meshes drop their JS arrays once uploaded (three otherwise keeps a copy of
  every attribute), and a restored GL context reloads the city.
- **LOD downgrade, re-checked.** The altitude work already coarsens detailed
  regions the view moved away from (hysteresis at 1.4 x the detail radius,
  by distance from the lens), so LOD 0 no longer piles up to the unload
  radius; it refetches the bundle (the browser cache serves it) instead of
  re-meshing the footprints the main thread holds: kept, it costs no
  main-thread time.
- **Canvas without a depth buffer** (every scene pass has its own target; at
  devicePixelRatio 3 that was ~12 MB cleared and stored for nothing). Sizing
  the canvas to the low-res image and letting the compositor upscale would
  also drop the 3M-pixel blit, but whether Safari's compositor snaps a
  fractional CSS translate to device pixels (the sub-pixel camera shift) can
  only be judged on a phone: the blit stays.
- Small per-frame garbage: numeric tile keys for the ground / obstacle
  lookups (the flight model asks dozens per frame), region keys and
  coordinates made once, no vectors allocated in the sun pass.
- **One scene-graph update per frame.** three updates the whole graph at
  every `render()` and the scene is rendered twice (sun pass, G-buffer): the
  pipeline updates it once and renders with the automatic update off; the
  static city meshes skip it altogether, and the culling walks only the
  city's subtree (`userData.cullRoot`).
- **Cost** (`tools/perf-pass.mjs views`, 3 paired runs, main a3b3fa2 vs
  this branch, the bus put back on the same spot before measuring; draw
  calls and triangles for the whole frame, sun pass / main pass; every run
  gave the same counts within 1 %):

  | view | draws main -> perf | triangles main -> perf | sun pass | main pass |
  |---|---|---|---|---|
  | Painted Ladies | 125 -> 113 | 1.22M -> 613k (-50 %) | 622k -> 238k | 598k -> 376k |
  | FiDi | 115 -> 99 | 754k -> 311k (-59 %) | 376k -> 131k | 378k -> 180k |
  | 250 m downtown | 150 -> 144 | 1.41M -> 881k (-37 %) | 786k -> 345k | 620k -> 536k |
  | ceiling | 112 -> 112 | 1.16M -> 918k (-21 %) | 510k -> 359k | 649k -> 559k |

  Sun-pass draws drop with the caster culling (67 -> 52 at the Ladies, 86 ->
  78 at 250 m); main-pass draws stay within +3 (far chunks at the rooftops).
  Up high what remains is the coarse regions' own buildings (one merged
  mesh per region, both passes): a coarser far LOD is the next lever.
- **No compile at the first blast or escalation** (`perf-pass compile`):
  main links 2 programs on the first impact frame (1.9 s in SwiftShader)
  and 2 on the first escalation (2.4 s); this branch links none after the
  prewarm (22 programs at ready instead of 16).
- **Streaming** over a 30 s surge east from Alamo Square (`perf-pass
  stream`, main-thread ms summed over the run): City.update 880 -> 490 ms
  (p95 3.9 -> 2.1 ms per frame), level-of-detail swaps up to 336 ms -> 10 ms
  in one call, building meshes 307 -> 34 ms, tile ground 122 -> 2 ms, a
  coarse region's ground 5.2 -> 1.5 ms (median); the largest upload in one
  frame 15.3 MB -> 3.4 MB (frames over 4 MB: 4 -> 0).
- **Memory** over a 3-minute downtown surge loop (`perf-pass memory`, live
  GPU buffers / JS heap after a forced GC): main ends at 27 / 81 MB, peaks
  at 95 / 161 MB, averages 51 / 108 MB; this branch ends at 28 / 60 MB,
  peaks at 68 / 105 MB, averages 35 / 70 MB (with as many or more regions
  resident). The altitude work's downgrade already keeps LOD 0 from piling
  up (at most 6 detailed regions in both).
## Look polish (the frame-level beauty review, polish/look)
- **A sky band and the horizon at the top of every chase frame.** The chase
  camera put the horizon on the top edge (cruise: 0.1° of sky) and the slow
  diorama had none at all, so frames read as a map. Lowering the camera alone
  shrank the hero ~30% (the review's verifier measured it), so elevation,
  distance and the slow look-ahead move together: elevation 29 / 24 / 20°
  (slow / cruise / surge; was 39 / 31 / 24), distance 155 m (was 175), and the
  look-ahead no longer shrinks when slow (`lookAheadSlow` 1; it was 0.6, which
  tipped the diorama straight down). Modelled and then shot: the horizon sits
  ~5 / 13 / 19% from the top (was off-frame / 0.2 / 16%), the bus ~62 / 60 /
  58% down (was 61 / 62 / 62%), the breath's impact mid-screen (50 / 49 / 45%).
  The bus's on-screen area is held, but not its shape (the review measured
  it, at 240 px): its bounding box is 3-13% shorter (Painted Ladies cruise
  167 -> 145 px, surge 122 -> 117, slow 247 -> 232) and 5-30% wider, and its
  yellow area is 25-33% smaller, because the plum ink edge takes the rim. The vista camera still takes over above the rooftops (its pitch is
  now only ~3° steeper than the floor's, so the blend is gentler).
- **The skyline stands out of the fog.** Past 2.6 km everything was a white
  wall (Twin Peaks to downtown: nothing but the pyramid). `sbFog` now has a
  fog ceiling gated by height (`config.fog.standFog` 0.78 from `standFrom` 50
  to `standTo` 160 m above the city's low ground, `City.lowGround()`: the far
  grid's 5th-percentile land height, 3.6 m in SF, so a city on a plateau
  isn't all "standing" out of its fog; it was metres above sea level, tuned
  for SF; fading back to full fog from 5 to
  `standFade` 10 km): towers, hilltops, the Headlands read as pale layered
  silhouettes with their bases melting into the fog. It is in the shared fog
  function, so the far skyline boxes and the real tiles always agree (no
  inversion where a region streams in); everything below 50 m, the streaming
  edge among it, is buried exactly as before; it is off while the opening's
  fog bank is up (`uFogBank` >= 2) and density, farFull and paint clearing are
  untouched (the verifier's caveats: the loading-screen bank and the paint
  payoff keep their contrast). A shape standing darker than the buried step
  run at least `config.render.fogSliver` of the frame's height (0.0118: 10
  game px of 852, ~0.58 deg), or it is buried: the tops of mid-height shapes
  just over the ceiling's contour hung in the sky band as floating chips. (It
  was a constant 6 px; on the GPU the Twin Peaks and Dolores skylines still
  showed small floating boxes. Same frame, 6 / 10 / 13 px: 10 buries them and
  keeps the towers and Sutro; 13 thins the skyline itself.) All of this is fog-only: main turned the
  fog off by default (`config.fog.enabled`, `?fog` brings it back), and with
  it off the fog ceiling is off too. Landmarks multiply their fog by 0.8
  (landmarks.ts, not touched here): a capped far landmark sits at ~0.62, the
  lower edge of the 0.62-0.68 handover band, so it keeps its own compressed
  colors with at most a few hue-only flips (the handover is value-matched);
  the verifier's clamp in landmarks.ts can follow with feat/facade.
- **The fog handover is value-matched; the sky holds still.** The handover
  jumped every surface (compressed onto step 6 of its own ramp: GREY6, ROOF_DARK6,
  WINDOW6 at luma 0.38-0.56) to pale FOG5 (0.75) through a dithered band that
  slid with the camera: a full-width zipper. Now each surface hands over to the
  FOG step nearest its own luminance (FOG's luma is linear, 0.3955 + 0.071 k)
  and flattens into the silhouette tone between fog 0.62 and 0.76 (flat under
  the fog ceiling: a far tower's one-pixel window grid crawled); silhouettes
  round instead of dithering (no dotted far boxes). The band itself follows
  the fog's own gradient (a few pixels wide; street-level floor
  `config.render.fogBandMin` 0.015, a quarter of the old fixed 0.06): the review's verifier kept the wide band so
  facades wouldn't pop whole as fog crossed it, but with matched values its
  reshuffling dots were the only churn left in it, and a whole facade
  switching is now a hue change of the same value. The sky dithers in screen
  space at every height (it was anchored to the snapped grid: at the floor its
  dots slid every frame of a cruise) and is written with alpha 0, which the
  upscale reads as "don't shift": the sky only turns with the view, so it no
  longer saws by a pixel with the snap's remainder. Surfaces also stop
  dithering as their fog rises (`config.render.ditherHazeFrom/To` 0.3-0.6):
  the ordered pattern is anchored at the bus's depth and far shapes crawled
  across it with parallax. Up high (calm) nothing changes.
- **The street sign stands beside the blast.** It sprang up over the impact
  and covered the bloom (the money shot), level 3 included. It now waits on
  the game clock until the shockwave has reached the blast's edge (+0.35 s),
  then stands on open ground past the blast's far side as the camera sees it
  (radius + 10 m out, 0.45 x radius to the side, away from a turn: off the
  flight line, where the next target glints), searching a small ring for a
  spot off any roof and inside the frame, else the old spot. It grows so a
  font pixel stays >= 1.15 game pixels at that distance (~1.0-1.4x at the
  rooftops, up to 4x from the vista, where it used to be sub-pixel text).
  It stands at its true depth (a 1 m bias): with the old 16 m bias it drew
  over the painted houses in front of it, and at L3 the blade covered the
  upper storeys of the painted row. Spots inside the blast (+4 m) are never
  used (the old fallbacks halfway out stood among the painted houses): past
  the far side first, then beside the blast, then farther past. A spot whose
  pole is seen to its foot wins; else the pole grows (up to 10 m) until the
  blade clears the roofs and crowns in front, never a blade hovering over
  the roofs with no pole. Re-splats of the same area reuse the spot, so the
  standing sign flips.
  Merged with main (fix/landmarks, the 390 px frame): a spot on water (the
  tile's 2 m ground class, `City.groundClassAt`) is never used, so a Ferry
  Building hit doesn't stand its sign in the bay (landmarks' intent); the
  blade's two bottom corners must clear the roofs in front too, not just its
  middle (at L3 a roof edge in front cut the letters diagonally). No open
  spot in frame: ask again 0.8 s later, twice (the camera moves on); then the
  old spot in front of the primary (a landmark's edge facing the bus,
  `City.edgeToward`) only if it stands outside the blast (+4 m), at true
  depth, else no sign: the old 16 m bias drew the blade over the bloom
  there. The whole blade must sit in the frame. A landmark is the bloom
  itself and runs past the blast (the Ferry Building is 200 m long): no
  blade over its box on screen, and when nothing is open its sign stands on
  its apron along the face toward the bus, as far toward an end as the
  frame allows (main stood it mid-face, over the pyramid's base and the
  clock tower). tools landmarks hill poses, sign at +3 s: Coit on the hill
  beside the tower, Transamerica beside its base on the plaza, the Ferry
  Building right of the clock tower on Embarcadero paving (no sign was ever
  on water; shots/look/landmark-signs.png). One sign per name on screen: a second blast in the neighborhood
  flips the standing sign while it is in view and outside the new blast; if
  the new bloom reaches its spot, it sinks (`StreetSigns.retire`) and the
  sign stands anew beside this blast (the painted regression frame had two
  "ALAMO SQUARE" blades side by side, and a reused spot in front of the next
  blast's paint).
  Nothing farther along the sightline may hide the blade either (merge
  review): the pole test samples only the first 60 m, and on Telegraph Hill
  (a tap from the east) the "TELEGRAPH HILL" blade stood 310 m out behind
  Coit Tower's base and read "TELEGRA / H". A spot that passed every other
  test (ring or fallback, landmark or not) now also needs its blade's bottom
  edge seen over its whole sightline at five points across it
  (`bladeSeen`), else the next spot, else no sign. That test uses the real
  footprints and landmark surfaces (`roofAt`, `landmarkSurfaceAt`), not the
  obstacle grid: that is a collision grid (8 m cells, footprints grown
  3-6 m) and stands ~10 m proud of a facade, so it hid the Ferry
  Building's readable sign on its own apron. Trees still count only in the
  first 60 m. Hill poses at +3 s (shots/look/landmark-signs.png): Telegraph
  Hill from the east no sign (no spot in frame is seen), Coit from the
  north, south and west beside the tower and whole, the Ferry Building and
  Transamerica unchanged. It runs only on a candidate that passed every
  other test, so the frames after a hit cost what they did (2nd / 3rd
  largest work 21.7 / 19.3 ms at Telegraph Hill, was 21.9 / 21.5; sampling
  the whole line for every candidate, the review's scratch, took 28-30).
  holdGreen stays 2.2 s (the verifier: once it doesn't cover the paint,
  cutting it only costs reading time).
- **The hero separates.** Its silhouette used its own ramp two steps down
  (#d8722a beside an orange house: contrast 1.28). The bus's ramps
  (BUS_YELLOW, BUS_BLACK) are its own, so the resolve gives their silhouette
  pixels plum ink (BUS_YELLOW step 1, #5e2232: 4.6-8.7:1 against every paint
  hue, warm on the grey) and keeps glow halos off that edge. Detecting the
  hero by its surface id would also have matched 1 in 255 buildings (8-bit id).
- **The one eye reads from behind**: its headlight beam is light, not a
  shape. In the resolve pass, what lies ahead of the lens (beyond the bus) is
  lifted one or two steps up its own ramp in crisp nested bands, with a warm
  core where it leaves the lens and a warm glint on the nose's ink edge over
  the lens (`PixelPipeline.setHeroBeam`, projected with the snapped camera; no
  mesh, no draw call): 42 m ahead, 20 m wide at the end x the eye's openness
  (14 m read as a stick), 6° down. It lights only the grey world (GREY,
  GREY_LIGHT, GREEN_GREY, WINDOW, ROOF_DARK, and since the facade merge the
  unpainted towers' GLASS, STONE, GRANITE: it stopped dead at a tower's
  face): on the relief it laid a cream
  streak over the freshly painted facades, the money shot. It squints to a sliver while barfing and widens on
  the relief. A dithered mesh wedge was tried first: it read as a
  checkerboard (and its glow halo churned the roofs under it); a ground pool
  24 m ahead (the review's first idea) lands inside the bus's own footprint.
- **No more blobs trailing the hero.** The exhaust puff was a white FOG-ramp
  ball (the brightest thing on screen) dissolving through a screen-anchored
  dither; a sooty lit GREY sphere next read as a cannonball. It is now one
  flat mid-pale GREY tone (a step deeper in the sun's shadow), 0.6 m growing
  2.2x over 0.75 s, thinning by shrinking. The drop shadow was a near-black
  INK blob wider than the bus with a checkered halo crawling over the roofs;
  a solid grey oval next was a dark hole punched into fresh paint. It is no
  decal now: the resolve draws whatever faces up below the bus's wheels,
  inside an oval about the bus's footprint along its heading, one step
  darker in its own ramp (`PixelPipeline.setHeroShadow`; roof, street, lawn,
  crown and paint alike), a little bigger with a breath loaded, shrinking as
  the gap below grows (14 -> 50 m). The open bay too (merge review): the bay
  plane writes no outline flag, so the resolve skipped it, and over the
  water (the opening's Golden Gate shot, every bay crossing) the bus had no
  shadow and no height cue; the WATER ramp now takes it (a ~360 px oval one
  step darker on the water at the opening's 2 s and 5 s).
- **The Golden Gate is International Orange**, muted, even in the grey world
  (it is never painted, so color still comes from paint): `Ramp.BRIDGE_ORANGE`
  (row 23, after the tower facades' GLASS / STONE / GRANITE; see Palette rows), shadows to rose and plum, the upper steps dusty (the fog
  compresses distant parts onto them, so they are what reads at range); towers,
  truss, cables and suspenders orange, the roadway asphalt grey, piers and
  anchorages concrete. The review's first ramp was a bright salmon that
  outshouted the bus; its top three steps were dulled.
- **The opening's water mirrors the fog.** It was a dark slab (WATER steps
  1-3) under the bright sky with a hard checkered waterline. The water's light
  is 0.3 + 0.66 x fresnel (was 0.2 + 0.42 x), on both the bay plane and the
  tiles' water class (they match at the shore), and the WATER ramp's upper
  steps climb toward the fog in even luma steps (0.23 .. 0.67, was 0.21 .. 0.49);
  with the value-matched handover the waterline melts into the fog bank.
  The retune changes all water (bay plane, shore tiles, far terrain): merge
  notes for feat/facade and fix/landmarks should re-check shorelines.
- **Tree crowns band instead of dithering.** Their analytic light is snapped to
  the lower quarter of a ramp step, so a band is flat (the resolve rounds it)
  and the leaf-clump noise keeps the band edges leafy; the painted crowns'
  tint edge is a contour (its screen-anchored checker crawled over the
  moving crown).
- **One-pixel features keep their color.** A silhouette pixel with background
  on both sides (cables, suspenders, poles) is no longer darkened: the
  darkening fired on some stair steps of a thin diagonal and not others, so
  cables beaded. The Golden Gate's suspenders are 1.2 m every ~48 m (were
  0.7 m every 32 m: 0.3-0.8 px lines that flickered in and out).
- **Shimmer, measured on the GPU after the merge with main** (390 px frame;
  MAIN e85f5ee vs this branch, real Edge on this laptop; tools/look.mjs
  --seqn=5: four pairs of frames exactly 1/30 s apart per view on the fixed
  game step; `GPX=3 python -I tools/lookstat.py`: block-matched changes of
  more than half a ramp step; numbers in shots/look/numbers.json). The
  cloud's 240 px numbers (and their failing crowns) are superseded; its stale
  captures are gone from shots/look. Fog off (the default):
  - Painted Ladies cruise: all 11.6 -> 8.7%, tree crowns 10.0 -> 7.7%,
    checker cells in the top 15% 1.89 -> 0.09%.
  - Dolores: all 11.2 -> 8.5%, crowns 18.0 -> 12.5%, top 4.6 -> 0.07%.
  - 120 m: all 12.0 -> 9.6%, crowns 10.5 -> 9.1%, sky 0.30 -> 0%, top
    1.98 -> 0.15%.
  With `?fog`:
  - Painted Ladies: all 9.4 -> 6.5%, crowns 9.9 -> 7.0%, sky 0.60 -> 0.25%,
    the fog band 1,287 -> 626 churning pixels (its share 11.4 -> 11.7% of a
    band half as wide), top 5.8 -> 0%.
  - Dolores: all 8.5 -> 6.9%, crowns 9.6 -> 8.7%, sky 1.01 -> 0.35%, fog
    band 1,299 -> 496 px (14.1 -> 11.1%), top 15.0 -> 0.03%.
  - 120 m: all 8.1 -> 6.8%, crowns 9.9 -> 8.5%, fog band 871 -> 637 px
    (8.8 -> 12.4% of a narrower band), top 0.75 -> 0%; the sky 0.36 -> 0.46%
    (302 -> 477 px; three runs 0.31 / 0.55 / 0.46%, main 0.34-0.36%): the
    edges of the skyline now standing out of the fog slide with parallax as
    the bus climbs (shots/look/churn-120m-fog-*.png: red = sky, green = fog
    band). The review's three levers, same frames: a 0.06 band floor makes
    the fog band worse (11.7 -> 13.3%), standFog 0.84 and standFade 6000
    change no pixel in these frames (the silhouettes round to the same step;
    the skyline is closer than 5 km). Kept as is: a ~0.05%-of-frame cost of
    the skyline reading at all, with fog off by default.
  Altitude (tools/altitude.mjs downtown --seq, seqstat): cruise 13.3 ->
  11.4%; 250 m and the ceiling unchanged pair by pair (5.1-5.2 / 8.4-8.6%,
  4.4 / 7.8%). Facades (tools/facade-shots.mjs --seq): chase FiDi 14.5 ->
  10.1%, Salesforce 3.1 -> 3.0, Transamerica 9.6 -> 9.0, 181 Fremont 5.5 ->
  5.8, downtown at 250 m 5.2 -> 5.8 (one alternating frame).
  The crowns pass without the WIP tunables (treeFine 0.2, treeBand 1 stay):
  the flat-light test rounds any neighbour jump of 0.44 step or more, so the
  crowns' 36-byte bands no longer dither; shadow rims round too (a crisp
  edge in place of a dotted one, shots/look/shadow-rims.png). Fog's band
  floor (`fogBandMin`) stays 0.015.
- **Cost** (tools/look.mjs perf: the median of 8 held frames, exact draw
  calls / triangles, CPU work; two runs per build): Painted Ladies cruise
  125 / 1,211,947 vs 125 / 1,213,975 (the lower camera sees a little more,
  the decal is gone), FiDi surge 123-124 / 827-829k vs 125 / 844k, 250 m up
  169 / 1.528M both; CPU work 2.7-3.5 vs 2.8-2.9 ms, 2.9-4.8 vs 2.5-2.6 ms,
  3.3-6.5 vs 3.1-4.8 ms (noise). Facade chase views are one draw lower each
  (FiDi 125 -> 124, Rincon 114 -> 113, Embarcadero 115 -> 114, Alamo 130 ->
  129: the drop-shadow decal), hero views identical. No draw call was added
  (beam and shadow are lit in the resolve). GPU: the fog ceiling adds two
  smoothsteps per fragment; the resolve a few ALU ops (value match, beam,
  shadow oval, thin-feature test) and shares the handover's neighbor fetches
  with the flat-light test; the sliver test fetches up to 2 x 10 texels, only
  on fogged silhouette pixels darker than the buried step (with fog); the
  upscale one extra fetch on sky pixels. Not yet measured with `?fps` on the
  producer's iPhone.
- **Merged with main (feat/facade, fix/landmarks), 2026-10-23.**
  - Palette rows: facade took 20-22 (GLASS, STONE, GRANITE), so
    BRIDGE_ORANGE is 23 (every use is by name). `RAMP_COUNT` 32 -> 48 (an
    8x48 RGBA8 texture, 1.5 KB): 24-31 are reserved for the faction ramps
    (MAGENTA 24, CYAN 25, AQUA 26, PEARL 27, MOSS 28, BIOLUME 29, FAE_VIOLET
    30, SILVERBARK 31; STAGES.md 3.4 rule 7), 32-37 for world travel
    (NIGHT_SKY, OPEN_SEA, LIMB, CLOUD, DRY_LAND, TWILIGHT; WORLD-TRAVEL.md
    2.5), 38-47 spare. 32 rows would have been over-booked (24 in use + 8
    faction + 6 world = 38).
  - One sky function: facade's towers write the light that lands exactly
    on a ramp step after the resolve's atmospheric mix, from a copy of the
    resolve's skyLight(). This branch flattened that sky at the floor
    (slope mix(0.25, 0.5, calm), was 0.5), so the copy is now the same
    function (`GLSL_SKY_LIGHT` in materials.ts, called by both at the same
    calm) instead of a second copy to keep in sync by hand.
  - The review, re-checked on the GPU: tree-crown shimmer fixed (above);
    120 m with fog: the fog band and everything else lower, the sky ~0.1%
    higher (above); drop shadow on paint: a one-step darkening in the
    surface's own ramp (shots/look/bus-zoom.png, the painted frame), no grey
    hole; the puff a pale flat wisp; L3 sign: over grey, legible, its pole
    seen or clear of the roofs (shots/look/ab-sign.png, after the blade
    corner check); headlight: the warm core on the roofs ahead, no streak on
    fresh paint on the relief (eye-zoom.png); fog fragments: the 10 px
    sliver rule (fog-sliver-6-10-13px.png); top-edge stripe: gone (checker
    cells in the top 15% at or under 0.15% everywhere, main 0.75-15%).
  - For the branches still to merge (pre-review notes): feat/supersplat
    hosts its charge pinwheel in the drop-shadow decal this branch deleted:
    re-add it as SuperFx's own decal (pinwheel only, visible while charging);
    its hose impacts must not move `lastBlast` (set it after the hose
    early-return). feat/controls: keep the setHeroShadow / setHeroBeam block
    before render, then the turbo FX position copy. polish/perf: keep both
    PixelPipeline field blocks; the upscale's "alpha 0 = plain sky" contract
    stands (a CSS-scaled canvas would bring back the sky's one-pixel saw).

## Opening + landmarks
- **The opening is the brief's shot**: the bus glides out of a fog bank over the
  ocean west of the Golden Gate, threads the gap 85 m north of the south tower
  (so the tower fills the narrow portrait lens), passes under the deck on a low,
  level cinematic camera, then rises into the normal chase view over the bay.
  The fog bank doubles as the loading screen.
- Golden Gate Bridge and Bay Bridge (west span) are hand-built from real tower
  and anchorage coordinates; Sutro Tower and the Transamerica Pyramid are props.
  (They were grey in Phase 1; they paint now, see Paintable landmarks. The
  bridges stay grey, except the Golden Gate, which is its muted International
  Orange even in the grey world: Look polish.)
- The horizon (Marin Headlands, East Bay hills, San Bruno Mountain) comes from
  the USGS 3DEP 1/3 arc-second DEM, read remotely from the COG's overviews; the
  Marin Headlands near the bridge are baked at 2 m from the same DEM so the
  opening never shows low-poly hills up close.
- Trees: none on steep grassy hills (Twin Peaks, Bernal, the Headlands are bare).

## Paintable landmarks (producer: "the Transamerica building appears unable to get splattered")
- **Why it couldn't be**: the landmarks are hand-built props and the bake keeps
  the footprints under them low on purpose (no doubled towers), so there was no
  paintable building there: the pick, the blast wave and the aim glint saw only
  the 8 m lots inside the pyramid's base, and its material had no paint.
- **A landmark is a first-class building now, generically**: one call where a
  prop is placed (`paintLandmark(city, 'lm:<name>', object)`) registers its base
  ring (the prop's convex hull in plan), its top and a 2 m height field of its
  real surface (rasterized from its own triangles) as a normal `BuildingRef`,
  with a paint texel from a fixed reserve past the baked buildings (32 slots; the
  texture keeps its 138 rows), in every spatial index (`City.indexRef`). No bake
  change, no city data change. Its tile is a one-record tile of its own, so every
  query that takes a ref works unchanged.
- **Saved under its name** (`'lm:transamerica'`, `'lm:sutro'`, `'lm:coit'`,
  `'lm:ferry'`) in a store of its own, `strugglebus.landmarks.v1` (per city:
  `:<slug>`), not among the buildings' ids (the branch first put them in
  `strugglebus.paint.v1`; the merge review found feat/osm drops v1 on its first
  boot, which would have lost every landmark's paint, though a name key is
  valid across any re-bake). No key can collide with a stable id in any
  building store, the OSM re-bake can renumber and drop the building store
  freely, and old saves load as before. A pre-merge build's `lm:` entries in v1
  move over once.
- **Hit where you aim**: the breath lands on the landmark's real surface, never
  at its centroid (the top of the spire, out of the chase view): from altitude
  the aim ray meets the height field (`surfaceAt`); the classic short shot from
  the rooftops slams into the face in its way: polish/feel's `Aimer` ends a
  landmark target's line of fire at most 12 m (`F_CLEAR`) under the bus and lets
  the landmark be the wall it meets, at the point where its surface rises over
  the line (without that the merged Aimer landed the shot 150-200 m up the
  pyramid's slope, the jet through the face). Where a landmark's hull holds
  baked buildings, the one whose roof is higher right there wins (`buildingAt`
  ranks a landmark by its surface at the point): the shot between Sutro's legs
  lands on the transmitter building's roof, not under it at Sutro's base height.
  A blast whose radius reaches the base blooms it with the wave (by its near
  edge, like a big block), and painted landmarks escalate L1 -> L2 -> L3.
- **The look**, in the palette (ramp + light) like the buildings: the color
  pours down from the top over 1.1 s (`config.bloom.landmarkFlood`: at the
  buildings' 55 m/s a 260 m pyramid took ~5 s, and from the chase camera only
  its bottom 100 m are in frame) with fingers of paint running ahead, while a
  splash spreads 34 m from where the breath hit (so the impact frame already
  shows the hit). The hue's ramp in its saturated middle, white trim (gilt at
  L3), stained-glass window bands that melt into the wall window by window as
  they shrink under ~2 pixels (no ring), the lobby in deep shadow of its hue,
  the pyramid's upper spire lit (glow), Sutro's beacons as blinking rainbow rings
  up the masts, and Sutro's red/white bands as rainbow bands (every band the next
  hue: six hues at L1 already). L2 is a garden: vines climb from the ground (big
  leafy lobes, never under ~2 pixels; a spiral up Sutro's narrow legs), the
  pyramid's two wings are planted, every ledge turns to turf. L3 is
  Hundertwasser: wavy six-hue bands, every window its own hue, and real accents:
  a golden onion skewered by the pyramid's spire, onion turrets on the corners
  of its base with bunting along it; golden onions where Sutro's masts leave the
  arms and bunting strung between its legs at 72 and 126 m. The pop is the
  buildings' at 0.3x (an 18 % squash of a 260 m tower was a lot of tower).
- **Accents cost nothing until level 3**: they are the last vertices of the
  prop's own mesh and its draw range stops before them until its texel says
  level 3 (set in `onBeforeRender`): no extra draw call ever, no triangles before.
- **Rooftop sprouts stay off landmarks** (a garden rect at the top of a spire
  floats in the air); their gardens are in the shader. Bloom sparkles follow the
  landmark's shape (four slices up its height, each as wide as the prop there).
- The bridges stay unpaintable for now (brief).
- **Measured** (tools/landmarks.mjs in the real game): from the rooftops the
  classic shot hits the pyramid's west face at the bus's height (55-95 m up) and
  the glint lights it; from 428 m the 20-degree ray lands 214 m up its face
  (drop 208 m: the blast x1.7); a blast landing 40 m from its base blooms it
  (0.18 s after the impact, with the wave); taps escalate both landmarks
  L1 -> L2 -> L3 (hue kept); after a reload both are back at level 3, saved as
  `lm:transamerica: [1, 5, 3]` and `lm:sutro: [1, 0, 3]` among the numeric ids
  (then; since the merge they have their own store, below).
- **Cost** (the pyramid's chase view, everything streamed in, interleaved with
  the branch point a3b3fa2, two runs each, SwiftShader at load ~25): draw calls
  122-134 in both, triangles 843,608 in both (grey); painted at level 3 the same
  draws and +2k triangles (the accents, main + sun pass); CPU work median 5.1 /
  4.2 ms grey and 3.3 / 2.8 ms painted against 3.1 / 4.5 ms at the base: inside
  the noise. One shader program for every landmark material, as before; the
  paint texture keeps its 138 rows; the hull and the height field are built once
  at boot; no per-frame allocation (the accent draw range is set in
  onBeforeRender from the texel, the aim's landmark tests are bounding-box
  checks).

### Merged with main (facade + polish/feel), the facade's heroes adopt it (2026-10-23)
- **Resolved to main where main replaced the branch's code**: polish/feel's `Aimer`
  and `Splatter.barf(x, z, BarfOpts)` (its `landingOn` / `roofAtPart` already land a
  landmark primary on its surface) instead of the branch's aim chord and centroid
  special case. Landmark refs carry the area-index fields and enter the area index
  (`indexRef` -> `areaCells`): since polish/feel every pick, blast wave, line of fire
  and `buildingAt` / `roofAt` reads only that index, so without it a merged landmark
  could never be picked or bloomed.
- **The Aimer's landmark hook**: a landmark target's line of fire ends at most 12 m
  under the bus and the landmark may be the wall it meets (its face where its real
  surface rises over the line), including within `wallSkip` of the landing (the
  hull's edge near its base), where a neighbor never stops it. Measured on the
  merged build: from the north at the floor (bus 25.2 m) the shot lands on the
  pyramid's base wall at 14.2 m, 0.6 m outside the hull (before the wallSkip
  exception: 65.9 m up the slope, the jet climbing 40 m through the face); from the
  west at the floor over the 103 m tower there (bus 116.5 m) on its face at 106.7 m;
  from 428 m 219.9 m up its face (drop 208.7 m). From the west at 6 m/s and 100 m
  out the shot aimed at the pyramid's base takes that tower's roof instead, as any
  wall in the line of fire does (the QA sequence now comes in from the north).
- **Sutro's legs**: `buildingAt` ranks a landmark by its own surface at the point,
  so the shot between the legs picks the transmitter building and lands on its roof
  (263.6 m); Sutro escalates L1 -> L3 with the wave. When Sutro is still the held
  target there, the shot lands on what stands under it (267.8 m: that roof, by the
  obstacle grid) instead of at Sutro's base height inside the building (255.8 m,
  measured before the fix).
- **No invisible walls**: the facade's prop stamp skips landmark refs (their
  one-record tile is the hull at the top: 78.5 m over the whole Ferry hall, 155.7 m
  over Coit's base). The obstacle grid over both props is identical to main's,
  sample for sample (`tools/landmarks.mjs collide`): Ferry hall 17.6-24.5 m, nave
  24.5, bay wing 16.3; Coit's base 100.1, column 155.7 (the post 158.7); a low
  flight down the hall's axis tops out at 31.4 m on both builds. The breath's
  surface now includes Coit's base top (100.1 m where main had the ground, 90.2).
- **Coit Tower and the Ferry Building paint** (one `paintLandmark` each, keys
  `lm:coit` / `lm:ferry`, sign names from `HERO_PROPS[].paint`, SF origin only):
  picked at their center, glinting, flooding from the top with the splash from the
  hit, L2 turf and vines, L3 Hundertwasser bands; the Ferry's 200 m roof took
  white trim at L1, so a plain up-facing surface now takes the hue (trim stays white
  on walls; roofs are turf from L2 anyway).
- **181 Fremont's spire is no landmark**: it stays bound to its tower (SpireRide,
  which moves it with the tower's pop and wobble) and paints and glints with the
  tower's texel (`bindLandmarkPaint(..., { ride: true })`: its shader skips the pop).
  Through the pop its height is the same on main and the merge (231.65 -> 245.35 ->
  239.81 -> 227.97 -> 231.7 -> 231.11 m over 0.03-1.5 s), seated on the roof in
  every frame: no gap, no double bounce.
- **The glint** follows main's contract (a full ramp step, `glintLift` 0.13, plus
  the sweep timed from `uTargetT`, measured up from the bound building's ground), so
  a landmark reads as targeted like a tower, and the spire sweeps with its tower.
- **Saved paint** moved to its own store (see above); after a reload both landmarks
  are back at level 3, the building store holds 36 keys and no `lm:` key.
- **Cost** (main 029c0a9 vs the merge, real Edge on this laptop's Intel UHD 620, 393 x
  852 @3x): no new draw call, program or per-frame allocation (the heroes were one
  mesh each already; binding is once, at boot or when the tower streams in).
  Regression shots: grey 126 draws / 1,203,110 triangles and painted 135 /
  1,248,705 on both, 16 / 21 programs on both. Hero telephotos (grey) identical:
  181 Fremont 147 / 1,004,234, Transamerica 152 / 1,283,680, Coit 71 / 578,100,
  Ferry 120 / 688,639. The pyramid's chase view: 92-113 draws / 725,101 triangles on
  both, a second sample 109-126 / 743,440-745,488 (streaming; main twice, the merge
  three times), painted at L3 the same draws and +2,048 triangles (its accents).
  A blast at the Ferry Building (`tools/blast.mjs` with `SB_BLAST_AT`): 91-99 draws /
  569,179 triangles at the blast against 90-99 / 567,656 (its sparkle slices), then
  564,835 painted and 584,628 escalating on both; CPU work median 2.1-2.7 ms on both.
  `tools/fps.mjs` at FiDi (the pyramid ahead): 60 fps (vsync) on both at the street
  (113 / 704,055), 250 m (133 / 807,622) and the ceiling (64 / 432,140); work median
  3.5 / 4.1 / 1.5 ms on main, 3.6 / 3.6 / 1.3 ms merged.

## Controls: outside judge, round 1 (FAIL) and the fixes (2026-10-30)
Two must-fixes (a silent turbo under the opening's gate; hitches at jet speed), and "the splat still owns
every best frame". All measured in real Edge on the Intel UHD 620, 393 x 852 @3x.
- **Every press answers on its frame.** Under the gate a shift up stays queued (a gear would lift the bus into
  the deck) but now says so at once: the toast "TURBO AFTER THE BRIDGE", the readout "G1 JET / ARMED" dim and
  blinking, the lever armed, the shift's clunk. It fires by itself when the gate clears (lever at 17.8 s -> G1 at
  21.1 s). A shift down cancels it ("TURBO OFF"). Pulling back under the gate says "CLIMB AFTER THE BRIDGE" once
  (at most every 30 s), the first thing a tilt player tries.
- **The hitches were not what they looked like.** `tools/jet.mjs` (no screenshots, per-frame attribution):
  1. `swapRegion`, 25-68 ms + up to 26 ms of first-draw upload every ~2 s: detail nobody can see at 450 m/s, on
     screen for under a second. **`City.detailHold`** (`Controls.tearing`: a gear selected, or still braking):
     nothing changes level of detail, what arrives is coarse. The jet's frames look the same.
  2. 58-76 ms long tasks outside any frame: the worker's message, copied (18 typed arrays per tile, 16 tiles).
     **Everything is transferred now**; the long tasks are gone.
  3. One 50-83 ms stall ~0.15 s after the trail appeared, with the main thread idle: the warm-up compiled the
     trail but `setDrawRange(0, 0)` never drew it, and the driver builds its pipeline at the first real draw.
     **The warm-up draws degenerate triangles.** (All turbo programs now really draw behind the loading fog.)
  4. Deferring swaps would only move the hitch to the brake (up to 67 ms). **Swaps to detail prepare tile by
     tile** on the adoption budget (`prep` items: the off-scene mesh with its bounds, the obstacle scan, which
     were two thirds of the swap), and the swap itself only commits; one swap per frame at most. This helps the
     classic flight too. (polish/perf has a tile-by-tile trim of its own: merge by keeping whichever is simpler.)
  Result, five routes (gate, west, south, east, north), climb + 9 s jet + 12 s brake: jet p50/p95/p99/max
  16.7/16.8-16.9/16.9-17/17.0-17.3 ms, 0 frames over 20 ms, 60 fps, up to 128 draws / 1.12M tris; brake max 17.1-33.4 ms,
  0 over 34; climb max 16.9-17.5 ms, except one 50 ms frame on `north` at 29 m/s just after the shift, with the
  main thread idle (not repeatable on the other four routes).
- **A screenshot is a long frame.** The judge's trace ran beside 3x `page.screenshot` every ~600 ms. MAIN and NEXT
  both stall on it: 12 shots on a quiet machine, MAIN 4 frames > 34 ms, NEXT 3 and 5, p99 33.5-50 ms on both; on a busy one up to 250 ms. Their
  `play.mjs`, unchanged, same hour: pre-fix build 51 fps, p99 66.6, max 699.8, 14 frames > 34 ms; fixed 58.4 fps,
  p99 33.4, max 33.6, 0 frames > 34 ms: its 14 slow frames are the script's 14 shots, one frame each. The p99 <= 20
  ms goal is met without capture (16.9-17) and not with it (33.4), and that is why.
- **Static views unchanged**: Alamo frozen at the same game time differs from MAIN by 0.022% of pixels (one random
  puff), same 126 draws / 1,203,074 tris. `fps.mjs` Alamo, back to back: MAIN 60 / 59.9 / 57.4 fps, NEXT 60 / 60 / 60
  (street / 250 m / ceiling), 124-125 / 135 / 163-165 draws.
- **The contrail is vapor now, not a dither pattern.** The checkerboard was a screen-space Bayer; it now
  dissolves by hard thresholds of noise anchored to the trail's distance (`aDist`), so clumps hold still in the air
  while the bus leaves them, with one pixel of dither at their edges. Fresh it is a clean flag; set, the outline
  billows (the bands follow it), cel steps fold it, it wanders and sags. Stride 10 floats, still one buffer.
- **The rainboom.** From the chase camera the old cone was just a white disc. The boom now throws a rainbow hoop
  (white crest, six hues, red outside): one annulus, one draw for under a second, opening around the bus and falling
  back along its path past the camera. The cone stays as a short white shock.
- **Speed lines are solid**: the dither ate streaks under a pixel wide into dots. 1.7 px, shortened rather than
  dissolved, one in five a hue.
- **Roll and pitch reach full at the same angle** (`rollFull` 30 -> 26): the judge's 0.18 at gamma 18 was the
  hold angle (at 55 deg that is ~12 deg of wheel roll), now 0.22; 15 deg of real roll gives 0.38.
- Still not done: no real phone yet; the A15 numbers are inferred.

## Hybrid controls (producer: "a turbo button ... upper left", "a hybrid tilt and thumb tap", "a somewhat smaller/discrete toggle ... top left corner", "mega splat ... on the side - middle/top right of screen")
The design is `docs/specs/hybrid-controls.md`, sections 0 to 10 built on main (eb35a35). **This overrides "No HUD" and "Tilt is
the default on phones" by the producer's own words**: TURBO, the tilt toggle and MEGA are visible, everything else stays
gone. All numbers: 393 x 852 at 3x, real Edge, this laptop's UHD 620, mocked sensor. **Nothing has been felt on a phone:
every tunable in the "Hybrid" group is an estimate.**
- **The rule.** The phone flies the bus until your thumb flies it. A tap splats. Buttons do what they say. There are no
  control modes any more: `mode` is `touch | keyboard`, tilt running is `controls.tilt.active`, and `Input.update` is the one
  arbitration site. With tilt off `state.stretch` is the bungee bit for bit (`s_hybrid` 1, 312 frames).
- **A thumb replaces tilt, both axes.** Both sticks are absolute: adding gives a standing bias. A tap never disturbs tilt
  (calm window only, 180 ms); a commit (12 px or 450 ms) fades it out in 160 ms; a still thumb reads 0, the untaught "tilt, stop
  it". The lift hands back at most what tilt handed over, or takes the new angle as level (`s_hybrid`: nudge in a 12 degree
  carve 46.1 of 45.0 degrees; body English +3.7, plain re-zero's wrong way gone; new hold +3.7 with stick 0).
- **Producer defaults, one switch each.** Tilt is offered by the TILT TO STEER? chip, not imposed: `config.tilt.defaultOn` is the
  one value to flip. A still press on the screen no longer charges, only MEGA does. Swipe-for-gears is retired. Tilt stays off
  during a boost (a boost is clutched until the lift, and time doesn't count as a new hold for a reach: 3 s boost with a 25
  degree swing 0.0 degrees, two-handed then levelled +10.0). A lapsed iOS grant gets the chip until it is ignored twice.
- **The first run has no card and no hold.** Frame one is the clean hero shot. Coach: arrive at fog end or first touch, TAP on
  a glint, DRAG after the first splat, TURBO blinks at the gate, the chip 2 s after the gate, HOLD on the third splat. Each once
  ever (`taught`). In SF the first glint is ~90 s in if the player flies straight on (the bay), so with no splat yet the chip
  comes first, 10 s after the fog at the earliest.
- **Reconciled with main.** The HOLD SPLAT TO CHARGE line is the HOLD cue on MEGA's face; `strugglebus.superhint.v1` counts as
  taught. A desktop has no MEGA, so it keeps HOLD SPACE TO CHARGE. Mote funnel, rings and warm-up are untouched.
- **Judged tune: the hold hint ends when a charge starts.** `controls.charged()` ends the cue and clears the keyboard's toast.
- **Judged tune: the pour's opening flash.** It wasn't an impact: it was `flash(mouth, 2, 0.9)`, centered on the bus. The first
  try keyed on the landing point and did nothing, the second on 45 to 150 m and did nothing: the street's follow distance is ~125 m
  (logged in the page). Now `flashNear` 130, `flashFar` 320, `flashClose` 0.45, on the flash's own point, one frame when
  close, short of the white-hot core; hose impacts use the same curve. The judge's frame: near-white 28.4 % -> 17.8 % (mostly
  the sky's one frame), bus and stream readable through it, where MAIN loses both. Generic: no city data.
- **Rest is punched, not faded, and only the panels.** `punch(0.25)` over the whole face broke the labels ("TIIIBO", "MEGN"):
  the panel goes see-through, chevrons and text stay solid. Palette only, no alpha.
- **Moved in the build, beyond the spec:**
  - `s_hybrid` 9 measures the wrong-way stick (-0.297 vs -0.316 unguarded), plus the carve's return. By heading unguarded
    wins (47 vs 37, ideal 67), as the spec's own sim says (48 vs 36): the row as written couldn't pass. The guard's value on a
    one-handed reach is smaller than the spec's table suggests: worth a look on a phone.
  - Spec 3 contradicts itself: the landscape chip row (78 %) sits 1 px into the bottom 40, and its hit area 13 px. The table
    stands (it is transient); `s_layout` names the exception.
  - A compact phone turned on its side gets settings' seam at 8 px, not 4, to keep 44 px (not in the tables).
  - MEGA refused by a steering thumb keeps its press (a tap on lift, or a charge) rather than cancelling: no press is dead.
  - The adopted pointer's events are also forwarded from MEGA's wrapper, in case capture doesn't move on iOS, and every button
    unlocks audio on `touchend` too, since a button can be the first touch (the toggle and the chip after their callback).
- **Offline:** s_hybrid 31 of 31 (27 at the first QA, 4 added by the review below), s_gesture 47 rows, s_layout 952 checks, s_perm all, and s_tilt's JSON byte-identical to MAIN's.
- **GPU:** every gesture, tilt off and on, through real CDP touches (`controls.mjs gestures`, `hybrid`, `flows`, `opening`,
  `firstrun`, `layout`, `states`); 28 button states and every layout looked at. iOS asks inside `touchend` with user activation
  active. Refused / thrown / rejected / silent / Android probe / no sensor / Busy / off inside the fade / settings 2 s all as the
  spec's table. Real rects equal `layoutHud` at 393 x 852, 393 x 659, 320 x 568, 852 x 393, swapped or not. `jet.mjs --idle=1`: 0 HUD
  DOM or style writes in 3 s.
- **glint == hit:** 7 of 7 taps, 48 of 48 carves (roll 0, 12, 20, -20) and 12 of 12 taps after a thumb inside a carve, none lost.
  An earlier run read 1 wrong of 12 at roll -20; `feel.mjs` then gained a check for presses that fired no breath and the rerun
  was clean, so that one is unexplained and may be a real rare miss. Watch it.

| fps.mjs, MAIN -> NEXT | fps | 1 % low | work ms | draws | triangles |
|---|---|---|---|---|---|
| Alamo street | 60 / 60 | 52.9 / 54.1 | 4.5 / 4.1 | 123 / 123 | 1.19M / 1.19M |
| Alamo 250 m | 60 / 60 | 48.1 / 54.1 | 4.7 / 4.0 | 166 / 166 | 1.32M / 1.33M |
| Alamo ceiling | 60 / 60 | 52.6 / 54.1 | 3.2 / 4.1 | 157 / 157 | 1.18M / 1.18M |
| FiDi street | 60 / 60 | 53.2 / 52.9 | 3.1 / 2.9 | 111 / 112 | 0.70M / 0.70M |
| FiDi 250 m | 60 / 60 | 56.8 / 56.8 | 2.0 / 2.1 | 121 / 125 | 0.70M / 0.73M |
| FiDi ceiling | 60 / 60 | 55.2 / 55.9 | 1.9 / 1.9 | 59 / 59 | 0.43M / 0.43M |

`shots.mjs` grey 127 / 127 draws, 1.21M / 1.21M, 25 / 25 programs; painted 135 / 134. `jet.mjs` east: p99 17.0 / 16.9 ms, max 17.3 / 17.3,
no frame over 20 ms. Bundle 1111 -> 1133 KB. (The fps and shots runs predate the last flash tune, a two-value change that draws nothing.)

**Merge review, four confirmed defects, all in the controls glue, none in rendering or perf** (each reproduced before the fix):
- **Wrong-way carve after a long thumb session.** Grace went by `moved`, the phone's change, but a long hold in a still carve moves
  the neutral the whole carve. Grace now goes by `max(moved, shift)`. 20 degree carve, 3 s thumb, levelled 0.5 s after the lift:
  -183 degrees and stick -0.61 before, 0.0 degrees and stick 0 after on the GPU (s_hybrid row 20: -101.2 to +3.7, roll 12 -43.3 to
  +3.7). Levelling past the 1.5 s grace is still the spec's known residual.
- **A nudge begun on MEGA lost the carve.** `adoptThumb` never called `land()`, so hand-back used a stale pose and read as moved.
  It lands at adoption, not at the press: tilt owns the stick until then. GPU 14 degree carve: stick 0.342 to 0.342 and no settle,
  equal to the canvas nudge (s_hybrid row 21: -3.4 to 46.6 of 44.9 degrees).
- **The toggle as first touch erased a returning player's choice.** `button2`'s `touchend` ran `onGesture` first, tilt started, and
  the tap read as Busy cancel. Only TURBO, the tab and MEGA keep that listener; `hitTouch` runs it after its callback, tap or not.
  GPU, Android-like and iOS: ends active, `prefs.tilt` true; iOS order `ask, unlock`, inside `touchend`.
- **The chip swallowed drags and took any lift as yes.** `hitTouch(..., steer)`: past `tapSlopPx` the finger goes to `adoptThumb`
  and the press is dead; a lift counts only inside `stillTapMs` and the slop. GPU: a drag steers (stick -0.32) and never asks, 0.6
  and 1.5 s presses never ask, and a real tap on the same chip still asks in `touchend`. (A flick of 13 to 26 px under 150 ms that
  starts on the chip is a splat, as on the canvas.)
- Not changed: `yellowLo` (`#d8722a`, the bus ramp's own entry, hue 25, saturation 0.81, value 0.85) on pressed TURBO, pressed down
  tab and the toggle's On body. It measures orange, not brown, but it reads burnt on dark panels: the producer's eye.
- QA after the fixes: `controls.mjs` gestures, hybrid, firstrun, flows, opening, layout, states; `feel.mjs taps` 7 of 7 taps, 48 of 48
  carves, 12 of 12 thumb-in-carve. `fps.mjs` not rerun: nothing here draws.

**For the producer:** tilt's default (`config.tilt.defaultOn`). **First on a real iPhone, HTTPS preview:** whether `touchstart`
preventDefault blocks the back swipe from TURBO's edge (if it doesn't, that loses the game); whether `requestPermission` is honored
in a `touchend` after a prevented `touchstart`; pointer capture across `adoptThumb`; press-shake, calm, fade, settle, grace and
`stillTapMs`; the reach's swing; real Safari height and insets; whether a probe hears a surviving grant.
## Load time (producer: "about a minute to load on another laptop") — perf/load
- **Where the time went** (deep dive of main e85f5ee): a cold visit downloads ~1.25 MB and
  the worker meshes the opening in 0.1-0.35 s, but 18.85 s of a 24.4 s load was blocking
  shader compilation. three.js compiled the 17 programs one at a time at their first draw,
  and on Windows (ANGLE on D3D11) every G-buffer program compiles twice: once at link
  (target 0 only), again at its first draw into the two-target G-buffer, serially on the GPU
  process's main thread. The building's program takes ~4 s each time. Streaming waited on
  frames (2 regions in flight, asked for from the frame loop), and the 4.2 s opening only ran
  after the last freeze. Repeat visits are fast (the GPU program cache), so every player pays
  this on the first visit and after every shader change.
- **Shader warm-up at boot** (`src/render/warmup.ts`, ARCHITECTURE "Shader warm-up"): every
  program compiles at boot with `KHR_parallel_shader_compile`, then draws once into the target
  it really draws into (never the canvas), so the draw-time D3D variants are paid before the
  first frame too. It warms the live scene, the post passes and registered sources (`city`,
  `trees`, `roof sprouts`, `landmarks`, `bridges`); a one-triangle proxy per (material, object
  kind, vertex layout, pass) carries the real program key and vertex layout. 22 programs, 22
  draws. Three things it had to learn on this laptop:
  - Compiles go out a few at a time (`hardwareConcurrency / 2` lanes; half take the longest
    waiting, half the shortest). Launched all at once they filled the GPU process's compile
    pool, the browser's own raster then waited 1.3-1.7 s for a slot on the GPU main thread,
    and so did our next synchronous query: a 1.5-1.9 s long task.
  - Every synchronous query (link status, uniform tables) waits behind a fence round trip, so
    it never queues behind the seconds of draw-time compiles the last round started.
  - A program's first query makes the GPU process finish loading it (tens of ms, ~170 ms for
    the biggest), and three builds each program's source on the main thread (~100 ms for the
    building's). Both stop after ~25 ms per task.
- **What it can't remove**: the draw-time second compile of each G-buffer program still runs
  one after another on the GPU process's main thread (7-11 s here, the building's 2.7-4.5 s of
  it, depending on the other jobs on the laptop), and nothing can be presented while it runs. So
  it all happens before the first frame (the page shows its fog-grey background), and the
  opening starts after it. It is also why B's first frame comes later than A's (A presents one
  frame early, then freezes). The warm-up also pays upfront for what A compiled in flight (the
  sign, the gardens, the landmarks: ~3 s of that queue). A single-target G-buffer (deep dive
  rank 2) removes the second compile: the bench put everything at ~3.5 s.
- **Streaming primed** (rank 3): `city.prime()` posts the opening's whole want-list right after
  `new City` (8 regions requested at 0.6-0.8 s instead of the last at 12-13 s), up to 10 in
  flight while `city.eager` (until the first ready frame), 2 after. Tiles land and are adopted
  (~12 ms per tick) while the shaders compile.
- **The opening on the wall clock** (rank 4): it advances by real time from the first frame on
  screen (the second frame's callback), not by summed dt clamped to 50 ms; the 15% hold until a
  region has landed stays; same curve. It no longer stretches below 20 fps. Each step is capped
  at 0.25 s (real time down to 4 fps), so a tab switch, a locked phone or a long task moves the
  reveal by 6% at most instead of skipping it (a 3 s stall used to jump it from 16% to 89%).
  0 frame gaps over 50 ms between the first frame and ready (B-1x-4).
- **Boot downloads from the HTML** (rank 5): an inline script in index.html starts city.json,
  far.bin and horizon.bin (the .bin files at low priority, the game's script first) for
  `?city=` and leaves the promises for the game (`bootFetch`); each is fetched once. city.json
  starts at 34-89 ms instead of 268-331 ms.
- **Less before the first frame** (rank 6): the bus and the Golden Gate are built in boot; the
  Bay Bridge, Sutro, the pyramid and the heroes (Coit, the Ferry Building, 181 Fremont's spire,
  which now binds whenever both it and its tower exist) go to a queue, built while the warm-up
  waits (else one per frame early in the opening); ready waits for the queue. Same landmark
  paint order (slots), same obstacle posts from the start.
- **iOS**: DecompressionStream is detected; iOS 15.0-16.3 get fflate (three's copy, a 4 kB
  chunk loaded only there) in the worker and on the main thread (checked with both removed).
  `PixelPipeline.resize` returns early when nothing changed, and resize events are applied
  once per frame.
- **Numbers** (A = main e85f5ee, B = perf/load; `tools/loadprofile.mjs`, a fresh browser per
  run so the GPU program cache is cold, interleaved A B A B, Edge on the XPS 13 / UHD 620, other
  jobs on the laptop at 15-33% CPU):

  | | ready median (min) | first frame | first region | long tasks sum / max | programs |
  |---|---|---|---|---|---|
  | A 1x (4 runs) | 17.1 s (16.7) | 4.4 s, then frozen ~7 s | 5.9 s | 12.2 s / 7.5 s | 17 + 7 in flight |
  | B 1x (4 runs) | 13.1 s (12.6) | 8.8 s | 0.9 s | 0.44 s / 0.16 s | 22, 0 in flight |
  | A 4x CPU (2 runs) | 22.5 s (22.3) | 7.8 s, then frozen ~4 s | 13.1 s | 13.9 s / 5.1 s | 17 |
  | B 4x CPU (2 runs) | 16.6 s (15.9) | 12.3 s | 2.5 s | 3.7 s / 0.9 s (boot JS) | 22 |
  | A 4x + 20 Mbps (1) | 22.2 s | 8.0 s | 13.4 s | 13.5 s / 4.7 s | 17 |
  | B 4x + 20 Mbps (1) | 16.4 s | 12.0 s | 3.0 s | 3.0 s / 0.7 s | 22 |

  Ready is 4.1 s sooner at 1x (-24%) and 5.9 s at 4x; main-thread long tasks drop from 12 s to
  0.4 s; B's first frame comes later, but the opening then plays smoothly (no frame gap over
  50 ms) and nothing freezes in flight. B's first frame = the warm-up (8.0-9.7 s at 1x: the
  GPU main thread's queue of draw-time compiles, 7-8 s of it) + far.bin; ready = first frame
  + the 4.2 s opening. city.json starts at 34-89 ms instead of 268-331 ms (191 vs 1,307 ms at 4x
  + 20 Mbps), each boot file once. Warm reload (same profile, `prof.mjs --reload`): A 4.81 s,
  B 4.99 s. (Under heavier load from other jobs, 40-70% CPU, A took 25-32 s and B 17-18 s.)
- **In flight** (`tools/warmcheck.mjs`: the opening, a climb, three blasts on one building to
  level 3, the pyramid and Sutro from 380-430 m): A created 7 programs after ready (the sign,
  its sun-pass boxes, the gardens, the landmarks) with frame gaps of 367-767 ms and long tasks
  of 394-776 ms at the blasts; B created none, no frame over 100 ms, no long task over 100 ms.
- **Look**: `tools/shots.mjs` grey / painted / opening on A and B look the same (they differ
  where the bus is when the shot is taken, since B renders fewer frames before ready, and in
  the random paint hues). The warm-up's draws land in the G-buffer, the sun map and the glow /
  resolve targets, which every frame clears before use; nothing reaches the canvas.
- **Review fixes**: the opening's step is capped at 0.25 s (a 3 s stall 0.7 s into the
  opening now moves it from 16% to 24%, like main's 16% to 19%, instead of to 89%), and
  index.html reads `?city=` exactly as main.ts does (an empty `?city=` no longer downloads sf's
  boot files for nothing). Re-measured after them (interleaved, other jobs at 16-28% CPU): 1x
  ready A 16.5 s median (min 15.7, 3 runs), B 13.4 s (min 12.5); 4x A 19.7 s (19.6, 2 runs),
  B 14.3 s (14.0); B's opening 0 frame gaps over 50 ms at 1x, one of 117 ms at 4x; B long
  tasks 0.40 s sum / 0.15 s max at 1x. `?fixeddt` opening: the bus is at the same place as on
  A at every sampled time (0.02-7 s). An independent review got the same picture (1x: A 17.4 s,
  B 12.7 s; first region A 6.2 s, B 0.75 s; no warm-up frame ever reaches the canvas).
- **Open**: where `KHR_parallel_shader_compile` is missing (emulated in Chromium by hiding
  it; possibly some Firefox / Windows setups), the warm-up still makes every program before the
  first frame (0 after), but a 3.6-5 s freeze followed the first frame and blasts showed
  333-633 ms frames: draw-time compiles the warm draws didn't pay there. No worse than main;
  check on a real browser without the extension. And the page is plain fog-grey for ~8-9 s
  before the first frame (a static cover of the opening's first frame is the idea, for the
  producer to OK).

## Logistics
- The GitHub connection can't create repositories (403), so the project lives in a
  local repo until `patrickscaptainslog/struggle-bus` exists.
- No deploy credentials in this environment: preview is published as a claude.ai
  artifact; the real Home Screen build deploys from the repo (Vercel).
