/// <reference lib="webworker" />
// The Moon's ground off the main thread (MoonGround.ts): one job, after the first frame, then SkyDraw ends this worker.
import { loadGround, type GroundRequest } from './MoonGround';

self.onmessage = async (ev: MessageEvent<GroundRequest>) => {
  const res = await loadGround(ev.data);
  (self as unknown as Worker).postMessage(res, res ? [res.map.buffer, res.tile.buffer] : []);
};
