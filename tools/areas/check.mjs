#!/usr/bin/env node
// The open world's areas (src/factions/cityAreas.ts; STUDIO.md part 7, #11): the real areas.ts on every square, saved through src/link/save.ts. No browser.
//   node tools/areas/check.mjs [row ...] [--trace]
// Rows: parity (it answers liftRules.ts's TakeRules call for call on the staged block), saved (every change is in the save, and a new page's engine is the
// same), cards (a postcard's squares held for their Flyby, then taken back, the card marked taken), tiles (old paint and anchors in any order), tabs (two
// tabs end as one), gods (none rises), old (the save before this one comes in under everything newer).
import { rolldown } from 'rolldown';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dice, same, runner, need, sfFiles } from '../link/lib.mjs';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
mkdirSync(here('./.out'), { recursive: true });
const bundle = await rolldown({ input: here('./entry.ts'), platform: 'node', logLevel: 'silent' });
await bundle.write({ dir: here('./.out'), format: 'esm', entryFileNames: 'areas.mjs' });
const L = await import(pathToFileURL(here('./.out/areas.mjs')).href);

const NOW = 1794700000;
const R = runner(), sf = sfFiles(), table = L.parseHoods(sf.hoods), realm = new L.Neighbourhoods(table);
const frame = L.frameFrom({ slug: sf.city.slug, bounds: sf.city.bounds, landmarks: sf.city.landmarks }, table, L.slugOf, { top: (k) => realm.top(k) * (realm.of(k) >= 0 ? 1 : 0) });
const land = table.squares.flat(), tagged = new Set(table.tagged);
const keyOf = (ix, iz) => L.packSquare(ix, iz), centre = (k) => L.squareCentre(k);
/** an engine's squares as plain values, what two engines are compared by */
const state = (all, keys) => same((keys ?? [...all.keys()].sort((a, b) => a - b)).map((k) => {
  const a = all.get(k);
  return a ? [k, a.faction, a.stage, a.cracks, a.hits, a.tended] : [k];
}));
/** a block of n squares of land round a random one, the same piece of land */
const block = (rnd, n = 9) => {
  for (;;) {
    const c = rnd.pick(land), out = [];
    for (let j = -1; j <= 1 && out.length < n; j++) for (let i = -1; i <= 1 && out.length < n; i++) out.push(keyOf(L.squareIx(c) + i, L.squareIz(c) + j));
    if (out.every((k) => frame.top(k) > 0)) return out;
  }
};
const clock = () => {
  let ms = NOW * 1000;
  const f = () => ms;
  f.add = (s) => (ms += s * 1000);
  return f;
};

await R.row('parity', () => {
  const rnd = dice(21);
  let hits = 0, games = 0;
  const kinds = {};
  for (let g = 0; g < 600; g++) {
    const keys = block(rnd, rnd.int(1, 9)), crews = [rnd.int(1, 5), rnd.int(1, 5), rnd.int(1, 5)];
    const stand = new L.TakeRules(tagged), save = L.emptySave(), city = new L.CityAreas(save, realm, { now: clock() });
    for (const k of keys) {
      const f = rnd.int(0, 5), st = f ? rnd.int(1, 4) : 0, last = rnd.pick([-Infinity, Infinity, 0]);
      stand.seed(k, f, st, last), city.seed(k, f, st, last);
    }
    let t = 1;
    for (let h = rnd.int(5, 80); h > 0; h--) {
      t += rnd.pick([0.3, 1, 2.5, 5, 5.1, 7]);
      const k = rnd.pick(keys), { x, z } = centre(k), who = rnd.pick(crews), o = rnd() < 0.15 ? { superId: rnd.int(1, 4) } : rnd() < 0.1 ? { jump: rnd.int(2, 3), cap: 3 } : {};
      if (rnd() < 0.05) for (const kk of keys) stand.get(kk).last = city.get(kk).last = -Infinity; // (the Lift readies the block)
      const want = stand.outcomeOf(stand.get(k), who, t), got = city.outcomeOf(city.get(k), who, t);
      need(want === got, () => `game ${g}: outcomeOf ${got}, the stand-in ${want}`);
      const a = stand.hit(x, z, who, t, o), b = city.hit(x, z, who, t, o);
      need(a.outcome === b.outcome, () => `game ${g}, hit ${h}: ${b.outcome}, the stand-in ${a.outcome} (${same(o)})`);
      for (const kk of keys) {
        const p = stand.get(kk), q = city.get(kk);
        need(p.faction === q.faction && p.stage === q.stage && p.cracks === q.cracks && p.hits === q.hits && p.last === q.last && p.superId === q.superId, () => `game ${g}: square ${kk} is ${same(q)}, the stand-in's ${same(p)}`);
      }
      need(b.at >= t - 1e-6, () => `a change shown ${t - b.at} s before its hit`);
      kinds[b.outcome] = (kinds[b.outcome] ?? 0) + 1;
      hits++;
    }
    need(save.squares.size === 0, `game ${g}: the staged block was saved`);
    games++;
  }
  need(kinds.flip && kinds.crack && kinds.down && kinds.heal && kinds.up && kinds.claim && kinds.parry && kinds.encore, `not every outcome came up: ${same(kinds)}`);
  return `${hits.toLocaleString('en')} hits in ${games} games on staged blocks (the Lift's \`?lift\`): every outcome and every square the same as liftRules.ts's TakeRules (${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')}), and nothing of the staged block saved`;
});

