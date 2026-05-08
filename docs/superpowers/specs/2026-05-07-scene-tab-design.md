# Scene tab — design

**Status:** Spec drafted 2026-05-07. Bd issue: TBD (file once spec is approved).

## Problem

Inkwell's AI surfaces today are oriented around an **existing** piece of text:
the selection-bubble actions (continue, rephrase, expand, summarise, describe)
operate on a selected passage; the chat ("Ask") tab answers questions about
the chapter. There is no first-class affordance for **"describe a beat that
hasn't been written yet, and produce prose for it."**

The closest existing path — the selection bubble's `describe` action — only
fires on a selected piece of text and produces sensory expansion of that
text, not new narrative action. A writer who wants to type "Jenny approaches
Linda on the veranda and they talk about cheese" and get a paragraph of
prose has to either (a) type a placeholder, select it, and use Expand
(awkward, the placeholder pollutes the chapter), or (b) use the chat tab and
manually copy/paste the assistant's reply into the chapter (loses voice
matching, no Insert affordance).

This spec adds a third tab to the chat panel — **Scene** — purpose-built for
that workflow. Scene direction in, prose out, refine in chat, approve and
insert.

## Goals

1. New `Scene` tab between `Chat` and `History`, with the same per-chapter
   scope and the same Venice streaming behavior as `Chat`.
2. **Chat-of-candidates** transcript: each user direction produces one
   assistant candidate; refinement turns produce more candidates; every
   done candidate has its own `Insert at end` button.
3. **Insert at end of chapter** (TipTap `insertContentAt(doc.content.size)`).
   No cursor-position variant in v1 — that needs prompt-engineering for
   bridge writing.
4. **Persisted sessions per chapter**, with a dedicated picker in the Scene
   tab header (NOT mixed into the History tab). Inline rename, soft-delete
   with undo, auto-title from the first direction.
5. **Stop / Retry** controls. Stop discards the partial; Retry
   appends a new candidate using the currently-selected model (so swap the
   model and Retry to retry across models).
6. Move the **model picker to a panel-footer** across all tabs (Chat too).
   Remove the redundant `temp / top_p / max` row everywhere.
7. New `scene` `PromptAction` and a new user-overridable `scene` prompt
   slot in Settings → Prompts.

## Non-goals

- **No cursor-position insert** in v1. Punted because writing prose that
  bridges into existing surrounding text is a different prompt-engineering
  problem.
- **No fork-on-historical-retry.** Retry only fires on the *latest*
  done candidate. Older candidates show `Insert at end` / `Copy` only. If
  the user wants to retry the original direction, they create a new scene
  session.
- **No per-candidate model picker.** Model is taken from the global footer
  picker at request time. To try a different model, switch in the footer
  and Retry.
- **No Scene entries in the History tab.** History stays Ask-only. Scene
  has its own picker in the Scene-tab header.
- **No data-migration code** for the `Chat.kind` column. Per CLAUDE.md
  policy — pre-deployment, no real users, dev/test DBs reset on next
  `npm run db:test:reset`. Default the column at the schema level.
- **No encryption-scheme changes.** Reuses the existing Chat/Message
  ciphertext columns and repo-layer encrypt-on-write / decrypt-on-read
  symmetry.
- **No new top-level Settings tab.** The new `scene` user prompt override
  is added as a row in the existing Settings → Prompts tab next to
  `system`, `continue`, `rewrite`, `expand`, `summarise`, `describe`.

## Data model

Add one column to the existing `Chat` model:

```prisma
model Chat {
  id              String   @id @default(cuid())
  kind            String   @default("ask")  // "ask" | "scene"
  titleCiphertext String?
  titleIv         String?
  titleAuthTag    String?
  // … rest unchanged
}
```

- `kind` is plaintext metadata, not narrative content — does not enter the
  encryption boundary.
- Default `"ask"` keeps existing rows working without a backfill (in line
  with the no-migration-branches policy: there are no existing rows yet,
  but the default also makes the column safe to add in any future order).
