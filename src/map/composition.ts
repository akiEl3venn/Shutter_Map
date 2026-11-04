import type { LocationChoice, MapComposition, PhotoSession } from '../contracts.ts';

export function defaultComposition(
  photo: Pick<PhotoSession, 'orientedWidthPx' | 'orientedHeightPx'> | null,
  location: Pick<LocationChoice, 'coordinate'> | null,
): MapComposition | null {
  if (!photo || !location) return null;
  const size = Math.max(1, Math.round(Math.min(photo.orientedWidthPx, photo.orientedHeightPx) * 0.6));
  const left = Math.floor((photo.orientedWidthPx - size) / 2);
  const top = Math.floor((photo.orientedHeightPx - size) / 2);
  return {
    centerPx: [left + size / 2, top + size / 2],
    widthPx: size,
    heightPx: size,
    rotationDegrees: 0,
    shape: 'circle',
    metersPerImagePixel: 10000 / size,
    geographicCenter: location.coordinate,
    detailOffset: 0,
    visibleLayers: { roads: true, hiking: false, water: true, places: true },
    labels: { language: 'local', maxCount: 5 },
    feather: { circlePx: 0, squarePx: [0, 0, 0, 0], rectanglePx: [0, 0, 0, 0] },
  };
}
