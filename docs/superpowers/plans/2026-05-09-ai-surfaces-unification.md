# AI Surfaces Unification v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-09-ai-surfaces-unification-design.md`

**Goal:** Collapse Chat and Scene's parallel transcript implementations into one shared layer (streaming utility, draft store, transcript container, row primitives, row components) and add backend `deleteAllAfter` so retry has clean linear semantics.

**Architecture:** Backend gains one repo method (`deleteAllAfter`) that the retry route calls before regeneration. Frontend extracts a stateless streaming utility (`runStreamingAI`), reshapes the chat draft store to be keyed by chatId (cross-tab concurrent streaming), introduces shared row primitives + row components in `frontend/src/components/messageRow/`, and a render-prop `<TranscriptView>` container that owns scroll/autoscroll/session-reset/data-fetch/error-UX. Both ChatTab and SceneTab consume the same shared layer; banner-retry dispatch lives in a small `useBannerRetry` hook that refetches the messages query unconditionally and reads the cache's trailing-message role to choose between `{retry: true}` (trailing user — case B) and fresh send (trailing assistant or undefined — cases A/D/E + rapid-fire). Scene's transcript store + hook + candidate card delete entirely.

**Tech Stack:** Express + Prisma (backend), React 19 + Vite + TypeScript strict + TailwindCSS + TipTap + Zustand + TanStack Query 5 + Vitest + Testing Library + Storybook 9 (frontend).

**Issues closed by this PR:** `story-editor-a0s` (P1), `story-editor-y5v` (P3), `story-editor-a9v` (P3), `story-editor-458` (P2), `story-editor-7at` (P3).

---

## Files to Create / Modify

### Backend

**Modify:**
- `backend/src/repos/message.repo.ts` — add `deleteAllAfter(chatId, afterMessageId)`.
- `backend/src/routes/chat.routes.ts` — retry branch calls `deleteAllAfter(chatId, lastUserMsg.id)` before generating.
- `backend/tests/repos/message.repo.test.ts` (or equivalent) — add deleteAllAfter tests.
- `backend/tests/routes/chat.messages.test.ts` (or equivalent) — update retry tests; drop "two candidates persist" assertions; add "single trailing assistant after retry" assertions.

### Frontend — new files

**Create:**
- `frontend/src/lib/streamingAI.ts` — `runStreamingAI` utility.
- `frontend/tests/lib/streamingAI.test.ts` — utility tests.
- `frontend/src/hooks/useBannerRetry.ts` — banner-retry dispatch hook (cache-inspection routing).
- `frontend/tests/hooks/useBannerRetry.test.tsx` — four-case dispatch table.
- `frontend/src/components/messageRow/index.ts` — re-exports.
- `frontend/src/components/messageRow/primitives.tsx` — `<AssistantBubble>`, `<MessageMeta>`, `<MessageActions>`, `<CopyAction>`, `<RegenerateAction>`, `<InsertAtEndAction>`, `<CitationsSlot>`, `<ThinkingBubble>`.
- `frontend/src/components/messageRow/primitives.stories.tsx` — Storybook for each primitive.
- `frontend/tests/components/messageRow/primitives.test.tsx` — primitives tests.
- `frontend/src/components/messageRow/UserMessageRow.tsx` — shared user-message row.
- `frontend/src/components/messageRow/UserMessageRow.stories.tsx`.
- `frontend/tests/components/messageRow/UserMessageRow.test.tsx`.
- `frontend/src/components/messageRow/AssistantMessageRow.tsx` — shared assistant-message row.
- `frontend/src/components/messageRow/AssistantMessageRow.stories.tsx`.
- `frontend/tests/components/messageRow/AssistantMessageRow.test.tsx`.
- `frontend/src/components/messageRow/TranscriptView.tsx` — render-prop transcript container.
- `frontend/src/components/messageRow/TranscriptView.stories.tsx`.
- `frontend/tests/components/messageRow/TranscriptView.test.tsx`.
- `frontend/src/components/ChatEmptyState.tsx` — Chat-specific empty state element.
- `frontend/src/components/SceneEmptyState.tsx` — Scene-specific empty state element.

### Frontend — modify

- `frontend/src/store/chatDraft.ts` — refactor to keyed-by-chatId shape.
- `frontend/tests/store/chatDraft.test.tsx` (or equivalent) — keyed-slot isolation tests.
- `frontend/src/hooks/useChat.ts` — `useSendChatMessageMutation` uses `runStreamingAI`, calls keyed draft methods.
- `frontend/src/hooks/useAICompletion.ts` — uses `runStreamingAI`.
- `frontend/src/components/ChatTab.tsx` — replaces `<ChatMessages>` with `<TranscriptView>` + row components; banner-retry dispatch handler.
- `frontend/src/components/SceneTab.tsx` — replaces inline scroll/transcript with `<TranscriptView>` + row components; uses `useSendChatMessageMutation`; banner-retry dispatch handler.
- `frontend/src/lib/api.ts` — delete `streamMessage()` (lines 428-479) + the `StreamMessageBody`/`StreamMessageOpts` interfaces.
- `frontend/src/components/InlineErrorBanner.tsx` — add `disabled?: boolean` prop (passed through to its Retry button) if not already present. Used by `<TranscriptView>` to gate Retry during the banner-retry inspect window.

### Frontend — delete

- `frontend/src/components/ChatMessages.tsx` (and any stories/tests for it).
- `frontend/src/components/SceneCandidateCard.tsx` (and stories/tests).
- `frontend/src/hooks/useSceneTranscript.ts` (and tests).
- `frontend/src/store/sceneTranscript.ts` (and tests).

---

## Build sequence

Phases land as separate commits within the single PR. Each phase is testable on its own. Task numbers below match the bodies in the rest of this doc — Tasks 7 and 9 are deferred placeholders explaining historical revisions, not work; effective task count is **18**.

1. **Phase 1 — Backend retry change** (Tasks 1-3): `deleteAllAfter` repo method + route call + test updates. Backend ships independently green.
2. **Phase 2 — `runStreamingAI` utility** (Tasks 4-6): extract + migrate both consumers. No UX change. (Task 7 deferred — `streamMessage` deletion happens in Task 18 once Scene migration completes.)
3. **Phase 3 — Keyed draft store** (Task 8): `useChatDraftStore` shape change + mutation rewiring. (Task 9 was lastIdBefore tracking; removed entirely after spec review caught a stale-cache hole.)
4. **Phase 4 — Row primitives + row components** (Tasks 10-12): primitives, UserMessageRow, AssistantMessageRow.
5. **Phase 5 — `<TranscriptView>` container** (Task 13): autoscroll, session-reset, unified hydration error UX, merge logic.
6. **Phase 6 — Chat integration** (Tasks 14-15): ChatTab uses TranscriptView + rows; `useBannerRetry` hook with trailing-role dispatch.
7. **Phase 7 — Scene migration** (Tasks 16-17): SceneTab uses the shared layer; delete dead Scene code.
8. **Phase 8 — Cleanup** (Tasks 18-20): delete `streamMessage`, ChatMessages, ContextChip, final integration sweep + smoke.

---

# Phase 1 — Backend retry change

## Task 1: Add `MessageRepo.deleteAllAfter` repo method + tests

**Files:**
- Modify: `backend/src/repos/message.repo.ts`
- Modify: `backend/tests/repos/message.repo.test.ts` (or add a dedicated file if the existing one is already large)

**Context:** The retry route needs to delete every message in a chat whose ordering is "after" a reference message — strict `createdAt > ref.createdAt`, OR same-millisecond siblings with a different id. Reference message is preserved. Method enforces ownership through chat → chapter → story → userId chain (matching `findManyForChat`).

- [ ] **Step 1: Read existing repo to understand the ownership pattern**

```bash
grep -n "findManyForChat\|deleteMany\|deleteAll" backend/src/repos/message.repo.ts
```

Read the file fully. Note how `findManyForChat` filters by chatId AND walks chat→chapter→story→userId for ownership. Mirror that pattern.

- [ ] **Step 2: Write the failing test for the basic case (single trailing assistant)**

Append to `backend/tests/repos/message.repo.test.ts`:

```ts
describe('MessageRepo.deleteAllAfter', () => {
  it('deletes only rows whose createdAt > reference.createdAt', async () => {
    const { user, chapterId } = await createUserWithChapter();
    const repo = createMessageRepoForUser(user);
    const chatRepo = createChatRepoForUser(user);
    const chat = await chatRepo.create({ chapterId, kind: 'ask', title: null });

    const userMsg = await repo.create({
      chatId: chat.id,
      role: 'user',
      contentJson: 'first',
    });
    // Force later createdAt by sleeping 2ms (Prisma's createdAt has ms precision).
    await new Promise((r) => setTimeout(r, 2));
    const assistantMsg = await repo.create({
      chatId: chat.id,
      role: 'assistant',
      contentJson: 'reply',
    });

    const result = await repo.deleteAllAfter(chat.id, userMsg.id);

    expect(result.count).toBe(1);
    const remaining = await repo.findManyForChat(chat.id);
    expect(remaining.map((m) => m.id)).toEqual([userMsg.id]);
  });
});
```

(Adjust `createUserWithChapter`, `createMessageRepoForUser`, `createChatRepoForUser` to whatever the existing test harness uses — find an existing test in this file and mirror its setup.)

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && npx vitest run tests/repos/message.repo.test.ts -t deleteAllAfter
```

Expected: FAIL with "deleteAllAfter is not a function".

- [ ] **Step 4: Implement `deleteAllAfter` in the repo**

Open `backend/src/repos/message.repo.ts` and add the method following the existing factory pattern. The body uses `prisma.message.deleteMany` with the ownership chain in the where clause:

```ts
async deleteAllAfter(chatId: string, afterMessageId: string): Promise<{ count: number }> {
  const ref = await prisma.message.findFirst({
    where: {
      id: afterMessageId,
      chatId,
      chat: { chapter: { story: { userId } } },
    },
    select: { id: true, createdAt: true },
  });
  if (!ref) {
    return { count: 0 };
  }
  const result = await prisma.message.deleteMany({
    where: {
      chatId,
      chat: { chapter: { story: { userId } } },
      OR: [
        { createdAt: { gt: ref.createdAt } },
        { AND: [{ createdAt: ref.createdAt }, { id: { not: ref.id } }] },
      ],
    },
  });
  return { count: result.count };
}
```

(`userId` is captured in the repo factory closure — match the existing pattern for `findManyForChat`.)

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend && npx vitest run tests/repos/message.repo.test.ts -t deleteAllAfter
```

Expected: PASS.

- [ ] **Step 6: Add tests for the same-millisecond tiebreaker, no-op when ref missing, and ownership gating**

Append three more `it` blocks:

```ts
it('deletes same-millisecond sibling with different id', async () => {
  const { user, chapterId } = await createUserWithChapter();
  const repo = createMessageRepoForUser(user);
  const chatRepo = createChatRepoForUser(user);
  const chat = await chatRepo.create({ chapterId, kind: 'ask', title: null });

  // Two messages at exactly the same instant via raw SQL (Prisma normally
  // assigns now() per-row; we need to construct the collision case).
  const ts = new Date();
  const userMsg = await prisma.message.create({
    data: {
      chatId: chat.id,
      role: 'user',
      contentJson: 'u',
      createdAt: ts,
      updatedAt: ts,
    },
  });
  const assistantMsg = await prisma.message.create({
    data: {
      chatId: chat.id,
      role: 'assistant',
      contentJson: 'a',
      createdAt: ts, // same millisecond
      updatedAt: ts,
    },
  });

  const result = await repo.deleteAllAfter(chat.id, userMsg.id);

  expect(result.count).toBe(1);
  const remaining = await repo.findManyForChat(chat.id);
  expect(remaining.map((m) => m.id)).toEqual([userMsg.id]);
});

it('returns count 0 when reference message does not exist', async () => {
  const { user, chapterId } = await createUserWithChapter();
  const repo = createMessageRepoForUser(user);
  const chatRepo = createChatRepoForUser(user);
  const chat = await chatRepo.create({ chapterId, kind: 'ask', title: null });

  const result = await repo.deleteAllAfter(chat.id, 'nonexistent-id');
  expect(result.count).toBe(0);
});

it('does not delete messages from another user\'s chat', async () => {
  const { user: userA, chapterId: chapterAId } = await createUserWithChapter();
  const { user: userB, chapterId: chapterBId } = await createUserWithChapter();
  const repoA = createMessageRepoForUser(userA);
  const chatRepoB = createChatRepoForUser(userB);
  const chatB = await chatRepoB.create({ chapterId: chapterBId, kind: 'ask', title: null });
  const repoBviaB = createMessageRepoForUser(userB);
  const userMsgB = await repoBviaB.create({
    chatId: chatB.id,
    role: 'user',
    contentJson: 'b',
  });
  await new Promise((r) => setTimeout(r, 2));
  await repoBviaB.create({ chatId: chatB.id, role: 'assistant', contentJson: 'reply' });

  // userA's repo asked to delete after userMsgB — should be a no-op.
  const result = await repoA.deleteAllAfter(chatB.id, userMsgB.id);

  expect(result.count).toBe(0);
  const stillThere = await repoBviaB.findManyForChat(chatB.id);
  expect(stillThere.length).toBe(2);
});
```

- [ ] **Step 7: Run all four tests**

```bash
cd backend && npx vitest run tests/repos/message.repo.test.ts -t deleteAllAfter
```

Expected: 4 pass.

- [ ] **Step 8: Commit**

```bash
git add backend/src/repos/message.repo.ts backend/tests/repos/message.repo.test.ts
git commit -m "[ai-surfaces-v1] backend: add MessageRepo.deleteAllAfter (id-based, tiebreaker, ownership-gated)"
```

---

## Task 2: Wire `deleteAllAfter` into the retry branch

**Files:**
- Modify: `backend/src/routes/chat.routes.ts` (retry branch around lines 322-340 + the message-build region around 459-477)

**Context:** Per spec, the retry branch should call `deleteAllAfter(chatId, lastUserMsg.id)` BEFORE building the prompt. After this, history (loaded earlier as `priorMessages`) needs to be re-loaded so it doesn't contain the now-deleted trailing assistant. The simplest approach: keep priorMessages loaded once at the top, find lastUserMsg, call deleteAllAfter when retrying, then RE-FETCH priorMessages to rebuild history without the deleted rows. Validation stays strict (no changes to validation rules).

- [ ] **Step 1: Read the existing retry handling carefully**

```bash
sed -n '300,470p' backend/src/routes/chat.routes.ts
```

Note: `priorMessages` is loaded once at line ~325. `history` is built from priorMessages at line ~433. The retry branch's prompt uses `[systemMsg, ...history]`. After deletion, history must be re-loaded.

- [ ] **Step 2: Write a failing route test for the case-C deletion behavior**

Add to the chat retry test file (find via `grep -rl "retry: true" backend/tests/routes/`). Append:

```ts
it('on retry, deletes prior trailing assistant before regenerating (case C — linear retry)', async () => {
  const { agent, user, chapterId, modelId } = await setupChatRetryFixture();
  const chatRepo = createChatRepoForUser(user);
  const messageRepo = createMessageRepoForUser(user);
  const chat = await chatRepo.create({ chapterId, kind: 'ask', title: null });
  await messageRepo.create({ chatId: chat.id, role: 'user', contentJson: 'hello' });
  await messageRepo.create({
    chatId: chat.id,
    role: 'assistant',
    contentJson: 'first reply',
    model: modelId,
  });

  // Mock Venice to return a streamed "second reply".
  mockVeniceCompletion('second reply');

  const res = await agent
    .post(`/api/chats/${chat.id}/messages`)
    .send({ retry: true, modelId });

  expect(res.status).toBe(200);
  // Drain the SSE response to completion.
  await drainSse(res);

  const final = await messageRepo.findManyForChat(chat.id);
  // Exactly one user + one assistant; old assistant deleted.
  const assistants = final.filter((m) => m.role === 'assistant');
  expect(assistants.length).toBe(1);
  expect(assistants[0].contentJson).toBe('second reply');
});
```

