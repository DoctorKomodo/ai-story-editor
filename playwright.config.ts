import { defineConfig, devices } from '@playwright/test';

// Tier-2 E2E — CI-manual-only today (.github/workflows/e2e.yml runs on
// workflow_dispatch only; PR gating is an open decision tracked in bd issue
// story-editor-7ns). Runs against the live `make dev` compose stack
// (frontend :3000, backend :4000, postgres :5432). Tier-3 cross-browser /
// soak specs would live under `tests/e2e-extended/` and use a separate
// config or `--project=extended` selector.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/*.spec.ts'],
  // [X24] Visual regression lives in its own developer-run config
  // (playwright.visual.config.ts → `npm run test:e2e:visual`). Excluded
  // from the default tier-2 sweep because three themes × ~7 surfaces of
  // OS-pinned PNGs are too fragile for shared CI today.
  testIgnore: ['**/visual.spec.ts'],
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
