# X29 — Settings → Prompts tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings → Prompts tab where users override the system prompt and 5 action templates (continue, rewrite, expand, summarise, describe) at the user level. Each row shows the built-in default read-only by default; ticking "Override default" enables an editable field seeded with the default. Per-story `Story.systemPrompt` (column + repo path + dead Models-tab UI) is removed entirely.

**Architecture:** New `settingsJson.prompts` slice (six `string | null` fields). `prompt.service.ts` exports `DEFAULT_PROMPTS` and accepts a `userPrompts` map; `buildTaskBlock` resolves per-action via `userPrompts[action]?.trim() || DEFAULT_PROMPTS[action]`. Selection text auto-append (`\n\nSelection: «…»`) stays inside the builder. New `GET /api/ai/default-prompts` returns the constants for the frontend to render read-only. Frontend gains a `SettingsPromptsTab` and a `useDefaultPrompts` hook; Settings tab strip gains "Prompts" between "Writing" and "Appearance" (placement details below). Single Prisma migration drops three `Story` columns.

**Tech Stack:** TypeScript (strict), Express, Prisma, Zod, Vitest, React, TanStack Query, Tailwind v4, Storybook 9.

**Spec:** `docs/superpowers/specs/2026-05-04-x29-prompts-tab-design.md`
**Branch:** `feature/x29-prompts-tab` (off `origin/main`, already cut)

---

## File Structure

**Backend — created:**
- `backend/src/routes/ai-defaults.routes.ts` — `GET /api/ai/default-prompts`
- `backend/tests/routes/ai-defaults.test.ts`
- `backend/tests/services/prompt.user-prompts.test.ts` — replaces `prompt.system-prompt.test.ts` (renamed)
- `backend/prisma/migrations/20260504000000_drop_story_system_prompt/migration.sql`

**Backend — modified:**
- `backend/src/services/prompt.service.ts` — export `DEFAULT_PROMPTS`, refactor `buildTaskBlock`, drop `storySystemPrompt`, add `userPrompts`
- `backend/src/routes/ai.routes.ts` — drop `storySystemPrompt`; pass `userPrompts`
- `backend/src/routes/chat.routes.ts` — drop `storySystemPrompt`; pass `userPrompts`
- `backend/src/routes/user-settings.routes.ts` — extend Zod + defaults with `prompts` slice
- `backend/src/routes/stories.routes.ts` — drop `systemPrompt` from schemas + handlers
- `backend/src/repos/story.repo.ts` — drop `systemPrompt` from `ENCRYPTED_FIELDS`, `StoryCreateInput`, `StoryUpdateInput`, encrypt/update branches
- `backend/src/index.ts` — mount the new ai-defaults router
- `backend/prisma/schema.prisma` — drop the three `systemPrompt*` columns + comment

**Backend — deleted:**
- `backend/tests/services/prompt.system-prompt.test.ts` (renamed → user-prompts)

**Backend — touched (fixture / assertion sweep):**
- `backend/tests/security/encryption-leak.test.ts` — drop `systemPrompt` sentinel
- `backend/tests/repos/story.repo.test.ts` — drop systemPrompt round-trip
- `backend/tests/routes/stories.test.ts` — drop `systemPrompt` PATCH/POST cases
- `backend/tests/routes/story-detail.test.ts` — drop `systemPrompt` assertions
- `backend/tests/routes/chat-messages-list.test.ts` — drop `systemPrompt` from fixture
- `backend/tests/ai/complete.test.ts` — drop from fixture
- `backend/tests/ai/chat-citations.test.ts` — drop from fixture
- `backend/tests/ai/chat-persistence.test.ts` — drop from fixture
- `backend/tests/models/story-encrypted.test.ts` — drop systemPrompt assertions
- `backend/tests/models/story-settings.test.ts` — update comment + drop systemPromptCiphertext check
- `backend/tests/routes/user-settings.test.ts` — add `prompts` slice round-trip + deep-merge cases

**Frontend — created:**
- `frontend/src/components/SettingsPromptsTab.tsx`
- `frontend/src/components/SettingsPromptsTab.stories.tsx`
- `frontend/src/hooks/useDefaultPrompts.ts`
- `frontend/tests/components/Settings.prompts.test.tsx`
- `frontend/tests/hooks/useDefaultPrompts.test.tsx`

**Frontend — modified:**
- `frontend/src/hooks/useUserSettings.ts` — add `UserPromptsSettings`, extend `UserSettings`/`DEFAULT_SETTINGS`/`mergeSettings`/`UserSettingsPatch`
- `frontend/src/components/Settings.tsx` — add `'prompts'` to `SettingsTab`, insert tab + panel renderer
- `frontend/src/components/SettingsModelsTab.tsx` — delete the system-prompt section + per-story plumbing
- `frontend/src/hooks/useStories.ts` — drop `systemPrompt` from `Story`, `StoryDetail`, `UpdateStoryInput`
- `frontend/src/components/StoryPicker.stories.tsx` — drop `systemPrompt: null` from fixtures
- `frontend/tests/components/Settings.models.test.tsx` — drop per-story system-prompt scenarios
- `frontend/tests/routing.test.tsx` — drop `systemPrompt: null` fixture
- `frontend/tests/pages/editor-shell.integration.test.tsx` — same
- `frontend/tests/pages/editor.test.tsx` — same

**Docs — modified:**
- `docs/api-contract.md` — Story shape; new `/api/ai/default-prompts` section; user-settings schema (`prompts` slice)
- `docs/encryption.md` — drop `Story.systemPrompt` from encrypted-fields list
- `docs/venice-integration.md` — add § Prompt resolution chain
- `TASKS.md` — tick `[X29]` with `verify:` + plan link

---

## Sequencing notes

- **TDD applies to additions** (new exports, new routes, new hooks, new tab). For *removals* (dropping `Story.systemPrompt`), the pattern is: change code → watch tests fail → update or delete the affected tests → green again. We bundle related removals so we don't ship a half-broken intermediate.
- **Phases are landed as single commits** to keep `main` green-equivalent at every commit boundary. A phase = "logically one change" (e.g. "add `userPrompts` to the builder + tests" is one commit, "drop `Story.systemPrompt` everywhere" is another).
- **The schema migration lands late** (Phase E), after all repo/route reads have been migrated to the new shape. Never drop a column the running code still reads.

---

## Phase A — Prompt-builder: add `DEFAULT_PROMPTS` + `userPrompts`, drop `storySystemPrompt`

### Task 1: Rename existing `prompt.system-prompt.test.ts` → `prompt.user-prompts.test.ts` and rewrite assertions for the new shape

**Files:**
- Delete: `backend/tests/services/prompt.system-prompt.test.ts`
- Create: `backend/tests/services/prompt.user-prompts.test.ts`

- [ ] **Step 1: Delete the old file**

```bash
rm backend/tests/services/prompt.system-prompt.test.ts
```

- [ ] **Step 2: Create the new test file**

```ts
// backend/tests/services/prompt.user-prompts.test.ts
//
// [X29] User-level prompt overrides — replaces V13 per-story override behaviour.
// Verifies:
//   1. userPrompts.system overrides DEFAULT_SYSTEM_PROMPT when non-empty.
//   2. userPrompts[action] overrides the built-in action template when non-empty.
//   3. null / undefined / '' / whitespace-only fall back to defaults.
//   4. Selection auto-append still happens for overridden action templates.
//   5. include_venice_system_prompt is independent of userPrompts.system.
//   6. freeform / ask actions are not template-driven and ignore userPrompts.

import { describe, expect, it } from 'vitest';
import {
  type BuildPromptInput,
  buildPrompt,
  DEFAULT_PROMPTS,
  DEFAULT_SYSTEM_PROMPT,
} from '../../src/services/prompt.service';

function baseInput(overrides: Partial<BuildPromptInput> = {}): BuildPromptInput {
  return {
    action: 'continue',
    selectedText: 'She ran.',
    chapterContent: 'A stormy night.',
    characters: [],
    worldNotes: null,
    modelContextLength: 4096,
    ...overrides,
  };
}

function systemMsg(input: BuildPromptInput): string {
  return buildPrompt(input).messages[0]?.content ?? '';
}

function userMsg(input: BuildPromptInput): string {
  return buildPrompt(input).messages[1]?.content ?? '';
}

// ─── system-prompt override ────────────────────────────────────────────────────

describe('[X29] userPrompts.system — override behaviour', () => {
  it('non-empty → system message equals override', () => {
    const custom = 'You are a gothic horror novelist.';
    expect(systemMsg(baseInput({ userPrompts: { system: custom } }))).toBe(custom);
  });

  it('null → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ userPrompts: { system: null } }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('undefined → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ userPrompts: {} }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('empty string → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ userPrompts: { system: '' } }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('whitespace-only → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ userPrompts: { system: '   ' } }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('userPrompts undefined entirely → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput())).toBe(DEFAULT_SYSTEM_PROMPT);
  });
});

// ─── action-template overrides ─────────────────────────────────────────────────
// `rewrite` covers both 'rephrase' and 'rewrite' actions per X29 spec.

const ACTION_KEYS = ['continue', 'rewrite', 'expand', 'summarise', 'describe'] as const;

describe('[X29] userPrompts.<action> — override behaviour', () => {
  for (const key of ACTION_KEYS) {
    const action = key === 'rewrite' ? 'rewrite' : key;
    it(`${key}: non-empty override appears in user message`, () => {
      const custom = `CUSTOM ${key.toUpperCase()} INSTRUCTION.`;
      const out = userMsg(
        baseInput({ action: action as BuildPromptInput['action'], userPrompts: { [key]: custom } }),
      );
      expect(out).toContain(custom);
    });

    it(`${key}: null falls back to DEFAULT_PROMPTS.${key}`, () => {
      const out = userMsg(
        baseInput({ action: action as BuildPromptInput['action'], userPrompts: { [key]: null } }),
      );
      expect(out).toContain(DEFAULT_PROMPTS[key]);
    });

    it(`${key}: whitespace-only falls back to DEFAULT_PROMPTS.${key}`, () => {
      const out = userMsg(
        baseInput({ action: action as BuildPromptInput['action'], userPrompts: { [key]: '   ' } }),
      );
      expect(out).toContain(DEFAULT_PROMPTS[key]);
    });
  }

  it('rephrase action also reads userPrompts.rewrite (collapsed override)', () => {
    const custom = 'CUSTOM REPHRASE.';
    const out = userMsg(baseInput({ action: 'rephrase', userPrompts: { rewrite: custom } }));
    expect(out).toContain(custom);
  });
});

// ─── selection auto-append ─────────────────────────────────────────────────────

describe('[X29] selection text auto-appends after overridden action templates', () => {
  it('overridden continue template still gets the Selection: «…» suffix', () => {
    const out = userMsg(
      baseInput({
        action: 'continue',
        selectedText: 'The dog barked.',
        userPrompts: { continue: 'CUSTOM CONTINUE INSTRUCTION.' },
      }),
    );
    expect(out).toContain('CUSTOM CONTINUE INSTRUCTION.');
    expect(out).toContain('Selection: «The dog barked.»');
  });
});

// ─── freeform / ask ignore userPrompts ─────────────────────────────────────────

describe('[X29] freeform / ask are not template-driven', () => {
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
});

// ─── include_venice_system_prompt is independent of userPrompts.system ────────

type PromptState = { label: string; value: string | null | undefined };
const promptStates: PromptState[] = [
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: 'empty', value: '' },
  { label: 'custom', value: 'Custom user system prompt.' },
];

describe('[X29] include_venice_system_prompt is independent of userPrompts.system', () => {
  for (const { label, value } of promptStates) {
    it(`userPrompts.system=${label} + flag=true → flag stays true`, () => {
      const r = buildPrompt(
        baseInput({ userPrompts: { system: value as string | null }, includeVeniceSystemPrompt: true }),
      );
      expect(r.venice_parameters.include_venice_system_prompt).toBe(true);
    });

    it(`userPrompts.system=${label} + flag=false → flag stays false`, () => {
      const r = buildPrompt(
        baseInput({ userPrompts: { system: value as string | null }, includeVeniceSystemPrompt: false }),
      );
      expect(r.venice_parameters.include_venice_system_prompt).toBe(false);
    });
  }
});
```

