/// <reference lib="webworker" />
import type { TileKey } from '../contracts.ts';
import { decodeTile } from './decodeTile.ts';
import type { TileFeatures } from './decodeTile.ts';
import { rasterCenter, rasterOf } from './layerGeometry.ts';
import { limitedTileCover, zoomFor } from './mercator.ts';
import type { TileCoverage } from './mercator.ts';
import type { ExportLayerRequest, MapWorkerRequest, MapWorkerResponse, RenderRequest } from './mapProtocol.ts';
import { prepareTile, renderLayer } from './renderLayer.ts';
import type { PreparedTile } from './renderLayer.ts';
import { createTileLoader } from './tileLoader.ts';
import type { TileResult } from './tileLoader.ts';
import { tileset, tileUrl } from './tileset.ts';

interface CachedTile {
  tile: PreparedTile | null; // null is a known empty tile, including on cache hits
  bytes: number;
}

interface View {
  request: RenderRequest;
  coverage: TileCoverage;
  controller: AbortController;
  loaded: Map<string, CachedTile>;
  failed: Set<string>;
  lastFrame: number;
  holdUntil: number;
  timer?: number;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
const loader = createTileLoader({ url: key => tileUrl(key.z, key.x, key.y), cacheSize: 0 });
const cache = new Map<string, CachedTile>();
const cacheLimit = 300;
const frameIntervalMs = 150;
const partialFrameHoldMs = 200; // config/editor-policy.json
const tileId = ({ z, x, y }: TileKey) => `${z}/${x}/${y}`;
let active: View | null = null;

function send(message: MapWorkerResponse, transfer: Transferable[] = []) {
  worker.postMessage(message, transfer);
}

function cancel() {
  if (!active) return;
  active.controller.abort();
  worker.clearTimeout(active.timer);
  active = null;
}

function fail(id: number) {
  cancel();
  send({ type: 'error', id });
}

function publish(view: View) {
  let bytes = 0;
  let empty = 0;
  for (const entry of view.loaded.values()) {
    bytes += entry.bytes;
    if (!entry.tile) empty++;
  }
  const { zoom, keys, detailReduced } = view.coverage;
  send({ type: 'progress', id: view.request.id, zoom, total: keys.length,
    loaded: view.loaded.size, failed: view.failed.size, empty, bytes, detailReduced });
}

/** Coverage order keeps labels deterministic across preview frames and export. */
function tilesOf(view: View): PreparedTile[] {
  const tiles: PreparedTile[] = [];
  for (const key of view.coverage.keys) {
    const tile = view.loaded.get(tileId(key))?.tile;
    if (tile) tiles.push(tile);
  }
  return tiles;
}

function exportLayer({ id, viewId }: ExportLayerRequest) {
  let bitmap: ImageBitmap | undefined;
  try {
    const view = active;
    if (view?.request.id !== viewId || view.failed.size || view.loaded.size !== view.coverage.keys.length) {
      throw new Error('view-not-ready');
    }
    const { composition, lineColor } = view.request;
    bitmap = renderLayer(tilesOf(view), composition, 1, lineColor, true);
    send({ type: 'export-layer', id, bitmap }, [bitmap]);
  } catch {
    bitmap?.close();
    send({ type: 'export-layer-failed', id });
  }
}

function scheduleFrame(view: View) {
  const settled = view.failed.size + view.loaded.size === view.coverage.keys.length;
  if (view.timer !== undefined) {
    if (!settled) return;
    worker.clearTimeout(view.timer); // Complete tiles take precedence over a pending partial frame.
  }
  const delay = settled ? 0 : Math.max(0, Math.ceil(Math.max(view.holdUntil, view.lastFrame + frameIntervalMs) - performance.now()));
  view.timer = worker.setTimeout(() => {
    view.timer = undefined;
    if (active !== view) return;
    const { id, composition, outputScale, lineColor } = view.request;
    const complete = view.loaded.size === view.coverage.keys.length;
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = renderLayer(tilesOf(view), composition, outputScale, lineColor, complete);
      send({ type: 'frame', id, bitmap, complete }, [bitmap]);
      view.lastFrame = performance.now();
    } catch {
      bitmap?.close();
      fail(id);
    }
  }, delay);
}

function decode(result: TileResult): CachedTile | undefined {
  if (result.status === 'empty') return { tile: null, bytes: 0 };
  if (result.status === 'failed') return undefined;
  let features: TileFeatures;
  try {
    features = decodeTile(result.bytes, result.key);
  } catch {
    return undefined; // A corrupt response can be retried. Do not cache it.
  }
  return { tile: prepareTile(features), bytes: result.bytes.byteLength };
}

function receive(view: View, result: TileResult) {
  if (active !== view) return;
  try {
    const id = tileId(result.key);
    const entry = decode(result);
    if (entry) {
      cache.set(id, entry);
      if (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
      view.loaded.set(id, entry);
    } else {
      view.failed.add(id);
    }
    publish(view);
    if (entry?.tile || view.loaded.size + view.failed.size === view.coverage.keys.length) scheduleFrame(view);
  } catch {
    fail(view.request.id);
  }
}

function load(view: View, keys: TileKey[]) {
  publish(view);
  // One result per load lets the loader release each ArrayBuffer immediately after
  // decoding. The shared queue still enforces the same concurrency and request order.
  for (const key of keys) void loader.load([key], result => receive(view, result), view.controller.signal);
}

function start(request: RenderRequest) {
  const { composition } = request;
  const raster = rasterOf(composition);
  const coverage = limitedTileCover({ center: rasterCenter(composition),
    // The upright drawn area lies at an angle across a turned map, so it needs tiles for that whole outline.
    widthPx: raster.width, heightPx: raster.height, rotationDegrees: composition.rotationDegrees,
    metersPerImagePixel: composition.metersPerImagePixel,
    zoom: zoomFor(composition.metersPerImagePixel, composition.geographicCenter[1], composition.detailOffset, tileset.maxZoom),
  });
  if (active && active.coverage.keys.length === coverage.keys.length) {
    const previous = new Set(active.coverage.keys.map(tileId));
    if (coverage.keys.every(key => previous.has(tileId(key)))) {
      active.request = request;
      active.coverage = coverage; // same set; priority order or the reduced-detail indicator may have changed
      publish(active);
      scheduleFrame(active);
      return;
    }
  }
  cancel();
  const view: View = { request, coverage, controller: new AbortController(),
    loaded: new Map(), failed: new Set(), lastFrame: -Infinity, holdUntil: performance.now() + partialFrameHoldMs };
  active = view;
  const missing: TileKey[] = [];
  for (const key of coverage.keys) {
    const id = tileId(key);
    const hit = cache.get(id);
    if (!hit) {
      missing.push(key);
      continue;
    }
    cache.delete(id);
    cache.set(id, hit); // most recently used
    view.loaded.set(id, hit);
  }
  load(view, missing);
  if (!missing.length || [...view.loaded.values()].some(entry => entry.tile)) scheduleFrame(view);
}

worker.onmessage = ({ data }: MessageEvent<MapWorkerRequest>) => {
  if (data.type === 'export-layer') return exportLayer(data);
  const id = data.type === 'render' ? data.id : active?.request.id;
  try {
    if (data.type === 'cancel') cancel();
    else if (data.type === 'render') start(data);
    else {
      const view = active;
      if (!view || !view.failed.size || view.loaded.size + view.failed.size !== view.coverage.keys.length) return;
      const keys = view.coverage.keys.filter(key => view.failed.has(tileId(key)));
      view.failed.clear();
      load(view, keys);
    }
  } catch {
    if (id !== undefined) fail(id);
  }
};
