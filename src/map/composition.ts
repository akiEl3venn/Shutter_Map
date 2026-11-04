import type { LocationChoice, MapComposition, PhotoSession } from '../contracts.ts';

export function defaultComposition(
  photo: Pick<PhotoSession, 'orientedWidthPx' | 'orientedHeightPx'> | null,
  location: Pick<LocationChoice, 'coordinate'> | null,
): MapComposition | null {
  if (!photo || !location) return null;
  const size = Math.min(photo.orientedWidthPx, photo.orientedHeightPx) * 0.6;
  return {
    centerPx: [photo.orientedWidthPx / 2, photo.orientedHeightPx / 2],
    widthPx: size,
    heightPx: size,
    rotationDegrees: 0,
    shape: 'circle',
    metersPerImagePixel: 10000 / size,
    geographicCenter: location.coordinate,
    detailOffset: 0,
    visibleLayers: { roads: true, hiking: false, water: true, places: true },
    labels: { language: 'local', maxCount: 12 },
    feather: { circlePx: 0, squarePx: [0, 0, 0, 0], rectanglePx: [0, 0, 0, 0] },
  };
}