await R.row('saved', () => {
  const rnd = dice(22);
  let games = 0, changes = 0;
  for (let g = 0; g < 300; g++) {
    const keys = block(rnd, 9), me = rnd.int(1, 5), rival = (me % 5) + 1, now = clock(), save = L.emptySave();
    save.crew = { value: me, rev: 1 };
    const city = new L.CityAreas(save, realm, { now });
    let t = 0;
    for (let h = rnd.int(10, 200); h > 0; h--) {
      t += rnd.pick([0.25, 1, 5, 6]);
      now.add(rnd.pick([0.25, 1, 5, 6]));
      const { x, z } = centre(rnd.pick(keys)), who = rnd() < 0.75 ? me : rival;
      const r = rnd() < 0.1 ? city.spill(x, z, who, t) : city.hit(x, z, who, t, rnd() < 0.1 ? { jump: 2, cap: 3 } : {});
      if (r.outcome !== 'none' && r.outcome !== 'parry') changes++;
      need(L.areasText(save.squares) === city.engine.encode(), () => `game ${g}: the save's squares are not the engine's own`);
    }
    // a new page: the save as stored, read back, and an engine from it
    const back = L.parseSave(L.saveText(save)).save, again = new L.CityAreas(back, realm, { now });
    need(state(again.all) === state(city.all), `game ${g}: a new page's engine is not this one`);
    need([...again.all.values()].every((a) => a.last === -Infinity), `game ${g}: a square on a new page was not ready`);
    games++;
  }
  return `${games} games on the real map (${changes.toLocaleString('en')} counted changes, hits four a second among them, spills and Bomb jumps): after every hit the save's squares are byte for byte the engine's own save, and a new page's engine read from the stored text is the same as the old one, every square ready`;
});

