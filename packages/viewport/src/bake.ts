/**
 * GPU bake engine (PRD Part 2, F16). For each target (the body, each garment):
 *
 * 1. Rasterise the target in UV space into a G-buffer: position, normal and
 *    cavity per texel.
 * 2. Trace rays per texel against the whole character, packed into float
 *    textures (core packBvh: PS2CC's own hierarchy, traversed in the shader),
 *    in batches so the app stays responsive and the bake can be cancelled.
 * 3. Resolve: occlusion, thickness, key visibility to light occlusion; a
 *    seam-aware denoise (only texels close in 3D are averaged, so nothing
 *    crosses a UV seam); then dilation into the gutters, so bilinear filtering
 *    and mipmaps never pick up background texels.
 *
 * Output per target: RGBA8, r occlusion, g cavity, b thickness, a light
 * occlusion; 1 means "no darkening". The tracing matches the CPU reference
 * in @ps2cc/core (bake/bake.ts) ray for ray.
 */
import * as THREE from 'three';
import { BAKE_LIGHT, packBvh, type BakeInputs, type BakeSettings, type BakeTarget, type RgbaImage } from '@ps2cc/core';

const traceChunk = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uNodes;
uniform sampler2D uTris;
uniform int uWidth;

vec4 nodeTexel(int i) { return texelFetch(uNodes, ivec2(i % uWidth, i / uWidth), 0); }
vec4 triTexel(int i) { return texelFetch(uTris, ivec2(i % uWidth, i / uWidth), 0); }

bool rayBox(vec3 lo, vec3 hi, vec3 o, vec3 inv, float t0, float t1) {
  vec3 a = (lo - o) * inv;
  vec3 b = (hi - o) * inv;
  vec3 mn = min(a, b);
  vec3 mx = max(a, b);
  float near = max(max(mn.x, mn.y), max(mn.z, t0));
  float far = min(min(mx.x, mx.y), min(mx.z, t1));
  return near <= far;
}

// Möller-Trumbore, two-sided; -1 when missed.
float rayTri(vec3 o, vec3 d, vec3 a, vec3 b, vec3 c) {
  vec3 e1 = b - a;
  vec3 e2 = c - a;
  vec3 p = cross(d, e2);
  float det = dot(e1, p);
  if (abs(det) < 1e-14) return -1.0;
  float inv = 1.0 / det;
  vec3 t = o - a;
  float u = dot(t, p) * inv;
  if (u < 0.0 || u > 1.0) return -1.0;
  vec3 q = cross(t, e1);
  float v = dot(d, q) * inv;
  if (v < 0.0 || u + v > 1.0) return -1.0;
  return dot(e2, q) * inv;
}

// transmit: product of (1 - opacity) over every hit in (tMin, tMax];
// otherwise: distance to the first hit with opacity >= 0.5 (tMax if none).
float trace(vec3 o, vec3 d, float tMin, float tMax, bool transmit) {
  // A zero direction component would make 0 * inf = NaN in the slab test.
  d = mix(d, sign(d) * 1e-7 + d, step(abs(d), vec3(1e-7)));
  d = mix(d, vec3(1e-7), step(abs(d), vec3(0.0)));
  vec3 inv = 1.0 / d;
  int stack[48];
  int sp = 0;
  stack[sp++] = 0;
  float T = 1.0;
  float best = tMax;
  while (sp > 0) {
    int node = stack[--sp];
    vec4 A = nodeTexel(node * 2);
    vec4 B = nodeTexel(node * 2 + 1);
    if (!rayBox(A.xyz, B.xyz, o, inv, tMin, transmit ? tMax : best)) continue;
    int l0 = int(A.w);
    int l1 = int(B.w);
    if (l1 <= 0) {
      for (int i = l0; i < l0 - l1; i++) {
        vec4 v0 = triTexel(i * 3);
        vec4 v1 = triTexel(i * 3 + 1);
        vec4 v2 = triTexel(i * 3 + 2);
        float t = rayTri(o, d, v0.xyz, v1.xyz, v2.xyz);
        if (t < tMin || t > (transmit ? tMax : best)) continue;
        if (transmit) {
          T *= 1.0 - v0.w;
          if (T < 0.002) return 0.0;
        } else if (v0.w >= 0.5) {
          best = t;
        }
      }
    } else if (sp < 46) {
      stack[sp++] = l0;
      stack[sp++] = l1;
    }
  }
  return transmit ? T : best;
}

// Hammersley point i of n, shifted by the texel's offset (core samplePoint).
vec2 samplePoint(uint i, uint n, vec2 offset) {
  uint bits = i;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  float ri = float(bits) / 4294967296.0;
  return fract(vec2((float(i) + 0.5) / float(n), ri) + offset);
}

