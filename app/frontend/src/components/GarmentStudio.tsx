/**
 * Garment Studio (Part 2 F18): reshape a worn garment on the character and
 * save it as a new library garment.
 *
 * - Shape brushes (Grab, Smooth, Inflate, Crease, Flatten) with radius,
 *   strength and X symmetry; the cloth is kept outside the body.
 * - Kitbash: crop a hem or a sleeve, roll a sleeve or leg into a cuff, grow a
 *   collar, roll neck, band or cuff out of an open edge, add a patch pocket,
 *   loosen or tighten the whole garment.
 *
 * Edits happen on the character's own body; saving moves the garment onto the
 * reference body and imports it like a garment modelled around it (M10), so
 * it fits every body. Each stroke or tool use is one step of the studio's own
 * undo; saving adds the new garment to the Wardrobe and puts it on in place of
 * the original.
 */
import { useEffect, useRef, useState } from 'react';
import {
  addPatch,
  applyShapeBrush,
  betweenShoulders,
  bodySurfaceAt,
  buildRenderTopology,
  cloneEditMesh,
  cropAtPlane,
  editMeshFromProxy,
  extrudeLoop,
  gather3,
  inflateAll,
  openLoops,
  rollAtPlane,
  SHAPE_BRUSHES,
  type BodySurface,
  type EditMesh,
  type ExtrudeProfile,
  type ImportSlot,
  type Plane,
  type ReferenceBody,
  type ShapeBrush,
} from '@ps2cc/core';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

type Vec3 = [number, number, number];
type Tool = ShapeBrush | 'crop' | 'roll' | 'edge' | 'pocket';

const LABELS: Record<Tool, string> = {
  grab: 'Grab',
  smooth: 'Smooth',
  inflate: 'Inflate',
  crease: 'Crease',
  flatten: 'Flatten',
  crop: 'Crop',
  roll: 'Roll up',
  edge: 'Collar / cuff',
  pocket: 'Pocket',
};
const HINTS: Record<Tool, string> = {
  grab: 'Drag to pull the cloth',
  smooth: 'Drag to even out the cloth',
  inflate: 'Drag to puff the cloth out',
  crease: 'Drag to press in a fold line',
  flatten: 'Drag to flatten the cloth',
  crop: 'Click where the garment should end: on a sleeve or leg it is cut across the limb, elsewhere straight across',
  roll: 'Click on a sleeve or leg: it is cut there and turned back into a cuff',
  edge: 'Click near an open edge (neckline, cuff, hem) to grow the chosen band from it',
  pocket: 'Click where the pocket goes',
};
const SLOTS: ImportSlot[] = ['top', 'outer', 'bottom', 'full', 'shoes', 'gloves', 'hat', 'accessory'];

interface Session {
  mesh: EditMesh;
  history: EditMesh[];
  body: BodySurface;
  joint: (name: string) => Vec3;
}

