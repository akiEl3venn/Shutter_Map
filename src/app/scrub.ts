/** Mouse travel across a field's whole range. Dragging should make large changes easily; typing handles fine ones. */
const FULL_RANGE_PX = 400;
const LOG_RANGE_PX = 600;

/** The value after dragging a number field dx pixels from where the drag began. */
export function scrubbedValue(start: number, dx: number, { min, max, step, log }: {
  min: number; max: number; step: number; log?: boolean;
}): number {
  const raw = log ? start * (max / min) ** (dx / LOG_RANGE_PX)
    : start + dx * (max - min) / FULL_RANGE_PX;
  const stepped = Math.round(raw / step) * step;
  return Math.max(min, Math.min(max, Number(stepped.toFixed(6))));
}
