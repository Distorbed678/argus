import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { VitePWA } from 'vite-plugin-pwa';
import { argusProxy } from './proxy-plugin';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesium';

export default defineConfig({
  base: './',
  define: {
    CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
  worker: { format: 'es' },
  server: { host: true },
  preview: { host: true },
  plugins: [
    argusProxy(),
    viteStaticCopy({
      // stripBase: 4 drops `node_modules/cesium/Build/Cesium/` so files land at cesium/Assets/…
      targets: ['ThirdParty', 'Workers', 'Assets', 'Widgets'].map((d) => ({
        src: `${cesiumSource}/${d}`,
        dest: cesiumBaseUrl,
        rename: { stripBase: 4 },
      })),
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'ARGUS // Orbital Surveillance Console',
        short_name: 'ARGUS',
        description: 'Real-data spy satellite globe: satellites, flights, ships, weather, hazards, cameras and more.',
        theme_color: '#020812',
        background_color: '#020812',
        display: 'fullscreen',
        orientation: 'any',
        start_url: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}', 'data/*.json'],
        globIgnores: ['cesium/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/__proxy/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/cesium/'),
            handler: 'CacheFirst',
            options: { cacheName: 'cesium-runtime', expiration: { maxEntries: 400 } },
          },
          {
            urlPattern: ({ url }) =>
              /arcgisonline\.com|cartocdn\.com|gibs\.earthdata\.nasa\.gov|tile\.openstreetmap\.org|tilecache\.rainviewer\.com/.test(url.hostname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 3 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
