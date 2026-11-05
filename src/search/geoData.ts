import { prepareIndexInChunks } from './match.ts';
import type { CountryData, MajorData, SearchIndex } from './match.ts';
import type { CountrySummary } from './cascade.ts';

export const GEO_DATA = 'geo-2026';
let majorIndex: Promise<SearchIndex> | undefined;
let countries: Promise<CountrySummary[]> | undefined;
const countryData = new Map<string, Promise<CountryData>>();

/** Only public static data is requested. Queries and coordinates stay in memory. */
export function loadMajorIndex(): Promise<SearchIndex> {
  majorIndex ??= (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}${GEO_DATA}/major.json`);
    if (!response.ok) throw new Error('geo-data-unavailable');
    const data: MajorData = await response.json();
    if (data.version !== GEO_DATA || !data.admin1 || !Array.isArray(data.places)) {
      throw new Error('geo-data-invalid');
    }
    return prepareIndexInChunks(data);
  })().catch(() => {
    majorIndex = undefined;
    throw new Error('geo-data-unavailable');
  });
  return majorIndex;
}

export function loadCountries(): Promise<CountrySummary[]> {
  countries ??= (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}${GEO_DATA}/countries.json`);
    if (!response.ok) throw new Error('geo-data-unavailable');
    const data = await response.json();
    if (data.version !== GEO_DATA || !Array.isArray(data.countries)) {
      throw new Error('geo-data-invalid');
    }
    return data.countries as CountrySummary[];
  })().catch(() => {
    countries = undefined;
    throw new Error('geo-data-unavailable');
  });
  return countries;
}

export function loadCountry(code: string): Promise<CountryData> {
  const cached = countryData.get(code);
  if (cached) return cached;
  const request = (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}${GEO_DATA}/country/${code}.json`);
    if (!response.ok) throw new Error('geo-data-unavailable');
    const data: CountryData = await response.json();
    if (data.version !== GEO_DATA || data.code !== code
      || !Array.isArray(data.admin1) || !Array.isArray(data.places)) {
      throw new Error('geo-data-invalid');
    }
    return data;
  })().catch(() => {
    countryData.delete(code);
    throw new Error('geo-data-unavailable');
  });
  countryData.set(code, request);
  return request;
}
