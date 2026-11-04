/** Cells per tile side, coarse to fine. A road's tier is the first grid with room for it; roads no grid has room for come last. */
export const TIER_GRIDS = [21, 42, 84] as const;
export const TIER_COUNT = TIER_GRIDS.length + 1;
/** Drop a road once this share of the cells it crosses is taken. Service lanes and the like yield sooner. */
const MAX_OVERLAP = 0.8;
const MAX_OVERLAP_MINOR = 0.5;

export interface ThinnableRoad {
  line: number[];
  /** Service lanes, pedestrian streets, tracks: the first to go where space is tight. */
  minor?: boolean;
}

/** A road already on the map, which holds its cells from its tier onwards. */
export interface PlacedRoad {
  line: number[];
  tier: number;
}

/** Cells a line passes through, sampled every half cell; parts in the tile's buffer are ignored. */
function cellsAlong(line: number[], extent: number, grid: number): Set<number> {
  const cell = extent / grid;
  const cells = new Set<number>();
  for (let i = 2; i < line.length; i += 2) {
    const x0 = line[i - 2]!, y0 = line[i - 1]!, dx = line[i]! - x0, dy = line[i + 1]! - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (cell / 2)));
    for (let step = 0; step <= steps; step++) {
      const col = Math.floor((x0 + dx * step / steps) / cell);
      const row = Math.floor((y0 + dy * step / steps) / cell);
      if (col >= 0 && col < grid && row >= 0 && row < grid) cells.add(row * grid + col);
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
 * Density-adaptive generalization, returned as a tier per road. In each grid the roads already placed claim their cells
 * first, then ordinary streets before minor ones and longer before shorter. A road joins a tier only where most of its
 * cells are still free, so crowded alleys and lanes hugging a main road wait for a finer grid, while every road in
 * sparse country is in the first tier.
 */
export function roadTiers(roads: readonly ThinnableRoad[], placed: readonly PlacedRoad[], extent: number): number[] {
  const tiers = roads.map((): number => TIER_GRIDS.length);
  const ordered = roads.map((road, index) => ({ road, index, length: lengthOf(road.line) }))
    .sort((a, b) => Number(a.road.minor ?? false) - Number(b.road.minor ?? false) || b.length - a.length);
  TIER_GRIDS.forEach((grid, tier) => {
    const taken = new Uint8Array(grid * grid);
    const claim = (line: number[]) => { for (const cell of cellsAlong(line, extent, grid)) taken[cell] = 1; };
    for (const road of placed) if (road.tier <= tier) claim(road.line);
    for (const { road, index } of ordered) if (tiers[index]! < tier) claim(road.line);
    for (const { road, index } of ordered) {
      if (tiers[index]! < tier) continue;
      const cells = cellsAlong(road.line, extent, grid);
      if (!cells.size) continue; // Entirely in the buffer: the neighboring tile draws it.
      let overlap = 0;
      for (const cell of cells) overlap += taken[cell]!;
      if (overlap / cells.size > (road.minor ? MAX_OVERLAP_MINOR : MAX_OVERLAP)) continue;
      for (const cell of cells) taken[cell] = 1;
      tiers[index] = tier;
    }
  });
  return tiers;
}

/**
 * The tiers a tile may draw for a least spacing between roads. Null draws none, 0 draws every road. A tile blown up past
 * the finest grid has room for all of them.
 */
export function tierLimit(spacingPx: number | null, tileSpanPx: number): number {
  if (spacingPx === null) return -1;
  const cells = spacingPx === 0 ? Infinity : tileSpanPx / spacingPx;
  if (cells >= 2 * TIER_GRIDS[TIER_GRIDS.length - 1]!) return TIER_GRIDS.length;
  return TIER_GRIDS.filter(grid => grid <= cells).length - 1;
}