vec3 cosineDirection(vec3 n, vec2 u) {
  float r = sqrt(u.x);
  float phi = 6.283185307179586 * u.y;
  float x = r * cos(phi);
  float y = r * sin(phi);
  float z = sqrt(max(0.0, 1.0 - u.x));
  float s = n.z >= 0.0 ? 1.0 : -1.0;
  float a = -1.0 / (s + n.z);
  float b = n.x * n.y * a;
  vec3 t1 = vec3(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  vec3 t2 = vec3(b, s + n.y * n.y * a, -n.y);
  return x * t1 + y * t2 + z * n;
}

float hash(float a, float b) {
  return fract(sin(a * 12.9898 + b * 78.233) * 43758.5453);
}
`;

const gbufferVertex = /* glsl */ `
in vec3 position;
in vec3 normal;
in vec2 uv;
in float cavity;
out vec3 vPos;
out vec3 vNormal;
out float vCavity;
void main() {
  vPos = position;
  vNormal = normal;
  vCavity = cavity;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

const gbufferFragment = /* glsl */ `
precision highp float;
in vec3 vPos;
in vec3 vNormal;
in float vCavity;
layout(location = 0) out vec4 gPosition;
layout(location = 1) out vec4 gNormal;
void main() {
  gPosition = vec4(vPos, 1.0);
  gNormal = vec4(normalize(vNormal), vCavity);
}
`;

const quadVertex = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const traceFragment = /* glsl */ `
${traceChunk}
uniform sampler2D uPosition;
uniform sampler2D uNormal;
uniform sampler2D uPrev;
uniform int uStart;
uniform int uCount;
uniform int uTotal;
uniform float uAoDistance;
uniform float uThickness;
uniform vec3 uKeyDir;
uniform float uKeySoftness;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPosition, px, 0);
  vec4 prev = texelFetch(uPrev, px, 0);
  if (P.a < 0.5) { outColor = prev; return; }
  vec3 n = normalize(texelFetch(uNormal, px, 0).xyz);
  vec2 offset = vec2(hash(float(px.x), float(px.y)), hash(float(px.y) + 17.0, float(px.x) + 31.0));
  vec3 o = P.xyz + n * 0.0005;
  vec3 inside = P.xyz - n * 0.0005;
  float ao = 0.0;
  float depth = 0.0;
  float key = 0.0;
  for (int k = 0; k < uCount; k++) {
    uint i = uint(uStart + k);
    vec2 u = samplePoint(i, uint(uTotal), offset);
    ao += trace(o, cosineDirection(n, u), 1e-4, uAoDistance, true);
    depth += trace(inside, cosineDirection(-n, u), 1e-4, uThickness, false);
    // Soft key light: jitter the direction within a small cone.
    vec3 kd = normalize(cosineDirection(uKeyDir, vec2(u.x * uKeySoftness * uKeySoftness, u.y)));
    key += trace(o, kd, 1e-4, 4.0, true);
  }
  outColor = prev + vec4(ao, depth / uThickness, key, 0.0);
}
`;

/** Divide, seam-aware 3x3 denoise, light occlusion; invalid texels get r = -1 for the dilation. */
const resolveFragment = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uAccum;
uniform sampler2D uPosition;
uniform sampler2D uNormal;
uniform float uRays;
uniform vec3 uKeyDir;
uniform float uSky;
uniform float uKey;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uPosition, 0);
  vec4 P = texelFetch(uPosition, px, 0);
  if (P.a < 0.5) { outColor = vec4(-1.0, 0.0, 0.0, 0.0); return; }
  vec4 N = texelFetch(uNormal, px, 0);
  vec3 sum = vec3(0.0);
  float w = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 q = clamp(px + ivec2(x, y), ivec2(0), size - 1);
      vec4 Pq = texelFetch(uPosition, q, 0);
      if (Pq.a < 0.5) continue;
      // Neighbours in UV that are not neighbours on the surface (across a seam or another island) do not count.
      if (distance(Pq.xyz, P.xyz) > 0.015) continue;
      if (dot(texelFetch(uNormal, q, 0).xyz, N.xyz) < 0.8) continue;
      float k = (x == 0 && y == 0) ? 2.0 : 1.0;
      sum += texelFetch(uAccum, q, 0).rgb * k;
      w += k;
    }
  }
  vec3 m = sum / max(w, 1e-4) / uRays;
  float ao = clamp(m.r, 0.0, 1.0);
  float thickness = clamp(m.g, 0.0, 1.0);
  float keyVis = clamp(m.b, 0.0, 1.0);
  float k = uKey * max(0.0, dot(normalize(N.xyz), uKeyDir));
  float light = (uSky * ao + k * keyVis) / (uSky + k);
  outColor = vec4(ao, 1.0 - N.a, thickness, light);
}
`;

/** One dilation step: an empty texel takes the mean of its filled neighbours. */
const dilateFragment = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uSrc;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uSrc, 0);
  vec4 c = texelFetch(uSrc, px, 0);
  if (c.r >= 0.0) { outColor = c; return; }
  vec4 sum = vec4(0.0);
  float n = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec4 q = texelFetch(uSrc, clamp(px + ivec2(x, y), ivec2(0), size - 1), 0);
      if (q.r >= 0.0) { sum += q; n += 1.0; }
    }
  }
  outColor = n > 0.0 ? sum / n : c;
}
`;

