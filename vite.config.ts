/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative paths, so the site works at any URL (e.g. username.github.io/snap-cal/).
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Snap Cal',
        short_name: 'Snap Cal',
        description: 'Snap a photo of an event poster and add it to your calendar with reminders.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f6f3ea',
        theme_color: '#4f6f14',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // The OCR engine and language data (~15MB) are cached the first time
        // someone scans a poster, rather than downloaded on every first visit.
        globIgnores: ['ocr/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'snapcal-ocr', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
