# k1r — Unified prompt-building Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every `buildPrompt` action onto a single canonical message-array shape (`system` = stable context + per-action task template; `user` = what the user contributed this turn). Closes story-editor-9ph (Chat retry on `ask` drops chapter context) as a side-effect, and removes the per-action divergence in `prompt.service.ts` and `chat.routes.ts` that produced the bug.

**Architecture:** `buildPrompt`'s system message gains the per-action task template (currently scene-only) for every action. The user message becomes a small payload (the user's literal input or a framed selection). `chat.routes.ts` history mapping becomes uniform across actions; the retry-vs-non-retry messages-array fork collapses because the trailing history entry equals what `buildUserPayload` would emit by construction.

**Tech Stack:** TypeScript strict mode, Node.js + Express + Prisma (backend), React + Vite + TanStack Query (frontend), vitest, Zod, OpenAI SDK against Venice.ai.

**Spec:** `docs/superpowers/specs/2026-05-10-k1r-prompt-building-unification-design.md` (commit `d31f957` on `convergence`).

**bd:** story-editor-k1r (P2 task) — closes story-editor-9ph as a side-effect.

**Branch:** Work on a feature branch off `convergence`, e.g. `feature/k1r-prompt-unification`. PR targets `convergence`, not `main`.

---

## Files to Create / Modify

**Backend source:**
- Modify: `backend/src/services/prompt.service.ts` — extract `buildUserPayload`, rewrite `buildPrompt` single-path, add `DEFAULT_PROMPTS.ask`, extend `UserPromptKey`, delete `renderAskUserContent`.
- Modify: `backend/src/routes/chat.routes.ts` — uniform `historyMap`, retry/non-retry unification, comment update, drop `renderAskUserContent` import.
- Modify: `backend/src/routes/user-settings.routes.ts` — add `ask` to `PatchBody.prompts`, `UserSettings.prompts`, `DEFAULT_SETTINGS.prompts`.
- Modify: `backend/src/services/user-settings-resolvers.ts` — add `ask` to `PromptsSettings`.

**Backend tests (re-blessed):**
- Modify: `backend/tests/services/prompt.service.test.ts` — flip context-block assertions from user→system; new system-content invariant.
- Modify: `backend/tests/services/prompt.actions.test.ts` — flip template-text assertions from user→system; delete `renderAskUserContent` describe block.
- Modify: `backend/tests/services/prompt.user-prompts.test.ts` — flip override-text assertions; update "freeform / ask not template-driven" describe (only `freeform` qualifies post-k1r).
- Modify: `backend/tests/services/prompt.mockup-actions.test.ts` — flip template assertions; remove `User question:` prefix assertion (the framing is gone).
- Modify: `backend/tests/routes/chat.test.ts` — re-bless retry tests; new 9ph regression test.
- Modify: `backend/tests/ai/complete.test.ts` — add system-content invariant assertion.

**Backend tests (new):**
- New tests for `buildUserPayload` matrix added to `backend/tests/services/prompt.actions.test.ts` (or a new `prompt.user-payload.test.ts` if cleaner).

**Frontend source:**
- Modify: `frontend/src/hooks/useDefaultPrompts.ts` — add `ask: string` to `DefaultPrompts`.
- Modify: `frontend/src/hooks/useUserSettings.ts` — add `ask: string | null` to `UserPromptsSettings` + `DEFAULT_SETTINGS.prompts.ask`.
- Modify: `frontend/src/components/SettingsPromptsTab.tsx` — add a `ROWS` entry for `ask`.
- Modify: `frontend/src/components/SettingsPromptsTab.stories.tsx` — extend the `DEFAULTS` fixture with the new key.

**Docs:**
- Modify: `docs/agent-rules/backend.md` — new "Canonical message-array shape" subsection in §AI integration.

---

## Task 1: Add `ask` template key end-to-end

This task is wide but mechanical: every `prompts` shape across backend + frontend gains a new `ask: string | null` slot, the API response gains an `ask` default, and the Settings → Prompts UI renders a new row automatically. No behavior change yet — `buildPrompt` continues to ignore `userPrompts.ask` until Task 3.

**Files:**
- Modify: `backend/src/services/prompt.service.ts:32-39` (UserPromptKey), `:89-102` (DEFAULT_PROMPTS)
- Modify: `backend/src/routes/user-settings.routes.ts:78-89` (PatchBody.prompts), `:121-129` (UserSettings.prompts), `:150-158` (DEFAULT_SETTINGS.prompts)
- Modify: `backend/src/services/user-settings-resolvers.ts:15-23` (PromptsSettings)
- Modify: `frontend/src/hooks/useDefaultPrompts.ts:11-19` (DefaultPrompts)
- Modify: `frontend/src/hooks/useUserSettings.ts:58-66` (UserPromptsSettings), `:148-156` (DEFAULT_SETTINGS.prompts)
- Modify: `frontend/src/components/SettingsPromptsTab.tsx:23-61` (ROWS array)
- Modify: `frontend/src/components/SettingsPromptsTab.stories.tsx` (DEFAULTS fixture)

- [ ] **Step 1: Extend `UserPromptKey` and add `DEFAULT_PROMPTS.ask`**

In `backend/src/services/prompt.service.ts`, change:

```ts
export type UserPromptKey =
  | 'system'
  | 'continue'
  | 'rewrite'
  | 'expand'
  | 'summarise'
  | 'describe'
  | 'scene';
```

to:

```ts
export type UserPromptKey =
  | 'system'
  | 'continue'
  | 'rewrite'
  | 'expand'
  | 'summarise'
  | 'describe'
  | 'scene'
  | 'ask';
```

In the same file, change `DEFAULT_PROMPTS` (currently lines 89-102) to add the `ask` entry between `scene` and the closing brace:

```ts
export const DEFAULT_PROMPTS = {
  system: DEFAULT_SYSTEM_PROMPT,
  continue:
    'Task: continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.',
  rewrite:
    'Task: rewrite the selection with different phrasing while preserving meaning and voice. Return a single alternative version.',
  expand:
    'Task: expand the selection with more detail, description, and depth. Keep the same POV, tense, and voice.',
  summarise: 'Task: summarise the selection to its essential points. Use 1–3 sentences.',
  describe:
    "Task: describe the subject of the selection with vivid sensory, physical, and emotional detail. Maintain the story's POV and tense.",
  scene:
    'Task: write a passage of prose that depicts the scene the user describes. Render the action and dialogue directly — do not summarise. Match the established voice, POV, and tense from the chapter so far. Aim for roughly 100–200 words unless the user specifies otherwise.',
  ask: "Task: answer the user's question about the story. Use the chapter and character context to inform your answer.",
} as const satisfies Record<UserPromptKey, string>;
```

- [ ] **Step 2: Extend `PromptsSettings` resolver type**

In `backend/src/services/user-settings-resolvers.ts`, change the `PromptsSettings` interface to add `ask`:

```ts
export interface PromptsSettings {
  system?: string | null;
  continue?: string | null;
  rewrite?: string | null;
  expand?: string | null;
  summarise?: string | null;
  describe?: string | null;
  scene?: string | null;
  ask?: string | null;
}
```

- [ ] **Step 3: Extend `user-settings.routes.ts` `PatchBody.prompts`, `UserSettings.prompts`, `DEFAULT_SETTINGS.prompts`**

Three matching changes in `backend/src/routes/user-settings.routes.ts`. Add the `ask` field after `scene` in each block.

`PatchBody.prompts` (currently lines 78-89):

```ts
    prompts: z
      .object({
        system: z.string().max(10_000).nullable().optional(),
        continue: z.string().max(10_000).nullable().optional(),
        rewrite: z.string().max(10_000).nullable().optional(),
        expand: z.string().max(10_000).nullable().optional(),
        summarise: z.string().max(10_000).nullable().optional(),
        describe: z.string().max(10_000).nullable().optional(),
        scene: z.string().max(10_000).nullable().optional(),
        ask: z.string().max(10_000).nullable().optional(),
      })
      .strict()
      .optional(),
```

`UserSettings.prompts` interface (currently lines 121-129):

```ts
  prompts?: {
    system?: string | null;
    continue?: string | null;
    rewrite?: string | null;
    expand?: string | null;
    summarise?: string | null;
    describe?: string | null;
    scene?: string | null;
    ask?: string | null;
  };
```

`DEFAULT_SETTINGS.prompts` constant (currently lines 150-158):

```ts
  prompts: {
    system: null as string | null,
    continue: null as string | null,
    rewrite: null as string | null,
    expand: null as string | null,
    summarise: null as string | null,
    describe: null as string | null,
    scene: null as string | null,
    ask: null as string | null,
  },
```

- [ ] **Step 4: Run backend typecheck to verify backend type changes are consistent**

Run: `npm --prefix backend run typecheck`
Expected: PASS — no type errors.

- [ ] **Step 5: Extend frontend `DefaultPrompts` and `UserPromptsSettings`**

In `frontend/src/hooks/useDefaultPrompts.ts`, change `DefaultPrompts` to:

```ts
export interface DefaultPrompts {
  system: string;
  continue: string;
  rewrite: string;
  expand: string;
  summarise: string;
  describe: string;
  scene: string;
  ask: string;
}
```

