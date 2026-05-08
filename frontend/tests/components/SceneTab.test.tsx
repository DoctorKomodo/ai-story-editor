/**
 * [SC17] SceneTab — smoke tests.
 *
 * Tests the orchestrator renders the empty state correctly when no sessions
 * exist, and can render the undo toast when a session is soft-deleted.
 *
 * Mocking strategy: stub `fetch` globally (same pattern as ChatPanel.test.tsx)
 * and seed the TanStack Query cache with settings + an empty models list so
 * the component can mount without network access.
 */
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneTab } from '@/components/SceneTab';
import { modelsQueryKey } from '@/hooks/useModels';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSceneTranscriptStore } from '@/store/sceneTranscript';
import { useSessionStore } from '@/store/session';

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

describe('SceneTab — smoke', () => {
  let fetchMock: FetchMock;

  /** Seed common query cache entries and return the QueryClient. */
  function makeClient(): QueryClient {
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    qc.setQueryData(modelsQueryKey, []);
    return qc;
  }

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('test-token');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    // Reset transcript store so each test starts clean.
    useSceneTranscriptStore.getState().setChat(null, []);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders the empty state when no sessions exist', async () => {
    // listChats returns an empty array (no scene sessions for this chapter).
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(jsonResponse(200, { chats: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeClient());

    await waitFor(() => {
      expect(screen.getByText(/describe what happens next/i)).toBeInTheDocument();
    });
  });

  it('renders the scene-tab root element', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(jsonResponse(200, { chats: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeClient());

    await waitFor(() => {
      expect(screen.getByTestId('scene-tab')).toBeInTheDocument();
    });
  });

  it('renders "No session yet" label in the picker when chapterId is provided but no sessions', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(jsonResponse(200, { chats: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeClient());

    await waitFor(() => {
      expect(screen.getByText(/no session yet/i)).toBeInTheDocument();
    });
  });

  it('shows the SceneUndoToast when a session is soft-deleted', async () => {
    // Mock the sessions endpoint to return one deletable session.
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chats/c1/messages')) {
        return jsonResponse(200, { messages: [] });
      }
      if (url.endsWith('/api/chats/c1') && (input as Request).method === 'DELETE') {
        return jsonResponse(204, null);
      }
      if (url.includes('/chats') && !url.includes('/messages')) {
        return jsonResponse(200, {
          chats: [
            {
              id: 'c1',
              title: 'Veranda confrontation',
              chapterId: 'ch1',
              updatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="ch1" editor={null} />, makeClient());

    // Open the picker, hover the session row so the delete button is reachable,
    // then click the delete button.
    const picker = await screen.findByRole('button', { name: /Scene session: Veranda/ });
    await user.click(picker);
    const row = await screen.findByRole('option', { name: /Veranda confrontation/ });
    await user.hover(row);
    const deleteBtn = await screen.findByRole('button', { name: /Delete Veranda confrontation/ });
    await user.click(deleteBtn);

    // The new toast should appear with role=status, the session title in
    // serif italic, and an Undo button.
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

// ─── [A1] Venice generation error ─────────────────────────────────────────────

describe('SceneTab — [A1] Venice generation error', () => {
  let fetchMock: FetchMock;

  function makeClient(): QueryClient {
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    qc.setQueryData(modelsQueryKey, []);
    return qc;
  }

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('test-token');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useSceneTranscriptStore.getState().setChat(null, []);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('shows an inline error banner when streamState is "error" with the error message', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(jsonResponse(200, { chats: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeClient());

    await waitFor(() => {
      expect(screen.getByTestId('scene-tab')).toBeInTheDocument();
    });

    // Simulate Venice failure by calling failAssistant directly on the store.
    useSceneTranscriptStore.getState().failAssistant('Venice quota exceeded');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Venice quota exceeded/i)).toBeInTheDocument();
    });
  });

  it('dismisses the Venice error banner when the dismiss button is clicked', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(jsonResponse(200, { chats: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeClient());

    await waitFor(() => {
      expect(screen.getByTestId('scene-tab')).toBeInTheDocument();
    });

    useSceneTranscriptStore.getState().failAssistant('Network error');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(useSceneTranscriptStore.getState().streamState).toBe('idle');
    });
  });
});

// ─── [A2] useScenes query error ───────────────────────────────────────────────

describe('SceneTab — [A2] useScenes query error', () => {
  let fetchMock: FetchMock;

  function makeClient(): QueryClient {
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    qc.setQueryData(modelsQueryKey, []);
    return qc;
  }

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('test-token');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useSceneTranscriptStore.getState().setChat(null, []);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('shows an error banner and hides the picker when listChats fails', async () => {
    // listChats returns a 500 — api layer converts to Error.
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(
          jsonResponse(500, { error: { message: 'list failed', code: 'internal' } }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeClient());

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // The picker button should not appear since we're showing the error instead.
    expect(screen.queryByRole('button', { name: /scene session/i })).not.toBeInTheDocument();
  });
});

// ─── [A3] listMessagesForChat rejection ───────────────────────────────────────

describe('SceneTab — [A3] transcript hydration error', () => {
  let fetchMock: FetchMock;

  function makeClient(): QueryClient {
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    qc.setQueryData(modelsQueryKey, []);
    return qc;
  }

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('test-token');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useSceneTranscriptStore.getState().setChat(null, []);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('shows an error banner when listMessagesForChat fails', async () => {
    // First call: listChats returns a session so we get an activeId.
    // Second call: listMessagesForChat fails with 404.
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
                createdAt: '',
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeClient());

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});

// ─── [Bug 1] renderTranscript — assistant-first walk ─────────────────────────
//
// Verifies that retry's streaming assistant row renders as a second candidate
// card even though no new user message accompanies it. The store is seeded
// directly (bypassing network) to isolate the rendering logic.

describe('SceneTab — renderTranscript retry visibility', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function makeClient(): QueryClient {
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    qc.setQueryData(modelsQueryKey, [{ id: 'model-a', name: 'Test Model' }]);
    return qc;
  }

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('test-token');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useSceneTranscriptStore.getState().setChat(null, []);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/chats')) {
        return Promise.resolve(
          new Response(JSON.stringify({ chats: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    useSceneTranscriptStore.getState().setChat(null, []);
  });

  it('renders two candidate cards when a streaming assistant follows a done assistant for the same user turn', async () => {
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <SceneTab chapterId="c1" editor={null} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('scene-tab')).toBeInTheDocument();
    });

    // Seed the store: [user_1, assistant_1_done, assistant_2_streaming]
    act(() => {
      useSceneTranscriptStore.getState().setChat('chat-1', [
        { id: 'u1', role: 'user', content: 'Jenny approaches Linda.', state: 'done' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Linda was already…',
          model: 'Test Model',
          state: 'done',
        },
        { id: 'a2', role: 'assistant', content: '', model: 'Test Model', state: 'streaming' },
      ]);
    });

    // Both assistant messages must produce a card.
    await waitFor(() => {
      expect(screen.getAllByTestId('scene-candidate')).toHaveLength(2);
    });
  });

  it('shows thinking-dots on the streaming card when candidate is empty', async () => {
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <SceneTab chapterId="c1" editor={null} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('scene-tab')).toBeInTheDocument();
    });

    act(() => {
      useSceneTranscriptStore.getState().setChat('chat-1', [
        { id: 'u1', role: 'user', content: 'Jenny approaches Linda.', state: 'done' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Linda was already…',
          model: 'Test Model',
          state: 'done',
        },
        { id: 'a2', role: 'assistant', content: '', model: 'Test Model', state: 'streaming' },
      ]);
    });

    await waitFor(() => {
      // The second card (empty content, streaming) must show thinking dots.
      expect(screen.getByTestId('thinking-dots')).toBeInTheDocument();
    });
  });

  it('shows Retry only on the last (latest) card', async () => {
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <SceneTab chapterId="c1" editor={null} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('scene-tab')).toBeInTheDocument();
    });

    // Two done assistants — only the last one gets Retry.
    act(() => {
      useSceneTranscriptStore.getState().setChat('chat-1', [
        { id: 'u1', role: 'user', content: 'Jenny approaches Linda.', state: 'done' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'First draft.',
          model: 'Test Model',
          state: 'done',
        },
        {
          id: 'a2',
          role: 'assistant',
          content: 'Second draft.',
          model: 'Test Model',
          state: 'done',
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('scene-candidate')).toHaveLength(2);
    });

    // Only one Retry button total — on the second (latest) card.
    const retryButtons = screen.getAllByRole('button', { name: /retry/i });
    expect(retryButtons).toHaveLength(1);

    // First card is superseded.
    expect(screen.getByText(/superseded/i)).toBeInTheDocument();
  });

  it('shows direction bubble only on the first card when multiple candidates share the same direction', async () => {
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <SceneTab chapterId="c1" editor={null} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('scene-tab')).toBeInTheDocument();
    });

    act(() => {
      useSceneTranscriptStore.getState().setChat('chat-1', [
        { id: 'u1', role: 'user', content: 'Jenny approaches Linda.', state: 'done' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'First draft.',
          model: 'Test Model',
          state: 'done',
        },
        {
          id: 'a2',
          role: 'assistant',
          content: 'Second draft.',
          model: 'Test Model',
          state: 'done',
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('scene-candidate')).toHaveLength(2);
    });

    // The direction bubble must appear exactly once (first card only).
    const directionBubbles = screen.getAllByTestId('scene-direction-bubble');
    expect(directionBubbles).toHaveLength(1);
    expect(directionBubbles[0]).toHaveTextContent('Jenny approaches Linda.');
  });

  it('shows Retry on the last assistant card when the array ends on a user message', async () => {
    // Issue 3: when the array ends on a user message (stream failed and the
    // streaming row was removed), isLatest must still flag the last *assistant*
    // so its Retry button remains visible.
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <SceneTab chapterId="c1" editor={null} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('scene-tab')).toBeInTheDocument();
    });

    // Seed: [user_1, assistant_1_done, user_2] — trailing user, no assistant yet.
    act(() => {
      useSceneTranscriptStore.getState().setChat('chat-1', [
        { id: 'u1', role: 'user', content: 'First direction.', state: 'done' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'First response.',
          model: 'Test Model',
          state: 'done',
        },
        { id: 'u2', role: 'user', content: 'Second direction (no response yet).', state: 'done' },
      ]);
    });

    await waitFor(() => {
      // Only one assistant card is rendered (a1).
      expect(screen.getAllByTestId('scene-candidate')).toHaveLength(1);
    });

    // The single assistant card must still show Retry even though it's not the
    // last element in the messages array.
    const retryButtons = screen.getAllByRole('button', { name: /retry/i });
    expect(retryButtons).toHaveLength(1);
  });

  it('shows separate direction bubbles when two different user turns produce candidates', async () => {
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <SceneTab chapterId="c1" editor={null} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('scene-tab')).toBeInTheDocument();
    });

    act(() => {
      useSceneTranscriptStore.getState().setChat('chat-1', [
        { id: 'u1', role: 'user', content: 'Turn one direction.', state: 'done' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'First response.',
          model: 'Test Model',
          state: 'done',
        },
        { id: 'u2', role: 'user', content: 'Turn two direction.', state: 'done' },
        {
          id: 'a2',
          role: 'assistant',
          content: 'Second response.',
          model: 'Test Model',
          state: 'done',
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('scene-candidate')).toHaveLength(2);
    });

    // Each card has its own distinct direction — both bubbles appear.
    const directionBubbles = screen.getAllByTestId('scene-direction-bubble');
    expect(directionBubbles).toHaveLength(2);
    expect(directionBubbles[0]).toHaveTextContent('Turn one direction.');
    expect(directionBubbles[1]).toHaveTextContent('Turn two direction.');
  });
});
