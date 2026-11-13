/**
 * Renders of the Infinite Realities head scan (Lee Perry-Smith, CC BY 3.0) for
 * the scanned-face base skin (Part 2 F19, `pnpm build:scanskin`): the scan is
 * drawn unlit with its colour map from a few directions, and the renders go
 * through the three-photo projection like any photos. Used only by the build
 * tool through the test hooks; never part of the app's own code paths.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface ScanRenderOptions {
  /** Directions to render from: degrees around the vertical axis, 0 = the scan's front. */
  yaws: number[];
  /** Turn added to every yaw so 0 faces the scan's face (found by the caller). */
  facing?: number;
  width?: number;
  height?: number;
}

/** Render the scan from each yaw; returns PNG object URLs (rows top first). */
export async function renderScanViews(glb: ArrayBuffer, colour: Blob, opts: ScanRenderOptions): Promise<string[]> {
  const width = opts.width ?? 768;
  const height = opts.height ?? 960;
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => new GLTFLoader().parse(glb, '', (g) => resolve(g as unknown as { scene: THREE.Group }), reject));
  const colourUrl = URL.createObjectURL(colour);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = colourUrl;
  });
  const map = new THREE.Texture(image);
  map.colorSpace = THREE.SRGBColorSpace;
  // This scan's UVs expect the usual flipped image (as three.js's own example loads Map-COL.jpg).
  map.flipY = true;
  map.needsUpdate = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7a7a7a);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = new THREE.MeshBasicMaterial({ map });
  });
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Frame the face: a little above the box centre (the scan includes the neck).
  const target = new THREE.Vector3(centre.x, centre.y + size.y * 0.06, centre.z);
  const camera = new THREE.PerspectiveCamera(18, width / height, 0.01, 1000);
  const dist = (size.y * 0.62) / Math.tan(THREE.MathUtils.degToRad(9));
  const canvas = new OffscreenCanvas(width, height);
  const renderer = new THREE.WebGLRenderer({ canvas: canvas as unknown as HTMLCanvasElement, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const urls: string[] = [];
  try {
    for (const yaw of opts.yaws) {
      const a = THREE.MathUtils.degToRad(yaw + (opts.facing ?? 0));
      camera.position.set(target.x + Math.sin(a) * dist, target.y, target.z + Math.cos(a) * dist);
      camera.lookAt(target);
      renderer.render(scene, camera);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      urls.push(URL.createObjectURL(blob));
    }
  } finally {
    renderer.dispose();
    map.dispose();
    URL.revokeObjectURL(colourUrl);
  }
  return urls;
}
