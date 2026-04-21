import { expect, test } from '@playwright/test';

// The frontend service currently serves the nginx placeholder (see [I1]).
// Once the real Vite build is baked into the frontend image, update the
// expected heading to "Story Editor".
const EXPECTED_HEADING = /Welcome to nginx!|Story Editor/i;

test('home page renders a heading', async ({ page }) => {
  await page.goto('/');
  const heading = page.getByRole('heading').first();
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(EXPECTED_HEADING);
});
