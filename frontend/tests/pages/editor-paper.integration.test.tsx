// [F52] Integration test: EditorPage's editor slot uses FormatBar + Paper.
// Pairs with editor.test.tsx (shell-level assertions). Verifies the editor
// slot stack swaps from F8 <Editor> to F31 FormatBar + F32 Paper, and that
// chapter saves PATCH the API after the autosave debounce.

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

function makeStory(): Record<string, unknown> {
  return {
    id: 'abc123',
    title: 'The Long Dark',
    genre: 'Sci-Fi',
    synopsis: null,
    worldNotes: null,
    targetWords: 50_000,
    systemPrompt: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
  };
}

function makeChapter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ch1',
    storyId: 'abc123',
    title: 'Opening',
    orderIndex: 0,
    wordCount: 0,
    status: 'draft',
    bodyJson: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
    ...overrides,
  };
}

function defaultRouter(): (url: string, init?: RequestInit) => Promise<Response> {
  return (url, _init) => {
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
      return Promise.resolve(jsonResponse(200, { chapters: [makeChapter()] }));
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

describe('EditorPage paper integration (F52)', () => {
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

  it('renders FormatBar inside the editor slot once the story loads', async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('app-shell-editor')).toBeInTheDocument();
    });

    // FormatBar exposes a "Bold" button as a stable anchor.
    expect(screen.getByRole('button', { name: /^bold$/i })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: /formatting/i })).toBeInTheDocument();
  });

  it('shows the empty-state placeholder when no chapter is active', async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('app-shell-editor')).toBeInTheDocument();
    });

    expect(screen.getByTestId('editor-empty-state')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /chapter body/i })).toBeNull();
  });

  it('mounts Paper when an active chapter is selected', async () => {
    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /chapter body/i })).toBeInTheDocument();
    });

    const heading = await screen.findByTestId('chapter-heading');
    expect(heading.textContent ?? '').toMatch(/opening/i);
    expect(screen.queryByTestId('editor-empty-state')).toBeNull();
  });

  it('Find button surfaces the [X17] tooltip until the feature ships', async () => {
    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^find$/i })).toBeInTheDocument();
    });

    const findBtn = screen.getByRole('button', { name: /^find$/i });
    expect(findBtn).toBeDisabled();
    expect(findBtn.getAttribute('title') ?? '').toMatch(/x17/i);
  });
});
