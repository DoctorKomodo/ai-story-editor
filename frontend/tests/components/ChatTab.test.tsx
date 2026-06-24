/**
 * ChatTab — smoke tests.
 *
 * Mirrors the SceneTab test scaffolding — stubbed `fetch`, seeded TanStack
 * Query cache (settings + empty models), and a fresh session store per test.
 */
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTab } from '@/components/ChatTab';
import { chatMessagesQueryKey, chatsQueryKey } from '@/hooks/useChat';
import { modelsQueryKey } from '@/hooks/useModels';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
import { apiStream, resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { truncateAtWordBoundary } from '@/lib/strings';
import { useChatDraftStore } from '@/store/chatDraft';
import { useErrorStore } from '@/store/errors';
import { useSessionStore } from '@/store/session';

// Partially mock @/lib/api so we can intercept `apiStream` for the SSE send
// in test 4 without affecting the other exports (api, resetApiClientForTests, etc).
// The mock is hoisted by Vite/Vitest, so it takes effect before any imports.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiStream: vi.fn(actual.apiStream) };
});

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderWithProviders(ui: ReactNode, client?: QueryClient): { client: QueryClient } {
  const qc = client ?? createQueryClient();
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { client: qc };
}

describe('ChatTab — smoke', () => {
  let fetchMock: FetchMock;

  function makeClient(): QueryClient {
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    qc.setQueryData(modelsQueryKey, []);
    return qc;
  }

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useChatDraftStore.setState({ drafts: {} });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders the chat-tab root and the empty composer when no sessions exist', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(jsonResponse(200, { chats: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, makeClient());

    await waitFor(() => {
      expect(screen.getByTestId('chat-tab')).toBeInTheDocument();
    });

    // Picker shows the "no session yet" hint while sessions are empty.
    expect(screen.getByText(/no session yet/i)).toBeInTheDocument();

    // Empty state renders when no chat session is selected.
    expect(screen.getByTestId('chat-empty')).toBeInTheDocument();
  });

  it('shows the UndoToast when a chat session is soft-deleted, and dismisses on Undo', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chats/c1/messages')) {
        return jsonResponse(200, { messages: [] });
      }
      if (url.endsWith('/api/chats/c1') && init?.method === 'DELETE') {
        return jsonResponse(204, null);
      }
      if (url.includes('/chats') && !url.includes('/messages')) {
        return jsonResponse(200, {
          chats: [
            {
              id: 'c1',
              title: 'How do I describe rain?',
              chapterId: 'ch1',
              kind: 'ask',
              messageCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
            },
          ],
        });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, makeClient());

    const picker = await screen.findByRole('button', { name: /Chat: How do I describe rain/ });
    await user.click(picker);
    const row = await screen.findByRole('option', { name: /How do I describe rain/ });
    await user.hover(row);
    const deleteBtn = await screen.findByRole('button', {
      name: /Delete How do I describe rain/,
    });
    await user.click(deleteBtn);

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/Deleted/i);
    expect(toast).toHaveTextContent(/How do I describe rain/);
    const undo = await screen.findByRole('button', { name: /Undo/i });
    expect(undo).toBeInTheDocument();

    await user.click(undo);
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  // Auto-rename: a fully-mocked SSE-streaming send is significantly larger than
  // the smoke value justifies, so this test instead exercises the helper and
  // mutation pieces directly. The truncation helper is verified, and the
  // PATCH /chats/:id rename request shape is asserted against the real
  // useRenameChatMutation by driving it via the same code path ChatTab uses.
  it('truncateAtWordBoundary truncates a long first message at the configured max', () => {
    const longMessage =
      'Could you describe in vivid sensory detail a rainy afternoon on the veranda where Linda sits alone';
    const title = truncateAtWordBoundary(longMessage, 50);
    expect(title.length).toBeLessThanOrEqual(51); // 50 + ellipsis char
    expect(title.endsWith('…')).toBe(true);
    // Cuts at a word boundary: no partial word at the end.
    expect(title).toMatch(/^Could you describe in vivid sensory detail a/);
  });

  it('auto-renames an explicitly-created new chat after the first send', async () => {
    // Regression for: isFirstTurn was evaluated before the inline-create block,
    // so clicking "+ New chat" set activeChatId and caused isFirstTurn to be
    // false on the subsequent send — rename never fired.

    // Build a minimal SSE response (same helper pattern as useChat.test.tsx).
    function sseResponse(): Response {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const chunk = JSON.stringify({ choices: [{ delta: { content: 'hi' } }] });
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    const now = new Date().toISOString();
    // POST /chats returns a Chat (no messageCount — chatResponseSchema is strict).
    const newChat = {
      id: 'c1',
      chapterId: 'ch1',
      title: null,
      kind: 'ask',
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };
    // GET /chats returns ChatSummary (messageCount required by chatSummarySchema).
    const newChatSummary = { ...newChat, messageCount: 0 };

    // Stateful mock: after the POST create, GET /chats returns the new session.
    let chatCreated = false;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';

      // List chats — returns the created chat once it exists
      if (url.includes('/chapters/ch1/chats') && method === 'GET') {
        return jsonResponse(200, { chats: chatCreated ? [newChatSummary] : [] });
      }
      // Create chat
      if (url.includes('/chapters/ch1/chats') && method === 'POST') {
        chatCreated = true;
        return jsonResponse(201, { chat: newChat });
      }
      // GET messages for the active chat
      if (url.includes('/chats/c1/messages') && method === 'GET') {
        return jsonResponse(200, { messages: [] });
      }
      // PATCH rename (apiStream handles the POST /messages separately via spy)
      if (url.includes('/chats/c1') && !url.includes('/messages') && method === 'PATCH') {
        return jsonResponse(200, { chat: { ...newChat, title: 'Hello world' } });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    // Configure the module-level apiStream mock to return the SSE response once.
    // This mirrors useChat.test.tsx's approach: mock apiStream rather than fetch
    // so the ReadableStream body is consumed correctly inside jsdom.
    vi.mocked(apiStream).mockResolvedValueOnce(sseResponse());

    const user = userEvent.setup();
    // Need a model selected so checkChatSendGuards doesn't block the send.
    const qc = makeClient();
    qc.setQueryData(userSettingsQueryKey, {
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, model: 'venice-model-1' },
    });
    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, qc);

    // Wait for initial render — no sessions yet
    await waitFor(() => expect(screen.getByTestId('chat-tab')).toBeInTheDocument());

    // Open the session picker dropdown, then click "+ New chat".
    // The "New chat" button lives inside the dropdown which only mounts when open.
    const pickerTrigger = await screen.findByRole('button', { name: /Chat: none selected/i });
    await user.click(pickerTrigger);
    const newButton = await screen.findByRole('button', { name: /New chat/i });
    await user.click(newButton);

    // Wait for the create mutation's onSuccess to fire: the picker trigger
    // changes once activeChatId is set and sessions has the new chat prepended.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Chat: none selected/i })).toBeNull();
    });

    // Type a message and send it (Ctrl+Enter is the submit shortcut)
    const textarea = await screen.findByRole('textbox');
    await user.click(textarea);
    await user.type(textarea, 'Hello world');
    await user.keyboard('{Control>}{Enter}{/Control}');

    // The rename PATCH should fire once the send stream completes because
    // isFirstTurn is now computed from messageCount after chatId is resolved,
    // not from chatId === null.
    await waitFor(
      () => {
        const patchCalls = (fetchMock.mock.calls as [string, RequestInit?][]).filter(
          ([url, init]) =>
            typeof url === 'string' &&
            url.includes('/chats/c1') &&
            !url.includes('/messages') &&
            (init?.method?.toUpperCase() ?? 'GET') === 'PATCH',
        );
        expect(patchCalls.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    // Confirm the PATCH carried a non-empty title
    const patchCall = (fetchMock.mock.calls as [string, RequestInit?][]).find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('/chats/c1') &&
        !url.includes('/messages') &&
        (init?.method?.toUpperCase() ?? 'GET') === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall![1]?.body as string) as Record<string, unknown>;
    expect(typeof body.title).toBe('string');
    expect((body.title as string).length).toBeGreaterThan(0);

    vi.mocked(apiStream).mockReset();
  });

  it('renders the Stop button while a chat send is in flight', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chapters/ch1/chats') && !url.includes('/messages')) {
        return jsonResponse(200, {
          chats: [
            {
              id: 'c1',
              chapterId: 'ch1',
              title: 'Existing chat',
              kind: 'ask',
              messageCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
            },
          ],
        });
      }
      if (
        url.includes('/api/chats/c1/messages') &&
        (input as Request | { method?: string })?.method === undefined
      ) {
        return jsonResponse(200, { messages: [] });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    // Make apiStream return a never-finishing SSE stream so isPending stays true.
    const neverEndingStream = new ReadableStream({
      start(_c) {
        /* no-op */
      },
    });
    vi.mocked(apiStream).mockResolvedValueOnce(
      new Response(neverEndingStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const user = userEvent.setup();
    // Need a model selected so checkChatSendGuards doesn't block the send.
    const qc = makeClient();
    qc.setQueryData(userSettingsQueryKey, {
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, model: 'venice-model-1' },
    });
    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, qc);

    // Wait for the chat list to load + auto-select.
    await screen.findByRole('button', { name: /Chat: Existing chat/ });

    // Type and submit.
    const textarea = await screen.findByLabelText('Message');
    await user.type(textarea, 'hello world');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // While the SSE never resolves, the composer should show Stop.
    const stopBtn = await screen.findByRole('button', { name: 'Stop generation' });
    expect(stopBtn).toBeInTheDocument();

    // Cleanup: abort the in-flight stream so the test doesn't leak.
    await user.click(stopBtn);
  });
});

