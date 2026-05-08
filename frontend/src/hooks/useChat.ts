import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ApiError, api, apiStream, type ChatRow } from '@/lib/api';
import { type Citation, isCitationArray } from '@/lib/citations';
import { parseAiSseStream } from '@/lib/sse';
import { useChatDraftStore } from '@/store/chatDraft';

/**
 * [F39] Chat-related query hooks.
 *
 * Backend contract:
 *   GET /api/chats/:chatId/messages
 *     -> { messages: [{ id, role, contentJson, attachmentJson, citationsJson,
 *                       model, tokens, latencyMs, createdAt }] }
 *
 *   GET /api/chapters/:chapterId/chats
 *     -> { chats: [{ id, chapterId, title, createdAt, messageCount }] }
 *
 * `contentJson` / `attachmentJson` / `citationsJson` may be a string or a
 * structured object — the chat repo passes through whatever was stored. The
 * messages route in particular always serialises `contentJson` to a string
 * before responding, but we keep `unknown` here so tests + future shapes
 * survive without a re-type.
 *
 * F39 only consumes `useChatMessagesQuery`; the chat-list query lives here so
 * F38 / F50 follow-ups can pick a chat without a second hook file. Mutations
 * (send-message, regenerate, fork) belong to later tasks and live elsewhere.
 */

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessageAttachment {
  selectionText?: string;
  chapterId?: string;
}

// Re-export so existing callers (`MessageCitations`, tests, etc.) that
// import `Citation` / `isCitationArray` from `@/hooks/useChat` keep working
// without a cascade of import-site changes.
export type { Citation };
export { isCitationArray };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Typically a string; may be a JSON-serialisable object. */
  contentJson: unknown;
  attachmentJson: ChatMessageAttachment | null;
  citationsJson: Citation[] | null;
  model: string | null;
  tokens: number | null;
  latencyMs: number | null;
  createdAt: string;
}

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

interface ChatMessagesResponse {
  messages: ChatMessage[];
}

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

export function useChatMessagesQuery(chatId: string | null): UseQueryResult<ChatMessage[], Error> {
  return useQuery({
    queryKey: chatMessagesQueryKey(chatId ?? ''),
    queryFn: async (): Promise<ChatMessage[]> => {
      const res = await api<ChatMessagesResponse>(
        `/chats/${encodeURIComponent(chatId ?? '')}/messages`,
      );
      return res.messages;
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
      const res = await api<{ chat: ChatSummary }>(
        `/chats/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: { title } },
      );
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
    mutationFn: async (id: string) => {
      await api<void>(`/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
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
  /** Message text. Required unless `retry` is true. */
  content?: string;
  modelId: string;
  /** When true, replays the existing trailing user turn without persisting a new message. */
  retry?: boolean;
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
export function useSendChatMessageMutation(): UseMutationResult<void, Error, SendChatMessageArgs> {
  const qc = useQueryClient();
  return useMutation<void, Error, SendChatMessageArgs>({
    onMutate: ({ chatId, content, attachment }) => {
      useChatDraftStore.getState().start({
        chatId,
        userContent: content ?? '',
        attachment: attachment ?? null,
      });
    },
    mutationFn: async ({ chatId, content, modelId, retry, attachment, enableWebSearch }) => {
      const body: Record<string, unknown> = { modelId };
      if (content !== undefined) body.content = content;
      if (retry === true) body.retry = true;
      if (attachment) body.attachment = attachment;
      if (enableWebSearch === true) body.enableWebSearch = true;

      let res: Response;
      try {
        res = await apiStream(`/chats/${encodeURIComponent(chatId)}/messages`, {
          method: 'POST',
          body,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chat send failed';
        const code = err instanceof ApiError ? (err.code ?? null) : null;
        useChatDraftStore.getState().markError({ code, message });
        throw err;
      }

      if (!res.body) {
        const message = 'Empty response body';
        useChatDraftStore.getState().markError({ code: null, message });
        throw new Error(message);
      }

      let firstChunkSeen = false;
      try {
        for await (const event of parseAiSseStream(res.body)) {
          if (event.type === 'chunk') {
            const delta = event.chunk.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              if (!firstChunkSeen) {
                firstChunkSeen = true;
                useChatDraftStore.getState().markStreaming();
              }
              useChatDraftStore.getState().appendDelta(delta);
            }
          } else if (event.type === 'error') {
            const message = event.error.error || 'Chat send failed';
            useChatDraftStore.getState().markError({
              code: event.error.code ?? null,
              message,
            });
            throw new Error(message);
          } else if (event.type === 'done') {
            useChatDraftStore.getState().markDone();
            break;
          }
          // citations frame: ignored — refetched message carries citationsJson.
        }
      } catch (err) {
        if (useChatDraftStore.getState().draft?.status !== 'error') {
          const message = err instanceof Error ? err.message : 'Chat stream failed';
          const code = err instanceof ApiError ? (err.code ?? null) : null;
          useChatDraftStore.getState().markError({ code, message });
        }
        throw err;
      }
    },
    onSuccess: (_void, vars) => {
      // Clear the draft before invalidating so we never briefly show both
      // the optimistic draft bubble and the persisted assistant message.
      useChatDraftStore.getState().clear();
      void qc.invalidateQueries({ queryKey: chatMessagesQueryKey(vars.chatId) });
    },
    onSettled: () => {
      // Safety net for any path that didn't clear in onSuccess (i.e. failed
      // mutations land here after onError). Preserve error drafts so the
      // error banner stays visible until the next send overwrites them.
      const currentStatus = useChatDraftStore.getState().draft?.status;
      if (currentStatus === 'error') return;
      useChatDraftStore.getState().clear();
    },
  });
}
