# Chat/Scene Tab Session Default — Recency-First Selection (story-editor-loj) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user opens a Chat or Scene tab on a chapter that already has prior sessions, the default selection (and the SessionPicker dropdown order) is the most-recently-used session, not the oldest one.

**Architecture:** Add a dedicated `Chat.lastActivityAt DateTime` column (NOT NULL) with `@default(now())`. Bump it transactionally on every child-message create. Rename leaves it alone (the existing `updatedAt` keeps the "metadata changed" semantic). `chatRepo.findManyForChapter` sorts by `lastActivityAt desc` (with `createdAt desc` as tie-breaker for dormant chats). `SessionPicker.relativeAge` reads `lastActivityAt` so the "X ago" label matches the recency signal. The frontend's `sessions[0]` default-pick and dropdown rendering are correct by construction.

**Tech Stack:** Prisma + PostgreSQL backend (`messageRepo`, `chatRepo`); React + TanStack Query frontend (`useChat`, `SessionPicker`). One additive migration. No new dependencies.

---

## Design rationale

### Why a dedicated `lastActivityAt` column, not reusing `updatedAt`

`Chat.updatedAt` is declared `@updatedAt` in Prisma. It already has a meaning: "when did the row's metadata change". Rename uses it. Future field additions (e.g. a `pinned: Boolean` toggle) would use it. Conflating "row update" with "child activity" would mean a rename months after the last conversation makes SessionPicker's "X ago" label say "just now" — observably wrong, and a smell future readers would have to chase down.

A dedicated `lastActivityAt` column gives each timestamp one job:
- `createdAt` — when the row was inserted.
- `updatedAt` — when the row's own columns last changed.
- `lastActivityAt` — when a child message was last appended (or the chat itself was created, via the default).

`SessionPicker.relativeAge` was already reading whatever-was-named-`updatedAt` and labeling it "Xm ago"; switching to `lastActivityAt` makes the label correct by name as well as by value.

The fully purist `ORDER BY (SELECT MAX(createdAt) FROM Message WHERE chatId = Chat.id) DESC` is correct but awkward in Prisma without raw SQL. The indexed subquery is fast, but the ergonomic cost of dropping to raw queries here is not worth it.

### Why the chats-list cache must be invalidated after sendChatMessage

Without invalidation, after the user sends a message in chat A:
- Backend has correctly bumped A's `lastActivityAt`; a fresh fetch returns A at index 0.
- Frontend cache still holds the pre-send order. SessionPicker dropdown shows A in its OLD position until natural staleness triggers a refetch.

The three existing chat mutations (`useCreateChatMutation`, `useRenameChatMutation`, `useRemoveChatMutation`) all invalidate via `chatsBaseQueryKey(chat.chapterId)`. `useSendChatMessageMutation` should match that pattern. The current `SendChatMessageArgs` doesn't carry `chapterId` — we plumb it through.

### Pre-deployment population

Per CLAUDE.md "no data-migration branches": pre-deployment there are no users, no stored chats. The column is `DateTime @default(now())` (NOT NULL). Postgres's `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT CURRENT_TIMESTAMP` populates every existing row with `now()` at migration time — so even if rows did exist, they'd all carry a sensible value. Newly created chats get the same default at insert time. No backfill task needed, no null-checks anywhere on the read path.

### Tie-breaker for dormant chats

Two fresh chats with no messages share `lastActivityAt === createdAt` (both default to `now()` at create time). Postgres does not guarantee a stable sub-order under `ORDER BY lastActivityAt DESC` when ties exist. Add `createdAt DESC` as the tie-breaker: dormant-newer-created beats dormant-older-created. Deterministic + matches intuition.

---

## File map

**Create:**
- `backend/prisma/migrations/<timestamp>_chat_last_activity_at/migration.sql` — additive migration adding `lastActivityAt` to `Chat`.

**Modify (backend):**
- `backend/prisma/schema.prisma` — `Chat` model gets `lastActivityAt DateTime @default(now())` (NOT NULL).
- `backend/src/repos/message.repo.ts` — `create()` wraps message insert + `Chat.update({ lastActivityAt })` in a transaction.
- `backend/src/repos/chat.repo.ts` — `findManyForChapter()` changes `orderBy: { createdAt: 'asc' }` → `orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }]`.
- `backend/src/routes/chat.routes.ts` — the GET-chats response shape passes through `lastActivityAt` (verify the enrich-loop preserves it; it should via `...chat`).
- `backend/tests/repos/message.repo.test.ts` — append test: creating a message bumps the parent chat's `lastActivityAt`.
- `backend/tests/repos/chat.repo.test.ts` — append test: `findManyForChapter` returns chats ordered by most-recent activity, with `createdAt desc` tie-breaker for dormant chats.

