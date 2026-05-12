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

Non-goals: Prisma schema change, migration, SSE protocol change, any change to `projectVeniceCitations` adapter logic.

## 3. Constraints

- **Append-only entity.** No PATCH, no DELETE of individual messages, no reorder. So: no `messageUpdateSchema`, no `messageReorderSchema`. (`Chat.delete` cascades, and the repo's `deleteAllAfter` is an internal retry-flow helper, not a wire surface.)
- **Encrypted-at-rest fields are JSON payloads, not narrative strings.** `contentJson`, `attachmentJson`, `citationsJson` go through the ciphertext-triple pattern with a serialise/parse step on each side of the encrypt/decrypt boundary. That repo-internal mechanics stays — only the typing of inputs/outputs changes.
- **SSE bypasses `respond()`.** The POST handler streams `event: …\ndata: …` frames; egress validation only applies to the GET handler.
- **Citation is wire-adjacent — it's a field on Message.** Consolidating Message into shared *requires* a citation schema in shared, so `Citation` moves too in the same PR.

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

// Wire/read shape. `contentJson` is `z.string()` — every write site stores
// a string today (body.content, accumulatedContent). Tightening from the
// legacy `unknown` lets the egress-validation gate catch any future drift
// that tries to store an object.
export const messageSchema = z.strictObject({
  id: z.string().min(1),
  role: messageRoleSchema,
  contentJson: z.string(),
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
  'contentJson',
  'attachmentJson',
  'citationsJson',
] as const;

export type Message = z.infer<typeof messageSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageBodySchema>;
export type MessageEncryptedFieldKey = (typeof MESSAGE_ENCRYPTED_FIELD_KEYS)[number];
```

**Why no `messageCreateSchema`:** Character's create schema mirrored the wire `POST /api/stories/:storyId/characters` body. For Message, the equivalent wire-create body is `sendMessageBodySchema` — a higher-level "send a turn" request that orchestrates Venice + persistence, not a CRUD create. The repo's `MessageCreateInput` (a different, internal shape) stays in `message.repo.ts`.

**`shared/src/index.ts`** adds re-exports for every symbol above, matching the alphabetical-ish layout already established for Character.

## 5. Backend changes

### 5.1 `backend/src/repos/message.repo.ts`

```ts
import type {
  Citation,
  Message,
  MessageAttachment,
  MessageRole,
} from 'story-editor-shared';
import { MESSAGE_ENCRYPTED_FIELD_KEYS } from 'story-editor-shared';

const ENCRYPTED_FIELDS = MESSAGE_ENCRYPTED_FIELD_KEYS;

// Repo-shape: narrative payloads are plaintext (post-decrypt); createdAt is
// a Date (Prisma raw). Mirrors RepoCharacter. Message has no updatedAt.
export type RepoMessage = Omit<Message, 'createdAt'> & { createdAt: Date };

// Repo-internal create input. Narrative-payload types come from the canonical
// shared types; structural fields (chatId) and write-side metadata stay here.
// `contentJson` was previously `unknown` — tightened to `string` to match the
// wire schema and the actual write sites in chat.routes.ts.
export interface MessageCreateInput {
  chatId: string;
  role: MessageRole;
  contentJson: string;
  attachmentJson?: MessageAttachment | null;
  citationsJson?: Citation[] | null;
  model?: string | null;
  tokens?: number | null;
  latencyMs?: number | null;
}
```

Read sites switch from the loose `projectDecrypted(req, row, ENCRYPTED_FIELDS)` (returning `Record<string, unknown>`) to a typed projection. **The cast point differs from Character:** Character's encrypted fields are plain strings, so `projectDecrypted<RepoCharacter>(…)` is shape-correct at the projection call. Message's encrypted fields are JSON payloads stored as serialised strings, and only become their typed shape (`MessageAttachment`, `Citation[]`) after the `shape()` helper's `JSON.parse` loop. So the projection call stays loosely typed and the `as unknown as RepoMessage` cast lands at the end of `shape()` after `JSON.parse` — not inline at `projectDecrypted` as Character does. Equivalent rigour, different placement, dictated by the parse-after-decrypt step.

### 5.2 `backend/src/routes/chat.routes.ts`

- Replace inline `const PostMessageBody = z.object({…}).superRefine(…)` with `import { sendMessageBodySchema } from 'story-editor-shared'`.
- Replace inline `type MessageRole = 'user' | 'assistant' | 'system'` with `import { type MessageRole } from 'story-editor-shared'`.
- `GET /api/chats/:chatId/messages` — wrap the response in a new `serializeMessage(row: RepoMessage)` helper, then `respond(messagesResponseSchema, res, { messages }, 200)`. The inline shape-construction at lines 265–277 becomes one `.map(serializeMessage)` call.
- POST handler stream path is unchanged structurally (still SSE), but its calls into `messageRepo.create(…)` type-check against the canonical `MessageCreateInput` whose field types now derive from shared.
- **Remove the now-unreachable defensive branches in the same PR.** Tightening `contentJson` to `z.string()` (both on the wire and in `MessageCreateInput`) means `m.contentJson` is provably a string at every read site. The legacy `typeof … === 'string' ? … : JSON.stringify(...)` fallbacks become dead code. Drop them at:
  - **`chat.routes.ts:402-404`** — `trailingUserContent` becomes `const trailingUserContent: string = body.retry ? lastUserMsg!.contentJson : (body.content as string);`.
  - **`chat.routes.ts:440-441`** — history mapping's `rawContent` becomes `const rawContent = m.contentJson;` (already typed `string` once `RepoMessage.contentJson: string` flows through `findManyForChat`).

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
- `MESSAGE_ENCRYPTED_FIELD_KEYS` is exactly `['contentJson', 'attachmentJson', 'citationsJson']`.

### 7.2 Updated: `backend/tests/routes/chat-messages-list.test.ts`

- Existing happy-path stays.
- Add: a malformed-row test (e.g. via repo stub returning a row with a stray key) confirms `respond()` throws `ZodError` in test mode, producing a 500 with the validation message visible.

### 7.3 Updated: `backend/tests/routes/chat.test.ts`

- `PostMessageBody` references in test text/fixtures swap to `sendMessageBodySchema`.
- Behaviour assertions (retry+content combinations, attachment shape, enableWebSearch flag) stay the same.

### 7.4 Updated: `frontend/tests/hooks/useChat.test.tsx`

- Add: mock-fetch responses that violate `messagesResponseSchema` (extra key, wrong type) cause the hook's `queryFn` to throw, and a well-formed response round-trips. Matches the `useCharacters` test pattern from PR #100.
- Existing query-key and enabled-flag tests stay.

### 7.5 Unchanged

- `backend/tests/security/encryption-leak.test.ts` — already scans `contentJsonCiphertext`, `attachmentJsonCiphertext`, `citationsJsonCiphertext` with the sentinel. No schema change required.
- `backend/tests/repos/message.repo.test.ts` — repo internals (transaction shape, JSON serialise/parse round-trip, ownership chain) don't change.

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

- **Prisma schema** — Message columns and ciphertext triples are already in their post-`[E11]` shape.
- **SSE protocol** — citation frames, content chunks, `[DONE]` sentinel all unchanged.
- **`projectVeniceCitations`** — wire-adapter logic; stays in `backend/src/lib/venice-citations.ts`.
- **`projectDecrypted`'s return type** — PR #100 flagged this as a tightening opportunity (`Record<string, unknown>` → generic-typed). That's repo-layer plumbing affecting every entity; if we tighten it, it's a separate task across all repos, not a Message-only change. The Message migration uses the same `as unknown as` cast pattern Character does until that's done.

## 9. Risks

- **Rip-and-replace surface area.** ~15 frontend files plus tests. Mitigated by: typecheck-gated verify line; PR #100 already established the exact import substitution at every site; the change is mechanical (rename `ChatMessage` → `Message`, swap import path).
- **`isCitationArray` callers.** Need to swap to `citationSchema.array().safeParse(x).success` at every site (likely 2–3). If a caller relied on the runtime guard's exact narrowing behaviour, the safeParse approach is structurally equivalent.
- **Tightening `contentJson` from `unknown` to `string`.** Risk: any production write path that stores an object would now fail egress validation in dev/test before reaching the DB-side ciphertext columns. Mitigation: confirmed via grep that all three write sites in `chat.routes.ts` stringify before persisting, and the repo's `serialiseJsonField` happily takes a string. Net effect is the wire contract matches reality.
- **Citation type move.** Two callers in backend (`venice-citations.ts`, `message.repo.ts`) and one in frontend (`citations.ts`) plus its consumers. Backend ones become re-exports from shared; frontend `citations.ts` is deleted. Verify-line typecheck catches anything missed.

## 10. Rollout

Single PR, single commit if it fits (mirrors PR #100's shape). Branch name: `feature/message-entity-consolidation`. Plan link goes into `bd update story-editor-j76 --notes` via `scripts/bd-link-plan.sh`. `/bd-execute story-editor-j76` runs the implementer + spec-reviewer + code-quality-reviewer loop; close-gate runs `repo-boundary-reviewer` (touches `backend/src/repos/message.repo.ts` + a narrative-entity route) before `bd close`.

---
