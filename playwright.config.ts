import { defineConfig, devices } from '@playwright/test';

// Tier-2 PR-blocking E2E. Runs against the live `make dev` compose stack
// (frontend :3000, backend :4000, postgres :5432). Tier-3 cross-browser /
// soak specs would live under `tests/e2e-extended/` and use a separate
// config or `--project=extended` selector.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/*.spec.ts'],
  // 60s — full-flow walks register → BYOK → AI Continue → autosave assertions
  // and exceeds the default 30s on a cold stack.
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    // Don't keep state between specs — each test registers its own user.
    storageState: undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
