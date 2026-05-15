# Chat entity consolidation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `Chat` to a canonical Zod schema pair in `story-editor-shared`, rip out the four inline backend validators + the frontend hand-rolled `ChatRow` interface, apply `respond()` + `serializeChat` egress on every JSON success-path handler, and add runtime `*.parse(…)` on all chat list/CRUD response paths — all in one PR.

**Architecture:** Pattern-copy of PR #100 (Character), PR #104 (Message), PR #105 (Story), PR #110 (Outline). The `shared/` workspace, `respond()`, `serialize*`, `*ResponseSchema.parse(…)`, and the `Repo<Entity>` typed-projection idiom already exist — this plan extends them to `Chat`. Two schemas (not one) reflect the wire reality: `chatSchema` for single-chat responses (POST/PATCH) and `chatSummarySchema = chatSchema.extend({ messageCount })` for the LIST endpoint, which enriches each row via `messageRepo.countForChat`. Tasks are ordered so each *commit* leaves the build green — Task 5 (api.ts return-type churn) intentionally breaks typecheck until Task 6 lands its consumer fixes; the two land as one commit at the end of Task 6.

**Tech Stack:** TypeScript strict, Zod 4, Vitest 4, Express 5, Prisma 7, React 19, Vite 8, TanStack Query. No new dependencies. No Prisma schema or migration changes.

**Spec:** `docs/superpowers/specs/2026-05-11-character-entity-consolidation-design.md` (Follow-up tasks — Chat row).

**bd:** `story-editor-up6`. Plan link applied via `bash scripts/bd-link-plan.sh story-editor-up6 docs/superpowers/plans/2026-05-15-chat-entity-consolidation.md` *after user approval of this plan*.

**Branch:** `feature/chat-entity-consolidation` — already created off freshly-pulled `main` before `/bd-execute` started; the plan file is the first commit on the branch (main is branch-protected and accepts code only via PR).

---

## Two-schema rationale (load-bearing)

The Chat wire format is non-uniform across endpoints:

| Endpoint | Returns | `messageCount` |
|---|---|---|
| `POST /api/chapters/:chapterId/chats` | `{ chat: … }` | absent |
| `PATCH /api/chats/:id` | `{ chat: … }` | absent |
| `GET /api/chapters/:chapterId/chats` | `{ chats: [...] }` | required (enriched by route) |
| `DELETE /api/chats/:id` | `204 No Content` | n/a |

Modeling this as one schema with `messageCount: z.number().optional()` would force every list-consumer to defensively check, which is exactly the kind of "optional that's always set in context X" that `z.strictObject` is designed to surface. Two schemas keep each endpoint's wire shape precise:

```ts
export const chatSchema = z.strictObject({ /* core 7 fields, no messageCount */ });
export const chatSummarySchema = chatSchema.extend({
  messageCount: z.number().int().nonnegative(),
});
```

Zod 4 preserves strictness through `.extend()` on a `strictObject` (same trick `outlineUpdateSchema` uses — verified in `shared/tests/outline.schema.test.ts`).

## Consumer analysis (test fixture drift)

