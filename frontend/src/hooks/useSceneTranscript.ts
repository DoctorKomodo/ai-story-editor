import { useCallback } from 'react';
import { streamMessage } from '@/lib/api';
import { useSceneTranscriptStore } from '@/store/sceneTranscript';

export function useSceneTranscript(modelId: string | null, modelName: string | undefined) {
  const store = useSceneTranscriptStore();

  const generate = useCallback(
    async (chatId: string, content: string) => {
      if (!modelId) return;
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
              store.appendDelta(d);
            },
            onDone: () => {
              store.finishAssistant(`local-${Date.now()}`);
            },
            onError: (err) => {
              store.failAssistant(err instanceof Error ? err.message : String(err));
            },
          },
        );
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          store.removeLastAssistantIfPending();
          store.resetStream();
        } else {
          store.failAssistant(String(err));
        }
      }
    },
    [modelId, modelName, store],
  );

  const retry = useCallback(
    async (chatId: string) => {
      if (!modelId) return;
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
              store.appendDelta(d);
            },
            onDone: () => {
              store.finishAssistant(`local-${Date.now()}`);
            },
            onError: (err) => {
              store.failAssistant(err instanceof Error ? err.message : String(err));
            },
          },
        );
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          store.removeLastAssistantIfPending();
          store.resetStream();
        } else {
          store.failAssistant(String(err));
        }
      }
    },
    [modelId, modelName, store],
  );

  const stop = useCallback(() => {
    store.abortController?.abort();
  }, [store.abortController]);

  return {
    chatId: store.chatId,
    messages: store.messages,
    streamState: store.streamState,
    errorMessage: store.errorMessage,
    setChat: store.setChat,
    generate,
    retry,
    stop,
  };
}