(Adjust harness names to match existing file. `drainSse` should be a helper that reads SSE chunks until `[DONE]`.)

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && npx vitest run tests/routes/chat.messages.test.ts -t "case C"
```

Expected: FAIL — current behavior produces TWO assistant rows (old preserved + new appended).

- [ ] **Step 4: Modify the retry branch to call `deleteAllAfter` and re-fetch history**

In `backend/src/routes/chat.routes.ts`, find the retry validation block (around line 332, the `if (body.retry && !lastUserMsg)` check). After the validation, BEFORE the messages array is built (line 433), add:

```ts
// [ai-surfaces-v1] On retry, delete any trailing-after-lastUser rows
// (typically a prior assistant turn that this retry is replacing). Then
// re-fetch priorMessages so history is correct after deletion.
let priorMessagesForHistory = priorMessages;
if (body.retry && lastUserMsg) {
  await messageRepo.deleteAllAfter(chatId, lastUserMsg.id);
  priorMessagesForHistory = await messageRepo.findManyForChat(chatId);
}
```

Note: the existing code uses `messageRepo` later (line 467); to call it here we need it earlier. Hoist its construction up:

```ts
// At the top of the route handler, after line 325's priorMessages load:
const messageRepo = createMessageRepo(req);
```

And remove the original `const messageRepo = createMessageRepo(req);` line lower down.

Then update the line that builds `history`:

```ts
const history = priorMessagesForHistory.map((m) => {
  // ... existing mapping logic ...
});
```

- [ ] **Step 5: Run the case-C test**

```bash
cd backend && npx vitest run tests/routes/chat.messages.test.ts -t "case C"
```

Expected: PASS.

- [ ] **Step 6: Add a test for case B (mid-stream user persisted, no trailing assistant)**

Append:

```ts
it('on retry with no trailing assistant, generates cleanly with no deletions (case B)', async () => {
  const { agent, user, chapterId, modelId } = await setupChatRetryFixture();
  const chatRepo = createChatRepoForUser(user);
  const messageRepo = createMessageRepoForUser(user);
  const chat = await chatRepo.create({ chapterId, kind: 'ask', title: null });
  await messageRepo.create({ chatId: chat.id, role: 'user', contentJson: 'hello' });
  // No trailing assistant — simulates mid-stream-error scenario.

  mockVeniceCompletion('reply');

  const res = await agent
    .post(`/api/chats/${chat.id}/messages`)
    .send({ retry: true, modelId });

  expect(res.status).toBe(200);
  await drainSse(res);

  const final = await messageRepo.findManyForChat(chat.id);
  expect(final.length).toBe(2); // user + new assistant
  expect(final[1].role).toBe('assistant');
  expect(final[1].contentJson).toBe('reply');
});
```

- [ ] **Step 7: Run case B**

```bash
cd backend && npx vitest run tests/routes/chat.messages.test.ts -t "case B"
```

Expected: PASS.

- [ ] **Step 8: Run the full chat retry test suite to confirm nothing broke**

```bash
cd backend && npx vitest run tests/routes/chat.messages.test.ts
```

Expected: All pass except the pre-existing tests asserting "two candidates persist after retry" — those fail because they exercised the old append-on-retry behavior. Task 3 fixes those.

- [ ] **Step 9: Commit**

```bash
git add backend/src/routes/chat.routes.ts backend/tests/routes/chat.messages.test.ts
git commit -m "[ai-surfaces-v1] backend: retry branch deletes trailing-after-lastUser before regenerating"
```

---

## Task 3: Update existing retry tests for linear semantics

**Files:**
- Modify: `backend/tests/routes/chat.messages.test.ts` (and any other backend test files asserting "two candidates persist")

**Context:** Existing tests written for Scene's parallel-candidate semantics now assert wrong behavior. Find them and rewrite to assert linear-replace semantics (only the new assistant survives).

- [ ] **Step 1: Find tests asserting parallel candidates**

```bash
grep -rn "candidates\.length\|assistantCount.*2\|toHaveLength(2)" backend/tests/routes/ | grep -i "retry\|scene"
```

Read each match in context. Identify which assert "after retry, both old + new exist" — these need rewriting.

- [ ] **Step 2: Rewrite each affected test**

For each test (specifics depend on what's there), change assertions like:

```ts
// Before:
const assistants = messages.filter((m) => m.role === 'assistant');
expect(assistants.length).toBe(2); // old + new candidates
```

To:

```ts
// After:
const assistants = messages.filter((m) => m.role === 'assistant');
expect(assistants.length).toBe(1); // linear retry: only new survives
expect(assistants[0].contentJson).toBe('<expected new content>');
```

- [ ] **Step 3: Run the full backend test suite**

```bash
cd backend && npm test
```

Expected: All pass. (If the encryption leak test [E12] runs as part of `npm test`, it should also pass — `deleteAllAfter` operates on narrative columns but doesn't expose plaintext.)

- [ ] **Step 4: Run typecheck**

```bash
cd backend && npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/
git commit -m "[ai-surfaces-v1] backend: update retry tests for linear (single-trailing-assistant) semantics"
```

---

# Phase 2 — `runStreamingAI` utility

## Task 4: Implement `runStreamingAI` utility with tests

**Files:**
- Create: `frontend/src/lib/streamingAI.ts`
- Create: `frontend/tests/lib/streamingAI.test.ts`

**Context:** Stateless utility that owns the SSE wire-protocol heavy lifting. Both `useSendChatMessageMutation` and `useAICompletion` will consume it. The utility throws `ApiError(502, message, code)` on error events; consumers extract `code` from the catch via `(err as ApiError).code` (invariant #2 in the spec).

- [ ] **Step 1: Read existing `apiStream` and `parseAiSseStream` to understand their contracts**

```bash
sed -n '1,50p' frontend/src/lib/sse.ts
grep -n "export.*apiStream\|export.*ApiError" frontend/src/lib/api.ts
```

Note: `apiStream` returns a `Response` and may throw. `parseAiSseStream(body, signal)` is an async iterator yielding `{type: 'chunk', chunk}` | `{type: 'citations', citations}` | `{type: 'error', error}` | `{type: 'done'}`. `ApiError(status, message, code)` constructor takes those three args.

- [ ] **Step 2: Write failing tests for `runStreamingAI`**

Create `frontend/tests/lib/streamingAI.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runStreamingAI } from '@/lib/streamingAI';
import { ApiError } from '@/lib/api';

// Mock apiStream to control the Response we feed in.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    apiStream: vi.fn(),
  };
});

import { apiStream } from '@/lib/api';

function makeSseResponse(events: string[], extraHeaders: Record<string, string> = {}): Response {
  const body = events.join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...extraHeaders },
  });
}

describe('runStreamingAI', () => {
  beforeEach(() => {
    vi.mocked(apiStream).mockReset();
  });

  it('forwards chunk deltas via onChunk', async () => {
    const chunks: string[] = [];
    vi.mocked(apiStream).mockResolvedValue(
      makeSseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'world' } }] })}\n\n`,
      ]),
    );
    await runStreamingAI({
      endpoint: '/test',
      body: {},
      signal: new AbortController().signal,
      onChunk: (d) => chunks.push(d),
    });
    expect(chunks).toEqual(['Hello ', 'world']);
  });

  it('forwards citations via onCitations when provided', async () => {
    const seen: unknown[] = [];
    vi.mocked(apiStream).mockResolvedValue(
      makeSseResponse([
        `event: citations\ndata: ${JSON.stringify([{ url: 'https://x', title: 'X' }])}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`,
      ]),
    );
    await runStreamingAI({
      endpoint: '/test',
      body: {},
      signal: new AbortController().signal,
      onChunk: () => {},
      onCitations: (c) => seen.push(c),
    });
    expect(seen).toHaveLength(1);
    expect(Array.isArray(seen[0])).toBe(true);
  });

  it('throws ApiError(502, message, code) on error event with code preserved', async () => {
    vi.mocked(apiStream).mockResolvedValue(
      makeSseResponse([
        `event: error\ndata: ${JSON.stringify({ error: 'boom', code: 'rate_limited' })}\n\n`,
      ]),
    );
    await expect(
      runStreamingAI({
        endpoint: '/test',
        body: {},
        signal: new AbortController().signal,
        onChunk: () => {},
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'boom',
      code: 'rate_limited',
    });
  });

  it('throws ApiError(502, "Empty response body") when res.body is null', async () => {
    vi.mocked(apiStream).mockResolvedValue(
      new Response(null, { status: 200 }) as unknown as Response,
    );
    await expect(
      runStreamingAI({
        endpoint: '/test',
        body: {},
        signal: new AbortController().signal,
        onChunk: () => {},
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('calls onResponseHeaders with the Response before reading body', async () => {
    let capturedHeaders: Headers | null = null;
    vi.mocked(apiStream).mockResolvedValue(
      makeSseResponse([], { 'x-test': 'value' }),
    );
    await runStreamingAI({
      endpoint: '/test',
      body: {},
      signal: new AbortController().signal,
      onChunk: () => {},
      onResponseHeaders: (res) => {
        capturedHeaders = res.headers;
      },
    });
    expect(capturedHeaders?.get('x-test')).toBe('value');
  });

  it('resolves when stream exhausts without explicit [DONE]', async () => {
    vi.mocked(apiStream).mockResolvedValue(
      new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    await expect(
      runStreamingAI({
        endpoint: '/test',
        body: {},
        signal: new AbortController().signal,
        onChunk: () => {},
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail (file doesn't exist yet)**

```bash
cd frontend && npx vitest run tests/lib/streamingAI.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `runStreamingAI`**

Create `frontend/src/lib/streamingAI.ts`:

```ts
import { ApiError, apiStream } from '@/lib/api';
import { type Citation } from '@/lib/citations';
import { parseAiSseStream } from '@/lib/sse';

export interface StreamingAIOptions {
  endpoint: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
  onChunk: (delta: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onResponseHeaders?: (res: Response) => void;
}

/**
 * Run an SSE-streaming AI request. Stateless; consumers own AbortController,
 * state machine, error publication, and re-entrancy. The utility owns wire-
 * protocol heavy lifting only: open, read, dispatch events, throw on error.
 *
 * Error contract: SSE error frames throw `ApiError(502, message, code)`;
 * consumers extract `code` from `(err as ApiError).code` in their catch.
 */
export async function runStreamingAI(opts: StreamingAIOptions): Promise<void> {
  const res = await apiStream(opts.endpoint, {
    method: 'POST',
    body: opts.body,
    signal: opts.signal,
  });
  if (opts.onResponseHeaders) opts.onResponseHeaders(res);
  if (!res.body) {
    throw new ApiError(502, 'Empty response body');
  }
  for await (const event of parseAiSseStream(res.body, opts.signal)) {
    if (event.type === 'chunk') {
      const delta = event.chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        opts.onChunk(delta);
      }
    } else if (event.type === 'citations') {
      if (opts.onCitations) opts.onCitations(event.citations);
    } else if (event.type === 'error') {
      throw new ApiError(
        502,
        event.error.error,
        event.error.code ?? 'stream_error',
      );
    } else if (event.type === 'done') {
      return;
    }
  }
  // Stream exhausted without [DONE] — treat as completion.
}
```

- [ ] **Step 5: Run the tests**

```bash
cd frontend && npx vitest run tests/lib/streamingAI.test.ts
```

Expected: All 6 pass.

- [ ] **Step 6: Run typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/streamingAI.ts frontend/tests/lib/streamingAI.test.ts
git commit -m "[ai-surfaces-v1] frontend: add runStreamingAI utility (consolidates SSE wire-protocol)"
```

---

## Task 5: Migrate `useSendChatMessageMutation` to use `runStreamingAI`

**Files:**
- Modify: `frontend/src/hooks/useChat.ts` (the `mutationFn` at lines ~241-313)

**Context:** Replace the inline `apiStream` + for-await SSE loop with a call to `runStreamingAI`. Preserve the existing draft-store wiring (`appendDelta`, `markStreaming`, `markDone`, `markError`, `clear`) and the AbortController pattern. The keyed-store refactor happens in Task 8 — for now, draft methods still take their current single-slot signatures.

The error-code propagation invariant (#2 in the spec) is the load-bearing detail: `markError({code, message})` must receive the SSE error frame's `code`, which now comes out of `(err as ApiError).code` rather than `event.error.code` directly.

- [ ] **Step 1: Read the current `mutationFn`**

```bash
sed -n '230,320p' frontend/src/hooks/useChat.ts
```

Note the existing `firstChunkSeen` flag (used to call `markStreaming()` once on first chunk), the AbortError handling, and the `clear()`-before-invalidate ordering in `onSuccess`.

- [ ] **Step 2: Confirm existing tests pass**

```bash
cd frontend && npx vitest run tests/hooks/useChat.test.tsx
```

Expected: Existing tests pass.

- [ ] **Step 3: Replace the SSE loop body in `mutationFn`**

Replace the body of `mutationFn` (everything from `const controller = new AbortController()` through the final `}` of the function) with:

```ts
mutationFn: async ({ chatId, content, modelId, retry, attachment, enableWebSearch }) => {
  const controller = new AbortController();
  abortRef.current = controller;

  const body: Record<string, unknown> = { modelId };
  if (content !== undefined) body.content = content;
  if (retry === true) body.retry = true;
  if (attachment) body.attachment = attachment;
  if (enableWebSearch === true) body.enableWebSearch = true;

  let firstChunkSeen = false;
  try {
    await runStreamingAI({
      endpoint: `/chats/${encodeURIComponent(chatId)}/messages`,
      body,
      signal: controller.signal,
      onChunk: (delta) => {
        if (!firstChunkSeen) {
          firstChunkSeen = true;
          useChatDraftStore.getState().markStreaming();
        }
        useChatDraftStore.getState().appendDelta(delta);
      },
      // citations forwarded but ignored — refetched message carries citationsJson.
    });
    useChatDraftStore.getState().markDone();
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      useChatDraftStore.getState().clear();
      return;
    }
    const message = err instanceof Error ? err.message : 'Chat send failed';
    const code = err instanceof ApiError ? (err.code ?? null) : null;
    useChatDraftStore.getState().markError({ code, message });
    throw err;
  } finally {
    if (abortRef.current === controller) abortRef.current = null;
  }
},
```

Add the import at the top of the file:

```ts
import { runStreamingAI } from '@/lib/streamingAI';
```

Remove unused symbols from the existing imports — DO NOT delete the import lines themselves. `useChat.ts` imports several things from `@/lib/api` (e.g. `ApiError`, `api`, `ChatRow`, `deleteChat`) that other functions in the file still need. Just drop `apiStream` from the named-import destructure (and `parseAiSseStream` from the `@/lib/sse` import; if it was the only named import from that module, the whole line goes). Run `npm run typecheck` after — TypeScript flags any unused imports that need cleanup.

- [ ] **Step 4: Run the chat hook tests**

```bash
cd frontend && npx vitest run tests/hooks/useChat.test.tsx
```

Expected: All pass. The mid-stream error test should still mark the draft with the same code as before (now via the thrown ApiError).

- [ ] **Step 5: Run typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: No errors. If `apiStream` or `parseAiSseStream` are now unused in the file, remove the imports.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useChat.ts
git commit -m "[ai-surfaces-v1] frontend: useSendChatMessageMutation consumes runStreamingAI"
```

---

## Task 6: Migrate `useAICompletion` to use `runStreamingAI`

**Files:**
- Modify: `frontend/src/hooks/useAICompletion.ts` (the `run` function at lines ~111-256)

**Context:** Same shape as Task 5 — replace inline SSE loop with `runStreamingAI` call. Preserve: rate-limit header harvest (`onResponseHeaders`), `safeSetState`-wrapped state mutations, `usage` snapshot preservation when headers absent, global `useErrorStore` publication, `mountedRef`/unmount handling. The `parseIntHeader` helper stays.

- [ ] **Step 1: Read the current `run` function**

```bash
sed -n '111,256p' frontend/src/hooks/useAICompletion.ts
```

Note: `usage` field preservation when headers absent (line 181-186), `safeSetState` wrapping, `publish(err)` for global error store, the `prev.status === 'thinking' ? 'streaming' : prev.status` flip on first chunk.

- [ ] **Step 2: Replace `run`'s body**

Find the `run` callback inside `useAICompletion`. Replace the body from `controllerRef.current?.abort()` (top) down through the `finally { ... }` (bottom) with:

