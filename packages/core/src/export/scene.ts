/**
 * Export scene (PRD 6.1, 6.2): everything one export writes, built from the
 * CharacterScene. The FBX is written by the Go backend from this data (sent as
 * one binary message, see message.ts); the GLB by the app with Three.js.
 *
 * Rules applied here:
 *  - One mesh (SkinnedMeshRenderer) per material group: Head, Body, Hair,
 *    Garments (merged, one atlas) and Eyes (eyes + brows + lashes + teeth, one
 *    atlas): at most 5 draw calls.
 *  - GameEngine skeleton in its rest pose (MakeHuman's A-pose), or a T-pose.
 *  - At most 4 normalised bone influences per vertex.
 *  - Metres, feet on the origin, facing +Z, Y up.
 *  - Hidden body faces removed; unused vertices stripped.
 *  - The head gets its own texture (D-034); tints, brightness, dirt and brow
 *    density are baked into the textures.
 *  - Expression blendshapes (PRD F8) baked from the default rig's face pose
 *    units, on every mesh they move (sparse: vertices that move over 1 um).
 */
import type { CharacterDoc, Tint } from '../character/doc';
import type { Mat3, Mat4, Vec3 } from '../math/mat4';
import { axisAngle3, invertRigid, mul3, mul4 } from '../math/mat4';
import type { CharacterScene, ScenePart } from '../scene/character-scene';
import { poseWorldMatrices, skinningMatrices } from '../skeleton/rig';
import { skinPositions } from '../skeleton/skinning';
import { MAX_INFLUENCES, type InfluenceTable } from '../skeleton/weights';
import { bodyTexture, cropHeadTexture, packHead, splitBody } from '../skin/headsplit';
import { EYES_ATLAS_SIZE, GARMENT_ATLAS_SIZE, HAIR_TEXTURE_LIMIT } from './limits';
import { createImage, resizeImage, type RgbaImage } from '../skin/image';
import { atlasUv, packAtlas } from './atlas';
import { expressionDef } from '../expression/map';

/** Vertices that move less than this in a blendshape are left out of it (metres). */
export const SHAPE_EPSILON = 1e-6;

export type MaterialRole = 'head' | 'body' | 'hair' | 'garments' | 'eyes';

export interface ExportBone {
  name: string;
  parent: number;
  /** Rest world matrix, column-major, metres (feet on the origin). */
  bindGlobal: number[];
}

export interface ExportShape {
  name: string;
  indices: Uint32Array;
  deltas: Float32Array;
  normalDeltas?: Float32Array;
}

export interface ExportMesh {
  name: string;
  role: MaterialRole;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Scene material index of each slot (one slot per mesh here). */
  materials: number[];
  joints: Uint16Array;
  weights: Float32Array;
  shapes: ExportShape[];
}

export interface ExportMaterial {
  name: string;
  shader: 'PS2/Skin' | 'PS2/Cutout' | 'PS2/Cloth';
  texture: string;
  alphaClip: number;
  doubleSided: boolean;
  /** Hair whose normals describe its volume: lit one-sided even though both faces are drawn. */
  volumeNormals?: boolean;
  role: MaterialRole;
}

export interface ExportTexture {
  file: string;
  role: MaterialRole;
  image: RgbaImage;
  /** Unity import: max size and whether alpha is transparency. */
  maxSize: number;
  alpha: boolean;
}

export interface ExportScene {
  name: string;
  bones: ExportBone[];
  meshes: ExportMesh[];
  materials: ExportMaterial[];
  textures: ExportTexture[];
  sidecar: Record<string, unknown>;
}

export interface ExportOptions {
  /** Decode a texture (catalog path or library URL) to RGBA. */
  loadImage: (url: string) => Promise<RgbaImage>;
  /** The composited skin at 2048 px (viewport composite or the decoded base skin). */
  skin: RgbaImage;
  /** Rotate the arms to a T-pose and re-bake the meshes (PRD 6.2 option). */
  tPose?: boolean;
  appVersion?: string;
  /** Garment and eyes atlas sizes. */
  garmentAtlas?: number;
  eyesAtlas?: number;
}

/** Names that are safe in files, FBX and Unity: letters, digits, space, _ . - ( ), at most 48 characters. */
export function exportName(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N} _.\-()]/gu, '_').trim().slice(0, 48).trim();
  return clean || 'Character';
}

