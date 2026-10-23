// Input bench: the real Input / Tuner / Perf over the harness city blocks,
// with a 2D overlay that draws the bungee (anchor, finger, saturated stretch,
// leash ring) and every tap / triple-finger / first-gesture event.
// ?tune opens the tuner, ?fps shows the meter, ?bg=0 skips the 3D backdrop.
// window.__input exposes counters + an event log for scripted tests.
import { applySavedTuning, Tuner } from '../src/ui/Tuner';
import { Perf } from '../src/ui/Perf';
import { Input, inputTune } from '../src/game/Input';
import { config } from '../src/config';

/** The DOM event being dispatched right now (proves callbacks fire synchronously inside it). */
const curEvent = () => (window as unknown as { event?: Event }).event?.type ?? 'none';
import { HUE_RAMPS, rampColor, Ramp } from '../src/render/palette';
import { createHarness } from './harness';

applySavedTuning();
const params = new URLSearchParams(location.search);
const useBg = params.get('bg') !== '0';
const game = document.getElementById('game') as HTMLCanvasElement;
const viz = document.getElementById('viz') as HTMLCanvasElement;
const g = viz.getContext('2d')!;

let perf: Perf | null = null;
if (useBg) {
  const h = createHarness();
  h.target.set(0, 6, 0);
  perf = new Perf(h.pipeline.renderer);
  perf.setVisible(params.has('fps'));
  h.ready();
} else {
  game.style.background = 'linear-gradient(#a7aeb5, #6f7882)';
  (window as unknown as { __shotReady: boolean }).__shotReady = true;
}

// late-registering module groups, like the real game (exercises onTunablesChanged)
void import('../src/bus/BusModel').catch(() => {});
void import('../src/fx/Particles').catch(() => {});
void import('../src/audio/tune').then((m) => m.registerAudioTunables()).catch(() => {});

const input = new Input(game);
const tuner = new Tuner();
tuner.onResetPaint = () => log('reset paint');
tuner.onAction = (name) => log(`tuner: ${name}`);

interface Ev {
  t: number;
  kind: string;
  detail: string;
}
const stats = {
  taps: 0,
  triples: 0,
  first: 0,
  /** event type each callback fired inside */
  tapIn: [] as string[],
  tripleIn: [] as string[],
  firstIn: [] as string[],
  /** duration (ms, event clock) of the last released pointer */
  lastDur: 0,
  /** event-clock times of recent pointerdowns */
  downT: [] as number[],
  events: [] as Ev[],
  state: input.state,
  tunerVisible: () => tuner.visible,
};
Object.assign(window, { __input: stats, __inputObj: input, __tuner: tuner, __config: config });

function log(kind: string, detail = '') {
  stats.events.push({ t: Math.round(performance.now()), kind, detail });
  if (stats.events.length > 200) stats.events.shift();
}

// where fingers are, so taps can ripple at the right spot (the bench only)
const downAt = new Map<number, { x: number; y: number; t: number }>();
let lastDown = { x: innerWidth / 2, y: innerHeight / 2 };
let lastUp = lastDown;
// capture phase on window: runs before Input's own handlers, so onTap knows where the finger is
window.addEventListener('pointerdown', (e) => {
  const p = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  downAt.set(e.pointerId, p);
  lastDown = p;
  stats.downT.push(Math.round(e.timeStamp));
  if (stats.downT.length > 8) stats.downT.shift();
}, true);
window.addEventListener('pointerup', (e) => {
  const d = downAt.get(e.pointerId);
  if (d) stats.lastDur = Math.round(e.timeStamp - d.t);
  lastUp = d ?? { x: e.clientX, y: e.clientY };
  downAt.delete(e.pointerId);
}, true);
window.addEventListener('pointercancel', (e) => downAt.delete(e.pointerId), true);

interface Ripple {
  x: number;
  y: number;
  t0: number;
  hue: number;
  label: string;
}
const ripples: Ripple[] = [];
let hueI = 0;
let tripleFlash = -1;

