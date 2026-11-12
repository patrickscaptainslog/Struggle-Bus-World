import * as THREE from 'three';
import { config } from '../config';
import { viewPitch } from './Ascent';
import { angleDelta, clamp, settle, spring } from './springs';
import type { Flight } from './Flight';
import { swerveTune } from './Swerve';

// Telephoto chase camera: behind and above, lagging so turns sweep. It tilts
// toward a diorama view when the bus slows to aim and levels toward the
// horizon when it surges. The bus sits just above the thumb zone.
//
// Vista: as the bus climbs above the city the rig pulls back, widens
// the lens and looks down more, but the look point moves ahead so the view
// pitch stays shallow (pitchVista): the horizon and the sky stay at the top of
// the frame, it never becomes a top-down map. The bus grows a little
// (heroScale) so it stays the hero at that distance.
//
// A dive is the one exception to the sky at the top of the frame: the view
// tips over the bus until the place it is heading for is on screen, driven by
// the yoke alone, and it leaves nothing behind when it eases out.
//
// The look: a second thumb turns the finished view round the bus, one yaw offset
// and one pitch offset on the wall clock (a hit-stop doesn't stall them), with a
// spring home on the lift. It moves the pose after everything above has run and
// touches none of its state: settled, the rig is exactly what it was. Sideways
// and down the whole pose turns about the bus, so the bus stands where it stood,
// the follow's lag and all, at any speed. Up the lens tilts where it is, because
// lowering it would stand it among the roofs; past about 19 degrees the bus
// leaves by the bottom of the frame. Zoom and distance don't change.

const smooth01 = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
/** (rad) a look arrives exactly from here: under a tenth of a game pixel, where a tail would only swim the frame */
const LOOK_HOME = 1e-4;
/** (m) Curb: how far apart the lens's sight line to the bus is tried for what's solid, and how far either side of it */
const CURB_STEP = 0.5;
const CURB_WIDE = 0.5;

/** The look's curve, a x + b x^3: lookDegPerPx at the start, 180 degrees at lookFullPx. Past 180 it stays that curve, and with a start steep enough to get there on its own, a line. */
const curve = { a: 0, b: 0 };
/** (fills `curve` from the tuner's numbers, read live, in place: it runs four times a frame while a look is held) */
const lookCurve = () => {
  const C = config.camera;
  const a = Math.max(0.01, C.lookDegPerPx), full = Math.max(1, C.lookFullPx);
  curve.a = a;
  curve.b = Math.max(0, 180 - a * full) / (full * full * full);
  return curve;
};

/** The look's angle (deg) for a thumb's offset from where it landed (px): a small nudge is a small look, and the look behind is still there. */
export function lookDeg(px: number): number {
  const { a, b } = lookCurve();
  return px * (a + b * px * px);
}

/** ...and the offset that asks for an angle (Newton's, from the line above the curve: it comes down onto the root and stays there). */
export function lookPx(deg: number): number {
  const { a, b } = lookCurve();
  let x = deg / a;
  for (let i = 0; i < 6; i++) x -= (x * (a + b * x * x) - deg) / (a + 3 * b * x * x);
  return x;
}