interface Source {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  influences: InfluenceTable;
  /** Dense per-vertex blendshape deltas, in the order of the document's list. */
  shapes: { name: string; deltas: Float32Array; normals: Float32Array }[];
}

export async function buildExportScene(scene: CharacterScene, opts: ExportOptions): Promise<ExportScene> {
  const engine = scene.engine;
  const doc = engine.doc as CharacterDoc;
  const name = exportName(doc.name);
  const sk = engine.skeleton;
  const rig = sk.rig;
  // Feet on the origin: the lowest vertex of the exported body (after posing) sits at y = 0.
  const bodyPart = scene.parts.find((p) => p.kind === 'body');
  if (!bodyPart) throw new Error('the character has no body');

  // Skeleton (optionally re-posed into a T-pose) and the matrices that move the rest meshes into it.
  let world: Float64Array = Float64Array.from(sk.restWorld);
  let skinMats: Float64Array | null = null;
  if (opts.tPose) {
    world = tPoseWorld(scene);
    skinMats = skinningMatrices(sk, world);
  }
  let lowest = Infinity;
  {
    const inf = scene.influences('body')!;
    const posed = skinMats ? skinPositions(bodyPart.positions, inf, skinMats) : bodyPart.positions;
    for (const i of bodyPart.indices) lowest = Math.min(lowest, posed[i * 3 + 1]!);
  }
  const lift = -lowest;
  // Blendshapes to bake: the document's list, in its order, as far as the expression map knows them.
  const shapeNames = [...new Set(doc.expressionsToBake)].filter((n) => expressionDef(n) !== undefined);
  if (shapeNames.length > 0) await scene.prepareExpressions();
  const bones: ExportBone[] = rig.bones.map((b, i) => {
    const m = Array.from(world.subarray(i * 16, i * 16 + 16));
    m[13] = m[13]! + lift;
    return { name: b.name, parent: rig.parents[i]!, bindGlobal: m };
  });

  const source = (part: ScenePart): Source => {
    const influences = scene.influences(part.key);
    if (!influences) throw new Error(`no skin weights for ${part.key}`);
    let positions = part.positions;
    let normals = part.normals;
    if (skinMats) {
      positions = new Float32Array(positions.length);
      normals = new Float32Array(normals.length);
      skinPositions(part.positions, influences, skinMats, positions, part.normals, normals);
    }
    const lifted = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      lifted[i] = positions[i]!;
      lifted[i + 1] = positions[i + 1]! + lift;
      lifted[i + 2] = positions[i + 2]!;
    }
    const shapes: Source['shapes'] = [];
    for (const n of shapeNames) {
      const sh = scene.expressionShapes(n)?.get(part.key);
      if (!sh) continue;
      // In a T-pose export the deltas turn with the skinning (a rest-pose delta on a rotated arm).
      shapes.push(skinMats
        ? { name: n, deltas: rotateBySkin(sh.deltas, influences, skinMats), normals: rotateBySkin(sh.normals, influences, skinMats) }
        : { name: n, deltas: sh.deltas, normals: sh.normals });
    }
    return { positions: lifted, normals, uvs: part.uvs, influences, shapes };
  };

  const meshes: ExportMesh[] = [];
  const materials: ExportMaterial[] = [];
  const textures: ExportTexture[] = [];
  const addMaterial = (role: MaterialRole, shader: ExportMaterial['shader'], image: RgbaImage, maxSize: number, alpha: boolean, alphaClip: number, doubleSided: boolean) => {
    const label = role[0]!.toUpperCase() + role.slice(1);
    const file = `Textures/${name}_${label}_D.png`;
    textures.push({ file, role, image, maxSize, alpha });
    materials.push({ name: `${name}_${label}`, shader, texture: file, alphaClip, doubleSided, role });
    return materials.length - 1;
  };

  // Head and body: the PS2 body split by UV island, with the head remapped into its own texture.
  const body = bodyPart;
  const layout = engine.assets.skinComposer.layout;
  const headSize = doc.export.headTexture;
  const bodySize = doc.export.bodyTexture;
  const packing = packHead(layout, headSize);
  const split = splitBody({ sourceVertex: scene.bodySourceVertices!, uvs: body.uvs, indices: body.indices }, layout, packing);
  const bodySrc = source(body);
  const headMat = addMaterial('head', 'PS2/Skin', cropHeadTexture(opts.skin, packing, headSize), headSize, false, 0, false);
  meshes.push(compact(`${name}_Head`, 'head', { ...bodySrc, uvs: split.uvs }, split.headIndices, headMat));
  const bodyMat = addMaterial('body', 'PS2/Skin', bodyTexture(opts.skin, bodySize), bodySize, false, 0, false);
  meshes.push(compact(`${name}_Body`, 'body', bodySrc, split.bodyIndices, bodyMat));

  // Hair (card hair or a hair mesh), its texture tinted.
  const hair = scene.parts.find((p) => p.kind === 'hair');
  if (hair) {
    const tex = hair.material.texture ? await opts.loadImage(hair.material.texture) : createImage(4, 4, [255, 255, 255, 255]);
    const img = limit(tint(tex, hair.material.tint), HAIR_TEXTURE_LIMIT);
    const mat = addMaterial('hair', 'PS2/Cutout', img, Math.max(img.width, img.height), true, hair.material.alphaThreshold, true);
    materials[mat]!.volumeNormals = Boolean(hair.material.volumeNormals);
    meshes.push(compact(`${name}_Hair`, 'hair', source(hair), hair.indices, mat));
  }

  // Merged groups with an atlas each.
  const merged = async (role: MaterialRole, parts: ScenePart[], size: number, shader: ExportMaterial['shader'], bake: (p: ScenePart, img: RgbaImage) => RgbaImage) => {
    if (parts.length === 0) return;
    const images: RgbaImage[] = [];
    for (const p of parts) {
      const tex = p.material.texture ? await opts.loadImage(p.material.texture) : createImage(4, 4, [255, 255, 255, 255]);
      images.push(bake(p, limit(tex, size)));
    }
    const atlas = packAtlas(images, size);
    const mat = addMaterial(role, shader, atlas.image, size, true, 0.5, true);
    const pieces = parts.map((p, i) => {
      const src = source(p);
      const uvs = new Float32Array(src.uvs.length);
      for (let k = 0; k < uvs.length; k += 2) {
        const [u, v] = atlasUv(atlas.cells[i]!, src.uvs[k]!, src.uvs[k + 1]!);
        uvs[k] = u;
        uvs[k + 1] = v;
      }
      return compact('', role, { ...src, uvs }, p.indices, mat);
    });
    meshes.push(concat(`${name}_${role[0]!.toUpperCase()}${role.slice(1)}`, role, pieces, mat));
  };
  const garments = scene.parts.filter((p) => p.kind === 'garment');
  await merged('garments', garments, opts.garmentAtlas ?? GARMENT_ATLAS_SIZE, 'PS2/Cloth', (p, img) => dirt(tint(img, p.material.tint), p.material.dirt));
  const eyes = scene.parts.filter((p) => p.kind === 'eyes' || p.kind === 'eyebrows' || p.kind === 'eyelashes' || p.kind === 'teeth');
  await merged('eyes', eyes, opts.eyesAtlas ?? EYES_ATLAS_SIZE, 'PS2/Cutout', (p, img) => remapAlpha(tint(img, p.material.tint), p.material.alphaCutout ? p.material.alphaThreshold : 0, 0.5));

  const tWorld = opts.tPose ? world : tPoseWorld(scene);
  const tBones: ExportBone[] = rig.bones.map((b, i) => {
    const m = Array.from(tWorld.subarray(i * 16, i * 16 + 16));
    m[13] = m[13]! + lift;
    return { name: b.name, parent: rig.parents[i]!, bindGlobal: m };
  });
  const budget = scene.budget();
  const sidecar: Record<string, unknown> = {
    format: 'ps2cc.sidecar/1',
    name,
    app: opts.appVersion ?? 'dev',
    target: 'Unity 6 LTS, URP',
    units: 'metres, Y up, facing +Z, feet on the origin',
    tPose: Boolean(opts.tPose),
    rig: 'MakeHuman GameEngine (without breasts)',
    humanoidMap: 'humanoid_map.json (com.ps2cc.importer)',
    meshes: meshes.map((m) => ({ name: m.name, role: m.role, vertices: m.positions.length / 3, triangles: m.indices.length / 3, blendshapes: m.shapes.map((s) => s.name) })),
    materials: materials.map((m) => {
      const t = textures.find((x) => x.file === m.texture)!;
      return { name: m.name, shader: m.shader, role: m.role, texture: m.texture, alphaClip: m.alphaClip, doubleSided: m.doubleSided, volumeNormals: Boolean(m.volumeNormals), maxSize: t.maxSize, alphaIsTransparency: t.alpha };
    }),
    // Rest transforms, plus the T-pose the Unity importer uses as the Humanoid reference pose
    // (Unity's "Enforce T-Pose"), so retargeted animations keep the arms where they belong.
    skeleton: bones.map((b, i) => ({ name: b.name, parent: b.parent, ...localTrs(bones, b), tPose: localTrs(tBones, tBones[i]!) })),
    budget: {
      target: doc.export.triangleBudget,
      hardMax: doc.export.hardMax,
      triangles: meshes.reduce((s, m) => s + m.indices.length / 3, 0),
      byPart: { body: budget.body, head: budget.head, hair: budget.hair, garments: budget.garments, eyesAndBrows: budget.eyesAndBrows },
    },
    blendshapes: shapeNames.filter((n) => meshes.some((m) => m.shapes.some((s) => s.name === n))),
    expressionMap: 'expression_map.json (MakeHuman face pose units on the default rig)',
    source: {
      characterId: doc.id,
      bodyMesh: doc.bodyMesh,
      macros: doc.macros,
      skin: doc.skin.base,
      garments: doc.garments.map((g) => g.asset),
      hair: doc.hair.mode === 'cards' ? `cards:${doc.hair.style?.name ?? ''}` : doc.hair.mode === 'mesh' ? doc.hair.asset : 'none',
    },
  };
  return { name, bones, meshes, materials, textures, sidecar };
}

