import type { MapComposition } from '../contracts.ts';
import type { TileFeatures } from './decodeTile.ts';
import { projectToLayer, rasterOf, rasterSize, tileTransform } from './layerGeometry.ts';
import { focusLabel, isAreaName, labelStyle, layoutLabels, markFocus, selectLabelName, type LabelCandidate, type PlacedLabel } from './labels.ts';
import { circleFeather, fadeInside, fadeStops, focusColor, labelInsets, layerLook, lineWidths, roadSpacing, sideFeather } from './style.ts';
import { roadTiers, TIER_COUNT, tierLimit, type PlacedRoad } from './thinRoads.ts';

const strokeOrder = ['water', 'hiking', 'all', 'standard', 'major'] as const;
type StrokeLayer = typeof strokeOrder[number];

/** Geometry lives only in the paths: up to 200 cached tiles should not also keep their coordinate arrays. */
export interface PreparedTile extends Pick<TileFeatures, 'key' | 'extent' | 'places'> {
  paths: Record<'water' | 'standard' | 'major', Path2D>;
  /** One path per thinning tier, coarse to fine. */
  tiers: Record<'streets' | 'lanes' | 'trails', Path2D[]>;
}

function addLine(path: Path2D, points: number[], closed = false) {
  if (points.length < 4) return;
  path.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
  if (closed) path.closePath();
}

/** Paths stay in tile coordinates and can be reused at any output resolution. */
export function prepareTile(features: TileFeatures): PreparedTile {
  const paths = { water: new Path2D(), standard: new Path2D(), major: new Path2D() };
  const paths2D = () => Array.from({ length: TIER_COUNT }, () => new Path2D());
  const tiers = { streets: paths2D(), lanes: paths2D(), trails: paths2D() };
  for (const polygon of features.water.polygons) {
    for (const ring of polygon) addLine(paths.water, ring, true);
  }
  for (const line of features.water.lines) addLine(paths.water, line);
  const placed: PlacedRoad[] = [];
  for (const { kind, line } of features.roads) {
    if (kind === 'all') continue;
    addLine(paths[kind], line);
    placed.push({ line, tier: 0 });
  }
  const local = features.roads.filter(({ kind }) => kind === 'all');
  roadTiers(local, placed, features.extent).forEach((tier, i) => {
    const { line, minor } = local[i]!;
    addLine((minor ? tiers.lanes : tiers.streets)[tier]!, line);
    placed.push({ line, tier });
  });
  // Trails only claim what is left after every road, so turning them on never changes the roads.
  roadTiers(features.hiking, placed, features.extent).forEach((tier, i) => addLine(tiers.trails[tier]!, features.hiking[i]!.line));
  return { key: features.key, extent: features.extent, places: features.places, paths, tiers };
}

/** The paths a stroke class draws from one tile at this detail level. */
function pathsToDraw({ paths, tiers }: PreparedTile, layer: StrokeLayer, spacing: ReturnType<typeof roadSpacing>, tileSpanPx: number): Path2D[] {
  const upTo = (tiered: Path2D[], px: number | null) => tiered.slice(0, tierLimit(px, tileSpanPx) + 1);
  if (layer === 'hiking') return upTo(tiers.trails, spacing.trails);
  if (layer === 'all') return [...upTo(tiers.streets, spacing.streets), ...upTo(tiers.lanes, spacing.lanes)];
  return [paths[layer]];
}