export class CameraRig {
  /** 0..1 vista blend (with the bus's height above the broad ground, latched while holding) */
  vista = 0;
  private vistaTarget = 0;
  /** the height the lens is set for (m): like the vista, only the yoke moves it, so a held view is perfectly still */
  private lensHeight = 0;
  private lensTarget = 0;
  /** 0..1: how far the view has tipped over a dive (eases after the nose; exactly 0 once it has settled back) */
  dive = 0;
  /** where the far fade ends at the ground (m, main.ts): the view looks down past it as it drops */
  fadeBase = 34000;
  /** horizontal portrait fov the pipeline should use (deg) */
  hfov = config.camera.hfovPortrait;
  /** scale for the bus model (hero readability at altitude) */
  heroScale = 1;
  /** current distance from the camera to the bus (m) */
  distance = config.camera.distance;
  private yaw = 0;
  private yawVel = 0;
  private pos = new THREE.Vector3();
  private posVel = new THREE.Vector3();
  private elev = config.camera.elevationCruise;
  private look = new THREE.Vector3();
  private initialized = false;
  /** extra pull-back for the opening shot (m) */
  openingPull = 0;
  /** 0..1: low, level cinematic camera for the Golden Gate opening (passes under the deck) */
  openingLow = 0;
  /** the low shot's distance back (m) and elevation (deg): the opening's 150 and 6.5; ?lift's under the floating houses is longer-lensed and flatter */
  lowDist = 150;
  lowEl = 6.5;
  /** ?lift (world/Lift.ts clampLens): where the lens may stand at (x, z), given its height and the low shot's blend. Null otherwise */
  liftClamp: ((x: number, z: number, y: number, low: number) => number) | null = null;
  /** ?lift: the look stays on in the low shot (under the floating houses it is the whole neighbourhood, not one bridge's few seconds) */
  lookInLow = false;
  /** Turbo gears (src/fx/Turbo.ts): extra pull-back (m), lens widening (deg), hero scale (x), and leads (m)
   *  added to the follow / look targets that cancel part of the springs' lag at turbo speeds */
  turboPull = 0;
  turboFov = 0;
  turboHero = 1;
  readonly turboLead = new THREE.Vector3();
  /** ?recess's hook (src/recess/recessBoot.ts sets them each frame; 0 everywhere else): a wider lens in the match (deg) and a pull-back while a rival is near (m) */
  matchFov = 0;
  matchPull = 0;
  readonly turboLookLead = new THREE.Vector3();
  /** School Zone (Controls, per frame): 1 brings the lens in by config.zone.camIn of its distance; zoneIn is where that is now, eased */
  zone = 0;
  zoneIn = 0;
  /** ?streetcam (StreetCam.ts): the lens at street height behind a bus set down on a road, instead of the chase. Null: the chase */
  street: { back: number; eye: number; ahead: number; at: number; hfov: number; floor: (x: number, z: number) => number } | null = null;
  /** Curb (CurbFlight, per frame): 1 brings the lens down to the kerb chase, `curbLens` (back, eye over the road, ahead, at, width, and `side` m to
   *  the bus's right; the road is config.curb.ride under the bus), never under `curbFloor` (the road under fromY) + config.curb.camFloor nor within
   *  config.curb.roofGap of `curbRoof` (a deck over it), and pulled in short of anything `curbBlock` says is solid between it and the bus; curbIn is
   *  where it is now, eased in and out. A look there turns at most config.curb.lookMax either way */
  curb = 0;
  curbIn = 0;
  curbLens: { back: number; eye: number; ahead: number; at: number; fov: number; side: number } | null = null;
  curbFloor: ((x: number, z: number, fromY: number) => number) | null = null;
  curbRoof: ((x: number, z: number, fromY: number) => number) | null = null;
  curbBlock: ((x: number, z: number, y: number) => boolean) | null = null;
  /** how far in from where it would stand the lens is pulled (m): at once to clear what's in the way, eased back out */
  private curbPull = 0;
  /** how much of a look's swing round the bus the street leaves it (0..1): taken back at once, given back eased */
  private curbSwing = 1;
  private readonly curbTry = new THREE.Vector3();
  private readonly curbPos = new THREE.Vector3();
  private readonly curbLook = new THREE.Vector3();
  /** The live sky's lift (SKY.md 4.15): the view tips up toward this (deg), eased, and holds there; skyLift is where it is now */
  skyLiftTarget = 0;
  skyLift = 0;
  /** ...eased at this rate (1/s), config.sky.liftRate when 0 (a Lob's tip follows its star faster: main.ts) */
  skyLiftRate = 0;
  /** the look (setLook): how far a thumb has the view off the rig (rad, x = +right, y = +up; exactly 0 once home) */
  private readonly lookYaw = { x: 0, v: 0 };
  private readonly lookPitch = { x: 0, v: 0 };
  private lookOn = false;
  /** the look's up and down: where the thumb's offset says level (px), dragged along behind the thumb at a limit */
  private lookSlack = 0;
  /** seconds this look has been held */
  private lookHeld = 0;
  /** where this look found the view (rad): it starts from there */
  private lookFromYaw = 0;
  private lookFromPitch = 0;
  /** where a tap goes off the nose (rad): the look, out to config.camera.lookAimMax */
  aimYaw = 0;
  /** The look as it stands (rad, +right and +up, 0 at home): the flight's view lays the same look over its own (src/sky/TripView.ts). */
  get lookYawNow(): number {
    return this.lookYaw.x;
  }
  get lookPitchNow(): number {
    return this.lookPitch.x;
  }
  /** how far the stream's center has followed the look (rad): nothing until a look has been held a while */
  private streamYaw = 0;
  private readonly lookQ = new THREE.Quaternion();
  private readonly lookV = new THREE.Vector3();
  private readonly lookAxis = new THREE.Vector3();
  /** 0..1 while barfing: tilt down and pull the look point in so the splat below the bus is visible */
  barfTilt = 0;
  shake = 0;
  private kickT = 1e3;
  private kickA = 0;
  /** &boom's crack (TurboFx.crack): a turn of the view that rings down, where the kick only moves it */
  private joltT = 1e3;
  private joltA = 0;
  private readonly kickUp = new THREE.Vector3();
  private readonly kickRight = new THREE.Vector3();
  private readonly bus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly lookDir = new THREE.Vector3();

