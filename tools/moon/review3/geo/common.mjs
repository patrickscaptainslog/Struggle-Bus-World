// Shared setup for the probes: the worktree's own GroundPaint and map under Node, a fake localStorage with a quota in characters (key + value).
import { registerHooks } from 'node:module';
registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
export class Store {
  constructor(quota) { this.m = new Map(); this.q = quota; this.used = 0; this.fails = 0; this.keysCache = null; }
  get length() { return this.m.size; }
  key(i) { if (!this.keysCache) this.keysCache = [...this.m.keys()]; return this.keysCache[i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    v = String(v);
    const old = this.m.has(k) ? k.length + this.m.get(k).length : 0, nu = this.used - old + k.length + v.length;
    if (nu > this.q) { this.fails++; const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    if (!this.m.has(k)) this.keysCache = null;
    this.m.set(k, v); this.used = nu;
  }
  removeItem(k) { if (this.m.has(k)) { this.used -= k.length + this.m.get(k).length; this.m.delete(k); this.keysCache = null; } }
  clear() { this.m.clear(); this.used = 0; this.keysCache = null; }
}
globalThis.localStorage = new Store(5 * 1024 * 1024);
const W = new URL('../../../../src/', import.meta.url).href;
export const { GroundPaint, encodeMask } = await import(W + 'world/GroundPaint.ts');
export const { makeFrame, dirOf, latLonToMap, latOf, lonOf } = await import(W + 'moon/map.ts');
export const { makeBlastSpec, blastRadiusFor } = await import(W + 'game/blastLayout.ts');
export function geoAt(lat0, lon0) {
  const f = makeFrame(lat0, lon0), d = [0, 0, 0];
  return { f, toLatLon(x, z, o) { dirOf(f, x, z, d); o[0] = latOf(d); o[1] = lonOf(d); }, toXZ(la, lo, o) { latLonToMap(f, la, lo, d); o[0] = d[0]; o[1] = d[1]; } };
}
export function paintAt(lat0, lon0, store) {
  if (store) globalThis.localStorage = store;
  const g = new GroundPaint(256, 'moon_probe', 'rank');
  g.useGeo(geoAt(lat0, lon0));
  return g;
}
let seed = 12345;
export const nextSeed = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
export const uni = () => ({ tGround: { value: null }, uGroundOn: { value: 0 } });
