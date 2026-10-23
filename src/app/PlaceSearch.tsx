import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { LocationChoice, PlaceResult } from '../contracts.ts';
import { loadMajorIndex } from '../search/geoData.ts';
import { prepareIndex, search } from '../search/match.ts';
import type { SearchIndex } from '../search/match.ts';
import { featureNames, strings } from './strings.ts';

const emptyIndex = prepareIndex({ version: '', admin1: {}, places: [] });
const countryNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

function describe(place: PlaceResult): string {
  if (place.kind === 'coordinate') return strings.coordinateOrder;
  const type = place.kind === 'city' ? strings.city : featureNames[place.featureCode ?? ''] ?? strings.landmark;
  const country = place.countryCode ? countryNames.of(place.countryCode) : '';
  return [type, [place.admin1, country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
}

export function PlaceSearch({ location, onChange, prefetch, countryIndex }: {
  location: LocationChoice | null;
  onChange: (choice: LocationChoice) => void;
  prefetch: boolean;
  countryIndex?: SearchIndex;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [results, setResults] = useState<PlaceResult[]>([]);
  // The query the current results belong to; until it catches up, a search is still pending.
  const [resultsQuery, setResultsQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [composing, setComposing] = useState(false);
  const started = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const listId = `${id}-results`;

  const ensureLoaded = useCallback((retry = false) => {
    if (started.current && !retry) return;
    started.current = true;
    setStatus('loading');
    void loadMajorIndex().then(value => {
      setIndex(value);
      setStatus('ready');
    }, () => setStatus('error'));
  }, []);

  useEffect(() => { if (prefetch) ensureLoaded(); }, [prefetch, ensureLoaded]);

  useEffect(() => {
    // The photo's own position is shown below the box; keep the box free for a new search.
    setQuery(location?.source === 'search' ? location.place?.name ?? ''
      : location?.source === 'coordinate' ? strings.coordinates(...location.coordinate) : '');
    setOpen(false);
    setActive(-1);
  }, [location]);

  useEffect(() => {
    setResults([]);
    setActive(-1);
    if (composing) return;
    const timer = window.setTimeout(() => {
      setResults(search(countryIndex ? [countryIndex, index ?? emptyIndex] : index ?? emptyIndex, query));
      setResultsQuery(query);
      setActive(-1);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [query, index, countryIndex, composing]);

  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function select(place: PlaceResult) {
    onChange(place.kind === 'coordinate'
      ? { coordinate: place.coordinate, source: 'coordinate' }
      : { coordinate: place.coordinate, source: 'search', place });
    setQuery(place.kind === 'coordinate' ? strings.coordinates(...place.coordinate) : place.name);
    setOpen(false);
    setActive(-1);
  }

  const showResults = open && (query.trim() !== '' || status === 'loading' || status === 'error');
  const statusText = status === 'loading' ? strings.geoLoading
    : status === 'error' ? strings.geoFailed
    : results.length ? strings.resultsCount(results.length)
    : resultsQuery !== query ? ''
    : /^[a-z0-9]$/iu.test(query.trim()) ? strings.typeMore : strings.noResults;

  return <div className="place-search" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor={id} className="sr-only">{strings.searchLabel}</label>
    <input ref={input} id={id} type="text" role="combobox" value={query}
      aria-autocomplete="list" aria-expanded={showResults} aria-controls={showResults ? listId : undefined}
      aria-activedescendant={showResults && active >= 0 ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-hint`} autoComplete="off" spellCheck={false}
      placeholder={strings.searchPlaceholder}
      onFocus={() => { setOpen(true); ensureLoaded(); }}
      onChange={event => {
        setQuery(event.currentTarget.value);
        setResults([]);
        setActive(-1);
        setOpen(true);
        ensureLoaded();
      }}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing) return;
        if (event.key === 'Escape') { setOpen(false); setActive(-1); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true);
          if (!results.length) return;
          setActive(current => event.key === 'ArrowDown' ? (current + 1) % results.length
            : (current <= 0 ? results.length - 1 : current - 1));
        } else if (event.key === 'Enter' && showResults && results.length) {
          event.preventDefault();
          select(results[active >= 0 ? active : 0]!);
        }
      }} />
    <p id={`${id}-hint`} className="muted search-hint">{strings.coordinateHint}</p>
    {showResults && <div className="search-results">
      {statusText && <p role="status" className={results.length && status === 'ready' ? 'sr-only' : 'search-message'}>{statusText}</p>}
      {status === 'error' && <button type="button" className="secondary retry-search"
        onClick={() => { input.current?.focus(); ensureLoaded(true); }}>{strings.retry}</button>}
      <ul ref={list} id={listId} role="listbox" aria-label={strings.resultsLabel}>
        {results.map((place, position) => <li key={place.id ?? 'coordinate'} id={`${id}-option-${position}`}
          role="option" aria-selected={active === position} className="search-option"
          onPointerDown={event => event.preventDefault()}
          onClick={() => select(place)} onPointerMove={() => setActive(position)}>
          <span className="result-name">{place.name}
            {place.matchedName && <small>{place.matchedName}</small>}
          </span>
          <span className="result-description">{describe(place)}</span>
        </li>)}
      </ul>
    </div>}
  </div>;
}
