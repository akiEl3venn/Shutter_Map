import type { DetailOffset, MapComposition, RoadKind } from '../contracts.ts';

export function lineColorFor(meanLuminance: number): string {
  return meanLuminance > 0.55 ? '#1a1a1a' : '#ffffff';
}

/**
 * Opacity and radial fade stops when feather equals radius. Smaller roads disappear further from the edge.
 */
export const layerLook = {
  water: { alpha: 0.7, fade: [0.6, 0.95] },
  hiking: { alpha: 0.45, fade: [0.45, 0.82] },
  all: { alpha: 0.55, fade: [0.45, 0.82] },
  standard: { alpha: 0.85, fade: [0.6, 0.92] },
  major: { alpha: 1, fade: [0.72, 1] },
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

/** Distances from the edge where an individual stroke class starts and finishes fading. */
export function fadeBand(layer: keyof typeof layerLook, featherPx: number) {
  const [inner, outer] = layerLook[layer].fade;
  return { start: (1 - inner) * featherPx, end: (1 - outer) * featherPx };
}

/** The one landmark the map is about stands out from the roads, whatever color those are. */
export const focusColor = '#e5281f';

export function haloFor(color: string): string {
  const rgb = Number.parseInt(color.slice(1), 16);
  const brightness = (0.2126 * (rgb >> 16) + 0.7152 * ((rgb >> 8) & 255) + 0.0722 * (rgb & 255)) / 255;
  return brightness > 0.5 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.8)';
}

/** Crop limits the effective feather without overwriting a shape's saved widths. */
export const circleFeather = (c: MapComposition) => Math.min(c.feather.circlePx, c.widthPx / 2);

export function sideFeather(c: MapComposition): [number, number, number, number] {
  const [top, right, bottom, left] = c.shape === 'square' ? c.feather.squarePx : c.feather.rectanglePx;
  const [hardTop, hardRight, hardBottom, hardLeft] = c.feather.hardSides;
  return [hardTop ? 0 : Math.min(top, c.heightPx / 2), hardRight ? 0 : Math.min(right, c.widthPx / 2),
    hardBottom ? 0 : Math.min(bottom, c.heightPx / 2), hardLeft ? 0 : Math.min(left, c.widthPx / 2)];
}
