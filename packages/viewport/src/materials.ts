/**
 * PS2-style materials (PRD F9; Part 2 F14). One shader, two lighting models:
 *
 * - Per vertex (Classic, and every Part 1 look): hemisphere ambient, key,
 *   fill, camera flashlight and a fresnel rim, Lambert, summed at the vertices
 *   and interpolated (Gouraud). With a flat ambient and no fill this is exactly
 *   Part 1's model.
 * - Per pixel (Enhanced, Hero): the same lights per fragment, wrap diffuse on
 *   skin with a warm tint where light turns into shadow, a small Blinn-Phong
 *   highlight from the material's gloss (an anisotropic strand highlight on
 *   hair), shadow maps for the key light and the flashlight, and the baked
 *   occlusion maps (F16).
 *
 * The Unity package's PS2 shaders implement the same model (PS2Common.hlsl),
 * so what you see is what Unity gets. Lighting happens in linear space; the
 * post pass tone-maps, grades and converts to sRGB.
 */
import * as THREE from 'three';
import type { Look } from '@ps2cc/core';
import type { ShadingMode } from './presets';

/** Shared by the vertex and fragment stages. */
const lightChunk = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform float uUseKey;
uniform vec3 uFillDir;
uniform vec3 uFillColor;
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
uniform float uWrap;
uniform vec3 uScatter;

float facing(vec3 n, vec3 l) {
  float d = dot(n, l);
  return uTwoSided > 0.5 ? abs(d) : d;
}

// Lambert; with wrap (skin) the light reaches past the terminator, tinted warm there.
vec3 diffuseTerm(vec3 n, vec3 l, float wrap) {
  float d = facing(n, l);
  float lam = max(d, 0.0);
  if (wrap <= 0.0) return vec3(lam);
  float w = max((d + wrap) / (1.0 + wrap), 0.0);
  return vec3(lam) + uScatter * max(w - lam, 0.0);
}

