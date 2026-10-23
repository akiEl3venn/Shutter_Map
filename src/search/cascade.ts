import type { PlaceResult } from '../contracts.ts';
import { continentNames, featureNames, strings } from '../app/strings.ts';
import { admin1Map, tupleToPlaceResult, type CountryData, type PlaceTuple } from './match.ts';
import { foldCjk, normalize } from './normalize.ts';

export interface CountrySummary {
  code: string;
  continent: string;
  name: string;
  file: string;
}

export interface RegionSelection {
  continent?: string;
  country?: string;
  admin1?: string;
  cityId?: number;
  landmarkId?: number;
}

export interface Option {
  value: string;
  label: string;
  description?: string;
  keywords: string[];
}

const collator = new Intl.Collator('zh-CN');
const countryNames = new Intl.DisplayNames(['zh-CN'], { type: 'region', fallback: 'none' });
const continentOrder = ['AS', 'EU', 'NA', 'SA', 'AF', 'OC', 'AN'];
const otherRegion = '__other__';

export function continentOptions(countries: CountrySummary[]): Option[] {
  const available = new Set(countries.map((country) => country.continent));
  return continentOrder.filter((code) => available.has(code)).map((code) => ({
    value: code,
    label: continentNames[code] ?? code,
    keywords: [continentNames[code] ?? code, code],
  }));
}

export function countryOptions(countries: CountrySummary[], continent?: string): Option[] {
  return countries.filter((country) => !continent || country.continent === continent).map((country) => {
    const label = countryNames.of(country.code) || country.name;
    return { value: country.code, label, keywords: [label, country.name, country.code] };
  }).sort((left, right) => collator.compare(left.label, right.label));
}

export function admin1Options(country: CountryData): Option[] {
  const options: Option[] = country.admin1.map(([code, name, zh]) => ({
    value: code,
    label: zh ? foldCjk(zh) : name,
    keywords: [name, zh, code],
  })).sort((left, right) => collator.compare(left.label, right.label));
  const known = new Set(country.admin1.map(([code]) => code));
  if (country.places.some((place) => !known.has(place[7]))) {
    options.push({ value: otherRegion, label: strings.otherRegion, keywords: [strings.otherRegion] });
  }
  return options;
}

function placesInRegion(country: CountryData, admin1: string): PlaceTuple[] {
  const known = new Set(country.admin1.map(([code]) => code));
  return country.places.filter((place) => admin1 === otherRegion ? !known.has(place[7]) : place[7] === admin1);
}

function placeOption(tuple: PlaceTuple): Option {
  return {
    value: String(tuple[0]),
    label: tuple[2] ? foldCjk(tuple[2]) : tuple[1],
    keywords: [tuple[1], tuple[2], ...tuple[9]].filter(Boolean),
  };
}

export function cityOptions(country: CountryData, admin1: string): Option[] {
  const options = placesInRegion(country, admin1).filter((place) => place[5] === 'city')
    .sort((left, right) => right[8] - left[8]).map(placeOption);
  const labelCounts = new Map<string, number>();
  for (const option of options) labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
  return options.map((option) => labelCounts.get(option.label)! > 1 ? {
    ...option,
    description: option.keywords.find((name) => foldCjk(name) !== option.label),
  } : option);
}

export function landmarkOptions(country: CountryData, admin1: string, cityId?: number): Option[] {
  return placesInRegion(country, admin1)
    .filter((place) => place[5] !== 'city' && (cityId === undefined || place[10] === cityId))
    .sort((left, right) => right[8] - left[8])
    .map((tuple) => ({ ...placeOption(tuple), description: featureNames[tuple[5]] ?? strings.landmark }));
}

export function filterOptions(options: Option[], query: string, limit = 200): {
  options: Option[]; truncated: boolean; remaining: number;
} {
  const normalized = normalize(query);
  const matches = normalized
    ? options.filter((option) => option.keywords.some((keyword) => normalize(keyword).includes(normalized)))
    : options;
  const count = Math.max(0, Math.floor(limit));
  return {
    options: matches.slice(0, count),
    truncated: matches.length > count,
    remaining: Math.max(0, matches.length - count),
  };
}

export function pathForPlace(country: CountryData, placeId: number): { admin1: string; cityId?: number; landmarkId?: number } | null {
  const known = new Set(country.admin1.map(([code]) => code));
  const regionOf = (place: PlaceTuple) => known.has(place[7]) ? place[7] : otherRegion;
  const tuple = country.places.find((place) => place[0] === placeId);
  if (!tuple) return null;
  const admin1 = regionOf(tuple);
  if (tuple[5] === 'city') return { admin1, cityId: tuple[0] };
  // A landmark's nearest city can lie in another region (Mount Fuji under "other"); the city menu
  // could not show it, so carrying it would silently narrow the landmark list.
  const city = tuple[10] ? country.places.find((place) => place[0] === tuple[10]) : undefined;
  return { admin1, ...(city && regionOf(city) === admin1 ? { cityId: city[0] } : {}), landmarkId: tuple[0] };
}

export function placeResult(tuple: PlaceTuple, country: CountryData): PlaceResult {
  return tupleToPlaceResult(tuple, admin1Map(country));
}
