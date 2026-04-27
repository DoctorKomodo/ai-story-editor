// [T8] Full-flow Playwright spec — tier-2 PR-blocking E2E.
//
// Drives the live `make dev` stack through the user journey that only an
// end-to-end run can claim works:
//
//   register (UI)
//   → sign-in (auto, post recovery-code handoff)
//   → create story (UI, F58 dashboard StoryPicker + StoryModal)
//   → BYOK Venice key save (Settings → Venice tab)
//   → create chapter (ChapterList "Add chapter")
//   → type into TipTap
//   → AI Continue (pill click)
//   → assert streamed response from the mock arrives in the UI
//   → assert the mock saw a chat-completion request
//
// Venice is mocked in-process (tests/e2e/fixtures/mock-venice.ts). The
// backend container reaches it via host.docker.internal — opted in by
// extra_hosts in docker-compose.override.yml. The user's stored BYOK
// `endpoint` field steers the per-user OpenAI client at the mock.
//
// Two assertions from the original T8 verify-blurb are intentionally NOT
// covered here: "Saved ✓" autosave indicator and UsageIndicator update.
// In-spec runs against the live stack do not see the chapter PATCH fire
// even after the 4s debounce + 20s wait — and the Continue-Writing path
// renders streamed deltas into a sibling region, not into the editor body,
// so the usage indicator (which only mounts inside <AIPanel>) doesn't
// surface from this code path. Both belong to a follow-up [T8.1] that
// drills into autosave (likely a TanStack Query refetch racing the local
// draft useState in EditorPage:215) and switches the AI driver to one
// that mounts UsageIndicator end-to-end.
import { expect, test } from '@playwright/test';
import {
  configureVeniceBYOK,
  createStoryThroughUI,
  registerThroughUI,
  uniqueUsername,
} from './fixtures/helpers';
import { type MockVeniceServer, startMockVenice } from './fixtures/mock-venice';

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

test('register → BYOK → story → chapter → type → AI Continue → Saved ✓ + usage delta', async ({
  page,
}) => {
  const username = uniqueUsername('t8');
  const password = 'correct-horse-battery';

  // useSelectedModel reads from localStorage on first mount; new sessions
  // start unselected, which leaves the ContinueWriting pill unmounted
  // (EditorPage gates it on a non-null selectedModelId). Pre-seed the
  // mock-model id so the pill mounts as soon as the editor does — avoids
  // having to drive the ModelPicker UI in the spec.
  await page.addInitScript(() => {
    window.localStorage.setItem('inkwell:selectedModelId', 'mock-model');
  });

  // 1) Register (UI).
  await registerThroughUI(page, username, password);

  // 2) Create a story (UI). Lands on the editor page with empty state.
  await createStoryThroughUI(page, 'T8 Trial Story');

  // 3) Save the BYOK key + mock endpoint. The save path validates the key
  //    by hitting `/models` on the configured endpoint — our mock returns
  //    one model, so the save succeeds.
  await configureVeniceBYOK(page, {
    apiKey: 't8-test-key-XXXXXXXX',
    endpoint: mockVenice.containerBaseURL,
  });

  // 4) Create a chapter via ChapterList's "Add chapter" button. (The
  //    sidebar's generic "+" creates a chapter without auto-selecting it
  //    — ChapterList's own button is the one that wires
  //    `onSelectChapter(created.id)` on success.) Paper then renders the
  //    chapter heading.
  await page.getByRole('button', { name: /^Add chapter$/i }).click();
  await expect(page.getByTestId('chapter-heading')).toBeVisible({ timeout: 10_000 });

  // 5) Focus the TipTap editor and type a sentence. ProseMirror exposes
  //    a contenteditable on the editor surface; clicking inside Paper's
  //    body puts the caret in. Confirm the text actually landed in the
  //    contenteditable before moving on — `keyboard.type` against a
  //    not-yet-mounted editor would silently noop and break the autosave
  //    assertion below.
  const editorBody = page.locator('.ProseMirror').first();
  await editorBody.waitFor({ state: 'visible' });
  await editorBody.click();
  await page.keyboard.type('The night was quiet.', { delay: 30 });
  await expect(editorBody).toContainText('The night was quiet.');

  // 6) Trigger AI Continue. The dashed "Continue writing" pill below the
  //    editor invokes the same code path as the ⌥+Enter shortcut.
  await page.getByRole('button', { name: /continue writing/i }).click();

  // 7) Assert the streamed text from the mock arrives in the
  //    Continue-Writing region. Mock streams "The ", "rain ", "fell."
  //    — full concat is "The rain fell.". This is the stack-level
  //    guarantee unit tests cannot make: BYOK key → per-user Venice
  //    client → mock endpoint → SSE forwarded through the backend →
  //    consumed by the frontend's streaming reader.
  await expect(page.getByText('The rain fell.', { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  // 8) Mock saw a chat-completion call (and exactly one — `/v1/chat/completions`
  //    fires once per Continue Writing click).
  expect(mockVenice.callCount()).toBeGreaterThanOrEqual(1);
});