In `frontend/src/hooks/useUserSettings.ts`, change `UserPromptsSettings` to:

```ts
export interface UserPromptsSettings {
  system: string | null;
  continue: string | null;
  rewrite: string | null;
  expand: string | null;
  summarise: string | null;
  describe: string | null;
  scene: string | null;
  ask: string | null;
}
```

…and update `DEFAULT_SETTINGS.prompts` (currently lines 148-156) to:

```ts
  prompts: {
    system: null,
    continue: null,
    rewrite: null,
    expand: null,
    summarise: null,
    describe: null,
    scene: null,
    ask: null,
  },
```

- [ ] **Step 6: Add `ask` row to `SettingsPromptsTab` ROWS array**

In `frontend/src/components/SettingsPromptsTab.tsx`, append an `ask` entry to the `ROWS` constant (currently lines 23-61). The full updated array:

```tsx
const ROWS: ReadonlyArray<RowMeta> = [
  {
    key: 'system',
    label: 'System prompt',
    hint: 'Replaces the default system message sent on every AI call.',
    multiline: true,
  },
  {
    key: 'continue',
    label: 'Continue',
    hint: 'Used when continuing the story (⌥+Enter, AI panel).',
    multiline: false,
  },
  {
    key: 'rewrite',
    label: 'Rewrite / Rephrase',
    hint: 'Used by both the selection bubble and the AI panel.',
    multiline: false,
  },
  { key: 'expand', label: 'Expand', hint: 'Used when expanding a selection.', multiline: false },
  {
    key: 'summarise',
    label: 'Summarise',
    hint: 'Used when summarising a selection.',
    multiline: false,
  },
  {
    key: 'describe',
    label: 'Describe',
    hint: 'Used when describing the subject of a selection.',
    multiline: false,
  },
  {
    key: 'scene',
    label: 'Scene',
    hint: 'Used by the Scene tab — turns a scene direction into a paragraph of prose.',
    multiline: false,
  },
  {
    key: 'ask',
    label: 'Ask',
    hint: 'Used by the Chat (Ask) tab when answering questions about the story.',
    multiline: false,
  },
];
```

- [ ] **Step 7: Update Storybook fixture in `SettingsPromptsTab.stories.tsx`**

The stories file seeds the TanStack Query cache with two literals that have to match the new shapes: the `DEFAULTS: DefaultPrompts` constant and the `EverythingOverridden` story's `prompts` literal.

Edit 1 — `DEFAULTS` constant. Find the closing brace of the literal (currently after the `describe` entry, line 27) and insert an `ask` entry just before:

```tsx
  describe:
    "Task: describe the subject of the selection with vivid sensory, physical, and emotional detail. Maintain the story's POV and tense.",
  scene:
    'Task: turn the following scene direction into a paragraph of vivid prose that fits the story voice.',
  ask: "Task: answer the user's question about the story. Use the chapter and character context to inform your answer.",
};
```

Edit 2 — `EverythingOverridden` story decorator. The `prompts: { ... }` literal currently lists 7 keys explicitly (system / continue / rewrite / expand / summarise / describe / scene). Add `ask: 'Custom ask.'`:

```tsx
export const EverythingOverridden: Story = {
  decorators: [
    withQueryClient({
      ...DEFAULT_SETTINGS,
      prompts: {
        system: 'Custom system.',
        continue: 'Custom continue.',
        rewrite: 'Custom rewrite.',
        expand: 'Custom expand.',
        summarise: 'Custom summarise.',
        describe: 'Custom describe.',
        scene: 'Custom scene.',
        ask: 'Custom ask.',
      },
    }),
  ],
};
```

(The `SystemOverridden` story uses spread + override so it's unaffected by the new key.)

- [ ] **Step 8: Run frontend typecheck + frontend tests**

Run: `npm --prefix frontend run typecheck`
Expected: PASS.

Run: `npm --prefix frontend test -- --run`
Expected: PASS (no test should be exercising the `ask` row yet — adding the field is purely additive).

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/prompt.service.ts \
        backend/src/services/user-settings-resolvers.ts \
        backend/src/routes/user-settings.routes.ts \
        frontend/src/hooks/useDefaultPrompts.ts \
        frontend/src/hooks/useUserSettings.ts \
        frontend/src/components/SettingsPromptsTab.tsx \
        frontend/src/components/SettingsPromptsTab.stories.tsx
git commit -m "[k1r] add ask template key end-to-end (DEFAULT_PROMPTS, UserPromptKey, settings shape, Prompts UI row)"
```

---

## Task 2: New tests for canonical shape (RED)

Three new tests that capture the target behaviour. They must FAIL against the current shape — that's how we know they're testing what we think they're testing.

**Files:**
- Modify: `backend/tests/routes/chat.test.ts` — append new test inside the existing `POST /api/chats/:chatId/messages — retry flag` describe block.
- Modify: `backend/tests/services/prompt.service.test.ts` — append new describe block.

- [ ] **Step 1: Write the 9ph regression test in `chat.test.ts`**

The test exercises an `ask` chat with chapter content + a user question, retries the message, then asserts the messages array sent to Venice contains `Chapter so far:` somewhere.

Add this test as a new `it(...)` inside the existing `describe('POST /api/chats/:chatId/messages — retry flag', () => { ... })` block (around line 239-460):

```ts
  it('[9ph] retry on ask preserves chapter context (regression)', async () => {
    const { agent, accessToken, chapterId } = await setup('k1r-9ph-regression');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    // Chapter must have content for the test to be meaningful.
    const req = makeFakeReq(accessToken);
    await createChapterRepo(req).update(chapterId, {
      bodyJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'The dragon circled the keep before landing on the courtyard.' },
            ],
          },
        ],
      } as unknown as object,
      wordCount: 11,
    });

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'q', kind: 'ask' });
    const chatId = created.body.chat.id as string;

    // First turn — establishes a user message + assistant reply.
    queueSseResponse(fetchSpy, 'A circling sky-snake is bad news.');
    await sendMessage(agent, chatId, {
      content: 'What is the dragon doing?',
      modelId: MODEL_ID,
    });

    // Retry — models cache warm; only the stream mock is needed.
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-9ph',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'Retry reply.' }, finish_reason: null }],
        },
      ]),
    );
    const retryStatus = await sendMessage(agent, chatId, { retry: true, modelId: MODEL_ID });
    expect(retryStatus).toBe(200);

    // Inspect the SECOND completions call (the retry's outgoing wire payload).
    const completionCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCalls.length).toBeGreaterThanOrEqual(2);
    const [, retryInit] = completionCalls[completionCalls.length - 1]!;
    const retryBody = JSON.parse((retryInit as RequestInit).body as string) as Record<string, unknown>;
    const sent = retryBody.messages as Array<{ role: string; content: string }>;

    // The structural invariant: SOME message must include the chapter fragment.
    // Today (pre-k1r) this fails — the synthesisedUserMsg was dropped on retry,
    // taking chapter context with it for the `ask` action.
    expect(sent.some((m) => m.content.includes('Chapter so far:'))).toBe(true);
    expect(sent.some((m) => m.content.includes('dragon circled the keep'))).toBe(true);
  });
```

This test imports already-available helpers: `setup`, `stubVeniceFetch`, `storeKey`, `queueSseResponse`, `sseStreamResponse`, `sendMessage`, `createChapterRepo`, `makeFakeReq`, `MODEL_ID`. (`createChapterRepo` and `makeFakeReq` may need imports added at the top — they already exist in the file: see `backend/tests/routes/chat.test.ts:8-13`.)

- [ ] **Step 2: Run the regression test, confirm it FAILS**

Run: `npm --prefix backend test -- chat.test.ts -t "9ph"`
Expected: FAIL — the assertion `sent.some((m) => m.content.includes('Chapter so far:'))` is `false` because retry currently uses `[systemMsg, ...history]` and `systemMsg` for `ask` today is just `DEFAULT_SYSTEM_PROMPT` (no chapter context).

If the test passes here, something is wrong with the test itself — STOP and re-read the existing chat.routes.ts retry path lines 476-478 to confirm the bug shape before continuing.

- [ ] **Step 3: Add the system-content invariant test to `prompt.service.test.ts`**

Append a new describe block at the bottom of `backend/tests/services/prompt.service.test.ts`:

```ts
// ─── Canonical shape invariant (k1r) ─────────────────────────────────────────

