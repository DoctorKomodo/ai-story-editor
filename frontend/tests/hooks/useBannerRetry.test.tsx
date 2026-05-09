import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBannerRetry } from '@/hooks/useBannerRetry';
import { type ChatMessage, chatMessagesQueryKey } from '@/hooks/useChat';

function makeMessage(over: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    id: over.id,
    role: 'user',
    contentJson: '',
    attachmentJson: null,
    citationsJson: null,
    model: null,
    tokens: null,
    latencyMs: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function makeFakeMutation(): {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
} {
  return {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  };
}

function withQc(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useBannerRetry — trailing-role dispatch table', () => {
  beforeEach(() => vi.clearAllMocks());

  it('case A — empty cache (trailing undefined) → fresh send', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), []);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'X', enableWebSearch: false };
    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    await act(async () => {
      await result.current.onRetry();
    });

    expect(onSend).toHaveBeenCalledWith(lastSendArgs);
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('case B — cache trailing is user (X persisted, no following assistant) → retry: true', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), [
      makeMessage({ id: 'old-user', role: 'user', contentJson: 'past' }),
      makeMessage({ id: 'old-asst', role: 'assistant', contentJson: 'past-reply' }),
      makeMessage({ id: 'new-user-X', role: 'user', contentJson: 'new question' }),
    ]);
    const onSend = vi.fn();
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'new question', enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    await act(async () => {
      await result.current.onRetry();
    });

    expect(mutation.mutateAsync).toHaveBeenCalledWith({
      chatId: 'chat-1',
      modelId: 'venice-test',
      retry: true,
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('case D — prior turn exists; trailing is assistant-1 → fresh send (assistant-1 untouched)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), [
      makeMessage({ id: 'user-1', role: 'user', contentJson: 'hi' }),
      makeMessage({ id: 'assistant-1', role: 'assistant', contentJson: 'hello' }),
    ]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'X', enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    await act(async () => {
      await result.current.onRetry();
    });

    expect(onSend).toHaveBeenCalledWith(lastSendArgs);
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
    const after = qc.getQueryData<ChatMessage[]>(chatMessagesQueryKey('chat-1'));
    expect(after?.some((m) => m.id === 'assistant-1')).toBe(true);
  });

  it('case E — content collision; trailing is assistant; "hello" matches user-1 content → fresh send (role-based)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), [
      makeMessage({ id: 'user-1', role: 'user', contentJson: 'hello' }),
      makeMessage({ id: 'assistant-1', role: 'assistant', contentJson: 'hi back' }),
    ]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'hello', enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    await act(async () => {
      await result.current.onRetry();
    });

    // Role-based detection: trailing is assistant, regardless of content matching.
    expect(onSend).toHaveBeenCalledWith(lastSendArgs);
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('rapid-fire edge — X1 succeeded, X2 sent + failed pre-persist; trailing is X1-assistant after refetch → fresh send X2', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // After the post-X1 refetch lands and X2 fails pre-persist, the cache
    // trailing is X1's assistant. Trailing-role correctly picks fresh send;
    // a captured-at-onMutate lastIdBefore would have falsely fired retry: true.
    qc.setQueryData(chatMessagesQueryKey('chat-1'), [
      makeMessage({ id: 'older-user', role: 'user', contentJson: 'older' }),
      makeMessage({ id: 'older-asst', role: 'assistant', contentJson: 'older-reply' }),
      makeMessage({ id: 'X1-user', role: 'user', contentJson: 'X1' }),
      makeMessage({ id: 'X1-assistant', role: 'assistant', contentJson: 'X1-reply' }),
    ]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'X2', enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    await act(async () => {
      await result.current.onRetry();
    });

    expect(onSend).toHaveBeenCalledWith(lastSendArgs);
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
    // X1's assistant is preserved.
    const after = qc.getQueryData<ChatMessage[]>(chatMessagesQueryKey('chat-1'));
    expect(after?.some((m) => m.id === 'X1-assistant')).toBe(true);
  });

  it('isDispatching is true during the inspect-and-decide window', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Register a slow queryFn so qc.refetchQueries actually awaits something
    // observable — without this, refetch on a populated cache could resolve
    // synchronously, leaving the timing of the isDispatching=true assertion
    // dependent on internal microtask ordering rather than the explicit
    // refetch step.
    qc.setQueryDefaults(chatMessagesQueryKey('chat-1'), {
      queryFn: () => new Promise<ChatMessage[]>((resolve) => setTimeout(() => resolve([]), 30)),
      retry: false,
    });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), []);

    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs = { content: 'X', enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          selectedModelId: 'venice-test',
          mutation,
          lastSendArgsRef: ref,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );

    expect(result.current.isDispatching).toBe(false);
    let promise: Promise<void>;
    act(() => {
      promise = result.current.onRetry();
    });
    // Synchronous setIsDispatching(true) ran; refetch is still in flight.
    expect(result.current.isDispatching).toBe(true);
    await act(async () => {
      await promise;
    });
    expect(result.current.isDispatching).toBe(false);
  });

  it('returns no-op when lastSendArgs is null or chatId/modelId missing', async () => {
    const qc = new QueryClient();
    const onSend = vi.fn();
    const mutation = makeFakeMutation();
    const { result } = renderHook(
      () => {
        const ref = useRef(null);
        return useBannerRetry({
          chatId: null,
          selectedModelId: null,
          mutation,
          lastSendArgsRef: ref as never,
          onSend,
        });
      },
      { wrapper: withQc(qc) },
    );
    await act(async () => {
      await result.current.onRetry();
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });
});
