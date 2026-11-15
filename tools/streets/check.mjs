#!/usr/bin/env node
// The street index's check (docs/M1.md, task 8: "its size printed (target under 100 KB); a Node check of 30 street names (Guerrero, Valencia, Hayes,
// Lombard, Geary and Irving among them) finds each on its own street"). No browser.
//   node tools/streets/check.mjs [city folder = public/city/sf]
// Reads the city's streets.bin as the page will (parseStreets) and holds it against the city's own tiles, which it reads again by itself:
//   size      the file is under 100 KB; a fresh build of the tiles gives the same bytes (the file in the repo is not stale; two builds agree); the builder
//             reads the folder it is given
//   names     every street name in the tiles is in the index
//   thirty    thirty names typed as a thumb types them: the first answer is that street, score 0, at a point within 8 m of that street's own line in
//             the tiles, and for a straight street within a twentieth of its length of its middle
//   itself    every street's own name finds it first, score 0
//   on        every point of the index lies within 8 m of its street's lines in the tiles; at least 99.5 % of the tiles' street length lies within 60 m
//             of the index's, and no street over 300 m has under 80 % of its own
//   typed     the other ways a name is typed: a direction or a title spelt out, a short form, a later word, initials, a beginning, a bare number, a
//             number with the wrong ending, words after the name, a house number before it, a slip in the kind; and a place that is no street is a guess
//   corners   two names joined every way (& / @ + , x and at near, a space, "corner of"), within 25 m of both streets' lines in the tiles; a corner
//             the map leaves a block out of is answered between the two, a looser answer; two streets that never meet are one street alone, looser still
//   real      every corner in the tiles (two names whose lines touch within 2 m), asked both ways: 99 % and more answer that pair within 30 m of where
//             they touch
//   near      with the bus somewhere, the point is the street's own nearest; of two streets of one name the one nearer the bus; a namesake in another
//             town only when the bus is beside it
//   slips     a letter wrong, missing, doubled or swapped still finds the street, as a guess (score 3 or more); a figure is never a slip
//   nothing   nonsense and empty text find nothing, nothing throws, and the longest text takes under 50 ms
//   damage    the file cut short anywhere, grown, with any one byte wrong, a count lowered, or random bytes: no index (null), never a throw
// Prints a row each; exits 1 if one fails, 2 if the city has no streets.bin (run tools/streets/build.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const byIx = new Map(ix.streets.map((s) => [s.name, s]));
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
const first = (typed, near) => findStreet(ix, typed, near)[0];
/** rows of [typed, the street wanted first, (least score, most score)]: those that went wrong */
const wrongOf = (rows, near) =>
  rows.filter(([typed, want, lo = 0, hi = Infinity]) => {
    const h = first(typed, near);
    return !h || h.street.name !== want || h.score < lo || h.score > hi;
  }).map(([typed, want]) => `${typed}: ${first(typed, near) ? `${first(typed, near).street.name} [${first(typed, near).score}]` : 'nothing'}, not ${want}`);

// ---- size
{
  const fresh = encodeStreets(buildStreets(byName).streets), again = encodeStreets(buildStreets(readStreets(dir).byName).streets);
  const same = fresh.length === bytes.length && fresh.every((b, i) => b === bytes[i]), twice = fresh.length === again.length && fresh.every((b, i) => b === again[i]);
  // (the builder told to build a folder that is not there must say so, not build San Francisco)
  const lost = spawnSync(process.execPath, [fileURLToPath(new URL('./build.mjs', import.meta.url)), '/no/such/city', '--dry'], { encoding: 'utf8' });
  row(bytes.length < 100 * 1024 && same && twice && lost.status !== 0, 'size', { bytes: bytes.length, KB: +(bytes.length / 1024).toFixed(1), under100KB: bytes.length < 100 * 1024, streets: ix.streets.length, runs: ix.streets.reduce((a, s) => a + s.pieces.length, 0), aFreshBuildIsTheFile: same, twoBuildsAgree: twice, theBuilderReadsItsFolder: lost.status !== 0 });
}

