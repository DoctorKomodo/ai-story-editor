# Chat Session Picker Implementation Plan (story-editor-n4h)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Chat tab to feature-parity with the Scene tab's session-management UX — dropdown session picker with inline rename, delete-with-undo (5s), + New chat — by extracting `SceneSessionPicker` into a generic `SessionPicker` primitive, gap-filling `useChat.ts` with optimistic create / rename / remove mutations, and pulling chat orchestration out of `EditorPage` into a new `ChatTab` component that mirrors `SceneTab`.

**Architecture:**
- Extract a generic `SessionPicker` from `SceneSessionPicker` by adding a `labels` prop with four strings (`kindLabel`, `ariaPrefix`, `dropdownHeader`, `newButtonLabel`) and renaming the file. `SceneTab` passes scene-flavoured labels at its call site; the new `ChatTab` passes chat-flavoured ones.
- Rename `SceneUndoToast` → `UndoToast` (file, component, props interface, CSS class). The implementation is already kind-agnostic — only the naming is scene-flavoured. `SceneTab` and `ChatTab` both consume it.
- Make `useChat.ts`'s create mutation optimistic and add `useRenameChatMutation` + `useRemoveChatMutation` (mirroring `useScenes.ts`). All three call existing `api.ts` helpers (`createChat`, `patchChat`, `deleteChat`) — no backend work.
- Extract `ChatTab.tsx` mirroring `SceneTab.tsx` 1-for-1: owns `activeChatId` as local `useState<string | null>`, owns the chat-list query, renders the picker, the message list, and the composer in flex-column. Auto-names a new chat on first send via `truncateAtWordBoundary` (lifted from `SceneTab.tsx`). Soft-deletes via the existing `useSoftDelete` hook + the renamed `UndoToast`.
- Re-shape `ChatPanel.tsx`: drop the `composer` and `messagesBody` slot props, take a single `chatBody: ReactNode` instead (mirrors `sceneBody`). **Remove the legacy `+` New chat header button (and its `onNewChat` prop) outright** — the picker's `+ New chat` entry replaces it. The Settings icon and History tab stay; `story-editor-tv4` covers those.

**Tech Stack:** React 19, TypeScript strict, TanStack Query 5, Zustand, TailwindCSS (token-only via `frontend/scripts/lint-design.mjs`), Vitest + Testing Library.

---

## File Structure

**Rename:**
- `frontend/src/components/SceneSessionPicker.tsx` → `frontend/src/components/SessionPicker.tsx`
- `frontend/src/components/SceneSessionPicker.stories.tsx` → `frontend/src/components/SessionPicker.stories.tsx`
- `frontend/tests/components/SceneSessionPicker.test.tsx` → `frontend/tests/components/SessionPicker.test.tsx`
- `frontend/src/components/SceneUndoToast.tsx` → `frontend/src/components/UndoToast.tsx`
- `frontend/src/components/SceneUndoToast.stories.tsx` → `frontend/src/components/UndoToast.stories.tsx`

