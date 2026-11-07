#!/usr/bin/env node
// The rooftop gardens' triangle budget, measured in the real game on this machine's GPU (docs/specs/gardens/BUDGET.md).
//   node tools/gardens/budget.mjs <baseUrl> <outDir> [--n=1200] [--line=450000] [--minhold=0.9] [--views=street,250,1000] [--time=20] [--q=&lift]
// Paints the n buildings nearest Alamo Square to level 3 and saves it (the game's own store), reloads, so every garden comes back the way a
// player's does, through the tiles' restore, and then holds the bus at three heights over the square's west side, heading east over it:
// the street (the bus as it starts), 250 m and 1 km over the ground. Each view: the frame's draws and triangles with the gardens and without
// them (the RoofSprouts group hidden: the difference is the gardens' own, every pass), the gardens' own census by element type, the frame's
// GPU time (renders back to back, synced by a readback) with and without them, the budget's hold on the reaches, and a still. Then a flight
// audited every frame, the hold let out again at the street after it, and the lens snapped round at the street. Exit 1 when a view's garden
// triangles pass --line, when the hold in a view is under --minhold (the line met only by pulling the reaches in), when the flight or a snap
// finds a pop, when the hold doesn't let out again after the flight, or on a page error.
// --bomb: the url gets &bomb, so every garden carries its building's index and rides the pogo (src/world/pogo.ts). The n are painted as before but those
// in a Bomb III's circle from 250 m over the square's middle at level 1, and before the views that Bomb lands there (Splatter.barf as the Bomb's: 1.8 x
// blastRadiusFor(250), jump 3), its stages raising them to 3 and their gardens growing in while their houses hop: every frame's draws and triangles from
// its impact to 4 s on, held under 200 and 1.5 M (exit 1 past either), its gardens' own at the end. Then the views as before, all n at level 3.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const base = pos[0] ?? 'http://localhost:4179/';
const out = pos[1] ?? 'shots/tmp/gardens';
const N = Number(opt.n ?? 1200);
const LINE = Number(opt.line ?? 450000);
const VIEWS = (opt.views ?? 'street,250,1000').split(',');
const TIMES = Number(opt.time ?? 20);
const MINHOLD = Number(opt.minhold ?? 0.9);
mkdirSync(out, { recursive: true });

// (the west side of Alamo Square, heading east over it: tools/shots.mjs's grey and high poses start here)
const Q = '?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud&sky=off&fixeddt=0.0333333' + (opt.q ?? '') + (opt.bomb ? '&bomb' : '');
// (the square's middle, from that pose: 48 m east, 13 m north)
const CX = 48, CZ = -13;
// where the bus is held for each view: how far back (m, west) of the square's middle, and how high over the ground. The chase lens looks
// ahead and down: from the street it sits over the square's middle
const POSE = { street: { back: -150, h: 33 }, 250: { back: 380, h: 250 }, 1000: { back: 1150, h: 1000 } };

const browser = await chromium.launch(browserOptions([]));
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));