- [ ] **Step 3: Run new tests — expect FAIL (DEFAULT_PROMPTS export missing, userPrompts param missing)**

Run: `cd backend && npm run test:backend -- --run tests/services/prompt.user-prompts.test.ts`
Expected: FAIL with "DEFAULT_PROMPTS is not exported" or "Object literal may only specify known properties, and 'userPrompts' does not exist".

### Task 2: Refactor `prompt.service.ts` — export `DEFAULT_PROMPTS`, accept `userPrompts`, drop `storySystemPrompt`

**Files:**
- Modify: `backend/src/services/prompt.service.ts`

- [ ] **Step 1: Replace the file's contents with the new shape**

```ts
// backend/src/services/prompt.service.ts
// Pure, no IO, no async. `stream` and `model` are injected by the route
// layer so this module stays unit-testable without HTTP or Venice deps.

export class PromptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptValidationError';
  }
}

export type PromptAction =
  | 'continue'
  | 'rephrase'
  | 'expand'
  | 'summarise'
  | 'freeform'
  | 'rewrite'
  | 'describe'
  | 'ask';

export interface CharacterContext {
  name: string;
  role?: string | null;
  keyTraits?: string | null;
}

// [X29] Keys of the user-overridable prompt slice. `rewrite` covers both
// 'rephrase' and 'rewrite' actions (collapsed at the override layer; the
// in-builder strings for each surface stay distinct via DEFAULT_PROMPTS).
export type UserPromptKey = 'system' | 'continue' | 'rewrite' | 'expand' | 'summarise' | 'describe';

export type UserPrompts = Partial<Record<UserPromptKey, string | null>>;

export interface BuildPromptInput {
  action: PromptAction;
  selectedText: string;
  chapterContent: string;
  characters: CharacterContext[];
  worldNotes: string | null;
  modelContextLength: number;
  /** [V4] — default true when omitted */
  includeVeniceSystemPrompt?: boolean;
  /** [X29] User-level prompt overrides. Per key: non-empty trimmed string wins; null / undefined / whitespace falls back to DEFAULT_PROMPTS[key]. */
  userPrompts?: UserPrompts;
  /** Required when action === 'freeform' or 'ask'; optional otherwise */
  freeformInstruction?: string;
}

export interface BuiltPrompt {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  venice_parameters: {
    include_venice_system_prompt: boolean;
  };
  max_completion_tokens: number;
}

// ─── Exported constants ───────────────────────────────────────────────────────

export const DEFAULT_SYSTEM_PROMPT =
  'You are an expert creative-writing assistant. ' +
  'Help the author continue, refine, and develop their story with vivid prose that matches their established voice and tone. ' +
  'Return only the requested content — no preamble, no meta-commentary, no quotation marks around the output.';

// [X29] Single source of truth for default templates — exposed via
// GET /api/ai/default-prompts so the frontend renders the same strings
// it will fall back to. Frontend MUST NOT duplicate these.
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
} as const satisfies Record<UserPromptKey, string>;

// ─── Token estimation ─────────────────────────────────────────────────────────

export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

// ─── Ask-action user content renderer ────────────────────────────────────────

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

// ─── Action task block ────────────────────────────────────────────────────────

function buildTaskBlock(input: BuildPromptInput): string {
  const sel = input.selectedText ? `\n\nSelection: «${input.selectedText}»` : '';
  switch (input.action) {
    case 'continue':
      return `${resolvePrompt(input.userPrompts, 'continue')}${sel}`;
    case 'rephrase':
    case 'rewrite':
      // Both surfaces collapse onto the single 'rewrite' override key.
      return `${resolvePrompt(input.userPrompts, 'rewrite')}${sel}`;
    case 'expand':
      return `${resolvePrompt(input.userPrompts, 'expand')}${sel}`;
    case 'summarise':
      return `${resolvePrompt(input.userPrompts, 'summarise')}${sel}`;
    case 'describe':
      return `${resolvePrompt(input.userPrompts, 'describe')}${sel}`;
    case 'freeform': {
      const instruction = input.freeformInstruction ?? '';
      return `${instruction}${sel}`;
    }
    case 'ask': {
      if (!input.freeformInstruction) {
        throw new PromptValidationError('freeformInstruction is required for action "ask"');
      }
      return renderAskUserContent({
        freeformInstruction: input.freeformInstruction,
        selectionText: input.selectedText,
      });
    }
  }
}

// ─── Core builder ─────────────────────────────────────────────────────────────

export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const { modelContextLength } = input;

  const responseBudgetTokens = Math.floor(modelContextLength * 0.2);
  const promptBudgetTokens = Math.floor(modelContextLength * 0.8);

  const systemContent = resolvePrompt(input.userPrompts, 'system');
  const includeVeniceSystemPrompt = input.includeVeniceSystemPrompt ?? true;

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

  const taskBlock = buildTaskBlock(input);

  const sysTokens = estimateTokens(systemContent);
  const fixedTokens =
    sysTokens +
    estimateTokens(worldNotesBlock) +
    estimateTokens(charactersBlock) +
    estimateTokens(taskBlock);

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

  const userParts = [worldNotesBlock, charactersBlock, chapterBlock, taskBlock].filter(
    (p) => p.length > 0,
  );
  const userContent = userParts.join('\n\n');

  return {
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
    venice_parameters: {
      include_venice_system_prompt: includeVeniceSystemPrompt,
    },
    max_completion_tokens: responseBudgetTokens,
  };
}
```

- [ ] **Step 2: Run the new tests — expect PASS**

Run: `cd backend && npm run test:backend -- --run tests/services/prompt.user-prompts.test.ts`
Expected: PASS, all assertions green.

- [ ] **Step 3: Run the rest of the prompt service suite to confirm nothing else regressed**

Run: `cd backend && npm run test:backend -- --run tests/services/prompt`
Expected: PASS for all `prompt.*.test.ts` files.

> **Note:** This step may surface fixture-level failures in non-prompt tests (`ai/complete.test.ts` etc.) that pass `storySystemPrompt`. Those are addressed in Phase B — leave them red here, the fixtures get updated when the routes change.

### Task 3: Commit Phase A

- [ ] **Step 1: Stage + commit**

```bash
git add backend/src/services/prompt.service.ts \
        backend/tests/services/prompt.user-prompts.test.ts
git status   # confirm prompt.system-prompt.test.ts shows as deleted
git add -u   # picks up the deletion
git commit -m "$(cat <<'EOF'
[X29] prompt builder: DEFAULT_PROMPTS export + userPrompts param

Drops storySystemPrompt from BuildPromptInput; per-key resolution via
resolvePrompt() reads userPrompts[key] (trimmed, non-empty) else
DEFAULT_PROMPTS[key]. 'rephrase' and 'rewrite' actions collapse onto
the single 'rewrite' override key. Test file renamed
prompt.system-prompt → prompt.user-prompts and rewritten for the new
shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Route call sites: extract `userPrompts`, drop `storySystemPrompt`

### Task 4: `ai.routes.ts` — read `prompts` from settingsJson, pass `userPrompts`, drop `storySystemPrompt`

**Files:**
- Modify: `backend/src/routes/ai.routes.ts`

- [ ] **Step 1: Replace the settings type helper + resolver and the `buildPrompt` call**

Locate the existing settings type block (lines 57–71) and replace it with:

```ts
// ─── settingsJson type helper ────────────────────────────────────────────────

interface AiSettings {
  includeVeniceSystemPrompt?: boolean;
}

interface PromptsSettings {
  system?: string | null;
  continue?: string | null;
  rewrite?: string | null;
  expand?: string | null;
  summarise?: string | null;
  describe?: string | null;
}

interface UserSettings {
  ai?: AiSettings;
  prompts?: PromptsSettings;
}

function resolveIncludeVeniceSystemPrompt(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return true;
  const settings = raw as UserSettings;
  const flag = settings.ai?.includeVeniceSystemPrompt;
  if (typeof flag === 'boolean') return flag;
  return true;
}