**Modify:**
- `frontend/src/components/SessionPicker.tsx` — add `labels: SessionPickerLabels` prop; replace four hardcoded scene strings with prop reads.
- `frontend/src/components/SessionPicker.stories.tsx` — update default args to pass `labels`; add a Chat-flavoured story.
- `frontend/tests/components/SessionPicker.test.tsx` — pass labels in render setup.
- `frontend/src/components/SceneTab.tsx` — update import to `SessionPicker`; pass scene labels at call site.
- `frontend/src/hooks/useChat.ts` — make `useCreateChatMutation` optimistic (mirror `useScenes`'s `createMut`); add `useRenameChatMutation` + `useRemoveChatMutation` with the same optimistic pattern.
- `frontend/src/pages/EditorPage.tsx` — drop inline chat-orchestration logic (`activeChatId` derivation, `handleChatSend`, `handleRetryChatSend`, `handleNewChat`, `chatMessages`, `lastChatSendArgsRef`, `useChatMessagesQuery`); wire `<ChatTab chapterId={…} editor={editor} />` into `ChatPanel`'s new `chatBody` slot. Drop the `onNewChat` prop entirely (the legacy header `+` button is gone).
- `frontend/src/components/ChatPanel.tsx` — replace the `messagesBody` and `composer` slot props with a single `chatBody: ReactNode`. **Delete the `+ New chat` header button JSX, the `PlusIcon` helper, and the `onNewChat?: () => void` prop.** Drop the `messagesBody`/`composer` typings and the conditional `{activeTab === 'chat' && messagesBody}` / outer composer wrapper.

**Create:**
- `frontend/src/components/ChatTab.tsx` — new orchestrator. Owns `activeChatId` as local `useState<string | null>`, owns `useChatsQuery(chapterId, { kind: 'ask' })`, renders `SessionPicker` + `ChatMessages` + `ChatComposer` + the renamed `UndoToast` overlay. Auto-names on first send via `truncateAtWordBoundary` (lifted from `SceneTab.tsx`).
- `frontend/src/components/ChatTab.stories.tsx` — minimal Storybook entry: `Empty`, `WithSessions`, `WithUndo`.
- `frontend/tests/components/ChatTab.test.tsx` — smoke tests mirroring `SceneTab.test.tsx`: renders the picker, soft-deletes a chat → toast appears → undo dismisses, sends a first message → auto-rename fires.

**Reference (no edit unless noted):**
- `frontend/src/components/SceneTab.tsx` — the structural template for `ChatTab.tsx`. Lines 122–264 (state + onGenerate + onDelete + onUndo) are the model.
- `frontend/src/hooks/useScenes.ts` — the optimistic-mutation template for `useChat.ts`'s gap-fill.
- `frontend/src/hooks/useSoftDelete.ts` — already generic, used as-is.
- `frontend/src/components/UndoToast.tsx` — already generic post-rename (Task 2); used as-is by ChatTab.
- `frontend/src/lib/api.ts:316–365` — `listChats`, `createChat`, `patchChat`, `deleteChat` — already exists; no edit.
- `backend/src/routes/chat.routes.ts:113–225` — POST/GET/PATCH/DELETE `/api/chats` already exist; no backend work.

---

## Pre-flight

- [ ] **Step 0: Verify branch and current state**

Run:
```bash
git branch --show-current
npm --prefix frontend run typecheck
npm --prefix frontend test
```

Expected:
- Current branch is `feature/chat-session-picker`.
- Typecheck exits 0.
- Frontend suite exits 0 (893 tests pass).

If anything fails, stop and reconcile before starting Task 1.

---

## Task 1: Generalise `SceneSessionPicker` → `SessionPicker`

**Files:**
- Move + modify: `frontend/src/components/SceneSessionPicker.tsx` → `frontend/src/components/SessionPicker.tsx`
- Move + modify: `frontend/src/components/SceneSessionPicker.stories.tsx` → `frontend/src/components/SessionPicker.stories.tsx`
- Move + modify: `frontend/tests/components/SceneSessionPicker.test.tsx` → `frontend/tests/components/SessionPicker.test.tsx`
- Modify: `frontend/src/components/SceneTab.tsx` — update import + add `labels={SCENE_LABELS}` to the call site

- [ ] **Step 1: `git mv` the three files**

```bash
git mv frontend/src/components/SceneSessionPicker.tsx frontend/src/components/SessionPicker.tsx
git mv frontend/src/components/SceneSessionPicker.stories.tsx frontend/src/components/SessionPicker.stories.tsx
git mv frontend/tests/components/SceneSessionPicker.test.tsx frontend/tests/components/SessionPicker.test.tsx
```

- [ ] **Step 2: Add the `labels` prop and replace hardcoded strings**

Open `frontend/src/components/SessionPicker.tsx`. At the top of the file (after imports), add:

```ts
export interface SessionPickerLabels {
  /** Short uppercase tag rendered next to the active session title in the trigger (e.g. "SCENE", "CHAT"). */
  kindLabel: string;
  /** Prefix for the trigger button's aria-label (e.g. "Scene session: ", "Chat: "). */
  ariaPrefix: string;
  /** Header text inside the open dropdown (e.g. "Scenes in this chapter", "Chats in this chapter"). */
  dropdownHeader: string;
  /** Label on the "+ New" entry at the bottom of the dropdown (e.g. "New scene", "New chat"). */
  newButtonLabel: string;
}
```

Rename the existing exported types and component:
- `SceneSession` → `Session`
- `SceneSessionPickerProps` → `SessionPickerProps`
- `SceneSessionPicker` → `SessionPicker`

Add `labels: SessionPickerLabels;` to the `SessionPickerProps` interface as a required field.

Replace the four hardcoded strings with prop reads. Specifically (the original line numbers from the file before the rename):

| Before | After |
|---|---|
| `aria-label={active ? \`Scene session: ${active.title}\` : 'Scene session: none selected'}` (line 209) | `aria-label={active ? \`${labels.ariaPrefix}${active.title}\` : \`${labels.ariaPrefix}none selected\`}` |
| `<span className="text-[10px] uppercase ...">SCENE</span>` (line 215–217) | `<span className="text-[10px] uppercase ...">{labels.kindLabel}</span>` |
| `<div ...>Scenes in this chapter</div>` (line 235–237) | `<div ...>{labels.dropdownHeader}</div>` |
| `<PlusIcon />New scene` (line 322–324) | `<PlusIcon />{labels.newButtonLabel}` |

Destructure `labels` in the `SessionPicker` function signature alongside the other props.

- [ ] **Step 3: Update the Scene call site**

Open `frontend/src/components/SceneTab.tsx`. Change the import:

```diff
-import { SceneSessionPicker } from './SceneSessionPicker';
+import { SessionPicker, type SessionPickerLabels } from './SessionPicker';
```

Above the `SceneTab` function, add the scene labels constant:

```ts
const SCENE_LABELS: SessionPickerLabels = {
  kindLabel: 'SCENE',
  ariaPrefix: 'Scene session: ',
  dropdownHeader: 'Scenes in this chapter',
  newButtonLabel: 'New scene',
};
```

Update the JSX usage (originally line 313):

```diff
-      <SceneSessionPicker
+      <SessionPicker
+        labels={SCENE_LABELS}
         sessions={visibleSessions.map((s) => ({
           id: s.id,
           title: s.title ?? 'Untitled',
           updatedAt: s.updatedAt,
         }))}
         activeSessionId={activeId}
         …
       />
```

- [ ] **Step 4: Update the stories file**

Open `frontend/src/components/SessionPicker.stories.tsx`. Update:

1. Title: `'Chat/SceneSessionPicker'` → `'Chat/SessionPicker'`.
2. Component import: `SceneSessionPicker` → `SessionPicker`; `SceneSession` → `Session`.
3. Add `labels` to the `args`:

```ts
const SCENE_LABELS = {
  kindLabel: 'SCENE',
  ariaPrefix: 'Scene session: ',
  dropdownHeader: 'Scenes in this chapter',
  newButtonLabel: 'New scene',
} as const;
…
args: {
  sessions,
  activeSessionId: 's1',
  labels: SCENE_LABELS,
  onSelect: () => {},
  onRename: () => {},
  onDelete: () => {},
  onNew: () => {},
},
```

Add a new exported story for the chat flavour (so future visual review covers both):

```ts
const CHAT_LABELS = {
  kindLabel: 'CHAT',
  ariaPrefix: 'Chat: ',
  dropdownHeader: 'Chats in this chapter',
  newButtonLabel: 'New chat',
} as const;

export const ChatLabels: Story = {
  args: {
    labels: CHAT_LABELS,
    sessions: [
      { id: 'c1', title: 'On the cellar discovery', updatedAt: new Date(Date.now() - 1_800_000).toISOString() },
      { id: 'c2', title: 'Pacing notes', updatedAt: new Date(Date.now() - 26 * 3600_000).toISOString() },
    ],
    activeSessionId: 'c1',
  },
};
```

- [ ] **Step 5: Update the picker test**

Open `frontend/tests/components/SessionPicker.test.tsx`. Update:

1. Import: `SceneSessionPicker` → `SessionPicker`; `SceneSession` → `Session`.
2. Add a top-level `LABELS` constant (scene-flavoured) and pass it to every `render(<SessionPicker labels={LABELS} … />)` call.

Concrete example for one call (apply the same `labels={LABELS}` addition to every other `SessionPicker` instance in the file):

```ts
const LABELS = {
  kindLabel: 'SCENE',
  ariaPrefix: 'Scene session: ',
  dropdownHeader: 'Scenes in this chapter',
  newButtonLabel: 'New scene',
} as const;

render(
  <SessionPicker
    labels={LABELS}
    sessions={[…]}
    activeSessionId={null}
    onSelect={onSelect}
    onRename={onRename}
    onDelete={onDelete}
    onNew={onNew}
  />,
);
```

- [ ] **Step 6: Typecheck + tests + design lint**

Run:
```bash
npm --prefix frontend run typecheck
npm --prefix frontend test -- tests/components/SessionPicker.test.tsx tests/components/SceneTab.test.tsx
npm --prefix frontend run lint:design
```

Expected: all three exit 0. The picker and scene-tab tests should be unchanged in count and all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SessionPicker.tsx \
        frontend/src/components/SessionPicker.stories.tsx \
        frontend/tests/components/SessionPicker.test.tsx \
        frontend/src/components/SceneTab.tsx
git commit -m "[chat-picker] extract SessionPicker primitive from SceneSessionPicker

Adds a labels prop with four strings (kindLabel, ariaPrefix,
dropdownHeader, newButtonLabel). SceneTab passes scene-flavoured
labels at the call site; ChatTab will pass chat-flavoured ones in
a follow-up commit."
```

---

## Task 2: Rename `SceneUndoToast` → `UndoToast`

**Files:**
- Move + modify: `frontend/src/components/SceneUndoToast.tsx` → `frontend/src/components/UndoToast.tsx`
- Move + modify: `frontend/src/components/SceneUndoToast.stories.tsx` → `frontend/src/components/UndoToast.stories.tsx`
- Modify: `frontend/src/index.css` — rename CSS class `.scene-undo-countdown` → `.undo-countdown`
- Modify: `frontend/src/components/SceneTab.tsx` — update import and JSX from `SceneUndoToast` to `UndoToast`

The implementation is already kind-agnostic; only the names are scene-flavoured. This is a pure rename with no behavioural change.

- [ ] **Step 1: `git mv` the two files**

```bash
git mv frontend/src/components/SceneUndoToast.tsx frontend/src/components/UndoToast.tsx
git mv frontend/src/components/SceneUndoToast.stories.tsx frontend/src/components/UndoToast.stories.tsx
```

- [ ] **Step 2: Rename component, props interface, and CSS class inside the moved files**

Open `frontend/src/components/UndoToast.tsx`. Replace symbols:
- `SceneUndoToastProps` → `UndoToastProps`
- `SceneUndoToast` → `UndoToast` (function declaration + any internal reference)
- `scene-undo-countdown` (className string in JSX) → `undo-countdown`

Open `frontend/src/components/UndoToast.stories.tsx`. Replace symbols:
- Storybook title: `'Chat/SceneUndoToast'` → `'Chat/UndoToast'`
- Component import: `import { SceneUndoToast } from './SceneUndoToast'` → `import { UndoToast } from './UndoToast'`
- Every reference to `SceneUndoToast` in story bodies → `UndoToast`
- `Meta<typeof SceneUndoToast>` → `Meta<typeof UndoToast>`
- `StoryObj<typeof SceneUndoToast>` → `StoryObj<typeof UndoToast>`

Use `grep -n "SceneUndoToast" frontend/src/components/UndoToast.tsx frontend/src/components/UndoToast.stories.tsx` to confirm zero matches after the edits.

- [ ] **Step 3: Rename the CSS class in `index.css`**

Open `frontend/src/index.css`. Find the `.scene-undo-countdown` block (next to `@keyframes inkwell-undo-countdown`). Rename the class:

```diff
-.scene-undo-countdown {
+.undo-countdown {
   transform-origin: left center;
   animation: inkwell-undo-countdown var(--undo-ms, 5000ms) linear forwards;
 }
```

The `@keyframes inkwell-undo-countdown` keyframes stay as-is — that name was already neutral.

- [ ] **Step 4: Update the SceneTab call site**

Open `frontend/src/components/SceneTab.tsx`. Find the import and JSX:

```diff
-import { SceneUndoToast } from './SceneUndoToast';
+import { UndoToast } from './UndoToast';
```

```diff
-<SceneUndoToast
+<UndoToast
   key={lastPending[0]}
   title={lastPending[1].title}
   …
 />
```

- [ ] **Step 5: Confirm no stragglers**

Run:
```bash
grep -rn "SceneUndoToast\|scene-undo-countdown" frontend/src frontend/tests
```

Expected: zero matches. If any survive, edit them.

- [ ] **Step 6: Verify**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint:design
npm --prefix frontend test -- tests/components/SceneTab.test.tsx
```

Expected: typecheck 0; lint:design clean; SceneTab tests pass (the test asserts on `role=status`, `Deleted` text, and `Undo` button — all unchanged by the rename).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/UndoToast.tsx \
        frontend/src/components/UndoToast.stories.tsx \
        frontend/src/index.css \
        frontend/src/components/SceneTab.tsx
git commit -m "[chat-picker] rename SceneUndoToast -> UndoToast

Pure rename — implementation is already kind-agnostic. Both SceneTab
and the upcoming ChatTab consume it; the 'Scene' prefix was misleading
once the chat surface picks it up. Also renames the .scene-undo-countdown
CSS class to .undo-countdown."
```

---

## Task 3: Add optimistic chat mutations to `useChat.ts`

**Files:**
- Modify: `frontend/src/hooks/useChat.ts` — make `useCreateChatMutation` optimistic; add `useRenameChatMutation` + `useRemoveChatMutation`.
- Modify: `frontend/tests/hooks/useChat.test.tsx` — add tests for the three optimistic paths (mirror the patterns in `frontend/tests/hooks/useScenes.test.tsx`).

- [ ] **Step 1: Read the template**

Read `frontend/src/hooks/useScenes.ts` in full. The three mutations there (`createMut`, `renameMut`, `removeMut`, lines 21–62) are the exact pattern to replicate. They follow this shape:

```ts
const createMut = useMutation({
  mutationFn: () => createChat(chapterId!, { kind: 'scene' }),
  onSuccess: (created) => {
    qc.setQueryData<ChatRow[]>(sceneListKey, (prev) => [created, ...(prev ?? [])]);
    void qc.invalidateQueries({ queryKey: sceneListKey });
  },
});
```

Three things to copy: the `onSuccess` writes the optimistic update to the cache via `setQueryData` *before* the invalidation; the `kind` filter is hardcoded; and the rename mutation uses the server-returned title (not the variable from the call) to keep the cache consistent with the backend's title-truncation logic.

- [ ] **Step 2: Make `useCreateChatMutation` optimistic**

Open `frontend/src/hooks/useChat.ts`. Locate `useCreateChatMutation` (around line 154). Change the body to also write to the cache:

```ts
export function useCreateChatMutation(): UseMutationResult<
  ChatRow,
  Error,
  { chapterId: string; kind?: 'ask' | 'scene' }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chapterId, kind }) => createChat(chapterId, { kind }),
    onSuccess: (created, vars) => {
      const key = chatsQueryKey(vars.chapterId, vars.kind);
      qc.setQueryData<ChatRow[]>(key, (prev) => [created, ...(prev ?? [])]);
      void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(vars.chapterId) });
    },
  });
}
```

(Adjust the surrounding signature / type to whatever already exists — only the `onSuccess` body changes meaningfully.)

- [ ] **Step 3: Add `useRenameChatMutation`**

Append below `useCreateChatMutation`:

```ts
export function useRenameChatMutation(
  chapterId: string | null,
  kind: 'ask' | 'scene' = 'ask',
): UseMutationResult<ChatRow, Error, { id: string; title: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }) => patchChat(id, title),
    onSuccess: (updated, vars) => {
      if (chapterId === null) return;
      const key = chatsQueryKey(chapterId, kind);
      qc.setQueryData<ChatRow[]>(key, (prev) =>
        (prev ?? []).map((c) => (c.id === vars.id ? { ...c, title: updated.title } : c)),
      );
      void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(chapterId) });
    },
  });
}
```

(Imports: `patchChat` from `@/lib/api` — already there or add.)

- [ ] **Step 4: Add `useRemoveChatMutation`**

```ts
export function useRemoveChatMutation(
  chapterId: string | null,
  kind: 'ask' | 'scene' = 'ask',
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChat(id),
    onSuccess: (_void, id) => {
      if (chapterId === null) return;
      const key = chatsQueryKey(chapterId, kind);
      qc.setQueryData<ChatRow[]>(key, (prev) => (prev ?? []).filter((c) => c.id !== id));
      void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(chapterId) });
    },
  });
}
```

(Imports: `deleteChat` from `@/lib/api`.)

- [ ] **Step 5: Add tests for the three mutations**

Open `frontend/tests/hooks/useChat.test.tsx`. Read the existing setup to find the `wrapper` helper (QueryClientProvider) and the `fetchMock` pattern. Add three new `it(…)` tests modelled on `frontend/tests/hooks/useScenes.test.tsx`:

```tsx
it('useCreateChatMutation optimistically prepends to cache', async () => {
  // Mirror the pattern from useScenes.test.tsx — render the hook, mock POST,
  // call mutateAsync, assert qc.getQueryData has the new chat at index 0.
});
it('useRenameChatMutation updates the cached title from the server response', async () => {
  // …
});
it('useRemoveChatMutation filters the deleted id out of the cache', async () => {
  // …
});
```

Read `frontend/tests/hooks/useScenes.test.tsx` and copy its three corresponding tests verbatim into the new ones, replacing `kind: 'scene'` with `kind: 'ask'` and the URL paths from `/api/chapters/X/chats?kind=scene` to `…?kind=ask`. Keep the existing fetch-mocking idiom of the file.

- [ ] **Step 6: Run tests + typecheck**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend test -- tests/hooks/useChat.test.tsx
```

