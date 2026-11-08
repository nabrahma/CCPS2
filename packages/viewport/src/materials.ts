/**
 * PS2-style materials. Lighting is evaluated per vertex (Gouraud) with an
 * ambient term, one key light, an optional camera spot (flashlight) and a
 * rim term: the same model the Unity PS2/Skin shader uses (PRD 6.4), so
 * what you see is what Unity gets. Lighting happens in linear space; the
 * post pass converts to sRGB.
 */
import * as THREE from 'three';
import type { LightingPreset, ShadingMode } from './presets';

const vertexShader = /* glsl */ `
uniform vec3 uAmbient;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform float uUseKey;
uniform vec3 uSpotPos;
uniform vec3 uSpotDir;
uniform vec3 uSpotColor;
uniform float uSpotCosOuter;
uniform float uSpotCosInner;
uniform float uSpotRange;
uniform float uUseSpot;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uTwoSided;
uniform float uAffine;
uniform float uSnap;
uniform vec2 uSnapRes;

attribute float layer;

varying vec2 vUv;
varying vec3 vLight;
varying float vAffineW;
varying float vLayer;

float lambert(vec3 n, vec3 l) {
  float d = dot(n, l);
  return uTwoSided > 0.5 ? abs(d) : max(d, 0.0);
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 light = uAmbient;
  light += uUseKey * uKeyColor * lambert(n, normalize(uKeyDir));
  vec3 toLight = uSpotPos - world.xyz;
  float dist = max(length(toLight), 1e-4);
  vec3 ld = toLight / dist;
  float cone = smoothstep(uSpotCosOuter, uSpotCosInner, dot(-ld, normalize(uSpotDir)));
  float att = clamp(1.0 - dist / uSpotRange, 0.0, 1.0);
  light += uUseSpot * uSpotColor * lambert(n, ld) * cone * att * att;
  vec3 view = normalize(cameraPosition - world.xyz);
  float rim = pow(1.0 - clamp(abs(dot(n, view)), 0.0, 1.0), 3.0);
  light += uRimColor * uRimStrength * rim;
  vLight = light;
  vLayer = layer;

  vec4 clip = projectionMatrix * viewMatrix * world;
  if (uSnap > 0.5) {
    // PS1-style vertex snapping (off by default).
    clip.xy = floor(clip.xy / clip.w * uSnapRes * 0.5 + 0.5) / (uSnapRes * 0.5) * clip.w;
  }
  vAffineW = uAffine > 0.5 ? clip.w : 1.0;
  vUv = uv * vAffineW;
  gl_Position = clip;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uMapRaw; // 1: uMap holds sRGB-encoded values in a plain texture (composited skin)
uniform vec3 uTint;
uniform float uBrightness;
uniform float uAlphaTest;
uniform float uMode; // 0 PS2 lit, 1 unlit, 2 clay, 3 UV checker
uniform float uDirt;
uniform float uDitherOuter;

varying vec2 vUv;
varying vec3 vLight;
varying float vAffineW;
varying float vLayer;

// 4x4 ordered-dither threshold in (0, 1).
float bayer4(vec2 p) {
  vec2 c = mod(floor(p), 4.0);
  float i = c.x + c.y * 4.0;
  float m = mod(i, 2.0) * 8.0 + mod(floor(i / 2.0), 2.0) * 4.0 + mod(floor(i / 4.0), 2.0) * 2.0 + floor(i / 8.0);
  return (m + 0.5) / 16.0;
}

// Exact sRGB decode, the same curve the GPU applies to sRGB textures.
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void main() {
  vec2 uv = vUv / vAffineW;
  vec4 tex = uHasMap > 0.5 ? texture2D(uMap, uv) : vec4(1.0);
  if (uMapRaw > 0.5) tex.rgb = srgbToLinear(tex.rgb);
  // Card hair (PRD F5): the outer layer can use dithered transparency instead of a hard cutout.
  float threshold = uDitherOuter > 0.5 && vLayer > 0.75 ? mix(0.1, 0.95, bayer4(gl_FragCoord.xy)) : uAlphaTest;
  if (tex.a < threshold) discard;
  vec3 base = tex.rgb * uTint * uBrightness;
  if (uDirt > 0.0) {
    // Cheap procedural grime until the user paints a dirt mask (PRD F4 dirt layer).
    float n = fract(sin(dot(floor(uv * 96.0), vec2(12.9898, 78.233))) * 43758.5453);
    base *= mix(vec3(1.0), vec3(0.55, 0.48, 0.4), uDirt * (0.55 + 0.45 * n));
  }
  if (uMode > 2.5) {
    vec2 c = floor(uv * 16.0);
    float k = mod(c.x + c.y, 2.0);
    base = mix(vec3(0.15), vec3(0.9), k) * vec3(uv, 1.0 - uv.x * 0.5);
  } else if (uMode > 1.5) {
    base = vec3(0.7);
  }
  vec3 color = uMode > 0.5 && uMode < 1.5 ? base : base * vLight;
  gl_FragColor = vec4(color, 1.0);
}
`;

