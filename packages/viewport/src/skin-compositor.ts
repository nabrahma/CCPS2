/**
 * GPU skin compositor (PRD F6: "Compositing happens in a WebGL render target
 * at 2048 px"). It composites the layer stack resolved by @ps2cc/core
 * (SkinComposer) with exactly the rules of the core reference compositor
 * (packages/core/src/skin/blend.ts): blending on sRGB-encoded 8-bit values,
 * one pass per layer, each pass rounded to 8 bits by the render target. The
 * M6 acceptance test (app/frontend/e2e/m6.spec.ts) compares the two.
 *
 * The result stays sRGB-encoded in a plain RGBA8 texture; the PS2 material
 * decodes it (uMapRaw) the same way the GPU decodes sRGB textures.
 *
 * Part 2 F19: the same passes can draw the head triangles instead of a
 * full-screen quad (`into`), each at its head-texture UV and sampling the
 * layers at its hm08 UV, which composites the stack straight into the head
 * texture's layout at full resolution. Alpha is then 1 on the triangles and
 * 0 in the gutters.
 */
import * as THREE from 'three';
import type { RgbaImage, ResolvedSkin, ResolvedSkinLayer } from '@ps2cc/core';
import { BLEND_MODE_ID, MASK_CHANNEL } from '@ps2cc/core';

const vertexShader = /* glsl */ `
varying vec2 vUv;  // where the layers are sampled (hm08 UV)
varying vec2 vDst; // where the result is written (the target's UV)
void main() {
  vUv = uv;
  vDst = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uBelow;
uniform sampler2D uLayer;
uniform sampler2D uMask;
uniform sampler2D uTile;  // micro-detail tile (REPEAT), kind 4
uniform float uRepeat;    // tiles across the UV square
uniform int uKind;        // 0 pixels, 1 HSV adjustment, 2 copy the base, 3 copy below, 4 micro-detail
uniform int uMode;        // 0 normal, 1 multiply, 2 overlay, 3 screen
uniform int uMaskChannel; // -1 none, 0 face, 1 body, 2 hands
uniform float uOpacity;
uniform float uLayerFlip; // 1: image rows are stored top first (DataTexture)
uniform vec3 uHsv;        // hue shift (degrees), saturation and value multipliers
varying vec2 vUv;
varying vec2 vDst;

float q(float x) { return floor(x * 255.0 + 0.5) / 255.0; }
vec3 q3(vec3 c) { return floor(c * 255.0 + 0.5) / 255.0; }

float blendCh(int mode, float b, float s) {
  if (mode == 1) return b * s;
  if (mode == 3) return 1.0 - (1.0 - b) * (1.0 - s);
  if (mode == 2) return b < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
  return s;
}

vec3 rgbToHsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  float h = 0.0;
  if (d > 1e-6) {
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
    if (h < 0.0) h += 1.0;
  }
  return vec3(h, mx > 1e-6 ? d / mx : 0.0, mx);
}

float hsvF(float n, vec3 hsv) {
  float k = mod(n + hsv.x * 6.0, 6.0);
  return hsv.z - hsv.z * hsv.y * clamp(min(k, 4.0 - k), 0.0, 1.0);
}

vec3 adjust(vec3 c) {
  vec3 hsv = rgbToHsv(c);
  float h = hsv.x + uHsv.x / 360.0;
  h -= floor(h);
  hsv = vec3(h, clamp(hsv.y * uHsv.y, 0.0, 1.0), clamp(hsv.z * uHsv.z, 0.0, 1.0));
  return vec3(hsvF(5.0, hsv), hsvF(3.0, hsv), hsvF(1.0, hsv));
}

void main() {
  if (uKind == 2) {
    gl_FragColor = vec4(q3(texture2D(uLayer, uLayerFlip > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv).rgb), 1.0);
    return;
  }
  vec3 b = texture2D(uBelow, vDst).rgb;
  if (uKind == 3) {
    gl_FragColor = vec4(b, 1.0);
    return;
  }
  float m = 1.0;
  if (uMaskChannel >= 0) {
    vec4 mk = texture2D(uMask, vec2(vUv.x, 1.0 - vUv.y));
    m = q(uMaskChannel == 0 ? mk.r : uMaskChannel == 1 ? mk.g : mk.b);
  }
  vec3 s;
  float a;
  if (uKind == 1) {
    s = adjust(b);
    a = 1.0;
  } else if (uKind == 4) {
    // Coverage from the region map (rows top first), colour from the tile at full resolution.
    a = q(texture2D(uLayer, vec2(vUv.x, 1.0 - vUv.y)).a);
    s = q3(texture2D(uTile, vec2(vUv.x * uRepeat, 1.0 - vUv.y * uRepeat)).rgb);
  } else {
    vec4 l = texture2D(uLayer, uLayerFlip > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv);
    s = q3(l.rgb);
    a = q(l.a);
  }
  float w = a * uOpacity * m;
  vec3 r = b + (vec3(blendCh(uMode, b.r, s.r), blendCh(uMode, b.g, s.g), blendCh(uMode, b.b, s.b)) - b) * w;
  gl_FragColor = vec4(w > 0.0 ? r : b, 1.0);
}
`;

