#!/usr/bin/env node
// Release A, 1a: the coarse region's paint mask (src/world/GroundPaint.ts attachRegion), in Node against the real GroundPaint and a stand-in renderer that
// keeps what each texSubImage2D writes: node --no-warnings tools/above/s_rmask.mjs [--nofill]
// Two coarse regions side by side, every tile shown in its region's mask. After each write the region textures are read back and held, slot by slot, against
// the tile masks they mirror (a tile with no mask: zeros), and each mask's slot must be flagged (uGroundSq). The writes: a tap, a Bomb's crater (a wide
// job with a deadline, across the regions' border, checked every frame it draws), a Sonic Boom's ring, a settled blast (the QA seed's), Curb's dab, a stale
// serial's clear, and the saved paint read at load (a second page on the same storage). And the views apart from the mask's life: an own view added to a
// live mask with a replay queued and a blast in flight (the array and the queue untouched, the blast lands whole), an own view dropped while the region
// holds the mask (the replays and what's saved stay), the region's views dropped (saved, then freed). Every frame: at most one call a region slot.
// Prints each write's upload calls and bytes, and what a painted region costs. --nofill (the switch ?rmask=nofill: masks made, never filled) must fail.
// Exit 1 if any row fails.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    return next(/^\.\.?\//.test(spec) && !/\.[a-z]+$/.test(spec) ? `${spec}.ts` : spec, ctx);
  },
});
const mem = new Map();
globalThis.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { GroundPaint } = await import('../../src/world/GroundPaint.ts');
const { globals } = await import('../../src/render/materials.ts');
const { makeBlastSpec, blastRadiusFor, groundDeadline, LAYOUT_RING } = await import('../../src/game/blastLayout.ts');

