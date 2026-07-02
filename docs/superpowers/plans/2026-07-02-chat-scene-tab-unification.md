# ChatTab / SceneTab Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the ~330-line copy-pasted orchestration shell shared by `ChatTab` and `SceneTab` into one kind-parametrized component, and in doing so fix the two live bugs the duplication caused: (A) a failed chat send in ChatTab is an unhandled promise rejection (ChatTab awaits `mutateAsync` bare while ChatComposer fires `void onSend(args)`); (B) a selection attached while the Scene tab is active shows in the composer chip, is cleared on send, and is silently dropped from the request (SceneTab's onSend never forwards `args.attachment`). Also fold in one small papercut: a guard-rejected send (no chapter / no model) currently destroys the user's typed message because the composer clears its textarea unconditionally.

**Architecture:** Frontend-only; zero backend changes. Both tabs already share all the real machinery — `useMessageActions`, `useBannerRetry`, `useSoftDelete`, `TranscriptView`, `ChatComposer`, `SessionPicker`, the `useChat` query/mutation hooks — only the orchestration shell was duplicated. Create `frontend/src/components/ChatSceneTab.tsx`: one component taking `kind: 'ask' | 'scene'` with a small per-kind config table for the handful of true divergences (labels, empty state, root testid, insert-at-end action, streaming label — full inventory in Task 1). `ChatTab.tsx` and `SceneTab.tsx` become ~10-line wrappers (`<ChatSceneTab kind="ask" …/>` / `kind="scene"`), so `EditorPage`, the existing test files, and the existing Storybook stories all keep working untouched — they ARE the regression net. Error handling unifies on SceneTab's try/catch pattern (errors already surface via `sendChatMessage.error` → `TranscriptView`'s `VeniceErrorBanner`, and pre-send guards via `useErrorStore`), which fixes Bug A by construction. Attachment forwarding unifies on ChatTab's pattern for both kinds, which fixes Bug B (the backend already fully supports scene attachments — see Design decisions). The papercut is fixed with a small acceptance contract on `onSend` so `ChatComposer` restores the draft when a send is rejected before being consumed.

**Tech Stack:** React + TypeScript strict + Vite + Vitest/jsdom + React Testing Library + TailwindCSS (token-only) + Zustand + TanStack Query + TipTap.

## Global Constraints

- TypeScript strict mode — no `any`.
- Design-lint guard (`frontend/scripts/lint-design.mjs`) enforces token-only styling in `frontend/src/` — theme tokens only, never raw hex.
- Frontend component files are PascalCase; hooks/lib/store files are camelCase. Tests live under `frontend/tests/` (mirroring source path), run under jsdom (vitest); assert via `data-testid` / role / text with React Testing Library. New tests follow the scaffolding already established in `frontend/tests/components/ChatTab.test.tsx` / `SceneTab.test.tsx` (partial `vi.mock('@/lib/api')` to intercept `apiStream`, stubbed global `fetch`, seeded TanStack Query cache, Zustand store resets in setup/teardown).
- **Behavior preservation is the bar.** Every assertion in the existing `ChatTab.test.tsx` (auto-rename, soft-delete/undo, stop-while-streaming, useMessageActions integration, guard toast), `ChatTab.copy.test.tsx`, `SceneTab.test.tsx` (session picker, auto-rename, hydration errors, insert-at-end, retry semantics, stop, enableWebSearch, banner retry, useMessageActions parity), `ChatComposer.test.tsx`, and `ChatPanel.test.tsx` must pass unmodified, except where a task below explicitly says otherwise (none currently do). Existing `data-testid` values (`chat-tab`, `scene-tab`, `chat-empty`, `scene-empty`) and all aria-labels must survive the extraction.
- Do not modify anything under `backend/` or `shared/` — the wire contract (`SendChatMessageArgs.attachment` in `frontend/src/hooks/useChat.ts:168`, `messageAttachmentSchema` in `shared/src/schemas/message.ts:65`) already supports everything this plan needs.
- Verify: `npm --prefix frontend run typecheck && npm --prefix frontend run test -- ChatSceneTab ChatTab SceneTab ChatComposer ChatPanel && node frontend/scripts/lint-design.mjs`

