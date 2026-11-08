import { useEffect, useState } from 'react';
import { EXPRESSION_MAP, type ExpressionGroup } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';

const GROUPS: { id: ExpressionGroup; label: string }[] = [
  { id: 'eyes', label: 'Eyes' },
  { id: 'brows', label: 'Brows' },
  { id: 'mouth', label: 'Mouth' },
  { id: 'visemes', label: 'Visemes' },
];

/**
 * Expressions (PRD F8): every blendshape the exporter can bake, with a preview
 * slider (viewport only, not saved) and whether to bake it at export. The
 * shapes come from MakeHuman's face pose units on its default rig.
 */
export function ExpressionsPanel() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const scene = studio.scene;
  const doc = studio.engine.doc;
  const chosen = new Set(doc.expressionsToBake);
  const [weights, setWeights] = useState<Record<string, number>>(() => ({ ...scene.expressionPreview }));
  const [loading, setLoading] = useState(false);

  const preview = (next: Record<string, number>) => {
    setWeights(next);
    setLoading(!scene.expressionsReady);
    scene
      .setExpressionPreview(next)
      .then(() => studio.viewport?.refresh())
      .catch((err: unknown) => ui.error('Could not preview the expression', err))
      .finally(() => setLoading(false));
  };

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

  const active = Object.values(weights).some((w) => w !== 0);
  return (
    <div className="slider-panel" data-testid="expressions-panel">
      <p className="hint">
        Blendshapes baked into the export from MakeHuman's face pose units. Brows, lashes, teeth and hair get the same shapes. Sliders only preview in the
        viewport.
      </p>
      <div className="panel-tools">
        <button onClick={() => studio.viewport?.setCameraPreset('face')}>Face camera</button>
        <button disabled={!active} onClick={() => preview({})} data-testid="expr-reset">
          Neutral face
        </button>
        <span className="muted">
          {chosen.size} of {EXPRESSION_MAP.expressions.length} baked{loading ? ' · loading face rig…' : ''}
        </span>
      </div>
      {GROUPS.map((g) => {
        const list = EXPRESSION_MAP.expressions.filter((e) => e.group === g.id);
        const allOn = list.every((e) => chosen.has(e.name));
        return (
          <details key={g.id} open className="slider-group">
            <summary>
              <span>{g.label}</span>
              <button
                className="icon"
                title={allOn ? `Do not bake ${g.label.toLowerCase()}` : `Bake all ${g.label.toLowerCase()}`}
                onClick={(e) => {
                  e.preventDefault();
                  setBake(list.map((x) => x.name), !allOn);
                }}
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
                  {cal && (
                    <span className="muted note" title="Upper-lid pose weight that closes this character's eye (calibrated per character)">
                      lid ×{cal.weight.toFixed(2)}
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
