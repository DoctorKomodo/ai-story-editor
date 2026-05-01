import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CastTab } from '@/components/CastTab';
import type { Character } from '@/hooks/useCharacters';

function char(overrides: Partial<Character> & { id: string }): Character {
  return {
    storyId: 'story-1',
    name: 'Unnamed',
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 0,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CastTab', () => {
  it('renders empty state when no characters', () => {
    render(<CastTab characters={[]} onOpenCharacter={vi.fn()} />);
    expect(screen.getByText(/no characters yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/principal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/supporting/i)).not.toBeInTheDocument();
  });

  it('renders loading state', () => {
    render(<CastTab characters={[]} onOpenCharacter={vi.fn()} isLoading />);
    expect(screen.getByText(/loading cast/i)).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<CastTab characters={[]} onOpenCharacter={vi.fn()} isError />);
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load characters/i);
  });

  it('with 1 character: only Principal section, no Supporting', () => {
    const characters: Character[] = [char({ id: 'c1', name: 'Alice' })];
    render(<CastTab characters={characters} onOpenCharacter={vi.fn()} />);
    expect(screen.getByText('Principal')).toBeInTheDocument();
    expect(screen.queryByText('Supporting')).not.toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('with 2 characters: only Principal section', () => {
    const characters: Character[] = [
      char({ id: 'c1', name: 'Alice' }),
      char({ id: 'c2', name: 'Bob' }),
    ];
    render(<CastTab characters={characters} onOpenCharacter={vi.fn()} />);
    expect(screen.getByText('Principal')).toBeInTheDocument();
    expect(screen.queryByText('Supporting')).not.toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('with 3 characters: Principal (first 2) + Supporting (1)', () => {
    const characters: Character[] = [
      char({ id: 'c1', name: 'Alice' }),
      char({ id: 'c2', name: 'Bob' }),
      char({ id: 'c3', name: 'Carol' }),
    ];
    render(<CastTab characters={characters} onOpenCharacter={vi.fn()} />);
    const principalSection = screen.getByText('Principal').closest('section');
    const supportingSection = screen.getByText('Supporting').closest('section');
    expect(principalSection).not.toBeNull();
    expect(supportingSection).not.toBeNull();
    if (principalSection !== null) {
      expect(within(principalSection).getByText('Alice')).toBeInTheDocument();
      expect(within(principalSection).getByText('Bob')).toBeInTheDocument();
      expect(within(principalSection).queryByText('Carol')).not.toBeInTheDocument();
    }
    if (supportingSection !== null) {
      expect(within(supportingSection).getByText('Carol')).toBeInTheDocument();
      expect(within(supportingSection).queryByText('Alice')).not.toBeInTheDocument();
    }
  });

  it('with 5 characters: Principal (first 2) + Supporting (rest)', () => {
    const characters: Character[] = [
      char({ id: 'c1', name: 'Alice' }),
      char({ id: 'c2', name: 'Bob' }),
      char({ id: 'c3', name: 'Carol' }),
      char({ id: 'c4', name: 'Dave' }),
      char({ id: 'c5', name: 'Eve' }),
    ];
    render(<CastTab characters={characters} onOpenCharacter={vi.fn()} />);
    const principalSection = screen.getByText('Principal').closest('section');
    const supportingSection = screen.getByText('Supporting').closest('section');
    if (principalSection !== null) {
      expect(within(principalSection).getByText('Alice')).toBeInTheDocument();
      expect(within(principalSection).getByText('Bob')).toBeInTheDocument();
    }
    if (supportingSection !== null) {
      expect(within(supportingSection).getByText('Carol')).toBeInTheDocument();
      expect(within(supportingSection).getByText('Dave')).toBeInTheDocument();
      expect(within(supportingSection).getByText('Eve')).toBeInTheDocument();
    }
  });

  it('renders the uppercase first-letter initial in the avatar', () => {
    const characters: Character[] = [
      char({ id: 'c1', name: 'alice' }),
      char({ id: 'c2', name: 'Bob' }),
    ];
    render(<CastTab characters={characters} onOpenCharacter={vi.fn()} />);
    const aliceCard = screen.getByText('alice').closest('button');
    const bobCard = screen.getByText('Bob').closest('button');
    expect(aliceCard).not.toBeNull();
    expect(bobCard).not.toBeNull();
    if (aliceCard !== null) {
      const avatar = aliceCard.querySelector('.char-avatar');
      expect(avatar?.textContent).toBe('A');
    }
    if (bobCard !== null) {
      const avatar = bobCard.querySelector('.char-avatar');
      expect(avatar?.textContent).toBe('B');
    }
  });

  it('renders "Untitled" for a character with an empty name', () => {
    const characters: Character[] = [char({ id: 'c1', name: '   ' })];
    render(<CastTab characters={characters} onOpenCharacter={vi.fn()} />);
    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });

  it('omits the secondary line when both role and age are missing', () => {
    const characters: Character[] = [char({ id: 'c1', name: 'Alice', role: null, age: null })];
    render(<CastTab characters={characters} onOpenCharacter={vi.fn()} />);
    const card = screen.getByText('Alice').closest('button');
    expect(card).not.toBeNull();
    if (card !== null) {
      expect(card.querySelector('.char-role')).toBeNull();
    }
  });

  it('renders just the role when age is missing', () => {
    const characters: Character[] = [char({ id: 'c1', name: 'Alice', role: 'Hero', age: null })];
    render(<CastTab characters={characters} onOpenCharacter={vi.fn()} />);
    expect(screen.getByText('Hero')).toBeInTheDocument();
    expect(screen.queryByText(/age/i)).not.toBeInTheDocument();
  });

  it('renders just the age when role is missing', () => {
    const characters: Character[] = [char({ id: 'c1', name: 'Alice', role: null, age: '32' })];
    render(<CastTab characters={characters} onOpenCharacter={vi.fn()} />);
    expect(screen.getByText('Age 32')).toBeInTheDocument();
  });

  it('renders "Role · Age N" when both role and age are present', () => {
    const characters: Character[] = [char({ id: 'c1', name: 'Alice', role: 'Hero', age: '32' })];
    render(<CastTab characters={characters} onOpenCharacter={vi.fn()} />);
    expect(screen.getByText('Hero · Age 32')).toBeInTheDocument();
  });

  it('clicking a card calls onOpenCharacter with the character id', async () => {
    const onOpen = vi.fn();
    const characters: Character[] = [
      char({ id: 'c1', name: 'Alice' }),
      char({ id: 'c2', name: 'Bob' }),
      char({ id: 'c3', name: 'Carol' }),
    ];
    render(<CastTab characters={characters} onOpenCharacter={onOpen} />);
    const user = userEvent.setup();

    await user.click(screen.getByText('Alice'));
    expect(onOpen).toHaveBeenCalledWith('c1', expect.any(HTMLElement));

    await user.click(screen.getByText('Carol'));
    expect(onOpen).toHaveBeenCalledWith('c3', expect.any(HTMLElement));

    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
