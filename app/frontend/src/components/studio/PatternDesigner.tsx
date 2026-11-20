/**
 * Garment Designer (PRD Part 3, F32), the Pattern tab: a pattern program (GarmentCode's garments as ported, and
 * this project's own), a parameter panel generated from the program's design schema, and the sewing pattern
 * built to the current character's measurements, shown flat over the viewport: panels at true size, stitch
 * pairs in matching colours, sizes in cm and the measurements used. Random design draws within the program's
 * ranges (the same seed, the same design). Export saves the drawing (SVG) or the .ps2pattern it rebuilds from.
 * Draping and wearing the pattern come with the drape solver (M23).
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildProgram, designLeaves, garmentCodeBody, makePs2Pattern, patternPrograms, patternSvg, programDefaultDesign, randomProgramDesign, Rng, serializePs2Pattern, validateBuilt, type BuiltPattern, type DesignLeaf, type PatternIssue } from '@ps2cc/core';
import { backend } from '../../backend';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Design = any;

const GROUP_LABEL: Record<string, string> = {
  shirt: 'Body',
  collar: 'Neckline and collar',
  sleeve: 'Sleeves',
  left: 'Left side (asymmetric designs)',
  pants: 'Trousers',
  waistband: 'Waistband',
  skirt: 'Skirt',
  'flare-skirt': 'Flared skirt',
  'pencil-skirt': 'Pencil skirt',
  'godet-skirt': 'Godets',
  'levels-skirt': 'Tiers',
  bomber: 'Jacket',
  coat: 'Coat',
  'utility-vest': 'Vest',
  hoodie: 'Hoodie',
  'work-shirt': 'Shirt',
};

const humanize = (key: string): string => {
  const s = key.replace(/[_-]+/g, ' ').replace(/\bfc\b/, 'front neck').replace(/\bbc\b/, 'back neck').replace(/\bwb\b/, 'waistband').replace(/\bv\b/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const optionLabel = (v: unknown): string => (v === null ? 'None' : String(v).replace(/([a-z])([A-Z])/g, '$1 $2'));

function setLeaf(design: Design, path: string[], v: unknown): Design {
  const out = structuredClone(design);
  let n = out;
  for (const k of path) n = n[k];
  n.v = v;
  return out;
}

export function PatternDesigner() {
  const studio = useStudio();
  const version = useStudioVersion();
  const ui = useUi();
  const programs = useMemo(() => patternPrograms(), []);
  const [programId, setProgramId] = useState('Bomber');
  const program = programs.find((p) => p.id === programId)!;
  const [design, setDesign] = useState<Design>(() => programDefaultDesign('Bomber'));
  const [seed, setSeed] = useState(() => (Math.random() * 1e6) | 0);
  const [built, setBuilt] = useState<{ b: BuiltPattern; issues: PatternIssue[]; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPattern, setShowPattern] = useState(true);
  // GarmentCode's measurement keys for this character, from the F24 measurements.
  const body = useMemo(() => garmentCodeBody(studio.assets.anthro.measure(studio.engine.positions)), [studio, version, studio.engine.geometryVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      try {
        const t0 = performance.now();
        const b = buildProgram(programId, structuredClone(design), body);
        const issues = validateBuilt(b);
        if (live) {
          setBuilt({ b, issues, ms: performance.now() - t0 });
          setError(null);
        }
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err));
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [programId, design, body]);

  const pick = (id: string) => {
    setProgramId(id);
    setDesign(programDefaultDesign(id));
  };

  const leaves = useMemo(() => {
    const out: [string, [string[], DesignLeaf][]][] = [];
    for (const g of program.groups) {
      if (!design[g]) continue;
      out.push([g, designLeaves(design[g], [g])]);
    }
    return out;
  }, [program, design]);

  const random = () => {
    const { design: d } = randomProgramDesign(programId, new Rng(seed), body);
    setDesign(d);
  };

  const svg = useMemo(() => (built ? patternSvg(built.b.spec, { title: `${program.label}, made to ${studio.engine.doc.name || 'this character'}`, measurements: body }) : ''), [built, program, body, studio]);

  const exportSvg = async () => {
    const p = await backend.savePatternAs(`${program.id}_pattern`, 'svg', svg);
    if (p) ui.info(`Saved the pattern drawing to ${p}`);
  };
  const exportPs2 = async () => {
    if (!built) return;
    const text = serializePs2Pattern(makePs2Pattern(programId, design, body, built.b));
    const p = await backend.savePatternAs(program.id, 'ps2pattern', text);
    if (p) ui.info(`Saved ${p}`);
  };

  const status = error
    ? `This design does not build: ${error}`
    : built
      ? `${Object.keys(built.b.spec.panels).length} panels, ${built.b.spec.stitches.length} stitches, built in ${Math.round(built.ms)} ms. ${built.issues.length ? `${built.issues.length} check${built.issues.length > 1 ? 's' : ''} not met: ${built.issues[0]!.detail}` : 'Every pattern check passes.'}`
      : 'Building…';

  return (
    <div className="pattern-designer" data-testid="pattern-designer">
      <div className="picker-row">
        <label htmlFor="pattern-program">Program</label>
        <select id="pattern-program" value={programId} onChange={(e) => pick(e.target.value)} data-testid="pattern-program">
          <optgroup label="PS2CC">
            {programs
              .filter((p) => p.origin === 'ps2cc')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="GarmentCode">
            {programs
              .filter((p) => p.origin === 'garmentcode')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </optgroup>
        </select>
      </div>
      <p className="hint">Made to this character's measurements ({body.height!.toFixed(0)} cm tall, bust {body.bust!.toFixed(0)}, waist {body.waist!.toFixed(0)}, hips {body.hips!.toFixed(0)} cm).</p>
      {leaves.map(([group, list], gi) => (
        <details key={group} open={gi === 0} className="param-group">
          <summary>{GROUP_LABEL[group] ?? humanize(group)}</summary>
          {list.map(([path, leaf]) => (
            <LeafRow key={path.join('.')} path={path} leaf={leaf} onChange={(v) => setDesign((d: Design) => setLeaf(d, path, v))} />
          ))}
        </details>
      ))}
      <div className="picker-row">
        <label htmlFor="pattern-seed">Seed</label>
        <input id="pattern-seed" type="number" value={seed} onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 0))} data-testid="pattern-seed" />
        <button className="chip" onClick={random} title="A random design within the program's ranges (the same seed, the same design)" data-testid="pattern-random">
          Random design
        </button>
        <button className="chip" onClick={() => setDesign(programDefaultDesign(programId))} data-testid="pattern-reset">
          Reset
        </button>
      </div>
      <p className="hint" data-testid="pattern-status">
        {status}
      </p>
      <label className="check">
        <input type="checkbox" checked={showPattern} onChange={(e) => setShowPattern(e.target.checked)} data-testid="pattern-show" /> Show the pattern over the viewport
      </label>
      <div className="tool-line">
        <button onClick={() => void exportSvg()} disabled={!built || !!error} data-testid="pattern-export-svg" title="The flat pattern with seam allowances, stitch marks and labels, at true size">
          Export SVG
        </button>
        <button onClick={() => void exportPs2()} disabled={!built || !!error} data-testid="pattern-export-ps2" title="The program, design and measurements: rebuilds this exact pattern">
          Save .ps2pattern
        </button>
      </div>
      <p className="hint">Draping the pattern on the character and saving it to the Wardrobe come with the cloth solver (M23).</p>
      {showPattern && svg && <PatternView svg={svg} />}
    </div>
  );
}

function LeafRow({ path, leaf, onChange }: { path: string[]; leaf: DesignLeaf; onChange: (v: unknown) => void }) {
  const id = `pattern-${path.join('-')}`;
  const label = humanize(path[path.length - 1]!);
  const sub = path.length > 2 ? `${humanize(path[path.length - 2]!)}: ` : '';
  const type = leaf.type;
  if (type === 'bool') {
    return (
      <label className="check">
        <input type="checkbox" checked={leaf.v === true} onChange={(e) => onChange(e.target.checked)} data-testid={id} /> {sub}
        {label}
      </label>
    );
  }
  if (type.includes('select')) {
    const options = [...leaf.range, ...(type === 'select_null' && !leaf.range.includes(null) ? [null] : [])];
    return (
      <div className="picker-row">
        <label htmlFor={id}>
          {sub}
          {label}
        </label>
        <select id={id} value={options.indexOf(leaf.v)} onChange={(e) => onChange(options[Number(e.target.value)])} data-testid={id}>
          {options.map((o, i) => (
            <option key={i} value={i}>
              {optionLabel(o)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const [lo, hi] = leaf.range as [number, number];
  const step = type === 'int' ? 1 : (hi - lo) / 200;
  const v = Number(leaf.v);
  return (
    <div className="slider-row">
      <label htmlFor={id}>
        {sub}
        {label} <span className="muted">{type === 'int' ? v : v.toFixed(2)}</span>
      </label>
      <input id={id} type="range" min={lo} max={hi} step={step} value={v} onChange={(e) => onChange(type === 'int' ? Math.round(Number(e.target.value)) : Number(e.target.value))} data-testid={id} />
    </div>
  );
}

/** The flat pattern, drawn over the viewport (the 2D pattern view). */
function PatternView({ svg }: { svg: string }) {
  const studio = useStudio();
  const host = studio.viewport?.canvas.parentElement ?? null;
  const [zoom, setZoom] = useState(1);
  if (!host) return null;
  const body = svg.replace(/<\?xml[^>]*>/, '').replace(/width="[^"]+cm" height="[^"]+cm"/, `width="${Math.round(zoom * 100)}%"`);
  return createPortal(
    <div className="pattern-view" data-testid="pattern-view">
      <div className="pattern-view-tools">
        <button className="chip" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))} title="Zoom out">
          −
        </button>
        <button className="chip" onClick={() => setZoom(1)} title="Fit the width">
          Fit
        </button>
        <button className="chip" onClick={() => setZoom((z) => Math.min(4, z * 1.25))} title="Zoom in">
          +
        </button>
      </div>
      {/* The SVG is generated here from numbers and program-defined names (escaped by patternSvg). */}
      <div className="pattern-view-sheet" dangerouslySetInnerHTML={{ __html: body }} />
    </div>,
    host,
  );
}
