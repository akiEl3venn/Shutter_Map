import type { Mask, PhotoSession, Point } from '../contracts.ts';
import { decodeImage } from '../photo/decode.ts';
import { MaskPreview } from './maskPreview.ts';

interface Region { x: number; y: number; width: number; height: number; scale: number }
export interface DetailCrop extends Region { image: ImageBitmap }

/** The original stays off the screen canvas. Only an asynchronously resized visible crop is uploaded. */
export class MaskDetail {
  private original?: ImageBitmap;
  private loading = false;
  private disposed = false;
  failed = false;
  private region: Region | null = null;
  private due = 0;
  private timer = 0;
  crop?: DetailCrop;
  private foreground?: MaskPreview;
  private mask?: Mask;
  private tinted = false;
  private maskTimer = 0;
  private maskReady = false;

  private photo: PhotoSession;
  private redraw: () => void;
  constructor(photo: PhotoSession, redraw: () => void) {
    this.photo = photo;
    this.redraw = redraw;
  }

  view(left: number, top: number, right: number, bottom: number, scale: number) {
    const x = Math.max(0, Math.floor(left)), y = Math.max(0, Math.floor(top));
    const width = Math.min(this.photo.orientedWidthPx, Math.ceil(right)) - x;
    const height = Math.min(this.photo.orientedHeightPx, Math.ceil(bottom)) - y;
    const old = this.region;
    if (old && old.x === x && old.y === y && old.width === width && old.height === height && old.scale === scale) return;
    this.invalidate();
    if (width <= 0 || height <= 0 || this.failed) return;
    this.region = { x, y, width, height, scale };
    this.due = performance.now() + 150;
    if (this.original) this.schedule();
    else if (!this.loading) {
      this.loading = true;
      void decodeImage(this.photo.file, this.photo.exifOrientation).then(({ bitmap }) => {
        if (this.disposed) { bitmap.close(); return; }
        this.original = bitmap;
        this.schedule();
      }, () => this.failure());
    }
  }
  private failure() {
    if (this.disposed) return;
    this.failed = true;
    this.redraw();
  }
  private schedule() {
    const region = this.region, original = this.original;
    if (!region || !original) return;
    this.timer = window.setTimeout(async () => {
      const { x, y, width, height, scale } = region;
      try {
        const image = await createImageBitmap(original, x, y, width, height, {
          resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)),
          resizeQuality: 'high',
        });
        if (region !== this.region) { image.close(); return; }
        this.crop = { ...region, image };
        this.redraw();
      } catch { if (region === this.region) this.failure(); }
    }, Math.max(0, this.due - performance.now()));
  }

  /** Reuse the crop's native pixel grid for the foreground; freehand strokes use the instant preview instead. */
  drawMask(ctx: CanvasRenderingContext2D, mask: Mask, tinted: boolean) {
    const crop = this.crop;
    if (!crop || !mask.length) return false;
    if (!this.foreground) {
      this.foreground = new MaskPreview(crop.image);
      this.mask = mask;
      this.tinted = tinted;
      this.maskReady = true; // The view has already been still for 150 ms.
    } else if (this.mask !== mask || this.tinted !== tinted) {
      this.mask = mask;
      this.tinted = tinted;
      this.maskReady = false;
      clearTimeout(this.maskTimer);
      this.maskTimer = window.setTimeout(() => { this.maskReady = true; this.redraw(); }, 150);
    }
    if (!this.maskReady) return false;
    const origin: Point = [crop.x, crop.y];
    this.foreground.update(mask, null, crop.image.width / crop.width, tinted, origin);
    ctx.drawImage(this.foreground.shown.canvas, crop.x, crop.y, crop.width, crop.height);
    if (tinted) ctx.drawImage(this.foreground.tint.canvas, crop.x, crop.y, crop.width, crop.height);
    return true;
  }
  invalidate() {
    clearTimeout(this.timer);
    clearTimeout(this.maskTimer);
    this.region = null;
    this.crop?.image.close();
    this.crop = undefined;
    this.foreground = undefined;
  }
  dispose() {
    this.disposed = true;
    this.invalidate();
    this.original?.close();
    this.original = undefined;
  }
}
