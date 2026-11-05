// Life's integer hashes (CONTRACT.md section 5): every choice a simulation makes comes from these, never from Math.random or a float's last bit, so every
// player and every engine sees the same mover. Worker-safe.

/** FNV-1a, 32 bits, of a string: a mover's key for its row (LIFE.md, "The worker"). */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A 32-bit mix of integers (murmur3's finaliser over each): a choice from a place, a time bucket and a slot. */
export function mix(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    let k = Math.imul(x | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    h ^= Math.imul(k, 0x1b873593);
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A hash's share of 0..1 (so a float only ever places a thing, never chooses one). */
export const unit = (h: number): number => h / 4294967296;
