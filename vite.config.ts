import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@jsquash/jxl'],
    include: ['utif2', 'libheif-js/libheif-wasm/libheif.js'],
  },
  worker: { format: 'es' },
  build: { assetsInlineLimit: 0 },
});
