import type { ImageFormat } from './photo/sniff.ts';

/** Draft v2 contracts (docs/architecture.md). No HTTP API of our own: tiles are static z/x/y MVT behind an edge cache. */
export type LonLat = readonly [longitude: number, latitude: number];
export type Meters = number;
export type ImagePixels = number;
/** Terrain/contours are excluded from the current product scope. */
export type LayerId = 'roads' | 'hiking' | 'water' | 'places';
/** `roads.kind`; must match classifyRoad().detail in src/map/roadClass.ts. */
export type RoadKind = 'major' | 'standard' | 'all';
export type PlaceKind = 'city' | 'town' | 'village' | 'peak' | 'landmark';
/** A language code as map names use it: en, it, ja, zh (simplified), zh-Hant. */
export type LabelLanguage = string;
/** A tile absent from the archive is `ready` with no features, not an error. */
export type TileState = 'loading' | 'ready' | 'failed';
export type DetailOffset = -1 | 0 | 1 | 2;

export interface TileKey {
  z: number;
  x: number;
  y: number;
}

/** Pinned in the tool build; a name is never reused, so tiles are cached as immutable. */
export interface Tileset {
  /** e.g. 'roads-2026' → `${baseUrl}/${name}/{z}/{x}/{y}.mvt` */
  name: string;
  baseUrl: string;
  maxZoom: number;
  sourceTimestamp: string;
  attribution: string;
}

/** A hit from the local fuzzy search or the cascade; queries never leave the browser. */
export interface PlaceResult {
  id?: number;
  matchedName?: string;
  /** Present alongside a Chinese display name, to match and label the place in other languages. */
  englishName?: string;
  kind: 'city' | 'landmark' | 'coordinate';
  /** GeoNames feature code for landmarks, e.g. 'MUS' or 'PK'. */
  featureCode?: string;
  name: string;
  coordinate: LonLat;
  countryCode?: string;
  admin1Code?: string;
  admin1?: string;
}

export interface PlaceSearch {
  /** Runs over already-loaded geo data; coordinate-like input yields a 'coordinate' result first. */
  search(query: string, limit: number): PlaceResult[];
}

/** Never persist, serialize to network, include in telemetry, or attach to an error. */
export interface PhotoSession {
  file: File;
  /** Reuse the same orientation and decode path when loading source pixels for export. */
  exifOrientation: number | null;
  sourceFormat: ImageFormat;
  orientedWidthPx: ImagePixels;
  orientedHeightPx: ImagePixels;
  /** Kept in memory for restoring the photo's original position. */
  exifLocation: LonLat | null;
}

/** The one place a map singles out: the landmark chosen, or whichever stands where the photo was taken (no name). */
export interface MapFocus {
  coordinate: LonLat;
  name?: string;
  englishName?: string;
}

export interface LocationChoice {
  coordinate: LonLat;
  source: 'exif' | 'search' | 'coordinate';
  /** Present when the source is search. */
  place?: PlaceResult;
  /** Carried over when the map is dragged, which changes the center but not what the photo is of. */
  focus?: MapFocus | null;
}

export interface MapComposition {
  centerPx: readonly [ImagePixels, ImagePixels];
  widthPx: ImagePixels;
  heightPx: ImagePixels;
  /** Symbol sizes follow this scale, independently of the width of a rectangular crop. */
  scalePx: ImagePixels;
  style: {
    color: 'auto' | `#${string}`;
    lineScale: number;
    opacity: number;
  };
  rotationDegrees: number;
  shape: 'circle' | 'square' | 'rectangle';
  /** Independent of layer size: one isotropic geographic scale for both axes. */
  metersPerImagePixel: Meters;
  geographicCenter: LonLat;
  /** Which roads are drawn and how closely, and how much deeper than the source pixels' zoom to read. Never from the screen. */
  detailOffset: DetailOffset;
  visibleLayers: Record<LayerId, boolean>;
  labels: {
    language: LabelLanguage;
    /** The languages of the place on the map. In these, a place's own name is the right one. */
    localLanguages: readonly LabelLanguage[];
    maxCount: number;
    /** Cities, towns and districts. Off by default: named areas crowd the map, while landmarks are what people look for. */
    showAreas: boolean;
    focus: MapFocus | null;
  };
  /** How far each edge fades out beyond the layer. Inside the layer the map is at full strength. */
  feather: {
    circlePx: ImagePixels;
    squarePx: readonly [top: ImagePixels, right: ImagePixels, bottom: ImagePixels, left: ImagePixels];
    rectanglePx: readonly [top: ImagePixels, right: ImagePixels, bottom: ImagePixels, left: ImagePixels];
  };
  /**
   * What gets drawn, in the layer's own coordinates: the layer and its fade, cut off at the photo's edges so that a wide
   * fade costs no more than the photo itself. Without it, just the layer.
   */
  raster?: { x: number; y: number; width: number; height: number };
}

export interface StableRelease {
  version: string;
  commit: string;
  artifactSha256: string;
  /** The tileset this build reads; switching tilesets requires a new release. */
  tilesetName: string;
  /** Bumped when layer names, kinds or attributes change. */
  tileSchemaVersion: number;
  assetBasePath: string;
}
