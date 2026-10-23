import * as THREE from 'three';

// Build-time helper: appends transformed box / prism geometries into one big
// indexed BufferGeometry with the per-vertex attributes makeRampMaterial's
// vertexRamp path reads (ramp, lightOffset, glow) plus `uv`, which the bus
// re-purposes as (part id, part parameter) for its vertex animation.
// Only used while constructing the model; allocations here are fine.

export type ParamFn = (x: number, y: number, z: number) => number;

export interface PartOpts {
  ramp: number;
  /** Per-vertex light offset (+ brighter). */
  lo?: number;
  /** Per-vertex glow 0..1. */
  glow?: number;
  /** Animated part id (see BusModel PART). */
  part?: number;
  /** Part parameter (hinge coordinate, slice position, ...), constant or per vertex. */
  param?: number | ParamFn;
  /** Subdivisions along Z (long parts must bend with the body's sag / gag bulge). */
  segZ?: number;
}

export class PartBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uvs: number[] = [];
  private readonly ramps: number[] = [];
  private readonly los: number[] = [];
  private readonly glows: number[] = [];
  private readonly idx: number[] = [];
  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly nm = new THREE.Matrix3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  /** Added to every y after transforming (moves the model origin). */
  offsetY = 0;

  /** Push a transform (multiplied onto the current one). */
  push(m: THREE.Matrix4): this {
    this.stack.push(this.top().clone().multiply(m));
    return this;
  }

  /** Push translate + euler rotation (XYZ order, radians). */
  pushAt(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    return this.push(this.trs(x, y, z, rx, ry, rz, 1, 1, 1));
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  private top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  trs(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
    this.e.set(rx, ry, rz, 'XYZ');
    this.q.setFromEuler(this.e);
    this.t.set(x, y, z);
    this.s.set(sx, sy, sz);
    return new THREE.Matrix4().compose(this.t, this.q, this.s);
  }

  /** Append a geometry transformed by (current stack * local). Disposes `geo`. */
  add(geo: THREE.BufferGeometry, local: THREE.Matrix4 | null, o: PartOpts): this {
    const m = local ? this.top().clone().multiply(local) : this.top();
    this.nm.getNormalMatrix(m);
    const P = geo.getAttribute('position');
    const N = geo.getAttribute('normal');
    const base = this.pos.length / 3;
    const flip = m.determinant() < 0;
    for (let i = 0; i < P.count; i++) {
      this.v.fromBufferAttribute(P, i).applyMatrix4(m);
      this.n.fromBufferAttribute(N, i).applyMatrix3(this.nm).normalize();
      const x = this.v.x;
      const y = this.v.y + this.offsetY;
      const z = this.v.z;
      this.pos.push(x, y, z);
      this.nor.push(this.n.x, this.n.y, this.n.z);
      const param = typeof o.param === 'function' ? o.param(x, y, z) : (o.param ?? 0);
      this.uvs.push(o.part ?? 0, param);
      this.ramps.push(o.ramp);
      this.los.push(o.lo ?? 0);
      this.glows.push(o.glow ?? 0);
    }
    const index = geo.getIndex();
    const count = index ? index.count : P.count;
    for (let i = 0; i < count; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      if (flip) this.idx.push(base + a, base + c, base + b);
      else this.idx.push(base + a, base + b, base + c);
    }
    geo.dispose();
    return this;
  }

  /** Axis-aligned box (in the current frame) centred at (cx,cy,cz), optional euler rotation about its centre. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, o: PartOpts, rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.BoxGeometry(sx, sy, sz, 1, 1, o.segZ ?? 1), this.trs(cx, cy, cz, rx, ry, rz, 1, 1, 1), o);
  }

  /** Box given by min/max corners. */
  boxMM(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: PartOpts): this {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), o);
  }

  /**
   * Prism (cylinder) with `seg` sides. axis: 'x' | 'y' | 'z'. `spin` rotates
   * it about its own axis (e.g. PI/8 puts a flat edge on top of an octagon).
   */
  prism(cx: number, cy: number, cz: number, r: number, len: number, seg: number, axis: 'x' | 'y' | 'z', o: PartOpts, spin = 0): this {
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false, spin);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    else if (axis === 'z') g.rotateX(Math.PI / 2);
    return this.add(g, this.trs(cx, cy, cz, 0, 0, 0, 1, 1, 1), o);
  }

  /**
   * Convex cross-section `pts` (x, y pairs, counter-clockwise seen from +Z)
   * extruded along Z from z0 to z1, flat-shaded facets (each facet lights as
   * its own band — the pixel-art way to say "rounded").
   */
  extrudeZ(pts: ReadonlyArray<readonly [number, number]>, z0: number, z1: number, o: PartOpts): this {
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], nx: number, ny: number, nz: number) => {
      const i = pos.length / 3;
      pos.push(...a, ...b, ...c, ...d);
      for (let k = 0; k < 4; k++) nor.push(nx, ny, nz);
      idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    const n = pts.length;
    const segs = Math.max(1, o.segZ ?? 1);
    for (let k = 0; k < n; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[(k + 1) % n];
      const ex = x1 - x0;
      const ey = y1 - y0;
      const l = Math.hypot(ex, ey) || 1;
      // outward normal of a CCW polygon edge
      for (let j = 0; j < segs; j++) {
        const za = z0 + ((z1 - z0) * j) / segs;
        const zb = z0 + ((z1 - z0) * (j + 1)) / segs;
        quad([x0, y0, za], [x1, y1, za], [x1, y1, zb], [x0, y0, zb], ey / l, -ex / l, 0);
      }
    }
    // caps (fans)
    const capStart = pos.length / 3;
    for (const [x, y] of pts) {
      pos.push(x, y, z1);
      nor.push(0, 0, 1);
    }
    for (let k = 1; k < n - 1; k++) idx.push(capStart, capStart + k, capStart + k + 1);
    const back = pos.length / 3;
    for (const [x, y] of pts) {
      pos.push(x, y, z0);
      nor.push(0, 0, -1);
    }
    for (let k = 1; k < n - 1; k++) idx.push(back, back + k + 1, back + k);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return this.add(g, null, o);
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('ramp', new THREE.Float32BufferAttribute(this.ramps, 1));
    g.setAttribute('lightOffset', new THREE.Float32BufferAttribute(this.los, 1));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(this.glows, 1));
    const n = this.vertexCount;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
