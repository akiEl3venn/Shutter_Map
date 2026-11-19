import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';
import type { Point } from '../contracts.ts';
import { clampPoint, type MaskAction, type MaskState } from './maskEditor.ts';
import { drawGuides, penHit, type PenHit, type Stroke } from './maskGuides.ts';
import { MaskPreview } from './maskPreview.ts';
import { toPhoto, viewScale, type Frame, type MaskView } from './maskView.ts';
import type { MaskDetail } from './maskDetail.ts';
import { typing } from './useMaskNavigation.ts';

type Event = PointerEvent<HTMLCanvasElement>;
type Gesture = { id: number; kind: 'stroke'; op: Stroke }
  | { id: number; kind: 'close' }
  | { id: number; kind: 'pen'; from: Point; handle: boolean }
  | { id: number; kind: 'move'; from: Point; vertex: NonNullable<Exclude<PenHit, 'close'>>; moved: boolean };

function shortcut(e: KeyboardEvent, state: MaskState): MaskAction | undefined {
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === 'z') return {type: e.shiftKey ? 'redo' : state.penDraft.length ? 'undoPoint' : 'undo'};
    if (e.ctrlKey && key === 'y') return {type: 'redo'};
    return;
  }
  if (key === 'escape') return {type: state.penDraft.length ? 'dropDraft' : 'finish'};
  if (state.tools.tool === 'pen') {
    if (key === 'enter') return {type: 'close'};
    if (key === 'backspace' || key === 'delete') return {type: 'undoPoint'};
  }
  if (state.tools.tool === 'brush' && (key === '[' || key === ']')) {
    return {type: 'size', value: state.tools.sizePx * (key === ']' ? 1.25 : 0.8)};
  }
}

