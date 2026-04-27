// [F64] Dashboard with zero stories renders the StoryPickerEmpty hero.

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

function renderDashboard(): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage empty state (F64)', () => {
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

  it('renders the StoryPickerEmpty hero when stories array is empty', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [] }));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /your stories live here/i })).toBeInTheDocument();
    expect(screen.getByText(/start a new project/i)).toBeInTheDocument();
  });
});
