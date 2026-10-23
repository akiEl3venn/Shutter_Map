import { useCallback, useMemo, useRef, useState } from 'react';
import type { PlaceResult } from '../contracts.ts';
import { admin1Options, cityOptions, continentOptions, countryOptions, landmarkOptions, pathForPlace, placeResult } from '../search/cascade.ts';
import type { CountrySummary, Option, RegionSelection } from '../search/cascade.ts';
import { loadMajorIndex } from '../search/geoData.ts';
import { search } from '../search/match.ts';
import type { CountryData, SearchIndex } from '../search/match.ts';
import { FilterCombobox } from './FilterCombobox.tsx';
import { strings } from './strings.ts';

export type RegionLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

const countryNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

export function RegionCascade({ countries, country, region, countriesStatus, countryStatus, onChange, onPickPlace, onRetry }: {
  countries: CountrySummary[];
  country?: CountryData;
  region: RegionSelection;
  countriesStatus: RegionLoadStatus;
  countryStatus: RegionLoadStatus;
  onChange: (region: RegionSelection, place?: PlaceResult) => void;
  /** A city found without a country; the caller fills continent, country and province from it. */
  onPickPlace: (place: PlaceResult) => void;
  onRetry: () => void;
}) {
  const options = useMemo(() => ({
    continents: continentOptions(countries),
    countries: countryOptions(countries, region.continent),
    admin1: country ? admin1Options(country) : [],
    // Cities and landmarks span the whole country until a province narrows them: people often know a city, not its province.
    cities: country ? cityOptions(country, region.admin1) : [],
    landmarks: country ? landmarkOptions(country, region.admin1, region.cityId) : [],
  }), [countries, country, region.continent, region.admin1, region.cityId]);
  const busy = countryStatus === 'loading';

  // Without a country, the city field searches every city in the global index.
  const [globalIndex, setGlobalIndex] = useState<SearchIndex | null>(null);
  const [globalStatus, setGlobalStatus] = useState<RegionLoadStatus>('idle');
  const globalHits = useRef(new Map<string, PlaceResult>());
  const anywhere = !region.country;

  const loadGlobal = useCallback(() => {
    if (globalStatus === 'loading' || globalStatus === 'ready') return;
    setGlobalStatus('loading');
    void loadMajorIndex().then(index => {
      setGlobalIndex(index);
      setGlobalStatus('ready');
    }, () => setGlobalStatus('error'));
  }, [globalStatus]);

  const searchCities = useCallback((query: string): Option[] => {
    if (!globalIndex || !query.trim()) return [];
    const results = search(globalIndex, query, 20, result => result.kind === 'city');
    globalHits.current = new Map(results.map(result => [String(result.id), result]));
    return results.map(result => ({
      value: String(result.id),
      label: result.name,
      description: [result.matchedName, [result.admin1, result.countryCode && countryNames.of(result.countryCode)]
        .filter(Boolean).join(', ')].filter(Boolean).join(' · '),
      keywords: [],
    }));
  }, [globalIndex]);

  const cityEmptyText = useCallback((query: string) => globalStatus === 'error' ? strings.geoFailed
    : !globalIndex ? strings.geoLoading
    : query.trim() ? strings.noRegionOptions : strings.typeCityName, [globalIndex, globalStatus]);

  function selectPlace(value: string | null, level: 'city' | 'landmark') {
    const id = value === null ? undefined : Number(value);
    const tuple = id === undefined ? undefined : country?.places.find(place => place[0] === id);
    const path = tuple && country ? pathForPlace(country, tuple[0]) : null;
    const next = level === 'city'
      ? { continent: region.continent, country: region.country, admin1: path?.admin1 ?? region.admin1, cityId: id }
      : { ...region, ...path, landmarkId: id };
    onChange(next, tuple && country ? placeResult(tuple, country) : undefined);
  }

  return <div className="region-cascade" role="group" aria-label={strings.browseRegions}>
    <h3>{strings.browseRegions}</h3>
    <FilterCombobox label={strings.continent} options={options.continents} value={region.continent ?? null}
      placeholder={strings.allContinents} loading={countriesStatus === 'loading'}
      onChange={value => onChange({ continent: value ?? undefined })} />
    <FilterCombobox label={strings.country} options={options.countries} value={region.country ?? null}
      placeholder={strings.chooseCountry} loading={countriesStatus === 'loading'}
      onChange={value => onChange({
        // Choosing a country fills in its continent, like every other level fills in the ones above it.
        continent: value ? countries.find(item => item.code === value)?.continent : region.continent,
        country: value ?? undefined,
      })} />
    <FilterCombobox label={strings.admin1} options={options.admin1} value={region.admin1 ?? null}
      placeholder={region.country ? strings.chooseAdmin1 : strings.countryRequired}
      disabled={!country} loading={busy}
      onChange={value => onChange({ continent: region.continent, country: region.country, admin1: value ?? undefined })} />
    <FilterCombobox label={strings.city} options={options.cities} value={region.cityId?.toString() ?? null}
      placeholder={anywhere ? strings.cityAnywhere : strings.chooseCity} loading={busy}
      search={anywhere ? searchCities : undefined} emptyText={anywhere ? cityEmptyText : undefined}
      onOpen={anywhere ? loadGlobal : undefined}
      onChange={value => {
        if (!anywhere) selectPlace(value, 'city');
        else if (value !== null) {
          const place = globalHits.current.get(value);
          if (place) onPickPlace(place);
        }
      }} />
    <FilterCombobox label={strings.landmark} options={options.landmarks} value={region.landmarkId?.toString() ?? null}
      placeholder={country ? strings.chooseLandmark : strings.landmarkNeedsCountry}
      disabled={!country} loading={busy} onChange={value => selectPlace(value, 'landmark')} />
    {(countriesStatus === 'error' || countryStatus === 'error') && <div className="region-error">
      <p className="error" role="alert">{strings.regionFailed}</p>
      <button type="button" className="secondary" onClick={onRetry}>{strings.retry}</button>
    </div>}
  </div>;
}
