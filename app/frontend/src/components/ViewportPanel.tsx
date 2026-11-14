/**
 * The viewport (M18): the character, the camera bar (top left), and the
 * studios' tools over it.
 * How it draws is set in the top bar.
 */
import { useEffect, useRef } from 'react';
import { CAMERA_PRESETS, type CameraPresetId } from '@ps2cc/viewport';
import { useStudio, useStudioVersion } from '../state/hooks';
import { useUi, type TabId } from '../state/ui';
import { HairStudio } from './HairStudio';
import { GarmentLookTool } from './GarmentLookTool';
import { GarmentStudio } from './GarmentStudio';

/** The camera each category opens with (none: it stays where it is). */
const CATEGORY_CAMERA: Partial<Record<TabId, CameraPresetId>> = {
  body: 'full',
  face: 'face',
  eyes: 'face',
  brows: 'face',
  lashes: 'face',
  makeup: 'face',
  mouth: 'face',
  hair: 'bust',
  clothes: 'full',
};

/** Short names for the camera bar; the full name is the button's tooltip. */
const CAMERA_LABELS: Record<CameraPresetId, string> = { full: 'Full', bust: 'Bust', face: 'Face', threeQuarter: '3/4', profile: 'Profile', back: 'Back' };

export function ViewportPanel() {
  const studio = useStudio();
  useStudioVersion();
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
    vp.hiddenParts = new Set(ui.hiddenParts);
    vp.refresh();
  }, [studio, ui.shading, ui.wireOverlay, ui.lighting, ui.customLook, ui.lightingModel, ui.shadowMode, ui.post, ui.turntable, ui.poseTest, ui.background, ui.hiddenParts]);

  // The camera follows the slider region: a face region frames the face, a body region the whole body.
  const focusGroup = ui.sliderFocus.group;
  useEffect(() => {
    if (focusGroup) studio.viewport?.setCameraPreset(ui.camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusGroup]);

  // Opening a category frames its part: the face for the eyes, brows, lashes, makeup and mouth,
  // the bust for the hair, the whole body for the body and clothes (D-149).
  const tab = ui.tab;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const preset = CATEGORY_CAMERA[tab];
    if (!preset || useUi.getState().dockTab !== 'modify') return;
    useUi.getState().setView({ camera: preset });
    studio.viewport?.setCameraPreset(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const camera = (id: CameraPresetId) => {
    ui.setView({ camera: id });
    studio.viewport?.setCameraPreset(id);
  };

  return (
    <div className="viewport">
      <canvas ref={canvasRef} className="viewport-canvas" data-testid="viewport" />
      <div className="vp-camera" role="toolbar" aria-label="Camera">
        <div className="seg">
          {/* The back view is for the benchmark board (and orbiting gets there). */}
          {(Object.keys(CAMERA_PRESETS) as CameraPresetId[])
            .filter((id) => id !== 'back')
            .map((id, i) => (
              <button key={id} className={ui.camera === id ? 'active' : ''} onClick={() => camera(id)} title={`${CAMERA_PRESETS[id].label} (${i + 1})`} aria-label={CAMERA_PRESETS[id].label}>
                {CAMERA_LABELS[id]}
              </button>
            ))}
        </div>
        <div className="seg">
          <label title="Spin the character">
            <input type="checkbox" checked={ui.turntable} onChange={(e) => ui.setView({ turntable: e.target.checked })} /> Turntable
          </label>
          <label title="Procedural walk cycle through the fitted GameEngine skeleton (M2 pose test)">
            <input type="checkbox" checked={ui.poseTest} onChange={(e) => ui.setView({ poseTest: e.target.checked })} /> Pose test
          </label>
        </div>
      </div>
      {ui.hairStudio && studio.engine.doc.hair.mode === 'cards' && studio.scene.cardHair && <HairStudio canvas={canvasRef.current} />}
      {ui.garmentTool && !ui.garmentStudio && <GarmentLookTool canvas={canvasRef.current} />}
      {ui.garmentStudio && <GarmentStudio key={ui.garmentStudio} canvas={canvasRef.current} partKey={ui.garmentStudio} />}
    </div>
  );
}
