#!/usr/bin/env node
// The Flyby's event stream (src/link/flyby.ts; STUDIO.md part 7, #14): real postcards landed by save.ts's openLink on San Francisco's map, played
// through the real engine (cityAreas.ts) as the host would play them. No browser.
//   node tools/link/flyby-check.mjs [row ...] [--trace]
import { load, dice, same, runner, need, sfFiles, randOrder } from './lib.mjs';

const L = await load(), R = runner(), sf = sfFiles(), table = L.parseHoods(sf.hoods), realm = new L.Neighbourhoods(table);
const frame = L.frameFrom({ slug: sf.city.slug, bounds: sf.city.bounds, landmarks: sf.city.landmarks }, table, L.slugOf, { top: (k) => realm.top(k) });
const NOW = 1794700000, land = table.squares.flat().filter((k) => frame.top(k) === 4), T = L.flybyTune;
const visitOf = (text) => L.parseLocation('/p/x/0', '', `#${text}`);
/** a card of up to 16 squares round a random square of land, crew `crew` */
function card(rnd, crew, score = false) {
  for (;;) {
    const c = rnd.pick(land), keys = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (rnd() < 0.6 || (!dx && !dz)) keys.push(L.packSquare(L.squareIx(c) + dx, L.squareIz(c) + dz));
    const squares = keys.filter((k) => frame.top(k) > 0).slice(0, 16).map((k) => ({ ix: L.squareIx(k), iz: L.squareIz(k), stage: rnd.int(1, 4) })).sort((a, b) => a.iz - b.iz || a.ix - b.ix);
    if (!squares.some((q) => q.ix === L.squareIx(c) && q.iz === L.squareIz(c))) continue;
    const e = L.encode({ v: 1, map: 0, ix: L.squareIx(c), iz: L.squareIz(c), crew, at: L.cardMinute(NOW - 60), caption: 'A BLOCK', body: { form: 'squares', squares, order: randOrder(squares, rnd), answers: null, score: score ? { budget: 60, used: 40 } : null } });
    if (e.ok) return { e, squares, c };
  }
}

await R.row('plan', () => {
  const rnd = dice(41);
  let plays = 0, beats = 0, falls = 0, longest = 0;
  for (let g = 0; g < 2000; g++) {
    const me = rnd.int(1, 5), sender = rnd.int(1, 5), save = L.emptySave(), { e, squares } = card(rnd, sender);
    save.crew = { value: me, rev: 1 };
    // the player's own paint under some of the card's squares, and a rival's
    for (const q of squares) if (rnd() < 0.4) { const k = L.packSquare(q.ix, q.iz); save.squares.set(k, { key: k, owner: rnd() < 0.7 ? me : (me % 5) + 1, stage: rnd.int(1, 4), cracks: 0, hits: 3, tended: NOW - 999, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: NOW - 999, card: -1, guest: false }); }
    const city = new L.CityAreas(save, realm, { now: () => NOW * 1000 });
    const landing = L.openLink(save, visitOf(e.text), frame, NOW);
    need(landing.kind === 'flyby', `game ${g}: landed as ${landing.kind}`);
    city.land(landing);
    const t0 = rnd() * 100, plan = L.flybyPlan(landing, t0);
    need(plan[0].kind === 'start' && plan[0].t === t0 && plan[plan.length - 1].kind === 'done', `game ${g}: the plan doesn't start and end`);
    need(plan.every((ev, j) => !j || ev.t >= plan[j - 1].t) && plan.every((ev) => ev.t >= t0), `game ${g}: events out of time, or before the Flyby's start`);
    const bs = plan.filter((ev) => ev.kind === 'beat');
    need(same(bs.map((b) => [b.i, b.stage])) === same(landing.beats.map((b) => [b.i, b.stage])), `game ${g}: the beats are not the card's own, in its order`);
    need(bs[0].t >= t0 + T.lead - 1e-9 && bs[bs.length - 1].t <= t0 + T.lead + T.span + 1e-9 && plan[plan.length - 1].t - t0 <= T.lead + T.span + T.settle + 1e-9, () => `game ${g}: the Flyby ran ${(plan[plan.length - 1].t - t0).toFixed(3)} s`);
    longest = Math.max(longest, bs[bs.length - 1].t - t0);
    // each square: its fall before its first beat (where something stood), its stages one by one, its release once after its last beat
    for (const l of landing.landed) {
      const mine = plan.filter((ev) => ev.i === l.i), fb = mine.findIndex((ev) => ev.kind === 'beat'), fall = mine.filter((ev) => ev.kind === 'fall'), rel = mine.filter((ev) => ev.kind === 'release');
      need(fall.length === (l.was ? 1 : 0) && (!l.was || (mine.indexOf(fall[0]) < fb && fall[0].was === l.was)), `game ${g}: square ${l.i}'s fall`);
      const st = mine.filter((ev) => ev.kind === 'beat').map((ev) => ev.stage);
      need(same(st) === same(Array.from({ length: st.length }, (_, k) => k + 1)) && st.length === l.rec.stage, `game ${g}: square ${l.i}'s stages ${st}`);
      need(rel.length === 1 && rel[0].stage === l.rec.stage && rel[0].t > mine.filter((ev) => ev.kind === 'beat').pop().t && rel[0].key === l.rec.key, `game ${g}: square ${l.i}'s release`);
      falls += fall.length;
    }
    // played through the engine as the host would: held until its release, then the engine's; at the end everything released, engine and save one
    for (const ev of plan) {
      if (ev.kind === 'beat') need(city.holding(ev.key), `game ${g}: a square was let go before its last beat`);
      if (ev.kind === 'release') city.release(ev.key);
      if (ev.kind === 'done') city.release();
    }
    need(landing.landed.every((l) => !city.holding(l.rec.key)) && L.areasText(save.squares) === city.engine.encode(), `game ${g}: after the Flyby the engine is not the save`);
    plays++;
    beats += bs.length;
  }
  return `${plays} postcards (up to 16 squares, over the player's own paint and a rival's) landed and played: every Flyby starts at its start and plays the card's own beats in its order, each square falling from what stood there (${falls} falls) and climbing its stages one by one, let go to the engine once after its last; the last beat ${longest.toFixed(2)} s after the start at most (${beats.toLocaleString('en')} beats in all), and after it the engine and the save are one`;
});