// ---- names
{
  const missing = [...byName.keys()].filter((n) => !byIx.has(n));
  row(missing.length === 0, 'names', { inTheTiles: byName.size, inTheIndex: ix.streets.length, missing: missing.slice(0, 12) });
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
  let worst = 0, mid = 0;
  for (const [typed, want] of THIRTY) {
    const h = first(typed);
    const d = h ? off(want, h.x, h.z) : Infinity;
    if (!h || h.street.name !== want || h.score !== 0 || !(d <= 8) || !inMap(h.x, h.z)) wrong.push(`${typed}: ${h ? `${h.street.name} [${h.score}], ${Math.round(d)} m off ${want}` : 'nothing'}`);
    else worst = Math.max(worst, d);
    // (a straight street, two points: its middle is half-way)
    const p = h?.street.pieces[0];
    if (p && p.length === 4) {
      const l = Math.hypot(p[2] - p[0], p[3] - p[1]), m = Math.hypot(h.x - (p[0] + p[2]) / 2, h.z - (p[1] + p[3]) / 2);
      mid++;
      if (m > l / 20) wrong.push(`${typed}: its middle is ${Math.round(m)} m from half-way along ${Math.round(l)} m`);
    }
  }
  row(wrong.length === 0, 'thirty', { names: THIRTY.length, found: THIRTY.length - wrong.filter((w) => !w.includes('its middle')).length, farthestFromItsStreetM: +worst.toFixed(1), straightOnesAtTheirMiddle: mid, wrong });
}

// ---- itself
{
  const wrong = ix.streets.filter((s) => first(s.name)?.street !== s || first(s.name).score !== 0).map((s) => `${s.name} -> ${first(s.name)?.street.name ?? 'nothing'} [${first(s.name)?.score}]`);
  row(wrong.length === 0, 'itself', { streets: ix.streets.length, foundFirstByTheirOwnName: ix.streets.length - wrong.length, wrong: wrong.slice(0, 8) });
}

// ---- on
{
  let worst = 0, worstAt = '', far = 0, all = 0, least = 1, leastAt = '';
  for (const [name, lines] of byName) {
    const s = byIx.get(name);
    if (s)
      for (const p of s.pieces)
        for (let i = 0; i < p.length; i += 2) {
          const d = off(name, p[i], p[i + 1]);
          if (d > worst) [worst, worstAt] = [d, name];
        }
    // (the tiles' own length of it, sampled every 20 m, against the index's runs)
    let sFar = 0, sAll = 0;
    for (const p of lines)
      for (let i = 2; i < p.length; i += 2) {
        const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]), n = Math.max(1, Math.round(l / 20));
        for (let k = 0; k < n; k++) {
          const x = p[i - 2] + ((p[i] - p[i - 2]) * (k + 0.5)) / n, z = p[i - 1] + ((p[i + 1] - p[i - 1]) * (k + 0.5)) / n;
          sAll += l / n;
          if (!s || nearestOn(s, x, z).d > 60) sFar += l / n;
        }
      }
    far += sFar;
    all += sAll;
    if (sAll > 300 && 1 - sFar / sAll < least) [least, leastAt] = [1 - sFar / sAll, name];
  }
  const m = ix.streets.map((s) => middleOf(s)).filter((p, i) => off(ix.streets[i].name, p.x, p.z) > 8).length;
  row(worst <= 8 && 1 - far / all >= 0.995 && least >= 0.8 && m === 0, 'on', { farthestIndexPointFromItsStreetM: +worst.toFixed(1), of: worstAt, tilesLengthWithin60mOfTheIndex: `${((1 - far / all) * 100).toFixed(2)} %`, leastOfAStreetOver300m: `${(least * 100).toFixed(0)} % ${leastAt}`, middlesOffTheirStreet: m });
}

