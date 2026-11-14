/**
 * Data folder (M18): where characters, the library and settings are kept.
 * Moving it copies everything to the new folder, checks every copy, and
 * switches on the next start; the old folder is left as it was. A folder that
 * already holds PS2CC data is used as it is.
 */
import { useEffect, useState } from 'react';
import { backend, isDesktop, type DataFolder, type MovePlan } from '../backend';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

const mb = (bytes: number) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(bytes < 1e8 ? 1 : 0)} MB`);

export function DataFolderDialog() {
  const open = useUi((s) => s.dataFolderOpen);
  const setOpen = useUi((s) => s.setDataFolderOpen);
  if (!open) return null;
  return <DataFolderBody onClose={() => setOpen(false)} />;
}

export function DataFolderBody({ onClose }: { onClose?: () => void }) {
  const studio = useStudio();
  const ui = useUi();
  const [info, setInfo] = useState<DataFolder | null>(null);
  const [plan, setPlan] = useState<MovePlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void backend.dataFolder().then(setInfo);
  }, []);
  useEffect(() => backend.onDataFolderProgress((d, t) => setBusy(`Copying and checking ${d} of ${t} files…`)), []);

  const choose = async () => {
    setError(null);
    setDone(null);
    try {
      setPlan(await backend.chooseDataFolder());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const move = async () => {
    if (!plan) return;
    if (studio.dirty && !window.confirm('The character has unsaved changes. Save it first (Ctrl+S), or continue and save after the restart?')) return;
    setError(null);
    setBusy(plan.mode === 'copy' ? 'Copying…' : 'Switching…');
    try {
      const p = await backend.moveDataFolder(plan.root);
      setDone(p.root);
      setPlan(null);
    } catch (err) {
      setError(`Nothing was changed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };
  const switchToDefault = async () => {
    try {
      await backend.useDefaultDataFolder();
      setDone(info?.default ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const restart = async () => {
    if (studio.dirty) await studio.save().catch((err: unknown) => ui.error('Save failed', err));
    await backend.restart();
  };

  return (
    <div className={onClose ? 'modal-backdrop' : ''} onClick={onClose}>
      <div className={onClose ? 'modal data-folder' : 'data-folder'} role="dialog" aria-labelledby="data-folder-title" data-testid="data-folder" onClick={(e) => e.stopPropagation()}>
        <h2 id="data-folder-title">Data folder</h2>
        <p className="hint">Your characters, library (saved garments, hairstyles, materials, skins, outfits, presets) and settings are kept together here. Exports go to your Unity project or the folder you choose.</p>
        <p className="path-line" data-testid="data-folder-path">
          {info?.path ?? '…'} {info?.isDefault && <span className="muted">(the default)</span>}
        </p>
        {info?.fallback && <p className="hint warn">{info.fallback}</p>}
        {info?.fromEnv && <p className="hint">Set by the PS2CC_HOME environment variable: change that to move it.</p>}
        {!isDesktop() && <p className="hint">In a browser, characters are kept in the browser's storage.</p>}
        {plan && (
          <div className="plan" data-testid="data-folder-plan">
            {plan.mode === 'copy' ? (
              <p>
                Copy {plan.files.toLocaleString()} files ({mb(plan.bytes)}) to <strong>{plan.root}</strong>, check every copy, and use it from the next start. This folder stays as it is.
              </p>
            ) : (
              <p>
                <strong>{plan.root}</strong> already holds PS2CC data: use it from the next start. Nothing is copied.
              </p>
            )}
            <div className="button-row">
              <button className="primary" onClick={() => void move()} disabled={busy !== null} data-testid="data-folder-move">
                {plan.mode === 'copy' ? 'Copy and switch' : 'Switch'}
              </button>
              <button onClick={() => setPlan(null)} disabled={busy !== null}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {busy && <p className="hint">{busy}</p>}
        {done !== null && (
          <div className="plan">
            <p>Done. PS2CC uses {done || 'the default folder'} from its next start.</p>
            <button className="primary" onClick={() => void restart()} data-testid="data-folder-restart">
              Restart now
            </button>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          {isDesktop() && !info?.fromEnv && (
            <button onClick={() => void choose()} disabled={busy !== null} data-testid="data-folder-choose">
              Change…
            </button>
          )}
          {isDesktop() && info && !info.isDefault && !info.fromEnv && (
            <button onClick={() => void switchToDefault()} disabled={busy !== null}>
              Use the default folder
            </button>
          )}
          {onClose && <button onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  );
}
