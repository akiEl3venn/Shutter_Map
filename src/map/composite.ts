import type { MapComposition } from '../contracts.ts';
import { projectToLayer, rasterSize } from './layerGeometry.ts';

/** Place the last raster in source pixels, anticipating edits until the new vector frame arrives. */
export function drawOverlay(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap, drawn: MapComposition, target: MapComposition): void {
  const [width, height] = rasterSize(drawn, 1);
  const scale = drawn.metersPerImagePixel / target.metersPerImagePixel;
  const turn = (target.rotationDegrees - drawn.rotationDegrees) * Math.PI / 180;
  const [x, y] = projectToLayer(drawn.geographicCenter, target);
  const dx = x - target.widthPx / 2, dy = y - target.heightPx / 2;
  const angle = target.rotationDegrees * Math.PI / 180;
  ctx.save();
  ctx.globalAlpha = target.style.opacity;
  if (turn) {
    // Only the map turns. Until its new lines arrive, keep the turned old picture inside the layer's upright edges.
    ctx.beginPath();
    if (target.shape === 'circle') ctx.arc(target.centerPx[0], target.centerPx[1], target.widthPx / 2, 0, 2 * Math.PI);
    else ctx.rect(target.centerPx[0] - target.widthPx / 2, target.centerPx[1] - target.heightPx / 2, target.widthPx, target.heightPx);
    ctx.clip();
  }
  ctx.translate(target.centerPx[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
    target.centerPx[1] + dx * Math.sin(angle) + dy * Math.cos(angle));
  if (turn) ctx.rotate(turn);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.drawImage(bitmap, -width / 2, -height / 2, width, height);
  ctx.restore();
}
