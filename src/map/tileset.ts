/**
 * Tiles come from the tool's own path, so from the page's own origin: on the main site, /tools/shutter_map/tiles/,
 * where the site's Worker reads them from R2. The archive is pinned in the build (docs/releasing.md); in development
 * scripts/dev-tiles.mjs serves the local archives as 'dev'. VITE_TILES_URL points a build at a tile server elsewhere.
 */
export const tileset = {
  baseUrl: import.meta.env.VITE_TILES_URL ?? `${import.meta.env.BASE_URL}tiles`,
  name: import.meta.env.VITE_TILESET ?? (import.meta.env.DEV ? 'dev' : 'china-2026'),
  maxZoom: 14,
  // Change to 10 when switching the published archive name to china-2026-r2.
  landmarkMinZoom: 12,
};

export function tileUrl(z: number, x: number, y: number): string {
  return `${tileset.baseUrl.replace(/\/$/, '')}/${tileset.name}/${z}/${x}/${y}.mvt`;
}
