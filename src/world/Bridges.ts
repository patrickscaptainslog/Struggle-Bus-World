import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { globals, GLSL_COMMON, GLSL_OUT, setVertexRamp, SHADOW_LAYER } from '../render/materials';
import { Ramp } from '../render/palette';
import { registerWarm } from '../render/warmup';
import { GLSL_LM_PAINT_FS, GLSL_LM_PAINT_VS, landmarkPaintUniforms, paintLandmark, type LandmarkLook, type LandmarkSurface, type SparkleSlices } from './props/landmarkPaint';
import { accentGeometry } from './props/landmarks';
import type { BuildingRef, City } from './City';

// Hand-built pixel landmarks: the Golden Gate Bridge (art-deco towers with
// stacked portal struts) and the Bay Bridge west span (X-braced towers, the
// big center anchorage). Chunky on purpose: at gameplay distance a cable is a
// pixel or two, so everything is sized to read as a silhouette in the fog.
//
// Every bridge the kit builds takes paint as a landmark does (landmarkPaint.ts,
// paintBridge): its parts carry what they are (Part), its boxes are what a breath
// lands on, seen from the bus's height (the open air under a deck is no surface,
// a cable too thin to see is none), and its levels are the landmarks' own:
//   level 1  the paint runs out along the bridge from where the breath hit, a
//            swell riding its front: the deck, the towers and the cables take
//            the hue (the Golden Gate's orange goes), the concrete white trim
//   level 2  a garden: vines up the towers and the piers, the deck's edges
//            planted along both rails and spilling down the truss
//   level 3  a rainbow road (six lanes, six hues), Hundertwasser's bands up the
//            towers and along the deck, golden crowns on the tower tops and
//            rainbow bunting strung along every main cable (accents that cost
//            nothing until then: the last vertices of the bridge's own meshes)
// Grey, the material writes what the plain ramp material wrote, to the byte.

type P2 = [number, number];
/** x, z and the top of the roadway (m ASL): one vertex of a deck, as city.json's landmark rows hold them. */
export type DeckPoint = [number, number, number];
/** x, z and its size across and along the deck (m): a plain block under a deck, as city.json's landmark rows hold them. */
export type Support = [number, number, number, number];

/**
 * One bridge's deck, from the one list its row holds: the mesh, the heights its towers and cables read and its collision
 * posts all go through this, so a deck and its collision can't part again. A station is metres along the polyline.
 */
class Deck {
  /** the station of each vertex */
  readonly s: number[] = [0];
  readonly length: number;

