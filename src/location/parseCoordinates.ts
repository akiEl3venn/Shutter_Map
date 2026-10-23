import type { LonLat } from '../contracts.ts';

export type ParseResult = { ok: true; value: LonLat } | { ok: false; error: 'empty' | 'format' | 'range' };

const component = String.raw`([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*°\s*(\d+(?:\.\d*)?)\s*['′]\s*(\d+(?:\.\d*)?)\s*["″])?\s*([NSEW])?`;
const pairPattern = new RegExp(`^${component}(?:\\s*[,，]\\s*|\\s+)${component}$`, 'iu');

export function parseCoordinates(input: string): ParseResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'empty' };
  const match = pairPattern.exec(text);
  if (!match) return { ok: false, error: 'format' };
  const values: number[] = [];
  const axes: Array<'lat' | 'lon' | undefined> = [];
  for (const offset of [1, 5]) {
    const degrees = Number(match[offset]);
    const minutes = Number(match[offset + 1] ?? 0);
    const seconds = Number(match[offset + 2] ?? 0);
    const direction = match[offset + 3]?.toUpperCase();
    if (minutes >= 60 || seconds >= 60) return { ok: false, error: 'range' };
    const sign = direction ? (direction === 'S' || direction === 'W' ? -1 : 1) : degrees < 0 ? -1 : 1;
    values.push(sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600));
    axes.push(direction ? (direction === 'N' || direction === 'S' ? 'lat' : 'lon') : undefined);
  }
  if (axes[0] && axes[0] === axes[1]) return { ok: false, error: 'format' };
  const longitudeFirst = axes[0] === 'lon' || axes[1] === 'lat';
  const latitude = values[longitudeFirst ? 1 : 0]!;
  const longitude = values[longitudeFirst ? 0 : 1]!;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { ok: false, error: 'range' };
  }
  return { ok: true, value: [longitude, latitude] };
}
