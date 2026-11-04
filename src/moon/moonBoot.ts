import * as THREE from 'three';
import { config } from '../config';
import { MOON_VISTA } from '../game/Ascent';
import { fxTune } from '../fx/Particles';
import { globals } from '../render/materials';
import { Ramp, dayRows, writePalette } from '../render/palette';
import type { PixelPipeline } from '../render/PixelPipeline';
import { SPACE_ROWS } from '../sky/SkyTable';
import { registerWarm } from '../render/warmup';
import type { CityMoon } from '../world/City';
import type { RegionRequest, RegionResponse } from '../world/regionLoader';
import type { CityManifest, TerrainTile } from '../world/tiles';
import { CraterPaint, SITE_R, type NameRow } from './CraterPaint';
import { craterById, cratersNear, type Crater, type CraterHit } from './craters';
import { FAR, MOON_REGION, MOON_TILE, capSun, decodeShadow, type FarUpdate } from './gen';
import { axesOf, dirOf, findNamed, findPlace, frameAt, latLonToMap, latOf, lonOf, makeFrame, readAlbedo, readPlaces, type MapFrame, type Place, type PlaceRow, type WholeMap } from './map';
import { MoonFar } from './MoonFar';
import { HELD_SUN_OFF, MoonSky } from './MoonSky';
import type { SkyDraw } from '../sky/SkyDraw';
import { makeMoonGround, moonGlobals, moonMapTexture, moonTileMap } from './moonMaterial';
import { paintRockMesh, rockMesh, rockProxy } from './rocks';
import type { MoonCraters, MoonFarRequest, MoonInit, MoonPlace, MoonPlaced, MoonReady, MoonRegionRequest, MoonSlid, MoonSlide } from './moonWorker';

// ?moon: the Moon as a place the real game loads. boot() in main.ts runs as ever with a city that happens to be generated: this file makes that city's manifest, its worker, its far field and its sky, and hands City
// what differs. ?moon starts low over Theophilus near its central peaks; ?moon&site=<landmark> or ?moon&lat=&lon= start anywhere on the Moon.
//
// World Y is height over the 1737.4 km sphere less a datum (gen.ts), +X east, +Z south. A map is 256 km square.

const DEG = Math.PI / 180;
/** Half a map's side (m): a whole number of tiles, and of regions. */
const MAP_HALF = 128000;
const FAR_PLANE = 420000;
/** One seed for the one Moon: every map of it holds the same craters. */
const SEED = 7;
/** The bus starts on the crater's floor north of the central peaks (the highest at 3968, -1280), the massif ahead and to the right, Earth to the left of it. */
const THEO_START = { x: 2866, z: -14097, heading: 167 };
const THEOPHILUS = { lat: -11.45, lon: 26.28 };

export const MOON_ROWS: Record<number, string[]> = {
  ...SPACE_ROWS,
  // no air: the sky is black, and a black with no blue in it
  [Ramp.NIGHT_SKY]: ['#000000', '#020204', '#04040a', '#06060e', '#080812', '#0a0a16', '#0c0c1a', '#0e0e1e'],
  // regolith: cool greys from a true black. Highlands, and the maria's darker, bluer row
  [Ramp.REGOLITH]: ['#050609', '#12141b', '#22252e', '#373b46', '#525661', '#747882', '#9da0a6', '#cfd0cf'],
  [Ramp.MARE]: ['#050609', '#141821', '#272d39', '#3b4352', '#535c6b', '#6f7886', '#8f98a4', '#b6bcc4'],
};