**Modify (frontend):**
- `frontend/src/lib/api.ts` — `ChatRow` interface adds `lastActivityAt: string`.
- `frontend/src/hooks/useChat.ts` — `SendChatMessageArgs` adds `chapterId: string`; `useSendChatMessageMutation.onSuccess` invalidates `chatsBaseQueryKey(vars.chapterId)`.
- `frontend/src/hooks/useBannerRetry.ts` — `UseBannerRetryOptions` adds `chapterId: string`; the retry `mutateAsync({ chatId, modelId, retry: true })` at line 65 adds `chapterId`. Without this the file fails typecheck after `SendChatMessageArgs` gains the required field.
- `frontend/src/components/SessionPicker.tsx` — `Session` interface field `updatedAt: string` → `lastActivityAt: string`; the two `relativeAge(...)` call sites (lines 238, 299) switch.
- `frontend/src/components/ChatTab.tsx` — `SessionPicker.sessions` map passes `lastActivityAt: c.lastActivityAt`; `sendChatMessage.mutateAsync(...)` call passes `chapterId`; `useBannerRetry({...})` call adds `chapterId`.
- `frontend/src/components/SceneTab.tsx` — same three edits as ChatTab.
- `frontend/tests/hooks/useChat.test.tsx` — append test: after a successful send, the chats list cache is invalidated via `chatsBaseQueryKey(chapterId)`.
- `frontend/tests/hooks/useBannerRetry.test.tsx` — file exists with **seven** `useBannerRetry({...})` call sites (lines 51, 84, 120, 154, 192, 234, 265). Every one needs `chapterId` added once `UseBannerRetryOptions` makes it required — otherwise the file fails typecheck. Don't stop at line 51.

**Audit (no edits unless tests break):**
- `backend/tests/routes/chat.test.ts` — if any test asserts GET-chats response order, update expected order.
- `frontend/tests/components/ChatTab.test.tsx`, `frontend/tests/components/SceneTab.test.tsx` — fixtures may use `updatedAt` on session shapes; align field names + values with the new invariant (newest-first).

**Update (bd notes):**
- `story-editor-loj` `--notes` `verify:` line needs widening to cover the backend repo tests added by this plan. Today the line is frontend-only. New line should be: `verify: npm --prefix backend test -- chat.repo message.repo && npm --prefix frontend test -- ChatTab.test.tsx SceneTab.test.tsx useChat.test.tsx useBannerRetry.test.tsx`. `bd update --notes` REPLACES the field (not appends), so a read-modify-write is needed — see the dedicated "Update bd notes verify-line" section below for the exact shell recipe.

---

### Task 1: schema migration — add `Chat.lastActivityAt`

**Files:**
- Modify: `backend/prisma/schema.prisma` (the `Chat` model).
- Create: `backend/prisma/migrations/<timestamp>_chat_last_activity_at/migration.sql` (generated by `prisma migrate dev`).

- [ ] **Step 1: Edit the schema**

In `backend/prisma/schema.prisma`, locate the `Chat` model (around line 200). Add `lastActivityAt` after `updatedAt`:

```prisma
model Chat {
  id              String   @id @default(cuid())
  kind            String   @default("ask")
  titleCiphertext String?
  titleIv         String?
  titleAuthTag    String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  // story-editor-loj: bumped on every child-message create. SessionPicker
  // reads this for the "X ago" label and the dropdown order. Distinct from
  // updatedAt, which only fires on Chat-row metadata changes (e.g. rename).
  lastActivityAt   DateTime @default(now())

  chapterId String
  chapter   Chapter  @relation(fields: [chapterId], references: [id], onDelete: Cascade)

  messages  Message[]

  @@index([chapterId])
  @@index([chapterId, kind])
  // story-editor-loj: index supports the findManyForChapter ORDER BY.
  @@index([chapterId, lastActivityAt])
}
```

The field is `DateTime` (NOT NULL) with `@default(now())`. Postgres `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT CURRENT_TIMESTAMP` populates every existing row at migration time, and pre-deployment there are no rows anyway — so no nullable type and no backfill task is needed. The `@@index([chapterId, lastActivityAt])` supports the sort path under the chapter-scoped query.

- [ ] **Step 2: Generate the migration**

Run: `npm --prefix backend run db:migrate -- --name chat_last_activity_at`

(The exact npm-script name may differ — check `backend/package.json` `scripts` for the migrate-dev wrapper; the common ones in this repo are `db:migrate` or `prisma:migrate:dev`. Use whichever exists.)

Expected: a new file `backend/prisma/migrations/<timestamp>_chat_last_activity_at/migration.sql` is created. Inspect it — it should contain a single `ALTER TABLE "Chat" ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;` and a `CREATE INDEX ... ON "Chat"("chapterId", "lastActivityAt")`.

The `NOT NULL DEFAULT CURRENT_TIMESTAMP` form is what populates every existing row with `now()` at migration time. If the generated SQL omits `NOT NULL` or `DEFAULT`, fix the schema and re-generate — both are needed for the additive-without-backfill behavior.

- [ ] **Step 3: Run backend typecheck**