/** Keep only the vertices a triangle list uses, in first-use order. */
function compact(name: string, role: MaterialRole, src: Source, indices: Uint32Array, material: number): ExportMesh {
  const remap = new Int32Array(src.positions.length / 3).fill(-1);
  const order: number[] = [];
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]!;
    if (remap[v] === -1) {
      remap[v] = order.length;
      order.push(v);
    }
    out[i] = remap[v]!;
  }
  const n = order.length;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const joints = new Uint16Array(n * MAX_INFLUENCES);
  const weights = new Float32Array(n * MAX_INFLUENCES);
  order.forEach((v, i) => {
    for (let k = 0; k < 3; k++) {
      positions[i * 3 + k] = src.positions[v * 3 + k]!;
      normals[i * 3 + k] = src.normals[v * 3 + k]!;
    }
    uvs[i * 2] = src.uvs[v * 2]!;
    uvs[i * 2 + 1] = src.uvs[v * 2 + 1]!;
    let sum = 0;
    for (let k = 0; k < MAX_INFLUENCES; k++) sum += src.influences.weights[v * MAX_INFLUENCES + k]!;
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const w = src.influences.weights[v * MAX_INFLUENCES + k]!;
      joints[i * MAX_INFLUENCES + k] = w > 0 ? src.influences.joints[v * MAX_INFLUENCES + k]! : 0;
      weights[i * MAX_INFLUENCES + k] = sum > 0 ? w / sum : k === 0 ? 1 : 0;
    }
  });
  const shapes: ExportShape[] = [];
  for (const sh of src.shapes) {
    const keep: number[] = [];
    order.forEach((v, i) => {
      const k = v * 3;
      if (Math.abs(sh.deltas[k]!) > SHAPE_EPSILON || Math.abs(sh.deltas[k + 1]!) > SHAPE_EPSILON || Math.abs(sh.deltas[k + 2]!) > SHAPE_EPSILON) keep.push(i);
    });
    if (keep.length === 0) continue;
    const deltas = new Float32Array(keep.length * 3);
    const normalDeltas = new Float32Array(keep.length * 3);
    keep.forEach((i, j) => {
      const v = order[i]! * 3;
      for (let k = 0; k < 3; k++) {
        deltas[j * 3 + k] = sh.deltas[v + k]!;
        normalDeltas[j * 3 + k] = sh.normals[v + k]!;
      }
    });
    shapes.push({ name: sh.name, indices: Uint32Array.from(keep), deltas, normalDeltas });
  }
  return { name, role, positions, normals, uvs, indices: out, materials: [material], joints, weights, shapes };
}

