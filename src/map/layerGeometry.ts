import type { LonLat, MapComposition, TileKey } from '../contracts.ts';
import { lonLatToWorld, metersPerWorldUnit } from './mercator.ts';

function sourcePixelsPerWorld(composition: MapComposition): number {
  return metersPerWorldUnit(composition.geographicCenter[1]) / composition.metersPerImagePixel;
}

/** Project into the layer's own coordinates, before turning its vectors onto the photo. */
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

/** Upright bounding box of the rotated vector layer in source pixels. */
export function layerExtent({ widthPx, heightPx, rotationDegrees, shape }: MapComposition): [number, number] {
  if (shape === 'circle') return [widthPx, heightPx];
  const a = rotationDegrees * Math.PI / 180;
  const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  return [widthPx * cos + heightPx * sin, widthPx * sin + heightPx * cos];
}

export function rasterSize(composition: MapComposition, outputScale: number): [number, number] {
  const [w, h] = layerExtent(composition);
  // Quarter turns can be a floating point epsilon past an exact integer.
  return [Math.max(1, Math.ceil(w * outputScale - 1e-6)), Math.max(1, Math.ceil(h * outputScale - 1e-6))];
}

export function hitsLayer(point: readonly [number, number], c: MapComposition): boolean {
  const dx = point[0] - c.centerPx[0], dy = point[1] - c.centerPx[1];
  if (c.shape === 'circle') return Math.hypot(dx, dy) <= c.widthPx / 2;
  const a = -c.rotationDegrees * Math.PI / 180;
  const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(x) <= c.widthPx / 2 && Math.abs(y) <= c.heightPx / 2;
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