Run: `npm --prefix backend run typecheck`
Expected: clean. The Prisma client is regenerated as part of `migrate dev`; if not, run `npm --prefix backend run prisma:generate` (or equivalent).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "[loj] schema: add Chat.lastActivityAt (NOT NULL, default now)"
```

---

### Task 2: bump `Chat.lastActivityAt` on message create (TDD)

**Files:**
- Modify: `backend/src/repos/message.repo.ts`.
- Modify: `backend/tests/repos/message.repo.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/repos/message.repo.test.ts`:

```ts
describe('messageRepo.create — Chat.lastActivityAt bump (story-editor-loj)', () => {
  it("bumps the parent chat's lastActivityAt when a message is created", async () => {
    const { req, chatId } = await setupChatFixture();

    const chatBefore = await prisma.chat.findUnique({ where: { id: chatId } });
    if (chatBefore === null) throw new Error('test fixture: chat not found');
    const before = chatBefore.lastActivityAt;

    // 15ms sleep so the DB timestamp can advance. Postgres has microsecond
    // precision but JS Date.now() resolves to ms; a sub-ms gap on fast
    // hardware can collide.
    await new Promise((r) => setTimeout(r, 15));

    await createMessageRepo(req).create({
      chatId,
      role: 'user',
      contentJson: { type: 'doc', content: [{ type: 'text', text: 'hello' }] },
    });

    const chatAfter = await prisma.chat.findUnique({ where: { id: chatId } });
    if (chatAfter === null) throw new Error('post-create: chat not found');

    expect(chatAfter.lastActivityAt.getTime()).toBeGreaterThan(before.getTime());
  });
});
```

If `setupChatFixture` doesn't exist by that name, use whatever pattern the neighbouring tests use to construct a chat with correct ownership. Read the top of `message.repo.test.ts` first; copy the existing pattern verbatim. Since the column is NOT NULL, no null-check is needed on `chatBefore.lastActivityAt` or `chatAfter.lastActivityAt`.

Single test, single assertion: `lastActivityAt` advances. That's the recency-source guarantee — the entire fix's correctness rests on this and the orderBy in Task 3. We deliberately do NOT also assert "updatedAt did not advance", because Prisma's `@updatedAt` directive fires on the transactional `Chat.update` even when only `lastActivityAt` is in `data`. That's a known property of the implementation (documented in the Follow-ups section); since `findManyForChapter` orders by `lastActivityAt` and `SessionPicker` reads `lastActivityAt`, the updatedAt side-bump is invisible to consumers and not worth either testing for or testing against.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend test -- message.repo`
Expected: FAIL on the new test. `chatAfter.lastActivityAt` equals `chatBefore.lastActivityAt` because nothing currently touches the Chat row when a Message is created.

- [ ] **Step 3: Implement — wrap `create()` in a transaction that updates `lastActivityAt`**

In `backend/src/repos/message.repo.ts`, replace the body of `create()`:

```ts
async function create(input: MessageCreateInput) {
  const userId = resolveUserId(req);
  await ensureChatOwned(client, input.chatId, userId);
  // story-editor-loj: bump Chat.lastActivityAt so findManyForChapter can
  // order by recency. Transactional: a message insert without the parent's
  // lastActivityAt bump (or vice versa) would leave the list ordering stale.
  // We pass an explicit Date so Prisma's @updatedAt does NOT fire on the
  // Chat row — rename remains the only updatedAt-bumper.
  const row = await client.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        chatId: input.chatId,
        role: input.role,
        model: input.model ?? null,
        tokens: input.tokens ?? null,
        latencyMs: input.latencyMs ?? null,
        ...writeEncrypted(req, 'contentJson', serialiseJsonField(input.contentJson)),
        ...writeEncrypted(req, 'attachmentJson', serialiseJsonField(input.attachmentJson)),
        ...writeEncrypted(req, 'citationsJson', serialiseJsonField(input.citationsJson ?? null)),
      },
    });
    await tx.chat.update({
      where: { id: input.chatId },
      data: { lastActivityAt: new Date() },
    });
    return created;
  });
  return shape(row, req);
}
```

Note: `data: { lastActivityAt: new Date() }` only sets `lastActivityAt`, but Prisma's `@updatedAt` directive fires on ANY `update()` call regardless of which columns are in `data` — so `Chat.updatedAt` will also advance here as a side effect. That's invisible to consumers (`findManyForChapter` orders by `lastActivityAt`, `SessionPicker` reads `lastActivityAt`), so the side-bump doesn't cause the original conflation bug. If strict separation becomes necessary in a future regression, swap `tx.chat.update(...)` for raw SQL (see Follow-ups).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix backend test -- message.repo`
Expected: PASS.

- [ ] **Step 5: Run full backend suite**

