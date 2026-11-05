import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MapComposition, PhotoSession } from '../contracts.ts';
import { renderKey } from '../map/editComposition.ts';
import { createMapClient } from '../map/mapClient.ts';
import type { MapProgress } from '../map/mapProtocol.ts';
import { lineColorFor } from '../map/style.ts';
import type { Overlay } from './PhotoCanvas.tsx';

const RENDER_THROTTLE_MS = 16; // config/editor-policy.json
/**
 * Unless it is a quarter turn, a turned map costs the GPU ten times as much per frame: 146 ms against 14 over Tokyo on an
 * RTX 2070. Frames queue up, and the page waits on the GPU. At half the resolution it is 6 ms, whatever the layer or the
 * range. So while edits keep coming, a turned map is drawn as a draft, and sharply once they pause.
 */
const TURNED_DRAFT_SCALE = 0.5;
const TURNED_SETTLE_MS = 200;

function sampleColor(ctx: CanvasRenderingContext2D, preview: ImageBitmap, photo: PhotoSession,
  x: number, y: number, widthPx: number, heightPx: number) {
  const sx = preview.width / photo.orientedWidthPx;
  const sy = preview.height / photo.orientedHeightPx;
  const left = Math.max(0, x - widthPx / 2), right = Math.min(photo.orientedWidthPx, x + widthPx / 2);
  const top = Math.max(0, y - heightPx / 2), bottom = Math.min(photo.orientedHeightPx, y + heightPx / 2);
  ctx.clearRect(0, 0, 32, 32);
  // The letterbox is not part of the photo, even when the user places the map across an edge.
  ctx.drawImage(preview, left * sx, top * sy, (right - left) * sx, (bottom - top) * sy, 0, 0, 32, 32);
  const { data } = ctx.getImageData(0, 0, 32, 32);
  let luminance = 0;
  for (let i = 0; i < data.length; i += 4) {
    luminance += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  }
  return lineColorFor(luminance / (255 * 32 * 32));
}

export function useMapPreview(photo: PhotoSession | null, preview: ImageBitmap | null, composition: MapComposition | null) {
  const [sampler] = useState(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    return canvas.getContext('2d', { willReadFrequently: true })!;
  });
  const [x, y] = composition?.centerPx ?? [0, 0];
  const width = composition?.widthPx ?? 0, height = composition?.heightPx ?? 0;
  const color = composition?.style.color;
  const lineColor = useMemo(() => color === 'auto' && photo && preview
    ? sampleColor(sampler, preview, photo, x, y, width, height) : color ?? '#ffffff',
    [sampler, color, photo, preview, x, y, width, height]);
  const wanted = composition ? renderKey(composition) + lineColor : null;
  const lastKey = useRef<string | null>(null);
  const lastSent = useRef(-Infinity);
  const [progress, setProgress] = useState<MapProgress | null>(null);
  const [rendering, setRendering] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const source = useRef<PhotoSession | null>(null);
  const [frame, setFrame] = useState<{ sequence: number; overlay: Overlay | null }>({ sequence: 0, overlay: null });
  const sequence = useRef(0);
  const owned = useRef(new Map<number, ImageBitmap>());
  /** A draft is on its way or up, and the sharp frame that follows it has yet to be asked for. */
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stopSettling() {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }
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
      replaceFrame({ bitmap: value.bitmap, composition: request.composition, photo: source.current,
        key: renderKey(request.composition) + request.lineColor });
      // Not ready after a draft: asking for the sharp frame would cancel an export started in between.
      if (value.complete && settleTimer.current === null) setRendering(false);
    },
    failed() {
      stopSettling();
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
    stopSettling();
    client.dispose();
    for (const bitmap of owned.current.values()) bitmap.close();
    owned.current.clear();
  }, [client]);

  useLayoutEffect(() => {
    source.current = photo;
    lastKey.current = null;
    lastSent.current = -Infinity;
    setCrashed(false);
    setProgress(null);
    stopSettling();
    client.cancel();
    replaceFrame(null);
    setRendering(false);
  }, [client, photo, preview, !!composition]);

  useLayoutEffect(() => {
    if (!photo || !preview || !composition || !wanted || wanted === lastKey.current) return;
    const send = () => {
      lastSent.current = performance.now();
      lastKey.current = wanted;
      setRendering(true);
      setCrashed(false);
      stopSettling();
      const outputScale = preview.width / photo.orientedWidthPx;
      if (composition.rotationDegrees % 90 === 0) {
        client.render({ composition, outputScale, lineColor });
        return;
      }
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        client.render({ composition, outputScale, lineColor });
      }, TURNED_SETTLE_MS);
      client.render({ composition, outputScale: outputScale * TURNED_DRAFT_SCALE, lineColor });
    };
    const wait = lastSent.current + RENDER_THROTTLE_MS - performance.now();
    if (wait <= 0) { send(); return; }
    const timer = setTimeout(send, wait);
    return () => clearTimeout(timer);
  }, [client, composition, photo, preview, lineColor, wanted]);

  function retry() {
    setCrashed(false);
    setRendering(true);
    client.retry();
  }
  const pending = rendering || (!!wanted && wanted !== lastKey.current);
  const ready = !!wanted && frame.overlay?.key === wanted && frame.overlay.photo === photo && !!progress
    && !pending && !crashed && progress.failed === 0 && progress.loaded === progress.total && progress.empty < progress.total;
  return { progress, overlay: composition ? frame.overlay : null, rendering: pending, crashed, retry,
    exportLayer: client.exportLayer, ready };
}
