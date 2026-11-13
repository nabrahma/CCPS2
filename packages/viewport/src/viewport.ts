/**
 * The 3D viewport (PRD F9). Renders a CharacterScene from @ps2cc/core; it
 * never computes character geometry itself.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  colourizeHair,
  dilateRgb,
  EYE_TEXTURE_SIZE,
  eulerXYZ,
  eyeLookKey,
  eyeTexture,
  hairColourKey,
  NEUTRAL_GRADE,
  parseCube,
  poseWorldMatrices,
  skinningMatrices,
  skinPositions,
  type CharacterScene,
  type HeadLayout,
  type LightingModel,
  type Look,
  type Lut3D,
  type Mat3,
  type RgbaImage,
  type ScenePart,
  type ShadowMode,
} from '@ps2cc/core';
import { applyLighting, createPs2Material, setMaterialTexture, spotDirection, spotPosition, type LightState, type SurfaceKind } from './materials';
import { SkinCompositor } from './skin-compositor';
import { PostPass } from './post';
import { createGroundShadow, ShadowMaps } from './shadows';
import { GpuBaker } from './bake';
import {
  CAMERA_PRESETS,
  DEFAULT_POST,
  LIGHTING_PRESETS,
  type CameraFrame,
  type CameraPresetId,
  type LightingPresetId,
  type PostSettings,
  type ShadingMode,
} from './presets';

export interface ViewportOptions {
  /** Base URL that compiled assets (textures) are served from. */
  assetBaseUrl: string;
  /** Called with the picked part key (or null) when the user clicks the character. */
  onPick?: (partKey: string | null) => void;
}

/** URL of a texture reference: absolute URLs pass through, paths are relative to assets/core. */
export function resolveAssetUrl(assetBaseUrl: string, path: string): string {
  return /^(https?:|blob:|data:|\/)/.test(path) ? path : `${assetBaseUrl.replace(/\/$/, '')}/${path}`;
}

/** The soft pass of two-pass hair keeps texels from this alpha up to the cutoff. */
const SOFT_ALPHA_MIN = 0.04;

/** Fetch and decode an image to RGBA (rows top first, not premultiplied), as the app's exporter decodes it. */
async function decodePixels(url: string): Promise<RgbaImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is not available');
    ctx.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, data: new Uint8ClampedArray(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data) };
  } finally {
    bitmap.close();
  }
}

interface PartObject {
  part: ScenePart;
  mesh: THREE.Mesh;
  /** Hair v2 two-pass alpha: the blended second pass over the same geometry (null without one). */
  soft: THREE.Mesh | null;
  /** Hair v2: the gradient-mapped texture shown (atlas, colour), null for a plain texture. */
  gradientKey: string | null;
  wire: THREE.LineSegments | null;
  material: THREE.ShaderMaterial;
  geometry: THREE.BufferGeometry;
  version: number;
  texture: string | null;
  wireVersion: number;
  /** Body: signature of the composited skin stack shown (null: plain texture). */
  skinSig: string | null;
  surface: SurfaceKind;
}

/** What each part is made of, for the per-pixel model. */
function surfaceOf(part: ScenePart): SurfaceKind {
  if (part.kind === 'body') return 'skin';
  if (part.kind === 'hair' || part.kind === 'fur') return 'hair';
  if (part.kind === 'eyes') return 'eyes';
  return 'cloth';
}

/** An orthographic view straight down -Z, in character space (feet on y = 0 is not applied). */
export interface FrontView {
  /** Centre of the view in character space (x, y). */
  cx: number;
  cy: number;
  /** Half the width and height of the square view, metres. */
  half: number;
}

/** A surface hit in a front view. */
export interface FrontHit {
  partKey: string;
  /** Hit point in character space (the engine's coordinates). */
  point: [number, number, number];
  uv: [number, number];
  /** Render-vertex corners of the hit triangle and the barycentric weights. */
  corners: [number, number, number];
  bary: [number, number, number];
}

