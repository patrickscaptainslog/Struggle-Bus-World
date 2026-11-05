// The tuner's sky.live row (docs/reviews/main-live-2026-11-05.md, the trivial one): sky/flag.ts reads config.sky.live as the modules load, before main.ts applies the
// tuner's saved values, so a row for it moved nothing but the row. It goes, as far.on's did: no row, and no saved value turns it; the sky's other rows still apply.
// No browser: node tools/sky/run.mjs tuner.ts. A page's globals first, then the real config, flag and Tuner, a saved sky.live off and a saved tickPx beside it.
const store = new Map<string, string>([['sb.tuning.v1', JSON.stringify({ config: { 'sky.live': false, 'sky.tickPx': 3 }, groups: {} })]]);
const g = globalThis as Record<string, unknown>;
g.location = { href: 'http://local/', search: '' };
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
g.window = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval };
g.document = { addEventListener() {}, hidden: false };

const { config } = await import('@src/config');
const { skyLive } = await import('@src/sky/flag');
const { applySavedTuning } = await import('@src/ui/Tuner');
const before = config.sky.live;
applySavedTuning();

let fails = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) fails++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${what}`);
};
check(skyLive && before, `the page's flag, read as the modules load: the live sky on (${skyLive})`);
check(config.sky.live === true, `a saved sky.live: false turns nothing: config.sky.live ${config.sky.live} after applySavedTuning, the flag ${skyLive}${config.sky.live !== skyLive ? ' (the row moved the value and not the page)' : ''}`);
check(config.sky.tickPx === 3, `the sky's other saved values still apply: tickPx ${config.sky.tickPx}`);
console.log(fails ? `${fails} failed` : 'no sky.live row, and nothing saved can turn it');
process.exit(fails ? 1 : 0);