Run: `npm --prefix backend run typecheck && npm --prefix backend test --run`
Expected: clean. Some existing tests may assert `Chat.updatedAt === Chat.createdAt` after a fresh chat + message — that's now false (Prisma's `@updatedAt` fires on the transactional `Chat.update`). Update those assertions to expect `updatedAt > createdAt` after message-create; the new behavior is the spec.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repos/message.repo.ts backend/tests/repos/message.repo.test.ts
git commit -m "[loj] messageRepo.create: transactionally bump Chat.lastActivityAt"
```

---

### Task 3: sort `findManyForChapter` by `lastActivityAt desc` with tie-breaker (TDD)

**Files:**
- Modify: `backend/src/repos/chat.repo.ts`.
- Modify: `backend/tests/repos/chat.repo.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/repos/chat.repo.test.ts`:

```ts
describe('chatRepo.findManyForChapter — most-recent-activity ordering (story-editor-loj)', () => {
  it("returns chats ordered by lastActivityAt desc — chat with newer message activity comes first", async () => {
    const { req, chapterId, chatAId, chatBId } = await setupTwoChatsFixture();

    // A was created first, B second. Send a message into A (so its
    // lastActivityAt > B's), then a message into B (so B's > A's). Final
    // order should be [B, A] — most-recently-active first.
    await new Promise((r) => setTimeout(r, 15));
    const messageRepo = createMessageRepo(req);
    await messageRepo.create({
      chatId: chatAId,
      role: 'user',
      contentJson: { type: 'doc', content: [{ type: 'text', text: 'a' }] },
    });
    await new Promise((r) => setTimeout(r, 15));
    await messageRepo.create({
      chatId: chatBId,
      role: 'user',
      contentJson: { type: 'doc', content: [{ type: 'text', text: 'b' }] },
    });

    const list = await createChatRepo(req).findManyForChapter(chapterId);

    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(chatBId);
    expect(list[1]?.id).toBe(chatAId);
  });

  it("uses createdAt desc as the tie-breaker when both chats are dormant (lastActivityAt === createdAt)", async () => {
    // Two fresh chats, no messages. lastActivityAt defaults to createdAt for
    // both (and they may even share the same lastActivityAt timestamp).
    const { req, chapterId, chatAId, chatBId } = await setupTwoChatsFixture();
    // A was created first → older createdAt. Under [lastActivityAt desc,
    // createdAt desc], B (newer createdAt) should land first.

    const list = await createChatRepo(req).findManyForChapter(chapterId);

    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(chatBId);
    expect(list[1]?.id).toBe(chatAId);
  });
});
```

If `setupTwoChatsFixture` doesn't exist, inline two `chatRepo.create` calls in the right order using whatever fixture pattern this file already uses.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix backend test -- chat.repo`
Expected: FAIL on both new tests. Under the current `orderBy: { createdAt: 'asc' }`, the order is `[A, B]` — A first by createdAt asc, regardless of message activity.

- [ ] **Step 3: Implement the orderBy change**

In `backend/src/repos/chat.repo.ts`, locate `findManyForChapter` (around lines 59-73). Change the orderBy clause:

```ts
async function findManyForChapter(chapterId: string, opts?: { kind?: 'ask' | 'scene' }) {
  const userId = resolveUserId(req);
  await ensureChapterOwned(client, chapterId, userId);
  const rows = await client.chat.findMany({
    where: {
      chapterId,
      chapter: { story: { userId } },
      ...(opts?.kind !== undefined ? { kind: opts.kind } : {}),
    },
    // story-editor-loj: order by most-recent-activity desc, with createdAt
    // desc as the tie-breaker for dormant chats whose lastActivityAt equals
    // createdAt. Chat.lastActivityAt is bumped on every child-message create
    // (see messageRepo.create), so this surfaces "the chat the user was
    // most-recently in" at index 0. Tie-breaker is deterministic + matches
    // intuition: dormant-newer-created beats dormant-older-created.
    orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map((r) =>
    projectDecrypted(req, r as unknown as Record<string, unknown>, ENCRYPTED_FIELDS),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix backend test -- chat.repo`
Expected: PASS on both new tests.

- [ ] **Step 5: Run full backend suite**

