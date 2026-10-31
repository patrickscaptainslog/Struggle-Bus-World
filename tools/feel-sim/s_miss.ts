// A breath into the open bay: no fake hit (no hit-stop, no impact), a splash at impact time, a belly refund.
import { newCity, pump, ll, makeGame, MODE } from './lib';
const city = await newCity();
const out: string[] = [];
for (const [name, lat, lon, hdg] of [['bay-east', 37.7955, -122.3905, 60], ['bay-north', 37.8075, -122.4170, 0], ['ocean', 37.7600, -122.5100, 270]] as Array<[string, number, number, number]>) {
  const [x0, z0] = ll(lat, lon);
  await pump(city, x0, z0);
  const g = makeGame(city);
  const f = g.flight;
  f.x = x0; f.z = z0; f.heading = (hdg * Math.PI) / 180; f.y = city.groundAt(x0, z0) + 12;
  const dt = 1 / 60;
  for (let i = 0; i < 90; i++) g.frame(dt, { sx: 0, sy: 0, dragging: false });
  f.fullness = 1;
  for (let i = 0; i < 6; i++) g.frame(dt, { sx: 0, sy: 0, dragging: false });
  const t0 = g.t;
  const glint = g.glint();
  const r = g.tap();
  const e0 = g.events.length;
  let fullAfter = -1;
  for (let i = 0; i < 90; i++) { g.frame(dt, { sx: 0, sy: 0, dragging: false }); if (f.barfT < 0 && fullAfter < 0) fullAfter = f.fullness; }
  const ev = g.events.slice(e0 - 1).map((e) => `${e.ev}@${(e.t - t0).toFixed(3)}${e.ev === "impact" ? ` n=${e.count} gy=${city.groundAt((e.pos as any)[0], (e.pos as any)[2]).toFixed(2)} p=${(e.pos as any).map((v: number) => v.toFixed(0))}` : ""}`).join(" ");
  out.push(`${name}: glint ${glint ? glint.index : '-'} fired ${r.fired}; ${ev}; belly after the breath ${fullAfter.toFixed(2)}`);
}
console.log(`[${MODE}]\n` + out.join('\n'));
process.exit(0);
