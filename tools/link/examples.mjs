#!/usr/bin/env node
// The example addresses of docs/specs/core/LINK.md, made by the code: `node tools/link/examples.mjs` prints each with its length and what it reads as.
import { load, dice, randOrder } from './lib.mjs';

const L = await load(), ORIGIN = 'https://struggle-bus-world.vercel.app', rnd = dice(2026);
const at = L.cardMinute(Date.UTC(2026, 10, 14, 18, 30) / 1000);
const block = (n, x0, z0, w) => Array.from({ length: n }, (_, i) => ({ ix: x0 + (i % w), iz: z0 + Math.floor(i / w), stage: 1 + ((i * 3 + Math.floor(i / w)) % 4) }));
const squares = (list, ix, iz, more = {}) => ({ form: 'squares', squares: list, order: randOrder(list, rnd), answers: null, score: null, ...more });
const head = { v: 1, map: 0, ix: -3, iz: 14, crew: 2, at, caption: 'GUERRERO ST & 24TH ST' };
const one = L.encode({ ...head, body: squares([{ ix: -3, iz: 14, stage: 4 }]) });
const cards = [
  ['A street, and no more (M1\'s card from FLY TO A STREET)', 'mission', 0, { ...head, body: null }],
  ['The Golden Gate, crowned (M1\'s card from the door)', 'ggb', 0, { v: 1, map: 0, ix: -41, iz: -34, crew: 1, at, caption: 'GOLDEN GATE BRIDGE', body: { form: 'mark', key: 'GGB', stage: 4, answers: null } }],
  ['One square, lifted', 'mission', 0, { ...head, body: squares([{ ix: -3, iz: 14, stage: 4 }]) }],
  ['Nine squares', 'mission', 0, { ...head, body: squares(block(9, -4, 13, 3)) }],
  ['Seventeen squares', 'mission', 0, { ...head, body: squares(block(17, -5, 13, 5)) }],
  ['An answer to the one-square card, one card down the chain', 'mission', 1, { ...head, crew: 4, at: at + 95, caption: 'TAKEN', body: squares(block(4, -4, 14, 2), -3, 14, { answers: one.id30 }) }],
  ['A card of today\'s place (a score: shown, never landed)', 'mission', 0, { ...head, body: squares(block(6, -4, 13, 3), -3, 14, { score: { budget: 60, used: 41 } }) }],
];
for (const [what, place, gen, card] of cards) {
  const e = L.encode(card);
  if (!e.ok) throw new Error(`${what}: ${e.why}`);
  const url = L.cardUrl(ORIGIN, place, gen, e.text);
  console.log(`## ${what}\n${url}\n(${url.length} characters; the card ${e.text.length})\n${L.explain(url)}\n`);
}
const seventeen = L.cardUrl(ORIGIN, 'mission', 0, L.encode(cards[4][3]).text);
console.log(`## The seventeen-square address cut off after 150 characters\n${L.explain(seventeen.slice(0, 150))}\n`);
console.log(`## And after 110\n${L.explain(seventeen.slice(0, 110))}\n`);
console.log(`## Test values\ncrc15 of the alphabet's 32 characters in order: ${L.crc(L.ALPHABET, 15, 0x4599)}\ncrc30 of the same: ${L.crc(L.ALPHABET, 30, 0x2030b9c7)}`);
