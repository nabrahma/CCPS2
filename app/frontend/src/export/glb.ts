/**
 * Secondary GLB output (PRD 6.3 step 4): the export scene as a Three.js scene
 * (skinned meshes, the same skeleton, morph targets, textures), written with
 * GLTFExporter and checked with the Khronos glTF-Validator. Errors fail the
 * export.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { validateBytes } from 'gltf-validator';
import type { ExportScene } from '@ps2cc/core';
import { imageToCanvas } from '../images';
import { canonicalGlb } from './glb-canonical';

export interface GlbResult {
  bytes: Uint8Array;
  errors: number;
  warnings: number;
  messages: string[];
}

function local(bones: ExportScene['bones'], i: number): THREE.Matrix4 {
  const g = new THREE.Matrix4().fromArray(bones[i]!.bindGlobal);
  const p = bones[i]!.parent;
  if (p < 0) return g;
  return new THREE.Matrix4().fromArray(bones[p]!.bindGlobal).invert().multiply(g);
}

export function exportSceneToThree(ex: ExportScene): THREE.Group {
  const root = new THREE.Group();
  root.name = ex.name;
  const bones = ex.bones.map((b, i) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    local(ex.bones, i).decompose(bone.position, bone.quaternion, bone.scale);
    return bone;
  });
  ex.bones.forEach((b, i) => (b.parent >= 0 ? bones[b.parent]!.add(bones[i]!) : root.add(bones[i]!)));
  root.updateMatrixWorld(true);
  const inverses = ex.bones.map((b) => new THREE.Matrix4().fromArray(b.bindGlobal).invert());
  const skeleton = new THREE.Skeleton(bones, inverses);
  const textures = new Map<string, THREE.Texture>();
  for (const t of ex.textures) {
    const tex = new THREE.CanvasTexture(imageToCanvas(t.image));
    tex.name = t.file.split('/').pop()!.replace(/\.png$/, '');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    textures.set(t.file, tex);
  }
  for (const m of ex.meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(m.joints, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(m.weights, 4));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    if (m.shapes.length) {
      g.morphAttributes.position = m.shapes.map((s) => {
        const dense = new Float32Array(m.positions.length);
        s.indices.forEach((v, k) => dense.set(s.deltas.subarray(k * 3, k * 3 + 3), v * 3));
        const a = new THREE.BufferAttribute(dense, 3);
        a.name = s.name;
        return a;
      });
      if (m.shapes.every((s) => s.normalDeltas)) {
        g.morphAttributes.normal = m.shapes.map((s) => {
          const dense = new Float32Array(m.normals.length);
          s.indices.forEach((v, k) => dense.set(s.normalDeltas!.subarray(k * 3, k * 3 + 3), v * 3));
          const a = new THREE.BufferAttribute(dense, 3);
          a.name = s.name;
          return a;
        });
      }
      g.morphTargetsRelative = true;
    }
    const mat = ex.materials[m.materials[0]!]!;
    const material = new THREE.MeshStandardMaterial({
      name: mat.name,
      map: textures.get(mat.texture) ?? null,
      alphaTest: mat.alphaClip,
      side: mat.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      roughness: 1,
      metalness: 0,
    });
    const mesh = new THREE.SkinnedMesh(g, material);
    mesh.name = m.name;
    if (m.shapes.length) {
      mesh.morphTargetDictionary = Object.fromEntries(m.shapes.map((s, i) => [s.name, i]));
      mesh.morphTargetInfluences = m.shapes.map(() => 0);
    }
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
  }
  return root;
}

export async function buildGlb(ex: ExportScene): Promise<GlbResult> {
  const root = exportSceneToThree(ex);
  // Top-level nodes (bones and skinned meshes), so no transform sits above a skinned mesh.
  const buffer = (await new GLTFExporter().parseAsync([...root.children], { binary: true, onlyVisible: false })) as ArrayBuffer;
  // Fixed byte layout: the exporter writes embedded images in the order their encoding finishes.
  const bytes = canonicalGlb(new Uint8Array(buffer));
  const report = await validateBytes(bytes, { maxIssues: 50, format: 'glb' });
  const messages = (report.issues.messages ?? []).filter((m) => m.severity <= 1).map((m) => `${m.severity === 0 ? 'error' : 'warning'} ${m.code}: ${m.message} (${m.pointer ?? ''})`);
  return { bytes, errors: report.issues.numErrors, warnings: report.issues.numWarnings, messages };
}
