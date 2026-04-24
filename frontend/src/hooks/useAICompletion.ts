/**
 * `useAICompletion` — F15 streaming hook for `POST /api/ai/complete`.
 *
 * Owns the transient AI-call state (status / accumulated text / error) for a
 * single in-flight request. Kept as a hook rather than a Zustand slice so it
 * stays tightly scoped to the editor page; F22 may fold this into the layout
 * slice later if cross-component reads appear.
 *
 * Unrelated but commonly-confused follow-ups:
 *  - F16 consumes the Venice rate-limit response headers (`x-venice-*`);
 *    it reads them from the same request but doesn't live inside this hook.
 *  - F33–F36 replace the right-panel result card with the in-editor
 *    selection bubble + inline-AI card; F38/F42 redesign the chat pane.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiStream, ApiError } from '@/lib/api';
import { parseAiSseStream } from '@/lib/sse';

export type AICompletionStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface AICompletionState {
  status: AICompletionStatus;
  text: string;
  error: ApiError | null;
}

export interface RunArgs {
  action: 'continue' | 'rephrase' | 'expand' | 'summarise' | 'freeform';
  selectedText: string;
  chapterId: string;
  storyId: string;
  modelId: string;
  freeformInstruction?: string;
  enableWebSearch?: boolean;
}

export interface UseAICompletion extends AICompletionState {
  run: (args: RunArgs) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

const INITIAL_STATE: AICompletionState = {
  status: 'idle',
  text: '',
  error: null,
};

export function useAICompletion(): UseAICompletion {
  const [state, setState] = useState<AICompletionState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const safeSetState = useCallback(
    (updater: (prev: AICompletionState) => AICompletionState): void => {
      if (!mountedRef.current) return;
      setState(updater);
    },
    [],
  );

  const cancel = useCallback((): void => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (mountedRef.current) {
      setState(INITIAL_STATE);
    }
  }, []);

  const reset = useCallback((): void => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (mountedRef.current) {
      setState(INITIAL_STATE);
    }
  }, []);

  const run = useCallback(
    async (args: RunArgs): Promise<void> => {
      // Abort any in-flight request before starting a new one.
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      safeSetState(() => ({ status: 'streaming', text: '', error: null }));

      const body: Record<string, unknown> = {
        action: args.action,
        selectedText: args.selectedText,
        chapterId: args.chapterId,
        storyId: args.storyId,
        modelId: args.modelId,
      };
      if (args.freeformInstruction !== undefined) {
        body.freeformInstruction = args.freeformInstruction;
      }
      if (args.enableWebSearch !== undefined) {
        body.enableWebSearch = args.enableWebSearch;
      }

      let res: Response;
      try {
        res = await apiStream('/ai/complete', {
          method: 'POST',
          body,
          signal: controller.signal,
        });
      } catch (err) {
        // Ignore abort-triggered errors — `cancel()` already reset state.
        if (controller.signal.aborted) return;
        const apiErr =
          err instanceof ApiError
            ? err
            : new ApiError(0, err instanceof Error ? err.message : 'Request failed');
        safeSetState(() => ({ status: 'error', text: '', error: apiErr }));
        return;
      }

      if (!res.body) {
        safeSetState(() => ({
          status: 'error',
          text: '',
          error: new ApiError(502, 'Empty response body'),
        }));
        return;
      }

      try {
        for await (const event of parseAiSseStream(res.body, controller.signal)) {
          if (controller.signal.aborted) return;
          if (event.type === 'chunk') {
            const delta = event.chunk.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              safeSetState((prev) => ({ ...prev, text: prev.text + delta }));
            }
          } else if (event.type === 'error') {
            const code = event.error.code ?? 'stream_error';
            safeSetState((prev) => ({
              status: 'error',
              text: prev.text,
              error: new ApiError(502, event.error.error, code),
            }));
            return;
          } else {
            // done
            safeSetState((prev) =>
              prev.status === 'error' ? prev : { ...prev, status: 'done' },
            );
            return;
          }
        }
        // Stream ended without explicit [DONE] — treat as done unless aborted.
        if (!controller.signal.aborted) {
          safeSetState((prev) =>
            prev.status === 'error' ? prev : { ...prev, status: 'done' },
          );
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const apiErr =
          err instanceof ApiError
            ? err
            : new ApiError(502, err instanceof Error ? err.message : 'Stream failed');
        safeSetState((prev) => ({ status: 'error', text: prev.text, error: apiErr }));
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [safeSetState],
  );

  return {
    status: state.status,
    text: state.text,
    error: state.error,
    run,
    cancel,
    reset,
  };
}
