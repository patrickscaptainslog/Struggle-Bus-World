// OKLCH of a byte colour and art's brown gate (research-art.md), one copy for tools/skycheck.mjs, which reads them off real frames, and tools/sky/brown.ts, which reads
// them off the live tables at every height of the Sun.

const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** OKLCH of 0xRRGGBB: L, C, hue in degrees. */
export function lch(c) {
  const r = lin(((c >> 16) & 255) / 255), g = lin(((c >> 8) & 255) / 255), b = lin((c & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
/** Brown or taupe: OKLCH hue 35-100, L < 0.60 and C > 0.03, or L < 0.72 and 0.02 < C < 0.09. */
export function isBrown(c) {
  const [L, C, h] = lch(c);
  return h > 35 && h < 100 && ((L < 0.6 && C > 0.03) || (L < 0.72 && C > 0.02 && C < 0.09));
}
