import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { MapComposition, PhotoSession, LonLat } from '../contracts.ts';
import { drawOverlay } from '../map/composite.ts';
import { pannedCenter, type EditAction } from '../map/editComposition.ts';
import { hitsLayer } from '../map/layerGeometry.ts';
import { strings } from './strings.ts';

export interface Overlay {
  bitmap: ImageBitmap;
  composition: MapComposition;
  photo: PhotoSession;
  key: string;
}

export type DragMode = 'layer' | 'map';
type Point = readonly [number, number];
type Drag = { id: number; from: Point; start: MapComposition; mode: DragMode; moved: boolean };

export function PhotoCanvas({ preview, photo, overlay, composition, mode, edit, choosePoint }: {
  preview: ImageBitmap | null;
  photo: PhotoSession | null;
  overlay: Overlay | null;
  composition: MapComposition | null;
  mode: DragMode;
  edit: (action: EditAction) => void;
  choosePoint: (point: LonLat) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const redraw = useRef<() => void>(() => {});
  const drag = useRef<Drag | null>(null);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const interactive = !!composition && !!photo && overlay?.photo === photo;
  useLayoutEffect(() => {
    drag.current = null;
    setDragging(false);
    setHover(false);
  }, [photo, interactive]);

  function point(event: PointerEvent<HTMLCanvasElement>): Point {
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(width / photo!.orientedWidthPx, height / photo!.orientedHeightPx);
    return [(event.clientX - left - width / 2) / scale + photo!.orientedWidthPx / 2,
      (event.clientY - top - height / 2) / scale + photo!.orientedHeightPx / 2];
  }
  function hit(p: Point) {
    return interactive && p[0] >= 0 && p[1] >= 0 && p[0] <= photo!.orientedWidthPx &&
      p[1] <= photo!.orientedHeightPx && hitsLayer(p, composition!);
  }
  function move(event: PointerEvent<HTMLCanvasElement>, finish = false) {
    if (!interactive) return;
    const p = point(event);
    const d = drag.current;
    if (!d) { setHover(hit(p)); return; }
    if (d.id !== event.pointerId) return;
    const dx = p[0] - d.from[0], dy = p[1] - d.from[1];
    if (dx || dy || d.moved) {
      d.moved = true;
      if (d.mode === 'layer') edit({ type: 'center', value: [d.start.centerPx[0] + dx, d.start.centerPx[1] + dy] });
      else {
        const value = pannedCenter(d.start.geographicCenter, dx, dy, d.start);
        edit({ type: 'geographicCenter', value });
        if (finish) choosePoint(value);
      }
    }
    if (finish) {
      drag.current = null;
      setDragging(false);
      setHover(event.pointerType !== 'touch' && hit(p));
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

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
      if (overlay?.photo !== photo || !composition) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, photo.orientedWidthPx, photo.orientedHeightPx);
      ctx.clip(); // A layer may cross the photo's edge; never paint into the letterbox.
      drawOverlay(ctx, overlay.bitmap, overlay.composition, composition);
      if (hover || dragging) {
        const { centerPx, widthPx, heightPx, rotationDegrees, shape } = composition;
        ctx.translate(...centerPx);
        ctx.rotate(rotationDegrees * Math.PI / 180);
        ctx.beginPath();
        if (shape === 'circle') ctx.arc(0, 0, widthPx / 2, 0, 2 * Math.PI);
        else ctx.rect(-widthPx / 2, -heightPx / 2, widthPx, heightPx);
        const px = dpr / scale;
        ctx.lineWidth = px;
        ctx.strokeStyle = '#263028';
        ctx.stroke();
        ctx.setLineDash([5 * px, 5 * px]);
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
      ctx.restore();
    };
    redraw.current();
  }, [preview, photo, overlay, composition, hover, dragging]);

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
  return <canvas ref={canvasRef} aria-label={strings.previewLabel} role="img"
    style={{ touchAction: interactive ? 'none' : undefined, cursor: dragging ? 'grabbing' : hover ? 'move' : undefined }}
    onPointerDown={e => {
      if (!interactive || drag.current || e.button !== 0) return;
      const from = point(e);
      if (!hit(from)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: e.pointerId, from, start: composition!, mode, moved: false };
      setDragging(true);
    }}
    onPointerMove={e => move(e)} onPointerUp={e => move(e, true)}
    onPointerLeave={() => setHover(false)}
    onLostPointerCapture={() => {
      const d = drag.current;
      if (!d) return;
      if (d?.moved && d.mode === 'map' && composition) choosePoint(composition.geographicCenter);
      drag.current = null; setDragging(false); setHover(false);
    }}>{strings.canvasFallback}</canvas>;
}
