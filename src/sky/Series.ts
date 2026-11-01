// The ephemeris behind the sky model. series.gen.js is the tested bundle, whole and unchanged: shots/local/sky/work/sky-scripts/bundle-work/final-bundle.mjs, trimmed astronomy-engine
// 2.1.19 (GeoMoon, the Earth VSOP series, sidereal time, precession and nutation), a hand port of the Moon's IAU axis, JPL's Keplerian planets, Delta T 69.18 s, built by
// sky-scripts/trim-ae.mjs and final-entry.mjs (S2's tools/sky/trim-ae.mjs). It also carries the prototype's SkyModel; nothing reaches for that, and the build drops it.
import { series as bundled } from './series.gen.js';
import type { Series } from './SkyModel';

export const series: Series = bundled;
