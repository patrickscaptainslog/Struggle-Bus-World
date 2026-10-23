import { Foghorn, Wind } from './ambience';
import { BusVoice } from './busVoice';
import { clamp, clamp01, fin, hold, Kit, LOOKAHEAD, makeNoise, makeReverbIR, mkFilter, mkGain, mkOsc, mkPan, mtof, Rng, softClipCurve, target } from './dsp';
import { arpNote, Bells, Hum, PROGRESSION } from './music';
import { Sfx } from './sfx';
import { audioTune } from './tune';

// The whole sound world on one BaseAudioContext (realtime or offline).
//
//   bells, hum ─► music ─┬───────────────► master ─► DC block ─► compressor ─► ½ ─► soft clip ─► mute ─► out
//                        ├─ chorus (2 modulated delays, wide) ─┘ ▲
//                        └─ reverb send ─┐                       │
//   sfx (dry) ─────────────────────────────────────────────────►─┤
//   sfx reverb send ─────────────────────┴─► convolver (synth IR) ┤
//   wind, foghorn ─► ambience duck ─► ambience ──────────────────►┘
//
// The final soft clipper is a hard ceiling (< 0.94) so nothing can ever clip;
// the mix is levelled so it only ever kisses it.

export interface FrameIn {
  speed: number;
  surge: number;
  fullness: number;
  altitude: number;
  paintNearby: number;
  fogBank: number;
}

const HUM_GAIN = 0.06;

/** Whole semitones in [-12, 12] (the score only ever moves by semitones). */
function semis(x: number): number {
  return clamp(Math.round(fin(x)), -12, 12);
}
const PUSH_INTERVAL = 1 / 30;

export class SoundGraph {
  readonly ctx: BaseAudioContext;
  private readonly kit: Kit;
  private readonly rng: Rng;
  // mixer
  private readonly masterVol: GainNode;
  private readonly muteG: GainNode;
  private readonly musicBus: GainNode;
  private readonly sfxBus: GainNode;
  private readonly sfxVerbBus: GainNode;
  private readonly ambBus: GainNode;
  private readonly ambDuck: GainNode;
  private readonly chorusWet: GainNode;
  private readonly revSendMusic: GainNode;
  private readonly revSendSfx: GainNode;
  // instruments
  private readonly bells: Bells;
  private readonly hum: Hum;
  private readonly wind: Wind;
  private readonly horn: Foghorn;
  private readonly bus: BusVoice;
  private readonly fx: Sfx;
  // score state
  private chord = -1;
  private centerHue = 0;
  private transpose = 0;
  private tunedTranspose = 0;
  private lastBloom = -10;
  // smoothed frame
  private speedN = 0;
  private surge = 0;
  private fullness = 1;
  private altN = 0.3;
  private paint = 0;
  private fog = 0;
  private first = true;
  // schedulers (context time)
  private pushAcc = 1;
  private lastPush = -1;
  private lastNow = 0;
  private nextBreath = 0;
  private breathPausedUntil = 0;
  private nextMisfire = 3;
  private nextHorn: number;
  private nextTwinkle = 0;
  private muted = false;
  /** Realtime contexts gate param pushes on `state === 'running'`. */
  private readonly isRealtime: boolean;

