/**
 * The parts tree (M18): the character as an outline, like a scene tree. Body
 * and face regions open their sliders; skin, hair, eyes, brows, lashes, teeth
 * and every garment open their controls; the eye toggles hide a part in the
 * viewport (not in the export). Look and Export are at the bottom, and the
 * sliders you marked with a heart under Favourite sliders.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { ScenePart } from '@ps2cc/core';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { useLibrary } from '../../state/library';
import { useUi } from '../../state/ui';
import { EyeIcon, HeartIcon } from '../icons';

/** Slider groups of one tab, in the catalog's order. */
function groupsOf(list: readonly { tab: string; group: string }[], tab: string): string[] {
  return [...new Set(list.filter((s) => s.tab === tab).map((s) => s.group))];
}

const FACE_PART_KINDS = new Set(['eyes', 'eyebrows', 'eyelashes', 'teeth']);

/** Plain names for the face parts (their assets have MakeHuman's names, like "eyebrow001"). */
function partName(p: ScenePart): string {
  if (p.key === 'eyes') return 'Eyes';
  if (p.key === 'eyebrows') return 'Eyebrows';
  if (p.key === 'eyelashes') return 'Eyelashes';
  if (p.key === 'teeth') return 'Teeth';
  if (p.key === 'tongue') return 'Tongue';
  if (p.kind === 'eyebrows') return 'Card eyebrows';
  return p.label;
}

export function PartsTree() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const favourites = useLibrary((s) => s.favourites);
  const [open, setOpen] = useState<Record<string, boolean>>({ character: true, body: false, face: false, cloth: true, scene: true });
  const sliders = useMemo(() => studio.assets.sliders.search('', ui.curated), [studio, ui.curated]);
  const bodyGroups = useMemo(() => groupsOf(sliders, 'body'), [sliders]);
  const faceGroups = useMemo(() => groupsOf(sliders, 'face'), [sliders]);
  const parts = studio.scene.parts;
  const garments = parts.filter((p) => p.kind === 'garment' || p.kind === 'fur');
  const faceParts = parts.filter((p) => FACE_PART_KINDS.has(p.kind) || (p.kind === 'eyebrows' && p.key !== 'eyebrows'));
  const hair = parts.find((p) => p.kind === 'hair');
  const body = parts.find((p) => p.kind === 'body');
  const favouriteSliders = favourites.filter((f) => f.startsWith('slider:')).length;

  const modify = ui.dockTab === 'modify' && ui.assetStudio === null;
  const controls = modify && ui.railMode === 'controls';
  const f = ui.sliderFocus;
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const sliderActive = (sub: 'body' | 'face', group: string | null) => controls && ui.tab === 'create' && f.sub === sub && f.group === group && !f.favourites;
  const appearancePart = (key: string) => {
    ui.setTab('appearance');
    useUi.setState({ selected: key });
  };

  return (
    <div className="parts-tree" role="tree" aria-label="Character parts" data-testid="parts-tree">
      <Group id="character" label="Character" open={open.character ?? false} onToggle={toggle}>
        <Group
          id="body"
          label="Body"
          depth={1}
          open={open.body ?? false}
          onToggle={toggle}
          active={sliderActive('body', null)}
          onSelect={() => ui.focusSliders({ sub: 'body' })}
          testId="tree-body"
        >
          {bodyGroups.map((g) => (
            <Row key={g} depth={2} label={g} active={sliderActive('body', g)} onSelect={() => ui.focusSliders({ sub: 'body', group: g })} testId={`tree-group-${g}`} />
          ))}
        </Group>
        <Group
          id="face"
          label="Head & face"
          depth={1}
          open={open.face ?? false}
          onToggle={toggle}
          active={sliderActive('face', null)}
          onSelect={() => ui.focusSliders({ sub: 'face' })}
          testId="tree-face"
        >
          {faceGroups.map((g) => (
            <Row key={g} depth={2} label={g} active={sliderActive('face', g)} onSelect={() => ui.focusSliders({ sub: 'face', group: g })} testId={`tree-group-${g}`} />
          ))}
        </Group>
        {body && <PartRow part={body} label="Skin" active={controls && ui.tab === 'appearance' && !faceParts.some((p) => p.key === ui.selected)} onSelect={() => ui.setTab('appearance')} />}
        {hair && <PartRow part={hair} label="Hair" active={controls && ui.tab === 'hair'} onSelect={() => ui.setTab('hair')} />}
        {faceParts.map((p) => (
          <PartRow key={p.key} part={p} label={partName(p)} active={controls && ui.tab === 'appearance' && ui.selected === p.key} onSelect={() => appearancePart(p.key)} />
        ))}
      </Group>
      <Group id="cloth" label={`Cloth (${garments.filter((g) => g.kind === 'garment').length})`} open={open.cloth ?? false} onToggle={toggle} active={controls && ui.tab === 'wardrobe'} onSelect={() => ui.setTab('wardrobe')} testId="tree-cloth">
        {garments.length === 0 && <Row depth={1} label="Nothing worn: pick garments in 03 Wardrobe" muted onSelect={() => ui.setTab('wardrobe')} />}
        {garments.map((p) => (
          <PartRow key={p.key} part={p} label={p.label.replace(/_/g, ' ')} active={modify && ui.railMode === 'inspect' && ui.selected === p.key} onSelect={() => ui.select(p.key)} />
        ))}
      </Group>
      <Group id="scene" label="Scene" open={open.scene ?? false} onToggle={toggle}>
        <Row depth={1} label="Look & lighting" active={controls && ui.tab === 'look'} onSelect={() => ui.setTab('look')} testId="tree-look" />
        <Row depth={1} label="Export" active={controls && ui.tab === 'export'} onSelect={() => ui.setTab('export')} testId="tree-export" />
      </Group>
      <Row
        depth={0}
        label={`Favourite sliders${favouriteSliders ? ` (${favouriteSliders})` : ''}`}
        icon={<HeartIcon filled={favouriteSliders > 0} />}
        active={controls && ui.tab === 'create' && f.favourites}
        onSelect={() => ui.focusSliders({ sub: f.sub, favourites: true })}
        testId="tree-favourites"
      />
    </div>
  );
}

