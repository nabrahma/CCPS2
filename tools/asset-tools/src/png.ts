/**
 * Minimal PNG codec for build-time tools (no dependencies): an RGBA encoder
 * with a line rasteriser for review images, and a decoder for 8-bit
 * non-interlaced images (texture alpha for hidden-face coverage).
 */
import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export class Canvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: [number, number, number] = [16, 16, 18],
  ) {
    this.data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) this.data.set([...background, 255], i * 4);
  }

  plot(x: number, y: number, c: [number, number, number], alpha = 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    for (let k = 0; k < 3; k++) this.data[i + k] = Math.round(this.data[i + k]! * (1 - alpha) + c[k]! * alpha);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: [number, number, number], alpha = 1): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 100000; guard++) {
      this.plot(x0, y0, c, alpha);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  toPng(): Uint8Array {
    const raw = new Uint8Array((this.width * 4 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 4 + 1)] = 0;
      raw.set(this.data.subarray(y * this.width * 4, (y + 1) * this.width * 4), y * (this.width * 4 + 1) + 1);
    }
    const ihdr = new Uint8Array(13);
    const v = new DataView(ihdr.buffer);
    v.setUint32(0, this.width);
    v.setUint32(4, this.height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
    const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, rows top to bottom. */
  rgba: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decode an 8-bit, non-interlaced PNG (grey, grey+alpha, RGB, RGBA or palette). */
export function decodePng(file: Uint8Array): DecodedImage {
  if (!SIGNATURE.every((b, i) => file[i] === b)) throw new Error('not a PNG');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let width = 0;
  let height = 0;
  let colourType = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < file.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const data = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = data[8]!;
      colourType = data[9]!;
      if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported`);
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported');
      if (!(colourType in CHANNELS)) throw new Error(`PNG colour type ${colourType} is not supported`);
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = CHANNELS[colourType]!;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('truncated PNG data');
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels]! : 0;
      const b = prev ? prev[x]! : 0;
      const c = prev && x >= channels ? prev[x - channels]! : 0;
      let v = line[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      out[x] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r: number, g: number, b: number, alpha = 255;
    if (colourType === 3) {
      const k = pixels[s]!;
      if (!palette) throw new Error('palette PNG without PLTE');
      r = palette[k * 3]!;
      g = palette[k * 3 + 1]!;
      b = palette[k * 3 + 2]!;
      if (transparency && k < transparency.length) alpha = transparency[k]!;
    } else if (colourType === 0 || colourType === 4) {
      r = g = b = pixels[s]!;
      if (colourType === 4) alpha = pixels[s + 1]!;
    } else {
      r = pixels[s]!;
      g = pixels[s + 1]!;
      b = pixels[s + 2]!;
      if (colourType === 6) alpha = pixels[s + 3]!;
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = alpha;
  }
  return { width, height, rgba };
}
