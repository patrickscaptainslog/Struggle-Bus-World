import { config } from '../config';
import type { Perf } from './Perf';

// ?bench: the phone bench (the first milestone's task 1). One link a borrowed phone opens with no tools: the page flies a scripted minute with no touch
// and ends on one screen that a screenshot carries. Nothing is sent anywhere, and no id is read.
//
//   page 1 (?bench): the door as a newcomer meets it: scripted taps (the touch path's own pointer events, low in the middle of the screen, every
//     2.6 s from 0.3 s after the first frame) until the Golden Gate is crowned, and its show; then a capture of the canvas to a picture, three
//     times (what a postcard will cost: the frame that takes it); then a look straight down from the ceiling over downtown (the bus held there).
//   page 2 (?bench=lift&lift&lifted&hoodstart, which page 1 opens itself, its numbers in the address's #): the Lift's stand-in as ?lift shows it,
//     the block lifting and the bus gliding in under and beside it. It loads as its own page because ?lift compiles GLSL no other page does.
//   Then the screen: each leg's frame times (median, 95th percentile, frames over 33.4 and 50.1 ms, the worst), its draws and triangles (median,
//   worst); the tap on the link to the first frame and to the bridge's first paint; the screen, the pixel ratio, the browser's own words and its
//   GPU's; the build. A tap on it copies the same as text. window.__bench has it all for a tool.
//
// Frame times are the intervals between the frames' rAF timestamps (vsync-aligned: at 60 Hz a frame is 16.7, 33.3 or 50 ms, so "over 33.4" is a
// frame slower than 30 fps). The draws and triangles are each frame's whole, every pass (Perf.frameCalls), the door's from the page's first frame,
// which has no interval to time (on the laptop it draws about twice what the frames after it do). The page keeps its paint to itself under a slug
// of its own (main.ts), cleared at each start, so every run meets the same grey bridge and no return start.

declare const __SB_BUILD__: string;

export interface BenchHooks {
  canvas: HTMLCanvasElement;
  perf: Perf;
  /** the door's start was taken on this page */
  door: boolean;
  /** the Golden Gate's paint level now (-1: none on this map) */
  bridgeLevel(): number;
  /** game s of the last crown (-1: none yet) */
  crownedAt(): number;
  toLocal(lat: number, lon: number): [number, number];
  groundAt(x: number, z: number): number;
  flight: { x: number; y: number; z: number; heading: number };
  /** ?lift&lifted's block: its wave's start on its clock (-1: not yet) and its heart; null with no Lift */
  lift: { waveAt: number; readonly heart: readonly [number, number] } | null;
}

type LegName = 'door' | 'lift' | 'ceiling' | 'capture';
const LEGS: readonly LegName[] = ['door', 'lift', 'ceiling', 'capture'];

export interface LegSum {
  ran: boolean;
  frames: number;
  secs: number;
  med: number;
  p95: number;
  over33: number;
  over50: number;
  worst: number;
  drawsMed: number;
  drawsMax: number;
  trisMed: number;
  trisMax: number;
  /** the frames' CPU work in the game's loop, median (ms) */
  workMed: number;
  /** the page went hidden during the leg: its numbers are not a phone's */
  hidden: boolean;
}

/** Page 1's numbers, carried to page 2 in the address's # */
interface PageOne {
  build: string;
  firstFrameMs: number;
  firstPaintMs: number;
  door: boolean;
  crownS: number;
  taps: number;
  capture: { w: number; h: number; frameMs: number[]; callMs: number; readyMs: number; kb: number; blank: boolean | null };
  thumb: string;
  legs: Partial<Record<LegName, LegSum>>;
}

const MAX = 6000; // frames a leg can hold (100 s at 60 fps)
const TAP_FIRST = 0.3; // s after the first frame
const TAP_EVERY = 2.6; // s (m1-door's newcomer: none refused at this beat)
const TAP_HOLD = 0.06;
const DOOR_MAX = 40; // s: no crown by then, the leg ends unrun
const CROWN_SHOW = 3; // s after the crown, its flash and sparks counted
const CAPTURES = [0.5, 1.3, 2.1]; // s into the capture leg
const CAPTURE_LEG = 2.6;
const SETTLE = 4; // s at the ceiling before its frames count (the teleport's streaming)
const CEILING_LEG = 10;
const DOWNTOWN = [37.7925, -122.401] as const; // the financial district (shots.mjs's fidi)
const LIFT_WAIT = 30; // s for the wave
const LIFT_LEG = 14;
const LIFT_KEYS = ['lift', 'lifted', 'hoodstart'];

