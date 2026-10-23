// Sound bench for src/audio: big buttons for manual listening, live sliders
// for the frame inputs, a realtime auto-fly demo, and an offline render of
// the scripted 20 s session through the SAME graph (OfflineAudioContext)
// with a level report, click detector, spectrogram and per-sound stems.
//
//   /dev/audio.html            interactive bench
//   /dev/audio.html?auto=1     render + analyse on load (window.__audioReport)
//   &stems=1                   also render isolated stems (window.__audioStems)
//   &seed=N                    RNG seed for the render
import { AudioEngine, type AudioFrame } from '../src/audio/AudioEngine';
import { audioTune } from '../src/audio/tune';
import { config } from '../src/config';
import { HUE_RAMPS, Ramp, rampColor } from '../src/render/palette';
import { fireEvent, sessionEvents, sessionFrame, SESSION_LENGTH, splatEvents, type SessionEvent } from './audioSession';

const params = new URLSearchParams(location.search);
const SR = 48000;

// ------------------------------------------------------------------ render

interface Script {
  seconds: number;
  frame(t: number, out: AudioFrame): AudioFrame;
  events: SessionEvent[];
  tune?: Partial<Record<keyof typeof audioTune, number>>;
}

let maxVoices = 0;

async function renderScript(s: Script, seed = 1): Promise<AudioBuffer> {
  maxVoices = 0;
  const saved: Record<string, number> = {};
  const tune = audioTune as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(s.tune ?? {})) {
    saved[k] = tune[k];
    tune[k] = v as number;
  }
  try {
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * s.seconds), SR);
    const eng = new AudioEngine();
    eng.attachContext(ctx, seed);
    const step = 512 / SR;
    const frame: AudioFrame = { speed: 0, surge: 0, fullness: 1, altitude: 30, paintNearby: 0, fogBank: 0 };
    const events = [...s.events].sort((a, b) => a.t - b.t);
    let ei = 0;
    const tick = (t: number, dt: number) => {
      s.frame(t, frame);
      eng.update(dt, frame);
      while (ei < events.length && events[ei].t <= t + step * 0.5) fireEvent(eng, events[ei++]);
      maxVoices = Math.max(maxVoices, eng.debugState().voices);
    };
    tick(0, 0);
    let k = 1;
    const next = () => {
      const t = k * step;
      if (t >= s.seconds - step) return;
      ctx.suspend(t).then(() => {
        tick(t, step);
        k++;
        next();
        ctx.resume();
      });
    };
    next();
    return await ctx.startRendering();
  } finally {
    for (const [k, v] of Object.entries(saved)) tune[k] = v;
  }
}

const SESSION: Script = { seconds: SESSION_LENGTH, frame: sessionFrame, events: sessionEvents() };

// ---------------------------------------------------------------- analysis

interface Click {
  t: number;
  ratio: number;
  ch: number;
}

export interface Report {
  sampleRate: number;
  seconds: number;
  renderMs: number;
  peak: number;
  peakDb: number;
  peakAt: number;
  over099: number;
  over095: number;
  nan: number;
  dc: [number, number];
  rmsDb: number[];
  phoneRmsDb: number[];
  clicks: { count: number; worst: Click[] };
  maxVoices: number;
  pass: boolean;
}

const db = (x: number) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

function highpass(x: Float32Array, sr: number, f: number): Float32Array {
  const w = (2 * Math.PI * f) / sr;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * 0.7071);
  const a0 = 1 + al;
  const b0 = (1 + cs) / 2 / a0, b1 = -(1 + cs) / a0, b2 = b0;
  const a1 = (-2 * cs) / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Isolated discontinuities: |2nd difference| far above the local level on BOTH sides. */