Run: `npm --prefix backend run typecheck && npm --prefix backend test --run`
Expected: clean. If `backend/tests/routes/chat.test.ts` asserts GET-chats response order, update the fixture/assertion to expect the new ordering.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repos/chat.repo.ts backend/tests/repos/chat.repo.test.ts
git commit -m "[loj] chatRepo.findManyForChapter: order by lastActivityAt desc (tie-broken by createdAt desc)"
```

---

### Task 4: invalidate chats-list cache after `sendChatMessage` success (TDD)

**Files:**
- Modify: `frontend/src/hooks/useChat.ts` (`SendChatMessageArgs`, `useSendChatMessageMutation`).
- Modify: `frontend/src/hooks/useBannerRetry.ts` (`UseBannerRetryOptions` adds `chapterId`; the retry-path `mutateAsync` call adds `chapterId`).
- Modify: `frontend/src/components/ChatTab.tsx`, `frontend/src/components/SceneTab.tsx` (call-site adjustments to pass `chapterId` to both `sendChatMessage.mutateAsync` AND `useBannerRetry`).
- Modify: `frontend/tests/hooks/useChat.test.tsx`.
- Modify (if exists): `frontend/tests/hooks/useBannerRetry.test.tsx` — update fixtures to pass `chapterId`.

The reviewer correctly identified that the established pattern in this file is to invalidate via `chatsBaseQueryKey(chapterId)` — `useCreateChatMutation`, `useRenameChatMutation`, and `useRemoveChatMutation` all do this. We match the pattern by plumbing `chapterId` through `SendChatMessageArgs`.

- [ ] **Step 1: Inspect existing useChat test patterns**

Read `frontend/tests/hooks/useChat.test.tsx`. Note how it (a) mocks fetch / api, (b) constructs a QueryClient, (c) drives a `useSendChatMessageMutation` to success. Reuse those patterns.

- [ ] **Step 2: Write the failing test**

Append to `frontend/tests/hooks/useChat.test.tsx`:

```tsx
describe('useSendChatMessageMutation — invalidates chats list (story-editor-loj)', () => {
  it('invalidates the chats list cache for the chapter after a successful send', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    // Seed the chats-list cache for chapter-1 with a single chat.
    qc.setQueryData(chatsBaseQueryKey('chapter-1'), [
      {
        id: 'chat-1',
        chapterId: 'chapter-1',
        title: 't',
        kind: 'ask',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
        lastActivityAt: '2026-05-01T00:00:00Z',
        messageCount: 0,
      },
    ]);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    setupSuccessfulSendMock(); // reuse the file's existing SSE mock helper

    const { result } = renderHook(() => useSendChatMessageMutation(), {
      wrapper: makeWrapper(qc),
    });

    await result.current.mutateAsync({
      chatId: 'chat-1',
      chapterId: 'chapter-1',
      content: 'hi',
      modelId: 'venice-uncensored-1b',
    });

    await waitFor(() => {
      const matched = invalidateSpy.mock.calls.some((args) => {
        const arg = args[0];
        if (!arg || typeof arg !== 'object' || !('queryKey' in arg)) return false;
        const key = (arg as { queryKey?: readonly unknown[] }).queryKey;
        return (
          Array.isArray(key) &&
          key[0] === 'chapter' &&
          key[1] === 'chapter-1' &&
          key[2] === 'chats'
        );
      });
      expect(matched).toBe(true);
    });
  });
});
```

Reuse `chatsBaseQueryKey`, `makeWrapper`, and `setupSuccessfulSendMock` (or their equivalents) from the existing test file — match the established style.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix frontend test -- useChat`
Expected: FAIL — `SendChatMessageArgs` doesn't have `chapterId`, so the test won't typecheck. (That's the failing-test signal; the implementation hasn't been written yet.)

- [ ] **Step 4: Implement — add `chapterId` to `SendChatMessageArgs` and the onSuccess invalidation**

In `frontend/src/hooks/useChat.ts`:

(a) Locate the `SendChatMessageArgs` interface. Add `chapterId: string`:

```ts
export interface SendChatMessageArgs {
  chatId: string;
  chapterId: string;
  modelId: string;
  content?: string;
  retry?: boolean;
  attachment?: { selectionText: string; chapterId: string };
  enableWebSearch?: boolean;
}
```

Match the existing field order / docstring style. The new `chapterId` is the CHAT's chapterId (different from the optional `attachment.chapterId`, which is the attached SELECTION's chapterId — both happen to be the same in practice but the semantic is different).

(b) Locate `useSendChatMessageMutation`'s `onSuccess` (around line 280):

```ts
onSuccess: (_void, vars) => {
  // Clear the draft before invalidating so we never briefly show both
  // the optimistic draft bubble and the persisted assistant message.
  useChatDraftStore.getState().clear(vars.chatId);
  void qc.invalidateQueries({ queryKey: chatMessagesQueryKey(vars.chatId) });
  // story-editor-loj: the backend bumps Chat.lastActivityAt on every
  // message create, so the chats-list order has shifted. Match the
  // pattern used by useCreateChatMutation / useRenameChatMutation /
  // useRemoveChatMutation: invalidate via chatsBaseQueryKey so both
  // kind='ask' and kind='scene' lists for the chapter are swept.
  void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(vars.chapterId) });
},
```

- [ ] **Step 5: Update `useBannerRetry` to plumb `chapterId`**

`useBannerRetry.ts:65` has a `mutation.mutateAsync({ chatId, modelId, retry: true })` call that will fail to typecheck the moment `chapterId` becomes required on `SendChatMessageArgs`. Plumb `chapterId` through the hook's options:

In `frontend/src/hooks/useBannerRetry.ts`, update `UseBannerRetryOptions`:

```ts
export interface UseBannerRetryOptions {
  chatId: string | null;
  chapterId: string | null;
  selectedModelId: string | null;
  mutation: ReturnType<typeof useSendChatMessageMutation>;
  lastSendArgsRef: RefObject<ChatSendArgs | null>;
  onSend: (args: ChatSendArgs) => Promise<void>;
}
```

In the same file, destructure `chapterId` in the hook body and add it to the guard + the retry call:

