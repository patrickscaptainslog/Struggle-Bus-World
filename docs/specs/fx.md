# Module: fx

Files you own: src/fx/Particles.ts (plus optional src/fx/particles*.ts helpers), dev/fx.html

## Spec

Build the particle system for the barf geyser, impact splashes and bloom sparkles. Render as THREE.Points (or instanced quads) with a
custom GLSL3 ShaderMaterial that includes GLSL_COMMON/GLSL_OUT and writes sbWrite(...) with flags 0.5 (no outline). Particles must be
crisp square pixels of 1-3 game pixels (gl_PointSize in LOW-RES pixels: the pipeline renders the G-buffer at ~240x520). Provide
setViewportHeight(lowResHeightPx) and compute size from projectionMatrix[1][1] so world-size particles scale with distance, with a
1 px minimum. Single draw call, fixed-capacity ring buffer, update on CPU with typed arrays (or in the vertex shader from spawn params —
your call, but no per-frame allocation and no full-buffer re-upload if avoidable: use addUpdateRange/ updateRanges).
API (exact):
  export class Particles {
    readonly object: THREE.Object3D
    constructor(maxParticles?: number)          // default 6000
    setViewportHeight(px: number): void
    geyser(opts: { source: () => THREE.Vector3; sourceVel: () => THREE.Vector3; targets: THREE.Vector3[]; duration: number; travelTime: number; hues: number[] }): void
      // a 1 s rainbow geyser of pixel particles from a MOVING source (the bus mouth) that blasts down and curves (homing) onto the targets,
      // arriving travelTime (~0.35 s) after emission. Banded rainbow order across the stream (like a rainbow ribbon), using HUE_RAMPS[hue]
      // ramps with bright steps + glow; chunky blobs with smaller droplets, slight wobble, stretch along velocity optional.
    splash(pos: THREE.Vector3, hue: number, strength: number): void   // wet impact splash: droplets burst up/out with gravity, a few bounce
    sparkles(center: THREE.Vector3, radius: number, height: number, hues: number[], count: number): void  // bloom sparkle burst: twinkling stars that rise and blink out (glow 1, GLOW_WHITE + hue tints)
    ambientSparkle(pos: THREE.Vector3, hue: number): void              // one slow twinkle (painted buildings call this occasionally)
    puff(pos: THREE.Vector3, vel: THREE.Vector3, ramp?: number): void  // grey exhaust/dust puff (FOG/GREY_LIGHT ramps, no glow)
    update(dt: number): void
    readonly alive: number
  }
Beauty: the geyser is THE money shot — glorious, juicy, saturated, readable as a rainbow at 240 px wide, glowing. It must read as
liquid-candy rainbow barf, not confetti. Test in dev/fx.html with a fake moving source over the harness blocks (targets on roofs),
loop the effects, screenshot mid-geyser and mid-sparkle at ?dist=175&elev=31 and close up ?dist=50. Particles do not cast shadows.
