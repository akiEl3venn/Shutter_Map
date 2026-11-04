import { useLayoutEffect, useMemo, useReducer } from 'react';
import type { LocationChoice, LonLat, MapFocus, PhotoSession } from '../contracts.ts';
import { createEditorState, drawnComposition, editComposition, type EditAction, type EditorState } from '../map/editComposition.ts';
import { focusFor } from '../map/labels.ts';

type Session = { photo: PhotoSession | null; editor: EditorState | null };
type Sync = { type: 'sync'; photo: PhotoSession | null; coordinate: LonLat | null; focus: MapFocus | null };

function reduce(session: Session, action: EditAction | Sync): Session {
  const photo = action.type === 'sync' ? action.photo : session.photo;
  if (!photo || (action.type === 'sync' && !action.coordinate)) return { photo, editor: null };
  const size = { widthPx: photo.orientedWidthPx, heightPx: photo.orientedHeightPx };
  if (action.type === 'sync') {
    const point = action.coordinate!;
    if (photo !== session.photo || !session.editor) return { photo, editor: createEditorState(size, point, action.focus) };
    const { geographicCenter: [lon, lat], labels: { focus } } = session.editor.composition;
    const sameFocus = JSON.stringify(focus) === JSON.stringify(action.focus);
    if (point[0] === lon && point[1] === lat && sameFocus) return session;
    const moved = editComposition(session.editor, { type: 'geographicCenter', value: point }, size);
    return { photo, editor: editComposition(moved, { type: 'focus', value: action.focus }, size) };
  }
  return session.editor ? { photo, editor: editComposition(session.editor, action, size) } : session;
}

export function useComposition(photo: PhotoSession | null, location: LocationChoice | null) {
  const [session, edit] = useReducer(reduce, { photo: null, editor: null });
  const lon = location?.coordinate[0], lat = location?.coordinate[1];
  const focus = focusFor(location);
  const focusKey = JSON.stringify(focus);
  useLayoutEffect(() => {
    edit({ type: 'sync', photo, coordinate: lon === undefined || lat === undefined ? null : [lon, lat], focus });
  }, [photo, lon, lat, focusKey]);
  const editor = photo === session.photo && location ? session.editor : null;
  const drawn = useMemo(() => editor && photo
    ? drawnComposition(editor, { widthPx: photo.orientedWidthPx, heightPx: photo.orientedHeightPx }) : null, [editor, photo]);
  return { editor, drawn, edit };
}
