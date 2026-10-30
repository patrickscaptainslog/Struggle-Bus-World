import * as THREE from 'three';
import { globals, GLSL_COMMON, GLSL_OUT, SHADOW_LAYER } from '../../render/materials';
import { Ramp } from '../../render/palette';
import { GLSL_LM_PAINT_FS, GLSL_LM_PAINT_VS, LM_DOME, LM_FLAG, landmarkPaintUniforms, type LandmarkLook } from './landmarkPaint';
import { tuneUniform } from './common';
import { HERO_PROPS, HIDDEN, isSfOrigin, llToLocal, type HeroProp, type Hidden, type PropBox } from '../towerStyles';
import type { ObstaclePost } from '../Bridges';
import type { BuildingRef } from '../City';
import { paintUniforms } from '../buildingMaterial';

// Hand-built landmarks, chunky enough to read as silhouettes from 1-4 km
// through the fog, with detail that only resolves up close: Sutro Tower's
// lattice legs (see-through when the bus is near), the Transamerica
// Pyramid's floor-by-floor window bands, Coit Tower's fluted column and its
// arched lookout, the Ferry Building's arcades and clock tower, 181
// Fremont's spire. Detail fades with the on-screen size of a meter (fwidth),
// so far away nothing crawls.

const enum Pat {
  PLAIN = 0,
  BANDS = 1, // Sutro's red/white paint as light/dark grey bands
  LATTICE = 2, // see-through truss up close (+ bands)
  WINDOWS = 3, // floor bands + window columns
  FLUTES = 4, // Coit Tower's fluted shaft: a shallow dark groove down each facet
  COIT_TOP = 5, // Coit's lookout: one tall arched opening per facet
  FERRY = 6, // the Ferry Building's facade: a ground-floor arcade, arched windows above
  LANTERN = 7, // the clock tower's open stages: arched openings
  CLOCK = 8, // a clock face
}

class LandmarkKit {
  pos: number[] = [];
  nrm: number[] = [];
  ramp: number[] = [];
  lo: number[] = [];
  pat: number[] = [];

