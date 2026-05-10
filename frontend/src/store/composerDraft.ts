import { create } from 'zustand';

/**
 * [F41] Composer draft slice.
 *
 * Lets non-component code (e.g. the Ask-AI flow triggered from the F33
 * SelectionBubble) push a pre-filled draft into the chat composer and
 * request that the composer's textarea take focus, without prop-drilling
 * a ref or imperative handle through the layout.
 *
 * The composer subscribes to `draft`; when it transitions from null to a
 * string it prepends the draft to its internal value and calls
 * `clearDraft()`. `focusToken` increments to signal a focus request — the
 * composer focuses the textarea on each change.
 */

const initialState: { draft: string | null; focusToken: number } = {
  draft: null,
  focusToken: 0,
};

export interface ComposerDraftState {
  draft: string | null;
  focusToken: number;
  setDraft: (draft: string) => void;
  requestFocus: () => void;
  /** Clears `draft` only — does NOT reset `focusToken`. Use `reset()` for full reset. */
  clearDraft: () => void;
  reset: () => void;
}

export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  ...initialState,
  setDraft: (draft) => set({ draft }),
  requestFocus: () => set((s) => ({ focusToken: s.focusToken + 1 })),
  clearDraft: () => set({ draft: null }),
  reset: () => set(initialState),
}));
