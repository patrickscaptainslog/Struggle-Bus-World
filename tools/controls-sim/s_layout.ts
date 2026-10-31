// The HUD's rects (src/ui/hudLayout.ts, pure) against docs/specs/hybrid-controls.md section 3, and its rules in every
// layout, swapped or not.
import { BOTTOM_CLEAR, EDGE_BAND, isCompact, layoutHud, type HudLayout, type Rect } from '@src/ui/hudLayout';

const fails: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => {
  checks++;
  if (!c) fails.push(m);
};
type T = [number, number, number, number];
const eq = (name: string, r: Rect, t: T) => ok(r.x === t[0] && r.y === t[1] && r.w === t[2] && r.h === t[3], `${name}: ${[r.x, r.y, r.w, r.h]} wanted ${t}`);

const notch = { top: 59, right: 0, bottom: 34, left: 0 };
const none = { top: 0, right: 0, bottom: 0, left: 0 };
const side = { top: 0, right: 59, bottom: 21, left: 59 };

function table(name: string, L: HudLayout, t: Record<string, T>) {
  const get = (k: string): Rect => {
    const [a, b] = k.split('.');
    const v = (L as unknown as Record<string, unknown>)[a] as Record<string, Rect> & Rect;
    return b ? v[b] : v;
  };
  for (const k in t) eq(`${name} ${k}`, get(k), t[k]);
}
const home = layoutHud(393, 852, notch, false, false);
table('393x852', home, {
  'toggle.v': [12, 64, 32, 32], 'toggle.hit': [14, 58, 44, 46],
  readout: [52, 66, 200, 48],
  'recenter.v': [295, 64, 40, 40], 'recenter.hit': [287, 60, 48, 48],
  'settings.v': [343, 64, 40, 40], 'settings.hit': [335, 60, 44, 48],
  'turbo.v': [12, 187, 72, 72], 'turbo.hit': [14, 177, 82, 84],
  'down.v': [12, 263, 72, 32], 'down.hit': [14, 261, 82, 46],
  'mega.v': [297, 341, 84, 84], 'mega.hit': [285, 329, 94, 108],
  meterCharge: [305, 249, 68, 86],
  'chip.v': [96, 664, 200, 48], 'chip.hit': [76, 652, 240, 72],
  cue: [148, 545, 96, 64],
});
ok(home.toast.y === 118 && home.toast.h === 44, 'toast slot y 118 to 162');
table('393x659', layoutHud(393, 659, none, false, false), {
  'toggle.v': [12, 10, 32, 32], 'toggle.hit': [14, 4, 44, 46],
  readout: [52, 12, 200, 48],
  'recenter.v': [295, 10, 40, 40], 'recenter.hit': [287, 6, 48, 48],
  'settings.v': [343, 10, 40, 40], 'settings.hit': [335, 6, 44, 48],
  'turbo.v': [12, 145, 72, 72], 'turbo.hit': [14, 135, 82, 84],
  'down.v': [12, 221, 72, 32], 'down.hit': [14, 219, 82, 46],
  'mega.v': [297, 255, 84, 84], 'mega.hit': [285, 243, 94, 108],
  meterCharge: [305, 163, 68, 86],
  'chip.v': [96, 514, 200, 48], 'chip.hit': [76, 502, 240, 72],
  cue: [148, 422, 96, 64],
});
table('320x568', layoutHud(320, 568, none, false, true), {
  'toggle.v': [8, 10, 32, 32], 'toggle.hit': [14, 4, 44, 46],
  readout: [52, 52, 200, 48],
  'recenter.v': [222, 10, 40, 40], 'recenter.hit': [214, 6, 48, 48],
  'settings.v': [270, 10, 40, 40], 'settings.hit': [262, 6, 44, 48],
  'turbo.v': [8, 125, 60, 60], 'turbo.hit': [14, 117, 66, 72],
  'down.v': [8, 189, 60, 28], 'down.hit': [14, 189, 66, 44],
  'mega.v': [244, 222, 68, 68], 'mega.hit': [232, 210, 74, 92],
  meterCharge: [244, 130, 68, 86],
  'chip.v': [60, 443, 200, 48], 'chip.hit': [40, 431, 240, 72],
});
ok(layoutHud(320, 568, none, false, true).toast.y === 104, 'compact toast slot y 104');
table('852x393', layoutHud(852, 393, side, false, false), {
  'toggle.v': [65, 10, 32, 32], 'toggle.hit': [53, 4, 52, 46],
  readout: [105, 12, 200, 48],
  'recenter.v': [700, 10, 40, 40], 'recenter.hit': [696, 6, 48, 48],
  'settings.v': [748, 10, 40, 40], 'settings.hit': [744, 6, 54, 48],
  'turbo.v': [65, 86, 72, 72], 'turbo.hit': [53, 76, 96, 84],
  'down.v': [65, 162, 72, 32], 'down.hit': [53, 160, 96, 46],
  'mega.v': [703, 135, 84, 84], 'mega.hit': [691, 123, 102, 108],
  meterCharge: [629, 134, 68, 86],
  'chip.v': [326, 306, 200, 48], 'chip.hit': [306, 294, 240, 72],
});
ok(isCompact(320, 568) && isCompact(568, 320) && !isCompact(393, 852) && !isCompact(852, 393), 'compact is decided by the short side');

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const sets: Array<[string, number, number, typeof none, boolean]> = [
  ['393x852', 393, 852, notch, false], ['393x659', 393, 659, none, false], ['320x568', 320, 568, none, true], ['568x320', 568, 320, none, true],
  ['852x393', 852, 393, side, false], ['430x932', 430, 932, notch, false], ['375x667', 375, 667, none, false],
];
for (const [name, w, h, ins, compact] of sets)
  for (const swap of [false, true]) {
    const L = layoutHud(w, h, ins, swap, compact);
    const tag = `${name}${swap ? ' swap' : ''}`;
    const hits: Array<[string, Rect]> = [['toggle', L.toggle.hit], ['recenter', L.recenter.hit], ['settings', L.settings.hit], ['turbo', L.turbo.hit], ['down', L.down.hit], ['mega', L.mega.hit], ['chip', L.chip.hit]];
    for (let i = 0; i < hits.length; i++) {
      const [n, r] = hits[i];
      ok(r.w >= 44 && r.h >= 44, `${tag} ${n} hit at least 44: ${r.w} x ${r.h}`);
      ok(r.x >= EDGE_BAND && r.x + r.w <= w - EDGE_BAND, `${tag} ${n} stays out of the edge band: ${r.x}..${r.x + r.w}`);
      // (the one exception is the spec's own table: turned, the chip sits at 78 % and it is the transient one)
      if (n !== 'chip' || h > w) ok(r.y + r.h <= h - BOTTOM_CLEAR, `${tag} ${n} clear of the bottom 40 px`);
      for (let j = i + 1; j < hits.length; j++) ok(!overlap(r, hits[j][1]), `${tag} ${n} overlaps ${hits[j][0]}`);
    }
    const vis: Array<[string, Rect]> = [['toggle', L.toggle.v], ['recenter', L.recenter.v], ['settings', L.settings.v], ['turbo', L.turbo.v], ['down', L.down.v], ['mega', L.mega.v], ['chip', L.chip.v], ['readout', L.readout], ['meter', L.meterCharge], ['cue', L.cue]];
    for (const [n, r] of vis) {
      ok(r.x >= ins.left && r.x + r.w <= w - ins.right, `${tag} ${n} inside the safe area, x ${r.x}..${r.x + r.w}`);
      ok(r.y >= ins.top && r.y + r.h <= h - (n === 'chip' && w > h ? ins.bottom : Math.max(ins.bottom, BOTTOM_CLEAR)), `${tag} ${n} inside the safe area, y ${r.y}..${r.y + r.h}`);
    }
    ok(L.toggle.v.x === layoutHud(w, h, ins, false, compact).toggle.v.x, `${tag} the toggle stays top left`);
    // the toggle never sits near TURBO (a stretching thumb cannot hit one for the other)
    if (!swap && h > w) ok(L.turbo.v.y - (L.toggle.v.y + L.toggle.v.h) >= 40, `${tag} toggle and TURBO stay apart`);
  }
console.log(fails.length ? `FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `layout checks: all ${checks} passed`);
process.exit(fails.length ? 1 : 0);