Expected: typecheck 0; the new three tests pass and existing ones still pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useChat.ts frontend/tests/hooks/useChat.test.tsx
git commit -m "[chat-picker] add optimistic create/rename/remove chat mutations

Mirrors the useScenes pattern: each mutation writes to the cache via
setQueryData before invalidating, so the picker UI updates without
the create→auto-select race that hit the Scene rollout."
```

---

## Task 4: Extract `ChatTab.tsx` orchestrator

**Files:**
- Create: `frontend/src/components/ChatTab.tsx`
- Create: `frontend/src/components/ChatTab.stories.tsx`
- Create: `frontend/tests/components/ChatTab.test.tsx`

- [ ] **Step 1: Read the template**

Read `frontend/src/components/SceneTab.tsx` in full. The structural shape to replicate:

1. Top-level state: `activeId` as local `useState<string | null>(null)`, default-select effect (lines 122–136).
2. `useScenesQuery` call (we use `useChatsQuery` with `kind: 'ask'`).
3. `useSoftDelete` wiring (lines 190–195).
4. `onGenerate` callback that creates a chat if needed and calls the streaming send (lines 202–229).
5. `onRetry`, `onInsert`, `onCopy`, `onDelete`, `onUndo` (lines 231–267).
6. Auto-rename on first send via `truncateAtWordBoundary` (lines 42, 219–224).
7. JSX: `<div className="flex flex-col h-full">` → picker → transcript section → composer wrapped in `<div className="relative">` with the `UndoToast` overlay at `bottom-[calc(100%+8px)]`.

- [ ] **Step 2: Define `CHAT_LABELS` and `truncateAtWordBoundary`**

Decide where `truncateAtWordBoundary` lives. Currently it's a private helper inside `SceneTab.tsx` (line 42). Lift it to `frontend/src/lib/strings.ts` as a new shared module so both `SceneTab` and `ChatTab` import it. (If `frontend/src/lib/strings.ts` already exists, add the export there; if not, create it with just this helper.)

Inline a `CHAT_LABELS` constant at the top of `ChatTab.tsx`:

```ts
const CHAT_LABELS: SessionPickerLabels = {
  kindLabel: 'CHAT',
  ariaPrefix: 'Chat: ',
  dropdownHeader: 'Chats in this chapter',
  newButtonLabel: 'New chat',
};
```

- [ ] **Step 3: Write `ChatTab.tsx`**

Create `frontend/src/components/ChatTab.tsx`. Import `SessionPicker`, `SessionPickerLabels`, `useChatsQuery`, `useCreateChatMutation`, `useRenameChatMutation`, `useRemoveChatMutation`, `useSendChatMessageMutation`, `useSoftDelete`, `UndoToast`, `ChatMessages`, `ChatComposer`, `useErrorStore`, `truncateAtWordBoundary`, `useUserSettings`, `checkChatSendGuards`, `useAttachedSelectionStore` (for `clearAttachedSelection` and the chip — read `frontend/src/store/attachedSelection.ts` to confirm exports), and any types it needs.

Component props:

```ts
interface ChatTabProps {
  chapterId: string | null;
  editor: Editor | null;
}
```

Internal logic — the canonical reproduction of the structural template, adapted for chat:

```tsx
export function ChatTab({ chapterId, editor }: ChatTabProps): JSX.Element {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const chatsQuery = useChatsQuery(chapterId, { kind: 'ask' });
  const sessions = chatsQuery.data ?? [];

  const createChat = useCreateChatMutation();
  const renameChat = useRenameChatMutation(chapterId, 'ask');
  const removeChat = useRemoveChatMutation(chapterId, 'ask');
  const sendChatMessage = useSendChatMessageMutation();

  const settings = useUserSettings();
  const selectedModelId = settings.chat.model;

  // Default-select first session when no active selection or active is stale.
  useEffect(() => {
    if (activeChatId === null && sessions.length > 0) {
      setActiveChatId(sessions[0].id);
      return;
    }
    if (activeChatId !== null && !sessions.some((s) => s.id === activeChatId)) {
      setActiveChatId(sessions[0]?.id ?? null);
    }
  }, [activeChatId, sessions, setActiveChatId]);

  const {
    pending: pendingDeletes,
    isPending: isDeletePending,
    scheduleDelete,
    undo: undoDelete,
  } = useSoftDelete((id) => removeChat.mutateAsync(id), { timeoutMs: 5_000 });

  const onSend = useCallback(
    async (args: ChatSendArgs): Promise<void> => {
      const guard = checkChatSendGuards({ activeChapterId: chapterId, selectedModelId });
      if (guard) {
        useErrorStore.getState().push(guard);
        return;
      }
      const cId = chapterId as string;
      const mId = selectedModelId as string;

      let chatId = activeChatId;
      const isFirstTurn = chatId === null;
      if (chatId === null) {
        const created = await createChat.mutateAsync({ chapterId: cId, kind: 'ask' });
        chatId = created.id;
        setActiveChatId(chatId);
      }

      const sendArgs: Parameters<typeof sendChatMessage.mutateAsync>[0] = {
        chatId,
        content: args.content,
        modelId: mId,
        enableWebSearch: args.enableWebSearch,
      };
      if (args.attachment) {
        sendArgs.attachment = {
          selectionText: args.attachment.text,
          chapterId: args.attachment.chapter.id,
        };
      }
      await sendChatMessage.mutateAsync(sendArgs);

      if (isFirstTurn) {
        const title = truncateAtWordBoundary(args.content, 60);
        try {
          await renameChat.mutateAsync({ id: chatId, title });
        } catch {
          // non-fatal — chat remains usable without a title
        }
      }
      // composer keeps its own state; clear the attached selection chip after success
      useAttachedSelectionStore.getState().clear();
    },
    [chapterId, selectedModelId, activeChatId, createChat, renameChat, sendChatMessage, setActiveChatId],
  );

  const onRetry = useCallback((): void => {
    // Mirror EditorPage's handleRetryChatSend — read lastChatSendArgsRef.current
    // and call onSend with it. lastChatSendArgsRef stays as a ref inside ChatTab.
  }, [onSend]);

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
    [sessions, scheduleDelete, activeChatId, setActiveChatId],
  );

  const onRename = useCallback(
    (id: string, title: string) => {
      void renameChat.mutateAsync({ id, title });
    },
    [renameChat],
  );

  const visibleSessions = sessions.filter((s) => !isDeletePending(s.id));

  const pendingEntries = Array.from(pendingDeletes.entries());
  const lastPending = pendingEntries.length > 0 ? pendingEntries[pendingEntries.length - 1] : null;

  const TITLE_MAX_CHARS = 60;
  // (TITLE_MAX_CHARS already exists in SceneTab; keep the value identical for
  // visual consistency.)

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
        onNew={() => {
          if (chapterId === null) return;
          void createChat.mutateAsync({ chapterId, kind: 'ask' }).then((c) => {
            setActiveChatId(c.id);
          });
        }}
      />

      <ChatMessages
        chatId={activeChatId}
        chapterTitle={null /* parent owns this — pass null or thread later */}
        attachedCharacterCount={0}
        attachedTokenCount={0}
        sendError={sendChatMessage.error}
        onRetrySend={onRetry}
      />

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
        <ChatComposer onSend={onSend} disabled={sendChatMessage.isPending} />
      </div>
    </div>
  );
}
```

(The exact prop list for `<ChatMessages>` may differ — read `frontend/src/components/ChatMessages.tsx` props and pass through whatever EditorPage was already passing. The `chapterTitle` and `attachedCharacterCount`/`attachedTokenCount` may need to come from a hook call inside `ChatTab` rather than from EditorPage; if so, adapt the inputs accordingly.)

- [ ] **Step 4: Stories file**

Create `frontend/src/components/ChatTab.stories.tsx`. Mirror `frontend/src/components/SceneTab.stories.tsx` if it exists; otherwise model on `SceneSessionPicker.stories.tsx` with three exports: `Empty`, `WithSessions`, `WithUndo`. The decorator should mock `useChatsQuery` via TanStack Query's `setQueryData` or pass a wrapper that provides a seeded `QueryClient`.

If mocking the query at the story layer is too involved, write only the `Empty` story for this PR and defer richer stories to a follow-up. Don't block the implementation on Storybook fidelity.

- [ ] **Step 5: Smoke test**

Create `frontend/tests/components/ChatTab.test.tsx`. Mirror the structure of `frontend/tests/components/SceneTab.test.tsx` exactly: same `renderWithProviders`, same `makeClient`, same `fetchMock` shape, same `useSessionStore` setup. Cover three behaviours:

1. **Renders empty state with no sessions.** Mock `GET /api/chapters/X/chats?kind=ask` to return `{ chats: [] }`. Render `<ChatTab chapterId="ch1" editor={null} />`. Assert that no picker option is selected and the empty composer renders.

2. **Soft-delete shows the undo toast.** Same setup as `SceneTab.test.tsx`'s soft-delete test (read it for the exact pattern). Mock one chat session, click the picker, click delete, assert the toast appears, click Undo, assert the toast dismisses.

3. **Auto-rename fires on first send.** Mock `chats: []`, then mock `POST /api/chapters/X/chats` returning `{ id: 'c1', title: null, … }`, then mock `POST /api/chats/c1/messages` returning a streaming SSE response (use whatever pattern the existing `useChat.test.tsx` uses — probably a simple JSON 200), then mock `PATCH /api/chats/c1` returning `{ id: 'c1', title: 'first user message…', … }`. After firing the send via the composer, assert the PATCH was called with the truncated title.

For test 3, if the SSE streaming mock is complex enough that this test would balloon in size, replace it with a smaller test that calls `truncateAtWordBoundary` directly (already covered by Scene tests if so) and asserts `useRenameChatMutation` is called when the helper is invoked. Document in a code comment why the simpler approach was taken.

- [ ] **Step 6: Run all the new tests**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend test -- tests/components/ChatTab.test.tsx
npm --prefix frontend run lint:design
```

