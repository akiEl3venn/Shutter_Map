import { useLayoutEffect, useRef } from 'react';
import type { MapComposition, PhotoSession } from '../contracts.ts';
import { strings } from './strings.ts';

export interface Overlay {
  bitmap: ImageBitmap;
  composition: MapComposition;
  photo: PhotoSession;
}

export function PhotoCanvas({ preview, photo, overlay }: {
  preview: ImageBitmap | null;
  photo: PhotoSession | null;
  overlay: Overlay | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const redraw = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    redraw.current = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!preview || !photo) return;
      // One contain transform in oriented source pixels for both bitmaps.
      const scale = Math.min(w / photo.orientedWidthPx, h / photo.orientedHeightPx);
      ctx.setTransform(scale, 0, 0, scale, (w - photo.orientedWidthPx * scale) / 2,
        (h - photo.orientedHeightPx * scale) / 2);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(preview, 0, 0, photo.orientedWidthPx, photo.orientedHeightPx);
      if (overlay?.photo !== photo) return;
      const layer = overlay.composition;
      ctx.save();
      ctx.translate(layer.centerPx[0], layer.centerPx[1]);
      ctx.rotate(layer.rotationDegrees * Math.PI / 180);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(overlay.bitmap, -layer.widthPx / 2, -layer.heightPx / 2, layer.widthPx, layer.heightPx);
      ctx.restore();
    };
    redraw.current();
  }, [preview, photo, overlay]);

  useLayoutEffect(() => {
    const draw = () => redraw.current();
    const observer = new ResizeObserver(draw);
    observer.observe(canvasRef.current!);
    window.addEventListener('resize', draw);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, []);
  return <canvas ref={canvasRef} aria-label={strings.previewLabel} role="img">{strings.canvasFallback}</canvas>;
}
