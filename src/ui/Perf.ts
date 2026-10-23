import type * as THREE from 'three';
import { config } from '../config';

// Tiny corner performance meter (?fps, or the FPS button in the tuner).
//
//   fps (1 s average) · 1% low (from the 99th-percentile frame time, ~5 s window)
//   frame ms · CPU work ms (the GPU side is unknowable on WebGL/iOS)
//   draw calls · triangles for the WHOLE frame · low-res framebuffer size
//   "30 Hz cap? (Low Power Mode)" when frames lock to ~33 ms while work is light.
//
// Draw-call counting: the pixel pipeline renders several passes per frame
// (shadow, G-buffer, glow x3, resolve, upscale) with autoClear=false, and
// three.js normally resets renderer.info at every render() call, so the
// numbers you'd read would only be the last pass (the upscale quad). Perf
// therefore sets `renderer.info.autoReset = false` and, inside frame(),
// READS the accumulated totals first and THEN calls `renderer.info.reset()`
// for the next frame. Call perf.frame() once per frame, after the last render.
//
// Timing: frame intervals are measured here with performance.now() between
// frame() calls (the game's dt is clamped and zeroed during hit-stop, so it
// can't be used for fps). `dtMs` is kept only as the sim dt in snapshot().
//
// window.__stats = perf.snapshot() is refreshed every second (tools/shot.mjs
// --stats reads it), whether or not the meter is visible.

export interface PerfSnapshot {
  fps: number;
  low1: number;
  frameMs: number;
  frameMaxMs: number;
  workMs: number;
  workMaxMs: number;
  simDtMs: number;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
  lowRes: string;
  pixelScale: number;
  canvas: string;
  cap30: boolean;
  frames: number;
}

const RING = 300; // ~5 s at 60 fps for the 1% low
const GRAPH = 90; // bars in the sparkline

const TIER = ['#7ad65a', '#ffd23e', '#ffa94a', '#f6707a'] as const; // palette: green, yellow, orange, red
function tierOf(fps: number): number {
  return fps >= 56 ? 0 : fps >= 45 ? 1 : fps >= 29 ? 2 : 3;
}

export class Perf {
  /** The most recently constructed meter (the tuner's FPS button toggles it). */
  static active: Perf | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly root: HTMLDivElement;
  private readonly elFps: HTMLElement;
  private readonly elLow: HTMLElement;
  private readonly elFrame: HTMLElement;
  private readonly elWork: HTMLElement;
  private readonly elDraw: HTMLElement;
  private readonly elRes: HTMLElement;
  private readonly elWarn: HTMLElement;
  private readonly graph: HTMLCanvasElement;
  private readonly g2d: CanvasRenderingContext2D | null;
  private shown = false;

  // rolling samples (no per-frame allocation)
  private readonly frameRing = new Float32Array(RING);
  private readonly workRing = new Float32Array(RING);
  private readonly sortBuf = new Float32Array(RING);
  private ringN = 0;
  private ringI = 0;

  // current 1-second window
  private winStart = 0;
  private winFrames = 0;
  private winFrameSum = 0;
  private winFrameMax = 0;
  private winWorkSum = 0;
  private winWorkMax = 0;
  private lastCall = 0;
  private lastDt = 0;
  private uiAt = 0;
  private capStreak = 0;
  private totalFrames = 0;

  // published
  private fpsV = 0;
  private low1 = 0;
  private frameMs = 0;
  private frameMax = 0;
  private workMs = 0;
  private workMax = 0;
  private calls = 0;
  private tris = 0;
  private points = 0;
  private lines = 0;
  private cap30 = false;
  private resW = 0;
  private resH = 0;
  private resScale = 1;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    // Totals across every pass of a frame; reset by frame() itself.
    renderer.info.autoReset = false;
    installStyle();

