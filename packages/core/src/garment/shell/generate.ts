/**
 * A shell template and its parameters to a library garment (PRD Part 3, F28
 * and F32): generated on the reference body, then bound like an imported
 * garment (M10), so fitting, weights, hidden body faces, looks, Garment
 * Studio and export treat it like any other. The garment's file records the
 * template and parameters (`meta.generator`), so it can be generated again
 * (identical for the same version) or opened in Garment Designer.
 */
import type { CoreAssets } from '../../assets';
import { importGarment, referenceBody, type ImportedGarment, type ReferenceBody } from '../../proxy/garment-import';
import type { GeneratorInfo, ProxyAsset } from '../../proxy/proxy';
import { newLook } from '../../wardrobe/look';
import { shellBody, type ShellBody } from './body';
import { buildShell, runShell, type ShellBuild, type ShellTopology } from './build';
import { resolveParams, shellTemplate, type ShellParams, type ShellTemplate } from './templates';

/** Bump when the generators change what identical parameters produce. */
export const SHELL_GENERATOR_VERSION = 1;

const refBodies = new WeakMap<CoreAssets, ReferenceBody>();

function refBody(assets: CoreAssets): ReferenceBody {
  let b = refBodies.get(assets);
  if (!b) {
    b = referenceBody(assets);
    refBodies.set(assets, b);
  }
  return b;
}

export interface ShellGarment {
  garment: ImportedGarment;
  build: ShellBuild;
  template: ShellTemplate;
  params: ShellParams;
}

/** The mesh of a template on the reference body (no binding): the Designer's fast preview. */
export async function buildTemplate(assets: CoreAssets, templateId: string, raw: Readonly<Record<string, unknown>> = {}): Promise<{ build: ShellBuild; template: ShellTemplate; params: ShellParams }> {
  const template = shellTemplate(templateId);
  if (!template?.spec) throw new Error(`no shell template "${templateId}"`);
  const params = resolveParams(template, raw);
  const body = await shellBody(assets, template.tier);
  const build = await buildShell(body, template.spec(body, params));
  return { build, template, params };
}

/** Generate and bind a garment: the result is ready to save to the library or wear as a per-character edit. */
export async function generateShellGarment(assets: CoreAssets, templateId: string, raw: Readonly<Record<string, unknown>> = {}, name?: string): Promise<ShellGarment> {
  const { build, template, params } = await buildTemplate(assets, templateId, raw);
  // Generated garments close over what they cover (boots over the toes, hoods over the head): skin up to 10 cm under them is hidden.
  const garment = await importGarment(build.raw, { name: name ?? template.name, slot: template.slot, body: refBody(assets), coverageGap: 0.1 });
  const generator: GeneratorInfo = { kind: 'shell', template: template.id, params: { ...params }, version: SHELL_GENERATOR_VERSION };
  garment.meta.generator = generator;
  garment.meta.tags = ['generated', 'shell', template.category];
  const look = newLook(template.look.material);
  look.zones[0]!.tint = [...template.look.tint];
  garment.meta.defaults = { look };
  return { garment, build, template, params };
}

/** What the scene needs to generate a library garment again on any character's body. */
export interface ShellReplay {
  template: ShellTemplate;
  params: ShellParams;
  topology: ShellTopology;
  /** Per proxy vertex, the generator's vertex. */
  map: Int32Array;
}

const replays = new WeakMap<CoreAssets, Map<string, Promise<ShellReplay | null>>>();

/**
 * Prepare a generated garment for per-body generation: its topology (from the
 * reference body, generated again from the stored parameters) and how the
 * proxy's vertices map onto the generator's. Null for other garments, or when
 * the garment was made by a generator version that no longer gives the same
 * mesh (it then fits by its binding, like any garment).
 */
export function prepareShellReplay(assets: CoreAssets, proxy: ProxyAsset): Promise<ShellReplay | null> {
  const g = proxy.meta.generator;
  if (g?.kind !== 'shell') return Promise.resolve(null);
  let byAssets = replays.get(assets);
  if (!byAssets) {
    byAssets = new Map();
    replays.set(assets, byAssets);
  }
  const key = `${proxy.id}|${g.version}|${JSON.stringify(g.params)}`;
  let p = byAssets.get(key);
  if (!p) {
    p = (async () => {
      if (g.version !== SHELL_GENERATOR_VERSION) return null;
      const { build, template, params } = await buildTemplate(assets, g.template, g.params);
      const index = new Map<string, number>();
      const pos = build.mesh.pos;
      for (let v = 0; v < pos.length / 3; v++) index.set(`${Math.fround(pos[v * 3]!)},${Math.fround(pos[v * 3 + 1]!)},${Math.fround(pos[v * 3 + 2]!)}`, v);
      const map = new Int32Array(proxy.vertexCount);
      const r = proxy.restPositions;
      for (let v = 0; v < proxy.vertexCount; v++) {
        const i = index.get(`${r[v * 3]!},${r[v * 3 + 1]!},${r[v * 3 + 2]!}`);
        if (i === undefined) return null;
        map[v] = i;
      }
      return { template, params, topology: build.topology, map };
    })();
    byAssets.set(key, p);
  }
  return p;
}

/**
 * The garment generated on a character's body (its shell body from
 * `shellBodyAt`): the same topology, this body's shape. Positions per proxy
 * vertex (metres), written into `out`.
 */
export function replayShell(body: ShellBody, r: ShellReplay, out: Float32Array): Float32Array {
  const run = runShell(body, r.template.spec!(body, r.params), r.topology);
  const P = run.mesh.pos;
  for (let v = 0; v < r.map.length; v++) {
    const i = r.map[v]!;
    out[v * 3] = P[i * 3]!;
    out[v * 3 + 1] = P[i * 3 + 1]!;
    out[v * 3 + 2] = P[i * 3 + 2]!;
  }
  return out;
}
