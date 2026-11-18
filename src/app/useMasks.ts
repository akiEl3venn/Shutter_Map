import { useLayoutEffect, useReducer } from 'react';
import type { PhotoSession } from '../contracts.ts';
import { editMasks, initialMasks } from './maskEditor.ts';

function photoSize(photo: PhotoSession | null) {
  return { widthPx: photo?.orientedWidthPx ?? 0, heightPx: photo?.orientedHeightPx ?? 0 };
}

export function useMasks(photo: PhotoSession | null) {
  const [masks, dispatch] = useReducer(editMasks, photo, session => initialMasks(photoSize(session)));
  useLayoutEffect(() => { dispatch({ type: 'reset', photo: photoSize(photo) }); }, [photo]);
  return { masks, editMasks: dispatch };
}
