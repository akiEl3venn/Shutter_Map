import type { TileKey } from '../contracts.ts';

export type TileResult =
  | { key: TileKey; status: 'ready'; bytes: ArrayBuffer }
  | { key: TileKey; status: 'empty' }
  | { key: TileKey; status: 'failed' };

export interface TileLoader {
  /** Cancellation resolves with completed results only, in input order, with no further callbacks. */
  load(keys: TileKey[], onTile: (result: TileResult) => void, signal?: AbortSignal): Promise<TileResult[]>;
  /** A malformed successful response must be fetched again after a decode failure. */
  invalidate(key: TileKey): void;
}

interface Batch {
  cancelled: boolean;
  remaining: number;
  results: (TileResult | undefined)[];
  controllers: Set<AbortController>;
  onTile: (result: TileResult) => void;
  finish: () => void;
}

interface Job {
  key: TileKey;
  index: number;
  batch: Batch;
}

export function createTileLoader(options: {
  url: (key: TileKey) => string;
  fetch?: typeof fetch;
  concurrency?: number;
  cacheSize?: number;
  retries?: number;
  timeoutMs?: number;
}): TileLoader {
  const fetchTile = options.fetch ?? globalThis.fetch;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 8));
  const cacheSize = Math.max(0, Math.floor(options.cacheSize ?? 200));
  const retries = Math.max(0, Math.floor(options.retries ?? 1));
  const timeoutMs = options.timeoutMs ?? 15000;
  const cache = new Map<string, TileResult>();
  let queue: Job[] = [];
  let active = 0;
  const tileId = (key: TileKey) => `${key.z}/${key.x}/${key.y}`;

  async function request({ key, batch }: Job): Promise<TileResult | undefined> {
    for (let attempt = 0; attempt <= retries && !batch.cancelled; attempt++) {
      const controller = new AbortController();
      batch.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Leave cache mode unspecified so the browser can use immutable HTTP responses.
        const response = await fetchTile(options.url(key), { signal: controller.signal });
        if (response.status === 204 || response.status === 404) return { key, status: 'empty' };
        if (response.status === 200) return { key, status: 'ready', bytes: await response.arrayBuffer() };
      } catch {
        // Network failures and timeouts share the same bounded retry budget.
      } finally {
        clearTimeout(timer);
        batch.controllers.delete(controller);
      }
    }
    return batch.cancelled ? undefined : { key, status: 'failed' };
  }

  function report(job: Job, result: TileResult) {
    const { batch, index } = job;
    batch.results[index] = result;
    batch.remaining--;
    batch.onTile(result);
    if (batch.remaining === 0) batch.finish();
  }

  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift()!;
      active++;
      void request(job).then((result) => {
        if (!result || job.batch.cancelled) return;
        if (result.status !== 'failed' && cacheSize > 0) {
          const id = tileId(job.key);
          cache.delete(id);
          cache.set(id, result);
          if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
        }
        report(job, result);
      }).finally(() => {
        active--;
        pump();
      });
    }
  }

  return {
    invalidate(key) {
      cache.delete(tileId(key));
    },
    load(keys, onTile, signal) {
      if (signal?.aborted) return Promise.resolve([]);
      return new Promise((resolve) => {
        const batch: Batch = {
          cancelled: false,
          remaining: keys.length,
          results: [],
          controllers: new Set(),
          onTile,
          finish() {
            signal?.removeEventListener('abort', cancel);
            resolve(batch.results.filter((result): result is TileResult => result !== undefined));
          },
        };
        const cancel = () => {
          batch.cancelled = true;
          queue = queue.filter((job) => job.batch !== batch);
          for (const controller of batch.controllers) controller.abort();
          batch.finish();
        };
        signal?.addEventListener('abort', cancel, { once: true });
        for (const [index, key] of keys.entries()) {
          if (batch.cancelled) break;
          const id = tileId(key);
          const cached = cache.get(id);
          if (cached) {
            cache.delete(id);
            cache.set(id, cached);
            report({ key, index, batch }, cached);
          } else {
            queue.push({ key, index, batch });
          }
        }
        if (keys.length === 0) batch.finish();
        pump();
      });
    },
  };
}
