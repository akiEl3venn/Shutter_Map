import { useLayoutEffect, useReducer } from 'react';
import type { LocationChoice, LonLat, PhotoSession } from '../contracts.ts';
import { createEditorState, editComposition, type EditAction, type EditorState } from '../map/editComposition.ts';

type Session = { photo: PhotoSession | null; editor: EditorState | null };
type Sync = { type: 'sync'; photo: PhotoSession | null; coordinate: LonLat | null };

function reduce(session: Session, action: EditAction | Sync): Session {
  const photo = action.type === 'sync' ? action.photo : session.photo;
  if (!photo || (action.type === 'sync' && !action.coordinate)) return { photo, editor: null };
  const size = { widthPx: photo.orientedWidthPx, heightPx: photo.orientedHeightPx };
  if (action.type === 'sync') {
    const point = action.coordinate!;
    if (photo !== session.photo || !session.editor) return { photo, editor: createEditorState(size, point) };
    const [lon, lat] = session.editor.composition.geographicCenter;
    if (point[0] === lon && point[1] === lat) return session;
    return { photo, editor: editComposition(session.editor, { type: 'geographicCenter', value: point }, size) };
  }
  return session.editor ? { photo, editor: editComposition(session.editor, action, size) } : session;
}

export function useComposition(photo: PhotoSession | null, location: LocationChoice | null) {
  const [session, edit] = useReducer(reduce, { photo: null, editor: null });
  const lon = location?.coordinate[0], lat = location?.coordinate[1];
  useLayoutEffect(() => {
    edit({ type: 'sync', photo, coordinate: lon === undefined || lat === undefined ? null : [lon, lat] });
  }, [photo, lon, lat]);
  return { editor: photo === session.photo && location ? session.editor : null, edit };
}
