import { defineConfig } from '@playwright/test';

// Flows run against the dev server with the demo brain (MemoryDriver), spec §17.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: !process.env['CI'], timeout: 60_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } }],
});
