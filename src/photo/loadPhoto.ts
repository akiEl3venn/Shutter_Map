import { decodeImage } from './decode.ts';
import type { OnFallback } from './decode.ts';

export interface LoadedPhoto {
  orientedWidthPx: number;
  orientedHeightPx: number;
  preview: ImageBitmap;
}

export const PREVIEW_MAX_EDGE = 2048;

async function canvasPreview(source: ImageBitmap, width: number, height: number): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('preview-unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    return await createImageBitmap(canvas);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function loadPhoto(file: File, exifOrientation: number | null, onFallback?: OnFallback): Promise<LoadedPhoto> {
  const { bitmap: fullSize } = await decodeImage(file, exifOrientation, onFallback);
  try {
    const orientedWidthPx = fullSize.width;
    const orientedHeightPx = fullSize.height;
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(orientedWidthPx, orientedHeightPx));
    const width = Math.max(1, Math.round(orientedWidthPx * scale));
    const height = Math.max(1, Math.round(orientedHeightPx * scale));
    try {
      const preview = await createImageBitmap(fullSize, {
        imageOrientation: 'none', resizeWidth: width, resizeHeight: height, resizeQuality: 'high',
      });
      if (preview.width === width && preview.height === height) return { orientedWidthPx, orientedHeightPx, preview };
      preview.close();
    } catch {
      // Some implementations reject or ignore bitmap resize options.
    }
    return { orientedWidthPx, orientedHeightPx, preview: await canvasPreview(fullSize, width, height) };
  } finally {
    fullSize.close();
  }
}
