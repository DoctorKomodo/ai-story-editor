import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRef } from 'react';
import {
  type Chat,
  type ChatKind,
  type ChatSummary,
  chatResponseSchema,
  chatsResponseSchema,
  type Message,
  messageResponseSchema,
  messagesResponseSchema,
} from 'story-editor-shared';
import { ApiError, api, deleteChat } from '@/lib/api';
import { runStreamingAI } from '@/lib/streamingAI';
import { registerStream } from '@/lib/streamRegistry';
import { useChatDraftStore } from '@/store/chatDraft';

/**
 * Chat-related query hooks.
 *
 * Wire shapes are validated at runtime against `messagesResponseSchema` and
 * `chatsResponseSchema` (story-editor-shared) — those are the authoritative
 * field lists.
 *
 * The chat-list query lives here so chat-picker consumers can share the hook
 * file. Mutations (send-message, regenerate, fork) are in this file too.
 */

export const chatMessagesQueryKey = (chatId: string): readonly [string, string, string] =>
  ['chat', chatId, 'messages'] as const;

/**
 * 3-element prefix key covering all kind variants for a given chapter.
 * Use this (not `chatsQueryKey`) when invalidating after mutations so that
 * TanStack Query's prefix-match logic sweeps both `kind='ask'` and
 * `kind='scene'` cached queries.  `chatsQueryKey` (below) appends the kind
 * as a 4th slot and is only appropriate for registering individual queries.
 */
export const chatsBaseQueryKey = (chapterId: string): readonly [string, string, string] =>
  ['chapter', chapterId, 'chats'] as const;

export const chatsQueryKey = (
  chapterId: string,
  kind?: ChatKind,
): readonly [string, string, string, string | undefined] =>
  ['chapter', chapterId, 'chats', kind] as const;

export function useChatMessagesQuery(chatId: string | null): UseQueryResult<Message[], Error> {
  return useQuery({
    queryKey: chatMessagesQueryKey(chatId ?? ''),
    queryFn: async (): Promise<Message[]> => {
      const res = await api<unknown>(`/chats/${encodeURIComponent(chatId ?? '')}/messages`);
      return messagesResponseSchema.parse(res).messages;
    },
    enabled: chatId !== null,
  });
}

export function useChatsQuery(
  chapterId: string | null,
  opts?: { kind?: ChatKind },
): UseQueryResult<ChatSummary[], Error> {
  const kind = opts?.kind;
  return useQuery({
    queryKey: chatsQueryKey(chapterId ?? '', kind),
    queryFn: async (): Promise<ChatSummary[]> => {
      const params = kind !== undefined ? `?kind=${encodeURIComponent(kind)}` : '';
      const res = await api<unknown>(
        `/chapters/${encodeURIComponent(chapterId ?? '')}/chats${params}`,
      );
      return chatsResponseSchema.parse(res).chats;
    },
    enabled: chapterId !== null,
  });
}

// ---- chat mutations (F55) ----

export interface CreateChatArgs {
  chapterId: string;
  title?: string;
  kind?: ChatKind;
}

export function useCreateChatMutation(): UseMutationResult<Chat, Error, CreateChatArgs> {
  const qc = useQueryClient();
  return useMutation<Chat, Error, CreateChatArgs>({
    mutationFn: async ({ chapterId, title, kind }) => {
      const body: Record<string, unknown> = {};
      if (title !== undefined) body.title = title;
      if (kind !== undefined) body.kind = kind;
      const res = await api<unknown>(`/chapters/${encodeURIComponent(chapterId)}/chats`, {
        method: 'POST',
        body,
      });
      return chatResponseSchema.parse(res).chat;
    },
    onSuccess: (chat, vars) => {
      const summary: ChatSummary = { ...chat, messageCount: 0 };
      const key = chatsQueryKey(vars.chapterId, vars.kind);
      qc.setQueryData<ChatSummary[]>(key, (prev) => [summary, ...(prev ?? [])]);
      // Invalidate by the 3-element prefix so ALL kind variants
      // (ask, scene, undefined) are swept — not just the undefined slot.
      void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(vars.chapterId) });
    },
  });
}

