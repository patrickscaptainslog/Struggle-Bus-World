#!/usr/bin/env node
// The street index's check (docs/M1.md, task 8: "its size printed (target under 100 KB); a Node check of 30 street names (Guerrero, Valencia, Hayes,
// Lombard, Geary and Irving among them) finds each on its own street"). No browser.
//   node tools/streets/check.mjs [city folder = public/city/sf]
// Reads the city's streets.bin as the page will (parseStreets) and holds it against the city's own tiles, which it reads again by itself:
//   size      the file is under 100 KB, and a fresh build of the tiles gives the same bytes (the file in the repo is not stale; two builds agree)
//   thirty    thirty names typed as a thumb types them: the first answer is that street, at a point within 12 m of that street's own line in the tiles
//   itself    every street's own name finds it first
//   on        every point of the index lies within 12 m of its street's lines in the tiles, and at least 97 % of the tiles' street length lies within
//             60 m of the index's (what is left out by design: an avenue's other side, scraps)
//   corners   two names with &, /, @, +, and, at: the corner, within 25 m of both streets' lines in the tiles
//   slips     a letter wrong, missing or swapped still finds the street
//   nothing   nonsense and empty text find nothing, and nothing throws
//   damage    the file cut short anywhere, or random bytes, reads as no index (null), never a throw
// Prints a row each; exits 1 if one fails, 2 if the city has no streets.bin (run tools/streets/build.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeStreets, findStreet, middleOf, nearestOn, parseStreets } from '../../src/world/streetIndex.ts';
import { buildStreets, readStreets } from './build.mjs';

