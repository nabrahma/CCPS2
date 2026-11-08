/**
 * "Export UV template" (PRD F4/F5): a 1024 px PNG with the part's UV
 * wireframe drawn over its current texture, so users can paint a texture
 * that fits and drop it back on the part.
 */
import { renderUvTemplate, type ScenePart } from '@ps2cc/core';
import { resolveAssetUrl } from '@ps2cc/viewport';
import { backend } from './backend';
import type { Studio } from './state/studio';

export const UV_TEMPLATE_SIZE = 1024;

/** Render the template for a scene part and ask where to save it. Returns the saved path, '' if cancelled. */
export async function exportUvTemplate(studio: Studio, part: ScenePart): Promise<string> {
  const size = UV_TEMPLATE_SIZE;
  const proxy = await studio.assets.proxy(part.assetId);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  let background: Uint8ClampedArray | undefined;
  if (part.material.texture) {
    try {
      const img = await loadImage(resolveAssetUrl(studio.info.coreAssetsUrl, part.material.texture));
      ctx.drawImage(img, 0, 0, size, size);
      background = ctx.getImageData(0, 0, size, size).data;
    } catch (err) {
      backend.log('warn', `UV template: texture ${part.material.texture} not loaded (${String(err)}); exporting the wireframe only`);
    }
  }
  const pixels = renderUvTemplate(proxy.uvs, proxy.faceUvs, { size, background });
  ctx.putImageData(new ImageData(pixels, size, size), 0, 0);
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
  const name = part.assetId.split('/').pop() ?? 'part';
  return backend.saveImageAs(`${name}_uv_template.png`, png);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}
