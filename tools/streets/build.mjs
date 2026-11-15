#!/usr/bin/env node
// The street index's builder (docs/M1.md, task 8; src/world/streetIndex.ts has the format and the search). Reads every tile of a baked city and writes
// one file beside its city.json, streets.bin: each named street once, as a few simplified runs. No download and no bake: the tiles already hold their
// streets' names and centrelines ('SBT2'), so any city baked from OpenStreetMap gets its index from what is in the repo.
//   node tools/streets/build.mjs [city folder = public/city/sf] [--out <file>] [--dry]
// What it does with a street's lines, which the tiles hold cut at each tile's edge and often twice (the two sides of a wide avenue):
//   - joins the cuts end to end (ends within JOIN m) into the street's own graph, and of each connected part keeps its longest way through;
//   - cuts a way that goes out along one side of an avenue and back along the other at its far end, and leaves out a part that runs beside a longer one
//     of the same name within BESIDE m (the avenue's other side), keeping what of either runs on farther off; and scraps beside a kept run;
//   - puts the street's own runs first and a far-off namesake's after (another town's Pine St on the same map), so a search can tell them apart
//   - simplifies each kept run to within SIMPLIFY m of the line.
// Streets only (the tiles' rank 0): paths, plazas and the sidewalks some maps name are left out. A name's second form after a ';' is dropped, as the
// street signs do (City.ts). Prints what it kept and the file's size; the same tiles always give the same bytes.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTerrainTile } from '../../src/world/tiles.ts';
import { encodeStreets } from '../../src/world/streetIndex.ts';

const args = process.argv.slice(2), flag = (n) => args.includes(n);
const outAt = args.indexOf('--out');
const dir = resolve(args.find((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1)) ?? 'public/city/sf');
const out = outAt >= 0 ? resolve(args[outAt + 1]) : `${dir}/streets.bin`;
/** m: cut ends that are one point; a part beside a longer one (a search's corner reaches 30 m, so what is dropped must be nearer than that); a scrap,
 *  and how near a kept run it must be to be dropped; how far a run may stray from its line; the file's step */
const JOIN = 6, BESIDE = 25, SCRAP = 40, SCRAP_NEAR = 60, SIMPLIFY = 5, QUANTUM = 4;
/** a namesake: runs of one name this far (m) from the street's other runs are another place's; and how the map's middle is favoured in choosing the street */
const APART = 700, MIDDLE = 6000;

export function readStreets(cityDir) {
  const city = JSON.parse(readFileSync(`${cityDir}/city.json`, 'utf8'));
  /** name -> its lines as the tiles cut them (x, z pairs, m) */
  const byName = new Map();
  let tiles = 0;
  for (const f of readdirSync(cityDir).filter((f) => /^r_-?\d+_-?\d+\.bin$/.test(f)).sort()) {
    let b = readFileSync(`${cityDir}/${f}`);
    if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), dv = new DataView(buf);
    for (let i = 0, n = dv.getUint32(4, true); i < n; i++) {
      const o = 8 + i * 24, tOff = dv.getUint32(o + 16, true), tLen = dv.getUint32(o + 20, true);
      if (!tLen) continue;
      const t = parseTerrainTile(buf.slice(tOff, tOff + tLen), city.classN);
      tiles++;
      for (const s of t.streets) {
        if (s.rank !== 0 || s.xz.length < 4) continue;
        const name = (t.streetNames[s.name] ?? '').split(';')[0].trim();
        if (!name || /sidewalk/i.test(name)) continue;
        let list = byName.get(name);
        if (!list) byName.set(name, (list = []));
        list.push(Array.from(s.xz));
      }
    }
  }
  return { city, byName, tiles };
}

const reversed = (p) => {
  const r = [];
  for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
  return r;
};
const len = (p) => {
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
};

/**
 * The lines with each one cut where another's end lies on it. A tile keeps a line to 2 m past its edge, so the two halves of a street overlap where it
 * crosses the edge, and at a shallow angle (San Francisco's grid meets the tiles' at 9 degrees) by 25 m: the ends are far apart, each lying on the other's
 * line. Cut there, an end has an end to join. It is also where a street's own branch meets it.
 */
