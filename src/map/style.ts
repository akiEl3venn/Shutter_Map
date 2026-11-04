import type { RoadKind } from '../contracts.ts';

export function lineColorFor(meanLuminance: number): string {
  return meanLuminance > 0.55 ? '#1a1a1a' : '#ffffff';
}

/**
 * How strongly each layer shows and where it fades out, as fractions of the layer's radius: small roads dissolve
 * first and main roads reach the edge, so the map has a clear hierarchy and no hard cut.
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
export function lineWidths(widthPx: number): Record<RoadKind | 'water' | 'hiking', number> {
  const u = widthPx / 2400;
  return { major: 4 * u, standard: 2.6 * u, all: 1.6 * u, water: 2.2 * u, hiking: 1.2 * u };
}
