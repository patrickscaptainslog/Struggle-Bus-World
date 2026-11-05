#!/usr/bin/env node
// Scripted beauty shots from the real game (index.html), iPhone 15 viewport.
//   node tools/shots.mjs [baseUrl] [outDir] [--det] [--views=grey,painted,...] [--q=farmap&farfade]
// Produces: grey.png (grey city from the gameplay camera), painted.png (a
// painted block after a few splats), opening.png (the Golden Gate opening),
// and stats.json (renderer stats; SwiftShader fps is NOT representative).
// --det: repeatable frames, for an image diff between two builds (python -I
// tools/shotdiff.py <dirA> <dirB>): ?fixeddt, a seeded Math.random, the game
// clock held while streaming and paint settle, the same frames from any build
// (also fidi, soma, high: a climb to ~250 m, ceiling: ~500 m, swap: painted towers
// through a climb to coarse and a dive back to detail; asked for by name, the far-field poses at the ceiling:
// sunset, presidio, downtown, marin, sunward, into the sun, westward, into it over the city; headn, southn, north, the horizon's shores past the frame; corner, corner2, the sea's
// horizon at the frame's west edge; london, amsterdam).
// --q: appended to every view's query (the flags under test: ?nofar, or the far flags spelled out).
// --drop=far16.bin: that file answers 404, a city that doesn't have it.
// --seq (with --det): five more frames after each view's shot, one fixed step apart (<name>-seq-0.png is the shot itself, then 1..5): a
// burst from the same camera on any build, so tools/far/bandflip.py's crawl can be compared between two builds.
// --pan (with --det): and a turn, 0.6 s into a held stick, six frames a fixed step apart (<name>-pan-0.png .. 5).
// --set=far.blockEnd:5000,far.blockSink:4000 (with --det): config values, from the first frame.
// --descent (with --det): and the full dive from there to the rooftops: a frame every half second of game time (<name>-descent-00.png ...), and a
// six-frame burst 3 s in (<name>-dive-0.png .. 5), for the crawl on the way down.
// --trace (with --det): <name>-trace.json beside each shot, every game frame from the first (one a run's end holds does nothing, and isn't
// one): the clock, dt, whether it stood, the flight's state, the world queries its steps made (a count and a hash), the camera and what
// the city streams from, city.busy and its counts, Math.random's draws, and every arrival stamped with its frame (a region asked for and
// answered, a tile adopted, a swap, a stamp, resource timing). --trace=stacks: and where each draw came from. tools/tracediff.mjs finds
// the first frame two traces part at.
// --jitter=<ms> (with --det): a loaded machine on purpose, each region answered up to <ms> late and each adoption up to a tenth of it
// slower; --gap=<n>: n more frames with the clock standing before every run. A deterministic run must come out the same under both.
// (A view script stages what a run starts with, glide(), stick(), unstick(), barf(), and runDet hands it over as the clock starts.)
// hold-sunset, hold-presidio, hold-downtown (with --det, by name): SPIKE.md's hold-still swap. Nothing loads past the start on the way up (?loadr=1),
// the clock stands, the frame is shot; the radius comes back, what streams in lands with the clock still standing, and it is shot again, the camera
// where it was: <name>-<sun>-0.png, <name>-<sun>-1.png, for the game's sun (day), 75 degrees (high), 5 degrees (low) and a night made of light alone
// (the palette stays the day's: no night table exists yet). tools/far/swapstat.py reads the pairs. --vary='{"fit0":{"far.fit":0}}': more frames in that list.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const base = pos[0] ?? 'http://127.0.0.1:5173/';
const out = pos[1] ?? 'shots';
const det = 'det' in opt;
const trace = det && 'trace' in opt ? opt.trace : null;
mkdirSync(out, { recursive: true });

// (PW_WS: connect to a running tools/pw-server.mjs instead of launching a browser)
const browser = process.env.PW_WS ? await chromium.connect(process.env.PW_WS, { timeout: 60000 }) : await chromium.launch({
  ...browserOptions([]),
});
const stats = {};

const STEP = 1 / 30;

