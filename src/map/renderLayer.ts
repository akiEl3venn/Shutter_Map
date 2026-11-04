import type { MapComposition } from '../contracts.ts';
import type { TileFeatures } from './decodeTile.ts';
import { rasterSize, tileTransform } from './layerGeometry.ts';
import { labelStyle, layoutLabels, selectLabelName, type LabelCandidate } from './labels.ts';
import { circleFeather, fadeBand, fadeStops, haloFor, layerLook, lineWidths, sideFeather } from './style.ts';
import { thinRoads } from './thinRoads.ts';

const strokeOrder = ['water', 'hiking', 'all', 'standard', 'major'] as const;
type StrokeLayer = typeof strokeOrder[number];

/** Geometry lives only in the paths: up to 200 cached tiles should not also keep their coordinate arrays. */
export interface PreparedTile extends Pick<TileFeatures, 'key' | 'extent' | 'places'> {
  paths: Record<StrokeLayer | 'thinnedAll' | 'thinnedHiking', Path2D>;
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
    thinnedAll: new Path2D(), thinnedHiking: new Path2D(),
  };
  for (const polygon of features.water.polygons) {
    for (const ring of polygon) addLine(paths.water, ring, true);
  }
  for (const line of features.water.lines) addLine(paths.water, line);
  const claimed: number[][] = [];
  for (const { kind, line } of features.roads) {
    if (kind === 'all') continue;
    addLine(paths[kind], line);
    claimed.push(line);
  }
  const local = features.roads.filter(({ kind }) => kind === 'all');
  const kept = new Set(thinRoads(local, claimed, features.extent));
  // Preserve the original stroke order and let only retained streets claim cells before hiking.
  for (const { line } of kept) {
    addLine(paths.all, line);
    claimed.push(line);
  }
  for (const road of local) if (!kept.has(road)) addLine(paths.thinnedAll, road.line);
  const keptHiking = new Set(thinRoads(features.hiking, claimed, features.extent));
  for (const { line } of keptHiking) addLine(paths.hiking, line);
  for (const trail of features.hiking) if (!keptHiking.has(trail)) addLine(paths.thinnedHiking, trail.line);
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
    widthPx: composition.widthPx, heightPx: composition.heightPx, scalePx: composition.scalePx,
    rotationDegrees: composition.rotationDegrees, maxCount: composition.labels.maxCount,
    ...(composition.shape === 'circle' ? { shape: composition.shape, feather: circleFeather(composition) }
      : { shape: composition.shape, feather: sideFeather(composition) }),
    measure(text, px) {
      ctx.font = font(px);
      return ctx.measureText(text).width;
    },
  });

  // Label positions and measurements above are always in source-image pixels.
  const u = composition.scalePx / 2400;
  ctx.save();
  ctx.translate((ctx.canvas.width - composition.widthPx * outputScale) / 2,
    (ctx.canvas.height - composition.heightPx * outputScale) / 2);
  ctx.scale(outputScale, outputScale);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = haloFor(lineColor);
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

function applyFade(ctx: OffscreenCanvasRenderingContext2D, composition: MapComposition, layer: StrokeLayer,
  width: number, height: number, outputScale: number) {
  if (composition.shape === 'circle') {
    const feather = circleFeather(composition) * outputScale;
    if (feather <= 0) return;
    const radius = Math.min(width, height) / 2;
    const { start, end } = fadeBand(layer, feather);
    const fade = ctx.createRadialGradient(width / 2, height / 2, radius - start, width / 2, height / 2, radius - end);
    for (const [at, alpha] of fadeStops) fade.addColorStop(at, `rgba(0,0,0,${alpha})`);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, width, height);
  } else {
    const [top, right, bottom, left] = sideFeather(composition).map(value => value * outputScale);
    // Erase each side's band independently. In the corners their alpha masks multiply.
    ctx.globalCompositeOperation = 'destination-out';
    const side = (feather: number, gradient: (start: number, end: number) => CanvasGradient,
      fillBand: (depth: number) => void) => {
      if (feather <= 0) return;
      const { start, end } = fadeBand(layer, feather);
      const fade = gradient(start, end);
      for (const [at, alpha] of fadeStops) fade.addColorStop(at, `rgba(0,0,0,${1 - alpha})`);
      ctx.fillStyle = fade;
      fillBand(start);
    };
    side(top, (s, e) => ctx.createLinearGradient(0, s, 0, e), d => ctx.fillRect(0, 0, width, d));
    side(right, (s, e) => ctx.createLinearGradient(width - s, 0, width - e, 0), d => ctx.fillRect(width - d, 0, d, height));
    side(bottom, (s, e) => ctx.createLinearGradient(0, height - s, 0, height - e), d => ctx.fillRect(0, height - d, width, d));
    side(left, (s, e) => ctx.createLinearGradient(s, 0, e, 0), d => ctx.fillRect(0, 0, d, height));
  }
}