```ts
const run = useCallback(
  async (args: RunArgs): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    safeSetState((prev) => ({
      status: 'thinking',
      text: '',
      error: null,
      usage: prev.usage,
    }));

    const publish = (err: ApiError): void => {
      useErrorStore.getState().push({
        severity: 'error',
        source: 'ai.complete',
        code: err.code ?? null,
        message: err.message,
        httpStatus: err.status,
        detail: err,
      });
    };

    const body: Record<string, unknown> = {
      action: args.action,
      selectedText: args.selectedText,
      chapterId: args.chapterId,
      storyId: args.storyId,
      modelId: args.modelId,
    };
    if (args.freeformInstruction !== undefined) {
      body.freeformInstruction = args.freeformInstruction;
    }
    if (args.enableWebSearch !== undefined) {
      body.enableWebSearch = args.enableWebSearch;
    }

    try {
      await runStreamingAI({
        endpoint: '/ai/complete',
        body,
        signal: controller.signal,
        onChunk: (delta) => {
          safeSetState((prev) => ({
            ...prev,
            status: prev.status === 'thinking' ? 'streaming' : prev.status,
            text: prev.text + delta,
          }));
        },
        // Inline-AI doesn't render citations — opt-out by omitting onCitations.
        onResponseHeaders: (res) => {
          const remainingRequests = parseIntHeader(res.headers.get('x-venice-remaining-requests'));
          const remainingTokens = parseIntHeader(res.headers.get('x-venice-remaining-tokens'));
          if (remainingRequests !== null || remainingTokens !== null) {
            safeSetState((prev) => ({
              ...prev,
              usage: { remainingRequests, remainingTokens },
            }));
          }
        },
      });
      // Stream completed normally.
      safeSetState((prev) =>
        prev.status === 'error' ? prev : { ...prev, status: 'done' },
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      const apiErr =
        err instanceof ApiError
          ? err
          : new ApiError(
              0,
              err instanceof Error ? err.message : 'Request failed',
            );
      safeSetState((prev) => ({
        status: 'error',
        text: prev.text,
        error: apiErr,
        usage: prev.usage,
      }));
      publish(apiErr);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  },
  [safeSetState],
);
```

Add the import:

```ts
import { runStreamingAI } from '@/lib/streamingAI';
```

Remove now-unused imports: `apiStream`, `parseAiSseStream` (verify with typecheck).

- [ ] **Step 3: Run useAICompletion tests**

```bash
cd frontend && npx vitest run tests/hooks/useAICompletion.test.tsx
```

Expected: All pass. Header harvest, error publication, usage preservation should all behave the same as before.

- [ ] **Step 4: Run typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useAICompletion.ts
git commit -m "[ai-surfaces-v1] frontend: useAICompletion consumes runStreamingAI (preserves header harvest + global error publish)"
```

---

> **(`streamMessage` deletion deferred to Task 18.)** Scene's `useSceneTranscript` is the only caller; deleting the function here would break Scene until Phase 7. Phase 2 ends at Task 6.

---

# Phase 3 — Keyed draft store

## Task 8: Refactor `useChatDraftStore` to keyed-by-chatId shape

**Files:**
- Modify: `frontend/src/store/chatDraft.ts`
- Create: `frontend/tests/store/chatDraft.test.tsx` (or modify existing if present)

**Context:** Spec section "Cross-tab streaming concurrency" — both Chat and Scene will write to this store after unification, and a single `draft: ChatDraft | null` slot would let one tab's writes clobber the other. Reshape to `drafts: Record<string, ChatDraft>` with chatId-keyed methods.

- [ ] **Step 1: Confirm current shape and find all call sites**

```bash
cat frontend/src/store/chatDraft.ts
grep -rn "useChatDraftStore\|chatDraft" frontend/src/ frontend/tests/ | grep -v "\.snap"
```

Note all call sites — they'll need updating. Expect: `useChat.ts` (mutationFn), `ChatMessages.tsx` (DraftPair render), tests.

- [ ] **Step 2: Write failing tests for keyed-slot isolation**

Create `frontend/tests/store/chatDraft.test.tsx`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useChatDraftStore } from '@/store/chatDraft';

describe('useChatDraftStore (keyed by chatId)', () => {
  beforeEach(() => {
    // Reset by clearing all known slots used in tests.
    useChatDraftStore.setState({ drafts: {} });
  });

  it('start() creates a slot scoped to chatId', () => {
    useChatDraftStore.getState().start({
      chatId: 'chat-1',
      userContent: 'hello',
      attachment: null,
    });
    const drafts = useChatDraftStore.getState().drafts;
    expect(drafts['chat-1']).toMatchObject({
      chatId: 'chat-1',
      userContent: 'hello',
      status: 'thinking',
    });
    expect(drafts['chat-2']).toBeUndefined();
  });

  it('appendDelta(chatId, ...) only mutates that slot', () => {
    useChatDraftStore.getState().start({ chatId: 'chat-1', userContent: 'a', attachment: null });
    useChatDraftStore.getState().start({ chatId: 'chat-2', userContent: 'b', attachment: null });
    useChatDraftStore.getState().appendDelta('chat-1', 'Hello ');
    useChatDraftStore.getState().appendDelta('chat-1', 'world');
    const drafts = useChatDraftStore.getState().drafts;
    expect(drafts['chat-1'].assistantText).toBe('Hello world');
    expect(drafts['chat-2'].assistantText).toBe('');
  });

  it('clear(chatId) removes that slot only', () => {
    useChatDraftStore.getState().start({ chatId: 'chat-1', userContent: 'a', attachment: null });
    useChatDraftStore.getState().start({ chatId: 'chat-2', userContent: 'b', attachment: null });
    useChatDraftStore.getState().clear('chat-1');
    const drafts = useChatDraftStore.getState().drafts;
    expect(drafts['chat-1']).toBeUndefined();
    expect(drafts['chat-2']).toBeDefined();
  });

  it('markError(chatId, ...) sets error on that slot only', () => {
    useChatDraftStore.getState().start({ chatId: 'chat-1', userContent: 'a', attachment: null });
    useChatDraftStore.getState().start({ chatId: 'chat-2', userContent: 'b', attachment: null });
    useChatDraftStore.getState().markError('chat-1', { code: 'rate_limited', message: 'oops' });
    const drafts = useChatDraftStore.getState().drafts;
    expect(drafts['chat-1'].status).toBe('error');
    expect(drafts['chat-1'].error).toEqual({ code: 'rate_limited', message: 'oops' });
    expect(drafts['chat-2'].status).toBe('thinking');
    expect(drafts['chat-2'].error).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd frontend && npx vitest run tests/store/chatDraft.test.tsx
```

Expected: FAIL — current store has single-slot shape.

- [ ] **Step 4: Refactor the store**

Replace `frontend/src/store/chatDraft.ts` with:

```ts
import { create } from 'zustand';

export type ChatDraftStatus = 'thinking' | 'streaming' | 'done' | 'error';

export interface ChatDraftError {
  code: string | null;
  message: string;
  httpStatus?: number;
}

export interface ChatDraftAttachment {
  selectionText: string;
  chapterId: string;
}

export interface ChatDraft {
  chatId: string;
  userContent: string;
  attachment: ChatDraftAttachment | null;
  assistantText: string;
  status: ChatDraftStatus;
  error: ChatDraftError | null;
}

interface ChatDraftState {
  drafts: Record<string, ChatDraft>;
  start: (args: {
    chatId: string;
    userContent: string;
    attachment: ChatDraftAttachment | null;
  }) => void;
  appendDelta: (chatId: string, delta: string) => void;
  markStreaming: (chatId: string) => void;
  markDone: (chatId: string) => void;
  markError: (chatId: string, error: ChatDraftError) => void;
  clear: (chatId: string) => void;
}

export const useChatDraftStore = create<ChatDraftState>((set) => ({
  drafts: {},
  start: ({ chatId, userContent, attachment }) =>
    set((s) => ({
      drafts: {
        ...s.drafts,
        [chatId]: {
          chatId,
          userContent,
          attachment,
          assistantText: '',
          status: 'thinking',
          error: null,
        },
      },
    })),
  appendDelta: (chatId, delta) =>
    set((s) => {
      const cur = s.drafts[chatId];
      if (!cur) return s;
      return {
        drafts: {
          ...s.drafts,
          [chatId]: { ...cur, assistantText: cur.assistantText + delta },
        },
      };
    }),
  markStreaming: (chatId) =>
    set((s) => {
      const cur = s.drafts[chatId];
      if (!cur) return s;
      return { drafts: { ...s.drafts, [chatId]: { ...cur, status: 'streaming' } } };
    }),
  markDone: (chatId) =>
    set((s) => {
      const cur = s.drafts[chatId];
      if (!cur) return s;
      return { drafts: { ...s.drafts, [chatId]: { ...cur, status: 'done' } } };
    }),
  markError: (chatId, error) =>
    set((s) => {
      const cur = s.drafts[chatId];
      if (!cur) return s;
      return {
        drafts: {
          ...s.drafts,
          [chatId]: { ...cur, status: 'error', error },
        },
      };
    }),
  clear: (chatId) =>
    set((s) => {
      const next = { ...s.drafts };
      delete next[chatId];
      return { drafts: next };
    }),
}));
```

- [ ] **Step 5: Run the keyed-slot tests**

```bash
cd frontend && npx vitest run tests/store/chatDraft.test.tsx
```

Expected: All 4 pass.

- [ ] **Step 6: Update all call sites that referenced the old API**

Run typecheck to find every call site that broke:

```bash
cd frontend && npm run typecheck
```

Expected: errors at every site that called `start({...})`, `appendDelta(d)`, `markStreaming()`, `markDone()`, `markError(e)`, `clear()` — they all need the chatId arg now (except `start` which had it as part of the args object).

Fix each in turn:
- `frontend/src/hooks/useChat.ts` (mutationFn): every `useChatDraftStore.getState().X(...)` call gets `chatId` as the first arg (chatId is in scope from the destructure). Pre-existing code passes `chatId` to `start({chatId, ...})` already; the others (`appendDelta`, `markStreaming`, `markDone`, `markError`, `clear`) need it. Also the `onSettled` and `onSuccess` blocks need `chatId` from `vars`.
- `frontend/src/components/ChatMessages.tsx` (DraftPair render): replace `s.draft` selector with `s.drafts[chatId ?? '']`. (This component is going away in Phase 8 anyway — for now, keep it limping.)

For `useChat.ts`, the `onSuccess` change:

```ts
onSuccess: (_void, vars) => {
  useChatDraftStore.getState().clear(vars.chatId);
  void qc.invalidateQueries({ queryKey: chatMessagesQueryKey(vars.chatId) });
},
onSettled: (_void, _err, vars) => {
  const status = useChatDraftStore.getState().drafts[vars.chatId]?.status;
  if (status === 'error') return;
  useChatDraftStore.getState().clear(vars.chatId);
},
```

For `ChatMessages.tsx` DraftPair selector (temporary; this file is going away):

```ts
const draft = useChatDraftStore((s) => (chatId !== null ? s.drafts[chatId] ?? null : null));
const draftForThisChat = draft;
```

- [ ] **Step 7: Run typecheck again**

```bash
cd frontend && npm run typecheck
```

Expected: No errors.

- [ ] **Step 8: Run the chat hook tests + chat messages tests**

```bash
cd frontend && npx vitest run tests/hooks/useChat.test.tsx tests/components/ChatMessages.test.tsx
```

Expected: All pass. (If a test had `s.draft` directly, update it to `s.drafts[chatId]`.)

- [ ] **Step 9: Run the full frontend test suite to catch any other reference**

```bash
cd frontend && npm test
```

Expected: All pass.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/store/chatDraft.ts frontend/src/hooks/useChat.ts frontend/src/components/ChatMessages.tsx frontend/tests/store/chatDraft.test.tsx
git commit -m "[ai-surfaces-v1] frontend: useChatDraftStore keyed by chatId (cross-tab concurrent streaming)"
```

---

> **(Task 9 deferred and ultimately removed.)** An earlier draft of this plan added `lastIdBefore` tracking to the mutation hook (capturing the trailing message id at `onMutate` time, used by banner-retry dispatch to detect whether a new user message had persisted). Spec review caught a stale-cache hole: under rapid-fire send-after-success, the captured value pointed at the trailing message from BEFORE the prior successful send (because the post-success refetch hadn't landed yet). Banner-retry would then false-positive case B, deleting the prior good assistant. The trailing-role dispatch (Task 14, formerly Task 15) doesn't need this ref — the cache's trailing-message role after refetch is the authoritative signal.

---

# Phase 4 — Row primitives + components

## Task 10: Create `messageRow/` directory + small primitives + tests + stories

**Files:**
- Create: `frontend/src/components/messageRow/index.ts`
- Create: `frontend/src/components/messageRow/primitives.tsx`
- Create: `frontend/src/components/messageRow/primitives.stories.tsx`
- Create: `frontend/tests/components/messageRow/primitives.test.tsx`

**Context:** Spec section "Frontend — per-message rows" lists eight primitives. They're individually small (5-30 lines each); one file is appropriate. Each primitive accepts `disabled?: boolean` where it makes sense. `<MessageMeta>` resolves model id → display name internally via `useModelsQuery`.

- [ ] **Step 1: Create the directory + index file**

```bash
mkdir -p frontend/src/components/messageRow
```

Create `frontend/src/components/messageRow/index.ts`:

```ts
export {
  AssistantBubble,
  CitationsSlot,
  CopyAction,
  InsertAtEndAction,
  MessageActions,
  MessageMeta,
  RegenerateAction,
  ThinkingBubble,
} from './primitives';
export { AssistantMessageRow } from './AssistantMessageRow';
export { UserMessageRow } from './UserMessageRow';
export { TranscriptView } from './TranscriptView';
export type { TranscriptRow, TranscriptViewProps } from './TranscriptView';
```

(Stub re-exports for components added in later tasks. Will fail typecheck until those land — that's expected; the index is the manifest, components fill in.)

- [ ] **Step 2: Write `primitives.tsx`**

```tsx
import { type JSX, type ReactNode } from 'react';
import { ThinkingDots } from '@/design/ThinkingDots';
import { useModelsQuery } from '@/hooks/useModels';
import { MessageCitations } from '@/components/MessageCitations';
import { type Citation } from '@/lib/citations';

/* ---------------- AssistantBubble ---------------- */

export interface AssistantBubbleProps {
  children: ReactNode;
}

export function AssistantBubble({ children }: AssistantBubbleProps): JSX.Element {
  return (
    <div className="pl-3 border-l-2 border-[var(--ai)] font-serif text-[13.5px] leading-[1.55] text-ink whitespace-pre-wrap max-w-full">
      {children}
    </div>
  );
}

/* ---------------- ThinkingBubble ---------------- */

export interface ThinkingBubbleProps {
  label?: string;
}

export function ThinkingBubble({ label }: ThinkingBubbleProps): JSX.Element {
  return (
    <div className="pl-3 border-l-2 border-[var(--ai)] py-1">
      <ThinkingDots {...(label !== undefined ? { label } : {})} />
    </div>
  );
}

/* ---------------- MessageMeta ---------------- */

export interface MessageMetaProps {
  model: string | null;
  tokens: number | null;
  latencyMs: number | null;
}

/**
 * Renders the meta row under an assistant message: model name (resolved
 * from id via useModelsQuery), tokens count, latency. Hidden parts skip
 * cleanly so the row only shows what's available.
 */
