import * as THREE from 'three';

// Shader warm-up: every program the game will draw with is compiled at boot, all at once and
// in parallel (KHR_parallel_shader_compile: the main thread stays free while the GPU process
// compiles), then drawn once into the pass target it really draws into (the G-buffer's two
// outputs, the sun's depth map, the post passes' targets; never the canvas), so ANGLE's
// draw-time shader variants are paid too. All before the first presented frame: a cold load no
// longer freezes for seconds per program on its first draw, and nothing compiles in flight.
//
// What gets warmed (see docs/ARCHITECTURE.md, "Shader warm-up"):
//  - every object in the live scene (WarmUp.add(scene)), the way the pipeline draws it: its own
//    material if it is on the scene camera's layers; on the sun's layer the sun pass's override
//    material, or its own when it sets allowOverride = false;
//  - every registered source (registerWarm): anything made after boot (streamed tiles, trees,
//    rooftop gardens, landmarks built later) registers a factory that builds one object of each
//    kind exactly as the real code does: same material function, same object class
//    (InstancedMesh or not, instanceColor), same geometry layout, same layers;
//  - the pipeline's post passes (PixelPipeline.warmObjects()).
// Each object is drawn through a tiny proxy with the same three.js program key and the same
// vertex layout (attribute names, array types, item sizes, normalization: ANGLE compiles a
// vertex variant per layout) and one triangle / one instance.

type Program = { isReady(): boolean; getUniforms(): unknown; getAttributes(): unknown; name: string; cacheKey: string };
type AnyAttr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type Drawable = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;
type MorphMap = Record<string, AnyAttr[]>;
/** three's is* flags, read without a cast per class */
const flags = (o: unknown) => o as Record<string, unknown>;

/** Something to warm: objects shaped exactly like ones the game will draw later. */
export type WarmSource = () => THREE.Object3D | Iterable<THREE.Object3D>;

const sources = new Map<string, WarmSource>();
let live: WarmUp | null = null;

/**
 * Register a source of objects the warm-up must compile and draw before play (call it at
 * module load or in a constructor; the same name replaces an earlier source). Anything that
 * makes a material, or an object of a new kind, after boot registers one: otherwise its
 * program compiles, blocking, on its first draw in flight. A source registered after the
 * warm-up finished is still warmed, in the background.
 */
export function registerWarm(name: string, source: WarmSource): void {
  sources.set(name, source);
  live?.addSources();
}

const enum Pass {
  /** the scene pass, into the G-buffer */
  SCENE = 0,
  /** the sun's depth pass, into the shadow map */
  SUN = 1,
  /** a post pass (drawn by the pipeline itself) */
  POST = 2,
}

interface Entry {
  name: string;
  /** (dropped once drawn: nothing here keeps a streamed tile's material alive) */
  proxy: THREE.Object3D | null;
  pass: Pass;
  /** pass, object kind and vertex layout: with the programs, what a draw warms */
  sig: string;
  mats: THREE.Material[];
  /** shader source length: how long its compile will take, roughly */
  cost: number;
  /** compile() was called (its programs exist) */
  compiled: boolean;
  programs: Program[];
  drawn: boolean;
}

/** What the pipeline must offer the warm-up (PixelPipeline implements it). */
export interface WarmPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.Camera;
  /** layers the scene pass draws */
  readonly sceneLayers: THREE.Layers;
  /** layers the sun's depth pass draws, and the material it overrides with */
  readonly sunLayers: THREE.Layers;
  readonly sunOverride: THREE.Material;
  /** one object per post-pass material */
  warmObjects(): THREE.Object3D[];
  /** draw these into the G-buffer and the shadow map (never the canvas) */
  warmDraw(scene: THREE.Scene, sun: THREE.Scene, camera: THREE.Camera): void;
  /** run the post passes once into their own targets (never the canvas) */
  warmPasses(): void;
}

