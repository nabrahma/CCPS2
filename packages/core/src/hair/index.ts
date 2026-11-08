import startersJson from '../data/hair_styles.json';
import { sanitiseStyle, type HairStyleParams } from './style';

export * from './atlas';
export * from './binding';
export * from './generate';
export * from './headproxy';
export * from './scalp';
export * from './style';

export interface StarterStyle {
  id: string;
  style: HairStyleParams;
}

/** The 8 starter hairstyles (PRD F5 step 8). */
export const STARTER_STYLES: readonly StarterStyle[] = (startersJson as unknown as { styles: { id: string; style: unknown }[] }).styles.map(
  (s) => ({ id: s.id, style: sanitiseStyle(s.style) }),
);

export function starterStyle(id: string): HairStyleParams {
  const s = STARTER_STYLES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown starter hairstyle ${id}`);
  return structuredClone(s.style);
}
export * from './hairline-paint';