Expected: typecheck 0; new tests pass; lint:design clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ChatTab.tsx \
        frontend/src/components/ChatTab.stories.tsx \
        frontend/tests/components/ChatTab.test.tsx \
        frontend/src/lib/strings.ts
git commit -m "[chat-picker] extract ChatTab orchestrator with SessionPicker

Mirrors SceneTab structure: owns activeChatId via local useState,
renders SessionPicker + ChatMessages + ChatComposer in flex column.
Auto-renames a new chat on first send via truncateAtWordBoundary.
Soft-deletes via useSoftDelete + UndoToast (renamed in Task 2).

Lifts truncateAtWordBoundary out of SceneTab into frontend/src/lib/strings.ts
so SceneTab and ChatTab share the helper."
```

---

## Task 5: Wire `ChatTab` into `ChatPanel` + cleanup `EditorPage`

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx` — replace `messagesBody` + `composer` slot props with a single `chatBody` prop. Delete the `+ New chat` header button and its `onNewChat` prop entirely.
- Modify: `frontend/src/pages/EditorPage.tsx` — drop inline chat orchestration; pass `<ChatTab .../>` as `chatBody`; drop `handleNewChat` and the `onNewChat={…}` JSX prop.
- Modify: `frontend/tests/components/ChatPanel.test.tsx` — update assertions to the new prop shape; delete `+`-button assertions.