// ---- typed
{
  const TYPED = [
    // a direction or a title spelt the other way; a short form
    ['South Van Ness', 'S Van Ness Ave', 0, 0], ['south van ness avenue', 'S Van Ness Ave', 0, 0], ['West Portal', 'W Portal Ave', 0, 0], ['Martin Luther King Jr Dr', 'Martin Luther King Junior Dr', 0, 0],
    ['north point', 'N Point St', 0, 0], ['Geary Bl', 'Geary Blvd', 0, 0], ['lincoln wy', 'Lincoln Way', 0, 0], ['great highway', 'Great Hwy', 0, 0],
    // a later word, initials, a kind its own streets lack
    ['goodlett', 'Dr Carlton B Goodlett Pl', 0.75, 1], ['jfk drive', 'John F Kennedy Dr', 0, 0], ['mlk drive', 'Martin Luther King Junior Dr', 0.75, 1], ['chavez', 'Cesar Chavez St', 0.75, 1],
    ['kennedy drive', 'John F Kennedy Dr', 0.75, 0.75], ['van ness st', 'Van Ness Ave', 1, 1],
    // a beginning: the longest street so begun
    ['van', 'Van Ness Ave', 1, 1], ['mis', 'Mission St', 1.5, 1.5], ['gue', 'Guerrero St', 1.5, 1.5],
    // a bare number, a number with the wrong ending
    ['24 st', '24th St', 0, 0], ['3rd ave', '3rd Ave', 0, 0], ['third street', '3rd St', 0, 0], ['22th st', '22nd St', 0, 0],
    // words after the name, a house number before it, a slip in the kind: the street, a looser answer
    ['Guerrero St, San Francisco, CA', 'Guerrero St', 2, 2.5], ['guerrero st sf', 'Guerrero St', 2, 2.5], ['1200 Guerrero St', 'Guerrero St', 2, 2.5], ['guerrero sy', 'Guerrero St', 2, 2.5], ['hayes stret', 'Hayes St', 2, 2.5],
    // a place that is no street: a guess, said so
    ['Union Square', 'Union St', 2, 9], ['Pier 39', 'Pier 39', 0, 9],
  ];
  const wrong = wrongOf(TYPED.filter(([, want]) => byIx.has(want)));
  const twenty = findStreet(ix, '20').map((h) => h.street.name);
  if (!(twenty.includes('20th St') && twenty.includes('20th Ave'))) wrong.push(`20: ${twenty.join(', ')}: wants 20th St and 20th Ave`);
  row(wrong.length === 0, 'typed', { forms: TYPED.length + 1, found: TYPED.length + 1 - wrong.length, wrong });
}

