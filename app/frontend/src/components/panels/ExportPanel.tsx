import { useRef, useState } from 'react';
import type { BodyMeshId } from '@ps2cc/core';
import { backend, type ExportResult } from '../../backend';
import { ExportCancelled, exportCharacter } from '../../export/exportCharacter';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';

const BODY_MESHES: { id: BodyMeshId; label: string }[] = [
  { id: 'ps2_body_8k', label: '8k triangles' },
  { id: 'ps2_body_10k', label: '10k triangles' },
  { id: 'ps2_body_12k', label: '12k triangles' },
];

/**
 * Export (PRD 6): FBX (native writer in the backend), textures, the sidecar
 * for the Unity importer and an optional validated GLB, into
 * <Unity project>/Assets/PS2CC/<Name>/ or a chosen folder.
 */
export function ExportPanel() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const doc = studio.engine.doc;
  const ex = doc.export;
  const budget = studio.scene.budget();
  const [busy, setBusy] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [last, setLast] = useState<ExportResult | null>(null);
  const cancel = useRef(false);
  const set = (label: string, fn: (d: typeof doc.export) => void) => studio.engine.update(label, (d) => fn(d.export));

  const run = async (target: string) => {
    cancel.current = false;
    setBusy('Starting');
    try {
      const out = await exportCharacter(studio, {
        target,
        glb: ex.writeGlb,
        tPose: ex.tPose,
        overrideBudget: override,
        onProgress: setBusy,
        cancelled: () => cancel.current,
      });
      setLast(out.result);
      const warn = out.glbWarnings ? ` (GLB: ${out.glbWarnings} validator warnings)` : '';
      ui.info(`Exported ${out.scene.name}: ${out.result.files.length} files to ${out.result.dir}${warn}`);
    } catch (err) {
      if (err instanceof ExportCancelled) ui.info('Export cancelled');
      else ui.error('Export failed', err);
    } finally {
      setBusy(null);
    }
  };
  const toUnity = () => {
    if (!ex.unityProject) {
      ui.error('Choose your Unity project first (or use Export to folder…)');
      return;
    }
    void run(`${ex.unityProject.replace(/[\\/]+$/, '')}\\Assets\\PS2CC`);
  };
  const toFolder = async () => {
    try {
      const dir = await backend.chooseExportFolder();
      if (dir) await run(dir);
    } catch (err) {
      ui.error('Could not choose a folder', err);
    }
  };

  return (
    <div className="slider-panel" data-testid="export-panel">
      <div className="picker-row">
        <label htmlFor="export-body">Body mesh</label>
        <select id="export-body" value={doc.bodyMesh} onChange={(e) => studio.engine.update('Body mesh', (d) => void (d.bodyMesh = e.target.value as BodyMeshId))}>
          {BODY_MESHES.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
      <div className="picker-row">
        <label htmlFor="export-budget">Triangle budget</label>
        <input
          id="export-budget"
          type="number"
          min={4000}
          max={ex.hardMax}
          step={500}
          value={ex.triangleBudget}
          onChange={(e) => set('Triangle budget', (x) => void (x.triangleBudget = Math.min(ex.hardMax, Math.max(1000, Number(e.target.value) || 12000))))}
        />
      </div>
      <div className="picker-row">
        <label htmlFor="export-head">Head texture</label>
        <select id="export-head" value={ex.headTexture} onChange={(e) => set('Head texture', (x) => void (x.headTexture = Number(e.target.value) as 512 | 1024))}>
          <option value={1024}>1024</option>
          <option value={512}>512</option>
        </select>
      </div>
      <div className="picker-row">
        <label htmlFor="export-bodytex">Body texture</label>
        <select id="export-bodytex" value={ex.bodyTexture} onChange={(e) => set('Body texture', (x) => void (x.bodyTexture = Number(e.target.value) as 512 | 1024))}>
          <option value={1024}>1024</option>
          <option value={512}>512</option>
        </select>
      </div>
      <label className="check">
        <input type="checkbox" checked={ex.tPose} onChange={(e) => set('T-pose export', (x) => void (x.tPose = e.target.checked))} /> Export in T-pose
        (arms straight out; default is MakeHuman's A-pose)
      </label>
      <label className="check">
        <input type="checkbox" checked={ex.writeGlb} onChange={(e) => set('GLB export', (x) => void (x.writeGlb = e.target.checked))} /> Also write a GLB
        (checked with glTF-Validator)
      </label>
      <div className="picker-row">
        <label>Unity project</label>
        <button
          onClick={() =>
            backend
              .pickUnityProject()
              .then((p) => p && set('Unity project', (x) => void (x.unityProject = p)))
              .catch((err: unknown) => ui.error('Could not use that folder', err))
          }
          title={ex.unityProject ?? ''}
        >
          {ex.unityProject ? shortPath(ex.unityProject) : 'Choose…'}
        </button>
      </div>
      <p className={`budget-line budget-${budget.state}`}>
        {budget.total.toLocaleString()} / {ex.triangleBudget.toLocaleString()} triangles (hard max {ex.hardMax.toLocaleString()}) · 5 draw calls at most
      </p>
      {budget.exportBlocked && (
        <label className="check warning-text">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Export anyway (above the hard maximum)
        </label>
      )}
      {busy ? (
        <div className="progress-row" role="status" data-testid="export-progress">
          <span className="spinner" aria-hidden /> {busy}…
          <button onClick={() => (cancel.current = true)}>Cancel</button>
        </div>
      ) : (
        <div className="button-column">
          <button className="primary wide" onClick={toUnity} disabled={budget.exportBlocked && !override} data-testid="export-unity">
            Export to Unity
          </button>
          <button onClick={() => void toFolder()} disabled={budget.exportBlocked && !override}>
            Export to folder…
          </button>
        </div>
      )}
      {last && (
        <section className="export-result" data-testid="export-result">
          <h3>Last export</h3>
          <p className="muted">
            {last.files.length} files, {(last.bytes / 1048576).toFixed(1)} MB in {last.dir}
          </p>
          {last.dir !== 'download' && <button onClick={() => backend.openFolder(last.dir)}>Show files</button>}
        </section>
      )}
      <p className="hint">
        In Unity, add the package <code>com.ps2cc.importer</code> (Package Manager → Add package from disk → <code>unity/com.ps2cc.importer/package.json</code>). It sets up the
        Humanoid avatar, PS2 materials and a prefab when the FBX imports.
      </p>
    </div>
  );
}

function shortPath(p: string): string {
  return p.length > 34 ? `…${p.slice(-33)}` : p;
}
