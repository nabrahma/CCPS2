/**
 * Deterministic GLB layout (PRD M9: "save -> load gives identical export,
 * byte-identical GLB"). Three.js' GLTFExporter appends each embedded image to
 * the binary chunk when its PNG encoding finishes, so the order of the image
 * buffer views (and every offset after them) changes from run to run. This
 * rewrites the binary chunk in a fixed order: the other buffer views first, in
 * their original order, then the images in image order, each 4-byte aligned.
 */

interface GltfJson {
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number; name?: string }[];
  accessors?: { bufferView?: number; sparse?: { indices: { bufferView: number }; values: { bufferView: number } } }[];
  images?: { bufferView?: number; mimeType?: string; uri?: string; name?: string }[];
  [key: string]: unknown;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

const pad4 = (n: number) => (n + 3) & ~3;

export function canonicalGlb(glb: Uint8Array): Uint8Array {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC || dv.getUint32(4, true) !== 2) throw new Error('not a glTF 2.0 binary');
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= glb.byteLength) {
    const len = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const data = glb.subarray(offset + 8, offset + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data).replace(/[\s\0]+$/, '')) as GltfJson;
    else if (type === CHUNK_BIN) bin = data;
    offset += 8 + len;
  }
  if (!json || !bin || !json.bufferViews || (json.buffers?.length ?? 0) !== 1) return glb;
  const views = json.bufferViews;
  const imageViews = new Set((json.images ?? []).map((im) => im.bufferView).filter((v): v is number => v !== undefined));
  if (imageViews.size === 0) return glb;

  // New order: non-image views as they were, then each image's view in image order.
  const order: number[] = views.map((_, i) => i).filter((i) => !imageViews.has(i));
  for (const im of json.images ?? []) if (im.bufferView !== undefined && !order.includes(im.bufferView)) order.push(im.bufferView);
  const remap = new Map<number, number>(order.map((old, i) => [old, i]));

  let size = 0;
  const placed = order.map((old) => {
    const v = views[old]!;
    const at = pad4(size);
    size = at + v.byteLength;
    return { old, at };
  });
  const out = new Uint8Array(pad4(size));
  const newViews = placed.map(({ old, at }) => {
    const v = views[old]!;
    out.set(bin!.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), at);
    return { ...v, byteOffset: at };
  });
  json.bufferViews = newViews;
  for (const a of json.accessors ?? []) {
    if (a.bufferView !== undefined) a.bufferView = remap.get(a.bufferView)!;
    if (a.sparse) {
      a.sparse.indices.bufferView = remap.get(a.sparse.indices.bufferView)!;
      a.sparse.values.bufferView = remap.get(a.sparse.values.bufferView)!;
    }
  }
  for (const im of json.images ?? []) if (im.bufferView !== undefined) im.bufferView = remap.get(im.bufferView)!;
  json.buffers![0]!.byteLength = out.byteLength;

  // Reassemble: JSON chunk padded with spaces, BIN chunk with zeros.
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLen + 8 + out.byteLength;
  const glbOut = new Uint8Array(total);
  const w = new DataView(glbOut.buffer);
  w.setUint32(0, GLB_MAGIC, true);
  w.setUint32(4, 2, true);
  w.setUint32(8, total, true);
  w.setUint32(12, jsonLen, true);
  w.setUint32(16, CHUNK_JSON, true);
  glbOut.set(jsonBytes, 20);
  glbOut.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  w.setUint32(20 + jsonLen, out.byteLength, true);
  w.setUint32(24 + jsonLen, CHUNK_BIN, true);
  glbOut.set(out, 28 + jsonLen);
  return glbOut;
}
