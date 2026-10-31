// The sound graph's long buffers, off the main thread: the first touch of a session
// only makes the AudioContext (see AudioEngine). Input: the sample rate.
import { synthAll } from './dsp';

self.onmessage = (ev: MessageEvent<number>) => {
  const d = synthAll(ev.data);
  (self as unknown as Worker).postMessage(d, [d.white.buffer, d.pink.buffer, d.ir[0].buffer, d.ir[1].buffer]);
};
