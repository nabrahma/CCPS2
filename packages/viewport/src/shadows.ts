/**
 * Shadow maps (PRD Part 2, F14): one for the key light (orthographic, fitted
 * to the character) and one for the flashlight (perspective, from its offset
 * position). Depth is rendered with each part's own alpha cutout, so hair
 * cards cast strand-shaped shadows. Materials sample them with a 5x5 PCF
 * (materials.ts); the ground disc shows the character's shadow under it.
 */
import * as THREE from 'three';

const depthVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const depthFragment = /* glsl */ `
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uAlphaTest;
varying vec2 vUv;
void main() {
  if (uHasMap > 0.5 && uAlphaTest > 0.0 && texture2D(uMap, vUv).a < uAlphaTest) discard;
  gl_FragColor = vec4(1.0);
}
`;

export interface ShadowMap {
  target: THREE.WebGLRenderTarget;
  camera: THREE.Camera;
  /** World space to the shadow camera's clip space. */
  matrix: THREE.Matrix4;
}

function makeTarget(size: number): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, type: THREE.UnsignedByteType });
  t.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
  t.depthTexture.minFilter = THREE.NearestFilter;
  t.depthTexture.magFilter = THREE.NearestFilter;
  return t;
}

export interface ShadowCaster {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export class ShadowMaps {
  readonly key: ShadowMap;
  readonly spot: ShadowMap;
  private readonly depthMaterials = new WeakMap<THREE.ShaderMaterial, THREE.ShaderMaterial>();

  constructor(readonly size = 2048) {
    this.key = { target: makeTarget(size), camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10), matrix: new THREE.Matrix4() };
    this.spot = { target: makeTarget(size), camera: new THREE.PerspectiveCamera(50, 1, 0.05, 10), matrix: new THREE.Matrix4() };
  }

  private depthMaterial(m: THREE.ShaderMaterial): THREE.ShaderMaterial {
    let d = this.depthMaterials.get(m);
    if (!d) {
      d = new THREE.ShaderMaterial({
        vertexShader: depthVertex,
        fragmentShader: depthFragment,
        side: THREE.DoubleSide,
        uniforms: { uMap: { value: null }, uHasMap: { value: 0 }, uAlphaTest: { value: 0 } },
      });
      this.depthMaterials.set(m, d);
    }
    d.uniforms.uMap!.value = m.uniforms.uMap!.value;
    d.uniforms.uHasMap!.value = m.uniforms.uHasMap!.value;
    d.uniforms.uAlphaTest!.value = m.uniforms.uAlphaTest!.value;
    return d;
  }

  /** Fit the key light's box around the character (world-space bounding sphere). */
  placeKey(direction: THREE.Vector3, bounds: THREE.Sphere): void {
    const cam = this.key.camera as THREE.OrthographicCamera;
    const r = Math.max(0.2, bounds.radius * 1.05);
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.01;
    cam.far = r * 4;
    cam.position.copy(bounds.center).addScaledVector(direction.clone().normalize(), r * 2);
    cam.up.set(0, 1, 0);
    if (Math.abs(direction.clone().normalize().y) > 0.99) cam.up.set(0, 0, 1);
    cam.lookAt(bounds.center);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.key.matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }

  placeSpot(position: THREE.Vector3, direction: THREE.Vector3, cosOuter: number, range: number): void {
    const cam = this.spot.camera as THREE.PerspectiveCamera;
    cam.fov = Math.min(170, (2 * Math.acos(Math.min(0.9999, Math.max(-1, cosOuter))) * 180) / Math.PI + 4);
    cam.aspect = 1;
    cam.near = 0.05;
    cam.far = Math.max(0.5, range);
    cam.position.copy(position);
    cam.up.set(0, 1, 0);
    cam.lookAt(position.clone().add(direction));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.spot.matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }

  /** Render depth of the casters into one map. Everything else in the scene is hidden meanwhile. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, map: ShadowMap, casters: ShadowCaster[]): void {
    const hidden: THREE.Object3D[] = [];
    const casterSet = new Set(casters.map((c) => c.mesh));
    scene.traverse((o) => {
      if (o.visible && (o as THREE.Mesh).isMesh && !casterSet.has(o as THREE.Mesh)) {
        o.visible = false;
        hidden.push(o);
      }
      if (o.visible && (o as THREE.LineSegments).isLineSegments) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const saved = casters.map((c) => c.mesh.material);
    casters.forEach((c) => (c.mesh.material = this.depthMaterial(c.material)));
    const bg = scene.background;
    scene.background = null;
    renderer.setRenderTarget(map.target);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.render(scene, map.camera);
    renderer.setRenderTarget(null);
    scene.background = bg;
    casters.forEach((c, i) => (c.mesh.material = saved[i]!));
    for (const o of hidden) o.visible = true;
  }

  dispose(): void {
    for (const m of [this.key, this.spot]) {
      m.target.depthTexture?.dispose();
      m.target.dispose();
    }
  }
}

const groundVertex = /* glsl */ `
varying vec3 vWorld;
varying vec2 vPos;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vPos = position.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const groundFragment = /* glsl */ `
uniform sampler2D uKeyShadow;
uniform mat4 uKeyShadowMatrix;
uniform float uKeyOn;
uniform float uKeyStrength;
uniform sampler2D uSpotShadow;
uniform mat4 uSpotShadowMatrix;
uniform float uSpotOn;
uniform float uSpotStrength;
uniform vec2 uShadowTexel;
uniform float uRadius;
varying vec3 vWorld;
varying vec2 vPos;

float lit(sampler2D map, mat4 m) {
  vec4 c = m * vec4(vWorld, 1.0);
  vec3 p = c.xyz / c.w * 0.5 + 0.5;
  if (c.w <= 0.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int y = -2; y <= 2; y++)
    for (int x = -2; x <= 2; x++) s += step(p.z - 0.002, texture2D(map, p.xy + vec2(float(x), float(y)) * uShadowTexel * 1.5).r);
  return s / 25.0;
}

void main() {
  float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius, length(vPos));
  float a = 0.0;
  if (uKeyOn > 0.5) a = max(a, (1.0 - lit(uKeyShadow, uKeyShadowMatrix)) * uKeyStrength);
  if (uSpotOn > 0.5) a = max(a, (1.0 - lit(uSpotShadow, uSpotShadowMatrix)) * uSpotStrength);
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * fade);
}
`;

/** A disc at the feet that darkens where the character's shadow falls (shadow catcher). */
export function createGroundShadow(maps: ShadowMaps, radius = 1.6): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: groundVertex,
    fragmentShader: groundFragment,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uKeyShadow: { value: maps.key.target.depthTexture },
      uKeyShadowMatrix: { value: maps.key.matrix },
      uKeyOn: { value: 0 },
      uKeyStrength: { value: 0.6 },
      uSpotShadow: { value: maps.spot.target.depthTexture },
      uSpotShadowMatrix: { value: maps.spot.matrix },
      uSpotOn: { value: 0 },
      uSpotStrength: { value: 0.75 },
      uShadowTexel: { value: new THREE.Vector2(1 / maps.size, 1 / maps.size) },
      uRadius: { value: radius },
    },
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.name = 'ground-shadow';
  return mesh;
}
