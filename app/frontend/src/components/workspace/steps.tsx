/** The Character Creator's steps and the Asset Studio's editors, shared by the step strip, the dock and the parts tree. */
import type { ReactNode } from 'react';
import type { Studio } from '../../state/studio';
import { useUi, type StudioKind, type TabId } from '../../state/ui';
import { BodyIcon, ExportIcon, HairIcon, LookIcon, SkinIcon, WardrobeIcon } from '../icons';

/** The Character Creator's six steps (Part 2 F20), in order. */
export const TABS: { id: TabId; step: string; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'create', step: '01', label: 'Create', icon: <BodyIcon />, hint: 'Base, body and face' },
  { id: 'hair', step: '02', label: 'Hair', icon: <HairIcon />, hint: 'Hairstyle and colour' },
  { id: 'wardrobe', step: '03', label: 'Wardrobe', icon: <WardrobeIcon />, hint: 'Garments, outfits and materials' },
  { id: 'appearance', step: '04', label: 'Appearance', icon: <SkinIcon />, hint: 'Skin, eyes, makeup and details' },
  { id: 'look', step: '05', label: 'Look', icon: <LookIcon />, hint: 'Quality profile, look and lighting' },
  { id: 'export', step: '06', label: 'Export', icon: <ExportIcon />, hint: 'To Unity or a folder' },
];

/** The Asset Studio's editors (Part 2 F20). */
export const STUDIOS: { id: StudioKind; label: string; hint: string }[] = [
  { id: 'hair', label: 'Hair Studio', hint: 'Groom, shape and save hairstyles' },
  { id: 'texture', label: 'Texture Studio', hint: 'Skin layers, photos, painting; save skins and garment textures' },
  { id: 'garment', label: 'Garment Studio', hint: 'Reshape and kitbash garments' },
  { id: 'material', label: 'Material Studio', hint: 'Make materials from library materials or your images' },
];

/** Open an Asset Studio editor with the target it needs (the selected or first worn garment, the skin, a material). */
export function openStudioOf(studio: Studio, kind: StudioKind): void {
  const ui = useUi.getState();
  const sel = ui.selected?.startsWith('garment:') ? ui.selected : null;
  const worn = studio.engine.doc.garments[0];
  const garment = sel ?? (worn ? `garment:${worn.slot}:${worn.asset}` : null);
  if (kind === 'garment' && !garment) {
    ui.error('Put on a garment first: Garment Studio edits a garment the character wears');
    return;
  }
  ui.openStudio({
    kind,
    target: kind === 'hair' ? null : kind === 'garment' ? garment : kind === 'texture' ? 'skin' : (studio.assets.catalog.materials?.[0]?.id ?? null),
    zone: kind === 'material' && garment ? { partKey: garment, zone: 0 } : null,
  });
}
