import { classifyRings, VectorTile } from '@mapbox/vector-tile';
import type { VectorTileFeature, VectorTileLayer } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { PlaceKind, RoadKind, TileKey } from '../contracts.ts';
import { classifyRoad } from './roadClass.ts';

export interface TileFeatures {
  key: TileKey;
  extent: number;
  roads: { kind: RoadKind; line: number[] }[];
  hiking: { line: number[] }[];
  /** Each polygon contains an outer ring followed by its holes. */
  water: { polygons: number[][][]; lines: number[][] };
  places: {
    kind: PlaceKind;
    x: number;
    y: number;
    name: string;
    names: Partial<Record<'en' | 'zh' | 'ja', string>>;
    rank: number;
  }[];
}

const excludedRoads = new Set(['rail', 'ferry', 'aerialway', 'aeroway', 'pier']);
const landmarks = new Set(['attraction', 'landmark', 'memorial', 'monument', 'museum', 'castle', 'viewpoint', 'lighthouse', 'tower']);
type Properties = VectorTileFeature['properties'];
type Point = { x: number; y: number };

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numeric(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function flatLine(points: Point[], scale: number): number[] {
  const result = new Array<number>(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    result[i * 2] = points[i].x * scale;
    result[i * 2 + 1] = points[i].y * scale;
  }
  return result;
}

function eachFeature(layer: VectorTileLayer | undefined, visit: (feature: VectorTileFeature) => void): void {
  if (!layer) return;
  for (let i = 0; i < layer.length; i++) visit(layer.feature(i));
}

function addPlace(result: TileFeatures, feature: VectorTileFeature, kind: PlaceKind, rank: number): void {
  const properties: Properties = feature.properties;
  const name = text(properties.name);
  if (!name || feature.type !== 1) return;
  const names: TileFeatures['places'][number]['names'] = {};
  const en = text(properties['name:en']);
  const ja = text(properties['name:ja']);
  const zh = text(properties['name:zh-Hans']) ?? text(properties['name:zh-Hant']);
  if (en) names.en = en;
  if (ja) names.ja = ja;
  if (zh) names.zh = zh;
  const scale = result.extent / feature.extent;
  for (const points of feature.loadGeometry()) {
    for (const point of points) {
      result.places.push({ kind, x: point.x * scale, y: point.y * scale, name, names, rank });
    }
  }
}

/** Adapt Protomaps basemap MVT to our own layers; bytes are already HTTP-decompressed. */
export function decodeTile(bytes: ArrayBuffer, key: TileKey): TileFeatures {
  const { layers } = new VectorTile(new PbfReader(new Uint8Array(bytes)));
  const extent = (layers.roads ?? layers.water ?? layers.places ?? layers.pois)?.extent ?? 4096;
  const result: TileFeatures = { key, extent, roads: [], hiking: [], water: { polygons: [], lines: [] }, places: [] };

  eachFeature(layers.roads, (feature) => {
    if (feature.type !== 2 || excludedRoads.has(String(feature.properties.kind))) return;
    // Development tiles omit bicycle/foot tags: cycle-only paths cannot be identified,
    // so a path remains hiking. Dedicated cycleways are still excluded by the filter.
    const classification = classifyRoad({ highway: text(feature.properties.kind_detail) });
    if (!classification) return;
    for (const points of feature.loadGeometry()) {
      const line = flatLine(points, extent / feature.extent);
      if (classification.layer === 'hiking') result.hiking.push({ line });
      else result.roads.push({ kind: classification.detail, line });
    }
  });

  eachFeature(layers.water, (feature) => {
    if (feature.type !== 2 && feature.type !== 3) return;
    const geometry = feature.loadGeometry();
    const scale = extent / feature.extent;
    if (feature.type === 2) {
      for (const points of geometry) result.water.lines.push(flatLine(points, scale));
    } else {
      for (const polygon of classifyRings(geometry)) {
        result.water.polygons.push(polygon.map((ring) => flatLine(ring, scale)));
      }
    }
  });

  eachFeature(layers.places, (feature) => {
    const kind = feature.properties.kind_detail;
    if (kind !== 'city' && kind !== 'town' && kind !== 'village') return;
    const rank = numeric(feature.properties.population_rank) ?? numeric(feature.properties.population) ?? 0;
    addPlace(result, feature, kind, rank);
  });
  eachFeature(layers.pois, (feature) => {
    const kind = text(feature.properties.kind);
    if (kind === 'peak' || kind === 'volcano') {
      addPlace(result, feature, 'peak', numeric(feature.properties.elevation) ?? 0);
    } else if (kind && landmarks.has(kind)) {
      // Protomaps moves prominent POIs to lower zooms, so a smaller min_zoom means more famous.
      addPlace(result, feature, 'landmark', 15 - (numeric(feature.properties.min_zoom) ?? 15));
    }
  });

  // Keep tile-local coordinates, including the buffer outside [0, extent], for later drawing.
  return result;
}