await R.row('others', () => {
  const rnd = dice(42), save = L.emptySave();
  save.crew = { value: 2, rev: 1 };
  const s = card(rnd, 3, true), ls = L.openLink(save, visitOf(s.e.text), frame, NOW), ps = L.flybyPlan(ls, 5);
  need(ls.kind === 'score' && ps.filter((e) => e.kind === 'beat').length === ls.beats.length && !ps.some((e) => e.kind === 'release' || e.kind === 'fall') && ps[ps.length - 1].kind === 'done', 'a score\'s ghost');
  const f = card(rnd, 3), lf = L.openLink(save, visitOf(f.e.text), frame, NOW), again = L.openLink(save, visitOf(f.e.text), frame, NOW + 9);
  need(lf.kind === 'flyby' && again.kind === 'seen' && L.flybyPlan(again, 0).length === 0, 'a card opened again plays no Flyby');
  for (const href of ['/', '/p/mission/0']) need(L.flybyPlan(L.openLink(L.emptySave(), L.parseLocation(href, '', ''), frame, NOW), 0).length === 0, 'the door or a place plays a Flyby');
  const one = card(rnd, 4), lone = L.openLink(L.emptySave(), visitOf(one.e.text), frame, NOW), p1 = L.flybyPlan(lone, 0);
  need(p1.filter((e) => e.kind === 'beat').length === lone.beats.length, 'one card');
  return 'a card of today\'s place plays its ghost (its beats, nothing released, nothing falls); a card opened again, the door and a place play none';
});

await R.row('home', () => {
  const rnd = dice(43);
  let checks = 0;
  for (let g = 0; g < 500; g++) {
    const me = rnd.int(1, 5), them = (me % 5) + 1, save = L.emptySave(), c = rnd.pick(land), cx = L.squareIx(c), cz = L.squareIz(c);
    const put = (dx, dz, o) => { const k = L.packSquare(cx + dx, cz + dz); save.squares.set(k, { key: k, owner: me, stage: 1, cracks: 0, hits: 1, tended: 0, ax: 0, az: 0, ay: L.NO_ANCHOR, rev: 1, card: -1, guest: false, ...o }); return k; };
    for (let i = rnd.int(0, 30); i > 0; i--) put(rnd.int(-15, 15), rnd.int(-15, 15), { stage: rnd.int(1, 5), owner: rnd() < 0.6 ? me : them, guest: rnd() < 0.1 });
    const got = L.startOver(save, { key: c }, me), cand = [...save.squares.values()].filter((r) => r.owner === me && !r.guest && r.stage <= 4 && Math.max(Math.abs(L.squareIx(r.key) - cx), Math.abs(L.squareIz(r.key) - cz)) <= 12);
    if (!cand.length) need(got === c, `game ${g}: with nothing of the player's near, not the card's own square`);
    else {
      const top = Math.max(...cand.map((r) => r.stage)), r = save.squares.get(got);
      need(r && r.owner === me && !r.guest && r.stage === top, `game ${g}: started over ${r ? `crew ${r.owner} stage ${r.stage}` : 'nothing'}, the player's best is stage ${top}`);
      const d = (k) => Math.max(Math.abs(L.squareIx(k) - cx), Math.abs(L.squareIz(k) - cz));
      need(cand.filter((x) => x.stage === top).every((x) => d(x.key) >= d(got)), `game ${g}: a nearer floating block was passed over`);
    }
    checks++;
  }
  need(L.startOver(L.emptySave(), { key: -1 }, 1) === -1, 'the door');
  return `${checks} phones with a link opened again: the bus starts over the player's own highest block within 12 squares of the card's (the nearest of those; never a god's, a rival's or a card's square), else over the card's own`;
});

R.done('flyby');
