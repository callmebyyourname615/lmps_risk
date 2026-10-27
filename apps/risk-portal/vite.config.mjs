import { defineConfig } from 'vite';

export default defineConfig({
  base: '/portal/',
  build: { target: 'es2023', outDir: 'dist', sourcemap: false },
  server: {
    host: '127.0.0.1', port: 18505, strictPort: true,
    proxy: { '/v1/local/alerts': { target: 'http://127.0.0.1:18501', changeOrigin: false, ws: false } },
  },
});
