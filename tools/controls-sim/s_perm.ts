// The motion permission flow through the REAL TiltControl, offline, with a mocked
// DeviceOrientationEvent: iOS granted / denied / throws (not in a gesture), granted but silent
// (an iframe that refuses motion: the claude.ai preview), no API at all, a sensorless desktop that
// fires one event of nulls, Android (no permission API, events flow).
import { installDom, clock, Target } from './fakedom';
installDom();
import { mkdirSync, writeFileSync } from 'node:fs';
const { TiltControl } = await import('@src/game/Tilt');
const { config } = await import('@src/config');
const { migratePrefs, chipIgnored, tiltTurnedOn, tiltCancelled } = await import('@src/game/controlPrefs');
const { attitude, w3c } = await import('./phone');
const THREE = await import('three');
(globalThis as any).screen = { orientation: { angle: 0 } };

type Case = { name: string; api: 'ios' | 'android' | 'none'; answer?: 'granted' | 'denied' | 'throw' | 'reject'; events: 'flow' | 'silent' | 'nulls' };
const cases: Case[] = [
  { name: 'iOS, granted, events flow', api: 'ios', answer: 'granted', events: 'flow' },
  { name: 'iOS, denied', api: 'ios', answer: 'denied', events: 'flow' },
  { name: 'iOS, requestPermission throws (no gesture)', api: 'ios', answer: 'throw', events: 'flow' },
  { name: 'iOS, requestPermission rejects', api: 'ios', answer: 'reject', events: 'flow' },
  { name: 'iOS, granted but no events (iframe: claude.ai preview)', api: 'ios', answer: 'granted', events: 'silent' },
  { name: 'Android, events flow', api: 'android', events: 'flow' },
  { name: 'desktop: one event of nulls', api: 'android', events: 'nulls' },
  { name: 'no DeviceOrientationEvent', api: 'none', events: 'silent' },
];
const rows: unknown[] = [];
for (const c of cases) {
  // a fresh window per case (no listener or timer from the last case can leak in)
  const w = new Target() as any;
  w.setTimeout = (f: () => void, ms: number) => setTimeout(f, ms);
  w.clearTimeout = (id: any) => clearTimeout(id);
  if (c.api !== 'none') {
    const DOE: any = function () {};
    if (c.api === 'ios')
      DOE.requestPermission = () => {
        if (c.answer === 'throw') throw new Error('NotAllowedError');
        if (c.answer === 'reject') return Promise.reject(new Error('NotAllowedError'));
        return Promise.resolve(c.answer);
      };
    w.DeviceOrientationEvent = DOE;
  }
  (globalThis as any).window = w;
  const tilt = new TiltControl();
  const statuses: string[] = [];
  tilt.onStatus = (s) => statuses.push(s);
  const t0 = Date.now();
  let timer: any = null;
  let start: any = null;
  let settled = false;
  const fire = () => {
    if (c.events === 'silent') return;
    clock.ms += 16.7;
    const e = c.events === 'nulls' ? { beta: null, gamma: null, alpha: null, timeStamp: clock.ms } : { beta: 55 + Math.sin(clock.ms / 300), gamma: 0.5, alpha: 10, timeStamp: clock.ms };
    w.dispatch('deviceorientation', e);
  };
  // events start 120 ms after listening (the sensor spins up)
  const p = TiltControl.needsPermission() ? tilt.request() : tilt.listen();
  start = setTimeout(() => {
    if (!settled) timer = setInterval(fire, 16);
  }, 120);
  const final = await p;
  settled = true;
  clearTimeout(start);
  clearInterval(timer);
  tilt.stop();
  rows.push({ case: c.name, needsPermission: TiltControl.needsPermission(), final, statuses, ms: Date.now() - t0, calibrated: tilt.core.calibrated, samples: tilt.core.samples });
}
mkdirSync('shots/controls/sim', { recursive: true });
writeFileSync('shots/controls/sim/permission.json', JSON.stringify({ eventTimeout: config.tilt.eventTimeout, rows }, null, 1));
for (const r of rows as any[]) console.log(`${r.case.padEnd(56)} -> ${String(r.final).padEnd(12)} [${r.statuses.join(' > ')}] ${r.ms} ms${r.calibrated ? ', calibrated from ' + r.samples + ' samples' : ''}`);
const fails: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) fails.push(m); else console.log('  ok', m); };
const final = (n: string) => (rows as any[]).find((r) => r.case.startsWith(n)).final;
ok(final('iOS, requestPermission throws') === 'blocked', 'a throw ends blocked');
ok(final('iOS, requestPermission rejects') === 'blocked', 'a reject ends blocked');
ok(final('iOS, denied') === 'denied', 'denied stays denied');

