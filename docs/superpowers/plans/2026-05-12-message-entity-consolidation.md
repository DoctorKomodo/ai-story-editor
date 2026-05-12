# Message entity consolidation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate `Message` into a single canonical Zod schema in `story-editor-shared`, rename the misnamed `contentJson` field (Prisma + wire + repo + frontend) to `content`, drop the JSON round-trip wrap for that field, add egress validation on the GET endpoint, rip-and-replace all four hand-rolled definitions in one PR.

**Pattern source:** PR #100 (Character entity consolidation). The `shared/` workspace, `respond()`, `serializeCharacter`, and the `messagesResponseSchema.parse(…)` runtime-validation idiom are all already in place — this plan extends them to Message and includes one new mechanical change (`contentJson` → `content` rename with ciphertext-format change).

**Tech Stack:** TypeScript strict, Zod 4, Vitest 4, Express 5, Prisma 7, React 19, Vite 8, TanStack Query. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-12-message-entity-consolidation-design.md`

**bd:** `story-editor-j76` — Migrate Message Zod schemas to story-editor-shared. Plan link to be applied via `bash scripts/bd-link-plan.sh story-editor-j76 docs/superpowers/plans/2026-05-12-message-entity-consolidation.md` *after user approval of this plan*.

---

## File structure

**Created (new):**
- `shared/src/schemas/message.ts` — Zod schemas, types, encrypted-field tuples
- `shared/tests/message.schema.test.ts` — schema unit tests
- `backend/prisma/migrations/<timestamp>_rename_message_contentjson_to_content/migration.sql` — column rename

**Modified (shared):**
- `shared/src/index.ts` — add re-exports for the new schemas/types

**Modified (backend — schema + repo + routes + lib):**
- `backend/prisma/schema.prisma` — rename three `contentJson*` columns on `Message` to `content*`
- `backend/src/repos/message.repo.ts` — import from shared, split `ENCRYPTED_FIELDS` / `JSON_PAYLOAD_FIELDS`, rename `contentJson` → `content` in `MessageCreateInput`, drop JSON round-trip for `content`
- `backend/src/routes/chat.routes.ts` — replace inline `PostMessageBody` / `MessageRole`, use `respond(messagesResponseSchema, …)` + new `serializeMessage`, rename writes/reads to `content`, delete dead-defensive branches at `:402-404` and `:440-441`
- `backend/src/lib/serialize.ts` — add `serializeMessage(row: RepoMessage): Message`
- `backend/src/lib/venice-citations.ts` — delete the local `Citation` interface (no re-export); keep `projectVeniceCitations` as sole export

**Modified (frontend — hook + lib + components):**
- `frontend/src/hooks/useChat.ts` — delete `ChatMessage`/`ChatMessageAttachment`/`ChatRole`/`Citation` re-export/`isCitationArray` re-export; runtime-parse via `messagesResponseSchema`
- `frontend/src/lib/api.ts` — delete `MessageRow` + `listMessagesForChat` (dead code)
- `frontend/src/lib/citations.ts` — DELETE file
- `frontend/src/lib/sse.ts` — switch `Citation` import to shared; replace four `isCitationArray(…)` call sites with `citationSchema.array().safeParse(…).success`
- `frontend/src/lib/streamingAI.ts` — switch `Citation` import to shared
- `frontend/src/components/messageRow/utils.ts` — DELETE `getMessageText` (and the file if it has no other exports)
- `frontend/src/components/messageRow/primitives.tsx` — switch `Citation` import to shared
- `frontend/src/components/messageRow/UserMessageRow.tsx` — `ChatMessage` → `Message`; read `message.content` directly (drop `getMessageText` call); rename `message.attachmentJson` reads unchanged
- `frontend/src/components/messageRow/AssistantMessageRow.tsx` — `ChatMessage` → `Message`; read `message.content` directly
- `frontend/src/components/messageRow/TranscriptView.tsx` — `ChatMessage` → `Message`
- `frontend/src/components/MessageCitations.tsx` — `Citation` import path → shared
- `frontend/src/components/SceneTab.tsx` — `ChatMessage` → `Message`; `attachmentJson` field references unchanged; any `contentJson` fixture references rename
- `frontend/src/components/ChatTab.tsx` — same
- `frontend/src/hooks/useBannerRetry.ts` — `ChatMessage` → `Message`

**Modified (stories):**
- `frontend/src/components/messageRow/TranscriptView.stories.tsx` — fixtures: `contentJson` → `content`, `ChatMessage` → `Message`
- `frontend/src/components/messageRow/UserMessageRow.stories.tsx` — same
- `frontend/src/components/messageRow/AssistantMessageRow.stories.tsx` — same

**Modified (backend tests):**
- `backend/tests/routes/chat.test.ts` — `contentJson` → `content` in fixtures/assertions
- `backend/tests/routes/chat-messages-list.test.ts` — `contentJson` → `content` in fixtures/assertions + add malformed-row test
- `backend/tests/security/encryption-leak.test.ts` — `contentJsonCiphertext` → `contentCiphertext` in the column scan; rewrite the Message-row sentinel from `contentJson: { parts: [...] }` (object) to `content: 'message-content ${SENTINEL}'` (plain string)
- `backend/tests/repos/message.repo.test.ts` — `contentJson` → `content` in fixtures; drop any JSON-wrap assertions on `content` ciphertext

**Modified (frontend tests):**
- `frontend/tests/hooks/useChat.test.tsx` — `ChatMessage` → `Message`; `contentJson` → `content`; add `messagesResponseSchema.parse(…)` round-trip tests
- `frontend/tests/hooks/useBannerRetry.test.tsx` — `ChatMessage` → `Message`; `contentJson` → `content` in fixtures
- `frontend/tests/components/messageRow/UserMessageRow.test.tsx` — `ChatMessage` → `Message`; `contentJson` → `content`
- `frontend/tests/components/messageRow/AssistantMessageRow.test.tsx` — same
- `frontend/tests/components/messageRow/TranscriptView.test.tsx` — same
- `frontend/tests/components/MessageCitations.test.tsx` — `Citation` import path → shared
- `frontend/tests/components/SceneTab.test.tsx` — any inline `ChatMessage`/`contentJson` fixtures rename

**Verify line (to be applied to bd `--notes` at link-plan time):**

```
verify: npm -w story-editor-shared run build && npm -w story-editor-shared test && \
  npm -w story-editor-backend run typecheck && \
  npm -w story-editor-frontend run typecheck && \
  npm -w story-editor-backend test -- tests/routes/chat tests/repos/message tests/security/encryption-leak && \
  npm -w story-editor-frontend test -- tests/hooks/useChat tests/components/messageRow tests/components/MessageCitations
