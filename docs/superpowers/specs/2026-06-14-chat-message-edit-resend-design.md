# Chat/Scene Message Edit + Resend — Design

**Date:** 2026-06-14
**Status:** Design approved (pending written-spec review)
**Scope:** Both the Chat tab and the Scene tab.

## Goal

Let a user edit and resend their own messages in a chat/scene thread, and
generalize assistant-reply regeneration to any assistant message — instead of
the current "copy the whole thing and send it again" workaround.

## Summary of behavior

- **Edit** (user messages only): a pencil button under each user message turns
  that message's bubble into an inline editable textarea, with **Cancel** /
  **Confirm** buttons beneath it. Confirm persists the new text *in place* —
  it does **not** re-run the LLM and does **not** touch any other message in
  the thread. The bottom composer is untouched.
- **Resend** (user messages): a button under each user message (reusing the
  icon already used for assistant regeneration) drops every message below this
  one and re-runs the LLM from this user turn.
- **Regenerate** (assistant messages): the existing assistant-row regenerate
  button, generalized — clicking it on *any* assistant message drops that
  message and everything below it, then re-runs the LLM from the **preceding**
  user turn.
- **Confirm guard:** Resend and Regenerate count the messages they would
  delete. If more than one would be dropped, show a confirmation dialog naming
  the count. If one or zero would be dropped (e.g. regenerating the trailing
  assistant reply — today's behavior), fire immediately with no prompt.

## Key architectural facts (verified)

- Chat and Scene are the **same** backend: one `Chat` model with a `kind`
  field (`"ask"` vs `"scene"`) and one `Message` model
  (`backend/prisma/schema.prisma:202-261`). One handler serves both:
  `POST /api/chats/:chatId/messages` (`backend/src/routes/chat.routes.ts:199`).
  The only `ask`/`scene` divergence is prompt-template selection inside the
  handler (`chat.routes.ts:306`).
- Both tabs send through one frontend hook, `useSendChatMessageMutation`
  (`frontend/src/hooks/useChat.ts:179`), and both render shared `messageRow`
  components. So one backend change and one shared hook extension cover both
  panels.
- The drop primitive already exists: `messageRepo.deleteAllAfter(chatId,
  afterMessageId)` (`backend/src/repos/message.repo.ts:101`), used today by the
  assistant regenerate path with `afterMessageId = lastUserMsg.id`. This design
  generalizes the anchor from "last user message" to "any user message."
- `Message` is currently append-only (`createdAt` only, no `updatedAt`).
  CLAUDE.md calls this a deliberate invariant; this design relaxes it for the
  edit case (see Data model).

## The unified "replay from user turn" primitive

Resend and Regenerate are the same operation with different anchor resolution:

> **Replay from user message `U`** = `deleteAllAfter(chatId, U.id)` (drop
> everything after `U`) → replay `U`'s existing content against Venice →
> persist the new assistant reply.

- **Resend** on user message `U` → anchor is `U` itself.
- **Regenerate** on assistant message `M` → anchor is `M`'s preceding user
  message. Because the drop is "everything after the anchor," it naturally
  includes `M` and everything below it — which is required, since the new reply
  must be rebuilt from the preceding user turn.

The frontend computes the anchor user-message id in both cases (it holds the
full ordered message list) and passes it to the backend as `fromMessageId`.

## Data model

Add a **nullable** `updatedAt DateTime?` to `Message`
(`backend/prisma/schema.prisma`). Semantics:

- `null` → never edited.
- non-null → the timestamp of the last edit.

This is deliberately *not* Prisma's auto `@updatedAt` (which would equal
`createdAt` on insert and make an "edited?" test ambiguous). Only the edit path
writes it; create leaves it `null`. This preserves the spirit of append-only —
nothing but an explicit edit ever mutates the row — and records edit-time
truthfully so a future `(edited)` marker is a frontend-only change.

One migration adds the column. No backfill (no pre-existing rows; pre-deployment
project — see CLAUDE.md "Don't write data-migration branches").

The `(edited)` marker is **out of the UI for now** by request — the column is
populated but nothing renders it yet.

## Shared schema (`shared/src/schemas/message.ts`)

