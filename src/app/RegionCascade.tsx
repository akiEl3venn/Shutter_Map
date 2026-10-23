import { useMemo } from 'react';
import type { PlaceResult } from '../contracts.ts';
import { admin1Options, cityOptions, continentOptions, countryOptions, landmarkOptions, pathForPlace, placeResult } from '../search/cascade.ts';
import type { CountrySummary, RegionSelection } from '../search/cascade.ts';
import type { CountryData } from '../search/match.ts';
import { FilterCombobox } from './FilterCombobox.tsx';
import { strings } from './strings.ts';

export type RegionLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export function RegionCascade({ countries, country, region, countriesStatus, countryStatus, onChange, onRetry }: {
  countries: CountrySummary[];
  country?: CountryData;
  region: RegionSelection;
  countriesStatus: RegionLoadStatus;
  countryStatus: RegionLoadStatus;
  onChange: (region: RegionSelection, place?: PlaceResult) => void;
  onRetry: () => void;
}) {
  const options = useMemo(() => ({
    continents: continentOptions(countries),
    countries: countryOptions(countries, region.continent),
    admin1: country ? admin1Options(country) : [],
    cities: country && region.admin1 ? cityOptions(country, region.admin1) : [],
    landmarks: country && region.admin1 ? landmarkOptions(country, region.admin1, region.cityId) : [],
  }), [countries, country, region.continent, region.admin1, region.cityId]);
  const busy = countryStatus === 'loading';

  function selectPlace(value: string | null, level: 'city' | 'landmark') {
    const id = value === null ? undefined : Number(value);
    const tuple = id === undefined ? undefined : country?.places.find(place => place[0] === id);
    const next = level === 'city'
      ? { continent: region.continent, country: region.country, admin1: region.admin1, cityId: id }
      : { ...region, ...(tuple && country ? pathForPlace(country, tuple[0]) : null), landmarkId: id };
    onChange(next, tuple && country ? placeResult(tuple, country) : undefined);
  }

  return <div className="region-cascade" role="group" aria-label={strings.browseRegions}>
    <h3>{strings.browseRegions}</h3>
    <FilterCombobox label={strings.continent} options={options.continents} value={region.continent ?? null}
      placeholder={strings.allContinents} loading={countriesStatus === 'loading'}
      onChange={value => onChange({ continent: value ?? undefined })} />
    <FilterCombobox label={strings.country} options={options.countries} value={region.country ?? null}
      placeholder={strings.chooseCountry} loading={countriesStatus === 'loading'}
      onChange={value => onChange({ continent: region.continent, country: value ?? undefined })} />
    <FilterCombobox label={strings.admin1} options={options.admin1} value={region.admin1 ?? null}
      placeholder={region.country ? strings.chooseAdmin1 : strings.countryRequired}
      disabled={!country} loading={busy}
      onChange={value => onChange({ continent: region.continent, country: region.country, admin1: value ?? undefined })} />
    <FilterCombobox label={strings.city} options={options.cities} value={region.cityId?.toString() ?? null}
      placeholder={region.admin1 ? strings.chooseCity : strings.admin1Required}
      disabled={!country || !region.admin1} loading={busy} onChange={value => selectPlace(value, 'city')} />
    <FilterCombobox label={strings.landmark} options={options.landmarks} value={region.landmarkId?.toString() ?? null}
      placeholder={region.admin1 ? strings.chooseLandmark : strings.admin1Required}
      disabled={!country || !region.admin1} loading={busy} onChange={value => selectPlace(value, 'landmark')} />
    {(countriesStatus === 'error' || countryStatus === 'error') && <div className="region-error">
      <p className="error" role="alert">{strings.regionFailed}</p>
      <button type="button" className="secondary" onClick={onRetry}>{strings.retry}</button>
    </div>}
  </div>;
}
