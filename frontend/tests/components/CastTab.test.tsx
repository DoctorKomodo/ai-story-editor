import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CastTab } from '@/components/CastTab';
import type { Character } from '@/hooks/useCharacters';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';

function meta(id: string, orderIndex: number, name?: string): Character {
  return {
    id,
    storyId: 's1',
    name: name ?? id,
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

function renderCast(
  characters: Character[],
  opts?: { isLoading?: boolean; isError?: boolean },
): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CastTab
        storyId="s1"
        characters={characters}
        onOpenCharacter={vi.fn()}
        isLoading={opts?.isLoading}
        isError={opts?.isError}
      />
    </QueryClientProvider>,
  );
}

describe('CastTab', () => {
  beforeEach(() => {
    useSelectedCharacterStore.setState({ selectedCharacterId: null });
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
    renderCast([meta('a', 0), meta('b', 1), meta('c', 2), meta('d', 3)]);
    expect(screen.queryByText('Principal')).toBeNull();
    expect(screen.queryByText('Supporting')).toBeNull();
    expect(screen.getByTestId('character-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('character-row-d')).toBeInTheDocument();
  });

  it('renders rows in array order (parent supplies pre-sorted by orderIndex)', () => {
    renderCast([meta('b', 0), meta('a', 1), meta('c', 2)]);
    const rows = screen.getAllByTestId(/^character-row-[abc]$/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'character-row-b',
      'character-row-a',
      'character-row-c',
    ]);
  });
});
