import type { LonLat, MapComposition, TileKey } from '../contracts.ts';
import { lonLatToWorld, metersPerWorldUnit } from './mercator.ts';

function sourcePixelsPerWorld(composition: MapComposition): number {
  return metersPerWorldUnit(composition.geographicCenter[1]) / composition.metersPerImagePixel;
}

/** Project into the unrotated layer. The compositor applies the photo-space rotation. */
function worldToLayer(x: number, y: number, composition: MapComposition, scale: number): [number, number] {
  const [cx, cy] = lonLatToWorld(composition.geographicCenter);
  const dx = x - cx;
  const wrapped = dx > 0.5 ? dx - 1 : dx < -0.5 ? dx + 1 : dx;
  return [composition.widthPx / 2 + wrapped * scale, composition.heightPx / 2 + (y - cy) * scale];
}

export function projectToLayer(lonLat: LonLat, composition: MapComposition): [number, number] {
  const [x, y] = lonLatToWorld(lonLat);
  return worldToLayer(x, y, composition, sourcePixelsPerWorld(composition));
}

export function tileTransform(key: TileKey, extent: number, composition: MapComposition, outputScale: number): {
  matrix: [number, number, number, number, number, number];
  clip: { x: number; y: number; width: number; height: number };
} {
  const tiles = 2 ** key.z;
  const pxPerWorld = sourcePixelsPerWorld(composition);
  const [left, top] = worldToLayer(key.x / tiles, key.y / tiles, composition, pxPerWorld);
  const size = pxPerWorld * outputScale / tiles;
  const x = left * outputScale;
  const y = top * outputScale;
  return { matrix: [size / extent, 0, 0, size / extent, x, y], clip: { x, y, width: size, height: size } };
}