describe('buildPrompt — canonical shape invariant (k1r)', () => {
  const ALL_ACTIONS: BuildPromptInput['action'][] = [
    'continue',
    'rephrase',
    'expand',
    'summarise',
    'freeform',
    'rewrite',
    'describe',
    'scene',
    'ask',
  ];

  function inputFor(action: BuildPromptInput['action']): BuildPromptInput {
    return baseInput({
      action,
      chapterContent: 'CHAPTER_BODY_SENTINEL',
      worldNotes: 'WORLD_NOTES_SENTINEL',
      characters: [{ name: 'Eira', role: 'protagonist', keyTraits: 'CHAR_TRAIT_SENTINEL' }],
      // Provide instructions for the actions that require them.
      freeformInstruction:
        action === 'scene' || action === 'ask' || action === 'freeform' ? 'do the thing' : undefined,
    });
  }

  for (const action of ALL_ACTIONS) {
    it(`action=${action}: chapter / world / characters live in messages[0] (system)`, () => {
      const out = buildPrompt(inputFor(action));
      expect(out.messages[0]?.role).toBe('system');
      expect(out.messages[0]?.content).toContain('Chapter so far:');
      expect(out.messages[0]?.content).toContain('CHAPTER_BODY_SENTINEL');
      expect(out.messages[0]?.content).toContain('World notes:');
      expect(out.messages[0]?.content).toContain('WORLD_NOTES_SENTINEL');
      expect(out.messages[0]?.content).toContain('Characters:');
      expect(out.messages[0]?.content).toContain('CHAR_TRAIT_SENTINEL');
    });

    it(`action=${action}: messages[1] (user) does NOT carry chapter / world / characters`, () => {
      const out = buildPrompt(inputFor(action));
      expect(out.messages[1]?.role).toBe('user');
      const userContent = out.messages[1]?.content ?? '';
      expect(userContent).not.toContain('CHAPTER_BODY_SENTINEL');
      expect(userContent).not.toContain('WORLD_NOTES_SENTINEL');
      expect(userContent).not.toContain('CHAR_TRAIT_SENTINEL');
    });
  }
});
```

- [ ] **Step 4: Run the invariant tests, confirm they FAIL**

Run: `npm --prefix backend test -- prompt.service.test.ts -t "canonical shape invariant"`
Expected: FAIL — for every action except `scene`, the chapter / world / character sentinels live in the user message today, not the system message.

(Scene's two tests will pass — scene already follows the canonical shape.)

- [ ] **Step 5: Add new `buildUserPayload` matrix test file**

Create `backend/tests/services/prompt.user-payload.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { buildUserPayload, type BuildPromptInput } from '../../src/services/prompt.service';

