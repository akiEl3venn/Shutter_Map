import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';
import type { Point } from '../contracts.ts';
import { FIT, panBy, zoomAt, type Frame, type MaskView } from './maskView.ts';
import type { MaskZoomStatus } from './maskZoomStatus.ts';

type Event = PointerEvent<HTMLCanvasElement>;
const middle = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const typing = (target: EventTarget | null) => target instanceof HTMLElement &&
  (target.isContentEditable || !!target.closest('input, select, textarea'));

export function useMaskNavigation(editing: boolean, canvasRef: RefObject<HTMLCanvasElement | null>,
  view: RefObject<MaskView>, frame: () => Frame, redraw: RefObject<() => void>, status: MaskZoomStatus,
  interrupt: () => void) {
  const over = useRef(false), space = useRef(false);
  const drag = useRef<{ id: number; at: Point } | null>(null);
  const touches = useRef(new Map<number, Point>());
  const pinching = useRef(false);
  const raf = useRef(0);
  function change(next: MaskView) {
    view.current = next;
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; redraw.current(); });
  }
  function cursor() {
    if (!canvasRef.current) return;
    if (drag.current || pinching.current) canvasRef.current.style.cursor = 'grabbing';
    else if (space.current) canvasRef.current.style.cursor = 'grab';
  }
  // The native wheel/key handlers read current dimensions for each event.
  const getFrame = useRef(frame);
  useLayoutEffect(() => { getFrame.current = frame; });
  useLayoutEffect(() => {
    if (!editing) return;
    const canvas = canvasRef.current!;
    status.fit = () => change(FIT);
    function wheel(e: WheelEvent) {
      if (!e.ctrlKey && view.current.zoom === 1) return;
      e.preventDefault();
      const f = getFrame.current(), r = canvas.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? f.heightCss : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      change(e.ctrlKey ? zoomAt(view.current, f, Math.exp(-dy * 0.0025), e.clientX - r.left, e.clientY - r.top)
        : panBy(view.current, f, e.shiftKey ? -(dx || dy) : -dx, e.shiftKey ? 0 : -dy));
    }
    function keydown(e: KeyboardEvent) {
      if (typing(e.target)) return;
      if (e.code === 'Space' && over.current) {
        e.preventDefault(); space.current = true; cursor(); return;
      }
      if (!(e.metaKey || e.ctrlKey) || !['=', '+', '-', '0'].includes(e.key)) return;
      e.preventDefault();
      const f = getFrame.current();
      change(e.key === '0' ? FIT : zoomAt(view.current, f, e.key === '-' ? .5 : 2, f.widthCss / 2, f.heightCss / 2));
    }
    function keyup(e: KeyboardEvent) {
      if (e.code !== 'Space' || !space.current) return;
      e.preventDefault(); space.current = false; redraw.current();
    }
    function blur() { space.current = false; redraw.current(); }
    canvas.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      status.fit = () => {};
      cancelAnimationFrame(raf.current); raf.current = 0;
      view.current = FIT;
      space.current = false; drag.current = null; touches.current.clear(); pinching.current = false;
    };
  }, [editing, canvasRef, view, redraw, status]);
  function point(e: Event): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  function down(e: Event) {
    const at = point(e);
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, at);
      if (touches.current.size >= 2) {
        if (!pinching.current) interrupt();
        pinching.current = true;
        for (const id of touches.current.keys()) e.currentTarget.setPointerCapture(id);
        cursor();
      }
      return pinching.current;
    }
    if (!(e.button === 1 || (space.current && e.button === 0))) return false;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, at }; cursor();
    return true;
  }
  function move(e: Event) {
    const at = point(e), d = drag.current;
    if (d?.id === e.pointerId) {
      change(panBy(view.current, frame(), at[0] - d.at[0], at[1] - d.at[1])); d.at = at; return true;
    }
    const fingers = touches.current;
    if (fingers.has(e.pointerId)) {
      const [a, b] = fingers.values();
      fingers.set(e.pointerId, at);
      if (pinching.current && a && b) {
        const [c, d] = fingers.values(), old = middle(a, b), next = middle(c, d);
        const f = frame(), factor = distance(c, d) / Math.max(.001, distance(a, b));
        const zoomed = zoomAt(view.current, f, factor, ...old);
        change(panBy(zoomed, f, next[0] - old[0], next[1] - old[1]));
      }
    }
    return pinching.current || space.current;
  }
  function end(e: Event) {
    const consumed = pinching.current || drag.current?.id === e.pointerId;
    if (drag.current?.id === e.pointerId) drag.current = null;
    touches.current.delete(e.pointerId);
    if (!touches.current.size) pinching.current = false;
    if (consumed) redraw.current();
    return consumed;
  }
  return { down, move, end, over, cursor };
}