/** Turn per-vertex vectors with the linear part of each vertex's blended skinning matrix. */
function rotateBySkin(vectors: Float32Array, influences: InfluenceTable, skin: Float64Array): Float32Array {
  const out = new Float32Array(vectors.length);
  for (let v = 0; v < influences.vertexCount; v++) {
    const a = vectors[v * 3]!;
    const b = vectors[v * 3 + 1]!;
    const c = vectors[v * 3 + 2]!;
    if (a === 0 && b === 0 && c === 0) continue;
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const w = influences.weights[v * MAX_INFLUENCES + k]!;
      if (w === 0) continue;
      const m = influences.joints[v * MAX_INFLUENCES + k]! * 16;
      out[v * 3] = out[v * 3]! + w * (skin[m]! * a + skin[m + 4]! * b + skin[m + 8]! * c);
      out[v * 3 + 1] = out[v * 3 + 1]! + w * (skin[m + 1]! * a + skin[m + 5]! * b + skin[m + 9]! * c);
      out[v * 3 + 2] = out[v * 3 + 2]! + w * (skin[m + 2]! * a + skin[m + 6]! * b + skin[m + 10]! * c);
    }
  }
  return out;
}

function concat(name: string, role: MaterialRole, parts: ExportMesh[], material: number): ExportMesh {
  const nv = parts.reduce((s, p) => s + p.positions.length / 3, 0);
  const ni = parts.reduce((s, p) => s + p.indices.length, 0);
  const out: ExportMesh = {
    name,
    role,
    positions: new Float32Array(nv * 3),
    normals: new Float32Array(nv * 3),
    uvs: new Float32Array(nv * 2),
    indices: new Uint32Array(ni),
    materials: [material],
    joints: new Uint16Array(nv * MAX_INFLUENCES),
    weights: new Float32Array(nv * MAX_INFLUENCES),
    shapes: [],
  };
  // Blendshapes by name across the pieces (first-seen order), indices offset per piece.
  const shapeOrder: string[] = [];
  for (const p of parts) for (const sh of p.shapes) if (!shapeOrder.includes(sh.name)) shapeOrder.push(sh.name);
  {
    let base = 0;
    const offsets = parts.map((p) => {
      const o = base;
      base += p.positions.length / 3;
      return o;
    });
    for (const name of shapeOrder) {
      const pieces = parts.flatMap((p, i) => p.shapes.filter((sh) => sh.name === name).map((sh) => ({ sh, offset: offsets[i]! })));
      const count = pieces.reduce((s, x) => s + x.sh.indices.length, 0);
      const merged: ExportShape = { name, indices: new Uint32Array(count), deltas: new Float32Array(count * 3), normalDeltas: new Float32Array(count * 3) };
      let at = 0;
      for (const { sh, offset } of pieces) {
        for (let i = 0; i < sh.indices.length; i++) merged.indices[at + i] = sh.indices[i]! + offset;
        merged.deltas.set(sh.deltas, at * 3);
        if (sh.normalDeltas) merged.normalDeltas!.set(sh.normalDeltas, at * 3);
        at += sh.indices.length;
      }
      out.shapes.push(merged);
    }
  }
  let v0 = 0;
  let i0 = 0;
  for (const p of parts) {
    const n = p.positions.length / 3;
    out.positions.set(p.positions, v0 * 3);
    out.normals.set(p.normals, v0 * 3);
    out.uvs.set(p.uvs, v0 * 2);
    out.joints.set(p.joints, v0 * MAX_INFLUENCES);
    out.weights.set(p.weights, v0 * MAX_INFLUENCES);
    for (let i = 0; i < p.indices.length; i++) out.indices[i0 + i] = p.indices[i]! + v0;
    v0 += n;
    i0 += p.indices.length;
  }
  return out;
}

