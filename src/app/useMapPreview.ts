import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LocationChoice, MapComposition, PhotoSession } from '../contracts.ts';
import { defaultComposition } from '../map/composition.ts';
import { createMapClient } from '../map/mapClient.ts';
import type { MapProgress } from '../map/mapProtocol.ts';
import { lineColorFor } from '../map/style.ts';
import type { Overlay } from './PhotoCanvas.tsx';

function sampleColor(preview: ImageBitmap, photo: PhotoSession, composition: MapComposition) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const sx = preview.width / photo.orientedWidthPx;
  const sy = preview.height / photo.orientedHeightPx;
  const { centerPx, widthPx, heightPx } = composition;
  ctx.drawImage(preview, (centerPx[0] - widthPx / 2) * sx, (centerPx[1] - heightPx / 2) * sy,
    widthPx * sx, heightPx * sy, 0, 0, 32, 32);
  const { data } = ctx.getImageData(0, 0, 32, 32);
  let luminance = 0;
  for (let i = 0; i < data.length; i += 4) {
    luminance += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  }
  return lineColorFor(luminance / (255 * 32 * 32));
}

export function useMapPreview(photo: PhotoSession | null, preview: ImageBitmap | null, location: LocationChoice | null) {
  // Choosing the same point through a different input only changes the location label.
  const longitude = location?.coordinate[0];
  const latitude = location?.coordinate[1];
  const composition = useMemo(() => defaultComposition(photo, longitude === undefined || latitude === undefined
    ? null : { coordinate: [longitude, latitude] }), [photo, longitude, latitude]);
  const [progress, setProgress] = useState<MapProgress | null>(null);
  const [rendering, setRendering] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const source = useRef<PhotoSession | null>(null);
  const [frame, setFrame] = useState<{ sequence: number; overlay: Overlay | null }>({ sequence: 0, overlay: null });
  const sequence = useRef(0);
  const owned = useRef(new Map<number, ImageBitmap>());
  function replaceFrame(overlay: Overlay | null) {
    const serial = ++sequence.current;
    if (overlay) owned.current.set(serial, overlay.bitmap);
    setFrame({ sequence: serial, overlay });
  }

  const [client] = useState(() => createMapClient({
    progress(value) {
      setProgress(value);
      if (value.failed && value.loaded + value.failed === value.total) setRendering(false);
    },
    frame(value, request) {
      if (!source.current) { value.bitmap.close(); return; }
      replaceFrame({ bitmap: value.bitmap, composition: request.composition, photo: source.current });
      if (value.complete) setRendering(false);
    },
    failed() {
      setCrashed(true);
      setRendering(false);
      replaceFrame(null);
    },
  }));

  // Frames superseded before React committed them also belong to this component.
  // Close only older frames; a newer one may already be queued for the next commit.
  useLayoutEffect(() => {
    for (const [serial, bitmap] of owned.current) {
      if (serial >= frame.sequence) break;
      bitmap.close();
      owned.current.delete(serial);
    }
  }, [frame]);
  useLayoutEffect(() => () => {
    client.dispose();
    for (const bitmap of owned.current.values()) bitmap.close();
    owned.current.clear();
  }, [client]);

  useLayoutEffect(() => {
    source.current = photo;
    setCrashed(false);
    setProgress(null);
    if (!photo || !preview || !composition) {
      client.cancel();
      replaceFrame(null);
      setRendering(false);
      return;
    }
    setRendering(true);
    client.render({ composition, outputScale: preview.width / photo.orientedWidthPx,
      lineColor: sampleColor(preview, photo, composition) });
  }, [client, composition, photo, preview]);

  function retry() {
    setCrashed(false);
    setRendering(true);
    client.retry();
  }
  const ready = !!composition && frame.overlay?.composition === composition && !!progress
    && !rendering && !crashed && progress.failed === 0 && progress.loaded === progress.total && progress.empty < progress.total;
  return { progress, overlay: composition ? frame.overlay : null, rendering, crashed, retry,
    composition, exportLayer: client.exportLayer, ready };
}