  private vert(p: THREE.Vector3, n: THREE.Vector3, ramp: number, lo: number, u: number, v: number, type: number, w: number) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.ramp.push(ramp);
    this.lo.push(lo);
    this.pat.push(u, v, type, w);
  }

  /** Quad a-b-c-d (counter-clockwise seen from outside); u01/v per corner. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ramp: number, lo: number, type: number, uv: number[], w: number[]) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const P = [a, b, c, d];
    for (const k of [0, 1, 2, 0, 2, 3]) this.vert(P[k], n, ramp, lo, uv[k * 2], uv[k * 2 + 1], type, w[k]);
  }

  /** Tapered square beam from a to b (widths wa -> wb). `ref` orients the faces. */
  beam(a: THREE.Vector3, b: THREE.Vector3, wa: number, wb: number, ramp: number, lo: number, type: number, ref = new THREE.Vector3(0, 1, 0), caps = true) {
    const z = new THREE.Vector3().subVectors(b, a);
    const len = z.length();
    if (len < 0.01) return;
    z.divideScalar(len);
    const r = Math.abs(z.dot(ref)) > 0.98 ? new THREE.Vector3(1, 0, 0) : ref;
    const x = new THREE.Vector3().crossVectors(r, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    const corner = (base: THREE.Vector3, w: number, sx: number, sy: number) =>
      base.clone().addScaledVector(x, (sx * w) / 2).addScaledVector(y, (sy * w) / 2);
    const sides: Array<[number, number, number, number]> = [
      [1, -1, 1, 1],
      [1, 1, -1, 1],
      [-1, 1, -1, -1],
      [-1, -1, 1, -1],
    ];
    // v along the beam is measured in meters from a
    const v0 = 0, v1 = len;
    for (const [ax, ay, bx, by] of sides) {
      const p0 = corner(a, wa, ax, ay), p1 = corner(a, wa, bx, by), p2 = corner(b, wb, bx, by), p3 = corner(b, wb, ax, ay);
      this.quad(p0, p1, p2, p3, ramp, lo, type, [0, v0, 1, v0, 1, v1, 0, v1], [wa, wa, wb, wb]);
    }
    if (caps) {
      const c = (base: THREE.Vector3, w: number) => [corner(base, w, -1, -1), corner(base, w, 1, -1), corner(base, w, 1, 1), corner(base, w, -1, 1)];
      const A = c(a, wa), B = c(b, wb);
      this.quad(A[0], A[3], A[2], A[1], ramp, lo, Pat.PLAIN, [0, 0, 0, 0, 0, 0, 0, 0], [wa, wa, wa, wa]);
      this.quad(B[0], B[1], B[2], B[3], ramp, lo, Pat.PLAIN, [0, 0, 0, 0, 0, 0, 0, 0], [wb, wb, wb, wb]);
    }
  }

  /** Axis-aligned square frustum (pyramid slice) centered on x,z. */
  frustum(cx: number, cz: number, y0: number, h0: number, y1: number, h1: number, ramp: number, lo: number, type: number, cap = false, hz0 = h0, hz1 = h1) {
    const P = (sx: number, sz: number, y: number, hx: number, hz: number) => new THREE.Vector3(cx + sx * hx, y, cz + sz * hz);
    const faces: Array<[number, number, number, number]> = [
      [1, 1, 1, -1], // +x
      [-1, 1, 1, 1], // +z
      [-1, -1, -1, 1], // -x
      [1, -1, -1, -1], // -z
    ];
    for (const [ax, az, bx, bz] of faces) {
      const along = ax === bx ? 'z' : 'x';
      const w0 = along === 'z' ? hz0 * 2 : h0 * 2;
      const w1 = along === 'z' ? hz1 * 2 : h1 * 2;
      this.quad(P(ax, az, y0, h0, hz0), P(bx, bz, y0, h0, hz0), P(bx, bz, y1, h1, hz1), P(ax, az, y1, h1, hz1), ramp, lo, type, [0, y0, 1, y0, 1, y1, 0, y1], [w0, w0, w1, w1]);
    }
    if (cap) this.quad(P(-1, -1, y1, h1, hz1), P(-1, 1, y1, h1, hz1), P(1, 1, y1, h1, hz1), P(1, -1, y1, h1, hz1), ramp, lo, Pat.PLAIN, [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0]);
  }

  /** Regular n-gon prism (frustum) about x,z: radius r0 at y0 to r1 at y1, `rot` turns it. */
  ngon(cx: number, cz: number, y0: number, r0: number, y1: number, r1: number, sides: number, ramp: number, lo: number, type: number, cap = false, rot = 0) {
    const P = (k: number, r: number, y: number) => {
      const a = rot + (k / sides) * Math.PI * 2;
      return new THREE.Vector3(cx + Math.cos(a) * r, y, cz - Math.sin(a) * r);
    };
    const w0 = 2 * r0 * Math.sin(Math.PI / sides), w1 = 2 * r1 * Math.sin(Math.PI / sides);
    for (let k = 0; k < sides; k++) {
      this.quad(P(k, r0, y0), P(k + 1, r0, y0), P(k + 1, r1, y1), P(k, r1, y1), ramp, lo, type, [0, y0, 1, y0, 1, y1, 0, y1], [w0, w0, w1, w1]);
    }
    if (cap) {
      const c = new THREE.Vector3(cx, y1, cz);
      for (let k = 0; k < sides; k++) this.tri(c, P(k, r1, y1), P(k + 1, r1, y1), ramp, lo);
    }
  }

  /** Plain triangle a-b-c (counter-clockwise seen from outside). */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ramp: number, lo: number) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const p of [a, b, c]) this.vert(p, n, ramp, lo, 0, 0, Pat.PLAIN, 0);
  }

  /** Box from x0..x1, y0..y1, z0..z1. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, ramp: number, lo: number, type: number) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.frustum(cx, cz, y0, (x1 - x0) / 2, y1, (x1 - x0) / 2, ramp, lo, type, true, (z1 - z0) / 2, (z1 - z0) / 2);
  }

  /** The mesh, with its own paintable material (`look`: its painted accents, see landmarkPaint.ts). */
  build(look?: LandmarkLook): THREE.Mesh {
    // level-3 accents go last: the mesh draws only up to them until it is painted that far (bindLandmarkPaint)
    const accentStart = this.pos.length / 3;
    if (look) this.accents(look);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('ramp', new THREE.Float32BufferAttribute(this.ramp, 1));
    g.setAttribute('lightOffset', new THREE.Float32BufferAttribute(this.lo, 1));
    g.setAttribute('aPat', new THREE.Float32BufferAttribute(this.pat, 4));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    if (this.pos.length / 3 > accentStart) {
      g.userData.lmAccentStart = accentStart;
      g.setDrawRange(0, accentStart);
    }
    const mesh = new THREE.Mesh(g, landmarkMaterial(look));
    mesh.layers.enable(SHADOW_LAYER);
    return mesh;
  }

  /** Level-3 accents: golden onion domes (a faceted lathe) and rainbow bunting (pennants on a sagging string). */
  private accents(look: LandmarkLook) {
    // the onion's profile (radius, height) in units of its widest radius / 1.32
    const prof: Array<[number, number]> = [[0.75, 0], [1.0, 0.25], [1.25, 0.7], [1.32, 1.15], [1.2, 1.6], [0.9, 2.05], [0.55, 2.45], [0.28, 2.8], [0.1, 3.1], [0, 3.3]];
    for (const [cx, cy, cz, r] of look.domes ?? []) {
      const s = r / 1.32, H = 3.3 * s;
      const segs = r > 5 ? 12 : 8;
      const P = (k: number, j: number) => {
        const a = (k / segs) * Math.PI * 2;
        return new THREE.Vector3(cx + Math.cos(a) * prof[j][0] * s, cy + prof[j][1] * s, cz - Math.sin(a) * prof[j][0] * s);
      };
      for (let j = 0; j + 1 < prof.length; j++)
        for (let k = 0; k < segs; k++) {
          const v0 = prof[j][1] * s, v1 = prof[j + 1][1] * s;
          this.quad(P(k, j), P(k + 1, j), P(k + 1, j + 1), P(k, j + 1), Ramp.GREY_LIGHT, 0, LM_DOME, [k / segs, v0, (k + 1) / segs, v0, (k + 1) / segs, v1, k / segs, v1], [H, H, H, H]);
        }
    }
    // pennants: u = hue step (+0.5 on the fluttering tip), v = order along all strings, w = count
    const strings = look.bunting ?? [];
    let total = 0;
    const lens = strings.map((b) => Math.max(4, Math.round(Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]) / 1.7)));
    for (const n of lens) total += n;
    let order = 0;
    const at = (b: (typeof strings)[number], t: number) =>
      new THREE.Vector3(b.from[0] + (b.to[0] - b.from[0]) * t, b.from[1] + (b.to[1] - b.from[1]) * t - 4 * b.sag * t * (1 - t), b.from[2] + (b.to[2] - b.from[2]) * t);
    strings.forEach((b, si) => {
      const n = lens[si];
      for (let i = 0; i < n; i++) {
        const p0 = at(b, (i + 0.08) / n), p1 = at(b, (i + 0.92) / n);
        const tip = p0.clone().add(p1).multiplyScalar(0.5);
        tip.y -= 1.35;
        const hue = (order % 6) + 0;
        const n1 = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(tip, p0)).normalize();
        const n2 = n1.clone().negate();
        // both sides (the landmark material culls back faces)
        this.vert(p0, n1, Ramp.GREY_LIGHT, 0, hue, order, LM_FLAG, total);
        this.vert(p1, n1, Ramp.GREY_LIGHT, 0, hue, order, LM_FLAG, total);
        this.vert(tip, n1, Ramp.GREY_LIGHT, 0, hue + 0.5, order, LM_FLAG, total);
        this.vert(p0, n2, Ramp.GREY_LIGHT, 0, hue, order, LM_FLAG, total);
        this.vert(tip, n2, Ramp.GREY_LIGHT, 0, hue + 0.5, order, LM_FLAG, total);
        this.vert(p1, n2, Ramp.GREY_LIGHT, 0, hue, order, LM_FLAG, total);
        order++;
      }
    });
  }
}

