/**
 * Extra helpers exposed as window.__ps2ccTest in e2e mode only (Playwright
 * tests and the build-time landmark table), next to window.__ps2cc (the Studio).
 */
import * as core from '@ps2cc/core';
import { canvasToPng, decodeImage, imageToCanvas, imageToPng } from './images';
import { detectLandmarks } from './photo/landmarker';
import { renderScanViews } from './photo/scan-render';
import { applyPhoto, applySidePhoto, currentHeadSkin, currentSkin, faceView, placePhoto } from './skin';
import { prepareExport } from './export/exportCharacter';
import { buildGlb } from './export/glb';
import { useUi } from './state/ui';
import { runSliderSweep } from './perf';

export const testHooks = { runSliderSweep, core, detectLandmarks, imageToCanvas, imageToPng, canvasToPng, decodeImage, faceView, applyPhoto, placePhoto, currentSkin, currentHeadSkin, applySidePhoto, renderScanViews, prepareExport, buildGlb, useUi };

export type TestHooks = typeof testHooks;
