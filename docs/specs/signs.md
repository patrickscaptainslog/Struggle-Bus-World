# Module: signs

Files you own: src/fx/StreetSign.ts, src/fx/pixelFont.ts, dev/sign.html

## Spec

Build the diegetic street sign pop-up (there is NO HUD; this is how the game names where you painted). When a building blooms, the real-
style green San Francisco street-name sign springs out of the sidewalk on a pole, wobbles, then flips to a rainbow version, then sinks.
API (exact):
  export class StreetSigns {
    readonly object: THREE.Object3D
    constructor()
    show(opts: { text: string /* e.g. 'STEINER ST' */; position: THREE.Vector3 /* ground point */; facing: number /* yaw radians the sign face points toward (0 = +Z/south... use: face normal = (sin(facing), 0, cos(facing))) */; hue: number /*0..5*/ }): void
    update(dt: number, camera: THREE.Camera): void   // camera given so the sign can turn to stay readable (limit turn to +-40 deg from facing)
    readonly active: number
  }
Text: write a crisp pixel bitmap font in pixelFont.ts (uppercase A-Z, 0-9, space, period, apostrophe, dash, ampersand; 5x7 or 4x6 glyphs)
that rasterizes strings into a Uint8 mask; build the sign face as a small DataTexture (NearestFilter) sampled by a custom GLSL3 material
that writes SIGN_GREEN ramp for the blade and WHITE ramp for letters (and a thin white border like real SF signs), then on the flip
uses the hue ramp + WHITE letters with glow. The sign must be READABLE at gameplay distance: framebuffer ~240 px wide, camera ~175 m
away, 24 deg hFOV => 1 game px ~ 0.33 m near the bus. So the sign is comically oversized (blade maybe 9-12 m wide, letters ~1.2-1.6 m tall,
1 font pixel = 1 game pixel or so) — test that it reads at ?dist=175&elev=31 and still looks charming at ?dist=45. Pole: GREY_LIGHT.
Animation: spring up from the ground with overshoot (squash/stretch), small wobble, hold ~2.2 s, flip (rotate 180 deg about the pole
with a squash) into rainbow, sparkle-ish glow, hold ~1.8 s, sink back down. Max ~4 signs at once; reuse objects (pool).
