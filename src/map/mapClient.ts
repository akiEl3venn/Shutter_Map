import type { MapFrame, MapProgress, MapWorkerRequest, MapWorkerResponse, RenderRequest } from './mapProtocol.ts';

type RenderOptions = Pick<RenderRequest, 'composition' | 'outputScale' | 'lineColor'>;

export function createMapClient(callbacks: {
  progress: (progress: MapProgress) => void;
  frame: (frame: MapFrame, request: RenderRequest) => void;
  failed: () => void;
}) {
  let worker: Worker | null = null;
  let current: RenderRequest | null = null;
  let nextId = 0;

  function stop() {
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
    current = { ...options, type: 'render', id: ++nextId };
    send(current);
  }

  return {
    render,
    retry() {
      if (!current) return;
      if (worker) send({ type: 'retry' });
      else render(current);
    },
    cancel() {
      current = null;
      if (worker) send({ type: 'cancel' });
    },
    dispose() {
      current = null;
      stop();
    },
  };
}