function cutAtEnds(lines) {
  const ON = 3;
  const cuts = lines.map(() => []);
  lines.forEach((l, li) => {
    for (const e of [0, l.length - 2]) {
      const ex = l[e], ez = l[e + 1];
      lines.forEach((m, mi) => {
        if (mi === li) return;
        let best = ON, seg = -1, at = 0;
        for (let i = 2; i < m.length; i += 2) {
          const ax = m[i - 2], az = m[i - 1], bx = m[i] - ax, bz = m[i + 1] - az, l2 = bx * bx + bz * bz;
          const t = l2 > 0 ? Math.min(1, Math.max(0, ((ex - ax) * bx + (ez - az) * bz) / l2)) : 0;
          const d = Math.hypot(ex - ax - bx * t, ez - az - bz * t);
          if (d < best) [best, seg, at] = [d, i, t];
        }
        // (not at the other's own ends: those join as ends do)
        if (seg < 0 || Math.hypot(ex - m[0], ez - m[1]) <= JOIN || Math.hypot(ex - m[m.length - 2], ez - m[m.length - 1]) <= JOIN) return;
        cuts[mi].push({ seg, at, x: ex, z: ez });
      });
    }
  });
  const out = [];
  lines.forEach((m, mi) => {
    const cs = cuts[mi].sort((a, b) => a.seg - b.seg || a.at - b.at);
    let cur = [m[0], m[1]], c = 0;
    for (let i = 2; i < m.length; i += 2) {
      for (; c < cs.length && cs[c].seg === i; c++) {
        cur.push(cs[c].x, cs[c].z);
        if (cur.length >= 4) out.push(cur);
        cur = [cs[c].x, cs[c].z];
      }
      cur.push(m[i], m[i + 1]);
    }
    if (cur.length >= 4) out.push(cur);
  });
  return out;
}

