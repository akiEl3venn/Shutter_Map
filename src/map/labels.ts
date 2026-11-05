import type { LabelLanguage, LocationChoice, MapComposition, MapFocus, PlaceKind } from '../contracts.ts';
import { foldCjk } from '../search/normalize.ts';

const inLatinLetters = (name: string) => /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]+$/u.test(name);

const isChinese = (language: LabelLanguage) => language === 'zh' || language === 'zh-Hant';

/**
 * The name to show, if any: the place's name in this language, and where this language is spoken there, its own name.
 * Otherwise the name in Latin letters, English first (Shinjuku Golden Gai), then its own (Musée du Louvre). Someone who
 * reads Chinese or Japanese can still follow its own name in those scripts. Any other place is left off rather than
 * romanized here, which would need a dictionary: read as Chinese, 新宿 would come out as "Xinsu".
 */
export function selectLabelName(place: { name: string; names: Record<string, string | undefined> },
  language: LabelLanguage, spokenThere = false): string | undefined {
  const { name, names } = place;
  const found = names[language] ?? (spokenThere ? name : undefined)
    ?? [names.en, name].find(candidate => candidate && inLatinLetters(candidate))
    ?? (isChinese(language) || language === 'ja' ? name : undefined);
  // Only a Chinese reader wants simplified forms; Japanese keeps its own script (渋谷, not 涩谷).
  return found && language === 'zh' ? foldCjk(found) : found;
}

/** A chosen landmark's label where the map has none. Search data holds a Chinese name and a Latin one, and only a Chinese map wants the former. */
export function focusLabel(focus: MapFocus, language: LabelLanguage): string | undefined {
  return isChinese(language) ? focus.name : focus.englishName ?? focus.name;
}

/** Named areas, as opposed to the points of interest within them. */
export const isAreaName = (kind: PlaceKind) => kind === 'city' || kind === 'town' || kind === 'village';

export interface LabelCandidate {
  kind: PlaceKind;
  name: string;
  x: number;
  y: number;
  rank: number;
  /** The place's name in every language, to recognize it. */
  aliases?: string[];
  /** The one landmark to single out. */
  focus?: boolean;
}

/** What the map singles out, if anything: a chosen landmark, or wherever a photo was taken. */
export function focusFor(choice: LocationChoice | null): MapFocus | null {
  if (!choice) return null;
  if (choice.focus !== undefined) return choice.focus;
  if (choice.source === 'exif') return { coordinate: choice.coordinate };
  if (choice.source === 'search' && choice.place?.kind === 'landmark') {
    const { name, englishName } = choice.place;
    return { coordinate: choice.coordinate, name, ...(englishName ? { englishName } : {}) };
  }
  return null;
}

/** Search data and map labels come from different sources, so the same place can sit a little apart. */
const SAME_PLACE_METERS = 1000;
/** A photo is of a landmark only when taken right beside it. Further out, a guess would mark the wrong one. */
const PHOTOGRAPHED_METERS = 300;
const nameKey = (name: string) => foldCjk(name).toLowerCase();

/**
 * Marks the one candidate the map is about. A named focus that the map's labels do not include still gets a label of
 * its own, because the person asked for that place. An unnamed one marks the nearest landmark, or nothing.
 */
export function markFocus(candidates: LabelCandidate[], focus: { x: number; y: number; metersPerPx: number;
  name?: string; label?: string; englishName?: string; }): LabelCandidate[] {
  const wanted = [focus.name, focus.englishName].filter(name => name !== undefined).map(nameKey);
  const reach = (focus.name ? SAME_PLACE_METERS : PHOTOGRAPHED_METERS) / focus.metersPerPx;
  let match: LabelCandidate | undefined;
  let nearest = reach;
  for (const candidate of candidates) {
    if (isAreaName(candidate.kind)) continue;
    if (focus.name && !(candidate.aliases ?? [candidate.name]).some(alias => wanted.includes(nameKey(alias)))) continue;
    const distance = Math.hypot(candidate.x - focus.x, candidate.y - focus.y);
    if (distance <= nearest) {
      match = candidate;
      nearest = distance;
    }
  }
  if (match) return candidates.map(candidate => candidate === match ? { ...candidate, focus: true } : candidate);
  if (!focus.name) return candidates;
  return [...candidates, { kind: 'landmark', name: focus.label ?? focus.name, x: focus.x, y: focus.y, rank: 0, focus: true }];
}

