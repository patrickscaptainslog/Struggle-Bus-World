import { Ramp } from '../render/palette';
import { PartBuilder, type PartOpts } from './PartBuilder';

// The Struggle Bus, built from stepped boxes and chunky prisms at scale 1
// (about 11 m long). Coordinates are object space: forward = -Z, up = +Y,
// the bus's left (driver side) = -X, right (door side) = +X. Values below are
// "design" heights measured from the bottom of the tyres; the builder shifts
// everything by OY so the object origin sits at mid-height.
//
// Readability rules (the bus is ~57 x 16 game pixels at gameplay distance):
// big color shapes first — yellow box, dark window row, one black rub rail,
// glowing rainbow belly band, black wheels — and only then close-up charm
// (tape, rivets of light, the eye's lid) that may vanish at distance.

/** Animated part ids, stored in uv.x. Must match the GLSL in BusModel. */
export const PART = {
  STATIC: 0,
  WHEEL: 1, // param = axle z
  DOOR_F: 2, // param = hinge z
  DOOR_R: 3, // param = hinge z
  DOORWAY: 4,
  ARM: 5, // param = hinge z
  EYE: 6,
  LID: 7,
  MIRROR: 8, // param = side (-1 | 1)
  BAND: 9, // param = fill position 0 (rear) .. 1 (front)
  HATCH: 10, // param = hinge z
  HOLE: 11,
  FLASH_AMBER: 12, // param = wig-wag phase 0 | 1
  FLASH_RED: 13, // param = wig-wag phase 0 | 1
} as const;

/** Design dimensions (scale 1). y values are from the tyre bottoms; add OY for object space. */
export const D = {
  OY: -1.58,
  // overall
  zFront: -5.68,
  zRear: 5.54,
  // passenger body
  bodyX: 1.22,
  bodyY0: 1.24,
  bodyY1: 2.98,
  railY1: 1.43,
  sillY0: 1.88,
  winY0: 2.03,
  winY1: 2.7,
  bodyZ0: -3.95,
  bodyZ1: 5.3,
  roofTop: 3.19,
  // belly band (the only UI in the game)
  bandX: 1.255,
  bandY0: 0.72,
  bandY1: 1.24,
  bandZ0: -5.38,
  bandZ1: 5.3,
  bandSlices: 24,
  // wheels
  wheelR: 0.52,
  axleY: 0.52,
  axleF: -4.5,
  axleR: 2.45,
  wheelX: 1.02,
  tireW: 0.36,
  // door (right side)
  doorX: 1.236,
  doorZ0: -3.9,
  doorZ1: -3.06,
  doorY0: 1.3,
  doorY1: 2.8,
  // stop arm (left side)
  armX: -1.245,
  armZ: -3.8,
  armY: 1.66,
  armR: 0.27,
  // headlight eye (right front) and its lid
  eyeX: 0.84,
  eyeY: 1.5,
  eyeZ: -5.5,
  eyeR: 0.23,
  lidY: 1.8,
  lidDrop: 0.3,
  // side mirrors ("ears")
  mirX: 1.22,
  mirY: 2.6,
  // pressure-valve roof hatch
  hatchZ: 3.15,
  hatchS: 0.9,
} as const;

const Y = (y: number) => y + D.OY;
const HUE = [Ramp.RED, Ramp.ORANGE, Ramp.YELLOW, Ramp.GREEN, Ramp.BLUE, Ramp.VIOLET];