export function GarmentStudio({ canvas, partKey }: { canvas: HTMLCanvasElement | null; partKey: string }) {
  const studio = useStudio();
  const ui = useUi();
  const vp = studio.viewport;
  const garment = studio.engine.doc.garments.find((g) => `garment:${g.slot}:${g.asset}` === partKey) ?? null;
  const session = useRef<Session | null>(null);
  const [, redraw] = useState(0);
  const [tool, setTool] = useState<Tool>('grab');
  const [radius, setRadius] = useState(6);
  const [strength, setStrength] = useState(0.5);
  const [symmetry, setSymmetry] = useState(true);
  const [profile, setProfile] = useState<ExtrudeProfile>('collar');
  const [bandCm, setBandCm] = useState(10);
  const [pocket, setPocket] = useState<[number, number]>([12, 14]);
  const [name, setName] = useState(() => `${garment ? studio.assets.proxyInfo(garment.asset).name.replace(/_/g, ' ') : 'Garment'} (edited)`);
  const [slot, setSlot] = useState<ImportSlot>((garment?.slot as ImportSlot) ?? 'top');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = () => {
    const s = session.current;
    if (!s || !vp) return;
    const topo = buildRenderTopology(s.mesh.faceVerts, s.mesh.faceUvs, s.mesh.uvs);
    vp.setStudioMesh(partKey, { positions: gather3(s.mesh.positions, topo.sourceVertex, new Float32Array(topo.sourceVertex.length * 3)), uvs: topo.uvs, indices: topo.indices });
  };

  // Start: the garment as worn, on this body.
  useEffect(() => {
    if (!garment || !vp) return;
    let alive = true;
    void studio.engine.assets.proxy(garment.asset).then((proxy) => {
      if (!alive) return;
      const positions = studio.engine.positions.slice();
      const sk = studio.engine.skeleton;
      session.current = {
        mesh: editMeshFromProxy(proxy, { positions } as ReferenceBody),
        history: [],
        body: bodySurfaceAt(studio.engine.assets, positions),
        joint: (n) => {
          const i = sk.rig.index.get(n);
          return i === undefined ? [0, -10, 0] : [sk.heads[i * 3]!, sk.heads[i * 3 + 1]!, sk.heads[i * 3 + 2]!];
        },
      };
      vp.setBrushMode(true);
      // The whole body shows under the garment being edited, so a crop shows skin, not a hole.
      studio.scene.showBodyUnder(partKey);
      vp.refresh();
      show();
      redraw((n) => n + 1);
    });
    return () => {
      alive = false;
      vp.setBrushMode(false);
      studio.scene.showBodyUnder(null);
      vp.setStudioMesh(partKey, null);
      session.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garment?.asset, vp, partKey]);

  const step = (fn: (s: Session) => void) => {
    const s = session.current;
    if (!s) return;
    s.history.push(cloneEditMesh(s.mesh));
    if (s.history.length > 40) s.history.shift();
    try {
      fn(s);
      setError(null);
    } catch (err) {
      s.mesh = s.history.pop()!;
      setError(err instanceof Error ? err.message : String(err));
    }
    show();
    redraw((n) => n + 1);
  };

  /** The crop plane for a click at p: across the limb on a sleeve or leg (on that side only), straight across elsewhere. */
  const planeAt = (s: Session, p: Vec3): { plane: Plane; within?: Plane | Plane[] } => {
    const side = p[0] >= 0 ? 'l' : 'r';
    const sign = p[0] >= 0 ? 1 : -1;
    const near = (a: Vec3, b: Vec3) => {
      const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
      const d = Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
      const l = Math.sqrt(l2);
      return { d, dir: [ab[0] / l, ab[1] / l, ab[2] / l] as Vec3 };
    };
    const j = s.joint;
    const shoulder = j(`upperarm_${side}`);
    const arms = [near(shoulder, j(`lowerarm_${side}`)), near(j(`lowerarm_${side}`), j(`hand_${side}`))];
    const legs = [near(j(`thigh_${side}`), j(`calf_${side}`)), near(j(`calf_${side}`), j(`foot_${side}`))];
    const arm = arms.sort((a, b) => a.d - b.d)[0]!;
    const leg = legs.sort((a, b) => a.d - b.d)[0]!;
    if (arm.d < 0.1 && Math.abs(p[0]) > Math.abs(shoulder[0]) * 0.8) return { plane: { point: p, normal: arm.dir }, within: { point: [shoulder[0] * 0.75, 0, 0], normal: [sign, 0, 0] } };
    if (leg.d < 0.12 && p[1] < j('pelvis')[1] - 0.05) return { plane: { point: p, normal: leg.dir }, within: { point: [0, 0, 0], normal: [sign, 0, 0] } };
    // Straight across the torso, between the shoulders (the sleeves stay whole).
    return { plane: { point: p, normal: [0, -1, 0] }, within: betweenShoulders(shoulder[0]) };
  };
  const mirrorPlane = (pl: Plane): Plane => ({ point: [-pl.point[0], pl.point[1], pl.point[2]], normal: [-pl.normal[0], pl.normal[1], pl.normal[2]] });

  // Pointer: brush strokes and clicks for the kitbash tools.
  useEffect(() => {
    if (!canvas || !vp) return;
    let last: Vec3 | null = null;
    let lastXY: [number, number] | null = null;
    let stroking = false;
    const at = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const pick = (e: PointerEvent) => {
      const [x, y] = at(e);
      return vp.groomView().pick(x, y, partKey);
    };
    const brushTool = (SHAPE_BRUSHES as string[]).includes(tool);
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !session.current) return;
      const hit = pick(e);
      if (!hit) return;
      if (!brushTool) {
        const p = hit.point;
        step((s) => {
          if (tool === 'crop' || tool === 'roll') {
            const { plane, within } = planeAt(s, p);
            const cut = (pl: Plane, w?: Plane | Plane[]) => (tool === 'crop' ? cropAtPlane(s.mesh, pl, w) : rollAtPlane(s.mesh, pl, 0.04, s.body, w));
            cut(plane, within);
            // A limb's crop on the other side too (a hem across the torso is already both sides).
            if (symmetry && within && !Array.isArray(within)) cut(mirrorPlane(plane), mirrorPlane(within));
          } else if (tool === 'edge') {
            let best: number[] | null = null;
            let bd = Infinity;
            for (const l of openLoops(s.mesh)) {
              // Distance to the loop's nearest vertex.
              let d = Infinity;
              for (const v of l) d = Math.min(d, Math.hypot(s.mesh.positions[v * 3]! - p[0], s.mesh.positions[v * 3 + 1]! - p[1], s.mesh.positions[v * 3 + 2]! - p[2]));
              if (d < bd) [bd, best] = [d, l];
            }
            if (!best || bd > 0.06) throw new Error('Click closer to an open edge of the garment');
            extrudeLoop(s.mesh, best, { height: bandCm / 100, out: profile === 'band' ? 0.004 : profile === 'cuff' ? 0.005 : 0.018, profile, name: profile }, s.body);
          } else if (tool === 'pocket') {
            addPatch(s.mesh, p, [0, 1, 0], pocket[0] / 100, pocket[1] / 100, s.body);
            if (symmetry && Math.abs(p[0]) > 0.03) addPatch(s.mesh, [-p[0], p[1], p[2]], [0, 1, 0], pocket[0] / 100, pocket[1] / 100, s.body);
          }
        });
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      session.current.history.push(cloneEditMesh(session.current.mesh));
      stroking = true;
      last = hit.point;
      lastXY = at(e);
      move(e);
    };
    const move = (e: PointerEvent) => {
      const s = session.current;
      if (!stroking || !s || !last || !lastXY) return;
      const xy = at(e);
      const view = vp.groomView();
      const hit = view.pick(xy[0], xy[1], partKey);
      let delta: Vec3 | undefined;
      if (tool === 'grab') {
        // Follow the pointer in the screen plane at the stroke's depth.
        const depth = view.project(last).depth;
        const a = view.unproject(lastXY[0], lastXY[1], depth);
        const b = view.unproject(xy[0], xy[1], depth);
        delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      }
      const centre = tool === 'grab' ? last : (hit?.point ?? null);
      if (!centre) return;
      applyShapeBrush(s.mesh, tool as ShapeBrush, { centre, radius: radius / 100, strength: tool === 'grab' ? 1 : strength * 0.35, delta, symmetry }, s.body);
      if (tool === 'grab' && delta) last = [last[0] + delta[0], last[1] + delta[1], last[2] + delta[2]];
      else if (hit) last = hit.point;
      lastXY = xy;
      show();
    };
    const up = () => {
      if (!stroking) return;
      stroking = false;
      last = null;
      lastXY = null;
      redraw((n) => n + 1);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, vp, tool, radius, strength, symmetry, profile, bandCm, pocket, partKey]);

  if (!garment) return null;
  const s = session.current;
  const undo = () => {
    if (!s || s.history.length === 0) return;
    s.mesh = s.history.pop()!;
    show();
    redraw((n) => n + 1);
  };
  const save = async () => {
    if (!s) return;
    setSaving(true);
    setError(null);
    try {
      const old = garment;
      // The look carries over without its pieces, painted zones and decals: the new garment's pieces are its own.
      const look = old.look ? { ...structuredClone(old.look), zones: [{ ...old.look.zones[0]!, islands: 'rest' as const }], mask: null, decals: [] } : undefined;
      const texture = old.texture ?? (await studio.engine.assets.proxy(old.asset)).meta.material?.diffuseTexture ?? null;
      const g = await studio.saveStudioGarment(s.mesh, s.body, { name: name.trim() || 'Edited garment', slot, texture, defaults: { ...(look ? { look } : {}), ...(old.fur ? { fur: old.fur } : {}) } });
      studio.engine.update('Wear the edited garment', (d) => {
        const i = d.garments.findIndex((x) => x.asset === old.asset);
        const next = { ...structuredClone(old), slot, asset: g.meta.id, texture: null, paint: null, ...(look ? { look } : {}) };
        if (i >= 0) d.garments.splice(i, 1, next);
        else d.garments.push(next);
      });
      ui.info(`Saved ${g.meta.name} to the Wardrobe`);
      ui.setGarmentStudio(null);
      ui.select(`garment:${slot}:${g.meta.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  const brush = (SHAPE_BRUSHES as string[]).includes(tool);
  return (
    <div className="hair-studio garment-studio" data-testid="garment-studio">
      <div className="hs-row">
        <strong>Garment Studio</strong>
        <span className="hint">{s ? `${(s.mesh.faceVerts.length / 4).toLocaleString()} faces · ${HINTS[tool]}` : 'Loading…'}</span>
        <span className="spacer" />
        <button onClick={undo} disabled={!s || s.history.length === 0} data-testid="garment-studio-undo">
          Undo
        </button>
        <button onClick={() => ui.setGarmentStudio(null)} data-testid="garment-studio-cancel">
          Close without saving
        </button>
      </div>
      <div className="hs-row tools" role="toolbar" aria-label="Garment tools">
        {(Object.keys(LABELS) as Tool[]).map((t) => (
          <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(t)} data-testid={`garment-tool-${t}`} title={HINTS[t]}>
            {LABELS[t]}
          </button>
        ))}
        <button onClick={() => step((ss) => inflateAll(ss.mesh, 0.004, ss.body))} data-testid="garment-loosen" title="Move the whole garment 4 mm out (to wear it over another)">
          Loosen all
        </button>
        <button onClick={() => step((ss) => inflateAll(ss.mesh, -0.003, ss.body))} title="Move the whole garment 3 mm in (it stays outside the body)">
          Tighten all
        </button>
      </div>
      <div className="hs-row">
        {brush && (
          <>
            <label>
              Radius (cm) <input type="range" min={1} max={25} step={0.5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} data-testid="garment-radius" />
            </label>
            <label>
              Strength <input type="range" min={0.05} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} />
            </label>
          </>
        )}
        {tool === 'edge' && (
          <>
            <label>
              Kind{' '}
              <select value={profile} onChange={(e) => setProfile(e.target.value as ExtrudeProfile)} data-testid="garment-edge-kind">
                <option value="collar">Folded collar</option>
                <option value="roll">Roll neck</option>
                <option value="band">Band</option>
                <option value="cuff">Turned-back cuff</option>
              </select>
            </label>
            <label>
              Height (cm) <input type="range" min={2} max={20} step={0.5} value={bandCm} onChange={(e) => setBandCm(Number(e.target.value))} />
            </label>
          </>
        )}
        {tool === 'pocket' && (
          <>
            <label>
              Width (cm) <input type="range" min={5} max={25} step={0.5} value={pocket[0]} onChange={(e) => setPocket([Number(e.target.value), pocket[1]])} />
            </label>
            <label>
              Height (cm) <input type="range" min={5} max={25} step={0.5} value={pocket[1]} onChange={(e) => setPocket([pocket[0], Number(e.target.value)])} />
            </label>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={symmetry} onChange={(e) => setSymmetry(e.target.checked)} data-testid="garment-symmetry" /> X symmetry
        </label>
      </div>
      <div className="hs-row">
        <label>
          Name <input value={name} onChange={(e) => setName(e.target.value)} data-testid="garment-studio-name" />
        </label>
        <label>
          Slot{' '}
          <select value={slot} onChange={(e) => setSlot(e.target.value as ImportSlot)}>
            {SLOTS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void save()} disabled={!s || saving} data-testid="garment-studio-save" title="Save as a new garment in the Wardrobe and wear it">
          {saving ? 'Saving…' : 'Save as new garment'}
        </button>
        {error && <span className="error" data-testid="garment-studio-error">{error}</span>}
      </div>
    </div>
  );
}
