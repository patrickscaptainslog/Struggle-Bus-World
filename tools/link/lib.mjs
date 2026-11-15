// What the link's rows share: the code under test (bundled from src by rolldown, so the real areas.ts runs beside it), a seeded dice, random cards.
import { rolldown } from 'rolldown';
import { mkdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export async function load() {
  const out = path('./.out');
  mkdirSync(out, { recursive: true });
  const bundle = await rolldown({ input: path('./entry.ts'), platform: 'node', logLevel: 'silent' });
  await bundle.write({ dir: out, format: 'esm', entryFileNames: 'link.mjs' });
  return import(pathToFileURL(`${out}/link.mjs`).href + `?t=${process.hrtime.bigint()}`);
}

/** index.html's reader, from its own source: the function as the page will have it */
export function loadStamp() {
  const src = readFileSync(path('../../src/link/stamp.js'), 'utf8');
  if (/=>|\blet\b|\bconst\b|`|\.\.\.|\bclass\b/.test(src.replace(/\/\/.*$/gm, ''))) throw new Error('stamp.js is not ES5');
  return new Function(`${src}\nreturn { stamp: sbwStamp, lastCard: sbwLastCard };`)();
}

/** San Francisco's own files: city.json, and hoods.bin unzipped */
export function sfFiles(dir = path('../../public/city/sf')) {
  const city = JSON.parse(readFileSync(`${dir}/city.json`, 'utf8'));
  let hoods = readFileSync(`${dir}/hoods.bin`);
  if (hoods[0] === 0x1f && hoods[1] === 0x8b) hoods = gunzipSync(hoods);
  return { city, hoods: hoods.buffer.slice(hoods.byteOffset, hoods.byteOffset + hoods.byteLength) };
}

/** mulberry32: the same dice every run */
export function dice(seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  rnd.pick = (list) => list[Math.floor(rnd() * list.length)];
  rnd.shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  return rnd;
}

/** one text for one value, whatever order its keys were written in */
export function same(v) {
  return JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

export function randCaption(L, rnd, most = L.linkTune.caption) {
  const table = [...L.CAPTION].filter((c) => c !== '\0'), n = rnd() < 0.1 ? 0 : rnd() < 0.1 ? most : rnd.int(1, most);
  let s = '';
  while (s.length < n) {
    const c = rnd.pick(table);
    if (c === ' ' && (s.length === 0 || s.length === n - 1 || s.endsWith(' '))) continue;
    s += c;
  }
  return s;
}

/** A random order a card can carry: each square's index as often as its stage, shuffled. */
export function randOrder(squares, rnd) {
  const out = [];
  squares.forEach((q, i) => {
    for (let s = 0; s < q.stage; s++) out.push(i);
  });
  return rnd.shuffle(out);
}

/** Random squares for a card: `n` of them in a box `side` wide at most, sorted as a card wants them, one of them the card's own. */
export function randSquares(rnd, n, side = 16, x0 = 0, z0 = 0) {
  const w = rnd.int(Math.ceil(Math.sqrt(n)), Math.max(Math.ceil(Math.sqrt(n)), side)), d = rnd.int(Math.ceil(n / w), Math.max(Math.ceil(n / w), side));
  const cells = rnd.shuffle(Array.from({ length: w * d }, (_, i) => i)).slice(0, n).sort((a, b) => a - b);
  return cells.map((c) => ({ ix: x0 + (c % w), iz: z0 + Math.floor(c / w), stage: rnd.int(1, 4) }));
}

/** A random card of any of the three kinds, anywhere a card can be. `kind` forces one: 'spot', 'mark', 'squares'. */
export function randCard(L, rnd, kind) {
  const k = kind ?? (rnd() < 0.3 ? 'spot' : rnd() < 0.2 ? 'mark' : 'squares');
  const far = rnd() < 0.05;
  const card = {
    v: 1, map: rnd() < 0.85 ? 0 : rnd.int(0, 4095), ix: 0, iz: 0, crew: rnd.int(1, 5),
    at: rnd() < 0.9 ? rnd.int(450000, 2000000) : rnd.int(0, L.linkTune.atMost), caption: randCaption(L, rnd), body: null,
  };
  const x0 = far ? rnd.pick([-32768, 32767 - 15, rnd.int(-32768, 32752)]) : rnd.int(-68, 28), z0 = far ? rnd.pick([-32768, 32767 - 15, rnd.int(-32768, 32752)]) : rnd.int(-78, 44);
  const answers = rnd() < 0.3 ? rnd.int(0, 2 ** 30 - 1) : null;
  if (k === 'squares') {
    const n = rnd.pick([1, 1, 2, 3, 4, 5, 8, 9, 9, 16, 17, 17, 32, rnd.int(1, 32)]);
    const squares = randSquares(rnd, n, 16, x0, z0), own = rnd.pick(squares);
    card.ix = own.ix, card.iz = own.iz;
    card.body = { form: 'squares', squares, order: randOrder(squares, rnd), answers, score: rnd() < 0.1 ? { budget: rnd.int(0, 255), used: rnd.int(0, 255) } : null };
  } else {
    card.ix = x0, card.iz = z0;
    if (k === 'mark') {
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';
      let key = '';
      for (let i = rnd.int(1, 16); i > 0; i--) key += rnd.pick([...abc]);
      card.body = { form: 'mark', key, stage: rnd.int(1, 4), answers };
    }
  }
  return card;
}

/** An address split as a browser splits it: path, query, fragment. */
export function split(href) {
  let pathname = href, search = '', hash = '';
  const h = pathname.indexOf('#');
  if (h >= 0) (hash = pathname.slice(h)), (pathname = pathname.slice(0, h));
  const q = pathname.indexOf('?');
  if (q >= 0) (search = pathname.slice(q)), (pathname = pathname.slice(0, q));
  return [pathname.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, ''), search, hash];
}

/** rows: each returns what it found in a line, and throws where it failed */
export function runner() {
  let fails = 0;
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  return {
    async row(name, f) {
      if (only.length && !only.includes(name)) return;
      const t0 = performance.now();
      try {
        const said = await f();
        console.log(`ok    ${name.padEnd(9)} ${said}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
      } catch (e) {
        fails++;
        console.log(`FAIL  ${name.padEnd(9)} ${e && e.message ? e.message : e}`);
        if (process.argv.includes('--trace') && e && e.stack) console.log(e.stack);
      }
    },
    done(what) {
      console.log(fails ? `${what}: FAILED ${fails}` : `${what}: all passed`);
      process.exit(fails ? 1 : 0);
    },
  };
}
export function need(ok, said) {
  if (!ok) throw new Error(typeof said === 'function' ? said() : said);
}
