import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Local dev: the browser calls /api on the Vite server, which forwards it to the Express API
    proxy: { '/api': process.env.VITE_API_PROXY || 'http://localhost:4000' },
  },
  build: { outDir: 'dist', sourcemap: false },
});