// ---- corners
{
  const CORNERS = [
    ['Guerrero & 20th', 'Guerrero St', '20th St'], ['16th and mission', '16th St', 'Mission St'], ['haight/ashbury', 'Haight St', 'Ashbury St'], ['Hayes at Octavia', 'Hayes St', 'Octavia St'],
    ['market @ castro', 'Market St', 'Castro St'], ['lombard + hyde', 'Lombard St', 'Hyde St'], ['24th & Mission', '24th St', 'Mission St'], ['geary and fillmore', 'Geary Blvd', 'Fillmore St'],
    ['Irving & 9th', 'Irving St', '9th Ave'], ['valencia & 18th street', 'Valencia St', '18th St'], ['guerrero, 20th', 'Guerrero St', '20th St'], ['guerrero 20th', 'Guerrero St', '20th St'],
    ['16th mission', '16th St', 'Mission St'], ['guerrero x 20th', 'Guerrero St', '20th St'], ['corner of guerrero and 20th', 'Guerrero St', '20th St'], ['valencia near 18th', 'Valencia St', '18th St'],
    ['geary & franklin', 'Geary Blvd', 'Franklin St'], ['filbert & sansome', 'Filbert St', 'Sansome St'], ['alemany & brotherhood way', 'Alemany Blvd', 'Brotherhood Way'], ['16th and Mission, SF', '16th St', 'Mission St'],
  ];
  const wrong = [];
  for (const [typed, a, b] of CORNERS) {
    const h = first(typed);
    const da = h ? off(a, h.x, h.z) : Infinity, db = h ? off(b, h.x, h.z) : Infinity;
    if (!h || h.street.name !== a || h.cross?.name !== b || !(da <= 25) || !(db <= 25)) wrong.push(`${typed}: ${h ? `${h.street.name} x ${h.cross?.name ?? 'none'} [${h.score}], ${Math.round(da)} and ${Math.round(db)} m off` : 'nothing'}`);
  }
  // a block the map leaves out: between the two, within 128 m of both, a looser answer
  const p = first('powell and market');
  if (!p || p.street.name !== 'Powell St' || p.cross?.name !== 'Market St' || p.score < 1 || off('Powell St', p.x, p.z) > 128 || off('Market St', p.x, p.z) > 128) wrong.push(`powell and market: ${p ? `${p.street.name} x ${p.cross?.name ?? 'none'} [${p.score}], ${Math.round(off('Powell St', p.x, p.z))} and ${Math.round(off('Market St', p.x, p.z))} m off` : 'nothing'}`);
  // two streets that never meet, a name that is nothing: one street alone, cross null, score 2 or more
  for (const [typed, want] of [['valencia & taraval', 'Valencia St'], ['guerrero & xqzzy', 'Guerrero St'], ['xqzzy & guerrero', 'Guerrero St']]) {
    const h = first(typed);
    if (!h || h.street.name !== want || h.cross || h.score < 2) wrong.push(`${typed}: ${h ? `${h.street.name} x ${h.cross?.name ?? 'none'} [${h.score}]` : 'nothing'}, wants ${want} alone at 2 or more`);
  }
  row(wrong.length === 0, 'corners', { corners: CORNERS.length + 4, found: CORNERS.length + 4 - wrong.length, wrong });
}

// ---- real
{
  // every pair of names whose lines touch within TOUCH m in the tiles, by a grid of the lines' segments
  const TOUCH = 2, CELL = 64, names = [...byName.keys()], segs = [], grid = new Map();
  names.forEach((n, ni) => {
    for (const p of byName.get(n))
      for (let i = 2; i < p.length; i += 2) {
        const si = segs.length;
        segs.push([ni, p[i - 2], p[i - 1], p[i], p[i + 1]]);
        for (let cz = Math.floor((Math.min(p[i - 1], p[i + 1]) - TOUCH) / CELL); cz <= Math.floor((Math.max(p[i - 1], p[i + 1]) + TOUCH) / CELL); cz++)
          for (let cx = Math.floor((Math.min(p[i - 2], p[i]) - TOUCH) / CELL); cx <= Math.floor((Math.max(p[i - 2], p[i]) + TOUCH) / CELL); cx++) {
            const k = cx * 100000 + cz;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(si);
          }
      }
  });
  const touch = (a, b) => {
    const [, ax, az, bx, bz] = a, [, cx, cz, dx, dz] = b, rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx;
    if (den !== 0) {
      const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [0, ax + rx * t, az + rz * t];
    }
    let best = [Infinity, 0, 0];
    const end = (px, pz, qx, qz, wx, wz) => {
      const l2 = wx * wx + wz * wz, t = l2 > 0 ? Math.min(1, Math.max(0, ((px - qx) * wx + (pz - qz) * wz) / l2)) : 0, d = Math.hypot(px - qx - wx * t, pz - qz - wz * t);
      if (d < best[0]) best = [d, (px + qx + wx * t) / 2, (pz + qz + wz * t) / 2];
    };
    end(ax, az, cx, cz, sx, sz);
    end(bx, bz, cx, cz, sx, sz);
    end(cx, cz, ax, az, rx, rz);
    end(dx, dz, ax, az, rx, rz);
    return best;
  };
  const meets = new Map();
  for (const list of grid.values())
    for (let p = 0; p < list.length; p++)
      for (let q = p + 1; q < list.length; q++) {
        const a = segs[list[p]], b = segs[list[q]];
        if (a[0] === b[0]) continue;
        const [d, x, z] = touch(a, b);
        if (d > TOUCH) continue;
        const k = a[0] < b[0] ? `${a[0]}|${b[0]}` : `${b[0]}|${a[0]}`;
        if (!meets.has(k)) meets.set(k, []);
        meets.get(k).push([x, z]);
      }
  let asked = 0, right = 0;
  const wrong = [];
  for (const [k, places] of meets) {
    const [i, j] = k.split('|').map(Number);
    for (const [A, B] of [[names[i], names[j]], [names[j], names[i]]]) {
      asked++;
      const h = first(`${A} & ${B}`);
      const d = h ? Math.min(...places.map((m) => Math.hypot(m[0] - h.x, m[1] - h.z))) : Infinity;
      if (h && h.street.name === A && h.cross?.name === B && d <= 30) right++;
      else if (wrong.length < 6) wrong.push(`${A} & ${B}: ${h ? `${h.street.name} x ${h.cross?.name ?? 'none'} [${h.score}], ${Math.round(d)} m off` : 'nothing'}`);
    }
  }
  row(right / asked >= 0.99, 'real', { cornersInTheTiles: meets.size, askedBothWays: asked, thatPairWithin30m: right, share: `${((right / asked) * 100).toFixed(2)} %`, someOfTheRest: wrong });
}

