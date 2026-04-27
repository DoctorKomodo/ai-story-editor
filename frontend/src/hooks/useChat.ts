import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, apiStream } from '@/lib/api';
import { parseAiSseStream } from '@/lib/sse';

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
 * [F55] POST a chat message and consume the SSE assistant reply, then
 * invalidate the messages query so the UI refetches both rows. Streaming
 * tokens-into-cache is deferred — the simpler refetch path keeps the wiring
 * obvious and lets the existing GET path drive the final render.
 */
export function useSendChatMessageMutation(): UseMutationResult<void, Error, SendChatMessageArgs> {
  const qc = useQueryClient();
  return useMutation<void, Error, SendChatMessageArgs>({
    mutationFn: async ({ chatId, content, modelId, attachment, enableWebSearch }) => {
      const body: Record<string, unknown> = { content, modelId };
      if (attachment) body.attachment = attachment;
      if (enableWebSearch === true) body.enableWebSearch = true;
      const res = await apiStream(`/chats/${encodeURIComponent(chatId)}/messages`, {
        method: 'POST',
        body,
      });
      if (!res.body) return;
      // Drain the SSE stream so the backend completes its writes before we
      // refetch. We don't surface the live tokens — the GET refetch is the
      // source of truth for the final message rows.
      for await (const event of parseAiSseStream(res.body)) {
        if (event.type === 'error') {
          throw new Error(event.error.error || 'Chat send failed');
        }
        if (event.type === 'done') break;
      }
    },
    onSuccess: (_void, vars) => {
      void qc.invalidateQueries({ queryKey: chatMessagesQueryKey(vars.chatId) });
    },
  });
}
