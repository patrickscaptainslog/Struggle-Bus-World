// lamps.bin waits for the city and for the dusk (docs/reviews/main-live-2026-11-05.md, m2): the real Lamps, its fetch counted, the frames main.ts gives it (Lamps.ask:
// whether the city's first tiles are in, the Sun's height), and the margin LAMPS_SUN leaves before the lamps light, from SkyModel's Sun over a year. No browser:
//   node tools/sky/run.mjs lamps.ts
// The pools' stamping follows the list (Lamps.onLanded, City.setPools), so with no list there is none. A Lamps with no ask() (the old one) is run as main.ts ran
// it: the request at far.bin, nothing a frame. And what the request holds until the dusk is far.bin's own heights, not a copy (City.groundGrid, fix/live's
// review). Exit 1 on any failure.
const fetches: Array<{ url: string; init?: RequestInit }> = [];
const g = globalThis as Record<string, unknown>;
g.location = { href: 'http://local/', search: '' };
g.fetch = async (url: string, init?: RequestInit) => {
  fetches.push({ url: String(url), init });
  return new Response(null, { status: 404 });
};

const mod = (await import('@src/sky/Lamps')) as typeof import('@src/sky/Lamps') & { LAMPS_SUN?: number };
const { Lamps } = mod;
const SUN = mod.LAMPS_SUN ?? NaN;
const { series } = await import('@src/sky/series.gen.js');
const { EARTH, SkyModel, SkyState } = await import('@src/sky/SkyModel');
const { axesAt, geodeticToFix } = await import('@src/sky/WorldFrame');
const { City } = await import('@src/world/City');

const GROUND = { ground: new Float32Array(4), gridW: 2, gridH: 2, minX: 0, minZ: 0, cell: 64 };
/** far.bin's grid as City holds it, San Francisco's size, and what main.ts's line hands Lamps.load: the real City.groundGrid of it */
const FAR = { heights: new Float32Array(449 * 553), gridW: 449, gridH: 553, minX: 0, minZ: 0, cell: 64 };
const groundGrid = () => (City.prototype.groundGrid as unknown as (this: { far: typeof FAR }) => typeof GROUND).call({ far: FAR });
const settle = () => new Promise((r) => setTimeout(r, 20));
type L = InstanceType<typeof Lamps> & { ask?: (cityIn: boolean, sunEl: number) => void };
/** a frame of main.ts's, for the Lamps */
const ask = (l: L, cityIn: boolean, sunEl: number) => l.ask?.(cityIn, sunEl);
const priority = (i: number) => fetches[i]?.init?.priority ?? 'default';
let fails = 0;
const row = async (name: string, fn: () => Promise<string | null>) => {
  fetches.length = 0;
  let why: string | null;
  try {
    why = await fn();
  } catch (e) {
    why = `threw: ${(e as Error).message}`;
  }
  if (why) fails++;
  console.log(`${why ? 'FAIL' : 'pass'}  ${name}${why ? `: ${why}` : ''}`);
};
/** a Lamps with its request, as main.ts's line behind far.bin gives it */
const staged = (): L => {
  const l = new Lamps() as L;
  l.load('./city/sf/lamps.bin?v=osm8', GROUND, 256);
  return l;
};