/** Multiply RGB by the tint colour and brightness (sRGB values, as the viewport shows them). */
function tint(img: RgbaImage, t: Tint): RgbaImage {
  const [r, g, b] = t.color;
  const k = t.brightness;
  if (r === 1 && g === 1 && b === 1 && k === 1) return img;
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    out.data[i] = img.data[i]! * r * k;
    out.data[i + 1] = img.data[i + 1]! * g * k;
    out.data[i + 2] = img.data[i + 2]! * b * k;
    out.data[i + 3] = img.data[i + 3]!;
  }
  return out;
}

/** The viewport's procedural garment grime (materials.ts), baked into the texture. */
function dirt(img: RgbaImage, amount: number): RgbaImage {
  if (amount <= 0) return img;
  const out = createImage(img.width, img.height);
  const grime = [0.55, 0.48, 0.4];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const u = (x + 0.5) / img.width;
      const v = 1 - (y + 0.5) / img.height;
      const s = Math.sin(Math.floor(u * 96) * 12.9898 + Math.floor(v * 96) * 78.233) * 43758.5453;
      const n = s - Math.floor(s);
      const f = amount * (0.55 + 0.45 * n);
      const i = (y * img.width + x) * 4;
      for (let k = 0; k < 3; k++) out.data[i + k] = img.data[i + k]! * (1 + (grime[k]! - 1) * f);
      out.data[i + 3] = img.data[i + 3]!;
    }
  }
  return out;
}