function findClicks(x: Float32Array, sr: number, ch: number, out: Click[]): void {
  const n = x.length;
  const W = 256;
  const d = new Float32Array(n);
  for (let i = 2; i < n; i++) d[i] = x[i] - 2 * x[i - 1] + x[i - 2];
  const P = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) P[i + 1] = P[i] + d[i] * d[i];
  let lastT = -1;
  for (let i = W + 4; i < n - W - 4; i++) {
    const a = Math.abs(d[i]);
    if (a < 0.003) continue;
    const before = (P[i - 2] - P[i - 2 - W]) / W;
    const after = (P[i + 3 + W] - P[i + 3]) / W;
    const ratio = a / (Math.sqrt(Math.max(before, after)) + 1e-7);
    if (ratio > 9) {
      const t = i / sr;
      if (t - lastT < 0.005 && out.length && out[out.length - 1].ch === ch) {
        if (ratio > out[out.length - 1].ratio) out[out.length - 1].ratio = ratio;
      } else out.push({ t, ratio, ch });
      lastT = t;
    }
  }
}

function analyze(buf: AudioBuffer, renderMs: number): Report {
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const n = buf.length;
  const sr = buf.sampleRate;
  let peak = 0, peakAt = 0, over099 = 0, over095 = 0, nan = 0, dcL = 0, dcR = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = R[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) {
      nan++;
      continue;
    }
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peak) {
      peak = a;
      peakAt = i / sr;
    }
    if (a > 0.99) over099++;
    if (a > 0.95) over095++;
    dcL += l;
    dcR += r;
  }
  const secs = Math.floor(n / sr);
  const hl = highpass(L, sr, 300);
  const hr = highpass(R, sr, 300);
  const rmsDb: number[] = [];
  const phoneRmsDb: number[] = [];
  for (let s = 0; s < secs; s++) {
    let e = 0, ep = 0;
    for (let i = s * sr; i < (s + 1) * sr; i++) {
      e += L[i] * L[i] + R[i] * R[i];
      ep += hl[i] * hl[i] + hr[i] * hr[i];
    }
    rmsDb.push(+db(Math.sqrt(e / (2 * sr))).toFixed(1));
    phoneRmsDb.push(+db(Math.sqrt(ep / (2 * sr))).toFixed(1));
  }
  const clicks: Click[] = [];
  findClicks(L, sr, 0, clicks);
  findClicks(R, sr, 1, clicks);
  clicks.sort((a, b) => b.ratio - a.ratio);
  const pass = peak < 0.95 && nan === 0 && over099 === 0;
  return {
    sampleRate: sr,
    seconds: n / sr,
    renderMs: Math.round(renderMs),
    peak: +peak.toFixed(4),
    peakDb: +db(peak).toFixed(2),
    peakAt: +peakAt.toFixed(3),
    over099,
    over095,
    nan,
    dc: [+(dcL / n).toExponential(2), +(dcR / n).toExponential(2)],
    rmsDb,
    phoneRmsDb,
    clicks: { count: clicks.length, worst: clicks.slice(0, Number(params.get('clicks') ?? 12)).map((c) => ({ t: +c.t.toFixed(4), ratio: +c.ratio.toFixed(1), ch: c.ch })) },
    maxVoices,
    pass,
  };
}

// ------------------------------------------------------------------- stems

const QUIET = { wind: 0, engine: 0, wheeze: 0, foghorn: 0, hum: 0, twinkleRate: 0 };
const ev = (t: number, kind: SessionEvent['kind'], a = 0, b = 0, c = 0, d = 0): SessionEvent => ({ t, kind, a, b, c, d, label: '' });
const still = (o: Partial<AudioFrame>) => (_t: number, out: AudioFrame) => Object.assign(out, { speed: 30, surge: 0, fullness: 0, altitude: 30, paintNearby: 0, fogBank: 0 }, o);

