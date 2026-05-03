import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, apiStream } from '@/lib/api';
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

/**
 * [V26][F50] Web-search citation shape returned by the backend on any
 * assistant message that opted into `enableWebSearch`. `null` means the
 * turn did not request search; an empty array is never stored (treated
 * the same as `null` by `<MessageCitations />`).
 */
export interface Citation {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

/**
 * [V26][F50] Defensive runtime guard for citation arrays. Used by the SSE
 * `event: citations` parser so a malformed frame from the wire (or a
 * future schema drift) cannot crash the renderer — we either accept a
 * well-formed array or treat the frame as missing.
 */
export function isCitationArray(value: unknown): value is Citation[] {
  if (!Array.isArray(value)) return false;
  return value.every((item): item is Citation => {
    if (item === null || typeof item !== 'object') return false;
    const c = item as Record<string, unknown>;
    return (
      typeof c.title === 'string' &&
      typeof c.url === 'string' &&
      typeof c.snippet === 'string' &&
      (c.publishedAt === null || typeof c.publishedAt === 'string')
    );
  });
}

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

export interface ChatSummary {
  id: string;
  chapterId: string;
  title: string | null;
  createdAt: string;
  messageCount: number;
}

interface ChatMessagesResponse {
  messages: ChatMessage[];
}

interface ChatsResponse {
  chats: ChatSummary[];
}

export const chatMessagesQueryKey = (chatId: string): readonly [string, string, string] =>
  ['chat', chatId, 'messages'] as const;

export const chatsQueryKey = (chapterId: string): readonly [string, string, string] =>
  ['chapter', chapterId, 'chats'] as const;

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

export function useChatsQuery(chapterId: string | null): UseQueryResult<ChatSummary[], Error> {
  return useQuery({
    queryKey: chatsQueryKey(chapterId ?? ''),
    queryFn: async (): Promise<ChatSummary[]> => {
      const res = await api<ChatsResponse>(
        `/chapters/${encodeURIComponent(chapterId ?? '')}/chats`,
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
}

export function useCreateChatMutation(): UseMutationResult<ChatSummary, Error, CreateChatArgs> {
  const qc = useQueryClient();
  return useMutation<ChatSummary, Error, CreateChatArgs>({
    mutationFn: async ({ chapterId, title }) => {
      const res = await api<{ chat: ChatSummary }>(
        `/chapters/${encodeURIComponent(chapterId)}/chats`,
        { method: 'POST', body: title !== undefined ? { title } : {} },
      );
      return res.chat;
    },
    onSuccess: (chat) => {
      void qc.invalidateQueries({ queryKey: chatsQueryKey(chat.chapterId) });
    },
  });
}

export interface SendChatMessageArgs {
  chatId: string;
  content: string;
  modelId: string;
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
        userContent: content,
        attachment: attachment ?? null,
      });
    },
    mutationFn: async ({ chatId, content, modelId, attachment, enableWebSearch }) => {
      const body: Record<string, unknown> = { content, modelId };
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
        useChatDraftStore.getState().markError({ code: null, message });
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
          useChatDraftStore.getState().markError({ code: null, message });
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
