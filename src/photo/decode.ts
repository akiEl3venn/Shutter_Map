import { isRawFilename, sniffFormat } from './sniff.ts';
import type { ImageFormat } from './sniff.ts';
import { orientedSize, orientationFor, orientationMatrix } from './orientation.ts';
import { orientationProbes } from './orientationProbes.ts';

export interface DecodedImage {
  bitmap: ImageBitmap;
  format: ImageFormat;
  path: 'native' | 'fallback';
}

export type OnFallback = (format: ImageFormat) => void;
const unsupported = () => Object.assign(new Error('unsupported-format'), { code: 'unsupported-format' });
type ProbedFormat = keyof typeof orientationProbes;
const orientationSupport = new Map<ProbedFormat, Promise<boolean>>();
const hasProbe = (format: ImageFormat): format is ProbedFormat => format in orientationProbes;

/** Whether this browser's native decoder already applies EXIF orientation for the format (Chrome: JPEG yes, WebP no). */
function bitmapHonorsExif(format: ProbedFormat): Promise<boolean> {
  let probe = orientationSupport.get(format);
  if (!probe) {
    probe = (async () => {
      const bytes = Uint8Array.from(atob(orientationProbes[format]), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
      try { return bitmap.height > bitmap.width; } finally { bitmap.close(); }
    })().catch(() => false); // Only reachable after a native decode succeeded, so a failure here is an anomaly.
    orientationSupport.set(format, probe);
  }
  return probe;
}

async function orientBitmap(bitmap: ImageBitmap, direction: number): Promise<ImageBitmap> {
  if (direction === 1) return bitmap;
  const size = orientedSize(bitmap.width, bitmap.height, direction);
  const canvas = new OffscreenCanvas(size.width, size.height);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw unsupported();
    context.transform(...orientationMatrix(bitmap.width, bitmap.height, direction));
    context.drawImage(bitmap, 0, 0);
    return await createImageBitmap(canvas);
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

let decoder: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void }>();

function decoderWorker(): Worker {
  if (decoder) return decoder;
  const worker = new Worker(new URL('./decodeWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
    const request = pending.get(data.id);
    pending.delete(data.id);
    if (!request) { data.bitmap?.close(); return; }
    if (data.bitmap) request.resolve(data.bitmap);
    else request.reject(unsupported());
  };
  const failed = () => {
    worker.terminate();
    decoder = undefined;
    for (const request of pending.values()) request.reject(unsupported());
    pending.clear();
  };
  worker.onerror = event => { event.preventDefault(); failed(); };
  worker.onmessageerror = failed;
  decoder = worker;
  return worker;
}

function fallbackBitmap(file: File, format: ImageFormat, exifOrientation: number | null): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    try {
      const worker = decoderWorker();
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, file, format, exifOrientation });
    } catch {
      pending.delete(id);
      reject(unsupported());
    }
  });
}

/** Full-resolution, oriented pixels shared by preview and export. No photo data leaves this page. */
export async function decodeImage(file: File, exifOrientation: number | null, onFallback?: OnFallback): Promise<DecodedImage> {
  if (isRawFilename(file.name)) throw Object.assign(new Error('raw-unsupported'), { code: 'raw-unsupported' });
  const format = sniffFormat(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Only formats without universal native support carry a local fallback codec.
  }
  if (bitmap) {
    const honorsExif = hasProbe(format) && exifOrientation !== null && exifOrientation > 1
      ? await bitmapHonorsExif(format) : false;
    return { bitmap: await orientBitmap(bitmap, orientationFor(format, exifOrientation, honorsExif)), format, path: 'native' };
  }
  if (format === 'heic' || format === 'tiff' || format === 'jxl') {
    onFallback?.(format);
    return { bitmap: await fallbackBitmap(file, format, exifOrientation), format, path: 'fallback' };
  }
  throw unsupported();
}
