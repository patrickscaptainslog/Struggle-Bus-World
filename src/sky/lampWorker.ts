/// <reference lib="webworker" />
// The street lamps off the main thread (lampData.ts): one job at load, then Lamps ends this worker.
import { loadLamps } from './lampLoad';
import type { LampRequest } from './lampData';

self.onmessage = async (ev: MessageEvent<LampRequest>) => {
  const res = await loadLamps(ev.data);
  (self as unknown as Worker).postMessage(res, res ? [res.pos.buffer, res.keys.buffer, res.starts.buffer] : []);
};