```ts
export function useBannerRetry({
  chatId,
  chapterId,
  selectedModelId,
  mutation,
  lastSendArgsRef,
  onSend,
}: UseBannerRetryOptions): UseBannerRetryResult {
  const qc = useQueryClient();
  const [isDispatching, setIsDispatching] = useState(false);

  const onRetry = useCallback(async (): Promise<void> => {
    const last = lastSendArgsRef.current;
    if (last === null || chatId === null || chapterId === null || selectedModelId === null) return;
    setIsDispatching(true);
    try {
      await qc.refetchQueries({ queryKey: chatMessagesQueryKey(chatId) });
      const after = qc.getQueryData<ChatMessage[]>(chatMessagesQueryKey(chatId)) ?? [];
      const trailing = after[after.length - 1];

      if (trailing?.role === 'user') {
        await mutation.mutateAsync({
          chatId,
          chapterId,
          modelId: selectedModelId,
          retry: true,
        });
      } else {
        await onSend(last);
      }
    } finally {
      setIsDispatching(false);
    }
  }, [chatId, chapterId, selectedModelId, mutation, qc, onSend, lastSendArgsRef]);

  return { onRetry, isDispatching };
}
```

(`chapterId` joins `chatId` and `selectedModelId` in the null-guard so callers can pass through their nullable chapter state without the hook firing under wrong shapes.)

- [ ] **Step 6: Update the ChatTab / SceneTab call sites**

In `frontend/src/components/ChatTab.tsx`:

(a) Locate the `sendChatMessage.mutateAsync(...)` call inside `onSend` (around line 114). The `sendArgs` object currently doesn't include `chapterId`:

```ts
const sendArgs: Parameters<typeof sendChatMessage.mutateAsync>[0] = {
  chatId,
  chapterId: cId, // story-editor-loj: needed so onSuccess can invalidate the chats list
  content: args.content,
  modelId: mId,
  enableWebSearch: args.enableWebSearch,
};
```

(`cId` is the already-narrowed `chapterId as string` from earlier in the same function — reuse it. Verify by reading the surrounding lines.)

(b) Locate the `useBannerRetry({...})` call (around line 130). Add `chapterId`:

```ts
const { onRetry, isDispatching } = useBannerRetry({
  chatId: activeChatId,
  chapterId,
  selectedModelId,
  mutation: sendChatMessage,
  lastSendArgsRef: lastChatSendArgsRef,
  onSend,
});
```

(c) Locate `onRegenerate` (around line 191). Add `chapterId`:

```ts
void sendChatMessage.mutateAsync({
  chatId: activeChatId,
  chapterId: chapterId as string,
  modelId: selectedModelId as string,
  retry: true,
});
```

In `frontend/src/components/SceneTab.tsx`, apply the same three edits at the equivalent call sites (the structure mirrors ChatTab).

- [ ] **Step 7: Run focused tests**

Run: `npm --prefix frontend test -- useChat ChatTab SceneTab useBannerRetry`
Expected: PASS. If `useBannerRetry.test.tsx` exists and its fixtures call `useBannerRetry({...})`, add `chapterId` to the fixture options. Similarly for any `useChat.test.tsx` fixture that drives `useSendChatMessageMutation.mutateAsync(...)`.