/** Builds the whole bus into one geometry (one draw call). */
export function buildBusGeometry() {
  const b = new PartBuilder();
  b.offsetY = D.OY;

  const yellow: PartOpts = { ramp: Ramp.BUS_YELLOW, lo: 0.26 };
  const yellowHi: PartOpts = { ramp: Ramp.BUS_YELLOW, lo: 0.3 };
  const black: PartOpts = { ramp: Ramp.BUS_BLACK, lo: 0.02 };
  const blackDim: PartOpts = { ramp: Ramp.BUS_BLACK, lo: -0.06 };
  const glass: PartOpts = { ramp: Ramp.WINDOW, lo: -0.1 };
  const glint: PartOpts = { ramp: Ramp.WINDOW, lo: 0.62 };
  const tape: PartOpts = { ramp: Ramp.GREY_LIGHT, lo: 0.2 };
  const chrome: PartOpts = { ramp: Ramp.GREY_LIGHT, lo: 0.26 };

  const X = D.bodyX;
  const zb0 = D.bodyZ0;
  const zb1 = D.bodyZ1;

  // ---------------------------------------------------------------- body shell
  // long parts are subdivided along Z so the hammock sag and the gag bulge bend them
  const SZ = 22;
  b.boxMM(-X, D.bodyY0, zb0, X, D.bodyY1, zb1, { ...yellow, segZ: SZ });
  // rounded roof: a faceted arch, each facet catches the low sun as its own band
  const RT = D.roofTop;
  const roofPts: Array<[number, number]> = [
    [-X, D.bodyY1],
    [X, D.bodyY1],
    [X - 0.03, D.bodyY1 + 0.06],
    [X - 0.15, RT - 0.1],
    [X - 0.4, RT - 0.035],
    [0.42, RT],
    [-0.42, RT],
    [-X + 0.4, RT - 0.035],
    [-X + 0.15, RT - 0.1],
    [-X + 0.03, D.bodyY1 + 0.06],
  ];
  b.extrudeZ(roofPts, zb0 + 0.03, zb1 - 0.03, { ...yellowHi, segZ: SZ });
  // rounded front/rear roof edges: chamfer strips
  for (const end of [-1, 1]) {
    const z = end < 0 ? zb0 + 0.06 : zb1 - 0.06;
    b.box(0, D.bodyY1 + 0.06, z, 2 * X - 0.3, 0.1, 0.16, yellowHi, end * 0.75, 0, 0);
  }

  // one fat black rub rail belting the glowing band (wraps the rear),
  // plus the sill rail fused to the bottom of the window row
  b.boxMM(-X - 0.03, D.bodyY0, zb0 - 0.01, X + 0.03, D.railY1, zb1 + 0.03, { ...black, segZ: SZ });
  b.boxMM(-X - 0.02, D.sillY0, zb0 - 0.01, X + 0.02, D.winY0, zb1 + 0.02, { ...black, segZ: SZ });

  // ------------------------------------------------------------- side windows
  const winY0 = D.winY0;
  const winY1 = D.winY1;
  const sideWin = (side: number, z0: number, z1: number, glintOn = true) => {
    const x = side * (X + 0.008);
    b.boxMM(x - 0.012, winY0, z0, x + 0.012, winY1, z1, glass);
    if (glintOn) {
      // a chunky light glint in the upper front corner
      const gx = side * (X + 0.018);
      b.boxMM(gx - 0.008, winY1 - 0.22, z0 + 0.08, gx + 0.008, winY1 - 0.08, z0 + 0.34, glint);
    }
  };
  // six chunky panes per side; pillars wide enough to survive at 0.3 m/pixel
  const paneW = 1.02;
  const pillar = 0.3;
  for (let k = 0; k < 6; k++) {
    const z0 = -2.88 + k * (paneW + pillar);
    sideWin(-1, z0, z0 + paneW, k % 2 === 0);
    sideWin(1, z0, z0 + paneW, k % 2 === 1);
  }
  // driver window (left front)
  sideWin(-1, -3.86, -3.08);
  // taped crack across one left window
  b.box(-X - 0.03, (winY0 + winY1) / 2, -2.88 + 2 * (paneW + pillar) + paneW / 2, 0.02, 0.09, 1.08, tape, 0.58, 0, 0);

  // --------------------------------------------------------- windshield + cap
  const wsz = zb0 - 0.008;
  b.boxMM(-1.1, 2.02, wsz - 0.012, -0.06, 2.68, wsz + 0.012, glass);
  b.boxMM(0.06, 2.02, wsz - 0.012, 1.1, 2.68, wsz + 0.012, glass);
  b.boxMM(-0.96, 2.46, wsz - 0.022, -0.74, 2.6, wsz - 0.006, glint);
  b.boxMM(0.2, 2.46, wsz - 0.022, 0.42, 2.6, wsz - 0.006, glint);
  // a black visor brow over the windshield
  b.boxMM(-1.16, 2.7, zb0 - 0.16, 1.16, 2.76, zb0 + 0.02, black);
  // 8-way warning lights in black housings: amber inboard, red outboard (front and rear)
  for (const end of [-1, 1]) {
    const z = end < 0 ? zb0 - 0.02 : zb1 + 0.02;
    b.boxMM(-1.08, 2.76, z - 0.03, 1.08, 2.96, z + 0.03, blackDim);
    for (const side of [-1, 1]) {
      const phase = side < 0 ? 0 : 1;
      const lz = z + end * 0.04;
      b.prism(side * 0.5, 2.86, lz, 0.085, 0.05, 8, 'z', { ramp: Ramp.ORANGE, lo: 0.05, part: PART.FLASH_AMBER, param: phase }, Math.PI / 8);
      b.prism(side * 0.88, 2.86, lz, 0.085, 0.05, 8, 'z', { ramp: Ramp.RED, lo: 0.05, part: PART.FLASH_RED, param: phase }, Math.PI / 8);
    }
  }

  // ----------------------------------------------------------- hood and face
  const hz0 = -5.38;
  // sloped hood with a chamfered, rounded-ish nose: profile drawn in (z, y),
  // extruded across the width (local x = -z after a quarter turn about Y)
  {
    const prof: Array<[number, number]> = [
      [-zb0, D.bodyY0],
      [-hz0, D.bodyY0],
      [-hz0, 1.68],
      [-hz0 - 0.08, 1.8],
      [-hz0 - 0.24, 1.89],
      [-zb0, 1.99],
    ];
    b.pushAt(0, 0, 0, 0, Math.PI / 2, 0);
    b.extrudeZ(prof, -0.92, 0.92, yellowHi);
    b.pop();
  }
  // fenders: the right one proud, the left one dented in
  b.boxMM(0.92, D.bodyY0, hz0 + 0.04, X, 1.66, zb0, yellow);
  b.boxMM(0.95, 1.66, hz0 + 0.1, X - 0.03, 1.73, zb0, yellowHi);
  b.pushAt(-(0.92 + X) / 2 + 0.02, (D.bodyY0 + 1.66) / 2 - 0.02, (hz0 + 0.04 + zb0) / 2, 0.05, -0.07, 0.035);
  b.box(0, 0, 0, X - 0.92, 1.66 - D.bodyY0, zb0 - hz0 - 0.04, yellow);
  b.box(0, 0.24, 0.05, X - 0.98, 0.07, zb0 - hz0 - 0.18, yellowHi);
  b.pop();
  // grille: chrome surround, black core, three slats
  b.boxMM(-0.5, 1.28, hz0 - 0.03, 0.5, 1.7, hz0 + 0.01, chrome);
  b.boxMM(-0.42, 1.34, hz0 - 0.045, 0.42, 1.64, hz0 - 0.02, black);
  for (const y of [1.46, 1.58]) b.boxMM(-0.38, y - 0.025, hz0 - 0.055, 0.38, y + 0.025, hz0 - 0.04, chrome);

  // the eye: big chrome pod + glowing lens (right), the dead one taped (left)
  for (const side of [-1, 1]) {
    const x = side * D.eyeX;
    b.prism(x, D.eyeY, D.eyeZ + 0.11, D.eyeR + 0.07, 0.16, 12, 'z', chrome);
    if (side > 0) {
      b.prism(x, D.eyeY, D.eyeZ - 0.01, D.eyeR, 0.05, 12, 'z', { ramp: Ramp.GLOW_WHITE, lo: 0.3, glow: 0.8, part: PART.EYE });
      // the lid / visor: a heavy black brow that drops and tilts when queasy
      b.box(x + 0.01, D.lidY, D.eyeZ - 0.06, 0.66, 0.12, 0.16, { ramp: Ramp.BUS_BLACK, lo: 0.04, part: PART.LID });
    } else {
      b.prism(x, D.eyeY, D.eyeZ - 0.0, D.eyeR, 0.04, 12, 'z', { ramp: Ramp.WINDOW, lo: -0.2 });
      // duct tape X over the dead eye
      b.box(x, D.eyeY, D.eyeZ - 0.05, 0.66, 0.1, 0.03, tape, 0, 0, 0.72);
      b.box(x, D.eyeY, D.eyeZ - 0.065, 0.66, 0.1, 0.03, tape, 0, 0, -0.72);
      // droopy brow, permanently half shut
      b.box(x - 0.02, D.lidY - 0.06, D.eyeZ - 0.06, 0.64, 0.12, 0.16, black, 0, 0, 0.2);
    }
  }

  // ------------------------------------------- duct-taped front bumper (droops)
  b.pushAt(0, 1.0, -5.53, 0, 0, 0.05);
  b.box(0, 0, 0, 2.56, 0.28, 0.24, black);
  // wraps holding up the sagging end
  b.box(-1.0, 0, 0, 0.17, 0.33, 0.29, tape);
  b.box(-0.76, 0, 0, 0.13, 0.33, 0.29, tape, 0.15, 0, 0);
  // an X patch on the good side
  b.box(0.62, 0, -0.125, 0.44, 0.08, 0.02, tape, 0, 0, 0.5);
  b.box(0.62, 0, -0.135, 0.44, 0.08, 0.02, tape, 0, 0, -0.5);
  b.pop();
  // brackets
  b.boxMM(-0.86, 0.9, -5.44, -0.66, 1.06, -5.36, blackDim);
  b.boxMM(0.66, 0.96, -5.44, 0.86, 1.1, -5.36, blackDim);

  // ---------------------------------------------------------------- door (R)
  const dz0 = D.doorZ0;
  const dz1 = D.doorZ1;
  const dzm = (dz0 + dz1) / 2;
  // glowing doorway behind the leaves (white-hot when the mouth opens)
  b.boxMM(X - 0.004, D.doorY0, dz0 + 0.02, X + 0.008, D.doorY1, dz1 - 0.02, { ramp: Ramp.GLOW_WHITE, lo: -0.3, part: PART.DOORWAY });
  for (const leaf of [0, 1]) {
    const part = leaf === 0 ? PART.DOOR_F : PART.DOOR_R;
    const hinge = leaf === 0 ? dz0 : dz1;
    const za = leaf === 0 ? dz0 : dzm + 0.005;
    const zc = leaf === 0 ? dzm - 0.005 : dz1;
    const x = D.doorX;
    // yellow frame, two glass panes, black rubber seal on the meeting edge
    b.boxMM(x - 0.012, D.doorY0, za, x + 0.012, D.doorY1, zc, { ramp: Ramp.BUS_YELLOW, lo: 0.12, part, param: hinge });
    b.boxMM(x + 0.006, 1.98, za + 0.06, x + 0.02, 2.72, zc - 0.06, { ramp: Ramp.WINDOW, lo: -0.08, part, param: hinge });
    b.boxMM(x + 0.006, 1.42, za + 0.06, x + 0.02, 1.86, zc - 0.06, { ramp: Ramp.WINDOW, lo: -0.08, part, param: hinge });
    const edge = leaf === 0 ? zc : za;
    b.boxMM(x - 0.01, D.doorY0, edge - 0.025, x + 0.026, D.doorY1, edge + 0.025, { ramp: Ramp.BUS_BLACK, lo: 0, part, param: hinge });
  }

  // ------------------------------------------------------- stop arm (left side)
  {
    const hz = D.armZ;
    const o = (ramp: number, lo: number): PartOpts => ({ ramp, lo, part: PART.ARM, param: hz });
    const cz = hz + 0.46;
    // bracket from the hinge to the sign
    b.boxMM(D.armX - 0.05, D.armY - 0.05, hz, D.armX + 0.005, D.armY + 0.05, cz - 0.2, o(Ramp.BUS_BLACK, 0));
    // double-faced octagon: red / white rim / red, with a white "STOP" bar each side
    b.prism(D.armX - 0.012, D.armY, cz, D.armR, 0.02, 8, 'x', o(Ramp.RED, 0.06), Math.PI / 8);
    b.prism(D.armX - 0.032, D.armY, cz, D.armR + 0.045, 0.02, 8, 'x', o(Ramp.WHITE, 0.05), Math.PI / 8);
    b.prism(D.armX - 0.052, D.armY, cz, D.armR, 0.02, 8, 'x', o(Ramp.RED, 0.06), Math.PI / 8);
    b.boxMM(D.armX - 0.068, D.armY - 0.05, cz - 0.18, D.armX - 0.058, D.armY + 0.05, cz + 0.18, o(Ramp.WHITE, 0.12));
    b.boxMM(D.armX - 0.006, D.armY - 0.05, cz - 0.18, D.armX + 0.004, D.armY + 0.05, cz + 0.18, o(Ramp.WHITE, 0.12));
  }

  // ---------------------------------------------------------- mirrors ("ears")
  for (const side of [-1, 1]) {
    const o = (ramp: number, lo: number): PartOpts => ({ ramp, lo, part: PART.MIRROR, param: side });
    const ax = side * D.mirX;
    b.boxMM(Math.min(ax, side * 1.6), D.mirY - 0.035, -3.86, Math.max(ax, side * 1.6), D.mirY + 0.035, -3.8, o(Ramp.BUS_BLACK, 0));
    b.boxMM(side * 1.57, 2.28, -3.86, side * 1.63, D.mirY, -3.8, o(Ramp.BUS_BLACK, 0));
    b.box(side * 1.62, 2.18, -3.88, 0.12, 0.46, 0.26, o(Ramp.BUS_BLACK, 0.04));
    b.box(side * 1.62, 2.18, -3.74, 0.08, 0.38, 0.02, o(Ramp.WINDOW, 0.25));
  }

  // ------------------------------------------------------------------ wheels
  for (const az of [D.axleF, D.axleR]) {
    for (const side of [-1, 1]) {
      const w = (ramp: number, lo: number): PartOpts => ({ ramp, lo, part: PART.WHEEL, param: az });
      const x = side * D.wheelX;
      b.prism(x, D.axleY, az, D.wheelR, D.tireW, 14, 'x', w(Ramp.BUS_BLACK, -0.04));
      const hx = side * (D.wheelX + D.tireW / 2 + 0.02);
      b.prism(hx, D.axleY, az, 0.27, 0.05, 10, 'x', w(Ramp.GREY_LIGHT, 0.12));
      b.box(hx + side * 0.03, D.axleY, az, 0.02, 0.46, 0.08, w(Ramp.BUS_BLACK, 0));
      b.box(hx + side * 0.03, D.axleY, az, 0.02, 0.08, 0.46, w(Ramp.BUS_BLACK, 0));
    }
  }

  // ------------------------------------------- belly band: 24 rainbow slices
  // Full-width slices so the same glow covers both skirts and the underside.
  // Hue runs red (rear) -> violet (front); fill runs back to front.
  const N = D.bandSlices;
  const len = D.bandZ1 - D.bandZ0;
  for (let i = 0; i < N; i++) {
    const z1 = D.bandZ1 - (i * len) / N;
    const z0 = D.bandZ1 - ((i + 1) * len) / N;
    const hue = Math.floor((i * 6) / N);
    b.boxMM(-D.bandX, D.bandY0, z0, D.bandX, D.bandY1, z1, { ramp: HUE[hue], lo: -0.5, part: PART.BAND, param: (i + 0.5) / N });
  }
  // rear band: a six-hue progress bar across the back (left -> right seen from behind)
  for (let j = 0; j < 6; j++) {
    const x0 = -D.bandX + (j * 2 * D.bandX) / 6;
    const x1 = x0 + (2 * D.bandX) / 6;
    b.boxMM(x0, D.bandY0, zb1, x1, D.bandY1, zb1 + 0.07, { ramp: HUE[j], lo: -0.5, part: PART.BAND, param: (j + 0.5) / 6 });
  }

  // -------------------------------------------------------------------- rear
  const rz = zb1 + 0.008;
  const rearWin = (x0: number, x1: number, g: boolean) => {
    b.boxMM(x0, winY0, rz - 0.012, x1, winY1, rz + 0.012, glass);
    if (g) b.boxMM(x0 + 0.06, winY1 - 0.2, rz + 0.01, x0 + 0.24, winY1 - 0.07, rz + 0.022, glint);
  };
  rearWin(-1.12, -0.52, true);
  rearWin(-0.38, 0.38, true);
  rearWin(0.52, 1.12, false);
  // emergency door frame (thin dark lines) + handle
  b.boxMM(-0.45, D.bodyY0, rz - 0.01, -0.42, 2.78, rz + 0.016, blackDim);
  b.boxMM(0.42, D.bodyY0, rz - 0.01, 0.45, 2.78, rz + 0.016, blackDim);
  b.boxMM(0.12, 1.8, rz, 0.34, 1.86, rz + 0.05, chrome);
  // tail lights (one taped)
  for (const side of [-1, 1]) {
    b.prism(side * 0.96, 1.64, rz + 0.02, 0.13, 0.05, 10, 'z', { ramp: Ramp.RED, lo: 0.08, glow: 0.38 });
  }
  b.box(0.96, 1.64, rz + 0.055, 0.36, 0.075, 0.02, tape, 0, 0, 0.45);
  // rear bumper + exhaust
  b.boxMM(-1.24, 0.56, zb1, 1.24, 0.78, zb1 + 0.22, black);
  b.box(0.72, 0.67, zb1 + 0.11, 0.15, 0.26, 0.26, tape);
  b.prism(-0.78, 0.47, zb1 + 0.16, 0.075, 0.36, 8, 'z', blackDim);

  // -------------------------------------------------------------------- roof
  const rt = D.roofTop;
  // front hatch (closed for good)
  b.box(0, rt + 0.02, -2.2, 0.82, 0.04, 0.82, black);
  b.box(0, rt + 0.055, -2.2, 0.72, 0.05, 0.72, chrome);
  // duct-tape X patch on the roof
  b.box(0.42, rt + 0.012, -0.45, 1.05, 0.024, 0.27, tape, 0, 0.62, 0);
  b.box(0.42, rt + 0.018, -0.45, 1.05, 0.024, 0.27, tape, 0, -0.62, 0);
  // the pressure-valve hatch: glowing hole + hinged lid that rattles when full
  const hs = D.hatchS;
  b.box(0, rt + 0.015, D.hatchZ, hs + 0.1, 0.03, hs + 0.1, black);
  b.box(0, rt + 0.034, D.hatchZ, hs - 0.1, 0.012, hs - 0.1, { ramp: Ramp.RED, lo: -0.3, part: PART.HOLE });
  const hingeZ = D.hatchZ - hs / 2;
  b.box(0, rt + 0.065, D.hatchZ, hs, 0.05, hs, { ramp: Ramp.GREY_LIGHT, lo: 0.24, part: PART.HATCH, param: hingeZ });
  b.box(0, rt + 0.1, D.hatchZ + 0.12, 0.2, 0.03, 0.08, { ramp: Ramp.BUS_BLACK, lo: 0, part: PART.HATCH, param: hingeZ });

  return b.build();
}

/** Object-space helpers for the model's anchor points (scale 1). */
export const ANCHOR = {
  mouth: [D.doorX + 0.12, Y(1.7), (D.doorZ0 + D.doorZ1) / 2] as const,
  belly: [0, Y(D.bandY0), (D.bandZ0 + D.bandZ1) / 2] as const,
  eye: [D.eyeX, Y(D.eyeY), D.eyeZ - 0.04] as const,
  hatch: [0, Y(D.roofTop + 0.06), D.hatchZ] as const,
  exhaust: [-0.78, Y(0.47), D.zRear + 0.12] as const,
};

export { Y as designToObjectY };
