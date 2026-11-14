/** Keyboard shortcuts (PRD 7). */
import { useEffect } from 'react';
import { randomizeCharacter } from '@ps2cc/core';
import type { CameraPresetId } from '@ps2cc/viewport';
import { PS2_POST, DEFAULT_POST } from '@ps2cc/viewport';
import { useStudio } from './state/hooks';
import { useUi } from './state/ui';

const CAMERA_KEYS: Record<string, CameraPresetId> = { '1': 'full', '2': 'bust', '3': 'face', '4': 'threeQuarter', '5': 'profile' };

export function useShortcuts(): void {
  const studio = useStudio();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      const ui = useUi.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        studio.engine.undo();
      } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        studio.engine.redo();
      } else if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        studio
          .save(e.shiftKey)
          .then((p) => p && ui.info(`Saved ${p}`))
          .catch((err: unknown) => ui.error('Save failed', err));
      } else if (ctrl && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        ui.setBrowserOpen(true);
      } else if (ctrl && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        ui.setTab('export');
      } else if (typing || ctrl || e.altKey) {
        return;
      } else if (CAMERA_KEYS[e.key]) {
        ui.setView({ camera: CAMERA_KEYS[e.key]! });
        studio.viewport?.setCameraPreset(CAMERA_KEYS[e.key]!);
      } else if (e.key.toLowerCase() === 'f') {
        studio.viewport?.frameSelection(ui.selected);
      } else if (e.key.toLowerCase() === 'w') {
        ui.setView({ wireOverlay: !ui.wireOverlay });
      } else if (e.key.toLowerCase() === 'p') {
        const on = !ui.post.lowRes;
        ui.setView({ post: on ? { ...PS2_POST } : { ...DEFAULT_POST } });
      } else if (e.key.toLowerCase() === 'r') {
        studio.engine.replaceDoc(
          randomizeCharacter(studio.engine.doc, studio.assets.sliders, { seed: (Math.random() * 2 ** 31) | 0, locked: ui.locks }),
          'Randomize',
        );
      } else if (e.key === 'Tab') {
        // Hold Tab: compare with the last saved state (A/B), PRD 7.
        e.preventDefault();
        if (!e.repeat && studio.dirty && studio.savedDocText) compareStart(studio);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') compareEnd(studio);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [studio]);
}

let comparing = false;

function compareStart(studio: ReturnType<typeof useStudio>): void {
  if (comparing) return;
  comparing = true;
  studio.engine.preview(JSON.parse(studio.savedDocText) as Parameters<typeof studio.engine.preview>[0]);
}

function compareEnd(studio: ReturnType<typeof useStudio>): void {
  if (!comparing) return;
  comparing = false;
  studio.engine.preview(null);
}