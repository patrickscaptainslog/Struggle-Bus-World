// Node globals for running the real game modules offline (no WebGL, no DOM).
import { readFileSync } from 'node:fs';
const store = new Map<string, string>();
const g = globalThis as any;
g.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
g.location = { href: 'http://local/', search: '' };
g.window = { addEventListener() {}, removeEventListener() {} };
g.document = { addEventListener() {}, hidden: false };
const DATA = process.env.SB_DATA ?? 'public/city/sf'; // (run.mjs sets it to the repo's)
g.fetch = async (url: string) => new Response(readFileSync(`${DATA}/${String(url).split('/').pop()}`));
export const store_ = store;
export const DATA_DIR = DATA;
