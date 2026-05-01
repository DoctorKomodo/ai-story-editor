import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CastTab } from '@/components/CastTab';
import type { Character } from '@/hooks/useCharacters';
import { useCharactersQuery } from '@/hooks/useCharacters';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
import { useSessionStore } from '@/store/session';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chr(o: { id: string; orderIndex: number; name?: string }): Character {
  return {
    id: o.id,
    storyId: 's1',
    name: o.name ?? o.id,
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: o.orderIndex,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
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
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => useSessionStore.getState().clearSession());
    useSessionStore.setState({ user: { id: 'u1', username: 'alice' }, status: 'authenticated' });
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
      characters: [chr({ id: 'a', orderIndex: 0 }), chr({ id: 'b', orderIndex: 1 })],
      selected: 'b',
    });
    expect(screen.getByTestId('character-row-b-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('character-row-a-delete')).toBeNull();
  });

  it('clicking × opens InlineConfirm and removes the × slot', async () => {
    renderCast({
      characters: [chr({ id: 'a', orderIndex: 0 })],
      selected: 'a',
    });
    await userEvent.click(screen.getByTestId('character-row-a-delete'));
    expect(screen.getByTestId('character-row-a-confirm-delete')).toHaveFocus();
    expect(screen.queryByTestId('character-row-a-delete')).toBeNull();
  });

  it('Escape dismisses the confirm', async () => {
    renderCast({
      characters: [chr({ id: 'a', orderIndex: 0 })],
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
      characters: [chr({ id: 'a', orderIndex: 0 })],
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
      characters: [chr({ id: 'a', orderIndex: 0 })],
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
