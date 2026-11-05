import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { LocationChoice, LonLat, PhotoSession } from '../contracts.ts';
import { toLonLat } from '../location/gps.ts';
import { readExif } from '../photo/exif.ts';
import { loadPhoto } from '../photo/loadPhoto.ts';
import { strings } from './strings.ts';
import { PlaceSearch } from './PlaceSearch.tsx';
import { RegionCascade } from './RegionCascade.tsx';
import type { RegionLoadStatus } from './RegionCascade.tsx';
import { loadCountries, loadCountry, loadMajorIndex } from '../search/geoData.ts';
import { pathForPlace } from '../search/cascade.ts';
import type { CountrySummary, RegionSelection } from '../search/cascade.ts';
import { nearestCity, prepareIndexInChunks } from '../search/match.ts';
import type { CountryData, SearchIndex } from '../search/match.ts';
import { PhotoCanvas } from './PhotoCanvas.tsx';
import { EditPanel } from './EditPanel.tsx';
import { useComposition } from './useComposition.ts';
import { focusFor } from '../map/labels.ts';
import { useMapPreview } from './useMapPreview.ts';
import { exportFormats, type ExportFormat } from '../export/formats.ts';
import { useExport } from './useExport.ts';

export function App() {
  const [photo, setPhoto] = useState<PhotoSession | null>(null);
  const [location, setLocation] = useState<LocationChoice | null>(null);
  const [region, setRegion] = useState<RegionSelection>({});
  const [countries, setCountries] = useState<CountrySummary[]>([]);
  const [countriesStatus, setCountriesStatus] = useState<RegionLoadStatus>('loading');
  const [countriesRetry, setCountriesRetry] = useState(0);
  const [loadedCountries, setLoadedCountries] = useState<Record<string, { data: CountryData; index: SearchIndex }>>({});
  const [countryRequest, setCountryRequest] = useState<{ code?: string; status: RegionLoadStatus }>({ status: 'idle' });
  const [countryRetry, setCountryRetry] = useState(0);
  const [pendingPlace, setPendingPlace] = useState<{ country: string; id: number } | null>(null);
  const [pendingNearest, setPendingNearest] = useState<{ country: string; coordinate: LonLat } | null>(null);
  const regionSync = useRef(0);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>(strings.loading);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ImageBitmap | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const dragDepth = useRef(0);
  const { editor, drawn, edit } = useComposition(photo, location);
  const map = useMapPreview(photo, preview, drawn);
  const exporter = useExport(photo, drawn, map.exportLayer);
  const busy = exporter.state.status === 'decoding' || exporter.state.status === 'encoding';

  // Release a bitmap only after React has committed its replacement, so no draw can see it closed.
  useEffect(() => () => preview?.close(), [preview]);
  useEffect(() => () => { requestId.current += 1; }, []);

  const selectedCountry = region.country ? loadedCountries[region.country] : undefined;
  const countryStatus: RegionLoadStatus = !region.country ? 'idle' : selectedCountry ? 'ready'
    : countryRequest.code === region.country && countryRequest.status === 'error' ? 'error' : 'loading';

  useEffect(() => {
    let cancelled = false;
    setCountriesStatus('loading');
    void loadCountries().then(value => {
      if (cancelled) return;
      setCountries(value);
      setCountriesStatus('ready');
    }, () => { if (!cancelled) setCountriesStatus('error'); });
    return () => { cancelled = true; };
  }, [countriesRetry]);

  useEffect(() => {
    const code = region.country;
    if (!code || selectedCountry) return;
    let cancelled = false;
    setCountryRequest({ code, status: 'loading' });
    void loadCountry(code).then(async data => {
      if (cancelled) return;
      const index = await prepareIndexInChunks(data);
      if (cancelled) return;
      setLoadedCountries(current => ({ ...current, [code]: { data, index } }));
    }, () => { if (!cancelled) setCountryRequest({ code, status: 'error' }); });
    return () => { cancelled = true; };
  }, [region.country, selectedCountry, countryRetry]);

  useEffect(() => {
    if (!pendingPlace || !selectedCountry || countriesStatus !== 'ready') return;
    const path = pathForPlace(selectedCountry.data, pendingPlace.id);
    const continent = countries.find(country => country.code === pendingPlace.country)?.continent;
    setRegion(current => {
      if (current.country !== pendingPlace.country) return current;
      const next = { continent, country: pendingPlace.country, ...path };
      return current.continent === next.continent && current.admin1 === next.admin1
        && current.cityId === next.cityId && current.landmarkId === next.landmarkId ? current : next;
    });
    setPendingPlace(null);
  }, [pendingPlace, selectedCountry, countries, countriesStatus]);

  // The major index only tells which country to open. Its file then has the smaller towns too.
  useEffect(() => {
    if (!pendingNearest || !selectedCountry || selectedCountry.data.code !== pendingNearest.country) return;
    const city = nearestCity(selectedCountry.index, pendingNearest.coordinate);
    const { country } = pendingNearest;
    setPendingNearest(null);
    setRegion(current => current.country === country
      ? { ...current, continent: countries.find(item => item.code === country)?.continent } : current);
    if (city?.id !== undefined) setPendingPlace({ country, id: city.id });
  }, [pendingNearest, selectedCountry, countries]);

  function stopRegionSync() {
    regionSync.current += 1;
    setPendingNearest(null);
  }

  /** Fill the menus from a photo's own position, without touching the location itself. */
  function syncRegionTo(coordinate: LonLat) {
    const id = ++regionSync.current;
    void loadMajorIndex().then(index => {
      if (id !== regionSync.current) return;
      const city = nearestCity(index, coordinate);
      if (!city?.countryCode) return;
      setRegion({ country: city.countryCode });
      setPendingNearest({ country: city.countryCode, coordinate });
    }, () => {}); // The menus simply stay empty; the search box reports its own loading errors.
  }

  function chooseLocation(choice: LocationChoice) {
    stopRegionSync();
    setLocation(choice);
    if (choice.source === 'exif') {
      setPendingPlace(null);
      setRegion({});
      syncRegionTo(choice.coordinate);
      return;
    }
    const place = choice.source === 'search' ? choice.place : undefined;
    if (place?.id !== undefined && place.countryCode) {
      const country = place.countryCode;
      const cached = loadedCountries[country];
      setRegion(current => {
        if (current.country === country && (place.kind === 'city'
          ? current.cityId === place.id && !current.landmarkId : current.landmarkId === place.id)) return current;
        return { continent: countries.find(item => item.code === country)?.continent, country,
          ...(cached ? pathForPlace(cached.data, place.id!) : null) };
      });
      setPendingPlace({ country, id: place.id });
    } else {
      setPendingPlace(null);
      setRegion(current => ({ continent: current.continent, country: current.country, admin1: current.admin1 }));
    }
  }

  async function selectPhoto(file: File) {
    exporter.reset(); // Stop a pending download immediately, even if the replacement is slow to decode.
    const id = ++requestId.current;
    setLoading(true);
    setLoadingMessage(strings.loading);
    setError(null);
    try {
      const exif = await readExif(file);
      if (id !== requestId.current) return;
      const decoded = await loadPhoto(file, exif.orientation, format => {
        if (id === requestId.current) setLoadingMessage(strings.decoding(format));
      });
      if (id !== requestId.current) {
        decoded.preview.close();
        return;
      }
      const exifLocation = toLonLat(exif.gps);
      setPreview(decoded.preview);
      setPhoto({
        file,
        exifOrientation: exif.orientation,
        sourceFormat: decoded.format,
        orientedWidthPx: decoded.orientedWidthPx,
        orientedHeightPx: decoded.orientedHeightPx,
        exifLocation,
      });
      if (exifLocation) chooseLocation({ coordinate: exifLocation, source: 'exif' });
      else if (location?.source === 'exif') {
        stopRegionSync();
        setPendingPlace(null);
        setRegion({});
        setLocation(null);
      }
    } catch (failure) {
      if (id !== requestId.current) return;
      const code = typeof failure === 'object' && failure !== null && 'code' in failure ? failure.code : null;
      setError(code === 'raw-unsupported' ? strings.rawUnsupported
        : code === 'unsupported-format' ? strings.unsupportedFormat : strings.loadFailed);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void selectPhoto(file);
  }

  const canRestore = photo?.exifLocation && (!location
    || photo.exifLocation[0] !== location.coordinate[0]
    || photo.exifLocation[1] !== location.coordinate[1]);
  return (
    <main className="app"
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={handleDrop}>
      <header className="page-header">
        <div><h1>{strings.title}</h1><p>{strings.introduction}</p></div>
        <p className="privacy-note">{strings.localOnly}</p>
      </header>
      <input ref={inputRef} className="file-input" type="file"
        accept="image/*,.jpg,.jpeg,.jfif,.png,.gif,.bmp,.webp,.avif,.heic,.heif,.hif,.tif,.tiff,.jxl" tabIndex={-1}
        aria-label={strings.selectPhoto}
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void selectPhoto(file);
        }} />
      <div className="workspace" aria-busy={loading}>
        <div className="stage">
          <section className="preview-area" aria-label={strings.previewLabel}>
            <PhotoCanvas preview={preview} photo={photo} overlay={map.overlay} composition={editor?.composition ?? null} drawn={drawn}
              edit={edit} choosePoint={coordinate => chooseLocation({ source: 'coordinate', coordinate, focus: focusFor(location) })} />
            {!photo && <div className="empty-preview">
              <button type="button" onClick={() => inputRef.current?.click()}>{strings.selectPhoto}</button>
              <p>{strings.dropHint}</p><p className="muted">{strings.formatHint}</p>
            </div>}
          </section>
          {photo && <section className="export-panel" aria-label={strings.exportTitle}>
            <div className="export-controls">
              <label>{strings.exportFormat}
                <select value={exporter.format} disabled={busy}
                  onChange={event => exporter.chooseFormat(event.currentTarget.value as ExportFormat)}>
                  {Object.entries(exportFormats).map(([key, details]) =>
                    <option key={key} value={key}>{details.label}</option>)}
                </select>
              </label>
              <button type="button" disabled={loading || !map.ready || busy}
                onClick={() => void exporter.start()}>{strings.exportAction}</button>
              {editor && <button type="button" className="secondary"
                onClick={() => document.getElementById('edit-panel')?.scrollIntoView({ behavior: 'smooth' })}>{strings.editJump}</button>}
              <p role="status">{exporter.state.status === 'decoding' ? strings.exportDecoding
                : exporter.state.status === 'encoding' ? strings.exportEncoding
                : exporter.state.status === 'done' ? strings.exportDone(exporter.state.width, exporter.state.height, exporter.state.bytes)
                : exporter.state.status === 'idle' && !map.ready && !map.rendering
                  // The status in the sidebar can be scrolled out of sight, so say why here, by the button that is off.
                  ? map.progress && map.progress.empty === map.progress.total ? strings.mapNoData : strings.exportWaiting
                : ''}</p>
            </div>
            {exporter.state.status === 'failed' && <p className="error" role="alert">{strings.exportFailed}</p>}
            {!exportFormats[exporter.format].alpha && <p className="muted">{strings.exportNoAlpha}</p>}
            {exporter.format === 'gif' && <p className="muted">{strings.exportGifNote}</p>}
            {photo.sourceFormat === 'heic' && <p className="muted">{strings.exportHeicUnavailable}</p>}
            <p className="muted">{strings.exportNote}</p>
          </section>}
          <footer className="stage-footer">
            <p>{strings.geoAttribution}</p>
            <p>{strings.mapAttribution}</p>
            <p>{strings.exportCredit}</p>
          </footer>
        </div>
        <aside className="sidebar">
          <section>
            <h2>{strings.photoInformation}</h2>
            {photo ? <>
              <dl><dt>{strings.sourceDimensions}</dt>
                <dd className="dimensions">{strings.dimensions(photo.orientedWidthPx, photo.orientedHeightPx)}</dd>
              </dl>
              <button type="button" className="secondary" onClick={() => inputRef.current?.click()}>{strings.replacePhoto}</button>
            </> : <p className="muted">{strings.noPhotoInformation}</p>}
          </section>
          <section>
            <h2>{strings.location}</h2>
            <PlaceSearch location={location} onChange={chooseLocation}
              countryIndex={selectedCountry?.index} prefetch={photo !== null && photo.exifLocation === null} />
            <RegionCascade countries={countries} country={selectedCountry?.data} region={region}
              countriesStatus={countriesStatus} countryStatus={countryStatus}
              onChange={(next, place) => {
                // Explicit menu changes cancel any older search backfill, including in-flight loads.
                stopRegionSync();
                setPendingPlace(null);
                setRegion(next);
                if (place) setLocation({ source: 'search', coordinate: place.coordinate, place });
              }}
              onPickPlace={place => chooseLocation({ coordinate: place.coordinate, source: 'search', place })}
              onRetry={() => {
                if (countriesStatus === 'error') setCountriesRetry(value => value + 1);
                if (countryStatus === 'error') setCountryRetry(value => value + 1);
              }} />
            {location ? <>
              <p className="source-label">{location.source === 'exif' ? strings.exifSource
                : location.source === 'search' ? strings.searchSource(location.place?.name ?? '')
                : strings.coordinateSource}</p>
              <p className="coordinates">{strings.coordinates(location.coordinate[0], location.coordinate[1])}</p>
              <p className="muted">{strings.coordinateOrder}</p>
              <p className="location-note">{strings.locationNote}</p>
            </> : <p>{strings.noLocation}</p>}
            {canRestore && <button type="button" className="secondary restore-location"
              onClick={() => chooseLocation({ coordinate: photo.exifLocation!, source: 'exif' })}>
              {strings.restorePhotoLocation}
            </button>}
            <div className="map-data">
              <p role="status" aria-live="polite">
                {map.crashed ? null
                  : map.rendering && (!map.progress || map.progress.loaded < map.progress.total)
                    ? (map.progress ? strings.mapProgress(map.progress.loaded, map.progress.total) : strings.mapStarting)
                  : !map.progress ? strings.mapWaiting
                  : map.progress.failed > 0 ? null
                  : map.progress.empty === map.progress.total ? strings.mapNoData
                  : strings.mapReady}
                {map.progress?.detailReduced && ` · ${strings.mapReduced}`}
              </p>
              {import.meta.env.DEV && map.progress && <p className="muted">
                {strings.mapDebug(map.progress.zoom, map.progress.total, map.progress.bytes, map.progress.empty)}
              </p>}
              {(map.crashed || (map.progress && map.progress.failed > 0 && !map.rendering)) && <div className="map-failure">
                <p className="error" role="alert">{map.crashed ? strings.mapRenderFailed : strings.mapFailed}</p>
                <button type="button" className="secondary"
                  aria-label={map.crashed ? strings.mapRenderRetry : strings.mapRetry} onClick={map.retry}>{strings.retry}</button>
              </div>}
            </div>
          </section>
          {photo && editor && drawn && <EditPanel state={editor} drawn={drawn} photo={photo} edit={edit} />}
          <div className="status-area">
            <p className="status" role="status">{loading ? loadingMessage : error ? '' : photo ? strings.loaded : strings.waiting}</p>
            {error && <p className="error" role="alert">{error}</p>}
            <p className="muted">{strings.sessionNote}</p>
          </div>
        </aside>
      </div>
      {dragging && <div className="drop-overlay" aria-hidden="true">{strings.dropToReplace}</div>}
    </main>
  );
}
