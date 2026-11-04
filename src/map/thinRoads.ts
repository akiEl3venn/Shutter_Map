/** A tile is split into this many cells per side. Tiles span 512–1024 source px, so a cell is about 6–12 px. */
const GRID = 84;
/** Drop a road once this share of the cells it crosses is taken. Service lanes and the like yield sooner. */
const MAX_OVERLAP = 0.8;
const MAX_OVERLAP_MINOR = 0.5;

export interface ThinnableRoad {
  line: number[];
  /** Service lanes, pedestrian streets, tracks: the first to go where space is tight. */
  minor?: boolean;
}

/** Cells a line passes through, sampled every half cell; parts in the tile's buffer are ignored. */
function cellsAlong(line: number[], extent: number): Set<number> {
  const cell = extent / GRID;
  const cells = new Set<number>();
  for (let i = 2; i < line.length; i += 2) {
    const x0 = line[i - 2]!, y0 = line[i - 1]!, dx = line[i]! - x0, dy = line[i + 1]! - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (cell / 2)));
    for (let step = 0; step <= steps; step++) {
      const col = Math.floor((x0 + dx * step / steps) / cell);
      const row = Math.floor((y0 + dy * step / steps) / cell);
      if (col >= 0 && col < GRID && row >= 0 && row < GRID) cells.add(row * GRID + col);
    }
  }
  return cells;
}

function lengthOf(line: number[]): number {
  let length = 0;
  for (let i = 2; i < line.length; i += 2) length += Math.hypot(line[i]! - line[i - 2]!, line[i + 1]! - line[i - 1]!);
  return length;
}

/**
 * Density-adaptive generalization: bigger roads claim their cells first, then ordinary streets before minor ones
 * and longer before shorter. A road is dropped only where most of its cells are already taken, so crowded alleys and
 * lanes hugging a main road go while every road in sparse country stays.
 */
export function thinRoads<T extends ThinnableRoad>(roads: readonly T[], claimed: readonly number[][], extent: number): T[] {
  const taken = new Uint8Array(GRID * GRID);
  for (const line of claimed) for (const cell of cellsAlong(line, extent)) taken[cell] = 1;
  const ordered = roads.map((road) => ({ road, length: lengthOf(road.line) }))
    .sort((a, b) => Number(a.road.minor ?? false) - Number(b.road.minor ?? false) || b.length - a.length);
  const kept: T[] = [];
  for (const { road } of ordered) {
    const cells = cellsAlong(road.line, extent);
    if (!cells.size) continue; // Entirely in the buffer: the neighboring tile draws it.
    let overlap = 0;
    for (const cell of cells) overlap += taken[cell]!;
    if (overlap / cells.size > (road.minor ? MAX_OVERLAP_MINOR : MAX_OVERLAP)) continue;
    for (const cell of cells) taken[cell] = 1;
    kept.push(road);
  }
  return kept;
}
