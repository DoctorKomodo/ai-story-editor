// [F58] Dashboard renders the F30 StoryPicker as a permanent embedded surface.

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { DashboardPage } from '@/pages/DashboardPage';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function LocationProbe(): null {
  const loc = useLocation();
  (window as unknown as { __probeLocation: string }).__probeLocation = loc.pathname;
  return null;
}

function renderDashboard(): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <DashboardPage />
                <LocationProbe />
              </>
            }
          />
          <Route path="/stories/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeStory(
  overrides: Partial<{
    id: string;
    title: string;
    genre: string | null;
    synopsis: string | null;
    chapterCount: number;
    totalWordCount: number;
    updatedAt: string;
    targetWords: number | null;
  }> = {},
): Record<string, unknown> {
  return {
    id: 's1',
    title: 'Dune',
    genre: 'Sci-Fi',
    synopsis: 'A boy on a desert planet.',
    worldNotes: null,
    targetWords: null,
    systemPrompt: null,
    chapterCount: 3,
    totalWordCount: 4500,
    createdAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
    ...overrides,
  };
}

describe('DashboardPage (F58 — embedded StoryPicker)', () => {
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
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders the embedded StoryPicker with no backdrop or Close button', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [makeStory()] }));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('story-picker')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('story-picker-backdrop')).toBeNull();
    expect(screen.queryByTestId('story-picker-close')).toBeNull();
  });

  it('renders story rows from /api/stories', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        stories: [
          makeStory({ id: 's1', title: 'Dune' }),
          makeStory({ id: 's2', title: 'Foundation' }),
        ],
      }),
    );
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Dune')).toBeInTheDocument();
    });
    expect(screen.getByText('Foundation')).toBeInTheDocument();
  });

  it('clicking a row navigates to /stories/:id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { stories: [makeStory({ id: 'abc', title: 'Dune' })] }),
    );
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Dune')).toBeInTheDocument();
    });

    await userEvent.setup().click(screen.getByTestId('story-picker-row-abc'));

    await waitFor(() => {
      expect((window as unknown as { __probeLocation: string }).__probeLocation).toBe(
        '/stories/abc',
      );
    });
  });

  it('empty state renders "No stories yet" inside the picker body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [] }));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
    });
  });

  it('clicking "New story" opens the StoryModal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [] }));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
    });

    await userEvent.setup().click(screen.getByTestId('story-picker-new'));

    expect(screen.getByRole('heading', { name: /new story/i })).toBeInTheDocument();
  });

  it('Escape on the dashboard does NOT dismiss the embedded picker', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [makeStory()] }));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('story-picker')).toBeInTheDocument();
    });

    await userEvent.setup().keyboard('{Escape}');
    expect(screen.getByTestId('story-picker')).toBeInTheDocument();
  });
});
