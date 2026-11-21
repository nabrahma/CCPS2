/**
 * Garment Designer (PRD Part 3, F32). The Pattern tab is PatternDesigner.tsx. The Shell tab: a template (tops,
 * bottoms, hands and feet, headwear, accessories), its parameters as
 * sliders, switches and choices, and a live preview worn by the character
 * (generated on the reference body, fitted to this character as every
 * generated garment is). Hem handles in the viewport drag the lengths. Save
 * keeps the garment in the library or on this character only (D-151); the
 * garment remembers its template and parameters, so it opens here again.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveParams, SHELL_TEMPLATES, type DetailProfile, type ParamDef, type ShellCategory, type ShellParams } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';
import { PatternDesigner, type OpenedPattern } from './PatternDesigner';

const CATEGORY_LABEL: Record<ShellCategory, string> = {
  tops: 'Tops',
  bottoms: 'Bottoms',
  'hands-feet': 'Hands and feet',
  head: 'Headwear',
  accessories: 'Accessories',
};

/** Which parameter a hem handle drags: the loop it sits on, and parameter units per metre the hem moves up. */
interface HandleDef {
  param: string;
  loop: 'lowest' | 'highest' | 'outer';
  perMetre: number;
}
const TOP_HANDLES: HandleDef[] = [
  { param: 'length', loop: 'lowest', perMetre: -400 },
  { param: 'sleeve', loop: 'outer', perMetre: -180 },
];
const BOTTOM_HANDLES: HandleDef[] = [
  { param: 'length', loop: 'lowest', perMetre: -170 },
  { param: 'rise', loop: 'highest', perMetre: 300 },
];
const HANDLES: Record<string, HandleDef[]> = {
  tshirt: TOP_HANDLES,
  longsleeve: TOP_HANDLES,
  rollneck: TOP_HANDLES,
  tank: TOP_HANDLES,
  utilityvest: TOP_HANDLES,
  leggings: BOTTOM_HANDLES,
  straighttrousers: BOTTOM_HANDLES,
  flaredtrousers: BOTTOM_HANDLES,
  cargotrousers: BOTTOM_HANDLES,
  shorts: BOTTOM_HANDLES,
  socks: [{ param: 'height', loop: 'highest', perMetre: 100 }],
  gloves: [{ param: 'cuffLength', loop: 'highest', perMetre: 100 }],
  workboots: [{ param: 'height', loop: 'highest', perMetre: 100 }],
  sneakers: [{ param: 'height', loop: 'highest', perMetre: 100 }],
};

/** Seeded random numbers (mulberry32): the same seed, the same design. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random design within the template's ranges. */
export function randomDesign(defs: readonly ParamDef[], seed: number): ShellParams {
  const r = rng(seed);
  const out: ShellParams = {};
  for (const d of defs) {
    if (d.kind === 'toggle') out[d.key] = r() < 0.5 ? 1 : 0;
    else if (d.kind === 'choice') out[d.key] = Math.floor(r() * (d.choices?.length ?? 1));
    else out[d.key] = Math.min(d.max, d.min + Math.round((r() * (d.max - d.min)) / d.step) * d.step);
  }
  return out;
}

/** Boundary loops of a render mesh (welded by position: UV seams are not edges of the cloth), as their centres. */
function loopCentres(positions: Float32Array, indices: Uint32Array): [number, number, number][] {
  const key = new Map<string, number>();
  const id = new Int32Array(positions.length / 3);
  const P: number[] = [];
  for (let v = 0; v < id.length; v++) {
    const k = `${positions[v * 3]!.toFixed(5)},${positions[v * 3 + 1]!.toFixed(5)},${positions[v * 3 + 2]!.toFixed(5)}`;
    let w = key.get(k);
    if (w === undefined) {
      w = P.length / 3;
      key.set(k, w);
      P.push(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
    }
    id[v] = w;
  }
  const n = P.length / 3;
  const count = new Map<number, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = id[indices[t + k]!]!;
      const b = id[indices[t + ((k + 1) % 3)]!]!;
      const e = Math.min(a, b) * n + Math.max(a, b);
      count.set(e, (count.get(e) ?? 0) + 1);
    }
  }
  const next = new Map<number, number[]>();
  for (const [e, c] of count) {
    if (c !== 1) continue;
    const a = Math.floor(e / n);
    const b = e % n;
    next.set(a, [...(next.get(a) ?? []), b]);
    next.set(b, [...(next.get(b) ?? []), a]);
  }
  const seen = new Set<number>();
  const out: [number, number, number][] = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const c = [0, 0, 0];
    let k = 0;
    while (stack.length) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      c[0]! += P[v * 3]!;
      c[1]! += P[v * 3 + 1]!;
      c[2]! += P[v * 3 + 2]!;
      k++;
      for (const u of next.get(v) ?? []) if (!seen.has(u)) stack.push(u);
    }
    if (k >= 6) out.push([c[0]! / k, c[1]! / k, c[2]! / k]);
  }
  return out;
}

