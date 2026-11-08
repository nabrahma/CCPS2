/**
 * Extra helpers exposed as window.__ps2ccTest in e2e mode only (Playwright
 * tests and the build-time landmark table), next to window.__ps2cc (the Studio).
 */
import * as core from '@ps2cc/core';
import { canvasToPng, decodeImage, imageToCanvas, imageToPng } from './images';
import { detectLandmarks } from './photo/landmarker';
import { applyPhoto, currentSkin, faceView, placePhoto } from './skin';
import { prepareExport } from './export/exportCharacter';
import { buildGlb } from './export/glb';
import { useUi } from './state/ui';

export const testHooks = { core, detectLandmarks, imageToCanvas, imageToPng, canvasToPng, decodeImage, faceView, applyPhoto, placePhoto, currentSkin, prepareExport, buildGlb, useUi };

export type TestHooks = typeof testHooks;
