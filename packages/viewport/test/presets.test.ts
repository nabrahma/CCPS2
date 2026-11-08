import { describe, expect, it } from 'vitest';
import { CAMERA_PRESETS, DEFAULT_POST, LIGHTING_PRESETS, PS2_POST } from '../src/presets';

describe('viewport presets (PRD F9)', () => {
  it('has the four lighting presets with sane values', () => {
    expect(Object.keys(LIGHTING_PRESETS).sort()).toEqual(['flashlight', 'night', 'overcast', 'studio']);
    for (const p of Object.values(LIGHTING_PRESETS)) {
      expect(p.key !== null || p.spot !== null).toBe(true);
      for (const c of [...p.ambient, ...p.background, ...p.rim.color]) expect(c).toBeGreaterThanOrEqual(0);
      if (p.spot) expect(p.spot.cosInner).toBeGreaterThan(p.spot.cosOuter);
    }
    // The flashlight preset is a spot from the camera in a dark room.
    expect(LIGHTING_PRESETS.flashlight.spot).not.toBeNull();
    expect(Math.max(...LIGHTING_PRESETS.flashlight.ambient)).toBeLessThan(0.1);
  });

  it('has the five camera presets framing inside the character', () => {
    expect(Object.keys(CAMERA_PRESETS)).toEqual(['full', 'bust', 'face', 'threeQuarter', 'profile']);
    for (const c of Object.values(CAMERA_PRESETS)) {
      expect(c.targetHeight).toBeGreaterThan(0);
      expect(c.targetHeight).toBeLessThan(1);
      expect(c.span).toBeGreaterThan(0);
    }
  });

  it('keeps PS1 effects off by default, even in the PS2 look', () => {
    for (const p of [DEFAULT_POST, PS2_POST]) {
      expect(p.affine).toBe(false);
      expect(p.vertexSnap).toBe(false);
    }
    expect(PS2_POST.lowRes && PS2_POST.dither16).toBe(true);
  });
});