function pickLoop(centres: [number, number, number][], how: HandleDef['loop']): [number, number, number] | null {
  if (!centres.length) return null;
  const score = (c: [number, number, number]) => (how === 'lowest' ? -c[1] : how === 'highest' ? c[1] : Math.abs(c[0]));
  return centres.reduce((best, c) => (score(c) > score(best) ? c : best));
}

/** The Garment Designer: the Shell tab (generated shells) and the Pattern tab (sewing-pattern programs). */
export function GarmentDesigner() {
  const studio = useStudio();
  const target = useUi((u) => u.assetStudio?.target ?? null);
  const [tab, setTab] = useState<'shell' | 'pattern'>('shell');
  // A worn pattern garment opened from the Wardrobe opens on the Pattern tab, with its program and design.
  const [opened, setOpened] = useState<OpenedPattern | null>(null);
  // Which tab a worn garment opens on is known only once its file is read: neither tab starts before (the
  // Shell tab would put on a preview of its own).
  const [checked, setChecked] = useState(!target?.startsWith('garment:'));
  useEffect(() => {
    let live = true;
    void (async () => {
      const worn = target?.startsWith('garment:') ? studio.engine.doc.garments.find((g) => `garment:${g.slot}:${g.asset}` === target) : undefined;
      if (!worn || !studio.assets.hasProxy(worn.asset)) {
        if (live) setChecked(true);
        return;
      }
      const proxy = await studio.assets.proxy(worn.asset);
      const gen = proxy.meta.generator;
      if (live && gen?.kind === 'pattern' && gen.pattern) {
        setOpened({ slot: worn.slot, asset: worn.asset, program: gen.template, design: gen.pattern.design, name: proxy.meta.name, profile: (gen.pattern.profile as DetailProfile) ?? 'classic' });
        setTab('pattern');
      }
      if (live) setChecked(true);
    })();
    return () => {
      live = false;
    };
  }, [target, studio]);
  return (
    <div className="garment-designer" data-testid="garment-designer">
      <div className="studio-switch" role="tablist" aria-label="Garment Designer">
        <button role="tab" aria-selected={tab === 'shell'} className={tab === 'shell' ? 'active' : ''} onClick={() => setTab('shell')} data-testid="designer-tab-shell">
          Shell
        </button>
        <button role="tab" aria-selected={tab === 'pattern'} className={tab === 'pattern' ? 'active' : ''} onClick={() => setTab('pattern')} data-testid="designer-tab-pattern" title="Sewing patterns made to this character's measurements">
          Pattern
        </button>
      </div>
      {!checked ? null : tab === 'shell' ? <ShellDesigner /> : <PatternDesigner key={opened?.asset ?? 'new'} opened={opened} />}
    </div>
  );
}