  constructor(ctx: BaseAudioContext, seed = 1) {
    this.ctx = ctx;
    this.isRealtime = !(typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext);
    this.rng = new Rng(seed * 7717 + 3);
    const t = ctx.currentTime;
    const tune = audioTune;

    // ---- master chain
    this.muteG = mkGain(ctx, 1);
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = 'none';
    const half = mkGain(ctx, 0.5);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const dc = mkFilter(ctx, 'highpass', 32, 0.7);
    this.masterVol = mkGain(ctx, tune.master);
    this.masterVol.connect(dc).connect(comp).connect(half).connect(shaper).connect(this.muteG).connect(ctx.destination);

    // ---- buses
    this.musicBus = mkGain(ctx, tune.music);
    this.sfxBus = mkGain(ctx, tune.sfx);
    this.sfxVerbBus = mkGain(ctx, tune.sfx);
    this.ambDuck = mkGain(ctx, 1);
    this.ambBus = mkGain(ctx, tune.ambience);
    this.musicBus.connect(this.masterVol);
    this.sfxBus.connect(this.masterVol);
    this.ambDuck.connect(this.ambBus).connect(this.masterVol);

    // ---- reverb (synthesized impulse response, no sample files)
    const verb = ctx.createConvolver();
    verb.normalize = false;
    verb.buffer = makeReverbIR(ctx, 2.1, 1.9, seed * 31 + 11);
    const verbOut = mkGain(ctx, 0.9);
    verb.connect(verbOut).connect(this.masterVol);
    this.revSendMusic = mkGain(ctx, tune.reverb);
    this.revSendSfx = mkGain(ctx, tune.reverb);
    this.musicBus.connect(this.revSendMusic).connect(verb);
    this.sfxVerbBus.connect(this.revSendSfx).connect(verb);

    // ---- chorus (music): two slowly swept delays panned wide
    this.chorusWet = mkGain(ctx, tune.chorus * 0.5);
    this.chorusWet.connect(this.masterVol);
    for (let i = 0; i < 2; i++) {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = i ? 0.0167 : 0.0113;
      const lfo = mkOsc(ctx, 'sine', i ? 0.31 : 0.23);
      const depth = mkGain(ctx, i ? 0.0026 : 0.002);
      lfo.connect(depth).connect(d.delayTime);
      lfo.start(t);
      this.musicBus.connect(d).connect(mkPan(ctx, i ? 0.7 : -0.7)).connect(this.chorusWet);
    }

    // ---- instruments
    this.kit = {
      ctx,
      rng: this.rng,
      white: makeNoise(ctx, 3, seed * 13 + 1, false),
      pink: makeNoise(ctx, 4, seed * 17 + 2, true),
      music: this.musicBus,
      sfx: this.sfxBus,
      sfxVerb: this.sfxVerbBus,
      amb: this.ambDuck,
    };
    this.bells = new Bells(this.kit, this.musicBus, 16);
    this.hum = new Hum(this.kit, this.musicBus);
    this.wind = new Wind(this.kit, this.ambDuck);
    this.horn = new Foghorn(this.kit, this.ambDuck);
    this.bus = new BusVoice(this.kit, this.sfxBus);
    this.fx = new Sfx(this.kit);
    this.tunedTranspose = tune.transpose;
    this.transpose = semis(tune.transpose);
    this.hum.setChord(PROGRESSION[0], t, this.transpose);
    // The first foghorn sounds early, while the bus is still in the opening fog bank.
    this.nextHorn = t + 2.4;
    this.nextBreath = t + 0.4;
    this.lastNow = t;
  }

  /** Start time for an event triggered now. */
  now(): number {
    return this.ctx.currentTime + LOOKAHEAD;
  }

  private get currentChord() {
    return PROGRESSION[this.chord < 0 ? 0 : this.chord];
  }

  // ------------------------------------------------------------ per frame