const font = (px: number) => `600 ${px}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;

type TilePlace = PreparedTile['places'][number];
const chosenNames = new WeakMap<TilePlace, { language: string; spokenThere: boolean; name: string | undefined }>();

/** A place's label only changes with the language, while every frame asks for thousands of them. */
function labelName(place: TilePlace, language: string, spokenThere: boolean): string | undefined {
  const known = chosenNames.get(place);
  if (known?.language === language && known.spokenThere === spokenThere) return known.name;
  const name = selectLabelName(place, language, spokenThere);
  chosenNames.set(place, { language, spokenThere, name });
  return name;
}

function drawLabels(ctx: OffscreenCanvasRenderingContext2D, tiles: readonly PreparedTile[],
  composition: MapComposition, outputScale: number, lineColor: string) {
  const candidates: LabelCandidate[] = [];
  const { focus, language, localLanguages } = composition.labels;
  const spokenThere = localLanguages.includes(language);
  // Labels stay inside the frame, which at any rotation stays inside this circle. The tiles reach well beyond it.
  const centerX = composition.widthPx / 2, centerY = composition.heightPx / 2;
  const reach = Math.hypot(centerX, centerY);
  // The worker supplies coverage order, so ties do not depend on network arrival.
  for (const tile of tiles) {
    const { matrix: [s, , , , left, top] } = tileTransform(tile.key, tile.extent, composition, 1);
    for (const place of tile.places) {
      if (isAreaName(place.kind) && !composition.labels.showAreas) continue;
      const x = left + s * place.x, y = top + s * place.y;
      if (Math.hypot(x - centerX, y - centerY) > reach) continue;
      const name = labelName(place, language, spokenThere);
      if (!name) continue;
      candidates.push({
        name,
        kind: place.kind, rank: place.rank, x, y,
        // Only the few near the focus are ever asked.
        get aliases() { return [place.name, ...Object.values(place.names).filter(alias => alias !== undefined)]; },
      });
    }
  }
  let marked = candidates;
  if (focus) {
    const [x, y] = projectToLayer(focus.coordinate, composition);
    marked = markFocus(candidates, { x, y, metersPerPx: composition.metersPerImagePixel, name: focus.name,
      englishName: focus.englishName, label: focusLabel(focus, language) });
  }
  const labels = layoutLabels(marked, {
    widthPx: composition.widthPx, heightPx: composition.heightPx, scalePx: composition.scalePx,
    rotationDegrees: composition.rotationDegrees, maxCount: composition.labels.maxCount, shape: composition.shape,
    fadeInsets: labelInsets(composition),
    measure(text, px) {
      ctx.font = font(px);
      return ctx.measureText(text).width;
    },
  });

  // Label positions and measurements above are always in source-image pixels.
  const u = composition.scalePx / 2400;
  const raster = rasterOf(composition);
  ctx.save();
  ctx.translate(-raster.x * outputScale, -raster.y * outputScale);
  ctx.scale(outputScale, outputScale);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const gap = labelStyle.gap * u;
  const markerDot = (label: PlacedLabel, radius: number) => {
    ctx.beginPath();
    ctx.arc(label.x, label.y, radius, 0, 2 * Math.PI);
    ctx.fill();
  };
  // The map makes way along the outline of each label, so the photo itself sets the text apart from the roads and
  // nothing is painted over it. Clear them all first, so that a label's gap can never cut into its neighbor.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = ctx.strokeStyle = '#000';
  ctx.lineWidth = gap * 2;
  ctx.lineJoin = 'round';
  for (const label of labels) {
    if (label.marker) markerDot(label, labelStyle.markerRadius * u + gap);
    ctx.font = font(label.fontPx);
    ctx.strokeText(label.name, label.textX, label.textY);
    ctx.fillText(label.name, label.textX, label.textY);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const label of labels) {
    ctx.fillStyle = label.focus ? focusColor : lineColor;
    if (label.marker) markerDot(label, labelStyle.markerRadius * u);
    ctx.font = font(label.fontPx);
    ctx.fillText(label.name, label.textX, label.textY);
  }
  ctx.restore();
}

/** Fade one stroke class across the layer's edges, with the context's origin at the layer's top-left corner. */
function applyFade(ctx: OffscreenCanvasRenderingContext2D, composition: MapComposition, layer: StrokeLayer,
  width: number, height: number, outputScale: number) {
  const { reach } = layerLook[layer];
  const raster = rasterOf(composition);
  const left = raster.x * outputScale, top = raster.y * outputScale;
  const canvasWidth = ctx.canvas.width, canvasHeight = ctx.canvas.height;
  if (composition.shape === 'circle') {
    const feather = circleFeather(composition);
    if (feather <= 0) return;
    const start = width / 2 - fadeInside(feather, composition) * outputScale;
    const fade = ctx.createRadialGradient(width / 2, height / 2, start, width / 2, height / 2, start + feather * outputScale * reach);
    for (const [at, alpha] of fadeStops) fade.addColorStop(at, `rgba(0,0,0,${alpha})`);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = fade;
    ctx.fillRect(left, top, canvasWidth, canvasHeight);
  } else {
    const [featherTop, featherRight, featherBottom, featherLeft] = sideFeather(composition);
    // Erase each side's band independently. In the corners their alpha masks multiply.
    ctx.globalCompositeOperation = 'destination-out';
    // Depths from the edge, into the layer: where the fade starts, and where it ends, usually beyond the edge.
    const side = (feather: number, gradient: (start: number, end: number) => CanvasGradient, fillOutwards: (start: number) => void) => {
      if (feather <= 0) return;
      const start = fadeInside(feather, composition) * outputScale;
      const fade = gradient(start, start - feather * outputScale * reach);
      for (const [at, alpha] of fadeStops) fade.addColorStop(at, `rgba(0,0,0,${1 - alpha})`);
      ctx.fillStyle = fade;
      fillOutwards(start);
    };
    side(featherTop, (s, e) => ctx.createLinearGradient(0, s, 0, e), s => ctx.fillRect(left, top, canvasWidth, s - top));
    side(featherRight, (s, e) => ctx.createLinearGradient(width - s, 0, width - e, 0), s => ctx.fillRect(width - s, top, canvasWidth, canvasHeight));
    side(featherBottom, (s, e) => ctx.createLinearGradient(0, height - s, 0, height - e), s => ctx.fillRect(left, height - s, canvasWidth, canvasHeight));
    side(featherLeft, (s, e) => ctx.createLinearGradient(s, 0, e, 0), s => ctx.fillRect(left, top, s - left, canvasHeight));
  }
}

/** Draw an isolated transparent map. Pass outputScale=1 for source resolution. */
export function renderLayer(tiles: readonly PreparedTile[], composition: MapComposition,
  outputScale: number, lineColor: string, complete: boolean): ImageBitmap {
  const [rasterWidth, rasterHeight] = rasterSize(composition, outputScale);
  const width = composition.widthPx * outputScale, height = composition.heightPx * outputScale;
  const raster = rasterOf(composition);
  // Where the layer's top-left corner is on this canvas. It can be well off it, with a fade around it or a photo edge across it.
  const originX = -raster.x * outputScale, originY = -raster.y * outputScale;
  const canvas = new OffscreenCanvas(rasterWidth, rasterHeight);
  const scratch = new OffscreenCanvas(rasterWidth, rasterHeight);
  const ctx = canvas.getContext('2d');
  const layerCtx = scratch.getContext('2d');
  if (!ctx || !layerCtx) throw new Error('Map drawing unavailable');
  layerCtx.strokeStyle = lineColor;
  layerCtx.lineCap = 'round';
  layerCtx.lineJoin = 'round';
  const widths = lineWidths(composition.scalePx, composition.style.lineScale);
  const spacing = roadSpacing(composition.detailOffset, composition.scalePx);
  const positioned = tiles.map(tile => ({ tile, ...tileTransform(tile.key, tile.extent, composition, outputScale) }));
  const angle = composition.rotationDegrees * Math.PI / 180;
  // Clip the completed strokes, rather than the individual tile paths. On wide paths a curved clip can
  // change how Canvas tessellates a stroke well inside the circle.
  // A rectangle's edges are the canvas's. A circle's outer edge, where its fade ends, needs drawing.
  if (composition.shape === 'circle') {
    ctx.beginPath();
    const feather = circleFeather(composition);
    ctx.arc(originX + width / 2, originY + height / 2, width / 2 + (feather - fadeInside(feather, composition)) * outputScale, 0, Math.PI * 2);
    ctx.clip();
  }
  for (const layer of strokeOrder) {
    const visibility = layer === 'water' || layer === 'hiking' ? layer : 'roads';
    if (!composition.visibleLayers[visibility]) continue;
    // Each layer is drawn opaque on its own, so overlaps never darken, then faded and blended as one sheet.
    layerCtx.clearRect(0, 0, rasterWidth, rasterHeight);
    layerCtx.save();
    layerCtx.translate(originX + width / 2, originY + height / 2);
    layerCtx.rotate(angle);
    layerCtx.translate(-width / 2, -height / 2);
    for (const { tile, matrix, clip } of positioned) {
      layerCtx.save();
      // Clip the encoded buffer, leaving one output pixel of overlap at tile seams.
      layerCtx.beginPath();
      layerCtx.rect(clip.x - 1, clip.y - 1, clip.width + 2, clip.height + 2);
      layerCtx.clip();
      layerCtx.transform(...matrix);
      layerCtx.lineWidth = widths[layer] * outputScale / matrix[0];
      for (const path of pathsToDraw(tile, layer, spacing, clip.width / outputScale)) layerCtx.stroke(path);
      layerCtx.restore();
    }
    layerCtx.restore();
    // The map turns; the layer's edges, and so the fade along them, stay upright.
    layerCtx.save();
    layerCtx.translate(originX, originY);
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
