import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Inside Docker the API runs on the host, not localhost of the container.
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Vite 6+ blocks requests whose Host header is not localhost/an IP.
    // Phones reach the dev app through the Cloudflare tunnel as
    // wcies.wulaoula.cn (docs/integrations/ozon-webhook-tunnel.md) - allow
    // that host explicitly instead of `true` (which would accept any Host).
    allowedHosts: ['wcies.wulaoula.cn'],
    proxy: {
      // Same-origin calls from the generated api-client hit the dev proxy.
      '/api': { target: proxyTarget, changeOrigin: true },
      // Exact health endpoints only - must not swallow the /health-test page.
      '^/health$': { target: proxyTarget, changeOrigin: true },
      '^/health/live$': { target: proxyTarget, changeOrigin: true },
      '^/health/ready$': { target: proxyTarget, changeOrigin: true },
    },
  },
});