function ShellDesigner() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const target = ui.assetStudio?.target ?? null;
  // A worn generated garment opened from the Wardrobe: its template and parameters, and what it replaces.
  const opened = useRef<{ slot: string; asset: string } | null>(null);
  const [templateId, setTemplateId] = useState('tshirt');
  const template = SHELL_TEMPLATES.find((t) => t.id === templateId)!;
  const [params, setParams] = useState<ShellParams>(() => resolveParams(template));
  const [name, setName] = useState(template.name);
  const [seed, setSeed] = useState(() => (Math.random() * 1e6) | 0);
  const [ms, setMs] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const saved = useRef(false);

  // Open: a generated garment's own template and parameters, or a new design.
  useEffect(() => {
    let live = true;
    void (async () => {
      const worn = target?.startsWith('garment:') ? studio.engine.doc.garments.find((g) => `garment:${g.slot}:${g.asset}` === target) : undefined;
      if (worn && studio.assets.hasProxy(worn.asset)) {
        const proxy = await studio.assets.proxy(worn.asset);
        const gen = proxy.meta.generator;
        if (live && gen?.kind === 'shell' && SHELL_TEMPLATES.some((t) => t.id === gen.template)) {
          const t = SHELL_TEMPLATES.find((x) => x.id === gen.template)!;
          opened.current = { slot: worn.slot, asset: worn.asset };
          setTemplateId(t.id);
          setParams(resolveParams(t, gen.params));
          setName(proxy.meta.name);
        }
      }
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [target, studio]);

  // Leaving without saving puts back what the preview replaced.
  useEffect(
    () => () => {
      if (!saved.current) studio.endDesign(opened.current ? { slot: opened.current.slot as never, asset: opened.current.asset } : null);
    },
    [studio],
  );

  // Live preview: generated a moment after the last change.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const timer = setTimeout(() => {
      const t0 = performance.now();
      studio
        .previewDesign(templateId, params, opened.current?.asset ?? null)
        .then((g) => {
          if (!live) return;
          setMs(performance.now() - t0);
          setPreview(g.garment.meta.id);
        })
        .catch((err) => ui.error('Could not generate that garment', err));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [templateId, params, ready, studio]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickTemplate = (id: string) => {
    const t = SHELL_TEMPLATES.find((x) => x.id === id)!;
    setTemplateId(id);
    setParams(resolveParams(t));
    setName(t.name);
  };
  const set = (key: string, v: number) => setParams((p) => ({ ...p, [key]: v }));

  const save = async (where: 'library' | 'character') => {
    setBusy(where === 'library' ? 'Saving to the library' : 'Keeping it on this character');
    try {
      await studio.saveDesign(templateId, params, name.trim() || template.name, where);
      saved.current = true;
      ui.info(where === 'library' ? `Saved ${name} to the Wardrobe` : `${name} is kept on this character`);
      ui.closeStudio();
    } catch (err) {
      ui.error('Could not save the garment', err);
    } finally {
      setBusy(null);
    }
  };

  const groups = useMemo(() => {
    const m = new Map<ShellCategory, typeof SHELL_TEMPLATES>();
    for (const t of SHELL_TEMPLATES) m.set(t.category, [...(m.get(t.category) ?? []), t]);
    return [...m.entries()];
  }, []);

  return (
    <div className="shell-designer" data-testid="shell-designer">
      <div className="picker-row">
        <label htmlFor="designer-template">Template</label>
        <select id="designer-template" value={templateId} onChange={(e) => pickTemplate(e.target.value)} data-testid="designer-template">
          {groups.map(([cat, list]) => (
            <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
              {list.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="picker-row">
        <label htmlFor="designer-name">Name</label>
        <input id="designer-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-testid="designer-name" />
      </div>
      {template.params.map((d) => (
        <ParamRow key={d.key} def={d} value={params[d.key] ?? d.default} onChange={(v) => set(d.key, v)} />
      ))}
      <div className="picker-row">
        <label htmlFor="designer-seed">Seed</label>
        <input id="designer-seed" type="number" value={seed} onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 0))} data-testid="designer-seed" />
        <button className="chip" onClick={() => setParams(randomDesign(template.params, seed))} title="A random design within this template's ranges (the same seed, the same design)" data-testid="designer-random">
          Random design
        </button>
      </div>
      <p className="hint" data-testid="designer-status">
        {ms === null ? 'Generating…' : `Generated in ${Math.round(ms)} ms. Drag the round handles in the viewport to move the hems.`}
      </p>
      <div className="tool-line">
        <button onClick={() => void save('character')} disabled={busy !== null || ms === null} data-testid="designer-keep" title="This character only, saved with it (like a Garment Studio edit)">
          Keep on this character
        </button>
        <button className="primary" onClick={() => void save('library')} disabled={busy !== null || ms === null} data-testid="designer-save" title="A new garment in the Wardrobe, for any character">
          Save to Wardrobe
        </button>
      </div>
      {busy && <p className="hint">{busy}…</p>}
      {preview && <HemHandles partAsset={preview} handles={HANDLES[templateId] ?? []} params={params} defs={template.params} onChange={set} />}
    </div>
  );
}

function ParamRow({ def, value, onChange }: { def: ParamDef; value: number; onChange: (v: number) => void }) {
  const id = `designer-${def.key}`;
  if (def.kind === 'toggle') {
    return (
      <label className="check" title={def.help}>
        <input type="checkbox" checked={value === 1} onChange={(e) => onChange(e.target.checked ? 1 : 0)} data-testid={id} /> {def.label}
      </label>
    );
  }
  if (def.kind === 'choice') {
    return (
      <div className="picker-row" title={def.help}>
        <label htmlFor={id}>{def.label}</label>
        <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={id}>
          {(def.choices ?? []).map((c, i) => (
            <option key={c} value={i}>
              {c}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="slider-row" title={def.help}>
      <label htmlFor={id}>
        {def.label} <span className="muted">{`${Number(value.toFixed(2))} ${def.unit}`}</span>
      </label>
      <input id={id} type="range" min={def.min} max={def.max} step={def.step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={id} />
    </div>
  );
}

/** Round handles on the preview's hems, over the viewport: dragging one up or down moves that hem. */
function HemHandles({ partAsset, handles, params, defs, onChange }: { partAsset: string; handles: HandleDef[]; params: ShellParams; defs: readonly ParamDef[]; onChange: (key: string, v: number) => void }) {
  const studio = useStudio();
  const vp = studio.viewport;
  const host = vp?.canvas.parentElement ?? null;
  const [spots, setSpots] = useState<{ def: HandleDef; at: [number, number, number]; x: number; y: number }[]>([]);
  const drag = useRef<{ def: HandleDef; start: number; y0: number; depth: number; x: number } | null>(null);

  useEffect(() => {
    if (!vp) return;
    let raf = 0;
    let version = -1;
    let centres: [number, number, number][] = [];
    const tick = () => {
      const part = studio.scene.parts.find((p) => p.assetId === partAsset);
      if (part) {
        if (part.version !== version) {
          version = part.version;
          centres = loopCentres(part.positions, part.indices);
        }
        const view = vp.groomView();
        const out: typeof spots = [];
        for (const def of handles) {
          if (!defs.some((d) => d.key === def.param)) continue;
          const at = pickLoop(centres, def.loop);
          if (!at) continue;
          const s = view.project(at);
          out.push({ def, at, x: s.x, y: s.y });
        }
        setSpots((prev) => (prev.length === out.length && prev.every((p, i) => Math.abs(p.x - out[i]!.x) < 0.5 && Math.abs(p.y - out[i]!.y) < 0.5) ? prev : out));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [vp, studio, partAsset, handles, defs]);

  if (!host || !vp) return null;
  const down = (e: React.PointerEvent, s: (typeof spots)[number]) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { def: s.def, start: params[s.def.param] ?? 0, y0: e.clientY, depth: vp.groomView().project(s.at).depth, x: s.x };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const view = vp.groomView();
    const a = view.unproject(d.x, 0, d.depth);
    const b = view.unproject(d.x, e.clientY - d.y0, d.depth);
    // How far the hem moved up (metres): b is where the pointer is now.
    const up = b[1] - a[1];
    const def = defs.find((x) => x.key === d.def.param)!;
    const v = Math.min(def.max, Math.max(def.min, Math.round((d.start + up * d.def.perMetre) / def.step) * def.step));
    onChange(def.key, v);
  };
  const end = () => {
    drag.current = null;
  };
  return createPortal(
    <div className="hem-handles" data-testid="hem-handles">
      {spots.map((s) => (
        <button
          key={s.def.param}
          className="hem-handle"
          style={{ left: s.x, top: s.y }}
          title={`Drag up or down: ${defs.find((d) => d.key === s.def.param)?.label ?? s.def.param}`}
          onPointerDown={(e) => down(e, s)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          data-testid={`hem-handle-${s.def.param}`}
        />
      ))}
    </div>,
    host,
  );
}
