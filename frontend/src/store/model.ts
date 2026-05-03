import { create } from 'zustand';

/**
 * Selected-model state for AI calls. Single source of truth — the model
 * picker (`<ModelPicker>`), the Settings tab (`SettingsModelsTab`), the
 * chat panel display (`<ChatPanel>`), and EditorPage's send guards all
 * read and write through here.
 *
 * Persisted to `localStorage['inkwell:selectedModelId']` so a refresh
 * keeps the user's choice. Storage access is wrapped in try/catch so
 * Safari private mode and similar still get a functional in-memory value.
 *
 * History: this used to be split between `useModelStore` (in-memory,
 * picker writes here) and `useSelectedModel` (localStorage, EditorPage
 * read from here). The split caused `chat.send · no_model` warns even
 * when the user had picked a model in the chat panel — the picker wrote
 * to one slot, the send-guard read the other. Consolidated so picks
 * actually flow to the AI calls.
 */

const STORAGE_KEY = 'inkwell:selectedModelId';

function readFromStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeToStorage(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    // Swallow — Safari private mode etc. State still updates so the UX
    // continues to work within the current session.
  }
}

export interface ModelState {
  modelId: string | null;
  setModelId: (id: string | null) => void;
}

export const useModelStore = create<ModelState>((set) => ({
  modelId: readFromStorage(),
  setModelId: (id) => {
    writeToStorage(id);
    set({ modelId: id });
  },
}));
