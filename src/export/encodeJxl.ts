import create from '@cornerstonejs/codec-libjxl/encodewasmjs';
import wasmUrl from '@cornerstonejs/codec-libjxl/encodewasm?url';

export async function encodeJxl({ data, width, height }: ImageData) {
  const codec = await create({ locateFile: () => wasmUrl, print() {}, printErr() {} });
  const encoder = new codec.JpegXLEncoder();
  try {
    const rgb = encoder.getDecodedBuffer({ width, height, bitsPerSample: 8, componentCount: 3, isSigned: false });
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i]!;
      rgb[j + 1] = data[i + 1]!;
      rgb[j + 2] = data[i + 2]!;
    }
    encoder.setLossless(true);
    encoder.encode();
    return encoder.getEncodedBuffer().slice();
  } finally {
    encoder.delete();
  }
}
