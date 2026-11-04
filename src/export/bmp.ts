/** Uncompressed, 24-bit BMP. The composition has already flattened alpha over white. */
export function encodeBmp({ data, width, height }: { data: Uint8ClampedArray; width: number; height: number }) {
  const stride = Math.ceil(width * 3 / 4) * 4;
  const out = new Uint8Array(54 + stride * height);
  const view = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  view.setUint32(2, out.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, stride * height, true);
  for (let y = 0; y < height; y++) {
    let at = 54 + (height - 1 - y) * stride;
    let from = y * width * 4;
    for (let x = 0; x < width; x++, from += 4) {
      out[at++] = data[from + 2]!;
      out[at++] = data[from + 1]!;
      out[at++] = data[from]!;
    }
  }
  return out;
}