  constructor(readonly pts: DeckPoint[]) {
    for (let i = 1; i < pts.length; i++) this.s.push(this.s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.s[this.s.length - 1];
  }

  /** The station of the point of the deck's line nearest p. */
  stationOf(p: P2): number {
    let best = Infinity, at = 0;
    for (let i = 0; i + 1 < this.pts.length; i++) {
      const [ax, az] = this.pts[i], [bx, bz] = this.pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz)));
      const d = Math.hypot(ax + dx * t - p[0], az + dz * t - p[1]);
      if (d < best) {
        best = d;
        at = this.s[i] + (this.s[i + 1] - this.s[i]) * t;
      }
    }
    return at;
  }

  /** x, z and top at a station. */
  at(s: number): DeckPoint {
    let i = 0;
    while (i + 2 < this.pts.length && s > this.s[i + 1]) i++;
    const a = this.pts[i], b = this.pts[i + 1];
    const t = Math.min(1, Math.max(0, (s - this.s[i]) / (this.s[i + 1] - this.s[i])));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /** The local top under a point on the deck's line. */
  topAt(p: P2): number {
    return this.at(this.stationOf(p))[2];
  }

  /** The yaw of the deck going on from a station, as frame() gives it. */
  yawAt(s: number): number {
    const a = this.at(s), b = this.at(s + 1);
    return Math.atan2(b[0] - a[0], b[1] - a[1]);
  }

  /** out = [station, m left of the line] of (x, z), by the nearest span; past either end the end span runs on. */
  toFrame(x: number, z: number, out: number[]) {
    let best = Infinity;
    for (let i = 0; i + 1 < this.pts.length; i++) {
      const [ax, az] = this.pts[i], [bx, bz] = this.pts[i + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      const t = ((x - ax) * dx + (z - az) * dz) / (L * L);
      const tc = Math.min(i + 2 < this.pts.length ? 1 : Infinity, Math.max(i > 0 ? 0 : -Infinity, t));
      const d = Math.hypot(ax + dx * tc - x, az + dz * tc - z);
      if (d < best) {
        best = d;
        out[0] = this.s[i] + L * tc;
        out[1] = ((x - ax) * -dz + (z - az) * dx) / L;
      }
    }
  }

  /** The point at a station, `left` m left of the line (toFrame's inverse; past either end the end span runs on). */
  fromFrame(s: number, left: number): P2 {
    let i = 0;
    while (i + 2 < this.pts.length && s > this.s[i + 1]) i++;
    const [ax, az] = this.pts[i], [bx, bz] = this.pts[i + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    let nx = -dz / L, nz = dx / L;
    if (s === this.s[i + 1] && i + 2 < this.pts.length) {
      // (at a bend, the mitre: the outline's two spans meet there)
      const [cx, cz] = this.pts[i + 2], M = Math.hypot(cx - bx, cz - bz);
      const mx = nx - (cz - bz) / M, mz = nz + (cx - bx) / M, k = 1 / (mx * nx + mz * nz);
      nx = mx * k;
      nz = mz * k;
    }
    const t = (s - this.s[i]) / L;
    return [ax + dx * t + nx * left, az + dz * t + nz * left];
  }
}

/** What a part of a bridge is, for its paint (aPat.z: landmarkPaint's 0 is plain trim, its accents 20 and up). */
const enum Part {
  CONCRETE = 0, // piers, anchorages, the blocks the deck stands on: white trim, gilt at level 3
  STEEL = 9, // towers, struts, saddles: the hue, vines, bands up them
  DECK = 10, // the truss and its chords: aPat x m under the road, y the station
  ROAD = 11, // the roadway's top: aPat x 0..1 across, y the station, w its width
  CABLE = 12, // main cables and suspenders: aPat y the station (no surface to land on)
}

/** A kit part as a box in world space (its centre, unit axes and half sizes): what a breath lands on. */
interface Box {
  c: THREE.Vector3;
  ax: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  h: [number, number, number];
}

class Kit {
  parts: THREE.BufferGeometry[] = [];
  /** the boxes a breath can land on: every part but a cable */
  solids: Box[] = [];

  /** Oriented box between two 3D points (w across, h vertical-ish thickness). */
  beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, ramp: number, lo = 0, part = Part.STEEL) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 0.01) return;
    const g = new THREE.BoxGeometry(w, h, len);
    const m = new THREE.Matrix4();
    const z = d.clone().normalize();
    const up = Math.abs(z.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    m.makeBasis(x, y, z);
    const c = a.clone().add(b).multiplyScalar(0.5);
    m.setPosition(c);
    this.add(g, 2, () => g.applyMatrix4(m), ramp, lo, part, { c, ax: [x, y, z], h: [w / 2, h / 2, len / 2] });
  }

  /** Axis-aligned-in-bridge-frame box: center, half extents, yaw. */
  block(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw: number, ramp: number, lo = 0, part = Part.CONCRETE) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const ax: Box['ax'] = [new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))];
    this.add(g, 1, () => g.rotateY(yaw).translate(cx, cy, cz), ramp, lo, part, { c: new THREE.Vector3(cx, cy, cz), ax, h: [sx / 2, sy / 2, sz / 2] });
  }

  /**
   * A box part: its paint pattern (aPat) from its own frame before it moves (u across each face, m, at right angles to
   * `long`, its long axis: a beam's length, a block's height, so vines climb a tower and a beam's faces run along it),
   * then placed (as ever: the same float steps, so the same vertices). Every part but a cable is a solid.
   */
  private add(g: THREE.BoxGeometry, long: number, place: () => void, ramp: number, lo: number, part: Part, box: Box) {
    const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
    const pat = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
      const face = nx > 0.5 ? 0 : ny > 0.5 ? 1 : 2;
      const u = face === long ? (long === 0 ? 1 : 0) : 3 - face - long;
      const w = box.h[u] * 2;
      pat[i * 4] = (pos.getComponent(i, u) + box.h[u]) / w;
      pat[i * 4 + 2] = part;
      pat[i * 4 + 3] = w;
    }
    g.setAttribute('aPat', new THREE.BufferAttribute(pat, 4));
    place();
    this.parts.push(setVertexRamp(g.toNonIndexed(), ramp, lo));
    if (part !== Part.CABLE) this.solids.push(box);
  }

  /** The last part's paint pattern, from each vertex's world position and normal (the deck's, the cables'). */
  pattern(f: (p: THREE.Vector3, n: THREE.Vector3, out: number[]) => void) {
    const g = this.parts[this.parts.length - 1];
    const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), pat = g.getAttribute('aPat');
    const p = new THREE.Vector3(), n = new THREE.Vector3(), o = [0, 0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      o[0] = pat.getX(i);
      o[1] = pat.getY(i);
      o[2] = pat.getZ(i);
      o[3] = pat.getW(i);
      f(p.fromBufferAttribute(pos, i), n.fromBufferAttribute(nrm, i), o);
      pat.setXYZW(i, o[0], o[1], o[2], o[3]);
    }
  }

  /** The mesh, with its own paintable material; `look`'s level-3 accents go last, drawn only from level 3 on. */
  build(casts = true, look?: LandmarkLook): THREE.Mesh {
    const accents = look ? accentGeometry(look) : null;
    const start = this.parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
    if (accents) {
      // (the parts' layout: a box's uv, the ramp material's glow)
      const n = accents.getAttribute('position').count;
      accents.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      accents.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n), 1));
    }
    const geo = mergeGeometries(accents ? [...this.parts, accents] : this.parts, false)!;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    if (accents) {
      geo.userData.lmAccentStart = start;
      geo.setDrawRange(0, start);
    }
    const mesh = new THREE.Mesh(geo, bridgeMaterial(look));
    if (casts) mesh.layers.enable(SHADOW_LAYER);
    return mesh;
  }
}

const HUE_GLSL = { GREY: `${Ramp.GREY}.0`, GREY_LIGHT: `${Ramp.GREY_LIGHT}.0`, GREEN: `${Ramp.GREEN}.0` };

/**
 * The bridge material: grey, exactly the plain vertex-ramp material's arithmetic (its frames are the same to the byte);
 * painted, a landmark's (lmPaint), with the deck, its road and the cables in their own garden and bands (bridgePaint).
 * One program for every bridge, every level: accents and levels are uniforms and draw ranges.
 */