/** Remap alpha so a part's own cutout threshold lands on the shared material threshold. */
function remapAlpha(img: RgbaImage, own: number, shared: number): RgbaImage {
  if (own <= 0) {
    // Opaque parts (eyeballs): keep them solid.
    const out = createImage(img.width, img.height);
    out.data.set(img.data);
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
    return out;
  }
  if (Math.abs(own - shared) < 1e-3) return img;
  const out = createImage(img.width, img.height);
  out.data.set(img.data);
  for (let i = 3; i < out.data.length; i += 4) {
    const a = img.data[i]! / 255;
    const m = a < own ? (a / own) * shared : shared + ((a - own) / Math.max(1e-6, 1 - own)) * (1 - shared);
    out.data[i] = Math.round(m * 255);
  }
  return out;
}

function limit(img: RgbaImage, max: number): RgbaImage {
  if (img.width <= max && img.height <= max) return img;
  const k = max / Math.max(img.width, img.height);
  return resizeImage(img, Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
}

/** Local rest transform of a bone (FBX space): position, rotation quaternion (x, y, z, w), scale. */
function localTrs(bones: ExportBone[], b: ExportBone): { position: number[]; rotation: number[]; scale: number[] } {
  const g = Float64Array.from(b.bindGlobal);
  const local = b.parent >= 0 ? mul4(invertRigid(Float64Array.from(bones[b.parent]!.bindGlobal)), g) : g;
  return { position: [local[12]!, local[13]!, local[14]!], rotation: quaternion(local), scale: [1, 1, 1] };
}

function quaternion(m: Mat4): number[] {
  const m00 = m[0]!, m11 = m[5]!, m22 = m[10]!;
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (m[6]! - m[9]!) / s;
    y = (m[8]! - m[2]!) / s;
    z = (m[1]! - m[4]!) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m[6]! - m[9]!) / s;
    x = 0.25 * s;
    y = (m[4]! + m[1]!) / s;
    z = (m[8]! + m[2]!) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m[8]! - m[2]!) / s;
    x = (m[4]! + m[1]!) / s;
    y = 0.25 * s;
    z = (m[9]! + m[6]!) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m[1]! - m[4]!) / s;
    x = (m[8]! + m[2]!) / s;
    y = (m[9]! + m[6]!) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

/**
 * T-pose (PRD 6.2 option): rotate each upper arm so the arm points straight
 * out to the side (horizontal), keeping the rest of the skeleton as is.
 */
export function tPoseWorld(scene: CharacterScene): Float64Array {
  const sk = scene.engine.skeleton;
  const rig = sk.rig;
  const rotations: (Mat3 | null)[] = new Array(rig.boneCount).fill(null);
  for (const [bone, side] of [['upperarm_l', 1], ['upperarm_r', -1]] as const) {
    const i = rig.index.get(bone);
    if (i === undefined) continue;
    const h = sk.heads.subarray(i * 3, i * 3 + 3);
    const t = sk.tails.subarray(i * 3, i * 3 + 3);
    const d: Vec3 = [t[0]! - h[0]!, t[1]! - h[1]!, t[2]! - h[2]!];
    const len = Math.hypot(...d);
    const from: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
    // Out to the side the arm already points to (MakeHuman's +x is the character's left).
    const to: Vec3 = [Math.sign(from[0]) || side, 0, 0];
    const axis: Vec3 = [from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0]];
    const s = Math.hypot(...axis);
    if (s < 1e-9) continue;
    const angle = Math.atan2(s, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]);
    const q = axisAngle3([axis[0] / s, axis[1] / s, axis[2] / s], angle);
    // World rotation Q applied to the bone: local R = W^T Q W (rotations are applied in bone space).
    const w = sk.restWorld.subarray(i * 16, i * 16 + 16);
    const W = Float64Array.of(w[0]!, w[1]!, w[2]!, w[4]!, w[5]!, w[6]!, w[8]!, w[9]!, w[10]!);
    const Wt = Float64Array.of(W[0]!, W[3]!, W[6]!, W[1]!, W[4]!, W[7]!, W[2]!, W[5]!, W[8]!);
    rotations[i] = mul3(Wt, mul3(q, W));
  }
  return poseWorldMatrices(sk, rotations);
}
