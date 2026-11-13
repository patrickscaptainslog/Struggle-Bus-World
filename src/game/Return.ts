// Where you last painted, kept (docs/specs/core/CORE.md, stage 1): a return visit starts over your own paint, not at the Golden Gate again.
// The record is localStorage's strugglebus.last.v1:<slug> (the city's folder, as the paint stores are keyed), a JSON array of eight numbers:
//   [busLat, busLon, busY, headingDeg, pLat, pLon, id, unixSeconds]
// the bus's own pose when it breathed the last shot that bloomed a building (that spot was flown, and the paint was ahead of it), P the blast's centre,
// id the stableId of the building it bloomed first, and the time. Lat/lon, not map metres, so a re-bake that moves the map's frame keeps it.
// It is never stored ahead of the paint it points at: a noted record waits, and goes out after a save of the paint that went through (PaintState.afterSave).
// Its own write is in a try, as the paint's: storage that throws or is full keeps nothing, and the game goes on.
// readReturn is the rule a load reads it by: the pose to start from, or null and why (the first visit's Golden Gate then).
import { latLonToLocal, localToLatLon } from './geo';
import { registerTunables } from '../ui/tunables';

/** the opening was seen through on this device ('1'): a repeat visit's tap skips it, and only then is there a return start */
export const OPENING_SEEN_KEY = 'strugglebus.opening.v1';
export const returnKey = (slug: string): string => `strugglebus.last.v1:${slug}`;

export const returnTune = {
  /** m back from P along a heading, for a start when the bus's own pose was far from it */
  back: 220,
  /** the bus's own pose is the start when it was within this many m of P */
  near: 400,
  /** and P at least this many m ahead of it along its heading: nearer, P is under the bus in the chase lens (155 m back, 24-29 degrees up), most of all
   *  once the hold lifts it over the towers, and the start is `back` m before P instead. 100 m frames P in 25-65 % of the height with up to 57 m of drop
   *  from the bus to the paint (an ESTIMATE from the lens's numbers; the return visit's checks measure it) */
  ahead: 100,
  /** a start stays this many m inside the map's bounds */
  inset: 400,
  /** and this many m from every bridge's line (a landmark with points): an ESTIMATE */
  bridgeClear: 250,
};
registerTunables('Return', returnTune, { back: [50, 600, 10], near: [50, 1500, 10], ahead: [0, 400, 10], inset: [0, 1000, 10], bridgeClear: [0, 800, 10] });

/** links that start where they say, or aren't the saved city: none gets a return start, and recess and swerve (their own boots) write none either */
const NO_START = ['lat', 'lon', 'heading', 'skipintro', 'openingshot', 'noreturn', 'recess', 'swerve'];
/** paint on these links isn't the saved city's (CORE 3.10: rivals' paint isn't the player's) */
const NO_NOTE = ['recess', 'swerve'];

export interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const local = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

let pending: { key: string; json: string } | null = null;

/** Paint on this link is the saved city's: the record may be noted (main.ts checks the rest: a building, not the Moon, the store saves, no staged paint) */
export function notesReturn(params: URLSearchParams): boolean {
  return !NO_NOTE.some((k) => params.has(k));
}

/** A shot that bloomed building `id` at P (map metres), breathed from the bus at `pose`: the record waits for the paint's next save that goes through. */
export function noteReturn(slug: string, origin: readonly number[], pose: Pose, p: { x: number; z: number }, id: number, now = Date.now()) {
  const [bLat, bLon] = localToLatLon(pose.x, pose.z, origin);
  const [pLat, pLon] = localToLatLon(p.x, p.z, origin);
  const deg = (((Math.round((pose.heading * 180) / Math.PI) % 360) + 360) % 360);
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  pending = { key: returnKey(slug), json: JSON.stringify([r6(bLat), r6(bLon), Math.round(pose.y * 10) / 10, deg, r6(pLat), r6(pLon), id, Math.round(now / 1000)]) };
}

/** After a save of the paint that went through: the noted record goes out. True when it was written (false: none waiting, or storage refused it, and it waits for the next). */
export function flushReturn(store: Store | null = local()): boolean {
  if (!pending || !store) return false;
  try {
    store.setItem(pending.key, pending.json);
  } catch {
    /* storage full or blocked: the record waits for the next save */
    return false;
  }
  pending = null;
  return true;
}

/** The tuner's reset: the record, and any waiting, gone */
export function clearReturn(slug: string, store: Store | null = local()) {
  pending = null;
  try {
    store?.removeItem(returnKey(slug));
  } catch {
    /* private mode */
  }
}

