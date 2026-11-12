// ?show, the one link (docs/specs/flight/SWERVE.md, "The one link"), in Node, no browser: node tools/feel-sim/run.mjs ../swerve/s_show.ts
//   crew       the real crew (src/game/crew.ts) on a fake localStorage, a fresh one a page: ?crew=show turns the button on for that page and saves nothing, a
//              faction picked there included; the plain page after it has no button; ?crew still turns it on for good, and ?crew=off still forgets it
//   swap       the Moon's page change (src/sky/moonrun.ts's SWAP_KEEP, read from its text) keeps exactly what it kept, and `show`
//   link       index.html's ?show lines, run as they are on a fake location: the long set added once, a flag given beside it wins, the query's own text kept
//              byte for byte (t's colons, a bare fps), the hash kept, a page without `show` never written; ES5 only; and over the Moon's page change and back
//              the link comes out whole again
// Prints a row each, and exits 1 if one fails.
import { readFileSync } from 'node:fs';
import { Crew } from '@src/game/crew';
import { FACTION_RAINBOW } from '@src/game/factions';

// (run from the repo's root, as every sim is: the bundle lands under tools/feel-sim/.out)
const ROOT = `${process.cwd()}/`;
let bad = 0;
const row = (ok: boolean, name: string, o: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(34)} ${JSON.stringify(o)}`);
};

// ---------------------------------------------------------------- the crew's button
const store = new Map<string, string>();
let writes = 0;
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    writes++;
    store.set(k, v);
  },
  removeItem: (k: string) => void store.delete(k),
};
/** A page: a fresh crew, read from the link's query. */
const page = (q: string) => new Crew().init(new URLSearchParams(q));
{
  store.clear();
  writes = 0;
  const a = page('?swerve&crew=show&life');
  const on = a.on;
  a.set(FACTION_RAINBOW + 2);
  const picked = a.faction, savedOnShow = writes;
  const b = page('');
  row(on && picked === FACTION_RAINBOW + 2 && savedOnShow === 0 && store.size === 0 && !b.on && b.faction === FACTION_RAINBOW, 'crew, show', { onTheShowPage: on, picked, writesThere: savedOnShow, onThePlainPageAfter: b.on, factionThere: b.faction });
}
{
  store.clear();
  writes = 0;
  const a = page('?crew');
  a.set(FACTION_RAINBOW + 1);
  const b = page('');
  const c = page('?crew=off');
  const d = page('');
  row(a.on && b.on && b.faction === FACTION_RAINBOW + 1 && !c.on && !d.on && d.faction === FACTION_RAINBOW, 'crew, ?crew and ?crew=off as before', { kept: b.on, keptFaction: b.faction, afterOff: d.on });
}
{
  // (a phone that turned it on for good with ?crew, then a show page: on, and what's picked there isn't kept)
  store.clear();
  page('?crew').set(FACTION_RAINBOW + 1);
  const a = page('?show&crew=show');
  a.set(FACTION_RAINBOW + 3);
  const b = page('');
  row(a.on && b.on && b.faction === FACTION_RAINBOW + 1, 'crew, show after ?crew', { onThere: a.on, factionAfter: b.faction });
}

// ---------------------------------------------------------------- the Moon's page change keeps ?show
{
  const text = readFileSync(`${ROOT}src/sky/moonrun.ts`, 'utf8');
  const m = /const SWAP_KEEP = \[([^\]]*)\];/.exec(text);
  const keep = m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : [];
  const was = ['fps', 't', 'tune', 'g5', 'fixeddt', 'city', 'hour', 'life'];
  const ok = keep.length === was.length + 1 && was.every((k, i) => keep[i] === k) && keep[was.length] === 'show';
  // (and the line that builds the next page's query from it, as it was)
  const line = "const keep = SWAP_KEEP.filter((k) => params.has(k)).map((k) => (params.get(k) ? `&${k}=${encodeURIComponent(params.get(k)!)}` : `&${k}`));";
  row(ok && text.includes(line), 'show, SWAP_KEEP', { keep, theKeepLine: text.includes(line) });
}

// ---------------------------------------------------------------- the link written out (index.html's boot script, its ?show lines run as they are)
{
  const html = readFileSync(`${ROOT}index.html`, 'utf8').split('\r').join('');
  const m = /\n( *)if \(new URLSearchParams\(location\.search\)\.has\('show'\)\) \{\n[\s\S]*?\n\1\}\n/.exec(html);
  const code = m ? m[0] : '';
  /** The address after the lines run on this one (its query and hash), and how many times they wrote it. */
  const run = (search: string, hash = '') => {
    let addr = `/${search}${hash}`, writes = 0;
    const location = { pathname: '/', search, hash };
    const history = {
      state: null,
      replaceState: (_s: unknown, _t: string, url: string) => {
        writes++;
        addr = url;
      },
    };
    new Function('location', 'history', code)(location, history);
    return { addr, writes };
  };
  const LONG = '&swerve&crew=show&life&bomb&boom&falls&lift&lifted=inferno&earth';
  const cases: Array<[string, string, string, number]> = [
    // (the link, its hash, the address after, writes)
    ['?show', '', `/?show${LONG}`, 1],
    ['?show&lifted=atlantis', '', '/?show&lifted=atlantis&swerve&crew=show&life&bomb&boom&falls&lift&earth', 1],
    ['?show&norivals', '', `/?show&norivals${LONG}`, 1],
    ['?show&t=2026-11-25T04:00:00Z&fps', '', `/?show&t=2026-11-25T04:00:00Z&fps${LONG}`, 1],
    ['?show&crew', '', '/?show&crew&swerve&life&bomb&boom&falls&lift&lifted=inferno&earth', 1],
    ['?moonland&show', '#x', `/?moonland&show${LONG}#x`, 1],
    [`?show${LONG}`, '', `/?show${LONG}`, 0],
    ['', '', '/', 0],
    ['?swerve', '', '/?swerve', 0],
    ['?showing', '', '/?showing', 0],
  ];
  const out: Record<string, unknown> = {};
  let ok = code.length > 0;
  for (const [q, h, want, w] of cases) {
    const r = run(q, h);
    if (r.addr !== want || r.writes !== w) ok = false;
    out[q || '/'] = r.writes ? r.addr : 'as it was';
  }
  // (ES5 only: the boot script isn't compiled, and Safari 15 parses it as it is)
  const es5 = !/=>|\blet\b|\bconst\b|`|\?\?|\?\./.test(code);
  row(ok && es5, 'show, the link', { found: code.length > 0, es5, ...out });
  // (and the page change to the Moon and back: what it keeps of the written-out link is ?show, and that is written out again)
  const keep = ['fps', 't', 'tune', 'g5', 'fixeddt', 'city', 'hour', 'life', 'show'];
  const params = new URLSearchParams(`?show${LONG}&fps`);
  const kept = keep.filter((k) => params.has(k)).map((k) => (params.get(k) ? `&${k}=${encodeURIComponent(params.get(k)!)}` : `&${k}`));
  const next = run(`?moonland&resume${kept.join('')}`);
  row(next.addr === `/?moonland&resume&fps&life&show&swerve&crew=show&bomb&boom&falls&lift&lifted=inferno&earth`, 'show, over the Moon and back', { kept: kept.join(''), next: next.addr });
}

console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