vec3 hemisphere(vec3 n) {
  return mix(uGround, uSky, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
}

// Cone and range falloff of the flashlight; ld is the direction to it.
float spotFalloff(vec3 world, out vec3 ld) {
  vec3 toLight = uSpotPos - world;
  float dist = max(length(toLight), 1e-4);
  ld = toLight / dist;
  float cone = smoothstep(uSpotCosOuter, uSpotCosInner, dot(-ld, normalize(uSpotDir)));
  float att = clamp(1.0 - dist / uSpotRange, 0.0, 1.0);
  return cone * att * att;
}

// base: ambient, fill and rim; key and spot: their diffuse light, before shadows.
void lightAt(vec3 world, vec3 n, vec3 view, float wrap, out vec3 base, out vec3 key, out vec3 spot) {
  base = hemisphere(n);
  base += uFillColor * diffuseTerm(n, normalize(uFillDir), 0.0);
  float rim = pow(1.0 - clamp(abs(dot(n, view)), 0.0, 1.0), 3.0);
  base += uRimColor * uRimStrength * rim;
  key = uUseKey * uKeyColor * diffuseTerm(n, normalize(uKeyDir), wrap);
  vec3 ld;
  float f = spotFalloff(world, ld);
  spot = uUseSpot * uSpotColor * diffuseTerm(n, ld, wrap) * f;
}
`;

const vertexShader = /* glsl */ `
${lightChunk}
uniform float uPerPixel;
uniform float uAffine;
uniform float uSnap;
uniform vec2 uSnapRes;

attribute float layer;
attribute float headRegion;
attribute float hairLayer;

varying vec2 vUv;
varying vec3 vBase;
varying vec3 vKey;
varying vec3 vSpot;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAffineW;
varying float vLayer;
varying float vHead;
varying float vHairLayer;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vWorld = world.xyz;
  vNormal = n;
  if (uPerPixel < 0.5) {
    vec3 view = normalize(cameraPosition - world.xyz);
    lightAt(world.xyz, n, view, 0.0, vBase, vKey, vSpot);
  } else {
    vBase = vec3(0.0);
    vKey = vec3(0.0);
    vSpot = vec3(0.0);
  }
  vLayer = layer;
  vHead = headRegion;
  vHairLayer = hairLayer;

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
${lightChunk}
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uMapRaw; // 1: uMap holds sRGB-encoded values in a plain texture (composited skin)
uniform vec3 uTint;
uniform float uBrightness;
uniform float uAlphaTest;
uniform float uMode; // 0 PS2 lit, 1 unlit, 2 clay, 3 UV checker, 4 ID (flat uIdColor)
uniform vec3 uIdColor;
// Hair v2 two-pass alpha (F14, F15): the opaque pass keeps texels >= uAlphaTest; the soft pass
// (uSoft 1) draws the ones below uAlphaMax, blended, without writing depth.
uniform float uSoft;
uniform float uAlphaMax;
// Hair Studio's layer view: shell, locks, detail cards (1 shown, 0 hidden).
uniform vec3 uLayerMask;
uniform float uDirt;
uniform float uDitherOuter;
uniform vec2 uExportTexels; // texels across the map after export: x most of the part, y its head texture; 0 = no limit
uniform float uPerPixel;
uniform float uGloss;
uniform float uShininess;
uniform float uAniso;
// Baked maps (F16): r occlusion, g cavity, b thickness, a light occlusion (sky and key).
uniform sampler2D uBake;
uniform float uHasBake;
uniform float uAoStrength;
uniform float uCavityStrength;
uniform float uLightBake;
uniform float uTranslucency;
// Shadow maps (window-space depth) and the matrices that take world space to their clip space.
uniform sampler2D uKeyShadow;
uniform mat4 uKeyShadowMatrix;
uniform float uKeyShadowOn;
uniform sampler2D uSpotShadow;
uniform mat4 uSpotShadowMatrix;
uniform float uSpotShadowOn;
uniform vec2 uShadowTexel;
uniform vec3 uFogColor;
uniform vec2 uFogRange; // near, far; far <= near: no fog

varying vec2 vUv;
varying vec3 vBase;
varying vec3 vKey;
varying vec3 vSpot;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAffineW;
varying float vLayer;
varying float vHead;
varying float vHairLayer;

// Read the map no sharper than the export (PRD F9). The mip chain stands in for the
// exported size; when the camera is far enough away, normal mip selection wins.
vec4 sampleMap(vec2 uv) {
  // On the head (vHead: head-texture units per hm08 UV unit, F19), the head texture's density there.
  float limit = vHead > 0.0 ? uExportTexels.y * vHead : uExportTexels.x;
  vec2 size = vec2(textureSize(uMap, 0));
  float side = max(size.x, size.y);
  if (limit <= 0.0 || limit >= side) return texture2D(uMap, uv);
  vec2 dx = dFdx(uv * size);
  vec2 dy = dFdy(uv * size);
  float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
  return textureLod(uMap, uv, max(lod, log2(side / limit)));
}

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

// 5x5 percentage-closer filter; 1 lit, 0 in shadow.
float shadowOf(sampler2D map, mat4 m, vec3 world, vec3 n, vec3 l) {
  float slope = 1.0 - clamp(abs(dot(n, l)), 0.0, 1.0);
  vec4 c = m * vec4(world + n * (0.004 + 0.01 * slope), 1.0);
  vec3 p = c.xyz / c.w * 0.5 + 0.5;
  if (c.w <= 0.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float bias = 0.0015 + 0.004 * slope;
  float lit = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      float d = texture2D(map, p.xy + vec2(float(x), float(y)) * uShadowTexel).r;
      lit += step(p.z - bias, d);
    }
  }
  return lit / 25.0;
}