class Leg {
  readonly ms = new Float32Array(MAX);
  readonly work = new Float32Array(MAX);
  readonly calls = new Float32Array(MAX);
  readonly tris = new Float32Array(MAX);
  /** frames timed (an interval since the one before), and frames counted for draws (the page's first frame too, which has no interval) */
  n = 0;
  nd = 0;
  t0 = 0;
  t1 = 0;
  hidden = false;
  add(ms: number, calls: number, tris: number, work: number) {
    if (ms > 0 && this.n < MAX) {
      this.ms[this.n] = ms;
      this.work[this.n] = work;
      this.n++;
    }
    if (this.nd < MAX) {
      this.calls[this.nd] = calls;
      this.tris[this.nd] = tris;
      this.nd++;
    }
  }
  sum(ran: boolean): LegSum {
    const sorted = (a: Float32Array, n: number) => Array.from(a.subarray(0, n)).sort((x, y) => x - y);
    const at = (s: number[], q: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN);
    const top = (s: number[]) => (s.length ? s[s.length - 1] : NaN);
    const ms = sorted(this.ms, this.n), work = sorted(this.work, this.n), calls = sorted(this.calls, this.nd), tris = sorted(this.tris, this.nd);
    let o33 = 0, o50 = 0;
    for (const v of ms) {
      if (v > 33.4) o33++;
      if (v > 50.1) o50++;
    }
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      ran: ran && this.n > 0,
      frames: this.n,
      secs: r1((this.t1 - this.t0) / 1000),
      med: r1(at(ms, 0.5)),
      p95: r1(at(ms, 0.95)),
      over33: o33,
      over50: o50,
      worst: r1(top(ms)),
      drawsMed: at(calls, 0.5),
      drawsMax: top(calls),
      trisMed: at(tris, 0.5),
      trisMax: top(tris),
      workMed: r1(at(work, 0.5)),
      hidden: this.hidden,
    };
  }
}

type Phase = 'door' | 'capture' | 'settle' | 'ceiling' | 'leaving' | 'liftWait' | 'lift' | 'done';

export class Bench {
  private readonly h: BenchHooks;
  private readonly two: boolean;
  private phase: Phase;
  private leg: Leg | null = null;
  private readonly sums: Partial<Record<LegName, LegSum>> = {};
  private one: PageOne | null = null;
  private lastNow = -1;
  /** rAF time of the first frame, and of this phase's start */
  private t0 = -1;
  private phaseAt = 0;
  private firstFrameMs = -1;
  private firstPaintMs = -1;
  private taps = 0;
  private nextTap = 0;
  private upAt = -1;
  private crownS = -1;
  private crownSeen = -1;
  private captureFrames: number[] = [];
  private captureCall = 0;
  private captureReady = -1;
  private captureKb = 0;
  private captureNext = 0;
  private captureWas = false;
  private blob: Blob | null = null;
  private thumb = '';
  private blank: boolean | null = null;
  private liftNear = Infinity;
  private liftWaveS = -1;
  private label: HTMLDivElement | null = null;
  private labelText = '';
  private wake: { release(): Promise<void> } | null = null;

