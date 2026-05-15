import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Chat, ChatSummary } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatMessagesQueryKey,
  chatsBaseQueryKey,
  chatsQueryKey,
  useChatMessagesQuery,
  useCreateChatMutation,
  useRemoveChatMutation,
  useRenameChatMutation,
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
  useChatDraftStore.setState({ drafts: {} });
});

afterEach(() => {
  useChatDraftStore.setState({ drafts: {} });
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
        chapterId: 'ch1',
        content: 'hello',
        modelId: 'm1',
      });
    });

    // onMutate fires before mutationFn; draft starts in 'thinking'.
    await waitFor(() => {
      expect(useChatDraftStore.getState().drafts['c1']).toMatchObject({
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
      expect(useChatDraftStore.getState().drafts['c1']).toBeUndefined();
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
        chapterId: 'ch1',
        content: 'q',
        modelId: 'm1',
        attachment: { selectionText: 'sel', chapterId: 'ch1' },
      });
    });

    await waitFor(() => {
      expect(useChatDraftStore.getState().drafts['c1']?.attachment).toEqual({
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
      await result.current
        .mutateAsync({ chatId: 'c1', chapterId: 'ch1', content: 'q', modelId: 'm1' })
        .catch(() => {
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
      const d = useChatDraftStore.getState().drafts['c1'];
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
          chapterId: 'ch1',
          content: 'hi',
          modelId: 'm1',
        }),
      ).rejects.toBeDefined();
    });

    const draft = useChatDraftStore.getState().drafts['c1'];
    expect(draft?.status).toBe('error');
    expect(draft?.error?.code).toBe('venice_error');
  });

  it('stop() aborts the in-flight stream', async () => {
    // Build an apiStream mock that returns a never-resolving SSE stream so we
    // can call stop() mid-flight and assert the abort propagates.
    let abortedSignal: AbortSignal | null = null;
    const neverEndingStream = new ReadableStream({
      start(_controller) {
        // Intentionally don't enqueue anything — the test aborts before any
        // chunk arrives.
      },
    });
    vi.mocked(apiStream).mockImplementation(async (_path, init) => {
      abortedSignal = (init as { signal?: AbortSignal } | undefined)?.signal ?? null;
      return new Response(neverEndingStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const { wrapper } = withClient();
    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    const sendPromise = result.current.mutateAsync({
      chatId: 'c1',
      chapterId: 'ch1',
      content: 'hello',
      modelId: 'm1',
    });

    // Wait until the mutation is in-flight so apiStream has been called and
    // the AbortController is stashed — deterministic alternative to setTimeout.
    await waitFor(() => expect(result.current.isPending).toBe(true));

    expect(result.current.stop).toBeDefined();
    result.current.stop();

    // parseAiSseStream exits cleanly on abort (reader.cancel → internal return),
    // so the mutation resolves rather than rejects. The meaningful assertion is
    // that the signal passed to apiStream was aborted.
    await expect(sendPromise).resolves.toBeUndefined();

    expect(abortedSignal).not.toBeNull();
    expect(abortedSignal?.aborted).toBe(true);
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
      p = result.current.mutateAsync({
        chatId: 'c1',
        chapterId: 'ch1',
        content: 'q',
        modelId: 'm1',
      });
    });

    // Emit a role-only chunk first — must NOT flip status to 'streaming'.
    enqueue('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
    await waitFor(() => {
      expect(useChatDraftStore.getState().drafts['c1']?.assistantText).toBe('');
    });
    expect(useChatDraftStore.getState().drafts['c1']?.status).toBe('thinking');

    // Now a content chunk — flips to 'streaming' and appends.
    enqueue('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
    await waitFor(() => {
      expect(useChatDraftStore.getState().drafts['c1']?.assistantText).toBe('Hi');
    });
    expect(useChatDraftStore.getState().drafts['c1']?.status).toBe('streaming');

    enqueue('data: [DONE]\n\n');
    close();
    await act(async () => {
      await p;
    });
  });
});

// ── useSendChatMessageMutation — invalidates chats list ───────────────────────

describe('useSendChatMessageMutation — invalidates chats list (story-editor-loj)', () => {
  it('invalidates the chats list cache for the chapter after a successful send', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    // Seed the chats-list cache for chapter-1 with a single chat.
    qc.setQueryData(chatsBaseQueryKey('chapter-1'), [
      {
        id: 'chat-1',
        chapterId: 'chapter-1',
        title: 't',
        kind: 'ask',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
        lastActivityAt: '2026-05-01T00:00:00Z',
        messageCount: 0,
      },
    ]);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    vi.mocked(apiStream).mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    // We need a wrapper that uses OUR qc, not the one from withClient().
    const customWrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useSendChatMessageMutation(), {
      wrapper: customWrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        chatId: 'chat-1',
        chapterId: 'chapter-1',
        content: 'hi',
        modelId: 'venice-uncensored-1b',
      });
    });

    await waitFor(() => {
      const matched = invalidateSpy.mock.calls.some((args) => {
        const arg = args[0];
        if (!arg || typeof arg !== 'object' || !('queryKey' in arg)) return false;
        const key = (arg as { queryKey?: readonly unknown[] }).queryKey;
        const expected = chatsBaseQueryKey('chapter-1');
        return (
          Array.isArray(key) &&
          key.length >= expected.length &&
          expected.every((v, i) => key[i] === v)
        );
      });
      expect(matched).toBe(true);
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
      lastActivityAt: '2026-01-01T00:00:00.000Z',
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

  it('useCreateChatMutation optimistically prepends to cache', async () => {
    const newChat = {
      id: 'chat-new',
      chapterId: CHAPTER_ID,
      title: null,
      kind: 'ask' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
    };
    // POST returns the new chat; the refetch after invalidation never resolves.
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { chat: newChat })).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    );

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const askKey = chatsQueryKey(CHAPTER_ID, 'ask');
    const existingChat: ChatSummary = {
      id: 'chat-old',
      chapterId: CHAPTER_ID,
      title: 'Old',
      kind: 'ask',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      messageCount: 2,
    };
    qc.setQueryData(askKey, [existingChat]);

    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateChatMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ chapterId: CHAPTER_ID, kind: 'ask' });
    });

    const cached = qc.getQueryData<ChatSummary[]>(askKey);
    expect(cached).toBeDefined();
    expect(cached?.[0]?.id).toBe('chat-new');
    expect(cached?.[1]?.id).toBe('chat-old');
  });
});

