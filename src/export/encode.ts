import { exportFormats, type ExportFormat } from './formats.ts';
import { encodeBmp } from './bmp.ts';

const quiet = () => {};

async function nativeBlob(canvas: OffscreenCanvas, type: string, quality?: number) {
  const blob = await canvas.convertToBlob({ type, quality });
  // Browsers may silently return a PNG for a requested encoder they do not have.
  return blob.type === type && blob.size > 0 ? blob : null;
}

async function encodeTiff({ data, width, height }: ImageData) {
  const { default: utif } = await import('utif2');
  const offset = 1000;
  // A fresh IFD with straight alpha (ExtraSamples=2), no software or source metadata.
  const ifd = { t256: [width], t257: [height], t258: [8, 8, 8, 8], t259: [1], t262: [2],
    t273: [offset], t277: [4], t278: [height], t279: [data.length], t282: [[72, 1]], t283: [[72, 1]],
    t284: [1], t296: [1], t338: [2] };
  // utif2 declares the decoded IFD shape, including pixel buffers; encode only needs tags.
  const writeIfd = utif.encode as unknown as (pages: (typeof ifd)[]) => ArrayBuffer;
  const out = new Uint8Array(offset + data.length);
  out.set(new Uint8Array(writeIfd([ifd])));
  out.set(data, offset);
  return out;
}

async function encodeGif({ data, width, height }: ImageData) {
  const mod = await import('gifenc');
  // Its ESM build has named exports; the CJS entry exposes them on the default object.
  const gifenc = typeof mod.GIFEncoder === 'function' ? mod : mod.default;
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) { transparent = true; break; }
  }
  const format = transparent ? 'rgba4444' : 'rgb565';
  const palette = gifenc.quantize(data, 256, { format, oneBitAlpha: transparent });
  const index = gifenc.applyPalette(data, palette, format);
  const transparentIndex = palette.findIndex(color => color[3] === 0);
  const gif = gifenc.GIFEncoder();
  gif.writeFrame(index, width, height, { palette, transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex), repeat: -1 });
  gif.finish();
  return gif.bytes();
}

async function encodeAvif(image: ImageData) {
  const { default: encode, init } = await import('@jsquash/avif/encode.js');
  await init({ print: quiet, printErr: quiet });
  return new Uint8Array(await encode(image, { lossless: true, speed: 6 }));
}

async function encodeWebp(image: ImageData) {
  const { default: encode, init } = await import('@jsquash/webp/encode.js');
  await init({ print: quiet, printErr: quiet });
  return new Uint8Array(await encode(image, { lossless: 1 }));
}

export async function encodeImage(format: ExportFormat, canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D): Promise<Blob> {
  const { mime } = exportFormats[format];
  if (format === 'jpeg' || format === 'png') {
    const blob = await nativeBlob(canvas, mime, format === 'jpeg' ? 1 : undefined);
    if (!blob) throw new Error('encode-failed');
    return blob;
  }
  if (format === 'webp') {
    const blob = await nativeBlob(canvas, mime, 1).catch(() => null);
    if (blob) return blob;
  }
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0; // Release the backing canvas before allocating encoder memory.
  const bytes = format === 'webp' ? await encodeWebp(image)
    : format === 'avif' ? await encodeAvif(image)
    : format === 'tiff' ? await encodeTiff(image)
    : format === 'jxl' ? await (await import('./encodeJxl.ts')).encodeJxl(image)
    : format === 'gif' ? await encodeGif(image)
    : encodeBmp(image);
  if (!bytes.length) throw new Error('encode-failed');
  return new Blob([bytes], { type: mime });
}