function bridgeMaterial(look: LandmarkLook = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...globals, ...landmarkPaintUniforms(look) },
    vertexShader: /* glsl */ `
      ${GLSL_COMMON}
      ${GLSL_LM_PAINT_VS}
      in float ramp;
      in float lightOffset;
      in vec4 aPat;
      flat out float vRamp;
      flat out float vType;
      out float vLightOffset;
      out vec4 vPat;
      out vec3 vWorldPos;
      out vec3 vWorldNormal;
      out vec3 vViewNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(lmVertex(position, aPat), 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
        vRamp = ramp;
        vLightOffset = lightOffset;
        vType = aPat.z;
        vPat = aPat;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${GLSL_LM_PAINT_FS}
      flat in float vRamp;
      flat in float vType;
      in float vLightOffset;
      in vec4 vPat;
      in vec3 vWorldPos;
      in vec3 vWorldNormal;
      in vec3 vViewNormal;
      ${GLSL_OUT}
      void turf(inout LmPaint o, vec3 wp, float hue, bool fl, float seed) {
        o.ramp = ${HUE_GLSL.GREEN};
        o.lo = -0.06 + (lmNoise(wp.xz * 0.45) - 0.5) * 0.18;
        if (fl && lmH21(floor(wp.xz / 2.0) + seed) > 0.8) { o.ramp = lmBloomHue(hue + 1.0); o.lo = 0.14; }
      }
      // the deck, its road and its cables painted (the towers and the concrete are lmPaint's walls and trim)
      void bridgePaint(inout LmPaint o, float type, float lo, vec4 pat, vec3 wp, float mpp) {
        float hue = vPaint.r;
        float L = floor(vPaint.g + 0.5);
        float seed = uLmBox.z;
        float s = pat.y;
        bool fl = mpp < 0.8;
        o.ramp = lmHue(hue);
        o.lo = lo * 0.8 + 0.03;
        o.mode = 1.0;
        o.glow = 0.0;
        if (type == ${Part.ROAD}.0) {
          // the road a step under the truss; at level 3 a rainbow road, six lanes in six hues, their edges in
          // Hundertwasser's waves; from level 2 both rails planted (m from the nearer edge)
          o.lo = lo * 0.8 - 0.02;
          if (L >= 3.0) {
            float wave = 0.07 * sin(s * 0.045 + seed) + 0.04 * sin(s * 0.13 + seed * 3.0);
            o.ramp = lmHue(hue + floor(clamp(pat.x + wave, 0.0, 0.999) * 6.0));
          }
          float e = min(pat.x, 1.0 - pat.x) * pat.w;
          if (L >= 2.0 && e < 2.4 + 1.1 * lmNoise(vec2(s * 0.12, seed))) turf(o, wp, hue, fl, seed);
        } else if (type == ${Part.DECK}.0) {
          // at level 3 Hundertwasser along the span, six hues in wavy bands down its length; from level 2 the
          // planted edge spills over, a hanging garden down the truss's face (m under the road), growing in
          if (L >= 3.0) {
            float wave = 7.0 * sin(pat.x * 0.5 + s * 0.011 + seed) + 4.0 * sin(s * 0.037 + seed * 2.0);
            o.ramp = lmHue(hue + floor((s + wave) / 36.0));
          }
          float grow = L < 2.5 ? clamp((uTime - vPaint.b) / 1.8, 0.0, 1.0) : 1.0;
          float hang = (1.2 + 3.6 * lmNoise(vec2(s * 0.16, seed + 2.0)) * lmNoise(vec2(s * 0.031, seed))) * grow;
          if (L >= 2.0 && pat.x < max(hang, mpp * 1.6 * grow)) turf(o, wp, hue, fl, seed);
        } else if (L >= 3.0) {
          // the cables: six hues along their length, under the bunting
          o.ramp = lmHue(hue + floor(s / 48.0));
        }
      }
      void main() {
        float ramp = floor(vRamp + 0.5);
        float lo = vLightOffset;
        float type = floor(vType + 0.5);
        vec3 n = normalize(vWorldNormal);
        if (!gl_FrontFacing) n = -n;
        // meters per screen pixel along the surface
        float mpp = max(max(fwidth(vWorldPos.x), fwidth(vWorldPos.z)), fwidth(vWorldPos.y));
        // (grey steel takes its hue like the rest: lmPaint's GREY is the pyramid's dark lobby)
        LmPaint lp = lmPaint(ramp == ${HUE_GLSL.GREY} ? ${HUE_GLSL.GREY_LIGHT} : ramp, lo, type, vPat, vWorldPos.y, vWorldPos, n, mpp);
        if (lp.mode < 0.5) lp.ramp = ramp;
        else if (type > ${Part.DECK}.0 - 0.5 && type < ${Part.CABLE}.0 + 0.5) bridgePaint(lp, type, lo, vPat, vWorldPos, mpp);
        float light = lp.mode > 1.5 ? lp.light : sbLight(vWorldPos, n, lp.lo, 1.0);
        // paint lives in the saturated middle of each ramp, as on the buildings
        if (lp.mode > 0.5 && lp.mode < 1.5) light = 0.2 + light * 0.52;
        // the aim glint after the mapping: a full ramp step, as on the buildings
        light += lp.glint;
        float fog = sbFog(vWorldPos);
        sbWrite(lp.ramp, light, fog, lp.glow, gl_FrontFacing ? vViewNormal : -vViewNormal, 0.5, 1.0);
      }
    `,
  });
}

function frame(a: P2, b: P2) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  // across = right of travel
  return { L, ux, uz, ax: -uz, az: ux, yaw: Math.atan2(ux, uz) };
}

/** A parabolic cable's height at t, from y0 to y1, sagY its height at mid span. */
function cableY(y0: number, y1: number, sagY: number, t: number) {
  const lin = y0 + (y1 - y0) * t;
  const depth = (y0 + y1) / 2 - sagY;
  return lin - depth * 4 * t * (1 - t);
}

/** Parabolic cable between two anchor points with a given low point. at(p): the station of a point, for its paint. */
function cable(k: Kit, a: THREE.Vector3, b: THREE.Vector3, sagY: number, segs: number, thick: number, ramp: number, lo: number, at: (p: THREE.Vector3) => number) {
  let prev = a.clone();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = a.clone().lerp(b, t);
    p.y = cableY(a.y, b.y, sagY, t);
    k.beam(prev, p, thick, thick, ramp, lo, Part.CABLE);
    k.pattern((q, _, o) => (o[1] = at(q)));
    prev = p;
  }
}

/** One band of a deck's section: its centre `depth` under the roadway, w across, h thick. under: its underside's light offset, where it has its own. */
interface DeckBand {
  depth: number;
  w: number;
  h: number;
  ramp: number;
  lo: number;
  under?: number;
}

/**
 * A deck's bands, span by span along its own line. Each span runs on past a joint between two: half a metre, so a slope change
 * leaves no crack in the frames, and, where the line bends in plan, as far as the band's edge needs to reach the next span's.
 */
