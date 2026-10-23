import { config } from '../config';
import { registerTunables } from '../ui/tunables';

// Live-tunable audio numbers (hidden tuner panel, group "Audio"). Every field
// is read by the engine on its next update, so edits are heard immediately.
// Volumes start from config.audio; setVolumes() writes into this same object.

export const audioTune = {
  // mix (0..1)
  master: config.audio.master,
  music: config.audio.music,
  sfx: config.audio.sfx,
  ambience: config.audio.ambience,
  // music
  /** Semitones added to the whole score (0 = D major). */
  transpose: 0,
  /** Reverb send (0..1). */
  reverb: 0.34,
  /** Chorus wet (0..1). */
  chorus: 0.55,
  /** Bell ring-out multiplier. */
  bellDecay: 1,
  /** Mallet brightness multiplier (overtones). */
  bellBright: 1,
  /** Painted-block hum level multiplier. */
  hum: 1,
  /** Painted-block sparkle twinkles per second at full paint. */
  twinkleRate: 0.5,
  // ambience
  wind: 1,
  foghorn: 1,
  /** Seconds between foghorn blasts (random in [min, max]). */
  foghornMin: 20,
  foghornMax: 35,
  // the bus
  engine: 1,
  /** Engine firing-rate multiplier ("rpm"). */
  putterRate: 1,
  wheeze: 1,
  /** Breaths per second multiplier. */
  breathRate: 1,
  // one-shots
  splat: 1,
};

export type AudioTune = typeof audioTune;

export const AUDIO_RANGES: Record<string, [number, number, number?]> = {
  master: [0, 1, 0.01],
  music: [0, 1, 0.01],
  sfx: [0, 1, 0.01],
  ambience: [0, 1, 0.01],
  transpose: [-6, 6, 1],
  reverb: [0, 1, 0.01],
  chorus: [0, 1, 0.01],
  bellDecay: [0.3, 2.5, 0.05],
  bellBright: [0, 2, 0.05],
  hum: [0, 2, 0.05],
  twinkleRate: [0, 2, 0.05],
  wind: [0, 2, 0.05],
  foghorn: [0, 2, 0.05],
  foghornMin: [4, 60, 1],
  foghornMax: [5, 90, 1],
  engine: [0, 2, 0.05],
  putterRate: [0.5, 1.8, 0.05],
  wheeze: [0, 2, 0.05],
  breathRate: [0.5, 2, 0.05],
  splat: [0, 2, 0.05],
};

let registered = false;
export function registerAudioTunables(): void {
  if (registered) return;
  registered = true;
  registerTunables('Audio', audioTune, AUDIO_RANGES);
}