const STEMS: Array<{ name: string; s: Script; from: number; to: number }> = [
  { name: 'wind cruise', s: { seconds: 5, frame: still({}), events: [], tune: { ...QUIET, wind: 1 } }, from: 1, to: 5 },
  { name: 'wind surge', s: { seconds: 5, frame: still({ speed: 112, surge: 1, altitude: 60 }), events: [], tune: { ...QUIET, wind: 1 } }, from: 1, to: 5 },
  { name: 'engine cruise', s: { seconds: 4, frame: still({}), events: [], tune: { ...QUIET, engine: 1 } }, from: 1, to: 4 },
  { name: 'engine surge', s: { seconds: 4, frame: still({ speed: 112, surge: 1 }), events: [], tune: { ...QUIET, engine: 1 } }, from: 1, to: 4 },
  { name: 'breath full', s: { seconds: 7, frame: still({ fullness: 1 }), events: [], tune: { ...QUIET, wheeze: 1 } }, from: 1, to: 7 },
  { name: 'breath empty', s: { seconds: 7, frame: still({ fullness: 0 }), events: [], tune: { ...QUIET, wheeze: 1 } }, from: 1, to: 7 },
  { name: 'foghorn', s: { seconds: 8, frame: still({}), events: [ev(0.2, 'foghorn')], tune: { ...QUIET, foghorn: 1 } }, from: 0.5, to: 2.5 },
  { name: 'hum paint=1', s: { seconds: 6, frame: still({ paintNearby: 1 }), events: [], tune: { ...QUIET, hum: 1 } }, from: 2, to: 6 },
  { name: 'heave', s: { seconds: 3, frame: still({}), events: [ev(0.1, 'heave')], tune: QUIET }, from: 0.1, to: 1.4 },
  { name: 'splat impact', s: { seconds: 2, frame: still({}), events: [ev(0.1, 'impact', 1)], tune: QUIET }, from: 0.1, to: 0.6 },
  { name: 'cascade L1', s: { seconds: 4, frame: still({}), events: splatEvents(0, 1, 5, 0).filter((e) => e.kind === 'bloom'), tune: QUIET }, from: 0.3, to: 1.5 },
  { name: 'cascade L3', s: { seconds: 4, frame: still({}), events: splatEvents(0, 3, 5, 0).filter((e) => e.kind === 'bloom'), tune: QUIET }, from: 0.3, to: 1.5 },
  { name: 'full splat L1', s: { seconds: 4, frame: still({}), events: splatEvents(0.1, 1, 5, 0), tune: QUIET }, from: 0.1, to: 1.6 },
  { name: 'ready', s: { seconds: 1.5, frame: still({}), events: [ev(0.1, 'ready')], tune: QUIET }, from: 0.1, to: 0.4 },
  { name: 'denied', s: { seconds: 1.5, frame: still({}), events: [ev(0.1, 'denied')], tune: QUIET }, from: 0.1, to: 0.4 },
  { name: 'sign pop', s: { seconds: 2, frame: still({}), events: [ev(0.1, 'sign')], tune: QUIET }, from: 0.1, to: 0.6 },
  // robustness: garbage inputs must never produce NaN or noise bursts
  { name: 'fuzz', s: { seconds: 4, frame: fuzzFrame, events: fuzzEvents(), tune: {} }, from: 0, to: 4 },
  // spam: a level-3 re-splat every 0.12 s for 3 s, on top of everything
  { name: 'stress', s: { seconds: 4, frame: still({ paintNearby: 1, speed: 112, surge: 1, fullness: 1 }), events: stressEvents(), tune: {} }, from: 0, to: 4 },
];

function fuzzFrame(t: number, out: AudioFrame): AudioFrame {
  const k = Math.floor(t * 10) % 5;
  const bad = [NaN, Infinity, -Infinity, -50, 1e9][k];
  out.speed = k === 0 ? bad : 30;
  out.surge = k === 1 ? bad : 0.5;
  out.fullness = k === 2 ? bad : 1;
  out.altitude = k === 3 ? bad : 30;
  out.paintNearby = k === 4 ? bad : 0.5;
  out.fogBank = bad;
  return out;
}

function fuzzEvents(): SessionEvent[] {
  const out: SessionEvent[] = [];
  const junk = [NaN, Infinity, -Infinity, -3, 1e6, 0.5];
  for (let i = 0; i < 24; i++) {
    const j = junk[i % junk.length];
    out.push(ev(0.1 + i * 0.15, (['heave', 'impact', 'bloom', 'ready', 'denied', 'sign'] as const)[i % 6], j, j, j, j));
  }
  return out;
}

