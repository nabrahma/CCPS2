/**
 * The 3D viewport (PRD F9). Renders a CharacterScene from @ps2cc/core; it
 * never computes character geometry itself.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  eulerXYZ,
  NEUTRAL_GRADE,
  parseCube,
  poseWorldMatrices,
  skinningMatrices,
  skinPositions,
  type CharacterScene,
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

interface PartObject {
  part: ScenePart;
  mesh: THREE.Mesh;
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
  if (part.kind === 'hair') return 'hair';
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
    const preset = CAMERA_PRESETS[id];
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
    return { part, mesh, wire: null, material, geometry, version: -1, texture: null, wireVersion: -1, skinSig: null, surface: surfaceOf(part) };
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
    if (m.skin) {
      this.syncSkin(obj, m.skin);
    } else if (obj.skinSig !== null) {
      // Back to the plain texture.
      obj.skinSig = null;
      obj.texture = null;
      obj.material.uniforms.uMapRaw!.value = 0;
    }
    if (!m.skin && m.texture !== obj.texture) {
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
    if (p.layer && layer?.array !== p.layer) g.setAttribute('layer', new THREE.BufferAttribute(p.layer, 1));
    if (!g.index || g.index.array !== p.indices || obj.version === -1) g.setIndex(new THREE.BufferAttribute(p.indices, 1));
    if (p.kind === 'body' && !g.getAttribute('headRegion')) {
      const flags = this.character?.bodyHeadFlags();
      if (flags?.length === p.uvs.length / 2) g.setAttribute('headRegion', new THREE.BufferAttribute(flags, 1));
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
