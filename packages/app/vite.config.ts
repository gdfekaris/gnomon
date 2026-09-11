import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// `base` is the GitHub Pages subpath in CI (VITE_BASE=/gnomon/) and "/" in dev (spec §2, §18).
const base = process.env['VITE_BASE'] ?? '/';

// Which build a device is running, for Settings → About: CI's commit, or "dev".
const commit = (process.env['GITHUB_SHA'] ?? 'dev').slice(0, 7);

export default defineConfig({
  base,
  define: { __GNOMON_BUILD__: JSON.stringify(commit) },
  plugins: [
    svelte(),
    VitePWA({
      // Spec §11: precache the app shell only; prompt on update; never cache API origins.
      registerType: 'prompt',
      manifest: {
        name: 'Gnomon',
        short_name: 'Gnomon',
        description: 'A second brain your own AI can reason from.',
        display: 'standalone',
        start_url: `${base}#/capture`,
        theme_color: '#1c1917',
        background_color: '#fafaf9',
        // Placeholder icons from tools/make-icons.mjs until the design pass.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // Spec §11: no runtime caching; API origins bypass the worker entirely.
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
});