export interface ViewportStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private readonly scene3d = new THREE.Scene();
  private readonly root = new THREE.Group();
  private readonly controls: OrbitControls;
  private readonly post = new PostPass();
  private readonly textures = new Map<string, Promise<THREE.Texture | null>>();
  private readonly loadedTextures = new Map<string, THREE.Texture>();
  private readonly loader = new THREE.TextureLoader();
  private objects = new Map<string, PartObject>();
  private character: CharacterScene | null = null;
  private frame = 0;
  private running = false;
  private lastTime = 0;
  private fpsAccum = { frames: 0, time: 0 };
  private resizeObserver: ResizeObserver;
  private backgroundTexture: THREE.Texture | null = null;
  private posed = false;
  private compositor: SkinCompositor | null = null;
  private skinPending: Promise<void> = Promise.resolve();
  /** Front views feed the photo tools, which want full detail. */
  private renderingFront = false;
  private readonly shadowMaps = new ShadowMaps(2048);
  private readonly ground: THREE.Mesh;
  private readonly luts = new Map<string, Promise<Lut3D | null>>();
  private lutWanted: string | null = null;
  private bakeMaps = new Map<string, { texture: THREE.Texture; ao: number; cavity: number; light: number }>();

  shading: ShadingMode = 'ps2';
  wireOverlay = false;
  lighting: LightingPresetId = 'studio';
  /** A look loaded from a .ps2look file; used instead of `lighting` while set. */
  customLook: Look | null = null;
  /** Per-vertex or per-pixel light; 'auto' follows the character's quality profile (F13). */
  lightingModel: 'auto' | LightingModel = 'auto';
  /** Shadows; 'auto' follows the character's quality profile. */
  shadowMode: 'auto' | ShadowMode = 'auto';
  postSettings: PostSettings = { ...DEFAULT_POST };
  turntable = false;
  poseTest = false;
  /** The lighting preset's own colour, black, grey, or the image from setBackgroundImage (PRD F9). */
  background: 'preset' | 'black' | 'grey' | 'image' = 'preset';
  /** Show textures at their export size (PRD F9). Off only to compare in tests. */
  exportSizePreview = true;
  /** The disc that catches the character's shadow (off for app-to-Unity parity renders, F22). */
  groundShadow = true;
  stats: ViewportStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 };

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly options: ViewportOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the post pass encodes sRGB itself
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.02, 60);
    this.camera.position.set(0, 1.0, 4.2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 12;
    this.controls.update();
    this.scene3d.add(this.root);
    this.ground = createGroundShadow(this.shadowMaps);
    this.ground.visible = false;
    this.scene3d.add(this.ground);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    this.resize();
  }

  // ------------------------------------------------------------ public API

  setCharacter(scene: CharacterScene): void {
    this.character = scene;
    this.refresh();
  }

  /** Sync GPU buffers with the CharacterScene (cheap when nothing changed). */
  refresh(): void {
    const scene = this.character;
    if (!scene) return;
    const live = new Set<string>();
    for (const part of scene.parts) {
      live.add(part.key);
      let obj = this.objects.get(part.key);
      if (!obj || obj.part !== part) {
        if (obj) this.disposeObject(obj);
        obj = this.createObject(part);
        this.objects.set(part.key, obj);
      }
      this.updateObject(obj);
    }
    for (const [key, obj] of this.objects) {
      if (!live.has(key)) {
        this.disposeObject(obj);
        this.objects.delete(key);
      }
    }
    this.root.position.y = scene.groundOffset;
  }

  setCameraPreset(id: CameraPresetId): void {
    this.setCameraFrame(CAMERA_PRESETS[id]);
  }

  /** Frame the character from any direction (presets, and the test views of M12: front, side, back and top of the head). */
  setCameraFrame(preset: CameraFrame): void {
    const h = this.characterHeight();
    const target = new THREE.Vector3(0, preset.targetHeight * h, 0);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (preset.span * h) / 2 / Math.tan(vfov / 2);
    const dir = new THREE.Vector3(Math.sin(preset.yaw) * Math.cos(preset.pitch), Math.sin(preset.pitch), Math.cos(preset.yaw) * Math.cos(preset.pitch));
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.controls.update();
  }

  /** The camera in world space (feet on y = 0, the character facing +Z), for matching renders elsewhere (Unity, F22). */
  cameraState(): { position: [number, number, number]; target: [number, number, number]; fov: number; near: number; far: number } {
    const p = this.camera.position;
    const t = this.controls.target;
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], fov: this.camera.fov, near: this.camera.near, far: this.camera.far };
  }

  /** Frame the selected part, or the whole character. */
  frameSelection(partKey: string | null): void {
    const obj = partKey ? this.objects.get(partKey) : null;
    const box = new THREE.Box3();
    if (obj) box.setFromObject(obj.mesh);
    else box.setFromObject(this.root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = size / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, Math.max(dist, 0.3));
    this.controls.update();
  }

  private backgroundRequest = 0;

  /** Load the image used when `background` is 'image'. Resolves once it is showing; rejects if it cannot be read. */
  async setBackgroundImage(url: string | null): Promise<void> {
    const request = ++this.backgroundRequest;
    const tex = url ? await this.loader.loadAsync(url) : null;
    if (request !== this.backgroundRequest) {
      tex?.dispose(); // a newer image was chosen while this one loaded
      return;
    }
    if (tex) tex.colorSpace = THREE.SRGBColorSpace;
    this.backgroundTexture?.dispose();
    this.backgroundTexture = tex;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(loop);
      this.renderFrame(t);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  /** Render a PNG at the given size (PRD F10 renders); transparent drops the background. */
  async screenshot(width: number, height: number, transparent = false): Promise<Blob> {
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevRatio = this.renderer.getPixelRatio();
    const prevAspect = this.camera.aspect;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderScene(performance.now() / 1000, transparent, { ...this.postSettings, lowRes: false });
    const blob = await new Promise<Blob>((resolve, reject) =>
      this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('screenshot failed'))), 'image/png'),
    );
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    return blob;
  }

  /** Render from a camera preset, then put the user's camera back (character browser thumbnails). */
  async screenshotFromPreset(id: CameraPresetId, width: number, height: number, transparent = false): Promise<Blob> {
    const position = this.camera.position.clone();
    const target = this.controls.target.clone();
    try {
      this.setCameraPreset(id);
      return await this.screenshot(width, height, transparent);
    } finally {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    for (const obj of this.objects.values()) this.disposeObject(obj);
    for (const t of this.loadedTextures.values()) t.dispose();
    this.compositor?.dispose();
    this.shadowMaps.dispose();
    this.gpuBaker?.dispose();
    this.post.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------ rendering

  private renderFrame(t: number): void {
    const dt = Math.min(0.1, (t - this.lastTime) / 1000);
    this.lastTime = t;
    const t0 = performance.now();
    if (this.turntable) this.root.rotation.y += dt * 0.6;
    this.controls.update();
    if (this.poseTest) {
      this.applyPoseTest(t / 1000);
      this.posed = true;
    } else if (this.posed) {
      this.posed = false;
      this.refresh(); // upload rest-pose positions again
    }
    this.renderScene(t / 1000, false, this.postSettings);
    const frameMs = performance.now() - t0;
    this.fpsAccum.frames++;
    this.fpsAccum.time += dt;
    if (this.fpsAccum.time >= 0.5) {
      this.stats = {
        fps: this.fpsAccum.frames / this.fpsAccum.time,
        frameMs,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      };
      this.fpsAccum = { frames: 0, time: 0 };
    }
  }

  private renderScene(
    time: number,
    transparent: boolean,
    post: PostSettings,
    camera: THREE.Camera = this.camera,
    output: THREE.WebGLRenderTarget | null = null,
  ): void {
    const look = this.look;
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const perPixel = this.perPixel && !this.renderingFront;
    // Front views look straight down -Z; the orbit camera at the orbit target.
    const target = camera === this.camera ? this.controls.target.clone() : camera.position.clone().addScaledVector(camDir, 5);
    const light: LightState = { look, cameraPosition: camera.position, cameraDirection: camDir, cameraTarget: target, cameraRight: right, cameraUp: up, perPixel };
    const shadows = this.renderingFront || this.shading !== 'ps2' ? 'off' : this.shadows;
    this.renderShadows(light, shadows);
    // Spot light lives in world space; the character root is offset, so feed world positions.
    for (const obj of this.objects.values()) {
      applyLighting(obj.material, light, this.shading, { affine: post.affine, snap: post.vertexSnap }, obj.surface);
      const u = obj.material.uniforms;
      const self = shadows === 'self';
      u.uKeyShadowOn!.value = self && look.lights.key ? 1 : 0;
      u.uSpotShadowOn!.value = self && look.lights.spot ? 1 : 0;
      const bake = this.renderingFront ? undefined : this.bakeMaps.get(obj.part.key);
      u.uBake!.value = bake?.texture ?? null;
      u.uHasBake!.value = bake ? 1 : 0;
      u.uAoStrength!.value = bake?.ao ?? 0;
      u.uCavityStrength!.value = bake?.cavity ?? 0;
      u.uLightBake!.value = bake?.light ?? 0;
      const limits = this.exportSizePreview && !this.renderingFront ? this.character?.exportTexels(obj.part) : undefined;
      u.uExportTexels!.value.set(limits?.texels ?? 0, limits?.head ?? 0);
      this.syncWire(obj);
      if (obj.wire) obj.wire.visible = this.wireOverlay || this.shading === 'wire';
    }
    const gu = (this.ground.material as THREE.ShaderMaterial).uniforms;
    gu.uKeyOn!.value = shadows !== 'off' && look.lights.key ? 1 : 0;
    gu.uSpotOn!.value = shadows !== 'off' && look.lights.spot ? 1 : 0;
    this.ground.visible = this.groundShadow && shadows !== 'off' && !transparent;
    const bg = this.backgroundColour(look.background);
    this.scene3d.background = transparent ? null : this.background === 'image' ? this.backgroundTexture : null;
    const size = output ? new THREE.Vector2(output.width, output.height) : this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.resize(size.x, size.y, post);
    // Renders made for the photo tools and the bake engine stay ungraded.
    this.post.grade = this.renderingFront ? NEUTRAL_GRADE : look.grade;
    this.syncLut(this.renderingFront ? null : look.grade.lut);
    this.post.apply(post, time, camera);
    this.renderer.setRenderTarget(this.post.target);
    this.renderer.setClearColor(new THREE.Color(...bg), transparent ? 0 : 1);
    this.renderer.clear();
    this.renderer.render(this.scene3d, camera);
    this.post.render(this.renderer, output);
  }

  /** The look being rendered: a loaded .ps2look, or one of the shipped looks. */
  get look(): Look {
    return this.customLook ?? LIGHTING_PRESETS[this.lighting] ?? LIGHTING_PRESETS.studio;
  }

  /** Whether lighting runs per pixel (the profile's lighting model unless overridden). */
  get perPixel(): boolean {
    const model = this.lightingModel === 'auto' ? (this.character?.engine.doc.export.lighting ?? 'vertex') : this.lightingModel;
    return model === 'pixel';
  }

  /** The shadow mode in use (the profile's unless overridden). */
  get shadows(): ShadowMode {
    return this.shadowMode === 'auto' ? (this.character?.engine.doc.export.shadows ?? 'off') : this.shadowMode;
  }

  /**
   * Baked maps per part (F16): r occlusion, g cavity, b thickness, a light
   * occlusion, in the part's own UVs, with how strongly each darkens the diffuse.
   */
  setBakeMaps(maps: Map<string, { texture: THREE.Texture; ao: number; cavity: number; light: number }>): void {
    this.bakeMaps = maps;
  }

  /** Load (once) and show the look's LUT; until it arrives the frame is ungraded by it. */
  private syncLut(path: string | null): void {
    this.lutWanted = path;
    if (!path) {
      this.post.setLut(null);
      return;
    }
    let p = this.luts.get(path);
    if (!p) {
      p = fetch(resolveAssetUrl(this.options.assetBaseUrl, path))
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
        .then((t) => parseCube(t))
        .catch((err: unknown) => {
          console.warn(`LUT ${path} failed to load`, err);
          return null;
        });
      this.luts.set(path, p);
    }
    void p.then((lut) => {
      if (this.lutWanted === path) this.post.setLut(lut);
    });
  }

  /** Resolves once the current look's LUT is loaded (renders for review wait for it). */
  async lookReady(): Promise<void> {
    const path = this.look.grade.lut;
    this.syncLut(path);
    if (path) {
      const lut = await this.luts.get(path);
      if (this.lutWanted === path) this.post.setLut(lut ?? null);
    }
  }

  /** Key-light and flashlight shadow maps for this frame. */
  private renderShadows(light: LightState, mode: ShadowMode): void {
    if (mode === 'off') return;
    const look = light.look;
    const casters = [...this.objects.values()].filter((o) => o.mesh.visible).map((o) => ({ mesh: o.mesh, material: o.material }));
    if (casters.length === 0) return;
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const bounds = box.getBoundingSphere(new THREE.Sphere());
    const texel = 1 / this.shadowMaps.size;
    for (const obj of this.objects.values()) {
      const u = obj.material.uniforms;
      u.uKeyShadow!.value = this.shadowMaps.key.target.depthTexture;
      u.uKeyShadowMatrix!.value = this.shadowMaps.key.matrix;
      u.uSpotShadow!.value = this.shadowMaps.spot.target.depthTexture;
      u.uSpotShadowMatrix!.value = this.shadowMaps.spot.matrix;
      (u.uShadowTexel!.value as THREE.Vector2).set(texel, texel);
    }
    if (look.lights.key) {
      this.shadowMaps.placeKey(new THREE.Vector3(...look.lights.key.direction), bounds);
      this.shadowMaps.render(this.renderer, this.scene3d, this.shadowMaps.key, casters);
    }
    if (look.lights.spot) {
      this.shadowMaps.placeSpot(spotPosition(light), spotDirection(light), look.lights.spot.cosOuter, look.lights.spot.range);
      this.shadowMaps.render(this.renderer, this.scene3d, this.shadowMaps.spot, casters);
    }
  }

  // ------------------------------------------------------------ front views (PRD F7)

  private frontCamera(view: FrontView): THREE.OrthographicCamera {
    const cam = new THREE.OrthographicCamera(-view.half, view.half, view.half, -view.half, 0.01, 20);
    const y = view.cy + this.root.position.y;
    cam.position.set(view.cx, y, 5);
    cam.lookAt(view.cx, y, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
  }

  /**
   * Render an orthographic front view (looking down -Z, as the photo projection
   * assumes) at size x size, with the current lighting and no post effects.
   * `parts` limits which parts are drawn. Rows top first.
   */
  renderFront(view: FrontView, size: number, parts?: (key: string) => boolean, shading?: ShadingMode): RgbaImage {
    const cam = this.frontCamera(view);
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, depthBuffer: false });
    const hidden: THREE.Object3D[] = [];
    for (const [key, obj] of this.objects) {
      if (parts && !parts(key) && obj.mesh.visible) {
        obj.mesh.visible = false;
        hidden.push(obj.mesh);
        if (obj.soft?.visible) {
          obj.soft.visible = false;
          hidden.push(obj.soft);
        }
      }
      if (obj.wire?.visible) {
        obj.wire.visible = false;
        hidden.push(obj.wire);
      }
    }
    const clean: PostSettings = { ...DEFAULT_POST, lowRes: false };
    const prevShading = this.shading;
    if (shading) this.shading = shading;
    this.renderingFront = true;
    this.renderScene(performance.now() / 1000, false, clean, cam, rt);
    this.renderingFront = false;
    this.shading = prevShading;
    for (const o of hidden) o.visible = true;
    const buf = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    rt.dispose();
    this.renderer.setRenderTarget(null);
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) data.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    return { width: size, height: size, data };
  }

  /** The surface of a part under pixel (px, py) of a front view of the given size (pixel centres at +0.5). */
  frontHit(view: FrontView, size: number, px: number, py: number, partKey = 'body'): FrontHit | null {
    const obj = this.objects.get(partKey);
    if (!obj) return null;
    const cam = this.frontCamera(view);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((px / size) * 2 - 1, -(py / size) * 2 + 1), cam);
    const hit = ray.intersectObject(obj.mesh, false)[0];
    if (!hit || !hit.face || !hit.uv) return null;
    const p = hit.point.clone().sub(this.root.position);
    const pos = obj.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tri = new THREE.Triangle(
      new THREE.Vector3().fromBufferAttribute(pos, hit.face.a),
      new THREE.Vector3().fromBufferAttribute(pos, hit.face.b),
      new THREE.Vector3().fromBufferAttribute(pos, hit.face.c),
    );
    const bary = tri.getBarycoord(hit.point.clone().sub(this.root.position), new THREE.Vector3()) ?? new THREE.Vector3(1, 0, 0);
    return {
      partKey,
      point: [p.x, p.y, p.z],
      uv: [hit.uv.x, hit.uv.y],
      corners: [hit.face.a, hit.face.b, hit.face.c],
      bary: [bary.x, bary.y, bary.z],
    };
  }

  private backgroundColour(presetBg: [number, number, number]): [number, number, number] {
    if (this.background === 'black') return [0, 0, 0];
    if (this.background === 'grey') return [0.18, 0.18, 0.19];
    return presetBg;
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private characterHeight(): number {
    const body = this.objects.get('body');
    if (!body) return 1.75;
    body.geometry.computeBoundingBox();
    const bb = body.geometry.boundingBox!;
    return bb.max.y - bb.min.y;
  }

  // ------------------------------------------------------------ parts

  private createObject(part: ScenePart): PartObject {
    const geometry = new THREE.BufferGeometry();
    const material = createPs2Material({
      map: null,
      tint: part.material.tint.color,
      brightness: part.material.tint.brightness,
      alphaTest: part.material.alphaCutout ? part.material.alphaThreshold : 0,
      doubleSided: part.material.doubleSided,
      dirt: part.material.dirt,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = part.key;
    mesh.userData.partKey = part.key;
    mesh.renderOrder = part.zDepth;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    // The wireframe overlay is built lazily once the geometry has data (see syncWire).
    const obj: PartObject = { part, mesh, soft: null, gradientKey: null, wire: null, material, geometry, version: -1, texture: null, wireVersion: -1, skinSig: null, surface: surfaceOf(part) };
    this.syncSoft(obj);
    return obj;
  }

  /**
   * Hair v2 two-pass alpha (PRD F14, F15): the opaque pass keeps texels at or
   * above the cutoff and writes depth; a second mesh over the same geometry
   * blends the softer texels in front of it without writing depth, so strand
   * tips fade instead of ending in a hard edge. The second material shares
   * every uniform with the first except its own alpha range.
   */
  private syncSoft(obj: PartObject): void {
    const want = Boolean(obj.part.material.softAlpha && obj.part.material.alphaCutout);
    if (want && !obj.soft) {
      const u = obj.material.uniforms;
      const mat = new THREE.ShaderMaterial({
        vertexShader: obj.material.vertexShader,
        fragmentShader: obj.material.fragmentShader,
        side: obj.material.side,
        transparent: true,
        depthWrite: false,
        uniforms: { ...u, uSoft: { value: 1 }, uAlphaTest: { value: SOFT_ALPHA_MIN }, uAlphaMax: { value: u.uAlphaTest!.value }, uDitherOuter: { value: 0 } },
      });
      const soft = new THREE.Mesh(obj.geometry, mat);
      soft.name = `${obj.part.key}:soft`;
      soft.userData.partKey = obj.part.key;
      soft.renderOrder = obj.part.zDepth + 0.5;
      soft.frustumCulled = false;
      // Picking and bounds go by the opaque mesh.
      soft.raycast = () => undefined;
      this.root.add(soft);
      obj.soft = soft;
    } else if (!want && obj.soft) {
      this.root.remove(obj.soft);
      (obj.soft.material as THREE.Material).dispose();
      obj.soft = null;
    }
    if (obj.soft) {
      const su = (obj.soft.material as THREE.ShaderMaterial).uniforms;
      su.uAlphaMax!.value = obj.material.uniforms.uAlphaTest!.value;
      obj.soft.visible = obj.mesh.visible;
    }
  }

  private updateObject(obj: PartObject): void {
    const p = obj.part;
    const m = p.material;
    obj.material.uniforms.uTint!.value.setRGB(...m.tint.color);
    obj.material.uniforms.uBrightness!.value = m.tint.brightness;
    obj.material.uniforms.uAlphaTest!.value = m.alphaCutout ? m.alphaThreshold : 0;
    obj.material.uniforms.uDirt!.value = m.dirt;
    obj.material.uniforms.uDitherOuter!.value = m.ditherOuter ? 1 : 0;
    // Volume normals already face out of the hair: lighting the back of a card by |N.L| would light the far side of the head.
    obj.material.uniforms.uTwoSided!.value = m.doubleSided && !m.volumeNormals ? 1 : 0;
    this.syncSoft(obj);
    if (p.kind === 'hair') obj.material.uniforms.uLayerMask!.value.set(this.hairLayers.shell ? 1 : 0, this.hairLayers.locks ? 1 : 0, this.hairLayers.cards ? 1 : 0);
    // Generated textures: Hair v2's greyscale strand atlas through the hair's gradient map, and
    // F19's generated eyes (the exporter makes the same ones).
    const grad = m.gradient;
    const eye = m.eye;
    const gradientKey =
      grad && m.texture && !m.skin
        ? `${m.texture}|${hairColourKey(grad.colour)}|${JSON.stringify(grad.regions)}`
        : eye && !m.skin
          ? `eye|${eyeLookKey(eye.look, eye.catchLight)}`
          : null;
    if (gradientKey !== obj.gradientKey) {
      obj.gradientKey = gradientKey;
      obj.texture = gradientKey;
      setMaterialTexture(obj.material, null);
      if (gradientKey && grad && m.texture) {
        const path = m.texture;
        void this.generatedTexture(gradientKey, () => this.greyAtlas(path).then((img) => colourizeHair(img, grad.regions, grad.colour))).then((tex) => {
          if (obj.gradientKey === gradientKey) setMaterialTexture(obj.material, tex);
        });
      } else if (gradientKey && eye) {
        void this.generatedTexture(gradientKey, () => Promise.resolve(eyeTexture(eye.look, EYE_TEXTURE_SIZE, eye.catchLight))).then((tex) => {
          if (obj.gradientKey === gradientKey) setMaterialTexture(obj.material, tex);
        });
      } else obj.texture = null;
    }
    if (m.skin) {
      this.syncSkin(obj, m.skin);
    } else if (obj.skinSig !== null) {
      // Back to the plain texture.
      obj.skinSig = null;
      obj.texture = null;
      obj.material.uniforms.uMapRaw!.value = 0;
    }
    if (!m.skin && !gradientKey && m.texture !== obj.texture) {
      obj.texture = m.texture;
      setMaterialTexture(obj.material, null);
      if (m.texture) {
        const wanted = m.texture;
        void this.texture(wanted).then((tex) => {
          if (obj.texture === wanted) setMaterialTexture(obj.material, tex);
        });
      }
    }
    if (obj.version === p.version) return;
    const g = obj.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
    // Expression preview (PRD F8) when sliders are up; the neutral mesh otherwise.
    const shown = p.preview ?? p;
    if (!pos || pos.count * 3 !== p.positions.length) {
      g.setAttribute('position', new THREE.BufferAttribute(shown.positions.slice(), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', new THREE.BufferAttribute(shown.normals.slice(), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(p.uvs, 2));
      if (p.layer) g.setAttribute('layer', new THREE.BufferAttribute(p.layer, 1));
      if (p.hairLayer) g.setAttribute('hairLayer', new THREE.BufferAttribute(Float32Array.from(p.hairLayer), 1));
    } else {
      (pos.array as Float32Array).set(shown.positions);
      pos.needsUpdate = true;
      const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
      (nrm.array as Float32Array).set(shown.normals);
      nrm.needsUpdate = true;
    }
    // UVs and layers can be replaced without a vertex-count change (a new hair atlas).
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (uv && uv.array !== p.uvs) g.setAttribute('uv', new THREE.BufferAttribute(p.uvs, 2));
    const layer = g.getAttribute('layer') as THREE.BufferAttribute | undefined;
    if (p.layer && layer?.array !== p.layer) {
      g.setAttribute('layer', new THREE.BufferAttribute(p.layer, 1));
      if (p.hairLayer) g.setAttribute('hairLayer', new THREE.BufferAttribute(Float32Array.from(p.hairLayer), 1));
    }
    if (!g.index || g.index.array !== p.indices || obj.version === -1) g.setIndex(new THREE.BufferAttribute(p.indices, 1));
    if (p.kind === 'body' && !g.getAttribute('headRegion')) {
      const density = this.character?.bodyHeadDensity();
      if (density?.length === p.uvs.length / 2) g.setAttribute('headRegion', new THREE.BufferAttribute(density, 1));
    }
    g.computeBoundingSphere();
    obj.version = p.version;
    this.syncWire(obj);
  }

  /** Build or rebuild the wireframe overlay when it is visible and the geometry changed. */
  private syncWire(obj: PartObject): void {
    const want = this.wireOverlay || this.shading === 'wire';
    if (!want || obj.wireVersion === obj.part.version || !obj.geometry.getAttribute('position')) return;
    if (!obj.wire) {
      obj.wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(obj.geometry),
        new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.35 }),
      );
      obj.wire.frustumCulled = false;
      this.root.add(obj.wire);
    } else {
      obj.wire.geometry.dispose();
      obj.wire.geometry = new THREE.WireframeGeometry(obj.geometry);
    }
    obj.wireVersion = obj.part.version;
  }

  /** Composite the body's skin stack on the GPU when it changed (PRD F6). */
  private syncSkin(obj: PartObject, skin: NonNullable<ScenePart['material']['skin']>): void {
    if (obj.skinSig === skin.signature) return;
    obj.skinSig = skin.signature;
    obj.texture = null;
    const sig = skin.signature;
    const compositor = this.skinCompositor;
    this.skinPending = this.skinPending
      .then(() => compositor.composite(skin))
      .then((tex) => {
        if (obj.skinSig !== sig || !tex) return;
        setMaterialTexture(obj.material, tex);
        obj.material.uniforms.uMapRaw!.value = 1;
      })
      .catch((err: unknown) => console.warn('skin composite failed', err));
  }

  private gpuBaker: GpuBaker | null = null;

  /** The GPU bake engine (F16), on this viewport's renderer (created on first use). */
  get baker(): GpuBaker {
    this.gpuBaker ??= new GpuBaker(this.renderer);
    return this.gpuBaker;
  }

  /** The GPU skin compositor (created on first use). */
  get skinCompositor(): SkinCompositor {
    this.compositor ??= new SkinCompositor(this.renderer, (p) => resolveAssetUrl(this.options.assetBaseUrl, p));
    return this.compositor;
  }

  /** Resolves when the last requested skin composite is on the body. */
  skinSettled(): Promise<void> {
    return this.skinPending;
  }

  /** The current composited skin (2048 px, sRGB, rows top first), or null when the body shows a plain texture. */
  skinComposite(): RgbaImage | null {
    const body = this.objects.get('body');
    return body?.skinSig ? (this.compositor?.readPixels() ?? null) : null;
  }

  /**
   * The skin composited without some of its document layers (Material Painter's
   * reference: everything under its own paint), then the full skin again on the
   * body. Null when the body shows a plain texture.
   */
  skinCompositeWithout(layerIds: readonly string[]): Promise<RgbaImage | null> {
    const body = this.objects.get('body');
    const skin = body?.part.material.skin;
    if (!body || !skin) return Promise.resolve(null);
    const compositor = this.skinCompositor;
    let pixels: RgbaImage | null = null;
    const run = this.skinPending.then(async () => {
      const tex = await compositor.composite({ ...skin, layers: skin.layers.filter((l) => !l.layerId || !layerIds.includes(l.layerId)) });
      pixels = tex ? compositor.readPixels() : null;
      // The body's material samples the compositor's output: put the full skin back.
      await compositor.composite(skin);
    });
    this.skinPending = run.catch((err: unknown) => console.warn('skin composite failed', err));
    return run.then(() => pixels);
  }

  private readonly headGeometries = new WeakMap<HeadLayout, THREE.BufferGeometry>();

  /**
   * The skin stack composited straight into the head texture's layout (Part 2
   * F19) at the composite's size, gutters filled; the full skin goes back on
   * the body afterwards. Null when the body shows a plain texture or its head
   * layout is not loaded.
   */
  headComposite(): Promise<RgbaImage | null> {
    const body = this.objects.get('body');
    const skin = body?.part.material.skin;
    const head = this.character?.bodyHeadLayout;
    if (!body || !skin || !head) return Promise.resolve(null);
    let geometry = this.headGeometries.get(head);
    if (!geometry) {
      geometry = headGeometry(head);
      this.headGeometries.set(head, geometry);
    }
    const compositor = this.skinCompositor;
    let pixels: RgbaImage | null = null;
    const run = this.skinPending.then(async () => {
      const tex = await compositor.composite(skin, geometry);
      pixels = tex ? fillGutters(compositor.readPixels()) : null;
      await compositor.composite(skin);
    });
    this.skinPending = run.catch((err: unknown) => console.warn('head composite failed', err));
    return run.then(() => pixels);
  }

  /** A texture (asset path or library URL) as pixels, rows top first. */
  texturePixels(path: string): Promise<RgbaImage> {
    return decodePixels(resolveAssetUrl(this.options.assetBaseUrl, path));
  }

  /** Gradient-mapped hair textures by key (atlas, colour), the last few kept. */
  private readonly gradientTextures = new Map<string, Promise<THREE.Texture | null>>();
  private readonly greyAtlases = new Map<string, Promise<RgbaImage>>();

  private greyAtlas(path: string): Promise<RgbaImage> {
    let grey = this.greyAtlases.get(path);
    if (!grey) {
      grey = decodePixels(resolveAssetUrl(this.options.assetBaseUrl, path));
      this.greyAtlases.set(path, grey);
    }
    return grey;
  }

  /** A texture made on the CPU (hair through its gradient map, generated eyes), cached by key. */
  private generatedTexture(key: string, make: () => Promise<RgbaImage>): Promise<THREE.Texture | null> {
    let p = this.gradientTextures.get(key);
    if (!p) {
      p = make()
        .then((img) => {
          // DataTextures are not flipped on upload: rows go in bottom first, as OBJ/MakeHuman UVs expect.
          const W = img.width;
          const H = img.height;
          const data = new Uint8Array(W * H * 4);
          for (let y = 0; y < H; y++) data.set(img.data.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
          const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = true;
          tex.anisotropy = 1;
          tex.needsUpdate = true;
          return tex as THREE.Texture;
        })
        .catch((err: unknown) => {
          console.warn(`generated texture ${key.slice(0, 60)} failed`, err);
          return null;
        });
      this.gradientTextures.set(key, p);
      // A colour slider drag makes many; keep the last few.
      while (this.gradientTextures.size > 6) {
        const oldest = this.gradientTextures.keys().next().value!;
        const old = this.gradientTextures.get(oldest)!;
        this.gradientTextures.delete(oldest);
        void old.then((t) => {
          if (t && ![...this.objects.values()].some((o) => o.material.uniforms.uMap!.value === t)) t.dispose();
        });
      }
    }
    return p;
  }

  /** Hair Studio's layer view: which hair layers are drawn. */
  private hairLayers = { shell: true, locks: true, cards: true };

  setHairLayers(layers: { shell: boolean; locks: boolean; cards: boolean }): void {
    this.hairLayers = { ...layers };
    this.refresh();
  }

  /**
   * An ID render (PRD M12 test): every part in a flat colour by kind (hair 1,
   * body 2, everything else 3 in the red channel), with each material's alpha
   * cutout, no lighting and no post. Rows top first.
   */
  renderIds(width: number, height: number): { width: number; height: number; data: Uint8Array } {
    const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true });
    const prevAspect = this.camera.aspect;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const saved: { u: Record<string, THREE.IUniform>; mode: number }[] = [];
    const hidden: THREE.Object3D[] = [];
    for (const obj of this.objects.values()) {
      const u = obj.material.uniforms;
      saved.push({ u, mode: u.uMode!.value as number });
      u.uMode!.value = 4;
      const id = obj.part.kind === 'hair' ? 1 : obj.part.kind === 'body' ? 2 : 3;
      u.uIdColor!.value.set(id / 255, 0, 0);
      // Only the opaque pass counts: soft texels are below the cutoff.
      if (obj.soft?.visible) {
        obj.soft.visible = false;
        hidden.push(obj.soft);
      }
      if (obj.wire?.visible) {
        obj.wire.visible = false;
        hidden.push(obj.wire);
      }
    }
    const groundVisible = this.ground.visible;
    this.ground.visible = false;
    const bg = this.scene3d.background;
    this.scene3d.background = null;
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene3d, this.camera);
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    this.renderer.setRenderTarget(null);
    this.scene3d.background = bg;
    this.ground.visible = groundVisible;
    for (const s of saved) s.u.uMode!.value = s.mode;
    for (const o of hidden) o.visible = true;
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    target.dispose();
    // GL rows are bottom first.
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    return { width, height, data };
  }

  private texture(path: string): Promise<THREE.Texture | null> {
    let p = this.textures.get(path);
    if (!p) {
      const url = resolveAssetUrl(this.options.assetBaseUrl, path);
      p = this.loader
        .loadAsync(url)
        .then((tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = true; // OBJ/MakeHuman UVs: v = 0 is the bottom of the image
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = 1;
          this.loadedTextures.set(path, tex);
          return tex;
        })
        .catch((err: unknown) => {
          console.warn(`texture ${path} failed to load`, err);
          return null;
        });
      this.textures.set(path, p);
    }
    return p;
  }

  private disposeObject(obj: PartObject): void {
    this.root.remove(obj.mesh);
    if (obj.soft) {
      this.root.remove(obj.soft);
      (obj.soft.material as THREE.Material).dispose();
    }
    obj.geometry.dispose();
    obj.material.dispose();
    if (obj.wire) {
      this.root.remove(obj.wire);
      obj.wire.geometry.dispose();
      (obj.wire.material as THREE.Material).dispose();
    }
  }

  // ------------------------------------------------------------ pose test (PRD M2)

  private applyPoseTest(t: number): void {
    const scene = this.character;
    if (!scene) return;
    const sk = scene.engine.skeleton;
    const rig = sk.rig;
    const rot: (Mat3 | null)[] = new Array(rig.boneCount).fill(null);
    const swing = Math.sin(t * 2.2);
    const set = (name: string, m: Mat3) => {
      const i = rig.index.get(name);
      if (i !== undefined) rot[i] = m;
    };
    // Procedural walk-ish swing in bone space (bones point along their local Y).
    set('upperarm_l', eulerXYZ(0.55 * swing, 0, 0));
    set('upperarm_r', eulerXYZ(-0.55 * swing, 0, 0));
    set('lowerarm_l', eulerXYZ(0.35 + 0.25 * swing, 0, 0));
    set('lowerarm_r', eulerXYZ(0.35 - 0.25 * swing, 0, 0));
    set('thigh_l', eulerXYZ(-0.45 * swing, 0, 0));
    set('thigh_r', eulerXYZ(0.45 * swing, 0, 0));
    set('calf_l', eulerXYZ(Math.max(0, 0.6 * swing), 0, 0));
    set('calf_r', eulerXYZ(Math.max(0, -0.6 * swing), 0, 0));
    set('spine_02', eulerXYZ(0, 0.12 * swing, 0));
    set('head', eulerXYZ(0, -0.2 * swing, 0));
    const skin = skinningMatrices(sk, poseWorldMatrices(sk, rot));
    for (const obj of this.objects.values()) {
      const inf = scene.influences(obj.part.key);
      if (!inf) continue;
      const pos = obj.geometry.getAttribute('position') as THREE.BufferAttribute;
      const nrm = obj.geometry.getAttribute('normal') as THREE.BufferAttribute;
      const shown = obj.part.preview ?? obj.part;
      skinPositions(shown.positions, inf, skin, pos.array as Float32Array, shown.normals, nrm.array as Float32Array);
      pos.needsUpdate = true;
      nrm.needsUpdate = true;
      obj.version = -2; // force a rest-pose upload when the pose test is switched off
    }
  }

  // ------------------------------------------------------------ picking

  private downAt: { x: number; y: number } | null = null;

  private onPointerDown = (e: PointerEvent): void => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent): void => {
    // In Hair Studio a click is a brush dab, not a pick.
    if (this.brushMode) return;
    if (!this.downAt || Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) return;
    this.downAt = null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const meshes = [...this.objects.values()].map((o) => o.mesh);
    const hit = ray.intersectObjects(meshes, false)[0];
    this.options.onPick?.(hit ? (hit.object.userData.partKey as string) : null);
  };

  // ------------------------------------------------------------ Hair Studio (PRD F15)

  private groomLines: THREE.LineSegments | null = null;

  /**
   * Draw groom guides over the character (engine space, as the scene's parts):
   * selected ones (weight > 0) in a warm colour, the rest cool. Null removes them.
   */
  setGroomOverlay(curves: { points: [number, number, number][]; selected?: number }[] | null): void {
    if (!curves) {
      if (this.groomLines) {
        this.root.remove(this.groomLines);
        this.groomLines.geometry.dispose();
        (this.groomLines.material as THREE.Material).dispose();
        this.groomLines = null;
      }
      return;
    }
    const pos: number[] = [];
    const col: number[] = [];
    for (const c of curves) {
      const s = Math.min(1, Math.max(0, c.selected ?? 0));
      const rgb = [0.45 + 0.55 * s, 0.85 - 0.35 * s, 1 - 0.8 * s];
      for (let i = 1; i < c.points.length; i++) {
        pos.push(...c.points[i - 1]!, ...c.points[i]!);
        col.push(...rgb, ...rgb);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (!this.groomLines) {
      this.groomLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
      this.groomLines.renderOrder = 1000;
      this.groomLines.frustumCulled = false;
      this.root.add(this.groomLines);
    } else {
      this.groomLines.geometry.dispose();
      this.groomLines.geometry = g;
    }
  }

  /** Left drag orbits normally; in Hair Studio it paints, and orbiting moves to the right button. */
  private brushMode = false;

  setBrushMode(on: boolean): void {
    this.brushMode = on;
    this.controls.mouseButtons = on
      ? { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }

  /**
   * The camera for screen-space brushes, in engine space (the scene's parts,
   * before the ground offset) and canvas pixels (client offsets from the canvas' corner).
   */
  groomView(): {
    project(p: [number, number, number]): { x: number; y: number; depth: number };
    unproject(x: number, y: number, depth: number): [number, number, number];
    eye: [number, number, number];
    pick(x: number, y: number, partKey?: string): { point: [number, number, number]; normal: [number, number, number] } | null;
  } {
    const rect = this.canvas.getBoundingClientRect();
    const cam = this.camera;
    cam.updateMatrixWorld();
    const off = this.root.position.clone();
    const camDir = cam.getWorldDirection(new THREE.Vector3());
    const v = new THREE.Vector3();
    return {
      project: (p) => {
        v.set(p[0], p[1], p[2]).add(off);
        const depth = v.clone().sub(cam.position).dot(camDir);
        v.project(cam);
        return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height, depth };
      },
      unproject: (x, y, depth) => {
        const ndc = new THREE.Vector3((x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2, 0.5).unproject(cam);
        const dir = ndc.sub(cam.position).normalize();
        const t = depth / Math.max(1e-6, dir.dot(camDir));
        const w = cam.position.clone().addScaledVector(dir, t).sub(off);
        return [w.x, w.y, w.z];
      },
      eye: [cam.position.x - off.x, cam.position.y - off.y, cam.position.z - off.z],
      pick: (x, y, partKey = 'body') => {
        const obj = this.objects.get(partKey);
        if (!obj) return null;
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2), cam);
        const hit = ray.intersectObject(obj.mesh, false)[0];
        if (!hit || !hit.face) return null;
        const p = hit.point.clone().sub(off);
        const n = hit.face.normal.clone().transformDirection(obj.mesh.matrixWorld);
        return { point: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] };
      },
    };
  }

  /** Key of the part under a client-space point (drag-and-drop targeting). */
  partAt(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects([...this.objects.values()].map((o) => o.mesh), false)[0];
    return hit ? (hit.object.userData.partKey as string) : null;
  }
}

