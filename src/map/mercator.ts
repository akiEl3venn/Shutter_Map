import type { LonLat, TileKey } from '../contracts.ts';

export const EARTH_CIRCUMFERENCE = 40075016.686;
export const MAX_TILES_PER_VIEW = 200; // config/editor-policy.json
/**
 * Each tile spans 512–1024 source pixels. Measured with a 10 km layer on a 24 MP photo (4.2 m/px, a 100 m block
 * is 24 px): 1024 picks z12, which loses about 40% of local streets and every trail; z14 only doubles the bytes.
 */
export const SOURCE_PIXELS_PER_TILE = 512;
const MAX_LATITUDE = 85.0511287798066;
const clampLatitude = (latitude: number) => Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
const wrap = (value: number, size: number) => ((value % size) + size) % size;

export function lonLatToWorld([longitude, latitude]: LonLat): [number, number] {
  const sin = Math.sin(clampLatitude(latitude) * Math.PI / 180);
  return [wrap((longitude + 180) / 360, 1), Math.max(0, Math.min(1,
    0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)))];
}

export function metersPerWorldUnit(latitude: number): number {
  return EARTH_CIRCUMFERENCE * Math.cos(clampLatitude(latitude) * Math.PI / 180);
}

export function worldToLonLat(x: number, y: number): [number, number] {
  const longitude = wrap(x, 1) * 360 - 180;
  const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  return [longitude, latitude];
}

/** Higher detail reads deeper tiles. Lower detail only leaves roads out, so it keeps the tiles and their landmarks. */
export function zoomFor(metersPerImagePixel: number, latitude: number, detailOffset = 0, maxZoom = 14): number {
  return Math.max(0, Math.min(maxZoom,
    Math.floor(Math.log2(metersPerWorldUnit(latitude) / (metersPerImagePixel * SOURCE_PIXELS_PER_TILE))) + Math.max(0, detailOffset)));
}

export interface CoverInput {
  center: LonLat;
  widthPx: number;
  heightPx: number;
  rotationDegrees: number;
  metersPerImagePixel: number;
  zoom: number;
  marginPx?: number;
}

function tileBounds(input: CoverInput) {
  const angle = input.rotationDegrees * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const absCos = Math.abs(cos);
  const absSin = Math.abs(sin);
  const margin = input.marginPx ?? 64;
  const scale = input.metersPerImagePixel / metersPerWorldUnit(input.center[1]);
  const halfWidth = ((input.widthPx * absCos + input.heightPx * absSin) / 2 + margin) * scale;
  const halfHeight = ((input.widthPx * absSin + input.heightPx * absCos) / 2 + margin) * scale;
  const [cx, cy] = lonLatToWorld(input.center);
  const size = 2 ** input.zoom;
  const minX = Math.floor((cx - halfWidth) * size);
  const maxX = Math.floor((cx + halfWidth) * size);
  const minY = Math.max(0, Math.min(size - 1, Math.floor((cy - halfHeight) * size)));
  const maxY = Math.max(0, Math.min(size - 1, Math.floor((cy + halfHeight) * size)));
  const alongWidth = (input.widthPx / 2 + margin) * scale;
  const alongHeight = (input.heightPx / 2 + margin) * scale;
  const tileReach = (absCos + absSin) / (2 * size);
  /**
   * The upright drawn area lies at an angle across a turned map, so the box around it holds up to twice the tiles it
   * touches. A tile within the box can still miss it, along either of the area's own axes.
   */
  const touches = (column: number, row: number) => {
    const dx = (column + 0.5) / size - cx, dy = (row + 0.5) / size - cy;
    return Math.abs(dx * cos - dy * sin) <= alongWidth + tileReach && Math.abs(dx * sin + dy * cos) <= alongHeight + tileReach;
  };
  return { cx, cy, size, minX, minY, maxY, columns: Math.min(size, maxX - minX + 1), touches };
}

/** Exact footprint at the requested zoom, including drawing margin. */
export function tileCover(input: CoverInput): TileKey[] {
  const { cx, cy, size, minX, minY, maxY, columns, touches } = tileBounds(input);
  const keys: TileKey[] = [];
  for (let column = 0; column < columns; column += 1) {
    const x = wrap(minX + column, size);
    for (let y = minY; y <= maxY; y += 1) if (touches(minX + column, y)) keys.push({ z: input.zoom, x, y });
  }
  const distance = ({ x, y }: TileKey) => {
    const dx = Math.abs((x + 0.5) / size - cx);
    return Math.min(dx, 1 - dx) ** 2 + ((y + 0.5) / size - cy) ** 2;
  };
  return keys.sort((a, b) => distance(a) - distance(b));
}

export interface TileCoverage {
  keys: TileKey[];
  zoom: number;
  detailReduced: boolean;
}

function tileCount(input: CoverInput): number {
  const { minX, minY, maxY, columns, touches } = tileBounds(input);
  const box = columns * (maxY - minY + 1);
  // A turned area still fills a good part of its box, so a box this far over the limit needs no counting.
  if (box > MAX_TILES_PER_VIEW * 8) return box;
  let count = 0;
  for (let column = 0; column < columns; column += 1) {
    for (let y = minY; y <= maxY; y += 1) if (touches(minX + column, y)) count += 1;
  }
  return count;
}

/** Count before allocating so very detailed views cannot create huge request lists. */
export function limitedTileCover(input: CoverInput): TileCoverage {
  let zoom = input.zoom;
  while (zoom > 0 && tileCount({ ...input, zoom }) > MAX_TILES_PER_VIEW) zoom -= 1;
  return { keys: tileCover({ ...input, zoom }), zoom, detailReduced: zoom < input.zoom };
}