async function open(query) {
  if (opt.q) query += `&${opt.q}`;
  // (--det's climbs run into a ceiling: the frames are comparable across builds at the one they were first shot under)
  if (det) query += '&ceiling=520';
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.log('[console]', m.text()));
  if (opt.drop) await page.route(`**/${opt.drop}*`, (r) => r.fulfill({ status: 404, body: '' }));
  if (det) {
    await page.addInitScript(({ tr, jit }) => {
      // Math.random reseeded from the game clock on every frame, and again after the streaming step: a
      // build that makes a few more three.js objects (each draws UUID randoms) can't shift hues or particles
      let s = 1;
      let g = null;
      const seed = () => (s = 1 + ((987654321 + (g ? Math.round(g.clock() * 30) : 0) * 48271) % 2147483646));
      const draw = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
      // --jitter=<ms>: a loaded machine on purpose (each region answered up to that late, each adoption up to a tenth of it slower), with
      // randoms of its own: the deterministic run must come out the same
      const wild = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
      const jitter = (c) => {
        const J = Number(jit);
        const onRegion = c.onRegion;
        c.onRegion = function (msg) {
          setTimeout(() => onRegion.call(this, msg), wild() * J);
        };
        for (const name of ['addTile', 'prepTile', 'swapRegion', 'buildRegionMesh']) {
          const fn = c[name];
          if (typeof fn === 'function')
            c[name] = function (...a) {
              if (wild() < 0.5) for (const end = performance.now() + (wild() * J) / 10; performance.now() < end; );
              return fn.apply(this, a);
            };
        }
      };
      // (--trace: T.f, one row a game frame, its columns T.cols; T.ev, the arrivals, each [frames so far, clock, inside city.update, kind, ...])
      const T = tr ? (window.__trace = { cols: null, f: [], ev: [], n: 0, draws: 0, sites: tr === 'stacks' ? {} : null, frame: null }) : null;
      Math.random = T
        ? () => {
            T.draws++;
            if (T.sites) {
              const k = (new Error().stack.split('\n')[2] || '').trim();
              T.sites[k] = (T.sites[k] || 0) + 1;
            }
            return draw();
          }
        : draw;
      const hooks = (v) => {
        const f = v.flight, c = v.city, cam = v.camera, rig = v.rig;
        let inStep = false, depth = 0, qn = 0, qh = 0, steps = 0, lastT = 0, lastId = c.nextId ?? 0;
        T.upd = false;
        const ev = (...e) => T.ev.push([T.n, g.clock(), T.upd ? 1 : 0, ...e]);
        // (what the flight's steps asked the world, the top calls only: a count and a hash of the answers)
        const num = (r) => (typeof r === 'boolean' ? +r : Number.isFinite(r) ? Math.round(r * 1e4) : r > 0 ? 1e9 + 7 : r < 0 ? -1e9 - 7 : -3);
        for (const m of ['obstacleAt', 'groundAt', 'overheadAt', 'hardAt', 'solidAt']) {
          const fn = c[m];
          if (typeof fn !== 'function') continue;
          c[m] = function (...a) {
            const top = inStep && depth === 0;
            depth++;
            let r;
            try {
              r = fn.apply(this, a);
            } finally {
              depth--;
            }
            if (top) {
              qn++;
              qh = (Math.imul(qh, 31) + num(r)) | 0;
            }
            return r;
          };
        }
        const step = f.step;
        f.step = function (...a) {
          inStep = true;
          steps++;
          try {
            return step.apply(this, a);
          } finally {
            inStep = false;
          }
        };
        const onRegion = c.onRegion;
        c.onRegion = function (msg) {
          const p = c.pending.get(msg.id);
          ev('resp', msg.id, p ? p.key : null, msg.lod, msg.tiles ? msg.tiles.length : -1, msg.error ? 1 : 0, Math.round(performance.now()));
          return onRegion.call(this, msg);
        };
        const wrap = (name, say) => {
          const fn = c[name];
          if (typeof fn === 'function')
            c[name] = function (...a) {
              ev(name, ...say(...a));
              return fn.apply(this, a);
            };
        };
        wrap('addTile', (t, coarse) => [`${t.tx},${t.tz}`, coarse ? 1 : 0]);
        wrap('prepTile', (t) => [`${t.tx},${t.tz}`]);
        wrap('swapRegion', (key, msg) => [key, msg.lod]);
        wrap('buildRegionMesh', (key) => [key]);
        wrap('unloadRegion', (rx, rz) => [`${rx},${rz}`]);
        wrap('stampProp', (p) => [Math.round(p.clear.cx), Math.round(p.clear.cz)]);
        wrap('raiseRoof', (r, top) => [Math.round(r.cx), Math.round(r.cz), top]);
        wrap('growTo', (ref, level) => [ref.index, level]);
        const barf = v.barfAtLatLon;
        v.barfAtLatLon = (...a) => (ev('barf', ...a), barf(...a));
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) ev('res', e.name.replace(location.origin, '').slice(0, 96), Math.round(e.startTime), Math.round(e.responseEnd));
          }).observe({ type: 'resource', buffered: true });
        } catch {
          // (no resource timing: the arrivals the city reports still are)
        }
        T.cols = ['n', 't', 'dt', 'held', 'running', 'steps', 'qn', 'qh', 'draws', 'x', 'y', 'z', 'heading', 'speed', 'vy', 'nose', 'mode', 'onPath', 'pathVy', 'vyYoke', 'yawRate', 'yawAcc', 'bank', 'pitch', 'floorY', 'floorRise', 'floorSmooth', 'holdY', 'targetY', 'groundUnder', 'obstacleUnder', 'groundBroad', 'lift', 'height', 'strain', 'glideSpeed', 'barfT', 'fullness', 'relief', 'speedScale', 'surge', 'tbFloor', 'tbSpeed', 'tbRate', 'tbCeiling', 'tbYaw', 'qaSx', 'qaSy', 'qaHoldAt', 'camX', 'camY', 'camZ', 'hfov', 'viewHeight', 'viewX', 'viewZ', 'detailScale', 'detailHold', 'eager', 'busy', 'pending', 'adopt', 'farBusy', 'farLanding', 'poolAt', 'poolTiles', 'regions', 'tiles', 'groundQueued', 'farLate', 'wall', 'sites'];
        // (the requests an update made: every call's, the warm-up's too)
        T.reqs = () => {
          for (; c.nextId !== undefined && lastId < c.nextId; lastId++) {
            const q = c.pending.get(lastId);
            ev('req', lastId, q ? q.key : null, q ? q.lod : -1);
          }
        };
        T.frame = (held) => {
          T.n++;
          const t = g.clock(), tb = f.turbo, p = cam.position, qa = window.__qa || {};
          T.f.push([T.n, t, t - lastT, held ? 1 : 0, window.__detRunning ? 1 : 0, steps, qn, qh, T.draws, f.x, f.y, f.z, f.heading, f.speed, f.vy, f.nose, f.mode, f.onPath ? 1 : 0, f.pathVy, f.vyYoke, f.yawRate, f.yawAcc, f.bank, f.pitch, f.floorY, f.floorRise, f.floorSmooth, f.holdY, f.targetY, f.groundUnder, f.obstacleUnder, f.groundBroad, f.lift, f.height, f.strain, f.glideSpeed, f.barfT, f.fullness, f.relief, f.speedScale, f.surge, tb.floor, tb.speed, tb.rate, tb.ceiling, tb.yaw, qa.sx ?? null, qa.sy ?? null, qa.holdAt ?? null, p.x, p.y, p.z, rig.hfov, c.viewHeight, c.viewX, c.viewZ, c.detailScale, c.detailHold ? 1 : 0, c.eager ? 1 : 0, c.busy ? 1 : 0, c.pending.size, c.adopt.length, c.farBusy ? 1 : 0, c.farLanding ? c.farLanding.length : 0, c.poolAt ?? 0, c.poolTiles ? c.poolTiles.length : 0, c.regionsLoaded.size, c.tiles.size, c.ground.queued, c.farLate ? 1 : 0, Math.round(performance.now()), T.sites]);
          lastT = t;
          steps = qn = qh = T.draws = 0;
          if (T.sites) T.sites = {};
        };
      };
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((t) => (seed(), cb(t)));
      // the game clock stands from the first frame (frames run at dt 0): the city streams in with the bus still
      // at its spawn (a build from before the tilt went stands on its motion sheet's status: MAIN vs NEXT still runs)
      const freeze = (c, on) => {
        c.frozen = on;
        if (c.tilt) c.tilt.status = on ? 'requesting' : 'off';
      };
      window.__freeze = (on) => freeze(g.controls, on);
      Object.defineProperty(window, '__game', {
        configurable: true,
        get: () => g,
        set: (v) => {
          g = v;
          freeze(v.controls, true);
          if (T) hooks(v);
          if (jit) jitter(v.city);
          // (while it runs, the clock stands whenever regions are on their way: streaming lands at the same game
          // time on any machine, and a query that fell back to the far grid here can't move the camera a hair)
          const update = v.city.update;
          v.city.update = function (...a) {
            // (the frame's own call has no adoption budget: the warm-up's has)
            const own = a.length < 4, held = v.controls.frozen;
            if (T) T.upd = true;
            update.apply(this, a);
            if (T) T.upd = false;
            seed();
            if (window.__detRunning) freeze(v.controls, this.busy);
            if (T) T.reqs();
            if (T && own) T.frame(held);
          };
        },
      });
    }, { tr: trace, jit: opt.jitter ?? null });
    query += `&fixeddt=${STEP}`;
  }
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  if (opt.set)
    await page.evaluate((list) => {
      for (const kv of list.split(',')) {
        const [path, v] = kv.split(':');
        const ks = path.split('.');
        ks.slice(0, -1).reduce((a, k) => a[k], window.__game.config)[ks[ks.length - 1]] = Number(v);
      }
    }, opt.set);
  if (det) await settle(page);
  if (det)
    await page.evaluate(() => {
      window.__qa = {};
      const g = window.__game;
      g.splatter.nextHue = 0;
      g.splatter.seed = 0x5eed1234;
      // (what the first steps remember of how the city arrived: both take the settled ground from here, at the spawn)
      g.flight.floorRise = NaN;
      g.flight.groundBroad = NaN;
      return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
    });
  return page;
}

