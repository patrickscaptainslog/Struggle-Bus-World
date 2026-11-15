// The save's rows: records and whole saves round-trip, saves join in any order, a card lands by its rules, tiles land in any order, the real engine agrees,
// and two tabs can't lose each other's work.
import { dice, same, randCard, randOrder, need } from './lib.mjs';

const NOW = 1794700000; // (a November 2026 evening, epoch s)

export async function saveRows(R, L, sf, lastCard) {
  const { row } = R;
  const table = L.parseHoods(sf.hoods);
  if (!table) throw new Error('hoods.bin would not parse');
  const frame = L.frameFrom({ slug: sf.city.slug, bounds: sf.city.bounds, landmarks: sf.city.landmarks }, table, L.slugOf);
  const land = table.squares.flat(), tagged = new Set(table.tagged), open = land.filter((k) => !tagged.has(k));
  const visitOf = (text, place = 'x', gen = 0) => L.parseLocation(`/p/${place}/${gen}`, '', `#${text}`);
  const sq = (key, stage) => ({ ix: L.squareIx(key), iz: L.squareIz(key), stage });
  const bySquare = (a, b) => a.iz - b.iz || a.ix - b.ix;
  /** a card of these squares ([key, stage] pairs), its own square the first */
  const cardOf = (pairs, crew, rnd, more = {}) => {
    const squares = pairs.map(([k, s]) => sq(k, s)).sort(bySquare);
    return { v: 1, map: 0, ix: L.squareIx(pairs[0][0]), iz: L.squareIz(pairs[0][0]), crew, at: L.cardMinute(NOW - 3600), caption: 'A BLOCK', body: { form: 'squares', squares, order: randOrder(squares, rnd), answers: null, score: null, ...more } };
  };
  const text = (card) => {
    const e = L.encode(card);
    if (!e.ok) throw new Error(`a row's card would not be written: ${e.why}`);
    return e;
  };
  const randRec = (rnd, key = rnd.int(0, 0xffffffff)) => {
    const stage = rnd.int(1, 5), has = rnd() < 0.5, anchored = rnd() < 0.6;
    return {
      key, owner: rnd.int(1, 15), stage, cracks: rnd() < 0.7 ? 0 : rnd.int(0, 15), hits: rnd.pick([0, 1, stage, rnd.int(0, 0xffff)]), tended: rnd.pick([0, NOW, rnd.int(0, 0xffffffff)]),
      ax: anchored ? rnd.int(0, 127) : 0, az: anchored ? rnd.int(0, 127) : 0, ay: anchored ? rnd.int(-32767, 32767) : L.NO_ANCHOR,
      rev: rnd.pick([0, 1, NOW, NOW + 1, rnd.int(0, L.CLOCK_TOP)]), card: has ? rnd.int(0, 2 ** 30 - 1) : -1, guest: has && rnd() < 0.5,
    };
  };
  const randNote = (rnd, id) => ({
    id, id30: rnd.int(0, 2 ** 30 - 1), role: rnd() < 0.3 ? 'out' : 'in', text: id + (rnd() < 0.5 ? 'tail' : ''), at: rnd.pick([NOW, NOW + 5, rnd.int(0, 0xffffffff)]), gen: rnd.int(0, 99),
    place: rnd.pick(['', 'mission', 'noe-valley']), key: rnd.int(0, 0xffffffff), crew: rnd.int(1, 5), taken: rnd() < 0.7 ? 0 : rnd.int(1, 0xffffffff), answers: rnd() < 0.7 ? -1 : rnd.int(0, 2 ** 30 - 1),
  });
  /** a save as plain values in a fixed order: what two saves are compared by when the text itself is what is under test */
  const plain = (v) => same({ squares: [...v.squares.values()].sort((a, b) => a.key - b.key), marks: [...v.marks].sort((a, b) => (a[0] < b[0] ? -1 : 1)), notes: [...v.notes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), crew: v.crew, climbs: v.climbs.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]), forgot: v.forgot, seen: [...v.seen].sort((a, b) => a[0] - b[0]) });
  /** a random save over a small set of squares and cards, so that two of them overlap, and often tie */
  const randSave = (rnd, keys, ids) => {
    const s = L.emptySave();
    for (const k of keys) if (rnd() < 0.6) s.squares.set(k, randRec(rnd, k));
    for (const m of ['ggb', 'sutro', 'baybridge']) if (rnd() < 0.4) s.marks.set(m, { owner: rnd.int(1, 5), stage: rnd.int(1, 4), cracks: rnd.int(0, 1), hits: rnd.int(0, 9), tended: rnd.pick([0, NOW]), rev: rnd.pick([1, NOW, NOW + 1]), card: rnd() < 0.5 ? -1 : rnd.int(0, 99) });
    for (const id of ids) if (rnd() < 0.5) s.notes.set(id, randNote(rnd, id));
    s.crew = { value: rnd.int(0, 5), rev: rnd.pick([0, 1, NOW]) };
    s.forgot = rnd.pick([0, 0, 3, rnd.int(0, 0xffffffff)]);
    for (const n of s.notes.values()) if (rnd() < 0.8) s.seen.set(n.id30, n.at);
    for (let n = rnd.int(0, 6); n > 0; n--) s.seen.set(rnd.pick([rnd.int(0, 2 ** 30 - 1), rnd.int(0, 30)]), rnd.pick([NOW, NOW + 1, rnd.int(0, 0xffffffff)]));
    for (let n = keys.length ? rnd.int(0, 12) : 0; n > 0; n--) s.climbs.push([rnd.pick([NOW * 1000, NOW * 1000 + 1, NOW * 1000 + 2, rnd.int(0, 2 ** 40)]), rnd.pick(keys), (rnd.int(1, 5) << 4) | rnd.int(1, 4)]);
    s.climbs = [...new Map(s.climbs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map((c) => [c.join(), c])).values()];
    return s;
  };

  await row('saved', () => {
    const rnd = dice(11);
    let records = 0, refused = 0, kept = 0;
    for (let i = 0; i < 10000; i++) {
      const keys = Array.from({ length: rnd.int(0, 40) }, () => rnd.int(0, 0xffffffff)), ids = Array.from({ length: rnd.int(0, 6) }, (_, n) => `1card${i}x${n}`);
      const s = randSave(rnd, keys, ids), t = L.saveText(s), back = L.parseSave(t);
      need(back.lost === 0, `save ${i}: ${back.lost} lost on the way back`);
      need(plain(back.save) === plain(s), () => `save ${i} did not come back as it was: ${plain(back.save).slice(0, 300)} from ${plain(s).slice(0, 300)}`);
      need(L.saveText(back.save) === t, `save ${i} written twice gave two texts`);
      for (const r of s.squares.values()) {
        need(same(L.unpack(L.pack(r))) === same(r), () => `a record did not come back from its 24 bytes: ${same(r)}`);
        records++;
      }
    }
    // any 24 bytes: refused, or exactly the bytes that record is written as
    for (let i = 0; i < 200000; i++) {
      const b = new Uint8Array(24);
      for (let k = 0; k < 24; k++) b[k] = rnd() < 0.3 ? 0 : rnd.int(0, 255);
      if (rnd() < 0.5) b[4] = rnd.int(1, 5), b[5] = rnd.int(1, 4);
      const r = L.unpack(b);
      if (!r) refused++;
      else {
        need(Buffer.compare(Buffer.from(L.pack(r)), Buffer.from(b)) === 0, () => `24 bytes read as a record that is written differently: ${[...b]}`);
        kept++;
      }
    }
    return `10,000 random saved cities (${records.toLocaleString('en')} squares, with landmarks, cards, a crew and climbs) written as text and read back the same, nothing lost; of 200,000 random 24-byte records ${refused.toLocaleString('en')} are refused as nonsense and the other ${kept.toLocaleString('en')} are each written back as the very same bytes`;
  });

  await row('text', () => {
    const rnd = dice(12);
    let cut = 0;
    for (let i = 0; i < 3000; i++) {
      const keys = Array.from({ length: rnd.int(1, 30) }, () => rnd.int(0, 0xffffffff)), s = randSave(rnd, keys, ['1a', '1b', '1c']), t = L.saveText(s);
      // cut anywhere, a character changed anywhere, lines dropped or swapped: never a throw, and never more squares than were saved
      const bent = [t.slice(0, rnd.int(0, t.length)), t.slice(0, rnd.int(0, t.length)) + rnd.pick(['', '!', '\n', '}', 'A']) + t.slice(rnd.int(0, t.length)), t.split('\n').slice(0, rnd.int(0, 6)).join('\n'), rnd.shuffle(t.split('\n')).join('\n'), t.replace(/[A-Za-z]/, '*'), `${t}\nmore`, t.toUpperCase()];
      for (const b of bent) {
        const back = L.parseSave(b);
        need(back.save.squares.size <= s.squares.size + 1, 'a damaged save grew squares');
        for (const r of back.save.squares.values()) need(L.unpack(L.pack(r)), 'a damaged save gave a record that makes no sense');
        L.saveText(back.save);
        cut++;
      }
      // one square's bytes turned to nonsense: that one is lost, the rest of the city is not
      if (s.squares.size > 1) {
        const bytes = L.squaresBytes(s.squares), n = rnd.int(0, s.squares.size - 1);
        bytes[n * 24 + 5] = 0;
        const line = t.split('\n');
        line[1] = Buffer.from(bytes).toString('base64');
        const back = L.parseSave(line.join('\n'));
        need(back.lost === 1 && back.save.squares.size === s.squares.size - 1 && back.save.notes.size === s.notes.size, `one bad square cost ${s.squares.size - back.save.squares.size} squares and ${back.lost} losses`);
        // and one character of the line that is no base64 at all: the same, that square and no other
        const at = rnd.int(0, t.split('\n')[1].length - 1), bad = t.split('\n');
        bad[1] = bad[1].slice(0, at) + rnd.pick(['*', ' ', '-', '\u00e9']) + bad[1].slice(at + 1);
        const back2 = L.parseSave(bad.join('\n'));
        need(back2.lost === 1 && back2.save.squares.size === s.squares.size - 1, `one bad character cost ${s.squares.size - back2.save.squares.size} of ${s.squares.size} squares (${back2.lost} counted)`);
        const lastLine = t.split('\n');
        if (lastLine[5].length >= 40) {
          lastLine[5] = '*' + lastLine[5].slice(1);
          const back3 = L.parseSave(lastLine.join('\n'));
          need(back3.lost === 1 && back3.save.climbs.length === s.climbs.length - 1, 'one bad character in the climbs cost more than its climb');
        }
      }
    }
    for (const junk of [undefined, null, 5, {}, '', 'SBW2', 'SBW2\n', 'SBW3\nAAAA', 'SBW2\n!!!\n{}\n[]\n[0,0]\n', 'SBW2\n\n[]\n{}\n"x"\n\n', 'SBW2\n\n{"ggb":[1,9,0,0,0,0,0]}\n[[1,2,3]]\n[9,9,9]\nAAAA']) L.saveText(L.parseSave(junk).save);
    need(L.parseSave('nothing').lost === -1 && L.parseSave(L.saveText(L.emptySave())).lost === 0, 'what is not a save, and an empty one');
    // the save before this one (areas.ts's 16 bytes a square) comes across whole
    const old = L.emptySave();
    for (let i = 0; i < 50; i++) {
      const r = randRec(rnd, rnd.int(0, 0xffffffff));
      old.squares.set(r.key, { ...r, rev: 0, card: -1, guest: false, ax: 0, az: 0, ay: L.NO_ANCHOR });
    }
    const moved = L.fromAreasText(L.areasText(old.squares));
    need(moved && moved.lost === 0 && same([...moved.squares.values()].sort((a, b) => a.key - b.key)) === same([...old.squares.values()].sort((a, b) => a.key - b.key)), "the old save's squares did not come across");
    need(L.fromAreasText('not base64!') === null && L.fromAreasText('AAAA') === null && L.fromAreasText(5) === null, 'a broken old save was read');
    // (the old save as areas.ts itself reads it: an anchor past the square, which the engine never wrote but would read, is no anchor; a stage that is none costs that square alone)
    const raw = Buffer.from(L.areasText(old.squares), 'base64');
    raw[12] = 200, raw[14] = 5, raw[16 + 5] = 9;
    const odd = L.fromAreasText(raw.toString('base64'));
    need(odd && odd.lost === 1 && odd.squares.size === old.squares.size - 1 && [...odd.squares.values()].every((r) => r.ay === L.NO_ANCHOR), `the old save with an odd anchor and a bad stage: ${odd ? `${odd.squares.size} squares, ${odd.lost} lost` : 'refused whole'}`);
    return `${cut.toLocaleString('en')} saves cut, bent, reordered and shouted: reading never throws and never invents a square; one square turned to nonsense costs that square alone; what is no save at all reads as empty and says so; the old 16-byte save comes across whole`;
  });

  await row('laws', () => {
    const rnd = dice(13), keys = Array.from({ length: 12 }, (_, i) => L.packSquare(i, 7)), ids = ['1a', '1b', '1c', '1d'];
    const T = (s) => L.saveText(s);
    for (let i = 0; i < 4000; i++) {
      const a = randSave(rnd, keys, ids), b = randSave(rnd, keys, ids), c = randSave(rnd, keys, ids);
      const ta = T(a), tb = T(b), tc = T(c);
      need(T(L.joinSave(a, b)) === T(L.joinSave(b, a)), `triple ${i}: a joined to b is not b joined to a`);
      need(T(L.joinSave(L.joinSave(a, b), c)) === T(L.joinSave(a, L.joinSave(b, c))), `triple ${i}: three saves joined two ways gave two saves`);
      need(T(L.joinSave(a, a)) === ta && T(L.joinSave(a, L.emptySave())) === ta, `triple ${i}: a save joined with itself, or with nothing, changed`);
      need(T(L.joinSave(L.joinSave(a, b), b)) === T(L.joinSave(a, b)), `triple ${i}: joining the same save in twice changed it`);
      need(T(a) === ta && T(b) === tb && T(c) === tc, `triple ${i}: a join changed what it was given`);
    }
    return '4,000 triples of random overlapping saves: joined in either order, grouped either way, with themselves, with nothing, or twice over, they give one save, and the join changes neither of the two it is given';
  });

  await row('clock', () => {
    const cases = [[NOW, null, NOW], [NOW * 1000, null, NOW], [NOW + 0.9, null, NOW], [NaN, null, 1], [-5, null, 1], ['soon', null, 1], [undefined, null, 1], [Infinity, null, 1], [0, null, 1],
      [NOW, { rev: NOW }, NOW + 1], [NOW - 86400, { rev: NOW }, NOW + 1], [NOW, { rev: 0 }, NOW], [0, { rev: 0 }, 1], [4.33e9, null, 1], [4.33e12, null, 1], [4.33e9, { rev: NOW }, NOW + 1], [NOW, { rev: L.CLOCK_TOP }, L.CLOCK_TOP], [NOW, { rev: L.CLOCK_TOP - 1 }, L.CLOCK_TOP]];
    for (const [now, old, want] of cases) need(L.nextRev(old, now) === want, () => `a change at ${now} over rev ${old ? old.rev : 'none'} got rev ${L.nextRev(old, now)}, not ${want}`);
    // a phone whose clock was put back a day still writes the later record, and the join takes it
    const key = L.packSquare(3, 3), a = L.emptySave(), b = L.emptySave();
    L.touch(a, { key, faction: 2, stage: 2, cracks: 0, hits: 2, tended: NOW }, NOW);
    b.squares.set(key, { ...a.squares.get(key) });
    L.touch(b, { key, faction: 2, stage: 3, cracks: 0, hits: 3, tended: NOW }, NOW - 86400);
    need(L.joinSave(a, b).squares.get(key).stage === 3 && L.joinSave(b, a).squares.get(key).stage === 3, 'a change made with the clock put back lost to the record it changed');
    // a clock in 2107 is a broken clock and is not believed: the change counts on from what was known, and an honest change after it still wins
    const far = L.emptySave();
    far.squares.set(key, { ...a.squares.get(key) });
    L.touch(far, { key, faction: 1, stage: 1, cracks: 0, hits: 1, tended: NOW }, Date.UTC(2107, 0, 1));
    const back = L.unpack(L.pack(far.squares.get(key)));
    need(back.rev === NOW + 1 && L.joinSave(a, far).squares.get(key).owner === 1, `a clock in 2107 was believed: rev ${back.rev}`);
    L.touch(far, { key, faction: 3, stage: 2, cracks: 0, hits: 2, tended: NOW + 60 }, NOW + 60);
    need(far.squares.get(key).rev === NOW + 60 && L.joinSave(far, a).squares.get(key).owner === 3, 'an honest change after a broken clock lost');
    // climbs keep their order whatever the clock does: two in one second, a clock put back, a clock far ahead and then right again
    const c = L.emptySave();
    for (const [now, k] of [[NOW, 1], [NOW, 2], [NOW + 0.4, 3], [NOW - 86400, 4], [Date.UTC(2107, 0, 1), 5], [NOW + 5, 6], [NaN, 7], [(NOW + 6) * 1000, 8]]) L.noteClimb(c, now, k, 1, 1);
    need(same(c.climbs.map((x) => x[1])) === '[1,2,3,4,5,6,7,8]' && c.climbs.every((x, i) => !i || x[0] > c.climbs[i - 1][0]) && same(L.parseSave(L.saveText(c)).save.climbs) === same(c.climbs), `climbs out of order: ${same(c.climbs)}`);
    need(L.seconds(Date.UTC(2026, 10, 14)) === Date.UTC(2026, 10, 14) / 1000 && L.cardMinute(L.cardSeconds(459000)) === 459000 && L.cardMinute(-1e12) === 0 && L.cardMinute(1e15) === L.linkTune.atMost && L.cardMinute(NaN) === 0, 'seconds and minutes');
    // a square tapped five times a second for twenty seconds (the encores only add to it): its rev stays with the clock, and a card landed a few
    // seconds after the last tap, from another tab that read the store before the taps, still stands
    {
      const areas = new L.Areas(), tab = L.emptySave(), key = open[50], { x, z } = L.squareCentre(key);
      areas.onChange = (a) => L.touch(tab, a, (NOW + t) * 1000);
      let t = 0;
      const out = {};
      for (let i = 0; i < 100; i++) {
        t += 0.2;
        const o = areas.hit(x, z, 1, t, { now: Math.floor(NOW + t) }).outcome;
        out[o] = (out[o] ?? 0) + 1;
      }
      const ahead = tab.squares.get(key).rev - Math.floor(NOW + t);
      need(ahead <= 3, `20 s of taps put a square's rev ${ahead} s ahead of the clock (${same(out)})`);
      const stale = L.emptySave();
      const lc = L.openLink(stale, visitOf(text(cardOf([[key, 2]], 3, dice(5))).text), frame, Math.floor(NOW + t) + 5);
      need(lc.kind === 'flyby' && L.joinSave(tab, stale).squares.get(key).owner === lc.as && L.joinSave(stale, tab).squares.get(key).owner === lc.as, 'a card landed five seconds after the taps lost to them');
    }
    // a record stored with a rev past 2100 is no record (the square is made again by the next change, never frozen)
    {
      const r = { key: 7, owner: 2, stage: 2, cracks: 0, hits: 2, tended: NOW, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: NOW, card: -1, guest: false };
      for (const [rev, ok] of [[L.CLOCK_TOP, true], [L.CLOCK_TOP + 1, false], [0xfffffffe, false], [0xffffffff, false]]) need(!!L.unpack(L.pack({ ...r, rev })) === ok, `a record with rev ${rev} was ${ok ? 'refused' : 'read'}`);
    }
    return `${cases.length} clocks (in milliseconds, with a fraction, nonsense, put back, past 2100): a change is always later than the record it changes, never 0, never wrapped; a change made with the clock a day back still wins the join; a clock in 2107 is not believed, and an honest change after it wins; eight climbs noted under every kind of clock keep the order they were made in; twenty seconds of taps five a second keep a square's rev within 3 s of the clock, and a card landed five seconds later from a tab that read the store before them stands; a record stored with a rev past 2100 is refused`;
  });

  await row('land', () => {
    const rnd = dice(14);
    let checks = 0;
    const ok = (cond, said) => (checks++, need(cond, said));
    const fresh = () => L.emptySave();
    const at = (s, k) => s.squares.get(k);
    // a block on open land, with a tagged square, a water square and a square off the map to hand
    const pickBlock = () => {
      for (;;) {
        const c = rnd.pick(open), ix = L.squareIx(c), iz = L.squareIz(c), keys = [];
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) keys.push(L.packSquare(ix + i, iz + j));
        if (keys.every((k) => frame.top(k) === 4)) return keys;
      }
    };
    const off = L.packSquare(3000, 3000), church = table.tagged[0];
    let water = -1;
    for (let i = -68; i < 44 && water < 0; i++) if (frame.inside(L.packSquare(i, 0)) && frame.top(L.packSquare(i, 0)) === 0) water = L.packSquare(i, 0);
    ok(frame.top(water) === 0 && frame.inside(water) && !frame.inside(off) && frame.top(church) === 3, 'the row needs a water square, one off the map and a tagged one');
    for (let run = 0; run < 300; run++) {
      const block = pickBlock(), sender = rnd.int(1, 5), stages = block.map(() => rnd.int(1, 4));
      const card = cardOf(block.slice(0, 9).map((k, i) => [k, stages[i]]), sender, rnd), e = text(card);
      // 1. a newcomer: dealt a crew that is not the sender's, every square the card's
      let s = fresh(), l = L.openLink(s, visitOf(e.text, 'mission', 4), frame, NOW);
      ok(l.kind === 'flyby' && l.key === block[0] && l.dealt === L.dealCrew(L.decode(e.text).seed, sender) && l.dealt !== sender && s.crew.value === l.dealt && l.as === sender, () => `a newcomer's landing: ${l.kind}, dealt ${l.dealt}, worn ${l.as}`);
      ok(l.landed.length === 9 && l.landed.every((x) => x.was === null && L.packSquare(card.body.squares[x.i].ix, card.body.squares[x.i].iz) === x.rec.key && s.squares.get(x.rec.key) === x.rec), 'a newcomer: nine squares written over nothing, each told with its place on the card');
      block.slice(0, 9).forEach((k, i) => {
        const r = at(s, k);
        ok(r && r.owner === sender && r.stage === stages[i] && r.hits === stages[i] && r.cracks === 0 && r.guest && r.card === e.id30 && r.rev === NOW && r.ay === L.NO_ANCHOR && r.tended === L.cardSeconds(card.at) && r.tended <= NOW - 3600, () => `a landed square: ${same(r)}`);
      });
      ok(l.beats.length === stages.slice(0, 9).reduce((a, b) => a + b, 0) && same(l.beats.map((b) => b.i)) === same(card.body.order), 'the Flyby is the card\'s own order');
      const seen = new Map();
      for (const b of l.beats) {
        ok(b.stage === (seen.get(b.i) ?? 0) + 1, 'a square\'s beats climb one stage at a time');
        seen.set(b.i, b.stage);
      }
      ok(l.note && l.note.role === 'in' && l.note.id === e.id && l.note.text === e.text && l.note.gen === 4 && l.note.place === 'mission' && l.note.crew === sender && L.wornNow(s, l.note) === sender && l.note.key === block[0] && l.note.at === NOW && l.note.taken === 0 && l.note.answers === -1, 'the note of an opened card');
      // 2. the same address opened again, on a page that has only the saved text: nothing changes
      const t1 = L.saveText(s);
      s = L.parseSave(t1).save;
      l = L.openLink(s, visitOf(e.text), frame, NOW + 50);
      ok(l.kind === 'seen' && l.landed.length === 0 && l.beats.length === 0 && l.dealt === 0 && L.saveText(s) === t1, `opened twice: ${l.kind}`);
      // 3. a returning player with squares of their own under it, higher, anchored, some a rival's: all become the card's
      for (const mine of [1, 2, 3, 4, 5]) {
        s = fresh();
        s.crew = { value: mine, rev: 5 };
        const before = new Map();
        block.slice(0, 6).forEach((k, i) => {
          const r = { key: k, owner: i % 2 ? mine : (mine % 5) + 1, stage: 4, cracks: i % 2, hits: 40 + i, tended: NOW - 99, ax: 7, az: 9, ay: 120, rev: i === 0 ? NOW + 500 : NOW - 500, card: i === 3 ? 77 : -1, guest: i === 3 };
          s.squares.set(k, r);
          before.set(k, { ...r });
        });
        l = L.openLink(s, visitOf(e.text), frame, NOW);
        const worn = sender === mine ? (sender % 5) + 1 : sender;
        ok(l.kind === 'flyby' && l.dealt === 0 && s.crew.value === mine && l.as === worn && worn !== mine && L.wornNow(s, l.note) === worn && l.note.crew === sender, () => `a returning player of crew ${mine} under a card of crew ${sender}: worn ${l.as}`);
        block.slice(0, 9).forEach((k, i) => {
          const r = at(s, k), was = before.get(k);
          ok(r.owner === worn && r.stage === stages[i] && r.hits === stages[i] && r.cracks === 0 && r.guest && r.card === e.id30, () => `a square under a returning player: ${same(r)}`);
          if (was) ok(r.ax === 7 && r.az === 9 && r.ay === 120 && r.rev > was.rev && r.rev >= NOW, 'its anchor kept, its rev past what stood there');
        });
        ok(l.landed.filter((x) => x.was).length === 6 && l.landed.every((x) => same(x.was) === same(before.get(x.rec.key) ?? null)), 'what stood there is handed back for the fall');
      }
      // 5. a god's square, a square this very card has been on, water, a tagged square: left alone, or held to its top
      s = fresh();
      s.crew = { value: 3, rev: 1 };
      const god = { key: block[1], owner: 3, stage: 5, cracks: 2, hits: 9, tended: 1, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: 9, card: -1, guest: false };
      const been = { key: block[2], owner: 3, stage: 1, cracks: 0, hits: 1, tended: 1, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: 9, card: 0, guest: false };
      const c5 = cardOf([[block[0], 4], [block[1], 2], [block[2], 3], [block[3], 1]], sender === 3 ? 4 : sender, rnd), e5 = text(c5);
      been.card = e5.id30;
      s.squares.set(god.key, { ...god }), s.squares.set(been.key, { ...been });
      l = L.openLink(s, visitOf(e5.text), frame, NOW);
      ok(l.kind === 'flyby' && l.landed.length === 2 && same(at(s, god.key)) === same(god) && same(at(s, been.key)) === same(been), 'a god\'s square or one the card has been on was written');
      ok(l.beats.length === 5 && l.beats.every((b) => c5.body.squares[b.i].ix !== L.squareIx(god.key) || c5.body.squares[b.i].iz !== L.squareIz(god.key)), 'the Flyby showed a square that was left alone');
    }
    // 6. water, off the map, a tagged square (hand-placed: a card whose own square is the church)
    {
      const near = [church, L.packSquare(L.squareIx(church) + 1, L.squareIz(church)), L.packSquare(L.squareIx(church), L.squareIz(church) + 1)];
      const c = cardOf(near.map((k) => [k, 4]), 2, rnd), e = text(c), s = fresh(), l = L.openLink(s, visitOf(e.text), frame, NOW);
      ok(s.squares.get(church).stage === 3 && s.squares.get(church).hits === 3 && l.beats.filter((b) => L.packSquare(b.ix, b.iz) === church).length === 3, 'a tagged square was lifted past its top');
      for (const k of near.slice(1)) ok(frame.top(k) === 0 ? !s.squares.has(k) : s.squares.get(k).stage === Math.min(4, frame.top(k)), 'a neighbour of the church');
      const shore = land.find((k) => frame.top(L.packSquare(L.squareIx(k) - 1, L.squareIz(k))) === 0), wet = L.packSquare(L.squareIx(shore) - 1, L.squareIz(shore));
      const s2 = fresh(), l2 = L.openLink(s2, visitOf(text(cardOf([[shore, 2], [wet, 4]], 1, rnd)).text), frame, NOW);
      ok(l2.kind === 'flyby' && l2.landed.length === 1 && !s2.squares.has(wet) && l2.beats.length === 2, 'a square of water was written');
      const aPlace = L.slugOf(table.names[0]), s3 = fresh(), l3 = L.openLink(s3, visitOf(text(cardOf([[off, 2]], 1, rnd)).text, aPlace), frame, NOW);
      ok(l3.kind === 'place' && l3.key === table.hearts[0] && s3.squares.size === 0 && s3.crew.value === 0 && s3.notes.size === 0, `a card of somewhere off the map: ${l3.kind}`);
      const s4 = fresh(), other = text({ ...cardOf([[open[0], 2]], 1, rnd), map: 7 }), l4 = L.openLink(s4, visitOf(other.text, 'nowhere-at-all'), frame, NOW);
      ok(l4.kind === 'door' && l4.key === -1 && L.saveText(s4) === L.saveText(fresh()), `a card of another city: ${l4.kind}`);
      ok(L.openLink(fresh(), visitOf('garbage', aPlace), frame, NOW).kind === 'place' && L.openLink(fresh(), visitOf('', 'nowhere'), frame, NOW).kind === 'door' && L.openLink(fresh(), L.parseLocation('/', '?fps', ''), frame, NOW).kind === 'door', 'no card: the page name, or the door');
      ok(L.openLink(fresh(), L.parseLocation('/p/ggb/0', '', ''), frame, NOW).key === frame.mark('ggb') && frame.mark('ggb') >= 0, 'a landmark\'s page name lands at the landmark');
    }
    // 7. a card of today's place is a ghost; a landmark's card and a place alone write nothing
    {
      const k = open[100], score = text(cardOf([[k, 3], [L.packSquare(L.squareIx(k) + 1, L.squareIz(k)), 2]], 2, rnd, { score: { budget: 60, used: 41 } }));
      let s = fresh(), l = L.openLink(s, visitOf(score.text), frame, NOW);
      ok(l.kind === 'score' && s.squares.size === 0 && s.notes.size === 1 && l.beats.length >= 3 && l.dealt > 0, `a card of today's place: ${l.kind}`);
      ok(L.openLink(s, visitOf(score.text), frame, NOW).kind === 'seen', 'a score opened twice');
      const ggb = { v: 1, map: 0, ix: 5, iz: 5, crew: 4, at: L.cardMinute(NOW), caption: 'GOLDEN GATE BRIDGE', body: { form: 'mark', key: 'GGB', stage: 4, answers: null } };
      s = fresh(), l = L.openLink(s, visitOf(text(ggb).text), frame, NOW);
      ok(l.kind === 'mark' && l.key === frame.mark('ggb') && s.squares.size === 0 && s.marks.size === 0 && s.notes.size === 1, `a landmark's card: ${l.kind} at ${l.key}`);
      ok(L.openLink(s, visitOf(text(ggb).text), frame, NOW).kind === 'seen', 'a landmark\'s card opened twice');
      const pier = { ...ggb, ix: L.squareIx(k), iz: L.squareIz(k), body: { ...ggb.body, key: 'PIER-39' } };
      l = L.openLink(fresh(), visitOf(text(pier).text), frame, NOW);
      ok(l.kind === 'mark' && l.key === k, 'a landmark this city has none of lands by the card\'s own square');
      const spot = { v: 1, map: 0, ix: L.squareIx(k), iz: L.squareIz(k), crew: 2, at: L.cardMinute(NOW), caption: 'HAYES ST', body: null };
      s = fresh(), l = L.openLink(s, visitOf(text(spot).text), frame, NOW);
      ok(l.kind === 'spot' && l.key === k && s.squares.size === 0 && s.notes.size === 0 && l.dealt > 0 && s.crew.value === l.dealt, `a place alone: ${l.kind}`);
      const again = L.openLink(s, visitOf(text(spot).text), frame, NOW);
      ok(again.kind === 'spot' && again.key === k && again.dealt === 0, 'a place alone lands there every time, and deals once');
    }
    // 8. a torn card: its squares land the same with the order lost, under the same id, and the whole card is then one it has seen; torn to its head it is a place
    for (let run = 0; run < 100; run++) {
      const block = pickBlock(), card = cardOf(block.slice(0, 7).map((k) => [k, rnd.int(1, 4)]), rnd.int(1, 5), rnd), e = text(card);
      const whole = fresh(), torn = fresh();
      whole.crew = torn.crew = { value: (card.crew % 5) + 1, rev: 1 };
      L.openLink(whole, visitOf(e.text), frame, NOW);
      const l = L.openLink(torn, visitOf(e.text.slice(0, e.id.length + rnd.int(0, e.text.length - e.id.length - 1))), frame, NOW);
      ok(l.kind === 'flyby' && l.why === 'cut short' && same([...torn.squares.values()]) === same([...whole.squares.values()]) && torn.notes.get(e.id).text === e.id, `a card torn after its squares: ${l.kind} ${l.why}`);
      const t = Buffer.from(L.squaresBytes(torn.squares)), l2 = L.openLink(torn, visitOf(e.text), frame, NOW + 9);
      ok(l2.kind === 'seen' && torn.notes.get(e.id).text === e.text && Buffer.compare(Buffer.from(L.squaresBytes(torn.squares)), t) === 0, `the whole card after its torn half: ${l2.kind}`);
      const head = fresh(), l3 = L.openLink(head, visitOf(e.text.slice(0, e.id.length - 3)), frame, NOW);
      ok(l3.kind === 'spot' && l3.key === block[0] && head.squares.size === 0 && head.notes.size === 0, `a card torn to its head: ${l3.kind}`);
      ok(L.openLink(head, visitOf(e.text), frame, NOW).kind === 'flyby', 'the whole card after it was read as a place');
    }
    // 9. cards this phone sent, answers, taking back
    for (let run = 0; run < 100; run++) {
      const block = pickBlock(), A = fresh(), B = fresh();
      A.crew = { value: 2, rev: 1 }, B.crew = { value: 4, rev: 1 };
      const x = cardOf(block.slice(0, 5).map((k) => [k, rnd.int(1, 4)]), 2, rnd), ex = text(x), sent = L.noteSent(A, ex, x, 0, 'mission', NOW);
      ok(sent.role === 'out' && sent.text === ex.text && sent.at === NOW && sent.key === block[0] && sent.gen === 0 && sent.place === 'mission' && L.lastSent(A) === sent && L.openLink(A, visitOf(ex.text), frame, NOW).kind === 'own' && A.squares.size === 0, 'a card opened on the phone that sent it');
      const lb = L.openLink(B, visitOf(ex.text, 'mission', 0), frame, NOW + 60);
      ok(lb.kind === 'flyby' && lb.as === 2, 'the friend opens it');
      // the friend takes the card's own square back: the engine's flip, as touch sees it
      const was = { ...B.squares.get(block[0]) }, side = { ...B.squares.get(block[1]) };
      L.touch(B, { key: block[1], faction: 4, stage: 1, cracks: 0, hits: 1, tended: NOW + 90 }, NOW + 90);
      ok(L.noteTaken(B, block[1], side, NOW + 90) === null && B.notes.get(ex.id).taken === 0, 'a side square taken is not the card taken');
      const r = L.touch(B, { key: block[0], faction: 4, stage: 1, cracks: 0, hits: 1, tended: NOW + 100 }, NOW + 100);
      ok(r.owner === 4 && !r.guest && r.card === ex.id30 && r.rev > was.rev, 'a square taken back: no guest, the card remembered');
      const taken = L.noteTaken(B, block[0], was, NOW + 100);
      ok(taken && taken.id === ex.id && taken.taken === NOW + 100 && L.noteTaken(B, block[0], r, NOW + 200) === null, 'the card is taken when its own square is');
      // the reply: B's card answers A's, and on A's phone A's card turns TAKEN
      const y = cardOf([[block[0], 1], [block[5], 2]], 4, rnd, { answers: ex.id30 }), ey = text(y);
      L.noteSent(B, ey, y, 1, 'mission', NOW + 120);
      const la = L.openLink(A, visitOf(ey.text, 'mission', 1), frame, NOW + 300);
      ok(la.kind === 'flyby' && la.answered && la.answered.id === ex.id && A.notes.get(ex.id).taken === NOW + 300 && la.note.answers === ex.id30, 'an answer marks the card it answers');
      const z = cardOf([[block[9], 1]], 4, rnd, { answers: ex.id30 }), lz = L.openLink(fresh(), visitOf(text(z).text), frame, NOW);
      ok(lz.answered === null, 'an answer on a phone that never sent the card');
      const A2 = fresh();
      L.noteSent(A2, ex, x, 0, 'mission', NOW);
      ok(L.openLink(A2, visitOf(text(z).text), frame, NOW).answered === null && A2.notes.get(ex.id).taken === 0, 'an answer that does not cover the card\'s own square');
      // 10. the note lost, the squares remember: the card never lands on a square twice, taken back or not
      B.notes.delete(ex.id);
      const tb = same([...B.squares.values()]), lost = L.openLink(B, visitOf(ex.text), frame, NOW + 999);
      ok(lost.landed.length === 0 && same([...B.squares.values()]) === tb && lost.kind === 'seen', `a card whose note was lost landed again: ${lost.kind}`);
      // and with its short id lost as well, the squares themselves still remember it
      B.seen.delete(ex.id30);
      const lost2 = L.openLink(B, visitOf(ex.text), frame, NOW + 999);
      ok(lost2.landed.length === 0 && same([...B.squares.values()]) === tb && lost2.kind === 'spot', `a card known only to its squares landed again: ${lost2.kind}`);
      // 11. another card over the same squares does land
      const w = cardOf(block.slice(0, 5).map((k) => [k, 2]), 1, rnd), lw = L.openLink(B, visitOf(text(w).text), frame, NOW + 1000);
      ok(lw.kind === 'flyby' && lw.landed.length === 5 && lw.dealt === 0 && B.crew.value === 4, 'a second card over the first');
      // 12. touch: a guest stays one while its owner does, climbs are noted for a change of owner or stage alone
      const n0 = B.climbs.length, g = L.touch(B, { key: block[2], faction: 1, stage: 3, cracks: 0, hits: 3, tended: NOW }, NOW + 2000);
      const g2 = L.touch(B, { key: block[2], faction: 1, stage: 3, cracks: 1, hits: 3, tended: NOW }, NOW + 2001);
      ok(g.guest && g2.guest && g2.rev > g.rev && B.climbs.length === n0 + 1 && L.touch(B, { key: block[2], faction: 0, stage: 0, cracks: 0, hits: 0, tended: 0 }, NOW) === null, 'touch');
    }
    // 13. what the first build's rows did not ask (each of these let a wrong rule through)
    for (let run = 0; run < 100; run++) {
      const block = pickBlock(), me = rnd.int(1, 5), them = (me % 5) + 1;
      // a place alone, sent from here, is this phone's own; a phone that sends its first card is of that card's crew
      const spot = { v: 1, map: 0, ix: L.squareIx(block[0]), iz: L.squareIz(block[0]), crew: me, at: L.cardMinute(NOW), caption: 'HAYES ST', body: null }, es = text(spot);
      const S = fresh();
      L.noteSent(S, es, spot, 0, 'x', NOW);
      ok(S.crew.value === me && L.openLink(S, visitOf(es.text), frame, NOW).kind === 'own' && L.openLink(fresh(), visitOf(es.text), frame, NOW).kind === 'spot', 'a street card opened where it was sent is its own');
      // a phone that painted before this save is Rainbow and is dealt nothing; a new one is dealt, and the same whether the link came whole or torn
      const c = cardOf(block.slice(0, 6).map((k) => [k, rnd.int(1, 4)]), them, rnd), e = text(c);
      const old = fresh(), lo = L.openLink(old, visitOf(e.text), frame, NOW, { returning: true });
      ok(lo.dealt === 0 && old.crew.value === 1 && lo.as === (them === 1 ? 2 : them), `a phone that had painted before was dealt ${lo.dealt} and is crew ${old.crew.value}`);
      const whole = L.openLink(fresh(), visitOf(e.text), frame, NOW).dealt, core = L.openLink(fresh(), visitOf(e.id), frame, NOW).dealt, head = L.openLink(fresh(), visitOf(e.text.slice(0, e.id.length - 4)), frame, NOW);
      ok(whole === core && whole === head.dealt && head.kind === 'spot' && whole !== them && whole >= 1 && whole <= 5, `one link dealt ${whole}, ${core} and ${head.dealt} whole, torn after its squares, and torn to its head`);
      // a card postmarked in the future tends its squares no later than now
      const late = text({ ...c, at: L.linkTune.atMost }), fl = fresh();
      L.openLink(fl, visitOf(late.text), frame, NOW);
      ok([...fl.squares.values()].every((r) => r.tended === NOW), 'a card postmarked in 2089 tended its squares in 2089');
      // answers: only a card this phone SENT is marked, and only by a card that lands on its own square
      const A = fresh(), C = fresh();
      A.crew = { value: them, rev: 1 }, C.crew = { value: ((them + 1) % 5) + 1, rev: 1 };
      L.noteSent(A, e, c, 0, 'x', NOW);
      L.openLink(C, visitOf(e.text), frame, NOW);
      const y = cardOf([[block[0], 2], [block[7], 1]], me === them ? ((me + 2) % 5) + 1 : me, rnd, { answers: e.id30 }), ey = text(y);
      const lc = L.openLink(C, visitOf(ey.text), frame, NOW + 5);
      ok(lc.kind === 'flyby' && lc.answered === null && C.notes.get(e.id).taken === 0, 'a friend who only opened a card had it marked taken by another friend\'s answer');
      const ghost = text(cardOf([[block[0], 2]], y.crew, rnd, { answers: e.id30, score: { budget: 9, used: 9 } })), lg = L.openLink(A, visitOf(ghost.text), frame, NOW + 6);
      ok(lg.kind === 'score' && lg.answered === null && A.notes.get(e.id).taken === 0, 'a card that landed nothing marked a sent card taken');
      const la = L.openLink(A, visitOf(ey.text), frame, NOW + 7);
      ok(la.answered && la.answered.id === e.id && A.notes.get(e.id).taken === NOW + 7, 'an honest answer');
      // a look-alike of a sent card (the same id, a longer text) changes nothing of the note
      const { Writer: W, section, writeBlocks, bitsOf } = L.forTests, t = new W(), bits = L.indexBits(c.body.squares.length);
      for (const i of c.body.order) t.u(i, bits);
      writeBlocks(t, [[9, bitsOf((w) => w.u(0x3ff, 10))]]);
      const alike = section(e.id, t, 3), rd = L.decode(alike);
      ok(rd.level === 'full' && rd.id === e.id && rd.canon.length > e.text.length, 'the row needs a longer text of the same card');
      const before = A.notes.get(e.id).text, lk = L.openLink(A, visitOf(alike), frame, NOW + 8);
      ok(lk.kind === 'own' && A.notes.get(e.id).text === before, 'a look-alike rewrote the text of a card this phone sent');
      // an opened card's squares never wear the player's own crew, whatever crew the player picks afterwards
      const P = fresh();
      P.crew = { value: me, rev: 1 };
      const lp = L.openLink(P, visitOf(e.text), frame, NOW), moved = L.setCrew(P, them, NOW + 10);
      ok(lp.as === them && P.crew.value === them && moved.length === 6 && [...P.squares.values()].every((r) => r.guest && r.owner === (them % 5) + 1 && r.rev > NOW) && L.wornNow(P, lp.note) === (them % 5) + 1, 'the player took the crew of a card\'s squares and they stayed that crew\'s');
      ok(L.setCrew(P, them, NOW + 11).length === 0 && L.setCrew(P, 9, NOW).length === 0 && P.crew.value === them && L.crewOf(P) === them && L.crewOf(fresh()) === 1, 'setCrew, crewOf');
      // a landing is a climb: a card's order made afterwards has the square's stages after it, not before
      const Q = fresh();
      Q.crew = { value: me, rev: 1 };
      const S0 = block[1], T0 = block[2];
      for (const [k, st, when] of [[S0, 1, 10], [S0, 2, 20], [S0, 3, 30], [T0, 1, 40]]) L.touch(Q, { key: k, faction: me, stage: st, cracks: 0, hits: st, tended: NOW }, NOW + when);
      L.openLink(Q, visitOf(text(cardOf([[S0, 2]], them, rnd)).text), frame, NOW + 50);
      L.touch(Q, { key: S0, faction: me, stage: 1, cracks: 0, hits: 1, tended: NOW }, NOW + 60);
      L.touch(Q, { key: S0, faction: me, stage: 2, cracks: 0, hits: 2, tended: NOW }, NOW + 70);
      const sq2 = [sq(S0, 2), sq(T0, 1)].sort(bySquare), want = sq2[0].ix === L.squareIx(T0) && sq2[0].iz === L.squareIz(T0) ? [0, 1, 1] : [1, 0, 0];
      ok(same(L.orderFrom(Q, sq2, me)) === same(want), () => `a square taken back after a card: its order was ${same(L.orderFrom(Q, sq2, me))}, not ${same(want)}`);
      // the anchor: a record made with its tile in takes it, an engine change keeps it, and so does a join with a later record that has none
      const G = fresh(), g0 = { ax: 5, az: 6, ay: 70 };
      const r1 = L.touch(G, { key: S0, faction: me, stage: 1, cracks: 0, hits: 1, tended: NOW }, NOW, () => g0);
      const r2 = L.touch(G, { key: S0, faction: me, stage: 2, cracks: 0, hits: 2, tended: NOW }, NOW + 1);
      const bare = { ...r2, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: r2.rev + 9, stage: 3 }, j = L.joinRec(r1, bare), j2 = L.joinRec(bare, r1);
      ok(r1.ax === 5 && r1.az === 6 && r1.ay === 70 && r2.ay === 70 && r2.ax === 5 && j.stage === 3 && j.ay === 70 && j.ax === 5 && same(j) === same(j2), 'an anchor was lost');
      const lgd = L.openLink(fresh(), visitOf(e.text), frame, NOW, { ground: (k) => (k === block[0] ? g0 : null) });
      ok(lgd.landed.find((x) => x.rec.key === block[0]).rec.ay === 70 && lgd.landed.filter((x) => x.rec.ay === L.NO_ANCHOR).length === 5, 'a card landing with a tile in');
    }
    // 15. what the third pass answers
    for (let run = 0; run < 60; run++) {
      const block = pickBlock(), me = rnd.int(1, 5), them = (me % 5) + 1;
      // old paint's stages were reached long ago: they go first in a card's order
      const O = fresh();
      O.crew = { value: me, rev: 1 };
      L.landTile(O, [{ key: block[0], ax: 1, az: 1, ay: 9, old: 3, oldCrew: me }], frame);
      L.touch(O, { key: block[1], faction: me, stage: 1, cracks: 0, hits: 1, tended: NOW }, NOW + 10);
      L.touch(O, { key: block[0], faction: me, stage: 4, cracks: 0, hits: 4, tended: NOW }, NOW + 20);
      const two = [sq(block[0], 4), sq(block[1], 1)].sort(bySquare), a0 = two.findIndex((q) => L.packSquare(q.ix, q.iz) === block[0]), b0 = 1 - a0;
      ok(same(L.orderFrom(O, two, me)) === same([a0, a0, a0, b0, a0]), () => `old paint's order: ${same(L.orderFrom(O, two, me))}`);
      L.touch(O, { key: block[0], faction: me, stage: 4, cracks: 0, hits: 5, tended: NOW + 30 }, NOW + 30);
      ok(O.climbs.filter((c) => c[0] === 0).length === 1 && O.squares.get(block[0]).rev === NOW + 30, 'old paint noted twice, or an encore stepped its rev');
      // a card whose note has been let go never lands again: 70 more cards opened after it
      const F = fresh();
      F.crew = { value: me, rev: 1 };
      const fc = cardOf(block.slice(0, 3).map((k) => [k, 2]), them, rnd), fe = text(fc);
      L.openLink(F, visitOf(fe.text), frame, NOW);
      L.openLink(F, visitOf(text(cardOf(block.slice(0, 3).map((k) => [k, 1]), them, rnd)).text), frame, NOW + 1);
      for (let i = 0; i < 70; i++) L.openLink(F, visitOf(text({ ...cardOf([[block[5 + (i % 9)], 1]], them, rnd), at: L.cardMinute(NOW) + i }).text), frame, NOW + 2 + i);
      L.trim(F);
      ok(!F.notes.has(fe.id) && F.seen.has(fe.id30), 'the row needs the first card\'s note let go and its short id kept');
      const before = same([...F.squares.values()].sort((p, q) => p.key - q.key)), again = L.openLink(F, visitOf(fe.text), frame, NOW + 500);
      ok(again.kind === 'seen' && again.landed.length === 0 && same([...F.squares.values()].sort((p, q) => p.key - q.key)) === before, `a card whose note was let go landed again: ${again.kind}`);
      const back = L.parseSave(L.saveText(F)).save;
      ok(L.openLink(back, visitOf(fe.text), frame, NOW + 501).kind === 'seen', 'the cards known did not survive the save');
      // a postcard of here: the player's own squares round it, 32 at most, within the box, sorted; none where the square isn't the player's
      const H = fresh();
      H.crew = { value: me, rev: 1 };
      const c0 = block[0], cx = L.squareIx(c0), cz = L.squareIz(c0);
      for (let dz = -9; dz <= 9; dz++) for (let dx = -9; dx <= 9; dx++) if (rnd() < 0.6 || (!dx && !dz)) H.squares.set(L.packSquare(cx + dx, cz + dz), { key: L.packSquare(cx + dx, cz + dz), owner: rnd() < 0.8 ? me : them, stage: rnd.int(1, 5), cracks: 0, hits: 1, tended: 0, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: 1, card: -1, guest: false });
      H.squares.get(c0).owner = me, (H.squares.get(c0).stage = 2);
      const got = L.squaresFor(H, c0, me), card = { v: 1, map: 0, ix: cx, iz: cz, crew: me, at: 0, caption: '', body: { form: 'squares', squares: got, order: L.orderFrom(H, got, me), answers: null, score: null } };
      const mine = [...H.squares.values()].filter((r) => r.owner === me && r.stage <= 4 && Math.max(Math.abs(L.squareIx(r.key) - cx), Math.abs(L.squareIz(r.key) - cz)) <= 7);
      ok(L.cardFault(card) === '' && got.length === Math.min(32, mine.length) && got.some((q) => q.ix === cx && q.iz === cz), () => `a postcard of here: ${L.cardFault(card)}, ${got.length} squares of ${mine.length}`);
      const far = Math.max(...got.map((q) => Math.max(Math.abs(q.ix - cx), Math.abs(q.iz - cz)))), nearer = mine.filter((r) => Math.max(Math.abs(L.squareIx(r.key) - cx), Math.abs(L.squareIz(r.key) - cz)) < far).length;
      ok(nearer <= got.length, 'a postcard of here passed over a nearer square for a farther one');
      ok(L.squaresFor(H, L.packSquare(cx + 30, cz), me).length === 0 && L.squaresFor(H, c0, them).length === 0, 'a postcard of a square that is not the player\'s');
    }
    // 14. the frame, pinned: the Golden Gate's own square, every neighbourhood's page name and heart, the city's number
    ok(frame.map === 0 && L.mapOf('sf') === 0 && L.mapOf('amsterdam') === 1 && L.mapOf('london') === 2 && L.mapOf('paris') === -1, 'the cities\' numbers');
    ok(frame.mark('ggb') === L.packSquare(-41, -34) && frame.place('ggb') === L.packSquare(-41, -34) && frame.mark('GGB') === -1 && frame.mark('nope') === -1, `the Golden Gate's square is ${L.squareIx(frame.mark('ggb'))},${L.squareIz(frame.mark('ggb'))}`);
    table.names.forEach((name, n) => {
      ok(frame.place(L.slugOf(name)) === table.hearts[n] && frame.pageOf(table.hearts[n]) === L.slugOf(name) && table.squares[n].every((k) => frame.pageOf(k) === L.slugOf(name)), `${name}: its page name, its heart, its squares`);
    });
    ok(frame.pageOf(water) === '' && frame.pageOf(off) === '' && same(L.cardKeys(cardOf([[open[3], 1], [open[4], 2]], 1, rnd)).sort()) === same([open[3], open[4]].sort()) && L.cardKeys({ v: 1, map: 0, ix: 0, iz: 0, crew: 1, at: 0, caption: '', body: null }).length === 0, 'pageOf, cardKeys');
    const custom = L.frameFrom({ slug: 'sf', bounds: sf.city.bounds, landmarks: sf.city.landmarks }, table, L.slugOf, { top: (k) => (k === water ? 2 : 0), crews: 3 });
    ok(custom.top(water) === 2 && custom.top(open[0]) === 0 && custom.crews === 3, 'the engine\'s own word on a square\'s top');
    return `${checks.toLocaleString('en')} checks of what a card does: a newcomer is dealt a crew that is not the sender's; every square the card names becomes the card's, the player's own and higher ones included, anchors kept; a same-crew card wears the next crew round the wheel; a god's square, water and a square the card has been on are left alone, a tagged square stops at 3; opened twice nothing changes; a torn card lands the same squares under the same id; a score, a landmark's card, a place alone, another city's card and one off the map write nothing; a sent card never lands at home; an answer and a take-back mark the right card taken, and only a card that lands on a sent card's own square answers it; a phone that painted before is Rainbow and a new one is dealt the same crew by a link whole or torn; a card's squares never wear the player's own crew, whatever crew is picked later; the frame's squares and page names are pinned`;
  });

  // ---- tiles ----

  const groundOf = (key) => {
    const h = Math.imul(key ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    return { ax: h % 128, az: (h >>> 7) % 128, ay: ((h >>> 14) % 4000) - 500 };
  };
  const tileOf = (key) => `${Math.floor(L.squareIx(key) / 2)},${Math.floor(L.squareIz(key) / 2)}`;
  const clone = (s) => {
    const o = L.emptySave();
    for (const [k, r] of s.squares) o.squares.set(k, { ...r });
    for (const [k, m] of s.marks) o.marks.set(k, { ...m });
    for (const [k, n] of s.notes) o.notes.set(k, { ...n });
    o.crew = { ...s.crew };
    o.climbs = s.climbs.slice();
    return o;
  };
  /** A place, a phone and a card: nine tiles round the card's own square, old paint on some squares, a save from before, the card to land. */
  const scenario = (rnd, want = {}) => {
    let subject;
    for (;;) {
      subject = rnd.pick(open);
      const n = L.nineTiles(subject).flatMap(([tx, tz]) => [0, 1, 2, 3].map((q) => L.packSquare(tx * 2 + (q & 1), tz * 2 + (q >> 1)))).filter((k) => frame.top(k) > 0).length;
      if (n >= 26) break;
    }
    const tiles = L.nineTiles(subject).map(([tx, tz]) => ({
      id: `${tx},${tz}`,
      squares: [0, 1, 2, 3].map((q) => {
        const key = L.packSquare(tx * 2 + (q & 1), tz * 2 + (q >> 1));
        return { key, ...groundOf(key), old: rnd() < 0.4 ? rnd.int(1, 5) : 0, oldCrew: rnd() < 0.5 ? undefined : rnd.int(1, 5) };
      }),
    }));
    const block = tiles.flatMap((t) => t.squares.map((q) => q.key)), mine = want.newcomer ? 0 : rnd.int(1, 5), sender = want.sameCrew && mine ? mine : rnd.int(1, 5);
    // the card: its own square and up to 16 more of the block, and now and then one outside the nine tiles
    const around = rnd.shuffle(block.filter((k) => k !== subject && frame.top(k) > 0)).slice(0, rnd.pick([0, 3, 8, 16, 16]));
    if (rnd() < 0.5) around.push(L.packSquare(L.squareIx(subject) + 4, L.squareIz(subject)));
    const card = cardOf([[subject, rnd.int(1, 4)], ...around.map((k) => [k, rnd.int(1, 4)])], sender, rnd), e = text(card);
    const prior = L.emptySave(), now = NOW + rnd.int(0, 1000);
    if (mine) prior.crew = { value: mine, rev: 3 };
    for (const k of block) {
      if (rnd() > (want.busy ? 0.7 : 0.3) || (frame.top(k) < 1 && rnd() < 0.5)) continue;
      const stage = want.god && k === around[0] ? 5 : rnd.int(1, Math.min(4, frame.top(k) || 2));
      const r = { key: k, owner: rnd() < 0.6 && mine ? mine : rnd.int(1, 5), stage, cracks: stage === 4 ? rnd.int(0, 1) : 0, hits: rnd.int(stage, 30), tended: now - rnd.int(100, 9000), ax: 0, az: 0, ay: L.NO_ANCHOR,
        rev: want.clockBack && rnd() < 0.5 ? now + rnd.int(1, 500) : now - rnd.int(1, 9000), card: rnd() < 0.1 ? e.id30 : rnd() < 0.2 ? rnd.int(0, 999) : -1, guest: false };
      r.guest = r.card >= 0 && rnd() < 0.5;
      prior.squares.set(k, r);
    }
    // (an earlier visit that had some of these tiles in: their anchors, and their old paint's records, are already saved)
    if (want.earlier) for (const t of rnd.shuffle(tiles.slice()).slice(0, rnd.int(1, 8))) L.landTile(prior, t.squares, frame);
    const keys = [...new Set([...block, ...card.body.squares.map((q) => L.packSquare(q.ix, q.iz)), ...prior.squares.keys()])].sort((a, b) => a - b);
    return { tiles, prior, priorText: L.saveText(prior), visit: visitOf(e.text, 'mission', 2), now, keys, mine, sender, e };
  };
  /** The saved city after these things happen in this order: 'card' (the address is opened), a tile's number, 'reload' (a new page: no tile is in). */
  const play = (sc, events, rules = {}) => {
    let save = clone(sc.prior);
    const tilesIn = new Set(), ground = (key) => (tilesIn.has(tileOf(key)) ? groundOf(key) : null);
    for (const ev of events) {
      if (ev === 'card') {
        if (rules.keepOwn) {
          // (the wrong rule, kept to show the row can tell: a card leaves the receiver's own squares alone)
          const stash = [];
          for (const q of sc.visit.link.card.body.squares) {
            const r = save.squares.get(L.packSquare(q.ix, q.iz));
            if (r && r.owner === save.crew.value && r.card !== sc.e.id30) stash.push([r, r.card]), (r.card = sc.e.id30);
          }
          L.openLink(save, sc.visit, frame, sc.now, { ground });
          for (const [r, c] of stash) r.card = c;
        } else L.openLink(save, sc.visit, frame, sc.now, rules.noGround ? {} : { ground });
      } else if (ev === 'reload') {
        save = L.parseSave(L.saveText(save)).save;
        tilesIn.clear();
      } else {
        tilesIn.add(sc.tiles[ev].id);
        L.landTile(save, sc.tiles[ev].squares, frame);
      }
    }
    return save;
  };
  /** a save's fingerprint, quick enough for 362,880 a place: every field of every square that could have a record, the climbs, the cards, the crew */
  const finger = (save, keys) => {
    let h1 = 0x811c9dc5, h2 = 0x1234567;
    const mix = (v) => {
      h1 = Math.imul(h1 ^ v, 16777619);
      h2 = (Math.imul(h2, 31) + v) | 0;
      h2 ^= h2 >>> 13;
    };
    for (const k of keys) {
      const r = save.squares.get(k);
      if (!r) mix(-7);
      else mix(r.owner), mix(r.stage), mix(r.cracks), mix(r.hits), mix(r.tended), mix(r.ax), mix(r.az), mix(r.ay), mix(r.rev), mix(r.card), mix(r.guest ? 1 : 0);
    }
    mix(save.squares.size);
    for (const c of save.climbs) mix(c[0]), mix(c[1]), mix(c[2]);
    mix(save.crew.value), mix(save.crew.rev), mix(save.forgot);
    for (const n of save.notes.values()) mix(n.id30), mix(n.at), mix(n.taken), mix(n.text.length), mix(n.role === 'out' ? 1 : 0), mix(n.gen);
    return h1 * 4294967296 + (h2 >>> 0);
  };
  const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  /** every order of the nine, by Heap's way */
  const everyOrder = (visit) => {
    const a = ALL.slice(), c = new Array(9).fill(0);
    visit(a);
    for (let i = 1; i < 9; ) {
      if (c[i] < i) {
        const j = i % 2 ? c[i] : 0;
        [a[j], a[i]] = [a[i], a[j]];
        visit(a);
        c[i]++;
        i = 1;
      } else c[i++] = 0;
    }
  };

  await row('tiles', () => {
    const rnd = dice(15);
    // six places, each through all 362,880 orders of its nine tiles; the card lands first (as a page does it), or with four tiles in, or last
    const kinds = [['a newcomer', { newcomer: true }, 0], ['a returning player with squares of their own under the card', { busy: true }, 0], ['a card of the player\'s own crew', { busy: true, sameCrew: true }, 0],
      ['a god under the card, and a clock put back', { busy: true, god: true, clockBack: true }, 0], ['an earlier visit that had some of the tiles in, the card landing with four tiles in', { busy: true, earlier: true }, 4], ['the card landing last', { busy: true, earlier: true }, 9]];
    let orders = 0, texts = 0;
    for (const [name, want, cardAt] of kinds) {
      const sc = scenario(rnd, want), ref = play(sc, ['card', ...ALL]), refFinger = finger(ref, sc.keys), refText = L.saveText(ref);
      need(ref.notes.size >= 1, `${name}: the card did not land at all`);
      // what the tiles themselves did, asked outright (the orders below can only say they all agree): against the same play with no tile at all
      const bare = play(sc, ['card']);
      for (const t of sc.tiles)
        for (const q of t.squares) {
          const r = ref.squares.get(q.key), b = bare.squares.get(q.key), top = frame.top(q.key);
          if (b) need(r && r.owner === b.owner && r.stage === b.stage && r.cracks === b.cracks && r.hits === b.hits && r.rev === b.rev && r.card === b.card && r.guest === b.guest, `${name}: a tile changed whose a square is or how high`);
          else if (q.old > 0 && top >= 1) need(r && r.owner === (q.oldCrew ?? 1) && r.stage === Math.min(3, q.old, top) && r.hits === r.stage && r.cracks === 0 && r.rev === 0 && r.tended === 0 && r.card === -1 && !r.guest, () => `${name}: old paint of level ${q.old} made ${same(r)}`);
          else need(!r, `${name}: a tile made a record from nothing`);
          if (r) need(r.ax === q.ax && r.az === q.az && r.ay === q.ay, `${name}: a record under a loaded tile has not its anchor`);
        }
      everyOrder((p) => {
        const ev = [...p.slice(0, cardAt), 'card', ...p.slice(cardAt)], got = play(sc, ev);
        if (finger(got, sc.keys) !== refFinger || (orders % 997 === 0 && (texts++, L.saveText(got) !== refText))) throw new Error(`${name}: the order ${ev.join(' ')} gave another saved city than card 0 1 2 3 4 5 6 7 8`);
        orders++;
      });
    }
    // then 400 more places with everything loose: the card at any point, a reload (a new page: every tile lands again, the address is opened again) at any point or two
    let loose = 0;
    for (let i = 0; i < 400; i++) {
      const sc = scenario(rnd, { newcomer: rnd() < 0.2, busy: rnd() < 0.7, sameCrew: rnd() < 0.3, god: rnd() < 0.2, clockBack: rnd() < 0.2, earlier: rnd() < 0.5 });
      const refText = L.saveText(play(sc, ['card', ...ALL]));
      for (let j = 0; j < 60; j++) {
        const first = rnd.shuffle(ALL.slice()), ev = first.slice();
        ev.splice(rnd.int(0, 9), 0, 'card');
        for (let reloads = rnd.pick([0, 0, 1, 2]); reloads > 0; reloads--) {
          ev.length = rnd.int(0, ev.length);
          const next = rnd.shuffle(ALL.slice());
          next.splice(rnd.int(0, 9), 0, 'card');
          ev.push('reload', ...next);
        }
        if (!ev.includes('card')) ev.push('card');
        need(L.saveText(play(sc, ev)) === refText, () => `place ${i}: ${ev.join(' ')} gave another saved city than card 0 1 2 3 4 5 6 7 8`);
        loose++;
      }
    }
    // and the row can tell: two wrong rules, each of which must be caught
    const caught = { keepOwn: 0, noGround: 0 };
    for (let i = 0; i < 300; i++) {
      const sc = scenario(rnd, { busy: true, sameCrew: rnd() < 0.5, earlier: rnd() < 0.5 });
      for (const rule of ['keepOwn', 'noGround']) {
        const seen = new Set();
        for (let j = 0; j < 12; j++) {
          const ev = rnd.shuffle(ALL.slice());
          ev.splice(rnd.int(0, 9), 0, 'card');
          seen.add(L.saveText(play(sc, ev, { [rule]: true })));
        }
        if (seen.size > 1) caught[rule]++;
      }
    }
    need(caught.keepOwn > 20 && caught.noGround > 20, `the row did not catch the wrong rules it is meant to: ${same(caught)}`);
    return `every one of the ${(orders / kinds.length).toLocaleString('en')} orders nine tiles can load in gives the same saved city, at ${kinds.length} places (${kinds.map((k) => k[0]).join('; ')}): ${orders.toLocaleString('en')} orders, ${texts.toLocaleString('en')} of them also compared as whole save texts. ${loose.toLocaleString('en')} more plays at 400 places with the card landing at any point and one or two reloads in the middle: the same. Two wrong rules are caught by the same plays: "a card leaves the receiver's own squares alone" gave more than one saved city at ${caught.keepOwn} of 300 places, and "a record made after its tile landed gets no anchor" at ${caught.noGround}`;
  });

  await row('engine', () => {
    const rnd = dice(16), realm = new L.Neighbourhoods(table);
    let games = 0, exact = 0, long = 0, takes = 0, wheel = 0;
    for (let g = 0; g < 400; g++) {
      const me = rnd.int(1, 5), rival = (me % 5) + rnd.int(1, 4) > 5 ? ((me + 1) % 5) + 1 : (me % 5) + 1;
      const c = rnd.pick(open), keys = [];
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
        const k = L.packSquare(L.squareIx(c) + i, L.squareIz(c) + j);
        if (frame.top(k) > 0) keys.push(k);
      }
      rnd.shuffle(keys).splice(rnd.int(1, 17));
      const areas = new L.Areas(undefined, realm), save = L.emptySave(), truth = new Map();
      save.crew = { value: me, rev: 1 };
      let t = 0, tick = 0, forgot = false;
      areas.onChange = (a) => L.touch(save, a, (NOW + t) * 1000);
      const marathon = g % 8 === 0, steps = marathon ? rnd.int(5000, 8000) : rnd.int(20, 160);
      for (let s = 0; s < steps; s++) {
        const key = rnd.pick(keys), who = rnd() < 0.8 ? me : rival, { x, z } = L.squareCentre(key), was = areas.all.get(key), ws = was ? was.stage : 0, wf = was ? was.faction : 0;
        t += marathon ? rnd.pick([1, 6, 6]) : rnd.pick([0.25, 0.25, 1, 6]);
        const a = areas.hit(x, z, who, t, { now: Math.floor(NOW + t) }).area, list = truth.get(key) ?? [];
        if (a.faction !== wf) (list.length = 0), list.push(++tick);
        else if (a.stage > ws) list.push(++tick);
        else if (a.stage < ws) list.length = a.stage;
        truth.set(key, list);
        if (save.climbs.length > L.saveTune.climbs) (forgot = true), L.trim(save), need(save.forgot > 0 && save.climbs.length === L.saveTune.climbs, 'trim kept no count of the climbs it let go');
      }
      // the save's first 16 bytes a square are the engine's own save, byte for byte
      need(L.areasText(save.squares) === areas.encode(), `game ${g}: the save's squares are not what areas.ts itself saves`);
      const read = new L.Areas(undefined, realm);
      need(read.decode(L.areasText(save.squares)), `game ${g}: areas.ts would not read the save's squares`);
      const mine = keys.filter((k) => areas.all.get(k)?.faction === me && areas.all.get(k).stage <= 4).map((k) => ({ key: k, stage: areas.all.get(k).stage })).sort((p, q) => bySquare(sq(p.key, 0), sq(q.key, 0)));
      if (!mine.length) continue;
      games++;
      // the card's order, out of the climbs the save kept: always one a card can carry, and the true one while nothing has been forgotten
      const squares = mine.map((m) => sq(m.key, m.stage)), order = L.orderFrom(save, squares, me);
      need(L.orderOk(order, squares), `game ${g}: the order from the climbs is none a card can carry`);
      const want = [];
      mine.forEach((m, j) => truth.get(m.key).forEach((tk) => want.push([tk, j])));
      want.sort((a, b) => a[0] - b[0]);
      if (!forgot) {
        need(same(want.map((w) => w[1])) === same(order), `game ${g}: the order from the climbs is not the order the squares climbed in`);
        exact++;
      } else long++;
      // sent, read, and landed on a friend's phone: the same squares at the same stages, under the sender's crew; then the friend's own engine takes one back
      const own = rnd.pick(mine), card = { v: 1, map: 0, ix: L.squareIx(own.key), iz: L.squareIz(own.key), crew: me, at: L.cardMinute(Math.floor(NOW + t)), caption: 'A BLOCK', body: { form: 'squares', squares, order, answers: null, score: null } };
      const e = text(card);
      for (const sameCrew of [false, true]) {
        const friend = L.emptySave();
        if (sameCrew) friend.crew = { value: me, rev: 1 };
        const l = L.openLink(friend, visitOf(e.text), frame, Math.floor(NOW + t) + 60), theirs = friend.crew.value;
        need(l.kind === 'flyby' && l.as !== theirs && (sameCrew ? l.as === (me % 5) + 1 : l.as === me), `game ${g}: the friend's landing was ${l.kind}, worn ${l.as} against their ${theirs}`);
        const eng = new L.Areas(undefined, realm);
        need(eng.decode(L.areasText(friend.squares)), `game ${g}: the friend's engine would not read their save`);
        for (const m of mine) {
          const a = eng.all.get(m.key);
          need(a && a.faction === l.as && a.stage === Math.min(m.stage, frame.top(m.key)) && a.cracks === 0, () => `game ${g}: square ${m.key} landed as ${same(a)}, sent at stage ${m.stage}`);
        }
        eng.onChange = (a) => L.touch(friend, a, Math.floor(NOW + t) + 100 + tt);
        const { x, z } = L.squareCentre(own.key), was = { ...friend.squares.get(own.key) }, out = [];
        let tt = 0;
        for (let h = 0; h < 8 && eng.all.get(own.key).faction !== theirs; h++) out.push(eng.hit(x, z, theirs, (tt += 6), { now: Math.floor(NOW + t) + 100 + tt }).outcome);
        const stage = was.stage, wantOut = [...(stage === 4 ? ['crack'] : []), ...Array(stage - 1).fill('down'), 'flip'];
        need(same(out) === same(wantOut) && eng.all.get(own.key).faction === theirs && eng.all.get(own.key).stage === 1, () => `game ${g}: taking back a stage-${stage} square went ${out.join(' ')}, not ${wantOut.join(' ')}`);
        const rec = friend.squares.get(own.key), note = L.noteTaken(friend, own.key, was, Math.floor(NOW + t) + 200);
        need(rec.owner === theirs && !rec.guest && rec.card === e.id30 && note && note.id === e.id && note.taken > 0, `game ${g}: the square taken back, or its card's note`);
        takes++;
        if (sameCrew) wheel++;
      }
    }
    return `${games} games on the real areas.ts with a rival knocking squares down and hits four a second, every change saved through touch: the save's squares are byte for byte what areas.ts itself saves; the card's order from the kept climbs is always one a card can carry, and in all ${exact} games that fit the ${L.saveTune.climbs} kept climbs it is the true order the stages were reached in (${long} longer games: older climbs first); the card lands on a friend's phone at the same stages, and the friend's own engine takes the card's square back hit by hit (crack, down, flip) in ${takes} of ${takes} tries, ${wheel} of them a friend of the sender's own crew`;
  });

  await row('tabs', () => {
    const rnd = dice(17), keys = Array.from({ length: 10 }, (_, i) => open[200 + i]);
    const mem = (text) => ({ text, backend: null });
    const storeOf = () => {
      const st = mem(null);
      st.backend = L.storageBackend({ getItem: () => st.text, setItem: (_, t) => (st.text = t) }, 'sf');
      return st;
    };
    const run = (naive) => {
      let lostWork = 0;
      for (let g = 0; g < 300; g++) {
        const store = storeOf(), tabs = [L.emptySave(), L.emptySave()], best = new Map(), sent = new Set(), touched = [new Set(), new Set()];
        let clock = NOW;
        const flush = (i) => {
          if (naive) return void (store.text = L.saveText(tabs[i]));
          const before = tabs[i], f = L.flush(before, store.backend, clock), said = new Set(L.changedSquares(before, f.save).map((r) => r.key));
          // (what a flush brought in from the other tab is exactly what changedSquares names)
          for (const k of said) need(touched[1 - i].has(k), `run ${g}: changedSquares named a square the other tab never touched`);
          for (const [k, r] of f.save.squares) if (same(before.squares.get(k)) !== same(r)) need(said.has(k), `run ${g}: a square the flush changed was not named by changedSquares`);
          need(f.wrote && f.lost === 0, `run ${g}: a flush lost ${f.lost}`);
          tabs[i] = f.save;
        };
        for (let step = 0; step < 60; step++) {
          const i = rnd.int(0, 1), tab = tabs[i], act = rnd();
          clock += rnd.int(0, 3);
          if (act < 0.5) {
            const key = rnd.pick(keys), r = L.touch(tab, { key, faction: rnd.int(1, 5), stage: rnd.int(1, 4), cracks: 0, hits: rnd.int(1, 9), tended: clock }, clock);
            touched[i].add(key);
            const b = best.get(key);
            if (!b || r.rev > b.rev) best.set(key, { ...r });
            else if (r.rev === b.rev) best.set(key, null); // (two tabs in the same second: either may stand)
          } else if (act < 0.6) {
            const card = cardOf([[rnd.pick(open), 2]], rnd.int(1, 5), rnd), e = text({ ...card, at: card.at + step });
            L.noteSent(tab, e, card, 0, 'mission', clock);
            sent.add(e.id);
          } else flush(i);
        }
        flush(0), flush(1), flush(0);
        if (naive) {
          // (the wrong way, kept to show the row can tell: each tab writes what it has)
          const stored = L.parseSave(store.text).save;
          for (const [key, b] of best) if (b && same(stored.squares.get(key)) !== same(b)) lostWork++;
          continue;
        }
        const ta = L.saveText(tabs[0]), tb = L.saveText(tabs[1]);
        need(ta === tb && ta === store.text, `run ${g}: the two tabs and the store ended as different saves`);
        for (const [key, b] of best) if (b) need(same(tabs[0].squares.get(key)) === same(b), () => `run ${g}: square ${key}'s last change was lost: ${same(tabs[0].squares.get(key))} stands, ${same(b)} was later`);
        for (const id of sent) need(tabs[0].notes.has(id), `run ${g}: a sent card's note was lost`);
        need(tabs[0].crew.value >= 1, `run ${g}: a phone that sent a card has no crew`);
      }
      return lostWork;
    };
    run(false);
    const lost = run(true);
    need(lost > 100, `the row did not catch tabs that write over each other (${lost})`);
    // a newcomer with two cards open in two tabs: dealt once in the end, and neither card's squares wear the crew that stood
    for (let g = 0; g < 200; g++) {
      const store = storeOf(), tabs = [L.emptySave(), L.emptySave()], c1 = cardOf([[open[300 + g], 2]], rnd.int(1, 5), rnd), c2 = cardOf([[open[900 + g], 1]], rnd.int(1, 5), rnd);
      const l1 = L.openLink(tabs[0], visitOf(text(c1).text), frame, NOW), l2 = L.openLink(tabs[1], visitOf(text({ ...c2, at: c2.at + 1 }).text), frame, NOW + rnd.int(0, 2));
      need(l1.dealt && l2.dealt, 'each tab dealt its newcomer');
      for (const i of [0, 1, 0, 1]) tabs[i] = L.flush(tabs[i], store.backend, NOW + 10 + i).save;
      const crew = tabs[0].crew.value;
      need(L.saveText(tabs[0]) === L.saveText(tabs[1]) && (crew === l1.dealt || crew === l2.dealt), `two cards in two tabs: the tabs differ, or the crew is neither deal (${crew})`);
      need(tabs[0].squares.size === 2 && [...tabs[0].squares.values()].every((r) => r.guest && r.owner !== crew) && tabs[0].notes.size === 2, () => `two cards in two tabs: a card's square wears the player's crew ${crew}: ${same([...tabs[0].squares.values()].map((r) => r.owner))}`);
    }
    // a Storage that throws: private browsing, a full disk
    const broken = L.storageBackend({ getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('full'); } }, 'sf'), one = L.emptySave();
    L.touch(one, { key: keys[0], faction: 1, stage: 1, cracks: 0, hits: 1, tended: NOW }, NOW);
    const f = L.flush(one, broken, NOW);
    need(f.wrote === false && f.save.squares.size === 1 && L.loadSave(broken).save.squares.size === 0, 'a Storage that throws');
    // something stored that is no save: said, and written over with what the tab holds
    const junk = storeOf();
    junk.text = 'not a save';
    const fj = L.flush(one, junk.backend, NOW);
    need(fj.lost === -1 && fj.wrote && L.parseSave(junk.text).save.squares.size === 1 && L.loadSave(junk.backend).lost === 0, 'a store holding something that is no save');
    // a flush holds what it writes to the caps: 250 sent and 100 opened cards (the ten oldest opened still on their squares), 700 climbs
    const big = L.emptySave(), note = (id, id30, role, at) => ({ id, id30, role, text: id, at, gen: 0, place: '', key: 0, crew: 1, taken: 0, answers: -1 });
    for (let i = 0; i < 250; i++) big.notes.set(`1s${i}`, note(`1s${i}`, i, 'out', NOW + i));
    for (let i = 0; i < 100; i++) big.notes.set(`1p${i}`, note(`1p${i}`, 1000 + i, 'in', NOW + i));
    for (let i = 0; i < 10; i++) big.squares.set(i, { key: i, owner: 2, stage: 1, cracks: 0, hits: 1, tended: 0, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: 1, card: 1000 + i, guest: true });
    for (let i = 0; i < 700; i++) L.noteClimb(big, NOW + i, i, 1, 1);
    const bs = storeOf(), fb = L.flush(big, bs.backend, NOW), kept = L.parseSave(bs.text).save, has = (id) => kept.notes.has(id);
    const outs = [...kept.notes.values()].filter((n) => n.role === 'out').length, ins = kept.notes.size - outs;
    need(outs === 192 && ins === 64 && !has('1s57') && has('1s58') && has('1s249') && [...Array(10).keys()].every((i) => has(`1p${i}`)) && !has('1p10') && !has('1p45') && has('1p46') && has('1p99'), `a flush past the caps kept ${outs} sent and ${ins} opened cards, or the wrong ones`);
    need(kept.climbs.length === 512 && kept.climbs[0][1] === 188 && kept.forgot === 188 && fb.save.forgot === 188, `a flush past the caps kept ${kept.climbs.length} climbs from ${kept.climbs[0][1]}, forgot ${kept.forgot}`);
    need(L.lastSent(kept).id === '1s249' && L.lastSent(L.emptySave()) === null, 'the newest sent card');
    return `300 runs of two tabs on one store, 60 steps each (squares changed, cards sent, flushes at any time): both tabs and the store end as one save, the later change of every square stands, no sent card is forgotten, and each flush names exactly the squares the other tab changed. The same runs with each tab simply writing what it has lose ${lost.toLocaleString('en')} squares' last changes, which is what the join is for. A newcomer with two cards open in two tabs ends with one crew that no card's square wears (200 runs). A Storage that throws reads as empty and says the write failed; a store holding something else is said and written over; past its caps a flush writes 192 sent cards, 64 opened (those still on their squares kept first) and the newest 512 climbs`;
  });

  await row('records', () => {
    let checks = 0;
    const ok = (cond, said) => (checks++, need(cond, said));
    // one record, pinned to its bytes
    const good = { key: L.packSquare(-3, 14), owner: 2, stage: 4, cracks: 1, hits: 7, tended: NOW, ax: 100, az: 27, ay: 123, rev: NOW + 5, card: 562624823, guest: true };
    const hex = Buffer.from(L.pack(good)).toString('hex');
    if (process.argv.includes('--print-golden')) console.log(`record: ${hex}`);
    ok(process.argv.includes('--print-golden') || hex === PINS.record, `the record's bytes moved: ${hex}`);
    ok(same(L.unpack(L.pack(good))) === same(good), 'the pinned record did not read back');
    // unpack's refusals, a field at a time, and the edges it must take
    const bent = (f) => {
      const b = L.pack(good);
      f(b, new DataView(b.buffer));
      return L.unpack(b);
    };
    const refused = { 'crew 0': (b) => (b[4] = 0), 'crew 16': (b) => (b[4] = 16), 'crew 255': (b) => (b[4] = 255), 'stage 0': (b) => (b[5] = 0x10), 'stage 6': (b) => (b[5] = 6), 'stage 9': (b) => (b[5] = 9), 'stage 15': (b) => (b[5] = 15),
      'an anchor 128 m across a 128 m square': (b) => (b[12] = 128), 'an anchor 200 m down it': (b) => (b[13] = 200), 'no anchor, yet a place in the square': (b, v) => v.setInt16(14, L.NO_ANCHOR, true),
      'a guest no card brought': (b, v) => v.setUint32(20, 0x80000000, true), 'a card\'s id with no card': (b, v) => v.setUint32(20, 5, true) };
    for (const [what, f] of Object.entries(refused)) ok(bent(f) === null, `a record with ${what} was read`);
    const taken = { 'crew 15': (b) => (b[4] = 15), 'a god': (b) => (b[5] = 5), '15 cracks': (b) => (b[5] = 0xf4), 'an anchor at the far corner': (b) => (b[12] = b[13] = 127), 'no anchor': (b, v) => ((b[12] = b[13] = 0), v.setInt16(14, L.NO_ANCHOR, true)), 'no card': (b, v) => v.setUint32(20, 0, true) };
    for (const [what, f] of Object.entries(taken)) ok(bent(f) !== null, `a record with ${what} was refused`);
    ok(L.unpack(new Uint8Array(23)) === null && L.unpack(L.pack(good), 1) === null && L.unpack(L.pack(good), -1) === null, 'a short record was read');
    // the join: the later record stands; a tie falls the same way on both phones; the anchor comes from whichever has one
    const plainRec = { ...good, card: -1, guest: false }, later = { ...plainRec, stage: 2, hits: 1, rev: plainRec.rev + 1 }, tie = { ...plainRec, owner: 3 };
    ok(L.joinRec(plainRec, later) === later && L.joinRec(later, plainRec) === later, 'the later record lost a join');
    ok(L.joinRec(plainRec, tie).owner === 3 && L.joinRec(tie, plainRec).owner === 3 && L.joinRec(plainRec, undefined) === plainRec && L.joinRec(undefined, plainRec) === plainRec, 'two records of one second fell two ways');
    // (a tie of one second falls by owner, then stage, then cracks, hits, tended, card: pinned, so that two builds never pick two records)
    const t1 = { ...plainRec, owner: 2, stage: 3, hits: 9 }, t2 = { ...plainRec, owner: 3, stage: 1, hits: 1 }, t3 = { ...plainRec, owner: 3, stage: 1, cracks: 1 };
    ok(L.joinRec(t1, t2) === t2 && L.joinRec(t2, t1) === t2 && L.joinRec(t2, t3) === t3 && L.joinRec(t3, t2) === t3, 'the order a tie falls in moved');
    ok(L.unpack(L.pack({ ...plainRec, rev: L.CLOCK_TOP + 1 })) === null, 'a record with a rev past 2100 was read');
    // a tile's old paint on a square nothing can be lifted on makes no record; on one that can, it does
    const wet = L.emptySave(), waterKey = (() => { for (let i = -68; i < 44; i++) if (frame.inside(L.packSquare(i, 0)) && frame.top(L.packSquare(i, 0)) === 0) return L.packSquare(i, 0); })();
    L.landTile(wet, [{ key: waterKey, ax: 1, az: 1, ay: 5, old: 3 }, { key: open[9], ax: 1, az: 1, ay: 5, old: 3 }], frame);
    ok(!wet.squares.has(waterKey) && wet.squares.get(open[9]).stage === 3 && wet.squares.get(open[9]).rev === 0, 'old paint on water made a record');
    // the cards known by their short id: joined as a union, the first time each was known, and held to the cap newest first, notes' own always kept
    const k1 = L.emptySave(), k2 = L.emptySave();
    k1.seen.set(5, 100), k1.seen.set(6, 50), k2.seen.set(5, 90), k2.seen.set(7, 70);
    const kj = L.joinSave(k1, k2);
    ok(same([...kj.seen].sort()) === same([[5, 90], [6, 50], [7, 70]]) && same([...L.joinSave(k2, k1).seen].sort()) === same([[5, 90], [6, 50], [7, 70]]), 'the cards known were joined wrong');
    const many = L.emptySave();
    for (let i = 0; i < 1500; i++) many.seen.set(i, NOW + i);
    many.notes.set('1old', { id: '1old', id30: 3, role: 'in', text: '1old', at: NOW + 3, gen: 0, place: '', key: 0, crew: 2, taken: 0, answers: -1 });
    L.trim(many);
    ok(many.seen.size === 1025 && many.seen.has(1499) && many.seen.has(476) && !many.seen.has(475) && many.seen.has(3), `the cards known held to ${many.seen.size}, or the wrong ones`);
    const twice = L.emptySave(), lines = L.saveText(twice).split('\n');
    lines[1] = Buffer.concat([Buffer.from(L.pack(later)), Buffer.from(L.pack(plainRec))]).toString('base64');
    ok(L.parseSave(lines.join('\n')).save.squares.get(good.key).stage === 2, 'a square written twice in one text: the earlier stood');
    // a card's two notes as one: sent beats opened, the first time, the fuller text, and TAKEN is never forgotten
    const n = (o) => ({ id: '1x', id30: 7, role: 'in', text: '1x', at: 100, gen: 3, place: 'a', key: 9, crew: 2, taken: 0, answers: -1, ...o });
    for (const [a, b] of [[n({}), n({ role: 'out', at: 50, text: '1xyz', taken: 77, gen: 1, place: 'b' })], [n({ role: 'out', at: 50, text: '1xyz', taken: 77, gen: 1, place: 'b' }), n({})]]) {
      const j = L.joinNote(a, b);
      ok(j.role === 'out' && j.at === 50 && j.text === '1xyz' && j.taken === 77 && j.gen === 1 && j.place === 'b' && j.id === '1x' && j.key === 9 && j.crew === 2 && j.answers === -1, () => `two notes joined as ${same(j)}`);
    }
    ok(L.joinNote(n({ taken: 5 }), n({})).taken === 5 && L.joinNote(n({}), n({ taken: 5 })).taken === 5 && L.joinNote(n({}), undefined).id === '1x', 'TAKEN was forgotten by a join');
    const sA = L.emptySave(), sB = L.emptySave();
    sA.notes.set('1x', n({ taken: 9 })), sB.notes.set('1x', n({}));
    ok(L.joinSave(sA, sB).notes.get('1x').taken === 9 && L.joinSave(sB, sA).notes.get('1x').taken === 9, 'TAKEN was forgotten by a flush');
    // a landmark: the later record stands; the door's crown is saved under the landmark's key in any case, and is there on the next visit
    const m1 = { owner: 1, stage: 4, cracks: 0, hits: 9, tended: NOW, rev: 10, card: -1 }, m2 = { ...m1, owner: 3, stage: 1, rev: 11 };
    ok(L.joinMark(m1, m2) === m2 && L.joinMark(m2, m1) === m2 && L.joinMark(m1, undefined) === m1, 'the later landmark record lost a join');
    const door = L.emptySave(), crown = L.touchMark(door, 'GGB', { faction: 1, stage: 4, cracks: 0, hits: 4, tended: NOW }, NOW);
    ok(crown && door.marks.get('ggb') === crown && crown.rev === NOW && crown.owner === 1 && crown.stage === 4 && crown.hits === 4 && crown.tended === NOW && crown.card === -1, `the crown: ${same(crown)}`);
    const next = L.parseSave(L.saveText(door));
    ok(next.lost === 0 && same(next.save.marks.get('ggb')) === same(crown), 'the crown was not there on the next visit');
    const again = L.touchMark(door, 'ggb', { faction: 1, stage: 4, cracks: 1, hits: 5, tended: NOW }, NOW);
    ok(again.rev === NOW + 1 && again.cracks === 1 && door.marks.size === 1, 'a second change of the crown in the same second');
    ok(L.touchMark(door, 'Golden Gate!', { faction: 1, stage: 4, cracks: 0, hits: 4, tended: NOW }, NOW) === null && L.touchMark(door, 'ggb', { faction: 0, stage: 4, cracks: 0, hits: 4, tended: NOW }, NOW) === null && L.touchMark(door, 'ggb', { faction: 1, stage: 6, cracks: 0, hits: 4, tended: NOW }, NOW) === null, 'a landmark record that makes no sense was saved');
    const other = L.emptySave();
    other.marks.set('ggb', m2);
    ok(L.joinSave(door, other).marks.get('ggb').rev === NOW + 1 && L.joinSave(other, door).marks.get('ggb').owner === 1, 'two saves\' landmarks');
    // the save, pinned: its key, and a small one's whole text
    ok(L.saveTune.key('sf') === 'strugglebus.city.v2:sf', `the save's key is ${L.saveTune.key('sf')}`);
    const small = L.emptySave();
    small.squares.set(good.key, good);
    small.marks.set('ggb', m1);
    small.notes.set('1x', n({ role: 'out', taken: 77 }));
    small.crew = { value: 4, rev: NOW };
    small.forgot = 3;
    small.climbs = [[NOW * 1000 + 7, good.key, 0x24]];
    small.seen = new Map([[7, 100], [562624823, NOW]]);
    const smallText = L.saveText(small);
    if (process.argv.includes('--print-golden')) console.log(`save: ${JSON.stringify(smallText)}`);
    ok(process.argv.includes('--print-golden') || smallText === PINS.save, `the save's text moved: ${JSON.stringify(smallText)}`);
    // the card's minute is a date: pinned
    ok(L.cardSeconds(0) === Date.UTC(2026, 0, 1) / 1000 && L.cardMinute(Date.UTC(2026, 10, 14, 18, 30) / 1000) === 457590 && L.cardSeconds(457590) === Date.UTC(2026, 10, 14, 18, 30) / 1000, `a card's minute 0 is ${new Date(L.cardSeconds(0) * 1000).toISOString()}`);
    return `${checks} checks of the records themselves: one record and one small save pinned to their bytes and text, the save's key and the date of a card's minute 0 pinned; ${Object.keys(refused).length} kinds of record that make no sense each refused and ${Object.keys(taken).length} edge ones each read; the later record of a square, a landmark and a card's note stands whichever way round they are joined, a tie falls one way, TAKEN survives a join; the door's crown is saved under ggb and is there on the next visit`;
  });

  await row('last', () => {
    const rnd = dice(18);
    let some = 0, none = 0;
    for (let i = 0; i < 5000; i++) {
      const s = randSave(rnd, [1, 2, 3], Array.from({ length: rnd.int(0, 8) }, (_, n) => `1c${i}x${n}`)), t = L.saveText(s), a = L.lastSent(s);
      let b;
      try {
        b = lastCard(rnd() < 0.9 ? t : t.slice(0, rnd.int(0, t.length)));
      } catch (e) {
        throw new Error(`sbwLastCard threw ${e.message}`);
      }
      if (b && a) need(b.text === a.text && b.at === a.at && b.place === a.place && b.gen === a.gen, () => `save ${i}: the page's reader says the last card is ${same(b)}, save.ts says ${same(a)}`), some++;
      else if (!a) need(b === null, `save ${i}: the page's reader found a sent card where there is none`), none++;
    }
    for (const junk of [undefined, null, 5, {}, '', 'SBW2', 'SBW2\n\n\n', 'SBW2\n\n{}\n{"a":1}\n', 'SBW2\n\n{}\n[[1,2]]\n', 'SBW2\n\n{}\n[null,5,"x",[]]\n', 'SBW3\n\n{}\n[]\n']) need(lastCard(junk) === null, `the page's reader read a card from ${JSON.stringify(junk)}`);
    return `the loading page's reader of the last card sent (stamp.js's sbwLastCard, ES5, run from its source) agrees with save.ts on 5,000 random saves' texts (${some.toLocaleString('en')} with a sent card, ${none.toLocaleString('en')} with none), and reads nothing from what is no save`;
  });

  await row('names', () => {
    // today's page names, from today's hoods.bin: the bake must not make two neighbourhoods one page (M1's task 11 holds the names themselves)
    const by = new Map();
    for (const name of table.names) by.set(L.slugOf(name), [...(by.get(L.slugOf(name)) ?? []), name]);
    const twice = [...by].filter(([, n]) => n.length > 1), empty = table.names.filter((n) => !L.slugOf(n));
    need(!twice.length && !empty.length, () => `page names that collide: ${twice.map(([s, n]) => `${s} (${n.join(', ')})`).join('; ')}${empty.length ? `; names with no page name: ${empty.join(', ')}` : ''}`);
    for (const m of sf.city.landmarks) need(!table.names.some((n) => L.slugOf(n) === L.slugOf(m.kind)), `the landmark ${m.kind} has a neighbourhood's page name`);
    const longest = [...by.keys()].sort((a, b) => b.length - a.length)[0];
    return `San Francisco's ${table.names.length} neighbourhood names and ${sf.city.landmarks.length} landmarks make ${by.size + sf.city.landmarks.length} page names, no two the same; the longest is ${longest} (${longest.length} characters, limit 48)`;
  });
}

/** `node tools/link/fuzz.mjs records --print-golden` prints these as the code now makes them */
const PINS = {
  record: "0e00fdff02140700e0f2f86a641b7b00e5f2f86a37f988e1",
  save: "SBW2\nDgD9/wIUBwDg8vhqZBt7AOXy+Go3+Yjh\n{\"ggb\":[1,4,0,9,1794700000,10,-1]}\n[[\"1x\",7,1,\"1x\",100,3,\"a\",9,2,77,-1]]\n[4,1794700000,3]\nAHCwS8cdekIOAP3/JAAA\nBwAAAGQAAAAAN/mIIeDy+GoA",
};
