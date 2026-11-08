#!/usr/bin/env node
// The city's bus routes from an OpenStreetMap extract (the producer approved BBBike's San Francisco extract, 2026-11-08): node tools/life/busroutes.mjs <file.osm.pbf>
// [out.json]. Reads the PBF itself (no library): every relation tagged type=route with route=bus or trolleybus, its ways chained in order into one line
// and its stops, in lat/lon. Prints what it found; with `out.json`, writes the routes for the bake. Worker-free and Node-only.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const file = process.argv[2], out = process.argv[3];
if (!file) {
  console.error('usage: node tools/life/busroutes.mjs <file.osm.pbf> [out.json]');
  process.exit(2);
}
const buf = readFileSync(file);

// ---- a protobuf reader: varints, zigzag, length-delimited fields ----
class R {
  constructor(b, s = 0, e = b.length) {
    this.b = b;
    this.p = s;
    this.e = e;
  }
  more() {
    return this.p < this.e;
  }
  varint() {
    let x = 0, m = 1, c;
    do {
      c = this.b[this.p++];
      x += (c & 127) * m;
      m *= 128;
    } while (c & 128);
    return x;
  }
  svarint() {
    const x = this.varint();
    return x % 2 ? -(x + 1) / 2 : x / 2;
  }
  key() {
    const k = this.varint();
    return [Math.floor(k / 8), k & 7];
  }
  bytes() {
    const n = this.varint(), s = this.p;
    this.p += n;
    return [s, this.p];
  }
  skip(w) {
    if (w === 0) this.varint();
    else if (w === 1) this.p += 8;
    else if (w === 2) this.bytes();
    else if (w === 5) this.p += 4;
    else throw new Error(`wire ${w}`);
  }
  packed(s, e, signed) {
    const r = new R(this.b, s, e), a = [];
    while (r.more()) a.push(signed ? r.svarint() : r.varint());
    return a;
  }
}

/** Each OSMData block's PrimitiveBlock, inflated, with its string table: blocks(cb) calls cb(data, strings, granularity, latOff, lonOff). */
function blocks(cb) {
  let p = 0;
  while (p < buf.length) {
    const hl = buf.readUInt32BE(p);
    p += 4;
    const h = new R(buf, p, p + hl);
    let type = '', size = 0;
    while (h.more()) {
      const [f, w] = h.key();
      if (f === 1) {
        const [s, e] = h.bytes();
        type = buf.toString('utf8', s, e);
      } else if (f === 3) size = h.varint();
      else h.skip(w);
    }
    p += hl;
    const bl = new R(buf, p, p + size);
    let data = null;
    while (bl.more()) {
      const [f, w] = bl.key();
      if (f === 1) {
        const [s, e] = bl.bytes();
        data = buf.subarray(s, e);
      } else if (f === 3) {
        const [s, e] = bl.bytes();
        data = inflateSync(buf.subarray(s, e));
      } else bl.skip(w);
    }
    p += size;
    if (type !== 'OSMData' || !data) continue;
    const pb = new R(data), strings = [], groups = [];
    let gran = 100, latOff = 0, lonOff = 0;
    while (pb.more()) {
      const [f, w] = pb.key();
      if (f === 1) {
        const [s, e] = pb.bytes(), st = new R(data, s, e);
        while (st.more()) {
          const [g, ww] = st.key();
          if (g === 1) {
            const [a, b] = st.bytes();
            strings.push(data.toString('utf8', a, b));
          } else st.skip(ww);
        }
      } else if (f === 2) groups.push(pb.bytes());
      else if (f === 17) gran = pb.varint();
      else if (f === 19) latOff = pb.varint();
      else if (f === 20) lonOff = pb.varint();
      else pb.skip(w);
    }
    for (const [s, e] of groups) cb(data, s, e, strings, gran, latOff, lonOff);
  }
}

// ---- pass 1: the bus routes ----
const routes = [], wayNeed = new Set(), nodeNeed = new Set();
blocks((data, s, e, strings) => {
  const g = new R(data, s, e);
  while (g.more()) {
    const [f, w] = g.key();
    if (f !== 4) {
      g.skip(w);
      continue;
    }
    const [a, b] = g.bytes(), r = new R(data, a, b);
    let id = 0, keys = [], vals = [], roles = [], mem = [], types = [];
    while (r.more()) {
      const [k, ww] = r.key();
      if (k === 1) id = r.varint();
      else if (k === 2) keys = r.packed(...r.bytes(), false);
      else if (k === 3) vals = r.packed(...r.bytes(), false);
      else if (k === 8) roles = r.packed(...r.bytes(), false);
      else if (k === 9) mem = r.packed(...r.bytes(), true);
      else if (k === 10) types = r.packed(...r.bytes(), false);
      else r.skip(ww);
    }
    const tags = {};
    keys.forEach((kk, i) => (tags[strings[kk]] = strings[vals[i]]));
    if (tags.type !== 'route' || (tags.route !== 'bus' && tags.route !== 'trolleybus')) continue;
    let ref = 0;
    const members = mem.map((d, i) => {
      ref += d;
      return { type: types[i], ref, role: strings[roles[i]] };
    });
    for (const m of members) {
      if (m.type === 1 && !/stop|platform/.test(m.role)) wayNeed.add(m.ref);
      else if (m.type === 0) nodeNeed.add(m.ref);
    }
    routes.push({ id, tags, members });
  }
});