function resolveUserPrompts(raw: unknown): PromptsSettings {
  if (!raw || typeof raw !== 'object') return {};
  const settings = raw as UserSettings;
  return settings.prompts ?? {};
}
```

- [ ] **Step 2: In the `/complete` handler, replace the `storySystemPrompt` extraction + the `buildPrompt` call**

Locate (around lines 145–211) and replace the body of step 3 + the `buildPrompt` invocation:

```ts
      // ── 3. Load user settings (not a narrative entity — direct prisma ok) ──
      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { settingsJson: true },
      });
      const includeVeniceSystemPrompt = resolveIncludeVeniceSystemPrompt(
        userRow?.settingsJson ?? null,
      );
      const userPrompts = resolveUserPrompts(userRow?.settingsJson ?? null);
```

Then in the `buildPrompt` call, **remove** the `storySystemPrompt` line and **add** `userPrompts`. The line `const storySystemPrompt = ...` (currently around line 195) is deleted entirely:

```ts
      const worldNotes = typeof story.worldNotes === 'string' ? story.worldNotes : null;

      const {
        messages,
        venice_parameters: baseVeniceParams,
        max_completion_tokens,
      } = buildPrompt({
        action: body.action,
        selectedText: body.selectedText,
        chapterContent,
        characters,
        worldNotes,
        modelContextLength,
        includeVeniceSystemPrompt,
        userPrompts,
        freeformInstruction: body.freeformInstruction,
      });
```

- [ ] **Step 3: Run the AI completion tests**

Run: `cd backend && npm run test:backend -- --run tests/ai/complete.test.ts`
Expected: TypeScript compile errors on fixtures still passing `systemPrompt: null` to story factory; runtime PASS otherwise.

> Fixtures will be cleaned in Phase E. We're committing the route shape change first; the fixture sweep is one coherent commit later.

### Task 5: `chat.routes.ts` — same extraction + pass-through

**Files:**
- Modify: `backend/src/routes/chat.routes.ts`

- [ ] **Step 1: Add `resolveUserPrompts` helper next to existing `resolveIncludeVeniceSystemPrompt`**

Find where `resolveIncludeVeniceSystemPrompt` is declared and add the same helper as in Task 4 above (`resolveUserPrompts`). If `chat.routes.ts` doesn't already declare a `UserSettings` interface, add the same `interface PromptsSettings { … }` and `interface UserSettings { ai?: …; prompts?: PromptsSettings }` block.

- [ ] **Step 2: At the user-row read site, add the `userPrompts` extraction**

After the existing `const includeVeniceSystemPrompt = resolveIncludeVeniceSystemPrompt(...)` line, add:

```ts
      const userPrompts = resolveUserPrompts(userRow?.settingsJson ?? null);
```

- [ ] **Step 3: In the `buildPrompt` call (currently around lines 278–292), drop `storySystemPrompt`, add `userPrompts`**

```ts
      const worldNotes = typeof story.worldNotes === 'string' ? story.worldNotes : null;

      const {
        messages: baseMessages,
        venice_parameters: baseVeniceParams,
        max_completion_tokens,
      } = buildPrompt({
        action: 'ask',
        selectedText: body.attachment?.selectionText ?? '',
        chapterContent,
        characters,
        worldNotes,
        modelContextLength,
        includeVeniceSystemPrompt,
        userPrompts,
        freeformInstruction: body.content,
      });
```

Delete the line `const storySystemPrompt = typeof story.systemPrompt === 'string' ? story.systemPrompt : null;` (currently around line 276).

- [ ] **Step 4: Run TypeScript compile to catch any straggler `storySystemPrompt` references**

Run: `cd backend && npx tsc --noEmit`
Expected: no `storySystemPrompt` errors. If TypeScript reports any (e.g. in tests), defer them — they're swept in Phase E.

### Task 6: Commit Phase B

- [ ] **Step 1: Stage + commit**

```bash
git add backend/src/routes/ai.routes.ts backend/src/routes/chat.routes.ts
git commit -m "$(cat <<'EOF'
[X29] ai/chat routes: extract userPrompts, drop storySystemPrompt

Both routes now extract { ai, prompts } from User.settingsJson and pass
userPrompts to buildPrompt. The per-story Story.systemPrompt read is
removed at the call site (the column itself drops in Phase E).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — `GET /api/ai/default-prompts` endpoint

### Task 7: Failing test for the new route

**Files:**
- Create: `backend/tests/routes/ai-defaults.test.ts`

- [ ] **Step 1: Write the test**

```ts
// backend/tests/routes/ai-defaults.test.ts
//
// [X29] GET /api/ai/default-prompts — exposes the constant DEFAULT_PROMPTS
// so the Settings → Prompts tab renders the same strings the backend will
// fall back to. Auth-required.

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiRouter } from '../../src/routes/ai.routes';
import { createAiDefaultsRouter } from '../../src/routes/ai-defaults.routes';
import { DEFAULT_PROMPTS } from '../../src/services/prompt.service';
import { prisma } from '../../src/lib/prisma';
import { signAccessToken } from '../../src/services/auth.service';
import { putSession } from '../../src/services/session-store';
import { generateContentDek } from '../../src/services/content-crypto.service';

let app: express.Express;
let token: string;
let userId: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use('/api/ai', createAiRouter()); // already-mounted siblings
  app.use('/api/ai', createAiDefaultsRouter());

  // Minimal user fixture — auth middleware needs a real session entry.
  const user = await prisma.user.create({
    data: {
      username: `x29-defaults-${Date.now()}`,
      passwordHash: 'unused',
      name: 'X29 Defaults Tester',
    },
  });
  userId = user.id;
  const sessionId = `sess-${Date.now()}`;
  putSession(sessionId, { userId, dek: generateContentDek() });
  token = signAccessToken({ sub: userId, email: null, sessionId });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe('[X29] GET /api/ai/default-prompts', () => {
  it('401 without auth', async () => {
    const res = await request(app).get('/api/ai/default-prompts');
    expect(res.status).toBe(401);
  });

  it('200 with auth — returns { defaults }', async () => {
    const res = await request(app)
      .get('/api/ai/default-prompts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ defaults: DEFAULT_PROMPTS });
  });

  it('every key is a non-empty string', async () => {
    const res = await request(app)
      .get('/api/ai/default-prompts')
      .set('Authorization', `Bearer ${token}`);
    for (const key of ['system', 'continue', 'rewrite', 'expand', 'summarise', 'describe']) {
      expect(typeof res.body.defaults[key]).toBe('string');
      expect(res.body.defaults[key].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (router does not exist)**

Run: `cd backend && npm run test:backend -- --run tests/routes/ai-defaults.test.ts`
Expected: FAIL with "Cannot find module '../../src/routes/ai-defaults.routes'".

### Task 8: Implement the route

**Files:**
- Create: `backend/src/routes/ai-defaults.routes.ts`

- [ ] **Step 1: Write the router**

```ts
// backend/src/routes/ai-defaults.routes.ts
//
// [X29] GET /api/ai/default-prompts — exposes DEFAULT_PROMPTS so the
// Settings → Prompts tab can render the same fallback strings the
// backend uses. Constants change only on deploy → frontend caches with
// staleTime: Infinity. Auth-required (mirrors the rest of /api/ai).

import { type Request, type Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { DEFAULT_PROMPTS } from '../services/prompt.service';

export function createAiDefaultsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/default-prompts', (_req: Request, res: Response) => {
    res.status(200).json({ defaults: DEFAULT_PROMPTS });
  });

  return router;
}
```

- [ ] **Step 2: Mount it in `backend/src/index.ts`**

Find the existing `createAiRouter()` mount (line will look like `app.use('/api/ai', createAiRouter())`) and add immediately after it:

```ts
import { createAiDefaultsRouter } from './routes/ai-defaults.routes';
// …
app.use('/api/ai', createAiDefaultsRouter());
```

- [ ] **Step 3: Run the test — expect PASS**

Run: `cd backend && npm run test:backend -- --run tests/routes/ai-defaults.test.ts`
Expected: PASS.

### Task 9: Commit Phase C

- [ ] **Step 1: Stage + commit**

```bash
git add backend/src/routes/ai-defaults.routes.ts \
        backend/tests/routes/ai-defaults.test.ts \
        backend/src/index.ts
git commit -m "$(cat <<'EOF'
[X29] add GET /api/ai/default-prompts

Exposes DEFAULT_PROMPTS so the frontend renders the same fallback
strings the backend uses. Auth-required; constants change only on
deploy so frontend can cache forever.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Extend user-settings schema with `prompts` slice

### Task 10: Failing tests for `prompts` round-trip + deep-merge

**Files:**
- Modify: `backend/tests/routes/user-settings.test.ts`

- [ ] **Step 1: Append a new describe block at the bottom of the file**

```ts
// ─── [X29] prompts slice ──────────────────────────────────────────────────────

describe('[X29] settingsJson.prompts slice', () => {
  it('GET defaults: prompts.{key} = null for all keys when never written', async () => {
    const { token } = await createUserAndAuth();
    const res = await request(app).get('/api/users/me/settings').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.settings.prompts).toEqual({
      system: null,
      continue: null,
      rewrite: null,
      expand: null,
      summarise: null,
      describe: null,
    });
  });

  it('PATCH { prompts: { system: "X" } } round-trips', async () => {
    const { token } = await createUserAndAuth();
    const patch = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { system: 'My system prompt.' } });
    expect(patch.status).toBe(200);
    expect(patch.body.settings.prompts.system).toBe('My system prompt.');

    const get = await request(app).get('/api/users/me/settings').set('Authorization', `Bearer ${token}`);
    expect(get.body.settings.prompts.system).toBe('My system prompt.');
    expect(get.body.settings.prompts.continue).toBeNull();
  });

  it('two PATCHes deep-merge: setting prompts.system then prompts.continue keeps both', async () => {
    const { token } = await createUserAndAuth();
    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { system: 'A' } });
    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { continue: 'B' } });

    const get = await request(app).get('/api/users/me/settings').set('Authorization', `Bearer ${token}`);
    expect(get.body.settings.prompts.system).toBe('A');
    expect(get.body.settings.prompts.continue).toBe('B');
  });

  it('PATCH { prompts: { system: null } } clears the override', async () => {
    const { token } = await createUserAndAuth();
    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { system: 'X' } });
    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { system: null } });

    const get = await request(app).get('/api/users/me/settings').set('Authorization', `Bearer ${token}`);
    expect(get.body.settings.prompts.system).toBeNull();
  });

  it('rejects strings longer than 10 000 chars', async () => {
    const { token } = await createUserAndAuth();
    const tooLong = 'x'.repeat(10_001);
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { system: tooLong } });
    expect(res.status).toBe(400);
  });

  it('rejects unknown keys under prompts (.strict())', async () => {
    const { token } = await createUserAndAuth();
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { unknownKey: 'x' } });
    expect(res.status).toBe(400);
  });
});
```

