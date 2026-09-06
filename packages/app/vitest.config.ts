import { defineConfig } from 'vitest/config';
// Unit tests for the app's framework-free services. Screens are covered by Playwright (e2e/).
export default defineConfig({ test: { name: 'app', include: ['test/**/*.test.ts'] } });
