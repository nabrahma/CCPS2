/**
 * The editor's category panels (D-149): one per part of the character, each
 * with only that part's controls, the common ones first and the rest folded
 * away. The deep editors are in the Asset Studio, opened from a panel's
 * "Edit in … Studio".
 */
import { useRef, type ReactNode } from 'react';
import {
  bodyMeshFor,
  HAIR_COLOUR_PRESETS,
  hairColourKey,
  layerKind,
  LookError,
  NEUTRAL_ADJUST,
  newLayer,
  parseLook,
  presetFromCharacter,
  profileSettings,
  QUALITY_PROFILE_IDS,
  QUALITY_PROFILES,
  withBakeLayers,
  withScalpLayer,
  type ExportSettings,
  type GarmentSlotName,
  type LayerKind,
  type LightingModel,
  type QualityProfileId,
  type ShadowMode,
} from '@ps2cc/core';
import { DEFAULT_POST, LIGHTING_PRESETS, PS2_POST, type LightingPresetId } from '@ps2cc/viewport';
import { backend } from '../../backend';
import { useStudio, useStudioVersion } from '../../state/hooks';
import { materialTarget, refreshUserLibrary, type CreatorEntry } from '../../state/library';
import { useUi } from '../../state/ui';
import { LibraryGrid, Thumb, type LibraryFacet } from '../library/LibraryGrid';
import { ExportPanel } from '../panels/ExportPanel';
import { ExpressionsPanel } from '../panels/ExpressionsPanel';
import { EyesControls, MouthControls, PaintedPart } from '../panels/FacePartsSection';
import { GarmentInspector } from '../Inspector';
import { VisibilityToggle } from '../workspace/Dock';
import { plain } from '../../state/names';
import { TintRow } from '../panels/HairPanel';
import { SliderPanel } from '../panels/SliderPanel';