const NOFILL = process.argv.includes('--nofill');
const TS = 256, N = 128, RS = 4;
let bad = 0;
const row = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(78)} ${JSON.stringify(got)}`);
};

// the stand-in renderer: a texture made by initTexture keeps a copy of every texSubImage2D into it
const gl = {
  TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, UNPACK_ALIGNMENT: 0x0cf5, UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  UNPACK_ROW_LENGTH: 0x0cf2, UNPACK_SKIP_PIXELS: 0x0cf4, UNPACK_SKIP_ROWS: 0x0cf3, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  texSubImage2D(target, level, x, y, w, h, f, t, src, off) {
    const T = bound, rl = rowLen || w;
    for (let j = 0; j < h; j++) T.data.set(src.subarray(off + j * rl * 4, off + j * rl * 4 + w * 4), ((y + j) * T.w + x) * 4);
    const slot = `${T.id}:${Math.floor(x / N)},${Math.floor(y / N)}`;
    frameSlots.set(slot, (frameSlots.get(slot) ?? 0) + 1);
    slotBytes.set(slot, (slotBytes.get(slot) ?? 0) + w * h * 4);
  },
};
let bound = null, rowLen = 0, nextId = 1;
let frameSlots = new Map();
/** bytes sent to each texture's slot since it was last cleared */
const slotBytes = new Map();
const props = new WeakMap();
const R = {
  properties: { get: (o) => { let p = props.get(o); if (!p) props.set(o, (p = {})); return p; } },
  initTexture(tex) {
    const p = R.properties.get(tex);
    p.__webglTexture = { id: nextId++, w: tex.image.width, h: tex.image.height, data: new Uint8Array(tex.image.width * tex.image.height * 4) };
  },
  getContext: () => gl,
  state: { activeTexture() {}, bindTexture(_t, x) { bound = x; }, pixelStorei(p, v) { if (p === gl.UNPACK_ROW_LENGTH) rowLen = v; } },
};

const uni = () => ({ tGround: { value: null }, uGroundOn: { value: 0 } });
let REGIONS = [[0, 0], [1, 0]];
const tilesOf = ([rx, rz]) => { const o = []; for (let tz = rz * RS; tz < (rz + 1) * RS; tz++) for (let tx = rx * RS; tx < (rx + 1) * RS; tx++) o.push([tx, tz]); return o; };
/** a page: 'region', its tiles shown in their regions' masks (?rmask=1), or 'own', each through ground of its own (?rmask=0: today's split ground) */
const page = (kind) => {
  const g = new GroundPaint(TS, 'rmask_check', 'rank');
  g.regionNoFill = NOFILL;
  g.kind = kind;
  for (const [rx, rz] of REGIONS) {
    if (kind === 'region') g.regionUniforms(rx, rz, RS);
    for (const [tx, tz] of tilesOf([rx, rz])) kind === 'region' ? g.attachRegion(tx, tz, tx * TS, tz * TS, rx, rz) : g.attach(tx, tz, tx * TS, tz * TS, uni());
  }
  return g;
};
/** what three does at the next draw of a tile's own texture set to needsUpdate: the whole array up (the stand-in keeps it) */
const drawn = (g) => {
  for (const m of g.masks.values()) {
    if (!m.tex) continue;
    const p = R.properties.get(m.tex);
    if (p.seen === m.tex.version) continue;
    p.seen = m.tex.version;
    p.__webglTexture = { id: nextId++, w: N, h: N, data: m.data.slice() };
  }
};
let worstSlot = 0;
const sum = { calls: 0, bytes: 0, regionCalls: 0, regionBytes: 0 };
const pages = [];
const frame = (n = 1, each = null) => {
  for (let k = 0; k < n; k++) {
    globals.uTime.value += 1 / 30;
    for (const g of pages) {
      g.work();
      frameSlots = new Map();
      g.flush(R, 1 / 30);
      drawn(g);
      if (g.kind === 'region') {
        for (const v of frameSlots.values()) worstSlot = Math.max(worstSlot, v);
        for (const f of ['regionCalls', 'regionBytes']) sum[f] += g.uploadQa[f];
      } else for (const f of ['calls', 'bytes']) sum[f] += g.uploadQa[f];
    }
    each?.();
  }
};
const taken = () => { const o = { ...sum }; for (const f of Object.keys(sum)) sum[f] = 0; return o; };
/**
 * Every region slot of page A against what it mirrors: the tile mask's array (a tile with no mask: zeros), and, with page B (today's own grounds, the
 * same writes), what B's own texture holds on the GPU (mid-blast the arrays run ahead of the textures, the hidden rows a wide blast draws in flight).
 */
const held = (A, B = null) => {
  let diff = 0, gpu = 0, arrays = 0, unflagged = 0, slots = 0, painted = 0;
  for (const reg of REGIONS)
    for (const [tx, tz] of tilesOf(reg)) {
      const s = A.regionSlot(tx, tz);
      if (!s) continue;
      slots++;
      const T = s.tex ? R.properties.get(s.tex).__webglTexture : null;
      const mb = B?.masks.get(`${tx},${tz}`) ?? null;
      const TB = mb?.tex ? R.properties.get(mb.tex).__webglTexture : null;
      if (s.data && !s.flag) unflagged++;
      if (B && (!!mb !== !!s.data)) arrays += N * N * 4;
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N * 4; i++) {
          const o = j * N * 4 + i;
          const want = s.data ? s.data[o] : 0;
          const got = T ? T.data[((s.rj * N + j) * T.w + s.ri * N) * 4 + i] : 0;
          if (B && s.data && mb && mb.data[o] !== want) arrays++;
          if (B && got !== (TB ? TB.data[o] : 0)) gpu++;
          if (!B && want !== got) diff++;
          if (i % 4 === 0 && want >= 128) painted++;
        }
    }
  return B ? { gpuDiff: gpu, arrayDiff: arrays, unflagged, slots, painted } : { diff, unflagged, slots, painted };
};
/** settled: A's region textures equal A's arrays, A's arrays equal B's, and A's region textures equal B's own textures */
const check = (name, extra = {}) => {
  const [A, B] = pages;
  const h = held(A), hb = held(A, B);
  row(name, h.diff === 0 && h.unflagged === 0 && h.painted > 0 && hb.gpuDiff === 0 && hb.arrayDiff === 0, { ...h, vsOwn: { gpu: hb.gpuDiff, arrays: hb.arrayDiff }, ...extra });
  return h;
};
let seed = 7;
const nextSeed = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
/** a live blast on both pages, begun `lead` s before its impact and drawn over the frames to it, then landed */
const live = (spec, lead = 0.5, deadline = 0, each = null) => {
  const t1 = globals.uTime.value + lead;
  const jobs = pages.map((g) => g.begin({ ...spec }, t1, deadline));
  while (globals.uTime.value < t1) frame(1, each);
  pages.forEach((g, k) => g.land(jobs[k]));
  frame(1, each);
  let n = 0;
  while (pages.some((g) => g.queued) && n++ < 600) frame(1, each);
  return jobs;
};
const both = (f) => pages.forEach(f);

pages.push(page('region'), page('own'));
const [A, B] = pages;
const tap = blastRadiusFor(0);
// 1. a tap inside region (0, 0)
live(makeBlastSpec(300, 420, tap, 2, nextSeed()));
check('a tap: the region mask equals its tiles, and today\'s own textures', { r: tap, ...taken() });
// 2. a Bomb's crater on the regions' border: a wide job, its rows drawn by its wave, the textures checked against today's every frame from its begin
{
  const r = 230, dl = groundDeadline(r);
  let worst = 0, frames = 0;
  live(makeBlastSpec(4 * TS, 500, r, 4, nextSeed()), 0.6, dl, () => { frames++; worst = Math.max(worst, held(A, B).gpuDiff); });
  row('a Bomb\'s crater across two regions: as today\'s textures in every frame', worst === 0 && frames > 0, { r, deadline: +dl.toFixed(2), frames, worstDiff: worst });
  check('a Bomb\'s crater: settled, both regions equal', taken());
}
// 3. a Sonic Boom's ring: its band only, the ground inside left bare
{
  const s = makeBlastSpec(1500, 300, 140, 1, nextSeed());
  Object.assign(s, { layout: LAYOUT_RING, ring: 90, edge: 1, ragged: 0.08, rays: 8, rayLen: 0.25 });
  live(s);
  check('a Sonic Boom\'s ring: equal', taken());
}
// 4. a settled blast (the QA seed's), and Curb's dabs, a few texels each
both((g) => g.blast(makeBlastSpec(700, 800, tap, 3, 1234), -100));
frame(2);
check('a settled blast: equal', taken());
both((g) => { for (let k = 0; k < 20; k++) g.dab(makeBlastSpec(100 + k * 3, 900, 2.2, 5, 99 + k)); });
frame(2);
check('Curb\'s dabs: equal', taken());
// 4b. writers on tiles whose masks and own textures are up already (a partial upload each): every own texture on the GPU equals its array, and every
// region slot. A dab writes texels past p's box (review 2, R2-4)
{
  const off = (g) => {
    let n = 0;
    for (const m of g.masks.values()) {
      if (!m.tex) continue;
      const T = R.properties.get(m.tex).__webglTexture;
      if (!T) continue;
      for (let o = 0; o < m.data.length; o++) if (T.data[o] !== m.data[o]) n++;
    }
    return n;
  };
  // (each on a tile of its own, up since the rows above: the dabs (0, 3), the settled blast (2, 3), the tap (1, 1))
  const by = {};
  both((g) => { for (let k = 0; k < 20; k++) g.dab(makeBlastSpec(101 + k * 3, 905, 2.2, 5, 300 + k)); });
  frame(2);
  by.dabs = off(B);
  both((g) => g.blast(makeBlastSpec(712, 806, tap, 2, 4321), -100));
  frame(2);
  by.settled = off(B) - by.dabs;
  live(makeBlastSpec(310, 430, tap, 1, nextSeed()));
  by.tap = off(B) - by.dabs - by.settled;
  const h = held(A), hb = held(A, B);
  row('writers on tiles already up: each own texture on the GPU equals its array, each region slot too', Object.values(by).every((v) => v === 0) && h.diff === 0 && hb.gpuDiff === 0, { ownBytesOff: by, regionDiff: h.diff, vsOwn: hb.gpuDiff, ...taken() });
}
// 5. a stale serial's clear: 255 blasts on, the first one's serial comes round and its tiles' masks are cleared of it, a whole tile each
both((g) => { for (let k = 0; k < 255; k++) g.blast(makeBlastSpec(1800 + (k % 10) * 6, 700 + Math.floor(k / 10) * 6, 8, k % 6, 500 + k), globals.uTime.value); });
frame(1);
taken();
live(makeBlastSpec(1900, 200, tap, 0, nextSeed()));
check('a stale serial cleared (whole tiles): equal', taken());
// 6. the views apart from the mask's life (page A; page B does the same writes through ground of its own)
{
  // (a blast saved for tile (2, 5) while it wasn't in: a pending replay in its record; then the tile shown, in region (0, 1)'s mask on A)
  both((g) => g.blast(makeBlastSpec(2.5 * TS, 5.5 * TS, tap, 1, 4321), -100));
  A.regionUniforms(0, 1, RS);
  A.attachRegion(2, 5, 2 * TS, 5 * TS, 0, 1);
  B.attach(2, 5, 2 * TS, 5 * TS, uni());
  const rep0 = A.replaying.get('2,5') ?? 0;
  // a blast in flight over it, half drawn
  const t1 = globals.uTime.value + 1;
  const jobs = pages.map((g) => g.begin(makeBlastSpec(2.4 * TS, 5.4 * TS, tap, 4, 8765), t1));
  frame(3);
  const m = A.masks.get('2,5');
  const before = m ? m.data.slice() : null;
  const rep1 = A.replaying.get('2,5') ?? 0, q1 = A.queued;
  A.attach(2, 5, 2 * TS, 5 * TS, uni());
  const same = before && m && A.masks.get('2,5') === m && Buffer.compare(Buffer.from(before), Buffer.from(m.data)) === 0;
  row('an own view onto a live mask: array, replays and queue untouched', !!same && A.replaying.get('2,5') === rep1 && A.queued === q1 && rep0 > 0, { replays: [rep0, rep1, A.replaying.get('2,5')], queued: [q1, A.queued], ownTexture: !!m?.tex });
  while (globals.uTime.value < t1) frame(1);
  pages.forEach((g, k) => g.land(jobs[k]));
  frame(3);
  const ma = A.masks.get('2,5'), mb = B.masks.get('2,5');
  let ser = 0, d = 0;
  for (let t = 0; t < ma.data.length; t++) if (ma.data[t] !== mb.data[t]) d++;
  for (let t = 3; t < ma.data.length; t += 4) if (ma.data[t] === jobs[0].serial) ser++;
  row('  the blast in flight lands whole on it (its texels as today\'s), its slot equal', ser > 1000 && d === 0 && held(A).diff === 0, { itsTexels: ser, bytesVsToday: d, slots: held(A).diff });
  // an own view dropped while the region holds the mask
  const q2 = A.queued;
  A.detach(2, 5);
  row('an own view dropped, the region holding the mask: mask, queue kept, texture gone', A.masks.get('2,5') === ma && !ma.tex && A.queued === q2, { queued: [q2, A.queued], mask: A.masks.has('2,5') });
}
// 7. what a painted region costs
{
  const st = A.regionStats();
  row('memory: region masks 1 MiB each, no tile texture of its own in a coarse region', st.bytes === st.textures * (N * RS) ** 2 * 4 && st.owns === 0, st);
}
// 8. saved at a page hide, read at the next page's load: every tile of both regions shown in its region's mask again
both((g) => g.persist());
const paintedBefore = held(A).painted;
pages.length = 0;
globals.uTime.value = 0;
const A2 = page('region');
pages.push(A2);
// (what the views' attach added to fillBytes, which the city's adoption budget reads, against what the first flush sends to region slots. Review 2, R2-1)
const fill8 = A2.fillBytes;
const whole8 = [...A2.masks.values()].filter((m) => m.reg && m.regAll);
slotBytes.clear();
frame(1);
const first8 = taken();
let sent8 = 0;
for (const m of whole8) sent8 += slotBytes.get(`${R.properties.get(m.reg.tex).__webglTexture.id}:${m.ri},${m.rj}`) ?? 0;
frame(2);
const h2 = held(A2);
row('saved paint at load: the region masks equal the decoded tiles', h2.diff === 0 && h2.unflagged === 0 && h2.painted > 0, { ...h2, ...taken() });
row('  its painted texels as before the reload (the saved code is 5-bit: within 1 %)', Math.abs(h2.painted - paintedBefore) <= paintedBefore * 0.01, { before: paintedBefore, after: h2.painted });
row('  fillBytes added by the attach equals what the first flush sends to the slots it queued whole', fill8 > 0 && fill8 === sent8 && whole8.length * N * N * 4 === fill8, { fillKiB: fill8 / 1024, slots: whole8.length, sentKiB: sent8 / 1024, flushKiB: +(first8.regionBytes / 1024).toFixed(1), calls: first8.regionCalls });
// 9. a region's views dropped: each tile saved and its mask dropped, the region freed
{
  const saved0 = A2.tileCount;
  for (const [tx, tz] of tilesOf([0, 0])) A2.detachRegion(tx, tz);
  A2.releaseRegion(0, 0);
  const st = A2.regionStats();
  row('region (0, 0)\'s views dropped: its masks gone, still saved; the region freed', [...A2.masks.keys()].every((k) => Number(k.split(',')[0]) >= RS) && st.regions === 1 && A2.tileCount === saved0 && saved0 > 0, { ...st, saved: [saved0, A2.tileCount] });
}
// 10. ?moon's slide, by a whole region (City.slide): the masks rekeyed, each tile still in its slot, and a blast after it lands there
{
  const before = new Map();
  for (const [tx, tz] of tilesOf([1, 0])) before.set(`${tx - RS},${tz}`, A2.regionSlot(tx, tz)?.data ?? null);
  A2.slide(RS, 0, RS * TS, 0, new Set());
  const st = A2.regionStats();
  let same = 0, n = 0;
  for (const [tx, tz] of tilesOf([0, 0])) {
    const s = A2.regionSlot(tx, tz);
    n++;
    if (s && s.rx === 0 && s.rz === 0 && s.data === before.get(`${tx},${tz}`)) same++;
  }
  row('a slide by one region: the mask under its new key, each tile in its slot with its own array', st.regions === 1 && A2.regions.has('0,0') && same === n && [...before.values()].some((d) => d), { ...st, same, n });
  A2.blast(makeBlastSpec(2 * TS, 2 * TS, tap, 3, 4321), -100);
  frame(3);
  const h = held(A2);
  row('  a blast after the slide: the region\'s slots equal the tiles\' arrays', h.diff === 0 && h.unflagged === 0 && h.painted > 0, h);
}
// 11. a Bomb III's crater (r 459 m, a wide job) over unpainted coarse ground, 3 x 3 regions: every tile in its box gets a mask in its first frame, and none
// may send its slot's zeros (the slot holds them already). The mark: no frame sends more than one region's whole mask, 1 MiB (the budget a region turning
// coarse or a twin's first fill takes); before the fix its first frame sent 36 whole slots, 2,304 KiB (the review's finding 1)
{
  pages.length = 0;
  REGIONS = [];
  for (let rz = 0; rz < 3; rz++) for (let rx = 0; rx < 3; rx++) REGIONS.push([rx, rz]);
  globals.uTime.value = 0;
  mem.clear();
  pages.push(page('region'), page('own'));
  const [A3] = pages;
  const r = 459, dl = groundDeadline(r);
  let worst = 0, worstAt = -1, worstCalls = 0, frames = 0, total = 0, made = 0;
  taken();
  live(makeBlastSpec(1.5 * RS * TS, 1.5 * RS * TS, r, 2, nextSeed()), 0.6, dl, () => {
    const q = A3.uploadQa;
    total += q.regionBytes;
    if (q.regionBytes > worst) (worst = q.regionBytes, worstAt = frames, worstCalls = q.regionCalls);
    frames++;
  });
  made = A3.masks.size;
  const MiB = (N * RS) ** 2 * 4;
  row('a Bomb III over unpainted coarse ground: no frame sends more than 1 MiB of paint', worst <= MiB && frames > 0 && made > 16, { r, masks: made, frames, worstFrame: worstAt, worstCalls, worstKiB: +(worst / 1024).toFixed(1), totalKiB: +(total / 1024).toFixed(1) });
  check('  settled: the 9 regions equal their tiles, and today\'s own textures', taken());
}
row('every frame: at most one upload a region slot', worstSlot <= 1, { worstSlot });
console.log(bad ? `S_RMASK FAILED: ${bad}` : 's_rmask: all passed');
process.exit(bad ? 1 : 0);
