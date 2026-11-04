import type { MapComposition, RoadKind } from '../contracts.ts';

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

/** Distances from the edge where an individual stroke class starts and finishes fading. */
export function fadeBand(layer: keyof typeof layerLook, featherPx: number) {
  const [inner, outer] = layerLook[layer].fade;
  return { start: (1 - inner) * featherPx, end: (1 - outer) * featherPx };
}

/** Landmark buildings stand out from the roads, whatever color those are. */
export const landmarkColor = '#e5281f';

export function haloFor(color: string): string {
  const rgb = Number.parseInt(color.slice(1), 16);
  const brightness = (0.2126 * (rgb >> 16) + 0.7152 * ((rgb >> 8) & 255) + 0.0722 * (rgb & 255)) / 255;
  return brightness > 0.5 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.8)';
}

/** Crop limits the effective feather without overwriting a shape's saved widths. */
export const circleFeather = (c: MapComposition) => Math.min(c.feather.circlePx, c.widthPx / 2);

export function sideFeather(c: MapComposition): [number, number, number, number] {
  const [top, right, bottom, left] = c.shape === 'square' ? c.feather.squarePx : c.feather.rectanglePx;
  return [Math.min(top, c.heightPx / 2), Math.min(right, c.widthPx / 2),
    Math.min(bottom, c.heightPx / 2), Math.min(left, c.widthPx / 2)];
}