/** One street's lines joined into its connected parts, each as its longest way through: [x, z, ...] runs, the longest first. */
export function stitch(lines) {
  // nodes: the lines' ends, those within JOIN m of each other one node (a grid of JOIN m cells, each end against its own and the eight round it)
  const nodes = [], cells = new Map();
  const nodeAt = (x, z) => {
    const cx = Math.floor(x / JOIN), cz = Math.floor(z / JOIN);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (const n of cells.get(`${cx + dx},${cz + dz}`) ?? []) if (Math.hypot(nodes[n].x - x, nodes[n].z - z) <= JOIN) return n;
    nodes.push({ x, z, edges: [] });
    const k = `${cx},${cz}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(nodes.length - 1);
    return nodes.length - 1;
  };
  const edges = [];
  for (const p of [...cutAtEnds(lines)].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a.length - b.length || a[2] - b[2] || a[3] - b[3])) {
    const l = len(p);
    if (!(l > 0)) continue;
    const a = nodeAt(p[0], p[1]), b = nodeAt(p[p.length - 2], p[p.length - 1]);
    const e = edges.length;
    edges.push({ a, b, p, l });
    nodes[a].edges.push(e);
    nodes[b].edges.push(e);
  }
  // each connected part's longest way: the farthest node from any node, then the farthest from that (exact on a tree, near enough on a loop). Then the
  // same again over the lines no way has used yet, so a street that forks or loops (Twin Peaks Blvd's figure of eight) keeps its other arm: ROUNDS
  // times, and what is left after that is spurs
  const ROUNDS = 5, used = new Uint8Array(edges.length);
  const far = (from) => {
    const dist = new Map([[from, 0]]), via = new Map(), open = [from];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
      const n = open.splice(bi, 1)[0];
      for (const e of nodes[n].edges) {
        if (used[e]) continue;
        const m = edges[e].a === n ? edges[e].b : edges[e].a, d = dist.get(n) + edges[e].l;
        if (!dist.has(m) || d < dist.get(m)) {
          if (!dist.has(m)) open.push(m);
          dist.set(m, d);
          via.set(m, e);
        }
      }
    }
    let end = from;
    for (const [n, d] of dist) if (d > dist.get(end) || (d === dist.get(end) && n < end)) end = n;
    return { end, dist, via };
  };
  const runs = [];
  for (let round = 0; round < ROUNDS; round++) {
    const seen = new Set(), take = [];
    for (let n = 0; n < nodes.length; n++) {
      if (seen.has(n) || !nodes[n].edges.some((e) => !used[e])) continue;
      const a = far(n);
      for (const k of a.dist.keys()) seen.add(k);
      const b = far(a.end);
      // walk back from the far end to the start, laying each line down the right way round
      const run = [], on = [];
      for (let at = b.end; at !== a.end; ) {
        const ei = b.via.get(at), e = edges[ei], fwd = e.b === at;
        const p = fwd ? reversed(e.p) : e.p;
        for (let i = run.length ? 2 : 0; i < p.length; i += 2) run.push(p[i], p[i + 1]);
        on.push(ei);
        at = fwd ? e.a : e.b;
      }
      if (run.length < 4) {
        // (a part that is one loop back to its own start: its longest line as it is)
        const ei = [...new Set([...a.dist.keys()].flatMap((k) => nodes[k].edges))].filter((e) => !used[e]).sort((p, q) => edges[q].l - edges[p].l || p - q)[0];
        if (ei === undefined) continue;
        run.push(...edges[ei].p);
        on.push(ei);
      }
      take.push(...on);
      runs.push(run);
    }
    if (!take.length) break;
    for (const e of take) used[e] = 1;
  }
  return runs.sort((p, q) => len(q) - len(p) || p[0] - q[0] || p[1] - q[1]);
}

/** A run with the points that stray less than `tol` m from the line through their kept neighbours taken out (Douglas-Peucker). */
export function simplify(p, tol) {
  const n = p.length / 2, keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2] - ax, bz = p[j * 2 + 1] - az, l2 = bx * bx + bz * bz;
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const x = p[k * 2] - ax, z = p[k * 2 + 1] - az, t = l2 > 0 ? Math.min(1, Math.max(0, (x * bx + z * bz) / l2)) : 0;
      const d = Math.hypot(x - bx * t, z - bz * t);
      if (d > worst) [worst, at] = [d, k];
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(p[k * 2], p[k * 2 + 1]);
  return out;
}

/** How much of run p (0..1 of its length, sampled every 15 m) lies within `d` m of run q. */
function beside(p, q, d) {
  let near = 0, all = 0;
  for (let i = 2; i < p.length; i += 2) {
    const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]), steps = Math.max(1, Math.round(l / 15));
    for (let s = 0; s < steps; s++) {
      const x = p[i - 2] + ((p[i] - p[i - 2]) * (s + 0.5)) / steps, z = p[i - 1] + ((p[i + 1] - p[i - 1]) * (s + 0.5)) / steps;
      let best = Infinity;
      for (let j = 2; j < q.length && best > d; j += 2) {
        const ax = q[j - 2], az = q[j - 1], bx = q[j] - ax, bz = q[j + 1] - az, l2 = bx * bx + bz * bz;
        const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - ax - bx * t, z - az - bz * t));
      }
      all++;
      if (best <= d) near++;
    }
  }
  return all ? near / all : 1;
}

/** The stretches of run p that lie more than `d` m from run q: [x, z, ...] runs, sampled every 10 m (a stretch under SCRAP m is no stretch). */
function spansAway(p, q, d) {
  const out = [];
  let cur = [];
  const close = () => {
    if (cur.length >= 4 && len(cur) >= SCRAP) out.push(cur);
    cur = [];
  };
  const far = (x, z) => {
    for (let j = 2; j < q.length; j += 2) {
      const ax = q[j - 2], az = q[j - 1], bx = q[j] - ax, bz = q[j + 1] - az, l2 = bx * bx + bz * bz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / l2)) : 0;
      if (Math.hypot(x - ax - bx * t, z - az - bz * t) <= d) return false;
    }
    return true;
  };
  for (let i = 2; i < p.length; i += 2) {
    const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]), steps = Math.max(1, Math.ceil(l / 10));
    for (let s = i === 2 ? 0 : 1; s <= steps; s++) {
      const x = p[i - 2] + ((p[i] - p[i - 2]) * s) / steps, z = p[i - 1] + ((p[i + 1] - p[i - 1]) * s) / steps;
      if (far(x, z)) cur.push(x, z);
      else close();
    }
  }
  close();
  return out;
}

/** A run that goes out along one side of an avenue and back along the other (its two ends side by side) is cut at its far end: one side is the street.
 *  Where the far side runs on past the kept side (Geary Blvd's last blocks to Van Ness), that stretch is kept as a run of its own. */
function unfold(r) {
  let far = 0, at = 0;
  for (let i = 0; i < r.length; i += 2) {
    const d = Math.hypot(r[i] - r[0], r[i + 1] - r[1]);
    if (d > far) [far, at] = [d, i];
  }
  if (at < 4 || at > r.length - 6) return [r];
  const out = r.slice(0, at + 2), back = r.slice(at);
  return beside(back, out, BESIDE) >= 0.7 ? [out, ...spansAway(back, out, BESIDE)] : [r];
}

/** How far run p's nearest point is from run q's (m), by their vertices and a sample every 50 m: for telling a namesake from a broken street. */
function gap(p, q) {
  let best = Infinity;
  for (let i = 0; i < p.length; i += 2)
    for (let j = 2; j < q.length; j += 2) {
      const ax = q[j - 2], az = q[j - 1], bx = q[j] - ax, bz = q[j + 1] - az, l2 = bx * bx + bz * bz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[i] - ax) * bx + (p[i + 1] - az) * bz) / l2)) : 0;
      best = Math.min(best, Math.hypot(p[i] - ax - bx * t, p[i + 1] - az - bz * t));
    }
  return best;
}

/** A street's runs in the file's order: the street itself first, then a namesake's. Runs within APART m of each other are one place; of several places
 *  the street is the one with the most length, the map's middle favoured (a town at the map's edge has its own Pine St, and the map is of the city in
 *  its middle). Returns { pieces, main }. */
function ordered(runs) {
  const group = runs.map((_, i) => i);
  const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) if (find(i) !== find(j) && Math.min(gap(runs[i], runs[j]), gap(runs[j], runs[i])) <= APART) group[find(j)] = find(i);
  const places = new Map();
  runs.forEach((r, i) => {
    const g = find(i), e = places.get(g) ?? { runs: [], length: 0, d: Infinity };
    e.runs.push(r);
    e.length += len(r);
    for (let k = 0; k < r.length; k += 2) e.d = Math.min(e.d, Math.hypot(r[k], r[k + 1]));
    places.set(g, e);
  });
  const weight = (e) => e.length / (1 + (e.d / MIDDLE) ** 2);
  const list = [...places.values()].sort((a, b) => weight(b) - weight(a) || a.runs[0][0] - b.runs[0][0] || a.runs[0][1] - b.runs[0][1]);
  const byLen = (p, q) => len(q) - len(p) || p[0] - q[0] || p[1] - q[1];
  return { pieces: [...list[0].runs.sort(byLen), ...list.slice(1).flatMap((e) => e.runs).sort(byLen)], main: list[0].runs.length };
}

/** A city's streets for the index: [{ name, pieces, main }], by name. */
export function buildStreets(byName) {
  const streets = [];
  let cuts = 0, parts = 0, sides = 0, scraps = 0, verts = 0, namesakes = 0;
  for (const name of [...byName.keys()].sort()) {
    const lines = byName.get(name);
    cuts += lines.length;
    const runs = stitch(lines).flatMap(unfold).sort((p, q) => len(q) - len(p) || p[0] - q[0] || p[1] - q[1]);
    parts += runs.length;
    const kept = [];
    for (const r of runs) {
      // (a scrap beside the street it is part of; one far from the rest is a block of its own, the foot of the Filbert Steps)
      if (kept.length && len(r) < SCRAP && kept.some((k) => gap(r, k) <= SCRAP_NEAR)) {
        scraps++;
        continue;
      }
      // (an avenue's other side: left out where it runs within BESIDE m of a kept run, and what of it runs farther off is kept)
      const along = kept.find((k) => beside(r, k, BESIDE) >= 0.7);
      if (along) {
        sides++;
        let away = [r];
        for (const k of kept) away = away.flatMap((a) => spansAway(a, k, BESIDE));
        kept.push(...away);
        continue;
      }
      kept.push(r);
    }
    const simple = kept.map((r) => simplify(r, SIMPLIFY)).filter((r) => r.length >= 4);
    // (a name whose every line is a few metres, a court's stub: its longest line, so the name still lands on its spot)
    if (!simple.length) simple.push([...lines].sort((p, q) => len(q) - len(p) || p[0] - q[0])[0]);
    const o = ordered(simple);
    if (o.main < o.pieces.length) namesakes++;
    verts += o.pieces.reduce((a, p) => a + p.length / 2, 0);
    streets.push({ name, pieces: o.pieces, main: o.main });
  }
  return { streets, cuts, parts, sides, scraps, verts, namesakes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { byName, tiles } = readStreets(dir);
  const b = buildStreets(byName);
  const bytes = encodeStreets(b.streets, QUANTUM);
  const pieces = b.streets.reduce((a, s) => a + s.pieces.length, 0);
  console.log(`streets: ${tiles} tiles, ${b.cuts} lines of ${byName.size} names -> ${b.streets.length} streets in ${pieces} runs, ${b.verts} points (${b.parts} ways through; ${b.sides} an avenue's other side, left out where it runs within ${BESIDE} m; ${b.scraps} scraps; ${b.namesakes} streets with a far-off namesake)`);
  console.log(`streets: ${bytes.length} bytes (${(bytes.length / 1024).toFixed(1)} KB), ${(gzipSync(bytes).length / 1024).toFixed(1)} KB gzipped${flag('--dry') ? '; not written (--dry)' : ` -> ${out}`}`);
  if (!flag('--dry')) writeFileSync(out, bytes);
}
