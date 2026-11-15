// The card's rows: written and read back, pinned, cut, bent, broken, and held against index.html's own reader.
import { dice, same, randCard, randCaption, randSquares, randOrder, split, need } from './lib.mjs';

const ORIGIN = 'https://struggle-bus-world.vercel.app';

export async function linkRows(R, L, stamp) {
  const { row } = R, A = L.ALPHABET;
  /** every address these rows make, for the stamp's row */
  const hrefs = [];
  const keep = (href) => (hrefs.length < 700000 && hrefs.push(href), href);
  /** an address as a page gets it: through the URL parser every browser has (it escapes what an app left raw) */
  const asPage = (href) => {
    const u = new URL(href);
    return [u.pathname, u.search, u.hash];
  };
  const headOf = (c) => same({ map: c.map, ix: c.ix, iz: c.iz, crew: c.crew, at: c.at, caption: c.caption });
  const coreOf = (c) => same({ squares: c.body.squares, answers: c.body.answers, score: c.body.score });
  /** a card's text as its sections: [start of its length, end of its check] for the head, the core, the tail */
  const sections = (text) => {
    const out = [];
    for (let pos = 1, k = 0; pos + 2 <= text.length && k < 3; k++) {
      const end = pos + 2 + A.indexOf(text[pos]) * 32 + A.indexOf(text[pos + 1]) + (k === 1 ? 6 : 3);
      out.push([pos, end]);
      pos = end;
    }
    return out;
  };

  await row('round', () => {
    const rnd = dice(1), kinds = { spot: 0, mark: 0, squares: 0 }, clock = Date.now, luck = Math.random;
    let longest = 0;
    for (let i = 0; i < 10000; i++) {
      const card = randCard(L, rnd), e = L.encode(card);
      need(e.ok, () => `card ${i} would not be written: ${e.why}: ${same(card)}`);
      const d = L.decode(e.text);
      need(d.level === 'full' && d.why === '' && same(d.card) === same(card), () => `card ${i} read back as ${d.level} ${same(d.card)}, was ${same(card)}`);
      need(d.id === e.id && d.id30 === e.id30 && d.canon === e.text && !d.skipped.length, `card ${i}: its id or its text moved`);
      // (no clock and no dice in a card's text: the same card is the same link on any phone)
      Date.now = () => { throw new Error('the clock was read'); };
      Math.random = () => { throw new Error('the dice were thrown'); };
      let again;
      try {
        again = L.encode(d.card);
      } finally {
        Date.now = clock, Math.random = luck;
      }
      need(again.ok && again.text === e.text, `card ${i} written twice gave two texts`);
      const url = keep(L.cardUrl(ORIGIN, 'mission-dolores', i % 100, e.text)), v = L.parseLocation(...split(url));
      need(v.kind === 'card' && v.place === 'mission-dolores' && v.gen === i % 100 && v.link.level === 'full' && same(v.link.card) === same(card), `card ${i} did not come back out of its address`);
      kinds[card.body ? card.body.form : 'spot']++;
      longest = Math.max(longest, url.length);
    }
    return `10,000 random cards (${kinds.squares} of squares, ${kinds.mark} of a landmark, ${kinds.spot} of a place alone) written, read back the same, and written again to the same text; the longest address ${longest} characters`;
  });

  await row('length', () => {
    // a 17-square place as it is usually sent: a block round Guerrero and 24th, a street corner for a caption, some of it lifted
    const rnd = dice(17), usual = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) if (usual.length < 17) usual.push({ ix: -4 + i, iz: 13 + j, stage: 1 + ((i * 3 + j) % 4) });
    const typical = { v: 1, map: 0, ix: -3, iz: 14, crew: 2, at: 459000, caption: 'GUERRERO ST & 24TH ST', body: { form: 'squares', squares: usual, order: randOrder(usual, rnd), answers: null, score: null } };
    const t = L.encode(typical);
    need(t.ok, `the usual card: ${t.why}`);
    const usualUrl = keep(L.cardUrl(ORIGIN, 'mission', 0, t.text));
    // and at its worst on this map: 17 squares as far apart as a card lets them be, every one at the Lift, the longest caption, an answer, the longest page name
    let worst = 0, worstAny = 0;
    for (let i = 0; i < 400; i++) {
      const cells = [0, 15, 240, 255, ...rnd.shuffle(Array.from({ length: 252 }, (_, k) => k + (k >= 14 ? (k >= 238 ? 3 : 2) : 1)).filter((c) => ![0, 15, 240, 255].includes(c))).slice(0, 13)].sort((a, b) => a - b);
      const squares = cells.map((c) => ({ ix: -68 + (c % 16), iz: -78 + Math.floor(c / 16), stage: 4 }));
      const card = { v: 1, map: 0, ix: squares[16].ix, iz: squares[16].iz, crew: 5, at: L.linkTune.atMost, caption: randCaption(L, rnd, 40).padEnd(40, 'W').slice(0, 40).replace(/ $/, 'W').replace(/^ /, 'W').replace(/ {2}/g, ' W'), body: { form: 'squares', squares, order: randOrder(squares, rnd), answers: 2 ** 30 - 1, score: null } };
      const e = L.encode(card);
      need(e.ok, `a worst 17: ${e.why}`);
      worst = Math.max(worst, keep(L.cardUrl(ORIGIN, 'w'.repeat(48), 99, e.text)).length);
    }
    for (let i = 0; i < 200; i++) {
      const squares = randSquares(rnd, 32, 16, -32768, -32768).map((q) => ({ ...q, stage: 4 }));
      squares[0].ix = -32768;
      const all = [...new Map([{ ix: -32768, iz: -32768, stage: 4 }, { ix: -32753, iz: -32753, stage: 4 }, ...squares].map((q) => [q.iz * 65536 + q.ix, q])).values()].sort((a, b) => a.iz - b.iz || a.ix - b.ix).slice(0, 32);
      if (!all.some((q) => q.ix === -32753 && q.iz === -32753)) all[31] = { ix: -32753, iz: -32753, stage: 4 };
      all.sort((a, b) => a.iz - b.iz || a.ix - b.ix);
      const card = { v: 1, map: 4095, ix: all[0].ix, iz: all[0].iz, crew: 5, at: L.linkTune.atMost, caption: 'W'.repeat(40), body: { form: 'squares', squares: all, order: randOrder(all, rnd), answers: 2 ** 30 - 1, score: { budget: 255, used: 255 } } };
      const e = L.encode(card);
      need(e.ok, `the longest card: ${e.why}`);
      worstAny = Math.max(worstAny, keep(L.cardUrl(ORIGIN, 'w'.repeat(48), 99, e.text)).length);
    }
    need(usualUrl.length < 2000 && worst < 2000 && worstAny < 2000, `an address of ${Math.max(usualUrl.length, worst, worstAny)} characters`);
    return `a 17-square place's whole address is ${usualUrl.length} characters as it is usually sent and ${worst} at its worst (limit 2,000); the longest any card can make is ${worstAny}`;
  });

  await row('golden', () => {
    // one card for each count, made the same way every time: a later change that moves a single bit of the format moves these
    const fixed = (n) => {
      const squares = Array.from({ length: n }, (_, i) => ({ ix: -10 + (i % 6), iz: 20 + Math.floor(i / 6), stage: 1 + (i % 4) }));
      return { v: 1, map: 0, ix: -10, iz: 20, crew: 1 + (n % 5), at: 460000 + n, caption: `GOLDEN ${n}`, body: { form: 'squares', squares, order: L.defaultOrder(squares, -10, 20), answers: null, score: null } };
    };
    const made = { crc15: String(L.crc(A, 15, 0x4599)), crc30: String(L.crc(A, 30, 0x2030b9c7)) };
    for (const n of [1, 2, 3, 4, 5, 8, 9, 16, 17, 32]) made[`squares ${n}`] = L.encode(fixed(n)).text;
    made.spot = L.encode({ v: 1, map: 0, ix: -3, iz: 14, crew: 2, at: 459000, caption: 'GUERRERO ST & 24TH ST', body: null }).text;
    made.mark = L.encode({ v: 1, map: 0, ix: -41, iz: -34, crew: 1, at: 459000, caption: 'GOLDEN GATE BRIDGE', body: { form: 'mark', key: 'GGB', stage: 4, answers: null } }).text;
    if (process.argv.includes('--print-golden')) console.log(JSON.stringify(made, null, 2));
    const bad = Object.keys(GOLDEN).filter((k) => GOLDEN[k] !== made[k]);
    need(Object.keys(made).length === Object.keys(GOLDEN).length && !bad.length, () => `moved: ${bad.join(', ') || 'the list'} (${bad.length ? `${bad[0]} is now ${made[bad[0]]}` : ''})`);
    for (const k of Object.keys(GOLDEN)) if (k.startsWith('s') || k === 'mark') keep(`${ORIGIN}/p/sf/0#${GOLDEN[k]}`);
    const told = [L.explain(`${ORIGIN}/p/mission/3#${GOLDEN['squares 2']}`), L.explain(`${ORIGIN}/p/ggb/0#${GOLDEN.mark}`), L.explain(`${ORIGIN}/s/tt1#${GOLDEN['squares 3'].slice(0, -4)}`), L.explain(`${ORIGIN}/p/mission/0#junk`)].join('\n--\n');
    if (process.argv.includes('--print-golden')) console.log(`explain: ${JSON.stringify(told)}`);
    need(process.argv.includes('--print-golden') || told === EXPLAINED, () => `explain's words moved: ${JSON.stringify(told)}`);
    return `${Object.keys(GOLDEN).length} pinned texts still come out bit for bit: the two checks' test values, cards of 1, 2, 3, 4, 5, 8, 9, 16, 17 and 32 squares, a place alone and a landmark`;
  });

  await row('mangle', () => {
    const rnd = dice(3);
    const into = (t, what) => {
      const at = rnd.int(1, t.length - 1);
      return t.slice(0, at) + what + t.slice(at);
    };
    const ways = {
      'in capitals': (p, t) => `${p}#${t.toUpperCase()}`,
      'O, I and L typed for 0 and 1': (p, t) => `${p}#${t.replace(/0/g, () => rnd.pick(['O', 'o', '0'])).replace(/1/g, () => rnd.pick(['I', 'i', 'L', 'l', '1']))}`,
      'a line broken inside it': (p, t) => `${p}#${into(t, rnd.pick(['\n', '\r\n', '\n  ', ' ']))}`,
      'a line broken in three places': (p, t) => `${p}#${into(into(into(t, '\n'), '\r\n> '.replace('>', '')), '\t')}`,
      '%20 put inside it': (p, t) => `${p}#${into(t, rnd.pick(['%20', '%0A', '%0d%0a', '%09']))}`,
      'a soft break inside it': (p, t) => `${p}#${into(t, rnd.pick(['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad']))}`,
      'words after it': (p, t) => `${p}#${t} ${rnd.pick(['check this out', 'look!!', 'Sent from my iPhone', '— P', '(see you there)'])}`,
      'a full stop after it': (p, t) => `${p}#${t}${rnd.pick(['.', ',', ')', '>', '"', '!', '?'])}`,
      'a tracker after it': (p, t) => `${p}#${t}${rnd.pick(['?fbclid=IwAR0x', '&utm_source=ig', '?igshid=abc123', '#extra'])}`,
      'a tracker before it': (p, t) => `${p}?${rnd.pick(['fbclid=IwAR0x', 'utm_source=ig&utm_medium=social', 'igshid=MzRlODBiNWFlZA=='])}#${t}`,
      'two # in front': (p, t) => `${p}##${t}`,
      'its # escaped': (p, t) => `${p}%23${t}`,
      'its # escaped twice': (p, t) => `${p}%2523${t}`,
      'its # escaped, behind a tracker': (p, t) => `${p}?fbclid=IwAR0x%23${t}`,
      'a no-break space inside it': (p, t) => `${p}#${into(t, '\u00a0')}`,
      'a thin, a line or a wide space inside it': (p, t) => `${p}#${into(t, rnd.pick(['\u2009', '\u2028', '\u3000', '\u202f', '\u2029']))}`,
      'its # escaped twice, behind a tracker': (p, t) => `${p}?fbclid=IwAR0x%2523${t}`,
      'junk escaped into the path, the card after the real #': (p, t) => `${p}%23junk#${t}`,
      'a # that holds no card, the card escaped into the path': (p, t) => `${p}%23${t}#extra`,
      'a # that holds no card, the card escaped into the query': (p, t) => `${p}?a=1%23${t}#top`,
      'a bad escape beside an escaped card': (p, t) => `${p}?x=%zz&y=%E0%A4%A%23${t}`,
      'a bad escape in the path of an escaped card': (p, t) => `${p}%zz%23${t}`,
      'no page in front': (_, t) => `${ORIGIN}/#${t}`,
      'the path in capitals': (p, t) => `${p.replace('/p/', '/P/').toUpperCase().replace('HTTPS://STRUGGLE-BUS-WORLD.VERCEL.APP', ORIGIN)}#${t}`,
    };
    const names = Object.keys(ways), tally = Object.fromEntries(names.map((n) => [n, 0]));
    for (let i = 0; i < 2000; i++) {
      const card = randCard(L, rnd), e = L.encode(card);
      for (const name of names) {
        const href = keep(ways[name](`${ORIGIN}/p/mission-dolores/${i % 100}`, e.text));
        keep(new URL(href).href);
        for (const [how, parts] of [['as text', split(href)], ['as a page gets it', asPage(href)]]) {
          const v = L.parseLocation(...parts);
          need(v.kind === 'card' && v.link.level === 'full' && v.link.canon === e.text, () => `${name}, ${how}: card ${i} read as '${v.link.level}' (${v.link.why}) from ${JSON.stringify(href)}`);
          if (name !== 'no page in front' && name !== 'the path in capitals') need(v.place === 'mission-dolores' && v.gen === i % 100, () => `${name}, ${how}: the page read as ${v.place}/${v.gen} from ${JSON.stringify(href)}`);
        }
        tally[name]++;
      }
    }
    return `2,000 cards bent ${names.length} ways each, read both as the text stands and as a page gets it from a browser's own URL parser (${names.join('; ')}): all the same whole card`;
  });

  await row('ladder', () => {
    const rnd = dice(4);
    let cuts = 0;
    for (let i = 0; i < 1500; i++) {
      const card = randCard(L, rnd, i % 5 === 0 ? 'mark' : i % 7 === 0 ? 'spot' : 'squares'), e = L.encode(card), sec = sections(e.text);
      const headEnd = sec[0][1], coreEnd = sec.length > 1 ? sec[1][1] : -1, full = e.text.length;
      for (let len = 0; len <= full; len++) {
        const d = L.decode(keep(`${ORIGIN}/p/x/0#${e.text.slice(0, len)}`).split('#')[1]);
        const want = len >= full ? 'full' : coreEnd > 0 && len >= coreEnd ? 'core' : len >= headEnd ? 'head' : 'none';
        need(d.level === want, () => `card ${i} cut to ${len} of ${full} read as '${d.level}', not '${want}'`);
        if (want === 'none') need(d.card === null && d.id === '', `card ${i} cut to ${len}: something read from nothing`);
        else need(headOf(d.card) === headOf(card), `card ${i} cut to ${len}: another head`);
        if (want === 'head') need(d.card.body === null && d.id === '' && d.why === 'cut short', `card ${i} cut to ${len}: a head with a body or an id (${d.why})`);
        if (want === 'core') need(coreOf(d.card) === coreOf(card) && d.id === e.id && d.id30 === e.id30 && same(d.card.body.order) === same(L.defaultOrder(card.body.squares, card.ix, card.iz)), `card ${i} cut to ${len}: its squares, its id or its stand-in order`);
        cuts++;
      }
    }
    return `1,500 cards cut at every length (${cuts.toLocaleString('en')} cuts): each reads as exactly what it still holds, whole, squares with a stand-in order, place alone, or nothing`;
  });

  await row('damage', () => {
    const rnd = dice(5), other = (c) => {
      let n;
      do n = rnd.pick([...A]);
      while (n === c);
      return n;
    };
    const kinds = ['one character', 'three neighbours', 'six neighbours', 'a length character', 'three neighbours across a length', 'one dropped', 'one added', 'two swapped', 'a run doubled'];
    const tries = Object.fromEntries(kinds.map((k) => [k, 0])), slips = Object.fromEntries(kinds.map((k) => [k, { head: 0, core: 0, full: 0 }]));
    let lower = 0, none = 0;
    for (let i = 0; i < 4000; i++) {
      const card = randCard(L, rnd, i % 4 === 0 ? undefined : 'squares'), e = L.encode(card), t = e.text, sec = sections(t), lens = new Set(sec.flatMap((s) => [s[0], s[0] + 1]));
      for (let j = 0; j < 40; j++) {
        const kind = kinds[j % kinds.length];
        let at = rnd.int(1, t.length - 1), bent;
        if (kind === 'one character' || kind === 'three neighbours' || kind === 'six neighbours') {
          const n = kind === 'one character' ? 1 : kind === 'three neighbours' ? 3 : 6;
          for (let guard = 0; guard < 50 && [...Array(n).keys()].some((k) => lens.has(at + k)); guard++) at = rnd.int(1, t.length - 1);
          if ([...Array(n).keys()].some((k) => lens.has(at + k))) continue;
          const part = [...t.slice(at, at + n)];
          part[0] = other(part[0]);
          for (let k = 1; k < part.length; k++) if (rnd() < 0.7) part[k] = rnd.pick([...A]);
          bent = t.slice(0, at) + part.join('') + t.slice(at + n);
        } else if (kind === 'a length character') {
          at = rnd.pick([...lens]);
          bent = t.slice(0, at) + other(t[at]) + t.slice(at + 1);
        } else if (kind === 'three neighbours across a length') {
          at = Math.max(1, Math.min(t.length - 3, rnd.pick([...lens]) - rnd.int(0, 2)));
          const part = [...t.slice(at, at + 3)].map((c) => (rnd() < 0.8 ? other(c) : c));
          bent = t.slice(0, at) + part.join('') + t.slice(at + 3);
        } else if (kind === 'one dropped') bent = t.slice(0, at) + t.slice(at + 1);
        else if (kind === 'one added') bent = t.slice(0, at) + rnd.pick([...A]) + t.slice(at);
        else if (kind === 'two swapped') {
          if (at + 1 >= t.length || t[at] === t[at + 1]) continue;
          bent = t.slice(0, at) + t[at + 1] + t[at] + t.slice(at + 2);
        } else {
          const n = rnd.int(1, 6);
          bent = t.slice(0, at) + t.slice(at, at + n) + t.slice(at);
        }
        if (bent === t) continue;
        tries[kind]++;
        const d = L.decode(keep(`${ORIGIN}/p/x/0#${bent}`).split('#')[1]);
        if (d.level === 'none') none++;
        else if (headOf(d.card) !== headOf(card)) slips[kind].head++;
        else if (d.level === 'core' && (!card.body || card.body.form !== 'squares' || coreOf(d.card) !== coreOf(card) || d.id !== e.id)) slips[kind].core++;
        else if (d.level === 'full' && same(d.card) !== same(card)) slips[kind].full++;
        else if (d.level !== 'full') lower++;
      }
    }
    const total = Object.values(tries).reduce((a, b) => a + b, 0);
    // (what the checks promise outright: damage that fits in three neighbouring characters never reads as another card at any level, and in six never as other squares)
    for (const k of ['one character', 'three neighbours']) need(slips[k].head + slips[k].core + slips[k].full === 0, () => `${k}: read as another card ${same(slips[k])}`);
    for (const k of kinds) need(slips[k].core + slips[k].full === 0, () => `${k}: read as other squares ${same(slips[k])}`);
    const loose = kinds.filter((k) => slips[k].head).map((k) => `${k} ${slips[k].head} of ${tries[k].toLocaleString('en')}`);
    return `${total.toLocaleString('en')} damaged cards: none read as other squares or another whole card; ${none.toLocaleString('en')} read as nothing and ${lower.toLocaleString('en')} as a true lower level. Damage of one to three neighbouring characters that leaves a section's two length characters alone was caught every time, as promised. Damage that is wider, or on a length character, and left a head reading as another place (a 15-bit check's luck): ${loose.length ? loose.join(', ') : `none in ${kinds.filter((k) => k !== 'one character' && k !== 'three neighbours').map((k) => `${tries[k].toLocaleString('en')} of ${k}`).join(', ')}`}`;
  });

  await row('total', () => {
    const rnd = dice(6), W = L.forTests.Writer, tally = { none: 0, head: 0, core: 0, full: 0 };
    const hold = (text, what) => {
      let d;
      try {
        d = L.decode(text);
      } catch (e) {
        throw new Error(`${what}: decode threw ${e.message} on ${JSON.stringify(text.slice(0, 120))}`);
      }
      tally[d.level]++;
      if (!d.card) return need(d.level === 'none' && d.id === '' && d.id30 === -1, `${what}: nothing read, yet not 'none'`);
      const again = L.decode(d.canon);
      need(again.level === d.level && same(again.card) === same(d.card), () => `${what}: its own text read differently the second time: ${JSON.stringify(text)}`);
      if (d.level === 'head') return need(d.card.body === null && d.id === '', `${what}: a head with a body`);
      const fault = L.cardFault(d.card);
      need(fault === '', () => `${what}: read a card that can't be written (${fault}): ${JSON.stringify(text)}`);
      const e = L.encode(d.card);
      // (one text a card: whatever reads whole is exactly what this build would have written, unless a later build's block was passed over)
      if (!d.skipped.length) need(d.level === 'full' ? e.text === d.canon : e.id === d.id, () => `${what}: reads whole, but is not the text this card is written as: ${JSON.stringify(text)}`);
      need(e.id30 === d.id30 || d.skipped.length > 0, `${what}: its short id moved`);
    };
    const bitsText = (n) => {
      const w = new W();
      for (let i = 0; i < n; i++) w.u(rnd() < 0.5 ? 1 : 0, 1);
      return w;
    };
    for (let i = 0; i < 100000; i++) {
      let s = '1';
      for (let n = rnd.int(0, 300); n > 0; n--) s += A[rnd.int(0, 31)];
      hold(s, 'random characters');
    }
    for (let i = 0; i < 50000; i++) {
      let s = '';
      for (let n = rnd.int(0, 200); n > 0; n--) s += String.fromCharCode(rnd() < 0.9 ? rnd.int(32, 126) : rnd.int(0, 0x2100));
      hold(s, 'random text');
    }
    // sections with a right check round random bits: past the checks, into the reader itself
    for (let i = 0; i < 100000; i++) {
      let s = L.forTests.section('1', bitsText(rnd.int(0, 340)), 3);
      if (rnd() < 0.7) s = L.forTests.section(s, bitsText(rnd.int(0, 420)), 6);
      if (rnd() < 0.5) s = L.forTests.section(s, bitsText(rnd.int(0, 660)), 3);
      hold(s, 'random bits behind right checks');
    }
    // and real cards with a few bits turned and every check made right again
    let turned = 0;
    for (let i = 0; i < 150000; i++) {
      const e = L.encode(randCard(L, rnd)), sec = sections(e.text);
      let s = '1';
      sec.forEach(([from, end], k) => {
        const width = k === 1 ? 6 : 3, payload = [...e.text.slice(from + 2, end - width)];
        for (let f = rnd.int(0, 3); f > 0 && payload.length; f--) {
          const at = rnd.int(0, payload.length - 1);
          payload[at] = A[A.indexOf(payload[at]) ^ (1 << rnd.int(0, 4))];
          turned++;
        }
        const body = payload.join('');
        s += A[body.length >> 5] + A[body.length & 31] + body;
        s += L.forTests.checkOf(s, width);
      });
      hold(keep(`${ORIGIN}/p/x/0#${s}`).split('#')[1], 'a card with bits turned and its checks made right');
    }
    return `400,000 texts that are no honest card (random characters, random text, random bits behind right checks, real cards with ${turned.toLocaleString('en')} bits turned and re-checked): none threw; read as nothing ${tally.none.toLocaleString('en')}, a head ${tally.head.toLocaleString('en')}, squares ${tally.core.toLocaleString('en')}, whole ${tally.full.toLocaleString('en')}; every one that read whole is exactly the text its card is written as`;
  });

  await row('blocks', () => {
    const { Writer: W, section, writeBlocks, bitsOf, CAPV } = L.forTests;
    const head = (blocks, parts = 0, crew = 3, cap = 'HAYES ST') => {
      const h = new W();
      h.u(0, 2), h.u(parts, 2), h.u(crew, 4), h.uv(0), h.zz(-7), h.zz(9), h.u(460000, 25), h.u(cap.length, 6);
      for (const c of cap) h.u(CAPV.get(c) ?? c, 6);
      writeBlocks(h, blocks);
      return section('1', h, 3);
    };
    const core = (before, blocks) => {
      const c = new W();
      c.u(0, 4), c.u(0, 4), c.u(0, 4), c.u(0, 4), c.u(1, 1), c.u(2, 2);
      writeBlocks(c, blocks);
      return section(before, c, 6);
    };
    const tail = (before, blocks = []) => {
      const t = new W();
      writeBlocks(t, blocks);
      return section(before, t, 3);
    };
    const some = bitsOf((w) => w.u(0x155, 9));
    let d = L.decode(head([[5, some]]));
    need(d.level === 'full' && same(d.skipped) === '[5]' && d.card.caption === 'HAYES ST', `a block a later build may add to the head (tag 5): ${d.level}`);
    need(L.decode(head([[20, some]])).level === 'none', 'a block this build must understand, in the head, was passed over');
    need(L.decode(head([[5, some], [3, some]])).level === 'none', 'blocks out of order were read');
    need(L.decode(head([[5, some], [5, some]])).level === 'none', 'a block given twice was read');
    d = L.decode(tail(core(head([], 2), [[7, some]])));
    need(d.level === 'full' && same(d.skipped) === '[7]' && d.card.body.squares[0].stage === 3, `a block a later build may add to the core (tag 7): ${d.level}`);
    d = L.decode(tail(core(head([], 2), [[21, some]])));
    need(d.level === 'head' && d.card.body === null, `a block this build must understand, in the core, did not hold the card to its head: ${d.level}`);
    d = L.decode(tail(core(head([], 2), []), [[9, some]]));
    need(d.level === 'full' && same(d.skipped) === '[9]', `a block a later build may add to the tail: ${d.level}`);
    d = L.decode(tail(core(head([], 2), []), [[30, some]]));
    need(d.level === 'core', `a block this build must understand, in the tail, did not hold the card to its squares: ${d.level}`);
    d = L.decode(tail(core(head([], 2), [[1, bitsOf((w) => w.u(123456, 30))], [16, bitsOf((w) => (w.u(60, 8), w.u(41, 8)))]])));
    need(d.level === 'full' && d.card.body.answers === 123456 && d.card.body.score.used === 41, 'the two blocks this build knows (an answer, a score)');
    need(L.decode(tail(core(head([], 2), [[1, bitsOf((w) => w.u(1, 29))]]))).level === 'head', 'an answer of the wrong size was read');
    // a later build's crew, kind of card and format
    d = L.decode(head([], 0, 9));
    need(d.level === 'head' && d.card.crew === 9 && d.id === '', `a sixth crew's place: ${d.level}`);
    d = L.decode(tail(core(head([], 2, 12), [])));
    need(d.level === 'head' && d.card.body === null, `a sixth crew's squares were landed: ${d.level}`);
    const h3 = new W();
    h3.u(3, 2), h3.u(1, 2), h3.u(2, 4), h3.uv(0), h3.zz(1), h3.zz(1), h3.u(5, 25), h3.u(0, 6);
    d = L.decode(section('1', h3, 3) + 'zzzzzzzzzz');
    need(d.level === 'head' && d.why === 'a newer kind of card', `a later build's kind of card: ${d.level} ${d.why}`);
    need(L.decode('2' + head([]).slice(1)).why === 'a newer format' && L.decode('2' + head([]).slice(1)).level === 'none', 'a later format was read');
    // the six characters kept back from captions, and the rest of what a caption may not be
    for (const code of [40, 41, 42, 43, 44, 45]) need(L.decode(head([], 0, 3, [22, 22, 22, code, 4, 21, 8, 11])).level === 'none', `caption code ${code} was read`);
    for (const cap of [' A', 'A ', 'A  B']) need(L.decode(head([], 0, 3, cap)).level === 'none', `the caption ${JSON.stringify(cap)} was read`);
    need(![...L.CAPTION].some((c) => './,:;!?#@%\\<>"()[]{}=+*_~|^$`'.includes(c)), 'the caption table can spell an address');
    // padding: a card is one text
    const h = new W();
    h.u(0, 2), h.u(0, 2), h.u(3, 4), h.uv(0), h.zz(-7), h.zz(9), h.u(460000, 25), h.u(0, 6);
    const tight = section('1', h, 3);
    for (let i = 0; i < 5; i++) h.u(0, 1);
    need(L.decode(tight).level === 'full' && L.decode(section('1', h, 3)).level === 'none', 'a head padded longer than it need be was read');
    const long = new W();
    long.u(0, 2), long.u(0, 2), long.u(3, 4), long.u(1, 1), long.u(0, 4), long.u(0, 1), long.u(0, 4), long.zz(-7), long.zz(9), long.u(460000, 25), long.u(0, 6);
    need(L.decode(section('1', long, 3)).level === 'none', 'a number written longer than it need be was read');
    return 'hand-made cards: blocks a later build may add are passed over (and said), ones this build must understand hold the card back a level, as do a sixth crew and a later kind of card; a later format reads as nothing; the six caption codes kept back, loose spaces, loose padding and long-written numbers are all refused';
  });

  await row('caption', () => {
    const rnd = dice(7), pool = "abcXYZ 0189.,/:;!?#@&'’-–—_()éÈñüßøÅçîõ\u200b\n\t漢字🚌&&  +";
    let made = 0, empty = 0;
    for (let i = 0; i < 50000; i++) {
      let s = '';
      for (let n = rnd.int(0, 70); n > 0; n--) s += rnd() < 0.9 ? rnd.pick([...pool]) : String.fromCodePoint(rnd.int(0, 0x2fff));
      const c = L.captionFrom(i % 500 === 0 ? [undefined, null, 5, {}, ''][(i / 500) % 5] : s);
      need(L.captionOk(c), () => `captionFrom(${JSON.stringify(s)}) gave ${JSON.stringify(c)}, which no card can carry`);
      need(!/[./:@#?!,]/.test(c), `a caption with an address's marks: ${c}`);
      made++;
      if (!c) empty++;
    }
    const said = [['Martin Luther King Jr Dr & John F Kennedy Dr', 'MARTIN LUTHER KING JR & JOHN F KENNEDY'], ['Guerrero St & 24th St', 'GUERRERO ST & 24TH ST'], ["O'Farrell St", "O'FARRELL ST"], ['www.evil.com/free', 'WWW EVIL COM FREE'], ['Café Düsseldorf + Ñandú', 'CAFÉ DÜSSELDORF & ÑANDÚ'], ['  spaced   out  ', 'SPACED OUT']];
    said.push(['Guerrero St &', 'GUERRERO ST'], ['& Valencia &', 'VALENCIA'], ['Reka Lodz'.replace('R', '\u0158').replace('L', '\u0141').replace('o', '\u00f3').replace('z', '\u017a'), 'REKA L\u00d3DZ'], ['Stra\u00dfe', 'STRASSE'], ['Dolores+Park', 'DOLORES & PARK']);
    for (const long of ['A VERY LONG NAME OF A PARK THAT RUNS ON THE & X', 'SAN FRANCISCO MARITIME NATIONAL PARK & AQUATIC', 'W'.repeat(60), 'AB '.repeat(30) + '&']) {
      const c = L.captionFrom(long);
      need(c.length <= 40 && c.length >= 20 && !c.endsWith('&') && !c.endsWith(' ') && long.startsWith(c.replace(/ &$/, '')), `captionFrom(${JSON.stringify(long)}) gave ${JSON.stringify(c)}`);
    }
    for (const [from, want] of said) need(L.captionFrom(from) === want, () => `captionFrom(${JSON.stringify(from)}) is ${JSON.stringify(L.captionFrom(from))}, not ${JSON.stringify(want)}`);
    return `${made.toLocaleString('en')} random strings as captions: every one fits a card (40 characters, the table's letters, no address's marks; ${empty.toLocaleString('en')} came out empty), and ${said.length} said ones read as expected ("${said[0][0]}" is "${said[0][1]}")`;
  });

  await row('path', () => {
    const t = GOLDEN.spot, P = (href) => L.parseLocation(...split(href));
    const cases = [
      [`${ORIGIN}/`, 'door', '', 0, ''], [`${ORIGIN}/index.html`, 'door', '', 0, ''], [`${ORIGIN}/?moonland&fps`, 'door', '', 0, ''],
      [`${ORIGIN}/p/mission-dolores/3`, 'place', 'mission-dolores', 3, ''], [`${ORIGIN}/p/mission-dolores`, 'place', 'mission-dolores', 0, ''], [`${ORIGIN}/p/mission-dolores/`, 'place', 'mission-dolores', 0, ''],
      [`${ORIGIN}/p/mission-dolores/007`, 'place', 'mission-dolores', 7, ''], [`${ORIGIN}/p/mission-dolores/250`, 'place', 'mission-dolores', 99, ''], [`${ORIGIN}/p/mission-dolores/x`, 'place', 'mission-dolores', 0, ''],
      [`${ORIGIN}/p/Mission-Dolores/3.`, 'place', 'mission-dolores', 3, ''], [`${ORIGIN}/p/mission-dolores/3)`, 'place', 'mission-dolores', 3, ''], [`${ORIGIN}/p/mission--dolores/3`, 'door', '', 0, ''],
      [`${ORIGIN}/p/-mission/3`, 'door', '', 0, ''], [`${ORIGIN}/p/${'a'.repeat(49)}/3`, 'door', '', 0, ''], [`${ORIGIN}/p/${'a'.repeat(48)}/3`, 'place', 'a'.repeat(48), 3, ''],
      [`${ORIGIN}/p/%2e%2e/3`, 'door', '', 0, ''], [`${ORIGIN}/p/mission%2Fdolores/3`, 'place', 'mission', 0, ''], [`${ORIGIN}/p/<script>/3`, 'door', '', 0, ''],
      [`${ORIGIN}/s/tt1`, 'source', '', 0, 'tt1'], [`${ORIGIN}/s/TikTok-Bio`, 'source', '', 0, 'tiktok-bio'], [`${ORIGIN}/s/${'a'.repeat(17)}`, 'door', '', 0, ''], [`${ORIGIN}/s/`, 'door', '', 0, ''],
      [`${ORIGIN}/p/mission-dolores/3#${t}`, 'card', 'mission-dolores', 3, ''], [`${ORIGIN}/s/tt1#${t}`, 'card', '', 0, 'tt1'], [`${ORIGIN}/#${t}`, 'card', '', 0, ''],
      [`${ORIGIN}/p/mission-dolores/3#garbage`, 'place', 'mission-dolores', 3, ''], [`${ORIGIN}/p/mission-dolores/3#${t.slice(0, 20)}`, 'place', 'mission-dolores', 3, ''],
      [`${ORIGIN}/p/mission-dolores/3%23${t}`, 'card', 'mission-dolores', 3, ''], [`${ORIGIN}/p/mission-dolores/3%2523${t}`, 'card', 'mission-dolores', 3, ''], [`${ORIGIN}/p/mission-dolores/3%25`, 'place', 'mission-dolores', 3, ''],
    ];
    for (const [href, kind, place, gen, tag] of cases) {
      const v = P(keep(href));
      need(v.kind === kind && v.place === place && v.gen === gen && v.tag === tag, () => `${href.replace(ORIGIN, '')} read as ${v.kind} ${v.place}/${v.gen} ${v.tag}, not ${kind} ${place}/${gen} ${tag}`);
    }
    // where the path and the card disagree, the card is where the bus lands: the path is only ever the fallback
    const v = P(`${ORIGIN}/p/sunset/5#${t}`);
    need(v.kind === 'card' && v.link.card.ix === -3 && v.place === 'sunset', 'a card under another page name');
    for (const junk of [undefined, null, 5, {}, [], '\ud800', '%', '%%%', '%E0%A4%A', '#', '##', '?', '/p', '/p/', '/p//', '//p/x/1']) {
      for (const args of [[junk, junk, junk], ['/p/x/1', junk, junk], [junk, '', `#${t}`]]) L.parseLocation(...args);
    }
    const slugs = [["Fisherman's Wharf", 'fishermans-wharf'], ['Tenderloin / Little Saigon', 'tenderloin-little-saigon'], ['Mission Dolores', 'mission-dolores'], ['Noe Valley', 'noe-valley'], ['Café Düsseldorf', 'cafe-dusseldorf'], ['Bayview & Hunters Point', 'bayview-and-hunters-point'], ['  ', ''], ['ggb', 'ggb'], ['24th St. Mission', '24th-st-mission']];
    for (const [name, want] of slugs) need(L.slugOf(name) === want, () => `slugOf(${JSON.stringify(name)}) is ${JSON.stringify(L.slugOf(name))}, not ${JSON.stringify(want)}`);
    const rnd = dice(8);
    for (let i = 0; i < 20000; i++) {
      let s = '';
      for (let n = rnd.int(0, 80); n > 0; n--) s += rnd() < 0.8 ? rnd.pick([..."abc XYZ-'&/09é"]) : String.fromCodePoint(rnd.int(0, 0x3000));
      const slug = L.slugOf(s);
      need(slug === '' || (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 48), () => `slugOf(${JSON.stringify(s)}) is ${JSON.stringify(slug)}`);
      if (slug) need(P(`${ORIGIN}/p/${slug}/1`).place === slug, `the page name ${slug} did not read back from its own path`);
    }
    for (const [place, gen, want] of [['', 0, '/p/sf/0#'], ['Noe Valley', 3, '/p/sf/3#'], ['a'.repeat(49), 3, '/p/sf/3#'], ['noe-valley', -1, '/p/noe-valley/0#'], ['noe-valley', 100, '/p/noe-valley/99#'], ['noe-valley', 2.5, '/p/noe-valley/0#'], ['noe-valley', 7, '/p/noe-valley/7#'], [null, NaN, '/p/sf/0#'], ['a'.repeat(48), 99, `/p/${'a'.repeat(48)}/99#`]])
      need(L.cardUrl(ORIGIN, place, gen, t) === ORIGIN + want + t, () => `cardUrl(${JSON.stringify(place)}, ${gen}) is ${L.cardUrl(ORIGIN, place, gen, t).replace(ORIGIN, '').slice(0, 60)}`);
    const dealt = new Set();
    for (let i = 0; i < 5000; i++) {
      const id = rnd.int(0, 2 ** 30 - 1), sender = rnd.int(1, 5), crew = L.dealCrew(id, sender);
      need(crew >= 1 && crew <= 5 && crew !== sender && crew === L.dealCrew(id, sender), `card ${id} from crew ${sender} dealt ${crew}`);
      dealt.add(`${sender}>${crew}`);
      const worn = L.wornBy(sender, crew);
      need(worn === sender && L.wornBy(sender, sender) !== sender && L.wornBy(sender, sender) >= 1 && L.wornBy(sender, sender) <= 5, 'the wheel');
    }
    need(dealt.size === 20, `only ${dealt.size} of the 20 deals ever came up`);
    return `${cases.length} addresses read as the right kind, page, generation and source; nonsense for an address never throws; 20,000 random names make page names that read back from their own path; a dealt crew is never the sender's, the same every time, and all 20 deals come up`;
  });

  await row('refuse', () => {
    const base = () => ({ v: 1, map: 0, ix: -3, iz: 14, crew: 2, at: 459000, caption: 'HAYES ST', body: { form: 'squares', squares: [{ ix: -3, iz: 14, stage: 2 }, { ix: -2, iz: 14, stage: 1 }], order: [0, 1, 0], answers: null, score: null } });
    const mark = (c) => (c.body = { form: 'mark', key: 'GGB', stage: 4, answers: null });
    const many = Array.from({ length: 33 }, (_, i) => ({ ix: -3 + (i % 8), iz: 14 + Math.floor(i / 8), stage: 1 }));
    const cases = [
      ['version', (c) => (c.v = 2)], ['map', (c) => (c.map = 4096)], ['map', (c) => (c.map = -1)], ['map', (c) => (c.map = 1.5)], ['square', (c) => (c.ix = 32768)], ['square', (c) => (c.iz = -32769)], ['square', (c) => (c.ix = '3')],
      ['crew', (c) => (c.crew = 0)], ['crew', (c) => (c.crew = 6)], ['crew', (c) => (c.crew = 15)], ['minute', (c) => (c.at = -1)], ['minute', (c) => (c.at = 2 ** 25)], ['minute', (c) => (c.at = 0.5)],
      ['caption', (c) => (c.caption = 'hayes st')], ['caption', (c) => (c.caption = 'W'.repeat(41))], ['caption', (c) => (c.caption = ' A')], ['caption', (c) => (c.caption = 'A ')], ['caption', (c) => (c.caption = 'A  B')], ['caption', (c) => (c.caption = 'A.B')], ['caption', (c) => (c.caption = 5)],
      ['body', (c) => (c.body = 5)], ['body', (c) => (c.body = undefined)], ['answers', (c) => (c.body.answers = 2 ** 30)], ['answers', (c) => (c.body.answers = -1)], ['answers', (c) => (mark(c), (c.body.answers = 1.5))], ['form', (c) => (c.body.form = 'other')],
      ['count', (c) => (c.body.squares = [])], ['count', (c) => (c.body.squares = many)], ['a square', (c) => (c.body.squares[1].stage = 0)], ['a square', (c) => (c.body.squares[1].stage = 5)], ['a square', (c) => (c.body.squares[1].ix = 40000)], ['a square', (c) => (c.body.squares[1] = null)],
      ['sorted', (c) => c.body.squares.reverse()], ['sorted', (c) => (c.body.squares[1] = { ix: -3, iz: 14, stage: 1 })], ['its own square', (c) => (c.ix = 5)], ['box', (c) => (c.body.squares[1].ix = 13)], ['box', (c) => (c.body.squares[1] = { ix: -3, iz: 30, stage: 1 })],
      ['order', (c) => (c.body.order = [0, 1])], ['order', (c) => (c.body.order = [0, 0, 1, 1])], ['order', (c) => (c.body.order = [0, 1, 2])], ['order', (c) => (c.body.order = [1, 1, 0])], ['order', (c) => (c.body.order = 'x')], ['order', (c) => (c.body.order = [0, 1, 0.5])],
      ['score', (c) => (c.body.score = { budget: 256, used: 0 })], ['score', (c) => (c.body.score = { budget: 1 })], ['score', (c) => (c.body.score = { budget: 3, used: -1 })],
      ['key', (c) => (mark(c), (c.body.key = 'ggb'))], ['key', (c) => (mark(c), (c.body.key = ''))], ['key', (c) => (mark(c), (c.body.key = 'A'.repeat(17)))], ['key', (c) => (mark(c), (c.body.key = 'PIER 39'))], ['stage', (c) => (mark(c), (c.body.stage = 0))], ['stage', (c) => (mark(c), (c.body.stage = 5))],
    ];
    for (const [why, bend] of cases) {
      const c = base();
      bend(c);
      const e = L.encode(c);
      need(!e.ok && e.why === why && L.cardFault(c) === why, () => `a card with a bad ${why} was ${e.ok ? `written as ${e.text}` : `refused for its ${e.why}`}: ${same(c)}`);
    }
    for (const junk of [null, undefined, 5, 'card', [], {}]) need(L.encode(junk).ok === false, `encode(${JSON.stringify(junk)}) wrote something`);
    const edges = [(c) => (c.map = 4095), (c) => ((c.ix = -32768), (c.body = null)), (c) => (c.crew = 5), (c) => (c.at = 2 ** 25 - 1), (c) => (c.caption = ''), (c) => (c.caption = 'W'.repeat(40)), (c) => (c.body.answers = 2 ** 30 - 1), (c) => (c.body.score = { budget: 255, used: 255 }), (c) => (c.body.squares[1].ix = 12), (c) => (mark(c), (c.body.key = 'A-1'))];
    for (const bend of edges) {
      const c = base();
      bend(c);
      const e = L.encode(c);
      need(e.ok && same(L.decode(e.text).card) === same(c), () => `a card at the edge of what one may say was refused or misread: ${same(c)}`);
    }
    return `${cases.length} cards that say what no card may (a crew of 0 or 6, a square off the grid, squares out of order or twice, a card without its own square, an order that is none, a box too wide, a caption with a full stop) are each refused, and for the right reason; ${edges.length} at the very edge of what one may say are written and read back`;
  });

  await row('speed', () => {
    const big = { 'a path of junk': 'p/' + '!'.repeat(1e6), 'a path of half-junk': '/p/x/' + '0!'.repeat(5e5), 'a card that never ends': '#1' + 'z'.repeat(1e6), 'percents': '%'.repeat(1e6), 'ampersands': '& '.repeat(5e5), 'a million words': 'AB '.repeat(3e5),
      'accents': 'e\u0301'.repeat(5e5), 'spaces': ' '.repeat(1e6), 'slashes': '/'.repeat(1e6), 'escaped hashes': '%2523x'.repeat(2e5), 'hashes': '#'.repeat(1e6), 'letters': 'x'.repeat(1e6), 'base64': 'A'.repeat(1e6), 'brackets': '['.repeat(1e6) };
    const fns = { parseLocation: (x) => (L.parseLocation(x, x, x), L.parseLocation(x, '', ''), L.parseLocation('', x, ''), L.parseLocation('', '', x)), sbwStamp: (x) => (stamp(x), stamp(`https://x.app/${x}`), stamp(`https://x.app/p/x/0?${x}`), stamp(`https://x.app/p/x/0#${x}`)),
      decode: L.decode, clean: L.clean, explain: L.explain, captionFrom: L.captionFrom, captionOk: L.captionOk, slugOf: L.slugOf, parseSave: (x) => L.parseSave(`SBW2\n${x}\n${x}\n${x}\n${x}\n${x}`), fromAreasText: L.fromAreasText };
    let worst = 0, where = '';
    for (const [fn, f] of Object.entries(fns))
      for (const [what, x] of Object.entries(big)) {
        const t0 = performance.now();
        f(x);
        const ms = performance.now() - t0;
        if (ms > worst) (worst = ms), (where = `${fn} on ${what}`);
      }
    need(worst < 500, `${where} took ${worst.toFixed(0)} ms on a megabyte`);
    return `${Object.keys(fns).length} readers on ${Object.keys(big).length} hostile megabytes each (junk paths, endless cards, a million words): none threw, and the slowest took ${worst.toFixed(0)} ms (${where})`;
  });

  await row('stamp', () => {
    // addresses of this row's own, so it holds when run alone: cards under every kind of path, and the path's own edges
    const rnd = dice(9), paths = ['/', '/p/mission-dolores/3', '/p/x/250', '/p/x/99', '/p/x/100', '/p/x/007', `/p/${'a'.repeat(48)}/1`, `/p/${'a'.repeat(49)}/1`, '/p/Mission/3.', '/p/mission--dolores/3', '/p/x/3/extra/more/yet', '/s/tt1', '/s/TikTok-Bio', '/p/x', '/p//3', '/index.html', '/p/x/12abc', '/p/x/-3'];
    for (let i = 0; i < 4000; i++) {
      const t = L.encode(randCard(L, rnd)).text, path = rnd.pick(paths);
      for (const href of [`${ORIGIN}${path}#${t}`, `${ORIGIN}${path}%23${t}`, `${ORIGIN}${path}%2523${t}`, `${ORIGIN}${path}?a=b%23${t}`, `${ORIGIN}${path}?a=b%2523${t}`, `${ORIGIN}${path}%23junk#${t}`, `${ORIGIN}${path}%23${t}#junk`, `${ORIGIN}${path}?q=%23${t}#junk`, `${ORIGIN}${path}%23${t}?after#`, `${ORIGIN}${path}#${t.slice(0, rnd.int(0, t.length))}`, `${ORIGIN}${path}?x=%zz%23${t}`, `${ORIGIN}${path}`]) keep(href);
    }
    // and heads of its own that no honest card has: bits turned with the check made right again, padding that is not zero, a crew of 0
    const { Writer: W, section, checkOf, CAPV } = L.forTests;
    for (let i = 0; i < 20000; i++) {
      const e = L.encode(randCard(L, rnd)), len = A.indexOf(e.text[1]) * 32 + A.indexOf(e.text[2]), payload = [...e.text.slice(3, 3 + len)];
      for (let f = rnd.int(1, 3); f > 0 && payload.length; f--) {
        const at = rnd.int(0, payload.length - 1);
        payload[at] = A[A.indexOf(payload[at]) ^ (1 << rnd.int(0, 4))];
      }
      const head = '1' + e.text.slice(1, 3) + payload.join('');
      keep(`${ORIGIN}/p/x/${i % 100}#${head + checkOf(head, 3)}${e.text.slice(3 + len + 3)}`);
    }
    for (const [crew, pad] of [[0, 0], [3, 1], [3, 3], [16, 0]]) {
      const h = new W();
      h.u(0, 2), h.u(0, 2), h.u(crew & 15, 4), h.uv(0), h.zz(-7), h.zz(9), h.u(460000, 25), h.u(5, 6);
      for (const c of 'HAYES') h.u(CAPV.get(c), 6);
      const t = section('1', h, 3), bits = (A.indexOf(t[t.length - 4]) & ~((1 << ((5 - (h.bits.length % 5)) % 5)) - 1)) | pad;
      const bent = t.slice(0, -4) + A[bits & 31];
      keep(`${ORIGIN}/p/x/0#${bent + checkOf(bent, 3)}`);
      keep(`${ORIGIN}/p/x/0#${t}`);
    }
    need(hrefs.length >= 40000, `the row has only ${hrefs.length} addresses`);
    let read = 0, blank = 0, pages = 0;
    const agree = (href, parts, how) => {
      const v = L.parseLocation(...parts);
      let s;
      try {
        s = stamp(href);
      } catch (e) {
        throw new Error(`stamp.js threw ${e.message} on ${JSON.stringify(href)}`);
      }
      if (v.link.level === 'none') {
        need(s === null, () => `stamp.js read a head where link.ts read nothing (${how}): ${JSON.stringify(href)}`);
        blank++;
        return;
      }
      const c = v.link.card;
      need(s && s.map === c.map && s.ix === c.ix && s.iz === c.iz && s.crew === c.crew && s.at === c.at && s.caption === c.caption && s.place === v.place && s.gen === v.gen, () => `stamp.js and link.ts read two heads (${how}) from ${JSON.stringify(href)}: ${JSON.stringify(s)} against ${same(c)} at ${v.place}/${v.gen}`);
      read++;
    };
    for (const href of hrefs) {
      agree(href, split(href), 'as text');
      let u = null;
      try {
        u = new URL(href);
      } catch {
        continue; // (not an address a browser would open)
      }
      agree(u.href, [u.pathname, u.search, u.hash], 'as a page gets it');
      pages++;
    }
    return `index.html's own reader (src/link/stamp.js, ES5, run from its source) agrees with link.ts on every one of the ${hrefs.length.toLocaleString('en')} addresses these rows made, read as the text stands and (${pages.toLocaleString('en')} of them) as a page gets them: ${read.toLocaleString('en')} heads read the same, ${blank.toLocaleString('en')} refused by both`;
  });
}

/** `node tools/link/fuzz.mjs golden --print-golden` prints these as the code now makes them */
const EXPLAINED = "visit: card, page mission, generation 3\ncard: read to 'full'\nhead: map 0, square -10,20, crew 3, 2026-11-16T10:42Z, caption \"GOLDEN 2\"\nsquares: -10,20:1 -9,20:2\norder: 0 1 1\nid: 566195233 (42 characters)\n--\nvisit: card, page ggb, generation 0\ncard: read to 'full'\nhead: map 0, square -41,-34, crew 1, 2026-11-15T18:00Z, caption \"GOLDEN GATE BRIDGE\"\nlandmark: GGB at stage 4\nid: 540168523 (54 characters)\n--\nvisit: card, source tt1\ncard: read to 'core' (cut short)\nhead: map 0, square -10,20, crew 4, 2026-11-16T10:43Z, caption \"GOLDEN 3\"\nsquares: -10,20:1 -9,20:2 -8,20:3\norder (made up: the card's own was lost): 0 1 2 1 2 2\nid: 277222692 (42 characters)\n--\nvisit: place, page mission, generation 0\ncard: read to 'none' (a newer format)";
const GOLDEN = {
  "crc15": "29967",
  "crc30": "406111430",
  "squares 1": "10q4824e901r4w4g672rc8dj6rhsk040008apgepg00n5j",
  "squares 2": "10q4c24e901r4w8g672rc8dj70tcs05200c8gvyx1101cywz",
  "squares 3": "10q4g24e901r4wcg672rc8dj78ne705400e688c5940336g3kn",
  "squares 4": "10q4m24e901r4wgg672rc8dj7g14n06600f3cj93wdt043dqfvfw",
  "squares 5": "10q4424e901r4wmg672rc8dj7r0yr07800fhp0pa2m8s070mw56kcdn3",
  "squares 8": "10q4g24e901r4x0g672rc8dj8gwnq09a40fy0dhppxdhsw0c0xteaex7ex7vkbz",
  "squares 9": "10q4m24e901r4x4g672rc8dj8re6f0aa40fz0dhp0w08sja0h05kjgd2hcwhncwhq6etj",
  "squares 16": "10r4824e901r4y0j672rc8dj6w0x5q0ea80fzzr6rv3cdgxxn9001005kjhkf3kx55p5kjvrwzmpv75rztpwzv7ag",
  "squares 17": "10r4c24e901r4y4j672rc8dj6w4h320ea80fzzw6rv3cdgtcgfa519016728cde39f4ag5b1672de39fa5b672e3fab73fb0nm",
  "squares 32": "10r4c24e901r500j672rc8dj7bg8gy0ram0fzzzzzw0v3cdhp6rv3cdga23k5d2g016728cde39fjkmn4agprstvw5bhqxyz1672de39fjknapstv5bhqxyz672e3fjkaptvbqyz73fkvbqzhrb",
  "spot": "115080p5g1r0z1a6a125248kmh4kj9chry9hwh4k99y",
  "mark": "113a42m6gc1r0z14672rc8dj1g164j0a4g3310z14054630eg34mab",
};
