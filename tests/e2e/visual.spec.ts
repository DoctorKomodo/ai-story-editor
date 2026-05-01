// [X24] Visual-regression sweep — three themes × seven design-system surfaces.
//
// Shape: one test per theme, all surfaces baselined inside that test (3
// tests × 7 screenshot assertions = 21 baselines). The per-theme shape is
// preferred over per-surface because each test still needs its own
// register + BYOK-mock setup (~5s overhead); folding all surfaces under
// one register keeps the wall-clock baselining run to ~3 setups instead
// of ~21. Trade-off: a single failure inside a theme test fails the
// whole theme — acceptable because diffs are inspected via Playwright's
// HTML report, which surfaces every assertion individually.
//
// Snapshots live under `tests/e2e/__screenshots__/visual.spec.ts-snapshots/`
// with platform suffixes appended automatically by Playwright. Linux is
// the authoritative platform; see tests/e2e/README.md.
//
// Theme switch: `document.documentElement.dataset.theme = 'paper' | 'sepia'
// | 'dark'` — same mechanism the Settings → Appearance tab and the
// Storybook decorator use. We set it as the very first step after
// register so every screenshot below renders against the right token set.
//
// Surfaces baselined (in order):
//   1. Editor surface (post create-story + create-chapter, empty body)
//   2. CharacterSheet modal (open, blank-new state)
//   3. StoryModal (Edit story metadata via dashboard)
//   4. Settings modal (Venice tab)
//   5. AccountPrivacyModal
//   6. StoryPicker modal (sidebar trigger from editor)
//   7. ModelPicker modal (chat panel trigger; needs BYOK key first)
//
// Mocked Venice fixture is reused from the full-flow spec — the BYOK save
// path probes `/models` against the configured endpoint, so without the
// mock the Settings save would fail and the ModelPicker surface would
// render its empty state.

import { expect, type Page, test } from '@playwright/test';
import {
  configureVeniceBYOK,
  createStoryThroughUI,
  registerThroughUI,
  uniqueUsername,
} from './fixtures/helpers';
import { type MockVeniceServer, startMockVenice } from './fixtures/mock-venice';

type Theme = 'paper' | 'sepia' | 'dark';
const THEMES: readonly Theme[] = ['paper', 'sepia', 'dark'];

let mockVenice: MockVeniceServer;

test.beforeAll(async () => {
  mockVenice = await startMockVenice();
});

test.afterAll(async () => {
  await mockVenice.close();
});

test.beforeEach(() => {
  mockVenice.reset();
});

/**
 * Force a theme on the live document and wait one frame so the CSS-vars
 * cascade settles before the screenshot. Tokens are CSS custom properties
 * so the flip is synchronous, but a single rAF avoids capturing the page
 * mid-style-recalc on a cold cache.
 */
async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await page.waitForFunction(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    return bg !== '' && bg !== 'rgba(0, 0, 0, 0)';
  });
}

