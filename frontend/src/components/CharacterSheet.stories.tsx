import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/design/primitives';
import type { Character } from '@/hooks/useCharacters';
import { characterQueryKey } from '@/hooks/useCharacters';
import { CharacterSheet } from './CharacterSheet';

const STORY_ID = 'story-demo';
const CHARACTER_ID = 'ch1';

const sampleCharacter: Character = {
  id: CHARACTER_ID,
  storyId: STORY_ID,
  name: 'Lyra',
  role: 'protagonist',
  age: '27',
  appearance: 'Tall, with the kind of stillness that gets mistaken for shyness.',
  voice: 'Quiet, precise. Holds eye contact a beat longer than is comfortable.',
  arc: 'Learns to trust her own judgement after a series of avoidable misreadings.',
  personality: 'Careful, curious, slow to anger but absolute once she gets there.',
  orderIndex: 0,
  createdAt: '2026-04-01T12:00:00Z',
  updatedAt: '2026-04-30T12:00:00Z',
};

function makeClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  client.setQueryData(characterQueryKey(STORY_ID, CHARACTER_ID), sampleCharacter);
  return client;
}

function Demo() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={makeClient()}>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Reopen sheet
      </Button>
      {open ? (
        <CharacterSheet
          storyId={STORY_ID}
          mode="edit"
          characterId={CHARACTER_ID}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Components/CharacterSheet',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Modal opens with the seeded character. Click "Delete" to reveal the
 * nested confirm alertdialog.
 */
export const Open: Story = {};
