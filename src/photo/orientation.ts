import type { ImageFormat } from './sniff.ts';

export function orientedSize(width: number, height: number, orientation: number) {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

export function orientationMatrix(width: number, height: number, orientation: number): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2: return [-1, 0, 0, 1, width, 0];
    case 3: return [-1, 0, 0, -1, width, height];
    case 4: return [1, 0, 0, -1, 0, height];
    case 5: return [0, 1, 1, 0, 0, 0];
    case 6: return [0, 1, -1, 0, height, 0];
    case 7: return [0, -1, -1, 0, height, width];
    case 8: return [0, -1, 1, 0, 0, width];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

/** Container/codestream orientation belongs to its decoder, never to EXIF. */
export function orientationFor(format: ImageFormat, exifOrientation: number | null, browserHonorsExif: boolean): number {
  if (browserHonorsExif || !['jpeg', 'png', 'webp', 'tiff'].includes(format)) return 1;
  return exifOrientation !== null && Number.isInteger(exifOrientation)
    && exifOrientation >= 1 && exifOrientation <= 8 ? exifOrientation : 1;
}
