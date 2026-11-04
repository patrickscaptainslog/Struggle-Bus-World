// The trip and its view as JSON, for the page change in the long dark (docs/specs/earth/EARTHFLIGHT.md, E3): every number, boolean, string and vector an object holds, by its own keys, so a field added later is
// carried without anyone remembering to add it here. What isn't state is left out by type: the sky models (a function of the clock), three's scratch matrices and angles. JSON has no Infinity or NaN, so those go as strings.
// Pure TS, no three.js: MoonTrip.ts flies under Node. TripView's vectors and quaternions are read by their toArray and fromArray, which both have.

type Arrayish = { toArray(): number[]; fromArray(a: number[]): unknown };
export type Saved = Record<string, unknown>;

const num = (x: number): number | string => (Number.isFinite(x) ? x : String(x));
const back = (x: unknown): unknown => (typeof x === 'string' && (x === 'Infinity' || x === '-Infinity' || x === 'NaN') ? Number(x) : x);

const isVec = (v: unknown): v is Arrayish => !!v && typeof (v as Arrayish).toArray === 'function' && typeof (v as Arrayish).fromArray === 'function' && ((v as { isVector3?: boolean }).isVector3 || (v as { isQuaternion?: boolean }).isQuaternion || false);

/** One value as JSON, or undefined if it isn't state. Plain objects and arrays go one level down, as the trip's Observer and log are. */
function out(v: unknown, deep: boolean): unknown {
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  if (v instanceof Float64Array) return Array.from(v, num);
  if (isVec(v)) return v.toArray().map(num);
  if (!deep || !v || typeof v !== 'object') return undefined;
  if (Array.isArray(v)) return v.map((x) => out(x, true));
  if (Object.getPrototypeOf(v) !== Object.prototype) return undefined;
  const o: Saved = {};
  for (const [k, x] of Object.entries(v)) {
    const s = out(x, false);
    if (s !== undefined) o[k] = s;
  }
  return o;
}

/** Every field of `obj` that's state. */
export function saveFields(obj: object, skip: readonly string[] = []): Saved {
  const o: Saved = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skip.includes(k) || typeof v === 'function') continue;
    const s = out(v, true);
    if (s !== undefined) o[k] = s;
  }
  return o;
}

/** Back into the same fields, in place: vectors and typed arrays are written into, never replaced, as a readonly one is held by others. */
function into(target: Record<string, unknown>, k: string, s: unknown): void {
  const cur = target[k];
  if (cur instanceof Float64Array && Array.isArray(s)) cur.set(s.map(back) as number[]);
  else if (isVec(cur) && Array.isArray(s)) cur.fromArray(s.map(back) as number[]);
  else if (Array.isArray(cur) && Array.isArray(s)) {
    cur.length = 0;
    for (const x of s) cur.push(x && typeof x === 'object' ? { ...(x as object) } : back(x));
  } else if (cur && typeof cur === 'object' && Object.getPrototypeOf(cur) === Object.prototype && s && typeof s === 'object') {
    for (const [j, x] of Object.entries(s as Saved)) into(cur as Record<string, unknown>, j, x);
  } else if (typeof cur === typeof back(s) || cur === undefined) target[k] = back(s);
}

export function resumeFields(obj: object, saved: Saved): void {
  for (const [k, s] of Object.entries(saved)) into(obj as Record<string, unknown>, k, s);
}
