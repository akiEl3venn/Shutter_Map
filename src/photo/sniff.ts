export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'bmp' | 'webp' | 'avif' | 'heic' | 'tiff' | 'jxl' | 'unknown';

export function isRawFilename(name: string): boolean {
  return /\.(raw|dng|cr2|cr3|nef|nrw|arw|srf|sr2|orf|raf|rw2|pef|3fr|fff|iiq|kdc|mos|mrw|dcr|rwl|x3f)$/i.test(name);
}

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

export function sniffFormat(head: Uint8Array): ImageFormat {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte);
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (['GIF87a', 'GIF89a'].includes(ascii(head, 0, 6))) return 'gif';
  if (ascii(head, 0, 2) === 'BM') return 'bmp';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'webp';
  if (starts(0x49, 0x49, 0x2a, 0) || starts(0x4d, 0x4d, 0, 0x2a)) return 'tiff';
  if (starts(0xff, 0x0a) || starts(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a)) return 'jxl';
  if (head.length >= 16 && ascii(head, 4, 4) === 'ftyp') {
    const boxSize = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0);
    const end = boxSize === 0 ? head.length : Math.min(boxSize, head.length);
    const brands = [ascii(head, 8, 4)];
    for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(ascii(head, offset, 4));
    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'avif';
    if (brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))) return 'heic';
  }
  return 'unknown';
}