function deckMesh(k: Kit, d: Deck, bands: DeckBand[]) {
  const P = d.pts;
  /** the line's bend at vertex i (rad) */
  const bend = (i: number) => {
    if (i < 1 || i + 1 >= P.length) return 0;
    const ax = P[i][0] - P[i - 1][0], az = P[i][1] - P[i - 1][1], bx = P[i + 1][0] - P[i][0], bz = P[i + 1][1] - P[i][1];
    return Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
  };
  for (let i = 0; i + 1 < P.length; i++) {
    // (the paint's frame on this span: the station along it, the road's top there, across it)
    const sx = P[i + 1][0] - P[i][0], sz = P[i + 1][1] - P[i][1], sl = Math.hypot(sx, sz);
    for (const { depth, w, h, ramp, lo, under } of bands) {
      const a = new THREE.Vector3(P[i][0], P[i][2] - depth, P[i][1]), b = new THREE.Vector3(P[i + 1][0], P[i + 1][2] - depth, P[i + 1][1]);
      const on = b.clone().sub(a).normalize();
      if (i > 0) a.addScaledVector(on, -0.5 - (w / 2) * Math.tan(bend(i) / 2));
      if (i + 2 < P.length) b.addScaledVector(on, 0.5 + (w / 2) * Math.tan(bend(i + 1) / 2));
      k.beam(a, b, w, h, ramp, lo, Part.DECK);
      // (a box's fourth face, -y, is the underside: six vertices, unindexed)
      if (under !== undefined) (k.parts[k.parts.length - 1].getAttribute('lightOffset').array as Float32Array).fill(under, 18, 24);
      // its paint: the road band's top is the road (x across it 0..1), the rest the deck (x m under the road); y the station
      const road = depth - h / 2 < 0.01;
      k.pattern((p, n, o) => {
        const s = d.s[i] + ((p.x - P[i][0]) * sx + (p.z - P[i][1]) * sz) / sl;
        if (road && n.y > 0.7) {
          o[0] = ((p.x - P[i][0]) * -sz + (p.z - P[i][1]) * sx) / sl / w + 0.5;
          o[2] = Part.ROAD;
          o[3] = w;
        } else {
          o[0] = Math.max(0, d.at(s)[2] - p.y);
          o[3] = 1;
        }
        o[1] = s;
      });
    }
  }
}

/** One span of a suspension cable: between pts[a] and pts[b], from y0 to y1, sagY at mid span. n: its suspender bays. */
interface CableSpan {
  a: number;
  b: number;
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  sagY: number;
  n: number;
}

/**
 * A bridge's runs of cable, each [end, tower, tower, end] in pts. Each span's ends and sag read the deck under it. A main span's
 * low point rides 5 m over the deck's middle; a side span hangs in the same cable at the same tension, so its sag goes with its
 * span squared, shallow enough that it never dips to the deck. end(i, top): the cable's height at end i, the deck's top there.
 */
function cableSpans(d: Deck, pts: P2[], runs: number[][], saddle: number, end: (i: number, top: number) => number): CableSpan[] {
  const s = pts.map((p) => d.stationOf(p));
  const endY = (i: number) => end(i, d.at(s[i])[2]);
  const span = (a: number, b: number, y0: number, y1: number, sagY: number): CableSpan => ({ a, b, s0: s[a], s1: s[b], y0, y1, sagY, n: Math.floor((s[b] - s[a]) / 48) });
  const out: CableSpan[] = [];
  for (const [a, t1, t2, b] of runs) {
    const mainL = s[t2] - s[t1];
    const low = d.at((s[t1] + s[t2]) / 2)[2] + 5;
    const side = (i: number, j: number, y0: number, y1: number) => span(i, j, y0, y1, (y0 + y1) / 2 - (saddle - low) * ((s[j] - s[i]) / mainL) ** 2);
    out.push(side(a, t1, endY(a), saddle), span(t1, t2, saddle, saddle, low), side(t2, b, saddle, endY(b)));
  }
  return out;
}

/**
 * One span's cable, pa to pb, with a suspender every bay (every ~48 m, 1.2 m thick, so at the opening's distances they are a steady
 * 1-2 game pixels instead of 0.3-0.8 px lines that flickered in and out): each bay is a segment of the cable, so a suspender always
 * meets it. The cable goes in `wires`, a kit that casts no shadow: in the low sun its shadow lay along the deck as a wide stepped smear.
 */
function hangSpan(k: Kit, wires: Kit, d: Deck, c: CableSpan, pa: THREE.Vector3, pb: THREE.Vector3, thick: number, ramp: number, lo: number) {
  // (a cable's paint runs along it by the deck's stations, from the span's ends)
  const at = (q: THREE.Vector3) => c.s0 + (c.s1 - c.s0) * Math.min(1, Math.max(0, q.clone().sub(pa).setY(0).length() / Math.hypot(pb.x - pa.x, pb.z - pa.z)));
  cable(wires, pa, pb, c.sagY, c.n, thick, ramp, lo, at);
  for (let i = 1; i < c.n; i++) {
    const t = i / c.n;
    const p = pa.clone().lerp(pb, t);
    const foot = d.at(c.s0 + (c.s1 - c.s0) * t)[2] - 0.5;
    k.beam(new THREE.Vector3(p.x, foot, p.z), new THREE.Vector3(p.x, cableY(c.y0, c.y1, c.sagY, t), p.z), 1.2, 1.2, ramp, 0.04, Part.CABLE);
    k.pattern((_, __, o) => (o[1] = c.s0 + (c.s1 - c.s0) * t));
  }
}

/** A span's bunting, its cable's own curve hung 1.4 m under it (the cable's sag is the bunting's): level 3's. */
function spanBunting(c: CableSpan, pa: THREE.Vector3, pb: THREE.Vector3): NonNullable<LandmarkLook['bunting']>[number] {
  return { from: [pa.x, c.y0 - 1.4, pa.z], to: [pb.x, c.y1 - 1.4, pb.z], sag: (c.y0 + c.y1) / 2 - c.sagY, size: 2.4 };
}

/** The height of the cable over a station, else -Infinity. */
const cableOver = (spans: CableSpan[]) => (s: number) => {
  const c = spans.find((q) => s >= q.s0 && s <= q.s1);
  return c ? cableY(c.y0, c.y1, c.sagY, (s - c.s0) / (c.s1 - c.s0)) : -Infinity;
};

/** The Golden Gate's sizes, the mesh's and the collision's: anchorages as across, along, from their OSM rows. */
const GGB = { half: 13.5, thick: 8, towerH: 227, anchorages: [[39.6, 101.1], [47.9, 109.2]] };

/** Its one run of cable, anchorage to anchorage. */
function ggCables(d: Deck, pts: P2[]): CableSpan[] {
  return cableSpans(d, pts, [[0, 1, 2, 3]], GGB.towerH + 2, (_, top) => top + 3);
}

/**
 * What its deck stands on away from the towers: the anchorages, each the size of its OSM row with its flat top just under the road
 * at the block's low end, and the plain supports, each just into the deck's underside. All in the deck's own line.
 */
