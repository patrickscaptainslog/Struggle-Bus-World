import * as THREE from 'three';
import { config } from '../config';
import { globals } from '../render/materials';
import { Ramp, dayRows, writePalette } from '../render/palette';
import type { PixelPipeline } from '../render/PixelPipeline';
import { SPACE_ROWS } from '../sky/SkyTable';
import { registerWarm } from '../render/warmup';
import type { CityMoon } from '../world/City';
import type { RegionRequest, RegionResponse } from '../world/regionLoader';
import type { CityManifest, TerrainTile } from '../world/tiles';
import { CraterPaint } from './CraterPaint';
import { craterById, cratersNear, type Crater, type CraterHit } from './craters';
import { MOON_REGION, MOON_TILE, decodeShadow, type FarUpdate } from './gen';
import { dirOf, findPlace, latLonToMap, latOf, lonOf, makeFrame, readAlbedo, readPlaces, type MapFrame, type Place, type PlaceRow, type WholeMap } from './map';
import { MoonFar } from './MoonFar';
import { HELD_SUN_OFF, MoonSky } from './MoonSky';
import { makeMoonGround, moonGlobals, moonMapTexture, moonTileMap } from './moonMaterial';
import { rockMesh, rockProxy } from './rocks';
import type { MoonCraters, MoonFarRequest, MoonInit, MoonReady, MoonRegionRequest } from './moonWorker';

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
  [Ramp.MARE]: ['#050609', '#11141b', '#1f242e', '#313846', '#49515f', '#68707e', '#8c94a0', '#b6bcc4'],
};

export interface MoonBoot {
  frame: MapFrame;
  manifest: CityManifest & { regions: Array<[number, number, number]>; regionSize: number };
  city: CityMoon;
  far: MoonFar | null;
  sky: MoonSky;
  site: string;
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
}

function moonPalette(pipeline: PixelPipeline) {
  const tex = pipeline.paletteTexture;
  writePalette(tex.image.data as unknown as Uint8Array, { ...dayRows, ...MOON_ROWS });
  tex.needsUpdate = true;
}