## Design decisions

1. **Bug B — forward scene attachments (do NOT hide the chip).** Verified against the backend: the send handler in `backend/src/routes/chat.routes.ts` is kind-agnostic about attachments — it validates `body.attachment.chapterId` against the chat's chapter for every kind (~line 243, `attachment_chapter_mismatch`), persists it on the user message (`attachmentJson: body.attachment ?? null`, ~line 431), and feeds `body.attachment?.selectionText ?? ''` into `buildPrompt` (~line 369). The scene branch of `buildPrompt` (`backend/src/services/prompt.service.ts`, ~lines 230–241) explicitly appends `\n\nAttached selection: «…»` to the user payload when `selectedText` is non-empty, and the `[k1r]` history mapping gives prior scene turns with `attachmentJson` the same suffix. So forwarding is the zero-backend-change option AND the feature-preserving one; hiding the chip for `kind='scene'` would require new kind-awareness in `ChatComposer` and throw away a working capability. **Decision: the unified shell forwards `args.attachment` for both kinds (ChatTab's existing mapping).** Bonus: the optimistic draft-user row already renders the attachment chip from the draft store (`r.attachment`, seeded by the mutation's `onMutate` from `args.attachment`), so the scene draft bubble becomes honest too.
2. **Shell shape — one `ChatSceneTab` component with a `kind` prop and an internal per-kind config table, no slot props, no separate controller hook.** Every real divergence found in the full-file audit (table in Task 1) is static, kind-determined data or a single kind-gated action — nothing a caller needs to inject. `ChatTab`/`SceneTab` remain as thin wrappers so `EditorPage.tsx:635–637`, all existing test imports, and `ChatTab.stories.tsx` / `SceneTab.stories.tsx` are untouched. No new Storybook story is warranted: the existing two stories now exercise the shared shell through the wrappers, which is exactly the coverage a `ChatSceneTab` story would duplicate.
3. **Error handling — SceneTab's try/catch pattern, extended to cover the inline-create await.** Send failures are already reflected in `sendChatMessage.error` (→ `VeniceErrorBanner` inside `TranscriptView`) and the chat-draft store, so the catch swallows deliberately (SceneTab.tsx:141–145 comment: "Don't propagate — ChatComposer calls onSend via `void onSend(args)`"). The bare `await createChat.mutateAsync(...)` (present in BOTH tabs today, ChatTab.tsx:103 / SceneTab.tsx:122) is the same latent unhandled-rejection one layer up; the shell wraps it too and pushes a `chat.send`-sourced entry to `useErrorStore` (create failure never sets `sendChatMessage.error`, so no banner would show otherwise).
4. **Papercut — `onSend` acceptance contract.** `ChatComposerProps.onSend` widens to `(args: SendArgs) => void | boolean | Promise<void | boolean>`; **explicit `false` means "message not consumed"** (pre-send guard rejection, or inline-create failure) and the composer restores the typed text + attachment. `void`/`undefined`/`true` mean consumed — including failed sends, whose content lives on in the draft row + banner-retry path (`lastSendArgsRef`), so restoring there would duplicate it. Backward compatible: every existing test/story passing a `vi.fn()` (resolves `undefined`) keeps the current clear-on-send behavior.
5. **Tab-switch state loss is OUT of scope.** `ChatPanel.tsx:82–83` mounts only the active tab body (`{activeTab === 'chat' && chatBody}`), so switching tabs unmounts the inactive tab and loses its local `activeChatId` + composer text. Real papercut, but fixing it (keep-both-mounted with CSS hiding, or lifting state to a store) is an independent design question with its own tradeoffs (double query subscriptions vs. store lifecycle). File a follow-up bd issue; do not widen this plan.

---

### Task 1: Extract `ChatSceneTab` and fix Bug A (unhandled rejection) + Bug B (dropped scene attachment)

**Root cause:** `frontend/src/components/ChatTab.tsx` (327 lines) and `frontend/src/components/SceneTab.tsx` (365 lines) are near-duplicates: the same default-select effect (ChatTab:74–82 vs SceneTab:93–101), onSend (:91–141 vs :110–157), soft-delete + UndoToast block (:84–89, :298–310 vs :103–108, :336–348), onDelete/onRename/onNew (:152–177 vs :189–214), and an ~80-line identical `TranscriptView` render-prop body (:218–295 vs :245–333). The two copies then drifted in opposite directions, each keeping one bug the other fixed:

- **Bug A:** SceneTab wraps `sendChatMessage.mutateAsync` in try/catch (SceneTab:133–145); ChatTab awaits it bare (ChatTab:127). `ChatComposer.handleSend` invokes `void onSend(args)` (ChatComposer.tsx:162), so a failed ask-chat send rejects with no handler anywhere — an unhandled promise rejection on every Venice error in the Chat tab.
- **Bug B:** ChatComposer renders the attachment chip from the global `useAttachedSelectionStore` for both tabs and passes `attachment` in `SendArgs` (ChatComposer.tsx:157–160), but SceneTab's `mutateAsync` payload (SceneTab:134–140) has no `attachment` field — the chip shows, `clearAttachment()` wipes it on send (ChatComposer.tsx:164), and the selection silently never reaches the backend. ChatTab forwards it correctly (ChatTab:121–126).

**Fix:** One shared `ChatSceneTab` built from the union of the two correct halves: SceneTab's try/catch (extended over the inline-create await) + ChatTab's attachment mapping, applied for both kinds. Wrappers preserve the public components.

**Full divergence inventory** (from reading both files end-to-end — the implementer must not guess beyond this table):

| # | Divergence | ChatTab (`kind='ask'`) | SceneTab (`kind='scene'`) | Unified behavior |
|---|---|---|---|---|
| 1 | Chat kind in queries/mutations (`useChatsQuery`, `useCreateChatMutation` args, `useRenameChatMutation`, `useRemoveChatMutation`) | `'ask'` | `'scene'` | `kind` prop threaded through |
| 2 | `SessionPickerLabels` | `CHAT_LABELS` (:38–43): `CHAT` / `Chat: ` / `Chats in this chapter` / `New chat` | `SCENE_LABELS` (:61–66): `SCENE` / `Scene session: ` / `Scenes in this chapter` / `New scene` | per-kind config (verbatim) |
| 3 | Root `data-testid` | `chat-tab` (:194) | `scene-tab` (:221) | per-kind config (verbatim — tests depend on both) |
| 4 | Empty state | `<ChatEmptyState />` (:211, testid `chat-empty`) | `<SceneEmptyState />` (:238, testid `scene-empty`) | per-kind config |
| 5 | Assistant-row actions | Copy + Regenerate (:240–248) | InsertAtEnd + Copy + Regenerate (:267–285); `onInsert` runs `editor.chain().focus().insertContentAt(docEnd, text).run()` (:179–187) | config flag `showInsertAtEnd`; `onInsert` lives in the shell, rendered only for `scene` |
| 6 | `editor` prop use | accepted, `void editor` (:46–48) | used by `onInsert` | shell keeps the prop; used only when `showInsertAtEnd` |
| 7 | draft-assistant `thinkingLabel` | none (component default) | `"Generating scene…"` (:327) | per-kind config (`undefined` for ask) |
| 8 | **onSend error handling (Bug A)** | bare `await sendChatMessage.mutateAsync(sendArgs)` (:127) | try/catch, swallow + early return (:133–145) | SceneTab pattern, extended over the create await (Design decision 3) |
| 9 | **Attachment forwarding (Bug B)** | maps `args.attachment` → `{ selectionText: args.attachment.text, chapterId: args.attachment.chapter.id }` (:121–126) | absent | ChatTab pattern, both kinds (Design decision 1) |
| 10 | Post-success `useAttachedSelectionStore.getState().clear()` | present (:137–138) | absent | **dropped** — `ChatComposer.handleSend` already clears the store synchronously at send time (:164), so this line is dead on the happy path and actively wrong in one edge (a selection attached *during* streaming would be wiped by the earlier send's success). Behavior delta is nil-to-positive; noted here so the reviewer doesn't flag it as an accidental omission |
| 11 | Ref name | `lastChatSendArgsRef` (:71) | `lastSceneSendArgsRef` (:90) | `lastSendArgsRef` (cosmetic) |
| 12 | Model selection | `useUserSettings().chat.model` (:59–60) | identical (:69–70) | checked explicitly: **no per-kind model override exists** — shared read |

Everything else — default-select effect, `useSoftDelete` wiring (5 000 ms), `useBannerRetry` wiring, `TITLE_MAX_CHARS = 50` + first-turn auto-title (with its post-resolve `isFirstTurn` evaluation comment, ChatTab:107–111), `onDelete`/`onRename`/`onNew`, the entire render-prop body, `ResendConfirmDialog`, composer wiring — is byte-for-byte identical modulo the rows above, and moves into the shell verbatim.

**Files:**
- Create: `frontend/src/components/ChatSceneTab.tsx` (shared shell)
- Modify: `frontend/src/components/ChatTab.tsx` (reduce to wrapper)
- Modify: `frontend/src/components/SceneTab.tsx` (reduce to wrapper)
- Test: `frontend/tests/components/ChatSceneTab.test.tsx` (create — the two bug tests, exercised through the wrappers)

**Interfaces:**
- Produces:
  ```ts
  // frontend/src/components/ChatSceneTab.tsx
  export type ChatSceneKind = 'ask' | 'scene';
  export interface ChatSceneTabProps {
    kind: ChatSceneKind;
    chapterId: string | null;
    editor: TiptapEditor | null;
  }
  export function ChatSceneTab(props: ChatSceneTabProps): JSX.Element;
  ```
  with a module-level `KIND_CONFIG: Record<ChatSceneKind, { rootTestId: string; labels: SessionPickerLabels; EmptyState: () => JSX.Element; thinkingLabel: string | undefined; showInsertAtEnd: boolean }>` holding rows 2–5/7 of the table.
- Preserves exactly: `ChatTabProps { chapterId: string | null; editor: TiptapEditor | null }` and `SceneTabProps` (same shape) — both components now `return <ChatSceneTab kind="ask|scene" chapterId={chapterId} editor={editor} />;`.
- Consumes (unchanged): `useSendChatMessageMutation` / `SendChatMessageArgs` (incl. `attachment?: { selectionText: string; chapterId: string }`, `frontend/src/hooks/useChat.ts:155–170`), `checkChatSendGuards`, `useErrorStore.push`, `useBannerRetry`, `useSoftDelete`, `useMessageActions`.

- [ ] **Step 1: Write the failing test for Bug A (unhandled rejection on failed ask-chat send)**

Create `frontend/tests/components/ChatSceneTab.test.tsx` using the exact scaffolding of `ChatTab.test.tsx` (partial `vi.mock('@/lib/api')`, `jsonResponse` helper, `renderWithProviders`, session-store + chat-draft-store setup/teardown; also reset `useAttachedSelectionStore` and `useErrorStore` in setup/teardown — Bug B and Task 2 touch them). First test:

```tsx
it('a failed ask-chat send shows the error banner with NO unhandled promise rejection and NO auto-title', async () => {
  // fetch mock: existing chat c1 (kind 'ask', messageCount 0) on ch1; GET messages → [].
  // (Reuse the "Existing chat" mock shape from ChatTab.test.tsx's Stop-button test.)
  vi.mocked(apiStream).mockRejectedValueOnce(new Error('Venice quota exceeded'));

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    const user = userEvent.setup();
    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, makeModelClient());
    await screen.findByRole('button', { name: /Chat: Existing chat/ });

    const textarea = await screen.findByLabelText('Message');
    await user.type(textarea, 'hello world');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // Error surfaces through the shared banner path…
    await screen.findByTestId('venice-error-banner');
    // …and the first-turn auto-title must NOT fire on the failure path.
    const patchCalls = (fetchMock.mock.calls as [string, RequestInit?][]).filter(
      ([url, init]) => url.includes('/chats/c1') && !url.includes('/messages') &&
        init?.method?.toUpperCase() === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);

    // Give a dangling rejection time to reach the process handler.
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).toHaveLength(0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
```

> Note for implementer: pre-fix, this test fails at `expect(unhandled).toHaveLength(0)` — and vitest may additionally report the dangling rejection as an unhandled error against the file. Both are the expected RED state. The success-path auto-title is already covered by `ChatTab.test.tsx` "auto-renames an explicitly-created new chat after the first send" — do not duplicate it here.

- [ ] **Step 2: Write the failing test for Bug B (scene send drops the attached selection)**

Same file:

```tsx
it('forwards the attached selection on a scene send', async () => {
  // fetch mock: existing scene sc1 (kind 'scene', messageCount 1) on ch1; GET messages → [].
  vi.mocked(apiStream).mockResolvedValueOnce(sseResponse()); // same SSE helper as SceneTab.test.tsx

  useAttachedSelectionStore.getState().setAttachedSelection({
    text: 'Linda sat alone on the veranda.',
    chapter: { id: 'ch1', number: 3, title: 'The Veranda' },
  });

  const user = userEvent.setup();
  renderWithProviders(<SceneTab chapterId="ch1" editor={null} />, makeModelClient());
  await screen.findByRole('button', { name: /Scene session: Existing/ });

  const textarea = await screen.findByLabelText('Message');
  await user.type(textarea, 'Continue the confrontation');
  await user.keyboard('{Control>}{Enter}{/Control}');

  await waitFor(() => {
    const calls = vi.mocked(apiStream).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const init = calls[calls.length - 1][1] as { body?: Record<string, unknown> };
    expect(init.body?.attachment).toEqual({
      selectionText: 'Linda sat alone on the veranda.',
      chapterId: 'ch1',
    });
  });
});
```

- [ ] **Step 3: Run the new tests to verify both fail**

Run: `npm --prefix frontend run test -- ChatSceneTab`
Expected: FAIL — Bug A test sees one unhandled rejection; Bug B test sees `body.attachment` undefined.

- [ ] **Step 4: Create `frontend/src/components/ChatSceneTab.tsx`**

Move the shared body in (start from `SceneTab.tsx` — it has the correct error handling and the superset of imports), then apply the divergence table:

- `KIND_CONFIG` with the verbatim labels/testids/empty-states/`thinkingLabel`/`showInsertAtEnd` from table rows 2–5/7. `SessionPicker`, `TranscriptView` `emptyState={<config.EmptyState />}`, root `data-testid={config.rootTestId}`, and the draft-assistant row's `thinkingLabel={config.thinkingLabel}` all read from it. The `InsertAtEndAction` block renders only when `config.showInsertAtEnd`.
- Thread `kind` into `useChatsQuery(chapterId, { kind })`, `useRenameChatMutation(chapterId, kind)`, `useRemoveChatMutation(chapterId, kind)`, and both `createChat.mutateAsync({ chapterId, kind })` call sites (inline-create in onSend + `onNew`).
- `onSend` (the load-bearing merge — Bug A + Bug B + Design decision 3):

```ts
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
    if (chatId === null) {
      try {
        const created = await createChat.mutateAsync({ chapterId: cId, kind });
        chatId = created.id;
        setActiveChatId(chatId);
      } catch (err) {
        // Create failures don't reach sendChatMessage.error, so no banner would
        // show — surface through the error store instead. Never propagate:
        // ChatComposer calls onSend via `void onSend(args)`.
        useErrorStore.getState().push({
          severity: 'error',
          source: 'chat.send',
          code: 'create_failed',
          message: err instanceof Error ? err.message : 'Could not create the session.',
        });
        return;
      }
    }
    // Evaluate isFirstTurn AFTER chatId is resolved so explicit-create-then-send
    // is also caught. `undefined` covers the inline-create case where the local
    // sessions snapshot hasn't yet seen the optimistic prepend.
    const currentSession = sessions.find((s) => s.id === chatId);
    const isFirstTurn = currentSession === undefined || currentSession.messageCount === 0;

    lastSendArgsRef.current = args;
    const sendArgs: Parameters<typeof sendChatMessage.mutateAsync>[0] = {
      chatId,
      chapterId: cId, // story-editor-loj: needed so onSuccess can invalidate the chats list
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
    try {
      await sendChatMessage.mutateAsync(sendArgs);
    } catch {
      // Error is already reflected in sendChatMessage.error and the draft store.
      // Don't propagate — ChatComposer calls onSend via `void onSend(args)`.
      return;
    }

    if (isFirstTurn) {
      const title = truncateAtWordBoundary(args.content, TITLE_MAX_CHARS);
      try {
        await renameChat.mutateAsync({ id: chatId, title });
      } catch {
        // non-fatal — session remains usable without a title
      }
    }
  },
  [chapterId, selectedModelId, activeChatId, sessions, createChat, renameChat, sendChatMessage, kind],
);
```

Note the deliberate absence of ChatTab's post-success `useAttachedSelectionStore.getState().clear()` (table row 10). Everything else (default-select effect, soft-delete, onDelete/onRename/onNew, `useBannerRetry`, `onCopy`, `onInsert`, the render-prop body, UndoToast, ResendConfirmDialog, composer) moves verbatim.

- [ ] **Step 5: Reduce `ChatTab.tsx` and `SceneTab.tsx` to wrappers**

```tsx
// frontend/src/components/ChatTab.tsx — entire file
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { JSX } from 'react';
import { ChatSceneTab } from '@/components/ChatSceneTab';

export interface ChatTabProps {
  chapterId: string | null;
  editor: TiptapEditor | null;
}

/** Thin wrapper over the shared [ChatSceneTab] shell — kind='ask'. */
export function ChatTab({ chapterId, editor }: ChatTabProps): JSX.Element {
  return <ChatSceneTab kind="ask" chapterId={chapterId} editor={editor} />;
}
```

`SceneTab.tsx` identically with `kind="scene"` (keep its `[SC17]` doc comment, trimmed to reflect the wrapper role). `EditorPage.tsx:635–637` needs no change.

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npm --prefix frontend run test -- ChatSceneTab`
Expected: PASS (2/2) — no unhandled rejection, attachment forwarded.

- [ ] **Step 7: Run the full regression net**

Run: `npm --prefix frontend run test -- ChatTab SceneTab ChatComposer ChatPanel`
Expected: all PASS with zero modifications to those test files. If any existing assertion fails, fix the shell (a missed divergence), never the test.

- [ ] **Step 8: Typecheck + design-lint**

Run: `npm --prefix frontend run typecheck && node frontend/scripts/lint-design.mjs`
Expected: PASS. All styling in `ChatSceneTab.tsx` is moved verbatim from the originals, so no new token issues should appear.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/ChatSceneTab.tsx frontend/src/components/ChatTab.tsx \
  frontend/src/components/SceneTab.tsx frontend/tests/components/ChatSceneTab.test.tsx
git commit -m "[<bd-id>] chat: extract shared ChatSceneTab shell; fix unhandled send rejection + dropped scene attachment"
```

---

### Task 2: Guard-rejected sends preserve the typed draft (`onSend` acceptance contract)

**Root cause:** `ChatComposer.handleSend` (ChatComposer.tsx:155–168) fires `void onSend(args)` and then unconditionally `setValue('')` + `clearAttachment()` + `setUseWebSearch(false)`. But the shell's pre-send guards (`checkChatSendGuards` — `no_chapter` / `no_model`, `frontend/src/lib/chatSendGuards.ts:13–28`) reject *before* anything consumes the message: `lastSendArgsRef` is set only after the guards (ChatTab was :113, shell mirrors it) and the draft store is seeded only in the mutation's `onMutate`. Result: no chapter open or no model picked → the user's typed prose and attached selection are destroyed with only a warn toast to show for it.

**Fix:** `onSend` may return/resolve `false` to signal "not consumed" (Design decision 4). The composer clears optimistically exactly as today (so accepted sends keep their current instant-clear feel) and restores the draft when the result is explicitly `false`. The shell returns `false` from the guard branch and the create-failure branch; `true` otherwise (including send failures — banner retry owns that content). `useBannerRetry`'s `onSend` option type stays satisfied (`Promise<boolean>` is assignable where `Promise<void>` is expected under TS's async-return special case); if `tsc` disagrees on the installed version, widen `UseBannerRetryOptions.onSend` (`frontend/src/hooks/useBannerRetry.ts:14`) to `(args: ChatSendArgs) => Promise<unknown>` — its call site only awaits it.

**Files:**
- Modify: `frontend/src/components/ChatComposer.tsx` (`onSend` prop type + restore-on-`false` in `handleSend`)
- Modify: `frontend/src/components/ChatSceneTab.tsx` (guard + create-failure branches return `false`; success/send-failure return `true`; declared return type `Promise<boolean>`)
- Modify (only if typecheck requires): `frontend/src/hooks/useBannerRetry.ts` (widen `onSend` option type)
- Test: `frontend/tests/components/ChatComposer.test.tsx` (extend), `frontend/tests/components/ChatSceneTab.test.tsx` (extend)

**Interfaces:**
- Produces: `ChatComposerProps.onSend: (args: SendArgs) => void | boolean | Promise<void | boolean>` — `false` ⇒ composer restores `args.content` (only if the textarea is still empty, so newly typed text is never clobbered) and re-attaches `args.attachment` (only if the store's attachment is still `null`). Any other result ⇒ current behavior, unchanged.
- Consumes: `useAttachedSelectionStore.setAttachedSelection` (`frontend/src/store/attachedSelection.ts:16`).

- [ ] **Step 1: Write the failing composer tests**

Extend `frontend/tests/components/ChatComposer.test.tsx` (reuse its existing render helpers/store setup):

```tsx
it('restores the typed text when onSend resolves false (send not accepted)', async () => {
  const onSend = vi.fn().mockResolvedValue(false);
  // render composer, type 'precious draft', click Send
  await waitFor(() => {
    expect(screen.getByLabelText('Message')).toHaveValue('precious draft');
  });
});

it('re-attaches the selection when onSend resolves false', async () => {
  // seed useAttachedSelectionStore with a selection, onSend resolves false, type + Send
  await waitFor(() => {
    expect(useAttachedSelectionStore.getState().attachedSelection).not.toBeNull();
  });
  expect(screen.getByTestId('composer-attachment')).toBeInTheDocument();
});

it('still clears the textarea when onSend resolves true', async () => {
  const onSend = vi.fn().mockResolvedValue(true);
  // type + Send → textarea empty (mirrors the existing "clears textarea after submit" case)
});
```

- [ ] **Step 2: Write the failing integration test in `ChatSceneTab.test.tsx`**

```tsx
it('a guard-rejected send (no model selected) leaves the typed message in the composer', async () => {
  // client with chat.model: null (see ChatTab.test.tsx "Resend with no model selected" for the shape);
  // fetch mock: existing chat c1 on ch1, messages [].
  // type 'do not lose me', click Send.
  await waitFor(() => {
    expect(useErrorStore.getState().errors.some((e) => e.code === 'no_model')).toBe(true);
  });
  expect(vi.mocked(apiStream).mock.calls.length).toBe(0);
  expect(screen.getByLabelText('Message')).toHaveValue('do not lose me');
});
```

- [ ] **Step 3: Run to verify all four fail**

Run: `npm --prefix frontend run test -- ChatComposer ChatSceneTab`
Expected: the three new composer tests and the integration test FAIL (textarea empty / attachment gone); everything pre-existing still passes.

- [ ] **Step 4: Implement the composer restore**

In `ChatComposer.tsx`, widen the prop type and replace `handleSend`'s tail:

```ts
export interface ChatComposerProps {
  onSend: (args: SendArgs) => void | boolean | Promise<void | boolean>;
  // …rest unchanged
}
```

```ts
function handleSend(): void {
  if (isSendDisabled) return;
  const args: SendArgs = { content: trimmed, attachment, enableWebSearch: useWebSearch };
  // Optimistic clear (unchanged feel for accepted sends)…
  setValue('');
  clearAttachment();
  // [F50] Per-turn semantics: reset the toggle so the next message
  // does not inadvertently re-trigger web search.
  setUseWebSearch(false);
  // …then restore the draft iff the send was explicitly not consumed
  // (pre-send guard). Failed sends resolve true — their content lives on
  // in the draft row + banner retry, so restoring would duplicate it.
  void Promise.resolve(onSend(args)).then(
    (accepted) => {
      if (accepted !== false) return;
      setValue((cur) => (cur.length === 0 ? args.content : cur));
      if (args.attachment !== null && useAttachedSelectionStore.getState().attachedSelection === null) {
        useAttachedSelectionStore.getState().setAttachedSelection(args.attachment);
      }
    },
    () => {
      // onSend rejections are handled upstream (banner/error store) — never
      // let the composer re-introduce an unhandled rejection.
    },
  );
}
```

- [ ] **Step 5: Return the acceptance flag from the shell**

In `ChatSceneTab.tsx`, change `onSend` to `Promise<boolean>`: `return false;` in the guard branch and the create-failure catch; `return true;` after the send try/catch (both the caught-error early-return and the happy path — the message was consumed either way). `useBannerRetry` continues to receive this `onSend` unchanged; apply the type-widening fallback from the task header only if typecheck fails.

- [ ] **Step 6: Run tests + typecheck + design-lint**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test -- ChatSceneTab ChatTab SceneTab ChatComposer ChatPanel && node frontend/scripts/lint-design.mjs`
Expected: all PASS — including every pre-existing composer test (a `vi.fn()` onSend resolves `undefined`, which is not `false`, so clear-on-send behavior is untouched).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ChatComposer.tsx frontend/src/components/ChatSceneTab.tsx \
  frontend/tests/components/ChatComposer.test.tsx frontend/tests/components/ChatSceneTab.test.tsx
# plus frontend/src/hooks/useBannerRetry.ts if the type-widening fallback was needed
git commit -m "[<bd-id>] chat: guard-rejected sends keep the typed draft (onSend acceptance contract)"
```

---

## Self-Review notes

- **Spec coverage:** duplication → Task 1 (one shell, two ~10-line wrappers, net ≈ −550 lines); Bug A → Task 1 Step 1/4 (unified try/catch, plus the latent create-await variant both tabs shared); Bug B → Task 1 Step 2/4 per Design decision 1 (forward — backend verified at `chat.routes.ts` ~243/369/431 and `prompt.service.ts` ~230–241); papercut → Task 2 (kept because it lands almost entirely in two files the plan already touches). Covered.
- **Decisions recorded:** all five in "Design decisions" — attachment forwarding (with backend evidence), shell shape (kind-config, wrappers kept, no new story), error unification (incl. create-failure → error store), the `false`-means-not-consumed contract (send failures deliberately resolve `true`), and tab-switch state loss explicitly OUT of scope (follow-up bd issue to be filed at close).
- **Regression net honored:** `ChatTab.test.tsx`, `ChatTab.copy.test.tsx`, `SceneTab.test.tsx`, `ChatComposer.test.tsx`, `ChatPanel.test.tsx` all pass unmodified in both tasks; existing testids (`chat-tab`/`scene-tab`/`chat-empty`/`scene-empty`) and Storybook stories survive via the wrappers.
- **Type consistency:** `SendArgs` (`ChatComposer.tsx:32–42`) is unchanged; the attachment mapping matches `SendChatMessageArgs.attachment` (`useChat.ts:168`) exactly; `onSend`'s widened type is backward compatible with every existing `vi.fn()` mock; `Promise<boolean>` vs `useBannerRetry`'s `Promise<void>` has a stated fallback if the compiler objects.
- **Intentional behavior deltas, called out so reviewers don't trip:** (1) ChatTab's redundant post-success `attachedSelection.clear()` is dropped (divergence row 10 — composer clears at send time; the old line could wrongly wipe a selection attached mid-stream); (2) scene sends now transmit attachments (that's Bug B's fix); (3) a failed inline-create now pushes a visible `chat.send`/`create_failed` error instead of rejecting silently. Everything else is verbatim relocation.
- **Line anchors are as of 2026-07-02** (ChatTab.tsx 327 lines / SceneTab.tsx 365 lines / ChatComposer.tsx 286 lines) — re-verify before editing if the files have drifted.
- **Open item for implementer:** the Bug A test's unhandled-rejection capture uses `process.on('unhandledRejection')`; vitest may also report the dangling rejection in the RED run — that noise is expected and disappears once the shell lands.
