# Message Entity Consolidation — Design

**Date:** 2026-05-12
**Author:** Claude (working session with @DoctorKomodo)
**bd issue:** `story-editor-j76` — Migrate Message Zod schemas to story-editor-shared
**Pattern source:** PR #100 (Character entity consolidation) — `docs/superpowers/specs/2026-05-11-character-entity-consolidation-design.md`

---

## 1. Problem

`Message` is currently defined by **four hand-rolled shapes** plus a **duplicated `Citation` type**, with no single source of truth between Prisma, the repo, the route schemas, the frontend hook, and the frontend components that consume the hook.

### Drift inventory

| # | Location | Symbol | Status |
|---|---|---|---|
| 1 | `frontend/src/hooks/useChat.ts` | `ChatMessage`, `ChatMessageAttachment`, `ChatRole` | live wire shape |
| 2 | `frontend/src/lib/api.ts` | `MessageRow`, `listMessagesForChat` | **dead code** (zero consumers) |
| 3 | `backend/src/repos/message.repo.ts` | `MessageCreateInput` | repo-internal seam |
| 4 | `backend/src/routes/chat.routes.ts` | inline `PostMessageBody` Zod | wire POST body |
|   | `backend/src/routes/chat.routes.ts` | inline `type MessageRole` | duplicates frontend `ChatRole` |
|   | `backend/src/lib/venice-citations.ts` | `Citation` interface | duplicates `frontend/src/lib/citations.ts` |
|   | `frontend/src/lib/citations.ts` | `Citation`, `isCitationArray` | duplicate type + hand-rolled guard |

The same drift Character had before PR #100. Same fix: one canonical schema in `story-editor-shared`, `z.infer<>` types, egress validation in dev/test, rip-and-replace all hand-rolled definitions in the same PR.

## 2. Goal

After this work lands:

- `story-editor-shared` is the **only** definition of Message's wire shape, role union, attachment shape, citation shape, and POST body shape.
- All four hand-rolled definitions above are deleted or replaced by imports/`z.infer<>` aliases.
- The Message GET endpoint passes through `respond(messagesResponseSchema, …)` for egress validation in dev/test.
- The frontend `useChat` hook runtime-validates every fetched message via `messagesResponseSchema.parse(…)`, matching `useCharacters`.
- Adding or removing a Message field (especially an encrypted one) propagates from one tuple (`MESSAGE_ENCRYPTED_FIELD_KEYS`) and one schema (`messageSchema`) instead of N parallel definitions.
- **The `contentJson` field is renamed to `content`** end-to-end — Prisma columns, wire schema, repo input, frontend hook, components, tests. The `Json` suffix was a legacy from when chat content was expected to be TipTap JSON; it has always stored a plain string. The rename also drops the misleading `JSON.stringify("hello") → "\"hello\""` round-trip in the repo for this field specifically (the other two stay).

Non-goals: SSE protocol change, any change to `projectVeniceCitations` adapter logic, any change to `attachmentJson` / `citationsJson` storage shape (those remain JSON-payload ciphertext triples).

## 3. Constraints