export interface MoonBoot {
  frame: MapFrame;
  manifest: CityManifest & { regions: Array<[number, number, number]>; regionSize: number };
  city: CityMoon;
  far: MoonFar | null;
  sky: MoonSky;
  site: string;
  /** ?site= asked for a place the Moon has no name for: this is what it asked for, and the bus starts where it always does */
  lost: string | null;
  /** Moon-wide facts once the worker is up */
  datum: number;
  startY: number;
  places: Place[];
  /** Attach the far field once the City's mask exists. */
  buildFar(mask: THREE.Texture, rect: THREE.Vector4, size: THREE.Vector2): MoonFar;
  /** Every frame, the lens set: the sky, the far windows. */
  update(x: number, z: number): void;
  /** How much of the Sun reaches a point over the ground at (x, z), 0 or 1. */
  sunAt(x: number, y: number, z: number, tile: TerrainTile | null): number;
  /** Craters, invented and named, whose rims come within `radius` of (x, z), largest first. See docs/specs/moon/GROUND.md. */
  cratersNear(x: number, z: number, radius: number, minD?: number): CraterHit[];
  /** An invented crater back from its id: place, radius, age. Null for a `p` id: those are `places`. */
  crater(id: string): Crater | null;
  /** The craters as buildings: what glints, what a hit does, what's saved. */
  paint: CraterPaint;
  /** ?moonland: the map again, round this place, in this moment's sky: everything here that has a place on it goes with it, as the worker's answer comes (`placed`). The number the far field asks by. */
  place(lat: number, lon: number, ms: number): number;
  /** ?moonland: the world's own, once it has its datum. */
  placed: (() => void) | null;
  /**
   * The map slides by (dx, dz) (docs/specs/moon/FREEFLIGHT.md, Stage 2): centred again there on its own axes, one datum, and what this file holds that has a place on
   * the map goes with it. main.ts slides the rest in the same moment; `moved` is what's been moved already, each once.
   */
  slide(dx: number, dz: number, moved: Set<object>): void;
  /** The ground paint a boulder finds is what's in reach (main.ts hands it GroundPaint's). */
  groundHue: (x: number, z: number) => number;
  /** Saved ground paint is on screen in this box: its boulders take it. */
  rocksReady(x0: number, z0: number, x1: number, z1: number): void;
}

function moonPalette(pipeline: PixelPipeline, land: boolean) {
  const tex = pipeline.paletteTexture;
  // (?moonland: the sky the flight already has)
  const rows = land ? { ...MOON_ROWS, [Ramp.NIGHT_SKY]: SPACE_ROWS[Ramp.NIGHT_SKY] } : MOON_ROWS;
  writePalette(tex.image.data as unknown as Uint8Array, { ...dayRows, ...rows });
  tex.needsUpdate = true;
}