- [ ] **Step 1: Reshape `ChatPanel.tsx` props and delete the `+` button**

Open `frontend/src/components/ChatPanel.tsx`.

a. In `ChatPanelProps`: delete `messagesBody`, `composer`, and `onNewChat` props. Add a single `chatBody: ReactNode`.

b. Delete the `PlusIcon` helper component (lines 39 onwards — find the `function PlusIcon` declaration). It is used only by the `+` New chat button which is being removed; if `grep` finds no other use, it goes too.

c. In the JSX: delete the entire `+` New chat button JSX block (search for `aria-label="New chat"` or `onNewChat` to find it). Update the body section so `{activeTab === 'chat' && chatBody}` renders inside the same `<section>` as the scene/history bodies. Drop the outer composer wrapper (`{activeTab === 'chat' ? (<div className="border-t border-line">{composer}</div>) : null}`) entirely — `ChatTab` owns the composer now.

After the change the JSX body section should look like:

```tsx
<section className="flex-1 min-h-0 overflow-hidden" aria-label="Chat messages" data-testid="chat-body">
  {activeTab === 'chat' && chatBody}
  {activeTab === 'scene' && sceneBody}
  {activeTab === 'history' && (
    <div className="px-4 py-6 text-[12px] text-ink-4">History — coming in a future task</div>
  )}
</section>
```

