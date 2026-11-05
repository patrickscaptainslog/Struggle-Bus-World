// Where m5's rule reaches (Splatter.barf, City.lmOverhead; docs/reviews/main-live-2026-11-05.md, m5): along each bridge, under its deck and 35 m either side, for
// a bus 10, 20, 30 and 60 m over the ground or the water there, is the bridge in the blast's flat reach, and does the rule take it out because it stands wholly
// over the bus there? Both bridges built as main.ts builds them, every 5 m of the deck's line (stations from its first point, right and left looking along it from
// there). A map, not a pass or a fail: the producer's to judge on the phone.
//   node tools/feel-sim/run.mjs s_reach.ts
import { newCity, manifest, config } from './lib';
import { makeGoldenGate, makeBayBridgeWest, bridgeObstacles, paintBridge } from '@src/world/Bridges';
import { blastRadiusFor } from '@src/game/blastLayout';

const city = await newCity();
const S = config.splat;
type Lm = { kind: string; points: Array<[number, number]>; deck: number[][]; supports: number[][] };
const near: Array<{ ref: unknown; d: number }> = [];
for (const kind of ['ggb', 'baybridge']) {
  const lm = manifest.landmarks.find((l: Lm) => l.kind === kind) as Lm;
  const obj = kind === 'ggb' ? makeGoldenGate(lm.points, lm.deck as never, lm.supports as never) : makeBayBridgeWest(lm.points, lm.deck as never, lm.supports as never);
  city.addObstacles(bridgeObstacles(kind as 'ggb', lm.points, lm.deck as never, lm.supports as never));
  const ref = paintBridge(city, `lm:${kind}`, obj, kind)!;
  // the deck's line by station (m from its first point), and a point beside it
  const d = lm.deck, s = [0];
  for (let i = 1; i < d.length; i++) s.push(s[i - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]));
  const L = s[s.length - 1];
  const at = (st: number) => {
    let i = 0;
    while (i + 2 < d.length && st > s[i + 1]) i++;
    const k = (st - s[i]) / (s[i + 1] - s[i]), dx = d[i + 1][0] - d[i][0], dz = d[i + 1][1] - d[i][1], n = Math.hypot(dx, dz);
    return { x: d[i][0] + dx * k, z: d[i][1] + dz * k, top: d[i][2] + (d[i + 1][2] - d[i][2]) * k, nx: -dz / n, nz: dx / n };
  };
  console.log(`${kind}: the deck's line ${L.toFixed(0)} m`);
  for (const lat of [0, 35, -35])
    for (const h of [10, 20, 30, 60]) {
      let flat = 0, out = 0, over = 0;
      const kept: string[] = [];
      let k0 = -1;
      for (let st = 0; st <= L + 2.5; st += 5) {
        const p = at(Math.min(st, L)), x = p.x + p.nx * lat, z = p.z + p.nz * lat, g = city.groundAt(x, z), from = g + h;
        let inReach = false;
        if (from >= p.top - 1) over += 5;
        else {
          const r = blastRadiusFor(from - g);
          near.length = 0;
          const hit = city.buildingsWithin(x, z, r + S.smallRad, near as never).find((nn: { ref: unknown }) => nn.ref === ref) as { d: number } | undefined;
          if (hit && hit.d <= r) {
            flat += 5;
            if (city.lmOverhead(ref, x, z, from)) out += 5;
            else inReach = true;
          }
        }
        if (inReach && k0 < 0) k0 = st;
        if (!inReach && k0 >= 0) {
          kept.push(st - 5 > k0 ? `${k0}-${st - 5}` : `${k0}`);
          k0 = -1;
        }
      }
      if (k0 >= 0) kept.push(`${k0}-${Math.floor(L / 5) * 5}`);
      console.log(`  ${lat ? `${Math.abs(lat)} m ${lat > 0 ? 'right' : 'left'} of` : 'under'} the deck, the bus ${h} m up: ${flat} m of the line in the flat reach, ${out} m of it taken out${over ? `, ${over} m with the bus at or over the deck` : ''}; kept in at ${kept.join(', ') || 'none'}`);
    }
}
process.exit(0);
