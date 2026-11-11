import { defineConfig } from '@playwright/test';

// Smoke test against the production build (`npm run build` first). External feeds are stubbed
// in the test itself so CI is fast and deterministic.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // software WebGL in headless Chromium
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'mobile-375', use: { browserName: 'chromium', viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
