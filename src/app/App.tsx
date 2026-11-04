import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { LocationChoice, PhotoSession, TileKey } from '../contracts.ts';
import { toLonLat } from '../location/gps.ts';
import { readExif } from '../photo/exif.ts';
import { loadPhoto } from '../photo/loadPhoto.ts';
import { strings } from './strings.ts';
import { PlaceSearch } from './PlaceSearch.tsx';
import { RegionCascade } from './RegionCascade.tsx';
import type { RegionLoadStatus } from './RegionCascade.tsx';
import { loadCountries, loadCountry } from '../search/geoData.ts';
import { pathForPlace } from '../search/cascade.ts';
import type { CountrySummary, RegionSelection } from '../search/cascade.ts';
import { prepareIndexInChunks } from '../search/match.ts';
import type { CountryData, SearchIndex } from '../search/match.ts';
import { defaultComposition } from '../map/composition.ts';
import { limitedTileCover, zoomFor } from '../map/mercator.ts';
import type { TileCoverage } from '../map/mercator.ts';
import { createTileLoader } from '../map/tileLoader.ts';
import { decodeTile } from '../map/decodeTile.ts';
import type { TileFeatures } from '../map/decodeTile.ts';
import { tileset, tileUrl } from '../map/tileset.ts';

interface MapData {
  coverage: TileCoverage;
  features: Record<string, TileFeatures>;
  loaded: number;
  empty: number;
  failed: number;
  bytes: number;
  loading: boolean;
}

function PhotoCanvas({ preview }: { preview: ImageBitmap | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const context = canvas.getContext('2d');
      if (!context || !preview) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      const scale = Math.min(width / preview.width, height / preview.height);
      const drawWidth = preview.width * scale;
      const drawHeight = preview.height * scale;
      context.drawImage(preview, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    window.addEventListener('resize', draw);
    draw();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, [preview]);

  return <canvas ref={canvasRef} aria-label={strings.previewLabel} role="img">{strings.canvasFallback}</canvas>;
}

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
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>(strings.loading);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ImageBitmap | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const dragDepth = useRef(0);
  const [tileLoader] = useState(() => createTileLoader({ url: key => tileUrl(key.z, key.x, key.y) }));
  const [mapData, setMapData] = useState<MapData | null>(null);
  const retryTiles = useRef<() => void>(() => {});
  const composition = useMemo(() => defaultComposition(photo, location), [photo, location]);

  useEffect(() => {
    if (!composition) {
      setMapData(null);
      retryTiles.current = () => {};
      return;
    }
    const controller = new AbortController();
    const coverage = limitedTileCover({
      center: composition.geographicCenter,
      widthPx: composition.widthPx,
      heightPx: composition.heightPx,
      rotationDegrees: composition.rotationDegrees,
      metersPerImagePixel: composition.metersPerImagePixel,
      zoom: zoomFor(composition.metersPerImagePixel, composition.geographicCenter[1], composition.detailOffset, tileset.maxZoom),
    });
    const features: Record<string, TileFeatures> = {};
    const completed = new Map<string, { key: TileKey; status: 'ready' | 'empty' | 'failed'; bytes: number }>();
    let busy = false;
    function publish() {
      if (controller.signal.aborted) return;
      const results = [...completed.values()];
      setMapData({ coverage, features: { ...features }, loading: busy,
        loaded: results.filter(result => result.status !== 'failed').length,
        empty: results.filter(result => result.status === 'empty').length,
        failed: results.filter(result => result.status === 'failed').length,
        bytes: results.reduce((sum, result) => sum + result.bytes, 0),
      });
    }
    async function load(keys: TileKey[]) {
      if (busy || controller.signal.aborted) return;
      busy = true;
      publish();
      await tileLoader.load(keys, result => {
        if (controller.signal.aborted) return;
        const id = `${result.key.z}/${result.key.x}/${result.key.y}`;
        let status = result.status;
        let bytes = 0;
        if (result.status === 'ready') {
          try {
            features[id] = decodeTile(result.bytes, result.key);
            bytes = result.bytes.byteLength;
          } catch {
            status = 'failed';
            tileLoader.invalidate(result.key);
          }
        }
        completed.set(id, { key: result.key, status, bytes });
        publish();
      }, controller.signal);
      busy = false;
      publish();
    }
    retryTiles.current = () => {
      const failed = new Set([...completed.values()].filter(result => result.status === 'failed')
        .map(result => `${result.key.z}/${result.key.x}/${result.key.y}`));
      // Retain the original near-to-far order and leave successful/empty tiles alone.
      void load(coverage.keys.filter(key => failed.has(`${key.z}/${key.x}/${key.y}`)));
    };
    void load(coverage.keys);
    return () => {
      controller.abort();
      retryTiles.current = () => {};
    };
  }, [composition, tileLoader]);

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

  function chooseLocation(choice: LocationChoice) {
    setLocation(choice);
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
        orientedWidthPx: decoded.orientedWidthPx,
        orientedHeightPx: decoded.orientedHeightPx,
        exifLocation,
      });
      if (exifLocation) chooseLocation({ coordinate: exifLocation, source: 'exif' });
      else setLocation(current => current?.source === 'exif' ? null : current);
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
        <section className="preview-area" aria-label={strings.previewLabel}>
          <PhotoCanvas preview={preview} />
          {!photo && <div className="empty-preview">
            <button type="button" onClick={() => inputRef.current?.click()}>{strings.selectPhoto}</button>
            <p>{strings.dropHint}</p><p className="muted">{strings.formatHint}</p>
          </div>}
        </section>
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
            <p className="muted geo-attribution">{strings.geoAttribution}</p>
            <div className="map-data">
              <p role="status" aria-live="polite">
                {!mapData ? strings.mapWaiting
                  : mapData.loading ? strings.mapProgress(mapData.loaded, mapData.coverage.keys.length)
                  : mapData.failed > 0 ? null
                  : mapData.empty === mapData.coverage.keys.length ? strings.mapNoData
                  : strings.mapReady}
                {mapData?.coverage.detailReduced && ` · ${strings.mapReduced}`}
              </p>
              {import.meta.env.DEV && mapData !== null && <p className="muted">
                {strings.mapDebug(mapData.coverage.zoom, mapData.coverage.keys.length, mapData.bytes, mapData.empty)}
              </p>}
              {mapData !== null && mapData.failed > 0 && !mapData.loading && <div className="map-failure">
                <p className="error">{strings.mapFailed}</p>
                <button type="button" className="secondary"
                  aria-label={strings.mapRetry} onClick={() => retryTiles.current()}>{strings.retry}</button>
              </div>}
              <p className="muted">{strings.mapAttribution}</p>
            </div>
          </section>
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
