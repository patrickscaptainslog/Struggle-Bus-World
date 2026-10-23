import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_COMMON, GLSL_OUT } from '../render/materials';
import { Ramp, HUE_RAMPS } from '../render/palette';
import { Part } from './BuildingMesher';
import { Arch } from './tiles';
import { blastUniforms, GLSL_BLAST_RING } from './GroundPaint';

// One shader for every building. Grey state: Hopper — cool battleship
// greys, lighter trim, dark glass that catches the low sun. Painted state:
// Painted Ladies body + contrasting trim, stained-glass windows that glow,
// walls that wobble; level 3 adds Hundertwasser's wavy color bands.
// Color floods DOWN from the roof with drips when the barf lands, while the
// building does a squash-and-stretch pop.

export const paintUniforms = {
  uPaint: { value: null as THREE.Texture | null },
  uPaintW: { value: 1024 },
  uBloom: { value: new THREE.Vector4(config.bloom.popDuration, config.bloom.squash, config.bloom.overshoot, config.bloom.floodSpeed) },
  uWobble: { value: new THREE.Vector2(config.bloom.wobbleAmp, config.bloom.wobbleSpeed) },
  /** building index the loaded projectile would hit (-1 = none): it glints (the only aim cue; no HUD) */
  uTarget: { value: -1 },
  /** game time it became the target (its glint sweep starts right then) */
  uTargetT: { value: 0 },
  /** glint: light lift (>= one ramp step), sweep lift, sweeps per second (config.splat.glint*) */
  uGlint: { value: new THREE.Vector3(config.splat.glintLift, config.splat.glintSweep, config.splat.glintRate) },
  /** the color flood starts this far down from the roof (m): the impact frame already shows the hit */
  uFloodHead: { value: config.bloom.floodHead },
};

const HUES = HUE_RAMPS.map((r) => r.toFixed(1)).join(', ');

