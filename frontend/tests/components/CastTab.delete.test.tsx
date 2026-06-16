import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Character } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CastTab } from '@/components/CastTab';
import { useCharactersQuery } from '@/hooks/useCharacters';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
import { useSessionStore } from '@/store/session';
import { makeCharacter } from '../fixtures/character';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Wrapper that mirrors how the real Sidebar drives CastTab: it runs the
 * characters query and passes the result down as a prop. This lets the
 * optimistic-update path (onMutate rewrites the cache) and the refetch-after-
 * settle path both flow through to the component without needing a full
 * Sidebar render.
 */
function CastTabWithQuery({ storyId }: { storyId: string }): React.ReactElement {
  const { data: characters = [], isLoading, isError } = useCharactersQuery(storyId);
  return (
    <CastTab
      storyId={storyId}
      characters={characters}
      onOpenCharacter={() => {}}
      onCreateCharacter={vi.fn()}
      isLoading={isLoading}
      isError={isError}
    />
  );
}

function renderCast(opts: { characters: Character[]; selected?: string | null }): {
  client: QueryClient;
} {
  const qc = createQueryClient();
  // Seed the query cache so the component renders immediately with the
  // provided characters (no network call needed for the initial display).
  qc.setQueryData(['characters', 's1'], opts.characters);
  if (opts.selected !== undefined) {
    useSelectedCharacterStore.setState({ selectedCharacterId: opts.selected });
  }
  render(
    <QueryClientProvider client={qc}>
      <CastTabWithQuery storyId="s1" />
    </QueryClientProvider>,
  );
  return { client: qc };
}

describe('CastTab — delete', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => useSessionStore.getState().clearSession());
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useSelectedCharacterStore.setState({ selectedCharacterId: null });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    useSelectedCharacterStore.setState({ selectedCharacterId: null });
  });

  it('× is only rendered for the selected card', () => {
    renderCast({
      characters: [
        makeCharacter({ id: 'a', orderIndex: 0 }),
        makeCharacter({ id: 'b', orderIndex: 1 }),
      ],
      selected: 'b',
    });
    expect(screen.getByTestId('character-row-b-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('character-row-a-delete')).toBeNull();
  });

  it('clicking × opens InlineConfirm and removes the × slot', async () => {
    renderCast({
      characters: [makeCharacter({ id: 'a', orderIndex: 0 })],
      selected: 'a',
    });
    await userEvent.click(screen.getByTestId('character-row-a-delete'));
    expect(screen.getByTestId('character-row-a-confirm-delete')).toHaveFocus();
    expect(screen.queryByTestId('character-row-a-delete')).toBeNull();
  });

  it('Escape dismisses the confirm', async () => {
    renderCast({
      characters: [makeCharacter({ id: 'a', orderIndex: 0 })],
      selected: 'a',
    });
    await userEvent.click(screen.getByTestId('character-row-a-delete'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('character-row-a-confirm-delete')).toBeNull();
    });
  });

  it('clicking Delete fires DELETE, removes the row, and clears the selection', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(200, { characters: [] }));
    renderCast({
      characters: [makeCharacter({ id: 'a', orderIndex: 0 })],
      selected: 'a',
    });
    await userEvent.click(screen.getByTestId('character-row-a-delete'));
    await userEvent.click(screen.getByTestId('character-row-a-confirm-delete'));

    await waitFor(() => {
      expect(screen.queryByTestId('character-row-a')).toBeNull();
    });
    expect(useSelectedCharacterStore.getState().selectedCharacterId).toBeNull();
  });

  it('on 500 the row is restored and aria-live announces failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));
    renderCast({
      characters: [makeCharacter({ id: 'a', orderIndex: 0 })],
      selected: 'a',
    });
    await userEvent.click(screen.getByTestId('character-row-a-delete'));
    await userEvent.click(screen.getByTestId('character-row-a-confirm-delete'));

    await waitFor(() => {
      expect(screen.getByTestId('character-row-a')).toBeInTheDocument();
    });
    expect(screen.getByText(/Delete failed/)).toBeInTheDocument();
  });
});
