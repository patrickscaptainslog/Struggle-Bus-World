// Where you last painted, kept (src/game/Return.ts, docs/specs/core/STAGE1.md): the return record and readReturn's rule, in Node, on San Francisco's and
// Amsterdam's real city.json (bounds, origin, the bridges' points: the scale-to-the-world ruling, so the rule is checked where there's no bridge too).
// readReturn: a bus pose within 400 m of P, and P 100 m or more ahead of it, starts at that pose, height included (P nearer, beside or behind: 220 m
// back); a far one 220 m back from P on its heading; near the map's edges the
// +180, +90 and -90 turns in that order, each inside the 400 m inset; a start within 250 m of a bridge's line (the Golden Gate's and the Bay Bridge's
// points) moves on to the next turn; nothing passing is null; a bad record (null for a number, a string, 7 numbers, P outside the bounds), the paint not
// saved, a city that saves none, the opening never seen, each link that starts elsewhere (recess and swerve too), the page booted elsewhere, and a store
// that throws on read are each null. Every one of these rows is run again on a stub that always returns the saved bus pose, and must fail there, but
// the rows whose right answer is that pose (they say so).
// The record: noteReturn then flushReturn writes eight numbers, which read back to the pose within 0.2 m; nothing is written with nothing noted; a store
// that throws on setItem (full, or blocked) writes nothing, keeps the record waiting and throws nothing, and the next good store gets it; clearReturn
// drops it. PaintState: persist() is true and runs afterSave only when every write went through; saves and hasSaved.
//   node tools/feel-sim/run.mjs ../return/s_return.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readReturn, noteReturn, flushReturn, clearReturn, pendingReturn, notesReturn, returnKey, returnTune, OPENING_SEEN_KEY, type ReturnInput, type ReturnStart } from '@src/game/Return';
import { latLonToLocal, localToLatLon } from '@src/game/geo';
import { PaintState } from '@src/world/PaintState';

const data = process.env.SB_DATA!;
type Manifest = ReturnInput['manifest'] & { slug: string };
const man = (slug: string): Manifest => JSON.parse(readFileSync(join(dirname(data), slug, 'city.json'), 'utf8'));
const SF = man('sf'), AMS = man('amsterdam');

