#!/usr/bin/env node
// The far boxes' merge alone, on an idle thread (in the game it runs at boot beside the city worker's first regions, so its own clock reads high).
//   node tools/far/mergetime.mjs [slug=sf] [topStep=4] [chunkTiles=4]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { mergeFarBlocks } from '../../src/world/farBlocks.ts';

const [slug = 'sf', topStep = '4', chunkTiles = '4'] = process.argv.slice(2);
const dir = new URL(`../../public/city/${slug}/`, import.meta.url);
const open = (f) => {
  const b = readFileSync(new URL(f, dir));
  return b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b;
};
const r = open('far16.bin');
const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
const W = dv.getUint32(4, true), H = dv.getUint32(8, true);
const f32 = (k) => dv.getFloat32(12 + k * 4, true);
const plane = (k) => new Uint8Array(r.buffer, r.byteOffset + 40 + k * W * H, W * H);
const far = open('far.bin');
const fv = new DataView(far.buffer, far.byteOffset, far.byteLength);
const n = fv.getUint32(4, true), gridW = fv.getUint32(8, true), gridH = fv.getUint32(12, true);
const hq = new Int16Array(far.buffer.slice(far.byteOffset + 28 + n * 32, far.byteOffset + 28 + n * 32 + gridW * gridH * 2));
const req = {
  W, H, a: f32(0), c: f32(2), e: f32(4), f: f32(5), tileCells: 16, chunkTiles: Number(chunkTiles), topStep: Number(topStep), seed: 1,
  cls: plane(0), height: plane(2), tone: plane(1), wallTone: plane(5),
  ground: Float32Array.from(hq, (v) => v / 10), groundW: gridW, groundH: gridH, groundX: fv.getFloat32(16, true), groundZ: fv.getFloat32(20, true), groundCell: fv.getFloat32(24, true),
  towers: new Float32Array(far.buffer.slice(far.byteOffset + 28, far.byteOffset + 28 + n * 28)), towerCount: n,
};
const runs = [];
let res;
for (let i = 0; i < 6; i++) {
  res = mergeFarBlocks(req);
  runs.push(res.ms);
}
console.log(slug, `${res.boxes} boxes from ${res.cells} roof cells, ${res.chunks.length} chunks; merge ms ${runs.map((v) => v.toFixed(0)).join(' ')}`);
