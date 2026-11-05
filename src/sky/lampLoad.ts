import { gunzip, isGzip } from '../world/gunzip';
import { readLamps, type LampRequest, type LampResult } from './lampData';

/** lamps.bin fetched, at low priority (the city's tiles first), inflated and read, on a worker or on the main thread. Null: the city has none, or it never arrived. */
export async function loadLamps(req: LampRequest): Promise<LampResult | null> {
  try {
    const res = await fetch(req.url, { priority: 'low' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return readLamps(isGzip(buf) ? await gunzip(buf) : buf, req);
  } catch {
    return null;
  }
}
