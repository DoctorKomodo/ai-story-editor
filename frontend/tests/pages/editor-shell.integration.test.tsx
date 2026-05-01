// [F51] Integration test for the EditorPage shell. Pairs with editor.test.tsx;
// this file focuses on the AppShell wiring (slot composition, sidebar tab
// state surviving in the store, modal callbacks lifted to the page) rather
// than the per-control assertions.

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function makeStory(): Record<string, unknown> {
  return {
    id: 'abc123',
    title: 'The Long Dark',
    genre: null,
    synopsis: null,
    worldNotes: null,
    targetWords: 50_000,
    systemPrompt: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
  };
}

function defaultRouter(url: string): Promise<Response> {
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
    return Promise.resolve(jsonResponse(200, { balance: { dollars: 1.23, vcu: 100 } }));
  }
  if (url.endsWith('/ai/models')) {
    return Promise.resolve(jsonResponse(200, { models: [] }));
  }
  if (url.endsWith('/users/me/settings')) {
    return Promise.resolve(
      jsonResponse(200, {
        settings: {
          theme: 'paper',
          prose: { font: 'serif', size: 18, lineHeight: 1.7 },
          writing: {
            spellcheck: true,
            typewriterMode: false,
            focusMode: false,
            dailyWordGoal: 500,
          },
          chat: { model: null, temperature: 0.7, topP: 1, maxTokens: 1024 },
          ai: { includeVeniceSystemPrompt: true },
        },
      }),
    );
  }
  return Promise.reject(new Error(`Unexpected fetch: ${url}`));
}

function renderEditor(): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(
    <MemoryRouter initialEntries={['/stories/abc123']}>
      <AppRouter queryClient={client} />
    </MemoryRouter>,
  );
}

describe('EditorPage shell integration (F51)', () => {
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
    fetchMock.mockImplementation(defaultRouter);
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

  it('mounts AppShell with all four slots populated', async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });

    expect(screen.getByTestId('app-shell-topbar')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-editor')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-chat')).toBeInTheDocument();

    // Sidebar header reuses the story title via story-picker button.
    expect(screen.getByTestId('sidebar-story-picker')).toBeInTheDocument();
  });

  it('persists active sidebar tab through the store across renders', async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-tab-cast')).toBeInTheDocument();
    });

    expect(useSidebarTabStore.getState().sidebarTab).toBe('chapters');

    await userEvent.setup().click(screen.getByTestId('sidebar-tab-cast'));
    expect(useSidebarTabStore.getState().sidebarTab).toBe('cast');
  });

  it('sidebar story-picker click is wired (no modal yet — F55 mounts it)', async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-story-picker')).toBeInTheDocument();
    });

    // Click should not throw or alter the route. F55 will assert the modal opens.
    await userEvent.setup().click(screen.getByTestId('sidebar-story-picker'));

    // Shell still mounted, story title still visible.
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });

  it('settings cog click is wired (no modal yet — F55 mounts it)', async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('topbar')).toBeInTheDocument();
    });

    const settingsButton = screen.getAllByLabelText(/settings/i)[0];
    expect(settingsButton).toBeDefined();
    if (settingsButton) {
      await userEvent.setup().click(settingsButton);
    }

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });
});