function Group(props: {
  id: string;
  label: string;
  depth?: number;
  open: boolean;
  onToggle: (id: string) => void;
  active?: boolean;
  onSelect?: () => void;
  testId?: string;
  children: ReactNode;
}) {
  const depth = props.depth ?? 0;
  return (
    <div role="group">
      <div className={props.active ? 'tree-row active' : 'tree-row'} style={{ paddingLeft: 6 + depth * 14 }} role="treeitem" aria-expanded={props.open} aria-selected={props.active ?? false} data-testid={props.testId}>
        <button className="tree-twist" onClick={() => props.onToggle(props.id)} aria-label={props.open ? `Collapse ${props.label}` : `Expand ${props.label}`}>
          {props.open ? '▾' : '▸'}
        </button>
        <button className="tree-label" onClick={() => (props.onSelect ? props.onSelect() : props.onToggle(props.id))}>
          {props.label}
        </button>
      </div>
      {props.open && props.children}
    </div>
  );
}

function Row(props: { depth: number; label: string; active?: boolean; muted?: boolean; icon?: ReactNode; onSelect: () => void; testId?: string; tail?: ReactNode }) {
  return (
    <div className={`tree-row${props.active ? ' active' : ''}${props.muted ? ' muted' : ''}`} style={{ paddingLeft: 6 + props.depth * 14 + 16 }} role="treeitem" aria-selected={props.active ?? false} data-testid={props.testId}>
      {props.icon}
      <button className="tree-label" onClick={props.onSelect} title={props.label}>
        {props.label}
      </button>
      {props.tail}
    </div>
  );
}

/** A part of the character: its row, with an eye that hides it in the viewport. */
function PartRow({ part, label, active, onSelect }: { part: ScenePart; label: string; active: boolean; onSelect: () => void }) {
  const hidden = useUi((s) => s.hiddenParts.includes(part.key));
  const toggleHidden = useUi((s) => s.toggleHidden);
  return (
    <Row
      depth={1}
      label={label}
      active={active}
      onSelect={onSelect}
      testId={`tree-part-${part.key}`}
      tail={
        <button className={hidden ? 'tree-eye off' : 'tree-eye'} onClick={() => toggleHidden(part.key)} aria-label={hidden ? `Show ${label}` : `Hide ${label}`} aria-pressed={!hidden} title={hidden ? 'Hidden in the viewport (still exported)' : 'Hide in the viewport'} data-testid={`tree-eye-${part.key}`}>
          <EyeIcon off={hidden} />
        </button>
      }
    />
  );
}
