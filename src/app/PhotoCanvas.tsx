import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { MapComposition, PhotoSession, LonLat } from '../contracts.ts';
import { drawOverlay } from '../map/composite.ts';
import { pannedCenter, type EditAction } from '../map/editComposition.ts';
import { strings } from './strings.ts';
import { useMaskCanvas } from './useMaskCanvas.ts';
import type { MaskAction, MaskState } from './maskEditor.ts';
import { photoToLonLat } from '../map/layerGeometry.ts';
import { FIT, centerOf, clampView, toPhoto, viewScale, type MaskView } from './maskView.ts';
import type { MaskZoomStatus } from './maskZoomStatus.ts';
import { MaskDetail } from './maskDetail.ts';
import { useMaskNavigation } from './useMaskNavigation.ts';

export interface Overlay {
  bitmap: ImageBitmap;
  composition: MapComposition;
  photo: PhotoSession;
  key: string;
}

type Point = readonly [number, number];
type Drag = { id: number; from: Point; start: MapComposition; moved: boolean };

export function PhotoCanvas({ preview, photo, overlay, composition, drawn, edit, choosePoint, masks, editMasks,
  zoomStatus, picking, placeCustom }: {
  preview: ImageBitmap | null;
  photo: PhotoSession | null;
  overlay: Overlay | null;
  /** What the edits start from. */
  composition: MapComposition | null;
  /** What is on the photo: the same layer, with its fade and a corner's hard edges worked out. */
  drawn: MapComposition | null;
  edit: (action: EditAction) => void;
  choosePoint: (point: LonLat) => void;
  masks: MaskState;
  editMasks: (action: MaskAction) => void;
  zoomStatus: MaskZoomStatus;
  picking: boolean;
  placeCustom: (coordinate: LonLat) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const redraw = useRef<() => void>(() => {});
  const drag = useRef<Drag | null>(null);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const interactive = !picking && !masks.editing && !!composition && !!drawn && !!photo && overlay?.photo === photo;
  const view = useRef<MaskView>(FIT);
  const detail = useRef<MaskDetail | undefined>(undefined);
  const pick = useRef<{id: number; from: Point; moved: boolean} | null>(null);
  const maskCanvas = useMaskCanvas(masks, editMasks, preview, redraw, canvasRef, view);
  function frame() {
    const r = canvasRef.current!.getBoundingClientRect();
    return { widthCss: r.width, heightCss: r.height, photo: {
      widthPx: photo!.orientedWidthPx, heightPx: photo!.orientedHeightPx } };
  }
  const nav = useMaskNavigation(masks.editing, canvasRef, view, frame, redraw, zoomStatus, maskCanvas.interrupt);
  useLayoutEffect(() => {
    view.current = FIT;
    if (masks.editing && photo) detail.current = new MaskDetail(photo, () => redraw.current());
    return () => { detail.current?.dispose(); detail.current = undefined; };
  }, [photo, masks.editing]);
  useLayoutEffect(() => { pick.current = null; }, [picking, photo]);
  useLayoutEffect(() => {
    drag.current = null;
    setDragging(false);
    setHover(false);
  }, [photo, interactive]);

  function point(event: PointerEvent<HTMLCanvasElement>): Point {
    const { left, top } = event.currentTarget.getBoundingClientRect();
    return toPhoto(view.current, frame(), event.clientX - left, event.clientY - top);
  }
  /** Anywhere on the photo grabs the map, which is what the hand expects to be moving. */
  function hit(p: Point) {
    return interactive && p[0] >= 0 && p[1] >= 0 && p[0] <= photo!.orientedWidthPx && p[1] <= photo!.orientedHeightPx;
  }
  function move(event: PointerEvent<HTMLCanvasElement>, finish = false) {
    if (picking) {
      const tap = pick.current;
      if (!tap || tap.id !== event.pointerId || !photo || !drawn) return;
      if (Math.hypot(event.clientX - tap.from[0], event.clientY - tap.from[1]) > 4) tap.moved = true;
      if (finish) {
        pick.current = null;
        const [x, y] = point(event);
        if (!tap.moved && x >= 0 && y >= 0 && x <= photo.orientedWidthPx && y <= photo.orientedHeightPx) {
          placeCustom(photoToLonLat([x, y], drawn));
        }
      }
      return;
    }
    if (!interactive) return;
    const p = point(event);
    const d = drag.current;
    if (!d) { setHover(hit(p)); return; }
    if (d.id !== event.pointerId) return;
    const dx = p[0] - d.from[0], dy = p[1] - d.from[1];
    if (dx || dy || d.moved) {
      d.moved = true;
      const value = pannedCenter(d.start.geographicCenter, dx, dy, d.start);
      edit({ type: 'geographicCenter', value });
      if (finish) choosePoint(value);
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
      const f = { widthCss: width, heightCss: height, photo: { widthPx: photo.orientedWidthPx, heightPx: photo.orientedHeightPx } };
      view.current = clampView(view.current, f);
      const fitted = view.current.zoom === 1, cssScale = viewScale(view.current, f);
      const scale = fitted ? Math.min(w / f.photo.widthPx, h / f.photo.heightPx) : cssScale * dpr;
      const [cx, cy] = centerOf(view.current, f);
      ctx.setTransform(scale, 0, 0, scale, w / 2 - cx * scale, h / 2 - cy * scale);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const fine = detail.current;
      if (fine) {
        if (!fitted && scale > preview.width / f.photo.widthPx) {
          fine.view(cx - w / (2 * scale), cy - h / (2 * scale), cx + w / (2 * scale), cy + h / (2 * scale), scale);
        } else fine.invalidate();
        zoomStatus.update(Math.round(cssScale * 100), fitted, fine.failed);
      }
      const crop = fine?.crop;
      if (crop) ctx.drawImage(crop.image, crop.x, crop.y, crop.width, crop.height);
      else ctx.drawImage(preview, 0, 0, photo.orientedWidthPx, photo.orientedHeightPx);
      if (overlay?.photo === photo && drawn) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, photo.orientedWidthPx, photo.orientedHeightPx);
        ctx.clip(); // A layer may cross the photo's edge; never paint into the letterbox.
        drawOverlay(ctx, overlay.bitmap, overlay.composition, drawn);
        ctx.restore();
      }
      maskCanvas.draw(ctx, photo.orientedWidthPx, photo.orientedHeightPx, dpr / scale, fine);
      if (masks.editing) nav.cursor();
    };
    redraw.current();
  }, [preview, photo, overlay, drawn, masks, zoomStatus]);

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
    tabIndex={masks.editing ? 0 : undefined}
    style={{ touchAction: interactive || masks.editing || picking ? 'none' : undefined,
      cursor: masks.editing || picking ? 'crosshair' : dragging ? 'grabbing' : hover ? 'grab' : undefined }}
    onPointerEnter={() => { nav.over.current = true; }}
    onPointerDown={e => {
      if (masks.editing) { if (!nav.down(e)) maskCanvas.down(e); return; }
      if (picking) {
        if (e.button === 0 && !pick.current) {
          // A touch otherwise synthesizes mousedown after pointerup and steals the name field's new focus.
          e.preventDefault();
          pick.current = {id: e.pointerId, from: [e.clientX, e.clientY], moved: false};
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        return;
      }
      if (!interactive || drag.current || e.button !== 0) return;
      const from = point(e);
      if (!hit(from)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: e.pointerId, from, start: composition!, moved: false };
      setDragging(true);
    }}
    onPointerMove={e => { if (!masks.editing) move(e); else if (!nav.move(e)) maskCanvas.move(e); }}
    onPointerUp={e => { if (!masks.editing) move(e, true); else if (!nav.end(e)) maskCanvas.move(e, true); }}
    onPointerLeave={() => { nav.over.current = false; if (masks.editing) maskCanvas.leave(); else setHover(false); }}
    onPointerCancel={e => { nav.end(e); maskCanvas.cancel(e.pointerId); pick.current = null; }}
    onLostPointerCapture={e => {
      if (picking) { pick.current = null; return; }
      if (masks.editing) { nav.end(e); maskCanvas.cancel(e.pointerId); return; }
      const d = drag.current;
      if (!d) return;
      if (d.moved && composition) choosePoint(composition.geographicCenter);
      drag.current = null; setDragging(false); setHover(false);
    }}>{strings.canvasFallback}</canvas>;
}
