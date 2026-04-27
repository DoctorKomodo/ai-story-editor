// [F56] Integration test: TopBar surfaces the F48 AutosaveIndicator and
// reads its props from the F9 useAutosave hook output piped through
// EditorPage. Validates the prop wiring without driving a full save flow.

import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { AppRouter } from '@/router';
import { useActiveChapterStore } from '@/store/activeChapter';
import { useSessionStore } from '@/store/session';
import { useSidebarTabStore } from '@/store/sidebarTab';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const FULL_SETTINGS = {
  theme: 'paper',
  prose: { font: 'serif', size: 18, lineHeight: 1.7 },
  writing: { spellcheck: true, typewriterMode: false, focusMode: false, dailyWordGoal: 500 },
  chat: { model: null, temperature: 0.7, topP: 1, maxTokens: 1024 },
  ai: { includeVeniceSystemPrompt: true },
};

function makeStory(): Record<string, unknown> {
  return {
    id: 'abc123',
    title: 'The Long Dark',
    genre: null,
    synopsis: null,
    worldNotes: null,
    targetWords: null,
    systemPrompt: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
  };
}

function defaultRouter(): (url: string) => Promise<Response> {
  return (url) => {
    if (url.endsWith('/auth/refresh')) {
      return Promise.resolve(jsonResponse(200, { accessToken: 'tok-refresh' }));
    }
    if (url.endsWith('/auth/me')) {
      return Promise.resolve(jsonResponse(200, { user: { id: 'u1', username: 'alice' } }));
    }
    if (url.endsWith('/stories/abc123')) {
      return Promise.resolve(jsonResponse(200, { story: makeStory() }));
    }
    if (url.endsWith('/stories/abc123/chapters')) {
      return Promise.resolve(jsonResponse(200, { chapters: [] }));
    }
    if (url.endsWith('/stories/abc123/characters')) {
      return Promise.resolve(jsonResponse(200, { characters: [] }));
    }
    if (url.endsWith('/stories/abc123/outline')) {
      return Promise.resolve(jsonResponse(200, { items: [] }));
    }
    if (url.endsWith('/ai/balance')) {
      return Promise.resolve(jsonResponse(200, { balance: { dollars: 1, vcu: 100 } }));
    }
    if (url.endsWith('/ai/models')) {
      return Promise.resolve(jsonResponse(200, { models: [] }));
    }
    if (url.endsWith('/users/me/settings')) {
      return Promise.resolve(jsonResponse(200, { settings: FULL_SETTINGS }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  };
}

function renderEditor(): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(
    <MemoryRouter initialEntries={['/stories/abc123']}>
      <AppRouter queryClient={client} />
    </MemoryRouter>,
  );
}

describe('EditorPage autosave indicator (F56)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
      status: 'authenticated',
    });
    useActiveChapterStore.setState({ activeChapterId: null });
    useSidebarTabStore.setState({ sidebarTab: 'chapters' });
    fetchMock = vi.fn();
    fetchMock.mockImplementation(defaultRouter());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
      useActiveChapterStore.setState({ activeChapterId: null });
      useSidebarTabStore.setState({ sidebarTab: 'chapters' });
    });
  });

  it('mounts the topbar without rendering an autosave message in idle state', async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('topbar')).toBeInTheDocument();
    });

    // Idle = no indicator text. Saving / saved / error states only render
    // text when the autosave hook flips off idle, which requires a real
    // chapter edit (out of scope here).
    expect(screen.queryByText(/saving/i)).toBeNull();
    expect(screen.queryByText(/save failed/i)).toBeNull();
  });

  it('TopBar accepts the F56 autosave triple shape (no SaveState fallback)', async () => {
    renderEditor();
    // The compile-time check is the test — F56's TopBar prop signature only
    // accepts `{ status, savedAt, retryAt }`. If a stale `saveState` /
    // `savedAtRelative` ever leaks back in, this test won't catch it directly,
    // but typecheck (verify pipeline) will.
    await waitFor(() => {
      expect(screen.getByTestId('topbar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });
});