await R.row('cards', () => {
  const rnd = dice(23);
  let runs = 0, takes = 0;
  for (let g = 0; g < 200; g++) {
    const keys = block(rnd, 9), me = rnd.int(1, 5), sender = rnd() < 0.3 ? me : rnd.int(1, 5), now = clock(), save = L.emptySave();
    save.crew = { value: me, rev: 1 };
    const city = new L.CityAreas(save, realm, { now });
    let t = 0;
    // the player's own paint first, on some of the squares
    for (const k of keys) if (rnd() < 0.5) for (let s = rnd.int(1, 4); s > 0; s--) (t += 6), city.hit(centre(k).x, centre(k).z, me, t);
    const squares = keys.map((k) => ({ ix: L.squareIx(k), iz: L.squareIz(k), stage: Math.min(rnd.int(1, 4), frame.top(k)) })).sort((a, b) => a.iz - b.iz || a.ix - b.ix);
    const order = [];
    squares.forEach((q, i) => { for (let s = 0; s < q.stage; s++) order.push(i); });
    const card = { v: 1, map: 0, ix: squares[0].ix, iz: squares[0].iz, crew: sender, at: L.cardMinute(NOW), caption: 'A BLOCK', body: { form: 'squares', squares, order, answers: null, score: null } };
    const e = L.encode(card);
    need(e.ok, `the card: ${e.why}`);
    now.add(60);
    const landing = L.openLink(save, L.parseLocation('/p/x/0', '', `#${e.text}`), frame, now());
    need(landing.kind === 'flyby', `the card landed as ${landing.kind}`);
    const came = city.land(landing);
    need(came.length === landing.landed.length && came.every((a) => a.faction === landing.as && a.last === Infinity && city.holding(a.key)), 'the card\'s squares did not come into the engine held');
    need(L.areasText(save.squares) === city.engine.encode(), 'after the card, the save\'s squares are not the engine\'s');
    // held: the player's hit (a rival's to the card's crew) parries, the card's crew's own is an encore; the square's stage stays
    const own = L.packSquare(card.ix, card.iz), { x, z } = centre(own), landed = landing.landed.find((l) => l.rec.key === own).rec.stage;
    t += 30;
    const o1 = city.hit(x, z, me, t).outcome, o2 = city.hit(x, z, landing.as, t + 0.5).outcome;
    need(o1 === 'parry' && o2 === 'encore' && city.get(own).stage === landed && city.get(own).faction === landing.as, () => `a held square: ${o1}, ${o2}, stage ${city.get(own).stage}`);
    // the Flyby shows the own square, then the rest
    city.release(own);
    need(!city.holding(own) && city.holding(came.find((a) => a.key !== own)?.key ?? own) === (came.length > 1), 'release');
    let out = [], taken = null;
    for (let h = 0; h < 10 && city.get(own).faction !== me; h++) {
      t += 6;
      now.add(6);
      const r = city.hit(x, z, me, t);
      out.push(r.outcome);
      if (r.taken) taken = r.taken;
    }
    const stage = landing.landed.find((l) => l.rec.key === own).rec.stage, want = [...(stage === 4 ? ['crack'] : []), ...Array(stage - 1).fill('down'), 'flip'];
    need(same(out) === same(want), () => `taking back a stage-${stage} square went ${out.join(' ')}, not ${want.join(' ')}`);
    need(taken && taken.id === e.id && taken.taken > 0 && save.notes.get(e.id).taken === taken.taken, 'the card was not marked taken when its own square was taken back');
    const rec = save.squares.get(own);
    need(rec.owner === me && !rec.guest && rec.card === e.id30, `the square taken back: ${same(rec)}`);
    city.release();
    need(came.every((a) => !city.holding(a.key)), 'release of all');
    need(L.areasText(save.squares) === city.engine.encode(), 'after the take-back, the save\'s squares are not the engine\'s');
    takes++;
    runs++;
  }
  return `${runs} postcards landed on blocks the player had painted (a third of them of the player's own crew): their squares come into the engine at the card's stages, worn by the card's crew, held so nothing changes them until the Flyby has shown them; then the player takes the card's own square back hit by hit (crack, down, flip), and the card is marked taken ${takes} times of ${runs}; the save and the engine agree throughout`;
});

await R.row('tiles', () => {
  const rnd = dice(24);
  let places = 0, orders = 0;
  for (let g = 0; g < 100; g++) {
    const keys = block(rnd, 9), me = rnd.int(1, 5);
    const tiles = [];
    for (let i = 0; i < 9; i += 3) tiles.push(keys.slice(i, i + 3).map((k) => ({ key: k, ax: rnd.int(0, 127), az: rnd.int(0, 127), ay: rnd.int(-500, 3000), old: rnd() < 0.5 ? rnd.int(1, 5) : 0, oldCrew: me })));
    const play = (order) => {
      const save = L.emptySave();
      save.crew = { value: me, rev: 1 };
      const city = new L.CityAreas(save, realm, { now: clock() });
      for (const i of order) city.tileIn(tiles[i], frame);
      return city;
    };
    const ref = play([0, 1, 2]);
    for (const k of keys) {
      const r = ref.save.squares.get(k), a = ref.get(k);
      need(!r === !a && (!r || (a.faction === r.owner && a.stage === r.stage && a.ax === r.ax && a.ay === r.ay)), `square ${k}: the engine and the save disagree after the tiles`);
    }
    for (const order of [[0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0], [2, 2, 0, 1, 0]]) {
      need(state(play(order).all, keys) === state(ref.all, keys), `place ${g}: tiles in the order ${order} gave another engine`);
      orders++;
    }
    places++;
  }
  return `${places} places, three tiles each with the phone's old paint on half their squares: the engine and the save agree on every square after the tiles, and every order the tiles load in (a tile loading twice included, ${orders} orders) gives the same engine`;
});

await R.row('tabs', () => {
  const rnd = dice(25);
  let runs = 0;
  for (let g = 0; g < 150; g++) {
    const keys = block(rnd, 9), me = rnd.int(1, 5), rival = (me % 5) + 1, now = clock();
    let stored = null;
    const backend = { read: () => stored, write: (t) => ((stored = t), true) };
    const tabs = [0, 1].map(() => {
      const s = L.emptySave();
      s.crew = { value: me, rev: 1 };
      return new L.CityAreas(s, realm, { now });
    });
    const flush = (i) => {
      const before = tabs[i].save, f = L.flush(before, backend, now());
      tabs[i].absorb(f.save, L.changedSquares(before, f.save));
    };
    let t = 0;
    for (let step = 0; step < 80; step++) {
      const i = rnd.int(0, 1);
      t += rnd.pick([0.5, 1, 6]);
      now.add(rnd.pick([0, 1, 2]));
      if (rnd() < 0.7) tabs[i].hit(centre(rnd.pick(keys)).x, centre(rnd.pick(keys)).z, rnd() < 0.8 ? me : rival, t);
      else flush(i);
    }
    flush(0), flush(1), flush(0);
    need(L.saveText(tabs[0].save) === L.saveText(tabs[1].save), `run ${g}: the two tabs' saves differ`);
    need(state(tabs[0].all) === state(tabs[1].all), `run ${g}: the two tabs' engines differ`);
    need(L.areasText(tabs[0].save.squares) === tabs[0].engine.encode(), `run ${g}: a tab's engine is not its save`);
    runs++;
  }
  return `${runs} runs of two tabs on one store (hits in both, flushes at any time, each flush's changes taken into the engine): both tabs end with one save and one engine, and each engine is its save`;
});

