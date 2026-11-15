#!/usr/bin/env node
// The safe save (src/link/store.ts; STUDIO.md part 7, #13) in a real browser: the machine's Chromium, its own IndexedDB and localStorage, pages of one
// site sharing them as tabs do. No graphics are drawn, so it runs as well on a cloud machine.
//   node tools/link/store-check.mjs [row ...] [--trace]
import { rolldown } from 'rolldown';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser.mjs';
import { runner, need, dice } from './lib.mjs';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
mkdirSync(here('./.out'), { recursive: true });
const bundle = await rolldown({ input: here('./store-entry.ts'), platform: 'browser', logLevel: 'silent' });
await bundle.write({ dir: here('./.out'), format: 'esm', entryFileNames: 'store.mjs' });
const code = readFileSync(here('./.out/store.mjs'));
const server = createServer((req, res) => {
  if (req.url === '/store.mjs') return res.writeHead(200, { 'content-type': 'text/javascript' }), res.end(code);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><script type="module">import * as L from '/store.mjs'; window.L = L; window.ready = true;</script>`);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(browserOptions());
const R = runner();

/** a fresh site: a context of its own (its own database and localStorage), and a way to open tabs in it */
async function site() {
  const ctx = await browser.newContext();
  const tab = async () => {
    const p = await ctx.newPage();
    await p.goto(ORIGIN);
    await p.waitForFunction(() => window.ready === true);
    await p.evaluate(HELPERS);
    return p;
  };
  return { ctx, tab, close: () => ctx.close() };
}
/** helpers put in each page: a seeded dice, a random save, a save as plain text */
const HELPERS = `(() => {
  window.dice = (seed) => { let a = seed >>> 0; const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)); r.pick = (l) => l[Math.floor(r() * l.length)]; return r; };
  window.NOW = 1794700000;
  window.randSave = (rnd, n) => {
    const L = window.L, s = L.emptySave();
    for (let i = 0; i < n; i++) {
      const key = L.packSquare(rnd.int(-60, 40), rnd.int(-70, 50)), stage = rnd.int(1, 4), anch = rnd() < 0.6;
      s.squares.set(key, { key, owner: rnd.int(1, 5), stage, cracks: stage === 4 ? rnd.int(0, 1) : 0, hits: rnd.int(1, 40), tended: NOW - rnd.int(0, 9999), ax: anch ? rnd.int(0, 127) : 0, az: anch ? rnd.int(0, 127) : 0, ay: anch ? rnd.int(-500, 3000) : L.NO_ANCHOR, rev: NOW - rnd.int(0, 9999), card: rnd() < 0.2 ? rnd.int(0, 2 ** 30 - 1) : -1, guest: false });
    }
    for (const r of s.squares.values()) if (r.card >= 0) r.guest = rnd() < 0.5;
    if (rnd() < 0.5) s.marks.set('ggb', { owner: rnd.int(1, 5), stage: rnd.int(1, 4), cracks: 0, hits: 4, tended: NOW, rev: NOW, card: -1 });
    for (let i = rnd.int(0, 6); i > 0; i--) { const id = '1n' + rnd.int(0, 1e9); s.notes.set(id, { id, id30: rnd.int(0, 2 ** 30 - 1), role: rnd() < 0.5 ? 'out' : 'in', text: id + 'x', at: NOW - rnd.int(0, 999), gen: rnd.int(0, 9), place: 'mission', key: rnd.int(0, 2 ** 32 - 1), crew: rnd.int(1, 5), taken: 0, answers: -1 }); }
    for (const n of s.notes.values()) s.seen.set(n.id30, n.at);
    s.crew = { value: rnd.int(1, 5), rev: NOW };
    for (const r of s.squares.values()) if (rnd() < 0.3) L.noteClimb(s, (NOW + rnd.int(0, 99)) * 1000, r.key, r.owner, r.stage);
    return s;
  };
  window.text = (s) => window.L.saveText(window.L.trim(s));
  window.open1 = async (env) => { const st = await window.L.SafeSave.open('sf', env); window.st = st; return st.where; };
})()`;

try {
  await R.row('round', async () => {
    let n = 0;
    for (let i = 0; i < 25; i++) {
      const s = await site(), a = await s.tab();
      const [want, where] = await a.evaluate(async (i) => {
        const where = await open1();
        const save = randSave(dice(i + 1), [0, 1, 50, 800][i % 4]);
        const loaded = await st.load(NOW);
        const w = await st.write(save, NOW);
        return [text(save), where + ' ' + loaded.lost + ' ' + w.rows];
      }, i);
      need(where.startsWith('db 0'), `save ${i}: ${where}`);
      // a new tab, with the journal gone: the database alone
      const b = await s.tab();
      const got = await b.evaluate(async () => {
        localStorage.clear();
        await open1();
        const l = await st.load(NOW);
        return [text(l.save), l.lost];
      });
      need(got[1] === 0 && got[0] === want, () => `save ${i}: read back ${got[0].length} characters, lost ${got[1]}, written ${want.length}`);
      await s.close();
      n++;
    }
    return `${n} random saved cities (up to 800 squares, landmarks, cards sent and opened, the crew, climbs, the cards known) written into the browser's own database and read back the same by another tab, with nothing in localStorage`;
  });

  await R.row('changes', async () => {
    const s = await site(), a = await s.tab();
    const out = await a.evaluate(async () => {
      await open1();
      const L = window.L, rnd = dice(7);
      let save = (await st.load(NOW)).save;
      Object.assign(save, randSave(rnd, 500));
      const rest = save.marks.size + save.notes.size + 1, first = (await st.write(save, NOW)).rows, none = (await st.write(save, NOW)).rows;
      const k = [...save.squares.keys()].find((key) => save.squares.get(key).stage < 4), r = save.squares.get(k);
      L.touch(save, { key: k, faction: r.owner, stage: r.stage + 1, cracks: 0, hits: r.hits + 1, tended: NOW + 5 }, (NOW + 5) * 1000);
      const one = (await st.write(save, NOW + 5)).rows;
      const card = { v: 1, map: 0, ix: -3, iz: 14, crew: 2, at: L.cardMinute(NOW), caption: 'HAYES ST', body: null }, e = L.encode(card);
      L.noteSent(save, e, card, 0, 'mission', NOW + 6);
      const note = (await st.write(save, NOW + 6)).rows;
      return { first, none, one, note, squares: save.squares.size, rest };
    });
    need(out.first === out.squares + out.rest && out.none === 0 && out.one === 2 && out.note === 2, () => `rows written: ${JSON.stringify(out)}`);
    await s.close();
    return `only what changed is written: ${out.first} rows for a city of ${out.squares} squares at first (each square, landmark and card, and one for the rest), 0 when nothing changed, 2 for one square changed (the square, and the climbs), 2 for a card sent (its note, and the cards known)`;
  });

  await R.row('tabs', async () => {
    let runs = 0, lostMine = 0;
    for (let g = 0; g < 12; g++) {
      const s = await site(), a = await s.tab(), b = await s.tab();
      for (const p of [a, b]) await p.evaluate(async () => { await open1(); window.save = (await st.load(NOW)).save; window.save.crew = { value: 2, rev: 1 }; window.best = {}; });
      const keys = await a.evaluate((g) => { const L = window.L, out = []; for (let i = 0; i < 8; i++) out.push(L.packSquare(-10 + i + g, 20)); return out; }, g);
      let clock = 1794700000;
      const rnd = dice(30 + g);
      for (let step = 0; step < 60; step++) {
        const p = step % 3 === 0 ? b : rnd() < 0.5 ? a : b, key = keys[Math.floor(rnd() * keys.length)];
        clock += Math.floor(rnd() * 3);
        const act = rnd();
        const rec = await p.evaluate(async ([key, clock, act, f, st]) => {
          const L = window.L;
          if (act < 0.65) return L.touch(window.save, { key, faction: f, stage: st, cracks: 0, hits: st + 3, tended: clock }, clock * 1000);
          await window.st.write(window.save, clock);
          return null;
        }, [key, clock, act, 1 + Math.floor(rnd() * 5), 1 + Math.floor(rnd() * 4)]);
        if (rec) {
          const was = (globalThis.best ??= {})[key];
          globalThis.best[key] = !was || rec.rev > was.rev ? rec : rec.rev === was.rev ? null : was;
        }
      }
      for (const p of [a, b, a]) await p.evaluate(async () => { await window.st.write(window.save, NOW + 999); });
      const c = await s.tab();
      const final = await c.evaluate(async () => { await open1(); const l = await st.load(NOW); return [text(l.save), [...l.save.squares.values()]]; });
      const ta = await a.evaluate(async () => { await open1(); return text((await st.load(NOW)).save); });
      need(final[0] === ta, `run ${g}: two tabs read the store two ways`);
      for (const [k, want] of Object.entries(globalThis.best)) {
        if (!want) continue;
        const got = final[1].find((r) => r.key === Number(k));
        if (!got || got.rev !== want.rev || got.owner !== want.owner || got.stage !== want.stage) lostMine++;
      }
      globalThis.best = {};
      await s.close();
      runs++;
    }
    need(lostMine === 0, `${lostMine} squares' last changes were lost between two tabs`);
    return `${runs} runs of two tabs on one database, 60 steps each (squares changed in either, writes at any time): a third tab reads one city, and every square's latest change stands`;
  });

  await R.row('journal', async () => {
    const s = await site(), a = await s.tab();
    const want = await a.evaluate(async () => {
      await open1();
      const L = window.L, save = (await st.load(NOW)).save;
      Object.assign(save, randSave(dice(9), 300));
      await st.write(save, NOW);
      // more changes, and the page goes before they are written: only the journal has them
      for (const r of [...save.squares.values()].slice(0, 40)) L.touch(save, { key: r.key, faction: r.owner, stage: r.stage, cracks: 0, hits: r.hits + 7, tended: NOW + 50 }, (NOW + 50) * 1000);
      need0(st.journal(save, NOW + 50));
      return text(save);
      function need0(x) { if (!x) throw new Error('the journal was refused'); }
    });
    await a.close();
    const b = await s.tab();
    const got = await b.evaluate(async () => { await open1(); const l = await st.load(NOW + 60); const w = await st.write(l.save, NOW + 60); localStorage.clear(); return [text(l.save), w.rows]; });
    need(got[0] === want, 'what only the journal held was lost');
    need(got[1] >= 40, `the journal's rows were not written into the database (${got[1]})`);
    const c = await s.tab();
    const again = await c.evaluate(async () => { await open1(); return text((await st.load(NOW + 70)).save); });
    need(again === want, 'the journal\'s rows were not in the database after it was cleared');
    await s.close();
    return `a page that goes with 40 changes not yet written leaves them in the journal (localStorage, synchronously); the next page reads them, writes them into the database (${got[1]} rows), and they are there with the journal gone`;
  });

  await R.row('fallback', async () => {
    const said = [];
    for (const [what, setup] of [
      ['no database at all', 'none'],
      ['a database that throws when opened', 'throws'],
      ['a database a newer build made (version 2)', 'newer'],
    ]) {
      const s = await site(), a = await s.tab();
      const out = await a.evaluate(async (setup) => {
        let env = {};
        if (setup === 'none') env = { indexedDB: null };
        if (setup === 'throws') env = { indexedDB: { open() { throw new Error('no'); } } };
        if (setup === 'newer') await new Promise((ok) => { const r = indexedDB.open('strugglebus.city.sf', 2); r.onupgradeneeded = () => r.result.createObjectStore('other'); r.onsuccess = () => { r.result.close(); ok(); }; });
        const where = await open1(env);
        const save = (await st.load(NOW)).save;
        Object.assign(save, randSave(dice(3), 120));
        await st.write(save, NOW);
        return [where, text(save)];
      }, setup);
      const b = await s.tab();
      const back = await b.evaluate(async (setup) => {
        const env = setup === 'none' ? { indexedDB: null } : setup === 'throws' ? { indexedDB: { open() { throw new Error('no'); } } } : {};
        const where = await open1(env);
        return [where, text((await st.load(NOW)).save)];
      }, setup);
      need(out[0] === 'journal' && back[0] === 'journal' && back[1] === out[1], () => `${what}: ${out[0]}, then ${back[0]}, the city ${back[1] === out[1] ? 'kept' : 'lost'}`);
      said.push(what);
      await s.close();
    }
    // and no localStorage either: memory, never a throw
    const s = await site(), a = await s.tab();
    const mem = await a.evaluate(async () => { const where = await open1({ indexedDB: null, localStorage: null }); const l = await st.load(NOW); const w = await st.write(randSave(dice(4), 10), NOW); return [where, l.lost, w.rows, st.journal(l.save)]; });
    need(mem[0] === 'memory' && mem[1] === 0 && mem[2] === 0 && mem[3] === false, `with neither: ${JSON.stringify(mem)}`);
    await s.close();
    return `${said.join('; ')}: the store is M1's localStorage save, and the city is kept across pages; with no localStorage either it runs in memory and never throws`;
  });

  await R.row('atomic', async () => {
    const s = await site(), a = await s.tab();
    await a.evaluate(async () => { await open1(); const save = (await st.load(NOW)).save; Object.assign(save, randSave(dice(5), 200)); await st.write(save, NOW); window.base = text(save); localStorage.clear(); });
    const base = await a.evaluate(() => window.base);
    // a big write started, and the page closed with it in flight
    await a.evaluate(() => { const save = randSave(dice(6), 20000); window.st.write(save, NOW + 5); });
    await a.close({ runBeforeUnload: false });
    const b = await s.tab();
    const got = await b.evaluate(async () => { await open1(); const l = await st.load(NOW + 9); return [text(l.save), l.lost, l.save.squares.size]; });
    need(got[1] === 0, `a write cut off left ${got[1]} rows that could not be read`);
    const whole = got[0] === base || got[2] >= 20000;
    need(whole, `a write cut off left a city of ${got[2]} squares, neither the old nor the new`);
    await s.close();
    return `a write of 20,000 squares cut off by the page closing: the next page reads ${got[2] >= 20000 ? 'the whole new city' : 'the old city whole'} (${got[2].toLocaleString('en')} squares), with nothing it can't read (IndexedDB's transaction is all or nothing)`;
  });

  await R.row('persist', async () => {
    const s = await site(), a = await s.tab();
    const out = await a.evaluate(async () => {
      const real = await (await window.L.SafeSave.open('sf')).persist();
      const asked = []; const yes = await (await window.L.SafeSave.open('sf', { storage: { persisted: async () => false, persist: async () => (asked.push(1), true) } })).persist();
      const already = await (await window.L.SafeSave.open('sf', { storage: { persisted: async () => true, persist: async () => (asked.push(2), false) } })).persist();
      const throws = await (await window.L.SafeSave.open('sf', { storage: { persist: async () => { throw new Error('no'); } } })).persist();
      const none = await (await window.L.SafeSave.open('sf', { storage: null })).persist();
      return { real: typeof real, yes, already, throws, none, asked };
    });
    need(out.real === 'boolean' && out.yes === true && out.already === true && out.throws === false && out.none === false && JSON.stringify(out.asked) === '[1]', `persist: ${JSON.stringify(out)}`);
    await s.close();
    return `persist() asks the browser once it isn't kept already (Chromium here answered with a ${out.real}), says yes where it is kept, and is false, never a throw, where the call fails or isn't there`;
  });

  await R.row('reconnect', async () => {
    const s = await site(), a = await s.tab();
    const out = await a.evaluate(async () => {
      await open1();
      const L = window.L, save = (await st.load(NOW)).save;
      Object.assign(save, randSave(dice(8), 100));
      await st.write(save, NOW);
      // the database deleted under the page (site data cleared), then one square changed: everything is written again, not that square alone
      await new Promise((ok) => { const r = indexedDB.deleteDatabase('strugglebus.city.sf'); r.onsuccess = ok; r.onerror = ok; r.onblocked = () => setTimeout(ok, 50); });
      const k = [...save.squares.keys()][0], r0 = save.squares.get(k);
      L.touch(save, { key: k, faction: r0.owner, stage: r0.stage, cracks: 0, hits: r0.hits + 1, tended: NOW + 3 }, (NOW + 3) * 1000);
      const w = await st.write(save, NOW + 3);
      localStorage.clear();
      return [w.rows, save.squares.size, text(save)];
    });
    const b = await s.tab();
    const back = await b.evaluate(async () => { await open1(); return text((await st.load(NOW + 9)).save); });
    need(out[0] >= out[1] && back === out[2], `after the database went, a write wrote ${out[0]} rows of ${out[1]}, and the next page read ${back === out[2] ? 'the city' : 'something else'}`);
    await s.close();
    return `the database deleted under an open page: the next write opens it again and writes every row (${out[0]} for ${out[1]} squares), not just the one changed, and the next page reads the whole city`;
  });
} finally {
  await browser.close();
  server.close();
}
R.done('store');
