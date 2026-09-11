import { defineConfig, devices } from '@playwright/test';

// Flows run against the dev server with the demo brain (MemoryDriver), spec §17.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: !process.env['CI'], timeout: 60_000 },
    // A production build for the PWA checks (service worker, manifest); dev never registers a worker.
    { command: 'npx vite build --outDir dist-preview && npx vite preview --outDir dist-preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env['CI'], timeout: 120_000 },
  ],
  projects: [
    { name: 'chromium', testIgnore: /pwa\.spec\.ts/, use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'pwa', testMatch: /pwa\.spec\.ts/, use: { browserName: 'chromium', baseURL: 'http://localhost:4173', viewport: { width: 390, height: 844 } } },
    // Safari's engine as an iPhone (touch, mobile viewport): the same flows, the maintainer's device is an iPhone.
    { name: 'webkit', testIgnore: /pwa\.spec\.ts/, use: { ...devices['iPhone 14'] } },
    { name: 'pwa-webkit', testMatch: /pwa\.spec\.ts/, use: { ...devices['iPhone 14'], baseURL: 'http://localhost:4173' } },
  ],
});