/** Draw an isolated transparent map. Pass outputScale=1 for source resolution. */
export function renderLayer(tiles: readonly PreparedTile[], composition: MapComposition,
  outputScale: number, lineColor: string, complete: boolean, showThinned: boolean): ImageBitmap {
  const [rasterWidth, rasterHeight] = rasterSize(composition, outputScale);
  const width = composition.widthPx * outputScale, height = composition.heightPx * outputScale;
  const canvas = new OffscreenCanvas(rasterWidth, rasterHeight);
  const scratch = new OffscreenCanvas(rasterWidth, rasterHeight);
  const ctx = canvas.getContext('2d');
  const layerCtx = scratch.getContext('2d');
  if (!ctx || !layerCtx) throw new Error('Map drawing unavailable');
  layerCtx.strokeStyle = lineColor;
  layerCtx.lineCap = 'round';
  layerCtx.lineJoin = 'round';
  const widths = lineWidths(composition.scalePx, composition.style.lineScale);
  const positioned = tiles.map(({ key, extent, paths }) => ({
    paths, ...tileTransform(key, extent, composition, outputScale),
  }));
  const angle = composition.rotationDegrees * Math.PI / 180;
  // Clip the completed strokes, rather than the individual tile paths. On wide paths a curved clip can
  // change how Canvas tessellates a stroke well inside the circle. The final clip preserves its pixels.
  ctx.save();
  ctx.translate(rasterWidth / 2, rasterHeight / 2);
  ctx.rotate(angle);
  ctx.translate(-width / 2, -height / 2);
  ctx.beginPath();
  if (composition.shape === 'circle') ctx.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
  else ctx.rect(0, 0, width, height);
  ctx.restore();
  ctx.clip();
  for (const layer of strokeOrder) {
    const visibility = layer === 'water' || layer === 'hiking' ? layer : 'roads';
    if (!composition.visibleLayers[visibility]) continue;
    // Each layer is drawn opaque on its own, so overlaps never darken, then faded and blended as one sheet.
    layerCtx.clearRect(0, 0, rasterWidth, rasterHeight);
    layerCtx.save();
    layerCtx.translate(rasterWidth / 2, rasterHeight / 2);
    layerCtx.rotate(angle);
    layerCtx.translate(-width / 2, -height / 2);
    for (const { paths, matrix, clip } of positioned) {
      layerCtx.save();
      // Clip the encoded buffer, leaving one output pixel of overlap at tile seams.
      layerCtx.beginPath();
      layerCtx.rect(clip.x - 1, clip.y - 1, clip.width + 2, clip.height + 2);
      layerCtx.clip();
      layerCtx.transform(...matrix);
      layerCtx.lineWidth = widths[layer] * outputScale / matrix[0];
      layerCtx.stroke(paths[layer]);
      if (showThinned && layer === 'all') layerCtx.stroke(paths.thinnedAll);
      if (showThinned && layer === 'hiking') layerCtx.stroke(paths.thinnedHiking);
      layerCtx.restore();
    }
    applyFade(layerCtx, composition, layer, width, height, outputScale);
    layerCtx.restore();
    ctx.globalAlpha = layerLook[layer].alpha;
    ctx.drawImage(scratch, 0, 0);
  }
  ctx.globalAlpha = 1;
  scratch.width = scratch.height = 0;
  if (complete && composition.visibleLayers.places && composition.labels.maxCount > 0) {
    drawLabels(ctx, tiles, composition, outputScale, lineColor);
  }
  return canvas.transferToImageBitmap();
}
