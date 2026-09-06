import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// `base` is the GitHub Pages subpath in CI (VITE_BASE=/gnomon/) and "/" in dev (spec §2, §18).
const base = process.env['VITE_BASE'] ?? '/';

export default defineConfig({
  base,
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
        // TODO(design pass): maskable icons at 192 and 512.
        icons: [],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
});
