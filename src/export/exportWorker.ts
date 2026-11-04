/// <reference lib="webworker" />
import type { MapComposition } from '../contracts.ts';
import { drawOverlay } from '../map/composite.ts';
import { encodeImage } from './encode.ts';
import { exportFormats, type ExportFormat } from './formats.ts';

export interface ExportJob {
  photo: ImageBitmap;
  layer: ImageBitmap;
  composition: MapComposition;
  format: ExportFormat;
}
export type ExportReply = { blob: Blob } | { failed: true };

function compose({ photo, layer, composition, format }: ExportJob) {
  const { width, height } = photo;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!ctx) throw new Error('canvas-unavailable');
  // Beyond a device's canvas limit, drawing may silently do nothing.
  ctx.fillRect(width - 1, height - 1, 1, 1);
  if (ctx.getImageData(width - 1, height - 1, 1, 1).data[3] !== 255) throw new Error('canvas-too-large');
  ctx.clearRect(width - 1, height - 1, 1, 1);
  if (!exportFormats[format].alpha) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(photo, 0, 0);
  photo.close();
  drawOverlay(ctx, layer, composition);
  layer.close();
  return { canvas, ctx };
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async ({ data: job }: MessageEvent<ExportJob>) => {
  try {
    const { canvas, ctx } = compose(job);
    const blob = await encodeImage(job.format, canvas, ctx);
    worker.postMessage({ blob } satisfies ExportReply);
  } catch {
    worker.postMessage({ failed: true } satisfies ExportReply);
  } finally {
    job.photo.close();
    job.layer.close();
  }
};
