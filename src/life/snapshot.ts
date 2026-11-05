import { ROW } from './kinds';

// A snapshot's buffer (LIFE.md, "The worker"), transferred to the host and back: nothing in it is made per message.
//   bytes 0-7    utcMs it's for (Float64)
//   bytes 8-11   rows (u32), bytes 12-15 the key section's length in bytes (u32)
//   then the rows, ROW floats each, then the keys the host hasn't had yet: hash (u32), length (u16), its ASCII bytes, padded to 4

export const MAX_ROWS = 4096;
const HEAD = 16;
const KEY_BYTES = 65536;
export const SNAP_BYTES = HEAD + MAX_ROWS * ROW * 4 + KEY_BYTES;

export interface SnapView {
  buf: ArrayBuffer;
  rows: Float32Array;
  /** the rows as u32, for their key column */
  rowsU32: Uint32Array;
  u32: Uint32Array;
  f64: Float64Array;
  bytes: Uint8Array;
  dv: DataView;
}

export function view(buf: ArrayBuffer): SnapView {
  // (views over a transferred buffer are the one thing a message makes: every transfer arrives as a new ArrayBuffer, and with no SharedArrayBuffer, CONTRACT.md
  // section 2, there's no other way to read one. Five small objects ten times a second; the rows themselves are never copied)
  return { buf, rows: new Float32Array(buf, HEAD, MAX_ROWS * ROW), rowsU32: new Uint32Array(buf, HEAD, MAX_ROWS * ROW), u32: new Uint32Array(buf, 0, 4), f64: new Float64Array(buf, 0, 1), bytes: new Uint8Array(buf), dv: new DataView(buf) };
}

/** The keys section's start in bytes. */
export const KEYS_AT = HEAD + MAX_ROWS * ROW * 4;

/** Writes a key at byte `at` of the keys section; returns the next free byte, or -1 when it's full (the key goes in the next snapshot). */
export function writeKey(v: SnapView, at: number, hash: number, key: string): number {
  const n = key.length, end = at + 6 + n, pad = (end + 3) & ~3;
  if (pad > KEY_BYTES) return -1;
  const o = KEYS_AT + at;
  v.dv.setUint32(o, hash, true);
  v.dv.setUint16(o + 4, n, true);
  for (let i = 0; i < n; i++) v.bytes[o + 6 + i] = key.charCodeAt(i) & 0x7f;
  return pad;
}

/** Each key in a snapshot's keys section, to `got` (the host's; it makes a string only for a key it hasn't seen). */
export function readKeys(v: SnapView, known: Map<number, string>): void {
  const len = v.u32[3];
  let at = 0;
  while (at < len) {
    const o = KEYS_AT + at, hash = v.dv.getUint32(o, true), n = v.dv.getUint16(o + 4, true);
    if (!known.has(hash)) {
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(v.bytes[o + 6 + i]);
      known.set(hash, s);
    }
    at = (at + 6 + n + 3) & ~3;
  }
}
