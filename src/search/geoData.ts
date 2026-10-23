import { prepareIndex } from './match.ts';
import type { MajorData, SearchIndex } from './match.ts';

export const GEO_DATA = 'geo-dev';
let majorIndex: Promise<SearchIndex> | undefined;

/** Only public static data is requested. Queries and coordinates stay in memory. */
export function loadMajorIndex(): Promise<SearchIndex> {
  majorIndex ??= (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}${GEO_DATA}/major.json`);
    if (!response.ok) throw new Error('geo-data-unavailable');
    const data: MajorData = await response.json();
    if (data.version !== GEO_DATA || !data.admin1 || !Array.isArray(data.places)) {
      throw new Error('geo-data-invalid');
    }
    return prepareIndex(data);
  })().catch(() => {
    majorIndex = undefined;
    throw new Error('geo-data-unavailable');
  });
  return majorIndex;
}
