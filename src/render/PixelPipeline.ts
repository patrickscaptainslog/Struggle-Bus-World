import * as THREE from 'three';
import { config } from '../config';
import { globals, SHADOW_LAYER } from './materials';
import { makePaletteTexture, Ramp } from './palette';

// Low-res 3D pixel-art renderer.
//
//  1. sun depth pass (shadow map, snapped to its own texel grid)
//  2. scene pass into a small G-buffer (ramp, light, fog, glow | normal, id)
//  3. glow pass: blurred emissive at half res
//  4. resolve pass: ramp + ordered dither, outlines, creases, fog, sky -> palette RGB
//  5. upscale pass: nearest-neighbor to the canvas, shifted by the camera's
//     sub-pixel remainder so motion is smooth while pixels stay locked
//
// Shimmer control: the camera is translated in its own right/up plane to a
// multiple of one game pixel at the focus distance; the leftover fraction is
// applied as a screen-space shift at upscale. The dither pattern is anchored
// to the same snapped grid, so it travels with the world under translation.

const MARGIN = 2;

export interface PixelFrameInfo {
  /** Size of the visible low-res image (without margin). */
  width: number;
  height: number;
  /** Device pixels per game pixel. */
  scale: number;
}

export class PixelPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  /** Camera actually used to render (snapped copy of `camera`). */
  private readonly snapCam = new THREE.PerspectiveCamera();
  private readonly sunCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  private gbuf!: THREE.WebGLRenderTarget;
  private shadowRT!: THREE.WebGLRenderTarget;
  private glowA!: THREE.WebGLRenderTarget;
  private glowB!: THREE.WebGLRenderTarget;
  private resolved!: THREE.WebGLRenderTarget;
  private readonly palette = makePaletteTexture();
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly resolveMat: THREE.ShaderMaterial;
  private readonly glowMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly upscaleMat: THREE.ShaderMaterial;
  private readonly depthMat = new THREE.MeshDepthMaterial();
  info: PixelFrameInfo = { width: 1, height: 1, scale: 1 };
  /** Fractional pixel offset of the true camera vs the snapped one. */
  private readonly subPixel = new THREE.Vector2();
  /** Integer pixel position of the snapped camera (anchors the dither pattern). */
  private readonly ditherOrigin = new THREE.Vector2();
  /** World point the camera is focused on (snap plane distance + shadow center). */
  readonly focus = new THREE.Vector3();
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // palette bytes go straight out
    this.renderer.setPixelRatio(1);
    this.camera = new THREE.PerspectiveCamera(40, 1, 1.5, 9000);
    this.sunCam.layers.set(SHADOW_LAYER);

    const quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(quadGeo);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.resolveMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tColor: { value: null },
        tAux: { value: null },
        tDepth: { value: null },
        tGlow: { value: null },
        tPalette: { value: this.palette },
        uNearFar: { value: new THREE.Vector2(1, 1000) },
        uDitherOrigin: { value: this.ditherOrigin },
        uDitherWidth: { value: config.render.ditherWidth },
        uOutline: { value: new THREE.Vector3(config.render.outlineDepth, config.render.creaseHighlight, config.render.outlineFadeEnd) },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uSunDir: globals.uSunDir,
        uSize: { value: new THREE.Vector2(1, 1) },
        uFogBank: globals.uFogBank,
        uTime: globals.uTime,
      },
      vertexShader: QUAD_VS,
      fragmentShader: RESOLVE_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.glowMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { tColor: { value: null }, tPalette: { value: this.palette }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS,
      fragmentShader: GLOW_EXTRACT_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS,
      fragmentShader: BLUR_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.upscaleMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tSrc: { value: null },
        uSrcSize: { value: new THREE.Vector2() },
        uScale: { value: 1 },
        uOffset: { value: new THREE.Vector2() },
        uCanvas: { value: new THREE.Vector2() },
      },
      vertexShader: QUAD_VS,
      fragmentShader: UPSCALE_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.allocShadow();
    this.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  }

  private allocShadow() {
    const s = config.render.shadowMapSize;
    const depth = new THREE.DepthTexture(s, s);
    depth.type = THREE.UnsignedIntType;
    depth.compareFunction = THREE.LessEqualCompare;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this.shadowRT = new THREE.WebGLRenderTarget(s, s, { depthTexture: depth, depthBuffer: true });
    this.shadowRT.texture.generateMipmaps = false;
    globals.uShadowMap.value = depth;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    const devW = Math.max(1, Math.round(cssW * dpr));
    const devH = Math.max(1, Math.round(cssH * dpr));
    const portrait = cssH >= cssW;
    // Pick an integer scale so the short side lands near the target pixel width.
    const target = config.render.pixelWidth * (portrait ? 1 : 1.25);
    const shortDev = Math.min(devW, devH);
    let scale = Math.max(1, Math.round(shortDev / target));
    scale = Math.min(scale, config.render.maxPixelScale * Math.max(1, Math.round(dpr)));
    const w = Math.ceil(devW / scale);
    const h = Math.ceil(devH / scale);
    this.info = { width: w, height: h, scale };
    this.renderer.setSize(devW, devH, false);
    const canvas = this.renderer.domElement;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    const W = w + MARGIN * 2;
    const H = h + MARGIN * 2;
    this.gbuf?.dispose();
    this.glowA?.dispose();
    this.glowB?.dispose();
    this.resolved?.dispose();
    const depthTex = new THREE.DepthTexture(W, H);
    depthTex.type = THREE.UnsignedIntType;
    depthTex.minFilter = THREE.NearestFilter;
    depthTex.magFilter = THREE.NearestFilter;
    this.gbuf = new THREE.WebGLRenderTarget(W, H, {
      count: 2,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture: depthTex,
      generateMipmaps: false,
    });
    const gw = Math.max(1, Math.ceil(W / 2));
    const gh = Math.max(1, Math.ceil(H / 2));
    const glowOpts = { type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.glowA = new THREE.WebGLRenderTarget(gw, gh, glowOpts);
    this.glowB = new THREE.WebGLRenderTarget(gw, gh, glowOpts);
    this.resolved = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.resolveMat.uniforms.uSize.value.set(W, H);
    this.updateProjection();
  }

  /** Recomputes the camera projection for the current aspect (call after changing fov settings). */
  updateProjection() {
    const { width: w, height: h } = this.info;
    const W = w + MARGIN * 2;
    const H = h + MARGIN * 2;
    const aspect = W / H;
    let vfov: number;
    if (h >= w) {
      // portrait: hold the horizontal fov, derive vertical
      const hf = THREE.MathUtils.degToRad(config.camera.hfovPortrait);
      vfov = 2 * Math.atan(Math.tan(hf / 2) / (w / h));
    } else {
      vfov = THREE.MathUtils.degToRad(config.camera.vfovLandscape);
    }
    // widen to include the margin pixels so the visible center stays exact
    vfov = 2 * Math.atan(Math.tan(vfov / 2) * (H / h));
    this.camera.fov = THREE.MathUtils.radToDeg(vfov);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  get cssSize() {
    return { w: this.cssW, h: this.cssH, dpr: this.dpr };
  }

  /** World-space size of one game pixel at a given distance from the camera. */
  pixelWorldSize(distance: number): number {
    const H = this.info.height + MARGIN * 2;
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / H;
  }

  private snapCamera() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const dist = Math.max(10, cam.position.distanceTo(this.focus));
    const s = this.pixelWorldSize(dist);
    const px = cam.position.dot(right) / s;
    const py = cam.position.dot(up) / s;
    const rx = Math.round(px);
    const ry = Math.round(py);
    const fx = px - rx;
    const fy = py - ry;
    this.snapCam.copy(cam);
    this.snapCam.position.copy(cam.position).addScaledVector(right, -fx * s).addScaledVector(up, -fy * s);
    this.snapCam.updateMatrixWorld();
    this.subPixel.set(fx, fy);
    this.ditherOrigin.set(((rx % 4) + 4) % 4, ((ry % 4) + 4) % 4);
  }

  private updateShadow(scene: THREE.Scene) {
    const sun = globals.uSunDir.value;
    const ext = config.render.shadowExtent;
    const sc = this.sunCam;
    sc.left = -ext / 2;
    sc.right = ext / 2;
    sc.top = ext / 2;
    sc.bottom = -ext / 2;
    sc.near = 1;
    sc.far = 3000;
    const center = this.focus.clone();
    // shift the shadow window forward along the view so more of what's visible is covered
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) center.addScaledVector(fwd.normalize(), ext * 0.22);
    sc.position.copy(center).addScaledVector(sun, 1400);
    sc.up.set(0, 1, 0);
    if (Math.abs(sun.y) > 0.99) sc.up.set(0, 0, 1);
    sc.lookAt(center);
    sc.updateMatrixWorld();
    // snap to shadow texel grid in light space to stop shadow-edge crawl
    const texel = ext / config.render.shadowMapSize;
    const right = new THREE.Vector3().setFromMatrixColumn(sc.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(sc.matrixWorld, 1);
    const pr = sc.position.dot(right);
    const pu = sc.position.dot(up);
    sc.position.addScaledVector(right, Math.round(pr / texel) * texel - pr).addScaledVector(up, Math.round(pu / texel) * texel - pu);
    sc.updateMatrixWorld();
    sc.updateProjectionMatrix();
    const m = globals.uShadowMatrix.value;
    m.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    m.multiply(sc.projectionMatrix).multiply(sc.matrixWorldInverse);

    const r = this.renderer;
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    scene.overrideMaterial = this.depthMat;
    scene.background = null;
    r.setRenderTarget(this.shadowRT);
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    r.render(scene, sc);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    globals.uShadowOn.value = 1;
  }

  render(scene: THREE.Scene) {
    const r = this.renderer;
    this.snapCamera();
    this.updateShadow(scene);

    // scene -> gbuffer
    r.setRenderTarget(this.gbuf);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(scene, this.snapCam);

    // glow extract + blur (half res)
    this.glowMat.uniforms.tColor.value = this.gbuf.textures[0];
    this.glowMat.uniforms.uTexel.value.set(1 / this.gbuf.width, 1 / this.gbuf.height);
    this.blit(this.glowMat, this.glowA);
    this.blurMat.uniforms.tSrc.value = this.glowA.texture;
    this.blurMat.uniforms.uDir.value.set(1 / this.glowA.width, 0);
    this.blit(this.blurMat, this.glowB);
    this.blurMat.uniforms.tSrc.value = this.glowB.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1 / this.glowA.height);
    this.blit(this.blurMat, this.glowA);

    // resolve
    const ru = this.resolveMat.uniforms;
    ru.tColor.value = this.gbuf.textures[0];
    ru.tAux.value = this.gbuf.textures[1];
    ru.tDepth.value = this.gbuf.depthTexture;
    ru.tGlow.value = this.glowA.texture;
    ru.uNearFar.value.set(this.snapCam.near, this.snapCam.far);
    ru.uInvProj.value.copy(this.snapCam.projectionMatrixInverse);
    ru.uCamWorld.value.copy(this.snapCam.matrixWorld);
    ru.uDitherWidth.value = config.render.ditherWidth;
    ru.uOutline.value.set(config.render.outlineDepth, config.render.creaseHighlight, config.render.outlineFadeEnd);
    this.blit(this.resolveMat, this.resolved);

    // upscale to canvas
    const u = this.upscaleMat.uniforms;
    u.tSrc.value = this.resolved.texture;
    u.uSrcSize.value.set(this.resolved.width, this.resolved.height);
    u.uScale.value = this.info.scale;
    u.uOffset.value.set(MARGIN + this.subPixel.x, MARGIN + this.subPixel.y);
    u.uCanvas.value.set(r.domElement.width, r.domElement.height);
    this.blit(this.upscaleMat, null);
  }

  private blit(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  /** Project a world point to CSS pixel coordinates (for debugging / tuner). */
  project(world: THREE.Vector3): THREE.Vector2 {
    const v = world.clone().project(this.camera);
    return new THREE.Vector2((v.x * 0.5 + 0.5) * this.cssW, (1 - (v.y * 0.5 + 0.5)) * this.cssH);
  }
}

