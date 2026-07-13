import { defineConfig } from 'vite'

// Dev is same-origin: /api/* is proxied to the local Go server (no CORS locally).
// Prod hits https://api.devstash.one directly (see src/main.ts, VITE_API_BASE_URL).
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
