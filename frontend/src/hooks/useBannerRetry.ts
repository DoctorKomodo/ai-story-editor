import { useQueryClient } from '@tanstack/react-query';
import type { RefObject } from 'react';
import { useCallback, useState } from 'react';
import type { SendArgs as ChatSendArgs } from '@/components/ChatComposer';
import {
  type ChatMessage,
  chatMessagesQueryKey,
  type useSendChatMessageMutation,
} from '@/hooks/useChat';

export interface UseBannerRetryOptions {
  chatId: string | null;
  chapterId: string | null;
  selectedModelId: string | null;
  mutation: ReturnType<typeof useSendChatMessageMutation>;
  lastSendArgsRef: RefObject<ChatSendArgs | null>;
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
