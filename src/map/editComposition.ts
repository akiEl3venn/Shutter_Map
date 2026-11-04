import type { DetailOffset, LabelLanguage, LayerId, LonLat, MapComposition, MapFocus } from '../contracts.ts';
import { defaultComposition, MIN_LAYER_PX } from './composition.ts';
import { projectToLayer, rasterSize } from './layerGeometry.ts';
import { lonLatToWorld, metersPerWorldUnit, worldToLonLat } from './mercator.ts';

type Point = readonly [number, number];
type Sides = MapComposition['feather']['squarePx'];
type SideFlags = readonly [top: boolean, right: boolean, bottom: boolean, left: boolean];
export type Anchor = readonly [column: 0 | 1 | 2, row: 0 | 1 | 2];
export interface PhotoSize { widthPx: number; heightPx: number }
export interface EditorState {
  composition: MapComposition;
  /** The reference point on the photo. The layer sits at this point plus offsetPx. */
  anchor: Anchor;
  marginPx: Point;
  /** Right and down from the anchor's position, so every anchor starts at (0, 0). */
  offsetPx: Point;
  /** Height over width, so a rectangle returns with its own proportions after visiting another shape. */
  rectangleAspect: number;
  /** Sides someone asked to fade on their own, which keep that fade even in a photo's corner. */
  softSides: SideFlags;
}

export type EditAction =
  | { type: 'center' | 'margin' | 'offset'; value: Point }
  | { type: 'anchor'; value: Anchor }
  | { type: 'geographicCenter'; value: LonLat }
  | { type: 'focus'; value: MapFocus | null }
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

export function createEditorState(photo: PhotoSize, coordinate: LonLat, focus: MapFocus | null = null): EditorState {
  const base = defaultComposition(
    { orientedWidthPx: photo.widthPx, orientedHeightPx: photo.heightPx }, { coordinate },
  )!;
  const composition = { ...base, labels: { ...base.labels, focus } };
  return { composition, anchor: [1, 1], marginPx: [0, 0], offsetPx: [0, 0], rectangleAspect: 1 / 2,
    softSides: [false, false, false, false] };
}

/** From the layer's own size, not its turned outline, so that turning it leaves it where it is. */
export function anchoredCenter(anchor: Anchor, margin: Point, photo: PhotoSize, c: MapComposition): [number, number] {
  const axis = (slot: number, size: number, extent: number, gap: number) => {
    const low = extent / 2 + gap, high = size - extent / 2 - gap;
    return low > high ? size / 2 : low + (high - low) * slot / 2;
  };
  return [axis(anchor[0], photo.widthPx, c.widthPx, margin[0]), axis(anchor[1], photo.heightPx, c.heightPx, margin[1])];
}

/**
 * The map's center after turning the layer to `degrees`, chosen so the map turns around the landmark it is about: that
 * point stays where it is on the photo. Without one, the map simply turns around its own center.
 */
