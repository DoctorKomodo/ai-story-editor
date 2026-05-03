import { create } from 'zustand';

export type InlineAIAction = 'rewrite' | 'describe' | 'expand' | 'ask';
export type InlineAIStatus = 'thinking' | 'streaming' | 'done' | 'error';

export interface InlineAIResultError {
  code: string | null;
  message: string;
  httpStatus?: number;
  detail?: unknown;
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
}

export const useInlineAIResultStore = create<InlineAIResultState>((set) => ({
  inlineAIResult: null,
  setInlineAIResult: (inlineAIResult) => set({ inlineAIResult }),
  clear: () => set({ inlineAIResult: null }),
}));