// ── useRenameChatMutation ─────────────────────────────────────────────────────

describe('useRenameChatMutation', () => {
  type FetchMock = ReturnType<typeof vi.fn>;
  let fetchMock: FetchMock;
  const CHAPTER_ID = 'ch-rename-1';

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

  it('updates the cached title from the server response, not the client input', async () => {
    const serverNormalisedTitle = 'Server-Normalized Title';
    const updatedChat: Chat = {
      id: 'chat-1',
      chapterId: CHAPTER_ID,
      title: serverNormalisedTitle,
      kind: 'ask',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
    };
    // PATCH returns the server-normalised chat; the invalidate refetch never resolves.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { chat: updatedChat })).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    );

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const askKey = chatsQueryKey(CHAPTER_ID, 'ask');
    const existingChat: ChatSummary = {
      id: 'chat-1',
      chapterId: CHAPTER_ID,
      title: 'Original Title',
      kind: 'ask',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      messageCount: 3,
    };
    qc.setQueryData(askKey, [existingChat]);

    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRenameChatMutation(CHAPTER_ID, 'ask'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'chat-1', title: 'client title' });
    });

    const cached = qc.getQueryData<ChatSummary[]>(askKey);
    expect(cached).toBeDefined();
    expect(cached?.[0]?.title).toBe(serverNormalisedTitle);
    expect(cached?.[0]?.title).not.toBe('client title');
  });
});

// ── useRemoveChatMutation ─────────────────────────────────────────────────────

describe('useRemoveChatMutation', () => {
  type FetchMock = ReturnType<typeof vi.fn>;
  let fetchMock: FetchMock;
  const CHAPTER_ID = 'ch-remove-1';

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

  it('filters the deleted id out of the cache', async () => {
    // DELETE returns 204 no content; the invalidate refetch never resolves.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    );

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const askKey = chatsQueryKey(CHAPTER_ID, 'ask');
    const chatToKeep: ChatSummary = {
      id: 'chat-keep',
      chapterId: CHAPTER_ID,
      title: 'Keep Me',
      kind: 'ask',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      messageCount: 1,
    };
    const chatToDelete: ChatSummary = {
      id: 'chat-delete',
      chapterId: CHAPTER_ID,
      title: 'Delete Me',
      kind: 'ask',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      messageCount: 0,
    };
    qc.setQueryData(askKey, [chatToKeep, chatToDelete]);

    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRemoveChatMutation(CHAPTER_ID, 'ask'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('chat-delete');
    });

    const cached = qc.getQueryData<ChatSummary[]>(askKey);
    expect(cached).toBeDefined();
    expect(cached?.find((c) => c.id === 'chat-delete')).toBeUndefined();
    expect(cached?.find((c) => c.id === 'chat-keep')).toBeDefined();
  });
});

// ── useChat schema drift ──────────────────────────────────────────────────────

describe('useChat schema drift', () => {
  const CHAPTER_ID = 'ch-drift-1';

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const validChat = {
    id: 'cm0chat00000001',
    chapterId: CHAPTER_ID,
    title: 'First-draft brainstorm',
    kind: 'ask' as const,
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T01:00:00.000Z',
    lastActivityAt: '2026-05-15T02:00:00.000Z',
  };

  let fetchMock: ReturnType<typeof vi.fn>;

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

  it('createChat surfaces error when server response carries stray key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { chat: { ...validChat, extra: 1 } }));
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateChatMutation(), { wrapper });

    await expect(
      result.current.mutateAsync({ chapterId: CHAPTER_ID, kind: 'ask' }),
    ).rejects.toThrow();
  });
});

// ── useChatMessagesQuery — runtime validation (Zod schema) ────────────────────

function wrapQc() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

describe('useChatMessagesQuery runtime validation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

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

  it('surfaces ZodError when the server response is shape-drifted', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { messages: [{ id: 'msg-1', content: 'Hello' /* role absent */ }] }),
    );
    const { result } = renderHook(() => useChatMessagesQuery('chat-1'), { wrapper: wrapQc() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
    expect(result.current.error?.name).toBe('ZodError');
  });

  it('returns parsed messages on valid response', async () => {
    const validResponse = {
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          attachmentJson: null,
          citationsJson: null,
          model: null,
          tokens: null,
          latencyMs: null,
          createdAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    };
    fetchMock.mockResolvedValue(jsonResponse(200, validResponse));
    const { result } = renderHook(() => useChatMessagesQuery('chat-1'), { wrapper: wrapQc() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0].content).toBe('Hello');
    expect(result.current.data?.[0].role).toBe('user');
  });
});