// ---- pass 2: their ways' nodes ----
const ways = new Map();
blocks((data, s, e, strings) => {
  const g = new R(data, s, e);
  while (g.more()) {
    const [f, w] = g.key();
    if (f !== 3) {
      g.skip(w);
      continue;
    }
    const [a, b] = g.bytes(), r = new R(data, a, b);
    let id = 0, refs = [];
    while (r.more()) {
      const [k, ww] = r.key();
      if (k === 1) id = r.varint();
      else if (k === 8) refs = r.packed(...r.bytes(), true);
      else r.skip(ww);
    }
    if (!wayNeed.has(id)) continue;
    let n = 0;
    const nodes = refs.map((d) => (n += d));
    for (const x of nodes) nodeNeed.add(x);
    ways.set(id, nodes);
  }
  void strings;
});

// ---- pass 3: the nodes' places ----
const nodes = new Map();
blocks((data, s, e, _strings, gran, latOff, lonOff) => {
  const g = new R(data, s, e);
  while (g.more()) {
    const [f, w] = g.key();
    if (f !== 2) {
      g.skip(w);
      continue;
    }
    const [a, b] = g.bytes(), r = new R(data, a, b);
    let ids = [], lats = [], lons = [];
    while (r.more()) {
      const [k, ww] = r.key();
      if (k === 1) ids = r.packed(...r.bytes(), true);
      else if (k === 8) lats = r.packed(...r.bytes(), true);
      else if (k === 9) lons = r.packed(...r.bytes(), true);
      else r.skip(ww);
    }
    let id = 0, la = 0, lo = 0;
    for (let i = 0; i < ids.length; i++) {
      id += ids[i];
      la += lats[i];
      lo += lons[i];
      if (nodeNeed.has(id)) nodes.set(id, [1e-9 * (latOff + gran * la), 1e-9 * (lonOff + gran * lo)]);
    }
  }
});

// ---- each route's ways chained in order into one line, each way turned to meet the last; and its stops ----
const metres = (p, q) => {
  const k = Math.PI / 180, x = (q[1] - p[1]) * Math.cos(((p[0] + q[0]) / 2) * k), y = q[0] - p[0];
  return Math.hypot(x, y) * k * 6371000;
};
let gaps = 0, maxGap = 0, missing = 0;
const done = [];
for (const rt of routes) {
  const line = [];
  for (const m of rt.members) {
    if (m.type !== 1 || /stop|platform/.test(m.role)) continue;
    const wn = ways.get(m.ref);
    if (!wn) {
      missing++;
      continue;
    }
    let pts = wn.map((id) => nodes.get(id)).filter(Boolean);
    if (pts.length < 2) continue;
    if (line.length) {
      const end = line[line.length - 1], a = metres(end, pts[0]), b = metres(end, pts[pts.length - 1]);
      if (b < a) pts = pts.reverse();
      const gap = Math.min(a, b);
      if (gap > 1) {
        gaps++;
        maxGap = Math.max(maxGap, gap);
      }
      if (gap < 1) pts = pts.slice(1);
    } else if (rt.members.filter((x) => x.type === 1 && !/stop|platform/.test(x.role)).length > 1) {
      // (the first way's direction from the second's)
      const next = rt.members.find((x, i) => i > rt.members.indexOf(m) && x.type === 1 && !/stop|platform/.test(x.role));
      const nn = next && ways.get(next.ref)?.map((id) => nodes.get(id)).filter(Boolean);
      if (nn?.length) {
        const s0 = pts[0], s1 = pts[pts.length - 1], d0 = Math.min(metres(s0, nn[0]), metres(s0, nn[nn.length - 1])), d1 = Math.min(metres(s1, nn[0]), metres(s1, nn[nn.length - 1]));
        if (d0 < d1) pts = pts.reverse();
      }
    }
    line.push(...pts);
  }
  const stops = rt.members.filter((m) => m.type === 0 && /stop|platform/.test(m.role)).map((m) => nodes.get(m.ref)).filter(Boolean);
  let len = 0;
  for (let i = 1; i < line.length; i++) len += metres(line[i - 1], line[i]);
  done.push({ id: rt.id, ref: rt.tags.ref ?? '', name: rt.tags.name ?? '', operator: rt.tags.operator ?? '', network: rt.tags.network ?? '', colour: rt.tags.colour ?? '', mode: rt.tags.route, line, stops, km: len / 1000 });
}
const ops = {};
for (const r of done) ops[r.operator || r.network || '?'] = (ops[r.operator || r.network || '?'] ?? 0) + 1;
console.log(JSON.stringify({ routes: done.length, ways: ways.size, nodes: nodes.size, missingWays: missing, gapsOver1m: gaps, worstGapM: Math.round(maxGap), km: Math.round(done.reduce((a, r) => a + r.km, 0)), operators: ops, stops: done.reduce((a, r) => a + r.stops.length, 0) }));
if (out) writeFileSync(out, JSON.stringify(done.map((r) => ({ ...r, line: r.line.map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]), stops: r.stops.map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]) }))));