function ggBlocks(d: Deck, pts: P2[], supports: Support[]) {
  const block = (p: P2, across: number, along: number, under: number) => {
    const s = d.stationOf(p);
    return { p, across, along, yaw: d.yawAt(s), top: Math.min(d.at(s - along / 2)[2], d.at(s + along / 2)[2]) - under };
  };
  const [[a0, l0], [a1, l1]] = GGB.anchorages;
  return [block(pts[0], a0, l0, 0.3), block(pts[3], a1, l1, 0.3), ...supports.map(([x, z, across, along]) => block([x, z], across, along, GGB.thick - 0.3))];
}

export function makeGoldenGate(pts: P2[], deck: DeckPoint[], supports: Support[]): THREE.Object3D {
  // pts, from OSM's rows: south anchorage, south tower, north tower, north anchorage; deck: from the Presidio through them all to Marin
  const k = new Kit(), wires = new Kit();
  const d = new Deck(deck);
  const [A0, T1, T2, A1] = pts;
  const f = frame(A0, A1);
  const { half, thick, towerH } = GGB;
  const legOff = half + 2.5;
  // International Orange in the grey world: one muted warm landmark whose shadows go rose and plum; the fog turns it
  // pale rust at range. Painted, it goes: the paint is the only saturated thing. Piers and anchorages are concrete.
  const G = Ramp.BRIDGE_ORANGE;
  const GL = Ramp.BRIDGE_ORANGE;
  const C = Ramp.GREY_LIGHT;
  const at = (p: P2, along: number, across: number, y: number) => new THREE.Vector3(p[0] + f.ux * along + f.ax * across, y, p[1] + f.uz * along + f.az * across);
  // its paint: the landmarks' levels, lit tower tops, vines up the towers; level 3's crowns and bunting are added below
  const look: LandmarkLook = { ...BRIDGE_LOOK, glowFrom: towerH - 10, domes: [], bunting: [] };

  // deck, stiffening truss and all, along its own line. The roadway on top is asphalt grey; the truss and its chords are the
  // orange, and read as a light top chord over a dark lattice band
  deckMesh(k, d, [
    { depth: 4.1, w: half * 2, h: 6.6, ramp: G, lo: -0.06 },
    { depth: 0.4, w: half * 2 - 1, h: 0.8, ramp: Ramp.GREY, lo: -0.02 },
    { depth: thick - 0.7, w: half * 2 + 0.6, h: 1.4, ramp: G, lo: -0.22, under: 0.1 },
    { depth: 1.4, w: half * 2 + 0.8, h: 1.2, ramp: GL, lo: 0.04 },
  ]);

  for (const T of [T1, T2]) {
    const top = d.topAt(T);
    // pier
    k.block(T[0], 6, T[1], 44, 18, 30, f.yaw, C, -0.08);
    for (const side of [-1, 1]) {
      // stepped art-deco leg: four setbacks
      const levels = [
        [0, 60, 11.5, 15],
        [60, 120, 10, 13],
        [120, 175, 8.6, 11.5],
        [175, towerH, 7.4, 10],
      ];
      for (const [y0, y1, w, dd] of levels) {
        const c = at(T, 0, side * legOff, (y0 + y1) / 2);
        k.block(c.x, c.y, c.z, dd, y1 - y0, w, f.yaw + Math.PI / 2, G, 0.02, Part.STEEL);
      }
      // the cable saddle on top, and on it level 3's golden crown
      const saddle = at(T, 0, side * legOff, towerH + 3);
      k.block(saddle.x, saddle.y, saddle.z, 6, 6, 8, f.yaw, G, 0.04, Part.STEEL);
      look.domes!.push([saddle.x, towerH + 6, saddle.z, 4.4]);
    }
    // portal struts above the deck + one below
    for (const [y, h] of [[top - 22, 7], [top + 38, 7], [top + 82, 6.5], [top + 120, 6], [towerH - 8, 8]] as Array<[number, number]>) {
      const a = at(T, 0, -legOff, y), b = at(T, 0, legOff, y);
      k.beam(a, b, 7, h, G, 0.0);
    }
  }

  // main cables + suspenders, straight over the deck's edges, landing on saddles at the anchorages
  const off = half + 0.5;
  for (const side of [-1, 1]) {
    for (const A of [A0, A1]) {
      const c = at(A, 0, side * off, d.topAt(A) + 1.75);
      k.block(c.x, c.y, c.z, 4, 4.5, 6, f.yaw, C, 0.02);
    }
    for (const c of ggCables(d, pts)) {
      const pa = at(pts[c.a], 0, side * off, c.y0), pb = at(pts[c.b], 0, side * off, c.y1);
      hangSpan(k, wires, d, c, pa, pb, 1.8, GL, 0.1);
      look.bunting!.push(spanBunting(c, pa, pb));
    }
  }
  // what the deck stands on: the anchorages' blocks and the approaches' supports
  for (const { p, across, along, yaw, top } of ggBlocks(d, pts, supports)) k.block(p[0], top / 2, p[1], across, top, along, yaw, C, -0.05);
  return bridgeGroup(k, wires, look, { deck: d, towers: [T1, T2], towerH });
}

/** The Bay Bridge's sizes, the mesh's and the collision's. w1: W1's vertex in the deck list. */
const BAY = { half: 12, thick: 10, towerH: 160, anchorTop: 91, anchorY: 88, towers: [1, 2, 4, 5], w1: 3 };

/** Its two runs of cable, end block to anchorage to end block. */
function bayCables(d: Deck, pts: P2[]): CableSpan[] {
  return cableSpans(d, pts, [[0, 1, 2, 3], [3, 4, 5, 6]], BAY.towerH + 1, (i, top) => (i === 3 ? BAY.anchorY : top + 3));
}

/**
 * What the deck stands on at W1, the cables' west end (w236373807) and W7: each the size of its OSM row, across and along the
 * deck, its flat top just under the road at the block's low end; and the plain supports, each just into the deck's underside.
 */
function bayBlocks(d: Deck, pts: P2[], supports: Support[]) {
  const block = (p: P2, across: number, along: number, under: number) => {
    const s = d.stationOf(p);
    return { p, across, along, top: Math.min(d.at(s - along / 2)[2], d.at(s + along / 2)[2]) - under };
  };
  return [block([d.pts[BAY.w1][0], d.pts[BAY.w1][1]], 30, 50, 0.3), block(pts[0], 33, 11, 0.3), block(pts[6], 33, 39, 0.3), ...supports.map(([x, z, across, along]) => block([x, z], across, along, BAY.thick - 0.3))];
}

