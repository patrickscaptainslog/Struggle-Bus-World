// Release A, 1a: the page the tools in tools/above stand a painted place up on (paintview.mjs, writers.mjs): its clock standing from the first frame
// (?fixeddt: the game runs only in the exact steps run() asks for), Math.random seeded from the game clock every frame, the paint read at load from the
// storage entries given, and its hooks in window.__pv: the main pass's ground draws by kind, region grounds made again, the paint's memory and every region
// mask read back against its tiles' arrays. pinAt holds the bus at a height (or 'roofs') over window.__pv.home, the view held `pitch` degrees down.

/** A page at url, settled, its hooks in: { page, errors, settle(), run(s), pinAt(pose, pitch) } */
export async function openPv(browser, view, url, entries = null) {
  const page = await browser.newPage(view);
  const pv = { page, errors: 0 };
  page.on('pageerror', (e) => (pv.errors++, console.log('[pageerror]', e.message)));
  if (entries) await page.addInitScript((entries) => { for (const [k, v] of entries) localStorage.setItem(k, v); }, entries);
  await page.addInitScript(() => {
    // (Math.random reseeded from the game clock every frame, and again after the city's streaming step, as tools/shots.mjs --det has it: three.js draws
    // randoms for every object it makes, and the two pages make different objects, so a particle once moved with them)
    let s = 1;
    let g = null;
    const seed = () => (s = 1 + ((987654321 + (g ? Math.round(g.clock() * 30) : 0) * 48271) % 2147483646));
    Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => (seed(), cb(t)));
    Object.defineProperty(window, '__game', {
      configurable: true,
      get: () => g,
      set: (v) => {
        g = v;
        // (the clock stands from the first frame: the tool runs it in exact steps)
        v.controls.frozen = true;
        // (&pvtrace, a diagnosis: each tile's ground paint views and its onTileReady, by frame, in window.__pvTrace)
        if (location.search.includes('pvtrace')) {
          const G = v.city.ground, log = (window.__pvTrace = []);
          const at = () => [v.pipeline.renderer.info.render.frame, +v.clock().toFixed(2)];
          for (const name of ['attach', 'attachRegion', 'detach', 'detachRegion', 'startShown', 'endShown', 'replayed']) {
            const f = G[name];
            if (typeof f !== 'function') continue;
            G[name] = function (...a) {
              log.push([...at(), name, typeof a[0] === 'string' ? a[0] : name === 'replayed' ? a[0]?.only : `${a[0]},${a[1]}`]);
              return f.apply(this, a);
            };
          }
          const ready = G.onTileReady;
          G.onTileReady = (tx, tz) => (log.push([...at(), 'ready', `${tx},${tz}`]), ready?.(tx, tz));
        }
        const update = v.city.update;
        v.city.update = function (...a) {
          const r = update.apply(this, a);
          seed();
          return r;
        };
        // (the live sky's files land at once while it stands, as tools/shots.mjs --det has them)
        const st = v.sky && v.sky.street;
        if (st && typeof st.load === 'function') {
          const load = st.load;
          st.load = function (...a) {
            return load.apply(this, a).then((r) => {
              if (this.landedAt >= 0 && v.controls.frozen) (this.land = 1), (this.busy = false);
              return r;
            });
          };
        }
      },
    });
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true && window.__game, null, { timeout: 300000 });
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((res, rej) => {
          const g = window.__game, t0 = performance.now();
          let quiet = 0;
          const tick = () => {
            // (and, with the mask off, no region waiting for its tiles' split grounds: SPLITS a frame, which city.busy doesn't count)
            quiet = !g.city.busy && g.city.ground.queued === 0 && !g.city.groundStale?.size ? quiet + 1 : 0;
            if (quiet >= 30) res(null);
            else if (performance.now() - t0 > 240000) rej(new Error('paintview: the city did not settle in 240 s'));
            else requestAnimationFrame(tick);
          };
          tick();
        }),
    );
  // the game runs exactly s seconds (frame-exact on the fixed step), then stands again
  const run = async (s) => {
    await page.evaluate((s) => {
      const g = window.__game, qa = window.__qa;
      qa.held = false;
      qa.holdAt = g.clock() + s - 1e-6;
      g.controls.frozen = false;
    }, s);
    await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 240000, polling: 50 });
    await page.evaluate(() => {
      const g = window.__game, qa = window.__qa;
      g.controls.frozen = true;
      qa.holdAt = undefined;
      qa.held = false;
    });
  };
  await page.evaluate(() => (window.__qa = {}));
  await settle();
  // the page's hooks: draws by kind in the main pass, region grounds made again, and the region masks' read back
  await page.evaluate(() => {
    const g = window.__game, c = g.city, pl = g.pipeline, r = pl.renderer, gl = r.getContext();
    const A = (window.__pv = { on: false, cur: null, frames: [], rebuilds: 0, programs0: r.info.programs.length });
    const coarse = (tx, tz) => c.regionLod.get(`${Math.floor(tx / c.regionSize)},${Math.floor(tz / c.regionSize)}`) === 1;
    const rbd = r.renderBufferDirect;
    r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      const info = r.info.render, c0 = info.calls, t0 = info.triangles;
      rbd.call(this, camera, scene, geometry, material, object, group);
      // (while A.geo is set: a geometry drawn that no scene held when the watch began, and what draws it. Second review, R2-3)
      if (A.geo) {
        if (!A.geo.scenes.has(scene)) {
          A.geo.scenes.add(scene);
          scene.traverse((o) => o.geometry && A.geo.old.add(o.geometry));
        }
        if (!A.geo.old.has(geometry)) {
          A.geo.old.add(geometry);
          const path = [];
          for (let o = object; o && path.length < 4; o = o.parent) path.push(o.name || o.type);
          A.geo.made.push({ t: +g.clock().toFixed(2), path: path.join(' < '), material: material.name || material.type, verts: geometry.attributes.position?.count ?? 0, attrs: Object.keys(geometry.attributes).join(',') });
        }
      }
      if (!A.on || camera !== pl.snapCam) return;
      const k = A.cur;
      if (!k) return;
      const n = info.calls - c0;
      // (which mesh is whose, looked up once a frame: meshes come and go)
      if (!A.sets) {
        A.sets = new Map();
        for (const rm of c.regionMeshes.values()) if (rm.terrain) A.sets.set(rm.terrain, null);
        for (const lt of c.tiles.values()) if (lt.terrain) A.sets.set(lt.terrain, lt);
      }
      if (!A.sets.has(object)) return;
      const lt = A.sets.get(object);
      const kind = !lt ? 'regionGround' : coarse(lt.tx, lt.tz) ? 'ownCoarse' : 'ownDetailed';
      k[kind] += n;
      // (and their triangles: where a pose's triangles go between the region grounds and tiles' own. Second review, R2-6)
      k[kind + 'Tris'] += info.triangles - t0;
    };
    const perf = g.perf, frame = perf.frame.bind(perf);
    perf.frame = (dt, work) => {
      frame(dt, work);
      if (A.on && A.cur) A.frames.push({ ...A.cur, calls: perf.calls, tris: perf.tris });
      A.cur = { regionGround: 0, ownCoarse: 0, ownDetailed: 0, regionGroundTris: 0, ownCoarseTris: 0, ownDetailedTris: 0, linked: 0, linkedWhole: 0, freshWhole: 0, decodedWhole: 0 };
      A.sets = null;
    };
    // (why a region slot goes up whole: a mask linked to its slot (fresh: made just now, all zeros; sent whole: regAll), or saved paint decoded onto it)
    const gp0 = c.ground, link = gp0.linkRegion, all = gp0.markAll;
    if (link)
      gp0.linkRegion = function (m, t, fresh) {
        const was = m.regAll, r = link.call(this, m, t, fresh), k = A.cur;
        if (k) {
          k.linked++;
          if (m.regAll && !was) (k.linkedWhole++, fresh && k.freshWhole++);
        }
        return r;
      };
    if (all)
      gp0.markAll = function (m) {
        if (A.cur && m.reg) A.cur.decodedWhole++;
        return all.call(this, m);
      };
    const brg = c.buildRegionGround;
    c.buildRegionGround = function (...a) {
      A.rebuilds++;
      return brg.apply(this, a);
    };
    A.memory = () => {
      const gp = c.ground, st = gp.regionStats();
      let ownCoarse = 0, ownCoarseBytes = 0, ownMaskTex = 0;
      for (const lt of c.tiles.values()) {
        if (!lt.terrain || !coarse(lt.tx, lt.tz)) continue;
        ownCoarse++;
        const geo = lt.terrain.geometry;
        let b = 0;
        for (const at of Object.values(geo.attributes)) b += at.array.byteLength;
        if (geo.index) b += geo.index.array.byteLength;
        const ct = lt.classTex?.image;
        ownCoarseBytes += b + (ct ? ct.width * ct.height : 0);
      }
      for (const m of gp.masks.values()) if (m.tex) ownMaskTex++;
      // (a tile's own mask texture is GROUND_N^2 RGBA8: 64 KiB)
      return { regionMasks: st.textures, regionMaskBytes: st.bytes, regionTiles: st.tiles, ownMaskTextures: ownMaskTex, ownMaskBytes: ownMaskTex * 65536, ownGroundsInCoarse: ownCoarse, ownGroundBytesInCoarse: ownCoarseBytes, paintedTiles: gp.masks.size, textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs.length };
    };
    // every region mask read back from the GPU, slot by slot, against its tiles' arrays (a tile with no mask: zeros)
    A.readBack = () => {
      const gp = c.ground;
      let regions = 0, slots = 0, diff = 0, painted = 0;
      const fb = gl.createFramebuffer();
      for (const rg of gp.regions.values()) {
        if (!rg.tex) continue;
        const t = r.properties.get(rg.tex).__webglTexture;
        if (!t) continue;
        regions++;
        const N = rg.tex.image.width, px = new Uint8Array(N * N * 4);
        r.state.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
        r.state.bindFramebuffer(gl.FRAMEBUFFER, null);
        const n = N / rg.n;
        for (const key of rg.tiles) {
          const [tx, tz] = key.split(',').map(Number), s = gp.regionSlot(tx, tz);
          if (!s) continue;
          slots++;
          for (let j = 0; j < n; j++)
            for (let i = 0; i < n * 4; i++) {
              const want = s.data ? s.data[j * n * 4 + i] : 0, got = px[((s.rj * n + j) * N + s.ri * n) * 4 + i];
              if (want !== got) diff++;
              if (i % 4 === 0 && want >= 128) painted++;
            }
        }
      }
      gl.deleteFramebuffer(fb);
      // (with the mask on: a painted tile of a drawn coarse region not shown in its mask (no region view, no mask, or its flag clear), and a region ground whose
      // material reads another flag set or texture than its region's. Second review: paint a page shows on one load and not on its repeat)
      let unshown = 0, stale = 0;
      const unshownAt = [];
      if (c.rmask) {
        const rs = c.regionSize;
        for (const [key, rm] of c.regionMeshes) {
          const t = rm.terrain;
          if (!t || c.regionLod.get(key) !== 1) continue;
          const [rx, rz] = key.split(',').map(Number), rg = gp.regions.get(key), mu = t.material.uniforms;
          if (rg && mu && (mu.uGroundSq?.value !== rg.uniforms.uGroundSq.value || (rg.tex && mu.tGround?.value !== rg.tex))) stale++;
          for (let tz = rz * rs; tz < (rz + 1) * rs; tz++)
            for (let tx = rx * rs; tx < (rx + 1) * rs; tx++) {
              if (!c.tiles.get(`${tx},${tz}`)?.terrainData) continue;
              if (!(gp.has(tx, tz) || gp.store.has(`${tx},${tz}`))) continue;
              const s = gp.regionSlot(tx, tz);
              if (!s || !s.data || !s.flag) (unshown++, unshownAt.length < 6 && unshownAt.push(`${tx},${tz}:${!s ? 'no view' : !s.data ? 'no mask' : 'flag 0'}`));
            }
        }
      }
      return { regions, slots, diff, painted, unshown, unshownAt, stale };
    };
  });
  pv.settle = settle;
  pv.run = run;
  /** pose: a height (m over the ground under home) or 'roofs'; pitch: degrees down held, or null for the rig's own */
  pv.pinAt = (pose, pitch0 = null) =>
    page.evaluate(([h, pitch]) => {
      const g = window.__game, c = g.city, H = window.__pv.home;
      window.__pv.pitch = pitch;
      const y = h === 'roofs' ? Math.max(c.groundAt(H.x, H.z) + 30, c.surfaceAt(H.x, H.z) + 25) : c.groundAt(H.x, H.z) + Number(h);
      window.__qa.pin = { x: H.x, z: H.z, heading: H.heading, y };
      Object.assign(g.flight, { x: H.x, z: H.z, heading: H.heading, y, holdY: y, targetY: y, vy: 0, mode: 0 });
      g.flight.glideSpeed = 0;
      // (the broad ground under the bus set to Flight's own sum here, and the nose eased from level: both ease (0.5/s, 5/s), and what they eased from
      // depends on when the tiles round the start landed during the load, so two loads of one page held the camera a millimetre apart, 83 game pixels)
      const B = 220;
      g.flight.groundBroad = (c.groundAt(H.x, H.z) + c.groundAt(H.x + B, H.z) + c.groundAt(H.x - B, H.z) + c.groundAt(H.x, H.z + B) + c.groundAt(H.x, H.z - B)) / 5;
      g.flight.pitch = 0;
      // (and the chase camera put where it wants to be at its next step, its spring at rest: it eases from where the load left it too)
      g.rig.pos.set(0, 0, 0);
      g.rig.posVel.set(0, 0, 0);
      g.rig.look.set(0, 0, 0);
      // (4f33648's rig has no settleAt: the same lines here, as the study's grid tool has them)
      const lh = h === 'roofs' ? 30 : Number(h), C = g.config.camera, rg = g.rig;
      if (rg.settleAt) rg.settleAt(lh);
      else {
        const t = Math.min(1, Math.max(0, (lh - C.vistaStart) / (Math.max(C.vistaStart + 1, C.vistaFull) - C.vistaStart)));
        rg.lensHeight = rg.lensTarget = lh;
        rg.vista = rg.vistaTarget = t * t * (3 - 2 * t);
      }
      if (!window.__pv.pitched) {
        // (the view's pitch held, after the rig has set the lens)
        window.__pv.pitched = true;
        const cam = g.camera, up = rg.update.bind(rg), d = new cam.position.constructor();
        rg.update = (...a) => {
          const res = up(...a);
          const pitch = window.__pv.pitch;
          if (pitch == null) return res;
          cam.updateMatrixWorld();
          const now = (-Math.asin(Math.max(-1, Math.min(1, cam.getWorldDirection(d).y))) * 180) / Math.PI;
          cam.rotateX(((now - pitch) * Math.PI) / 180);
          cam.updateMatrixWorld();
          return res;
        };
      }
    }, [pose.split('@')[0], pose.includes('@') ? Number(pose.split('@')[1]) : pitch0]);
  return pv;
}
