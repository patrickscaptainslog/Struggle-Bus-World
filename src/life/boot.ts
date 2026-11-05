import type * as THREE from 'three';
import { registerWarm } from '../render/warmup';
import { LifeHost } from './Life';
import type { LifeInit } from './lifeWorker';
import { MoverStore } from './paint';
import { Pools } from './pools';

// Life's boot (LIFE.md, CONTRACT.md section 6): under ?life only, and it never rejects into the street's boot: anything that fails gives null, and the street
// goes on as it would with no flag.

export interface LifeContext {
  params: URLSearchParams;
  scene: THREE.Scene;
  /** the place: a city's slug and its map's origin (degrees) */
  place: { slug: string; origin: [number, number] };
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
    const init: LifeInit = { type: 'init', slug: ctx.place.slug, origin: ctx.place.origin, relay: real && deployed ? new URL('api/planes', location.href).href : null };
    worker.postMessage(init);
    // (what's painted, kept by key: a test's clock has a store of its own, CONTRACT.md section 3)
    const store = new MoverStore(p.has('t') || p.has('rate') || p.has('fixeddt'));
    const host = new LifeHost(worker, pools, store, ctx.place.slug, ctx.place.origin);
    void store.load(Date.now()).then((r) => host.restore(r));
    return host;
  } catch (e) {
    console.warn('life', e);
    return null;
  }
}