- The repo's existing ownership chain (Chat → Chapter → Story → User) is
  reused untouched.
- Both `kind` values share the `Message` table. No `Message.kind` is
  needed — message kind is implied by its parent chat.

### Why reuse, not fork

Both surfaces have nearly identical needs: chat-of-turns, per-chapter
scope, encrypted titles + bodies, ownership through Chapter→Story→User,
streaming via SSE, citation capture (Scene won't use it but the columns
don't cost anything when null). Forking into `Scene` / `SceneMessage`
tables would duplicate the repo layer, the encryption columns, the
leak-test sentinel coverage, and the repo-boundary review surface for
near-zero conceptual gain. If Scene later needs a column Chat doesn't,
it can be a nullable column on Chat used only when `kind='scene'`.

## API surface

All routes already exist except where marked **NEW**. The shape changes
needed:

| Route | Change |
|---|---|
| `POST /api/chapters/:chapterId/chats` | Accept optional `kind: 'ask' \| 'scene'` in body. Default `'ask'`. |
| `GET /api/chapters/:chapterId/chats` | Accept optional `?kind=ask\|scene` query filter. Omitted = both kinds (preserves current behavior for any caller that doesn't pass it). |
| `POST /api/chats/:chatId/messages` | Look up `chat.kind`; pass `action: 'ask' \| 'scene'` to `buildPrompt` accordingly. Accept optional `retry: true` in body — when true, do NOT persist a new user message and do NOT append a synthesised user message to the LLM payload (the trailing existing user message is the prompt seed). |
| `PATCH /api/chats/:id` **NEW** | Update title only. Body: `{ title: string }`. Repo's `update` method already exists. Encrypts via the Chat repo's existing title-encrypt path. |
| `DELETE /api/chats/:id` **NEW** | Hard delete. Repo's `remove` method already exists. Cascades to messages via Prisma `onDelete: Cascade`. |
| `GET /api/chats/:chatId/messages` | No change. |

Soft-delete with undo is implemented purely on the **frontend**: the row
is removed from the UI optimistically, the undo toast is shown for ~5
seconds, and the actual `DELETE` fires only after the toast dismisses. Hit
Undo before that and the request never goes out. No `deletedAt` column
needed.

### Retry flag — exact semantics

When `retry: true` is set in the POST `/messages` body:
- The route loads `priorMessages` from the DB and reuses them as-is.
- It does NOT call `messageRepo.create({ role: 'user', ... })` before
  streaming.
- The `messages` payload sent to Venice is `[systemMsg, ...priorMessages]`
  — no synthesised trailing user message is appended (the trailing entry
  in `priorMessages` is already a user turn, which is what the LLM
  responds to).
- 400 if `priorMessages` is empty or doesn't end on a `user` turn (defensive
  check; UI should never let this state arise).
- The `body.content` field MAY still be required by the existing schema
  but is ignored when `retry: true`. Cleanest: make `content`
  optional when `retry: true`, required otherwise.

## Prompt builder changes

In `backend/src/services/prompt.service.ts`:

1. Add `'scene'` to the `PromptAction` union.
2. Add `'scene'` to the `UserPromptKey` union.
3. Add a `DEFAULT_PROMPTS.scene` entry. Draft default:

   > Task: write a passage of prose that depicts the scene the user
   > describes. Render the action and dialogue directly — do not summarise.
   > Match the established voice, POV, and tense from the chapter so far.
   > Aim for roughly 100–200 words unless the user specifies otherwise.

   Final wording is tunable; the override layer means users can replace it
   anyway.

4. `buildTaskBlock` gets a new `case 'scene':` branch. Mirrors the `ask`
   branch in shape — uses `freeformInstruction` as the user direction,
   no `selectedText`. Validation: `scene` requires `freeformInstruction`,
   like `ask` does.

The system prompt + world notes + characters + chapter-content blocks all
flow through unchanged. The chapter-content budget calculation in
`buildPrompt` is reused as-is.

`renderAskUserContent`'s framing (`User question: …\n\nAttached selection:
«…»`) is **not** used for Scene — Scene's user-message content is the
direction text raw, no synthesis.

## Frontend

### Component tree (additions and rewires)

```
ChatPanel
├── HeaderTabs        (now: Chat | Scene | History)
├── tab=Chat:
│   ├── ChatMessages
│   └── ChatComposer
├── tab=Scene:
│   ├── SceneSessionHeader   NEW
│   │   └── SceneSessionPicker (button + dropdown w/ rename, delete, +new) NEW
│   ├── SceneTranscript      NEW (renders SceneCandidateCard list) NEW
│   └── SceneComposer        NEW (textarea + Generate/Stop button)
├── tab=History:
│   └── (unchanged, Ask-only)
└── ModelFooter        NEW (was ModelBar at top; now panel footer, all tabs)
```

### State (Zustand stores)

- `useSceneSessionsStore` — per-chapter list of scene sessions; active
  session id; CRUD actions calling the API. Mirrors `useChats` (if it
  exists) or owns its own data.
- `useSceneTranscriptStore` — messages of the active scene session;
  streaming state (idle / streaming / error); abort controller; current
  in-flight retry tag.
- The model footer reads from `useUserSettings` (existing) — same as today.

### Insert action

```ts
function insertCandidateAtEnd(editor: Editor, text: string): void {
  const docEnd = editor.state.doc.content.size;
  editor.chain().focus().insertContentAt(docEnd, text).run();
}
```

Same pattern `InlineAIResult.handleInsertAfter` uses, just targeted at the
document end instead of the selection end.

### Stop / cancel

The frontend holds an `AbortController` for each in-flight stream. Stop
button calls `controller.abort()`, which closes the `fetch` body; the
backend's `req.on('close')` handler aborts the upstream Venice stream and
the route's `if (!clientClosed)` guard skips the `messageRepo.create` call,
so no assistant message is persisted. The frontend drops the partial from
its store.

Escape in the composer also triggers Stop — registered in
`useKeyboardShortcuts` at a priority lower than the bubble/inline-result
dismiss shortcuts.

### Retry availability

`Retry` button renders only on the **latest** done candidate. Logic:
`isLatest = i === transcript.length - 1`, `isDone = state === 'done'`.
Both true ⇒ render Retry. Else render `Insert at end` / `Copy` only.

### Auto-title

When a new scene is created, its title is null. The first time the user
sends a direction and the assistant responds successfully (i.e. the chat
has ≥ 1 user + 1 assistant), the frontend issues a `PATCH /api/chats/:id`
with `title = truncateAtWordBoundary(firstDirection, 50)`.

Word-boundary truncation: take the first 50 chars; if char 50 is mid-word,
walk back to the previous space; trim trailing punctuation. Append `…` if
truncated. Pure client-side, no backend involvement.

### Inline rename

Click the ✏️ in a session row → the row's text turns into a small
`<input>` (autofocused, value = current title). Enter or blur saves via
`PATCH /api/chats/:id`; Escape cancels. Optimistic update on the local
session list; rollback + error toast if the request fails.

### Soft-delete with undo

Click the 🗑️ in a session row → row disappears from the list immediately.
Undo toast appears in the panel chrome with `Deleted "<title>"` and an
Undo button. After 5 seconds (or the next session interaction), the toast
auto-dismisses and the actual `DELETE /api/chats/:id` fires. Undo before
that ⇒ row reappears, no API call.

If the deleted session was the *active* one, the picker auto-selects the
next-most-recent session, or shows the empty state if none remain.

### Empty states

- **No sessions yet for this chapter.** Header shows `SCENE No session yet`.
  Body shows the instructional empty state from the mockup ("Describe what
  happens next…"). Composer is enabled — first send creates the session.
- **No active chapter.** The Scene tab is disabled (or shows a thin "Pick
  a chapter to start a scene" hint). Same gating as `Chat` today.

## Mockups

`frontend/src/components/SceneTab.mockup.stories.tsx` — already written
during brainstorming. Stories under `Mockups → SceneTab (Brainstorming)`:

- `Scene Default` — closed picker, two-turn transcript (one done +
  one streaming for variety, though this combo can't actually occur
  given chat-of-candidates semantics — see "Mockup polish" in
  Open questions).
- `Scene Streaming` — composer locked, Stop button, hint shows ⎋ to stop.
- `Scene PickerOpen` — dropdown with rename + delete + new entry.
- `Scene DeleteUndoToast` — after-delete toast.
- `Scene Empty` — instructional empty state.
- `Chat WithModelFooter` — global change applied to the existing tab.
- `ChatVsSceneSideBySide`, `Management Showcase` — comparison views.

The mockup file is **brainstorming-only** and gets deleted (or replaced by
the real `SceneTab.stories.tsx`) once the implementation lands.

## Encryption / repo-boundary

- `Chat.kind` is **plaintext metadata**. It does not name characters,
  describe scenes, or contain narrative content of any kind, so it
  doesn't enter the encryption boundary. Storing it plaintext is correct.
- Scene sessions reuse the existing `Chat.title{Ciphertext,Iv,AuthTag}`
  triple. Auto-titles derived from the first direction ARE narrative
  content (they're a slice of the user's writing), so they MUST be
  encrypted on write — which the existing chat repo already does. No
  change needed.
- Scene messages reuse `Message.contentJson{Ciphertext,Iv,AuthTag}`. Same
  encrypt-on-write / decrypt-on-read invariant.
- The leak-test sentinel ([E12]) already covers the `Chat.title` and
  `Message.contentJson` plaintext absence on those columns. No new
  sentinel coverage is needed.
- `repo-boundary-reviewer` should be invoked on the chat-route changes
  even though no new ciphertext columns are added, because the route's
  decision tree gets a new branch (`kind`-dependent prompt action +
  retry flag) and the repo-layer invariant should be re-affirmed.
- `security-reviewer` should be invoked on the new `PATCH` and `DELETE`
  endpoints — both are first-time exposures of repo methods that already
  existed but had no public surface. Confirm ownership middleware fires
  before the title is decrypted/echoed and before the row is deleted.

## Defaults locked in during brainstorming

- Feature name: **Scene**.
- Persistence: **option C** (DB-persisted, distinct UI; History stays
  Ask-only).
- Conversation shape: **chat-of-candidates** (one Insert button per
  candidate).
- Refinement context: **full chat history** (entire transcript sent to
  Venice on every turn).
- Insertion target: **end-of-chapter only**.
- Model picker: **bottom footer**, applied globally to Chat as well.
- Params row (`temp / top_p / max`): **removed everywhere**.
- Session management: inline rename, auto-title from first direction
  (truncated at word boundary, ~50 chars), soft-delete with undo toast.
- Data model: reuse `Chat`/`Message`, add `Chat.kind` column.
- Stop button: discards the partial; no candidate persisted.
- Retry: latest done candidate only; appends new candidate; uses
  current footer model.
- Cross-model retry: switch model in footer, hit Retry.

## Open questions

These are intentionally left for plan-writing or implementation. Flag them
back if any should be settled in the spec instead.

1. **Default `scene` prompt wording.** The draft above is reasonable but
   should be reviewed by someone who's been writing in the editor — the
   right defaults come from observed-usage, not first principles.
2. **Composer textarea row count and auto-grow.** Mockup uses 3 rows
   fixed. A `min-rows=3, auto-grow on overflow` variant might be more
   useful for longer scene directions. Tiny detail; punted to F-task.
3. **Mockup polish.** The brainstorming mockup shows turn 1 done + turn 2
   streaming simultaneously — a state that doesn't occur in reality
   (each turn streams sequentially, not concurrently). Real implementation
   should never render this combo.
4. **Per-chapter session limit.** Without a cap, a chapter could
   accumulate hundreds of scene sessions. Probably fine for v1; revisit
   if it bites.
5. **`abort` semantics on the backend retry path.** Same flow as a
   normal stream cancel, but worth a code-quality eye when implemented.