test.describe('visual', () => {
  for (const theme of THEMES) {
    test(theme, async ({ page }) => {
      const username = uniqueUsername(`vis${theme.slice(0, 3)}`);
      const password = 'correct-horse-battery';

      // Pre-seed the model id so the editor mounts the Continue-Writing
      // pill — keeps the editor screenshot consistent with full-flow.
      await page.addInitScript(() => {
        window.localStorage.setItem('inkwell:selectedModelId', 'mock-model');
      });

      // 1) Register → dashboard.
      await registerThroughUI(page, username, password);
      await applyTheme(page, theme);

      // Churny element masks reused across screenshots. Resolved inside
      // each toHaveScreenshot call so a non-matching locator just becomes
      // an empty mask (Playwright tolerates that) instead of throwing.
      const churnMasks = [
        page.getByTestId('autosave-indicator'),
        page.getByTestId('usage-indicator'),
      ];

      // 2) Create a story → editor page. Run before any modal screenshot
      //    so subsequent modal triggers have a real story context.
      await createStoryThroughUI(page, 'Visual Trial Story');
      await applyTheme(page, theme);

      // BYOK first so the ModelPicker has a populated state at the end.
      await configureVeniceBYOK(page, {
        apiKey: 'visual-test-key-XXXXXXXX',
        endpoint: mockVenice.containerBaseURL,
      });

      // Add a chapter so the editor screenshot captures Paper, not the
      // empty-state placeholder. (We don't type into it — keeps the
      // baseline deterministic.)
      await page.getByRole('button', { name: /^Add chapter$/i }).click();
      await expect(page.getByTestId('chapter-heading')).toBeVisible({ timeout: 10_000 });
      // Wait for the Paper editor surface to render before screenshotting.
      await page.locator('.ProseMirror').first().waitFor({ state: 'visible' });

      // ───────────────────────────── Surface 1: editor ─────────────────────────────
      await expect(page).toHaveScreenshot('editor.png', {
        fullPage: false,
        mask: churnMasks,
      });

      // ──────────────────────── Surface 2: CharacterSheet ──────────────────────────
      // Switch sidebar to the Cast tab, then click "Add character" — the
      // CharacterList wires that to the CharacterSheet open state.
      await page.getByTestId('sidebar-tab-cast').click();
      await page.getByTestId('character-list-add').click();
      const characterSheet = page.getByTestId('character-sheet');
      await characterSheet.waitFor({ state: 'visible' });
      await expect(page).toHaveScreenshot('character-sheet.png', { mask: churnMasks });
      await page.getByTestId('character-sheet-cancel').click();
      await expect(characterSheet).not.toBeVisible();

      // ───────────────────────── Surface 3: StoryModal ────────────────────────────
      // The StoryModal "create" form is opened from the StoryPicker's "+ New
      // story" — same trigger createStoryThroughUI uses. We open the
      // modal-mode StoryPicker first (sidebar story-picker icon), then
      // click "New story" to surface the StoryModal on top.
      await page.getByTestId('sidebar-story-picker').click();
      await page.getByTestId('story-picker').waitFor({ state: 'visible' });
      await page.getByTestId('story-picker-new').click();
      const storyModal = page.getByTestId('story-modal');
      await storyModal.waitFor({ state: 'visible' });
      await expect(page).toHaveScreenshot('story-modal.png', { mask: churnMasks });
      await page.getByTestId('story-modal-cancel').click();
      await expect(storyModal).not.toBeVisible();
      // Close the underlying StoryPicker before moving on.
      await page.getByTestId('story-picker-close').click();
      await expect(page.getByTestId('story-picker')).not.toBeVisible();

      // ─────────────────────── Surface 4: Settings (Venice) ───────────────────────
      await page
        .getByTestId('topbar')
        .getByRole('button', { name: /settings/i })
        .click();
      const settingsModal = page.getByTestId('settings-modal');
      await settingsModal.waitFor({ state: 'visible' });
      await page.getByTestId('settings-tab-venice').click();
      // Mask the masked-key last-four — its content is timestamped-ish
      // (last four of an opaque key) but stable per-run; included for
      // safety in case future copy adds churn.
      await expect(page).toHaveScreenshot('settings-venice.png', {
        mask: [...churnMasks, page.getByTestId('venice-key-last-four')],
      });
      await page.getByTestId('settings-done').click();
      await expect(settingsModal).not.toBeVisible();

      // ─────────────────────── Surface 5: AccountPrivacyModal ─────────────────────
      // Trigger lives in the UserMenu (TopBar → avatar → "Account &
      // privacy"). The menu has no testid on its trigger button, so we
      // click the avatar via its aria-label.
      await page
        .getByTestId('topbar')
        .getByRole('button', { name: /account menu|user menu|@/i })
        .first()
        .click();
      await page.getByRole('menuitem', { name: /account.*privacy/i }).click();
      const accountModal = page.getByTestId('account-privacy-modal');
      await accountModal.waitFor({ state: 'visible' });
      await expect(page).toHaveScreenshot('account-privacy.png', {
        mask: [
          ...churnMasks,
          // Recovery-code rotation timestamp + any "last changed" copy
          // the modal renders. The data-testid surface is sparse here, so
          // mask the whole modal body content area conservatively if the
          // modal exposes a timestamp testid in future.
        ],
      });
      await page.getByTestId('account-privacy-done').click();
      await expect(accountModal).not.toBeVisible();

      // ─────────────────────── Surface 6: StoryPicker (modal) ─────────────────────
      await page.getByTestId('sidebar-story-picker').click();
      const storyPicker = page.getByTestId('story-picker');
      await storyPicker.waitFor({ state: 'visible' });
      await expect(page).toHaveScreenshot('story-picker.png', { mask: churnMasks });
      await page.getByTestId('story-picker-close').click();
      await expect(storyPicker).not.toBeVisible();

      // ─────────────────────── Surface 7: ModelPicker ─────────────────────────────
      // Trigger is the "Open model picker" button inside the ChatPanel
      // header. Reachable without typing a chat message — the button is
      // present whenever ChatPanel renders.
      await page.getByRole('button', { name: /open model picker/i }).click();
      const modelPicker = page.getByTestId('model-picker');
      await modelPicker.waitFor({ state: 'visible' });
      await expect(page).toHaveScreenshot('model-picker.png', { mask: churnMasks });
      // Leaving it open at end-of-test is fine — fixture tears down the
      // page context.
    });
  }
});
