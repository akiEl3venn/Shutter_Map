import type { ImageFormat } from './sniff.ts';

export type ReadBytes = (offset: number, length: number) => Promise<Uint8Array>;

interface Box { type: string; data: number; end: number }
const text = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

async function readBox(read: ReadBytes, offset: number, end: number): Promise<Box | null> {
  if (offset + 8 > end) return null;
  const header = await read(offset, 8);
  const length = view(header).getUint32(0);
  const headerLength = length === 1 ? 16 : 8;
  if (offset + headerLength > end) return null;
  const size = length === 0 ? end - offset : length === 1
    ? Number(view(await read(offset + 8, 8)).getBigUint64(0)) : length;
  if (!Number.isSafeInteger(size) || size < headerLength || offset + size > end) return null;
  return { type: text(header, 4, 4), data: offset + headerLength, end: offset + size };
}

function tiff(bytes: Uint8Array): Uint8Array | null {
  const signature = text(bytes, 0, 2);
  return bytes.length >= 8 && (signature === 'II' || signature === 'MM') ? bytes : null;
}

function offsetExif(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4) return null;
  return tiff(bytes.subarray(4 + view(bytes).getUint32(0)));
}

async function webpExif(read: ReadBytes, size: number): Promise<Uint8Array | null> {
  const header = await read(0, 12);
  if (text(header, 0, 4) !== 'RIFF' || text(header, 8, 4) !== 'WEBP') return null;
  const end = Math.min(size, 8 + view(header).getUint32(4, true));
  for (let offset = 12; offset + 8 <= end;) {
    const chunk = await read(offset, 8);
    const length = view(chunk).getUint32(4, true);
    const data = offset + 8;
    if (data + length > end) return null;
    if (text(chunk, 0, 4) === 'EXIF') {
      const bytes = await read(data, length);
      return tiff(text(bytes, 0, 6) === 'Exif\0\0' ? bytes.subarray(6) : bytes);
    }
    offset = data + length + (length % 2);
  }
  return null;
}

async function jxlExif(read: ReadBytes, size: number): Promise<Uint8Array | null> {
  const head = await read(0, Math.min(12, size));
  if (head[0] === 0xff && head[1] === 0x0a) return null;
  for (let offset = 0; offset < size;) {
    const box = await readBox(read, offset, size);
    if (!box) return null;
    if (box.type === 'Exif') {
      const bytes = await read(box.data, box.end - box.data);
      // Some encoders write TIFF directly; other containers prefix its four-byte offset.
      return tiff(bytes) ?? offsetExif(bytes);
    }
    // Compressed metadata (brob) is deliberately skipped; we do not load image codestreams.
    offset = box.end;
  }
  return null;
}

async function exifItemId(read: ReadBytes, box: Box): Promise<number | null> {
  const header = await read(box.data, Math.min(8, box.end - box.data));
  const version = header[0];
  const count = version === 0 ? view(header).getUint16(4) : view(header).getUint32(4);
  let offset = box.data + (version === 0 ? 6 : 8);
  for (let entry = 0; entry < count && offset < box.end; entry++) {
    const item = await readBox(read, offset, box.end);
    if (!item) return null;
    if (item.type === 'infe') {
      const bytes = await read(item.data, Math.min(14, item.end - item.data));
      if (bytes[0] === 2 && text(bytes, 8, 4) === 'Exif') return view(bytes).getUint16(4);
      if (bytes[0] === 3 && text(bytes, 10, 4) === 'Exif') return view(bytes).getUint32(4);
    }
    offset = item.end;
  }
  return null;
}

interface Extent { offset: number; length: number }
function itemExtents(bytes: Uint8Array, wantedId: number): { method: number; extents: Extent[] } | null {
  const version = bytes[0];
  if (version > 2) return null;
  const offsetSize = bytes[4] >> 4;
  const lengthSize = bytes[4] & 15;
  const baseOffsetSize = bytes[5] >> 4;
  const indexSize = version > 0 ? bytes[5] & 15 : 0;
  let cursor = 6;
  const integer = (length: number) => {
    if (length > 8 || cursor + length > bytes.length) throw new Error('Invalid item location');
    let value = 0;
    for (let i = 0; i < length; i++) value = value * 256 + bytes[cursor++];
    if (!Number.isSafeInteger(value)) throw new Error('Invalid item location');
    return value;
  };
  const count = integer(version < 2 ? 2 : 4);
  for (let item = 0; item < count; item++) {
    const id = integer(version < 2 ? 2 : 4);
    const method = version > 0 ? integer(2) & 15 : 0;
    const dataReference = integer(2);
    const baseOffset = integer(baseOffsetSize);
    const extentCount = integer(2);
    const extents: Extent[] = [];
    for (let extent = 0; extent < extentCount; extent++) {
      if (version > 0 && indexSize > 0) integer(indexSize);
      const offset = baseOffset + integer(offsetSize);
      const length = integer(lengthSize);
      if (id === wantedId) extents.push({ offset, length });
    }
    if (id === wantedId) return dataReference === 0 ? { method, extents } : null;
  }
  return null;
}

async function bmffExif(sourceRead: ReadBytes, size: number): Promise<Uint8Array | null> {
  // The initial metadata lives near the beginning. Read it once, then jump to item extents.
  const head = await sourceRead(0, Math.min(64 * 1024, size));
  const read: ReadBytes = (offset, length) => offset + length <= head.length
    ? Promise.resolve(head.subarray(offset, offset + length)) : sourceRead(offset, length);
  let meta: Box | null = null;
  for (let offset = 0; offset < size;) {
    const box = await readBox(read, offset, size);
    if (!box) return null;
    if (box.type === 'meta') { meta = box; break; }
    offset = box.end;
  }
  if (!meta) return null;
  let itemId: number | null = null;
  let iloc: Box | null = null;
  let idat: Box | null = null;
  for (let offset = meta.data + 4; offset < meta.end;) {
    const box = await readBox(read, offset, meta.end);
    if (!box) return null;
    if (box.type === 'iinf') itemId = await exifItemId(read, box);
    if (box.type === 'iloc') iloc = box;
    if (box.type === 'idat') idat = box;
    offset = box.end;
  }
  if (itemId === null || !iloc) return null;
  const locations = itemExtents(await read(iloc.data, iloc.end - iloc.data), itemId);
  if (!locations || (locations.method !== 0 && locations.method !== 1)) return null;
  if (locations.method === 1 && !idat) return null;
  const origin = locations.method === 1 ? idat!.data : 0;
  const end = locations.method === 1 ? idat!.end : size;
  const parts: Uint8Array[] = [];
  for (const extent of locations.extents) {
    const offset = origin + extent.offset;
    if (!Number.isSafeInteger(offset) || extent.length === 0 || offset + extent.length > end) return null;
    parts.push(await read(offset, extent.length));
  }
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return offsetExif(bytes);
}

/** Extract just the TIFF payload, using a caller-owned reader and no browser state. */
export async function extractExif(read: ReadBytes, size: number, format: ImageFormat): Promise<Uint8Array | null> {
  try {
    if (format === 'heic' || format === 'avif') return await bmffExif(read, size);
    if (format === 'webp') return await webpExif(read, size);
    if (format === 'jxl') return await jxlExif(read, size);
  } catch {
    // Missing or malformed metadata does not make an otherwise decodable photo unusable.
  }
  return null;
}
