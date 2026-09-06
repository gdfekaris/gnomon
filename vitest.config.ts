import { defineConfig } from 'vitest/config';

// One vitest run covers every library package. The app is exercised by
// Playwright flows (spec §17), not by this config.
export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/storage', 'packages/providers', 'packages/cli'],
  },
});
