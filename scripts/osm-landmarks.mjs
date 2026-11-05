import { open } from 'node:fs/promises';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import { FsSource } from './dev-tiles.mjs';

/** Every place that can be searched for is in the tiles from this zoom on. */
const ZOOM = 12;

/**
 * The places in one tile that can be searched for. A Wikidata link (min_zoom 13) marks them as known beyond their
 * street. Cities and towns come from GeoNames, with their populations.
 */
export function landmarksInTile(bytes, z, x, y) {
  const layer = new VectorTile(new PbfReader(new Uint8Array(bytes))).layers.places;
  const scale = 2 ** z;
  const found = [];
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const feature = layer.feature(i);
    const { properties } = feature;
    const { kind, name } = properties;
    if (kind === 'city' || kind === 'town' || properties.min_zoom !== 13) continue;
    if (typeof name !== 'string' || !/\p{L}/u.test(name)) continue;
    const [[point]] = feature.loadGeometry();
    // The tile buffer repeats a point in the neighbouring tile. Only the tile that holds it counts.
    if (point.x < 0 || point.y < 0 || point.x >= feature.extent || point.y >= feature.extent) continue;
    const lon = (x + point.x / feature.extent) / scale * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + point.y / feature.extent) / scale))) * 180 / Math.PI;
    const names = Object.fromEntries(Object.entries(properties).filter(([key]) => key.startsWith('name:')).map(([key, value]) => [key.slice(5), value]));
    found.push({ name, names, kind, lat, lon });
  }
  return found;
}

export async function readLandmarks(path) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const archive = new PMTiles(new FsSource(path, handle, size));
    const { minLon, maxLon, minLat, maxLat } = await archive.getHeader();
    const scale = 2 ** ZOOM;
    const column = lon => Math.floor((lon + 180) / 360 * scale);
    const row = lat => {
      const sin = Math.sin(lat * Math.PI / 180);
      return Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale);
    };
    const landmarks = [];
    for (let x = column(minLon); x <= column(maxLon); x++) {
      for (let y = row(maxLat); y <= row(minLat); y++) {
        const tile = await archive.getZxy(ZOOM, x, y);
        if (tile) landmarks.push(...landmarksInTile(tile.data, ZOOM, x, y));
      }
    }
    return landmarks;
  } finally {
    await handle.close();
  }
}