export interface Ps2MaterialOptions {
  map: THREE.Texture | null;
  tint: [number, number, number];
  brightness: number;
  alphaTest: number;
  doubleSided: boolean;
  dirt: number;
}

export function createPs2Material(opts: Ps2MaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: {
      uMap: { value: opts.map },
      uHasMap: { value: opts.map ? 1 : 0 },
      uMapRaw: { value: 0 },
      uTint: { value: new THREE.Color(...opts.tint) },
      uBrightness: { value: opts.brightness },
      uAlphaTest: { value: opts.alphaTest },
      uMode: { value: 0 },
      uDirt: { value: opts.dirt },
      uDitherOuter: { value: 0 },
      uTwoSided: { value: opts.doubleSided ? 1 : 0 },
      uAmbient: { value: new THREE.Vector3() },
      uKeyDir: { value: new THREE.Vector3(0, 1, 1) },
      uKeyColor: { value: new THREE.Vector3() },
      uUseKey: { value: 0 },
      uSpotPos: { value: new THREE.Vector3() },
      uSpotDir: { value: new THREE.Vector3(0, 0, -1) },
      uSpotColor: { value: new THREE.Vector3() },
      uSpotCosOuter: { value: 0.9 },
      uSpotCosInner: { value: 0.95 },
      uSpotRange: { value: 10 },
      uUseSpot: { value: 0 },
      uRimColor: { value: new THREE.Vector3() },
      uRimStrength: { value: 0 },
      uAffine: { value: 0 },
      uSnap: { value: 0 },
      uSnapRes: { value: new THREE.Vector2(320, 224) },
    },
  });
}

export function setMaterialTexture(mat: THREE.ShaderMaterial, map: THREE.Texture | null): void {
  mat.uniforms.uMap!.value = map;
  mat.uniforms.uHasMap!.value = map ? 1 : 0;
}

const MODE: Record<ShadingMode, number> = { ps2: 0, unlit: 1, clay: 2, wire: 0, uv: 3 };

export interface LightState {
  preset: LightingPreset;
  cameraPosition: THREE.Vector3;
  cameraDirection: THREE.Vector3;
}

/** Push lighting, mode and PS1 toggles into a material. */
export function applyLighting(
  mat: THREE.ShaderMaterial,
  light: LightState,
  mode: ShadingMode,
  ps1: { affine: boolean; snap: boolean },
): void {
  const u = mat.uniforms;
  const p = light.preset;
  u.uMode!.value = MODE[mode];
  (u.uAmbient!.value as THREE.Vector3).set(...p.ambient);
  u.uUseKey!.value = p.key ? 1 : 0;
  if (p.key) {
    (u.uKeyDir!.value as THREE.Vector3).set(...p.key.direction);
    (u.uKeyColor!.value as THREE.Vector3).set(...p.key.color);
  }
  u.uUseSpot!.value = p.spot ? 1 : 0;
  if (p.spot) {
    (u.uSpotPos!.value as THREE.Vector3).copy(light.cameraPosition);
    (u.uSpotDir!.value as THREE.Vector3).copy(light.cameraDirection);
    (u.uSpotColor!.value as THREE.Vector3).set(...p.spot.color);
    u.uSpotCosOuter!.value = p.spot.cosOuter;
    u.uSpotCosInner!.value = p.spot.cosInner;
    u.uSpotRange!.value = p.spot.range;
  }
  (u.uRimColor!.value as THREE.Vector3).set(...p.rim.color);
  u.uRimStrength!.value = p.rim.strength;
  u.uAffine!.value = ps1.affine ? 1 : 0;
  u.uSnap!.value = ps1.snap ? 1 : 0;
}
