import * as THREE from 'three';
import { config } from '../config';
import { globals, GLSL_LAYER_TOP, GLSL_SKY_LIGHT, SHADOW_LAYER } from './materials';
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
  /** Ground point the sun's shadow window centers on when `shadowFocusOn` (up high: ahead, under the view). */
  readonly shadowFocus = new THREE.Vector3();
  shadowFocusOn = false;
  /** Shadow window size relative to config.render.shadowExtent (stepped, so texels don't swim). */
  shadowScale = 1;
  /** Shadow strength 0..1 (0 skips the sun depth pass entirely). */
  shadowStrength = 1;
  /** Width of the fade at the shadow window's edge (fraction of the map). Wide up high: a slow fade never dithers. */
  shadowEdge = 0.08;
  /** Horizontal portrait fov override (deg), e.g. the vista camera's wider lens. */
  private hfov: number | null = null;
  /**
   * Hold the snap grid's scale steady (quantized, with hysteresis) instead of
   * following the focus distance exactly: up high, where the focus is the
   * city's depth under the view, a drifting scale would resample everything.
   */
  steadySnap = false;
  /**
   * 0..1: calm pixels. Up high every roof is a few pixels and the fog turns
   * each into a gradient, so the ordered dither would fire everywhere and boil
   * under motion: at 1 surfaces round to their ramp step (calm, flat bands),
   * and the sky and the fog sea dither in screen space (they don't move with
   * the snapped grid). Driven by the vista blend; 0 = the street-level look.
   */
  calm = 0;
  private snapLevel: number | null = null;
  private snapped = false;
  private snapDepth = 1;
  private readonly snapShift = new THREE.Vector3();
  private readonly snapRight = new THREE.Vector3();
  private readonly snapUp = new THREE.Vector3();
  private readonly snapFwd = new THREE.Vector3();
  private readonly snapTmp = new THREE.Vector3();
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  /** impact flash: rendered frames left, and (buffer uv x, y, strength, radius) */
  private flashLeft = 0;
  private readonly flashU = new THREE.Vector4();
  /** the hero's headlight beam (world lens, world tip, half widths m, strength 0..1; 0 = off) */
  private readonly beamEye = new THREE.Vector3();
  private readonly beamTip = new THREE.Vector3();
  private readonly beamTmp = new THREE.Vector3();
  private beamHalf0 = 0;
  private beamHalf1 = 0;
  private beamK = 0;
  /** the hero's drop shadow (center x, z, underside y, ramp steps; 0 = off) and its oval (forward xz, half length, half width) */
  private readonly heroShadow = new THREE.Vector4();
  private readonly heroShadowAxes = new THREE.Vector4(0, 1, 1, 1);

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
    // far reaches the horizon hills and the fog sea when the bus is high above the city
    this.camera = new THREE.PerspectiveCamera(40, 1, 1.5, 30000);
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
        uFogLayer: globals.uFogLayer,
        uFogLayer2: globals.uFogLayer2,
        uFogBillow: globals.uFogBillow,
        uCamPos: { value: new THREE.Vector3() },
        uCalm: { value: 0 },
        uHaze: { value: new THREE.Vector4(config.render.ditherHazeFrom, config.render.ditherHazeTo, config.render.fogBandMin, config.render.fogSliver) },
        uBeam: { value: new THREE.Vector4() },
        uBeamShape: { value: new THREE.Vector4() },
        uHeroShadow: { value: new THREE.Vector4() },
        uHeroShadowAxes: { value: new THREE.Vector4(0, 1, 1, 1) },
        uFlash: { value: new THREE.Vector4() },
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
    const hfov = this.hfov ?? config.camera.hfovPortrait;
    if (h >= w) {
      // portrait: hold the horizontal fov, derive vertical
      const hf = THREE.MathUtils.degToRad(hfov);
      vfov = 2 * Math.atan(Math.tan(hf / 2) / (w / h));
    } else {
      vfov = THREE.MathUtils.degToRad(config.camera.vfovLandscape * (hfov / Math.max(1, config.camera.hfovPortrait)));
    }
    // widen to include the margin pixels so the visible center stays exact
    vfov = 2 * Math.atan(Math.tan(vfov / 2) * (H / h));
    this.camera.fov = THREE.MathUtils.radToDeg(vfov);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Set the horizontal portrait fov (deg); re-projects only when it actually changes. */
  setHfov(deg: number) {
    if (this.hfov !== null && Math.abs(deg - this.hfov) < 1e-4) return;
    this.hfov = deg;
    this.updateProjection();
  }

  get cssSize() {
    return { w: this.cssW, h: this.cssH, dpr: this.dpr };
  }

  /**
   * Impact flash for the next `frames` rendered frames, centered on a point
   * of the visible image (u, v in 0..1, v up): white-hot around it, every
   * other pixel a couple of palette steps lighter (never a free color).
   */
  flash(u: number, v: number, frames: number, strength: number) {
    const { width: w, height: h } = this.info;
    const W = w + MARGIN * 2, H = h + MARGIN * 2;
    this.flashLeft = Math.max(this.flashLeft, Math.round(frames));
    this.flashU.set((MARGIN + u * w) / W, (MARGIN + v * h) / H, strength, 0.075);
  }

  /**
   * The hero's headlight beam for the next render: what lies ahead of the lens
   * (from `eye` toward `tip`, half width `halfNear` m at the lens to `halfFar` m
   * at the tip) is lit a step or two up its own ramp in the resolve pass, a warm
   * core at the lens; nothing is drawn, so it costs no draw call. strength 0 = off.
   */
  setHeroBeam(eye: THREE.Vector3, tip: THREE.Vector3, halfNear: number, halfFar: number, strength: number) {
    this.beamEye.copy(eye);
    this.beamTip.copy(tip);
    this.beamHalf0 = halfNear;
    this.beamHalf1 = halfFar;
    this.beamK = Math.max(0, Math.min(1, strength));
  }

  /**
   * The hero's drop shadow for the next render: whatever faces up below `underY` inside the oval
   * (center x, z; forward axis fx, fz; half length / half width m) is drawn `steps` ramp steps darker
   * in the resolve pass, paint included (no decal, no draw call). steps 0 = off.
   */
  setHeroShadow(x: number, z: number, underY: number, fx: number, fz: number, halfLength: number, halfWidth: number, steps: number) {
    const fl = Math.hypot(fx, fz) || 1;
    this.heroShadow.set(x, z, underY, Math.max(0, steps));
    this.heroShadowAxes.set(fx / fl, fz / fl, Math.max(0.1, halfLength), Math.max(0.1, halfWidth));
  }

  /** World-space size of one game pixel at a given distance from the camera. */
  pixelWorldSize(distance: number): number {
    const H = this.info.height + MARGIN * 2;
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / H;
  }

  /**
   * Snap the render camera to the game-pixel grid at the focus depth. render()
   * does it itself; call it earlier (after the camera, the lens and `focus` are
   * final for the frame) to place things with snapCompensation() first.
   */
  snap() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const right = this.snapRight.setFromMatrixColumn(cam.matrixWorld, 0);
    const up = this.snapUp.setFromMatrixColumn(cam.matrixWorld, 1);
    const dist = Math.max(10, cam.position.distanceTo(this.focus));
    let s = this.pixelWorldSize(dist);
    if (this.steadySnap) {
      // the grid's scale in 1/16-octave steps with hysteresis: a scale that drifts with the focus
      // depth re-rounds the whole grid every frame (everything resamples even when nothing moves)
      const lv = Math.log2(s) * 16;
      if (this.snapLevel === null || Math.abs(lv - this.snapLevel) > 0.8) this.snapLevel = Math.round(lv);
      s = Math.pow(2, this.snapLevel / 16);
    } else this.snapLevel = null;
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
    this.snapShift.copy(this.snapCam.position).sub(cam.position);
    // the view depth at which one game pixel is s (what the upscale's sub-pixel shift is exact for)
    this.snapDepth = s / Math.max(1e-6, this.pixelWorldSize(1));
    this.snapped = true;
  }

  /**
   * World offset that keeps an object at `at` exactly where it belongs on screen
   * although the grid was snapped at another depth (zero at the snap depth). Up
   * high the grid snaps at the city, and the near bus gets this.
   */
  snapCompensation(at: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const cam = this.camera;
    const fwd = this.snapFwd.setFromMatrixColumn(cam.matrixWorld, 2).negate();
    const d = Math.max(1, this.snapTmp.copy(at).sub(cam.position).dot(fwd));
    return out.copy(this.snapShift).multiplyScalar(1 - d / Math.max(1, this.snapDepth));
  }

  private updateShadow(scene: THREE.Scene) {
    if (this.shadowStrength <= 0.01) {
      globals.uShadowOn.value = 0;
      return;
    }
    const sun = globals.uSunDir.value;
    // a wider window up high, in 1/8-octave steps so the texel grid holds still between steps
    const steps = Math.round(Math.log2(Math.max(0.25, this.shadowScale)) * 8) / 8;
    const ext = config.render.shadowExtent * Math.pow(2, steps);
    const sc = this.sunCam;
    sc.left = -ext / 2;
    sc.right = ext / 2;
    sc.top = ext / 2;
    sc.bottom = -ext / 2;
    sc.near = 1;
    sc.far = 3000;
    const center = (this.shadowFocusOn ? this.shadowFocus : this.focus).clone();
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
    globals.uShadowOn.value = Math.min(1, this.shadowStrength);
    globals.uShadowEdge.value = Math.min(0.5, Math.max(0.01, this.shadowEdge));
  }

  render(scene: THREE.Scene) {
    const r = this.renderer;
    if (!this.snapped) this.snap();
    this.snapped = false;
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
    ru.uCamPos.value.copy(this.snapCam.position);
    ru.uCalm.value = Math.min(1, Math.max(0, this.calm));
    ru.uDitherWidth.value = config.render.ditherWidth;
    ru.uHaze.value.set(config.render.ditherHazeFrom, Math.max(config.render.ditherHazeFrom + 0.01, config.render.ditherHazeTo), Math.max(0.004, config.render.fogBandMin), config.render.fogSliver);
    ru.uOutline.value.set(config.render.outlineDepth, config.render.creaseHighlight, config.render.outlineFadeEnd);
    if (this.beamK > 0.001) {
      // the beam in buffer pixels, projected with the snapped camera (what the buffer was rendered with)
      const W = this.gbuf.width, H = this.gbuf.height, sc = this.snapCam;
      const e = this.beamTmp.copy(this.beamEye).project(sc);
      const ex = (e.x * 0.5 + 0.5) * W, ey = (e.y * 0.5 + 0.5) * H;
      const t = this.beamTmp.copy(this.beamTip).project(sc);
      const tx = (t.x * 0.5 + 0.5) * W, ty = (t.y * 0.5 + 0.5) * H;
      const dE = sc.position.distanceTo(this.beamEye), dT = sc.position.distanceTo(this.beamTip);
      const eyeDepth = -this.beamTmp.copy(this.beamEye).applyMatrix4(sc.matrixWorldInverse).z;
      ru.uBeam.value.set(ex, ey, tx - ex, ty - ey);
      ru.uBeamShape.value.set(this.beamHalf0 / this.pixelWorldSize(dE), this.beamHalf1 / this.pixelWorldSize(dT), this.beamK, eyeDepth + 2);
    } else ru.uBeamShape.value.z = 0;
    ru.uHeroShadow.value.copy(this.heroShadow);
    ru.uHeroShadowAxes.value.copy(this.heroShadowAxes);
    if (this.flashLeft > 0) {
      ru.uFlash.value.copy(this.flashU);
      this.flashLeft--;
    } else ru.uFlash.value.z = 0;
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
uniform vec4 uFogLayer;
uniform vec4 uFogLayer2;
uniform vec2 uFogBillow;
uniform vec3 uCamPos;
uniform float uCalm;
uniform vec4 uHaze;      // fog over which surface dither fades to plain rounding; the handover band's floor; the
                         // shortest shape (share of the frame's height) that may stand out of the fog
uniform vec4 uBeam;      // hero headlight: lens (buffer px), axis to the tip (px)
uniform vec4 uBeamShape; // half width at the lens / at the tip (px), strength, lens view depth (m)
uniform vec4 uHeroShadow;     // hero drop shadow: center xz, underside y (m), ramp steps (0 = off)
uniform vec4 uHeroShadowAxes; // ...its oval: forward axis xz, half length, half width (m)
uniform vec4 uFlash;     // impact flash: buffer uv, strength, white-hot radius (fraction of the height)
in vec2 vUv;
layout(location = 0) out vec4 outColor;
${GLSL_LAYER_TOP}

const float RAMP_FOG = ${Ramp.FOG}.0;
const float RAMP_SKY_WARM = ${Ramp.SKY_WARM}.0;
const float RAMP_BUS_YELLOW = ${Ramp.BUS_YELLOW}.0;
const float RAMP_BUS_BLACK = ${Ramp.BUS_BLACK}.0;

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
float rampStepW(float light, float d, float w) {
  float pos = clamp(light, 0.0, 1.0) * 7.0;
  float base = floor(pos);
  float f = pos - base;
  float t = clamp((f - (0.5 - w)) / max(2.0 * w, 1e-3), 0.0, 1.0);
  return min(base + (t > d ? 1.0 : 0.0), 7.0);
}
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
// (materials.ts GLSL_SKY_LIGHT: the tower facades mirror the same function)
${GLSL_SKY_LIGHT}
float skyLight(vec3 dir) { return sbSkyLight(dir, uSunDir, uCalm); }
float skyWarm(vec3 dir) {
  vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
  vec3 dirFlat = normalize(vec3(dir.x, 0.0001, dir.z));
  float az = pow(max(dot(dirFlat, sunFlat), 0.0), 4.0);
  float e = clamp(dir.y * 2.6, 0.0, 1.0);
  return az * (1.0 - e) + pow(max(dot(dir, uSunDir), 0.0), 20.0);
}

// The top of the marine layer seen from above: where the view ray enters the
// fog sea, its billows catch the low sun (warm on the sun side, cool in their
// lee) and the sea melts into the horizon haze with distance. Returns
// (light level, warmth 0..1) for the fog the pixel converges to.
vec2 seaShade(vec3 dir, float sl) {
  float dn = max(-dir.y, 0.004);
  float t = max(0.0, (uCamPos.y - uFogLayer.x) / dn);
  float top = sbLayerTop(uCamPos.xz + dir.xz * t);
  t = max(0.0, (uCamPos.y - top) / dn);
  vec2 e = uCamPos.xz + dir.xz * t;
  top = sbLayerTop(e);
  t = max(0.0, (uCamPos.y - top) / dn);
  e = uCamPos.xz + dir.xz * t;
  float h = 30.0;
  float gx = (sbLayerTop(e + vec2(h, 0.0)) - sbLayerTop(e - vec2(h, 0.0))) / (2.0 * h);
  float gz = (sbLayerTop(e + vec2(0.0, h)) - sbLayerTop(e - vec2(0.0, h))) / (2.0 * h);
  vec3 n = normalize(vec3(-gx * 3.0, 1.0, -gz * 3.0));
  float ndl = dot(n, uSunDir);
  // a soft, bright top: lit billows near white, their lee a cool mid grey
  float l = 0.8 + 0.8 * (ndl - uSunDir.y) + 0.05 * pow(max(dot(dir, uSunDir), 0.0), 8.0);
  // warm light on the sunward billows, seen when looking toward the low sun (a broad glow, not spots)
  float toSun = max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  float warm = smoothstep(-0.06, 0.12, ndl - uSunDir.y) * toSun * toSun;
  // (the billows carry far, flattening into the streaks a cloud deck makes toward the horizon)
  float far = smoothstep(2500.0, 18000.0, t);
  return vec2(clamp(mix(l, sl, far), 0.0, 1.0), warm * (1.0 - far));
}

// A neighbor's fog says whether it stands out of the fog (at the floor): a nearer surface (not the
// clear sky, fog 0), the handover, or a silhouette rounding darker than the buried step.
bool stands(float f, float sl, float bur) {
  if (f < 0.002) return false;
  if (f < 0.76) return true;
  return rampStep(sl - (1.0 - f) * 0.55 - 0.03 - 0.1 * uCalm * smoothstep(0.75, 0.95, f), 0.5) < bur;
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
  // the sky (and up high the fog sea) dithers in screen space: it changes only with the view's
  // rotation, so a pattern anchored to the snapped grid would slide through its bands at every snap
  // step (at the floor that is every frame of a cruise)
  bool calmV = uCalm > 0.5;
  float dsk = bayer4(p);
  float ds = calmV ? dsk : d;
  float ds2 = calmV ? bayer4(p + ivec2(2, 1)) : d2;
  // surfaces: the dither's reach shrinks to plain rounding as the view calms
  float dc = mix(d, 0.5, uCalm);
  vec3 dir = worldDir(vUv);
  float z = texelFetch(tDepth, p, 0).r;
  bool layerView = uFogLayer2.w > 0.001 && uCamPos.y > uFogLayer.x && dir.y < -0.001;
  // impact flash: k = 1 at the blast, falling off over the screen
  float flashK = 0.0;
  if (uFlash.z > 0.0) {
    vec2 fd = (vUv - uFlash.xy) * vec2(uSize.x / uSize.y, 1.0);
    flashK = uFlash.z * (1.0 - smoothstep(uFlash.w, uFlash.w * 4.0, length(fd)));
  }
  if (z >= 0.99999) {
    float skyL = skyLight(dir);
    // up high the sky above the horizon deepens a little faster and sits a touch darker than the
    // bright haze below it: a horizon line, and a sky gradient instead of one flat grey
    if (dir.y > 0.0) skyL -= uCalm * (0.07 + 0.1 * smoothstep(0.0, 0.3, dir.y));
    float warmS = clamp((skyWarm(dir) - 0.52) / 0.08, 0.0, 1.0);
    if (layerView) {
      // past the far plane, below the horizon: the fog sea runs on to the haze (blended in by
      // light, never by a dither crossfade: that drew streaks across the sky)
      float slF = skyLight(normalize(vec3(dir.x, max(dir.y, -0.02) * 0.2, dir.z))) + 0.04 * uCalm;
      vec2 sh = seaShade(dir, slF);
      skyL = mix(skyL, sh.x - 0.03, uFogLayer2.w);
      warmS = mix(warmS, clamp((sh.y - 0.5) / 0.12, 0.0, 1.0), uFogLayer2.w);
    }
    // narrow dithered band where the warm glow begins; the sky gets tighter dither bands (tighter
    // still up high, where its gradient spans more of the frame: calm bands, not dotted stripes)
    vec3 sc = pal(warmS > dsk ? RAMP_SKY_WARM : RAMP_FOG, rampStepW(skyL, dsk, 0.09 - 0.04 * uCalm));
    vec3 halo = texture(tGlow, vUv).rgb;
    float hAmt = max(halo.r, max(halo.g, halo.b));
    // (alpha 0 marks plain sky: the upscale leaves it unshifted, it holds still on the screen)
    float skyA = 0.0;
    if (hAmt > 0.1 && hAmt > d2 * 1.1) { sc = haloTint(halo / hAmt); skyA = 1.0; }
    if (uFlash.z > 0.0) { sc = pal(${Ramp.GLOW_WHITE}.0, flashK > 0.45 ? 7.0 : 6.0 + floor(flashK * 2.0)); skyA = 1.0; }
    outColor = vec4(sc, skyA);
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
    bool sil[4] = bool[4](false, false, false, false);
    for (int i = 0; i < 4; i++) {
      ivec2 q = p + off[i];
      float zq = texelFetch(tDepth, q, 0).r;
      float dq = zq >= 0.99999 ? 1e9 : linDepth(zq);
      vec4 aq = texelFetch(tAux, q, 0);
      // silhouette: neighbor is much farther -> this pixel is the near edge
      if (dq - depth > depth * uOutline.x) { edgeDark = 1.0; sil[i] = true; }
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
    // a one-pixel feature with background on both sides (a cable, a suspender, a pole) keeps its own
    // color: darkening only some steps of a thin diagonal beaded it into dots
    if ((sil[0] && sil[1]) || (sil[2] && sil[3])) edgeDark = 0.0;
  }
  edgeDark *= fade;
  crease *= fade * uOutline.y;

  // atmospheric perspective: fog first compresses contrast toward the sky's
  // brightness inside the surface's own ramp, then hands over to the fog ramp
  // through a narrow dithered band — never a sprinkle of dots up close.
  float sl = skyLight(normalize(vec3(dir.x, max(dir.y, -0.02) * 0.2, dir.z))) + 0.04 * uCalm;
  // seen from above the marine layer, what's under it converges on the lit fog top instead
  float fogRamp = RAMP_FOG;
  float sea = 0.0;
  if (layerView && fog > 0.06) {
    vec3 camFwd = -normalize(vec3(uCamWorld[2].xyz));
    vec3 P = uCamPos + dir * (depth / max(dot(dir, camFwd), 0.05));
    float topP = sbLayerTop(P.xz);
    sea = (1.0 - smoothstep(topP - uFogLayer.w, topP + uFogLayer.w, P.y)) * uFogLayer2.w;
    if (sea > 0.0) {
      vec2 sh = seaShade(dir, sl);
      sl = mix(sl, sh.x, sea);
      // warm where the billows face the low sun: a narrow dithered edge, not a sprinkle
      if (clamp((sh.y * sea - 0.5) / 0.12, 0.0, 1.0) > ds2) fogRamp = RAMP_SKY_WARM;
    }
  }
  light = mix(light, sl, smoothstep(0.08, 0.66, fog) * 0.9);
  // flat surfaces (identical light bytes all around) never dither: no
  // checkerboards on walls that happen to sit on a step boundary.
  float lb = g.g * 255.0;
  // (slow gradients count as flat too: a clean band edge beats a dotted contour)
  vec4 gR = texelFetch(tColor, p + ivec2(1, 0), 0), gL = texelFetch(tColor, p + ivec2(-1, 0), 0);
  vec4 gU = texelFetch(tColor, p + ivec2(0, 1), 0), gD = texelFetch(tColor, p + ivec2(0, -1), 0);
  // (only a neighbor on a real gradient counts: one more than the dither window away sits across an
  // edge, a tree crown's light band, a shadow's rim, another face. A gradient that steep has no room
  // for a dither, which only drew dots along the edge that churned as it slid through the grid)
  vec4 dl = abs(vec4(gR.g, gL.g, gU.g, gD.g) * 255.0 - lb);
  vec4 onGrad = vec4(greaterThanEqual(dl, vec4(1.5))) * vec4(lessThan(dl, vec4(72.86 * uDitherWidth)));
  bool flatLight = dot(onGrad, vec4(1.0)) < 0.5;
  // into the haze the dither's reach shrinks too: the ordered pattern is anchored to the grid snapped
  // at the bus, and far shapes slide across it with parallax (a crawl); hazy, compressed surfaces round
  float step = rampStep(light, flatLight ? 0.5 : mix(dc, 0.5, smoothstep(uHaze.x, uHaze.y, fog)));
  // outlines: silhouettes two steps darker, seams between houses one step,
  // convex creases (roof edges, cornices, bay corners) one step lighter
  if (edgeDark > 0.75) step = max(step - 2.0, 0.0);
  else if (edgeDark > 0.25) step = max(step - 1.0, 0.0);
  else if (crease > 0.5) step = min(step + 1.0, 7.0);
  // the hero always separates: its silhouette is a plum ink line inside its own warm ramp (the bus's
  // ramps are its own), dark against every paint hue and still warm against the grey
  bool busY = abs(ramp - RAMP_BUS_YELLOW) < 0.5;
  bool heroEdge = edgeDark > 0.75 && (busY || abs(ramp - RAMP_BUS_BLACK) < 0.5);
  if (heroEdge) step = busY ? 1.0 : min(step, 1.0);
  // the handover band follows the fog's own gradient, so it is a few pixels wide wherever it is: a
  // fixed band was a wide dithered zipper that reshuffled as the camera dollied (the fog contour
  // slides through the grid). At street level it keeps a floor (config.render.fogBandMin; the
  // value-matched colors make its dots a hue flip); seen from high up, over the fog sea, a clean contour
  float gf = max(max(abs(gR.b - fog), abs(gU.b - fog)), max(abs(gL.b - fog), abs(gD.b - fog)));
  float bandW = clamp(gf * 2.5, mix(uHaze.z, 0.004, uFogLayer2.w), 0.06);
  float fogBand = clamp((fog - 0.65 + bandW * 0.5) / bandW, 0.0, 1.0);
  bool fogged = fogBand > mix(d2, 0.5, uCalm);
  // deep in the fog things become solid silhouettes a little darker than the
  // sky behind them (Hopper's distant shapes), converging on the sky color
  // (under the fog sea the ground just melts into the lit fog top: no dark Hopper shapes)
  // (up high the distant shapes above the fog sea, the hills on the horizon and the far skyline,
  // stand a step darker than the bright haze, so the horizon reads as a silhouette, not a fade)
  float silL = sl - (1.0 - fog) * 0.55 * (1.0 - 0.8 * sea) - 0.03 - 0.1 * uCalm * (1.0 - sea) * smoothstep(0.75, 0.95, fog);
  vec3 col = pal(ramp, step);
  // at street level the handover is value-matched: at the band every surface turns into the FOG step
  // nearest its own luminance (FOG luma is linear, 0.3955 + 0.071 k), so the switch is a change of hue,
  // not a jump to pale dots; deeper in, the shapes flatten into the silhouettes a little darker than
  // the sky. (Up high the old contour stays: calm, and the fog sea's lit top.)
  float kMatch = clamp((dot(col, vec3(0.299, 0.587, 0.114)) - 0.3955) / 0.071, 0.0, 7.0) / 7.0;
  // (flat by fog 0.76, under the fog ceiling of tall far shapes: a tower standing out of the fog is a pale
  // shape, never its one-pixel window grid, which crawled with parallax)
  silL = mix(kMatch, silL, max(smoothstep(0.62, 0.76, fog), max(uCalm, uFogLayer2.w)));
  float oRamp = ramp;
  float oStep = step;

  // glow halo: dithered, and only ever a palette color — a lighter step of
  // this surface's own ramp, or (close to the source) the glowing hue's tint.
  vec3 halo = texture(tGlow, vUv).rgb;
  float hAmt = max(halo.r, max(halo.g, halo.b));
  if (!heroEdge && glow < 0.05 && hAmt > 0.11 && hAmt * 1.1 > d2) {
    if (hAmt > 0.42 && hAmt > d * 1.25) col = haloTint(halo / hAmt);
    else { oStep = min(step + 2.0, 7.0); col = pal(ramp, oStep); }
  }

  // (the fog sea's long light gradients get the sky's tight dither bands; silhouettes round, so the
  // far skyline is flat shapes, not dotted boxes that crawl)
  if (fogged) {
    oRamp = fogRamp;
    oStep = sea > 0.5 ? rampStepW(silL, ds, 0.09) : rampStep(silL, 0.5);
    // a shape standing out of the fog stands at least ~0.45 deg tall (4 px at 240 px wide, 6 at 390): shorter, it
    // is a sliver (the top of a roof just over the fog ceiling's contour, a dash of a far ridge)
    // floating in the sky band as debris, so it is buried with the rest. (The vertical run through this
    // pixel; nearer surfaces and the handover count as ground under it.)
    if (sea < 0.5) {
      float bur = rampStep(sl - 0.03 - 0.1 * uCalm, 0.5);
      if (oStep < bur) {
        int K = clamp(int(uSize.y * uHaze.w + 0.5), 3, 16);
        int run = 1;
        for (int i = 1; i < 16; i++) {
          if (i >= K || !stands(texelFetch(tColor, p + ivec2(0, i), 0).b, sl, bur)) break;
          run++;
        }
        for (int i = 1; i < 16; i++) {
          if (run >= K || !stands(texelFetch(tColor, p - ivec2(0, i), 0).b, sl, bur)) break;
          run++;
        }
        if (run < K) oStep = bur;
      }
    }
    col = pal(oRamp, oStep);
  }
  bool heroRamp = busY || abs(ramp - RAMP_BUS_BLACK) < 0.5;
  // the hero's drop shadow: whatever faces up below the bus, inside an oval about its size, a ramp step
  // darker in its own ramp (paint too: no grey blob punched into the bloom). The open water too: the bay
  // plane isn't outlineable, but over the bay (the opening's Golden Gate shot) it is the only height cue.
  if (uHeroShadow.w > 0.0 && (outlineable || abs(ramp - ${Ramp.WATER}.0) < 0.5) && !fogged && !heroRamp) {
    vec3 cf = -normalize(vec3(uCamWorld[2].xyz));
    vec3 P = uCamPos + dir * (depth / max(dot(dir, cf), 0.05));
    vec2 bq = P.xz - uHeroShadow.xy;
    vec2 bo = vec2(dot(bq, uHeroShadowAxes.xy), bq.x * uHeroShadowAxes.y - bq.y * uHeroShadowAxes.x) / uHeroShadowAxes.zw;
    if (P.y < uHeroShadow.z && dot(bo, bo) < 1.0 && (mat3(uCamWorld) * octDecode(a.rg)).y > 0.5) {
      oStep = max(oStep - uHeroShadow.w, 0.0);
      col = pal(oRamp, oStep);
    }
  }
  // the hero's headlight: what lies ahead of the lens (beyond the bus) is lit a step or two up its own
  // ramp; a lift, not a drawn shape, so it reads as light in the haze. Only the grey world: paint and
  // glow are already the brightest things around (the bloom right after a hit is the money shot). A
  // warm glint where it leaves the nose, and on the nose's silhouette edge, so the one eye reads from
  // behind. The beam rides with the bus, which holds still on screen: its edge dither is screen-anchored.
  // (the unpainted towers' own materials are grey world too: the beam doesn't stop at a tower's face)
  bool greyR = ramp < ${Ramp.GREY_LIGHT}.5 || ramp == ${Ramp.GREEN_GREY}.0 || ramp == ${Ramp.WINDOW}.0 || ramp == ${Ramp.ROOF_DARK}.0
    || ramp == ${Ramp.GLASS}.0 || ramp == ${Ramp.STONE}.0 || ramp == ${Ramp.GRANITE}.0;
  if (uBeamShape.z > 0.0 && glow < 0.02 && hAmt < 0.11 && !fogged && (greyR || heroRamp) && (depth > uBeamShape.w || heroEdge)) {
    vec2 bv = gl_FragCoord.xy - uBeam.xy;
    float bl = max(length(uBeam.zw), 1.0);
    vec2 ba = uBeam.zw / bl;
    float bt = dot(bv, ba) / bl;
    float bs = abs(bv.x * ba.y - bv.y * ba.x) / max(mix(uBeamShape.x, uBeamShape.y, clamp(bt, 0.0, 1.0)), 0.75);
    if (heroRamp) {
      // (the nose's ink edge right over the lens)
      if (heroEdge && abs(bv.x * ba.y - bv.y * ba.x) < 1.0 && bt * bl > -9.0 && bt * bl < 3.0) { oRamp = RAMP_SKY_WARM; oStep = 7.0; col = pal(oRamp, oStep); }
    } else if (bt > 0.0 && bt < 1.0 && bs < 1.0) {
      float ba2 = uBeamShape.z * pow(1.0 - bt, 0.75) * (1.0 - bs * bs);
      // crisp nested bands (+1 step, +2 steps), dithered only in a narrow band at their edges
      float bk = ba2 * 2.6;
      float lift = floor(bk) + (clamp((fract(bk) - 0.38) / 0.24, 0.0, 1.0) > dsk ? 1.0 : 0.0);
      if (bt * bl < 2.5 && bs < 0.7) { oRamp = RAMP_SKY_WARM; oStep = max(oStep, 6.0); col = pal(oRamp, oStep); }
      else if (lift > 0.5) { oStep = min(oStep + lift, 7.0); col = pal(oRamp, oStep); }
    }
  }
  // impact flash: white-hot near the blast (shapes kept by their own light),
  // everything else jumps two or three steps up its own ramp
  if (uFlash.z > 0.0) {
    if (flashK > 0.5 + 0.3 * d) col = pal(${Ramp.GLOW_WHITE}.0, floor(4.5 + 2.6 * light));
    else col = pal(oRamp, min(oStep + 1.0 + floor(flashK * 3.0 + d), 7.0));
  }
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
  vec4 c = texelFetch(tSrc, t, 0);
  // plain sky (alpha 0) only turns with the view: the snap's sub-pixel shift is for the world at the
  // focus, so the sky takes the unshifted texel (where both are sky) and holds perfectly still
  if (c.a < 0.5) {
    vec4 c0 = texelFetch(tSrc, ivec2(floor(gl_FragCoord.xy / uScale + vec2(${MARGIN}.0))), 0);
    if (c0.a < 0.5) c = c0;
  }
  outColor = vec4(c.rgb, 1.0);
}
`;