const QUAD_VS = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const GLOW_EXTRACT_FS = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tPalette;
uniform vec2 uTexel;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
vec3 glowOf(vec2 uv) {
  vec4 g = texture(tColor, uv);
  if (g.a < 0.02) return vec3(0.0);
  int ramp = int(g.r * 255.0 + 0.5);
  vec3 c = texelFetch(tPalette, ivec2(6, ramp), 0).rgb;
  return c * g.a * (1.0 - g.b);
}
void main() {
  // 2x2 box downsample of emissive color
  vec3 s = glowOf(vUv + uTexel * vec2(-0.5, -0.5)) + glowOf(vUv + uTexel * vec2(0.5, -0.5))
         + glowOf(vUv + uTexel * vec2(-0.5, 0.5)) + glowOf(vUv + uTexel * vec2(0.5, 0.5));
  outColor = vec4(s * 0.25, 1.0);
}
`;

const BLUR_FS = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 s = texture(tSrc, vUv).rgb * 0.227027;
  s += texture(tSrc, vUv + uDir * 1.384615).rgb * 0.316216;
  s += texture(tSrc, vUv - uDir * 1.384615).rgb * 0.316216;
  s += texture(tSrc, vUv + uDir * 3.230769).rgb * 0.070270;
  s += texture(tSrc, vUv - uDir * 3.230769).rgb * 0.070270;
  outColor = vec4(s * 1.35, 1.0);
}
`;

