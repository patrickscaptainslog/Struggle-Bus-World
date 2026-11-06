import * as THREE from 'three';
import { config } from '../config';
import { makeRampMaterial } from '../render/materials';
import { registerWarm } from '../render/warmup';
import { HUE_COUNT } from '../render/palette';
import type { Particles } from './Particles';

// School Zone's paint balloons (docs/specs/shots/SHOTS.md, "School Zone: lingering"; GEARS.md). While the bus
// hovers, a balloon in the player's colours pops out of the roof hatch with a squeak, one at a time, up to
// config.zone.balloons, and the bunch bobs over the roof on its strings, lagging the bus as a real bunch would.
// Flicked out of School Zone, every one bursts into spatter (Particles.burst, in the same colours).
//
// They're paint, so they draw on the paint's own rows (Particles.palette: the faction's breath), and nothing else
// in the world is that saturated. One InstancedMesh, one draw, its material made at boot and warmed with the rest
// (registerWarm): nothing compiles in flight, and nothing here allocates once it's built.

const MAX = 8;
/** the balloon's radius (m): about 15 game pixels across at School Zone's lens */
const R = 0.95;
/** a string from the knot down (m) */
const STRING = 2.6;
/** each balloon's place in the bunch over the hatch, before its bob (m, bus space: x right, y up, z back) */
const SPOTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 4.2, 0],
  [-1.7, 3.7, 0.6],
  [1.7, 3.9, -0.5],
  [-0.8, 5.4, -1.2],
  [0.9, 5.2, 1.3],
  [-2.1, 5.0, -1.6],
  [2.2, 5.5, 1.0],
  [0, 6.6, 0.2],
];

/** One balloon's geometry: an egg, its knot and its string, the knot and the string darker (they're the balloon's own ribbon). */
function balloonGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const egg = new THREE.IcosahedronGeometry(R, 1);
  egg.scale(1, 1.18, 1);
  egg.translate(0, R * 1.18 + 0.2, 0);
  parts.push(egg);
  const knot = new THREE.ConeGeometry(0.22, 0.32, 5);
  knot.translate(0, 0.12, 0);
  parts.push(knot);
  const string = new THREE.BoxGeometry(0.1, STRING, 0.1);
  string.translate(0, -STRING / 2, 0);
  parts.push(string);
  // (one vertex layout for all three parts: unindexed, and counted after the unindexing)
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  let n = 0;
  for (const p of flat) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), lo = new Float32Array(n), glow = new Float32Array(n);
  let o = 0;
  flat.forEach((g, k) => {
    const pa = g.getAttribute('position'), na = g.getAttribute('normal');
    for (let i = 0; i < pa.count; i++, o++) {
      pos.set([pa.getX(i), pa.getY(i), pa.getZ(i)], o * 3);
      nor.set([na.getX(i), na.getY(i), na.getZ(i)], o * 3);
      // (the egg catches the light a step up: it's taut rubber; the ribbon is a step down)
      lo[o] = k === 0 ? 0.12 : -0.28;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, o * 3), 3));
  geo.setAttribute('lightOffset', new THREE.BufferAttribute(lo.subarray(0, o), 1));
  geo.setAttribute('glow', new THREE.BufferAttribute(glow.subarray(0, o), 1));
  for (const p of parts) p.dispose();
  for (const p of flat) p.dispose();
  return geo;
}

/** The bunch's mesh, exactly as the game draws it (the warm-up builds one the same way). */
function balloonMesh(): THREE.InstancedMesh {
  const geo = balloonGeometry();
  // (the ramp is the balloon's, per instance: one draw for the whole bunch)
  geo.setAttribute('ramp', new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1));
  const mat = makeRampMaterial({ vertexRamp: true, surfaceId: 0.613, shadowMul: 0.6 });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  mesh.name = 'ZoneBalloons';
  return mesh;
}

registerWarm('zone-balloons', () => {
  const m = balloonMesh();
  m.count = 1;
  m.visible = true;
  m.setMatrixAt(0, new THREE.Matrix4());
  return m;
});

const enum State {
  OFF = 0,
  /** out of the hatch, growing as it rises to its spot */
  RISING = 1,
  UP = 2,
}

/** Called for each sound: a balloon out of the hatch, or one bursting (i: its place in the bunch, for a stagger). */
export interface BalloonSounds {
  squeak(i: number): void;
  pop(i: number): void;
}

