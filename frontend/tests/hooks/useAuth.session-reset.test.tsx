import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/hooks/useAuth';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useChatDraftStore } from '@/store/chatDraft';
import { useSessionStore } from '@/store/session';
import { actStore } from '../utils/actStore';

type FetchMock = ReturnType<typeof vi.fn>;

function makeWrapper(qc: QueryClient): (props: { children: ReactNode }) => JSX.Element {
  return function Wrapper({ children }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

describe('useAuth — session reset on auth transition (story-editor-7lo)', () => {
  let fetchMock: FetchMock;
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({ user: null, status: 'idle', sessionExpired: false });
    useAttachedSelectionStore.setState({ attachedSelection: null });
    useChatDraftStore.setState({ drafts: {} });
  });

  afterEach(() => {
    qc.clear();
    qc.unmount();
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    actStore(() => {
      useSessionStore.setState({ user: null, status: 'idle', sessionExpired: false });
      useAttachedSelectionStore.setState({ attachedSelection: null });
      useChatDraftStore.setState({ drafts: {} });
    });
  });

  it("login() clears the previous user's cache and Zustand stores before setSession", async () => {
    // Seed the QueryClient and stores as if user A's session had primed them.
    qc.setQueryData(['stories', 'list'], [{ id: 'story-A1', title: "A's story" }]);
    useAttachedSelectionStore.setState({
      attachedSelection: {
        text: "A's selected text",
        chapter: { id: 'cha1', number: 1, title: 'A Ch1' },
      },
    });
    useChatDraftStore.setState({
      drafts: {
        chatA: {
          chatId: 'chatA',
          userContent: 'A draft',
          attachment: null,
          assistantText: 'A reply',
          status: 'streaming',
          error: null,
        },
      },
    });

    // Mock POST /api/auth/login → returns user B's session.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        user: { id: 'B', username: 'b', name: 'User B' },
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(qc) });
    await act(async () => {
      await result.current.login({ username: 'b', password: 'pw' });
    });

    await waitFor(() => {
      expect(useSessionStore.getState().user?.username).toBe('b');
    });

    // QueryClient cache must be empty — no A data leaking into B's session.
    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();

    // Per-user Zustand stores must be reset to initial state.
    expect(useAttachedSelectionStore.getState().attachedSelection).toBeNull();
    expect(useChatDraftStore.getState().drafts).toEqual({});
  });

  it('logout() clears cache and stores after the request resolves', async () => {
    // Start with user A authenticated and state seeded.
    useSessionStore.getState().setSession({ id: 'A', username: 'a', name: 'User A' });
    qc.setQueryData(['stories', 'list'], [{ id: 'story-A1' }]);
    useAttachedSelectionStore.setState({
      attachedSelection: {
        text: 'leak',
        chapter: { id: 'c1', number: 1, title: '' },
      },
    });

    fetchMock.mockResolvedValueOnce(emptyResponse(204));

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(qc) });
    await act(async () => {
      await result.current.logout();
    });

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
    expect(useAttachedSelectionStore.getState().attachedSelection).toBeNull();
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().status).toBe('unauthenticated');
  });

  it('logout() still clears cache and stores even if the API call fails', async () => {
    useSessionStore.getState().setSession({ id: 'A', username: 'a', name: 'User A' });
    qc.setQueryData(['stories', 'list'], [{ id: 'story-A1' }]);

    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(qc) });
    await act(async () => {
      await result.current.logout().catch(() => undefined);
    });

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
    expect(useSessionStore.getState().user).toBeNull();
  });
});
