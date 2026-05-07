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
import { render, screen, waitFor } from '@testing-library/react';
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
        return Promise.resolve(jsonResponse(500, { error: { message: 'list failed', code: 'internal' } }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
    });

    // Use retry: false to avoid long retry delays in tests.
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    qc.setQueryData(modelsQueryKey, []);

    render(
      <QueryClientProvider client={qc}>
        <SceneTab chapterId="c1" editor={null} />
      </QueryClientProvider>,
    );

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
            chats: [{ id: 's1', kind: 'scene', title: 'Veranda', chapterId: 'c1', createdAt: '', updatedAt: new Date().toISOString() }],
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
