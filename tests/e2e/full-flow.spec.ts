// [T8 + T8.1] Full-flow Playwright spec — tier-2 PR-blocking E2E.
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
//   → wait for autosave "Saved · …" indicator (T8.1 part 1)
//   → AI Continue (pill click)
//   → assert streamed response from the mock arrives in the UI
//   → assert UsageIndicator surfaces the mock's rate-limit headers
//     (T8.1 part 2 — UsageIndicator now mounts inside ContinueWriting,
//     restoring the F16 surface that was orphaned when AIPanel was
//     unmounted at F55)
//   → assert the mock saw a chat-completion request
//
// Venice is mocked in-process (tests/e2e/fixtures/mock-venice.ts). The
// backend container reaches it via host.docker.internal — opted in by
// extra_hosts in docker-compose.override.yml. The user's stored BYOK
// `endpoint` field steers the per-user OpenAI client at the mock.
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

test('register → BYOK → story → chapter → type → Saved ✓ → AI Continue → usage indicator', async ({
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

  // 6) [T8.1] Autosave round-trip. The autosave hook debounces 4s; once it
  //    fires and the PATCH succeeds, the TopBar's AutosaveIndicator flips
  //    to "Saved · …". This proves typed content actually round-trips
  //    through the encrypted chapter repo to the DB — the assertion that
  //    was dropped from T8 because the page-level useEffect on
  //    [activeChapterId, chapterQuery.data] was wiping `draftBodyJson`
  //    on a late-arriving query resolve, before the debounce fired.
  await expect(page.getByText(/saved\s*·/i)).toBeVisible({ timeout: 20_000 });

  // 7) Trigger AI Continue. The dashed "Continue writing" pill below the
  //    editor invokes the same code path as the ⌥+Enter shortcut.
  await page.getByRole('button', { name: /continue writing/i }).click();

  // 8) Assert the streamed text from the mock arrives in the
  //    Continue-Writing region. Mock streams "The ", "rain ", "fell."
  //    — full concat is "The rain fell.". This is the stack-level
  //    guarantee unit tests cannot make: BYOK key → per-user Venice
  //    client → mock endpoint → SSE forwarded through the backend →
  //    consumed by the frontend's streaming reader.
  await expect(page.getByText('The rain fell.', { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  // 9) [T8.1] UsageIndicator surfaces the mock's rate-limit headers. The
  //    backend forwards `x-ratelimit-remaining-*` from the upstream
  //    response onto its own `x-venice-remaining-*` headers; the frontend
  //    parses them in useAICompletion and renders them via
  //    <UsageIndicator>. Format: "<requests> requests / <tokens> tokens
  //    remaining" — `formatRequests`/`formatTokens` produce "4.2K" and
  //    "988K" for the mock's fixed 4242 / 987654 values.
  await expect(page.getByLabel(/venice usage/i)).toContainText(/4\.2K\s*requests/i, {
    timeout: 5_000,
  });
  await expect(page.getByLabel(/venice usage/i)).toContainText(/988K\s*tokens/i);

  // 10) Mock saw a chat-completion call (at least one — Continue Writing
  //     fires `/v1/chat/completions` once per click).
  expect(mockVenice.callCount()).toBeGreaterThanOrEqual(1);
});
