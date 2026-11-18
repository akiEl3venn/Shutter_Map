import type { Mask, MaskOp } from '../contracts.ts';
import { drawMask, drawOp } from '../map/mask.ts';

type Brush = Extract<MaskOp, { tool: 'brush' }>;

function surface(width: number, height: number) {
  const ctx = new OffscreenCanvas(width, height).getContext('2d');
  if (!ctx) throw new Error('canvas-unavailable');
  return ctx;
}

/** All surfaces use preview pixels. An incoming map frame can reuse the completed foreground. */
export class MaskPreview {
  readonly committed: OffscreenCanvasRenderingContext2D;
  readonly shown: OffscreenCanvasRenderingContext2D;
  readonly tint: OffscreenCanvasRenderingContext2D;
  readonly preview: ImageBitmap;
  private mask: Mask | null = null;
  private brush: Brush | null = null;
  private pointCount = 0;
  private tinted = false;

  constructor(preview: ImageBitmap) {
    this.preview = preview;
    this.committed = surface(preview.width, preview.height);
    this.shown = surface(preview.width, preview.height);
    this.tint = surface(preview.width, preview.height);
  }

  update(mask: Mask, brush: Brush | null, scale: number, tinted: boolean) {
    const changed = this.mask !== mask;
    const {width, height} = this.preview;
    if (changed) {
      this.committed.clearRect(0, 0, width, height);
      drawMask(this.committed, mask, scale, [0, 0]);
      this.mask = mask;
    }
    const count = brush?.points.length ?? 0;
    if (!changed && brush === this.brush && count === this.pointCount && tinted === this.tinted) return;
    this.brush = brush;
    this.pointCount = count;
    this.tinted = tinted;

    const {shown, tint} = this;
    shown.globalCompositeOperation = 'copy';
    shown.drawImage(this.committed.canvas, 0, 0);
    if (brush) drawOp(shown, brush, scale, [0, 0]);
    if (tinted) {
      tint.globalCompositeOperation = 'copy';
      tint.drawImage(shown.canvas, 0, 0);
      tint.globalCompositeOperation = 'source-in';
      tint.fillStyle = 'rgba(255, 0, 0, 0.35)';
      tint.fillRect(0, 0, width, height);
    }
    shown.globalCompositeOperation = 'source-in';
    shown.drawImage(this.preview, 0, 0);
  }
}
