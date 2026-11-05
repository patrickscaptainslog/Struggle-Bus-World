// The HUD's rects (src/ui/hudLayout.ts, pure), and their rules in every layout, swapped or not.
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
  readout: [12, 66, 200, 48],
  'settings.v': [343, 64, 40, 40], 'settings.hit': [335, 60, 44, 48],
  'mega.v': [297, 341, 84, 84], 'mega.hit': [285, 329, 94, 108],
  meterCharge: [305, 249, 68, 86],
  cue: [148, 545, 96, 64],
});
ok(home.toast.y === 118 && home.toast.h === 44, 'toast slot y 118 to 162');
table('393x659', layoutHud(393, 659, none, false, false), {
  readout: [12, 12, 200, 48],
  'settings.v': [343, 10, 40, 40], 'settings.hit': [335, 6, 44, 48],
  'mega.v': [297, 255, 84, 84], 'mega.hit': [285, 243, 94, 108],
  meterCharge: [305, 163, 68, 86],
  cue: [148, 422, 96, 64],
});
table('320x568', layoutHud(320, 568, none, false, true), {
  readout: [8, 12, 200, 48],
  'settings.v': [270, 10, 40, 40], 'settings.hit': [262, 6, 44, 48],
  'mega.v': [244, 222, 68, 68], 'mega.hit': [232, 210, 74, 92],
  meterCharge: [244, 130, 68, 86],
});
ok(layoutHud(320, 568, none, false, true).toast.y === 64, 'compact toast slot y 64');
table('852x393', layoutHud(852, 393, side, false, false), {
  readout: [65, 12, 200, 48],
  'settings.v': [748, 10, 40, 40], 'settings.hit': [744, 6, 54, 48],
  'mega.v': [703, 135, 84, 84], 'mega.hit': [691, 123, 102, 108],
  meterCharge: [629, 134, 68, 86],
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
    const hits: Array<[string, Rect]> = [['settings', L.settings.hit], ['mega', L.mega.hit]];
    for (let i = 0; i < hits.length; i++) {
      const [n, r] = hits[i];
      ok(r.w >= 44 && r.h >= 44, `${tag} ${n} hit at least 44: ${r.w} x ${r.h}`);
      ok(r.x >= EDGE_BAND && r.x + r.w <= w - EDGE_BAND, `${tag} ${n} stays out of the edge band: ${r.x}..${r.x + r.w}`);
      ok(r.y + r.h <= h - BOTTOM_CLEAR, `${tag} ${n} clear of the bottom 40 px`);
      for (let j = i + 1; j < hits.length; j++) ok(!overlap(r, hits[j][1]), `${tag} ${n} overlaps ${hits[j][0]}`);
    }
    const vis: Array<[string, Rect]> = [['settings', L.settings.v], ['mega', L.mega.v], ['readout', L.readout], ['meter', L.meterCharge], ['cue', L.cue]];
    for (const [n, r] of vis) {
      ok(r.x >= ins.left && r.x + r.w <= w - ins.right, `${tag} ${n} inside the safe area, x ${r.x}..${r.x + r.w}`);
      ok(r.y >= ins.top && r.y + r.h <= h - Math.max(ins.bottom, BOTTOM_CLEAR), `${tag} ${n} inside the safe area, y ${r.y}..${r.y + r.h}`);
    }
    ok(!overlap(L.readout, L.settings.hit), `${tag} the readout stays clear of settings`);
    // the settings button stays where it is, and MEGA and its meter are all that mirror
    ok(L.settings.v.x === layoutHud(w, h, ins, false, compact).settings.v.x, `${tag} settings stays top right`);
  }
console.log(fails.length ? `FAILED ${fails.length} of ${checks}:\n  ${fails.join('\n  ')}` : `layout checks: all ${checks} passed`);
process.exit(fails.length ? 1 : 0);