function input(overrides: Partial<BuildPromptInput> = {}): BuildPromptInput {
  return {
    action: 'continue',
    selectedText: '',
    chapterContent: '',
    characters: [],
    worldNotes: null,
    modelContextLength: 4096,
    modelMaxCompletionTokens: 4096,
    userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

describe('buildUserPayload — matrix', () => {
  describe('scene', () => {
    it('returns freeformInstruction verbatim', () => {
      expect(
        buildUserPayload(
          input({ action: 'scene', freeformInstruction: 'Jenny meets Linda on the veranda.' }),
        ),
      ).toBe('Jenny meets Linda on the veranda.');
    });
  });

  describe('ask', () => {
    it('without attachment: returns the question verbatim (no User question: prefix)', () => {
      expect(
        buildUserPayload(input({ action: 'ask', freeformInstruction: 'Why does she leave?' })),
      ).toBe('Why does she leave?');
    });

    it('with attachment: appends Attached selection: «...» after the question', () => {
      expect(
        buildUserPayload(
          input({
            action: 'ask',
            freeformInstruction: 'What is happening?',
            selectedText: 'The fire crackled.',
          }),
        ),
      ).toBe('What is happening?\n\nAttached selection: «The fire crackled.»');
    });
  });

  describe('continue', () => {
    it('with selection: returns Selection: «...»', () => {
      expect(buildUserPayload(input({ action: 'continue', selectedText: 'She fled.' }))).toBe(
        'Selection: «She fled.»',
      );
    });

    it('empty selection: returns imperative fallback "Continue."', () => {
      expect(buildUserPayload(input({ action: 'continue', selectedText: '' }))).toBe('Continue.');
    });
  });

  describe('rephrase / rewrite / expand / summarise / describe', () => {
    const cases: Array<[BuildPromptInput['action'], string]> = [
      ['rephrase', 'He said hello.'],
      ['rewrite', 'He said hello.'],
      ['expand', 'The door creaked.'],
      ['summarise', 'A long passage.'],
      ['describe', 'The man.'],
    ];
    for (const [action, sel] of cases) {
      it(`${action}: returns Selection: «...»`, () => {
        expect(buildUserPayload(input({ action, selectedText: sel }))).toBe(`Selection: «${sel}»`);
      });
    }
  });

  describe('freeform', () => {
    it('with selection: returns instruction + Selection: «...»', () => {
      expect(
        buildUserPayload(
          input({
            action: 'freeform',
            freeformInstruction: 'Rewrite as Hemingway.',
            selectedText: 'The sun rose.',
          }),
        ),
      ).toBe('Rewrite as Hemingway.\n\nSelection: «The sun rose.»');
    });

    it('without selection: returns just the instruction', () => {
      expect(
        buildUserPayload(
          input({ action: 'freeform', freeformInstruction: 'Rewrite as Hemingway.' }),
        ),
      ).toBe('Rewrite as Hemingway.');
    });
  });
});
```

- [ ] **Step 6: Run the matrix tests, confirm they FAIL on import**

Run: `npm --prefix backend test -- prompt.user-payload.test.ts`
Expected: FAIL with "buildUserPayload is not exported from prompt.service" or similar — the function does not exist yet. This is the right kind of RED.

- [ ] **Step 7: Commit the RED tests**

```bash
git add backend/tests/routes/chat.test.ts \
        backend/tests/services/prompt.service.test.ts \
        backend/tests/services/prompt.user-payload.test.ts
git commit -m "[k1r] tests: 9ph retry-context regression + canonical-shape invariants + buildUserPayload matrix (RED)"
```

---

## Task 3: Implement `buildUserPayload` and rewrite `buildPrompt`

This is the load-bearing task. After it, all three RED tests from Task 2 turn GREEN, and a swathe of older tests turn RED (their assertions are tied to the pre-k1r shape). Tasks 4-7 re-bless those.

**Files:**
- Modify: `backend/src/services/prompt.service.ts` — replace `buildTaskBlock`, `buildPrompt`, and the existing `renderAskUserContent` (kept for now; deleted in Task 10).

- [ ] **Step 1: Replace `buildTaskBlock` with `buildUserPayload`**

In `backend/src/services/prompt.service.ts`, find the `buildTaskBlock` function (currently lines 137-172) and replace it with a `buildUserPayload` export. Also keep `renderAskUserContent` for now — it gets deleted in Task 10 after `chat.routes.ts` is updated.

Replace lines 116-172 (i.e. from `// ─── Ask-action user content renderer ───` through the end of `buildTaskBlock`) with:

```ts
// ─── Ask-action user content renderer (DEPRECATED — k1r removes this in Task 10) ──
//
// Kept temporarily so chat.routes.ts continues to compile during the
// task sequence. Remove once chat.routes.ts no longer imports it.

export function renderAskUserContent({
  freeformInstruction,
  selectionText,
}: {
  freeformInstruction: string;
  selectionText?: string | null;
}): string {
  const attached = selectionText ? `\n\nAttached selection: «${selectionText}»` : '';
  return `User question: ${freeformInstruction}${attached}`;
}

// ─── Resolution helper ────────────────────────────────────────────────────────

function resolvePrompt(userPrompts: UserPrompts | undefined, key: UserPromptKey): string {
  const v = userPrompts?.[key];
  if (typeof v === 'string' && v.trim().length > 0) return v;
  return DEFAULT_PROMPTS[key];
}

// ─── User payload (per-action) ────────────────────────────────────────────────
//
// k1r: Returns the user-message body. The system message carries chapter /
// characters / world-notes / task-template; this function only emits what
// the user contributed this turn. See
// docs/superpowers/specs/2026-05-10-k1r-prompt-building-unification-design.md.

export function buildUserPayload(input: BuildPromptInput): string {
  const sel = input.selectedText.length > 0 ? `Selection: «${input.selectedText}»` : '';

  switch (input.action) {
    case 'scene': {
      if (!input.freeformInstruction) {
        throw new PromptValidationError('freeformInstruction is required for action "scene"');
      }
      return input.freeformInstruction;
    }
    case 'ask': {
      if (!input.freeformInstruction) {
        throw new PromptValidationError('freeformInstruction is required for action "ask"');
      }
      const attached = input.selectedText.length > 0
        ? `\n\nAttached selection: «${input.selectedText}»`
        : '';
      return `${input.freeformInstruction}${attached}`;
    }
    case 'continue':
      return sel.length > 0 ? sel : 'Continue.';
    case 'rephrase':
    case 'rewrite':
      return sel.length > 0 ? sel : 'Rewrite.';
    case 'expand':
      return sel.length > 0 ? sel : 'Expand.';
    case 'summarise':
      return sel.length > 0 ? sel : 'Summarise.';
    case 'describe':
      return sel.length > 0 ? sel : 'Describe.';
    case 'freeform': {
      if (!input.freeformInstruction) {
        throw new PromptValidationError('freeformInstruction is required for action "freeform"');
      }
      return sel.length > 0 ? `${input.freeformInstruction}\n\n${sel}` : input.freeformInstruction;
    }
  }
}

// ─── Per-action task template lookup ──────────────────────────────────────────
//
// k1r: every action goes through the same lookup. The single carve-out is
// `freeform` — the user's instruction carries the framing, so the system
// message has no task line for it.

function taskTemplateFor(action: PromptAction, userPrompts: UserPrompts | undefined): string {
  if (action === 'freeform') return '';
  // 'rephrase' shares the 'rewrite' override key (collapsed under [X29]).
  const key: UserPromptKey = action === 'rephrase' ? 'rewrite' : action;
  return resolvePrompt(userPrompts, key);
}
```

- [ ] **Step 2: Rewrite `buildPrompt` to a single return path**

Find the current `buildPrompt` function (currently lines 174-270, ending with the closing `}` of the function) and replace its body in full:

```ts
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const responseTokens = Math.min(input.modelMaxCompletionTokens, input.userMaxCompletionTokens);
  const includeVeniceSystemPrompt = input.includeVeniceSystemPrompt ?? true;

  const promptBudgetTokens = Math.max(
    0,
    input.modelContextLength - responseTokens - SAFETY_MARGIN_TOKENS,
  );

  const systemContent = resolvePrompt(input.userPrompts, 'system');

  const worldNotesBlock =
    input.worldNotes && input.worldNotes.length > 0 ? `World notes:\n${input.worldNotes}` : '';

  const charactersBlock =
    input.characters.length > 0
      ? `Characters:\n${input.characters
          .map((c) => {
            const role = c.role ?? '';
            const traits = c.keyTraits ?? '';
            if (role && traits) return `- ${c.name} (${role}): ${traits}`;
            if (role) return `- ${c.name} (${role})`;
            if (traits) return `- ${c.name}: ${traits}`;
            return `- ${c.name}`;
          })
          .join('\n')}`
      : '';

  const taskTemplate = taskTemplateFor(input.action, input.userPrompts);
  const userPayload = buildUserPayload(input);

  const fixedTokens =
    estimateTokens(systemContent) +
    estimateTokens(worldNotesBlock) +
    estimateTokens(charactersBlock) +
    estimateTokens(taskTemplate) +
    estimateTokens(userPayload);

  const chapterBudgetTokens = promptBudgetTokens - fixedTokens;

  let chapterText = input.chapterContent;
  if (chapterBudgetTokens <= 0) {
    chapterText = '';
  } else {
    const maxChapterChars = chapterBudgetTokens * 4;
    if (chapterText.length > maxChapterChars) {
      chapterText = chapterText.slice(chapterText.length - maxChapterChars);
    }
  }

  const chapterBlock = chapterText.length > 0 ? `Chapter so far:\n${chapterText}` : '';

  const systemParts = [
    systemContent,
    worldNotesBlock,
    charactersBlock,
    chapterBlock,
    taskTemplate,
  ].filter((p) => p.length > 0);

  return {
    messages: [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: userPayload },
    ],
    venice_parameters: { include_venice_system_prompt: includeVeniceSystemPrompt },
    max_completion_tokens: responseTokens,
  };
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm --prefix backend run typecheck`
Expected: PASS — `buildUserPayload` is now exported and matches the call site in tests.

- [ ] **Step 4: Run the new tests added in Task 2 — they must now PASS**

Run: `npm --prefix backend test -- prompt.user-payload.test.ts`
Expected: PASS (all matrix cases).

Run: `npm --prefix backend test -- prompt.service.test.ts -t "canonical shape invariant"`
Expected: PASS (all 18 invariant assertions: 9 actions × 2 sides).

Run: `npm --prefix backend test -- chat.test.ts -t "9ph"`
Expected: PASS — `messages.some(m => m.content.includes('Chapter so far:'))` is true because the systemMsg now contains the chapter block on retry.

- [ ] **Step 5: Run the full prompt-service test suite — older tests will FAIL here**

Run: `npm --prefix backend test -- prompt.service.test.ts prompt.actions.test.ts prompt.user-prompts.test.ts prompt.mockup-actions.test.ts`
Expected: many FAILs — Tasks 4-6 re-bless these. Note the failing test names so you know what each subsequent task is fixing. Don't try to fix any of them yet — they all fall to the systematic re-blessings below.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/prompt.service.ts
git commit -m "[k1r] prompt.service: extract buildUserPayload + rewrite buildPrompt single-path

System message now carries chapter/characters/world-notes/task-template for
every action; user message is buildUserPayload(input). Closes story-editor-9ph
structurally — chapter context lives in systemMsg, retry preserves it.
renderAskUserContent kept temporarily for chat.routes.ts; removed in a
follow-up task."
```

---

## Task 4: Re-bless `prompt.service.test.ts`

The original tests assert chapter / world / character / task content in `messages[1]` (user). Under k1r, those live in `messages[0]` (system). Selection-related assertions stay on `messages[1]`.

**Files:**
- Modify: `backend/tests/services/prompt.service.test.ts:155-298`

- [ ] **Step 1: Re-bless the action task block describe**

Find the `describe('buildPrompt — action task block', () => { ... })` block (currently lines 155-197) and replace its `userContent` helper with a system-content helper, since each action's task template now lives in system. Replace the body:

```ts
describe('buildPrompt — action task block', () => {
  function systemContent(input: BuildPromptInput): string {
    const result = buildPrompt(input);
    return result.messages.find((m) => m.role === 'system')?.content ?? '';
  }

  function userContent(input: BuildPromptInput): string {
    const result = buildPrompt(input);
    return result.messages.find((m) => m.role === 'user')?.content ?? '';
  }

  it('action=continue includes the "continue" instruction in system; user has the selection', () => {
    const input = baseInput({ action: 'continue', selectedText: 'She fled.' });
    expect(systemContent(input).toLowerCase()).toContain('continue');
    expect(userContent(input)).toContain('«She fled.»');
  });

  it('action=rephrase includes the "rewrite" instruction in system (collapsed under X29)', () => {
    const input = baseInput({ action: 'rephrase', selectedText: 'He said hello.' });
    expect(systemContent(input).toLowerCase()).toContain('rewrite');
    expect(userContent(input)).toContain('«He said hello.»');
  });

  it('action=expand includes the "expand" instruction in system', () => {
    const input = baseInput({ action: 'expand', selectedText: 'The door creaked.' });
    expect(systemContent(input).toLowerCase()).toContain('expand');
    expect(userContent(input)).toContain('«The door creaked.»');
  });

  it('action=summarise includes the "summarise"/"summarize" instruction in system', () => {
    const input = baseInput({ action: 'summarise', selectedText: 'A long passage.' });
    expect(systemContent(input).toLowerCase()).toMatch(/summar(i|y)s?e/);
    expect(userContent(input)).toContain('«A long passage.»');
  });

  it('action=freeform: user message contains freeformInstruction + selection; system has NO task template line', () => {
    const instruction = 'Rewrite in the style of Hemingway.';
    const input = baseInput({
      action: 'freeform',
      freeformInstruction: instruction,
      selectedText: 'Text.',
    });
    expect(userContent(input)).toContain(instruction);
    expect(userContent(input)).toContain('«Text.»');
    // freeform has no DEFAULT_PROMPTS entry; system lacks any per-action task line
    // (just systemContent + world + chars + chapter).
    expect(systemContent(input)).not.toContain(instruction);
  });
});
```

- [ ] **Step 2: Re-bless the worldNotes / characters describe**

Find `describe('buildPrompt — worldNotes and characters', () => { ... })` (currently lines 201-231) and flip the assertions to `systemContent`:

```ts
describe('buildPrompt — worldNotes and characters', () => {
  function systemContent(overrides: Partial<BuildPromptInput>): string {
    return buildPrompt(baseInput(overrides)).messages.find((m) => m.role === 'system')?.content ?? '';
  }

  it('includes worldNotes in the system message', () => {
    expect(systemContent({ worldNotes: 'The world is a vast ocean.' })).toContain(
      'The world is a vast ocean.',
    );
  });

  it('includes character name, role, and keyTraits in the system message', () => {
    expect(
      systemContent({
        characters: [{ name: 'Eira', role: 'Protagonist', keyTraits: 'brave, reckless' }],
      }),
    ).toMatch(/Eira.*Protagonist.*brave, reckless/s);
  });

  it('handles characters with null role / keyTraits gracefully', () => {
    expect(() =>
      buildPrompt(baseInput({ characters: [{ name: 'Nobody', role: null, keyTraits: null }] })),
    ).not.toThrow();
  });
});
```

- [ ] **Step 3: Re-bless the chapterContent truncation describe**

Find `describe('buildPrompt — chapterContent truncation', () => { ... })` (currently lines 235-298). Chapter content moved to system; the assertions need to look at system content. Update:

```ts
describe('buildPrompt — chapterContent truncation', () => {
  function systemContent(input: BuildPromptInput): string {
    return buildPrompt(input).messages.find((m) => m.role === 'system')?.content ?? '';
  }

  it('truncates chapterContent from the top when over budget', () => {
    const HEAD = 'HEAD_DROPPED_SENTINEL';
    const TAIL = 'TAIL_CONTENT_SURVIVES';
    const bigContent = HEAD + 'x'.repeat(200_000) + TAIL;
    const result = buildPrompt(
      baseInput({
        chapterContent: bigContent,
        modelContextLength: 4096,
        modelMaxCompletionTokens: 256,
      }),
    );
    const sys = result.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(sys).toContain(TAIL);
    expect(sys).not.toContain(HEAD);
    // Total fixed tokens (system + user) must fit in the prompt budget.
    const responseTokens = Math.min(256, Number.POSITIVE_INFINITY);
    const promptBudget = 4096 - responseTokens - 512;
    const userMsg = result.messages.find((m) => m.role === 'user')?.content ?? '';
    const totalTokens = estimateTokens(sys) + estimateTokens(userMsg);
    expect(totalTokens).toBeLessThanOrEqual(Math.max(0, promptBudget) + 10);
  });

  it('sets chapterContent to empty string when worldNotes + characters alone exceed budget', () => {
    const fatWorldNotes = 'W'.repeat(4096 * 4 * 2);
    const sys = systemContent(
      baseInput({
        worldNotes: fatWorldNotes,
        chapterContent: 'Should be gone.',
        modelContextLength: 4096,
      }),
    );
    expect(sys).toContain('W'.repeat(20));
    expect(sys).not.toContain('Should be gone.');
  });

  it('worldNotes are never truncated even when they alone exceed the budget', () => {
    const fatWorldNotes = 'W'.repeat(4096 * 4 * 2);
    expect(systemContent(baseInput({ worldNotes: fatWorldNotes, modelContextLength: 4096 }))).toContain(
      fatWorldNotes,
    );
  });

  it('characters are never truncated even when they alone exceed the budget', () => {
    const fatTraits = 'T'.repeat(4096 * 4 * 2);
    expect(
      systemContent(
        baseInput({
          characters: [{ name: 'BigChar', role: 'Hero', keyTraits: fatTraits }],
          modelContextLength: 4096,
        }),
      ),
    ).toContain(fatTraits);
  });
});
```

- [ ] **Step 4: Re-bless the existing scene describe (no functional changes, comments only)**

The scene describe (currently lines 302-363) already asserts on system / user messages correctly — no changes needed. Verify by skim-reading.

- [ ] **Step 5: Run prompt.service.test.ts — all PASS**

Run: `npm --prefix backend test -- prompt.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/services/prompt.service.test.ts
git commit -m "[k1r] re-bless prompt.service.test.ts for canonical shape (chapter/world/chars in system)"
```

---

## Task 5: Re-bless `prompt.actions.test.ts` and delete the `renderAskUserContent` describe

`prompt.actions.test.ts` has the same shape: per-action user-message assertions for the per-action template text. Flip those to system. The trailing `renderAskUserContent` describe block tests a function that's about to be deleted — remove it.

**Files:**
- Modify: `backend/tests/services/prompt.actions.test.ts`

- [ ] **Step 1: Add a `systemContent` helper alongside the existing `userContent` helper**

Near the top of `prompt.actions.test.ts` (after the `userContent` helper at line 28-31), add:

```ts
function systemContent(input: BuildPromptInput): string {
  return buildPrompt(input).messages[0]?.content ?? '';
}
```

If it already exists from Step 1 of Task 4 cross-pollination, leave the existing copy alone.

- [ ] **Step 2: Flip the per-action template assertions**

For each `describe('[V12] action=<X>', () => { ... })` block (continue, rephrase, expand, summarise, freeform), the `it('user message contains "<X>" instruction', ...)` test is wrong post-k1r. The instruction lives in system. Replace each occurrence:

For action=continue (currently line 64-86):

```ts
describe('[V12] action=continue', () => {
  it('system message contains the "continue" instruction', () => {
    const content = systemContent(baseInput({ action: 'continue', selectedText: 'She fled.' }));
    expect(content.toLowerCase()).toContain('continue');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: 'She fled.' }));
    expect(content).toContain('«She fled.»');
  });

  it('system message contains a word-count target (~80–150 words)', () => {
    const content = systemContent(baseInput({ action: 'continue', selectedText: 'She fled.' }));
    expect(content.toLowerCase()).toMatch(/\b(80|150|words?)\b/i);
  });

  it('empty selectedText: user payload is the imperative fallback "Continue." (no «…»)', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: '' }));
    expect(content).toBe('Continue.');
    expect(content).not.toContain('«');
    expect(content).not.toContain('»');
  });
});
```

For action=rephrase (currently line 90-107):

```ts
describe('[V12] action=rephrase', () => {
  it('system message contains the rewrite instruction (collapsed under X29)', () => {
    const content = systemContent(baseInput({ action: 'rephrase', selectedText: 'He said hello.' }));
    expect(content.toLowerCase()).toContain('rewrite');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'rephrase', selectedText: 'He said hello.' }));
    expect(content).toContain('«He said hello.»');
  });

  it('system message mentions preserving meaning', () => {
    const content = systemContent(baseInput({ action: 'rephrase', selectedText: 'He said hello.' }));
    expect(content.toLowerCase()).toMatch(/preserving|preserve|meaning/);
  });
});
```

For action=expand (currently line 109-126):

```ts
describe('[V12] action=expand', () => {
  it('system message contains the "expand" instruction', () => {
    const content = systemContent(baseInput({ action: 'expand', selectedText: 'The door creaked.' }));
    expect(content.toLowerCase()).toContain('expand');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'expand', selectedText: 'The door creaked.' }));
    expect(content).toContain('«The door creaked.»');
  });

  it('system message mentions detail/description/depth', () => {
    const content = systemContent(baseInput({ action: 'expand', selectedText: 'The door creaked.' }));
    expect(content.toLowerCase()).toMatch(/detail|descri|depth/);
  });
});
```

For action=summarise (currently line 128-149):

```ts
describe('[V12] action=summarise', () => {
  it('system message contains the "summarise"/"summarize" instruction', () => {
    const content = systemContent(baseInput({ action: 'summarise', selectedText: 'A long passage.' }));
    expect(content.toLowerCase()).toMatch(/summar(i|y)s?e/);
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'summarise', selectedText: 'A long passage.' }));
    expect(content).toContain('«A long passage.»');
  });

  it('system message mentions a sentence count limit', () => {
    const content = systemContent(baseInput({ action: 'summarise', selectedText: 'A long passage.' }));
    expect(content.toLowerCase()).toMatch(/sentence|1.*2.*3|essential/);
  });
});
```

For action=freeform (currently line 152-177):

```ts
describe('[V12] action=freeform', () => {
  it('user message contains freeformInstruction verbatim', () => {
    const instruction = 'Rewrite in the style of Hemingway.';
    const content = userContent(
      baseInput({ action: 'freeform', freeformInstruction: instruction, selectedText: '' }),
    );
    expect(content).toContain(instruction);
  });

  it('user message contains the selectedText (when present)', () => {
    const content = userContent(
      baseInput({
        action: 'freeform',
        freeformInstruction: 'Tighten this.',
        selectedText: 'A long passage.',
      }),
    );
    expect(content).toContain('«A long passage.»');
  });

  it('throws when freeformInstruction is missing', () => {
    expect(() =>
      buildPrompt(
        baseInput({
          action: 'freeform',
          freeformInstruction: undefined,
          selectedText: 'Text.',
        }),
      ),
    ).toThrow(/freeformInstruction/i);
  });
});
```

(Note: the original `it('empty freeformInstruction → empty string prefix (no crash)')` test asserts behavior that's now an explicit validation throw under k1r — replace with the throws-when-missing test above.)

- [ ] **Step 3: Delete the `renderAskUserContent` describe block**

Find the entire `describe('renderAskUserContent', () => { ... })` block at the end of the file (currently lines 181-236) and delete it. The function itself still exists in `prompt.service.ts` (gets removed in Task 10) but its tests have moved to `prompt.user-payload.test.ts` (the matrix tests for `ask`).

Also delete the `renderAskUserContent` import at the top of the file (currently line 11). The file's imports become:

```ts
import {
  type BuildPromptInput,
  buildPrompt,
  DEFAULT_SYSTEM_PROMPT,
} from '../../src/services/prompt.service';
```

- [ ] **Step 4: Run prompt.actions.test.ts — all PASS**

Run: `npm --prefix backend test -- prompt.actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/services/prompt.actions.test.ts
git commit -m "[k1r] re-bless prompt.actions.test.ts: action templates assert on system; drop renderAskUserContent describe (moved to user-payload matrix)"
```

---

## Task 6: Re-bless `prompt.user-prompts.test.ts`

Two things: override-text-in-user assertions flip to system; the "freeform / ask are not template-driven" describe block becomes "freeform is not template-driven" (under k1r `ask` HAS a default template + override key).

**Files:**
- Modify: `backend/tests/services/prompt.user-prompts.test.ts`

- [ ] **Step 1: Switch the override-applied helper from `userMsg` to `systemMsg`**

The file's helper currently extracts the user message. Override templates now appear in system. Replace `userMsg` (and its inner per-test invocations) with a system extractor. Add at the top of the file (after existing helpers, around line 30-43 — exact position depends on the file; place near the other helpers):

```ts
function systemMsg(input: BuildPromptInput): string {
  const result = buildPrompt(input);
  return result.messages.find((m) => m.role === 'system')?.content ?? '';
}
```

Then replace each `userMsg(...)` call site that asserts the override TEXT appears (e.g. `expect(out).toContain(custom)` or `expect(out).toContain(DEFAULT_PROMPTS[key])`) with `systemMsg(...)`.

The describe `[X29] selection text auto-appends after overridden action templates` at line 111-123 is more nuanced. Today it asserts both the (overridden) template text AND the `Selection: «...»` framing in the user message. Under k1r, the template text is in system; the selection framing is in user. Update:

```ts
describe('[X29] selection text auto-appends after overridden action templates', () => {
  it('overridden continue template lives in system; selection lives in user', () => {
    const input = baseInput({
      action: 'continue',
      selectedText: 'The dog barked.',
      userPrompts: { continue: 'CUSTOM CONTINUE INSTRUCTION.' },
    });
    expect(systemMsg(input)).toContain('CUSTOM CONTINUE INSTRUCTION.');
    expect(userMsg(input)).toBe('Selection: «The dog barked.»');
  });
});
```

Keep `userMsg` (the original helper) defined too — it's still useful for the assertions that target the user message. Both helpers coexist.

- [ ] **Step 2: Update the `freeform / ask not template-driven` describe**

Currently the block (line 127-144) asserts that `ask` and `freeform` ignore `userPrompts`. Under k1r, **`ask` now reads `userPrompts.ask`**. Replace the block:

```ts
describe('[X29] freeform is not template-driven (k1r: ask now is)', () => {
  it('freeform: userPrompts has no observable effect', () => {
    const a = userMsg(
      baseInput({
        action: 'freeform',
        freeformInstruction: 'Tell me a haiku.',
      }),
    );
    const b = userMsg(
      baseInput({
        action: 'freeform',
        freeformInstruction: 'Tell me a haiku.',
        userPrompts: { continue: 'should not appear' } as never,
      }),
    );
    expect(a).toBe(b);
  });

  it('ask: userPrompts.ask non-empty override appears in system message', () => {
    const sys = systemMsg(
      baseInput({
        action: 'ask',
        freeformInstruction: 'Why did she leave?',
        userPrompts: { ask: 'CUSTOM ASK INSTRUCTION.' },
      }),
    );
    expect(sys).toContain('CUSTOM ASK INSTRUCTION.');
  });

  it('ask: null userPrompts.ask falls back to DEFAULT_PROMPTS.ask', () => {
    const sys = systemMsg(
      baseInput({
        action: 'ask',
        freeformInstruction: 'Why?',
        userPrompts: { ask: null },
      }),
    );
    expect(sys).toContain(DEFAULT_PROMPTS.ask);
  });
});
```

- [ ] **Step 3: Update the per-action override loop to include `ask`**

Find the `ACTION_KEYS` constant near the top of the file. Currently it covers `continue`, `rewrite`, `expand`, `summarise`, `describe`, `scene`. Add `ask`:

```ts
const ACTION_KEYS = ['continue', 'rewrite', 'expand', 'summarise', 'describe', 'scene', 'ask'] as const;
```

The loop body (currently line 76-100) iterates over `ACTION_KEYS` and asserts override behavior. Switch its assertions to `systemMsg` (since templates are in system now). Replace the body:

```ts
describe('[X29] userPrompts.<action> — override behaviour', () => {
  for (const key of ACTION_KEYS) {
    const action = key === 'rewrite' ? 'rewrite' : key;
    it(`${key}: non-empty override appears in system message`, () => {
      const custom = `CUSTOM ${key.toUpperCase()} INSTRUCTION.`;
      const out = systemMsg(
        baseInput({
          action: action as BuildPromptInput['action'],
          // ask + scene need a freeformInstruction.
          freeformInstruction: action === 'ask' || action === 'scene' ? 'q' : undefined,
          userPrompts: { [key]: custom },
        }),
      );
      expect(out).toContain(custom);
    });

    it(`${key}: null falls back to DEFAULT_PROMPTS.${key}`, () => {
      const out = systemMsg(
        baseInput({
          action: action as BuildPromptInput['action'],
          freeformInstruction: action === 'ask' || action === 'scene' ? 'q' : undefined,
          userPrompts: { [key]: null },
        }),
      );
      expect(out).toContain(DEFAULT_PROMPTS[key]);
    });

    it(`${key}: whitespace-only falls back to DEFAULT_PROMPTS.${key}`, () => {
      const out = systemMsg(
        baseInput({
          action: action as BuildPromptInput['action'],
          freeformInstruction: action === 'ask' || action === 'scene' ? 'q' : undefined,
          userPrompts: { [key]: '   ' },
        }),
      );
      expect(out).toContain(DEFAULT_PROMPTS[key]);
    });
  }

  it('rephrase action also reads userPrompts.rewrite (collapsed override)', () => {
    const custom = 'CUSTOM REPHRASE.';
    const out = systemMsg(baseInput({ action: 'rephrase', userPrompts: { rewrite: custom } }));
    expect(out).toContain(custom);
  });
});
```

- [ ] **Step 4: Run prompt.user-prompts.test.ts — all PASS**

Run: `npm --prefix backend test -- prompt.user-prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/services/prompt.user-prompts.test.ts
git commit -m "[k1r] re-bless prompt.user-prompts.test.ts: overrides land in system; ask now template-driven"
```

---

## Task 7: Re-bless `prompt.mockup-actions.test.ts`

Two things: per-action template assertions flip to system; the `User question:` prefix tests (lines 90-129) need updating because the prefix is gone for the current turn under k1r (it lives in `renderAskUserContent`, which is dead post-Task 10).

**Files:**
- Modify: `backend/tests/services/prompt.mockup-actions.test.ts`

- [ ] **Step 1: Add a `systemContent` helper**

Near the top of `prompt.mockup-actions.test.ts` (after the existing `userContent` helper), add:

```ts
function systemContent(input: BuildPromptInput): string {
  return buildPrompt(input).messages[0]?.content ?? '';
}
```

- [ ] **Step 2: Re-bless the rewrite + describe describes**

For action=rewrite (currently line 29-50): flip `userContent` → `systemContent` for the assertions that target template text ("rewrite", "preserving meaning"). Keep the selection delimiter assertions on `userContent`.

```ts
describe('[V14] action=rewrite', () => {
  it('system message contains "rewrite" instruction', () => {
    const content = systemContent(baseInput({ action: 'rewrite', selectedText: 'Hello.' }));
    expect(content.toLowerCase()).toContain('rewrite');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'rewrite', selectedText: 'Hello.' }));
    expect(content).toContain('«Hello.»');
  });

  it('system message mentions preserving meaning or voice', () => {
    const content = systemContent(baseInput({ action: 'rewrite', selectedText: 'Hello.' }));
    expect(content.toLowerCase()).toMatch(/preserving|preserve|meaning|voice/);
  });

  it('system message states a single alternative version', () => {
    const content = systemContent(baseInput({ action: 'rewrite', selectedText: 'Hello.' }));
    expect(content.toLowerCase()).toMatch(/single|alternative|version|one/);
  });
});
```

For action=describe (currently line 53-75): same pattern.

```ts
describe('[V14] action=describe', () => {
  it('system message contains "describe" instruction', () => {
    const content = systemContent(baseInput({ action: 'describe', selectedText: 'The man.' }));
    expect(content.toLowerCase()).toContain('describe');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'describe', selectedText: 'The man.' }));
    expect(content).toContain('«The man.»');
  });

  it('system message mentions sensory, physical, or emotional detail', () => {
    const content = systemContent(baseInput({ action: 'describe', selectedText: 'The man.' }));
    expect(content.toLowerCase()).toMatch(/sensory|physical|emotional|detail/);
  });

  it('system message mentions maintaining POV and tense', () => {
    const content = systemContent(baseInput({ action: 'describe', selectedText: 'The man.' }));
    expect(content.toLowerCase()).toMatch(/pov|point of view|tense/);
  });
});
```

- [ ] **Step 3: Update the `action=ask` describe — drop the "User question:" prefix expectation**

Currently the block (line 77-130) asserts the user message contains `User question:`. That prefix is gone under k1r. Replace the block:

```ts
describe('[V14] action=ask', () => {
  it('user message contains the freeformInstruction verbatim', () => {
    const question = 'What motivates this character?';
    const content = userContent(
      baseInput({
        action: 'ask',
        selectedText: 'He stared into the fire.',
        freeformInstruction: question,
      }),
    );
    expect(content).toContain(question);
  });

  it('user message labels the attached selection as "Attached selection"', () => {
    const content = userContent(
      baseInput({
        action: 'ask',
        selectedText: 'He stared into the fire.',
        freeformInstruction: 'Why does he do this?',
      }),
    );
    expect(content.toLowerCase()).toContain('attached selection');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(
      baseInput({
        action: 'ask',
        selectedText: 'He stared into the fire.',
        freeformInstruction: 'Why?',
      }),
    );
    expect(content).toContain('«He stared into the fire.»');
  });

  it('throws when freeformInstruction is missing', () => {
    expect(() =>
      buildPrompt(
        baseInput({ action: 'ask', selectedText: 'Text.', freeformInstruction: undefined }),
      ),
    ).toThrow(/freeformInstruction/i);
  });

  it('user message does NOT contain the legacy "User question:" prefix (k1r)', () => {
    const content = userContent(
      baseInput({ action: 'ask', selectedText: 'Text.', freeformInstruction: 'How does this end?' }),
    );
    expect(content.toLowerCase()).not.toContain('user question');
  });

  it('system message contains the ask task template', () => {
    const content = systemContent(
      baseInput({ action: 'ask', freeformInstruction: 'How?' }),
    );
    expect(content.toLowerCase()).toMatch(/answer.*question|question.*story/);
  });
});
```

- [ ] **Step 4: Re-bless the continue word-count and smoke tests**

Currently lines 134-148 test the word-count hint in user content; flip to system:

```ts
describe('[V14] action=continue — word-count hint', () => {
  it('system message contains roughly 80–150 word target', () => {
    const content = systemContent(baseInput({ action: 'continue', selectedText: 'She looked up.' }));
    expect(content.toLowerCase()).toMatch(/\b(80|150|words?)\b/i);
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: 'She looked up.' }));
    expect(content).toContain('«She looked up.»');
  });
});
```

The "smoke" describe at the bottom (line 149) tests that user messages are non-empty for each action. Most are still non-empty (selection or instruction goes in user). For the freeform smoke at line 168, it's still passing the instruction through. Verify it still asserts on `userContent` and the assertion is just non-emptiness; if so, leave it. Otherwise update parallel to the patterns above.

- [ ] **Step 5: Run prompt.mockup-actions.test.ts — all PASS**

Run: `npm --prefix backend test -- prompt.mockup-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/services/prompt.mockup-actions.test.ts
git commit -m "[k1r] re-bless prompt.mockup-actions.test.ts: action templates in system; drop User question: prefix expectation"
```

---

## Task 8: Update `chat.routes.ts` history mapping (uniform)

Drop the `ask`-attachment-rewrap branch. Every prior user turn that has an `attachmentJson.selectionText` gets the same uniform `\n\nAttached selection: «...»` suffix appended, regardless of action.

**Files:**
- Modify: `backend/src/routes/chat.routes.ts:447-472`

- [ ] **Step 1: Replace the `historyMap` body**

Currently lines 447-472 read:

```ts
      const history = priorMessagesForHistory.map((m) => {
        const rawContent =
          typeof m.contentJson === 'string' ? m.contentJson : JSON.stringify(m.contentJson);

        // For prior user turns in an `ask` chat that carried an attachment,
        // re-synthesise the framing the prompt builder emits for the `ask`
        // action so Venice sees consistent context across turns.
        // Scene chats take the raw direction — no "User question:" framing.
        if (action === 'ask' && m.role === 'user' && m.attachmentJson != null) {
          const att = m.attachmentJson as { selectionText?: string; chapterId?: string };
          if (typeof att.selectionText === 'string') {
            return {
              role: 'user' as const,
              content: renderAskUserContent({
                freeformInstruction: rawContent,
                selectionText: att.selectionText,
              }),
            };
          }
        }

        return {
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: rawContent,
        };
      });
