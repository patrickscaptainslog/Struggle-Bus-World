#!/usr/bin/env node
// The postcard link's and the save's fuzz (docs/specs/core/LINK.md, M1's task 6). No browser: the real src/link code, and the real areas.ts beside it.
//   node tools/link/fuzz.mjs            every row; exit 1 if any fails
//   node tools/link/fuzz.mjs round tiles    only those rows
//   --trace  a failing row's stack      --print-golden  the pinned texts as the code now makes them
// M1's three: `round` and `saved` (10,000 random states round-trip exactly), `tiles` (every loading order of 9 tiles gives the same saved city),
// `length` (a 17-square place's address is under 2,000 characters). The rest hold what those three lean on: LINK.md section 10 says what each does.
// The pinned texts (`golden`, `records`) move only when the format does: --print-golden prints them as the code now makes them.
import { load, loadStamp, runner, sfFiles } from './lib.mjs';
import { linkRows } from './rows-link.mjs';
import { saveRows } from './rows-save.mjs';

const L = await load(), R = runner(), page = loadStamp();
await linkRows(R, L, page.stamp);
await saveRows(R, L, sfFiles(), page.lastCard);
R.done('link');
