import * as THREE from 'three';
import { config } from '../config';
import { GLSL_COMMON, GLSL_OUT, globals } from '../render/materials';
import { Ramp } from '../render/palette';
import { lookOf } from '../render/factionLook';
import { registerWarm } from '../render/warmup';
import { FACTIONS } from '../game/factions';
import type { CometPlan } from '../game/Comet';
import type { Blast } from '../game/Splat';
import type { Particles } from './Particles';

// The Comet's looks (src/game/Comet.ts; docs/specs/shots/SHOTS.md, "The modes": "A 200 m pillar of paint light rises there, and you fly through the
// spray"). Four parts, each in the faction's own paint rows, so paint stays the only saturated thing:
// - the streak: a white-hot head and a tail of motes along each frame's stretch of the arc (Particles.comet, as the homing shot's), each faction's
//   tail its own shape: Rainbow six bands, Atlantis a foam helix, the Elderwood shed leaves, Hyperglow a neon zigzag, Inferno embers;
// - the pillar: config.comet.pillar m of paint light at the landing, up in config.comet.rise s and dithered away over config.comet.fade, with a crown of
//   spray at its top: Rainbow's a hexagonal prism of six bands under a crown of stars, Atlantis's a foam helix that opens into a sea geyser raining back,
//   the Elderwood's a vine spiralling up into blossom, Hyperglow's a zigzag bolt re-rolled 20 times a second, Inferno's a flame column flecked with obsidian;
// - drops on the lens: the bus flying within config.comet.lensReach of its axis, under its top, gets 8 to 14 drops of it on the glass, which run and fade;
// - the late boom: when its sound would reach the bus (CometSounds.boom), with the camera's kick then.
// The full show plays on the first Comet in config.comet.showEvery s, and while Streak's seam says a streak is on; the rest get the lighter one: a
// config.comet.pillarLight m pillar for config.comet.fadeLight s (you fly over it), half the motes, no drops, a softer boom.
//
// The pillars are one InstancedMesh and the drops another, both made at boot and warmed (registerWarm). A pillar's faction, hue and shape are numbers
// per instance into constant tables in its one program, with no define, uniform or texture per faction: nothing compiles in flight, whoever paints.
// The streak and the crown are the particles' own program. Two draws at most while they show; nothing here allocates per frame once it's built.

const MAX_PILLARS = 4;
const MAX_COMETS = 4;
const MAX_DROPS = 16;
const SEG = 16;
const RINGS = 18;
/** each faction's spray rows in its one table: FACTIONS' order, six each */
const SLOTS = FACTIONS.map((f) => lookOf(f.id).spray);
const RAMP_TABLE = SLOTS.flatMap((s) => s.slice(0, 6)).map((r) => r.toFixed(1)).join(', ');
const slotOf = (faction: number) => Math.max(0, FACTIONS.findIndex((f) => f.id === faction));

/** shared by every pillar and drop (not per faction): its timings, and how far in front of the lens the drops sit */
const cometUniforms = {
  uComet: { value: new THREE.Vector4(config.comet.rise, config.comet.fade, config.comet.fadeLight, config.comet.dropLife) },
  uDropAspect: { value: 393 / 852 },
};

