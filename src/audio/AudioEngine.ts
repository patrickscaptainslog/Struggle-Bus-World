import { SoundGraph } from './SoundGraph';
import { audioTune, registerAudioTunables } from './tune';

// Struggle Bus audio: a fully synthesized WebAudio engine (no sample files).
//
// Grey city: muffled wind that rises with speed and altitude, and a distant
// two-tone SF foghorn every 20-35 s with a long synthesized echo tail.
// The bus: a lovable old putter tied to speed and an asthmatic wheeze that
// follows the belly. The splat: hurk, gulp, glugging geyser with in-key pixel
// glitter, then a juicy wet splat with a soft thump. The score: every splat
// advances Pachelbel's canon in D and the bloom cascade arpeggiates the
// current chord upward on mallet bells, so any sequence of splats is music.
// Painted blocks hum the current chord and twinkle.
//
// The graph runs on any BaseAudioContext: `unlock()` makes a realtime one
// inside the first gesture (iOS), `attachContext()` takes e.g. an
// OfflineAudioContext for tests (dev/audio.html, tools/audio-check.mjs).

export interface AudioFrame {
  /** m/s, 0..115 */
  speed: number;
  /** 0..1 */
  surge: number;
  /** 0..1 belly; 1 = ready, heavy, wheezy */
  fullness: number;
  /** m above ground */
  altitude: number;
  /** 0..1 share of painted buildings near the bus */
  paintNearby: number;
  /** 0..1, 1 inside the opening fog bank */
  fogBank: number;
}

type AudioCtor = new (opts?: AudioContextOptions) => AudioContext;

const GESTURES = ['touchend', 'pointerup', 'mousedown', 'keydown'] as const;

export class AudioEngine {
  private graph: SoundGraph | null = null;
  private rt: AudioContext | null = null;
  private muted = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    registerAudioTunables();
  }

  /** True once sound can actually be heard (realtime context running) or a custom context is attached. */
  get unlocked(): boolean {
    if (!this.graph) return false;
    if (!this.rt) return true;
    return this.rt.state === 'running';
  }

  /** The context in use (null before unlock). */
  get context(): BaseAudioContext | null {
    return this.graph ? this.graph.ctx : null;
  }

  /**
   * Call synchronously inside a user gesture (touchend/pointerup/click on iOS).
   * Safe to call on every gesture: creates the AudioContext once, afterwards
   * only resumes it if iOS suspended or interrupted it.
   */
  unlock(): void {
    if (this.rt) {
      if (!this.muted) this.resume();
      return;
    }
    if (this.graph) return; // running on an attached (offline) context
    setAmbientSession();
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return;
    let ctx: AudioContext;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try {
        ctx = new AC();
      } catch {
        return;
      }
    }
    this.rt = ctx;
    // Older iOS only unlocks output once something starts inside the gesture.
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
    this.resume();
    this.graph = new SoundGraph(ctx);
    if (this.muted) this.graph.setMuted(true);
    this.installLifecycle(ctx);
  }

  /** Build the graph on a caller-owned context (OfflineAudioContext for tests). */
  attachContext(ctx: BaseAudioContext, seed = 1): void {
    if (this.graph) throw new Error('AudioEngine: already attached');
    this.graph = new SoundGraph(ctx, seed);
    if (this.muted) this.graph.setMuted(true);
  }

  update(dt: number, f: AudioFrame): void {
    if (this.graph) this.graph.update(dt, f);
  }

  /** Tap accepted: the bus's gag/hurk (frame 0 of the splat). */
  heave(): void {
    const g = this.graph;
    if (g) g.heave(g.now());
  }

  /** Geyser hits the first building. strength ~0..1. */
  splatImpact(strength: number): void {
    const g = this.graph;
    if (g) g.splatImpact(g.now(), strength);
  }

  /** index 0 = primary bloom (advances the chord); index i rings chord tone i. hue 0..5, level 1..3. */
  bloomNote(index: number, total: number, hue: number, level: number): void {
    const g = this.graph;
    if (g) g.bloomNote(g.now(), index, total, hue, level);
  }

  /** Belly full again. */
  ready(): void {
    const g = this.graph;
    if (g) g.ready(g.now());
  }

  /** Tapped while recharging. */
  denied(): void {
    const g = this.graph;
    if (g) g.denied(g.now());
  }

  /** A street sign springs out of the ground. */
  signPop(): void {
    const g = this.graph;
    if (g) g.signPop(g.now());
  }

  /** Extra (dev / scripted moments): sound a foghorn now. */
  foghorn(): void {
    const g = this.graph;
    if (g) g.foghorn(g.now(), false);
  }

  setMuted(m: boolean): void {
    this.muted = !!m;
    if (this.graph) this.graph.setMuted(this.muted);
    const ctx = this.rt;
    if (!ctx) return;
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (this.muted) {
      // after the fade, stop the audio thread entirely (battery)
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        if (this.muted && ctx.state === 'running') ctx.suspend().catch(() => {});
      }, 400);
    } else this.resume();
  }

  setVolumes(v: { master: number; music: number; sfx: number; ambience: number }): void {
    const ok = (x: number, d: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
    audioTune.master = ok(v.master, audioTune.master);
    audioTune.music = ok(v.music, audioTune.music);
    audioTune.sfx = ok(v.sfx, audioTune.sfx);
    audioTune.ambience = ok(v.ambience, audioTune.ambience);
    if (this.graph) this.graph.setVolumes();
  }

  /** Debug: bell voices ringing and the current chord. */
  debugState(): { voices: number; chord: string; state: string } {
    const g = this.graph;
    return {
      voices: g ? g.voices() : 0,
      chord: g ? g.chordName : '-',
      state: this.rt ? this.rt.state : g ? 'attached' : 'locked',
    };
  }

  private resume(): void {
    const c = this.rt;
    if (c && c.state !== 'running' && c.state !== 'closed') c.resume().catch(() => {});
  }

  private installLifecycle(ctx: AudioContext): void {
    // iOS can suspend/interrupt the context (calls, Siri, backgrounding). A
    // resume is only honoured inside a gesture, so retry on every tap.
    const onGesture = () => {
      if (!this.muted && !document.hidden && ctx.state !== 'running') this.resume();
    };
    for (const ev of GESTURES) window.addEventListener(ev, onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (ctx.state === 'running') ctx.suspend().catch(() => {});
      } else if (!this.muted) this.resume();
    });
  }
}

/** Respect the iPhone silent switch and mix politely with other apps' audio. */
function setAmbientSession(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'ambient';
  } catch {
    /* not supported */
  }
}