// --det: what the next run starts with (the stick, the glide, a breath), handed to the game in the task that starts the clock.
// A frame with the clock standing still steps the flight at dt 0, and that step still decides: a push there enters the dive's path
// before the speed's first step instead of after it (Flight.step), so the swap shot's dive started 0.65 m/s apart and the shot came
// out a pixel over. Set in an evaluate of its own, whether such a frame ran before the clock did was the machine's timing.
const staged = new Map();
const stage = (page, ...op) => (staged.get(page) ?? staged.set(page, []).get(page)).push(op);
const glide = (page, v) => stage(page, 'glide', v);
const stick = (page, sy, sx = 0) => stage(page, 'stick', sx, sy);
const unstick = (page) => stage(page, 'unstick');
const barf = (page, lat, lon) => stage(page, 'barf', lat, lon);
/** n frames, with the clock as it is */
const frames = (page, n) => page.evaluate((k) => new Promise((res) => requestAnimationFrame(function f() { if (--k > 0) requestAnimationFrame(f); else res(null); })), n);

// --det: the clock runs to exactly `seconds` later (frame-exact on the fixed step), then stands again. It starts with the city quiet
// (it stands whenever the city is busy, from the start too), and the run's inputs land in that same task. After it, two frames with
// the clock standing, every time: such a frame still steps the flight at dt 0 and can settle something there (a dive's path at the
// height it reached), so whether one runs before the next evaluate mustn't be the machine's timing either. --gap=<n>: n more frames
// standing before each run, to show the run doesn't care.
async function runDet(page, seconds) {
  const ops = staged.get(page) ?? [];
  staged.delete(page);
  if (Number(opt.gap) > 0) await frames(page, Number(opt.gap));
  await page.evaluate(
    ({ s, ops }) =>
      new Promise((res) => {
        const g = window.__game, qa = window.__qa;
        const go = () => {
          if (g.city.busy) return requestAnimationFrame(go);
          for (const [k, a, b] of ops) {
            if (k === 'glide') g.flight.glideSpeed = a;
            else if (k === 'stick') Object.assign(qa, { sx: a, sy: b });
            else if (k === 'unstick') delete qa.sx, delete qa.sy;
            else if (k === 'barf') g.barfAtLatLon(a, b);
          }
          qa.held = false;
          qa.holdAt = g.clock() + s;
          window.__freeze(false);
          window.__detRunning = true;
          res(null);
        };
        go();
      }),
    { s: seconds, ops },
  );
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 300000, polling: 50 });
  await page.evaluate(() => {
    window.__detRunning = false;
    window.__freeze(true);
    window.__qa.holdAt = undefined;
    window.__qa.held = false;
  });
  await frames(page, 2);
}