```

Replace with:

```ts
      // [k1r] Uniform per-action history mapping. Any prior user turn (any
      // chat kind) that carried an attachmentJson.selectionText gets the
      // same `\n\nAttached selection: «...»` suffix the current-turn user
      // payload uses (see buildUserPayload). No `User question:` prefix
      // anywhere — the role label is the provenance signal. This is the
      // change flagged in
      // docs/superpowers/specs/2026-05-10-k1r-prompt-building-unification-design.md
      // §chat.routes.ts simplifications (a).
      const history = priorMessagesForHistory.map((m) => {
        const rawContent =
          typeof m.contentJson === 'string' ? m.contentJson : JSON.stringify(m.contentJson);

        if (m.role === 'user' && m.attachmentJson != null) {
          const att = m.attachmentJson as { selectionText?: string; chapterId?: string };
          if (typeof att.selectionText === 'string' && att.selectionText.length > 0) {
            return {
              role: 'user' as const,
              content: `${rawContent}\n\nAttached selection: «${att.selectionText}»`,
            };
          }
        }

        return {
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: rawContent,
        };
      });
```

- [ ] **Step 2: Verify the file still compiles**

Run: `npm --prefix backend run typecheck`
Expected: PASS.

(`renderAskUserContent` is still imported at line 28 but no longer used in the function body. The import will be removed in Task 10 along with the function deletion. TypeScript / lint may complain about the unused import at this stage; if biome flags it, leave the warning — Task 10 cleans it up. If the build is strict and rejects unused imports, suppress with a `// biome-ignore lint/correctness/noUnusedImports: removed in Task 10` line directly above the import.)

