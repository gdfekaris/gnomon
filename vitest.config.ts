import { defineConfig } from 'vitest/config';

// One vitest run covers every package's unit tests. The app's screens are
// exercised by Playwright flows (spec §17) in packages/app/e2e.
export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/storage', 'packages/providers', 'packages/cli', 'packages/app'],
  },
});
