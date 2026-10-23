// Scripted 20 s flight used by the offline render (tools/audio-check.mjs) and
// the realtime "auto-fly" demo on dev/audio.html: open in the fog bank, cruise,
// four splats with cascades (levels 1, 2, 3, 1; the third during a re-splat),
// a surge, a hover, two sign pops, ready + denied taps, a late foghorn.
import type { AudioEngine, AudioFrame } from '../src/audio/AudioEngine';
import { config } from '../src/config';

export type EventKind = 'heave' | 'impact' | 'bloom' | 'ready' | 'denied' | 'sign' | 'foghorn';

export interface SessionEvent {
  t: number;
  kind: EventKind;
  /** impact: strength; bloom: index */
  a: number;
  /** bloom: total */
  b: number;
  /** bloom: hue */
  c: number;
  /** bloom: level */
  d: number;
  label: string;
}

export const SESSION_LENGTH = 20;

const SPLATS: Array<{ t: number; level: number; count: number; hue: number }> = [
  { t: 3.0, level: 1, count: 5, hue: 0 },
  { t: 7.0, level: 2, count: 4, hue: 1 },
  { t: 10.5, level: 3, count: 5, hue: 2 },
  { t: 14.0, level: 1, count: 3, hue: 3 },
];

/** Hue of building i in a splat fan centred on `center`: c, c+1, c-1, c+2, c-2 ... */
export function fanHue(center: number, i: number): number {
  const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
  return (((center + k) % 6) + 6) % 6;
}

/** The events of one splat starting at t0 (the tap). */
export function splatEvents(t0: number, level: number, count: number, hue: number): SessionEvent[] {
  const s = config.splat;
  const ev: SessionEvent[] = [];
  const e = (t: number, kind: EventKind, a = 0, b = 0, c = 0, d = 0, label = '') => ev.push({ t, kind, a, b, c, d, label });
  e(t0, 'heave', 0, 0, 0, 0, `splat L${level}`);
  e(t0 + s.impactDelay, 'impact', 1);
  const hitStop = s.hitStopFrames / 60;
  for (let i = 0; i < count; i++) {
    const t = t0 + s.impactDelay + (i === 0 ? 0 : hitStop + i * s.cascadeStep);
    e(t, 'bloom', i, count, fanHue(hue, i), level);
  }
  return ev;
}

export function sessionEvents(): SessionEvent[] {
  const ev: SessionEvent[] = [];
  const recharge = config.splat.duration + config.splat.recharge;
  for (const sp of SPLATS) {
    ev.push(...splatEvents(sp.t, sp.level, sp.count, sp.hue));
    ev.push({ t: sp.t + recharge, kind: 'ready', a: 0, b: 0, c: 0, d: 0, label: 'ready' });
  }
  const add = (t: number, kind: EventKind, label: string) => ev.push({ t, kind, a: 0, b: 0, c: 0, d: 0, label });
  add(4.2, 'denied', 'denied');
  add(4.42, 'denied', '');
  add(11.7, 'denied', 'denied');
  add(8.6, 'sign', 'sign');
  add(16.3, 'sign', 'sign');
  add(17.2, 'foghorn', 'foghorn');
  return ev.sort((x, y) => x.t - y.t);
}

function smooth(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

/** Fill `out` with the scripted frame at time t (no allocation). */
export function sessionFrame(t: number, out: AudioFrame): AudioFrame {
  // speed: wake up, cruise, surge 5.5..8.5, cruise, hover 12..13.5, cruise
  let v = 6 + 24 * smooth(t / 2);
  v += 82 * (smooth((t - 5.5) / 0.8) - smooth((t - 8.5) / 1.2));
  v -= 24 * (smooth((t - 11.8) / 0.6) - smooth((t - 13.5) / 0.8));
  let surge = smooth((t - 5.5) / 0.4) - smooth((t - 8.5) / 0.6);
  // the splat: stall ~1 s, then relief boost
  let full = 1;
  const recharge = config.splat.recharge;
  const dur = config.splat.duration;
  for (const sp of SPLATS) {
    const u = t - sp.t;
    if (u < 0) continue;
    if (u < dur) {
      v *= config.splat.stallSpeed + (1 - config.splat.stallSpeed) * smooth((u - 0.85) / 0.15);
      full = Math.min(full, 1 - smooth(u / 0.12));
    } else if (u < dur + recharge) {
      full = Math.min(full, (u - dur) / recharge);
      const r = (u - dur) / config.splat.reliefSeconds;
      v *= 1 + (config.splat.reliefBoost - 1) * Math.max(0, 1 - r);
    } else if (u < dur + config.splat.reliefSeconds) {
      const r = (u - dur) / config.splat.reliefSeconds;
      v *= 1 + (config.splat.reliefBoost - 1) * Math.max(0, 1 - r);
    }
  }
  surge = Math.max(0, Math.min(1, surge));
  // paint near the bus: each splat adds, flying away slowly lets it fall
  let paint = 0;
  let k = 0;
  for (const sp of SPLATS) {
    if (t > sp.t + 0.4) paint = Math.min(0.95, paint + 0.24 + 0.04 * k);
    k++;
  }
  if (t > 16) paint *= 1 - 0.4 * smooth((t - 16) / 4);
  out.speed = Math.min(115, Math.max(0, v));
  out.surge = surge;
  out.fullness = Math.max(0, Math.min(1, full));
  out.altitude = 32 + 12 * Math.sin(t * 0.37) + 25 * surge;
  out.paintNearby = paint;
  out.fogBank = 1 - smooth(t / config.fog.openingDuration);
  return out;
}

/** Trigger one scripted event on the engine. */
export function fireEvent(eng: AudioEngine, e: SessionEvent): void {
  switch (e.kind) {
    case 'heave':
      eng.heave();
      break;
    case 'impact':
      eng.splatImpact(e.a);
      break;
    case 'bloom':
      eng.bloomNote(e.a, e.b, e.c, e.d);
      break;
    case 'ready':
      eng.ready();
      break;
    case 'denied':
      eng.denied();
      break;
    case 'sign':
      eng.signPop();
      break;
    case 'foghorn':
      eng.foghorn();
      break;
  }
}
