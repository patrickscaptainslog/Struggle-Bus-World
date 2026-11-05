// Loads the real sources from the worktree, as tools/moon/walk-check.mjs does.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const W = new URL('../../../src/', import.meta.url).href;
export const { GroundPaint } = await import(W + 'world/GroundPaint.ts');
export const map = await import(W + 'moon/map.ts');
export const layout = await import(W + 'game/blastLayout.ts');
export function geoFor(lat0, lon0) {
  const f = map.makeFrame(lat0, lon0), d = [0, 0, 0];
  return { f, geo: { toLatLon(x, z, o) { map.dirOf(f, x, z, d); o[0] = map.latOf(d); o[1] = map.lonOf(d); }, toXZ(la, lo, o) { map.latLonToMap(f, la, lo, d); o[0] = d[0]; o[1] = d[1]; } } };
}
