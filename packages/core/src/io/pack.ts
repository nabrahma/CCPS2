/**
 * Builds a binary container in memory (the layout of
 * tools/asset-compiler/ps2cc_assets/binfmt.py): typed buffers on 16-byte
 * boundaries, and a JSON document describing them.
 */
import type { BufferSpec, ContainerMeta, DType } from './container';

const ALIGN = 16;

export class ContainerBuilder {
  private chunks: Uint8Array[] = [];
  private size = 0;
  readonly buffers: Record<string, BufferSpec> = {};

  add(name: string, data: ArrayLike<number>, dtype: Exclude<DType, 'i32'>): void {
    if (this.buffers[name]) throw new Error(`duplicate buffer ${name}`);
    const arr =
      dtype === 'f32'
        ? Float32Array.from(data)
        : dtype === 'u32'
          ? Uint32Array.from(data)
          : dtype === 'u16'
            ? Uint16Array.from(data)
            : dtype === 'i16'
              ? Int16Array.from(data)
              : Uint8Array.from(data);
    if (dtype === 'f32' && !(arr as Float32Array).every(Number.isFinite)) throw new Error(`${name} has NaN/Inf`);
    const pad = (ALIGN - (this.size % ALIGN)) % ALIGN;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.size += pad;
    }
    this.buffers[name] = { offset: this.size, dtype, count: arr.length };
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    this.chunks.push(bytes);
    this.size += bytes.byteLength;
  }

  /** The binary file, and the JSON document fields that describe it. */
  finish(binaryName: string): { bin: Uint8Array<ArrayBuffer>; table: ContainerMeta } {
    const bin = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) {
      bin.set(c, o);
      o += c.byteLength;
    }
    return { bin, table: { binary: binaryName, byteLength: this.size, buffers: this.buffers } };
  }
}
