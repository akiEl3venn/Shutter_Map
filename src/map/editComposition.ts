import type { DetailOffset, LabelLanguage, LayerId, LonLat, MapComposition } from '../contracts.ts';
import { defaultComposition, MIN_LAYER_PX } from './composition.ts';
import { layerExtent, rasterSize } from './layerGeometry.ts';
import { lonLatToWorld, metersPerWorldUnit, worldToLonLat } from './mercator.ts';

type Point = readonly [number, number];
type Sides = MapComposition['feather']['squarePx'];
export type Anchor = readonly [column: 0 | 1 | 2, row: 0 | 1 | 2];
export interface PhotoSize { widthPx: number; heightPx: number }
export interface EditorState {
  composition: MapComposition;
  anchor: Anchor | null;
  marginPx: Point;
  /** Height over width, so a rectangle returns with its own proportions after visiting another shape. */
  rectangleAspect: number;
}

export type EditAction =
  | { type: 'center' | 'margin'; value: Point }
  | { type: 'anchor'; value: Anchor }
  | { type: 'geographicCenter'; value: LonLat }
  | { type: 'size' | 'width' | 'height' | 'rotation' | 'range' | 'circleFeather' |
      'lineScale' | 'opacity' | 'maxCount'; value: number }
  | { type: 'shape'; value: MapComposition['shape'] }
  | { type: 'sideFeather'; side: 0 | 1 | 2 | 3; value: number }
  | { type: 'allFeather'; value: number }
  | { type: 'color'; value: MapComposition['style']['color'] }
  | { type: 'layer'; layer: LayerId; value: boolean }
  | { type: 'detail'; value: DetailOffset }
  | { type: 'language'; value: LabelLanguage }
  | { type: 'showAreas'; value: boolean }
  | { type: 'reset' };

// Experimental limits in config/editor-policy.json.
export { MIN_LAYER_PX };
export const MIN_RANGE_KM = 0.5, MAX_RANGE_KM = 500;
const MAX_LABELS = 20;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function createEditorState(photo: PhotoSize, coordinate: LonLat): EditorState {
  const composition = defaultComposition(
    { orientedWidthPx: photo.widthPx, orientedHeightPx: photo.heightPx }, { coordinate },
  )!;
  return { composition, anchor: [1, 1], marginPx: [0, 0], rectangleAspect: 1 / 2 };
}

export function anchoredCenter(anchor: Anchor, margin: Point, photo: PhotoSize, c: MapComposition): [number, number] {
  const [w, h] = layerExtent(c);
  const axis = (slot: number, size: number, extent: number, gap: number) => {
    const low = extent / 2 + gap, high = size - extent / 2 - gap;
    return low > high ? size / 2 : low + (high - low) * slot / 2;
  };
  return [axis(anchor[0], photo.widthPx, w, margin[0]), axis(anchor[1], photo.heightPx, h, margin[1])];
}

export function snapCenter(center: Point, c: MapComposition): [number, number] {
  const [w, h] = rasterSize(c, 1);
  return [Math.round(center[0] - w / 2) + w / 2, Math.round(center[1] - h / 2) + h / 2];
}

/** Read displacement from pointer-down, so moving back to the origin restores the exact coordinate. */
export function pannedCenter(start: LonLat, dxPx: number, dyPx: number, c: MapComposition): [number, number] {
  if (dxPx === 0 && dyPx === 0) return [...start];
  const angle = -c.rotationDegrees * Math.PI / 180;
  const dx = dxPx * Math.cos(angle) - dyPx * Math.sin(angle);
  const dy = dxPx * Math.sin(angle) + dyPx * Math.cos(angle);
  const worldPerPx = c.metersPerImagePixel / metersPerWorldUnit(start[1]);
  const [x, y] = lonLatToWorld(start);
  return worldToLonLat(x - dx * worldPerPx, clamp(y - dy * worldPerPx, 0, 1));
}

/** Placement can change without rendering a new layer. Compare the resolved line color separately. */
export function renderKey(c: MapComposition): string {
  return JSON.stringify([c.widthPx, c.heightPx, c.rotationDegrees, c.shape, c.metersPerImagePixel,
    c.geographicCenter, c.detailOffset, c.visibleLayers, c.labels, c.feather, c.scalePx, c.style.lineScale]);
}

function resized(c: MapComposition, width: number, min: number, max: number): MapComposition {
  const limited = clamp(width / c.widthPx, min / Math.min(c.widthPx, c.heightPx), max / Math.max(c.widthPx, c.heightPx));
  // Layer sizes stay whole pixels, so the map scale follows the rounded width.
  const widthPx = Math.round(c.widthPx * limited), heightPx = Math.round(c.heightPx * limited);
  const factor = widthPx / c.widthPx;
  const scaleSides = ([t, r, b, l]: Sides): Sides => [t * factor, r * factor, b * factor, l * factor];
  return { ...c, widthPx, heightPx, scalePx: c.scalePx * factor,
    metersPerImagePixel: c.metersPerImagePixel / factor,
    feather: { ...c.feather, circlePx: c.feather.circlePx * factor, squarePx: scaleSides(c.feather.squarePx),
      rectanglePx: scaleSides(c.feather.rectanglePx) } };
}

/**
 * In a photo's corner, the two sides along its edges stay hard: fading them would float the map off the edge. These are
 * the layer's own sides, top first, so a quarter turn moves them round. Any other angle has no side along an edge.
 */
