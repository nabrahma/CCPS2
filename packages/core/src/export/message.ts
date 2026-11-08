/**
 * The binary export message sent to the Go backend (PRD 6.3 step 1), decoded
 * by app/backend/exportscene. Layout:
 *   "PS2CCEX1" | u32 header length | header JSON | pad to 8 | buffers (8-aligned)
 * The header must match the Go structs exactly (unknown fields are rejected).
 */
import type { ExportScene } from './scene';

export const EXPORT_MAGIC = 'PS2CCEX1';

interface BufRef {
  offset: number;
  length: number;
  type: 'f32' | 'u32' | 'u16' | 'u8';
}

/**
 * Encode a scene. `pngs` holds the encoded texture files (same order as
 * scene.textures); `glb` is the optional secondary output.
 */
export function encodeExportMessage(scene: ExportScene, pngs: Uint8Array[], creationTime: string, glb?: Uint8Array | null): Uint8Array {
  if (pngs.length !== scene.textures.length) throw new Error('one PNG per texture is required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const add = (type: BufRef['type'], view: ArrayBufferView): BufRef => {
    const pad = (8 - (size % 8)) % 8;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      size += pad;
    }
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    // Copy: the views may share buffers that keep changing.
    chunks.push(bytes.slice());
    const ref = { offset: size, length: bytes.byteLength, type };
    size += bytes.byteLength;
    return ref;
  };
  const header = {
    format: 'ps2cc.export/1',
    name: scene.name,
    creationTime,
    bones: scene.bones.map((b) => ({ name: b.name, parent: b.parent, bindGlobal: b.bindGlobal })),
    meshes: scene.meshes.map((m) => ({
      name: m.name,
      positions: add('f32', m.positions),
      normals: add('f32', m.normals),
      uvs: add('f32', m.uvs),
      indices: add('u32', m.indices),
      materials: m.materials,
      joints: add('u16', m.joints),
      weights: add('f32', m.weights),
      shapes: m.shapes.map((s) => ({
        name: s.name,
        indices: add('u32', s.indices),
        deltas: add('f32', s.deltas),
        ...(s.normalDeltas ? { normalDeltas: add('f32', s.normalDeltas) } : {}),
      })),
    })),
    materials: scene.materials.map((m) => ({ name: m.name, shader: m.shader, texture: m.texture, alphaClip: m.alphaClip, doubleSided: m.doubleSided, role: m.role })),
    textures: scene.textures.map((t, i) => ({ file: t.file, data: add('u8', pngs[i]!) })),
    sidecar: scene.sidecar,
    ...(glb ? { glb: add('u8', glb) } : {}),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const headLen = 12 + json.length;
  const start = Math.ceil(headLen / 8) * 8;
  const out = new Uint8Array(start + size);
  out.set(new TextEncoder().encode(EXPORT_MAGIC), 0);
  new DataView(out.buffer).setUint32(8, json.length, true);
  out.set(json, 12);
  let o = start;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** "YYYY-MM-DD HH:MM:SS:mmm" in local time (FBX header). */
export function fbxTime(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}:${p(d.getMilliseconds(), 3)}`;
}
