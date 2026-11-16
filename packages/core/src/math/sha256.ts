/**
 * SHA-256 (FIPS 180-4) in plain TypeScript, synchronous, for the determinism
 * hash tests (PRD Part 3, 0.2 rule 5): the same code hashes generator output
 * in Node and in the app's WebView.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
  0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
  0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e,
  0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  private readonly h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private fill = 0;
  private length = 0;

  update(data: Uint8Array): this {
    this.length += data.length;
    let i = 0;
    while (i < data.length) {
      const take = Math.min(64 - this.fill, data.length - i);
      this.block.set(data.subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === 64) {
        this.compress();
        this.fill = 0;
      }
    }
    return this;
  }

  /** The bytes of a typed array, little-endian as stored (every supported platform is little-endian). */
  updateArray(data: Float64Array | Float32Array | Uint32Array | Uint16Array | Int16Array | Int32Array | Uint8Array): this {
    return this.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  updateText(text: string): this {
    const bytes = new Uint8Array(text.length * 3);
    let n = 0;
    for (let i = 0; i < text.length; i++) {
      let c = text.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
        c = 0x10000 + ((c - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00);
        bytes[n++] = 0xf0 | (c >> 18);
        bytes[n++] = 0x80 | ((c >> 12) & 63);
        bytes[n++] = 0x80 | ((c >> 6) & 63);
        bytes[n++] = 0x80 | (c & 63);
        continue;
      }
      if (c < 0x80) bytes[n++] = c;
      else if (c < 0x800) {
        bytes[n++] = 0xc0 | (c >> 6);
        bytes[n++] = 0x80 | (c & 63);
      } else {
        bytes[n++] = 0xe0 | (c >> 12);
        bytes[n++] = 0x80 | ((c >> 6) & 63);
        bytes[n++] = 0x80 | (c & 63);
      }
    }
    return this.update(bytes.subarray(0, n));
  }

  hex(): string {
    const bits = this.length * 8;
    const pad = new Uint8Array(((this.fill + 9 + 63) & ~63) - this.fill);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, Math.floor(bits / 4294967296), false);
    view.setUint32(pad.length - 4, bits >>> 0, false);
    const total = this.length;
    this.update(pad);
    this.length = total;
    let out = '';
    for (let i = 0; i < 8; i++) out += this.h[i]!.toString(16).padStart(8, '0');
    return out;
  }

  private compress(): void {
    const w = this.w;
    const b = this.block;
    for (let i = 0; i < 16; i++) w[i] = (b[i * 4]! << 24) | (b[i * 4 + 1]! << 16) | (b[i * 4 + 2]! << 8) | b[i * 4 + 3]!;
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, bb, c, d, e, f, g, h] = this.h as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const s1 = ((e! >>> 6) | (e! << 26)) ^ ((e! >>> 11) | (e! << 21)) ^ ((e! >>> 25) | (e! << 7));
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (h! + s1 + ch + K[i]! + w[i]!) | 0;
      const s0 = ((a! >>> 2) | (a! << 30)) ^ ((a! >>> 13) | (a! << 19)) ^ ((a! >>> 22) | (a! << 10));
      const maj = (a! & bb!) ^ (a! & c!) ^ (bb! & c!);
      const t2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d! + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    this.h[0] = (this.h[0]! + a!) | 0;
    this.h[1] = (this.h[1]! + bb!) | 0;
    this.h[2] = (this.h[2]! + c!) | 0;
    this.h[3] = (this.h[3]! + d!) | 0;
    this.h[4] = (this.h[4]! + e!) | 0;
    this.h[5] = (this.h[5]! + f!) | 0;
    this.h[6] = (this.h[6]! + g!) | 0;
    this.h[7] = (this.h[7]! + h!) | 0;
  }
}

export function sha256Hex(data: Uint8Array): string {
  return new Sha256().update(data).hex();
}
