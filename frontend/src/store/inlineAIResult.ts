import { create } from 'zustand';

export type InlineAIAction = 'rewrite' | 'describe' | 'expand' | 'ask';
export type InlineAIStatus = 'thinking' | 'streaming' | 'done' | 'error';

export interface InlineAIResultError {
  code: string | null;
  message: string;
  httpStatus?: number;
  detail?: unknown;
  retryAfterSeconds?: number | null;
  veniceMessage?: string;
}

export interface InlineAIResultValue {
  action: InlineAIAction;
  text: string;
  status: InlineAIStatus;
  output: string;
  /** Only present when status === 'error'. */
  error?: InlineAIResultError | null;
}

export interface InlineAIResultState {
  inlineAIResult: InlineAIResultValue | null;
  setInlineAIResult: (result: InlineAIResultValue | null) => void;
  clear: () => void;
  reset: () => void;
}

const initialState: { inlineAIResult: InlineAIResultValue | null } = {
  inlineAIResult: null,
};

export const useInlineAIResultStore = create<InlineAIResultState>((set) => ({
  ...initialState,
  setInlineAIResult: (inlineAIResult) => set({ inlineAIResult }),
  /** Domain action: dismiss the inline AI result. For account-switch lifecycle reset, call `reset()` instead. */
  clear: () => set(initialState),
  reset: () => set(initialState),
}));