export interface PlacedLabel extends LabelCandidate {
  fontPx: number;
  /** Left edge and vertical middle in source-image pixels, matching left/middle canvas text. */
  textX: number;
  textY: number;
  marker: boolean;
}

/** Multiples of u = scalePx / 2400. Cropping a rectangle preserves text size and spacing. */
export const labelStyle = { cityFont: 54, townFont: 44, pointFont: 36, markerRadius: 6, gap: 6, spacing: 140 };
/** Text stays inside the layer, where the roads are at full strength, and just clear of its edge. */
const LABEL_INSET = 8;

type Box = { left: number; right: number; top: number; bottom: number };
// Landmarks and peaks compete on fame alone, so Mont Blanc is not pushed out by a gorge nobody has heard of.
const priority: Record<PlaceKind, number> = { city: 0, town: 1, landmark: 2, peak: 2, village: 3 };

const FAME_PER_TRANSLATION = 1e6, FAME_PER_ZOOM = 1e4;
/** A landmark with no translations that the map only shows from z14 on: fine to include, if someone asks for more labels. */
const WELL_KNOWN = 2 * FAME_PER_ZOOM;
const DEFAULT_LABELS = 5;

/**
 * How well known a landmark or peak is, as one sortable number. The more languages name a place, the more famous it is:
 * Mont Blanc has twelve names, the peaks around it two at most. English-speaking places have few translations to go by,
 * so next comes how early the map shows it, and then a peak's height. A landmark wins a tie against a peak of any height.
 */
export function fame(translations: number, minZoom = 15, height?: number): number {
  return translations * FAME_PER_TRANSLATION + (15 - minZoom) * FAME_PER_ZOOM
    + (height === undefined ? FAME_PER_ZOOM - 1 : Math.max(0, Math.min(height, FAME_PER_ZOOM - 2)));
}

export function layoutLabels(candidates: LabelCandidate[], options: {
  shape: MapComposition['shape']; widthPx: number; heightPx: number; scalePx: number; rotationDegrees: number; maxCount: number;
  measure: (text: string, fontPx: number) => number;
}): PlacedLabel[] {
  const { widthPx, heightPx, maxCount, measure } = options;
  if (maxCount === 0) return [];
  // Mountains have far more named peaks than fit, so the best known stand for the rest. Asking for more labels allows more.
  const maxPeaks = Math.max(2, Math.ceil(maxCount * 0.4));
  const u = options.scalePx / 2400;
  const pad = 6 * u;
  const markerRadius = labelStyle.markerRadius * u;
  const cx = widthPx / 2;
  const cy = heightPx / 2;
  const angle = options.rotationDegrees * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const inset = LABEL_INSET * u;
  const containsCorner = options.shape === 'circle'
    ? (x: number, y: number) => Math.hypot(x - cx, y - cy) <= Math.min(cx, cy) - inset
    : (x: number, y: number) => x >= inset && x <= widthPx - inset && y >= inset && y <= heightPx - inset;
  const spacing = labelStyle.spacing * u;
  const occupied: Box[] = [];
  const placed: PlacedLabel[] = [];
  const sorted = [...candidates].sort((a, b) => Number(b.focus ?? false) - Number(a.focus ?? false)
    || priority[a.kind] - priority[b.kind] || b.rank - a.rank || a.name.length - b.name.length);

  for (const point of sorted) {
    if (placed.length >= maxCount) break;
    const { name, kind } = point;
    if (kind === 'peak' && placed.filter(p => p.kind === 'peak').length >= maxPeaks) continue;
    if (kind === 'landmark' && !point.focus && maxCount <= DEFAULT_LABELS && point.rank < WELL_KNOWN) continue;
    const dx = point.x - cx, dy = point.y - cy;
    // Anchors turn with the roads. Text, its collisions and the layer's edges all stay upright.
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
