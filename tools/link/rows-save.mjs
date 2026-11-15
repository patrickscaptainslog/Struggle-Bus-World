// The save's rows: records and whole saves round-trip, saves join in any order, a card lands by its rules, tiles land in any order, the real engine agrees,
// and two tabs can't lose each other's work.
import { dice, same, randCard, randOrder, need } from './lib.mjs';

const NOW = 1794700000; // (a November 2026 evening, epoch s)

export async function saveRows(R, L, sf) {
  const { row } = R;
  const table = L.parseHoods(sf.hoods);
  if (!table) throw new Error('hoods.bin would not parse');
  const frame = L.frameFrom({ map: 0, bounds: sf.city.bounds, landmarks: sf.city.landmarks }, table, L.slugOf);
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
      rev: rnd.pick([0, 1, NOW, NOW + 1, rnd.int(0, 0xfffffffe)]), card: has ? rnd.int(0, 2 ** 30 - 1) : -1, guest: has && rnd() < 0.5,
    };
  };
  const randNote = (rnd, id) => ({
    id, id30: rnd.int(0, 2 ** 30 - 1), role: rnd() < 0.3 ? 'out' : 'in', text: id + (rnd() < 0.5 ? 'tail' : ''), at: rnd.pick([NOW, NOW + 5, rnd.int(0, 0xffffffff)]), gen: rnd.int(0, 99),
    place: rnd.pick(['', 'mission', 'noe-valley']), key: rnd.int(0, 0xffffffff), crew: rnd.int(1, 5), as: rnd.int(0, 5), taken: rnd() < 0.7 ? 0 : rnd.int(1, 0xffffffff), answers: rnd() < 0.7 ? -1 : rnd.int(0, 2 ** 30 - 1),
  });
  /** a random save over a small set of squares and cards, so that two of them overlap, and often tie */
  const randSave = (rnd, keys, ids) => {
    const s = L.emptySave();
    for (const k of keys) if (rnd() < 0.6) s.squares.set(k, randRec(rnd, k));
    for (const m of ['ggb', 'sutro', 'baybridge']) if (rnd() < 0.4) s.marks.set(m, { owner: rnd.int(1, 5), stage: rnd.int(1, 4), cracks: rnd.int(0, 1), hits: rnd.int(0, 9), tended: rnd.pick([0, NOW]), rev: rnd.pick([1, NOW, NOW + 1]), card: rnd() < 0.5 ? -1 : rnd.int(0, 99) });
    for (const id of ids) if (rnd() < 0.5) s.notes.set(id, randNote(rnd, id));
    s.crew = { value: rnd.int(0, 5), rev: rnd.pick([0, 1, NOW]) };
    for (let n = rnd.int(0, 12); n > 0; n--) L.noteClimb(s, rnd.pick([NOW, NOW + 1, NOW + 2]), rnd.pick(keys), rnd.int(1, 5), rnd.int(1, 4));
    return s;
  };

  await row('saved', () => {
    const rnd = dice(11);
    let records = 0, refused = 0, kept = 0;
    for (let i = 0; i < 10000; i++) {
      const keys = Array.from({ length: rnd.int(0, 40) }, () => rnd.int(0, 0xffffffff)), ids = Array.from({ length: rnd.int(0, 6) }, (_, n) => `1card${i}x${n}`);
      const s = randSave(rnd, keys, ids), t = L.saveText(s), back = L.parseSave(t);
      need(back.lost === 0, `save ${i}: ${back.lost} lost on the way back`);
      need(L.saveText(back.save) === t, `save ${i} did not come back as it was written`);
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
    need(moved && same([...moved.values()].sort((a, b) => a.key - b.key)) === same([...old.squares.values()].sort((a, b) => a.key - b.key)), "the old save's squares did not come across");
    need(L.fromAreasText('not base64!') === null && L.fromAreasText('AAAA') === null, 'a broken old save was read');
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
      [NOW, { rev: NOW }, NOW + 1], [NOW - 86400, { rev: NOW }, NOW + 1], [NOW, { rev: 0 }, NOW], [0, { rev: 0 }, 1], [4.33e9, null, 0xfffffffe], [4.33e12, null, 0xfffffffe], [NOW, { rev: 0xfffffffe }, 0xfffffffe], [4.33e9, { rev: 0xfffffffd }, 0xfffffffe]];
    for (const [now, old, want] of cases) need(L.nextRev(old, now) === want, () => `a change at ${now} over rev ${old ? old.rev : 'none'} got rev ${L.nextRev(old, now)}, not ${want}`);
    // a phone whose clock was put back a day still writes the later record, and the join takes it
    const key = L.packSquare(3, 3), a = L.emptySave(), b = L.emptySave();
    L.touch(a, { key, faction: 2, stage: 2, cracks: 0, hits: 2, tended: NOW }, NOW);
    b.squares.set(key, { ...a.squares.get(key) });
    L.touch(b, { key, faction: 2, stage: 3, cracks: 0, hits: 3, tended: NOW }, NOW - 86400);
    need(L.joinSave(a, b).squares.get(key).stage === 3 && L.joinSave(b, a).squares.get(key).stage === 3, 'a change made with the clock put back lost to the record it changed');
    // a clock in 2107 is past what a record can hold: it is held at the last value, written, read back, and never wraps round to the start
    const far = L.emptySave();
    L.touch(far, { key, faction: 1, stage: 1, cracks: 0, hits: 1, tended: NOW }, Date.UTC(2107, 0, 1));
    const back = L.unpack(L.pack(far.squares.get(key)));
    need(back.rev === 0xfffffffe && L.joinSave(a, far).squares.get(key).owner === 1, 'a clock in 2107 wrapped round');
    need(L.seconds(Date.UTC(2026, 10, 14)) === Date.UTC(2026, 10, 14) / 1000 && L.cardMinute(L.cardSeconds(459000)) === 459000 && L.cardMinute(-1e12) === 0 && L.cardMinute(1e15) === L.linkTune.atMost && L.cardMinute(NaN) === 0, 'seconds and minutes');
    return `${cases.length} clocks (in milliseconds, with a fraction, nonsense, put back, past 2106): a change is always later than the record it changes, never 0, never wrapped; a change made with the clock a day back still wins the join`;
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
      ok(l.kind === 'flyby' && l.key === block[0] && l.dealt === L.dealCrew(e.id30, sender) && l.dealt !== sender && s.crew.value === l.dealt && l.as === sender, () => `a newcomer's landing: ${l.kind}, dealt ${l.dealt}, worn ${l.as}`);
      ok(l.wrote.length === 9 && l.was.every((w) => w === null), 'a newcomer: nine squares written over nothing');
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
      ok(l.note && l.note.role === 'in' && l.note.id === e.id && l.note.text === e.text && l.note.gen === 4 && l.note.place === 'mission' && l.note.crew === sender && l.note.as === sender && l.note.key === block[0], 'the note of an opened card');
      // 2. the same address opened again, on a page that has only the saved text: nothing changes
      const t1 = L.saveText(s);
      s = L.parseSave(t1).save;
      l = L.openLink(s, visitOf(e.text), frame, NOW + 50);
      ok(l.kind === 'seen' && l.wrote.length === 0 && l.dealt === 0 && L.saveText(s) === t1, `opened twice: ${l.kind}`);
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
        ok(l.kind === 'flyby' && l.dealt === 0 && s.crew.value === mine && l.as === worn && worn !== mine && l.note.as === worn && l.note.crew === sender, () => `a returning player of crew ${mine} under a card of crew ${sender}: worn ${l.as}`);
        block.slice(0, 9).forEach((k, i) => {
          const r = at(s, k), was = before.get(k);
          ok(r.owner === worn && r.stage === stages[i] && r.hits === stages[i] && r.cracks === 0 && r.guest && r.card === e.id30, () => `a square under a returning player: ${same(r)}`);
          if (was) ok(r.ax === 7 && r.az === 9 && r.ay === 120 && r.rev > was.rev && r.rev >= NOW, 'its anchor kept, its rev past what stood there');
        });
        ok(l.was.filter(Boolean).length === 6 && same(l.was[l.wrote.findIndex((r) => r.key === block[0])]) === same(before.get(block[0])), 'what stood there is handed back for the fall');
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
      ok(l.kind === 'flyby' && l.wrote.length === 2 && same(at(s, god.key)) === same(god) && same(at(s, been.key)) === same(been), 'a god\'s square or one the card has been on was written');
      ok(l.beats.length === 5 && l.beats.every((b) => c5.body.squares[b.i].ix !== L.squareIx(god.key) || c5.body.squares[b.i].iz !== L.squareIz(god.key)), 'the Flyby showed a square that was left alone');
    }
    // 6. water, off the map, a tagged square (hand-placed: a card whose own square is the church)
    {
      const near = [church, L.packSquare(L.squareIx(church) + 1, L.squareIz(church)), L.packSquare(L.squareIx(church), L.squareIz(church) + 1)];
      const c = cardOf(near.map((k) => [k, 4]), 2, rnd), e = text(c), s = fresh(), l = L.openLink(s, visitOf(e.text), frame, NOW);
      ok(s.squares.get(church).stage === 3 && l.beats.filter((b) => L.packSquare(b.ix, b.iz) === church).length === 3, 'a tagged square was lifted past its top');
      for (const k of near.slice(1)) ok(frame.top(k) === 0 ? !s.squares.has(k) : s.squares.get(k).stage === Math.min(4, frame.top(k)), 'a neighbour of the church');
      const shore = land.find((k) => frame.top(L.packSquare(L.squareIx(k) - 1, L.squareIz(k))) === 0), wet = L.packSquare(L.squareIx(shore) - 1, L.squareIz(shore));
      const s2 = fresh(), l2 = L.openLink(s2, visitOf(text(cardOf([[shore, 2], [wet, 4]], 1, rnd)).text), frame, NOW);
      ok(l2.kind === 'flyby' && l2.wrote.length === 1 && !s2.squares.has(wet) && l2.beats.length === 2, 'a square of water was written');
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
      ok(sent.role === 'out' && sent.text === ex.text && L.openLink(A, visitOf(ex.text), frame, NOW).kind === 'own' && A.squares.size === 0, 'a card opened on the phone that sent it');
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
      ok(lost.wrote.length === 0 && same([...B.squares.values()]) === tb && lost.kind === 'spot', `a card whose note was lost landed again: ${lost.kind}`);
      // 11. another card over the same squares does land
      const w = cardOf(block.slice(0, 5).map((k) => [k, 2]), 1, rnd), lw = L.openLink(B, visitOf(text(w).text), frame, NOW + 1000);
      ok(lw.kind === 'flyby' && lw.wrote.length === 5 && lw.dealt === 0 && B.crew.value === 4, 'a second card over the first');
      // 12. touch: a guest stays one while its owner does, climbs are noted for a change of owner or stage alone
      const n0 = B.climbs.length, g = L.touch(B, { key: block[2], faction: 1, stage: 3, cracks: 0, hits: 3, tended: NOW }, NOW + 2000);
      const g2 = L.touch(B, { key: block[2], faction: 1, stage: 3, cracks: 1, hits: 3, tended: NOW }, NOW + 2001);
      ok(g.guest && g2.guest && g2.rev > g.rev && B.climbs.length === n0 + 1 && L.touch(B, { key: block[2], faction: 0, stage: 0, cracks: 0, hits: 0, tended: 0 }, NOW) === null, 'touch');
    }
    return `${checks.toLocaleString('en')} checks of what a card does: a newcomer is dealt a crew that is not the sender's; every square the card names becomes the card's, the player's own and higher ones included, anchors kept; a same-crew card wears the next crew round the wheel; a god's square, water and a square the card has been on are left alone, a tagged square stops at 3; opened twice nothing changes; a torn card lands the same squares under the same id; a score, a landmark's card, a place alone, another city's card and one off the map write nothing; a sent card never lands at home; an answer and a take-back mark the right card taken`;
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
      if (frame.top(k) < 1 || rnd() > (want.busy ? 0.7 : 0.3)) continue;
      const stage = want.god && k === around[0] ? 5 : rnd.int(1, Math.min(4, frame.top(k)));
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
          L.openLink(save, sc.visit, frame, sc.now, ground);
          for (const [r, c] of stash) r.card = c;
        } else L.openLink(save, sc.visit, frame, sc.now, rules.noGround ? undefined : ground);
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
    mix(save.crew.value), mix(save.crew.rev);
    for (const n of save.notes.values()) mix(n.id30), mix(n.at), mix(n.as), mix(n.taken), mix(n.text.length), mix(n.role === 'out' ? 1 : 0), mix(n.gen);
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
      areas.onChange = (a) => L.touch(save, a, NOW + t);
      const steps = g % 4 === 0 ? rnd.int(1500, 3000) : rnd.int(20, 160);
      for (let s = 0; s < steps; s++) {
        const key = rnd.pick(keys), who = rnd() < 0.8 ? me : rival, { x, z } = L.squareCentre(key), was = areas.all.get(key), ws = was ? was.stage : 0, wf = was ? was.faction : 0;
        t += rnd() < 0.5 ? 1 : 6;
        const a = areas.hit(x, z, who, t, { now: NOW + t }).area, list = truth.get(key) ?? [];
        if (a.faction !== wf) (list.length = 0), list.push(++tick);
        else if (a.stage > ws) list.push(++tick);
        else if (a.stage < ws) list.length = a.stage;
        truth.set(key, list);
        if (save.climbs.length > L.saveTune.climbs) (forgot = true), L.trim(save);
      }
      // the save's first 16 bytes a square are the engine's own save, byte for byte
      need(L.areasText(save.squares) === areas.encode(), `game ${g}: the save's squares are not what areas.ts itself saves`);
      const read = new L.Areas(undefined, realm);
      need(read.decode(L.areasText(save.squares)), `game ${g}: areas.ts would not read the save's squares`);
      const mine = keys.filter((k) => areas.all.get(k)?.faction === me && areas.all.get(k).stage <= 4).map((k) => ({ key: k, stage: areas.all.get(k).stage })).sort((p, q) => bySquare(sq(p.key, 0), sq(q.key, 0)));
      if (!mine.length) continue;
      games++;
      // the card's order, out of the climbs the save kept: always one a card can carry, and the true one while nothing has been forgotten
      const order = L.orderFrom(save.climbs, mine, me), squares = mine.map((m) => sq(m.key, m.stage));
      need(L.orderOk(order, squares), `game ${g}: the order from the climbs is none a card can carry`);
      const want = [];
      mine.forEach((m, j) => truth.get(m.key).forEach((tk) => want.push([tk, j])));
      want.sort((a, b) => a[0] - b[0]);
      if (!forgot) {
        need(same(want.map((w) => w[1])) === same(order), `game ${g}: the order from the climbs is not the order the squares climbed in`);
        exact++;
      } else long++;
      // sent, read, and landed on a friend's phone: the same squares at the same stages, under the sender's crew; then the friend's own engine takes one back
      const own = rnd.pick(mine), card = { v: 1, map: 0, ix: L.squareIx(own.key), iz: L.squareIz(own.key), crew: me, at: L.cardMinute(NOW + t), caption: 'A BLOCK', body: { form: 'squares', squares, order, answers: null, score: null } };
      const e = text(card);
      for (const sameCrew of [false, true]) {
        const friend = L.emptySave();
        if (sameCrew) friend.crew = { value: me, rev: 1 };
        const l = L.openLink(friend, visitOf(e.text), frame, NOW + t + 60), theirs = friend.crew.value;
        need(l.kind === 'flyby' && l.as !== theirs && (sameCrew ? l.as === (me % 5) + 1 : l.as === me), `game ${g}: the friend's landing was ${l.kind}, worn ${l.as} against their ${theirs}`);
        const eng = new L.Areas(undefined, realm);
        need(eng.decode(L.areasText(friend.squares)), `game ${g}: the friend's engine would not read their save`);
        for (const m of mine) {
          const a = eng.all.get(m.key);
          need(a && a.faction === l.as && a.stage === Math.min(m.stage, frame.top(m.key)) && a.cracks === 0, () => `game ${g}: square ${m.key} landed as ${same(a)}, sent at stage ${m.stage}`);
        }
        eng.onChange = (a) => L.touch(friend, a, NOW + t + 100 + tt);
        const { x, z } = L.squareCentre(own.key), was = { ...friend.squares.get(own.key) }, out = [];
        let tt = 0;
        for (let h = 0; h < 8 && eng.all.get(own.key).faction !== theirs; h++) out.push(eng.hit(x, z, theirs, (tt += 6), { now: NOW + t + 100 + tt }).outcome);
        const stage = was.stage, wantOut = [...(stage === 4 ? ['crack'] : []), ...Array(stage - 1).fill('down'), 'flip'];
        need(same(out) === same(wantOut) && eng.all.get(own.key).faction === theirs && eng.all.get(own.key).stage === 1, () => `game ${g}: taking back a stage-${stage} square went ${out.join(' ')}, not ${wantOut.join(' ')}`);
        const rec = friend.squares.get(own.key), note = L.noteTaken(friend, own.key, was, NOW + t + 200);
        need(rec.owner === theirs && !rec.guest && rec.card === e.id30 && note && note.id === e.id && note.taken > 0, `game ${g}: the square taken back, or its card's note`);
        takes++;
        if (sameCrew) wheel++;
      }
    }
    return `${games} games on the real areas.ts with a rival knocking squares down, every change saved through touch: the save's squares are byte for byte what areas.ts itself saves; the card's order from the kept climbs is always one a card can carry, and in all ${exact} games that fit the ${L.saveTune.climbs} kept climbs it is the true order the stages were reached in (${long} longer games: older climbs first); the card lands on a friend's phone at the same stages, and the friend's own engine takes the card's square back hit by hit (crack, down, flip) in ${takes} of ${takes} tries, ${wheel} of them a friend of the sender's own crew`;
  });

  await row('tabs', () => {
    const rnd = dice(17), keys = Array.from({ length: 10 }, (_, i) => open[200 + i]);
    const run = (naive) => {
      let lostWork = 0;
      for (let g = 0; g < 300; g++) {
        const store = { text: null }, backend = L.storageBackend({ getItem: () => store.text, setItem: (_, t) => (store.text = t) }, 'sf');
        const tabs = [L.emptySave(), L.emptySave()], best = new Map(), sent = new Set();
        let clock = NOW;
        const flush = (i) => {
          if (naive) store.text = L.saveText(tabs[i]);
          else tabs[i] = L.flush(tabs[i], backend).save;
        };
        for (let step = 0; step < 60; step++) {
          const i = rnd.int(0, 1), tab = tabs[i], act = rnd();
          clock += rnd.int(0, 3);
          if (act < 0.5) {
            const key = rnd.pick(keys), r = L.touch(tab, { key, faction: rnd.int(1, 5), stage: rnd.int(1, 4), cracks: 0, hits: rnd.int(1, 9), tended: clock }, clock);
            const b = best.get(key);
            if (!b || r.rev > b.rev) best.set(key, { ...r });
            else if (r.rev === b.rev) best.set(key, null); // (two tabs in the same second: either may stand)
          } else if (act < 0.6) {
            const card = cardOf([[rnd.pick(open), 2]], rnd.int(1, 5), rnd), e = text({ ...card, at: card.at + step });
            L.noteSent(tab, e, card, 0, 'mission', clock);
            sent.add(e.id);
          } else if (act < 0.65 && tab.crew.value === 0) tab.crew = { value: rnd.int(1, 5), rev: L.nextRev(tab.crew, clock) };
          else flush(i);
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
      }
      return lostWork;
    };
    run(false);
    const lost = run(true);
    need(lost > 100, `the row did not catch tabs that write over each other (${lost})`);
    // a Storage that throws: private browsing, a full disk
    const broken = L.storageBackend({ getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('full'); } }, 'sf'), mem = L.emptySave();
    L.touch(mem, { key: keys[0], faction: 1, stage: 1, cracks: 0, hits: 1, tended: NOW }, NOW);
    const f = L.flush(mem, broken);
    need(f.wrote === false && f.save.squares.size === 1, 'a Storage that throws');
    // trim: over the cap, opened cards whose squares are gone go first, sent ones last; the climbs keep the newest
    const big = L.emptySave();
    for (let i = 0; i < 300; i++) big.notes.set(`1n${i}`, { id: `1n${i}`, id30: i, role: i < 20 ? 'out' : 'in', text: `1n${i}`, at: NOW + i, gen: 0, place: '', key: 0, crew: 1, as: 1, taken: 0, answers: -1 });
    for (let i = 30; i < 40; i++) big.squares.set(i, { key: i, owner: 1, stage: 1, cracks: 0, hits: 1, tended: 0, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: 1, card: i, guest: true });
    for (let i = 0; i < 700; i++) L.noteClimb(big, NOW + i, i, 1, 1);
    L.trim(big);
    need(big.notes.size === 256 && big.climbs.length === 512 && big.climbs[0][0] === NOW + 188 && [...Array(20).keys()].every((i) => big.notes.has(`1n${i}`)) && [...Array(10).keys()].every((i) => big.notes.has(`1n${30 + i}`)) && !big.notes.has('1n20') && big.notes.has('1n299'), 'trim');
    const moved = L.changedSquares(mem, f.save);
    need(moved.length === 0 && L.changedSquares(L.emptySave(), f.save).length === 1, 'changedSquares');
    return `300 runs of two tabs on one store, 60 steps each (squares changed, cards sent, a crew picked, flushes at any time): both tabs and the store end as one save, the later change of every square stands, and no sent card is forgotten. The same runs with each tab simply writing what it has lose ${lost.toLocaleString('en')} squares' last changes, which is what the join is for. A Storage that throws reads as empty and says the write failed; over its caps a save drops opened cards whose squares are gone first and sent ones last`;
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