// ─── useMessageActions integration ────────────────────────────────────────────

function makeModelClient(modelId = 'venice-model-1'): QueryClient {
  const qc = createQueryClient();
  qc.setQueryData(userSettingsQueryKey, {
    ...DEFAULT_SETTINGS,
    chat: { ...DEFAULT_SETTINGS.chat, model: modelId },
  });
  qc.setQueryData(modelsQueryKey, []);
  return qc;
}

function baseMessage(id: string, role: 'user' | 'assistant', content: string, createdAt?: string) {
  return {
    id,
    role,
    content,
    attachmentJson: null,
    citationsJson: null,
    model: role === 'assistant' ? 'venice-model-1' : null,
    tokens: null,
    latencyMs: null,
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: null,
  };
}

function standardFetchMock(chatId: string, chapterId: string): FetchMock {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes(`/chats/${chatId}/messages`)) {
      return jsonResponse(200, { messages: [] });
    }
    if (url.includes(`/chapters/${chapterId}/chats`)) {
      return jsonResponse(200, {
        chats: [
          {
            id: chatId,
            title: 'Test chat',
            chapterId,
            kind: 'ask',
            messageCount: 4,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
          },
        ],
      });
    }
    return jsonResponse(404, { error: 'not_mocked' });
  }) as FetchMock;
}

