# Module: bus

Files you own: src/bus/BusModel.ts (plus optional src/bus/*.ts helpers), dev/bus.html

## Spec

Build the hero: the Struggle Bus model, procedural (merged box/prism geometry with per-vertex ramps via setVertexRamp + makeRampMaterial
with vertexRamp:true; at most ~4 draw calls). API (exact):
  export interface BusPose { squash: number /*1 rest, <1 squashed wide+short, >1 stretched tall+thin; preserve volume*/; eye: number /*0..1 headlight openness*/;
    fullness: number /*0..1 belly glow fill*/; mouth: number /*0..1 front door open = barfing*/; speed: number /*m/s*/; wheeze: number /*0..1 shudder*/; heave: number /*0..1 gag bulge*/ }
  export class BusModel {
    readonly root: THREE.Group            // caller sets root.position / root.quaternion; local forward = -Z, up = +Y
    readonly mouthLocal: THREE.Vector3    // where the barf emerges, in root-local space
    readonly bellyLocal: THREE.Vector3    // underside center, root-local
    readonly length: number               // meters (about 11 at scale 1)
    constructor(scale?: number)           // default 1.6 (the hero is oversized for readability)
    update(dt: number, t: number, pose: BusPose): void
  }
Look: classic American yellow school bus (BUS_YELLOW ramp), black rub rails (BUS_BLACK), chunky dark windows (WINDOW ramp) with a
light glint, rounded-ish hood/nose (stepped boxes), ONE working headlight that is the bus's eye (GLOW_WHITE with glow; squints when eye
is low, wide when high; maybe a little eyelid made by the visor), the other headlight dead and crossed with duct tape, a duct-taped
bumper (silver GREY_LIGHT tape X's and wraps), chunky wheels, a stop-sign arm folded on the side (RED ramp), roof hatch, maybe a dented
fender. Underside "belly": a band along the bottom/skirt that glows rainbow as fullness rises (6 hues in order along the length, filling
from back to front or bottom to top, glow attribute driven by fullness — this is the ONLY UI in the game, it must read instantly).
Animation in update(): squash/stretch about the base, heave bulges the middle/front, wheeze = small high-frequency shudder + slight sag,
wheels spin with speed, mouth = the front door folds open. Must be charming and readable at gameplay scale: camera ~175 m away,
24 deg horizontal FOV, framebuffer ~240 px wide, so the bus is ~55 game pixels long on screen; test at that distance (harness
?dist=175&elev=31) AND close up (?dist=40). The bus must NOT cast sun shadows (do not enable SHADOW_LAYER on it). It should pop against
grey: it is the most saturated thing in the grey city. Also add a soft drop shadow decal is NOT your job (game glue does it).
