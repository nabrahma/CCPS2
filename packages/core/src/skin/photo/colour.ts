/**
 * sRGB <-> CIELAB (D65) and the colour transfer used to match the projected
 * photo to the base skin (PRD F7 step 5: "match colour (mean and standard
 * deviation in LAB) between the photo border and the skin").
 */

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const XN = 0.95047;
const YN = 1;
const ZN = 1.08883;
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

const fLab = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > EPS ? t ** 3 : (116 * t - 16) / KAPPA);

/** 0..255 sRGB to L*a*b*. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = toLinear(r / 255);
  const G = toLinear(g / 255);
  const B = toLinear(b / 255);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN;
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / YN;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / ZN;
  const fx = fLab(x);
  const fy = fLab(y);
  const fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** L*a*b* to 0..255 sRGB (clamped). */
export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = fInv(fx) * XN;
  const y = (L > KAPPA * EPS ? fy ** 3 : L / KAPPA) * YN;
  const z = fInv(fz) * ZN;
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  const out = (c: number) => Math.round(Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, c))))) * 255);
  return [out(R), out(G), out(B)];
}

export interface LabStats {
  mean: [number, number, number];
  std: [number, number, number];
  count: number;
}

/** Weighted mean and standard deviation of LAB samples (flat array, 3 per sample). */
export function labStats(lab: ArrayLike<number>, weights?: ArrayLike<number>): LabStats {
  const n = lab.length / 3;
  const mean: [number, number, number] = [0, 0, 0];
  const std: [number, number, number] = [0, 0, 0];
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i]! : 1;
    wsum += w;
    for (let k = 0; k < 3; k++) mean[k] = mean[k]! + w * lab[i * 3 + k]!;
  }
  if (wsum <= 0) return { mean, std: [1, 1, 1], count: 0 };
  for (let k = 0; k < 3; k++) mean[k] = mean[k]! / wsum;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i]! : 1;
    for (let k = 0; k < 3; k++) std[k] = std[k]! + w * (lab[i * 3 + k]! - mean[k]!) ** 2;
  }
  for (let k = 0; k < 3; k++) std[k] = Math.sqrt(std[k]! / wsum);
  return { mean, std, count: n };
}

/** Per-channel transfer: (x - mean_src) * (std_dst / std_src) + mean_dst, spread ratio limited to [0.5, 2]. */
export function labTransfer(from: LabStats, to: LabStats): (lab: [number, number, number]) => [number, number, number] {
  const ratio = from.std.map((s, k) => Math.min(2, Math.max(0.5, to.std[k]! / Math.max(1e-3, s)))) as [number, number, number];
  return (lab) => [0, 1, 2].map((k) => (lab[k]! - from.mean[k]!) * ratio[k]! + to.mean[k]!) as [number, number, number];
}
