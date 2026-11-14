#!/usr/bin/env node
// Release A, 1a (docs/specs/world/ABOVE.md): a painted place seen from the roofs to the ceiling, on two pages that differ only by a query (the region's paint mask on
// and ?rmask=0), the same frames from both: each page's clock stands from its first frame (?fixeddt; the game runs only in exact steps the tool asks for, so
// both pages shoot at the same game time), Math.random seeded, the city and its ground paint settled before every shot.
//   node tools/above/paintview.mjs <base url> <out dir> [--place=downtown|houses|moon] [--tags=on:,off:rmask=0] [--poses=roofs,300,1000,5000,14900] [--seed=600,1400]
//        [--pitch=60] [--blast] [--q=sky=off]
// For each tag and pose: <out>/<place>-<pose>-<tag>.png, and in <out>/paintview-<place>.json the frame's draws and triangles (the main pass's ground draws by kind:
// region grounds, tiles' own grounds in coarse regions), the paint's GPU memory (region masks, tiles' own mask textures, own grounds' meshes and class textures in
// coarse regions), renderer.info's programs and textures. Every region mask is read back (a framebuffer on its texture) and compared, slot by slot, with its
// tiles' arrays. --blast: from 1 km a Bomb III's crater (the Bomb's radius from 600 m, its jump and width, through the splat's own path) on the least painted coarse
// region within 1.6 km, every frame for 4 s: draws, triangles, paint upload calls and bytes, regions' ground made again, textures and programs made, ms.
// tools/above/paintcmp.py compares the frames of two tags.
// --lose: then the GL context lost at 1 km and given back, and every region mask read back again.
// Each pose also says how many of the drawn region grounds' tiles lie out of the view (their triangles drawn all the same: a merged ground is culled whole)
// and --at=x,y;x,y (CSS px) where each of those screen points meets the ground: world x, z, its tile and how far it is from the tile's nearest seam.
// Exit 1 on a page error, a region mask that isn't its tiles' arrays, a program made after the page was ready, or a tag whose name starts with "on" drawing a
// tile's own ground in a coarse region.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from '../browser.mjs';
import { openPv } from './pvpage.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const [base, out] = pos;
mkdirSync(out, { recursive: true });
const PLACES = {
  // Union Square, heading north-east over the Financial District
  downtown: { q: 'lat=37.788&lon=-122.4075&heading=45' },
  // the Outer Sunset's rows of houses, heading east toward Twin Peaks
  houses: { q: 'lat=37.7525&lon=-122.4935&heading=90' },
  // the Moon's open ground by Tycho
  moon: { q: 'moon&site=TYCHO' },
};
const place = opt.place ?? 'downtown';
const P = PLACES[place];
const tags = (opt.tags ?? 'on:,off:rmask=0').split(',').map((t) => t.split(':'));
// (a pose is a height, at the rig's own pitch, or height@pitch: the view held that many degrees down)
const poses = (opt.poses ?? (place === 'moon' ? '300,1000,5000,5000@60' : 'roofs,300,1000,5000,14900,5000@60,14900@60')).split(',');
const [seedN, seedR] = (opt.seed ?? '600,1400').split(',').map(Number);
const STEP = 0.05;
const T = '2026-11-13T20:00:00Z';
const browser = await chromium.launch(browserOptions([]));
const R = { place, poses, seed: [seedN, seedR], tags: {} };
let bad = 0;
const fail = (why) => (bad++, console.log(`FAIL ${why}`));