- `messageSchema` gains `updatedAt: z.string().datetime().nullable()`.
- New `editMessageBodySchema = z.strictObject({ content: z.string().min(1) })`
  — the PATCH body. No `modelId`, `attachment`, or `retry`; an edit only
  changes text.
- `sendMessageBodySchema` gains an optional `fromMessageId: z.string().min(1)`.
  This adds a third request mode to the endpoint, which now serves "exactly one
  of three" intents:

  | Intent | Body | Replay anchor |
  |---|---|---|
  | New message | `{ content, modelId, … }` | n/a — appends a new user turn |
  | Banner retry | `{ retry: true, modelId }` | the **last** user message |
  | Resend / Regenerate | `{ fromMessageId, modelId }` | the message at `fromMessageId` |

  The `superRefine` generalizes today's two rules into three (today: "content
  required unless retry" + "content omitted when retry"):

  1. `content` is **required unless** `retry === true` **or** `fromMessageId` is
     set (generalizes the existing rule 1).
  2. `content` must be **omitted when** `retry === true` **or** `fromMessageId`
     is set — a replay carries no new text; it reuses the anchor's stored
     content (generalizes the existing rule 2; this is the
     `content`/`fromMessageId` mutual-exclusion).
  3. `retry` and `fromMessageId` are **mutually exclusive** — they are two ways
     to name the same replay anchor, so setting both is ambiguous and rejected.

  `retry: true` (no `fromMessageId`) is kept as the error-banner shorthand:
  `useBannerRetry` only means "re-run the last turn that failed" and never needs
  to name a specific message, so this path stays byte-for-byte unchanged.
  `fromMessageId` is purely additive for the new buttons, which always send it
  explicitly. After the handler resolves the anchor (`retry` → last user
  message; `fromMessageId` → `findById`), both replay modes converge on the same
  `deleteAllAfter(anchor.id)` + regenerate logic.
- Tests for the new schema and refinement live in
  `shared/tests/message.schema.test.ts` — including the three refine rules
  (accept each of the three valid modes; reject `content`+`retry`,
  `content`+`fromMessageId`, `retry`+`fromMessageId`, and none-of-the-three).

## Backend

### Edit endpoint — `PATCH /api/chats/:chatId/messages/:id`

(`backend/src/routes/chat.routes.ts`, `backend/src/repos/message.repo.ts`)

1. Resolve `userId` from `req.user!.id`; enforce chat ownership via the repo
   (same pattern as the existing message routes).
2. Load the target message; assert it belongs to this chat and `role === 'user'`
   (editing assistant/system messages is rejected with 4xx).
3. `messageRepo.update(id, { content })`:
   - writes the new content through the existing encrypted-write path
     (`writeEncrypted(req, 'content', content)`), same as `create`;
   - sets `updatedAt = now()`;
   - bumps `Chat.lastActivityAt` (an edit counts as activity), reusing the
     same atomic bump the `create` path already performs;
   - returns `shape(row, req)` (`RepoMessage`) like the other repo methods.
4. Returns the updated, decrypted message in the owning user's response
   (`{ message }`), validated against `messageSchema`.

#### `updatedAt` serialization plumbing (don't skip)

Adding `updatedAt` to the wire `Message` ripples through two spots that the
`as unknown as RepoMessage` cast in `shape()` (message.repo.ts:149) would
otherwise let pass silently:

- **`RepoMessage` type** (message.repo.ts:23) is
  `Omit<Message, 'createdAt'> & { createdAt: Date }`. It must also omit and
  re-add `updatedAt`:
  `Omit<Message, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date | null }`.
  Without this, the cast parks a runtime `Date | null` where the type claims
  the wire `string | null`.
- **`serializeMessage`** (lib/serialize.ts:45) must add
  `updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null` — the exact
  nullable-date pattern already used for `summaryUpdatedAt` at serialize.ts:126.

### Resend / regenerate — generalize the existing POST handler

(`backend/src/routes/chat.routes.ts:199`)

The current handler gates behavior on `body.retry` at **four** sites, plus a
validation 400. The change is *not* limited to "resolve the anchor" — the whole
retry branch generalizes. Introduce `const isReplay = body.retry === true ||
body.fromMessageId !== undefined` and resolve the anchor once:

```
anchor = body.fromMessageId
  ? await messageRepo.findById(body.fromMessageId)   // ownership-scoped
  : lastUserMsg;
```

Then update every `body.retry` site to `isReplay` and read from `anchor`:

1. **Validation 400** (currently chat.routes.ts:240-248): the existing
   `retry && !lastUserMsg` → 400 keeps its meaning. Add a sibling for the
   `fromMessageId` path: if `fromMessageId` is set and `anchor` is null
   (not found / not owned / wrong chat) **or** `anchor.role !== 'user'`, return
   a 400 (`code: 'resend_invalid_state'`). `findById` is ownership-scoped, so a
   foreign or missing id resolves to null and is rejected here.
2. **Delete + refetch** (254-258): `if (isReplay && anchor)` →
   `deleteAllAfter(chatId, anchor.id)` then re-fetch history.
3. **`trailingUserContent`** (314-316): read `anchor.content`, **not**
   `lastUserMsg.content`.
4. **Messages-array assembly** (376-378): branch on `isReplay`
   (`[systemMsg, ...history]` vs `[systemMsg, ...history, synthesisedUserMsg]`).
5. **Persist guard** (381): `if (!isReplay)` — **this is the trap.** It stays
   `if (!body.retry)` and every Resend re-persists a duplicate user message,
   because a replay must reuse the anchor row, not insert a new one.

Anchor semantics: `deleteAllAfter` drops everything after the anchor — for the
**Regenerate** case the frontend passes the assistant message's *preceding* user
message, so the assistant message being regenerated is included in the drop.
Works identically for `kind: 'ask'` and `kind: 'scene'` (only prompt-template
selection differs, untouched here). The error-banner retry (`useBannerRetry`)
keeps using `retry: true` with no `fromMessageId`, so that path is unchanged.

#### Ordering model (acknowledged assumption)

`deleteAllAfter` orders by `createdAt` with a tie-break that deletes every row
sharing the anchor's exact `createdAt` except the anchor itself
(message.repo.ts:122-124). `Message` has no monotonic sequence column. Today the
anchor is always the trailing user message, so the blast radius is just its own
later assistant reply. Generalizing the anchor to a mid-thread message widens it
in theory: if two messages ever shared the same millisecond, resending the later
one could drop a same-ms row that precedes it.

In practice turns are seconds apart, so a same-millisecond collision is
effectively impossible. We **deliberately do not** add an id-secondary-sort
"fix": cuid is not reliably monotonic within a millisecond, so a secondary sort
would be false reassurance rather than a real ordering guarantee. Instead we
rely on the practical timing gap and make the two consumers agree by
construction: the frontend confirm-guard count (below) is derived from the same
`createdAt`-asc message list (`findManyForChat` ordering), so the count shown to
the user matches what the backend deletes. This assumption is recorded here so a
future contributor who introduces sub-second message bursts knows to revisit it
(the proper fix then is a monotonic sequence column, not a cuid sort).

## Frontend

### UI (`frontend/src/components/messageRow/`)

- New `EditAction` primitive (pencil icon) in `primitives.tsx`.
- The user-row **Resend** button reuses the existing `RegenerateAction` icon
  ("the one already in use for LLM replies").
- `UserMessageRow.tsx` gains an actions row: **Edit** + **Resend**. In edit
  mode the bubble renders an inline `<textarea>` reusing the composer's
  text-input styling, with **Cancel** / **Confirm** beneath that message.
- `AssistantMessageRow.tsx` / its wiring: the **Regenerate** action now appears
  on every assistant message, not only the trailing one.
- No `(edited)` marker is rendered (deferred).
- Edit / Resend / Regenerate buttons are disabled while a turn is streaming for
  that chat (the draft store is active).

### State / hooks (`frontend/src/hooks/`)

- New `useEditMessageMutation`: `PATCH /chats/:chatId/messages/:id`. Its args
  must include `chapterId` (not just `chatId`), because on success it invalidates
  **both** query keys, mirroring `useSendChatMessageMutation` (useChat.ts:242,248):
  - `chatMessagesQueryKey(chatId)` — the thread re-renders with the new text;
  - `chatsBaseQueryKey(chapterId)` — the edit bumped `Chat.lastActivityAt`, so
    the SessionPicker order and its "X ago" labels must re-sort. Omitting this is
    the direct consequence of the bump decision; without it the edit silently
    fails to re-sort the session list.
