import { useState } from 'react';
import { QUALITY_PROFILE_IDS, QUALITY_PROFILES, type QualityProfileId } from '@ps2cc/core';
import { backend, isDesktop, type Settings } from '../backend';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

/**
 * First-run setup (PRD M9): the Unity project exports go to, and the quality
 * profile new characters start with (F13). Shown once; both can be changed
 * later (Export panel).
 */
export function FirstRunSetup() {
  const studio = useStudio();
  const ui = useUi();
  const [open, setOpen] = useState(() => Boolean(studio.settings && !studio.settings.firstRunCompleted));
  const [project, setProject] = useState(studio.settings?.unityProject ?? '');
  const [version, setVersion] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [profile, setProfile] = useState<QualityProfileId>(studio.settings?.qualityProfile ?? 'enhanced');
  if (!open || !studio.settings) return null;

  const check = async (dir: string): Promise<boolean> => {
    if (!dir.trim()) {
      setProblem(null);
      setVersion(null);
      return true; // optional: it can be chosen later
    }
    try {
      const v = await backend.checkUnityProject(dir);
      setVersion(v);
      setProblem(null);
      return true;
    } catch (err) {
      setVersion(null);
      setProblem(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const browse = async () => {
    try {
      const dir = await backend.pickUnityProject();
      if (dir) {
        setProject(dir);
        await check(dir);
      }
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };

  const finish = async (skip: boolean) => {
    const dir = skip ? '' : project.trim();
    if (!skip && !(await check(dir))) return;
    const next: Settings = { ...studio.settings!, firstRunCompleted: true, qualityProfile: skip ? studio.settings!.qualityProfile : profile };
    if (dir) next.unityProject = dir;
    try {
      await backend.saveSettings(next);
      studio.settings = next;
      // The open character is still the untouched first one: start it again from the new defaults.
      if (!studio.dirty) studio.loadText(JSON.stringify(studio.newDocument(studio.engine.doc.name)));
      setOpen(false);
    } catch (err) {
      ui.error('Could not save the settings', err);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-labelledby="firstrun-title" data-testid="first-run">
        <h2 id="firstrun-title">Welcome to PS2CC</h2>
        <p>Characters export straight into a Unity project, under Assets/PS2CC/. Choose the project now, or later in the Export panel.</p>
        <label className="field">
          <span>Unity project folder</span>
          <div className="field-row">
            <input
              type="text"
              value={project}
              placeholder="C:\Projects\MyGame"
              onChange={(e) => {
                setProject(e.target.value);
                setProblem(null);
                setVersion(null);
              }}
              onBlur={() => void check(project)}
              aria-label="Unity project folder"
              data-testid="firstrun-project"
            />
            {isDesktop() && <button onClick={() => void browse()}>Browse…</button>}
          </div>
        </label>
        {/* One fixed status line, so the buttons never move while the folder is checked (a click would miss them). */}
        <p className={problem ? 'error-text status-line' : 'muted status-line'} data-testid={problem ? 'firstrun-problem' : 'firstrun-status'}>
          {problem ?? (version !== null ? `Unity project found${version ? ` (made with Unity ${version})` : ''}.` : '\u00a0')}
        </p>
        <p className="hint">Install the Unity package once in that project: Package Manager → Add package from disk → com.ps2cc.importer/package.json.</p>
        <label className="field">
          <span>Quality profile</span>
          <select value={profile} onChange={(e) => setProfile(e.target.value as QualityProfileId)} aria-label="Quality profile" data-testid="firstrun-profile">
            {QUALITY_PROFILE_IDS.map((id) => (
              <option key={id} value={id}>
                {QUALITY_PROFILES[id].label}
                {id === 'enhanced' ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{QUALITY_PROFILES[profile].description}</p>
        <div className="modal-actions">
          <button className="primary" onClick={() => void finish(false)} data-testid="firstrun-done">
            Start
          </button>
          <button onClick={() => void finish(true)}>Skip for now</button>
        </div>
      </div>
    </div>
  );
}
