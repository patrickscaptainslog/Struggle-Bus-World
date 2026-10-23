# Module: audio

Files you own: src/audio/AudioEngine.ts (plus optional helpers in src/audio/), dev/audio.html, tools/audio-check.mjs

## Spec

Build a fully synthesized WebAudio engine (no sample files). API (exact):
  export interface AudioFrame { speed: number /*m/s 0..115*/; surge: number /*0..1*/; fullness: number /*0..1 belly; 1 = ready, heavy, wheezy*/;
    altitude: number /*m above ground*/; paintNearby: number /*0..1 share of painted buildings near the bus*/; fogBank: number /*0..1, 1 inside the opening fog bank*/ }
  export class AudioEngine {
    constructor()
    unlock(): void            // call synchronously inside the first user gesture (iOS); creates/resumes the AudioContext
    readonly unlocked: boolean
    update(dt: number, f: AudioFrame): void
    heave(): void             // tap accepted: the bus's gag/hurk, frame 0 of the splat
    splatImpact(strength: number): void   // geyser hits the first building: wet splat + soft low thump
    bloomNote(index: number, total: number, hue: number /*0..5*/, level: number /*1..3*/): void  // index 0 = primary bloom and ADVANCES the chord progression; index i plays chord tone i (rising arpeggio). level escalates brightness (add octave/sparkle).
    ready(): void             // belly full again: tiny bright "bloop"
    denied(): void            // tapped while recharging: soft wet sputter
    signPop(): void           // street sign springs out of the ground: springy "boing" + tick
    setMuted(m: boolean): void
    setVolumes(v: { master: number; music: number; sfx: number; ambience: number }): void
  }
Sound design: grey ambience = muffled wind (filtered noise, slow gusts, rises with speed and altitude) + distant SF foghorn (two-tone
diaphone "BEEEE-oh", very low, heavily low-passed with a long convolution-free reverb tail you synthesize with delays; every 20-35 s,
quieter when paintNearby is high). Bus = a lovable wheezy old engine: a low putter tied to speed + an asthmatic breath/wheeze whose
intensity follows fullness (full belly = laboured). Splat = juicy wet splat (noise burst + pitch-dropping body) with a satisfying
low thump. Music: a warm chord progression in a major key (e.g. D: I - V - vi - IV - ii - V ...), played as bell/marimba/kalimba-like
FM or additive tones with gentle chorus and a soft reverb; bloom cascade notes arpeggiate the CURRENT chord upward so any sequence of
splats is musical and never dissonant. A soft pad "hum" fades in with paintNearby (painted blocks hum), using the current chord.
Mix: limiter/compressor on master, no clipping ever, no clicks (every envelope ramps), modest CPU (reuse nodes; pool voices; cap
polyphony ~16). iOS: AudioContext must be created/resumed inside unlock(); also call navigator.audioSession.type='ambient' if present
(respect the silent switch). Expose volumes/tempo-ish params via registerTunables('Audio', ...).
TEST: write tools/audio-check.mjs that uses playwright-core (same launch args as tools/shot.mjs) to open dev/audio.html, which renders a
scripted 20 s session (fly, 4 splats with cascades, a sign pop, ready/denied) through an OfflineAudioContext version of the same graph
(design the engine so it can run on any BaseAudioContext) and reports peak level, RMS per second, and whether any sample exceeds 0.99.
Fix until peak < 0.95 and there are no NaNs. Also make dev/audio.html have big buttons for manual listening.
