export const tileset = {
  baseUrl: import.meta.env.VITE_TILES_URL ?? '/tiles',
  name: import.meta.env.VITE_TILESET ?? 'dev',
  maxZoom: 14,
};

export function tileUrl(z: number, x: number, y: number): string {
  return `${tileset.baseUrl.replace(/\/$/, '')}/${tileset.name}/${z}/${x}/${y}.mvt`;
}