  update(dtIn: number, f: FrameIn): void {
    const dt = clamp(fin(dtIn, 0), 0, 0.1);
    const tune = audioTune;
    const speedN = clamp01(fin(f.speed) / 115);
    const surge = clamp01(fin(f.surge));
    const full = clamp01(fin(f.fullness, 1));
    const altN = clamp01(fin(f.altitude, 30) / 120);
    const paint = clamp01(fin(f.paintNearby));
    const fog = clamp01(fin(f.fogBank));
    if (this.first) {
      this.first = false;
      this.speedN = speedN;
      this.surge = surge;
      this.fullness = full;
      this.altN = altN;
      this.paint = paint;
      this.fog = fog;
    } else {
      this.speedN += (speedN - this.speedN) * (1 - Math.exp(-dt / 0.25));
      this.surge += (surge - this.surge) * (1 - Math.exp(-dt / 0.12));
      this.fullness += (full - this.fullness) * (1 - Math.exp(-dt / 0.35));
      this.altN += (altN - this.altN) * (1 - Math.exp(-dt / 0.6));
      this.paint += (paint - this.paint) * (1 - Math.exp(-dt / 0.8));
      this.fog += (fog - this.fog) * (1 - Math.exp(-dt / 0.5));
    }

    const now = this.ctx.currentTime;
    if (now - this.lastNow > 0.5) {
      // resumed after a stall / background: don't burst everything that came due
      this.nextBreath = Math.max(this.nextBreath, now + 0.2);
      this.nextTwinkle = Math.max(this.nextTwinkle, now + 1);
      this.nextMisfire = Math.max(this.nextMisfire, now + 2);
    }
    this.lastNow = now;
    const running = !this.isRealtime || (this.ctx as AudioContext).state === 'running';

    this.wind.update(now, dt, this.speedN, this.altN, this.surge, this.paint, this.fog, tune, false);
    this.bus.update(now, dt, this.speedN, this.surge, this.fullness, tune, false);
    if (!running) return;

    // ---- event schedulers
    if (now >= this.breathPausedUntil && now + 0.06 >= this.nextBreath) {
      const tb = Math.max(this.nextBreath, now + LOOKAHEAD);
      this.nextBreath = tb + this.bus.breath(tb, this.fullness, this.surge, tune);
    }
    if (this.fullness > 0.6 && now >= this.bus.quietUntil && now >= this.nextMisfire) {
      this.bus.misfire(now + LOOKAHEAD, this.rng.next() < 0.35);
      this.nextMisfire = now + this.rng.range(2.5, 6) / (0.4 + this.fullness);
    }
    if (now >= this.nextHorn) {
      this.foghorn(now + LOOKAHEAD, true);
      const lo = Math.max(2, tune.foghornMin);
      this.nextHorn = now + this.rng.range(lo, Math.max(lo + 1, tune.foghornMax));
    }
    if (this.paint > 0.12 && now >= this.nextTwinkle) {
      if (now - this.lastBloom > 2) {
        const ch = this.currentChord;
        const idx = 3 + Math.floor(this.rng.next() * 4);
        this.bells.play(now + LOOKAHEAD, arpNote(ch, idx) + this.transpose, 0.12 + 0.1 * this.rng.next(), this.rng.range(-0.7, 0.7), 0.5, 0, 0.75, false);
      }
      const rate = Math.max(0.02, tune.twinkleRate * this.paint);
      this.nextTwinkle = now + this.rng.range(0.5, 2) / rate;
    }

    // ---- continuous params (throttled; skipped while the clock is frozen)
    this.pushAcc += dt;
    if (this.pushAcc < PUSH_INTERVAL || now <= this.lastPush) return;
    this.pushAcc = 0;
    this.lastPush = now;
    if (tune.transpose !== this.tunedTranspose) {
      this.tunedTranspose = tune.transpose;
      const tr = semis(tune.transpose);
      if (tr !== this.transpose) {
        this.transpose = tr;
        this.hum.setChord(this.currentChord, now, tr);
      }
    }
    this.wind.update(now, 0, this.speedN, this.altN, this.surge, this.paint, this.fog, tune, true);
    this.bus.update(now, 0, this.speedN, this.surge, this.fullness, tune, true);
    const humLvl = HUM_GAIN * tune.hum * Math.pow(this.paint, 1.3) * (1 - 0.3 * this.fog);
    this.hum.set(now, humLvl, 0.25 + 0.75 * this.paint);
    this.pushMix(now, 0.08);
  }

  private pushMix(t: number, tau: number): void {
    const tune = audioTune;
    target(this.masterVol.gain, clamp01(fin(tune.master)), t, tau);
    target(this.musicBus.gain, clamp01(fin(tune.music)), t, tau);
    target(this.sfxBus.gain, clamp01(fin(tune.sfx)), t, tau);
    target(this.sfxVerbBus.gain, clamp01(fin(tune.sfx)), t, tau);
    target(this.ambBus.gain, clamp01(fin(tune.ambience)), t, tau);
    target(this.chorusWet.gain, clamp01(fin(tune.chorus)) * 0.5, t, tau);
    target(this.revSendMusic.gain, clamp01(fin(tune.reverb)), t, tau);
    target(this.revSendSfx.gain, clamp01(fin(tune.reverb)), t, tau);
  }

  setVolumes(): void {
    this.pushMix(this.ctx.currentTime, 0.05);
  }

  setMuted(m: boolean): void {
    if (m === this.muted) return;
    this.muted = m;
    const t = this.ctx.currentTime;
    hold(this.muteG.gain, t);
    target(this.muteG.gain, m ? 0 : 1, t, m ? 0.05 : 0.12);
  }

  // ------------------------------------------------------------ events

  heave(t: number): void {
    const tune = audioTune;
    const next = PROGRESSION[(this.chord + 1) % PROGRESSION.length];
    this.fx.heave(t, next, this.transpose, tune);
    // the struggle: engine chokes, breathing stops; then the relieved sigh
    this.bus.stallFor(t, 1.0);
    this.bus.hush(t);
    const sighAt = t + 1.18;
    this.breathPausedUntil = sighAt + this.bus.sigh(sighAt, tune);
    this.nextBreath = this.breathPausedUntil;
    // the world holds its breath too
    hold(this.ambDuck.gain, t);
    target(this.ambDuck.gain, 0.5, t, 0.05);
    target(this.ambDuck.gain, 1, t + 1.3, 0.7);
  }

