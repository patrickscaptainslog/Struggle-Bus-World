// The factions' colours apart (docs/specs/factions/FACTIONS.md, step 5's "Colours."): no browser, the game's own tables.
//   node tools/sky/run.mjs ../factions/colours.ts [--all]
// Every faction's walls are its look's body rows (src/render/factionLook.ts). For each of the live sky's seven tables (noon, the day, morning, golden, sunset,
// dawn, the blue hour and night) and four kinds of sight (normal, and protanopia, deuteranopia and tritanopia simulated by Machado, Oliveira and Fernandes
// 2009 at full severity, on linear RGB), each pair of factions is the least OKLab distance between any wall colour of one and any of the other at the same
// step: in shade (steps 2-3, a wall the sun misses) and in the sun (4-5). Rainbow's own six hues against each other are the line to beat: a faction pair
// nearer than that would blur where Rainbow's own hues already do. --all: every table's numbers, not only each pair's worst.
// Then the rules the faction rows keep, in every table: no brown or taupe swatch (art's gate, tools/sky/oklch.mjs), every wall step 2-5 off the grey world's,
// and the one rule's numbers (the table's world peak against each faction's wall median, steps 2-5): printed, not gated, as Rainbow's 0.75 can't hold for a
// faction lighter or darker than Rainbow's six, which is how they stay apart. Exit 1 if a pair is under PASS in a table or a faction swatch is brown.
import { isBrown, lch } from '../sky/oklch.mjs';
import { FACTIONS } from '@src/game/factions';
import { FACTION_LOOKS } from '@src/render/factionLook';
import { dayRows, FACTION_RAMPS, HUE_RAMPS, Ramp } from '@src/render/palette';
import { BLUE_TABLE } from '@src/sky/SkyTable';
import { DAWN_TABLE, DAY_EXTRA, GOLDEN_TABLE, MORNING_TABLE, NOON_TABLE, SUNSET_TABLE } from '@src/sky/SkyTables';