// ---- near
{
  const wrong = [];
  // from five places, every street: the point is one of its own, on its line, and none of its own points is nearer the bus
  const PLACES = [[city.start?.x ?? 0, city.start?.z ?? 0], [0, 0], [-6000, 1500], [800, 2500], [3000, 5000]];
  let asked = 0;
  for (const [x, z] of PLACES)
    for (const s of ix.streets) {
      const h = findStreet(ix, s.name, { x, z })[0];
      asked++;
      if (!h || h.street !== s) {
        wrong.push(`${s.name} from ${x}, ${z}: ${h?.street.name ?? 'nothing'}`);
        continue;
      }
      const own = nearestOn(s, x, z, 0, s.main), all = nearestOn(s, x, z);
      const d = Math.hypot(h.x - x, h.z - z);
      // (its own nearest; a namesake's only when the bus is within a kilometre of that)
      const ok = Math.abs(d - own.d) < 0.01 || (Math.abs(d - all.d) < 0.01 && all.d <= 1000);
      if (!ok || off(s.name, h.x, h.z) > 8) wrong.push(`${s.name} from ${x}, ${z}: ${Math.round(d)} m off, its own nearest ${Math.round(own.d)}`);
    }
  // of two streets of one name, the one nearer the bus: over the Mission "24th" is the street, over the Sunset the avenue
  for (const [typed, x, z, want] of [['24th', 800, 2700, '24th St'], ['24th', -6200, 1500, '24th Ave'], ['16th', 600, 900, '16th St'], ['16th', -5400, 1500, '16th Ave']]) {
    const h = findStreet(ix, typed, { x, z })[0];
    if (h?.street.name !== want) wrong.push(`${typed} from ${x}, ${z}: ${h?.street.name ?? 'nothing'}, not ${want}`);
  }
  // a street with a namesake in another town: from the game's start, and with no bus, it is the city's
  const twins = ix.streets.filter((s) => s.main < s.pieces.length);
  for (const s of twins) {
    const m = middleOf(s);
    if (nearestOn(s, m.x, m.z, 0, s.main).d > 0.01) wrong.push(`${s.name}: its middle is on its namesake`);
  }
  row(wrong.length === 0, 'near', { asked, streetsWithANamesake: twins.length, wrong: wrong.slice(0, 8) });
}