  constructor(hooks: BenchHooks, params: URLSearchParams) {
    this.h = hooks;
    this.two = params.get('bench') === 'lift';
    this.phase = this.two ? 'liftWait' : 'door';
    if (this.two) this.one = readOne();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.leg) this.leg.hidden = true;
    });
    // (a phone set to lock after 30 s would lock in the middle: Safari 16.4 on keeps the screen on when asked)
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock
      ?.request('screen')
      .then((w) => (this.wake = w))
      .catch(() => {
        /* not on this browser: the note says to set Auto-Lock longer */
      });
  }

  /** Once a frame, after its last render and Perf.frame (the canvas still holds the frame: the capture reads it here). */
  frame(now: number, workMs: number): void {
    const h = this.h;
    const dtMs = this.lastNow >= 0 ? now - this.lastNow : 0;
    this.lastNow = now;
    if (this.t0 < 0) {
      this.t0 = this.phaseAt = now;
      this.firstFrameMs = performance.now();
      this.nextTap = TAP_FIRST;
      this.label = document.createElement('div');
      this.label.style.cssText =
        'position:fixed;left:0;right:0;top:calc(env(safe-area-inset-top) + 6px);text-align:center;font:600 12px/1.2 ui-monospace,Menlo,monospace;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none;z-index:50';
      document.body.appendChild(this.label);
      if (!this.two) this.startLeg();
    }
    if (this.leg) {
      this.leg.add(dtMs, h.perf.frameCalls, h.perf.frameTris, workMs);
      this.leg.t1 = now;
    }
    if (this.captureWas) {
      // (the interval just closed is the frame that took the picture)
      this.captureFrames.push(Math.round(dtMs * 10) / 10);
      this.captureWas = false;
    }
    if (this.firstPaintMs < 0 && h.bridgeLevel() > 0) this.firstPaintMs = performance.now();
    const s = (now - this.phaseAt) / 1000;
    const sinceFirst = (now - this.t0) / 1000;
    switch (this.phase) {
      case 'door': {
        if (this.upAt >= 0 && now >= this.upAt) this.touch('pointerup');
        if (this.crownS < 0 && h.crownedAt() >= 0) {
          this.crownS = Math.round(s * 100) / 100;
          this.crownSeen = now;
        }
        if (this.crownS < 0 && s >= this.nextTap && this.upAt < 0) {
          this.touch('pointerdown');
          this.upAt = now + TAP_HOLD * 1000;
          this.taps++;
          this.nextTap += TAP_EVERY;
        }
        if ((this.crownSeen >= 0 && now - this.crownSeen >= CROWN_SHOW * 1000) || s >= DOOR_MAX) {
          if (this.upAt >= 0) this.touch('pointerup');
          this.endLeg('door', this.crownS >= 0 && h.door && this.firstPaintMs >= 0);
          this.go('capture', now);
          this.captureNext = 0;
          this.startLeg();
        }
        break;
      }
      case 'capture': {
        if (this.captureNext < CAPTURES.length && s >= CAPTURES[this.captureNext]) {
          this.capture();
          this.captureNext++;
        }
        if (s >= CAPTURE_LEG) {
          this.endLeg('capture', this.captureFrames.length === CAPTURES.length && this.blob !== null);
          this.go('settle', now);
          this.toCeiling();
          void this.makeThumb();
        }
        break;
      }
      case 'settle':
        if (s >= SETTLE) {
          this.go('ceiling', now);
          this.startLeg();
        }
        break;
      case 'ceiling':
        if (s >= CEILING_LEG) {
          this.endLeg('ceiling', Math.abs(h.flight.y - config.flight.ceiling) < 1);
          setQA(null);
          this.go('leaving', now);
          this.leave();
        }
        break;
      case 'liftWait': {
        const L = h.lift;
        if (L && L.waveAt >= 0) {
          this.liftWaveS = Math.round(sinceFirst * 10) / 10;
          this.go('lift', now);
          this.startLeg();
        } else if (sinceFirst >= LIFT_WAIT) {
          this.go('done', now);
          this.show();
        }
        break;
      }
      case 'lift': {
        const L = h.lift!;
        this.liftNear = Math.min(this.liftNear, Math.hypot(h.flight.x - L.heart[0], h.flight.z - L.heart[1]));
        if (s >= LIFT_LEG) {
          this.endLeg('lift', true);
          this.go('done', now);
          this.show();
        }
        break;
      }
      default:
        break;
    }
    if (this.label && this.phase !== 'done') {
      const t = `BENCH ${this.two ? 2 : 1}/2 · ${this.phase === 'settle' || this.phase === 'liftWait' ? 'getting ready' : this.phase} · no touch please`;
      if (t !== this.labelText) this.label.textContent = this.labelText = t;
    }
  }

  private go(p: Phase, now: number) {
    this.phase = p;
    this.phaseAt = now;
  }

  private startLeg() {
    this.leg = new Leg();
    this.leg.t0 = this.leg.t1 = this.lastNow;
  }

  private endLeg(name: LegName, ran: boolean) {
    if (this.leg) this.sums[name] = this.leg.sum(ran);
    this.leg = null;
  }

  /** A touch as the touch path gives it to Input: a pointer of type touch, low in the middle of the screen (m1-door's 196, 760 of 393 x 852). */
  private touch(type: 'pointerdown' | 'pointerup') {
    const r = this.h.canvas.getBoundingClientRect();
    const e = new PointerEvent(type, {
      pointerId: 71,
      pointerType: 'touch',
      isPrimary: true,
      clientX: r.left + r.width * 0.5,
      clientY: r.top + r.height * 0.892,
      width: 16,
      height: 16,
      pressure: type === 'pointerdown' ? 0.5 : 0,
      bubbles: true,
      cancelable: true,
    });
    this.h.canvas.dispatchEvent(e);
    if (type === 'pointerup') this.upAt = -1;
  }

  /** The canvas to a picture as a postcard would take it: a JPEG of the whole canvas, here inside the frame that drew it. */
  private capture() {
    const c = this.h.canvas, t = performance.now();
    c.toBlob(
      (b) => {
        this.captureReady = Math.round(performance.now() - t);
        if (b) {
          this.blob = b;
          this.captureKb = Math.round(b.size / 1024);
        }
      },
      'image/jpeg',
      0.9,
    );
    this.captureCall = Math.max(this.captureCall, Math.round((performance.now() - t) * 10) / 10);
    this.captureWas = true;
  }

  /** A small copy of the last picture for the screen (made during the ceiling's settle, whose frames don't count), and whether it is blank. */
  private async makeThumb() {
    const b = this.blob;
    if (!b) return;
    try {
      const url = URL.createObjectURL(b);
      const img = new Image();
      await new Promise<void>((ok, bad) => {
        img.onload = () => ok();
        img.onerror = () => bad(new Error('no image'));
        img.src = url;
      });
      const w = 72, hh = Math.max(1, Math.round((w * img.height) / Math.max(1, img.width)));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = hh;
      const g = cv.getContext('2d');
      if (!g) return;
      g.drawImage(img, 0, 0, w, hh);
      URL.revokeObjectURL(url);
      const px = g.getImageData(0, 0, w, hh).data;
      let m = 0, m2 = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
        m += l;
        m2 += l * l;
      }
      const n = px.length / 4, sd = Math.sqrt(Math.max(0, m2 / n - (m / n) ** 2));
      this.blank = sd < 3;
      this.thumb = cv.toDataURL('image/jpeg', 0.6);
    } catch {
      /* no thumbnail: the numbers stand */
    }
  }

  /** The bus held at the ceiling over downtown, the lens straight down over it (the page's QA hooks: main.ts reads window.__qa each frame). */
  private toCeiling() {
    const h = this.h, [lat, lon] = DOWNTOWN, [x, z] = h.toLocal(lat, lon), y = config.flight.ceiling;
    setQA({ pin: { x, y, z, heading: h.flight.heading }, topDown: { lat, lon, height: y - h.groundAt(x, z) + 200 } });
  }

  /** On to page 2, page 1's numbers in the address's # (never sent: a # stays in the browser). */
  private leave() {
    const c = this.h.canvas;
    const one: PageOne = {
      build: build(),
      firstFrameMs: Math.round(this.firstFrameMs),
      firstPaintMs: Math.round(this.firstPaintMs),
      door: this.h.door,
      crownS: this.crownS,
      taps: this.taps,
      capture: { w: c.width, h: c.height, frameMs: this.captureFrames, callMs: this.captureCall, readyMs: this.captureReady, kb: this.captureKb, blank: this.blank },
      thumb: this.thumb,
      legs: this.sums,
    };
    const q = new URLSearchParams(location.search);
    q.set('bench', 'lift');
    for (const k of LIFT_KEYS) q.set(k, '');
    void this.wake?.release().catch(() => {});
    location.replace(`${location.pathname}?${q.toString().replace(/=(&|$)/g, '$1')}#${encodeURIComponent(JSON.stringify(one))}`);
  }

  /** The one screen. */
  private show() {
    const one = this.one;
    const legs: Partial<Record<LegName, LegSum>> = { ...(one?.legs ?? {}), ...this.sums };
    const L = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '--');
    const M = (x: number) => (Number.isFinite(x) ? (x / 1e6).toFixed(2) : '--');
    const sec = (ms: number | undefined) => (ms !== undefined && ms >= 0 ? (ms / 1000).toFixed(2) + ' s' : '--');
    const pad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);
    const head = `${'leg'.padEnd(7)}${pad('med', 6)}${pad('p95', 6)}${pad('>33', 5)}${pad('>50', 5)}${pad('worst', 7)}${pad('draws', 9)}${pad('M tris', 11)}`;
    const rows = LEGS.map((k) => {
      const g = legs[k];
      if (!g || !g.ran) return `${k.padEnd(7)}  DID NOT RUN`;
      return `${k.padEnd(7)}${pad(L(g.med), 6)}${pad(L(g.p95), 6)}${pad(String(g.over33), 5)}${pad(String(g.over50), 5)}${pad(L(g.worst), 7)}${pad(`${g.drawsMed}/${g.drawsMax}`, 9)}${pad(`${M(g.trisMed)}/${M(g.trisMax)}`, 11)}${g.hidden ? ' HIDDEN' : ''}`;
    });
    const cap = one?.capture;
    const snap = this.h.perf.snapshot();
    const gl = this.h.canvas.getContext('webgl2');
    let gpu = '?';
    try {
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : '?');
    } catch {
      /* the GPU's name withheld */
    }
    const lines = [
      `STRUGGLE BUS BENCH · build ${build()}${one && one.build !== build() ? ` (page 1: ${one.build})` : ''}`,
      'frame ms: median, 95th pct, frames over 33.4 and 50.1, worst',
      head,
      ...rows,
      `frames: ${LEGS.map((k) => `${k} ${legs[k]?.frames ?? 0}`).join(' · ')}`,
      `cpu ms (median): ${LEGS.map((k) => `${k} ${L(legs[k]?.workMed ?? NaN)}`).join(' · ')}`,
      `tap to first frame ${sec(one?.firstFrameMs)} · to first paint ${sec(one?.firstPaintMs)}`,
      `door: ${one ? (one.door ? 'yes' : 'NO') : '--'} · crowned ${one && one.crownS >= 0 ? one.crownS.toFixed(1) + ' s' : '--'} after the first frame · ${one?.taps ?? '--'} taps`,
      cap
        ? `capture ${cap.w}x${cap.h} jpeg: its frames ${cap.frameMs.join(' / ') || '--'} ms · call ${cap.callMs} ms · ready ${cap.readyMs} ms · ${cap.kb} KB${cap.blank ? ' · BLANK' : ''}`
        : 'capture --',
      `ceiling: ${config.flight.ceiling} m over downtown, straight down`,
      `lift: ${this.liftWaveS >= 0 ? `wave ${this.liftWaveS} s after its first frame · bus came ${Math.round(this.liftNear)} m from its heart` : 'NO WAVE'}`,
      `screen ${screen.width}x${screen.height} · view ${innerWidth}x${innerHeight} · ratio ${devicePixelRatio} · game ${snap.lowRes} · canvas ${snap.canvas}${snap.cap30 ? ' · 30 Hz cap? (Low Power Mode)' : ''}`,
      `gpu ${gpu}`,
      `browser ${navigator.userAgent}`,
    ];
    const text = lines.join('\n');
    const ok = LEGS.every((k) => legs[k]?.ran);
    (window as unknown as { __bench?: unknown }).__bench = { done: true, ok, legs, one, liftWaveS: this.liftWaveS, liftNear: Math.round(this.liftNear), gpu, text, build: build() };
    this.label?.remove();
    void this.wake?.release().catch(() => {});
    // (the address back to the bare link's: a reload runs the whole bench again)
    const q = new URLSearchParams(location.search);
    q.set('bench', '');
    for (const k of LIFT_KEYS) q.delete(k);
    history.replaceState(null, '', `${location.pathname}?${q.toString().replace(/=(&|$)/g, '$1')}`);

    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;inset:0;z-index:100;background:#0d0f14;color:#e8e6df;overflow:auto;padding:calc(env(safe-area-inset-top) + 12px) 10px calc(env(safe-area-inset-bottom) + 12px);font:11px/1.4 ui-monospace,Menlo,monospace;-webkit-user-select:none;user-select:none;touch-action:manipulation';
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word;font:inherit';
    pre.textContent = text;
    if (!ok) pre.style.color = '#f6707a';
    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:12px;display:flex;gap:12px;align-items:flex-start';
    if (one?.thumb) {
      const img = document.createElement('img');
      img.src = one.thumb;
      img.style.cssText = 'width:72px;border:1px solid #444';
      foot.appendChild(img);
    }
    const tip = document.createElement('div');
    tip.style.cssText = 'font-weight:600;color:#ffd23e';
    tip.textContent = 'Screenshot this. Tap to copy it as text.';
    foot.appendChild(tip);
    el.append(pre, foot);
    el.addEventListener('click', () => {
      const done = () => (tip.textContent = 'Copied. Paste it in a message.');
      const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'width:100%;height:40vh;margin-top:10px;font:10px ui-monospace,Menlo,monospace';
        el.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        let copied = false;
        try {
          copied = document.execCommand('copy');
        } catch {
          /* the old way refused too */
        }
        tip.textContent = copied ? 'Copied. Paste it in a message.' : 'Select the text below and copy it.';
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    });
    document.body.appendChild(el);
  }
}

function build(): string {
  return typeof __SB_BUILD__ === 'string' ? __SB_BUILD__ : 'dev';
}

function setQA(qa: object | null) {
  (window as unknown as { __qa?: object | null }).__qa = qa;
}

/** Page 1's numbers from the address's # (none: page 2 opened by itself, and page 1's legs show as not run). */
function readOne(): PageOne | null {
  try {
    const raw = decodeURIComponent(location.hash.slice(1));
    return raw ? (JSON.parse(raw) as PageOne) : null;
  } catch {
    return null;
  }
}
