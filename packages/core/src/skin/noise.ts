/**
 * Deterministic 3D noise for procedural skin layers. Layers are functions of
 * the neutral surface position, so patterns run continuously across UV seams.
 * Integer hashing only (no Math.random), so a seed always gives the same image.
 */

/** 32-bit integer hash of a lattice point and seed, in [0, 1). */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Trilinear value noise in [0, 1) with smooth interpolation. */
export function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = fade(x - xi);
  const ty = fade(y - yi);
  const tz = fade(z - zi);
  const c000 = hash3(xi, yi, zi, seed);
  const c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed);
  const c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed);
  const c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/** Fractal value noise (octaves halve in size and amplitude), normalised to [0, 1). */
export function fbm(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f, z * f, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/**
 * Round spots on a jittered grid (one candidate per cell of size 1):
 * returns the strongest spot coverage at (x, y, z) in [0, 1]. A cell holds a
 * spot with probability `density`; its radius is `radius * (0.6 .. 1.2)`.
 */
export function spots(x: number, y: number, z: number, seed: number, density: number, radius: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let best = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const cz = zi + dz;
        if (hash3(cx, cy, cz, seed) >= density) continue;
        const px = cx + hash3(cx, cy, cz, seed + 1);
        const py = cy + hash3(cx, cy, cz, seed + 2);
        const pz = cz + hash3(cx, cy, cz, seed + 3);
        const r = radius * (0.6 + 0.6 * hash3(cx, cy, cz, seed + 4));
        const d = Math.hypot(x - px, y - py, z - pz);
        if (d < r) best = Math.max(best, 1 - smoothstep(r * 0.45, r, d));
      }
    }
  }
  return best;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
