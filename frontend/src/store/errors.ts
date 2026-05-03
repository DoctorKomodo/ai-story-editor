import { create } from 'zustand';

export type AppErrorSeverity = 'error' | 'warn' | 'info';

export interface AppError {
  id: string;
  at: number;
  severity: AppErrorSeverity;
  source: string;
  code: string | null;
  message: string;
  detail?: unknown;
  httpStatus?: number;
}

export interface ErrorStore {
  errors: AppError[];
  push(e: Omit<AppError, 'id' | 'at'>): string;
  dismiss(id: string): void;
  clear(): void;
}

const MAX_ENTRIES = 50;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useErrorStore = create<ErrorStore>((set) => ({
  errors: [],
  push: (entry) => {
    const id = generateId();
    const next: AppError = { ...entry, id, at: Date.now() };
    set((state) => {
      const combined = [next, ...state.errors];
      const trimmed = combined.length > MAX_ENTRIES ? combined.slice(0, MAX_ENTRIES) : combined;
      return { errors: trimmed };
    });
    return id;
  },
  dismiss: (id) => {
    set((state) => ({ errors: state.errors.filter((e) => e.id !== id) }));
  },
  clear: () => {
    set({ errors: [] });
  },
}));
