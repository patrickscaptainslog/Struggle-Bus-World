// A tiny fake DOM for driving the real Input offline: listeners on an element / window / document, a
// controllable clock (performance.now, event timeStamps and timers), localStorage.
type L = (e: any) => void;
export class Target {
  private ls = new Map<string, L[]>();
  style: Record<string, string> = {};
  addEventListener(t: string, f: L) {
    (this.ls.get(t) ?? this.ls.set(t, []).get(t)!).push(f);
  }
  removeEventListener(t: string, f: L) {
    const a = this.ls.get(t);
    if (a) this.ls.set(t, a.filter((x) => x !== f));
  }
  dispatch(t: string, e: any) {
    for (const f of this.ls.get(t) ?? []) f(e);
  }
  has(t: string) {
    return (this.ls.get(t) ?? []).length > 0;
  }
  setPointerCapture() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 393, height: 852 };
  }
}
export const clock = { ms: 1000 };
/** window.setTimeout on the fake clock: runTimers() fires what is due. */
const timers = new Map<number, { at: number; f: () => void }>();
let timerId = 1;
export function runTimers() {
  for (const [id, t] of timers)
    if (t.at <= clock.ms) {
      timers.delete(id);
      t.f();
    }
}
export function installDom() {
  const g = globalThis as any;
  const win = new Target() as any;
  const doc = new Target() as any;
  doc.hidden = false;
  doc.body = {};
  doc.documentElement = {};
  win.setTimeout = (f: () => void, ms: number) => {
    timers.set(timerId, { at: clock.ms + ms, f });
    return timerId++;
  };
  win.clearTimeout = (id: number) => void timers.delete(id);
  g.window = win;
  g.document = doc;
  Object.defineProperty(globalThis.performance, 'now', { value: () => clock.ms, configurable: true, writable: true });
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.location = { search: '', href: 'http://local/' };
  return { win, doc };
}
let pid = 1;
export function ptr(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', id: number, x: number, y: number, primary = true, extra: { pointerType?: string; button?: number } = {}) {
  return { type, pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: x, clientY: y, button: 0, timeStamp: clock.ms, cancelable: true, preventDefault() {}, ...extra };
}
export const newId = () => pid++;
export function key(code: string, repeat = false) {
  return { code, repeat, metaKey: false, ctrlKey: false, altKey: false, target: (globalThis as any).document.body, timeStamp: clock.ms, preventDefault() {} };
}