const PILLAR_VS = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uComet;
in vec4 pA;
in vec4 pB;
out float vH;
out float vA;
out float vAge;
flat out vec4 vB;
out vec3 vWorldPos;
out vec3 vViewNormal;
float hash(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
void main() {
  float age = uTime - pA.x;
  float H = pA.y, R = pA.z;
  float k = clamp(age / max(0.01, uComet.x), 0.0, 1.0);
  float rise = 1.0 - (1.0 - k) * (1.0 - k);
  float h = position.y;
  float a = atan(position.z, position.x);
  int sh = int(pB.x + 0.5);
  float r = R * (1.0 - 0.5 * h);
  vec2 c = vec2(0.0);
  if (sh == 0) {
    // Rainbow: a hexagonal prism, turning a sixth of a turn up its height
    float m = mod(a + h * 1.0472, 1.0472) - 0.5236;
    r *= 0.866 / cos(m);
  } else if (sh == 1) {
    // Atlantis: a foam helix whose top opens out like a sea geyser
    c = vec2(cos(h * 11.0 + uTime * 5.0), sin(h * 11.0 + uTime * 5.0)) * R * 0.4 * h;
    r *= 0.8 + 1.3 * smoothstep(0.72, 1.0, h);
  } else if (sh == 2) {
    // the Elderwood: a vine spiralling up into blossom
    c = vec2(cos(h * 9.0 + pB.w * 6.2832), sin(h * 9.0 + pB.w * 6.2832)) * R * 0.7;
    r *= 0.45 + 1.9 * smoothstep(0.8, 1.0, h);
  } else if (sh == 3) {
    // Hyperglow: a zigzag bolt, re-rolled 20 times a second
    float roll = floor(uTime * 20.0) * 7.31 + pB.w * 97.0;
    float s = h * 7.0, i = floor(s);
    vec2 p0 = vec2(hash(i + roll), hash(i + roll + 3.7)) - 0.5, p1 = vec2(hash(i + 1.0 + roll), hash(i + 4.7 + roll)) - 0.5;
    c = mix(p0, p1, s - i) * R * 2.2 * min(1.0, h * 4.0);
    r *= 0.42;
  } else {
    // Inferno: a flame column, licking and narrowing up its height
    r *= (1.0 + 0.4 * sin(h * 19.0 - uTime * 13.0 + a * 3.0) * (1.0 - h)) * (1.0 - 0.35 * h);
  }
  vec3 p = vec3(c.x + cos(a) * r, h * H * rise, c.y + sin(a) * r);
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vViewNormal = normalize(mat3(viewMatrix) * vec3(cos(a), 0.0, sin(a)));
  vH = h * rise;
  vA = a;
  vAge = age;
  vB = pB;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PILLAR_FS = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uComet;
in float vH;
in float vA;
in float vAge;
flat in vec4 vB;
in vec3 vWorldPos;
in vec3 vViewNormal;
${GLSL_OUT}
const float RAMPS[${SLOTS.length * 6}] = float[${SLOTS.length * 6}](${RAMP_TABLE});
float bayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float b = mod(q.x, 2.0) * 2.0 + mod(q.y, 2.0) + 4.0 * (mod(floor(q.x / 2.0), 2.0) * 2.0 + mod(floor(q.y / 2.0), 2.0));
  return (b + 0.5) / 16.0;
}
void main() {
  float life = vB.z > 0.5 ? uComet.z : uComet.y;
  float k = clamp(vAge / max(0.01, life), 0.0, 1.0);
  // (light, not a wall: a stipple that thins up the column and over its life)
  float keep = (1.0 - k * k) * (0.85 - 0.45 * vH);
  if (bayer(gl_FragCoord.xy) > keep) discard;
  int f = int(vB.x + 0.5), hue = int(vB.y + 0.5);
  float t = vA / 6.2832 + 0.5;
  int i;
  if (f == 0) i = hue + int(floor(vH * 6.0));
  else if (f == 1) i = int(mod(floor(vH * 9.0 + t * 3.0 - uTime * 2.0), 3.0)) + 1;
  else if (f == 2) i = vH > 0.82 ? 3 + int(mod(floor(t * 5.0), 2.0)) * 2 : int(mod(floor(vH * 7.0 + t * 2.0), 2.0));
  else if (f == 3) i = int(mod(floor(vH * 14.0 + uTime * 20.0), 2.0));
  else i = fract(sin(dot(floor(vec2(vH * 30.0, t * 12.0)), vec2(12.9898, 78.233))) * 43758.5453) > 0.86 ? 3 : int(mod(floor(vH * 5.0 - uTime * 3.0), 2.0)) * 1;
  i = int(mod(float(i), 6.0));
  float ramp = RAMPS[f * 6 + i];
  // (its paint's own colour, lit from within: high on its ramp, not its white end, which every faction's ramp shares)
  sbWrite(ramp, 0.72, sbFog(vWorldPos) * 0.6, 1.0, vViewNormal, 0.617, 0.5);
}
`;

// (on the glass: placed in clip space, so the pixel grid's snap of the lens never moves them; a drop runs down as it fades)
const DROP_VS = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uComet;
uniform float uDropAspect;
in vec4 dA;
in vec2 dB;
out float vAge;
flat out float vRamp;
void main() {
  float age = uTime - dA.w;
  vec2 c = vec2(dA.x, dA.y - age * age * 1.4);
  vec2 q = position.xy * dA.z * vec2(1.0 / max(0.1, uDropAspect), 1.0 + 1.5 * min(age * 4.0, 1.0));
  vAge = age;
  vRamp = dB.x;
  gl_Position = vec4(c + q, -0.999, 1.0);
}
`;

const DROP_FS = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uComet;
in float vAge;
flat in float vRamp;
${GLSL_OUT}
float bayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float b = mod(q.x, 2.0) * 2.0 + mod(q.y, 2.0) + 4.0 * (mod(floor(q.x / 2.0), 2.0) * 2.0 + mod(floor(q.y / 2.0), 2.0));
  return (b + 0.5) / 16.0;
}
void main() {
  float k = clamp(vAge / max(0.01, uComet.w), 0.0, 1.0);
  if (bayer(gl_FragCoord.xy) > 1.0 - k * k) discard;
  sbWrite(vRamp, 0.9, 0.0, 0.7, vec3(0.0, 0.0, 1.0), 0.619, 0.5);
}
`;

function shaderMat(vs: string, fs: string): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { ...globals, ...cometUniforms }, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide });
  return m;
}

/** The pillars' mesh, exactly as the game draws it (the warm-up builds one the same way). */
function pillarMesh(): THREE.InstancedMesh {
  const n = SEG * (RINGS + 1);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  for (let j = 0; j <= RINGS; j++)
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2, o = (j * SEG + i) * 3;
      pos[o] = Math.cos(a);
      pos[o + 1] = j / RINGS;
      pos[o + 2] = Math.sin(a);
      nor[o] = Math.cos(a);
      nor[o + 2] = Math.sin(a);
    }
  const idx: number[] = [];
  for (let j = 0; j < RINGS; j++)
    for (let i = 0; i < SEG; i++) {
      const a = j * SEG + i, b = j * SEG + ((i + 1) % SEG), c = a + SEG, d = b + SEG;
      idx.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(idx);
  geo.setAttribute('pA', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PILLARS * 4), 4));
  geo.setAttribute('pB', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PILLARS * 4), 4));
  const mesh = new THREE.InstancedMesh(geo, shaderMat(PILLAR_VS, PILLAR_FS), MAX_PILLARS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  mesh.name = 'CometPillars';
  return mesh;
}

/** The drops' mesh: a small disc each, on the lens. */
function dropMesh(): THREE.InstancedMesh {
  const geo = new THREE.CircleGeometry(1, 8);
  geo.setAttribute('dA', new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 4), 4));
  geo.setAttribute('dB', new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 2), 2));
  const mesh = new THREE.InstancedMesh(geo, shaderMat(DROP_VS, DROP_FS), MAX_DROPS);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  mesh.name = 'CometDrops';
  return mesh;
}

registerWarm('comet', () => {
  const p = pillarMesh(), d = dropMesh();
  for (const m of [p, d]) {
    m.count = 1;
    m.visible = true;
    m.setMatrixAt(0, new THREE.Matrix4());
  }
  return [p, d];
});

/** The sounds and the kick (main.ts): the launch's whoosh; the boom where it reaches the bus (soft: the lighter show's; moon: no air, a ground thump). */
export interface CometSounds {
  launch(k: number): void;
  boom(k: number, soft: boolean, moon: boolean): void;
  kick(m: number): void;
}

interface Live {
  on: boolean;
  t0: number;
  t1: number;
  /** the arc: from (filled at launch, the mouth then), to, and its top over the chord */
  from: THREE.Vector3;
  to: THREE.Vector3;
  arc: number;
  launched: boolean;
  u: number;
  faction: number;
  hue: number;
  full: boolean;
}

export class CometFx {
  readonly pillars = pillarMesh();
  readonly drops = dropMesh();
  /** Streak's seam (not built): a streak is on, so every Comet plays the full show. */
  streakOn: (() => boolean) | null = null;
  /** ?moon: no air, so the boom is a ground thump */
  moon = false;
  /** QA */
  readonly stats = { fired: 0, full: 0, booms: 0, drops: 0, pillars: 0, motes: 0, lastBoomAt: -1, lastImpactAt: -1 };
  private readonly live: Live[] = [];
  private readonly pA: THREE.InstancedBufferAttribute;
  private readonly pB: THREE.InstancedBufferAttribute;
  private readonly dA: THREE.InstancedBufferAttribute;
  private readonly dB: THREE.InstancedBufferAttribute;
  /** a pillar's foot (m), its time, its show, whether its drops have fallen */
  private readonly base = Array.from({ length: MAX_PILLARS }, () => ({ x: 0, y: 0, z: 0, t: -1e9, h: 0, life: 0, full: false, dropped: false, faction: 0, hue: 0 }));
  private nextPillar = 0;
  private nextDrop = 0;
  private lastFull = -1e9;
  private booms: Array<{ at: number; k: number; soft: boolean }> = [];
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(
    private readonly particles: Particles,
    private readonly sounds: CometSounds,
    private readonly mouth: () => THREE.Vector3,
  ) {
    this.pA = this.pillars.geometry.getAttribute('pA') as THREE.InstancedBufferAttribute;
    this.pB = this.pillars.geometry.getAttribute('pB') as THREE.InstancedBufferAttribute;
    this.dA = this.drops.geometry.getAttribute('dA') as THREE.InstancedBufferAttribute;
    this.dB = this.drops.geometry.getAttribute('dB') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < MAX_COMETS; i++) this.live.push({ on: false, t0: 0, t1: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), arc: 0, launched: false, u: 0, faction: 0, hue: 0, full: false });
  }

  /** The full show for this one: the first in config.comet.showEvery s, or a streak on. */
  private show(now: number): boolean {
    return now - this.lastFull >= config.comet.showEvery || !!this.streakOn?.();
  }

  /** A Comet leaves the mouth at t0 (after the inhale) and lands at t1 (the blast's impact time), on its plan's arc. */
  launch(p: CometPlan, t0: number, t1: number, faction: number, hue: number, now: number): void {
    const l = this.live.find((c) => !c.on) ?? this.live[0];
    l.on = true;
    l.t0 = t0;
    l.t1 = Math.max(t0 + 0.05, t1);
    l.to.set(p.x, p.y, p.z);
    l.from.set(p.x0, p.y0, p.z0);
    l.arc = p.arc;
    l.launched = false;
    l.u = 0;
    l.faction = faction;
    l.hue = hue;
    l.full = this.show(now);
    if (l.full) {
      this.lastFull = now;
      this.stats.full++;
    }
    this.stats.fired++;
  }

  /** Its blast lands: the pillar and its crown, and the boom set for when its sound reaches the bus. */
  impact(b: Blast, now: number, bus: THREE.Vector3, busVel: THREE.Vector3, ground: number): void {
    const C = config.comet;
    let l: Live | null = null;
    for (const c of this.live) if (c.on && c.to.distanceToSquared(b.pos) < 400 * 400 && (!l || c.to.distanceToSquared(b.pos) < l.to.distanceToSquared(b.pos))) l = c;
    const full = l ? l.full : this.show(now);
    if (l) l.on = false;
    const faction = b.spec.faction ?? FACTIONS[0].id, hue = b.spec.hue;
    this.stats.lastImpactAt = now;
    // the pillar, from where it landed: the roof, the wall's face, the street
    const i = this.nextPillar;
    this.nextPillar = (i + 1) % MAX_PILLARS;
    const P = this.base[i];
    P.x = b.pos.x;
    P.y = b.pos.y;
    P.z = b.pos.z;
    P.t = now;
    P.h = full ? C.pillar : C.pillarLight;
    P.life = full ? C.fade : C.fadeLight;
    P.full = full;
    P.dropped = !full;
    P.faction = slotOf(faction);
    P.hue = hue;
    this.stats.pillars++;
    // the crown of spray at its top: what each faction's pillar ends in
    const n = Math.round(C.crown * (full ? 1 : 0.5));
    const pal = this.particles.palette;
    this.p.set(P.x, P.y + P.h, P.z);
    this.particles.burst(this.p, hue, full ? 1.6 : 0.9, ground);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, e = Math.random();
      const f = P.faction;
      // (Rainbow stars, Atlantis's rain falling back, the Elderwood's petals, Hyperglow's sparks, Inferno's embers rising)
      const sp = f === 1 ? 26 : f === 4 ? 10 : 18;
      const vy = f === 1 ? 8 + 18 * e : f === 4 ? 14 + 20 * e : f === 2 ? -2 + 6 * e : 4 + 10 * e;
      this.particles.comet(this.p, Math.cos(a) * sp * (0.4 + e), vy, Math.sin(a) * sp * (0.4 + e), k % 5 === 0 ? Ramp.GLOW_WHITE : pal[(hue + k) % 6], f === 0 && k % 3 === 0 ? 3.2 : 2.2, 0.8 + 1.4 * Math.random());
    }
    this.stats.motes += n;
    // the boom: when its sound would reach the bus, the bus flying into it
    const d = this.q.copy(b.pos).sub(bus);
    const dist = d.length(), into = dist > 1 ? Math.max(0, busVel.dot(d) / dist) : 0;
    this.booms.push({ at: now + dist / Math.max(50, C.sound + into), k: Math.min(1.6, b.strength), soft: !full });
  }

  /** ?moon: the map slid by (dx, dz). */
  slide(dx: number, dz: number): void {
    for (const c of this.live) {
      c.from.x -= dx;
      c.from.z -= dz;
      c.to.x -= dx;
      c.to.z -= dz;
    }
    for (const P of this.base) {
      P.x -= dx;
      P.z -= dz;
    }
  }

  /** Once per frame, after the camera is final: the streaks, the pillars, the drops, the booms. */
  update(dt: number, now: number, bus: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
    const C = config.comet;
    for (const c of this.live) if (c.on) this.streak(c, now, dt);
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      if (now < b.at) continue;
      this.booms.splice(i, 1);
      this.sounds.boom(b.k, b.soft, this.moon);
      this.sounds.kick((b.soft ? C.kickLight : C.kick) * Math.sqrt(b.k));
      this.stats.booms++;
      this.stats.lastBoomAt = now;
    }
    // the pillars: one instance each while it shows
    let k = 0;
    const A = this.pA.array as Float32Array, B = this.pB.array as Float32Array;
    for (const P of this.base) {
      const age = now - P.t;
      if (age < 0 || age > P.life) continue;
      this.m.makeTranslation(P.x, P.y, P.z);
      this.pillars.setMatrixAt(k, this.m);
      A[k * 4] = P.t;
      A[k * 4 + 1] = P.h;
      A[k * 4 + 2] = C.pillarRadius * (P.full ? 1 : 0.75);
      A[k * 4 + 3] = P.life;
      B[k * 4] = P.faction;
      B[k * 4 + 1] = P.hue;
      B[k * 4 + 2] = P.full ? 0 : 1;
      B[k * 4 + 3] = (P.t * 0.37) % 1;
      k++;
      // the bus through it, under its top: drops on the lens
      if (!P.dropped && Math.hypot(bus.x - P.x, bus.z - P.z) < C.lensReach && bus.y < P.y + P.h * Math.min(1, age / Math.max(0.01, C.rise)) + 10) {
        P.dropped = true;
        this.splatLens(now, P.faction, P.hue);
      }
    }
    this.pillars.count = k;
    this.pillars.visible = k > 0;
    if (k > 0) {
      this.pillars.instanceMatrix.needsUpdate = true;
      this.pA.needsUpdate = true;
      this.pB.needsUpdate = true;
    }
    // the drops on the lens
    let live = 0;
    const D = this.dA.array as Float32Array;
    for (let i = 0; i < MAX_DROPS; i++) if (now - D[i * 4 + 3] < C.dropLife) live++;
    this.drops.visible = live > 0;
    this.drops.count = live > 0 ? MAX_DROPS : 0;
    cometUniforms.uDropAspect.value = camera.aspect;
  }

  /** The streak: the head on the arc, and its tail along this frame's stretch of it. */
  private streak(c: Live, now: number, dt: number) {
    if (now < c.t0) return;
    if (!c.launched) {
      // (from the mouth as it is now: the inhale is over)
      c.from.copy(this.mouth());
      c.launched = true;
      this.sounds.launch(c.full ? 1 : 0.6);
    }
    const u1 = Math.min(1, (now - c.t0) / (c.t1 - c.t0)), u0 = c.u;
    c.u = u1;
    if (u1 >= 1) c.on = now < c.t1 + 0.1;
    const pal = this.particles.palette;
    const C = config.comet;
    const n = Math.max(2, Math.round(((C.motes * (c.full ? 1 : 0.5)) * Math.max(dt, 1 / 60)) / Math.max(0.05, c.t1 - c.t0)));
    this.at(c, u1, this.p);
    this.particles.comet(this.p, 0, 0, 0, Ramp.GLOW_WHITE, 9, 0.07);
    // the way it flies, and a side to it (for the tails' shapes)
    this.at(c, Math.max(0, u1 - 0.02), this.q);
    this.up.copy(this.p).sub(this.q).normalize();
    this.side.set(-this.up.z, 0, this.up.x);
    if (this.side.lengthSq() < 1e-8) this.side.set(1, 0, 0);
    this.side.normalize();
    const f = slotOf(c.faction);
    for (let i = 0; i < n; i++) {
      const u = u0 + ((u1 - u0) * (i + Math.random())) / n;
      this.at(c, u, this.q);
      let ox = 0, oy = 0, vy = 0, ramp = pal[(c.hue + i) % 6], size = 3.4, life = 0.35 + 0.3 * Math.random();
      const w = u * 40;
      if (f === 0) ox = ((i % 6) - 2.5) * 1.6, ramp = pal[i % 6];
      else if (f === 1) (ox = Math.cos(w * 2 + now * 9) * 3.5), (oy = Math.sin(w * 2 + now * 9) * 3.5);
      else if (f === 2) (ox = (Math.random() - 0.5) * 6), (vy = -6 - 6 * Math.random()), (life += 0.4);
      else if (f === 3) (ox = (Math.abs(((w * 0.8) % 2) - 1) * 2 - 1) * 5), (size = 2.8);
      else (ox = (Math.random() - 0.5) * 4), (oy = (Math.random() - 0.5) * 4), (vy = 6 + 10 * Math.random());
      this.q.addScaledVector(this.side, ox);
      this.q.y += oy;
      this.particles.comet(this.q, (Math.random() - 0.5) * 3, vy + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, i < 2 ? Ramp.GLOW_WHITE : ramp, i === 0 ? 6.5 : size, life);
    }
    this.stats.motes += n + 1;
  }

  /** The arc at u (0 the mouth, 1 the landing). */
  private at(c: Live, u: number, out: THREE.Vector3): THREE.Vector3 {
    return out.lerpVectors(c.from, c.to, u).setY(c.from.y + (c.to.y - c.from.y) * u + c.arc * 4 * u * (1 - u));
  }

  /** 8 to 14 drops of the pillar's paint on the glass. */
  private splatLens(now: number, faction: number, hue: number) {
    const C = config.comet;
    const n = C.dropsMin + Math.floor(Math.random() * (C.dropsMax - C.dropsMin + 1));
    const A = this.dA.array as Float32Array, B = this.dB.array as Float32Array;
    const spray = lookOf(FACTIONS[faction]?.id ?? FACTIONS[0].id).spray;
    for (let k = 0; k < n; k++) {
      const i = this.nextDrop;
      this.nextDrop = (i + 1) % MAX_DROPS;
      // (in clip space: x across, y up; a drop 10 to 26 game px across, its radius a share of the half height)
      const px = 10 + Math.random() * 16;
      A.set([Math.random() * 1.8 - 0.9, Math.random() * 1.5 - 0.5, px / 852, now - Math.random() * 0.06], i * 4);
      B.set([spray[(hue + k) % 6], Math.random()], i * 2);
    }
    this.dA.needsUpdate = true;
    this.dB.needsUpdate = true;
    this.stats.drops += n;
  }
}