export function MessageMeta({ model, tokens, latencyMs }: MessageMetaProps): JSX.Element | null {
  const { data: models } = useModelsQuery();
  const displayName =
    model !== null && models
      ? (models.find((m) => m.id === model)?.name ?? model)
      : null;
  const showStats = tokens !== null && latencyMs !== null;
  if (!displayName && !showStats) return null;
  return (
    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-ink-4 font-mono">
      {displayName !== null && <span>{displayName}</span>}
      {showStats ? (
        <span>
          {`${String(tokens ?? 0)} tok · ${((latencyMs ?? 0) / 1000).toFixed(1)}s`}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------- MessageActions ---------------- */

export interface MessageActionsProps {
  children: ReactNode;
}

export function MessageActions({ children }: MessageActionsProps): JSX.Element {
  return (
    <div className="flex items-center gap-1 mt-1.5 text-[12px]">{children}</div>
  );
}

/* ---------------- CopyAction ---------------- */

export interface CopyActionProps {
  onClick: () => void;
  disabled?: boolean;
}

function CopyIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CopyAction({ onClick, disabled }: CopyActionProps): JSX.Element {
  return (
    <button
      type="button"
      className="px-2 py-1 rounded-[var(--radius)] text-ink-2 hover:bg-surface-hover inline-flex items-center gap-1 transition-colors disabled:opacity-60"
      aria-label="Copy"
      title="Copy"
      onClick={onClick}
      {...(disabled ? { disabled: true } : {})}
    >
      <CopyIcon />
    </button>
  );
}

/* ---------------- RegenerateAction ---------------- */

export interface RegenerateActionProps {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}

function RegenerateIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function RegenerateAction({
  onClick,
  disabled,
  label = 'Regenerate',
}: RegenerateActionProps): JSX.Element {
  return (
    <button
      type="button"
      className="px-2 py-1 rounded-[var(--radius)] text-ink-2 hover:bg-surface-hover inline-flex items-center gap-1 transition-colors disabled:opacity-60"
      aria-label={label}
      title={label}
      onClick={onClick}
      {...(disabled ? { disabled: true } : {})}
    >
      <RegenerateIcon />
    </button>
  );
}

/* ---------------- InsertAtEndAction ---------------- */

export interface InsertAtEndActionProps {
  onClick: () => void;
  disabled?: boolean;
}

export function InsertAtEndAction({
  onClick,
  disabled,
}: InsertAtEndActionProps): JSX.Element {
  return (
    <button
      type="button"
      className="px-2 py-1 rounded-[var(--radius)] text-[var(--ai)] border border-[var(--ai)] hover:bg-[var(--ai-soft)] transition-colors disabled:opacity-60"
      onClick={onClick}
      {...(disabled ? { disabled: true } : {})}
    >
      Insert at end
    </button>
  );
}

/* ---------------- CitationsSlot ---------------- */

export interface CitationsSlotProps {
  citations: Citation[] | null;
  messageId: string;
}

/**
 * Wraps MessageCitations in a stable mount-point slot (per F50 contract:
 * the slot exists for every assistant bubble; MessageCitations returns
 * null when there are no citations).
 */
export function CitationsSlot({ citations, messageId }: CitationsSlotProps): JSX.Element {
  return (
    <div data-citations-slot data-message-id={messageId}>
      <MessageCitations citations={citations} />
    </div>
  );
}
```

- [ ] **Step 3: Write tests for the primitives**

Create `frontend/tests/components/messageRow/primitives.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AssistantBubble,
  CitationsSlot,
  CopyAction,
  InsertAtEndAction,
  MessageActions,
  MessageMeta,
  RegenerateAction,
  ThinkingBubble,
} from '@/components/messageRow/primitives';

function withQc(node: React.ReactNode, opts: { models?: { id: string; name: string }[] } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (opts.models) {
    qc.setQueryData(['models'], opts.models);
  }
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('AssistantBubble', () => {
  it('renders content with the AI border-left class', () => {
    const { container } = withQc(<AssistantBubble>hello</AssistantBubble>);
    const div = container.querySelector('div');
    expect(div?.className).toContain('border-l-2');
    expect(div?.textContent).toBe('hello');
  });
});

describe('ThinkingBubble', () => {
  it('renders default ThinkingDots without label', () => {
    withQc(<ThinkingBubble />);
    expect(screen.queryByText(/Generating/)).toBeNull();
  });

  it('renders with custom label', () => {
    withQc(<ThinkingBubble label="Generating scene…" />);
    expect(screen.getByText('Generating scene…')).toBeInTheDocument();
  });
});

describe('MessageMeta', () => {
  it('renders model name resolved from useModelsQuery', () => {
    withQc(<MessageMeta model="venice-test" tokens={null} latencyMs={null} />, {
      models: [{ id: 'venice-test', name: 'Venice Test 70B' }],
    });
    expect(screen.getByText('Venice Test 70B')).toBeInTheDocument();
  });

  it('falls back to model id when models query has no match', () => {
    withQc(<MessageMeta model="unknown-model" tokens={null} latencyMs={null} />, {
      models: [],
    });
    expect(screen.getByText('unknown-model')).toBeInTheDocument();
  });

  it('renders tokens · latency when both present', () => {
    withQc(
      <MessageMeta model="m" tokens={412} latencyMs={1800} />,
      { models: [{ id: 'm', name: 'M' }] },
    );
    expect(screen.getByText('412 tok · 1.8s')).toBeInTheDocument();
  });

  it('renders nothing if no model and no stats', () => {
    const { container } = withQc(<MessageMeta model={null} tokens={null} latencyMs={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('CopyAction', () => {
  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    withQc(<CopyAction onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('respects disabled', () => {
    const onClick = vi.fn();
    withQc(<CopyAction onClick={onClick} disabled />);
    const btn = screen.getByRole('button', { name: /copy/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('RegenerateAction', () => {
  it('fires onClick when enabled', () => {
    const onClick = vi.fn();
    withQc(<RegenerateAction onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('respects disabled', () => {
    const onClick = vi.fn();
    withQc(<RegenerateAction onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('InsertAtEndAction', () => {
  it('renders "Insert at end" label and fires onClick', () => {
    const onClick = vi.fn();
    withQc(<InsertAtEndAction onClick={onClick} />);
    const btn = screen.getByRole('button', { name: /insert at end/i });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('MessageActions', () => {
  it('wraps children in a flex container', () => {
    const { container } = withQc(
      <MessageActions>
        <button type="button">a</button>
      </MessageActions>,
    );
    expect(container.querySelector('.flex')).toBeTruthy();
  });
});

describe('CitationsSlot', () => {
  it('renders the citations slot wrapper with data attributes regardless of citations', () => {
    const { container } = withQc(<CitationsSlot citations={null} messageId="m-1" />);
    const slot = container.querySelector('[data-citations-slot]');
    expect(slot).toBeTruthy();
    expect(slot?.getAttribute('data-message-id')).toBe('m-1');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail (some imports broken — TranscriptView/AssistantMessageRow/UserMessageRow not yet created)**

```bash
cd frontend && npx vitest run tests/components/messageRow/primitives.test.tsx
```

Expected: Either all pass (if the index re-exports are tolerant) OR fail at import. If the index re-exports break the test, the test imports directly from `@/components/messageRow/primitives` (already does) — should be unaffected.

If primitives tests pass: proceed.

- [ ] **Step 5: Write `primitives.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AssistantBubble,
  CopyAction,
  InsertAtEndAction,
  MessageActions,
  MessageMeta,
  RegenerateAction,
  ThinkingBubble,
} from './primitives';

const qc = new QueryClient();
qc.setQueryData(['models'], [
  { id: 'venice-test', name: 'Venice Test 70B' },
]);

const decorator = (Story: () => React.ReactNode) => (
  <QueryClientProvider client={qc}>
    <div className="bg-bg p-4 max-w-md">{Story()}</div>
  </QueryClientProvider>
);

const meta: Meta = {
  title: 'MessageRow/Primitives',
  decorators: [decorator],
};
export default meta;

type StoryT = StoryObj;

export const AssistantBubbleStory: StoryT = {
  name: 'AssistantBubble',
  render: () => (
    <AssistantBubble>
      Lorem ipsum dolor sit amet — a generated assistant response in the
      familiar serif body with an AI border accent.
    </AssistantBubble>
  ),
};

export const ThinkingBubbleStory: StoryT = {
  name: 'ThinkingBubble',
  render: () => (
    <div className="flex flex-col gap-3">
      <ThinkingBubble />
      <ThinkingBubble label="Generating scene…" />
    </div>
  ),
};

export const MessageMetaStory: StoryT = {
  name: 'MessageMeta',
  render: () => (
    <div className="flex flex-col gap-3">
      <MessageMeta model="venice-test" tokens={412} latencyMs={1800} />
      <MessageMeta model="venice-test" tokens={null} latencyMs={null} />
      <MessageMeta model={null} tokens={412} latencyMs={1800} />
    </div>
  ),
};

export const Actions: StoryT = {
  render: () => (
    <MessageActions>
      <CopyAction onClick={() => {}} />
      <RegenerateAction onClick={() => {}} />
      <InsertAtEndAction onClick={() => {}} />
    </MessageActions>
  ),
};

export const ActionsDisabled: StoryT = {
  name: 'Actions (disabled)',
  render: () => (
    <MessageActions>
      <CopyAction onClick={() => {}} disabled />
      <RegenerateAction onClick={() => {}} disabled />
      <InsertAtEndAction onClick={() => {}} disabled />
    </MessageActions>
  ),
};
```

- [ ] **Step 6: Run typecheck + lint:design**

```bash
cd frontend && npm run typecheck && npm run lint:design
```

Expected: typecheck may fail at `index.ts` re-exporting components that don't exist yet (AssistantMessageRow, UserMessageRow, TranscriptView). Either commit those re-exports as TODOs and fix in later tasks, OR leave the index.ts file with only the primitives exports for now.

For build sequence cleanliness: replace `index.ts` content with just the primitives:

```ts
export {
  AssistantBubble,
  CitationsSlot,
  CopyAction,
  InsertAtEndAction,
  MessageActions,
  MessageMeta,
  RegenerateAction,
  ThinkingBubble,
} from './primitives';
```

Will expand the index in Tasks 11/12/14 as components are added.

- [ ] **Step 7: Run tests**

```bash
cd frontend && npx vitest run tests/components/messageRow/primitives.test.tsx
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/messageRow/ frontend/tests/components/messageRow/primitives.test.tsx
git commit -m "[ai-surfaces-v1] frontend: messageRow/ primitives (AssistantBubble, MessageMeta, actions, CitationsSlot, ThinkingBubble)"
```

---

## Task 11: `<UserMessageRow>` — shared user-message row

**Files:**
- Create: `frontend/src/components/messageRow/UserMessageRow.tsx`
- Create: `frontend/src/components/messageRow/UserMessageRow.stories.tsx`
- Create: `frontend/tests/components/messageRow/UserMessageRow.test.tsx`
- Modify: `frontend/src/components/messageRow/index.ts` (add export)

**Context:** Right-aligned accent-soft bubble + optional attachment preview when `message.attachmentJson?.selectionText` is set. Identical for Chat and Scene (Scene messages won't have attachments today).

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/components/messageRow/UserMessageRow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserMessageRow } from '@/components/messageRow/UserMessageRow';
import type { ChatMessage } from '@/hooks/useChat';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    contentJson: 'Hello world',
    attachmentJson: null,
    citationsJson: null,
    model: null,
    tokens: null,
    latencyMs: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('UserMessageRow', () => {
  it('renders user content in a right-aligned bubble', () => {
    render(<UserMessageRow message={makeMessage({ contentJson: 'Hi there' })} />);
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('renders attachment preview when attachmentJson has selectionText', () => {
    render(
      <UserMessageRow
        message={makeMessage({
          attachmentJson: { selectionText: 'quoted text', chapterId: 'c-1' },
        })}
        chapterTitle="Chapter One"
      />,
    );
    expect(screen.getByText(/CHAPTER ONE/)).toBeInTheDocument();
    expect(screen.getByText('quoted text')).toBeInTheDocument();
  });

  it('skips attachment preview when selectionText empty', () => {
    render(
      <UserMessageRow
        message={makeMessage({
          attachmentJson: { selectionText: '', chapterId: 'c-1' },
        })}
      />,
    );
    expect(screen.queryByText(/FROM CH\./)).toBeNull();
  });

  it('falls back to "—" caption when chapterTitle missing but attachment has chapterId', () => {
    render(
      <UserMessageRow
        message={makeMessage({
          attachmentJson: { selectionText: 'q', chapterId: 'c-1' },
        })}
      />,
    );
    expect(screen.getByText(/—/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — FAIL (file doesn't exist)**

```bash
cd frontend && npx vitest run tests/components/messageRow/UserMessageRow.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `UserMessageRow.tsx`**

Create `frontend/src/components/messageRow/UserMessageRow.tsx`:

```tsx
import type { JSX } from 'react';
import type { ChatMessage } from '@/hooks/useChat';

export interface UserMessageRowProps {
  message: ChatMessage;
  chapterTitle?: string | null;
}

function getMessageText(contentJson: unknown): string {
  if (typeof contentJson === 'string') return contentJson;
  if (contentJson === null || contentJson === undefined) return '';
  try {
    return JSON.stringify(contentJson);
  } catch {
    return '';
  }
}

function chapterCaption(
  attachment: { chapterId?: string },
  chapterTitle: string | null | undefined,
): string {
  if (chapterTitle && chapterTitle.length > 0) return chapterTitle.toUpperCase();
  if (attachment.chapterId !== undefined && attachment.chapterId.length > 0) {
    return '—';
  }
  return '—';
}

export function UserMessageRow({ message, chapterTitle }: UserMessageRowProps): JSX.Element {
  const text = getMessageText(message.contentJson);
  const attachment = message.attachmentJson;
  const hasAttachmentText =
    attachment !== null &&
    typeof attachment.selectionText === 'string' &&
    attachment.selectionText.length > 0;

  return (
    <li className="flex flex-col items-end" data-message-id={message.id} data-role="user">
      {hasAttachmentText && attachment !== null ? (
        <div
          className="pl-3 border-l-2 border-line-2 mb-1 ml-auto max-w-[80%]"
          data-testid={`attachment-${message.id}`}
        >
          <span className="text-[10px] uppercase tracking-[.08em] font-mono text-ink-4 block">
            {`FROM CH. ${chapterCaption(attachment, chapterTitle)}`}
          </span>
          <blockquote className="font-serif italic text-[13px] text-ink-3 line-clamp-2">
            {attachment.selectionText}
          </blockquote>
        </div>
      ) : null}
      <div className="bg-[var(--accent-soft)] rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-sans ml-auto max-w-[80%] whitespace-pre-wrap">
        {text}
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run tests/components/messageRow/UserMessageRow.test.tsx
```

Expected: All 4 pass.

- [ ] **Step 5: Add the index export**

Append to `frontend/src/components/messageRow/index.ts`:

```ts
export { UserMessageRow } from './UserMessageRow';
export type { UserMessageRowProps } from './UserMessageRow';
```

- [ ] **Step 6: Write the story file**

Create `frontend/src/components/messageRow/UserMessageRow.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { UserMessageRow } from './UserMessageRow';
import type { ChatMessage } from '@/hooks/useChat';

const baseMessage: ChatMessage = {
  id: 'msg-1',
  role: 'user',
  contentJson: 'Could you suggest an alternative title for this chapter?',
  attachmentJson: null,
  citationsJson: null,
  model: null,
  tokens: null,
  latencyMs: null,
  createdAt: new Date().toISOString(),
};

const meta: Meta<typeof UserMessageRow> = {
  title: 'MessageRow/UserMessageRow',
  component: UserMessageRow,
  decorators: [
    (Story) => (
      <ul className="bg-bg p-4 max-w-md flex flex-col gap-3">
        <Story />
      </ul>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof UserMessageRow>;

export const Plain: Story = {
  args: { message: baseMessage },
};

export const WithAttachment: Story = {
  args: {
    message: {
      ...baseMessage,
      attachmentJson: {
        selectionText: 'The fog rolled in over the moors that night, slow and silent.',
        chapterId: 'ch-1',
      },
    },
    chapterTitle: 'Chapter Three',
  },
};

export const LongContent: Story = {
  args: {
    message: {
      ...baseMessage,
      contentJson:
        'Could you draft three alternative chapter titles that emphasize tension rather than mystery? The current one is fine but feels too detached for the pacing of this section.',
    },
  },
};
```

- [ ] **Step 7: Run typecheck + lint:design**

```bash
cd frontend && npm run typecheck && npm run lint:design
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/messageRow/UserMessageRow.tsx frontend/src/components/messageRow/UserMessageRow.stories.tsx frontend/tests/components/messageRow/UserMessageRow.test.tsx frontend/src/components/messageRow/index.ts
git commit -m "[ai-surfaces-v1] frontend: UserMessageRow shared component + stories + tests"
```

---

## Task 12: `<AssistantMessageRow>` — shared assistant-message row

**Files:**
- Create: `frontend/src/components/messageRow/AssistantMessageRow.tsx`
- Create: `frontend/src/components/messageRow/AssistantMessageRow.stories.tsx`
- Create: `frontend/tests/components/messageRow/AssistantMessageRow.test.tsx`
- Modify: `frontend/src/components/messageRow/index.ts`

**Context:** Composes `<AssistantBubble>` (or `<ThinkingBubble>` for empty streaming), `<MessageActions>` (consumer-supplied via `actions` slot), `<MessageMeta>`, and `<CitationsSlot>`. Tab-specific actions go through the slot.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/components/messageRow/AssistantMessageRow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssistantMessageRow } from '@/components/messageRow/AssistantMessageRow';
import type { ChatMessage } from '@/hooks/useChat';

function withQc(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['models'], [{ id: 'm-1', name: 'Model One' }]);
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function makeAssistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-a',
    role: 'assistant',
    contentJson: 'Sure, here are some thoughts.',
    attachmentJson: null,
    citationsJson: null,
    model: 'm-1',
    tokens: 412,
    latencyMs: 1800,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AssistantMessageRow', () => {
  it('renders assistant content + meta row + actions slot', () => {
    withQc(
      <AssistantMessageRow
        message={makeAssistant()}
        actions={<button type="button">Custom Action</button>}
      />,
    );
    expect(screen.getByText('Sure, here are some thoughts.')).toBeInTheDocument();
    expect(screen.getByText('Model One')).toBeInTheDocument();
    expect(screen.getByText('412 tok · 1.8s')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom Action' })).toBeInTheDocument();
  });

  it('renders thinking bubble when isStreaming + empty content + label given (Scene)', () => {
    withQc(
      <AssistantMessageRow
        message={makeAssistant({ contentJson: '' })}
        actions={null}
        isStreaming
        thinkingLabel="Generating scene…"
      />,
    );
    expect(screen.getByText('Generating scene…')).toBeInTheDocument();
    // Bubble (with AI border-left) is NOT rendered.
    expect(screen.queryByText('Sure, here are some thoughts.')).toBeNull();
  });

  it('renders thinking bubble when isStreaming + empty content + no label (Chat)', () => {
    const { container } = withQc(
      <AssistantMessageRow
        message={makeAssistant({ contentJson: '' })}
        actions={null}
        isStreaming
      />,
    );
    // ThinkingDots default (no custom label).
    expect(screen.queryByText('Generating scene…')).toBeNull();
    // The thinking bubble has the AI border-left class but no text content.
    expect(container.querySelector('.border-l-2.border-\\[var\\(--ai\\)\\]')).toBeTruthy();
  });

  it('renders empty assistant content as a regular bubble when NOT streaming', () => {
    // Persisted message with empty content shouldn't render thinking dots.
    const { container } = withQc(
      <AssistantMessageRow message={makeAssistant({ contentJson: '' })} actions={null} />,
    );
    expect(screen.queryByText(/Generating/)).toBeNull();
    // Has the bubble's border-l class, not the thinking variant.
    expect(container.querySelector('.border-l-2.border-\\[var\\(--ai\\)\\]')).toBeTruthy();
  });

  it('renders bubble (not thinking) when isStreaming AND content non-empty (transition state)', () => {
    // Once streaming starts producing tokens, the bubble takes over from the
    // thinking dots. Tests the predicate's AND condition.
    withQc(
      <AssistantMessageRow
        message={makeAssistant({ contentJson: 'partial reply' })}
        actions={null}
        isStreaming
        thinkingLabel="Generating scene…"
      />,
    );
    expect(screen.getByText('partial reply')).toBeInTheDocument();
    expect(screen.queryByText('Generating scene…')).toBeNull();
  });

  it('mounts citations slot for each message id', () => {
    const { container } = withQc(
      <AssistantMessageRow message={makeAssistant({ id: 'a-42' })} actions={null} />,
    );
    const slot = container.querySelector('[data-citations-slot]');
    expect(slot?.getAttribute('data-message-id')).toBe('a-42');
  });
});
```

- [ ] **Step 2: Run tests — FAIL**

```bash
cd frontend && npx vitest run tests/components/messageRow/AssistantMessageRow.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AssistantMessageRow.tsx`**

Create `frontend/src/components/messageRow/AssistantMessageRow.tsx`:

```tsx
import type { JSX, ReactNode } from 'react';
import {
  AssistantBubble,
  CitationsSlot,
  MessageMeta,
  ThinkingBubble,
} from './primitives';
import type { ChatMessage } from '@/hooks/useChat';

export interface AssistantMessageRowProps {
  message: ChatMessage;
  actions: ReactNode;
  /**
   * When true AND content is empty, render a ThinkingBubble instead of
   * the AssistantBubble. Default false (persisted assistants render as
   * a bubble even if content happens to be empty).
   */
  isStreaming?: boolean;
  /**
   * Optional label inside the ThinkingBubble. Only consulted when
   * `isStreaming` is true. Chat passes nothing → default dots-only;
   * Scene passes "Generating scene…".
   */
  thinkingLabel?: string;
}

function getMessageText(contentJson: unknown): string {
  if (typeof contentJson === 'string') return contentJson;
  if (contentJson === null || contentJson === undefined) return '';
  try {
    return JSON.stringify(contentJson);
  } catch {
    return '';
  }
}

export function AssistantMessageRow({
  message,
  actions,
  isStreaming = false,
  thinkingLabel,
}: AssistantMessageRowProps): JSX.Element {
  const text = getMessageText(message.contentJson);
  const showThinking = isStreaming && text.length === 0;

  return (
    <li
      className="flex flex-col items-start"
      data-message-id={message.id}
      data-role="assistant"
      data-testid={`assistant-${message.id}`}
    >
      {showThinking ? (
        <ThinkingBubble {...(thinkingLabel !== undefined ? { label: thinkingLabel } : {})} />
      ) : (
        <AssistantBubble>{text}</AssistantBubble>
      )}
      {actions !== null && actions !== undefined ? <>{actions}</> : null}
      <MessageMeta
        model={message.model}
        tokens={message.tokens}
        latencyMs={message.latencyMs}
      />
      <CitationsSlot citations={message.citationsJson} messageId={message.id} />
    </li>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run tests/components/messageRow/AssistantMessageRow.test.tsx
```

Expected: All 6 pass (content+meta+actions, thinking-Scene, thinking-Chat-no-label, empty-not-streaming, transition-with-content, citations-slot).

- [ ] **Step 5: Add to index**

Append to `frontend/src/components/messageRow/index.ts`:

```ts
export { AssistantMessageRow } from './AssistantMessageRow';
export type { AssistantMessageRowProps } from './AssistantMessageRow';
```

- [ ] **Step 6: Write the story file**

Create `frontend/src/components/messageRow/AssistantMessageRow.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssistantMessageRow } from './AssistantMessageRow';
import { CopyAction, InsertAtEndAction, MessageActions, RegenerateAction } from './primitives';
import type { ChatMessage } from '@/hooks/useChat';

const qc = new QueryClient();
qc.setQueryData(['models'], [
  { id: 'venice-test', name: 'Venice Test 70B' },
]);

const decorator = (Story: () => React.ReactNode) => (
  <QueryClientProvider client={qc}>
    <ul className="bg-bg p-4 max-w-md flex flex-col gap-3">{Story()}</ul>
  </QueryClientProvider>
);

const baseMessage: ChatMessage = {
  id: 'a-1',
  role: 'assistant',
  contentJson:
    'Three alternative titles: "After the Fog"; "Silent Moors"; "What Came That Night."',
  attachmentJson: null,
  citationsJson: null,
  model: 'venice-test',
  tokens: 412,
  latencyMs: 1800,
  createdAt: new Date().toISOString(),
};

const meta: Meta<typeof AssistantMessageRow> = {
  title: 'MessageRow/AssistantMessageRow',
  component: AssistantMessageRow,
  decorators: [decorator],
};
export default meta;

type Story = StoryObj<typeof AssistantMessageRow>;

export const ChatVariant: Story = {
  args: {
    message: baseMessage,
    actions: (
      <MessageActions>
        <CopyAction onClick={() => {}} />
        <RegenerateAction onClick={() => {}} />
      </MessageActions>
    ),
  },
};

export const SceneVariant: Story = {
  args: {
    message: baseMessage,
    actions: (
      <MessageActions>
        <InsertAtEndAction onClick={() => {}} />
        <CopyAction onClick={() => {}} />
        <RegenerateAction onClick={() => {}} />
      </MessageActions>
    ),
  },
};

export const StreamingChat: Story = {
  args: {
    message: { ...baseMessage, contentJson: '', tokens: null, latencyMs: null },
    actions: null,
    isStreaming: true,
    // Chat doesn't pass a thinkingLabel; ThinkingDots renders dots-only.
  },
};

export const StreamingScene: Story = {
  args: {
    message: { ...baseMessage, contentJson: '', tokens: null, latencyMs: null },
    actions: null,
    isStreaming: true,
    thinkingLabel: 'Generating scene…',
  },
};
```

- [ ] **Step 7: Run typecheck + lint:design**

```bash
cd frontend && npm run typecheck && npm run lint:design
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/messageRow/AssistantMessageRow.tsx frontend/src/components/messageRow/AssistantMessageRow.stories.tsx frontend/tests/components/messageRow/AssistantMessageRow.test.tsx frontend/src/components/messageRow/index.ts
git commit -m "[ai-surfaces-v1] frontend: AssistantMessageRow shared component + stories + tests"
```

---

## Task 12.5: Add `disabled` prop to `<InlineErrorBanner>`

**Files:**
- Modify: `frontend/src/components/InlineErrorBanner.tsx`
- Modify: `frontend/tests/components/InlineErrorBanner.test.tsx` (or equivalent — find via grep)

**Context:** `<TranscriptView>` (next task) and the banner-retry hook (Task 15) need to disable the banner's Retry button during the dispatch decision window. Today the component doesn't accept a `disabled` prop. Small standalone change with its own commit so the diff is self-describing.

- [ ] **Step 1: Read the existing component**

```bash
cat frontend/src/components/InlineErrorBanner.tsx
```

Note the props shape and where the Retry button renders.

- [ ] **Step 2: Write a failing test for the disabled behavior**

Locate the existing test file (`grep -rl "InlineErrorBanner" frontend/tests/`). Append:

```tsx
it('disables the Retry button when disabled prop is true', () => {
  const onRetry = vi.fn();
  render(
    <InlineErrorBanner
      error={{ code: null, message: 'oops' }}
      onRetry={onRetry}
      disabled
    />,
  );
  const btn = screen.getByRole('button', { name: /retry/i });
  expect(btn).toBeDisabled();
  fireEvent.click(btn);
  expect(onRetry).not.toHaveBeenCalled();
});

it('Retry button is enabled when disabled prop is omitted/false', () => {
  const onRetry = vi.fn();
  render(
    <InlineErrorBanner error={{ code: null, message: 'oops' }} onRetry={onRetry} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(onRetry).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: Run tests — FAIL on the disabled case**

```bash
cd frontend && npx vitest run tests/components/InlineErrorBanner.test.tsx
```

Expected: the new "disables the Retry button" test fails (prop ignored — button is still clickable).

- [ ] **Step 4: Add the prop to the component**

In `frontend/src/components/InlineErrorBanner.tsx`:

```tsx
export interface InlineErrorBannerProps {
  // ... existing props ...
  /** Disables the Retry button. Used by TranscriptView while banner-retry dispatch decides. */
  disabled?: boolean;
}

export function InlineErrorBanner({
  // ... existing destructure ...
  disabled,
}: InlineErrorBannerProps): JSX.Element {
  // ... existing JSX ...
  // On the existing Retry button:
  // <button type="button" onClick={onRetry} disabled={disabled} ...>Retry</button>
  // (Match the existing button's other attributes; just add the disabled passthrough.)
}
```

- [ ] **Step 5: Run tests**

```bash
cd frontend && npx vitest run tests/components/InlineErrorBanner.test.tsx
```

Expected: All pass.

- [ ] **Step 6: Run typecheck + lint:design**

```bash
cd frontend && npm run typecheck && npm run lint:design
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/InlineErrorBanner.tsx frontend/tests/components/InlineErrorBanner.test.tsx
git commit -m "[ai-surfaces-v1] frontend: InlineErrorBanner accepts disabled prop (consumed by TranscriptView banner-retry)"
```

---

# Phase 5 — `<TranscriptView>` container

## Task 13: Create `<TranscriptView>` with scroll, autoscroll, session-reset, error UX, and merge logic

**Files:**
- Create: `frontend/src/components/messageRow/TranscriptView.tsx`
- Create: `frontend/src/components/messageRow/TranscriptView.stories.tsx`
- Create: `frontend/tests/components/messageRow/TranscriptView.test.tsx`
- Modify: `frontend/src/components/messageRow/index.ts`

**Context:** Render-prop container. Owns: useChatMessagesQuery, useChatDraftStore read (keyed slot), merge logic, scroll element, autoscroll effect, session-reset, loading/error/empty states. Hydration error UX is unified (single line + Retry button calling `query.refetch()` — replaces today's per-tab divergence).

The merge logic per the spec: persisted messages + draft pair when present. If the trailing persisted user matches the draft's userContent, suppress the draft-user row to prevent flicker (the user has been refetched).

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/components/messageRow/TranscriptView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TranscriptView } from '@/components/messageRow/TranscriptView';
import { chatMessagesQueryKey } from '@/hooks/useChat';
import { useChatDraftStore } from '@/store/chatDraft';
import type { ChatMessage } from '@/hooks/useChat';

function makeQc(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeMessage(over: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    id: over.id,
    role: 'user',
    contentJson: '',
    attachmentJson: null,
    citationsJson: null,
    model: null,
    tokens: null,
    latencyMs: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('TranscriptView', () => {
  beforeEach(() => {
    useChatDraftStore.setState({ drafts: {} });
  });

  it('renders empty state when chatId is null', () => {
    const qc = makeQc();
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId={null} emptyState={<div>EMPTY</div>}>
          {() => null}
        </TranscriptView>
      </QueryClientProvider>,
    );
    expect(screen.getByText('EMPTY')).toBeInTheDocument();
  });

  it('renders empty state when no messages and no draft', () => {
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), []);
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {() => null}
        </TranscriptView>
      </QueryClientProvider>,
    );
    expect(screen.getByText('EMPTY')).toBeInTheDocument();
  });

  it('renders persisted messages via render-prop', () => {
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), [
      makeMessage({ id: 'm-1', role: 'user', contentJson: 'hi' }),
      makeMessage({ id: 'm-2', role: 'assistant', contentJson: 'hello' }),
    ]);
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {(rows) => (
            <>
              {rows.map((r, i) =>
                r.kind === 'persisted' ? (
                  <li key={i} data-testid="persisted">{String(r.message.contentJson)}</li>
                ) : null,
              )}
            </>
          )}
        </TranscriptView>
      </QueryClientProvider>,
    );
    const items = screen.getAllByTestId('persisted');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('hi');
    expect(items[1]).toHaveTextContent('hello');
  });

  it('merges draft pair after persisted messages', () => {
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), [
      makeMessage({ id: 'm-1', role: 'user', contentJson: 'past' }),
      makeMessage({ id: 'm-2', role: 'assistant', contentJson: 'old' }),
    ]);
    useChatDraftStore.getState().start({
      chatId: 'c-1',
      userContent: 'new question',
      attachment: null,
    });
    useChatDraftStore.getState().appendDelta('c-1', 'streaming response');
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {(rows) => (
            <>
              {rows.map((r, i) => {
                if (r.kind === 'persisted')
                  return <li key={i} data-testid="persisted">{String(r.message.contentJson)}</li>;
                if (r.kind === 'draft-user')
                  return <li key={i} data-testid="draft-user">{r.userContent}</li>;
                return <li key={i} data-testid="draft-assistant">{r.assistantText}</li>;
              })}
            </>
          )}
        </TranscriptView>
      </QueryClientProvider>,
    );
    expect(screen.getAllByTestId('persisted')).toHaveLength(2);
    expect(screen.getByTestId('draft-user')).toHaveTextContent('new question');
    expect(screen.getByTestId('draft-assistant')).toHaveTextContent('streaming response');
  });

  it('suppresses draft-user when persisted trailing user matches draft userContent (mid-stream-error path)', () => {
    // Simulates the moment after server persistence + cache refetch — the
    // persisted user matches the draft's userContent; the draft-user is
    // redundant and would cause a duplicate flicker.
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), [
      makeMessage({ id: 'm-X', role: 'user', contentJson: 'new question' }),
    ]);
    useChatDraftStore.getState().start({
      chatId: 'c-1',
      userContent: 'new question',
      attachment: null,
    });
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {(rows) => (
            <>
              {rows.map((r, i) => {
                if (r.kind === 'persisted')
                  return <li key={i} data-testid="persisted">{String(r.message.contentJson)}</li>;
                if (r.kind === 'draft-user')
                  return <li key={i} data-testid="draft-user">{r.userContent}</li>;
                return <li key={i} data-testid="draft-assistant">{r.assistantText}</li>;
              })}
            </>
          )}
        </TranscriptView>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('persisted')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-user')).toBeNull();
  });

  it('suppresses draft-user when draft.userContent is empty (retry path)', () => {
    // Simulates the retry path: mutateAsync({retry: true}) calls start()
    // with userContent: ''. The user is already persisted; rendering an
    // empty synthetic user bubble would be ugly.
    const qc = makeQc();
    qc.setQueryData(chatMessagesQueryKey('c-1'), [
      makeMessage({ id: 'persisted-user', role: 'user', contentJson: 'previously sent' }),
    ]);
    useChatDraftStore.getState().start({
      chatId: 'c-1',
      userContent: '',
      attachment: null,
    });
    useChatDraftStore.getState().appendDelta('c-1', 'regenerated reply');
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-1" emptyState={<div>EMPTY</div>}>
          {(rows) => (
            <>
              {rows.map((r, i) => {
                if (r.kind === 'persisted')
                  return <li key={i} data-testid="persisted">{String(r.message.contentJson)}</li>;
                if (r.kind === 'draft-user')
                  return <li key={i} data-testid="draft-user">{r.userContent}</li>;
                return <li key={i} data-testid="draft-assistant">{r.assistantText}</li>;
              })}
            </>
          )}
        </TranscriptView>
      </QueryClientProvider>,
    );
    // The persisted user is shown; no synthetic empty-user bubble.
    expect(screen.getByTestId('persisted')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-user')).toBeNull();
    expect(screen.getByTestId('draft-assistant')).toHaveTextContent('regenerated reply');
  });

  it('renders error state with Retry button when query.isError', () => {
    const qc = makeQc();
    // Force isError state by setting a failed-promise query.
    qc.setQueryDefaults(chatMessagesQueryKey('c-err'), {
      queryFn: () => Promise.reject(new Error('boom')),
      retry: false,
    });
    render(
      <QueryClientProvider client={qc}>
        <TranscriptView chatId="c-err" emptyState={<div>EMPTY</div>}>
          {() => null}
        </TranscriptView>
      </QueryClientProvider>,
    );
    return waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run tests — FAIL**

```bash
cd frontend && npx vitest run tests/components/messageRow/TranscriptView.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `TranscriptView.tsx`**

Create `frontend/src/components/messageRow/TranscriptView.tsx`:

```tsx
import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
import { type ChatDraft, type ChatDraftAttachment, type ChatDraftError, type ChatDraftStatus, useChatDraftStore } from '@/store/chatDraft';
import { type ChatMessage, useChatMessagesQuery } from '@/hooks/useChat';

export type TranscriptRow =
  | { kind: 'persisted'; message: ChatMessage }
  | {
      kind: 'draft-user';
      userContent: string;
      attachment: ChatDraftAttachment | null;
    }
  | {
      kind: 'draft-assistant';
      assistantText: string;
      status: ChatDraftStatus;
      error: ChatDraftError | null;
    };

export interface TranscriptViewProps {
  chatId: string | null;
  emptyState: ReactNode;
  sendError?: Error | null;
  onRetrySend?: () => void;
  /** Disables the InlineErrorBanner's Retry button (banner-retry's `isDispatching` window + `mutation.isPending`). */
  disableRetrySend?: boolean;
  /** Render-prop receives the merged row stream. */
  children: (rows: TranscriptRow[]) => ReactNode;
}

function getMessageText(contentJson: unknown): string {
  if (typeof contentJson === 'string') return contentJson;
  if (contentJson === null || contentJson === undefined) return '';
  try {
    return JSON.stringify(contentJson);
  } catch {
    return '';
  }
}

function buildRows(messages: ChatMessage[], draft: ChatDraft | undefined): TranscriptRow[] {
  const rows: TranscriptRow[] = messages.map((m) => ({ kind: 'persisted', message: m }));
  if (!draft) return rows;

  // Suppress draft-user when EITHER:
  //   (a) draft.userContent === '' — retry path (mutateAsync with retry: true
  //       calls start() with empty userContent; the user message is already
  //       persisted on the backend, so a synthetic empty bubble would be ugly).
  //   (b) the trailing persisted user message's content matches draft.userContent
  //       — mid-stream-error → banner-retry path, where the post-refetch cache
  //       catches up while the error draft is still in the store. Without this,
  //       there's a brief duplicate-user flicker.
  // Either rule on its own leaves a duplicate-user flicker in the other case.
  const trailingUser = [...messages].reverse().find((m) => m.role === 'user');
  const trailingUserMatches =
    trailingUser !== undefined &&
    getMessageText(trailingUser.contentJson) === draft.userContent;
  const skipDraftUser = draft.userContent === '' || trailingUserMatches;
  if (!skipDraftUser) {
    rows.push({
      kind: 'draft-user',
      userContent: draft.userContent,
      attachment: draft.attachment,
    });
  }
  if (draft.status !== 'error') {
    rows.push({
      kind: 'draft-assistant',
      assistantText: draft.assistantText,
      status: draft.status,
      error: draft.error,
    });
  }
  return rows;
}

export function TranscriptView({
  chatId,
  emptyState,
  sendError,
  onRetrySend,
  disableRetrySend,
  children,
}: TranscriptViewProps): JSX.Element {
  const query = useChatMessagesQuery(chatId);
  const draft = useChatDraftStore((s) => (chatId !== null ? s.drafts[chatId] : undefined));

  const messages = query.data ?? [];
  const rows = useMemo(() => buildRows(messages, draft), [messages, draft]);

  const transcriptRef = useRef<HTMLElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [chatId]);

  const handleScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 50;
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [rows]);

  // ── Render branches ──────────────────────────────────────────────────
  if (chatId === null) {
    return (
      <section
        ref={transcriptRef}
        className="flex-1 min-h-0 overflow-y-auto p-3"
        data-testid="transcript-empty"
        onScroll={handleScroll}
      >
        {emptyState}
      </section>
    );
  }

  if (query.isLoading) {
    return (
      <section
        ref={transcriptRef}
        className="flex-1 min-h-0 overflow-y-auto p-3 text-[12px] text-ink-4"
        data-testid="transcript-loading"
        onScroll={handleScroll}
      >
        Loading messages…
      </section>
    );
  }

  if (query.isError) {
    return (
      <section
        ref={transcriptRef}
        className="flex-1 min-h-0 overflow-y-auto p-3"
        data-testid="transcript-error"
        onScroll={handleScroll}
      >
        <InlineErrorBanner
          error={{
            code: null,
            message:
              query.error instanceof Error
                ? query.error.message
                : "Couldn't load transcript.",
          }}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </section>
    );
  }

  const isEmpty = rows.length === 0;
  if (isEmpty) {
    return (
      <section
        ref={transcriptRef}
        className="flex-1 min-h-0 overflow-y-auto p-3"
        data-testid="transcript-empty"
        onScroll={handleScroll}
      >
        {emptyState}
      </section>
    );
  }

  const bannerError = sendError != null ? { code: null, message: sendError.message } : null;

  return (
    <section
      ref={transcriptRef}
      className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-4"
      data-testid="transcript-rows"
      onScroll={handleScroll}
    >
      <ol
        className="flex flex-col gap-3"
        role="log"
        aria-label="Chat messages"
      >
        {children(rows)}
      </ol>
      {bannerError ? (
        <InlineErrorBanner
          error={bannerError}
          {...(onRetrySend ? { onRetry: onRetrySend } : {})}
          {...(disableRetrySend ? { disabled: true } : {})}
        />
      ) : null}
    </section>
  );
}
```

(Task 12.5 — see separator below — adds `disabled` to `<InlineErrorBanner>`. This step's `<TranscriptView>` body assumes that prop already exists.)

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run tests/components/messageRow/TranscriptView.test.tsx
```

Expected: All 7 pass (empty when null chatId, empty when no messages, persisted rendering, draft merge, mid-stream-error suppression, retry-path empty-userContent suppression, hydration error UX).

- [ ] **Step 5: Add to index**

Append to `frontend/src/components/messageRow/index.ts`:

```ts
export { TranscriptView } from './TranscriptView';
export type { TranscriptRow, TranscriptViewProps } from './TranscriptView';
```

- [ ] **Step 6: Write the story file**

Create `frontend/src/components/messageRow/TranscriptView.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TranscriptView } from './TranscriptView';
import { AssistantMessageRow } from './AssistantMessageRow';
import { UserMessageRow } from './UserMessageRow';
import { CopyAction, MessageActions, RegenerateAction } from './primitives';
import { chatMessagesQueryKey } from '@/hooks/useChat';
import type { ChatMessage } from '@/hooks/useChat';

function buildMessages(): ChatMessage[] {
  return [
    {
      id: 'm-1',
      role: 'user',
      contentJson: 'Could you suggest an alternative title for this chapter?',
      attachmentJson: null,
      citationsJson: null,
      model: null,
      tokens: null,
      latencyMs: null,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    },
    {
      id: 'm-2',
      role: 'assistant',
      contentJson:
        'Three alternative titles: "After the Fog"; "Silent Moors"; "What Came That Night."',
      attachmentJson: null,
      citationsJson: null,
      model: 'venice-test',
      tokens: 412,
      latencyMs: 1800,
      createdAt: new Date().toISOString(),
    },
  ];
}

function withSeed(messages: ChatMessage[]): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData(chatMessagesQueryKey('demo-chat'), messages);
  qc.setQueryData(['models'], [{ id: 'venice-test', name: 'Venice Test 70B' }]);
  return qc;
}

const meta: Meta<typeof TranscriptView> = {
  title: 'MessageRow/TranscriptView',
  component: TranscriptView,
};
export default meta;

type Story = StoryObj<typeof TranscriptView>;

export const WithMessages: Story = {
  render: () => {
    const qc = withSeed(buildMessages());
    return (
      <QueryClientProvider client={qc}>
        <div className="bg-bg h-[400px] flex flex-col">
          <TranscriptView
            chatId="demo-chat"
            emptyState={<div className="m-auto text-ink-3">Start a conversation</div>}
          >
            {(rows) =>
              rows.map((r, i) => {
                if (r.kind === 'persisted' && r.message.role === 'user') {
                  return <UserMessageRow key={i} message={r.message} />;
                }
                if (r.kind === 'persisted') {
                  return (
                    <AssistantMessageRow
                      key={i}
                      message={r.message}
                      actions={
                        <MessageActions>
                          <CopyAction onClick={() => {}} />
                          <RegenerateAction onClick={() => {}} />
                        </MessageActions>
                      }
                    />
                  );
                }
                return null;
              })
            }
          </TranscriptView>
        </div>
      </QueryClientProvider>
    );
  },
};

export const Empty: Story = {
  render: () => {
    const qc = new QueryClient();
    qc.setQueryData(chatMessagesQueryKey('demo-chat'), []);
    return (
      <QueryClientProvider client={qc}>
        <div className="bg-bg h-[400px] flex flex-col">
          <TranscriptView
            chatId="demo-chat"
            emptyState={<div className="m-auto text-ink-3">Start a conversation</div>}
          >
            {() => null}
          </TranscriptView>
        </div>
      </QueryClientProvider>
    );
  },
};
```

- [ ] **Step 7: Run typecheck + lint:design**

```bash
cd frontend && npm run typecheck && npm run lint:design
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/messageRow/TranscriptView.tsx frontend/src/components/messageRow/TranscriptView.stories.tsx frontend/tests/components/messageRow/TranscriptView.test.tsx frontend/src/components/messageRow/index.ts
git commit -m "[ai-surfaces-v1] frontend: TranscriptView container (autoscroll, session-reset, unified hydration error UX, render-prop merge)"
```

---

# Phase 6 — Chat integration

## Task 14: ChatTab uses `<TranscriptView>` + row components

**Files:**
- Create: `frontend/src/components/ChatEmptyState.tsx`
- Modify: `frontend/src/components/ChatTab.tsx`

**Context:** Replace the inline `<div className="flex-1 min-h-0 overflow-y-auto"><ChatMessages …/></div>` with `<TranscriptView>` consuming row components. Per-message Regenerate is unconditional `mutateAsync({retry: true})`. ChatMessages.tsx stays in the tree until Phase 8 cleanup.

- [ ] **Step 1: Create the empty state component**

Create `frontend/src/components/ChatEmptyState.tsx`:

```tsx
import type { JSX } from 'react';

export function ChatEmptyState(): JSX.Element {
  return (
    <div className="flex flex-col gap-3 p-4 text-center" data-testid="chat-empty">
      <p className="text-[13px] text-ink-3 font-sans">Start a conversation</p>
    </div>
  );
}
```

- [ ] **Step 2: Update `ChatTab.tsx` to use the new layer**

Replace the JSX block from line 161 (the `return (` that opens the layout) through the end. Keep the existing handlers (`onSend`, `onRetry`, `onDelete`, `onRename`, `onNew`, `lastChatSendArgsRef`) unchanged for now. The render becomes:

```tsx
import {
  AssistantMessageRow,
  CopyAction,
  MessageActions,
  RegenerateAction,
  TranscriptView,
  UserMessageRow,
} from '@/components/messageRow';
import { ChatEmptyState } from '@/components/ChatEmptyState';

// ... existing handlers above ...

const onCopy = useCallback((message: ChatMessage) => {
  const text =
    typeof message.contentJson === 'string'
      ? message.contentJson
      : JSON.stringify(message.contentJson);
  void navigator.clipboard?.writeText(text);
}, []);

const onRegenerate = useCallback(() => {
  // Reuse the same guard `onSend` runs through; this catches "no chapter" /
  // "no model selected" the same way and surfaces the canonical error to
  // useErrorStore.
  const guard = checkChatSendGuards({
    activeChapterId: chapterId,
    selectedModelId,
  });
  if (guard) {
    useErrorStore.getState().push(guard);
    return;
  }
  if (activeChatId === null) return;
  void sendChatMessage.mutateAsync({
    chatId: activeChatId,
    modelId: selectedModelId as string,
    retry: true,
  });
}, [chapterId, selectedModelId, activeChatId, sendChatMessage]);

return (
  <div className="flex flex-col h-full" data-testid="chat-tab">
    <SessionPicker
      labels={CHAT_LABELS}
      sessions={visibleSessions.map((c) => ({
        id: c.id,
        title: c.title ?? 'Untitled',
        updatedAt: c.updatedAt,
      }))}
      activeSessionId={activeChatId}
      onSelect={setActiveChatId}
      onRename={onRename}
      onDelete={onDelete}
      onNew={onNew}
    />

    <TranscriptView
      chatId={activeChatId}
      emptyState={<ChatEmptyState />}
      sendError={sendChatMessage.error}
      onRetrySend={onRetry}
    >
      {(rows) =>
        rows.map((r, i) => {
          if (r.kind === 'persisted' && r.message.role === 'user') {
            return (
              <UserMessageRow
                key={r.message.id}
                message={r.message}
              />
            );
          }
          if (r.kind === 'persisted' && r.message.role === 'assistant') {
            return (
              <AssistantMessageRow
                key={r.message.id}
                message={r.message}
                actions={
                  <MessageActions>
                    <CopyAction onClick={() => onCopy(r.message)} />
                    <RegenerateAction
                      onClick={onRegenerate}
                      disabled={sendChatMessage.isPending}
                    />
                  </MessageActions>
                }
              />
            );
          }
          if (r.kind === 'draft-user') {
            return (
              <UserMessageRow
                key={`draft-user-${i}`}
                message={{
                  id: 'draft-user',
                  role: 'user',
                  contentJson: r.userContent,
                  attachmentJson: r.attachment,
                  citationsJson: null,
                  model: null,
                  tokens: null,
                  latencyMs: null,
                  createdAt: new Date().toISOString(),
                }}
              />
            );
          }
          if (r.kind === 'draft-assistant') {
            return (
              <AssistantMessageRow
                key={`draft-assistant-${i}`}
                message={{
                  id: 'draft-assistant',
                  role: 'assistant',
                  contentJson: r.assistantText,
                  attachmentJson: null,
                  citationsJson: null,
                  model: null,
                  tokens: null,
                  latencyMs: null,
                  createdAt: new Date().toISOString(),
                }}
                actions={null}
                isStreaming
                // Chat passes no label — ThinkingDots renders its default
                // dots-only animation. (Scene passes "Generating scene…".)
              />
            );
          }
          return null;
        })
      }
    </TranscriptView>

    <div className="relative">
      {lastPending !== null && (
        <div className="absolute left-3 right-3 bottom-[calc(100%+8px)] z-20">
          <UndoToast
            key={lastPending[0]}
            title={lastPending[1].title}
            onUndo={() => {
              undoDelete(lastPending[0]);
            }}
            timeoutMs={5000}
          />
        </div>
      )}
      <ChatComposer
        onSend={onSend}
        disabled={sendChatMessage.isPending}
        state={sendChatMessage.isPending ? 'streaming' : 'idle'}
        onStop={sendChatMessage.stop}
      />
    </div>
  </div>
);
```

Remove the `<ChatMessages>` import + JSX usage. Keep ChatMessages.tsx file (deleted in Phase 8).

- [ ] **Step 3: Run typecheck + lint:design**

```bash
cd frontend && npm run typecheck && npm run lint:design
```

Expected: No errors. (If `chapterTitle` was being passed to ChatMessages and isn't to UserMessageRow yet, decide: pass it through to UserMessageRow or skip. Pass it through if it's available via `useActiveStoryStore` or similar.)

- [ ] **Step 4: Run ChatTab tests**

```bash
cd frontend && npx vitest run tests/components/ChatTab.test.tsx
```

Expected: Existing tests pass — most assert composer wiring, session picker, send guards, and don't depend on ChatMessages internals. Update any test that explicitly looked for ChatMessages internals to look for the new TranscriptView/row test ids instead.

- [ ] **Step 5: Manually verify in browser via Storybook**

```bash
cd frontend && npm run storybook
```

Visit "MessageRow / TranscriptView / WithMessages" — confirm visual parity with prior Chat appearance.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ChatEmptyState.tsx frontend/src/components/ChatTab.tsx
git commit -m "[ai-surfaces-v1] frontend: ChatTab uses TranscriptView + shared row components"
```

---

## Task 15: Extract `useBannerRetry` hook (trailing-role dispatch) + dispatch table unit tests + wire into ChatTab

**Files:**
- Create: `frontend/src/hooks/useBannerRetry.ts`
- Create: `frontend/tests/hooks/useBannerRetry.test.tsx`
- Modify: `frontend/src/components/ChatTab.tsx` (replace `onRetry` with the new hook)

**Context:** Per spec's "Retry routing" section. The dispatch logic (refetch → read cache trailing-role → `{retry: true}` if user, else fresh send) lives in a small reusable hook so ChatTab and SceneTab use the same logic and the dispatch table is unit-tested deterministically.

The hook does NOT use `lastIdBefore`. An earlier draft did, but it had a stale-cache hole under rapid-fire send-after-success: captured-at-onMutate could point at the trailing message from BEFORE a prior successful send (because the post-success refetch hadn't landed). After failure, the inspect would false-positive case B and destroy the prior good assistant. Trailing-role doesn't have this failure mode — the cache's trailing message after refetch is the authoritative signal. See spec § "Why trailing-role beats lastIdBefore".

- [ ] **Step 1: Write failing tests for `useBannerRetry`**

Create `frontend/tests/hooks/useBannerRetry.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRef } from 'react';
import { useBannerRetry } from '@/hooks/useBannerRetry';
import { chatMessagesQueryKey, type ChatMessage } from '@/hooks/useChat';

function makeMessage(over: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    id: over.id,
    role: 'user',
    contentJson: '',
    attachmentJson: null,
    citationsJson: null,
    model: null,
    tokens: null,
    latencyMs: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function makeFakeMutation(): {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
} {
  return {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  };
}

function withQc(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useBannerRetry — trailing-role dispatch table', () => {
  beforeEach(() => vi.clearAllMocks());

  it('case A — empty cache (trailing undefined) → fresh send', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), []);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'X', enableWebSearch: false };
    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    await act(async () => {
      await result.current.onRetry();
    });

    expect(onSend).toHaveBeenCalledWith(lastSendArgs);
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('case B — cache trailing is user (X persisted, no following assistant) → retry: true', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), [
      makeMessage({ id: 'old-user', role: 'user', contentJson: 'past' }),
      makeMessage({ id: 'old-asst', role: 'assistant', contentJson: 'past-reply' }),
      makeMessage({ id: 'new-user-X', role: 'user', contentJson: 'new question' }),
    ]);
    const onSend = vi.fn();
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'new question', enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    await act(async () => {
      await result.current.onRetry();
    });

    expect(mutation.mutateAsync).toHaveBeenCalledWith({
      chatId: 'chat-1',
      modelId: 'venice-test',
      retry: true,
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('case D — prior turn exists; trailing is assistant-1 → fresh send (assistant-1 untouched)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), [
      makeMessage({ id: 'user-1', role: 'user', contentJson: 'hi' }),
      makeMessage({ id: 'assistant-1', role: 'assistant', contentJson: 'hello' }),
    ]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'X', enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    await act(async () => {
      await result.current.onRetry();
    });

    expect(onSend).toHaveBeenCalledWith(lastSendArgs);
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
    const after = qc.getQueryData<ChatMessage[]>(chatMessagesQueryKey('chat-1'));
    expect(after?.some((m) => m.id === 'assistant-1')).toBe(true);
  });

  it('case E — content collision; trailing is assistant; "hello" matches user-1 content → fresh send (role-based)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), [
      makeMessage({ id: 'user-1', role: 'user', contentJson: 'hello' }),
      makeMessage({ id: 'assistant-1', role: 'assistant', contentJson: 'hi back' }),
    ]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'hello', enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    await act(async () => {
      await result.current.onRetry();
    });

    // Role-based detection: trailing is assistant, regardless of content matching.
    expect(onSend).toHaveBeenCalledWith(lastSendArgs);
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('rapid-fire edge — X1 succeeded, X2 sent + failed pre-persist; trailing is X1-assistant after refetch → fresh send X2', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // After the post-X1 refetch lands and X2 fails pre-persist, the cache
    // trailing is X1's assistant. Trailing-role correctly picks fresh send;
    // a captured-at-onMutate lastIdBefore would have falsely fired retry: true.
    qc.setQueryData(chatMessagesQueryKey('chat-1'), [
      makeMessage({ id: 'older-user', role: 'user', contentJson: 'older' }),
      makeMessage({ id: 'older-asst', role: 'assistant', contentJson: 'older-reply' }),
      makeMessage({ id: 'X1-user', role: 'user', contentJson: 'X1' }),
      makeMessage({ id: 'X1-assistant', role: 'assistant', contentJson: 'X1-reply' }),
    ]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'X2', enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    await act(async () => {
      await result.current.onRetry();
    });

    expect(onSend).toHaveBeenCalledWith(lastSendArgs);
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
    // X1's assistant is preserved.
    const after = qc.getQueryData<ChatMessage[]>(chatMessagesQueryKey('chat-1'));
    expect(after?.some((m) => m.id === 'X1-assistant')).toBe(true);
  });

  it('isDispatching is true during the inspect-and-decide window', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Register a slow queryFn so qc.refetchQueries actually awaits something
    // observable — without this, refetch on a populated cache could resolve
    // synchronously, leaving the timing of the isDispatching=true assertion
    // dependent on internal microtask ordering rather than the explicit
    // refetch step.
    qc.setQueryDefaults(chatMessagesQueryKey('chat-1'), {
      queryFn: () =>
        new Promise<ChatMessage[]>((resolve) => setTimeout(() => resolve([]), 30)),
      retry: false,
    });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), []);

    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'X', enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    expect(result.current.isDispatching).toBe(false);
    let promise: Promise<void>;
    act(() => {
      promise = result.current.onRetry();
    });
    // Synchronous setIsDispatching(true) ran; refetch is still in flight.
    expect(result.current.isDispatching).toBe(true);
    await act(async () => {
      await promise;
    });
    expect(result.current.isDispatching).toBe(false);
  });

  it('returns no-op when lastSendArgs is null or chatId/modelId missing', async () => {
    const qc = new QueryClient();
    const onSend = vi.fn();
    const mutation = makeFakeMutation();
    const { result } = renderHook(
      () => {
        const ref = useRef(null);
        return useBannerRetry({
          chatId: null,
          selectedModelId: null,
          mutation,
          lastSendArgsRef: ref as never,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );
    await act(async () => {
      await result.current.onRetry();
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — FAIL**

```bash
cd frontend && npx vitest run tests/hooks/useBannerRetry.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useBannerRetry` hook (trailing-role)**

Create `frontend/src/hooks/useBannerRetry.ts`:

```ts
import { useCallback, useState, type MutableRefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  type ChatMessage,
  chatMessagesQueryKey,
  type useSendChatMessageMutation,
} from '@/hooks/useChat';
import type { SendArgs as ChatSendArgs } from '@/components/ChatComposer';

export interface UseBannerRetryOptions {
  chatId: string | null;
  selectedModelId: string | null;
  mutation: ReturnType<typeof useSendChatMessageMutation>;
  lastSendArgsRef: MutableRefObject<ChatSendArgs | null>;
  onSend: (args: ChatSendArgs) => Promise<void>;
}

export interface UseBannerRetryResult {
  onRetry: () => Promise<void>;
  isDispatching: boolean;
}

/**
 * Banner-retry dispatch logic shared by ChatTab and SceneTab.
 *
 * Refetches the messages query unconditionally, then reads the cache's
 * trailing-message role. If trailing is a user message, the user just
 * persisted with no following assistant (case B — mid-stream error) and
 * the right call is `{retry: true}` to regenerate. If trailing is an
 * assistant or undefined, the user did not persist (cases A/D/E +
 * rapid-fire-edge) and the right call is a fresh `onSend(lastSendArgs)`.
 *
 * The refetch is unconditional because the cache is stale on the error
 * path (invalidateQueries fires from `onSuccess`, not `onError`); a
 * "skip the refetch" fast-path can't reliably distinguish stale from
 * fresh, so consistent behavior beats a hypothetical optimization.
 *
 * `isDispatching` is true synchronously after click and stays true
 * through the refetch + dispatch decision; the banner button uses
 * this to disable itself during the click-to-decision window in
 * addition to gating on `mutation.isPending` once the actual mutation
 * fires.
 */
export function useBannerRetry({
  chatId,
  selectedModelId,
  mutation,
  lastSendArgsRef,
  onSend,
}: UseBannerRetryOptions): UseBannerRetryResult {
  const qc = useQueryClient();
  const [isDispatching, setIsDispatching] = useState(false);

  const onRetry = useCallback(async (): Promise<void> => {
    const last = lastSendArgsRef.current;
    if (last === null || chatId === null || selectedModelId === null) return;
    setIsDispatching(true);
    try {
      await qc.refetchQueries({ queryKey: chatMessagesQueryKey(chatId) });
      const after =
        qc.getQueryData<ChatMessage[]>(chatMessagesQueryKey(chatId)) ?? [];
      const trailing = after[after.length - 1];

      if (trailing?.role === 'user') {
        await mutation.mutateAsync({
          chatId,
          modelId: selectedModelId,
          retry: true,
        });
      } else {
        await onSend(last);
      }
    } finally {
      setIsDispatching(false);
    }
  }, [chatId, selectedModelId, mutation, qc, onSend, lastSendArgsRef]);

  return { onRetry, isDispatching };
}
```

- [ ] **Step 4: Run hook tests**

```bash
cd frontend && npx vitest run tests/hooks/useBannerRetry.test.tsx
```

Expected: All 7 pass (A, B, D, E, rapid-fire-edge, isDispatching, no-op).

- [ ] **Step 5: Wire `useBannerRetry` into ChatTab**

In `frontend/src/components/ChatTab.tsx`, replace the existing `onRetry`:

```tsx
const onRetry = useCallback((): void => {
  const last = lastChatSendArgsRef.current;
  if (last === null) return;
  void onSend(last);
}, [onSend]);
```

with:

```tsx
import { useBannerRetry } from '@/hooks/useBannerRetry';

// ... inside the component, after sendChatMessage / onSend / lastChatSendArgsRef are defined:
const { onRetry, isDispatching } = useBannerRetry({
  chatId: activeChatId,
  selectedModelId,
  mutation: sendChatMessage,
  lastSendArgsRef: lastChatSendArgsRef,
  onSend,
});
```

Then update the `<TranscriptView>` invocation to pass the dispatch state:

```tsx
<TranscriptView
  chatId={activeChatId}
  emptyState={<ChatEmptyState />}
  sendError={sendChatMessage.error}
  onRetrySend={() => { void onRetry(); }}
  disableRetrySend={sendChatMessage.isPending || isDispatching}
>
```

- [ ] **Step 6: Run typecheck + lint:design + full frontend test suite**

```bash
cd frontend && npm run typecheck && npm run lint:design && npm test
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useBannerRetry.ts frontend/src/components/ChatTab.tsx frontend/tests/hooks/useBannerRetry.test.tsx
git commit -m "[ai-surfaces-v1] frontend: useBannerRetry hook (cache-inspection dispatch closes Case D); wired into ChatTab"
```

---

# Phase 7 — Scene migration

## Task 16: Migrate `SceneTab` to `useSendChatMessageMutation` + TranscriptView + rows

**Files:**
- Create: `frontend/src/components/SceneEmptyState.tsx`
- Modify: `frontend/src/components/SceneTab.tsx`

**Context:** Drop the local `useSceneTranscript` hook. Use `useSendChatMessageMutation` directly (same as Chat). Replace inline scroll/autoscroll logic with `<TranscriptView>`. Replace `renderTranscript` walker with the same render-prop pattern Chat uses, plus Scene-specific actions (`<InsertAtEndAction>`).

- [ ] **Step 1: Create SceneEmptyState**

Create `frontend/src/components/SceneEmptyState.tsx`:

```tsx
import type { JSX } from 'react';

export function SceneEmptyState(): JSX.Element {
  return (
    <div className="m-auto flex flex-col items-center gap-3 text-center" data-testid="scene-empty">
      <div className="font-serif italic text-[15px] text-ink-3 max-w-[280px]">
        Describe what happens next — a scene, a beat, an action — and the assistant will draft
        it in your voice.
      </div>
      <div className="text-[11px] font-mono text-ink-4">
        Try: &ldquo;Jenny approaches Linda on the veranda and they talk about cheese.&rdquo;
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `SceneTab.tsx`**

Replace the entire file body. Keep the imports/exports/types and replace the implementation body. The new flow:

```tsx
import type { Editor as TiptapEditor } from '@tiptap/core';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import {
  AssistantMessageRow,
  CopyAction,
  InsertAtEndAction,
  MessageActions,
  RegenerateAction,
  TranscriptView,
  UserMessageRow,
} from '@/components/messageRow';
import { ChatComposer, type SendArgs as ChatSendArgs } from '@/components/ChatComposer';
import { SceneEmptyState } from '@/components/SceneEmptyState';
import { SessionPicker, type SessionPickerLabels } from '@/components/SessionPicker';
import {
  type ChatMessage,
  useChatsQuery,
  useCreateChatMutation,
  useRemoveChatMutation,
  useRenameChatMutation,
  useSendChatMessageMutation,
} from '@/hooks/useChat';
import { useBannerRetry } from '@/hooks/useBannerRetry';
import { useSoftDelete } from '@/hooks/useSoftDelete';
import { useUserSettings } from '@/hooks/useUserSettings';
import { checkChatSendGuards } from '@/lib/chatSendGuards';
import { truncateAtWordBoundary } from '@/lib/strings';
import { useErrorStore } from '@/store/errors';
import { UndoToast } from './UndoToast';

export interface SceneTabProps {
  chapterId: string | null;
  editor: TiptapEditor | null;
}

const TITLE_MAX_CHARS = 50;

const SCENE_LABELS: SessionPickerLabels = {
  kindLabel: 'SCENE',
  ariaPrefix: 'Scene session: ',
  dropdownHeader: 'Scenes in this chapter',
  newButtonLabel: 'New scene',
};

export function SceneTab({ chapterId, editor }: SceneTabProps): JSX.Element {
  const settings = useUserSettings();
  const selectedModelId = settings.chat.model;

  const chatsQuery = useChatsQuery(chapterId, { kind: 'scene' });
  const sessions = chatsQuery.data ?? [];

  const createChat = useCreateChatMutation();
  const renameChat = useRenameChatMutation(chapterId, 'scene');
  const removeChat = useRemoveChatMutation(chapterId, 'scene');
  const sendChatMessage = useSendChatMessageMutation();

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const lastSceneSendArgsRef = useRef<ChatSendArgs | null>(null);

  useEffect(() => {
    if (activeChatId === null && sessions.length > 0) {
      setActiveChatId(sessions[0].id);
      return;
    }
    if (activeChatId !== null && !sessions.some((s) => s.id === activeChatId)) {
      setActiveChatId(sessions[0]?.id ?? null);
    }
  }, [activeChatId, sessions]);

  const {
    pending: pendingDeletes,
    isPending: isDeletePending,
    scheduleDelete,
    undo: undoDelete,
  } = useSoftDelete((id: string) => removeChat.mutateAsync(id), { timeoutMs: 5_000 });

  const onSend = useCallback(
    async (args: ChatSendArgs): Promise<void> => {
      const guard = checkChatSendGuards({
        activeChapterId: chapterId,
        selectedModelId,
      });
      if (guard) {
        useErrorStore.getState().push(guard);
        return;
      }
      const cId = chapterId as string;
      const mId = selectedModelId as string;

      let chatId = activeChatId;
      if (chatId === null) {
        const created = await createChat.mutateAsync({ chapterId: cId, kind: 'scene' });
        chatId = created.id;
        setActiveChatId(chatId);
      }
      const isFirstTurn =
        sessions.find((s) => s.id === chatId)?.messageCount === 0 ||
        sessions.find((s) => s.id === chatId) === undefined;

      lastSceneSendArgsRef.current = args;
      await sendChatMessage.mutateAsync({
        chatId,
        content: args.content,
        modelId: mId,
        // Thread enableWebSearch from the composer through to the backend.
        // ChatComposer surfaces the toggle in both Chat and Scene tabs; not
        // forwarding it here would silently disable web search in Scene
        // even when the user has the toggle on.
        enableWebSearch: args.enableWebSearch,
      });

      if (isFirstTurn) {
        const title = truncateAtWordBoundary(args.content, TITLE_MAX_CHARS);
        try {
          await renameChat.mutateAsync({ id: chatId, title });
        } catch {
          // non-fatal
        }
      }
    },
    [chapterId, selectedModelId, activeChatId, sessions, createChat, renameChat, sendChatMessage],
  );

  // Banner-retry dispatch — same hook ChatTab uses; deterministic four-case
  // table tested in tests/hooks/useBannerRetry.test.tsx.
  const { onRetry, isDispatching } = useBannerRetry({
    chatId: activeChatId,
    selectedModelId,
    mutation: sendChatMessage,
    lastSendArgsRef: lastSceneSendArgsRef,
    onSend,
  });

  const onRegenerate = useCallback(() => {
    if (activeChatId === null || selectedModelId === null) return;
    void sendChatMessage.mutateAsync({
      chatId: activeChatId,
      modelId: selectedModelId,
      retry: true,
    });
  }, [activeChatId, selectedModelId, sendChatMessage]);

  const onCopy = useCallback((message: ChatMessage) => {
    const text =
      typeof message.contentJson === 'string'
        ? message.contentJson
        : JSON.stringify(message.contentJson);
    void navigator.clipboard?.writeText(text);
  }, []);

  const onInsert = useCallback(
    (message: ChatMessage) => {
      if (!editor) return;
      const text =
        typeof message.contentJson === 'string'
          ? message.contentJson
          : JSON.stringify(message.contentJson);
      const docEnd = editor.state.doc.content.size;
      editor.chain().focus().insertContentAt(docEnd, text).run();
    },
    [editor],
  );

  const onDelete = useCallback(
    (id: string) => {
      const c = sessions.find((s) => s.id === id);
      if (!c) return;
      scheduleDelete(id, c.title ?? 'Untitled');
      if (activeChatId === id) {
        const remaining = sessions.filter((s) => s.id !== id);
        setActiveChatId(remaining[0]?.id ?? null);
      }
    },
    [sessions, scheduleDelete, activeChatId],
  );

  const onRename = useCallback(
    (id: string, title: string) => {
      void renameChat.mutateAsync({ id, title });
    },
    [renameChat],
  );

  const onNew = useCallback((): void => {
    if (chapterId === null) return;
    void createChat.mutateAsync({ chapterId, kind: 'scene' }).then((c) => {
      setActiveChatId(c.id);
    });
  }, [chapterId, createChat]);

  const visibleSessions = sessions.filter((s) => !isDeletePending(s.id));
  const pendingEntries = Array.from(pendingDeletes.entries());
  const lastPending = pendingEntries.length > 0 ? pendingEntries[pendingEntries.length - 1] : null;

  return (
    <div className="flex flex-col h-full" data-testid="scene-tab">
      <SessionPicker
        labels={SCENE_LABELS}
        sessions={visibleSessions.map((s) => ({
          id: s.id,
          title: s.title ?? 'Untitled',
          updatedAt: s.updatedAt,
        }))}
        activeSessionId={activeChatId}
        onSelect={setActiveChatId}
        onRename={onRename}
        onDelete={onDelete}
        onNew={onNew}
      />

      <TranscriptView
        chatId={activeChatId}
        emptyState={<SceneEmptyState />}
        sendError={sendChatMessage.error}
        onRetrySend={() => {
          void onRetry();
        }}
        disableRetrySend={sendChatMessage.isPending || isDispatching}
      >
        {(rows) =>
          rows.map((r, i) => {
            if (r.kind === 'persisted' && r.message.role === 'user') {
              return <UserMessageRow key={r.message.id} message={r.message} />;
            }
            if (r.kind === 'persisted' && r.message.role === 'assistant') {
              return (
                <AssistantMessageRow
                  key={r.message.id}
                  message={r.message}
                  actions={
                    <MessageActions>
                      <InsertAtEndAction onClick={() => onInsert(r.message)} />
                      <CopyAction onClick={() => onCopy(r.message)} />
                      <RegenerateAction
                        onClick={onRegenerate}
                        disabled={sendChatMessage.isPending}
                      />
                    </MessageActions>
                  }
                />
              );
            }
            if (r.kind === 'draft-user') {
              return (
                <UserMessageRow
                  key={`draft-user-${i}`}
                  message={{
                    id: 'draft-user',
                    role: 'user',
                    contentJson: r.userContent,
                    attachmentJson: r.attachment,
                    citationsJson: null,
                    model: null,
                    tokens: null,
                    latencyMs: null,
                    createdAt: new Date().toISOString(),
                  }}
                />
              );
            }
            if (r.kind === 'draft-assistant') {
              return (
                <AssistantMessageRow
                  key={`draft-assistant-${i}`}
                  message={{
                    id: 'draft-assistant',
                    role: 'assistant',
                    contentJson: r.assistantText,
                    attachmentJson: null,
                    citationsJson: null,
                    model: null,
                    tokens: null,
                    latencyMs: null,
                    createdAt: new Date().toISOString(),
                  }}
                  actions={null}
                  isStreaming
                  thinkingLabel="Generating scene…"
                />
              );
            }
            return null;
          })
        }
      </TranscriptView>

      <div className="relative">
        {lastPending !== null && (
          <div className="absolute left-3 right-3 bottom-[calc(100%+8px)] z-20">
            <UndoToast
              key={lastPending[0]}
              title={lastPending[1].title}
              onUndo={() => {
                undoDelete(lastPending[0]);
              }}
              timeoutMs={5000}
            />
          </div>
        )}
        <ChatComposer
          onSend={onSend}
          disabled={sendChatMessage.isPending}
          state={sendChatMessage.isPending ? 'streaming' : 'idle'}
          onStop={sendChatMessage.stop}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck + lint:design**

```bash
cd frontend && npm run typecheck && npm run lint:design
```

Expected: No errors.

- [ ] **Step 4: Run scene-related tests**

```bash
cd frontend && npx vitest run tests/components/SceneTab.test.tsx
```

Expected: Existing scene tests will likely fail because the harness is mocking `useSceneTranscript` or asserting `SceneCandidateCard` rendering. Update them.

**Test cases that MUST be preserved** (rewritten to use the new layer; coverage is load-bearing for Scene's UX):

1. **Session picker integration** — create scene → session appears; rename inline → updates; delete → soft-delete with undo toast; click switches active.
2. **Auto-rename on first turn** — first scene direction generates a session title via `truncateAtWordBoundary`. Both for explicit-create-then-send and inline-create-on-send paths.
3. **Hydration error UX** — failed messages query renders `<TranscriptView>`'s unified error banner with a Retry button that calls `query.refetch()`. (Replaces today's bespoke "Couldn't load transcript. Try switching sessions." copy.)
4. **Insert-at-end** — clicking the action on an assistant row inserts the candidate text into the editor at doc-end via `editor.chain().focus().insertContentAt(docEnd, text).run()`. Verify with a mock editor.
5. **Retry semantics** — clicking Regenerate on a trailing assistant fires `mutateAsync({retry: true})` (linear). Older "two candidates persist after retry" assertions go away.
6. **Stop during streaming** — clicking Stop aborts the in-flight stream; subsequent Regenerate works.
7. **Soft-delete with undo** — undo cancels the pending delete; previously-active session becomes restorable.
8. **`enableWebSearch` propagation** — composer's web-search toggle passes through to `mutateAsync({enableWebSearch: true})`. New coverage; previously absent.
9. **Send error → banner retry** — failed send shows `<InlineErrorBanner>` via `sendError`; the banner's Retry button drives `useBannerRetry` dispatch.

**Test refactor patterns:**
- Replace `useSceneTranscript` mocks with TanStack Query cache seeding (`qc.setQueryData(chatMessagesQueryKey(...), [...])` and `useChatDraftStore.setState({ drafts: { ... } })`).
- Replace `SceneCandidateCard`-internal assertions with `AssistantMessageRow` selectors via `data-testid="assistant-${id}"` and the action buttons' `aria-label`s.
- The "superseded" marker test deletes outright — semantic gone.
- Where rewriting is genuinely tricky, look at the corresponding ChatTab test for the same pattern (banner retry, send guards, mutation isPending gating).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SceneEmptyState.tsx frontend/src/components/SceneTab.tsx frontend/tests/components/SceneTab.test.tsx
git commit -m "[ai-surfaces-v1] frontend: SceneTab uses useSendChatMessageMutation + TranscriptView + shared rows"
```

---

## Task 17: Delete `useSceneTranscript`, `useSceneTranscriptStore`, `SceneCandidateCard`

**Files:**
- Delete: `frontend/src/hooks/useSceneTranscript.ts`
- Delete: `frontend/src/store/sceneTranscript.ts`
- Delete: `frontend/src/components/SceneCandidateCard.tsx` and any stories file
- Delete: their respective test files

**Context:** Now unreferenced. `git grep` to confirm.

- [ ] **Step 1: Confirm no remaining references**

```bash
cd frontend && git grep -l "useSceneTranscript\|sceneTranscript\|SceneCandidateCard" -- src tests
```

Expected: No matches (or only matches inside the files that are about to be deleted).

- [ ] **Step 2: Delete the files**

```bash
cd frontend && git rm \
  src/hooks/useSceneTranscript.ts \
  src/store/sceneTranscript.ts \
  src/components/SceneCandidateCard.tsx \
  tests/hooks/useSceneTranscript.test.tsx 2>/dev/null \
  tests/store/sceneTranscript.test.tsx 2>/dev/null \
  tests/components/SceneCandidateCard.test.tsx 2>/dev/null \
  src/components/SceneCandidateCard.stories.tsx 2>/dev/null \
  || true
```

(Some test/story files may not exist — `|| true` keeps the script idempotent.)

- [ ] **Step 3: Run typecheck + lint:design + full test suite**

```bash
cd frontend && npm run typecheck && npm run lint:design && npm test
```

Expected: All green.

- [ ] **Step 4: Commit**

```bash
git commit -m "[ai-surfaces-v1] frontend: delete useSceneTranscript + sceneTranscriptStore + SceneCandidateCard (Scene now uses shared transcript layer)"
```

---

# Phase 8 — Cleanup

## Task 18: Delete `streamMessage` from `lib/api.ts`

**Files:**
- Modify: `frontend/src/lib/api.ts` (delete lines around 380-479)

**Context:** Was used only by `useSceneTranscript`, which is now gone.

- [ ] **Step 1: Confirm no callers**

```bash
cd frontend && git grep "streamMessage\|StreamMessageBody\|StreamMessageOpts" -- src tests
```

Expected: No matches outside `lib/api.ts` itself.

- [ ] **Step 2: Delete the function + its interfaces**

Open `frontend/src/lib/api.ts` and remove:
- The `StreamMessageBody` interface (around line 386-400).
- The `StreamMessageOpts` interface (around line 402-407).
- The `streamMessage` function (around line 409-479).

- [ ] **Step 3: Run typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "[ai-surfaces-v1] frontend: delete streamMessage (sole consumer was the now-deleted useSceneTranscript)"
```

---

## Task 19: Delete `ChatMessages.tsx` + `ContextChip` block + dead props

**Files:**
- Delete: `frontend/src/components/ChatMessages.tsx`
- Delete: `frontend/tests/components/ChatMessages.test.tsx` (if exists)
- (Confirms 7at — context chip is gone)

**Context:** ChatMessages is no longer imported. The dashed-border `<ContextChip>` and the unused `attachedCharacterCount`/`attachedTokenCount` props go with it.

- [ ] **Step 1: Confirm no remaining imports**

```bash
cd frontend && git grep "ChatMessages" -- src tests | grep -v "messageRow\|^.*\.snap"
```

Expected: No matches.

- [ ] **Step 2: Delete the files**

```bash
cd frontend && git rm \
  src/components/ChatMessages.tsx \
  tests/components/ChatMessages.test.tsx 2>/dev/null \
  || true
```

- [ ] **Step 3: Search for any other dead context-chip references**

```bash
cd frontend && git grep "ContextChip\|context-chip\|attachedCharacterCount\|attachedTokenCount" -- src tests
```

Expected: No matches. (If ChatMessages was the only place these existed, deletion was sufficient. Otherwise edit out the remaining references.)

- [ ] **Step 4: Run typecheck + lint:design + full test suite**

```bash
cd frontend && npm run typecheck && npm run lint:design && npm test
```

Expected: All green.

- [ ] **Step 5: Commit**

```bash
git commit -m "[ai-surfaces-v1] frontend: delete ChatMessages + dead context-chip code (closes story-editor-7at)"
```

---

## Task 20: Final integration sweep — full backend + frontend test runs, leak test, manual smoke

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full backend test suite**

```bash
cd backend && npm test
```

Expected: All green. Encryption leak test ([E12]) green.

- [ ] **Step 2: Run the full frontend test suite**

```bash
cd frontend && npm test && npm run typecheck && npm run lint:design
```

Expected: All green.

- [ ] **Step 3: Bring up the dev stack and smoke-test manually**

```bash
make dev
```

Open http://localhost:3000. Sign in. In a story:
- Send a Chat message; confirm assistant appears, autoscroll pins to bottom, model badge + tokens·latency render under the assistant turn.
- Click Regenerate on the assistant; confirm the prior assistant is replaced (not duplicated).
- Trigger a send error (disconnect network briefly) and click banner Retry; confirm fresh send happens (case A/D shape — fresh content arrives).
- Switch to Scene tab; describe a scene; confirm Generate works, Insert at end works, autoscroll works, Regenerate works (single linear replacement, no candidates).
- Verify Scene's web-search toggle propagates: enable the composer's web-search toggle, generate; backend logs / response shows `enableWebSearch=true` reached the route.
- **Stop-during-retry transient state.** Click Regenerate on a Chat assistant, then immediately click Stop while streaming. Confirm the chat ends with `[user, no trailing assistant]` (route's `deleteAllAfter` ran before the abort cancelled the replacement). Click Regenerate again; confirm a new assistant is generated. No data loss beyond the partial generation.
- **Cross-tab concurrent streaming.** Open two tabs in the same story (Chat in tab A, Scene in tab B). Send in Chat; while it's streaming, switch to Scene and Generate. Confirm both stream concurrently without clobbering each other's drafts (verify by seeing draft-assistant text grow in both tabs over time).

- [ ] **Step 4: Commit any test fixture cleanups discovered during smoke**

```bash
git add -p
git commit -m "[ai-surfaces-v1] tests: minor harness cleanups discovered during integration smoke"
```

(Skip if nothing to commit.)

- [ ] **Step 5: Push the branch + open PR**

```bash
git push -u origin feature/ai-surfaces-v1
gh pr create --title "[ai-surfaces-v1] AI surfaces unification: streaming + transcript + rows + retry semantics" --body "$(cat <<'EOF'
## Summary

Collapses Chat and Scene's parallel transcript implementations into one shared layer at three levels (streaming utility, transcript container, per-message rows) and fixes the latent retry-prompt-construction quirk in the backend.

Closes:
- story-editor-a0s — Extract useStreamingAI primitive
- story-editor-y5v — Extract shared transcript-container
- story-editor-a9v — Align per-message UX furniture
- story-editor-458 — Chat Regenerate not wired
- story-editor-7at — Remove ContextChip from ChatMessages

Spec: docs/superpowers/specs/2026-05-09-ai-surfaces-unification-design.md
Plan: docs/superpowers/plans/2026-05-09-ai-surfaces-unification.md

## Test plan

- [ ] All existing backend tests green
- [ ] All existing frontend tests green
- [ ] New tests: `deleteAllAfter` repo (id-based + tiebreaker + ownership), `runStreamingAI` utility (chunk/citations/error/empty-body/headers/no-DONE), keyed draft store isolation (per-chatId slot), all primitives, UserMessageRow, AssistantMessageRow (with thinking-bubble gating), TranscriptView (autoscroll/session-reset/merge/error UX/draft-user suppression cases), `useBannerRetry` dispatch (cases A/B/D/E + rapid-fire-edge + isDispatching + null-args)
- [ ] Encryption leak test ([E12]) green
- [ ] Manual smoke: Chat send + retry + regenerate; Scene generate + insert + retry + regenerate; cross-tab concurrent streaming

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Plan summary

18 tasks across 8 phases (numbered 1-20 with Tasks 7 and 9 as deferred-placeholder gaps explaining historical revisions, not work). Each task has TDD-shaped steps + a commit. Sequential execution preserves green-test states between phases. Each phase is reviewable in its own commit.

**Per-task model selection:** All tasks default to Sonnet (per `bd-execute`'s defaults). No tasks need Opus — the design synthesis happened during the spec's brainstorm; implementation here is structured TDD work.

**Touch-set for `bd-execute` rules digests:** This plan touches `backend/src/repos/`, `backend/src/routes/`, `backend/src/`, `frontend/src/lib/`, `frontend/src/components/`, `frontend/src/store/`, `frontend/src/hooks/`. Per `docs/agent-rules/index.md`, expect digests covering backend rules, repo-boundary, and frontend rules to be prepended to implementer dispatches.