describe('ChatTab — useMessageActions integration', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useChatDraftStore.setState({ drafts: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(apiStream).mockReset();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    useChatDraftStore.setState({ drafts: {} });
  });

  it('resending a mid-thread user message shows the confirm dialog naming the drop count', async () => {
    const now = new Date().toISOString();
    const messages = [
      baseMessage('u1', 'user', 'Hello', now),
      baseMessage('a1', 'assistant', 'World', now),
      baseMessage('u2', 'user', 'Again', now),
      baseMessage('a2', 'assistant', 'Sure', now),
    ];

    fetchMock = standardFetchMock('c1', 'ch1');
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeModelClient();
    // Seed [u1, a1, u2, a2] into the cache — TranscriptView calls the same query key.
    qc.setQueryData(chatMessagesQueryKey('c1'), messages);
    qc.setQueryData(chatsQueryKey('ch1', 'ask'), [
      {
        id: 'c1',
        title: 'Test chat',
        chapterId: 'ch1',
        kind: 'ask',
        messageCount: 4,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, qc);

    // Wait for u1's row to appear.
    await screen.findByTestId('chat-tab');

    // Scope to u1's user row and click its Regenerate button.
    // After the rename both user and assistant rows share the "Regenerate" label, so
    // we must narrow to the specific row via data-message-id / data-role.
    const u1Row = document.querySelector('[data-message-id="u1"][data-role="user"]') as HTMLElement;
    expect(u1Row).toBeTruthy();
    await user.click(within(u1Row).getByRole('button', { name: 'Regenerate' }));

    // Confirm dialog shows with count = 3.
    const dialog = await screen.findByTestId('resend-confirm');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('3 messages');
    // Scope within dialog to avoid matching transcript row action buttons.
    expect(within(dialog).getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
  });

  it('resending the last user turn fires immediately with no dialog', async () => {
    const now = new Date().toISOString();
    const messages = [
      baseMessage('u1', 'user', 'Hello', now),
      baseMessage('a1', 'assistant', 'World', now),
    ];

    fetchMock = standardFetchMock('c1', 'ch1');
    vi.stubGlobal('fetch', fetchMock);

    // Never-ending SSE so isPending stays true long enough to assert.
    const neverEndingStream = new ReadableStream({ start() {} });
    vi.mocked(apiStream).mockResolvedValueOnce(
      new Response(neverEndingStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const qc = makeModelClient();
    qc.setQueryData(chatMessagesQueryKey('c1'), messages);
    qc.setQueryData(chatsQueryKey('ch1', 'ask'), [
      {
        id: 'c1',
        title: 'Test chat',
        chapterId: 'ch1',
        kind: 'ask',
        messageCount: 2,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, qc);

    await screen.findByTestId('chat-tab');

    // Click Regenerate on u1 — count = 1 (only a1 below), so no dialog, send fires directly.
    // Scope to the user row to avoid collision with a1's assistant Regenerate button.
    const u1Row = document.querySelector('[data-message-id="u1"][data-role="user"]') as HTMLElement;
    expect(u1Row).toBeTruthy();
    await user.click(within(u1Row).getByRole('button', { name: 'Regenerate' }));

    // No confirm dialog should appear.
    expect(screen.queryByTestId('resend-confirm')).toBeNull();

    // apiStream called with fromMessageId: 'u1' in the body.
    await waitFor(() => {
      const calls = vi.mocked(apiStream).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const init = calls[calls.length - 1][1] as { body?: Record<string, unknown> };
      expect(init.body?.fromMessageId).toBe('u1');
    });

    // Cleanup: abort the in-flight stream.
    await user.click(screen.getByRole('button', { name: 'Stop generation' }));
  });

  it('clicking Edit on a user row shows the inline textarea', async () => {
    const now = new Date().toISOString();
    const messages = [
      baseMessage('u1', 'user', 'Hello there', now),
      baseMessage('a1', 'assistant', 'World', now),
    ];

    fetchMock = standardFetchMock('c1', 'ch1');
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeModelClient();
    qc.setQueryData(chatMessagesQueryKey('c1'), messages);
    qc.setQueryData(chatsQueryKey('ch1', 'ask'), [
      {
        id: 'c1',
        title: 'Test chat',
        chapterId: 'ch1',
        kind: 'ask',
        messageCount: 2,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, qc);

    await screen.findByTestId('chat-tab');

    const editBtn = await screen.findByRole('button', { name: /^edit$/i });
    await user.click(editBtn);

    // Inline edit textarea should appear with the message content.
    const textarea = await screen.findByRole('textbox', { name: /edit message/i });
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('Hello there');
  });

  it('assistant Regenerate on a non-trailing reply confirms and replays from its preceding user turn', async () => {
    const now = new Date().toISOString();
    const messages = [
      baseMessage('u1', 'user', 'First', now),
      baseMessage('a1', 'assistant', 'Reply one', now),
      baseMessage('u2', 'user', 'Second', now),
      baseMessage('a2', 'assistant', 'Reply two', now),
    ];

    fetchMock = standardFetchMock('c1', 'ch1');
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeModelClient();
    qc.setQueryData(chatMessagesQueryKey('c1'), messages);
    qc.setQueryData(chatsQueryKey('ch1', 'ask'), [
      {
        id: 'c1',
        title: 'Test chat',
        chapterId: 'ch1',
        kind: 'ask',
        messageCount: 4,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, qc);

    await screen.findByTestId('chat-tab');

    // Click Regenerate on a1's assistant row (non-trailing reply).
    // Scope to the specific assistant row to avoid ambiguity with user-row Regenerate buttons.
    const a1Row = await screen.findByTestId('assistant-a1');
    await user.click(within(a1Row).getByRole('button', { name: 'Regenerate' }));

    // Confirm dialog: count = 3 (a1, u2, a2 are below the anchor u1).
    const dialog = await screen.findByTestId('resend-confirm');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('3 messages');
    // The dialog confirm button is labelled "Regenerate" — scope within dialog.
    expect(within(dialog).getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
  });

  it('Resend with no model selected surfaces the guard toast and does not call apiStream', async () => {
    const now = new Date().toISOString();
    const messages = [
      baseMessage('u1', 'user', 'Hello', now),
      baseMessage('a1', 'assistant', 'World', now),
    ];

    fetchMock = standardFetchMock('c1', 'ch1');
    vi.stubGlobal('fetch', fetchMock);

    // No model selected — mirrors DEFAULT_SETTINGS where chat.model is null.
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, {
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, model: null },
    });
    qc.setQueryData(modelsQueryKey, []);
    qc.setQueryData(chatMessagesQueryKey('c1'), messages);
    qc.setQueryData(chatsQueryKey('ch1', 'ask'), [
      {
        id: 'c1',
        title: 'Test chat',
        chapterId: 'ch1',
        kind: 'ask',
        messageCount: 2,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      },
    ]);

    // Clear the error store before the test so prior noise doesn't interfere.
    useErrorStore.getState().clear();

    const user = userEvent.setup();
    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, qc);

    await screen.findByTestId('chat-tab');

    // Click Regenerate on u1 — count = 1 (only a1 below), fires directly (no confirm dialog).
    // Scope to the user row to avoid collision with a1's assistant Regenerate button.
    const u1Row = document.querySelector('[data-message-id="u1"][data-role="user"]') as HTMLElement;
    expect(u1Row).toBeTruthy();
    await user.click(within(u1Row).getByRole('button', { name: 'Regenerate' }));

    // Guard should have pushed a 'no_model' error — same code checkChatSendGuards returns.
    await waitFor(() => {
      const errors = useErrorStore.getState().errors;
      expect(errors.some((e) => e.code === 'no_model')).toBe(true);
    });

    // apiStream must NOT have been called — the send was blocked.
    expect(vi.mocked(apiStream).mock.calls.length).toBe(0);

    // Clean up error store.
    useErrorStore.getState().clear();
  });
});
