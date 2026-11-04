import type { RoadKind } from '../contracts.ts';

const major = new Set(['motorway', 'trunk', 'primary']);
const standard = new Set(['secondary', 'tertiary']);
const local = new Set(['unclassified', 'residential', 'living_street', 'service', 'road', 'track', 'pedestrian']);
const trails = new Set(['path', 'footway', 'steps', 'bridleway']);

export type RoadClass = { layer: 'roads'; detail: RoadKind } | { layer: 'hiking'; detail: 'all' };

/** Classification does not imply permission to travel. Hiking needs a separate protected-area filter. */
export function classifyRoad(tags: Record<string, string | undefined> = {}): RoadClass | null {
  const highway = tags.highway?.replace(/_link$/, '');
  if (!highway || highway === 'cycleway') return null;
  if (major.has(highway)) return { layer: 'roads', detail: 'major' };
  if (standard.has(highway)) return { layer: 'roads', detail: 'standard' };
  if (local.has(highway)) return { layer: 'roads', detail: 'all' };
  if (trails.has(highway)) {
    if (tags.bicycle === 'designated' && tags.foot === 'no') return null;
    return { layer: 'hiking', detail: 'all' };
  }
  return null;
}
