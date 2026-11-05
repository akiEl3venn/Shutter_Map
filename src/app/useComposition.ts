import { useEffect, useLayoutEffect, useMemo, useReducer, useState } from 'react';
import type { LocationChoice, LonLat, MapFocus, PhotoSession } from '../contracts.ts';
import { createEditorState, drawnComposition, editComposition, type EditAction, type EditorState } from '../map/editComposition.ts';
import { focusFor } from '../map/labels.ts';
import { languagesOfCountry, readerLanguage } from '../map/languages.ts';
import { loadMajorIndex } from '../search/geoData.ts';
import { nearestCountry } from '../search/match.ts';

type Session = { photo: PhotoSession | null; editor: EditorState | null };
type Sync = { type: 'sync'; photo: PhotoSession | null; coordinate: LonLat | null; focus: MapFocus | null;
  localLanguages: readonly string[] };

function reduce(session: Session, action: EditAction | Sync): Session {
  const photo = action.type === 'sync' ? action.photo : session.photo;
  if (!photo || (action.type === 'sync' && !action.coordinate)) return { photo, editor: null };
  const size = { widthPx: photo.orientedWidthPx, heightPx: photo.orientedHeightPx };
  if (action.type === 'sync') {
    const point = action.coordinate!;
    if (photo !== session.photo || !session.editor) return { photo, editor: createEditorState(size, point, action.focus, action.localLanguages) };
    const { geographicCenter: [lon, lat], labels: { focus } } = session.editor.composition;
    const sameFocus = JSON.stringify(focus) === JSON.stringify(action.focus);
    if (point[0] === lon && point[1] === lat && sameFocus) return session;
    const moved = editComposition(session.editor, { type: 'geographicCenter', value: point }, size);
    return { photo, editor: editComposition(moved, { type: 'focus', value: action.focus }, size) };
  }
  return session.editor ? { photo, editor: editComposition(session.editor, action, size) } : session;
}

/** Which country is on the map, for its languages. Worked out in the page: neither the location nor the answer goes anywhere. */
function useMapCountry(location: LocationChoice | null): string | null {
  const [country, setCountry] = useState<string | null>(null);
  const chosen = location?.source === 'search' ? location.place?.countryCode : undefined;
  const lon = location?.coordinate[0], lat = location?.coordinate[1];
  useEffect(() => {
    if (chosen) { setCountry(chosen); return; }
    if (lon === undefined || lat === undefined) { setCountry(null); return; }
    let cancelled = false;
    void loadMajorIndex().then(index => {
      if (!cancelled) setCountry(nearestCountry(index, [lon, lat]));
    }, () => {}); // Without the data, English and the reader's own language are still on offer.
    return () => { cancelled = true; };
  }, [chosen, lon, lat]);
  return country;
}

export function useComposition(photo: PhotoSession | null, location: LocationChoice | null) {
  const [session, edit] = useReducer(reduce, { photo: null, editor: null });
  const localLanguages = languagesOfCountry(useMapCountry(location));
  const lon = location?.coordinate[0], lat = location?.coordinate[1];
  const focus = focusFor(location);
  const focusKey = JSON.stringify(focus);
  useLayoutEffect(() => {
    edit({ type: 'sync', photo, coordinate: lon === undefined || lat === undefined ? null : [lon, lat], focus, localLanguages });
  }, [photo, lon, lat, focusKey]);
  // On its own, because the country can arrive later: it must not put back a map center that has moved since.
  useLayoutEffect(() => {
    edit({ type: 'localLanguages', value: localLanguages, browser: readerLanguage() });
  }, [localLanguages]);
  const editor = photo === session.photo && location ? session.editor : null;
  const drawn = useMemo(() => editor && drawnComposition(editor), [editor]);
  return { editor, drawn, edit };
}