input.onFirstGesture = () => {
  stats.first++;
  stats.firstIn.push(curEvent());
  log('firstGesture', curEvent());
};
input.onTap = () => {
  stats.taps++;
  stats.tapIn.push(curEvent());
  const steering = input.state.dragging;
  // a second-finger tap fires on its pointerdown; a plain tap on pointerup
  const ev = curEvent();
  const at = ev === 'pointerdown' ? lastDown : ev === 'pointerup' ? lastUp : ev === 'keydown' ? { x: innerWidth / 2, y: innerHeight * 0.45 } : lastDown;
  log('tap', steering ? 'second finger' : 'tap');
  ripples.push({ x: at.x, y: at.y, t0: performance.now(), hue: hueI++ % 6, label: steering ? '2ND FINGER' : 'TAP' });
  if (ripples.length > 12) ripples.shift();
};
input.onTripleFinger = () => {
  stats.triples++;
  stats.tripleIn.push(curEvent());
  log('triple');
  tripleFlash = performance.now();
  tuner.toggle();
};

// ---------------------------------------------------------------- drawing

const HUE = HUE_RAMPS.map((r) => rampColor(r, 4));
const HUE_L = HUE_RAMPS.map((r) => rampColor(r, 6));
const BUS = rampColor(Ramp.BUS_YELLOW, 5);
const BUS_D = rampColor(Ramp.BUS_YELLOW, 2);
const INK = rampColor(Ramp.INK, 0);
const WHITE = rampColor(Ramp.GLOW_WHITE, 6);
let dpr = 1;
function resize() {
  dpr = Math.min(3, devicePixelRatio || 1);
  viz.width = Math.round(innerWidth * dpr);
  viz.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

function ring(x: number, y: number, r: number, color: string, w: number, dash?: number[]) {
  g.beginPath();
  g.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.setLineDash(dash ?? []);
  g.stroke();
  g.setLineDash([]);
}

function dot(x: number, y: number, r: number, fill: string, stroke = INK, w = 2.5) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = w;
  g.strokeStyle = stroke;
  g.stroke();
}

function text(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', font = FONT, weight = 600) {
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = align;
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(11,14,19,.55)';
  g.strokeText(s, x, y);
  g.fillStyle = color;
  g.fillText(s, x, y);
}

