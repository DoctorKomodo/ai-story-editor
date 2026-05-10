# k1r — Unified prompt-building (canonical message-array shape)

**Status:** design approved 2026-05-10
**bd:** story-editor-k1r (P2 task) — closes story-editor-9ph as a side-effect

## Goal

Move every `buildPrompt` action onto the same message-array shape so context lives in the system message and the user message holds only what the user contributed this turn. This eliminates the asymmetry that produced [story-editor-9ph](../../../) (Chat retry on `ask` drops chapter / characters / world-notes context — LLM acts blind) and removes the per-action divergence that fed the bug.

## Non-goals

- No DB schema change. `Message.contentJson` already stores the user's literal input; framing is build-time-only.
- No data migration / dual-write / dual-read. Single-version cutover per the project's no-data-migration-branches rule (CLAUDE.md "General").
- No change to inline AI's per-button surface, the chat surface, the retry semantics (linear-replace via `deleteAllAfter`), or the request/response shapes seen by the frontend. The change is server-internal: how `buildPrompt` assembles the array passed to Venice.
- Not adjusting the existing `[X29]` user-prompt-override mechanism beyond extending it to a new `ask` template key.

## Background

`buildPrompt` in `backend/src/services/prompt.service.ts` produces two structurally different message arrays:

**`scene` action** (lines 232-251):
```
system: systemContent ⊕ worldNotesBlock ⊕ charactersBlock ⊕ chapterBlock ⊕ sceneTemplate
user:   freeformInstruction
```

**Every other action** — `ask`, `continue`, `rephrase`/`rewrite`, `expand`, `summarise`, `describe`, `freeform` (lines 253-269):
```
system: systemContent
user:   worldNotesBlock ⊕ charactersBlock ⊕ chapterBlock ⊕ taskBlock
```

This bifurcation drove 9ph: `chat.routes.ts:476-478` strips the synthesised user message on retry (the trailing user turn is already in history), which incidentally strips chapter/characters/world-notes for `ask` but not `scene` (whose context is in the system message and thus preserved).

Other consequences of the split:
- `chat.routes.ts:455-466` carries a special `ask`-attachment-rewrap branch in history mapping (re-renders prior `ask` user turns via `renderAskUserContent`) because the bare-text history version doesn't match the synthesised version originally sent to Venice. Scene history doesn't need this.
- Token-budget calculation in `buildPrompt` has a `scene`-vs-other ternary in `fixedTokens`.
- Future actions face the same fork: where does context go for `<new-action>`?

## Canonical shape

```
system: [systemContent, worldNotesBlock, charactersBlock, chapterBlock, taskTemplate(action)]
        .filter(non-empty)
        .join('\n\n')

user:   buildUserPayload(action, freeformInstruction, selectedText, attachment)
```

**Rule:** `system` carries everything stable (system prompt + world + characters + chapter + per-action task template). `user` carries what the user contributed this turn. No `if (action === ...)` branches in `buildPrompt` outside the per-action template selection.

## `buildUserPayload`

