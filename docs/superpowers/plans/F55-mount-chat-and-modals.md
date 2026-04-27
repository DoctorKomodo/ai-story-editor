# F55 — Mount chat surfaces + page-root modals

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy F12 `<AIPanel>` in EditorPage's chat slot with the real F38/F39/F40 stack (`<ChatPanel>` + `<ChatMessages>` + `<ChatComposer>`), wire chat selection from `useChatsQuery(chapterId)`, send messages via a new `useSendChatMessage` mutation, and mount the F30 `<StoryPicker>` / F42 `<ModelPicker>` / F43 `<Settings>` modals at the page root with state opened by TopBar / Sidebar / ChatPanel callbacks.

**Architecture:** EditorPage owns three pieces of new state (active chat id per chapter, modal open flags, model picker target) and one new mutation hook (`useSendChatMessageMutation`). Modals follow the established page-root convention from F51/F53/F54 — each modal is rendered at the bottom of EditorPage's JSX with `open` flipped by callbacks passed up from TopBar / Sidebar / ChatPanel. The chat slot renders `<ChatPanel>` whose `messagesBody` is `<ChatMessages>` and `composer` is `<ChatComposer>`. The composer's `onSend` calls the new mutation, which (a) optimistically appends the user message to the messages cache and (b) streams the assistant reply via SSE into the same cache (mirroring how the V21/V22 backend streams).

**Tech Stack:** React 19 + TypeScript strict, TanStack Query (`useChatsQuery`, `useChatMessagesQuery`, new `useCreateChat` + `useSendChatMessage`), Zustand (`useAttachedSelectionStore` already wired into ChatComposer), SSE via `EventSource` polyfill from existing `lib/sse.ts` (the same one F50 uses).

**Prerequisites (incremental order):**
- **F51** mounted AppShell with the chat slot rendering F12 `<AIPanel>`. F55 swaps that slot's content for the new stack.
- **F52** swapped Editor → Paper, so the running editor has a stable `chapterId` for the chat to bind to.
- **F53** wired AI surfaces (selection bubble's "Ask" goes through `triggerAskAI` which sets the attached selection — that selection now lands in the F40 composer that F55 mounts).
- **V21** (`GET /api/chats/:chatId/messages`) and the V22 SSE message-create route are shipped.

**Out of scope:**
- Chat history tab content (`<ChatPanel>`'s history pill is a no-op until **F63** ships its design — leave the pill visible but pointing to a placeholder body, same as F38 currently does).
- Settings / StoryPicker / ModelPicker internal behaviour — they're already feature-complete from F30/F42/F43; F55 only mounts them.
- New-chat creation modal/UI: per the task copy, "New chat" just calls `POST /api/chapters/:id/chats` and switches to the new chat — no naming dialog.

---

### Task 1: Add `useCreateChatMutation` + `useSendChatMessageMutation` hooks

**Files:**
- Modify: `frontend/src/hooks/useChat.ts`
- Test: `frontend/tests/hooks/useChat.test.ts` (add cases)

The `POST /api/chapters/:chapterId/chats` create endpoint exists (see `backend/src/routes/chat.routes.ts:93`) — add a mutation that returns the new chat and invalidates `chatsQueryKey(chapterId)`. The `POST /api/chats/:chatId/messages` SSE endpoint exists too — wrap it in a mutation that:
1. Optimistically appends the user `ChatMessage` to `chatMessagesQueryKey(chatId)`.
2. Opens an SSE stream and appends an assistant message that grows token-by-token in cache.
3. On `event: citations`, sets `citationsJson` on the assistant message.
4. On `done`, finalises tokens / latency / model from the trailing `data:` payload.
5. On error, removes the optimistic user message and surfaces the error.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/tests/hooks/useChat.test.ts (additions)
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCreateChatMutation, useSendChatMessageMutation } from '@/hooks/useChat';

describe('useCreateChatMutation', () => {
  it('POSTs /api/chapters/:id/chats and invalidates chats list', async () => {
    // mock api(); assert call shape; assert query invalidation.
  });
});

describe('useSendChatMessageMutation', () => {
  it('appends user message optimistically before stream starts', async () => {
    // ...
  });

  it('appends assistant tokens as SSE events arrive', async () => {
    // ...
  });

  it('rolls back optimistic user message on error', async () => {
    // ...
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/hooks/useChat.test.ts`
Expected: FAIL — hooks not exported.

- [ ] **Step 3: Implement `useCreateChatMutation`**

```ts
// frontend/src/hooks/useChat.ts (additions at end of file)
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

interface CreateChatArgs {
  chapterId: string;
}

interface CreateChatResponse {
  chat: ChatSummary;
}

export function useCreateChatMutation(): UseMutationResult<ChatSummary, Error, CreateChatArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ chapterId }) => {
      const res = await api<CreateChatResponse>(
        `/chapters/${encodeURIComponent(chapterId)}/chats`,
        { method: 'POST' },
      );
      return res.chat;
    },
    onSuccess: (chat) => {
      qc.invalidateQueries({ queryKey: chatsQueryKey(chat.chapterId) });
    },
  });
}
```

- [ ] **Step 4: Implement `useSendChatMessageMutation`**

```ts
// frontend/src/hooks/useChat.ts (additions)
export interface SendChatMessageArgs {
  chatId: string;
  content: string;
  attachment: ChatMessageAttachment | null;
  enableWebSearch: boolean;
  /** [V8] hash of storyId+modelId, computed by caller. */
  modelId: string | null;
}

