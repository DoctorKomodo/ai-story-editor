import { create } from 'zustand';

/**
 * Transient state for the in-flight chat turn. Holds the user message
 * (so the optimistic bubble appears immediately on Send) and the
 * accumulating assistant text (so we can render the dots → live text
 * progression without waiting for the post-stream refetch).
 *
 * Lifecycle:
 *   start({chatId, userContent, attachment})     // status = 'thinking'
 *   appendDelta(delta)                            // assistantText grows
 *   markStreaming()                               // first chunk seen
 *   markDone() | markError(error)                 // terminal
 *   clear()                                       // mutation onSettled
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

interface ChatDraftState {
  draft: ChatDraft | null;
  start: (args: {
    chatId: string;
    userContent: string;
    attachment: ChatDraftAttachment | null;
  }) => void;
  appendDelta: (delta: string) => void;
  markStreaming: () => void;
  markDone: () => void;
  markError: (error: ChatDraftError) => void;
  clear: () => void;
}

export const useChatDraftStore = create<ChatDraftState>((set) => ({
  draft: null,
  start: ({ chatId, userContent, attachment }) =>
    set({
      draft: {
        chatId,
        userContent,
        attachment,
        assistantText: '',
        status: 'thinking',
        error: null,
      },
    }),
  appendDelta: (delta) =>
    set((s) =>
      s.draft ? { draft: { ...s.draft, assistantText: s.draft.assistantText + delta } } : s,
    ),
  markStreaming: () => set((s) => (s.draft ? { draft: { ...s.draft, status: 'streaming' } } : s)),
  markDone: () => set((s) => (s.draft ? { draft: { ...s.draft, status: 'done' } } : s)),
  markError: (error) =>
    set((s) => (s.draft ? { draft: { ...s.draft, status: 'error', error } } : s)),
  clear: () => set({ draft: null }),
}));
