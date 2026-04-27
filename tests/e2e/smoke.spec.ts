import { expect, test } from '@playwright/test';

// Tier-2 smoke. Pre-T8 sanity check that the live stack reaches the SPA at
// the configured base URL and unauthenticated requests land on the sign-in
// page. T8's full-flow.spec.ts covers the user journey from there.
test('unauthenticated root lands on the sign-in screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
});
