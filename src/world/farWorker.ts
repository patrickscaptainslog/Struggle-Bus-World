/// <reference lib="webworker" />
// The far boxes off the main thread (farBlocks.ts): one job at boot, then City ends this worker.
import { mergeFarBlocks, type FarBlocksRequest } from './farBlocks';

self.onmessage = (ev: MessageEvent<FarBlocksRequest>) => {
  const res = mergeFarBlocks(ev.data);
  const transfer: Transferable[] = [];
  for (const s of res.chunks) transfer.push(s.cell.buffer, s.y.buffer, s.tone.buffer, s.sphere.buffer);
  (self as unknown as Worker).postMessage(res, transfer);
};