    const root = document.createElement('div');
    root.className = 'sbp';
    root.setAttribute('data-sb-ui', '');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="sbp-l"><b class="sbp-fps">--</b><span class="sbp-u">fps</span><span class="sbp-dim">1% </span><b class="sbp-low">--</b></div>' +
      '<div class="sbp-l"><b class="sbp-frame">--</b><span class="sbp-u">ms</span><span class="sbp-dim">cpu </span><b class="sbp-work">--</b></div>' +
      '<div class="sbp-l sbp-small"><span class="sbp-draw">--</span></div>' +
      '<div class="sbp-l sbp-small"><span class="sbp-res">--</span></div>' +
      '<canvas class="sbp-graph"></canvas>' +
      '<div class="sbp-warn">30 Hz cap? (Low Power Mode)</div>';
    const q = (c: string) => root.querySelector(c) as HTMLElement;
    this.elFps = q('.sbp-fps');
    this.elLow = q('.sbp-low');
    this.elFrame = q('.sbp-frame');
    this.elWork = q('.sbp-work');
    this.elDraw = q('.sbp-draw');
    this.elRes = q('.sbp-res');
    this.elWarn = q('.sbp-warn');
    this.graph = q('.sbp-graph') as HTMLCanvasElement;
    this.g2d = this.graph.getContext('2d');
    this.root = root;
    document.body.appendChild(root);
    Perf.active = this;
  }

  get fps(): number {
    return this.fpsV;
  }

  get visible(): boolean {
    return this.shown;
  }

  setVisible(v: boolean): void {
    this.shown = v;
    this.root.style.display = v ? 'block' : 'none';
    if (v) {
      this.sizeGraph();
      this.paint();
    }
  }

  /**
   * Call once per frame AFTER the frame's last render: reads the accumulated
   * renderer.info totals, then resets them for the next frame.
   */
  frame(dtMs: number, workMs: number): void {
    const info = this.renderer.info;
    const r = info.render;
    this.calls = r.calls;
    this.tris = r.triangles;
    this.points = r.points;
    this.lines = r.lines;
    info.reset();

    const now = performance.now();
    this.lastDt = dtMs;
    const interval = this.lastCall > 0 ? now - this.lastCall : 0;
    this.lastCall = now;
    this.totalFrames++;
    if (this.winStart === 0) this.winStart = now;
    // skip the first frame and anything after a hidden tab / breakpoint
    if (interval > 0 && interval < 1000) {
      this.frameRing[this.ringI] = interval;
      this.workRing[this.ringI] = workMs;
      this.ringI = (this.ringI + 1) % RING;
      if (this.ringN < RING) this.ringN++;
      this.winFrames++;
      this.winFrameSum += interval;
      if (interval > this.winFrameMax) this.winFrameMax = interval;
      this.winWorkSum += workMs;
      if (workMs > this.winWorkMax) this.winWorkMax = workMs;
    } else if (interval >= 1000) {
      this.winStart = now; // restart the window after a stall
      this.winFrames = this.winFrameSum = this.winFrameMax = this.winWorkSum = this.winWorkMax = 0;
    }

    if (now - this.winStart >= 1000 && this.winFrames > 0) this.closeWindow(now);
    if (this.shown && now - this.uiAt >= 250) {
      this.uiAt = now;
      this.paintGraph();
    }
  }

  snapshot(): PerfSnapshot {
    const c = this.renderer.domElement;
    const mem = this.renderer.info.memory;
    const progs = this.renderer.info.programs;
    return {
      fps: round(this.fpsV, 1),
      low1: round(this.low1, 1),
      frameMs: round(this.frameMs, 2),
      frameMaxMs: round(this.frameMax, 2),
      workMs: round(this.workMs, 2),
      workMaxMs: round(this.workMax, 2),
      simDtMs: round(this.lastDt, 2),
      calls: this.calls,
      triangles: this.tris,
      points: this.points,
      lines: this.lines,
      geometries: mem.geometries,
      textures: mem.textures,
      programs: progs ? progs.length : 0,
      lowRes: `${this.resW}x${this.resH}`,
      pixelScale: this.resScale,
      canvas: `${c.width}x${c.height}`,
      cap30: this.cap30,
      frames: this.totalFrames,
    };
  }

  dispose(): void {
    this.root.remove();
    if (Perf.active === this) Perf.active = null;
  }

  // ------------------------------------------------------------------ internals

  private closeWindow(now: number) {
    const n = this.winFrames;
    const span = now - this.winStart;
    this.fpsV = (n * 1000) / Math.max(1, span);
    this.frameMs = this.winFrameSum / n;
    this.frameMax = this.winFrameMax;
    this.workMs = this.winWorkSum / n;
    this.workMax = this.winWorkMax;
    this.winStart = now;
    this.winFrames = this.winFrameSum = this.winFrameMax = this.winWorkSum = this.winWorkMax = 0;

    // 1% low = fps at the 99th-percentile frame time over the ring
    const m = this.ringN;
    const buf = this.sortBuf;
    for (let i = 0; i < m; i++) buf[i] = this.frameRing[i];
    const view = buf.subarray(0, m);
    view.sort();
    const p99 = view[Math.min(m - 1, Math.floor(0.99 * (m - 1)))] || this.frameMs;
    this.low1 = 1000 / Math.max(1, p99);

    // Low Power Mode heuristic: iOS caps rAF at 30 Hz. Frames lock to ~33 ms
    // (tight spread) while the CPU work is far below what would explain it.
    let median = 0;
    let spread = 99;
    if (m >= 30) {
      const lo = Math.max(0, m - 60);
      // last ~60 frames, sorted copy (re-use the tail of the buffer region)
      let k = 0;
      for (let i = lo; i < m; i++) {
        const idx = (this.ringI - (m - i) + RING) % RING;
        buf[k++] = this.frameRing[idx];
      }
      const recent = buf.subarray(0, k);
      recent.sort();
      median = recent[k >> 1];
      spread = recent[Math.floor(k * 0.9)] - recent[Math.floor(k * 0.1)];
    }
    const locked = median > 30 && median < 37 && spread < 6 && this.workMs < 8;
    this.capStreak = locked ? this.capStreak + 1 : 0;
    this.cap30 = this.capStreak >= 2;

    this.measureLowRes();
    (window as unknown as { __stats?: PerfSnapshot }).__stats = this.snapshot();
    if (this.shown) this.paint();
  }

  /** Mirrors PixelPipeline.resize(): integer scale so the short side lands near config.render.pixelWidth. */
  private measureLowRes() {
    const c = this.renderer.domElement;
    const devW = c.width;
    const devH = c.height;
    const cssW = c.clientWidth || devW;
    const dpr = devW / Math.max(1, cssW);
    const portrait = devH >= devW;
    const target = config.render.pixelWidth * (portrait ? 1 : 1.25);
    let scale = Math.max(1, Math.round(Math.min(devW, devH) / Math.max(1, target)));
    scale = Math.min(scale, config.render.maxPixelScale * Math.max(1, Math.round(dpr)));
    this.resScale = scale;
    this.resW = Math.ceil(devW / scale);
    this.resH = Math.ceil(devH / scale);
  }

  private paint() {
    const t = tierOf(this.fpsV);
    this.elFps.textContent = this.fpsV ? this.fpsV.toFixed(0) : '--';
    this.elFps.style.color = TIER[t];
    this.elLow.textContent = this.low1 ? this.low1.toFixed(0) : '--';
    this.elLow.style.color = TIER[tierOf(this.low1)];
    this.elFrame.textContent = this.frameMs ? this.frameMs.toFixed(1) : '--';
    this.elWork.textContent = this.workMs ? `${this.workMs.toFixed(1)}` : '--';
    this.elDraw.textContent = `${this.calls} draws · ${fmtK(this.tris)} tris`;
    this.elRes.textContent = `${this.resW}×${this.resH} ·${this.resScale}x`;
    this.elWarn.style.display = this.cap30 ? 'block' : 'none';
    this.paintGraph();
  }

  private sizeGraph() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round(GRAPH * 1.5 * dpr);
    const h = Math.round(22 * dpr);
    if (this.graph.width !== w || this.graph.height !== h) {
      this.graph.width = w;
      this.graph.height = h;
    }
  }

  /** Frame-time sparkline: one bar per frame, guides at 16.7 and 33.3 ms. */
  private paintGraph() {
    const g = this.g2d;
    if (!g) return;
    const W = this.graph.width;
    const H = this.graph.height;
    g.clearRect(0, 0, W, H);
    const maxMs = 50;
    const y = (ms: number) => H - Math.min(1, ms / maxMs) * H;
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(0, Math.round(y(16.7)), W, 1);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, Math.round(y(33.3)), W, 1);
    const n = Math.min(GRAPH, this.ringN);
    const bw = W / GRAPH;
    for (let i = 0; i < n; i++) {
      const idx = (this.ringI - n + i + RING) % RING;
      const ms = this.frameRing[idx];
      const top = Math.round(y(ms));
      g.fillStyle = TIER[tierOf(1000 / Math.max(1, ms))];
      const x0 = Math.floor((GRAPH - n + i) * bw);
      const x1 = Math.floor((GRAPH - n + i + 1) * bw);
      g.fillRect(x0, top, Math.max(1, x1 - x0 - (bw > 2 ? 1 : 0)), H - top);
    }
  }
}