/** land: ?moonland's: the flight's own sky, and no place on the Moon until a thumb says where. */
export async function startMoon(pipeline: PixelPipeline, params: URLSearchParams, scene: THREE.Scene, land?: { draw: SkyDraw }): Promise<MoonBoot> {
  const base = new URL('.', location.href).href.replace(/\/$/, '');
  const [rows, nameRows, albBuf] = await Promise.all([
    fetch('./moon/places.json').then((r) => r.json() as Promise<PlaceRow[]>),
    // (only the names of signs: a Moon with no names file is the same Moon)
    fetch('./moon/names.json').then((r) => (r.ok ? (r.json() as Promise<NameRow[]>) : []), () => [] as NameRow[]),
    fetch('./sky/moon.bin').then(async (r) => {
      const b = await r.arrayBuffer();
      const { gunzip, isGzip } = await import('../world/gunzip');
      return isGzip(b) ? gunzip(b) : b;
    }),
  ]);
  const places = readPlaces(rows);
  const albedo: WholeMap = readAlbedo(albBuf);
  // where: a landmark, a place, or Theophilus, near its central peaks
  const named = land ? null : params.get('site');
  const place = named ? (findPlace(places, named) ?? findNamed(nameRows, named)) : null;
  const hasLL = !land && params.has('lat') && params.has('lon');
  const lat = hasLL ? Number(params.get('lat')) : (place?.lat ?? THEOPHILUS.lat);
  const lon = hasLL ? Number(params.get('lon')) : (place?.lon ?? THEOPHILUS.lon);
  const atTheo = !place && !hasLL && !land;
  const frame = makeFrame(lat, lon);
  const heading = (params.has('heading') ? Number(params.get('heading')) : atTheo ? THEO_START.heading : 82) * DEG;
  // (a named crater: on its floor, on the side the Sun reaches, with the whole of it ahead. A held Sun stands HELD_SUN_OFF off the heading: this is away from it)
  let startX = atTheo ? THEO_START.x : 0, startZ = atTheo ? THEO_START.z : 0;
  if (place?.type === 'crater' || place?.type === 'basin') {
    // (and on the map: Orientale is 930 km across and a map is 256)
    const away = heading + (HELD_SUN_OFF + 180) * DEG, r = Math.min(place.R * (place.km < 20 ? 1.5 : 0.56), MAP_HALF * 0.5);
    startX = Math.sin(away) * r;
    startZ = -Math.cos(away) * r;
  }
  // (a crewed site stays unpainted: the bus comes up to its line, or the first minute is taps that don't stick)
  const crewed = place?.type === 'site' && place.name.startsWith('APOLLO');
  if (crewed) {
    startX = -Math.sin(heading) * (SITE_R + 550);
    startZ = Math.cos(heading) * (SITE_R + 550);
  }
  const site = place?.name ?? (hasLL ? `${lat.toFixed(2)}, ${lon.toFixed(2)}` : 'THEOPHILUS');

  // the sky first: the ground's shadows are baked for its Sun
  const sky = new MoonSky(pipeline, params, lat, lon, heading, land?.draw);
  const sun = sky.sun;
  moonPalette(pipeline, !!land);

  // ---- what the game's own numbers become out here, once, before anything reads them
  const L = config.light;
  /** The Sun the bus and the near ground are lit by, the one the map's baked for. Once at boot, and again for each place a flight from orbit comes down at. */
  const light = () => {
    L.sunElevation = Math.asin(sun[1]);
    L.sunAzimuth = Math.atan2(-sun[2], sun[0]);
    shade(sky.night ? 1 : 0);
  };
  /** Day to night by k, 0 to 1. By night there's next to nothing, and that's all the ground has but a faint fill to read it by: paint stays the brightest thing. */
  const shade = (k: number) => {
    const mix = (a: number, b: number) => a + (b - a) * k;
    // (the bus: a hard Sun and next to no sky)
    L.sunStrength = mix(0.72, 0.2);
    L.ambient = mix(0.26, 0.14);
    L.skyBounce = 0.02;
    // (?moonland: a step up, where the ray-drawn Moon has the ground it's coming down to. The true Sun is no held low one, and there's a lot more flat ground out of the first look's shadows)
    // (and by night, with so little light that the far field's bit more over its floor is a box round the tiles, none of that)
    moonGlobals.uMoonLight.value.set(mix(land ? 0.55 : 0.4, 0.17), mix(0.006, 0.03), mix(0.03, land ? 0 : 0.03));
  };
  const axesHere = new Float64Array(9), lightHere = new Float64Array(3), lightNow = new Float64Array(3);
  // (the light at the bus and the night, eased: what lights the ground is chosen again at a slide, and Earth's light going over to the Sun's, at the terminator, would be a step. A second or so of
  // the game's clock, so a tool at a fixed step sees the fade a player does)
  let shadeNow = -1, lightAt = 0;
  /**
   * A true sky, every frame: the light over the bus, on the map's axes there, as each region and far block round it is baked by (gen.ts, localSun). It turns as the bus goes, so
   * nothing steps at a slide, and past the terminator the night comes on as the Sun goes down.
   */
  const here = (A: Float64Array) => {
    const s = sky.sunFix, o = lightHere;
    for (let i = 0; i < 3; i++) o[i] = A[i * 3] * s[0] + A[i * 3 + 1] * s[1] + A[i * 3 + 2] * s[2];
    capSun(o);
    const now = globals.uTime.value, ease = shadeNow < 0 ? 1 : 1 - Math.exp(-Math.min(0.25, Math.max(0, now - lightAt)) / 0.8);
    lightAt = now;
    for (let i = 0; i < 3; i++) lightNow[i] = shadeNow < 0 ? o[i] : lightNow[i] + (o[i] - lightNow[i]) * ease;
    const ln = Math.hypot(lightNow[0], lightNow[1], lightNow[2]) || 1;
    L.sunElevation = Math.asin(Math.max(-1, Math.min(1, lightNow[1] / ln)));
    L.sunAzimuth = Math.atan2(-lightNow[2], lightNow[0]);
    // (by Earth's light it's night already; by the Sun's, night is the Sun going down, over a few degrees)
    const m = sky.state.moonSun, up = A[3] * m[0] + A[4] * m[1] + A[5] * m[2], k = Math.max(0, Math.min(1, (0.03 - up) / 0.06)), want = sky.byEarth ? 1 : k * k * (3 - 2 * k);
    shadeNow = shadeNow < 0 ? want : shadeNow + (want - shadeNow) * ease;
    shade(shadeNow);
  };
  if (!land) light();
  config.fog.clearFarFull = MOON_VISTA.fade;
  // no fog to hide in: the view sits lower, with more of the black over the horizon
  config.camera.elevationCruise = 13;
  config.camera.elevationSlow = 17;
  config.camera.elevationSurge = 11;
  config.camera.elevationVista = MOON_VISTA.elevation;
  config.camera.pitchVista = MOON_VISTA.pitch;
  config.camera.lookAhead = 95;
  // (a crater's wall is a hill to fly up, not a tower to steer round)
  config.flight.avoidTallerThan = 2000;
  // One-sixth gravity on everything paint does: the same heights, as long again by the root of six. What the street snaps, here hangs.
  const G6 = Math.sqrt(6);
  fxTune.gravity /= 6;
  fxTune.burstUp /= G6;
  fxTune.burstOut /= G6;
  fxTune.splashUp /= G6;
  fxTune.splashOut /= G6;
  // (and what goes up stays up: fewer of them, or a fountain is a curtain in front of the bowl it filled)
  fxTune.burstCount *= 0.55;
  config.splat.flashStrength *= 0.6;
  config.splat.blobTime *= G6;
  config.splat.blobTimePerM *= G6;
  // (the aim runs out as far as the ground does: a crater is a target from any height the bus can see it at)
  config.splat.maxRange = 30000;
  if (!land) pipeline.setFar(FAR_PLANE);
  globals.uGroundRef.value = 0;

  const worker = new Worker(new URL('./moonWorker.ts', import.meta.url), { type: 'module' });
  let onRegion: ((m: RegionResponse) => void) | null = null;
  let far: MoonFar | null = null;
  let ready0: (m: MoonReady) => void = () => {};
  const ready = new Promise<MoonReady>((done) => (ready0 = done));
  let paint: CraterPaint | null = null;
  /** The place the worker was last asked for, and the map's slides since boot: a region asked for before the last is no use, and comes again. */
  let placeId = 0;
  let slideId = 0;
  worker.onmessage = (ev: MessageEvent<RegionResponse | FarUpdate | MoonReady | MoonCraters | MoonPlaced>) => {
    const m = ev.data;
    if (m.type === 'region') {
      if ((m as RegionResponse & Partial<MoonSlid>).slide === undefined || (m as RegionResponse & MoonSlid).slide === slideId) onRegion?.(m);
    }
    else if (m.type === 'far') far?.land(m);
    else if (m.type === 'craters') paint?.land(m);
    else if (m.type === 'ready') ready0(m);
    else if (m.type === 'placed' && m.id === placeId) {
      boot.datum = m.datum;
      paint?.rebase();
      boot.placed?.();
    }
  };
  worker.onerror = (e) => console.error('moon worker:', e.message);

  const bounds: [number, number, number, number] = [-MAP_HALF, -MAP_HALF, MAP_HALF, MAP_HALF];
  worker.postMessage({ type: 'init', base, lat, lon, seed: SEED, sun: [sun[0], sun[1], sun[2]], bounds, startX, startZ, heading, seekLit: !land && !atTheo && !crewed && !sky.night, levels: land ? FAR.HIGH_LEVELS : FAR.LEVELS, sunFix: sky.held ? null : [sky.sunFix[0], sky.sunFix[1], sky.sunFix[2]] } satisfies MoonInit);
  const landed = await ready;
  const { datum, startY } = landed;
  // (it looked for ground with the Sun on it, unless this is the start picked by hand)
  startX = landed.startX;
  startZ = landed.startZ;

  // its names, for the signs: what is near enough to be flown to
  const tmp = new Float64Array(2);
  const near: Array<{ name: string; x: number; z: number }> = [];
  for (const p of places) {
    latLonToMap(frame, p.lat, p.lon, tmp);
    if (Math.abs(tmp[0]) < 2 * MAP_HALF && Math.abs(tmp[1]) < 2 * MAP_HALF) near.push({ name: p.name, x: tmp[0], z: tmp[1] });
  }
  if (!near.length) near.push({ name: site, x: 0, z: 0 });

  const manifest: MoonBoot['manifest'] = {
    name: 'The Moon',
    slug: `moon_${lat.toFixed(2)}_${lon.toFixed(2)}`,
    origin: [lat, lon],
    tileSize: MOON_TILE,
    terrainN: 129,
    obstN: 32,
    classN: 1,
    bounds,
    buildingCount: 0,
    tiles: [],
    neighborhoods: near,
    landmarks: [],
    start: { x: startX, z: startZ, heading },
    source: 'Generated: MoonKit relief, LOLA, LROC, the IAU gazetteer',
    attribution: 'NASA SVS, LOLA Science Team, LROC Team / ASU, IAU WGPSN / USGS',
    regions: [],
    regionSize: MOON_REGION,
  };

  const city: CityMoon = {
    request: (msg: RegionRequest, rx: number, rz: number) => worker.postMessage({ ...msg, rx, rz, place: placeId, slide: slideId } satisfies MoonRegionRequest),
    listen: (fn) => (onRegion = fn),
    available: (rx, rz) => {
      const s = MOON_REGION * MOON_TILE;
      return rx * s >= bounds[0] && (rx + 1) * s <= bounds[2] && rz * s >= bounds[1] && (rz + 1) * s <= bounds[3];
    },
    tileTexture: (t) => moonTileTexture(t),
    regionTexture: (t) => {
      const m = t.moon!;
      return moonMapTexture(m.map, m.mapN);
    },
    material: (tex, t, ox, oz, size, ground) => {
      const m = t.moon!;
      // (a coarse region's tile split out by paint carries its own square: moonTileTexture)
      const own = (tex as THREE.DataTexture & { moonAt?: { x: number; z: number; n: number } }).moonAt;
      return own ? makeMoonGround(tex, own.x, own.z, m.mapCell, own.n, ox, oz, size, ground) : makeMoonGround(tex, m.mapX, m.mapZ, m.mapCell, m.mapN, ox, oz, size, ground);
    },
    regionMaterial: (tex, t, ox, oz, size) => {
      const m = t.moon!;
      return makeMoonGround(tex, m.mapX, m.mapZ, m.mapCell, m.mapN, ox, oz, size);
    },
    groundAt: (x, z) => far?.heightAt(x, z) ?? startY,
    regionLanded(m) {
      const key = `${m.rx},${m.rz}`;
      dropRocks(key);
      if (!m.rocks?.length) return;
      const mesh = rockMesh(m.rocks);
      scene.add(mesh);
      const rock = { mesh, data: m.rocks };
      rocks.set(key, rock);
      if (paint?.recs.size) paintRockMesh(mesh, m.rocks, -Infinity, -Infinity, Infinity, Infinity, hueOfRock, -100);
    },
    regionGone: (rx, rz) => dropRocks(`${rx},${rz}`),
  };

  /** Each detailed region's boulders. */
  const rocks = new Map<string, { mesh: THREE.InstancedMesh; data: Float32Array }>();
  const dropRocks = (key: string) => {
    const m = rocks.get(key);
    if (!m) return;
    scene.remove(m.mesh);
    m.mesh.dispose();
    rocks.delete(key);
  };
  /** The paint a boulder stands in: a crater's, else what a blast left on open ground. */
  const hueOfRock = (x: number, z: number) => {
    const h = paint!.hueAt(x, z);
    return h >= 0 || paint!.inSite(x, z) ? h : boot.groundHue(x, z);
  };
  const paintRocks = (x0: number, z0: number, x1: number, z1: number, at: number) => {
    for (const r of rocks.values()) paintRockMesh(r.mesh, r.data, x0, z0, x1, z1, hueOfRock, at);
  };

  function moonTileTexture(t: TerrainTile): THREE.DataTexture {
    const m = t.moon!;
    // a detailed tile has its own map; a coarse one's is its region's, and it cuts its square out
    if (m.mapN < 2 * (MOON_TILE / m.mapCell)) return moonMapTexture(m.map, m.mapN);
    const { tex, x, z } = moonTileMap(m, t.originX, t.originZ, MOON_TILE);
    (tex as THREE.DataTexture & { moonAt?: unknown }).moonAt = { x, z, n: tex.image.width };
    return tex;
  }

  // the only ground programs that draw here: one of each, in place of the city's
  const warmTex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  registerWarm('city', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    // (a tile has one, empty or not, and three keys its programs by that: ?moon had a tile to warm by the time it mattered, and from orbit there's none)
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    return [new THREE.Mesh(g, makeMoonGround(warmTex, 0, 0, 2, 2, 0, 0, 256)), rockProxy()];
  });

  paint = new CraterPaint({ renderer: pipeline.renderer, post: (m) => worker.postMessage(m), frame, albedo, places, names: nameRows, seed: SEED, paintRocks });
  const dTmp = new Float64Array(3);
  const boot: MoonBoot = {
    frame,
    manifest,
    city,
    far: null,
    sky,
    site,
    lost: named && !place ? named.trim().toUpperCase().slice(0, 22) : null,
    datum,
    startY,
    places,
    paint,
    groundHue: () => -1,
    rocksReady: (x0, z0, x1, z1) => paintRocks(x0, z0, x1, z1, -100),
    buildFar(mask, rect, size) {
      far = new MoonFar(pipeline.renderer, (m: MoonFarRequest) => worker.postMessage(m), mask, rect, size, land ? FAR.HIGH_LEVELS : FAR.LEVELS);
      boot.far = far;
      return far;
    },
    placed: null,
    place(lat2, lon2, ms) {
      placeId++;
      Object.assign(frame, makeFrame(lat2, lon2));
      sky.place(lat2, lon2, ms);
      capSun(sky.sun);
      light();
      boot.datum = NaN;
      const s = sky.sun, f = sky.sunFix;
      worker.postMessage({ type: 'place', id: placeId, lat: lat2, lon: lon2, sun: [s[0], s[1], s[2]], sunFix: [f[0], f[1], f[2]], bounds } satisfies MoonPlace);
      return placeId;
    },
    slide(dx, dz, moved) {
      slideId++;
      const from = { ...frame };
      Object.assign(frame, frameAt(frame, dx, dz));
      // (what lights the ground over the new middle, on these axes, for what's made from here on: the Sun, or by night Earth where it's up, chosen again for that middle (MoonSky.slide). The light at the bus is here()'s, every frame)
      sky.slide(frame.u, frame.e, frame.n);
      if (land) capSun(sky.sun);
      const f = sky.sunFix;
      worker.postMessage({ type: 'slide', slide: slideId, dx, dz, bounds, sunFix: [f[0], f[1], f[2]] } satisfies MoonSlide);
      far?.slide(dx, dz);
      // the boulders: their meshes over, their places in their data, their keys by regions
      const R = MOON_REGION * MOON_TILE, dr = dx / R, ds = dz / R, held = [...rocks.entries()];
      rocks.clear();
      for (const [key, r] of held) {
        r.mesh.position.x -= dx;
        r.mesh.position.z -= dz;
        // (its world matrix doesn't follow by itself)
        r.mesh.updateMatrix();
        if (r.mesh.parent) r.mesh.matrixWorld.multiplyMatrices(r.mesh.parent.matrixWorld, r.mesh.matrix);
        else r.mesh.matrixWorld.copy(r.mesh.matrix);
        for (let o = 0; o < r.data.length; o += 7) {
          r.data[o] -= dx;
          r.data[o + 2] -= dz;
        }
        const c = key.indexOf(',');
        rocks.set(`${Number(key.slice(0, c)) - dr},${Number(key.slice(c + 1)) - ds}`, r);
      }
      paint?.slide(from, dx, dz, moved);
      // (the fine noise on the ground reads where it was, so nothing in it moves. Kept within 2^18 of nothing, so it's fine to 3 cm: it turns over once in four slides one way, 524 km)
      const S = moonGlobals.uSlide.value, P = 2 ** 19, wrap = (v: number) => ((((v + P / 2) % P) + P) % P) - P / 2;
      S.set(wrap(S.x + dx), wrap(S.y + dz));
    },
    update(x, z) {
      far?.update(x, z);
      dirOf(frame, x, z, dTmp);
      axesOf(frame, x, z, axesHere);
      sky.update(latOf(dTmp), lonOf(dTmp), axesHere);
      if (!sky.held) here(axesHere);
    },
    sunAt(x, y, z, tile) {
      const m = tile?.moon;
      if (!m) return 1;
      const i = Math.round((x - m.mapX) / m.mapCell), j = Math.round((z - m.mapZ) / m.mapCell);
      if (i < 0 || j < 0 || i >= m.mapN || j >= m.mapN) return 1;
      const under = decodeShadow(m.map[(j * m.mapN + i) * 4 + 3]);
      // (how far under the line of sunlight the ground is, and the bus is that much higher up it)
      const g = tile!.heights[Math.round((z - tile!.originZ) / tile!.cell) * tile!.n + Math.round((x - tile!.originX) / tile!.cell)];
      return under > 0 && y < g + under ? 0 : 1;
    },
    crater: (id) => (id.startsWith('p') ? null : craterById(frame, albedo, SEED, id)),
    cratersNear(x, z, radius, minD = 40) {
      const out = cratersNear(frame, albedo, SEED, x, z, radius, minD);
      const t = new Float64Array(2);
      for (const p of places) {
        if (p.type !== 'crater') continue;
        latLonToMap(frame, p.lat, p.lon, t);
        const d = Math.hypot(t[0] - x, t[1] - z);
        if (d - p.R <= radius && p.km * 1000 >= minD) out.push({ id: `p${p.id}`, name: p.name, x: t[0], z: t[1], r: p.R, age: 1 });
      }
      return out.sort((a, b) => b.r - a.r);
    },
  };
  return boot;
}