export function useMaskCanvas(state: MaskState, dispatch: (action: MaskAction) => void,
  preview: ImageBitmap | null, redraw: RefObject<() => void>, canvas: RefObject<HTMLCanvasElement | null>,
  view: RefObject<MaskView>) {
  const cached = useRef<MaskPreview | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const hover = useRef<Point | null>(null);

  useLayoutEffect(() => { cached.current = null; }, [preview]);
  useLayoutEffect(() => {
    const active = gesture.current;
    gesture.current = null;
    hover.current = null;
    if (active && canvas.current?.hasPointerCapture(active.id)) canvas.current.releasePointerCapture(active.id);
  }, [state.editing, state.tools.tool, preview, canvas]);
  useLayoutEffect(() => {
    if (!state.editing) return;
    function keydown(e: KeyboardEvent) {
      if (typing(e.target)) return;
      const action = shortcut(e, state);
      if (action) {
        e.preventDefault();
        dispatch(action);
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [state, dispatch]);

  function where(e: Event) {
    const box = e.currentTarget.getBoundingClientRect();
    const frame: Frame = { photo: state.photo, widthCss: box.width, heightCss: box.height };
    return { point: toPhoto(view.current, frame, e.clientX - box.left, e.clientY - box.top),
      px: 1 / viewScale(view.current, frame) };
  }
  function down(e: Event) {
    if (!preview || e.button !== 0 || gesture.current) return;
    const {point, px} = where(e);
    const p = clampPoint(point, state.photo);
    const {tool, mode, sizePx, featherPx} = state.tools;
    const id = e.pointerId;
    e.currentTarget.focus({preventScroll: true});
    hover.current = e.pointerType === 'touch' ? null : point;
    if (tool === 'pen') {
      const hit = penHit(state, point, (e.pointerType === 'touch' ? 18 : 10) * px);
      if (hit === 'close') {
        if (e.pointerType === 'touch') {
          gesture.current = {id, kind: 'close'};
          e.currentTarget.setPointerCapture(id);
        } else dispatch({type: 'close'});
        return;
      }
      // Next door's corner is often this outline's corner too: a tap places a point on it, a drag moves it.
      if (hit) {
        gesture.current = {kind: 'move', id, from: point, vertex: hit, moved: false};
      } else {
        gesture.current = {kind: 'pen', id, from: point, handle: false};
        dispatch({type: 'penPoint', point: p});
      }
    } else {
      const op: Stroke = tool === 'brush'
        ? {tool, mode, sizePx, featherPx: featherPx.brush, points: [p]}
        : {tool, mode, featherPx: featherPx.lasso, points: [p]};
      gesture.current = {kind: 'stroke', id, op};
    }
    e.currentTarget.setPointerCapture(id);
    redraw.current();
  }
  function move(e: Event, finish = false) {
    if (!preview) return;
    const active = gesture.current;
    if (active && active.id !== e.pointerId) return;
    const {point, px} = where(e);
    hover.current = e.pointerType === 'touch' ? null : point;
    if (active?.kind === 'stroke') {
      const p = clampPoint(point, state.photo);
      const points = active.op.points;
      const last = points[points.length - 1];
      if (Math.hypot(last[0] - p[0], last[1] - p[1]) >= 2 * px) points.push(p);
      if (finish) dispatch({type: 'commit', op: active.op});
    } else if (active?.kind === 'close') {
      if (finish) dispatch({type: 'close'});
    } else if (active) {
      const dx = point[0] - active.from[0], dy = point[1] - active.from[1];
      if (active.kind === 'move') {
        const {start, opIndex, pointIndex} = active.vertex;
        if (active.moved || Math.hypot(dx, dy) > 4 * px) {
          // Only a real drag becomes a step to undo.
          if (!active.moved) dispatch({type: 'beginMove', opIndex, pointIndex});
          active.moved = true;
          dispatch({type: 'move', opIndex, pointIndex, point: [start[0] + dx, start[1] + dy]});
        } else if (finish) {
          dispatch({type: 'penPoint', point: start});
        }
      } else if (active.handle || Math.hypot(dx, dy) > 4 * px) {
        active.handle = true;
        dispatch({type: 'penHandle', point});
      }
    }
    if (finish && active) {
      gesture.current = null;
      if (e.currentTarget.hasPointerCapture(active.id)) e.currentTarget.releasePointerCapture(active.id);
    }
    // A committed stroke is redrawn in the ensuing layout effect. A discarded tap with
    // the lasso (or a stationary pen release) may leave reducer state unchanged.
    const committed = finish && active?.kind === 'stroke' &&
      (active.op.tool === 'brush' || active.op.points.length >= 3);
    if (!committed) redraw.current();
  }
  function leave() {
    if (!hover.current) return;
    hover.current = null;
    redraw.current();
  }
  function cancel(id: number) {
    if (gesture.current?.id !== id) return;
    gesture.current = null;
    hover.current = null;
    redraw.current();
  }
  function interrupt() {
    if (gesture.current?.kind === 'pen') dispatch({type: 'undoPoint'});
    if (gesture.current) cancel(gesture.current.id);
  }
  function draw(ctx: CanvasRenderingContext2D, width: number, height: number, px: number, detail?: MaskDetail) {
    const active = gesture.current;
    const stroke = active?.kind === 'stroke' ? active.op : null;
    const brush = stroke?.tool === 'brush' ? stroke : null;
    if (preview && (state.mask.length || brush)) {
      const tinted = state.editing && state.tools.show;
      if (brush || !detail?.drawMask(ctx, state.mask, tinted)) {
        if (cached.current?.preview !== preview) cached.current = new MaskPreview(preview);
        const cache = cached.current;
        cache.update(state.mask, brush, preview.width / width, tinted);
        ctx.drawImage(cache.shown.canvas, 0, 0, width, height);
        if (tinted) ctx.drawImage(cache.tint.canvas, 0, 0, width, height);
      }
    } else if (cached.current?.preview !== preview || !state.editing) {
      cached.current = null;
    }
    if (!state.editing || !canvas.current) return;
    const p = hover.current;
    const hit = p && state.tools.tool === 'pen' ? penHit(state, p, 10 * px) : null;
    const cursor = active?.kind === 'move' ? 'grabbing' : hit === 'close' ? 'pointer' : hit ? 'move' : 'crosshair';
    if (canvas.current.style.cursor !== cursor) canvas.current.style.cursor = cursor;
    drawGuides(ctx, state, stroke, p && clampPoint(p, state.photo), hit === 'close', px);
  }
  return { down, move, leave, cancel, interrupt, draw };
}