  /** ?moon: the ground under the lens. A street has no slope to speak of; a hill behind the bus would have the lens inside it, looking out through the back of the ground. */
  floorAt: ((x: number, z: number) => number) | null = null;
  /** 0..1, ?moonland: the follow stands where it should, with no lag: a bus coming down at kilometres a second would run out from under the springs. */
  stiff = 0;

  /** ?moon: the map slid by (dx, dz) (main.ts): the lens and what it looks at are where they were, by the new map. */
  slide(dx: number, dz: number) {
    this.pos.x -= dx;
    this.pos.z -= dz;
    this.look.x -= dx;
    this.look.z -= dz;
  }

  /** The bus comes in from a height with the view at its height: the rig is where it would have got to by itself, tipped as far over a dive as the view it takes over from. */
  place(cam: THREE.PerspectiveCamera, f: Flight, dive: number) {
    this.initialized = true;
    this.yaw = f.heading;
    this.yawVel = 0;
    this.vista = this.vistaTarget = 1;
    this.dive = dive;
    this.lensHeight = this.lensTarget = f.height;
    this.pos.copy(cam.position);
    this.posVel.set(0, 0, 0);
    this.look.set(f.x + f.fx, f.y - 4, f.z + f.fz);
    this.elev = config.camera.elevationCruise;
  }

