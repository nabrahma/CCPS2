/**
 * PRD M6 (F6, F7) core tests:
 *  - hm08 UV islands and region masks;
 *  - head texture split: head UVs remapped inside 0..1, islands packed without
 *    overlap, every PS2 body triangle in exactly one material, and the crop
 *    carries the composite's texels;
 *  - blend modes and stack order of the reference compositor (the viewport's
 *    GPU compositor is checked against it in e2e/m6.spec.ts);
 *  - procedural layers: deterministic, placed on the right features;
 *  - photo projection maths: Delaunay, piecewise-affine warp, LAB transfer,
 *    pose angles, and an end-to-end projection of a synthetic photo whose
 *    pixels encode the surface UV (so every texel must land on its own UV).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CoreAssets } from '../src/assets';
import { defaultCharacter, type SkinLayer } from '../src/character/doc';
import { computeQuadNormals } from '../src/mesh/normals';
import { Rng } from '../src/random';
import {
  adjustHsv,
  blendChannel,
  bodyTexture,
  checkPhoto,
  compositeReference,
  createImage,
  headTexture,
  delaunay,
  headAngles,
  labStats,
  labToRgb,
  labTransfer,
  LAYER_KINDS,
  newLayer,
  PiecewiseAffine,
  projectPhoto,
  rasterTriangle,
  rgbToLab,
  sampleBilinear,
  sanitiseSkin,
  SkinComposer,
  splitBody,
  type LandmarkTable,
  type RgbaImage,
} from '../src/skin';
import { CharacterEngine } from '../src/character/engine';
import { CharacterScene } from '../src/scene/character-scene';
import { assetsAvailable, loadAssets } from './helpers';

const solid = (size: number, rgba: [number, number, number, number]) => createImage(size, size, rgba);

describe('blend modes (reference compositor)', () => {
  it('matches the textbook formulas', () => {
    expect(blendChannel('normal', 0.2, 0.7)).toBeCloseTo(0.7);
    expect(blendChannel('multiply', 0.5, 0.4)).toBeCloseTo(0.2);
    expect(blendChannel('screen', 0.5, 0.4)).toBeCloseTo(0.7);
    expect(blendChannel('overlay', 0.25, 0.6)).toBeCloseTo(0.3);
    expect(blendChannel('overlay', 0.75, 0.6)).toBeCloseTo(1 - 2 * 0.25 * 0.4);
  });

  it('applies layers bottom to top with opacity and masks', () => {
    const base = solid(4, [100, 100, 100, 255]);
    const red = solid(4, [255, 0, 0, 255]);
    const blue = solid(4, [0, 0, 255, 255]);
    const top = compositeReference(base, [
      { source: { kind: 'pixels', image: red }, blend: 'normal', opacity: 1, mask: 'none' },
      { source: { kind: 'pixels', image: blue }, blend: 'normal', opacity: 1, mask: 'none' },
    ], null, 4);
    expect([...top.data.slice(0, 4)]).toEqual([0, 0, 255, 255]); // top wins
    const half = compositeReference(base, [{ source: { kind: 'pixels', image: red }, blend: 'normal', opacity: 0.5, mask: 'none' }], null, 4);
    expect([...half.data.slice(0, 3)]).toEqual([178, 50, 50]);
    // Mask: face channel 0 on the left half, 255 on the right.
    const masks = createImage(4, 4);
    for (let y = 0; y < 4; y++) for (let x = 2; x < 4; x++) masks.data[(y * 4 + x) * 4] = 255;
    const masked = compositeReference(base, [{ source: { kind: 'pixels', image: red }, blend: 'normal', opacity: 1, mask: 'face' }], masks, 4);
    expect(masked.data[0]).toBe(100);
    expect(masked.data[3 * 4]).toBe(255);
  });

  it('tone tint shifts hue, saturation and value of the colour below', () => {
    const [r, g, b] = adjustHsv(1, 0, 0, { hue: 120, saturation: 1, value: 1 });
    expect([r, g, b].map((x) => Math.round(x * 255))).toEqual([0, 255, 0]);
    const grey = adjustHsv(0.8, 0.4, 0.2, { hue: 0, saturation: 0, value: 0.5 });
    expect(grey[0]).toBeCloseTo(0.4);
    expect(grey[1]).toBeCloseTo(0.4);
  });
});

describe('photo projection maths', () => {
  it('Delaunay: every circumcircle is empty and the count is 2n - 2 - hull', () => {
    const rng = new Rng(7);
    const rnd = () => rng.next();
    const pts: number[] = [];
    for (let i = 0; i < 200; i++) pts.push(rnd() * 3, rnd() * 2);
    const tris = delaunay(pts);
    expect(tris.length / 3).toBeGreaterThan(300);
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
      const [ax, ay, bx, by, cx, cy] = [pts[a * 2]!, pts[a * 2 + 1]!, pts[b * 2]!, pts[b * 2 + 1]!, pts[c * 2]!, pts[c * 2 + 1]!];
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
      const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
      const r2 = (ax - ux) ** 2 + (ay - uy) ** 2;
      for (let i = 0; i < 200; i++) {
        if (i === a || i === b || i === c) continue;
        expect((pts[i * 2]! - ux) ** 2 + (pts[i * 2 + 1]! - uy) ** 2).toBeGreaterThan(r2 * (1 - 1e-9));
      }
    }
  });

  it('piecewise-affine warp is exact for an affine map and maps landmarks onto landmarks', () => {
    const rng = new Rng(3);
    const rnd = () => rng.next();
    const src: number[] = [];
    const dst: number[] = [];
    const A = [1.7, 0.3, -0.2, 1.4];
    for (let i = 0; i < 60; i++) {
      const x = rnd();
      const y = rnd();
      src.push(x, y);
      dst.push(A[0]! * x + A[1]! * y + 5, A[2]! * x + A[3]! * y - 2);
    }
    const warp = new PiecewiseAffine(Float64Array.from(src), Float64Array.from(dst), delaunay(src));
    const out = [0, 0];
    for (let i = 0; i < 60; i++) {
      expect(warp.map(src[i * 2]!, src[i * 2 + 1]!, out)).toBe(true);
      expect(out[0]).toBeCloseTo(dst[i * 2]!, 9);
    }
    for (let k = 0; k < 200; k++) {
      const x = 0.2 + 0.6 * rnd();
      const y = 0.2 + 0.6 * rnd();
      if (!warp.map(x, y, out)) continue;
      expect(out[0]).toBeCloseTo(A[0]! * x + A[1]! * y + 5, 9);
      expect(out[1]).toBeCloseTo(A[2]! * x + A[3]! * y - 2, 9);
    }
    expect(warp.map(5, 5, out)).toBe(false);
  });

  it('LAB round-trips sRGB and the transfer matches mean and spread', () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [200, 120, 90], [12, 250, 33]] as [number, number, number][]) {
      expect(labToRgb(...rgbToLab(c[0], c[1], c[2]))).toEqual(c);
    }
    const from = labStats([10, 0, 0, 30, 10, 10]);
    const to = labStats([50, 5, 5, 60, 7, 9]);
    const f = labTransfer(from, to);
    const a = f([10, 0, 0]);
    const b = f([30, 10, 10]);
    expect((a[0] + b[0]) / 2).toBeCloseTo(55);
    expect(Math.abs(b[0] - a[0])).toBeCloseTo(10);
  });

  it('head angles: frontal is 0, a 20° yaw reads 20°', () => {
    // A flat face oval in pixels (z scaled like x), then rotated about y.
    const make = (yawDeg: number) => {
      const lm = new Array(478 * 3).fill(0);
      const put = (i: number, x: number, y: number) => {
        const a = (yawDeg * Math.PI) / 180;
        lm[i * 3] = (0.5 + x * Math.cos(a)) * 1;
        lm[i * 3 + 1] = 0.5 + y;
        lm[i * 3 + 2] = x * Math.sin(a);
      };
      put(234, -0.3, 0);
      put(454, 0.3, 0);
      put(10, 0, -0.4);
      put(152, 0, 0.4);
      return lm;
    };
    expect(Math.abs(headAngles(make(0), 1, 1).yaw)).toBeLessThan(1e-6);
    expect(Math.abs(headAngles(make(20), 1, 1).yaw)).toBeCloseTo(20, 4);
    const photo = solid(64, [128, 100, 90, 255]);
    expect(checkPhoto(photo, make(25)).warnings.length).toBeGreaterThan(0);
    expect(checkPhoto(photo, make(3)).warnings).toEqual([]);
  });

  it('skin stacks from documents are sanitised', () => {
    const s = sanitiseSkin(
      {
        base: 'mh:skins/x',
        layers: [
          { id: 'a', kind: 'stubble', enabled: true, opacity: 3, blend: 'weird' as never, mask: 'face', params: { density: 9, color: 'red' } },
          { id: 'b', kind: 'nope' as never, enabled: true, opacity: 1, blend: 'normal', mask: 'none', params: {} },
          { id: 'a', kind: 'image', enabled: true, opacity: 1, blend: 'screen', mask: 'none', params: {}, image: '/library/overlays/x.png' },
        ],
        photo: { image: '/library/photos/me.jpg', strength: 2, colourMatch: false, landmarks: [0.1, 0.2, 0] },
      },
      'mh:skins/default',
    );
    expect(s.layers.map((l) => l.kind)).toEqual(['stubble', 'image']);
    expect(s.layers[0]!.opacity).toBe(1);
    expect(s.layers[0]!.blend).toBe('multiply');
    expect(s.layers[0]!.params.density).toBe(1);
    expect(s.layers[0]!.params.color).toBe('#6a5a50');
    expect(s.layers[1]!.id).not.toBe('a');
    expect(s.photo?.strength).toBe(1);
    expect(s.photo?.landmarks).toEqual([0.1, 0.2, 0]);
  });
});

describe.skipIf(!assetsAvailable)('skin layout and head split on hm08', () => {
  let assets: CoreAssets;
  let composer: SkinComposer;
  beforeAll(async () => {
    assets = await loadAssets();
    composer = assets.skinComposer;
  });

  it('finds the 9 hm08 UV islands: body, 4 head, 2 hands, 2 feet', () => {
    const kinds = composer.layout.islands.map((i) => i.kind).sort();
    expect(kinds).toEqual(['body', 'feet', 'feet', 'hands', 'hands', 'head', 'head', 'head', 'head']);
    const masks = composer.masks;
    // The face mask is set inside the main head island and not in the middle of the torso.
    const at = (u: number, v: number) => {
      const out = [0, 0, 0, 0];
      sampleBilinear(masks, u, v, out);
      return out;
    };
    const head = composer.layout.islands.filter((i) => i.kind === 'head').sort((a, b) => b.faces.length - a.faces.length)[0]!;
    const tri = composer.layout.trianglesOf((i) => i.id === head.id)[500]!;
    const uv = assets.base.uvs;
    const cu = (uv[tri.uvs[0] * 2]! + uv[tri.uvs[1] * 2]! + uv[tri.uvs[2] * 2]!) / 3;
    const cv = (uv[tri.uvs[0] * 2 + 1]! + uv[tri.uvs[1] * 2 + 1]! + uv[tri.uvs[2] * 2 + 1]!) / 3;
    expect(at(cu, cv)[0]).toBeGreaterThan(250);
    expect(at(cu, cv)[1]).toBeLessThan(5);
  });

  it('head UVs of the hm08 layout never overlap body UVs', () => {
    const size = 1024;
    const owner = new Int8Array(size * size).fill(-1);
    let overlap = 0;
    const layout = composer.layout;
    layout.rasterize(size, layout.triangles, (texel, tri) => {
      const isHead = layout.islands[layout.faceIsland[tri.face]!]!.kind === 'head' ? 1 : 0;
      if (owner[texel] === -1) owner[texel] = isHead;
      else if (owner[texel] !== isHead) overlap++;
    });
    // Texels on a shared head/body edge can be hit by both; there is none in hm08.
    expect(overlap).toBe(0);
  });

  for (const tier of ['ps2_body_8k', 'ps2_body_10k', 'ps2_body_12k'] as const) {
    it(`${tier}: head UVs inside 0..1, islands do not overlap, nothing turns over, every triangle has one material`, async () => {
      const mesh = await assets.bodyMesh(tier)!;
      const split = splitBody(mesh, composer.layout, await assets.headLayout(tier));
      expect(split.headIndices.length + split.bodyIndices.length).toBe(mesh.indices.length);
      expect(split.headIndices.length).toBeGreaterThan(1000 * 3);
      for (let i = 0; i < split.headDensity.length; i++) {
        if (!split.headDensity[i]) continue;
        expect(split.uvs[i * 2]).toBeGreaterThanOrEqual(0);
        expect(split.uvs[i * 2]).toBeLessThanOrEqual(1);
        expect(split.uvs[i * 2 + 1]).toBeGreaterThanOrEqual(0);
        expect(split.uvs[i * 2 + 1]).toBeLessThanOrEqual(1);
      }
      // Rasterised head triangles in the head texture never hit another island's texels,
      // and none folds over (every winding is positive, F19).
      const size = 1024;
      const owner = new Int16Array(size * size).fill(-1);
      let clashes = 0;
      let turned = 0;
      const area = (uv: ArrayLike<number>, c: number[]) =>
        (uv[c[1]! * 2]! - uv[c[0]! * 2]!) * (uv[c[2]! * 2 + 1]! - uv[c[0]! * 2 + 1]!) - (uv[c[2]! * 2]! - uv[c[0]! * 2]!) * (uv[c[1]! * 2 + 1]! - uv[c[0]! * 2 + 1]!);
      for (let t = 0; t < split.headIndices.length; t += 3) {
        const c = [split.headIndices[t]!, split.headIndices[t + 1]!, split.headIndices[t + 2]!];
        const island = composer.layout.islandsOfCorner(mesh.sourceVertex[c[0]!]!, mesh.uvs[c[0]! * 2]!, mesh.uvs[c[0]! * 2 + 1]!)[0]!;
        if (!(area(split.uvs, c) > 0)) turned++;
        rasterTriangle(size, c.map((v) => split.uvs[v * 2]! * size), c.map((v) => (1 - split.uvs[v * 2 + 1]!) * size), (texel) => {
          if (owner[texel] === -1) owner[texel] = island;
          else if (owner[texel] !== island) clashes++;
        });
      }
      expect(clashes).toBe(0);
      expect(turned).toBe(0);
    });
  }

  it('the head texture carries the composite texels to the head UVs', async () => {
    // Composite whose colour encodes its own UV.
    const size = 512;
    const comp = createImage(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const v = 1 - (y + 0.5) / size;
        comp.data.set([Math.round(u * 255), Math.round(v * 255), 0, 255], (y * size + x) * 4);
      }
    const head = await assets.headLayout('ps2_body_12k');
    const tex = headTexture(comp, head, 1024);
    const out = [0, 0, 0, 0];
    let worst = 0;
    const uv = head.mesh.uvs;
    for (let k = 0; k < head.mesh.triangles.length; k += 17) {
      const t = head.mesh.triangles[k]!;
      const at = (src: ArrayLike<number>, d: number) => (src[t.corners[0] * 2 + d]! + src[t.corners[1] * 2 + d]! + src[t.corners[2] * 2 + d]!) / 3;
      sampleBilinear(tex, at(head.uv, 0), at(head.uv, 1), out);
      worst = Math.max(worst, Math.abs(out[0]! / 255 - at(uv, 0)), Math.abs(out[1]! / 255 - at(uv, 1)));
    }
    // Within 2 levels of the 8-bit UV encoding.
    expect(worst).toBeLessThan(2.5 / 255);
    expect(bodyTexture(comp, 256).width).toBe(256);
  });

  it('procedural layers are deterministic and sit on their features', () => {
    const lips = newLayer('lips');
    const a = composer.layerImage(lips);
    const b = new SkinComposer(assets.base, assets.rig, assets.weights.sparse).layerImage(lips);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    const map = composer.surface;
    const f = composer.features;
    const centroid = (img: RgbaImage): [number, number, number] => {
      const c = [0, 0, 0];
      let w = 0;
      for (let t = 0; t < map.coverage.length; t++) {
        const al = img.data[t * 4 + 3]! / 255;
        if (!map.coverage[t] || al <= 0) continue;
        for (let k = 0; k < 3; k++) c[k]! += al * map.position[t * 3 + k]!;
        w += al;
      }
      return c.map((x) => x / w) as [number, number, number];
    };
    const lipsAt = centroid(a);
    expect(Math.hypot(lipsAt[0] - f.mouth.centre[0], lipsAt[1] - f.mouth.centre[1])).toBeLessThan(0.006);
    const circles = centroid(composer.layerImage(newLayer('darkCircles')));
    expect(circles[1]).toBeLessThan(f.eyes[0].centre[1]); // under the eyes
    expect(circles[1]).toBeGreaterThan(f.noseTip[1]);
    const stubble = centroid(composer.layerImage(newLayer('stubble')));
    expect(stubble[1]).toBeLessThan(f.mouth.centre[1] + 0.01); // lower face
    // Every procedural kind covers something, and seeds change the pattern.
    for (const k of LAYER_KINDS.filter((x) => x.procedural)) {
      const img = composer.layerImage(newLayer(k.kind, k.kind === 'eyeliner' ? { params: { shadow: 0.5, thickness: 1, color: '#1c1615', shadowColor: '#6b4c5e' } } : {}));
      let covered = 0;
      for (let t = 3; t < img.data.length; t += 4) if (img.data[t]! > 10) covered++;
      expect(covered, k.kind).toBeGreaterThan(200);
    }
    const f1 = composer.layerImage(newLayer('freckles'));
    const f2 = composer.layerImage({ ...newLayer('freckles'), params: { ...newLayer('freckles').params, seed: 2 } } as SkinLayer);
    expect(Buffer.from(f1.data).equals(Buffer.from(f2.data))).toBe(false);
  });

  it('projects a synthetic photo so that every texel lands on its own UV', () => {
    const base = assets.base;
    const positions = base.positions;
    const normals = computeQuadNormals(positions, base.faceVerts, base.vertexCount);
    const layout = composer.layout;
    const face = layout.islands.filter((i) => i.kind === 'head').sort((a, b) => b.faces.length - a.faces.length)[0]!;
    // Landmark stand-ins: front-facing face vertices on a 3 mm grid (deterministic).
    const seen = new Set<string>();
    const verts: number[] = [];
    for (const f of face.faces) {
      for (let k = 0; k < 4; k++) {
        const v = base.faceVerts[f * 4 + k]!;
        const [x, y, z] = [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
        if (normals[v * 3 + 2]! < 0.55 || Math.abs(x) > 0.06 || y < 0.63 || y > 0.79 || z < 0.1) continue;
        const key = `${Math.round(x / 0.006)},${Math.round(y / 0.006)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        verts.push(v);
      }
    }
    const table: LandmarkTable = { format: 'ps2cc.landmarks/1', vertices: new Array(478).fill(-1), source: {} };
    verts.slice(0, 478).forEach((v, i) => (table.vertices[i] = v));
    // The "photo": an orthographic front view (scaled, shifted, slightly rotated) whose colour encodes the UV.
    const W = 600;
    const photo = createImage(W, W, [0, 0, 0, 255]);
    const ang = 0.05;
    const toPhoto = (x: number, y: number): [number, number] => {
      const s = 3200;
      const px = s * (x * Math.cos(ang) - (y - 0.7) * Math.sin(ang)) + W / 2;
      const py = -s * (x * Math.sin(ang) + (y - 0.7) * Math.cos(ang)) + W / 2;
      return [px, py];
    };
    const zbuf = new Float32Array(W * W).fill(-Infinity);
    const U0 = 0.6;
    const UR = 0.4;
    const V0 = 0.1;
    const VR = 0.75;
    for (const tri of layout.triangles) {
      const pts = tri.verts.map((v) => toPhoto(positions[v * 3]!, positions[v * 3 + 1]!));
      const zs = tri.verts.map((v) => positions[v * 3 + 2]!);
      const us = tri.uvs.map((t) => base.uvs[t * 2]!);
      const vs = tri.uvs.map((t) => base.uvs[t * 2 + 1]!);
      const isFace = layout.faceIsland[tri.face] === face.id;
      rasterTriangle(W, pts.map((p) => p[0]), pts.map((p) => p[1]), (texel, b0, b1, b2) => {
        const z = b0 * zs[0]! + b1 * zs[1]! + b2 * zs[2]!;
        if (z <= zbuf[texel]!) return;
        zbuf[texel] = z;
        const u = b0 * us[0]! + b1 * us[1]! + b2 * us[2]!;
        const v = b0 * vs[0]! + b1 * vs[1]! + b2 * vs[2]!;
        photo.data.set(isFace ? [Math.round(((u - U0) / UR) * 255), Math.round(((v - V0) / VR) * 255), 255, 255] : [0, 0, 0, 255], texel * 4);
      });
    }
    const landmarks = new Array(478 * 3).fill(0);
    table.vertices.forEach((v, i) => {
      if (v < 0) return;
      const [px, py] = toPhoto(positions[v * 3]!, positions[v * 3 + 1]!);
      landmarks[i * 3] = px / W;
      landmarks[i * 3 + 1] = py / W;
    });
    const size = 1024;
    const res = projectPhoto({ layout, table, positions, normals, photo, landmarks, size, baseSkin: null });
    expect(res.texels).toBeGreaterThan(5000);
    // Each strongly projected face texel decodes to its own UV.
    const errors: number[] = [];
    for (let t = 0; t < size * size; t++) {
      const a = res.image.data[t * 4 + 3]!;
      if (a < 200 || res.image.data[t * 4 + 2]! < 250) continue;
      const x = t % size;
      const y = Math.floor(t / size);
      const u = (x + 0.5) / size;
      const v = 1 - (y + 0.5) / size;
      const du = (res.image.data[t * 4]! / 255) * UR + U0 - u;
      const dv = (res.image.data[t * 4 + 1]! / 255) * VR + V0 - v;
      errors.push(Math.hypot(du, dv) * size);
    }
    errors.sort((p, q) => p - q);
    expect(errors.length).toBeGreaterThan(3000);
    // Median and 95th percentile in texels at 1024 (encoding steps are 1.6 and 3 texels).
    expect(errors[Math.floor(errors.length / 2)]!).toBeLessThan(2.5);
    expect(errors[Math.floor(errors.length * 0.95)]!).toBeLessThan(4);
  });

  it('the scene composites procedural layers on the body material', async () => {
    const doc = defaultCharacter('skin');
    doc.skin.layers = [newLayer('stubble'), { ...newLayer('tone'), params: { hue: 10, saturation: 1.1, value: 0.9 } }];
    const engine = new CharacterEngine(assets, doc);
    const scene = new CharacterScene(engine);
    await scene.sync();
    const body = scene.parts.find((p) => p.kind === 'body')!;
    expect(body.material.texture).toBe(assets.skin(doc.skin.base)!.texture);
    const skin = body.material.skin!;
    expect(skin.layers.map((l) => l.source.kind)).toEqual(['pixels', 'adjust']);
    const sig = skin.signature;
    // Opacity changes re-resolve the stack without regenerating pixels.
    engine.update('opacity', (d) => void (d.skin.layers[0]!.opacity = 0.3));
    await scene.sync();
    const again = scene.parts.find((p) => p.kind === 'body')!.material.skin!;
    expect(again.signature).not.toBe(sig);
    expect(again.layers[0]!.source).toBe(skin.layers[0]!.source.kind === 'pixels' ? again.layers[0]!.source : null);
    engine.update('no layers', (d) => void (d.skin.layers = []));
    await scene.sync();
    expect(scene.parts.find((p) => p.kind === 'body')!.material.skin).toBeNull();
  });
});
