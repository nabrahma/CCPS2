/**
 * Post stack (PRD F9; Part 2 F14). The scene is rendered linear into a
 * half-float target; this pass adds bloom, applies exposure and filmic tone
 * mapping, converts to sRGB, grades through the look's 3D LUT, then the
 * effects: chromatic aberration, vignette, film grain, VHS chroma bleed,
 * interlace, optional 640x448 internal resolution and 16-bit colour with
 * ordered dither, and depth of field for renders.
 *
 * With the neutral grade (Part 1's looks) the output is exactly Part 1's.
 * The Unity package's PS2/Grade shader runs the same steps.
 */
import * as THREE from 'three';
import { NEUTRAL_GRADE, type Lut3D, type LookGrade } from '@ps2cc/core';
import type { PostSettings } from './presets';

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Bright-pass and 4-tap box downsample (the first level also applies the threshold). */
const downFragment = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uPrefilter;
varying vec2 vUv;
vec3 tap(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 c = (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25;
  if (uPrefilter > 0.5) {
    float b = max(c.r, max(c.g, c.b));
    float knee = uThreshold * 0.5;
    float soft = clamp(b - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    c *= max(soft, b - uThreshold) / max(b, 1e-4);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

/** 9-tap tent upsample, added onto the next larger level. */
const upFragment = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tBase;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 d = uTexel * (0.5 + uRadius);
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(d.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(d.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, d.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, d.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + d).rgb + texture2D(tSrc, vUv - d).rgb + texture2D(tSrc, vUv + vec2(d.x, -d.y)).rgb + texture2D(tSrc, vUv + vec2(-d.x, d.y)).rgb;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + c / 16.0, 1.0);
}
`;

const finalFragment = /* glsl */ `
precision highp sampler3D;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tDepth;
uniform sampler3D tLut;
uniform vec2 uSrcRes;
uniform float uTime;
uniform float uExposure;
uniform float uTonemap;
uniform float uBloom;
uniform float uHasLut;
uniform float uLutSize;
uniform float uLutStrength;
uniform float uChromatic;
uniform float uDither;
uniform float uGrain;
uniform float uVhs;
uniform float uInterlace;
uniform float uVignette;
uniform float uDof;
uniform float uFocus;
uniform float uAperture;
uniform vec2 uClip; // camera near, far
varying vec2 vUv;

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// ACES filmic curve, Narkowicz's fit (the same in PS2Grade.shader).
vec3 filmic(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 rgb2yiq(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312)));
}

vec3 yiq2rgb(vec3 c) {
  return vec3(c.x + 0.956 * c.y + 0.621 * c.z, c.x - 0.272 * c.y - 0.647 * c.z, c.x - 1.106 * c.y + 1.703 * c.z);
}

float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  // 4x4 Bayer matrix, normalised to [0, 1).
  float m[16];
  m[0] = 0.0; m[1] = 8.0; m[2] = 2.0; m[3] = 10.0;
  m[4] = 12.0; m[5] = 4.0; m[6] = 14.0; m[7] = 6.0;
  m[8] = 3.0; m[9] = 11.0; m[10] = 1.0; m[11] = 9.0;
  m[12] = 15.0; m[13] = 7.0; m[14] = 13.0; m[15] = 5.0;
  float v = 0.0;
  for (int k = 0; k < 16; k++) { if (float(k) == i) v = m[k]; }
  return v / 16.0;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float linearDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  float z = d * 2.0 - 1.0;
  return 2.0 * uClip.x * uClip.y / (uClip.y + uClip.x - z * (uClip.y - uClip.x));
}

vec4 sceneAt(vec2 uv) {
  vec4 s = texture2D(tScene, uv);
  if (uChromatic > 0.0) {
    vec2 off = (uv - 0.5) * uChromatic / 1080.0 * 2.0;
    s.r = texture2D(tScene, uv + off).r;
    s.b = texture2D(tScene, uv - off).b;
  }
  return s;
}