/** QA and the checks: the record waiting for a save, as it would be stored */
export const pendingReturn = (): string | null => pending?.json ?? null;

export interface ReturnInput {
  slug: string;
  params: URLSearchParams;
  /** the page boots somewhere else of its own: the Moon, ?resume, ?earth, the Lift's placed start */
  elsewhere: boolean;
  manifest: { origin: readonly number[]; bounds: readonly number[]; landmarks: ReadonlyArray<{ points?: ReadonlyArray<readonly number[]> }> };
  paint: { readonly saves: boolean; hasSaved(id: number | string): boolean };
  store?: Pick<Storage, 'getItem'> | null;
}
export type ReturnWhich = 'bus' | 'back' | 'back+180' | 'back+90' | 'back-90';
export type ReturnStart = { pose: Pose; which: ReturnWhich; p: { x: number; z: number }; id: number } | { pose: null; why: string };

/** distance (m) from (x, z) to the segment a-b */
function toSegment(x: number, z: number, a: readonly number[], b: readonly number[]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

/**
 * Where a return visit starts: the bus's own pose at its last shot, when that was within `near` of P and P `ahead` m or more in front of it (a tap from
 * the roofs lands nearer: P would be under the bus on screen); else `back` m before P along the shot's heading,
 * then along it +180, +90 and -90 degrees (facing P each time). A start must lie `inset` inside the map's bounds and `bridgeClear` from every bridge's
 * line (each landmark with points, as the Golden Gate's: data-driven, any city's bridges). The first that passes wins; none, and it's null.
 */
export function readReturn(o: ReturnInput): ReturnStart {
  const none = (why: string): ReturnStart => ({ pose: null, why });
  if (o.elsewhere) return none('elsewhere');
  const flag = NO_START.find((k) => o.params.has(k));
  if (flag) return none(flag);
  let raw: string | null, seen: string | null;
  try {
    const s = o.store === undefined ? local() : o.store;
    seen = s ? s.getItem(OPENING_SEEN_KEY) : null;
    raw = s ? s.getItem(returnKey(o.slug)) : null;
  } catch {
    return none('storage');
  }
  if (seen !== '1') return none('first visit');
  if (!o.paint.saves) return none('no saves');
  if (raw === null) return none('no record');
  let r: unknown;
  try {
    r = JSON.parse(raw);
  } catch {
    return none('bad record');
  }
  if (!Array.isArray(r) || r.length !== 8 || !r.every((v) => typeof v === 'number' && isFinite(v))) return none('bad record');
  const [bLat, bLon, bY, deg, pLat, pLon, id] = r as number[];
  if (!o.paint.hasSaved(id)) return none('paint not saved');
  const { origin, bounds } = o.manifest;
  const [px, pz] = latLonToLocal(pLat, pLon, origin);
  if (!(px > bounds[0] && px < bounds[2] && pz > bounds[1] && pz < bounds[3])) return none('outside');
  const [bx, bz] = latLonToLocal(bLat, bLon, origin);
  const h = (deg * Math.PI) / 180;
  const T = returnTune;
  const bridges = o.manifest.landmarks.filter((l) => l.points && l.points.length >= 2).map((l) => l.points!);
  const fits = (x: number, z: number): string | null => {
    if (!(x > bounds[0] + T.inset && x < bounds[2] - T.inset && z > bounds[1] + T.inset && z < bounds[3] - T.inset)) return 'inset';
    for (const pts of bridges) for (let i = 1; i < pts.length; i++) if (toSegment(x, z, pts[i - 1], pts[i]) <= T.bridgeClear) return 'bridge';
    return null;
  };
  const tries: Array<[ReturnWhich, Pose]> = [];
  const along = (px - bx) * Math.sin(h) - (pz - bz) * Math.cos(h);
  if (Math.hypot(bx - px, bz - pz) <= T.near && along >= T.ahead) tries.push(['bus', { x: bx, y: bY, z: bz, heading: h }]);
  for (const [which, turn] of [['back', 0], ['back+180', Math.PI], ['back+90', Math.PI / 2], ['back-90', -Math.PI / 2]] as const) {
    const a = h + turn;
    tries.push([which, { x: px - Math.sin(a) * T.back, y: bY, z: pz + Math.cos(a) * T.back, heading: a }]);
  }
  // (why the last one failed, when none passes: "bridge" when a bridge took any)
  let why = 'inset';
  for (const [which, pose] of tries) {
    const no = fits(pose.x, pose.z);
    if (!no) return { pose, which, p: { x: px, z: pz }, id };
    if (no === 'bridge') why = 'bridge';
  }
  return none(why);
}
