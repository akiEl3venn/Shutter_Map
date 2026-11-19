import type { Point } from '../contracts.ts';
import type { PhotoSize } from '../map/editComposition.ts';

export interface MaskView { zoom: number; center: Point }
// At zoom 1 the centre is implicit, since it depends on the photo.
export const FIT: MaskView = { zoom: 1, center: [0, 0] };
export interface Frame { widthCss: number; heightCss: number; photo: PhotoSize }

export function fitScale({ widthCss, heightCss, photo }: Frame) {
  return Math.min(widthCss / photo.widthPx, heightCss / photo.heightPx);
}
export function viewScale(view: MaskView, frame: Frame) { return view.zoom * fitScale(frame); }
export function centerOf(view: MaskView, { photo }: Frame): Point {
  return view.zoom === 1 ? [photo.widthPx / 2, photo.heightPx / 2] : view.center;
}
export function toPhoto(view: MaskView, frame: Frame, x: number, y: number): [number, number] {
  const [cx, cy] = centerOf(view, frame), s = viewScale(view, frame);
  return [cx + (x - frame.widthCss / 2) / s, cy + (y - frame.heightCss / 2) / s];
}
export function toCss(view: MaskView, frame: Frame, x: number, y: number): [number, number] {
  const [cx, cy] = centerOf(view, frame), s = viewScale(view, frame);
  return [frame.widthCss / 2 + (x - cx) * s, frame.heightCss / 2 + (y - cy) * s];
}
const clampZoom = (zoom: number, frame: Frame) => Math.max(1, Math.min(4 / fitScale(frame), zoom));
export function clampView(view: MaskView, frame: Frame): MaskView {
  const zoom = clampZoom(view.zoom, frame);
  if (zoom === 1) return FIT;
  const s = zoom * fitScale(frame);
  function axis(center: number, size: number, visible: number) {
    if (size * s <= visible) return size / 2;
    const edge = (visible / 2 - 48) / s;
    return Math.max(edge, Math.min(size - edge, center));
  }
  return { zoom, center: [axis(view.center[0], frame.photo.widthPx, frame.widthCss),
    axis(view.center[1], frame.photo.heightPx, frame.heightCss)] };
}
export function zoomAt(view: MaskView, frame: Frame, factor: number, x: number, y: number): MaskView {
  const zoom = clampZoom(view.zoom * factor, frame);
  const [px, py] = toPhoto(view, frame, x, y), s = fitScale(frame) * zoom;
  return clampView({ zoom, center: [px - (x - frame.widthCss / 2) / s, py - (y - frame.heightCss / 2) / s] }, frame);
}
/** Move the photo by a distance measured on screen. */
export function panBy(view: MaskView, frame: Frame, dx: number, dy: number): MaskView {
  const [x, y] = centerOf(view, frame), s = viewScale(view, frame);
  return clampView({ zoom: view.zoom, center: [x - dx / s, y - dy / s] }, frame);
}
