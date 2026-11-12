import { useEffect, useRef, useState } from 'react';
import { LookError, parseLook, serializeLook, type LightingModel, type ShadowMode } from '@ps2cc/core';
import {
  CAMERA_PRESETS,
  DEFAULT_POST,
  LIGHTING_PRESETS,
  PS2_POST,
  type CameraPresetId,
  type LightingPresetId,
  type PostSettings,
  type ShadingMode,
} from '@ps2cc/viewport';
import { backend, libraryUrl } from '../backend';
import { useStudio, useStudioVersion } from '../state/hooks';
import { useUi, type BackgroundId } from '../state/ui';
import { AppMenus } from './AppMenus';
import { BoltIcon } from './icons';

const SHADING: { id: ShadingMode; label: string }[] = [
  { id: 'ps2', label: 'PS2 Lit' },
  { id: 'unlit', label: 'Unlit' },
  { id: 'clay', label: 'Clay' },
  { id: 'wire', label: 'Wire' },
  { id: 'uv', label: 'UV' },
];

/** Short names for the toolbar; the full name is the button's tooltip. */
const CAMERA_LABELS: Record<CameraPresetId, string> = { full: 'Full', bust: 'Bust', face: 'Face', threeQuarter: '3/4', profile: 'Profile', back: 'Back' };

/** Part 1's lighting presets, then the graded Part 2 looks (F14). */
const PART1_LOOKS: LightingPresetId[] = ['studio', 'flashlight', 'overcast', 'night'];

const POST_TOGGLES: { key: keyof PostSettings; label: string; on: number | boolean }[] = [
  { key: 'lowRes', label: '640×448', on: true },
  { key: 'dither16', label: '16-bit dither', on: true },
  { key: 'grain', label: 'Grain', on: PS2_POST.grain },
  { key: 'vhs', label: 'VHS bleed', on: PS2_POST.vhs },
  { key: 'interlace', label: 'Interlace', on: true },
  { key: 'vignette', label: 'Vignette', on: PS2_POST.vignette },
  { key: 'affine', label: 'PS1 affine UVs', on: true },
  { key: 'vertexSnap', label: 'PS1 vertex snap', on: true },
];

/** The character's name as the panel's headline. The cursor turns orange and blinks while there are unsaved changes. */
function CharacterName() {
  const studio = useStudio();
  useStudioVersion();
  const engine = studio.engine;
  return (
    <div className="name-line">
      <input
        aria-label="Character name"
        className="name-field"
        spellCheck={false}
        value={engine.doc.name}
        onChange={(e) => engine.update('Rename', (d) => void (d.name = e.target.value), 'rename')}
        onBlur={() => engine.endInteraction()}
      />
      <span className={studio.dirty ? 'name-cursor dirty' : 'name-cursor'} title={studio.dirty ? 'Unsaved changes' : 'Saved'}>
        _
      </span>
      <BakeStatus />
    </div>
  );
}

/** The bake engine's state (F16): waiting, progress, or how long the last bake took. */
function BakeStatus() {
  const studio = useStudio();
  useStudioVersion();
  const s = studio.bakeStatus;
  if (s.state === 'off') return null;
  const text =
    s.state === 'baking'
      ? `Baking ${Math.round(s.progress * 100)}%`
      : s.state === 'waiting'
        ? 'Bake waiting'
        : s.state === 'failed'
          ? 'Bake failed'
          : `Baked in ${(s.ms / 1000).toFixed(1)} s`;
  return (
    <span className={`bake-status bake-${s.state}`} data-testid="bake-status" title="Occlusion, cavity and thickness from the whole character (Export → bake options)">
      {text}
    </span>
  );
}