const all = process.argv.includes('--all');
const NAME = Object.fromEntries(Object.entries(Ramp).map(([k, v]) => [v, k]));
const SKIES: Record<string, Record<number, string[]>> = {
  noon: NOON_TABLE,
  day: { ...dayRows, ...DAY_EXTRA },
  morning: MORNING_TABLE,
  golden: GOLDEN_TABLE,
  sunset: SUNSET_TABLE,
  dawn: DAWN_TABLE,
  blue: BLUE_TABLE,
};
/** Machado et al. 2009, severity 1, on linear RGB */
const SIGHT: Record<string, number[] | null> = {
  normal: null,
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
/** a pair under this blurs: normal sight, then the three simulated */
const PASS = { normal: 0.1, cvd: 0.06 };
const BANDS: Array<[string, number[]]> = [['shade', [2, 3]], ['sun', [4, 5]]];
/** the grey world's rows a wall must stand off: the city, its towers, its trees, its trim */
const GREY = [Ramp.GREY, Ramp.GREY_LIGHT, Ramp.GREEN_GREY, Ramp.WINDOW, Ramp.ROOF_DARK, Ramp.STONE, Ramp.GRANITE, Ramp.GLASS, Ramp.WHITE];

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function oklab(hex: string, m: number[] | null): [number, number, number] {
  let r = lin(parseInt(hex.slice(1, 3), 16) / 255), g = lin(parseInt(hex.slice(3, 5), 16) / 255), b = lin(parseInt(hex.slice(5, 7), 16) / 255);
  if (m) {
    const c = (x: number) => Math.min(1, Math.max(0, x));
    [r, g, b] = [c(m[0] * r + m[1] * g + m[2] * b), c(m[3] * r + m[4] * g + m[5] * b), c(m[6] * r + m[7] * g + m[8] * b)];
  }
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s];
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const num = (c: string) => parseInt(c.slice(1), 16);

const looks = FACTIONS.map((f) => ({ key: f.key, walls: [...new Set(FACTION_LOOKS[f.id].body)] }));
let fails = 0;

console.log('the factions\' rows (the day\'s table; every table grades them as paint, tools/sky/tables.py):');
for (const r of FACTION_RAMPS) console.log(`  ${r} ${NAME[r].padEnd(9)} ${dayRows[r].join(' ')}`);
console.log('walls: ' + looks.map((l) => `${l.key} ${l.walls.map((r) => NAME[r]).join(', ')}`).join('; '));

// ---- the distances: each table, each sight, each pair, each band
type Cell = { d: number; at: string };
const res = new Map<string, Cell>();
const pairs: Array<[number, number]> = [];
for (let i = 0; i < looks.length; i++) for (let j = i + 1; j < looks.length; j++) pairs.push([i, j]);
for (const [sky, T] of Object.entries(SKIES))
  for (const [sight, m] of Object.entries(SIGHT)) {
    const lab = (r: number, s: number) => oklab(T[r][s], m);
    for (const [band, steps] of BANDS) {
      const near = (A: number[], B: number[], self: boolean): Cell => {
        let best: Cell = { d: 9, at: '' };
        for (const a of A)
          for (const b of B) {
            if (self && b <= a) continue;
            for (const s of steps) {
              const d = dist(lab(a, s), lab(b, s));
              if (d < best.d) best = { d, at: `${NAME[a]}/${NAME[b]} ${s}` };
            }
          }
        return best;
      };
      for (const [i, j] of pairs) res.set(`${sky} ${sight} ${band} ${i} ${j}`, near(looks[i].walls, looks[j].walls, false));
      res.set(`${sky} ${sight} ${band} self`, near([...HUE_RAMPS], [...HUE_RAMPS], true));
    }
  }
const cell = (c: Cell) => `${c.d.toFixed(3)} ${c.at}`;
for (const sight of Object.keys(SIGHT)) {
  const pass = sight === 'normal' ? PASS.normal : PASS.cvd;
  console.log(`\n${sight}: each pair's least distance over the seven tables (the table, and the two colours at their step); fail under ${pass}`);
  const rows: Array<[string, (band: string) => string]> = pairs.map(([i, j]) => [`${looks[i].key}/${looks[j].key}`, (band: string) => {
    let w: Cell & { sky?: string } = { d: 9, at: '' };
    for (const sky of Object.keys(SKIES)) {
      const c = res.get(`${sky} ${sight} ${band} ${i} ${j}`)!;
      if (c.d < pass) fails++;
      if (c.d < w.d) w = { ...c, sky };
    }
    return `${w.d < pass ? 'FAIL ' : ''}${w.d.toFixed(3)} ${w.sky} ${w.at}`;
  }]);
  rows.push(["rainbow's own", (band: string) => {
    let w: Cell & { sky?: string } = { d: 9, at: '' };
    for (const sky of Object.keys(SKIES)) {
      const c = res.get(`${sky} ${sight} ${band} self`)!;
      if (c.d < w.d) w = { ...c, sky };
    }
    return `${w.d.toFixed(3)} ${w.sky} ${w.at}`;
  }]);
  for (const [name, f] of rows) console.log(`  ${name.padEnd(20)} shade ${f('shade').padEnd(44)} sun ${f('sun')}`);
  if (all)
    for (const sky of Object.keys(SKIES))
      console.log(`    ${sky.padEnd(8)} ` + pairs.map(([i, j]) => `${looks[i].key.slice(0, 4)}/${looks[j].key.slice(0, 4)} ${res.get(`${sky} ${sight} shade ${i} ${j}`)!.d.toFixed(3)}|${res.get(`${sky} ${sight} sun ${i} ${j}`)!.d.toFixed(3)}`).join('  ') + `  own ${res.get(`${sky} ${sight} shade self`)!.d.toFixed(3)}|${res.get(`${sky} ${sight} sun self`)!.d.toFixed(3)}`);
}

// ---- the rules the faction rows keep
console.log('\nin every table:');
for (const [sky, T] of Object.entries(SKIES)) {
  let brown = 0;
  const bad: string[] = [];
  for (const r of FACTION_RAMPS)
    for (let s = 0; s < 8; s++)
      if (isBrown(num(T[r][s]))) {
        brown++;
        bad.push(`${NAME[r]} ${s} ${T[r][s]}`);
      }
  fails += brown;
  // (the grey world: a wall's step 2-5 nearest any of its swatches)
  const greys = GREY.flatMap((r) => T[r].map((h) => oklab(h, null)));
  let grey: Cell = { d: 9, at: '' };
  for (const l of looks) for (const r of l.walls) for (let s = 2; s <= 5; s++) {
    const d = Math.min(...greys.map((g) => dist(g, oklab(T[r][s], null))));
    if (d < grey.d) grey = { d, at: `${l.key} ${NAME[r]} ${s}` };
  }
  // (the one rule's numbers: the world's peak chroma, every row but paint and the bus, against each faction's wall median)
  const paint = new Set([...HUE_RAMPS, ...FACTION_RAMPS, Ramp.BUS_YELLOW, Ramp.BUS_BLACK]);
  let peak = 0, peakAt = '';
  for (const [r, row] of Object.entries(T)) {
    if (paint.has(Number(r))) continue;
    row.forEach((h, s) => {
      const C = lch(num(h))[1];
      if (C > peak) [peak, peakAt] = [C, `${NAME[Number(r)]} ${s}`];
    });
  }
  const med = looks.map((l) => {
    const cs = l.walls.flatMap((r) => [2, 3, 4, 5].map((s) => lch(num(T[r][s]))[1])).sort((a, b) => a - b);
    const m = cs.length % 2 ? cs[(cs.length - 1) / 2] : (cs[cs.length / 2 - 1] + cs[cs.length / 2]) / 2;
    return `${l.key} ${m.toFixed(3)} (${(peak / m).toFixed(2)})`;
  });
  console.log(`  ${sky.padEnd(8)} brown ${brown}${bad.length ? ` FAIL ${bad.join(', ')}` : ''}; nearest the grey world ${cell(grey)}; world peak ${peak.toFixed(3)} (${peakAt}) against the walls' median: ${med.join(', ')}`);
}
console.log(fails ? `\n${fails} fails` : '\nno pair blurs in any table under any of the four, and no faction swatch is brown');
process.exit(fails ? 1 : 0);
