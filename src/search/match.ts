import type { PlaceResult } from '../contracts.ts';
import { parseCoordinates } from '../location/parseCoordinates.ts';
import { foldCjk, normalize } from './normalize.ts';

export type PlaceTuple = [id: number, name: string, zh: string, lat: number, lon: number,
  kind: string, cc: string, admin1: string, rank: number, alt: string[]];

export interface MajorData {
  version: string;
  admin1: Record<string, [string, string]>;
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
}

export interface SearchIndex {
  places: IndexedPlace[];
}

interface Hit {
  place: IndexedPlace;
  name: IndexedName;
  score: number;
}

/** Normalize once at load time; queries never mutate or persist the index. */
export function prepareIndex(data: MajorData): SearchIndex {
  return { places: data.places.map(([id, name, zh, lat, lon, kind, cc, admin1, rank, alt]) => {
    const region = data.admin1[`${cc}.${admin1}`];
    return {
      result: {
        id,
        name: zh ? foldCjk(zh) : name,
        kind: kind === 'city' ? 'city' : 'landmark',
        ...(kind === 'city' ? {} : { featureCode: kind }),
        coordinate: [lon, lat],
        countryCode: cc,
        admin1: region ? (region[1] ? foldCjk(region[1]) : region[0]) : '',
      },
      rank,
      names: [...new Set([name, zh, ...alt])].filter(Boolean).map((original) => {
        const normalized = normalize(original);
        return { original, normalized, words: normalized.split(' ') };
      }),
    };
  }) };
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

export function search(index: SearchIndex, query: string, limit = 10): PlaceResult[] {
  const count = Math.max(0, Math.floor(limit));
  if (!count) return [];
  const normalized = normalize(query);
  if (!normalized) return [];
  const parsed = parseCoordinates(query);
  const coordinateResults: PlaceResult[] = parsed.ok ? [{
    kind: 'coordinate',
    name: `使用坐标 ${parsed.value[1].toFixed(6)}, ${parsed.value[0].toFixed(6)}`,
    coordinate: parsed.value,
  }] : [];
  const queryWords = normalized.split(' ');
  const hits: Hit[] = [];
  const matched = new Set<IndexedPlace>();
  for (const place of index.places) {
    let best: Hit | undefined;
    for (const name of place.names) {
      const score = matchScore(name, normalized, queryWords);
      if (score && (!best || score > best.score || (score === best.score && name.normalized.length < best.name.normalized.length))) {
        best = { place, name, score };
      }
    }
    if (best) { hits.push(best); matched.add(place); }
  }
  if (hits.length + coordinateResults.length < count && /^[a-z]{4,}$/u.test(normalized)) {
    for (const place of index.places) {
      if (matched.has(place)) continue;
      const name = place.names.find((candidate) => candidate.words.some((word) =>
        Math.abs(word.length - normalized.length) <= 1 && withinOneEdit(word, normalized)));
      if (name) hits.push({ place, name, score: 1 });
    }
  }
  hits.sort((a, b) => b.score - a.score || b.place.rank - a.place.rank || a.name.normalized.length - b.name.normalized.length);
  return coordinateResults.concat(hits.slice(0, count - coordinateResults.length).map(({ place, name }) => ({
    ...place.result,
    ...(foldCjk(name.original) === place.result.name ? {} : { matchedName: name.original }),
  })));
}
