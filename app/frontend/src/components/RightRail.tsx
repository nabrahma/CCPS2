import { useUi } from '../state/ui';
import { InspectIcon, SlidersIcon } from './icons';
import { AppearanceStep, CreateStep, ExportStep, HairStep, LookStep, WardrobeStep } from './creator/Steps';
import { Inspector } from './Inspector';
import { TABS } from './Sidebar';
import { StudioRail } from './studio/StudioRail';

/**
 * The right column: the creator step's controls, or details of the part
 * clicked in the viewport; in the Asset Studio, the open studio's editor.
 */
export function RightRail() {
  const tab = useUi((s) => s.tab);
  const mode = useUi((s) => s.railMode);
  const setMode = useUi((s) => s.setRailMode);
  const inStudio = useUi((s) => s.assetStudio !== null);
  const step = TABS.find((t) => t.id === tab);
  const label = step?.label ?? '';
  return (
    <aside className="rail">
      <div className="rail-switch">
        <button className={mode === 'controls' ? 'active' : ''} aria-pressed={mode === 'controls'} onClick={() => setMode('controls')}>
          <SlidersIcon /> Controls
        </button>
        <button className={mode === 'inspect' ? 'active' : ''} aria-pressed={mode === 'inspect'} onClick={() => setMode('inspect')}>
          <InspectIcon /> Inspect
        </button>
      </div>
      <section className="rail-card">
        {mode === 'inspect' && <Inspector />}
        {inStudio && mode === 'controls' && <StudioRail />}
        {/* Kept mounted while inspecting, so filters and open sections survive the switch. */}
        <div className="rail-section" hidden={mode !== 'controls' || inStudio}>
          <p className="card-label">
            {step?.step} {label}
          </p>
          <div className="panel" role="tabpanel" aria-label={label}>
            {tab === 'create' && <CreateStep />}
            {tab === 'hair' && <HairStep />}
            {tab === 'wardrobe' && <WardrobeStep />}
            {tab === 'appearance' && <AppearanceStep />}
            {tab === 'look' && <LookStep />}
            {tab === 'export' && <ExportStep />}
          </div>
        </div>
      </section>
    </aside>
  );
}
