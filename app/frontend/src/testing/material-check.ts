/**
 * The material check of PRD Part 2 M15 (test hook only): one tile of a library
 * material rendered flat on a plane, under the fixed soft top light the era
 * diffuse was made with (ERA_LIGHT), twice with three.js's standard PBR
 * material:
 * - the PBR original: albedo, normal map, occlusion and roughness maps;
 * - the era diffuse alone, on a flat surface with the material's mean roughness;
 * - as a control, the albedo alone on the same flat surface.
 * The test compares the era render (and the control) with the original (SSIM).
 */
import * as THREE from 'three';
import { ERA_LIGHT, type CatalogMaterial, type RgbaImage } from '@ps2cc/core';

async function texture(url: string, colour: boolean): Promise<THREE.Texture> {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export async function renderMaterialPair(info: CatalogMaterial, assetBaseUrl: string, size = 512): Promise<{ pbr: RgbaImage; era: RgbaImage; plain: RgbaImage }> {
  const url = (p: string) => `${assetBaseUrl.replace(/\/$/, '')}/${p}`;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  // Tangent space +x right, +y up, +z towards the camera: the plane faces the camera.
  const key = new THREE.DirectionalLight(0xffffff, ERA_LIGHT.keyIntensity);
  key.position.set(...ERA_LIGHT.key);
  scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight(new THREE.Color(ERA_LIGHT.sky, ERA_LIGHT.sky, ERA_LIGHT.sky), new THREE.Color(ERA_LIGHT.ground, ERA_LIGHT.ground, ERA_LIGHT.ground), 1));
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  camera.position.set(0, 0, 2);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const [albedo, normal, arm, era] = await Promise.all([texture(url(info.pbr.albedo), true), texture(url(info.pbr.normal), false), texture(url(info.pbr.arm), false), texture(url(info.diffuse), true)]);
  const read = (): RgbaImage => {
    const gl = renderer.getContext();
    const buf = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) data.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    return { width: size, height: size, data };
  };
  const draw = (material: THREE.Material): RgbaImage => {
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    renderer.render(scene, camera);
    const img = read();
    scene.remove(mesh);
    material.dispose();
    return img;
  };
  const pbr = draw(new THREE.MeshStandardMaterial({ map: albedo, normalMap: normal, aoMap: arm, roughnessMap: arm, roughness: 1, metalness: 0 }));
  const flat = draw(new THREE.MeshStandardMaterial({ map: era, roughness: info.roughness, metalness: 0 }));
  // Control: the albedo alone, flat, with no conversion (what a plain texture copy would give).
  const plain = draw(new THREE.MeshStandardMaterial({ map: albedo, roughness: info.roughness, metalness: 0 }));
  for (const t of [albedo, normal, arm, era]) t.dispose();
  geometry.dispose();
  renderer.dispose();
  return { pbr, era: flat, plain };
}