export function cornerSides(anchor: Anchor | null, rotationDegrees: number): MapComposition['feather']['hardSides'] {
  if (!anchor || anchor[0] === 1 || anchor[1] === 1 || rotationDegrees % 90 !== 0) return [false, false, false, false];
  const photoSides = [anchor[1] === 0, anchor[0] === 2, anchor[1] === 2, anchor[0] === 0];
  const turns = (rotationDegrees / 90 % 4 + 4) % 4;
  const side = (i: number) => photoSides[(i + turns) % 4]!;
  return [side(0), side(1), side(2), side(3)];
}

export function editComposition(state: EditorState, action: EditAction, photo: PhotoSize): EditorState {
  let { composition: c, anchor, marginPx, rectangleAspect } = state;
  const max = Math.max(photo.widthPx, photo.heightPx), min = Math.min(MIN_LAYER_PX, max);
  // Restrict the crop itself when it reaches a km limit, preserving geographic scale and stroke sizes.
  const cropWidth = (w: number) => Math.round(clamp(w, Math.max(min, MIN_RANGE_KM * 1000 / c.metersPerImagePixel),
    Math.min(max, MAX_RANGE_KM * 1000 / c.metersPerImagePixel)));

  switch (action.type) {
    case 'reset': return createEditorState(photo, c.geographicCenter);
    case 'center': anchor = null; c = { ...c, centerPx: action.value }; break;
    case 'anchor': anchor = action.value; break;
    case 'margin':
      marginPx = [clamp(action.value[0], 0, photo.widthPx), clamp(action.value[1], 0, photo.heightPx)];
      break;
    case 'size': c = resized(c, action.value, min, max); break;
    case 'width':
      if (c.shape !== 'rectangle') return state;
      c = { ...c, widthPx: cropWidth(action.value) }; break;
    case 'height':
      if (c.shape !== 'rectangle') return state;
      c = { ...c, heightPx: Math.round(clamp(action.value, min, max)) }; break;
    case 'shape': {
      if (c.shape === action.value) return state;
      // The width carries across shapes, so the layer and its geographic range never shrink by switching.
      if (c.shape === 'rectangle') rectangleAspect = c.heightPx / c.widthPx;
      const heightPx = action.value === 'rectangle' ? clamp(Math.round(c.widthPx * rectangleAspect), min, max) : c.widthPx;
      c = { ...c, shape: action.value, heightPx }; break;
    }
    case 'rotation': {
      let degrees = action.value % 360;
      if (degrees > 180) degrees -= 360;
      if (degrees < -180) degrees += 360;
      c = { ...c, rotationDegrees: degrees }; break;
    }
    case 'geographicCenter': c = { ...c, geographicCenter: action.value }; break;
    case 'range':
      c = { ...c, metersPerImagePixel: clamp(action.value, MIN_RANGE_KM, MAX_RANGE_KM) * 1000 / c.widthPx }; break;
    case 'circleFeather':
      c = { ...c, feather: { ...c.feather, circlePx: clamp(action.value, 0, c.widthPx / 2) } }; break;
    case 'sideFeather': {
      if (c.shape === 'circle') return state;
      const key = c.shape === 'square' ? 'squarePx' : 'rectanglePx';
      const { side, value } = action;
      const widths = [...c.feather[key]] as [number, number, number, number];
      widths[side] = clamp(value, 0, (side % 2 ? c.widthPx : c.heightPx) / 2);
      const hardSides = [...c.feather.hardSides] as [boolean, boolean, boolean, boolean];
      hardSides[side] = false; // Asking for a fade on this side overrides the corner's default.
      c = { ...c, feather: { ...c.feather, [key]: widths, hardSides } };
      break;
    }
    case 'allFeather': {
      if (c.shape === 'circle') return state;
      const key = c.shape === 'square' ? 'squarePx' : 'rectanglePx';
      const width = clamp(action.value, 0, Math.min(c.widthPx, c.heightPx) / 2);
      c = { ...c, feather: { ...c.feather, [key]: [width, width, width, width] } };
      break;
    }
    case 'color': c = { ...c, style: { ...c.style, color: action.value } }; break;
    case 'lineScale': c = { ...c, style: { ...c.style, lineScale: clamp(action.value, 0.5, 2) } }; break;
    case 'opacity': c = { ...c, style: { ...c.style, opacity: clamp(action.value, 0.1, 1) } }; break;
    case 'layer': c = { ...c, visibleLayers: { ...c.visibleLayers, [action.layer]: action.value } }; break;
    case 'detail': c = { ...c, detailOffset: action.value }; break;
    case 'language': c = { ...c, labels: { ...c.labels, language: action.value } }; break;
    case 'showAreas': c = { ...c, labels: { ...c.labels, showAreas: action.value } }; break;
    case 'maxCount': c = { ...c, labels: { ...c.labels, maxCount: clamp(Math.round(action.value), 0, MAX_LABELS) } }; break;
  }

  if (action.type === 'anchor' || action.type === 'center' || action.type === 'rotation' || action.type === 'shape') {
    c = { ...c, feather: { ...c.feather, hardSides: cornerSides(anchor, c.rotationDegrees) } };
  }
  const center = anchor ? anchoredCenter(anchor, marginPx, photo, c) : c.centerPx;
  const [x, y] = snapCenter([clamp(center[0], 0, photo.widthPx), clamp(center[1], 0, photo.heightPx)], c);
  const axis = (snapped: number, target: number, dimension: number) => {
    // Centered anchors use the default composition's lower pixel on exact ties.
    if (anchor && target === dimension / 2 && snapped === target + 0.5) return snapped - 1;
    // An odd raster can only have a half-pixel center. Keep it just inside the far edge.
    return snapped > dimension ? snapped - 1 : snapped;
  };
  const centerPx: Point = [axis(x, center[0], photo.widthPx), axis(y, center[1], photo.heightPx)];
  return { composition: { ...c, centerPx }, anchor, marginPx, rectangleAspect };
}
