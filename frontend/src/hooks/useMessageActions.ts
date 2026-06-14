import { useCallback, useState } from 'react';
import type { Message } from 'story-editor-shared';
import { useEditMessageMutation, type useSendChatMessageMutation } from '@/hooks/useChat';
import { checkChatSendGuards } from '@/lib/chatSendGuards';
import { useErrorStore } from '@/store/errors';

export interface UseMessageActionsOptions {
  chatId: string | null;
  chapterId: string | null;
  modelId: string | null;
  /** Persisted messages in createdAt-asc order (same ordering the backend deletes from). */
  messages: Message[];
  sendMutation: ReturnType<typeof useSendChatMessageMutation>;
}

export interface ResendConfirmState {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface UseMessageActionsResult {
  editingMessageId: string | null;
  beginEdit: (id: string) => void;
  cancelEdit: () => void;
  confirmEdit: (id: string, content: string) => void;
  resendFromUser: (userId: string) => void;
  regenerateFromAssistant: (assistantId: string) => void;
  hasPrecedingUser: (assistantId: string) => boolean;
  confirmState: ResendConfirmState | null;
  actionsDisabled: boolean;
}

export function useMessageActions({
  chatId,
  chapterId,
  modelId,
  messages,
  sendMutation,
}: UseMessageActionsOptions): UseMessageActionsResult {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ResendConfirmState | null>(null);
  const editMutation = useEditMessageMutation();

  const actionsDisabled = sendMutation.isPending;

  const beginEdit = useCallback((id: string) => setEditingMessageId(id), []);
  const cancelEdit = useCallback(() => setEditingMessageId(null), []);

  const confirmEdit = useCallback(
    (id: string, content: string) => {
      if (chatId === null || chapterId === null) return;
      setEditingMessageId(null);
      void editMutation.mutateAsync({ chatId, chapterId, messageId: id, content });
    },
    [chatId, chapterId, editMutation],
  );

  // Fire a replay from the given USER-message anchor id.
  const fireReplay = useCallback(
    (anchorId: string) => {
      if (chatId === null) return;
      const guard = checkChatSendGuards({ activeChapterId: chapterId, selectedModelId: modelId });
      if (guard) {
        useErrorStore.getState().push(guard);
        return;
      }
      // chapterId and modelId are non-null after the guard passes
      void sendMutation.mutateAsync({
        chatId,
        chapterId: chapterId as string,
        modelId: modelId as string,
        fromMessageId: anchorId,
      });
    },
    [chatId, chapterId, modelId, sendMutation],
  );

  // count = messages strictly after the anchor (what deleteAllAfter removes).
  const replayWithGuard = useCallback(
    (anchorId: string) => {
      const idx = messages.findIndex((m) => m.id === anchorId);
      if (idx < 0) return;
      const count = messages.length - idx - 1;
      if (count > 1) {
        setConfirmState({
          count,
          onConfirm: () => {
            setConfirmState(null);
            fireReplay(anchorId);
          },
          onCancel: () => setConfirmState(null),
        });
      } else {
        fireReplay(anchorId);
      }
    },
    [messages, fireReplay],
  );

  const resendFromUser = useCallback(
    (userId: string) => replayWithGuard(userId),
    [replayWithGuard],
  );

  // Walk back from the assistant message to its preceding user message.
  const precedingUserId = useCallback(
    (assistantId: string): string | null => {
      const idx = messages.findIndex((m) => m.id === assistantId);
      if (idx < 0) return null;
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === 'user') return messages[i].id;
      }
      return null;
    },
    [messages],
  );

  const regenerateFromAssistant = useCallback(
    (assistantId: string) => {
      const anchor = precedingUserId(assistantId);
      if (anchor === null) return; // defensive — button is disabled in this case
      replayWithGuard(anchor);
    },
    [precedingUserId, replayWithGuard],
  );

  const hasPrecedingUser = useCallback(
    (assistantId: string) => precedingUserId(assistantId) !== null,
    [precedingUserId],
  );

  return {
    editingMessageId,
    beginEdit,
    cancelEdit,
    confirmEdit,
    resendFromUser,
    regenerateFromAssistant,
    hasPrecedingUser,
    confirmState,
    actionsDisabled,
  };
}
