import type { LonLat, MapComposition, TileKey } from '../contracts.ts';
import { lonLatToWorld, metersPerWorldUnit, worldToLonLat } from './mercator.ts';

function sourcePixelsPerWorld(composition: MapComposition): number {
  return metersPerWorldUnit(composition.geographicCenter[1]) / composition.metersPerImagePixel;
}

/** Project into the map's own coordinates, before turning it inside the layer. */
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

/** The drawn area in the layer's own coordinates. The layer is always upright on the photo: rotating turns the map inside it. */
export function rasterOf(c: MapComposition): NonNullable<MapComposition['raster']> {
  return c.raster ?? { x: 0, y: 0, width: c.widthPx, height: c.heightPx };
}

export function rasterSize(c: MapComposition, outputScale: number): [number, number] {
  const { width, height } = rasterOf(c);
  return [Math.max(1, Math.ceil(width * outputScale - 1e-6)), Math.max(1, Math.ceil(height * outputScale - 1e-6))];
}

/** The point on the map at the middle of the drawn area, which need not be the layer's middle. To choose tiles by. */
export function rasterCenter(c: MapComposition): LonLat {
  const { x, y, width, height } = rasterOf(c);
  const dx = x + width / 2 - c.widthPx / 2, dy = y + height / 2 - c.heightPx / 2;
  if (!dx && !dy) return c.geographicCenter;
  const a = -c.rotationDegrees * Math.PI / 180;
  const worldPerPx = c.metersPerImagePixel / metersPerWorldUnit(c.geographicCenter[1]);
  const [worldX, worldY] = lonLatToWorld(c.geographicCenter);
  return worldToLonLat(worldX + (dx * Math.cos(a) - dy * Math.sin(a)) * worldPerPx,
    Math.max(0, Math.min(1, worldY + (dx * Math.sin(a) + dy * Math.cos(a)) * worldPerPx)));
}

export function hitsLayer(point: readonly [number, number], c: MapComposition): boolean {
  const dx = point[0] - c.centerPx[0], dy = point[1] - c.centerPx[1];
  if (c.shape === 'circle') return Math.hypot(dx, dy) <= c.widthPx / 2;
  return Math.abs(dx) <= c.widthPx / 2 && Math.abs(dy) <= c.heightPx / 2;
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
