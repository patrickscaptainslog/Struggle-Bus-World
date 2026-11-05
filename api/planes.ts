import { box, slim } from '../src/life/relay';

// The planes' relay (LIFE.md, "Planes"): GET /api/planes?lat=&lon=&r= (r in nautical miles) gives the aircraft adsb.lol hears in that box, as src/life/relay.ts
// reads them, cached at the edge for 10 s, so a thousand players over one city make one request upstream. adsb.lol takes no key today; its terms are asked
// before launch, and the game credits it (LIVING.md). If it fails, the answer is no planes, and the game's scripted sky takes over, saying nothing.

export const config = { runtime: 'edge' };

const json = (body: unknown, status: number, maxAge: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': maxAge ? `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}` : 'no-store', 'access-control-allow-origin': '*' },
  });

export default async function handler(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams, b = box(Number(q.get('lat')), Number(q.get('lon')), Number(q.get('r')));
  if (!b) return json({ error: 'lat and lon' }, 400, 0);
  try {
    const res = await fetch(`https://api.adsb.lol/v2/point/${b.lat}/${b.lon}/${b.r}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return json({ now: Date.now(), ac: [] }, 200, 5);
    const j = (await res.json()) as { now?: number; ac?: Array<Record<string, unknown>> };
    const ac = [];
    for (const a of j.ac ?? []) {
      const p = slim(a);
      if (p) ac.push(p);
    }
    return json({ now: typeof j.now === 'number' ? j.now : Date.now(), ac }, 200, 10);
  } catch {
    return json({ now: Date.now(), ac: [] }, 200, 5);
  }
}