export interface WarmReport {
  /** programs compiled by the warm-up */
  programs: number;
  /** proxies drawn (material x object kind x pass) */
  draws: number;
  /** draw rounds (each waits for the GPU before the next) */
  rounds: number;
  /** ms from the warm-up's start: the last program linked; everything drawn and done on the GPU */
  linkedMs: number;
  doneMs: number;
  /** programs that existed when it finished (renderer.info.programs) */
  total: number;
  /** per round: [ms from start, proxies drawn, ms the main thread spent priming + drawing, ms the GPU took after] */
  log: Array<[number, number, number, number]>;
  /** per entry drawn: [ms from start, source name] */
  drawnAt: Array<[number, string]>;
}

function layoutOf(a: AnyAttr): { ctor: new (n: number) => THREE.TypedArray; instanced: boolean; gpuType: number } {
  if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const d = (a as THREE.InterleavedBufferAttribute).data;
    return { ctor: d.array.constructor as new (n: number) => THREE.TypedArray, instanced: flags(d).isInstancedInterleavedBuffer === true, gpuType: THREE.FloatType };
  }
  const b = a as THREE.BufferAttribute;
  return { ctor: b.array.constructor as new (n: number) => THREE.TypedArray, instanced: (b as THREE.InstancedBufferAttribute).isInstancedBufferAttribute === true, gpuType: b.gpuType };
}

/** Same name, array type, item size, normalization and instancing; one vertex / instance's worth. */
function cloneAttr(a: AnyAttr, vertices: number): THREE.BufferAttribute {
  const { ctor, instanced, gpuType } = layoutOf(a);
  const arr = new ctor((instanced ? 1 : vertices) * a.itemSize);
  const out = instanced ? new THREE.InstancedBufferAttribute(arr, a.itemSize, a.normalized) : new THREE.BufferAttribute(arr, a.itemSize, a.normalized);
  out.gpuType = gpuType as THREE.AttributeGPUType;
  return out;
}

function attrSig(name: string, a: AnyAttr): string {
  const { ctor, instanced, gpuType } = layoutOf(a);
  return `${name}:${ctor.name}:${a.itemSize}:${a.normalized ? 1 : 0}:${instanced ? 1 : 0}:${gpuType}`;
}

function layoutSig(g: THREE.BufferGeometry): string {
  const parts: string[] = [];
  for (const name of Object.keys(g.attributes).sort()) parts.push(attrSig(name, g.attributes[name]));
  const morph = g.morphAttributes as MorphMap;
  for (const name of Object.keys(morph).sort()) parts.push(`morph:${name}:${morph[name].map((a, i) => attrSig(String(i), a)).join('/')}`);
  return parts.join(',');
}

/** The geometry layout of `src` with one degenerate triangle (3 vertices, one instance). */
function proxyGeometry(src: THREE.BufferGeometry, slots: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) g.setAttribute(name, cloneAttr(src.attributes[name], 3));
  const morph = src.morphAttributes as MorphMap;
  for (const name of Object.keys(morph)) (g.morphAttributes as MorphMap)[name] = morph[name].map((a) => cloneAttr(a, 3));
  g.morphTargetsRelative = src.morphTargetsRelative;
  if (src.index) {
    const ctor = src.index.array.constructor as new (n: number) => THREE.TypedArray;
    const idx = new ctor(3);
    idx[1] = 1;
    idx[2] = 2;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  for (let i = 0; i < slots; i++) g.addGroup(0, 3, i);
  return g;
}

function kindOf(o: THREE.Object3D): string | null {
  const x = flags(o);
  if (x.isSkinnedMesh || x.isBatchedMesh) return null;
  if (x.isInstancedMesh) {
    const im = o as THREE.InstancedMesh;
    return `I${im.instanceColor ? 'c' + attrSig('c', im.instanceColor) : ''}${im.morphTexture ? 'm' : ''}`;
  }
  if (x.isMesh) return 'M';
  if (x.isPoints) return 'P';
  if (x.isLineSegments) return 'LS';
  if (x.isLineLoop) return 'LL';
  if (x.isLine) return 'L';
  if (x.isSprite) return 'S';
  return null;
}