- Resend/regenerate extends `useSendChatMessageMutation` to pass
  `fromMessageId`. (That hook already invalidates both keys, so the resend path
  re-sorts the session list for free.)
- A small shared piece (a hook, e.g. `useMessageEditing`, plus shared resend
  wiring) holds:
  - `editingMessageId` — only one message is editable at a time per tab;
  - the resend/regenerate handler that resolves the anchor user-message id
    (user row → self; assistant row → nearest preceding `role: 'user'`
    message) and fires the confirm guard;
  consumed identically by `ChatTab` and `SceneTab` so there is no per-tab
  duplication.
- **Confirm guard:** the handler counts persisted messages that would be
  deleted — i.e. messages positioned after the anchor in the same
  `createdAt`-asc list returned by the messages query (the index after the
  anchor's index). This is the same ordering the backend `deleteAllAfter` uses,
  so the displayed count matches the actual delete (see "Ordering model"). If
  `> 1`, show a confirmation dialog naming the count before firing; otherwise
  fire immediately.

## Edge cases

- Confirm-edit with empty/whitespace-only text → Confirm disabled (mirrors
  `content.min(1)`).
- Confirm-edit with text unchanged from the original → exit edit mode without a
  PATCH (no spurious `updatedAt`).
- Resend a user message / regenerate an assistant message whose drop set is the
  single trailing message → 1 dropped → no confirmation (preserves today's
  frictionless trailing-regenerate).
- Regenerate on an assistant message with no preceding user message → the
  button is disabled (defensive; the first thread message is always a user
  turn, so this should not occur in practice).
- Edit is user-messages-only; assistant and system rows are never editable.

## Testing

- **Shared (`shared/tests/`):** `editMessageBodySchema` accept/reject;
  `sendMessageBodySchema` `fromMessageId`/`content` mutual-exclusion refinement;
  `messageSchema` accepts nullable `updatedAt`.
- **Backend (requires the docker stack up — vitest globalSetup hits Postgres):**
  - `message.repo.update` encrypt/decrypt round-trip; `updatedAt` set on edit,
    `null` on create; `Chat.lastActivityAt` bumped by an edit.
  - `serializeMessage` emits `updatedAt` as an ISO string when set and `null`
    otherwise (guards the `RepoMessage` cast / serialize plumbing).
  - PATCH endpoint: ownership enforced; `role !== 'user'` rejected; plaintext
    not leaked outside the owning user's response.
  - Resend with `fromMessageId` drops exactly the messages after the anchor and
    regenerates, for both `kind: 'ask'` and `kind: 'scene'`.
  - **Resend does not duplicate the anchor user message** — after a resend the
    user-message count is unchanged (regression guard for the `if (!isReplay)`
    persist gate; the trap from the handler generalization).
  - `fromMessageId` validation: a non-existent / foreign / `role !== 'user'`
    anchor returns 400 and mutates nothing.
  - The encryption leak test ([E12]) stays green after the schema/migration
    change.
- **Frontend (jsdom):**
  - `UserMessageRow` edit mode: enter, cancel, confirm; empty/unchanged
    guards; buttons disabled while streaming.
  - Resend/Regenerate confirm-dialog threshold (>1 prompts and names count;
    ≤1 fires immediately).
  - Assistant regenerate available on a non-trailing message; disabled with no
    preceding user message.
  - `useEditMessageMutation` PATCH + invalidates **both** `chatMessagesQueryKey`
    and `chatsBaseQueryKey` (session-list re-sort after the `lastActivityAt`
    bump).
- **Close-gate reviewers:** `repo-boundary-reviewer` (message repo + narrative
  route + migration touching a narrative table) and `security-reviewer` (PATCH
  mutating encrypted content; ownership/role guard).

## Out of scope (possible follow-ups)

- Rendering the `(edited)` marker in the UI (column is populated; deferred).
- Edit history / audit trail (only latest text is kept).
- Editing assistant or system messages.