export class Balloons {
  readonly object: THREE.InstancedMesh;
  private readonly ramp: THREE.InstancedBufferAttribute;
  private readonly state = new Uint8Array(MAX);
  private readonly age = new Float32Array(MAX);
  private readonly slot = new Uint8Array(MAX);
  /** each one's place and speed (world, m and m/s): a spring after its spot, so the bunch lags the bus */
  private readonly px = new Float32Array(MAX);
  private readonly py = new Float32Array(MAX);
  private readonly pz = new Float32Array(MAX);
  private readonly vx = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  private readonly vz = new Float32Array(MAX);
  private readonly phase = new Float32Array(MAX);
  private n = 0;
  private floorY = 0;
  /** seconds hovering still, and since the last one came out */
  private still = 0;
  private since = 0;
  private nextSlot = Math.floor(Math.random() * HUE_COUNT);
  private t = 0;
  private readonly hatch = new THREE.Vector3();
  private readonly spot = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly particles: Particles,
    private readonly sounds: BalloonSounds,
  ) {
    this.object = balloonMesh();
    this.ramp = this.object.geometry.getAttribute('ramp') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < MAX; i++) this.phase[i] = i * 2.39;
  }

  /** How many are up (QA). */
  get count(): number {
    return this.n;
  }

  /**
   * Once per frame after the bus's matrix is final. `zone`: School Zone is in; `speed`: the bus's over the ground (m/s);
   * `hatchLocal`: the roof hatch in the bus's space; `bus`: its root; `floorY`: what's under the bus (m), where a burst's spatter lands.
   * Out of School Zone every balloon bursts.
   */
  update(dt: number, zone: boolean, speed: number, bus: THREE.Object3D, hatchLocal: THREE.Vector3, floorY: number): void {
    const Z = config.zone;
    this.t += dt;
    this.floorY = floorY;
    if (!zone) {
      if (this.n > 0) this.burstAll();
      this.still = this.since = 0;
      return;
    }
    bus.localToWorld(this.hatch.copy(hatchLocal));
    this.still = speed < Z.still ? this.still + dt : 0;
    this.since += dt;
    const max = Math.min(MAX, Math.max(0, Math.round(Z.balloons)));
    if (this.still > 0.6 && this.since >= Z.every && this.n < max) this.spawn();
    if (this.n === 0) return;
    const e = bus.matrixWorld.elements;
    // (the bus's own axes, out of its matrix: right, up, back)
    const rx = e[0], ry = e[1], rz = e[2], bx = e[8], bz = e[10];
    const sl = Math.hypot(rx, ry, rz) || 1;
    const w = 2 * Math.PI * 0.9;
    let k = 0;
    for (let i = 0; i < MAX; i++) {
      const st = this.state[i];
      if (st === State.OFF) continue;
      this.age[i] += dt;
      const S = SPOTS[i];
      const ph = this.phase[i];
      const bob = 0.35 * Math.sin(this.t * 1.7 + ph), sway = 0.3 * Math.sin(this.t * 1.1 + ph * 1.3);
      // (the spot is in bus space, but upright: a banking or pitching bus doesn't tip the bunch over)
      const ox = (S[0] + sway) / sl, oz = S[2] / sl;
      this.spot.set(this.hatch.x + rx * ox + bx * oz, this.hatch.y + S[1] + bob, this.hatch.z + rz * ox + bz * oz);
      // rising: up out of the hatch on its own; up: a soft spring after its spot
      const grow = st === State.RISING ? Math.min(1, this.age[i] / 0.45) : 1;
      if (st === State.RISING && grow >= 1) this.state[i] = State.UP;
      const pull = st === State.RISING ? grow * grow : 1;
      this.vx[i] += (w * w * (this.spot.x - this.px[i]) * pull - 2 * 0.55 * w * this.vx[i]) * dt;
      this.vy[i] += (w * w * (this.spot.y - this.py[i]) * pull - 2 * 0.55 * w * this.vy[i] + (st === State.RISING ? 9 * (1 - grow) : 0)) * dt;
      this.vz[i] += (w * w * (this.spot.z - this.pz[i]) * pull - 2 * 0.55 * w * this.vz[i]) * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      // the string points back at the hatch: the balloon's up is away from it
      this.dir.set(this.px[i] - this.hatch.x, this.py[i] - this.hatch.y, this.pz[i] - this.hatch.z);
      if (this.dir.lengthSq() < 1e-4) this.dir.set(0, 1, 0);
      this.dir.normalize();
      // (never more than ~50 degrees off upright: it's lighter than air)
      this.dir.y = Math.max(this.dir.y, 0.64);
      this.dir.normalize();
      this.q.setFromUnitVectors(this.up, this.dir);
      // (a pop out of the hatch: small, then a squash that overshoots)
      const sc = grow < 1 ? 0.25 + 0.75 * grow + 0.18 * Math.sin(grow * Math.PI) : 1 + 0.03 * Math.sin(this.t * 3.1 + ph);
      this.s.set(sc, sc, sc);
      this.m.compose(this.p.set(this.px[i], this.py[i], this.pz[i]), this.q, this.s);
      // (packed to the front of the instance list: count is how many draw)
      this.object.setMatrixAt(k, this.m);
      (this.ramp.array as Float32Array)[k] = this.particles.palette[this.slot[i]];
      k++;
    }
    this.object.count = k;
    this.object.visible = k > 0;
    this.object.instanceMatrix.needsUpdate = true;
    this.ramp.needsUpdate = true;
  }

  private spawn() {
    for (let i = 0; i < MAX; i++) {
      if (this.state[i] !== State.OFF) continue;
      this.state[i] = State.RISING;
      this.age[i] = 0;
      this.slot[i] = this.nextSlot;
      this.nextSlot = (this.nextSlot + 1) % HUE_COUNT;
      this.px[i] = this.hatch.x;
      this.py[i] = this.hatch.y + 0.3;
      this.pz[i] = this.hatch.z;
      this.vx[i] = this.vz[i] = 0;
      this.vy[i] = 6;
      this.n++;
      this.since = 0;
      this.sounds.squeak(i);
      return;
    }
  }

  /** Every balloon bursts into spatter in its own colour. */
  burstAll() {
    let j = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.state[i] === State.OFF) continue;
      this.state[i] = State.OFF;
      this.particles.burst(this.p.set(this.px[i], this.py[i] + R, this.pz[i]), this.slot[i], 0.55, Math.min(this.floorY, this.py[i] - 2));
      this.sounds.pop(j++);
    }
    this.n = 0;
    this.object.count = 0;
    this.object.visible = false;
  }
}
