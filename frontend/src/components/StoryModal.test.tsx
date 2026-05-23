import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { StoryModalInitial } from './StoryModal';
import { StoryModal } from './StoryModal';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

const BASE_STORY: StoryModalInitial = {
  id: 's1',
  title: 'The Cartographer',
  genre: 'Literary fantasy',
  synopsis: 'A novel about borders.',
  worldNotes: null,
  includePreviousChaptersInPrompt: true,
};

function storyResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      story: {
        id: 's1',
        title: 'The Cartographer',
        genre: 'Literary fantasy',
        synopsis: 'A novel about borders.',
        worldNotes: null,
        targetWords: null,
        includePreviousChaptersInPrompt: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function renderModal(props: { mode: 'create' | 'edit'; initial?: StoryModalInitial }) {
  const qc = makeClient();
  return render(
    <QueryClientProvider client={qc}>
      <StoryModal mode={props.mode} open={true} onClose={() => {}} initial={props.initial} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StoryModal — includePreviousChaptersInPrompt toggle', () => {
  it('shows the toggle checked when story has the flag true', () => {
    renderModal({
      mode: 'edit',
      initial: { ...BASE_STORY, includePreviousChaptersInPrompt: true },
    });
    const checkbox = screen.getByRole('checkbox', {
      name: /include previous-chapter summaries/i,
    });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });

  it('shows the toggle unchecked when story has the flag false', () => {
    renderModal({
      mode: 'edit',
      initial: { ...BASE_STORY, includePreviousChaptersInPrompt: false },
    });
    expect(
      screen.getByRole('checkbox', { name: /include previous-chapter summaries/i }),
    ).not.toBeChecked();
  });

  it('shows the toggle checked by default in create mode', () => {
    renderModal({ mode: 'create' });
    expect(
      screen.getByRole('checkbox', { name: /include previous-chapter summaries/i }),
    ).toBeChecked();
  });

  it('PATCH includes includePreviousChaptersInPrompt when toggled', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(storyResponse({ includePreviousChaptersInPrompt: false }));

    renderModal({
      mode: 'edit',
      initial: { ...BASE_STORY, includePreviousChaptersInPrompt: true },
    });

    const checkbox = screen.getByRole('checkbox', {
      name: /include previous-chapter summaries/i,
    });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    fireEvent.click(screen.getByTestId('story-modal-submit'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ includePreviousChaptersInPrompt: false });
  });
});
