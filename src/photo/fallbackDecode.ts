export type FallbackFormat = 'heic' | 'tiff' | 'jxl';

export interface DecodedRgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type HeifModule = import('libheif-js/libheif-wasm/libheif.js').MainModule;
let heifModule: Promise<HeifModule> | undefined;
let jxlModule: Promise<typeof import('@jsquash/jxl/decode.js')> | undefined;
const quiet = () => {};

function tiffRgba(page: import('utif2').IFD, tiff: typeof import('utif2')): Uint8ClampedArray {
  const photometric = (page.t262 as number[] | undefined)?.[0];
  const bits = (page.t258 as number[] | undefined)?.[0];
  const samples = (page.t277 as number[] | undefined)?.[0] ?? 1;
  const extras = page.t338 as number[] | undefined;
  const alphaExtra = extras?.findIndex((value) => value === 1 || value === 2) ?? -1;
  const associated = alphaExtra >= 0 && extras![alphaExtra] === 1;
  let rgba: Uint8ClampedArray;

  if ((photometric === 0 || photometric === 1) && (bits === 8 || bits === 16) && samples > 1) {
    // utif2 ignores grayscale alpha and uses the wrong 16-bit sample stride.
    // decodeImage already converts 16-bit TIFF samples to little endian.
    const view = new DataView(page.data.buffer, page.data.byteOffset, page.data.byteLength);
    const bytesPerSample = bits / 8;
    const maximum = bits === 16 ? 65535 : 255;
    const readSample = (offset: number) => bits === 16 ? view.getUint16(offset, true) : view.getUint8(offset);
    rgba = new Uint8ClampedArray(page.width * page.height * 4);
    for (let pixel = 0; pixel < page.width * page.height; pixel++) {
      const offset = pixel * samples * bytesPerSample;
      const value = readSample(offset);
      const gray = (photometric === 0 ? maximum - value : value) * 255 / maximum;
      rgba[pixel * 4] = rgba[pixel * 4 + 1] = rgba[pixel * 4 + 2] = Math.round(gray);
      rgba[pixel * 4 + 3] = alphaExtra >= 0 && alphaExtra + 1 < samples
        ? Math.round(readSample(offset + (alphaExtra + 1) * bytesPerSample) * 255 / maximum)
        : 255;
    }
  } else {
    const bytes = tiff.toRGBA8(page);
    rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  // ImageData takes straight RGBA; TIFF ExtraSamples=1 stores premultiplied color.
  if (associated) {
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const alpha = rgba[offset + 3];
      for (let channel = 0; channel < 3; channel++) {
        rgba[offset + channel] = alpha === 0 ? 0 : Math.round(rgba[offset + channel] * 255 / alpha);
      }
    }
  }
  return rgba;
}

function loadHeif(): Promise<HeifModule> {
  heifModule ??= (async () => {
    const [{ default: createHeif }, response] = await Promise.all([
      import('libheif-js/libheif-wasm/libheif.js'),
      fetch(new URL('../../node_modules/libheif-js/libheif-wasm/libheif.wasm', import.meta.url)),
    ]);
    if (!response.ok) throw new Error('decoder-unavailable');
    return createHeif({ wasmBinary: await response.arrayBuffer(), print: quiet, printErr: quiet });
  })().catch(() => {
    heifModule = undefined;
    throw new Error('decoder-unavailable');
  });
  return heifModule;
}

async function decodeHeif(bytes: ArrayBuffer): Promise<DecodedRgba> {
  const heif = await loadHeif();
  const context = heif.heif_context_alloc();
  let handle: ReturnType<HeifModule['heif_js_context_get_primary_image_handle']>;
  let decoded: ReturnType<HeifModule['heif_js_decode_image2']>;
  try {
    const result = heif.heif_context_read_from_memory(context, new Uint8Array(bytes));
    if (result.code !== heif.heif_error_code.heif_error_Ok) throw new Error('decode-failed');
    handle = heif.heif_js_context_get_primary_image_handle(context);
    if (!handle || handle.code) throw new Error('decode-failed');
    // libheif applies the container's irot/imir here. EXIF must not be applied again.
    decoded = await heif.heif_js_decode_image2(handle,
      heif.heif_colorspace.heif_colorspace_RGB,
      heif.heif_chroma.heif_chroma_interleaved_RGBA);
    if (!decoded || decoded.code) throw new Error('decode-failed');
    const channel = decoded.channels.find((item: { id: unknown }) =>
      item.id === heif.heif_channel.heif_channel_interleaved);
    if (!channel) throw new Error('decode-failed');
    const { width, height, stride } = channel;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      data.set(channel.data.subarray(y * stride, y * stride + width * 4), y * width * 4);
    }
    return { data, width, height };
  } finally {
    if (decoded?.image) heif.heif_image_release(decoded.image);
    if (handle && !handle.code) heif.heif_image_handle_release(handle);
    heif.heif_context_free(context);
  }
}

/** Decode only; TIFF's EXIF transform is applied by the worker after this step. */
export async function decodeRgba(bytes: ArrayBuffer, format: FallbackFormat): Promise<DecodedRgba> {
  if (format === 'heic') return decodeHeif(bytes);
  if (format === 'tiff') {
    const { default: tiff } = await import('utif2');
    const [page] = tiff.decode(bytes);
    if (!page) throw new Error('decode-failed');
    tiff.decodeImage(bytes, page);
    return {
      data: tiffRgba(page, tiff),
      width: page.width,
      height: page.height,
    };
  }
  jxlModule ??= import('@jsquash/jxl/decode.js').then(async (module) => {
    await module.init({ print: quiet, printErr: quiet });
    return module;
  }).catch(() => {
    jxlModule = undefined;
    throw new Error('decoder-unavailable');
  });
  const { default: decode } = await jxlModule;
  // The JPEG XL decoder applies the codestream orientation, not EXIF orientation.
  return decode(bytes);
}