- [ ] **Step 3: Run chat.test.ts — should still PASS**

Run: `npm --prefix backend test -- chat.test.ts`
Expected: PASS — including the 9ph regression test (already green from Task 3) and any retry / scene tests. The `ask`-with-attachment branch wasn't covered by any explicit test today, so the rewrite is invisible to the existing suite.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/chat.routes.ts
git commit -m "[k1r] chat.routes: uniform historyMap (drop ask-attachment-rewrap branch); attachment framing now applies to any prior user turn with an attachment"
```

---

## Task 9: Update `chat.routes.ts` messages-array (retry/non-retry unification)

The retry-vs-non-retry fork at lines 476-478 collapses because the trailing history entry equals what `buildUserPayload` would emit for the same inputs.

**Files:**
- Modify: `backend/src/routes/chat.routes.ts:473-478`

- [ ] **Step 1: Update the messages-array assembly + comment**

Currently lines 473-478 read:

```ts
      // [SC6] On retry the trailing user turn is already in `history`; do
      // NOT append synthesisedUserMsg again or the model would see a
      // duplicate user turn. On a normal turn, append as usual.
      const messages: Array<{ role: MessageRole; content: string }> = body.retry
        ? [systemMsg, ...history]
        : [systemMsg, ...history, synthesisedUserMsg];
