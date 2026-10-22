import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { PhotoSession } from '../contracts.ts';
import { toLonLat } from '../location/gps.ts';
import { readExif } from '../photo/exif.ts';
import { loadPhoto } from '../photo/loadPhoto.ts';
import { strings } from './strings.ts';

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
  const [session, setSession] = useState<PhotoSession | null>(null);
  const [orientation, setOrientation] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<ImageBitmap | null>(null);
  const requestId = useRef(0);
  const dragDepth = useRef(0);

  useEffect(() => () => {
    requestId.current += 1;
    previewRef.current?.close();
    previewRef.current = null;
  }, []);

  async function selectPhoto(file: File) {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const [exif, photo] = await Promise.all([readExif(file), loadPhoto(file)]);
      if (id !== requestId.current) {
        photo.preview.close();
        return;
      }
      const selectedLocation = toLonLat(exif.gps);
      const oldPreview = previewRef.current;
      previewRef.current = photo.preview;
      setSession({
        file,
        orientedWidthPx: photo.orientedWidthPx,
        orientedHeightPx: photo.orientedHeightPx,
        selectedLocation,
        locationSource: selectedLocation ? 'exif' : null,
      });
      setOrientation(exif.orientation);
      oldPreview?.close();
    } catch (failure) {
      if (id !== requestId.current) return;
      const unsupported = typeof failure === 'object' && failure !== null
        && 'code' in failure && failure.code === 'unsupported-format';
      setError(unsupported ? strings.unsupportedFormat : strings.loadFailed);
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

  const location = session?.selectedLocation;
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
      <input ref={inputRef} className="file-input" type="file" accept="image/*" tabIndex={-1}
        aria-label={strings.selectPhoto}
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void selectPhoto(file);
        }} />
      <div className="workspace" aria-busy={loading}>
        <section className="preview-area" aria-label={strings.previewLabel}>
          <PhotoCanvas preview={previewRef.current} />
          {!session && <div className="empty-preview">
            <button type="button" onClick={() => inputRef.current?.click()}>{strings.selectPhoto}</button>
            <p>{strings.dropHint}</p><p className="muted">{strings.formatHint}</p>
          </div>}
        </section>
        <aside className="sidebar">
          <section>
            <h2>{strings.photoInformation}</h2>
            {session ? <>
              <dl><dt>{strings.sourceDimensions}</dt>
                <dd className="dimensions">{strings.dimensions(session.orientedWidthPx, session.orientedHeightPx)}</dd>
                <dt>{strings.orientation}</dt><dd>{orientation ?? strings.noOrientation}</dd>
              </dl>
              <button type="button" className="secondary" onClick={() => inputRef.current?.click()}>{strings.replacePhoto}</button>
            </> : <p className="muted">{strings.noPhotoInformation}</p>}
          </section>
          <section>
            <h2>{strings.location}</h2>
            {location ? <>
              <p className="source-label">{strings.exifSource}</p>
              <p className="coordinates">{strings.coordinates(location[0], location[1])}</p>
              <p className="muted">{strings.coordinateOrder}</p>
              <p className="location-note">{strings.locationNote}</p>
            </> : <p>{session ? strings.noGps : strings.waitingLocation}</p>}
          </section>
          <div className="status-area">
            <p className="status" role="status">{loading ? strings.loading : error ? '' : session ? strings.loaded : strings.waiting}</p>
            {error && <p className="error" role="alert">{error}</p>}
            <p className="muted">{strings.sessionNote}</p>
          </div>
        </aside>
      </div>
      {dragging && <div className="drop-overlay" aria-hidden="true">{strings.dropToReplace}</div>}
    </main>
  );
}