- **Append-only entity.** No PATCH, no DELETE of individual messages, no reorder. So: no `messageUpdateSchema`, no `messageReorderSchema`. (`Chat.delete` cascades, and the repo's `deleteAllAfter` is an internal retry-flow helper, not a wire surface.)
- **Two distinct ciphertext payload shapes.** `content` is a plain encrypted string (no JSON round-trip). `attachmentJson` and `citationsJson` are JSON payloads serialised before encryption and `JSON.parse`d after decryption. The repo's `ENCRYPTED_FIELDS` tuple drives both encrypt and decrypt; a separate `JSON_PAYLOAD_FIELDS` subset drives the JSON-parse loop in `shape()`.
- **SSE bypasses `respond()`.** The POST handler streams `event: …\ndata: …` frames; egress validation only applies to the GET handler.
- **Citation is wire-adjacent — it's a field on Message.** Consolidating Message into shared *requires* a citation schema in shared, so `Citation` moves too in the same PR.
- **Pre-deployment, no data migration branches.** The Prisma column rename for `content` is a structural rename only. The ciphertext-format change (no JSON wrap) is safe because no rows exist; post-deployment this would be a true data migration, which is out of scope and not needed.

## 4. Canonical schemas (shared/src/schemas/message.ts)

```ts
import { z } from 'zod';

export const citationSchema = z.strictObject({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  publishedAt: z.string().nullable(),
});

export const messageRoleSchema = z.enum(['user', 'assistant', 'system']);

export const messageAttachmentSchema = z.strictObject({
  selectionText: z.string().min(1),
  chapterId: z.string().min(1),
});

// Wire/read shape. `content` is `z.string()` — every write site stores a
// string today (body.content, accumulatedContent). Renamed from the legacy
// `contentJson` (the Json suffix was inherited from an earlier design that
// never materialised). The other two ciphertext fields keep their *Json
// names because they actually carry JSON payloads.
export const messageSchema = z.strictObject({
  id: z.string().min(1),
  role: messageRoleSchema,
  content: z.string(),
  attachmentJson: messageAttachmentSchema.nullable(),
  citationsJson: z.array(citationSchema).nullable(),
  model: z.string().nullable(),
  tokens: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});

export const messagesResponseSchema = z.strictObject({
  messages: z.array(messageSchema),
});

// Wire POST body: POST /api/chats/:chatId/messages.
// Replaces the inline `PostMessageBody` in chat.routes.ts byte-for-byte.
export const sendMessageBodySchema = z
  .strictObject({
    content: z.string().min(1).optional(),
    modelId: z.string().min(1),
    retry: z.boolean().optional(),
    attachment: messageAttachmentSchema.optional(),
    enableWebSearch: z.boolean().optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.retry && !body.content) {
      ctx.addIssue({
        code: 'custom',
        message: 'content is required unless retry is true',
        path: ['content'],
      });
    }
    if (body.retry && body.content !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'content must be omitted when retry is true',
        path: ['content'],
      });
    }
  });

// Single source of truth for which Message fields are encrypted at rest.
// Imported by backend/src/repos/message.repo.ts as ENCRYPTED_FIELDS.
// Mirrors the NARRATIVE_FIELD_KEYS pattern from character.ts: adding an
// encrypted field here propagates to the repo's write+read paths.
export const MESSAGE_ENCRYPTED_FIELD_KEYS = [
  'content',
  'attachmentJson',
  'citationsJson',
] as const;

// Subset of encrypted fields whose decrypted plaintext is itself JSON
// (object or array) — these get the JSON.stringify-before-encrypt /
// JSON.parse-after-decrypt round-trip in the repo. `content` is excluded
// because it's a plain string; serialising it would re-introduce the
// `"\"hello\""` storage jank the rename eliminates.
export const MESSAGE_JSON_PAYLOAD_FIELD_KEYS = [
  'attachmentJson',
  'citationsJson',
] as const;

export type Message = z.infer<typeof messageSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageBodySchema>;
export type MessageEncryptedFieldKey = (typeof MESSAGE_ENCRYPTED_FIELD_KEYS)[number];
export type MessageJsonPayloadFieldKey = (typeof MESSAGE_JSON_PAYLOAD_FIELD_KEYS)[number];
```

**Why no `messageCreateSchema`:** Character's create schema mirrored the wire `POST /api/stories/:storyId/characters` body. For Message, the equivalent wire-create body is `sendMessageBodySchema` — a higher-level "send a turn" request that orchestrates Venice + persistence, not a CRUD create. The repo's `MessageCreateInput` (a different, internal shape) stays in `message.repo.ts`.

**`shared/src/index.ts`** adds re-exports for every symbol above, matching the alphabetical-ish layout already established for Character.

## 5. Backend changes

### 5.0 Prisma + migration

The Message model's three `contentJson*` ciphertext columns are renamed:

```prisma
// backend/prisma/schema.prisma — model Message
- contentJsonCiphertext    String?
- contentJsonIv            String?
- contentJsonAuthTag       String?
+ contentCiphertext        String?
+ contentIv                String?
+ contentAuthTag           String?
```

`attachmentJson*` and `citationsJson*` triples are unchanged.

A new migration `<timestamp>_rename_message_contentjson_to_content` performs the rename:

```sql
ALTER TABLE "Message" RENAME COLUMN "contentJsonCiphertext" TO "contentCiphertext";
ALTER TABLE "Message" RENAME COLUMN "contentJsonIv"         TO "contentIv";
ALTER TABLE "Message" RENAME COLUMN "contentJsonAuthTag"    TO "contentAuthTag";
```

`RENAME COLUMN` rather than drop-and-add — there's no data to migrate (pre-deployment per CLAUDE.md's no-data-migration-branches rule), but `RENAME` keeps the migration semantically a rename rather than a destructive replacement. Generated via `npx prisma migrate dev --name rename_message_contentjson_to_content`; the generated SQL should be inspected to confirm it emits `RENAME COLUMN` (Prisma usually does for model-field renames when no type change is involved; if it emits drop-and-add, hand-edit to `RENAME COLUMN` before applying).