export function makeBayBridgeWest(pts: P2[], deck: DeckPoint[], supports: Support[]): THREE.Object3D {
  // pts, as OSM refs them: the cables' west end, W2, W3, center anchorage W4, W5, W6, W7; deck: from the hillside, through W1 and them all, to the island
  const k = new Kit(), wires = new Kit();
  const d = new Deck(deck);
  const f = frame(pts[0], pts[pts.length - 1]);
  const { half, thick, towerH } = BAY;
  const legOff = half + 2;
  const G = Ramp.GREY;
  const GL = Ramp.GREY_LIGHT;
  const at = (p: P2, along: number, across: number, y: number) => new THREE.Vector3(p[0] + f.ux * along + f.ax * across, y, p[1] + f.uz * along + f.az * across);
  // its paint, as the Golden Gate's; level 3's crowns on every leg and on the center anchorage
  const look: LandmarkLook = { ...BRIDGE_LOOK, glowFrom: towerH - 10, domes: [], bunting: [] };
  // double-deck truss, along the deck's own line
  deckMesh(k, d, [
    { depth: (thick + 1) / 2, w: half * 2, h: thick - 1, ramp: G, lo: -0.08 },
    { depth: 0.5, w: half * 2 - 1, h: 1, ramp: GL, lo: -0.02 },
  ]);
  for (const ti of BAY.towers) {
    const T = pts[ti];
    k.block(T[0], 5, T[1], 36, 16, 26, f.yaw, GL, -0.08);
    for (const side of [-1, 1]) {
      const a = at(T, 0, side * legOff, 0), b = at(T, 0, side * legOff * 0.82, towerH);
      k.beam(a, b, 6.5, 6.5, G, 0.02);
      look.domes!.push([b.x, towerH, b.z, 3.6]);
    }
    // X bracing between the legs at three levels, from over the deck here to the top
    const low = d.topAt(T) + 10, high = towerH - 4;
    const levels = [low, low + (high - low) * 0.4, low + (high - low) * 0.77, high];
    for (let i = 0; i < levels.length - 1; i++) {
      const y0 = levels[i], y1 = levels[i + 1];
      const w0 = legOff * (1 - 0.18 * (y0 / towerH)), w1 = legOff * (1 - 0.18 * (y1 / towerH));
      k.beam(at(T, 0, -w0, y0), at(T, 0, w1, y1), 2.6, 2.6, G, -0.02);
      k.beam(at(T, 0, w0, y0), at(T, 0, -w1, y1), 2.6, 2.6, G, -0.02);
      k.beam(at(T, 0, -w1, y1), at(T, 0, w1, y1), 3.2, 3.2, G, 0.0);
    }
  }
  // center anchorage: a massive concrete block rising above the deck, as long and wide as OSM's W4
  const C = pts[3];
  k.block(C[0], 42.5, C[1], 40, 85, 69, f.yaw, GL, -0.04);
  k.block(C[0], (85 + BAY.anchorTop) / 2, C[1], 30, BAY.anchorTop - 85, 55, f.yaw, GL, 0.02);
  look.domes!.push([C[0], BAY.anchorTop, C[1], 9]);
  for (const { p, across, along, top } of bayBlocks(d, pts, supports)) k.block(p[0], top / 2, p[1], across, top, along, f.yaw, GL, -0.04);
  // the two runs of cable, straight over the deck's edges, with suspenders on every span
  const off = legOff * 0.84;
  for (const side of [-1, 1]) {
    for (const i of [0, 6]) {
      // the saddles the cables land on at the two ends
      const c = at(pts[i], 0, side * off, d.topAt(pts[i]) + 1.75);
      k.block(c.x, c.y, c.z, 4, 4.5, 6, f.yaw, GL, 0.02);
    }
    for (const c of bayCables(d, pts)) {
      const pa = at(pts[c.a], 0, side * off, c.y0), pb = at(pts[c.b], 0, side * off, c.y1);
      hangSpan(k, wires, d, c, pa, pb, 1.6, GL, 0.05);
      look.bunting!.push(spanBunting(c, pa, pb));
    }
  }
  return bridgeGroup(k, wires, look, { deck: d, towers: BAY.towers.map((i) => pts[i]), towerH });
}

/** How fast a bridge's paint runs out along it from where the breath hit (m/s): the Golden Gate's 2.7 km in about 3 s. */
export const BRIDGE_RUN = 520;

/** Every bridge's paint (Kit.build's look), with its own tower tops' glow, crowns and bunting added. */
const BRIDGE_LOOK: LandmarkLook = { vines: 0.5, band: 14, run: BRIDGE_RUN, ripple: 1.6, buntingFromEnds: true };

/** What paintBridge needs of a bridge the kit built: its deck, its boxes, its towers. */
interface BridgeShape {
  deck: Deck;
  towers: P2[];
  towerH: number;
}

/** The bridge's two meshes (the cables cast no shadow): the crowns on the solid one, the bunting on the cables'. */
function bridgeGroup(k: Kit, wires: Kit, look: LandmarkLook, shape: BridgeShape): THREE.Group {
  const g = new THREE.Group();
  g.add(k.build(true, { ...look, bunting: undefined }), wires.build(false, { ...look, domes: undefined }));
  g.userData.bridge = { ...shape, solids: k.solids };
  return g;
}

/**
 * Make a bridge the kit built a first-class paintable landmark (landmarkPaint.ts) under `key`, its paint saved under it:
 * its ring the outline of what stands (the deck, wider at the towers and the blocks), its surface its boxes seen from a
 * height, its sparkles along the deck and up the towers. Call once, after the landmarks that held their slots before
 * it (slots are handed out in call order). Returns the ref, or null.
 */
export function paintBridge(city: City, key: string, obj: THREE.Object3D, name: string): BuildingRef | null {
  const b = obj.userData.bridge as (BridgeShape & { solids: Box[] }) | undefined;
  if (!b) return null;
  // (a blast's wave reaches a bridge from far: its run starts where that breath came down)
  return paintLandmark(city, key, obj, { name, surface: bridgeSurface(b.deck, b.solids, b.towers, b.towerH), hitReach: 160 });
}

