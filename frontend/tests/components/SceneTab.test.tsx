/**
 * [SC17] SceneTab — tests for the migrated shared-transcript-layer implementation.
 *
 * Tests use the same patterns as ChatTab.test.tsx:
 *   - `vi.mock('@/lib/api', ...)` to intercept `apiStream` for SSE sends.
 *   - TanStack Query cache seeding via `qc.setQueryData(chatMessagesQueryKey(...), [...])`.
 *   - Zustand reset via `useChatDraftStore.setState({ drafts: {} })`.
 *   - No `useSceneTranscript` or `SceneCandidateCard` references — those are
 *     deleted in Task 17. All assertions use `AssistantMessageRow` selectors:
 *     `data-testid="assistant-${id}"` and action button `aria-label`s.
 */
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneTab } from '@/components/SceneTab';
import { chatMessagesQueryKey, chatsQueryKey } from '@/hooks/useChat';
import { modelsQueryKey } from '@/hooks/useModels';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
import {
  apiStream,
  resetApiClientForTests,
  setAccessToken,
  setUnauthorizedHandler,
} from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { truncateAtWordBoundary } from '@/lib/strings';
import { useChatDraftStore } from '@/store/chatDraft';
import { useSessionStore } from '@/store/session';

// Partially mock @/lib/api so we can intercept `apiStream` for SSE sends
// without affecting the other exports (api, resetApiClientForTests, etc).
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

// ─── Shared helpers ────────────────────────────────────────────────────────────

function makeBaseClient(): QueryClient {
  const qc = createQueryClient();
  qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
  qc.setQueryData(modelsQueryKey, []);
  return qc;
}

function makeModelClient(modelId = 'venice-scene-1'): QueryClient {
  const qc = createQueryClient();
  qc.setQueryData(userSettingsQueryKey, {
    ...DEFAULT_SETTINGS,
    chat: { ...DEFAULT_SETTINGS.chat, model: modelId },
  });
  qc.setQueryData(modelsQueryKey, [{ id: modelId, name: 'Scene Model' }]);
  return qc;
}

function sseResponse(): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const chunk = JSON.stringify({ choices: [{ delta: { content: 'drafted scene text' } }] });
      controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

// ─── Common beforeEach / afterEach ─────────────────────────────────────────────

function setupTest(fetchMock: FetchMock): void {
  resetApiClientForTests();
  setAccessToken('test-token');
  setUnauthorizedHandler(() => {
    useSessionStore.getState().clearSession();
  });
  useSessionStore.setState({
    user: { id: 'u1', username: 'alice', name: 'Alice' },
    status: 'authenticated',
  });
  useChatDraftStore.setState({ drafts: {} });
  vi.stubGlobal('fetch', fetchMock);
}

function teardownTest(): void {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  resetApiClientForTests();
  useSessionStore.setState({ user: null, status: 'idle' });
  useChatDraftStore.setState({ drafts: {} });
}

// ─── Test 7: Soft-delete with undo ─────────────────────────────────────────────
// (Mapped from "shows the UndoToast when a session is soft-deleted" — same UX.)

describe('SceneTab — [7] soft-delete with undo', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chats/s1/messages')) {
        return jsonResponse(200, { messages: [] });
      }
      if (url.endsWith('/api/chats/s1') && init?.method === 'DELETE') {
        return jsonResponse(204, null);
      }
      if (url.includes('/chats') && !url.includes('/messages')) {
        return jsonResponse(200, {
          chats: [
            {
              id: 's1',
              title: 'Veranda confrontation',
              chapterId: 'ch1',
              kind: 'scene',
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
    setupTest(fetchMock);
  });

  afterEach(() => {
    teardownTest();
  });

  it('shows UndoToast when a session is soft-deleted, restores on Undo', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="ch1" editor={null} />, makeBaseClient());

    const picker = await screen.findByRole('button', { name: /Scene session: Veranda/ });
    await user.click(picker);
    const row = await screen.findByRole('option', { name: /Veranda confrontation/ });
    await user.hover(row);
    const deleteBtn = await screen.findByRole('button', { name: /Delete Veranda confrontation/ });
    await user.click(deleteBtn);

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/Deleted/i);
    expect(toast).toHaveTextContent(/Veranda confrontation/);
    const undo = await screen.findByRole('button', { name: /Undo/i });
    expect(undo).toBeInTheDocument();

    // Clicking Undo cancels the pending delete and dismisses the toast.
    await user.click(undo);
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
  });
});

