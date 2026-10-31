#!/usr/bin/env node
// What is that straight line on screen? A long straight street seen from a camera on its axis projects onto one vertical
// line through the nadir: exactly where anything standing under the camera's plane would, a tower's vertical included. So
// at the pose below Market Street rises out of the Ferry Building's clock tower to the skyline and reads like a fin
// standing on it (outside judge, round 1: "a 2 px light fin on the world vertical above the tower"). This tool holds a pose
// and asks the game which it is:
//   - the G-buffer along the street's axis: what was drawn at each point's pixel (up-facing? which surface id?), by distance;
//   - the street's centerline drawn over the frame (OSM's, from the loaded tiles; none on an old bake);
//   - the lens moved sideways: what stands keeps its foot, what lies on the ground swings about the nadir;
//   - the buildings hidden: the plan of what lies between them.
//
//   node tools/sightline.mjs <url> <outDir> [--tag=NEXT] [--lat= --lon= --heading= --alt=] [--street='Market St'] [--axis=x0,z0,ux,uz] [--len=5200]
// Defaults: the pose of the judge's frame, Market St from its foot along its own line (a least-squares fit of OSM's centerline
// from the Ferry Building to Castro, bearing 225.1 degrees). Any build: on one without street lines only the overlay is empty.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const argv = process.argv.slice(2);
const pos = argv.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || '1']; }));
const [base, out] = pos;
const tag = opt.tag ?? 'NEXT';
const lat = +(opt.lat ?? 37.7992), lon = +(opt.lon ?? -122.389), heading = +(opt.heading ?? 235), alt = +(opt.alt ?? 250);
const street = opt.street ?? 'Market St';
const [x0, z0, ux, uz] = (opt.axis ?? '2238.3,-2253.9,-0.70885343,0.7053558').split(',').map(Number);
const len = +(opt.len ?? 5200);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions([]));
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const ev = (fn, arg) => page.evaluate(fn, arg);
const runFor = (s) => ev((sec) => new Promise((res) => { const g = window.__game; const t0 = g.clock(); const tick = () => (g.clock() - t0 >= sec ? res(null) : requestAnimationFrame(tick)); tick(); }), s);
const until = (cond, maxS) => ev(([c, m]) => new Promise((res) => { const g = window.__game; const f = new Function('g', 'return (' + c + ')'); const t0 = g.clock(); const tick = () => (g.clock() - t0 >= m || f(g) ? res(null) : requestAnimationFrame(tick)); tick(); }), [cond, maxS]);

