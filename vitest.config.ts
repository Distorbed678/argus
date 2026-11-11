import { defineConfig } from 'vitest/config';

// Unit tests only cover pure modules (no WebGL / DOM); the browser smoke test is Playwright.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
