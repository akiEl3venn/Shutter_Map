import type { Mask, MaskOp, PenPoint, Point } from '../contracts.ts';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export interface Box { x: number; y: number; width: number; height: number }

export function polyline(points: readonly Point[]): Path2D {
  const path = new Path2D();
  if (points.length) {
    path.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) path.lineTo(...points[i]);
  }
  return path;
}

export function penPath(points: readonly PenPoint[], closed: boolean): Path2D {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(...points[0].at);
  const edges = closed ? points.length : points.length - 1;
  for (let i = 0; i < edges; i++) {
    const from = points[i], to = points[(i + 1) % points.length];
    if (from.out || to.in) path.bezierCurveTo(...(from.out ?? from.at), ...(to.in ?? to.at), ...to.at);
    else path.lineTo(...to.at);
  }
  if (closed) path.closePath();
  return path;
}

function extent(op: MaskOp) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  function include([x, y]: Point) {
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (op.tool === 'pen') {
    for (const p of op.points) {
      include(p.at);
      if (p.in) include(p.in);
      if (p.out) include(p.out);
    }
  } else {
    for (const p of op.points) include(p);
  }
  // A Bézier stays inside its control points. Allow for round caps and the tails of the blur.
  const reach = op.featherPx + (op.tool === 'brush' ? op.sizePx / 2 : 0);
  return { left: left - reach, right: right + reach, top: top - reach, bottom: bottom + reach };
}

/** Smallest whole-pixel cutout covering the additive operations and their soft edges. */
export function maskBounds(mask: Mask, widthPx: number, heightPx: number): Box | null {
  let left = widthPx, top = heightPx, right = 0, bottom = 0;
  for (const op of mask) {
    if (op.mode === 'erase') continue;
    const box = extent(op);
    left = Math.min(left, box.left); right = Math.max(right, box.right);
    top = Math.min(top, box.top); bottom = Math.max(bottom, box.bottom);
  }
  const x = Math.max(0, Math.floor(left)), y = Math.max(0, Math.floor(top));
  const width = Math.min(widthPx, Math.ceil(right)) - x;
  const height = Math.min(heightPx, Math.ceil(bottom)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function drawOp(ctx: Context, op: MaskOp, scale: number, [ox, oy]: Point): void {
  if (!op.points.length) return;
  ctx.save();
  ctx.globalCompositeOperation = op.mode === 'add' ? 'source-over' : 'destination-out';
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.lineCap = ctx.lineJoin = 'round';
  // Only the shadow lands on the canvas. Both shadow parameters are in canvas pixels.
  const blur = op.featherPx * scale / 2;
  const shift = blur ? Math.ceil((extent(op).right - ox) * scale) + 1 : 0;
  ctx.setTransform(scale, 0, 0, scale, -ox * scale - shift, -oy * scale);
  if (blur) {
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = shift;
  }
  if (op.tool === 'pen') ctx.fill(penPath(op.points, true));
  else if (op.tool === 'lasso') ctx.fill(polyline(op.points));
  else if (op.points.length === 1) {
    const dab = new Path2D();
    dab.arc(...op.points[0], op.sizePx / 2, 0, 2 * Math.PI);
    ctx.fill(dab);
  } else {
    ctx.lineWidth = op.sizePx;
    ctx.stroke(polyline(op.points));
  }
  ctx.restore();
}

/** Replay in order on a cleared canvas positioned at origin in oriented photo pixels. */
export function drawMask(ctx: Context, mask: Mask, scale: number, origin: Point): void {
  for (const op of mask) drawOp(ctx, op, scale, origin);
}