```

---

## Task 1 — Shared schemas + tests

Add the canonical layer in `story-editor-shared`. No consumers touched yet; this lands cleanly even if no other task runs.

- [ ] **1a.** Create `shared/src/schemas/message.ts` with the schemas from §4 of the spec: `citationSchema`, `messageRoleSchema`, `messageAttachmentSchema`, `messageSchema` (with `content: z.string()`), `messagesResponseSchema`, `sendMessageBodySchema` (with the `superRefine` retry/content guard), `MESSAGE_ENCRYPTED_FIELD_KEYS = ['content', 'attachmentJson', 'citationsJson']`, `MESSAGE_JSON_PAYLOAD_FIELD_KEYS = ['attachmentJson', 'citationsJson']`, all `z.infer<>` type exports.
- [ ] **1b.** Update `shared/src/index.ts` — add re-exports for `Citation`, `Message`, `MessageAttachment`, `MessageRole`, `SendMessageInput`, `MessageEncryptedFieldKey`, `MessageJsonPayloadFieldKey`, the `*Schema` values, and the two `MESSAGE_*_FIELD_KEYS` tuples.
- [ ] **1c.** Create `shared/tests/message.schema.test.ts` mirroring `shared/tests/character.schema.test.ts`:
  - `messageSchema` parses valid row, rejects unknown keys, rejects extra-key citation arrays.
  - `messageAttachmentSchema` rejects unknown keys, requires both `selectionText` + `chapterId` with `min(1)`.
  - `citationSchema` rejects unknown keys; `publishedAt` accepts string or null.
  - `messageRoleSchema` accepts `user|assistant|system`, rejects everything else.
  - `messagesResponseSchema.parse({ messages: [valid] })` round-trips.
  - `sendMessageBodySchema` superRefine: (retry=true, content=present) → fail; (retry=false, content=missing) → fail; (retry=true, content=omitted) → pass; (retry=false, content=present) → pass.
  - `MESSAGE_ENCRYPTED_FIELD_KEYS` exactly `['content', 'attachmentJson', 'citationsJson']`.
  - `MESSAGE_JSON_PAYLOAD_FIELD_KEYS` exactly `['attachmentJson', 'citationsJson']`.
- [ ] **1d.** Verify: `npm -w story-editor-shared run build && npm -w story-editor-shared test`. Build must emit `shared/dist/schemas/message.{js,d.ts}` and re-exports must be present in `shared/dist/index.{js,d.ts}`.

---

## Task 2 — Prisma migration + schema rename

Rename three columns on `Message`. Pre-deployment, no data.

- [ ] **2a.** Edit `backend/prisma/schema.prisma`: in `model Message`, rename `contentJsonCiphertext` → `contentCiphertext`, `contentJsonIv` → `contentIv`, `contentJsonAuthTag` → `contentAuthTag`. Leave `attachmentJson*` and `citationsJson*` untouched.
- [ ] **2b.** Run `cd backend && npx prisma migrate dev --name rename_message_contentjson_to_content --create-only` to generate the migration without applying it.
- [ ] **2c.** Inspect generated SQL at `backend/prisma/migrations/<timestamp>_rename_message_contentjson_to_content/migration.sql`. If Prisma emitted `DROP COLUMN` + `ADD COLUMN`, hand-edit to three `ALTER TABLE "Message" RENAME COLUMN …` statements (per spec §5.0).
- [ ] **2d.** Apply the migration: `cd backend && npx prisma migrate dev` (resumes from `--create-only`) or `npx prisma migrate deploy`.
- [ ] **2e.** Verify: `cd backend && npx prisma validate` exits clean. `npx prisma generate` regenerates the client with renamed columns. `npm -w story-editor-backend run typecheck` will still fail (repo and tests reference old names) — that's the next task. Confirm the migration SQL is `RENAME COLUMN`, not drop-and-add.

---

## Task 3 — Backend repo + serialize helper

Wire the shared types into the repo and finish the type story.

- [ ] **3a.** Edit `backend/src/repos/message.repo.ts`:
  - Replace the existing imports with `import type { Citation, Message, MessageAttachment, MessageRole } from 'story-editor-shared'` and `import { MESSAGE_ENCRYPTED_FIELD_KEYS, MESSAGE_JSON_PAYLOAD_FIELD_KEYS } from 'story-editor-shared'`.
  - Replace `const ENCRYPTED_FIELDS = ['contentJson', 'attachmentJson', 'citationsJson'] as const` with `const ENCRYPTED_FIELDS = MESSAGE_ENCRYPTED_FIELD_KEYS` and add `const JSON_PAYLOAD_FIELDS = MESSAGE_JSON_PAYLOAD_FIELD_KEYS`.
  - Replace `MessageCreateInput` per spec §5.1: `content: string` (renamed + tightened from `contentJson: unknown`), narrative-payload field types from shared.
  - Add `export type RepoMessage = Omit<Message, 'createdAt'> & { createdAt: Date }`.
  - In `create()`:
    - `writeEncrypted(req, 'content', input.content)` (no `serialiseJsonField` wrap).
    - Keep `writeEncrypted(req, 'attachmentJson', serialiseJsonField(input.attachmentJson))` and the same for `citationsJson`.
  - In `shape()`:
    - Keep `projectDecrypted(req, row as Record<string, unknown>, ENCRYPTED_FIELDS)` returning loose `Record<string, unknown>`.
    - Change the JSON-parse loop to iterate `JSON_PAYLOAD_FIELDS` (not `ENCRYPTED_FIELDS`) so `content` skips parsing.
    - At return, cast: `return projected as unknown as RepoMessage`.
- [ ] **3b.** Edit `backend/src/lib/serialize.ts` — add `serializeMessage(row: RepoMessage): Message` per spec §5.4. Mirror `serializeCharacter`.
- [ ] **3c.** Edit `backend/src/lib/venice-citations.ts` — delete the `export interface Citation { … }` block. Do NOT add a re-export. The file's exports become just `projectVeniceCitations`. Update `projectVeniceCitations`'s return type to `Citation[]` imported from `'story-editor-shared'` at the top of the file (or import inline at the type annotation).
- [ ] **3d.** Verify: `npm -w story-editor-backend run typecheck` fails ONLY on route/test references to the old names (`contentJson`, `PostMessageBody`, inline `MessageRole`, etc.) — repo internals should be clean. If the repo itself has type errors, fix before moving on.

---

## Task 4 — Backend routes (chat.routes.ts) + Citation imports

Wire the route layer into the shared schemas; remove dead defensive branches.

- [ ] **4a.** Edit `backend/src/routes/chat.routes.ts`:
  - Top of file: replace `import { type Citation, projectVeniceCitations } from '../lib/venice-citations'` with two imports — `import { projectVeniceCitations } from '../lib/venice-citations'` and `import { type Citation, type Message, type MessageRole, messagesResponseSchema, sendMessageBodySchema } from 'story-editor-shared'`.
  - Delete the inline `type MessageRole = 'user' | 'assistant' | 'system'`.
  - Delete the inline `const PostMessageBody = z.object({ … }).strict().superRefine(…)`. All `PostMessageBody.safeParse(req.body)` calls become `sendMessageBodySchema.safeParse(req.body)`.
  - GET `/api/chats/:chatId/messages` handler — replace the inline `messages = rows.map((m) => ({ id: m.id, role: m.role, ... }))` shape construction with `const messages = rows.map(serializeMessage)` and replace `res.status(200).json({ messages })` with `respond(messagesResponseSchema, res, { messages })`. Import `serializeMessage` from `'../lib/serialize'` and `respond` from `'../lib/respond'` if not already imported.
  - All `messageRepo.create({ ..., contentJson: ... })` calls — rename the key to `content` and drop the `as string` cast where present (the type is now `string` not `unknown`). Specifically: line ~474 (`contentJson: body.content as string` → `content: body.content`) and line ~694 (`contentJson: accumulatedContent` → `content: accumulatedContent`).
  - Lines 402-404 — `trailingUserContent` ternary becomes:
    ```ts
    const trailingUserContent: string = body.retry ? lastUserMsg!.content : (body.content as string);
    ```
  - Lines 440-441 — history mapping's `rawContent` becomes:
    ```ts
    const rawContent = m.content;
    ```
  - GET handler's inline shape (`contentJson: m.contentJson` etc) is now gone (replaced by `serializeMessage`), but if any other site reads `m.contentJson`, rename to `m.content`.
- [ ] **4b.** Edit `backend/src/repos/message.repo.ts` line ~4 — change `import type { Citation } from '../lib/venice-citations'` to `import type { Citation } from 'story-editor-shared'`. (May already be handled by Task 3a's import block — double-check.)
- [ ] **4c.** Verify: `npm -w story-editor-backend run typecheck` clean. The repo and routes should both compile. Backend tests still fail (Task 5).

---

## Task 5 — Backend tests

Update fixtures, assertions, and the encryption-leak sentinel.

- [ ] **5a.** `backend/tests/routes/chat.test.ts` — every `contentJson` reference renames to `content`. Verified locations from earlier grep: line ~310 (`expect(assistants[0].contentJson).toBe('Retry reply.')`), ~415 (`expect(assistants[0].contentJson).toBe('second reply')`), ~501 (`messageRepo.create({ chatId, role: 'user', contentJson: 'hello' })`), ~527 (`after.body.messages[1].contentJson`).
- [ ] **5b.** `backend/tests/routes/chat-messages-list.test.ts` — every `contentJson` reference renames to `content`. Comments around lines 8-9 update from "decrypted contentJson / attachmentJson" to "decrypted content / attachmentJson". Fixtures at ~100, ~111, ~124 rename.
- [ ] **5c.** Add a malformed-row test to `chat-messages-list.test.ts`: stub `createMessageRepo` so `findManyForChat` returns a row with a stray key (e.g. `{ id, role, content, attachmentJson, citationsJson, model, tokens, latencyMs, createdAt, _extra: 'foo' }`). Assert the response is a 500 with the `ZodError` validation message visible. Mirrors the egress-validation test from PR #100's `characters.test.ts`.
- [ ] **5d.** `backend/tests/security/encryption-leak.test.ts`:
  - Line ~131 — change the Message fixture from `contentJson: { parts: [\`message-content ${SENTINEL}\`] }` to `content: \`message-content ${SENTINEL}\``.
  - Confirm the column-scan logic resolves `contentCiphertext` correctly (it likely walks Prisma's DMMF; verify it doesn't have a hardcoded `contentJsonCiphertext` literal anywhere). If hardcoded, rename to `contentCiphertext`.
- [ ] **5e.** `backend/tests/repos/message.repo.test.ts` — every `contentJson` reference renames to `content`. If any test inspects ciphertext storage shape or asserts a JSON-wrapped round-trip on `content`, update to plain-string contract. Tests on `attachmentJson` / `citationsJson` JSON round-trips unchanged.
- [ ] **5f.** Verify: `npm -w story-editor-backend test -- tests/routes/chat tests/repos/message tests/security/encryption-leak` all pass.

---

## Task 6 — Frontend lib layer (hook, citations, sse, api, streamingAI)

Wire the shared schemas through the frontend's library layer before touching components.

- [ ] **6a.** Edit `frontend/src/hooks/useChat.ts`:
  - Delete the `ChatRole`, `ChatMessageAttachment`, `ChatMessage` interface exports (lines ~36–60).
  - Delete the `ChatMessagesResponse` interface (line ~73).
  - Delete the `export type { Citation }` re-export line and the `export { isCitationArray }` re-export line. Delete the `import { type Citation, isCitationArray } from '@/lib/citations'` line.
  - Add `import { type Message, messagesResponseSchema } from 'story-editor-shared'`.
  - In `useChatMessagesQuery`, wrap the fetch response:
    ```ts
    queryFn: async (): Promise<Message[]> => {
      const res = await api<unknown>(`/chats/${encodeURIComponent(chatId ?? '')}/messages`);
      return messagesResponseSchema.parse(res).messages;
    },
    ```
  - Type the hook's return as `UseQueryResult<Message[], Error>`.
  - `ChatSummary` derived type stays.
- [ ] **6b.** DELETE `frontend/src/lib/citations.ts` (the entire file).
- [ ] **6c.** Edit `frontend/src/lib/sse.ts`:
  - Change `import { type Citation, isCitationArray } from '@/lib/citations'` to `import { type Citation, citationSchema } from 'story-editor-shared'`.
  - Replace the four `isCitationArray(x)` call sites (twice in `parseCitationsFrame`, twice in `recoverCitationsFromTerminator`) with `citationSchema.array().safeParse(x).success`. Where the original used `isCitationArray(x) ? x : ...`, switch to `citationSchema.array().safeParse(x).success ? (x as Citation[]) : ...`.
- [ ] **6d.** Edit `frontend/src/lib/streamingAI.ts` line ~2 — `import type { Citation } from '@/lib/citations'` → `import type { Citation } from 'story-editor-shared'`.
- [ ] **6e.** Edit `frontend/src/lib/api.ts` — DELETE `export interface MessageRow { … }` and `export async function listMessagesForChat(…)`. Confirmed dead via grep.
- [ ] **6f.** Verify: `npm -w story-editor-frontend run typecheck` still fails on component imports, but the lib layer is clean. If lib/hook errors persist, fix before moving on.

---

## Task 7 — Frontend components, stories, tests + `getMessageText` removal

The mechanical-but-large step. Rip-and-replace at every component and test import site.

- [ ] **7a.** Edit `frontend/src/components/messageRow/utils.ts` — DELETE `getMessageText`. If the file has no other exports, delete the file. If other exports exist, keep them.
- [ ] **7b.** Component renames — for each file below, change `import { type ChatMessage } from '@/hooks/useChat'` → `import { type Message } from 'story-editor-shared'` and rename every `ChatMessage` occurrence to `Message`:
  - `frontend/src/components/messageRow/UserMessageRow.tsx` — also replace `getMessageText(message.contentJson)` with `message.content`; rename `message.attachmentJson` reads unchanged (still `attachmentJson` per spec — only `contentJson` renamed).
  - `frontend/src/components/messageRow/AssistantMessageRow.tsx` — same treatment.
  - `frontend/src/components/messageRow/TranscriptView.tsx` — rename only (no `getMessageText` call here per earlier grep).
  - `frontend/src/components/messageRow/primitives.tsx` — `Citation` import from `@/lib/citations` → `story-editor-shared`.
  - `frontend/src/components/MessageCitations.tsx` — `Citation` import from `@/hooks/useChat` → `story-editor-shared`.
  - `frontend/src/components/SceneTab.tsx` — `ChatMessage` import → `Message`; any `r.message.contentJson` reads → `r.message.content`; `attachmentJson: r.attachment` fixtures unchanged (still the field name).
  - `frontend/src/components/ChatTab.tsx` — same as SceneTab.
  - `frontend/src/components/ChatComposer.tsx` — only if it has a `ChatMessage` import (verify with `grep -n 'ChatMessage\|contentJson' frontend/src/components/ChatComposer.tsx`).
  - `frontend/src/components/ChatPanel.tsx` — same conditional check.
  - `frontend/src/hooks/useBannerRetry.ts` — `ChatMessage` import → `Message`; any `contentJson` reads → `content`.
- [ ] **7c.** Story fixtures — for each `*.stories.tsx`, rename `ChatMessage` → `Message` in imports and inline types, and `contentJson` → `content` in fixture objects:
  - `frontend/src/components/messageRow/TranscriptView.stories.tsx`
  - `frontend/src/components/messageRow/UserMessageRow.stories.tsx`
  - `frontend/src/components/messageRow/AssistantMessageRow.stories.tsx`
- [ ] **7d.** Frontend tests — rename in each:
  - `frontend/tests/hooks/useChat.test.tsx` — rename `ChatMessage` → `Message`, `contentJson` → `content`. Add new tests: (i) `messagesResponseSchema.parse(…)` round-trips a well-formed `{messages: [valid]}` response; (ii) the hook's `queryFn` throws on a malformed response (e.g. extra key, missing field). Mirror `useCharacters.test.tsx`'s validation tests from PR #100.
  - `frontend/tests/hooks/useBannerRetry.test.tsx` — rename `ChatMessage` → `Message`, `contentJson` → `content` in fixtures.
  - `frontend/tests/components/messageRow/UserMessageRow.test.tsx` — rename, including any `getMessageText`-related test (the function is gone; tests that asserted its behaviour are deleted, replaced with direct `message.content` assertions if needed).
  - `frontend/tests/components/messageRow/AssistantMessageRow.test.tsx` — same.
  - `frontend/tests/components/messageRow/TranscriptView.test.tsx` — same.
  - `frontend/tests/components/MessageCitations.test.tsx` — `Citation` import → shared.
  - `frontend/tests/components/SceneTab.test.tsx` — any inline `ChatMessage`/`contentJson` fixtures rename.
- [ ] **7e.** Verify: `npm -w story-editor-frontend run typecheck` clean. Grep for stragglers: `grep -rn 'ChatMessage\|contentJson\|ChatMessageAttachment\|ChatRole\|getMessageText\|@/lib/citations' frontend/src frontend/tests` should return zero hits (except possibly comments / dead imports; investigate any survivors).

---

## Task 8 — Full verify

Run the full verify line and address any residual failures.

- [ ] **8a.** Run the verify line exactly:
  ```
  npm -w story-editor-shared run build && npm -w story-editor-shared test && \
    npm -w story-editor-backend run typecheck && \
    npm -w story-editor-frontend run typecheck && \
    npm -w story-editor-backend test -- tests/routes/chat tests/repos/message tests/security/encryption-leak && \
    npm -w story-editor-frontend test -- tests/hooks/useChat tests/components/messageRow tests/components/MessageCitations
  ```
- [ ] **8b.** Manual smoke (in `make dev` stack): create a chat with an attached selection, send a turn, verify the assistant reply renders. Confirm the user message's `FROM CH. {title}` attachment block still appears (proves `attachmentJson` round-trip is unchanged). Confirm a chat that opted into web search still surfaces citations (proves `citationsJson` round-trip is unchanged).
- [ ] **8c.** Inspect DB column names directly: `docker compose exec postgres psql -U postgres -d storyeditor -c "\d \"Message\""` — confirm `contentCiphertext`, `contentIv`, `contentAuthTag` exist and no `contentJson*` columns remain. The other two ciphertext triples (`attachmentJson*`, `citationsJson*`) should be untouched.
- [ ] **8d.** `/bd-close-reviewed story-editor-j76` — runs typecheck on affected workspaces, fans `repo-boundary-reviewer` (and `security-reviewer` if AU/E surface is touched, which this isn't). Fix any `BLOCK` / `FIX_BEFORE_MERGE` findings before close.

---

## Rollback

- **Schema rollback:** Prisma migration is reversible by running the inverse `RENAME COLUMN` SQL. Since pre-deployment with no data, the more honest rollback is `prisma migrate reset` + restore the prior schema. Plain branch-revert is the standard path.
- **Code rollback:** Branch-revert. No external state to undo.
- **Partial-state safety:** Tasks 1, 6f, 7e, 8a are typecheck gates — if those fail, the implementer fixes before proceeding. Tasks 2–5 modify backend-only; tasks 6–7 modify frontend-only. If the implementer pauses after Task 5, the backend is in a half-migrated state where backend tests pass but the frontend is broken (typecheck fails). This is fine in-branch; only `git push` exposes it and the verify-line gate prevents that.

---

## Out-of-scope reminders (do not expand)

- No change to `attachmentJson` / `citationsJson` column shape or repo encoding.
- No change to SSE protocol or `projectVeniceCitations` behaviour.
- No `messageUpdateSchema` / `messageReorderSchema` (Message is append-only).
- No `projectDecrypted` generic-typing refactor (separate task across all repos).
- No re-export aliases or transitional `ChatMessage = Message` shims — rip-and-replace only.