function stressEvents(): SessionEvent[] {
  const out: SessionEvent[] = [];
  for (let i = 0; i < 25; i++) out.push(...splatEvents(0.05 + i * 0.12, 3, 8, i % 6));
  out.push(ev(0.2, 'foghorn'), ev(1, 'sign'), ev(1.5, 'sign'), ev(2, 'ready'));
  return out;
}

interface StemRow {
  name: string;
  peakDb: number;
  rmsDb: number;
  phoneRmsDb: number;
  nan: number;
}

async function renderStems(seed: number): Promise<StemRow[]> {
  const rows: StemRow[] = [];
  for (const st of STEMS) {
    const buf = await renderScript(st.s, seed);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const hl = highpass(L, SR, 300);
    const hr = highpass(R, SR, 300);
    let pk = 0, e = 0, ep = 0, nan = 0;
    const a = Math.floor(st.from * SR), b = Math.min(buf.length, Math.floor(st.to * SR));
    for (let i = 0; i < buf.length; i++) {
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) nan++;
      else pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    }
    for (let i = a; i < b; i++) {
      e += L[i] * L[i] + R[i] * R[i];
      ep += hl[i] * hl[i] + hr[i] * hr[i];
    }
    const m = 2 * (b - a);
    rows.push({ name: st.name, peakDb: +db(pk).toFixed(1), rmsDb: +db(Math.sqrt(e / m)).toFixed(1), phoneRmsDb: +db(Math.sqrt(ep / m)).toFixed(1), nan });
  }
  return rows;
}

// ------------------------------------------------------------------ visual

const C = {
  bg: rampColor(Ramp.FOG, 2),
  panel: rampColor(Ramp.INK, 1),
  ink: rampColor(Ramp.INK, 0),
  text: rampColor(Ramp.GLOW_WHITE, 6),
  dim: rampColor(Ramp.FOG, 5),
  grid: rampColor(Ramp.INK, 4),
  wave: rampColor(Ramp.GLOW_WHITE, 5),
  warn: rampColor(Ramp.RED, 5),
};

// discrete palette heat map (no blending: the palette is locked)
const HEAT = [
  rampColor(Ramp.INK, 0),
  rampColor(Ramp.INK, 2),
  rampColor(Ramp.VIOLET, 0),
  rampColor(Ramp.VIOLET, 1),
  rampColor(Ramp.VIOLET, 2),
  rampColor(Ramp.RED, 2),
  rampColor(Ramp.RED, 3),
  rampColor(Ramp.RED, 4),
  rampColor(Ramp.ORANGE, 4),
  rampColor(Ramp.ORANGE, 5),
  rampColor(Ramp.YELLOW, 5),
  rampColor(Ramp.YELLOW, 6),
  rampColor(Ramp.YELLOW, 7),
  rampColor(Ramp.GLOW_WHITE, 7),
];

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

function eventColor(e: SessionEvent): string {
  switch (e.kind) {
    case 'heave':
      return rampColor(Ramp.BUS_YELLOW, 6);
    case 'bloom':
      return rampColor(HUE_RAMPS[Math.round(e.c) % 6], 5);
    case 'foghorn':
      return rampColor(Ramp.FOG, 7);
    case 'sign':
      return rampColor(Ramp.SIGN_GREEN, 6);
    case 'ready':
      return rampColor(Ramp.GREEN, 6);
    default:
      return rampColor(Ramp.RED, 6);
  }
}