// One material per landmark (its own paint texel and accents in uniforms); the
// shader source is shared, so they all run one program. Every landmark is
// paintable (landmarkPaint.ts): register it where it is placed with
// paintLandmark(city, 'lm:<name>', object); `k.build(look)` sets its accents.
function landmarkMaterial(look?: LandmarkLook): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...globals,
      uLandmarkFog: tuneUniform('landmarkFog'),
      ...landmarkPaintUniforms(look),
    },
    vertexShader: /* glsl */ `
      ${GLSL_COMMON}
      ${GLSL_LM_PAINT_VS}
      in float ramp;
      in float lightOffset;
      in vec4 aPat;
      flat out float vRamp;
      flat out float vType;
      out float vLo;
      out vec4 vPat;
      out float vLocalY;
      out vec3 vWorldPos;
      out vec3 vWorldNormal;
      out vec3 vViewNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(lmVertex(position, aPat), 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
        vRamp = ramp;
        vLo = lightOffset;
        vType = aPat.z;
        vPat = aPat;
        vLocalY = position.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${GLSL_LM_PAINT_FS}
      uniform float uLandmarkFog;
      flat in float vRamp;
      flat in float vType;
      in float vLo;
      in vec4 vPat;
      in float vLocalY;
      in vec3 vWorldPos;
      in vec3 vWorldNormal;
      in vec3 vViewNormal;
      ${GLSL_OUT}
      void main() {
        float type = floor(vType + 0.5);
        float lo = vLo;
        float y = vLocalY;
        // meters per screen pixel along the surface
        float mpp = max(fwidth(vPat.y), fwidth(y));
        if (type == 1.0 || type == 2.0) {
          // Sutro's paint: alternating bands, kept subtle and grey
          float band = mod(floor(y / 24.5), 2.0);
          lo += band > 0.5 ? 0.055 : -0.045;
        }
        if (type == 2.0) {
          float w = max(vPat.w, 0.5);
          float u = vPat.x * w;
          float v = vPat.y;
          float near = 1.0 - smoothstep(0.42, 0.62, mpp);
          if (near > 0.0) {
            float chord = 0.16 * w + 0.25;
            float bw = 0.09 * w + 0.22;
            float P = w * 1.15;
            float zig = abs(fract(v / (2.0 * P)) * 2.0 - 1.0) * w;
            float zag = abs(fract(v / (2.0 * P) + 0.5) * 2.0 - 1.0) * w;
            bool solid = u < chord || u > w - chord
              || abs(u - zig) < bw * 1.25 || abs(u - zag) < bw * 0.8
              || abs(fract(v / P + 0.5) - 0.5) * P < bw * 0.7;
            if (!solid) discard;
            lo += (u < chord || u > w - chord) ? 0.02 : -0.03;
          } else {
            lo -= 0.03; // lattice density reads a little darker far away
          }
        }
        if (type == 3.0) {
          // one dark window band per floor; window columns only when very close
          float amp = 1.0 - smoothstep(0.6, 1.3, mpp);
          float fy = fract(y / 3.95);
          float row = step(0.42, fy) * step(fy, 0.8);
          float uc = (vPat.x - 0.5) * vPat.w;
          float fx = fract(uc / 1.65 + 0.5);
          float col = mix(1.0, step(0.18, fx) * step(fx, 0.82), 1.0 - smoothstep(0.18, 0.3, mpp));
          lo -= mix(0.03, 0.15 * row * col, amp);
        }
        float fu = vPat.x * vPat.w; // meters across the face
        float mu = max(fwidth(fu), mpp);
        if (type == 4.0 && mu < 0.9) {
          // a groove down the middle of each facet
          float g = abs(vPat.x - 0.5) * vPat.w;
          if (g < max(0.35, mu * 0.5)) lo -= 0.09;
        }
        if (type >= 5.0 && type <= 7.0) {
          // arched openings: (spacing, width, sill, spring of the round head) per pattern
          float S = type == 5.0 ? vPat.w : type == 6.0 ? 6.2 : 4.0;
          float W = type == 5.0 ? min(1.5, vPat.w * 0.55) : type == 6.0 ? 4.0 : 2.4;
          float y0 = type == 5.0 ? 51.5 : type == 6.0 ? 0.6 : 51.0;
          float y1 = type == 5.0 ? 57.0 : type == 6.0 ? 4.6 : 57.5;
          // (centered on the face)
          float fc = fu - vPat.w * 0.5;
          float cx = (fract(fc / S + 0.5) - 0.5) * S;
          bool open = abs(cx) < W * 0.5 && y > y0 && (y < y1 || length(vec2(cx, (y - y1) * 1.0)) < W * 0.5);
          // the Ferry Building's upper floor: smaller arched windows over the arcade
          if (type == 6.0 && !open) {
            float cx2 = (fract(fc / 3.1 + 0.5) - 0.5) * 3.1;
            open = abs(cx2) < 0.8 && y > 8.2 && (y < 11.2 || length(vec2(cx2, y - 11.2)) < 0.8);
            if (y > 7.0 && y < 7.6 && mpp < 0.8) lo += 0.06; // the string course between the floors
            if (open && mpp > 0.55) open = false;
          }
          if (open && mpp < 1.1) lo -= type == 6.0 ? 0.3 : 0.36;
          else if (open) lo -= 0.06;
        }
        if (type == 8.0) {
          // a clock: pale face, dark ring and hands (it is always about ten to five)
          vec2 q = vec2(fu - vPat.w * 0.5, y - 44.5);
          float r = length(q);
          if (r < 3.4) {
            lo += 0.12;
            if (mpp < 0.9 && r > 2.9) lo -= 0.28;
            float a1 = atan(q.x, q.y);
            if (mpp < 0.6 && ((abs(a1 - 2.6) < 0.09 && r < 2.0) || (abs(a1 + 0.6) < 0.06 && r < 2.6))) lo -= 0.35;
          }
        }
        vec3 n = normalize(vWorldNormal);
        if (!gl_FrontFacing) n = -n;
        LmPaint lp = lmPaint(floor(vRamp + 0.5), lo, type, vPat, y, vWorldPos, n, mpp);
        float light = lp.mode > 1.5 ? lp.light : sbLight(vWorldPos, n, lp.lo, 1.0);
        // paint lives in the saturated middle of each ramp, as on the buildings
        if (lp.mode > 0.5 && lp.mode < 1.5) light = 0.2 + light * 0.52;
        // the aim glint after the mapping: a full ramp step, as on the buildings
        light += lp.glint;
        float fog = sbFog(vWorldPos) * uLandmarkFog;
        sbWrite(lp.ramp, light, fog, lp.glow, gl_FrontFacing ? vViewNormal : -vViewNormal, 0.37, 1.0);
      }
    `,
  });
}

