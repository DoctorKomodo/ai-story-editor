import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Character } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CastTab } from '@/components/CastTab';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
import { makeCharacter } from '../fixtures/character';

function renderCast(
  characters: Character[],
  opts?: { isLoading?: boolean; isError?: boolean; onCreateCharacter?: () => void },
): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CastTab
        storyId="s1"
        characters={characters}
        onOpenCharacter={vi.fn()}
        onCreateCharacter={opts?.onCreateCharacter ?? vi.fn()}
        isLoading={opts?.isLoading}
        isError={opts?.isError}
      />
    </QueryClientProvider>,
  );
}

describe('CastTab', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useSelectedCharacterStore.setState({ selectedCharacterId: null });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders DRAMATIS PERSONAE header even when empty', () => {
    renderCast([]);
    expect(screen.getByTestId('cast-list-section-label')).toHaveTextContent('DRAMATIS PERSONAE');
    expect(screen.getByText('No characters yet')).toBeInTheDocument();
  });

  it('renders DRAMATIS PERSONAE header when loading', () => {
    renderCast([], { isLoading: true });
    expect(screen.getByTestId('cast-list-section-label')).toBeInTheDocument();
    expect(screen.getByText('Loading cast…')).toBeInTheDocument();
  });

  it('renders DRAMATIS PERSONAE header on error', () => {
    renderCast([], { isError: true });
    expect(screen.getByTestId('cast-list-section-label')).toBeInTheDocument();
    expect(screen.getByText('Failed to load characters')).toBeInTheDocument();
  });

  it('renders a flat ordered list — no Principal / Supporting headings', () => {
    renderCast([
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
      makeCharacter({ id: 'c', orderIndex: 2 }),
      makeCharacter({ id: 'd', orderIndex: 3 }),
    ]);
    expect(screen.queryByText('Principal')).toBeNull();
    expect(screen.queryByText('Supporting')).toBeNull();
    expect(screen.getByTestId('character-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('character-row-d')).toBeInTheDocument();
  });

  it('renders rows in array order (parent supplies pre-sorted by orderIndex)', () => {
    renderCast([
      makeCharacter({ id: 'b', orderIndex: 0 }),
      makeCharacter({ id: 'a', orderIndex: 1 }),
      makeCharacter({ id: 'c', orderIndex: 2 }),
    ]);
    const rows = screen.getAllByTestId(/^character-row-[abc]$/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'character-row-b',
      'character-row-a',
      'character-row-c',
    ]);
  });

  it('clicking + invokes onCreateCharacter once and does not fire any network request', () => {
    const onCreateCharacter = vi.fn();
    renderCast([], { onCreateCharacter });
    fireEvent.click(screen.getByLabelText(/add character/i));
    expect(onCreateCharacter).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