// ---- the probe: returns to off and hears motion or not
for (const [name, flow] of [['flowing', true], ['silent', false]] as const) {
  const w = new Target() as any;
  w.setTimeout = (f: () => void, ms: number) => setTimeout(f, ms);
  w.clearTimeout = (id: any) => clearTimeout(id);
  w.DeviceOrientationEvent = function () {};
  (globalThis as any).window = w;
  const t = new TiltControl();
  let timer: any = null;
  if (flow) timer = setInterval(() => { clock.ms += 16.7; w.dispatch('deviceorientation', { beta: 55, gamma: 0, alpha: 0, timeStamp: clock.ms }); }, 4);
  const p = t.probe();
  ok(t.probing, `probe ${name}: probing`);
  const heard = await p;
  clearInterval(timer);
  ok(heard === flow && t.status === 'off' && !t.probing && !w.has('deviceorientation'), `probe ${name}: heard ${heard}, status back to off, listener gone`);
}

// ---- stillness: a corner reach is not the neutral
const D = new THREE.Matrix4();
const seg = (pts: number[][]) => (t: number) => { if (t <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (t < pts[i][0]) { const [a, x] = pts[i - 1], [c, y] = pts[i]; const u = (t - a) / (c - a); return x + (y - x) * u * u * (3 - 2 * u); } return pts[pts.length - 1][1]; };
const swing = seg([[0, 25], [0.1, 25], [0.5, 0], [9, 0]]);
const feed = (c: any, roll: number, t: number) => { const e = w3c(attitude({ lean: 35, roll, pitch: 0, yaw: 0, screen: 0 }, D)); c.feed(e.beta, e.gamma, 0, t); };
{
  const tc = new TiltControl();
  const c = tc.core;
  c.calibrate();
  let t = 10, at = -1;
  for (let i = 0; i < 180 && !c.calibrated; i++, t += 1 / 60) { feed(c, swing(t - 10), t); at = t - 10; }
  c.anglesOf(c.g, c.anglesProbe ?? (c.anglesProbe = { r: 0, p: 0 }));
  ok(c.calibrated && Math.abs(c.anglesProbe.r) < 1, `toggle-on: a 25 degree swing pausing 0.1 s then returning is not the neutral (calibrated ${at.toFixed(2)} s in, phone reads ${c.anglesProbe.r.toFixed(2)} off it)`);
}
{
  const c = new TiltControl().core;
  c.calibrate();
  let t = 0;
  for (let i = 0; i < 120; i++, t += 1 / 60) feed(c, 0, t); // neutral at the grip
  t = 20;
  for (let i = 0; i <= 24; i++, t += 1 / 60) feed(c, (25 * i) / 24, t); // the reach, 0.4 s, up to the press
  c.recenterStill();
  const t0 = t;
  for (let i = 0; i < 180; i++, t += 1 / 60) feed(c, swing(t - t0), t);
  const o = { r: 0, p: 0 };
  c.anglesOf(c.g, o);
  ok(Math.abs(o.r) < 1, `RECENTER: the same swing is not the neutral (phone at the grip reads ${o.r.toFixed(2)})`);
}
{
  // the 1.5 s cap: a phone that never settles still calibrates
  const c = new TiltControl().core;
  c.calibrate();
  let t = 0, at = -1;
  for (let i = 0; i < 300 && !c.calibrated; i++, t += 1 / 60) { feed(c, 30 * Math.sin(t * 9), t); at = t; }
  ok(c.calibrated && at < config.tilt.settleMax + config.tilt.calibrate + 0.1, `a phone that never settles calibrates by the cap (${at.toFixed(2)} s)`);
}

// ---- prefs
{
  const a = migratePrefs({ mode: 'tilt', sens: 1.2 }), b = migratePrefs({ mode: 'touch' }), c0 = migratePrefs({ muted: true });
  ok(a.tilt === true && !('mode' in a) && a.sens === 1.2, "migration: 'tilt' becomes tilt: true");
  ok(b.tilt === false && !('mode' in b), "migration: 'touch' becomes tilt: false");
  ok(!('tilt' in c0) && c0.muted === true, 'migration: absent stays undecided');
  const p: any = { tilt: true };
  chipIgnored(p);
  ok(p.tilt === true && p.chipIgnored === 1, 'one ignored chip keeps tilt');
  tiltTurnedOn(p);
  ok(p.chipIgnored === 0, 'a turn-on resets the count');
  chipIgnored(p);
  chipIgnored(p);
  ok(!('tilt' in p), 'two ignored chips in a row clear tilt');
  const q: any = { tilt: true };
  tiltCancelled(q);
  ok(!('tilt' in q), 'a Busy tap clears tilt');
}
console.log(fails.length ? `FAILED ${fails.length}:\n  ${fails.join('\n  ')}` : 'permission checks: all passed');
process.exit(fails.length ? 1 : 0);