function Section({ title, children, open = true, testId }: { title: string; children: ReactNode; open?: boolean; testId?: string }) {
  return (
    <details className="hair-section" open={open} data-testid={testId}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function StudioButton({ label, testId, onClick, hint }: { label: string; testId: string; onClick: () => void; hint: string }) {
  return (
    <button className="studio-link" onClick={onClick} data-testid={testId} title={hint}>
      {label}
    </button>
  );
}

// ------------------------------------------------------------------ Body and Face

export function BodyPanel() {
  const studio = useStudio();
  const ui = useUi();
  const savePreset = async () => {
    const name = window.prompt('Save these sliders as a preset named', studio.engine.doc.name)?.trim();
    if (!name) return;
    try {
      await backend.savePreset(name, JSON.stringify(presetFromCharacter(studio.engine.doc, name), null, 2));
      await refreshUserLibrary(studio);
      ui.info(`Saved preset ${name}`);
    } catch (err) {
      ui.error('Could not save the preset', err);
    }
  };
  return (
    <div className="creator-step" data-testid="step-panel-body">
      <Section title="Start from" testId="create-base">
        <LibraryGrid categories={['bodies']} tools={false} testId="create-presets" />
        <button className="link" onClick={() => void savePreset()} data-testid="create-save-preset">
          Save these sliders as a preset…
        </button>
      </Section>
      <SliderPanel tab="body" />
    </div>
  );
}

export function FacePanel() {
  return (
    <div className="creator-step" data-testid="step-panel-face">
      <SliderPanel tab="face" />
    </div>
  );
}

// ------------------------------------------------------------------ Hair

const tagged = (tag: string) => (e: CreatorEntry) => e.tags.includes(tag);

const HAIR_FACETS: LibraryFacet[] = [
  { id: 'short', label: 'Short', test: tagged('short') },
  { id: 'medium', label: 'Medium', test: tagged('medium') },
  { id: 'long', label: 'Long', test: tagged('long') },
  { id: 'editable', label: 'Editable (hair cards)', test: tagged('editable') },
  { id: 'mesh', label: 'Mesh (MakeHuman)', test: tagged('mesh') },
  { id: 'yours', label: 'Yours', test: tagged('yours') },
];

export function HairStep() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const hair = studio.engine.doc.hair;
  const current = hair.colour ? hairColourKey(hair.colour) : null;
  const adjust = hair.adjust ?? NEUTRAL_ADJUST;
  const setColour = (id: string) =>
    studio.engine.update('Hair colour', (d) => {
      d.hair.colour = structuredClone(HAIR_COLOUR_PRESETS[id]!.colour);
      withScalpLayer(d);
    });
  const setAdjust = (key: keyof typeof adjust, v: number) =>
    studio.engine.update(
      'Hair adjust',
      (d) => {
        d.hair.adjust = { ...(d.hair.adjust ?? NEUTRAL_ADJUST), [key]: v };
        withScalpLayer(d);
      },
      `hair-adjust:${key}`,
    );
  return (
    <div className="slider-panel creator-step" data-testid="step-panel-hair">
      <Section title="Hairstyle">
        <LibraryGrid categories={['hair']} testId="hair-styles" limit={18} facets={HAIR_FACETS} allLabel="All styles" />
        <p className="hint">
          <strong>Editable</strong> styles are PS2CC's own hair cards: reshape them in Hair Studio. <strong>Mesh</strong> styles come from MakeHuman's community: a fixed shape you can tint.
        </p>
      </Section>
      {hair.mode === 'cards' && (
        <>
          <Section title="Colour">
            <div className="swatch-row" role="radiogroup" aria-label="Hair colour">
              {Object.entries(HAIR_COLOUR_PRESETS).map(([id, p]) => {
                const on = current === hairColourKey(p.colour);
                const [r = 0, g = 0, b = 0] = p.colour.base.map((c) => c ** (1 / 2.2));
                return (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={on}
                    className={on ? 'swatch active' : 'swatch'}
                    title={p.name}
                    aria-label={p.name}
                    style={{ background: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})` }}
                    onClick={() => setColour(id)}
                    data-testid={`hair-colour-${id}`}
                  />
                );
              })}
            </div>
          </Section>
          <Section title="Adjust">
            {(['length', 'volume', 'fringe'] as const).map((k) => (
              <div className="slider-row" key={k}>
                <label htmlFor={`hair-adjust-${k}`}>{k[0]!.toUpperCase() + k.slice(1)}</label>
                <input
                  id={`hair-adjust-${k}`}
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.01}
                  value={adjust[k]}
                  onChange={(e) => setAdjust(k, Number(e.target.value))}
                  onPointerUp={() => studio.engine.endInteraction()}
                  data-testid={`hair-adjust-${k}`}
                />
              </div>
            ))}
          </Section>
        </>
      )}
      {hair.mode === 'mesh' && (
        <Section title="Colour">
          <TintRow label="Tint" color={hair.tint.color} onChange={(c) => studio.engine.update('Hair tint', (d) => void (d.hair.tint = { ...d.hair.tint, color: c }), 'hair-tint')} />
        </Section>
      )}
      <StudioButton
        label="Edit in Hair Studio"
        testId="open-hair-studio"
        hint="Comb the guides, draw the parting, shape locks and cards, every style setting; save it as a new hairstyle"
        onClick={() => ui.openStudio({ kind: 'hair', target: null })}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Clothes

const SLOT_FACETS: LibraryFacet[] = (
  [
    ['top', 'Tops'],
    ['outer', 'Outerwear'],
    ['bottom', 'Bottoms'],
    ['full', 'Suits and dresses'],
    ['shoes', 'Shoes'],
    ['gloves', 'Gloves'],
    ['hat', 'Hats'],
    ['accessory', 'Accessories'],
    ['yours', 'Yours'],
  ] as const
).map(([id, label]) => ({ id, label, test: id === 'yours' ? tagged('yours') : (e: CreatorEntry) => e.tags[0] === id }));

export function ClothesPanel() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const worn = studio.engine.doc.garments;
  const importGarment = async () => {
    try {
      const path = await backend.pickGarmentFile();
      if (path) ui.openGarmentImport({ path });
    } catch (err) {
      ui.error('Could not import the garment', err);
    }
  };
  const exportBody = async () => {
    try {
      const path = await studio.exportBaseBody();
      if (path) ui.info('Base body exported. Model around it, then import the garment.');
    } catch (err) {
      ui.error('Could not export the base body', err);
    }
  };
  const saveOutfit = async () => {
    const name = window.prompt('Save what the character wears as an outfit named', `${studio.engine.doc.name} outfit`)?.trim();
    if (!name) return;
    try {
      await studio.saveOutfit(name);
      ui.info(`Saved outfit ${name}`);
    } catch (err) {
      ui.error('Could not save the outfit', err);
    }
  };
  const user = studio.assets.catalog.proxies.filter((p) => p.category === 'clothes' && p.tags.includes('user'));
  return (
    <div className="creator-step" data-testid="step-panel-wardrobe">
      <div className="worn">
        <h3>Wearing</h3>
        {worn.length === 0 && <p className="muted">Nothing yet: pick an outfit or garments below.</p>}
        {worn.map((g) => {
          const key = `garment:${g.slot}:${g.asset}`;
          const name = studio.assets.hasProxy(g.asset) ? plain(studio.assets.proxyInfo(g.asset).name) : 'Missing garment';
          const open = ui.selected === key;
          return (
            <div className={open ? 'worn-item-wrap open' : 'worn-item-wrap'} key={g.asset} data-testid="worn-garment" data-part={key}>
              <div className="worn-row">
                <button className="worn-item" onClick={() => ui.select(open ? null : key)} aria-expanded={open} title="Its colour, grime, materials and paint" data-testid="worn-open">
                  <span className="twist">{open ? '▾' : '▸'}</span> {name} <span className="muted">{SLOT_LABEL[g.slot]}</span>
                </button>
                <VisibilityToggle partKey={key} label={name} />
                <button
                  className="icon"
                  aria-label={`Take off ${name}`}
                  title="Take it off"
                  onClick={() => studio.engine.update('Remove garment', (d) => void (d.garments = d.garments.filter((x) => x.asset !== g.asset)))}
                >
                  ×
                </button>
              </div>
              {open && <GarmentInspector partKey={key} />}
            </div>
          );
        })}
        {worn.length > 0 && (
          <button className="link" onClick={() => void saveOutfit()} data-testid="save-outfit">
            Save as outfit…
          </button>
        )}
      </div>
      <Section title="Outfits">
        <LibraryGrid categories={['outfits']} tools={false} testId="wardrobe-outfits" />
      </Section>
      <Section title="Garments">
        <LibraryGrid categories={['garments']} facets={SLOT_FACETS} allLabel="All garments" testId="wardrobe-garments" limit={24} />
      </Section>
      <Section title="Materials" testId="wardrobe-materials-section">
        <p className="hint">Click a material to dress {materialTarget(studio) ? 'the open (or outermost) garment' : 'a garment once one is worn'} in it.</p>
        <LibraryGrid categories={['materials']} tools={false} testId="wardrobe-materials" limit={12} />
        <StudioButton
          label="Make a material in Material Studio"
          testId="open-material-studio"
          hint="From a library material or your own photos and maps; saved to the library for every garment"
          onClick={() => {
            const target = materialTarget(studio);
            ui.openStudio({ kind: 'material', target: null, zone: target ? { partKey: target, zone: 0 } : null });
          }}
        />
      </Section>
      <Section title="Your own garments" open={false}>
        <div className="garment-tools">
          <button data-testid="garment-import" title="Import an OBJ, FBX or GLB modelled around the base body" onClick={() => void importGarment()}>
            Import garment…
          </button>
          <button data-testid="garment-export-body" title="The body to model your own garments around" onClick={() => void exportBody()}>
            Base body (OBJ)…
          </button>
        </div>
        <ul className="asset-list">
          {user.map((p) => (
            <li key={p.id} className="asset-row">
              <span className="asset-name">{plain(p.name)}</span>
              <button
                className="asset-delete"
                title={`Delete ${p.name} from the library`}
                aria-label={`Delete ${p.name}`}
                data-testid="garment-delete"
                onClick={() =>
                  studio.deleteGarment(p.id).then(
                    () => ui.info(`Deleted ${p.name}`),
                    (err: unknown) => ui.error('Could not delete the garment', err),
                  )
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ Skin, eyes, brows, lashes, makeup, mouth

const MAKEUP: LayerKind[] = ['lips', 'eyeliner', 'blush'];
const DETAILS: LayerKind[] = ['freckles', 'stubble', 'darkCircles', 'eyeBags', 'dirt', 'bruises', 'sweat', 'pores', 'stubbleHair'];

const SKIN_FACETS: LibraryFacet[] = [
  { id: 'female', label: 'Female', test: tagged('female') },
  { id: 'male', label: 'Male', test: tagged('male') },
  { id: 'young', label: 'Young', test: tagged('young') },
  { id: 'middle-aged', label: 'Middle-aged', test: tagged('middle-aged') },
  { id: 'old', label: 'Old', test: tagged('old') },
  { id: 'yours', label: 'Yours', test: tagged('yours') },
];

/** One skin layer kind as an on/off switch, its strength and (makeup) its colour. */
function LayerSwitch({ kind }: { kind: LayerKind }) {
  const studio = useStudio();
  const spec = layerKind(kind);
  const layer = studio.engine.doc.skin.layers.find((l) => l.kind === kind);
  const on = Boolean(layer?.enabled);
  const colour = spec.params.find((p) => p.type === 'color');
  const toggle = (v: boolean) =>
    studio.engine.update(`${spec.label} ${v ? 'on' : 'off'}`, (d) => {
      const l = d.skin.layers.find((x) => x.kind === kind);
      if (l) l.enabled = v;
      else if (v) d.skin.layers.push(newLayer(kind));
    });
  const edit = (label: string, fn: (l: (typeof studio.engine.doc.skin.layers)[number]) => void, merge: string) =>
    studio.engine.update(
      label,
      (d) => {
        const l = d.skin.layers.find((x) => x.kind === kind);
        if (l) fn(l);
      },
      merge,
    );
  return (
    <div className={on ? 'layer-switch on' : 'layer-switch'} data-testid={`appearance-${kind}`}>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} data-testid={`appearance-${kind}-on`} /> {spec.label}
      </label>
      {on && layer && (
        <>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={layer.opacity}
            aria-label={`${spec.label} strength`}
            onChange={(e) => edit(`${spec.label} strength`, (l) => void (l.opacity = Number(e.target.value)), `layer-op:${kind}`)}
            onPointerUp={() => studio.engine.endInteraction()}
            data-testid={`appearance-${kind}-strength`}
          />
          {colour && (
            <input
              type="color"
              value={String(layer.params[colour.key] ?? colour.default)}
              aria-label={`${spec.label} colour`}
              onChange={(e) => edit(`${spec.label} colour`, (l) => void (l.params[colour.key] = e.target.value), `layer-col:${kind}`)}
              onBlur={() => studio.engine.endInteraction()}
            />
          )}
        </>
      )}
    </div>
  );
}

export function SkinStep() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const importSkin = async () => {
    try {
      const items = await backend.pickAndImport('skins');
      if (items.length) {
        await refreshUserLibrary(studio);
        ui.info(`Imported ${items[0]!.name}: pick it below`);
      }
    } catch (err) {
      ui.error('Could not import the skin', err);
    }
  };
  return (
    <div className="creator-step" data-testid="step-panel-appearance">
      <Section title="Skin texture">
        <LibraryGrid categories={['skins']} testId="appearance-skins" limit={12} facets={SKIN_FACETS} allLabel="All skins" />
        <button className="link" onClick={() => void importSkin()} title="A full-body skin painted on the MakeHuman (hm08) UV layout">
          Import a skin…
        </button>
      </Section>
      <Section title="Details">
        {DETAILS.map((k) => (
          <LayerSwitch key={k} kind={k} />
        ))}
      </Section>
      <StudioButton
        label="Edit in Texture Studio"
        testId="open-texture-studio"
        hint="Every skin layer and its settings, face photos, painting; save the skin as a new library skin"
        onClick={() => ui.openStudio({ kind: 'texture', target: 'skin' })}
      />
    </div>
  );
}

export function EyesPanel() {
  return (
    <div className="creator-step" data-testid="step-panel-eyes">
      <EyesControls />
    </div>
  );
}

export function BrowsPanel() {
  return (
    <div className="creator-step" data-testid="step-panel-brows">
      <PaintedPart kind="brows" mesh="eyebrows" label="Eyebrows" />
    </div>
  );
}

export function LashesPanel() {
  return (
    <div className="creator-step" data-testid="step-panel-lashes">
      <PaintedPart kind="lashes" mesh="eyelashes" label="Eyelashes" />
    </div>
  );
}

export function MakeupPanel() {
  return (
    <div className="creator-step" data-testid="step-panel-makeup">
      {MAKEUP.map((k) => (
        <LayerSwitch key={k} kind={k} />
      ))}
      <p className="hint">Each is painted on the skin. Their finer settings are in Texture Studio.</p>
    </div>
  );
}

export function MouthPanel() {
  return (
    <div className="creator-step" data-testid="step-panel-mouth">
      <MouthControls />
    </div>
  );
}

// ------------------------------------------------------------------ Look

/** Part 1's lighting presets, then the graded Part 2 looks (F14). */
const PART1_LOOKS: LightingPresetId[] = ['studio', 'flashlight', 'overcast', 'night'];

export function LookStep() {
  const studio = useStudio();
  useStudioVersion();
  const ui = useUi();
  const doc = studio.engine.doc;
  const lookInput = useRef<HTMLInputElement>(null);
  const chooseProfile = (id: QualityProfileId) =>
    studio.engine.update(`${QUALITY_PROFILES[id].label} profile`, (d) => {
      d.export = { ...d.export, ...profileSettings(id) } as ExportSettings;
      d.bodyMesh = bodyMeshFor(id);
      withBakeLayers(d);
    });
  const looks: CreatorEntry[] = Object.values(LIGHTING_PRESETS).map((l) => ({
    id: `look:${l.id}`,
    category: 'bodies',
    name: l.label,
    tags: [PART1_LOOKS.includes(l.id as LightingPresetId) ? 'lighting' : 'look'],
    user: false,
    subject: { kind: 'look', lighting: l.id, look: null },
    thumbId: `look:${l.id}`,
    active: () => !ui.customLook && ui.lighting === l.id,
    apply: () => ui.setView({ lighting: l.id as LightingPresetId, customLook: null }),
  }));
  const loadLook = async (file: File) => {
    try {
      const look = parseLook(JSON.parse(await file.text()));
      ui.setView({ customLook: look });
      ui.info(`Look: ${look.label}`);
    } catch (err) {
      ui.error(err instanceof LookError || err instanceof SyntaxError ? `Not a PS2CC look: ${(err as Error).message}` : 'Could not read that look', err);
    }
  };
  const ps2LookOn = ui.post.lowRes && ui.post.dither16;
  return (
    <div className="slider-panel creator-step" data-testid="step-panel-look">
      <Section title="Quality profile">
        <div className="profile-cards" role="radiogroup" aria-label="Quality profile">
          {QUALITY_PROFILE_IDS.map((id) => (
            <button key={id} role="radio" aria-checked={doc.export.profile === id} className={doc.export.profile === id ? 'profile-card active' : 'profile-card'} onClick={() => chooseProfile(id)} data-testid={`look-profile-${id}`}>
              <strong>{QUALITY_PROFILES[id].label}</strong>
              <span className="muted">{QUALITY_PROFILES[id].description}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Look">
        <p className="hint">Your character under each look. The look is how the viewport, renders and thumbnails are lit; save it for Unity with Save look.</p>
        <div className="library-grid small" role="list" data-testid="look-grid">
          {looks.map((e) => {
            const on = e.active(doc);
            return (
              <div key={e.id} className={on ? 'library-card active' : 'library-card'} role="listitem" data-testid="look-card" data-entry={e.id} data-active={on}>
                <button className="library-thumb" onClick={e.apply} aria-label={e.name} aria-pressed={on}>
                  <Thumb entry={e} size="small" />
                </button>
                <div className="library-caption">
                  <span className="library-name">{e.name}</span>
                </div>
              </div>
            );
          })}
        </div>
        {ui.customLook && <p className="hint">Using {ui.customLook.label} (loaded from a file).</p>}
        <button className="link" onClick={() => lookInput.current?.click()}>
          Load look…
        </button>
        <input
          ref={lookInput}
          type="file"
          accept=".ps2look,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void loadLook(f);
          }}
        />
      </Section>
      <Section title="Lighting">
        <div className="picker-row">
          <label htmlFor="look-lighting-model">Lighting</label>
          <select id="look-lighting-model" value={ui.lightingModel} onChange={(e) => ui.setView({ lightingModel: e.target.value as 'auto' | LightingModel })} data-testid="look-lighting-model">
            <option value="auto">From quality profile</option>
            <option value="vertex">Per vertex (era)</option>
            <option value="pixel">Per pixel</option>
          </select>
        </div>
        <div className="picker-row">
          <label htmlFor="look-shadows">Shadows</label>
          <select id="look-shadows" value={ui.shadowMode} onChange={(e) => ui.setView({ shadowMode: e.target.value as 'auto' | ShadowMode })} data-testid="look-shadows">
            <option value="auto">From quality profile</option>
            <option value="off">Off</option>
            <option value="key">On the ground</option>
            <option value="self">On the character too</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={ps2LookOn} onChange={() => ui.setView({ post: ps2LookOn ? { ...DEFAULT_POST } : { ...PS2_POST } })} data-testid="look-ps2-post" /> PS2 screen (640×448, dither, grain)
        </label>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ Export

export function ExportStep() {
  return (
    <div className="creator-step" data-testid="step-panel-export">
      <ExportPanel />
      <Section title="Expressions (blendshapes)" open={false} testId="export-expressions">
        <ExpressionsPanel />
      </Section>
    </div>
  );
}

/** Garment slot names, for the Inspector. */
export const SLOT_LABEL: Record<GarmentSlotName, string> = { top: 'Top', bottom: 'Bottom', full: 'Suit or dress', outer: 'Outer', shoes: 'Shoes', hat: 'Hat', gloves: 'Gloves', accessory: 'Accessory' };