d. Verify with `grep -n "onNewChat\|PlusIcon\|messagesBody\|composer" frontend/src/components/ChatPanel.tsx` — should return zero matches after the edit.

- [ ] **Step 2: Rewire `EditorPage.tsx`**

Open `frontend/src/pages/EditorPage.tsx`. Delete the chat-orchestration block (everything from `const chatsQuery = useChatsQuery(...)` at line 174 through `const handleRetryChatSend = useCallback(...)` at line 248), the `lastChatSendArgsRef` at line 188, the `useChatMessagesQuery` call at line 176 if it's used only for the now-deleted `chatMessages`, the `handleNewChat` callback at lines 183–186, and the `clearAttachedSelection` call site if it moved into ChatTab.

Replace the slot wiring (originally lines 670–690, the `<ChatPanel ...>` JSX) with:

```tsx
<ChatPanel
  chatBody={<ChatTab chapterId={activeChapterId} editor={editor} />}
  sceneBody={<SceneTab chapterId={activeChapterId} editor={editor} />}
  onOpenModelPicker={() => {
    setSettingsInitialTab('models');
    setSettingsOpen(true);
  }}
  onOpenSettings={() => {
    setSettingsOpen(true);
  }}
/>
```

Note: `onNewChat` is gone from the props. Don't replace it — the picker's `+ New chat` entry inside ChatTab is the only creation surface now.