/** Head triangles at their head-texture UVs (clip space), sampling at their hm08 UVs. */
function headGeometry(head: HeadLayout): THREE.BufferGeometry {
  const tris = head.mesh.triangles;
  const position = new Float32Array(tris.length * 9);
  const uv = new Float32Array(tris.length * 6);
  tris.forEach((t, i) => {
    t.corners.forEach((c, k) => {
      position[(i * 3 + k) * 3] = head.uv[c * 2]! * 2 - 1;
      position[(i * 3 + k) * 3 + 1] = head.uv[c * 2 + 1]! * 2 - 1;
      uv[(i * 3 + k) * 2] = head.mesh.uvs[c * 2]!;
      uv[(i * 3 + k) * 2 + 1] = head.mesh.uvs[c * 2 + 1]!;
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Fill the uncovered texels (alpha 0) from their covered neighbours, so mipmaps do not bleed in black. */
function fillGutters(img: RgbaImage | null): RgbaImage | null {
  if (!img) return null;
  const covered = new Uint8Array(img.width * img.height);
  for (let i = 0; i < covered.length; i++) covered[i] = img.data[i * 4 + 3]! > 127 ? 1 : 0;
  dilateRgb(img, covered, Math.max(4, Math.round(img.width / 128)));
  for (let i = 0; i < covered.length; i++) img.data[i * 4 + 3] = 255;
  return img;
}

