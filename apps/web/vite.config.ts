import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin calls from the generated api-client hit the dev proxy.
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      // Exact health endpoints only - must not swallow the /health-test page.
      '^/health$': { target: 'http://localhost:3000', changeOrigin: true },
      '^/health/live$': { target: 'http://localhost:3000', changeOrigin: true },
      '^/health/ready$': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