/** The vertical line through (x, z) inside box b: out = [bottom, top] (m), or false. */
function boxSpan(b: Box, x: number, z: number, out: number[]): boolean {
  let lo = -Infinity, hi = Infinity;
  const dx = x - b.c.x, dz = z - b.c.z;
  for (let i = 0; i < 3; i++) {
    const A = b.ax[i], h = b.h[i];
    const q = A.x * dx + A.z * dz;
    if (Math.abs(A.y) < 1e-6) {
      if (Math.abs(q) > h) return false;
      continue;
    }
    const t0 = (-h - q) / A.y, t1 = (h - q) / A.y;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi) return false;
  }
  out[0] = b.c.y + lo;
  out[1] = b.c.y + hi;
  return true;
}

/** Height-field cells (m): what a breath lands on, by 2 m square. */
const CELL = 2;
const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

/**
 * A bridge's surface from its boxes: per 2 m cell, the spans of solid over it ([bottom, top], merged where they touch),
 * so a breath seen from fromY lands on the highest top whose bottom is at or under fromY: from over a deck on it, from
 * under it on what is below. Its ring: the deck's line, as wide as what stands at each station. Its sparkles: slices
 * along the deck and up the towers. Built once, when it is made paintable.
 */
function bridgeSurface(d: Deck, solids: Box[], towers: P2[], towerH: number): LandmarkSurface {
  const lists = new Map<number, number[]>();
  const span = [0, 0], hit = [0, 0];
  const corner = new THREE.Vector3();
  const corners = (b: Box, f: (p: THREE.Vector3) => void) => {
    for (let k = 0; k < 8; k++) {
      corner.copy(b.c);
      for (let i = 0; i < 3; i++) corner.addScaledVector(b.ax[i], (k >> i) & 1 ? b.h[i] : -b.h[i]);
      f(corner);
    }
  };
  let top = -Infinity;
  for (const b of solids) {
    // (a long beam in pieces along its length: its plan bounds alone would be a square kilometre of open water)
    const long = b.h[0] * Math.hypot(b.ax[0].x, b.ax[0].z) > b.h[2] * Math.hypot(b.ax[2].x, b.ax[2].z) ? 0 : 2;
    const pieces = Math.max(1, Math.ceil((2 * b.h[long]) / 8));
    for (let k = 0; k < pieces; k++) {
      const piece: Box = { c: b.c.clone().addScaledVector(b.ax[long], ((k + 0.5) / pieces - 0.5) * 2 * b.h[long]), ax: b.ax, h: [...b.h] as Box['h'] };
      piece.h[long] = b.h[long] / pieces;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      corners(piece, (p) => {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.z);
        z1 = Math.max(z1, p.z);
        top = Math.max(top, p.y);
      });
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++)
        for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
          // (four points a cell: a 2.6 m brace across a cell's corner still lands)
          let lo = Infinity, hi = -Infinity;
          for (let q = 0; q < 4; q++) {
            if (!boxSpan(piece, (i + 0.25 + 0.5 * (q & 1)) * CELL, (j + 0.25 + 0.5 * (q >> 1)) * CELL, hit)) continue;
            lo = Math.min(lo, hit[0]);
            hi = Math.max(hi, hit[1]);
          }
          if (lo > hi) continue;
          const key = cellKey(i, j);
          let l = lists.get(key);
          if (!l) lists.set(key, (l = []));
          l.push(lo, hi);
        }
    }
  }
  // packed: per cell its count, then its merged spans, bottom first
  const cells = new Map<number, number>();
  const packed: number[] = [];
  for (const [key, l] of lists) {
    const order = Array.from({ length: l.length / 2 }, (_, i) => i).sort((a, b) => l[a * 2] - l[b * 2]);
    const at = packed.length;
    packed.push(0);
    for (const i of order) {
      const n = packed.length;
      if (n > at + 1 && l[i * 2] <= packed[n - 1] + 0.75) packed[n - 1] = Math.max(packed[n - 1], l[i * 2 + 1]);
      else packed.push(l[i * 2], l[i * 2 + 1]);
    }
    packed[at] = (packed.length - at - 1) / 2;
    cells.set(key, at);
  }
  const iv = new Float32Array(packed);
  const heightAt = (x: number, z: number, fromY = Infinity): number => {
    const o = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (o === undefined) return -Infinity;
    let y = -Infinity;
    for (let i = 0, n = iv[o]; i < n; i++) if (iv[o + 1 + i * 2] <= fromY && iv[o + 2 + i * 2] > y) y = iv[o + 2 + i * 2];
    return y;
  };

  // the ring: along the deck's line (on past its ends where a block does), as wide as what stands at each station
  const reach: Array<[number, number, number]> = solids.map((b) => {
    let s0 = Infinity, s1 = -Infinity, w = 0;
    corners(b, (p) => {
      d.toFrame(p.x, p.z, span);
      s0 = Math.min(s0, span[0]);
      s1 = Math.max(s1, span[0]);
      w = Math.max(w, Math.abs(span[1]));
    });
    return [s0, s1, w + 0.5];
  });
  const widthAt = (s: number) => {
    let w = 0;
    for (const [s0, s1, r] of reach) if (s >= s0 && s <= s1 && r > w) w = r;
    return w;
  };
  const stations = new Set<number>();
  const sMin = Math.min(...reach.map((r) => r[0])), sMax = Math.max(...reach.map((r) => r[1]));
  for (let s = sMin; s < sMax; s += 4) stations.add(s);
  for (const [s0, s1] of reach) for (const s of [s0 - 0.01, s0 + 0.01, s1 - 0.01, s1 + 0.01]) if (s >= sMin && s <= sMax) stations.add(s);
  for (const s of d.s) if (s >= sMin && s <= sMax) stations.add(s);
  stations.add(sMax);
  const ss = [...stations].sort((a, b) => a - b).filter((s) => widthAt(s) > 0);
  const left = ss.map((s) => d.fromFrame(s, widthAt(s)));
  const right = ss.map((s) => d.fromFrame(s, -widthAt(s))).reverse();
  const ring = simplifyRing([...left, ...right]);

  // sparkles: slices along the deck, over the road, and up each tower
  const sparkles: SparkleSlices = [];
  const n = Math.max(2, Math.round(d.length / 180));
  for (let k = 0; k < n; k++) {
    const [x, z, y] = d.at(((k + 0.5) / n) * d.length);
    sparkles.push({ center: new THREE.Vector3(x, y + 8, z), radius: 22, height: 16 });
  }
  for (const [x, z] of towers) for (let k = 0; k < 3; k++) sparkles.push({ center: new THREE.Vector3(x, (towerH * (k + 1)) / 3, z), radius: 24, height: towerH / 3 });
  return { ring, top, heightAt, sparkles };
}

