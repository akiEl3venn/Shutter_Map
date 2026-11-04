import { open, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Compression, PMTiles, SharedPromiseCache } from 'pmtiles';

class FsSource {
  constructor(path, handle, size) {
    this.path = path;
    this.handle = handle;
    this.size = size;
  }

  getKey() {
    return this.path;
  }

  async getBytes(offset, length, signal) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(Math.max(0, Math.min(length, this.size - offset)));
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await this.handle.read(bytes, total, bytes.length - total, offset + total);
      signal?.throwIfAborted();
      if (!bytesRead) throw new Error('Local map archive ended unexpectedly.');
      total += bytesRead;
    }
    return { data: bytes.buffer };
  }
}

function intersects(header, z, x, y) {
  if (z < header.minZoom || z > header.maxZoom) return false;
  const scale = 2 ** z;
  const west = x / scale * 360 - 180;
  const east = (x + 1) / scale * 360 - 180;
  const latitude = (row) => Math.atan(Math.sinh(Math.PI * (1 - 2 * row / scale))) * 180 / Math.PI;
  const north = latitude(y);
  const south = latitude(y + 1);
  const longitudeOverlap = header.minLon <= header.maxLon
    ? east >= header.minLon && west <= header.maxLon
    : east >= header.minLon || west <= header.maxLon;
  return longitudeOverlap && north >= header.minLat && south <= header.maxLat;
}

/** Local PMTiles access only; this plugin is absent from production builds. */
export default function devTiles() {
  const handles = [];
  const archives = [];

  return {
    name: 'local-pmtiles',
    apply: 'serve',
    async configureServer(server) {
      const directory = resolve(server.config.root, 'data-downloads/tiles');
      let files;
      try {
        files = (await readdir(directory, { withFileTypes: true }))
          .filter((file) => file.isFile() && file.name.endsWith('.pmtiles'))
          .map((file) => file.name)
          .sort();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        files = [];
      }
      if (!files.length) {
        server.config.logger.info('[tiles] 未找到本地 PMTiles 数据，开发瓦片请求将返回 204。');
      }

      // Directory entries must still be decompressed by the cache. Only tile
      // payloads bypass decompression, so HTTP sends the archive's original bytes.
      const cache = new SharedPromiseCache();
      for (const file of files) {
        const path = resolve(directory, file);
        const handle = await open(path, 'r');
        handles.push(handle);
        const { size } = await handle.stat();
        const archive = new PMTiles(new FsSource(path, handle, size), cache, async (bytes) => bytes);
        archives.push({ archive, header: await archive.getHeader() });
      }

      server.middlewares.use(async (request, response, next) => {
        const match = /^\/tiles\/dev\/(\d+)\/(\d+)\/(\d+)\.mvt(?:\?.*)?$/.exec(request.url ?? '');
        if (request.method !== 'GET' || !match) return next();
        const [z, x, y] = match.slice(1).map(Number);
        if (z > 26 || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x >= 2 ** z || y >= 2 ** z) {
          response.writeHead(204).end();
          return;
        }
        try {
          for (const { archive, header } of archives) {
            if (!intersects(header, z, x, y)) continue;
            const tile = await archive.getZxy(z, x, y);
            if (!tile) continue;
            response.setHeader('Content-Type', 'application/x-protobuf');
            const encoding = {
              [Compression.Gzip]: 'gzip',
              [Compression.Brotli]: 'br',
              [Compression.Zstd]: 'zstd',
            }[header.tileCompression];
            if (encoding) response.setHeader('Content-Encoding', encoding);
            response.writeHead(200).end(Buffer.from(tile.data));
            return;
          }
          response.writeHead(204).end();
        } catch {
          // Do not log a request URL or pass request details to Vite's reporter.
          response.writeHead(500).end('Local map data could not be read.');
        }
      });
    },
    async closeBundle() {
      await Promise.all(handles.splice(0).map((handle) => handle.close()));
    },
  };
}
