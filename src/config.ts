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
    /** World-space extent of the shadow map around the camera focus (m). */
    shadowExtent: 520,
    /** At full vista (high above the city) the shadow window widens to this (m) and softens to this strength (0..1)... */
    shadowExtentVista: 1600,
    /** ...centered this far ahead of the bus, on the ground under the view (m). */
    shadowAheadVista: 600,
    shadowStrengthVista: 0.85,
    /** ...and its edge fade (fraction of the window) stays narrow: a wide fade sliding with the window boils. */
    shadowEdgeVista: 0.14,
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
    /** Thumb pushed UP while above the rooftop floor = nose down: dive rate at full push (m/s). */
    diveRate: 48,
    /** Flare: deceleration (m/s²) when a dive meets the rooftop floor, so it never overshoots into roofs. */
    diveFlare: 16,
    /** Vertical stretch ignored by the yoke (0..1), so sideways carving doesn't climb or dive. */
    yokeDead: 0.14,
    /** How fast the climb / dive rate follows the yoke (1/s). */
    yokeResponse: 2.6,
    /** Released above the floor: hold altitude on a critically damped spring (1/s). */
    holdGain: 0.85,
    /** Gentle wheezy bob while holding altitude (m, Hz). */
    bobAmp: 1.3,
    bobHz: 0.3,
    /** Soft ceiling (m above sea level; Sutro Tower tops out ~555) and the band below it where the climb fades and the bus struggles (m). */
    ceiling: 520,
    ceilingSoft: 150,
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
    aimLatchCone: 0.2,
    /** Aim glint: light lift on the target (0.125 = one ramp step), the sweep's extra lift, sweeps per second. */
    glintLift: 0.13,
    glintSweep: 0.2,
    glintRate: 2,
    /** Inhale: the bus squashes and gulps on the tap frame; the jet leaves this much later (s, inside impactDelay). */
    inhale: 0.09,
    /** A breath that comes down on nothing (open water, under this height) is a miss; it refunds this much belly. */
    missWaterY: 0.8,
    missRefund: 0.5,
    /** Steering while breathing: x this much until the impact (the dragon plants itself), easing back over breathSteerEase s. */
    breathSteer: 0.5,
    breathSteerEase: 0.2,
    /** Authored rear-up while breathing (rad, nose up), its rise and its settle. */
    rearUp: 0.2,
    /** Blast radius around the impact with no drop (m): every building inside blooms. */
    blastRadius: 60,
    /** Radius multiplier at 300 m of drop (bus height above the impact); grows linearly with drop. */
    dropGain300: 2,
    /** Drop beyond this adds nothing (m). */
    dropMax: 600,
    /** Launch speed of the shockwave racing out of the impact (m/s); buildings bloom as it reaches them. */
    waveSpeed: 300,
    /** Max buildings bloomed per blast at the base radius (scales with the radius, up to maxBuildingsCap). */
    maxBuildings: 40,
    maxBuildingsCap: 96,
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
