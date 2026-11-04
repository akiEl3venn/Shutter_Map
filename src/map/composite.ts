import type { MapComposition } from '../contracts.ts';

/** Places the map on the photo, in oriented source pixels. */
export function drawOverlay(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap, layer: MapComposition): void {
  ctx.save();
  ctx.translate(layer.centerPx[0], layer.centerPx[1]);
  ctx.rotate(layer.rotationDegrees * Math.PI / 180);
  ctx.globalAlpha = 0.9;
  ctx.drawImage(bitmap, -layer.widthPx / 2, -layer.heightPx / 2, layer.widthPx, layer.heightPx);
  ctx.restore();
}