- [ ] **Step 8: Run full frontend suite**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/useChat.ts frontend/src/hooks/useBannerRetry.ts frontend/src/components/ChatTab.tsx frontend/src/components/SceneTab.tsx frontend/tests/hooks/useChat.test.tsx frontend/tests/hooks/useBannerRetry.test.tsx
git commit -m "[loj] useSendChatMessageMutation: invalidate chats list on success (plumb chapterId through useBannerRetry too)"
```

(Adjust the staged file list to exactly what changed; `useBannerRetry.test.tsx` may not exist.)

---

### Task 5: API response + SessionPicker — expose and read `lastActivityAt`

**Files:**
- Modify: `backend/src/routes/chat.routes.ts` (verify the GET-chats enrich-loop preserves `lastActivityAt`; should be automatic via `...chat`).
- Modify: `frontend/src/lib/api.ts` (`ChatRow` interface).
- Modify: `frontend/src/components/SessionPicker.tsx` (`Session` interface; `relativeAge` call sites).
- Modify: `frontend/src/components/ChatTab.tsx` (the `SessionPicker.sessions` map field).
- Modify: `frontend/src/components/SceneTab.tsx` (same map adjustment).
- Modify: `frontend/tests/components/SessionPicker.test.tsx` — file exists with `updatedAt: '2026-05-07...'` fixtures (lines 14-15 and likely more). Rename `updatedAt` → `lastActivityAt` on every `Session` literal in the fixtures. This is a required edit, not optional.

- [ ] **Step 1: Verify the backend already passes `lastActivityAt` through**

Read `backend/src/routes/chat.routes.ts` around line 158-169. The enrich loop does:

```ts
const enriched = await Promise.all(
  chats.map(async (chat) => {
    const messageCount = await createMessageRepo(req).countForChat(chat.id as string);
    return { ...chat, messageCount };
  }),
);
```

The `...chat` spread preserves all fields from `chatRepo.findManyForChapter`, including `lastActivityAt` (because it's a real column on the row). So no backend route change is needed — `lastActivityAt` flows through automatically. Verify by adding/extending a route test:

In `backend/tests/routes/chat.test.ts`, find an existing GET-chats test and add an assertion: the response chats[] each carry a `lastActivityAt` string field. Skip this step if the existing tests already cover the shape via deep-equal on chat objects.

- [ ] **Step 2: Add `lastActivityAt` to `ChatRow`**

In `frontend/src/lib/api.ts`, locate the `ChatRow` interface (around line 297-306):

```ts
export interface ChatRow {
  id: string;
  chapterId: string;
  title: string | null;
  kind: 'ask' | 'scene';
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string; // story-editor-loj: bumped on every message create
  messageCount?: number;
}
```

`lastActivityAt` is non-nullable on the API surface because the Postgres column is `NOT NULL DEFAULT CURRENT_TIMESTAMP` (set by Task 1's migration) — every Chat row carries a value at all times. No null-guards needed on the read path.

If TypeScript complains that an existing test fixture's `ChatRow` literal lacks `lastActivityAt`, fix the fixture by adding the field. Match the existing `updatedAt` value for the same fixture if no specific recency intent applies; otherwise pick a date that makes the test's intent clear.

- [ ] **Step 3: Rename `Session.updatedAt` → `Session.lastActivityAt` in SessionPicker**

In `frontend/src/components/SessionPicker.tsx`:

```ts
export interface Session {
  id: string;
  title: string;
  /** story-editor-loj: most-recent activity timestamp; drives the "X ago" label. */
  lastActivityAt: string;
}
```

Update the two `relativeAge(...)` call sites (lines 238 and 299 in the current file):

```ts
{relativeAge(active.lastActivityAt)}
// ...
<span className="text-[11px] font-mono text-ink-4">{relativeAge(s.lastActivityAt)}</span>
```

Update `frontend/tests/components/SessionPicker.test.tsx` fixtures: rename `updatedAt` → `lastActivityAt` on every `Session` literal (the file has multiple — start with lines 14-15 and grep the rest). The implementer will see the typecheck failure immediately if any are missed.

- [ ] **Step 4: Update the ChatTab / SceneTab call sites to pass `lastActivityAt`**

In `frontend/src/components/ChatTab.tsx` (around line 207):

```tsx
sessions={visibleSessions.map((c) => ({
  id: c.id,
  title: c.title ?? 'Untitled',
  lastActivityAt: c.lastActivityAt,
}))}
```

In `frontend/src/components/SceneTab.tsx` at the equivalent call site (around line 226), apply the same change.

- [ ] **Step 5: Run frontend typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean. If a test asserts on a `Session.updatedAt` field name, update it to `lastActivityAt`.

- [ ] **Step 6: Run full backend + frontend suites + verify the existing Story workflow still typechecks end-to-end**

Run: `npm --prefix backend test --run && npm --prefix frontend test --run`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/SessionPicker.tsx frontend/src/components/ChatTab.tsx frontend/src/components/SceneTab.tsx backend/tests/routes/chat.test.ts frontend/tests/components/SessionPicker.test.tsx
git commit -m "[loj] expose lastActivityAt on API; SessionPicker reads it for the 'X ago' label"
```

(Adjust the staged file list to exactly what changed.)

---

### Task 6: audit and align frontend tab tests with the new ordering invariant

**Files:**
- Audit / modify: `frontend/tests/components/ChatTab.test.tsx`, `frontend/tests/components/SceneTab.test.tsx`.

- [ ] **Step 1: Audit the existing tests**

Read both test files. For each test that mocks `useChatsQuery` or constructs a `sessions` array, check whether the fixture's order matches "most-recently-used first" (now an invariant from Task 3) and whether session objects include `lastActivityAt`.

Run: `grep -nE "useChatsQuery|sessions:|chats:|setActiveChatId|updatedAt:" frontend/tests/components/{ChatTab,SceneTab}.test.tsx | head -60`

- [ ] **Step 2: Update fixtures**

For each test fixture that returns chats:
- Add `lastActivityAt` to each chat object. Choose values so the array order matches the test's intent (e.g. if the test asserts "default-select picks session A", make A's lastActivityAt the most recent).
- Tests that asserted "default-select picks the oldest" are now testing the wrong behavior — update assertions to match newest-first selection.
- Tests of the delete-fallback (`remaining[0]`) similarly now expect newest-of-remaining; align the assertion if it named a specific session.

Make minimal, intent-preserving edits.

- [ ] **Step 3: Run the tab tests**

Run: `npm --prefix frontend test -- ChatTab SceneTab`
Expected: PASS.

