import type { MapComposition } from '../contracts.ts';
import type { TileFeatures } from './decodeTile.ts';
import { tileTransform } from './layerGeometry.ts';
import { labelStyle, layoutLabels, selectLabelName, type LabelCandidate } from './labels.ts';
import { lineWidths } from './style.ts';

const strokeOrder = ['water', 'hiking', 'all', 'standard', 'major'] as const;
type StrokeLayer = typeof strokeOrder[number];

/** Geometry lives only in the paths: up to 200 cached tiles should not also keep their coordinate arrays. */
export interface PreparedTile extends Pick<TileFeatures, 'key' | 'extent' | 'places'> {
  paths: Record<StrokeLayer, Path2D>;
}

function addLine(path: Path2D, points: number[], closed = false) {
  if (points.length < 4) return;
  path.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
  if (closed) path.closePath();
}

/** Paths stay in tile coordinates and can be reused at any output resolution. */
export function prepareTile(features: TileFeatures): PreparedTile {
  const paths = {
    water: new Path2D(), hiking: new Path2D(),
    all: new Path2D(), standard: new Path2D(), major: new Path2D(),
  };
  for (const polygon of features.water.polygons) {
    for (const ring of polygon) addLine(paths.water, ring, true);
  }
  for (const line of features.water.lines) addLine(paths.water, line);
  for (const { line } of features.hiking) addLine(paths.hiking, line);
  for (const { kind, line } of features.roads) addLine(paths[kind], line);
  return { key: features.key, extent: features.extent, places: features.places, paths };
}

const font = (px: number) => `600 ${px}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;

function drawLabels(ctx: OffscreenCanvasRenderingContext2D, tiles: readonly PreparedTile[],
  composition: MapComposition, outputScale: number, lineColor: string) {
  const candidates: LabelCandidate[] = [];
  // The worker supplies coverage order, so ties do not depend on network arrival.
  for (const tile of tiles) {
    const { matrix: [s, , , , left, top] } = tileTransform(tile.key, tile.extent, composition, 1);
    for (const place of tile.places) {
      candidates.push({
        name: selectLabelName(place, composition.labels.language),
        kind: place.kind, rank: place.rank, x: left + s * place.x, y: top + s * place.y,
      });
    }
  }
  const labels = layoutLabels(candidates, {
    widthPx: composition.widthPx, heightPx: composition.heightPx, maxCount: composition.labels.maxCount,
    measure(text, px) {
      ctx.font = font(px);
      return ctx.measureText(text).width;
    },
  });

  // Label positions and measurements above are always in source-image pixels.
  const u = composition.widthPx / 2400;
  ctx.save();
  ctx.scale(outputScale, outputScale);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = lineColor === '#ffffff' ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.8)';
  ctx.fillStyle = lineColor;
  ctx.lineWidth = labelStyle.halo * u;
  ctx.lineJoin = 'round';
  for (const label of labels) {
    if (label.marker) {
      ctx.beginPath();
      ctx.arc(label.x, label.y, labelStyle.markerRadius * u, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.font = font(label.fontPx);
    ctx.strokeText(label.name, label.textX, label.textY);
    ctx.fillText(label.name, label.textX, label.textY);
  }
  ctx.restore();
}

/** Draw an isolated transparent map. Pass outputScale=1 for source resolution. */
export function renderLayer(tiles: readonly PreparedTile[], composition: MapComposition,
  outputScale: number, lineColor: string, complete: boolean): ImageBitmap {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(composition.widthPx * outputScale)),
    Math.max(1, Math.round(composition.heightPx * outputScale)));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Map drawing unavailable');
  ctx.strokeStyle = lineColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const widths = lineWidths(composition.widthPx);
  const positioned = tiles.map(({ key, extent, paths }) => ({
    paths, ...tileTransform(key, extent, composition, outputScale),
  }));
  for (const layer of strokeOrder) {
    const visibility = layer === 'water' || layer === 'hiking' ? layer : 'roads';
    if (!composition.visibleLayers[visibility]) continue;
    for (const { paths, matrix, clip } of positioned) {
      ctx.save();
      // Clip the encoded buffer, leaving one output pixel of overlap at tile seams.
      ctx.beginPath();
      ctx.rect(clip.x - 1, clip.y - 1, clip.width + 2, clip.height + 2);
      ctx.clip();
      ctx.setTransform(...matrix);
      ctx.lineWidth = widths[layer] * outputScale / matrix[0];
      ctx.stroke(paths[layer]);
      ctx.restore();
    }
  }
  if (complete && composition.visibleLayers.places) drawLabels(ctx, tiles, composition, outputScale, lineColor);

  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2, 0, 2 * Math.PI);
  ctx.fill();
  return canvas.transferToImageBitmap();
}
