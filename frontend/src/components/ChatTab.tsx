import type { Editor as TiptapEditor } from '@tiptap/core';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { ChatComposer, type SendArgs as ChatSendArgs } from '@/components/ChatComposer';
import { ChatMessages } from '@/components/ChatMessages';
import { SessionPicker, type SessionPickerLabels } from '@/components/SessionPicker';
import {
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

  const onRetry = useCallback((): void => {
    const last = lastChatSendArgsRef.current;
    if (last === null) return;
    void onSend(last);
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
          updatedAt: c.updatedAt,
        }))}
        activeSessionId={activeChatId}
        onSelect={setActiveChatId}
        onRename={onRename}
        onDelete={onDelete}
        onNew={onNew}
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <ChatMessages
          chatId={activeChatId}
          sendError={sendChatMessage.error}
          onRetrySend={onRetry}
        />
      </div>

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
