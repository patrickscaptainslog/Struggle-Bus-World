// How big the bus stands on the screen: a function of the height over the nearest surface and nothing else, so a bus at 300 km over the Moon is a speck against a world and a bus over a street is the hero.
// One smooth curve, no steps, for flight anywhere: the low rig's size up to about 1 km, about twice the far size at 15 km, the far size from 100 km up. Used by ?moonrun alone today; the low game can take it as it is.
// True perspective: it's done by pulling the camera back and letting the heroic scale go, not by drawing a smaller bus, so whatever stands near the bus keeps its place against it.
import { config } from '../config';

const DEG = Math.PI / 180;

/** Game px long, bumper to bumper, side on: far from the ground, and at midKm. Tuner rows ("Moon run"). */
export const busSize = {
  farPx: 8,
  midPx: 16,
  midKm: 15,
};

export interface BusRig {
  /** game px long, side on */
  px: number;
  /** the bus's scale */
  hero: number;
  /** m from the camera to the bus */
  distance: number;
}

/** The size at the ground: the low rig's at full vista, on any lens. */
const nearPx = (frameW: number, busLength: number) => ((frameW / 2 / Math.tan((config.camera.hfovVista * DEG) / 2)) * busLength * config.camera.heroScaleVista) / config.camera.distanceVista;

/** Game px long at height hKm: far + (near - far) / (1 + (h / knee)^2), with the knee where the curve goes through the middle row. */
export function busPx(hKm: number, near: number): number {
  const B = busSize, knee2 = (B.midKm * B.midKm * Math.max(B.midPx - B.farPx, 1e-3)) / Math.max(near - B.midPx, 1e-3);
  return B.farPx + (near - B.farPx) / (1 + (hKm * hKm) / knee2);
}

/** The rig for height hKm on a lens of `focal` game px, for a frame frameW game px wide and a bus busLength m long at scale 1. Writes o and returns it. */
export function busRig(hKm: number, focal: number, frameW: number, busLength: number, o: BusRig): BusRig {
  const near = nearPx(frameW, busLength), px = busPx(hKm, near);
  o.px = px;
  o.hero = 1 + (config.camera.heroScaleVista - 1) * Math.max(0, Math.min(1, (px - busSize.farPx) / Math.max(near - busSize.farPx, 1e-3)));
  o.distance = (focal * busLength * o.hero) / px;
  return o;
}
