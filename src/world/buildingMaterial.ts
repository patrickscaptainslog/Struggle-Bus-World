import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { Ramp, HUE_RAMPS } from '../render/palette';
import { Part } from './BuildingMesher';
import { Arch } from './tiles';
import { blastUniforms, GLSL_BLAST_RING } from './GroundPaint';
import { Fam, Crown, Variant } from './towerStyles';

// One shader for every building. Grey state: Hopper — cool battleship
// greys, lighter trim, dark glass that catches the low sun. Painted state:
// Painted Ladies body + contrasting trim, stained-glass windows that glow,
// walls that wobble; level 3 adds Hundertwasser's wavy color bands.
// Color floods DOWN from the roof with drips when the barf lands, while the
// building does a squash-and-stretch pop.
//
// Towers and big commercial blocks wear a facade family (towerStyles.ts):
// glass curtain wall, pre-war masonry, modernist bands or fins, dark granite,
// white precast. Every tower has a base (tall storefront floors, a dark
// entrance band) and a top (mechanical band, cornice, lit or lattice crown).
// Their light lands exactly on ramp steps after the resolve's atmospheric
// perspective (mirrored below), so a tower facade never dithers; and every
// facade's detail drops out by its size on screen, decided per building and
// face (never per pixel: no LOD line across a wall): columns while a column
// module is >= ~3 game px, floors while a floor is >= ~4 px, then a flat
// wall tone. Painted towers: stained-glass curtain walls (level 1), gardens
// on their setbacks (level 2), Hundertwasser with onion domes and trees
// spilling off the setbacks (level 3).

export const paintUniforms = {
  uPaint: { value: null as THREE.Texture | null },
  uPaintW: { value: 1024 },
  uBloom: { value: new THREE.Vector4(config.bloom.popDuration, config.bloom.squash, config.bloom.overshoot, config.bloom.floodSpeed) },
  uWobble: { value: new THREE.Vector2(config.bloom.wobbleAmp, config.bloom.wobbleSpeed) },
  /** building index the loaded projectile would hit (-1 = none): it glints (the only aim cue; no HUD) */
  uTarget: { value: -1 },
};

/** Facade tunables, read live from config.facade (getters: no per-frame code). */
const F = () => config.facade;
const facadeUniforms = {
  /** angular size of one game pixel (rad): set per draw from the camera and the render target */
  uPixelAngle: { value: 0.0017 },
  uColPx: { get value() { return F().colPx; } },
  uFloorPx: { get value() { return F().floorPx; } },
  uLodJitter: { get value() { return F().lodJitter; } },
  uHouseRibbon: { get value() { return F().houseRibbon; } },
  uHouseFlat: { get value() { return F().houseFlat; } },
  uCrownGlow: { get value() { return F().crownGlow; } },
  uGlassGlow: { get value() { return F().glassGlow; } },
  uGlassGlow3: { get value() { return F().glassGlow3; } },
  uGlassBands: { get value() { return F().glassBands; } },
};

const HUES = HUE_RAMPS.map((r) => r.toFixed(1)).join(', ');
const R = (r: number) => r.toFixed(1);

