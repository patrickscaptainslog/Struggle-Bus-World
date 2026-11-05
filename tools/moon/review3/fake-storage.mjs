// A Map-backed localStorage for Node, so GroundPaint's storageOk is true and its eviction runs.
const m = new Map();
globalThis.localStorage = {
  get length() { return m.size; },
  key(i) { return [...m.keys()][i] ?? null; },
  getItem(k) { return m.has(k) ? m.get(k) : null; },
  setItem(k, v) { m.set(k, String(v)); },
  removeItem(k) { m.delete(k); },
  clear() { m.clear(); },
};
export const store = m;