const ready = async () => {
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 240000, polling: 200 });
  await settle();
};
const settle = () =>
  page.evaluate(
    () =>
      new Promise((res, rej) => {
        const g = window.__game, t0 = performance.now();
        let quiet = 0;
        const tick = () => {
          quiet = !g.city.busy && g.city.ground.queued === 0 ? quiet + 1 : 0;
          if (quiet >= 30) res(null);
          else if (performance.now() - t0 > 200000) rej(new Error('the city never settled'));
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
/** n frames */
const frames = (n) => page.evaluate((k) => new Promise((res) => requestAnimationFrame(function f() { if (--k > 0) requestAnimationFrame(f); else res(null); })), n);

const report = { base, n: N, line: LINE, views: {}, errors };
const t0 = Date.now();
await page.goto(base + Q, { waitUntil: 'load' });
await ready();
report.gpu = await page.evaluate(() => {
  const gl = window.__game.pipeline.renderer.getContext();
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
// paint the n nearest to level 3, in the store (as a long session leaves it)
report.painted = await page.evaluate(
  ({ n, cx, cz, bomb }) => {
    const g = window.__game, c = g.city, x = g.flight.x + cx, z = g.flight.z + cz;
    const near = c.buildingsNear(x, z, 1500, []).sort((a, b) => a.d - b.d);
    const pick = near.slice(0, n);
    // (--bomb: those its circle reaches at level 1, for it to raise)
    const S = g.config.splat, rb = bomb ? S.blastRadius * (1 + ((S.dropGain300 - 1) * 250) / 300) * g.config.bomb.radius3 : 0;
    pick.forEach((b, i) => c.paint.set(b.ref.index, { faction: 1, color: i % 6, level: b.d < rb - 10 ? 1 : 3, bloomTime: -100 }));
    c.paint.persist();
    return { asked: n, painted: pick.length, inReach: near.length, radius: Math.round(pick.length ? pick[pick.length - 1].d : 0), x, z };
  },
  { n: N, cx: CX, cz: CZ, bomb: !!opt.bomb },
);
console.log('painted', JSON.stringify(report.painted));
await page.reload({ waitUntil: 'load' });
await ready();
await page.evaluate((p) => (window.__sbStart = { x: p.x, z: p.z }), report.painted);
// (programs: the warm-up made them all, so the gardens' restore and every view after compile none)
report.programs = await page.evaluate(() => ({ warm: window.__game.warm?.report?.programs ?? null, ready: window.__game.pipeline.renderer.info.programs.length }));
// --budget=<triangles>: the gardens' own budget for this run (a build that has one: 1e9 draws exactly what's seen, the reaches never held)
if (opt.budget) report.budget = await page.evaluate((t) => (window.__game.sprouts?.budget ? (window.__game.sprouts.budget.tris = t) : null), Number(opt.budget));

// --bomb: a Bomb III lands on the square's middle from 250 m over it, the frames held to their budget through its stages and the pogo
if (opt.bomb) {
  await page.evaluate(({ p }) => {
    const g = window.__game, f = g.flight, { x, z } = window.__sbStart;
    window.__qa = { pin: { x: x - p.back, y: g.city.groundAt(x - p.back, z) + p.h, z, heading: f.heading } };
  }, { p: POSE[250] });
  await frames(150);
  await settle();
  report.bomb = await page.evaluate(
    () =>
      new Promise((res) => {
        const g = window.__game, c = g.city, p = g.perf, S = g.config.splat, B = g.config.bomb, { x, z } = window.__sbStart;
        const r = S.blastRadius * (1 + ((S.dropGain300 - 1) * 250) / 300) * B.radius3, d0 = c.paint.data.slice(), orig = p.frame.bind(p), tr = [];
        p.frame = (dt, work) => {
          orig(dt, work);
          tr.push([p.calls, p.tris]);
        };
        g.splatter.barf(x, z, { drop: 250, radius: r, super: { kind: 'bomb', charge: 1, id: 1 }, hitStop: 0, jump: B.jump3 });
        const t0 = g.clock();
        const tick = () => {
          if (g.clock() - t0 < 5) return requestAnimationFrame(tick);
          p.frame = orig;
          const d = c.paint.data;
          let raised = 0, wrong = 0;
          for (let i = 1; i < d.length; i += 4) if (d[i] !== d0[i]) (raised++, d[i] !== Math.min(3, d0[i] + B.jump3) && wrong++);
          let gt = 0;
          g.scene.getObjectByName('RoofSprouts').traverse((m) => m.isInstancedMesh && m.visible && m.count && (m.layers.mask & 1) && (gt += ((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3) * m.count));
          res({ r: Math.round(r), raised, wrong, frames: tr.length, draws: Math.max(...tr.map((t) => t[0])), tris: Math.max(...tr.map((t) => t[1])), gardenTris: Math.round(gt) });
        };
        tick();
      }),
  );
  console.log(`bomb: a Bomb III of ${report.bomb.r} m raised ${report.bomb.raised} (${report.bomb.wrong} not to min(3, before + 3)); ${report.bomb.frames} frames, at most ${report.bomb.draws} draws and ${(report.bomb.tris / 1e6).toFixed(3)} M triangles; gardens ${report.bomb.gardenTris} after`);
}
for (const view of VIEWS) {
  const p = POSE[view];
  await page.evaluate(
    ({ p, cx, cz }) => {
      const g = window.__game, f = g.flight;
      g.controls.frozen = false;
      const { x, z } = window.__sbStart;
      const px = x - p.back, pz = z;
      window.__qa = { pin: { x: px, y: g.city.groundAt(px, pz) + p.h, z: pz, heading: f.heading } };
    },
    { p },
  );
  // (the chase lens and the vista lens come over to the held pose, and the city streams for that height)
  await frames(150);
  await settle();
  await frames(30);
  await page.evaluate(() => (window.__game.controls.frozen = true));
  await frames(4);
  const r = await page.evaluate((times) => {
    const g = window.__game, rd = g.pipeline.renderer, gl = rd.getContext(), sp = g.scene.getObjectByName('RoofSprouts');
    const px = new Uint8Array(4);
    const one = () => {
      rd.info.reset();
      g.renderAgain();
      return { draws: rd.info.render.calls, tris: rd.info.render.triangles };
    };
    const time = () => {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const ms = [];
      for (let i = 0; i < times; i++) {
        const a = performance.now();
        g.renderAgain();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        ms.push(performance.now() - a);
      }
      ms.sort((a, b) => a - b);
      return +ms[Math.floor(ms.length / 2)].toFixed(1);
    };
    // the gardens' own: what each element type draws (instances live, triangles each), main pass and sun pass
    const census = { meshes: 0, instances: 0, tris: 0, sunTris: 0, byGeo: {} };
    sp.traverse((m) => {
      if (!m.isInstancedMesh || !m.visible || !m.count) return;
      const per = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      const sun = (m.layers.mask & 1) === 0;
      census.meshes++;
      if (sun) census.sunTris += per * m.count;
      else {
        census.instances += m.count;
        census.tris += per * m.count;
        const k = `${per}`;
        census.byGeo[k] = (census.byGeo[k] ?? 0) + m.count;
      }
    });
    const f = g.flight, cam = g.camera.position;
    const all = one(), msAll = time();
    sp.visible = false;
    const none = one(), msNone = time();
    sp.visible = true;
    one();
    return { bus: [f.x, f.y, f.z].map(Math.round), above: Math.round(f.y - g.city.groundAt(f.x, f.z)), cam: [cam.x, cam.y, cam.z].map(Math.round), all, none, gardens: { draws: all.draws - none.draws, tris: all.tris - none.tris }, ms: { all: msAll, none: msNone }, census, recs: g.sprouts ? g.sprouts.size : null, lod: g.sprouts && g.sprouts.stats ? g.sprouts.stats() : null };
  }, TIMES);
  if ('dump' in opt)
    r.dump = await page.evaluate((first) => {
      const g = window.__game, cam = g.camera, sp = g.scene.getObjectByName('RoofSprouts'), sun = g.pipeline.sunCam;
      const d = { cam: { pos: cam.position.toArray(), view: cam.matrixWorldInverse.toArray(), proj: cam.projectionMatrix.toArray(), fov: cam.fov, aspect: cam.aspect }, sun: { view: sun.matrixWorldInverse.toArray(), proj: sun.projectionMatrix.toArray() } };
      if (first) {
        d.inst = [];
        sp.traverse((m) => {
          if (!m.isInstancedMesh || !m.visible || !m.count || (m.layers.mask & 1) === 0) return;
          const a = m.instanceMatrix.array, c = m.instanceColor.array, key = `${m.geometry.index ? m.geometry.index.count / 3 : 0}/${m.geometry.attributes.position.count}`;
          for (let i = 0; i < m.count; i++) if (c[i * 3 + 2] < 1e8) d.inst.push([key, a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14], Math.hypot(a[i * 16 + 4], a[i * 16 + 5], a[i * 16 + 6])]);
        });
      }
      return d;
    }, view === VIEWS[0]);
  // the still: the loop held (its frames stop, the canvas keeps what's drawn), every build's clock at one moment, so the sway is the same
  await page.evaluate(async () => {
    const g = window.__game, sp = g.scene.getObjectByName('RoofSprouts');
    window.__qa.holdAt = g.clock();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t = sp.children.find((m) => m.material?.uniforms?.uTime)?.material.uniforms.uTime;
    if (t) t.value = 400;
    g.renderAgain();
  });
  await page.screenshot({ path: `${out}/${view}.png` });
  await page.evaluate(() => {
    delete window.__qa.holdAt;
    window.__qa.held = false;
  });
  report.views[view] = r;
  console.log(`${view}: bus ${r.above} m up; frame ${r.all.draws} draws ${(r.all.tris / 1e6).toFixed(3)} M tris, ${r.ms.all} ms; without gardens ${r.none.draws} draws ${(r.none.tris / 1e6).toFixed(3)} M, ${r.ms.none} ms; gardens ${r.gardens.draws} draws ${(r.gardens.tris / 1e6).toFixed(3)} M (main ${(r.census.tris / 1e6).toFixed(3)} M in ${r.census.instances} instances, sun ${(r.census.sunTris / 1e6).toFixed(3)} M); hold ${r.lod ? r.lod.hold.toFixed(3) : 'none'}`);
}
// a flight through it (--flight=0 skips): from the street pose a hard turn, a climbing turn the other way, a dive, a turn. Every frame the
// gardens are audited against that frame's lens (RoofSprouts.audit): an element that should stand whole and isn't drawn, a far form drawn
// where its small growth should still show, a caster in view whose shadow is left out. Any of them is a pop: exit 1.
if (opt.flight !== '0')
  report.flight = await page.evaluate(async (p) => {
    const g = window.__game, f = g.flight, sp = g.sprouts;
    if (!sp?.audit) return null;
    const { x, z } = window.__sbStart;
    window.__qa = { pin: { x: x - p.back, y: g.city.groundAt(x - p.back, z) + p.h, z, heading: f.heading } };
    g.controls.frozen = false;
    await new Promise((r) => { let n = 60; requestAnimationFrame(function k() { if (--n > 0) requestAnimationFrame(k); else r(); }); });
    const legs = [[1, 0, 120], [-1, -1, 120], [0, 1, 150], [1, 0, 90]];
    const o = { frames: 0, missing: 0, early: 0, shadow: 0, checked: 0, lifted: 0, maxMoved: 0, maxOuted: 0, maxTris: 0, minHold: 1, worst: null };
    for (const [sx, sy, n] of legs) {
      window.__qa = { sx, sy };
      for (let i = 0; i < n; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const a = sp.audit(g.camera), st = sp.stats();
        o.frames++;
        o.missing += a.missing;
        o.early += a.early;
        o.shadow += a.shadow;
        o.checked += a.checked;
        o.lifted += a.lifted ?? 0;
        if (a.missing + a.early + a.shadow && !o.worst) o.worst = { frame: o.frames, ...a, y: Math.round(f.y) };
        o.maxMoved = Math.max(o.maxMoved, st.moved);
        o.maxOuted = Math.max(o.maxOuted, st.outed ?? 0);
        o.maxTris = Math.max(o.maxTris, st.tris + st.sunTris);
        o.minHold = Math.min(o.minHold, st.hold);
      }
    }
    window.__qa = {};
    return o;
  }, POSE.street);
if (report.flight) console.log(`flight: ${report.flight.frames} frames, ${report.flight.checked} element checks (${report.flight.lifted} lifted), ${report.flight.missing} missing, ${report.flight.early} early far forms, ${report.flight.shadow} shadows left out; at most ${report.flight.maxMoved} moves in and ${report.flight.maxOuted} out a frame and ${report.flight.maxTris} triangles, the reaches held to ${report.flight.minHold.toFixed(3)} at most${report.flight.worst ? `; first at ${JSON.stringify(report.flight.worst)}` : ''}`);
// the hold after the flight: back at the street pose, it lets out again, to where the street view had it or wherever there's room
const streetHold = report.views.street?.lod?.hold;
if (report.flight && streetHold !== undefined) {
  report.letout = await page.evaluate(async (p) => {
    const g = window.__game, sp = g.sprouts, { x, z } = window.__sbStart;
    window.__qa = { pin: { x: x - p.back, y: g.city.groundAt(x - p.back, z) + p.h, z, heading: g.flight.heading } };
    const at = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => { let n = 30; requestAnimationFrame(function k() { if (--n > 0) requestAnimationFrame(k); else r(); }); });
      const st = sp.stats();
      at.push([+st.hold.toFixed(3), st.tris + st.sunTris]);
    }
    return at;
  }, POSE.street);
  console.log(`let out at the street after the flight (hold/triangles every 30 frames): ${report.letout.map(([h, t]) => `${h}/${t}`).join(' ')}; the street view had ${streetHold.toFixed(3)}`);
}
// the lens snapped round at the street (a cut, a teleport, a look behind in one frame): one render each, every element audited after it
if (opt.snap !== '0' && report.flight) {
  report.snap = await page.evaluate(async () => {
    const g = window.__game, sp = g.sprouts, cam = g.camera;
    g.controls.frozen = true;
    await new Promise((r) => { let n = 60; requestAnimationFrame(function k() { if (--n > 0) requestAnimationFrame(k); else r(); }); });
    window.__qa.holdAt = g.clock();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const q0 = cam.quaternion.clone(), up = cam.up.clone().set(0, 1, 0), res = [];
    for (const yaw of [90, 270, 180, 0, 180, 0]) {
      cam.quaternion.copy(q0);
      cam.rotateOnWorldAxis(up, (yaw * Math.PI) / 180);
      cam.updateMatrixWorld();
      const t = performance.now();
      g.renderAgain();
      const ms = performance.now() - t, a = sp.audit(cam), st = sp.stats();
      res.push({ yaw, ...a, moved: st.moved, outed: st.outed, pending: st.pending, ms: +ms.toFixed(1) });
    }
    cam.quaternion.copy(q0);
    cam.updateMatrixWorld();
    delete window.__qa.holdAt;
    g.controls.frozen = false;
    return res;
  });
  for (const r of report.snap) console.log(`snap to ${r.yaw}: ${r.checked} checked, ${r.missing} missing, ${r.early} early, ${r.shadow} shadows left out; ${r.moved} in, ${r.outed} out, ${r.pending} triangles still to come or go; render ${r.ms} ms`);
}
report.programs.end =await page.evaluate(() => window.__game.pipeline.renderer.info.programs.length);
console.log(`programs: ${report.programs.warm} in the warm-up, ${report.programs.ready} with the city in and the gardens grown, ${report.programs.end} after the views`);
report.wallSeconds = Math.round((Date.now() - t0) / 1000);
writeFileSync(`${out}/budget.json`, JSON.stringify(report, null, 1));
await browser.close();
const over = Object.entries(report.views).filter(([, v]) => v.gardens.tris > LINE);
const pops = report.flight ? report.flight.missing + report.flight.early + report.flight.shadow : 0;
const snapPops = (report.snap ?? []).reduce((n, r) => n + r.missing + r.early + r.shadow, 0);
const held = Object.entries(report.views).filter(([, v]) => v.lod && v.lod.hold < MINHOLD);
// (stuck: the hold ends under the street view's, with room left under the line)
const end = report.letout?.[report.letout.length - 1];
const stuck = end && end[0] < Math.min(streetHold, 1) - 0.01 && end[1] < LINE * 0.97;
const fails = [];
if (pops) fails.push(`${pops} pops in the flight`);
if (snapPops) fails.push(`${snapPops} pops in the snaps`);
if (held.length) fails.push(`the hold is under ${MINHOLD} in ${held.map(([k, v]) => `${k} (${v.lod.hold.toFixed(3)})`).join(', ')}`);
if (stuck) fails.push(`the hold stays at ${end[0]} after the flight with room to let out (${end[1]} triangles)`);
if (over.length) fails.push(`the gardens pass ${LINE} triangles in ${over.map(([k, v]) => `${k} (${v.gardens.tris})`).join(', ')}`);
if (report.bomb && (report.bomb.draws > 200 || report.bomb.tris > 1.5e6 || report.bomb.wrong || !report.bomb.raised)) fails.push(`the Bomb: ${report.bomb.raised} raised, ${report.bomb.wrong} not to min(3, before + 3), at most ${report.bomb.draws} draws and ${report.bomb.tris} triangles (200 and 1.5 M)`);
if (errors.length) fails.push(`${errors.length} page errors: ${errors.slice(0, 5).join(' | ')}`);
for (const f of fails) console.log(`FAIL: ${f}`);
if (!fails.length) console.log(`pass: the gardens stay under ${LINE} triangles in every view, the hold at ${MINHOLD} or more, no pops in the flight or the snaps, the hold let out after it, no page errors`);
process.exit(fails.length ? 1 : 0);
