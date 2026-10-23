import { gps, orientation } from 'exifr';
import { extractExif, type ReadBytes } from './exifContainers.ts';
import { isRawFilename, sniffFormat } from './sniff.ts';

export interface PhotoExif {
  orientation: number | null;
  gps: { latitude: number; longitude: number } | null;
}

export async function readExif(file: File): Promise<PhotoExif> {
  try {
    if (isRawFilename(file.name)) return { orientation: null, gps: null };
    const read: ReadBytes = async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    const format = sniffFormat(await read(0, 64));
    const input = format === 'jpeg' || format === 'png' || format === 'tiff'
      ? file : await extractExif(read, file.size, format);
    if (!input) return { orientation: null, gps: null };
    const [direction, coordinates] = await Promise.all([
      orientation(input).catch(() => undefined),
      gps(input).catch(() => undefined),
    ]);

    return {
      orientation: typeof direction === 'number' && Number.isInteger(direction)
        && direction >= 1 && direction <= 8 ? direction : null,
      gps: Number.isFinite(coordinates?.latitude) && Number.isFinite(coordinates?.longitude)
        && Math.abs(coordinates!.latitude) <= 90 && Math.abs(coordinates!.longitude) <= 180
        ? { latitude: coordinates!.latitude, longitude: coordinates!.longitude }
        : null,
    };
  } catch {
    return { orientation: null, gps: null };
  }
}
