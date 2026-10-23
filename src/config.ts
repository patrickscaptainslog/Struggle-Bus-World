// Every number that shapes how the game feels lives here, so the hidden
// tuning panel (?tune, or a three-finger tap) can edit it live on the phone.
// Units: meters, seconds, radians unless noted.

export const config = {
  render: {
    /** Target width of the low-res framebuffer in game pixels (portrait). */
    pixelWidth: 240,
    /** Hard cap on device pixels per game pixel (keeps pixels chunky on tablets). */
    maxPixelScale: 8,
    /** Width of the dithered band between two ramp steps (0 = hard bands, 0.5 = full dither). */
    ditherWidth: 0.22,
    /** Depth-discontinuity threshold for silhouette outlines (fraction of depth). */
    outlineDepth: 0.035,
    /** Crease highlight strength on convex edges (0..1). */
    creaseHighlight: 0.75,
    /** Distance at which outlines have fully faded out (m). */
    outlineFadeEnd: 520,
    /** Shadow map size (texels). */
    shadowMapSize: 1024,
    /** World-space extent of the shadow map around the camera focus (m). */
    shadowExtent: 520,
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
    /** Distance fog density (1/m). */
    density: 0.00125,
    /** Height falloff: fog thins with altitude above this (m). */
    heightFalloff: 120,
    /** Distance at which far geometry is fully fogged (m). Streaming edge hides behind this. */
    farFull: 2600,
    /** How much painted neighborhoods thin the fog above them (0..1). */
    paintClearing: 0.65,
    /** Fog bank density multiplier during the opening (fades to 1). */
    openingBank: 9,
    openingDuration: 4.2,
  },

  camera: {
    /** Horizontal field of view in portrait (deg). Narrow = telephoto = steadier pixels. */
    hfovPortrait: 24,
    /** Vertical field of view cap when landscape (deg). */
    vfovLandscape: 34,
    /** Distance behind the bus (m). */
    distance: 175,
    /** Elevation angle of the camera above the bus when cruising (deg). */
    elevationCruise: 31,
    /** Elevation when slow / hovering to aim (deg) — tilts toward diorama. */
    elevationSlow: 39,
    /** Elevation at full surge (deg) — levels toward the horizon. */
    elevationSurge: 24,
    /** Look-ahead in front of the bus (m), keeps the bus above the thumb zone. */
    lookAhead: 55,
    /** Position lag spring frequency (Hz) and damping ratio. */
    followHz: 1.1,
    followDamping: 1.0,
    /** Yaw lag spring frequency (Hz) — lower = turns sweep more. */
    yawHz: 0.75,
    yawDamping: 0.92,
  },

  flight: {
    /** Speed when the thumb is released (m/s). "Dreamy cruise." */
    cruiseSpeed: 30,
    /** Speed at full upward stretch (m/s). ~90 s across SF. */
    surgeSpeed: 112,
    /** Speed at full downward stretch (m/s). Hover to aim. */
    hoverSpeed: 6,
    /** How fast speed chases its target (Hz). */
    speedHz: 0.9,
    /** Max yaw rate at full sideways stretch (rad/s) at cruise speed. */
    maxYawRate: 1.35,
    /** Bungee: steering spring frequency (Hz) and damping (<1 overshoots). */
    bungeeHz: 1.6,
    bungeeDamping: 0.52,
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
    /** Max sink rate after cresting a hill (m/s) — gives hang time. */
    maxSink: 9,
    /** Bank angle per unit of lateral acceleration (rad per m/s²). */
    bankPerAccel: 0.06,
    maxBank: 0.62,
    /** Bank spring (Hz, damping) — the wobble you see when straightening out. */
    bankHz: 1.7,
    bankDamping: 0.42,
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
    /** Time from tap to first impact (s). */
    impactDelay: 0.42,
    /** Search radius around the aim point for the target building (m). */
    snapRadius: 28,
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
    /** Pinwheel sectors around the impact (a multiple of 6 closes the rainbow). */
    hueSectors: 12,
    /** Ring width for the distance layouts (m). */
    hueRing: 16,
    /** Pinwheel twist (rad per m): the sectors swirl like a catherine wheel. */
    hueTwist: 0.01,
    /** Buildings take the layout hue shifted by this many steps, so a house never melts into the paint around it. */
    roofHueShift: 1,
    /** Ground splat edge radius (fraction of the blast radius) and raggedness of its edge (0..1). */
    groundRadius: 0.9,
    groundRagged: 0.2,
    /** Splash rays shooting past the edge: count and max length (fraction of the radius). */
    groundRays: 9,
    rayLength: 0.42,
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

  bloom: {
    /** Duration of the squash/stretch pop (s). */
    popDuration: 0.55,
    /** Squash depth and overshoot of the pop. */
    squash: 0.18,
    overshoot: 0.13,
    /** How fast color floods up the facade (m/s). */
    floodSpeed: 55,
    /** Painted wall wobble amplitude (m) and speed. */
    wobbleAmp: 0.32,
    wobbleSpeed: 1.1,
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
