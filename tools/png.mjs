// A PNG's pixels for the tools that judge a screenshot: 8-bit, non-interlaced RGB or RGBA (what Chrome's screenshots are).
//   import { readPng } from './png.mjs';  const { w, h, px } = readPng(buffer);   (px: RGBA bytes, row-major)
import { inflateSync } from 'node:zlib';

export function readPng(b) {
  if (b.toString('latin1', 1, 4) !== 'PNG') throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, ch = 0;
  const idat = [];
  while (o < b.length) {
    const n = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8);
    if (t === 'IHDR') {
      w = b.readUInt32BE(o + 8);
      h = b.readUInt32BE(o + 12);
      ch = { 2: 3, 6: 4 }[b[o + 17]];
      if (b[o + 16] !== 8 || !ch || b[o + 20]) throw new Error('only 8-bit, non-interlaced RGB(A)');
    } else if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n));
    o += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, up = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = up;
      else if (f === 3) p = (a + up) >> 1;
      else if (f === 4) {
        const e = a + up - c, pa = Math.abs(e - a), pb = Math.abs(e - up), pc = Math.abs(e - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      cur[x] = (raw[s + x] + p) & 255;
    }
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      px[d] = cur[x * ch];
      px[d + 1] = cur[x * ch + 1];
      px[d + 2] = cur[x * ch + 2];
      px[d + 3] = ch === 4 ? cur[x * ch + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { w, h, px };
}

/** A PNG's width and height from its header alone */
export function pngSize(b) {
  if (b.toString('latin1', 1, 4) !== 'PNG' || b.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