// --det: with the clock standing, streaming and the ground paint finish (quiet for 30 frames in a row: a region's
// next batch is only asked for a frame after the last one lands), then a few frames
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((res) => {
        const g = window.__game;
        let quiet = 0;
        const tick = () => {
          quiet = !g.city.busy && g.city.ground.queued === 0 ? quiet + 1 : 0;
          if (quiet >= 30) res(null);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  await page.waitForTimeout(200);
}

// let the game run for `seconds` of simulated time (SwiftShader is slow; we
// wait on the game's own clock instead of wall time)
async function runFor(page, seconds) {
  const t0 = await page.evaluate(() => window.__game.flight && performance.now());
  await page.evaluate(
    (s) =>
      new Promise((res) => {
        const g = window.__game;
        const start = g.clock();
        const tick = () => (g.clock() - start >= s ? res(null) : requestAnimationFrame(tick));
        tick();
      }),
    seconds,
  );
  return t0;
}

// A slow drift at the rooftops (the thumb's down-stretch is the yoke's climb
// now, so the shots slow the bus with the opening's glide speed instead; same
// speeds as the old hover stretch: -0.45 -> 19.2 m/s, -1 -> 6 m/s).
const drift = (page, speed) => page.evaluate((v) => ((window.__qa = null), (window.__game.flight.glideSpeed = v)), speed);

const views = new Set((opt.views ?? (det ? 'grey,painted,opening,fidi,soma,high,ceiling,swap' : 'grey,painted,opening')).split(','));

async function detShot(name, query, script) {
  if (!views.has(name)) return;
  const page = await open(query);
  await script(page);
  await settle(page);
  // (tree levels of detail tick on the game clock: what streamed in while it stood takes its level now)
  await runDet(page, 0.3);
  await settle(page);
  await page.screenshot({ path: `${out}/${name}.png` });
  if ('seq' in opt) {
    await page.screenshot({ path: `${out}/${name}-seq-0.png` });
    for (let i = 1; i <= 5; i++) {
      await runDet(page, STEP);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/${name}-seq-${i}.png` });
    }
  }
  if ('pan' in opt) {
    stick(page, 0, 0.6);
    await runDet(page, 0.6);
    for (let i = 0; i <= 5; i++) {
      if (i) await runDet(page, STEP);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/${name}-pan-${i}.png` });
    }
    unstick(page);
  }
  if ('descent' in opt) {
    stick(page, 1);
    for (let i = 0; i < 80; i++) {
      await runDet(page, 0.5);
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${out}/${name}-descent-${String(i).padStart(2, '0')}.png` });
      if (i === 6)
        for (let k = 0; k <= 5; k++) {
          if (k) await runDet(page, STEP);
          await page.waitForTimeout(200);
          await page.screenshot({ path: `${out}/${name}-dive-${k}.png` });
        }
      if (await page.evaluate(() => window.__game.flight.mode === 0)) break;
    }
    unstick(page);
  }
  staged.delete(page);
  stats[name] = await page.evaluate(() => {
    const r = window.__game.pipeline.renderer.info;
    const g = window.__game, f = g.flight, p = g.pipeline;
    return { clock: g.clock(), y: f.y, x: f.x, z: f.z, heading: f.heading, groundBroad: f.groundBroad, cam: g.camera.position.toArray(), focus: p.focus.toArray(), sub: p.subPixel.toArray(), snapLevel: p.snapLevel, regions: g.city.regionsLoaded.size, tiles: g.city.tiles.size, lods: [...g.city.regionLod.entries()].sort().join(' '), maskSum: g.city.loadedMask.image.data.reduce((a, b) => a + b, 0) };
  });
  // (Infinity and NaN as strings: JSON has neither)
  if (trace) writeFileSync(`${out}/${name}-trace.json`, await page.evaluate(() => JSON.stringify(window.__trace, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v))));
  await page.close();
  console.log('shot', name);
}

if (det) {
  // (glide, stick, unstick and barf are staged: the next runDet hands them over as its clock starts)
  await detShot('grey', '?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud', async (p) => {
    glide(p, 19.2);
    await runDet(p, 3);
  });
  await detShot('painted', '?lat=37.77615&lon=-122.4340&heading=88&skipintro&nohud', async (p) => {
    glide(p, 6);
    await runDet(p, 2);
    for (const lat of [37.7754, 37.7758, 37.7762, 37.7766, 37.777, 37.7762, 37.7758]) {
      barf(p, lat, -122.43262);
      await runDet(p, 1.3);
    }
    await runDet(p, 2.5);
  });
  await detShot('opening', '?openingshot&nohud', (p) => runDet(p, 4.5));
  await detShot('fidi', '?lat=37.7925&lon=-122.4010&heading=0&skipintro&nohud', async (p) => {
    glide(p, 19.2);
    await runDet(p, 3);
  });
  await detShot('soma', '?lat=37.782&lon=-122.399&heading=330&skipintro&nohud', async (p) => {
    glide(p, 19.2);
    await runDet(p, 3);
  });
  await detShot('high', '?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud', async (p) => {
    await runDet(p, 1);
    stick(p, -1);
    await runDet(p, 6.5);
    unstick(p);
    await runDet(p, 1);
  });
  await detShot('ceiling', '?lat=37.7925&lon=-122.4010&heading=0&skipintro&nohud', async (p) => {
    await runDet(p, 1);
    stick(p, -1);
    await runDet(p, 16);
    unstick(p);
    await runDet(p, 1);
  });
  const ceilingAt = async (p) => {
    await runDet(p, 1);
    stick(p, -1);
    await runDet(p, 16);
    unstick(p);
    await runDet(p, 1);
  };
  await detShot('sunset', '?lat=37.7530&lon=-122.4950&heading=90&skipintro&nohud', ceilingAt);
  await detShot('presidio', '?lat=37.7990&lon=-122.4660&heading=180&skipintro&nohud', ceilingAt);
  await detShot('downtown', '?lat=37.7700&lon=-122.4300&heading=45&skipintro&nohud', ceilingAt);
  await detShot('marin', '?lat=37.8020&lon=-122.4650&heading=330&skipintro&nohud', ceilingAt);
  await detShot('sunward', '?lat=37.7600&lon=-122.5000&heading=292&skipintro&nohud', ceilingAt);
  await detShot('westward', '?lat=37.7880&lon=-122.3990&heading=280&skipintro&nohud', ceilingAt);
  await detShot('headn', '?lat=37.8300&lon=-122.4780&heading=0&skipintro&nohud', ceilingAt);
  await detShot('southn', '?lat=37.7250&lon=-122.4300&heading=180&skipintro&nohud', ceilingAt);
  await detShot('north', '?lat=37.8440&lon=-122.4950&heading=15&skipintro&nohud', ceilingAt);
  await detShot('corner', '?lat=37.7600&lon=-122.5000&heading=322&skipintro&nohud', ceilingAt);
  await detShot('corner2', '?lat=37.7300&lon=-122.5100&heading=235&skipintro&nohud', ceilingAt);
  await detShot('london', '?city=london&lat=51.5073&lon=-0.1657&heading=90&skipintro&nohud', ceilingAt);
  await detShot('amsterdam', '?city=amsterdam&lat=52.3738&lon=4.8775&heading=75&skipintro&nohud', ceilingAt);
  const SUNS = [['day', {}], ['high', { 'light.sunElevation': 1.309 }], ['low', { 'light.sunElevation': 0.0873 }], ['night', { 'light.sunStrength': 0.04, 'far.blockLit': 0.3 }]];
  if (opt.vary) SUNS.push(...Object.entries(JSON.parse(opt.vary)));
  const sunShots = async (p, name, tag) => {
    for (const [sun, set] of SUNS) {
      await p.evaluate((v) => {
        const g = window.__game;
        window.__undo = [];
        for (const [path, x] of Object.entries(v)) {
          const ks = path.split('.');
          const o = ks.slice(0, -1).reduce((a, k) => a[k], g.config);
          window.__undo.push([o, ks[ks.length - 1], o[ks[ks.length - 1]]]);
          o[ks[ks.length - 1]] = x;
        }
        g.renderAgain();
        return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
      }, set);
      await p.waitForTimeout(200);
      await p.screenshot({ path: `${out}/${name}-${sun}-${tag}.png` });
      await p.evaluate(() => {
        for (const [o, k, v] of window.__undo) o[k] = v;
        window.__game.renderAgain();
      });
    }
  };
  const holdSwap = (name, start) =>
    detShot(name, `${start}&loadr=1`, async (p) => {
      await ceilingAt(p);
      await settle(p);
      await sunShots(p, name, 0);
      stats[`${name}-regions`] = [await p.evaluate(() => window.__game.city.regionsLoaded.size)];
      await p.evaluate(() => (window.__game.config.city.loadRadiusHigh = 1900));
      await settle(p);
      await sunShots(p, name, 1);
      stats[`${name}-regions`].push(await p.evaluate(() => window.__game.city.regionsLoaded.size));
    });
  await holdSwap('hold-sunset', '?lat=37.7530&lon=-122.4950&heading=90&skipintro&nohud');
  await holdSwap('hold-presidio', '?lat=37.7990&lon=-122.4660&heading=180&skipintro&nohud');
  await holdSwap('hold-downtown', '?lat=37.7700&lon=-122.4300&heading=45&skipintro&nohud');
  await detShot('swap', '?lat=37.7820&lon=-122.4010&heading=0&skipintro&nohud', async (p) => {
    glide(p, 6);
    await runDet(p, 1);
    // three blasts on the towers ahead (rooftop gardens, domes), up out of detail, down into it again, stopping short of them
    for (let i = 0; i < 3; i++) {
      barf(p, 37.7925, -122.401);
      await runDet(p, 2.5);
    }
    stick(p, -1);
    await runDet(p, 9);
    stick(p, 1);
    await runDet(p, 7);
    unstick(p);
    glide(p, 6);
    await runDet(p, 1);
  });
  writeFileSync(`${out}/stats.json`, JSON.stringify(stats, null, 2));
  await browser.close();
  console.log('shots saved to', out);
  process.exit(0);
}

// 1) grey city: drifting over Alamo Square, looking east at the Painted Ladies
//    row with downtown behind it in the fog
{
  const page = await open('?lat=37.77628&lon=-122.4352&heading=88&skipintro&nohud');
  await drift(page, 19.2);
  await runFor(page, 3);
  await page.screenshot({ path: `${out}/grey.png` });
  stats.grey = await page.evaluate(() => window.__stats ?? null);
  await page.close();
}

// 2) painted: drift slowly over Steiner Street and barf down the Painted Ladies
//    row through the real splat pipeline (cascade, bloom, sign, sound)
{
  const page = await open('?lat=37.77615&lon=-122.4340&heading=88&skipintro&nohud');
  await drift(page, 6);
  await runFor(page, 2);
  const row = [37.7754, 37.7758, 37.7762, 37.7766, 37.7770, 37.7762, 37.7758];
  for (const lat of row) {
    await page.evaluate((la) => window.__game.barfAtLatLon(la, -122.43262), lat);
    await runFor(page, 1.3);
  }
  await runFor(page, 2.5);
  await page.screenshot({ path: `${out}/painted.png` });
  stats.painted = await page.evaluate(() => window.__stats ?? null);
  await page.close();
}

// 3) the opening: fog bank west of the Golden Gate
{
  const page = await open('?openingshot&nohud');
  await runFor(page, 4.5);
  await page.screenshot({ path: `${out}/opening.png` });
  await page.close();
}

writeFileSync(`${out}/stats.json`, JSON.stringify(stats, null, 2));
await browser.close();
console.log('shots saved to', out);
