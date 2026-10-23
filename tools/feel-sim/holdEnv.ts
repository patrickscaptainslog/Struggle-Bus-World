// DOM stubs for driving src/game/Input.ts headlessly (s_hold.ts): a fake element, window, document and a
// controllable performance.now().
export const clock = { now: 0 };
Object.defineProperty(performance, 'now', { value: () => clock.now, configurable: true });
type H = Record<string, Array<(e: any) => void>>;
const mk = () => {
  const h: H = {};
  return {
    h,
    addEventListener: (k: string, f: (e: any) => void) => ((h[k] ??= []).push(f)),
    removeEventListener: () => {},
    fire: (k: string, e: any) => (h[k] ?? []).forEach((f) => f(e)),
  };
};
export const win = mk();
export const doc = mk();
const g = globalThis as any;
g.window = { ...win, setTimeout: (f: () => void) => (setTimeout(f, 0) as unknown as number), clearTimeout: () => {} };
g.document = { ...doc, hidden: false, body: {}, documentElement: {} };
g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 };
export const el = { ...mk(), style: {} as Record<string, string>, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture: () => {} };