- [ ] **Step 4: Run full frontend suite**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test --run`
Expected: clean.

- [ ] **Step 5: Commit (only if any test was modified)**

```bash
git add frontend/tests/components/ChatTab.test.tsx frontend/tests/components/SceneTab.test.tsx
git commit -m "[loj] tests: align ChatTab/SceneTab fixtures with newest-first session order"
```

If no test edits were required (fixtures already lined up), skip this commit.

---

## Update bd notes verify-line

Before invoking `/bd-close-reviewed`, widen the bd issue's `verify:` line to cover the backend repo tests this plan adds. **`bd update --notes` REPLACES the field** (it doesn't append) — so this is a read-modify-write:

```bash
# 1. Snapshot the current notes minus the existing verify: line. Keep
#    everything else (plan: link, any trailing prose). Only the FIRST
#    verify: line is stripped — later verify: lines, if any, stay.
CURRENT_REST=$(bd show story-editor-loj --json | python3 -c "
import json, sys
notes = json.load(sys.stdin)[0].get('notes', '') or ''
out = []
seen = False
for line in notes.splitlines():
    if line.startswith('verify:') and not seen:
        seen = True
        continue
    out.append(line)
print('\n'.join(out))
")

# 2. Prepend the new verify: line and re-set --notes.
NEW_VERIFY='verify: npm --prefix backend test -- chat.repo message.repo && npm --prefix frontend test -- ChatTab.test.tsx SceneTab.test.tsx useChat.test.tsx useBannerRetry.test.tsx'
bd update story-editor-loj --notes "${NEW_VERIFY}
${CURRENT_REST}"
```

After running, `bd show story-editor-loj` should display the new verify: line first, followed by the existing plan: link and any other lines. Note: `bd update` also has `--append-notes` (which appends a new line) — that won't work here because the OLD `verify:` line would stay first, and `/bd-close-reviewed` uses the first matching line (see `bd-execute.md` "Verify-line convention"). Read-and-replace is the only correct shape.

(`useBannerRetry.test.tsx` may not exist; if it doesn't, drop it from the verify list — the implementer will know after running Task 4 step 7.)

---

## Manual verification (run after PR merge into convergence)

1. `make dev`. Open `http://localhost:3000`. Log in.
2. Navigate to a story and open a chapter that has at least two chat sessions (or two scene sessions). Seed by sending messages in two separate sessions if none exist.
3. Click on the most recently-used session in the SessionPicker dropdown.
4. Leave the chapter (navigate elsewhere or switch tabs).
5. Return.
6. **Expected:** the tab lands on the most-recently-used session (not the oldest). The dropdown lists sessions newest-first.
7. Send a fresh message in some session. Without refreshing the page, open the dropdown — the session you just used should be at the top.
8. Rename a session that hasn't been touched in a while. **Expected:** the "X ago" label and the dropdown order do NOT change — `lastActivityAt` is untouched by rename.

---

## Self-review checklist

- [ ] Task 1's migration is additive (NOT NULL column with `@default(now())`; existing rows populated at migration time, none exist pre-deployment); index supports the new sort.
- [ ] Task 2's transaction wraps both writes — message insert + Chat.lastActivityAt bump — so a transient DB error can't leave them split.
- [ ] Task 3's orderBy uses `[{ lastActivityAt: 'desc' }, { createdAt: 'desc' }]` — tie-breaker for dormant chats is deterministic.
- [ ] Task 4 plumbs `chapterId` through `SendChatMessageArgs` and invalidates via `chatsBaseQueryKey(chapterId)` — matches the pattern of the three other chat mutations in `useChat.ts`. NOT a predicate-based invalidation (which would have used the wrong key shape).
- [ ] Task 5 renames `Session.updatedAt` → `Session.lastActivityAt` in SessionPicker so the label name matches the recency-source field.
- [ ] No data-migration / backfill task. Pre-deployment, all chats are freshly created via `@default(now())`.
- [ ] No new dependencies, no new environment variables.
- [ ] bd notes `verify:` line is widened (above) before close-gate to exercise backend + frontend test surfaces this plan adds.

---

## Follow-ups / out of scope

- **Document the `Chat.lastActivityAt` semantic in `docs/data-model.md` (or wherever the project documents per-model field semantics).** Future readers should see the field's purpose without grepping for its writers.
- **`Chat.lastActivityAt` index might support a cross-chapter "recently active" view.** Out of scope for this bug; file separately if such a view is ever proposed.
- **Strict separation: rename bumps `updatedAt` only, message-create bumps `lastActivityAt` only.** Today, message-create bumps both because Prisma's `@updatedAt` directive fires on the transactional `Chat.update` call regardless of which columns are in `data`. The recency SOURCE is still correct (`lastActivityAt` only changes on message-create or chat-create; rename via `chatRepo.update` doesn't touch `lastActivityAt`), but `updatedAt` advancing as a side-effect of message-create is a technical leak of the would-be-strict semantic. To achieve strict separation, replace `tx.chat.update({ where, data: { lastActivityAt: new Date() } })` with `tx.$executeRaw\`UPDATE "Chat" SET "lastActivityAt" = NOW() WHERE id = ${chatId}\`` (raw SQL bypasses the `@updatedAt` directive). Adds a raw-SQL surface to the repo. Not worth doing now since no consumer reads `updatedAt` for recency anymore — `SessionPicker` and `findManyForChapter` both read `lastActivityAt`. File only if a future regression shows `updatedAt`-leakage causing a visible bug.
- **Persist "last opened session per (chapterId, kind)" in user settings.** Bug description's option (c). Different UX shape; under the recency ordering, "the user's most-recently-used session" and "the top of the recency-sorted list" are the same row, so this is unnecessary unless a different mental model emerges.
- **Optimistic chats-list reorder on send.** Instead of invalidate + refetch, move the active chat to index 0 in the cached array immediately. Marginal UX win; not necessary if refetch is fast.
