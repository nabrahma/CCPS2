/**
 * Garment Studio edits kept in the character (D-151). A garment reshaped in
 * Garment Studio is bound to the reference body like an imported garment (so
 * it fits every body shape) and stored inside the character document instead
 * of the library: no new garment on disk, one undo step, saved with the
 * character and gone if the character is not saved.
 *
 * The edit's id ("edit:…") stands in for the garment's asset id wherever the
 * garment is worn; the asset store registers it like a library garment, so the
 * scene, looks, hidden body faces and export need nothing new.
 */
import { Container } from '../io/container';
import type { GarmentEdit } from '../character/doc';
import { ProxyAsset, type ProxyMeta } from './proxy';
import type { ImportedGarment } from './garment-import';

export const EDIT_PREFIX = 'edit:';

export function isGarmentEdit(id: string): boolean {
  return id.startsWith(EDIT_PREFIX);
}

/** Bytes to base64 (chunked, so large buffers do not overflow the call stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The edit to store for a garment bound by the import pipeline, made from library garment `base`. */
export function garmentEditFrom(id: string, base: string, garment: ImportedGarment, name: string): GarmentEdit {
  const meta = { ...structuredClone(garment.meta), id, name, tags: ['edited'] } as ProxyMeta;
  return { base, meta: meta as unknown as Record<string, unknown>, bin: bytesToBase64(garment.bin) };
}

/** Decode a stored edit into the garment it describes. */
export function proxyFromEdit(edit: GarmentEdit): ProxyAsset {
  const bytes = base64ToBytes(edit.bin);
  return new ProxyAsset(new Container(edit.meta as unknown as ProxyMeta, bytes.buffer));
}

/** Triangles of a stored edit, from its header. */
export function editTriangleCount(edit: GarmentEdit): number {
  const m = edit.meta as { faceCount?: number; triangleFaces?: number };
  return (m.faceCount ?? 0) * 2 - (m.triangleFaces ?? 0);
}