const view = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true };
const base0 = [P.q, 'skipintro', 'nohud', `fixeddt=${STEP}`, `t=${T}`, 'rate=0', opt.q ?? 'sky=off'];
// The paint, laid once on a page of its own and saved (the page's seedGround: n settled blasts within r m of the start, as a long session leaves it), then
// read at load by every page compared: so each draws the same saved paint. (Seeded on each page, a coarse region's tiles kept a few blasts each while the
// mask was off, GroundPaint's MAX_PENDING for a tile with no ground of its own, and every one with it on: the two pages held different paint.)
// --seedeach: seeded on each page instead (the Moon keeps its paint by place in IndexedDB, which this doesn't carry over).
let saved = null;
if (seedN > 0 && !('seedeach' in opt)) {
  const page = await browser.newPage(view);
  page.on('pageerror', (e) => console.log('[pageerror, seeding]', e.message));
  await page.goto(`${base}?${base0.join('&')}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 300000 });
  saved = await page.evaluate(([n, s]) => {
    const g = window.__game, f = g.flight, o = g.city.manifest.origin, k = Math.PI / 180;
    const lat = o[0] - f.z / (k * 6378137), lon = o[1] + f.x / (k * 6378137 * Math.cos(o[0] * k));
    const tiles = g.seedGround(n, lat, lon, s);
    g.city.ground.persist();
    return { tiles, entries: Object.entries(localStorage) };
  }, [seedN, seedR]);
  await page.close();
  console.log(`seeded ${seedN} blasts within ${seedR} m on a page of its own: ${saved.tiles} tiles, ${saved.entries.length} entries in storage`);
}

for (const [tag, tq] of tags) {
  const q = [...base0, tq].filter(Boolean).join('&');
  const pv = await openPv(browser, view, `${base}?${q}`, saved?.entries);
  const { page, settle, run } = pv;
  // (--noparticles: the particles hidden on every page, a diagnosis: the bus's breath and sparkles take Math.random after every object made)
  if ('noparticles' in opt) await page.evaluate(() => (window.__game.particles.object.visible = false));
  if (opt.at) await page.evaluate((a) => (window.__pvAt = a), opt.at.split(';').map((p) => p.split(',').map(Number)));
  const programs0 = await page.evaluate(() => window.__pv.programs0);
  const row = { query: q, programsAtReady: programs0, poses: {} };
  R.tags[tag] = row;
  // the paint: n settled blasts within r m of the start, straight into the ground paint and saved (the page's seedGround), as a long session leaves it
  row.seeded = await page.evaluate(([n, s]) => {
    const g = window.__game, f = g.flight, o = g.city.manifest.origin, k = Math.PI / 180;
    // (the bus's own place as lat/lon, by seedGround's own map: on the Moon too)
    const lat = o[0] - f.z / (k * 6378137), lon = o[1] + f.x / (k * 6378137 * Math.cos(o[0] * k));
    window.__pv.home = { x: f.x, z: f.z, heading: f.heading };
    return n > 0 ? g.seedGround(n, lat, lon, s) : g.city.ground.tileCount;
  }, [saved ? 0 : seedN, seedR]);
  await run(0.5);
  await settle();
  console.log(`${tag}: ${q}: programs at ready ${programs0}, ${saved ? 'saved paint read at load' : `seeded ${seedN} blasts within ${seedR} m`}: ${row.seeded} tiles`);
  const pinAt = (pose) => pv.pinAt(pose, opt.pitch != null ? Number(opt.pitch) : null);
  const shoot = async (name) => {
    await page.evaluate(() => {
      const A = window.__pv;
      A.frames = [];
      A.on = true;
    });
    await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res)))));
    const st = await page.evaluate(() => {
      const A = window.__pv, g = window.__game, c = g.city, f = A.frames[A.frames.length - 1];
      A.on = false;
      const lod = { 0: 0, 1: 0 };
      for (const v of c.regionLod.values()) lod[v]++;
      // (the bus's box on the screen, CSS px: a 16 x 9 x 16 m box round it, projected; its exhaust's particles about it)
      const cam = g.camera, v = new cam.position.constructor();
      let bb = null;
      for (let i = 0; i < 8; i++) {
        v.set(g.flight.x + (i & 1 ? 8 : -8), g.flight.y + (i & 2 ? 6 : -3), g.flight.z + (i & 4 ? 8 : -8)).project(cam);
        if (v.z >= 1) continue;
        const sx = ((v.x + 1) / 2) * innerWidth, sy = ((1 - v.y) / 2) * innerHeight;
        bb = bb ? { x0: Math.min(bb.x0, sx), x1: Math.max(bb.x1, sx), y0: Math.min(bb.y0, sy), y1: Math.max(bb.y1, sy) } : { x0: sx, x1: sx, y0: sy, y1: sy };
      }
      // (the region grounds drawn: their tiles out of the view, a tile's box against the camera's clip space)
      const P = cam.projectionMatrix.elements, V = cam.matrixWorldInverse.elements, ts = c.manifest.tileSize, rs = c.regionSize;
      const clip = (x, y, z) => {
        const ex = V[0] * x + V[4] * y + V[8] * z + V[12], ey = V[1] * x + V[5] * y + V[9] * z + V[13], ez = V[2] * x + V[6] * y + V[10] * z + V[14], ew = V[3] * x + V[7] * y + V[11] * z + V[15];
        return [0, 1, 2, 3].map((i) => P[i] * ex + P[4 + i] * ey + P[8 + i] * ez + P[12 + i] * ew);
      };
      const outOfView = (x0, y0, z0, x1, y1, z1) => {
        const q = [];
        for (let i = 0; i < 8; i++) q.push(clip(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0));
        for (let a = 0; a < 3; a++) if (q.every((p) => p[a] < -p[3]) || q.every((p) => p[a] > p[3])) return true;
        return false;
      };
      const cull = { grounds: 0, tiles: 0, out: 0, outTris: 0 };
      for (const [key, rm] of c.regionMeshes) {
        const t = rm.terrain;
        if (!t || !t.visible || !t.geometry.index || c.regionLod.get(key) !== 1) continue;
        const [rx, rz] = key.split(',').map(Number);
        // (each tile's box from its own heights: the merged grid's arrays are dropped once they're up)
        const tiles = [];
        let lo = Infinity, hi = -Infinity;
        for (let tz = rz * rs; tz < (rz + 1) * rs; tz++)
          for (let tx = rx * rs; tx < (rx + 1) * rs; tx++) {
            const tr = c.tiles.get(`${tx},${tz}`)?.terrainData;
            if (!tr) continue;
            let a = Infinity, b = -Infinity;
            for (const h of tr.heights) (a = Math.min(a, h)), (b = Math.max(b, h));
            tiles.push([tx, tz, a + t.position.y, b + t.position.y]);
            (lo = Math.min(lo, a + t.position.y)), (hi = Math.max(hi, b + t.position.y));
          }
        if (!tiles.length || outOfView(rx * rs * ts, lo, rz * rs * ts, (rx + 1) * rs * ts, hi, (rz + 1) * rs * ts)) continue;
        const per = t.geometry.index.count / 3 / tiles.length;
        cull.grounds++;
        for (const [tx, tz, a, b] of tiles) {
          cull.tiles++;
          if (outOfView(tx * ts, a, tz * ts, (tx + 1) * ts, b, (tz + 1) * ts)) (cull.out++, (cull.outTris += per));
        }
      }
      cull.outTris = Math.round(cull.outTris);
      // (--at: each screen point down its ray to the ground, in 2 m steps then halved)
      const at = [];
      for (const [px, py] of window.__pvAt ?? []) {
        const o = cam.position, d = new cam.position.constructor((px / innerWidth) * 2 - 1, 1 - (py / innerHeight) * 2, 0.5).unproject(cam).sub(o).normalize();
        let s0 = 0, s1 = 0;
        for (let s = 2; s < 60000; s += 2) if (o.y + d.y * s < c.groundAt(o.x + d.x * s, o.z + d.z * s)) { s1 = s; s0 = s - 2; break; }
        if (!s1) { at.push({ px, py, hit: false }); continue; }
        for (let k = 0; k < 20; k++) { const m = (s0 + s1) / 2; if (o.y + d.y * m < c.groundAt(o.x + d.x * m, o.z + d.z * m)) s1 = m; else s0 = m; }
        const x = o.x + d.x * s1, z = o.z + d.z * s1, tx = Math.floor(x / ts), tz = Math.floor(z / ts), fx = x / ts - tx, fz = z / ts - tz;
        at.push({ px, py, x: +x.toFixed(1), z: +z.toFixed(1), tile: [tx, tz], seam: +(Math.min(fx, 1 - fx, fz, 1 - fz) * ts).toFixed(1), coarse: c.regionLod.get(`${Math.floor(tx / rs)},${Math.floor(tz / rs)}`) === 1, painted: c.ground.has(tx, tz) || c.ground.store.has(`${tx},${tz}`) });
      }
      return { frame: f, cull, at, memory: A.memory(), readBack: A.readBack(), bus: bb, clock: +g.clock().toFixed(3), agl: Math.round(g.flight.y - c.groundAt(g.flight.x, g.flight.z)), regions: lod, ownGround: c.ownGround.size };
    });
    await page.screenshot({ path: `${out}/${name}.png` });
    return st;
  };
  for (const h of poses) {
    await pinAt(h);
    await run(1);
    await settle();
    await run(0.5);
    await settle();
    const st = await shoot(`${place}-${h}-${tag}`);
    row.poses[h] = st;
    const f = st.frame ?? {}, m = st.memory, b = st.readBack;
    console.log(`${tag} ${h}: ground triangles: region grounds ${f.regionGroundTris}, own in coarse ${f.ownCoarseTris}, own detailed ${f.ownDetailedTris} | region grounds in view ${st.cull.grounds}, their tiles ${st.cull.tiles}, out of the view ${st.cull.out} (${st.cull.outTris} triangles)`);
    for (const p of st.at) console.log(`${tag} ${h}: at (${p.px}, ${p.py}) ` + (p.hit === false ? 'no ground' : `x ${p.x} z ${p.z}, tile (${p.tile}), ${p.seam} m from its nearest seam, ${p.coarse ? 'coarse' : 'detailed'}, ${p.painted ? 'painted' : 'unpainted'}`));
    console.log(`${tag} ${h}: clock ${st.clock} agl ${st.agl} | ${f.calls} draws ${(f.tris / 1e6).toFixed(3)} M | ground draws: regions ${f.regionGround}, own in coarse ${f.ownCoarse}, own detailed ${f.ownDetailed} | lod0 ${st.regions[0]} lod1 ${st.regions[1]} | region masks ${m.regionMasks} (${(m.regionMaskBytes / 1048576).toFixed(2)} MiB, ${m.regionTiles} tiles), own mask textures ${m.ownMaskTextures} (${(m.ownMaskBytes / 1048576).toFixed(2)} MiB), own grounds in coarse ${m.ownGroundsInCoarse} (${(m.ownGroundBytesInCoarse / 1024).toFixed(0)} KiB), painted tiles ${m.paintedTiles} | textures ${m.textures} programs ${m.programs} | read back: ${b.regions} regions ${b.slots} slots, ${b.diff} bytes differ, ${b.painted} painted texels`);
    if (b.diff) fail(`${tag} ${h}: a region mask differs from its tiles' arrays by ${b.diff} bytes`);
    if (b.unshown) fail(`${tag} ${h}: ${b.unshown} painted tiles of drawn coarse regions not shown in their masks (${b.unshownAt.join(' ')})`);
    if (b.stale) fail(`${tag} ${h}: ${b.stale} region grounds read another flag set or texture than their region's`);
    if (tag.startsWith('on') && f.ownCoarse) fail(`${tag} ${h}: ${f.ownCoarse} draws of tiles' own ground in coarse regions`);
  }
  if ('blast' in opt) {
    // a Bomb III's crater on the least painted coarse region within 1.6 km, from 1 km, every frame for 4 s of game time
    await pinAt('1000');
    await run(1);
    await settle();
    const aim = await page.evaluate(() => {
      const g = window.__game, c = g.city, gp = c.ground, H = window.__pv.home, ts = c.manifest.tileSize, rs = c.regionSize;
      let best = null;
      for (const [key, lod] of c.regionLod) {
        if (lod !== 1) continue;
        const [rx, rz] = key.split(',').map(Number);
        let painted = 0;
        for (let tz = rz * rs; tz < (rz + 1) * rs; tz++) for (let tx = rx * rs; tx < (rx + 1) * rs; tx++) if (gp.has(tx, tz) || gp.store.has(`${tx},${tz}`)) painted++;
        const x = (rx + 0.5) * rs * ts, z = (rz + 0.5) * rs * ts, d = Math.hypot(x - H.x, z - H.z);
        if (d > 1600) continue;
        // (the fewest painted tiles, then the nearest: with the mask off each tile the crater reaches is split out in its frames, the cost 1a takes away)
        if (!best || painted < best.painted || (painted === best.painted && d < best.d)) best = { key, x, z, d: Math.round(d), painted };
      }
      return best;
    });
    if (!aim) fail(`${tag} blast: no coarse region within 1.6 km`);
    else {
      const frames = await page.evaluate(
        (aim) =>
          new Promise((res) => {
            const g = window.__game, c = g.city, A = window.__pv, r = g.pipeline.renderer, S = g.config.splat, B = g.config.bomb;
            const d = Math.min(S.dropMax, 600), radius = S.blastRadius * (1 + ((S.dropGain300 - 1) * d) / 300) * B.radius3;
            const rows = [];
            const t0 = g.clock();
            let last = performance.now(), mem = A.memory(), rb = A.rebuilds;
            A.frames = [];
            A.on = true;
            A.geo = { scenes: new WeakSet(), old: new WeakSet(), made: [] };
            g.forceReady();
            g.splatter.barf(aim.x, aim.z, { radius, width: B.width3, jump: B.jump3, hitStop: 0 });
            const qa = window.__qa;
            qa.holdAt = undefined;
            g.controls.frozen = false;
            const tick = () => {
              const now = performance.now(), m = A.memory(), f = A.frames[A.frames.length - 1], u = c.ground.uploadQa;
              if (f) rows.push({ t: +(g.clock() - t0).toFixed(2), ms: +(now - last).toFixed(1), calls: f.calls, tris: f.tris, ownCoarse: f.ownCoarse, uploads: u.calls + u.regionCalls, uploadBytes: u.bytes + u.regionBytes, regionUploads: u.regionCalls, rebuilds: A.rebuilds - rb, textures: m.textures - mem.textures, geometries: m.geometries - mem.geometries, programs: m.programs - mem.programs, regionMasks: m.regionMasks - mem.regionMasks, linked: f.linked, linkedWhole: f.linkedWhole, freshWhole: f.freshWhole, decodedWhole: f.decodedWhole });
              A.frames = [];
              rb = A.rebuilds;
              mem = m;
              last = now;
              if (g.clock() - t0 >= 4) {
                A.on = false;
                g.controls.frozen = true;
                const geoMade = A.geo.made;
                A.geo = null;
                res({ radius: Math.round(radius), rows, geoMade });
              } else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
        aim,
      );
      await settle();
      const b = await page.evaluate(() => window.__pv.readBack());
      const rows = frames.rows, worst = (k) => rows.reduce((a, r) => Math.max(a, r[k]), 0), total = (k) => rows.reduce((a, r) => a + r[k], 0);
      row.blast = { aim, radius: frames.radius, frames: rows.length, worstCalls: worst('calls'), worstTris: worst('tris'), worstUploads: worst('uploads'), worstUploadBytes: worst('uploadBytes'), worstMs: worst('ms'), rebuilds: total('rebuilds'), texturesMade: total('textures'), geometriesNet: total('geometries'), programsMade: total('programs'), regionMasksMade: total('regionMasks'), ownCoarseWorst: worst('ownCoarse'), geoMade: frames.geoMade, readBack: b, rows };
      const x = row.blast;
      console.log(`${tag} blast: Bomb III crater r ${x.radius} m on region ${aim.key} (${aim.d} m off, ${aim.painted} painted tiles), ${x.frames} frames | worst frame: ${x.worstCalls} draws ${(x.worstTris / 1e6).toFixed(3)} M, ${x.worstUploads} paint uploads ${(x.worstUploadBytes / 1024).toFixed(0)} KiB, ${x.worstMs} ms (laptop) | region grounds made again ${x.rebuilds}, textures made ${x.texturesMade}, geometries net ${x.geometriesNet}, programs made ${x.programsMade}, region masks made ${x.regionMasksMade} | read back after: ${b.regions} regions ${b.diff} bytes differ`);
      for (const m of x.geoMade) console.log(`${tag} blast: a geometry first drawn in its frames, at ${m.t} s: ${m.path}, ${m.material}, ${m.verts} vertices (${m.attrs})`);
      if (b.diff) fail(`${tag} blast: a region mask differs from its tiles' arrays by ${b.diff} bytes`);
      if (x.programsMade) fail(`${tag} blast: ${x.programsMade} programs made`);
    }
  }
  // (before a lost context, which makes every program again)
  row.programsAtEnd = await page.evaluate(() => window.__game.pipeline.renderer.info.programs.length);
  if ('lose' in opt) {
    // the GL context lost at 1 km and given back (the game's whole path through a GPU reset): every region mask made and filled again from its tiles
    await pinAt('1000');
    await run(0.5);
    await settle();
    await page.evaluate(() => window.__game.loseContext());
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.__game.restoreContext());
    await page.waitForTimeout(3000);
    await run(0.5);
    await settle();
    await run(0.5);
    await settle();
    const lost = await page.evaluate(() => ({ readBack: window.__pv.readBack(), memory: window.__pv.memory() }));
    row.lost = lost;
    console.log(`${tag} lost context: read back ${lost.readBack.regions} regions ${lost.readBack.slots} slots, ${lost.readBack.diff} bytes differ, ${lost.readBack.painted} painted texels | region masks ${lost.memory.regionMasks}`);
    if (lost.readBack.diff) fail(`${tag} lost context: a region mask differs from its tiles' arrays by ${lost.readBack.diff} bytes`);
    if (tag.startsWith('on') && !lost.readBack.regions) fail(`${tag} lost context: no region mask after it`);
  }
  row.errors = pv.errors;
  if (row.programsAtEnd !== programs0) fail(`${tag}: programs ${programs0} at ready, ${row.programsAtEnd} at the end`);
  if (pv.errors) fail(`${tag}: ${pv.errors} page errors`);
  console.log(`${tag}: programs at ready ${programs0}, at the end ${row.programsAtEnd}`);
  writeFileSync(`${out}/paintview-${place}.json`, JSON.stringify(R, null, 1));
  await page.close();
}
await browser.close();
console.log(bad ? `PAINTVIEW FAILED: ${bad}` : 'paintview: passed');
process.exit(bad ? 1 : 0);