The ciphertext-format change (no JSON wrap for `content` going forward) does **not** require a separate migration — it's a code-level change in how the repo serialises before writing.

### 5.1 `backend/src/repos/message.repo.ts`

```ts
import type {
  Citation,
  Message,
  MessageAttachment,
  MessageRole,
} from 'story-editor-shared';
import {
  MESSAGE_ENCRYPTED_FIELD_KEYS,
  MESSAGE_JSON_PAYLOAD_FIELD_KEYS,
} from 'story-editor-shared';

// All three encrypted fields go through writeEncrypted / projectDecrypted.
const ENCRYPTED_FIELDS = MESSAGE_ENCRYPTED_FIELD_KEYS;

// Only these two get the JSON.stringify-before-encrypt / JSON.parse-after-
// decrypt round-trip — `content` is a plain string.
const JSON_PAYLOAD_FIELDS = MESSAGE_JSON_PAYLOAD_FIELD_KEYS;

// Repo-shape: narrative payloads are plaintext (post-decrypt + post-JSON-parse
// for the two JSON-payload fields). createdAt is a Date (Prisma raw). Mirrors
// RepoCharacter. Message has no updatedAt.
export type RepoMessage = Omit<Message, 'createdAt'> & { createdAt: Date };

// Repo-internal create input. Narrative-payload types come from the canonical
// shared types. `content` is the renamed-and-tightened replacement for the
// legacy `contentJson: unknown`.
export interface MessageCreateInput {
  chatId: string;
  role: MessageRole;
  content: string;
  attachmentJson?: MessageAttachment | null;
  citationsJson?: Citation[] | null;
  model?: string | null;
  tokens?: number | null;
  latencyMs?: number | null;
}
```

Write path:
- `writeEncrypted(req, 'content', input.content)` — passes the plain string directly. No `serialiseJsonField` wrap.
- `writeEncrypted(req, 'attachmentJson', serialiseJsonField(input.attachmentJson))` and the same for `citationsJson` — unchanged behaviour, just typed inputs.

Read path (`shape()` helper):
- `projectDecrypted(req, row, ENCRYPTED_FIELDS)` returns `Record<string, unknown>` with `content` already as a plaintext string and `attachmentJson` / `citationsJson` as plaintext *strings* (the JSON-serialised form).
- Iterate `JSON_PAYLOAD_FIELDS` only (not `ENCRYPTED_FIELDS`) and `JSON.parse` each non-empty value in-place.
- Final `as unknown as RepoMessage` cast at the end of `shape()` — same placement reasoning as before: Message's two JSON-payload fields only reach their typed shape after the parse loop, so the cast cannot live at the `projectDecrypted` call.

**The cast point differs from Character:** Character's encrypted fields are plain strings, so `projectDecrypted<RepoCharacter>(…)` is shape-correct at the projection call. Message has both kinds — `content` is plain-string (shape-correct after projection) and `attachmentJson` / `citationsJson` are still serialised JSON at that point. The end-of-`shape()` cast resolves both in one place. Equivalent rigour, different placement, dictated by the heterogeneous payload mix.

