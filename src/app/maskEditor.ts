import type { Mask, MaskOp, PenPoint, Point } from '../contracts.ts';
import type { PhotoSize } from '../map/editComposition.ts';

type Tool = MaskOp['tool'];
type Stroke = Exclude<MaskOp, { tool: 'pen' }>;

export interface MaskTools {
  tool: Tool;
  mode: MaskOp['mode'];
  sizePx: number;
  featherPx: Record<Tool, number>;
  show: boolean;
}

export interface MaskState {
  photo: PhotoSize;
  mask: Mask;
  past: readonly Mask[];
  future: readonly Mask[];
  penDraft: readonly PenPoint[];
  editing: boolean;
  tools: MaskTools;
}

export type MaskAction =
  | { type: 'start' | 'finish' | 'close' | 'dropDraft' | 'undoPoint' | 'undo' | 'redo' | 'clear' }
  | { type: 'tool'; value: Tool }
  | { type: 'mode'; value: MaskOp['mode'] }
  | { type: 'size' | 'feather'; value: number }
  | { type: 'show'; value: boolean }
  | { type: 'penPoint' | 'penHandle'; point: Point }
  | { type: 'commit'; op: Stroke }
  | { type: 'beginMove'; opIndex: number; pointIndex: number }
  | { type: 'move'; opIndex: number; pointIndex: number; point: Point }
  | { type: 'reset'; photo: PhotoSize };

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const longEdge = (photo: PhotoSize) => Math.max(photo.widthPx, photo.heightPx);
export const brushMaxSize = (photo: PhotoSize) => Math.max(1, longEdge(photo) / 2);
export function maxFeather({ photo, tools }: MaskState): number {
  const maximum = longEdge(photo) / 10;
  return tools.tool === 'brush' ? Math.min(maximum, tools.sizePx) : maximum;
}
export function clampPoint([x, y]: Point, photo: PhotoSize): Point {
  return [clamp(x, 0, photo.widthPx), clamp(y, 0, photo.heightPx)];
}

export function initialMasks(photo: PhotoSize): MaskState {
  return {
    photo, mask: [], past: [], future: [], penDraft: [], editing: false,
    tools: { tool: 'pen', mode: 'add', sizePx: Math.max(1, Math.round(longEdge(photo) / 40)),
      featherPx: { pen: 0, lasso: 0, brush: 0 }, show: true },
  };
}

function remember(state: MaskState, mask: Mask): MaskState {
  return { ...state, past: [...state.past, state.mask], mask, future: [] };
}

function closePen(state: MaskState): MaskState {
  if (state.penDraft.length < 3) return state;
  const op: MaskOp = { tool: 'pen', points: state.penDraft, mode: state.tools.mode, featherPx: state.tools.featherPx.pen };
  return { ...remember(state, [...state.mask, op]), penDraft: [] };
}

export function editMasks(state: MaskState, action: MaskAction): MaskState {
  const { tools, penDraft, mask, past, future } = state;
  switch (action.type) {
    case 'reset': return initialMasks(action.photo);
    case 'start': return { ...state, editing: true };
    case 'finish': return { ...closePen(state), penDraft: [], editing: false };
    case 'tool':
      if (tools.tool === action.value) return state;
      return { ...closePen(state), penDraft: [], tools: { ...tools, tool: action.value } };
    case 'mode': return { ...state, tools: { ...tools, mode: action.value } };
    case 'show': return { ...state, tools: { ...tools, show: action.value } };
    case 'size': {
      const sizePx = clamp(action.value, 1, brushMaxSize(state.photo));
      const featherPx = { ...tools.featherPx, brush: Math.min(tools.featherPx.brush, sizePx) };
      return { ...state, tools: { ...tools, sizePx, featherPx } };
    }
    case 'feather': {
      const featherPx = { ...tools.featherPx, [tools.tool]: clamp(action.value, 0, maxFeather(state)) };
      return { ...state, tools: { ...tools, featherPx } };
    }
    case 'penPoint': return { ...state, penDraft: [...penDraft, { at: clampPoint(action.point, state.photo) }] };
    case 'penHandle': {
      const last = penDraft.at(-1);
      if (!last) return state;
      const [x, y] = last.at;
      const point: PenPoint = { ...last, out: action.point, in: [2 * x - action.point[0], 2 * y - action.point[1]] };
      return { ...state, penDraft: [...penDraft.slice(0, -1), point] };
    }
    case 'close': return closePen(state);
    case 'undoPoint': return { ...state, penDraft: penDraft.slice(0, -1) };
    case 'dropDraft': return { ...state, penDraft: [] };
    case 'commit': {
      const op = action.op;
      if (op.points.length < (op.tool === 'lasso' ? 3 : 1)) return state;
      const points = op.points.map(point => clampPoint(point, state.photo));
      return remember(state, [...mask, { ...op, points }]);
    }
    case 'beginMove': return remember(state, mask);
    case 'move': {
      const op = mask[action.opIndex];
      if (op?.tool !== 'pen') return state;
      const point = op.points[action.pointIndex];
      if (!point) return state;
      const at = clampPoint(action.point, state.photo);
      const dx = at[0] - point.at[0], dy = at[1] - point.at[1];
      if (!dx && !dy) return state;
      const next: PenPoint = { at };
      if (point.in) next.in = [point.in[0] + dx, point.in[1] + dy];
      if (point.out) next.out = [point.out[0] + dx, point.out[1] + dy];
      const points = op.points.slice();
      points[action.pointIndex] = next;
      const moved = mask.slice();
      moved[action.opIndex] = { ...op, points };
      return { ...state, mask: moved };
    }
    case 'undo': {
      const previous = past.at(-1);
      return previous ? { ...state, mask: previous, past: past.slice(0, -1), future: [...future, mask] } : state;
    }
    case 'redo': {
      const next = future.at(-1);
      return next ? { ...state, mask: next, past: [...past, mask], future: future.slice(0, -1) } : state;
    }
    case 'clear': return { ...remember(state, []), penDraft: [] };
  }
}