| Action | User payload |
|---|---|
| `scene` | `freeformInstruction` (user's direction) |
| `ask` | `freeformInstruction` (the question), optionally followed by `\n\nAttached selection: «${attachment.selectionText}»` if the turn has an attachment |
| `continue` | `Selection: «${selectedText}»` if `selectedText` non-empty, else imperative fallback `Continue.` |
| `rephrase` / `rewrite` | `Selection: «${selectedText}»` (frontend never invokes with empty selection) |
| `expand` | same |
| `summarise` | same |
| `describe` | same |
| `freeform` | `${freeformInstruction}` (+ `\n\nSelection: «${selectedText}»` if `selectedText` non-empty) |

The `Continue.` fallback for `continue` covers the cursor-at-end-of-chapter case where the frontend issues `continue` with `selectedText: ''`. Other inline AI actions are guarded at the frontend (their buttons are disabled without a selection); their fallback is effectively dead code but kept for shape consistency.

## Per-action templates

`DEFAULT_PROMPTS` in `prompt.service.ts` adds an `ask` key:

```ts
ask: 'Task: answer the user\'s question about the story. Use the chapter and character context to inform your answer.'
```

`UserPromptKey` extends to include `'ask'`, so per-user `ask` overrides flow through `[X29]`'s existing override layer (`/api/user-settings` `userPrompts.ask`).

`taskTemplate(action)` becomes a uniform lookup over `DEFAULT_PROMPTS` (with override resolution). The `if (input.action === 'scene')` template-vs-taskBlock branch in `buildPrompt` is gone.

## `buildPrompt` rewrite

Single return path:

```ts
const systemParts = [
  systemContent,
  worldNotesBlock,
  charactersBlock,
  chapterBlock,
  taskTemplate,
].filter(p => p.length > 0);

const userPayload = buildUserPayload(input);

return {
  messages: [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: userPayload },
  ],
  venice_parameters: { include_venice_system_prompt: includeVeniceSystemPrompt },
  max_completion_tokens: responseTokens,
};
```

Token budget:
```ts
const fixedTokens =
  estimateTokens(systemContent) +
  estimateTokens(worldNotesBlock) +
  estimateTokens(charactersBlock) +
  estimateTokens(taskTemplate) +
  estimateTokens(userPayload);
const chapterBudgetTokens = promptBudgetTokens - fixedTokens;
```

No scene-vs-other ternary. Chapter trimming logic unchanged (slice from the start when over budget — see existing lines 219-226).

## `chat.routes.ts` simplifications

Three structural simplifications fall out:

### (a) History mapping — drop the ask-attachment-rewrap branch

The current branch at lines 455-466:

```ts
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
```

…becomes a uniform per-action map. For any prior user turn (regardless of action) that carries an `attachmentJson.selectionText`, append `\n\nAttached selection: «${selectionText}»` to the bare content string. This keeps cross-turn signal alive (the model sees what the user attached on each prior turn) and removes the action-specific branch. `renderAskUserContent` is no longer needed and is deleted.

### (b) Retry-vs-non-retry messages-array fork — gone

By construction, on retry the trailing history entry — which `historyMap` builds from `lastUserMsg.contentJson` + `lastUserMsg.attachmentJson` under the unified mapping — equals what `buildUserPayload` would emit for the same inputs. So:

```ts
const messages = body.retry
  ? [systemMsg, ...history]              // trailing history entry IS the user msg
  : [systemMsg, ...history, userMsg];
```

Chapter / characters / world-notes context lives in `systemMsg`, included in both branches. The 9ph bug is structurally impossible.

`buildPrompt` is still called on retry — its `systemMsg`, `venice_parameters`, and `max_completion_tokens` outputs are needed. Its `userMsg` output is unused on retry (the trailing history entry is the source of truth). Pass `trailingUserContent` as `freeformInstruction` to satisfy validation; pass no `attachment` (irrelevant — the corresponding history entry has its own attachment baked in).

### (c) `[SC6]` comment update

The comment at lines 473-475 ("On retry the trailing user turn is already in history; do NOT append synthesisedUserMsg again or the model would see a duplicate user turn.") becomes accurate: under the unified shape the trailing entry IS the user message, so dropping the synthesised append is correct *and* preserves context. Update the comment to reflect that the equivalence is now structural, not coincidental.

## `ai.routes.ts`

No structural change. `buildPrompt` returns a `messages` array; the route forwards it. The shape is now system-heavy, but the route doesn't care. Tests need re-blessing (see Tests).

## Storage / migration

No DB schema change. `Message.contentJson` continues to store the user's literal input (ask: the question; scene: the direction; freeform: the freeform instruction). `Message.attachmentJson` continues to store the attachment shape. Framing (`Attached selection: «...»`, `Selection: «...»`) is rebuilt at request time by `historyMap` for prior turns and by `buildUserPayload` for the current turn.

Single-version cutover. No dual-write, no dual-read, no feature flag. Per CLAUDE.md "General": "Don't write data-migration branches."

## Tests

### Unit (prompt.service.test.ts)

Every existing shape assertion is re-blessed for the unified shape. New / changed assertions:

- For each of the 9 actions, assert `messages[0].role === 'system'`, `messages[1].role === 'user'`, and that the system content contains `Chapter so far:` (when chapter non-empty), `World notes:` (when worldNotes non-empty), `Characters:` (when characters non-empty), and the action's task template.
- For each of the 9 actions, assert the user payload matches the table in §`buildUserPayload`.
- New invariant test: across all actions, `messages[0].content` is the union of stable context + task template; `messages[1].content` is purely the action's user payload — no chapter/world/character substrings leak into `messages[1]`.
- New unit test for `buildUserPayload` covering the matrix `action × (selection-present / selection-empty) × (attachment / no-attachment)`. The empty-selection imperative-fallback path for `continue` is covered explicitly.

### Integration (chat.test.ts)

- Re-bless retry tests (case A / B / C) for the unified shape.
- Re-bless ask-attachment tests for the unified history mapping (attachment framing still appears in prior turns; just via the uniform branch now).
- **New regression test for 9ph** (independent of unification, survives any future shape changes): spy on the Venice client's `chat.completions.create` call; on retry, assert `messages.some(m => m.content.includes('Chapter so far:'))`. This catches any future regression that re-introduces a context-loss path on retry.
- Re-bless ask-attachment-rewrap tests as the uniform mapping now applies to scene as well.

### Integration (ai.test.ts)

Re-bless inline AI shape tests for the new system/user split. Add the same `messages[0].content includes 'Chapter so far:'` invariant as the chat tests for parity.

### L-series (live, dev-only)

Not an automated gate. Before merging convergence → main, run `npm run test:live` against a stable test chapter:
- `ask` chat: same question before/after, eyeball quality and chapter-fidelity.
- One inline AI action (e.g. `continue` from the same selection): eyeball whether continuation matches voice/POV at the same level as before.
- Sanity-check `scene` (shape unchanged): same direction before/after should produce equivalent prose.

Expectation: most hosted LLMs (including Venice's models) prefer system-side stable context, so quality should be flat or marginally improved. Any visible regression is a blocker.

## Documentation

`docs/agent-rules/backend.md` AI section gains a new subsection: **Canonical message-array shape**. Captures:

- The `system = stable context + task template, user = what the user contributed` rule.
- The `buildUserPayload` table.
- The invariant that every action goes through the same code path in `buildPrompt`.
- A pointer to this design doc for the rationale (why ask was special, why we unified).

This sets the convention for future actions: they inherit the canonical shape automatically.

## Closes / unblocks

- **story-editor-9ph** — closes as a side-effect. Chapter / characters / world-notes context lives in `systemMsg`, retry preserves it by construction. The new regression test in `chat.test.ts` is the structural guarantee.
- **story-editor-k1r** itself.

## Acceptance

- One canonical message-array shape across all `buildPrompt` actions; no `if (action === 'scene')` or `if (action === 'ask')` branches remain in `buildPrompt` outside the per-action `taskTemplate` lookup.
- Chat `ask` retry preserves chapter context (closes 9ph as a side-effect; explicit regression test asserts this).
- `chat.routes.ts:455-466` ask-attachment-rewrap branch removed; history mapping is uniform across actions.
- `chat.routes.ts:476-478` retry-vs-non-retry fork removed; both paths use the same shape.
- `renderAskUserContent` deleted (no remaining caller — verify via `grep -r renderAskUserContent backend/src backend/tests` returns only the deleted file).
- All existing prompt / chat / ai-route tests pass after re-blessing for the unified shape.
- New unit tests cover `buildUserPayload` matrix and the system-content invariant.
- Layout decision documented in `docs/agent-rules/backend.md`.
- L-series live-test sanity check (manual) shows no quality regression for `ask` and `continue` against a stable chapter.

## Files touched

- `backend/src/services/prompt.service.ts` — `buildPrompt` rewrite, `buildUserPayload` extraction, `DEFAULT_PROMPTS.ask` addition, `UserPromptKey` extension, `renderAskUserContent` deletion.
- `backend/src/routes/chat.routes.ts` — history mapping unified, retry/non-retry messages-array fork removed, `[SC6]` comment updated, `renderAskUserContent` import removed.
- `backend/src/routes/ai.routes.ts` — no structural change; tests re-blessed.
- `backend/tests/services/prompt.service.test.ts` — re-blessed; new invariant tests; new `buildUserPayload` matrix tests.
- `backend/tests/routes/chat.test.ts` — re-blessed retry / attachment tests; new 9ph regression test.
- `backend/tests/routes/ai.test.ts` — re-blessed shape tests.
- `docs/agent-rules/backend.md` — new canonical-message-array-shape subsection.
