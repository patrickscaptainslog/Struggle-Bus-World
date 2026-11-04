import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { Ramp } from '../render/palette';

// The bus's speed lines and contrail in open space (fx/Turbo.ts's, cut down). Those are laid in metres in a world the bus really crosses: a streak's length is speed x blur, the trail is samples of where the
// bus has been, and at 6,000 km/s a streak would be 420 km long and a sample 100 km apart. Here the bus never leaves the render origin, so both live round it:
//
//  - the lines are a lattice that stands still among the stars, turned with them, scrolled by a phase wrapped to 0..1, at a speed that is the true one on a log scale and capped, so that a streak is always
//    longer than a frame's travel. They are a feeling, not a measurement, and nothing in them can run out of precision or strobe at any speed.
//  - the trail is one ribbon from the bus's tail, back along the nose, with its clumps rushing away. It's alive, or a frame of it reads as a game that's stalled (the producer: "it is too static, like its frozen"): it
//    wavers in a wave that runs back along it, swells in puffs that run back too, its rainbow twists along it and turns, and it sparkles.
//
// Both stand round the bus at the size they have over the city: the bus is the size it is over the city, wherever it's flying.
//
// Both write the G-buffer as surfaces, so they cover Earth and the Moon. Fog 0: there's no air. Added to the scene before the warm-up, so their programs never compile in flight.

const LINES = 90;
const TRAIL_SEGMENTS = 64;

const GLSL_BAYER = /* glsl */ `
float sfBayer4(ivec2 p) {
  const float M[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (M[(p.y & 3) * 4 + (p.x & 3)] + 0.5) / 16.0;
}
float sfHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float sfNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, 256.0), x1 = mod(i.x + 1.0, 256.0);
  return mix(mix(sfHash(vec2(x0, i.y)), sfHash(vec2(x1, i.y)), f.x), mix(sfHash(vec2(x0, i.y + 1.0)), sfHash(vec2(x1, i.y + 1.0)), f.x), f.y);
}
`;

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Tuner rows ("Moon run"). */
export const spaceFxTune = {
  /** A speed line: game px wide, the game's own, and how long, in seconds of the speed they seem to go. */
  linePx: 1.7,
  lineLong: 0.045,
  /** The trail's waver at its end (m), how fast its clumps go by, how much its puffs swell it, and how often it sparkles. */
  trailWave: 9,
  trailFlow: 3,
  trailPuff: 0.55,
  trailSparkle: 0.14,
};

export class SpaceFx {
  readonly object = new THREE.Group();
  private readonly lines: THREE.Mesh;
  private readonly trail: THREE.Mesh;
  private readonly lineU = {
    uToRender: { value: new THREE.Matrix3() },
    uPhase: { value: new THREE.Vector3() },
    uCenter: { value: new THREE.Vector3() },
    uDir: { value: new THREE.Vector3(0, 0, -1) },
    uLine: { value: new THREE.Vector4(190, 100, 0.003, 0) }, // box, streak (m), width (m per m of distance), how many
  };
  private readonly trailU = {
    uTail: { value: new THREE.Vector3() },
    uBack: { value: new THREE.Vector3(0, 0, 1) },
    uTrail: { value: new THREE.Vector4(260, 3.2, 10, 0) }, // length, width at the bus and at the end (m), on
    uScroll: { value: 0 },
    uLife: { value: new THREE.Vector4(9, 0.55, 0.14, 0) }, // waver (m), puff, sparkle share, the clock it all runs on (s)
  };
  private readonly tailLocal: THREE.Vector3;
  private readonly tmp = new THREE.Vector3();
  private readonly phase = new Float64Array(3);
  private scroll = 0;
  private life = 0;
  /** The bus is free over Earth (MoonTrip's 'wait'): the lines and the trail are the street's, at its speeds. */
  overEarth = false;
  private earthK = 0;

  /** The flight takes the bus from the street (?earth): the street's lines and trail, at once, as the street had them. */
  fromStreet(): void {
    this.overEarth = true;
    this.earthK = 1;
  }

