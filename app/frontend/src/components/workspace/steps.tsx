/** The editor's categories and the Asset Studio's editors, shared by the dock and the menus. */
import type { ReactNode } from 'react';
import type { Studio } from '../../state/studio';
import { useUi, type StudioKind, type TabId } from '../../state/ui';
import { BodyIcon, BrowsIcon, ExportIcon, EyesIcon, FaceIcon, HairIcon, LashesIcon, LookIcon, MakeupIcon, MouthIcon, SkinIcon, WardrobeIcon } from '../icons';

export interface Category {
  id: TabId;
  label: string;
  /** One line under the panel's title: what is here. */
  hint: string;
  icon: ReactNode;
  /** Categories are shown in groups, a gap between them. */
  group: 'shape' | 'face' | 'style' | 'finish';
}

/**
 * One category per part of the character, each with its own panel (D-149): a
 * rail of categories like MetaHuman's, Blender's vertical property tabs.
 */
export const CATEGORIES: Category[] = [
  { id: 'body', label: 'Body', hint: 'A starting body, then its shape', icon: <BodyIcon />, group: 'shape' },
  { id: 'face', label: 'Face', hint: 'The shape of the head and face', icon: <FaceIcon />, group: 'shape' },
  { id: 'skin', label: 'Skin', hint: 'Skin texture and details', icon: <SkinIcon />, group: 'face' },
  { id: 'eyes', label: 'Eyes', hint: 'Iris, colour and the eyeball', icon: <EyesIcon />, group: 'face' },
  { id: 'brows', label: 'Brows', hint: 'Painted eyebrows: shape, hair and a brush', icon: <BrowsIcon />, group: 'face' },
  { id: 'lashes', label: 'Lashes', hint: 'Painted eyelashes', icon: <LashesIcon />, group: 'face' },
  { id: 'makeup', label: 'Makeup', hint: 'Lips, eyeliner, eyeshadow and blush', icon: <MakeupIcon />, group: 'face' },
  { id: 'mouth', label: 'Mouth', hint: 'Teeth and tongue', icon: <MouthIcon />, group: 'face' },
  { id: 'hair', label: 'Hair', hint: 'Hairstyle and colour', icon: <HairIcon />, group: 'style' },
  { id: 'clothes', label: 'Clothes', hint: 'Outfits, garments and materials', icon: <WardrobeIcon />, group: 'style' },
  { id: 'look', label: 'Look', hint: 'Quality, lighting and the PS2 screen', icon: <LookIcon />, group: 'finish' },
  { id: 'export', label: 'Export', hint: 'To Unity or a folder', icon: <ExportIcon />, group: 'finish' },
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
