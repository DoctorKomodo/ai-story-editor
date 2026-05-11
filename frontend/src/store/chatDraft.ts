import { create } from 'zustand';

/**
 * Transient state for in-flight chat turns, keyed by chatId.
 *
 * Holds the user message (so the optimistic bubble appears immediately on
 * Send) and the accumulating assistant text (so we can render the
 * dots → live text progression without waiting for the post-stream refetch).
 *
 * Lifecycle per chatId:
 *   start({ chatId, userContent, attachment })   // status = 'thinking'
 *   appendDelta(chatId, delta)                    // assistantText grows
 *   markStreaming(chatId)                         // first chunk seen
 *   markDone(chatId) | markError(chatId, error)  // terminal
 *   clear(chatId)                                 // mutation onSettled
 *
 * The keyed shape allows concurrent in-flight streams (e.g. Chat and Scene
 * tabs open simultaneously) without one tab's writes clobbering the other.
 *
 * The slice is intentionally not the source of truth for persisted
 * messages — those live in the TanStack Query cache. The mutation
 * invalidates the messages query on success; the refetched list
 * carries the real ids/timestamps/citations.
 */

export type ChatDraftStatus = 'thinking' | 'streaming' | 'done' | 'error';

export interface ChatDraftError {
  code: string | null;
  message: string;
  httpStatus?: number;
}

export interface ChatDraftAttachment {
  selectionText: string;
  chapterId: string;
}

export interface ChatDraft {
  chatId: string;
  userContent: string;
  attachment: ChatDraftAttachment | null;
  assistantText: string;
  status: ChatDraftStatus;
  error: ChatDraftError | null;
}

const initialState: { drafts: Record<string, ChatDraft> } = {
  drafts: {},
};

interface ChatDraftState {
  drafts: Record<string, ChatDraft>;
  start: (args: {
    chatId: string;
    userContent: string;
    attachment: ChatDraftAttachment | null;
  }) => void;
  appendDelta: (chatId: string, delta: string) => void;
  markStreaming: (chatId: string) => void;
  markDone: (chatId: string) => void;
  markError: (chatId: string, error: ChatDraftError) => void;
  clear: (chatId: string) => void;
  reset: () => void;
}

export const useChatDraftStore = create<ChatDraftState>((set) => ({
  ...initialState,

  start: ({ chatId, userContent, attachment }) =>
    set((s) => ({
      drafts: {
        ...s.drafts,
        [chatId]: {
          chatId,
          userContent,
          attachment,
          assistantText: '',
          status: 'thinking',
          error: null,
        },
      },
    })),

  appendDelta: (chatId, delta) =>
    set((s) => {
      const cur = s.drafts[chatId];
      if (!cur) return s;
      return {
        drafts: {
          ...s.drafts,
          [chatId]: { ...cur, assistantText: cur.assistantText + delta },
        },
      };
    }),

  markStreaming: (chatId) =>
    set((s) => {
      const cur = s.drafts[chatId];
      if (!cur) return s;
      return { drafts: { ...s.drafts, [chatId]: { ...cur, status: 'streaming' } } };
    }),

  markDone: (chatId) =>
    set((s) => {
      const cur = s.drafts[chatId];
      if (!cur) return s;
      return { drafts: { ...s.drafts, [chatId]: { ...cur, status: 'done' } } };
    }),

  markError: (chatId, error) =>
    set((s) => {
      const cur = s.drafts[chatId];
      if (!cur) return s;
      return { drafts: { ...s.drafts, [chatId]: { ...cur, status: 'error', error } } };
    }),

  clear: (chatId) =>
    set((s) => {
      if (!(chatId in s.drafts)) return s;
      const { [chatId]: _removed, ...rest } = s.drafts;
      return { drafts: rest };
    }),

  reset: () => set(initialState),
}));
