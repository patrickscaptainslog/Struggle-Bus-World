// The motion permission flow through the REAL TiltControl, offline, with a mocked
// DeviceOrientationEvent: iOS granted / denied / throws (not in a gesture), granted but silent
// (an iframe that refuses motion: the claude.ai preview), no API at all, a sensorless desktop that
// fires one event of nulls, Android (no permission API, events flow).
import { installDom, clock, Target } from './fakedom';
installDom();
import { mkdirSync, writeFileSync } from 'node:fs';
const { TiltControl } = await import('@src/game/Tilt');
const { config } = await import('@src/config');
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
