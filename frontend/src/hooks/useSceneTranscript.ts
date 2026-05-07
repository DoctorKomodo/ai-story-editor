import { useCallback } from 'react';
import { streamMessage } from '@/lib/api';
import { useSceneTranscriptStore } from '@/store/sceneTranscript';

export function useSceneTranscript(modelId: string | null, modelName: string | undefined) {
  // Narrow selectors so this hook only re-renders when these specific slices
  // change, not on every store mutation (e.g. every streaming delta).
  const chatId = useSceneTranscriptStore((s) => s.chatId);
  const messages = useSceneTranscriptStore((s) => s.messages);
  const streamState = useSceneTranscriptStore((s) => s.streamState);
  const errorMessage = useSceneTranscriptStore((s) => s.errorMessage);

  // Actions are stable function references (defined inside Zustand's create
  // factory) — read them via getState() inside callbacks to avoid subscribing
  // to them as selectors, which would cause unnecessary re-renders.
  const generate = useCallback(
    async (chatId: string, content: string) => {
      if (!modelId) return;
      const store = useSceneTranscriptStore.getState();
      store.pushUser(content);
      const controller = new AbortController();
      store.setAbort(controller);
      store.beginStreamingAssistant(modelName ?? modelId);

      try {
        await streamMessage(
          chatId,
          { content, modelId },
          {
            signal: controller.signal,
            onDelta: (d) => {
              useSceneTranscriptStore.getState().appendDelta(d);
            },
            onDone: () => {
              useSceneTranscriptStore.getState().finishAssistant(`local-${Date.now()}`);
            },
            onError: (err) => {
              useSceneTranscriptStore
                .getState()
                .failAssistant(err instanceof Error ? err.message : String(err));
            },
          },
        );
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          useSceneTranscriptStore.getState().removeLastAssistantIfPending();
          useSceneTranscriptStore.getState().resetStream();
        } else {
          useSceneTranscriptStore.getState().failAssistant(String(err));
        }
      }
    },
    [modelId, modelName],
  );

  const retry = useCallback(
    async (chatId: string) => {
      if (!modelId) return;
      const store = useSceneTranscriptStore.getState();
      const controller = new AbortController();
      store.setAbort(controller);
      store.beginStreamingAssistant(modelName ?? modelId);
      try {
        await streamMessage(
          chatId,
          { retry: true, modelId },
          {
            signal: controller.signal,
            onDelta: (d) => {
              useSceneTranscriptStore.getState().appendDelta(d);
            },
            onDone: () => {
              useSceneTranscriptStore.getState().finishAssistant(`local-${Date.now()}`);
            },
            onError: (err) => {
              useSceneTranscriptStore
                .getState()
                .failAssistant(err instanceof Error ? err.message : String(err));
            },
          },
        );
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          useSceneTranscriptStore.getState().removeLastAssistantIfPending();
          useSceneTranscriptStore.getState().resetStream();
        } else {
          useSceneTranscriptStore.getState().failAssistant(String(err));
        }
      }
    },
    [modelId, modelName],
  );

  const stop = useCallback(() => {
    useSceneTranscriptStore.getState().abortController?.abort();
  }, []);

  return {
    chatId,
    messages,
    streamState,
    errorMessage,
    // setChat is a stable Zustand action — return it directly from getState()
    // so it never causes dependency churn in callers.
    setChat: useSceneTranscriptStore.getState().setChat,
    generate,
    retry,
    stop,
  };
}
