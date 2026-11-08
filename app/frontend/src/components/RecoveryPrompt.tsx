import { useState } from 'react';
import { backend } from '../backend';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

/** Crash recovery prompt on start (PRD F10). */
export function RecoveryPrompt() {
  const studio = useStudio();
  const error = useUi((s) => s.error);
  const [open, setOpen] = useState(Boolean(studio.info.recoveryPath));
  if (!open) return null;
  const when = new Date(studio.info.recoveryModified).toLocaleString();
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-labelledby="recovery-title">
        <h2 id="recovery-title">PS2CC closed unexpectedly</h2>
        <p>An autosave from {when} is available. Restore it?</p>
        <div className="modal-actions">
          <button
            className="primary"
            onClick={() => {
              backend
                .load(studio.info.recoveryPath)
                .then((text) => studio.loadText(text, { unsaved: true }))
                .catch((err: unknown) => error('Could not restore the autosave', err))
                .finally(() => setOpen(false));
            }}
          >
            Restore
          </button>
          <button onClick={() => setOpen(false)}>Start fresh</button>
        </div>
      </div>
    </div>
  );
}