export function ViewportPanel() {
  const studio = useStudio();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ui = useUi();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    studio.attachViewport(canvas);
    return () => studio.detachViewport();
  }, [studio]);

  // Push view settings into the viewport.
  useEffect(() => {
    const vp = studio.viewport;
    if (!vp) return;
    vp.shading = ui.shading;
    vp.wireOverlay = ui.wireOverlay;
    vp.lighting = ui.lighting;
    vp.customLook = ui.customLook;
    vp.lightingModel = ui.lightingModel;
    vp.shadowMode = ui.shadowMode;
    vp.postSettings = ui.post;
    vp.turntable = ui.turntable;
    vp.poseTest = ui.poseTest;
    vp.background = ui.background;
    vp.refresh();
  }, [studio, ui.shading, ui.wireOverlay, ui.lighting, ui.customLook, ui.lightingModel, ui.shadowMode, ui.post, ui.turntable, ui.poseTest, ui.background]);

  const lookInput = useRef<HTMLInputElement>(null);
  /** Load a .ps2look (F14): lights, fog and grade together. */
  const loadLook = async (file: File) => {
    try {
      const look = parseLook(JSON.parse(await file.text()));
      ui.setView({ customLook: look });
      ui.info(`Look: ${look.label}`);
    } catch (err) {
      ui.error(err instanceof LookError || err instanceof SyntaxError ? `Not a PS2CC look: ${err.message}` : 'Could not read that look', err);
    }
  };
  /** Save the current look as a .ps2look, for Unity's PS2Look component or another character. */
  const saveLook = async () => {
    const look = studio.viewport?.look;
    if (!look) return;
    try {
      const path = await backend.saveLookAs(`${look.id}.ps2look`, serializeLook(look));
      if (path) ui.info(`Look saved: ${path}`);
    } catch (err) {
      ui.error('Could not save the look', err);
    }
  };

  const backgroundInput = useRef<HTMLInputElement>(null);
  /** The library checks and copies the image; the viewport shows it once it has loaded. */
  const chooseBackground = async (file: File) => {
    try {
      const item = await backend.importFile('backgrounds', file);
      const url = libraryUrl(studio.info, item.file);
      await studio.viewport?.setBackgroundImage(url);
      ui.setView({ background: 'image', backgroundImage: url });
    } catch (err) {
      ui.error('Could not use that background', err);
    }
  };
  const setBackground = (id: BackgroundId) => {
    if (id === 'image' && !ui.backgroundImage) backgroundInput.current?.click();
    else ui.setView({ background: id });
  };

  const camera = (id: CameraPresetId) => {
    ui.setView({ camera: id });
    studio.viewport?.setCameraPreset(id);
  };

  const [renderSize, setRenderSize] = useState(1024);
  const [transparent, setTransparent] = useState(false);
  const [rendering, setRendering] = useState(false);
  /** PNG render (PRD F10): 1024 to 4096 px from the current camera, solid or transparent background. */
  const render = async () => {
    const vp = studio.viewport;
    if (!vp) return;
    setRendering(true);
    try {
      await studio.settled();
      const png = await vp.screenshot(renderSize, renderSize, transparent);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = await backend.saveRender(studio.engine.doc.name, `render_${ui.camera}_${renderSize}${transparent ? '_alpha' : ''}_${stamp}`, png);
      ui.info(`Render saved: ${path}`);
    } catch (err) {
      ui.error('Render failed', err);
    } finally {
      setRendering(false);
    }
  };

  const togglePost = (key: keyof PostSettings, on: number | boolean) => {
    const cur = ui.post[key];
    const next = typeof cur === 'boolean' ? !cur : cur ? 0 : (on as number);
    ui.setView({ post: { ...ui.post, [key]: next } });
  };
  const ps2LookOn = ui.post.lowRes && ui.post.dither16;

  return (
    <div className="viewport">
      <canvas ref={canvasRef} className="viewport-canvas" data-testid="viewport" />
      <div className="vp-toolbar top">
        <AppMenus />
        <span className="spacer" />
        <div className="seg">
          {SHADING.map((s) => (
            <button key={s.id} className={ui.shading === s.id ? 'active' : ''} onClick={() => ui.setView({ shading: s.id })}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="vp-group">
        <label>
          Light{' '}
          <select
            value={ui.customLook ? 'custom' : ui.lighting}
            onChange={(e) => (e.target.value === 'custom' ? undefined : ui.setView({ lighting: e.target.value as LightingPresetId, customLook: null }))}
          >
            <optgroup label="Lighting">
              {PART1_LOOKS.map((id) => (
                <option key={id} value={id}>
                  {LIGHTING_PRESETS[id].label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Looks">
              {Object.values(LIGHTING_PRESETS)
                .filter((l) => !PART1_LOOKS.includes(l.id as LightingPresetId))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
            </optgroup>
            {ui.customLook && <option value="custom">{ui.customLook.label}</option>}
          </select>
        </label>
        <button className={ps2LookOn ? 'active' : ''} onClick={() => ui.setView({ post: ps2LookOn ? { ...DEFAULT_POST } : { ...PS2_POST } })} title="PS2 post look (P)">
          PS2 post
        </button>
        <details className="post-menu">
          <summary>Post…</summary>
          <div className="post-popup">
            <label className="post-select">
              Background
              <select value={ui.background} onChange={(e) => setBackground(e.target.value as BackgroundId)} data-testid="background">
                <option value="preset">Automatic</option>
                <option value="black">Black</option>
                <option value="grey">Grey</option>
                <option value="image">{ui.backgroundImage ? 'Your image' : 'Your image…'}</option>
              </select>
            </label>
            {ui.backgroundImage && (
              <button className="post-link" onClick={() => backgroundInput.current?.click()}>
                Choose another image…
              </button>
            )}
            <input
              ref={backgroundInput}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              data-testid="background-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ''; // so choosing the same file again still fires
                if (file) void chooseBackground(file);
              }}
            />
            <label className="post-select">
              Shading model
              <select value={ui.lightingModel} onChange={(e) => ui.setView({ lightingModel: e.target.value as 'auto' | LightingModel })} data-testid="lighting-model">
                <option value="auto">From quality profile</option>
                <option value="vertex">Per vertex</option>
                <option value="pixel">Per pixel</option>
              </select>
            </label>
            <label className="post-select">
              Shadows
              <select value={ui.shadowMode} onChange={(e) => ui.setView({ shadowMode: e.target.value as 'auto' | ShadowMode })} data-testid="shadow-mode">
                <option value="auto">From quality profile</option>
                <option value="off">Off</option>
                <option value="key">On the ground</option>
                <option value="self">On the character too</option>
              </select>
            </label>
            <button className="post-link" onClick={() => lookInput.current?.click()}>
              Load look…
            </button>
            <button className="post-link" onClick={() => void saveLook()}>
              Save look…
            </button>
            <input
              ref={lookInput}
              type="file"
              accept=".ps2look,application/json"
              hidden
              data-testid="look-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void loadLook(file);
              }}
            />
            <hr />
            {POST_TOGGLES.map((t) => (
              <label key={t.key}>
                <input type="checkbox" checked={Boolean(ui.post[t.key])} onChange={() => togglePost(t.key, t.on)} /> {t.label}
              </label>
            ))}
          </div>
        </details>
        </div>
      </div>
      <div className="vp-foot">
        <CharacterName />
        <div className="vp-row">
        <div className="seg">
          {/* The back view is for the benchmark board (and orbiting gets there); the toolbar keeps one row. */}
          {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).filter((id) => id !== 'back').map((id, i) => (
            <button key={id} className={ui.camera === id ? 'active' : ''} onClick={() => camera(id)} title={`${CAMERA_PRESETS[id].label} (${i + 1})`} aria-label={CAMERA_PRESETS[id].label}>
              {CAMERA_LABELS[id]}
            </button>
          ))}
        </div>
        <div className="vp-group">
        <label>
          <input type="checkbox" checked={ui.turntable} onChange={(e) => ui.setView({ turntable: e.target.checked })} /> Turntable
        </label>
        <label title="Procedural walk cycle through the fitted GameEngine skeleton (M2 pose test)">
          <input type="checkbox" checked={ui.poseTest} onChange={(e) => ui.setView({ poseTest: e.target.checked })} /> Pose test
        </label>
        </div>
        <div className="vp-group">
          <select value={renderSize} onChange={(e) => setRenderSize(Number(e.target.value))} aria-label="Render size" data-testid="render-size">
            {[1024, 2048, 4096].map((s) => (
              <option key={s} value={s}>
                {s} px
              </option>
            ))}
          </select>
          <select value={transparent ? 'transparent' : 'solid'} onChange={(e) => setTransparent(e.target.value === 'transparent')} aria-label="Render background" data-testid="render-background">
            <option value="solid">Solid</option>
            <option value="transparent">Transparent</option>
          </select>
          <button onClick={() => void render()} disabled={rendering} data-testid="render-png">
            {rendering ? 'Rendering…' : 'Render'}
          </button>
        </div>
        </div>
      </div>
      <button className="fab" onClick={() => ui.setTab('export')} title="Export settings (Ctrl+E)" aria-label="Open export settings">
        <BoltIcon size={18} />
      </button>
    </div>
  );
}