/** A ring with every point that lies on the line through its neighbours (within 5 cm) taken out. */
function simplifyRing(r: P2[]): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = out.length ? out[out.length - 1] : r[r.length - 1], b = r[i], c = r[(i + 1) % r.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const off = L > 1e-6 ? Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / L : 0;
    if (off > 0.05) out.push(b);
  }
  return out;
}

/** Collision volumes for the flight model: vertical "posts" along the deck
 * (cable height + margin above, deck underside below, so the bus can still
 * glide UNDER a deck but never over it through cables or towers). Under a deck
 * the hard floor reads no post and Flight.underDeck() only turns the bus away,
 * so a stick held through the turn-out can still carry it into a block. */
export interface ObstaclePost {
  x: number;
  z: number;
  r: number;
  top: number;
  /** below this altitude the post doesn't apply (the open air under a deck); -Infinity = solid to the ground */
  under: number;
  /** a deck post's roadway + 1.5 m: as high as the hard floor reads it, the cable's clearance is the soft floor's */
  hard?: number;
}

/**
 * A post every 12 m or less along a whole deck, each as wide as the deck plus 6 m. `over(s)`: the height of a cable running over
 * station s, else -Infinity. Its top stands over that cable, or just over the roadway; below `under`, the open air under the deck.
 */
function deckPosts(d: Deck, half: number, thick: number, over: (s: number) => number): ObstaclePost[] {
  const out: ObstaclePost[] = [];
  const n = Math.ceil(d.length / 12);
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * d.length;
    const [x, z, top] = d.at(s);
    out.push({ x, z, r: half + 6, top: Math.max(top + 1.5, over(s) + 5), under: top - thick - 1, hard: top + 1.5 });
  }
  return out;
}

export function bridgeObstacles(kind: 'ggb' | 'baybridge', pts: P2[], deck: DeckPoint[], supports: Support[] = []): ObstaclePost[] {
  const d = new Deck(deck);
  if (kind === 'baybridge') {
    const out = deckPosts(d, BAY.half, BAY.thick, cableOver(bayCables(d, pts)));
    for (const ti of BAY.towers) out.push({ x: pts[ti][0], z: pts[ti][1], r: 30, top: BAY.towerH + 8, under: -Infinity });
    out.push({ x: pts[3][0], z: pts[3][1], r: 40, top: BAY.anchorTop + 4, under: -Infinity });
    // (the open air under the deck stops at the blocks it stands on)
    for (const { p, across, along, top } of bayBlocks(d, pts, supports)) out.push({ x: p[0], z: p[1], r: Math.hypot(across, along) / 2, top: top + 2, under: -Infinity });
    return out;
  }
  const out = deckPosts(d, GGB.half, GGB.thick, cableOver(ggCables(d, pts)));
  for (const T of [pts[1], pts[2]]) out.push({ x: T[0], z: T[1], r: 30, top: GGB.towerH + 8, under: -Infinity });
  // (the open air under the deck stops at the blocks it stands on; a long one takes a row of posts, no circle far wider than it)
  for (const { p, across, along, yaw, top } of ggBlocks(d, pts, supports)) {
    const n = Math.ceil(along / across);
    for (let i = 0; i < n; i++) {
      const c = ((i + 0.5) / n - 0.5) * along;
      out.push({ x: p[0] + Math.sin(yaw) * c, z: p[1] + Math.cos(yaw) * c, r: Math.hypot(across, along / n) / 2, top: top + 2, under: -Infinity });
    }
  }
  return out;
}

/**
 * A span's lights (SKY.md 4.4), x, y, z a light, from the one deck list and the sizes above: every `spacing` m along the roadway at deck height, on both sides just past its
 * edge, so they show from over and under it, and one on each tower top: on both its legs, seen from the side one hides what stands on the strut between them. Only the held hour asks.
 */
export function bridgeLights(kind: 'ggb' | 'baybridge', pts: P2[], deck: DeckPoint[], spacing: number, steps?: number[]): number[] {
  // (steps: each light's place in its painted bridge's rainbow, a hue step 0-5: the next hue every light down the deck)
  const d = new Deck(deck);
  const gg = kind === 'ggb';
  const edge = (gg ? GGB.half : BAY.half) + 1.5;
  const out: number[] = [];
  const n = Math.ceil(d.length / Math.max(1, spacing));
  for (let k = 0; k < n; k++) {
    const s = ((k + 0.5) / n) * d.length;
    const [x, z, top] = d.at(s);
    const yaw = d.yawAt(s);
    for (const side of [-1, 1]) {
      out.push(x - Math.cos(yaw) * edge * side, top + 1.5, z + Math.sin(yaw) * edge * side);
      steps?.push(k % 6);
    }
  }
  const f = frame(pts[0], pts[pts.length - 1]);
  const leg = gg ? GGB.half + 2.5 : (BAY.half + 2) * 0.82;
  for (const t of gg ? [pts[1], pts[2]] : BAY.towers.map((i) => pts[i]))
    for (const side of [-1, 1]) {
      out.push(t[0] + f.ax * leg * side, gg ? GGB.towerH + 7 : BAY.towerH + 1.5, t[1] + f.az * leg * side);
      steps?.push(2);
    }
  return out;
}

// Shader warm-up (render/warmup.ts): a bridge as the kit builds one, with its accents (the Bay Bridge is
// built after the first frame, see main.ts; every level of every bridge is this one program)
registerWarm('bridges', () => {
  const k = new Kit();
  k.block(0, 0, 0, 1, 1, 1, 0, Ramp.GREY);
  return k.build(true, { ...BRIDGE_LOOK, domes: [[0, 1, 0, 1]] });
});
