/** Draft v2 contracts (docs/architecture.md). No HTTP API of our own: tiles are static z/x/y MVT behind an edge cache. */
export type LonLat = readonly [longitude: number, latitude: number];
export type Meters = number;
export type ImagePixels = number;
/** Terrain/contours are excluded from the current product scope. */
export type LayerId = 'roads' | 'hiking' | 'water' | 'places';
/** `roads.kind`; must match classifyRoad().detail in src/map/roadClass.ts. */
export type RoadKind = 'major' | 'standard' | 'all';
export type PlaceKind = 'city' | 'town' | 'village' | 'peak' | 'landmark';
export type LabelLanguage = 'local' | 'en' | 'zh';
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
  orientedWidthPx: ImagePixels;
  orientedHeightPx: ImagePixels;
  /** Kept in memory for restoring the photo's original position. */
  exifLocation: LonLat | null;
}

export interface LocationChoice {
  coordinate: LonLat;
  source: 'exif' | 'search' | 'coordinate';
  /** Present when the source is search. */
  place?: PlaceResult;
}

export interface MapComposition {
  centerPx: readonly [ImagePixels, ImagePixels];
  widthPx: ImagePixels;
  heightPx: ImagePixels;
  rotationDegrees: number;
  shape: 'circle' | 'square' | 'rectangle';
  /** Independent of layer size: one isotropic geographic scale for both axes. */
  metersPerImagePixel: Meters;
  geographicCenter: LonLat;
  /** Tile zoom derives from source pixels plus this offset, never from the screen. */
  detailOffset: DetailOffset;
  visibleLayers: Record<LayerId, boolean>;
  labels: {
    language: LabelLanguage;
    maxCount: number;
  };
  feather: {
    circlePx: ImagePixels;
    squarePx: readonly [top: ImagePixels, right: ImagePixels, bottom: ImagePixels, left: ImagePixels];
    rectanglePx: readonly [top: ImagePixels, right: ImagePixels, bottom: ImagePixels, left: ImagePixels];
  };
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
