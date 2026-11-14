import { useEffect, useState } from 'react';
import { useStudio, useStudioVersion } from '../state/hooks';
import { BakeStatus } from './workspace/TopBar';

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Always-visible budget (PRD F11), in the status bar along the bottom of the window (M18). */
export function BudgetBar() {
  const studio = useStudio();
  useStudioVersion();
  const b = studio.scene.budget();
  const [stats, setStats] = useState({ fps: 0, morphMs: 0 });
  useEffect(() => {
    const t = window.setInterval(() => {
      setStats({ fps: studio.viewport?.stats.fps ?? 0, morphMs: studio.engine.lastUpdateMs });
    }, 500);
    return () => window.clearInterval(t);
  }, [studio]);
  const pct = Math.min(100, (b.total / b.hardMax) * 100);
  return (
    <footer className={`statusbar budget budget-${b.state}`} data-testid="budget">
      <span className="budget-total" title={`${b.total.toLocaleString()} triangles; ${k(b.target)} target, ${k(b.hardMax)} maximum`}>
        Triangles <b>{k(b.total)}</b> / {k(b.target)}
      </span>
      <span className="meter" role="img" aria-label={`${b.total} triangles of ${b.hardMax}`}>
        <span className="meter-fill" style={{ width: `${pct}%` }} />
        <span className="meter-target" style={{ left: `${(b.target / b.hardMax) * 100}%` }} />
      </span>
      {b.exportBlocked && <span className="badge-over">Over the maximum: export blocked</span>}
      <span className="budget-rows">
        <span>Head <b>{k(b.head)}</b></span>
        <span>Body <b>{k(b.body)}</b></span>
        <span>Hair <b>{k(b.hair)}</b></span>
        <span>Garments <b>{k(b.garments)}</b></span>
        <span>Eyes &amp; brows <b>{k(b.eyesAndBrows)}</b></span>
        <span title="Texture memory of the export in Unity (RGBA8 with mipmaps, before any compression)" data-testid="budget-textures">
          Textures <b>{(b.textureBytes / (1024 * 1024)).toFixed(1)} MB</b>
        </span>
        <span title="Export skeleton (GameEngine, no face bones)">Bones <b>{studio.engine.skeleton.rig.boneCount}</b></span>
        <span title="Expression blendshapes baked at export (06 Export)" data-testid="budget-blendshapes">
          Blendshapes <b>{studio.engine.doc.expressionsToBake.length}</b>
        </span>
      </span>
      <span className="sb-spacer" />
      <BakeStatus />
      <span className="perf" title="Viewport frame rate and last morph update time">
        {stats.fps.toFixed(0)} fps · morph {stats.morphMs.toFixed(1)} ms
      </span>
    </footer>
  );
}
