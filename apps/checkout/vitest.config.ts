import { defineConfig } from 'vitest/config';

// Unit tests of the pure pieces (message protocol, frame policy, the server's
// routes). Browser behaviour is covered end to end by Playwright (e2e/).
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
