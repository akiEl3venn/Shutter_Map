import { readExif } from './exif.ts';

export interface LoadedPhoto {
  orientedWidthPx: number;
  orientedHeightPx: number;
  preview: ImageBitmap;
}

export const PREVIEW_MAX_EDGE = 2048;

// Cache only this browser capability, never a photo, its EXIF, or its location.
let orientationSupport: Promise<boolean> | undefined;

function bitmapHonorsOrientation(): Promise<boolean> {
  orientationSupport ??= (async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('preview-unavailable');
    context.fillRect(0, 0, 2, 1);
    try {
      const jpeg = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('preview-unavailable')), 'image/jpeg');
      });
      // A tiny, generated JPEG with one TIFF entry: EXIF Orientation = 6.
      const marker = new Uint8Array([
        255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0,
        1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
      ]);
      const probe = new Blob([jpeg.slice(0, 2), marker, jpeg.slice(2)], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(probe, { imageOrientation: 'from-image' });
      try {
        return bitmap.width === 1 && bitmap.height === 2;
      } finally {
        bitmap.close();
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
  })();
  return orientationSupport;
}

async function canvasPreview(
  source: ImageBitmap, direction: number, width: number, height: number,
  orientedWidth: number, orientedHeight: number,
): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('preview-unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.scale(width / orientedWidth, height / orientedHeight);
    const w = source.width;
    const h = source.height;
    switch (direction) {
      case 2: context.transform(-1, 0, 0, 1, w, 0); break;
      case 3: context.transform(-1, 0, 0, -1, w, h); break;
      case 4: context.transform(1, 0, 0, -1, 0, h); break;
      case 5: context.transform(0, 1, 1, 0, 0, 0); break;
      case 6: context.transform(0, 1, -1, 0, h, 0); break;
      case 7: context.transform(0, -1, -1, 0, h, w); break;
      case 8: context.transform(0, -1, 1, 0, 0, w); break;
    }
    context.drawImage(source, 0, 0);
    // Canvas pixels have no EXIF; omit options on this compatibility path.
    return await createImageBitmap(canvas);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function loadPhoto(file: File): Promise<LoadedPhoto> {
  const unsupported = () => Object.assign(new Error('unsupported-format'), { code: 'unsupported-format' });
  // These formats are explicitly outside this slice, even if an OS codec exists.
  if (/\.(heic|heif|hif|raw|dng|cr2|cr3|nef|nrw|arw|srf|sr2|orf|raf|rw2|pef|3fr|fff|iiq|kdc|mos|mrw|dcr|rwl|x3f)$/i.test(file.name)
      || /^image\/(heic|heif)(-sequence)?$/i.test(file.type) || /raw|adobe-dng/i.test(file.type)) {
    throw unsupported();
  }

  const honorsOrientation = await bitmapHonorsOrientation();
  let fullSize: ImageBitmap;
  try {
    fullSize = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw unsupported();
  }

  try {
    const direction = honorsOrientation ? 1 : (await readExif(file)).orientation ?? 1;
    const swapped = direction >= 5;
    const orientedWidthPx = swapped ? fullSize.height : fullSize.width;
    const orientedHeightPx = swapped ? fullSize.width : fullSize.height;
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(orientedWidthPx, orientedHeightPx));
    const width = Math.max(1, Math.round(orientedWidthPx * scale));
    const height = Math.max(1, Math.round(orientedHeightPx * scale));

    if (direction === 1) {
      try {
        // The decoded bitmap is already oriented; never apply its EXIF twice.
        const preview = await createImageBitmap(fullSize, {
          imageOrientation: 'none', resizeWidth: width, resizeHeight: height, resizeQuality: 'high',
        });
        if (preview.width === width && preview.height === height) {
          return { orientedWidthPx, orientedHeightPx, preview };
        }
        preview.close();
      } catch {
        // Some implementations reject or ignore bitmap resize options.
      }
    }

    const preview = await canvasPreview(fullSize, direction, width, height, orientedWidthPx, orientedHeightPx);
    return { orientedWidthPx, orientedHeightPx, preview };
  } finally {
    fullSize.close();
  }
}
