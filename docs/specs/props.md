# Module: props

Files you own: src/world/Props.ts (plus optional src/world/props/*.ts), dev/props.html

## Spec

Build the world props: trees, two hand-built landmarks, and the rooftop sprouts that painted buildings grow.
API (exact):
  export interface TreeInstance { x: number; y: number; z: number; size: number /*0.6..1.6*/; kind: number /*0 street tree, 1 park tree, 2 cypress*/ }
  export class TreeField {
    readonly object: THREE.Object3D        // InstancedMesh(es), cast shadows (enable SHADOW_LAYER)
    constructor(trees: TreeInstance[])
    setPaint(index: number, hue: number, level: number, startTime: number): void  // a painted tree pops (squash/stretch) and turns into a lush rainbow-tinted tree with blossoms (instance attribute; animate in shader with uTime)
  }
  export function makeSutroTower(): THREE.Object3D        // SF's three-legged TV mast on its hill: 298 m tall, three tapered legs that meet, two crossbar levels with antenna masts on top (pixel-art chunky). Origin at base center. Grey/fog-friendly ramps (GREY_LIGHT; the real red/white bands as subtle light/dark GREY bands so it stays in the grey world). Cast shadows.
  export function makeTransamerica(): THREE.Object3D      // Transamerica Pyramid: 260 m, slender 4-sided pyramid with the two "wings" (elevator/stair shafts) and a spire; window texture as subtle banding. Origin at base center.
  export class RoofSprouts {
    readonly object: THREE.Object3D
    constructor(maxBuildings?: number)    // default 4096 painted buildings
    set(buildingIndex: number, roof: { cx: number; cz: number; y: number; w: number; d: number; yaw: number } /* roof rectangle in world space */, hue: number, level: number /*1..3*/, startTime: number): void
      // level 1: a few flowers/tufts on the roof edge; level 2: a rooftop garden (bushes, a little tree, flower boxes); level 3: full Hundertwasser —
      // onion dome or golden ball spire, trees, bunting (little flag strings in rainbow hues). Everything springs up with squash/stretch from startTime
      // (uTime is globals.uTime, seconds) and then sways gently forever (painted things move; grey things never move).
    clear(buildingIndex: number): void
  }
Implementation: InstancedMesh with makeRampMaterial({ vertexRamp: true, vertexChunk }) or your own GLSL3 material following the G-buffer contract;
per-instance attributes for hue/level/startTime; animation in the vertex shader from uTime (no per-frame CPU work for thousands of
sprouts). Trees in the grey city use GREEN_GREY ramp and never move; painted trees use the GREEN ramp + blossom hue and sway.
Pixel-art silhouettes: blobby layered canopies (2-3 stacked spheroids/octahedra quantized), chunky trunks, cypress = tall flame shape (SF
Presidio/park cypress). Must read at gameplay scale (camera 175 m, 240 px wide framebuffer, ~0.3-0.6 m per game px) and look lovely
close-up (?dist=40). dev/props.html: harness scene with a grove of grey trees, some painted trees mid-pop, sprouts at levels 1-3 on the
harness boxes (roof y = box height; boxes are 7.5 x h x 18 at x=i*9, z=j*26 — or place your own boxes), and the two landmarks in the
distance (put Sutro at ~600 m away to judge fog silhouette). Screenshot several angles and iterate.
