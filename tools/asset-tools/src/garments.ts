/**
 * Build-time garment decimation (PRD F4): writes the decimated CC0 garments in
 * the regular proxy format (the decimation itself is `decimateProxy` in core).
 */
import { decimateProxy, type ProxyAsset } from '@ps2cc/core';
import { ContainerWriter } from './container-writer';

export interface DecimatedGarment {
  triangles: number;
  vertices: number;
  originalTriangles: number;
  flipped: number;
  sha: { json: string; bin: string };
}

/**
 * Decimate one proxy and write `<base>.json/.bin`. `coveredVerts` (computed
 * hidden faces, see coverage.ts) is stored alongside for garments without
 * MakeHuman delete_verts.
 */
export async function decimateGarment(proxy: ProxyAsset, slot: string, base: string, coveredVerts?: Uint32Array): Promise<DecimatedGarment> {
  const d = await decimateProxy(proxy, slot);
  const w = new ContainerWriter();
  w.add('restPositions', d.restPositions, 'f32');
  w.add('uvs', d.uvs, 'f32');
  w.add('faceVerts', d.faceVerts, 'u32');
  w.add('faceUvs', d.faceUvs, 'u32');
  w.add('refVerts', d.refVerts, 'u32');
  w.add('refWeights', d.refWeights, 'f32');
  w.add('refOffsets', d.refOffsets, 'f32');
  if (proxy.deleteVerts.length) w.add('deleteVerts', proxy.deleteVerts, 'u32');
  if (coveredVerts?.length) w.add('coveredVerts', coveredVerts, 'u32');
  w.add('sourceProxyVertex', d.kept, 'u32');
  const meta = {
    ...proxy.meta,
    vertexCount: d.kept.length,
    faceCount: d.faceVerts.length / 4,
    triangleFaces: d.faceVerts.length / 4,
    decimatedFrom: proxy.vertexCount,
    hiddenFaces: proxy.deleteVerts.length ? 'makehuman' : coveredVerts?.length ? 'computed' : 'none',
    originalTriangles: d.originalTriangles,
  };
  delete (meta as Record<string, unknown>).binary;
  delete (meta as Record<string, unknown>).byteLength;
  delete (meta as Record<string, unknown>).buffers;
  const sha = w.write(base, meta);
  return { triangles: d.triangles, vertices: d.kept.length, originalTriangles: d.originalTriangles, flipped: d.flipped, sha };
}
