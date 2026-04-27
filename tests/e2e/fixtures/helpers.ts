import { expect, type Page } from '@playwright/test';

/**
 * Generate a salted username so concurrent / repeated runs don't collide.
 * Backend `User.username` has a UNIQUE constraint plus a 3–32 lowercase
 * alphanumeric+underscore+hyphen regex, so this stays inside that grammar.
 */
export function uniqueUsername(prefix = 'e2e'): string {
  const salt = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${salt}`.toLowerCase().slice(0, 32);
}

/**
 * Drive the register UI from the sign-in page through to the dashboard.
 * Captures + acknowledges the recovery code so the post-handoff auto-login
 * lands the page on the dashboard.
 */
export async function registerThroughUI(
  page: Page,
  username: string,
  password: string,
): Promise<{ recoveryCode: string }> {
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible();

  await page.fill('#auth-username', username);
  await page.fill('#auth-password', password);
  await page.getByRole('button', { name: /create account/i }).click();

  // Recovery-code handoff — must acknowledge before the page advances.
  const codeBox = page.getByTestId('recovery-code-box');
  await expect(codeBox).toBeVisible();
  const recoveryCode = (await codeBox.innerText()).trim();

  await page.getByRole('checkbox', { name: /i have stored/i }).check();
  await page.getByRole('button', { name: /continue to inkwell/i }).click();

  // Post-ack login → dashboard. F58 dashboard renders the embedded
  // StoryPicker, so the heading we wait on is the picker title.
  await expect(page.getByTestId('story-picker')).toBeVisible({ timeout: 15_000 });

  return { recoveryCode };
}

/**
 * Open Settings → Venice tab, paste the test BYOK key + mock endpoint, save.
 * Asserts the save succeeded by waiting for the masked-key pill.
 */
export async function configureVeniceBYOK(
  page: Page,
  options: { apiKey: string; endpoint: string },
): Promise<void> {
  // Two Settings buttons exist on the editor page (TopBar + ChatPanel header)
  // — both open the same SettingsModal. Scope to the TopBar to disambiguate.
  await page
    .getByTestId('topbar')
    .getByRole('button', { name: /settings/i })
    .click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();

  // Venice tab is the default, but click defensively in case that changes.
  await page.getByTestId('settings-tab-venice').click();

  await page.getByTestId('venice-key-input').fill(options.apiKey);
  await page.getByTestId('venice-endpoint-input').fill(options.endpoint);
  await page.getByTestId('venice-key-save').click();

  // Successful save flips `status.hasKey` true and surfaces the masked
  // last-four readout in the API-Key label's right-rail; failure surfaces
  // an inline error. Race them so the failure mode shows in test output
  // instead of timing out silently. (`venice-key-pill` is verify-only and
  // does NOT appear after a plain save.)
  const lastFour = page.getByTestId('venice-key-last-four');
  const saveError = page.getByTestId('venice-key-save-error');
  await Promise.race([
    lastFour.waitFor({ state: 'visible', timeout: 15_000 }),
    saveError.waitFor({ state: 'visible', timeout: 15_000 }),
  ]);
  if (await saveError.isVisible()) {
    const msg = (await saveError.innerText()).trim();
    throw new Error(`BYOK save failed: ${msg}`);
  }
  await expect(lastFour).toBeVisible();

  await page.getByTestId('settings-done').click();
  await expect(page.getByTestId('settings-modal')).not.toBeVisible();
}

/**
 * Create a new story from the embedded dashboard StoryPicker, then enter
 * its editor by clicking the freshly-added picker row. Returns once the
 * editor URL is /stories/:id.
 *
 * The StoryModal's create handler closes the modal but does NOT auto-
 * navigate — by design, the dashboard renders the picker as a permanent
 * surface (F58) and the user picks which story to open.
 */
export async function createStoryThroughUI(page: Page, title: string): Promise<void> {
  await page.getByTestId('story-picker-new').click();

  const dialog = page.getByRole('dialog', { name: /new story/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/title/i).fill(title);
  await dialog.getByRole('button', { name: /create story/i }).click();
  await expect(dialog).not.toBeVisible();

  // Picker on the dashboard refreshes with the new row; click it to enter
  // the editor. Matching by visible title text since the row testid is
  // story-picker-row-<id> and we don't have the id yet.
  await page.getByTestId('story-picker').getByText(title, { exact: false }).click();
  await expect(page).toHaveURL(/\/stories\/[a-z0-9]+/, { timeout: 10_000 });
}
