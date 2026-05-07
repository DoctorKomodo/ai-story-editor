import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatMessagesQueryKey,
  chatsBaseQueryKey,
  chatsQueryKey,
  useCreateChatMutation,
  useSendChatMessageMutation,
} from '@/hooks/useChat';
import { ApiError, apiStream, resetApiClientForTests, setAccessToken } from '@/lib/api';
import { useChatDraftStore } from '@/store/chatDraft';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiStream: vi.fn() };
});

function sseResponse(lines: ReadonlyArray<string>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function withClient(): { wrapper: (p: { children: ReactNode }) => JSX.Element; qc: QueryClient } {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, qc };
}

beforeEach(() => {
  vi.mocked(apiStream).mockReset();
  useChatDraftStore.getState().clear();
});

afterEach(() => {
  useChatDraftStore.getState().clear();
});

describe('useSendChatMessageMutation', () => {
  it('seeds the draft on send and progresses thinking → streaming → done', async () => {
    vi.mocked(apiStream).mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const { wrapper, qc } = withClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    let p!: Promise<void>;
    act(() => {
      p = result.current.mutateAsync({
        chatId: 'c1',
        content: 'hello',
        modelId: 'm1',
      });
    });

    // onMutate fires before mutationFn; draft starts in 'thinking'.
    await waitFor(() => {
      expect(useChatDraftStore.getState().draft).toMatchObject({
        chatId: 'c1',
        userContent: 'hello',
        assistantText: '',
        status: 'thinking',
      });
    });

    await act(async () => {
      await p;
    });

    // After completion, invalidate has been called — onSettled clears the
    // draft so the refetched messages take over.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: chatMessagesQueryKey('c1') });
    await waitFor(() => {
      expect(useChatDraftStore.getState().draft).toBeNull();
    });
  });

  it('seeds attachment payload onto the draft when provided', async () => {
    vi.mocked(apiStream).mockResolvedValueOnce(sseResponse(['data: [DONE]\n\n']));
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    let p!: Promise<void>;
    act(() => {
      p = result.current.mutateAsync({
        chatId: 'c1',
        content: 'q',
        modelId: 'm1',
        attachment: { selectionText: 'sel', chapterId: 'ch1' },
      });
    });

    await waitFor(() => {
      expect(useChatDraftStore.getState().draft?.attachment).toEqual({
        selectionText: 'sel',
        chapterId: 'ch1',
      });
    });

    await act(async () => {
      await p;
    });
  });

  it('on SSE error frame, sets draft.status=error and does NOT invalidate the messages query', async () => {
    vi.mocked(apiStream).mockResolvedValueOnce(
      sseResponse(['data: {"error":"rate limited","code":"rate_limited"}\n\n', 'data: [DONE]\n\n']),
    );

    const { wrapper, qc } = withClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ chatId: 'c1', content: 'q', modelId: 'm1' }).catch(() => {
        // expected — mutation throws on error frame
      });
    });

    // Draft should have been marked error before onSettled cleared it.
    // We can only inspect post-clear; assert via the mutation's error
    // state and that invalidate did not run on the success path.
    expect(invalidateSpy).not.toHaveBeenCalled();
    // TanStack Query v5 flushes mutation-state updates asynchronously via
    // notifyManager.batchCalls; waitFor is required to observe isError.
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // On error, the draft is preserved so <ChatMessages /> can render the error banner.
    await waitFor(() => {
      const d = useChatDraftStore.getState().draft;
      expect(d?.status).toBe('error');
      expect(d?.error?.message).toBe('rate limited');
      expect(d?.error?.code).toBe('rate_limited');
    });
  });

  it('forwards ApiError.code into the draft on pre-stream HTTP error', async () => {
    // Mock apiStream to throw an ApiError simulating a 502 venice_error response.
    vi.mocked(apiStream).mockRejectedValueOnce(
      new ApiError(502, 'Venice rejected the request.', 'venice_error'),
    );

    const { wrapper } = withClient();
    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          chatId: 'c1',
          content: 'hi',
          modelId: 'm1',
        }),
      ).rejects.toBeDefined();
    });

    const draft = useChatDraftStore.getState().draft;
    expect(draft?.status).toBe('error');
    expect(draft?.error?.code).toBe('venice_error');
  });

  it('flips status to streaming on the first non-empty content delta', async () => {
    // Hold the stream open via a controllable enqueue/close so we can
    // observe intermediate state.
    let enqueue!: (s: string) => void;
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        enqueue = (s) => controller.enqueue(encoder.encode(s));
        close = () => controller.close();
      },
    });
    vi.mocked(apiStream).mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const { wrapper } = withClient();
    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    let p!: Promise<void>;
    act(() => {
      p = result.current.mutateAsync({ chatId: 'c1', content: 'q', modelId: 'm1' });
    });

    // Emit a role-only chunk first — must NOT flip status to 'streaming'.
    enqueue('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
    await waitFor(() => {
      expect(useChatDraftStore.getState().draft?.assistantText).toBe('');
    });
    expect(useChatDraftStore.getState().draft?.status).toBe('thinking');

    // Now a content chunk — flips to 'streaming' and appends.
    enqueue('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
    await waitFor(() => {
      expect(useChatDraftStore.getState().draft?.assistantText).toBe('Hi');
    });
    expect(useChatDraftStore.getState().draft?.status).toBe('streaming');

    enqueue('data: [DONE]\n\n');
    close();
    await act(async () => {
      await p;
    });
  });
});

// ── useCreateChatMutation cache invalidation ──────────────────────────────────

describe('useCreateChatMutation cache invalidation', () => {
  type FetchMock = ReturnType<typeof vi.fn>;
  let fetchMock: FetchMock;
  const CHAPTER_ID = 'ch-inv-1';

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('invalidates kind-filtered cache entries after createChat so all kind variants are refreshed', async () => {
    // Arrange: POST /chapters/:id/chats returns a new chat row.
    const newChat = {
      id: 'chat-new',
      chapterId: CHAPTER_ID,
      title: null,
      kind: 'scene' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messageCount: 0,
    };
    fetchMock.mockResolvedValue(jsonResponse(201, { chat: newChat }));

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    // Pre-populate the kind='scene' query with a stale-time so TanStack
    // Query treats it as fresh before the mutation fires.
    const sceneKey = chatsQueryKey(CHAPTER_ID, 'scene');
    qc.setQueryData(sceneKey, []);

    // Verify the scene query starts fresh (not stale).
    const stateBefore = qc.getQueryState(sceneKey);
    expect(stateBefore?.isInvalidated).toBeFalsy();

    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useCreateChatMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ chapterId: CHAPTER_ID, kind: 'scene' });
    });

    // After the mutation succeeds, the kind='scene' query must be marked
    // stale (invalidated) by the 3-element prefix invalidation.  Previously,
    // invalidating with `chatsQueryKey(chapterId)` (4 elements, undefined kind)
    // would NOT have matched the 4-element key `['chapter', id, 'chats', 'scene']`.
    const stateAfter = qc.getQueryState(sceneKey);
    expect(stateAfter?.isInvalidated).toBe(true);

    // The 3-element base key is what chatsBaseQueryKey returns — confirm shape.
    expect(chatsBaseQueryKey(CHAPTER_ID)).toEqual(['chapter', CHAPTER_ID, 'chats']);
  });
});