function round(v: number, d: number): number {
  const k = Math.pow(10, d);
  return Math.round(v * k) / k;
}

function fmtK(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(0) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function installStyle() {
  if (document.getElementById('sbp-style')) return;
  const st = document.createElement('style');
  st.id = 'sbp-style';
  st.textContent = `
.sbp{position:fixed;z-index:990;left:max(6px,env(safe-area-inset-left));top:max(6px,env(safe-area-inset-top));display:none;
  pointer-events:none;user-select:none;-webkit-user-select:none;padding:6px 8px 6px;border-radius:7px;
  background:rgba(11,14,19,.74);box-shadow:0 0 0 1px rgba(255,255,255,.07),2px 2px 0 rgba(0,0,0,.28);
  color:#e2e4e5;font:500 11px/1.25 ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;min-width:120px}
.sbp-l{white-space:nowrap}
.sbp-l b{font-weight:700;color:#fffbe8}
.sbp-fps{font-size:17px;letter-spacing:-.5px}
.sbp-frame{font-size:13px}
.sbp-u{color:#a7aeb5;margin:0 7px 0 3px}
.sbp-dim{color:#808a94}
.sbp-small{color:#bbc1c6;font-size:10px;margin-top:1px}
.sbp-graph{display:block;width:${(GRAPH * 1.5) | 0}px;height:22px;margin-top:4px}
.sbp-warn{display:none;margin-top:5px;padding:3px 6px;border-radius:4px;background:#5c1e3a;color:#ffe880;font-weight:700;font-size:10px}
`;
  document.head.appendChild(st);
}
