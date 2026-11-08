import { useEffect, useState } from 'react';
import { NEUTRAL_TINT, SLOT_BUDGET, type GarmentImportReport, type GarmentSlotName, type ImportSlot } from '@ps2cc/core';
import { backend, type GarmentFile } from '../backend';
import { useStudio } from '../state/hooks';
import { useUi, type GarmentImportRequest } from '../state/ui';

const SLOT_OPTIONS: { id: ImportSlot; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'full', label: 'Suit or dress' },
  { id: 'outer', label: 'Outerwear' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'hat', label: 'Hat' },
  { id: 'gloves', label: 'Gloves' },
  { id: 'accessory', label: 'Accessory' },
];

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Import a garment modelled around the exported base body (PRD F4): read, then name it and choose its slot. */
export function GarmentImportDialog() {
  const request = useUi((s) => s.garmentImport);
  return request ? <Dialog key={JSON.stringify('path' in request ? request.path : request.mesh.name)} request={request} /> : null;
}

function Dialog({ request }: { request: GarmentImportRequest }) {
  const studio = useStudio();
  const close = useUi((s) => s.openGarmentImport);
  const [file, setFile] = useState<GarmentFile | null>('mesh' in request ? request.mesh : null);
  const [name, setName] = useState('mesh' in request ? request.mesh.name : '');
  const [slot, setSlot] = useState<ImportSlot>('top');
  const [busy, setBusy] = useState('path' in request ? 'Reading the file…' : '');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; slot: ImportSlot; report: GarmentImportReport } | null>(null);

  useEffect(() => {
    if (!('path' in request)) return;
    let cancelled = false;
    backend
      .readGarment(request.path)
      .then((f) => {
        if (cancelled) return;
        setFile(f);
        setName(f.name);
      })
      .catch((err: unknown) => !cancelled && setProblem(message(err)))
      .finally(() => !cancelled && setBusy(''));
    return () => {
      cancelled = true;
    };
  }, [request]);

  const run = async () => {
    if (!file) return;
    setBusy('Fitting it to the body…');
    setProblem(null);
    // Let the status line paint before the work starts.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const g = await studio.importGarment(file, { name: name.trim() || file.name, slot });
      setDone({ id: g.meta.id, slot, report: g.report });
    } catch (err) {
      setProblem(message(err));
    } finally {
      setBusy('');
    }
  };

  const wear = () => {
    if (done) {
      studio.engine.update('Wear garment', (d) => {
        d.garments.push({ slot: done.slot as GarmentSlotName, asset: done.id, tint: { ...NEUTRAL_TINT, color: [1, 1, 1] }, dirt: 0, hideBody: true });
      });
    }
    close(null);
  };

  const budget = SLOT_BUDGET[slot] ?? 0;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-labelledby="garment-import-title" data-testid="garment-import-dialog">
        <h2 id="garment-import-title">Import garment</h2>
        {done ? (
          <>
            <ul className="report-list" data-testid="garment-import-report">
              <li>
                {done.report.originalTriangles.toLocaleString()} triangles in the file, {done.report.triangles.toLocaleString()} after fitting to the budget
              </li>
              <li>Typically {(done.report.medianGap * 100).toFixed(1)} cm from the body</li>
              <li>{done.report.coveredBodyVertices.toLocaleString()} body vertices hidden under it</li>
              {done.report.correction && <li>Corrected: {done.report.correction}</li>}
              {done.report.warnings.map((w) => (
                <li key={w} className="warn-text">
                  {w}
                </li>
              ))}
            </ul>
            <p className="muted">It is in the Wardrobe now. Drop a PNG on it to give it a texture.</p>
            <div className="modal-actions">
              <button onClick={() => close(null)}>Close</button>
              <button className="primary" data-testid="garment-import-wear" onClick={wear}>
                Wear it
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              Name
              <input value={name} disabled={!file} data-testid="garment-import-name" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              Slot
              <select value={slot} disabled={!file} data-testid="garment-import-slot" onChange={(e) => setSlot(e.target.value as ImportSlot)}>
                {SLOT_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted status-line" data-testid="garment-import-status">
              {busy || (file ? `${file.triangles.toLocaleString()} triangles; at most ${budget.toLocaleString()} are kept for this slot.` : ' ')}
            </p>
            <p className="error-text status-line" role="alert" data-testid="garment-import-problem">
              {problem ?? ' '}
            </p>
            <div className="modal-actions">
              <button onClick={() => close(null)} disabled={busy === 'Fitting it to the body…'}>
                Cancel
              </button>
              <button className="primary" data-testid="garment-import-run" disabled={!file || Boolean(busy)} onClick={() => void run()}>
                Import
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
