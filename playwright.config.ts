import { defineConfig, devices } from '@playwright/test';

// E2E config. Boots the full dev stack (client + signaling server) via the
// root `dev` script and points the browser at the Vite dev URL. Tests run
// against http://localhost:5173 — the same URL a developer browses to.
//
// reuseExistingServer is on so a developer who already has `npm run dev`
// running can re-run the suite without thrashing the dev process.
export default defineConfig({
  testDir:    './e2e',
  // No retries locally — flakes should be fixed, not papered over.
  retries:    0,
  reporter:   'list',
  // Each test gets a fresh browser context (page) so cookies/storage
  // don't leak between tests.
  use: {
    baseURL: 'http://localhost:5173',
    trace:   'retain-on-failure',
  },
  webServer: {
    command:              'npm run dev',
    url:                  'http://localhost:5173',
    reuseExistingServer:  !process.env.CI,
    // First-time start can be slow because it spins up both Vite and the
    // bun signaling server.
    timeout:              120_000,
  },
  projects: [
    {
      name: 'chromium',
      use:  { ...devices['Desktop Chrome'] },
    },
  ],
});
