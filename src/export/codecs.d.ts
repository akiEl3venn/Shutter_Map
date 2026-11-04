declare module 'gifenc' {
  type ColorFormat = 'rgb565' | 'rgba4444';
  export function quantize(rgba: Uint8ClampedArray, maxColors: number,
    options: { format: ColorFormat; oneBitAlpha: boolean }): number[][];
  export function applyPalette(rgba: Uint8ClampedArray, palette: number[][], format: ColorFormat): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(indices: Uint8Array, width: number, height: number, options: {
      palette: number[][]; transparent: boolean; transparentIndex: number; repeat: number;
    }): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  };
  const commonJS: { GIFEncoder: typeof GIFEncoder; quantize: typeof quantize; applyPalette: typeof applyPalette };
  export default commonJS;
}

declare module '@cornerstonejs/codec-libjxl/encodewasmjs' {
  export default function create(options: { locateFile: () => string; print: () => void; printErr: () => void }): Promise<{
    JpegXLEncoder: new () => {
      getDecodedBuffer(info: {
        width: number; height: number; bitsPerSample: number; componentCount: number; isSigned: boolean;
      }): Uint8Array;
      setLossless(lossless: boolean): void;
      encode(): void;
      getEncodedBuffer(): Uint8Array;
      delete(): void;
    };
  }>;
}
