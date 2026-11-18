import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import devTiles from './scripts/dev-tiles.mjs';

export default defineConfig(({ command, isPreview }) => ({
  // Where the main site serves the tool. Development stays at the root.
  base: command === 'build' || isPreview ? '/tools/shutter_map/' : '/',
  plugins: [react(), devTiles()],
  optimizeDeps: {
    exclude: ['@jsquash/jxl', '@jsquash/avif', '@jsquash/webp', '@cornerstonejs/codec-libjxl'],
    include: ['utif2', 'libheif-js/libheif-wasm/libheif.js'],
  },
  worker: { format: 'es' },
  build: { assetsInlineLimit: 0 },
}));