  update(cam: THREE.PerspectiveCamera, focusOut: THREE.Vector3, f: Flight, dt: number) {
    const C = config.camera;
    const F = config.flight;
    if (!this.initialized) {
      this.yaw = f.heading;
      this.initialized = true;
    }
    // yaw lags the bus heading (springy); in ?swerve's hard turn its spring stiffens with the flight's, so it keeps up (Swerve.hard)
    const target = this.yaw + angleDelta(this.yaw, f.heading);
    const hard = f.swerve.hard, yawHz = hard > 0 ? C.yawHz * (1 + (Math.max(1, swerveTune.hardCam) - 1) * hard) : C.yawHz;
    [this.yaw, this.yawVel] = spring(this.yaw, this.yawVel, target, yawHz, C.yawDamping, dt);

    // elevation from speed: slow -> diorama, fast -> vista
    const sp = f.speed;
    let e: number;
    if (sp < F.cruiseSpeed) e = C.elevationSlow + (C.elevationCruise - C.elevationSlow) * clamp((sp - C.slowSpeed) / Math.max(1, F.cruiseSpeed - C.slowSpeed), 0, 1);
    else e = C.elevationCruise + (C.elevationSurge - C.elevationCruise) * clamp((sp - F.cruiseSpeed) / (F.surgeSpeed - F.cruiseSpeed), 0, 1);
    this.elev += (e - this.elev) * (1 - Math.exp(-1.8 * dt));

    // vista blend. Only the yoke moves it: while climbing or diving it follows the height above the
    // broad ground (terrain, not roofs); holding an altitude freezes the lens where it is (a lens that
    // breathes with every roof and hill rescales the pixel grid and swims the whole frame); skimming
    // the floor it goes home to the classic chase camera.
    if (f.holdY < -1e8) this.vistaTarget = 0;
    else if (f.mode === 2 || f.mode === 3) this.vistaTarget = smooth01(C.vistaStart, Math.max(C.vistaStart + 1, C.vistaFull), f.height);
    const dv = this.vistaTarget - this.vista;
    // (once the yoke lets go it settles briskly and exactly, so a held lens is perfectly still within ~2 s)
    const moving = f.mode === 2 || f.mode === 3;
    if (Math.abs(dv) < 0.003) this.vista = this.vistaTarget;
    else this.vista += dv * (1 - Math.exp(-(moving ? C.vistaRate : Math.max(C.vistaRate, C.vistaSettle)) * dt));
    if (f.holdY < -1e8) this.lensTarget = 0;
    else if (moving) this.lensTarget = f.height;
    const dl = this.lensTarget - this.lensHeight;
    if (Math.abs(dl) < 1) this.lensHeight = this.lensTarget;
    else this.lensHeight += dl * (1 - Math.exp(-(moving ? C.vistaRate : Math.max(C.vistaRate, C.vistaSettle)) * dt));
    const low = this.openingLow;
    const v = this.vista * (1 - low);
    // a dive tips the view over the bus, and only a dive: it follows the nose on the yoke, and goes home on its own
    const diveWant = f.mode === 3 ? clamp((THREE.MathUtils.radToDeg(-f.nose) - C.diveFrom) / Math.max(1, F.noseDown - C.diveFrom), 0, 1) : 0;
    // (it arrives exactly, at a crawl: a last step would tilt the whole frame by a pixel)
    const dd = diveWant - this.dive;
    const ds = Math.max(Math.abs(dd) * (1 - Math.exp(-C.diveRate * dt)), 0.04 * dt);
    this.dive = Math.abs(dd) <= ds ? diveWant : this.dive + Math.sign(dd) * ds;
    const dive = this.dive * (1 - low);
    this.hfov = C.hfovPortrait + (C.hfovVista - C.hfovPortrait) * v + this.turboFov + this.matchFov;
    this.heroScale = (1 + (C.heroScaleVista - 1) * v) * this.turboHero;
    const barf = this.barfTilt * (1 - v) * (1 - dive); // up high the splat lands mid-screen anyway
    let elev = this.elev + (C.elevationVista - this.elev) * v;
    elev += (C.diveElevation - elev) * dive;
    const el = THREE.MathUtils.degToRad(elev + 11 * barf + (this.lowEl - elev) * low);
    // (School Zone comes in, at a pace of its own: never a cut)
    const dz = this.zone - this.zoneIn;
    this.zoneIn = Math.abs(dz) < 1e-3 ? this.zone : this.zoneIn + dz * (1 - Math.exp(-config.zone.camRate * dt));
    const zin = 1 - config.zone.camIn * this.zoneIn * (1 - low);
    const dist = ((C.distance + (C.distanceVista - C.distance) * v + this.openingPull + this.turboPull + this.matchPull) * (1 - low) + this.lowDist * low) * zin;
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const bus = this.bus.set(f.x, f.y, f.z);
    const desired = this.desired.set(bus.x - fx * Math.cos(el) * dist, bus.y + Math.sin(el) * dist, bus.z - fz * Math.cos(el) * dist).addScaledVector(this.turboLead, 1 - this.stiff);
    if (this.pos.lengthSq() === 0) this.pos.copy(desired);
    // critically damped follow (keeps the bus framed but lets motion breathe)
    const w = 2 * Math.PI * C.followHz;
    for (const k of ['x', 'y', 'z'] as const) {
      const a = w * w * (desired[k] - this.pos[k]) - 2 * C.followDamping * w * this.posVel[k];
      this.posVel[k] += a * dt;
      this.pos[k] += this.posVel[k] * dt;
      if (this.stiff > 0) this.pos[k] += (desired[k] - this.pos[k]) * this.stiff;
    }
    if (this.floorAt) {
      const y = this.floorAt(this.pos.x, this.pos.z) + 4;
      if (this.pos.y < y) {
        this.pos.y = y;
        this.posVel.y = Math.max(0, this.posVel.y);
      }
    }
    if (this.liftClamp) {
      // (?lift: the lens never stands in a floating house)
      const y = this.liftClamp(this.pos.x, this.pos.z, this.pos.y, this.openingLow);
      if (y !== this.pos.y) {
        this.pos.y = y;
        this.posVel.y = 0;
      }
    }
    const spk = sp / F.cruiseSpeed;
    let la = C.lookAhead * (C.lookAheadSlow + (1 - C.lookAheadSlow) * clamp(spk, 0, 1) + 0.4 * clamp(spk - 1, 0, 1)) * (1 - 0.65 * barf) * (1 - dive) * zin;
    let pitch = 0;
    const divePitch = THREE.MathUtils.degToRad(C.divePitch);
    if (v > 0) {
      // far enough ahead that the view pitches down by pitchVista, and never so far down that
      // the horizon leaves the top of the frame (3 deg of sky) while the rig is still rising
      pitch = THREE.MathUtils.degToRad(viewPitch(this.lensHeight, this.fadeBase, cam.fov / 2)); // (the lens as the pipeline set it, portrait or landscape)
      const laV = (Math.sin(el) * dist + 4) / Math.tan(pitch + (divePitch - pitch) * dive) - Math.cos(el) * dist;
      la += (Math.max(la, laV) - la) * smooth01(0, 0.35, v);
    }
    const lookTarget = this.lookTarget.set(bus.x + fx * la * (1 + 2 * low), bus.y - 4 + 14 * low, bus.z + fz * la * (1 + 2 * low)).addScaledVector(this.turboLookLead, 1 - this.stiff);
    if (this.look.lengthSq() === 0) this.look.copy(lookTarget);
    this.look.lerp(lookTarget, 1 - Math.exp(-6 * dt));
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    if (v > 0 || dive > 0) {
      // up high the view's pitch is set outright instead of by where the bus is, so the bus's wheezy
      // bob (and the lag between the two follow springs) never rocks the whole frame: a rotation
      // can't be snapped to the pixel grid, and from up here every far roof would swim with it
      const dx = this.look.x - this.pos.x, dz = this.look.z - this.pos.z;
      const hd = Math.max(1e-3, Math.hypot(dx, dz));
      const p0 = Math.atan2(this.pos.y - this.look.y, hd);
      const p = p0 + (pitch - p0) * smooth01(0, 0.35, v);
      let ax = dx / hd, az = dz / hd;
      if (dive > 0) {
        // (tipped over the bus the look point stands nearly under the lens: the view's bearing comes from the heading instead)
        ax += (fx - ax) * dive;
        az += (fz - az) * dive;
        const al = Math.max(1e-3, Math.hypot(ax, az));
        ax /= al;
        az /= al;
      }
      const dp = p + (divePitch - p) * dive;
      this.lookDir.set(ax * Math.cos(dp), -Math.sin(dp), az * Math.cos(dp));
      cam.lookAt(this.lookDir.add(this.pos));
    } else cam.lookAt(this.look);
    // (it moves briefly, then holds still and exactly: a rotation can't be snapped, so the frame swims only while it moves; never so far that the bus leaves the frame)
    const lift = Math.min(this.skyLiftTarget, cam.fov / 2 - 6);
    const dl2 = Math.max(0, lift) - this.skyLift;
    this.skyLift = Math.abs(dl2) < 0.02 ? Math.max(0, lift) : this.skyLift + dl2 * (1 - Math.exp(-(this.skyLiftRate || config.sky.liftRate) * dt));
    if (this.skyLift !== 0) cam.rotateX(THREE.MathUtils.degToRad(this.skyLift));
    // Curb: the chase comes down to the kerb, a dolly with no cut, on the rig's own yaw so a turn still sweeps; out again, a crane up to the chase
    const dc = this.curb - this.curbIn;
    this.curbIn = Math.abs(dc) < 1e-3 ? this.curb : this.curbIn + dc * (1 - Math.exp(-(dc > 0 ? config.curb.camIn : config.curb.camOut) * dt));
    if (this.curbIn > 0 && this.curbLens) {
      const L = this.curbLens, e = smooth01(0, 1, this.curbIn), road = bus.y - config.curb.ride;
      const p = this.curbPos.set(bus.x - fx * L.back - fz * L.side, road + L.eye, bus.z - fz * L.back + fx * L.side);
      this.curbHeight(p, road);
      // (from the chase as it stands: its place, and a look point as far along its view as the bus is from it)
      const chase = cam.getWorldDirection(this.curbLook).multiplyScalar(cam.position.distanceTo(bus)).add(cam.position);
      chase.lerp(this.lookTarget.set(bus.x + fx * L.ahead, road + L.at, bus.z + fz * L.ahead), e);
      cam.position.lerp(p, e);
      cam.up.set(0, 1, 0);
      cam.lookAt(chase);
      this.hfov += (L.fov - this.hfov) * e;
    }
    if (this.street) {
      // ?streetcam: the lens stands behind the bus at street height (the road is 4 m under the bus), looking down the road
      const S = this.street;
      this.pos.set(bus.x - fx * S.back, bus.y - 4 + S.eye, bus.z - fz * S.back);
      this.pos.y = Math.max(this.pos.y, S.floor(this.pos.x, this.pos.z) + 2.5);
      this.posVel.set(0, 0, 0);
      this.look.set(bus.x + fx * S.ahead, bus.y - 4 + S.at, bus.z + fz * S.ahead);
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      this.hfov = S.hfov;
    }
    this.distance = this.curbIn > 0 ? cam.position.distanceTo(bus) : this.pos.distanceTo(bus);
    focusOut.copy(bus);
    this.applyLook(cam, bus);
    if (this.curbIn > 0 && this.curbBlock) this.curbClear(cam, bus, dt);
    else this.curbPull = 0;
    if (this.lookInLow && this.liftClamp && (this.lookYaw.x !== 0 || this.lookPitch.x !== 0)) {
      // (?lift: a look swings the lens round the bus, and never into the hill or a floating house)
      if (this.floorAt) cam.position.y = Math.max(cam.position.y, this.floorAt(cam.position.x, cam.position.z) + 4);
      cam.position.y = this.liftClamp(cam.position.x, cam.position.z, cam.position.y, this.openingLow);
    }
  }