void main() {
  vec2 uv = vUv / vAffineW;
  vec4 tex = uHasMap > 0.5 ? sampleMap(uv) : vec4(1.0);
  if (uMapRaw > 0.5) tex.rgb = srgbToLinear(tex.rgb);
  // Card hair (PRD F5): the outer layer can use dithered transparency instead of a hard cutout.
  float threshold = uDitherOuter > 0.5 && vLayer > 0.75 ? mix(0.1, 0.95, bayer4(gl_FragCoord.xy)) : uAlphaTest;
  if (tex.a < threshold) discard;
  if (tex.a >= uAlphaMax) discard;
  float hl = floor(vHairLayer + 0.5);
  if ((hl < 0.5 && uLayerMask.x < 0.5) || (hl > 0.5 && hl < 1.5 && uLayerMask.y < 0.5) || (hl > 1.5 && uLayerMask.z < 0.5)) discard;
  if (uMode > 3.5) {
    gl_FragColor = vec4(uIdColor, 1.0);
    return;
  }
  float outAlpha = uSoft > 0.5 ? tex.a : 1.0;
  vec3 base = tex.rgb * uTint * uBrightness;
  if (uDirt > 0.0) {
    // Cheap procedural grime until the user paints a dirt mask (PRD F4 dirt layer).
    float nz = fract(sin(dot(floor(uv * 96.0), vec2(12.9898, 78.233))) * 43758.5453);
    base *= mix(vec3(1.0), vec3(0.55, 0.48, 0.4), uDirt * (0.55 + 0.45 * nz));
  }
  float thickness = 1.0;
  if (uHasBake > 0.5) {
    vec4 bake = texture2D(uBake, uv);
    base *= mix(1.0, bake.r, uAoStrength);
    base *= 1.0 - uCavityStrength * (1.0 - bake.g);
    base *= mix(1.0, bake.a, uLightBake);
    thickness = bake.b;
  }
  if (uMode > 2.5) {
    vec2 c = floor(uv * 16.0);
    float k = mod(c.x + c.y, 2.0);
    base = mix(vec3(0.15), vec3(0.9), k) * vec3(uv, 1.0 - uv.x * 0.5);
  } else if (uMode > 1.5) {
    base = vec3(0.7);
  }
  if (uMode > 0.5 && uMode < 1.5) {
    gl_FragColor = vec4(base, outAlpha);
    return;
  }

  vec3 n = normalize(vNormal);
  vec3 view = normalize(cameraPosition - vWorld);
  vec3 lBase = vBase;
  vec3 lKey = vKey;
  vec3 lSpot = vSpot;
  if (uPerPixel > 0.5) lightAt(vWorld, n, view, uWrap, lBase, lKey, lSpot);
  vec3 keyL = normalize(uKeyDir);
  vec3 spotL;
  float spotF = spotFalloff(vWorld, spotL);
  float sKey = uKeyShadowOn > 0.5 ? shadowOf(uKeyShadow, uKeyShadowMatrix, vWorld, n, keyL) : 1.0;
  float sSpot = uSpotShadowOn > 0.5 ? shadowOf(uSpotShadow, uSpotShadowMatrix, vWorld, n, spotL) : 1.0;
  vec3 light = lBase + lKey * sKey + lSpot * sSpot;
  vec3 color = base * light;
  if (uPerPixel > 0.5) {
    // Thin parts (ears, nostrils) glow when lit from behind.
    if (uTranslucency > 0.0) {
      float back = uUseKey * max(-dot(n, keyL), 0.0) * sKey;
      color += base * uScatter * uKeyColor * back * (1.0 - thickness) * uTranslucency;
    }
    if (uGloss > 0.0) {
      vec3 t = vec3(0.0);
      if (uAniso > 0.5) {
        // Strand direction: where v (root to tip along the card) runs on screen, back in world space.
        vec3 dpx = dFdx(vWorld);
        vec3 dpy = dFdy(vWorld);
        vec2 duvx = dFdx(uv);
        vec2 duvy = dFdy(uv);
        float det = duvx.x * duvy.y - duvx.y * duvy.x;
        t = normalize((dpy * duvx.x - dpx * duvy.x) * sign(det) + 1e-6);
      }
      vec3 spec = vec3(0.0);
      for (int i = 0; i < 2; i++) {
        vec3 l = i == 0 ? keyL : spotL;
        vec3 c = i == 0 ? uUseKey * uKeyColor * sKey : uUseSpot * uSpotColor * spotF * sSpot;
        if (facing(n, l) <= 0.0) continue;
        vec3 h = normalize(l + view);
        float s;
        if (uAniso > 0.5) {
          float th = dot(t, h);
          s = pow(sqrt(max(0.0, 1.0 - th * th)), uShininess);
        } else {
          s = pow(max(abs(dot(n, h)), 0.0), uShininess);
        }
        spec += c * s;
      }
      // Hair highlights take the hair's colour (Kajiya-Kay's secondary band); skin and eyes stay white.
      vec3 tintS = uAniso > 0.5 ? mix(vec3(1.0), base / max(max(base.r, base.g), max(base.b, 1e-3)), 0.7) : vec3(1.0);
      // Dark hair keeps a soft sheen: the strand highlight scales with the hair's lightness (M12, D-112).
      float hairK = uAniso > 0.5 ? 0.25 + 0.75 * min(1.0, dot(base, vec3(0.2126, 0.7152, 0.0722)) / 0.35) : 1.0;
      color += spec * uGloss * tintS * hairK;
    }
  }
  if (uFogRange.y > uFogRange.x) {
    float f = clamp((length(cameraPosition - vWorld) - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
    color = mix(color, uFogColor, f);
  }
  gl_FragColor = vec4(color, outAlpha);
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
      uAlphaMax: { value: 2 },
      uSoft: { value: 0 },
      uLayerMask: { value: new THREE.Vector3(1, 1, 1) },
      uIdColor: { value: new THREE.Vector3() },
      uMode: { value: 0 },
      uDirt: { value: opts.dirt },
      uDitherOuter: { value: 0 },
      uExportTexels: { value: new THREE.Vector2(0, 0) },
      uTwoSided: { value: opts.doubleSided ? 1 : 0 },
      uPerPixel: { value: 0 },
      uSky: { value: new THREE.Vector3() },
      uGround: { value: new THREE.Vector3() },
      uKeyDir: { value: new THREE.Vector3(0, 1, 1) },
      uKeyColor: { value: new THREE.Vector3() },
      uUseKey: { value: 0 },
      uFillDir: { value: new THREE.Vector3(1, 0, 1) },
      uFillColor: { value: new THREE.Vector3() },
      uSpotPos: { value: new THREE.Vector3() },
      uSpotDir: { value: new THREE.Vector3(0, 0, -1) },
      uSpotColor: { value: new THREE.Vector3() },
      uSpotCosOuter: { value: 0.9 },
      uSpotCosInner: { value: 0.95 },
      uSpotRange: { value: 10 },
      uUseSpot: { value: 0 },
      uRimColor: { value: new THREE.Vector3() },
      uRimStrength: { value: 0 },
      uWrap: { value: 0 },
      uScatter: { value: new THREE.Vector3(1.0, 0.42, 0.3) },
      uGloss: { value: 0 },
      uShininess: { value: 24 },
      uAniso: { value: 0 },
      uBake: { value: null },
      uHasBake: { value: 0 },
      uAoStrength: { value: 0 },
      uCavityStrength: { value: 0 },
      uLightBake: { value: 0 },
      uTranslucency: { value: 0 },
      uKeyShadow: { value: null },
      uKeyShadowMatrix: { value: new THREE.Matrix4() },
      uKeyShadowOn: { value: 0 },
      uSpotShadow: { value: null },
      uSpotShadowMatrix: { value: new THREE.Matrix4() },
      uSpotShadowOn: { value: 0 },
      uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
      uFogColor: { value: new THREE.Vector3() },
      uFogRange: { value: new THREE.Vector2(0, 0) },
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

/** What a part is made of, for the per-pixel model (wrap, gloss). */
export type SurfaceKind = 'skin' | 'cloth' | 'hair' | 'eyes';

/**
 * Per-surface constants of the per-pixel model. Gloss is small on purpose: the
 * era used specular sparingly (F14). PS2Common.hlsl has the same table.
 */
export const SURFACES: Record<SurfaceKind, { wrap: number; gloss: number; shininess: number; aniso: boolean; translucency: number }> = {
  skin: { wrap: 0.45, gloss: 0.06, shininess: 18, aniso: false, translucency: 0.6 },
  cloth: { wrap: 0, gloss: 0.02, shininess: 10, aniso: false, translucency: 0 },
  hair: { wrap: 0.2, gloss: 0.08, shininess: 80, aniso: true, translucency: 0 },
  eyes: { wrap: 0, gloss: 0.7, shininess: 90, aniso: false, translucency: 0 },
};

export interface LightState {
  look: Look;
  cameraPosition: THREE.Vector3;
  cameraDirection: THREE.Vector3;
  /** What the camera looks at: the flashlight aims there from its offset position. */
  cameraTarget: THREE.Vector3;
  /** Camera-space axes, for the flashlight offset. */
  cameraRight: THREE.Vector3;
  cameraUp: THREE.Vector3;
  perPixel: boolean;
}

/** Where the flashlight points: from its position at what the camera looks at. */
export function spotDirection(light: LightState, out = new THREE.Vector3()): THREE.Vector3 {
  const from = spotPosition(light);
  out.copy(light.cameraTarget).sub(from);
  return out.lengthSq() > 1e-8 ? out.normalize() : out.copy(light.cameraDirection);
}

/** Where the flashlight is: the camera, moved by the look's offset in camera space. */
export function spotPosition(light: LightState, out = new THREE.Vector3()): THREE.Vector3 {
  const o = light.look.lights.spot?.offset ?? [0, 0, 0];
  const back = light.cameraDirection.clone().multiplyScalar(-1);
  return out
    .copy(light.cameraPosition)
    .addScaledVector(light.cameraRight, o[0])
    .addScaledVector(light.cameraUp, o[1])
    .addScaledVector(back, o[2]);
}

/** Push lighting, mode and PS1 toggles into a material. */
export function applyLighting(
  mat: THREE.ShaderMaterial,
  light: LightState,
  mode: ShadingMode,
  ps1: { affine: boolean; snap: boolean },
  surface: SurfaceKind,
): void {
  const u = mat.uniforms;
  const l = light.look.lights;
  u.uMode!.value = MODE[mode];
  u.uPerPixel!.value = light.perPixel ? 1 : 0;
  (u.uSky!.value as THREE.Vector3).set(...l.sky);
  (u.uGround!.value as THREE.Vector3).set(...l.ground);
  u.uUseKey!.value = l.key ? 1 : 0;
  if (l.key) {
    (u.uKeyDir!.value as THREE.Vector3).set(...l.key.direction);
    (u.uKeyColor!.value as THREE.Vector3).set(...l.key.color);
  }
  if (l.fill) {
    (u.uFillDir!.value as THREE.Vector3).set(...l.fill.direction);
    (u.uFillColor!.value as THREE.Vector3).set(...l.fill.color);
  } else {
    (u.uFillColor!.value as THREE.Vector3).set(0, 0, 0);
  }
  u.uUseSpot!.value = l.spot ? 1 : 0;
  if (l.spot) {
    spotPosition(light, u.uSpotPos!.value as THREE.Vector3);
    spotDirection(light, u.uSpotDir!.value as THREE.Vector3);
    (u.uSpotColor!.value as THREE.Vector3).set(...l.spot.color);
    u.uSpotCosOuter!.value = l.spot.cosOuter;
    u.uSpotCosInner!.value = l.spot.cosInner;
    u.uSpotRange!.value = l.spot.range;
  }
  (u.uRimColor!.value as THREE.Vector3).set(...l.rim.color);
  u.uRimStrength!.value = l.rim.strength;
  const fog = light.look.fog;
  (u.uFogColor!.value as THREE.Vector3).set(...(fog?.color ?? [0, 0, 0]));
  (u.uFogRange!.value as THREE.Vector2).set(fog?.near ?? 0, fog?.far ?? 0);
  const s = SURFACES[surface];
  u.uWrap!.value = s.wrap;
  u.uGloss!.value = s.gloss;
  u.uShininess!.value = s.shininess;
  u.uAniso!.value = s.aniso ? 1 : 0;
  u.uTranslucency!.value = s.translucency;
  u.uAffine!.value = ps1.affine ? 1 : 0;
  u.uSnap!.value = ps1.snap ? 1 : 0;
}
