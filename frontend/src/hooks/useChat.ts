import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRef } from 'react';
import { type Message, messagesResponseSchema } from 'story-editor-shared';
import { ApiError, api, type ChatRow, deleteChat } from '@/lib/api';
import { runStreamingAI } from '@/lib/streamingAI';
import { useChatDraftStore } from '@/store/chatDraft';

/**
 * Chat-related query hooks.
 *
 * Backend contract:
 *   GET /api/chats/:chatId/messages
 *     -> { messages: [...] }  — validated at runtime against messagesResponseSchema
 *
 *   GET /api/chapters/:chapterId/chats
 *     -> { chats: [{ id, chapterId, title, createdAt, messageCount }] }
 *
 * The chat-list query lives here so chat-picker consumers can share the hook
 * file. Mutations (send-message, regenerate, fork) are in this file too.
 */

/**
 * Chat list item returned by GET /api/chapters/:chapterId/chats.
 *
 * Alias of `ChatRow` from `@/lib/api` with `messageCount` narrowed to
 * `number` (required) — the list endpoint always enriches each row with
 * a message count, whereas single-chat endpoints (PATCH/DELETE) do not.
 * Keeping this as a derived type rather than a parallel interface prevents
 * the two shapes from drifting independently.
 */
export type ChatSummary = Omit<ChatRow, 'messageCount'> & { messageCount: number };

interface ChatsResponse {
  chats: ChatSummary[];
}

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
  kind?: 'ask' | 'scene',
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
  opts?: { kind?: 'ask' | 'scene' },
): UseQueryResult<ChatSummary[], Error> {
  const kind = opts?.kind;
  return useQuery({
    queryKey: chatsQueryKey(chapterId ?? '', kind),
    queryFn: async (): Promise<ChatSummary[]> => {
      const params = kind !== undefined ? `?kind=${encodeURIComponent(kind)}` : '';
      const res = await api<ChatsResponse>(
        `/chapters/${encodeURIComponent(chapterId ?? '')}/chats${params}`,
      );
      return res.chats;
    },
    enabled: chapterId !== null,
  });
}

// ---- chat mutations (F55) ----

export interface CreateChatArgs {
  chapterId: string;
  title?: string;
  kind?: 'ask' | 'scene';
}

export function useCreateChatMutation(): UseMutationResult<ChatSummary, Error, CreateChatArgs> {
  const qc = useQueryClient();
  return useMutation<ChatSummary, Error, CreateChatArgs>({
    mutationFn: async ({ chapterId, title, kind }) => {
      const body: Record<string, unknown> = {};
      if (title !== undefined) body.title = title;
      if (kind !== undefined) body.kind = kind;
      const res = await api<{ chat: ChatSummary }>(
        `/chapters/${encodeURIComponent(chapterId)}/chats`,
        { method: 'POST', body },
      );
      return res.chat;
    },
    onSuccess: (chat, vars) => {
      const key = chatsQueryKey(chat.chapterId, vars.kind);
      qc.setQueryData<ChatSummary[]>(key, (prev) => [chat, ...(prev ?? [])]);
      // Invalidate by the 3-element prefix so ALL kind variants
      // (ask, scene, undefined) are swept — not just the undefined slot.
      void qc.invalidateQueries({ queryKey: chatsBaseQueryKey(chat.chapterId) });
    },
  });
}

export function useRenameChatMutation(
  chapterId: string | null,
  kind: 'ask' | 'scene' = 'ask',
): UseMutationResult<ChatSummary, Error, { id: string; title: string }> {
  const qc = useQueryClient();
  return useMutation<ChatSummary, Error, { id: string; title: string }>({
    mutationFn: async ({ id, title }) => {
      const res = await api<{ chat: ChatSummary }>(`/chats/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { title },
      });
      return res.chat;
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
  kind: 'ask' | 'scene' = 'ask',
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
  Error,
  SendChatMessageArgs
> & {
  stop: () => void;
} {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  const mutation = useMutation<void, Error, SendChatMessageArgs>({
    onMutate: ({ chatId, content, attachment }) => {
      useChatDraftStore.getState().start({
        chatId,
        userContent: content ?? '',
        attachment: attachment ?? null,
      });
    },
    mutationFn: async ({ chatId, content, modelId, retry, attachment, enableWebSearch }) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const body: Record<string, unknown> = { modelId };
      if (content !== undefined) body.content = content;
      if (retry === true) body.retry = true;
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
        if (abortRef.current === controller) abortRef.current = null;
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