  /**
   * The look, as Input reports it (state.look: the thumb's offset from where it landed, CSS px, +y up): main.ts hands
   * it over every frame, before update(), with the wall clock's dt (a hit-stop must not stall it). Geared like a second
   * bungee: the offset sets the angle, on the curve (lookDeg). Off under the opening's low shot, the opening's own.
   */
  setLook(on: boolean, x: number, y: number, realDt: number) {
    const C = config.camera;
    const yaw = this.lookYaw, pitch = this.lookPitch;
    if (on) {
      const k = THREE.MathUtils.DEG2RAD * (this.lookInLow ? 1 : 1 - this.openingLow);
      const py = C.lookInvertY ? -y : y;
      if (!this.lookOn) {
        this.lookSlack = 0;
        this.lookHeld = 0;
        this.lookFromYaw = yaw.x;
        this.lookFromPitch = pitch.x;
      }
      // (past a limit the landing is dragged along behind the thumb, on the thumb's own scale, so it turns back at once; sideways is the full circle, and has none)
      this.lookSlack = clamp(this.lookSlack, py - lookPx(C.lookUp), py + lookPx(C.lookDown));
      // (it starts gently: a flick can outlast the thumb's own wait, and only the lift says it was one)
      const ease = smooth01(0, Math.max(0.01, C.lookEaseIn), this.lookHeld + realDt);
      // (on the street it turns at most config.curb.lookMax either way, as the lens comes down: further round, a street's fronts stand where the lens would)
      const cap = this.curbIn > 0 ? (config.curb.lookMax * THREE.MathUtils.DEG2RAD) / Math.max(1e-3, smooth01(0, 1, this.curbIn)) : Infinity;
      settle(yaw, clamp(this.lookFromYaw + (lookDeg(x) * k - this.lookFromYaw) * ease, -cap, cap), C.lookFollowHz, realDt);
      settle(pitch, this.lookFromPitch + (lookDeg(py - this.lookSlack) * k - this.lookFromPitch) * ease, C.lookFollowHz, realDt);
    } else {
      // (home the short way round, a full turn being no turn, and from a stand: what was thrown at the lift would carry on)
      if (this.lookOn) {
        yaw.x = angleDelta(0, yaw.x);
        yaw.v = pitch.v = 0;
      }
      settle(yaw, 0, C.lookHomeHz, realDt);
      settle(pitch, 0, C.lookHomeHz, realDt);
      // (it arrives exactly)
      if (Math.abs(yaw.x) < LOOK_HOME && Math.abs(yaw.v) < LOOK_HOME * 20) yaw.x = yaw.v = 0;
      if (Math.abs(pitch.x) < LOOK_HOME && Math.abs(pitch.v) < LOOK_HOME * 20) pitch.x = pitch.v = 0;
    }
    this.lookOn = on;
    this.lookHeld = on ? this.lookHeld + realDt : 0;
    const off = angleDelta(0, yaw.x);
    // a tap goes where the view looks, sideways only, and down the nose past the limit: no tail gun
    this.aimYaw = Math.abs(off) <= THREE.MathUtils.degToRad(C.lookAimMax) ? off : 0;
    // a glance doesn't move what streams in; a long look takes it along
    const want = this.lookHeld >= C.lookStreamAfter ? off : 0;
    const ds = angleDelta(this.streamYaw, want);
    this.streamYaw = Math.abs(ds) < 0.005 ? want : this.streamYaw + ds * (1 - Math.exp(-C.lookStreamRate * realDt));
  }