const RESOLVE_FS = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tAux;
uniform sampler2D tDepth;
uniform sampler2D tGlow;
uniform sampler2D tPalette;
uniform vec2 uNearFar;
uniform vec2 uDitherOrigin;
uniform float uDitherWidth;
uniform vec3 uOutline;   // depth threshold, crease strength, fade end distance
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uSunDir;
uniform vec2 uSize;
uniform float uFogBank;
uniform float uTime;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

const float RAMP_FOG = ${Ramp.FOG}.0;
const float RAMP_SKY_WARM = ${Ramp.SKY_WARM}.0;

float bayer4(ivec2 p) {
  int x = p.x & 3; int y = p.y & 3;
  // classic 4x4 Bayer matrix
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[y * 4 + x]) + 0.5) / 16.0;
}

float linDepth(float z) {
  float n = uNearFar.x, f = uNearFar.y;
  float ndc = z * 2.0 - 1.0;
  return (2.0 * n * f) / (f + n - ndc * (f - n));
}

vec3 octDecode(vec2 e) {
  e = e * 2.0 - 1.0;
  vec3 n = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}

vec3 pal(float ramp, float step) {
  return texelFetch(tPalette, ivec2(int(clamp(step, 0.0, 7.0)), int(ramp)), 0).rgb;
}