function draw(now: number) {
  const W = innerWidth;
  const H = innerHeight;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const st = input.state;
  const px = config.flight.stretchPx;

  // title + how-to at the bottom (the perf meter owns the top-left corner)
  const top = 18;
  if (!tuner.visible) {
    text('INPUT BENCH', W / 2, H - 52, 13, WHITE, 'center', FONT, 800);
    text('drag = steer · tap = splat · 2nd finger = splat', W / 2, H - 34, 11, 'rgba(255,251,232,.85)', 'center', FONT, 500);
    text('3 fingers = tuner · keys: WASD / arrows, Space', W / 2, H - 19, 11, 'rgba(255,251,232,.85)', 'center', FONT, 500);
  }

  if (st.anchor && st.finger) {
    const a = st.anchor;
    const f = st.finger;
    const rect = game.getBoundingClientRect();
    const ax = a.x + rect.left, ay = a.y + rect.top;
    const fx = f.x + rect.left, fy = f.y + rect.top;
    ring(ax, ay, inputTune.leash * px, 'rgba(255,251,232,.28)', 1.5, [5, 6]);
    ring(ax, ay, px, st.dragging ? 'rgba(251,191,36,.55)' : 'rgba(255,255,255,.3)', 2);
    ring(ax, ay, config.flight.deadZonePx, 'rgba(255,255,255,.5)', 1);
    // the bungee: a rubber band that thins as it stretches
    const len = Math.hypot(fx - ax, fy - ay);
    const sm = Math.hypot(st.stretch.x, st.stretch.y);
    const band = Math.max(3, 11 - len * 0.045);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(fx, fy);
    g.strokeStyle = INK;
    g.lineWidth = band + 4;
    g.stroke();
    g.strokeStyle = sm > 0.97 ? HUE[0] : BUS;
    g.lineWidth = band;
    g.stroke();
    // effective (saturated) stretch vector
    if (st.dragging && sm > 0.001) {
      const ex = ax + st.stretch.x * px;
      const ey = ay - st.stretch.y * px;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(ex, ey);
      g.strokeStyle = HUE[4];
      g.lineWidth = 3;
      g.stroke();
      const ang = Math.atan2(ey - ay, ex - ax);
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(ex - Math.cos(ang - 0.45) * 11, ey - Math.sin(ang - 0.45) * 11);
      g.lineTo(ex - Math.cos(ang + 0.45) * 11, ey - Math.sin(ang + 0.45) * 11);
      g.closePath();
      g.fillStyle = HUE[4];
      g.fill();
    }
    dot(ax, ay, 9, BUS, INK, 3);
    dot(ax, ay, 3, BUS_D, BUS_D, 0.1);
    dot(fx, fy, 16, 'rgba(255,251,232,.25)', WHITE, 2.5);
    dot(fx, fy, 4, WHITE, INK, 1.5);
  }

  // every finger's touch-down point once more than one is down
  if (downAt.size > 1) for (const p of downAt.values()) ring(p.x, p.y, 22, 'rgba(255,251,232,.7)', 2.5);

  // ripples
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    const k = (now - r.t0) / 700;
    if (k >= 1) {
      ripples.splice(i, 1);
      continue;
    }
    const e = 1 - Math.pow(1 - k, 3);
    g.globalAlpha = 1 - k;
    ring(r.x, r.y, 14 + e * 70, HUE[r.hue], 7 * (1 - k) + 1.5);
    ring(r.x, r.y, 8 + e * 44, HUE_L[(r.hue + 1) % 6], 3 * (1 - k) + 1);
    text(r.label, r.x, r.y - 34 - e * 30, 13, HUE_L[r.hue], 'center', FONT, 800);
    g.globalAlpha = 1;
  }
  if (tripleFlash > 0) {
    const k = (now - tripleFlash) / 900;
    if (k < 1) {
      g.globalAlpha = 1 - k;
      for (let i = 0; i < 6; i++) ring(W / 2, H * 0.3, 30 + i * 14 + k * 90, HUE[i], 5);
      text('THREE FINGERS', W / 2, H * 0.3 + 6, 15, WHITE, 'center', FONT, 800);
      g.globalAlpha = 1;
    } else tripleFlash = -1;
  }

  // stretch gauge (top-right) + readout
  const gx = W - 58, gy = top + 98, gr = 34;
  g.fillStyle = 'rgba(11,14,19,.55)';
  g.beginPath();
  g.arc(gx, gy, gr + 8, 0, Math.PI * 2);
  g.fill();
  ring(gx, gy, gr, 'rgba(255,255,255,.35)', 1.5);
  g.fillStyle = 'rgba(255,255,255,.18)';
  g.fillRect(gx - gr, gy, gr * 2, 1);
  g.fillRect(gx, gy - gr, 1, gr * 2);
  dot(gx + st.stretch.x * gr, gy - st.stretch.y * gr, 6, st.dragging ? BUS : 'rgba(255,255,255,.4)', INK, 2);
  text(`x ${fmt(st.stretch.x)}`, gx, gy + gr + 24, 11, WHITE, 'center', MONO, 600);
  text(`y ${fmt(st.stretch.y)}`, gx, gy + gr + 38, 11, WHITE, 'center', MONO, 600);
  text(st.dragging ? 'STEERING' : 'idle', gx, gy + gr + 54, 11, st.dragging ? BUS : 'rgba(255,251,232,.7)', 'center', FONT, 800);

  // counters + log (left)
  const lx = 14;
  let ly = top + (perf?.visible ? 150 : 8);
  text(`taps ${stats.taps}   triples ${stats.triples}   first ${stats.first}`, lx, ly, 12, WHITE, 'left', MONO, 700);
  ly += 8;
  const recent = stats.events.slice(-6);
  for (let i = recent.length - 1; i >= 0; i--) {
    ly += 17;
    const e = recent[i];
    const age = (now - e.t) / 1000;
    g.globalAlpha = Math.max(0.35, 1 - age / 6);
    text(`${e.kind}${e.detail ? ' · ' + e.detail : ''}`, lx, ly, 12, e.kind === 'tap' ? HUE_L[2] : e.kind === 'triple' ? HUE_L[5] : WHITE, 'left', FONT, 600);
    g.globalAlpha = 1;
  }
}

function fmt(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

let last = performance.now();
function frame(now: number) {
  const t0 = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  input.update(dt);
  draw(now);
  perf?.frame(dt * 1000, performance.now() - t0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (params.has('tune')) tuner.toggle();