### 5.2 `backend/src/routes/chat.routes.ts`

- Replace inline `const PostMessageBody = z.object({…}).superRefine(…)` with `import { sendMessageBodySchema } from 'story-editor-shared'`.
- Replace inline `type MessageRole = 'user' | 'assistant' | 'system'` with `import { type MessageRole } from 'story-editor-shared'`.
- `GET /api/chats/:chatId/messages` — wrap the response in a new `serializeMessage(row: RepoMessage)` helper, then `respond(messagesResponseSchema, res, { messages }, 200)`. The inline shape-construction at lines 265–277 becomes one `.map(serializeMessage)` call.
- POST handler stream path is unchanged structurally (still SSE), but its calls into `messageRepo.create(…)` type-check against the canonical `MessageCreateInput` whose field types now derive from shared.
- **Remove the now-unreachable defensive branches in the same PR.** Renaming to `content: string` (both on the wire and in `MessageCreateInput`) means `m.content` is provably a string at every read site. The legacy `typeof … === 'string' ? … : JSON.stringify(...)` fallbacks become dead code. Drop them at:
  - **`chat.routes.ts:402-404`** — `trailingUserContent` becomes `const trailingUserContent: string = body.retry ? lastUserMsg!.content : (body.content as string);`.
  - **`chat.routes.ts:440-441`** — history mapping's `rawContent` becomes `const rawContent = m.content;` (already typed `string` once `RepoMessage.content: string` flows through `findManyForChat`).

  Leaving these branches would mean the runtime continues defending against a state the schema declares impossible — exactly the drift this work targets.

### 5.3 `backend/src/lib/venice-citations.ts` and backend `Citation` imports

Rip-and-replace, matching the frontend stance (no transitional re-exports anywhere):

- **`venice-citations.ts`**: delete the `export interface Citation { … }` entirely. Do **not** add a re-export. The file's exported surface becomes just `projectVeniceCitations` (the wire-adapter function), which is its single responsibility.
- **`backend/src/routes/chat.routes.ts:18`**: change `import { type Citation, projectVeniceCitations } from '../lib/venice-citations'` to two separate imports — `type Citation` from `'story-editor-shared'`, `projectVeniceCitations` from `'../lib/venice-citations'`.
- **`backend/src/repos/message.repo.ts:4`**: change `import type { Citation } from '../lib/venice-citations'` to `import type { Citation } from 'story-editor-shared'`.
- `projectVeniceCitations` returns `Citation[]` typed from the shared `citationSchema` — no behaviour change, just one source of truth for the return type.

### 5.4 `backend/src/lib/serialize.ts`

Add a `serializeMessage(row: RepoMessage): Message` next to `serializeCharacter`:

```ts
export function serializeMessage(row: RepoMessage): Message {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}
```

## 6. Frontend changes (rip-and-replace, no transitional aliases)

### 6.1 `frontend/src/hooks/useChat.ts`

