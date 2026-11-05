// The largest blast reach (m), from the real config, and the latitude sagitta a box of that half-width misses near the pole (corner-only box).
import { layout } from './hooks.mjs';
const { config } = await import(new URL('../../../src/config.ts', import.meta.url).href).catch(() => ({ config: null }));
for (const drop of [0, 300, 1e9]) {
  const s = layout.makeBlastSpec(0, 0, layout.blastRadiusFor(drop), 0, 1);
  const reach = s.r * Math.max(s.reach, s.edge * (1 + s.ragged) + s.rayLen) + 4;
  const rows = [88, 88.5, 88.99].map((lat) => { const dp = (90 - lat) * Math.PI / 180 * 1737400; return `${lat}: ${(reach * reach / (2 * dp)).toFixed(2)} m`; });
  console.log(`drop ${drop}: r ${s.r.toFixed(1)} m, reach ${reach.toFixed(1)} m (paint ends >= 4 m inside); sagitta of the box's north edge at`, rows.join(', '));
}
