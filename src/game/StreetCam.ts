import type { CameraRig } from './CameraRig';
import type { Flight, WorldQuery } from './Flight';

// ?streetcam: the street camera preview (docs/specs/shots/SHOTS.md, "Bare streets"; GEARS.md). Curb will put the
// wheels on the street; before anyone decides on street surfaces, this shows how a street looks from there. The bus
// is set down where ?lat, ?lon and ?heading put it (tools/streetcam/pick.ts finds four streets in the data, a busy
// arterial, a residential street, a hill and a waterfront road), 4 m over the ground, still, with the lens at street
// height behind it. A drag off the bus still looks round it. ?streetcam=wide is a wider, closer lens.
//
// A preview, not Curb: nothing rolls, nothing lands, and the gears do nothing here.

/** The bus's height over the road (m): its wheels on the asphalt. */
const OVER = 4;

export class StreetCam {
  private x = 0;
  private z = 0;
  private heading = 0;

  constructor(params: URLSearchParams, f: Flight, rig: CameraRig, world: WorldQuery) {
    this.x = f.x;
    this.z = f.z;
    this.heading = f.heading;
    // (the chase: a longer lens behind, just over the roof; wide: a short one at a driver's height. Never under the ground behind, up a hill)
    const floor = (x: number, z: number) => world.groundAt(x, z);
    rig.street = params.get('streetcam') === 'wide' ? { back: 16, eye: 3.2, ahead: 60, at: 3, hfov: 58, floor } : { back: 34, eye: 7.5, ahead: 90, at: 3.5, hfov: 34, floor };
  }

  /** After the flight's steps: the bus stays where it was set down, on the road. */
  hold(f: Flight, world: WorldQuery): void {
    f.x = this.x;
    f.z = this.z;
    f.heading = this.heading;
    f.y = world.groundAt(this.x, this.z) + OVER;
    f.vy = 0;
    f.speed = 0;
    f.yawRate = 0;
    f.bank = 0;
    // (on a hill it stands on the slope)
    const fx = f.fx * 6, fz = f.fz * 6;
    f.pitch = Math.atan2(world.groundAt(this.x + fx, this.z + fz) - world.groundAt(this.x - fx, this.z - fz), 12);
  }
}
