import type { MapComposition } from '../contracts.ts';

export interface RenderRequest {
  type: 'render';
  id: number;
  composition: MapComposition;
  outputScale: number;
  lineColor: string;
}

export interface MapProgress {
  type: 'progress';
  id: number;
  zoom: number;
  total: number;
  /** Includes empty tiles. A request is still loading while loaded + failed < total. */
  loaded: number;
  empty: number;
  failed: number;
  bytes: number;
  detailReduced: boolean;
}

export interface MapFrame {
  type: 'frame';
  id: number;
  bitmap: ImageBitmap;
  complete: boolean;
}

export interface ExportLayerRequest {
  type: 'export-layer';
  id: number;
  /** Only this already-loaded view can supply the layer; no new tiles are fetched. */
  viewId: number;
}

export type MapWorkerRequest = RenderRequest | ExportLayerRequest | { type: 'retry' } | { type: 'cancel' };
export type MapWorkerResponse = MapProgress | MapFrame | { type: 'error'; id: number }
  | { type: 'export-layer'; id: number; bitmap: ImageBitmap }
  | { type: 'export-layer-failed'; id: number };