> **Note:** If `createUserAndAuth` doesn't exist in this file, mirror the auth-fixture pattern used by the existing tests in the same file (look for the existing `beforeAll` / `request(app)…set('Authorization', …)` pattern at the top and reuse it verbatim).

- [ ] **Step 2: Run — expect FAIL (Zod schema doesn't accept `prompts`; defaults missing)**

Run: `cd backend && npm run test:backend -- --run tests/routes/user-settings.test.ts`
Expected: FAIL — `prompts` rejected by `.strict()` top-level schema, or absent from defaults.

### Task 11: Extend `user-settings.routes.ts` Zod schema + defaults

**Files:**
- Modify: `backend/src/routes/user-settings.routes.ts`

- [ ] **Step 1: Add the `prompts` slice to `SettingsSchema` and `DEFAULT_SETTINGS`**

In the `SettingsSchema` `z.object({…}).strict()`, add a new top-level entry alongside `ai`:

```ts
    prompts: z
      .object({
        system: z.string().max(10_000).nullable().optional(),
        continue: z.string().max(10_000).nullable().optional(),
        rewrite: z.string().max(10_000).nullable().optional(),
        expand: z.string().max(10_000).nullable().optional(),
        summarise: z.string().max(10_000).nullable().optional(),
        describe: z.string().max(10_000).nullable().optional(),
      })
      .strict()
      .optional(),
```

In `DEFAULT_SETTINGS`, add:

```ts
  prompts: {
    system: null as string | null,
    continue: null as string | null,
    rewrite: null as string | null,
    expand: null as string | null,
    summarise: null as string | null,
    describe: null as string | null,
  },
```

- [ ] **Step 2: Run the user-settings tests — expect PASS**

Run: `cd backend && npm run test:backend -- --run tests/routes/user-settings.test.ts`
Expected: PASS.

### Task 12: Commit Phase D

- [ ] **Step 1: Stage + commit**

```bash
git add backend/src/routes/user-settings.routes.ts \
        backend/tests/routes/user-settings.test.ts
git commit -m "$(cat <<'EOF'
[X29] user-settings: prompts slice (system + 5 action overrides)

Adds the prompts slice to GET/PATCH /api/users/me/settings with .strict()
shape and 10 000-char cap per field. Defaults are all null (no override).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — Drop `Story.systemPrompt` everywhere + sweep fixtures + migration

### Task 13: Drop `systemPrompt` from `story.repo.ts`

**Files:**
- Modify: `backend/src/repos/story.repo.ts`

- [ ] **Step 1: Edit the file**

Change line 6 from:

```ts
const ENCRYPTED_FIELDS = ['title', 'synopsis', 'worldNotes', 'systemPrompt'] as const;
```

to:

```ts
const ENCRYPTED_FIELDS = ['title', 'synopsis', 'worldNotes'] as const;
```

Remove `systemPrompt?: string | null` from both `StoryCreateInput` (line 14) and `StoryUpdateInput` (line 23).

In `create()`, remove the line:

```ts
      ...writeEncrypted(req, 'systemPrompt', input.systemPrompt ?? null),
```

In `update()`, remove the block:

```ts
    if (input.systemPrompt !== undefined) {
      Object.assign(data, writeEncrypted(req, 'systemPrompt', input.systemPrompt));
    }
```

Update the comment in `create()` (line ~46–47) to drop `systemPrompt` from the listed fields:

```ts
        // Post-[E11]: only the ciphertext triple persists. `title`,
        // `synopsis`, `worldNotes` are encrypted-only.
        // `genre`, `targetWords`, `userId`, timestamps remain plaintext.
```

- [ ] **Step 2: Run repo tests — expect FAIL (the round-trip case still asserts systemPrompt)**

Run: `cd backend && npm run test:backend -- --run tests/repos/story.repo.test.ts`
Expected: FAIL.

### Task 14: Drop `systemPrompt` from `story.repo.test.ts`

**Files:**
- Modify: `backend/tests/repos/story.repo.test.ts`

- [ ] **Step 1: Remove the `systemPrompt` field from the create input + the corresponding assertion**

Find line 18 (`systemPrompt: 'Write in close third person.',`) — delete it.
Find line 26 (`expect(result.systemPrompt).toBe('Write in close third person.');`) — delete it.

- [ ] **Step 2: Run — expect PASS**

Run: `cd backend && npm run test:backend -- --run tests/repos/story.repo.test.ts`
Expected: PASS.

### Task 15: Drop `systemPrompt` from `stories.routes.ts`

**Files:**
- Modify: `backend/src/routes/stories.routes.ts`

- [ ] **Step 1: Edit the file**

Find and delete each occurrence of `systemPrompt` (4 lines per the grep — both Zod schemas at lines 36 + 51, the create handler default at line 102, and the update branch at line 193).

Specifically, drop:

```ts
    systemPrompt: z.string().max(10_000).nullable().optional(),  // both places
```

```ts
        systemPrompt: body.systemPrompt ?? null,                  // create handler
```

```ts
    if (body.systemPrompt !== undefined) input.systemPrompt = body.systemPrompt;  // update handler
```

- [ ] **Step 2: Run stories route tests — expect FAIL on assertions still referencing the field**

Run: `cd backend && npm run test:backend -- --run tests/routes/stories.test.ts tests/routes/story-detail.test.ts`
Expected: FAIL.

### Task 16: Drop `systemPrompt` from backend test fixtures + assertions

**Files:** (each is a fixture/assertion sweep — same pattern across files)
- Modify: `backend/tests/routes/stories.test.ts`
- Modify: `backend/tests/routes/story-detail.test.ts`
- Modify: `backend/tests/routes/chat-messages-list.test.ts`
- Modify: `backend/tests/ai/complete.test.ts`
- Modify: `backend/tests/ai/chat-citations.test.ts`
- Modify: `backend/tests/ai/chat-persistence.test.ts`

- [ ] **Step 1: For each file, delete every line matching `systemPrompt`**

Use `rg -n "systemPrompt" backend/tests/routes/ backend/tests/ai/ backend/tests/repos/` to confirm the locations, then for each:

- Lines that read `systemPrompt: null,` inside an object literal — delete the line entirely.
- Lines that assert `expect(...).systemPrompt...` — delete the line entirely.

> Be careful: an object literal with a trailing comma after the deleted line is still valid TypeScript. If the deletion leaves a dangling comma at end-of-object, that's still legal.

- [ ] **Step 2: Run all affected suites**

Run:
```bash
cd backend && npm run test:backend -- --run \
  tests/routes/stories.test.ts \
  tests/routes/story-detail.test.ts \
  tests/routes/chat-messages-list.test.ts \
  tests/ai/complete.test.ts \
  tests/ai/chat-citations.test.ts \
  tests/ai/chat-persistence.test.ts
```
Expected: PASS.

### Task 17: Drop `systemPrompt` from raw-Prisma model tests

**Files:**
- Modify: `backend/tests/models/story-encrypted.test.ts`
- Modify: `backend/tests/models/story-settings.test.ts`

- [ ] **Step 1: `story-encrypted.test.ts` — drop the systemPrompt write + read assertions**

The current test (lines 9, 23–25, 34) writes the systemPrompt ciphertext triple and asserts read-back. Delete:
- Line 9: `it('persists title/synopsis/worldNotes/systemPrompt ciphertext triples', ...)` — change to `'persists title/synopsis/worldNotes ciphertext triples'`
- Lines 23–25 inside the `data: {...}`: `systemPromptCiphertext`, `systemPromptIv`, `systemPromptAuthTag` — delete all three.
- Line 34: `expect(read.systemPromptCiphertext).toBe(...)` — delete the line.

- [ ] **Step 2: `story-settings.test.ts` — update the comment + drop the column check**

- Line 4–5: replace the comment block with: `// Post-[X29] Story.systemPrompt has been removed entirely. This file keeps`
  `// coverage of the surviving plaintext setting — targetWords.`
- Line 29: `expect(story.systemPromptCiphertext).toBeNull();` — delete the line.

- [ ] **Step 3: Run model tests — expect PASS**

Run: `cd backend && npm run test:backend -- --run tests/models/story-encrypted.test.ts tests/models/story-settings.test.ts`
Expected: PASS.

### Task 18: Drop `systemPrompt` sentinel from the encryption leak test

**Files:**
- Modify: `backend/tests/security/encryption-leak.test.ts`

- [ ] **Step 1: Edit line 79**

Delete the line:

```ts
      systemPrompt: `system-prompt ${SENTINEL}`,
```

If there are nearby assertions that target `systemPromptCiphertext` columns specifically, drop those too. The test iterates over the schema for narrative tables; the sentinel coverage stays correct so long as we stop *seeding* a systemPrompt value.

- [ ] **Step 2: Run — expect PASS**

Run: `cd backend && npm run test:backend -- --run tests/security/encryption-leak.test.ts`
Expected: PASS.

### Task 19: Schema migration — drop the three `Story.systemPrompt*` columns

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260504000000_drop_story_system_prompt/migration.sql`

- [ ] **Step 1: Edit `schema.prisma` — remove the three lines + update the comment**

In the `Story` model (around lines 64–79), delete:

```prisma
  systemPromptCiphertext  String?
  systemPromptIv          String?
  systemPromptAuthTag     String?
```

Update the comment at lines 64–66 to drop `systemPrompt`:

```prisma
  // [E4] ciphertext triples — now the SOLE source of truth for narrative
  // fields (title, synopsis, worldNotes). Populated by the repo layer
  // ([E9]) on write. Plaintext siblings were dropped in [E11].
  // [X29] Story.systemPrompt removed; user-level overrides live in
  // User.settingsJson.prompts.
  // `genre`, `targetWords`, `userId`, timestamps remain plaintext.
```

- [ ] **Step 2: Create the migration directory + `migration.sql`**

```bash
mkdir -p backend/prisma/migrations/20260504000000_drop_story_system_prompt
```

Then write `backend/prisma/migrations/20260504000000_drop_story_system_prompt/migration.sql`:

```sql
-- [X29] Drop per-story system-prompt ciphertext triple. User-level
-- prompt overrides live in User.settingsJson.prompts (no schema change
-- needed for that — it's a JSON blob).
ALTER TABLE "Story"
  DROP COLUMN "systemPromptCiphertext",
  DROP COLUMN "systemPromptIv",
  DROP COLUMN "systemPromptAuthTag";
```

- [ ] **Step 3: Apply the migration to dev + test DBs and regenerate the client**

```bash
cd backend && npx prisma migrate dev --name drop_story_system_prompt --create-only
# (We've already authored migration.sql by hand; --create-only would refuse if it
#  conflicts. If it does, skip --create-only and let Prisma reconcile, or just
#  run migrate deploy below — schema and SQL are aligned.)
```

Then apply:

```bash
cd backend && npx prisma migrate deploy && npx prisma generate
cd backend && npm run db:test:reset
```

- [ ] **Step 4: Run the FULL backend test suite — everything green**

Run: `cd backend && npm run test:backend`
Expected: PASS for all suites, including the encryption leak test.

> If any test fails because it still references `systemPrompt` or `systemPromptCiphertext`, it's a fixture I missed in Task 16/17. Fix and re-run.

### Task 20: Commit Phase E

- [ ] **Step 1: Stage + commit**

```bash
git add backend/src/repos/story.repo.ts \
        backend/src/routes/stories.routes.ts \
        backend/prisma/schema.prisma \
        backend/prisma/migrations/20260504000000_drop_story_system_prompt \
        backend/tests/repos/story.repo.test.ts \
        backend/tests/routes/stories.test.ts \
        backend/tests/routes/story-detail.test.ts \
        backend/tests/routes/chat-messages-list.test.ts \
        backend/tests/ai/complete.test.ts \
        backend/tests/ai/chat-citations.test.ts \
        backend/tests/ai/chat-persistence.test.ts \
        backend/tests/models/story-encrypted.test.ts \
        backend/tests/models/story-settings.test.ts \
        backend/tests/security/encryption-leak.test.ts
git commit -m "$(cat <<'EOF'
[X29] drop Story.systemPrompt — column, repo path, route schema, fixtures

User-level overrides live in User.settingsJson.prompts. Per-story
override is removed entirely; the dead Models-tab UI that wrote to it
is removed in the next phase.

Migration drops three columns; no backfill (pre-deployment, no rows to
preserve per CLAUDE.md).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — Frontend hooks: extend `useUserSettings`, add `useDefaultPrompts`, drop `Story.systemPrompt` from types

### Task 21: Extend `useUserSettings.ts` with the `prompts` slice

**Files:**
- Modify: `frontend/src/hooks/useUserSettings.ts`

- [ ] **Step 1: Add the new interface near the other slice types**

After `UserAiSettings`, insert:

```ts
/** [X29] Per-prompt user-level overrides. null = use built-in default. */
export interface UserPromptsSettings {
  system: string | null;
  continue: string | null;
  rewrite: string | null;   // covers both 'rephrase' and 'rewrite' actions
  expand: string | null;
  summarise: string | null;
  describe: string | null;
}
```

Update `UserSettings`:

```ts
export interface UserSettings {
  theme: 'paper' | 'sepia' | 'dark';
  prose: UserProseSettings;
  writing: UserWritingSettings;
  chat: UserChatSettings;
  ai: UserAiSettings;
  prompts: UserPromptsSettings;
}
```

Update `UserSettingsPatch`:

```ts
export type UserSettingsPatch = {
  theme?: UserSettings['theme'];
  prose?: Partial<UserProseSettings>;
  writing?: Partial<UserWritingSettings>;
  chat?: Partial<UserChatSettings>;
  ai?: Partial<UserAiSettings>;
  prompts?: Partial<UserPromptsSettings>;
};
```

Update `DEFAULT_SETTINGS`:

```ts
export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'paper',
  prose: { font: 'iowan', size: 18, lineHeight: 1.6 },
  writing: {
    spellcheck: true,
    typewriterMode: false,
    focusMode: false,
    dailyWordGoal: 0,
    smartQuotes: true,
    emDashExpansion: true,
  },
  chat: { model: null, temperature: 0.85, topP: 0.95, maxTokens: 800 },
  ai: { includeVeniceSystemPrompt: true },
  prompts: {
    system: null,
    continue: null,
    rewrite: null,
    expand: null,
    summarise: null,
    describe: null,
  },
};
```

Update `mergeSettings`:

```ts
export function mergeSettings(prev: UserSettings, patch: UserSettingsPatch): UserSettings {
  return {
    theme: patch.theme ?? prev.theme,
    prose: { ...prev.prose, ...(patch.prose ?? {}) },
    writing: { ...prev.writing, ...(patch.writing ?? {}) },
    chat: { ...prev.chat, ...(patch.chat ?? {}) },
    ai: { ...prev.ai, ...(patch.ai ?? {}) },
    prompts: { ...prev.prompts, ...(patch.prompts ?? {}) },
  };
}
```

- [ ] **Step 2: Run frontend type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS for `useUserSettings.ts`. Other files may surface type errors when fixtures don't include `prompts` — those are addressed in subsequent tasks.

### Task 22: Add `useDefaultPrompts` hook + test

**Files:**
- Create: `frontend/src/hooks/useDefaultPrompts.ts`
- Create: `frontend/tests/hooks/useDefaultPrompts.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/hooks/useDefaultPrompts.test.tsx
//
// [X29] useDefaultPromptsQuery — fetches GET /api/ai/default-prompts and
// caches with staleTime: Infinity. Fallback to a hardcoded shape on error
// is intentional: the Settings tab must always render something readable.

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDefaultPromptsQuery } from '@/hooks/useDefaultPrompts';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';

const mockDefaults = {
  system: 'Default system text.',
  continue: 'Default continue.',
  rewrite: 'Default rewrite.',
  expand: 'Default expand.',
  summarise: 'Default summarise.',
  describe: 'Default describe.',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  resetApiClientForTests();
  setAccessToken('test-token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/ai/default-prompts')) {
        return jsonResponse({ defaults: mockDefaults });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiClientForTests();
});

describe('[X29] useDefaultPromptsQuery', () => {
  it('returns defaults from /api/ai/default-prompts', async () => {
    const qc = createQueryClient();
    const { result } = renderHook(() => useDefaultPromptsQuery(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.data).toEqual(mockDefaults));
  });
});
```

- [ ] **Step 2: Run — expect FAIL (hook doesn't exist)**

Run: `cd frontend && npm run test:frontend -- --run tests/hooks/useDefaultPrompts.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// frontend/src/hooks/useDefaultPrompts.ts
//
// [X29] Fetches GET /api/ai/default-prompts — the canonical built-in
// default templates. Cached forever (staleTime: Infinity); constants
// only change on backend deploy. Used by SettingsPromptsTab to render
// the read-only-default + override-checkbox UI.

import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DefaultPrompts {
  system: string;
  continue: string;
  rewrite: string;
  expand: string;
  summarise: string;
  describe: string;
}

interface DefaultsEnvelope {
  defaults: DefaultPrompts;
}

export const defaultPromptsQueryKey = ['ai-default-prompts'] as const;

export function useDefaultPromptsQuery(): UseQueryResult<DefaultPrompts, Error> {
  return useQuery({
    queryKey: defaultPromptsQueryKey,
    queryFn: async (): Promise<DefaultPrompts> => {
      const res = await api<DefaultsEnvelope>('/ai/default-prompts');
      return res.defaults;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd frontend && npm run test:frontend -- --run tests/hooks/useDefaultPrompts.test.tsx`
Expected: PASS.

### Task 23: Drop `systemPrompt` from `useStories.ts` and downstream type fixtures

**Files:**
- Modify: `frontend/src/hooks/useStories.ts`
- Modify: `frontend/src/components/StoryPicker.stories.tsx`
- Modify: `frontend/tests/routing.test.tsx`
- Modify: `frontend/tests/pages/editor-shell.integration.test.tsx`
- Modify: `frontend/tests/pages/editor.test.tsx`

- [ ] **Step 1: `useStories.ts` — delete the three `systemPrompt` lines**

Remove:
- Line 22 (`systemPrompt: string | null;` inside the dashboard-card type)
- Line 39 doc comment that names systemPrompt — drop the parenthetical: `(worldNotes, …)` → `(worldNotes)` or simply drop the parenthetical entirely.
- Line 51 (`systemPrompt: string | null;` inside StoryDetail)
- Line 72 (`systemPrompt?: string | null;` inside UpdateStoryInput)

- [ ] **Step 2: Sweep frontend test/story fixtures — delete every `systemPrompt: null,` line**

Use `rg -n "systemPrompt" frontend/` to confirm. Delete the line in each file:
- `frontend/src/components/StoryPicker.stories.tsx` (3 occurrences)
- `frontend/tests/routing.test.tsx` (1)
- `frontend/tests/pages/editor-shell.integration.test.tsx` (1)
- `frontend/tests/pages/editor.test.tsx` (1)

- [ ] **Step 3: Run `tsc --noEmit` to confirm types match**

Run: `cd frontend && npx tsc --noEmit`
Expected: no `systemPrompt`-related errors. Errors related to the missing `prompts` field in test settings fixtures will surface in Task 26 — those are expected.

### Task 24: Commit Phase F

- [ ] **Step 1: Stage + commit**

```bash
git add frontend/src/hooks/useUserSettings.ts \
        frontend/src/hooks/useDefaultPrompts.ts \
        frontend/tests/hooks/useDefaultPrompts.test.tsx \
        frontend/src/hooks/useStories.ts \
        frontend/src/components/StoryPicker.stories.tsx \
        frontend/tests/routing.test.tsx \
        frontend/tests/pages/editor-shell.integration.test.tsx \
        frontend/tests/pages/editor.test.tsx
git commit -m "$(cat <<'EOF'
[X29] frontend hooks: prompts slice + useDefaultPrompts; drop Story.systemPrompt

useUserSettings adds the prompts slice (six string|null fields) end-to-end
across UserSettings, DEFAULT_SETTINGS, mergeSettings, UserSettingsPatch.
New useDefaultPromptsQuery hook fetches GET /api/ai/default-prompts with
staleTime: Infinity. Story.systemPrompt removed from the API client
types and from every fixture that referenced it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase G — `SettingsPromptsTab` + tab wiring + Models-tab cleanup

### Task 25: Failing tests for `SettingsPromptsTab`

**Files:**
- Create: `frontend/tests/components/Settings.prompts.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// frontend/tests/components/Settings.prompts.test.tsx
//
// [X29] Settings → Prompts tab.
// Covers:
//   - Default state: every row read-only, checkbox unchecked, default
//     text from /api/ai/default-prompts visible.
//   - Tick checkbox → field becomes editable, seeded with default;
//     PATCH /users/me/settings { prompts: { <key>: <default text> } } fires.
//   - Edit + blur → PATCH with the new value.
//   - Untick checkbox → PATCH with null; field reverts to read-only default.
//   - rewrite row label mentions both surfaces.

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/Settings';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DEFAULTS = {
  system: 'You are an expert creative-writing assistant. (default)',
  continue: 'Task: continue (default).',
  rewrite: 'Task: rewrite (default).',
  expand: 'Task: expand (default).',
  summarise: 'Task: summarise (default).',
  describe: 'Task: describe (default).',
};

interface SettingsState {
  theme: 'paper' | 'sepia' | 'dark';
  prose: { font: string; size: number; lineHeight: number };
  writing: {
    spellcheck: boolean;
    typewriterMode: boolean;
    focusMode: boolean;
    dailyWordGoal: number;
    smartQuotes: boolean;
    emDashExpansion: boolean;
  };
  chat: { model: string | null; temperature: number; topP: number; maxTokens: number };
  ai: { includeVeniceSystemPrompt: boolean };
  prompts: {
    system: string | null;
    continue: string | null;
    rewrite: string | null;
    expand: string | null;
    summarise: string | null;
    describe: string | null;
  };
}

function makeSettings(prompts: Partial<SettingsState['prompts']> = {}): SettingsState {
  return {
    theme: 'paper',
    prose: { font: 'iowan', size: 18, lineHeight: 1.6 },
    writing: {
      spellcheck: true,
      typewriterMode: false,
      focusMode: false,
      dailyWordGoal: 0,
      smartQuotes: true,
      emDashExpansion: true,
    },
    chat: { model: null, temperature: 0.85, topP: 0.95, maxTokens: 800 },
    ai: { includeVeniceSystemPrompt: true },
    prompts: {
      system: null,
      continue: null,
      rewrite: null,
      expand: null,
      summarise: null,
      describe: null,
      ...prompts,
    },
  };
}

let fetchMock: FetchMock;
let lastPatchBody: unknown = null;

function installFetch(initialSettings: SettingsState): void {
  let current = initialSettings;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/users/me/settings') && method === 'GET') {
      return jsonResponse(200, { settings: current });
    }
    if (url.endsWith('/api/users/me/settings') && method === 'PATCH') {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      lastPatchBody = body;
      current = {
        ...current,
        prompts: { ...current.prompts, ...(body.prompts ?? {}) },
      };
      return jsonResponse(200, { settings: current });
    }
    if (url.endsWith('/api/ai/default-prompts') && method === 'GET') {
      return jsonResponse(200, { defaults: DEFAULTS });
    }
    if (url.endsWith('/api/users/me/venice-key') && method === 'GET') {
      return jsonResponse(200, { hasKey: false, lastFour: null, endpoint: null });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderModal(initial: SettingsState): { qc: ReturnType<typeof createQueryClient> } {
  const qc = createQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <SettingsModal open onClose={() => {}} />
    </QueryClientProvider>,
  );
  return { qc };
}

beforeEach(() => {
  resetApiClientForTests();
  setAccessToken('test-token');
  useSessionStore.setState({ accessToken: 'test-token', userId: 'u1' });
  lastPatchBody = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiClientForTests();
});

async function openPromptsTab(): Promise<void> {
  const tab = await screen.findByTestId('settings-tab-prompts');
  await userEvent.click(tab);
}

describe('[X29] SettingsPromptsTab', () => {
  it('default state — every row shows the default read-only with checkbox unchecked', async () => {
    installFetch(makeSettings());
    renderModal(makeSettings());
    await openPromptsTab();

    await waitFor(() => screen.getByTestId('prompts-row-system'));
    expect(screen.getByTestId('prompts-default-system')).toHaveTextContent(DEFAULTS.system);
    expect(screen.getByTestId('prompts-toggle-system')).not.toBeChecked();
    for (const key of ['continue', 'rewrite', 'expand', 'summarise', 'describe']) {
      expect(screen.getByTestId(`prompts-default-${key}`)).toHaveTextContent(
        DEFAULTS[key as keyof typeof DEFAULTS],
      );
      expect(screen.getByTestId(`prompts-toggle-${key}`)).not.toBeChecked();
    }
  });

  it('ticking checkbox PATCHes with the default text and reveals an editable field', async () => {
    installFetch(makeSettings());
    renderModal(makeSettings());
    await openPromptsTab();

    const toggle = await screen.findByTestId('prompts-toggle-continue');
    await userEvent.click(toggle);

    await waitFor(() => {
      const body = lastPatchBody as { prompts?: { continue?: string | null } } | null;
      expect(body?.prompts?.continue).toBe(DEFAULTS.continue);
    });

    const editable = await screen.findByTestId('prompts-editor-continue');
    expect(editable).toHaveValue(DEFAULTS.continue);
    expect(editable).not.toHaveAttribute('readonly');
  });

  it('editing + blurring PATCHes the new value', async () => {
    installFetch(makeSettings({ continue: DEFAULTS.continue }));
    renderModal(makeSettings({ continue: DEFAULTS.continue }));
    await openPromptsTab();

    const editable = await screen.findByTestId('prompts-editor-continue');
    await userEvent.clear(editable);
    await userEvent.type(editable, 'Custom continue text.');
    fireEvent.blur(editable);

    await waitFor(() => {
      const body = lastPatchBody as { prompts?: { continue?: string | null } } | null;
      expect(body?.prompts?.continue).toBe('Custom continue text.');
    });
  });

  it('unticking PATCHes null and reverts the row to read-only default', async () => {
    installFetch(makeSettings({ continue: 'Custom value.' }));
    renderModal(makeSettings({ continue: 'Custom value.' }));
    await openPromptsTab();

    const toggle = await screen.findByTestId('prompts-toggle-continue');
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);

    await waitFor(() => {
      const body = lastPatchBody as { prompts?: { continue?: string | null } } | null;
      expect(body?.prompts?.continue).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('prompts-default-continue')).toHaveTextContent(DEFAULTS.continue);
    });
  });

  it('rewrite row label calls out both surfaces', async () => {
    installFetch(makeSettings());
    renderModal(makeSettings());
    await openPromptsTab();

    const row = await screen.findByTestId('prompts-row-rewrite');
    expect(row).toHaveTextContent(/rephrase/i);
    expect(row).toHaveTextContent(/selection bubble|AI panel|both/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (`settings-tab-prompts` doesn't exist; component doesn't exist)**

Run: `cd frontend && npm run test:frontend -- --run tests/components/Settings.prompts.test.tsx`
Expected: FAIL.

### Task 26: Implement `SettingsPromptsTab` + Storybook story

**Files:**
- Create: `frontend/src/components/SettingsPromptsTab.tsx`
- Create: `frontend/src/components/SettingsPromptsTab.stories.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/src/components/SettingsPromptsTab.tsx
//
// [X29] Settings → Prompts tab. Six rows (system + 5 action templates),
// each displaying its built-in default read-only by default. Ticking
// "Override default" enables an editable field seeded with the current
// default text and PATCHes settings.prompts.{key}. Unticking PATCHes
// null and reverts to the read-only default.
//
// Defaults are fetched from GET /api/ai/default-prompts (cached forever).
// Per-row state is derived from useUserSettings().prompts[key]:
//   - null  → unchecked, read-only default
//   - non-null → checked, editable seeded with the current value
//
// The Venice "Include default system prompt" toggle stays on the Models
// tab (it's a Venice/model-API setting, conceptually distinct from
// Inkwell's own prompts).

import type { ChangeEvent, JSX } from 'react';
import { useId, useState } from 'react';
import { useDefaultPromptsQuery, type DefaultPrompts } from '@/hooks/useDefaultPrompts';
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';

type PromptKey = keyof DefaultPrompts;

interface RowMeta {
  key: PromptKey;
  label: string;
  hint: string;
  multiline: boolean;
}

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
];

export function SettingsPromptsTab(): JSX.Element {
  const settings = useUserSettings();
  const updateSetting = useUpdateUserSetting();
  const defaultsQuery = useDefaultPromptsQuery();
  const defaults = defaultsQuery.data;

  return (
    <div className="flex flex-col gap-6" data-testid="settings-prompts-tab">
      <header>
        <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Prompts</h3>
        <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
          Override the default system prompt and action templates. Unchecked rows use the built-in
          default shown.
        </p>
      </header>

      {!defaults ? (
        <div className="py-6 text-center font-mono text-[12px] text-ink-4">Loading prompts…</div>
      ) : (
        ROWS.map((row) => (
          <PromptRow
            key={row.key}
            meta={row}
            defaultText={defaults[row.key]}
            override={settings.prompts[row.key]}
            onPatch={(next) => {
              updateSetting.mutate({ prompts: { [row.key]: next } });
            }}
          />
        ))
      )}
    </div>
  );
}

interface PromptRowProps {
  meta: RowMeta;
  defaultText: string;
  override: string | null;
  onPatch: (next: string | null) => void;
}

function PromptRow({ meta, defaultText, override, onPatch }: PromptRowProps): JSX.Element {
  const fieldId = useId();
  const checked = override !== null;
  const [draft, setDraft] = useState<string>(override ?? defaultText);

  // When the override transitions away under us (e.g. unticked), re-seed
  // the local draft so future ticks start from the current default.
  if (override === null && draft !== defaultText) {
    // No effect: just resync on the next render. We don't `setState` from
    // render; instead the `onChange` of the toggle below resets draft.
  }

  const handleToggle = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.target.checked) {
      const seed = override ?? defaultText;
      setDraft(seed);
      onPatch(seed);
    } else {
      setDraft(defaultText);
      onPatch(null);
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setDraft(e.target.value);
  };

  const handleBlur = (): void => {
    if (!checked) return;
    const trimmed = draft.trim();
    const next = trimmed.length === 0 ? null : draft;
    if (next === override) return;
    onPatch(next);
  };

  return (
    <section
      className="flex flex-col gap-2 border border-line rounded-[var(--radius)] p-3"
      data-testid={`prompts-row-${meta.key}`}
    >
      <header className="flex flex-col gap-[2px]">
        <span className="font-medium text-[12px] text-ink-2">{meta.label}</span>
        <span className="text-[12px] text-ink-4 font-sans">{meta.hint}</span>
      </header>

      {checked ? (
        meta.multiline ? (
          <textarea
            id={fieldId}
            data-testid={`prompts-editor-${meta.key}`}
            value={draft}
            onChange={handleChange}
            onBlur={handleBlur}
            spellCheck={false}
            className="font-serif w-full min-h-[120px] p-3 border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3"
          />
        ) : (
          <input
            id={fieldId}
            data-testid={`prompts-editor-${meta.key}`}
            type="text"
            value={draft}
            onChange={handleChange}
            onBlur={handleBlur}
            spellCheck={false}
            className="font-serif w-full p-2 border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3"
          />
        )
      ) : meta.multiline ? (
        <div
          data-testid={`prompts-default-${meta.key}`}
          className="font-serif w-full min-h-[120px] p-3 border border-line rounded-[var(--radius)] bg-bg-2 text-ink-4 whitespace-pre-wrap"
        >
          {defaultText}
        </div>
      ) : (
        <div
          data-testid={`prompts-default-${meta.key}`}
          className="font-serif w-full p-2 border border-line rounded-[var(--radius)] bg-bg-2 text-ink-4"
        >
          {defaultText}
        </div>
      )}

      <label className="flex items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          data-testid={`prompts-toggle-${meta.key}`}
          checked={checked}
          onChange={handleToggle}
        />
        <span className="text-ink-2">Override default</span>
      </label>
    </section>
  );
}
```

- [ ] **Step 2: Write the Storybook story**

```tsx
// frontend/src/components/SettingsPromptsTab.stories.tsx
//
// [X29] Storybook coverage for SettingsPromptsTab. Three states: all-default,
// system-overridden, every-row-overridden.

import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPromptsTab } from './SettingsPromptsTab';
import { defaultPromptsQueryKey } from '@/hooks/useDefaultPrompts';
import { DEFAULT_SETTINGS, userSettingsQueryKey, type UserSettings } from '@/hooks/useUserSettings';

const DEFAULTS = {
  system:
    'You are an expert creative-writing assistant. Help the author continue, refine, and develop their story…',
  continue:
    'Task: continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.',
  rewrite:
    'Task: rewrite the selection with different phrasing while preserving meaning and voice. Return a single alternative version.',
  expand:
    'Task: expand the selection with more detail, description, and depth. Keep the same POV, tense, and voice.',
  summarise: 'Task: summarise the selection to its essential points. Use 1–3 sentences.',
  describe:
    "Task: describe the subject of the selection with vivid sensory, physical, and emotional detail. Maintain the story's POV and tense.",
};

function withQueryClient(settings: UserSettings) {
  return (Story: () => JSX.Element) => {
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, settings);
    qc.setQueryData(defaultPromptsQueryKey, DEFAULTS);
    return (
      <QueryClientProvider client={qc}>
        <div className="bg-bg p-4 max-w-[640px]">
          <Story />
        </div>
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof SettingsPromptsTab> = {
  title: 'Settings/PromptsTab',
  component: SettingsPromptsTab,
};
export default meta;
type Story = StoryObj<typeof SettingsPromptsTab>;

export const AllDefaults: Story = {
  decorators: [withQueryClient(DEFAULT_SETTINGS)],
};

export const SystemOverridden: Story = {
  decorators: [
    withQueryClient({
      ...DEFAULT_SETTINGS,
      prompts: { ...DEFAULT_SETTINGS.prompts, system: 'You are a gothic horror novelist.' },
    }),
  ],
};

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
      },
    }),
  ],
};
```

- [ ] **Step 3: Run the prompt-tab test — still FAIL until tab is wired into Settings.tsx (Task 27 below)**

Run: `cd frontend && npm run test:frontend -- --run tests/components/Settings.prompts.test.tsx`
Expected: FAIL — `settings-tab-prompts` not found because the tab strip in `Settings.tsx` doesn't include "prompts" yet.

### Task 27: Wire the new tab into `Settings.tsx`

**Files:**
- Modify: `frontend/src/components/Settings.tsx`

- [ ] **Step 1: Add `'prompts'` to `SettingsTab` and the `TABS` list, and mount `SettingsPromptsTab`**

Change line 36:

```ts
type SettingsTab = 'venice' | 'models' | 'prompts' | 'writing' | 'appearance';
```

Change the `TABS` array (lines 38–43) to:

```ts
const TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: 'venice', label: 'Venice.ai' },
  { id: 'models', label: 'Models' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'writing', label: 'Writing' },
  { id: 'appearance', label: 'Appearance' },
];
```

Add the import at the top with the other tab imports:

```ts
import { SettingsPromptsTab } from '@/components/SettingsPromptsTab';
```

Update the `<ModalBody>` panel renderer (lines 151–159) to include the new tab:

```tsx
        {activeTab === 'venice' ? (
          <VeniceTab />
        ) : activeTab === 'models' ? (
          <SettingsModelsTab />
        ) : activeTab === 'prompts' ? (
          <SettingsPromptsTab />
        ) : activeTab === 'writing' ? (
          <SettingsWritingTab />
        ) : (
          <SettingsAppearanceTab />
        )}
```

- [ ] **Step 2: Run the prompt-tab tests — expect PASS**

Run: `cd frontend && npm run test:frontend -- --run tests/components/Settings.prompts.test.tsx`
Expected: PASS.

### Task 28: Drop the system-prompt section from `SettingsModelsTab.tsx`

**Files:**
- Modify: `frontend/src/components/SettingsModelsTab.tsx`
- Modify: `frontend/tests/components/Settings.models.test.tsx`

- [ ] **Step 1: Edit `SettingsModelsTab.tsx`**

Delete the entire system-prompt section (lines 244–278: the `<section data-testid="models-section-system-prompt">` block).

Delete the now-unused state + refs + handlers (lines 118–148):

- The `// --- System prompt (per-story) ---` comment block.
- `const activeStoryId = useActiveStoryStore((s) => s.activeStoryId);`
- `const storyQuery = useStoryQuery(activeStoryId ?? undefined);`
- `const updateStory = useUpdateStoryMutation();`
- `const [promptDraft, setPromptDraft] = useState('');`
- The `lastSeededRef` declaration and the `useEffect` that re-seeds.
- `const handlePromptBlur = () => { … }`
- The `promptId` from `useId()` (line 86) — drop that one ID.

Drop the now-unused imports at the top:
- `useEffect, useId, useRef, useState` — only `useId` is still needed (the slider IDs use it). So change to `import { useId } from 'react';`. (Double-check: confirm no other `useState` etc. usage remains in the file.)
- `useActiveStoryStore` import — drop entirely.
- `useStoryQuery, useUpdateStoryMutation` import — drop entirely.

Also drop the `// 3. System prompt — per-story textarea …` lines from the top file-comment block (lines 13–16).

- [ ] **Step 2: Edit `Settings.models.test.tsx` — drop the system-prompt scenarios**

Find every test that mentions "system prompt" or `system-prompt-textarea` / `system-prompt-empty` and delete the entire `it(...)` block. Update the file-top comment to drop bullet 3 ("System prompt textarea is hidden when no active story…").

If `useActiveStoryStore` is mocked anywhere only for the system-prompt scenarios, drop the mock too.

- [ ] **Step 3: Run both Models suites + the new Prompts suite**

Run:
```bash
cd frontend && npm run test:frontend -- --run \
  tests/components/Settings.models.test.tsx \
  tests/components/Settings.prompts.test.tsx
```
Expected: PASS for both.

### Task 29: Commit Phase G

- [ ] **Step 1: Stage + commit**

```bash
git add frontend/src/components/SettingsPromptsTab.tsx \
        frontend/src/components/SettingsPromptsTab.stories.tsx \
        frontend/src/components/Settings.tsx \
        frontend/src/components/SettingsModelsTab.tsx \
        frontend/tests/components/Settings.prompts.test.tsx \
        frontend/tests/components/Settings.models.test.tsx
git commit -m "$(cat <<'EOF'
[X29] Settings → Prompts tab; drop system-prompt section from Models tab

New SettingsPromptsTab between Models and Writing. Six rows (system +
five action templates) with read-only default + override checkbox.
Ticking PATCHes settings.prompts.{key} with the default text and reveals
an editable field; unticking PATCHes null. Storybook story covers
all-defaults, system-overridden, every-row-overridden.

The dead per-story system-prompt section in SettingsModelsTab is
removed along with its useStoryQuery / useUpdateStoryMutation /
lastSeededRef plumbing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase H — Docs + final verify + tick `[X29]`

### Task 30: Update `docs/api-contract.md`

**Files:**
- Modify: `docs/api-contract.md`

- [ ] **Step 1: Edit the user-settings section**

Find the `GET /api/users/me/settings` and `PATCH /api/users/me/settings` blocks. In each response/request shape, add the `prompts` slice next to `ai`:

```json
{
  "prompts": {
    "system": "string | null",
    "continue": "string | null",
    "rewrite": "string | null",
    "expand": "string | null",
    "summarise": "string | null",
    "describe": "string | null"
  }
}
```

Add a one-line note: *"`null` for any field means use the built-in default. The defaults are exposed read-only via `GET /api/ai/default-prompts`."*

- [ ] **Step 2: Add a new `GET /api/ai/default-prompts` section**

Insert into the `/api/ai/*` group:

```markdown
### GET /api/ai/default-prompts

Returns the canonical default templates the prompt builder falls back to
when a user has not overridden a given key. Auth-required. Constants
change only on backend deploy — frontend caches with `staleTime: Infinity`.

**Response 200**
```json
{
  "defaults": {
    "system": "string",
    "continue": "string",
    "rewrite": "string",
    "expand": "string",
    "summarise": "string",
    "describe": "string"
  }
}
```
```

- [ ] **Step 3: Update the Story shape**

Find the `Story` model documentation. Drop the `systemPrompt: string | null` field. If a separate "encrypted fields" callout lists `systemPrompt`, drop it.

### Task 31: Update `docs/encryption.md`

**Files:**
- Modify: `docs/encryption.md`

- [ ] **Step 1: Drop `Story.systemPrompt` from the encrypted-fields table/list**

Find the table or list of encrypted narrative fields. Remove the row/bullet that names `Story.systemPrompt` (or, per `schema.prisma:65`'s comment, the `(title, synopsis, worldNotes, systemPrompt)` group becomes `(title, synopsis, worldNotes)`).

### Task 32: Update `docs/venice-integration.md`

**Files:**
- Modify: `docs/venice-integration.md`

- [ ] **Step 1: Add a `## Prompt resolution` section near the existing `Web Search` / `System Prompt` content**

```markdown
## Prompt resolution

The prompt builder (`backend/src/services/prompt.service.ts`) resolves
each prompt slot via `resolvePrompt(userPrompts, key)`:

1. If `userPrompts[key]` is a non-empty trimmed string → use the override.
2. Otherwise → use `DEFAULT_PROMPTS[key]`.

Overridable keys (six): `system`, `continue`, `rewrite`, `expand`,
`summarise`, `describe`. The `'rephrase'` action is collapsed onto the
`'rewrite'` override key (both surfaces share one user-level override).

The selection text is auto-appended as `\n\nSelection: «…»` *after* the
resolved task block — users edit the instruction line only, never the
selection injection.

`freeform` and `ask` are not template-driven (the user-typed text *is*
the prompt) and do not consult `userPrompts`.

User overrides are stored in `User.settingsJson.prompts` (six
`string | null` fields). The Settings → Prompts tab is the sole
authoring surface; per-story overrides were removed in [X29].
```

### Task 33: Tick `[X29]` in `TASKS.md`

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Add the `plan:` and `verify:` lines and tick the box**

Find the existing `[X29]` line (around line 192). Replace it with:

```markdown
- [x] **[X29]** Settings → Models system prompt is dead UI. Repurposed as a Settings → Prompts tab with user-level overrides for the system prompt and five action templates (continue, rewrite/rephrase, expand, summarise, describe). Per-story `Story.systemPrompt` (column + repo path + dead Models-tab UI) removed entirely.
  - plan: [docs/superpowers/plans/2026-05-04-x29-prompts-tab.md](docs/superpowers/plans/2026-05-04-x29-prompts-tab.md)
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.user-prompts.test.ts tests/routes/user-settings.test.ts tests/routes/ai-defaults.test.ts tests/repos/story.repo.test.ts tests/routes/stories.test.ts && cd ../frontend && npm run test:frontend -- --run tests/components/Settings.prompts.test.tsx tests/components/Settings.models.test.tsx tests/hooks/useDefaultPrompts.test.tsx`
```

Also remove `X29` from the `Proposed (no plan yet)` line at the top of the file (line ~24).

> Tick *after* the verify command passes via `/task-verify X29`. The pre-edit hook will refuse to tick a task whose verify hasn't been ratified.

### Task 34: Run the full X29 verify

- [ ] **Step 1: Run via `/task-verify`**

Run: `bash .claude/skills/task-verify/run.sh X29`
Expected: exit 0, all suites green. Paste the summary line(s) into the commit message of the next task.

> If anything fails: do NOT modify the test to pass. Find the regression in the implementation and fix it.

### Task 35: Commit Phase H

- [ ] **Step 1: Stage + commit**

```bash
git add docs/api-contract.md docs/encryption.md docs/venice-integration.md TASKS.md
git commit -m "$(cat <<'EOF'
[X29] docs: api-contract, encryption, venice-integration; tick TASKS

- api-contract.md: settings.prompts slice + new GET /api/ai/default-prompts
  endpoint; drop Story.systemPrompt from the Story shape
- encryption.md: drop Story.systemPrompt from the encrypted-fields list
- venice-integration.md: new § Prompt resolution chain
- TASKS.md: tick [X29] with plan + verify lines

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase I — Review + PR

### Task 36: Invoke `repo-boundary-reviewer` on the `story.repo.ts` change + migration

- [ ] **Step 1: Dispatch the reviewer**

Use the Agent tool with `subagent_type: repo-boundary-reviewer`:

> "Review the X29 changes on this branch. Scope: backend/src/repos/story.repo.ts (systemPrompt removal), backend/prisma/schema.prisma + the 20260504000000_drop_story_system_prompt migration, and any narrative-route call sites that previously read `story.systemPrompt`. Confirm: (1) no controller/service/route still touches Story.systemPrompt; (2) ENCRYPTED_FIELDS still matches the surviving ciphertext columns; (3) the encryption leak test still covers the Story table without the dropped field; (4) the migration is non-reversible-by-design (drop columns, no backfill, no preserve table) — flag if a backfill or preserve-then-drop pattern is more appropriate, but per CLAUDE.md the project rule is no data-migration branches pre-deployment."

- [ ] **Step 2: Address `BLOCK` / `FIX_BEFORE_MERGE` findings inline**

If the reviewer flags issues at `BLOCK` or `FIX_BEFORE_MERGE` severity, fix them now (do not defer per memory `feedback_no_deferred_cleanups.md`). Re-run `/task-verify X29` after the fix.

### Task 37: Push + open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/x29-prompts-tab
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "[X29] Settings → Prompts tab; drop Story.systemPrompt" --body "$(cat <<'EOF'
## Summary

- New Settings → Prompts tab between Models and Writing. Six rows
  (system + continue + rewrite/rephrase + expand + summarise + describe)
  with read-only default + override checkbox. Ticking PATCHes
  `settings.prompts.{key}` with the default text and reveals an editable
  field; unticking PATCHes null and reverts to the read-only default.
- Backend: new `DEFAULT_PROMPTS` export + `userPrompts` resolution path
  in `prompt.service.ts`. New `GET /api/ai/default-prompts` returns the
  canonical defaults so the frontend renders the same fallback strings
  the backend uses. `settingsJson.prompts` slice (six `string | null`
  fields, 10 000-char cap, `.strict()` shape).
- Per-story `Story.systemPrompt` removed entirely — column, repo path,
  encrypt/decrypt, route schema, every test fixture, and the dead
  Models-tab UI that wrote to it.

Spec: `docs/superpowers/specs/2026-05-04-x29-prompts-tab-design.md`
Plan: `docs/superpowers/plans/2026-05-04-x29-prompts-tab.md`

## Test plan

- [x] `prompt.user-prompts.test.ts` (new, replaces `prompt.system-prompt.test.ts`)
- [x] `tests/routes/ai-defaults.test.ts` (new)
- [x] `tests/routes/user-settings.test.ts` — extended with `prompts` round-trip + deep-merge + size cap + .strict() rejection
- [x] `tests/routes/stories.test.ts`, `tests/routes/story-detail.test.ts` — fixtures swept
- [x] `tests/repos/story.repo.test.ts` — systemPrompt round-trip removed
- [x] `tests/security/encryption-leak.test.ts` — sentinel removed
- [x] `tests/components/Settings.prompts.test.tsx` (new)
- [x] `tests/components/Settings.models.test.tsx` — system-prompt scenarios removed
- [x] `tests/hooks/useDefaultPrompts.test.tsx` (new)
- [x] Storybook story `SettingsPromptsTab` (3 variants)
- [x] Migration `20260504000000_drop_story_system_prompt` applied to dev + test DBs
- [x] repo-boundary-reviewer: CLEAN

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL.**

---

## Self-review

Spec coverage:
- [x] §Resolution chain — Task 2 + 4 + 5 (DEFAULT_PROMPTS, resolvePrompt, route extraction)
- [x] §Storage shape — Task 11 (Zod + defaults), Task 21 (frontend types)
- [x] §Default-prompts endpoint — Task 7 + 8 + 9
- [x] §Routes / wiring — Task 4 + 5
- [x] §Frontend new tab — Tasks 25–29
- [x] §Removal scope (Story.systemPrompt) — Tasks 13–20 + 23
- [x] §Architecture / data flow — covered across phases
- [x] §Testing — explicit per-phase
- [x] §Migration — Task 19
- [x] §Security review — Task 36 (repo-boundary-reviewer)
- [x] §Risks / open items — none requires a dedicated task; behaviour matches spec.
- [x] §Sequence (in spec) — mapped 1:1 to plan phases A–I.
- [x] §Verify command — Task 33 wires the same one into TASKS.md, Task 34 runs it.

Type/name consistency:
- `DEFAULT_PROMPTS` keys (`system | continue | rewrite | expand | summarise | describe`) match between `prompt.service.ts` (Task 2), `ai-defaults.routes.ts` (Task 8), `useUserSettings.ts` `UserPromptsSettings` (Task 21), `useDefaultPrompts.ts` `DefaultPrompts` (Task 22), Zod schema (Task 11), `SettingsPromptsTab` `ROWS` array (Task 26).
- `userPrompts` is the consistent param name across `BuildPromptInput` (Task 2), `ai.routes.ts` + `chat.routes.ts` (Tasks 4–5), and the resolver helper.
- `data-testid` naming: `prompts-row-${key}`, `prompts-default-${key}`, `prompts-toggle-${key}`, `prompts-editor-${key}` consistent across test (Task 25) and component (Task 26).
- `settings-tab-prompts` matches the `TABS` id in Task 27.
- Migration timestamp `20260504000000_drop_story_system_prompt` consistent across Task 19 and Task 20 commit.

Placeholder scan: none. Every step has the actual code or commands.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-04-x29-prompts-tab.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints.

Auto mode is active. Will proceed with **Subagent-Driven** unless you say otherwise.