await R.row('gods', () => {
  // a neighbourhood a crew holds whole at the Lift, its heart at the Lift too: the plain engine raises a god there; the open world never does
  let tried = 0, raw = 0;
  for (let n = 0; n < realm.count && tried < 12; n++) {
    if (realm.godless(n)) continue;
    const heart = realm.heart(n), plain = new L.Areas(undefined, realm), city = new L.CityAreas(L.emptySave(), realm, { now: clock() });
    for (const engine of [plain, city.engine])
      for (const k of realm.squares(n)) engine.all.set(k, { key: k, faction: 2, stage: Math.min(4, realm.top(k)), cracks: 0, hits: 4, tended: 0, last: -Infinity, superId: 0, ax: 0, az: 0, ay: 0 });
    const { x, z } = centre(heart), a = plain.hit(x, z, 2, 100).outcome, b = city.hit(x, z, 2, 100).outcome;
    if (a === 'god') raw++;
    need(b === 'encore' && city.get(heart).stage === 4, `${realm.name(n)}: the open world gave ${b}`);
    tried++;
  }
  need(raw === tried && tried > 5, `the plain engine raised ${raw} gods of ${tried}: the row can't tell`);
  // a god a save holds rests at the Lift here: a rival's hits on it crack and bring it down as on any Lift square, never guard or topple
  const n0 = [...Array(realm.count).keys()].find((n) => !realm.godless(n)), heart = realm.heart(n0), save = L.emptySave();
  save.squares.set(heart, { key: heart, owner: 2, stage: 5, cracks: 3, hits: 9, tended: 1, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: 5, card: -1, guest: false });
  const city = new L.CityAreas(save, realm, { now: clock() }), { x, z } = centre(heart), outs = [];
  need(city.get(heart).stage === 4 && city.get(heart).cracks === 0 && save.squares.get(heart).stage === 5, 'a saved god in the engine');
  for (let t = 10, i = 0; i < 6; i++, t += 6) outs.push(city.hit(x, z, 3, t).outcome);
  need(same(outs.slice(0, 5)) === same(['crack', 'down', 'down', 'down', 'flip']), () => `a rival on a saved god: ${outs.join(' ')}`);
  need(save.squares.get(heart).stage <= 4, 'the god\'s record stood after its square changed');
  return `${tried} neighbourhoods held whole at the Lift: the plain engine raises a god at each heart, the open world raises none (an encore); a god a save holds rests at the Lift here, and a rival takes it as any Lift square (${outs.slice(0, 5).join(', ')})`;
});

await R.row('old', () => {
  const rnd = dice(26), save = L.emptySave(), old = L.emptySave();
  const keys = block(rnd, 9);
  keys.forEach((k, i) => old.squares.set(k, { key: k, owner: 1, stage: 1 + (i % 3), cracks: 0, hits: 2, tended: 5, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: 0, card: -1, guest: false }));
  save.squares.set(keys[0], { ...old.squares.get(keys[0]), owner: 3, stage: 4, rev: NOW });
  const n = L.CityAreas.adoptOld(save, L.areasText(old.squares));
  need(n === 9 && save.squares.size === 9 && save.squares.get(keys[0]).owner === 3 && keys.slice(1).every((k) => save.squares.get(k).owner === 1 && save.squares.get(k).rev === 0), 'the old save did not come in under the new');
  need(L.CityAreas.adoptOld(save, null) === 0 && L.CityAreas.adoptOld(save, 'not a save') === 0 && save.squares.size === 9, 'nothing to adopt');
  const city = new L.CityAreas(save, realm, { now: clock() });
  need(city.all.size === 9 && city.get(keys[1]).stage === 2, 'the engine from an adopted save');
  return 'the save before this one (areas.ts\'s own, 16 bytes a square) comes in under every newer record, and the engine stands on the result';
});

R.done('areas');
