import type { DetailOffset, MapComposition, RoadKind } from '../contracts.ts';

export function lineColorFor(meanLuminance: number): string {
  return meanLuminance > 0.55 ? '#1a1a1a' : '#ffffff';
}

/**
 * Opacity, and how far out each class reaches as a share of the fade: smaller roads disappear sooner, and main roads run on
 * furthest. All of them start fading at the layer's edge, so everything inside it is at full strength.
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

export function sideFeather(c: MapComposition): [number, number, number, number] {
  const [top, right, bottom, left] = c.shape === 'square' ? c.feather.squarePx : c.feather.rectanglePx;
  const limit = (size: number) => size / 2 * MAX_FEATHER_PERCENT / 100;
  return [Math.min(top, limit(c.heightPx)), Math.min(right, limit(c.widthPx)), Math.min(bottom, limit(c.heightPx)), Math.min(left, limit(c.widthPx))];
}
