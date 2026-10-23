/// <reference lib="webworker" />
// Region loading off the main thread (see regionLoader.ts).
import { loadRegion, type RegionRequest } from './regionLoader';

self.onmessage = async (ev: MessageEvent<RegionRequest>) => {
  if (ev.data.type !== 'region') return;
  const transfer: Transferable[] = [];
  const msg = await loadRegion(ev.data, transfer);
  (self as unknown as Worker).postMessage(msg, msg.error ? [] : transfer);
};
