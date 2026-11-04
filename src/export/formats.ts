import type { ImageFormat } from '../photo/sniff.ts';

export type ExportFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff' | 'jxl' | 'gif' | 'bmp';

export const exportFormats: Record<ExportFormat, { label: string; mime: string; extension: string; alpha: boolean }> = {
  jpeg: { label: 'JPEG', mime: 'image/jpeg', extension: 'jpg', alpha: false },
  png: { label: 'PNG', mime: 'image/png', extension: 'png', alpha: true },
  webp: { label: 'WebP', mime: 'image/webp', extension: 'webp', alpha: true },
  avif: { label: 'AVIF', mime: 'image/avif', extension: 'avif', alpha: true },
  tiff: { label: 'TIFF', mime: 'image/tiff', extension: 'tiff', alpha: true },
  jxl: { label: 'JPEG XL', mime: 'image/jxl', extension: 'jxl', alpha: false }, // RGB-only encoder
  gif: { label: 'GIF', mime: 'image/gif', extension: 'gif', alpha: true },
  bmp: { label: 'BMP', mime: 'image/bmp', extension: 'bmp', alpha: false },
};

export function defaultExportFormat(source: ImageFormat): ExportFormat {
  return source === 'heic' || source === 'unknown' ? 'png' : source;
}

export function exportFileName(sourceName: string, format: ExportFormat): string {
  const stem = sourceName.replace(/\.[^.]*$/, '').trim() || 'photo';
  return `${stem}-map.${exportFormats[format].extension}`;
}