await row('far.bin in, by day, a thousand frames with the city in: nothing fetched, and nothing for QA to wait on', async () => {
  const l = staged();
  for (let i = 0; i < 1000; i++) ask(l, true, 30);
  await settle();
  return fetches.length ? `${fetches.length} fetched, priority ${priority(0)}` : l.busy ? 'still busy' : null;
});
await row("far.bin in, by day, the city in: what Lamps keeps is far.bin's own heights, no copy of them (1 MB in San Francisco, held all day)", async () => {
  const l = new Lamps() as L;
  l.load('./city/sf/lamps.bin?v=osm8', groundGrid(), 256);
  for (let i = 0; i < 1000; i++) ask(l, true, 30);
  await settle();
  const held = (l as unknown as { req?: { ground?: Float32Array } | null }).req?.ground;
  return held && held !== FAR.heights ? `a copy of ${held.byteLength.toLocaleString('en-US')} bytes` : null;
});
await row('at night, the city not in yet: nothing fetched, and QA waits', async () => {
  const l = staged();
  for (let i = 0; i < 10; i++) ask(l, false, -10);
  const busy = l.busy;
  await settle();
  return fetches.length ? `${fetches.length} fetched before the city` : !busy ? 'not busy' : null;
});
await row('at night, once the city is in: one fetch, at low priority, and busy until it lands', async () => {
  const l = staged();
  ask(l, false, -10);
  ask(l, true, -10);
  const busy = l.busy;
  for (let i = 0; i < 10; i++) ask(l, true, -10);
  await settle();
  if (fetches.length !== 1) return `${fetches.length} fetches`;
  if (priority(0) !== 'low') return `priority ${priority(0)}`;
  return !busy ? 'not busy while it came' : l.busy ? 'still busy after it came' : null;
});
await row(`the evening: fetched once, on the first frame with the Sun under LAMPS_SUN (${SUN} degrees)`, async () => {
  const l = staged();
  let at = NaN;
  for (let k = 1000; k >= -1000; k--) {
    const n = fetches.length;
    ask(l, true, k / 100);
    if (fetches.length > n && Number.isNaN(at)) at = k / 100;
  }
  await settle();
  return fetches.length !== 1 ? `${fetches.length} fetches` : !(at < SUN && at >= SUN - 0.011) ? `fetched ${Number.isNaN(at) ? 'at load' : `at ${at} degrees`}` : null;
});
await row("the city in once, then streaming again at dusk: it isn't held back", async () => {
  const l = staged();
  ask(l, true, 30);
  const before = fetches.length;
  ask(l, false, 1);
  await settle();
  return before ? `${before} fetched by day` : fetches.length !== 1 ? `${fetches.length} fetches` : null;
});
await row('at night, far.bin still coming: QA waits, and the fetch goes once it is in', async () => {
  const l = new Lamps() as L;
  ask(l, true, -10);
  const waited = l.busy;
  l.load('./city/sf/lamps.bin?v=osm8', GROUND, 256);
  ask(l, true, -10);
  await settle();
  return !waited ? 'not busy while far.bin came' : fetches.length !== 1 ? `${fetches.length} fetches` : priority(0) !== 'low' ? `priority ${priority(0)}` : null;
});
await row('far.bin never came (main.ts clears busy): nothing fetched, nothing waits', async () => {
  const l = new Lamps() as L;
  l.busy = false;
  for (let i = 0; i < 10; i++) ask(l, true, -10);
  await settle();
  return fetches.length ? `${fetches.length} fetched` : l.busy ? 'busy again' : null;
});

// the margin: from the Sun's crossing LAMPS_SUN, setting, to -2 degrees, where the first lamps come on (LiveSky's wave, -2 to -4)
if (!Number.isNaN(SUN)) {
  const DEG = Math.PI / 180, model = new SkyModel(series), st = new SkyState();
  const t0 = Date.parse('2026-11-05T00:00:00Z'), STEP = 15000;
  for (const [name, lat, lon] of [['San Francisco', 37.7749, -122.4194], ['London', 51.5073, -0.1657], ['Amsterdam', 52.3752, 4.8822]] as Array<[string, number, number]>) {
    const ob = { body: EARTH, free: false, pos: geodeticToFix(lat, lon, 0, new Float64Array(3)), axes: axesAt(lat, lon, 0, new Float64Array(9)) };
    let prev = NaN, asked = NaN, least = Infinity, most = 0, when = '';
    for (let ms = t0; ms < t0 + 365 * 864e5; ms += STEP) {
      model.frame(ms, ob, st);
      const h = Math.asin(Math.max(-1, Math.min(1, st.sun[1]))) / DEG;
      if (prev >= SUN && h < SUN) asked = ms;
      if (prev >= -2 && h < -2 && !Number.isNaN(asked)) {
        const m = (ms - asked) / 60000;
        if (m < least) {
          least = m;
          when = new Date(ms).toISOString().slice(0, 10);
        }
        most = Math.max(most, m);
        asked = NaN;
      }
      prev = h;
    }
    console.log(`margin  ${name}: from ${SUN} degrees to -2, setting, ${least.toFixed(1)} to ${most.toFixed(1)} minutes over a year (the least on ${when})`);
  }
}
console.log(fails ? `${fails} failed` : 'lamps.bin waits for the city and the dusk');
process.exit(fails ? 1 : 0);