await page.goto(`${base}?lat=${lat}&lon=${lon}&heading=${heading}&skipintro&nohud&fixeddt=0.0333`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
await ev(() => { window.__qa = null; window.__game.flight.glideSpeed = 6; });
await runFor(1);
await until('!g.city.busy', 40);
await ev(() => (window.__qa = { sx: 0, sy: -1 }));
await until(`g.flight.y + Math.max(0, g.flight.vy) / 1.7 >= ${alt} || g.flight.strain > 0.85`, 90);
await ev(() => (window.__qa = null));
await runFor(3);
await until('!g.city.busy', 30);
await runFor(0.5);
const t = await ev(() => window.__game.clock());
await ev((tt) => (window.__qa = { holdAt: tt + 0.05, held: false }), t);
await page.waitForFunction(() => window.__qa && window.__qa.held === true, null, { timeout: 60000, polling: 30 });
await page.screenshot({ path: `${out}/${tag}-base.png` });

// the G-buffer along the axis, the street's own centerline on the screen
const report = await ev(([x0, z0, ux, uz, len, street]) => {
  const g = window.__game, p = g.pipeline, r = p.renderer, gl = r.getContext(), rt = p.gbuf, sc = p.snapCam;
  const W = rt.width, H = rt.height;
  const prev = r.getRenderTarget();
  r.setRenderTarget(rt);
  const buf = new Uint16Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, buf);
  r.setRenderTarget(prev);
  const V3 = sc.position.constructor;
  const v = new V3(), n = new V3();
  // (sbWrite's bytes: ramp, light, fog, glow, octahedral view normal, surface id, flags)
  const decode = (ix, iy) => {
    const o = (iy * W + ix) * 4, t2 = buf[o + 2], t3 = buf[o + 3];
    const ex = ((t2 & 255) / 255) * 2 - 1, ey = ((t2 >> 8) / 255) * 2 - 1;
    let nx = ex, ny = ey, nz = 1 - Math.abs(ex) - Math.abs(ey);
    if (nz < 0) { const ox = nx; nx = (1 - Math.abs(ny)) * Math.sign(ox || 1); ny = (1 - Math.abs(ox)) * Math.sign(ny || 1); }
    n.set(nx, ny, nz).normalize().applyQuaternion(sc.quaternion);
    return { ramp: buf[o] & 255, id: t3 & 255, up: n.y };
  };
  const rows = [];
  for (let s = 0; s <= len; s += 10) {
    const x = x0 + ux * s, z = z0 + uz * s, y = g.city.groundAt(x, z);
    v.set(x, y, z).project(sc);
    if (v.z > 1) continue;
    const ix = Math.round((v.x * 0.5 + 0.5) * W - 0.5), iy = Math.round((v.y * 0.5 + 0.5) * H - 0.5);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
    const d = decode(ix, iy);
    // how wide the up-facing run through this pixel is on its row: the street as the frame shows it
    let a = ix, b = ix;
    while (a > 0 && decode(a - 1, iy).up > 0.9) a--;
    while (b < W - 1 && decode(b + 1, iy).up > 0.9) b++;
    rows.push({ s, ix, iy, id: d.id, up: +d.up.toFixed(2), run: b - a + 1, name: g.city.streetNameAt?.(x, z, 30) ?? null });
  }
  // the centerline in device pixels
  const dw = innerWidth * devicePixelRatio, dh = innerHeight * devicePixelRatio;
  const lines = [];
  for (const lt of g.city.tileNum?.values?.() ?? []) {
    const td = lt.terrainData;
    if (!td?.streets) continue;
    for (const ln of td.streets) {
      if (!(td.streetNames[ln.name] ?? '').startsWith(street)) continue;
      const pts = [];
      for (let k = 0; k + 1 < ln.xz.length; k += 2) {
        v.set(ln.xz[k], g.city.groundAt(ln.xz[k], ln.xz[k + 1]), ln.xz[k + 1]).project(sc);
        if (v.z < 1) pts.push([(v.x * 0.5 + 0.5) * dw, (-v.y * 0.5 + 0.5) * dh]);
      }
      if (pts.length > 1) lines.push(pts);
    }
  }
  // how far the lens stands off the axis
  const cx = sc.position.x - x0, cz = sc.position.z - z0;
  return { cam: sc.position.toArray().map((a) => +a.toFixed(1)), offAxis: +(cx * -uz + cz * ux).toFixed(1), rows, lines };
}, [x0, z0, ux, uz, len, street]);
writeFileSync(`${out}/${tag}-axis.json`, JSON.stringify(report));
console.log(`[${tag}] lens at ${report.cam}, ${Math.abs(report.offAxis)} m off the axis`);
for (let a = 0; a < len; a += 500) {
  const rs = report.rows.filter((r) => r.s >= a && r.s < a + 500);
  if (!rs.length) continue;
  const up = rs.filter((r) => r.up > 0.9).length;
  const ids = {};
  for (const r of rs) ids[r.id] = (ids[r.id] ?? 0) + 1;
  const names = rs.filter((r) => r.name === street).length;
  const run = [...rs].sort((p, q) => p.run - q.run)[rs.length >> 1].run;
  console.log(`[${tag}] ${String(a).padStart(4)}-${a + 500} m: ${up} of ${rs.length} points up-facing, ids ${JSON.stringify(ids)}, ${run} px wide, ${names} on ${street}`);
}

// the overlay: an SVG over the canvas, for one screenshot
await ev(([lines]) => {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'sb-sightline';
  svg.setAttribute('viewBox', `0 0 ${innerWidth * devicePixelRatio} ${innerHeight * devicePixelRatio}`);
  svg.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;pointer-events:none';
  for (const pts of lines) {
    const pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', '#ff00c8');
    pl.setAttribute('stroke-width', '2');
    svg.append(pl);
  }
  document.body.append(svg);
}, [report.lines]);
await page.screenshot({ path: `${out}/${tag}-centerline.png` });
await ev(() => document.getElementById('sb-sightline')?.remove());

// the buildings hidden
const buildings = await ev(() => {
  const ids = [];
  window.__game.scene.traverse((m) => {
    if (m.isMesh && m.userData?.sbKind !== 'caster' && m.geometry?.attributes?.aFacade) ids.push(m.uuid);
  });
  return ids;
});
const setVis = (ids, on) => ev(([ids, on]) => { const s = new Set(ids); window.__game.scene.traverse((m) => { if (s.has(m.uuid)) m.visible = on; }); window.__game.renderAgain(); }, [ids, on]);
await setVis(buildings, false);
await page.screenshot({ path: `${out}/${tag}-no-buildings.png` });
await setVis(buildings, true);

// the lens moved sideways
for (const dx of [-60, 60]) {
  await ev((dx) => {
    const g = window.__game, c = g.camera;
    window.__lens ??= c.position.clone();
    c.position.copy(window.__lens);
    c.translateX(dx);
    c.updateMatrixWorld();
    g.renderAgain();
  }, dx);
  await page.screenshot({ path: `${out}/${tag}-lens${dx > 0 ? '+' : ''}${dx}.png` });
}
await browser.close();
