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

export type MapWorkerRequest = RenderRequest | { type: 'retry' } | { type: 'cancel' };
export type MapWorkerResponse = MapProgress | MapFrame | { type: 'error'; id: number };
