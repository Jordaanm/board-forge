import { defineConfig, configDefaults } from 'vitest/config';

// Root vitest config: keep `e2e/` out of vitest discovery. That folder is
// Playwright-only — its `*.spec.ts` files import `@playwright/test` and call
// `test()` from a Playwright worker, which throws "Playwright Test did not
// expect test() to be called here" if vitest tries to load them.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
