import type { PlaceKind } from '../contracts.ts';
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

/** Multiples of u = widthPx / 2400. Sized to stay readable over dense streets once the photo is scaled down. */
export const labelStyle = { cityFont: 54, townFont: 44, pointFont: 36, markerRadius: 6, halo: 9, spacing: 140 };
/** Labels stay where every road class is still at full strength, inside the fade. */
const USABLE_RADIUS = 0.66;

type Box = { left: number; right: number; top: number; bottom: number };
const priority: Record<PlaceKind, number> = { city: 0, town: 1, peak: 2, landmark: 3, village: 4 };

export function layoutLabels(candidates: LabelCandidate[], options: {
  widthPx: number; heightPx: number; maxCount: number;
  measure: (text: string, fontPx: number) => number;
}): PlacedLabel[] {
  const { widthPx, heightPx, maxCount, measure } = options;
  const u = widthPx / 2400;
  const pad = 6 * u;
  const markerRadius = labelStyle.markerRadius * u;
  const cx = widthPx / 2;
  const cy = heightPx / 2;
  const usableRadius = Math.min(cx, cy) * USABLE_RADIUS;
  const spacing = labelStyle.spacing * u;
  const occupied: Box[] = [];
  const placed: PlacedLabel[] = [];
  const sorted = [...candidates].sort((a, b) => priority[a.kind] - priority[b.kind]
    || b.rank - a.rank || a.name.length - b.name.length);

  for (const point of sorted) {
    if (placed.length >= maxCount) break;
    const { name, x, y, kind } = point;
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
      const farX = Math.max(Math.abs(cx - box.left), Math.abs(cx - box.right));
      const farY = Math.max(Math.abs(cy - box.top), Math.abs(cy - box.bottom));
      if (Math.hypot(farX, farY) > usableRadius) continue;
      if (occupied.some(b => box.left - spacing < b.right && box.right + spacing > b.left
        && box.top - spacing < b.bottom && box.bottom + spacing > b.top)) continue;
      placed.push({ ...point, marker, fontPx, textX, textY: y });
      occupied.push(box);
      break;
    }
  }
  return placed;
}
