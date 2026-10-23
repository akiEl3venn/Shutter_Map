/// <reference lib="webworker" />
import { decodeRgba } from './fallbackDecode.ts';
import type { FallbackFormat } from './fallbackDecode.ts';
import { orientationFor, orientationMatrix, orientedSize } from './orientation.ts';

interface DecodeRequest {
  id: number;
  file: File;
  format: FallbackFormat;
  exifOrientation: number | null;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;

async function decode({ id, file, format, exifOrientation }: DecodeRequest) {
  let source: ImageBitmap | undefined;
  try {
    const { width, height, data } = await decodeRgba(await file.arrayBuffer(), format);
    const pixels = new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height);
    const orientation = orientationFor(format, exifOrientation, false);
    let bitmap: ImageBitmap;
    if (orientation === 1) {
      // Nothing to rotate: skip the canvas and its extra full-size RGBA copy (~160 MB at 40 MP).
      bitmap = await createImageBitmap(pixels);
    } else {
      const size = orientedSize(width, height, orientation);
      const canvas = new OffscreenCanvas(size.width, size.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('decode-failed');
      source = await createImageBitmap(pixels);
      context.setTransform(...orientationMatrix(width, height, orientation));
      context.drawImage(source, 0, 0);
      bitmap = canvas.transferToImageBitmap();
    }
    worker.postMessage({ id, bitmap }, [bitmap]);
  } catch {
    // Decoder diagnostics can include file metadata; only send a fixed error code.
    worker.postMessage({ id, error: 'decode-failed' });
  } finally {
    source?.close();
  }
}

// Serialize large decodes so changing files cannot allocate several full RGBA images at once.
let pending = Promise.resolve();
worker.onmessage = ({ data }: MessageEvent<DecodeRequest>) => {
  pending = pending.then(() => decode(data));
};