const dir = resolve(process.argv[2] ?? 'public/city/sf'), file = `${dir}/streets.bin`;
if (!existsSync(file)) {
  console.log(`FAIL  no ${file}: node tools/streets/build.mjs`);
  process.exit(2);
}
let bad = 0;
const row = (ok, name, o) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(8)} ${typeof o === 'string' ? o : JSON.stringify(o)}`);
};
const bytes = new Uint8Array(readFileSync(file));
const ix = parseStreets(bytes);
if (!ix) {
  console.log('FAIL  streets.bin does not parse');
  process.exit(1);
}
const { city, byName } = readStreets(dir);
/** how far (x, z) is from a street's own lines in the tiles (m) */
const off = (name, x, z) => {
  let best = Infinity;
  for (const p of byName.get(name) ?? [])
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i] - ax, bz = p[i + 1] - az, l2 = bx * bx + bz * bz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - bx * t, z - az - bz * t));
    }
  return best;
};
const inMap = (x, z) => x >= city.bounds[0] && x <= city.bounds[2] && z >= city.bounds[1] && z <= city.bounds[3];

// ---- size
{
  const fresh = encodeStreets(buildStreets(byName).streets), again = encodeStreets(buildStreets(readStreets(dir).byName).streets);
  const same = fresh.length === bytes.length && fresh.every((b, i) => b === bytes[i]), twice = fresh.length === again.length && fresh.every((b, i) => b === again[i]);
  row(bytes.length < 100 * 1024 && same && twice, 'size', { bytes: bytes.length, KB: +(bytes.length / 1024).toFixed(1), under100KB: bytes.length < 100 * 1024, streets: ix.streets.length, runs: ix.streets.reduce((a, s) => a + s.pieces.length, 0), aFreshBuildIsTheFile: same, twoBuildsAgree: twice });
}

// ---- thirty
{
  const THIRTY = [
    ['Guerrero', 'Guerrero St'], ['valencia st', 'Valencia St'], ['Hayes Street', 'Hayes St'], ['lombard', 'Lombard St'], ['Geary', 'Geary Blvd'], ['irving', 'Irving St'],
    ['market', 'Market St'], ['Mission St', 'Mission St'], ['haight', 'Haight St'], ['Castro St', 'Castro St'], ['divisadero', 'Divisadero St'], ['Fillmore', 'Fillmore St'],
    ['van ness', 'Van Ness Ave'], ['columbus avenue', 'Columbus Ave'], ['embarcadero', 'The Embarcadero'], ['24th St', '24th St'], ['19th ave', '19th Ave'], ['Taraval', 'Taraval St'],
    ['clement', 'Clement St'], ['Balboa', 'Balboa St'], ['fulton', 'Fulton St'], ['Folsom', 'Folsom St'], ['dolores', 'Dolores St'], ['Church', 'Church St'],
    ['noe', 'Noe St'], ['polk', 'Polk St'], ['California', 'California St'], ['broadway', 'Broadway'], ['Stockton', 'Stockton St'], ['grant', 'Grant Ave'],
  ];
  const wrong = [];
  let worst = 0;
  for (const [typed, want] of THIRTY) {
    const h = findStreet(ix, typed)[0];
    const d = h ? off(want, h.x, h.z) : Infinity;
    if (!h || h.street.name !== want || !(d <= 12) || !inMap(h.x, h.z)) wrong.push(`${typed}: ${h ? `${h.street.name}, ${Math.round(d)} m off ${want}` : 'nothing'}`);
    else worst = Math.max(worst, d);
  }
  row(wrong.length === 0, 'thirty', { names: THIRTY.length, found: THIRTY.length - wrong.length, farthestFromItsStreetM: +worst.toFixed(1), wrong });
}

// ---- itself
{
  const wrong = ix.streets.filter((s) => findStreet(ix, s.name)[0]?.street !== s).map((s) => `${s.name} -> ${findStreet(ix, s.name)[0]?.street.name ?? 'nothing'}`);
  row(wrong.length === 0, 'itself', { streets: ix.streets.length, foundFirstByTheirOwnName: ix.streets.length - wrong.length, wrong: wrong.slice(0, 8) });
}

// ---- on
{
  let worst = 0, worstAt = '', far = 0, all = 0, least = 1, leastAt = '';
  for (const s of ix.streets) {
    for (const p of s.pieces)
      for (let i = 0; i < p.length; i += 2) {
        const d = off(s.name, p[i], p[i + 1]);
        if (d > worst) [worst, worstAt] = [d, s.name];
      }
    // (the tiles' own length of it, sampled every 20 m, against the index's runs)
    let sFar = 0, sAll = 0;
    for (const p of byName.get(s.name) ?? [])
      for (let i = 2; i < p.length; i += 2) {
        const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]), n = Math.max(1, Math.round(l / 20));
        for (let k = 0; k < n; k++) {
          const x = p[i - 2] + ((p[i] - p[i - 2]) * (k + 0.5)) / n, z = p[i - 1] + ((p[i + 1] - p[i - 1]) * (k + 0.5)) / n;
          sAll += l / n;
          if (nearestOn(s, x, z).d > 60) sFar += l / n;
        }
      }
    far += sFar;
    all += sAll;
    if (sAll > 300 && 1 - sFar / sAll < least) [least, leastAt] = [1 - sFar / sAll, s.name];
  }
  const m = ix.streets.map((s) => middleOf(s)).filter((p, i) => off(ix.streets[i].name, p.x, p.z) > 12).length;
  row(worst <= 12 && 1 - far / all >= 0.97 && m === 0, 'on', { farthestIndexPointFromItsStreetM: +worst.toFixed(1), of: worstAt, tilesLengthWithin60mOfTheIndex: `${((1 - far / all) * 100).toFixed(1)} %`, leastOfAStreetOver300m: `${(least * 100).toFixed(0)} % ${leastAt}`, middlesOffTheirStreet: m });
}

// ---- corners
{
  const CORNERS = [
    ['Guerrero & 20th', 'Guerrero St', '20th St'], ['16th and mission', '16th St', 'Mission St'], ['haight/ashbury', 'Haight St', 'Ashbury St'], ['Hayes at Octavia', 'Hayes St', 'Octavia St'],
    ['market @ castro', 'Market St', 'Castro St'], ['lombard + hyde', 'Lombard St', 'Hyde St'], ['24th & Mission', '24th St', 'Mission St'], ['geary and fillmore', 'Geary Blvd', 'Fillmore St'],
    ['Irving & 9th', 'Irving St', '9th Ave'], ['valencia & 18th street', 'Valencia St', '18th St'],
  ];
  const wrong = [];
  for (const [typed, a, b] of CORNERS) {
    const h = findStreet(ix, typed)[0];
    const da = h ? off(a, h.x, h.z) : Infinity, db = h ? off(b, h.x, h.z) : Infinity;
    if (!h || h.street.name !== a || h.cross?.name !== b || !(da <= 25) || !(db <= 25)) wrong.push(`${typed}: ${h ? `${h.street.name} x ${h.cross?.name ?? 'none'}, ${Math.round(da)} and ${Math.round(db)} m off` : 'nothing'}`);
  }
  row(wrong.length === 0, 'corners', { corners: CORNERS.length, found: CORNERS.length - wrong.length, wrong });
}

// ---- slips
{
  const SLIPS = [['valenica', 'Valencia St'], ['guerero', 'Guerrero St'], ['divisidero', 'Divisadero St'], ['filmore', 'Fillmore St'], ['embarcedero', 'The Embarcadero'], ['lombrad st', 'Lombard St'], ['Gearry', 'Geary Blvd'], ['José Sarria', 'José Sarria Ct'], ['jose sarria court', 'José Sarria Ct']];
  const wrong = SLIPS.filter(([typed, want]) => findStreet(ix, typed)[0]?.street.name !== want).map(([typed, want]) => `${typed}: ${findStreet(ix, typed)[0]?.street.name ?? 'nothing'}, not ${want}`);
  row(wrong.length === 0, 'slips', { slips: SLIPS.length, found: SLIPS.length - wrong.length, wrong });
}

// ---- nothing
{
  let threw = '';
  const found = [];
  for (const t of ['', ' ', '&', 'xqzzy', '!!!', 'and', 'qqqqqqqqqqqqqqqqqqqq & zzzzzzzz', '\u0000', 'a'.repeat(5000)]) {
    try {
      if (findStreet(ix, t).length) found.push(JSON.stringify(t.slice(0, 20)));
    } catch (e) {
      threw = `${JSON.stringify(t.slice(0, 20))}: ${e.message}`;
    }
  }
  row(!threw && found.length === 0, 'nothing', { found, threw });
}

// ---- damage
{
  let threw = '', read = 0, cuts = 0;
  const tryIt = (b, what) => {
    try {
      if (parseStreets(b)) read++;
    } catch (e) {
      threw = `${what}: ${e.message}`;
    }
  };
  for (let n = 0; n < bytes.length; n += 97, cuts++) tryIt(bytes.subarray(0, n), `cut at ${n}`);
  // (a made-up generator, the same bytes every run)
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let k = 0; k < 400; k++) {
    const b = Uint8Array.from({ length: 16 + Math.floor(rnd() * 4000) }, () => Math.floor(rnd() * 256));
    if (k % 2) b.set([0x53, 0x42, 0x53, 0x31]);
    tryIt(b, `random ${k}`);
  }
  // (and the whole file with one byte flipped, every 211th: whatever it reads as, it does not throw, and no coordinate is not a number)
  let nan = 0;
  for (let n = 16; n < bytes.length; n += 211) {
    const b = bytes.slice();
    b[n] ^= 0xff;
    try {
      const j = parseStreets(b);
      if (j) for (const s of j.streets) for (const p of s.pieces) for (const v of p) if (!Number.isFinite(v)) nan++;
    } catch (e) {
      threw = `flipped at ${n}: ${e.message}`;
    }
  }
  row(!threw && read === 0 && nan === 0, 'damage', { cutShort: cuts, readAsAnIndex: read, random: 400, threw, notANumber: nan });
}

console.log(bad ? `streets: FAILED ${bad}` : 'streets: all passed');
process.exit(bad ? 1 : 0);
