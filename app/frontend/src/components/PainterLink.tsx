/**
 * Texture Studio (PRD Part 2 F17, D-115): paint a target in Material Painter
 * and bring the paint back. Shown in the Skin panel and the garment inspector.
 */
import { useEffect, useState } from 'react';
import type { PaintTarget } from '@ps2cc/core';
import { backend, isDesktop, type PainterInfo } from '../backend';
import { bringPaintBack, openInPainter, painterProblem } from '../paint/painter';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

const RELEASES = 'https://github.com/alla2001/material-painter/releases';

export function PainterLink({ target, label }: { target: PaintTarget; label: string }) {
  const studio = useStudio();
  const ui = useUi();
  const [info, setInfo] = useState<PainterInfo | null>(null);
  const [busy, setBusy] = useState<'open' | 'collect' | null>(null);
  const [opened, setOpened] = useState(false);
  const [problem, setProblem] = useState<ReturnType<typeof painterProblem> | null>(null);
  const id = target.replace(':', '-');

  useEffect(() => {
    if (!isDesktop()) return;
    void backend.painterStatus().then(setInfo);
    void backend.painterHasSession(studio.engine.doc.name, target).then(setOpened);
  }, [studio, target]);

  if (!isDesktop()) return <p className="hint">Painting in Material Painter needs the desktop app.</p>;
  if (!info) return null;

  const fail = (what: string, err: unknown) => {
    const p = painterProblem(err);
    setProblem(p);
    if (p.code === null) ui.error(what, err);
  };
  const open = async () => {
    setBusy('open');
    setProblem(null);
    try {
      await openInPainter(studio, target);
      setOpened(true);
      ui.info(`${label} is open in Material Painter: paint on the layers above the PS2CC reference, then press Bring paint back.`);
    } catch (err) {
      fail('Could not open Material Painter', err);
    } finally {
      setBusy(null);
    }
  };
  const collect = async () => {
    setBusy('collect');
    setProblem(null);
    try {
      const texels = await bringPaintBack(studio, target);
      ui.info(texels ? `Brought back ${texels.toLocaleString()} painted texels` : 'Nothing was painted yet');
    } catch (err) {
      fail('Could not bring the paint back', err);
    } finally {
      setBusy(null);
    }
  };
  const locate = async () => {
    const exe = await backend.painterLocate();
    if (exe) setInfo({ exe, found: true });
  };
  const enableAgents = async () => {
    try {
      await backend.painterEnableAgents();
      setProblem({ code: null, message: 'Agent control is on from Material Painter\'s next start: close Material Painter, then press Paint again.' });
    } catch (err) {
      ui.error('Could not change Material Painter\'s preferences', err);
    }
  };

  return (
    <div className="painter-link" data-testid={`painter-${id}`}>
      {!info.found ? (
        <>
          <p className="hint">
            Material Painter is not installed (free, GPL-3.0): get it from {RELEASES}, then press Locate if it is not in the usual folder.
          </p>
          <button onClick={() => void locate()}>Locate Material Painter…</button>
        </>
      ) : (
        <div className="button-row">
          <button disabled={busy !== null} onClick={() => void open()} data-testid={`paint-open-${id}`} title={`Opens ${label.toLowerCase()} in Material Painter over its current texture`}>
            {busy === 'open' ? 'Opening Material Painter…' : opened ? 'Paint again in Material Painter' : 'Paint in Material Painter'}
          </button>
          <button disabled={busy !== null || !opened} onClick={() => void collect()} data-testid={`paint-collect-${id}`} title="Takes what you painted back into PS2CC (one undo step)">
            {busy === 'collect' ? 'Bringing back…' : 'Bring paint back'}
          </button>
        </div>
      )}
      {problem && (
        <p className="hint warn" data-testid={`painter-problem-${id}`}>
          {problem.message}
          {problem.code === 'agents-off' && (
            <>
              {' '}
              <button onClick={() => void enableAgents()}>Turn on agent control</button>
            </>
          )}
          {problem.code === 'not-found' && (
            <>
              {' '}
              <button onClick={() => void locate()}>Locate Material Painter…</button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