// (Sutro's legs, as makeSutroTower draws them: radius at height y, angle of leg i)
const sutroLeg = (i: number, y: number, dr = 0): [number, number, number] => {
  const r = 29 + (4.6 - 29) * (y / 232) + dr, a = (i * Math.PI * 2) / 3 + 0.35;
  return [Math.cos(a) * r, y, Math.sin(a) * r];
};
/**
 * Sutro painted: its red/white bands a rainbow, beacons blinking up the masts, vines spiraling up the
 * legs; at level 3 golden onions where the masts leave the arms and bunting strung between the legs.
 */
const SUTRO_LOOK: LandmarkLook = {
  glowFrom: 279,
  blink: true,
  vines: 0.5,
  band: 12,
  paintBands: 24.5,
  domes: [0, 1, 2].map((i) => {
    const [x, , z] = sutroLeg(i, 222);
    const k = 17.5 / Math.hypot(x, z);
    return [x * k, 233.5, z * k, 4.6] as [number, number, number, number];
  }),
  bunting: [72, 126].flatMap((y) => [0, 1, 2].map((i) => ({ from: sutroLeg(i, y, 1.5), to: sutroLeg((i + 1) % 3, y, 1.5), sag: y < 100 ? 6 : 4.5 }))),
};
/**
 * The pyramid painted: a lit spire, vines up the faces, planted wings, stained-glass floors; at level 3
 * a golden onion skewered by the spire, onion turrets on the corners of the base and bunting along it.
 */