export interface CompositorStats {
  passes: number;
  ms: number;
}

export class SkinCompositor {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly plane: THREE.PlaneGeometry;
  /** Clear each target before its pass (when drawing triangles rather than the full quad). */
  private clearEach = false;
  private size = 0;
  private ping: THREE.WebGLRenderTarget | null = null;
  private pong: THREE.WebGLRenderTarget | null = null;
  private out: THREE.WebGLRenderTarget | null = null;
  private readonly pixelTextures = new WeakMap<RgbaImage, THREE.DataTexture>();
  private readonly tileTextures = new WeakMap<RgbaImage, THREE.DataTexture>();
  private readonly urlTextures = new Map<string, Promise<THREE.Texture | null>>();
  private readonly loader = new THREE.TextureLoader();
  private maskTexture: { image: RgbaImage; texture: THREE.DataTexture } | null = null;
  private readonly white: THREE.DataTexture;
  lastStats: CompositorStats = { passes: 0, ms: 0 };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly resolveUrl: (path: string) => string,
  ) {
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uBelow: { value: null },
        uLayer: { value: this.white },
        uMask: { value: this.white },
        uKind: { value: 0 },
        uMode: { value: 0 },
        uMaskChannel: { value: -1 },
        uOpacity: { value: 1 },
        uLayerFlip: { value: 0 },
        uHsv: { value: new THREE.Vector3(0, 1, 1) },
        uTile: { value: this.white },
        uRepeat: { value: 1 },
      },
    });
    this.plane = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.plane, this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** The composited skin (sRGB-encoded RGBA8, mipmapped), or null before the first composite. */
  get texture(): THREE.Texture | null {
    return this.out?.texture ?? null;
  }

  /**
   * Composite a resolved stack. Loads URL layers first; returns null if the
   * base texture cannot be loaded.
   */
  async composite(skin: ResolvedSkin, into?: THREE.BufferGeometry): Promise<THREE.Texture | null> {
    const base = skin.base ? await this.urlTexture(skin.base) : null;
    if (!base) return null;
    const urls = await Promise.all(skin.layers.map((l) => (l.source.kind === 'url' ? this.urlTexture(l.source.url) : Promise.resolve(null))));
    return this.compositeLoaded(skin.size, { texture: base, flip: false }, skin.layers, urls, skin.masks, into);
  }

  /**
   * Composite raw pixels (tests: the base and layers as images). Same passes as
   * composite(), without any URL loading.
   */
  compositePixels(size: number, base: RgbaImage, layers: ResolvedSkinLayer[], masks: RgbaImage | null): THREE.Texture {
    return this.compositeLoaded(size, { texture: this.pixelTexture(base), flip: true }, layers, layers.map(() => null), masks);
  }

  private compositeLoaded(
    size: number,
    base: { texture: THREE.Texture; flip: boolean },
    layers: ResolvedSkinLayer[],
    urlTextures: (THREE.Texture | null)[],
    masks: RgbaImage | null,
    into?: THREE.BufferGeometry,
  ): THREE.Texture {
    const t0 = performance.now();
    this.ensureTargets(size);
    const r = this.renderer;
    this.quad.geometry = into ?? this.plane;
    this.clearEach = Boolean(into);
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    const u = this.material.uniforms;
    let src = this.ping!;
    let dst = this.pong!;
    // Base. Unused inputs get a neutral texture: a sampler still bound to the target being
    // written (the last pass of the previous composite) is a feedback loop, and WebGL then
    // silently skips the draw, so composites would pile up on the previous result.
    u.uBelow!.value = this.white;
    u.uMask!.value = this.white;
    u.uKind!.value = 2;
    u.uLayer!.value = base.texture;
    u.uLayerFlip!.value = base.flip ? 1 : 0;
    this.pass(src);
    let passes = 1;
    const maskTex = masks ? this.masksTexture(masks) : this.white;
    layers.forEach((layer, i) => {
      if (layer.opacity <= 0) return;
      u.uBelow!.value = src.texture;
      u.uMode!.value = BLEND_MODE_ID[layer.blend];
      u.uOpacity!.value = layer.opacity;
      u.uMaskChannel!.value = masks ? MASK_CHANNEL[layer.mask] : -1;
      u.uMask!.value = maskTex;
      const s = layer.source;
      if (s.kind === 'adjust') {
        u.uKind!.value = 1;
        (u.uHsv!.value as THREE.Vector3).set(s.hsv.hue, s.hsv.saturation, s.hsv.value);
      } else if (s.kind === 'detail') {
        u.uKind!.value = 4;
        u.uLayer!.value = this.pixelTexture(s.weight);
        u.uTile!.value = this.tileTexture(s.tile);
        u.uRepeat!.value = s.repeat;
      } else {
        const tex = s.kind === 'pixels' ? this.pixelTexture(s.image) : urlTextures[i];
        if (!tex) return;
        u.uKind!.value = 0;
        u.uLayer!.value = tex;
        u.uLayerFlip!.value = s.kind === 'pixels' ? 1 : 0;
      }
      this.pass(dst);
      [src, dst] = [dst, src];
      passes++;
    });
    // Copy into the output target (mipmapped for the material).
    u.uKind!.value = 3;
    u.uLayer!.value = this.white;
    u.uTile!.value = this.white;
    u.uMask!.value = this.white;
    u.uBelow!.value = src.texture;
    this.pass(this.out!);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    this.quad.geometry = this.plane;
    this.clearEach = false;
    this.lastStats = { passes: passes + 1, ms: performance.now() - t0 };
    return this.out!.texture;
  }

  /** Read the last composite back (rows top first, v = 1 at row 0), for export and tests. */
  readPixels(): RgbaImage | null {
    if (!this.out) return null;
    const n = this.size;
    const buf = new Uint8Array(n * n * 4);
    this.renderer.readRenderTargetPixels(this.out, 0, 0, n, n, buf);
    const data = new Uint8ClampedArray(n * n * 4);
    for (let y = 0; y < n; y++) data.set(buf.subarray((n - 1 - y) * n * 4, (n - y) * n * 4), y * n * 4);
    return { width: n, height: n, data };
  }

  dispose(): void {
    this.ping?.dispose();
    this.pong?.dispose();
    this.out?.dispose();
    this.maskTexture?.texture.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.white.dispose();
    for (const p of this.urlTextures.values()) void p.then((t) => t?.dispose());
  }

  private pass(target: THREE.WebGLRenderTarget): void {
    this.renderer.setRenderTarget(target);
    if (this.clearEach) {
      // Drawing triangles: texels outside them must read as uncovered (alpha 0).
      const colour = this.renderer.getClearColor(new THREE.Color());
      const alpha = this.renderer.getClearAlpha();
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, false, false);
      this.renderer.setClearColor(colour, alpha);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private ensureTargets(size: number): void {
    if (this.size === size && this.ping) return;
    this.ping?.dispose();
    this.pong?.dispose();
    this.out?.dispose();
    const opts: THREE.RenderTargetOptions = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      colorSpace: THREE.NoColorSpace,
    };
    this.ping = new THREE.WebGLRenderTarget(size, size, opts);
    this.pong = new THREE.WebGLRenderTarget(size, size, opts);
    this.out = new THREE.WebGLRenderTarget(size, size, {
      ...opts,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
    });
    this.size = size;
  }

  private pixelTexture(img: RgbaImage): THREE.DataTexture {
    let tex = this.pixelTextures.get(img);
    if (!tex) {
      tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.colorSpace = THREE.NoColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.needsUpdate = true;
      this.pixelTextures.set(img, tex);
    }
    return tex;
  }

  /** A micro-detail tile: wraps around (REPEAT), bilinear, no mipmaps (detail.ts sizes it for that). */
  private tileTexture(img: RgbaImage): THREE.DataTexture {
    let tex = this.tileTextures.get(img);
    if (!tex) {
      tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.colorSpace = THREE.NoColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.needsUpdate = true;
      this.tileTextures.set(img, tex);
    }
    return tex;
  }

  private masksTexture(img: RgbaImage): THREE.DataTexture {
    if (this.maskTexture?.image !== img) {
      this.maskTexture?.texture.dispose();
      const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.colorSpace = THREE.NoColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      this.maskTexture = { image: img, texture: tex };
    }
    return this.maskTexture.texture;
  }

  /** Images for the compositor are kept sRGB-encoded (NoColorSpace) so blending sees the stored values. */
  private urlTexture(path: string): Promise<THREE.Texture | null> {
    let p = this.urlTextures.get(path);
    if (!p) {
      p = this.loader
        .loadAsync(this.resolveUrl(path))
        .then((tex) => {
          tex.colorSpace = THREE.NoColorSpace;
          tex.flipY = true;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          return tex;
        })
        .catch((err: unknown) => {
          console.warn(`skin texture ${path} failed to load`, err);
          this.urlTextures.delete(path);
          return null;
        });
      this.urlTextures.set(path, p);
    }
    return p;
  }
}
