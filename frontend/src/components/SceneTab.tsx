/**
 * [SC17] SceneTab — orchestrator for the scene-generation workflow.
 *
 * Wires together:
 *  - SessionPicker (session CRUD + selection)
 *  - useChatsQuery / useCreateChatMutation / useRenameChatMutation / useRemoveChatMutation
 *  - useSendChatMessageMutation (same mutation as ChatTab — shared transport layer)
 *  - TranscriptView (render-prop: merged persisted + draft rows)
 *  - Scene-specific actions: InsertAtEndAction, CopyAction, RegenerateAction
 *  - ChatComposer (textarea + send/stop)
 *  - Auto-title: on the first turn of a new session, derives a title from
 *    the user's direction text via truncateAtWordBoundary.
 *  - Insert-at-end: clicking InsertAtEndAction on an assistant row appends
 *    the candidate text at the document end via the TipTap editor chain.
 *  - Soft-delete with undo: onDelete hides the session immediately and
 *    schedules the real API delete after UNDO_TIMEOUT_MS. onUndo cancels
 *    the timer and restores the session visually.
 *  - useBannerRetry: banner-level retry dispatch (same hook as ChatTab).
 */
import type { Editor as TiptapEditor } from '@tiptap/core';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { ChatComposer, type SendArgs as ChatSendArgs } from '@/components/ChatComposer';
import {
  AssistantMessageRow,
  CopyAction,
  InsertAtEndAction,
  MessageActions,
  RegenerateAction,
  TranscriptView,
  UserMessageRow,
} from '@/components/messageRow';
import { SceneEmptyState } from '@/components/SceneEmptyState';
import { SessionPicker, type SessionPickerLabels } from '@/components/SessionPicker';
import { useBannerRetry } from '@/hooks/useBannerRetry';
import {
  type ChatMessage,
  useChatsQuery,
  useCreateChatMutation,
  useRemoveChatMutation,
  useRenameChatMutation,
  useSendChatMessageMutation,
} from '@/hooks/useChat';
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

  // Default-select first session when no active selection or active is stale.
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
      const guard = checkChatSendGuards({ activeChapterId: chapterId, selectedModelId });
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
      // Evaluate isFirstTurn AFTER chatId is resolved so explicit-create-then-send
      // is also caught. `undefined` covers the inline-create case where the local
      // sessions snapshot hasn't yet seen the optimistic prepend.
      const currentSession = sessions.find((s) => s.id === chatId);
      const isFirstTurn = currentSession === undefined || currentSession.messageCount === 0;

      lastSceneSendArgsRef.current = args;
      let sendSucceeded = false;
      try {
        await sendChatMessage.mutateAsync({
          chatId,
          content: args.content,
          modelId: mId,
          enableWebSearch: args.enableWebSearch,
        });
        sendSucceeded = true;
      } catch {
        // Error is already reflected in sendChatMessage.error and the draft store.
        // Don't propagate — ChatComposer calls onSend via `void onSend(args)`.
        return;
      }

      if (sendSucceeded && isFirstTurn) {
        const title = truncateAtWordBoundary(args.content, TITLE_MAX_CHARS);
        try {
          await renameChat.mutateAsync({ id: chatId, title });
        } catch {
          // non-fatal — session remains usable without a title
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
                      <InsertAtEndAction onClick={() => { onInsert(r.message); }} />
                      <CopyAction onClick={() => { onCopy(r.message); }} />
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
