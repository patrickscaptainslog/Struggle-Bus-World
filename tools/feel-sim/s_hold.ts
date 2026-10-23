// The hold gesture (src/game/Input.ts, the super splat's charge), driven by synthetic pointer / key events
// on a fake element with a controllable clock. node tools/feel-sim/run.mjs s_hold.ts
import { clock, el, win } from './holdEnv';
import { Input } from '@src/game/Input';
import { config } from '@src/config';

const inp = new Input(el as unknown as HTMLElement);
const log: string[] = [];
inp.onTap = () => log.push(`tap@${clock.now}`);
inp.onChargeStart = () => log.push(`chargeStart@${clock.now}`);
inp.onChargeEnd = (h, c) => log.push(`chargeEnd(${h.toFixed(2)},${c})@${clock.now}`);
const ev = (id: number, x: number, y: number, primary = true) => ({ pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: x, clientY: y, timeStamp: clock.now, button: 0, cancelable: false, preventDefault() {} });
const down = (id: number, x = 200, y = 600, primary = true) => el.fire('pointerdown', ev(id, x, y, primary));
const move = (id: number, x: number, y: number) => el.fire('pointermove', ev(id, x, y));
const up = (id: number, x = 200, y = 600) => el.fire('pointerup', ev(id, x, y));
const cancel = (id: number) => el.fire('pointercancel', ev(id, 200, 600));
/** advance the clock in 16 ms frames */
const run = (ms: number) => {
  const end = clock.now + ms;
  while (clock.now < end) {
    clock.now = Math.min(end, clock.now + 16);
    inp.update(0.016);
  }
};
const cases: Array<{ name: string; log: string[]; dragging?: boolean; held?: number; ok: boolean }> = [];
const check = (name: string, expect: RegExp[], extra?: () => Partial<{ dragging: boolean; held: number }>) => {
  const got = [...log];
  const ok = got.length === expect.length && expect.every((r, i) => r.test(got[i]));
  cases.push({ name, log: got, ...(extra ? extra() : {}), ok });
  log.length = 0;
  run(500);
  log.length = 0;
};
const TH = config.splat.holdThreshold * 1000;
clock.now = 1000;

down(1); run(100); up(1);
check('quick tap', [/^tap/]);
down(2); run(TH - 40); up(2);
check('still 260 ms: still a tap', [/^tap/]);
down(3); run(1000); const held3 = inp.state.chargeHeld; up(3);
check('hold 1 s: charge, no tap', [/^chargeStart@/, /^chargeEnd\(1\.0\d,false\)/], () => ({ held: held3 }));
down(4); run(1000); move(4, 230, 600); const drag4 = inp.state.dragging; run(200); up(4, 230, 600);
check('hold 1 s then slide 30 px: cancelled, steers', [/^chargeStart/, /^chargeEnd\(1\.0\d,true\)/], () => ({ dragging: drag4 }));
down(5); run(50); move(5, 220, 600); run(1000); up(5, 220, 600);
check('drag at once: steering, never a charge', []);
down(6); run(60); move(6, 240, 600); run(300); down(7, 300, 500, false); run(1000); const held7 = inp.state.chargeHeld; up(7, 300, 500); run(100); up(6, 240, 600);
check('steering + second finger held: its tap on the down, then a charge', [/^tap/, /^chargeStart/, /^chargeEnd\(1\.0\d,false\)/], () => ({ held: held7 }));
down(8); run(800); cancel(8);
check('pointercancel while charging: cancelled', [/^chargeStart/, /^chargeEnd\(0\.8\d,true\)/]);
down(9); run(800); win.fire('blur', {});
check('blur while charging: cancelled', [/^chargeStart/, /^chargeEnd\(0\.8\d,true\)/]);
const key = (code: string, d: boolean, repeat = false) => win.fire(d ? 'keydown' : 'keyup', { code, repeat, target: null, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {} });
key('Space', true); run(100); key('Space', false);
check('Space tap', [/^tap/]);
key('Space', true); run(500); key('Space', true, true); run(700); key('Space', false);
check('Space held 1.2 s: charge', [/^chargeStart/, /^chargeEnd\(1\.2\d,false\)/]);
// two fingers together (nobody steering) still tap once; three fingers still the tuner
down(10); run(20); down(11, 260, 600, false); run(80); up(11, 260, 600); up(10);
check('two-finger tap', [/^tap/]);
console.log(JSON.stringify({ mode: inp.mode, cases }, null, 1));
const bad = cases.filter((c) => !c.ok);
console.log(bad.length ? `FAIL ${bad.length}: ${bad.map((b) => b.name).join('; ')}` : `PASS ${cases.length}/${cases.length}`);
process.exit(bad.length ? 1 : 0);
