import type { PlaceResult } from '../contracts.ts';
import { parseCoordinates } from '../location/parseCoordinates.ts';
import { foldCjk, normalize } from './normalize.ts';

export type PlaceTuple = [id: number, name: string, zh: string, lat: number, lon: number,
  kind: string, cc: string, admin1: string, rank: number, alt: string[], cityId?: number];

type Admin1Map = Record<string, [string, string]>;

export interface MajorData {
  version: string;
  admin1: Admin1Map;
  places: PlaceTuple[];
}

export interface CountryData {
  version: string;
  code: string;
  admin1: [code: string, name: string, zh: string][];
  places: PlaceTuple[];
}

interface IndexedName {
  original: string;
  normalized: string;
  words: string[];
}

interface IndexedPlace {
  result: PlaceResult;
  rank: number;
  names: IndexedName[];
  /** All normalized names joined by a newline, which normalize() never emits. */
  haystack: string;
}

export interface SearchIndex {
  places: IndexedPlace[];
}

interface Hit {
  place: IndexedPlace;
  name: IndexedName;
  score: number;
}

export function admin1Map(data: MajorData | CountryData): Admin1Map {
  return 'code' in data
    ? Object.fromEntries(data.admin1.map(([code, name, zh]) => [`${data.code}.${code}`, [name, zh]]))
    : data.admin1;
}

/** Keep search results and cascade selections identical. */
export function tupleToPlaceResult(tuple: PlaceTuple, regions: Admin1Map): PlaceResult {
  const [id, name, zh, lat, lon, kind, cc, admin1] = tuple;
  const region = regions[`${cc}.${admin1}`];
  return {
    id,
    name: zh ? foldCjk(zh) : name,
    ...(zh ? { englishName: name } : {}),
    kind: kind === 'city' ? 'city' : 'landmark',
    ...(kind === 'city' ? {} : { featureCode: kind }),
    coordinate: [lon, lat],
    countryCode: cc,
    admin1Code: admin1,
    admin1: region ? (region[1] ? foldCjk(region[1]) : region[0]) : '',
  };
}

function preparePlace(tuple: PlaceTuple, regions: Admin1Map): IndexedPlace {
  const [, name, zh, , , , , , rank, alt] = tuple;
  const names = [...new Set([name, zh, ...alt])].filter(Boolean).map((original) => {
    const normalized = normalize(original);
    return { original, normalized, words: normalized.split(' ') };
  });
  return { result: tupleToPlaceResult(tuple, regions), rank, names, haystack: names.map((entry) => entry.normalized).join('\n') };
}

/** Normalize once at load time; queries never mutate or persist the index. */
export function prepareIndex(data: MajorData | CountryData): SearchIndex {
  const regions = admin1Map(data);
  return { places: data.places.map((tuple) => preparePlace(tuple, regions)) };
}

/** prepareIndex in chunks, yielding between them: a global index takes ~0.8 s and must not freeze the page. */
export async function prepareIndexInChunks(data: MajorData | CountryData, chunkSize = 4000): Promise<SearchIndex> {
  const regions = admin1Map(data);
  const places: IndexedPlace[] = [];
  for (let start = 0; start < data.places.length; start += chunkSize) {
    for (let i = start; i < Math.min(start + chunkSize, data.places.length); i += 1) places.push(preparePlace(data.places[i]!, regions));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { places };
}

/** Beyond this a photo is not really "in" a city: open sea, or a region the data does not cover. */
const NEAREST_CITY_KM = 50;

/**
 * The city a point belongs to, found locally so the coordinate never leaves the browser. Plain distance would name a
 * neighborhood inside Tokyo rather than Tokyo, so size counts too: a city's rank is 12·log10(population), which makes
 * this population / distance³. A place right next to the photo still beats a metropolis 20 km away.
 */
export function nearestCity(index: SearchIndex, [longitude, latitude]: readonly [number, number]): PlaceResult | null {
  const kmPerDegree = 111.32;
  const cos = Math.cos(latitude * Math.PI / 180);
  let best: PlaceResult | null = null;
  let bestScore = -Infinity;
  for (const { result, rank } of index.places) {
    if (result.kind !== 'city') continue;
    const dLon = (((result.coordinate[0] - longitude + 540) % 360) - 180) * cos * kmPerDegree;
    const dLat = (result.coordinate[1] - latitude) * kmPerDegree;
    const km = Math.hypot(dLon, dLat);
    if (km > NEAREST_CITY_KM) continue;
    const score = rank / 12 - 3 * Math.log10(Math.max(km, 1));
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }
  return best;
}

function matchScore(name: IndexedName, query: string, queryWords: string[]): number {
  if (name.normalized === query) return 5;
  if (name.normalized.startsWith(query)) return 4;
  if (queryWords.every((word) => name.words.some((candidate) => candidate.startsWith(word)))) return 3;
  return name.normalized.includes(query) ? 2 : 0;
}

/** At most one insertion, deletion or substitution; avoids an edit-distance matrix. */
function withinOneEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i += 1; j += 1; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) i += 1;
    if (right.length >= left.length) j += 1;
  }
  return edits + (i < left.length || j < right.length ? 1 : 0) <= 1;
}

