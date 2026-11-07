// Every number that shapes how the game feels lives here, so the hidden
// tuning panel (?tune, or a three-finger tap) can edit it live on the phone.
// Units: meters, seconds, radians unless noted.

export const config = {
  render: {
    /**
     * Target width of the low-res framebuffer in game pixels (portrait). 390 = one game pixel
     * per iPhone point (an integer 3x upscale on a 1179 px wide screen); it was 240 (5x), which the
     * producer found too low-res. ?px=<n> overrides it (e.g. ?px=240 the old look, ?px=295 4x,
     * ?px=590 2x) to compare on the phone.
     */
    pixelWidth: 390,
    /** Hard cap on device pixels per game pixel (keeps pixels chunky on tablets). */
    maxPixelScale: 8,
    /** Width of the dithered band between two ramp steps (0 = hard bands, 0.5 = full dither). */
    ditherWidth: 0.22,
    /** Into the haze surfaces stop dithering: from this fog amount to this one the dither fades to plain
     *  rounding (the pattern is anchored at the bus's depth; far shapes crawl across it with parallax). */
    ditherHazeFrom: 0.3,
    ditherHazeTo: 0.6,
    /** The fog handover band follows the fog's own gradient, but never narrower than this at street
     *  level (fog units; 0.06 = the old fixed band). */
    fogBandMin: 0.015,
    /** With fog: the shortest shape that may stand out of it, as a share of the frame's height (0.0071 =
     *  6 game px of 852, ~0.35 deg; 0.0118 = 10 px, ~0.58 deg); a shorter one (the top of a roof just over the fog ceiling's contour)
     *  would float in the sky band as a chip, so it is buried. 3..16 px. */
    fogSliver: 0.0118,
    /** Depth-discontinuity threshold for silhouette outlines (fraction of depth). */
    outlineDepth: 0.035,
    /** Crease highlight strength on convex edges (0..1). */
    creaseHighlight: 0.75,
    /** Distance at which outlines have fully faded out (m). */
    outlineFadeEnd: 520,
    /** Shadow map size (texels): 2048 keeps a shadow texel near one game pixel at 390 px wide. */
    shadowMapSize: 2048,
    /** 16-bit shadow depth: half the memory and bandwidth (-8 MB), but the 2.7 m bias's contour moves by up to 4.6 cm:
     *  ~0.07% of a frame's pixels change by a ramp step, so it stays off until the producer OKs that. */
    shadowDepth16: false,
    /** World-space extent of the shadow map around the camera focus (m). */
    shadowExtent: 520,
    /** At full vista (high above the city) the shadow window widens to this (m) and softens to this strength (0..1)... */
    shadowExtentVista: 1600,
    /** ...centered this far ahead of the bus, on the ground under the view (m). */
    shadowAheadVista: 600,
    shadowStrengthVista: 0.85,
    /** ...and its edge fade (fraction of the window) stays narrow: a wide fade sliding with the window boils. */
    shadowEdgeVista: 0.14,
    /** Sun pass: skip casters whose shadow can't reach the view (off = draw every caster in the shadow window). */
    shadowCasterCull: true,
    /** Vista blend at which the pixels are fully calm (surfaces round to their ramp step, no ordered dither). */
    calmVista: 0.35,
  },

  light: {
    /** Sun azimuth (radians, 0 = +X/east, counter-clockwise looking down). Late afternoon WSW. */
    sunAzimuth: 2.75,
    /** Sun elevation above the horizon (radians). Low = long Hopper shadows. */
    sunElevation: 0.44,
    /** Light contributed by the sun on a fully lit, facing surface (ramp units 0..1). */
    sunStrength: 0.52,
    /** Ambient sky light (ramp units). */
    ambient: 0.3,
    /** Extra light on surfaces facing up (sky dome). */
    skyBounce: 0.24,
  },

  fog: {
    /**
     * Fog and the marine layer (clouds) on or off. Off for now (producer: "just remove the
     * clouds/fog for now"); ?fog turns it back on. Off keeps only a far fade (clearFarFull) so
     * the far plane and the horizon hills never end in a hard cut.
     */
    enabled: false,
    clearFarFull: 20000,
    /** Distance fog density (1/m). */
    density: 0.00125,
    /** Height falloff: fog thins with altitude above this (m). */
    heightFalloff: 120,
    /** Distance at which far geometry is fully fogged (m). Streaming edge hides behind this. */
    farFull: 2600,
    /** Fog ceiling for tall distant shapes: the most fog anything this high gets (0..1, keep 0.76..0.85:
     *  below ~0.68 it would fall into the handover band, below 0.76 the silhouettes keep their surfaces'
     *  one-pixel window grids, which crawl), the heights (m above the city's low ground, City.lowGround:
     *  SF's is ~sea level) over which it takes hold,
     *  and the distance (m) by which it has faded back to full fog (it starts fading at half that). */
    standFog: 0.78,
    standFrom: 50,
    standTo: 160,
    standFade: 10000,
    /** How much painted neighborhoods thin the fog above them (0..1). */
    paintClearing: 0.65,
    /** Fog bank density multiplier during the opening (fades to 1). */
    openingBank: 9,
    openingDuration: 4.2,
    /** Marine layer: top of the fog sea (m above sea level) over the west / the bay / the sunny east side. */
    layerTop: 175,
    layerTopBay: 120,
    layerTopEast: 25,
    /** Half-thickness of the soft band at the top of the layer (m). */
    layerSoft: 26,
    /** Billows on the fog top: amplitude (m) and feature size (m). */
    layerBillow: 13,
    layerBillowSize: 340,
    /** Fog density inside the layer seen from above (1/m) and of the clear air above it (1/m). */
    layerDensity: 0.014,
    layerHaze: 0.00012,
    /** Distance at which everything is fully fogged once the camera is above the layer (m): the horizon hills still read. */
    layerFarFull: 28000,
    /** The layer view fades in as the camera rises this far above layerTop (m): below it the street-level fog is exactly as before. */
    layerViewStart: 110,
    layerViewFull: 260,
  },

  far: {
    /**
     * The far field at all, in any city with a far16.bin: the raster, its boxes, the fade to 34 km and the far plane past it. false, or ?nofar, is the
     * old path, and far16.bin isn't asked for. Not a tunable: no saved value can turn it.
     */
    on: true,
    /**
     * How long the first frame waits for far16.bin once far.bin and horizon.bin are in (ms). In by then, it is part of the first frame; if not, the
     * first frame goes with the plain far ground and the raster is built in when it lands (City.landFar).
     */
    graceMs: 400,
    /** How much of the far raster's tone shows (1 = as baked). */
    toneK: 1,
    /** How much of the raster's wall share shows (1 = as baked). */
    wallK: 1,
    /** Mip bias of the far class map (negative = sharper, and more crawl). */
    classBias: 0,
    /** How much of the far band's fit to the near tiles is on (1 = as fitted, farMaterial.ts CLASS_FIT). */
    fit: 1,
    /** Far boxes start sinking into the raster's tone at this distance from the lens (m)... */
    blockSink: 5500,
    /** ...and are gone at this one: a wall there is a pixel, so nobody sees it go. */
    blockEnd: 7000,
    /** Share of the faces that may light up that are lit (the night's wave: 0 by day, no night exists yet to set it). */
    blockLit: 0,
    /** Glow of a lit face. SKY.md section 9: share x glow <= 0.06 on far surfaces. */
    blockGlow: 0.2,
  },

  /**
   * The held hour (?hour=blue, docs/specs/sky/SKY.md slice S1) and the live sky (docs/specs/sky/LIVE.md, S2), whose nights are that hour. With neither
   * nothing reads this, and the tuner has no such section. The switches are kill switches, live: each turns its part of the hour back to the day's. Under
   * ?hour=blue there is no clock: every number here is the one hour held.
   */
  sky: {
    /** The live sky, read once as the page loads: off, today's day exactly (as ?sky=off). Not on the tuner, which comes after it: set here. */
    live: true,
    /** The live sky's tick (SKY.md 2): the key moves when the shadow tip of a wall this tall (m) would have moved this many game px, at most once a second, */
    tickWall: 30,
    tickPx: 2,
    /** on a frame where the view moved this many game px; held still, it waits this long at most (s) with the sun at 20 degrees and up, none by 10. */
    tickMove: 3,
    tickHold: 60,
    /** The shading vector's azimuth slews this fast at most (deg an hour of sky time): near the zenith the true one swings 180 degrees in minutes. */
    slew: 40,
    /** The blue table: off, the day's palette. */
    table: true,
    /** The blue-hour key, with no sun pass and no shadows: off, the day's sun. */
    key: true,
    /** The sky's bands: off, the day's sky (they need the table too). */
    rows: true,
    /** Graded paint and its cap: off, the day's paint rows. */
    paint: true,
    /** The long headlight: off, the day's. */
    beam: true,
    /** Glass and crown glow raised: off, the day's. */
    glow: true,
    /** The far field's own numbers for this hour: off, the day's. */
    far: true,
    /** Lit windows: off, the day's dark glass. */
    windows: true,
    /** Street lamps, near and far: off, none. */
    lamps: true,
    /** The lamps' pools on the paved ground: off, none. */
    pools: true,
    /** The spans' deck and tower lights: off, none. */
    bridges: true,
    /** The far city's lit faces and cells: off, none (its lamps go with `lamps`). */
    farLights: true,
    /** config.far.fit under this hour: the far band's fit to the near tiles was made with a sun's shadows in them. */
    farFit: 0.25,
    /** The far ground where there is no raster (?nofar, a raster still on its way) is one tone: this much under the day's, or it is a sheet of light beside the city. */
    farGroundLo: -0.16,
    /** The sun's compass azimuth (deg): 261, where it really stood at the mocks' 18:20 PST on 2027-02-20, sun -5.9 deg. The sky's warm side and the key both read it. */
    azimuth: 261,
    /** The afterglow's height: it comes from the sun's azimuth, held this high (deg). */
    keyHeight: 8,
    /** SKY.md's key table: a .34, b .20, k from .30 to .06 across the blue hour. uLight stays mid-range: the table carries the dark. */
    ambient: 0.34,
    bounce: 0.2,
    keyStrength: 0.2,
    /** Where the haze ends: the light the far fade takes a surface to, and, with its own small drop, the FOG step of the sky's horizon (FOG's step 4). */
    hazeLight: 0.62,
    /** How fast the sky's sun side falls away round the horizon (a power of the cosine: 1 wide, 3 art's). */
    sunFall: 3,
    /** Paint stays under this step outside a glint: the top two steps are pale tints (SKY.md 1). */
    paintCap: 5.45,
    /** The headlight at night: reach and width at its tip (m), and how many steps its light lifts at most (the day's 2.6). */
    beamLength: 90,
    beamWidth: 34,
    beamGain: 3.4,
    /** Glow of painted stained glass (levels 1-2, level 3) and of lit crowns; a resting surface stays at 0.55 or under (a crown shows 0.6-0.7 of this). */
    glassGlow: 0.3,
    glassGlow3: 0.5,
    crownGlow: 0.75,
    /** The share of windows lit in the evening: the held hour's, and the live sky's at its city's 18:00-21:30, which runs it by that clock (LiveSky.ts LIT_CLOCK). */
    litShare: 0.3,
    /** A near pane's glow; 0 past the panes, so share x glow on far surfaces is 0 (SKY.md 4.4 allows 0.06). */
    litGlow: 0.25,
    /** The far boxes: config.far.blockLit under this hour. Half of a box's walls can light, so 0.2 of them are lit, at config.far.blockGlow 0.2: share x glow 0.04, the rule's 0.06 at most. */
    farBoxLit: 0.4,
    /** The far ground: the share of built cells lit at their tallest, and their glow: share x glow 0.05 at most. */
    farCellLit: 0.2,
    farCellGlow: 0.25,
    /** Metres between a span's deck lights, on each side, read as it is built. */
    bridgeSpacing: 10,
    /** A lamp's head over the ground (m), read when the list lands. */
    lampHead: 6,
    /** The share of lamps that ever come on (the live sky's wave brings them on between sun -2 and -4 degrees). */
    lampShare: 1,
    /** How far a lamp stands over its 32 m height per metre from the lens: the far mesh's 64 m cells stand a few metres off it. */
    lampLift: 0.002,
    /** Past this distance (m) the lamps thin out with distance, by a stable hash: far off they crowd into rows a pixel apart. */
    lampThin: 4000,
    /** A pool's radius at most (m; each is hashed down to 0.72 of it), read as a tile stamps, and how many steps it lifts the paved ground. */
    poolRadius: 11,
    poolLift: 1,
    /** Pools fade out between these distances from the lens (m): past them they would be a few 2 m texels on a pixel. */
    poolFade: 500,
    poolEnd: 1200,
    /** The live sky's stars and planets (SKY.md 4.6): off, none. */
    stars: true,
    /** Extinction a unit of air (V): the real 0.2 leaves one star in the street's band [SKY.md 4.6]. */
    starExtinction: 0.05,
    /** The live sky's Moon (SKY.md 4.5): off, none, and no moonlight. */
    moon: true,
    /** The Moon's floor, game px across (true: 8-9 at the street); released within 12 degrees of the Sun, so an eclipse is exact. */
    moonFloor: 15,
    /** Earthshine on the dark side at night, in steps of MOON at Earth full from the Moon. */
    earthshine: 1.2,
    /** Moonlight on the night's key (SKY.md 4.5): k = min(max, this x lit / max(sin el, 0.15)), the key times 1 + k. */
    moonKey: 0.22,
    moonKeyMax: 1.5,
    /** The lift at the ceiling's pull (SKY.md 4.15): the view tips up this far (deg) while the bus strains up there, and back, at this rate (1/s). */
    liftPull: 27,
    /** ...only over this height (m): under it the ceiling is a deck's, or a test's (?ceiling=520), not the sky's. */
    liftFrom: 5000,
    liftRate: 1.6,
  },

  city: {
    /** How far around the stream center regions load up high (m); LOAD_RADIUS at the floor. ?loadr= overrides it. */
    loadRadiusHigh: 1900,
  },

  camera: {
    /** Horizontal field of view in portrait (deg). Narrow = telephoto = steadier pixels. */
    hfovPortrait: 24,
    /** Vertical field of view cap when landscape (deg). */
    vfovLandscape: 34,
    /** Distance behind the bus (m). (Closer than the old 175 m: the lower camera sees less roof, so the hero keeps its size.) */
    distance: 155,
    /** Elevation angle of the camera above the bus when cruising (deg): low enough for a sky band
     *  and the horizon at the top of the frame (~13% from the top), the bus ~60% down. */
    elevationCruise: 24,
    /** Elevation when slow (deg) — tilts toward diorama (a thin sky band stays). */
    elevationSlow: 29,
    /** Speed at which the camera reaches elevationSlow (m/s). */
    slowSpeed: 6,
    /** Elevation at full surge (deg) — levels toward the horizon. */
    elevationSurge: 20,
    /** Look-ahead in front of the bus (m), keeps the bus above the thumb zone. */
    lookAhead: 55,
    /** Look-ahead at rest as a fraction of lookAhead (it grows to 1 at cruise and 1.4 at twice cruise).
     *  1 = the slow diorama still looks out far enough to keep the horizon in frame. */
    lookAheadSlow: 1,
    /** Position lag spring frequency (Hz) and damping ratio. */
    followHz: 1.6,
    followDamping: 1.0,
    /** Yaw lag spring frequency (Hz) — lower = turns sweep more. */
    yawHz: 1.6,
    yawDamping: 1.0,
    /** Vista camera: blends in as the bus climbs above its rooftop floor, from vistaStart to vistaFull (m). */
    vistaStart: 25,
    vistaFull: 400,
    /** At full vista: horizontal fov (deg), distance behind the bus (m), elevation above it (deg). */
    hfovVista: 38,
    distanceVista: 270,
    elevationVista: 40,
    /** At full vista the look point sits ahead of the bus so the view pitches down this much (deg): horizon stays in frame. */
    pitchVista: 22,
    /** The bus grows a little at altitude so the hero stays readable (scale at full vista). */
    heroScaleVista: 1.55,
    /** A dive: the view tips over the bus until the place it is heading for is on screen, above the thumb zone. From diveFrom degrees of
     *  nose down, by a full dive the camera stands diveElevation above the bus (deg) and the view pitches divePitch down (deg); it eases at diveRate (1/s). */
    diveFrom: 30,
    diveElevation: 78,
    divePitch: 72,
    diveRate: 1.5,
    /** The look (docs/specs/flight/THUMBS.md): a second thumb turns the view round the bus, the thumb's offset from where it landed setting the angle on a curve, a x + b x^3:
     *  lookDegPerPx at the start (deg per px), and 180 degrees at lookFullPx of thumb travel (px), so a small nudge is a small look and the look behind is still there.
     *  Thumb up looks up; lookInvertY turns that over, against the yoke's way. Sideways is the full circle; up and down it stops at lookUp and lookDown (deg). */
    lookDegPerPx: 0.4,
    lookFullPx: 260,
    lookInvertY: false,
    lookUp: 45,
    lookDown: 50,
    /** How hard the view follows the thumb, and how hard it goes home on the lift (Hz, critically damped): 1.4 is home in about 1 s. */
    lookFollowHz: 3,
    lookHomeHz: 1.4,
    /** A look eases in over this long (s): a flick can outlast the thumb's wait (Input's lookDelayMs), and only its lift says it was one. */
    lookEaseIn: 0.2,
    /** A dive's tilt and a look down together stop here (deg of view pitch): past straight down the view would turn over. */
    lookViewMax: 86,
    /** A tap goes where the view looks, sideways, out to this far off the nose (deg), and down the nose past that: no tail gun. */
    lookAimMax: 100,
    /** The stream stays on the heading through a look held less than this (s), then follows it at this rate (1/s). */
    lookStreamAfter: 2,
    lookStreamRate: 2,
    /** The bus's one eye seen from behind: its headlight beam lights what lies ahead of its face a step
     *  or two brighter, this long, this wide at its far end (m, x the eye's openness), pitched this far
     *  down (deg), this strong (0..1, x the eye's openness; 0 = off). */
    headBeamLength: 42,
    headBeamWidth: 20,
    headBeamPitch: 6,
    headBeamStrength: 0.9,
    /** How fast the vista blend follows the altitude while climbing or diving (1/s); holding an altitude freezes it. */
    vistaRate: 0.9,
    /** ...and how fast it settles once the yoke lets go (1/s), then it holds perfectly still. */
    vistaSettle: 2.4,
    /** The opening: the yoke can't climb until the bus is this far past the Golden Gate (m), so the low camera clears the deck. */
    openingClimbAfter: 230,
    /** ...nor fly lower than this until then (m ASL): the height it holds over the strait where the data has no tile. */
    openingGlide: 24.5,
  },

  flight: {
    /** Speed when the thumb is released (m/s). "Dreamy cruise." */
    cruiseSpeed: 30,
    /** Speed at full upward stretch (m/s). ~90 s across SF. */
    surgeSpeed: 112,
    /** Yoke: thumb pulled DOWN = climb. Climb rate at full pull / at the lightest pull (m/s). */
    climbRate: 40,
    climbRateMin: 7,
    /** Climb rate curve: min + (max - min) * pull^climbCurve. */
    climbCurve: 1.3,
    /** Speed the bus eases toward at full pull (m/s): it trades speed for height. */
    climbSpeed: 15,
    /** Flare: deceleration (m/s²) when a dive meets the rooftop floor, so it never overshoots into roofs... */
    diveFlare: 16,
    /** ...and it grows with the speed, so a pull-out takes about this long at any speed (s): max(diveFlare, speed / diveFlareT). */
    diveFlareT: 3,
    /** The path (docs/specs/flight/NOSE.md): on any dive, and on a pull with a gear or the boost, the speed goes where the nose points.
     *  The path angle at full pull and full push (deg); the stick sets it as stick^noseCurve; it follows the stick at noseRate (1/s). */
    noseUp: 85,
    noseDown: 85,
    noseCurve: 1.3,
    noseRate: 2.6,
    /** The most the bus's body pitches on the yoke (deg). */
    pitchMax: 80,
    /** Vertical stretch ignored by the yoke (0..1), so sideways carving doesn't climb or dive. */
    yokeDead: 0.14,
    /** How fast the plain climb's rate follows the yoke (1/s). */
    yokeResponse: 2.6,
    /** Released above the floor: hold altitude on a critically damped spring (1/s). */
    holdGain: 0.85,
    /** Gentle wheezy bob while holding altitude (m, Hz). */
    bobAmp: 1.3,
    bobHz: 0.3,
    /** Soft ceiling (m above sea level: over the airliners, where the air gives out) and the band below it where the climb fades and the bus struggles (m)... */
    ceiling: 15000,
    ceilingSoft: 150,
    /** ...which on the path is at least this many seconds of the speed (s): a gear's climb levels off with room to spare. */
    ceilingSoftT: 1.5,
    /** How fast speed chases its target (Hz). */
    speedHz: 1.4,
    /** Max yaw rate at full sideways stretch (rad/s) at cruise speed. */
    maxYawRate: 1.35,
    /** Bungee: steering spring frequency (Hz) and damping (<1 overshoots). */
    bungeeHz: 2.4,
    bungeeDamping: 0.75,
    /** Thumb stretch (CSS px) that counts as full deflection. */
    stretchPx: 78,
    /** Dead zone (CSS px). */
    deadZonePx: 5,
    /** Clearance above rooftops and ground (m) — "2–3 stories". */
    clearance: 9,
    /** Extra clearance when the belly is light (after a barf) (m). */
    lightLift: 4,
    /** Sag when the belly is full (m). */
    fullSag: 2.5,
    /** Seconds of look-ahead when computing terrain-following altitude. */
    altitudeLookAhead: 1.6,
    /** Climb spring (Hz) — rises early and smoothly over hills. */
    climbHz: 1.1,
    /** The rooftop floor's rises are eased at this rate before the climb spring sees them (Hz; 0 = raw): no lurch at roof edges. */
    climbSmoothHz: 1.2,
    /** Max sink rate after cresting a hill (m/s) — gives hang time. */
    maxSink: 9,
    /** Bank: maxBank * tanh((lateral accel * bankPerAccel + yaw rate * bankPerYaw) / maxBank): proportional
     *  to the stick, never saturated (rad per m/s², rad per rad/s; maxBank is a soft asymptote, rad). */
    bankPerAccel: 0.014,
    bankPerYaw: 0.2,
    maxBank: 0.7,
    /** Bank spring (Hz, damping) — the wobble you see when straightening out. */
    bankHz: 1.7,
    bankDamping: 0.48,
    /** Obstacles taller than cruise altitude by this much are steered around, not over (m). */
    avoidTallerThan: 45,
    /** Strength of the soft push away from tall towers. */
    avoidStrength: 1.6,
    /** Full-belly wallow: roll oscillation amplitude (rad) and frequency (Hz). */
    wallowAmp: 0.07,
    wallowHz: 0.55,
  },

  /** Turbo gears (src/game/Turbo.ts). Cruise is the classic flight (cruise / surge), Express the surge with no thumb on it (config.flight.surgeSpeed, no height);
   *  from Nonstop up each gear needs height above the ground. */
  turbo: {
    /** Stratos and Rainbow Warp need the world beyond the city map: off until it exists
     *  (past Jet's turbo the ladder shows "LOCKED: world travel coming"). */
    worldTravel: false,
    /** Gear speeds (m/s): Nonstop (about 500 mph), Jet, Stratos, Rainbow Warp (SF -> Tokyo, 8,300 km, in ~5 min). */
    nonstopSpeed: 225,
    jetSpeed: 450,
    stratosSpeed: 4500,
    warpSpeed: 30000,
    /** Height above the ground each gear needs (m): shifted up lower, the bus climbs there first. */
    nonstopAlt: 60,
    jetAlt: 150,
    stratosAlt: 2000,
    warpAlt: 10000,
    /** Climb rate while a gear lifts the bus to its height (m/s). */
    nonstopClimb: 50,
    jetClimb: 75,
    stratosClimb: 700,
    warpClimb: 3000,
    /** Spool: speed reaches ~95% of the gear's in this long once at height (s); dropping a gear brakes over this long (s);
     *  both ease in over rateEase (s) so neither starts with a jolt. */
    spool: 2.4,
    brake: 3,
    rateEase: 0.35,
    /** Turbo: the rungs over the top gear, a flick each, latched: the top gear's speed x this. */
    levels: [1.3, 1.6, 2],
    /** Steering authority above the surge speed: yaw rate x (surge / speed)^turnExp. */
    turnExp: 0.55,
    /** Camera: pulls back this much at Jet's speed (m), widens this much (deg); the shift kicks the fov by this (deg).
     *  (The follow spring's own lag already pulls it back ~2 x speed / (2 pi followHz): camLead of it is cancelled
     *  at Jet, all of it from Stratos on, so the camera never falls kilometers behind or under a climbing bus.) */
    camPull: 25,
    camFov: 5,
    fovKick: 7,
    camLead: 0.4,
    /** The bus grows this much at Jet's speed so the hero still reads with the camera pulled back (x). */
    heroScale: 1.25,
    /** Camera jolt at the sonic boom (m) and its palette flash strength (0..1). */
    boomKick: 3.2,
    boomFlash: 0.55,
    /** Past the city map's edge by more than this (m) the gear runs out of world and eases back to the surge. */
    edgeFade: 300,
    /** Bus rattle while straining and at speed (m of jitter at the bus). */
    rattle: 0.32,
  },

  /** School Zone, the rung under Cruise (docs/specs/shots/SHOTS.md, "School Zone: lingering"; GEARS.md): a hover that bobs like a blimp. */
  zone: {
    /** Let go, the speed is ~95 % gone in this long (s): Cruise's 30 m/s eases to a hover. */
    settle: 1.5,
    /** The stick up noses down and drifts forward at up to this (m/s), sinking at up to `sink` (m/s) at the full push. */
    drift: 8,
    sink: 5,
    /** The stick down climbs at up to this (m/s): here only, a gentler climb than the ruled 40 (SHOTS.md decision 15). */
    climb: 15,
    /** The stick sideways turns on the spot: a full turn in this long at the full stick (s). */
    turn: 5,
    /** A roof ahead that would lift the bus more than this (m) is a wall, not a step: the drift stops `wallGap` (m, the bus's middle to it)
     *  short of it, easing in over about `wallEase` s, and the floor's look-ahead leaves it out. A pull climbs it. */
    wall: 12,
    wallGap: 10,
    wallEase: 1.2,
    /** The blimp's bob: its height (m) and rate (Hz), and its slow pitch and roll (deg). */
    bobAmp: 0.9,
    bobHz: 0.2,
    swayPitch: 2,
    swayRoll: 3,
    /** The lean on the stick: nose down at the full push, up at the full pull (deg). */
    leanDown: 14,
    leanUp: 9,
    /** The camera comes in this share of its distance (0..1), easing at this rate (1/s). */
    camIn: 0.3,
    camRate: 1.6,
    /** Paint balloons out of the roof hatch while it hovers: at most this many, one every `every` s once the bus is under `still` m/s. */
    balloons: 6,
    every: 1.1,
    still: 2.5,
  },

  /** Curb, the rung under School Zone (docs/specs/shots/SHOTS.md, "Curb: cruising beside the cars"; CURB.md): the wheels on the street beside
   *  the cars, on life's lane (src/life/Curb.ts), with no steering. ?life only: with no life there's no Curb. */
  curb: {
    /** The band: low over a road at School Zone, Cruise or Express, at most `over` m over it (skimming, the floor over a street is 7 to 28 m, by
     *  the trees and roofs beside it and the belly), the road going on `ahead` m (a street crossed square isn't one), the push past the dead band
     *  at least `push`, held `hold` s (a crossing's cell may break it for `grace` s) lands. While it's held the floor comes down to `dip` m over
     *  the road: the dive to the street. The first time the bus is in the band `hintAfter` s, the hint. */
    over: 30,
    ahead: 15,
    dip: 5,
    push: 0.25,
    hold: 0.5,
    grace: 0.15,
    hintAfter: 0.3,
    /** How long the hint and FIND A STREET stay up (s). */
    hintFor: 3.2,
    noneFor: 1.8,
    /** The surge down a street lands (false), or only a dive from a held height and School Zone's sink (true): the producer's call on the phone. */
    diveOnly: false,
    /** In School Zone a flick down lands from at most this high over the ground (m); the lane is the worker's to find, within 80 m. From higher it
     *  does nothing, as at any height before Curb (at 150 m the arc came down at 115 m/s: the review of feat/curb, M4). */
    flickOver: 60,
    /** No answer from life in this long is no street (s). */
    askFor: 1.2,
    /** The bus's middle over the lane (m): its tyres on the asphalt (BusModel's at its 1.6 scale stand 2.53 m under its middle; StreetCam's 4 m floats them). */
    ride: 2.55,
    /** The arc down onto the lane: T = clamp(arcBase + |offset| / arcPer, arcBase, arcMax) s, and never so short that the arc's own ease comes
     *  faster than `arcTop` m/s (its peak is 1.5 |offset| / T): from higher up it takes longer, it doesn't come faster. */
    arcBase: 0.45,
    arcPer: 45,
    arcMax: 1.8,
    arcTop: 60,
    /** The lane's end: life's lane stood still (under `stallSpeed` m/s) for `stallFor` s, a dead end's kerb or its last point, takes the wheels up. */
    stallSpeed: 0.5,
    stallFor: 1,
    /** A deck's roadway 3 to `headroom` m over the lane (the Bay Bridge's lower deck, 5.5 m under its upper one) leaves the bus no room: no street
     *  there, and rolling on, the wheels go up `coverAhead` m before it. */
    headroom: 9,
    coverAhead: 20,
    /** The heading follows the lane's 4 m steps on a spring this fast (1/s), banking into the turns at this much per (rad/s * m/s), at most `bankMax` deg. */
    turnRate: 6,
    bankPer: 0.02,
    bankMax: 9,
    /** Off: the stick pulled past `pullOff` for `pullFor` s (a flick's stroke is shorter), or a flick up. Leaving lifts vy by `leaveVy` m/s and lands
     *  nothing for `quiet` s; a bounce (no street) by `bounceVy`, `bounceQuiet` s. */
    pullOff: 0.5,
    pullFor: 0.25,
    leaveVy: 3,
    quiet: 1,
    bounceVy: 5,
    bounceQuiet: 2,
    /** The look past `lookDeg` held `lookFor` s asks for the next junction its way, square (life turns only past 60 degrees from straight on),
     *  and keeps asking `turnHold` s after it lets go. On the street the view turns at most `lookMax` deg either way. */
    lookDeg: 20,
    lookFor: 0.25,
    turnHold: 1,
    lookMax: 30,
    /** The kerb chase: back, eye height over the road, how far ahead it looks and at what height (m), its width (deg), and `camSide` m toward the
     *  traffic's side, so the bus doesn't stand on the road ahead. GEARS.md's chase lens, raised from 7.5 m and looking 40 m on, not 90, 4 degrees
     *  wider (the outside look of feat/curb: its horizon stood mid-screen, half the phone sky). &curblens=wide the ride-along. In at `camIn`, out at
     *  `camOut` (1/s); never under the road or the deck the bus is on + `camFloor` m, nor within `roofGap` m of a deck over it. Anything solid
     *  between the bus and the lens (a front a look swings it into, the hill) pulls it in short of it at once, to no nearer than `armMin` m, and it
     *  goes out again at `armOut` (1/s); first, a narrow street takes back as much of a look's swing as would bring it nearer than `armKeep` m. */
    camBack: 34,
    camEye: 11,
    camAhead: 40,
    camAt: 3.5,
    camFov: 38,
    camSide: 1.25,
    wideBack: 16,
    wideEye: 3.2,
    wideAhead: 60,
    wideAt: 3,
    wideFov: 58,
    camIn: 1.2,
    camOut: 1.2,
    camFloor: 2.5,
    roofGap: 1,
    armMin: 8,
    armKeep: 20,
    armOut: 2,
    /** The lane paints itself: a dab every `dabEvery` m at the rear axle (so it comes out from under the bus), `dabR` m round, in rainbow rings
     *  `dabRing` m wide round the landing. */
    dabEvery: 3,
    dabR: 2.2,
    dabRing: 14,
    /** The drive-by: the look past `sideDeg` picks its side, kept `sideHold` s after it lets go (one thumb can't hold a look and tap), else the
     *  kerb's; the front `front` m that way and `frontAhead` m on (in the lens's view) within `frontR` m glints, and the breath there is `byR` m
     *  round, on that side of the lane only, its flung blobs too. A street sign it raises stands no smaller than `signMin` of its size from the air. */
    sideDeg: 25,
    sideHold: 1,
    front: 12,
    frontAhead: 16,
    frontR: 16,
    byR: 24,
    signMin: 0.4,
    /** Two toots passing a car, at most every `tootEvery` s. */
    tootEvery: 2,
  },

  /** What height changes (src/game/Ascent.ts; docs/specs/flight/ASCENT.md for how it runs on to the Moon). */
  ascent: {
    /** From this height above the ground (m) the map's edge gives way: the bus may go this many metres further out per metre of height, up to reachMax (m)
     *  past the edge, where the homing takes over. */
    reachFrom: 520,
    reachPerHeight: 4,
    reachMax: 8000,
    /** Past the map's edge by more than this (m) the same slope is a floor: only the ground has collision out there, so the bus comes back down over the map. */
    floorFrom: 1200,
    /** The near plane stands at the camera's own up to this height (m), then moves out with it, up to nearMax: no ground and water fighting for a pixel.
     *  The far fade and the pixel grid's depth limit stand where they are up to the same height. */
    nearFrom: 800,
    nearPerHeight: 0.0067,
    nearMax: 60,
    /** By this height (m) the far fade ends this far past where the land does (m): the land data's edge never shows. */
    fadeLandAt: 3000,
    fadeLandPast: 2000,
    /** Over this height (m) the view looks further down, by as much as the far fade's line has dropped: the ground keeps the frame. */
    pitchFrom: 3000,
  },

  splat: {
    /** Seconds for the belly to refill after a barf. Start short. */
    recharge: 1.6,
    /** Duration of the geyser (s). */
    duration: 1.0,
    /** Bus speed multiplier while breathing rainbow (the recoil of a forward blast). */
    stallSpeed: 0.5,
    /** Where the projectile lands: meters ahead of the bus at rest, plus seconds of travel at speed. */
    range: 72,
    rangePerSpeed: 0.5,
    /** Time from tap to first impact (s), at the short range (the inhale included). */
    impactDelay: 0.42,
    /** From altitude the breath flies along a forward-down ray this many degrees below the heading (deg)... */
    aimDown: 20,
    /** ...and past the classic range flies on at this constant speed (m/s): longer shots take longer. */
    projectileSpeed: 850,
    /** Farthest a breath can reach (m). */
    maxRange: 1600,
    /** From up high a shot that would miss snaps to the nearest roof within snapRadius * (1 + drop / 150), up to this (m). */
    snapReachMax: 120,
    /** Search radius around the aim point for the target building (m): true distance to its footprint. */
    snapRadius: 28,
    /** Buildings lower than this are never the target (sheds, slivers) (m). */
    minTargetHeight: 2.5,
    /** A shot that snaps onto a big building lands on its nearest edge this far in (m); onto a house-sized one
     *  (all of it within smallRad of its centroid, m) at its centroid, as ever (the blast reaches houses by
     *  their centroid less their half-size too, big footprints by true distance). */
    landInset: 4,
    smallRad: 25,
    /** Aim hold: the glinting building stays the target while the aim point is within this of it (m; more from high up). */
    aimHold: 10,
    /** ...and while it is within aimHold of the last aimHoldAlong m of the line of fire (m): it doesn't strobe at speed. */
    aimHoldAlong: 40,
    /** A building in the line of fire takes the shot if it stands this far above the jet's path (m), unless it is
     *  within wallSkip of where the jet lands (the jet is as wide as a house there) (m). */
    wallClear: 1.5,
    wallSkip: 8,
    /** Aim latch: lifting the thumb (or touching down) to tap freezes the glinting target this long (s), while it
     *  stays within the pick radius or this cone of the line of fire (lateral m per m of range). */
    aimLatch: 0.5,
    /** ?life: how far along the nose the aim looks for a mover past the aim's own ray (m): a plane flown alongside or ahead */
    moverReach: 2500,
    /** A mover this far over the floor under it (m) or nearer is on it, a car, a ferry, a person: a breath at it paints the block round it. Higher, a plane: its own hit */
    moverFloor: 40,
    aimLatchCone: 0.2,
    /** Aim glint: light lift on the target (0.125 = one ramp step), the sweep's extra lift, sweeps per second. */
    glintLift: 0.13,
    glintSweep: 0.2,
    glintRate: 2,
    /** Inhale: the bus squashes and gulps on the tap frame; the jet leaves this much later (s, inside impactDelay). */
    inhale: 0.09,
    /** MEGA or Space held this long starts charging the super splat (s);
     *  shorter is a tap (Input.onChargeStart / onChargeEnd, state.chargeHeld). A press on the screen never charges. */
    holdThreshold: 0.3,
    /** A breath that comes down on nothing (open water, under this height) is a miss; it refunds this much belly. */
    missWaterY: 0.8,
    missRefund: 0.5,
    /** Steering while breathing: x this much until the impact (the dragon plants itself), easing back over breathSteerEase s. */
    breathSteer: 0.5,
    breathSteerEase: 0.2,
    /** Authored rear-up while breathing (rad, nose up), its rise and its settle. */
    rearUp: 0.2,
    /** Blast radius around the impact with no drop (m): every building inside blooms. 85 since the shots' rework (docs/specs/shots/SHOTS.md, "The
     *  shot, reworked", approved 2026-11-06: "The splat grows from 60 m to 85 m"), from 60: the block, not one car. Each tap still climbs one level. */
    blastRadius: 85,
    /** Radius multiplier at 300 m of drop (bus height above the impact); grows linearly with drop. */
    dropGain300: 2,
    /** Drop beyond this adds nothing (m). */
    dropMax: 600,
    /** Launch speed of the shockwave racing out of the impact (m/s); buildings bloom as it reaches them. */
    waveSpeed: 300,
    /** Max buildings bloomed per blast at the base radius, and it grows with the blast's area (r squared, as the buildings in reach do), up to
     *  maxBuildingsCap from up high. High enough that a tap from the rooftops paints every building in its 85 m (SHOTS.md: "It paints every car, person,
     *  picnic and boat inside it"): it was 40 at 60 m, growing with r alone, which left grey houses inside a dense block's circle. */
    maxBuildings: 140,
    maxBuildingsCap: 240,
    /** A super's blast (mega, the firehose's closer): its cap grows with the blast's area, up to this: the buildings in
     *  reach grow with r squared, and the street grid under them is painted to the full radius either way. */
    megaBuildingsCap: 480,
    /** Hue layout: 0 = pinwheel by angle, 1 = rings by distance, 2 = spiral (pinwheel + rings). */
    hueLayout: 0,
    /** Ground pinwheel sectors around the impact (6 = one rainbow turn: opposite sides complementary). */
    hueSectors: 6,
    /** Building hues: 1 = dealt in rainbow order by angle around the impact (every hue, equal shares),
     *  2 = dealt in equal contiguous wedges, 0 = the layout hue at the building. */
    hueDeal: 1,
    /** Ring width for the distance layouts (m). */
    hueRing: 16,
    /** Pinwheel twist (rad per m): the sectors swirl like a catherine wheel. */
    hueTwist: 0.01,
    /** Buildings' hues start this many steps past the layout / center hue (and never match the paint under them). */
    roofHueShift: 1,
    /** Ground splat edge radius (fraction of the blast radius) and raggedness of its edge (0..1). */
    groundRadius: 0.8,
    groundRagged: 0.26,
    /** Splash rays shooting past the edge: count and max length (fraction of the radius). */
    groundRays: 13,
    rayLength: 0.5,
    /** Ground paint tone: light offset (lower = deeper than the walls), sidewalks' lift over the
     *  street, and the curb line (class-blend weight under which paint leaves the curb grey; 0.5 = off). */
    groundLight: -0.14,
    groundSidewalk: 0.12,
    groundCurb: 0.7,
    /** Spatter dots beyond the edge: how far out (fraction of the radius) and how many sit still. */
    spatterReach: 1.6,
    spatterDots: 46,
    /** Paint blobs flung out of the impact: count; each lands as a spatter dot. */
    blobs: 64,
    /** Blob flight time: base (s) + per meter of distance (s/m). */
    blobTime: 0.42,
    blobTimePerM: 0.007,
    /** Shockwave: it slows down toward ringReach x the radius (and fades there); ring width (m). */
    ringReach: 1.65,
    ringWidth: 12,
    /** Impact flash (frames, strength 0..1). */
    flashFrames: 1,
    flashStrength: 1,
    /** Camera kick at impact (m along the camera's up axis) and its decay (s). */
    kick: 2.2,
    kickDecay: 0.25,
    /** Hit-stop frames at impact (frames @60). */
    hitStopFrames: 4,
    /** Recoil: upward kick (m/s) and speed boost multiplier after the barf. */
    recoilUp: 7,
    reliefBoost: 1.45,
    reliefSeconds: 2.6,
    // ---- the super splat: hold to charge (src/game/SuperSplat.ts)
    /** Seconds of holding for a full charge: it lets go on its own as the FIREHOSE. */
    superCharge: 10,
    /** Released below this share of the charge: just a normal splat (no cooldown). */
    superMin: 0.3,
    /** Seconds until the super is ready again after a firehose (after a mega blast: x its charge). */
    superCooldown: 60,
    /** Mega blast (released early): radius x, jet width x and hit-stop frames, from the first at superMin (any mega is
     *  unmistakably bigger than a tap: the hold is never a tap with a lockout) to the second near a full charge. */
    megaFloor: 1.6,
    megaGain: 2.6,
    megaWidthFloor: 1.5,
    megaWidth: 2.4,
    megaHitStopFloor: 6,
    megaHitStop: 9,
    /** Charging weighs the bus down: speed x this at a full charge. */
    chargeSlow: 0.6,
    /** The camera creeps in while charging: distance x (1 - this) at a full charge. */
    chargeCreep: 0.2,
    /** Firehose: how long it pours (s), impacts per second (each a full blast of this radius, m; it grows with the drop like a tap's). */
    firehoseDuration: 4,
    firehoseRate: 12,
    firehoseRadius: 45,
    /** ...the ground takes rainbow bands this wide (m, grown with the drop like the blast), ringed around where the pour first landed. */
    firehoseBand: 17,
    /** ...near the rooftops it reaches this many times the breath's range (a turn sweeps a wide arc); from up high it
     *  pours down along the aim ray, where the player looks. */
    firehoseReach: 1.7,
    /** ...the torrent's width x the breath's (more from up high: x (1 + drop / firehoseWidthDrop)), and its particle rate x. */
    firehoseWidth: 2.6,
    firehoseWidthDrop: 130,
    /** ...it pours this many times faster than the breath's projectile past the classic range (from up high the
     *  landing must stay near where the player looks while the bus turns). */
    firehoseSpeed: 3,
    firehoseFlow: 1.9,
    /** Recoil: the bus is knocked back to this share of its speed, then held at firehoseSlow while it pours. */
    firehoseKick: 0.3,
    firehoseSlow: 0.4,
    /** A building the stream already bloomed re-pops (and escalates a level) at most this often (s). */
    firehoseRepop: 0.4,
    /** Camera shake per impact (m, translation only: the pixel snap holds) and flashes per second at most. */
    firehoseShake: 0.9,
    firehoseFlashes: 3,
    /** The closing blast where the stream ends: radius x firehoseRadius, hit-stop frames. */
    firehoseFinale: 2,
    firehoseFinaleHitStop: 8,
    /** After a firehose the bus is spent (smoke, wheeze, dim belly, limping speed) for this long (s). */
    superSpent: 4,
  },

  /** The Comet (src/game/Comet.ts, docs/specs/shots/SHOTS.md "The modes", BUILT.md step 3): a tap while a gear drives the bus at `speed` or more flies ahead on
   *  an arc through the sky and lands beside where the bus will be `pass` s after the impact, in view. Its looks are src/fx/CometFx.ts's. */
  comet: {
    /** A gear driving the bus at this or more (m/s): Nonstop engaged, Jet, Turbo 1-3. */
    speed: 225,
    /** Its flight after the inhale (s), and its arc's top over its chord (share of the chord), lowered to `arcMin` where its top would leave the frame: by the
     *  lens moved on to its flight's middle, over `apexTop` of the frame (NDC, 1 its top edge). */
    flight: 0.6,
    arc: 0.17,
    arcMin: 0.06,
    apexTop: 0.8,
    /** It lands this far off the bus's line (m), the side swapping with each Comet, on a building within `sidePick` of there (or of the other side's, or
     *  of the line, where there's none; with none at all, on the ground): inside the splat and the drops' reach, never a beam out of the bus. */
    side: 34,
    sidePick: 12,
    /** The ground standing more than this over the lens's line to the landing hides it (m): it lands on the ridge. */
    hide: 4,
    /** It lands where the bus will be this long after the impact (s)... */
    pass: 1.5,
    /** ...at most this far from the tap (m): config.city.loadRadiusHigh, how far the city loads. */
    reach: 1900,
    /** By this frame's lens moved on by the bus's travel to the impact it lands at least this share of the height above the bus; where it doesn't it
     *  moves out along its line `outStep` m at a time, and where it never does by `reach` the tap is the classic shot. */
    above: 0.05,
    outStep: 20,
    /** A wall standing into the arc less than this many s of the bus's travel ahead of it at the impact is lobbed over: the arc tops out higher, up to
     *  `arcMax` of the chord. Farther, it takes the Comet on its face. */
    wallAhead: 0.5,
    arcMax: 0.3,
    /** It lands in the middle of a stretch of its way this many s of the bus's travel either side, counted along the bus's travel and held for the stretch
     *  (s): what glints holds while the bus crosses it, steering or not, so it doesn't strobe at Turbo 3, and a tap lands the same at 30 and 60 fps. */
    hold: 0.12,
    /** Its landing's tile isn't in at the tap (the edge of what's loaded): its blast is planned this long before the impact instead (s). */
    late: 0.2,
    // ---- its looks (src/fx/CometFx.ts)
    /** The full show plays on the first Comet in this long (s), the lighter one on the rest. */
    showEvery: 20,
    /** The pillar of paint light: height (m), up in `rise` s, gone over `fade` s; the lighter one's height and fade. Its radius at the foot (m), and never
     *  thinner than `pillarPx` game pixels on the screen. Its wall dithers away nearer the lens than `pillarWhole` (m), gone by `pillarNear`, so the bus
     *  flying through it is never lost. */
    pillar: 200,
    pillarLight: 120,
    rise: 0.12,
    fade: 2.5,
    fadeLight: 1.2,
    pillarRadius: 20,
    pillarPx: 2.5,
    pillarNear: 35,
    pillarWhole: 110,
    /** The impact: a white-hot core over this radius at the landing (m, its share of the screen as far off as it is), held `flashFrames` rendered frames
     *  and never reaching the bus on the screen; a ring of `ring` motes of paint racing out over the roofs to the blast's edge (the lighter show half). */
    flashCore: 34,
    flashFrames: 3,
    ring: 64,
    /** Into the water: a splash of `splash` motes thrown up to about `splashUp` m and a soft boom (the lighter show half); it doesn't use up the full show. */
    splash: 220,
    splashUp: 70,
    /** Motes in the streak (the lighter one half of them), and in the crown. */
    motes: 400,
    crown: 420,
    /** The bus within this of the pillar's axis (m), under its top: this many drops splat on the lens, run and fade in `dropLife` s (the full show). */
    lensReach: 50,
    dropsMin: 8,
    dropsMax: 14,
    dropLife: 0.5,
    /** The boom comes when its sound would reach the bus (m/s, with the bus flying into it); the camera's kick then (m), the lighter one's. */
    sound: 343,
    kick: 3.2,
    kickLight: 1.2,
  },

  /** The Lob (src/game/Lob.ts, docs/specs/shots/SHOTS.md "The modes"): a tap with the bus's body (Flight.pitch) more than `from` degrees up throws the breath
   *  off the nose at the body's angle θ, at most `most` (past it, a Lob at it), into the distance: `range` x sin 2θ m along the aim's flat way, on the middle of
   *  a stretch of its way `stretch` m long, in view as the Comet must be (config.comet.above, reach and outStep). */
  lob: {
    from: 25,
    most: 70,
    range: 1600,
    stretch: 60,
    /** The body latched as the steering thumb lifts (or a tap's finger lands) is what a tap throws for this long (s), where the aim's latch is
     *  config.splat.aimLatch's 0.5: a tap 0.5 s after the lift found the body dropped and threw a plain splat, the ring still up the frame before. */
    latch: 0.8,
    /** Its blast is a tap's for its fall from the arc's top (Lob.ts's lobRadius, 220-560 m of fall from the roofs), at most this (m): a 300 m tap's, the
     *  best a tap has, so it lands as big from the roofs as from 300 m. The producer's call (BUILT.md, the roofs stage). */
    radius: 170,
    /** It must show at least this share of the height over the bus by the lens moved on to the impact (config.comet.above is the Comet's), and a landing
     *  picked afresh `aboveNew`: held or latched it stays while it shows `above`, so one picked on the edge doesn't move off it before the tap. */
    above: 0.05,
    aboveNew: 0.07,
    /** Its flight after the inhale at 45 degrees (s), x sin θ / sin 45 at θ: 1.43-3.19 s from 25 to 70. */
    flight: 2.4,
    /** The lens moved on to the impact climbs with the bus for this long at most (s): a thumb lifted levels it out in about that. */
    climbFor: 0.5,
    /** ...and with the steering thumb down (a second thumb's tap), this long: it climbs on. */
    climbLive: 1,
    /** The path more than this under level (degrees) is a dive, which never lobs (Belly Flop's, later). */
    levelSlack: 3,
    /** Its whump comes when its sound reaches the bus, but at most this long after the impact (s): 1.6 km is 4.7 s of sound. */
    boomLate: 1.2,
    /** The view tips up this far (degrees) while it climbs, the sky lift's way, and back down while it falls (main.ts). */
    tip: 10,
    /** Motes in its streak over its whole flight, three times the Comet's time aloft and more (the Comet's 400). */
    motes: 700,
    /** Its throw: a puff of this many motes of its paint off the mouth, up its way at about puffSpeed m/s, and the recoil's kick (config.comet.kickLight 1.2). */
    puff: 28,
    puffSpeed: 16,
    kick: 0.8,
  },

  /** The Bomb (docs/specs/shots/SHOTS.md, "The modes"; src/game/Bomb.ts), behind &bomb: a still hold on the bus, then the lift. "2" is Bomb II's, "3" Bomb III's. */
  bomb: {
    /** The tiers (s from the charge's start, the still hold on the bus with a full belly): each shows inputTune.aimLagMs later, on a frame. */
    two: 0.6,
    three: 1.2,
    /** A bank of 1 (ten caught drops) brings the tiers this much sooner (s), never before inputTune.aimHoldMs. */
    bankGain: 1.2,
    /** The stages each building climbs (never past 3), its circle x the tap's (blastRadiusFor(drop)), the breath's jet x, the hit-stop's frames, the belly's refill (s). */
    jump2: 2,
    jump3: 3,
    radius2: 1.4,
    radius3: 1.8,
    width2: 1.5,
    width3: 2.4,
    hitStop2: 6,
    hitStop3: 9,
    recharge2: 3,
    recharge3: 4.5,
    /** The tell: the bus's swell at II and III (x 1 +, its look alone). */
    swell2: 0.06,
    swell3: 0.12,
    /** MEGA's built look while it charges (SuperFx, in the faction's spray): its motes a second at III, a fifth of them before II and half at II (MEGA's floor);
     *  and at III alone MEGA's halo orbiting the bus and its sparks, a second */
    motes: 420,
    halo: 110,
    sparks: 70,
    /** The stages: each its own write and pop this long apart (s) from the wave's arrival, the later ones written in bands this long ahead of their pops. */
    stageGap: 0.4,
    stageBand: 0.1,
    /** The most buildings a Bomb paints: blastCap's, maxBuildings x (r / blastRadius)^2 up to this (a tap's stays maxBuildingsCap). At 900 a Bomb III from 600 m
     *  (459 m) left 81-1,091 buildings grey inside its painted ground at 16 places, and 61-65 from 300 m over Excelsior and Bernal: San Francisco's densest
     *  holds about 2,000 in 459 m */
    cap: 2400,
    /** A circle wider than this (m) has its wave reaching the rim as its ground's deadline, not its impact (groundDeadline). */
    rimOver: 160,
  },

  facade: {
    /** Tower facades show their columns while a column module is at least this many game pixels wide on screen... */
    colPx: 3,
    /** ...and their floors while a floor is at least this tall (game px); below both they are a flat wall tone. */
    floorPx: 4,
    /** Per-building spread of those switches (fraction of the distance), so the change never draws a ring. */
    lodJitter: 0.24,
    /** House windows: one glass band per floor beyond this size of a game pixel at the house (m), a flat wall beyond the second. */
    houseRibbon: 0.6,
    houseFlat: 1.15,
    /** Glow of lit tower crowns and of Salesforce Tower's LED crown (0..1). */
    crownGlow: 0.3,
    /** Glow of painted stained glass at levels 1-2 (0.12 stays under the halo threshold: no dust) and at level 3. */
    glassGlow: 0.12,
    glassGlow3: 0.38,
    /** Sky-reflection banding on curtain walls (light amplitude of the bands). */
    glassBands: 0.06,
  },

  bloom: {
    /** Duration of the squash/stretch pop (s). */
    popDuration: 0.55,
    /** Squash depth and overshoot of the pop. */
    squash: 0.18,
    overshoot: 0.13,
    /** How fast color floods up the facade (m/s). */
    floodSpeed: 55,
    /** Head start of the flood (m from the roof): the impact and hit-stop frames already show the hit. */
    floodHead: 6,
    /** Painted wall wobble amplitude (m) and speed. */
    wobbleAmp: 0.32,
    wobbleSpeed: 1.1,
    /** Landmarks (hand-built props): the color pours down their whole height in this long (s; a 260 m pyramid
     *  at floodSpeed would take ~5 s)... */
    landmarkFlood: 1.1,
    /** ...while a splash of it spreads out from where the breath hit, to this radius (m) in about this long (s). */
    landmarkSplat: 34,
    landmarkSplatTime: 0.5,
    /** Their squash-and-stretch pop, as a fraction of a building's (18 % of a 260 m tower is a lot of tower). */
    landmarkPop: 0.3,
    /** Glow of a painted landmark's lit accents (the pyramid's spire, Sutro's beacons) and of its stained glass. */
    landmarkGlow: 0.55,
    landmarkGlassGlow: 0.12,
  },

  audio: {
    master: 0.8,
    music: 0.7,
    sfx: 0.9,
    ambience: 0.6,
    /** Level of the deep blast boom under the splat (0..2). */
    boom: 1,
    /** Bloom pops: at most this many arpeggio notes per blast, this far apart (s). */
    arpNotes: 6,
    arpStep: 0.055,
  },
};

export type Config = typeof config;
