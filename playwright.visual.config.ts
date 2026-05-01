import { defineConfig, devices } from '@playwright/test';

// [X24] Visual-regression config — developer-run only, not gated in CI.
//
// Three themes (paper / sepia / dark) × seven surfaces × OS-pinned baselines
// is fragile in shared CI, so this lives behind `npm run test:e2e:visual`
// rather than `make test-e2e`. The default Playwright config (the sibling
// playwright.config.ts) `testIgnore`s `visual.spec.ts` so the regular
// E2E run skips it.
//
// Snapshots are platform-suffixed by Playwright; Linux is the authoritative
// platform — see tests/e2e/README.md for the rationale and the update
// command.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/visual.spec.ts'],
  // Visual sweeps register a fresh user per theme (~3s each) plus modal
  // open/close churn — 60s is comfortable headroom on a cold stack.
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    storageState: undefined,
  },
  // Tighten screenshot defaults: keep diff tolerance loose enough to absorb
  // sub-pixel font rasterisation drift, kill caret + animation churn.
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 200,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
