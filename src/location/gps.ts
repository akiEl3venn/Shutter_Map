import type { LonLat } from '../contracts.ts';

export function toLonLat(gps: { latitude: number; longitude: number } | null): LonLat | null {
  if (!gps) return null;
  const { latitude, longitude } = gps;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    || (latitude === 0 && longitude === 0)) return null;
  return [longitude, latitude];
}