export function makeBuildingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...globals, ...paintUniforms, uBlastRing: blastUniforms.uBlastRing, uBlastRing2: blastUniforms.uBlastRing2 },
    vertexShader: /* glsl */ `
      ${GLSL_COMMON}
      precision highp sampler2D;
      uniform sampler2D uPaint;
      uniform float uPaintW;
      uniform vec4 uBloom;
      uniform vec2 uWobble;
      in vec2 aFacade;
      in vec4 aMeta;
      in vec4 aBld;
      in vec2 aBld2;
      out vec2 vFacade;
      flat out vec4 vMeta;
      flat out vec4 vPaint;
      flat out vec4 vBld;
      flat out vec2 vBld2;
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
        vYRest = p.y;
        float baseY = aBld.z;
        float roofY = aBld2.x;
        float hgt = max(roofY - baseY, 1.0);
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
        vFacade = aFacade;
        vMeta = aMeta;
        vPaint = paint;
        vBld = aBld;
        vBld2 = aBld2;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      uniform vec4 uBloom;
      uniform float uTarget;
      uniform float uTargetT;
      uniform vec3 uGlint;
      uniform float uFloodHead;
      ${GLSL_BLAST_RING}
      in vec2 vFacade;
      flat in vec4 vMeta;
      flat in vec4 vPaint;
      flat in vec4 vBld;
      flat in vec2 vBld2;
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
      // groundH = height of the ground floor band
      float windows(vec2 f, float fh, float sp, float ww, float wh, float sill, float groundH, out vec2 cell) {
        float v = f.y - groundH;
        if (v < 0.0) { cell = vec2(-1.0); return 0.0; }
        float fl = floor(v / fh);
        float fy = v - fl * fh;
        float col = floor(f.x / sp);
        float fx = f.x - col * sp;
        cell = vec2(col, fl);
        float x0 = (sp - ww) * 0.5;
        return step(x0, fx) * step(fx, x0 + ww) * step(sill, fy) * step(fy, sill + wh);
      }

      void main() {
        float part = floor(vMeta.x + 0.5);
        float arch = floor(vMeta.y + 0.5);
        float seed = vMeta.z;
        float flags = vMeta.w;
        bool frontFacing = mod(flags, 2.0) > 0.5;
        float bIdx = vBld.x;
        float roofY = vBld2.x;
        float frontW = vBld2.y;
        vec3 n = normalize(vWorldNormal);
        vec2 f = vFacade;
        // meters per game pixel here (taken before any branch: derivatives need uniform flow)
        float mpp = max(length(dFdx(vWorldPos)), length(dFdy(vWorldPos)));

        // ---- paint state + flood front (color pours down from the roof with drips)
        float level = vPaint.g;
        bool painted = level > 0.5;
        float tb = uTime - vPaint.b;
        // escalations (already painted) stay painted while the blast wave travels to them
        if (painted && vPaint.a < 1.5) {
          float drip = h21(vec2(floor(f.x * 1.3), bIdx)) * 2.6 + h21(vec2(floor(f.x * 0.4), bIdx + 7.0)) * 1.4;
          float flood = uBloom.w * max(tb, 0.0) + uFloodHead;
          if (tb < 0.0 || (roofY - vYRest) > flood - drip) painted = false;
        }
        float hue = vPaint.r;

        float tone = (fract(seed * 0.61803) - 0.5) * 0.12; // each house a slightly different grey
        float ramp = ${Ramp.GREY}.0;
        float lo = tone;
        float glow = 0.0;
        bool isWall = part == ${Part.SIDE}.0 || part == ${Part.FRONT}.0 || part == ${Part.BAY}.0 || part == ${Part.GABLE}.0;

        // ---- windows per archetype
        float glass = 0.0;
        vec2 cell = vec2(0.0);
        if (isWall) {
          bool side = part == ${Part.SIDE}.0;
          if (arch == ${Arch.VICTORIAN}.0) {
            if (part == ${Part.BAY}.0) glass = windows(f, 3.4, 1.25, 1.02, 2.1, 0.5, 0.0, cell);
            else if (part == ${Part.GABLE}.0) {
              vec2 c = vec2(frontW * 0.5, roofY - (vYRest - f.y) + 1.1);
              vec2 d = (f - c) / vec2(0.7, 0.9);
              glass = step(dot(d, d), 1.0);
              cell = vec2(9.0, 9.0);
            } else if (!side) glass = windows(f, 3.5, 1.9, 0.95, 2.1, 0.7, 2.9, cell);
            else glass = windows(f, 3.5, 4.6, 0.8, 1.5, 1.0, 2.9, cell) * step(0.62, h21(cell + bIdx));
          } else if (arch == ${Arch.FLATS}.0) {
            if (part == ${Part.BAY}.0) glass = windows(f, 3.0, 1.3, 0.85, 1.7, 0.75, 0.0, cell);
            else if (!side) glass = windows(f, 3.0, 2.2, 1.15, 1.7, 0.75, 3.6, cell);
            else glass = windows(f, 3.0, 3.4, 0.9, 1.5, 0.8, 3.6, cell) * step(0.4, h21(cell + bIdx));
          } else if (arch == ${Arch.COMMERCIAL}.0 || arch == ${Arch.CIVIC}.0) {
            float sp = arch == ${Arch.CIVIC}.0 ? 3.0 : 2.4;
            glass = windows(f, 3.6, sp, sp * 0.55, 1.9, 0.9, 4.2, cell);
            if (!side && f.y > 0.5 && f.y < 3.4) { // storefront glass
              float col = floor(f.x / 3.2);
              float fx = f.x - col * 3.2;
              glass = step(0.25, fx) * step(fx, 2.95);
              cell = vec2(col, -2.0);
            }
            if (side) glass *= step(0.35, h21(cell + bIdx));
          } else if (arch == ${Arch.TOWER}.0) {
            glass = windows(f, 3.6, 2.0, 1.55, 2.3, 0.6, 5.0, cell);
          } else if (arch == ${Arch.STUCCO}.0 || arch == ${Arch.MARINA}.0) {
            if (!side) {
              // garage door + entry at street level, a big picture window above
              float garageX = fract(seed * 0.37) > 0.5 ? frontW * 0.62 : frontW * 0.38;
              if (f.y > 0.15 && f.y < 2.3 && abs(f.x - garageX) < 1.35) { ramp = ${Ramp.GREY_LIGHT}.0; lo -= 0.18; }
              glass = windows(f, 3.1, max(frontW, 3.0), min(3.2, frontW * 0.42), 1.65, 0.8, 2.7, cell);
            } else glass = windows(f, 3.1, 4.0, 0.9, 1.3, 1.0, 2.7, cell) * step(0.6, h21(cell + bIdx));
          } else if (arch == ${Arch.GENERIC}.0) {
            glass = windows(f, 3.2, 3.0, 1.0, 1.4, 0.9, 1.0, cell) * step(0.5, h21(cell + bIdx));
          }
          // Victorian street level: a recessed door and (often) a garage
          if (arch == ${Arch.VICTORIAN}.0 && part == ${Part.FRONT}.0 && f.y < 2.6) {
            float doorX = fract(seed * 0.71) > 0.5 ? frontW * 0.18 + 0.6 : frontW * 0.82 - 0.6;
            if (abs(f.x - doorX) < 0.55 && f.y > 1.2 && f.y < 3.6) { glass = 0.0; ramp = ${Ramp.WINDOW}.0; lo = -0.6; }
            float garX = fract(seed * 0.71) > 0.5 ? frontW * 0.66 : frontW * 0.34;
            if (fract(seed * 0.29) > 0.45 && abs(f.x - garX) < 1.3 && f.y > 0.1 && f.y < 2.3) { ramp = ${Ramp.GREY_LIGHT}.0; lo = -0.12; }
          }
        }

        // seen from high above, windows shrink under ~2 game pixels and alias into
        // moire (leaving no flat wall to keep the dither off): melt them into a
        // slightly darker wall tone, building by building (no visible ring)
        bool melt = isWall && uFogLayer2.w > 0.001 && mpp * uFogLayer2.w > 1.1 * (0.8 + 0.4 * fract(seed * 0.377));
        if (melt) {
          if (glass > 0.5 || ramp == ${Ramp.WINDOW}.0) { glass = 0.0; ramp = ${Ramp.GREY}.0; }
          lo -= 0.05;
        }

        // SF roofs: a patchwork of pale tar-and-gravel, dark membrane and silvery paint
        float roofKind = fract(seed * 0.4141);
        // Victorian articulation: light window frames + floor belt courses on facades
        float trimMask = 0.0;
        if (isWall && glass < 0.5 && !melt && (arch == ${Arch.VICTORIAN}.0 || arch == ${Arch.FLATS}.0 || arch == ${Arch.MARINA}.0)) {
          vec2 c2;
          float fh = arch == ${Arch.VICTORIAN}.0 ? 3.5 : 3.0;
          float sp = arch == ${Arch.VICTORIAN}.0 ? (part == ${Part.BAY}.0 ? 1.25 : 1.9) : (part == ${Part.BAY}.0 ? 1.3 : 2.2);
          float ww = arch == ${Arch.VICTORIAN}.0 ? (part == ${Part.BAY}.0 ? 0.8 : 0.95) : (part == ${Part.BAY}.0 ? 0.85 : 1.15);
          float wh = arch == ${Arch.VICTORIAN}.0 ? (part == ${Part.BAY}.0 ? 2.0 : 2.1) : 1.7;
          float sill = arch == ${Arch.VICTORIAN}.0 ? (part == ${Part.BAY}.0 ? 0.55 : 0.7) : 0.75;
          float g0 = part == ${Part.BAY}.0 ? 0.0 : (arch == ${Arch.VICTORIAN}.0 ? 2.9 : 3.6);
          if (part != ${Part.SIDE}.0) {
            trimMask = windows(f, fh, sp, ww + 0.42, wh + 0.5, sill - 0.28, g0, c2);
            // belt course at each floor line
            float v = f.y - g0;
            if (v > 0.0 && fract(v / fh) * fh < 0.32) trimMask = 1.0;
          }
        }
        if (trimMask > 0.5) { lo += 0.07; }

        if (part == ${Part.ROOF}.0) {
          if (roofKind < 0.55) { ramp = ${Ramp.GREY_LIGHT}.0; lo = -0.06 + tone; }
          else if (roofKind < 0.8) { ramp = ${Ramp.ROOF_DARK}.0; lo = 0.1 + tone; }
          else { ramp = ${Ramp.GREY}.0; lo = 0.06 + tone; }
          // big flat roofs are patchworks of re-roofing: large, calm tone patches
          vec2 pc = floor(vWorldPos.xz / vec2(9.0, 7.0) + vec2(bIdx * 0.37, 0.0));
          lo += (h21(pc) - 0.5) * 0.09;
        }
        else if (part == ${Part.ROOF_SLOPE}.0) { ramp = ${Ramp.ROOF_DARK}.0; lo = -0.04 + tone * 0.5; }
        else if (part == ${Part.TRIM}.0) { ramp = ${Ramp.GREY_LIGHT}.0; lo = 0.04; }
        else if (part == ${Part.CLUTTER}.0) { ramp = ${Ramp.GREY_LIGHT}.0; lo = -0.06; }
        else if (part == ${Part.STOOP}.0) { ramp = ${Ramp.GREY_LIGHT}.0; lo = 0.02; }

        // grounding: street level is a little darker (occlusion)
        if (isWall) lo -= 0.09 * (1.0 - smoothstep(0.0, 3.2, f.y));

        if (painted) {
          float body = hueRamp(hue);
          float trimHue = mod(seed, 3.0) < 1.0 ? -1.0 : hue + 3.0; // -1 = white trim
          if (isWall) {
            ramp = body;
            lo = tone * 0.5 + 0.05;
            if (level > 2.5) {
              // Hundertwasser: irregular wavy bands of neighboring hues
              float wave = 0.8 * sin(f.x * 0.85 + seed) + 0.45 * sin(f.x * 2.1 + seed * 3.1);
              float band = floor((f.y + wave) / 2.3);
              float off = mod(band + seed, 3.0);
              ramp = hueRamp(hue + (off < 1.0 ? 0.0 : off < 2.0 ? 1.0 : 5.0));
            }
            if (part == ${Part.BAY}.0) ramp = hueRamp(hue + 1.0);
            if (part == ${Part.GABLE}.0) ramp = hueRamp(hue + 2.0);
            if (trimMask > 0.5) { ramp = trimHue < 0.0 ? ${Ramp.WHITE}.0 : hueRamp(trimHue); lo = trimHue < 0.0 ? 0.0 : 0.12; }
          } else if (part == ${Part.TRIM}.0 || part == ${Part.STOOP}.0) {
            ramp = trimHue < 0.0 ? ${Ramp.WHITE}.0 : hueRamp(trimHue);
            lo = 0.08;
          } else if (part == ${Part.ROOF}.0) {
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
          } else if (part == ${Part.ROOF_SLOPE}.0) {
            ramp = hueRamp(hue + 5.0);
            lo = -0.02;
          } else if (part == ${Part.CLUTTER}.0) {
            ramp = hueRamp(hue + 2.0);
          }
        }

        float light;
        if (glass > 0.5) {
          vec3 v = normalize(cameraPosition - vWorldPos);
          vec3 rf = reflect(-uSunDir, n);
          float glint = pow(max(dot(rf, v), 0.0), 6.0);
          float sky = 0.5 + 0.5 * clamp(n.y + (fract(f.y / 3.4) - 0.3), -1.0, 1.0);
          if (painted) {
            // stained glass glowing from inside: one accent hue per house at
            // level 1-2 (Painted Ladies restraint); every window its own hue at
            // level 3 (Hundertwasser riot)
            float wh = level > 2.5 ? floor(h21(cell + vec2(bIdx * 0.13, 3.0)) * 6.0) : 0.0;
            float accent = mod(seed, 2.0) < 1.0 ? 2.0 : 4.0;
            ramp = hueRamp(hue + accent + wh);
            light = 0.62 + 0.1 * h21(cell + 11.0);
            glow = 0.38; // a soft glow, not a halo storm across the facade
          } else {
            ramp = ${Ramp.WINDOW}.0;
            light = 0.22 + 0.2 * sky + 0.55 * glint * sbShadow(vWorldPos, n);
          }
        } else {
          light = sbLight(vWorldPos, n, lo, 1.0);
          // paint lives in the saturated middle of each ramp: explosive, not pastel
          if (painted) light = 0.2 + light * 0.52;
        }
        // aim glint: the building a tap would hit lifts a full ramp step (flat walls can't snap it away,
        // painted ones too), and a band of light sweeps up it, starting the moment it became the target
        if (abs(bIdx - uTarget) < 0.5) {
          float sweep = fract((uTime - uTargetT) * uGlint.z - (vWorldPos.y - vBld.z) * 0.035);
          light += uGlint.x + uGlint.y * smoothstep(0.55, 1.0, sweep);
        }
        if (!gl_FrontFacing) n = -n;
        // the blast's shockwave ring races across the roofs
        float rr, rl, rg;
        if (sbRing(vWorldPos, n, rr, rl, rg)) { ramp = rr; light = rl; glow = rg; }
        float fog = sbFog(vWorldPos);
        float sid = fract(bIdx * 0.6180339 + 0.1);
        sbWrite(ramp, light, fog, glow, vViewNormal, sid, 1.0);
      }
    `,
  });
}