  splatImpact(t: number, strength: number): void {
    this.fx.splat(t, clamp(fin(strength, 1), 0, 1.5), audioTune);
  }

  bloomNote(t: number, indexIn: number, totalIn: number, hueIn: number, levelIn: number): void {
    const tune = audioTune;
    const index = clamp(Math.floor(fin(indexIn)), 0, 63);
    const total = clamp(Math.floor(fin(totalIn, 1)), index + 1, 64);
    const hue = ((fin(hueIn) % 6) + 6) % 6;
    const level = clamp(Math.round(fin(levelIn, 1)), 1, 3);
    const tr = this.transpose;
    if (index === 0 || this.chord < 0) {
      this.chord = (this.chord + 1) % PROGRESSION.length;
      this.hum.setChord(PROGRESSION[this.chord], t, tr);
      this.centerHue = hue;
    }
    this.lastBloom = t;
    const ch = PROGRESSION[this.chord];
    const bright = tune.bellBright * (0.8 + 0.22 * (level - 1));
    const octave = level >= 3 ? 1 : level >= 2 ? 0.65 : 0;
    const decay = tune.bellDecay * (1 + 0.15 * (level - 1));
    // the Painted Ladies fan, in stereo: neighbours' hues spread left/right of the centre hue
    let dh = hue - this.centerHue;
    if (dh > 3) dh -= 6;
    if (dh < -3) dh += 6;
    const pan = clamp(dh * 0.24 + (index === 0 ? 0 : index % 2 ? 0.1 : -0.1), -0.75, 0.75);
    const crowd = total > 6 ? Math.sqrt(6 / total) : 1;
    const vel = index === 0 ? 0.95 : clamp(0.84 - 0.035 * index, 0.5, 0.84) * crowd;
    this.bells.play(t, arpNote(ch, index) + tr, vel, pan, bright, octave, decay, true);
    if (index === 0) {
      // the bright chord under the lead: a quick upward strum + a warm low bell
      for (let k = 0; k < 3; k++) this.bells.play(t + 0.016 * k, arpNote(ch, k) - 12 + tr, 0.44 - 0.05 * k, -0.4 + 0.4 * k, bright * 0.6, 0, decay * 1.1, true);
      this.bells.play(t, arpNote(ch, 0) - 24 + tr, 0.5, 0, 0.3, 0, decay * 1.4, true);
    }
    if (level >= 3 && index === total - 1) {
      // full Hundertwasser: sparkles float off the top of the arpeggio
      this.bells.play(t + 0.09, arpNote(ch, index + 1, 1) + tr, 0.3, -pan - 0.2, 1.2, 0, 0.6, false);
      this.bells.play(t + 0.19, arpNote(ch, index + 2, 1) + tr, 0.22, -pan + 0.2, 1.2, 0, 0.55, false);
    }
  }

  ready(t: number): void {
    this.fx.ready(t, this.currentChord, this.transpose, audioTune);
  }

  denied(t: number): void {
    this.fx.denied(t, audioTune);
  }

  signPop(t: number): void {
    this.fx.signPop(t, this.currentChord, this.transpose, audioTune);
  }

  /** A distant foghorn blast (sometimes answered by the far station). */
  foghorn(t: number, maybeAnswer: boolean): void {
    const tune = audioTune;
    const lvl = tune.foghorn * (1 - 0.75 * this.paint) * (0.85 + 0.45 * this.fog);
    const tr = this.transpose;
    this.horn.blast(t, mtof(50 + tr), mtof(45 + tr), lvl, this.rng.range(-0.6, -0.2));
    if (maybeAnswer && this.rng.next() < 0.45) {
      this.horn.blast(t + this.rng.range(3.4, 5.6), mtof(45 + tr), mtof(40 + tr), lvl * 0.55, this.rng.range(0.3, 0.7));
    }
  }

  /** Bell voices currently ringing (debug). */
  voices(): number {
    return this.bells.active(this.ctx.currentTime);
  }

  get chordName(): string {
    return this.chord < 0 ? '-' : PROGRESSION[this.chord].name;
  }
}