function draw(canvas: HTMLCanvasElement, buf: AudioBuffer, rep: Report, events: SessionEvent[]): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(320, Math.floor(canvas.clientWidth));
  const H = Math.floor(W < 600 ? 520 : 560);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = false;
  g.fillStyle = C.panel;
  g.fillRect(0, 0, W, H);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const n = buf.length;
  const sr = buf.sampleRate;
  const pad = 8;
  const x0 = 34, x1 = W - pad;
  const cw = x1 - x0;
  const vFrom = Math.max(0, Number(params.get('from') ?? 0));
  const vTo = Math.min(n / sr, Number(params.get('to') ?? n / sr));
  const i0 = Math.floor(vFrom * sr);
  const vn = Math.max(1, Math.floor(vTo * sr) - i0);
  const tx = (t: number) => x0 + ((t - vFrom) / (vn / sr)) * cw;
  g.font = '10px ui-monospace, Menlo, monospace';
  g.textBaseline = 'top';

  // waveform
  const wy0 = 30, wh = 90;
  g.fillStyle = C.ink;
  g.fillRect(x0, wy0, cw, wh);
  const mid = wy0 + wh / 2;
  for (const lv of [0.95, -0.95]) {
    g.fillStyle = C.warn;
    for (let x = x0; x < x1; x += 4) g.fillRect(x, Math.round(mid - lv * (wh / 2)), 2, 1);
  }
  g.fillStyle = C.wave;
  const spp = vn / cw;
  for (let x = 0; x < cw; x++) {
    let mn = 0, mx = 0;
    const a = i0 + Math.floor(x * spp), b = Math.min(n, i0 + Math.floor((x + 1) * spp));
    for (let i = a; i < b; i++) {
      const v = (L[i] + R[i]) * 0.5;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const ya = Math.round(mid - mx * (wh / 2)), yb = Math.round(mid - mn * (wh / 2));
    g.fillRect(x0 + x, ya, 1, Math.max(1, yb - ya));
  }
  g.fillStyle = C.dim;
  g.fillText('wave', 2, wy0);
  g.fillText('±.95', 2, wy0 + 12);

  // spectrogram (log frequency 40 Hz .. 16 kHz)
  const sy0 = wy0 + wh + 10, sh = H - sy0 - 112;
  const N = 2048;
  const re = new Float64Array(N), im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const fLo = 40, fHi = 16000;
  const binOf = new Int32Array(sh);
  for (let y = 0; y < sh; y++) {
    const f = fLo * Math.pow(fHi / fLo, 1 - y / (sh - 1));
    binOf[y] = Math.max(1, Math.min(N / 2 - 1, Math.round((f / sr) * N)));
  }
  const img = g.createImageData(cw, sh);
  const heatRGB = HEAT.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const mag = new Float64Array(N / 2);
  for (let x = 0; x < cw; x++) {
    const c = i0 + Math.floor((x + 0.5) * spp) - N / 2;
    for (let i = 0; i < N; i++) {
      const k = c + i;
      re[i] = k >= 0 && k < n ? ((L[k] + R[k]) * 0.5) * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]) / (N / 4);
    for (let y = 0; y < sh; y++) {
      const b = binOf[y];
      const b2 = y + 1 < sh ? binOf[y + 1] : b;
      let m = 0;
      for (let k = Math.min(b, b2); k <= Math.max(b, b2); k++) if (mag[k] > m) m = mag[k];
      const d = db(m);
      const u = Math.max(0, Math.min(1, (d + 96) / 80));
      const col = heatRGB[Math.min(HEAT.length - 1, Math.floor(u * HEAT.length))];
      const o = (y * cw + x) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  // putImageData ignores the transform: go through an offscreen canvas
  const oc = document.createElement('canvas');
  oc.width = cw;
  oc.height = sh;
  oc.getContext('2d')!.putImageData(img, 0, 0);
  g.drawImage(oc, x0, sy0, cw, sh);
  g.fillStyle = C.dim;
  for (const f of [100, 300, 1000, 3000, 10000]) {
    const y = sy0 + (1 - Math.log(f / fLo) / Math.log(fHi / fLo)) * (sh - 1);
    g.fillRect(x0 - 4, Math.round(y), 3, 1);
    g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), 2, Math.round(y) - 5);
  }

  // per-second RMS bars (full / phone speaker)
  const by0 = sy0 + sh + 14, bh = 56;
  g.fillStyle = C.ink;
  g.fillRect(x0, by0, cw, bh);
  const secs = rep.rmsDb.length;
  for (let s = Math.floor(vFrom); s < Math.min(secs, Math.ceil(vTo)); s++) {
    const xa = Math.max(x0, Math.round(tx(s)) + 1), xb = Math.min(x1, Math.round(tx(s + 1)) - 1);
    const hFull = Math.max(0, ((rep.rmsDb[s] + 60) / 60) * bh);
    const hPh = Math.max(0, ((rep.phoneRmsDb[s] + 60) / 60) * bh);
    g.fillStyle = rampColor(HUE_RAMPS[s % 6], 3);
    g.fillRect(xa, by0 + bh - hFull, xb - xa, hFull);
    g.fillStyle = rampColor(HUE_RAMPS[s % 6], 6);
    g.fillRect(xa, by0 + bh - hPh, xb - xa, Math.min(3, hPh));
  }
  g.fillStyle = C.dim;
  g.fillText('rms', 2, by0);
  g.fillText('-60', 2, by0 + bh - 10);

  // event markers + seconds grid
  const tickStep = vTo - vFrom > 6 ? 1 : 0.1;
  for (let s = Math.ceil(vFrom / tickStep) * tickStep; s <= vTo + 1e-6; s += tickStep) {
    g.fillStyle = C.grid;
    g.fillRect(Math.round(tx(s)), by0 + bh + 2, 1, 4);
    const lab = Math.round(s / tickStep);
    if (lab % 2 === 0) {
      g.fillStyle = C.dim;
      g.fillText((tickStep < 1 ? s.toFixed(1) : String(Math.round(s))) + 's', Math.round(tx(s)) - 4, by0 + bh + 7);
    }
  }
  const rowEnd = [-1e9, -1e9];
  for (const e of events) {
    if (e.t < vFrom || e.t > vTo) continue;
    const x = Math.round(tx(e.t));
    let row = 0;
    if (e.label) {
      row = x > rowEnd[0] ? 0 : x > rowEnd[1] ? 1 : 0;
      rowEnd[row] = x + g.measureText(e.label).width + 6;
    }
    g.fillStyle = eventColor(e);
    if (e.kind === 'bloom') g.fillRect(x, sy0 - 6, 1, 5);
    else {
      g.fillRect(x, wy0, 1, wh);
      g.fillRect(x, sy0 - 6, 1, 5);
    }
    if (e.label) g.fillText(e.label, x + 2, 3 + row * 12);
  }
  // clicks
  g.fillStyle = C.warn;
  for (const c of rep.clicks.worst) if (c.t >= vFrom && c.t <= vTo) g.fillRect(Math.round(tx(c.t)) - 1, wy0 + wh - 6, 3, 6);
  // headline
  g.fillStyle = rep.pass ? rampColor(Ramp.GREEN, 6) : C.warn;
  const head = `peak ${rep.peak.toFixed(3)} (${rep.peakDb} dBFS)  >0.99: ${rep.over099}  NaN: ${rep.nan}  clicks: ${rep.clicks.count}`;
  g.fillText(head, x0, by0 + bh + 20);
}