// Pick a ramp step from a continuous light level with a narrow dithered band
// between steps (crisp bands, soft gradients only where light changes).
float rampStep(float light, float d) {
  float pos = clamp(light, 0.0, 1.0) * 7.0;
  float base = floor(pos);
  float f = pos - base;
  float w = uDitherWidth;
  float t = clamp((f - (0.5 - w)) / max(2.0 * w, 1e-3), 0.0, 1.0);
  return min(base + (t > d ? 1.0 : 0.0), 7.0);
}

vec3 worldDir(vec2 uv) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(v.xyz / v.w);
  return normalize(mat3(uCamWorld) * d);
}

// Sky and fog share one color function so fogged things melt into the sky
// behind them. Returns the continuous light level; the caller quantizes.
float skyLight(vec3 dir) {
  float e = clamp(dir.y * 2.6, -0.3, 1.0);
  float sunNear = pow(max(dot(dir, uSunDir), 0.0), 16.0);
  float l = 0.9 - 0.5 * max(e, 0.0) + 0.12 * sunNear;
  l -= 0.6 * max(-e, 0.0);
  return clamp(l, 0.0, 1.0);
}
float skyWarm(vec3 dir) {
  vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
  vec3 dirFlat = normalize(vec3(dir.x, 0.0001, dir.z));
  float az = pow(max(dot(dirFlat, sunFlat), 0.0), 4.0);
  float e = clamp(dir.y * 2.6, 0.0, 1.0);
  return az * (1.0 - e) + pow(max(dot(dir, uSunDir), 0.0), 20.0);
}
vec3 skyColor(vec3 dir, float d) {
  float w = skyWarm(dir);
  // narrow dithered band where the warm glow begins
  float ramp = clamp((w - 0.52) / 0.08, 0.0, 1.0) > d ? RAMP_SKY_WARM : RAMP_FOG;
  return pal(ramp, rampStep(skyLight(dir), d));
}