// ---- slips
{
  const SLIPS = [
    ['valenica', 'Valencia St', 3], ['guerero', 'Guerrero St', 3], ['divisidero', 'Divisadero St', 3], ['filmore', 'Fillmore St', 3], ['embarcedero', 'The Embarcadero', 3], ['lombrad st', 'Lombard St', 3],
    ['Gearry', 'Geary Blvd', 3], ['haigth', 'Haight St', 3], ['gaery', 'Geary Blvd', 3], ['divissaderro', 'Divisadero St', 4], ['José Sarria', 'José Sarria Ct', 0], ['jose sarria court', 'José Sarria Ct', 0],
    ['CÉSAR CHÁVEZ STREET', 'Cesar Chavez St', 0],
  ];
  const wrong = wrongOf(SLIPS.filter(([, want]) => byIx.has(want)).map(([t, w, s]) => [t, w, s, s]));
  // (a figure typed for another is not a slip)
  for (const typed of ['49th', 'pier 93']) {
    const h = first(typed);
    if (h && /\d/.test(h.street.key) && !h.street.key.includes(typed.replace(/\D/g, ''))) wrong.push(`${typed}: ${h.street.name} [${h.score}]: another number`);
  }
  row(wrong.length === 0, 'slips', { slips: SLIPS.length + 2, found: SLIPS.length + 2 - wrong.length, wrong });
}

// ---- nothing
{
  let threw = '', slow = 0;
  const found = [];
  for (const t of ['', ' ', '&', 'xqzzy', '!!!', 'q', 'zz', 'qqqqqqqqqqqqqqqqqqqq & zzzzzzzz', '\u0000', 'a'.repeat(5000), ' '.repeat(50000), `${'guerrero & '.repeat(20)}20th`, null, undefined, 7]) {
    const t0 = performance.now();
    try {
      const h = findStreet(ix, t);
      if (h.length && !String(t).includes('guerrero')) found.push(JSON.stringify(String(t).slice(0, 20)));
    } catch (e) {
      threw = `${JSON.stringify(String(t).slice(0, 20))}: ${e.message}`;
    }
    slow = Math.max(slow, performance.now() - t0);
  }
  row(!threw && found.length === 0 && slow < 50, 'nothing', { found, threw, slowestMs: +slow.toFixed(1) });
}

// ---- damage
{
  let threw = '', read = 0, tried = 0;
  const tryIt = (b, what) => {
    tried++;
    try {
      if (parseStreets(b)) read++;
    } catch (e) {
      threw = `${what}: ${e.message}`;
    }
  };
  for (let n = 0; n < bytes.length; n += 97) tryIt(bytes.subarray(0, n), `cut at ${n}`);
  // (a made-up generator, the same bytes every run)
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let k = 0; k < 400; k++) {
    const b = Uint8Array.from({ length: 24 + Math.floor(rnd() * 4000) }, () => Math.floor(rnd() * 256));
    if (k % 2) b.set([0x53, 0x42, 0x53, 0x31]);
    tryIt(b, `random ${k}`);
  }
  // any one byte wrong (every 53rd, and each of the head's), bytes added, a count lowered, another magic, a step of nothing
  for (let n = 0; n < bytes.length; n += n < 24 ? 1 : 53) {
    const b = bytes.slice();
    b[n] ^= 0x55;
    tryIt(b, `a byte wrong at ${n}`);
  }
  const grown = new Uint8Array(bytes.length + 3);
  grown.set(bytes);
  tryIt(grown, 'grown');
  for (const b of [null, undefined, 'SBS1', {}, new ArrayBuffer(0)]) tryIt(b, `not bytes: ${String(b)}`);
  row(!threw && read === 0, 'damage', { tried, readAsAnIndex: read, threw });
}

console.log(bad ? `streets: FAILED ${bad}` : 'streets: all passed');
process.exit(bad ? 1 : 0);
