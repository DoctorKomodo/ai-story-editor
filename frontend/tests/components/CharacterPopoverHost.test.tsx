// [F54] Tests for the popover host's grace-timer state machine.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode, RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterPopoverHost,
  type CharacterPopoverHostHandle,
} from '@/components/CharacterPopoverHost';
import { type Character, charactersQueryKey } from '@/hooks/useCharacters';

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    storyId: 's1',
    name: 'Alice',
    role: 'Protagonist',
    age: '30',
    appearance: 'Tall',
    voice: 'Calm',
    arc: 'Grows up',
    personality: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
    ...overrides,
  };
}

function withQueryClient(characters: Character[] = [makeCharacter()]): {
  wrapper: ({ children }: { children: ReactNode }) => JSX.Element;
  client: QueryClient;
} {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(charactersQueryKey('s1'), characters);
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper, client };
}

interface HostProbeProps {
  hostRef: RefObject<CharacterPopoverHostHandle | null>;
  onEdit: (id: string) => void;
}

function HostProbe({ hostRef, onEdit }: HostProbeProps): JSX.Element {
  return <CharacterPopoverHost storyId="s1" hostRef={hostRef} onEdit={onEdit} />;
}

describe('CharacterPopoverHost (F54)', () => {
  beforeEach(() => {
    // Don't use fake timers globally — react-query / waitFor depends on real
    // timers for some assertions; opt into them per-test where needed.
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens popover when openFor is called with a character id + element', async () => {
    const onEdit = vi.fn();
    const { wrapper: Wrapped } = withQueryClient();
    const hostRef: { current: CharacterPopoverHostHandle | null } = { current: null };
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    render(
      <Wrapped>
        <HostProbe
          hostRef={hostRef as RefObject<CharacterPopoverHostHandle | null>}
          onEdit={onEdit}
        />
      </Wrapped>,
    );

    await waitFor(() => {
      expect(hostRef.current).toBeTruthy();
    });

    act(() => {
      hostRef.current?.openFor('c1', anchor);
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog').getAttribute('aria-label') ?? '').toMatch(/alice/i);
  });

  it('Edit click dismisses popover and calls onEdit with the character id', async () => {
    const onEdit = vi.fn();
    const { wrapper: Wrapped } = withQueryClient();
    const hostRef: { current: CharacterPopoverHostHandle | null } = { current: null };
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    render(
      <Wrapped>
        <HostProbe
          hostRef={hostRef as RefObject<CharacterPopoverHostHandle | null>}
          onEdit={onEdit}
        />
      </Wrapped>,
    );
    await waitFor(() => {
      expect(hostRef.current).toBeTruthy();
    });

    act(() => {
      hostRef.current?.openFor('c1', anchor);
    });

    const editBtn = await screen.findByRole('button', { name: /edit/i });
    act(() => {
      editBtn.click();
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onEdit).toHaveBeenCalledWith('c1');
  });
});
