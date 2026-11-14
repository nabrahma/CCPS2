/**
 * Look-matched thumbnails (Part 2 F20): every library asset rendered on a
 * stand-in character under the look the viewport shows, by a second, hidden
 * viewport with its own engine and scene. Renders run one at a time, newest
 * request first, and are kept per asset and look.
 */
import {
  applyPreset,
  BUILTIN_PRESETS,
  CharacterEngine,
  CharacterScene,
  newLook,
  NEUTRAL_TINT,
  type CharacterDoc,
  type GarmentSlot,
  type HairSpec,
  type Look,
  type Preset,
} from '@ps2cc/core';
import { resolveAssetUrl, Viewport, type CameraPresetId } from '@ps2cc/viewport';
import { decodeImage } from '../images';
import type { Studio } from '../state/studio';
import { useUi } from '../state/ui';

/** What a thumbnail shows. */
export type ThumbSubject =
  | { kind: 'preset'; preset: Preset }
  | { kind: 'hair'; hair: HairSpec }
  | { kind: 'garment'; garment: GarmentSlot }
  | { kind: 'outfit'; garments: GarmentSlot[] }
  | { kind: 'skin'; base: string }
  | { kind: 'material'; id: string }
  /** The character being made, under one of the looks (the Look step). */
  | { kind: 'look'; lighting: string; look: Look | null };

export const THUMB_SMALL: [number, number] = [144, 180];
export const THUMB_LARGE: [number, number] = [240, 300];

/** The garment materials are shown on. */
const MATERIAL_GARMENT = 'ps2cc:clothes/rollneck_sweater';

interface Job {
  key: string;
  subject: ThumbSubject;
  size: [number, number];
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
}

export class ThumbnailStage {
  private engine: CharacterEngine | null = null;
  private scene: CharacterScene | null = null;
  private viewport: Viewport | null = null;
  private readonly done = new Map<string, Promise<string>>();
  private queue: Job[] = [];
  private running = false;
  /** Renders made (tests and the log). */
  rendered = 0;

  constructor(private readonly studio: Studio) {}

  /** The look the viewport shows, as part of every key. */
  lookKey(): string {
    const ui = useUi.getState();
    const look = ui.customLook ? `custom:${ui.customLook.id}:${ui.customLook.label}` : ui.lighting;
    const doc = this.studio.engine.doc;
    return `${look}|${ui.lightingModel}|${ui.shadowMode}|${doc.export.profile}|${doc.bodyMesh}|${doc.macros.gender >= 0.5 ? 'm' : 'f'}`;
  }

  /** A blob URL of the subject's thumbnail under the current look. `id` names the subject (with its version). */
  thumb(id: string, subject: ThumbSubject, size: [number, number] = THUMB_SMALL): Promise<string> {
    const key = `${id}|${size[0]}x${size[1]}|${this.lookKey()}${subject.kind === 'look' ? `|${JSON.stringify(this.studio.engine.doc)}` : ''}`;
    let p = this.done.get(key);
    if (!p) {
      p = new Promise<string>((resolve, reject) => {
        // Newest first: the thumbnails on screen now matter more than ones scrolled past.
        this.queue.unshift({ key, subject, size, resolve, reject });
      });
      p.catch(() => this.done.delete(key));
      this.done.set(key, p);
      void this.pump();
    }
    return p;
  }

  /** Forget thumbnails of `id` (an asset saved again). */
  forget(id: string): void {
    for (const [k, p] of this.done)
      if (k.startsWith(`${id}|`)) {
        this.done.delete(k);
        void p.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
      }
  }

  /** Drop a request still waiting (its thumbnail left the screen). */
  cancel(id: string): void {
    const keep: Job[] = [];
    for (const j of this.queue) {
      if (j.key.startsWith(`${id}|`)) {
        this.done.delete(j.key);
        j.reject(new Error('cancelled'));
      } else keep.push(j);
    }
    this.queue = keep;
  }

