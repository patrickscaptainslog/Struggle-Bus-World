import type * as THREE from 'three';
import { registerWarm } from '../render/warmup';
import { LifeHost, type LifeWorld } from './Life';
import type { LifeInit } from './lifeWorker';
import { MoverStore } from './paint';
import { Pools } from './pools';

// Life's boot (LIFE.md, CONTRACT.md section 6): under ?life only, and it never rejects into the street's boot: anything that fails gives null, and the street
// goes on as it would with no flag.

export interface LifeContext {
  params: URLSearchParams;
  scene: THREE.Scene;
  /** the place: a city's slug and its map's origin (degrees); its city.json, for its time zone and its road graphs, and where its files are (City.fileUrl, a name to a URL) */
  place: { slug: string; origin: [number, number]; city?: CityForLife; fileUrl?: (name: string) => string };
  /** the street's ground, for people (CONTRACT.md section 6's WorldForLife, its first queries) */
  world?: LifeWorld;
}

/** What life reads of city.json: its zone, and its road graphs' regions (CONTRACT.md section 1.2, `life.regions`, each rx, rz and its size) with the side of one. */
export interface CityForLife {
  tz?: unknown;
  regionSize?: number;
  tileSize?: number;
  life?: { regions?: unknown };
}

/** The road graphs as the worker asks for them (LifeInit's graphs), or none: the city has none listed. */
function roadsOf(city: CityForLife | undefined, fileUrl: ((name: string) => string) | undefined): LifeInit['graphs'] {
  const regions = city?.life?.regions;
  if (!fileUrl || !Array.isArray(regions) || !city?.regionSize || !city.tileSize) return undefined;
  const list = regions.filter((r): r is [number, number] => Array.isArray(r) && Number.isInteger(r[0]) && Number.isInteger(r[1])).map((r): [number, number] => [r[0], r[1]]);
  return list.length ? { url: new URL(fileUrl('g_RXRZ'), location.href).href, regions: list, regionM: city.regionSize * city.tileSize } : undefined;
}

export async function bootLife(ctx: LifeContext): Promise<LifeHost | null> {
  try {
    const pools = new Pools();
    registerWarm('life', () => pools.warmObjects());
    ctx.scene.add(pools.group);
    const worker = new Worker(new URL('./lifeWorker.ts', import.meta.url), { type: 'module' });
    // (live planes only on the real clock, and from a deployed page, where api/planes is: a pinned or stepped clock, a test, gets the scripted sky, the same every run)
    const p = ctx.params, real = !p.has('t') && !p.has('rate') && !p.has('fixeddt') && !p.has('norelay');
    const deployed = typeof location !== 'undefined' && !/^(localhost|127\.|\[::1\])/.test(location.hostname);
    const init: LifeInit = { type: 'init', slug: ctx.place.slug, origin: ctx.place.origin, relay: real && deployed ? new URL('api/planes', location.href).href : null,
      tz: typeof ctx.place.city?.tz === 'string' ? ctx.place.city.tz : undefined, graphs: roadsOf(ctx.place.city, ctx.place.fileUrl) };
    worker.postMessage(init);
    // (what's painted, kept by key: a test's clock has a store of its own, CONTRACT.md section 3)
    const store = new MoverStore(p.has('t') || p.has('rate') || p.has('fixeddt'));
    const host = new LifeHost(worker, pools, store, ctx.place.slug, ctx.place.origin, ctx.world ?? null);
    void store.load(Date.now()).then((r) => host.restore(r));
    return host;
  } catch (e) {
    console.warn('life', e);
    return null;
  }
}
