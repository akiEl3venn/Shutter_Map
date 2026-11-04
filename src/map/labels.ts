import type { MapComposition, PlaceKind } from '../contracts.ts';
import { foldCjk } from '../search/normalize.ts';

type NameLanguage = 'en' | 'zh' | 'ja';
export function selectLabelName(place: { name: string; names: Partial<Record<NameLanguage, string>> },
  language: 'local' | NameLanguage): string {
  const name = (language === 'local' ? undefined : place.names[language]) || place.name;
  // Only a Chinese reader wants simplified forms; 'local' and Japanese keep their own script (渋谷, not 涩谷).
  return language === 'zh' ? foldCjk(name) : name;
}

export interface LabelCandidate {
  kind: PlaceKind;
  name: string;
  x: number;
  y: number;
  rank: number;
}

export interface PlacedLabel extends LabelCandidate {
  fontPx: number;
  /** Left edge and vertical middle in source-image pixels, matching left/middle canvas text. */
  textX: number;
  textY: number;
  marker: boolean;
}

/** Multiples of u = scalePx / 2400. Cropping a rectangle preserves text size and spacing. */
export const labelStyle = { cityFont: 54, townFont: 44, pointFont: 36, markerRadius: 6, halo: 9, spacing: 140 };
/** Keep the text in the fully visible part of the roads, even at a hard edge. */
const LABEL_INSET = 0.34;

type Box = { left: number; right: number; top: number; bottom: number };
const priority: Record<PlaceKind, number> = { city: 0, town: 1, peak: 2, landmark: 3, village: 4 };

type Mask = { shape: 'circle'; feather: number }
  | { shape: 'square' | 'rectangle'; feather: MapComposition['feather']['rectanglePx'] };
export function layoutLabels(candidates: LabelCandidate[], options: Mask & {
  widthPx: number; heightPx: number; scalePx: number; rotationDegrees: number; maxCount: number;
  measure: (text: string, fontPx: number) => number;
}): PlacedLabel[] {
  const { widthPx, heightPx, maxCount, measure } = options;
  if (maxCount === 0) return [];
  const u = options.scalePx / 2400;
  const pad = 6 * u;
  const markerRadius = labelStyle.markerRadius * u;
  const cx = widthPx / 2;
  const cy = heightPx / 2;
  const angle = options.rotationDegrees * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const inset = (feather: number) => Math.max(LABEL_INSET * feather, 8 * u);
  let containsCorner: (x: number, y: number) => boolean;
  if (options.shape === 'circle') {
    const radius = Math.min(cx, cy) - inset(options.feather);
    // A circle is unchanged by rotation, so distance in the upright box suffices.
    containsCorner = (x, y) => Math.hypot(x - cx, y - cy) <= radius;
  } else {
    const [top, right, bottom, left] = options.feather.map(inset);
    containsCorner = (x, y) => {
      const dx = x - cx, dy = y - cy;
      const layerX = cx + dx * cos + dy * sin;
      const layerY = cy - dx * sin + dy * cos;
      return layerX >= left && layerX <= widthPx - right && layerY >= top && layerY <= heightPx - bottom;
    };
  }
  const spacing = labelStyle.spacing * u;
  const occupied: Box[] = [];
  const placed: PlacedLabel[] = [];
  const sorted = [...candidates].sort((a, b) => priority[a.kind] - priority[b.kind]
    || b.rank - a.rank || a.name.length - b.name.length);

  for (const point of sorted) {
    if (placed.length >= maxCount) break;
    const { name, kind } = point;
    const dx = point.x - cx, dy = point.y - cy;
    // Anchors turn with the roads. Text boxes and collisions stay in upright axes.
    const x = cx + dx * cos - dy * sin;
    const y = cy + dx * sin + dy * cos;
    if (placed.some(p => p.name === name && Math.hypot(x - p.x, y - p.y) < 16 * u)) continue;
    const marker = kind === 'landmark' || kind === 'peak';
    const fontPx = (kind === 'city' ? labelStyle.cityFont : kind === 'town' ? labelStyle.townFont : labelStyle.pointFont) * u;
    const width = measure(name, fontPx);
    const gap = markerRadius + pad;
    const positions = marker ? [x + gap, x - gap - width] : [x - width / 2];

    for (const textX of positions) {
      // Keep both the text and any point marker clear of neighboring labels and the hard mask.
      const box = {
        left: (marker ? Math.min(textX, x - markerRadius) : textX) - pad,
        right: (marker ? Math.max(textX + width, x + markerRadius) : textX + width) + pad,
        top: y - fontPx / 2 - pad, bottom: y + fontPx / 2 + pad,
      };
      if (!containsCorner(box.left, box.top) || !containsCorner(box.right, box.top)
        || !containsCorner(box.left, box.bottom) || !containsCorner(box.right, box.bottom)) continue;
      if (occupied.some(b => box.left - spacing < b.right && box.right + spacing > b.left
        && box.top - spacing < b.bottom && box.bottom + spacing > b.top)) continue;
      placed.push({ ...point, x, y, marker, fontPx, textX, textY: y });
      occupied.push(box);
      break;
    }
  }
  return placed;
}