// ---------------------------------------------------------------- the page

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

let lastRender: AudioBuffer | null = null;

async function runOffline(): Promise<Report> {
  const seed = Number(params.get('seed') ?? 1);
  const status = $('#status');
  // ?stem=<name> renders one isolated stem instead of the session (inspection)
  const stem = STEMS.find((st) => st.name === params.get('stem'));
  const script = stem ? stem.s : SESSION;
  status.textContent = stem ? `rendering stem "${stem.name}"…` : 'rendering 20 s offline…';
  await new Promise((r) => setTimeout(r, 30));
  const t0 = performance.now();
  const buf = await renderScript(script, seed);
  const rep = analyze(buf, performance.now() - t0);
  lastRender = buf;
  draw($('#viz'), buf, rep, script.events);
  status.textContent = rep.pass ? 'render clean' : 'render FAILED limits';
  $('#report').textContent = JSON.stringify({ ...rep, rmsDb: rep.rmsDb.join(' '), phoneRmsDb: rep.phoneRmsDb.join(' ') }, null, 1);
  return rep;
}

function buildUI(eng: AudioEngine): void {
  const live: AudioFrame = { speed: 30, surge: 0, fullness: 1, altitude: 30, paintNearby: 0, fogBank: 0 };
  const sliders: Array<[keyof AudioFrame, number, number, number]> = [
    ['speed', 0, 115, 1],
    ['surge', 0, 1, 0.01],
    ['fullness', 0, 1, 0.01],
    ['altitude', 0, 120, 1],
    ['paintNearby', 0, 1, 0.01],
    ['fogBank', 0, 1, 0.01],
  ];
  const sl = $('#sliders');
  const inputs = new Map<keyof AudioFrame, HTMLInputElement>();
  for (const [k, a, b, s] of sliders) {
    const row = document.createElement('label');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = k;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = String(a);
    inp.max = String(b);
    inp.step = String(s);
    inp.value = String(live[k]);
    const val = document.createElement('b');
    val.textContent = inp.value;
    inp.oninput = () => {
      live[k] = Number(inp.value);
      val.textContent = inp.value;
    };
    row.append(name, inp, val);
    sl.append(row);
    inputs.set(k, inp);
  }

  // manual splat state (belly)
  const pending: SessionEvent[] = [];
  let bellyStart = -100;
  let readyFired = true;
  let hueNext = 0;
  let auto = false;
  let autoT = 0;
  let autoEvents: SessionEvent[] = [];
  let clock = 0;
  const belly = () => {
    const u = clock - bellyStart;
    const d = config.splat.duration;
    if (u < d) return 0;
    return Math.min(1, (u - d) / config.splat.recharge);
  };
  const splat = (level: number) => {
    if (!eng.unlocked) eng.unlock();
    if (belly() < 1) {
      eng.denied();
      return;
    }
    bellyStart = clock;
    readyFired = false;
    pending.push(...splatEvents(clock, level, 5, hueNext));
    hueNext = (hueNext + 1) % 6;
    pending.sort((a, b) => a.t - b.t);
  };

  const btn = (label: string, cls: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = cls;
    b.onclick = () => {
      eng.unlock(); // inside the gesture, every time (cheap, iOS-safe)
      fn();
    };
    $('#pads').append(b);
    return b;
  };
  btn('SPLAT!', 'big h0', () => splat(1));
  btn('re-splat L2', 'h1', () => splat(2));
  btn('re-splat L3', 'h2', () => splat(3));
  btn('heave', 'h3', () => eng.heave());
  btn('impact', 'h4', () => eng.splatImpact(1));
  let bi = 0;
  btn('bloom note', 'h5', () => {
    eng.bloomNote(bi, 5, bi % 6, 1);
    bi = (bi + 1) % 5;
  });
  btn('ready', 'h3', () => eng.ready());
  btn('denied', 'h0', () => eng.denied());
  btn('sign pop', 'h4', () => eng.signPop());
  btn('foghorn', 'grey', () => eng.foghorn());
  let muted = false;
  const mb = btn('mute', 'grey', () => {
    muted = !muted;
    eng.setMuted(muted);
    mb.textContent = muted ? 'unmute' : 'mute';
  });
  const ab = btn('auto-fly 20 s', 'h1 wide', () => {
    auto = !auto;
    autoT = 0;
    autoEvents = sessionEvents();
    ab.textContent = auto ? 'stop auto-fly' : 'auto-fly 20 s';
  });

  $('#start').onclick = () => {
    eng.unlock();
    $('#start').classList.add('on');
    $('#start').textContent = 'audio on — tap pads';
  };
  $('#render').onclick = () => void runOffline();
  $('#play').onclick = () => {
    eng.unlock();
    const ctx = eng.context as AudioContext | null;
    if (!ctx || !lastRender) return;
    const s = ctx.createBufferSource();
    s.buffer = lastRender;
    s.connect(ctx.destination);
    s.start();
  };
  $('#stems').onclick = async () => {
    $('#status').textContent = 'rendering stems…';
    const rows = await renderStems(1);
    $('#report').textContent = rows.map((r) => `${r.name.padEnd(14)} peak ${String(r.peakDb).padStart(6)}  rms ${String(r.rmsDb).padStart(6)}  phone ${String(r.phoneRmsDb).padStart(6)}`).join('\n');
    $('#status').textContent = 'stems (dBFS)';
  };

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    if (auto) {
      autoT += dt;
      if (autoT >= SESSION_LENGTH) {
        autoT = 0;
        autoEvents = sessionEvents();
      }
      sessionFrame(autoT, live);
      while (autoEvents.length && autoEvents[0].t <= autoT) fireEvent(eng, autoEvents.shift()!);
      for (const [k, inp] of inputs) inp.value = String(live[k]);
    } else {
      if (clock - bellyStart < config.splat.duration + config.splat.recharge + 0.1) {
        live.fullness = belly();
        inputs.get('fullness')!.value = String(live.fullness);
      }
      if (!readyFired && belly() >= 1) {
        readyFired = true;
        eng.ready();
      }
      while (pending.length && pending[0].t <= clock) fireEvent(eng, pending.shift()!);
    }
    eng.update(dt, live);
    const st = eng.debugState();
    $('#live').textContent = `${st.state} · chord ${st.chord} · voices ${st.voices}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Cost probe: graph build time and pure render speed (no suspends), min of 3 runs, grey idle vs busy painted. */
async function bench(): Promise<Record<string, number | string>> {
  const once = async (busy: boolean) => {
    const ctx = new OfflineAudioContext(2, SR * 20, SR);
    const t0 = performance.now();
    const eng = new AudioEngine();
    eng.attachContext(ctx, 3);
    const build = performance.now() - t0;
    eng.update(0, { speed: 60, surge: busy ? 0.5 : 0, fullness: 1, altitude: 40, paintNearby: busy ? 1 : 0, fogBank: 0 });
    if (busy) {
      eng.heave();
      eng.splatImpact(1);
      for (let i = 0; i < 5; i++) eng.bloomNote(i, 5, i, 3);
      eng.foghorn();
    }
    const t1 = performance.now();
    await ctx.startRendering();
    return [build, performance.now() - t1];
  };
  let build = Infinity, idle = Infinity, busy = Infinity;
  for (let i = 0; i < 3; i++) {
    const [b, r] = await once(false);
    build = Math.min(build, b);
    idle = Math.min(idle, r);
    busy = Math.min(busy, (await once(true))[1]);
  }
  const probe = new OfflineAudioContext(1, 128, SR).createBiquadFilter().frequency as AudioParam & { automationRate?: string };
  probe.automationRate = 'k-rate';
  return {
    buildMs: +build.toFixed(1),
    idle20sMs: Math.round(idle),
    busy20sMs: Math.round(busy),
    idlePct: +((idle / 20000) * 100).toFixed(2),
    busyPct: +((busy / 20000) * 100).toFixed(2),
    kRate: String(probe.automationRate),
  };
}

const engine = new AudioEngine();
buildUI(engine);
const w = window as unknown as Record<string, unknown>;
w.__engine = engine;
w.__bench = bench;
w.__audioPCM = () => {
  // interleaved 16-bit PCM of the last offline render, base64
  const b = lastRender;
  if (!b) return null;
  const L = b.getChannelData(0), R = b.getChannelData(1);
  const pcm = new Int16Array(b.length * 2);
  for (let i = 0; i < b.length; i++) {
    pcm[2 * i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
    pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
  }
  const bytes = new Uint8Array(pcm.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { sampleRate: b.sampleRate, channels: 2, b64: btoa(s) };
};
if (params.get('auto')) {
  runOffline()
    .then(async (rep) => {
      w.__audioReport = rep;
      if (params.get('stems')) w.__audioStems = await renderStems(Number(params.get('seed') ?? 1));
      w.__shotReady = true;
    })
    .catch((e) => {
      w.__audioReport = { error: String(e && (e as Error).stack ? (e as Error).stack : e) };
      w.__shotReady = true;
    });
}
