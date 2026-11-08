import { useUi } from '../state/ui';
import { InspectIcon, SlidersIcon } from './icons';
import { Inspector } from './Inspector';
import { ExportPanel } from './panels/ExportPanel';
import { ExpressionsPanel } from './panels/ExpressionsPanel';
import { HairPanel } from './panels/HairPanel';
import { SkinPanel } from './panels/SkinPanel';
import { SliderPanel } from './panels/SliderPanel';
import { WardrobePanel } from './panels/WardrobePanel';
import { TABS } from './Sidebar';

/** The right column: the current section's controls, or details of the part clicked in the viewport. */
export function RightRail() {
  const tab = useUi((s) => s.tab);
  const mode = useUi((s) => s.railMode);
  const setMode = useUi((s) => s.setRailMode);
  const label = TABS.find((t) => t.id === tab)?.label ?? '';
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
        {/* Kept mounted while inspecting, so filters and open sections survive the switch. */}
        <div className="rail-section" hidden={mode !== 'controls'}>
          <p className="card-label">{label}</p>
          <div className="panel" role="tabpanel" aria-label={label}>
            {tab === 'body' && <SliderPanel tab="body" />}
            {tab === 'face' && <SliderPanel tab="face" />}
            {tab === 'skin' && <SkinPanel />}
            {tab === 'hair' && <HairPanel />}
            {tab === 'wardrobe' && <WardrobePanel />}
            {tab === 'expressions' && <ExpressionsPanel />}
            {tab === 'export' && <ExportPanel />}
          </div>
        </div>
      </section>
    </aside>
  );
}
