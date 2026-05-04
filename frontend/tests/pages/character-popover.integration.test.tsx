// [F54] Integration test: CharacterPopover wiring inside EditorPage.
// Validates that clicking a Cast-tab card opens the popover and clicking
// the popover's Edit button forwards to the F19 CharacterSheet.

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { AppRouter } from '@/router';
import { useActiveChapterStore } from '@/store/activeChapter';
import { useInlineAIResultStore } from '@/store/inlineAIResult';
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
    targetWords: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
  };
}

function makeCharacter(): Record<string, unknown> {
  return {
    id: 'c1',
    storyId: 'abc123',
    name: 'Alice',
    role: 'Protagonist',
    age: '30',
    appearance: 'Tall',
    voice: 'Calm',
    arc: 'Grows up',
    personality: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
  };
}

function defaultRouter(): (url: string, init?: RequestInit) => Promise<Response> {
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
      return Promise.resolve(jsonResponse(200, { characters: [makeCharacter()] }));
    }
    if (url.endsWith('/stories/abc123/characters/c1')) {
      return Promise.resolve(jsonResponse(200, { character: makeCharacter() }));
    }
    if (url.endsWith('/stories/abc123/outline')) {
      return Promise.resolve(jsonResponse(200, { items: [] }));
    }
    if (url.endsWith('/users/me/venice-account')) {
      return Promise.resolve(
        jsonResponse(200, {
          verified: true,
          balanceUsd: 1,
          diem: 100,
          endpoint: null,
          lastSix: null,
        }),
      );
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

describe('EditorPage character popover (F54)', () => {
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
    useSidebarTabStore.setState({ sidebarTab: 'cast' });
    useInlineAIResultStore.setState({ inlineAIResult: null });
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
      useInlineAIResultStore.setState({ inlineAIResult: null });
    });
  });

  it('clicking a cast card opens the character popover', async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    const aliceCard = screen.getByText('Alice');
    await userEvent.setup().click(aliceCard);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog').getAttribute('aria-label') ?? '').toMatch(/alice/i);
  });

  it("popover's Edit button closes it and opens the F19 character sheet", async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Alice'));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Click the Edit footer button — first button labelled "Edit" inside the popover.
    const editBtn = screen.getByRole('button', { name: /^edit$/i });
    await user.click(editBtn);

    // Popover dismissed; CharacterSheet (F19) opens with its own "Edit
    // character" heading. The popover's aria-label was "Character: Alice";
    // post-Edit the only dialog is the sheet.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /edit character/i })).toBeInTheDocument();
    });
  });
});