function turnedAroundFocus(c: MapComposition, degrees: number): LonLat {
  if (!c.labels.focus) return c.geographicCenter;
  const [x, y] = projectToLayer(c.labels.focus.coordinate, c);
  const dx = x - c.widthPx / 2, dy = y - c.heightPx / 2;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return c.geographicCenter;
  const turn = (c.rotationDegrees - degrees) * Math.PI / 180;
  const worldPerPx = c.metersPerImagePixel / metersPerWorldUnit(c.geographicCenter[1]);
  const [focusX, focusY] = lonLatToWorld(c.labels.focus.coordinate);
  return worldToLonLat(focusX - (dx * Math.cos(turn) - dy * Math.sin(turn)) * worldPerPx,
    clamp(focusY - (dx * Math.sin(turn) + dy * Math.cos(turn)) * worldPerPx, 0, 1));
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

/** Sitting exactly on an anchor in one of the photo's corners. Moved off it, the layer is simply somewhere on the photo. */
export function inPhotoCorner({ composition: c, anchor, offsetPx }: EditorState): boolean {
  return c.shape !== 'circle' && anchor[0] !== 1 && anchor[1] !== 1 && offsetPx[0] === 0 && offsetPx[1] === 0;
}

/**
 * The composition to draw. In a corner the photo's corner stays at full strength: fading towards it would float the map
 * off the photo's edges. So the layer reaches out until it covers that corner, and no side fades as far as it. Upright
 * this just leaves the two sides along the photo's edges hard; turned, the map goes on filling the corner, and each
 * side's fade grows back gradually as the side turns away from it.
 */
export function drawnComposition(state: EditorState, photo: PhotoSize): MapComposition {
  const { composition: c, anchor, marginPx, softSides } = state;
  if (!inPhotoCorner(state)) return c;
  const a = -c.rotationDegrees * Math.PI / 180;
  const dx = (anchor[0] === 0 ? marginPx[0] : photo.widthPx - marginPx[0]) - c.centerPx[0];
  const dy = (anchor[1] === 0 ? marginPx[1] : photo.heightPx - marginPx[1]) - c.centerPx[1];
  // The corner in the layer's own axes, then how far it lies beyond each side, top first. Inside, this is negative.
  const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
  const beyond = [-y - c.heightPx / 2, x - c.widthPx / 2, y - c.heightPx / 2, -x - c.widthPx / 2];
  // A center can be half a pixel off, so under a pixel counts as on the side.
  const reach = beyond.map((value, i) => softSides[i] || value < 1 ? 0 : Math.ceil(value));
  const key = c.shape === 'square' ? 'squarePx' : 'rectanglePx';
  const fades = c.feather[key].map((saved, i) => {
    const toCorner = reach[i]! - beyond[i]!;
    return softSides[i] ? saved : Math.min(saved, toCorner < 1 ? 0 : toCorner);
  }) as unknown as Sides;
  const feathered = { ...c, feather: { ...c.feather, [key]: fades } };
  if (reach.every(value => value === 0)) return feathered;

  const grown = { ...feathered, widthPx: c.widthPx + reach[1]! + reach[3]!, heightPx: c.heightPx + reach[0]! + reach[2]! };
  // The longer layer's center moves along the layer's axes, and the map's center with it, so the roads stay put.
  const sx = (reach[1]! - reach[3]!) / 2, sy = (reach[2]! - reach[0]!) / 2;
  const [cx, cy] = snapCenter([c.centerPx[0] + sx * Math.cos(a) + sy * Math.sin(a),
    c.centerPx[1] - sx * Math.sin(a) + sy * Math.cos(a)], grown);
  const px = cx - c.centerPx[0], py = cy - c.centerPx[1];
  const worldPerPx = c.metersPerImagePixel / metersPerWorldUnit(c.geographicCenter[1]);
  const [worldX, worldY] = lonLatToWorld(c.geographicCenter);
  return { ...grown, centerPx: [cx, cy], geographicCenter: worldToLonLat(
    worldX + (px * Math.cos(a) - py * Math.sin(a)) * worldPerPx,
    clamp(worldY + (px * Math.sin(a) + py * Math.cos(a)) * worldPerPx, 0, 1)) };
}

export function editComposition(state: EditorState, action: EditAction, photo: PhotoSize): EditorState {
  let { composition: c, anchor, marginPx, offsetPx, rectangleAspect, softSides } = state;
  const max = Math.max(photo.widthPx, photo.heightPx), min = Math.min(MIN_LAYER_PX, max);
  // Restrict the crop itself when it reaches a km limit, preserving geographic scale and stroke sizes.
  const cropWidth = (w: number) => Math.round(clamp(w, Math.max(min, MIN_RANGE_KM * 1000 / c.metersPerImagePixel),
    Math.min(max, MAX_RANGE_KM * 1000 / c.metersPerImagePixel)));

  switch (action.type) {
    case 'reset': return createEditorState(photo, c.geographicCenter, c.labels.focus);
    case 'center': case 'offset': break; // Both depend on the anchor's position for the final layer, below.
    case 'anchor':
      anchor = action.value;
      offsetPx = [0, 0];
      softSides = [false, false, false, false];
      break;
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
      c = { ...c, rotationDegrees: degrees, geographicCenter: turnedAroundFocus(c, degrees) }; break;
    }
    case 'geographicCenter': c = { ...c, geographicCenter: action.value }; break;
    case 'focus': c = { ...c, labels: { ...c.labels, focus: action.value } }; break;
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
      c = { ...c, feather: { ...c.feather, [key]: widths } };
      softSides = softSides.map((soft, i) => soft || i === side) as unknown as SideFlags;
      break;
    }
    case 'allFeather': {
      if (c.shape === 'circle') return state;
      const key = c.shape === 'square' ? 'squarePx' : 'rectanglePx';
      const width = clamp(action.value, 0, Math.min(c.widthPx, c.heightPx) / 2);
      c = { ...c, feather: { ...c.feather, [key]: [width, width, width, width] } };
      softSides = [false, false, false, false];
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

  const base = anchoredCenter(anchor, marginPx, photo, c);
  if (action.type === 'center' || action.type === 'offset') {
    // Whole pixels, kept within reach: the layer's center stays on the photo.
    const wanted = action.type === 'center' ? [action.value[0] - base[0], action.value[1] - base[1]] : action.value;
    offsetPx = [Math.round(clamp(wanted[0]!, -base[0], photo.widthPx - base[0])),
      Math.round(clamp(wanted[1]!, -base[1], photo.heightPx - base[1]))];
  }
  const center = [base[0] + offsetPx[0], base[1] + offsetPx[1]] as const;
  const [x, y] = snapCenter([clamp(center[0], 0, photo.widthPx), clamp(center[1], 0, photo.heightPx)], c);
  const axis = (snapped: number, target: number, dimension: number) => {
    // A centered layer uses the default composition's lower pixel on exact ties.
    if (target === dimension / 2 && snapped === target + 0.5) return snapped - 1;
    // An odd raster can only have a half-pixel center. Keep it just inside the far edge.
    return snapped > dimension ? snapped - 1 : snapped;
  };
  const centerPx: Point = [axis(x, center[0], photo.widthPx), axis(y, center[1], photo.heightPx)];
  return { composition: { ...c, centerPx }, anchor, marginPx, offsetPx, rectangleAspect, softSides };
}
