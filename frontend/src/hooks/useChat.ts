import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Typically a string; may be a JSON-serialisable object. */
  contentJson: unknown;
  attachmentJson: ChatMessageAttachment | null;
  citationsJson: unknown | null;
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