  /** busLength: BusModel.length */
  constructor(busLength: number) {
    this.tailLocal = new THREE.Vector3(0, 0.9, busLength * 0.5 + 0.4);

    const lg = new THREE.InstancedBufferGeometry();
    lg.setAttribute('aQuad', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    lg.setIndex([0, 2, 1, 1, 2, 3]);
    const seeds = new Float32Array(LINES * 4);
    let s = 12345;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < LINES; i++) {
      seeds[i * 4] = rnd();
      seeds[i * 4 + 1] = rnd();
      seeds[i * 4 + 2] = rnd();
      seeds[i * 4 + 3] = (i + 0.5) / LINES; // lines appear in order as the count rises
    }
    lg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    lg.instanceCount = LINES;
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.lines = new THREE.Mesh(
      lg,
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { ...globals, ...this.lineU },
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          ${GLSL_COMMON}
          uniform mat3 uToRender;
          uniform vec3 uPhase;
          uniform vec3 uCenter;
          uniform vec3 uDir;
          uniform vec4 uLine;
          in vec2 aQuad;
          in vec4 aSeed;
          out float vFade;
          out float vAlong;
          flat out float vRamp;
          void main() {
            vec3 w0 = (fract(aSeed.xyz - uPhase) - 0.5) * uLine.x;
            vec3 w = uCenter + uToRender * w0;
            vec3 p = w - uDir * uLine.y * aQuad.x;
            vec3 toCam = cameraPosition - p;
            float dist = length(toCam);
            vec3 sd = cross(uDir, toCam / max(dist, 1e-3));
            float sl = length(sd);
            sd = sl > 1e-4 ? sd / sl : vec3(0.0, 1.0, 0.0);
            p += sd * aQuad.y * uLine.z * dist * 0.5;
            float r = length(w0) / (0.5 * uLine.x);
            vFade = (1.0 - smoothstep(0.55, 0.95, r)) * smoothstep(30.0, 70.0, length(w - cameraPosition));
            vFade *= step(aSeed.w, uLine.w);
            // one streak in five carries a hue
            float pick = floor(aSeed.w * ${LINES}.0 + 0.5);
            vRamp = mod(pick, 5.0) < 0.5 ? ${Ramp.RED}.0 + mod(pick / 5.0, 6.0) : ${Ramp.GLOW_WHITE}.0;
            vAlong = aQuad.x;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
            if (vFade <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          ${GLSL_COMMON}
          ${GLSL_OUT}
          in float vFade;
          in float vAlong;
          flat in float vRamp;
          void main() {
            // solid pixels: a fading streak gets shorter, it never turns into dots
            if (vAlong > vFade) discard;
            float white = step(${Ramp.GLOW_WHITE}.0 - 0.5, vRamp);
            float light = mix(0.56, 0.62, white) + (vAlong < 0.4 ? 0.1 : 0.0);
            sbWrite(vRamp, light, 0.0, 0.0, vec3(0.0, 0.0, 1.0), 0.73, 0.5);
          }
        `,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.object.add(this.lines);

    // the ribbon: along 0..1, side -1..1, everything else in the vertex shader
    const n = TRAIL_SEGMENTS + 1;
    const at = new Float32Array(n * 4), idx = new Uint16Array(TRAIL_SEGMENTS * 6);
    for (let i = 0; i < n; i++) {
      const u = i / TRAIL_SEGMENTS;
      at.set([u, -1, u, 1], i * 4);
      if (i < TRAIL_SEGMENTS) idx.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2], i * 6);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    tg.setAttribute('aRibbon', new THREE.BufferAttribute(at, 2));
    tg.setIndex(new THREE.BufferAttribute(idx, 1));
    tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.trail = new THREE.Mesh(
      tg,
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { ...globals, ...this.trailU },
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          ${GLSL_COMMON}
          uniform vec3 uTail;
          uniform vec3 uBack;
          uniform vec4 uTrail;
          uniform vec4 uLife;
          in vec2 aRibbon;
          out float vU;
          out float vSide;
          out vec3 vP;
          void main() {
            float u = aRibbon.x, t = uLife.w;
            vec3 c = uTail + uBack * u * uTrail.x;
            // (a waver that runs back along it, two ways at once, and none of it at the bus)
            vec3 a1 = normalize(cross(uBack, abs(uBack.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), a2 = cross(uBack, a1);
            float ph = u * 9.0 - t * 4.7, w = uLife.x * pow(u, 1.3);
            c += (a1 * (sin(ph) + 0.35 * sin(ph * 2.3 + 1.1)) + a2 * 0.6 * cos(ph * 0.71 + 1.7)) * w;
            vec3 sd = cross(uBack, normalize(cameraPosition - c));
            float sl = length(sd);
            sd = sl > 1e-4 ? sd / sl : vec3(0.0, 1.0, 0.0);
            // (and puffs that swell it as they go back along it)
            float puff = 1.0 + uLife.y * pow(max(0.0, sin(u * 6.5 - t * 5.3)), 6.0) * smoothstep(0.05, 0.3, u);
            vec3 p = c + sd * aRibbon.y * mix(uTrail.y, uTrail.z, sqrt(u)) * 0.5 * puff;
            vU = u;
            vSide = aRibbon.y;
            vP = p;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          ${GLSL_COMMON}
          ${GLSL_OUT}
          ${GLSL_BAYER}
          uniform vec4 uTrail;
          uniform float uScroll;
          uniform vec4 uLife;
          in float vU;
          in float vSide;
          in vec3 vP;
          void main() {
            float along = vU * uTrail.x / 9.0 - uScroll;
            float set = smoothstep(0.04, 0.4, vU);
            float reach = mix(1.0, 0.62 + 0.38 * sfNoise(vec2(along, vSide < 0.0 ? 3.0 : 11.0)), set);
            float side = vSide / reach;
            float edge = abs(side);
            if (edge > 1.0) discard;
            float clump = 0.66 * sfNoise(vec2(along * 0.9, side * 1.3 + 5.0)) + 0.34 * sfNoise(vec2(along * 2.3, side * 3.1 + 9.0));
            float near = smoothstep(55.0, 175.0, length(vP - cameraPosition));
            float keep = ((1.0 - vU) * 1.55 - edge * edge * 0.3) * near * uTrail.w;
            if (clump + (sfBayer4(ivec2(gl_FragCoord.xy)) - 0.5) * 0.1 > keep) discard;
            // (the rainbow twists along it, and turns as it goes)
            float band = mod(floor(clamp(side * 0.5 + 0.5, 0.0, 0.9999) * 6.0) + floor(along * 0.3 + uLife.w * 1.6), 6.0);
            float fresh = 1.0 - vU;
            // (and it sparkles: a glint here and there, coming and going)
            bool glint = vU > 0.06 && sfNoise(vec2(along * 3.1 + 17.0, side * 2.3 + uLife.w * 2.1)) > 1.0 - uLife.z;
            sbWrite(${Ramp.RED}.0 + band, glint ? 0.97 : 0.52 + 0.16 * fresh + 0.1 * (1.0 - edge), 0.0, (glint ? 1.0 : 0.55 * fresh) * uTrail.w, vec3(0.0, 0.0, 1.0), 0.61, 0.5);
          }
        `,
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.trail.renderOrder = 1;
    this.object.add(this.trail);
  }

  /**
   * One frame, once the bus's pose is final. v: km/s. dir: the path in EQJ, unit. axes: the render axes in EQJ, by rows. flying and nosing: the path and the nose in the render frame.
   * pixel: metres a game pixel at 1 m. origin: where the bus is, if not at the render origin.
   */
  update(dt: number, v: number, dir: Float64Array, axes: Float64Array, flying: THREE.Vector3, nosing: THREE.Vector3, camera: THREE.Camera, bus: THREE.Object3D, pixel: number, origin: THREE.Vector3 | null = null): void {
    // (over Earth, free, they're the street's, at the street's speeds: fx/Turbo.ts's strength, by speedK's scale, 0 at the surge and 1 at Jet, and on up the gears. The producer, 2026-11-04,
    // of the lull past the hand-over: "Why can't we just keep the normal controls/turbos?". Eased, so the way out of Earth's sky, at TO THE MOON?, goes over to space's as the speed goes up)
    this.earthK += ((this.overEarth ? 1 : 0) - this.earthK) * (1 - Math.exp(-2 * dt));
    if (this.earthK < 0.001) this.earthK = 0;
    const e = this.earthK, F = config.flight, ms = v * 1000;
    const k = Math.max(0, Math.log(Math.max(ms, F.surgeSpeed) / F.surgeSpeed) / Math.log(Math.max(F.surgeSpeed * 1.01, config.turbo.jetSpeed) / F.surgeSpeed));
    const street = Math.min(1, Math.max(0, (ms - F.surgeSpeed * 0.9) / 140)) * Math.min(1, k + 0.25);
    const on = Math.max(smooth01(5, 300, v) * 0.35 + 0.3 * smooth01(300, 3000, v), e * Math.min(1, 0.65 * street + 0.35 * smooth01(1.5, 4, k)));
    this.lines.visible = on > 0.01;
    if (this.lines.visible) {
      const U = this.lineU, box = 190;
      // the speed they seem to go: the true one's log, under a third of a box a frame at 30 fps, and a streak is longer than that, so they flow and can't strobe
      // (over Earth the true speed, up to a third of a box a frame at 30 fps: the street's lines go by at the bus's speed)
      const sp = (1 - e) * (1000 + 450 * Math.log10(Math.max(v, 1) / 300)) + e * Math.min(1800, ms);
      const p = this.phase;
      for (let i = 0; i < 3; i++) {
        p[i] += (dir[i] * sp * dt) / box;
        p[i] -= Math.floor(p[i]);
      }
      U.uPhase.value.set(p[0], p[1], p[2]);
      U.uToRender.value.set(axes[0], axes[1], axes[2], axes[3], axes[4], axes[5], axes[6], axes[7], axes[8]);
      U.uDir.value.copy(flying);
      // (over Earth as long as the street's, its blur: fx/Turbo.ts's lineBlur)
      U.uLine.value.set(box, sp * (spaceFxTune.lineLong + e * (0.07 - spaceFxTune.lineLong)), pixel * spaceFxTune.linePx, on);
      U.uCenter.value.copy(camera.position);
      // (the bus at the render origin, or, in the world's frame on the way down, wherever it is)
      if (origin) U.uCenter.value.sub(origin);
      U.uCenter.value.multiplyScalar(0.45).addScaledVector(flying, sp * 0.08);
      if (origin) U.uCenter.value.add(origin);
    }
    // (it comes and goes by dissolving back along itself: a ribbon this size can't go out in a frame)
    const tr = Math.max(smooth01(5, 20, v), e * Math.min(1, k));
    this.trail.visible = tr > 0.01;
    if (this.trail.visible) {
      const U = this.trailU;
      bus.updateMatrixWorld();
      U.uTail.value.copy(bus.localToWorld(this.tmp.copy(this.tailLocal)));
      U.uBack.value.copy(nosing).negate();
      U.uTrail.value.set(260, 3.2, 10, tr);
      // (never slower than a third of its flow at 30 km/s: at the street's speeds over Earth the log would run it backwards)
      this.scroll = (this.scroll + dt * spaceFxTune.trailFlow * Math.max(0.35, 1 + 0.8 * Math.log10(Math.max(v, 1) / 30))) % 256;
      U.uScroll.value = this.scroll;
      // (its own clock, turned over once an hour for the shader's precision: a twitch then, and never in a trip)
      this.life = (this.life + dt) % 3600;
      U.uLife.value.set(spaceFxTune.trailWave, spaceFxTune.trailPuff, spaceFxTune.trailSparkle, this.life);
    }
  }
}
