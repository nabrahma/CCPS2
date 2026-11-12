import { describe, expect, it } from 'vitest';
import { CAMERA_PRESETS, DEFAULT_POST, LIGHTING_PRESETS, PS2_POST } from '../src/presets';

describe('viewport presets (PRD F9, Part 2 F14)', () => {
  it('has Part 1 lighting presets and the four Part 2 looks, with sane values', () => {
    expect(Object.keys(LIGHTING_PRESETS).sort()).toEqual(
      ['flashlight', 'foggyTown', 'interiorFlashlight', 'night', 'overcast', 'studio', 'studioPortrait', 'villageOvercast'],
    );
    for (const p of Object.values(LIGHTING_PRESETS)) {
      const l = p.lights;
      expect(l.key !== null || l.spot !== null).toBe(true);
      for (const c of [...l.sky, ...l.ground, ...p.background, ...l.rim.color]) expect(c).toBeGreaterThanOrEqual(0);
      if (l.spot) expect(l.spot.cosInner).toBeGreaterThan(l.spot.cosOuter);
      if (p.fog) expect(p.fog.far).toBeGreaterThan(p.fog.near);
    }
    // Part 1's presets keep a flat ambient and no grade, so they render exactly as before.
    for (const id of ['studio', 'flashlight', 'overcast', 'night'] as const) {
      const p = LIGHTING_PRESETS[id];
      expect(p.lights.sky).toEqual(p.lights.ground);
      expect(p.lights.fill).toBeNull();
      expect(p.fog).toBeNull();
      expect(p.grade.tonemap).toBe('none');
      expect(p.grade.lut).toBeNull();
    }
    // The flashlight looks are a spot from the camera in a dark room.
    for (const id of ['flashlight', 'interiorFlashlight'] as const) {
      expect(LIGHTING_PRESETS[id].lights.spot).not.toBeNull();
      expect(Math.max(...LIGHTING_PRESETS[id].lights.sky)).toBeLessThan(0.1);
    }
  });

  it('has the camera presets framing inside the character', () => {
    expect(Object.keys(CAMERA_PRESETS)).toEqual(['full', 'bust', 'face', 'threeQuarter', 'profile', 'back']);
    for (const c of Object.values(CAMERA_PRESETS)) {
      expect(c.targetHeight).toBeGreaterThan(0);
      expect(c.targetHeight).toBeLessThan(1);
      expect(c.span).toBeGreaterThan(0);
    }
  });

  it('keeps PS1 effects and depth of field off by default, even in the PS2 look', () => {
    for (const p of [DEFAULT_POST, PS2_POST]) {
      expect(p.affine).toBe(false);
      expect(p.vertexSnap).toBe(false);
      expect(p.dof.enabled).toBe(false);
    }
    expect(PS2_POST.lowRes && PS2_POST.dither16).toBe(true);
  });
});