// nearest bright tint among the six hues + glow white
vec3 haloTint(vec3 c) {
  float best = -1.0; vec3 bc = c;
  for (int r = ${Ramp.RED}; r <= ${Ramp.VIOLET}; r++) {
    vec3 t = texelFetch(tPalette, ivec2(6, r), 0).rgb;
    float s = dot(normalize(c + 1e-4), normalize(t + 1e-4));
    if (s > best) { best = s; bc = t; }
  }
  vec3 w = texelFetch(tPalette, ivec2(7, ${Ramp.GLOW_WHITE}), 0).rgb;
  if (dot(normalize(c + 1e-4), normalize(w)) > best + 0.02) bc = w;
  return bc;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 dp = p + ivec2(uDitherOrigin);
  float d = bayer4(dp);
  float d2 = bayer4(dp + ivec2(2, 1));
  vec3 dir = worldDir(vUv);
  float z = texelFetch(tDepth, p, 0).r;
  if (z >= 0.99999) {
    vec3 sc = skyColor(dir, d);
    vec3 halo = texture(tGlow, vUv).rgb;
    float hAmt = max(halo.r, max(halo.g, halo.b));
    if (hAmt > 0.1 && hAmt > d2 * 1.1) sc = haloTint(halo / hAmt);
    outColor = vec4(sc, 1.0);
    return;
  }
  vec4 g = texelFetch(tColor, p, 0);
  vec4 a = texelFetch(tAux, p, 0);
  float ramp = floor(g.r * 255.0 + 0.5);
  float light = g.g;
  float fog = g.b;
  float glow = g.a;
  float depth = linDepth(z);
  float fade = 1.0 - smoothstep(uOutline.z * 0.55, uOutline.z, depth);
  bool outlineable = a.a > 0.75;

  float edgeDark = 0.0;
  float crease = 0.0;
  if (outlineable && fade > 0.0) {
    vec3 n = octDecode(a.rg);
    ivec2 off[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
    for (int i = 0; i < 4; i++) {
      ivec2 q = p + off[i];
      float zq = texelFetch(tDepth, q, 0).r;
      float dq = zq >= 0.99999 ? 1e9 : linDepth(zq);
      vec4 aq = texelFetch(tAux, q, 0);
      // silhouette: neighbor is much farther -> this pixel is the near edge
      if (dq - depth > depth * uOutline.x) edgeDark = 1.0;
      else if (abs(dq - depth) < depth * uOutline.x) {
        vec3 nq = octDecode(aq.rg);
        float nd = dot(n, nq);
        // convex crease: normals diverge and neighbor faces away from the camera more
        if (nd < 0.72) {
          float convex = dot(nq - n, vec3(off[i], 0.0));
          if (convex < -0.05 && n.z > nq.z) crease = max(crease, 1.0);
        }
        // seam between two different surfaces at the same depth (row houses)
        if (abs(aq.b - a.b) > 0.001 && aq.a > 0.75) edgeDark = max(edgeDark, 0.5);
      }
    }
  }
  edgeDark *= fade;
  crease *= fade * uOutline.y;

  // atmospheric perspective: fog first compresses contrast toward the sky's
  // brightness inside the surface's own ramp, then hands over to the fog ramp
  // through a narrow dithered band — never a sprinkle of dots up close.
  float sl = skyLight(normalize(vec3(dir.x, max(dir.y, -0.02) * 0.2, dir.z)));
  light = mix(light, sl, smoothstep(0.08, 0.66, fog) * 0.9);
  // flat surfaces (identical light bytes all around) never dither: no
  // checkerboards on walls that happen to sit on a step boundary.
  float lb = g.g * 255.0;
  bool flatLight = abs(texelFetch(tColor, p + ivec2(1, 0), 0).g * 255.0 - lb) < 0.5
                && abs(texelFetch(tColor, p + ivec2(-1, 0), 0).g * 255.0 - lb) < 0.5
                && abs(texelFetch(tColor, p + ivec2(0, 1), 0).g * 255.0 - lb) < 0.5
                && abs(texelFetch(tColor, p + ivec2(0, -1), 0).g * 255.0 - lb) < 0.5;
  float step = rampStep(light, flatLight ? 0.5 : d);
  float fogBand = clamp((fog - 0.66) / 0.12, 0.0, 1.0);
  bool fogged = fogBand > d2;
  vec3 col = pal(ramp, step);

  // glow halo: dithered, and only ever a palette color — a lighter step of
  // this surface's own ramp, or (close to the source) the glowing hue's tint.
  vec3 halo = texture(tGlow, vUv).rgb;
  float hAmt = max(halo.r, max(halo.g, halo.b));
  if (glow < 0.05 && hAmt > 0.06 && hAmt * 1.2 > d2) {
    if (hAmt > 0.42 && hAmt > d * 1.25) col = haloTint(halo / hAmt);
    else col = pal(ramp, min(step + 2.0, 7.0));
  }

  if (fogged) col = pal(RAMP_FOG, rampStep(sl, d));
  outColor = vec4(col, 1.0);
}
`;

const UPSCALE_FS = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uSrcSize;
uniform float uScale;
uniform vec2 uOffset;
uniform vec2 uCanvas;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 src = gl_FragCoord.xy / uScale + uOffset;
  ivec2 t = ivec2(floor(src));
  outColor = vec4(texelFetch(tSrc, t, 0).rgb, 1.0);
}
`;
