/**
 * Post stack (PRD F9): optional 640x448 internal resolution, 16-bit colour
 * with ordered dither, film grain, VHS chroma bleed, interlace lines and a
 * vignette. The scene is always rendered linear into an offscreen target;
 * this pass converts to sRGB and applies the effects.
 */
import * as THREE from 'three';
import type { PostSettings } from './presets';

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uSrcRes;
uniform float uTime;
uniform float uDither;
uniform float uGrain;
uniform float uVhs;
uniform float uInterlace;
uniform float uVignette;
varying vec2 vUv;

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
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

void main() {
  vec4 src = texture2D(tScene, vUv);
  vec3 c = src.rgb;
  if (uVhs > 0.0) {
    float dx = uVhs * 2.5 / uSrcRes.x;
    vec3 yiq = rgb2yiq(c);
    vec3 a = rgb2yiq(texture2D(tScene, vUv - vec2(dx, 0.0)).rgb);
    vec3 b = rgb2yiq(texture2D(tScene, vUv - vec2(2.0 * dx, 0.0)).rgb);
    yiq.yz = mix(yiq.yz, (a.yz + b.yz) * 0.5, 0.75);
    c = yiq2rgb(yiq);
  }
  c = toSrgb(c);
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

export class PostPass {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      samples: 0,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uSrcRes: { value: new THREE.Vector2(4, 4) },
        uTime: { value: 0 },
        uDither: { value: 0 },
        uGrain: { value: 0 },
        uVhs: { value: 0 },
        uInterlace: { value: 0 },
        uVignette: { value: 0 },
      },
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /** Size of the offscreen render for the given output size. */
  resize(outWidth: number, outHeight: number, settings: PostSettings): void {
    const w = settings.lowRes ? 640 : outWidth;
    const h = settings.lowRes ? 448 : outHeight;
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    (this.material.uniforms.uSrcRes!.value as THREE.Vector2).set(w, h);
  }

  apply(settings: PostSettings, time: number): void {
    const u = this.material.uniforms;
    u.uTime!.value = time;
    u.uDither!.value = settings.dither16 ? 1 : 0;
    u.uGrain!.value = settings.grain;
    u.uVhs!.value = settings.vhs;
    u.uInterlace!.value = settings.interlace ? 1 : 0;
    u.uVignette!.value = settings.vignette;
  }

  render(renderer: THREE.WebGLRenderer, output: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(output);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
