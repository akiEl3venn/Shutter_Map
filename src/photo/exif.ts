import { gps, orientation } from 'exifr';

export interface PhotoExif {
  orientation: number | null;
  gps: { latitude: number; longitude: number } | null;
}

export async function readExif(file: File): Promise<PhotoExif> {
  const [direction, coordinates] = await Promise.all([
    orientation(file).catch(() => undefined),
    gps(file).catch(() => undefined),
  ]);

  return {
    orientation: typeof direction === 'number' && Number.isInteger(direction)
      && direction >= 1 && direction <= 8 ? direction : null,
    gps: typeof coordinates?.latitude === 'number' && typeof coordinates.longitude === 'number'
      ? { latitude: coordinates.latitude, longitude: coordinates.longitude }
      : null,
  };
}
