import { useMemo, useState } from 'react';
import { CM_PER_INCH, formatMeasure, MEASURES, solveMeasurements, type MeasureDef, type MeasureGroup, type MeasureId, type SolveReport } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';

const GROUPS: MeasureGroup[] = ['Height and weight', 'Circumferences', 'Lengths', 'Widths', 'Angles'];
const KEY = MEASURES.filter((m) => m.key);
const TARGETS = MEASURES.filter((m) => m.target);

/**
 * Body measurements (PRD Part 3, F24): a live readout of the body as it is,
 * and typed targets the body is fitted to. The fit only moves ordinary
 * sliders (height, weight, muscle, proportions, MakeHuman's measure sliders
 * and the torso, hip, leg and arm scales), so everything stays editable.
 */
export function MeasurementsPanel() {
  const studio = useStudio();
  const version = useStudioVersion();
  const ui = useUi();
  const inches = ui.inches;
  const doc = studio.engine.doc;
  // The last fit, and the body it was for: it is shown until the body changes again.
  const [fitted, setFitted] = useState<{ report: SolveReport; at: number } | null>(null);
  const report = fitted && fitted.at === studio.engine.geometryVersion ? fitted.report : null;
  const setReport = (r: SolveReport | null) => setFitted(r ? { report: r, at: studio.engine.geometryVersion } : null);
  const [busy, setBusy] = useState(false);
  const [unlockGender, setUnlockGender] = useState(false);
  // Typed text per measurement, in the shown unit; the saved targets are in cm and kg.
  const [typed, setTyped] = useState<Partial<Record<MeasureId, string>>>({});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the body changes with the studio version, not with a prop
  const now = useMemo(() => studio.assets.anthro.measure(studio.engine.positions), [studio, version, studio.engine.geometryVersion]);

  const shown = (def: MeasureDef, value: number) => (def.unit === 'cm' && inches ? value / CM_PER_INCH : value);
  const stored = (def: MeasureDef, value: number) => (def.unit === 'cm' && inches ? value * CM_PER_INCH : value);
  const unit = (def: MeasureDef) => (def.unit === 'cm' ? (inches ? 'in' : 'cm') : def.unit === 'kg' ? 'kg' : '');
  const targets = doc.measurementTargets ?? {};
  const text = (def: MeasureDef) => typed[def.id] ?? (targets[def.id] !== undefined ? String(Number(shown(def, targets[def.id]!).toFixed(1))) : '');

  const commit = (def: MeasureDef, raw: string) => {
    const v = Number(raw.replace(',', '.'));
    const next = { ...targets };
    if (raw.trim() === '' || !Number.isFinite(v) || v <= 0) delete next[def.id];
    else next[def.id] = stored(def, v);
    setTyped((t) => ({ ...t, [def.id]: undefined }));
    setReport(null);
    if (JSON.stringify(next) === JSON.stringify(targets)) return;
    studio.engine.update('Set a measurement', (d) => {
      if (Object.keys(next).length > 0) d.measurementTargets = next;
      else delete d.measurementTargets;
    });
  };

  const count = Object.keys(targets).length;
  const fit = () => {
    setBusy(true);
    // Let the button show "Fitting…" before the half second of work.
    window.setTimeout(() => {
      try {
        const start = { macros: studio.engine.doc.macros, modifiers: studio.engine.doc.modifiers };
        const r = solveMeasurements(studio.assets, studio.assets.anthro, start, targets, { unlockGender });
        studio.engine.update('Fit body to measurements', (d) => {
          d.macros = r.macros;
          d.modifiers = r.modifiers;
        });
        setReport(r);
        const missed = r.targets.filter((t) => !t.inReach).length;
        if (missed > 0) ui.info(`${missed} of ${r.targets.length} measurements are out of reach for this body; the closest shape was used`);
      } catch (err) {
        ui.error('Could not fit the body', err);
      } finally {
        setBusy(false);
      }
    }, 20);
  };
  const clear = () => {
    setTyped({});
    setReport(null);
    studio.engine.update('Clear measurements', (d) => void delete d.measurementTargets);
  };
  const result = (id: MeasureId) => report?.targets.find((t) => t.id === id);

  return (
    <div className="measurements" data-testid="measurements">
      <div className="measure-readout" data-testid="measure-readout">
        {KEY.map((def) => (
          <span key={def.id} title={def.how} data-measure={def.id}>
            <em>{def.label}</em> {formatMeasure(def.id, now[def.id], inches)}
          </span>
        ))}
      </div>
      <div className="tool-line">
        <label className="check">
          <input type="radio" name="measure-units" checked={!inches} onChange={() => ui.setInches(false)} data-testid="units-cm" /> cm
        </label>
        <label className="check">
          <input type="radio" name="measure-units" checked={inches} onChange={() => ui.setInches(true)} data-testid="units-in" /> inches
        </label>
      </div>
      <details className="more" data-testid="measure-targets" open={count > 0}>
        <summary>Set measurements{count > 0 ? ` (${count})` : ''}</summary>
        <p className="hint">Type the measurements you want and press Fit. Leave the rest empty. Gender, age and ethnic blend stay as they are.</p>
        <div className="measure-table">
          {TARGETS.map((def) => {
            const r = result(def.id);
            return (
              <div key={def.id} className={r && !r.inReach ? 'measure-row miss' : 'measure-row'} title={def.how} data-measure={def.id}>
                <label htmlFor={`measure-${def.id}`}>{def.label}</label>
                <span className="now">{formatMeasure(def.id, now[def.id], inches)}</span>
                <input
                  id={`measure-${def.id}`}
                  type="text"
                  inputMode="decimal"
                  placeholder={unit(def)}
                  value={text(def)}
                  onChange={(e) => setTyped((t) => ({ ...t, [def.id]: e.target.value }))}
                  onBlur={(e) => commit(def, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(def, (e.target as HTMLInputElement).value);
                  }}
                  data-testid={`measure-target-${def.id}`}
                  aria-label={`${def.label} target in ${unit(def)}`}
                />
                {r && !r.inReach && (
                  <span className="miss-note" data-testid={`measure-miss-${def.id}`}>
                    out of reach: closest is {formatMeasure(def.id, r.reached, inches)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="tool-line">
          <label className="check" title="Let the fit move the Gender slider too">
            <input type="checkbox" checked={unlockGender} onChange={(e) => setUnlockGender(e.target.checked)} /> Let gender change
          </label>
          <span className="tb-spacer" />
          <button onClick={clear} disabled={count === 0 || busy} data-testid="measure-clear">
            Clear
          </button>
          <button className="primary" onClick={fit} disabled={count === 0 || busy} data-testid="measure-fit">
            {busy ? 'Fitting…' : 'Fit body'}
          </button>
        </div>
        {report && report.targets.length > 0 && (
          <p className={report.targets.every((t) => t.inReach) ? 'hint' : 'hint warn'} data-testid="measure-result">
            {report.targets.every((t) => t.inReach)
              ? `All ${report.targets.length} reached (largest difference ${inches ? (report.worst / CM_PER_INCH).toFixed(2) + ' in' : report.worst.toFixed(2) + ' cm'}). ${report.changed.length} sliders moved; Ctrl+Z undoes it.`
              : 'Measurements in red cannot be reached together on this body. Try unlocking gender, or change the ones that conflict.'}
          </p>
        )}
      </details>
      <details className="more" data-testid="measure-all">
        <summary>All measurements</summary>
        {GROUPS.map((group) => (
          <div key={group} className="measure-group">
            <h4>{group}</h4>
            {MEASURES.filter((m) => m.group === group).map((def) => (
              <div key={def.id} className="measure-row plain" title={def.how} data-measure={def.id}>
                <span>{def.label}</span>
                <span className="now">{formatMeasure(def.id, now[def.id], inches)}</span>
              </div>
            ))}
          </div>
        ))}
        <p className="hint">Taken on the rest shape, as a tape measure would: circumferences bridge hollows, and lengths follow the skin where a tailor's tape does.</p>
      </details>
    </div>
  );
}