export function makeBuildingMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...globals, ...paintUniforms, ...facadeUniforms, uBlastRing: blastUniforms.uBlastRing, uBlastRing2: blastUniforms.uBlastRing2 },
    vertexShader: /* glsl */ `
      ${GLSL_COMMON}
      precision highp sampler2D;
      uniform sampler2D uPaint;
      uniform float uPaintW;
      uniform vec4 uBloom;
      uniform vec2 uWobble;
      uniform float uPixelAngle;
      uniform float uLodJitter;
      in vec2 aFacade;
      in vec4 aMeta;
      in vec4 aBld;
      in vec2 aBld2;
      out vec2 vFacade;
      flat out vec4 vMeta;
      flat out vec4 vPaint;
      flat out vec4 vBld;
      flat out vec2 vBld2;
      flat out float vLodPx;
      out vec3 vWorldPos;
      out vec3 vWorldNormal;
      out vec3 vViewNormal;
      out float vYRest;

      void main() {
        float idx = aBld.x;
        ivec2 pc = ivec2(int(mod(idx, uPaintW)), int(floor(idx / uPaintW)));
        vec4 paint = texelFetch(uPaint, pc, 0);
        vec3 p = position;
        vec3 n = normal;
        float baseY = aBld.z;
        float roofY = aBld2.x;
        float hgt = max(roofY - baseY, 1.0);
        vec2 fac = aFacade;
        float partV = floor(aMeta.x + 0.5);
        if (partV > ${R(Part.GARDEN - 0.5)}) {
          // a painted tower's garden blob / onion dome: baked collapsed on its anchor, it grows
          // out (with a little overshoot) once the color flood has passed it at its level
          float need = mod(floor(aMeta.w / 4.0 + 0.01), 4.0);
          float s = 0.0;
          if (paint.g > need - 0.5) {
            float delay = max(roofY - position.y, 0.0) / max(uBloom.w, 1.0) + 0.35 + 0.45 * fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
            float k = paint.g > need + 0.5 ? 9.0 : max(uTime - paint.b - delay, 0.0) / 0.55;
            s = k >= 9.0 ? 1.0 : 1.0 - exp(-5.0 * k) * cos(7.5 * k);
          }
          p = position + vec3(aFacade.x, aBld2.y, aFacade.y) * max(s, 0.0);
          fac = vec2(0.0, aBld2.y);
        }
        vYRest = p.y;
        if (paint.g > 0.5) {
          float tb = uTime - paint.b;
          if (tb >= 0.0) {
            // squash & stretch pop about the base, volume-preserving-ish
            float pop = 0.0;
            if (tb < uBloom.x * 1.6) {
              float k = tb / uBloom.x;
              pop = -uBloom.y * exp(-7.0 * k) * cos(10.5 * k) + uBloom.z * exp(-5.0 * k) * sin(10.5 * k);
            }
            float sy = 1.0 + pop;
            float sxz = 1.0 / sqrt(max(sy, 0.4));
            vec2 c = vec2(aBld.y, aBld.w);
            p.y = baseY + (p.y - baseY) * sy;
            p.xz = c + (p.xz - c) * sxz;
            // gentle wobble: a continuous world-space field, so parts of one building never crack apart
            float h01 = clamp((vYRest - baseY) / hgt, 0.0, 1.0);
            float seed = aMeta.z * 0.137;
            float w = uWobble.x * h01 * smoothstep(0.0, 0.6, tb);
            float t = uTime * uWobble.y;
            p.x += w * sin(vYRest * 0.33 + position.z * 0.21 + t + seed);
            p.z += w * sin(vYRest * 0.29 + position.x * 0.23 + t * 0.87 + seed * 1.7);
          }
        }
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * n);
        vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
        vFacade = fac;
        vMeta = aMeta;
        vPaint = paint;
        vBld = aBld;
        vBld2 = aBld2;
        // size of a game pixel at this building (m), from the nearest point of its vertical axis; the
        // facade LOD is decided per building with it (jittered per building, so no ring shows)
        vec3 axis = (modelMatrix * vec4(aBld.y, clamp(cameraPosition.y, baseY, roofY), aBld.w, 1.0)).xyz;
        float jit = 1.0 + uLodJitter * (fract(sin(aBld.x * 12.9898) * 43758.5453) - 0.5);
        vLodPx = length(axis - cameraPosition) * uPixelAngle * jit;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      uniform vec4 uBloom;
      uniform float uTarget;
      uniform float uColPx;
      uniform float uFloorPx;
      uniform float uHouseRibbon;
      uniform float uHouseFlat;
      uniform float uCrownGlow;
      uniform float uGlassGlow;
      uniform float uGlassGlow3;
      uniform float uGlassBands;
      ${GLSL_BLAST_RING}
      in vec2 vFacade;
      flat in vec4 vMeta;
      flat in vec4 vPaint;
      flat in vec4 vBld;
      flat in vec2 vBld2;
      flat in float vLodPx;
      in vec3 vWorldPos;
      in vec3 vWorldNormal;
      in vec3 vViewNormal;
      in float vYRest;
      ${GLSL_OUT}

      const float HUES[6] = float[6](${HUES});
      float hueRamp(float h) { return HUES[int(mod(h + 60.0, 6.0))]; }
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      // window mask for a facade: returns 1 inside glass, 0 wall; cell id out
      // fh = floor height, sp = column spacing, ww/wh = window size, sill = height of sill in floor,
      // groundH = height of the ground floor band; ribbon = far away: one glass band per floor
      float windows(vec2 f, float fh, float sp, float ww, float wh, float sill, float groundH, bool ribbon, out vec2 cell) {
        float v = f.y - groundH;
        if (v < 0.0) { cell = vec2(-1.0); return 0.0; }
        float fl = floor(v / fh);
        float fy = v - fl * fh;
        float col = floor(f.x / sp);
        float fx = f.x - col * sp;
        cell = vec2(ribbon ? 0.0 : col, fl);
        float x0 = (sp - ww) * 0.5;
        float cm = ribbon ? 1.0 : step(x0, fx) * step(fx, x0 + ww);
        return cm * step(sill, fy) * step(fy, sill + wh);
      }

      // ---- atmospheric perspective, mirrored from the resolve pass (PixelPipeline.ts RESOLVE_FS:
      // skyLight(), sl and light = mix(light, sl, smoothstep(0.08, 0.66, fog) * 0.9); keep in sync).
      // Tower facades pick whole ramp steps in that fogged space and write the light that lands
      // exactly on them, so their patterns never fall into the dither band.
      float gAF = 0.0;
      float gSL = 0.9;
      float skyMirror(vec3 dir) {
        float e = clamp(dir.y * 2.6, -0.3, 1.0);
        float sunNear = pow(max(dot(dir, uSunDir), 0.0), 16.0);
        float l = 0.9 - 0.5 * max(e, 0.0) + 0.12 * sunNear;
        l -= 0.6 * max(-e, 0.0);
        return clamp(l, 0.0, 1.0);
      }
      /** the ramp step (continuous) a light level ends on after the resolve's atmospheric mix */
      float stepPos(float L) { return mix(clamp(L, 0.0, 1.0), gSL, gAF) * 7.0; }
      /** contrast of a pattern (in steps) compressed by the fog, as the resolve would */
      float fogSteps(float d) { return sign(d) * floor(abs(d) * (1.0 - gAF) + 0.5); }
      /** the light to write so the resolve lands exactly on step s */
      float lightAtStep(float s) {
        float lo = gAF * gSL, span = max(1.0 - gAF, 0.08);
        s = clamp(s, ceil(lo * 7.0 - 0.2), floor((lo + span) * 7.0 + 0.2));
        return clamp((s / 7.0 - lo) / span, 0.0, 1.0);
      }
      /** one game pixel wide line at multiples of period (dx = meters per pixel along x) */
      float lineAt(float x, float period, float dx) {
        return abs(fract(x / period + 0.5) - 0.5) * period < 0.5 * dx ? 1.0 : 0.0;
      }

      /**
       * A facade's rhythm far away: one-pixel lines at multiples of period, doubled up to 8x until
       * they are at least minPx apart on screen (scale = px per meter), none beyond that or in fog.
       */
      // (sparser as the pixels grow: up high the view drifts by sub-pixels with the bus's bob, and every
      // one-pixel line that hops a row counts as crawl; none beyond 3 m per game pixel)
      float gMpp = 0.3;
      float rhythm(float x, float period, float scale, float dx, float minPx) {
        float mp = minPx * (1.0 + max(gMpp - 0.9, 0.0)) * (1.0 + uFogLayer2.w);
        float per = period;
        for (int q = 0; q < 3; q++) if (per * scale < mp) per *= 2.0;
        return per * scale >= mp && gAF < 0.65 && gMpp < 3.0 ? lineAt(x, per, dx) : 0.0;
      }

      // ---- tower facades. Out: ramp, step delta d on a base: b = 0 the wall's light, 1 the glass
      // light, 2 an absolute step; glow; the pane cell. A part's rows count from the building's true
      // ground (v), its columns from whole modules per wall (u, see the mesher).
      void towerFacade(float fam, int variant, int crownT, bool crownP, bool pent, vec2 f, float dTop, float bH,
                       float fu, float fv, float mpp, vec2 dF, float bIdx,
                       out float ramp, out float d, out float b, out float glw, out vec2 cell) {
        float sp, fh, baseH, wallR;
        if (fam == ${R(Fam.GLASS)}) { sp = 1.5; fh = 3.9; baseH = 6.0; wallR = ${R(Ramp.GLASS)}; }
        else if (fam == ${R(Fam.MASONRY)}) { sp = 3.6; fh = 3.7; baseH = 8.0; wallR = ${R(Ramp.STONE)}; }
        else if (fam == ${R(Fam.BANDS)}) { sp = 1.5; fh = 3.8; baseH = 7.6; wallR = ${R(Ramp.GREY)}; }
        else if (fam == ${R(Fam.FINS)}) { sp = 2.4; fh = 3.8; baseH = 7.6; wallR = ${R(Ramp.GREY)}; }
        else if (fam == ${R(Fam.GRANITE)}) { sp = 2.6; fh = 3.8; baseH = 8.0; wallR = ${R(Ramp.GRANITE)}; }
        else { sp = 3.0; fh = 3.8; baseH = 7.6; wallR = ${R(Ramp.GREY_LIGHT)}; }
        // metal and trim of a glass tower: pale anodized grey; everyone else uses their own wall
        float metalR = fam == ${R(Fam.GLASS)} ? ${R(Ramp.GREY_LIGHT)} : wallR;
        ramp = wallR; d = 0.0; b = 0.0; glw = 0.0; cell = vec2(-1.0);
        // (a face seen at a grazing angle draws its floors as staircased diagonals that crawl with
        // every sub-pixel of motion: past the near field it keeps only its tone)
        float fvE = fu < 0.35 && mpp > 0.6 ? 0.0 : fv;
        float colPx = sp * fu / mpp;
        float rowPx = fh * fvE / mpp;
        // (up high, where the whole view drifts by sub-pixels with the bus's bob, detail needs more room)
        float hi = 1.0 + 0.5 * uFogLayer2.w;
        bool showV = colPx >= uColPx * hi;
        bool showH = rowPx >= uFloorPx * hi;
        bool nearV = showV && showH;
        float u = f.x, v = f.y;
        float vb = v - baseH;
        float fl = floor(vb / fh), fy = vb - fl * fh;
        float col = floor(u / sp), fx = u - col * sp;

        // (Salesforce Tower's rooftop boxes stand inside its open crown: they glow with it)
        if (pent && crownT == ${Crown.LATTICE}) { ramp = ${R(Ramp.GLOW_WHITE)}; b = 2.0; d = 3.0; glw = uCrownGlow * 0.7; return; }
        // ---- a mechanical penthouse on the roof: solid, louvered up close
        if (pent) {
          ramp = metalR; d = fam == ${R(Fam.GLASS)} ? -1.0 : 0.0;
          if (dTop < 0.7 && rowPx >= uFloorPx * 0.5) d += 1.0;
          else if (colPx >= uColPx * 2.0 && lineAt(u, 1.2, dF.x) > 0.5) d -= 1.0;
          return;
        }
        // ---- the top: the building's crown band, or a setback's coping line
        if (crownP) {
          if (crownT == ${Crown.LATTICE}) {
            float cH = min(52.0, bH * 0.18);
            if (dTop < cH) {
              // Salesforce Tower's open crown: white fins (they converge with the taper) and
              // their rings over the glowing LED screen inside
              // (far away the fins thin out to every 2nd / 4th / 8th, one game pixel each, >= 3 px apart)
              bool fin = 0.6 * fu / mpp >= 1.5 ? fract(u / 1.5) * 1.5 < 0.6 : rhythm(u, 1.5, fu / mpp, dF.x, 4.0) > 0.5;
              bool ring = rhythm(dTop, 7.6, fvE / mpp, dF.y, 5.0) > 0.5;
              if (dTop > cH - 1.8) { ramp = ${R(Ramp.WHITE)}; d = 1.0; }
              else if (fin || ring) { ramp = ${R(Ramp.WHITE)}; d = 1.0; }
              else { ramp = ${R(Ramp.GLOW_WHITE)}; b = 2.0; d = 3.0; glw = uCrownGlow * 0.7; }
              return;
            }
          } else if (crownT == ${Crown.LIT}) {
            if (dTop < 0.6) { ramp = metalR; d = 1.0; return; }
            if (dTop < 4.4) {
              // a lit band of glass under the roof (pale, not cream: it is still afternoon)
              ramp = ${R(Ramp.GLOW_WHITE)}; b = 2.0; d = 3.0; glw = uCrownGlow * 0.6;
              if (colPx >= uColPx * 1.33 && lineAt(u, sp, dF.x) > 0.5) { ramp = metalR; b = 0.0; d = 0.0; glw = 0.0; }
              return;
            }
            if (dTop < 5.4 && 1.0 * fv / mpp >= 1.0) { ramp = metalR; d = -2.0; return; }
          } else if (crownT == ${Crown.CORNICE}) {
            if (dTop < 0.0) { d = 0.0; return; }
            if (dTop < 1.0) { d = 1.0; return; }
            if (dTop < 1.7 && 0.7 * fv / mpp >= 1.0) { d = -2.0; return; }
          } else {
            float mH = fh * 1.5;
            if (dTop < mH) {
              ramp = metalR; d = fam == ${R(Fam.GLASS)} ? -1.0 : 0.0;
              if (dTop < 0.7 && rowPx >= uFloorPx * 0.5) d += 1.0;
              else if (colPx >= uColPx * 2.0 && lineAt(u, 1.2, dF.x) > 0.5) d -= 1.0;
              return;
            }
          }
        } else if (dTop < 0.8 && rowPx >= uFloorPx * 0.5) {
          ramp = metalR; d = 1.0;
          return;
        }

        // ---- the base: taller ground floors, storefront glazing, a dark entrance band
        if (v < baseH) {
          if (fam == ${R(Fam.MASONRY)}) {
            // rusticated stone with tall arched openings, a belt course above
            float ax = fract(u / 3.6) * 3.6 - 1.8;
            bool open = abs(ax) < 1.15 && v > 0.45 && (v < 5.0 || length(vec2(ax, v - 5.0)) < 1.15);
            if (v > baseH - 0.7) { d = 1.0; return; }
            if (showV && open) {
              ramp = ${R(Ramp.WINDOW)}; b = 1.0; d = v < 3.4 ? -2.0 : -1.0;
              if (v > 3.4 && v < 3.65 && rowPx >= uFloorPx * 2.0) { ramp = wallR; b = 0.0; d = 0.0; }
              return;
            }
            if (!showV && v > 0.45 && v < 5.2) { d = -1.0; return; }
            if (lineAt(v, 0.9, dF.y) > 0.5 && 0.9 * fv / mpp >= 3.0) d = -1.0;
            return;
          }
          if (v < 0.4) { ramp = metalR; d = -1.0; return; }
          if (v > baseH - 1.0) { ramp = metalR; d = 1.0; return; }
          bool pier = fract(u / 6.0) * 6.0 < 0.9 && 0.9 * fu / mpp >= 1.5;
          if (pier) { ramp = fam == ${R(Fam.GLASS)} ? ${R(Ramp.GREY_LIGHT)} : wallR; return; }
          ramp = ${R(Ramp.WINDOW)}; b = 1.0; d = v < 3.6 ? -2.0 : -1.0;
          if (nearV && lineAt(u, 1.5, dF.x) > 0.5) d += 1.0;
          return;
        }

        // ---- the shaft
        if (fam == ${R(Fam.GLASS)}) {
          ramp = ${R(Ramp.GLASS)}; b = 1.0;
          if (variant == ${Variant.SILVER}) {
            // Salesforce Tower: a white sunshade on every floor (every 2nd / 4th far away)
            if (rhythm(vb, fh, fvE / mpp, dF.y, uFloorPx) > 0.5) { ramp = ${R(Ramp.WHITE)}; b = 0.0; d = 0.0; return; }
          }
          if (variant == ${Variant.BRACED}) {
            // 181 Fremont: diagonal steel bracing wrapped around the dark glass
            float k = 1.6, P = 56.0, inv = 1.0 / sqrt(1.0 + k * k);
            float da = abs(fract((u * k - v) / P + 0.5) - 0.5) * P * inv;
            float db = abs(fract((u * k + v) / P + 0.5) - 0.5) * P * inv;
            float bw = max(1.1, 0.6 * mpp / max(min(fu, fv), 0.2)); // at least ~1.2 px wide on screen
            if (min(da, db) < bw && 2.2 * min(fu, fv) / mpp >= 1.2) { ramp = ${R(Ramp.GREY_LIGHT)}; b = 0.0; d = 1.0; return; }
          }
          // mechanical floors every 20 floors on tall towers: louvered bands that read from far away
          if (bH > 110.0 && mod(fl + 8.0, 20.0) < 1.0 && fh * fv / mpp >= 1.5 && dTop > fh * 3.0) {
            ramp = metalR; b = 0.0; d = -1.0;
            if (colPx >= uColPx * 2.0 && lineAt(u, 1.2, dF.x) > 0.5) d = -2.0;
            return;
          }
          // the slab lines: every floor, or every 2nd / 4th / 8th once floors crowd (>= floorPx apart)
          bool slab = rhythm(vb, fh, fvE / mpp, dF.y, uFloorPx) > 0.5;
          if (rowPx >= uFloorPx * 2.0 && fy < 1.0) d = 1.0;            // spandrel panel
          else if (slab) d = 1.0;                                      // the slab line
          else if (colPx >= uColPx * 1.33 && lineAt(u, sp, dF.x) > 0.5) d = 1.0; // mullion
          else if (nearV) {
            cell = vec2(col, fl);
            float hh = h21(cell + vec2(bIdx * 0.37, 1.7));
            d = hh < 0.06 ? -1.0 : hh > 0.955 ? 1.0 : 0.0;           // a few dark (blinds) and lit panes
          }
          return;
        }
        if (fam == ${R(Fam.MASONRY)}) {
          // pairs of punched windows per bay; deco towers recess the spandrels between their piers
          bool deco = variant != ${Variant.PUNCHED};
          bool pierX = fx < 0.55 || fx > 3.05;
          bool attic = crownP && crownT == ${Crown.CORNICE} && dTop < 1.7 + fh;
          float x0 = 0.725;
          bool winX = (fx > x0 && fx < x0 + 0.9) || (fx > x0 + 1.25 && fx < x0 + 2.15);
          bool winY = attic ? (fy > 1.3 && fy < 2.4) : (fy > 0.85 && fy < 2.75);
          // the top floors' windows get round heads
          if (crownP && !attic && dTop < 1.7 + fh * 3.0 && winX && fy > 2.3) {
            float cx2 = fx < x0 + 1.07 ? x0 + 0.45 : x0 + 1.7;
            winY = winY && length(vec2(fx - cx2, fy - 2.3)) < 0.45;
          }
          bool rowsV = 1.9 * fvE / mpp >= 2.0 && showH;
          if (rowsV && 0.9 * fu / mpp >= 2.0) {
            if (winX && winY) { ramp = ${R(Ramp.WINDOW)}; b = 1.0; cell = vec2(col * 2.0 + (fx > x0 + 1.07 ? 1.0 : 0.0), fl); return; }
            d = deco && !pierX ? -1.0 : 0.0;
            return;
          }
          if (rowsV && 2.15 * fu / mpp >= 2.0) {
            // (each pair reads as one opening)
            if (fx > x0 && fx < x0 + 2.15 && winY) { ramp = ${R(Ramp.WINDOW)}; b = 1.0; return; }
            d = deco && !pierX ? -1.0 : 0.0;
            return;
          }
          if (deco && 1.1 * fu / mpp >= 2.0) { d = pierX ? 0.0 : -1.0; return; }
          // far away: the stone a little darker, its rows of windows as one-pixel lines
          d = rhythm(vb - 1.8, fh, fvE / mpp, dF.y, 4.0) > 0.5 ? -2.0 : -1.0;
          return;
        }
        if (fam == ${R(Fam.BANDS)}) {
          // strong horizontal spandrels and dark ribbon windows
          if (1.5 * fvE / mpp >= 2.0) {
            if (fy < 1.5) { ramp = wallR; return; }
            ramp = ${R(Ramp.WINDOW)}; b = 1.0;
            if (colPx >= uColPx * 1.33 && lineAt(u, sp, dF.x) > 0.5) d = 1.0;
            return;
          }
          ramp = wallR; d = -1.0;
          if (rhythm(vb - 2.65, fh, fvE / mpp, dF.y, 4.0) > 0.5) d = -2.0;
          return;
        }
        if (fam == ${R(Fam.FINS)}) {
          // vertical fins; seen obliquely they hide the glass between them
          float wf = clamp(0.6 + (1.0 - fu) * 1.4, 0.6, 2.0);
          if ((sp - wf) * fu / mpp >= 2.0 && wf * fu / mpp >= 1.5) {
            if (fx < wf) { ramp = wallR; d = 1.0; return; }
            ramp = ${R(Ramp.WINDOW)}; b = 1.0;
            if (showH && lineAt(vb, fh, dF.y) > 0.5) d = 1.0;
            return;
          }
          ramp = wallR; d = fu > 0.7 ? -1.0 : 0.0;
          if (rhythm(u - wf * 0.5, sp, fu / mpp, dF.x, 3.0) > 0.5) d = 1.0;
          return;
        }
        if (fam == ${R(Fam.GRANITE)}) {
          // dark granite with thin bright window slots
          if (0.9 * fu / mpp >= 2.0) {
            if (abs(fx - 1.3) < 0.45 && fy > 0.7) { ramp = ${R(Ramp.GLASS)}; b = 1.0; d = 1.0; cell = vec2(col, fl); }
            return;
          }
          if (rhythm(u - 1.3, sp, fu / mpp, dF.x, 3.0) > 0.5) { ramp = ${R(Ramp.GLASS)}; b = 1.0; d = 0.0; }
          return;
        }
        // precast: pale concrete ribs and deep vertical slots (narrower when seen obliquely)
        float sw = 1.1 * clamp(fu * 1.2, 0.4, 1.0);
        if (sw * fu / mpp >= 2.0) {
          if (abs(fx - 1.5) < sw * 0.5) { ramp = ${R(Ramp.WINDOW)}; b = 1.0; d = -1.0; cell = vec2(col, fl); return; }
          if (rowPx >= uFloorPx * 1.5 && lineAt(vb, fh, dF.y) > 0.5) d = -1.0;
          return;
        }
        d = 0.0;
        if (rhythm(u - 1.5, sp, fu / mpp, dF.x, 3.0) > 0.5) d = -2.0;
        else if (gAF >= 0.5 || 3.0 * fu / mpp < 3.0) d = -1.0;
      }

      void main() {
        float part = floor(vMeta.x + 0.5);
        float archB = floor(vMeta.y + 0.5);
        float arch = mod(archB, 16.0);
        float fam = floor(archB / 16.0);
        float seed = vMeta.z;
        int fl = int(vMeta.w + 0.5);
        float bIdx = vBld.x;
        float roofY = vBld2.x;
        float frontW = vBld2.y;
        vec3 n = normalize(vWorldNormal);
        vec2 f = vFacade;
        // one game pixel along the facade's u and v (taken before any branch: derivatives need uniform flow)
        vec2 dF = fwidth(f);
        // meters per game pixel at this building (decided per building in the vertex stage)
        float mppB = vLodPx;
        float fog = sbFog(vWorldPos);
        bool grown = part > ${R(Part.GARDEN - 0.5)};

        // ---- paint state + flood front (color pours down from the roof with drips)
        float level = vPaint.g;
        bool painted = level > 0.5;
        float tb = uTime - vPaint.b;
        // escalations (already painted) stay painted while the blast wave travels to them
        if (painted && vPaint.a < 1.5) {
          float drip = h21(vec2(floor(f.x * 1.3), bIdx)) * 2.6 + h21(vec2(floor(f.x * 0.4), bIdx + 7.0)) * 1.4;
          float flood = uBloom.w * max(tb, 0.0);
          if (tb < 0.0 || (roofY - vYRest) > flood - drip) painted = false;
        }
        float hue = vPaint.r;

        float tone = (fract(seed * 0.61803) - 0.5) * 0.12; // each house a slightly different grey
        float ramp = ${R(Ramp.GREY)};
        float lo = tone;
        float glow = 0.0;
        bool isWall = part == ${R(Part.SIDE)} || part == ${R(Part.FRONT)} || part == ${R(Part.BAY)} || part == ${R(Part.GABLE)};
        bool famWall = fam > 0.5 && isWall;

        // ---- house window LOD, decided per building from the size of a game pixel there: far away
        // each floor is one glass band (ribbon), farther a flat wall a little darker (no 1-px dots)
        bool ribbon = mppB > uHouseRibbon;
        bool flatW = mppB > uHouseFlat;
        float cover = 0.0; // window share of the wall (for the flat tone)

        // ---- windows per archetype
        float glass = 0.0;
        vec2 cell = vec2(0.0);
        if (isWall && !famWall) {
          bool side = part == ${R(Part.SIDE)};
          if (arch == ${R(Arch.VICTORIAN)}) {
            if (part == ${R(Part.BAY)}) { glass = windows(f, 3.4, 1.25, 1.02, 2.1, 0.5, 0.0, ribbon, cell); cover = 0.5; }
            else if (part == ${R(Part.GABLE)}) {
              vec2 c = vec2(frontW * 0.5, roofY - (vYRest - f.y) + 1.1);
              vec2 d = (f - c) / vec2(0.7, 0.9);
              glass = ribbon ? 0.0 : step(dot(d, d), 1.0);
              cell = vec2(9.0, 9.0);
            } else if (!side) { glass = windows(f, 3.5, 1.9, 0.95, 2.1, 0.7, 2.9, ribbon, cell); cover = 0.3; }
            else { glass = windows(f, 3.5, 4.6, 0.8, 1.5, 1.0, 2.9, ribbon, cell) * step(0.62, h21(cell + bIdx)); cover = 0.03; }
          } else if (arch == ${R(Arch.FLATS)}) {
            if (part == ${R(Part.BAY)}) { glass = windows(f, 3.0, 1.3, 0.85, 1.7, 0.75, 0.0, ribbon, cell); cover = 0.37; }
            else if (!side) { glass = windows(f, 3.0, 2.2, 1.15, 1.7, 0.75, 3.6, ribbon, cell); cover = 0.3; }
            else { glass = windows(f, 3.0, 3.4, 0.9, 1.5, 0.8, 3.6, ribbon, cell) * step(0.4, h21(cell + bIdx)); cover = 0.08; }
          } else if (arch == ${R(Arch.COMMERCIAL)} || arch == ${R(Arch.CIVIC)}) {
            float sp = arch == ${R(Arch.CIVIC)} ? 3.0 : 2.4;
            glass = windows(f, 3.6, sp, sp * 0.55, 1.9, 0.9, 4.2, ribbon, cell);
            cover = 0.29;
            if (!side && f.y > 0.5 && f.y < 3.4) { // storefront glass
              float col = floor(f.x / 3.2);
              float fx = f.x - col * 3.2;
              glass = ribbon ? 1.0 : step(0.25, fx) * step(fx, 2.95);
              cell = vec2(col, -2.0);
            }
            if (side) { glass *= step(0.35, h21(cell + bIdx)); cover = 0.19; }
          } else if (arch == ${R(Arch.TOWER)}) {
            glass = windows(f, 3.6, 2.0, 1.55, 2.3, 0.6, 5.0, ribbon, cell);
            cover = 0.5;
          } else if (arch == ${R(Arch.STUCCO)} || arch == ${R(Arch.MARINA)}) {
            if (!side) {
              // garage door + entry at street level, a big picture window above
              float garageX = fract(seed * 0.37) > 0.5 ? frontW * 0.62 : frontW * 0.38;
              if (!flatW && f.y > 0.15 && f.y < 2.3 && abs(f.x - garageX) < 1.35) { ramp = ${R(Ramp.GREY_LIGHT)}; lo -= 0.18; }
              glass = windows(f, 3.1, max(frontW, 3.0), min(3.2, frontW * 0.42), 1.65, 0.8, 2.7, ribbon, cell);
              cover = 0.22;
            } else { glass = windows(f, 3.1, 4.0, 0.9, 1.3, 1.0, 2.7, ribbon, cell) * step(0.6, h21(cell + bIdx)); cover = 0.04; }
          } else if (arch == ${R(Arch.GENERIC)}) {
            glass = windows(f, 3.2, 3.0, 1.0, 1.4, 0.9, 1.0, ribbon, cell) * step(0.5, h21(cell + bIdx));
            cover = 0.07;
          }
          // Victorian street level: a recessed door and (often) a garage
          if (arch == ${R(Arch.VICTORIAN)} && part == ${R(Part.FRONT)} && f.y < 2.6 && !flatW) {
            float doorX = fract(seed * 0.71) > 0.5 ? frontW * 0.18 + 0.6 : frontW * 0.82 - 0.6;
            if (abs(f.x - doorX) < 0.55 && f.y > 1.2 && f.y < 3.6) { glass = 0.0; ramp = ${R(Ramp.WINDOW)}; lo = -0.6; }
            float garX = fract(seed * 0.71) > 0.5 ? frontW * 0.66 : frontW * 0.34;
            if (fract(seed * 0.29) > 0.45 && abs(f.x - garX) < 1.3 && f.y > 0.1 && f.y < 2.3) { ramp = ${R(Ramp.GREY_LIGHT)}; lo = -0.12; }
          }
          // far away: the windows become the wall's average tone, the same on every pixel of it
          if (flatW) { glass = 0.0; lo -= 0.3 * cover; }
        }

        // SF roofs: a patchwork of pale tar-and-gravel, dark membrane and silvery paint
        float roofKind = fract(seed * 0.4141);
        // Victorian articulation: light window frames + floor belt courses on facades
        // (none once they are under a game pixel: ribbon and flat houses)
        float trimMask = 0.0;
        float beltMask = 0.0;
        if (isWall && !famWall && glass < 0.5 && !ribbon && (arch == ${R(Arch.VICTORIAN)} || arch == ${R(Arch.FLATS)} || arch == ${R(Arch.MARINA)})) {
          vec2 c2;
          float fh = arch == ${R(Arch.VICTORIAN)} ? 3.5 : 3.0;
          float sp = arch == ${R(Arch.VICTORIAN)} ? (part == ${R(Part.BAY)} ? 1.25 : 1.9) : (part == ${R(Part.BAY)} ? 1.3 : 2.2);
          float ww = arch == ${R(Arch.VICTORIAN)} ? (part == ${R(Part.BAY)} ? 0.8 : 0.95) : (part == ${R(Part.BAY)} ? 0.85 : 1.15);
          float wh = arch == ${R(Arch.VICTORIAN)} ? (part == ${R(Part.BAY)} ? 2.0 : 2.1) : 1.7;
          float sill = arch == ${R(Arch.VICTORIAN)} ? (part == ${R(Part.BAY)} ? 0.55 : 0.7) : 0.75;
          float g0 = part == ${R(Part.BAY)} ? 0.0 : (arch == ${R(Arch.VICTORIAN)} ? 2.9 : 3.6);
          if (part != ${R(Part.SIDE)}) {
            trimMask = windows(f, fh, sp, ww + 0.42, wh + 0.5, sill - 0.28, g0, false, c2);
            // belt course at each floor line
            float v = f.y - g0;
            if (v > 0.0 && fract(v / fh) * fh < 0.32) { trimMask = 1.0; beltMask = 1.0; }
          }
        }
        if (trimMask > 0.5) { lo += 0.07; }

        // roofs on one ramp: the patchwork is light offsets the fog can compress
        if (part == ${R(Part.ROOF)}) {
          ramp = ${R(Ramp.GREY_LIGHT)};
          lo = (roofKind < 0.55 ? -0.06 : roofKind < 0.8 ? -0.34 : 0.0) + tone;
          // big flat roofs are patchworks of re-roofing: large, calm tone patches
          vec2 pc = floor(vWorldPos.xz / vec2(9.0, 7.0) + vec2(bIdx * 0.37, 0.0));
          lo += (h21(pc) - 0.5) * 0.09;
        }
        else if (part == ${R(Part.ROOF_SLOPE)}) { ramp = ${R(Ramp.GREY_LIGHT)}; lo = -0.36 + tone * 0.5; }
        else if (part == ${R(Part.TRIM)}) { ramp = fam == ${R(Fam.MASONRY)} ? ${R(Ramp.STONE)} : ${R(Ramp.GREY_LIGHT)}; lo = 0.04; }
        else if (part == ${R(Part.CLUTTER)}) { ramp = ${R(Ramp.GREY_LIGHT)}; lo = -0.06; }
        else if (part == ${R(Part.STOOP)}) { ramp = ${R(Ramp.GREY_LIGHT)}; lo = 0.02; }

        // grounding: street level is a little darker (occlusion)
        if (isWall) lo -= 0.09 * (1.0 - smoothstep(0.0, 3.2, f.y));

        if (painted && !famWall && !grown) {
          // levels 1-2 are calm Painted Ladies (body, white or one accent trim, belts and cornices only);
          // level 3 is the riot (frames, neighboring hues on bays and gables, wavy bands)
          bool calm = level < 2.5;
          float body = hueRamp(hue);
          float trimHue = calm ? (mod(seed, 3.0) < 2.0 ? -1.0 : hue + 3.0) : (mod(seed, 3.0) < 1.0 ? -1.0 : hue + 3.0); // -1 = white trim
          if (isWall) {
            ramp = body;
            lo = tone * 0.5 + 0.05;
            if (!calm) {
              // Hundertwasser: irregular wavy bands of neighboring hues
              float wave = 0.8 * sin(f.x * 0.85 + seed) + 0.45 * sin(f.x * 2.1 + seed * 3.1);
              float band = floor((f.y + wave) / 2.3);
              float off = mod(band + seed, 3.0);
              ramp = hueRamp(hue + (off < 1.0 ? 0.0 : off < 2.0 ? 1.0 : 5.0));
            }
            if (part == ${R(Part.BAY)}) { if (calm) lo += 0.05; else ramp = hueRamp(hue + 1.0); }
            if (part == ${R(Part.GABLE)} && !calm) ramp = hueRamp(hue + 2.0);
            if (trimMask > 0.5 && (!calm || beltMask > 0.5)) { ramp = trimHue < 0.0 ? ${R(Ramp.WHITE)} : hueRamp(trimHue); lo = trimHue < 0.0 ? 0.0 : 0.12; }
          } else if (part == ${R(Part.TRIM)} || part == ${R(Part.STOOP)}) {
            ramp = trimHue < 0.0 ? ${R(Ramp.WHITE)} : hueRamp(trimHue);
            lo = 0.08;
          } else if (part == ${R(Part.ROOF)}) {
            if (level > 1.5 && fam > 0.5) {
              // a tower's roofs and setbacks at level 2+: garden turf with flowers in its hue
              ramp = ${R(Ramp.GREEN)};
              vec2 q = floor(vWorldPos.xz / 1.3);
              float fh = h21(q + bIdx);
              lo = -0.04 + (h21(floor(vWorldPos.xz / 5.0)) - 0.5) * 0.12;
              if (fh > 0.86) { ramp = hueRamp(hue + (fh > 0.93 ? 1.0 : 0.0)); lo = 0.14; }
            } else {
              // the barf landed here: splat blotches + drips across the roof
              vec2 q = vWorldPos.xz * 0.45;
              vec2 iq = floor(q);
              float bl = 0.0;
              for (int yy = -1; yy <= 1; yy++)
                for (int xx = -1; xx <= 1; xx++) {
                  vec2 g = iq + vec2(float(xx), float(yy));
                  vec2 o = vec2(h21(g + bIdx), h21(g + bIdx + 3.7));
                  float r = 0.25 + 0.45 * h21(g + 9.1);
                  bl = max(bl, 1.0 - smoothstep(r * 0.7, r, length(q - g - o)));
                }
              ramp = hueRamp(hue);
              lo = bl > 0.5 ? 0.16 : -0.02; // wet, brighter splats of the same hue
            }
          } else if (part == ${R(Part.ROOF_SLOPE)}) {
            ramp = hueRamp(hue + 5.0);
            lo = -0.02;
          } else if (part == ${R(Part.CLUTTER)}) {
            ramp = hueRamp(hue + 2.0);
          }
        }

        // ---- a painted tower's garden blobs (bushes / trees) and onion domes
        if (grown) {
          bool tree = (fl & 16) != 0;
          if (part > ${R(Part.DOME - 0.5)}) {
            // golden onion dome on a drum of the building's hue
            ramp = f.y < 1.2 ? hueRamp(hue) : ${R(Ramp.YELLOW)};
            lo = 0.04;
          } else {
            ramp = ${R(Ramp.GREEN)};
            lo = tree ? -0.08 : 0.0;
            float bh = h21(floor(n.xz * 3.0 + 3.0) + vec2(bIdx * 0.11, floor(vWorldPos.y)));
            if (bh > (tree ? 0.8 : 0.6)) { ramp = hueRamp(hue + (bh > 0.9 ? 0.0 : 1.0)); lo = 0.12; }
          }
        }

        // aim glint: the building in the line of fire shimmers (a slow sweep of light)
        float loPreAim = lo;
        if (abs(bIdx - uTarget) < 0.5) {
          float sweep = fract(uTime * 0.9 - (vWorldPos.y - vBld.z) * 0.035);
          lo += 0.06 + 0.12 * smoothstep(0.75, 1.0, sweep);
        }
        float aimLo = lo - loPreAim;
        float light;
        if (famWall) {
          // ---- a tower facade, in whole ramp steps after the atmospheric perspective
          vec3 dv = normalize(vWorldPos - cameraPosition);
          gSL = skyMirror(normalize(vec3(dv.x, max(dv.y, -0.02) * 0.2, dv.z)));
          gAF = smoothstep(0.08, 0.66, floor(clamp(fog, 0.0, 1.0) * 255.0 + 0.5) / 255.0) * 0.9;
          gMpp = mppB;
          float bTop = roofY;
          float bH = max(bTop - vBld.z, 1.0);
          // the building's view direction (one per building, so each face is one decision)
          vec3 vB = normalize(cameraPosition - vec3(vBld.y, clamp(cameraPosition.y, vBld.z, bTop), vBld.w));
          vec3 tU = normalize(vec3(-n.z, 0.0, n.x) + vec3(1e-5));
          float tv = dot(tU, vB);
          float fu = sqrt(max(1.0 - tv * tv, 0.0));
          float fv = sqrt(max(1.0 - vB.y * vB.y, 0.0));
          int variant = (fl >> 6) & 3;
          int crownT = (fl >> 4) & 3;
          bool crownP = (fl & 8) != 0;
          bool pent = (fl & 4) != 0;
          float dTop = frontW - vYRest; // (families: aBld2.y is this part's top)
          float fr, fd, fbase, fglow;
          vec2 fcell;
          towerFacade(fam, variant, crownT, crownP, pent, f, dTop, bH, fu, fv, mppB, dF, bIdx, fr, fd, fbase, fglow, fcell);
          // the glass: mirrors the bright fog sky at grazing angles and higher up (calm bands as the
          // light crosses the ramp's steps), the low sun where it reflects toward us
          float sh = sbShadow(vWorldPos, n);
          float fres = 1.0 - abs(dot(n, vB));
          float hRel = clamp((vYRest - vBld.z) / bH, 0.0, 1.0);
          float sunR = pow(max(dot(reflect(-uSunDir, n), vB), 0.0), 8.0);
          float gl = 0.24 + 0.34 * fres + 0.14 * hRel + uGlassBands * sin(vYRest * 0.055 + seed * 0.37) + 0.3 * sunR * sh - 0.06 * (1.0 - sh);
          if (variant == ${Variant.SILVER} && fam == ${R(Fam.GLASS)}) gl += 0.12;
          if (variant == ${Variant.BRACED} && fam == ${R(Fam.GLASS)}) gl -= 0.08;
          if (fr == ${R(Ramp.WINDOW)}) gl -= 0.04;
          gl += aimLo + tone * 0.5;
          float wlo = lo + (fam == ${R(Fam.MASONRY)} ? 0.03 : fam == ${R(Fam.GRANITE)} ? -0.02 : fam == ${R(Fam.PRECAST)} ? 0.06 : 0.04);
          float lw = sbLight(vWorldPos, n, wlo, 1.0);
          ramp = fr;
          glow = fglow;
          if (painted) {
            bool calm = level < 2.5;
            float body = hueRamp(hue);
            // trims: white on 2 of 3 towers, the complementary accent on the third
            float trimR = mod(seed, 3.0) < 2.0 ? ${R(Ramp.WHITE)} : hueRamp(hue + 3.0);
            lw = 0.2 + lw * 0.52;
            bool isGlass = fbase > 0.5 && fbase < 1.5;
            // level 3, Hundertwasser on a skyscraper: floor-tall wavy bands running through all six
            // hues, over the walls and the glass alike
            float wave = 1.6 * sin(f.x * 0.17 + seed) + 0.8 * sin(f.x * 0.47 + seed * 3.1);
            float h3 = hue + mod(floor((f.y + wave) / 3.8) + floor(seed / 7.0), 6.0);
            if (isGlass && fd > 0.5 && fr != ${R(Ramp.WINDOW)}) {
              // the curtain wall's slab lines and mullions become the stained glass's lead
              ramp = calm ? body : hueRamp(h3); fbase = 2.0; fd = 2.0; glow = 0.0;
            } else if (isGlass) {
              if (calm) {
                // stained glass: a rainbow ribbon of the tower's hue and its neighbors spiralling up
                // the tower in straight diagonal bands about three floors tall (not per-pane confetti)
                float sf = (vYRest - vBld.z) / 11.7 + f.x / 19.0;
                float k = mod(floor(sf), 4.0);
                float off = k < 0.5 ? -1.0 : k < 1.5 ? 0.0 : k < 2.5 ? 1.0 : 0.0;
                ramp = hueRamp(hue + off);
                fd = 4.0 + (fd < -0.5 ? -1.0 : fd > 0.5 ? 1.0 : 0.0) + (k > 2.5 ? 1.0 : 0.0);
                glow = uGlassGlow;
              } else {
                ramp = hueRamp(h3);
                fd = 5.0 + (fd < -0.5 ? -1.0 : 0.0);
                glow = uGlassGlow3;
              }
              fbase = 2.0;
            } else if (fr == ${R(Ramp.GLOW_WHITE)}) {
              // crowns turn gold; Salesforce's LED crown runs the rainbow
              ramp = crownT == ${Crown.LATTICE} ? hueRamp(hue + floor(f.x / 1.5)) : ${R(Ramp.YELLOW)};
              fd = 5.0;
            } else if (fd > 0.5) {
              ramp = trimR; fd = 0.0; lw = 0.25 + lw * 0.75;
            } else {
              ramp = calm ? body : hueRamp(h3);
              fd = min(fd, 0.0) + (calm ? 0.0 : -1.0);
            }
            // level 2+: hanging gardens, a planter band of flowers on every third floor
            float pv = f.y - 8.0;
            bool inCrown = crownP && dTop < 7.0;
            if (level > 1.5 && f.y > 9.0 && !inCrown && !pent) {
              bool wide = 1.1 * fv / mppB >= 1.5;
              bool band = wide ? fract(pv / 11.4) * 11.4 < 1.1 : rhythm(pv, 11.4, fv / mppB, dF.y, 4.0) > 0.5;
              if (band) {
                // (flowers only where the band is wider than a pixel: far away it is one green line)
                float fl2 = wide ? h21(floor(f * vec2(0.8, 1.0)) + bIdx) : 0.0;
                ramp = fl2 > 0.75 ? hueRamp(hue + (fl2 > 0.88 ? 1.0 : 5.0)) : ${R(Ramp.GREEN)};
                fbase = 0.0; fd = fl2 > 0.75 ? 1.0 : 0.0; glow = 0.0;
              }
            }
            // level 3: vines and flowers spill down the walls under every setback
            if (!calm && !crownP) {
              float colV = floor(f.x / 2.2);
              float drape = 1.5 + 7.0 * pow(h21(vec2(colV, bIdx)), 2.0);
              if (dTop > -0.5 && dTop < drape) {
                ramp = h21(floor(f * vec2(1.1, 0.9)) + bIdx) > 0.84 ? hueRamp(hue + 1.0) : ${R(Ramp.GREEN)};
                fbase = 0.0; fd = 0.0; glow = 0.0;
              }
            }
          }
          float S = fbase > 1.5 ? floor(stepPos(fd / 7.0) + 0.5) : floor(stepPos(fbase > 0.5 ? gl : lw) + 0.5) + fogSteps(fd);
          light = lightAtStep(S);
        } else if (glass > 0.5) {
          vec3 v = normalize(cameraPosition - vWorldPos);
          vec3 rf = reflect(-uSunDir, n);
          float glint = pow(max(dot(rf, v), 0.0), 6.0);
          float sky = 0.5 + 0.5 * clamp(n.y + (fract(f.y / 3.4) - 0.3), -1.0, 1.0);
          if (painted) {
            // stained glass glowing from inside: one accent hue per house at
            // level 1-2 (Painted Ladies restraint; bright in itself, no halo dust);
            // every window its own hue with a soft halo at level 3 (Hundertwasser riot)
            float wh = level > 2.5 ? floor(h21(cell + vec2(bIdx * 0.13, 3.0)) * 6.0) : 0.0;
            float accent = mod(seed, 2.0) < 1.0 ? 2.0 : 4.0;
            ramp = hueRamp(hue + accent + wh);
            light = (level > 2.5 ? 0.62 : 0.72) + 0.1 * h21(cell + 11.0);
            glow = level > 2.5 ? uGlassGlow3 : uGlassGlow;
          } else {
            ramp = ${R(Ramp.WINDOW)};
            light = 0.22 + 0.2 * sky + 0.55 * glint * sbShadow(vWorldPos, n);
          }
        } else {
          light = sbLight(vWorldPos, n, lo, 1.0);
          // paint lives in the saturated middle of each ramp: explosive, not pastel
          if (painted || (grown && part < ${R(Part.DOME - 0.5)})) light = 0.2 + light * 0.52;
        }
        if (!gl_FrontFacing) n = -n;
        // the blast's shockwave ring races across the roofs
        float rr, rl, rg;
        if (sbRing(vWorldPos, n, rr, rl, rg)) { ramp = rr; light = rl; glow = rg; }
        float sid = fract(bIdx * 0.6180339 + 0.1);
        sbWrite(ramp, light, fog, glow, vViewNormal, sid, 1.0);
      }
    `,
  });
  // the angular size of one game pixel for the facade LOD: from this pass's camera and target
  mat.onBeforeRender = (renderer, _scene, camera) => {
    const rt = renderer.getRenderTarget();
    const h = rt ? rt.height : renderer.domElement.height;
    const p11 = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    if (h > 0 && p11 > 0) facadeUniforms.uPixelAngle.value = 2 / (p11 * h);
  };
  return mat;
}
