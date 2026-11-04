import type { RoadKind } from '../contracts.ts';

export function lineColorFor(meanLuminance: number): string {
  return meanLuminance > 0.55 ? '#1a1a1a' : '#ffffff';
}

/** Source-image pixels; convert to output pixels only when actually stroking a path. */
export function lineWidths(widthPx: number): Record<RoadKind | 'water' | 'hiking', number> {
  const u = widthPx / 2400;
  return { major: 4 * u, standard: 2.6 * u, all: 1.6 * u, water: 2.2 * u, hiking: 1.2 * u };
}