export function useRenameChatMutation(
  chapterId: string | null,
  kind: ChatKind = 'ask',
): UseMutationResult<Chat, Error, { id: string; title: string }> {
  const qc = useQueryClient();
  return useMutation<Chat, Error, { id: string; title: string }>({
    mutationFn: async ({ id, title }) => {
      const res = await api<unknown>(`/chats/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { title },
      });
      return chatResponseSchema.parse(res).chat;
    },
    onSuccess: (updated, vars) => {
      if (chapterId === null) return;
      const key = chatsQueryKey(chapterId, kind);
      qc.setQueryData<ChatSummary[]>(key, (prev) =>
        (prev ?? []).map((c) => (c.id === vars.id ? { ...c, title: updated.title } : c)),
      );
      void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(chapterId) });
    },
  });
}

export function useRemoveChatMutation(
  chapterId: string | null,
  kind: ChatKind = 'ask',
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id: string) => deleteChat(id),
    onSuccess: (_void, id) => {
      if (chapterId === null) return;
      const key = chatsQueryKey(chapterId, kind);
      qc.setQueryData<ChatSummary[]>(key, (prev) => (prev ?? []).filter((c) => c.id !== id));
      void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(chapterId) });
    },
  });
}

export interface SendChatMessageArgs {
  chatId: string;
  /** The chapter this chat belongs to. Used by onSuccess to invalidate the chats list. */
  chapterId: string;
  modelId: string;
  /** Message text. Required unless `retry` is true. */
  content?: string;
  /** When true, replays the existing trailing user turn without persisting a new message. */
  retry?: boolean;
  /** Replay from this specific user message (resend/regenerate). Drops everything after it. */
  fromMessageId?: string;
  /** The selection attached to this message. `attachment.chapterId` is the selection's source
   *  chapter — in practice the same as the top-level `chapterId` but semantically distinct. */
  attachment?: { selectionText: string; chapterId: string };
  enableWebSearch?: boolean;
}

/**
 * [F55] POST a chat message, seed the draft store immediately so the
 * optimistic bubble and live-streaming text appear without waiting for the
 * post-stream refetch, then invalidate the messages query on success so the
 * persisted rows take over.
 *
 * `start()` runs in `onMutate` (before `mutationFn`), driven by React Query's
 * standard optimistic-update hook. This fires for both `mutate()` and
 * `mutateAsync()` callers without any manual wrapping.
 */
export function useSendChatMessageMutation(): UseMutationResult<
  void,
  ApiError,
  SendChatMessageArgs
> & {
  stop: () => void;
} {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  const mutation = useMutation<void, ApiError, SendChatMessageArgs>({
    onMutate: ({ chatId, content, attachment, fromMessageId }) => {
      useChatDraftStore.getState().start({
        chatId,
        userContent: content ?? '',
        attachment: attachment ?? null,
      });
      // Resend/regenerate: the backend drops everything after the anchor before
      // streaming, so trim the cache now — the streaming reply then renders in
      // the right place with no post-success snap. Scoped to fromMessageId so
      // retry/normal sends are unaffected.
      if (fromMessageId !== undefined) {
        qc.setQueryData<Message[]>(chatMessagesQueryKey(chatId), (prev) => {
          if (!prev) return prev;
          const idx = prev.findIndex((m) => m.id === fromMessageId);
          return idx < 0 ? prev : prev.slice(0, idx + 1);
        });
      }
    },
    mutationFn: async ({
      chatId,
      content,
      modelId,
      retry,
      fromMessageId,
      attachment,
      enableWebSearch,
    }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const deregister = registerStream(controller);

      const body: Record<string, unknown> = { modelId };
      if (content !== undefined) body.content = content;
      if (retry === true) body.retry = true;
      if (fromMessageId !== undefined) body.fromMessageId = fromMessageId;
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
              useChatDraftStore.getState().markStreaming(chatId);
            }
            useChatDraftStore.getState().appendDelta(chatId, delta);
          },
          // citations forwarded but ignored — refetched message carries citationsJson.
        });
        useChatDraftStore.getState().markDone(chatId);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          useChatDraftStore.getState().clear(chatId);
          return;
        }
        const message = err instanceof Error ? err.message : 'Chat send failed';
        const code = err instanceof ApiError ? (err.code ?? null) : null;
        useChatDraftStore.getState().markError(chatId, { code, message });
        throw err;
      } finally {
        deregister();
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    onError: (_err, vars) => {
      // The server deletes below-anchor rows before streaming, so the optimistic
      // trim must NOT be rolled back. Refetch server truth instead: honest whether
      // the delete happened (stream error) or not (pre-handler error).
      if (vars.fromMessageId !== undefined) {
        void qc.invalidateQueries({ queryKey: chatMessagesQueryKey(vars.chatId) });
      }
    },
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
    onSettled: (_void, _err, vars) => {
      // Safety net for any path that didn't clear in onSuccess (i.e. failed
      // mutations land here after onError). Preserve error drafts so the
      // error banner stays visible until the next send overwrites them.
      const currentStatus = useChatDraftStore.getState().drafts[vars.chatId]?.status;
      if (currentStatus === 'error') return;
      useChatDraftStore.getState().clear(vars.chatId);
    },
  });

  return {
    ...mutation,
    stop: () => {
      abortRef.current?.abort();
    },
  };
}

export interface EditMessageArgs {
  chatId: string;
  /** Needed so onSuccess can invalidate the chats list (edit bumps lastActivityAt). */
  chapterId: string;
  messageId: string;
  content: string;
}

export function useEditMessageMutation(): UseMutationResult<Message, Error, EditMessageArgs> {
  const qc = useQueryClient();
  return useMutation<Message, Error, EditMessageArgs>({
    mutationFn: async ({ chatId, messageId, content }) => {
      const res = await api<unknown>(
        `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'PATCH', body: { content } },
      );
      return messageResponseSchema.parse(res).message;
    },
    onSuccess: (_message, { chatId, chapterId }) => {
      void qc.invalidateQueries({ queryKey: chatMessagesQueryKey(chatId) });
      // Edit bumps Chat.lastActivityAt — re-sort the session list, same as send.
      void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(chapterId) });
    },
  });
}