/** Pack to RGBA8; texels never reached stay at "no darkening". */
const packFragment = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uSrc;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 c = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  outColor = c.r < 0.0 ? vec4(1.0) : clamp(c, 0.0, 1.0);
}
`;

export interface BakedMap {
  key: string;
  /** For the viewport: sample with the part's own UVs (no flip). */
  texture: THREE.Texture;
  /** Rows top first (v = 1 at the top), as the skin stack and the exporter want. */
  image: RgbaImage;
  /** Free the GPU texture. */
  release(): void;
}

export interface BakeRun {
  maps: Map<string, BakedMap>;
  /** Milliseconds per target (bake time is logged, F16). */
  timings: Record<string, number>;
  /** With `coverage`: per target, 1 where a texel was written (surface or gutter), rows top first. */
  coverage: Map<string, Uint8Array>;
}

export class BakeCancelled extends Error {}

/** Gutter the dilation fills, in texels. */
export const BAKE_DILATION = 8;

export class GpuBaker {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly trace: THREE.RawShaderMaterial;
  private readonly resolve: THREE.RawShaderMaterial;
  private readonly dilate: THREE.RawShaderMaterial;
  private readonly pack: THREE.RawShaderMaterial;
  private readonly gbuffer: THREE.RawShaderMaterial;
  /** Rays traced per texel in one draw (a frame's worth of work on a slow GPU). */
  raysPerPass = 4;
  /** Also return which texels were written (tests of the gutter). */
  coverage = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const raw = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.trace = raw(quadVertex, traceFragment, {
      uNodes: { value: null },
      uTris: { value: null },
      uWidth: { value: 1 },
      uPosition: { value: null },
      uNormal: { value: null },
      uPrev: { value: null },
      uStart: { value: 0 },
      uCount: { value: 1 },
      uTotal: { value: 1 },
      uAoDistance: { value: 0.25 },
      uThickness: { value: 0.06 },
      uKeyDir: { value: new THREE.Vector3(...BAKE_LIGHT.keyDirection) },
      uKeySoftness: { value: BAKE_LIGHT.keySoftness },
    });
    this.resolve = raw(quadVertex, resolveFragment, {
      uAccum: { value: null },
      uPosition: { value: null },
      uNormal: { value: null },
      uRays: { value: 1 },
      uKeyDir: { value: new THREE.Vector3(...BAKE_LIGHT.keyDirection) },
      uSky: { value: BAKE_LIGHT.sky },
      uKey: { value: BAKE_LIGHT.key },
    });
    this.dilate = raw(quadVertex, dilateFragment, { uSrc: { value: null } });
    this.pack = raw(quadVertex, packFragment, { uSrc: { value: null } });
    this.gbuffer = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: gbufferVertex,
      fragmentShader: gbufferFragment,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.trace);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /**
   * Bake every target. `progress` gets (done, total) in ray batches; `cancelled`
   * is polled between batches and throws BakeCancelled.
   */
  async bake(
    inputs: BakeInputs,
    settings: BakeSettings,
    progress?: (done: number, total: number) => void,
    cancelled?: () => boolean,
  ): Promise<BakeRun> {
    const packed = packBvh(inputs.occluders);
    const floatTex = (data: Float32Array, rows: number) => {
      const t = new THREE.DataTexture(data, packed.width, rows, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    const nodes = floatTex(packed.nodes, packed.nodeRows);
    const tris = floatTex(packed.triangles, packed.triangleRows);
    const tu = this.trace.uniforms;
    tu.uNodes!.value = nodes;
    tu.uTris!.value = tris;
    tu.uWidth!.value = packed.width;
    tu.uAoDistance!.value = settings.aoDistance;
    tu.uThickness!.value = settings.thicknessDistance;
    const maps = new Map<string, BakedMap>();
    const timings: Record<string, number> = {};
    const coverage = new Map<string, Uint8Array>();
    const passes = Math.ceil(settings.rays / this.raysPerPass);
    const total = passes * inputs.targets.length;
    let done = 0;
    const prev = this.renderer.getRenderTarget();
    try {
      for (const target of inputs.targets) {
        const t0 = performance.now();
        const map = await this.bakeTarget(target, settings, passes, () => {
          done++;
          progress?.(done, total);
          if (cancelled?.()) throw new BakeCancelled('bake cancelled');
        }, coverage);
        timings[target.key] = Math.round(performance.now() - t0);
        maps.set(target.key, map);
      }
    } finally {
      nodes.dispose();
      tris.dispose();
      this.renderer.setRenderTarget(prev);
    }
    return { maps, timings, coverage };
  }

  private draw(material: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  private async bakeTarget(target: BakeTarget, settings: BakeSettings, passes: number, step: () => void, coverage: Map<string, Uint8Array>): Promise<BakedMap> {
    const S = target.size;
    const float = { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
    // 1. G-buffer in UV space.
    const g = new THREE.WebGLRenderTarget(S, S, { ...float, count: 2 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(target.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(target.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(target.uvs, 2));
    geo.setAttribute('cavity', new THREE.BufferAttribute(target.cavity, 1));
    geo.setIndex(new THREE.BufferAttribute(target.indices, 1));
    const mesh = new THREE.Mesh(geo, this.gbuffer);
    mesh.frustumCulled = false;
    const gscene = new THREE.Scene();
    gscene.add(mesh);
    this.renderer.setRenderTarget(g);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(gscene, this.camera);
    geo.dispose();
    const [gPos, gNrm] = g.textures as [THREE.Texture, THREE.Texture];

    // 2. Rays, in batches, summed by ping-pong (float blending is not available everywhere).
    let accum = new THREE.WebGLRenderTarget(S, S, float);
    let spare = new THREE.WebGLRenderTarget(S, S, float);
    this.renderer.setRenderTarget(accum);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    const tu = this.trace.uniforms;
    tu.uPosition!.value = gPos;
    tu.uNormal!.value = gNrm;
    const rays = passes * this.raysPerPass;
    tu.uTotal!.value = rays;
    for (let p = 0; p < passes; p++) {
      tu.uStart!.value = p * this.raysPerPass;
      tu.uCount!.value = this.raysPerPass;
      tu.uPrev!.value = accum.texture;
      this.draw(this.trace, spare);
      [accum, spare] = [spare, accum];
      // Let the browser breathe (and the user cancel) between batches.
      await new Promise((r) => setTimeout(r, 0));
      step();
    }
    spare.dispose();

    // 3. Resolve, dilate, pack.
    const a = new THREE.WebGLRenderTarget(S, S, float);
    const b = new THREE.WebGLRenderTarget(S, S, float);
    const ru = this.resolve.uniforms;
    ru.uAccum!.value = accum.texture;
    ru.uPosition!.value = gPos;
    ru.uNormal!.value = gNrm;
    ru.uRays!.value = rays;
    this.draw(this.resolve, a);
    let src = a;
    let dst = b;
    for (let i = 0; i < BAKE_DILATION; i++) {
      this.dilate.uniforms.uSrc!.value = src.texture;
      this.draw(this.dilate, dst);
      [src, dst] = [dst, src];
    }
    if (this.coverage) {
      const f = new Float32Array(S * S * 4);
      this.renderer.readRenderTargetPixels(src, 0, 0, S, S, f);
      const cov = new Uint8Array(S * S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) cov[y * S + x] = f[((S - 1 - y) * S + x) * 4]! >= 0 ? 1 : 0;
      coverage.set(target.key, cov);
    }
    const out = new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true });
    this.pack.uniforms.uSrc!.value = src.texture;
    this.draw(this.pack, out);
    const buf = new Uint8Array(S * S * 4);
    this.renderer.readRenderTargetPixels(out, 0, 0, S, S, buf);
    // GL rows run bottom up (v = 0 first); images run top down.
    const data = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++) data.set(buf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    g.dispose();
    accum.dispose();
    a.dispose();
    b.dispose();
    return { key: target.key, texture: out.texture, image: { width: S, height: S, data }, release: () => out.dispose() };
  }

  dispose(): void {
    for (const m of [this.trace, this.resolve, this.dilate, this.pack, this.gbuffer]) m.dispose();
    this.quad.geometry.dispose();
  }
}
