#!/usr/bin/env node
// The real bus over ?moon, painting: the real stick (window.__qa) and the real tap, at a fixed step, frames taken with the loop frozen.
//   node tools/moon/paint.mjs <out dir> [--script=one,two] [--dt=0.033333] [--q=site=TYCHO] [--keep]
// Each script is a flight in SCRIPTS below. A frame is 393 x 852 game pixels, one PNG pixel each. BASE is the page (http://localhost:4179/). --keep leaves what's saved on the device from one script to the next.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from '../browser.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || '1']));
const out = pos[0] ?? 'shots/local/moonlow/paint/try';
const base = process.env.BASE ?? 'http://localhost:4179/';
const DT = Number(opt.dt ?? 1 / 30);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(browserOptions(['--enable-webgl']));
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('404') && !m.text().includes('GPU stall') && !m.text().includes('did not converge')) errors.push(m.text().slice(0, 900));
});

const open = async (q = '') => {
  await page.goto(`${base}?moon&fixeddt=${DT.toFixed(6)}${opt.hud ? '' : '&nohud'}${opt.q ? '&' + opt.q : ''}${q ? '&' + q : ''}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 300000 });
  await page.evaluate(() => {
    const g = window.__game, info = g.pipeline.renderer.info;
    window.__qa = { holdFrames: 0 };
    window.__programs0 = g.pipeline.renderer.info.programs.length;
    window.__names0 = new Set(g.pipeline.renderer.info.programs.map((p) => p.cacheKey));
    info.autoReset = false;
    const f = g.perf.frame.bind(g.perf);
    window.__stats = { calls: 0, triangles: 0 };
    g.perf.frame = (a, b) => {
      window.__stats = { calls: info.render.calls, triangles: info.render.triangles };
      info.reset();
      f(a, b);
    };
  });
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 120000 });
};
const run = async (secs) => {
  const n = Math.max(1, Math.round(secs / DT));
  await page.evaluate((k) => {
    window.__qa = { ...window.__qa, holdFrames: k, held: false };
  }, n);
  await page.waitForFunction(() => window.__qa.held === true, null, { timeout: 600000 });
};
const stick = (sx, sy) => page.evaluate(([x, y]) => Object.assign(window.__qa, { sx: x, sy: y }), [sx, sy]);
const letGo = () => page.evaluate(() => {
  delete window.__qa.sx;
  delete window.__qa.sy;
});
/** Up or down the ladder a flick at a time to a gear: Cruise 0, Express 1, Nonstop 2, Jet 3. */
const gear = (n) => page.evaluate((k) => {
  const g = window.__game;
  for (let i = 0; i < 8 && g.controls.turbo.gear !== k; i++) g.input.onTurbo(g.controls.turbo.gear < k ? 1 : -1);
}, n);
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const state = () => page.evaluate(() => {
  const g = window.__game, f = g.flight, p = g.moon.paint, t = p.target, r = (x, k = 1) => +x.toFixed(k);
  return { t: r(g.clock(), 2), x: r(f.x, 0), z: r(f.z, 0), h: r(f.y - g.city.groundAt(f.x, f.z)), speed: r(f.speed), target: t ? { id: t.id, r: r(t.r), level: t.rec?.level ?? 0, name: t.name, x: r(t.x, 0), z: r(t.z, 0) } : null, list: p.listed, recs: p.recs.size, live: p.liveCount, rim: p.rim?.count, ...window.__stats, sign: g.lastSign()?.text ?? null };
});
const log = [];
const note = async (tag) => {
  const s = await state();
  log.push({ tag, ...s });
  console.log(tag.padEnd(16), JSON.stringify(s));
  return s;
};
/** Fills the belly and taps, as the thumb does. */
const tap = () => page.evaluate(() => {
  const g = window.__game;
  g.flight.fullness = 1;
  g.tapSplat();
});
const fill = () => page.evaluate(() => (window.__game.flight.fullness = 1));
/** Waits, belly full, until a crater glints. */
const glint = async (secs = 6) => {
  await fill();
  for (let t = 0; t < secs; t += 0.2) {
    await run(0.2);
    if (await page.evaluate(() => !!window.__game.moon.paint.target)) return true;
  }
  return false;
};
/** A strip of frames: `every` s apart, `n` of them. */
const strip = async (tag, n, every) => {
  for (let i = 1; i <= n; i++) {
    await run(every);
    await note(`${tag}-${i}`);
    await shot(`${tag}-${String(i).padStart(2, '0')}`);
  }
};
/** Clear the device between scripts. */
const wipe = () => page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('strugglebus.moon') || k.startsWith('strugglebus.ground')) localStorage.removeItem(k);
});

const SCRIPTS = {
  /** The start: tap what glints three times, watching it land. */
  async three() {
    await open();
    await run(1);
    await glint();
    await note('glint');
    await shot('glint');
    for (let k = 1; k <= 3; k++) {
      await tap();
      await strip(`hit${k}`, 8, 0.4);
      await glint(2);
    }
    console.log(JSON.stringify(await page.evaluate(() => [...window.__game.moon.paint.recs.values()].slice(0, 20).map((r) => ({ id: r.id, r: r.r, level: r.level, hue: r.hue })))));
  },
  /** Turn round and look at what was painted, from height. */
  async back() {
    await open();
    await run(1);
    for (let k = 0; k < 5; k++) {
      await glint();
      await tap();
      await run(2.5);
    }
    await stick(0, -1);
    await strip('rise', 6, 1.5);
    await letGo();
    await shot('rise-end');
  },
};

/** Finds a crater near this size around (x, z): returns { id, x, z, r }. */
const find = (x, z, r, spread) => page.evaluate(([x, z, r, spread]) => {
  const list = window.__game.moon.cratersNear(x, z, spread, r * 1.4).filter((c) => c.r > r * 0.8 && c.r < r * 1.3 && c.age < 2 && !c.name);
  list.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  return list[0] ?? null;
}, [x, z, r, spread]);
/** The bus held `back` m short of a place, `up` m over the ground there, nose at it. */
const pose = (x, z, back, up, az = 0) => page.evaluate(([x, z, back, up, az]) => {
  const g = window.__game, h = (az * Math.PI) / 180, bx = x - Math.sin(h) * back, bz = z + Math.cos(h) * back;
  window.__qa.topDown = null;
  window.__qa.pin = { x: bx, z: bz, y: g.city.groundAt(bx, bz) + up, heading: h };
}, [x, z, back, up, az]);
const settle = async (secs = 2) => {
  for (let k = 0; k < 120; k++) {
    await run(0.4);
    if (await page.evaluate(() => window.__shotReady === true)) break;
  }
  await run(secs);
};
/** One crater at each level: frames from where a player would see it. */
const levels = async (tag, c, back, up, az) => {
  await pose(c.x, c.z, back, up, az);
  await settle();
  await shot(`${tag}-0`);
  for (let l = 1; l <= 3; l++) {
    await page.evaluate(([id, l]) => window.__game.moon.paint.qaHit(id, window.__game.clock(), l), [c.id, l]);
    await run(l === 3 ? 3.6 : 3);
    await note(`${tag}-${l}`);
    await shot(`${tag}-${l}`);
  }
};

SCRIPTS.gallery = async () => {
  await open();
  const st = await page.evaluate(() => {
    const g = window.__game, f = g.flight;
    return { x: f.x, z: f.z, h: f.heading };
  });
  const az = (st.h * 180) / Math.PI;
  const ahead = (d) => [st.x + Math.sin(st.h) * d, st.z - Math.cos(st.h) * d];
  for (const [tag, r, back, up] of [['r20', 20, 110, 26], ['r60', 60, 220, 40], ['r160', 160, 480, 90], ['r500', 500, 1400, 300], ['r1800', 1800, 5000, 1400]]) {
    const [x, z] = ahead(back + 200);
    const c = await find(x, z, r, Math.max(3000, r * 8));
    console.log(tag, JSON.stringify(c));
    if (c) await levels(tag, c, back, up, az);
  }
};

/** Taps whenever something glints and the belly is full, as a player would, for `secs`, a frame every `every` s. */
const playFor = async (tag, secs, every, step = 0.2) => {
  let shots = 0, next = every, n = 0;
  for (let t = 0; t < secs; t += step) {
    await run(step);
    shots += await page.evaluate(() => {
      const g = window.__game;
      if (!g.moon.paint.target || g.flight.fullness < 0.999 || g.flight.barfT >= 0) return 0;
      g.tapSplat();
      return 1;
    });
    if (t + step >= next) {
      next += every;
      await note(`${tag}-${++n}`);
      await shot(`${tag}-${String(n).padStart(2, '0')}`);
    }
  }
  console.log(tag, 'shots', shots);
};

SCRIPTS.play = async () => {
  await open();
  await run(1);
  await playFor('cruise', 30, 5);
  await stick(0, 0.9);
  await playFor('surge', 20, 5);
  await letGo();
  await stick(0.9, 0);
  await run(3.2);
  await letGo();
  await playFor('after', 10, 5);
};

SCRIPTS.high = async () => {
  await open();
  await run(1);
  await gear(3);
  await stick(0, -1);
  await run(10);
  await gear(0);
  await letGo();
  await run(3);
  await playFor('km3', 18, 3);
  await gear(3);
  await stick(0, -1);
  await run(14);
  await gear(0);
  await letGo();
  await run(3);
  await playFor('km10', 18, 3);
  await page.evaluate(() => (window.__game.flight.heading = 2.6));
  await run(2);
  await playFor('km10b', 15, 3);
};

/** Straight down on a map point, from this high. */
const top = async (name, x, z, h) => {
  await page.evaluate(([x, z, h]) => {
    const g = window.__game, o = g.moon.manifest.origin, c = Math.cos((o[0] * Math.PI) / 180);
    // (qa.topDown takes a place: the game's flat degrees back from these metres)
    const m = 111320;
    window.__qa.topDown = { lat: o[0] - z / m, lon: o[1] + x / (m * c), height: h };
    window.__qa.pin = { x, z, y: g.city.groundAt(x, z) + 60, heading: 0 };
  }, [x, z, h]);
  await settle(1.5);
  await shot(name);
};

/** Top-down look at a place, from this high, the windows as they stand. */
const above = async (name, x, z, h) => {
  await page.evaluate(([x, z, h]) => {
    const g = window.__game;
    window.__qa.pin = { x, z: z + h * 0.32, y: g.city.groundAt(x, z) + h, heading: 0 };
  }, [x, z, h]);
  await settle(1.5);
  await shot(name);
};

/** A crewed site: its circle, its sign, a crater flooded across it. */
SCRIPTS.apollo = async () => {
  await open('site=APOLLO%2011');
  await run(2);
  await note('start');
  await shot('site-start');
  const hits = await page.evaluate(() => {
    const g = window.__game, list = g.moon.cratersNear(0, 0, 1500, 300).filter((c) => !c.name).slice(0, 6);
    for (const c of list) g.moon.paint.qaHit(c.id, g.clock(), 1), g.moon.paint.qaHit(c.id, g.clock(), 2);
    return list;
  });
  console.log(JSON.stringify(hits));
  await page.evaluate(() => {
    const g = window.__game, c = g.moon.cratersNear(0, 0, 1500, 300).find((c) => !c.name);
    if (c) g.moon.paint.qaHit(c.id, g.clock(), 3);
  });
  await run(3.5);
  await shot('site-low');
  await top('site-top', 0, 0, 5200);
  await top('site-top2', 1000, 300, 2200);
  await note('high');
};

/** The whole of a named crater, from straight above, at each level. */
SCRIPTS.named = async () => {
  await open();
  await run(1);
  const id = await page.evaluate(() => 'p' + window.__game.moon.places.find((p) => p.name === 'THEOPHILUS').id);
  await top('th-0', 0, 0, 230000);
  for (let l = 1; l <= 3; l++) {
    await page.evaluate(([id, l]) => window.__game.moon.paint.qaHit(id, window.__game.clock(), l), [id, l]);
    await run(3.4);
    await shot(`th-${l}`);
  }
};

/** Paint, leave, come back: what's saved stands. */
SCRIPTS.saved = async () => {
  await open();
  await run(1);
  for (let k = 0; k < 4; k++) {
    await glint();
    await tap();
    await run(2.5);
  }
  const a = await page.evaluate(() => {
    const g = window.__game;
    g.moon.paint.save();
    return { recs: g.moon.paint.recs.size, sample: [...g.moon.paint.recs.values()].slice(0, 3).map((r) => [r.id, r.level, r.hue]) };
  });
  await shot('saved-before');
  await open();
  await run(1);
  await shot('saved-after');
  const b = await page.evaluate(() => {
    const g = window.__game;
    return { recs: g.moon.paint.recs.size, sample: [...g.moon.paint.recs.values()].slice(0, 3).map((r) => [r.id, r.level, r.hue]), bytes: localStorage.getItem('strugglebus.moon.craters.v1')?.length };
  });
  console.log(JSON.stringify({ a, b }));
  // and on another map of the Moon: the same crater, the same paint
  await open('lat=-11.2&lon=26.2');
  await run(1);
  const c = await page.evaluate(() => window.__game.moon.paint.recs.size);
  console.log('another map', c);
};

/** A crater of this size ahead, the bus coming up to it at a cruise, and three hits, every step of them. */
SCRIPTS.close = async () => {
  await open();
  await run(1);
  const f0 = await page.evaluate(() => {
    const g = window.__game, f = g.flight;
    return { x: f.x, z: f.z, h: f.heading };
  });
  const size = Number(opt.r ?? 40);
  const c = await find(f0.x + Math.sin(f0.h) * 700, f0.z - Math.cos(f0.h) * 700, size, 1500);
  console.log(JSON.stringify(c));
  // (on the line to it, at the distance a tap would be made from)
  const az = (Math.atan2(c.x - f0.x, f0.z - c.z) * 180) / Math.PI, back = 95 + size * 0.7;
  for (let k = 1; k <= 3; k++) {
    await pose(c.x, c.z, back, 20 + size * 0.15, az);
    await settle(1);
    await fill();
    await run(0.6);
    await shot(`c${k}-00`);
    await note(`aim${k}`);
    await page.evaluate(() => (delete window.__qa.pin, window.__game.tapSplat()));
    await strip(`c${k}`, 14, 0.2);
  }
};

/** The super splat, both ways, over craters. */
SCRIPTS.super = async () => {
  await open();
  await run(2);
  const need = await page.evaluate(() => window.__game.config.splat.superCharge);
  await glint();
  await page.evaluate((c) => window.__game.superSplat(c * 0.6), need);
  await strip('mega', 10, 0.5);
  await page.evaluate(() => window.__game.superSkip(100));
  await run(1);
  await glint();
  await page.evaluate((c) => window.__game.superSplat(c * 1.05), need);
  await strip('hose', 16, 0.5);
  console.log(JSON.stringify(await page.evaluate(() => window.__game.superState())));
};

/** How steady the glint is: what it picks, every frame, over a stretch of straight flight. */
SCRIPTS.steady = async () => {
  await open();
  await run(1);
  await fill();
  const seen = [];
  for (const [tag, sy, secs] of [['cruise', 0, 30], ['surge', 0.9, 20]]) {
    await stick(0, sy);
    if (sy === 0) await letGo();
    let last = null, changes = 0, none = 0, n = 0;
    for (let t = 0; t < secs; t += 0.1) {
      await run(0.1);
      const id = await page.evaluate(() => {
        const g = window.__game, c = g.moon.paint.target;
        g.flight.fullness = 1;
        return c ? `${c.id} ${c.r.toFixed(0)}` : null;
      });
      n++;
      if (!id) none++;
      if (id !== last) {
        changes++;
        if (seen.length < 40) seen.push(id);
      }
      last = id;
    }
    console.log(tag, { samples: n, changes, none, secs });
  }
  console.log(seen.join(' | '));
};

/** Blasts on open ground, from down there and from high over them. */
SCRIPTS.strokes = async () => {
  await open('lat=8.5&lon=31');
  await run(1);
  for (let k = 0; k < 6; k++) {
    await tap();
    await run(1.3);
    await shot(`st-a${k}`);
    await run(1.3);
    await shot(`st-b${k}`);
  }
  await shot('st-low');
  console.log(JSON.stringify(await page.evaluate(() => {
    const g = window.__game, s = g.lastShot(), a = s?.aim;
    return { shot: s, landed: g.city.ground.landedCount, tiles: g.city.ground.tileCount, queued: g.city.ground.queued, sample: a ? g.city.ground.sample(a[0], a[2]) : null, strokes: JSON.parse(localStorage.getItem('strugglebus.moon.strokes.v1') ?? '[]').length, recs: g.moon.paint.recs.size, site: a ? g.moon.paint.inSite(a[0], a[2]) : null };
  })));
  const c = await page.evaluate(() => {
    const s = window.__game.moon.paint.strokes, m = s[s.length >> 1];
    return { x: m.x, z: m.z };
  });
  await top('st-1', c.x, c.z, 900);
  await top('st-2', c.x, c.z, 3000);
  await top('st-3', c.x, c.z, 9000);
};

/** A minute of painting, and a look back along it from up high. */
SCRIPTS.trail = async () => {
  await open();
  await run(1);
  await playFor('t-cruise', 36, 12);
  await stick(0, 0.9);
  await playFor('t-surge', 24, 12);
  await letGo();
  const c = await page.evaluate(() => {
    const g = window.__game, r = [...g.moon.paint.recs.values()], m = r[r.length >> 1], f = g.flight;
    return { x: m.x, z: m.z, bx: f.x, bz: f.z, n: r.length, h: (f.heading * 180) / Math.PI };
  });
  console.log(JSON.stringify(c));
  await top('t-top', c.x, c.z, 900);
  await pose(c.x, c.z, 700, 260, c.h + 180);
  await settle(2);
  await shot('t-back300');
  await pose(c.x, c.z, 1500, 900, c.h + 180);
  await settle(2);
  await shot('t-back1k');
  await pose(c.x, c.z, 5000, 3000, c.h + 180);
  await settle(2);
  await note('t-back3k');
  await shot('t-back3k');
};

/** A long one, every gear: nothing breaks, nothing piles up. */
SCRIPTS.soak = async () => {
  await open();
  await run(1);
  await playFor('s-cruise', 40, 20);
  await stick(0.25, 0.9);
  await playFor('s-surge', 40, 20);
  await letGo();
  await gear(3);
  await stick(0, -0.5);
  await run(6);
  await letGo();
  await playFor('s-jet', 40, 20);
  await stick(0.4, 0);
  await playFor('s-jet-turn', 20, 20);
  await gear(0);
  await letGo();
  await stick(0, 1);
  await playFor('s-down', 30, 15);
  await letGo();
  console.log(JSON.stringify(await page.evaluate(() => {
    const g = window.__game, p = g.moon.paint;
    let rocks = 0, painted = 0;
    g.scene.traverse((o) => {
      if (o.isInstancedMesh && o.geometry.getAttribute('position').count === 60 && o.instanceColor) {
        const c = o.instanceColor.array;
        for (let i = 0; i < o.count; i++) {
          rocks++;
          if (c[i * 3] >= 2) painted++;
        }
      }
    });
    return { recs: p.recs.size, rim: p.rim.count, rocks, painted, particles: g.scene.children.length, ls: Object.keys(localStorage).filter((k) => k.startsWith('strugglebus')).map((k) => [k.slice(11, 40), localStorage.getItem(k).length]).slice(0, 12) };
  })));
};

/** Elsewhere on the Moon: a named start, a few hits, what the signs say. */
SCRIPTS.sites = async () => {
  for (const [tag, q] of [['tycho', 'site=TYCHO'], ['copernicus', 'site=COPERNICUS'], ['tranq', 'lat=8.5&lon=31'], ['tsiol', 'site=TSIOLKOVSKY'], ['shack', 'site=SHACKLETON'], ['crises', 'lat=17&lon=59']]) {
    await open(q);
    await run(1.5);
    await playFor(tag, 16, 8);
    await note(`${tag}-end`);
    await shot(`${tag}-end`);
  }
};

/** What ?moon paints big enough, seen from ?moonrun's orbit. */
SCRIPTS.orbit = async () => {
  await open();
  await run(1);
  await page.evaluate(() => {
    const g = window.__game, p = g.moon.paint;
    for (const name of ['THEOPHILUS', 'CYRILLUS', 'CATHARINA']) {
      const c = g.moon.places.find((x) => x.name === name);
      if (c) for (let l = 0; l < (name === 'THEOPHILUS' ? 3 : 1); l++) p.qaHit('p' + c.id, g.clock(), l + 1);
    }
    p.save();
  });
  console.log('low store', await page.evaluate(() => localStorage.getItem('strugglebus.moon.low.v1')));
  await page.goto(`${base}?moonrun&t=2026-11-25T04:00:00Z&fixeddt=0.0166`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
  await page.evaluate(() => {
    const m = window.__game.moon;
    m.trip.tap();
    m.skip(0.1);
    m.trip.tap();
    for (let i = 0; i < 6000 && m.trip.leg !== 'orbit'; i++) m.skip(0.1);
    m.skip(4);
  });
  await page.waitForTimeout(1500);
  await shot('orbit-0');
  console.log(JSON.stringify(await page.evaluate(() => ({ leg: window.__game.moon.trip.leg, painted: window.__game.moon.breath.paint.painted, strokes: window.__game.moon.breath.paint.strokes.length }))));
};

const want = (opt.script ?? 'three').split(',');
try {
  for (const name of want) {
    console.log('----', name);
    await SCRIPTS[name]();
    if (!opt.keep) await wipe();
  }
} finally {
  writeFileSync(`${out}/paint.json`, JSON.stringify(log, null, 0));
  console.log('programs:', JSON.stringify(await page.evaluate(() => {
    const r = window.__game?.pipeline.renderer;
    if (!r?.info) return null;
    return { atReady: window.__programs0, now: r.info.programs.length, added: r.info.programs.filter((p) => !window.__names0?.has(p.cacheKey)).map((p) => {
      const gl = r.getContext(), src = gl.getShaderSource(p.vertexShader) ?? '', fs = gl.getShaderSource(p.fragmentShader) ?? '';
      return { key: p.cacheKey.slice(0, 30), usedTimes: p.usedTimes, inst: src.includes('USE_INSTANCING_COLOR'), hasSprout: src.includes('sproutVertex'), hasDepth: fs.includes('outDepthColor'), hasParticle: src.includes('aSeed'), head: fs.slice(-300, -200) };
    }) };
  }).catch(() => null)));
  console.log('errors:', errors.length, errors.slice(0, 8));
  await browser.close();
}
process.exit(errors.length ? 1 : 0);
