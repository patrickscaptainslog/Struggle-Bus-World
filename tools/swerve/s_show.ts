// ?show, the one link (docs/specs/flight/SWERVE.md, "The one link"), in Node, no browser: node tools/feel-sim/run.mjs ../swerve/s_show.ts
//   crew       the real crew (src/game/crew.ts) on a fake localStorage, a fresh one a page: ?crew=show turns the button on for that page and saves nothing, a
//              faction picked there included; the plain page after it has no button; ?crew still turns it on for good, and ?crew=off still forgets it
//   swap       the Moon's page change (src/sky/moonrun.ts's SWAP_KEEP and SHOW_KEEP, read from its text) keeps exactly what it kept, and `show`; on a show page
//              also what index.html wrote and the flags beside it (the review of 1dfa24f: ?show&lifted=atlantis came home Inferno, ?show&norivals with rivals)
//   crew, over the Moon   a faction picked on a show page lasts the tab (a fake sessionStorage): the swapped page has it, a new tab and the plain page don't
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
const store = new Map<string, string>(), tab = new Map<string, string>();
let writes = 0;
(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
  getItem: (k: string) => tab.get(k) ?? null,
  setItem: (k: string, v: string) => void tab.set(k, v),
  removeItem: (k: string) => void tab.delete(k),
};
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
{
  // (a show page's pick over the Moon's page change, in the same tab: the next page is crew=show again, and has it; the phone kept nothing; a new tab (its
  // sessionStorage empty) starts at the phone's own; the plain page has no button)
  store.clear();
  tab.clear();
  writes = 0;
  const a = page('?show&swerve&crew=show');
  a.set(FACTION_RAINBOW + 3);
  const moon = page('?moonland&resume&show&swerve&crew=show');
  const home = page('?resume&show&swerve&crew=show');
  const plain = page('');
  tab.clear();
  const fresh = page('?show&crew=show');
  row(moon.faction === FACTION_RAINBOW + 3 && home.faction === FACTION_RAINBOW + 3 && writes === 0 && !plain.on && fresh.faction === FACTION_RAINBOW, 'crew, over the Moon', { onTheMoon: moon.faction, home: home.faction, phoneWrites: writes, plainPageOn: plain.on, newTab: fresh.faction });
}

// ---------------------------------------------------------------- the Moon's page change keeps ?show
const SWAP = { keep: [] as string[], show: [] as string[] };
{
  const text = readFileSync(`${ROOT}src/sky/moonrun.ts`, 'utf8');
  const list = (name: string) => {
    const m = new RegExp(`const ${name} = \\[([^\\]]*)\\];`).exec(text);
    return m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : [];
  };
  const keep = list('SWAP_KEEP'), showKeep = list('SHOW_KEEP');
  const was = ['fps', 't', 'tune', 'g5', 'fixeddt', 'city', 'hour', 'life'];
  // (on a show page, every key of index.html's list and norivals: life is SWAP_KEEP's already)
  const LIST = ['swerve', 'crew', 'life', 'bomb', 'boom', 'falls', 'lift', 'lifted', 'earth', 'norivals'];
  const ok = keep.length === was.length + 1 && was.every((k, i) => keep[i] === k) && keep[was.length] === 'show' && LIST.every((k) => keep.includes(k) || showKeep.includes(k));
  // (and the line that builds the next page's query from them)
  const line = "const keep = (params.has('show') ? SWAP_KEEP.concat(SHOW_KEEP) : SWAP_KEEP).filter((k) => params.has(k)).map((k) => (params.get(k) ? `&${k}=${encodeURIComponent(params.get(k)!)}` : `&${k}`));";
  row(ok && text.includes(line), 'show, SWAP_KEEP', { keep, showKeep, theKeepLine: text.includes(line) });
  SWAP.keep = keep;
  SWAP.show = showKeep;
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
  // (moonrun.ts's keep line, on the lists read from its text; the next page's address is index.html's again)
  const swap = (q: string) => {
    const params = new URLSearchParams(q);
    const kept = (params.has('show') ? SWAP.keep.concat(SWAP.show) : SWAP.keep).filter((k) => params.has(k)).map((k) => (params.get(k) ? `&${k}=${encodeURIComponent(params.get(k)!)}` : `&${k}`));
    return run(`?moonland&resume${kept.join('')}`).addr;
  };
  // (the link, and the page's query after index.html wrote it, to what the Moon's page has: a flag given beside show still wins there)
  const trips: Array<[string, (q: URLSearchParams) => boolean]> = [
    ['?show', (q) => q.get('lifted') === 'inferno' && !q.has('norivals') && q.get('crew') === 'show'],
    ['?show&lifted=atlantis', (q) => q.get('lifted') === 'atlantis' && q.getAll('lifted').length === 1],
    ['?show&norivals', (q) => q.has('norivals') && q.has('swerve')],
    ['?show&crew', (q) => q.get('crew') === '' && q.getAll('crew').length === 1],
    ['?show&fps', (q) => q.has('fps') && q.has('life')],
    ['?swerve&norivals&lifted=atlantis', (q) => !q.has('norivals') && !q.has('lifted') && !q.has('swerve')],
  ];
  const outT: Record<string, string> = {};
  let okT = SWAP.keep.length > 0;
  for (const [q, want] of trips) {
    const page1 = run(q).addr.slice(1);
    const next = swap(page1);
    if (!want(new URLSearchParams(next.slice(1)))) okT = false;
    outT[q] = next;
  }
  row(okT, 'show, over the Moon and back', outT);
}

console.log(bad ? `${bad} FAIL` : 'all pass');
process.exit(bad ? 1 : 0);
