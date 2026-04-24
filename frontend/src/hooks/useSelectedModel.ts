/**
 * [F13] Persistent selected-model state backed by localStorage.
 *
 * Wraps a `useState` + mirrored `localStorage` write. `localStorage` calls
 * are wrapped in try/catch so private-mode Safari (or any environment where
 * storage is disabled) still gets a functional in-memory value — the UX
 * simply does not persist across reloads there.
 *
 * Follow-ups:
 * - [F15] reads `selectedModelId` when invoking `/api/ai/complete`.
 * - [F42] redesigns the picker UI; persistence shape stays stable.
 */
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'inkwell:selectedModelId';

function readFromStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeToStorage(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Swallow — Safari private mode and similar. State still updates so the
    // UX continues to work within the current session.
  }
}

export interface UseSelectedModelResult {
  selectedModelId: string | null;
  setSelectedModelId: (id: string) => void;
}

export function useSelectedModel(): UseSelectedModelResult {
  const [selectedModelId, setSelectedModelIdState] = useState<string | null>(() =>
    readFromStorage(),
  );

  const setSelectedModelId = useCallback((id: string): void => {
    setSelectedModelIdState(id);
    writeToStorage(id);
  }, []);

  return { selectedModelId, setSelectedModelId };
}
