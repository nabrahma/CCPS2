import { useRef, useState } from 'react';
import {
  bodyMeshFor,
  profileOverrides,
  profileSettings,
  QUALITY_PROFILE_IDS,
  QUALITY_PROFILES,
  type BodyMeshId,
  type ExportSettings,
  type QualityProfileId,
  type TextureSize,
  withBakeLayers,
} from '@ps2cc/core';
import { backend, type ExportResult } from '../../backend';
import { ExportCancelled, exportCharacter } from '../../export/exportCharacter';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useUi } from '../../state/ui';

const BODY_MESHES: { id: BodyMeshId; label: string }[] = [
  { id: 'ps2_body_8k', label: '8k triangles' },
  { id: 'ps2_body_10k', label: '10k triangles' },
  { id: 'ps2_body_12k', label: '12k triangles' },
  { id: 'ps2_body_16k', label: '16k triangles, full head' },
  { id: 'ps2_body_20k', label: '20k triangles, full head' },
  { id: 'ps2_body_full', label: 'Full MakeHuman body (27k)' },
];

const SIZES: TextureSize[] = [512, 1024, 2048];

const OVERRIDE_LABEL: Record<string, string> = {
  triangleBudget: 'triangle budget',
  hardMax: 'hard max',
  hairBudget: 'hair triangles',
  headTexture: 'head texture',
  bodyTexture: 'body texture',
  hairTexture: 'hair texture',
  garmentAtlas: 'garment atlas',
  eyesAtlas: 'eyes atlas',
  lighting: 'lighting',
  shadows: 'shadows',
  bakeAO: 'occlusion bake',
  bakeLight: 'light bake',
};

function SizeSelect(props: { id: string; label: string; value: TextureSize; onChange: (v: TextureSize) => void }) {
  return (
    <div className="picker-row">
      <label htmlFor={props.id}>{props.label}</label>
      <select id={props.id} value={props.value} onChange={(e) => props.onChange(Number(e.target.value) as TextureSize)}>
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

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
  const overrides = profileOverrides(ex);
  const size = (key: 'headTexture' | 'bodyTexture' | 'hairTexture' | 'garmentAtlas' | 'eyesAtlas', label: string) => (
    <SizeSelect id={`export-${key}`} label={label} value={ex[key]} onChange={(v) => set(label, (x) => void (x[key] = v))} />
  );
  // Choosing a profile sets every budget at once and the body tier it starts with (F13).
  const chooseProfile = (id: QualityProfileId) =>
    studio.engine.update(`${QUALITY_PROFILES[id].label} profile`, (d) => {
      d.export = { ...d.export, ...profileSettings(id) } as ExportSettings;
      d.bodyMesh = bodyMeshFor(id);
      withBakeLayers(d);
    });

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
        <label htmlFor="export-profile">Quality profile</label>
        <select id="export-profile" value={ex.profile} onChange={(e) => chooseProfile(e.target.value as QualityProfileId)} data-testid="export-profile">
          {QUALITY_PROFILE_IDS.map((id) => (
            <option key={id} value={id}>
              {QUALITY_PROFILES[id].label}
            </option>
          ))}
        </select>
      </div>
      <p className="hint" data-testid="profile-description">
        {QUALITY_PROFILES[ex.profile].description}
        {overrides.length > 0 && (
          <>
            {' '}
            Changed here: {overrides.map((k) => OVERRIDE_LABEL[k] ?? k).join(', ')}.{' '}
            <button className="link" onClick={() => chooseProfile(ex.profile)} data-testid="profile-reset">
              Reset to profile
            </button>
          </>
        )}
      </p>
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
        <label htmlFor="export-hairbudget">Hair triangles</label>
        <input
          id="export-hairbudget"
          type="number"
          min={500}
          max={20000}
          step={500}
          value={ex.hairBudget}
          onChange={(e) => set('Hair triangles', (x) => void (x.hairBudget = Math.min(20000, Math.max(500, Number(e.target.value) || 3500))))}
        />
      </div>
      {size('headTexture', 'Head texture')}
      {size('bodyTexture', 'Body texture')}
      {size('hairTexture', 'Hair texture')}
      {size('garmentAtlas', 'Garment atlas')}
      {size('eyesAtlas', 'Eyes atlas')}
      <div className="picker-row">
        <label htmlFor="export-lighting">Unity lighting</label>
        <select id="export-lighting" value={ex.lighting} onChange={(e) => set('Unity lighting', (x) => void (x.lighting = e.target.value as ExportSettings['lighting']))}>
          <option value="vertex">Per vertex</option>
          <option value="pixel">Per pixel</option>
        </select>
      </div>
      <div className="picker-row">
        <label htmlFor="export-shadows">Shadows</label>
        <select id="export-shadows" value={ex.shadows} onChange={(e) => set('Shadows', (x) => void (x.shadows = e.target.value as ExportSettings['shadows']))}>
          <option value="off">Off</option>
          <option value="key">Key light and flashlight</option>
          <option value="self">Self-shadowing</option>
        </select>
      </div>
      <label className="check">
        <input type="checkbox" checked={ex.bakeAO} onChange={(e) =>
            studio.engine.update('Occlusion bake', (d) => {
              d.export.bakeAO = e.target.checked;
              withBakeLayers(d);
            })
          } /> Bake occlusion into the textures
      </label>
      <label className="check">
        <input type="checkbox" checked={ex.bakeLight} onChange={(e) =>
            studio.engine.update('Light bake', (d) => {
              d.export.bakeLight = e.target.checked;
              withBakeLayers(d);
            })
          } /> Bake sky and key light shadowing into the textures
      </label>
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