  /** Resolves when no render is waiting (tests). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length) await new Promise((r) => setTimeout(r, 50));
  }

  dispose(): void {
    this.viewport?.dispose();
    this.viewport = null;
    for (const p of this.done.values()) void p.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
    this.done.clear();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        try {
          job.resolve(await this.render(job.subject, job.size));
          this.rendered++;
        } catch (err) {
          job.reject(err);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private setUp(): { engine: CharacterEngine; scene: CharacterScene; viewport: Viewport } {
    if (!this.engine || !this.scene || !this.viewport) {
      const s = this.studio;
      this.engine = new CharacterEngine(s.assets, s.newDocument('Thumbnail'));
      this.scene = new CharacterScene(this.engine, { loadImage: (url) => decodeImage(resolveAssetUrl(s.info.coreAssetsUrl, url)) });
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_LARGE[0];
      canvas.height = THUMB_LARGE[1];
      this.viewport = new Viewport(canvas, { assetBaseUrl: s.info.coreAssetsUrl });
      this.viewport.exportSizePreview = true;
      this.viewport.setCharacter(this.scene);
    }
    return { engine: this.engine, scene: this.scene, viewport: this.viewport };
  }

  /** The stand-in: an adult of the character's sex with the character's profile, wearing nothing else. */
  private standIn(): CharacterDoc {
    const cur = this.studio.engine.doc;
    const preset = BUILTIN_PRESETS.find((p) => p.id === (cur.macros.gender >= 0.5 ? 'adult-male' : 'adult-female'))!;
    const doc = applyPreset(this.studio.newDocument('Thumbnail'), preset);
    doc.export = structuredClone(cur.export);
    doc.bodyMesh = cur.bodyMesh;
    doc.expressionsToBake = [];
    return doc;
  }

  private docFor(subject: ThumbSubject): { doc: CharacterDoc; camera: CameraPresetId; frame: string | null } {
    const doc = this.standIn();
    switch (subject.kind) {
      case 'preset':
        return { doc: applyPreset(doc, subject.preset), camera: 'full', frame: null };
      case 'hair':
        doc.hair = structuredClone(subject.hair);
        return { doc, camera: 'face', frame: null };
      case 'garment':
        doc.garments = [structuredClone(subject.garment)];
        return { doc, camera: 'threeQuarter', frame: `garment:${subject.garment.slot}:${subject.garment.asset}` };
      case 'outfit':
        doc.garments = structuredClone(subject.garments);
        return { doc, camera: 'full', frame: null };
      case 'skin':
        doc.skin = { ...doc.skin, base: subject.base, layers: [] };
        return { doc, camera: 'bust', frame: null };
      case 'material': {
        const look = newLook(subject.id);
        doc.garments = [{ slot: 'top', asset: MATERIAL_GARMENT, tint: { ...NEUTRAL_TINT, color: [1, 1, 1] }, dirt: 0, hideBody: true, look }];
        return { doc, camera: 'bust', frame: null };
      }
      case 'look':
        return { doc: structuredClone(this.studio.engine.doc) as CharacterDoc, camera: 'full', frame: null };
    }
  }

  private async render(subject: ThumbSubject, [w, h]: [number, number]): Promise<string> {
    const { engine, scene, viewport } = this.setUp();
    const { doc, camera, frame } = this.docFor(subject);
    engine.load(doc);
    scene.update();
    await scene.sync();
    scene.update();
    viewport.refresh();
    const ui = useUi.getState();
    viewport.lighting = (subject.kind === 'look' ? subject.lighting : ui.lighting) as typeof viewport.lighting;
    viewport.customLook = subject.kind === 'look' ? subject.look : ui.customLook;
    viewport.lightingModel = ui.lightingModel;
    viewport.shadowMode = ui.shadowMode;
    viewport.postSettings = { ...ui.post, lowRes: false };
    await viewport.texturesSettled();
    await viewport.lookReady();
    viewport.setCameraPreset(camera);
    if (frame) viewport.frameSelection(frame);
    const png = await viewport.screenshot(w, h);
    return URL.createObjectURL(png);
  }
}
