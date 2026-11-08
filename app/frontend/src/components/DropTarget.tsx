import { useEffect, useRef, useState, type ReactNode } from 'react';
import { newLayer } from '@ps2cc/core';
import { backend, libraryUrl, type LibraryItem } from '../backend';
import { placePhoto } from '../skin';
import { useStudio } from '../state/hooks';
import { useUi } from '../state/ui';

const KINDS: { id: string; label: string }[] = [
  { id: 'garment-textures', label: 'Garment texture' },
  { id: 'skins', label: 'Skin texture' },
  { id: 'overlays', label: 'Skin overlay' },
  { id: 'hair-atlases', label: 'Hair card atlas' },
  { id: 'photos', label: 'Face photo' },
];

/**
 * Drop anywhere (PRD 7): dropping an image on a garment applies it as that
 * garment's texture; dropping elsewhere asks "What is this file?".
 */
export function DropTarget({ children }: { children: ReactNode }) {
  const studio = useStudio();
  const ui = useUi();
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState<{ files: File[]; paths: string[]; target: string | null } | null>(null);

  const apply = (item: LibraryItem, target: string | null) => {
    const url = libraryUrl(studio.info, item.file);
    if (item.kind === 'hair-atlases') {
      // Card hair atlas: open the editor (PRD F5 step 1) with any atlas saved beside the image.
      void backend.loadAtlas(item.file).then((json) =>
        ui.openAtlasEditor({ texture: url, libraryFile: item.file, name: item.name, regions: json ? (JSON.parse(json) as { regions: [] }).regions : null }),
      );
      return;
    }
    if (item.kind === 'photos') {
      // PRD F7: find the face and project it onto the head.
      ui.setTab('skin');
      void placePhoto(studio, url);
      return;
    }
    if (item.kind === 'overlays') {
      studio.engine.update('Add image overlay', (d) => void d.skin.layers.push(newLayer('image', { image: url })));
      ui.setTab('skin');
      ui.info(`Added ${item.name} as a skin overlay`);
      return;
    }
    if (item.kind === 'skins') {
      studio.engine.update('Change skin', (d) => void (d.skin = { ...d.skin, base: url }));
      ui.info(`Using ${item.name} as the base skin`);
      return;
    }
    if (item.kind === 'garment-textures' && target === 'hair') {
      // Route A: re-texture a MakeHuman hair mesh (same UV layout).
      studio.engine.update('Hair texture', (d) => void (d.hair.texture = url));
      ui.info(`Applied ${item.name} to the hair`);
      return;
    }
    if (item.kind === 'garment-textures' && target?.startsWith('garment:')) {
      const asset = target.split(':').slice(2).join(':');
      studio.engine.update('Garment texture', (d) => {
        const g = d.garments.find((x) => x.asset === asset);
        if (g) g.texture = url;
      });
      ui.info(`Applied ${item.name} to the garment`);
    } else {
      ui.info(`Imported ${item.name} into ${item.kind}`);
    }
  };

  const importAs = async (kind: string, files: File[], paths: string[], target: string | null) => {
    try {
      const items: LibraryItem[] = [];
      for (const p of paths) items.push(await backend.importPath(kind, p));
      if (paths.length === 0) for (const f of files) items.push(await backend.importFile(kind, f));
      for (const it of items) apply(it, target);
    } catch (err) {
      ui.error('Import failed', err);
    }
  };

  const handle = (files: File[], paths: string[], x: number, y: number) => {
    // A mesh can only be a garment (PRD F4).
    if (paths.length === 1 && /\.(obj|fbx|glb)$/i.test(paths[0]!)) {
      ui.setTab('wardrobe');
      ui.openGarmentImport({ path: paths[0]! });
      return;
    }
    const target = studio.viewport?.partAt(x, y) ?? null;
    const hairMode = studio.engine.doc.hair.mode;
    if (target?.startsWith('garment:') || (target === 'hair' && hairMode === 'mesh')) void importAs('garment-textures', files, paths, target);
    else if (target === 'hair' && hairMode === 'cards') void importAs('hair-atlases', files, paths, target);
    else setPending({ files, paths, target });
  };

  // Desktop: Wails gives real paths for Explorer drops. Register once; always call the latest handler.
  const handleRef = useRef(handle);
  handleRef.current = handle;
  useEffect(() => backend.onFileDrop((x, y, paths) => handleRef.current([], paths, x, y)), []);

  return (
    <div
      className={over ? 'drop-zone over' : 'drop-zone'}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        // In the desktop app the Wails file-drop callback handles it (with paths).
        if (window.runtime) return;
        handle([...e.dataTransfer.files], [], e.clientX, e.clientY);
      }}
    >
      {children}
      {pending && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-labelledby="drop-title">
            <h2 id="drop-title">What is this file?</h2>
            <p className="muted">{(pending.paths.length ? pending.paths : pending.files.map((f) => f.name)).join(', ')}</p>
            <div className="modal-actions column">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  onClick={() => {
                    const p = pending;
                    setPending(null);
                    void importAs(k.id, p.files, p.paths, p.target);
                  }}
                >
                  {k.label}
                </button>
              ))}
              <button onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