const PYRAMID_LOOK: LandmarkLook = {
  glowFrom: 226,
  vines: 0.4,
  planted: [124, 219],
  band: 9,
  domes: [[0, 205, 0, 12], [24.8, 16.6, 24.8, 2.6], [-24.8, 16.6, 24.8, 2.6], [24.8, 16.6, -24.8, 2.6], [-24.8, 16.6, -24.8, 2.6]],
  bunting: [
    { from: [-24.8, 20.2, 26.3], to: [24.8, 20.2, 26.3], sag: 2.2 },
    { from: [26.3, 20.2, 24.8], to: [26.3, 20.2, -24.8], sag: 2.2 },
    { from: [24.8, 20.2, -26.3], to: [-24.8, 20.2, -26.3], sag: 2.2 },
    { from: [-26.3, 20.2, -24.8], to: [-26.3, 20.2, 24.8], sag: 2.2 },
  ],
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Coit Tower (1933): a 64 m fluted concrete column on Telegraph Hill, its
 * lookout a ring of tall arched openings under a cornice, standing on a low
 * square base. Origin at the base center.
 */
export function makeCoitTower(): THREE.Object3D {
  const k = new LandmarkKit();
  const W = Ramp.GREY_LIGHT;
  // the base with its lobby (the murals are inside)
  k.box(-12, -4, -12, 12, 7.5, 12, W, 0.02, Pat.PLAIN);
  k.box(-12.6, 7.5, -12.6, 12.6, 8.4, 12.6, W, 0.08, Pat.PLAIN);
  // the fluted shaft: 16 facets, each with a groove
  const sides = 16, r = 5.65;
  k.ngon(0, 0, 8.4, r, 50.5, r, sides, W, 0.06, Pat.FLUTES);
  // the lookout: a slightly wider ring of arched openings, a cornice, a parapet and a low cap
  k.ngon(0, 0, 50.5, r + 0.25, 58.5, r + 0.25, sides, W, 0.07, Pat.COIT_TOP);
  k.ngon(0, 0, 58.5, r + 0.9, 59.6, r + 0.9, sides, W, 0.12, Pat.PLAIN, true);
  k.ngon(0, 0, 59.6, r - 0.2, 62.4, r - 0.2, sides, W, 0.05, Pat.PLAIN, true);
  k.ngon(0, 0, 62.4, r - 1.6, 64.0, 2.4, sides, W, 0.09, Pat.PLAIN, true);
  const mesh = k.build();
  const g = new THREE.Group();
  g.name = 'CoitTower';
  g.add(mesh);
  return g;
}

/**
 * The Ferry Building (1898): a 200 m long two-storey sandstone hall on the
 * Embarcadero, a ground-floor arcade and arched windows above, a skylit nave
 * down its spine, and the 75 m clock tower at the middle of its front, on the
 * axis of Market Street. Local frame: +z along the building, the front (city
 * side) faces -x. Origin at the center of the footprint, at the ground.
 */
const FERRY_BAY = 37;

/**
 * The props' collision surfaces in their own frame (x0, z0, x1, z1, top above their base): what the
 * flight's obstacle grid holds over the footprints they hide (City.setPropObstacles).
 */
const COIT_BOXES: Array<[number, number, number, number, number]> = [
  [-12.6, -12.6, 12.6, 12.6, 8.4],
  [-6.6, -6.6, 6.6, 6.6, 64],
];
const FERRY_BOXES: Array<[number, number, number, number, number]> = [
  [-35, -99, 9, 99, 14.6], // the hall
  [-22.5, -93, -3.5, 93, 21.5], // the nave
  [-35.4, -99, 9.4, -85, 16.5], // the pavilions
  [-35.4, 85, 9.4, 99, 16.5],
  [9, -95.4, FERRY_BAY + 0.5, 95.4, 13.3], // the bay-side wing
  [-43.1, -7.6, -27.9, 7.6, 75.5], // the clock tower
];

export function makeFerryBuilding(): THREE.Object3D {
  const k = new LandmarkKit();
  const W = Ramp.GREY_LIGHT;
  const x0 = -35, x1 = 9, L = 99;
  // the hall
  k.box(x0, -2, -L, x1, 14, L, W, 0.05, Pat.FERRY);
  k.box(x0 - 0.6, 13.6, -L - 0.6, x1 + 0.6, 14.6, L + 0.6, W, 0.11, Pat.PLAIN);
  // the nave: a clerestory with a pitched roof down the middle
  const nx0 = -22, nx1 = -4, nm = (nx0 + nx1) / 2;
  k.box(nx0, 14, -L + 6, nx1, 17.5, L - 6, W, 0.0, Pat.WINDOWS);
  const R0 = V(nx0 - 0.5, 17.5, -L + 6), R1 = V(nx1 + 0.5, 17.5, -L + 6), R2 = V(nx1 + 0.5, 17.5, L - 6), R3 = V(nx0 - 0.5, 17.5, L - 6);
  const T0 = V(nm, 21.5, -L + 6), T1 = V(nm, 21.5, L - 6);
  // (roofs on one ramp, as the baked ones: the dark membrane is GREY_LIGHT - 0.34)
  k.quad(R3, R0, T0, T1, W, -0.34, Pat.PLAIN, [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0]);
  k.quad(R1, R2, T1, T0, W, -0.34, Pat.PLAIN, [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0]);
  k.tri(R0, R1, T0, W, 0.04);
  k.tri(R2, R3, T1, W, 0.04);
  // pavilions at the ends, a little taller
  for (const zc of [-L + 7, L - 7]) k.box(x0 - 0.4, 0, zc - 7, x1 + 0.4, 16.5, zc + 7, W, 0.07, Pat.FERRY);
  // the bay side: a lower two-storey wing out to where the footprints end (x = +37), between the pavilions
  k.box(x1, -2, -L + 4, FERRY_BAY, 12.6, L - 4, W, 0.03, Pat.FERRY);
  k.box(x1, 12.6, -L + 3.6, FERRY_BAY + 0.5, 13.3, L - 3.6, W, 0.1, Pat.PLAIN);
  // the clock tower (after the Giralda in Seville): shaft, clock stage, two open stages, cupola
  const tx = x0 - 0.5;
  k.box(tx - 6.6, -2, -6.6, tx + 6.6, 40, 6.6, W, 0.06, Pat.WINDOWS);
  k.box(tx - 7.0, 40, -7.0, tx + 7.0, 49.5, 7.0, W, 0.08, Pat.CLOCK);
  k.box(tx - 7.6, 49.5, -7.6, tx + 7.6, 50.6, 7.6, W, 0.13, Pat.PLAIN);
  k.box(tx - 5.8, 50.6, -5.8, tx + 5.8, 59.5, 5.8, W, 0.06, Pat.LANTERN);
  k.box(tx - 6.3, 59.5, -6.3, tx + 6.3, 60.4, 6.3, W, 0.12, Pat.PLAIN);
  k.box(tx - 4.2, 60.4, -4.2, tx + 4.2, 66.5, 4.2, W, 0.05, Pat.PLAIN);
  k.frustum(tx, 0, 66.5, 4.2, 71.5, 1.0, W, 0.08, Pat.PLAIN, true);
  k.beam(V(tx, 71.4, 0), V(tx, 75.5, 0), 0.5, 0.25, W, 0.1, Pat.PLAIN);
  const mesh = k.build();
  const g = new THREE.Group();
  g.name = 'FerryBuilding';
  g.add(mesh);
  return g;
}

/** 181 Fremont's spire: a slender mast on its crown. Origin on the roof it stands on. */
export function makeFremontSpire(): THREE.Object3D {
  const k = new LandmarkKit();
  const W = Ramp.GREY_LIGHT;
  k.box(-2.2, -0.5, -2.2, 2.2, 1.8, 2.2, W, 0.0, Pat.PLAIN);
  k.beam(V(0, 1.8, 0), V(0, 17.5, 0), 1.6, 0.35, W, 0.08, Pat.PLAIN);
  const mesh = k.build();
  const g = new THREE.Group();
  g.name = 'FremontSpire';
  g.add(mesh);
  return g;
}

/**
 * The hand-built heroes the footprints can't draw (towerStyles.ts HERO_PROPS),
 * placed by lat/lon through the bake's projection, each with the collision
 * posts the flight steers around. Only for the city the table is written for.
 */
export interface HeroLandmark {
  kind: HeroProp['kind'];
  object: THREE.Object3D;
  posts: ObstaclePost[];
  /** the footprints it replaces (towerStyles HIDDEN) and its own collision boxes (local m, m ASL) */
  clear: Hidden | null;
  boxes: PropBox[];
  /** paintable on its own (paintLandmark under this key, signed with this name), or null (it rides a building) */
  paint: { key: string; name: string } | null;
}

export function heroLandmarks(origin: [number, number]): HeroLandmark[] {
  if (!isSfOrigin(origin)) return [];
  const out: HeroLandmark[] = [];
  const make = (h: HeroProp) => (h.kind === 'coit' ? makeCoitTower() : h.kind === 'ferry' ? makeFerryBuilding() : makeFremontSpire());
  for (const h of HERO_PROPS) {
    const [x, z] = llToLocal(h.lat, h.lon, origin);
    const object = make(h);
    object.position.set(x, h.baseY, z);
    object.rotation.y = h.yaw;
    object.updateMatrixWorld(true);
    const posts: ObstaclePost[] = [];
    // (a box in the prop's frame to local meters: its +z is (sin yaw, cos yaw), its +x (cos yaw, -sin yaw))
    const sy = Math.sin(h.yaw), cy = Math.cos(h.yaw);
    const box = ([x0, z0, x1, z1, top]: [number, number, number, number, number]): PropBox => {
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      return { cx: x + mx * cy + mz * sy, cz: z - mx * sy + mz * cy, ax: sy, az: cy, halfL: (z1 - z0) / 2, halfW: (x1 - x0) / 2, top: h.baseY + top, pad: top > 40 ? 6 : 3 };
    };
    let clear: Hidden | null = null;
    let boxes: PropBox[] = [];
    if (h.kind === 'coit') {
      posts.push({ x, z, r: 9, top: h.baseY + 67, under: -Infinity });
      clear = HIDDEN.find((d) => d.name === 'Coit Tower') ?? null;
      boxes = COIT_BOXES.map(box);
    } else if (h.kind === 'ferry') {
      // the clock tower; the rest of the building is its boxes in the obstacle grid
      const t = new THREE.Vector3(-35.5, 0, 0).applyMatrix4(object.matrixWorld);
      posts.push({ x: t.x, z: t.z, r: 10, top: h.baseY + 78, under: -Infinity });
      clear = HIDDEN.find((d) => d.name === 'Ferry Building') ?? null;
      boxes = FERRY_BOXES.map(box);
    } else posts.push({ x, z, r: 3, top: h.baseY + 19, under: -Infinity });
    out.push({ kind: h.kind, object, posts, clear, boxes, paint: h.paint ?? null });
  }
  return out;
}

/**
 * 181 Fremont's spire rides its tower: a painted building squashes and stretches about its ground (the
 * pop) and wobbles in the vertex shader, which a prop on its roof doesn't see. bind() gives it the tower
 * (its streamed ref) and the roof under the spire; update() mirrors buildingMaterial.ts's pop and wobble
 * for that one point every frame (no allocation). Unpainted, it rests on the roof.
 */
export class SpireRide {
  private ref: BuildingRef | null = null;
  private seed = 0;
  private x0 = 0;
  private y0 = 0;
  private z0 = 0;
  constructor(readonly object: THREE.Object3D) {}

  get bound(): boolean {
    return this.ref !== null;
  }

  bind(ref: BuildingRef, roofY: number) {
    this.ref = ref;
    this.seed = ref.tile.seed[ref.local];
    this.x0 = this.object.position.x;
    this.z0 = this.object.position.z;
    this.y0 = roofY;
    this.object.position.y = roofY;
  }

  /** paint = PaintState.data, time = globals.uTime */
  update(paint: Float32Array, time: number) {
    const r = this.ref;
    if (!r) return;
    const o = r.index * 4;
    let x = this.x0, y = this.y0, z = this.z0;
    const tb = time - paint[o + 2];
    if (paint[o + 1] > 0.5 && tb >= 0) {
      const B = paintUniforms.uBloom.value, Wb = paintUniforms.uWobble.value;
      let pop = 0;
      if (tb < B.x * 1.6) {
        const k = tb / B.x;
        pop = -B.y * Math.exp(-7 * k) * Math.cos(10.5 * k) + B.z * Math.exp(-5 * k) * Math.sin(10.5 * k);
      }
      const sy = 1 + pop;
      const sxz = 1 / Math.sqrt(Math.max(sy, 0.4));
      y = r.baseY + (this.y0 - r.baseY) * sy;
      x = r.cx + (this.x0 - r.cx) * sxz;
      z = r.cz + (this.z0 - r.cz) * sxz;
      const h01 = Math.min(1, Math.max(0, (this.y0 - r.baseY) / Math.max(r.roofY - r.baseY, 1)));
      const u = Math.min(1, tb / 0.6);
      const w = Wb.x * h01 * u * u * (3 - 2 * u);
      const t = time * Wb.y;
      const sd = this.seed * 0.137;
      x += w * Math.sin(this.y0 * 0.33 + this.z0 * 0.21 + t + sd);
      z += w * Math.sin(this.y0 * 0.29 + this.x0 * 0.23 + t * 0.87 + sd * 1.7);
    }
    this.object.position.set(x, y, z);
  }
}

/**
 * Sutro Tower: 298 m. Three tapered lattice legs converge toward the top,
 * a lower and an upper triangular crossbar, three antenna masts. Origin at
 * the base center (put it on the hilltop).
 */
export function makeSutroTower(): THREE.Object3D {
  const k = new LandmarkKit();
  const G = Ramp.GREY_LIGHT;
  const R0 = 29, R1 = 4.6, yTop = 232;
  const Rat = (y: number) => R0 + (R1 - R0) * (y / yTop);
  // leg 0 points north-west-ish so the classic trident reads from downtown
  const ang = (i: number) => (i * Math.PI * 2) / 3 + 0.35;
  const legAt = (i: number, y: number, r = Rat(y)) => V(Math.cos(ang(i)) * r, y, Math.sin(ang(i)) * r);
  for (let i = 0; i < 3; i++) {
    const foot = legAt(i, -10, Rat(-10));
    const top = legAt(i, yTop + 4);
    const out = V(Math.cos(ang(i)), 0, Math.sin(ang(i)));
    k.beam(foot, top, 7.2, 4.4, G, 0.0, Pat.LATTICE, out);
    // concrete footing
    const f = legAt(i, 0);
    k.box(f.x - 6, -6, f.z - 6, f.x + 6, 2.2, f.z + 6, G, -0.06, Pat.PLAIN);
  }
  // crossbars: lower (a tight triangle just outside the legs) and the big upper arms
  const tri = (y: number, R: number, w: number, h: number, type: number) => {
    for (let i = 0; i < 3; i++) {
      const a = legAt(i, y, R), b = legAt((i + 1) % 3, y, R);
      // a deep horizontal truss: w across (horizontal), h tall
      const d = new THREE.Vector3().subVectors(b, a).normalize();
      const inward = V(-d.z, 0, d.x);
      k.beam(a.clone().addScaledVector(d, -w * 0.5), b.clone().addScaledVector(d, w * 0.5), w, w, G, 0.03, type, inward);
      if (h > w) {
        // a second chord below makes the truss deep
        k.beam(a.clone().setY(y - h + w).addScaledVector(d, -w * 0.5), b.clone().setY(y - h + w).addScaledVector(d, w * 0.5), w * 0.8, w * 0.8, G, 0.0, type, inward);
        for (let s = 0; s <= 4; s++) {
          const p = a.clone().lerp(b, s / 4);
          k.beam(p.clone().setY(y - h + w), p.clone().setY(y), w * 0.55, w * 0.55, G, 0.0, Pat.BANDS, d);
        }
      }
      // arms reaching from the leg out to the corner
      const leg = legAt(i, y);
      k.beam(leg, legAt(i, y, R + w * 0.3), w * 0.9, w * 0.9, G, 0.02, type, V(0, 1, 0));
    }
  };
  tri(158, Rat(158) + 5.5, 4.4, 4.4, Pat.LATTICE);
  tri(229, 17.5, 5.6, 11, Pat.LATTICE);
  // antenna masts at the upper corners, plus a short center stub
  const heights = [298, 289, 283];
  for (let i = 0; i < 3; i++) {
    const base = legAt(i, 222, 17.5);
    k.beam(base, V(base.x * 0.96, heights[i], base.z * 0.96), 3.4, 2.2, G, 0.05, Pat.BANDS, V(0, 1, 0).cross(base).normalize());
    // a little platform cap where each mast leaves the arm
    k.box(base.x - 2.6, 229 + 2.6, base.z - 2.6, base.x + 2.6, 233.5, base.z + 2.6, G, 0.04, Pat.PLAIN);
  }
  k.beam(V(0, 226, 0), V(0, 252, 0), 3.2, 2.2, G, 0.02, Pat.BANDS);
  const mesh = k.build(SUTRO_LOOK);
  const g = new THREE.Group();
  g.name = 'SutroTower';
  g.add(mesh);
  return g;
}

/**
 * Transamerica Pyramid: 260 m, a slender four-sided pyramid with the two
 * elevator/stair "wings" and the spire; window rows as subtle banding.
 * Origin at the base center.
 */
export function makeTransamerica(): THREE.Object3D {
  const k = new LandmarkKit();
  const W = Ramp.GREY_LIGHT;
  const half0 = 26.5, yTopFloor = 205, halfTop = 7.6;
  const hAt = (y: number) => half0 + (halfTop - half0) * (y / yTopFloor);
  const baseH = 15;
  // the pyramid body
  k.frustum(0, 0, baseH, hAt(baseH), yTopFloor, halfTop, W, 0.04, Pat.WINDOWS, true);
  // the base: a dark recessed lobby behind a ring of piers
  k.box(-hAt(baseH) + 3.2, -2, -hAt(baseH) + 3.2, hAt(baseH) - 3.2, baseH + 0.5, hAt(baseH) - 3.2, Ramp.GREY, -0.16, Pat.PLAIN);
  const piers = 5;
  for (const [sx, sz, ax] of [
    [1, 0, 'z'],
    [-1, 0, 'z'],
    [0, 1, 'x'],
    [0, -1, 'x'],
  ] as Array<[number, number, 'x' | 'z']>) {
    for (let i = sx !== 0 ? 0 : 1; i <= (sx !== 0 ? piers : piers - 1); i++) {
      const t = (i / piers) * 2 - 1;
      const bx = sx !== 0 ? sx * (half0 - 1.2) : t * (half0 - 1.6);
      const bz = sz !== 0 ? sz * (half0 - 1.2) : t * (half0 - 1.6);
      const tx = sx !== 0 ? sx * (hAt(baseH) - 1.2) : t * (hAt(baseH) - 1.6);
      const tz = sz !== 0 ? sz * (hAt(baseH) - 1.2) : t * (hAt(baseH) - 1.6);
      const wide = i === 0 || i === piers ? 3.4 : 2.1;
      k.beam(V(bx, -2, bz), V(tx, baseH + 0.2, tz), wide, wide * 0.9, W, 0.02, Pat.PLAIN, ax === 'z' ? V(1, 0, 0) : V(0, 0, 1));
    }
  }
  // a cornice band where the pyramid meets the base
  k.frustum(0, 0, baseH - 0.3, hAt(baseH) + 0.5, baseH + 1.6, hAt(baseH + 1.6) + 0.5, W, 0.08, Pat.PLAIN, false);
  // the wings: vertical shafts on the east and west faces, rising from the
  // 29th floor and standing proud of the slope near the top
  const wy0 = 124, wy1 = 214;
  const wOut = hAt(wy0) + 0.6;
  for (const s of [1, -1]) {
    const x0 = s > 0 ? 5 : -wOut, x1 = s > 0 ? wOut : -5;
    k.box(x0, wy0, -5.0, x1, wy1, 5.0, W, s > 0 ? -0.03 : 0.0, Pat.WINDOWS);
    // the wing roofs step down toward the spire
    k.box(s > 0 ? 5 : -wOut + 3, wy1, -4.2, s > 0 ? wOut - 3 : -5, wy1 + 4, 4.2, W, 0.05, Pat.PLAIN);
  }
  // the spire
  k.frustum(0, 0, yTopFloor, halfTop, 252, 0.9, W, 0.07, Pat.PLAIN, false);
  k.beam(V(0, 251, 0), V(0, 260, 0), 1.3, 0.6, W, 0.08, Pat.PLAIN);
  const mesh = k.build(PYRAMID_LOOK);
  const g = new THREE.Group();
  g.name = 'Transamerica';
  g.add(mesh);
  return g;
}
