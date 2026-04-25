import { create } from 'zustand';

export interface ParamsValue {
  temperature: number;
  topP: number;
  maxTokens: number;
  frequencyPenalty: number;
}

export interface ParamsState {
  params: ParamsValue;
  setParams: (partial: Partial<ParamsValue>) => void;
}

const DEFAULT_PARAMS: ParamsValue = {
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 800,
  frequencyPenalty: 0,
};

export const useParamsStore = create<ParamsState>((set) => ({
  params: { ...DEFAULT_PARAMS },
  setParams: (partial) => set((state) => ({ params: { ...state.params, ...partial } })),
}));
