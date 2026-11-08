/**
 * Reader for the asset compiler's binary container (see
 * tools/asset-compiler/ps2cc_assets/binfmt.py): a JSON document with a
 * `buffers` table pointing into a little-endian `.bin` file.
 */

export type DType = 'f32' | 'u32' | 'u16' | 'i16' | 'i32' | 'u8';

export interface BufferSpec {
  offset: number;
  dtype: DType;
  count: number;
}

export interface ContainerMeta {
  binary: string;
  byteLength: number;
  buffers: Record<string, BufferSpec>;
}

export type TypedArrayFor<T extends DType> = T extends 'f32'
  ? Float32Array
  : T extends 'u32'
    ? Uint32Array
    : T extends 'u16'
      ? Uint16Array
      : T extends 'i16'
        ? Int16Array
        : T extends 'i32'
          ? Int32Array
          : Uint8Array;

const CTORS = {
  f32: Float32Array,
  u32: Uint32Array,
  u16: Uint16Array,
  i16: Int16Array,
  i32: Int32Array,
  u8: Uint8Array,
} as const;

export class Container<M extends ContainerMeta = ContainerMeta> {
  constructor(
    readonly meta: M,
    private readonly data: ArrayBuffer,
  ) {
    if (data.byteLength < meta.byteLength) {
      throw new Error(`container ${meta.binary}: expected ${meta.byteLength} bytes, got ${data.byteLength}`);
    }
  }

  has(name: string): boolean {
    return name in this.meta.buffers;
  }

  get<T extends DType>(name: string, dtype: T): TypedArrayFor<T> {
    const spec = this.meta.buffers[name];
    if (!spec) throw new Error(`container ${this.meta.binary}: missing buffer "${name}"`);
    if (spec.dtype !== dtype) {
      throw new Error(`container ${this.meta.binary}: buffer "${name}" is ${spec.dtype}, expected ${dtype}`);
    }
    const Ctor = CTORS[dtype];
    return new Ctor(this.data, spec.offset, spec.count) as TypedArrayFor<T>;
  }

  /** Like get() but returns an empty array when the buffer is absent. */
  optional<T extends DType>(name: string, dtype: T): TypedArrayFor<T> {
    if (!this.has(name)) return new CTORS[dtype](0) as TypedArrayFor<T>;
    return this.get(name, dtype);
  }
}
