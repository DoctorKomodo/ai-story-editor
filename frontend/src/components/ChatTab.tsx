import type { Editor as TiptapEditor } from '@tiptap/core';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from 'story-editor-shared';
import { ChatComposer, type SendArgs as ChatSendArgs } from '@/components/ChatComposer';
import { ChatEmptyState } from '@/components/ChatEmptyState';
import { AssistantMessageRow } from '@/components/messageRow/AssistantMessageRow';
import { CopyAction, MessageActions, RegenerateAction } from '@/components/messageRow/primitives';
import { ResendConfirmDialog } from '@/components/messageRow/ResendConfirmDialog';
import { TranscriptView } from '@/components/messageRow/TranscriptView';
import { UserMessageRow } from '@/components/messageRow/UserMessageRow';
import { SessionPicker, type SessionPickerLabels } from '@/components/SessionPicker';
import { useBannerRetry } from '@/hooks/useBannerRetry';
import {
  useChatMessagesQuery,
  useChatsQuery,
  useCreateChatMutation,
  useRemoveChatMutation,
  useRenameChatMutation,
  useSendChatMessageMutation,
} from '@/hooks/useChat';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useMessageActions } from '@/hooks/useMessageActions';
import { useSoftDelete } from '@/hooks/useSoftDelete';
import { useUserSettings } from '@/hooks/useUserSettings';
import { checkChatSendGuards } from '@/lib/chatSendGuards';
import { truncateAtWordBoundary } from '@/lib/strings';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useErrorStore } from '@/store/errors';
import { UndoToast } from './UndoToast';

export interface ChatTabProps {
  chapterId: string | null;
  editor: TiptapEditor | null;
}

const TITLE_MAX_CHARS = 50;

const CHAT_LABELS: SessionPickerLabels = {
  kindLabel: 'CHAT',
  ariaPrefix: 'Chat: ',
  dropdownHeader: 'Chats in this chapter',
  newButtonLabel: 'New chat',
};

export function ChatTab({ chapterId, editor }: ChatTabProps): JSX.Element {
  // `editor` is accepted for symmetry with SceneTab — Task 5 wires it through
  // from EditorPage's slot. ChatTab itself doesn't insert into the editor today.
  void editor;

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const chatsQuery = useChatsQuery(chapterId, { kind: 'ask' });
  const sessions = chatsQuery.data ?? [];

  const createChat = useCreateChatMutation();
  const renameChat = useRenameChatMutation(chapterId, 'ask');
  const removeChat = useRemoveChatMutation(chapterId, 'ask');
  const sendChatMessage = useSendChatMessageMutation();

  const settings = useUserSettings();
  const selectedModelId = settings.chat.model;

  const messagesQuery = useChatMessagesQuery(activeChatId);
  const actions = useMessageActions({
    chatId: activeChatId,
    chapterId,
    modelId: selectedModelId,
    messages: messagesQuery.data ?? [],
    sendMutation: sendChatMessage,
  });

  const lastChatSendArgsRef = useRef<ChatSendArgs | null>(null);

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
        const created = await createChat.mutateAsync({ chapterId: cId, kind: 'ask' });
        chatId = created.id;
        setActiveChatId(chatId);
      }
      // Evaluate isFirstTurn AFTER chatId is resolved so explicit-create-then-send
      // is also caught. `undefined` covers the inline-create case where the local
      // sessions snapshot hasn't yet seen the optimistic prepend.
      const currentSession = sessions.find((s) => s.id === chatId);
      const isFirstTurn = currentSession === undefined || currentSession.messageCount === 0;

      lastChatSendArgsRef.current = args;
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
      await sendChatMessage.mutateAsync(sendArgs);

      if (isFirstTurn) {
        const title = truncateAtWordBoundary(args.content, TITLE_MAX_CHARS);
        try {
          await renameChat.mutateAsync({ id: chatId, title });
        } catch {
          // non-fatal — chat remains usable without a title
        }
      }
      // Composer keeps its own state; clear the attached selection chip after success.
      useAttachedSelectionStore.getState().clear();
    },
    [chapterId, selectedModelId, activeChatId, sessions, createChat, renameChat, sendChatMessage],
  );

  const { onRetry, isDispatching } = useBannerRetry({
    chatId: activeChatId,
    chapterId,
    selectedModelId,
    mutation: sendChatMessage,
    lastSendArgsRef: lastChatSendArgsRef,
    onSend,
  });

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
    void createChat.mutateAsync({ chapterId, kind: 'ask' }).then((c) => {
      setActiveChatId(c.id);
    });
  }, [chapterId, createChat]);

  const { copy: copyToClipboard, status: copyStatus } = useCopyToClipboard();

  const onCopy = useCallback(
    (message: Message) => {
      void copyToClipboard(message.content);
    },
    [copyToClipboard],
  );

  const visibleSessions = sessions.filter((s) => !isDeletePending(s.id));

  const pendingEntries = Array.from(pendingDeletes.entries());
  const lastPending = pendingEntries.length > 0 ? pendingEntries[pendingEntries.length - 1] : null;

  return (
    <div className="flex flex-col h-full" data-testid="chat-tab">
      <SessionPicker
        labels={CHAT_LABELS}
        sessions={visibleSessions.map((c) => ({
          id: c.id,
          title: c.title ?? 'Untitled',
          lastActivityAt: c.lastActivityAt,
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
        onRetrySend={() => {
          void onRetry();
        }}
        disableRetrySend={sendChatMessage.isPending || isDispatching}
      >
        {(rows) =>
          rows.map((r) => {
            if (r.kind === 'persisted' && r.message.role === 'user') {
              return (
                <UserMessageRow
                  key={r.message.id}
                  message={r.message}
                  isEditing={actions.editingMessageId === r.message.id}
                  onBeginEdit={actions.beginEdit}
                  onCancelEdit={actions.cancelEdit}
                  onConfirmEdit={actions.confirmEdit}
                  onResend={actions.resendFromUser}
                  actionsDisabled={actions.actionsDisabled}
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
                      <CopyAction onClick={() => onCopy(r.message)} status={copyStatus} />
                      <RegenerateAction
                        onClick={() => actions.regenerateFromAssistant(r.message.id)}
                        disabled={
                          actions.actionsDisabled || !actions.hasPrecedingUser(r.message.id)
                        }
                      />
                    </MessageActions>
                  }
                />
              );
            }
            if (r.kind === 'draft-user') {
              return (
                <UserMessageRow
                  key="draft-user"
                  message={{
                    id: 'draft-user',
                    role: 'user',
                    content: r.userContent,
                    attachmentJson: r.attachment,
                    citationsJson: null,
                    model: null,
                    tokens: null,
                    latencyMs: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: null,
                  }}
                />
              );
            }
            if (r.kind === 'draft-assistant') {
              return (
                <AssistantMessageRow
                  key="draft-assistant"
                  message={{
                    id: 'draft-assistant',
                    role: 'assistant',
                    content: r.assistantText,
                    attachmentJson: null,
                    citationsJson: null,
                    model: null,
                    tokens: null,
                    latencyMs: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: null,
                  }}
                  actions={null}
                  isStreaming
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
      {actions.confirmState ? (
        <ResendConfirmDialog
          count={actions.confirmState.count}
          verb={actions.confirmState.verb}
          onConfirm={actions.confirmState.onConfirm}
          onCancel={actions.confirmState.onCancel}
        />
      ) : null}
    </div>
  );
}