  /** The stream's way from the view's, both flat: the rig's, whatever a look is doing, until a long look takes it along. */
  streamDir(view: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const d = this.streamYaw - this.lookYaw.x;
    if (d === 0) return out.copy(view);
    const c = Math.cos(d), s = Math.sin(d);
    return out.set(view.x * c - view.z * s, 0, view.z * c + view.x * s);
  }

  /** Curb: the lens at p over the road under it (the ground, or the deck the bus is on, never one over it: `road` is the bus's) and under a deck over it. */
  private curbHeight(p: THREE.Vector3, road: number) {
    const K = config.curb;
    if (this.curbFloor) p.y = Math.max(p.y, this.curbFloor(p.x, p.z, road + 3) + K.camFloor);
    if (this.curbRoof) p.y = Math.max(road + 1, Math.min(p.y, this.curbRoof(p.x, p.z, road + 1) - K.roofGap));
  }

  /**
   * Curb, on the finished pose: a narrow street first takes back as much of a look's swing round the bus as would bring the lens nearer than
   * config.curb.armKeep; then the lens over the road and under a deck where the look left it, and out from the bus to it a step at a time, the
   * first step in something solid (a front, the hill) bringing the lens in short of it, at once, to go back out eased. So a look round a narrow
   * street or a sweep past a gap between two houses never has the lens in a house nor a house between it and the bus (the review of feat/curb, B1),
   * nor the bus a wall of yellow filling the frame. The pull is along the line to the bus, so the bus stays where it stands in the frame.
   */
  private curbClear(cam: THREE.PerspectiveCamera, bus: THREE.Vector3, dt: number) {
    const K = config.curb, road = bus.y - K.ride, yaw = this.lookYaw.x;
    if (yaw !== 0) {
      // (the swing that fits, tried a quarter at a time, taken back at once and given back eased: the view turns less there. The drive-by's side
      // and the turn read the look as the thumb has it, not as the street leaves the view)
      let fit = 0;
      for (let k = 1; k > 0; k -= 0.25) {
        const p = this.curbTry.copy(cam.position).sub(bus).applyAxisAngle(UP, yaw * (1 - k)).add(bus);
        this.curbHeight(p, road);
        if (this.curbRoom(bus, p, 1, 0) >= Math.min(K.armKeep, p.distanceTo(bus))) {
          fit = k;
          break;
        }
      }
      this.curbSwing = fit <= this.curbSwing ? fit : this.curbSwing + (fit - this.curbSwing) * (1 - Math.exp(-K.armOut * dt));
      if (this.curbSwing < 1) {
        const q = this.lookQ.setFromAxisAngle(UP, yaw * (1 - this.curbSwing));
        cam.position.sub(bus).applyQuaternion(q).add(bus);
        cam.quaternion.premultiply(q);
      }
    } else this.curbSwing = 1;
    if (yaw !== 0 || this.lookPitch.x !== 0) this.curbHeight(cam.position, road);
    const v = this.lookV.copy(cam.position).sub(bus), len = v.length();
    if (len < 1e-3) return;
    const want = len - this.curbRoom(bus, cam.position, CURB_STEP, CURB_WIDE);
    this.curbPull = want >= this.curbPull ? want : this.curbPull + (want - this.curbPull) * (1 - Math.exp(-K.armOut * dt));
    const arm = Math.max(Math.min(K.armMin, len), len - this.curbPull * smooth01(0, 1, this.curbIn));
    if (arm < len) cam.position.copy(bus).addScaledVector(v, arm / len);
  }