/** a map store, with an optional failure on read or write */
class Mem {
  m = new Map<string, string>();
  writes = 0;
  constructor(public failGet = false, public failSet = false) {}
  getItem(k: string) {
    if (this.failGet) throw new Error('SecurityError');
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.failSet) throw new DOMException('quota', 'QuotaExceededError');
    this.writes++;
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const deg = (r: number) => (((Math.round((r * 180) / Math.PI) % 360) + 360) % 360);
/** a record as noteReturn writes it, from map metres: the bus at (bx, bz, by) heading h (rad), P at (px, pz), id */
function record(m: Manifest, b: { x: number; z: number; y: number; h: number }, p: { x: number; z: number }, id = 7): string {
  const [bl, bo] = localToLatLon(b.x, b.z, m.origin), [pl, po] = localToLatLon(p.x, p.z, m.origin);
  return JSON.stringify([bl, bo, b.y, deg(b.h), pl, po, id, 1763000000]);
}
type Case = { m: Manifest; raw?: string | null; seen?: string | null; saves?: boolean; saved?: boolean; q?: string; elsewhere?: boolean; failGet?: boolean };
function input(c: Case): ReturnInput {
  const s = new Mem(!!c.failGet);
  if (c.seen !== null) s.m.set(OPENING_SEEN_KEY, c.seen ?? '1');
  if (c.raw !== null && c.raw !== undefined) s.m.set(returnKey(c.m.slug), c.raw);
  return { slug: c.m.slug, params: new URLSearchParams(c.q ?? ''), elsewhere: !!c.elsewhere, manifest: c.m, paint: { saves: c.saves ?? true, hasSaved: () => c.saved ?? true }, store: s };
}
/** the stub: always the saved bus pose, whatever the record and the page */
function stub(o: ReturnInput): ReturnStart {
  try {
    const r = JSON.parse((o.store as Mem).m.get(returnKey(o.slug)) ?? 'null') as number[];
    const [x, z] = latLonToLocal(r[0], r[1], o.manifest.origin);
    return { pose: { x, y: r[2], z, heading: (r[3] * Math.PI) / 180 }, which: 'bus', p: { x: 0, z: 0 }, id: r[6] };
  } catch {
    return { pose: { x: 0, y: 60, z: 0, heading: 0 }, which: 'bus', p: { x: 0, z: 0 }, id: 0 };
  }
}

const rows: Array<{ name: string; real: boolean; stub: boolean; stubMayPass: boolean; got: string }> = [];
const near = (a: number, b: number, e = 0.2) => Math.abs(a - b) <= e;
/** a row: the check run on readReturn and on the stub */
function row(name: string, c: Case, check: (r: ReturnStart) => boolean, stubMayPass = false) {
  const r = readReturn(input(c));
  const got = r.pose ? `${r.which} (${r.pose.x.toFixed(1)}, ${r.pose.y.toFixed(1)}, ${r.pose.z.toFixed(1)}) ${deg(r.pose.heading)} deg` : `null (${r.why})`;
  rows.push({ name, real: check(r), stub: check(stub(input(c))), stubMayPass, got });
}
const at = (r: ReturnStart, x: number, z: number, h: number, y?: number) => !!r.pose && near(r.pose.x, x) && near(r.pose.z, z) && near(deg(r.pose.heading), deg(h), 0.5) && (y === undefined || near(r.pose.y, y));
const isNull = (why?: string) => (r: ReturnStart) => r.pose === null && (why === undefined || r.why === why);
const back = (p: { x: number; z: number }, h: number) => ({ x: p.x - Math.sin(h) * returnTune.back, z: p.z + Math.cos(h) * returnTune.back });

for (const m of [SF, AMS]) {
  const [x0, z0, x1, z1] = m.bounds;
  const mid = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
  // (in Amsterdam, a 2 km map, the middle; in San Francisco, the Mission: clear of both bridges)
  const P = m === SF ? { x: 300, z: 1700 } : mid;
  const n = m.slug;
  const H = (60 * Math.PI) / 180;
  // the bus within 400 m of P: its own pose, height included
  const B = { x: P.x - 150 * Math.sin(H), z: P.z + 150 * Math.cos(H), y: 71.5, h: H };
  row(`${n}: a bus pose 150 m from P starts at that pose, height included`, { m, raw: record(m, B, P) }, (r) => at(r, B.x, B.z, H, 71.5) && r.pose !== null && r.which === 'bus', true);
  // a tap from the roofs: P 40 m ahead, too near to frame (returnTune.ahead): 220 m back from P on the heading, at the bus's height; and P beside the bus
  // (60 m off its line, 20 m ahead) or behind it the same
  const nb = back(P, H);
  for (const [what, ahead, side] of [['40 m ahead of it', 40, 0], ['beside it', 20, 60], ['behind it', -80, 0]] as const) {
    const C = { x: P.x - ahead * Math.sin(H) + side * Math.cos(H), z: P.z + ahead * Math.cos(H) + side * Math.sin(H), y: 64, h: H };
    row(`${n}: P ${what}: not the bus pose but 220 m back from P on its heading`, { m, raw: record(m, C, P) }, (r) => at(r, nb.x, nb.z, H, 64) && r.pose !== null && r.which === 'back');
  }
  // far: 220 m back from P along the heading, at the bus's height
  const F = { x: P.x - 700 * Math.sin(H), z: P.z + 700 * Math.cos(H), y: 120, h: H };
  const fb = back(P, H);
  row(`${n}: a bus pose 700 m from P starts 220 m back from P on its heading`, { m, raw: record(m, F, P) }, (r) => at(r, fb.x, fb.z, H, 120) && r.pose !== null && r.which === 'back');
  // near each edge: the turns in order, inside the inset
  const inset = returnTune.inset;
  for (const [edge, p, h, want] of [
    // heading north (0) at the south edge's inset: back is south, outside; +180 faces south from the north side, inside
    ['the south edge', { x: mid.x, z: z1 - inset - 100 }, 0, 'back+180'],
    // heading east at the west edge: back is west, outside; +180 inside
    ['the west edge', { x: x0 + inset + 100, z: mid.z }, Math.PI / 2, 'back+180'],
    // heading east in the south-west corner: back (west) and +180 (from the east)... +180's start is east, inside x, but the corner's z: inside; so a corner
    // where back and +180 both fail: heading north at the west edge's inset + 100 with P 100 m inside the south inset: back (south) out, +180 (north) in
    ['a south-west corner, heading north', { x: x0 + inset + 100, z: z1 - inset - 100 }, 0, 'back+180'],
  ] as const) {
    const b = { x: p.x - 700 * Math.sin(h), z: p.z + 700 * Math.cos(h), y: 90, h };
    const t = h + (want === 'back+180' ? Math.PI : 0), s = back(p, t);
    row(`${n}: P near ${edge}: ${want}, inside the inset`, { m, raw: record(m, b, p) }, (r) => at(r, s.x, s.z, t) && r.pose !== null && r.which === want && r.pose.x > x0 + inset && r.pose.x < x1 - inset && r.pose.z > z0 + inset && r.pose.z < z1 - inset);
  }
  // +90: a heading along an edge, P 100 m inside it: back and +180 run along it and stay in, so make them fail by the other edge: P in a corner,
  // heading north-ish along the west edge with P 100 m inside the south inset: back is south (out), +180 north (in): +180. For +90 first, both back and
  // +180 must be out: a long axis too short for 220 m either way is the only way inside one map, so it's made by a bounds of its own (the rule's, not a city's)
  const thin: Manifest = { ...m, bounds: [x0, P.z - inset - 150, x1, P.z + inset + 150] };
  {
    const h = 0, b = { x: P.x, z: P.z + 700, y: 90, h }, t = h + Math.PI / 2, s = back(P, t);
    row(`${n}: a map 300 m wide past its inset, heading across it: +90 (back and +180 out of the inset)`, { m: thin, raw: record(thin, b, P) }, (r) => at(r, s.x, s.z, t) && r.pose !== null && r.which === 'back+90');
  }
  {
    // -90: +90 out too: P near the west edge as well, so +90's start (from the west side, facing east... a = 90 deg, start = P - 220 along east = west) is out
    const p = { x: x0 + inset + 100, z: P.z };
    const thinW: Manifest = { ...m, bounds: [x0, p.z - inset - 150, x1, p.z + inset + 150] };
    const h = 0, b = { x: p.x, z: p.z + 700, y: 90, h }, t = h - Math.PI / 2, s = back(p, t);
    row(`${n}: the same by the west edge: -90 (back, +180 and +90 out)`, { m: thinW, raw: record(thinW, b, p) }, (r) => at(r, s.x, s.z, t) && r.pose !== null && r.which === 'back-90');
    // and nothing passes: a map all inset
    const tiny: Manifest = { ...m, bounds: [p.x - inset - 100, p.z - inset - 100, p.x + inset + 100, p.z + inset + 100] };
    row(`${n}: a map too small for any start: null`, { m: tiny, raw: record(tiny, b, p) }, isNull('inset'));
  }
  // bad records
  const good = record(m, B, P);
  const arr = JSON.parse(good) as unknown[];
  row(`${n}: a record with null for a number (JSON's NaN): null`, { m, raw: JSON.stringify([...arr.slice(0, 2), null, ...arr.slice(3)]) }, isNull('bad record'));
  row(`${n}: a record with a string: null`, { m, raw: JSON.stringify(['NaN', ...arr.slice(1)]) }, isNull('bad record'));
  row(`${n}: a record of 7 numbers: null`, { m, raw: JSON.stringify(arr.slice(0, 7)) }, isNull('bad record'));
  row(`${n}: a record that isn't JSON: null`, { m, raw: '[37.7,' }, isNull('bad record'));
  const out = { x: x1 + 500, z: z1 + 500 };
  row(`${n}: P outside the bounds: null`, { m, raw: record(m, { ...B, x: out.x - 100, z: out.z }, out) }, isNull('outside'));
  row(`${n}: the record's building's paint not in the store: null`, { m, raw: good, saved: false }, isNull('paint not saved'));
  row(`${n}: a city whose paint isn't saved: null`, { m, raw: good, saves: false }, isNull('no saves'));
  row(`${n}: the opening never seen: null`, { m, raw: good, seen: null }, isNull('first visit'));
  row(`${n}: no record: null`, { m, raw: null }, isNull('no record'));
  for (const q of ['lat=37.77&lon=-122.43', 'heading=90', 'skipintro', 'openingshot', 'noreturn', 'recess', 'swerve']) row(`${n}: ?${q}: null`, { m, raw: good, q }, isNull());
  row(`${n}: a page booted elsewhere (the Moon, ?resume, ?earth, the Lift): null`, { m, raw: good, elsewhere: true }, isNull('elsewhere'));
  row(`${n}: a store that throws on read: null`, { m, raw: good, failGet: true }, isNull('storage'));
}
// the bridges, San Francisco's own: a start within 250 m of a bridge's line moves on to the next turn
{
  const m = SF, ggb = m.landmarks.find((l) => (l as { kind?: string }).kind === 'ggb')!.points!;
  // P 300 m south of the Golden Gate's south end, the shot heading north: back is 220 m south of P (520 m from the bridge's end, but the deck's line runs
  // north from it: clear), so put P on the deck's line extended: P 150 m past its north end, heading south over the deck: back is north (out over the
  // headlands, but within 250 m of the deck's line? 150 + 220 = 370 m from the end along the line: clear). Easier: P beside the deck, 100 m east of its
  // middle, the shot heading north along it: back is 220 m south, still 100 m from the deck: bridge. +180 from the north, 100 m off the deck: bridge. +90
  // (heading east, start west of P): on the deck: bridge. -90 (heading west, start east): 320 m east of the deck: passes
  const a = ggb[1], b = ggb[2], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l;
  // (east of the deck: the right of its direction a -> b, whichever way it runs)
  const nx = -uz, nz = ux;
  const P = { x: mx + nx * 100, z: mz + nz * 100 };
  // (the record keeps whole degrees: the starts are worked from what it keeps)
  const h = (deg(Math.atan2(ux, -uz)) * Math.PI) / 180;
  const B = { x: P.x - 700 * ux, z: P.z - 700 * uz, y: 80, h };
  const want = [h + Math.PI / 2, h - Math.PI / 2].map((t) => ({ t, s: back(P, t) })).find(({ s }) => Math.hypot(s.x - mx, s.z - mz) > 300)!;
  row('sf: P 100 m off the Golden Gate\'s deck, the shot along it: back and +180 near the bridge, the first turn clear of it wins', { m, raw: record(m, B, P) }, (r) => at(r, want.s.x, want.s.z, want.t) && r.pose !== null && r.which.startsWith('back') && r.which !== 'back' && r.which !== 'back+180');
  // on the deck itself, both poses there: no start at all
  const D = { x: mx, z: mz };
  row("sf: the bus and P on the Golden Gate's deck, every start within 250 m of a bridge: null (bridge)", { m, raw: record(m, { x: D.x - 50 * ux, z: D.z - 50 * uz, y: 70, h }, D) }, isNull('bridge'));
  // the Bay Bridge: the bus pose on its deck, P 350 m off its line square to the span (the bus within 400 m of P): the bus pose is near the bridge, and
  // back (130 m off the line) too; +180 (570 m off it) wins
  const bb = m.landmarks.find((x) => (x as { kind?: string }).kind === 'baybridge')!.points!;
  const q0 = bb[1], q = bb[2], sx = q[0] - q0[0], sz = q[1] - q0[1], sl = Math.hypot(sx, sz);
  const P2 = { x: q[0] - (sz / sl) * 350, z: q[1] + (sx / sl) * 350 };
  const h2 = (deg(Math.atan2(P2.x - q[0], -(P2.z - q[1]))) * Math.PI) / 180;
  const B2 = { x: q[0], z: q[1], y: 60, h: h2 };
  const s2 = back(P2, h2 + Math.PI);
  row("sf: a bus pose on the Bay Bridge's deck, P 350 m off its span: not the bus pose, not back, but +180", { m, raw: record(m, B2, P2) }, (r) => at(r, s2.x, s2.z, h2 + Math.PI) && r.pose !== null && r.which === 'back+180');
}

// ---- the record itself
const rec: Array<{ name: string; ok: boolean; got: string }> = [];
const okR = (name: string, ok: boolean, got = '') => rec.push({ name, ok, got });
{
  const m = SF, s = new Mem();
  okR('nothing noted: flushReturn writes nothing', !flushReturn(s) && s.writes === 0 && pendingReturn() === null);
  const pose = { x: 300.04, y: 71.53, z: 1700.02, heading: (88 * Math.PI) / 180 };
  noteReturn(m.slug, m.origin, pose, { x: 450, z: 1650 }, 402117, 1763000000123);
  const j = pendingReturn();
  const a = JSON.parse(j ?? 'null') as number[];
  okR('noted: eight numbers, 6 decimals of lat/lon, height to 0.1, whole degrees, the id, unix seconds', !!a && a.length === 8 && a.every((v) => typeof v === 'number' && isFinite(v)) && a[2] === 71.5 && a[3] === 88 && a[6] === 402117 && a[7] === 1763000000 && a.every((v, i) => i > 1 || String(v).split('.')[1]!.length <= 6), j ?? 'none');
  const full = new Mem(false, true);
  let threw = false;
  let r = false;
  try {
    r = flushReturn(full);
  } catch {
    threw = true;
  }
  okR('a store that throws on setItem (full): false, nothing written, nothing thrown, the record still waiting', !r && !threw && full.m.size === 0 && pendingReturn() === j);
  okR('the next good store gets it, once', flushReturn(s) && s.m.get(returnKey(m.slug)) === j && pendingReturn() === null && !flushReturn(s) && s.writes === 1);
  const [x, z] = latLonToLocal(a[0], a[1], m.origin);
  okR('read back, the pose within 0.2 m', near(x, pose.x) && near(z, pose.z), `${x.toFixed(3)}, ${z.toFixed(3)}`);
  noteReturn(m.slug, m.origin, pose, { x: 450, z: 1650 }, 1);
  clearReturn(m.slug, s);
  okR('clearReturn: the stored record and the waiting one gone', !s.m.has(returnKey(m.slug)) && pendingReturn() === null && !flushReturn(s));
  okR('no store at all: false, nothing thrown', (() => { noteReturn(m.slug, m.origin, pose, { x: 450, z: 1650 }, 1); const v = flushReturn(null); clearReturn(m.slug, null); return v === false; })());
  okR('paint on ?recess and ?swerve is not noted; on a plain link it is', !notesReturn(new URLSearchParams('recess')) && !notesReturn(new URLSearchParams('swerve')) && notesReturn(new URLSearchParams('')) && notesReturn(new URLSearchParams('lat=1&lon=2')));
}
// PaintState: persist()'s truth, afterSave, saves and hasSaved
{
  const store = new Mem();
  (globalThis as { localStorage?: unknown }).localStorage = store;
  const ps = new PaintState(4096, { slug: 'sf', ids: 'osm' } as never);
  let after = 0;
  ps.afterSave = () => after++;
  ps.register(5, 402117);
  ps.register(6, 'lm:transamerica');
  okR('saves: an id scheme is known', ps.saves === true);
  okR('hasSaved before any paint: false', !ps.hasSaved(402117) && !ps.hasSaved('lm:transamerica'));
  ps.set(5, { faction: 1, color: 2, level: 1, bloomTime: 0 });
  ps.set(6, { faction: 1, color: 3, level: 2, bloomTime: 0 });
  okR('hasSaved after paint: the building by id, the landmark by key', ps.hasSaved(402117) && ps.hasSaved('lm:transamerica') && !ps.hasSaved(1));
  okR('persist() true and afterSave once when the writes go through', ps.persist() === true && after === 1);
  store.failSet = true;
  okR('persist() false and no afterSave when storage throws (full)', ps.persist() === false && after === 1);
  store.failSet = false;
  ps.set(5, { faction: 1, color: 2, level: 0, bloomTime: 0 });
  okR('a building painted back to 0: hasSaved false', !ps.hasSaved(402117));
  const none = new PaintState(4096, { slug: 'nowhere', ids: 'unknown-scheme' } as never);
  okR('a city with no id scheme: saves false', none.saves === false, String(none.scheme));
}

let fails = 0;
for (const r of rows) {
  const bad = !r.real || (r.stub && !r.stubMayPass);
  if (bad) fails++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${r.name}: ${r.got}; on the stub ${r.stub ? (r.stubMayPass ? 'passes (its answer is the saved pose)' : 'PASSES') : 'fails'}`);
}
for (const r of rec) {
  if (!r.ok) fails++;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.got ? `: ${r.got}` : ''}`);
}
const n = rows.length + rec.length;
console.log(fails ? `RETURN FAILED ${fails} of ${n}` : `return: all ${n} passed (${rows.length} rule rows, each failing on the stub but ${rows.filter((r) => r.stubMayPass).length} whose answer is the saved pose; ${rec.length} record rows)`);
process.exit(fails ? 1 : 0);