void main() {
  vec4 src = sceneAt(vUv);
  vec3 c = src.rgb;
  if (uDof > 0.5) {
    // Gather blur sized by the circle of confusion at this pixel (renders only).
    float z = linearDepth(vUv);
    float coc = clamp(abs(z - uFocus) / max(z, 1e-3) * uAperture * 18.0, 0.0, 12.0);
    if (coc > 0.5) {
      vec3 acc = c;
      float w = 1.0;
      for (int i = 0; i < 24; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt((float(i) + 0.5) / 24.0) * coc;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uSrcRes;
        float zi = linearDepth(uv);
        // Sharp foreground does not bleed onto a blurred background.
        float k = zi < z - 0.05 && abs(zi - uFocus) < abs(z - uFocus) ? 0.15 : 1.0;
        acc += sceneAt(uv).rgb * k;
        w += k;
      }
      c = acc / w;
    }
  }
  if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * uBloom;
  if (uVhs > 0.0) {
    float dx = uVhs * 2.5 / uSrcRes.x;
    vec3 yiq = rgb2yiq(c);
    vec3 a = rgb2yiq(texture2D(tScene, vUv - vec2(dx, 0.0)).rgb);
    vec3 b = rgb2yiq(texture2D(tScene, vUv - vec2(2.0 * dx, 0.0)).rgb);
    yiq.yz = mix(yiq.yz, (a.yz + b.yz) * 0.5, 0.75);
    c = yiq2rgb(yiq);
  }
  c *= exp2(uExposure);
  if (uTonemap > 0.5) c = filmic(c);
  c = toSrgb(c);
  if (uHasLut > 0.5) {
    vec3 at = c * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
    c = mix(c, texture(tLut, at).rgb, uLutStrength);
  }
  vec2 srcPx = vUv * uSrcRes;
  if (uVignette > 0.0) {
    float d = length((vUv - 0.5) * vec2(1.0, 0.85)) * 1.4;
    c *= 1.0 - uVignette * smoothstep(0.35, 1.0, d);
  }
  if (uGrain > 0.0) {
    c += (hash(srcPx + fract(uTime) * 91.7) - 0.5) * 0.14 * uGrain;
  }
  if (uInterlace > 0.5 && mod(floor(srcPx.y), 2.0) < 1.0) {
    c *= 0.86;
  }
  if (uDither > 0.5) {
    vec3 levels = vec3(31.0, 63.0, 31.0);
    c = floor(clamp(c, 0.0, 1.0) * levels + bayer4(srcPx)) / levels;
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
`;

const BLOOM_LEVELS = 5;

export class PostPass {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private bloomDown: THREE.WebGLRenderTarget[] = [];
  private bloomUp: THREE.WebGLRenderTarget[] = [];
  private readonly blackBloom: THREE.DataTexture;
  private lutTexture: THREE.Data3DTexture | null = null;
  private lut: Lut3D | null = null;
  grade: LookGrade = NEUTRAL_GRADE;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      samples: 0,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.target.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
    this.blackBloom = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blackBloom.needsUpdate = true;
    const emptyLut = new THREE.Data3DTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, 1);
    emptyLut.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: finalFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        tBloom: { value: this.blackBloom },
        tDepth: { value: this.target.depthTexture },
        tLut: { value: emptyLut },
        uSrcRes: { value: new THREE.Vector2(4, 4) },
        uTime: { value: 0 },
        uExposure: { value: 0 },
        uTonemap: { value: 0 },
        uBloom: { value: 0 },
        uHasLut: { value: 0 },
        uLutSize: { value: 2 },
        uLutStrength: { value: 1 },
        uChromatic: { value: 0 },
        uDither: { value: 0 },
        uGrain: { value: 0 },
        uVhs: { value: 0 },
        uInterlace: { value: 0 },
        uVignette: { value: 0 },
        uDof: { value: 0 },
        uFocus: { value: 1 },
        uAperture: { value: 0.5 },
        uClip: { value: new THREE.Vector2(0.02, 60) },
      },
    });
    const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader, depthTest: false, depthWrite: false, uniforms });
    this.down = pass(downFragment, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uPrefilter: { value: 0 } });
    this.up = pass(upFragment, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.5 } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** The look's LUT (null: none). The texture is rebuilt only when the LUT changes. */
  setLut(lut: Lut3D | null): void {
    if (lut === this.lut) return;
    this.lut = lut;
    this.lutTexture?.dispose();
    this.lutTexture = null;
    if (lut) {
      const rgba = new Uint8Array(lut.size ** 3 * 4);
      for (let i = 0; i < lut.size ** 3; i++) {
        rgba[i * 4] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3]!)) * 255);
        rgba[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3 + 1]!)) * 255);
        rgba[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3 + 2]!)) * 255);
        rgba[i * 4 + 3] = 255;
      }
      const tex = new THREE.Data3DTexture(rgba, lut.size, lut.size, lut.size);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapR = tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      this.lutTexture = tex;
      this.material.uniforms.tLut!.value = tex;
    }
  }

  /** Size of the offscreen render for the given output size. */
  resize(outWidth: number, outHeight: number, settings: PostSettings): void {
    const w = settings.lowRes ? 640 : outWidth;
    const h = settings.lowRes ? 448 : outHeight;
    if (this.target.width !== w || this.target.height !== h) {
      this.target.setSize(w, h);
      for (const t of [...this.bloomDown, ...this.bloomUp]) t.dispose();
      this.bloomDown = [];
      this.bloomUp = [];
    }
    (this.material.uniforms.uSrcRes!.value as THREE.Vector2).set(w, h);
  }

  apply(settings: PostSettings, time: number, camera: THREE.Camera): void {
    const u = this.material.uniforms;
    const g = this.grade;
    u.uTime!.value = time;
    u.uExposure!.value = g.exposure;
    u.uTonemap!.value = g.tonemap === 'filmic' ? 1 : 0;
    u.uBloom!.value = g.bloom.strength;
    u.uHasLut!.value = this.lutTexture ? 1 : 0;
    u.uLutSize!.value = this.lut?.size ?? 2;
    u.uLutStrength!.value = g.lutStrength;
    u.uChromatic!.value = g.chromatic;
    u.uDither!.value = settings.dither16 ? 1 : 0;
    u.uGrain!.value = Math.max(settings.grain, g.grain);
    u.uVhs!.value = settings.vhs;
    u.uInterlace!.value = settings.interlace ? 1 : 0;
    u.uVignette!.value = Math.max(settings.vignette, g.vignette);
    u.uDof!.value = settings.dof.enabled ? 1 : 0;
    u.uAperture!.value = settings.dof.aperture;
    u.uFocus!.value = settings.dof.focus;
    if (camera instanceof THREE.PerspectiveCamera) (u.uClip!.value as THREE.Vector2).set(camera.near, camera.far);
  }

  /** Bloom chain from the scene target (half resolution down to 1/32). */
  private renderBloom(renderer: THREE.WebGLRenderer): void {
    const g = this.grade.bloom;
    if (g.strength <= 0) {
      this.material.uniforms.tBloom!.value = this.blackBloom;
      return;
    }
    if (this.bloomDown.length === 0) {
      let w = this.target.width;
      let h = this.target.height;
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
        const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
        this.bloomDown.push(new THREE.WebGLRenderTarget(w, h, opts));
        this.bloomUp.push(new THREE.WebGLRenderTarget(w, h, opts));
      }
    }
    let src: THREE.Texture = this.target.texture;
    let sw = this.target.width;
    let sh = this.target.height;
    this.quad.material = this.down;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.down.uniforms.tSrc!.value = src;
      (this.down.uniforms.uTexel!.value as THREE.Vector2).set(0.5 / sw, 0.5 / sh);
      this.down.uniforms.uThreshold!.value = g.threshold;
      this.down.uniforms.uPrefilter!.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(this.bloomDown[i]!);
      renderer.render(this.scene, this.camera);
      src = this.bloomDown[i]!.texture;
      sw = this.bloomDown[i]!.width;
      sh = this.bloomDown[i]!.height;
    }
    this.quad.material = this.up;
    let up: THREE.Texture = this.bloomDown[BLOOM_LEVELS - 1]!.texture;
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const small = this.bloomDown[i + 1]!;
      this.up.uniforms.tSrc!.value = up;
      this.up.uniforms.tBase!.value = this.bloomDown[i]!.texture;
      (this.up.uniforms.uTexel!.value as THREE.Vector2).set(1 / small.width, 1 / small.height);
      this.up.uniforms.uRadius!.value = g.radius;
      renderer.setRenderTarget(this.bloomUp[i]!);
      renderer.render(this.scene, this.camera);
      up = this.bloomUp[i]!.texture;
    }
    this.quad.material = this.material;
    this.material.uniforms.tBloom!.value = up;
  }

  render(renderer: THREE.WebGLRenderer, output: THREE.WebGLRenderTarget | null): void {
    this.renderBloom(renderer);
    renderer.setRenderTarget(output);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    for (const t of [...this.bloomDown, ...this.bloomUp]) t.dispose();
    this.blackBloom.dispose();
    this.lutTexture?.dispose();
    this.material.dispose();
    this.down.dispose();
    this.up.dispose();
  }
}
