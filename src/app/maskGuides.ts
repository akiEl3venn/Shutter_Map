import type { MaskOp, PenPoint, Point } from '../contracts.ts';
import { penPath, polyline } from '../map/mask.ts';
import type { MaskState } from './maskEditor.ts';

export type Stroke = Extract<MaskOp, { tool: 'brush' | 'lasso' }> & { points: Point[] };
export type PenHit = 'close' | { opIndex: number; pointIndex: number; start: Point } | null;

export function penHit(state: MaskState, point: Point, radius: number): PenHit {
  const near = (p: Point) => Math.hypot(p[0] - point[0], p[1] - point[1]) <= radius;
  if (state.penDraft.length >= 3 && near(state.penDraft[0].at)) return 'close';
  for (let opIndex = state.mask.length - 1; opIndex >= 0; opIndex--) {
    const op = state.mask[opIndex];
    if (op.tool !== 'pen') continue;
    for (let i = op.points.length - 1; i >= 0; i--) {
      if (near(op.points[i].at)) return {opIndex, pointIndex: i, start: op.points[i].at};
    }
  }
  return null;
}

export function drawGuides(ctx: CanvasRenderingContext2D, state: MaskState, stroke: Stroke | null,
  hover: Point | null, closeHovered: boolean, px: number) {
  ctx.save();
  const dark = 'rgba(20, 24, 29, .85)';
  function outline(path: Path2D) {
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([]);
    ctx.strokeStyle = dark;
    ctx.stroke(path);
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeStyle = 'white';
    ctx.stroke(path);
    ctx.setLineDash([]);
  }
  function node(p: Point, round: boolean, size: number) {
    const path = new Path2D();
    const radius = size * px / 2;
    if (round) path.arc(...p, radius, 0, Math.PI * 2);
    else path.rect(p[0] - radius, p[1] - radius, radius * 2, radius * 2);
    ctx.fillStyle = 'white';
    ctx.fill(path);
    ctx.strokeStyle = dark;
    ctx.lineWidth = px;
    ctx.stroke(path);
  }
  function pen(points: readonly PenPoint[], closed: boolean) {
    outline(penPath(points, closed));
    points.forEach((p, index) => {
      const closable = !closed && index === 0 && points.length >= 3;
      node(p.at, closable, closable ? (closeHovered ? 14 : 10) : 7);
    });
  }
  if (state.tools.tool === 'pen') {
    for (const op of state.mask) if (op.tool === 'pen') pen(op.points, true);
    const draft = state.penDraft;
    const last = draft.at(-1);
    if (last) {
      if (hover) outline(penPath([last, {at: hover}], false));
      if (last.in && last.out) {
        outline(polyline([last.in, last.at, last.out]));
        node(last.in, true, 5);
        node(last.out, true, 5);
      }
      pen(draft, false);
    }
  } else if (stroke?.tool === 'lasso') {
    outline(polyline(stroke.points));
  } else if (state.tools.tool === 'brush' && hover) {
    const circle = new Path2D();
    circle.arc(...hover, state.tools.sizePx / 2, 0, Math.PI * 2);
    outline(circle);
  }
  ctx.restore();
}
