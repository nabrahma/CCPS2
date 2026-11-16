import { useEffect, useMemo, useState } from 'react';
import { EXPRESSION_MAP, presetWeights, type ExpressionGroup } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';

const GROUPS: { id: ExpressionGroup; label: string; open: boolean }[] = [
  { id: 'brows', label: 'Brows', open: true },
  { id: 'eyes', label: 'Eyes', open: true },
  { id: 'cheeks', label: 'Cheeks and nose', open: false },
  { id: 'jaw', label: 'Jaw', open: true },
  { id: 'mouth', label: 'Mouth', open: false },
  { id: 'tongue', label: 'Tongue', open: false },
  { id: 'visemes', label: 'Visemes (lip-sync)', open: false },
  { id: 'classic', label: 'Names from before 0.25', open: false },
];

/** Bytes Unity keeps per moved vertex of a blendshape: position, normal and tangent deltas (3 floats each). */
const BYTES_PER_DELTA = 36;

/**
 * Expressions (PRD F8, rebuilt by PRD Part 3 F25): the 52 ARKit face units
 * the export bakes as blendshapes under their ARKit names, the visemes made of
 * them, and the names exported before 0.25.0. Sliders and presets preview in
 * the viewport only; ticks choose what the export bakes. Eyes, lashes, teeth,
 * tongue, garments and hair get the same shapes.
 */
export function ExpressionsPanel() {
  const studio = useStudio();
  const version = useStudioVersion();
  const ui = useUi();
  const scene = studio.scene;
  const doc = studio.engine.doc;
  const chosen = new Set(doc.expressionsToBake);
  const [weights, setWeights] = useState<Record<string, number>>(() => ({ ...scene.expressionPreview }));
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [ready, setReady] = useState(scene.expressionsReady);

  const preview = (next: Record<string, number>, presetName: string | null = null) => {
    setWeights(next);
    setPreset(presetName);
    setLoading(!scene.expressionsReady);
    scene
      .setExpressionPreview(next)
      .then(() => {
        setReady(true);
        studio.viewport?.refresh();
      })
      .catch((err: unknown) => ui.error('Could not preview the expression', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (scene.expressionsReady) return;
    void scene.prepareExpressions().then(() => setReady(true));
  }, [scene]);

  // Leaving the panel puts the face back to neutral.
  useEffect(
    () => () => {
      void scene.setExpressionPreview({}).then(() => studio.viewport?.refresh());
    },
    [scene, studio],
  );

  const setBake = (names: string[], on: boolean) =>
    studio.engine.update(on ? 'Bake expressions' : 'Skip expressions', (d) => {
      const all = EXPRESSION_MAP.expressions.map((e) => e.name);
      const next = on ? new Set([...d.expressionsToBake, ...names]) : new Set(d.expressionsToBake.filter((x) => !names.includes(x)));
      d.expressionsToBake = all.filter((n) => next.has(n));
    });

  // What the chosen shapes cost in Unity: every moved vertex of every mesh they move.
  const memory = useMemo(() => {
    if (!ready) return null;
    let deltas = 0;
    for (const name of doc.expressionsToBake) {
      const shapes = scene.expressionShapes(name);
      if (!shapes) continue;
      for (const s of shapes.values()) {
        const d = s.deltas;
        for (let i = 0; i < d.length; i += 3) if (Math.abs(d[i]!) > 1e-6 || Math.abs(d[i + 1]!) > 1e-6 || Math.abs(d[i + 2]!) > 1e-6) deltas++;
      }
    }
    return deltas * BYTES_PER_DELTA;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the shapes change with the studio version
  }, [ready, version, doc.expressionsToBake, scene]);

  const active = Object.values(weights).some((w) => w !== 0);
  return (
    <div className="slider-panel" data-testid="expressions-panel">
      <p className="hint">
        The 52 ARKit face units, baked into the export under their ARKit names so face capture and lip-sync tools in Unity drive them as they are. Eyes,
        lashes, teeth, tongue, clothes and hair move with them. Sliders and poses only preview in the viewport.
      </p>
      <div className="panel-tools">
        <button onClick={() => studio.viewport?.setCameraPreset('face')}>Face camera</button>
        <button disabled={!active} onClick={() => preview({})} data-testid="expr-reset">
          Neutral face
        </button>
        <span className="muted" data-testid="expr-cost">
          {chosen.size} baked{memory !== null ? ` · about ${(memory / (1024 * 1024)).toFixed(1)} MB in Unity` : ''}
          {loading ? ' · loading face units…' : ''}
        </span>
      </div>
      <div className="tool-line expr-presets" role="group" aria-label="Expression poses">
        {EXPRESSION_MAP.presets.map((p) => (
          <button
            key={p.name}
            className={preset === p.name ? 'chip active' : 'chip'}
            onClick={() => preview(preset === p.name ? {} : (presetWeights(p.name) ?? {}), preset === p.name ? null : p.name)}
            title={`Preview ${p.label.toLowerCase()}: ${Object.entries(p.weights)
              .map(([u, w]) => `${u} ${w}`)
              .join(', ')}`}
            data-testid={`expr-preset-${p.name}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {GROUPS.map((g) => {
        const list = EXPRESSION_MAP.expressions.filter((e) => e.group === g.id);
        const allOn = list.every((e) => chosen.has(e.name));
        const some = list.filter((e) => chosen.has(e.name)).length;
        return (
          <details key={g.id} open={g.open} className="slider-group" data-testid={`expr-group-${g.id}`}>
            <summary>
              <span>
                {g.label} <span className="muted">{some === list.length ? '' : `${some} of ${list.length} baked`}</span>
              </span>
              <button
                className="icon"
                title={allOn ? `Do not bake ${g.label.toLowerCase()}` : `Bake all ${g.label.toLowerCase()}`}
                onClick={(e) => {
                  e.preventDefault();
                  setBake(
                    list.map((x) => x.name),
                    !allOn,
                  );
                }}
                data-testid={`expr-bake-group-${g.id}`}
              >
                {allOn ? '☑' : '☐'}
              </button>
            </summary>
            {list.map((e) => {
              const w = weights[e.name] ?? 0;
              const cal = e.calibrate ? scene.expressionCalibration(e.name) : null;
              return (
                <div key={e.name} className={w !== 0 ? 'expr-row changed' : 'expr-row'} title={e.units.map(([u, x]) => `${u} ${x}`).join(', ')}>
                  <label htmlFor={`expr-${e.name}`}>
                    <input
                      type="checkbox"
                      checked={chosen.has(e.name)}
                      onChange={(ev) => setBake([e.name], ev.target.checked)}
                      aria-label={`Bake ${e.name}`}
                      data-testid={`expr-bake-${e.name}`}
                    />{' '}
                    {e.label} <span className="muted">{e.name}</span>
                  </label>
                  <input
                    id={`expr-${e.name}`}
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={w}
                    onChange={(ev) => preview({ ...weights, [e.name]: Number(ev.target.value) })}
                    data-testid={`expr-slider-${e.name}`}
                  />
                  <span className="num" aria-label={`${e.name} preview weight`}>
                    {w.toFixed(2)}
                  </span>
                  {cal && cal.weight !== 1 && (
                    <span className="muted note" title="Blink weight that closes this character's eye (calibrated per character)">
                      ×{cal.weight.toFixed(2)}
                    </span>
                  )}
                </div>
              );
            })}
          </details>
        );
      })}
    </div>
  );
}