```

Replace with:

```ts
      // [k1r] On retry the trailing history entry equals what
      // buildUserPayload would emit for the same inputs (both are built from
      // lastUserMsg.contentJson + lastUserMsg.attachmentJson under the
      // unified history mapping). So the retry path uses [systemMsg, ...history]
      // and the trailing entry IS the user message — chapter / characters /
      // world-notes context lives in systemMsg in both branches, so the
      // 9ph context-loss bug is structurally impossible.
      const messages: Array<{ role: MessageRole; content: string }> = body.retry
        ? [systemMsg, ...history]
        : [systemMsg, ...history, synthesisedUserMsg];
```

The code itself doesn't change — both branches were correct semantically already. The comment reflects that the equivalence is now structural rather than coincidental.

- [ ] **Step 2: Run chat.test.ts**

Run: `npm --prefix backend test -- chat.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/chat.routes.ts
git commit -m "[k1r] chat.routes: update [SC6] comment — retry and non-retry use the same shape; 9ph fixed structurally"
```

---

## Task 10: Delete `renderAskUserContent`

The function has no remaining callers (chat.routes.ts no longer uses it; the test that referenced it was removed in Task 5).

**Files:**
- Modify: `backend/src/services/prompt.service.ts` — delete `renderAskUserContent` export.
- Modify: `backend/src/routes/chat.routes.ts` — drop the import.

- [ ] **Step 1: Verify no remaining callers via grep**

Run: `grep -rEn "renderAskUserContent" backend/src backend/tests`
Expected: hits only on `backend/src/services/prompt.service.ts` (the function definition) and `backend/src/routes/chat.routes.ts` (the import). If anything else surfaces, STOP and read the call site — re-blessing in the earlier tasks may have missed something.

- [ ] **Step 2: Delete the function and its preceding comment block in prompt.service.ts**

Remove the entire block introduced in Task 3 Step 1:

```ts
// ─── Ask-action user content renderer (DEPRECATED — k1r removes this in Task 10) ──
//
// Kept temporarily so chat.routes.ts continues to compile during the
// task sequence. Remove once chat.routes.ts no longer imports it.

export function renderAskUserContent({
  freeformInstruction,
  selectionText,
}: {
  freeformInstruction: string;
  selectionText?: string | null;
}): string {
  const attached = selectionText ? `\n\nAttached selection: «${selectionText}»` : '';
  return `User question: ${freeformInstruction}${attached}`;
}
```

- [ ] **Step 3: Drop the `renderAskUserContent` import in chat.routes.ts**

In `backend/src/routes/chat.routes.ts`, the import block at line 25-29 currently reads:

```ts
import {
  buildPrompt,
  type CharacterContext,
  renderAskUserContent,
} from '../services/prompt.service';
```

Replace with:

```ts
import { buildPrompt, type CharacterContext } from '../services/prompt.service';
```

If a `// biome-ignore` line was added in Task 8 step 2, remove it too.

- [ ] **Step 4: Verify no remaining callers**

Run: `grep -rEn "renderAskUserContent" backend/src backend/tests`
Expected: zero hits. If any remain, repeat the search and trace each.

- [ ] **Step 5: Run typecheck + full backend tests**

Run: `npm --prefix backend run typecheck`
Expected: PASS.

Run: `npm --prefix backend test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/prompt.service.ts backend/src/routes/chat.routes.ts
git commit -m "[k1r] delete renderAskUserContent — no remaining callers after history-map unification"
```

---

## Task 11: Re-bless `ai/complete.test.ts` — add system-content invariant