// ─── Test 1: Session picker integration ────────────────────────────────────────

describe('SceneTab — [1] session picker integration', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    setupTest(fetchMock);
  });

  afterEach(() => {
    teardownTest();
  });

  it('renders scene-tab root and "No session yet" when no sessions exist', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(jsonResponse(200, { chats: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeBaseClient());

    await waitFor(() => {
      expect(screen.getByTestId('scene-tab')).toBeInTheDocument();
      expect(screen.getByText(/no session yet/i)).toBeInTheDocument();
    });
  });

  it('renders the SceneEmptyState when no sessions exist', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(jsonResponse(200, { chats: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeBaseClient());

    await waitFor(() => {
      expect(screen.getByTestId('scene-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/describe what happens next/i)).toBeInTheDocument();
  });

  it('auto-selects the first session when sessions load', async () => {
    fetchMock.mockImplementation((url: string, _init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/messages')) {
        return Promise.resolve(jsonResponse(200, { messages: [] }));
      }
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(
          jsonResponse(200, {
            chats: [
              {
                id: 's1',
                title: 'Opening scene',
                chapterId: 'c1',
                kind: 'scene',
                messageCount: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
              },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeBaseClient());

    // The picker should reflect the active session.
    await screen.findByRole('button', { name: /Scene session: Opening scene/ });
  });

  it('switches active session when user clicks a different option in the picker', async () => {
    // s1 is the most-recently-used session (newest lastActivityAt) so it
    // auto-selects as sessions[0] under the newest-first invariant.
    const recentTime = new Date().toISOString();
    const olderTime = new Date(Date.now() - 60_000).toISOString();
    fetchMock.mockImplementation((url: string, _init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/messages')) {
        return Promise.resolve(jsonResponse(200, { messages: [] }));
      }
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(
          jsonResponse(200, {
            chats: [
              {
                id: 's1',
                title: 'First scene',
                chapterId: 'c1',
                kind: 'scene',
                messageCount: 0,
                createdAt: olderTime,
                updatedAt: recentTime,
                lastActivityAt: recentTime,
              },
              {
                id: 's2',
                title: 'Second scene',
                chapterId: 'c1',
                kind: 'scene',
                messageCount: 0,
                createdAt: olderTime,
                updatedAt: olderTime,
                lastActivityAt: olderTime,
              },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeBaseClient());

    // First scene auto-selected.
    const picker = await screen.findByRole('button', { name: /Scene session: First scene/ });
    await user.click(picker);

    // Select the second scene.
    const secondOption = await screen.findByRole('option', { name: /Second scene/ });
    await user.click(secondOption);

    await screen.findByRole('button', { name: /Scene session: Second scene/ });
  });
});

// ─── Test 2: Auto-rename on first turn ─────────────────────────────────────────

describe('SceneTab — [2] auto-rename on first turn', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    setupTest(fetchMock);
  });

  afterEach(() => {
    vi.mocked(apiStream).mockReset();
    teardownTest();
  });

  it('truncateAtWordBoundary truncates a long scene direction at the configured max', () => {
    const longDirection =
      'Jenny approaches Linda on the veranda and they begin an awkward conversation about cheese and regrets';
    const title = truncateAtWordBoundary(longDirection, 50);
    expect(title.length).toBeLessThanOrEqual(51); // 50 + ellipsis char
    expect(title.endsWith('…')).toBe(true);
    expect(title).toMatch(/^Jenny approaches Linda/);
  });

  it('auto-renames the session after the first send (inline-create path)', async () => {
    const now = new Date().toISOString();
    const newChat = {
      id: 'sc1',
      chapterId: 'ch1',
      title: null,
      kind: 'scene',
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };

    let chatCreated = false;
    const newChatSummary = { ...newChat, messageCount: 0 };
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';

      if (url.includes('/chapters/ch1/chats') && method === 'GET') {
        return jsonResponse(200, { chats: chatCreated ? [newChatSummary] : [] });
      }
      if (url.includes('/chapters/ch1/chats') && method === 'POST') {
        chatCreated = true;
        return jsonResponse(201, { chat: newChat });
      }
      if (url.includes('/chats/sc1/messages') && method === 'GET') {
        return jsonResponse(200, { messages: [] });
      }
      if (url.includes('/chats/sc1') && !url.includes('/messages') && method === 'PATCH') {
        return jsonResponse(200, { chat: { ...newChat, title: 'Jenny approaches Linda' } });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    vi.mocked(apiStream).mockResolvedValueOnce(sseResponse());

    const user = userEvent.setup();
    const qc = makeModelClient();
    renderWithProviders(<SceneTab chapterId="ch1" editor={null} />, qc);

    await waitFor(() => expect(screen.getByTestId('scene-tab')).toBeInTheDocument());

    // No sessions yet — type and send directly (inline-create path).
    const textarea = await screen.findByRole('textbox');
    await user.click(textarea);
    await user.type(textarea, 'Jenny approaches Linda on the veranda');
    await user.keyboard('{Control>}{Enter}{/Control}');

    // The rename PATCH should fire after the send completes.
    await waitFor(
      () => {
        const patchCalls = (fetchMock.mock.calls as [string, RequestInit?][]).filter(
          ([url, init]) =>
            typeof url === 'string' &&
            url.includes('/chats/sc1') &&
            !url.includes('/messages') &&
            (init?.method?.toUpperCase() ?? 'GET') === 'PATCH',
        );
        expect(patchCalls.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    // Confirm the PATCH body has a non-empty title.
    const patchCall = (fetchMock.mock.calls as [string, RequestInit?][]).find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('/chats/sc1') &&
        !url.includes('/messages') &&
        (init?.method?.toUpperCase() ?? 'GET') === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall![1]?.body as string) as Record<string, unknown>;
    expect(typeof body.title).toBe('string');
    expect((body.title as string).length).toBeGreaterThan(0);
  });
});

// ─── Test 3: Hydration error UX ────────────────────────────────────────────────

describe('SceneTab — [3] hydration error UX', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    setupTest(fetchMock);
  });

  afterEach(() => {
    teardownTest();
  });

  it('shows TranscriptView error banner when the messages query fails', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/messages')) {
        return Promise.resolve(
          jsonResponse(404, { error: { message: 'Chat not found', code: 'not_found' } }),
        );
      }
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(
          jsonResponse(200, {
            chats: [
              {
                id: 's1',
                kind: 'scene',
                title: 'Veranda',
                chapterId: 'c1',
                messageCount: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
              },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeBaseClient());

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
  });

  it('shows a Retry button in the error banner that triggers refetch', async () => {
    let callCount = 0;
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/messages')) {
        callCount++;
        return Promise.resolve(
          jsonResponse(500, { error: { message: 'Server error', code: 'internal' } }),
        );
      }
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(
          jsonResponse(200, {
            chats: [
              {
                id: 's1',
                kind: 'scene',
                title: 'Veranda',
                chapterId: 'c1',
                messageCount: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
              },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    const qc = makeBaseClient();
    // Pre-disable retries so the first failure shows the error banner immediately.
    qc.setDefaultOptions({ queries: { retry: false } });
    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, qc);

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    const before = callCount;
    const user = userEvent.setup();
    await user.click(retryBtn);

    await waitFor(
      () => {
        expect(callCount).toBeGreaterThan(before);
      },
      { timeout: 3000 },
    );
  });
});

// ─── Test 4: Insert-at-end ──────────────────────────────────────────────────────

describe('SceneTab — [4] insert-at-end', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    setupTest(fetchMock);
  });

  afterEach(() => {
    teardownTest();
  });

  it('calls editor.chain().focus().insertContentAt(docEnd, text) when Insert at end is clicked', async () => {
    // Seed the query cache directly so there's a persisted assistant message
    // visible without going through the full SSE send flow.
    const now = new Date().toISOString();
    const qc = makeBaseClient();

    const assistantMsg = {
      id: 'a1',
      role: 'assistant' as const,
      content: 'Linda was already on the veranda.',
      attachmentJson: null,
      citationsJson: null,
      model: 'venice-scene-1',
      tokens: null,
      latencyMs: null,
      createdAt: now,
    };
    const userMsg = {
      id: 'u1',
      role: 'user' as const,
      content: 'Jenny approaches Linda.',
      attachmentJson: null,
      citationsJson: null,
      model: null,
      tokens: null,
      latencyMs: null,
      createdAt: now,
    };

    qc.setQueryData(chatMessagesQueryKey('scene1'), [userMsg, assistantMsg]);
    qc.setQueryData(chatsQueryKey('c1', 'scene'), [
      {
        id: 'scene1',
        title: 'Test scene',
        chapterId: 'c1',
        kind: 'scene',
        messageCount: 2,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      },
    ]);

    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/messages')) {
        return Promise.resolve(jsonResponse(200, { messages: [userMsg, assistantMsg] }));
      }
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(
          jsonResponse(200, {
            chats: [
              {
                id: 'scene1',
                title: 'Test scene',
                chapterId: 'c1',
                kind: 'scene',
                messageCount: 2,
                createdAt: now,
                updatedAt: now,
                lastActivityAt: now,
              },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    const insertContentAt = vi.fn().mockReturnValue({ run: vi.fn() });
    const focus = vi.fn().mockReturnValue({ insertContentAt });
    const chain = vi.fn().mockReturnValue({ focus });
    const mockEditor = {
      state: { doc: { content: { size: 42 } } },
      chain,
    } as unknown as Parameters<typeof SceneTab>[0]['editor'];

    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="c1" editor={mockEditor} />, qc);

    // Wait for the assistant row to appear.
    await screen.findByTestId('assistant-a1');

    // The "Insert at end" button should be visible.
    const insertBtn = await screen.findByRole('button', { name: /insert at end/i });
    await user.click(insertBtn);

    expect(chain).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(insertContentAt).toHaveBeenCalledWith(42, 'Linda was already on the veranda.');
  });
});

// ─── Test 5: Retry semantics ────────────────────────────────────────────────────

describe('SceneTab — [5] retry semantics', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    setupTest(fetchMock);
  });

  afterEach(() => {
    vi.mocked(apiStream).mockReset();
    teardownTest();
  });

  it('clicking Regenerate fires mutateAsync with retry: true (linear retry)', async () => {
    const now = new Date().toISOString();
    const qc = makeModelClient();

    const userMsg = {
      id: 'u1',
      role: 'user' as const,
      content: 'Jenny approaches Linda.',
      attachmentJson: null,
      citationsJson: null,
      model: null,
      tokens: null,
      latencyMs: null,
      createdAt: now,
    };
    const assistantMsg = {
      id: 'a1',
      role: 'assistant' as const,
      content: 'Linda was already on the veranda.',
      attachmentJson: null,
      citationsJson: null,
      model: 'venice-scene-1',
      tokens: null,
      latencyMs: null,
      createdAt: now,
    };

    qc.setQueryData(chatMessagesQueryKey('scene1'), [userMsg, assistantMsg]);
    qc.setQueryData(chatsQueryKey('c1', 'scene'), [
      {
        id: 'scene1',
        title: 'Test scene',
        chapterId: 'c1',
        kind: 'scene',
        messageCount: 2,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      },
    ]);

    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/messages') && !url.includes('POST')) {
        return Promise.resolve(jsonResponse(200, { messages: [userMsg, assistantMsg] }));
      }
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(
          jsonResponse(200, {
            chats: [
              {
                id: 'scene1',
                title: 'Test scene',
                chapterId: 'c1',
                kind: 'scene',
                messageCount: 2,
                createdAt: now,
                updatedAt: now,
                lastActivityAt: now,
              },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    // The retry triggers another SSE stream.
    vi.mocked(apiStream).mockResolvedValueOnce(sseResponse());

    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, qc);

    // Wait for the assistant row to appear.
    await screen.findByTestId('assistant-a1');

    // Spy on apiStream calls to check the body includes retry: true.
    const regenerateBtn = await screen.findByRole('button', { name: /regenerate/i });
    await user.click(regenerateBtn);

    await waitFor(() => {
      const calls = vi.mocked(apiStream).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      // lastCall[1] is { method, body, signal } — the init object passed to apiStream.
      const init = lastCall[1] as { body?: Record<string, unknown> };
      const body = init.body ?? {};
      expect(body.retry).toBe(true);
    });
  });
});

// ─── Test 6: Stop during streaming ─────────────────────────────────────────────

describe('SceneTab — [6] stop during streaming', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    setupTest(fetchMock);
  });

  afterEach(() => {
    vi.mocked(apiStream).mockReset();
    teardownTest();
  });

  it('renders the Stop button while a scene send is in flight', async () => {
    const now = new Date().toISOString();
    const newChat = {
      id: 'sc1',
      chapterId: 'ch1',
      title: 'Existing scene',
      kind: 'scene',
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/chapters/ch1/chats') && !url.includes('/messages')) {
        return jsonResponse(200, { chats: [newChat] });
      }
      if (url.includes('/chats/sc1/messages')) {
        return jsonResponse(200, { messages: [] });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    // Never-ending SSE stream keeps isPending=true.
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
    const qc = makeModelClient();
    renderWithProviders(<SceneTab chapterId="ch1" editor={null} />, qc);

    // Wait for chat to load and auto-select.
    await screen.findByRole('button', { name: /Scene session: Existing scene/ });

    // Type and send.
    const textarea = await screen.findByLabelText('Message');
    await user.type(textarea, 'Jenny approaches Linda');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // While the SSE never resolves, the composer should show Stop.
    const stopBtn = await screen.findByRole('button', { name: 'Stop generation' });
    expect(stopBtn).toBeInTheDocument();

    // Cleanup: abort the in-flight stream.
    await user.click(stopBtn);
  });
});

// ─── Test 8: enableWebSearch propagation ───────────────────────────────────────

describe('SceneTab — [8] enableWebSearch propagation', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    setupTest(fetchMock);
  });

  afterEach(() => {
    vi.mocked(apiStream).mockReset();
    teardownTest();
  });

  it('passes enableWebSearch: true to mutateAsync when the composer toggle is on', async () => {
    const now = new Date().toISOString();
    const newChat = {
      id: 'sc1',
      chapterId: 'ch1',
      title: null,
      kind: 'scene',
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };
    const newChatSummary = { ...newChat, messageCount: 0 };

    let chatCreated = false;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';

      if (url.includes('/chapters/ch1/chats') && method === 'GET') {
        return jsonResponse(200, { chats: chatCreated ? [newChatSummary] : [] });
      }
      if (url.includes('/chapters/ch1/chats') && method === 'POST') {
        chatCreated = true;
        return jsonResponse(201, { chat: newChat });
      }
      if (url.includes('/chats/sc1/messages') && method === 'GET') {
        return jsonResponse(200, { messages: [] });
      }
      if (url.includes('/chats/sc1') && !url.includes('/messages') && method === 'PATCH') {
        return jsonResponse(200, { chat: { ...newChat, title: 'Jenny' } });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    vi.mocked(apiStream).mockResolvedValueOnce(sseResponse());

    // A model that supports web search so the toggle appears.
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, {
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, model: 'venice-scene-1' },
    });
    qc.setQueryData(modelsQueryKey, [
      { id: 'venice-scene-1', name: 'Scene Model', supportsWebSearch: true },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="ch1" editor={null} />, qc);

    await waitFor(() => expect(screen.getByTestId('scene-tab')).toBeInTheDocument());

    // Enable the web-search toggle.
    const toggle = await screen.findByRole('checkbox', { name: /web search/i });
    await user.click(toggle);

    // Type and send.
    const textarea = await screen.findByRole('textbox');
    await user.click(textarea);
    await user.type(textarea, 'Jenny approaches Linda');
    await user.keyboard('{Control>}{Enter}{/Control}');

    // The apiStream call should include enableWebSearch: true in the body.
    await waitFor(() => {
      const calls = vi.mocked(apiStream).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });

    const calls = vi.mocked(apiStream).mock.calls;
    const lastCall = calls[calls.length - 1];
    const init = lastCall[1] as { body?: Record<string, unknown> };
    const body = init.body ?? {};
    expect(body.enableWebSearch).toBe(true);
  });
});

// ─── Test 9: Send error → banner retry ─────────────────────────────────────────

describe('SceneTab — [9] send error → banner retry', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    setupTest(fetchMock);
  });

  afterEach(() => {
    vi.mocked(apiStream).mockReset();
    teardownTest();
  });

  it('shows VeniceErrorBanner via sendError when the send mutation throws', async () => {
    const now = new Date().toISOString();
    const qc = makeModelClient();

    const existingChat = {
      id: 'sc1',
      chapterId: 'ch1',
      title: 'Existing',
      kind: 'scene',
      messageCount: 1,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/chapters/ch1/chats') && !url.includes('/messages')) {
        return jsonResponse(200, { chats: [existingChat] });
      }
      if (url.includes('/chats/sc1/messages')) {
        return jsonResponse(200, { messages: [] });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    // Make apiStream throw so the mutation errors out.
    vi.mocked(apiStream).mockRejectedValueOnce(new Error('Venice quota exceeded'));

    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="ch1" editor={null} />, qc);

    await screen.findByRole('button', { name: /Scene session: Existing/ });

    const textarea = await screen.findByLabelText('Message');
    await user.type(textarea, 'Jenny approaches Linda');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // The error banner should appear.
    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(screen.getByTestId('venice-error-banner')).toBeInTheDocument();
    expect(screen.getByText(/Venice quota exceeded/i)).toBeInTheDocument();

    // The banner should have a Retry button.
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
  });

  it('banner Retry re-dispatches via useBannerRetry', async () => {
    const now = new Date().toISOString();
    const qc = makeModelClient();

    const existingChat = {
      id: 'sc1',
      chapterId: 'ch1',
      title: 'Existing',
      kind: 'scene',
      messageCount: 1,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };

    const userMsg = {
      id: 'u1',
      role: 'user' as const,
      content: 'Jenny approaches Linda.',
      attachmentJson: null,
      citationsJson: null,
      model: null,
      tokens: null,
      latencyMs: null,
      createdAt: now,
    };

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/chapters/ch1/chats') && !url.includes('/messages')) {
        return jsonResponse(200, { chats: [existingChat] });
      }
      if (url.includes('/chats/sc1/messages')) {
        // After refetch returns a trailing user message → banner retry sends retry:true.
        return jsonResponse(200, { messages: [userMsg] });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    // First call throws; second call (banner retry) resolves.
    vi.mocked(apiStream)
      .mockRejectedValueOnce(new Error('Venice timeout'))
      .mockResolvedValueOnce(sseResponse());

    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="ch1" editor={null} />, qc);

    await screen.findByRole('button', { name: /Scene session: Existing/ });

    const textarea = await screen.findByLabelText('Message');
    await user.type(textarea, 'Jenny approaches Linda.');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // Error banner appears.
    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    await user.click(retryBtn);

    // After banner retry, the second apiStream call should have retry: true
    // (because the messages cache has a trailing user message).
    await waitFor(() => {
      const calls = vi.mocked(apiStream).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const secondCall = calls[1];
      const init = secondCall[1] as { body?: Record<string, unknown> };
      const body = init.body ?? {};
      expect(body.retry).toBe(true);
    });
  });
});