const idSets = new WeakMap<SearchIndex, Set<number>>();

function idsOf(index: SearchIndex): Set<number> {
  let ids = idSets.get(index);
  if (!ids) {
    ids = new Set();
    for (const place of index.places) if (place.result.id !== undefined) ids.add(place.result.id);
    idSets.set(index, ids);
  }
  return ids;
}

/** Visits each place once; earlier indexes shadow later ones by id, without copying any index per query. */
function forEachPlace(indexes: SearchIndex[], visit: (place: IndexedPlace) => void): void {
  indexes.forEach((entry, position) => {
    const earlier = indexes.slice(0, position).map(idsOf);
    for (const place of entry.places) {
      const id = place.result.id;
      if (id !== undefined && earlier.some((ids) => ids.has(id))) continue;
      visit(place);
    }
  });
}

/** `accept` narrows results by kind, e.g. the region menu's city field asks for cities only. */
export function search(index: SearchIndex | SearchIndex[], query: string, limit = 10,
  accept: (result: PlaceResult) => boolean = () => true): PlaceResult[] {
  const count = Math.max(0, Math.floor(limit));
  if (!count) return [];
  const normalized = normalize(query);
  if (!normalized) return [];
  const parsed = parseCoordinates(query);
  const coordinate: PlaceResult | null = parsed.ok ? {
    kind: 'coordinate',
    name: `使用坐标 ${parsed.value[1].toFixed(6)}, ${parsed.value[0].toFixed(6)}`,
    coordinate: parsed.value,
  } : null;
  const coordinateResults = coordinate && accept(coordinate) ? [coordinate] : [];
  // A lone Latin letter or digit matches most of the index (~90 ms globally) and says nothing; one Han character can.
  if (/^[a-z0-9]$/u.test(normalized)) return coordinateResults;
  const queryWords = normalized.split(' ');
  const indexes = Array.isArray(index) ? index : [index];
  const hits: Hit[] = [];
  const matched = new Set<IndexedPlace>();
  forEachPlace(indexes, (place) => {
    if (!accept(place.result)) return;
    // Every tier needs each query word somewhere in the names; one native scan rejects most places.
    for (const word of queryWords) if (!place.haystack.includes(word)) return;
    let best: Hit | undefined;
    for (const name of place.names) {
      const score = matchScore(name, normalized, queryWords);
      if (score && (!best || score > best.score || (score === best.score && name.normalized.length < best.name.normalized.length))) {
        best = { place, name, score };
      }
    }
    if (best) { hits.push(best); matched.add(place); }
  });
  if (hits.length + coordinateResults.length < count && /^[a-z]{4,}$/u.test(normalized)) {
    // One edit cannot break both ends: the first/last two letters of a 4+ letter query, or three letters from 6.
    const width = normalized.length >= 6 ? 3 : 2;
    const head = normalized.slice(0, width);
    const tail = normalized.slice(-width);
    forEachPlace(indexes, (place) => {
      if (matched.has(place) || !accept(place.result) || !(place.haystack.includes(head) || place.haystack.includes(tail))) return;
      const name = place.names.find((candidate) => candidate.words.some((word) =>
        Math.abs(word.length - normalized.length) <= 1 && withinOneEdit(word, normalized)));
      if (name) hits.push({ place, name, score: 1 });
    });
  }
  hits.sort((a, b) => b.score - a.score || b.place.rank - a.place.rank || a.name.normalized.length - b.name.normalized.length);
  return coordinateResults.concat(hits.slice(0, count - coordinateResults.length).map(({ place, name }) => ({
    ...place.result,
    ...(foldCjk(name.original) === place.result.name ? {} : { matchedName: name.original }),
  })));
}