- Delete `ChatMessage`, `ChatMessageAttachment`, `ChatRole` interfaces.
- Delete the `Citation` re-export (the file's `export type { Citation }` line) and the `isCitationArray` re-export — call sites switch to importing from shared directly.
- `useChatMessagesQuery` wraps its fetch response in `messagesResponseSchema.parse(res)` before returning. Matches `useCharacters` runtime validation.
- The hook keeps its query-key helpers (`chatMessagesQueryKey`, `chatsBaseQueryKey`, `chatsQueryKey`) and its `ChatSummary` derived type (those are TanStack-Query orchestration, not wire shape).

### 6.1a `frontend/src/components/messageRow/utils.ts` — drop `getMessageText`

```ts
// existing — defensive coercion for `unknown` content:
export function getMessageText(contentJson: unknown): string {
  if (typeof contentJson === 'string') return contentJson;
  if (contentJson === null || contentJson === undefined) return '';
  try { return JSON.stringify(contentJson); } catch { return ''; }
}
```

After the rename, `Message.content: string` — callers just read `message.content` directly. Delete `getMessageText` and its file (or just the function if `utils.ts` has other exports). Update its two call sites (`UserMessageRow.tsx`, `AssistantMessageRow.tsx`) to read the field directly. This is the function-level analog of the dead-defensive-branch cleanup from §5.2.

### 6.2 `frontend/src/lib/api.ts`

Delete:

- `export interface MessageRow { … }`
- `export async function listMessagesForChat(…)`

Both are dead — no consumers in `frontend/src/` or `frontend/tests/`. Confirmed via `grep -rn "listMessagesForChat\|\\bMessageRow\\b" frontend/{src,tests}` — the only hits are the definitions themselves.

### 6.3 `frontend/src/lib/citations.ts`

Delete the file. The two exports it provided:

- `Citation` → re-exported from `story-editor-shared` (callers update their imports).
- `isCitationArray(value)` → replaced by `citationSchema.array().safeParse(value).success` at the four call sites that still need a runtime guard (all in `frontend/src/lib/sse.ts` — used twice by `parseCitationsFrame` and twice by `recoverCitationsFromTerminator`). The `useChat.ts` `export { isCitationArray }` re-export line is deleted; no `MessageCitations` call site (it consumes already-validated `Citation[]` from the hook).
- **Strictness change is intentional.** `citationSchema` uses `z.strictObject`, so the new guard rejects citation objects with keys beyond `{title, url, snippet, publishedAt}`. The hand-rolled `isCitationArray` accepted unknown keys. This change is safe today because `projectVeniceCitations` (server-side, runs before SSE emission) drops every key outside the canonical four — so the wire frames the client guard inspects are already in the 4-key shape. If a future producer adds a 5th field without updating the schema, the guard treats the frame as malformed and the existing `recoverCitationsFromTerminator` fallback in `sse.ts` picks it up. We do **not** add a second loose schema for the guard — uniformity beats hedging against a hypothetical that the wire-adapter actively prevents.

### 6.4 Component / hook / test / story import-site updates

Every file below changes `import { type ChatMessage } from '@/hooks/useChat'` → `import { type Message } from 'story-editor-shared'` (plus the symbol rename `ChatMessage` → `Message` and `ChatRole` → `MessageRole`):

Full enumerated set (verified via `grep -rn "from '@/lib/citations'\|from '@/hooks/useChat'" frontend/{src,tests}`):

**Source files importing from `@/hooks/useChat` (`ChatMessage` / `ChatRole` / `ChatMessageAttachment` / `Citation` re-export):**

- `frontend/src/components/SceneTab.tsx`
- `frontend/src/components/ChatTab.tsx`
- `frontend/src/components/ChatComposer.tsx` *(only if it types message props)*
- `frontend/src/components/ChatPanel.tsx` *(only if it types message props)*
- `frontend/src/components/MessageCitations.tsx` (imports `Citation` via the `useChat` re-export — switches to `story-editor-shared` direct)
- `frontend/src/components/messageRow/TranscriptView.tsx`
- `frontend/src/components/messageRow/UserMessageRow.tsx`
- `frontend/src/components/messageRow/AssistantMessageRow.tsx`
- `frontend/src/hooks/useBannerRetry.ts`

**Source files importing from `@/lib/citations`:**

- `frontend/src/lib/sse.ts` — `type Citation` + `isCitationArray`. Switches `Citation` import to `story-editor-shared` and replaces the four `isCitationArray(…)` call sites with `citationSchema.array().safeParse(…).success`.
- `frontend/src/lib/streamingAI.ts` — `type Citation`. Switches to `story-editor-shared`.
- `frontend/src/components/messageRow/primitives.tsx` — `type Citation`. Switches to `story-editor-shared`.

**Tests:**

- `frontend/tests/hooks/useChat.test.tsx` — `ChatMessage` references rename + add `messagesResponseSchema.parse(…)` round-trip tests.
- `frontend/tests/hooks/useBannerRetry.test.tsx` — `ChatMessage` rename.
- `frontend/tests/components/SceneTab.test.tsx` — already imports only `chatMessagesQueryKey`/`chatsQueryKey` from `useChat` (no shape rename needed), but any inline `ChatMessage`-shaped fixtures rename.
- `frontend/tests/components/messageRow/TranscriptView.test.tsx` — `ChatMessage` rename.
- `frontend/tests/components/messageRow/UserMessageRow.test.tsx` — `ChatMessage` rename.
- `frontend/tests/components/messageRow/AssistantMessageRow.test.tsx` — `ChatMessage` rename.
- `frontend/tests/components/MessageCitations.test.tsx` — `Citation` import path switches.

**Stories:**

- `frontend/src/components/messageRow/TranscriptView.stories.tsx`
- `frontend/src/components/messageRow/UserMessageRow.stories.tsx`
- `frontend/src/components/messageRow/AssistantMessageRow.stories.tsx`

The implementer pass should re-run the grep above as a sanity check and rely on the verify-line typecheck (both `npm -w story-editor-frontend run typecheck` and `npm -w story-editor-backend run typecheck`) as the final safety net.

## 7. Tests

### 7.1 New: `shared/tests/message.schema.test.ts`

Mirroring `shared/tests/character.schema.test.ts`:

- `messageSchema` parses a well-formed message; rejects unknown keys.
- `messageAttachmentSchema` rejects unknown keys; requires both `selectionText` and `chapterId` with `min(1)`.
- `citationSchema` rejects unknown keys; `publishedAt` accepts both string and null.
- `messageRoleSchema` accepts `user|assistant|system`; rejects everything else.
- `messagesResponseSchema.parse({ messages: [valid, valid] })` round-trips.
- `sendMessageBodySchema` superRefine cases: retry=true + content present → fail; retry=false + content missing → fail; retry=true + content omitted → pass; retry=false + content present → pass.
- `MESSAGE_ENCRYPTED_FIELD_KEYS` is exactly `['content', 'attachmentJson', 'citationsJson']`.
- `MESSAGE_JSON_PAYLOAD_FIELD_KEYS` is exactly `['attachmentJson', 'citationsJson']` (no `content`).

### 7.2 Updated: `backend/tests/routes/chat-messages-list.test.ts`

- Existing happy-path stays, with `contentJson` → `content` in fixtures and assertions.
- Add: a malformed-row test (e.g. via repo stub returning a row with a stray key) confirms `respond()` throws `ZodError` in test mode, producing a 500 with the validation message visible.

### 7.3 Updated: `backend/tests/routes/chat.test.ts`

- `PostMessageBody` references in test text/fixtures swap to `sendMessageBodySchema`.
- Existing `contentJson` references in fixtures and assertions rename to `content` (lines around 310, 415, 501, 527 per `grep -n contentJson backend/tests/routes/chat.test.ts`).
- Behaviour assertions (retry+content combinations, attachment shape, enableWebSearch flag) stay the same.

### 7.4 Updated: `backend/tests/routes/chat-messages-list.test.ts` — `contentJson` → `content`

Lines around 8-9 (comment), 100, 111, 124 per the existing grep. All `contentJson` references in fixtures and assertions rename. The "decrypted contentJson / attachmentJson" comment becomes "decrypted content / attachmentJson".

### 7.5 Updated: `backend/tests/security/encryption-leak.test.ts`

- The Message fixture at `encryption-leak.test.ts:131` currently uses an object sentinel: `contentJson: { parts: [\`message-content ${SENTINEL}\`] }`. After the rename + JSON-wrap drop, this becomes `content: \`message-content ${SENTINEL}\`` (plain string; the sentinel embeds directly).
- The column scan logic needs to switch `contentJsonCiphertext` → `contentCiphertext`. Verify by reading the test's column-iteration code — it likely walks Prisma's `dmmf` or has a hardcoded list per model.

### 7.6 Updated: `backend/tests/repos/message.repo.test.ts`

- Any test that asserts on the JSON-wrapped storage of `content` (e.g. inspecting raw ciphertext or asserting a JSON-string round-trip) updates to the plain-string contract.
- `MessageCreateInput.contentJson` → `.content` at every fixture.
- Transaction shape, ownership chain assertions unchanged.

### 7.6 Verify line (replaces the one in bd `--notes`)

```
verify: npm -w story-editor-shared run build && npm -w story-editor-shared test && \
  npm -w story-editor-backend run typecheck && \
  npm -w story-editor-frontend run typecheck && \
  npm -w story-editor-backend test -- tests/routes/chat tests/repos/message tests/security/encryption-leak && \
  npm -w story-editor-frontend test -- tests/hooks/useChat
```

The bd-update step (`bash scripts/bd-link-plan.sh story-editor-j76 <plan>`) at link-plan time will also rewrite this verify line.

## 8. Out-of-scope (intentional)

- **`attachmentJson` / `citationsJson` storage shape** — both stay as JSON-payload ciphertext triples. The chain-of-cascades (Chapter → Chat → Message) closes the referential-integrity gap that would have motivated splitting `attachmentJson` into two columns; the citation list is variable-length and benefits from a single ciphertext triple over a per-row Citation table.
- **SSE protocol** — citation frames, content chunks, `[DONE]` sentinel all unchanged.
- **`projectVeniceCitations`** — wire-adapter logic; stays in `backend/src/lib/venice-citations.ts` as that file's sole export.
- **`projectDecrypted`'s return type** — PR #100 flagged this as a tightening opportunity (`Record<string, unknown>` → generic-typed). That's repo-layer plumbing affecting every entity; if we tighten it, it's a separate task across all repos, not a Message-only change. The Message migration uses the same `as unknown as` cast pattern Character does until that's done.

## 9. Risks

- **Rip-and-replace surface area.** ~15 frontend files plus tests, plus the Prisma migration. Mitigated by: typecheck-gated verify line on both workspaces; PR #100 already established the exact import substitution at every site; the change is mechanical (rename `ChatMessage` → `Message`, `contentJson` → `content`, swap import path).
- **Prisma column rename emitted as drop-and-add.** If `prisma migrate dev` generates `DROP COLUMN` + `ADD COLUMN` instead of `RENAME COLUMN`, that's a destructive op (silent in pre-deployment since no data exists, but the wrong shape semantically). Mitigation: inspect the generated SQL before applying; hand-edit to `RENAME COLUMN` if needed. Pre-deployment safety net: no rows would be lost anyway.
- **Ciphertext format change for `content`.** Existing rows (if any existed) would no longer round-trip — the repo would `JSON.parse` a bare string `"hello"` and throw. Mitigation: pre-deployment, no rows exist. The `JSON.parse` is removed from the read path for `content` in the same change (split `JSON_PAYLOAD_FIELDS` tuple).
- **Tightening `content` to `string`.** Any production write path that stored an object would now fail egress validation in dev/test before reaching the DB-side ciphertext columns. Mitigation: confirmed via grep that all three write sites in `chat.routes.ts` stringify before persisting. Net effect is the wire contract matches reality.
- **Citation type move.** Two backend callers, three frontend callers, all enumerated in §5.3 / §6.4. Verify-line typecheck catches anything missed.
- **`getMessageText` removal.** The defensive coercion stops existing. Any call site that relied on its null/undefined/object fallback now reads `message.content` directly. Since `Message.content` is a non-nullable `z.string()`, the fallback paths are unreachable — but if a non-message-shaped object accidentally typed as `Message` would have hit the fallback before, it'll now show `undefined` in the UI. Mitigation: typecheck + the runtime `.parse()` in the hook ensure only valid `Message` rows ever reach the UI.

## 10. Rollout

Single PR, single commit if it fits (mirrors PR #100's shape). Branch name: `feature/message-entity-consolidation` (already created). Plan link goes into `bd update story-editor-j76 --notes` via `scripts/bd-link-plan.sh`. `/bd-execute story-editor-j76` runs the implementer + spec-reviewer + code-quality-reviewer loop; close-gate runs `repo-boundary-reviewer` (touches `backend/src/repos/message.repo.ts` + a narrative-entity route) before `bd close`.

The migration runs as part of normal `make migrate` / `prisma migrate deploy` — no special ordering. Generated SQL must be inspected and hand-edited to `RENAME COLUMN` if Prisma emits drop-and-add.

---