export async function startMoon(pipeline: PixelPipeline, params: URLSearchParams, scene: THREE.Scene): Promise<MoonBoot> {
  const base = new URL('.', location.href).href.replace(/\/$/, '');
  const [rows, albBuf] = await Promise.all([
    fetch('./moon/places.json').then((r) => r.json() as Promise<PlaceRow[]>),
    fetch('./sky/moon.bin').then(async (r) => {
      const b = await r.arrayBuffer();
      const { gunzip, isGzip } = await import('../world/gunzip');
      return isGzip(b) ? gunzip(b) : b;
    }),
  ]);
  const places = readPlaces(rows);
  const albedo: WholeMap = readAlbedo(albBuf);
  // where: a landmark, a place, or Theophilus, near its central peaks
  const named = params.get('site');
  const place = named ? findPlace(places, named) : null;
  const hasLL = params.has('lat') && params.has('lon');
  const lat = hasLL ? Number(params.get('lat')) : (place?.lat ?? THEOPHILUS.lat);
  const lon = hasLL ? Number(params.get('lon')) : (place?.lon ?? THEOPHILUS.lon);
  const atTheo = !named && !hasLL;
  const frame = makeFrame(lat, lon);
  const heading = (params.has('heading') ? Number(params.get('heading')) : atTheo ? THEO_START.heading : 82) * DEG;
  // (a named crater: on its floor, on the side the Sun reaches, with the whole of it ahead. A held Sun stands HELD_SUN_OFF off the heading: this is away from it)
  let startX = atTheo ? THEO_START.x : 0, startZ = atTheo ? THEO_START.z : 0;
  if (place?.type === 'crater' || place?.type === 'basin') {
    const away = heading + (HELD_SUN_OFF + 180) * DEG, r = place.R * (place.km < 20 ? 1.5 : 0.56);
    startX = Math.sin(away) * r;
    startZ = -Math.cos(away) * r;
  }
  const site = place?.name ?? (hasLL ? `${lat.toFixed(2)}, ${lon.toFixed(2)}` : 'THEOPHILUS');

  // the sky first: the ground's shadows are baked for its Sun
  const sky = new MoonSky(pipeline, params, lat, lon, heading);
  const sun = sky.sun;
  moonPalette(pipeline);

  // ---- what the game's own numbers become out here, once, before anything reads them
  const L = config.light;
  L.sunElevation = Math.asin(sun[1]);
  L.sunAzimuth = Math.atan2(-sun[2], sun[0]);
  // (the bus: a hard Sun and next to no sky)
  L.sunStrength = sky.night ? 0.2 : 0.72;
  L.ambient = sky.night ? 0.14 : 0.26;
  L.skyBounce = 0.02;
  config.fog.clearFarFull = 3e6;
  // no fog to hide in: the view sits lower, with more of the black over the horizon
  config.camera.elevationCruise = 13;
  config.camera.elevationSlow = 17;
  config.camera.elevationSurge = 11;
  config.camera.elevationVista = 34;
  config.camera.pitchVista = 19;
  config.camera.lookAhead = 95;
  // (a crater's wall is a hill to fly up, not a tower to steer round)
  config.flight.avoidTallerThan = 2000;
  pipeline.setFar(FAR_PLANE);
  if (sky.night) moonGlobals.uMoonLight.value.set(0.17, 0.03);
  globals.uGroundRef.value = 0;

  const worker = new Worker(new URL('./moonWorker.ts', import.meta.url), { type: 'module' });
  let onRegion: ((m: RegionResponse) => void) | null = null;
  let far: MoonFar | null = null;
  let ready0: (m: MoonReady) => void = () => {};
  const ready = new Promise<MoonReady>((done) => (ready0 = done));
  let paint: CraterPaint | null = null;
  worker.onmessage = (ev: MessageEvent<RegionResponse | FarUpdate | MoonReady | MoonCraters>) => {
    const m = ev.data;
    if (m.type === 'region') onRegion?.(m);
    else if (m.type === 'far') far?.land(m);
    else if (m.type === 'craters') paint?.land(m);
    else if (m.type === 'ready') ready0(m);
  };
  worker.onerror = (e) => console.error('moon worker:', e.message);

  const bounds: [number, number, number, number] = [-MAP_HALF, -MAP_HALF, MAP_HALF, MAP_HALF];
  worker.postMessage({ type: 'init', base, lat, lon, seed: SEED, sun: [sun[0], sun[1], sun[2]], bounds, startX, startZ } satisfies MoonInit);
  const { datum, startY } = await ready;

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
    request: (msg: RegionRequest, rx: number, rz: number) => worker.postMessage({ ...msg, rx, rz } satisfies MoonRegionRequest),
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
      rocks.set(key, mesh);
    },
    regionGone: (rx, rz) => dropRocks(`${rx},${rz}`),
  };

  /** Each detailed region's boulders. */
  const rocks = new Map<string, THREE.InstancedMesh>();
  const dropRocks = (key: string) => {
    const m = rocks.get(key);
    if (!m) return;
    scene.remove(m);
    m.dispose();
    rocks.delete(key);
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
    g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    return [new THREE.Mesh(g, makeMoonGround(warmTex, 0, 0, 2, 2, 0, 0, 256)), rockProxy()];
  });

  paint = new CraterPaint({ renderer: pipeline.renderer, post: (m) => worker.postMessage(m), frame, albedo, places, seed: SEED, groundAt: (x, z) => city.groundAt!(x, z) });
  const dTmp = new Float64Array(3);
  const boot: MoonBoot = {
    frame,
    manifest,
    city,
    far: null,
    sky,
    site,
    datum,
    startY,
    places,
    paint,
    buildFar(mask, rect, size) {
      far = new MoonFar(pipeline.renderer, (m: MoonFarRequest) => worker.postMessage(m), mask, rect, size);
      boot.far = far;
      return far;
    },
    update(x, z) {
      far?.update(x, z);
      dirOf(frame, x, z, dTmp);
      sky.update(latOf(dTmp), lonOf(dTmp));
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