/** A one-primitive stand-in for `o` drawn with `material`: same program key, same vertex layout. */
function makeProxy(o: Drawable, material: THREE.Material | THREE.Material[]): THREE.Object3D | null {
  const x = flags(o);
  const slots = Array.isArray(material) ? material.length : 0;
  let p: THREE.Object3D;
  if (x.isSprite) p = new THREE.Sprite(material as THREE.SpriteMaterial);
  else {
    const geo = proxyGeometry(o.geometry as THREE.BufferGeometry, slots);
    if (x.isInstancedMesh) {
      const src = o as THREE.InstancedMesh;
      const im = new THREE.InstancedMesh(geo, material, 1);
      if (src.instanceColor) im.instanceColor = cloneAttr(src.instanceColor, 1) as THREE.InstancedBufferAttribute;
      if (src.morphTexture) im.morphTexture = src.morphTexture;
      p = im;
    } else if (x.isMesh) p = new THREE.Mesh(geo, material);
    else if (x.isPoints) p = new THREE.Points(geo, material);
    else if (x.isLineSegments) p = new THREE.LineSegments(geo, material);
    else if (x.isLineLoop) p = new THREE.LineLoop(geo, material);
    else if (x.isLine) p = new THREE.Line(geo, material);
    else return null;
  }
  p.frustumCulled = false;
  p.matrixAutoUpdate = false;
  return p;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Collects what to warm (add(), registered sources), compiles it at once, and finish() resolves
 * when every program is linked and has drawn into its real target and the GPU has done all of
 * it. Nothing it draws is ever presented. One per renderer; it never disposes what it made, so
 * the programs it compiled stay alive (a material later made with the same code reuses them).
 */
export class WarmUp {
  private readonly entries: Entry[] = [];
  private readonly sigs = new Set<string>();
  /** draws done or queued (pass, kind, layout, programs): many materials share a program */
  private readonly drawSigs = new Set<string>();
  private readonly primed = new Set<Program>();
  /** programs this warm-up created whose link isn't known to be done */
  private readonly linking = new Set<Program>();
  /** programs compiling in the long lanes (the longest first; see compileSome) */
  private readonly long = new Set<Program>();
  private compileQueued = false;
  /** programs compiling at once: the GPU process's compile pool also serves the browser's own raster,
   * which must not wait behind seconds of our compiles (its wait stalls the whole GPU main thread) */
  private readonly lanes = Math.max(2, Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
  private readonly ran = new Set<string>();
  /** objects already looked at, with the material they had (a live object is looked at again only if it changed) */
  private readonly seen = new WeakMap<THREE.Object3D, THREE.Material | THREE.Material[]>();
  private readonly gScene = new THREE.Scene();
  private readonly sScene = new THREE.Scene();
  private readonly cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
  private readonly t0 = performance.now();
  private readonly gl: WebGL2RenderingContext;
  private readonly parallel: boolean;
  private pump: Promise<void> = Promise.resolve();
  private running = false;
  private passesDrawn = false;
  private rounds = 0;
  private draws = 0;
  private linkedAt = 0;
  private readonly log: Array<[number, number, number, number]> = [];
  private readonly drawnAt: Array<[number, string]> = [];
  /** performance.now() when the warm-up last finished (QA: programs made after it are misses) */
  doneAt = 0;
  report: WarmReport | null = null;

  constructor(
    private readonly pipeline: WarmPipeline,
    /** the scene the objects will really draw in (its fog, environment and lights set program keys) */
    private readonly target: THREE.Scene,
  ) {
    this.gl = pipeline.renderer.getContext() as WebGL2RenderingContext;
    this.parallel = pipeline.renderer.extensions.has('KHR_parallel_shader_compile');
    live = this;
    this.add(pipeline.warmObjects(), 'post passes', Pass.POST);
    this.addSources();
  }

  /** Run every registered source not run yet. */
  addSources(): void {
    for (const [name, make] of sources) {
      if (this.ran.has(name)) continue;
      this.ran.add(name);
      let made: THREE.Object3D | Iterable<THREE.Object3D>;
      try {
        made = make();
      } catch (e) {
        console.warn('warm-up source failed:', name, e);
        continue;
      }
      this.add(made, name);
    }
  }

  /**
   * Warm everything drawable under these roots (e.g. the live scene), the way the pipeline
   * draws it. Cheap to repeat: each (material, object kind, vertex layout, pass) is done once.
   */
  add(roots: THREE.Object3D | Iterable<THREE.Object3D>, name = 'scene', only?: Pass): void {
    const list = (roots as THREE.Object3D).isObject3D ? [roots as THREE.Object3D] : (roots as Iterable<THREE.Object3D>);
    const p = this.pipeline;
    const depth = p.sunOverride;
    for (const root of list)
      root.traverse((o) => {
        const d = o as Drawable;
        if (d.material && this.seen.get(o) === d.material) return;
        if (d.material) this.seen.set(o, d.material);
        if (!d.material || kindOf(o) === null) {
          if (flags(o).isSkinnedMesh || flags(o).isBatchedMesh) console.warn('warm-up: unsupported object kind', o.type, o.name);
          return;
        }
        if (only === Pass.POST) {
          this.entry(name, d, d.material, Pass.POST);
          return;
        }
        if (o.layers.test(p.sceneLayers)) this.entry(name, d, d.material, Pass.SCENE);
        if (o.layers.test(p.sunLayers)) {
          const sun = Array.isArray(d.material) ? d.material.map((m) => (m.allowOverride === false ? m : depth)) : d.material.allowOverride === false ? d.material : depth;
          this.entry(name, d, sun, Pass.SUN);
        }
      });
    // (once everything added in this task is known: the longest goes first)
    if (!this.compileQueued) {
      this.compileQueued = true;
      queueMicrotask(() => {
        this.compileQueued = false;
        this.compileSome();
      });
    }
    if (this.entries.some((e) => !e.drawn) || (only === Pass.POST && !this.passesDrawn)) this.start();
  }

  /**
   * Start compiles while fewer than `lanes` programs are linking: half the lanes take the longest
   * waiting (the building's program sets how long the whole warm-up takes), the others the
   * shortest (their draws then start early: on D3D the GPU process compiles each G-buffer program
   * a second time at its first draw, one after another, so that queue must not run dry).
   */
  private compileSome() {
    const r = this.pipeline.renderer;
    const all = r.info.programs as unknown as Program[];
    for (const p of this.long) if (!this.linking.has(p)) this.long.delete(p);
    for (;;) {
      if (this.linking.size >= (this.parallel ? this.lanes : 1)) return;
      const longest = this.long.size < Math.max(1, this.lanes >> 1);
      let pick: Entry | null = null;
      for (const e of this.entries) {
        if (e.compiled) continue;
        if (!pick || (longest ? e.cost > pick.cost : e.cost < pick.cost)) pick = e;
      }
      if (!pick) return;
      pick.compiled = true;
      const before = all.length;
      try {
        r.compile(pick.proxy!, this.pipeline.camera, this.target);
      } catch (e) {
        console.warn('warm-up: compile failed', pick.name, e);
        pick.drawn = true;
        pick.proxy = null;
        continue;
      }
      const programs = new Set<Program>(all.slice(before));
      for (const p of programs) {
        this.linking.add(p);
        if (longest) this.long.add(p);
      }
      for (const m of pick.mats) {
        const cur = (r.properties.get(m) as { currentProgram?: Program }).currentProgram;
        if (cur) programs.add(cur);
      }
      pick.programs = [...programs];
      pick.mats = [];
      // (another material running the same programs on the same kind of object: its draw covers this one)
      const ds = `${pick.sig}|${pick.programs.map((p) => (p as unknown as { id: number }).id).join('+')}`;
      if (pick.pass !== Pass.POST && this.drawSigs.has(ds)) {
        pick.drawn = true;
        pick.proxy = null;
      }
      this.drawSigs.add(ds);
    }
  }

  private entry(name: string, o: Drawable, material: THREE.Material | THREE.Material[], pass: Pass) {
    const mats = Array.isArray(material) ? material : [material];
    const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const shape = `${pass}|${kindOf(o)}|${geo ? layoutSig(geo) : ''}`;
    const sig = `${shape}|${mats.map((m) => m.uuid).join('+')}`;
    if (this.sigs.has(sig)) return;
    this.sigs.add(sig);
    const proxy = makeProxy(o, material);
    if (!proxy) return;
    let cost = 0;
    for (const m of mats) {
      const sm = m as THREE.ShaderMaterial;
      cost += sm.isShaderMaterial ? sm.vertexShader.length + sm.fragmentShader.length : 2000;
    }
    this.entries.push({ name, proxy, pass, sig: shape, mats, cost, compiled: false, programs: [], drawn: false });
    // (post passes are drawn by the pipeline, after everything else)
    if (pass === Pass.POST) this.passesDrawn = false;
  }

  private start() {
    if (this.running) return;
    this.running = true;
    this.pump = this.loop().catch((e) => {
      this.running = false;
      console.warn('warm-up failed', e);
    });
  }

  /** Still compiling or drawing something. */
  get busy(): boolean {
    return this.running;
  }

  /** Resolves once everything added so far is compiled, drawn and done on the GPU. */
  async finish(): Promise<WarmReport> {
    this.start();
    while (this.running) await this.pump;
    return this.report!;
  }

  private async loop(): Promise<void> {
    const gl = this.gl;
    const r = this.pipeline.renderer;
    const alive = r.info.programs as unknown as Program[];
    let drewAt = 0;
    for (;;) {
      // A fence round trip first. Every query below (link status, uniform tables) is synchronous: it
      // waits for the GPU process to get to it, i.e. behind the last round's draws (whose draw-time
      // shader variants compile there, seconds) or behind anything else stuck on its main thread (the
      // browser's own raster waiting for a compile slot). Polling the fence never blocks; once it has
      // signaled, the GPU process is free and the queries answer at once.
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      gl.flush();
      while (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) await sleep(4);
      gl.deleteSync(fence);
      if (drewAt) {
        this.log[this.log.length - 1][3] = Math.round(performance.now() - drewAt);
        drewAt = 0;
      }
      const roundAt = performance.now();
      // which links are done (polled without blocking with the parallel extension; without it
      // isReady() is always true and priming below blocks for the compile: one program per task)
      for (const p of this.linking) if (!alive.includes(p) || p.isReady()) this.linking.delete(p);
      this.compileSome();
      let budget = this.parallel ? Infinity : 1;
      for (const e of this.entries) {
        if (e.drawn || !e.compiled || budget <= 0) continue;
        // (a live object's material disposed since it was added: nothing left to warm)
        const progs = e.programs.filter((p) => alive.includes(p));
        if (progs.some((p) => this.linking.has(p))) continue;
        for (const p of progs) {
          if (this.primed.has(p)) continue;
          // the uniform and attribute tables, which three would otherwise fetch synchronously on first use
          p.getUniforms();
          p.getAttributes();
          this.primed.add(p);
          budget--;
        }
        e.drawn = true;
        this.linkedAt = performance.now();
        this.drawnAt.push([Math.round(this.linkedAt - this.t0), `${e.name}/${e.pass}`]);
        if (e.pass === Pass.SCENE) this.gScene.add(e.proxy!);
        else if (e.pass === Pass.SUN) this.sScene.add(e.proxy!);
        e.proxy = null;
      }
      const n = this.gScene.children.length + this.sScene.children.length;
      if (n) {
        this.pipeline.warmDraw(this.gScene, this.sScene, this.cam);
        this.gScene.clear();
        this.sScene.clear();
        this.draws += n;
      }
      // the post passes last (they read what the scene pass wrote)
      let post = false;
      if (!this.passesDrawn && this.entries.every((e) => e.drawn)) {
        this.pipeline.warmPasses();
        this.passesDrawn = post = true;
      }
      if (n || post) {
        // (the next round's fence waits for these draws)
        this.rounds++;
        drewAt = performance.now();
        this.log.push([Math.round(roundAt - this.t0), n, Math.round(drewAt - roundAt), 0]);
        continue;
      }
      if (this.passesDrawn && this.entries.every((e) => e.drawn)) {
        // (in the same task as that check: an add() from now on starts a new loop)
        this.running = false;
        break;
      }
      await sleep(this.parallel ? 12 : 0);
    }
    this.doneAt = performance.now();
    this.report = {
      programs: this.primed.size,
      draws: this.draws,
      rounds: this.rounds,
      linkedMs: Math.round(this.linkedAt - this.t0),
      doneMs: Math.round(this.doneAt - this.t0),
      total: alive.length,
      log: this.log,
      drawnAt: this.drawnAt,
    };
  }
}
