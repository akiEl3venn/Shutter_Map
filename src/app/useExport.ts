import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { MapComposition, PhotoSession } from '../contracts.ts';
import { defaultExportFormat, exportFileName, type ExportFormat } from '../export/formats.ts';
import { runExport } from '../export/exportClient.ts';
import { decodeImage } from '../photo/decode.ts';
import { saveBlob } from './download.ts';

export type ExportState =
  | { status: 'idle' | 'decoding' | 'encoding' | 'failed' }
  | { status: 'done'; width: number; height: number; bytes: number };

export function useExport(photo: PhotoSession | null, composition: MapComposition | null,
  exportLayer: () => Promise<{ bitmap: ImageBitmap; composition: MapComposition }>) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [state, setState] = useState<ExportState>({ status: 'idle' });
  const running = useRef<{ cancel?: () => void } | null>(null);

  const stop = useCallback(() => {
    const job = running.current;
    running.current = null;
    job?.cancel?.();
  }, []);
  function reset() {
    stop();
    setState({ status: 'idle' });
  }

  // Invalidate old work at commit, before a late decode or worker reply can save a file.
  useLayoutEffect(() => {
    setState({ status: 'idle' });
    return stop;
  }, [photo, composition, stop]);
  useLayoutEffect(() => {
    if (photo) setFormat(defaultExportFormat(photo.sourceFormat));
  }, [photo]);

  async function start() {
    if (!photo || !composition || running.current) return;
    const job: { cancel?: () => void } = {};
    running.current = job;
    const live = () => running.current === job;
    let source: ImageBitmap | undefined;
    let layer: ImageBitmap | undefined;
    setState({ status: 'decoding' });
    try {
      source = (await decodeImage(photo.file, photo.exifOrientation)).bitmap;
      if (!live()) return;
      const { width, height } = source;
      if (width !== photo.orientedWidthPx || height !== photo.orientedHeightPx) throw new Error('size-changed');
      const rendered = await exportLayer();
      layer = rendered.bitmap;
      if (!live()) return;
      setState({ status: 'encoding' });
      const encoding = runExport({ photo: source, layer, composition: rendered.composition, format });
      source = layer = undefined; // The export client/worker owns both bitmaps now.
      job.cancel = encoding.cancel;
      const blob = await encoding.result;
      if (!live()) return;
      saveBlob(blob, exportFileName(photo.file.name, format));
      setState({ status: 'done', width, height, bytes: blob.size });
    } catch {
      if (live()) setState({ status: 'failed' });
    } finally {
      source?.close();
      layer?.close();
      if (live()) running.current = null;
    }
  }
  function chooseFormat(next: ExportFormat) {
    reset();
    setFormat(next);
  }
  return { format, chooseFormat, state, start, reset };
}