Remove the now-unused imports: `useChatsQuery`, `useChatMessagesQuery`, `useCreateChatMutation`, `useSendChatMessageMutation`, `ChatComposer`, `ChatMessages`, `checkChatSendGuards`, `useErrorStore` (if not used elsewhere in the file — verify with `grep`), `clearAttachedSelection` (if not used), `truncateAtWordBoundary` (now in `frontend/src/lib/strings.ts`).

- [ ] **Step 3: Update `ChatPanel.test.tsx`**

Open `frontend/tests/components/ChatPanel.test.tsx`.

a. Replace any `messagesBody` / `composer` prop usage in render-helpers with `chatBody`.

b. **Delete every test that asserts on the `+ New chat` button** (e.g. the test at lines 149–162 from the explorer report, and any other `findByRole('button', { name: /New chat/i })` or `aria-label="New chat"` assertion). The button is gone in this PR; tests that assert its existence are testing removed functionality.

c. Tab-switching tests and the Chat/Scene tab `aria-selected` assertions stay (lines 134–146 and 261–273 from the explorer report) — those are independent of the `+` button.

d. If any test asserts on the old DOM structure (e.g., the outer composer wrapper `<div className="border-t border-line">`), update it to assert on whatever DOM `<ChatTab>` (or a stub passed as `chatBody`) renders.

The total test count in this file may go down by 1–2 tests after the deletion of the `+`-button assertions. That is expected and correct.

- [ ] **Step 4: Verify**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run lint:design
```

Expected:
- Typecheck 0.
- All frontend tests pass (the SessionPicker + SceneTab tests passed in Task 1, then re-passed in Task 2 after the toast rename; the useChat mutation tests passed in Task 3; the new ChatTab tests passed in Task 4; ChatPanel tests pass after the prop-shape update + `+`-button-test deletion).
- lint:design 0.

If any test in `ChatMessages.test.tsx` or `ChatComposer.test.tsx` breaks because they were testing through `ChatPanel`'s slot indirection, fix them by mounting the components directly (the way SceneCandidateCard.test.tsx does for SceneTab pieces) instead of by going around the failure.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx \
        frontend/src/pages/EditorPage.tsx \
        frontend/tests/components/ChatPanel.test.tsx
git commit -m "[chat-picker] wire ChatTab into ChatPanel; remove legacy + button

ChatPanel now takes a single chatBody slot mirroring sceneBody.
EditorPage delegates all chat session state to ChatTab. The legacy
header '+ New chat' button is removed outright — the picker's
'+ New chat' entry replaces it. (Picks up part of story-editor-tv4's
scope; tv4 still owns the History tab + duplicate Settings icon.)"
```

