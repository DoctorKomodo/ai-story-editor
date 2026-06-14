import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { Character } from 'story-editor-shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Paper } from '@/components/Paper';
import { charactersQueryKey } from '@/hooks/useCharacters';
import { setCharRefSuggestionProvider } from '@/lib/charRefSuggestion';
import { createQueryClient } from '@/lib/queryClient';
import { useCharRefSuggestionStore } from '@/store/charRefSuggestion';

/**
 * X30 regression test.
 *
 * Reproduces the "@-mention picker always shows 'No characters'" bug. The
 * historical root cause was that Paper read `activeStoryId` from a
 * `useActiveStoryStore` whose setter was never called anywhere, so
 * `useCharactersQuery(undefined)` was permanently disabled and the suggestion
 * provider returned `[]` even when the URL-bound story had characters.
 *
 * The fix threads `storyId` through the Paper prop API (parent passes
 * `story.id` from `useParams`); this test exercises that wiring end-to-end —
 * cache hit on `charactersQueryKey(storyId)` → provider returns mapped
 * characters → `@` opens the menu populated.
 */

function makeChar(id: string, name: string, role: string | null = null): Character {
  return {
    id,
    storyId: 's1',
    name,
    role,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 0,
    createdAt: '2026-05-07T00:00:00Z',
    updatedAt: '2026-05-07T00:00:00Z',
  };
}

describe('Paper @-mention character picker (X30 regression)', () => {
  afterEach(() => {
    setCharRefSuggestionProvider(null);
    act(() => {
      useCharRefSuggestionStore.getState().reset();
    });
  });

  it('populates the menu with the active story characters when user types @', async () => {
    const client = createQueryClient();
    client.setQueryData<Character[]>(charactersQueryKey('s1'), [
      makeChar('c1', 'Elena Marsh', 'Protagonist'),
      makeChar('c2', 'Marcus Stone', null),
    ]);

    let editor: TiptapEditor | null = null;
    render(
      <QueryClientProvider client={client}>
        <Paper
          storyId="s1"
          storyTitle="Test"
          onReady={(ed) => {
            editor = ed;
          }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(editor).not.toBeNull());

    act(() => {
      editor!.commands.focus();
      editor!.commands.insertContent('@');
    });

    await waitFor(() => {
      expect(screen.getByTestId('char-ref-menu')).toBeInTheDocument();
    });

    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: /elena marsh/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /marcus stone/i })).toBeInTheDocument();
    expect(screen.queryByText(/no characters in this story yet/i)).not.toBeInTheDocument();
  });

  it('shows the empty state when storyId is omitted (no story → no characters)', async () => {
    const client = createQueryClient();

    let editor: TiptapEditor | null = null;
    render(
      <QueryClientProvider client={client}>
        <Paper
          storyTitle="Test"
          onReady={(ed) => {
            editor = ed;
          }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(editor).not.toBeNull());

    act(() => {
      editor!.commands.focus();
      editor!.commands.insertContent('@');
    });

    await waitFor(() => {
      expect(screen.getByText(/no characters in this story yet/i)).toBeInTheDocument();
    });
  });
});