  /**
   * Curb: how far out from the bus toward p the line is clear (m; all of it, the distance to p, if nothing's in the way), tried every `step` m and
   * `wide` m either side, so a corner or a bay window it grazes between two steps still counts, and at p itself last, a step can fall short of it.
   * What's hit, a face is somewhere in the step before it, so it stands a margin short.
   */
  private curbRoom(bus: THREE.Vector3, p: THREE.Vector3, step: number, wide: number): number {
    const block = this.curbBlock!, vx = p.x - bus.x, vy = p.y - bus.y, vz = p.z - bus.z, len = Math.hypot(vx, vy, vz);
    if (len < 1e-3) return len;
    const hl = Math.max(1e-3, Math.hypot(vx, vz)), wx = (-vz / hl) * wide, wz = (vx / hl) * wide;
    for (let d = step; ; d = Math.min(len, d + step)) {
      const k = d / len, x = bus.x + vx * k, y = bus.y + vy * k, z = bus.z + vz * k;
      if (block(x, z, y) || (wide > 0 && (block(x + wx, z + wz, y) || block(x - wx, z - wz, y)))) return Math.max(0, d - 2 * step);
      if (d >= len) return len;
    }
  }

  /** The finished pose, turned by the look. Nothing to do at home, so home is exactly the rig. */
  private applyLook(cam: THREE.PerspectiveCamera, bus: THREE.Vector3) {
    const yaw = this.lookYaw.x, pitch = this.lookPitch.x;
    if (yaw === 0 && pitch === 0) return;
    const q = this.lookQ, v = this.lookV.copy(cam.position).sub(bus);
    // the whole pose, about the bus: lag and all, the bus stands where it stood
    q.setFromAxisAngle(UP, -yaw);
    v.applyQuaternion(q);
    cam.quaternion.premultiply(q);
    if (pitch > 0) cam.quaternion.multiply(q.setFromAxisAngle(RIGHT, pitch));
    else if (pitch < 0) {
      // over the bus, on top of a dive's tilt, and never past looking straight down
      const axis = this.lookAxis.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const room = THREE.MathUtils.degToRad(config.camera.lookViewMax) - Math.asin(clamp(-axis.y, -1, 1));
      q.setFromAxisAngle(axis.copy(RIGHT).applyQuaternion(cam.quaternion), -Math.min(-pitch, Math.max(0, room)));
      v.applyQuaternion(q);
      cam.quaternion.premultiply(q);
    }
    cam.position.copy(bus).add(v);
  }

