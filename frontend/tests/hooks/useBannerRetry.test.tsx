import { type MutateOptions, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import type { Message } from 'story-editor-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendArgs } from '@/components/ChatComposer';
import { useBannerRetry } from '@/hooks/useBannerRetry';
import {
  chatMessagesQueryKey,
  type SendChatMessageArgs,
  type useSendChatMessageMutation,
} from '@/hooks/useChat';
import type { ApiError } from '@/lib/api';

function makeMessage(over: Partial<Message> & { id: string }): Message {
  return {
    role: 'user',
    content: '',
    attachmentJson: null,
    citationsJson: null,
    model: null,
    tokens: null,
    latencyMs: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...over,
  };
}

function makeFakeMutation(): ReturnType<typeof useSendChatMessageMutation> {
  return {
    data: undefined,
    error: null,
    variables: undefined,
    context: undefined,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
    status: 'idle',
    submittedAt: 0,
    isError: false,
    isIdle: true,
    isPending: false,
    isSuccess: false,
    mutate:
      vi.fn<
        (
          variables: SendChatMessageArgs,
          options?: MutateOptions<void, ApiError, SendChatMessageArgs, unknown>,
        ) => void
      >(),
    mutateAsync: vi
      .fn<
        (
          variables: SendChatMessageArgs,
          options?: MutateOptions<void, ApiError, SendChatMessageArgs, unknown>,
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined),
    reset: vi.fn<() => void>(),
    stop: vi.fn<() => void>(),
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
    const lastSendArgs: SendArgs = { content: 'X', attachment: null, enableWebSearch: false };
    const { result } = renderHook(
      () => {
        const ref = useRef<SendArgs | null>(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          draftId: 'chapter-1',
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
      makeMessage({ id: 'old-user', role: 'user', content: 'past' }),
      makeMessage({ id: 'old-asst', role: 'assistant', content: 'past-reply' }),
      makeMessage({ id: 'new-user-X', role: 'user', content: 'new question' }),
    ]);
    const onSend = vi.fn();
    const mutation = makeFakeMutation();
    const lastSendArgs: SendArgs = {
      content: 'new question',
      attachment: null,
      enableWebSearch: false,
    };

    const { result } = renderHook(
      () => {
        const ref = useRef<SendArgs | null>(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          draftId: 'chapter-1',
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
      draftId: 'chapter-1',
      modelId: 'venice-test',
      retry: true,
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('case D — prior turn exists; trailing is assistant-1 → fresh send (assistant-1 untouched)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), [
      makeMessage({ id: 'user-1', role: 'user', content: 'hi' }),
      makeMessage({ id: 'assistant-1', role: 'assistant', content: 'hello' }),
    ]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs: SendArgs = { content: 'X', attachment: null, enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef<SendArgs | null>(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          draftId: 'chapter-1',
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
    const after = qc.getQueryData<Message[]>(chatMessagesQueryKey('chat-1'));
    expect(after?.some((m) => m.id === 'assistant-1')).toBe(true);
  });

  it('case E — content collision; trailing is assistant; "hello" matches user-1 content → fresh send (role-based)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), [
      makeMessage({ id: 'user-1', role: 'user', content: 'hello' }),
      makeMessage({ id: 'assistant-1', role: 'assistant', content: 'hi back' }),
    ]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs: SendArgs = { content: 'hello', attachment: null, enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef<SendArgs | null>(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          draftId: 'chapter-1',
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
      makeMessage({ id: 'older-user', role: 'user', content: 'older' }),
      makeMessage({ id: 'older-asst', role: 'assistant', content: 'older-reply' }),
      makeMessage({ id: 'X1-user', role: 'user', content: 'X1' }),
      makeMessage({ id: 'X1-assistant', role: 'assistant', content: 'X1-reply' }),
    ]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs: SendArgs = { content: 'X2', attachment: null, enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef<SendArgs | null>(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          draftId: 'chapter-1',
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
    const after = qc.getQueryData<Message[]>(chatMessagesQueryKey('chat-1'));
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
      queryFn: () => new Promise<Message[]>((resolve) => setTimeout(() => resolve([]), 30)),
      retry: false,
    });
    qc.setQueryData(chatMessagesQueryKey('chat-1'), []);

    const onSend = vi.fn().mockResolvedValue(undefined);
    const mutation = makeFakeMutation();
    const lastSendArgs: SendArgs = { content: 'X', attachment: null, enableWebSearch: false };

    const { result } = renderHook(
      () => {
        const ref = useRef<SendArgs | null>(lastSendArgs);
        return useBannerRetry({
          chatId: 'chat-1',
          draftId: 'chapter-1',
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
          draftId: null,
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