---

## Task 6: Manual verification + push

**Files:** none (verification only).

- [ ] **Step 1: Storybook spot-check**

```bash
npm --prefix frontend run storybook
```

Visit `http://localhost:6006`. Confirm:
- `Chat → SessionPicker → Default` renders with scene labels (existing behaviour preserved).
- `Chat → SessionPicker → ChatLabels` renders with "CHAT" badge, "Chats in this chapter" header, "New chat" button.
- `Chat → UndoToast → InContext` still renders correctly (no regression).

Stop Storybook (Ctrl+C).

- [ ] **Step 2: Live stack spot-check**

```bash
make dev
```

In a browser at `http://localhost:3000`:
1. Sign in, open a story with a chapter, open the **Chat** tab.
2. Confirm a "CHAT" picker is visible at the top with the active chat title and timestamp.
3. Open the picker, hover a row, click the pencil → rename inline → save with Enter; confirm the title persists.
4. Open the picker, click `+ New chat` → a new entry appears and is auto-selected.
5. Send a message; confirm the chat is auto-renamed to a truncated form of the user's first message.
6. Hover a row, click the trash → confirm the row disappears, the undo toast pins above the composer (not over it), and clicking Undo restores the chat within 5s.
7. Confirm the legacy `+ New chat` icon next to the tabs is **gone** — the picker's `+ New chat` entry is now the only creation surface.
8. Repeat across paper / sepia / dark themes.

If anything misbehaves, capture symptom in `bd create` and stop — don't patch in `make dev`.

- [ ] **Step 3: Stop the stack**

```bash
make stop
```

- [ ] **Step 4: Final guardrails**

```bash
npm --prefix frontend run lint:design
npm --prefix frontend run typecheck
npm --prefix frontend test
```

Expected: each exits 0.

- [ ] **Step 5: Close bd issue + push**

```bash
bd close story-editor-n4h
git pull --rebase
git push
git status   # MUST show "up to date with origin"
```

---

## Self-Review

- **Spec coverage.** The bd description's six bullets are covered:
  - "dropdown listing chat sessions, inline rename via pencil, delete with undo toast, '+ New chat' button at the bottom" — Task 1 generalises the picker; Task 4 wires it into ChatTab with the chat labels.
  - "auto-name + start a new chat on the first written message when no session is active" — Task 4 Step 3's `onSend` callback covers both the no-session-create-then-send and the auto-rename-on-first-turn flows.
  - "Reuse SceneSessionPicker as a shared primitive (or extract one — SessionPicker generic over kind)" — Task 1.
  - The six referenced commits (b3b9c3d, 824cace, 8378864, 954b1ef, b87758c, 84b2dd1) cover behaviours already shipped on `main` after PR #85 — they are already present in `useScenes`, `SceneTab`, and `UndoToast` (renamed from `SceneUndoToast` in Task 2). Tasks 3 and 4 transplant the same mechanics. Steps of Task 4 cite their structural counterparts.
  - "Should also incorporate the bug-1 fix from the Scene rollout: useChats must optimistically update its query cache on create/rename/remove" — Task 3 is exactly this.
  - "Touches: ChatPanel composer, useChat hook, new ChatSessionPicker (or generalised SessionPicker), ChatTab" — Tasks 1+2 (picker + toast generalisation), 3 (mutations), 4 (orchestrator), 5 (composer slot reshape).

- **Scope boundary with `tv4`.** This PR removes the legacy `+ New chat` header button as a side effect of the picker landing — that's part of `tv4`'s scope, but retaining it would have required a Zustand bridge for state we don't otherwise need. The History tab and the duplicate Settings icon stay; `tv4` still owns those.

- **Placeholder scan.** No `TBD`, no `add validation`, no `similar to Task N`. Task 4 Step 3 contains the full ChatTab body verbatim; Task 4 Step 5 names three concrete tests with their fetch-mock URL patterns. Task 4 Step 4 (`Stories file`) explicitly allows the implementer to defer rich stories if mocking the query layer is too involved — this is a pragmatic carve-out, not a placeholder.

- **Type consistency.** `SessionPickerLabels` is defined in Task 1 Step 2 and reused in Task 1 Step 3 (Scene call site), Task 1 Step 4 (stories), Task 1 Step 5 (test), and Task 4 Step 2 (`CHAT_LABELS`). `UndoToastProps` is defined in Task 2 Step 2 (rename only — same shape as the original `SceneUndoToastProps`) and consumed unchanged by SceneTab and ChatTab. `useCreateChatMutation`'s new vars shape `{ chapterId, kind }` is produced in Task 3 Step 2 and consumed in Task 4 Step 3 (via `kind: 'ask'`). `useRenameChatMutation` and `useRemoveChatMutation` curry on `(chapterId, kind)` (Task 3 Steps 3–4) and are constructed inside ChatTab with `(chapterId, 'ask')` (Task 4 Step 3).

- **Test coverage of regressions.** Task 1 Step 6 reruns the existing SessionPicker + SceneTab tests. Task 2 Step 6 reruns the SceneTab test to confirm the rename did not regress the soft-delete flow. Task 3 adds three new useChat mutation tests. Task 4 adds three ChatTab smoke tests (empty, undo, auto-rename). Task 5 trims `+`-button assertions from `ChatPanel.test.tsx` (test count drops by 1–2; the deleted assertions test removed UI). Task 6 Step 4 reruns the full suite.