interface SendChatMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export function useSendChatMessageMutation(): UseMutationResult<
  SendChatMessageResult,
  Error,
  SendChatMessageArgs
> {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ chatId, content, attachment, enableWebSearch, modelId }) => {
      // Optimistic user message — the backend will assign the real id; we
      // tag the placeholder with `pending:<uuid>` so the rollback finds it.
      const tempUserId = `pending:${crypto.randomUUID()}`;
      const tempAssistantId = `pending:${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      const optimisticUser: ChatMessage = {
        id: tempUserId,
        role: 'user',
        contentJson: content,
        attachmentJson: attachment,
        citationsJson: null,
        model: null,
        tokens: null,
        latencyMs: null,
        createdAt: now,
      };
      const optimisticAssistant: ChatMessage = {
        id: tempAssistantId,
        role: 'assistant',
        contentJson: '',
        attachmentJson: null,
        citationsJson: null,
        model: modelId,
        tokens: null,
        latencyMs: null,
        createdAt: now,
      };

      qc.setQueryData<ChatMessage[]>(chatMessagesQueryKey(chatId), (prev = []) => [
        ...prev,
        optimisticUser,
        optimisticAssistant,
      ]);

      try {
        // Use the existing SSE helper (see `frontend/src/lib/sse.ts`); contract
        // documented in `docs/api-contract.md` (V22 + V26). Pseudocode:
        const stream = openChatMessageStream({
          chatId,
          content,
          attachment,
          enableWebSearch,
          modelId,
        });
        let finalUser: ChatMessage = optimisticUser;
        let finalAssistant: ChatMessage = optimisticAssistant;

        for await (const event of stream) {
          if (event.type === 'message-created') {
            // backend emits `event: message-created` once per persisted row,
            // payload `{ role: 'user' | 'assistant', message: ChatMessage }`.
            if (event.role === 'user') finalUser = event.message;
            else finalAssistant = { ...event.message, contentJson: '' };
            qc.setQueryData<ChatMessage[]>(chatMessagesQueryKey(chatId), (prev = []) =>
              prev.map((m) =>
                m.id === tempUserId ? finalUser : m.id === tempAssistantId ? finalAssistant : m,
              ),
            );
          } else if (event.type === 'token') {
            qc.setQueryData<ChatMessage[]>(chatMessagesQueryKey(chatId), (prev = []) =>
              prev.map((m) =>
                m.id === finalAssistant.id
                  ? { ...m, contentJson: String(m.contentJson ?? '') + event.text }
                  : m,
              ),
            );
          } else if (event.type === 'citations') {
            qc.setQueryData<ChatMessage[]>(chatMessagesQueryKey(chatId), (prev = []) =>
              prev.map((m) =>
                m.id === finalAssistant.id
                  ? { ...m, citationsJson: event.citations }
                  : m,
              ),
            );
          } else if (event.type === 'done') {
            qc.setQueryData<ChatMessage[]>(chatMessagesQueryKey(chatId), (prev = []) =>
              prev.map((m) =>
                m.id === finalAssistant.id
                  ? { ...m, tokens: event.tokens ?? null, latencyMs: event.latencyMs ?? null }
                  : m,
              ),
            );
          }
        }

        return { userMessage: finalUser, assistantMessage: finalAssistant };
      } catch (err) {
        // Roll back the optimistic placeholders so the user sees a clean state.
        qc.setQueryData<ChatMessage[]>(chatMessagesQueryKey(chatId), (prev = []) =>
          prev.filter((m) => m.id !== tempUserId && m.id !== tempAssistantId),
        );
        throw err;
      }
    },
  });
}
```

> Note: `openChatMessageStream` is a thin wrapper around the project's existing SSE helper. If the helper doesn't yet expose an async-iterator surface for the chat endpoint (the F50 work used a callback shape), add a small adapter in `frontend/src/lib/sse.ts` next to the existing `openCompletionStream`. The event names (`message-created`, `token`, `citations`, `done`) mirror what the V22 + V26 routes already emit — confirm against `backend/src/routes/chat.routes.ts:193` and `docs/api-contract.md` before pinning.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd frontend && npx vitest run tests/hooks/useChat.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useChat.ts frontend/tests/hooks/useChat.test.ts frontend/src/lib/sse.ts
git commit -m "[F55] add useCreateChatMutation + useSendChatMessageMutation"
```

---

### Task 2: Add an `activeChatId`-per-chapter slice to the session store

**Files:**
- Modify: `frontend/src/store/session.ts` (or wherever the activeChapterId / activeStoryId Zustand slice lives — confirm at execution time)
- Test: `frontend/tests/store/session.test.ts` (add case if file exists)

The store needs a `Record<chapterId, chatId>` so switching chapters and coming back picks the same chat the user was on. When the entry is missing, EditorPage falls back to the first chat returned by `useChatsQuery` (or null if none).

- [ ] **Step 1: Add the slice**

```ts
// session store additions
interface SessionSlice {
  // … existing fields
  activeChatIdByChapter: Record<string, string | null>;
  setActiveChatId: (chapterId: string, chatId: string | null) => void;
}

// in the store:
activeChatIdByChapter: {},
setActiveChatId: (chapterId, chatId) =>
  set((s) => ({
    activeChatIdByChapter: { ...s.activeChatIdByChapter, [chapterId]: chatId },
  })),
```

- [ ] **Step 2: Run typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/session.ts
git commit -m "[F55] track active chat id per chapter in session store"
```

---

### Task 3: Mount the chat stack in EditorPage's chat slot

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

Replace the F12 `<AIPanel>` block (the legacy chat slot content from F51) with the real F38/F39/F40 stack. The slot's content is whatever was passed as `<AppShell chat={…}>` in F51.

- [ ] **Step 1: Compute the active chat for the active chapter**

```tsx
// EditorPage.tsx — derive active chat
import {
  useChatsQuery,
  useCreateChatMutation,
  useSendChatMessageMutation,
} from '@/hooks/useChat';

const { data: chats = [] } = useChatsQuery(activeChapterId);
const createChat = useCreateChatMutation();
const sendMessage = useSendChatMessageMutation();

const activeChatIdByChapter = useSession((s) => s.activeChatIdByChapter);
const setActiveChatId = useSession((s) => s.setActiveChatId);

const activeChatId =
  activeChapterId ? activeChatIdByChapter[activeChapterId] ?? chats[0]?.id ?? null : null;

const handleNewChat = useCallback(async () => {
  if (!activeChapterId) return;
  const chat = await createChat.mutateAsync({ chapterId: activeChapterId });
  setActiveChatId(activeChapterId, chat.id);
}, [activeChapterId, createChat, setActiveChatId]);

const attachedSelection = useAttachedSelectionStore((s) => s.attachedSelection);
const attachedTokenCount = attachedSelection?.tokenEstimate ?? 0;
const attachedCharacterCount = (attachedSelection?.text?.length ?? 0);
const chapterTitle = chapter?.title ?? null;
const selectedModelId = useSession((s) => s.selectedModelId);
```

- [ ] **Step 2: Wire `onSend` to the mutation**

```tsx
const handleSend = useCallback(
  async (args: SendArgs) => {
    if (!activeChatId) {
      // No chat exists for this chapter yet — create one, then send.
      const chat = await createChat.mutateAsync({ chapterId: activeChapterId! });
      setActiveChatId(activeChapterId!, chat.id);
      await sendMessage.mutateAsync({
        chatId: chat.id,
        content: args.content,
        attachment: args.attachment
          ? { selectionText: args.attachment.text, chapterId: args.attachment.chapterId }
          : null,
        enableWebSearch: args.enableWebSearch,
        modelId: selectedModelId,
      });
      return;
    }
    await sendMessage.mutateAsync({
      chatId: activeChatId,
      content: args.content,
      attachment: args.attachment
        ? { selectionText: args.attachment.text, chapterId: args.attachment.chapterId }
        : null,
      enableWebSearch: args.enableWebSearch,
      modelId: selectedModelId,
    });
  },
  [activeChatId, activeChapterId, createChat, sendMessage, selectedModelId, setActiveChatId],
);
```

- [ ] **Step 3: Replace the chat slot JSX**

```tsx
// In the AppShell chat prop (F51 wired this previously to <AIPanel>):
<ChatPanel
  messagesBody={
    <ChatMessages
      chatId={activeChatId}
      chapterTitle={chapterTitle}
      attachedCharacterCount={attachedCharacterCount}
      attachedTokenCount={attachedTokenCount}
    />
  }
  composer={<ChatComposer onSend={handleSend} disabled={sendMessage.isPending} />}
  onOpenModelPicker={() => setModelPickerOpen(true)}
  onNewChat={handleNewChat}
  onOpenSettings={() => setSettingsOpen(true)}
/>
```

- [ ] **Step 4: Delete the F12 `<AIPanel>` import and usage** from EditorPage. The component file itself stays for now — F12 may still be referenced elsewhere; sweep with `grep` and only delete the file once no references remain.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[F55] mount ChatPanel + ChatMessages + ChatComposer in chat slot"
```

---

### Task 4: Mount StoryPicker / ModelPicker / Settings at page root

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

Three boolean state flags + `<StoryPicker>` / `<ModelPicker>` / `<SettingsModal>` rendered at the bottom of the page. The TopBar (F25 from F51) already exposes `onOpenStoriesList` (wired to StoryPicker) and `onOpenSettings` (wired to Settings). The Sidebar story-picker header opens the same StoryPicker. ChatPanel's `onOpenModelPicker` opens ModelPicker; its `onOpenSettings` opens Settings.

- [ ] **Step 1: Add state + handlers**

```tsx
const [storyPickerOpen, setStoryPickerOpen] = useState(false);
const [modelPickerOpen, setModelPickerOpen] = useState(false);
const [settingsOpen, setSettingsOpen] = useState(false);

const handleSelectStory = useCallback(
  (id: string) => {
    setStoryPickerOpen(false);
    navigate(`/stories/${id}`); // existing react-router navigate
  },
  [navigate],
);

const handleCreateStory = useCallback(() => {
  setStoryPickerOpen(false);
  setStoryModalOpen(true); // existing F6 modal state
}, []);
```

- [ ] **Step 2: Wire callbacks into TopBar / Sidebar / ChatPanel**

TopBar (F25): `onOpenStoriesList={() => setStoryPickerOpen(true)}`, `onOpenSettings={() => setSettingsOpen(true)}`.
Sidebar (F27): `onOpenStoryPicker={() => setStoryPickerOpen(true)}`.
ChatPanel: `onOpenModelPicker={() => setModelPickerOpen(true)}`, `onOpenSettings={() => setSettingsOpen(true)}`.

- [ ] **Step 3: Render the three modals at the page root**

```tsx
<StoryPicker
  open={storyPickerOpen}
  onClose={() => setStoryPickerOpen(false)}
  activeStoryId={story?.id ?? null}
  onSelectStory={handleSelectStory}
  onCreateStory={handleCreateStory}
  // onImportDocx left undefined — task copy: button rendered, no backend yet.
/>
<ModelPicker open={modelPickerOpen} onClose={() => setModelPickerOpen(false)} />
<SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

- [ ] **Step 4: Run typecheck + frontend tests**

```bash
cd frontend && npm run typecheck && npx vitest run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[F55] mount StoryPicker, ModelPicker, Settings at page root"
```

---

### Task 5: Integration test — send a message end to end

**Files:**
- Test: `frontend/tests/pages/EditorPage.chat.test.tsx`

Renders EditorPage with a story + chapter + an existing chat. Types in the composer, presses Cmd/Ctrl+Enter, asserts:
1. The user message appears immediately (optimistic).
2. The assistant message appears with streaming tokens (mock SSE).
3. After `done`, the message has tokens / latency populated.
4. Clicking "New chat" calls `POST /api/chapters/:id/chats` and switches.

- [ ] **Step 1: Write the test**

Use the project's standard MSW or vitest-mock setup for the chat endpoints. Mirror the SSE shape of `frontend/tests/hooks/useChat.test.ts`.

- [ ] **Step 2: Run the test**

```bash
cd frontend && npx vitest run tests/pages/EditorPage.chat.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/pages/EditorPage.chat.test.tsx
git commit -m "[F55] integration: chat send + new chat in EditorPage"
```

---

### Task 6: Verify the F55 task gate

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Confirm/add the verify command**

```
verify: cd frontend && npm run typecheck && npx vitest run tests/hooks/useChat.test.ts tests/components/ChatPanel.test.tsx tests/components/ChatMessages.test.tsx tests/components/ChatComposer.test.tsx tests/components/StoryPicker.test.tsx tests/components/ModelPicker.test.tsx tests/components/Settings.shell-venice.test.tsx tests/pages/EditorPage.chat.test.tsx
```

- [ ] **Step 2: Run via `/task-verify F55`** and only tick the box on exit code 0.

- [ ] **Step 3: Commit the tick**

```bash
git add TASKS.md
git commit -m "[F55] tick — chat surfaces + page-root modals mounted"
```

---

## Self-Review Notes

- **Modal-mount convention preserved**: the same page-root pattern from F51/F53/F54. Three new state flags, three callbacks routed up from TopBar / Sidebar / ChatPanel. No state lives in AppShell.
- **Active chat resolution is deterministic**: per-chapter map in the session store, falling back to the first chat returned by `useChatsQuery`, then `null`. Switching chapters preserves the previously-active chat for the chapter the user came from.
- **New chat creates without a dialog** per task copy. If the spec later wants a name prompt, that's an F-series follow-up.
- **History tab is intentionally inert** — F38's pill stays clickable but its body is the existing F38 placeholder until F63 ships.
- **F12 `<AIPanel>` is replaced, not deleted**. Some tests may still reference it; sweep references and delete only after a clean grep.
- **SSE event names need a final pin** against `backend/src/routes/chat.routes.ts:193` + `docs/api-contract.md` before merging Task 1. The event names listed here (`message-created`, `token`, `citations`, `done`) are the working contract from V22 + V26 — confirm at execution time, and adjust the parser if the wire shape uses different identifiers.
- **Per-turn web-search reset** is owned by `<ChatComposer>` (F50). F55 doesn't touch that.
