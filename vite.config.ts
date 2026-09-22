import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = {
    '/api': { target: env.CEP_API_URL || 'http://127.0.0.1:8080', changeOrigin: false },
  }
  return {
    plugins: [
      react(),
      {
        name: 'production-content-security-policy',
        apply: 'build',
        transformIndexHtml: {
          order: 'post',
          handler: () => [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content:
                  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'",
              },
              injectTo: 'head-prepend',
            },
          ],
        },
      },
    ],
    base: './',
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
      watch: {
        ignored: ['**/desktop/**', '**/.local/**', '**/test-results/**', '**/playwright-report/**'],
      },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  }
})