  /** Blast kick: a jolt of `amount` m that rings down within config.splat.kickDecay. */
  kick(amount: number) {
    this.kickA = amount;
    this.kickT = 0;
  }

  /** &boom's crack: the view jolted `rad` in pitch and roll, ringing down over about 0.45 s. The kick moves the camera, which leaves the sky where it was (it's
   *  drawn by direction alone): this turns it, so the horizon and the whole sky shake. */
  jolt(rad: number) {
    this.joltA = rad;
    this.joltT = 0;
  }

  /**
   * Applies the kick after update(), on REAL time (it keeps shaking through
   * the hit-stop freeze). Translation only, along the camera's own up/right
   * axes: the pixel pipeline snaps that to whole game pixels (the sub-pixel
   * rest goes to the upscale shift), so a kick never shimmers. No rotation.
   */
  applyKick(cam: THREE.PerspectiveCamera, realDt: number) {
    if (this.joltT < 0.45) {
      // (&boom's jolt: a turn, so it shimmers for its half second; it's the sky cracking)
      const t = this.joltT, env = this.joltA * Math.exp(-7 * t);
      this.joltT += realDt;
      cam.rotateX(env * Math.cos(2 * Math.PI * 9 * t));
      cam.rotateZ(env * 0.7 * Math.sin(2 * Math.PI * 7 * t));
    }
    const D = Math.max(0.05, config.splat.kickDecay);
    if (this.kickT > D * 1.5) return;
    const t = this.kickT;
    this.kickT += realDt;
    const env = this.kickA * Math.exp((-3 * t) / D);
    const w = (2 * Math.PI * 2.2) / D;
    this.kickUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.kickRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
    cam.position.addScaledVector(this.kickUp, -env * Math.cos(w * t)).addScaledVector(this.kickRight, env * 0.35 * Math.sin(w * 1.3 * t));
  }
}
