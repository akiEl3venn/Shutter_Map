import type { DetailOffset, MapComposition, RoadKind } from '../contracts.ts';

export function lineColorFor(meanLuminance: number): string {
  return meanLuminance > 0.55 ? '#1a1a1a' : '#ffffff';
}

/**
 * Opacity, and how far across the fade each class reaches: smaller roads disappear sooner, and main roads run on furthest.
 * All of them start fading at the same place.
 */
export const layerLook = {
  water: { alpha: 0.7, reach: 0.95 },
  hiking: { alpha: 0.45, reach: 0.7 },
  all: { alpha: 0.55, reach: 0.7 },
  standard: { alpha: 0.85, reach: 0.9 },
  major: { alpha: 1, reach: 1 },
} as const;

/** An eased falloff across the fade band: position in the band, then opacity. */
export const fadeStops = [[0, 1], [0.25, 0.84], [0.5, 0.5], [0.75, 0.16], [1, 0]] as const;

/** Source-image pixels; convert to output pixels only when actually stroking a path. */
export function lineWidths(scalePx: number, lineScale = 1): Record<RoadKind | 'water' | 'hiking', number> {
  const u = scalePx / 2400 * lineScale;
  return { major: 4 * u, standard: 2.6 * u, all: 1.6 * u, water: 2.2 * u, hiking: 1.2 * u };
}

/**
 * What each detail level draws besides main roads: the least spacing between roads, in the same unit as line widths, so
 * a level looks the same at any photo size and range. Null leaves the class out; 0 draws all of it, however crowded.
 */
const detailSpacing: Record<DetailOffset, Record<'streets' | 'lanes' | 'trails', number | null>> = {
  [-1]: { streets: null, lanes: null, trails: 12 },
  0: { streets: 12, lanes: null, trails: 12 },
  1: { streets: 6, lanes: 12, trails: 6 },
  2: { streets: 0, lanes: 0, trails: 0 },
};

export function roadSpacing(detail: DetailOffset, scalePx: number) {
  const inPixels = (units: number | null) => units === null ? null : units * scalePx / 2400;
  const { streets, lanes, trails } = detailSpacing[detail];
  return { streets: inPixels(streets), lanes: inPixels(lanes), trails: inPixels(trails) };
}

/** The one landmark the map is about stands out from the roads, whatever color those are. */
export const focusColor = '#e5281f';

/** The slider's top, as a share of the layer's half size. At 100% the map fades out as far beyond an edge as the edge is from the center. */
export const MAX_FEATHER_PERCENT = 200;

/** A smaller layer limits the fade without overwriting a shape's saved widths. */
export const circleFeather = (c: MapComposition) => Math.min(c.feather.circlePx, c.widthPx / 2 * MAX_FEATHER_PERCENT / 100);

/** Up to this share of the layer's short half, a fade lies wholly beyond the layer, which stays at full strength. */
const FADE_ALL_OUTSIDE = 0.75;
/** A stronger fade is shared: this much of each further step comes into the layer, and the rest reaches further out. */
const FURTHER_INSIDE = 0.75;
/** Labels keep out of the fade inside the layer, but this much of the short half is as far as they are pushed in. */
const LABEL_FADE_LIMIT = 0.34;
const shortHalf = (c: MapComposition) => Math.min(c.widthPx, c.heightPx) / 2;

/** How much of a fade of this width lies inside the layer. The rest lies beyond its edge. */
export function fadeInside(featherPx: number, c: MapComposition): number {
  return FURTHER_INSIDE * Math.max(0, featherPx - FADE_ALL_OUTSIDE * shortHalf(c));
}

export function sideFeather(c: MapComposition): [number, number, number, number] {
  const [top, right, bottom, left] = c.shape === 'square' ? c.feather.squarePx : c.feather.rectanglePx;
  const limit = (size: number) => size / 2 * MAX_FEATHER_PERCENT / 100;
  return [Math.min(top, limit(c.heightPx)), Math.min(right, limit(c.widthPx)), Math.min(bottom, limit(c.heightPx)), Math.min(left, limit(c.widthPx))];
}

/** The fade along each edge, top first, whatever the shape. */
export function fadeWidths(c: MapComposition): [number, number, number, number] {
  const circle = circleFeather(c);
  return c.shape === 'circle' ? [circle, circle, circle, circle] : sideFeather(c);
}

export function labelInsets(c: MapComposition): [number, number, number, number] {
  const inset = (feather: number) => Math.min(fadeInside(feather, c), LABEL_FADE_LIMIT * shortHalf(c));
  const [top, right, bottom, left] = fadeWidths(c);
  return [inset(top), inset(right), inset(bottom), inset(left)];
}