`frontend/tests/hooks/useChat.test.tsx` currently mocks POST/PATCH responses with `messageCount` present in the `chat:` payload (e.g. line 393's `newChat: ChatSummary` carries `messageCount: 0`). The backend's actual POST/PATCH responses DO NOT include `messageCount` (the repo's `create` / `update` returns a plain row; only the list path calls `messageRepo.countForChat` per chat). Once strict `chatSchema.parse()` runs in `useCreateChatMutation` / `useRenameChatMutation`, these fixtures fail.

**Fix in this PR:** fixtures for POST/PATCH mocks build `Chat` (no messageCount), and the optimistic-cache insertion in `useCreateChatMutation.onSuccess` injects `messageCount: 0` before prepending into the `ChatSummary[]` cache. This is the post-d7e learning applied prospectively (see `bd memories when-migrating-an-entity-onto-shared-zod-schemas`).

`frontend/tests/components/SceneTab.test.tsx` mocks both LIST (`chats: [...]` with messageCount) and POST (`chat: …`) responses; per consumer file, every POST mock object includes `messageCount` and must be stripped.

---

## File structure

**Created:**
- `shared/src/schemas/chat.ts` — canonical Chat Zod schemas, types, `CHAT_ENCRYPTED_FIELD_KEYS`, `CHAT_TITLE_MIN/MAX`
- `shared/tests/chat.schema.test.ts` — schema unit tests

**Modified (shared):**
- `shared/src/index.ts` — re-export the new chat symbols (alphabetical insertion between `character` and `message` blocks)

**Modified (backend):**
- `backend/src/repos/chat.repo.ts` — consume shared types; add `RepoChat`; type the four `projectDecrypted<RepoChat>` calls; import `CHAT_ENCRYPTED_FIELD_KEYS`; re-export `ChatCreateInput` / `ChatUpdateInput` from shared
- `backend/src/routes/chat.routes.ts` — delete the three body-schema inlines (`ChatKind`, `CreateChatBody`, `PatchChatBody`) and replace `ListChatsQuery` with a one-line route-local wrapper around the shared `chatKindSchema` (query-string parsers stay route-local; the shared package owns body schemas); consume shared schemas; `respond()` + `serializeChat` on three JSON success-path handlers (POST chat create, PATCH chat rename, GET chats list); DELETE remains 204
- `backend/src/lib/serialize.ts` — add `serializeChat(row: RepoChat): Chat` (explicit-pick form, matching `serializeMessage` / `serializeStory` / `serializeOutlineItem`); the list endpoint maps `chats.map(c => ({ ...serializeChat(c), messageCount }))` inline rather than introducing a `serializeChatSummary` two-arg variant
- `backend/tests/routes/chat.test.ts` — response-shape assertions updated; verifies `messageCount` absent from POST/PATCH and present on LIST
- `backend/tests/lib/serialize.test.ts` — add `serializeChat()` block with ISO-string / stray-key / no-mutation assertions

**Modified (frontend):**
- `frontend/src/lib/api.ts` — delete `ChatRow` interface; `listChats` returns `ChatSummary[]`, `createChat` / `patchChat` return `Chat`; runtime-parse responses via the new schemas
- `frontend/src/hooks/useChat.ts` — drop local `ChatSummary` type alias and `ChatsResponse` interface; import `Chat` + `ChatSummary` from shared; runtime `chatsResponseSchema.parse(raw)` on list, `chatResponseSchema.parse(raw)` on POST/PATCH; optimistic-cache insertion synthesises `messageCount: 0`
- `frontend/src/hooks/useScenes.ts` — switch `ChatRow` → `ChatSummary` (the scene list uses the LIST endpoint, so `messageCount` is always present)
- `frontend/tests/hooks/useChat.test.tsx` — strip `messageCount` from POST/PATCH mock `chat:` payloads (the load-bearing fixture fix); keep `messageCount` on LIST mocks; add a schema-drift smoke test that asserts `useCreateChatMutation` surfaces an error when a server response carries a stray key
- `frontend/tests/components/SceneTab.test.tsx` — strip `messageCount` from POST mock `chat:` payloads (same fixture fix in a different consumer)
- `frontend/tests/hooks/useScenes.test.tsx` — type-reference consumer: 6 `api.ChatRow` references must switch to shared types. POST/PATCH mock returns become `Chat` (no `messageCount`, with `lastActivityAt`); cache fixtures (`setQueryData`, `getQueryData`) and LIST mocks become `ChatSummary[]` (with `messageCount: 0` and `lastActivityAt`). All current fixtures also omit `lastActivityAt` entirely — the strict-schema cut requires it on every fixture
- `frontend/tests/components/ChatPanel.test.tsx` — no fixture changes needed (verified: it constructs settings only)

**Untouched (confirmed during planning):**
- `backend/src/routes/chat.routes.ts:213+` — the SSE POST `/api/chats/:chatId/messages` body uses the already-shared `sendMessageBodySchema` (from `Message` consolidation, PR #104). Untouched here.
- `backend/src/routes/chat.routes.ts:218+` — GET `/api/chats/:chatId/messages` already wires `respond(messagesResponseSchema, …)`. Untouched here.
- `backend/src/repos/message.repo.ts` — `countForChat` signature unchanged.
- `frontend/src/lib/streamingAI.ts` — pure SSE client, no chat schema imports.

**Verify line (applied to bd `--notes` at link-plan time):**

```
verify: npm -w story-editor-shared run typecheck && npm -w story-editor-shared test && \
  npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck && \
  make dev && timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done' && \
  npm -w story-editor-backend test -- tests/routes/chat tests/repos/chat tests/lib/serialize tests/security/encryption-leak && \
  npm -w story-editor-frontend test -- tests/hooks/useChat tests/hooks/useScenes tests/components/SceneTab tests/components/ChatPanel
```

Notes:
- The `shared` workspace is source-only — `typecheck`, not `build`. Matches the post-PR-#110 harness state.
- The `pg_isready` poll-loop replaces an arbitrary `sleep` (precedent: story-editor-9mk's verify line). Vitest's `globalSetup.ts` shells out to `scripts/db-test-reset.sh` which `docker exec`s against the compose stack — Postgres must be accepting connections before any backend-test step. `pg_isready` is the right gate (the backend container itself isn't reached by vitest; tests run in-process via Prisma).
- `timeout 60` caps the wait — Postgres healthcheck is `interval=5s, retries=10`, so 60s covers a cold start with margin.

---

## Task 1 — Shared Chat schemas + tests (TDD)

Add the canonical layer in `story-editor-shared`. No consumers touched; this task lands clean even if no other task runs.

**Files:**
- Create: `shared/tests/chat.schema.test.ts`
- Create: `shared/src/schemas/chat.ts`
- Modify: `shared/src/index.ts`

- [ ] **1a. Write the failing schema tests.** Create `shared/tests/chat.schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CHAT_TITLE_MAX,
  CHAT_TITLE_MIN,
  chatCreateSchema,
  chatKindSchema,
  chatResponseSchema,
  chatSchema,
  chatsResponseSchema,
  chatSummarySchema,
  chatUpdateSchema,
} from '../src/schemas/chat';

const validChat = {
  id: 'cm0chat00000001',
  chapterId: 'cm0chap00000001',
  title: 'First-draft brainstorm',
  kind: 'ask' as const,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T01:00:00.000Z',
  lastActivityAt: '2026-05-15T02:00:00.000Z',
};

describe('chatKindSchema', () => {
  it('accepts "ask" and "scene"', () => {
    expect(() => chatKindSchema.parse('ask')).not.toThrow();
    expect(() => chatKindSchema.parse('scene')).not.toThrow();
  });
  it('rejects unknown kinds', () => {
    expect(() => chatKindSchema.parse('story')).toThrow();
  });
});

describe('chatSchema', () => {
  it('accepts a fully-populated valid chat', () => {
    expect(() => chatSchema.parse(validChat)).not.toThrow();
  });
  it('accepts null title', () => {
    expect(() => chatSchema.parse({ ...validChat, title: null })).not.toThrow();
  });
  it('rejects unknown fields (strict)', () => {
    expect(() => chatSchema.parse({ ...validChat, userId: 'u1' })).toThrow();
  });
  it('rejects messageCount on the bare chat shape', () => {
    expect(() => chatSchema.parse({ ...validChat, messageCount: 0 })).toThrow();
  });
  it('rejects non-ISO datetime', () => {
    expect(() => chatSchema.parse({ ...validChat, createdAt: 'not-a-date' })).toThrow();
  });
  it('rejects empty id', () => {
    expect(() => chatSchema.parse({ ...validChat, id: '' })).toThrow();
  });
});

describe('chatSummarySchema', () => {
  const validSummary = { ...validChat, messageCount: 3 };

  it('accepts chat + messageCount', () => {
    expect(() => chatSummarySchema.parse(validSummary)).not.toThrow();
  });
  it('rejects when messageCount missing', () => {
    expect(() => chatSummarySchema.parse(validChat)).toThrow();
  });
  it('rejects negative messageCount', () => {
    expect(() => chatSummarySchema.parse({ ...validSummary, messageCount: -1 })).toThrow();
  });
  it('rejects unknown keys (strictness preserved through .extend())', () => {
    expect(() => chatSummarySchema.parse({ ...validSummary, foo: 1 })).toThrow();
  });
});

describe('chatCreateSchema (POST body)', () => {
  it('accepts empty body (all optional)', () => {
    expect(() => chatCreateSchema.parse({})).not.toThrow();
  });
  it('accepts { title, kind }', () => {
    expect(() => chatCreateSchema.parse({ title: 'hi', kind: 'scene' })).not.toThrow();
  });
  it('rejects unknown keys', () => {
    expect(() => chatCreateSchema.parse({ chapterId: 'x' })).toThrow();
  });
  it('rejects bad kind', () => {
    expect(() => chatCreateSchema.parse({ kind: 'story' })).toThrow();
  });
});

describe('chatUpdateSchema (PATCH body)', () => {
  it('accepts a single-char title', () => {
    expect(() => chatUpdateSchema.parse({ title: 'a' })).not.toThrow();
  });
  it('rejects empty title', () => {
    expect(() => chatUpdateSchema.parse({ title: '' })).toThrow();
  });
  it(`rejects title > ${CHAT_TITLE_MAX} chars`, () => {
    expect(() => chatUpdateSchema.parse({ title: 'x'.repeat(CHAT_TITLE_MAX + 1) })).toThrow();
  });
  it('rejects unknown keys', () => {
    expect(() => chatUpdateSchema.parse({ title: 'ok', kind: 'ask' })).toThrow();
  });
  it('rejects null title (PATCH renames; clearing not supported on this endpoint)', () => {
    expect(() => chatUpdateSchema.parse({ title: null })).toThrow();
  });
});

describe('chatResponseSchema / chatsResponseSchema', () => {
  it('chatResponseSchema accepts { chat }', () => {
    expect(() => chatResponseSchema.parse({ chat: validChat })).not.toThrow();
  });
  it('chatResponseSchema rejects messageCount inside chat', () => {
    expect(() =>
      chatResponseSchema.parse({ chat: { ...validChat, messageCount: 0 } }),
    ).toThrow();
  });
  it('chatsResponseSchema requires messageCount on every entry', () => {
    expect(() => chatsResponseSchema.parse({ chats: [validChat] })).toThrow();
  });
  it('chatsResponseSchema accepts entries with messageCount', () => {
    expect(() =>
      chatsResponseSchema.parse({ chats: [{ ...validChat, messageCount: 0 }] }),
    ).not.toThrow();
  });
});

// CHAT_TITLE_MIN exported as 1 to mirror the inline PATCH schema's min(1).
// Used at runtime via chatUpdateSchema; the constant is exported so consumers
// could share it (none currently do; harmless future-proofing).
describe('CHAT_TITLE_MIN constant', () => {
  it('equals 1', () => {
    expect(CHAT_TITLE_MIN).toBe(1);
  });
});
```

- [ ] **1b. Run the test — should fail (module not found).**

```
npm -w story-editor-shared test -- chat.schema
```

Expected: `Cannot find module '../src/schemas/chat'` or equivalent.

- [ ] **1c. Implement the schemas.** Create `shared/src/schemas/chat.ts`:

```ts
import { z } from 'zod';

// Field-length caps — single source of truth.
// Values from the legacy inline `PatchChatBody` (min 1, max 200).
export const CHAT_TITLE_MIN = 1;
export const CHAT_TITLE_MAX = 200;

export const chatKindSchema = z.enum(['ask', 'scene']);

// `z.strictObject` rejects unknown keys at every layer — closes the
// Prisma↔Zod drift seam at egress-validation time, same as the other entities.
export const chatSchema = z.strictObject({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  // Title is encrypted at rest; the wire format is plaintext (null when unset).
  title: z.string().nullable(),
  kind: chatKindSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // story-editor-loj: bumped on every child-message create; surfaces "most-recent
  // chat" at index 0 of the LIST endpoint's response.
  lastActivityAt: z.string().datetime(),
});

// LIST-endpoint enrichment. Zod 4: `.extend()` on a strictObject preserves
// strictness (verified in test "rejects unknown keys (strictness preserved
// through .extend())"). Same trick outlineUpdateSchema uses.
export const chatSummarySchema = chatSchema.extend({
  messageCount: z.number().int().nonnegative(),
});

// POST body — chapterId comes from the URL, not the body. Both fields optional.
export const chatCreateSchema = z.strictObject({
  title: z.string().optional(),
  kind: chatKindSchema.optional(),
});

// PATCH body — title only, must be non-empty (legacy behaviour). Null not
// permitted on this endpoint (clearing a title isn't a supported action).
export const chatUpdateSchema = z.strictObject({
  title: z.string().min(CHAT_TITLE_MIN).max(CHAT_TITLE_MAX),
});

// Egress envelopes.
export const chatResponseSchema = z.strictObject({ chat: chatSchema });
export const chatsResponseSchema = z.strictObject({
  chats: z.array(chatSummarySchema),
});

// Single source of truth for which Chat fields are encrypted at rest.
// Imported by backend/src/repos/chat.repo.ts as ENCRYPTED_FIELDS.
export const CHAT_ENCRYPTED_FIELD_KEYS = ['title'] as const;

export type Chat = z.infer<typeof chatSchema>;
export type ChatSummary = z.infer<typeof chatSummarySchema>;
export type ChatKind = z.infer<typeof chatKindSchema>;
export type ChatCreateInput = z.infer<typeof chatCreateSchema>;
export type ChatUpdateInput = z.infer<typeof chatUpdateSchema>;
export type ChatEncryptedFieldKey = (typeof CHAT_ENCRYPTED_FIELD_KEYS)[number];
```

- [ ] **1d. Wire the shared barrel.** Modify `shared/src/index.ts`. Insert a `chat` block alphabetically between the `character` and `message` blocks (the file follows alphabetical convention — verify by reading lines 1–80 first):

```ts
export type {
  Chat,
  ChatCreateInput,
  ChatEncryptedFieldKey,
  ChatKind,
  ChatSummary,
  ChatUpdateInput,
} from './schemas/chat';
export {
  CHAT_ENCRYPTED_FIELD_KEYS,
  CHAT_TITLE_MAX,
  CHAT_TITLE_MIN,
  chatCreateSchema,
  chatKindSchema,
  chatResponseSchema,
  chatSchema,
  chatsResponseSchema,
  chatSummarySchema,
  chatUpdateSchema,
} from './schemas/chat';
```

- [ ] **1e. Run tests — expect green.**

```
npm -w story-editor-shared test -- chat.schema
```

All cases in step 1a pass.

- [ ] **1f. Typecheck.** `shared` is source-only (no build script — Phase-110 harness state).

```
npm -w story-editor-shared run typecheck
```

- [ ] **1g. Commit.**

```
git add shared/src/schemas/chat.ts shared/src/index.ts shared/tests/chat.schema.test.ts
git commit -m "[story-editor-up6] Task 1: shared Chat schemas + tests"
```

---

## Task 2 — `serializeChat` helper + tests (TDD)

Add the handler-boundary converter. Repo type comes next; this task only needs the input shape, so we define a local `RepoChatLike` for the test that satisfies what `serializeChat` reads.

**Files:**
- Modify: `backend/src/lib/serialize.ts`
- Modify: `backend/tests/lib/serialize.test.ts`

- [ ] **2a. Write the failing serializer test.** Append a `describe('serializeChat', …)` block to `backend/tests/lib/serialize.test.ts`. Pattern-copy `serializeOutlineItem` block: cover (1) ISO-string Date conversion, (2) explicit-pick (stray repo key like `titleCiphertext` does not leak), (3) no input mutation (deep-clone Dates before passing).

```ts
describe('serializeChat', () => {
  const baseRow = {
    id: 'cm0chat00000001',
    chapterId: 'cm0chap00000001',
    title: 'Brainstorming',
    kind: 'ask' as const,
    createdAt: new Date('2026-05-15T00:00:00.000Z'),
    updatedAt: new Date('2026-05-15T01:00:00.000Z'),
    lastActivityAt: new Date('2026-05-15T02:00:00.000Z'),
  };

  it('converts Date fields to ISO strings', () => {
    const out = serializeChat(baseRow);
    expect(out.createdAt).toBe('2026-05-15T00:00:00.000Z');
    expect(out.updatedAt).toBe('2026-05-15T01:00:00.000Z');
    expect(out.lastActivityAt).toBe('2026-05-15T02:00:00.000Z');
  });

  it('returns null title when null on the repo row', () => {
    const out = serializeChat({ ...baseRow, title: null });
    expect(out.title).toBeNull();
  });

  it('rejects stray repo-internal keys via explicit pick', () => {
    const out = serializeChat({
      ...baseRow,
      titleCiphertext: Buffer.from('xx'),
    } as unknown as Parameters<typeof serializeChat>[0]);
    expect((out as unknown as Record<string, unknown>).titleCiphertext).toBeUndefined();
  });

  it('does not mutate input', () => {
    const row = {
      ...baseRow,
      createdAt: new Date(baseRow.createdAt),
      updatedAt: new Date(baseRow.updatedAt),
      lastActivityAt: new Date(baseRow.lastActivityAt),
    };
    serializeChat(row);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.lastActivityAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **2b. Run — should fail (`serializeChat` not exported).**

```
make dev && timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done'
npm -w story-editor-backend test -- tests/lib/serialize
```

Expected: `serializeChat is not defined` or import error.

- [ ] **2c. Implement.** Add to `backend/src/lib/serialize.ts` (after `serializeMessage` to keep alphabetical-by-entity ordering — verify by reading the file first):

```ts
import type { Chat } from 'story-editor-shared';
// (existing imports — append `Chat` to the shared import list)

// Repo-layer shape. Dates arrive as `Date` from Prisma; serialize converts to ISO.
// Plaintext-only at this boundary — `titleCiphertext` etc. have been projected
// out by chat.repo.ts via `projectDecrypted<RepoChat>`.
export interface RepoChat {
  id: string;
  chapterId: string;
  title: string | null;
  kind: 'ask' | 'scene';
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
}

// Explicit pick (not spread): forces the compiler to surface any repo field
// the wire shape does NOT carry (matches serializeMessage / serializeOutlineItem).
export function serializeChat(row: RepoChat): Chat {
  return {
    id: row.id,
    chapterId: row.chapterId,
    title: row.title,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
  };
}
```

- [ ] **2d. Run — expect green.**

```
npm -w story-editor-backend test -- tests/lib/serialize
```

- [ ] **2e. Typecheck.**

```
npm -w story-editor-backend run typecheck
```

- [ ] **2f. Commit.**

```
git add backend/src/lib/serialize.ts backend/tests/lib/serialize.test.ts
git commit -m "[story-editor-up6] Task 2: add serializeChat + RepoChat"
```

---

## Task 3 — Type the chat repo against `RepoChat`

Replace the four `as unknown as Record<string, unknown>` casts with the typed `projectDecrypted<RepoChat>` form. Adopt shared types for the input shapes.

**Files:**
- Modify: `backend/src/repos/chat.repo.ts`

- [ ] **3a. Read the current file** to confirm the touch-set.

```
sed -n '1,30p' backend/src/repos/chat.repo.ts
```

- [ ] **3b. Apply the typed-projection rewrite.** Top of file becomes:

```ts
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CHAT_ENCRYPTED_FIELD_KEYS, type ChatKind } from 'story-editor-shared';
import type { RepoChat } from '../lib/serialize';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = CHAT_ENCRYPTED_FIELD_KEYS;

// Repo-local input shapes. The shared chatCreateSchema can't cover these
// directly because `chapterId` comes from the URL (not the request body).
export interface ChatCreateInput {
  chapterId: string;
  title?: string | null;
  kind?: ChatKind;
}

export interface ChatUpdateInput {
  title?: string | null;
}
```

Then replace each of the four `projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS)` calls with `projectDecrypted<RepoChat>(req, row, ENCRYPTED_FIELDS)`, removing the casts. The repo's public return types switch from inferred `Record<string,unknown>` to `RepoChat | null` / `RepoChat[]` accordingly.

- [ ] **3c. Typecheck backend — must pass.** Routes still consume the old return shape (`Record<string,unknown>` indexing), so this step verifies the upcast is sound.

```
npm -w story-editor-backend run typecheck
```

If `chat.routes.ts` fails to compile (e.g. `chat.chapterId as string` no longer needed because `chapterId` is now `string` directly), defer the route cleanup to Task 4 — but the typecheck MUST pass first. If it fails for any other reason, fix here.

- [ ] **3d. Backend test sweep — repo + routes still green against the new shape.**

```
make dev && timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done'
npm -w story-editor-backend test -- tests/repos/chat tests/routes/chat tests/security/encryption-leak
```

- [ ] **3e. Commit.**

```
git add backend/src/repos/chat.repo.ts
git commit -m "[story-editor-up6] Task 3: type chat.repo via projectDecrypted<RepoChat>"
```

---

## Task 4 — Backend routes: shared schemas + `respond()` egress

Delete inline schemas, runtime-validate egress on three JSON success paths. DELETE stays 204 (no body to validate).

**Files:**
- Modify: `backend/src/routes/chat.routes.ts`
- Modify: `backend/tests/routes/chat.test.ts`

- [ ] **4a. Replace ingress schemas.** At top of `chat.routes.ts`, replace the four inline schemas with imports from `story-editor-shared`:

```ts
import {
  type Citation,
  type MessageRole,
  chatCreateSchema,
  chatKindSchema,
  chatUpdateSchema,
  chatResponseSchema,
  chatsResponseSchema,
  messagesResponseSchema,
  sendMessageBodySchema,
  toCharacterPromptInput,
} from 'story-editor-shared';
```

Delete lines 46–53 (`ChatKind`, `CreateChatBody`) and 55–59 (`ListChatsQuery`) and 147–151 (`PatchChatBody`). The query parser stays inline because Zod is checking a single optional enum field — define it locally with the imported schema:

```ts
const ListChatsQuery = z.strictObject({ kind: chatKindSchema.optional() });
```

(Keeping a one-line local for a query-string parser is acceptable; the shared package owns the body schemas.)

Update the parse sites to use the shared names (`chatCreateSchema` instead of `CreateChatBody`, `chatUpdateSchema` instead of `PatchChatBody`).

- [ ] **4b. Add `respond()` + `serializeChat` egress.** Import `respond` and `serializeChat`:

```ts
import { respond } from '../lib/respond';
import { serializeChat } from '../lib/serialize';
```

Then on each JSON success path:

**POST `/api/chapters/:chapterId/chats`** (line ~99):

```ts
const chat = await createChatRepo(req).create({ /* unchanged */ });
return respond(chatResponseSchema, res, { chat: serializeChat(chat) }, 201);
```

**GET `/api/chapters/:chapterId/chats`** (line ~135) — list, with enrichment:

```ts
const chats = await createChatRepo(req).findManyForChapter(chapterId, { kind });
const enriched = await Promise.all(
  chats.map(async (chat) => ({
    ...serializeChat(chat),
    messageCount: await createMessageRepo(req).countForChat(chat.id),
  })),
);
return respond(chatsResponseSchema, res, { chats: enriched });
```

**PATCH `/api/chats/:id`** (line ~180):

```ts
return respond(chatResponseSchema, res, { chat: serializeChat(updated) }, 200);
```

DELETE remains `res.status(204).send()` — no schema.

- [ ] **4c. Update route tests.** Modify `backend/tests/routes/chat.test.ts` assertions:
  - POST/PATCH responses: assert `messageCount` is NOT in the response body (`expect(body.chat).not.toHaveProperty('messageCount')`).
  - LIST response: assert `messageCount` IS present on every entry.
  - All three: assert `createdAt`/`updatedAt`/`lastActivityAt` are ISO strings (not Date objects).
  - If any test asserts a specific `error` shape from Zod's `safeParse`, those continue to flow through `badRequestFromZod` unchanged.

- [ ] **4d. Run backend tests.**

```
make dev && timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done'
npm -w story-editor-backend test -- tests/routes/chat tests/repos/chat tests/lib/serialize tests/security/encryption-leak
```

All green.

- [ ] **4e. Typecheck.**

```
npm -w story-editor-backend run typecheck
```

- [ ] **4f. Commit.**

```
git add backend/src/routes/chat.routes.ts backend/tests/routes/chat.test.ts
git commit -m "[story-editor-up6] Task 4: chat routes consume shared schemas + respond() egress"
```

---

## Task 5 — Frontend api.ts: delete `ChatRow`, runtime-parse responses

Delete the hand-rolled interface; switch returns to shared types + parse at the boundary.

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **5a. Read the current chat block** (lines 290–366) to confirm the four wrappers.

- [ ] **5b. Replace the block** with shared-types form. Delete the `ChatRow` interface entirely. Updated functions:

```ts
import {
  type Chat,
  type ChatKind,
  type ChatSummary,
  chatResponseSchema,
  chatsResponseSchema,
} from 'story-editor-shared';

export async function listChats(
  chapterId: string,
  opts?: { kind?: ChatKind },
): Promise<ChatSummary[]> {
  const params = opts?.kind !== undefined ? `?kind=${encodeURIComponent(opts.kind)}` : '';
  const res = await api<unknown>(
    `/chapters/${encodeURIComponent(chapterId)}/chats${params}`,
  );
  return chatsResponseSchema.parse(res).chats;
}

export async function createChat(
  chapterId: string,
  opts?: { title?: string; kind?: ChatKind },
): Promise<Chat> {
  const body: Record<string, unknown> = {};
  if (opts?.title !== undefined) body.title = opts.title;
  if (opts?.kind !== undefined) body.kind = opts.kind;
  const res = await api<unknown>(
    `/chapters/${encodeURIComponent(chapterId)}/chats`,
    { method: 'POST', body },
  );
  return chatResponseSchema.parse(res).chat;
}

export async function patchChat(id: string, title: string): Promise<Chat> {
  const res = await api<unknown>(`/chats/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { title },
  });
  return chatResponseSchema.parse(res).chat;
}

export async function deleteChat(id: string): Promise<void> {
  await api<void>(`/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
```

- [ ] **5c. Frontend typecheck — expect breakage.**

```
npm -w story-editor-frontend run typecheck
```

Expected failures in `useChat.ts` (uses `ChatRow`) and `useScenes.ts` (uses `ChatRow`). These are fixed in Tasks 6 and 7.

**Do not commit yet** — this task only compiles in isolation if the downstream callers are fixed. Stage the change but defer the commit to the end of Task 6.

---

## Task 6 — Frontend `useChat.ts`: drop local types, runtime-parse

Delete the local `ChatSummary` type alias and `ChatsResponse` interface; import from shared. Optimistic cache insert synthesises `messageCount: 0` so `ChatSummary[]` cache stays well-typed.

**Files:**
- Modify: `frontend/src/hooks/useChat.ts`

- [ ] **6a. Replace the imports + delete local types.**

```ts
import {
  type Chat,
  type ChatKind,
  type ChatSummary,
  type Message,
  chatResponseSchema,
  chatsResponseSchema,
  messagesResponseSchema,
} from 'story-editor-shared';
import { ApiError, api, deleteChat } from '@/lib/api';
```

Delete the local `ChatSummary` alias (line 37) and `ChatsResponse` interface (lines 39–41).

- [ ] **6b. Use shared types in hook signatures.** `useChatsQuery`'s return type stays `UseQueryResult<ChatSummary[], Error>`; `useCreateChatMutation` keeps `UseMutationResult<ChatSummary, Error, CreateChatArgs>`. The hooks' query/mutation bodies switch to runtime parsing:

```ts
queryFn: async (): Promise<ChatSummary[]> => {
  const params = kind !== undefined ? `?kind=${encodeURIComponent(kind)}` : '';
  const res = await api<unknown>(
    `/chapters/${encodeURIComponent(chapterId ?? '')}/chats${params}`,
  );
  return chatsResponseSchema.parse(res).chats;
},
```

`useCreateChatMutation.mutationFn`:

```ts
mutationFn: async ({ chapterId, title, kind }) => {
  const body: Record<string, unknown> = {};
  if (title !== undefined) body.title = title;
  if (kind !== undefined) body.kind = kind;
  const res = await api<unknown>(
    `/chapters/${encodeURIComponent(chapterId)}/chats`,
    { method: 'POST', body },
  );
  return chatResponseSchema.parse(res).chat; // returns Chat (no messageCount)
},
```

The mutation's return type CHANGES from `ChatSummary` → `Chat`. Update the signature:

```ts
export function useCreateChatMutation(): UseMutationResult<Chat, Error, CreateChatArgs> {
```

The `onSuccess` cache-write must synthesise `messageCount: 0`:

```ts
onSuccess: (chat, vars) => {
  const summary: ChatSummary = { ...chat, messageCount: 0 };
  const key = chatsQueryKey(chat.chapterId, vars.kind);
  qc.setQueryData<ChatSummary[]>(key, (prev) => [summary, ...(prev ?? [])]);
  void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(chat.chapterId) });
},
```

Same shape for `useRenameChatMutation`: `Chat` return type, cache write merges `title` into the existing `ChatSummary` entry (preserving its `messageCount`):

```ts
export function useRenameChatMutation(/*…*/): UseMutationResult<Chat, Error, { id: string; title: string }> {
  // …
  mutationFn: async ({ id, title }) => {
    const res = await api<unknown>(`/chats/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { title },
    });
    return chatResponseSchema.parse(res).chat;
  },
  onSuccess: (updated, vars) => {
    if (chapterId === null) return;
    const key = chatsQueryKey(chapterId, kind);
    qc.setQueryData<ChatSummary[]>(key, (prev) =>
      (prev ?? []).map((c) => (c.id === vars.id ? { ...c, title: updated.title } : c)),
    );
    void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(chapterId) });
  },
}
```

(Notice: the cache update uses `updated.title`, not the rest of `updated`, so the lack of `messageCount` on `Chat` doesn't bleed into the cached `ChatSummary`. This pattern is already in place — just confirm the types compile.)

- [ ] **6c. Fix test fixtures.** Modify `frontend/tests/hooks/useChat.test.tsx`:

For every POST/PATCH mock that uses `jsonResponse(201, { chat: ... })` or `jsonResponse(200, { chat: ... })`:
  - The `chat:` object must NOT include `messageCount`. Strip it.
  - The `chat:` object type changes from `ChatSummary` to `Chat`.

Test imports update:

```ts
import { type Chat, type ChatSummary } from 'story-editor-shared';
```

Each fixture decision:
  - **LIST mocks** (`jsonResponse(200, { chats: [...] })`): keep `messageCount` (LIST responses do enrich).
  - **POST/PATCH mocks** (`jsonResponse(*, { chat: ... })`): strip `messageCount`; type as `Chat`.
  - **Cache assertions** (`qc.getQueryData<ChatSummary[]>(...)` reads): the cache shape stays `ChatSummary[]`, so reading entries still produces `messageCount`. The optimistic-create path now inserts a synthetic `messageCount: 0` — assertions of the cached entry should expect `messageCount: 0` after a `useCreateChatMutation.mutateAsync` call. Update any assertion that previously expected the server's `messageCount` (it's no longer there) to expect `0`.

- [ ] **6d. Add a schema-drift smoke test.** Append to `frontend/tests/hooks/useChat.test.tsx`:

```ts
describe('useChat schema drift', () => {
  it('createChat surfaces error when server response carries stray key', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { chat: { /* valid Chat shape */ ...validChat, extra: 1 } }),
    );
    const qc = createQueryClient();
    const { result } = renderHook(() => useCreateChatMutation(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await expect(
      result.current.mutateAsync({ chapterId: CHAPTER_ID, kind: 'ask' }),
    ).rejects.toThrow();
  });
});
```

(`validChat` is defined as a top-of-file test fixture identical to Task 1's `validChat`, minus `messageCount`.)

- [ ] **6e. Fix `useScenes.ts`.** Modify `frontend/src/hooks/useScenes.ts`:

```ts
import { type ChatSummary } from 'story-editor-shared';
// …
const createMut = useMutation({
  mutationFn: () => createChat(chapterId!, { kind: 'scene' }),
  onSuccess: (newChat) => {
    if (chapterId) {
      const summary: ChatSummary = { ...newChat, messageCount: 0 };
      qc.setQueryData<ChatSummary[]>(sceneListKey(chapterId), (prev) => [summary, ...(prev ?? [])]);
    }
    invalidate();
  },
});
// rename + remove mutations: change all `<ChatRow[]>` to `<ChatSummary[]>`
// SceneRow type changes: `export type SceneRow = ChatSummary & { kind: 'scene' };`
```

- [ ] **6f. Fix `SceneTab.test.tsx` fixtures.** Strip `messageCount` from POST mock `chat:` payloads (lines around 337–342, 351–361). LIST mocks keep `messageCount`.

- [ ] **6f2. Migrate `useScenes.test.tsx` fixtures** (type-reference consumer; the second post-d7e-learning fixture sweep). Modify `frontend/tests/hooks/useScenes.test.tsx`:

Replace the test's `import * as api from '@/lib/api'` (or the equivalent named imports) so `Chat` and `ChatSummary` come from shared:

```ts
import { type Chat, type ChatSummary } from 'story-editor-shared';
```

The file currently has 6 `api.ChatRow` references; rewire each:

  - **POST/PATCH mock returns** (`api.createChat.mockResolvedValue(...)` at line ~77, `api.patchChat.mockResolvedValue(...)` at lines ~111 and ~132): the legacy fixture omits `lastActivityAt` entirely and was implicitly `ChatRow`. Switch the literal type annotation (if any) to `Chat`, add `lastActivityAt: ''` (legacy uses empty strings for createdAt/updatedAt — keep that idiom), do NOT add `messageCount` (the wire reality this PR enforces is that POST/PATCH responses don't carry it).
  - **`setQueryData<api.ChatRow[]>(SCENE_LIST_KEY('c1'), [...])`** (lines 92, 152, 196): cache type is `ChatSummary[]` after Task 6e's `useScenes.ts` rewrite. Switch the generic to `ChatSummary[]`. Every literal in the seed array gains `lastActivityAt: ''` AND `messageCount: 0` to satisfy `chatSummarySchema`.
  - **`api.listChats.mockResolvedValueOnce([...])`** (lines 79, 142): LIST endpoint returns `ChatSummary[]`. Add `lastActivityAt: ''` AND `messageCount: 0` to each literal. Type annotation (if any) switches to `ChatSummary[]`.
  - **`getQueryData<api.ChatRow[]>(...)` reads** (lines 104, 165, 208): the cached shape is now `ChatSummary[]`. Switch the generic; the existing assertions on `.id` and `.title` continue to work.

Verify after the rewrite: `grep -n "api.ChatRow" frontend/tests/hooks/useScenes.test.tsx` returns empty.

- [ ] **6g. Frontend typecheck — must pass.**

```
npm -w story-editor-frontend run typecheck
```

- [ ] **6h. Frontend tests — must pass.**

```
npm -w story-editor-frontend test -- tests/hooks/useChat tests/hooks/useScenes tests/components/SceneTab tests/components/ChatPanel
```

- [ ] **6i. Commit (Tasks 5 + 6 together — see note at end of Task 5).**

```
git add frontend/src/lib/api.ts frontend/src/hooks/useChat.ts frontend/src/hooks/useScenes.ts \
        frontend/tests/hooks/useChat.test.tsx frontend/tests/hooks/useScenes.test.tsx \
        frontend/tests/components/SceneTab.test.tsx
git commit -m "[story-editor-up6] Tasks 5+6: frontend consumes shared Chat schemas + runtime parse"
```

---

## Task 7 — Final verify line + green sweep

Run the full bd verify command to confirm the close gate will pass.

- [ ] **7a. Run the verify line top to bottom.**

```
npm -w story-editor-shared run typecheck && npm -w story-editor-shared test && \
  npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck && \
  make dev && timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done' && \
  npm -w story-editor-backend test -- tests/routes/chat tests/repos/chat tests/lib/serialize tests/security/encryption-leak && \
  npm -w story-editor-frontend test -- tests/hooks/useChat tests/hooks/useScenes tests/components/SceneTab tests/components/ChatPanel
```

All green.

- [ ] **7b. Hand off to /bd-close-reviewed.** The bridge skill (`/bd-execute`) does this automatically — no manual step needed. The close gate runs the verify line above, typechecks affected workspaces, and fans `repo-boundary-reviewer` over the chat.repo.ts + chat.routes.ts diffs. `security-reviewer` is out-of-lane (no auth / crypto / Venice-key surface in this PR).

---

## Self-review

Run before handoff:

1. **Spec coverage.** Every Chat-touching surface listed in "File structure" → mapped to a task: ✅ shared (1), serialize (2), repo (3), routes (4), api.ts (5), hooks (6), test fixtures (6).
2. **Placeholder scan.** No TBD, no "similar to Task N", no inferred validation. ✅
3. **Type consistency.** `Chat` (POST/PATCH return), `ChatSummary` (LIST entries + cache shape), `ChatKind`, `ChatCreateInput`, `ChatUpdateInput` referenced consistently across tasks. ✅
4. **Wire-format truth.** POST/PATCH responses do NOT include `messageCount`; LIST entries do. Optimistic-cache writes synthesise `messageCount: 0`. ✅
5. **Test-fixture drift.** Explicit step in Task 6c strips `messageCount` from POST/PATCH mocks. Applies bd memory `when-migrating-an-entity-onto-shared-zod-schemas`. ✅
6. **Verify-line correctness.** Uses `typecheck`, not `build`, for shared. Orders `make dev && timeout 60 bash -c 'until docker compose exec -T postgres pg_isready -U storyeditor -d storyeditor >/dev/null 2>&1; do sleep 2; done'` before any backend-test step (bd memory `bd-verify-line-backend-test-needs-stack`). ✅
