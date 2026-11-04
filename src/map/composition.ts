import type { LocationChoice, MapComposition, PhotoSession } from '../contracts.ts';

export const MIN_LAYER_PX = 64; // config/editor-policy.json

export function defaultComposition(
  photo: Pick<PhotoSession, 'orientedWidthPx' | 'orientedHeightPx'> | null,
  location: Pick<LocationChoice, 'coordinate'> | null,
): MapComposition | null {
  if (!photo || !location) return null;
  const minSize = Math.min(MIN_LAYER_PX, Math.max(photo.orientedWidthPx, photo.orientedHeightPx));
  const size = Math.max(minSize, Math.round(Math.min(photo.orientedWidthPx, photo.orientedHeightPx) * 0.6));
  const left = Math.floor((photo.orientedWidthPx - size) / 2);
  const top = Math.floor((photo.orientedHeightPx - size) / 2);
  return {
    centerPx: [left + size / 2, top + size / 2],
    widthPx: size,
    heightPx: size,
    scalePx: size,
    style: { color: 'auto', lineScale: 1, opacity: 0.9 },
    rotationDegrees: 0,
    shape: 'circle',
    metersPerImagePixel: 10000 / size,
    geographicCenter: location.coordinate,
    detailOffset: 0,
    visibleLayers: { roads: true, hiking: false, water: true, places: true },
    labels: { language: 'local', maxCount: 5, showAreas: false },
    feather: {
      circlePx: size / 2,
      squarePx: [size / 2, size / 2, size / 2, size / 2],
      // A quarter of the width is half the height of the default 18:9 rectangle: a full fade from its short side.
      rectanglePx: [size / 4, size / 4, size / 4, size / 4],
      hardSides: [false, false, false, false],
    },
  };
}
