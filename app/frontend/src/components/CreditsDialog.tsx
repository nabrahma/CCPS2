import { useEffect, useState } from 'react';
import { buildCredits, type CreditEntry, type Credits } from '@ps2cc/core';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

/** Software inside the app (THIRD_PARTY_NOTICES.md has the full list and where each is used). */
const SOFTWARE: { name: string; licence: string; note?: string }[] = [
  { name: 'MakeHuman', licence: 'AGPL-3.0', note: 'morph, macro and clothes-fitting logic is ported from it' },
  { name: 'Blender io_scene_fbx', licence: 'GPL-2.0-or-later', note: 'the FBX writer is ported from it' },
  { name: 'MPFB', licence: 'GPL-3.0', note: 'rig and weight formats' },
  { name: 'Hair cards from curves, by Daniel Bystedt', licence: 'method only', note: 'the card hair system follows this Blender setup' },
  { name: 'MediaPipe Tasks Vision', licence: 'Apache-2.0', note: 'face landmarks' },
  { name: 'ufbx', licence: 'MIT or public domain' },
  { name: 'meshoptimizer', licence: 'MIT' },
  { name: 'Three.js', licence: 'MIT' },
  { name: 'React', licence: 'MIT' },
  { name: 'Zustand', licence: 'MIT' },
  { name: 'Wails', licence: 'MIT' },
];

/** Help → Credits (PRD 9.2). Built from the licence manifest, so it always matches what ships. */
export function CreditsDialog({ onClose }: { onClose: () => void }) {
  const studio = useStudio();
  const ui = useUi();
  const [credits, setCredits] = useState<Credits | null>(null);

  useEffect(() => {
    studio.assets
      .licenceManifest()
      .then((m) => setCredits(buildCredits(m)))
      .catch((err: unknown) => {
        ui.error('Could not read the credits', err);
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop">
      <div className="modal credits-modal" role="dialog" aria-labelledby="credits-title" data-testid="credits">
        <h2 id="credits-title">Credits</h2>
        <p className="muted">
          PS2CC {studio.info.version} is free software under the AGPL-3.0-or-later. Characters you export are yours.
        </p>
        {!credits && <p className="muted">Loading…</p>}
        {credits && (
          <div className="credits-body">
            <h3>Assets that require credit</h3>
            <ul className="credits-list" data-testid="credits-attribution">
              {credits.attribution.map((e) => (
                <Entry key={`${e.author}|${e.source}|${e.licence}`} entry={e} />
              ))}
            </ul>
            <h3>Software</h3>
            <ul className="credits-list">
              {SOFTWARE.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong> <span className="muted">{s.licence}</span>
                  {s.note && <div className="muted">{s.note}</div>}
                </li>
              ))}
            </ul>
            <h3>Character data (CC0, credited with thanks)</h3>
            <ul className="credits-list">
              {credits.courtesy.map((e) => (
                <Entry key={`${e.author}|${e.source}|${e.licence}`} entry={e} />
              ))}
            </ul>
            <p className="muted">
              {credits.files} files ship with the app: {credits.licences.map(([l, n]) => `${n} ${l}`).join(', ')}. assets/core/LICENSES.json lists each one.
            </p>
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Entry({ entry: e }: { entry: CreditEntry }) {
  return (
    <li>
      <strong>{e.author}</strong> <span className="muted">{e.licence}</span>
      <div className="muted">
        {e.source && `${e.source} · `}
        {e.files} file{e.files === 1 ? '' : 's'}
        {e.modified ? ' · simplified for PS2 budgets by PS2CC' : ''}
      </div>
      {e.licence !== 'CC0-1.0' && e.assets.length > 0 && <div className="muted">{e.assets.join(', ')}</div>}
      {/* Plain text: the app makes no network calls and has no browser to open a link in. */}
      <div className="credits-url">{e.sourceUrl}</div>
    </li>
  );
}
