import type { MapComposition } from '../contracts.ts';
import type { ExportLayerRequest, MapFrame, MapProgress, MapWorkerRequest, MapWorkerResponse, RenderRequest } from './mapProtocol.ts';

type RenderOptions = Pick<RenderRequest, 'composition' | 'outputScale' | 'lineColor'>;
type ExportLayer = { bitmap: ImageBitmap; composition: MapComposition };

export function createMapClient(callbacks: {
  progress: (progress: MapProgress) => void;
  frame: (frame: MapFrame, request: RenderRequest) => void;
  failed: () => void;
}) {
  let worker: Worker | null = null;
  let current: RenderRequest | null = null;
  let nextId = 0;
  let pending: { id: number; composition: MapComposition; resolve: (layer: ExportLayer) => void; reject: (reason: Error) => void } | null = null;

  function rejectExport() {
    pending?.reject(new Error('export-layer-unavailable'));
    pending = null;
  }
  function stop() {
    rejectExport();
    worker?.terminate();
    worker = null;
  }
  function failed() {
    stop();
    if (current) callbacks.failed();
  }
  function send(message: MapWorkerRequest) {
    try {
      if (!worker) {
        const instance = new Worker(new URL('./mapWorker.ts', import.meta.url), { type: 'module' });
        worker = instance;
        instance.onmessage = ({ data }: MessageEvent<MapWorkerResponse>) => {
          if (data.type === 'export-layer' || data.type === 'export-layer-failed') {
            if (worker !== instance || !pending || data.id !== pending.id) {
              if (data.type === 'export-layer') data.bitmap.close();
            } else if (data.type === 'export-layer-failed') {
              rejectExport();
            } else {
              pending.resolve({ bitmap: data.bitmap, composition: pending.composition });
              pending = null;
            }
            return;
          }
          if (worker !== instance || !current || data.id !== current.id) {
            if (data.type === 'frame') data.bitmap.close();
            return;
          }
          if (data.type === 'frame') callbacks.frame(data, current);
          else if (data.type === 'progress') callbacks.progress(data);
          else failed();
        };
        instance.onerror = event => {
          event.preventDefault();
          if (worker === instance) failed();
        };
        instance.onmessageerror = () => { if (worker === instance) failed(); };
      }
      worker.postMessage(message);
    } catch {
      failed(); // No exception, file, URL or location goes into the UI or logs.
    }
  }
  function render(options: RenderOptions) {
    rejectExport();
    current = { ...options, type: 'render', id: ++nextId };
    send(current);
  }

  function exportLayer(): Promise<ExportLayer> {
    const instance = worker;
    const view = current;
    if (!instance || !view) return Promise.reject(new Error('export-layer-unavailable'));
    // A cancelled download can still have a raster in flight. Its late reply is closed by ID.
    rejectExport();
    const request: ExportLayerRequest = { type: 'export-layer', id: ++nextId, viewId: view.id };
    return new Promise((resolve, reject) => {
      pending = { id: request.id, composition: view.composition, resolve, reject };
      try {
        instance.postMessage(request);
      } catch {
        rejectExport(); // Export failure must not interrupt the preview.
      }
    });
  }

  return {
    render,
    exportLayer,
    retry() {
      if (!current) return;
      if (worker) send({ type: 'retry' });
      else render(current);
    },
    cancel() {
      rejectExport();
      current = null;
      if (worker) send({ type: 'cancel' });
    },
    dispose() {
      current = null;
      stop();
    },
  };
}