The shape change is invisible to most `ai/complete.test.ts` assertions (they hit the wire and don't deeply inspect the messages array). One pre-existing test (line 401: "Venice request carries the prompt builder messages and max_completion_tokens") gets a tightened assertion.

**Files:**
- Modify: `backend/tests/ai/complete.test.ts:401-433`

- [ ] **Step 1: Add a system-content assertion to the existing wire-payload test**

Find the `it('Venice request carries the prompt builder messages and max_completion_tokens', ...)` test (currently around line 401). After the existing assertions, append:

```ts
    // [k1r] Canonical-shape invariant: chapter context lives in system, not user.
    const messages = requestBody.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe('system');
    // The setupStoryAndChapter helper writes a non-empty chapter body, so
    // 'Chapter so far:' must appear in the system message.
    expect(messages[0]?.content).toContain('Chapter so far:');
```

(Adjust the variable name `messages` if it collides with a local — pick a unique name like `wireMessages`.)

- [ ] **Step 2: Run ai/complete.test.ts — all PASS**

Run: `npm --prefix backend test -- ai/complete.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full backend test suite for safety**

Run: `npm --prefix backend test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/ai/complete.test.ts
git commit -m "[k1r] ai/complete.test: assert canonical-shape invariant (chapter in system) on the wire"
```

---

## Task 12: Document the canonical message-array shape

Add a subsection to `docs/agent-rules/backend.md` so future agents inherit the convention.

**Files:**
- Modify: `docs/agent-rules/backend.md` (insert subsection after line 91, before §Encryption at rest)

- [ ] **Step 1: Insert subsection**

In `docs/agent-rules/backend.md`, after the existing `prompt_cache_key` bullet (around line 91) and before the `## Encryption at rest (backend lane)` heading at line 93, insert:

```markdown
- **Canonical message-array shape (k1r).** Every action goes through the
  same code path in `buildPrompt`. The `system` message carries everything
  stable across turns (system prompt + world-notes + characters + chapter +
  per-action task template); the `user` message carries only what the user
  contributed this turn. No `if (action === ...)` branches in `buildPrompt`'s
  system-message assembly. Per-action `freeformInstruction`-required
  validation lives in `buildUserPayload`'s switch arms (`scene` / `ask` /
  `freeform`). New actions inherit this shape automatically — add a
  `DEFAULT_PROMPTS.<action>` entry, a `UserPromptKey` member, a
  `buildUserPayload` arm describing the user payload, and the rest is free.
  See
  `docs/superpowers/specs/2026-05-10-k1r-prompt-building-unification-design.md`
  for rationale (why `ask` was special pre-k1r, why we unified).

```

(Keep an empty trailing line so the section transition stays clean.)

- [ ] **Step 2: Commit**

```bash
git add docs/agent-rules/backend.md
git commit -m "[k1r] docs/agent-rules/backend.md: canonical message-array shape subsection"
```

---

## Task 13: Manual verification — Settings UI + L-series live test

Two manual checks that don't have automated coverage:
1. The Settings → Prompts UI surfaces the new `ask` row.
2. L-series: `ask` and `continue` against a real Venice endpoint produce no quality regression vs. main.

**Files:** None (verification only).

- [ ] **Step 1: Storybook check — Prompts tab has 8 rows including Ask**

Run: `npm --prefix frontend run storybook`
Open the browser to the URL Storybook prints. Navigate: Components → SettingsPromptsTab → Default story.
Expected: 8 rows visible (System, Continue, Rewrite/Rephrase, Expand, Summarise, Describe, Scene, **Ask**). The Ask row shows the default text from `DEFAULT_PROMPTS.ask`. Toggle "Override default" — input appears with seeded text.

If the Ask row is missing, re-check Task 1 step 6 (`ROWS` array) and Task 1 step 7 (Storybook fixture).

- [ ] **Step 2: Dev-stack check — Ask override persists end-to-end**

Run: `make dev` (or restart if it's already up).
Log into the app, open Settings → Prompts, scroll to Ask, tick "Override default", change the text, blur. Reload the page; confirm the override persists.
Expected: PATCH succeeds (network tab shows 200), settings round-trip preserves the new `ask` value.

- [ ] **Step 3: L-series live verification setup**

Read `backend/.env.live` to confirm a live Venice key is configured.
Run: `cd backend && npm run venice:probe -- --model <a-model-id-from-list>`
Expected: a working chat completion against Venice (sanity that the live path is up).

If `backend/.env.live` doesn't exist, follow the `[L]` setup notes in CLAUDE.md to create one with a spending-capped key. L-series is not a CI gate; if you don't have a live key handy, document the skip in your hand-off summary and proceed to Task 14.

- [ ] **Step 4: L-series — `ask` chat quality**

Run the live test for chat (the existing live spec covers this — find it under `backend/tests/live/`):

Run: `cd backend && npm run test:live -- chat`
Expected: passes; the chat reply mentions the chapter content (proving system-side context arrived).

If you have time, do a manual side-by-side: ask the same question against a chapter on `convergence@before-k1r` and again on the post-k1r commit. Eyeball whether quality is flat or improved. Per spec §L-series, expectation is flat or marginally better.

- [ ] **Step 5: L-series — `continue` quality**

Run: `cd backend && npm run test:live -- complete`
Expected: passes; the continuation matches voice/POV at the same level as before.

Same eyeball test as above for one inline AI action.

- [ ] **Step 6: Record findings in your hand-off**

Capture in your end-of-task summary: 8-row Storybook screenshot OK / not OK; ask-override persistence OK / not OK; L-series ask + continue OK / regression. Any visible regression is a blocker — do not proceed to Task 14.

---

## Task 14: Hand off via /bd-close-reviewed

After every prior task is green and the manual checks in Task 13 pass:

- [ ] **Step 1: Push the feature branch and open the PR against `convergence`**

```bash
git push -u origin feature/k1r-prompt-unification
gh pr create --base convergence --title "[k1r] Unified prompt-building: canonical message-array shape (closes 9ph)" --body "$(cat <<'EOF'
## Summary
- Single canonical message-array shape for all 9 buildPrompt actions: system carries stable context + per-action task template; user carries what the user contributed this turn.
- Adds `ask` template to DEFAULT_PROMPTS + UserPromptKey + Settings UI override.
- Closes story-editor-9ph (Chat retry on `ask` drops chapter context) structurally — chapter context lives in systemMsg, retry preserves it. New regression test at chat.test.ts asserts the invariant.
- Drops `renderAskUserContent` and the chat.routes.ts ask-attachment-rewrap branch (history mapping is now uniform).

Spec: `docs/superpowers/specs/2026-05-10-k1r-prompt-building-unification-design.md`
Plan: `docs/superpowers/plans/2026-05-10-k1r-prompt-building-unification.md`

## Test plan
- [x] backend: `npm --prefix backend test` (full suite green)
- [x] backend: 9ph regression test asserts retry preserves chapter context
- [x] backend: canonical-shape invariant tests across all 9 actions
- [x] frontend: `npm --prefix frontend test` green; `npm --prefix frontend run typecheck` green
- [x] manual: Storybook → SettingsPromptsTab shows the Ask row with default text
- [x] manual: dev-stack ask-override persists end-to-end
- [ ] L-series: `npm run test:live` — ask quality flat / improved against a stable chapter
- [ ] L-series: `npm run test:live` — continue quality flat / improved

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Invoke `/bd-close-reviewed` for k1r**

Run: `/bd-close-reviewed story-editor-k1r`
Expected: typecheck PASS for both workspaces; verify-line PASS; security-reviewer skipped (no auth/crypto/middleware changes); repo-boundary-reviewer dispatched (touches `backend/src/routes/chat.routes.ts` + `backend/src/services/prompt.service.ts`); CLEAN finding; bd close.

- [ ] **Step 3: Close 9ph as a side-effect**

The 9ph regression test in `chat.test.ts` is the structural guarantee. After k1r closes:

Run: `/bd-close-reviewed story-editor-9ph --reason="Closed structurally by story-editor-k1r — chapter context now lives in systemMsg, retry preserves it by construction. Regression test at backend/tests/routes/chat.test.ts asserts the invariant."`
Expected: 9ph's verify-line is `cd backend && npm test -- chat.test.ts`, which passes; close-gate proceeds.

- [ ] **Step 4: Final summary to the user**

In your hand-off, note:
- PR number + URL.
- L-series findings.
- Any concerns deferred (none expected).
- Pointer to `/bd-execute story-editor-3y0` (the next blocking-PR-#90 follow-up: copy-button shared hook).

---

## Self-Review Notes

After writing this plan, the implementer should be able to walk it linearly. Two cross-task references worth flagging:

- **Task 3 leaves `renderAskUserContent` in the source temporarily** (Step 1 keeps it as a deprecation-marked export). Task 10 deletes it. The chain is correct but unusual; if anything goes wrong between Task 3 and Task 10, the function is still callable so nothing breaks.
- **Task 5 deletes the `renderAskUserContent` describe block in `prompt.actions.test.ts`** while the function still exists in source. That's intentional — the matrix coverage in `prompt.user-payload.test.ts` (Task 2 Step 5) supersedes those tests. The function is undertested between Task 5 and Task 10 (only matrix tests cover its semantics indirectly). Task 10's grep confirms it has no callers and removes it cleanly.

If the implementer wants to be extra defensive, they can run `npm --prefix backend test` after every task, not just the touch-the-current-file subset. The full suite is fast (~30s).

---

## Branch / Commit / Push Discipline

- Work on `feature/k1r-prompt-unification` off `convergence`.
- Each task's Step N commits with a `[k1r] <short-line>` message and a body where the change is more than mechanical.
- No `git commit --amend` — every task lands as a fresh commit, even if the previous task's commit is one line.
- Don't push until after Task 13 passes — Task 14 Step 1 does the first push as part of opening the PR.
